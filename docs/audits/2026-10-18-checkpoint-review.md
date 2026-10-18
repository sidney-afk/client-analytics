# Review saves and recovery checkpoints, 2026-10-18

Session Checkpoint. Candidate frontend repair; unmerged and undeployed. The live pass exercises the deployed page, not this candidate. No literal no-failure guarantee is established.

## Confirmed checkpoint failures

The journal's Web Lock covered one storage operation at a time. It did not own a card's asynchronous native request, receipt reconciliation or source completion. A second recovery could therefore consume a row while its original writer or another recovery still needed it. The original 507 sites remain present; none is suppressed or renamed.

| Lookup or missing-data path | Reproduction / disposition |
| --- | --- |
| Native acknowledgement after recovery consumed the row | A second same-origin page attempts recovery while the first native acknowledgement is gated. Baseline recovery deletes the row; candidate defers it. |
| Source completion during another native attempt or receipt reader | Cleanup now requires the same card lease; an occupied card retains its exact durable debt. Recovery completes its own refs after releasing the replay lease. |
| Companion lookup after successful background completion | The acknowledged caller keeps a private in-memory snapshot, including its status companion. Binding and reconciliation no longer depend on a second storage read of an already consumed receipt. |
| Two writes on one card | Native attempts serialize per surface/client/card across tabs. Different cards have different locks. Journal updates retain their existing short exclusive lock. |
| Journal snapshot queued before another recovery completes | Recovery re-reads the group under its card lease; a consumed group has no work to replay. |
| Site storage cleared while an acknowledgement or receipt is pending | A complete owned snapshot can be restored after a native commit or authenticated reconciliation. A partial reference cannot recreate data and still returns `repair_checkpoint_missing`. |
| Quota / blocked writes before native send | Refused before transport. No native mutation. |
| Quota after native commit | No transport retry for bookkeeping failure. Pinned bytes remain in the existing durable journal when storage has not been cleared. Copy explicitly says the save may already have reached the server. |
| Blocked storage reads / malformed journal | Unknown debt, not an empty journal. Existing unknown/corruption refusals stay active. |
| Reload while a request is pending | Closing the document releases its browser lease; the exact pre-send envelope survives in the journal. Existing authenticated receipt reconciliation owns recovery. |
| Storage cleared and document closed together | Browser-owned unsent text cannot be recovered after every local copy is deliberately removed. No blanket durability claim is made for that combination; copy instructs the person to keep the page open and copy the words first. |

The 2026-09-23 comment in `170-calendar-links-status.js.part` fixes a redundant gateway pass after a committed source write. It does not protect the asynchronous journal lifetime above. A read-only diagnostic query independently confirmed the reported live refusal at **2026-10-18 19:31:54.473313 UTC**: Calendar comment, `repair_checkpoint_missing`, 507, Firefox/Windows, one attempt. The diagnostic principal was unverified; the receipt alone cannot prove which staff identity or scheduling produced it. The specific historical interleaving remains unproven.

## Candidate proof

The all-engine focused suite has **69 passing cases**: 33 checkpoint/storage cases and 36 page-control cases (client and SMM, desktop 1440 and phone 390; note, video change, graphic approval). It uses real browser localStorage and Web Locks; backend transport is fictional. Every note is checked for one exact body and statuses are checked against the mocked stored row. Native receipt/read responses are explicitly represented; an empty authoritative read remains a refusal.

The baseline negative control reads the two production fragments from `CHECKPOINT_SOURCE_REF`; page-control cases still use the built candidate. Baseline failures are evidence for the extracted actual checkpoint functions, not a claim that the candidate UI bundle was main. Original red exploratory receipts are retained privately. No assertion was removed to make them pass: the existing durability/race harnesses load the new ownership helpers and still execute their original assertions.

The original baseline run had 21 targeted helper failures and two additional UI browser-error failures (23 total). Those extra browser errors are not attributed to the checkpoint cause. The candidate completed all 69 cases twice. The failure-message test now requires the stronger storage guidance, including possible prior native success, copying words and checking before resending; it no longer pins the obsolete, misleading sentence.

Focused durability, repair-race, failure-message and production gateway browser checks passed. Build determinism, fragment stripping, module resolution, browser-guard wiring, CI routing, runner seats, repository map and identity exposure checks passed. The full local `npm test` attempt remains red: 41 of 763 suites failed. One was the obsolete message pin corrected above. Of the other 40, 37 also failed on pristine main, one timed out there, and two passed on main. The index-build suite passed on the candidate after rebuilding; schema compatibility passed from the resolved D: checkout (the C: alias bypasses its preload path normalization). This is a comparison, not a claim that a full unit rerun was green.

