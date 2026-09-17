-- Draft/unapplied. Existing-card assignment only; not an intake or global retired epoch.
-- Requires the write-UI/F27 closure. No new tables or accepted-history rewrites.
begin;
insert into public.syncview_runtime_flags(key,value,updated_by) values
 ('native_assignment_epochs','{"video":{"mode":"provider","epoch":null},"graphics":{"mode":"provider","epoch":null}}','native-assignment-draft')
on conflict(key) do nothing;

create function public.production_assignment_epoch(p_team text) returns text
language plpgsql security definer set search_path=public as $$
declare v_value jsonb; v_team jsonb;
begin
  if p_team not in ('video','graphics') or p_team is null then raise exception 'assignment_authority_unavailable'; end if;
  select value into v_value from public.syncview_runtime_flags where key='native_assignment_epochs' for share;
  v_team := v_value->p_team;
  if jsonb_typeof(v_value) is distinct from 'object' or jsonb_typeof(v_team) is distinct from 'object'
     or coalesce(v_team->>'mode','') not in ('provider','native','hold') then
    raise exception 'assignment_authority_unavailable';
  end if;
  if v_team->>'mode'='hold' then raise exception 'assignment_authority_unavailable'; end if;
  if v_team->>'mode'='provider' then
    if v_team->>'epoch' is not null then raise exception 'assignment_authority_unavailable'; end if;
    return '';
  end if;
  if jsonb_typeof(v_team->'epoch') is distinct from 'string'
     or coalesce(v_team->>'epoch','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' then
    raise exception 'assignment_authority_unavailable';
  end if;
  return v_team->>'epoch';
end; $$;

-- Service-only projection, called AFTER current gateway authorization. For a
-- write the complete original intent identifies its receipt; picker reads
-- provide no dedup/fingerprint and cannot adopt history by entity alone.
create function public.production_assignment_context(p_expected jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_receipt public.mirror_outbox; v_epoch text; v_dedup text := p_expected->>'dedup_key';
begin
  if p_expected->>'entity' is distinct from 'deliverable' or p_expected->>'operation' is distinct from 'assignee'
     or coalesce(p_expected->>'actor','')='' or coalesce(p_expected->>'role','') not in ('admin','smm')
     or not exists(select 1 from public.deliverables where id=p_expected->>'entity_id'
       and client_slug=p_expected->>'client_slug' and team=p_expected->>'team') then
    raise exception 'assignment_scope_forbidden';
  end if;
  if coalesce(v_dedup,'')<>'' then
    if coalesce(p_expected->>'intent_fingerprint','')='' then raise exception 'idempotency_conflict'; end if;
    select * into v_receipt from public.mirror_outbox where dedup_key=v_dedup;
    if found then
      if v_receipt.entity is distinct from p_expected->>'entity'
         or v_receipt.entity_id is distinct from p_expected->>'entity_id'
         or v_receipt.operation is distinct from p_expected->>'operation'
         or v_receipt.client_slug is distinct from p_expected->>'client_slug'
         or v_receipt.team is distinct from p_expected->>'team'
         or v_receipt.actor is distinct from p_expected->>'actor'
         or v_receipt.role is distinct from p_expected->>'role'
         or v_receipt.test_only is distinct from (p_expected->>'test_only')::boolean
         or v_receipt.legacy_parity is distinct from (p_expected->>'legacy_parity')::boolean
         or v_receipt.payload->>'_intent_fingerprint' is distinct from p_expected->>'intent_fingerprint' then
        raise exception 'idempotency_conflict';
      end if;
      v_epoch := coalesce(v_receipt.payload->>'_native_assignment_epoch','');
      if v_epoch<>'' and (v_receipt.status is distinct from 'skipped'
         or v_receipt.linear_result->>'native_assignment' is distinct from 'true') then
        raise exception 'idempotency_conflict';
      end if;
      -- A provider receipt remains provider debt; HOLD must not let its retry
      -- schedule new egress. This check never relabels or mutates that receipt.
      if v_epoch='' then perform public.production_assignment_epoch(p_expected->>'team'); end if;
      return jsonb_build_object('contract','existing-assignment-v1','epoch',v_epoch,'replay',true);
    end if;
  end if;
  v_epoch := public.production_assignment_epoch(p_expected->>'team');
  if v_epoch<>'' then
    if (p_expected->>'test_only')::boolean is distinct from false
       or (p_expected->>'legacy_parity')::boolean is distinct from false then
      raise exception 'assignment_authority_unavailable';
    end if;
    perform public.production_assert_authority(p_expected->>'client_slug',p_expected->>'team',false,false);
  end if;
  return jsonb_build_object('contract','existing-assignment-v1','epoch',v_epoch,'replay',false);
end; $$;

-- The existing enqueue and F27 hold guard run first. Native assignment remains
-- represented by the SAME durable receipt and original fingerprint, terminal
-- at insertion, never an untracked mutation or a drainer cancellation race.
create function public.production_native_assignment_receipt_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_epoch text;
begin
  if tg_op='DELETE' then
    if coalesce(old.payload->>'_native_assignment_epoch','')<>'' then raise exception 'native_assignment_receipt_retained'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.payload->>'_native_assignment_epoch' is distinct from old.payload->>'_native_assignment_epoch' then
      raise exception 'idempotency_conflict';
    end if;
    if coalesce(old.payload->>'_native_assignment_epoch','')<>''
       and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
      raise exception 'idempotency_conflict';
    end if;
    return new;
  end if;
  if new.operation<>'assignee' or new.dedup_key not like 'write-ui:assignee:deliverable:%' then
    if new.payload ? '_native_assignment_epoch' then raise exception 'assignment_authority_unavailable'; end if;
    return new;
  end if;
  v_epoch := public.production_assignment_epoch(new.team);
  if v_epoch is distinct from coalesce(new.payload->>'_native_assignment_epoch','') then
    raise exception 'assignment_authority_unavailable';
  end if;
  if v_epoch<>'' then
    if new.entity<>'deliverable' or new.test_only or new.legacy_parity or new.role not in ('admin','smm')
       or coalesce(new.payload->>'_intent_fingerprint','')='' then raise exception 'assignment_scope_forbidden'; end if;
    perform public.production_assert_authority(new.client_slug,new.team,false,false);
    new.status := 'skipped'; new.processed_at := clock_timestamp(); new.next_retry_at := null;
    new.linear_result := jsonb_build_object('native_assignment',true,'epoch',v_epoch);
    new.last_error := null;
  end if;
  return new;
end; $$;
create trigger zzz_native_assignment_receipt_guard before insert or update or delete on public.mirror_outbox
for each row execute function public.production_native_assignment_receipt_guard();

create function public.production_native_assignment_truncate_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.mirror_outbox where coalesce(payload->>'_native_assignment_epoch','')<>'') then
    raise exception 'native_assignment_receipt_retained'; end if;
  return null;
end; $$;
create trigger zzz_native_assignment_truncate_guard before truncate on public.mirror_outbox
for each statement execute function public.production_native_assignment_truncate_guard();

create function public.production_assignee_write(p_row jsonb,p_event jsonb) returns public.deliverables
language plpgsql security definer set search_path=public as $$
declare v_out jsonb:=p_event->'outbound'; v_payload jsonb:=v_out->'payload'; v_context jsonb;
 v_current public.deliverables; v_member public.team_members; v_result public.deliverables;
 v_assignee text:=nullif(btrim(p_row->>'assignee_id'),''); v_expected jsonb;
begin
  if p_event->>'surface' is distinct from 'production' or p_event->>'auth_kind' is distinct from 'staff'
     or p_event->>'source' is distinct from 'ui' or p_event->>'action' is distinct from 'assignee_change'
     or v_out->>'operation' is distinct from 'assignee' or v_out->>'entity' is distinct from 'deliverable'
     or v_out->>'entity_id' is distinct from p_row->>'id'
     or v_payload->>'assignee_id' is distinct from v_assignee
     or coalesce(p_event->>'expected_updated_at','')=''
     or coalesce(v_payload->>'_native_assignment_epoch','')='' then raise exception 'assignment_scope_forbidden'; end if;
  perform public.production_assert_authority(p_row->>'client_slug',p_row->>'team',false,false);
  -- Match the established dedup -> deliverable lock order; the epoch's SHARE
  -- lock then remains held through eligibility, event and outbox insertion.
  perform pg_advisory_xact_lock(hashtextextended(v_out->>'dedup_key',0));
  v_expected := jsonb_build_object('entity','deliverable','entity_id',p_row->>'id','operation','assignee',
    'client_slug',p_row->>'client_slug','team',p_row->>'team','actor',p_event->>'actor','role',p_event->>'role',
    'test_only',v_out->'test_only','legacy_parity',v_out->'legacy_parity',
    'dedup_key',v_out->>'dedup_key','intent_fingerprint',v_payload->>'_intent_fingerprint');
  v_context := public.production_assignment_context(v_expected);
  if v_context->>'epoch' is distinct from v_payload->>'_native_assignment_epoch' then
    raise exception 'assignment_authority_unavailable'; end if;
  if v_context->>'replay'='true' then
    return public.production_deliverable_write(p_row,p_event);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||(p_row->>'id'),0));
  select * into v_current from public.deliverables where id=p_row->>'id' for update;
  if not found or v_current.client_slug is distinct from p_row->>'client_slug'
     or v_current.team is distinct from p_row->>'team' then raise exception 'assignment_scope_forbidden'; end if;
  if v_current.updated_at is distinct from (p_event->>'expected_updated_at')::timestamptz then raise exception 'write_conflict'; end if;
  if v_assignee is not null then
    select * into v_member from public.team_members where id::text=v_assignee for share;
    if not found or v_member.active is distinct from true or v_member.team is distinct from v_current.team then
      raise exception 'assignee_out_of_scope'; end if;
    if lower(v_member.role) is distinct from (case v_current.team when 'video' then 'editor' when 'graphics' then 'designer' end) then
      raise exception 'assignee_role_incompatible'; end if;
  end if;
  -- The wrapper changes only its owned column. The existing RPC retains CAS,
  -- events, journal triggers, dedup and F27 enqueue as one transaction.
  v_result := public.production_deliverable_write(to_jsonb(v_current)||jsonb_build_object('assignee_id',v_assignee),p_event);
  return v_result;
end; $$;

revoke all on function public.production_assignment_epoch(text) from public,anon,authenticated;
revoke all on function public.production_assignment_context(jsonb) from public,anon,authenticated;
revoke all on function public.production_assignee_write(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.production_native_assignment_receipt_guard() from public,anon,authenticated,service_role;
revoke all on function public.production_native_assignment_truncate_guard() from public,anon,authenticated,service_role;
grant execute on function public.production_assignment_context(jsonb), public.production_assignee_write(jsonb,jsonb) to service_role;
-- Keep epoch/guard functions and receipts for replay even after admission is
-- held. A rollback MUST NOT drop them or rewrite accepted outbox history.
commit;
