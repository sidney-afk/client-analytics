# Server-owned completion of accepted native intake work (draft, unapplied)

Status: implementation draft on top of PR1302, unapplied and undeployed. Nothing
here was run against a live database, a live Edge Function or a scheduler. This
implements a bounded part of GO_LIVE G3 (durable materialization of accepted
actions); it is not Decision A, not a new exit plan, not an activation.

**Revision note.** Independent review of the first head
`df3d0325cac89d3fa9a0fdcb004933025b25ad27` found three release blockers: the
runner printed identifiers to a public log, a late original browser job could
overwrite a person's edits on a card the reconciler had created, and the card
stage read an absent best-effort event as proof a card never existed. The
sections marked "Corrected" below describe the follow-up head; the original
claims they replace are quoted where they were wrong. The first head and its
evidence are preserved in history, not rewritten.

**Second revision note.** Independent review of the follow-up head
`48f75012a3826d27ef087556eca90b941709d3c1` found its second fix unsound: the
BEFORE UPDATE guard recognised a late browser replay by row CONTENT, and a person
renaming a card back to its original title produced exactly that content, so on
both Calendar and Samples the writer returned 200 and kept the intermediate
title; its creation classifier also matched copied and non-intake rows. This
third head (branch `claude/native-intake-stage2-hold-emc3kc`, stacked on that
head, which it preserves) removes the guard and the classifier, structurally
disables automatic card creation and keeps only the slot bind that recorded
facts prove safe. Sections marked "Third head" describe it; the 48f7501 claims
they replace are quoted where they were wrong.

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
- Third head: its base is PR1308 `claude/native-intake-completion-emc3kc` at
  exactly `48f75012a3826d27ef087556eca90b941709d3c1`, preserved unchanged. Remote
  `main` at its branch time: `ab6366136c03239965c97b050ab5cf7c9763a228`, eight
  commits past the `3d534cf` recorded above (PR #1307's second crosswalk apply
  record and its Codex rounds; `AGENTS.md` gained the "Two working rules"
  section). None of it is integrated here; the both-sides file list above is
  unchanged by those eight commits.

## Responsibilities this branch adds and does not touch

Added (all additive, service-role only):

| Object | Kind | Responsibility |
|---|---|---|
| `production_intake_reconcile_state(request_id)` | read | One definition of what an accepted request still owes: per expected child (present, identity, receipt terminal) and per expected card (present, status, slot values). |
| `production_intake_reconcile_children(request_id, actor, apply)` | write (stage 1) | Recreates missing native children from the manifest through `production_deliverable_write`. All or nothing per request. |
| `production_intake_reconcile_cards(request_id, actor, apply)` | write (stage 2) | Third head: binds an expected slot that the recorded facts prove has been empty since the card was created; never creates a card (a missing card is `card_creation_held`); per card. |
| `production_intake_reconcile_backlog(limit, after)` | read | Keyset page of requests with unmet obligations. |
| `production_intake_reconcile_summary()` | read | Per-stage owed/complete/conflicted counts, backlog age, missing terminal receipts, latest recorded outcome per request and stage. |
| `production_intake_reconcile_record(...)` | internal | Appends the reason row to `deliverable_events` (source `reconcile`, action `native_intake_reconcile`). Not callable by any role. |
| `production_intake_reconcile_reason(message, sqlstate)` | internal | Corrected: collapses any PostgreSQL message to an allowlisted code or its SQLSTATE class before it reaches the ledger or a report. |
| `production_card_provenance` | table (append only) | Third head: one row per card creation (with the slot ids it was created with), deletion and semantic slot change, written by row triggers inside the writer's own transaction, plus an `installed` marker per surface. The `materialization` column of 48f7501 is gone. Service role may read; no role may write directly. |
| `zz_production_card_provenance` | trigger, `calendar_posts` and `sample_reviews` | Third head: AFTER INSERT/UPDATE/DELETE, facts only. Records `created` (initial field set and slot ids), `deleted`, and `slots_changed` when a deliverable slot changes semantically (blank and null are the same empty slot), with the source when the reconciler set one. Alters, refuses and reorders nothing. |
| `production_card_slot(text)` | helper | Third head: the one definition of an empty slot (blank or null). |
| `zy_production_card_materialization_guard`, `production_card_is_materialization` | withdrawn | Existed only on head 48f7501. Not installed by this migration; the lane asserts neither exists and that no BEFORE trigger of this branch is on either card table. |
| `scripts/native-intake-reconcile/reconcile-lib.js`, `run.js` | driver | Pages the backlog, calls stage 1 then stage 2, folds a report. REST entry is dry-run by default. |
| `.github/workflows/native-intake-reconcile.yml` | definition | `workflow_dispatch` only. No schedule. Apply requires the exact confirmation phrase. |