Hosted checks on the implementation commit passed all three unit shards and module checking. `production-polish` failed at `Production accessibility/focus [page_error_pending_read]`; its protected details stayed in the runner. The same read-only accessibility suite subsequently passed locally on both candidate and pristine main. The hosted failure remains red and unexplained; no check, skip or branch exception was weakened to clear it. Final-head status belongs to the PR checks.

## Live method and boundaries

The live runtime flag was read as all clients enabled. The app's Share with client action issued the designated test link using an existing verified local staff identity. A disposable native card was created through Create post in the existing test batch, with its own two native work items; existing cards were read only. Media/caption setup, status changes, restores and archive use app controls. Database checks use the existing scoped read helper or read-only query tools. No SQL mutation, function deployment, flag change or merge occurred.

The deployed client link, Calendar SMM Review and staff Review Session were exercised using Playwright 1.56.1: Chromium 141.0.7390.37, Firefox 142.0.1 and WebKit 26.0, at 1440×900 and 390×844. These are desktop browser engines at phone viewport width, not physical iOS or Safari certification. There is no backend or media substitution. Slow-save cases delay the real source request by 3.5 seconds; they test latency, not a bandwidth cap. Offline cases interrupt a real save and restore connectivity after two seconds. Two-tab cases send distinct messages concurrently and count each exact body in the database. The helper reads the source row independently; it does not prove exactly one native event for a scalar status assignment.

Action timings include interaction and independent database polling. Every recorded action over three seconds is retained in the machine-readable results, including failed timeouts. Multi-action cases such as Finish include its prerequisite approvals; that total is not the latency of the final button alone. Injected delay is labeled separately and cannot establish ordinary production slowness.

The [complete public-safe observations](2026-10-18-checkpoint-live-results.json) retain original failures, corrected probes, safety-guard refusals and a separate list of every action over three seconds. Six means the three engines at both widths; this table is not a claim of one green uninterrupted journey.

| Action | Client link | Calendar SMM Review | Staff Review Session |
| --- | --- | --- | --- |
| Open | 6/6 | 6/6 | 6/6 |
| Play video | 4/6; bundled Chromium fails | 4/6; bundled Chromium fails | 4/6; bundled Chromium fails |
| Video and caption notes, exact body once | 6/6 each | 6/6 each after waiting for the selected step | 6/6 each with Just a note |
| Edit and send caption | 6/6 | 6/6 | Not offered in this stage |
| Approve video / thumbnail / caption | 6/6 each | 6/6 each with the offered video resolution chooser | Video/thumbnail 6/6; caption 6/6 fresh, 0/6 in the earlier stale sequence |
| Request video change | 6/6 | 6/6 | 5/6 in the long sequence; one unresolved timeout |
| Two concurrent distinct notes | 6/6 | 6/6 | 5/6; one unresolved timeout |
| Plain-message draft after reload | 6/6 retained | 0/6 retained | 0/6 retained |
| Caption edit draft after reload | 0/6 retained; no DB caption save | Not separately measured | Editor not offered |
| Delayed real source request | 6/6 | 6/6 after selected-step correction | 6/6 |
| Isolated offline save and return | WebKit 2/6 landed; Chromium/Firefox 4/6 unresolved at the observation window | 6/6 landed, including the corrected Firefox phone probe | WebKit 2/6 landed, including corrected desktop; Chromium/Firefox 4/6 unresolved |
| Delete own note | 6/6 with real hover | 1/6 in fresh shared-dialog probes; see failures below | Uses the Calendar dialog; no direct stage Delete |
| Finish | 6/6 | 6/6, including all prerequisite approvals | 0/6 in the long sequence, blocked by the incomplete caption decision |

Offline cases have their own isolated observations and retained-copy/recovery fields; the initial overlapping-request probes are preserved but are not the stronger evidence.

In the isolated pass, the four Chromium/Firefox client saves were still absent at 30 seconds and after the subsequent reload/readback attempt. Each retained a browser copy and appeared in the conversation, with no stage error or retry control at the observation point. The four Chromium/Firefox reviewer cases also remained absent; their words survived in local storage and the reviewer's in-memory draft, and an error appeared, but the words were not visible in the stage and no stage retry was offered. Their reload recovery attempts failed the driver's target-ready check, so they do not establish that the journal can never recover when the card is reopened. This is no proof of permanent text loss. The two-second probes that never observed their own source request (Firefox phone SMM and WebKit desktop reviewer) are invalid interruption evidence; the corrected probes wait for that request, explicitly select the video step and can recognize native as well as source writes.

