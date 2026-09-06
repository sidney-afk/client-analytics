# `migrations/` — manually applied Supabase SQL

Every file here is a **one-time migration intended for manual application in the
Supabase SQL editor**. Applied files are kept for provenance; a newly added delta
can remain source-only until `EXECUTION_LOG.md` records its actual application.
There is no auto-runner: nothing in CI, `supabase/config.toml`, or `scripts/`
executes these files (see `README.md` › Repository layout).

## How to read this folder

- **`2026-09-06-native-existing-assignment.sql`** is draft/unapplied. It adds a
  separate default-provider native-assignment capability, service-only context
  and atomic write wrapper, and retained terminal receipt guards on the existing
  outbox. No new table or accepted-history rewrite. Its explicit hold, provider
  rollback and schema/retained-target restore gates are documented in
  `docs/ops/NATIVE_EXISTING_ASSIGNMENT.md`.

- **`2026-09-05-card-change-journal.sql`** is a draft/unapplied private atomic
  before/after INSERT/UPDATE/DELETE journal on six card owners. No writer, auth,
  runtime flag or existing RPC is changed. Installation checks exact keys;
  history has no cascading foreign keys, public reads or automatic pruning.
  `docs/ops/CARD_CHANGE_HISTORY.md` owns the staged backup prerequisites,
  separate PR #1293 manifest dependency and retained-data rollback.

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
- **`2026-09-05-workload-native-membership.sql`** is a source-only manual prerequisite for the
  native-default staff Workload reader: three service-only functions provide an exact single
  snapshot and alias-preserving plan target/set. No table, stored plan key, epoch or flag changes.
  Requires the existing native Workload view and complete native workload-label projection.
  Install/restore/serving holds are in `docs/ops/WORKLOAD_NATIVE_SOURCE.md`; never apply by merging.
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
- **`2026-08-24-kasper-ad-performance-v2.sql`** adds two new standalone tables:
  `kasper_ad_performance_by_ad_daily` (same shape as `kasper_ad_performance_daily` plus an
  `ad_name` dimension, PK `(date, ad_name)`) and `kasper_ad_leads` (one row per iClosed booking —
  carries real PII, lead name + email — with `iclosed_status` and `hubspot_lifecyclestage` synced
  from the matching HubSpot contact). Same locked-down posture as the v1 table: RLS enabled, zero
  anon/authenticated policy or grant, service-role SELECT/INSERT/UPDATE only,
  DELETE/TRUNCATE/REFERENCES/TRIGGER revoked even from service role. No existing table, column,
  flag, or authority value changes. Read by `kasper-ad-performance-read`'s new `by_ad`/`leads`
  response fields; written by the rebuilt `Kasper Ad Performance — Daily Pull` n8n workflow.
  **Applied to production 2026-08-24** (via `supabase db query --linked`, readback confirmed both
  tables' columns/grants); see `EXECUTION_LOG.md`.
- **`2026-08-24-kasper-ad-performance-unfinished-leads.sql`** adds one new standalone table,
  `kasper_ad_unfinished_leads` (PK `lead_key`, real PII: name/email/phone). One row per abandoned
  iClosed booking on the prospecting campaign still pending follow-up, mirrored from n8n's own
  `booking_recovery` Data Table (fed by the pre-existing "Sales — Booking Recovery Capture
  (iClosed)"/"Dispatch" workflows) rather than a new capture path. Same locked-down posture as the
  other `kasper_ad_*` tables. No existing table, column, flag, or authority value changes. Read by
  `kasper-ad-performance-read`'s `unfinished_leads` response field; written by a 4th independent
  branch on the `Kasper Ad Performance — Daily Pull` n8n workflow. **Applied to production
  2026-08-24** (via `supabase db query --linked`, readback confirmed columns/grants); merged via
  #1137; n8n credentials wired and proven with a real execution 2026-08-25; see `EXECUTION_LOG.md`.
- **`2026-08-25-kasper-ad-unfinished-leads-backfill.sql`** is a one-time **data-only** backfill —
  five rows, no schema change. The live pipeline above only has history from 2026-08-14 (when its
  webhook capture was built); this fills the gap for real leads that predate it. iClosed's public
  API returns contact status but not campaign/UTM attribution on any endpoint tried; the owner's own
  iClosed "Leads" dashboard view supplied that missing field for cross-reference against the API's
  own contact records. Idempotent (`ON CONFLICT (lead_key) DO UPDATE`, excluding the timestamp
  fields a future real follow-up must not have overwritten). **Applied to production 2026-08-25**
  (via `supabase db query --linked`, readback confirmed all five rows); see `EXECUTION_LOG.md`.
  **Corrected same day** — see the next entry; the `null` `email_sent_at`/`follow_up_due_at` values
  set here for 4 of the 5 rows turned out to be wrong.
- **`2026-08-25-kasper-ad-unfinished-leads-followup-correction.sql`** is a one-time **data-only**
  correction — four `UPDATE`s, no schema change. The prior backfill above set
  `email_sent_at`/`follow_up_due_at` to `null` for all five rows on the unverified assumption that
  none had been captured by the live automated pipeline. The owner noticed the live UI showed no
  follow-up status for leads he knew had actually been emailed; checking n8n's `booking_recovery`
  Data Table directly by `lead_key` found 4 of the 5 already had real rows there with genuine
  recovery data (3 with an `email_sent_at`, one phone-only contact correctly with none). This
  migration restores those four rows' true values; the fifth (Andrew Schwab, who predates the
  capture workflow's build) is correctly left untouched. This also surfaced the root cause — the
  live-pull n8n workflow's own filter was wrong, not just this manual backfill — fixed the same day
  by rebuilding the workflow as `6OtjILbhkYLY6yVE`; see `docs/truth/N8N.md` and `EXECUTION_LOG.md`
  for the full writeup. **Applied to production 2026-08-25** (via `supabase db query --linked`,
  readback confirmed all four corrected rows).
- **`2026-08-24-quiz-responses.sql`** adds `quiz_responses` (public capture for the
  synchrosocial.com Growth Bottleneck Quiz — name/email/answers/scored result/attribution, service
  role only, zero anon/authenticated grant) and `quiz_intake_log` (its rate-limit ledger, same "how
  many rows since \<timestamp\>" shape as `public_intake_log`), plus the `quiz_intake_enabled`
  runtime flag defaulting to `{"enabled": false}` — same fail-closed posture as
  `public_intake_enabled`. Read by the new admin-gated `quiz-leads-list` Edge Function; written by
  `quiz-capture`. **Applied to production 2026-08-24** (run by hand in the Supabase SQL editor);
  both functions deployed the same day. `quiz_intake_enabled` is still off pending an end-to-end
  test.
- **`2026-08-24-hiring-applications.sql`** is the installed private Hiring Process sidecar:
  application mirror, one-job invitation outbox, minimal audit ledger, and service-role-only
  reviewer/delivery RPCs. It was applied 2026-08-25 after the executable syntax correction; RLS is
  enabled, browser roles have no table grants, and `hiring_invites_enabled` was read back as exactly
  `{"enabled": false}`. It now receives only the dedicated iClosed application capture; that
  capture still cannot send an email by itself.
- **`2026-08-25-hiring-invite-send-authorization.sql`** is the applied corrective delivery gate
  for that sidecar. It adds a single-use, claim-token-scoped authorization timestamp and a
  strict-JSON pre-send RPC. It does not enable the invitation flag or call a provider.
- **`2026-08-25-hiring-state-version-qualification.sql`** is the applied corrective replacement
  for the status, retry, dispatcher-claim, and booking routines. It qualifies table references that
  otherwise collide with `RETURNS TABLE` output names at runtime.
- **`2026-08-25-hiring-booking-status-qualification.sql`** is the applied follow-up correction for
  the booking routine's source-row `status` predicate. It is a `CREATE OR REPLACE FUNCTION` delta,
  changes no table data or grants beyond reasserting the service-role execution grant, and keeps a
  clean install correct after the earlier repair.
- **`2026-08-26-kasper-ad-performance-gap-correction.sql`** is a one-time
  **data-only** correction — no schema change — covering two separate real gaps
  in `kasper_ad_performance_daily`/`_by_ad_daily`. Gap 1 (pre-existing): the
  by-ad table was missing 3 of 6 ads for 2026-08-14 and all of 2026-08-15 (a
  partial-branch failure in an earlier pipeline run). Gap 2 (new): the live-pull
  n8n workflow (`6OtjILbhkYLY6yVE`) stopped succeeding after 2026-08-25 15:42
  UTC because its Facebook Graph API credential started returning
  `OAuthException code 200: "API access blocked"` on every scheduled run since
  — confirmed via two consecutive error executions (`433765`, `436025`), both
  failing at the `Pull Meta Insights` node in under a second, credential-only.
  All values here are pulled directly from Meta's Graph API via a separate,
  working credential and cross-checked day-for-day against what was already
  correct. No bookings fall on any of the affected dates, so
  `bookings_all`/`bookings_held` are untouched. 2026-08-26's row is a **partial
  day** as of the write and will read low until the credential is fixed and the
  pipeline resumes. **Applied to production 2026-08-26** (via
  `supabase db query --linked`, readback confirmed all rows); see
  `EXECUTION_LOG.md` for the full write-up, including the credential fix this
  data gap depends on.
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
- **`2026-08-27-kasper-ad-performance-multi-campaign.sql`** adds the campaign
  dimension the panel was built without. One new table,
  `kasper_ad_campaign_daily` (PK `(date, campaign_id)`), carries the
  per-campaign daily series the campaign selector reads.
  `kasper_ad_performance_daily` is deliberately **left alone**: its PK `(date)`
  cannot hold two campaigns on one date, and altering a primary key is not
  additive, so it keeps its exact historical meaning and becomes the
  all-campaigns rollup — which is continuous, since every row in it so far
  already was the whole account. `kasper_ad_performance_by_ad_daily` gains
  `campaign_id`/`campaign_name` as plain columns and keeps its `(date, ad_name)`
  key, which stays unique because the live campaigns share zero ad names.
  `kasper_ad_leads` and `kasper_ad_unfinished_leads` gain the same two columns
  for **display only** — the panel never filters leads by the campaign
  selector. Existing rows are backfilled to the original campaign. Additive
  only: nothing dropped, renamed, retyped, and no primary key altered.
  **Applied to production 2026-08-27**; readback reconciled the rollup, the
  per-campaign sum and the by-ad sum to the same $1,372.34.
- **`2026-08-30-artifact-video-projection.sql`** teaches
  `production_artifact_write` to project a VIDEO artifact:
  `deliverables.file_url` lands in `calendar_posts.asset_url` keyed on
  `video_deliverable_id`, where a graphics artifact lands in `thumbnail_url`
  keyed on `graphic_deliverable_id`. Byte-identical to the 2026-08-06 definition
  except the team guard and the two projection branches; the advisory-lock
  order, the outbox replay short-circuit, the `artifact_revision` bump and its
  exhaustion guard, the active-client requirement and `production_assert_authority`
  are unchanged. The video branch does not set `thumb_rev` and verifies
  `asset_url` alone, because `syncview_thumbnail_thumb_rev_before_write` fires on
  `update of thumbnail_url, ASSET_URL` and mints its own token — reading back a
  token the trigger discarded is the exact 2026-08-06 defect. **Applied to
  production 2026-08-30** by the owner; `production-write` deployed the same
  night from `3761db54`, live source `cddf9a01`. Rollback is TOP-DOWN and stops
  before this file — see `ROLLBACK.md`.
- **`2026-08-31-batch-asset-write.sql`** adds
  `public.production_batch_asset_write`, the first and only write path for
  `batches.footage_folder_url` and `batches.delivery_folder_url` (Raw footage and
  the Frame folder). They were written once at intake and the gateway refused
  every batch-entity mutation except `comment`, so a wrong folder link was
  permanent from every seat in the product. The interesting half is the column
  that must NOT move: `filming_doc_url` is absent from the whitelist, so the
  filming plan stays unreachable through this function even for a caller that
  asks for it by name (owner ruling: "no one should be able to touch that").
  Thin by design — slot whitelist, row lock, `production_assert_authority`, then
  `public.batch_write`, which already does the per-key partial update and records
  the `deliverable_events` audit row. Deliberately NOT `production_batch_write`,
  which requires an outbox dedup key and intent fingerprint and raises without
  them; a batch folder link has no Linear mirror leg, so there is nothing to
  dedup against. Additive; no table, column, index, trigger, policy, flag or
  authority value touched, and no row written at install time. **SOURCE-ONLY
  until applied**; the gateway answers 500 `write_failed` while it is absent, so
  apply it BEFORE deploying `production-write`.
- **`2026-08-31-batch-asset-team-fallback.sql`** derives the team to authorize
  against when `batches.team` is null, which it is for 303 of 1,644 batches —
  including one created ninety seconds before the test that found this, so it is
  an intake gap and not stale data. `production_assert_authority` raises
  `authority_unavailable` on a null team, so before this every folder write on
  such a batch was refused with a code that described the wrong problem. The
  team is taken from the batch's own deliverables, which carry it reliably. It
  authorizes the UNION of the batch's team and all of its children's and fails
  closed unless every one of them is writable — not the first team found, which
  would have made a mixed-team batch's authorization depend on row order during a
  per-team rollback (raised by Codex on PR 1187). The derived value is NOT
  written back: repairing the column belongs to intake, where the right value is
  known, and guessing one in here is how a wrong value becomes permanent.
  Otherwise byte-identical to `2026-08-31-batch-asset-write.sql`.
  **Applied to production 2026-08-31** by the owner.
- **`2026-08-31-batch-asset-client-slug-insert-arm.sql`** is why no batch asset
  write had ever committed: `select count(*) from deliverable_events where
  action = 'batch_asset_change'` was 0 on 2026-08-31 while `due_change` and
  `status_change` landed normally in the same window, and three people reported
  it within two hours. `production_batch_asset_write` handed `batch_write` a row
  of exactly two keys — the id and the asset column — and `batch_write` is an
  `insert ... on conflict (id) do update`. PostgreSQL evaluates NOT NULL on the
  proposed INSERT tuple BEFORE resolving the conflict, so every call died with
  `23502: null value in column "client_slug"` and never reached the update arm
  the design was reasoned around. The comment that shipped with the bug was
  right that the per-key `v_row ? '<col>'` guards stop the update arm clobbering
  a name or a sibling asset by omission; it just does not follow that the insert
  arm may be an invalid row. An upsert has to be able to insert. The fix echoes
  `client_slug` back from the row locked three statements above, so the insert
  arm is valid and the update arm assigns the value the row already holds;
  nothing else is added, so the no-clobber property is untouched. A raw Postgres
  exception is not a `GatewayError`, so the gateway's outer catch turned all of
  this into a 500 `write_failed` — which is why the UI could only ever say "try
  again". `test/batch-asset-write-insert-arm.js` pins the general rule rather
  than the one column: every NOT NULL column on `batches` must be either sent by
  `production_batch_asset_write` or defaulted by `batch_write`.
  **Applied to production 2026-08-31** by the owner and verified inside a
  transaction that was rolled back — the same call that raised 23502 minutes
  earlier returned the batch row with its folder URL set.

- **`2026-09-01-batch-description-write.sql`** adds
  `public.production_batch_description_write(text, text, text, text, jsonb)`, so a
  POST's own description can be edited. Owner request 2026-08-31, on a batch
  parent opened from a shared card link: "any parent issue should be able to ...
  the description should be editable", and on the shape, "I want it like linear,
  so there's a description for the parent issue, and then there is the
  description for all of the sub-issues."

  That model already existed — a sub-issue carries `deliverables.brief`, the
  parent shows `batches.description`, and neither is shared into the other. Only
  the write was missing: the gateway refuses every batch-entity mutation except
  `comment`, so a post description set at intake was permanent from every seat,
  exactly as the folder links were before `2026-08-31-batch-asset-write.sql`.
  1,186 batch parents carry a description.

  A near-copy of `production_batch_asset_write` on purpose: same
  scope-then-lock ordering, same anti-enumeration refusal, same per-team
  authority assertion derived from the batch AND its deliverables, same
  `batch_write` call, same audit shape. Two functions that behave identically
  are easier to keep honest than one with a mode flag. **Both corrections the
  asset writer needed are folded in from the start** — the team fallback
  (`batches.team` is null on 303 of 1,644 rows) and the `client_slug` insert-arm
  key (without it, `batch_write`'s upsert raises 23502 on a row that already
  exists). The whitelist is in the database, not only the gateway: this function
  reaches `description` and nothing else.

  The gateway half is a separate `batch_description` operation rather than
  `description` with `entity: 'batch'`, so it cannot acquire the outbox and
  fingerprint machinery a post description has no use for, and its event carries
  **no `outbound` key** — that key is the enqueue signal, and requesting a
  mirror leg for a write with no Linear counterpart is what produced
  `f27_authority_generation_stale` → 500 `write_failed` on the asset path.
  `test/batch-description-write.js` pins both lessons and refuses the other five
  operations on a batch parent.
  **APPLIED, and then superseded before it ever committed a row.** The SQL was
  run and the gateway closure deployed (`production-write` v65, 2026-09-01), and
  the function still could not save anything — see the next entry. Do NOT
  reconstruct a database by stopping here.
  Applied status verified 2026-09-01 rather than assumed, because the previous
  wording here said the opposite: a `POST /rest/v1/rpc/` to the function with
  the browser's read-only publishable key answers `401` / `42501 permission
  denied for function`, which PostgreSQL can only raise for a function that
  EXISTS, while a name that does not exist answers `404` / `PGRST202 no matches
  were found in the schema cache`. The same call also confirms the grants are as
  written — reachable by `service_role`, refused to `anon`.

- **`2026-09-01-batch-description-cas-timestamptz.sql`** replaces the body
  installed above, keeping the signature
  `public.production_batch_description_write(text, text, text, text, jsonb)`
  byte-identical. **Apply this one after it; a database rebuilt from the
  baseline plus deltas that stops at the previous entry carries a writer that
  refuses every save.**

  Two bugs, both of which made a post description unsaveable for every user from
  the hour the feature merged. First, the compare-and-swap compared
  `updated_at::text` (`2026-08-31 20:18:54.574498+00`) against the ISO rendering
  PostgREST hands the browser and the browser hands back
  (`2026-08-31T20:18:54.574498+00:00`) — the same instant, different text — so
  `is distinct from` was true on an untouched row and refused every save. It was
  the only writer in the estate declaring `p_expected_updated_at` as `text`;
  `2026-08-26-production-intake-append-v7.sql`,
  `2026-08-31-production-component-fill.sql` and
  `2026-07-23-f34-f53-production-attachments.sql` all declare `timestamptz`.
  Second, its three `raise exception` messages were spaced English, which
  matches none of the gateway's underscore guards, so even a correct refusal
  fell through to 500 `native_write_failed` — a `wait`-class code that told the
  user to retry something that could never succeed.

  **The parameter stays `text` on purpose**, and that is what keeps this a
  SQL-only repair: a `timestamptz` parameter changes the function's identity, so
  `create or replace` would install a second overload beside the broken one, and
  PostgREST — which resolves an RPC by the argument names in the JSON body, not
  by type — would answer `PGRST203` ambiguous. The cast moved inside the body,
  and the raises were renamed to tokens the already-deployed gateway maps
  (`..._write_conflict` → 409, `..._batch_not_found` → 409). **No edge-function
  deploy is part of this delta.** Nothing else changed: the three-key whitelist,
  the scope-then-lock ordering, the union-of-teams authority assertion, the
  `nullif`-without-`btrim` erase and the service_role-only grants are restated
  verbatim. `test/batch-description-cas-timestamptz.js` executes the deployed
  gateway's own mapper regexes against the migration's own raise strings, and
  its opt-in `BATCH_DESCRIPTION_CAS_PROBE=1` leg runs both bodies against a
  disposable PostgreSQL 16 database created from `template0`.

- **`2026-09-02-workload-native-view.sql`** creates
  `public.workload_issues_native_v1`, a **read-only view** and the first of the
  five steps in `docs/ops/WORKLOAD_NATIVE_SOURCE.md`. **Applying it changes
  nothing anyone sees**: no browser code reads it, no table is touched, no row
  is written, and re-running it is a no-op.

  It exists because the Workload board is the only major surface still reading
  a Linear-derived table (`workload_issues`, rebuilt from a Linear query), which
  is what makes Linear a **mandatory relay** rather than a legacy mirror — turn
  Linear off and the board is empty. `OPEN_REPAIRS` item 95 measures the
  standing cost: 40 live deliverables across 10 active clients that the board
  cannot see, because something archived their issues in Linear and the flip's
  refusal of that foreign write only guards native WRITES, while Workload is a
  READ pointed somewhere else entirely.

  The view answers the twenty fields `_wlV2MapRow` consumes, from
  `deliverables` + `batches` + `team_members` + `clients`, as two `union all`
  arms — one row per deliverable (sub-issue) and one per batch that carries at
  least one (parent).

  Four things it deliberately does NOT decide, each an owner call in scope §6:
  row identity (it answers **both** `id` and `linear_id`, because
  `public.workload_plan` is keyed on the LINEAR uuid and every manual plan day
  already saved joins on it), what `url` points at after Linear, whether the
  board's manual ordering comes back (`deliverables.sort_key` ships as
  `native_sort_key`, NOT `sort_order`, because `_wlV2MapRow` reads
  `r.sort_order` and naming it that would silently re-sort the board on first
  read), and anything at all about n8n.

  The one policy choice it does make is `active`, which natively can only mean
  "its batch is not archived" — there is no per-deliverable archive column in
  SyncView. That is the point rather than a side effect: item 95's rows appear
  on the native side and not the Linear side, which is the acceptance test for
  step 3.

  Status vocabulary is reproduced from two pieces of evidence rather than
  invented: display names from `STATUS_NAMES` in
  `supabase/functions/linear-outbound/mapping.mjs` (the map SyncView already
  uses to write a status INTO Linear, so there is no third vocabulary), and
  workflow-state TYPES from a census of the live table on 2026-09-02 — 3,437
  rows, every distinct pair. `Approved`, `Scheduled` and `Posted` are all
  `completed`, which the parked-name list would not lead you to assume. The
  same census found `For Client approval` (391) and `For Client Approval` (366)
  and `Tweak Needed ` with a trailing space (13) coexisting, which is the
  argument for a closed native set in one line.

  **The migration refuses to commit** if any `deliverables.status` value falls
  outside the map, because an unmapped status answers NULL and a NULL
  `status_type` passes `wlIsActiveStatus` — the row would render as live work
  with no status at all. `test/workload-native-view-contract.js` pins the map
  against `mapping.mjs` and against the column's own CHECK constraint, pins the
  measured types one by one, and asserts both `union` arms publish the same
  columns in the same order — a UNION pairs columns positionally and names them
  from the first arm, so a reordered second arm files one column under
  another's name and still compiles. Verified by applying the file to a
  disposable PostgreSQL 16 cluster with fixtures for a null-team batch, a
  both-teams batch, an archived batch holding live work, and a batch with no
  deliverables.

  **Amended before merge for two review P1s, both about a future cutover
  rather than about applying the file.** Imported batch-PARENT rows are now
  excluded from the sub-issue arm — but by a STRUCTURAL two-part test (named in
  its own batch's `linear_parent_ids`, or a `b1_` importer id with no Linear
  parent), not by the obvious `raw_issue_parent_id is null`, which catches 150
  of the 607 live rows and **57 of those are natively created work in batches
  that were never mirrored.** The structural test catches 93 and no native row;
  all 93 carry a title byte-identical to their batch's name and none of the 57
  does. And `assignee_id` now answers `coalesce(tm.linear_user_id,
  d.assignee_id::text)` rather than the native uuid: all three ids
  `WL_VIDEO_EDITORS` seeds the freest-first panel with are
  `team_members.linear_user_id` values and none is a `team_members.id`, so the
  native uuid would have shown every editor as a busy chip and a free chip at
  once. `native_assignee_id` carries the other one. Because two columns moved,
  `create or replace view` cannot re-apply over an earlier branch build — the
  file's header says to drop it first.
- **`2026-09-05-calendar-feedback-recovery.sql`** adds the service-role-only
  `calendar_feedback_recovery_apply_v1(jsonb)` and the insert-only evidence
  table `calendar_feedback_materializations`. In one transaction it proves an
  accepted client comment add by its mutation receipt and canonical identity
  under `FOR UPDATE` (no outbox required), proves the reserved companion status
  by its outbox receipt, checks the reciprocal client/card/deliverable binding
  and an original-source-row `updated_at` CAS, appends the verified entry to
  the component cell beside every existing entry and tombstone, applies only
  the allowlisted owned scalar fields, ledgers `calendar_post_events`, and
  records idempotent evidence; every hold returns without writing. It touches
  no existing object, flag, grant or writer. **SOURCE-ONLY until applied.**
  Apply this first, then deploy `production-write`, then the browser half.
  Exercised end to end on a disposable PostgreSQL 16 by
  `qa/calendar-feedback-recovery/`; contract in
  `docs/ops/CALENDAR_FEEDBACK_RECOVERY_CONTRACT.md`. Rollback block at the
  bottom of the file (drop the two functions; keep the evidence table).


- **`2026-09-06-linear-outbound-cutoff.sql`** is the unapplied, default-inactive G8 prerequisite for only the ordinary `mirror_outbox` claim/provider-mutation lane. It adds a server generation/high-water control, classifies accepted post-cutoff receipts without terminalizing them, and refuses stale worker application. It does not close inbound/reconciliation/browser/n8n/F27/provider-control coverage; see `docs/ops/LINEAR_OUTBOUND_CUTOFF.md`.
