-- SOURCE-ONLY retirement contract. Installing this migration does not retire a
-- lane. It seeds an active gate; a release operator must call the activation
-- RPC after the drain census is clear. The gate is deliberately on the shared
-- outbox admission point, because status/comment/due and every other ordinary
-- SyncView mutation reach that table through different RPCs.
--
-- This migration requires the installed F27 hold/generation fence and the
-- three typed native receipt guards. It neither replaces nor bypasses any of
-- them. PostgreSQL runs same-kind triggers alphabetically: the F27 guard and
-- each native guard run before zzz_syncview_retirement_admission_guard.
begin;

do $preflight$
declare v_trigger text;
begin
  if to_regclass('public.mirror_outbox') is null
     or to_regclass('public.syncview_runtime_flags') is null
     or to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)') is null
  then raise exception 'syncview_retirement_prerequisite_missing'; end if;
  foreach v_trigger in array array[
    'track_b_f27_hold_guard',
    'zz_native_intake_receipt_guard',
    'zzz_native_assignment_receipt_guard',
    'zzz_native_label_receipt_guard'
  ] loop
    if not exists(select 1 from pg_trigger
      where tgrelid='public.mirror_outbox'::regclass and tgname=v_trigger
        and not tgisinternal and tgenabled <> 'D') then
      raise exception 'syncview_retirement_prerequisite_trigger_missing:%', v_trigger;
    end if;
  end loop;
end
$preflight$;

create table if not exists public.syncview_retirement_admission (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('active','retired')),
  activated_at timestamptz,
  activated_reason text,
  high_water_outbox_id bigint,
  high_water_created_at timestamptz,
  check ((mode='active' and activated_at is null and activated_reason is null
          and high_water_outbox_id is null and high_water_created_at is null)
      or (mode='retired' and activated_at is not null and activated_reason is not null
          and high_water_outbox_id is not null and high_water_created_at is not null))
);

insert into public.syncview_retirement_admission(singleton,mode)
values (true,'active') on conflict(singleton) do nothing;

-- A native receipt is not inferred from status='skipped'. It must retain the
-- exact marker AND the native guard's terminal result. This is intentionally
-- a narrow recognizer, after the native guard has performed its authority and
-- immutable-identity checks.
create or replace function public.production_syncview_retirement_typed_native_receipt(
  p_row public.mirror_outbox
) returns boolean language sql immutable set search_path=public as $fn$
  select (
    p_row.operation='create'
    and coalesce(p_row.payload->>'_native_intake_epoch','') <> ''
    and coalesce(p_row.payload->>'_native_intake_request','') <> ''
    and p_row.status='skipped'
    and p_row.linear_result->>'native_only'='true'
    and p_row.linear_result->>'epoch'=p_row.payload->>'_native_intake_epoch'
  ) or (
    p_row.operation='assignee'
    and coalesce(p_row.payload->>'_native_assignment_epoch','') <> ''
    and p_row.status='skipped'
    and p_row.linear_result->>'native_assignment'='true'
    and p_row.linear_result->>'epoch'=p_row.payload->>'_native_assignment_epoch'
  ) or (
    p_row.operation='labels'
    and coalesce(p_row.payload->>'_native_label_catalog_version','') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_row.status='skipped'
    and p_row.linear_result->>'native_labels'='true'
    and p_row.linear_result->>'catalog_version'=p_row.payload->>'_native_label_catalog_version'
  )
$fn$;

-- F27's reserved TEST drill has a distinct typed shape. It is neither a
-- provider receipt nor a native completion, and no ordinary test-client write
-- can borrow this exception.
create or replace function public.production_syncview_retirement_f27_drill_receipt(
  p_row public.mirror_outbox
) returns boolean language sql immutable set search_path=public as $fn$
  select p_row.team='__f27_drill__'
    and p_row.entity='deliverable'
    and p_row.operation='status'
    and p_row.test_only=true and p_row.legacy_parity=false
    and p_row.f27_drill_rollback_id is not null
    and p_row.payload->>'f27_drill'='true'
$fn$;

