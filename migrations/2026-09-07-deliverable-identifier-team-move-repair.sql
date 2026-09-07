-- Repair: `deliverables.identifier` still names the team the row has left.
-- OPEN_REPAIRS 160. Owner-applied, SQL Editor. Data only: no schema change,
-- no function, no grant, nothing to deploy.
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
-- `identifier` without a `linear_identifier`, so the predicate below cannot
-- reach the 374 native rows that legitimately have none.
--
-- THE BROWSER NO LONGER DEPENDS ON THIS. `_prodAdapter` reads
-- `linear_identifier` first and keeps the snapshot as a resolvable alias
-- (`test/prod-deep-link-linear-identifier.js`), so this statement is not what
-- makes the Workload deep links work -- that shipped separately. This is the
-- data itself, for everything that joins on the column rather than reading the
-- page: reconcilers, audits, and whatever names a SyncView-native card once
-- Linear is retired, which is the column that would inherit these leftovers.
--
-- SAFETY.
--   * Bounded: only rows where BOTH columns are present and disagree. Seven
--     today, and it can never widen to a row with a null on either side.
--   * Idempotent: after it runs the predicate matches nothing, so a second run
--     updates 0 rows.
--   * Fails closed: `identifier` is `text unique`, so if the target value were
--     already held by another row the whole statement aborts rather than
--     half-applying. Step 1 shows that before you run step 2.
--   * One column. Status, client, batch, card linkage, assignee and every
--     Linear column are untouched, so no outbound intent is created and
--     nothing is mirrored back to Linear.
--
-- EXPECTED SIDE EFFECTS, both harmless and both deliberate:
--   * `updated_at` moves to now() on those 7 rows (touch trigger). `status_at`
--     does not, because the status does not change.
--   * `track_b_deliverable_ledger_guard` writes one `deliverable_events` row
--     per updated row: action `update`, source `system`, payload
--     {"op":"UPDATE","reason":"rpc_bypass_guard"}. That is the audit trail for
--     a direct statement and is expected here.
--
-- REVERSAL. Read step 1 before running step 2 and keep its output: it is the
-- only record of the old values, since the ledger guard records op and reason
-- only. To reverse, set `identifier` back per row from that output.

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

-- ---- Step 2: the repair. -------------------------------------------------
update public.deliverables d
   set identifier = d.linear_identifier
 where d.identifier is not null
   and d.linear_identifier is not null
   and d.identifier <> d.linear_identifier;

-- ---- Step 3: prove it. Expect 0 rows from the first, 0 from the second. ---
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
