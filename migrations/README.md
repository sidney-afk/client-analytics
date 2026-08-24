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
- **`2026-07-20-f27-team-rollback.sql`** is the installed corrective F27 delta.
  The real 2026-08-01 failed attempt and Section 7 recovery remain historical
  evidence. Attempt 2 entered from that exact retained boundary
  on 2026-08-02 and applied this file exactly once from release
  `968a895108beb2a2c41e86bb8b788115e35b14a0`; migration SHA-256
  `6e403d4400f683dbd21a3cb28b74729912dbac092812e6e3187b8e1c7ab868e6`,
  transaction/self-probe PASS, verify-after PASS. The migration's entry gate
  remains fail-closed over exactly the pristine reviewed prerequisite boundary
  and the exact retained Section 7 boundary. It checks either state under lock
  before persistent DDL, adopts exact retained objects, creates only absent
  additive objects, and never resets a generation or audit ledger. Both paths
  converge to the same normalized post-contract. The migration adds
  per-team generation fences so a
  pre-authorized writer cannot insert after the authority CAS, narrows
  rollback-bound inbound echo proof to an exact open preflight, and adds the
  reserved `__f27_drill__` no-provider drill with permanent audit history. Its
  transaction contains a synthetic TEST enqueue savepoint before `COMMIT`; any
  new enqueue/constraint/trigger failure aborts the entire migration and the
  probe row is rolled back. The file itself does not flip authority or flags,
  deploy a function, touch n8n, or operate on a real client/team. The successful
  window separately deployed/read back its protected closures, ran only the
  reserved drill, and returned `F27_FINAL_VERIFICATION_OK` with PASS across all
  17 enumerated assertions. Its presence in the repo is not authorization to
  rerun it; any recovery/reinstall requires a fresh owner go under
  `docs/ops/F27_INSTALL_RUNBOOK.md` from an exact reviewed SHA.
- **`2026-07-23-f201-production-labels.sql`** is the source-only F201 outbox
  delta. It widens the existing operation CHECK and then-operative pre-F27 enqueue
  allowlist by adding only `labels`; all ten existing operations remain
  accepted. This is a deliberate, owner-approved exception to the
  additive-only rule because PostgreSQL has no in-place CHECK-expression
  alteration: the named CHECK is dropped and re-added as a strict superset in
  one transaction. The replacement validates existing rows and is data-safe:
  it drops no data/table/column, renames nothing, changes no type, and performs
  no backfill. The installed F27 enqueue closure carries the same additive
  allowlist, bound by the exact 2026-08-02 migration receipt. The F201
  constraint and gateway deployment were applied separately; the real TEST
  labels drill still requires a separate owner-approved window.
  **Applied to production 2026-07-24 ~22:00Z** (Supabase SQL editor, pinned to
  reviewed SHA `1738ad3`, per-step boolean verified); see `EXECUTION_LOG.md`.
- **`2026-07-23-f202-production-descriptions.sql`** is the source-only F202
  outbox delta. It widens the F201 operation CHECK and then-operative pre-F27
  enqueue allowlist by adding only `description`; all eleven accepted
  operations, including `labels`, remain accepted. This is the same deliberate,
  owner-approved exception to the additive-only rule: PostgreSQL has no
  in-place CHECK-expression alteration, so the named CHECK is dropped and
  re-added as a strict superset in one transaction. The replacement validates
  existing rows and is data-safe: it drops no data/table/column, renames
  nothing, changes no type, and performs no backfill. The installed F27 enqueue
  closure carries `labels` and `description`, bound by the exact 2026-08-02
  migration receipt. The
  exact description Markdown remains in the service-role-only outbox and
  ledger handoff; a restrictive `deliverable_events` SELECT policy hides every
  `description_change` row from anon/authenticated readers while preserving the
  meaningful service-side audit event. The
  F202 constraint and gateway deployment were applied separately; the real TEST description
  drill still requires a separate post-merge owner-approved window.
  **Applied to production 2026-07-24 ~22:00Z** (Supabase SQL editor, pinned to
  reviewed SHA `1738ad3`, per-step boolean verified); see `EXECUTION_LOG.md`.