Not touched: the gateway (`production-write`), any Edge Function, the frozen
anonymous writers `calendar-upsert` v48 and `sample-review-upsert` v49 and their
auth posture, `index.html`, n8n, runtime flags, credentials, Samples correction
work, monitoring, comment-draft repair, assignment policy. No SyncLinear
creation surface exists or is added; recovery here recreates only children the
Calendar/Submit intake already accepted and recorded in a manifest.

**Third head: the guard is withdrawn, and the hold narrows.** The 48f7501 text
here said the migration "cannot ship without the guard because without it the
first review's overwrite is real". Both halves were wrong in their conclusion:
the overwrite is real, but it is a property of the frozen writer over any card
whose original job resumes late (R3 below reproduces it on a card the BROWSER
created, with the reconciler idle), and a content-matching guard cannot close it
without also swallowing a person's rename-back (R1, R2). The reconciler
therefore no longer creates cards at all, so it does not widen the writer's
exposure, and no trigger of this branch changes the effect of any write. What
remains on the frozen tables is fact recording inside the writer's transaction,
which is still a trigger on tables the frozen writers write and still needs the
owner's review before the migration is applied anywhere; it can fail a write
only if the append itself fails, and its one-step kill is documented under
Rollback.

## Why no new authority table, and why one provenance table

Corrected. The first head claimed no new table at all. The follow-up adds
`production_card_provenance`, and the distinction matters: it is not an
authority over completion. Completion is still a query over the manifest, the
deliverable rows, the receipts and the card slots. The provenance table records
three facts those rows cannot: that a card row was inserted, with the slot ids
it was inserted with; that it was deleted; and that a deliverable slot changed,
durably, because the recording trigger runs in the same transaction as the
writer's statement. The first head used
`calendar_post_events` / `sample_review_events` for that fact; both writers
insert those events through `EdgeRuntime.waitUntil` after the row commit and
swallow failures, so an absent event proves nothing. A table written by a row
trigger is the smallest durable record of "this card existed".

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

Third head. Obligation: one card per expected card id on the surface the batch
names (`purpose='samples'` to `sample_reviews`, otherwise `calendar_posts`), each
expected team's slot naming its deliverable. The stage NEVER inserts a card. Per
card:

- every expected child must exist with its identity and still carry this
  card id; a cleared (`deliverable_card_cleared`) or moved
  (`deliverable_rebound`) card id is a human decision, owner `operator`;
- missing card: a `created` or `deleted` fact, or an events row, means it once
  existed (`card_deleted_after_creation`); a request accepted before the
  `installed` marker can prove nothing (`card_provenance_unavailable`); a card
  proved never created is STILL not created here (`card_creation_held`, owner
  operator). All three stay in the backlog and in the summary's owed cards;
- existing card: `Archived` is left alone (`card_archived`); a slot naming
  another deliverable is `card_slot_occupied` (conflict); an empty slot is bound
  only when the card's `created` fact shows that slot empty at creation AND no
  `slots_changed` fact exists after it. A slot that once held an id, or a card
  whose slots anyone changed since creation, is `card_slot_cleared`, owner
  operator; a card with no `created` fact is `card_provenance_unavailable`. When
  a bind is planned only the empty expected slot(s) and `updated_at` are written.
  No card event is written for a slot bind, matching the frozen writer, which
  emits none for deliverable slots; the recording trigger writes a
  `slots_changed` fact with source `native-intake-reconcile:<actor>`;
- readback: both slot columns equal the expected ids, every expected child
  still names the card and the child count equals the manifest's; any mismatch
  raises and the whole apply block rolls back.

