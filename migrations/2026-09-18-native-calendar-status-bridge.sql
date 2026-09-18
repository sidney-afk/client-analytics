-- ============================================================
-- Native deliverable status -> content calendar component status.
--
-- THE HOLE THIS FILLS.
--
-- Until the ordinary-receipts flip, an editor's status change on a production
-- card reached the content calendar by a long way round: the card write landed
-- in `deliverables`, the outbound mirror carried it to Linear, and
-- `scripts/linear-sync-reconcile.js` pulled Linear back onto
-- `calendar_posts.video_status` / `graphic_status` on its 15-minute tick. The
-- reconciler is still there and still correct, but native receipts send nothing
-- to Linear, so the middle of that chain is now empty: the reconciler resolves
-- the card's Linear link, gets the stale state it has always had, and its own
-- provenance test (correctly) refuses to write it. Nothing else ever wrote the
-- calendar's copy.
--
-- Measured 2026-09-18: four video cards moved to `smm_approval` between 19:12Z
-- and 19:25Z and the calendar still read "Tweaks Needed" at 20:20Z, when the
-- SMM re-set all four by hand. At 20:44Z ten calendar posts across seven
-- clients were lagging their linked card (six video, four graphics), the oldest
-- since 17:34Z.
--
-- Changes made FROM the calendar already write both copies, so this projects
-- the one direction that was missing.
--
-- ============================================================
-- WHY A TRIGGER AND NOT THE GATEWAY.
--
-- The deciding question is not "where is it tidier" but "what does the
-- reconciler's most-recent-wins ledger expect of this column". That ledger
-- (scripts/linear-sync-reconcile.js) decides direction by comparing the card's
-- EXACT change time -- `calendar_posts.video_status_at` / `graphic_status_at`,
-- stamped by the BEFORE trigger in migrations/calendar-status-at-migration.sql
-- -- against the Linear side's poll time. Its whole reason for existing
-- (LINEAR_DRIFT_INCIDENT_2026-06-19.md) is that a card whose stamp did NOT move
-- when the card really changed looks OLDER than Linear, and the reconciler then
-- pulls a stale Linear value over live work. So the ledger's standing
-- expectation of these two columns is: they move in the same transaction as the
-- authoritative change, on every write path, or its direction logic is wrong.
--
-- A gateway-side projection cannot honour that.
--
--   * It is a second step after the deliverable write. If it fails, is skipped
--     on an error path, or ships in a version of production-write that is not
--     yet deployed, `deliverables.status` has moved and the card's stamp has
--     not -- which is not "the bridge did nothing", it is the reconciler being
--     handed a false ordering and reverting the card. Silence is the one
--     failure mode this column was added to remove.
--   * `production-write` is not the only writer of `deliverables.status`.
--     `deliverable-write`, `batch-write`, the native ordinary-receipt RPC and
--     any repair or backfill all move it. A gateway projection covers exactly
--     the path it is written into; the ledger's expectation is about the
--     column, not about a caller.
--   * Redeploying production-write costs a sealed F27 Section 4 capture and a
--     dispatch. A trigger needs neither, so the repair is not gated on a
--     release window.
--
-- This is the same reasoning, and the same shape, as
-- migrations/2026-09-10-kasper-urgent-ping-ledger.sql, which chose a trigger
-- over an edge-function change for a ledger row and recorded why.
--
-- ============================================================
-- WHY THIS CANNOT SEND A NOTIFICATION TWICE.
--
-- Three things key on the rows this migration writes. All three were read
-- before the projection was written, not after.
--
-- 1. `production_notification_status_intent_after`
--    (migrations/2026-09-18-notification-creative-channel.sql) is the trigger
--    that raises a client-channel "ready for SMM approval" / "needs tweaks"
--    Slack intent. It is a trigger on `deliverable_events`, and it keys on
--    `source = 'ui'` AND `action = 'status_change'`. This migration writes
--    `calendar_posts` and `calendar_post_events` and never writes
--    `deliverable_events`, so it cannot reach that trigger at all. The intent
--    for the editor's change is raised once, by the receipt that caused it.
--
-- 2. `calendar_posts.video_status_at` IS THE URGENT PING'S DEDUPE KEY.
--    `production_notification_enqueue_urgent`
--    (migrations/2026-09-09-native-notification-outbox.sql) builds
--    `intent_key = 'urgent:' || sha256(deliverable_id || '|' || video_status_at)`
--    and relies on `on conflict (intent_key) do nothing` to make a second ping
--    for the same tweak round a no-op. `urgentSnapshot` in production-write
--    requires the card to read exactly `Tweaks Needed` at exactly that stamp.
--    So a write that re-stamps `video_status_at` WITHOUT a real status change
--    mints a fresh intent_key and re-opens a tweak round that was already
--    pinged -- the editor gets the same URGENT message twice.
--
--    That is the hazard, and the guard against it is the reason every write
--    below is predicated on the MAPPED calendar value actually differing from
--    what the card already holds:
--      * a no-op projection updates zero rows, so the BEFORE stamp trigger
--        never runs and no round re-opens;
--      * a native move between two statuses that map to the SAME calendar value
--        (`backlog` -> `todo` -> `in_progress` are all "In Progress") writes
--        nothing;
--      * re-running the backfill writes nothing;
--      * the four cards the SMM already re-set by hand are skipped, because
--        they already hold the mapped value.
--
--    Where the card genuinely moves into `Tweaks Needed` for the first time,
--    the stamp SHOULD move: that is a new tweak round and it is pingable. The
--    urgent ping has in fact been unreachable on natively-changed cards since
--    the flip, because `urgentSnapshot` could never find `Tweaks Needed` on the
--    card. This repairs that too.
--
-- 3. Nothing has a trigger on `calendar_post_events`, and `calendar-upsert`
--    does not send Slack -- it writes event rows. The event row below carries a
--    source of 'native-bridge', distinct from 'ui' (the calendar's own writes),
--    'db' (the Kasper ping ledger trigger) and 'reconcile'.
--
-- ============================================================
-- WHAT IT DELIBERATELY DOES NOT DO.
--
--   * It does not project a status with no calendar equivalent. `triage`,
--     `canceled`, `duplicate` and anything unrecognised map to null and leave
--     the card exactly as it was, and `scheduled` / `posted` map to null on a
--     samples-origin row. That is `_calMapNativeStatusStrict` in index.html,
--     mirrored below and held to it by test/native-calendar-status-bridge.js.
--   * It does not fall back to `deliverables.card_id` when the card's own slot
--     column does not point back. The link the calendar reads, the reconciler
--     reads and this projects is `calendar_posts.video_deliverable_id` /
--     `graphic_deliverable_id`; projecting onto a card that does not claim the
--     deliverable would write a status onto a row no one linked.
--   * It does not touch `sample_reviews`. Samples carry their own review
--     lifecycle and are not this regression.
-- ============================================================
-- STALE APPROVAL STAMPS, CLEARED IN THE SAME TRANSACTION.
--
-- A component that regresses -- `approved` -> `tweak` is the ordinary case --
-- leaves the client's sign-off stamp behind if only the status moves, so the
-- card reads "Tweaks Needed" while still carrying a client approval, and a
-- reload does not repair it. `_calClearStaleApprovals` in index.html is the
-- rule the calendar's own writes apply, and this mirrors it for the component
-- that regressed:
--
--   * `client_<component>_approved_at` is cleared when the new value is not one
--     of {Client Approval, Approved, Scheduled, Posted};
--   * `kasper_approved_at` is cleared when, after the change, NONE of the three
--     components (video, graphic, caption) is above that line.
--
-- Scoped to the component this projection moves, deliberately. The page's rule
-- sweeps every component, but a stamp that was already stale on a component
-- this change did not touch was stale before it too, and repairing it here
-- would be this projection making a change nothing asked it to make. Title is
-- outside `CAL_COMPONENTS` and outside this projection entirely.
--
--   * It does not recompute the card's OVERALL `status` column. That is
--     `computeOverallStatus` plus `_calClearStaleApprovals` in index.html --
--     approval-clearing logic with client-visible consequences that has never
--     had a server-side twin, and inventing a second one in SQL is how the two
--     drift. The component status and its stamp are what the calendar renders
--     per component and what the reconciler compares; the overall roll-up is
--     recomputed by the next calendar write, exactly as it is today.
--   * It does not swallow its own errors. The Kasper ping ledger trigger does,
--     on purpose, because a missing ledger row is never worth a failed client
--     save. This projection is not bookkeeping -- it IS the feature, and a
--     silently skipped projection is precisely the invisible lag being
--     repaired. It runs in the same transaction as the deliverable write, so a
--     failure means neither happened and the editor is told, rather than the
--     card going quietly stale again.
--
-- Idempotent; safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- The mapping, mirrored from index.html `_calMapNativeStatusStrict`.
--
-- The app's copy stays canonical: it is the one mapper the browser and the
-- reconciler both bind to (linear-sync-reconcile.js extracts it from
-- index.html at runtime precisely so it cannot drift). This is a second copy
-- and a second copy is how a mapping drifts, so test/native-calendar-status-bridge.js
-- extracts BOTH -- the JS out of index.html, the pairs out of this file -- and
-- compares them over every value `deliverables.status` can hold, in both
-- origins. A status added to one and not the other fails that suite.
-- ------------------------------------------------------------
create or replace function public.production_native_calendar_status_map(
  p_status text, p_origin text
) returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case lower(btrim(coalesce(p_status, '')))
    when 'in_progress' then 'In Progress'
    when 'backlog' then 'In Progress'
    when 'todo' then 'In Progress'
    when 'smm_approval' then 'For SMM Approval'
    when 'kasper_approval' then 'Kasper Approval'
    when 'client_approval' then 'Client Approval'
    when 'tweak' then 'Tweaks Needed'
    when 'approved' then 'Approved'
    -- A samples-origin row has no calendar Scheduled/Posted equivalent, so it
    -- maps to null and leaves the card untouched.
    when 'scheduled' then case when lower(btrim(coalesce(p_origin, ''))) = 'samples' then null else 'Scheduled' end
    when 'posted' then case when lower(btrim(coalesce(p_origin, ''))) = 'samples' then null else 'Posted' end
    -- triage / canceled / duplicate / unrecognised / empty: no calendar
    -- equivalent, so the card is left exactly as it was.
    else null
  end;
$fn$;

revoke all on function public.production_native_calendar_status_map(text, text) from public, anon, authenticated;
grant execute on function public.production_native_calendar_status_map(text, text) to service_role;

-- ------------------------------------------------------------
-- "Is this component status above the client-approval line?"
--
-- Mirrored from `_calClearStaleApprovals` in index.html, whose set is
-- {Client Approval, Approved, Scheduled, Posted} and which tests it against
-- `_calNormStatus(...)`. That normaliser can only ever produce one of these
-- four from a case-insensitive match of the same name -- its other branches
-- produce `In Progress`, `Kasper Approval` or `For SMM Approval`, none of which
-- is in the set -- so a case-folded comparison against the four literals is the
-- exact SQL equivalent, not an approximation. Proved that way, over every
-- calendar status and every legacy spelling the normaliser handles, by
-- test/native-calendar-status-bridge.js.
-- ------------------------------------------------------------
create or replace function public.production_native_calendar_status_above(p_status text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select lower(btrim(coalesce(p_status, ''))) in ('client approval', 'approved', 'scheduled', 'posted');
$fn$;

revoke all on function public.production_native_calendar_status_above(text) from public, anon, authenticated;
grant execute on function public.production_native_calendar_status_above(text) to service_role;

-- ------------------------------------------------------------
-- The projection itself.
--
-- SECURITY INVOKER on purpose, exactly as the Kasper ping ledger trigger is:
-- `deliverables` is writable only by service_role, which already holds full
-- DML on `calendar_posts` and `calendar_post_events`, so no privilege
-- escalation is needed and none is granted.
--
-- Plain `after update ... for each row` with the status test in the body,
-- rather than a WHEN clause: the Linear-exit deploy preflight requires
-- `tgqual is null` on every trigger it pins, and a WHEN clause is a tgqual.
-- The body's first statement is the same test.
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
    select p.video_status into v_from from public.calendar_posts p
      where p.client = new.client_slug and p.id = v_card_id and p.video_deliverable_id = new.id;
    -- The `is distinct from` predicate is load-bearing, not a micro-
    -- optimisation: it is what keeps a no-op projection from re-stamping
    -- video_status_at and re-opening an already-pinged urgent tweak round.
    -- See the notification note at the top of this file.
    update public.calendar_posts p
       set video_status = v_target,
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
       and p.video_status is distinct from v_target;
  else
    select p.graphic_status into v_from from public.calendar_posts p
      where p.client = new.client_slug and p.id = v_card_id and p.graphic_deliverable_id = new.id;
    update public.calendar_posts p
       set graphic_status = v_target,
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
       and p.graphic_status is distinct from v_target;
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
       'via', 'trigger'));
  return null;