- **`2026-07-23-f203-production-issue-create.sql`** is the additive,
  source-only F203 creation delta. It adds one service-role-only atomic create
  RPC for a Production root issue (one structural native batch plus one
  deliverable) or sub-issue (the validated root batch plus one deliverable),
  plus one service-role-only post-ack linkage RPC that row-locks and patches
  only Linear identity fields without overwriting a newer native edit, and one
  service-role-only quarantine RPC that marks a deterministic Linear identity
  conflict read-only without erasing the saved native issue. Both
  creation paths enqueue exactly one existing `create` operation for the
  deliverable, never a batch create, and require `origin=manual` with no
  Calendar/Samples card identity.
  The create audit remains meaningful but its exact description/labels outbound
  envelope is consumed into the private outbox and redacted from the public
  event in the same transaction. It changes no operation CHECK, F27 allowlist,
  runtime flag, authority, or live data. Migration apply, function deploy, and
  the real TEST creation drill require a separate post-merge owner-approved
  window.
  **Applied to production 2026-07-24 ~22:00Z** (Supabase SQL editor, pinned to
  reviewed SHA `1738ad3`, per-step boolean verified); see `EXECUTION_LOG.md`.
  The real TEST creation drill is still owed.
- **`2026-07-23-f34-f53-production-attachments.sql`** is the source-only
  F34/F53/F137 artifact delta. It widens the F202 operation CHECK and both
  enqueue allowlists by adding only `attachment`; all twelve previously
  accepted operations remain accepted. This is the same deliberate,
  owner-approved exception to the additive-only rule: PostgreSQL has no
  in-place CHECK-expression alteration, so the named CHECK is dropped and
  re-added as a strict thirteen-operation superset in one transaction. It is
  data-safe: no data/table/column is dropped, nothing is renamed, no type is
  changed, and no row is backfilled. The migration also adds a durable
  monotonic artifact revision plus a service-role-only atomic Graphics
  artifact/card projection RPC, a private
  exact-URL-hash access-evidence sidecar, and a private Linear archive rescue
  sidecar. Rescue certification is bound to an owner-configured private Drive
  folder, dedicated capability hash, independent byte readback, content
  SHA-256/length/time, and an HMAC receipt; the service role cannot seed that
  configuration or directly certify a row. A v3 final occurrence inventory
  produced from an independent Linear export is required before the planner
  can report a complete zero-gap scan. It binds source artifact/export/org
  metadata, deterministic references, hashed issue/location/URL identity and
  source kind per occurrence; the runner requires both an owner-HMAC
  certification and a separately pinned SHA-256 of the exact inventory file.
  Duplicate URLs remain independently reconciled occurrences, an export-only
  undiscovered occurrence remains a gap, and unrecoverable references require
  a separate exact-hash owner disposition. `VERIFIED` also requires a
  nonempty, exact, duplicate-free independent readback receipt set for all
  rescued rows. The migration revokes inherited whole-table browser SELECT on
  `batches`/`deliverables`, withholds the three typed batch URL columns plus
  `file_url`, `brief`, and `linear_raw`, and exposes only bounded derived,
  URL-free Production/Workload fields through
  `production_deliverables_browser_v1`; exact Markdown description reads use
  the active-roster, role/team-scoped no-store `production-write` action.
  Service reads are unchanged. The compatible UI/functions must release before
  that grant change; their temporary legacy projection is entered only for an
  explicit relation-not-found response for this exact view, never for an
  authorization, server, or network failure. The migration seeds no rescue configuration and changes neither
  frozen writer, runtime flag, authority, n8n, nor live data. Constraint apply,
  function deploy, config seed, rescue, and any real TEST attachment drill
  remain a separate post-merge owner-approved window under
  `docs/ops/F34_LINEAR_ASSET_RESCUE.md`.
  **Applied to production 2026-07-24 ~22:00Z** (Supabase SQL editor, pinned to
  reviewed SHA `1738ad3`, per-step boolean verified; anon `linear_raw` read
  `401`, `production_deliverables_browser_v1` `200`); see `EXECUTION_LOG.md`.
  Rescue config seed, inventory reconciliation, and the TEST attachment drill
  are still owed.
