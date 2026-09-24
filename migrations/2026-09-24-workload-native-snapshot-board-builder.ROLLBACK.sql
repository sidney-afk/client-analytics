-- ============================================================
-- NOT APPLIED -- rollback for 2026-09-24-workload-native-snapshot-board-builder.sql.
-- Restores workload_native_snapshot_cached_v1() and _warm_v1() exactly as read
-- live 2026-09-24 (read-only; cached_v1 prosrc md5 205174e44afcea95d5b225b7149d1bde,
-- warm_v1 19e15bb51e045baad692b4924a529824), i.e. building from v1 again,
-- drops the new builder, and marks the stored copy stale so it is rebuilt from v1.
-- ============================================================
begin;

create or replace function public.workload_native_snapshot_cached_v1(p_if_version text default null)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public as $fn$
declare
  v_version text; v_valid boolean; v_body jsonb; v_snap pg_snapshot;
begin
  for attempt in 1..2 loop
    select c.version,
           not exists (select 1 from public.workload_snapshot_invalidation i
                       where not pg_visible_in_snapshot(i.xid, c.built_snapshot))
      into v_version, v_valid
      from public.workload_snapshot_cache c;
    if v_valid then
      if p_if_version is not null and p_if_version = v_version then
        return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_version,
                                  'contract', 'workload-native-snapshot-v2');
      end if;
      select c.body || jsonb_build_object('version', c.version)
        into v_body from public.workload_snapshot_cache c;
      return v_body;
    end if;
    exit when attempt = 2;
    perform pg_advisory_xact_lock(hashtext('workload_native_snapshot_cache'));
  end loop;

  select pg_current_snapshot(), public.workload_native_snapshot_slim_v1(public.workload_native_snapshot_v1())
    into v_snap, v_body;
  v_version := md5(v_body::text);
  insert into public.workload_snapshot_cache as c (singleton, version, built_snapshot, built_at, body)
    values (true, v_version, v_snap, now(), v_body)
    on conflict (singleton) do update
      set version = excluded.version, built_snapshot = excluded.built_snapshot,
          built_at = excluded.built_at, body = excluded.body;
  delete from public.workload_snapshot_invalidation i where pg_visible_in_snapshot(i.xid, v_snap);
  if p_if_version is not null and p_if_version = v_version then
    return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_version,
                              'contract', 'workload-native-snapshot-v2');
  end if;
  return v_body || jsonb_build_object('version', v_version);
end;
$fn$;
revoke all on function public.workload_native_snapshot_cached_v1(text) from public, anon, authenticated, service_role;
grant execute on function public.workload_native_snapshot_cached_v1(text) to service_role;

create or replace function public.workload_native_snapshot_warm_v1()
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public as $fn$
declare
  v_valid boolean; v_body jsonb; v_snap pg_snapshot; v_version text;
  v_started timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('workload_native_snapshot_cache')) then
    return jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'busy');
  end if;
  select not exists (select 1 from public.workload_snapshot_invalidation i
                     where not pg_visible_in_snapshot(i.xid, c.built_snapshot))
    into v_valid from public.workload_snapshot_cache c;
  if v_valid then
    return jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'fresh');
  end if;
  -- One statement: the body and the snapshot it was read under.
  select pg_current_snapshot(), public.workload_native_snapshot_slim_v1(public.workload_native_snapshot_v1())
    into v_snap, v_body;
  v_version := md5(v_body::text);
  insert into public.workload_snapshot_cache as c (singleton, version, built_snapshot, built_at, body)
    values (true, v_version, v_snap, now(), v_body)
    on conflict (singleton) do update
      set version = excluded.version, built_snapshot = excluded.built_snapshot,
          built_at = excluded.built_at, body = excluded.body;
  delete from public.workload_snapshot_invalidation i where pg_visible_in_snapshot(i.xid, v_snap);
  return jsonb_build_object('ok', true, 'rebuilt', true, 'version', v_version,
    'ms', round(extract(epoch from clock_timestamp() - v_started) * 1000));
end;
$fn$;
revoke all on function public.workload_native_snapshot_warm_v1() from public, anon, authenticated, service_role;
grant execute on function public.workload_native_snapshot_warm_v1() to service_role;

drop function if exists public.workload_native_snapshot_board_v1();

-- The stored copy was built by the other builder; mark it stale so the
-- 10-second warm job rebuilds it with the builder now in force.
insert into public.workload_snapshot_invalidation(xid)
  values (pg_current_xact_id()) on conflict (xid) do nothing;

commit;