end;
$fn$;

revoke all on function public.production_native_calendar_status_project() from public, anon, authenticated;
grant execute on function public.production_native_calendar_status_project() to service_role;

drop trigger if exists zzz_native_calendar_status_project on public.deliverables;
create trigger zzz_native_calendar_status_project
  after update on public.deliverables
  for each row
  execute function public.production_native_calendar_status_project();

-- ------------------------------------------------------------
-- The one-off catch-up for cards that already lagged when the trigger landed.
--
-- Driven by scripts/native-calendar-status-backfill.js, which is dry-run by
-- default. Both modes run THIS function, so the report is produced by the code
-- that does the work rather than by a second implementation of the predicate.
--
-- It is deliberately the same predicate as the trigger, so a second run after
-- an applied one reports and changes nothing, and so a card the SMM has
-- already corrected by hand is skipped rather than re-stamped.
-- ------------------------------------------------------------
create or replace function public.production_native_calendar_status_backfill(
  p_since timestamptz, p_apply boolean
) returns table (
  client text, post_id text, component text, deliverable_id text,
  card_status text, target_status text, deliverable_status_at timestamptz, applied boolean
)
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_apply boolean := coalesce(p_apply, false);
begin
  if p_since is null then raise exception 'native_calendar_backfill_since_required'; end if;

  create temporary table if not exists native_calendar_backfill_scope (
    client text, post_id text, component text, deliverable_id text,
    card_status text, target_status text, deliverable_status_at timestamptz,
    deliverable_updated_at timestamptz
  ) on commit drop;
  delete from native_calendar_backfill_scope;

  create temporary table if not exists native_calendar_backfill_applied (
    post_id text, component text, deliverable_id text
  ) on commit drop;
  delete from native_calendar_backfill_applied;

  insert into native_calendar_backfill_scope
  select p.client, p.id, s.component, d.id, s.card_status, m.target_status, d.status_at, d.updated_at
  from public.calendar_posts p
  join lateral (values
    ('video', p.video_deliverable_id, p.video_status),
    ('graphic', p.graphic_deliverable_id, p.graphic_status)
  ) as s(component, deliverable_id, card_status) on s.deliverable_id is not null
  join public.deliverables d
    on d.id = s.deliverable_id
   and d.client_slug = p.client
   and d.origin = 'calendar'
   and d.card_id = p.id
  cross join lateral (select public.production_native_calendar_status_map(d.status, d.origin) as target_status) m
  where lower(btrim(coalesce(p.status, ''))) <> 'archived'
    and d.status_at is not null
    and d.status_at >= p_since
    and m.target_status is not null
    and s.card_status is distinct from m.target_status;

  if v_apply then
    /* COMPARE AND SET, not "apply the snapshot".
     *
     * The rows above were read a statement ago. Between then and now the
     * trigger may have projected the same card (a concurrent native change),
     * or a human may have saved it from the calendar. Writing the snapshot's
     * target at that point would overwrite a NEWER correct value with an older
     * one, and the unconditional event insert would then report a row as
     * applied that it had in fact clobbered or skipped.
     *
     * So each update re-reads the deliverable IN THE SAME STATEMENT and
     * re-derives the target from its live status, and proceeds only when all
     * four still hold: the deliverable has not moved (`status_at` and
     * `updated_at` both match the snapshot), the freshly mapped target equals
     * the one that was reported, the card still holds exactly the value the
     * scan saw, and that value still differs from the target. Anything else
     * leaves the row alone -- correctly, because a concurrent native change has
     * already been projected by the trigger.
     *
     * The events rows are then written from `native_calendar_backfill_applied`,
     * which holds only rows an UPDATE actually returned, so the ledger cannot
     * claim a projection that did not happen. A second run finds an empty scope
     * and writes nothing at all, so re-running still re-stamps no
     * `video_status_at` and re-opens no urgent tweak round.
     */
    with upd as (
      update public.calendar_posts p
         set video_status = b.target_status,
             client_video_approved_at = case
               when public.production_native_calendar_status_above(b.target_status) then p.client_video_approved_at
               when coalesce(p.client_video_approved_at, '') = '' then p.client_video_approved_at
               else '' end,
             kasper_approved_at = case
               when coalesce(p.kasper_approved_at, '') = '' then p.kasper_approved_at
               when public.production_native_calendar_status_above(b.target_status)
                 or public.production_native_calendar_status_above(p.graphic_status)
                 or public.production_native_calendar_status_above(p.caption_status)
                 then p.kasper_approved_at
               else '' end,
             updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from native_calendar_backfill_scope b
        join public.deliverables d
          on d.id = b.deliverable_id
         and d.status_at is not distinct from b.deliverable_status_at
         and d.updated_at is not distinct from b.deliverable_updated_at
         and public.production_native_calendar_status_map(d.status, d.origin) is not distinct from b.target_status
       where b.component = 'video'
         and p.client = b.client and p.id = b.post_id
         and p.video_deliverable_id = b.deliverable_id
         and lower(btrim(coalesce(p.status, ''))) <> 'archived'
         and p.video_status is not distinct from b.card_status
         and p.video_status is distinct from b.target_status
      returning b.post_id, b.component, b.deliverable_id
    )
    insert into native_calendar_backfill_applied select upd.post_id, upd.component, upd.deliverable_id from upd;

    with upd as (
      update public.calendar_posts p
         set graphic_status = b.target_status,
             client_graphic_approved_at = case
               when public.production_native_calendar_status_above(b.target_status) then p.client_graphic_approved_at
               when coalesce(p.client_graphic_approved_at, '') = '' then p.client_graphic_approved_at
               else '' end,
             kasper_approved_at = case
               when coalesce(p.kasper_approved_at, '') = '' then p.kasper_approved_at
               when public.production_native_calendar_status_above(b.target_status)
                 or public.production_native_calendar_status_above(p.video_status)
                 or public.production_native_calendar_status_above(p.caption_status)
                 then p.kasper_approved_at
               else '' end,
             updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from native_calendar_backfill_scope b
        join public.deliverables d
          on d.id = b.deliverable_id
         and d.status_at is not distinct from b.deliverable_status_at
         and d.updated_at is not distinct from b.deliverable_updated_at
         and public.production_native_calendar_status_map(d.status, d.origin) is not distinct from b.target_status
       where b.component = 'graphic'
         and p.client = b.client and p.id = b.post_id
         and p.graphic_deliverable_id = b.deliverable_id
         and lower(btrim(coalesce(p.status, ''))) <> 'archived'
         and p.graphic_status is not distinct from b.card_status
         and p.graphic_status is distinct from b.target_status
      returning b.post_id, b.component, b.deliverable_id
    )
    insert into native_calendar_backfill_applied select upd.post_id, upd.component, upd.deliverable_id from upd;

    insert into public.calendar_post_events
      (client, post_id, ts, actor, role, action, component, from_status, to_status, source, payload)
    select b.client, b.post_id, now(), null, null,
           'status_change', b.component, b.card_status, b.target_status, 'native-bridge',
           jsonb_build_object(
             'deliverable_id', b.deliverable_id,
             'deliverable_status_at', b.deliverable_status_at,
             'since', p_since,
             'via', 'backfill')
    from native_calendar_backfill_scope b
    join native_calendar_backfill_applied a
      on a.post_id = b.post_id and a.component = b.component and a.deliverable_id = b.deliverable_id;
  end if;

  /* `applied` is per row, read back from what the UPDATE returned -- never a
   * blanket echo of the p_apply flag. A dry run reports false everywhere; an
   * apply reports false for a row a concurrent change took out from under it,
   * which is the signal that row was not projected here. */
  return query
    select b.client, b.post_id, b.component, b.deliverable_id,
           b.card_status, b.target_status, b.deliverable_status_at,
           (a.post_id is not null) as applied
    from native_calendar_backfill_scope b
    left join native_calendar_backfill_applied a
      on a.post_id = b.post_id and a.component = b.component and a.deliverable_id = b.deliverable_id
    order by b.deliverable_status_at asc, b.client asc, b.post_id asc, b.component asc;
end;
$fn$;

revoke all on function public.production_native_calendar_status_backfill(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.production_native_calendar_status_backfill(timestamptz, boolean) to service_role;