- **`2026-07-23-production-comment-thread-lifecycle.sql`** is the additive,
  source-only F39/F42/F43 canonical comment delta. It adds protected read
  audit/budgets, lifecycle idempotency receipts, card-link/import conflict
  provenance, and service-only RPCs for lifecycle, native-ID binding, and the
  separately reviewed two-surface import. It replaces relevant RPC bodies
  without dropping data and reuses the existing `comment` operation; there is
  no outbox CHECK widening or F27 operation-allowlist change. F2 `off` pauses
  applicable comment drain debt rather than retiring it. Migration apply,
  function deploy, private Calendar+SXR import, and real TEST read/write/
  projection drills require a separate post-merge owner-approved window.
  **Applied to production 2026-07-24 ~22:00Z** (Supabase SQL editor, pinned to
  reviewed SHA `1738ad3`, per-step boolean verified); the F42 linked-cohort
  import executed 2026-07-25 (615 applied / 6,032 deferred / 35 link defects);
  see `EXECUTION_LOG.md`. The TEST drills are still owed.
- **`2026-07-25-slice5-production-read-path.sql`** is the F95
  read-path delta. It replaces the `production_deliverables_browser_v1` body in
  place with `create or replace view`, so column names, order, types, existing
  SELECT grants, and `security_barrier` are all preserved and nothing is
  dropped, rewritten, or backfilled. The only change is the extraction
  mechanism: a guarded `jsonb_to_record` lateral resolves the four top-level
  `linear_raw` subtrees once per row instead of detoasting the document for each
  of 24 separate `#>>` extractions. The Workload label lateral is left
  byte-identical so its completeness contract (including the `labelIds`
  cross-check) is untouched. It also adds `deliverables_updated_at_idx`, the
  additive index behind F95's `updated_at` delta predicate.
  Measured offline on PostgreSQL 16.13 over 4,626 synthetic rows sized to
  reproduce the live per-row cost: 951.8 ms → 312.5 ms per 1000-row page (3.0×),
  delta window 6.9 ms → 3.2 ms, with zero-row `EXCEPT ALL` equivalence in both
  directions across every column — including 14 adversarial `linear_raw` shapes
  (NULL, JSON null, string, number, array, empty object, non-object and
  JSON-null subtrees, wrong scalar types, unmatched regex guards, and the three
  label-completeness shapes). The `jsonb_typeof(...) = 'object'` guard is load
  bearing: a variant without it errors with `cannot call populate_composite on a
  scalar` as soon as any row holds a JSON scalar in `linear_raw`. A composite
  index on `deliverables(team, status, due_date)` was measured and deliberately
  **not** created — the planner keeps the sequential scan and the page still
  costs ~1.28 s, because the cost is projection, not ordering. The trade-off is
  recorded rather than hidden: a deliberately slim unfiltered `SELECT` of this
  view pays a fixed ~80 ms instead of ~4 ms, and no shipped caller does one. The
  file changes no table data, column, grant, runtime flag, authority value, n8n
  workflow, or frozen writer, and carries its owner-only rollback recipe at the
  bottom. **Applied to production 2026-07-26 ~23:45Z** (Supabase SQL editor, pinned to
  merged SHA `f3cf20e`; 46-column/grant/`security_barrier`/index readbacks passed;
  measured 1,273→392 ms per full page); see `EXECUTION_LOG.md`.
