# Server-owned completion of accepted native intake work (draft, unapplied)

Status: implementation draft on top of PR1302, unapplied and undeployed. Nothing
here was run against a live database, a live Edge Function or a scheduler. This
implements a bounded part of GO_LIVE G3 (durable materialization of accepted
actions); it is not Decision A, not a new exit plan, not an activation.

## Exact base, head and drift

- Base: PR1302 `draft/native-only-intake-20260905` at exactly
  `8cb5cba91bc33fb17599b8f2a38625ae07f7743d`, itself stacked on PR1293 at
  `5418ab5618595d9469f0527bd94623e9229a637e`. Both remain separate drafts; no
  file of either is modified by this branch.
- Head: recorded in the PR handoff (this file describes the candidate; the PR
  body carries the exact commit).
- Remote `main` at branch time: `3d534cfa5598ef16e61c5ee7dc8072afaa9963c7`. The
  merge base of PR1302 and `main` is `a05e1126437bb8c36bd3f33e3701a58924a8627d`;
  `main` carries 31 commits past it (crosswalk bind/import lane and runner, asset
  grid refresh hold and gateway evidence reuse, AGENTS working rules, ledger items
  up to 155). Files changed on BOTH sides of that fork, which a future exact
  integration must resolve and re-pin: `supabase/functions/production-write/index.ts`,
  `.github/workflows/deploy-f27-section4-closures.yml`, `test/f27-section4-deploy-lane.js`,
  `REPO_MAP.md`, `EXECUTION_LOG.md`, `ROLLBACK.md`. This branch changes none of
  the production-write closure, so its own Section 4 pins are the PR1302 pins;
  they were not rebased onto `main` and are not claimed current for `main`.
- PR1274 `7d2812ac60358b3e73e26de2622cc2d25b90bb90` is historical evidence only.

## Responsibilities this branch adds and does not touch

Added (all additive, service-role only):

| Object | Kind | Responsibility |
|---|---|---|
| `production_intake_reconcile_state(request_id)` | read | One definition of what an accepted request still owes: per expected child (present, identity, receipt terminal) and per expected card (present, status, slot values). |
| `production_intake_reconcile_children(request_id, actor, apply)` | write (stage 1) | Recreates missing native children from the manifest through `production_deliverable_write`. All or nothing per request. |
| `production_intake_reconcile_cards(request_id, actor, apply)` | write (stage 2) | Creates the missing card row or binds an empty slot on the existing card; per card. |
| `production_intake_reconcile_backlog(limit, after)` | read | Keyset page of requests with unmet obligations. |
| `production_intake_reconcile_summary()` | read | Per-stage owed/complete/conflicted counts, backlog age, missing terminal receipts, latest recorded outcome per request and stage. |
| `production_intake_reconcile_record(...)` | internal | Appends the reason row to `deliverable_events` (source `reconcile`, action `native_intake_reconcile`). Not callable by any role. |
| `scripts/native-intake-reconcile/reconcile-lib.js`, `run.js` | driver | Pages the backlog, calls stage 1 then stage 2, folds a report. REST entry is dry-run by default. |
| `.github/workflows/native-intake-reconcile.yml` | definition | `workflow_dispatch` only. No schedule. Apply requires the exact confirmation phrase. |

Not touched: the gateway (`production-write`), any Edge Function, the frozen
anonymous writers `calendar-upsert` v48 and `sample-review-upsert` v49 and their
auth posture, `index.html`, n8n, runtime flags, credentials, Samples correction
work, monitoring, comment-draft repair, assignment policy. No SyncLinear
creation surface exists or is added; recovery here recreates only children the
Calendar/Submit intake already accepted and recorded in a manifest.

## Why no new authority table

The obligation is fully represented by facts that already exist: the immutable
manifest (what was accepted: ids, content, receipt keys, fingerprints, epochs,
actor key/role/auth kind, surface, source time), `deliverables` rows (native
result), `mirror_outbox` receipts (idempotency and terminal native marker),
`batches.purpose` (which card surface), and the card row's two slot columns
(the binding, checked in both directions with `deliverables.card_id`).
Completion is therefore a query, not a status column, and cannot drift from the
rows. The one thing those facts cannot hold is WHY a request could not be
completed; that goes to the existing append-only `deliverable_events` ledger as
`source='reconcile'` rows, which nothing reads to decide completeness. A
competing ledger was not needed.

