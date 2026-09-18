-- ============================================================
-- Repair: the backfill routine could not be called through the API at all.
--
-- WHAT WAS MEASURED.
--
-- `migrations/2026-09-18-native-calendar-status-bridge.sql` applied live at
-- 22:38Z on 2026-09-18 and the trigger half works. The backfill half does not:
-- every call through PostgREST, in dry-run as well as apply, refuses with
-- SQLSTATE 21000 "DELETE requires a WHERE clause" before it reads a single row.
--
-- WHY, AND WHY IT PASSED EVERY TEST.
--
-- The routine clears its two `on commit drop` temp tables at entry, so a second
-- call inside one transaction cannot see the first call's rows. It cleared them
-- with a bare `delete from <table>;`.
--
-- Supabase loads the `safeupdate` guard for the API role that PostgREST
-- connects as. That guard rejects any DELETE or UPDATE whose plan carries no
-- qualifier, and it does not care that the table is a temporary one this
-- routine owns and is about to drop. The disposable-cluster fixture is a plain
-- PostgreSQL 17 with no such guard loaded and no PostgREST in front of it, so
-- the statement was legal there and all 38 assertions were honestly green. The
-- gap is not in the SQL's logic; it is that the offline lane exercises the
-- routine through a connection the live caller never uses.
--
-- THE FIX, AND WHY `truncate` RATHER THAN `delete ... where true`.
--
-- Both were on the table. `where true` is folded away by the planner before
-- the guard inspects the plan, so it is not reliably a qualifier at all -- it
-- would be a fix that depends on the guard not constant-folding, which is
-- exactly the kind of thing that changes under us. `truncate` is not a DELETE,
-- so the guard has nothing to say about it, and on a temp table it is also the
-- cheaper statement. It takes an ACCESS EXCLUSIVE lock, which on a table
-- private to this backend and created moments earlier is uncontended.
--
-- WHAT THIS MIGRATION CHANGES.
--
-- Two statements, and nothing else. The function is replaced in full because
-- `create or replace function` has no smaller unit, but the body below was
-- extracted from the applied migration and patched by script rather than
-- retyped, and `test/migration-bare-delete-lint.js` holds the two files to the
-- same body apart from those two lines. Signature, search_path and grants are
-- unchanged, so the deploy preflight's routine key is unchanged too -- only the
-- file it is attributed to moves.
--
-- The applied migration is NOT edited. It ran against production; a migration
-- that has run is a historical record and rewriting it would make the ledger
-- describe a database that never existed.
-- ============================================================

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
