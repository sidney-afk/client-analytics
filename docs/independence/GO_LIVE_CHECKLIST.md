# SyncView Go-Live Checklist — current Linear exit sequence

**Decision, 2026-09-04: NOT READY for Decision A. Do not revoke the product's Linear access yet.** Both teams are already SyncLinear-authoritative. Remaining provider reads, stale writers, incomplete card/work coverage, recovery debt and unproved client/alert drills prevent a safe shutdown.

**Time-sensitive owner action:** a read-only Linear API query at `2026-09-04T21:06:52Z` reports cancellation requested on August 26 and scheduled for **September 15, 2026 at 13:46:53 UTC**. It reports subscription type `basic_monthly_12`, 13 seats and 14 workspace users. No billing change was made by this audit. Confirm that schedule and the account's actual transition consequences in Billing now. If the gates below cannot finish before then, the owner must arrange a verified retention period or explicitly validate the downgrade alternative. Do not let an existing cancellation stand in for technical readiness. A 14-day observation beginning September 4 already crosses this deadline.

## Authority, scope and evidence

This is the **one current execution sequence**. Its location is justified by the previous checklist's purpose at original lines 3–8: this is the living canonical operator sequence. Historical flip instructions are preserved below a nonoperative banner. **Do not replay their Linear/Linear initial state, authority flips, Phase 0.75 authentication change, or blanket client-write freeze.** The dated plans and reviews remain evidence, not alternative runbooks.

This publication changes documentation only. Each later code release, migration, manual deployment, n8n edit, credential operation and billing decision needs its own reviewed implementation and applicable owner authorization. A gate that requires missing implementation is not executable merely because this document describes it; its precise release, rollback package and successful rehearsal must exist first.

- [Independent snapshot and surface/source ledger](../audits/2026-09-04-linear-exit-evidence.md) was sealed before historical review. SHA256 of the original snapshot: `b863b7d025d763b629fb70824d8f18ca33040e0a830e14aa818dd6fec6b15c4a`.
- [Machine-readable evidence](../audits/2026-09-04-linear-exit-measurements.json) preserves timestamps, exact source fingerprints, aggregate counts and explicit coverage limits.
- [Claim-by-claim adjudication](../audits/2026-09-04-linear-exit-adjudication.md) covers the initial Claude plan/action history, all three PR1257 documents, Claude's review, the recovered second Codex recommendations, old B5/specification and analysis tools.
- Source baseline `5765cfe80b7ca9844bab79a55fd75784bf9cb693`; live Pages matched it byte-for-byte at 20:54 Z. Main advanced during the audit to `85a1bafc268722eda310d8f1af94c9686585bbe0`; its entire delta is two onboarding copy replacements, with no dependency or line-count change. Every implementation must refresh this evidence against its own exact release.
- All 35 deployed functions were read through the Management API. 30 source closures match the baseline exactly. Two intentional frozen client-writer auth differences, one material Workload writer difference and two formatting/comment-only differences account for the other five. This proves serving source/JWT posture at the measurement time, not successful client journeys, database RPC source, or future deployment.

**Frozen client contract:** `calendar-upsert` v48 and `sample-review-upsert` v49 intentionally omit the repository authentication calls. Existing anonymous review links must keep viewing, approving, requesting changes and writing notes/comments. Never deploy the repository copies or a generic old bundle as a rollback without preserving that serving behavior. No publishable-key rotation or client-writer re-gate is part of this program. Platform `verify_jwt=false` alone is insufficient: inspect the function's own authorization too.

## Execution checkpoint — September 5, 2026

**Decision A remains NOT READY.** The following are reviewed draft implementations and test evidence, not deployed behavior. This checkpoint extends the same G0–G10 sequence; it does not create another execution plan. The original September 4 snapshot, measurements and adjudication remain immutable historical evidence. The [September 5 execution evidence and assignments](../audits/2026-09-05-linear-exit-execution-evidence.md), [23:15 UTC GitHub snapshot](../audits/2026-09-05-linear-exit-github-checkpoint.md) and [independent native-completion review](../audits/2026-09-05-native-completion-independent-review.md) record the current bounded results below. GitHub owns the public program record; private operator packets and sensitive raw receipts remain outside this public repository.