- **`2026-07-28-linear-project-ids-team-shape.sql`** is the GO_LIVE_CHECKLIST.md
  Phase 0 `linear_project_ids` shape-conversion delta (PHASE0_AUDIT_2026-07-28.md
  item #5). It is a **data-only** delta — no table, column, grant, or runtime
  flag changes — except for one new narrowly-scoped, service-role-only audit
  table it creates to carry the mandatory before/after evidence and rollback
  handle. It converts a single-element bare-string `clients.linear_project_ids`
  array (`["<id>"]`) OR a bare non-empty string scalar (`"<id>"`, a documented
  legacy shape) to the team-keyed shape `{"video":"<id>","graphics":"<id>"}`
  that `projectIdsForTeam` requires; either bare shape resolves to zero ids
  today and throws `409 project_mapping_missing` on a team's first native
  create. Every predicate is computed against live data — no client slug or
  Linear project id is hardcoded — active `kind='client'` rows only, and the
  TEST client (`sidneylaruel`) is hard-excluded by slug in every write
  statement in the file (the conversion, the manual-review template, and the
  rollback block alike). Every array-only jsonb function call is guarded by a
  CASE whose WHEN test is a throw-free `jsonb_typeof(...) = '<kind>'` check —
  required because Postgres does not guarantee AND-operand evaluation order,
  and an earlier draft's unguarded version was empirically reproduced to crash
  against the live majority (team-keyed object) shape during review. A bare
  array with zero or 2+ string elements, or an empty-string scalar, is never
  auto-converted; it is surfaced for manual, Linear-confirmed completion via a
  template that shares the same CTE-join + affected-row-assertion discipline
  as the automatic path, so a drifted/failed CAS can never be misrecorded as
  applied. Two additional read-only, never-auto-remediated checks (Part 2b)
  surface (i) any already-team-keyed object missing a non-empty id for either
  team, and (ii) any non-`client`-kind active row (besides TEST) that isn't
  actually empty — both cases the reader contract cares about that a
  bare-shape conversion alone doesn't prove. Captured before-state, an
  affected-row assertion, a per-row team-resolution readback, and an
  owner-only CAS'd rollback block (strengthened against the ABA case of a
  coincidentally identical later legitimate rewrite) are all in the file; a
  row that's applied then rolled back can be recaptured by a later run
  without manual table surgery. **Not applied**; requires a separate
  owner-approved window, a fresh Part 0 re-verification against the
  2026-07-27 baseline (31 team-keyed / 7 bare-string / 1 empty) immediately
  before running, and — for the safe-auto path — an out-of-band Linear check
  that each converted client's shared project actually carries both team tags.
- **`2026-08-03-linear-reconciler-bounded-inputs.sql`** is the source-only
  emergency read-path delta for the Track-B Linear reconciler. The measured
  route computes two service-only views directly from the source rows;
  it installs no source-table trigger, cache, sidecar, backfill, or persistent
  writer. One atomic transaction installs the pure projection helpers, bounded
  views, readiness view, and capped hydration RPC. Scheduled runs read a
  compact deliverable projection through primary-key keyset pages and distinct lifetime native comment IDs
  without transferring either full payload-bearing source relation. A service-only RPC
  can hydrate at most 100 exact deliverable IDs and returns a source JSON hash;
  the script uses it only for a hard-capped cohort already classified with
  diffs and fails closed if hydration changes the plan. The delta changes no
  source row, runtime flag, authority, n8n workflow, Linear issue, or existing
  write path. The shared n8n trigger remains at 15 minutes; only its V2 branch is temporarily hourly,
  and the repository cron remains unchanged. Follow
  `docs/ops/LINEAR_RECONCILER_BOUNDED_READ_WINDOW.md`. The SQL must
  be installed and read back in a separate owner-approved window. The old workflow must be disabled
  and quiescent before the matching source merges; the merged workflow stays disabled until the SQL
  passes readback and the actual-view production equivalence proof.
