-- ============================================================
-- Native deliverable status -> sample review component status.
--
-- THE HOLE THIS FILLS (found by Vigil, 2026-10-01).
--
-- A status change on a sample is two saves from the browser, in this order:
--   1. the work item (`deliverables.status`) through the write gateway;
--   2. the sample's own record (`sample_reviews.video_status` / `graphic_status`
--      and the overall `status`) through `sample-review-upsert`.
-- Closing the tab, losing the network or crashing between the two leaves the
-- work item moved and the sample still showing the old status. The browser keeps
-- a repair journal for this, but it lives in one browser profile: another
-- browser, another device or cleared site data cannot finish it, and the sample
-- stays stuck until someone changes it by hand.
--
-- The Calendar closed the same gap on 2026-09-18 with a trigger
-- (migrations/2026-09-18-native-calendar-status-bridge.sql) and said in so many
-- words that it "does not touch sample_reviews". This is the samples twin.
--
-- WHAT IT DOES.
--   * A trigger on `deliverables` moves the sample's matching component status,
--     the overall `status` and any now-stale approval stamps IN THE SAME
--     TRANSACTION as the work item write. Step 1 therefore finishes step 2.
--     The browser's second save still happens and now finds the value already
--     there, so it changes nothing and stamps nothing.
--   * A catch-up function finishes any sample whose work item is ahead (the
--     sample's own change stamp is older than the work item's), for rows that
--     were behind before this trigger existed or that a restore left behind.
--
-- ONE IMPLEMENTATION. The trigger and the catch-up both call
-- `production_native_sample_status_apply`, so they cannot disagree. It takes a
-- row lock on the sample first and re-reads the work item live, so a concurrent
-- browser save, trigger or catch-up can never write an older value over a newer
-- one (compare-and-set, not "apply the snapshot").
--
-- WHAT IT DELIBERATELY DOES NOT DO (same stance as the Calendar bridge).
--   * A status with no sample equivalent (`triage`, `canceled`, `duplicate`,
--     `scheduled`, `posted`, anything unrecognised) maps to null and leaves the
--     sample as it was.
--   * It does not link a sample to a work item. The slot the SAMPLE points back
--     through (`video_deliverable_id` / `graphic_deliverable_id`) decides the
--     component, never the work item's own kind or team.
--   * It does not swallow its own errors: it runs in the work item's
--     transaction, so a failure means neither write happened and the person is
--     told, instead of the sample going quietly stale again.
--   * The mapping is shared with the Calendar bridge
--     (`production_native_calendar_status_map`, already origin-aware). The
--     overall status below is a SQL copy of `computeSampleOverallStatus` in
--     index.html; test/native-sample-status-bridge.js executes the page's own
--     function and compares the two over every status pair.
--
-- Idempotent; safe to run more than once. Rollback at the bottom.
-- ============================================================

