-- Exact closed-gate F27 snapshot owner. No provider invocation or worker-fence proof.
begin;
alter table public.card_write_transaction_context_v1 drop constraint card_write_transaction_context_v1_kind_check;
alter table public.card_write_transaction_context_v1 add constraint card_write_transaction_context_v1_kind_check check(kind in ('flag_control','followup','provider_disposition','provider_snapshot'));
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
create function public.production_provider_closed_snapshot_v1(p_epoch uuid,p_team text,p_expected_authority jsonb,p_expected_rows jsonb,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog set lock_timeout='5s' as $fn$
declare gate public.card_write_admission_v1%rowtype; rows jsonb; generation bigint; snapshot_hash text; result jsonb; prior_bypass text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' or p_team is null or p_team not in ('video','graphics') or nullif(btrim(p_actor),'') is null or p_actor<>btrim(p_actor) or nullif(btrim(p_reason),'') is null then raise exception 'provider_snapshot_control';end if;
 perform pg_advisory_xact_lock(hashtextextended('track-b-f27:'||p_team,0));
 lock table public.mirror_outbox in share row exclusive mode;
 select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]'::jsonb) into rows from public.mirror_outbox o where lower(team)=p_team and status in ('pending','failed','shadow_ok');
 if rows is distinct from p_expected_rows then raise exception 'provider_snapshot_preimage';end if;
 -- Refuse any native/drill-marked active row rather than repurpose its receipt.
 if exists(select from jsonb_array_elements(rows) r where jsonb_typeof(r->'payload') is distinct from 'object' or r->'linear_result' is distinct from 'null'::jsonb or r->'f27_drill_rollback_id' is distinct from 'null'::jsonb) then raise exception 'provider_snapshot_unknown_receipt';end if;
 if exists(select from jsonb_array_elements(rows) r cross join lateral jsonb_object_keys(r->'payload') k where lower(k) like '%native%' or lower(k) like '%drill%') then raise exception 'provider_snapshot_native_masquerade';end if;
 select f.generation into strict generation from public.track_b_f27_team_fences f where team=p_team for update;
 select encode(extensions.digest(convert_to(coalesce(string_agg(encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex'),'' order by (value->>'id')::bigint),''),'UTF8'),'sha256'),'hex') into snapshot_hash from jsonb_array_elements(rows);
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_snapshot',jsonb_build_object('team',p_team,'authority',p_expected_authority,'generation',generation,'rows',rows,'snapshot_hash',snapshot_hash,'actor',p_actor));
 prior_bypass:=current_setting('app.f27_rollback_bypass',true);
 result:=public.track_b_f27_begin(p_team,p_expected_authority,p_actor);
 perform set_config('app.f27_rollback_bypass',coalesce(prior_bypass,''),true);
 if result->>'snapshot_sha256' is distinct from snapshot_hash or result->'snapshot_count' is distinct from to_jsonb(jsonb_array_length(rows)) then raise exception 'provider_snapshot_owner_result';end if;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 update public.card_write_admission_v1 set control_history=control_history||jsonb_build_array(jsonb_build_object('action','provider_closed_snapshot','epoch',p_epoch,'team',p_team,'rollback_id',result->'rollback_id','snapshot_hash',snapshot_hash,'snapshot_count',jsonb_array_length(rows),'actor',p_actor,'reason',p_reason,'external_worker_fenced',false,'at',clock_timestamp())) where singleton;
 return result||jsonb_build_object('epoch',p_epoch,'external_worker_fenced',false,'retirement_activated',false);
end $fn$;
revoke all on function public.production_provider_closed_snapshot_v1(uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.production_provider_closed_snapshot_v1(uuid,text,jsonb,jsonb,text,text) to service_role;
commit;