- **`2026-08-03-linear-reconciler-comment-index-optional.sql`** is the source-only optional
  accelerator for the exact lifetime comment-ID view. Its measured prototype was about 49 KiB. It
  creates only a sparse partial index over
  matching event candidates with `CREATE INDEX CONCURRENTLY`, so the one-time build does not take an
  ordinary writer-blocking table lock. It contains no time predicate and indexes no payload. The
  no-index view is already the accepted readiness path; this file is a separate owner step and must
  read back valid/ready/live before it is counted. It installs no trigger, function, cache, flag, or
  source row.
- **`2026-08-23-attribution-slug-guard-widening.sql`** is the **APPLIED** (2026-08-23,
  pinned to `8887d2a0`) read-path fix for the sanitiser that disagreed with the roster
  it was sanitising.
  `production_deliverables_browser_v1` gated `raw_attribution_client_slug` behind a
  hand-written character class and returned NULL when a real active roster slug
  failed it, while passing the unfiltered `d.client_slug` through two dozen columns
  earlier. 147 deliverables therefore reached the browser `resolved` with no slug,
  which the browser read as a DISAGREEMENT and propagated across each family --
  147 of the 176 "Client attribution conflict" banners in the app, every one of
  those rows read-only and mis-grouped. The file re-issues the view body
  (`pg_get_viewdef` of the live view, two string literals changed) with `&` added
  to that class and to the provisional one, re-asserts `security_barrier` and the
  anon/authenticated grants, and ends with an assertion that FAILS the transaction
  if any active roster slug still fails the widened guard -- the check reads live
  client rows, which is why it lives in the SQL and not in a test in this public
  repo. Read-path only: no table touched, no row written, no flag or authority
  value moved, re-running is a no-op. Proved before applying with zero permanent
  change by instantiating the body as a TEMPORARY view and comparing it in-query
  against the live one: 5,316 rows and 46 columns both sides, resolved-with-no-slug
  147 -> 0, symmetric difference 294 rows = the same 147 counted once per
  direction. Post-apply readback matched exactly: 147 -> 0, 5,316 rows and 46 columns
  unchanged, `security_barrier` and both grants preserved, and 147 rows now carrying a
  slug the old guard rejected. The browser half is merged and is correct under either
  guard. Window: `docs/ops/ATTRIBUTION_SLUG_GUARD_WINDOW.md`; receipt in `EXECUTION_LOG.md`.
- **`2026-08-24-kasper-ad-performance.sql`** adds one new standalone table,
  `kasper_ad_performance_daily` (raw Meta spend/click/landing-page-view counts
  plus iClosed booking counts, one row per UTC day, for Kasper's own Meta
  prospecting campaign). Same posture as `workload_plan`: RLS enabled, zero
  anon/authenticated policy or grant, service-role SELECT/INSERT/UPDATE only,
  DELETE/TRUNCATE/REFERENCES/TRIGGER revoked even from service role. No
  existing table, column, flag, or authority value changes. Read only by the
  new admin-gated `kasper-ad-performance-read` Edge Function; written by the
  `Kasper Ad Performance — Daily Pull` n8n workflow (2x/day cron).
  **Applied to production 2026-08-24** (via `supabase db query --linked`,
  readback confirmed columns/grants); see `EXECUTION_LOG.md`.
- **`2026-08-24-quiz-responses.sql`** is **source-only, not yet applied**. It
  adds `quiz_responses` (public capture for the synchrosocial.com Growth
  Bottleneck Quiz — name/email/answers/scored result/attribution, service
  role only, zero anon/authenticated grant) and `quiz_intake_log` (its
  rate-limit ledger, same "how many rows since \<timestamp\>" shape as
  `public_intake_log`), plus the `quiz_intake_enabled` runtime flag
  defaulting to `{"enabled": false}` — same fail-closed posture as
  `public_intake_enabled`. Read by the new admin-gated `quiz-leads-list`
  Edge Function; written by `quiz-capture`. Must be run by hand in the
  Supabase SQL editor and logged in `EXECUTION_LOG.md` before either
  function is deployed or `quiz_intake_enabled` is flipped on.
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
