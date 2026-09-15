-- Preparation only: original recorded comment read observations; no provider resend.
begin;
create or replace function public.production_provider_send_ack_v1(p_attempt_id uuid,p_lock_token text,p_request jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 if a.lock_token is distinct from p_lock_token or a.request is distinct from p_request or jsonb_typeof(p_response) is distinct from 'object' then raise exception 'provider_send_ack_binding';end if;
 if a.provider_response->>'format' in ('provider-create-read-observations-v1','provider-comment-read-observations-v1') then raise exception 'provider_send_ack_observation_requires_reconciliation';end if;
 if a.state<>'admitted' then
  if a.provider_response is distinct from p_response then raise exception 'provider_send_ack_conflict';end if;
 else
  update linear_exit_provider.send_attempts_v1 set state='acknowledged',provider_response=p_response,acknowledged_at=clock_timestamp() where attempt_id=a.attempt_id;
 end if;
 return jsonb_build_object('acknowledged',true,'completed',false);
end $fn$;


create function public.production_provider_comment_marker_v1(body text) returns text language sql immutable set search_path=pg_catalog,public as $marker$ select public.production_provider_receipt_clean_v1(to_jsonb((regexp_match(coalesce(body,''),'<!--['||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)||']*syncview-mirror:([^>]+?)['||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)||']*-->','i'))[1])) $marker$;
revoke all on function public.production_provider_comment_marker_v1(text) from public,anon,authenticated,service_role;
create function public.production_provider_comment_observe_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb,p_expected_observation jsonb,p_query text,p_variables jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $observe$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;history jsonb;last_observation jsonb;round_id integer;page_id integer;query_kind text;issue_id text;expected_variables jsonb;envelope jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.mode<>'closed' or gate.epoch is distinct from p_epoch then raise exception 'provider_comment_observe_gate';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox or a.provider_response is distinct from p_expected_observation then raise exception 'provider_comment_observe_cas';end if;
 if a.state<>'admitted' or a.admission_preimage_v1 is null or a.receipt_context_v1 is null or a.request->>'kind' not in ('commentCreate','commentUpdate','commentDelete') or o.entity is distinct from 'comment' or o.operation is distinct from 'comment' or o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_comment_observe_attempt';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_comment_observe_original_intent_changed';end if;
 issue_id:=a.receipt_context_v1->>'issueId';if nullif(issue_id,'') is null or (a.request->>'kind'='commentCreate' and a.request->'variables'->'input'->>'issueId' is distinct from issue_id) then raise exception 'provider_comment_observe_issue';end if;
 if a.provider_response is null then history:='[]'::jsonb;
 elsif a.provider_response->>'format'='provider-comment-read-observations-v1' and a.provider_response->>'issue_id'=issue_id and jsonb_typeof(a.provider_response->'observations')='array' then history:=a.provider_response->'observations';
 else raise exception 'provider_comment_observe_existing_evidence';end if;
 last_observation:=history->-1;round_id:=coalesce((last_observation->>'round')::integer,0);page_id:=0;
 if p_query='query SyncViewMirrorIssue($id: String!) { issue(id: $id) { id identifier title description url priority dueDate archivedAt updatedAt
