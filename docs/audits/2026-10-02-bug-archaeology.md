# Digger: preventive bug archaeology, 2026-10-02

Four source defects survived skeptical verification and have fixes and regression
guards in one branch. Analytics no longer treats HTTP errors as fresh data;
the backfill refuses incomplete copies; a named caption job is filtered before
the result cap; and HubSpot uniqueness requires a complete provider read.
Nothing was deployed, applied, merged or changed in a live backend. In particular,
the HubSpot function remains an off-by-default, source-only build.

## Scope and stop rule

Audit base: the fetched main ending in PR #1937. Corpus window: September 19
through October 2. Sources: merged fix titles and source diffs, `EXECUTION_LOG.md`,
`ROLLBACK.md`, `docs/ops/OPEN_REPAIRS.md`, the F29/F126 read-completeness history in
`docs/truth/BRIEFING.md`, and existing regression suites. The routing documents
were consulted before the split, analytics, n8n exit and onboarding source.
This is a bounded, history-driven sweep, not proof that every repository path is
bug-free or that any particular source is deployed.

Live systems stayed read-only. All failure drills used fake transports and
synthetic data. No real client names, slugs, credentials or payloads were saved.
No Clients tab fragment, roster-read, roster-write, client-profile-write or n8n
workflow was changed. Their owners retain those surfaces. No tests or exemptions
were skipped, disabled or loosened. Three new suites join the existing unit
classification; the existing HubSpot suite's import now uses a file URL on Windows.

The loop cap was five cycles; the deterministic stop was two consecutive cycles
with zero new confirmed findings. Three cycles ran: the first confirmed four;
the two subsequent bounded sibling sweeps confirmed zero. A seen ledger below
keeps refuted claims out of subsequent queues. Each survivor received a separate
skeptical pass, including independently executed real-code counterexamples.

## History through the six lenses

### DGR-P1: failed read promoted to fresh data

