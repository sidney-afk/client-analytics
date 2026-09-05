# Native completion: independent correction review

Review date: September 5, 2026. Exact PR #1308 head: `48f75012a3826d27ef087556eca90b941709d3c1`; correction parent: `df3d0325cac89d3fa9a0fdcb004933025b25ad27`; stacked prerequisite PR #1302: `8cb5cba91bc33fb17599b8f2a38625ae07f7743d`.

**Verdict: changes required before release. The claim that all three original blockers are fixed is NOT fully supported.** The exercised public-CLI disclosure and post-install deletion-provenance cases are corrected. The replay guard passes the original late-browser cases but introduces a reproduced false-success response to legitimate human edits on both card surfaces. Keep application of this migration and automatic Stage 2 held.

## Evidence and limits

The actual repository migration/gateway/writer lane completed **62 checks: 62 PASS, 0 FAIL, no SQL skip**. The actual CLI child-process suite completed **14 PASS, 0 FAIL**. Six additional independent cases produced **two human-reset FAIL results and four preservation-control PASS results**. These six results are separate from the original 62 and must not be folded into an all-green count.

The SQL exercise used an independently owned disposable PostgreSQL 16.14 instance, stopped afterward. The original assertions were preserved; launcher adjustments selected the local executable and appended independent cases. No live request, production SQL, workflow dispatch, deployment or serving-writer test occurred. Existing module warnings and inherited fixture projection-read diagnostics remain in the retained evidence; this is focused local proof, not a warning-free full-suite or installed-schema result.

The 13-file correction adds sanitized CLI output, CLI tests, transactional card provenance, a replay trigger, writer/browser fixtures and documentation. Browser, gateway and frozen writer source bytes are unchanged from the correction parent. The new database trigger nevertheless changes the effects of their writes.

## P2 — human reset is acknowledged but not saved

At this exact head, `migrations/2026-09-05-native-intake-reconcile.sql:334`, symbol `production_card_materialization_guard`, reads the creation signature at lines 343–346, compares the resulting row at lines 348–350, and restores prior field values at lines 352–353.

Independent reproduction through the actual repository writers, on both Calendar and Samples:

1. Accept native intake and let reconciliation create its card.
2. Deliberately rename the card to a different title.
3. Deliberately rename it back to the original title through the same writer.

Both writers return **HTTP 200**, but readback retains the intervening title. The requested human change is silently lost. No old browser job participates in this reproduction. Existing `scripts/native-intake-reconcile/lane.mjs:563`–570 changes the title/status to different values, so its ordinary-edit control does not exercise this reset.

The trigger sees the merged resulting row, not trustworthy operation intent. An old materialization replay and a legitimate human reset can produce the same values. Equality with the creation signature cannot distinguish them. `production_card_is_materialization` at SQL lines 285–292 also classifies by status, schedule and occupied slots without requiring a root manifest or receipt. A copied or otherwise non-intake card with that shape is therefore within the source classifier; no particular copy-UI journey was exercised.

The four additional controls passed: media plus archive/title preservation, and occupied-slot preservation, on each surface. Those suspected overwrite cases were not reproduced. Preserve these controls alongside the two failing resets.

## Original blocker adjudication

| Original blocker | Bounded result |
|---|---|
| Public stdout/stderr identifiers | **Closed in the exercised CLI paths.** `scripts/native-intake-reconcile/run.js:112`–113 emits `publicReport`; keyed progress and bounded errors omit raw response bodies. All 14 actual CLI controls pass. This does not certify every hosting surface or private-export destination. |
| Missing best-effort create event allows deleted-card resurrection | **Closed for the exercised post-install provenance boundary.** `production_card_provenance_record` at SQL line 295 and triggers at lines 320–323 record INSERT/DELETE provenance in the card transaction. Existing P2 holds an event-less committed/deleted card; P3 recovers a post-install never-created obligation; P4 holds pre-install acceptance as `card_provenance_unavailable`. Historical recovery remains unresolved. |
| Late browser overwrites newer human changes | **Not release-closed.** Original B2–B6 cases pass, but the same replay guard causes the two human-reset false successes above. No new trustworthy operation receipt distinguishes the conflicting intents. |

## Activation and remaining proof boundaries

**An unscheduled runner is not an activation guard.** Applying the migration immediately creates the BEFORE UPDATE triggers on both card tables at SQL lines 368–371. The documented hold is a release-process hold, not a runtime fence. Do not apply the bundled migration as though only the manual runner can change behavior.

The previously open **P2 child-set proof gap remains** in `production_intake_reconcile_cards` (SQL line 563). Lines 689–690 lock whichever expected deliverables still exist; they do not re-establish exact expected-set identity/cardinality under those locks. Lines 784–787 check surviving rows and cannot by themselves establish that an expected child was not removed. The original two-connection deletion/identity race remains unproved; it was not rerun in this bounded correction review.

`docs/audits/2026-09-05-native-intake-reconcile.md:162`–163 also states the wrong lock order. Source locks deliverables at SQL lines 689–690 before card rows at lines 702/706. Correct the description and prove the required concurrency behavior before release.

Optional private export has a separate **source-only containment gap** at `scripts/native-intake-reconcile/run.js:57`–58: a relative string beginning with `..` is not necessarily a parent-directory traversal, and symlink ancestors are not resolved. The check can accept an in-repository destination with that prefix. No unsafe export was executed. The 14 CLI passes do not close this additional path boundary.

## Smallest safe correction boundary

Keep automatic Stage 2 and the replay-trigger migration held. Define a separately reviewed operation/receipt distinction covering old in-flight and saved jobs while preserving ordinary human resets. If unchanged frozen writers cannot convey that distinction, retain the hold; do not substitute another content heuristic or re-gate client writers.

Stage 1 missing-child completion, immutable IDs/fingerprints, accepted epochs, provider-era deferral, F27 fences and sanitized reporting retain independent value. This review does not authorize splitting or deploying the bundle. Exact child-set checks under locks, full installed constraints/triggers, serving-writer parity, old-job retirement, deployment and operational scheduling remain **UNPROVEN**.

## Hash-bound source and evidence

The accompanying sanitized JSON records exact source pins and opaque evidence hashes. Retained evidence contains synthetic test material and is not published here. Its hashes identify the reviewed receipts; they do not replace the unexecuted release proofs.

| Evidence | SHA256 |
|---|---|
| SQL/gateway/writer receipt, including six independent cases | `d14faa241779e2b4d10c013c7c77eda3f81cd71d3242fa8bb55724e26a04abe1` |
| Actual CLI receipt | `e0475186c112b7dd911a9ae21c498f5bf67c36d3db0a61b2ed0adf7aea24fdd2` |
| Augmented lane used for the independent cases | `7bb7e3cfb4020968ffb1cc3a0b066fd5a4b459fe1c5b9bef8b4340318a632d5d` |
