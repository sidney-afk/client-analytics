-- 2026-09-28 — daily Clients Info roster sync for public.clients.
--
-- Owner rule (2026-09-27): a client is current only if it is on the
-- "Clients Info" tab of the SYNCVIEW sheet. Nothing kept public.clients.active
-- in step with that tab, so former clients stayed active (client links, staff
-- pickers and Production writes still treated them as current).
--
-- clients_roster_sync_v1(current_slugs, run_id, apply) compares the tab's
-- client slugs with public.clients and, for rows of kind 'client' only:
--   * switches OFF an active client that is not on the tab;
--   * switches back ON an inactive client that is on the tab again.
-- It never inserts, never deletes, never touches another column, and never
-- touches a row whose kind is not 'client' (the test client is kind 'test').
-- Slugs on the tab that have no public.clients row are only reported: adding
-- clients stays with onboarding / native provisioning.
--
-- Guard against a broken or empty read of the Sheet: the call is refused
-- (nothing changes) when the tab lists fewer than 10 clients, or when it would
-- switch off more than 10 clients or more than a third of the active ones in
-- one run. A refused run is still logged.
--
-- Every call (dry run or applied) leaves one row in clients_roster_sync_log.
-- Caller: scripts/clients-roster-sync.js from the daily GitHub Actions job
-- .github/workflows/clients-roster-sync.yml, with the service role.
--
-- Rollback: disable the GitHub job, then drop the function and the log table.
-- Any active flag it changed can be flipped back by hand from the log.

begin;

create table if not exists public.clients_roster_sync_log (
  id            bigint generated always as identity primary key,
  run_id        text        not null,
  ran_at        timestamptz not null default now(),
  applied       boolean     not null,
  refused       text,
  sheet_count   integer     not null,
  deactivated   text[]      not null default '{}',
  reactivated   text[]      not null default '{}',
  not_in_clients text[]     not null default '{}'
);

alter table public.clients_roster_sync_log enable row level security;
-- Supabase grants every new object to anon, authenticated and service_role by
-- default, so every role is named here (CLAUDE.md).
revoke all on table public.clients_roster_sync_log from public, anon, authenticated, service_role;
grant select on table public.clients_roster_sync_log to service_role;
revoke all on sequence public.clients_roster_sync_log_id_seq from public, anon, authenticated, service_role;

create or replace function public.clients_roster_sync_v1(
  p_current_slugs text[],
  p_run_id text,
  p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet text[];
  v_active_count integer;
  v_off text[];
  v_on text[];
  v_missing text[];
  v_refused text;
  v_run text := left(btrim(coalesce(p_run_id, '')), 200);
begin
  if v_run = '' then
    raise exception 'run_id required' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct s order by s), '{}')
    into v_sheet
    from (select lower(btrim(x)) s from unnest(coalesce(p_current_slugs, '{}')) x) t
   where s <> '';

  select count(*) into v_active_count from public.clients where kind = 'client' and active;

  select coalesce(array_agg(slug order by slug), '{}') into v_off
    from public.clients
   where kind = 'client' and active and not (slug = any(v_sheet));

  select coalesce(array_agg(slug order by slug), '{}') into v_on
    from public.clients
   where kind = 'client' and not active and slug = any(v_sheet);

  select coalesce(array_agg(s order by s), '{}') into v_missing
    from unnest(v_sheet) s
   where not exists (select 1 from public.clients c where c.slug = s);

  if cardinality(v_sheet) < 10 then
    v_refused := 'sheet_too_small';
  elsif cardinality(v_off) > 10 or cardinality(v_off) * 3 > v_active_count then
    v_refused := 'too_many_deactivations';
  end if;

  if p_apply and v_refused is null then
    update public.clients set active = false, updated_at = now()
     where kind = 'client' and active and slug = any(v_off);
    update public.clients set active = true, updated_at = now()
     where kind = 'client' and not active and slug = any(v_on);
  end if;

  insert into public.clients_roster_sync_log
    (run_id, applied, refused, sheet_count, deactivated, reactivated, not_in_clients)
  values
    (v_run, p_apply and v_refused is null, v_refused, cardinality(v_sheet), v_off, v_on, v_missing);

  return jsonb_build_object(
    'applied', p_apply and v_refused is null,
    'refused', v_refused,
    'sheet_count', cardinality(v_sheet),
    'deactivated', to_jsonb(v_off),
    'reactivated', to_jsonb(v_on),
    'not_in_clients', to_jsonb(v_missing));
end;
$$;

revoke all on function public.clients_roster_sync_v1(text[], text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.clients_roster_sync_v1(text[], text, boolean) to service_role;

commit;

-- VERIFY (read-only; run after applying):
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') anon_exec,
--        has_function_privilege('authenticated', p.oid, 'execute') auth_exec,
--        has_function_privilege('service_role', p.oid, 'execute') service_exec
--   from pg_proc p where p.proname = 'clients_roster_sync_v1';
-- select * from public.clients_roster_sync_log order by id desc limit 5;
