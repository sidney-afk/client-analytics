-- Preparation only: original deterministic create observation, no mutation replay.
begin;
create or replace function public.production_provider_send_ack_v1(p_attempt_id uuid,p_lock_token text,p_request jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 if a.lock_token is distinct from p_lock_token or a.request is distinct from p_request or jsonb_typeof(p_response) is distinct from 'object' then raise exception 'provider_send_ack_binding';end if;
 if a.provider_response->>'format'='provider-create-read-observations-v1' then raise exception 'provider_send_ack_observation_requires_reconciliation';end if;
 if a.state<>'admitted' then
  if a.provider_response is distinct from p_response then raise exception 'provider_send_ack_conflict';end if;
 else
  update linear_exit_provider.send_attempts_v1 set state='acknowledged',provider_response=p_response,acknowledged_at=clock_timestamp() where attempt_id=a.attempt_id;
 end if;
 return jsonb_build_object('acknowledged',true,'completed',false);
end $fn$;

create function public.production_provider_create_observe_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb,p_expected_observation jsonb,p_query text,p_variables jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $observe$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;history jsonb;envelope jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.mode<>'closed' or gate.epoch is distinct from p_epoch then raise exception 'provider_create_observe_gate';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox or a.provider_response is distinct from p_expected_observation then raise exception 'provider_create_observe_cas';end if;
 if a.state<>'admitted' or a.admission_preimage_v1 is null or a.receipt_context_v1 is null or a.request->>'kind' is distinct from 'issueCreate' or o.entity is distinct from 'deliverable' or o.operation is distinct from 'create' or o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_create_observe_attempt';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_create_observe_original_intent_changed';end if;
 if encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex') is distinct from '3b9dca6d2c4958575692c69ef6999a1659ff13edef22cd01b13e85559fd395dd' or p_variables is distinct from jsonb_build_object('id',a.admission_preimage_v1->'payload'->'planned_linear_issue_id') or nullif(p_variables->>'id','') is null or a.request->'variables'->'input'->>'id' is distinct from p_variables->>'id' then raise exception 'provider_create_observe_query';end if;
 if jsonb_typeof(p_response) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(p_response)key) is distinct from array['body','http_status']::text[] or jsonb_typeof(p_response->'http_status') is distinct from 'number' or (p_response->>'http_status')::numeric not between 100 and 599 or trunc((p_response->>'http_status')::numeric)<>(p_response->>'http_status')::numeric or jsonb_typeof(p_response->'body') is distinct from 'object' or octet_length(p_response::text)>1048576 then raise exception 'provider_create_observe_response';end if;
 if a.provider_response is null then history:='[]'::jsonb;
 elsif a.provider_response->>'format'='provider-create-read-observations-v1' and a.provider_response->>'query_sha256'=encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex') and a.provider_response->'variables'=p_variables and jsonb_typeof(a.provider_response->'observations')='array' then history:=a.provider_response->'observations';
 else raise exception 'provider_create_observe_existing_evidence';end if;
 if jsonb_array_length(history)>=16 or octet_length(history::text)+octet_length(p_response::text)>4194304 then raise exception 'provider_create_observe_history_bound';end if;
 envelope:=jsonb_build_object('format','provider-create-read-observations-v1','query_sha256',encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex'),'variables',p_variables,'observations',history||jsonb_build_array(jsonb_build_object('sequence',jsonb_array_length(history)+1,'observed_at',clock_timestamp(),'response',p_response)));
 update linear_exit_provider.send_attempts_v1 set provider_response=envelope where attempt_id=a.attempt_id;
 return jsonb_build_object('recorded',true,'observation',envelope,'mutation_acknowledged',false,'provider_resent',false,'external_worker_coverage_proven',false);
end $observe$;
revoke all on function public.production_provider_create_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_create_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb) to service_role;
create function public.production_provider_create_observed_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;d public.deliverables%rowtype;linked public.deliverables%rowtype;ctx jsonb;initial jsonb;payload jsonb;issue jsonb;input jsonb;expected jsonb;receipt jsonb;after_row jsonb;next_d jsonb;event_row jsonb;later_pending boolean;pid text; k text; expected_value text; actual_value text;observation jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_create_recovery_gate';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_create_recovery_stops';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_create_recovery_preimage';end if;
 if a.admission_preimage_v1 is null or a.receipt_context_v1 is null then raise exception 'provider_create_recovery_context';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_create_original_intent_changed';end if;
 if a.state not in ('admitted','completed') or a.request->>'kind' is distinct from 'issueCreate' or o.entity is distinct from 'deliverable' or o.operation is distinct from 'create' or a.provider_response->>'format' is distinct from 'provider-create-read-observations-v1' or a.provider_response->>'query_sha256' is distinct from '3b9dca6d2c4958575692c69ef6999a1659ff13edef22cd01b13e85559fd395dd' or a.provider_response->'variables' is distinct from jsonb_build_object('id',o.payload->'planned_linear_issue_id') or jsonb_typeof(a.provider_response->'observations') is distinct from 'array' or jsonb_array_length(a.provider_response->'observations')<1 or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_create_observed_evidence';end if;
 observation:=a.provider_response->'observations'->-1->'response';
 if (observation->>'http_status')::int not between 200 and 299 or observation->'body' ? 'errors' or jsonb_typeof(observation->'body'->'data'->'issue') is distinct from 'object' then raise exception 'provider_create_observed_unresolved';end if;
 ctx:=a.receipt_context_v1->'context';initial:=ctx->'entity';payload:=o.payload;issue:=observation->'body'->'data'->'issue';input:=a.request->'variables'->'input';pid:=payload->>'planned_linear_issue_id';
 if nullif(pid,'') is null or jsonb_typeof(initial) is distinct from 'object' or jsonb_typeof(issue) is distinct from 'object' or issue->>'id' is distinct from pid or input->>'id' is distinct from pid then raise exception 'provider_create_planned_identity';end if;
 -- Source createIntentMismatches checks, including same-target autolink equivalence.
 foreach k in array array['team','project'] loop
  expected_value:=public.production_provider_receipt_clean_v1(coalesce(nullif(payload->(k||'_id'),'""'::jsonb),ctx->(k||'_id')));
  if expected_value='' or public.production_provider_receipt_clean_v1(issue->k->'id') is distinct from expected_value or public.production_provider_receipt_clean_v1(input->(k||'Id')) is distinct from expected_value then raise exception 'provider_create_intent_%',k;end if;
 end loop;
 if public.production_provider_receipt_clean_v1(issue->'title') is distinct from public.production_provider_receipt_clean_v1(payload->'title') or input->>'title' is distinct from public.production_provider_receipt_clean_v1(payload->'title') then raise exception 'provider_create_intent_title';end if;
 if payload ? 'description' and ((issue ? 'description' and jsonb_typeof(issue->'description') not in ('null','string')) or jsonb_typeof(payload->'description') is distinct from 'string' or public.production_provider_create_autolinks_v1(coalesce(issue->>'description','')) is distinct from public.production_provider_create_autolinks_v1(payload->>'description') or coalesce(input->>'description','') is distinct from payload->>'description') then raise exception 'provider_create_intent_description';end if;
 if payload ? 'status' or payload ? 'state_id' then
  if nullif(public.production_provider_receipt_clean_v1(ctx->'state_id'),'') is null or public.production_provider_receipt_clean_v1(issue->'state'->'id') is distinct from public.production_provider_receipt_clean_v1(ctx->'state_id') or public.production_provider_receipt_clean_v1(input->'stateId') is distinct from public.production_provider_receipt_clean_v1(ctx->'state_id') then raise exception 'provider_create_intent_status';end if;
 end if;
 if payload ? 'due_date' and (public.production_provider_receipt_clean_v1(issue->'dueDate') is distinct from public.production_provider_receipt_clean_v1(payload->'due_date') or public.production_provider_receipt_clean_v1(input->'dueDate') is distinct from public.production_provider_receipt_clean_v1(payload->'due_date')) then raise exception 'provider_create_intent_due';end if;
 if payload ? 'assignee_id' or payload ? 'linear_user_id' then
  expected_value:=public.production_provider_receipt_clean_v1(coalesce(nullif(payload->'linear_user_id','""'::jsonb),ctx->'linear_user_id'));
  if public.production_provider_receipt_clean_v1(issue->'assignee'->'id') is distinct from expected_value or public.production_provider_receipt_clean_v1(input->'assigneeId') is distinct from expected_value then raise exception 'provider_create_intent_assignee';end if;
 end if;
 if payload ? 'priority' and (coalesce(nullif(payload->>'priority',''),'0')::numeric is distinct from coalesce(issue->>'priority','0')::numeric or coalesce(nullif(payload->>'priority',''),'0')::numeric is distinct from coalesce(input->>'priority','0')::numeric) then raise exception 'provider_create_intent_priority';end if;
 expected_value:=public.production_provider_receipt_clean_v1(coalesce(nullif(payload->'parent_linear_issue_id','""'::jsonb),ctx->'parent_linear_issue_id'));
 if public.production_provider_receipt_clean_v1(issue->'parent'->'id') is distinct from expected_value or public.production_provider_receipt_clean_v1(input->'parentId') is distinct from expected_value then raise exception 'provider_create_intent_parent';end if;
 if payload ? 'label_ids' then
  if jsonb_typeof(payload->'label_ids') is distinct from 'array' or jsonb_typeof(issue->'labelIds') is distinct from 'array' or jsonb_typeof(input->'labelIds') is distinct from 'array' then raise exception 'provider_create_intent_labels';end if;
  if (select coalesce(jsonb_agg(v order by v),'[]') from (select distinct public.production_provider_receipt_clean_v1(value) v from jsonb_array_elements(payload->'label_ids'))x where v<>'') is distinct from (select coalesce(jsonb_agg(v order by v),'[]') from (select distinct public.production_provider_receipt_clean_v1(value) v from jsonb_array_elements(issue->'labelIds'))x where v<>'') or input->'labelIds' is distinct from payload->'label_ids' then raise exception 'provider_create_intent_labels';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||o.entity_id,0));
 select * into strict d from public.deliverables where id=o.entity_id for update;
 foreach k in array array['id','batch_id','client_slug','team','kind','origin','card_id','created_by','linear_issue_uuid'] loop
  if public.production_provider_receipt_clean_v1(to_jsonb(d)->k) is distinct from public.production_provider_receipt_clean_v1(initial->k) then raise exception 'provider_create_native_identity_%',k;end if;
 end loop;
 if d.client_slug is distinct from o.client_slug or d.team is distinct from o.team or d.linear_issue_uuid is distinct from pid or d.created_at is distinct from (initial->>'created_at')::timestamptz then raise exception 'provider_create_native_identity';end if;
 receipt:=coalesce(a.admission_preimage_v1->'linear_result','{}'::jsonb);if receipt='null'::jsonb then receipt:='{}'::jsonb;end if;if jsonb_typeof(receipt) is distinct from 'object' then raise exception 'provider_create_observed_receipt_shape';end if;
 receipt:=receipt||jsonb_build_object('mutation','issueCreate','issue_id',pid,'identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'updated_at',public.production_provider_receipt_clean_v1(case when issue->'updatedAt' is null or issue->'updatedAt' in ('null'::jsonb,'""'::jsonb) then issue->'createdAt' else issue->'updatedAt' end),'mirror_actor_id',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'id'),'mirror_actor_name',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'name'),'recovered_idempotently',true,'conflict',jsonb_build_object('decision','already_exists','reason','linear_issue_already_exists_exact'));
 if o.linear_result is not null and o.linear_result is distinct from receipt then raise exception 'provider_create_checkpoint_conflict';end if;
 if a.state='completed' then
  if d.linear_identifier is distinct from nullif(btrim(issue->>'identifier'),'') or d.linear_issue_url is distinct from nullif(btrim(issue->>'url'),'') then raise exception 'provider_create_completed_linkage';end if;
  if o.status is distinct from 'written' or o.lock_token is not null or o.locked_at is not null or a.local_receipt is distinct from receipt or o.linear_result is distinct from receipt then raise exception 'provider_create_observed_completed_binding';end if;
  return jsonb_build_object('completed',true,'recovered_by_read',true,'provider_resent',false,'external_worker_coverage_proven',false);
 end if;
 if o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') then raise exception 'provider_create_recovery_lock';end if;
 after_row:=to_jsonb(o)||jsonb_build_object('linear_result',receipt,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set linear_result=receipt,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 select exists(select from public.mirror_outbox where entity='deliverable' and entity_id=d.id and id>o.id and status in ('pending','failed','shadow_ok')) into later_pending;
 next_d:=to_jsonb(d)||jsonb_build_object('linear_issue_uuid',pid,'linear_identifier',nullif(btrim(issue->>'identifier'),''),'linear_issue_url',nullif(btrim(issue->>'url'),''),'linear_raw',jsonb_set(d.linear_raw,'{issue}',d.linear_raw->'issue'||jsonb_build_object('id',pid,'identifier',nullif(btrim(issue->>'identifier'),''),'url',nullif(btrim(issue->>'url'),''))),'sync_state',case when later_pending then 'pending' else 'clean' end,'updated_at',now());
 event_row:=to_jsonb(jsonb_populate_record(null::public.deliverable_events,jsonb_build_object('deliverable_id',d.id,'batch_id',d.batch_id,'client_slug',d.client_slug,'ts',now(),'actor','SyncView Mirror','role','system','action','mirror_out_create_link','from_status',d.status,'to_status',d.status,'source','outbound','payload',jsonb_build_object('outbox_id',o.id,'linkage_only',true,'later_pending',later_pending),'event_assignee_attribution','unknown')))-'id';
 expected:=jsonb_build_object('id',d.id,'batch_id',d.batch_id,'client_slug',d.client_slug,'team',d.team,'kind',d.kind,'origin',d.origin,'card_id',d.card_id,'created_by',d.created_by,'created_at',d.created_at,'planned_linear_issue_id',pid,'intent_fingerprint',payload->>'_intent_fingerprint');
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('create_before',to_jsonb(d),'create_after',next_d,'create_event',event_row));
 linked:=public.production_issue_create_linkage(d.id,o.id,expected,jsonb_build_object('id',pid,'identifier',issue->>'identifier','url',issue->>'url'));
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 select * into strict o from public.mirror_outbox where id=o.id;
 after_row:=to_jsonb(o)||jsonb_build_object('status','written','processed_at',now(),'last_error',null,'next_retry_at',null,'attempts',coalesce(o.attempts,0)+1,'lock_token',null,'locked_at',null,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set status='written',processed_at=now(),last_error=null,next_retry_at=null,attempts=coalesce(o.attempts,0)+1,lock_token=null,locked_at=null,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 update linear_exit_provider.send_attempts_v1 set state='completed',local_receipt=receipt,completed_at=clock_timestamp() where attempt_id=a.attempt_id;
 return jsonb_build_object('completed',true,'linkage_only',true,'recovered_by_read',true,'mutation_acknowledged',false,'provider_resent',false,'external_worker_coverage_proven',false);
end
$recover$;
revoke all on function public.production_provider_create_observed_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_create_observed_recover_v1(uuid,uuid,jsonb) to service_role;

commit;
