# Review page reliability: Gauntlet Three, 2026-10-18

The owner reports that the new review page is live for every client as of 2026-10-18. This audit uses only the existing
offline browser fixture. It makes no live write, deployment, production-frequency or universal reliability claim.
Gauntlet Two's report and browser tests were read first; its five repairs are retained.

## Most serious confirmed problems, first

| Problem | One-line cause | Repair and regression |
|---|---|---|
| A client can silently replace a newer team caption while their editor is open. | Save used the caption/editor snapshot without comparing it with the current card. | Compare the editor's base with the current caption; ask before replacing it; Cancel keeps both versions. `caption changed by team while editor open`. |
| A caption can still be edited after the team approves it while the editor is open. | Edit eligibility was checked when opening the editor, not again at Save. | Recheck the current part before client caption/title saves; refuse clearly and keep the editor text. `caption approved by team while editor open`. |
| A refused caption could show a green Saved badge and no persistent visible failure. | The announcement helper also marked the step Saved, even for pending/failure text. | Only confirmed outcomes mark Saved; a refused caption has a visible persistent error and its editor text. The caption-refusal regression checks visibility and the absence of a Saved badge. |
| A client's unsent caption disappears on a post switch, reload, or refused save. | The stage closed/reset its editor and did not expose or persist the replacement text. | Per-post edit drafts, tab-scoped session storage, preserved base, and reopen the editor after refusal; duplicate saves wait. `caption editor survives post switch`, `caption draft survives reload`, `refused caption keeps editable words`. |
| Kasper loses an unsent message when switching posts; a refused note does not return to his visible message box. | Only client messages were stashed; the old writer restored a different draft from the stage's composer. | Stash stage drafts for each mode and restore the refused writer draft without replacing newer typing. `unsent note survives post switch`, `refused plain note is visible and recoverable`. |
| A refused change request removes its words from view. | The retry closure retained the text, but the stage's error renderer did not show it. | The refusal includes expandable, escaped unsent words next to Try again. Every part's `refused change` matrix case. |
| A refused plain client note can look like a sent message, without a retry in the conversation. | The stage ignored the existing outbox's pending/failed metadata. | Render the outbox state and retry the same note id; the plain-note regression asserts a visible retry and one stored note. |
| A refused Delete in Notes hides the note locally and says a native write is safe and will retry automatically. | The shared save watcher assumed every note change had a native acknowledgement, including legacy deletes. | Only an explicit native acknowledgement permits the saved-note message; otherwise show that the note change was not saved and ask the person to refresh/check. The dialog fault matrix checks the refused deletion and its message. |
| In Firefox and WebKit, Save can disappear between pressing and releasing it after a background refresh. | Focus-out applied a deferred redraw before click reached the control. | A pointer hold keeps the stage control until its click runs; the pending redraw settles afterward. The concurrent-caption regression reproduces the lost click. |
| Kasper cannot click Next post after the last approval at 1024 pixels. | The approval toast covers the button and intercepts the click. | Reserve space for the toast in the stage; the Finish test checks their rectangles do not overlap and clicks while the toast is visible. A separate Undo test verifies that Undo still works. This also reproduced in hosted Chromium. |
| Returning online after a refused write can raise an unhandled browser error. | Lifecycle listeners started a rejecting recovery promise without a rejection observer. | Record the rejection without consuming the original promise or dropping journal work. Interrupted-change stress reproduced 14/30 failures before, 0/30 after. |

The first two caption fixes, the two message-loss cases and the concurrent-caption case also reproduce against the
baseline page source with `G3_CACHE_REF=origin/main`. The refusal-copy/outbox status display is shared with the stage's
existing note outbox; retries keep the original note id.

## Action inventory and test ownership

`matrix` below means `test/review-stage-gauntlet3-browser.js`, the actual browser handlers and mocked transports.
The stage and the shared Notes dialog are distinguished because their controls and save paths differ.

