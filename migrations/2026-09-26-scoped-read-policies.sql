-- ============================================================
-- NOT APPLIED -- proposal for owner review (2026-09-26). PHASE 2 of
-- docs/ops/ANON_READ_SCOPE_2026-09-26.md.
--
-- DO NOT APPLY until phase 1 has shipped and been measured: every browser read
-- and realtime subscription of these tables must send a SyncView session JWT
-- (role "authenticated") instead of the bare anon key. Applying this first
-- empties the Calendar, Samples, Kasper, Production and Workload for everyone.
--
-- WHAT. Replaces the `using (true)` read policies on the five card tables and
-- the two card event ledgers (calendar_post_events, sample_review_events) with
-- scoped ones, and gives the three anon-readable owner-rights views scoped
-- `_session` twins (originals closed to anon and authenticated):
--   * a staff session (claim svc_scope = 'staff') reads every row, as today;
--   * a client session (svc_scope = 'client') reads only rows whose client /
--     client_slug equals its svc_client claim;
--   * the bare anon key reads nothing.
-- Realtime postgres_changes applies the same policies to the subscriber's JWT,
-- so a client link's live updates are scoped the same way.
-- Column grants are unchanged (anon and authenticated read the same columns
-- today); the three restrictive deliverable_events body-protection policies
-- stay and keep applying.
--
-- The claims are minted only by the proposed syncview-session Edge Function,
-- after it verifies a client_access token (as client-token-verify does) or a
-- staff role key (authorizeStaffKey). Nothing a browser can set alone produces
-- them.
-- ============================================================
begin;
set local lock_timeout = '5s';

create or replace function public.syncview_session_scope()
returns text language sql stable set search_path = pg_catalog as $fn$
  select nullif(coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'svc_scope', '')
$fn$;
create or replace function public.syncview_session_client()
returns text language sql stable set search_path = pg_catalog as $fn$
  select nullif(coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'svc_client', '')
$fn$;
revoke all on function public.syncview_session_scope() from public, anon, authenticated, service_role;
revoke all on function public.syncview_session_client() from public, anon, authenticated, service_role;
grant execute on function public.syncview_session_scope() to authenticated;
grant execute on function public.syncview_session_client() to authenticated;

drop policy if exists "anon read calendar_posts" on public.calendar_posts;
drop policy if exists "anon read sample_reviews" on public.sample_reviews;
drop policy if exists "anon read deliverables" on public.deliverables;
drop policy if exists "anon read batches" on public.batches;
drop policy if exists "anon read deliverable_events" on public.deliverable_events;

create policy "session read calendar_posts" on public.calendar_posts for select to authenticated
  using (public.syncview_session_scope() = 'staff'
    or (public.syncview_session_scope() = 'client' and client = public.syncview_session_client()));
create policy "session read sample_reviews" on public.sample_reviews for select to authenticated
  using (public.syncview_session_scope() = 'staff'
    or (public.syncview_session_scope() = 'client' and client = public.syncview_session_client()));
create policy "session read deliverables" on public.deliverables for select to authenticated
  using (public.syncview_session_scope() = 'staff'
    or (public.syncview_session_scope() = 'client' and client_slug = public.syncview_session_client()));
create policy "session read batches" on public.batches for select to authenticated
  using (public.syncview_session_scope() = 'staff'
    or (public.syncview_session_scope() = 'client' and client_slug = public.syncview_session_client()));
create policy "session read deliverable_events" on public.deliverable_events for select to authenticated
  using (public.syncview_session_scope() = 'staff'
    or (public.syncview_session_scope() = 'client' and client_slug = public.syncview_session_client()));

-- The two card event ledgers carry card ids, actors and status history.
drop policy if exists "anon read calendar_post_events" on public.calendar_post_events;
drop policy if exists "anon read sample_review_events" on public.sample_review_events;
create policy "session read calendar_post_events" on public.calendar_post_events for select to authenticated
  using (public.syncview_session_scope() = 'staff'
    or (public.syncview_session_scope() = 'client' and client = public.syncview_session_client()));
create policy "session read sample_review_events" on public.sample_review_events for select to authenticated
  using (public.syncview_session_scope() = 'staff'
    or (public.syncview_session_scope() = 'client' and client = public.syncview_session_client()));
revoke select on public.calendar_post_events, public.sample_review_events from anon;

-- Three anon-readable views run with their owner's (postgres) rights, so base
-- table policies never reach them. They cannot switch to security_invoker:
-- two read deliverables.linear_raw, which authenticated must not read, and one
-- reads rename_propagation_outbox, which it cannot read at all. They also
-- cannot be renamed: seven server-side functions (the Workload snapshot, plan
-- and intake loaders; none executable by anon or authenticated) name them and
-- would then read an empty, claim-scoped view. So the originals stay exactly
-- as they are for those functions, lose their anon and authenticated grants,
-- and a new `<name>_session` view (owner rights, security_barrier) returns only
-- the rows a session may see. Phase 1 points the browser at the _session names.
do $views$
declare v record;
begin
  for v in select * from (values
      ('production_deliverables_browser_v1', 'client_slug'),
      ('workload_issues_native_v1', 'client_slug'),
      ('rename_propagation_status_v1', 'client')) as t(name, client_col) loop
    if to_regclass('public.' || v.name) is null or to_regclass('public.' || v.name || '_session') is not null then
      raise exception 'scoped_read_view_state_unexpected: %', v.name;
    end if;
    execute format('create view public.%I with (security_barrier = true) as select * from public.%I u
      where public.syncview_session_scope() = %L or (public.syncview_session_scope() = %L and u.%I = public.syncview_session_client())',
      v.name || '_session', v.name, 'staff', 'client', v.client_col);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v.name || '_session');
    execute format('grant select on public.%I to authenticated', v.name || '_session');
    execute format('revoke select on public.%I from public, anon, authenticated', v.name);
  end loop;
end;
$views$;

-- anon keeps no read path to these five tables.
revoke select on public.calendar_posts, public.sample_reviews, public.deliverable_events from anon;
-- deliverables and batches are granted to anon column by column; revoke every
-- column so no read path remains (a table-level REVOKE leaves column grants).
do $cols$
declare t text; c text;
begin
  foreach t in array array['deliverables','batches'] loop
    for c in select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = t and grantee = 'anon' and privilege_type = 'SELECT' loop
      execute format('revoke select (%I) on public.%I from anon', c, t);
    end loop;
  end loop;
end;
$cols$;

commit;

-- VERIFY with three test JWTs (staff, client A, client B) against the test
-- client only: staff sees all rows, client A sees only its slug, the bare anon
-- key sees 0 rows and a realtime subscription with it receives nothing.
