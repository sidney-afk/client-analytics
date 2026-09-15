-- Preparation protocol, not deployed worker identity attestation.
-- Release must fence legacy workers before this claim API is used. The approved
-- worker commits effects + completion in one locked transaction and writes only
-- immutable content-addressed Storage objects. Legacy claim history never qualifies.
begin;
create function public.production_card_followup_claim_transactional_v1(p_limit integer default 1)
returns setof public.card_write_followups_v1 language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare task public.card_write_followups_v1%rowtype; gate public.card_write_admission_v1%rowtype;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.mode='sealed' then raise exception 'card_followup_gate_sealed';end if;
 for task in select * from public.production_card_followup_claim_v1(p_limit) loop
  update public.card_write_followups_v1 set history=history||jsonb_build_array(jsonb_build_object('event','transactional_claim','contract','transactional_sql_immutable_storage_v1','attempt',task.attempt,'lease_token',task.lease_token,'at',clock_timestamp())) where operation_id=task.operation_id and kind=task.kind returning * into task;
  return next task;
 end loop;
end $fn$;
revoke all on function public.production_card_followup_claim_v1(integer) from public,anon,authenticated,service_role;
create function public.production_card_followup_recover_v1(p_epoch uuid,p_operation_id uuid,p_kind text,p_attempt integer,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog set lock_timeout='5s' as $fn$
declare gate public.card_write_admission_v1%rowtype; task public.card_write_followups_v1%rowtype; previous jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch then raise exception 'card_followup_recovery_epoch';end if;
 -- A live effect transaction holds this same row until COMMIT/ROLLBACK. A timeout
 -- refuses; elapsed wall clock never serves as proof that COMMIT failed.
 select * into strict task from public.card_write_followups_v1 where operation_id=p_operation_id and kind=p_kind for update;
 if task.attempt is distinct from p_attempt or task.lease_token is distinct from p_lease then raise exception 'card_followup_recovery_attempt';end if;
 if task.state='completed' then return jsonb_build_object('status','completed','task',to_jsonb(task),'retry_started',false);end if;
 if gate.mode='sealed' or task.state not in ('failed','unknown','running') or (task.state='running' and task.lease_until>=clock_timestamp()) then raise exception 'card_followup_recovery_state';end if;
 if not exists(select from jsonb_array_elements(task.history) h where h->>'event'='transactional_claim' and h->>'contract'='transactional_sql_immutable_storage_v1' and h->'attempt'=to_jsonb(task.attempt) and h->>'lease_token'=task.lease_token::text) then raise exception 'card_followup_legacy_attempt_unproven';end if;
 if exists(select from public.card_write_transaction_context_v1 where operation_id=p_operation_id and task_kind=p_kind) then raise exception 'card_followup_effect_context_unsettled';end if;
 previous:=jsonb_build_object('event','recovered_transactional_attempt','attempt',task.attempt,'lease_token',task.lease_token,'state',task.state,'outcome',task.outcome,'completed_at',task.completed_at,'at',clock_timestamp());
 update public.card_write_followups_v1 set state='running',attempt=attempt+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',outcome=null,completed_at=null,history=history||jsonb_build_array(previous) where operation_id=p_operation_id and kind=p_kind returning * into task;
 update public.card_write_followups_v1 set history=history||jsonb_build_array(jsonb_build_object('event','transactional_claim','contract','transactional_sql_immutable_storage_v1','attempt',task.attempt,'lease_token',task.lease_token,'at',clock_timestamp())) where operation_id=p_operation_id and kind=p_kind returning * into task;
 return jsonb_build_object('status','running','task',to_jsonb(task),'retry_started',true);
end $fn$;
revoke all on function public.production_card_followup_claim_transactional_v1(integer),public.production_card_followup_recover_v1(uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.production_card_followup_claim_transactional_v1(integer),public.production_card_followup_recover_v1(uuid,uuid,text,integer,uuid) to service_role;
commit;