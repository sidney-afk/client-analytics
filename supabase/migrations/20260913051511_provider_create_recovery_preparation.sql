-- Preparation only: deterministic F203 create ACK recovery; no provider calls.
begin;
create or replace function public.production_application_dml_guard_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype; context public.card_write_transaction_context_v1%rowtype; before_row jsonb;after_row jsonb; item jsonb; allowed boolean:=false; card_table text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 select * into context from public.card_write_transaction_context_v1 where transaction_id=txid_current() and backend_pid=pg_backend_pid() and epoch=gate.epoch;
 if gate.mode='open' and context.kind is distinct from 'followup' then
  if tg_level='STATEMENT' then return null;elsif tg_op='DELETE' then return old;else return new;end if;
 end if;
 if context.kind='flag_control' then
  if tg_level='STATEMENT' then
   if (tg_table_name='syncview_runtime_flags' and tg_op='UPDATE') or (tg_table_name='flag_flips' and tg_op='INSERT') then return null;end if;
  else
   before_row:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
   after_row:=case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end;
   if tg_table_name='syncview_runtime_flags' and tg_op='UPDATE' then
    allowed:=before_row->>'key'=context.scope->>'key' and after_row->>'key'=context.scope->>'key' and before_row->'value'=context.scope->'before' and after_row->'value'=context.scope->'after' and after_row->>'updated_by'=context.scope->>'actor' and (before_row-array['value','updated_by','updated_at'])=(after_row-array['value','updated_by','updated_at']);
   elsif tg_table_name='flag_flips' and tg_op='INSERT' then
    allowed:=after_row->>'key'=context.scope->>'key' and after_row->'old_value'=context.scope->'before' and after_row->'new_value'=context.scope->'after' and after_row->>'actor'=context.scope->>'actor';
   end if;
  end if;
 elsif context.kind='provider_recovery' then
  if tg_level='STATEMENT' then
   if (tg_table_name='mirror_outbox' and tg_op='UPDATE') or (tg_table_name='production_comments' and tg_op='UPDATE' and context.scope ? 'comment_before') or (tg_table_name='deliverable_events' and tg_op='INSERT' and context.scope ? 'comment_event') or (tg_table_name='card_change_journal' and tg_op='INSERT' and (context.scope ? 'comment_before' or context.scope ? 'create_before')) or (tg_table_name='deliverables' and tg_op='UPDATE' and context.scope ? 'create_before') or (tg_table_name='deliverable_events' and tg_op='INSERT' and context.scope ? 'create_event') then return null;end if;
  elsif tg_table_name='mirror_outbox' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'before' and to_jsonb(new)=context.scope->'after';
  elsif tg_table_name='production_comments' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'comment_before' and to_jsonb(new)=context.scope->'comment_after';
  elsif tg_table_name='deliverables' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'create_before' and to_jsonb(new)=context.scope->'create_after';
  elsif tg_table_name='card_change_journal' and tg_op='INSERT' and context.scope ? 'create_before' then
   after_row:=to_jsonb(new);
   allowed:=after_row->>'relation_schema'='public' and after_row->>'relation_name'='deliverables' and after_row->>'operation'='UPDATE'
    and jsonb_populate_record(null::public.deliverables,after_row->'row_before') is not distinct from jsonb_populate_record(null::public.deliverables,context.scope->'create_before')
    and jsonb_populate_record(null::public.deliverables,after_row->'row_after') is not distinct from jsonb_populate_record(null::public.deliverables,context.scope->'create_after')
    and after_row->'entity_key_before'=jsonb_build_object('id',context.scope->'create_before'->'id') and after_row->'entity_key_after'=jsonb_build_object('id',context.scope->'create_after'->'id')
    and after_row->>'client_before'=context.scope->'create_before'->>'client_slug' and after_row->>'client_after'=context.scope->'create_after'->>'client_slug' and after_row->>'transaction_id'=txid_current()::text;
  elsif tg_table_name='card_change_journal' and tg_op='INSERT' then
   after_row:=to_jsonb(new);
   allowed:=after_row->>'relation_schema'='public' and after_row->>'relation_name'='production_comments' and after_row->>'operation'='UPDATE'
    and jsonb_populate_record(null::public.production_comments,after_row->'row_before') is not distinct from jsonb_populate_record(null::public.production_comments,context.scope->'comment_before') and jsonb_populate_record(null::public.production_comments,after_row->'row_after') is not distinct from jsonb_populate_record(null::public.production_comments,context.scope->'comment_after')
    and after_row->'entity_key_before'=jsonb_build_object('id',context.scope->'comment_before'->'id') and after_row->'entity_key_after'=jsonb_build_object('id',context.scope->'comment_after'->'id')
    and after_row->>'client_before'=context.scope->'comment_before'->>'client_slug' and after_row->>'client_after'=context.scope->'comment_after'->>'client_slug'
    and after_row->>'transaction_id'=txid_current()::text;
  elsif tg_table_name='deliverable_events' and tg_op='INSERT' then
   allowed:=(to_jsonb(new)-'id')=coalesce(context.scope->'comment_event',context.scope->'create_event');
  end if;
 elsif context.kind='provider_snapshot' then
  if tg_level='STATEMENT' then
   if (tg_table_name='track_b_team_rollbacks' and tg_op in ('INSERT','UPDATE')) or (tg_table_name='track_b_team_rollback_intents' and tg_op='INSERT') or (tg_table_name='mirror_outbox' and tg_op='UPDATE') then return null;end if;
  else
   before_row:=case when tg_op='UPDATE' then to_jsonb(old) else null end;after_row:=to_jsonb(new);
   if tg_table_name='track_b_team_rollbacks' and tg_op='INSERT' then
    allowed:=not(context.scope?'rollback') and (after_row-array['id','correlation_id','opened_at'])=jsonb_build_object('team',context.scope->>'team','is_drill',false,'state','open','expected_authority',context.scope->'authority','prior_outbound',jsonb_build_object('mode','off'),'prior_parity',jsonb_build_object('enabled',false),'fence_generation',context.scope->'generation','snapshot_count',0,'snapshot_sha256',null,'terminal_receipt',null,'actor',context.scope->>'actor','completed_at',null);
    if coalesce(allowed,false) then update public.card_write_transaction_context_v1 set scope=scope||jsonb_build_object('rollback',after_row) where transaction_id=context.transaction_id;end if;
   elsif tg_table_name='track_b_team_rollbacks' and tg_op='UPDATE' then
    allowed:=before_row=context.scope->'rollback' and after_row=before_row||jsonb_build_object('snapshot_count',jsonb_array_length(context.scope->'rows'),'snapshot_sha256',context.scope->>'snapshot_hash');
   elsif tg_table_name='track_b_team_rollback_intents' and tg_op='INSERT' then
    select value into item from jsonb_array_elements(context.scope->'rows') where value->>'id'=after_row->>'outbox_id';
    allowed:=item is not null and after_row=jsonb_build_object('rollback_id',context.scope->'rollback'->'id','outbox_id',item->'id','row_snapshot',item,'row_sha256',encode(extensions.digest(convert_to(item::text,'UTF8'),'sha256'),'hex'),'classification',null,'classification_history','[]'::jsonb,'reason',null,'classified_by',null,'classified_at',null,'terminal_receipt',null);
   elsif tg_table_name='mirror_outbox' and tg_op='UPDATE' then
    allowed:=exists(select from jsonb_array_elements(context.scope->'rows') r where r.value=before_row) and after_row=before_row||jsonb_build_object('status','skipped','last_error','F27 hold '||(context.scope->'rollback'->>'correlation_id'),'next_retry_at',null,'updated_at',to_jsonb(now()));
   end if;
  end if;
 elsif context.kind='provider_disposition' then
  if tg_level='STATEMENT' then
   if tg_op='UPDATE' and tg_table_name in ('mirror_outbox','track_b_team_rollback_intents') then return null;end if;
  elsif tg_op='UPDATE' then
   before_row:=to_jsonb(old);after_row:=to_jsonb(new);
   if tg_table_name='mirror_outbox' then
    allowed:=before_row=context.scope->'outbox' and context.scope->>'classification'='discard'
     and (before_row-array['processed_at','next_retry_at','last_error','updated_at'])=(after_row-array['processed_at','next_retry_at','last_error','updated_at'])
     and after_row->>'status'='skipped' and after_row->'next_retry_at'='null'::jsonb
     and after_row->>'last_error'='F27 discard: '||(context.scope->>'reason');
   elsif tg_table_name='track_b_team_rollback_intents' then
    allowed:=before_row=context.scope->'intent'
     and (before_row-array['classification','reason','classified_by','classified_at','classification_history'])=(after_row-array['classification','reason','classified_by','classified_at','classification_history'])
     and after_row->>'classification'=context.scope->>'classification'
     and after_row->>'reason'=context.scope->>'reason' and after_row->>'classified_by'=context.scope->>'actor'
     and after_row->'classification_history'=(before_row->'classification_history')||jsonb_build_array(jsonb_build_object('from',before_row->'classification','to',context.scope->>'classification','reason',context.scope->>'reason','actor',context.scope->>'actor','at',now()));
   end if;
  end if;
 elsif context.kind='followup' then
  card_table:=case context.scope->>'surface' when 'calendar' then 'calendar_posts' when 'samples' then 'sample_reviews' end;
  if tg_level='STATEMENT' then
   if tg_op<>'TRUNCATE' and tg_table_name in ('thumbnail_media_revisions',card_table,'card_change_journal') then return null;end if;
  else
   before_row:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
   after_row:=case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end;
   allowed:=true;
   for item in select value from jsonb_array_elements(jsonb_build_array(before_row,after_row)) where value<>'null'::jsonb loop
    if tg_table_name='thumbnail_media_revisions' then
     allowed:=allowed and item->>'surface'=context.scope->>'surface' and item->>'client'=context.scope->>'client' and item->>'source_id'=context.scope->>'sourceId';
    elsif tg_table_name=card_table then
     allowed:=allowed and item->>'client'=context.scope->>'client' and item->>'id'=context.scope->>'sourceId' and tg_op='UPDATE';
    elsif tg_table_name='card_change_journal' and tg_op='INSERT' then
     allowed:=allowed and item->>'relation_name'=card_table and item->>'client_after'=context.scope->>'client' and item->'entity_key_after'->>'id'=context.scope->>'sourceId' and item->'entity_key_after'->>'client'=context.scope->>'client';
    else allowed:=false;end if;
   end loop;
  end if;
 end if;
 if not coalesce(allowed,false) then raise exception 'application_dml_admission_closed_or_scope_refused:%',tg_table_name;end if;
 if context.kind='followup' then
  update public.card_write_transaction_context_v1 set effect_count=effect_count+1,effect_hashes=effect_hashes||jsonb_build_array(jsonb_build_object('table',tg_table_name,'operation',tg_op,'row_id',coalesce(after_row->>'id',before_row->>'id'),'sha256',encode(extensions.digest(convert_to(jsonb_build_array(before_row,after_row)::text,'UTF8'),'sha256'),'hex'))) where transaction_id=context.transaction_id;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $fn$;
