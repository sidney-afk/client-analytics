-- APPLIED 2026-10-01 by Lighthouse after the owner's go; EXECUTION_LOG.md
-- records the apply, the repair and the read-back.
-- ============================================================
-- Calendar OVERALL status follows the component the bridge moves.
--
-- THE HOLE THIS FILLS.
--
-- `calendar_posts.status` is the card's overall status: the worst of its three
-- component statuses (video, graphic, caption), computed by
-- `computeOverallStatus` in the page every time the Calendar saves a card. The
-- native status bridge (migrations/2026-09-18-native-calendar-status-bridge.sql)
-- moves a COMPONENT status when an editor changes a work item on the Production
-- side, and said in so many words that it left the overall alone ("recomputed
-- by the next calendar write"). So every editor status change left the overall
-- stale until somebody saved the card in the Calendar.
--
-- Measured read-only 2026-10-01: of 910 non-archived Calendar cards that have a
-- linked work item, 5 disagreed with their own parts at the first look and 9 an
-- hour later, the new ones minutes old and arriving in sibling pairs (an editor
-- delivering a batch): video moved to For SMM Approval by the bridge while the
-- card's overall stayed Tweaks Needed, so the card read as needing tweaks that
-- were already made.
--
-- WHAT THIS DOES.
--   1. `production_native_calendar_status_norm` and
--      `production_native_calendar_overall_status`: an exact SQL copy of the
--      page's `_calNormStatus` + `computeOverallStatus` (worst wins; N/A has no
--      priority and never drags; all three N/A or unknown returns the first
--      lane; an empty lane counts as In Progress; legacy spellings are folded).
--      test/native-calendar-overall-status-bridge.js executes the page's own
--      functions and compares them with these over every triple of a value list.
--   2. Re-defines `production_native_calendar_status_project()` (same name,
--      signature, SECURITY INVOKER, no WHEN clause) so the SAME UPDATE that moves
--      the component also sets `status`. Every existing behaviour is unchanged:
--      stale approval stamps, the event row, and the `is distinct from` guards
--      that keep a no-op projection from re-stamping `video_status_at` (the
--      urgent ping's dedupe key). The event row's payload gains
--      `overall_from_status` / `overall_to_status`.
--   3. `production_native_calendar_overall_status_repair(p_apply)`: lists, and
--      with p_apply true fixes, the cards whose overall already disagrees.
--      Compare-and-set per row. Driven by scripts/native-calendar-overall-repair.js,
--      dry-run by default.
--
-- WHAT IT DELIBERATELY DOES NOT DO.
--   * It does not touch `production_native_calendar_status_backfill`. That is a
--     one-off catch-up whose only job is the component column; if it is ever
--     re-run, the repair above finishes the overall. Re-defining it as well would
--     change a second pinned routine body for no behavioural gain.
--   * It does not write when the component already holds the mapped value (the
--     guard), so a card whose overall went stale some other way is healed by the
--     repair function, not by a no-op trigger firing.
--   * It does not recompute approval stamps for the overall; the component-scoped
--     clearing in the trigger is unchanged.
--   * KNOWN, UNREACHABLE DIFFERENCE: the page looks statuses up in a plain object,
--     so a status literally spelled like an Object.prototype member
--     (`constructor`, `toString`) is treated by it as ranked. No writer can store
--     such a value. The SQL treats it as an unknown value that never drags.
--
-- DEPLOY PREFLIGHT. scripts/linear-exit-deploy-preflight.js pins
-- `production_native_calendar_status_project()` by NAME, SIGNATURE, trigger name,
-- tgtype 17 and tgqual null (all unchanged here) AND by the md5 of the routine
-- body found in migrations/2026-09-18-native-calendar-status-bridge.sql. The body
-- changes here, so once this migration is applied live the preflight must be
-- re-pointed at THIS file for that one routine (see OPEN_REPAIRS 316). The two new
-- routines below are not pinned yet, on purpose: a pin for a routine that is not
-- live makes the preflight refuse a deploy.
--
-- Idempotent; safe to run more than once. Rollback at the bottom.
-- ============================================================

-- ------------------------------------------------------------
-- `_calNormStatus`, in SQL. JavaScript's trim() strips Unicode white space, so
-- the same set is stripped here rather than only ASCII spaces.
-- ------------------------------------------------------------
create or replace function public.production_native_calendar_status_norm(p_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  with t as (
    select coalesce(regexp_replace(coalesce(p_status, ''),
      '^[\s   -     　﻿]+|[\s   -     　﻿]+$', '', 'g'), '') as v
  )
  select case
    when v = '' then 'In Progress'
    when lower(v) = 'draft' then 'In Progress'
    when lower(v) in ('kasper approval', 'for kasper approval') then 'Kasper Approval'
    when lower(v) = 'smm approval' then 'For SMM Approval'
    when lower(v) = 'n/a' then 'N/A'
    when lower(v) = 'in progress' then 'In Progress'
    when lower(v) = 'for smm approval' then 'For SMM Approval'
    when lower(v) = 'client approval' then 'Client Approval'
    when lower(v) = 'tweaks needed' then 'Tweaks Needed'
    when lower(v) = 'approved' then 'Approved'
    when lower(v) = 'scheduled' then 'Scheduled'
    when lower(v) = 'posted' then 'Posted'
    else v
  end from t;
$fn$;

revoke all on function public.production_native_calendar_status_norm(text) from public, anon, authenticated;
grant execute on function public.production_native_calendar_status_norm(text) to service_role;

-- ------------------------------------------------------------
-- `computeOverallStatus`, in SQL. Lowest priority among the ranked lanes wins
-- (Tweaks Needed, In Progress, For SMM Approval, Kasper Approval, Client
-- Approval, Approved, Scheduled, Posted). A lane with no priority (N/A, or a
-- value nobody recognises) never wins; if every lane is like that, the first
-- lane's normalised value is returned, exactly as the page does.
-- ------------------------------------------------------------
create or replace function public.production_native_calendar_overall_status(
  p_video text, p_graphic text, p_caption text
) returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  with s(ord, v) as (
    values (1, public.production_native_calendar_status_norm(p_video)),
           (2, public.production_native_calendar_status_norm(p_graphic)),
           (3, public.production_native_calendar_status_norm(p_caption))
  ), r as (
    select ord, v, case v
      when 'Tweaks Needed' then 0 when 'In Progress' then 1 when 'For SMM Approval' then 2
      when 'Kasper Approval' then 3 when 'Client Approval' then 4 when 'Approved' then 5
      when 'Scheduled' then 6 when 'Posted' then 7 else null end as rk
    from s
  )
  select coalesce(
    (select v from r where rk is not null order by rk, ord limit 1),
    (select v from r where ord = 1));
$fn$;

revoke all on function public.production_native_calendar_overall_status(text, text, text) from public, anon, authenticated;
grant execute on function public.production_native_calendar_overall_status(text, text, text) to service_role;

-- ------------------------------------------------------------
-- The projection, with the overall status riding in the same UPDATE.
-- Same name, signature, SECURITY INVOKER, no WHEN clause. The trigger
-- zzz_native_calendar_status_project is untouched and keeps pointing at it.
-- ------------------------------------------------------------
create or replace function public.production_native_calendar_status_project()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_target text;
  v_card_id text;
  v_component text;
  v_from text;
  v_overall_from text;
  v_overall_to text;
  v_touched integer;
begin
  if new.status is not distinct from old.status then return null; end if;

  -- Only the calendar surface. Samples-origin rows link to sample_reviews and
  -- are out of scope; manual rows link to no card at all.
  if coalesce(new.origin, '') <> 'calendar' then return null; end if;

  v_card_id := nullif(btrim(coalesce(new.card_id, '')), '');
  if v_card_id is null then return null; end if;

  v_target := public.production_native_calendar_status_map(new.status, new.origin);
  -- No calendar equivalent: leave the card exactly as it was.
  if v_target is null then return null; end if;

  -- Which component this is, is decided by which slot the CARD points back
  -- through, never by the deliverable's own kind/team. That is the link the
  -- calendar renders and the reconciler compares, and a deliverable whose card
  -- does not claim it is not this card's component.
  select case when p.video_deliverable_id = new.id then 'video' else 'graphic' end
    into v_component
  from public.calendar_posts p
  where p.client = new.client_slug
    and p.id = v_card_id
    and (p.video_deliverable_id = new.id or p.graphic_deliverable_id = new.id)
    -- Archived cards are out of scope here exactly as they are in the
    -- reconciler and in the backfill below: an archived card is not a surface
    -- anyone reads, and moving its status would only make the three disagree.
    and lower(btrim(coalesce(p.status, ''))) <> 'archived'
  limit 1;
  if v_component is null then return null; end if;

  if v_component = 'video' then
    select p.video_status, p.status into v_from, v_overall_from from public.calendar_posts p
      where p.client = new.client_slug and p.id = v_card_id and p.video_deliverable_id = new.id;
    -- The `is distinct from` predicate is load-bearing, not a micro-
    -- optimisation: it is what keeps a no-op projection from re-stamping
    -- video_status_at and re-opening an already-pinged urgent tweak round.
    -- See the notification note at the top of
    -- migrations/2026-09-18-native-calendar-status-bridge.sql.
    -- The overall `status` rides in this SAME statement and so inherits the
    -- same guard: a no-op projection touches no row and writes nothing.
    update public.calendar_posts p
       set video_status = v_target,
           status = public.production_native_calendar_overall_status(v_target, p.graphic_status, p.caption_status),
           client_video_approved_at = case
             when public.production_native_calendar_status_above(v_target) then p.client_video_approved_at
             when coalesce(p.client_video_approved_at, '') = '' then p.client_video_approved_at
             else '' end,
           kasper_approved_at = case
             when coalesce(p.kasper_approved_at, '') = '' then p.kasper_approved_at
             when public.production_native_calendar_status_above(v_target)
               or public.production_native_calendar_status_above(p.graphic_status)
               or public.production_native_calendar_status_above(p.caption_status)
               then p.kasper_approved_at
             else '' end,
           updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     where p.client = new.client_slug
       and p.id = v_card_id
       and p.video_deliverable_id = new.id
       and lower(btrim(coalesce(p.status, ''))) <> 'archived'
       and p.video_status is distinct from v_target
    returning p.status into v_overall_to;
  else
    select p.graphic_status, p.status into v_from, v_overall_from from public.calendar_posts p
      where p.client = new.client_slug and p.id = v_card_id and p.graphic_deliverable_id = new.id;
    update public.calendar_posts p
       set graphic_status = v_target,
           status = public.production_native_calendar_overall_status(p.video_status, v_target, p.caption_status),
           client_graphic_approved_at = case
             when public.production_native_calendar_status_above(v_target) then p.client_graphic_approved_at
             when coalesce(p.client_graphic_approved_at, '') = '' then p.client_graphic_approved_at
             else '' end,
           kasper_approved_at = case
             when coalesce(p.kasper_approved_at, '') = '' then p.kasper_approved_at
             when public.production_native_calendar_status_above(v_target)
               or public.production_native_calendar_status_above(p.video_status)
               or public.production_native_calendar_status_above(p.caption_status)
               then p.kasper_approved_at
             else '' end,
           updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     where p.client = new.client_slug
       and p.id = v_card_id
       and p.graphic_deliverable_id = new.id
       and lower(btrim(coalesce(p.status, ''))) <> 'archived'
       and p.graphic_status is distinct from v_target
    returning p.status into v_overall_to;
  end if;
  get diagnostics v_touched = row_count;
  if v_touched = 0 then return null; end if;

  -- One event row per projection that actually moved the card, with a source
  -- distinct from every existing writer's: 'ui' is the calendar's own save,
  -- 'db' is the Kasper ping ledger trigger, 'reconcile' is the Linear
  -- reconciler. `actor` and `role` are null because a row trigger on
  -- `deliverables` does not see the request context -- the same honest gap the
  -- Kasper ping ledger trigger records; the receipt that caused the change
  -- carries the actor.
  insert into public.calendar_post_events
    (client, post_id, ts, actor, role, action, component, from_status, to_status, source, payload)
  values
    (new.client_slug, v_card_id, now(), null, null,
     'status_change', v_component, v_from, v_target, 'native-bridge',
     jsonb_build_object(
       'deliverable_id', new.id,
       'native_from_status', old.status,
       'native_to_status', new.status,
       'origin', new.origin,
       'team', new.team,
       'kind', new.kind,
       'overall_from_status', v_overall_from,
       'overall_to_status', v_overall_to,
       'via', 'trigger'));
  return null;
end;
$fn$;

revoke all on function public.production_native_calendar_status_project() from public, anon, authenticated;
grant execute on function public.production_native_calendar_status_project() to service_role;

-- ------------------------------------------------------------
-- Repair: cards whose overall status disagrees with their parts.
--
-- Scope: not archived, and linked to at least one work item (the cards the
-- bridge manages). A card with no work item is not the bridge's, and the
-- Calendar's own save keeps it right.
--
-- p_apply false (the default) only reports. With p_apply true each card is
-- locked, its overall RECOMPUTED FROM ITS CURRENT COMPONENTS, and updated only
-- if it still differs -- so a card saved from the Calendar a moment after the
-- scan is left alone, and a rerun finds nothing. `applied` is per row, read back
-- from what the UPDATE returned. The component columns and every stamp are
-- never written, so nothing re-opens an urgent tweak round.
-- ------------------------------------------------------------
create or replace function public.production_native_calendar_overall_status_repair(
  p_apply boolean default false
) returns table (
  client text, post_id text, from_status text, to_status text, applied boolean
)
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_apply boolean := coalesce(p_apply, false);
  c record;
  v_cur record;
  v_to text;
begin
  for c in
    select p.client as c_client, p.id as c_id
    from public.calendar_posts p
    where lower(btrim(coalesce(p.status, ''))) <> 'archived'
      and (coalesce(p.video_deliverable_id, '') <> '' or coalesce(p.graphic_deliverable_id, '') <> '')
      and p.status is distinct from
          public.production_native_calendar_overall_status(p.video_status, p.graphic_status, p.caption_status)
    order by p.client, p.id
  loop
    if v_apply then
      select p.status, p.video_status, p.graphic_status, p.caption_status into v_cur
        from public.calendar_posts p
       where p.client = c.c_client and p.id = c.c_id
       for update;
      if not found then continue; end if;
      v_to := public.production_native_calendar_overall_status(v_cur.video_status, v_cur.graphic_status, v_cur.caption_status);
      if lower(btrim(coalesce(v_cur.status, ''))) <> 'archived'
         and v_cur.status is distinct from v_to then
        update public.calendar_posts p
           set status = v_to,
               updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         where p.client = c.c_client and p.id = c.c_id;
        insert into public.calendar_post_events
          (client, post_id, ts, actor, role, action, component, from_status, to_status, source, payload)
        values
          (c.c_client, c.c_id, now(), null, null, 'overall_status_change', null,
           v_cur.status, v_to, 'native-bridge',
           jsonb_build_object('via', 'repair'));
        client := c.c_client; post_id := c.c_id; from_status := v_cur.status; to_status := v_to; applied := true;
        return next;
        continue;
      end if;
      -- Changed under us (saved from the Calendar, archived, already right):
      -- report nothing for it and write nothing.
      continue;
    end if;
    select p.status, public.production_native_calendar_overall_status(p.video_status, p.graphic_status, p.caption_status)
      into from_status, to_status
      from public.calendar_posts p where p.client = c.c_client and p.id = c.c_id;
    client := c.c_client; post_id := c.c_id; applied := false;
    return next;
  end loop;
end;
$fn$;

revoke all on function public.production_native_calendar_overall_status_repair(boolean)
  from public, anon, authenticated;
grant execute on function public.production_native_calendar_overall_status_repair(boolean)
  to service_role;

-- ROLLBACK (data already corrected stays; it was correct). Restore the previous
-- trigger body by re-running the function block of
-- migrations/2026-09-18-native-calendar-status-bridge.sql, then:
--   drop function if exists public.production_native_calendar_overall_status_repair(boolean);
--   drop function if exists public.production_native_calendar_overall_status(text, text, text);
--   drop function if exists public.production_native_calendar_status_norm(text);