**Mechanism.** The TikTok false-empty repair (#1767), and the later Notes loading
repair (#1929), distinguish an unavailable or pending read from a real empty list.

**Preconditions.** A caller receives no usable data while a parser or default
still supplies an empty collection. HTTP fetch resolves even on non-success status.

**Class.** Read failure is converted into a successful state transition.

**Cohabitants.** Analytics essentials/extras, mirror reads, flag reads and the
onboarding checklist all acquire data before painting or recording readiness.

**Context-shift.** Turning on database reads adds a fallback; the fallback must
retain the same failure distinction when the database is off, stale or refused.

**Isomorphs.** A missing roster and missing metrics have different nouns but the
same destructive empty-parser shape. An absent checklist row is a related shape.

### DGR-P2: a successful last part certifies an incomplete whole

**Mechanism.** F29/F126 and the analytics receipt correction retained in
`test/sheets-mirror-policy.js` show that one successful read or receipt does not
prove complete multi-source or multi-client coverage.

**Preconditions.** Input is divided into chunks or sources; errors in an earlier
part are not carried into the final completion decision.

**Class.** Completion authority is local to the final part, while consumers rely
on a claim about the whole set.

**Cohabitants.** Whole-Sheet backfills, provider association pages, batch deal
reads, parity/catch-up readers and mirror receipt consumers.

**Context-shift.** A larger dataset crosses the chunk boundary, or a provider
returns mixed success, while the last chunk still looks valid.

**Isomorphs.** Analytics' final-chunk receipt and HubSpot's unique-deal decision
both incorrectly promote a partial set into proof of a whole set.

### DGR-P3: the cap is applied before the requested scope

**Mechanism.** The deterministic starvation described in F29 demonstrates that
a bounded result set can hide valid requested work.

**Preconditions.** The query limits a wider collection before applying the
identity or post filter that defines the caller's requested collection.

**Class.** A performance bound changes a scoped lookup's meaning.

**Cohabitants.** Caption status history, analytics paginated reads and HubSpot
association retrieval.

**Context-shift.** Accumulated history exceeds the cap while the requested row
remains valid within retention. A named caption job bypasses the 24-hour window.

**Isomorphs.** The same error appears as a missing job behind newer jobs or a
missing winning deal behind a manually sliced association prefix.

### DGR-P4: correct changes cross an ownership boundary

**Mechanism.** The historical Sandbox-symbol-drift incident and #1812's dropped
queue refresh show how a caller can lose a helper or continuation it used to own.

**Preconditions.** A shared symbol moves into a lazy/module area, or asynchronous
work finishes after its route, identity or document generation was retired.

**Class.** Two locally correct changes disagree about who owns execution.

**Cohabitants.** Module exports, lazy loaders, route draw callbacks, client entry
leases, realtime callbacks and failed-read Retry state.

**Context-shift.** Cold first load, quick tab replacement, navigation before
DOMContentLoaded, a failed script load followed by Retry, or capability revocation.

**Isomorphs.** Missing exports and stale painting are different ways of executing
outside the boundary a consumer expected. Existing split and ownership guards
refuted the concrete siblings examined here; this pattern yielded no new fix.

## Survivors, in priority order

| Finding | Impact/exposure/check cost | Mechanism and evidence | Fix and regression guard | Release stage |
|---|---|---|---|---|
| DGR-1 / DGR-P1 | Client/staff; active fallback; cheap offline | `fetchEssentials` accepted failed Metrics or roster responses, marked them live, replaced good state and cached error HTML. Both independent actual-function harnesses reproduced this; extras already had the missing status guard. | Require both successful responses before either body is consumed. `test/analytics-essentials-http.js` executes the readers/parsers, independently rejects 403/503 for either source, preserves good data/cache/fingerprint, and proves error/Retry and revoked-run behavior. | Page source; merge by Lighthouse. |
| DGR-2 / DGR-P2 | Client/staff data trust; backfill operator path; cheap mocked script | `sheets-mirror-backfill.js` counted an invalid early row but sent it; a valid final chunk set `complete` and `full_snapshot`. The writer only examines its current chunk. A real-script, all-transports-mocked 2,001-row run certified a whole copy after one early rejection. | Refuse locally rejected whole-tab input before any send; require full per-part acknowledgements before continuing. Legitimately unchanged profile writes remain allowed. `test/sheets-mirror-backfill-completeness.js` proves early local/server failures, missing/short counts, valid multiple chunks, blank-name policy and unchanged profiles. | Operator script; no live copy executed. |
| DGR-3 / DGR-P2,P3 | Future sales-state identity; off by default; cheap adapter/handler | `client-hubspot-sync` sliced associations to 25, ignored further pages and accepted partial batches. A second Closed Won deal in position 26/page 2 was discarded, and a partial 207 batch established a false unique match. SQL trusts the supplied match. | Read bounded complete association pages; read deals in batches of 100 with exact ID coverage and complete replies; refuse malformed, partial or exhausted reads before persistence. Extended `test/client-hubspot-sync-handler.js` proves real adapter-to-handler refusal with zero apply RPCs, ambiguity and valid pagination/batching. | Source only, before owner enablement/deploy. |
| DGR-4 / DGR-P3 | Staff scoped status lookup; endpoint active, high-history precondition; cheap real GET branch | `caption-jobs` selected the latest 200 jobs for a client before applying documented `postId`/`jobId` filters. The actual GET branch returned no requested retained job behind 201 newer unrelated jobs. No live user outage was observed. | Apply both identity filters inside the client-scoped database query before ordering/capping. `test/caption-jobs-scoped-read.js` proves retained old-job lookup, scoped post lookup, combined filters, unchanged unfiltered cap and database-error rejection. | Function source; owner deploys through the existing single-function lane. |

All four new behavioral guards were run against old code and failed for their
claimed defect before passing on the fix. The HubSpot baseline was imported via
a Windows file URL so its old-code failure could not be confused with the
pre-existing Windows import failure. The new backfill guard's old-source preload
also required correcting shell path quoting before the meaningful negative run.

Provider contract evidence: HubSpot's [association pagination](https://developers.hubspot.com/docs/api-reference/legacy/crm/associations/associate-records/get-associations)
and [deal batch read](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/batch/get-deals),
plus the [official SDK's explicit 207 response handling](https://raw.githubusercontent.com/HubSpot/hubspot-api-nodejs/master/codegen/crm/deals/apis/BatchApi.ts).
The current Supabase changelog was consulted; these fixes change application
selection and completeness rules, not schema, grants, auth or SDK versions.

## Seen ledger and skeptical verdicts

The scored queue prioritized active client-facing reads, then staff lookup,
operator completion and off-by-default identity paths. Cheap source/real-code
checks preceded any live probe. No live probe was needed to establish a survivor.
22 distinct candidates: four confirmed, 16 refuted, two undecidable.

| ID | Claim / pattern | Verdict and refuting or confirming evidence |
|---|---|---|
| C01 | Missing cross-area module helper / P4 | REFUTED for examined calls: `check-modules` import/export checks, lazy safety map and module strip/split tests cover the dependencies. |
| C02 | Lazy script executes before DOM readiness / P4 | REFUTED: `svArea` explicitly waits for DOMContentLoaded; actual-function VM guard passed. |
| C03 | Concurrent first callers duplicate lazy execution / P4 | REFUTED: the shared area promise deduplicates; actual-function VM guard passed. |
| C04 | Old lazy navigation repaints a newer route / P4 | REFUTED: nav sequence and current DOM wait ownership reject the stale draw; VM guard passed. |
| C05 | Failed lazy download remains stuck after Retry / P4 | REFUTED: failure clears the area promise and the actual Retry read starts afresh; VM guard passed. |
| C06 | Client split opt-out contains uncontrolled parameters / P4 | REFUTED: #1872's exact split=0/1 allowlist and strict client preflight test. |
| C07 | Minification renames shared globals / P4 | REFUTED for build: module checker rule 9, module stripping and split build guards preserve shared names and emitted bytes. |
| C08 | Essentials HTTP errors become fresh data / P1 | CONFIRMED, DGR-1. |
| C09 | Backfill final chunk hides earlier rejection / P2 | CONFIRMED, DGR-2. |
| C10 | Caption scoped lookup limits before filtering / P3 | CONFIRMED, DGR-4. |
| C11 | Partial HubSpot set becomes unique identity / P2,P3 | CONFIRMED, DGR-3. |
| C12 | Analytics datasets stop at first database page / P2,P3 | REFUTED: `analytics-read` uses `readAll`/`readAllParallel`; parity/catch-up use Range pagination. |
| C13 | Sequential metrics retry appends duplicate copies / P2 | REFUTED: shifted occurrence interval remains within the already persisted contiguous range; no newly allocated row lies beyond it. This does not prove concurrent retry behavior. |
| C14 | Client profile projection exposes staff-only fields / P4 | REFUTED: least-field projection separates client-link and staff answers. |
| C15 | Database mirror/flag failure becomes ready / P1 | REFUTED: mirror client/staff reads and the flag read reject non-success statuses/envelopes. |
| C16 | Required extras error becomes ready / P1 | REFUTED: TopVideos and market brief HTTP statuses are checked. Optional summary failure is intentionally tolerated. |
| C17 | Hung lazy script has bounded Retry deadline / P4 | UNDECIDABLE-WITHOUT-ACCESS within the timebox: no app timeout was found, but held-script VM alone does not establish browser/network termination or an owner-ratified deadline. Not a finding. |
| C18 | Overlapping metrics collection lease corrupts tracking / P2 | UNDECIDABLE-WITHOUT-ACCESS: no real overlap precondition or terminal conflict reproduced in this scope. Not a finding. |
| C19 | Checklist database error becomes empty success / P1 | REFUTED: `_shared/client-onboarding.mjs` `must()` throws and the get branch awaits its Promise.all. |
| C20 | Missing checklist progress implies complete / P2 | REFUTED: summary view cross joins catalog and coalesces absent progress to todo. |
| C21 | Unknown/skipped checklist result falsely counts done / P1 | REFUTED as an unauthorized behavior change: migration documents that completion semantics is intentional. |
| C22 | Concurrent checklist edits lack a version check / P4 | REFUTED: expected version required in handler, row locked with FOR UPDATE and compared with IS DISTINCT FROM in RPC. |

Large future rosters and older retained summary behavior were pruned from the
current queue because the required current precondition/change-period link was
not established. No absence-of-bug conclusion follows from that pruning.

## Per-cycle self-supervision and critique

**Cycle 1.** Goal: identify latent siblings of real incidents in the specified
change period and fix only skeptical survivors within the ownership boundaries.
Starting cost/yield: none. Parallel mining and independent skeptical passes
covered split/module boundaries, analytics read/copy paths, captions and new
onboarding reads. Source traces plus offline real-code counterexamples yielded
four confirmed repairs. The seen ledger retained refutations; unrelated live
retirement actions and protected writers were pruned.

**Cycle 2.** Goal unchanged. The previous cycle cost source/history reads and
mocked counterexamples, yielding four fixes and four regression guards. This
cycle mini-swept the discovered read/completion and cap patterns across mirror,
parity/catch-up, client entry and onboarding. Existing status, pagination,
projection and version guards refuted the new siblings; no new confirmed defect.

**Cycle 3.** Goal unchanged. Cycle 2 yielded no new confirmed defect; previously
refuted claims stayed pruned. The final isomorph pass checked lazy ownership,
retry allocation and checklist completion against actual guards. No new
confirmed defect. Two consecutive dry cycles satisfy the stop rule.

**Third-cycle critique.** Missing-symbol hypotheses were generating duplicates
once the import/lazy gates were established. Attention moved to error-as-data
and completion claims instead, where the confirmed defects occurred. High-impact
fallbacks were tested before hypothetical large-roster limits. No permanent
skill instruction was altered, and no broader clean-health claim is made.

## Verification boundary

Focused guard outputs, whole-unit results, visible-boot results and remaining
platform/hosted proof gaps are recorded in the PR and the appended OPEN_REPAIRS
entry. Local success is not hosted CI or live proof. Required isolated/private
profiles retain the runner's existing NOT_RUN classification in the unit lane;
this audit adds no skip or exemption. Private raw outputs remain outside git.