create function public.production_provider_create_autolinks_v1(p_text text)
returns text language plpgsql immutable set search_path=pg_catalog as $auto$
declare item text[];result text:=p_text;
begin
 for item in select regexp_matches(p_text,$regex$\[([^\]\n]+)\]\(<([^>\n]+)>\)$regex$,'g') loop
  if item[1]=item[2] then result:=replace(result,'['||item[1]||'](<'||item[2]||'>)',item[1]);end if;
 end loop;
 return result;
end $auto$;
revoke all on function public.production_provider_create_autolinks_v1(text) from public,anon,authenticated,service_role;
create function public.production_provider_create_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;d public.deliverables%rowtype;linked public.deliverables%rowtype;ctx jsonb;initial jsonb;payload jsonb;issue jsonb;input jsonb;expected jsonb;receipt jsonb;after_row jsonb;next_d jsonb;event_row jsonb;later_pending boolean;pid text; k text; expected_value text; actual_value text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_create_recovery_gate';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_create_recovery_stops';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_create_recovery_preimage';end if;
 if a.admission_preimage_v1 is null or a.receipt_context_v1 is null then raise exception 'provider_create_recovery_context';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_create_original_intent_changed';end if;
 if a.state not in ('acknowledged','completed') or a.request->>'kind' is distinct from 'issueCreate' or o.entity is distinct from 'deliverable' or o.operation is distinct from 'create' or a.provider_response->'issueCreate'->'success' is distinct from 'true'::jsonb or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_create_recovery_evidence';end if;
 ctx:=a.receipt_context_v1->'context';initial:=ctx->'entity';payload:=o.payload;issue:=a.provider_response->'issueCreate'->'issue';input:=a.request->'variables'->'input';pid:=payload->>'planned_linear_issue_id';
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
 receipt:=jsonb_build_object('mutation','issueCreate','issue_id',pid,'identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'updated_at',public.production_provider_receipt_clean_v1(case when issue->'updatedAt' is null or issue->'updatedAt' in ('null'::jsonb,'""'::jsonb) then issue->'createdAt' else issue->'updatedAt' end),'comment_id',null,'attachment_id',null,'attachment_url',null,'attachment_revision',null,'mirror_actor_id',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'id'),'mirror_actor_name',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'name'),'expected',a.request->'variables','create_verification',jsonb_build_object('decision','already_exists','reason','linear_issue_already_exists_exact'));
 if o.linear_result is not null and o.linear_result is distinct from receipt then raise exception 'provider_create_checkpoint_conflict';end if;
 if a.state='completed' then
  if d.linear_identifier is distinct from nullif(btrim(issue->>'identifier'),'') or d.linear_issue_url is distinct from nullif(btrim(issue->>'url'),'') then raise exception 'provider_create_completed_linkage';end if;
  return public.production_provider_send_complete_v1(a.attempt_id,a.lock_token,receipt);
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
 return public.production_provider_send_complete_v1(a.attempt_id,a.lock_token,receipt)||jsonb_build_object('linkage_only',true,'provider_resent',false);
end
$recover$;
revoke all on function public.production_provider_create_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_create_recover_v1(uuid,uuid,jsonb) to service_role;
commit;
