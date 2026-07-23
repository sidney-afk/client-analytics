# `migrations/` — manually applied Supabase SQL

Every file here is a **one-time migration intended for manual application in the
Supabase SQL editor**. Applied files are kept for provenance; a newly added delta
can remain source-only until `EXECUTION_LOG.md` records its actual application.
There is no auto-runner: nothing in CI, `supabase/config.toml`, or `scripts/`
executes these files (see `README.md` › Repository layout).

## How to read this folder

- **`live-schema-baseline-2026-07-03.sql`** is the authoritative reconstruction
  point: a schema-only snapshot of the live database captured 2026-07-03. To
  rebuild from scratch, start here.
- **Dated files (`YYYY-MM-DD-<slug>.sql`)** are deltas. Files dated after
  2026-07-03 apply **on top of** the baseline; earlier dated files are already
  folded into it and remain as history.
- **`2026-07-11-b4-linear-outbound.sql`** additively expands the dormant B1
  outbox, seeds the default-off outbound switch, and installs atomic enqueue /
  TEST-quarantine helpers. It does not flip authority or enable Linear writes.
- **`2026-07-12-production-comments.sql`** adds the normalized native/Linear
  comment store, service-only idempotent writer, protected body-bearing event
  snapshots, and the staff-reader data contract. It does not change authority,
  outbound flags, or Linear state.
- **`2026-07-12-write-ui-outbox-parity.sql`** marks server-authenticated
  legacy-parity outbox intents, seeds their independent reversible kill gate,
  and adds the atomic normalized-comment + outbox writer used by the Write-UI
  gateway. Existing authority and outbound-mode flag values are untouched.
- **`2026-07-13-production-intake-append.sql`** adds the service-only atomic
  append-to-existing-batch RPC used by native Calendar intake. It locks and CAS
  advances the batch cursor, validates exact team-parent routes, and commits the
  paired Video + Graphics rows/events/outbox intents in one transaction. It
  changes no runtime flag; its owner-only one-command rollback block is included
  at the bottom of the file.
- **`2026-07-14-thumbnail-revision-v2.sql`** revokes direct browser access to
  raw thumbnail revision metadata, seeds the default-off comparison/refresh
  gate, adds active Drive-thumbnail watcher/refresh triggers and bounded repair,
  and defines a locked service-role-only revision-rotation RPC. Dormant watcher
  placeholders may be seeded, but it does not enable Drive scanning, comparison
  delivery, or source-row mutation for any client.
- **`2026-07-14-f88-safe-sensitive-read-revocations.sql`** repeatably removes anon SELECT only
  from the backend/protected-reader safe subset: thumbnail revision metadata, both SMM weekly-
  report tables, and filming plans. It intentionally does not touch `clients` or the other raw
  tables still read by the SPA.
- **`2026-07-14-linear-intake-receipts.sql`** adds the service-only F44
  Calendar-to-Linear receipt ledger, team-scoped payload-hash receipt key, and
  monotonic retry/progress guards. It does not create Linear work or change
  workflow authority by itself.
- **`2026-07-15-pto-tracker.sql`** adds the three service-role-only PTO tables,
  per-member state-version triggers, transactional approval RPCs, and a live-floating-holiday
  uniqueness guard; it seeds `pto_v1` off and contains no member/HR seed data. The migration was
  applied and its schema, RLS, grants, browser denial, and initial off state were read back on
  2026-07-15; the later owner-authorized enablement is recorded separately in `EXECUTION_LOG.md`.
- **`2026-07-15-pto-cancellation-audit.sql`** additively gives cancellations their own verified
  actor and timestamp fields without overwriting an earlier approval/denial decision. It also
  installs `pto_create_request_v1` and `pto_set_member_start_v1`; both serialize on the stable roster
  row and compare the private profile state version. It replaces `pto_finalize_decision_v1` so an
  approval atomically requires an active target while denial remains available for cleanup. All
  three hardened functions are executable only by service role. The file
  reasserts RLS plus the anon/authenticated denial and service-role table grant, contains no HR rows,
  and does not change `pto_v1`. This delta is **source-only** until a value-free apply/readback entry
  confirms both columns, all three function bodies (including the active-target guard), and their
  service-role-only grants in `EXECUTION_LOG.md`.