Lock order and revalidation, third head: the CARD row is locked first, then
every expected deliverable row (`FOR UPDATE`, ordered by id), which is the order
the crosswalk binder takes everywhere. Head 48f7501 locked the deliverables
first while this document claimed the opposite; the code is corrected to the
documented order and this sentence is the corrected claim. Under the locks, and
only then, the stage revalidates what the plan assumed: the card still exists
(`card_missing_under_lock`) and is not archived; every expected child is present
with the manifest's batch, client, team and kind and names this card, no
expected child is missing and no other deliverable of the client claims this
card for an expected team (`reconcile_child_identity_changed`,
`card_slot_occupied`); the `created` and `slots_changed` facts are re-read. The
48f7501 final check only examined the children that survived; the cardinality
check closes that gap. Any raise inside the block rolls back every card change
of the call and leaves a bounded reason.

### What the unchanged frozen writer conveys

Everything the reconciler could decide on has to come from what reaches the
database. Through `calendar-upsert` v48 and `sample-review-upsert` v49 that is:
the resulting full-row values for the keys the payload carried, `updated_at`
set to the writer's own clock, and, best effort and after the commit, an event
row. Nothing else. No request id, no `x-syncview-source` (the browser sends it;
the writer uses it only for the best-effort event), no base timestamp unless the
caller chose to send `comments_base_at`, which the materialization payload does
not. A late original browser job and a person therefore produce writes that are
indistinguishable at the table. That is why no row-level distinction can cover
the old-job cohort and why the second head's content match was unsound.

### Cohorts and the distinction that covers each