## Stage 1 contract (children)

Preconditions per request, evaluated under the same advisory lock the root
wrapper takes (`root-intake-manifest:<request_id>`), so an explicit gateway retry
and any number of reconcilers serialize:

- manifest exists; batch exists and is `active`; client exists and is active;
- the parent receipt row named by the manifest exists and its role and client
  agree with the manifest (its actor display name, `test_only` and outbox id are
  the provenance for the reconstructed child event);
- no `track_b_team_rollbacks` row is open for the child's team;
- the accepted team epoch is native (non-empty). A provider-era child is
  reported as `provider_epoch_child_missing`, owner `gateway-retry`, never written;
- the expected id does not already exist as different work (batch, client, team
  or kind disagree): `child_identity_conflict`, owner `operator`;
- no receipt exists for a child whose row is missing: `child_receipt_without_row`.

One conflicted or unresolved child holds every planned child of that request
(`held` in the reason row). Writes happen in one subtransaction: for each
planned child the reconstructed event is exactly the gateway's shape (source
`ui`, action `create`, original actor/role/actor key/auth kind/surface/source
time, outbound `deliverable create` with the original dedup key, fingerprint,
epoch marker, request marker, current F27 fence generation, `legacy_parity
false`, `depends_on_id` = parent receipt id, `project_id` from a same-team
receipt of the batch or the reviewed client mapping, `team_id` from a same-team
receipt when present), passed with the manifest's row to
`production_deliverable_write`. Authority, replay lock, the F27 hold and fence
triggers and the native receipt guard therefore execute unchanged. After the
write the function reads the facts back (row identity and card plan, receipt
present, `skipped`, fingerprint and epoch equal) and raises on any mismatch,
which rolls back the whole request.

## Stage 2 contract (cards)

Obligation: one card per expected card id on the surface the batch names
(`purpose='samples'` to `sample_reviews`, otherwise `calendar_posts`), each
expected team's slot naming its deliverable. Per card:

- every expected child must exist with its identity and still carry this
  card id; a cleared (`deliverable_card_cleared`) or moved
  (`deliverable_rebound`) card id is a human decision, owner `operator`;
- existing card: `Archived` is left alone (`card_archived`); a slot that names
  another deliverable is `card_slot_occupied` (conflict); otherwise only the
  empty slot(s) and `updated_at` are written. No card event is written for a
  slot bind, matching the frozen writer, which emits none for deliverable slots;
- missing card: if any `calendar_post_events` / `sample_review_events` row exists
  for it, the card existed and is gone (`card_deleted_after_creation`); otherwise
  the row is created with exactly the columns and values the browser sends
  through the frozen writer today (`In Progress` statuses, empty strings, null
  deliverable slots, numeric-string `order_index` = max existing or epoch
  seconds plus card number, ISO millisecond `updated_at`, name = video title,
  then graphic title, then `Video N`, Linear link columns empty unless the
  deliverable already carries a link no other live card holds), plus one
  `create` event with the original actor and source `native-intake-reconcile`;
- readback: both slot columns equal the expected ids and every expected child
  still names the card; any mismatch raises and rolls the card back.

Card rows are locked before deliverable rows, the same order the crosswalk
binder uses. `calendar_posts.video_deliverable_id` carries a foreign key to
`deliverables` on the fixture built from the repository migrations; the insert
order above respects it.

## What the proof executed (local, disposable PostgreSQL 16.13)

