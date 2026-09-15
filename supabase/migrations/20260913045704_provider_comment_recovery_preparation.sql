-- Preparation only: source-owned canonical comment binding and exact audit.
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
   if (tg_table_name='mirror_outbox' and tg_op='UPDATE') or (tg_table_name='production_comments' and tg_op='UPDATE' and context.scope ? 'comment_before') or (tg_table_name='deliverable_events' and tg_op='INSERT' and context.scope ? 'comment_event') or (tg_table_name='card_change_journal' and tg_op='INSERT' and context.scope ? 'comment_before') then return null;end if;
  elsif tg_table_name='mirror_outbox' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'before' and to_jsonb(new)=context.scope->'after';
  elsif tg_table_name='production_comments' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'comment_before' and to_jsonb(new)=context.scope->'comment_after';
  elsif tg_table_name='card_change_journal' and tg_op='INSERT' then
   after_row:=to_jsonb(new);
   allowed:=after_row->>'relation_schema'='public' and after_row->>'relation_name'='production_comments' and after_row->>'operation'='UPDATE'
    and jsonb_populate_record(null::public.production_comments,after_row->'row_before') is not distinct from jsonb_populate_record(null::public.production_comments,context.scope->'comment_before') and jsonb_populate_record(null::public.production_comments,after_row->'row_after') is not distinct from jsonb_populate_record(null::public.production_comments,context.scope->'comment_after')
    and after_row->'entity_key_before'=jsonb_build_object('id',context.scope->'comment_before'->'id') and after_row->'entity_key_after'=jsonb_build_object('id',context.scope->'comment_after'->'id')
    and after_row->>'client_before'=context.scope->'comment_before'->>'client_slug' and after_row->>'client_after'=context.scope->'comment_after'->>'client_slug'
    and after_row->>'transaction_id'=txid_current()::text;
  elsif tg_table_name='deliverable_events' and tg_op='INSERT' then
   allowed:=(to_jsonb(new)-'id')=context.scope->'comment_event';
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
create function public.production_provider_comment_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare gate public.card_write_admission_v1%rowtype; a linear_exit_provider.send_attempts_v1%rowtype; o public.mirror_outbox%rowtype; native_comment public.production_comments%rowtype; bound public.production_comments%rowtype; kind text; cid text; pid text; result_comment jsonb; result_issue jsonb; receipt jsonb; next_comment jsonb; event_row jsonb; event_payload jsonb; event_key text; event_batch text; after_row jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_comment_recovery_gate';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_comment_recovery_stops';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_comment_recovery_preimage';end if;
 if a.admission_preimage_v1 is null or a.receipt_context_v1 is null then raise exception 'provider_comment_recovery_context';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_comment_original_intent_changed';end if;
 kind:=a.request->>'kind';cid:=o.comment_id;
 if a.state not in ('acknowledged','completed') or kind not in ('commentCreate','commentUpdate','commentDelete') or o.entity<>'comment' or o.operation<>'comment' or nullif(cid,'') is null or o.payload->>'comment_id' is distinct from cid or a.provider_response->kind->'success' is distinct from 'true'::jsonb or a.replay_scope not in ('null'::jsonb) then raise exception 'provider_comment_recovery_evidence';end if;
 select * into strict native_comment from public.production_comments where id=cid for update;
 if native_comment.client_slug is distinct from o.client_slug or native_comment.team is distinct from o.team or native_comment.deliverable_id is distinct from o.deliverable_id or native_comment.batch_id is distinct from o.batch_id then raise exception 'provider_comment_native_target';end if;
 if kind='commentDelete' then
  pid:=a.request->'variables'->>'id';
  if nullif(pid,'') is null or native_comment.linear_comment_id is distinct from pid or a.admission_preimage_v1->'linear_result'->>'mutation' is distinct from 'commentDelete' or a.admission_preimage_v1->'linear_result'->'delete_attempted' is distinct from 'true'::jsonb or a.admission_preimage_v1->'linear_result'->>'comment_id' is distinct from pid or a.admission_preimage_v1->'linear_result'->'expected' is distinct from a.request->'variables' then raise exception 'provider_comment_delete_attempt_proof';end if;
  result_comment:='{}'::jsonb;result_issue:='{}'::jsonb;
 else
  result_comment:=a.provider_response->kind->'comment';result_issue:=result_comment->'issue';pid:=public.production_provider_receipt_clean_v1(result_comment->'id');
  if jsonb_typeof(result_comment) is distinct from 'object' or nullif(pid,'') is null or (kind='commentUpdate' and a.request->'variables'->>'id' is distinct from pid) or (kind='commentCreate' and result_issue->>'id' is distinct from a.request->'variables'->'input'->>'issueId') then raise exception 'provider_comment_provider_identity';end if;
 end if;
 receipt:=jsonb_build_object('mutation',kind,'issue_id',coalesce(nullif(public.production_provider_receipt_clean_v1(result_issue->'id'),''),a.receipt_context_v1->>'issueId'),'identifier',public.production_provider_receipt_clean_v1(result_issue->'identifier'),'updated_at',public.production_provider_receipt_clean_v1(case when result_issue->'updatedAt' is null or result_issue->'updatedAt' in ('null'::jsonb,'""'::jsonb) then result_comment->'createdAt' else result_issue->'updatedAt' end),'comment_id',pid,'attachment_id',null,'attachment_url',null,'attachment_revision',null,'mirror_actor_id',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'id'),'mirror_actor_name',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'name'),'expected',a.request->'variables');
 if kind='commentDelete' then receipt:=receipt||jsonb_build_object('delete_attempted',true,'delete_applied',true);end if;
 if a.state='completed' then
  if o.linear_result is distinct from receipt or native_comment.linear_comment_id is distinct from pid then raise exception 'provider_comment_completed_conflict';end if;
  return public.production_provider_send_complete_v1(a.attempt_id,a.lock_token,receipt);
 end if;
 if o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') then raise exception 'provider_comment_recovery_lock';end if;
 if o.linear_result is not null and o.linear_result is distinct from receipt and not(kind='commentDelete' and o.linear_result=a.admission_preimage_v1->'linear_result') then raise exception 'provider_comment_checkpoint_conflict';end if;
 if o.linear_result is distinct from receipt then
  after_row:=to_jsonb(o)||jsonb_build_object('linear_result',receipt,'updated_at',now());
  insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
  update public.mirror_outbox set linear_result=receipt,updated_at=now() where id=o.id;
  delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 end if;
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
 after_row:=to_jsonb(o)||jsonb_build_object('status','written','processed_at',now(),'last_error',null,'next_retry_at',null,'attempts',coalesce(o.attempts,0)+1,'lock_token',null,'locked_at',null,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set status='written',processed_at=now(),last_error=null,next_retry_at=null,attempts=coalesce(o.attempts,0)+1,lock_token=null,locked_at=null,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 return public.production_provider_send_complete_v1(a.attempt_id,a.lock_token,receipt)||jsonb_build_object('canonical_comment_preserved',true,'provider_resent',false);
end
$recover$;
revoke all on function public.production_provider_comment_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_comment_recover_v1(uuid,uuid,jsonb) to service_role;
commit;
