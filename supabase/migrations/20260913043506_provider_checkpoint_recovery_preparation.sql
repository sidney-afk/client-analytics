-- Preparation only: recover an acknowledged provider send with an existing exact
-- local checkpoint. No provider invocation, retry, or inferred success.
begin;
-- Version 1 admission snapshot: existing attempts retain NULL and cannot be
-- retroactively promoted into evidence. Original published owner is unchanged.
alter table linear_exit_provider.send_attempts_v1 add column admission_preimage_v1 jsonb check(admission_preimage_v1 is null or jsonb_typeof(admission_preimage_v1)='object');
create function linear_exit_provider.immutable_admission_preimage_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $immutable$
begin
 if new.admission_preimage_v1 is distinct from old.admission_preimage_v1 then raise exception 'provider_admission_preimage_immutable';end if;
 return new;
end
$immutable$;
revoke all on function linear_exit_provider.immutable_admission_preimage_v1() from public,anon,authenticated,service_role;
create trigger provider_admission_preimage_immutable_v1 before update on linear_exit_provider.send_attempts_v1 for each row execute function linear_exit_provider.immutable_admission_preimage_v1();
create or replace function public.production_provider_send_admit_v1(p_epoch uuid,p_outbox_id bigint,p_lock_token text,p_request jsonb,p_replay_scope jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare gate public.card_write_admission_v1%rowtype; o public.mirror_outbox%rowtype; a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'open' then raise exception 'provider_send_admission_closed';end if;
 if p_outbox_id is null or nullif(p_lock_token,'') is null or jsonb_typeof(p_request) is distinct from 'object'
 or (select array_agg(k order by k) from jsonb_object_keys(p_request) k) is distinct from array['kind','query','variables']::text[]
 or jsonb_typeof(p_request->'kind') is distinct from 'string' or jsonb_typeof(p_request->'query') is distinct from 'string'
 or jsonb_typeof(p_request->'variables') is distinct from 'object' or length(p_request->>'query') not between 1 and 262144
 or p_request->>'kind' not in ('issueCreate','issueUpdate','commentCreate','commentUpdate','commentDelete','attachmentCreate','issueArchive','issueUnarchive')
 then raise exception 'provider_send_request_shape';end if;
 -- Real replay support needs its own closed-gate authorization owner. Never infer it here.
 if p_replay_scope is not null and p_replay_scope<>'null'::jsonb then raise exception 'provider_send_replay_not_prepared';end if;
 select * into strict o from public.mirror_outbox where id=p_outbox_id for update;
 if o.lock_token::text is distinct from p_lock_token or o.locked_at is null or lower(o.team) not in ('video','graphics')
 or o.status not in ('pending','failed','shadow_ok') then raise exception 'provider_send_outbox_binding';end if;
 -- A new lock token or retry cannot authorize a second uncertain external send.
 if exists(select from linear_exit_provider.send_attempts_v1 where outbox_id=p_outbox_id) then raise exception 'provider_send_existing_attempt_requires_reconciliation';end if;
 insert into linear_exit_provider.send_attempts_v1(epoch,outbox_id,team,lock_token,request,request_sha256,replay_scope,admission_preimage_v1)
 values(gate.epoch,o.id,lower(o.team),p_lock_token,p_request,encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex'),p_replay_scope,to_jsonb(o)) returning * into a;
 return jsonb_build_object('attempt_id',a.attempt_id,'epoch',a.epoch,'outbox_id',a.outbox_id::text,'request_sha256',a.request_sha256);
end $fn$;
alter table public.card_write_transaction_context_v1 drop constraint card_write_transaction_context_v1_kind_check;
alter table public.card_write_transaction_context_v1 add constraint card_write_transaction_context_v1_kind_check check(kind in ('flag_control','followup','provider_disposition','provider_snapshot','provider_recovery'));
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
   if tg_table_name='mirror_outbox' and tg_op='UPDATE' then return null;end if;
  elsif tg_table_name='mirror_outbox' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'before' and to_jsonb(new)=context.scope->'after';
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

create function public.production_provider_checkpoint_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare gate public.card_write_admission_v1%rowtype; a linear_exit_provider.send_attempts_v1%rowtype; o public.mirror_outbox%rowtype; after_row jsonb; result jsonb; kind text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_recovery_gate';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_recovery_stops';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_recovery_preimage';end if;
 if a.admission_preimage_v1 is null then raise exception 'provider_recovery_legacy_admission_unproven';end if;
 -- Only the existing handler's checkpoint/release bookkeeping may differ.
 -- Identity, entity, team, operation, actor, payload and all other columns bind.
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status'])
 or a.admission_preimage_v1->>'lock_token' is distinct from a.lock_token
 then raise exception 'provider_recovery_original_intent_changed';end if;
 kind:=a.request->>'kind';
 if a.state not in ('acknowledged','completed') or kind not in ('issueUpdate','issueArchive','issueUnarchive','attachmentCreate') then raise exception 'provider_recovery_observation_or_linkage_required';end if;
 if a.replay_scope is not null and a.replay_scope<>'null'::jsonb then raise exception 'provider_recovery_replay_not_prepared';end if;
 if lower(o.team) is distinct from a.team or o.entity not in ('batch','deliverable') or o.operation not in ('status','due','assignee','title','priority','parent','labels','description','archive','restore','attachment') then raise exception 'provider_recovery_scope';end if;
 if (kind='issueArchive' and o.operation<>'archive') or (kind='issueUnarchive' and o.operation<>'restore') or (kind='attachmentCreate' and o.operation<>'attachment') or (kind='issueUpdate' and o.operation in ('archive','restore','attachment')) then raise exception 'provider_recovery_scope';end if;
 if jsonb_typeof(o.linear_result) is distinct from 'object' or o.linear_result->>'mutation' is distinct from kind or o.linear_result->'expected' is distinct from a.request->'variables' or a.provider_response->kind->'success' is distinct from 'true'::jsonb then raise exception 'provider_recovery_exact_checkpoint_required';end if;
 if o.linear_result ?| array['native','native_receipt','no_external_call','f27','f27_replay','recovered_idempotently','conflict'] then raise exception 'provider_recovery_unknown_receipt';end if;
 if o.status='written' and o.lock_token is null and o.locked_at is null then
  return public.production_provider_send_complete_v1(a.attempt_id,a.lock_token,o.linear_result);
 end if;
 if a.state='completed' or o.status not in ('pending','failed','shadow_ok') or o.lock_token::text is distinct from a.lock_token or o.locked_at is null then raise exception 'provider_recovery_lock_changed';end if;
 after_row:=to_jsonb(o)||jsonb_build_object('status','written','processed_at',now(),'linear_result',o.linear_result,'last_error',null,'next_retry_at',null,'attempts',coalesce(o.attempts,0)+1,'lock_token',null,'locked_at',null,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set status='written',processed_at=now(),last_error=null,next_retry_at=null,attempts=coalesce(o.attempts,0)+1,lock_token=null,locked_at=null,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 result:=public.production_provider_send_complete_v1(a.attempt_id,a.lock_token,o.linear_result);
 return result||jsonb_build_object('recovered_local_checkpoint',true,'provider_resent',false);
end $recover$;
revoke all on function public.production_provider_checkpoint_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_checkpoint_recover_v1(uuid,uuid,jsonb) to service_role;
commit;