Both corrected cells landed once; an additional corrected WebKit phone reviewer probe also landed once. All three recorded a real `calendar-card-write` interruption. Browser copies and source readback are the evidence here, not a promise that arbitrary device storage loss is recoverable.

## Live findings, worst first

- **Reload loses unsent words.** Client caption edits disappeared in all six follow-up cells, without saving the caption to the database. Calendar SMM note drafts also disappeared in all six initial cells. Staff Review Session note drafts disappeared in every completed cell. Client plain-message drafts survived reload in all six cells. Pocket/Gauntlet Three already propose related draft repairs, but their open PRs are not deployed proof.
- **Interruption can leave a save unresolved.** Some interrupted saves were absent from the database after 30 seconds. Earlier client cases later acquired their note during subsequent work, so this is not evidence of permanent backend loss. Reviewer failures showed neither their words in the visible stage nor an offered retry at that observation point. A focused rerun interrupts only the request containing that case's words, to exclude accidentally interrupting a preceding save. Final outcomes and retained-copy checks are in the results.
- **Staff deletion needs further attention.** Staff note deletion was inconsistent even after a real hover exposed Delete. Some desktop cases accepted Delete and its confirmation but the database note remained live after the poll window; phone cases also timed out locating the expected control. The latter cannot establish a delivered deletion request. These are reported as live observations, not silently converted to passes.
- **Some successful work takes over three seconds.** Client change requests took about 4.3–9.1 seconds through database confirmation; concurrent staff notes about 3.6–8.1 seconds. Individual successful approvals also crossed three seconds. The complete per-cell timings accompany the report; read overhead and compound cases remain visible.
- **Bundled Chromium cannot play this live video.** It returned media error 4 at both widths on client and staff stages. Firefox and WebKit played it at both widths. Installed Google Chrome 155 independently played the same live media in a read-only check. The split suggests a bundled-browser media/codec limitation, but the decoder cause is not independently proven. No replacement media was used to manufacture a pass.

## Refuted and unproven candidates

Review Session caption approval was refused during the long sequence after parallel edits; Finish then failed as a consequence of incomplete decisions. Fresh-page caption approvals succeeded. A focused writer response confirmed the stale-card conflict and its refresh/re-apply message. This is not evidence that every caption approval is broken. The exploratory graphic-then-caption check also reused the page after setup changed the card in another browser: some selector timeouts/conflicts there are contaminated by stale setup state. The rerun driver now reloads an already-open Review Session before calling it fresh. Raw refusals remain in the results; no backend conflict guard was bypassed.

The initial apparent caption-note misrouting was refuted by waiting for the chosen step's `aria-current` state before typing and respecting the client's explicit About-part chip: six focused staff caption-note cases landed on the caption exactly once. Initial desktop client Delete failures were driver errors (missing hover); all six real-hover follow-ups passed. Initial SMM video approval failures omitted the offered resolution chooser; all six corrected cases passed. Review Session plain notes use its visible Just a note button; an exploratory attempt clicked its hidden Send button and is not product evidence.

The early complete runner stopped during setup because a startup refresh removed the floating status menu; its disposable card was archived through the app each time. Preparation now waits for settling and records a lost startup menu before reopening it. Those red attempts are not passing matrix evidence. The initial safety guard also blocked some read-only background endpoints, later explicitly allowed after source inspection. Initial browser exceptions and failed actions affected by those blocked reads remain unproven; a fresh read-only staff startup produced no exceptions in all three engines. Attempts to clear legacy links on pre-existing cards were deliberately blocked by the mutation guard; existing cards were protected throughout. Raw red observations are preserved alongside the focused corrections.

All 12 client/Calendar captures were visually inspected privately. They include scrolled phone positions and transient dimmed or missing approval confirmations; a persistent rendering defect from those states was not established. No screenshot containing real identities is published. The behavioral failures above prevent an all-clear visual or reliability claim.

## Final cleanup and evidence

