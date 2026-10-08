-- ============================================================
-- Native calendar status bridge: N/A wins, and a one-client backfill.
-- (OPEN_REPAIRS 373; written 2026-10-08, NOT APPLIED. Owner applies.)
-- ============================================================
--
-- WHY. The card-vs-calendar drift gate has been red since 2026-10-01 16:48Z on
-- two posts.
--
-- 1. A real client's card an SMM set to N/A on 2026-10-07 while its video and
--    thumbnail work items are still `approved` and `tweak`. N/A is a
--    calendar-only choice (SMM-set only, never gated), the bridge never
--    produces it, and nothing sends it to the work item, so the gate called it
--    drift and the trigger would have overwritten it at the work item's next
--    move (it already did once, on 2026-09-22). Owner decision 2026-10-08:
--    N/A WINS. The trigger and both backfills now leave an N/A slot alone, and
--    scripts/card-calendar-status-drift-check.js lists N/A slots in their own
--    non-gating bucket, so the SQL and the checker keep one rule.
--
-- 2. The TEST client's card: a direct database session set its video and
--    graphic slots to Approved on 2026-10-01 and again on 2026-10-02, 57
--    minutes after the backfill had put them back. The trigger only fires when
--    a deliverable moves, so it never saw those card writes. The sanctioned
--    repair is the backfill, but the two-argument backfill has no client bound;
--    the three-argument overload below is the same body plus a required
--    `p.client = p_client`, so the repair touches one client only.
--
-- WHAT CHANGES.
--   * production_native_calendar_status_project(): the 2026-10-01 body plus
--     one guard per component update (`<> 'N/A'`). Nothing else.
--   * production_native_calendar_status_backfill(timestamptz, boolean): the
--     2026-09-18 repair body plus the same N/A exclusion in its scope.
--   * production_native_calendar_status_backfill(timestamptz, boolean, text):
--     NEW. The same body, the N/A exclusion, and a required client bound (an
--     empty client raises instead of meaning "everyone"). Events carry
--     `client_scope`.
--
-- AFTER APPLYING (owner, SQL editor, test client only):
--   select * from public.production_native_calendar_status_backfill(
--     '2026-09-18T22:38:14Z'::timestamptz, false, 'sidneylaruel');  -- dry run
--   select * from public.production_native_calendar_status_backfill(
--     '2026-09-18T22:38:14Z'::timestamptz, true,  'sidneylaruel');  -- apply
--
-- DEPLOY PREFLIGHT. scripts/linear-exit-deploy-preflight.js pins the bodies of
-- project() (to the 2026-10-01 file) and of the two-argument backfill (to the
-- 2026-09-18 repair). Both bodies change here, so ONCE THIS IS APPLIED LIVE
-- those two pins must be re-pointed at this file, in the next PR, before the
-- next Section 4 dispatch, or the preflight refuses. They are not re-pointed
-- now on purpose: a pin for a body that is not live refuses too.
--
-- PRIVILEGES. Supabase grants every role on a new function by default, so each
-- revoke names all four; service_role keeps EXECUTE on purpose, as before.
--
-- Idempotent. WAY BACK: re-run migrations/2026-10-01-calendar-overall-status-bridge.sql
-- (project() only) and migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql,
-- then drop function public.production_native_calendar_status_backfill(timestamptz, boolean, text).

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
       -- N/A wins (owner, 2026-10-08): an SMM's N/A says this post does not
       -- need the piece, and a later move of the work item must not undo it.
       and coalesce(btrim(p.video_status), '') <> 'N/A'
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
       and coalesce(btrim(p.graphic_status), '') <> 'N/A'
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

revoke all on function public.production_native_calendar_status_project() from public, anon, authenticated, service_role;
grant execute on function public.production_native_calendar_status_project() to service_role;

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
  truncate table native_calendar_backfill_scope;

  create temporary table if not exists native_calendar_backfill_applied (
    post_id text, component text, deliverable_id text
  ) on commit drop;
  truncate table native_calendar_backfill_applied;

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
    and s.card_status is distinct from m.target_status
    -- N/A wins (owner, 2026-10-08), exactly as in the trigger above.
    and coalesce(btrim(s.card_status), '') <> 'N/A';

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

revoke all on function public.production_native_calendar_status_backfill(timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function public.production_native_calendar_status_backfill(timestamptz, boolean) to service_role;

create or replace function public.production_native_calendar_status_backfill(
  p_since timestamptz, p_apply boolean, p_client text
) returns table (
  client text, post_id text, component text, deliverable_id text,
  card_status text, target_status text, deliverable_status_at timestamptz, applied boolean
)
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_apply boolean := coalesce(p_apply, false);
  v_client text := btrim(coalesce(p_client, ''));
begin
  if p_since is null then raise exception 'native_calendar_backfill_since_required'; end if;
  if v_client = '' then raise exception 'native_calendar_backfill_client_required'; end if;

  create temporary table if not exists native_calendar_backfill_scope (
    client text, post_id text, component text, deliverable_id text,
    card_status text, target_status text, deliverable_status_at timestamptz,
    deliverable_updated_at timestamptz
  ) on commit drop;
  truncate table native_calendar_backfill_scope;

  create temporary table if not exists native_calendar_backfill_applied (
    post_id text, component text, deliverable_id text
  ) on commit drop;
  truncate table native_calendar_backfill_applied;

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
  where p.client = v_client
    and lower(btrim(coalesce(p.status, ''))) <> 'archived'
    and d.status_at is not null
    and d.status_at >= p_since
    and m.target_status is not null
    and s.card_status is distinct from m.target_status
    -- N/A wins (owner, 2026-10-08), exactly as in the trigger above.
    and coalesce(btrim(s.card_status), '') <> 'N/A';

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
             'client_scope', v_client,
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

revoke all on function public.production_native_calendar_status_backfill(timestamptz, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.production_native_calendar_status_backfill(timestamptz, boolean, text) to service_role;