| Gate / deliverable | Exact checkpoint | What remains before release |
|---|---|---|
| G1 Samples continuity and compatible recovery | [PR #1295](https://github.com/sidney-afk/client-analytics/pull/1295), `56fad300638094e268d2f10dabaf0ffc5661ec6d`: independently reviewed published integration of preserved `e665ba77` and captured main `ab636613`; six applicable hosted checks passed, two optional suites skipped. Twenty focused commands and five browser suites passed; the paired reader-only inverse was rebuilt and reviewed at the final head. All 308 named Samples functions and frozen writers retain their reviewed bytes. | The pinned source integration and local recovery gates are closed. Prove approved live client persistence and active W01/W02/W10. Earlier static live HTML matched `5b9c0720` at 20:28:29 UTC; that historical document read proves neither this candidate deployment nor client/writer journeys. The later initial-read monitor and other feature drafts are not included in this Samples tree. |
| G2/G3 accepted root-intake manifest and staged native intake | [PR #1293](https://github.com/sidney-afk/client-analytics/pull/1293), `5418ab5618595d9469f0527bd94623e9229a637e`: 41 actual-handler/SQL checks, three baseline controls and four hosted checks passed. Stacked [PR #1302](https://github.com/sidney-afk/client-analytics/pull/1302), `8cb5cba91bc33fb17599b8f2a38625ae07f7743d`, adds disabled native epochs and provider-prerequisite bypass; 50 real handler/SQL native checks and all four hosted checks passed after independent review. | Uninstalled. Corrected completion [PR #1308](https://github.com/sidney-afk/client-analytics/pull/1308) at `48f75012a3826d27ef087556eca90b941709d3c1` passes 62 SQL/gateway checks and 14 public-CLI checks, but independent actual-writer tests reproduce silent rejection of a legitimate human rename back to the original title on both card surfaces. Applying the migration immediately activates its broad replay triggers; the unscheduled runner is not an activation guard. Hold the migration/automatic Stage2 until trustworthy operation identity replaces content guessing and child-set validation under locks is proved. Assignment [PR #1309](https://github.com/sidney-afk/client-analytics/pull/1309) at `69ae5d338486bd8084e6bbdbe65be1c44f63dbe1` preserves both original role-selection fixes, independently closed with actual handler/SQL controls at its unchanged runtime parent. The coordinator published a two-file catalog correction: all three reader projections preserve policy inputs and mapping validity, and REST checks exact ranges and unique complete coverage. All 39 CLI/policy checks pass; all four current-head hosted checks and named independent published-head review are now closed. These close the bounded draft assignment/catalog correction, not operational assignment independence. Existing-work reassignment and picker dependencies remain separate scope. |
| G3 recoverable action history | Preserved [PR #1299](https://github.com/sidney-afk/client-analytics/pull/1299), `85018bf83ab49527c79ca86d521c6a08a31e3277`, retains ordinary journal capture and its earlier synthetic evidence. Separate correction [PR #1311](https://github.com/sidney-afk/client-analytics/pull/1311), `aab2acd23112f7bdff849a9c0b68306d41bbf62c`, preserves the corpus correction at `aadb010184d4fe23017ac681c663df8cc9a3e1e4` and adds a one-file restricted-role authentication harness fix. The correction adds explicit history-v5 with 33 tables, exact replay/crosswalk/F27 dependencies and pre-mutation foreign-key refusal. Nineteen local SQL checks and the prior fourteen restore checks pass; the coordinator independently reran 41 new and 33 preserved format checks and verified exact source/receipt hashes. | The bounded corpus correction and subsequent authentication fix passed named independent published-head review. All three hosted checks now pass at `aab2acd2`. The original 19 SQL checks plus four wrong-password controls pass on an independently owned PostgreSQL 16.14 cluster enforcing SCRAM authentication; the earlier hosted failure at `aadb0101` is preserved as historical harness evidence. This does not establish installed-schema or complete-platform recovery. Authenticated schema capture and empty-target reconstruction remain missing. Data-only packages are not independently recoverable. Failed-comment draft conservation, installed-schema/grants, cloud readback/restore, alarms and retention remain required. Do not truncate unbacked tables or weaken journal atomicity. Existing scheduled selection remains the 14-table legacy format; no new format is activated. |
| G3 feedback draft conservation | [PR #1304](https://github.com/sidney-afk/client-analytics/pull/1304), `78e6b3eaf35e254daa23dd69b2d8f9ee54974434`: six applicable hosted checks passed, two optional suites skipped. Local checks cover browser history-cache restores and exact ownership/receipt-matched conservation. A separately reviewed local consumption-recovery artifact preserves the remaining browser contracts; its nine round trips cover notes, with tweak saves in a separate matrix. | Uninstalled. Subsequent actual-browser testing found Calendar can hide retained feedback debt after native acceptance and a failed or uncertain source save. The bounded correction must preserve visible recovery across fresh links and use exact receipt/source proof without a second native action. Old attempts lacking original fingerprint metadata must remain visibly unresolved; never guess acceptance. The scoped consumption artifact is not a universal rollback. |
| G4 dedicated component feedback | [PR #1297](https://github.com/sidney-afk/client-analytics/pull/1297), `ce86295ba3fc892ce1ad63a9065beed3ab3b603f`: seven applicable hosted checks passed, two optional checks skipped; 26 handler, 13 browser and 168 behavior checks passed. Full light/dark pixel coverage and 14 comparator controls pass after correcting a baseline-reproduced test defect; application runtime is unchanged from reviewed `120fb0d`. | The local pixel/context-menu gate is closed. Integrated release and installed-reader/live journeys remain unproved. No merge or manual reader deployment is approved. This exact-mapped reader is not an import or a second discussion store. |
| W01/W02/W10 monitoring | Preserved [PR #1292](https://github.com/sidney-afk/client-analytics/pull/1292), `6383bd915bc0403d1b26140adda3cafe0d5f6749`, includes runner, observer and relay. Initial-read [PR #1303](https://github.com/sidney-afk/client-analytics/pull/1303) is now `92d261c45ab9bacef38829c0fc7c9597e344ca61`, independently reviewed after publication with all four applicable hosted checks passed. Root reran 257 operations and 119 initial-read assertions. Forty contradictory observer receipts now refuse; fourteen legitimate controls remain unchanged. Earlier 20 real-SDK scenarios remain historical evidence at preserved `37b065b8`. Two approved primary failure/recovery DRILL DMs were independently read back. | Uninstalled and inactive. Human acknowledgment, recurring scheduling and independent fallback remain unproved. Full viewer runs were held by blocked background transports. Initial-read proof requires an approved positive live canary and exact current page/SDK bindings; it cannot close approve/comment/tweak or full client-journey gates. |

Earlier remote main `34f6a888babe27acc4007a35ffcc87f8633484cc` followed external `244de82a83a446d17b1a6b05e3b6c0828b631151`, which changed product HTML and `production-write`; the `34f6a888` delta changed only `AGENTS.md`. Captured main `5b9c0720e98f81324948bf2de932520226bc9832` matched a static public-root GET at 20:28:29 UTC. Remote main has since advanced through `3d534cfa5598ef16e61c5ee7dc8072afaa9963c7` to `ab6366136c03239965c97b050ab5cf7c9763a228`; no serving refresh is implied by that source observation. The last coordinator live-browser receipt at 19:15:19 UTC used `a05e1126437bb8c36bd3f33e3701a58924a8627d` and remains historical. Every integrated runtime and reviewed fix needs its own final review and applicable checks; green CI alone is not review.

All four Claude results and both corrected native heads have been received and independently checked; no further relay is needed for those exact heads. The observer correction is defense in depth: its existing producer latch already prevented the contradictory healthy/denied combination. Manual crash-lock quarantine and per-binding receipt directories are documented, with no automatic lock stealing or alert replay. The [history review](https://github.com/sidney-afk/client-analytics/blob/af929858628443cd6a44d85ad535d912dc26492a/docs/audits/2026-09-05-card-history-adversarial-review.md) correctly identified omitted restore dependencies. Its proposal to discard unbacked dependents is rejected; actual catalog checks show the three proposed replay/crosswalk tables remove three foreign-key edges, not five. The raw legacy 14-table restore already refused the expanded schema before PR #1299; the added broad guard was an additional limitation. Original evidence remains preserved; the new v5 proof states its platform scaffolding and schema-artifact limit.

Calendar recovery has an additional concrete boundary: the frozen comment-cell merge does not check or lock the canonical comment lifecycle, so an edit/delete/resolve between readback and copying missing source feedback can make that copy stale. Local `ce63c74d0333138f862cef5637bb7532fe059b74` preserves visible owned text and holds unsafe copies; seven intended repair acceptance cases remain red. Actual source execution also showed normal add receipts and their readback builder produced different fingerprints. The separately reviewed correction is now published at [`7e5a743cce8a1552bc822e0e560896451f983cdf`](https://github.com/sidney-afk/client-analytics/commit/7e5a743cce8a1552bc822e0e560896451f983cdf), preserving old add hashes, with 238 actual-handler groups independently rerun. Its persistence is RPC-shaped in-process simulation, not PostgreSQL, and it has zero hosted check runs at the checkpoint. Outbox-less native acceptance still refuses readback; this is not complete source/status recovery. The offered tweak flow accepts a comment, accepts its own status change, then can fail the source save. A future atomic repair must bind that exact original status companion and retain unresolved source-status/approval obligations; copying only the comment cannot certify complete tweak recovery. Conservative original source-row CAS is the selected first boundary. No per-component epoch redesign, whole-old-row replay, frozen-writer change or client re-gate is authorized by this checkpoint. The bounded next feedback implementation may repair only the exact originally owed status/approval fields with the comment under the original source-row CAS, supported by its own action receipts and atomic lifecycle checks. The [three archived Claude assignments](../audits/2026-09-05-linear-exit-execution-evidence.md#next-bounded-assignments) are prepared and delivered for owner launch; launch is not yet confirmed. They preserve the current drafts and do not authorize release.

No coordinator production merge, deployment, flag change, business-data mutation, n8n edit or billing change has occurred. The owner reconfirmed September 15 cancellation; access sufficient for G10 remains unresolved. Public evidence uses counts and hashes; exact TEST bindings, operator packets and necessary restore evidence remain private. A proposed single positive Samples test card has not been reserved or inserted, and does not authorize later interactions or cleanup.

## Three separate decisions

| Decision | Meaning and release authority | Required proof |
|---|---|---|
| **A — operational independence** | Owner records that SyncView can operate with all product Linear credentials revoked and provider access denied. No billing/workspace deletion is implied. | G0–G9 complete; every offered client action works; no provider egress or new provider intent; current data/history visible; provider-free recovery rehearsed. |
| **B — controlled retention** | Keep Linear available only for authorized export/inspection during a defined observation period, with operational writes disabled and integrations isolated. | Tested permission/retirement controls, archive access and asset access; remaining export credentials separately identified and forbidden to product runtimes. No assumption that inbound is harmless or that Free is read-only. |
| **C — account disposition** | Owner separately chooses billing continuation/downgrade/cancellation, and separately chooses eventual workspace deletion. Cancellation is already scheduled; deletion is not. | Verified account consequences, completed retention period, forensic export, scratch restore, asset rescue and explicit owner decision. Do not classify every billing action as irreversible; use the table below. |

## What prevents shutdown today

The measurements in this table are the dated September 4 audit evidence. None of the draft checkpoints above closes a production gate; refresh counts, source and serving authority before the relevant release.

| Blocker | Evidence | Exact clearing evidence / accountable role |
|---|---|---|
| Intake, append and component fill still validate a Linear project before native writes | Serving `production-write` v66 matches source; `handleIntakeCreate:6003`, `projectForIntake:2398`; append validation is additionally conditional | Backend owner: provider-denied native create/append/fill receipts and correct cards/batches, including retries and public intake. |
| Labels and non-null assignee eligibility still require provider reads | Label read/write snapshot; assignee policy defaults provider-required when its flag is absent or fails | Backend owner: complete native label/member catalogs and policy; outage tests for picker, assign/unassign and commit; source/serving/DB proof. |
| Workload still uses Linear-derived membership and forced refresh; live legacy deadline writer is not fenced | `loadLinearIssues:14407`; diagnostic native reader only; captured `workload-linear` v6 directly updates Linear after staff checks | Frontend/backend owner: complete native Workload, tweaks/deadlines and stale-writer compatibility/cutoff. |
| Samples errors can become empty success; legacy readers/routing survive failures | Actual-source synthetic probe; `_sxrFetchPosts:61158`; routing flag failures clear native cohort | Frontend owner: G1 and G6 client-visible degraded-path proof. Calendar v2 already rejects its bad/empty fallback. |
| Work/cards are not conserved end to end | Current classifier:31 actionable linked/no-native component slots; current Workload classifier:13 real hidden items. Both tools miss other classes | Data/backend owner: full source-native-provider-card receipt classification, zero unresolved actionable omissions; reconcile legitimate drafts/suggestions separately. |
| Current active outbox appears clear but old debt remains | Full 6567-row scan:5595 written,863 skipped,95 stale,14 failed. All 14 failed are TEST; zero real normal pending/failed/shadow_ok | Operations owner: classify every stale/test/parity/dependency receipt and cutoff generation; do not present 14 TEST failures as 14 lost client actions or call 95 stale rows settled without evidence. |
| Client-visible history/assets and complete restore are unproved | 14607 native comments,465 mutation receipts,615 card links; archive-asset-ref inventory has 0 rows | Data/backup owner: audience-scoped completeness manifest, fetched independent assets, browseable client history, isolated restore. Zero inventory does not mean zero required assets. |
| External roots and alert/client probes not exhaustively proven | 129 n8n workflows/93 active;97 graph reads succeeded/32 failed; dynamic destinations, other credentials and true delivery remain unknown | Operations owner: full published graph/caller census, real TEST journeys, injected alarm and independent delivery acknowledgement. |
| Cancellation deadline precedes an assumed retention window | Live account API schedulesSeptember 15 | Owner: verify actual billing page/contract and ensure retention lasts through the evidence-based exit window. |

## Required test contracts

These are **future release tests**, not tests claimed executed by this strategy audit. Live mutations use only the owner-designated TEST client and need approval for that release. No real-client write is used as a canary. Nonmutating real-population comparisons remain private and aggregate-only.

| ID | Exact before-release and after-release exercise |
|---|---|
| T1 Client continuity | Open existing anonymous Calendar and Samples share links in a fresh browser and a retained old tab, without staff credentials. View current and historical content/media; approve; request changes; add note, comment and reply; edit; resolve; reopen; delete where offered. Reload in a second context and prove exact persisted state, thread visibility and one receipt per accepted action. Include mobile/touch/keyboard, expired authorization behavior, Back/Forward and BFCache. Expected invalid links may refuse entry; valid existing links must not acquire a new 401. |
| T2 Staff roles and work | As each eligible staff role use Submit root intake, append, Calendar Create Post, missing-component fill, Excel import, Workload refresh/tweak/deadline, Production labels/assign/unassign/status/due/description, Kasper review, archive/history and onboarding-to-production handoff. Verify assignments, counts, batch/card identity and new-work materialization after reload. SyncLinear new sub-issue creation must remain unavailable on UI AND server; Calendar owns it. |
| T3 Degraded reads | Hold/fail flag reads, REST and legacy readers; send HTTP401/403/429/500, timeout, malformed JSON, ok:false, missing arrays, partial pages, legitimate empty primary results and suspicious empty fallbacks. Start once with verified last-good data and once with no cache. Preserve meaningful content visibly stale, show honest failure/retry, never convert an unknown failure into an empty successful board. Recover without cross-client late paint or writes. |
| T4 Conservation and concurrency | Lose response after commit, repeat request/dedup key, retry concurrently, switch actor, close/clear storage, replay old browser debt, interleave edit/resolve/reopen, fail card materialization, omit a parent page and hold a worker across cutoff. Each accepted operation has exactly one native result or an explicit durable pending/conflict receipt. No silent discard, duplicate comment, wrong-client write, hidden missing card or false success. |
| T5 Provider-denied native-only canary | On a server-validated TEST scope deny all Linear HTTP/API/asset access and keep both teams native. Exercise T1/T2/T4; require zero actual outbound requests AND zero new provider intents in both outboxes/parity lanes. Check native writes/readback separately from mirror receipts. The isolation must not toggle a global production flag or revoke a shared production credential as the canary mechanism. |
| T6 Stale and alternate routes | Exercise old released bundles, queued local jobs, legacy Calendar path, legacy Samples, cached data, forced refresh, stored/query kill switches including `wl2=0`, direct production links and endpoint aliases. Old client writer payloads remain accepted into native storage. Prove server-side provider cutoff despite bypassing the new browser. A banner or seven-day wait alone is insufficient. |
| T7 Deployment and recovery | Record release SHA, browser bytes, per-function source closure/JWT, migration/RPC hashes and before-state. Apply to scratch/staging, restore exact prior source/config and verify hash/readback. After provider cutoff restore the prior **provider-free** stable release; never revive an old provider-dependent runtime. Data recovery preserves writes accepted since the snapshot through classified replay. |
| T8 Operations and alerts | Seed one synthetic failure for each watcher, including scheduler silence, missing terminal receipt and failed n8n relay. Prove owner delivery and acknowledgement through an independent channel. Restore and verify recovery alert. No notification or state changes are performed by this audit. |

Before merge use the affected existing offline/source/browser suites and updated harness. Relevant operator links: [unit checks](https://github.com/sidney-afk/client-analytics/actions/workflows/calendar-unit-tests.yml), [Production polish](https://github.com/sidney-afk/client-analytics/actions/workflows/production-polish-gate.yml), [client entry visible boot](https://github.com/sidney-afk/client-analytics/actions/workflows/client-entry-visible-boot.yml). Verify the live workflow's selector/TEST scope before dispatch; a workflow's existence or previous green run is not a current gate receipt.

## Ordered execution gates

### G0 — secure the evidence window and recovery baseline

**Change / order:** no product change. Confirm the scheduled billing transition; appoint release, data and incident owners; capture exact serving sources, flags, database definitions and private backups. Complete the inventory of current and dormant external creators, OAuth/personal/service credentials, webhooks, schedules, manual dispatches, n8n published versions, CI secrets, browser legacy queues and restoration bundles. Enumerate provider hosts reached through code/expressions/redirects, not just strings named Linear. Classify every account/provider source and permission limitation. Minimum client baseline/alert verification precedes G1; the remaining external inventory may finish alongside that isolated fix but must close before G6/G8.

**Owner / action:** operations and account owner perform read-only export/verification; any change to the pending cancellation is a separate owner billing action. **Clients during work:** their current deployed page, data and open writers continue unchanged because only read-only captures occur.

**Pre/post tests:** verify TEST fixture privately, T1 baseline and T7 scratch restore; read-only before/after source/flag/queue checks; T8 for existing channels. **Completion:** dated inventory has no unowned execution root; protected restore package is retrievable; owner confirms a retention period compatible with G10. **Rollback:** stop reads; no production restore needed. Preserve captured serving sources as restore points. **Abort:** unknown critical credential/root, incomplete source/backup, missing client baseline or unconfirmed retention deadline blocks dependent gates.

### G1 — release the isolated Samples reader correction

**Change / order:** make Samples distinguish successful complete data, legitimate empty results, degraded stale data and failure. Check fallback HTTP/envelope/shape/completeness before changing cache or list. Preserve last-good content and visible retry. This can ship before the larger exit implementation because it removes an existing client-continuity hazard.

**Owner / action:** frontend PR/merge (Pages release); no writer redeploy, n8n edit or flag flip. **Clients during work:** before release current behavior; after release failed reads retain previously verified content with a visible retry or show a truthful loading failure if no valid data exists. Existing approvals/comments use the same writer. This improves failure handling but cannot promise fresh content during a backend outage.

**Pre/post tests:** actual `_sxrFetchPosts` behavior with every T3 case, including genuinely empty TEST data and stale-cache preservation; T1 before merge in isolated harness and after deployed bytes are verified. Calendar v2 regression fixtures must continue rejecting its unusable fallback. **Completion:** no failure->empty-success transition, exact release Pages proof, client persistence smoke and W01/W02/T8 active. **Rollback:** use the reviewed, exact-release `_sxrFetchPosts` inverse and paired forward/recovery/forward rehearsal, retaining owned work, request IDs, field debt and save/cache compatibility. Captured old HTML is forensic pre-state, not an approved whole-document rollback; a defect in retained compatibility needs a scoped forward repair. No data rollback or writer/auth change. **Abort:** changed client write route/auth, vanishing cached content, false-empty or broken retry. This closes one exit subgate, not Decision A.

### G2 — replace provider prerequisites with native authority and catalogs

**Change / order:** provision native client/team/project/batch mappings and complete labels, members/eligibility, parent identity and required metadata. Change intake, append, component-fill, labels and assignee paths to validate those authoritative native records; remove provider reads before native writes, including absent/failed-policy defaults. Preserve public intake, Submit root work and existing replay receipts. Sub-issues must be created only by the Content Calendar's approved path; do not reopen SyncLinear create or casually remove functioning Submit.

**Owner / action:** backend/data PRs, additive migration, exact manual `production-write` deployment plus reviewed dependencies. Also build the server-only, designated-TEST native epoch that transactionally suppresses both normal and parity provider enqueues; removing provider reads alone does not satisfy a zero-intent canary. Use the existing [four-function capture/deploy lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml) only with its required owner capture and exact manifest; do not redeploy extra functions gratuitously. Any other function follows its documented manifest lane.

**Clients during work:** native catalogs/backend capability are staged and compared; existing readers/open writers remain in service. Do not activate caller changes until G3's durable ledger/materialization contract is installed and passing. G2 proves staged capability; G3 activates the combined compatible release. Do not switch a caller before its server capability is deployed/read back.

**Pre/post tests:** T2/T3 and the T5 subset for these staged paths on both teams, label paging, missing member mapping, non-null assign and null unassign, append replay, disabled/inactive client and public/staff intake. Verify native identifiers and counts on second-context reads. The full application T5 matrix is G7, after remaining readers/adapters exist. **Completion:** staged denied-provider requests create/edit exactly once with no provider read prerequisite or TEST provider enqueue; serving source and installed SQL match reviewed release; caller activation remains held for G3. **Rollback:** additive tables retained; route back to captured compatible server/browser while Linear still available, reconcile newly accepted native actions; no schema drop. **Abort:** any loss of client functionality, provider validation still needed, implicit SyncLinear sub-issue, duplicate or unmapped accepted work.

### G3 — make accepted actions and materialization durable

**Owner's feedback/history requirement, September 5:** conserve unsubmitted text separately from accepted changes. First repair the reproduced Calendar, Samples and Kasper failed-save/reopen/newer-typing losses with exact client/principal/card/component/action ownership and explicit receipt-matched retry; do not duplicate the existing Samples owned-work queue. Then install the reviewed private six-owner journal, so accepting an insert/update/delete and recording its before/after state are one database transaction. Capture failure rejects the change, which is why recoverable drafts must precede installation. Clients retain their text and receive an actionable save error when a save is refused; a lost response leaves acceptance UNKNOWN, so preserve the original action/request ID and reconcile its receipt before retry. Clients must not see a success followed by lost work.

The journal covers Calendar cards, Samples reviews, native batches/deliverables, canonical comments and Workload plans. It is a restore/audit record, not another writer or a promise of authenticated human attribution from anonymous claims. Preserve earlier source history separately: installation cannot reconstruct overwritten past states. Target at least 30 days of recoverable history; 90 days is the proposed operational window, with no pruning until the chosen retention and independent restore are proven. Rolling retention is not satisfied on installation day. Never substitute this journal for the request receipts, outboxes, materializer or provider forensic export. Its inverse disables only capture triggers, retains history and explicitly records the resulting gap.

**Owner clarification, September 5: broad recoverability is the goal.** The six-owner journal is the first coverage boundary, not a claim that the whole platform is protected. Maintain an explicit action-to-owner coverage ledger for creation, status, assignee, due date, text, feedback/replies/edits/resolves/reopens/deletes, archive, workload and card links. Include automated/imported changes as well as human changes. An unsupported owner or action must be marked uncovered with its recovery owner; do not infer completeness from the number of tables or tests. The owner has launched an independent Claude coverage/restore review of #1299; use its evidence to close gaps rather than start a competing history implementation.

Recovery has four distinct parts: preserve unsent drafts; record committed before/after states and trustworthy actor/time/source evidence; retain separately protected database, schema/configuration and required file bytes; and rehearse retrieval/restoration without overwriting newer valid work or replaying external side effects. A stored media URL is not a backup of the media. Failed or uncertain attempts need their own operation receipts and must not be shown as committed actions. An anonymous claimed name is not verified identity. Keep operational secrets outside both the public repository and ordinary action history.

Before Decision A, prove coverage and recovery for the complete card/feedback lifecycle and every asset or configuration dependency needed to run without Linear. Broader noncritical platform activity can extend the same ledger in a subsequent stage, with an explicit gap register; it must not silently become an unbounded prerequisite for the exit. The proposed 90-day detailed-history window exceeds the owner's 30-day minimum, but archive duration, independent storage, achievable recovery point and recovery time still need measured volume/cost and actual restore evidence before retention or recovery guarantees are made. No deletion/pruning is activated by this plan.

**Change / order:** move recovery ownership from browser-local jobs to a server ledger. Persist intent, idempotency, native result and card materialization states; reconcile native-to-card and card-to-native completeness. Separate unsubmitted draft/client suggestions from accepted production work. Replace bounded silent job deletion with durable unresolved/error/retry ownership. Preserve comment lifecycle versions/provenance and mirrored receipts as separate facts. Activate the G2 native catalog/caller capability only with this tested compatible contract.

**Owner / action:** additive transactional/RPC and worker changes, frontend receipt handling; owner-only n8n edits only if a named existing path is part of the reviewed release. **Clients during work:** a save acknowledgement means their action is committed durably; asynchronous projection must show honest saved/pending state and survive reload. Clients never need staff login or a new link. Existing card-backed Calendar comments remain visible while canonical projections catch up.

**Pre/post tests:** T1/T2/T4 under response loss, repeated save, storage deletion, actor replacement and two simultaneous sessions; prove one native result per request and eventual correct card. **Completion:** every accepted action matches exactly one committed result, durable pending action or explicitly reported conflict; no unaccounted loss, no silent discard, no duplicate source/native thread. **Rollback:** retain ledger and later accepted events; restore compatible reader/worker and replay only receipt-absent intents. **Abort:** acceptance without durable state, ambiguous duplicates, misattribution, disappearing edits/tweaks or a rollback that loses post-snapshot writes.

### G4 — reconcile working content, comments and client-visible history/assets

**Dedicated feedback experience:** the exact existing SyncLinear component detail should expose a clearly named Feedback & tweaks space with its canonical comments and authorized, precisely mapped Calendar/Samples feedback. Never join by matching text or names, resurrect hidden/deleted source aliases, suppress a source message using a stale canonical revision, or present an incomplete reader as an empty complete thread. The first reader keeps source-only entries read-only and their actions in the existing owning surface. It creates no sub-issues, competing discussion database or write-auth requirement. Before shipping, exercise edits/resolves/reopens/deletes, same-ID aliases, stale and failed refreshes, role/client/component switches, keyboard, mobile and dark/light rendering. Roll back the browser/reader projection while retaining the original source records and comments; any wrong-audience exposure, missing actionable feedback or unexplained interaction regression stops this step.

**Change / order:** classify every active card component, native deliverable, provider-only issue, true draft/suggestion, terminal/archived item and orphan. Repair linkage through reviewed private manifests/CAS; do not treat matching titles as identity. Import required comments with reply ancestry, edits/tombstones/resolved state/audience, and preserve card-reader projections. Rescue every asset needed by active and offered historical client views into independently accessible storage before provider denial. Expand archive discovery beyond the currently empty asset-ref table.

**Owner / action:** data owner reviews private source/destination/count/hash/rollback manifests; explicitly approved migrations/imports/repairs execute through their guarded tools. Never replay completed import IDs: server completion-ledger/CAS must reject consumed IDs before first mutation. A new run requires a fresh owner-approved ID, immutable source checkpoint, exact dry run, expiry and tested inverse. [Comment import lane](https://github.com/sidney-afk/client-analytics/actions/workflows/f42-card-comment-import.yml) is a scoped tool, not a complete archive. **Clients during work:** old content stays readable until a complete audience-correct replacement has been verified; copies are staged, then readers switch atomically. Partial imports never replace a full prior thread/list. No double comments or wrong-audience exposure.

**Pre/post tests:** T1/T4 and the relevant T5 reader/asset subset on linked/unlinked, both components, provider-only, edited/resolved/deleted/replied threads and historical media; private full-population reconciliation with failure-on-partial paging. **Completion:** zero unresolved actionable omissions; genuine empty/history cases proven from authority; required files pass byte hash, decode and anonymous client rendering with Linear denied. **Rollback:** revert reader pointer to preserved source while provider access exists; reverse only manifest-owned repairs with fresh CAS, otherwise reconcile rather than overwrite. After G9 use independently stored source only. **Abort:** missing source rows/assets, audience mismatch, incomplete pages, unresolved identity or a repair touching unrelated data.

### G5 — finish staff readers, handoffs and every creation/import route

**Change / order:** make native Workload the real default membership reader, including force-refresh, weights, due dates, tweaks and all supported teams/statuses. Preserve internal plan dates too: migrate `workload_plan.issue_id` and `workload-plan.requireWritableIssue` away from `workload_issues` validation with a reversible old-to-native identity map. Resolve the 13 measured visibility exclusions or document each legitimate exclusion with owner evidence. Complete Kasper/editor panels, Submit project/plan options, onboarding production setup, Calendar import/status reconciliation and archive/activity readers. Filming Plans' native core needs regression proof, not an invented Linear migration. Keep unrelated products out of scope unless an actual call chain is found.

**Owner / action:** frontend/backend releases plus named scheduled-job replacements; explicit owner n8n changes for the inventoried consumers. **Clients during work:** their reader/writer stays available; new staff work continues materializing through G3. Newly native staff decisions reach the same client card and history without waiting for Linear reflection.

**Pre/post tests:** T2/T3 and the relevant T5 staff-reader subset, normal/forced Workload refresh, parked/inactive/removed/absent mirror categories, editor and urgent-message flows, create/import then review on T1. Include a native-only deliverable without Linear UUID, plan-day drag/save/reload from a second device and preservation/CAS restore of historical saved plan dates. Cover extra non-video/graphics teams found in Workload instead of silently dropping them. **Completion:** real entry handlers use native readers under healthy and failed flags; no staff remedy depends on opening Linear; every offered creation path reaches durable work or clearly marked draft/suggestion. **Rollback:** prior compatible staff reader and plan-key map with preserved native data while provider retained; no reopening SyncLinear sub-issue create. **Abort:** hidden actionable work, lost plan dates, dead staff control, failed client handoff or any migration based only on a diagnostic reader's existence.

### G6 — make old browsers and endpoints compatible with native operation

**Change / order:** keep client-facing legacy payloads/aliases working through server-side native adapters. Remove legacy-provider failure fallbacks from current callers only after adapters serve existing old callers. Fence or retire the obsolete staff `workload-linear` provider writer at its serving gateway. Inventory and settle browser queues and retained create replays. Browser update prompts supplement compatibility; they do not replace it.

**Owner / action:** frontend release, scoped server deployments, owner-only n8n adapter edits where required. Frozen writers retain their captured tokenless contract. **Clients during work:** valid old links/tabs continue saving via compatible native contracts; client routes do not show an upgrade-required refusal in place of approvals/comments. Staff-only retired tooling may show a coordinated refresh/unsupported operation message before mutation.

**Pre/post tests:** T1/T3/T4/T6 with actual old bundles/legacy payloads, network/read failures, kill switches and delayed queued attempts; directly test eligible staff obsolete endpoint after the new fence. **Completion:** no old or new client path requires Linear and no fallback substitutes fake empty success. Complete external inventory required here. **Rollback:** restore previous native-compatible adapter and exact frozen serving source; never revive provider defaults after G9. **Abort:** any newly refused offered client action, old-bundle bypass of provider cutoff, lost local intent or reliance on cache expiration as the only defense.

### G7 — prove a native-only canary and the full alert chain

**Change / order:** run the approved TEST-only isolation described by T5 against the final native candidate. Assemble a release-bound evidence packet with both-team role/action matrix, client routes, native receipts, source closures, database definitions, provider denial and watcher delivery.

**Owner / action:** release/QA and operations owner authorize TEST drills; no global authority flip. **Clients during work:** real client data/routing and provider availability are unaffected because the canary is server-scoped to the designated test population. That scoping must itself be tested; otherwise do not run it.

**Pre/post tests:** all T1–T8, including label/assignee flags unavailable, lost commit response and worker held across a simulated cutoff. **Completion:** zero provider HTTP requests, zero new provider intents in both lanes, every accepted native action/readback accounted for, delivered and acknowledged alerts. **Rollback:** stop TEST fixture/drill, preserve evidence and clean only receipt-owned test changes through reviewed inverse. **Abort:** any real-client write/flag change, provider call, duplicate/lost action, untested stale route, undelivered alert or materially different test-vs-real path.

### G8 — enforce provider cutoff while client writes continue

**Change / order:** implement/rehearse a server-enforced provider generation/cutoff contract before using it. Freeze provider-dependent staff/external creation and mirror emission; **do not freeze clients' native approval/comment/note writers**. Keep accepting their actions into the native durable ledger while an atomic cutoff/high-water prevents new provider intent. Stop inbound effects too: current detect-only inbound can still import comments and change attribution. Disable parity F4, account its debt, then retire normal outbound F2 with its high-water accounting; stop drainer/reconciler/pager dispatch roots and provider webhooks according to the inventoried graph. A running old worker must fail the generation check before egress/commit. If a proposed implementation cannot supply this client-safe cutoff, this gate is blocked.

**Owner / action:** backend release/migration owner establishes atomic contract; operations owner applies exact-CAS reviewed flag changes and scheduler controls; n8n edits and provider webhook actions are owner-only. Existing [outbound workflow](https://github.com/sidney-afk/client-analytics/actions/workflows/linear-outbound-drain.yml), [Calendar reconcile](https://github.com/sidney-afk/client-analytics/actions/workflows/linear-sync-reconcile.yml), [Samples reconcile](https://github.com/sidney-afk/client-analytics/actions/workflows/sample-linear-reconcile.yml) and [deliverables reconcile](https://github.com/sidney-afk/client-analytics/actions/workflows/linear-deliverables-reconcile.yml) require individual disposition, including their independent n8n dispatchers. Never disable a shared pager blindly if it still carries unrelated alerts.

**Clients during work:** view/save/approve/request-change remain available on the same links. Their actions commit natively; only the external mirror is stopped. Continuous T1 proves both sides of the cutoff, and high-water reconciliation includes concurrent accepted client actions.

**Pre/post tests:** T1/T4/T6/T8 across a scratch cutoff first, then approved TEST concurrent traffic during the real window; stale worker after-cutoff attempts; exhaustive dual-outbox/generation/receipt readback. After external/human provider writes are frozen, record a final provider high-water and catch up/classify all previously accepted inbound comments/hierarchy events before disabling their effects. After debt disposition and outbound-off, run a final strictly read-only/detect-only semantic reconciliation. Any difference or would-enqueue result aborts completion: classify, repair under the reviewed cutoff contract and repeat. Read back the retired epoch only after reconciliation is zero, then prove native TEST actions produce zero new intents. **Completion:** every pre-cutoff intent has an evidenced terminal disposition, no unclassified stale/test/parity/dependency debt, no post-cutoff provider intent, no provider egress, native actions conserved. **Rollback:** before revocation, a separately authorized recovery may restore exact generation-compatible provider mirroring after classified replay. After revocation, recover natively. Flag reversal alone is never action rollback. **Abort:** new provider request/intent, reconciliation diff/would-enqueue, mismatched count or generation, missing client receipt, alert silence, concurrent unowned deploy or reliance on blanket client-write rejection.

### G9 — revoke product access and prove Decision A

**Change / order:** after G8, owner removes/disables every product-access Linear credential/integration/webhook from the inventory. Export-only access remains in a separate controlled environment, never in product runtimes. Retire product asset links to independently stored bytes. Observe 72 continuous hours including working staff/client usage and all daily/6-hour/short-cadence jobs; longer/manual/dormant roots require explicit configuration and denied-provider drills rather than waiting for a monthly trigger.

**Owner / action:** external-provider/credential owner; no billing or deletion action bundled. **Clients during work:** every offered feature operates through already-proven native paths; historical assets load from independent storage. A failed T1 is an incident and stops the readiness clock immediately.

**Pre/post tests:** T1/T2/T6/T8 immediately before and after access removal; verify all actual serving runtimes have no usable product credential, credential canaries cannot reach provider through allowed routes, and W07 measures attempted as well as successful egress. **Completion:**72 h zero product egress/new provider intent; complete native receipts; no client regression; all watchers fresh and acknowledged. Owner then records Decision A against the evidence packet. **Rollback:** restore captured provider-free stable release and replay native receipts. Revoked credentials themselves cannot be restored byte-for-byte; any newly issued provider access is a separate owner incident decision. **Abort:** any dependency failure, unexpected provider attempt, client false-empty, unexplained debt or unobserved runtime. Resolve and restart 72 h after the last material fix.

### G10 — Decision B observation, complete forensic preservation, then separate C decisions

**Change / order:** retain the isolated Linear workspace for at least 14 consecutive days after Decision A and through two full 7-day cache intervals plus real staff/client cycles. This is a proposed minimum, not a proven provider retention guarantee. Extend for any incident, missing population or longer critical cycle. Finish comprehensive forensic exports and two successful scratch restore passes; verify native history and assets with product credentials absent. Test the actual read-only control: retiring a team is not the same as locking shared projects or disabling all integrations, and Free makes Members Admins. Resolve the already scheduled September 15 transition before relying on this period.

**Owner / action:** operations/data owner for private export and scratch restore; account owner for verified permissions/retirement and later billing; workspace deletion requires a distinct explicit owner decision. **Clients during work:** continue using the independently proven native system; export credentials/history access are outside their request paths.

**Pre/post tests:** daily T1 read/history samples plus scheduled approved TEST persistence checks; T7 restored native/store/archive browsing, no provider egress, count/hash/audience parity, duplicate replay refusal; T8 liveness/delivery. **Completion:** continuous 14-day green period, complete manifests and checked restore; owner acknowledges account-specific consequences. No automatic cancellation/deletion at timer expiry. **Rollback:** retirement/permissions per verified provider inverse while still available; billing per account terms; permanent workspace deletion has no post-deadline inverse. **Abort:** missing files/comments/history, broken restore, unresolved ownership, unverified paid/free behavior or a retention deadline arriving before proof.

## Gate ledger / release record

All release gates below are **OPEN**; this audit supplies diagnosis and some baseline proof, not completed implementation. Record owner, exact release, source/DB hashes, test result URLs, private evidence digest, client-visible observations and inverse rehearsal at each row. A box can close only when its observable gate above passes; no tool exit code or elapsed time replaces that evidence.

| Gate | Current evidence / next clearing proof | Owner | Client behavior required | Restore point |
|---|---|---|---|---|
| G0 | Baseline captured; external census/retention/alert drill incomplete | Owner+operations | Same deployed readers/writers | Private source/config/DB bundle |
| G1 | Reviewed current-main draft and compatible inverse; fix not shipped | Frontend | Truthful failure, retained content, saving unchanged | Exact paired reader inverse preserving owned work and save/cache compatibility |
| G2 | Serving provider prerequisites confirmed | Backend+data | Continuous writes and staged native catalog | Exact compatible EF/DB additive baseline |
| G3 | Browser recovery and receipt completeness unproved | Backend | Durable save and visible pending/error | Native journal and compatible worker |
| G4 | 31 actionable classifier slots; asset inventory 0 | Data+media | Never less visible content/thread/history | Private source/CAS manifest+independent assets |
| G5 | 13 Workload visibility exclusions; provider refresh/tweak paths | Frontend+operations | Staff handoff still reaches client card | Native-compatible staff reader |
| G6 | Flag failures/old bundles/stale live Workload writer remain | Frontend+backend | Old valid client links save natively | Captured native adapters/open writers |
| G7 | End-to-end deny-provider/alert drills not run | QA+operations | Real clients outside canary | TEST-owned inverse only |
| G8 | Current mirroring/inbound/parity still on | Operations+backend | Native saves continue through cutoff | Generation-bound ledger and prior native release |
| G9 / A | Product access still active; no zero-egress period | Owner+operations | All functions work without provider | Provider-free stable release |
| G10 / B / C | Cancellation scheduled; export/restore/retention unproved | Owner+data | Native history/assets stay available | Verified archive; provider-specific inverse only |

## Watchers and alert delivery

These are **release requirements**, not active product watchers. Some runner/observer/drill code is now implemented and locally tested; use the dated checkpoint above for its exact limits. The owner selected a private Slack DM through the existing SyncViewbot. The two specifically approved primary DRILL messages were delivered and independently read back; human acknowledgment is pending. No other recipient or recurring message is authorized by that drill. Resolve a separate backup recipient before activation. Independent observation and fallback must operate outside both GitHub Actions and n8n so failure of either cannot suppress its own missing-run alarm; GitHub failed-run email alone cannot close that combined requirement. A hosted missed-ping option is prepared, not provisioned. No product watcher is counted active from code, configuration, a coordinator heartbeat or one delivered alarm alone. Public logs contain only gate, function/lane, anonymized run ID, count, age, status, source hash and incident code.

An initial Samples card-list watcher must have a distinct result contract and a complete safety ledger through browser teardown. A known excluded read subscription must not hide a later authorization, scope, browser, transport or cleanup failure. It needs a positively eligible designated TEST card visible in the actual primary-reader census and DOM, plus unchanged before/after scope digests. Empty TEST data is valid data but cannot pass that positive rendering gate. Unknown transport remains red. This bounded read proof cannot satisfy W01's approval/comment/tweak persistence journeys or Decision A.

| Watcher | Cadence / alarm | What it proves | Blind spots | Recipient / infrastructure |
|---|---|---|---|---|
| W01 Anonymous client journeys | Every 5 min view/render; approved synthetic TEST save/approve/comment/tweak cycle every 15 min and immediately after releases. Immediate page on valid-link 401, accepted-but-unpersisted action or invariant failure; retry once for transient read then page by 5 min | Actual offered client controls/readback on both surfaces, including old-bundle canary | One TEST client does not prove entire roster/audience; synthetic writes require scoped authorization/cleanup | Owner+Kasper; existing browser/Actions harness needs new journey/scheduling and budget guard; independent scheduler required for reliable 5 min SLA |
| W02 Read truth/empty state | Browser and server events per load; page immediately on failed-response->empty-success, count drop unsupported by authoritative snapshot, or stale display without warning; warn stale>5 min after active retry | Reader completeness/visible state, not just HTTP200 | Offline browsers, blocked telemetry, partial client population | Owner+Kasper; new privacy-safe outcome metrics/correlation; existing UI harness expanded |
| W03 Serving source/errors | Hash/JWT/build readback after each deploy; scheduled drift check hourly; error-rate windows 5 min, page any new client auth refusal | Running source and error trend across every function | Runtime external dependencies/SQL semantics need separate hashes; aggregate rates miss quiet single-client failures | Owner; existing ef-fingerprint+Management reads, new expected-release register/alert integration |
| W04 Runtime flags | Outcome event on every flag read; compare cohorts/authority every 5 min; page routing fallback or unauthorized state/roster drift immediately | Healthy/failure routing agreement and all active cohort membership | Browser cache/offline paths require T6; repeated snapshots cannot prove every request | Owner; add read-failure telemetry and independent flag monitor; never log member values |
| W05 Accepted action/materialization | Every minute aggregate committed/pending/complete/conflict/dedup, oldest pending; page missing receipt immediately, stuck projection>5 min | Native action conservation and card completion across actor/device/browser loss | Missing journal ingress can hide actions; must join UI ack/request receipt and independent rows | Owner+Kasper; **new durable ledger and reconciler required**; do not claim existing public_intake_log alone is sufficient |
| W06 Both outboxes/reconciliation | Every 5 min plus cutoff boundaries; page any unclassified debt, failed terminal run, stale lock/dependency or post-cutoff intent; require fresh correlated terminal receipts | Exact native/mirror distinction, generation and queue accounting including TEST/parity/stale/exhausted retries | Zero queue is not zero egress; readViewer can call provider without work. Sequential reads are not atomic cutoff proof | Owner; existing queues/Actions/summary events, new conservation/cutoff instrumentation |
| W07 Provider egress/external roots | Observe every server/n8n/browser attempted provider call; aggregate every minute; after cutoff any attempt pages immediately. Reconcile credentials/webhooks/active versions daily | Zero attempted and successful egress across enumerated roots, including assets/OAuth/redirects | Linear-side absence/logs are not exhaustive; uninstrumented roots and export access must be separately inventoried | Owner; **new central denial/audit boundary and browser telemetry required**; provider-only logs insufficient |
| W08 History/assets/export | Daily source-discovery/manifest comparison; after exports verify every page/count/hash and rescued byte; page missing/expired/corrupt required asset immediately | Required historical content is independently retained and client-readable | Empty inventory can mean scanner never ran; sampled rendering does not prove all bytes or rights | Owner+data; expand archive scanner/private storage verification; current 0 ref rows are not proof |
| W09 Backups/restore | Existing 6 h backup, alarm missing authenticated good copy>7 h; scratch restore before A and twice before C; fresh end-to-end browse/hash evidence | Recoverable native+forensic snapshot and independently available storage | Current backup table set is not full comments/receipts/assets/browser-debt export; a successful upload is not restore | Owner email independent of n8n; [backup workflow](https://github.com/sidney-afk/client-analytics/actions/workflows/track-b-backup.yml) plus expanded manifest/isolated restore |
| W10 Monitor/alert liveness | Independent 5 min heartbeat observer; page missing two expected checks, absent terminal receipt, undelivered message or unacknowledged critical incident after 10 min | Watchers run and someone receives the alarm; monitors do not silently fail together | GitHub scheduling has no exact-time SLA; same-vendor outage still possible | Owner alternate email/channel+Kasper; existing watchdog/relay can be reused but reliable independent observer/configuration and delivery drills are required |
| W11 Billing/retention deadline | Owner verifies now; daily reminder/check from 5 days before scheduled transition until acknowledged disposition | Retention plan matches actual account deadline | Billing API enum/canceledAt does not prove invoice/refund or enterprise terms | Owner-only; proposed reminder through independently proven channel, not created by this audit |

For every watcher drill: inject a synthetic safe failure, retain a correlation ID, observe final transport delivery and human acknowledgement, then prove recovery. Relay HTTP200 is acceptance only. Trigger relay failure and n8n outage separately and prove independent fallback. No silence-based closure. During an incident keep client-native writers operating, pause only affected provider/staff paths, preserve receipts and restore the last proven native-compatible release. Do not auto-revert team authority or client auth.

## Cosmetic and dead-end sweep

| Audience | Required sweep and evidence |
|---|---|
| Client-visible | Calendar/Samples cards, historical assets, activity/comment threads, approve/change/note controls, recovery banners, errors, empty states, copied/shared links and help text. A Linear URL becomes a native route or an independently hosted asset with equivalent accessible content. Remove instructions to open/contact/use Linear only after the native remedy exists. T1/T3/T6 must verify both teams and every offered interaction, including old links. Preserve historical attribution text where useful; do not erase provenance merely because it contains the word Linear. |
| Staff-only | Submit project/plan picker, Workload forced refresh/tweak/deadline/error tooltips, editor panel, urgent Slack lookup, Production detail labels/assignees/import/archive/recovery controls, Kasper review/messages, onboarding setup instructions and all creation menus. Resolve native identity and permission before replacing deep links; keep valid work visible rather than guessing exclusions. SyncLinear stays the visible name while internal production route and Submit's legacy linear route continue to resolve. Test query/deep-link aliases and stored kill switches. |
| Dead code/config | Remove code below closed create only after committed-replay/browser debt is accounted for. Retire Linear credential/config defaults, API clients, n8n credentials/webhooks, scheduled/manual dispatch roots, rollback resurrectors and deployment secrets by the inventory—not a text-wide replacement. Keep immutable history/evidence and necessary legacy identifiers for migration/provenance. Prove zero live egress; a zero-word search is neither necessary nor sufficient. |

## Export, retention and reversibility

Official sources were checked during this audit; account-specific effects still require the actual Billing/contract authority. The workspace query proves cancellation scheduling and a lower bound of 251 accessible issues, not a complete 19,321-issue export; `createdIssueCount` is provider metadata, not a verified count of currently extant or successfully exported records.

| Action | Preservation / proof first | Inverse and limits | Current decision |
|---|---|---|---|
| Reversible browser/native adapter release | Serving source/config hashes; accepted-action journal; T7 | Source revert is reversible; accepted data and external effects need receipts/CAS/replay | Future approved G1–G6 only |
| Disable mirror/inbound/schedules | Full creator inventory, cutoff/generation, dual-queue classification, native continuity | Re-enable may replay stale work or change attribution; requires explicit classified recovery. No blind flip | G8 blocked |
| Revoke product credential | Proved zero native dependency/egress, isolated export credential, provider-free recovery | Revoked key cannot be restored; new credential requires owner provisioning and reauthorization | G9 blocked |
| Retire Linear teams / restrict access | Inventory all teams/shared projects/integrations and validate exports/client assets; handle active work | Retirement can be reversed; team/issues read-only does not freeze shared projects or guarantee indefinite retention. [Official teams documentation](https://linear.app/docs/teams#retire-a-team) | B is not yet enforced/proven |
| Downgrade/cancel billing | Confirm current schedule, over-limit behavior, permissions, retained access and media; prove retention/restore | Official docs say cancellation applies at period end, data is not deleted, issue creation is blocked above the Free limit, and Members become Admins. This is not a read-only archive guarantee or verified account invoice/refund advice. [Billing](https://linear.app/docs/billing-and-plans) | Already scheduled September 15; owner must verify/coordinate |
| CSV export | Full field/object coverage checklist, archives/private-team permissions, timestamps and stable IDs | CSV alone cannot reconstruct comments/history/attachments; attachment files excluded. [Exports](https://linear.app/docs/exporting-data) | Supplement only |
| Forensic API export | Fully paginate issues/projects/teams/users/states/labels, archived/deleted-accessible records, comments/replies/edits/tombstones/history/relations, documents/assets, native requests/receipts/events/outboxes/generations/config/crosswalks; private hashes/counts/provenance | API defaults hide archives, pages default 50 and HTTP200 may contain GraphQL errors. Reconcile missing/inaccessible objects explicitly; no completeness claim from first page. [GraphQL](https://linear.app/developers/graphql), [Pagination](https://linear.app/developers/pagination) | Complete export unproved |
| Rescue files | Enumerate asset references across active/archived issues, descriptions, comments and client surfaces; fetch bytes privately; content hash/size/MIME/decode, audience and independent render proof | Expiring signatures/stored URLs are not rescued bytes. [File storage authentication](https://linear.app/developers/file-storage-authentication) | Before A for client assets; full forensic set before C |
| Delete issue | Export issue/children/comments/history/assets and prove native replacement | Separate 30-day recovery window; not workspace policy. [Delete/archive](https://linear.app/docs/delete-archive-issues) | No deletion proposed now |
| Delete workspace | 14-day post-A retention complete, full forensic export, two scratch restores and explicit owner deletion decision | Cancellation window 48 h, then permanent deletion; no claimed provider recovery afterward. [Workspaces](https://linear.app/docs/workspaces#delete-workspace) | Separate later C decision; never automatic |

Scratch restore must run outside production, with production project references blocked, provider egress disabled and integrations unscheduled. Verify native work/card/comment/history browsing, attachment bytes, identity/audience preservation, count/hash parity, duplicate replay refusal and restore of accepted actions since the baseline. Existing 14-table native backup is useful but cannot alone prove all listed forensic domains.

---

## Historical checklist — preserved, nonoperative

The content below is retained from source `5765cfe80b7ca9844bab79a55fd75784bf9cb693` for audit and recovery provenance. Its dated live states, old authority/auth transitions, blanket write freezes and earlier B5 order **are not the current execution plan**. Use G0–G10 above. Old snippets must not be run merely because they remain in this appendix; a future incident must use its reviewed current, source-exact recovery procedure and preserve the frozen client contract.
# SyncView Go-Live Checklist — Linear → SyncView cutover

**Purpose.** The single canonical, owner-facing sequence for cutting production over from
Linear to SyncView. Rewritten 2026-07-13 after the full cutover audit
(`CUTOVER_AUDIT_2026-07-13.md`) — that register is the authority on WHY each gate exists.
Exact flag payloads and emergency procedures live in **`docs/ops/FLIP_RUNBOOK.md`** (owner-
executable, paste-able; no Codex required). If anything here disagrees with the live runtime
flags, trust the live flags and stop.

_This sequence supersedes all earlier flip orderings (audit F17). D-28's shadow-week soak is
satisfied by the staged parity enrollment below plus the nightly shadow audit — ratified by the
owner merging this file (see D-32)._

---

## Golden rules

1. **The owner holds every switch.** Nothing flips without a deliberate owner action.
2. **One team at a time.** Graphics (one person) first, then Video (D-28).
3. **F27 is installed; its final authority reversal is one guarded statement, not a blind flip.**
   The unsafe #894 design and the real 2026-08-01 failed attempt/Section 7
   recovery remain historical evidence. Attempt 2 on 2026-08-02 entered from that exact retained
   boundary, applied the migration exactly once, deployed/read back all four protected closures,
   returned `F27_DRILL_RUNNER_OK`, and returned `F27_FINAL_VERIFICATION_OK` with PASS across all 17
   enumerated assertions. The reserved drill proved the real finalizer's required authority-CAS
   refusal and changed no real outbox/fence/flag state; it was not a real-team reversal.
   Immediate containment remains stop that team's new
   mutations. F2 `off` stops normal outbound only; F4 `false` stops independent parity, so disable
   both for an unknown/mixed Linear-write incident (F58). Authority returns to Linear only after an immutable team
   snapshot, owner-audited classify/replay/quarantine/discard decisions, and a machine-read team
   zero. The default drainer and a global green summary do not prove this. Use FLIP_RUNBOOK §R2.
4. **Cosmetic vs. data (D-29).** Looks-wrong → fix in place, keep going. Wrong-data-written →
   contain that team immediately, then complete §R2's evidence-bearing recovery before any
   authority reversal or re-flip.
5. **Green before you move — with real eyes.** A quiet alarm channel only counts once the
   non-n8n inbound pager (F09) is live; until then, silence can mean "the alarms are dead".

## Current state (update when flags move)

| Flag | Value today | Meaning |
|---|---|---|
| `prod_authority` | `{video: linear, graphics: linear}` | Both teams still run on Linear |
| `linear_outbound_enabled` | `off` | No mirroring back to Linear |
| `linear_inbound_enabled` | `enabled` | Linear → SyncView copy (always on until B5) |
| `linear_legacy_parity_enabled` | `enabled` | Armed early by owner decision 2026-07-28 to restore the linked-card mark-done lane; do not silently disarm |
| `auth_enforcement` | `permissive` | Client-link verifier permits missing/invalid tokens; this is not a staff-write gate |
| `write_ui_reroute_clients` | last verified live TEST-only allowlist (`clients:[<TEST_CLIENT>]`) | Required D-32 boundary; #850 merged the reroute code carried from `e3aa028`. Read the value fresh before any action; this dated row authorizes no flag change or real enrollment. |

F27 was installed from exact release
`968a895108beb2a2c41e86bb8b788115e35b14a0` on 2026-08-02. At window close the
receipt read inbound v40, outbound v35, production v27, deliverable v26, and
batch v26 ACTIVE; parity was restored enabled and the reconciler was ACTIVE,
quiescent, and monitor-only with default `apply=false`. The successful attempt
required F4 false during its drill/finalization boundary, then the owner restored
the captured enabled value. Every future incident, recovery, or reinstall starts
by re-reading all flags and the complete F27 posture. Any future reinstall must
use an exact reviewed release that preserves the live `labels`, `description`,
and `attachment` outbox contract; the executed procedure and source-exact
defective-release recovery remain in `docs/ops/F27_INSTALL_RUNBOOK.md`.

Merged & live: #810 gateway (deployed), #811 guards + daily TEST drill + nightly shadow audit,
#812 mirror write-UI (locked for real teams), #850's dark Calendar/Samples/Submit reroutes,
62/62 client→project mappings, and Samples retirement + rename. The reroute cohort was last
verified TEST-only; no real-client enrollment is authorized by the merge or deployment.

> **IMMEDIATE PRIVACY CONTAINMENT — do not wait for Phase 0 (F64):** reviewed schema-only
> replacements pass the private count-only census but are deliberately excluded from this public
> candidate. GitHub expanded the historical row deletions even behind the attempted diff guard, so
> an ordinary scrub PR is unsafe. Use the owner-scheduled freeze and final-GO rewrite procedure in
> `docs/ops/GIT_HISTORY_PII_PURGE_2026-07-14.md`; restore the hash-matched clean files only inside
> the rewritten history. Public current files/history/PR refs/caches/forks/clones remain open.

---

## OWNER RE-SCOPE — 2026-07-28 (ratified in session; governs every box below)

The owner walked the four re-scope decisions prepared by `PHASE0_AUDIT_2026-07-28.md` and ratified:

1. **Security containment bucket (~18 items) → POST-FLIP workstream.** F64, F122, F118, F76, F77,
   F91, F106, F107, F115, F116, F123, F84, F85, F86, F87, F81, F48, F52, F129, F110, F111 are no
   longer flip gates. They remain open, real, and scheduled as a dated post-flip workstream —
   these exposures exist today with Linear as boss; the flip neither causes nor worsens them.
2. **QA-drill bucket (~55 items) → POST-FLIP, except the Graphics-specific subset.** Kept as flip
   gates: **F53** (graphics canonical media), **F12** (submit-graphics TEST drill),
   **F201/F202/F203** (graphics mutation surface), **F40** (per-team workload authority), plus
   everything in the audit's mechanical-minimum bucket (F50, F32, F36 residue, F07-at-flip).
   All other drills move to the post-flip list.
3. **Owner-question bucket (~15 items):** every shipped strictest default REMAINS in force
   operationally; the owner chose an **individual review sitting** rather than blanket
   ratification. That review is scheduled and explicitly does NOT block the flip — nothing ships
   looser until it happens.
4. **Parity lane armed EARLY, this week**, as a supervised owner window (FLIP_RUNBOOK §F4 forward
   block): Phase 1 step 3 pulled ahead of Phase 0.75 enforcement by explicit owner decision,
   because the same switch closes the mark-done regression's larger population across 24 clients.
   Rollback is the §F4 one-CAS kill. This deliberately precedes the F56/F63 preflight machinery;
   the deviation is recorded here rather than made silently.

Boxes covered by decisions 1–3 stay unchecked but are governed by this block. Nothing in this
block waives the mechanical-minimum path in `PHASE0_AUDIT_2026-07-28.md` §C.

## Phase 0 — Preconditions (ALL boxes before first real-client enrollment)

**Build/fix gates (Codex):**
- [ ] **One machine-generated current-state manifest is fresh** (F56/F59): fail unless it records
      the exact Pages/main commit, all runtime flag values and update times, all 24 Edge Function
      states/JWT settings/source-closure and server fingerprints, every load-bearing n8n active
      version/node hash/trigger/last-green execution, deployed migration/schema contract, and
      timestamped evidence handles. The owner flag action must consume the same unexpired preflight
      token; prose checkmarks cannot authorize a flip.
- [x] **Every paste-ready flag action is executable and single-purpose** (F63) — CLOSED 2026-07-30
      by owner-merged PR #993, which is what this box required ("keep this item open until the
      exact PR is green and owner-merged"). All **16** `FLIP_RUNBOOK.md` fences are proven on
      PostgreSQL 16: 1 read-only utility executed inside a read-only transaction with the store
      unchanged, and 15 mutations each proving success from every declared valid prior, loud
      refusal from a wrong value and from a missing row, exactly one affected row, exact
      flag/audit readback, and a byte-identical unrelated sentinel. Re-verified independently on
      2026-07-30 against current `main` after that day's runbook edits: `F63_FLIP_RUNBOOK_SQL_GATE_OK`,
      16/16.
      **The gate was also proven able to go red**, which is the only thing that makes a green
      meaningful: deleting the CAS from the F5 sign-in fence and separately deleting the
      affected-row assertion from the F4 parity fence each failed the gate loudly
      (`F4 forward parity arm: zero/multi-row match fails loudly`), and it returned to green when
      restored.
      Two runbook defects were found and fixed by this work rather than papered over: the F2
      forward-to-live action accepted **two** prior states, letting a single paste jump `off → live`
      and skip the shadow dry-run — now split into two strict fences with the skip made an explicit
      choice; and the R2 finalizer, which at that time required an uninstalled F27 function, was
      correctly reclassified as non-executable rather than mocked to make the gate pass. F27 was
      later installed on 2026-08-02. The finalizer remains a `text` placeholder template outside
      this disposable flag-only SQL gate and is executable only with a real R2 open rollback.
      The emergency F2 kill deliberately **keeps** its enumerated prior set: an emergency stop must
      never require diagnosing current state first.
      Original contract, unchanged: CI parses each SQL
      fence; every forward action CASes on one exact prior, while every kill/recovery action CASes
      on an explicit finite set of permitted priors. Every mutation passes an isolated TEST
      flag-store transaction, affected-row assertion, and readback. Never paste a multi-action
      sequence or an unconditional whole-row replacement.
      Candidate gate `test/f63-flip-runbook-sql-gate.js` is auto-discovered by `test/run-all.js`
      and classifies actions as: forward (one exact prior), kill/recovery (an explicit finite set of
      permitted priors), or read-only utility (zero mutation). In the always-on unit job,
      `F63_REQUIRE_POSTGRES=1` makes PostgreSQL 16 execution mandatory. Each mutation must prove
      success from every declared valid prior; loud refusal from a wrong value and a missing row;
      exactly one affected row; exact flag/audit readback; and byte-identical unrelated sentinel
      state. The fixture creates only the minimal runtime-flag/audit store, no F27 object, and has
      no live route. Keep this item open until the exact PR is green and owner-merged; local/source
      plausibility does not close it.
      **F27 evidence:** the #894 head/run/artifact formerly cited here remain
      historical and superseded. The corrective exact-head proof now has live
      attempt-2 receipts from release
      `968a895108beb2a2c41e86bb8b788115e35b14a0`: migration/self-probe PASS,
      Section 4 run `30763278795` success, reserved drill
      `F27_DRILL_RUNNER_OK` with the required real-finalizer authority-CAS
      refusal and permanent audit, and final production verifier
      `F27_FINAL_VERIFICATION_OK` with PASS across all 17 enumerated assertions.
      That production receipt does not turn the separate F63 disposable
      flag-store fixture into an F27 integration test.
- [ ] **The complete Production browser gate is green before merge/flip** (F105): do not accept the
      fast PR subset alone. Locked live-read/zero-mutation and fully intercepted writable states are
      explicit; interaction/behavior/pixel lanes are authority-aware; unsupported operations remain
      guarded; no suite sends a live mutation. Require aggregate `npm run test:prod-polish` plus the
      long lanes on the exact candidate commit and review any visual packet locally in an
      access-controlled workspace. Public review-packet/Argos artifacts are forbidden under F122.
- [ ] **Public-repo hygiene is enforced** (F64): no new client identity, slug, account address,
      secret, or private fixture enters a commit. Keep the three reviewed schema-only replacements
      private until the coordinated rewrite; do not expose their row deletions in an ordinary PR.
      Privately preserve evidence and complete the owner/GitHub exposure, cache/fork, token-link,
      Support, force-push, reclone/fork, and anonymous post-rewrite assessment.
      A private tracked-exposure inventory and owner disposition exist for the wider repository;
      CI rejects new exposures.
- [ ] **Public Actions publish aggregates only** (F122): stop B1 row-plan JSON, live Production
      screenshots/review/Argos bundles, and reconciler roster/identifier logs/job summaries. The two
      artifact producers are temporarily disabled and all 414 named bundles are deleted; keep them
      disabled until the aggregate-only/no-upload PR merges, then prove the first post-merge run and
      re-enable deliberately. Sanitize the still-open reconciler logs, audit historical Argos builds,
      and record privacy/legal disposition. Recursive exact-schema canaries inspect archives/stdout;
      private generators refuse tracked worktree output. Retention is after—not instead of—sanitization.
- [ ] **Every public onboarding-media asset has proved publication rights** (F118): privacy/legal
      records source, people/voice/brand releases, licence, intended audience, retention and deletion
      duty for every tracked file. Replace uncertain media with fictional/commissioned/licensed
      examples; coordinate removals with F64 history/cache/fork handling; CI rejects any unclassified
      asset. Owner explicitly answers which existing files may remain publicly hosted.
- [ ] **P0 weekly-report exposure is contained** (F76): unauthenticated report/roster reads and
      writes now deny `401`, both raw-table reads deny `401`, and the signed service roster caller
      reaches its authenticated branch. The staged Admin/SMM caller merged with #836 and was
      browser-walked 2026-07-15 (Admin/SMM allow, creative/client deny; staff screens restored).
      Individual SMM scope, access-log review, integrity reconciliation,
      per-human sessions and the owner incident disposition remain required.
- [ ] **P0 onboarding-reader exposure is contained** (F77): all three onboarding list EFs deny
      anonymous/wrong-key requests with `401`; the staged Admin caller merged with #836 and passed the full
      browser/standalone walk 2026-07-15. CORS is still unconstrained,
      background discovery still needs a minimal opaque projection, and logs/private links/
      credentials plus the owner/legal notification disposition remain open.
- [ ] **P0 public Linear mutation routes are contained** (F91): status/comment bridges require an
      active immutable principal; video/graphics intake requires staff auth or an owner-ratified,
      server-minted short-lived exact-client capability; target/client/team are resolved server-side;
      audit, request limits, idempotency, and deployed anonymous/expired/cross-client negative tests
      are green. Owner explicitly answers whether `?intake=1` remains shareable and under what
      mint/expiry/revocation contract.
- [ ] **P0 Sales Intake caller authorization is contained** (F106): the owner ratifies Kasper-only,
      Admin-only, or both; an individually revocable active-member session binds the server-derived
      actor/role before any ledger, agreement, email, or notification side effect; exact action/scope,
      bounds, immutable audit, idempotency, and deployed no-key/expired/wrong-role/replay denials pass.
      Deactivate and use the manual process if this cannot be proved before go-live.
- [ ] **Project Central cannot clear live state from an unverified/partial save** (F123): active
      role/scope auth and audit protect load/save; source failures are explicit; complete input and
      relationships/counts/hashes validate before mutation; staged copy-on-write + revision/CAS +
      idempotency atomically promotes one version with an immutable backup/restore receipt. TEST
      empty/malformed/partial/stale/concurrent/lost-response and every clear/append failure.
- [ ] **Sales Intake completion and replay are truthful** (F107): one server-minted receipt owns the
      preview and request state; the server reads/CASes that state rather than trusting returned row,
      contract, or link values; duplicate/lost-response retries resume instead of recreating work;
      and the UI shows accepted/processing until required email/audit completion is durable. TEST
      provider failure, email failure, stale/wrong preview, partial commit, duplicate click, and retry.
- [ ] **Contract/payment callbacks verify native provider events** (F115): both routes validate the
      provider-native signature over the raw body, bounded timestamp, unique event ID, exact type/
      status/mode/account, and a server-owned agreement/payment correlation; persist the unique
      inbox event before 2xx. Prove stale/replay/wrong-account/wrong-sale/downstream-failure retries.
- [ ] **The two-of-two sales gate is atomic and exactly-once** (F116): one unique durable job owns
      “both verified gates → onboarding email,” with pending/sent/failed step receipts and a
      reconciler. A synchronized two-callback race, duplicates, lost response, child/email/HubSpot/
      stage failures and retries cannot lose or duplicate the communication.
- [ ] **Approved YouTube title text remains the text actually approved** (F109): owner ratifies
      material-edit semantics; an SMM or Collaborative client edit atomically invalidates/re-enters
      review and/or records an immutable server-generated old/new event tied to actor and row
      revision, with approval age visible. Test no-op/whitespace edits, both roles, concurrency,
      offline retry, undo, timestamp behavior, and second device.
- [ ] **Every media/caption approval is bound to the exact reviewed revision** (F113): Calendar and
      Samples record a server-owned per-component revision/hash at approval. Any material URL/text
      edit or same-link provider revision atomically invalidates/reopens review (or visibly ages the
      sign-off under an owner-ratified policy), emits an immutable actor/revision event, and returns
      the component to the right queue. Pass both surfaces, all reviewed components, exact role
      permissions, no-op normalization, concurrent approval/edit, offline retry/undo, refresh, and
      second-device tests before treating a green approval as release evidence.
- [ ] **Unknown client links fail closed before loading data** (F102): `?c=` alone grants no bypass;
      an allowed client and current token are resolved before data/cache/route entry. Unknown,
      malformed, unsupported-view, invalid-token, and every `c`+hash/`prod` combination show only
      the invalid-link surface and purge client/staff state. Production/staff routes require an
      individually verified staff session. Owner records the exact supported client-view allowlist,
      and fictional desktop/mobile/second-device/cache/history tests prove no staff fallthrough.
- [ ] **Legacy Samples client links preserve exact-client scope or fail closed** (F117): a verified
      `v=samples` client/token never enters generic SXR pins/preferences or Add-client switching.
      Bind the server capability to the dedicated client mount and every read/write, or show an
      explicit retired-link state. Pass old-data parity, cross-client denial, fresh/residual cache,
      invalid/rotated token, deep-link, refresh/back, mobile and second-device tests.
- [ ] **Samples Old read fallback is not used as writable recovery** (F57): `?sv2=0` and automatic
      REST→Sheet fallback belong to the dormant renderer. Its legacy writers may return success
      after Supabase updates while the Sheet branch failed. Any temporary old-code restoration is
      read-only or has one atomic read/write authority; prove stale-build/direct-caller zero and
      both-store parity before Phase 2 deletion.
- [x] **Thumbnail revision scanner is fail-closed and bounded** (F78): a mandatory dedicated
      scheduler signature is deployed; absent server credential returns `503`, wrong caller
      credential returns `401`, and successful calls expose aggregate counts only. TEST-only
      same-link/no-write/change proof passed, the initial all-active scan checked 239 with 0 failed,
      and [the first scheduled run](https://github.com/sidney-afk/client-analytics/actions/runs/29370658087)
      completed green with all 239 unchanged.
- [ ] **Thumbnail folder resolver enforces originating scope** (F79): require an authenticated
      principal or signed internal job bound to the exact client/row, bounded and audited Drive work,
      least-field responses, and deployed missing/malformed/cross-client/correct-scope proof.
- [ ] **Thumbnail folder resolver writes use atomic CAS** (F80): the final write must compare exact
      normalized thumbnail URL plus row version/timestamp, treat zero affected rows as stale, and
      pass reversed-completion, retry, clear/archive, and Calendar/Samples concurrency tests.
- [ ] **Public onboarding capture is abuse-bounded** (F81): server-minted short-lived submission
      ownership, rate/CAPTCHA, strict byte/schema/kind limits, conditional/versioned updates,
      immutable creation time, sanitized final-only alerts, and spam/replay/oversize/foreign-ID/
      beacon-race/alert-failure TEST cases are green.
- [ ] **Filming-plan roster/document links are private** (F82): unauthenticated EF GET now denies
      `401`. Merge the protected Pages caller before revoking anon table SELECT; then prove both
      paths are closed together. The public row-bearing seed remains F64 rewrite work. Least-field,
      principal/client/role-scoped SMM/Kasper/Admin reads pass anonymous/cross-client/mobile/
      second-device tests; Google-document sharing and access logs are privately reviewed.
- [x] **Thumbnail revision metadata is private** (F83): raw browser table access returns `401` and
      unsigned private-object access returns `400`; the least-field exact role/card projection
      succeeds while cross-client scope returns `403`; only short-lived signed image URLs leave the
      backend. Desktop/mobile Previous/Current comparison passed on an owner-selected real card.
- [ ] **Credential vault uses least-secret, auditable delivery** (F84): list is metadata-only;
      individually revocable active-member sessions bind immutable actors; one-secret reveal audits
      synchronously/fail-closed; old plaintext passwords never enter history; shared/legacy keys are
      retired; direct API/DevTools/copy/offboard/cross-client/first-edit tests pass.
- [ ] **Full onboarding reads bind an active admin** (F85): shared/legacy secret possession alone
      cannot read the corpus; every minimized/paginated access has immutable member attribution and
      a durable synchronous audit; holder inventory, key/session rotation, and credential-array
      retention disposition are complete. The owner answers the two F85 questions explicitly.
- [ ] **TikTok Pilot is compliant and eligible before review/posting** (F119): keep it disabled until
      privacy has no default and requires an explicit provider-returned choice, the exact music-use
      acknowledgement/commercial controls are present, source and sandbox tests agree, and product/
      legal records provider-backed eligibility for agency staff posting to client accounts.
- [ ] **Client analytics distinguish empty from failure** (F124): CLIENTS METRICS implementation is
      live-proved at version `b92fb693-1dd4-4ce2-a60e-98a1701c369d`; scheduled execution `287059`
      emitted 29/29 unique typed terminal receipts, completed 29 writes with zero write failures,
      preserved last-good on provider failure, and kept legitimate numeric zeros fresh. For each new
      client, require inclusion in that terminal receipt and retain roster/quota monitoring. The
      remaining blocker is TOP VIDEOS: publish per-client/platform
      expected/attempted/succeeded/count/freshness/error receipts, distinguish valid empty from
      provider failure, preserve visible last-good staleness, and alert on partial coverage. Its
      seven-day browser cache must show source age/degradation and cannot replace last-good from a
      bad HTTP response. Test every provider/state/partial/retry/cache-recovery case.
- [ ] **Raw staff/client directories are minimized** (F86): anonymous raw-table reads are revoked;
      purpose-specific active projections expose only fields each surface needs; inactive rows and
      email/Slack/Linear/project mappings are protected; direct omitted-column tests deny.
- [ ] **Verification services are resilient** (F87): denials are uniform, request controls/alerts
      and bounded audit retention are deployed, verifier/audit outages fail closed, and TEST-only
      burst/quota/timeout/recovery exercises are green without real secrets.
- [ ] **Owner decides the operational read-confidentiality model** (F88): either legal/client review
      explicitly accepts every currently exposed field as public and tokens as UI/write-only, or raw
      anon policies are revoked behind principal/client/role-scoped projections and direct REST,
      cross-client, inactive, cache/stale-tab/mobile/second-device denial passes. Until then token
      enforcement is not a read-confidentiality gate. The thumbnail and two weekly-report tables now
      deny raw anon reads; filming_plans anon SELECT was revoked 2026-07-15 (post-#836); raw `clients` and the seven named direct-use tables
      remain intentionally unchanged until their minimum projections exist.
- [ ] **Token validation evidence cannot false-green** (F89): telemetry separates credential-valid
      from access-allowed, binds active client/current token revision, and a machine report requires
      a fresh exact valid event for every active client. The present seven-day window has zero valid
      events and is not go-live evidence.
- [x] **Fix-pack source landed via superseding PR #850 / `9968bd9`** (#813 closed unmerged;
      implementation commit `e3aa028`): per-client allowlist gate (F02/F23),
      Kasper linkage predicate (F04), protected-write 401 session invalidation/reverification with
      draft/action-intent preservation and retry only after fresh sign-in (F10),
      batch-picker team-filter + duplicate disambiguation (F19), +2d overdue bump ported per
      D-30 (F20), sync-drain lane for flipped teams (F07), oldest-pending-age pager (F16),
      monitors made flip-tolerant (F08).
- [x] **F21 startup popup removed by owner decision (2026-07-16):** stale pre-upgrade leftovers
      remain parked, silently and without auto-send; agents/ops can inspect the queue if ever needed,
      while scheduled reconcilers remain the Linear/SyncView drift-healing mechanism.
- [ ] **Production-write TEST contract resolved** (F06): owner/implementation chooses the
      service-only spec contract or a newly justified browser-safe alternative; SPA, gateway, and
      one cross-boundary test agree. F51's source-exact rollback standard requires captured provider
      source/entrypoint/JWT/release manifests and independent deployed-source/JWT hash readback after
      redeploy. Historical transitive graphs are unrecoverable and explicitly not part of that
      standard; prior version IDs are provenance, not activation handles. Separate fleet hardening
      still tracks pinned direct imports, CLI/config manifests, and deliberate dependency updates. The
      six onboarding-family floating imports require a later deliberate release and are not part of
      the scoped F27 toolkit pin.
- [x] **Authority vocabulary is singular** (F55) — CLOSED 2026-07-28, source **and** live. Every
      browser, EF, reconciler, n8n guard, flag writer, and runbook accepts exactly
      `linear|syncview`. The backend-only `supabase` alias was removed/migrated everywhere it was
      accepted (`production-write`, `linear-outbound`, `linear-inbound`, `_shared/b4-write.ts`,
      the reconcilers, the n8n guard, and both F27 SQL copies), missing/malformed/legacy values
      are now rejected consistently (including two silent-default-to-`linear` bugs found in the
      process), and `test/f55-authority-vocabulary-contract.js` is the all-consumer contract test.
      No `prod_authority` flag value changed; it read back `{video: linear, graphics: linear}`
      before and after.
      **The live half, which source alone could not close:** one consumer is a database function,
      not a file. `2026-07-28-f27-write-authorization-only.sql` had been applied to production on
      2026-07-28, so editing it in the repo did not change the database — the deployed
      `track_b_f27_write_authorization` kept accepting `supabase`. The owner re-pasted that
      file's `create or replace function` block in the Supabase SQL editor on 2026-07-28
      (editor reported success); a post-apply anon probe confirms the function still exists and is
      still service-role-only (`401 42501 permission denied for function`, not `404 PGRST202` and
      not `200`), i.e. `create or replace` preserved its grants. Recorded in `EXECUTION_LOG.md`.
- [ ] **Intake migration applied** (`production_intake_append` RPC) and pilot-verified on the
      TEST client.
- [ ] **Intake cannot acknowledge work it has not durably accepted** (F44): every legacy/native
      submit returns an idempotent receipt only after durable persistence, the browser awaits it
      and preserves the draft, and missing mapping/credential/plan/roster plus partial-create,
      timeout, retry, duplicate-click, dead-letter, alert, and replay drills pass on TEST. Server +
      browser fix merged & live with #836 (`c7b325e`, 2026-07-15); the failure/double-click/timeout
      drills against the deployed build are the remaining step.
- [ ] **Intake never invents an unfinishable component** (F101): owner either enforces the locked
      paired Video+Graphics model by removing/rejecting single-team intake, or ratifies explicit
      active-component semantics end to end. Classify and repair/migrate every existing single-link
      row; absent legs are N/A rather than `In Progress`. Overall/client-ready status, Calendar,
      Samples, queues, bulk actions, comments/alerts, artifacts, and every persona pass all-mode TEST
      coverage before any real-client enrollment or either team becomes writable.
- [x] **`production-write` can actually complete an entity write** — RESOLVED 2026-07-28: the
      owner applied `migrations/2026-07-28-f27-write-authorization-only.sql` (the two objects the
      deployed gateway requires, verbatim from the F27 migration, PR #970) and TEST drill runs
      #13–#18 completed entity writes end to end. Original finding retained below (found 2026-07-28). The then-deployed
      v26 introduced the call to `f27WriteAuthorizationGeneration` at `index.ts:3483` — inside `handleEntityOperation`,
      the handler for every non-create write — which invokes the Postgres function
      `track_b_f27_write_authorization`. **At the time of the original finding, that function did not
      exist in the live database** (`PGRST202`): it shipped in
      `migrations/2026-07-20-f27-team-rollback.sql`, whose first install attempt had stopped before
      DDL. The fence entered source at `e28c4b1` and was contained in deployed v26, so every entity
      write returned 503 `authority_unavailable` before any business logic ran — including blocker
      #8's assignment path. The reviewed subset apply closed that defect; the later Section 7
      rollback retained the exact function, and the 2026-08-02 F27 install deployed/read back the
      current `production-write` v27 closure. The ordering remains important: parity is checked at
      3482 and the fence at 3483, so arming `linear_legacy_parity_enabled` alone can never substitute
      for this database boundary.
- [ ] **Project selection is complete** (F45): every paginated source reaches
      `hasNextPage=false`, exposes a completeness/version readback, and exactly matches the
      canonical client/team mapping in an anonymized set report; a partial read cannot populate
      the dropdown or clear a draft.
- [x] **Every active client's `linear_project_ids` uses the team-keyed shape.** — CLOSED
      2026-07-28. The reader (`projectIdsForTeam` in
      `supabase/functions/production-write/policy.mjs`) accepts a team-keyed object
      (`{"video":"…","graphics":"…"}`) or a list whose entries carry their own `team` tag. A bare
      id list (`["…"]`) resolves to **zero** ids, so `projectForIntake` falls through to
      `409 project_mapping_missing` on the first native create for that client. Harmless while
      `prod_authority` is `linear` for both teams — that lane never reads the field — and blocking
      the moment a team flips.
      **What the "7 bare-string rows" figure actually was:** a whole-table count. Scoped the way
      this gate is scoped (`active = true`, `kind = 'client'`, TEST excluded) the live census on
      2026-07-28 was **31 team-keyed and exactly 1 bare** — the other six were 3 inactive clients,
      2 inactive TEST rows, and the active TEST client. The single real row held **two** ids, not
      one, so no single-element conversion could have fixed it; both ids were read back through
      Linear and proved to be two same-named projects, one owned by team `Video (VID)` and one by
      team `Graphics (GRA)`, making the pairing unambiguous. Converted 2026-07-28 via the manual
      template of `migrations/2026-07-28-linear-project-ids-team-shape.sql` (audit row captured,
      CAS'd, rollback available).
      **Readback (anon, post-apply):** all **32** active `kind='client'` rows now resolve a
      non-empty id for **both** required teams — zero rows would `409` on a native create. The
      TEST client deliberately still holds the bare shape and must keep it: `_shared/b4-write.ts`
      reads that field flat via `projectIds()`, and `principal.testOnly` resolves its project from
      `B4_TEST_PROJECT_BY_TEAM`, not from the row.
- [ ] **Card resolvability sweep = 0 failures**: every active Linear-linked calendar slot
      resolves to exactly one mirror row; the ~60 missing rows backfilled (F11).
- [ ] **Cards expose native ownership and navigation** (F112): for each flipped component on both
      Calendar and Samples, the card joins its native deliverable to the current active assignee
      (or an explicit unassigned/inactive/degraded state) and **View sub-issue** opens the stable
      Production detail in a new tab. No flipped-team card opens/edits Linear. Mixed authority,
      reassignment, stale/missing linkage, mobile, return refresh, second device, and Linear-down
      cases pass; the candidate suite asserts the card surfaces themselves, not only Production.
- [ ] **Client-token distribution rebuilt safely** (F03/F33): the public Clients Info sheet
      contains **no** review-token column; a staff-authenticated exact-client endpoint powers all
      four copy-link builders; then every SMM re-shares their clients' links. D-31's sheet
      mechanism is blocked pending the explicit owner decision in F33.
- [ ] **Track-A writers actually enforce auth** (F35): all six Calendar/Samples/settings write
      functions (live post-#836, 2026-07-15; calendar-upsert v38 + sample-review-upsert v39 from the
      merge SHA) authenticate and authorize the exact client/operation, derive actor server-side,
      and emit real write-attempt telemetry; anonymous negative probes are green and the 72-hour
      zero-unkeyed-write gate is measured from those attempts, not sign-in events.
- [ ] **Rollback cannot reopen anonymous writers** (F67): authenticate/scope every reachable n8n
      Calendar/Samples/settings fallback or retire it; enumerate direct callers and stale tabs; run
      positive/negative TEST probes against every live fallback and prove per-client rollback,
      routing-flag read failure, and EF 4xx/5xx/network failure keep the same authorization boundary.
      Dependency failure must fail visibly/retry authenticated work, never silently downgrade.
- [ ] **Client onboarding/offboarding is atomic and authenticated** (F69): one idempotent server
      receipt creates/reads back the active client, exact team/project mapping, protected token
      mint/revision/revocation, and every required Track-A routing/policy enrollment—or static
      allowlists are replaced. A fake TEST client proves first authenticated writes and teardown
      immediately denies its token with no fallback.
- [ ] **Public onboarding cannot launch privileged provisioning** (F128): anonymous capture is
      separated from Drive/CRM/Slack/vault side effects. Owner ratifies invitation-only versus
      public-capture-plus-staff-approval; one server-correlated sale/capability and immutable staff
      decision create a bounded idempotent job. Provider sandboxes/intercepts, canonical TEST
      identity, captured inverses and exact readback make the fake-client drill non-production and
      fully reversible. Anonymous/replay/wrong-sale/forged-client/duplicate/failure tests create no
      real provider object.
- [ ] **No account-access value enters Slack, logs, alerts or exports** (F129): server-side allowlist
      projection structurally excludes login/recovery fields and future secret-class fields from the
      channel brief and fallback DM; only a vault receipt/count/status may leave the protected store.
      Privately inventory/delete/contain prior copies and rotate/revoke as incident review requires.
      Canary tests cover normal channel, fallback DM, retries, logs and future unknown fields; UI,
      workflow description and lifecycle docs state the verified boundary.
- [ ] **Onboarding acknowledgement is truthful and resumable** (F110): persist a server-owned job
      before returning success; distinguish `captured`, `processing`, `complete`, and `failed` in
      the client/staff UX. Duplicate clicks, lost responses, capture-only replay, and a failure at
      every credential/provisioning/enrollment step resume the same job to verified completion;
      they never take a duplicate-success shortcut or clear the only recovery handle. The Kasper
      inbox includes fallback/dead-letter work, exposes status and step age, pages/freshens safely,
      and provides audited acknowledge/retry/resume actions rather than an unbounded snapshot.
- [ ] **Operators start from the current intake** (F111): the SyncView standard/AI inbox plus its
      durable job/alert is the sole documented handoff. Do not wait for the replaced Notion form or
      its active-labelled but non-production-triggered legacy workflow; archive that object only
      through F60's restore-proof process after identifier-free zero-use evidence. Independently
      page on captured work without a staff acknowledgement so a failed notification or stale
      open tab cannot strand a client.
- [ ] **Native concurrency is fail-safe** (F36): every Calendar/Samples/Production mutation sends
      an expected canonical version; stale requests create neither state nor outbox intent, return
      409 with the current row, and the browser offers compare/reapply instead of silent overwrite.
- [x] **Production identity is real** (F37) — CLOSED 2026-07-28 by TEST drill runs #17/#18
      (`f37_identity` green end to end; per-creative queues, account switch, zero-row, signed-out
      all proven against deployed v26). Original text retained: “My issues,” “Assigned to me,” owner-ratified team/
      assignment scope, comment scope, and actor attribution use the server-verified immutable member
      ID. The TEST matrix covers every active creative plus peer-assigned, unassigned, direct-link,
      account-switch and zero-row cases; unsigned/revoked sessions show no personal queue.
      *Slice 5 candidate source binds `_prodMyMemberId()` to the verified member and gives a
      signed-out, off-roster, or deactivated session an explicit no-personal-queue state; peer-work
      scope is closed for `status`/`attachment` and deliberately left open for `comment`. Unmerged;
      the per-creative identity drill is what closes this box.*
- [ ] **Production client attribution is roster-owned and explicit** (F200): every current mirror row
      resolves to one active SyncView roster client or an explicit internal/TEST classification;
      no current row remains unresolved. Future newly observed unknowns fail visibly into repair,
      and Linear project names cannot create clients. Close the public-safe 72/4,600 cohort with
      exact before/after counts, retain F145's true hierarchy, and prove the TEST child/parent family
      displays one consistent project without silent conflict inference.
- [ ] **Graphics has the ratified full-day mutation surface** (F201/F202/F203): Production reads and
      guarded-sets the real label catalog (including exact Workload labels), reads and guarded-writes
      parent/sub-issue descriptions, and creates parents/sub-issues with durable recovery. A label
      reaches native Workload capacity after flip; description/create survive conflict/retry/second
      device; and issue creation alone causes zero Calendar/Samples card or link writes.
- [ ] **Project properties have one read truth** (F205): a non-default fictional project proves the
      same status, lead, and target on board card, project detail, and each picker. No loaded value
      may become In Progress/No lead/No target because the surface selected a slimmer adapter object.
      The owner separately chooses whether these properties stay read-only for the Graphics move.
- [x] **Foreground Production converges** (F95) — CLOSED 2026-07-28 by TEST drill runs #17/#18
      (`f95_convergence` green: two foreground contexts converged within one tick with scroll and
      drafts preserved) plus the read-path re-baseline in run #18. The list-scroll containment fix
      (#973) landed as part of this proof. Original text retained: an all-day-open creative tab receives bounded
      assignment/status/due/artifact/comment changes from another device without requiring blur,
      backgrounding, or reload. Realtime/poll fallback, last-success age, stale UX, manual refresh,
      backoff, and focus/scroll/draft preservation pass two-tab TEST drills.
      *Slice 5 candidate source adds the bounded `updated_at` delta poll, the open-thread refresh,
      last-success age, degraded state, exponential backoff, a keyboard/touch Refresh, and
      per-row scoped-read invalidation that preserves open drafts. It also fixes the read path the
      poll sits on: the projection now walks the primary key instead of issuing a four-page OFFSET
      burst (measured 5.94 s → 3.40 s of upstream time), and a source-only migration makes each row
      detoast `linear_raw` once (offline 3.0× per page). Unmerged; the two-tab/second-device drill
      is what closes this box.*
- [ ] **Personal work is touch-mobile discoverable** (F96): below/at/above the 900px breakpoint, a
      fresh creative can switch between team Issues and My issues without a crafted URL or hardware
      keyboard. Deep link, back, reload, account switch, zero-row, portrait, and landscape tests pass.
- [ ] **Every Kasper subtab is touch-mobile discoverable** (F121): the tab row scrolls within the
      viewport, the active tab is revealed without page-wide overflow, and semantic tablist/tab/
      selected/controls plus roving arrow/Home/End keyboard focus remain visible. Owner ratifies Back
      history behavior. Test all eight keys at 390/768 and surrounding widths, real touch swipe,
      direct deep link/back/reload, 200% zoom/text scaling, portrait/landscape, populated layouts and
      second device—especially Onboarding, Sales Intake and Client Credentials. A denied tab must
      atomically canonicalize the active tab, URL hash, and saved subtab so reload cannot recur into
      an inaccessible surface.
- [ ] **Kasper Review/Messages failures are recoverable** (F130): cold and cached refresh failures
      render in the active tab, preserve any cache under an honest stale banner, and expose a visible
      keyboard/touch Retry. Pass Review and Messages cold failure, cached failure, retry success/
      repeat failure, tab-switch/abort race, mobile and keyboard tests; no indefinite skeleton.
      Expected/attempted/successful/failed client receipts prove queue completeness, and optional
      SMM attribution cannot block the core queue.
- [ ] **Client entry is fail-closed and paints only the requested client surface**
      (F102/F117/F149): unknown or conflicting client routes never fall through to staff content,
      legacy Samples links retain the verified client principal, and Calendar/Brief reloads never
      expose Analytics chrome or data. Prove the visible sequence from document start through
      settlement on synthetic fixtures, including hard reload and second reload. Final #891
      product-head cloud review completed at `babbb2d`; keep these rows OPEN only through owner merge.
- [ ] **Client-entry product QA preserves every protected credential, payload and strict route contract**
      (F173/F174/F175/F178/F180/F181/F182): all product-owned QA HTTP paths use one fixed-argv,
      fileless, in-memory transport.
      This includes the browser courier, direct shared-SXR helpers, p94 full-quota courier, EF
      drift/settings helpers, and optional vision API; protected keys, tokens, URLs, headers,
      request bodies and response headers never enter argv, files, command-bearing errors, child
      environments, artifacts or logs. Static-server access output and Playwright navigation
      failures cannot retain a token-bearing request target, and runner tails/reports are redacted
      at the credential-owning boundary. Drive the actual visible TEST client route and fail closed
      when a current token is unavailable.
      **PARKED #908 — NON-BLOCKING (F176/F179):** the completed overnight-runner, cron, broker,
      selector-union, registry/census, environment-containment and descriptor-guard work remains
      intact in unmerged draft #908 for later review. Do not execute, expand or reopen that work for
      #891; it is not a client-entry product release prerequisite by owner decision. Historical
      review evidence follows. Exact-head review of draft #891 `02105e9`
      completed and found F175/F176 and F178–F182. Post-F182 cloud source review at `59022d`
      expanded F176/F179; then-current `93fc297` began remediation. Candidate `13c042b` passed local
      `npm test` 149/149, but exact-head cloud source review (review `4741233371`; comments
      `3619424490`, `3619424493`) found the omitted workflow-direct Samples probe under F176 and the
      cross-catalog selector defect under F179. Pre-split candidate `c9a79ef` locally expanded the
      immutable registry/census to all 39 registered probes, remediates the union-selector F179 path
      and the F184 persisted-debt owner path, and passes local `npm test` 150/150 plus actual visible
      boot 23/23. Its exact-head cloud source review is nevertheless not clean: review `4741601566`,
      comment `3619744849` at `qa/overnight_runner.sh:109`, found an additional F176 occurrence where
      the direct process tree inherits `SYNCVIEW_STAFF_KEY` before classification. Follow-up local
      source tracing found the cron pass-through, unrelated helper inheritance and the absent
      declared broker for legitimate scenario/master consumers. Neither source pass used a
      credential, data, browser, backend or write. The owner later moved the complete F176/F179
      overnight containment to parked, unmerged #908. It remains OPEN/parked for later review, is
      non-blocking for #891, and must not be expanded or reopened in this integration. The client
      verifier is already live at v28 and must not be redeployed. The hard cutover does not wait for
      link confirmations; old links intentionally reach the existing updated-link screen.
      Final #891 product-head cloud review completed at `babbb2d` with no new findings; keep the
      product-owned rows OPEN only through owner merge. **DEFERRED / NON-BLOCKING FOR #891 (F185):**
      the earlier `f91aba17` exact-head cloud review found that the visible-boot workflow's Chromium
      cache-hit path does not reinstall Linux system dependencies. The exact hosted lane passed
      23/23, but a fresh cached runner can be non-portable. It remained deferred and non-blocking
      through `babbb2d`; correct and source-guard both cache paths in a separate follow-up PR. This
      runner item does not reopen F176/F179 or change the owner merge order.
- [ ] **Calendar lifetime and ancillary work have one exact-client owner** (F170/F171/F162):
      one generation owns the primary read, Linear reconcile/meta continuations, realtime
      channel/timers, loader state and deferred render until all tails settle. Client/route/no-load
      replacement and pagehide abort/revoke that exact owner; persisted pageshow starts exactly one
      fresh epoch. Hold A's reconcile/meta, switch visibly to B, release A, and prove zero B
      mutation, cache/meta persist, suppression token, writer enqueue or repaint. Pre-split #891
      candidate `c9a79ef` was locally green at 23/23 actual visible boot and `npm test` 150/150.
      Final integrated-head cloud review completed at `babbb2d`; the product row stays OPEN only
      through owner merge, and parked #908 is not a blocker.
- [ ] **Client Brief async work is revoked with its client-entry capability** (F183/F162): every
      Brief polling interval and tab-summary request controller belongs to the current client-entry
      generation. Client replacement, invalidation, pagehide and BFCache suspension clear/abort
      those exact owners before `briefPollingState` or `tabSummaryCache` is zeroed; every late
      response, cache/localStorage write, global mutation and render proves the same current run.
      Drive the actual visible client Brief pagehide → persisted-BFCache sequence with poll and
      tab-summary responses held, revoke the old owner, release both late, prove zero stale
      mutation/cache/paint, then prove exactly one healthy fresh generation. Source review found
      this at PR #891 `59022d` and reconfirmed it at then-current candidate `93fc297`; no browser/
      backend/token/live-data/write evidence was used for the finding. Pre-split candidate `c9a79ef`
      passes the expanded actual visible boot lane 23/23, including the real pagehide /
      `pageshow.persisted` sequence that proves old work retired and exactly one fresh generation;
      that synthetic local evidence preceded the final cloud review. Final integrated-head review
      completed at `babbb2d`; keep F183 OPEN only through owner merge. Parked #908 is not a blocker.
- [ ] **Client links never resume staff/legacy persisted debt before verification** (F184/F162):
      gate startup plus focus/pageshow/online/visible/timer queue recovery behind an exact current
      principal generation. Before strict client verification, inspect no persisted queue. After a
      valid client-A verdict, only matching-slug/client-principal Calendar/Samples retry rows may
      drain; foreign-B, empty/unknown and staff-owned rows plus every Calendar job, source/Kasper
      repair and native-intake queue remain byte-identical. Seed all four debt classes, drive every
      trigger including real `pageshow.persisted`, and prove zero activity before the verdict, only
      eligible A recovery afterward, and no stale BFCache post/mutation. Then enter a fresh verified
      synthetic staff session and prove exactly one deferred staff recovery owner. Cloud source
      review found the pre-verification defect at `adb1bca` and reconfirmed it unchanged at
      `13c042b`; no browser/backend/token/live-data/write was used. Pre-split candidate `c9a79ef`
      locally remediated the F184 owner/finalizer/retry boundary and passed actual visible boot
      23/23. Final integrated-head cloud review completed at `babbb2d`; keep F184 OPEN only through
      owner merge, and parked #908 is not a blocker.
- [ ] **Boot reads fail visibly and terminate**
      (F151/F152/F158/F163/F164/F165/F166/F167/F168/F169): HTTP 4xx/5xx,
      parseable error envelopes, malformed 200 responses, offline prerequisites and never-settling
      dependencies cannot become authoritative output/empty data or an indefinite skeleton. Cover
      Analytics, Calendar prerequisites, Templates detail, Production core, Kasper Samples, actual
      Brief synthesis, Samples Review fallback, top-level/Kasper Filming, Onboarding inbox/profile/
      standalone, Weekly Reports, Credentials list/modal/history, and Editors. Every route reaches
      content, an honestly labelled stale state, or a keyboard/touch Retry within its named deadline;
      Retry recovers without document reload and late/superseded responses cannot repaint.
- [ ] **Partial and failed aggregate reads never look complete** (F29/F45/F130/F138): Workload
      retains a visible stale/unavailable reason after issue-read failure; the Linear picker never
      turns failed project reads into “No projects loaded”; Kasper Review/Messages disclose per-client
      queue incompleteness; Production Activity distinguishes loading, complete-empty, stale, and
      failed event reads. Preserve last-good data only under an explicit banner, expose Retry, and
      drive each actual boot/refresh/failure/recovery sequence under F162.
- [ ] **Staff boot and history preserve one route and one data owner**
      (F150/F153/F154/F162/F172):
      direct Samples Review → Home starts the Analytics requirement; deep links round-trip their
      client/card/subtab; Back → Forward → Back uses the same teardown/mount lifecycle as clicks.
      Staff Analytics bootstrap owns and aborts essentials/extras/cache/render by document
      generation across route exit, pagehide and persisted pageshow; late completions cannot mutate
      or repaint a replacement document. F172 remains source-only until this visible sequence is
      reproduced and repaired.
      Each remediation's browser lane must record actual early visible frames and transitions; a
      settled-page or source-only assertion cannot close the finding.
- [ ] **Protected staff state follows the verified identity and document lifetime** (F186):
      weekly-report data, options, filters, caches, requests, and rendered DOM are revoked on
      identity loss/pagehide and reverified before persisted BFCache restore. Cross-tab sign-out
      replaces protected output with the sign-in boundary; late work cannot restore it.
- [ ] **Round 2 staff routes restore one exact descriptor and latest request**
      (F187/F188/F189/F190/F191/F194/F197/F198):
      Production replaces omitted query fields with canonical defaults and drops late reads;
      Workload immediately revalidates a labelled cached reload and starts a fresh BFCache
      generation; weekly filters and first-party uploader selection are latest-request-owned; admin
      notifications distinguish unknown/error from zero; and each More surface has an explicit
      return-refresh or labelled-last-good policy. Drive cold boot, reload, Back, Forward, held and
      reversed responses, route exit, pagehide, and persisted pageshow through the visible surface.
- [ ] **Round 2 staff unknown/failure state never becomes absence, empty, or another principal's
      draft** (F192/F193/F195/F196):
      both uploader queues fail visibly with Retry, Upload distinguishes mapping unknown from
      confirmed missing, caption prompt reads terminate before editor/generation action, and staff
      Submit/public intake drafts are isolated or explicitly principal-bound. F199 separately tracks
      the lower-severity typed Hook Library receipt. Follow the owner questions in the dated audit;
      this checklist records no silent policy choice.
- [ ] **B1 has a success-only durable checkpoint and typed terminal heartbeat** (F131): per-row
      writes, successful summaries, and failed summaries use distinct event types; only a complete
      write/readback advances the stored high-water. Failure at every write stage retries from the
      previous success and converges without skipping a planned issue. Monitoring requires the
      exact terminal type, `ok === true`, and matching expected/attempted/written counts.
- [ ] **Pager health is correlated, terminal, and lane-isolated** (F132/F09): every dispatch has a
      correlation ID and terminal receipt; one lane's failure cannot prevent another lane's dispatch
      or observation. Missing, failed, malformed, over-age pending, queue-depth, and mode-mismatch
      states page independently. An observer outside n8n proves the pager itself is executing.
- [ ] **Alert relay proves delivery and authenticates its source** (F09/F66/F81): HTTP acceptance
      is not Slack-delivery proof. Every caller uses authenticated source identity, a versioned typed
      schema, correlation/dedupe, and a terminal receipt. The onboarding fallback produces an
      actionable privacy-safe alert with no raw contact or notes.
- [ ] **Samples retains an independent cadence until pager isolation is proved** (F01/F132): if
      execution burn must be reduced before F132 closes, remove the pager's Samples dispatch rather
      than the independent GitHub schedule.
- [ ] **Repair-list and linkage alert policy is explicit** (F132): both page immediately with
      distinct state and throttle keys unless the owner records and tests another approved policy.
- [ ] **Client links fail closed and revoke reads** (F38): enforced-mode verifier errors cannot
      load/cache client access; the verifier requires an active client/current revision; verdicts
      are short-lived; same-tab reload, focus, second-device, offline-return, offboarding, and
      token-rotation drills purge all client state. F88's direct-read decision is separately closed.
- [ ] **Old builds are identified and rejected before mutation** (F127): embed the running build
      plus auth/authority/cache epoch, compare against a fixed same-origin manifest on root/index,
      direct/in-app Production and every onboarding alias, and send that identity on every protected
      read/write. Servers return `upgrade_required` before accepting a below-minimum caller. Owner
      defines the optional stale window and mandatory-release classes; mandatory updates cannot be
      dismissed, safely checkpoint drafts/queues, reload, and reverify identity. Pass cached-v1-first-
      check, deploy/revert, BFCache, offline-return, second-device, dirty-draft, queued-write and
      session-rotation tests; privacy-safe build/epoch telemetry proves population rather than
      treating the current banner as expiry evidence.
- [ ] **Auth rollback preserves the security boundary** (F70): after enforcement, there is no
      routine global return to permissive. Fix/revert the failed verifier/caller while auth stays
      enforced; any emergency bypass is scoped, owner-approved as a security incident, monitored,
      expires automatically, purges caches/sessions, and has compensating server containment.
- [ ] **Creative comment reads are team-scoped** (F39): the protected reader resolves the target
      server-side, returns a non-enumerating denial cross-team, records non-secret principal/target
      allow-deny audit, applies request controls, and passes own-team/cross-team tests for both roles.
- [ ] **Existing card threads are migrated and replyable** (F42): every active linked
      Calendar/Samples root and reply has one composite-scoped normalized identity; unresolved and
      duplicate-ID cases are classified. The private snapshot contains both Calendar and SXR arrays,
      independently supplied exact per-surface card/component counts and stable hashes, and produces
      `complete: true`, both `matches_manifest: true`, and zero conflicts before owner approval. An
      existing-root TEST reply then survives canonical projection, reload, and retry with no
      card-local-only mutation.
- [ ] **Marking a client comment done works on every card** (REGRESSION, found 2026-07-27,
      OPEN): since `328440f` (#924, 2026-07-24), crosswalk-linked cards route mark-done/edit/delete
      through `_writeUiCardCommentLifecycle` → the native gateway, which refuses under today's
      flags; non-linked cards still use the legacy `_calResolveTweaksDone` path, which works. The
      SMM cannot choose the path, ~273 cards / 24 clients are affected, and no workaround exists.
      Diagnosis PR #980 (merged) makes the next failure name itself; the fix itself is under
      investigation and MUST land before any team flips — a flipped team lives on exactly the
      failing path.
- [ ] **Comments have one truth across every persona** (F43): plain comment, tweak, reply, edit,
      resolve, reopen, delete, and Production-origin Client-visible paths use one canonical
      lifecycle. A real tokened TEST `sample-reviews` link must send its exact `sxr`
      card/component/deliverable identity, receive only client-audience rows, and fail
      non-enumerating for manual, Calendar, unlinked, wrong-card, wrong-team, or wrong-client
      targets; no endpoint capability assertion may unlock staff Client-visible. Canonical
      persistence must succeed before any Linear/mirror side effect; failure retains the draft and
      queue with visible retry. Retry and second-device rebase preserve the local edit and produce
      exactly one canonical mutation. While mirroring is applicable, F2 `off`/outage retains ordered
      add/edit/delete debt and recovery supplies the provider ID to dependents; a shadow-only to
      live edit materializes once and delete without a foreign comment is a proved terminal no-op.
      Retirement, if separately approved, produces zero new mirror/outbox intents.
- [ ] **Samples Finish history is durable** (F65): `kasper_finish_log` exists in schema, every EF/
      fallback allowlist and mirror preserves it, and Finish/re-finish/undo/retry survives refresh
      and a second TEST device with exact append-only equality.
- [ ] **Samples GA boot semantics are one truth** (F73): prepaint, staff deep-link, client portal,
      ordinary navigation, and `_sxrEnabled()` all default on unless the explicit sticky opt-out is
      set. Fresh/returning desktop, mobile, card links, reload, second device, and token failures pass;
      CI asserts behavior rather than copying a stale expression.
- [ ] **Only current Samples/reconcile procedure is executable** (F75): historical rebuild/go-live/
      parity guides remain clearly non-operative, the current generated topology owns every action,
      and a stale-epoch check rejects default-OFF, inactive-graph-as-live, anonymous-fallback-as-safe,
      or obsolete cadence instructions in operator docs.
- [ ] **Workload follows per-team authority** (F40): flipped teams read the reconciled native
      adapter with native links/realtime/catch-up and no Linear fallback; the parity report resolves
      stale ghosts, top-level visibility, CON/STR, parents, clients, assignees, and mixed authority.
- [ ] **Legacy multi-source reads fail closed** (F29): rotate/remove failed sources, page every
      source, require expected/successful-source and visibility-set completeness, skip destructive
      Workload mark-and-sweep on degradation, and preserve stale UI data with a visible warning.
      Linear status metadata distinguishes true not-found from source failure, never returns
      full-success for a subset, and does not advance the five-minute success throttle on degraded
      fetches; retry only failed IDs while retaining last-good values.
- [ ] **Video assignment policy is owner-ratified and atomic** (F30): use a fully paged current
      nonterminal workload for active eligible editors (or the explicitly chosen alternative),
      deterministic ties/leave rules, and concurrency-safe allocation; prove >50, >1,000, batch,
      simultaneous-intake, and live anonymized ranking parity.
- [x] **Manual assignment uses one server-authoritative eligible roster** (F94) — CLOSED
      2026-07-28 by TEST drill runs #17/#18 (`f94_negative` + `f94_stale_picker` green: every
      ineligible target refused with zero native/outbox writes; eligible assignment produced row,
      event and outbox intent together; stale picker failed closed). The owner question on
      admin/SMM ownership remains answered by the shipped strictest default. Original text retained: picker and gateway
      require active compatible creative role/team and, until retired mode, an active Linear mapping.
      Ineligible, unmapped, provider-inactive, cross-team, or stale-picker targets fail before native
      state/outbox writes. Owner explicitly decides whether admin/SMM may ever own creative work.
      *Slice 5 candidate source implements this (one `assigneeEligibility` projection shared by the
      `assignee_options` picker read, the create form, and `assertEligibleAssignee` at commit;
      strict per-team roles by default; `production_assignee_eligibility` reserved for retirement).
      Unmerged and undeployed. The negative and stale-picker TEST drills in
      `docs/ops/SLICE5_APPLY_WINDOW.md` §3 are what close this box.*
- [ ] **Production calendar-day semantics are stable** (F99): owner ratifies one business-zone or
      explicitly viewer-local contract; one on-demand clock powers relative parsing, quick choices,
      today highlighting, overdue display, and writes. Long-open tabs re-render at the next midnight
      and on return. UTC±, DST, midnight, leap-day, and mouse/keyboard/bulk TEST cases pass.
- [ ] **Due picker preserves the exact selected year** (F100): quick options and calendar cells carry
      ISO values, existing rows seed/select from `dueRaw`, mouse/keyboard/bulk paths agree, and
      Dec→Jan, leap day, explicit-year input, far-future navigation, and multi-select tests pass.
- [ ] **Staff credentials are individually revocable and attribution is immutable** (F31): remove
      inactive roster access, rotate the shared creative credential, invalidate old devices, and
      bind each accepted write to a server-resolved member/session ID. If the owner accepts any
      temporary shared-key residual, record the exact risk, controls, expiry, and offboarding proof.
- [ ] **First-flip mutations survive Linear unavailability** (F32): native intake/status/comment/
      due/assignee operations use reviewed native mappings and commit while Linear reads/writes are
      unavailable; mirror work may queue, but no synchronous Linear dependency may block the user.
- [ ] **Legacy inbound topology is deliberate and machine-proved** (F46): do not count
      `MJbMZ789B5ExZz9x` as active/realtime merely because its saved graph is authority-gated. Owner
      chooses repaired/published fast path versus reconciler-only SLA; the chosen path passes TEST
      drills and a preflight records active state, active-version/node fingerprint, and last-green
      execution. Never blind-publish the current unexplained post-crash saved graph.
- [ ] **Current Editors reader contained immediately** (F48): authenticate it, restrict the allowed
      audience/range, remove embedded credentials into managed storage, and prove denial/error
      behavior before go-live. Its eventual B5 replacement separately needs exact load,
      finish/open, timeline, event-time-assignee, paging, cache, and full-week parity.
- [ ] **Creative status reaches every reviewer from one authority** (F50): implement a
      transactional deliverable→card projection with CAS/idempotency or make every downstream
      Calendar/Samples/SMM/Kasper/client reader use deliverable status. Both-team TEST walks across
      refresh, realtime loss, second device, concurrency, retry, and rollback are green.
- [ ] **Native Create Post keeps one canonical title** (F133): the SMM enters/accepts the title
      before commit; deliverable and card are transactionally equal; later rename CASes both and
      records one `title_change`. Pass latest/new batch, multi-post, retry/lost-response, pre/post-
      review edit, two-tab, offline/reload and exact Calendar/Samples/Production/mirror equality.
- [ ] **Native intake recovery is server-owned and reassignable** (F134): committed-but-unmaterialized
      work lives in one durable idempotent job/reconciler, not one actor's localStorage. A protected
      recovery inbox can resume or auditably reassign it after sign-out/offboarding/device loss without
      losing original attribution or blocking unrelated intake. Prove exact-once cards and zero orphans.
- [ ] **Calendar and Samples reorder works without a mouse** (F135): touch and keyboard users have
      explicit accessible move/position controls through the same CAS reorder. Pass physical iOS/
      Android, keyboard/screen reader, scroll arbitration, filters, concurrency, offline and second device.
- [x] **Creative status transitions are server-authorized from current state** (F136) — CLOSED
      2026-07-28 by TEST drill runs #17/#18: the full 13×13 matrix across owned/peer/unassigned and
      list/direct routes matched `CREATIVE_STATUS_TRANSITIONS` exactly, with direction-split codes
      (`f136_gateway_more_permissive`/`_more_restrictive`) proving no permission escape. The six
      §4 defaults remain shipped at strictest pending owner ratification. Original text retained: owner ratifies
      one role/current/next/team/assignee matrix; the server and picker enforce it. Reviewer/terminal
      regression, cancel, duplicate and peer-work actions require only the explicitly approved role.
      Pass the full 13×13 TEST matrix across list/All/My/direct-link, stale CAS, retry and two devices.
      *Slice 5 candidate source implements the matrix (`CREATIVE_STATUS_TRANSITIONS`, mirrored by the
      picker and drift-guarded offline) at its strictest reading, pending owner ratification of the
      six defaults listed in `docs/ops/SLICE5_APPLY_WINDOW.md` §4. Unmerged; the live 13×13 drill is
      what closes this box.*
- [ ] **Video editors retain every distinct work asset** (F137): Production shows separately labelled
      Filming plan, Raw footage, Delivery/Frame folder and deliverable file with missing/invalid/
      expired/permission states; no priority fallback hides or mislabels another asset. Pass all 16
      presence combinations, native/backfill, reassignment, mobile, refresh and second device.
- [ ] **Native activity history is protected and visible** (F138): a team/role-scoped paginated
      reader renders stable actor/time/action/from→to history with loading/empty/stale/retry states and
      redaction. Pass event completeness/order/paging, denial, comments coexistence, mobile and second
      device before Linear history/Inbox retirement; `WIRED-PARITY.md` matches runtime truth.
- [ ] **Graphics can deliver canonical media** (F53): protected file/link write or first-class
      picker updates `deliverables.file_url`, preserves actor/time/replacement history, and projects
      the correct card asset. SMM Approval rejects media-less work; a fresh TEST intake completes
      every review/tweak surface.
- [ ] **Inactive-client work is quarantined server-side** (F54): ordinary queues exclude it and
      status/comment/due/assignee mutations reject it unless audited recovery mode is active.
      Reconcile the current private cohort and prove zero unreviewed inactive-client work.
- [ ] **Title-provider credential incident closed** (F52): move the replacement to managed n8n
      credentials, inventory the complete workflow/version/export/
      backup population and access, review provider usage privately, and pass TEST title success +
      failure drills. Order: restrict access immediately; stage/prove the managed replacement on
      TEST; owner revoke/rotate; then finish the broader census while monitoring unknown consumers.
      No value enters this repository.
- [ ] **Submit graphics path drilled live on the private TEST fixture only** against the deployed
      EF, including real `GRAPHIC_TITLE_*` generation (F12). The routine drill's explicit
      generation skip is not real-generation evidence. Retain `graphic_generation_verified:true`,
      `0/0/0`, unchanged-flags and cleanup receipts plus a provider-failure zero-write/recovery
      receipt. No real-client write is induced. **This checklist item is a closure requirement, not
      authorization:** before either run, bring the owner the exact TEST-only change and rollback.
      This docs reconciliation authorizes no drill, provider/secret change, runtime-flag change,
      or client write.
- [ ] **Every load-bearing n8n workflow has proved error delivery** (F09): a generated live-settings
      census shows the intended handler on every active graph, and one sanitized TEST-only failure
      receipt per workflow reaches the owner. The handler's existence is not evidence of wiring.
- [ ] **Non-n8n inbound-divergence pager live + terminal delivery proved** (F09/B6/F132): retain
      B6's sampled synthetic-DM success as happy-path evidence, then correlate acceptance through
      terminal owner delivery and prove the independent observer still fires while n8n is unavailable.
- [ ] **Alert rollback is lane-scoped** (F66): stopping Linear-inbound anomaly delivery cannot
      disable onboarding fallback alerts or any unrelated consumer of a shared project secret;
      both routes pass independent TEST sends and kill/readback drills.
- [x] **Independent backup package + timed scratch restore built per D-1** (F13): **DONE 2026-07-15
      (PR #840, merge `4f9d919`).** A 6-hourly export independent of n8n now runs on `main` with a
      versioned expected-corpus/schema/count/byte/hash manifest, fails closed, independently reads
      back every object from a private Google Shared Drive, never advances last-known-good on partial
      output, and alerts via the GitHub failed-run email to the owner (`sidney.laruel@gmail.com`).
      Proof run `29444939853` plus a 229 s scratch restore (exact counts, zero orphans) confirm it.
      The current weekly n8n run remains non-evidence and is superseded. PITR is owner-declined
      (accepted residual), so the flip-week PITR readback is intentionally skipped.
- [ ] **Capacity/egress evidence recorded** (F49): live Pro truth is recorded (2026-07-13: seven
      completed daily physical backups / seven-day retention, PITR off, database disk 0.45 GiB used).
      Owner still answers from Dashboard Usage/Billing: **what is current egress, and is the spend cap
      on or off?** Then run post-#850 bootstrap/mobile/cache load tests and set thresholds.
- [ ] **n8n quota fire resolved** (F01): burner identified/killed, hard-stop vs overage known,
      headroom projected past the flip window.

**People gates (owner/Kasper):**
- [ ] **100% of the owner-approved active roster can sign in** — reconcile HR/current staffing,
      deactivate departed or duplicate rows, invalidate their credentials/devices, and then record
      only anonymized active/verified counts from server evidence. A stale denominator or a sign-in
      attributed to a departed row is not readiness (F31/F64).
- [ ] **Exact-recipient notifications proven** (F15/F47): active members have immutable native
      notification mappings; assignment, tweak, and URGENT TEST sends return/persist the intended
      member plus destination/message receipt before the UI says “Sent.” Missing, inactive,
      ambiguous, wrong-team, and provider-failure cases remain visibly pending/retryable and alert.
      (The retained legacy sample was mapped; this gate does not claim a historical missed mention.)
- [ ] **D-9 nightly roller** neutralized per the touchpoint-inventory owner actions, OR
      owner-signed detect-only risk acceptance; the shared `Form` API key consumer-mapped
      before any rotation (F14).
- [ ] **D-8/D-30 confirmed in code**: the +2d overdue bump behavior exists in the native path
      (owner chose KEEP, 2026-07-13).
- [ ] **Comms drafted** for parity-arm day (F24): "SyncView-relayed comments in Linear show
      author 'SyncView Mirror' with the real name in the body; if a tweak seems missing in
      Linear, check SyncView."
- [ ] **Supabase-outage table-top passed** (F41): last-known authority is available offline, the
      automation hold/manual-merge path is executable, and every Linear-authoritative versus
      SyncView-authoritative team receives the correct instruction from FLIP_RUNBOOK R3.

## Phase 0.5 — Dark merge/deploy checkpoint (#850 merged; remaining TEST proof open)

- [x] `write_ui_reroute_clients` was created/read back in the TEST-only posture, its guarded
      reroute source landed via #850, and real clients remain on legacy paths unless separately
      enrolled. Read the flag fresh before relying on this dated checkpoint.
- [x] Pinned manual run `29601466479` accepted exact `main@9d76df6`, deployed
      `linear-outbound` v33 before `production-write` v24, and passed all ten function
      fingerprints; an ordinary merge/push deploys neither Track-B writer.
- [ ] With separate owner approval for any live TEST/provider action, complete the remaining TEST
      drill and walk the TEST client through
      Create-Post (latest batch + new batch), Submit, approve, tweak, and comment end-to-end.
- [ ] Passively observe one organic real-client save/approval through the legacy path, or prove
      the dark behavior with a non-enrolled TEST fixture. Do not induce a production write.

## Phase 0.75 — Enforce client-link auth before real traffic (F97)

- [ ] **All Phase-0 auth/read/write gates remain green on one unexpired preflight**: especially
      F31/F35/F38/F67/F69/F70/F76–F89/F91. Phase 0.5 remains TEST-only and is not evidence that a
      real client can be enrolled safely.
- [ ] **Exact current-token roster proof is green** (F89): every active client has one fresh
      `credential_valid=true` event bound to its current token revision; missing, extra, stale,
      inactive, or ambiguous rows fail the gate. No token or client identity enters public output.
- [ ] Deploy/read back F38's fail-closed verifier and browser changes, rotate the verdict/cache
      epoch, and purge stale permissive verdicts, client DOM/data, channels, and write state.
- [ ] The owner executes FLIP_RUNBOOK §F5's single CAS from exactly `permissive` to `enforced`,
      reads back exactly `{"mode":"enforced"}`, and records the flag event plus the same preflight
      evidence handle in `EXECUTION_LOG.md` and ROLLBACK Live State.
- [ ] On TEST, missing/invalid/expired/rotated/inactive credentials and verifier 5xx/timeout/offline
      all deny reads and writes across reload, foreground return, second device, mobile, and stale
      tab; a current exact-client credential still works. If any case fails, **do not enter Phase 1**.
      Preserve enforcement and contain/fix the specific caller or verifier per F70.

## Phase 1 — Staged parity soak (real traffic, Linear still boss)

- [ ] Read back `auth_enforcement={"mode":"enforced"}` and the still-current Phase-0.75 proof.
      A permissive, missing, malformed, stale, or unproved value blocks every real cohort (F97).
- [ ] **TEST and real-client divergence are separate signals** (F90): TEST-only churn remains visible
      in a diagnostic but cannot increment the real-client soak/pager criteria; mixed, TEST-only,
      and real-only fixtures pass and all public output uses private TEST notation.
- [ ] Arm the parity lane: `linear_legacy_parity_enabled` → enabled (FLIP_RUNBOOK §F4).
- [ ] Enroll a first small cohort (2-3 real clients) in `write_ui_reroute_clients`. Their
      staff/client/Kasper writes now flow through the gateway and land in Linear via the
      parity drain — same outcome as before, new pipes.
- [ ] Watch 2-3 days: reconciler 0-diffs, drill green, no oldest-pending-age alerts, no
      quarantine/409 noise, spot-check tweak comments arriving in Linear.
- [ ] Enroll the rest of the roster in cohorts. Full-roster clean for **~1 week** = D-28's
      soak satisfied.
- [ ] **Parity incident rehearsal (F58):** for a cohort fault, stop cohort mutations and remove the
      affected cohort from `write_ui_reroute_clients`; for systemic/unknown bad Linear writes, set
      F4 `false` and F2 `off`, read both back, preserve/classify queued intents, and follow FLIP
      RUNBOOK R1. Prove F2 alone does not masquerade as a parity kill.
- [ ] During the soak: after F37 is fixed, complete Rocio's full day-one desk walk (B3). F36's
      initial collision already failed; run its remaining mutation/409 recovery matrix rather than
      repeating only the same status collision. The walk starts with a newly-created TEST graphic,
      attaches/replaces its real delivery link, and proves it appears through SMM, Kasper/client,
      tweak, refresh, and second-device review (F50/F53).
- [ ] **Inactive-client work is quarantined** (F54): ordinary personal/team queues exclude inactive
      clients; an explicit role-gated recovery view owns any retained rows; writes cannot silently
      advance them. Privately reconcile the current cohort and record
      `zero_unreviewed_inactive_client_work` before Graphics flips.

## Phase 2 — Flip Graphics (Rocio)

Pick a low-activity window.
1. [ ] Toggle PITR ON for the flip week (D-1; owner dashboard).
2. [ ] Tell Rocio: work in SyncView only; problems → tell Sidney, never fall back to Linear
       silently.
3. [ ] **Arm the mirror before authority (F98):** while both teams still read back `linear`, set
       `linear_outbound_enabled` → `live` (FLIP_RUNBOOK §F2), read it back, and require correlated
       terminal drainer/credential receipts plus an observer outside n8n (F131/F132), not a fresh
       pager timestamp. After the passing pre-F2 receipt and immediately before F2, wait for a
       same-release successful scheduled drainer and require literal `GO` from FLIP_RUNBOOK's
       **Graphics F2 hard pre-flight**. That machine gate binds the exact passing pre receipt,
       binder, and current-main release; verifies current Linear/Linear + F2-off state; exhausts
       latest drainer attempts around the snapshot; and proves exact zero real rows in
       `pending|failed|shadow_ok` across every team and both parity lanes, without attempt/retry-time
       filtering. A stale or red gate stops the flip. After F2,
       re-prove the evidence lane's exact both-team real non-parity zero; owner-classify/resolve any
       residue and restart the proof. The terminal receipt must show zero normal-lane writes; any write
       must equal expected, acknowledged `legacy_parity_written` from the still-armed parity cohort.
       Authority-paused nonzero is not green: it can starve the global batch or be released by F1.
       Any failure stops here with both teams still Linear-authoritative; follow the runbook's
       F2-off/fresh-pre/retry sequence rather than substituting a later successful drainer.
4. [ ] Only after step 3 is current, set `prod_authority.graphics` → `syncview` (FLIP_RUNBOOK §F1)
       and read back **both** flags. Never open authority first and hope F2 succeeds afterward.
5. [ ] Verify the first real intake has a canonical, visible artifact before SMM Approval and the
       deliverable status reaches the linked Calendar/Samples card and every reviewer (F50/F53).
6. [ ] Verify her first real write lands in Linear via the F07 sync-drain lane within the approved
       seconds-scale SLO. F07's implementation is deployed; this non-TEST timing receipt remains
       the proof. **Hard stop:** do not proceed to Phase 3 until it passes;
       a 10–60 minute legacy-poll delay is not an acceptable fallback.

## Phase 3 — Watch the Graphics window

- [ ] Reconciler 0-diffs; oldest-pending-age quiet; drill/audit lanes green. F08's monitors are
      flip-tolerant in source, but the latest inspected scheduled runs as of 2026-07-19 are red for
      distinct reconciliation/data-integrity signals; investigate those signals and require a
      fresh green window.
- [ ] Kasper's queue shows her natively-created thumbnails. F04's native-link predicate is merged;
      this checkbox is the required first-real-Graphics observation, not a source-completeness check.
- [ ] Apply D-29 on anything found. F27 is installed and reserved-drill-proved; its 2026-08-02
      packaged production verifier returned PASS across all 17 enumerated assertions. That install
      proof is not a real-team rollback rehearsal and does not close this Phase-3 observation gate.
      Follow FLIP_RUNBOOK §R2: stop new writes and F2/F4, call the installed begin function to hold
      and snapshot that team, classify every intent, replay only owner-approved rows with correlated
      terminal receipts, prove a machine-read team zero, and only then use the guarded finalizer to
      change authority. A completed instance of the known reconciler `57014` read defect is not a
      readiness signal. Never use the default drainer as rollback proof.

## Phase 4 — Flip Video

Repeat the Phase 2 human/readiness gates and F1 authority action for `prod_authority.video` once
Graphics is boring, but **do not rerun F2**: normal outbound was enabled globally during the
Graphics flip and must already be live/read back. Re-prove both F2 and F4 current state, **exact
zero real non-parity Video rows in `pending|failed|shadow_ok`**, correlated terminal drainer/
credential receipts, and an observer outside n8n before
Video F1; classify/resolve residue instead of releasing it. Re-prove all four editors signed in,
tweak-delivery comms sent (F24), exact-recipient assignment/tweak/URGENT receipts proven, current-state
transition authorization green (F136), all four Video assets visible (F137), and activity-history
replacement agreed/proved to the gate chosen for F138.

## Phase 5 — B5: retire Linear (its own project)

Follow **TRACK_B_LINEAR_REPLACEMENT_SPEC.md §13** (D-22's roughly one-week dual-ready fallback,
archive-completeness + full private export, then the owner-gated retirement order with a proved
inverse per action — Workload feeder,
tweak-comments, editors-week, inbound, readers). This post-flip fallback is separate from D-28's
pre-flip parity-soak week. Assign an owner + ticket per replacement before starting.
Before retiring `editors-week`, require full §9.11 UI/semantic parity: load/error/empty states,
finished versus still-open work, timelines/week navigation, production scope, event-time assignee,
complete issue/history paging, historical-roster behavior, cache, and failure UX. Matching delivery
totals alone is not a retirement gate. Verify the already-inactive `MJbMZ789B5ExZz9x` topology from
live readback; do not list “deactivate it” as newly completed teardown work.
- [ ] **Linear-free retired epoch built but not prematurely activated (F32/F61):** an isolated
      service-only TEST override removes Linear validation, eligibility, IDs, and new outbox
      enqueues transactionally; full TEST mutations pass with Linear unavailable and create zero
      intents. Keep the real retired-epoch flag disabled throughout the dual-ready grace.
- [ ] **End-of-grace activation order proven (F58/F61/F92):** freeze human/app/service writes;
      set/read F4
      parity false; classify/replay/disposition final intents and prove both teams zero; set/read F2
      normal outbound off; run only a dry-run/detect-only final reconcile. Any diff/would-enqueue
      aborts and returns under the freeze to F2 live plus classify/drain/disposition and a fresh
      per-team zero proof. Only a final dry-run zero may proceed to archive/export and atomic
      retired-mode activation/readback. Prove a private TEST mutation creates zero outbox rows before
      teardown/resume.
- [ ] **The end-of-grace freeze is server-enforced** (F61): a team-scoped maintenance/cutoff state
      or atomic high-water protocol rejects every browser, stale-tab, retry, service, and automation
      mutation with explicit UX while the final zero/export/epoch transaction runs. TEST races prove
      no accepted write can cross the boundary; a human instruction to stop is insufficient.
- [ ] **No destructive import rollback is represented as ready** (F62/F68): preserve both imports
      by default. Any removal requires a fresh dependency/version graph, owner-approved disposition,
      assertion-bearing transaction, and full TEST/scratch restore rehearsal.
- [ ] **Completed migration IDs cannot be reused** (F103): the executed comment-import record stays
      non-runnable; a server-side completion ledger/CAS rejects consumed IDs before the first RPC.
      Any future migration has a fresh owner-approved ID, immutable source checkpoint, exact current
      dry run, script/schema commit, expiry, TEST rehearsal, and dependency-safe recovery. CI finds
      no active apply/delete/recovery recipe in any executed or historical playbook.
- [ ] **Calendar-v1 cleanup uses a new owner-approved plan** (F104): the old Phase-4 deletion recipe
      remains quarantined. Before removing any flag/fallback/symbol, measure opt-out and caller use,
      ratify replacement outage recovery, scan whole-repo consumers, update README/System Map/
      ROLLBACK together, and pass v2-on/off, Supabase/n8n failure, metadata/banner, save-concurrency,
      Calendar/client/Kasper/Films, focus/mobile/second-device tests. Every object also passes F60.
- [ ] **Calendar recovery never splits read and write authority** (F125): withdraw `?v2=0` as
      writable rollback and treat automatic REST→Sheet fallback the same way. Sticky-off/fallback
      plus an EF-enrolled client is explicitly read-only until one atomic recovery mode couples its
      reader/writer (or journals/reconciles writes). Add server CAS
      for every mutable whole-card field and pass v2 on/off × EF enrolled/unenrolled/flag failure ×
      REST/fallback × edit/create/archive/reorder/import × cache/second-device/two-tab tests.
- [ ] **Sub-issue expansion is complete before any Calendar mutation** (F126): page children and
      required comments to exhaustion, reject partial GraphQL envelopes, and require an explicit
      complete receipt. Import, bulk-link and status adoption preserve prior state and write nothing
      on incomplete data; a parent is a leaf only after a complete zero-child result. Retire the
      legacy `/add-to-calendar` branch after zero-caller proof or give it the same durable contract.
- [ ] **Archive is usable and assets are rescued (F34):** a role/audience-scoped archive reader is
      live; issue/comment counts and hashes match the private export; every Linear-hosted image/
      attachment is rescued/relinked or explicitly owner-dispositioned; retrieval/restore drills
      pass with `zero_unreviewed_image_gaps`.
- [ ] **Each teardown action has a proved inverse (F60):** exact private restore object, documented
      recreate/restore command, machine readback, owner, and drill. Prefer deactivate/archive;
      never delete a webhook/workflow graph or rotate a credential under a generic reversibility claim.
Note (F26): retiring Linear does NOT retire n8n — ~20 non-Linear webhooks (templates, briefs,
filming plans, TikTok, hook library, weekly Slack, content-ready…) remain until their own
migrations complete. New-client onboarding must atomically mint mapping + token + authenticated
Track-A routing/policy enrollment and prove its first EF write (B2/F69) before B5 makes Linear-side
creation impossible.

---

## Rollback — always through FLIP_RUNBOOK §R2

Short version: **stop new writes + disable/read back the involved F2/F4 lane(s), both if unknown/mixed → call installed F27 begin for the immutable team snapshot/hold → classify every intent →
replay/quarantine/discard with owner reason → machine-read team zero → run the guarded finalizer →
tell the team → fix → re-soak → re-flip.** F27 is installed and reserved-drill-proved. The finalizer
is the one-statement authority reversal, but the preceding accounting remains mandatory and manual
where classification or replay is required. Never substitute the default drainer, a global green
summary, a fresh authority guess, or the reserved-drill finalizer.
