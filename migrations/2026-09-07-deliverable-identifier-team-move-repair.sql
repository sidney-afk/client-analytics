-- Repair: `deliverables.identifier` still names the team the row has left.
-- OPEN_REPAIRS 161. Owner-applied, SQL Editor. Data only: no schema change,
-- no function, no grant, nothing to deploy. Rollback entry: ROLLBACK.md,
-- "2026-09-07 — identifier team-move repair (data) + deep-link resolution
-- (browser)".
--
-- WHAT IS WRONG. A row carries two identifier columns. `linear_identifier` is
-- refreshed by `linear-inbound` on every webhook. `identifier` is a SNAPSHOT
-- the b1 import took once (scripts/b1-linear-backfill.js writes both from the
-- same Linear value) and nothing has maintained it since: native creation
-- writes it null, and the inbound handler never touches it -- not even in the
-- branch where it detects a team move and rewrites `team`.
--
-- Linear re-keys an issue when its team changes, so an issue filed under a
-- Video parent and then switched to Graphics stops being VID-13553 and becomes
-- GRA-7197. Read from `deliverable_events`: one client's five rows were
-- created 2026-08-24T14:00:11Z, imported at 14:00:51 while still VID-1354x and
-- VID-1355x, and the first webhook at 14:01:30 already carried their GRA
-- numbers. A second client's two rows are the same shape on 2026-08-17, with an
-- eleven-minute gap. The import photographed them mid-move; nothing after it
-- ever corrected the photograph.
--
-- WHO IS AFFECTED. Measured 2026-09-07 over all 6,369 browser-visible rows:
-- exactly 7 disagree, all graphics rows still carrying a VID- snapshot (5 on
-- one client, 2 on another at status `duplicate`). No row carries an
-- `identifier` without a `linear_identifier`, so the cohort below cannot reach
-- the 374 native rows that legitimately have none.
--
-- THE BROWSER NO LONGER DEPENDS ON THIS. `_prodAdapter` reads
-- `linear_identifier` first and keeps a disagreeing snapshot as a resolvable
-- alias (`test/prod-deep-link-linear-identifier.js`), so this statement is not
-- what makes the Workload deep links work -- that shipped separately. This is
-- the data itself, for everything that joins on the column rather than reading
-- the page: reconcilers, audits, and whatever names a SyncView-native card once
-- Linear is retired, which is the column that would inherit these leftovers.
--
-- WHY THE RETIRED NAME IS RECORDED FIRST. Raised by review on PR #1333, and
-- correct: after the update the two columns agree, so the browser's `aliasId`
-- for these rows becomes empty and the retired number stops resolving in the
-- tab. That is the intended end state. No surface in the product has ever
-- EMITTED a link carrying the snapshot (every `_prodOpenDeliverable` caller
-- passes the canonical row id, which is what `_prodSetQuery` writes, and every
-- Workload link carries the current Linear identifier), and a re-keyed number
-- names nothing in Linear either -- so resolving it here for ever would make
-- this tab the last system answering to a name no other system knows. What it
-- must not be is the moment the value stops existing anywhere. Nothing else stores it:
-- `linear_aliases.identifier` was overwritten by the first webhook after the
-- move, and its `history` begins at that webhook, already carrying the new
-- number. So each retired identifier goes into `deliverable_events.payload`
-- before the column moves.
--
-- It goes to the event ledger rather than to `linear_aliases` deliberately.
-- `scripts/b3-linkage-backfill.js` flattens every string in `linear_aliases`
-- and matches cards on it, so parking a retired identifier there could produce
-- a false card match; `deliverable_events.payload` is read by nothing that
-- matches. The action is `update` and the source `backfill`, both shapes the
-- ledger and the detail panel already carry, so this adds no new rendering
-- surface.
--
-- WHY ONE STATEMENT AND NOT TWO. Raised by the same review. Under READ
-- COMMITTED, two statements in one transaction take two snapshots, so a
-- `linear-inbound` write landing between them could leave the update writing a
-- value the ledger row does not describe, or repairing a row that has no ledger
-- row at all -- which is the evidence loss this is here to prevent. The cohort
-- is therefore selected ONCE, `for update`, and both the insert and the update
-- read from that fixed, locked set. The count guard on the update is the same
-- promise stated mechanically: no row's column moves unless its record was
-- written in this statement.
--
-- SAFETY.
--   * Bounded: the cohort is rows where BOTH columns are present and disagree.
--     Seven today, and it can never widen to a row with a null on either side.
--     The insert and the update read the same cohort, so they cannot diverge.
--   * Idempotent: after it runs the cohort is empty, so a second run writes 0
--     events and updates 0 rows.
--   * Atomic and serialized: one statement, one snapshot, rows locked `for
--     update` in id order, inside an explicit transaction.
--   * Fails closed: `identifier` is `text unique`, so if the target value were
--     already held by another row the whole transaction aborts rather than
--     half-applying. Step 1 shows that before you run step 2.
--   * One column on `deliverables`. Status, client, batch, card linkage,
--     assignee and every Linear column are untouched, so no outbound intent is
--     created and nothing is mirrored back to Linear.
--
-- EXPECTED SIDE EFFECTS, all three harmless and deliberate:
--   * `updated_at` moves to now() on the repaired rows (touch trigger).
--     `status_at` does not, because the status does not change.
--   * `track_b_deliverable_ledger_guard` writes its own `deliverable_events`
--     row per updated row: action `update`, source `system`, payload
--     {"op":"UPDATE","reason":"rpc_bypass_guard"}. That is the audit trail for
--     a direct statement and is expected here, beside the explicit row above.
--   * Each repaired deliverable gains one `identifier_team_move_repair` event.
--     Its `event_key` carries the retired value, the value replacing it, and
--     the moment of the repair, so an issue that cycles between teams and is
--     repaired more than once gets a distinct key each time rather than
--     colliding with its own earlier repair (also review #1333).
--
-- REVERSAL. Executable, and in ROLLBACK.md as well:
--   begin;
--   update public.deliverables d
--      set identifier = e.retired
--     from (select distinct on (deliverable_id)
--                  deliverable_id,
--                  payload->>'retired_identifier' as retired,
--                  payload->>'current_identifier' as current_ident
--             from public.deliverable_events
--            where payload->>'op' = 'identifier_team_move_repair'
--            order by deliverable_id, ts desc) e
--    where d.id = e.deliverable_id
--      and d.identifier = e.current_ident
--      and e.retired is not null;
--   commit;
-- It restores only rows still holding the value this repair wrote, so a row
-- that has moved on since is left alone.

-- ---- Step 1: look first. Expect 7 rows, and `collides_with` empty on all. ---
select d.id,
       d.identifier      as old_identifier,
       d.linear_identifier as new_identifier,
       d.team,
       d.status,
       d.client_slug,
       (select o.id
          from public.deliverables o
         where o.id <> d.id
           and o.identifier = d.linear_identifier) as collides_with
  from public.deliverables d
 where d.identifier is not null
   and d.linear_identifier is not null
   and d.identifier <> d.linear_identifier
 order by d.client_slug, d.identifier;

-- ---- Step 2: one locked cohort; record the retired name, then repair. -----
begin;

with cohort as (
    select d.id,
           d.batch_id,
           d.client_slug,
           d.identifier,
           d.linear_identifier
      from public.deliverables d
     where d.identifier is not null
       and d.linear_identifier is not null
       and d.identifier <> d.linear_identifier
     order by d.id
       for update
),
recorded as (
    insert into public.deliverable_events
           (deliverable_id, batch_id, client_slug, action, source, payload, event_key)
    select c.id,
           c.batch_id,
           c.client_slug,
           'update',
           'backfill',
           jsonb_build_object(
             'op', 'identifier_team_move_repair',
             'retired_identifier', c.identifier,
             'current_identifier', c.linear_identifier),
           'identifier-team-move-repair:' || c.id
             || ':' || c.identifier || '->' || c.linear_identifier
             || ':' || to_char(clock_timestamp() at time zone 'utc', 'YYYYMMDD"T"HH24MISSUS')
      from cohort c
    returning deliverable_id
)
update public.deliverables d
   set identifier = c.linear_identifier
  from cohort c
 where d.id = c.id
   and (select count(*) from recorded) = (select count(*) from cohort);

commit;

-- ---- Step 3: prove it. Expect 0, 0, and one row per repaired deliverable. -
select count(*) as still_disagreeing
  from public.deliverables
 where identifier is not null
   and linear_identifier is not null
   and identifier <> linear_identifier;

select count(*) as identifier_duplicates
  from (select identifier
          from public.deliverables
         where identifier is not null
         group by identifier
        having count(*) > 1) dupes;

select deliverable_id,
       payload->>'retired_identifier' as retired_identifier,
       payload->>'current_identifier' as current_identifier
  from public.deliverable_events
 where payload->>'op' = 'identifier_team_move_repair'
 order by deliverable_id;