| Person | Action | Tested by |
|---|---|---|
| Client | Approve video, thumbnail, caption | Each part's `approve` matrix case; backend row checked |
| Client | Approve an engaged YouTube title | `G3_TITLE=1`, `approve title` |
| Client | Ask for a change to each of those four parts; Enter sends | Each part's `change` matrix case; saved note body/id and status checked |
| Client | Send a plain note about video, thumbnail, caption or title | Each part's `note` matrix case; exact body/id and unchanged status checked |
| Client | Change my mind after a part was approved | `status-moved change` and Gauntlet Two's kept-part/late-note cases; approval must remain approved |
| Client | Edit caption; cancel; return to edit; save; reload an unsent edit | Caption-edit matrix and named caption regressions; concurrent replacement cancellation checked |
| Client | Suggest a replacement YouTube title | `G3_TITLE=1`, `title-edit`; sends a change request, never renames the card |
| Client | Reply to and delete a note | `Sheet Notes dialog reply and delete`; real hover/click, parent id and reply tombstone checked |
| Client | Reply to and delete an own note in the shared Notes dialog under faults | `Notes dialog <condition> reply/delete`; exact body, parent/id, refusal text, draft retention and unchanged part statuses checked |
| Client | Edit an own note in Notes, where offered | The legacy fixture has no Edit control; the `edit` cases assert that absence and zero writes. Canonical `can_edit` capability coverage remains **UNPROVEN** |
| Client | Switch post; switch part; return to typed words | Per-post draft regressions, `step` in every matrix action, Finish auxiliary case |
| Client | Finish reviewing; continue to the next post | `Finish waits for parts and moves once; part switching`; next post's statuses checked |
| Client | Cancel a request, Escape, arrows, navigation/history, player controls, theme, help | Existing Gauntlet Two and finish-polish suites retained; no claim these existing Chromium cases were newly run in all engines |
| Kasper | Approve video, thumbnail, caption or engaged title to the client | Each part's `approve` matrix case; thumbnail fixture has a native work item |
| Kasper | Ask for a change to each part | Each part's `change` matrix case |
| Kasper | Approve after tweaks, with his words | Each part's `after-tweaks` matrix case, title under `G3_TITLE=1` |
| Kasper | Tweaks are on Frame | `frame video`; exact existing message checked |
| Kasper | Team-only plain notes on each part | Each part's `note` matrix case, draft/refusal regressions |
| Kasper | Switch posts and parts while composing | Per-post draft regression and every matrix action's part switch |
| Kasper | Finish / Next post after the last approval | Finish auxiliary; the existing approval writer can remove a fully approved card before Finish, so Next post is also exercised |
| Kasper | Undo an approval | `approval Undo stays reachable`; the actual toast button restores the previous part status |
| Kasper | Edit a caption; reply/delete directly in the stage's conversation | **Not offered by this stage.** No caption edit, Reply or Delete control is rendered there. The shared Notes dialog is tested separately on the client link |
| Kasper | Queue/With editors, Ping editor, sample cards, Messages navigation | Existing stage suites own these; **not expanded into the full new fault matrix** |

## Matrix and limits

Chromium, Firefox and WebKit at 1024x900, 1440x900 and 1920x900. The primary matrix applies ordinary writes, a 5-second
delay per write, explicit 403 refusal, interruption before delivery, lost acknowledgement after a card commit, repeated
clicks, two independent tabs sharing one mocked backend, a session advanced 16 hours, a new asset address, a status moved
by the team, long mixed-script/emoji text, and a missing video. Normal cards have three parts; title mode engages a fourth.
Controls that disappear because a part is no longer reviewable are checked as unavailable with zero writes.

The fixture models native receipts by request id and the card endpoint's comment-id union. Its status/read responses
were extended because the old fixture could not exercise native recovery. That is **mocked contract evidence**, not an
independent test of database transactions, live permissions, provider notifications or deployed functions.

All 237 distinct codes enumerated from the page's refusal tables are rendered through the real copy functions and
notification overlay, with the draft checked after every code. This is **message/draft evidence**: it is not the full
Cartesian product of every action with every backend code. The action matrix injects a real mocked refusal separately.
Likewise the overnight test advances browser clocks/timers; it is not a physical overnight soak or an expired real login.
Two tabs use independent contexts and a shared mock server; they do not prove every same-origin storage race.

The Windows WebKit text-entry driver also timed out on the long mixed-script payload in a bare textarea, with no app
loaded. Native keyboard insertion completed and matched every character there. Long-text cases therefore focus/select
the real editor and use native text insertion in all engines, still checking the input and stored body byte for byte.
No input/serialization assertion or browser case is skipped.

The old-cache control substitutes the baseline stage source while retaining the current shared writers. It reproduces
the old UI bugs and remains red by design. A frontend PR cannot repair code already executing in an old tab; the fixed
page must be loaded. It does not represent every historical bundle/core combination.

Not established: a literal no-failure guarantee; every error code through every save handler; every dialog action under
every fault; a real asset revision/CAS race before the next read; sample-card fault parity; expired real credentials;
live delivery or production database exactly-once behavior. These gaps stay **UNPROVEN**, not passing.

## Rerun

From the repository in PowerShell (Playwright 1.56.1 installed):

```powershell
node scripts/build-index.js
npx playwright install chromium firefox webkit
node test/review-stage-gauntlet3-browser.js
$env:G3_TITLE='1'; $env:G3_MODE='matrix'
node test/review-stage-gauntlet3-browser.js
Remove-Item Env:G3_TITLE, Env:G3_MODE
```

Narrow reruns use `G3_ENGINES=chromium|firefox|webkit`, `G3_WIDTHS=1024,1440,1920`,
`G3_MODE=regressions|matrix|auxiliary|refusals|dialogs`, `G3_CONDITIONS`, `G3_ROLES`, and `G3_ACTION`.
`G3_REPEAT=10`, `G3_MODE=matrix`, `G3_CONDITIONS=drop-before`, `G3_ROLES=kasper`, `G3_ACTION=change` repeats the recovery
race. `G3_CACHE_REF=origin/main`, `G3_MODE=regressions` is the intentionally red cached-source control; unset it afterward.
No environment selector alters existing suites or CI checks. The new CI job runs all nine engine/width cells and title mode.

Final check receipts are recorded in the PR body after execution. No merge or deployment is performed by this session.