-- Read-only, aggregate-only release health. No client slug, receipt key, row
-- body, or provider identity can escape through this function.
create or replace function public.production_syncview_retirement_census()
returns jsonb language plpgsql security definer stable set search_path=public as $fn$
declare v_state public.syncview_retirement_admission%rowtype; v_rows jsonb;
begin
  select * into strict v_state from public.syncview_retirement_admission where singleton;
  select jsonb_build_object(
    'ordinary_by_operation', coalesce(jsonb_object_agg(operation, count), '{}'::jsonb),
    'ordinary_total', coalesce(sum(count),0)
  ) into v_rows
  from (
    select o.operation, count(*)::bigint as count
    from public.mirror_outbox o
    where v_state.mode='retired' and o.id > v_state.high_water_outbox_id
      and not public.production_syncview_retirement_typed_native_receipt(o)
      and not public.production_syncview_retirement_f27_drill_receipt(o)
    group by o.operation
  ) grouped;
  return jsonb_build_object(
    'contract','syncview-retirement-admission-v1',
    'mode',v_state.mode,
    'activated_at',v_state.activated_at,
    'high_water_outbox_id',v_state.high_water_outbox_id,
    'high_water_created_at',v_state.high_water_created_at,
    'ordinary_post_cutoff',v_rows->'ordinary_by_operation',
    'ordinary_post_cutoff_total',(v_rows->>'ordinary_total')::bigint,
    'nonterminal_total',(select count(*) from public.mirror_outbox
      where status in ('pending','failed','shadow_ok')),
    'native_post_cutoff_total',(select count(*) from public.mirror_outbox o
      where v_state.mode='retired' and o.id > v_state.high_water_outbox_id
        and public.production_syncview_retirement_typed_native_receipt(o)),
    'f27_post_cutoff_total',(select count(*) from public.mirror_outbox o
      where v_state.mode='retired' and o.id > v_state.high_water_outbox_id
        and public.production_syncview_retirement_f27_drill_receipt(o))
  );
end
$fn$;

-- The final database admission boundary. It sees the post-native-guard row;
-- it never terminalizes a row itself and it never converts a provider receipt
-- into native work. Existing exact retries are still resolved by the installed
-- enqueue helper before an INSERT is attempted, preserving their receipt
-- identity. Every NEW ordinary INSERT is refused and rolls its owning RPC back.
create or replace function public.production_syncview_retirement_admission_guard()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_mode text;
begin
  if tg_op <> 'INSERT' then return new; end if;
  select mode into strict v_mode from public.syncview_retirement_admission where singleton;
  if v_mode='active' then return new; end if;
  if public.production_syncview_retirement_typed_native_receipt(new)
     or public.production_syncview_retirement_f27_drill_receipt(new) then
    return new;
  end if;
  raise exception 'syncview_retirement_admission_closed:%', new.operation
    using errcode='P0001';
end
$fn$;

create trigger zzz_syncview_retirement_admission_guard
before insert on public.mirror_outbox
for each row execute function public.production_syncview_retirement_admission_guard();

-- Activation takes the outbox table lock BEFORE changing the gate. Existing
-- writers complete before the high-water is recorded; later writers wait for
-- the lock and then see retired mode in their INSERT trigger. This serializes
-- the boundary without a caller-supplied timestamp or a best-effort drain.
create or replace function public.production_syncview_retirement_activate(p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_state public.syncview_retirement_admission%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
  v_nonterminal bigint; v_id bigint; v_created timestamptz;
begin
  if v_reason is null or length(v_reason)>128 or v_reason !~ '^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$' then
    raise exception 'syncview_retirement_reason_invalid';
  end if;
  lock table public.mirror_outbox in share row exclusive mode;
  select * into strict v_state from public.syncview_retirement_admission where singleton for update;
  if v_state.mode='retired' then
    if v_state.activated_reason is distinct from v_reason then raise exception 'syncview_retirement_activation_conflict'; end if;
    return public.production_syncview_retirement_census();
  end if;
  select count(*) into v_nonterminal from public.mirror_outbox
    where status in ('pending','failed','shadow_ok');
  if v_nonterminal <> 0 then raise exception 'syncview_retirement_drain_required:%',v_nonterminal; end if;
  select coalesce(max(id),0), coalesce(max(created_at),'epoch'::timestamptz)
    into v_id,v_created from public.mirror_outbox;
  update public.syncview_retirement_admission
    set mode='retired', activated_at=clock_timestamp(), activated_reason=v_reason,
        high_water_outbox_id=v_id, high_water_created_at=v_created
    where singleton;
  return public.production_syncview_retirement_census();
end
$fn$;

revoke all on table public.syncview_retirement_admission from public,anon,authenticated;
revoke all on function public.production_syncview_retirement_census() from public,anon,authenticated;
revoke all on function public.production_syncview_retirement_activate(text) from public,anon,authenticated;
grant execute on function public.production_syncview_retirement_census() to service_role;
grant execute on function public.production_syncview_retirement_activate(text) to service_role;

commit;
