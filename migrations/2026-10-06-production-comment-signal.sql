-- ============================================================
-- Production comments wake other open screens (2026-10-06).
--
-- NOT APPLIED. Source-only until Lighthouse applies it with the owner's go.
-- Idempotent (if not exists / create or replace / drop trigger if exists), so
-- re-running it is safe. Rollback: 2026-10-06-production-comment-signal.ROLLBACK.sql.
--
-- THE PROBLEM (docs/ops/2026-10-06-realtime-test-findings.md, finding 2).
-- A comment posted on one screen never reached another open screen live:
-- production_comments is closed to the browser key by design (and stays
-- closed), and the comment rows of deliverable_events are hidden from it by a
-- restrictive policy, so no live message exists. The other screen only saw a
-- comment on its slow poll (30 s, or 90 s while the live link is up).
--
-- THE FIX. A comment insert or edit stamps a NEW column,
-- deliverables.comments_changed_at, on its work item. The Production screen
-- already listens to public.deliverables, so that UPDATE reaches every open
-- screen; a changed stamp makes the screen re-read that one thread (through
-- the staff-authenticated production-comments function, exactly as now).
-- No comment body, author or count is exposed: the browser key can read only
-- the timestamp, which is granted column by column like every other
-- deliverables column (2026-07-23-f34-f53-production-attachments.sql).
-- No Edge Function changes, so no F27 Section 4 capture is needed.
--
-- WHY A SEPARATE COLUMN AND NOT updated_at. deliverables.updated_at is the
-- compare-and-swap clock for every SyncLinear write (production-write
-- assertCas) and the watermark of the screen's delta read. Moving it for a
-- comment would hand every other open tab a write_conflict on its next status
-- change. So:
--   * the stamp is a separate column nothing compares;
--   * zzzz_comment_signal_hold_clock (BEFORE UPDATE, named to sort after
--     track_b_deliverable_touch_timestamps_before and the other zzz_ triggers,
--     which run in name order) puts updated_at back when the stamp is the ONLY
--     column that changed -- the same pattern as zzz_native_label_state_seed
--     (2026-09-18). Any other column difference keeps the normal stamp;
--   * the stamping update sets app.event_written for its own statement only,
--     and restores the previous value afterwards, so the ledger guard
--     (track_b_deliverable_ledger_guard) writes no deliverable_events 'update'
--     row and no provider outbox work is manufactured. Status, the identifier,
--     title and labels are untouched, so the status projections, the
--     identifier guard and the rename recorder are all no-ops.
--
-- NEVER BREAKS A COMMENT SAVE. The stamp runs inside BEGIN/EXCEPTION: any
-- failure is a WARNING and the comment still commits. Backfill and mirror
-- imports (source 'backfill' / 'mirror') do not stamp, so a bulk import never
-- becomes a burst of live events.
--
-- ROLES (CLAUDE.md: name all four). Both functions: revoke all from public,
-- anon, authenticated and service_role; trigger functions need no EXECUTE to
-- fire. The column: SELECT for anon and authenticated (the two roles that
-- already read deliverables column by column), nothing else; service_role keeps
-- the table-level rights it already holds.
-- ============================================================

begin;
set local lock_timeout = '5s';

-- ── 1. The stamp column ───────────────────────────────────────────────────
alter table public.deliverables
  add column if not exists comments_changed_at timestamptz;

comment on column public.deliverables.comments_changed_at is
  'Last time a production comment on this work item was added or edited. A '
  'live-update signal only: never part of a stale-save (CAS) check, and moving '
  'it alone leaves updated_at unchanged (zzzz_comment_signal_hold_clock).';

-- Column grants: deliverables is read by the browser column by column, so a
-- new column is invisible (and absent from realtime payloads) until granted.
-- service_role is named too; its table-level rights are unchanged by a column
-- revoke, and the stamp itself runs as the function owner.
revoke all (comments_changed_at) on table public.deliverables from public, anon, authenticated, service_role;
grant select (comments_changed_at) on table public.deliverables to anon, authenticated;

-- ── 2. Hold the CAS clock when only the stamp moved ──────────────────────
create or replace function public.production_comment_signal_hold_clock()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.comments_changed_at is distinct from old.comments_changed_at
     and (to_jsonb(new) - 'comments_changed_at' - 'updated_at')
         is not distinct from (to_jsonb(old) - 'comments_changed_at' - 'updated_at')
  then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$fn$;

revoke all on function public.production_comment_signal_hold_clock()
  from public, anon, authenticated, service_role;

drop trigger if exists zzzz_comment_signal_hold_clock on public.deliverables;
create trigger zzzz_comment_signal_hold_clock
  before update on public.deliverables
  for each row execute function public.production_comment_signal_hold_clock();

-- ── 3. A comment insert or edit stamps its work item ─────────────────────
create or replace function public.production_comment_signal_stamp()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_prev text;
begin
  if new.deliverable_id is null then return null; end if;
  if coalesce(new.source, '') in ('backfill', 'mirror') then return null; end if;
  begin
    v_prev := current_setting('app.event_written', true);
    -- For this one statement only: the stamp is not an activity event.
    perform set_config('app.event_written', '1', true);
    update public.deliverables
       set comments_changed_at = clock_timestamp()
     where id = new.deliverable_id;
    perform set_config('app.event_written', coalesce(v_prev, ''), true);
  exception when others then
    raise warning 'production_comment_signal_failed: % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$fn$;

revoke all on function public.production_comment_signal_stamp()
  from public, anon, authenticated, service_role;

drop trigger if exists zzz_production_comment_signal on public.production_comments;
create trigger zzz_production_comment_signal
  after insert or update on public.production_comments
  for each row execute function public.production_comment_signal_stamp();

commit;

-- VERIFY (read-only, after applying; test client only for any live write):
--   select column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'deliverables'
--      and column_name = 'comments_changed_at' and privilege_type = 'SELECT'
--    order by grantee;                         -- anon, authenticated (+ owner)
--   select tgname from pg_trigger
--    where tgname in ('zzzz_comment_signal_hold_clock', 'zzz_production_comment_signal');
-- Then post one comment on a test-client work item and check that its
-- comments_changed_at moved, its updated_at did not, and no new
-- deliverable_events row with action 'update' appeared for it.