state { id name type }
team { id key name states { nodes { id name type position } } }
project { id name }
assignee { id name email }
parent { id identifier title }
labelIds
labels(first: 100, includeArchived: true) { nodes { id name color description } pageInfo { hasNextPage } }
attachments(first: 100) { nodes { id url title subtitle } pageInfo { hasNextPage endCursor } }
comments(first: 100) { nodes { id body createdAt user { id name email } } } } }' then query_kind:='issue';expected_variables:=jsonb_build_object('id',issue_id);round_id:=round_id+1;
 elsif p_query='query SyncViewMirrorComment($id: String!) { comment(id: $id) { id body createdAt updatedAt issue { id identifier updatedAt } } }' and a.request->>'kind'='commentDelete' then
  query_kind:='comment';expected_variables:=jsonb_build_object('id',a.request->'variables'->'id');if last_observation->>'query_kind' is distinct from 'issue' then raise exception 'provider_comment_observe_round';end if;
 elsif p_query='query SyncViewMirrorIssueComments($id: String!, $after: String) { issue(id: $id) { comments(first: 100, after: $after) { nodes { id body createdAt updatedAt issue { id identifier updatedAt } } pageInfo { hasNextPage endCursor } } } }' and a.request->>'kind' in ('commentCreate','commentUpdate') then
  query_kind:='comments';
  if last_observation->>'query_kind'='issue' then expected_variables:=jsonb_build_object('id',issue_id,'after',null);page_id:=1;
  elsif last_observation->>'query_kind'='comments' then
   if last_observation->'response'->>'http_status' is distinct from '200' or last_observation->'response'->'body' ? 'errors' or last_observation->'response'->'body'->'data'->'issue'->'comments'->'pageInfo'->'hasNextPage' is distinct from 'true'::jsonb or nullif(last_observation->'response'->'body'->'data'->'issue'->'comments'->'pageInfo'->>'endCursor','') is null then raise exception 'provider_comment_observe_pagination';end if;
   expected_variables:=jsonb_build_object('id',issue_id,'after',last_observation->'response'->'body'->'data'->'issue'->'comments'->'pageInfo'->'endCursor');page_id:=(last_observation->>'page')::integer+1;
   if page_id>50 or exists(select from jsonb_array_elements(history) x where x->>'round'=round_id::text and x->'variables'->'after'=expected_variables->'after') then raise exception 'provider_comment_observe_pagination_bound';end if;
  else raise exception 'provider_comment_observe_round';end if;
 else raise exception 'provider_comment_observe_query';end if;
 if p_variables is distinct from expected_variables then raise exception 'provider_comment_observe_variables';end if;
 if jsonb_typeof(p_response) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(p_response)key) is distinct from array['body','http_status']::text[] or jsonb_typeof(p_response->'http_status') is distinct from 'number' or (p_response->>'http_status')::numeric not between 100 and 599 or trunc((p_response->>'http_status')::numeric)<>(p_response->>'http_status')::numeric or jsonb_typeof(p_response->'body') is distinct from 'object' or octet_length(p_response::text)>1048576 then raise exception 'provider_comment_observe_response';end if;
 if jsonb_array_length(history)>=128 or octet_length(history::text)+octet_length(p_response::text)>16777216 then raise exception 'provider_comment_observe_history_bound';end if;
 envelope:=jsonb_build_object('format','provider-comment-read-observations-v1','issue_id',issue_id,'observations',history||jsonb_build_array(jsonb_build_object('sequence',jsonb_array_length(history)+1,'round',round_id,'page',page_id,'query_kind',query_kind,'query_sha256',encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex'),'variables',p_variables,'recorded_at',clock_timestamp(),'response',p_response)));
 update linear_exit_provider.send_attempts_v1 set provider_response=envelope where attempt_id=a.attempt_id;
 return jsonb_build_object('recorded',true,'observation',envelope,'mutation_acknowledged',false,'provider_resent',false);
end $observe$;

create function public.production_provider_comment_observed_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;native_comment public.production_comments%rowtype;bound public.production_comments%rowtype;history jsonb;last_observation jsonb;issue_observation jsonb;issue jsonb;comment_row jsonb;round_id text;pid text;cid text;kind text;matches integer;receipt jsonb;compact jsonb;labels jsonb;next_comment jsonb;event_row jsonb;event_payload jsonb;event_key text;event_batch text;after_row jsonb;absent boolean;detail text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_comment_observed_gate';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_comment_observed_stops';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_comment_observed_cas';end if;
 if a.admission_preimage_v1 is null or a.receipt_context_v1 is null or a.state not in ('admitted','completed') or a.provider_response->>'format' is distinct from 'provider-comment-read-observations-v1' or jsonb_typeof(a.provider_response->'observations') is distinct from 'array' or o.entity is distinct from 'comment' or o.operation is distinct from 'comment' or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_comment_observed_evidence';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_comment_observed_original_intent';end if;
 kind:=a.request->>'kind';cid:=o.comment_id;
 if kind not in ('commentCreate','commentUpdate','commentDelete') or nullif(cid,'') is null or o.payload->>'comment_id' is distinct from cid then raise exception 'provider_comment_observed_scope';end if;
 select * into strict native_comment from public.production_comments where id=cid for update;
 if native_comment.client_slug is distinct from o.client_slug or native_comment.team is distinct from o.team or native_comment.deliverable_id is distinct from o.deliverable_id or native_comment.batch_id is distinct from o.batch_id then raise exception 'provider_comment_observed_native_target';end if;
 history:=a.provider_response->'observations';last_observation:=history->-1;round_id:=last_observation->>'round';
 select x into issue_observation from jsonb_array_elements(history) x where x->>'round'=round_id and x->>'query_kind'='issue';
 issue:=issue_observation->'response'->'body'->'data'->'issue';
 if issue_observation->'response'->>'http_status' is distinct from '200' or issue_observation->'response'->'body'?'errors' or jsonb_typeof(issue) is distinct from 'object' or issue->>'id' is distinct from a.receipt_context_v1->>'issueId' or issue->>'id' is distinct from a.provider_response->>'issue_id' then raise exception 'provider_comment_observed_issue';end if;
 if not exists(select from public.deliverables d where d.id=o.entity_id and d.client_slug=o.client_slug and d.team=o.team and d.linear_issue_uuid=issue->>'id') then raise exception 'provider_comment_observed_linkage';end if;
 if kind='commentDelete' then
  pid:=a.request->'variables'->>'id';
  if nullif(pid,'') is null or native_comment.linear_comment_id is distinct from pid or a.admission_preimage_v1->'linear_result'->>'mutation' is distinct from 'commentDelete' or a.admission_preimage_v1->'linear_result'->'delete_attempted' is distinct from 'true'::jsonb or a.admission_preimage_v1->'linear_result'->>'comment_id' is distinct from pid or a.admission_preimage_v1->'linear_result'->'expected' is distinct from a.request->'variables' then raise exception 'provider_comment_observed_delete_proof';end if;
  if last_observation->>'query_kind' is distinct from 'comment' or last_observation->'variables' is distinct from jsonb_build_object('id',pid) then raise exception 'provider_comment_observed_delete_query';end if;
  absent:=last_observation->'response'->>'http_status'='200' and not(last_observation->'response'->'body'?'errors') and last_observation->'response'->'body'->'data'->'comment'='null'::jsonb;
  -- Source allowMissing recognizes only its sanitized first provider error detail.
  detail:=left(regexp_replace(concat_ws(': ',nullif(coalesce(last_observation->'response'->'body'->'errors'->0->'extensions'->>'type',last_observation->'response'->'body'->'errors'->0->'extensions'->>'code'),''),nullif(last_observation->'response'->'body'->'errors'->0->>'message','')),'[^a-zA-Z0-9 _.:/-]','','g'),240);
  absent:=coalesce(absent,false) or (last_observation->'response'->>'http_status' in ('200','400','404') and jsonb_typeof(last_observation->'response'->'body'->'errors')='array' and detail ~* '\m(entity|comment|resource) not found\M');
  if not coalesce(absent,false) then raise exception 'provider_comment_observed_delete_unresolved';end if;
  receipt:=jsonb_build_object('decision','already_applied','reason','comment_delete_attempt_receipt','comment_id',pid);
 else
  if last_observation->>'query_kind' is distinct from 'comments' then raise exception 'provider_comment_observed_marker_query';end if;
  if exists(select from jsonb_array_elements(history) x where x->>'round'=round_id and x->>'query_kind'='comments' and (x->'response'->>'http_status' is distinct from '200' or x->'response'->'body'?'errors' or jsonb_typeof(x->'response'->'body'->'data'->'issue'->'comments'->'nodes') is distinct from 'array')) then raise exception 'provider_comment_observed_marker_response';end if;
  select count(*) into matches from jsonb_array_elements(history) x cross join lateral jsonb_array_elements(case when x->>'query_kind'='comments' and jsonb_typeof(x->'response'->'body'->'data'->'issue'->'comments'->'nodes')='array' then x->'response'->'body'->'data'->'issue'->'comments'->'nodes' else '[]' end) n where x->>'round'=round_id and jsonb_typeof(n->'body')='string' and public.production_provider_comment_marker_v1(n->>'body')=public.production_provider_receipt_clean_v1(to_jsonb(o.dedup_key));
  if matches<>1 then raise exception 'provider_comment_observed_marker_unresolved';end if;
  select n into comment_row from jsonb_array_elements(history) x cross join lateral jsonb_array_elements(case when x->>'query_kind'='comments' and jsonb_typeof(x->'response'->'body'->'data'->'issue'->'comments'->'nodes')='array' then x->'response'->'body'->'data'->'issue'->'comments'->'nodes' else '[]' end) n where x->>'round'=round_id and jsonb_typeof(n->'body')='string' and public.production_provider_comment_marker_v1(n->>'body')=public.production_provider_receipt_clean_v1(to_jsonb(o.dedup_key));
  pid:=public.production_provider_receipt_clean_v1(comment_row->'id');
  if pid='' or comment_row->'issue'->>'id' is distinct from issue->>'id' or (kind='commentUpdate' and a.request->'variables'->>'id' is distinct from pid) or (kind='commentCreate' and a.request->'variables'->'input'->>'issueId' is distinct from issue->>'id') then raise exception 'provider_comment_observed_marker_identity';end if;
  receipt:=jsonb_build_object('decision','already_applied','reason','comment_marker_receipt','comment_id',pid);
 end if;
 labels:=case when jsonb_typeof(issue->'labelIds')='array' then issue->'labelIds' else coalesce((select jsonb_agg(x->'id') from jsonb_array_elements(case when jsonb_typeof(issue->'labels')='array' then issue->'labels' when jsonb_typeof(issue->'labels'->'nodes')='array' then issue->'labels'->'nodes' else '[]' end)x),'[]') end;
 compact:=jsonb_build_object('id',public.production_provider_receipt_clean_v1(issue->'id'),'identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'description',case when jsonb_typeof(issue->'description')='string' then issue->'description' else 'null'::jsonb end,'updated_at',public.production_provider_receipt_clean_v1(issue->'updatedAt'),'state_id',public.production_provider_receipt_clean_v1(issue->'state'->'id'),'due_date',nullif(public.production_provider_receipt_clean_v1(issue->'dueDate'),''),'assignee_id',nullif(public.production_provider_receipt_clean_v1(issue->'assignee'->'id'),''),'parent_id',nullif(public.production_provider_receipt_clean_v1(issue->'parent'->'id'),''),'label_ids',(select coalesce(jsonb_agg(v order by v),'[]') from(select distinct public.production_provider_receipt_clean_v1(value) v from jsonb_array_elements(labels))x where v<>''),'archived',issue->'archivedAt' is not null and issue->'archivedAt' not in ('null','false','0','""'));
 receipt:=coalesce(nullif(a.admission_preimage_v1->'linear_result','null'::jsonb),'{}'::jsonb)||jsonb_build_object('conflict',receipt,'issue',compact,'comment_id',pid,'recovered_idempotently',true)||case when kind='commentDelete' then '{"delete_applied":true}'::jsonb else '{}'::jsonb end;
 if a.state='completed' then
  if o.status is distinct from 'skipped' or o.lock_token is not null or o.linear_result is distinct from receipt or a.local_receipt is distinct from receipt or native_comment.linear_comment_id is distinct from pid then raise exception 'provider_comment_observed_completed_conflict';end if;
  return jsonb_build_object('completed',true,'provider_resent',false,'replayed_receipt',true);
 end if;
 if o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') then raise exception 'provider_comment_observed_lock';end if;
 if o.linear_result is not null and o.linear_result is distinct from a.admission_preimage_v1->'linear_result' then raise exception 'provider_comment_observed_checkpoint_conflict';end if;
 if kind<>'commentDelete' then
  if native_comment.linear_comment_id is not null and native_comment.linear_comment_id is distinct from pid then raise exception 'provider_comment_binding_conflict';end if;
  next_comment:=to_jsonb(native_comment)||jsonb_build_object('linear_comment_id',pid,'transport_actor','SyncView Mirror','transport_role','system','version',native_comment.version+1,'updated_at',now());
  event_key:='production-comment:'||cid||':v'||(native_comment.version+1)::text||':comment_link_linear';
  event_batch:=native_comment.batch_id;if native_comment.deliverable_id is not null then select batch_id into event_batch from public.deliverables where id=native_comment.deliverable_id;end if;
  event_payload:=jsonb_build_object('source','outbound','actor','SyncView Mirror','role','system','outbox_id',o.id,'event_key',event_key,'comment',next_comment,'transport',jsonb_build_object('actor','SyncView Mirror','role','system'));
  event_row:=to_jsonb(jsonb_populate_record(null::public.deliverable_events,jsonb_build_object('deliverable_id',native_comment.deliverable_id,'batch_id',event_batch,'client_slug',native_comment.client_slug,'ts',native_comment.source_updated_at,'actor',native_comment.author_name,'role',native_comment.role,'action','comment_link_linear','from_status',null,'to_status',null,'source',native_comment.source,'payload',event_payload,'event_key',event_key,'event_assignee_attribution','unknown')))-'id';
  insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('comment_before',to_jsonb(native_comment),'comment_after',next_comment,'comment_event',event_row));
  bound:=public.production_comment_bind_linear_id(cid,pid,o.id);
  delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
  if bound.linear_comment_id is distinct from pid then raise exception 'provider_comment_binding_failed';end if;
 end if;
 select * into strict o from public.mirror_outbox where id=o.id;
 after_row:=to_jsonb(o)||jsonb_build_object('status','skipped','linear_result',receipt,'processed_at',now(),'last_error',null,'next_retry_at',null,'attempts',coalesce(o.attempts,0)+1,'lock_token',null,'locked_at',null,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set status='skipped',linear_result=receipt,processed_at=now(),last_error=null,next_retry_at=null,attempts=coalesce(o.attempts,0)+1,lock_token=null,locked_at=null,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 update linear_exit_provider.send_attempts_v1 set state='completed',local_receipt=receipt,completed_at=clock_timestamp() where attempt_id=a.attempt_id;
 return jsonb_build_object('completed',true,'provider_resent',false,'canonical_comment_preserved',true,'mutation_acknowledged',false);
end $recover$;
revoke all on function public.production_provider_comment_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb),public.production_provider_comment_observed_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_comment_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb),public.production_provider_comment_observed_recover_v1(uuid,uuid,jsonb) to service_role;
create or replace function public.production_provider_terminal_eligible_v1(o public.mirror_outbox)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare gate public.card_write_admission_v1%rowtype; a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into gate from public.card_write_admission_v1 where singleton;
 if gate.mode not in ('closed','sealed') or o.lock_token is not null or o.locked_at is not null or o.next_retry_at is not null or o.processed_at is null then return false;end if;
 -- Composite arguments do not authorize invented row values.
 if not exists(select from public.mirror_outbox x where x.id=o.id and to_jsonb(x)=to_jsonb(o)) then return false;end if;
 select * into a from linear_exit_provider.send_attempts_v1 where outbox_id=o.id;
 if found then return coalesce(a.state='completed' and a.completed_at is not null and (o.status='written' or (o.status='skipped' and a.provider_response->>'format'='provider-comment-read-observations-v1' and a.request->>'kind' in ('commentCreate','commentUpdate','commentDelete') and o.linear_result->'conflict'->>'decision'='already_applied' and o.linear_result->'conflict'->>'reason' in ('comment_marker_receipt','comment_delete_attempt_receipt') and o.linear_result->'recovered_idempotently'='true'::jsonb)) and a.local_receipt=o.linear_result and a.admission_preimage_v1 is not null and lower(o.team)=a.team and (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status'])=(a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']),false);end if;
 if public.production_provider_legacy_written_shape_v1(o) then
  return exists(select from jsonb_array_elements(gate.control_history) h cross join lateral jsonb_array_elements(case when jsonb_typeof(h->'rows')='array' then h->'rows' else '[]' end) x where h->>'action'='provider_terminal_history' and h->>'epoch'=gate.epoch::text and h->>'source_sha256'='8b6823724bbeda49449fd584f5953e40c4f2c14428c66c3458d17471c06daaf4' and x->>'id'=o.id::text and x->>'sha256'=encode(extensions.digest(convert_to(to_jsonb(o)::text,'UTF8'),'sha256'),'hex'));
 end if;
 -- Only the exact source-owned discard removes work. Quarantine stays unresolved.
 return exists(select from public.track_b_team_rollback_intents i join public.track_b_team_rollbacks r on r.id=i.rollback_id cross join lateral jsonb_array_elements(gate.control_history) h
  where i.outbox_id=o.id and not r.is_drill and i.classification='discard' and i.terminal_receipt is null and o.status='skipped' and o.linear_result is null and o.last_error='F27 discard: '||i.reason
  and i.row_sha256=encode(extensions.digest(convert_to(i.row_snapshot::text,'UTF8'),'sha256'),'hex')
  and (to_jsonb(o)-array['status','last_error','next_retry_at','updated_at','processed_at'])=(i.row_snapshot-array['status','last_error','next_retry_at','updated_at','processed_at'])
  and h->>'action'='provider_disposition' and h->>'epoch'=gate.epoch::text and h->>'rollback_id'=r.id::text and h->>'outbox_id'=o.id::text and h->>'classification'='discard' and h->>'snapshot_sha256'=i.row_sha256 and h->>'actor'=i.classified_by and h->>'reason'=i.reason);
end $fn$;
commit;
