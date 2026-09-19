-- The Create Post editor picker asks "how much open video work does each
-- editor hold". The gateway used to answer that by DOWNLOADING the population
-- and counting it in TypeScript: every live video deliverable, plus every row
-- of production_deliverables_browser_v1 carrying a parent id. The second read
-- is now 3,232 rows, PostgREST caps a request at 1,000, and the picker's own
-- completeness check -- correctly -- refuses a partial answer rather than
-- reporting a wrong load. The refusal greys the Video editor dropdown out.
--
-- Raising the cap or paging 3,232 rows would both be answers to the wrong
-- question. The count is an aggregate, so the database computes it: one row
-- per editor, no row limit to reach.
--
-- NOT security definer. The gateway connects as service_role, which already
-- reads both relations directly; this needs no elevation and is granted none.
-- The fifth element of the preflight ROUTINES row records that.
begin;

-- Statuses are the gateway's INTAKE_LOAD_LIVE_STATUSES, pinned by
-- test/production-write-gateway.js so the two cannot drift apart silently.
--
-- A BATCH PARENT IS NOT ON ANYONE'S PLATE: a row is a parent when some other
-- row of the same team names its issue as raw_issue_parent_id. Children may
-- sit in any status, so the parent set is read over the whole team, exactly as
-- the TypeScript it replaces did.
create function public.production_native_intake_open_load(p_team text)
  returns jsonb
  language sql
  stable
  set search_path = public, pg_temp
as $fn$
  with parents as (
    select distinct v.raw_issue_parent_id as issue_uuid
      from public.production_deliverables_browser_v1 v
     where v.team = p_team
       and v.raw_issue_parent_id is not null
  ), open_work as (
    select d.assignee_id, count(*) as open_count
      from public.deliverables d
     where d.team = p_team
       and d.status = any (array['todo', 'in_progress', 'tweak'])
       and d.assignee_id is not null
       and not exists (
         select 1 from parents p where p.issue_uuid = d.linear_issue_uuid)
     group by d.assignee_id
  )
  select coalesce(jsonb_object_agg(assignee_id::text, open_count), '{}'::jsonb)
    from open_work;
$fn$;

-- Supabase grants service_role, anon and authenticated full rights on every new
-- object by default, so the revoke names all four roles rather than the usual
-- three; service_role then gets EXECUTE back, and only that.
revoke all on function public.production_native_intake_open_load(text)
  from public, anon, authenticated, service_role;
grant execute on function public.production_native_intake_open_load(text)
  to service_role;
commit;