The first cleanup driver observed the source card's Archived status and closed its browser before the app finished sequentially parking both native work items. A read-only query caught the resulting half-completed cleanup. This is a driver error, not a reproduced app archive fault. The same disposable card was restored and archived again through app controls; the corrected driver waits for independent native reads before closing. The card is Archived and both work items are Backlog. No raw SQL write was used to achieve that result.

Independent readback found all three original test cards unchanged, including their update timestamps. The archived disposable row retained 155 distinct active test-note bodies and zero duplicate bodies; that census does not turn the absent interrupted notes into delivered saves. The eight published runs retain 345 action/check observations plus their guard/setup/server/cleanup records. Their separate elapsed-time list contains 190 observations over three seconds, including intentional delay/disconnection, compound actions, recovery windows and driver timeouts. Those categories must not be reported as 190 ordinary slow saves.

The final native cleanup is recorded separately in the JSON with `nativeItemsParked: 2`. Source and native results were re-read after the app completed. This candidate has no migration or function deployment; reverting its frontend fragments and rebuilding is the way back. The live findings require follow-up/retest after the relevant repairs are deployed.

## Rerun

From the repository in PowerShell:

```powershell
npm install --ignore-scripts --package-lock=false --no-audit --no-fund
npx playwright install chromium firefox webkit
node scripts/build-index.js
node test/repair-checkpoint-browser.js
node --require ./test/helpers/single-file-index.js test/write-ui-writer-durability.js
node --require ./test/helpers/single-file-index.js test/write-ui-repair-races.js
node --require ./test/helpers/single-file-index.js test/write-ui-failure-messages.js
node docs/syncview-design/tests/prod-write-gateway-browser.js
node test/browser-guards-wired.js
node test/test-suite-routing.js
node test/ci-changes.js
node test/ci-runner-seats.js
node test/repo-map-sync.js
node test/index-modules-strip.js
node --require ./test/helpers/single-file-index.js test/index-build.js
node scripts/byte-pinned-line-ending-check.js
npm run check:index
```

Local module checking in this checkout used temporary parser dependencies:

```powershell
$checkpointParserRoot = Join-Path $env:TEMP 'checkpoint-c3'
npm install --no-save --no-package-lock --prefix $checkpointParserRoot acorn@8.15.0 eslint-scope@9.1.2
$env:NODE_PATH = Join-Path $checkpointParserRoot 'node_modules'
node scripts/check-modules.js
Remove-Item Env:NODE_PATH
```

The red full-local attempt is `npm test`. The accessibility comparison is `node docs/syncview-design/tests/prod-a11y-focus.js`; a local pass does not replace the hosted red result.

The intentionally red checkpoint baseline control is:

```powershell
$env:CHECKPOINT_SOURCE_REF='01e0f12156db90d1a5de20d6ad09cada758f309e'
node test/repair-checkpoint-browser.js
Remove-Item Env:CHECKPOINT_SOURCE_REF
```

For live reruns, `CHECKPOINT_LIVE_INPUT` names a private JSON file containing `identity` (the app's real stored staff identity), `link` (the test client review link), and `id` (an active disposable native card created through the app, named with `Checkpoint QA disposable`). `CHECKPOINT_LIVE_OUT` is a private output directory. Never place these values in the repository or command text. The script archives that card through the app in its finalizer. It refuses another client/link origin and aborts writes outside its card/native IDs. It never seeds or repairs rows with SQL.

```powershell
node qa/checkpoint-live.js
```

For a focused repeat, `CHECKPOINT_FOLLOWUP_ONLY` accepts `client` (caption draft, deletion, Finish and corrected SMM controls), `reviewer`, `offline` (all three roles), `staff` (fresh deletion/caption checks), `finish` (SMM approvals and Finish), or `cleanup` (archive an active disposable card and verify both native parks). Restore the disposable card through the app's Archived cards dialog before another run; do not reopen a production-linked row with SQL. The default runs all sections. Outputs retain failed cases and are private until inspected for publication. The final driver exits nonzero for failed action/server/setup observations; deliberate mutation-guard refusals are separately reported and never treated as successful writes.

The corrected focused interruption repeat used these selectors (private input/output variables still required):

```powershell
$env:CHECKPOINT_FOLLOWUP_ONLY='offline'
$env:CHECKPOINT_LIVE_CELLS='offline-smm-firefox-390,offline-reviewer-webkit-1440,offline-reviewer-webkit-390'
node qa/checkpoint-live.js
Remove-Item Env:CHECKPOINT_LIVE_CELLS
Remove-Item Env:CHECKPOINT_FOLLOWUP_ONLY
```
