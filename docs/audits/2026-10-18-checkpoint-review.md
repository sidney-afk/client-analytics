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

The 2026-09-23 comment in `170-calendar-links-status.js.part` fixes a redundant gateway pass after a committed source write. It does not protect the asynchronous journal lifetime above. The precise scheduling of the owner's historical live incident is not independently established by these mocked reproductions.

## Candidate proof

The all-engine focused suite has **69 passing cases**: 33 checkpoint/storage cases and 36 page-control cases (client and SMM, desktop 1440 and phone 390; note, video change, graphic approval). It uses real browser localStorage and Web Locks; backend transport is fictional. Every note is checked for one exact body and statuses are checked against the mocked stored row. Native receipt/read responses are explicitly represented; an empty authoritative read remains a refusal.

The baseline negative control reads the two production fragments from `CHECKPOINT_SOURCE_REF`; page-control cases still use the built candidate. Baseline failures are evidence for the extracted actual checkpoint functions, not a claim that the candidate UI bundle was main. Original red exploratory receipts are retained privately. No assertion was removed to make them pass: the existing durability/race harnesses load the new ownership helpers and still execute their original assertions.

## Live pass

In progress. The live runtime flag was read as all clients enabled. The app's Share with client action issued the designated test link using an existing verified local staff identity. A disposable native card was created through Create post, with its own two native work items; existing cards were read only. Media/caption setup and status changes use the app. Database checks use the existing scoped read helper or read-only query tools.

Early independently read results: one video note, one caption edit and two distinct simultaneous-tab notes each landed once. Explicit About-caption selection attributed a note to the caption once. An earlier apparent attribution failure was refuted: the composer retained its explicit About-video choice. Unsent client message text survived reload. The bundled Chromium player rejected the copied live MP4 with media error 4; no media response was replaced.

The early complete runner stopped during setup because a startup refresh removed the floating status menu; its disposable card was archived through the app each time. The corrected preparation waits for settling and records a lost startup menu before reopening it. Those red runs are not passing matrix evidence.

## Rerun

From the repository in PowerShell:

```powershell
npm install --ignore-scripts --package-lock=false --no-audit --no-fund
npx playwright install chromium firefox webkit
node scripts/build-index.js
node test/repair-checkpoint-browser.js
node --require ./test/helpers/single-file-index.js test/write-ui-writer-durability.js
node --require ./test/helpers/single-file-index.js test/write-ui-repair-races.js
node docs/syncview-design/tests/prod-write-gateway-browser.js
npm run check:index
```

The intentionally red checkpoint baseline control is:

```powershell
$env:CHECKPOINT_SOURCE_REF='01e0f12156db90d1a5de20d6ad09cada758f309e'
node test/repair-checkpoint-browser.js
Remove-Item Env:CHECKPOINT_SOURCE_REF
```

For live reruns, `CHECKPOINT_LIVE_INPUT` names a private JSON file containing `identity` (the app's real stored staff identity), `link` (the test client review link), and `id` (an active disposable native card created through the app). `CHECKPOINT_LIVE_OUT` is a private output directory. Never place these values in the repository or command text. The script archives that card through the app in its finalizer. It refuses another client/link origin and aborts writes outside its card/native IDs. It never seeds or repairs rows with SQL.

```powershell
node qa/checkpoint-live.js
```