| Cohort | What the facts can say | Stage 2 |
|---|---|---|
| Missing card, request accepted after the `installed` marker, no facts | never created, but a later replay of its original job cannot be told from a person | held, `card_creation_held`; visible debt |
| Missing card with `created`/`deleted` facts or an events row | it existed and someone deleted it | held, `card_deleted_after_creation` |
| Missing card, request accepted before the marker | nothing | held, `card_provenance_unavailable` |
| Existing card, expected slot empty since creation, no slot change since | the slot never named anything; nobody's clear is undone | bind, under the locks above |
| Existing card, slot once held an id, or any `slots_changed` fact since creation | a person or a job cleared or changed it | held, `card_slot_cleared` |
| Existing card, slot names another id | occupied | conflict, `card_slot_occupied` |
| Copied or non-intake cards | no manifest names them | never examined; the recording trigger records a `created` fact and nothing else (R4) |
| Old in-flight or saved browser jobs | the writer conveys nothing | over the card they created: the pre-existing overwrite (R3), not widened here because the reconciler creates nothing; over a slot the reconciler bound: a replay that carries the same ids changes nothing, one that clears the slot records `slots_changed` and the next run holds `card_slot_cleared`, so there is no ping-pong (the clearing half is reasoned, not exercised: the fixture's slot foreign key refuses a blank id) |

### Remaining contract for automatic card creation

Automatic creation stays disabled until one of these exists, each an owner
decision, none assumable:

1. the writer conveys an operation identity into the transaction it writes in,
   for example `set_config('app.card_write_source', <x-syncview-source>, true)`
   before its statements, so the recording trigger can attribute every write
   and a materialization replay is recognised by SOURCE, never by content. That
   is a change to the frozen v48/v49 bodies. It also needs proof that every
   build whose jobs could still resume sends the header;
2. or the old-job cohort is proved empty by refusal (the writer declining the
   materialization payload shape over an existing card), which is again a
   frozen-body change; a waiting period is not proof and is not accepted here;
3. or a new browser materialization that is insert-only and never updates,
   together with 2 for the jobs the old builds still hold.

Until then the debt is visible (`card_creation_held` in the ledger, the backlog
and `owed.cards`) and its owner is the browser job or a person.

## What the proof executed (local, disposable PostgreSQL 16.13)

Third head: `node test/native-intake-reconcile.js`: 66 checks, 66 passed, 0
failed, no SQL skip. The 48f7501 scenarios that depended on the withdrawn guard
or on stage 2 creating a card (B1 to B7, P3, and the creation halves of S1, S5,
S15, S17, S20) are rewritten; every card the third head's lane completes is
created by the ACTUAL extracted browser function through the ACTUAL repository
writers, and every hold is read back from the tables, the backlog and the
summary. The R scenarios are new.
The lane drives the REAL `production-write` handler (loader identical in seam to
PR1302's) to produce accepted but interrupted intakes, then the real SQL
functions and the real runner library over psql. For the review round it also
runs the ACTUAL extracted browser materialization function
(`_writeNativeSubmissionCardsToCalendar` with its real validator and actor
guard, client-link mode) against the REPOSITORY sources of `calendar-upsert` and
`sample-review-upsert` loaded through the same seam with a fixture staff key.
Provider fetch was unreachable for the entire lane and the final check proves
zero provider or drainer requests left the process during any reconciliation.
The fixture keys both card tables on (client, id) as live does and uses a second
synthetic client whose slug the writers' normalization leaves unchanged.

| Scenario | Result |
|---|---|
| Interrupted before any child; flags disabled before recovery | both children recovered with manifest ids, content, card plan; receipts carry original dedup keys, fingerprints, ACCEPTED epoch, parent receipt actor/role, `depends_on_id`, terminal `skipped`; explicit gateway resend afterwards is a replay (201, no new rows); the missing card is HELD `card_creation_held` with zero writes and is visible in the backlog item and `owed.cards`; the browser job, fed the replay response, creates it through the real writer and the `created` fact carries both slot ids; request complete by facts; rerun after a lost response is a no-op; one reason row per applied decision |
| Interrupted between child 1 and child 2 | exactly the missing child recovered; epoch of the accepted request kept after a later flag change |
| Two reconcilers on one request concurrently | one `recovered`, one `complete`; one row and one receipt per child |
| Reconciler racing the explicit gateway retry | one child set, one receipt per dedup key, gateway 201 |
| Backlog paging, page size 1 over three owed requests | every owed request once, no repeat, exhausted flag; a request whose card is held stays in the backlog until the browser job creates the card, then leaves; items carry no brief or title |
| Existing card with a slot empty since creation and human edits | only the empty slot and `updated_at` change; no card event; a `slots_changed` fact names the reconciler as source |
| S6b existing card created WITH the slot bound, then cleared by a person | held `card_slot_cleared`, zero writes; facts read `created,slots_changed` |
| S6c slot the reconciler bound, then cleared by a person | held `card_slot_cleared`, not re-bound; the person's clear stands |
| Occupied slot | conflict, zero writes, reason recorded |
| Human edits on a completed card, rerun | untouched |
| Archived card; browser-created card deleted afterwards | left alone; held `card_deleted_after_creation` on `created,deleted` facts, not recreated |
| Deliverable re-carded or un-carded by a human | unresolved, no card written |
| Expected id already exists as other work | whole request held, zero writes, reason names the held sibling |
| Unknown request id | refused |
| Open F27 team hold | unresolved `f27_hold`, zero writes; after cancel and a fence bump the recovered receipt carries the current generation |
| Team authority flipped back to Linear | refused; recovers once authority returns |
| Provider-era accepted request (flags off), interrupted | reported `provider_epoch_child_missing`, zero writes; explicit gateway retry completes the children; its card is held, then the browser job creates it and the request is complete |
| Archived batch; inactive client | refused |
| Samples surface (`sxr`) | children recovered with origin `samples`; card held, then created by the browser job through `sample-review-upsert` in `sample_reviews` with its event, nothing in `calendar_posts` |
| Deleted terminal receipt | reported as missing terminal receipt, not invented; stage 1 treats the row as complete |
| Roles | anon and authenticated cannot call the reconciler; service role can read the summary |
| Runner library | dry run writes nothing; apply respects the limit and reports the held card (`unresolved`, zero created); response loss then rerun converges on the held state; owed children AND owed cards equal independent SQL counts |
| R0 structure | no `zy_` trigger, no guard or classifier function, no `materialization` column; every provenance trigger on both card tables is AFTER, never BEFORE |
| R1 Calendar rename-back through the actual writer on a browser-created card | rename 200, rename back 200, ORIGINAL title kept, slots intact, facts read `created` only. On the 48f7501 base (same fixture, detached worktree, same writers and browser function): rename 200, rename back 200, intermediate title RETAINED, two guard triggers present |
| R2 Samples rename-back through `sample-review-upsert` | same result as R1; same failure on the base |
| R3 genuine late retry of the original browser job over its own card after a person's edits through the writer | acknowledged (200) with no `comments_base_at`; name, schedule and status overwritten: the pre-existing frozen-writer hazard, observed; stage 2 was `complete` before and after, bound nothing, recorded nothing; one `created` fact with no source |
| R4 copied or non-intake card in the browser's exact shape through the writer | one `created` fact, no classification, rename and rename-back 200 with the title restored, never in the backlog |
| R5a a second session holds the graphic child FOR UPDATE, then re-cards it and commits while the bind waits | `reconcile_child_identity_changed`, zero slot writes, card byte-identical, reason recorded |
| R5b the second session deletes the child instead | `reconcile_child_identity_changed`, zero slot writes, one child left; afterwards stage 1 reports `child_receipt_without_row` (operator) and stage 2 stays `children_incomplete`: no silent recovery of a deleted child |
| R6 synthetic raising trigger on the card table during the bind | `sql_error:P0001`, the message's row value never appears, card byte-identical, no `slots_changed` fact; after the fault clears the same bind completes with its fact |
| P1 provenance recording disabled: card commits, create event lost, person deletes it | held `card_creation_held`, nothing recreated (48f7501's P1 negative control recreated it; the third head creates nothing under any reading) |
| P2 same sequence with provenance recorded | `created,deleted` facts, no event, held `card_deleted_after_creation`, nothing recreated |
| P3 card that provably never existed | held `card_creation_held`; debt visible in the reason, the backlog item's `cards_incomplete` and `owed.cards`; no card, no fact |
| P4 request accepted before the `installed` marker | held `card_provenance_unavailable`, nothing recreated |
| P5 ledger reasons | every recorded reason is an allowlisted code or `sql_error:<SQLSTATE>`; a PostgreSQL duplicate-key message with row values collapses to `sql_error:23505` |

`node test/native-intake-reconcile-cli.js` (offline): 16 checks passed,
including the two path-guard cases of the third head (an in-repository path that
begins with two dots; a symlink from a temp directory into an existing repository
directory); see "Public output" below.

Inherited suites on the same database, unchanged: `test/native-intake-manifest.js`
41 checks plus 3 controls; `test/native-only-intake.js` 50 checks, its readiness
report still `FAIL` for missing-child and missing-card materialization and for
chosen-editor provider independence, `UNPROVEN` for installed/full serving. This
branch does not relabel those rows: they describe the GATEWAY's own behaviour,
which is unchanged. The reconcile lane reports its own readiness rows
(`PASS_IN_FIXTURE` for missing-child recovery and for the empty-since-creation
slot bind, `HELD_NOT_AUTOMATED` for missing-card materialization,
`PRE_EXISTING_UNRESOLVED` for the late browser replay overwrite,
`NOT_IMPLEMENTED` for provider-era child recovery, `UNPROVEN` for installed/full
serving, `OUT_OF_SCOPE` for chosen-editor independence). Card completion is not
declared by this branch.

Also passed locally on the third head: `repo-map-sync` (292), `ef-deploy-provenance`,
`f27-section4-deploy-lane`, `nightly-dispatch-input`, `write-ui-failure-messages`,
and `scripts/repo-identity-exposure-check.js --diff=48f75012` (no client slug, no
colleague name added). `truth-sync` reports 16 failures locally on this clone
for freshness anchors that are not ancestors of the checkout; the same failures
exist on the untouched base and CI checks out with full depth. The full
`node test/run-all.js` result is recorded in the PR handoff.

## Public output (corrected)

The first head's runner printed the entire report, including client slugs,
request ids, row ids and raw RPC error bodies, to stdout, and per-request
progress to stderr, inside a public Actions log. Corrected:

- stdout is the PUBLIC report only: aggregate counts per stage, reason codes
  from a fixed allowlist (anything else prints as `other`), bounded outcomes and
  owners, the summary numbers, and, only when `NATIVE_INTAKE_RECONCILE_HASH_KEY`
  is configured, a keyed one-way 12-hex correlation token per request so two
  runs can be compared. Without the key there is no per-request output at all.
- stderr carries fixed configuration messages, bounded RPC failure codes
  (`rpc_failed:<function>:http_<status>`) and, with the key, correlation-token
  progress lines. Response bodies never print.
- the FULL report can be written only with `--private-report=<path>` to a file
  outside the repository (a path inside it is refused before any call); the
  workflow never passes that flag and uploads no artifact. Third head: "inside"
  is decided on REAL paths. The 48f7501 check was textual and let
  `<repo>/..private-report.json` through (it merely begins with two dots) and
  would have written through a symlink from a temp directory into the tree; the
  deepest existing ancestor is now resolved with realpath, an unresolvable path
  or a path that is itself a symlink is refused, and both cases are in the CLI
  suite. The detailed durable
  record is the reason ledger in the database, service role only.
- reasons are bounded at the SOURCE too: `production_intake_reconcile_reason`
  collapses every PostgreSQL message to an allowlisted code or `sql_error:<SQLSTATE>`
  before it is written to `deliverable_events`, which is anon-readable by policy.

`test/native-intake-reconcile-cli.js` runs the actual CLI as a child process
against a local fake REST endpoint seeded with unique forbidden strings in the
client slug, request id, nested ids and reasons, an owner, a summary key and an
HTTP error body, then asserts none reaches stdout or stderr in dry-run, keyed,
apply, strict, refused-path and error modes, while the private file outside the
repository does hold them.

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
- Apply dispatch, stage 2, third head: an existing Calendar or Samples card
  whose component slot has been empty since it was created gains that
  component pill. NO card appears that was not there: a missing card stays
  missing, is counted as owed and is named in the ledger as `card_creation_held`
  until the browser job that owns it resumes or a person creates it. A human who
  renamed, moved, archived, deleted or cleared a slot on the card sees no change;
  the reason ledger says why.
- The browser's own materialization keeps working unchanged, including its
  hazard. The 48f7501 text here said the materialization guard made a late
  original job's replay safe; that guard is withdrawn because it also swallowed
  a person's rename-back (R1, R2). The replay itself is unchanged from before
  this branch: the original job resends the complete initial row with no
  `comments_base_at`, the writer's scalar CAS never engages, and the fields a
  person changed in between are overwritten (R3, on a browser-created card with
  the reconciler idle). This branch neither introduces nor widens that exposure,
  because it creates no card for such a job to replay over; closing it is the
  remaining contract above and an owner decision on the frozen writers.

## Rollback preserving accepted work

Behaviour rollback is to stop dispatching. Nothing else is needed for the
reconciler: with no schedule, an undispatched reconciler does nothing. Third
head: the one fact-recording trigger per card table is the only part of this
branch that acts on every write regardless of dispatch, and it alters no write;
if recording itself must stop, `alter table public.calendar_posts disable
trigger zz_production_card_provenance` (and the same on `sample_reviews`)
restores the exact previous write path. There is no `zy_` trigger to kill.
Retain the provenance table on any rollback. Rows this branch recovered and
slots it bound are real accepted work with real receipts and real card bindings
and must be retained exactly like any browser-materialized intake; it created
no card. Do not drop the
functions while a dispatch is in flight, do not delete `deliverable_events`
reason rows, do not delete recovered deliverables or their `skipped` receipts,
do not clear card slots it bound. Dropping the reconcile functions and helpers
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
- Third head, withdrawn: the 48f7501 bullet here proposed to "let in-flight
  jobs drain" as a release hold. A drain cannot be assumed or observed from the
  database, so it is not a gate of this branch; automatic card creation is
  structurally disabled instead (`card_creation_held`) and the remaining
  contract for turning it on is stated under the stage 2 contract.
- Third head, the pre-existing overwrite: a late original browser job still
  overwrites a person's edits on the card it created (R3). Not introduced and
  not widened here; not closed here either. Closing it is a frozen-writer
  decision for the owner.
- Third head, bind cohort: the slot bind relies on the `created` fact showing
  the slot empty. A card created with a slot bound by a caller that bypassed the
  trigger (the trigger disabled, a bulk load) has no `created` fact and is held
  `card_provenance_unavailable`, never bound.
- Writers: the recording triggers were exercised through the REPOSITORY sources
  of `calendar-upsert` and `sample-review-upsert` loaded in the lane with a
  fixture staff key. The serving v48/v49 bodies are un-gated by owner directive
  and are not this source; their write semantics against these triggers are
  unproven until observed on an installed copy.
- Provenance install: any request accepted before the `installed` marker is
  held for an operator. Pre-existing cards gain facts only from the moment of
  install.
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

Independent review of the third head against this document, in particular the
cohort table and the remaining contract; then the owner's decision on whether
the frozen writers may convey an operation identity into their transaction
(contract item 1), which is the one change that would let automatic card
creation be reconsidered. Only after that: apply the three migrations in order
on a disposable copy of live schema (not the repository fixture) and dispatch
the workflow in dry-run against it to validate the column assumptions before
any live apply. Nothing here declares card completion or Decision A ready.