`node test/native-intake-reconcile.js`: 47 checks, 47 passed, 0 failed, no SQL
skip. The lane drives the REAL `production-write` handler (loader identical in
seam to PR1302's) to produce accepted but interrupted intakes, then the real SQL
functions and the real runner library over psql. Provider fetch was unreachable
for the entire lane and the final check proves zero provider or drainer requests
left the process during any reconciliation.

| Scenario | Result |
|---|---|
| Interrupted before any child; flags disabled before recovery | both children recovered with manifest ids, content, card plan; receipts carry original dedup keys, fingerprints, ACCEPTED epoch, parent receipt actor/role, `depends_on_id`, terminal `skipped`; explicit gateway resend afterwards is a replay (201, no new rows); card created in browser shape with `create` event; rerun after a lost response is a no-op; one reason row per applied decision |
| Interrupted between child 1 and child 2 | exactly the missing child recovered; epoch of the accepted request kept after a later flag change |
| Two reconcilers on one request concurrently | one `recovered`, one `complete`; one row and one receipt per child |
| Reconciler racing the explicit gateway retry | one child set, one receipt per dedup key, gateway 201 |
| Backlog paging, page size 1 over three owed requests | every owed request once, no repeat, exhausted flag; completed request leaves the backlog; items carry no brief or title |
| Existing card with an empty slot and human edits | only the empty slot and `updated_at` change; no card event |
| Occupied slot | conflict, zero writes, reason recorded |
| Human edits on a completed card, rerun | untouched |
| Archived card; deleted card (events remain) | left alone; not recreated |
| Deliverable re-carded or un-carded by a human | unresolved, no card written |
| Expected id already exists as other work | whole request held, zero writes, reason names the held sibling |
| Unknown request id | refused |
| Open F27 team hold | unresolved `f27_hold`, zero writes; after cancel and a fence bump the recovered receipt carries the current generation |
| Team authority flipped back to Linear | refused; recovers once authority returns |
| Provider-era accepted request (flags off), interrupted | reported `provider_epoch_child_missing`, zero writes; explicit gateway retry completes it; its card then materializes |
| Archived batch; inactive client | refused |
| Samples surface (`sxr`) | children recovered with origin `samples`; card created in `sample_reviews` with its event, nothing in `calendar_posts` |
| Deleted terminal receipt | reported as missing terminal receipt, not invented; stage 1 treats the row as complete |
| Roles | anon and authenticated cannot call the reconciler; service role can read the summary |
| Runner library | dry run writes nothing; apply respects the limit; response loss then rerun converges; summary counts equal an independent SQL count |

Inherited suites on the same database, unchanged: `test/native-intake-manifest.js`
41 checks plus 3 controls; `test/native-only-intake.js` 50 checks, its readiness
report still `FAIL` for missing-child and missing-card materialization and for
chosen-editor provider independence, `UNPROVEN` for installed/full serving. This
branch does not relabel those rows: they describe the GATEWAY's own behaviour,
which is unchanged. The reconcile lane reports its own readiness rows
(`PASS_IN_FIXTURE` for both materializations, `NOT_IMPLEMENTED` for provider-era
child recovery, `UNPROVEN` for installed/full serving, `OUT_OF_SCOPE` for
chosen-editor independence).

Also passed locally: `repo-map-sync`, `ef-deploy-provenance`,
`f27-section4-deploy-lane`, `nightly-dispatch-input`, `write-ui-failure-messages`,
and `scripts/repo-identity-exposure-check.js --diff=8cb5cba9` (no client slug, no
colleague name added). `truth-sync` reports 16 failures locally on this clone
for freshness anchors that are not ancestors of the checkout; the same failures
exist on the untouched base and CI checks out with full depth. The full
`node test/run-all.js` result is recorded in the PR handoff.

## Deployment and schema dependencies

1. PR1293 `migrations/2026-09-05-native-intake-root-manifest.sql` applied.
2. PR1302 `migrations/2026-09-05-native-only-intake.sql` applied.
3. `migrations/2026-09-05-native-intake-reconcile.sql` applied (this branch;
   additive, no row backfill, no drop inverse).
4. No Edge Function deployment is required by this branch. The PR1302
   production-write closure is what the reconciler's provenance assumes for NEW
   requests (manifests with `native_epochs`); manifests without the column
   default to the provider lane and are reported, not recovered.
5. The workflow needs only `SUPABASE_SERVICE_ROLE_KEY`. It holds no Linear
   credential and must not be given one.
6. Running requires an explicit dispatch. Nothing schedules it.

## Client-visible behaviour during each future step

- After the migration, before any dispatch: nothing changes for anyone. No
  trigger fires, no row is written.
- Dry-run dispatch: nothing changes; the report lists owed requests by opaque id.
- Apply dispatch, stage 1: a stranded intake's missing video or thumbnail
  deliverables appear in Production and Workload exactly as if the original
  request had finished, attributed to the original submitter, with the original
  brief, status and due date. Editors see the work they were always meant to see.
- Apply dispatch, stage 2: the Calendar or Samples card appears for the SMM in
  `In Progress`, named after the video, or an existing card gains its missing
  component pill. A human who already renamed, moved, archived or deleted the
  card sees no change; the reason ledger says why.
- The browser's own materialization keeps working unchanged. If a tab finishes
  after the reconciler, its card write is a no-op update through the frozen
  writer; if the reconciler runs after the tab, stage 2 finds the card complete.

## Rollback preserving accepted work

Behaviour rollback is to stop dispatching. Nothing else is needed: with no
schedule and no trigger, an undispatched reconciler does nothing. Rows it
created are real accepted work with real receipts and real card bindings and
must be retained exactly like any browser-materialized intake. Do not drop the
functions while a dispatch is in flight, do not delete `deliverable_events`
reason rows, do not delete recovered deliverables or their `skipped` receipts,
do not clear card slots it bound. Dropping the five functions and the helper
after the last run is a clean schema revert with no data effect; keep them
unless a defect in them is the reason to leave.

## Remaining red gates and explicit limits

- Provider-era children are not recovered here (`NOT_IMPLEMENTED`). Their
  owner remains the explicit original request through the gateway.
- Requests without a manifest (pre-PR1293) are invisible to the reconciler.
- Installed and full serving remain `UNPROVEN`: repository source proves
  nothing about deployed function bodies, and this branch was never applied to
  a live database. The card-shape parity claim rests on the repository source of
  the frozen writers, not on their serving bodies.
- The proof builds the card tables from the schema baseline columns plus the
  repository migrations; live constraints, triggers or realtime publication on
  `calendar_posts` and `sample_reviews` that are not in the repository are not
  exercised. The stamped `video_status_at` trigger migration, for example, is
  not in the fixture chain.
- `hide_creative_direction` is written as `''` on a new sample card, as the
  browser does; the live column is text on the baseline.
- The backlog and summary readers scan every manifest; acceptable at current
  manifest volume, to be indexed or bounded before any scheduled use.
- Alerting is a design, not a delivered proof (next section).
- The chosen-editor provider dependency, assignment policy and public-intake
  policy are out of scope and unchanged.
- No live TEST write, no drill, no dispatch was performed.

## Finite recovery and alert design (not delivered as proof)

Signals, all from `production_intake_reconcile_summary()` over the service role:

| Signal | Page when | Meaning |
|---|---|---|
| `owed.children_native` | greater than 0 for longer than 15 minutes after `recorded_at` | accepted intake whose children never landed and no reconcile completed |
| `owed.cards` | greater than 0 for longer than 15 minutes after children complete | card materialization owed by browser and reconciler alike |
| `backlog_age_seconds` | greater than 3600 | the oldest owed request is an hour old; the reconciler is not running or not keeping up |
| `owed.identity_conflicts`, any `conflict` in `latest_outcomes` | immediately | a human decision is needed; the reconciler will never resolve it |
| `owed.missing_terminal_receipts` | immediately | a native child without its terminal receipt; investigate before any reconcile |
| `owed.children_provider` | report only | owned by the gateway retry path, not this reconciler |
| absence of any run | no report for two cadences once scheduled | dead-man; use `monitoring_heartbeat` like `reconciler_pager` in `scripts/monitoring-watchdog.js` |

Finite recovery: a request that stays `unresolved` with owner `reconciler`
(hold, stale generation, authority unavailable) is retried on every run and
resolves when the hold clears; one with owner `operator` is retried only after a
human acts and is otherwise reported once per run; one with owner
`gateway-retry` is never retried here. There is no deletion path.

Nothing in this table is installed, scheduled or wired to a pager by this branch.

## Smallest next action

Independent review of the two SQL stages against this document; then, if
accepted, apply the three migrations in order on a disposable copy of live
schema (not the repository fixture) and dispatch the workflow in dry-run against
it to validate the card-shape and column assumptions before any live apply.
