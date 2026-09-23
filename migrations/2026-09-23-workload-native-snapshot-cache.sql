-- Serve Workload's native snapshot from a prebuilt copy instead of rebuilding
-- it per request, and let a browser that already holds the current copy get
-- back "unchanged" with no body.
--
-- MEASURED (live, read-only, 2026-09-23): workload_native_snapshot_v1() takes
-- 2.29 s in SQL and returns 9.81 MB of jsonb; the browser waited 3.8-7.2 s for
-- its first byte. Source tables changed in 94 distinct minutes of the last 24 h,
-- so a copy is valid most of the time and must be rebuilt on the first read
-- after any change.
--
-- CORRECTNESS: never serve a copy older than a change that invalidated it.
-- Every statement that writes a source table records its transaction id in
-- workload_snapshot_invalidation (statement-level trigger, one row per
-- transaction, insert-only so writers never contend on a shared counter). The
-- copy stores the exact pg_snapshot it was built under. It is valid only while
-- every COMMITTED writer transaction is visible in that snapshot; a writer that
-- is still open is invisible to the reader and invalidates the copy the moment
-- it commits. The body and its snapshot come from ONE statement, so they cannot
-- describe two different moments.
--
-- SLIMMER BODY (contract workload-native-snapshot-v2), measured 9.81 -> 7.25 MB:
--   * linear_parent_ids dropped (no Workload reader).
--   * url kept only on legacy rows (the browser blanks it on native rows).
--   * parent_identifier sent once per parent in `parents`, removed from rows,
--     unless one parent carries two different identifiers (then kept per row).
-- workload_native_snapshot_v1() and the v1 Edge Function action are unchanged,
-- so browser bundles still open on the old code keep working.
--
-- Access is unchanged in kind: both tables are revoked from all four roles and
-- touched only by SECURITY DEFINER functions; the serving function is
-- service_role only, exactly like workload_native_snapshot_v1().
begin;

create table if not exists public.workload_snapshot_invalidation (
  xid xid8 primary key,
  noted_at timestamptz not null default now()
);
create table if not exists public.workload_snapshot_cache (
  singleton boolean primary key default true check (singleton),
  version text not null,
  built_snapshot pg_snapshot not null,
  built_at timestamptz not null default now(),
  body jsonb not null
);
revoke all on table public.workload_snapshot_invalidation from public, anon, authenticated, service_role;
revoke all on table public.workload_snapshot_cache from public, anon, authenticated, service_role;
alter table public.workload_snapshot_invalidation enable row level security;
alter table public.workload_snapshot_cache enable row level security;

create or replace function public.workload_snapshot_note_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $fn$
begin
  insert into public.workload_snapshot_invalidation(xid)
    values (pg_current_xact_id()) on conflict (xid) do nothing;
  return null;
end;
$fn$;
revoke all on function public.workload_snapshot_note_change() from public, anon, authenticated, service_role;

-- Every relation workload_native_snapshot_v1() reads, directly or through
-- workload_issues_native_v1 / production_deliverables_browser_v1. The test
-- derives the view dependencies from pg_depend and fails if one is missing.
do $do$
declare t text;
begin
  foreach t in array array['deliverables','batches','clients','team_members',
                           'workload_issues','workload_plan','syncview_runtime_flags'] loop
    execute format('drop trigger if exists workload_snapshot_note_change on public.%I', t);
    execute format('create trigger workload_snapshot_note_change
      after insert or update or delete or truncate on public.%I
      for each statement execute function public.workload_snapshot_note_change()', t);
  end loop;
end;
$do$;

create or replace function public.workload_native_snapshot_slim_v1(p_value jsonb)
returns jsonb language sql immutable
set search_path = pg_catalog, public as $fn$
  with r as (
    select e.value as row, e.ordinality as n
    from jsonb_array_elements(p_value->'rows') with ordinality e
  ), p as (
    select row->>'parent_id' as pid, min(row->>'parent_identifier') as ident,
           count(distinct row->>'parent_identifier') as variants
    from r where row->>'parent_id' is not null and row->>'parent_identifier' is not null
    group by 1
  )
  select (p_value - 'rows') || jsonb_build_object(
    'contract', 'workload-native-snapshot-v2',
    'rows', coalesce((select jsonb_agg(
        (r.row - 'linear_parent_ids'
               - case when r.row->>'source' = 'native' then 'url' else '' end)
        - case when p.variants = 1 then 'parent_identifier' else '' end
        order by r.n)
      from r left join p on p.pid = r.row->>'parent_id'), '[]'::jsonb),
    'parents', coalesce((select jsonb_object_agg(pid, ident) from p where variants = 1), '{}'::jsonb));
$fn$;
revoke all on function public.workload_native_snapshot_slim_v1(jsonb) from public, anon, authenticated, service_role;

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
    -- Rebuild once, not once per waiting request: the second pass re-checks
    -- under a fresh statement snapshot after the first builder committed.
    exit when attempt = 2;
    perform pg_advisory_xact_lock(hashtext('workload_native_snapshot_cache'));
  end loop;

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
  if p_if_version is not null and p_if_version = v_version then
    return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_version,
                              'contract', 'workload-native-snapshot-v2');
  end if;
  return v_body || jsonb_build_object('version', v_version);
end;
$fn$;
revoke all on function public.workload_native_snapshot_cached_v1(text) from public, anon, authenticated;
grant execute on function public.workload_native_snapshot_cached_v1(text) to service_role;

commit;
