-- Rebuild Workload's cached snapshot in the background, right after a change,
-- instead of on the next reader.
--
-- MEASURED (edge logs, workload-plan v22-v23, after
-- 2026-09-23-workload-native-snapshot-cache.sql went live): of 16 full-body
-- reads, 8 were rebuilds paid by the reader (3.9-6.1 s) against 0.7-1.6 s for
-- a cache hit, because the source tables change in 100+ minutes a day.
--
-- workload_native_snapshot_warm_v1() is what the browser (after a staff save,
-- and on a short timer) and the Edge Function call. It returns no body. It:
--   * does nothing when the copy is already valid (a cheap existence check);
--   * never queues behind a rebuild already running (try-lock, 'busy'), so a
--     burst of warm-ups costs one rebuild, and a reader waiting on the lock
--     gets the fresh copy as soon as it lands;
--   * never touches a source table's rows or locks: saves are unaffected.
-- Validity, the build statement and the stored snapshot are exactly those of
-- workload_native_snapshot_cached_v1(), which this does not change.
begin;

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
revoke all on function public.workload_native_snapshot_warm_v1() from public, anon, authenticated;
grant execute on function public.workload_native_snapshot_warm_v1() to service_role;

commit;