-- ------------------------------------------------------------
-- Normalise a stored sample status like `_sxrNormStatus` in index.html.
-- ------------------------------------------------------------
create or replace function public.production_native_sample_status_norm(p_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when btrim(coalesce(p_status, ''), E' \t\r\n') = '' then 'In Progress'
    when lower(btrim(p_status, E' \t\r\n')) = 'draft' then 'In Progress'
    when lower(btrim(p_status, E' \t\r\n')) in ('kasper approval', 'for kasper approval') then 'Kasper Approval'
    when lower(btrim(p_status, E' \t\r\n')) = 'smm approval' then 'For SMM Approval'
    when lower(btrim(p_status, E' \t\r\n')) = 'in progress' then 'In Progress'
    when lower(btrim(p_status, E' \t\r\n')) = 'for smm approval' then 'For SMM Approval'
    when lower(btrim(p_status, E' \t\r\n')) = 'client approval' then 'Client Approval'
    when lower(btrim(p_status, E' \t\r\n')) = 'tweaks needed' then 'Tweaks Needed'
    when lower(btrim(p_status, E' \t\r\n')) = 'approved' then 'Approved'
    else btrim(p_status, E' \t\r\n')
  end;
$fn$;

revoke all on function public.production_native_sample_status_norm(text) from public, anon, authenticated;
grant execute on function public.production_native_sample_status_norm(text) to service_role;

-- ------------------------------------------------------------
-- Overall sample status = worst of its two components, like
-- `computeSampleOverallStatus` (seed 'Approved'; a value with no priority never
-- wins). Worst to best: Tweaks Needed, In Progress, For SMM Approval,
-- Kasper Approval, Client Approval, Approved.
-- ------------------------------------------------------------
create or replace function public.production_native_sample_overall_status(
  p_video text, p_graphic text
) returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select coalesce((
    select t.s
    from (values (public.production_native_sample_status_norm(p_video)),
                 (public.production_native_sample_status_norm(p_graphic))) as t(s)
    cross join lateral (select case t.s
      when 'Tweaks Needed' then 0 when 'In Progress' then 1 when 'For SMM Approval' then 2
      when 'Kasper Approval' then 3 when 'Client Approval' then 4 when 'Approved' then 5
      else null end as r) k
    where k.r is not null and k.r < 5
    order by k.r
    limit 1
  ), 'Approved');
$fn$;

revoke all on function public.production_native_sample_overall_status(text, text) from public, anon, authenticated;
grant execute on function public.production_native_sample_overall_status(text, text) to service_role;

-- ------------------------------------------------------------
-- The single implementation. Returns true when it changed the sample.
--
-- p_since is null for the trigger (the work item has just moved, so it is ahead
-- by definition). The catch-up passes a window and additionally requires that
-- the sample's own change stamp for the component is older than the work
-- item's, so a sample someone edited AFTER the work item moved is left alone.
-- ------------------------------------------------------------
create or replace function public.production_native_sample_status_apply(
  p_client text, p_sample_id text, p_component text, p_deliverable_id text,
  p_source text, p_via text, p_since timestamptz default null
) returns boolean
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  d record;
  s record;
  v_target text;
  v_from text;
  v_sample_stamp timestamptz;
  v_video text;
  v_graphic text;
  v_now_iso text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_component not in ('video', 'graphic') then return false; end if;

  -- Lock the sample first. A concurrent browser save, trigger or catch-up now
  -- queues behind this one and re-reads the settled row.
  select * into s from public.sample_reviews r
   where r.client = p_client and r.id = p_sample_id
   for update;
  if not found then return false; end if;
  if lower(btrim(coalesce(s.status, ''))) = 'archived' then return false; end if;
  if p_component = 'video' and s.video_deliverable_id is distinct from p_deliverable_id then return false; end if;
  if p_component = 'graphic' and s.graphic_deliverable_id is distinct from p_deliverable_id then return false; end if;

  -- Re-read the work item live. The target is derived from what it holds NOW,
  -- never from a snapshot the caller took earlier.
  select x.status, x.status_at, x.origin, x.client_slug, x.card_id into d
    from public.deliverables x where x.id = p_deliverable_id;
  if not found then return false; end if;
  if coalesce(d.origin, '') <> 'samples' or d.client_slug is distinct from p_client
     or d.card_id is distinct from p_sample_id then return false; end if;

  v_target := public.production_native_calendar_status_map(d.status, d.origin);
  if v_target is null then return false; end if;

  v_from := case when p_component = 'video' then s.video_status else s.graphic_status end;
  if v_from is not distinct from v_target then return false; end if;

  if p_since is not null then
    if d.status_at is null or d.status_at < p_since then return false; end if;
    v_sample_stamp := case when p_component = 'video' then s.video_status_at else s.graphic_status_at end;
    -- "Ahead" means the sample's own stamp is older than the work item's.
    if v_sample_stamp is not null and v_sample_stamp >= d.status_at then return false; end if;
  end if;

  v_video := case when p_component = 'video' then v_target else s.video_status end;
  v_graphic := case when p_component = 'graphic' then v_target else s.graphic_status end;

  if p_component = 'video' then
    update public.sample_reviews r
       set video_status = v_target,
           status = public.production_native_sample_overall_status(v_video, v_graphic),
           client_video_approved_at = case
             when v_target in ('Client Approval', 'Approved') then r.client_video_approved_at
             when coalesce(r.client_video_approved_at, '') = '' then r.client_video_approved_at
             else '' end,
           kasper_approved_at = case
             when coalesce(r.kasper_approved_at, '') = '' then r.kasper_approved_at
             when public.production_native_sample_status_norm(v_video) in ('Client Approval', 'Approved')
               or public.production_native_sample_status_norm(v_graphic) in ('Client Approval', 'Approved')
               then r.kasper_approved_at
             else '' end,
           updated_at = v_now_iso
     where r.client = p_client and r.id = p_sample_id;
  else
    update public.sample_reviews r
       set graphic_status = v_target,
           status = public.production_native_sample_overall_status(v_video, v_graphic),
           client_graphic_approved_at = case
             when v_target in ('Client Approval', 'Approved') then r.client_graphic_approved_at
             when coalesce(r.client_graphic_approved_at, '') = '' then r.client_graphic_approved_at
             else '' end,
           kasper_approved_at = case
             when coalesce(r.kasper_approved_at, '') = '' then r.kasper_approved_at
             when public.production_native_sample_status_norm(v_video) in ('Client Approval', 'Approved')
               or public.production_native_sample_status_norm(v_graphic) in ('Client Approval', 'Approved')
               then r.kasper_approved_at
             else '' end,
           updated_at = v_now_iso
     where r.client = p_client and r.id = p_sample_id;
  end if;

  insert into public.sample_review_events
    (client, sample_id, ts, actor, role, action, component, from_status, to_status, source, payload)
  values
    (p_client, p_sample_id, now(), null, null, 'status_change', p_component, v_from, v_target, p_source,
     jsonb_build_object(
       'deliverable_id', p_deliverable_id,
       'native_to_status', d.status,
       'origin', d.origin,
       'via', p_via));
  return true;
end;
$fn$;

revoke all on function public.production_native_sample_status_apply(text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.production_native_sample_status_apply(text, text, text, text, text, text, timestamptz)
  to service_role;

-- ------------------------------------------------------------
-- The trigger. SECURITY INVOKER, exactly like the Calendar bridge: `deliverables`
-- is writable only by service_role, which already holds full DML on
-- `sample_reviews` and `sample_review_events`. Plain AFTER UPDATE FOR EACH ROW
-- with the status test in the body (the deploy preflight requires tgqual null).
-- ------------------------------------------------------------
create or replace function public.production_native_sample_status_project()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_card_id text;
  v_component text;
begin
  if new.status is not distinct from old.status then return null; end if;
  if coalesce(new.origin, '') <> 'samples' then return null; end if;
  v_card_id := nullif(btrim(coalesce(new.card_id, '')), '');
  if v_card_id is null then return null; end if;

  -- Which component this is: whichever slot the SAMPLE points back through.
  select case when r.video_deliverable_id = new.id then 'video' else 'graphic' end
    into v_component
  from public.sample_reviews r
  where r.client = new.client_slug and r.id = v_card_id
    and (r.video_deliverable_id = new.id or r.graphic_deliverable_id = new.id)
  limit 1;
  if v_component is null then return null; end if;

  perform public.production_native_sample_status_apply(
    new.client_slug, v_card_id, v_component, new.id, 'native-bridge', 'trigger', null);
  return null;
end;
$fn$;

revoke all on function public.production_native_sample_status_project() from public, anon, authenticated;
grant execute on function public.production_native_sample_status_project() to service_role;

drop trigger if exists zzz_native_sample_status_project on public.deliverables;
create trigger zzz_native_sample_status_project
  after update on public.deliverables
  for each row
  execute function public.production_native_sample_status_project();

-- ------------------------------------------------------------
-- Catch-up: finish every sample whose work item is ahead.
-- p_apply false reports only (the default of the driving script).
-- ------------------------------------------------------------
create or replace function public.production_native_sample_status_backfill(
  p_since timestamptz, p_apply boolean
) returns table (
  client text, sample_id text, component text, deliverable_id text,
  sample_status text, target_status text, deliverable_status_at timestamptz, applied boolean
)
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_apply boolean := coalesce(p_apply, false);
  c record;
  v_done boolean;
begin
  if p_since is null then raise exception 'native_sample_backfill_since_required'; end if;

  for c in
    select r.client as c_client, r.id as c_id, s.component as c_component, d.id as c_did,
           s.sample_status as c_from, m.target_status as c_to, d.status_at as c_at
    from public.sample_reviews r
    join lateral (values
      ('video', r.video_deliverable_id, r.video_status, r.video_status_at),
      ('graphic', r.graphic_deliverable_id, r.graphic_status, r.graphic_status_at)
    ) as s(component, deliverable_id, sample_status, sample_stamp) on s.deliverable_id is not null
    join public.deliverables d
      on d.id = s.deliverable_id and d.client_slug = r.client and d.origin = 'samples' and d.card_id = r.id
    cross join lateral (select public.production_native_calendar_status_map(d.status, d.origin) as target_status) m
    where lower(btrim(coalesce(r.status, ''))) <> 'archived'
      and d.status_at is not null and d.status_at >= p_since
      and m.target_status is not null
      and s.sample_status is distinct from m.target_status
      and (s.sample_stamp is null or s.sample_stamp < d.status_at)
    order by d.status_at
  loop
    v_done := false;
    if v_apply then
      v_done := public.production_native_sample_status_apply(
        c.c_client, c.c_id, c.c_component, c.c_did, 'native-bridge', 'backfill', p_since);
    end if;
    client := c.c_client; sample_id := c.c_id; component := c.c_component; deliverable_id := c.c_did;
    sample_status := c.c_from; target_status := c.c_to; deliverable_status_at := c.c_at; applied := v_done;
    return next;
  end loop;
end;
$fn$;

revoke all on function public.production_native_sample_status_backfill(timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.production_native_sample_status_backfill(timestamptz, boolean)
  to service_role;

-- ROLLBACK (data already projected stays; it was correct):
--   drop trigger if exists zzz_native_sample_status_project on public.deliverables;
--   drop function if exists public.production_native_sample_status_backfill(timestamptz, boolean);
--   drop function if exists public.production_native_sample_status_project();
--   drop function if exists public.production_native_sample_status_apply(text, text, text, text, text, text, timestamptz);
--   drop function if exists public.production_native_sample_overall_status(text, text);
--   drop function if exists public.production_native_sample_status_norm(text);