- **`2026-07-19-workload-plan.sql`** adds the `workload_plan` sidecar keyed by the stable Linear
  sub-issue id, with normalized client scope, nullable internal `plan_date`, and server-owned
  `updated_by` / `updated_at`. It deliberately adds no column or foreign key to the rebuildable
  `workload_issues` mirror. RLS is enabled, browser roles receive no table policy or grant, and only
  service role may read or write it through the staff-authenticated `workload-plan` Edge
  Function. The 2026-07-20 release denied Creative for both list and mutation actions; candidate
  function source widens only the global list projection to Creative while retaining Admin/SMM-only
  mutations, and is not live until manually deployed. It adds no runtime flag and never
  writes a Linear due date. This delta was applied and read back on 2026-07-20: the table has RLS,
  zero policies, no anon/authenticated privilege, and exactly SELECT/INSERT/UPDATE for service role;
  DELETE/TRUNCATE/REFERENCES/TRIGGER are explicitly revoked. The release drill ended with zero
  sidecar rows and is recorded value-free in `EXECUTION_LOG.md`. That readback proves the effective
  live posture; F147 remains open because the exact SQL artifact containing the revoke correction
  was not tied unambiguously to the release SHA.
- **`2026-07-20-f27-team-rollback.sql`** is the corrective, source-only F27
  delta. PR #901 records that the earlier install was correctly aborted and no
  F27 object became live. This version adds per-team generation fences so a
  pre-authorized writer cannot insert after the authority CAS, narrows
  rollback-bound inbound echo proof to an exact open preflight, and adds the
  reserved `__f27_drill__` no-provider drill with permanent audit history. Its
  transaction contains a synthetic TEST enqueue savepoint before `COMMIT`; any
  new enqueue/constraint/trigger failure aborts the entire migration and the
  probe row is rolled back. The file does not flip authority or flags, deploy a
  function, touch n8n, or operate on a real client/team. It remains **not
  live-applied** until a separate owner-approved window follows
  `docs/ops/F27_INSTALL_RUNBOOK.md` from an exact owner-merged SHA.
- **`2026-07-23-f201-production-labels.sql`** is the source-only F201 outbox
  delta. It widens the existing operation CHECK and installed pre-F27 enqueue
  allowlist by adding only `labels`; all ten existing operations remain
  accepted. This is a deliberate, owner-approved exception to the
  additive-only rule because PostgreSQL has no in-place CHECK-expression
  alteration: the named CHECK is dropped and re-added as a strict superset in
  one transaction. The replacement validates existing rows and is data-safe:
  it drops no data/table/column, renames nothing, changes no type, and performs
  no backfill. The parked F27 enqueue source carries the same additive
  allowlist, but F27 remains uninstalled. Neither migration is live-applied by
  this source change; the F201 constraint apply, production-write deploy, and
  real TEST labels drill require a separate post-merge owner-approved window.
- **`2026-07-23-f202-production-descriptions.sql`** is the source-only F202
  outbox delta. It widens the F201 operation CHECK and installed pre-F27
  enqueue allowlist by adding only `description`; all eleven accepted
  operations, including `labels`, remain accepted. This is the same deliberate,
  owner-approved exception to the additive-only rule: PostgreSQL has no
  in-place CHECK-expression alteration, so the named CHECK is dropped and
  re-added as a strict superset in one transaction. The replacement validates
  existing rows and is data-safe: it drops no data/table/column, renames
  nothing, changes no type, and performs no backfill. The parked F27 enqueue
  source carries `labels` and `description`, but F27 remains uninstalled. The
  F202 constraint apply, production-write deploy, and real TEST description
  drill require a separate post-merge owner-approved window.
- **Undated feature files (`*-migration.sql`)** predate the dated convention
  (June 2026, originally at the repo root). Their schema is also already part of
  the baseline; each is documented by its owning design doc in `docs/features/`.

## Rules

- New migrations use the dated convention: `YYYY-MM-DD-<feature-slug>.sql`.
- **Additive-only** during the independence migration — new tables/columns are
  fine; `DROP`/`RENAME`/type changes are forbidden until final cleanup
  (`ROLLBACK.md` rule 3).
- After applying a migration, log it in `EXECUTION_LOG.md` (`ROLLBACK.md`
  rule 5).
