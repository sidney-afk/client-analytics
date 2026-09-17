-- Preparation only: exact existing F27 disposition, never a provider success receipt.
-- External replay/ambiguous workers remain unresolved; this owner cannot activate retirement.
begin;
alter table public.card_write_transaction_context_v1 drop constraint card_write_transaction_context_v1_kind_check;
alter table public.card_write_transaction_context_v1 add constraint card_write_transaction_context_v1_kind_check check(kind in ('flag_control','followup','provider_disposition'));
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
create function public.production_provider_debt_disposition_v1(p_epoch uuid,p_rollback_id uuid,p_outbox_id bigint,p_expected_outbox jsonb,p_expected_intent jsonb,p_classification text,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype; r public.track_b_team_rollbacks%rowtype; o public.mirror_outbox%rowtype; i public.track_b_team_rollback_intents%rowtype; result jsonb; prior_bypass text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' or p_classification is null or p_classification not in ('discard','quarantine') or nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null or p_actor<>btrim(p_actor) or p_reason<>btrim(p_reason) then raise exception 'provider_disposition_control_refused';end if;
 lock table public.mirror_outbox in row exclusive mode;
 select * into strict r from public.track_b_team_rollbacks where id=p_rollback_id for update;
 select * into strict i from public.track_b_team_rollback_intents where rollback_id=p_rollback_id and outbox_id=p_outbox_id for update;
 select * into strict o from public.mirror_outbox where id=p_outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox or to_jsonb(i) is distinct from p_expected_intent then raise exception 'provider_disposition_preimage';end if;
 if r.is_drill or r.state<>'open' or coalesce(o.entity,'') not in ('deliverable','batch','comment') or coalesce(o.operation,'') not in ('create','status','comment','due','assignee','title','priority','parent','archive','restore','labels','description','attachment') or lower(o.team) is distinct from r.team or o.status<>'skipped' or o.lock_token is not null or o.locked_at is not null or o.linear_result is not null or i.terminal_receipt is not null or i.classification is not null then raise exception 'provider_disposition_owner_state';end if;
 if i.row_sha256 is distinct from encode(extensions.digest(convert_to(i.row_snapshot::text,'UTF8'),'sha256'),'hex') or i.row_snapshot->>'id' is distinct from o.id::text or coalesce(i.row_snapshot->>'status','') not in ('pending','failed','shadow_ok') then raise exception 'provider_disposition_snapshot';end if;
 -- A shape claiming any native/drill origin is not ordinary provider debt.
 if coalesce(public.production_syncview_retirement_typed_native_receipt(o),false) or coalesce(public.production_syncview_retirement_f27_drill_receipt(o),false)
  or jsonb_typeof(o.payload) is distinct from 'object'
  or exists(select from jsonb_object_keys(o.payload) k where lower(k) like '%native%' or lower(k) like '%drill%')
  or jsonb_typeof(i.row_snapshot->'payload') is distinct from 'object'
  or exists(select from jsonb_object_keys(i.row_snapshot->'payload') k where lower(k) like '%native%' or lower(k) like '%drill%')
  or i.row_snapshot->'linear_result' is distinct from 'null'::jsonb then raise exception 'provider_disposition_native_or_unknown';end if;
 if (to_jsonb(o)-array['status','last_error','next_retry_at','updated_at']) is distinct from (i.row_snapshot-array['status','last_error','next_retry_at','updated_at']) then raise exception 'provider_disposition_changed_since_hold';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_disposition_stops_required';end if;
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_disposition',jsonb_build_object('outbox',to_jsonb(o),'intent',to_jsonb(i),'classification',p_classification,'actor',p_actor,'reason',p_reason));
 prior_bypass:=current_setting('app.f27_rollback_bypass',true);
 result:=public.track_b_f27_classify(p_rollback_id,p_outbox_id,p_classification,p_reason,p_actor,null);
 perform set_config('app.f27_rollback_bypass',coalesce(prior_bypass,''),true);
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 update public.card_write_admission_v1 set control_history=control_history||jsonb_build_array(jsonb_build_object('action','provider_disposition','epoch',p_epoch,'rollback_id',p_rollback_id,'outbox_id',p_outbox_id,'snapshot_sha256',i.row_sha256,'preimage_sha256',encode(extensions.digest(convert_to(p_expected_outbox::text,'UTF8'),'sha256'),'hex'),'classification',p_classification,'actor',p_actor,'reason',p_reason,'provider_success_proven',false,'external_worker_fenced',false,'at',clock_timestamp())) where singleton;
 return result||jsonb_build_object('epoch',p_epoch,'provider_success_proven',false,'external_worker_fenced',false,'retirement_activated',false);
end $fn$;
revoke all on function public.production_provider_debt_disposition_v1(uuid,uuid,bigint,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.production_provider_debt_disposition_v1(uuid,uuid,bigint,jsonb,jsonb,text,text,text) to service_role;
commit;