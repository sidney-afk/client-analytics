# One card, many versions: the plan (session Trialplan, 4 Nov 2026)

**Plan only. No code, no migration, no deploy, no data change.** Plain English.
**Status: revision 17, 5 Nov 2026 (decisions recorded 6 Nov). Review round 6 (section 26) is applied: "the card's version" (`card_letter`) is now carried through the whole plan, the board and SyncLinear write paths are corrected, and the work item carries only the route value.** Sidney's S-B and S-C stay as recorded (section 23); the one-sheet-per-surface checks are in section 24. **Sidney answered Q-S, Q-T and Q-U on 6 Nov ("yes to all"); they are recorded as decided in section 9. Nothing is open for Sidney.**
Counts quoted from earlier measurements are dated; step 1 below re-measures them before anything is built.
The only live read was one counts-only query on the version table (section 7.1). What was read: STATE_OF_THINGS, OPEN_REPAIRS 688 (parts 1 to 3), 656/657/659/661, ATLAS "Trial reels", `src/index/189`, `194`, `245`, `299`, the `trial-reels` Edge Function (`logic.mjs`, `index.ts`), the three trial migrations, draft plans #2521, #2524 and the design-options PR #2581.

## 0. What Sidney asked, in his words

"The toggle of A, B, C is to switch versions, and the elements of the card change, so it's easy to manage a trial: just a card with different versions, each with its own video link, thumbnail link, caption, call to action. Notes would have a toggle too. Each version would have its own statuses for its components, and we need a way to view those statuses without changing the toggle."

## 1. What was misunderstood last time, and how this plan avoids it

**What shipped (688):** the A/B/C tabs on the Calendar card are **read only**. Picking B shows B's link, picture and caption in place, but nothing you type goes to B. B is still edited in the old dropdown list under the Video field, the trial switch stayed where it was, and a version with no thumbnail of its own quietly shows the card's.

**Why it went that way:** the design step (#2581) was agreed as "the tabs are a front-end change; nothing new in the backend." That sentence was true of a *display*, and wrong for what Sidney meant. His mental model is "the whole card is a view of one version", which needs three things the first build did not have: edits that follow the tab, a call to action and component statuses per version, and a quiet way to see all versions' statuses.

**How this plan avoids a repeat:**
1. A **clickable mockup of the final card** (every state in section 4 below) is built and approved by Sidney **before any build PR**. It is step 0 and nothing else starts until he says yes.
2. One rule is written down and tested, not implied: **"Whatever you see on the card while a tab is selected is that version's, and whatever you type goes to that version."** A test fails if any field on the card shows or writes another version's data.
3. Every build step names what Sidney can click afterwards, on the test client only.
4. No fallback is silent. A version with no thumbnail says so (section 7).

## 2. The model

### 2.1 What exists today (from the code and migrations)

- A trial card is a normal calendar card plus a switch row (`trial_reel_cards`: enabled, winner letter) plus one row per version in `studio_trial_versions`.
- **Version A is the card itself.** Its row exists (marked `on_card`), but its link, thumbnail and caption are the card's own. Only B, C, and so on use the version columns for thumbnail and caption (null means **inherited from Version A**, 3.3).
- A version row holds: letter, the Frame link, one overall `status` (waiting, approved, change asked, dropped, on trial, winner, lost), three approval stamps (SMM, Kasper, client), a change note with `change_part` (video, thumbnail or caption), a revision counter, an unused `hook` text, and the new `thumbnail_url` and `caption`.
- **There is no call to action per version**, and **no per-part status per version.** A version has one status. 688 part 1 chose "one Approve per version covers its parts"; a per-part approve was left out because it needs a migration.
- A normal card has `status` plus `video_status`, `graphic_status` (the thumbnail), `caption_status` (and `title_status` for YouTube). The call to action is a plain text field (`cta`) with no status of its own.
- Notes belong to the card. A note written while a version is on screen is named "Version B: ..." (a text prefix), and the Notes view has a Video switch that only changes which video plays.

### 2.2 The model to build

**One card. Versions are slots A, B, C ... (the function allows A to G; keep that).** Each version carries the same five things:

| Per version | Where it lives |
|---|---|
| Video link | already per version (A's is the card's) |
| Thumbnail link | already per version (A's is the card's) |
| Caption | already per version (A's is the card's) |
| **Call to action** | **new**: `cta` column, same rule: empty means inherited from Version A |
| **Component states: Video, Thumbnail, Caption** | **new, per part, in one nullable `parts` column on the version row** (review M1): each part keeps its own approval stamps (SMM, Kasper, client) and its own change note; the status **words** are derived from the stamps, as the video's are today. Null means "the whole version follows its one status and stamps", today's behaviour. `placeOf` (which reads the card status today) **must not read the route value on v2**, which breaks the circle where the route value, built from the versions, fed back into them |
| Notes | see section 5 |

**Rule for an empty field (Sidney: yes, 4 Nov; S4):** each version has its own caption, image and call to action. An empty one **inherits Version A's** (3.3), so old trial cards keep working, and the screen says "Using Version A's thumbnail · follows A's approval" with a one-click "Give Version B its own" (which starts that part at For SMM Approval, 16.4). It is never silent.

**A trial card has no status of its own (Sidney, 4 Nov): this is a visual rule.** Only versions have statuses on screen. The review (section 12, finding 1) showed that the *stored* card status cannot simply go away: the SMM tab, Kasper's queue, the client link, the Today page, `trial-reels` itself, Production's status sync and the drift check all read the card's `status` and `video_status` as their routing key. So:

- **On screen:** no card status pill on a trial card. The part pills belong to the selected version. The trial strip says "Trial · 3 versions".
- **Stored, hidden, system-written: a route status.** The card's own status columns stay and keep meaning what they mean today to every old reader. On a trial card they are a **route value** written by one function (today the page writes the "Approved once every version is approved or dropped" move; this plan gathers that into one tested writer, `routeStatusFor(versions)`). Nobody edits it by hand and no screen shows it as the card's status. It also carries the post's state (Scheduled, Posted), see below.
- **Queues stop depending on the route value** (build step 1b, before any visible change): for a trial card the SMM tab, Kasper's queue, the client link, Today (`097`, `_tdyTrialAsks`, which today reads only work items at SMM, Kasper or Client approval) and `trial-reels`' own reads decide "does this wait on me" from the **version rows, whatever the route value is, Scheduled included**. The review boards already do this per version (688 part 1); the remaining readers (`195:1640-1660`, whose overrides fire only when the card is at Kasper, Client or Tweaks; `190:2435, 2620, 1112`; `097:359-392`; `trial-reels index.ts:160, 250, 543, 638, 643, 676`; and Kasper's old shared core in `305`, which writes a card's caption, thumbnail and CTA with no trial awareness) get the same treatment. This fixes two cases: "A is Approved while B waits on the SMM, and B vanishes from the SMM tab", and a version that **staff** send back after the card is Scheduled (S1: the client cannot), which today reaches no queue at all because B to E have no work items and the route value never leaves Scheduled. **Test:** card Scheduled, staff send Version C back, C appears in the SMM tab and on Today, and the Production work item stays Scheduled (Q-Q). After 1b the route value is only for Production, the drift check, filters and old readers.

**Turning a trial on converts the card's data into Version A:**
- **Fields stay put.** A's link, thumbnail, caption and call to action stay in the card's own columns; the page reads them as Version A's. Nothing is copied.
- **One rule for part states (review H2, M1): they always live in the version rows, A included, as per-part stamps and notes (the `parts` column), with the words derived.** The card's own status columns hold **only the route value**. Cards already switched on never "switch on" again (38 are on today), so A's `parts` are ****not filled from the card's columns** (review M1a): A's row already has its own stamps, and `parts` null means "follow the version's status and stamps", so nothing is copied; **only the 2 enabled cards that have no A row get one seeded**, at their first v2 read. **Switching the trial on again copies the card's part states into the card version's row only if the card changed while the trial was off**, known because the card's `updated_at` is stored at switch-off (a new `card_updated_at_off` on the switch row, read by the server as the last step of `switch_set`; the order and the recovery are in 16.6, and what the copy writes is in 23.1), and **switching off never lowers a Scheduled or Posted card**: it sets the card's columns from A's row only while the card is before Scheduled.
- **Cards in flight when the flag reaches a client (Q-P, answered; review M4; S7):** a nullable `rules` column on `trial_reel_cards` (`'v1'` or `'v2'`), **decided on the first read under the v2 flag (an only-if-null write)**, from the card's state at that moment (Sidney does not know when it goes live, so no list is fixed today): a card that is already **Posted, or has a version on trial, or is already Scheduled** gets `v1` and keeps today's behaviour exactly (including the automatic start from Posted); every other enabled card gets `v2`. (Scheduled counts as `v1` because the Schedule gate cannot be applied to a card retroactively; this one line is my engineering default, not Sidney's, and step 1a re-checks it.) Today's four real cards that are mid-review (2 In Progress, 2 at Kasper; none Scheduled) would get `v2` if the flag were turned on now, as Sidney said (S7). A card enabled afterwards gets `v2`. Everything in this plan applies only to `v2`. The one real Posted card stays `v1` and nothing has to be done to it. The test-client trial cards are deleted by Sidney through the app (no SQL; OPEN_REPAIRS 373).
- **Notes** are not rewritten (section 5).
- **No new `calendar_posts` columns.** A's call to action is the card's existing `cta`; A's part statuses are in its row. This matters because `calendar-upsert`'s allow-list is frozen (review, low 12).

**The route value, precisely (rule sheet in step 1a), and who may write it (review H6, M8, M13):** per part, in the order In Progress, Tweaks Needed, For SMM Approval, Kasper Approval, Client Approval, Approved, over the **counted** versions (live and **not passed by the client**, below). **Before a person schedules the card:** Tweaks Needed on any counted version wins, otherwise the least-advanced counted version sets it, and all Approved gives Approved. **Once a person schedules, the writer does not move the card again until the winner** (so "Tweaks wins" never fights "Scheduled stays"). **On an open trial, Posted is set only by the winner pick; a trial that is closed or can never start is an ordinary card (21.1).** There is **one writer**, `routeStatusFor`. Today at least these write the card's status directly and **must go through it**, with a test that fails on any bypass (step 1b): `_rsTrialToTweaks`' Kasper branch (`195:3724-3733`, which also calls `_calClearStaleApprovals`) and its non-Kasper branch, `_calApplyAutoStatus(m.id,'client_added','video')` (`195:3735`); Kasper's **Approve after tweaks** (`_kasperApproveAfterTweaksComp`, `195:3868`, writes `video_status` and `kasper_approved_after_tweaks`) and his **Undo** toast (`_rsL2UndoArm`, `195:3769`, `4621-4643`, which reverts only the card part, so it must also undo the version stamp); the **client's caption edit** (`195:2747`, `_rsSaveEdit`, `195:4240-4275`; on a v2 trial card it becomes "Ask for a change" on that caption part, so a client edit never lands on several versions that inherit it); `svCalResolveVersionTweaks` (`195:3744`); the bulk "Write captions for several cards" job (`180:2051`); any change with `after === 'tweaks'` including **Redo** (`195:3833, 3867`, card-level `_kasperRequestTweakComp`, which today sets the CARD to Tweaks Needed for a Redo on one version); a card approve with `after === 'move'` (`195:3843`); `_rsTrialCoverParts` (`195:3782-3796`, which stamps the card's graphic and caption Approved whichever version was approved); the **status bridge** (`2026-10-01-calendar-overall-status-bridge.sql:143-230`); and Kasper's old shared core (`305`; `305:439-441` is `_kasperJudgeConflict`, and the split card and version writes are in `195:3738-3768`, where the writer must reconcile them).

**The work item carries the route value, never one version's state (review H4).** Production's video and graphic work items follow the route value and nothing else. The writer stores the last route value it pushed (`route_written` on the switch row, 7.1). **A work-item status that differs from `route_written` is a person's move. It never changes any version's parts.** The card follows it through the bridge as today, so there is no drift. The strip says one line: "Production moved the video to For SMM Approval; the versions are unchanged"; after Scheduled it says "Production moved the video off Scheduled; the trial will not start until it is Scheduled again". The route writer pushes again only on the next version change. The editor's right action stays "New cut ready" on the version's row (3.6, step 5b). Step 1a tests both cases on a throwaway **linked** card.

**The client's "Not this one" (review H1).** A version the client passed on (`client_pass_at`, 12 today) keeps the status 'waiting', so it is **not approved and not dropped**, and the gate would never pass. The plan counts versions as **counted = live and not passed** everywhere: the Schedule and Start gate, the route value, the pips and the grid, and "at least two live". The grid shows "Client: not this one" for it, and the strip says "Version C was passed by the client: drop it or ask again".

**Posted is not used by a trial card before its winner (revision 5, 3.4).** A person schedules the card (Scheduled) once every version is approved or dropped; on the card's date it goes on trial automatically; the winner takes **Posted** when picked. "Trial" is a status on the *versions* and a clear label on the strip, so no new card status is needed and no Section 4 status map changes (Q-M asks if he wants a real card status instead). Version menus stop at Approved; "On trial" is set only by Start trial or the date.

**What every reader of a card's status shows for a trial card (full inventory is step 1):**

| Reader | Shows for a trial card |
|---|---|
| Card (staff) | No status pill; the version's part pills; the trial strip with a Trial label, Start trial, Trial running and Pick the winner |
| Month and Week | Before a winner: one dot per live version, its least-advanced part. After a winner: one ordinary card, the winner's, no dots |
| SMM Review tab, Kasper, client link, Today | Decided from the version rows (step 1). A card stays in a reviewer's queue while any live version waits on them, whatever the other versions say. The client's queue lists per version; the card stays while any version waits at the client (Q-D) |
| Production (parent issue, work items) | Follow the route value, as today. B to E have **no work items**, only one "Deliverable file" row each; **this must stay true** (the drift check is safe only because of it; step 1 adds a test that fails if a version row ever gets a work item). The parent shows "Trial · N versions" with dots (Q13) |
| Calendar status filters and counts | A trial card matches a status filter if **any** live version has it; counts are by version (Q16) |
| Drift check (card against work items) | Unchanged. Verified on a throwaway, unlinked test card, never on a card linked to Production work items (standing rule) |
| Post tab "From a card" | Lists a trial card's versions by their own approvals |
| Analytics | Per-version rows already exist; unchanged |

**When the trial ends or is switched off:**
- *Switching the trial off (Sidney, S-B, 5 Nov):* allowed at any time, running or not, with or without a winner. The dialog asks which version becomes the card (default "Keep Version A"); the chosen version becomes the card by the same swap machinery and marker as a pick; the others are kept hidden; the card is an ordinary card with its normal status pill; switching back on restores the versions and the trial can run again. Full definition in 23.1.
- *After a winner (Sidney, 4 Nov ~21:15: "if B is the winner, it becomes the default of that card"):* the card becomes an ordinary card made of the winner's fields and statuses (3.3); switching the trial off then keeps the winner as the card and hides the others (23.1).

**Why not make each version its own hidden card?** Considered and rejected. It would put every version through the status sync, the drift robot, Production work items and Month and Week, and it touches the three Section 4 functions. The current design (one card, version rows beside it) keeps all of that untouched.

**How many versions: up to five, A to E (Sidney, 4 Nov).** *Assumption to confirm:* he wrote "ABCDF"; this plan reads it as five versions, A to E. The function today allows A to G. Existing rows, counted live on 4 Nov (counts only): A 60, B 59, C 46, D 14, E 8, **F 2, G 1**, and **all three F and G rows are already dropped** (none live). So a cap of five **hides nothing anyone uses**: the three dropped rows stay in the table and in history, are not shown as tabs, and can still be read by the function. The cap applies to adding, so "+" stops at E. The cap is enforced in more places than the function: `trial-reels logic.mjs:7`, the AI editor's writer `higgsfield-mcp/trialreels.mjs:45`, and the version-name regexes in `189` and `194`. Step 2 moves **adding** to A to E in every one of them; the table's own check (`letter ~ '^[A-G]$'`) is left alone, so no migration is needed for the cap and old F and G rows stay valid. Worst case if the assumption is wrong: a cap of seven is a one-line change.

**The card's version is `card_letter`** (7.1, 23.1): the version whose link, thumbnail, caption and call to action are on the card. It is A until a pick or a switch-off choice changes it. **Every rule in this plan that says "A" while meaning "the card's version" means `card_letter`.** Where it really means the first version (inheritance, 16.4), it says "Version A" on purpose.

**Dropping the card's version (Q-T, decided by Sidney 6 Nov):** the button stays, with a one-line confirm, "Dropping Version A makes Version B the primary version (the one on the card).". It is a proper swap using the switch-off marker (23.1, `direction = off`), never a bare link move. Today's bare link move (`svTrialReviewDrop`, `194:789-814`, shown by `194:741`, through `svTrialMoveCard`, `189:1054`) is removed. If no other live version has a link, Drop on the card's version is refused with a plain line.

**Inheritance after the card's version changes (Q-U, decided by Sidney 6 Nov):** an empty field keeps inheriting **Version A's** value, as Sidney said in S4. The card's version moving changes nothing silently. A's value is read from the card while `card_letter` = A, and from A's row otherwise. `readShape`'s `effective` and `effectiveFields` (`logic.mjs:617`, `725-729`) and the client link (`194:392`, `401-408`) change for this in step 3 (not later): they must not fall back to "whatever the card holds".

## 3. The card UI

### 3.1 The switch is the main control

- **Where:** directly under the card header, above the picture, full width: `Version A  Version B  Version C   +`. The selected tab is underlined (the Quiet look Sidney chose on 3 Nov).
- **What follows the tab:** the picture, the Video link row with its status pill, the Thumbnail row and its pill, the Caption box and its pill, the Call to action, and the Notes button. Switching saves nothing. Typing saves to the selected version only, with the card's usual save indicator.
- **A card-level strip stays put** above the tabs: trial switch, date, platforms, and the trial actions (**Schedule**, **Start trial**, **Pick the winner**, **End the trial without a winner**) with the Trial label. It shows no card status pill and no "overall status". It never changes when you switch tab, so you always know what is card-wide.
- The status pills on each part use the card's own menu, wording and permissions exactly (Sidney's D1, 2 Nov): In Progress, For SMM Approval, Kasper Approval, Client Approval, Tweaks Needed, Approved. Scheduled and Posted stay card-level.
- Keyboard: left and right arrow move between tabs; Enter opens; the tab group is one tab stop.

### 3.2 The old dropdown list

**It goes** once the tabs are editable (step 5), because everything in it moves onto the card. What it did, and where it moves:

| Old list | New home |
|---|---|
| Paste or change a link, New cut ready | the Video row of the selected tab |
| Thumbnail and caption lines | the card's Thumbnail and Caption of the selected tab |
| Drop / Bring back | a menu on the tab (the three dots) |
| Winner | "Pick the winner" in the trial strip, available while the trial runs (3.4) |
| + Add version and Import from Frame | the `+` at the end of the tabs; Import from Frame inside it |

Until step 5 lands, the list stays and the tabs remain as they are, so nothing breaks half way.

### 3.3 Adding, dropping, bringing back, picking a winner

- **Add:** `+` offers the next free letter, empty, and selects it. An empty version shows "No link yet" and cannot be sent for review (as today).
- **Drop:** tab menu, "Drop Version C". The tab stays visible but muted with "Dropped" and a Bring back button, so it is never a surprise that it vanished. (Today a dropped version has no tab; changing that is Q7.) If the dropped version was the one on screen, the card moves to the nearest live tab and says so in one line.
- **Winner (Sidney, 4 Nov ~21:15): the winner becomes the card.** His words: "once we have a winner, then it would be on that toggle by default... if B is the winner, then it kind of becomes the default of that card... even if he toggles back to another thing, when it refreshes it is back onto that" and "that card behaves as if version B was the part, like all the other cards".
  - **Rule:** one version at a time is "the card's version" (`card_letter`, 2.2). It is A until a winner is picked or a switch-off chooses another, then that one. **The card's version keeps its link, thumbnail, caption and call to action in the card's own columns; every other version keeps its own in its row. Part statuses never live in the card's columns (they always live in the rows).** This is today's rule for A, made general (the function already has `mainLetter` and `on_card` for it).
  - **Picking the winner swaps four things, and only four: link, thumbnail, caption and call to action.** The winner's go onto the card; the old card version's (A's, or whichever `card_letter` named) go into that version's own row, so nothing is lost. The winner becomes the `on_card` version. **Part statuses never swap** (they always live in the rows); the card's route value becomes Posted at the end.
  - **Why a real swap and not "read the winner's fields on screen":** the review showed that Production's sync, the drift check, the client card, `post-source`, Post for Me and the three Section 4 functions read the card's columns **on the server**, where a page helper cannot reach. If the card's columns hold the winner's data, every one of them is already right and none changes (no fingerprint re-pin). This is the mechanism for the Opus review to challenge. The first draft proposed "no copy, the winner only highlighted"; Sidney's answer on the same evening (card behaves as the winner everywhere) made that unworkable.
  - **Clear the winner reverses the swap with the data as it is now.** If B was edited after the pick, those edits go back to B's row and **the version named in `swap_record.before.card_letter`** (A, or B if the card's version was B before the pick) gets its four fields back on the card; Clear sets `card_letter` back to that value, never blindly to A (the code's `undoWinnerPatches`, `logic.mjs:584`, which takes the first live letter, changes to read `before.card_letter`). There is no saved snapshot to go stale. `production-write` lets an SMM and an admin make any move, Posted back to Scheduled and Unschedule included (`policy.mjs:324`, `390`), and the status bridge keeps the stamps on both moves (`2026-09-18` migration, `:218-225`); step 1a re-checks this on a throwaway linked card. All 5 existing winners are on the test client (review count), so they are reset and there is no special case for old winners.
  - **The tab:** the winner's tab has no mark of its own (Sidney: it just shows Posted, that's it), **the card opens on it by default, and a reload returns to it** even after someone looked at another tab. Other tabs stay viewable. Before a winner the card opens on the card's version (A unless a switch-off chose another), and no tab is remembered (Q9: no).
  - **The write order (review H2 and H4, and the writers it really uses):** the video link is `deliverables.file_url`, shown as `asset_url`, and the thumbnail is shown from the graphic work item when the card has one (6 of the 38 do), so the swap is **several separate writes across three writers, none of whose source changes** (no re-pin). **A reload, a closed tab or a sleeping phone in the middle must not half-swap the card or lose A's fields** (today the rollback lives only in page memory, `189 _trlCardFieldsBefore`, and after the link write `mainLetter`'s "carried" rule, `logic.mjs:240-242`, silently makes the winner the card's version even if `winner_set` never ran). So: **(0) first, the `swap_record` marker (with `before`) is written on `trial_reel_cards`, and only then the current card version's four fields into its own row** (explicit values, never null, and explicit only where the previous `placed` record shows they were its own; fields that were inherited stay inherited, see 16.3) (review M5, so a second page cannot slip in between); (1) the **link** through `production-write` operation `attachment` (with its `updated_at` check, `189:921-965`); (2) the **thumbnail** through the graphic attachment when the card has a graphic item, otherwise a card save; (3) **caption and CTA** by card save; (4) `trial-reels` `winner_set`; (5) the **Posted status last**, as the card's normal status save with **all three parts** (video, graphic and caption): the bridge and the page set the card's `status` to the worst of the three (bridge `:209`/`:226`, `_writeUiApplyOverallStatus` `170:1682`, `1767`), the work-item `status` operation moves only video and graphic, and the page sends video and graphic in parallel with `allSettled` (`170:1703-1763`), so one can land and the other be refused. Video, graphic and caption are therefore **separate entries in `steps_done`**, and a half-landed save is resolved in the verify step. Posted is put together in `170:1703-1800`; `140:2180-2205` is the one-part push. The same applies to Clear's Posted to Scheduled and to Unschedule; (6) the marker's `state` is set to `done` (it is kept, 21.2). **While a marker exists, `mainLetter` follows the marker's target.** A staff read that finds a stale marker shows **"Winner pick did not finish: Finish / Put back"**, and either completes the remaining writes or reverses them from the marker. **Before step 1 the pick checks the link's state** (`link_states`); the attachment probe checks the link **being attached** (`production-write index.ts:5751`), so on a pick it is the winner's link, and it can refuse with `artifact_not_resolvable` (409), so the pick says so in plain words instead of failing at step 1. **The pre-check is advisory** (`link_states` probes only each version's video link, `index.ts:596-614`, never thumbnails, and its checker is a copy, not `probeAssetUrl`); step (1)'s 409 is the real guard.
  - **Inheritance and the swap (review H5; Sidney's S4: "by default a version should inherit the old main card thumbnail and caption, unless changed").** None of the 120 live B to E versions has its own thumbnail today, so inheritance is the normal case. **A version with no thumbnail, caption or call to action of its own inherits Version A's (the pre-trial card's), never "whatever the card holds".** Rule: `effective(V, field) = V's own value if it has one, else Version A's value`, where A's value is the card's column while A is the card's version and A's row afterwards. The swap therefore: (a) writes the current card version's four fields into its own row as **explicit** values (never null); (b) puts the winner's effective four values on the card, so a winner that inherited a field **posts with A's value, with no prompt**; (c) leaves the winner's row as it was (its inherited fields stay inherited, and now read A's row); (d) keeps every other version's inheritance pointing at A, so a loser never starts inheriting the winner's own thumbnail. **`swap_record` keeps the values the swap placed on the card until the winner is cleared**, so Clear can tell an edit made while B was the card's from an untouched copy: it writes a field into B's row as B's own **only if the card's value differs from what the swap placed**, otherwise B stays inherited; the previous card version's explicit values go back to the card. The earlier "ask once" prompt is dropped.
  - **Thumbnail revisions (review M10):** the revision baseline comes from the wrong file after a swap and there is no baseline after Scheduled (`_shared/thumbnail-revisions.ts:165-170, 461, 477`; each pick and undo mints a revision, `875-877`). The baseline is kept **per version** and a swap resets the watch.
  - **Step 1a also checks:**
  - **`trial-reels` changes (not Section 4, no re-pin):** `winnerPatches` stops refusing with `attach_first` and does the two-way move of the four fields; `undoWinnerPatches` becomes the reverse swap; `mainLetter`, `on_card` and `healMainPatch` follow the winner; the page's `svTrialPick` (`189:1486-1530`) is rewritten to the order above.
- **After a winner, everywhere** (Q-A, Q-B, Q-D answered): views, the client link, posting, Production and Analytics treat the card as an ordinary card of the winner. The client link shows only the winner. Month and Week show one ordinary card, no per-version dots. Posting offers the winner as an ordinary post; the other versions are not offered (Q15). Scheduled and Posted are the winner's (3.4).
- **The 5 winners that exist today** are all on the test client. They are reset (or left, they are test data); no special rule, and "Clear the winner" works on them like any other.

### 3.4 The trial flow: Scheduled, then Trial by the date or a button, then the winner

**Sidney's rethink (4 Nov ~21:30 and ~21:35).** The trial should start when the card's date arrives, as a Scheduled card goes to Posted today, and also by a button. Versions on trial show Trial. The SMM picks the winner, who gets Posted and becomes the card. His own picture of the SMM's job: "an SMM would start a trial reel, then put the card in trial status. Whenever he picks a winner he goes on SyncView and picks the winner. That's it." No reminders.

**The flow, one line per step:**
1. **Each version is approved** on its own (or dropped). A version needs all three of its parts approved to count as approved. **A version the client passed on ("Not this one") is neither approved nor dropped**: it is not counted, and the strip asks for a decision (H1, 2.2).
2. **A person schedules the card with a Schedule action in the trial strip** (a button, since a trial card shows no status pill), with its one date shared by every version. **Scheduling a trial card needs every live version approved** (dropped ones don't count), and at least two live versions (a trial of one is a plain post; turn the trial off instead).
3. **The trial starts in one of two ways only (Sidney, S2: "no, cause maybe some SMM will post from their phone"): on the morning of the scheduled date, or by the Start trial button. It never starts from the Post tab's send**, because the SMM may post from a phone and SyncView would not know.
   - **On the morning of the scheduled date (Q-N, stands):** from **06:00 US Eastern**, an on-read rule in `trial-reels` (`startIfPosted`, `index.ts:158` and `540`; the rule is "scheduled date on or before today in ET", never "equals today") marks every **counted** version that passes the gate **On trial**. No new function, cron job or vault key. Its history line is written by the **system**, not by whoever's browser made the read (review L8). A server-side failure there does not reach the browser refusal log, so the watchdog signal is named in step 1a.
   - **By the button Start trial** in the trial strip (SMM and admin), any time the gate passes, even before the date. This is the existing manual `trial_start` action.
   - **Re-solving review H2 under this rule (the simplest rule that works), with the third review's corrections:** being On trial changes nothing about posting or fixing until the winner is picked or the trial is ended, **and "On trial" is a lifecycle state, not an approval state** (16.1). The Post tab lists every v2 trial card while its trial is open and reads versions by their parts (16.6); an On-trial version stays editable and an edit restarts only the part that changed, without ever moving the version off On trial; the Pick refuses a version whose parts are not all approved; the only locks are the losers after the pick. No `sent_at` and no "mark as posted": SyncView does not try to know whether anything is posted.
   - **The end-of-day Posted robot gets a real skip, only while the trial is open (review H1 of the first review, and H9 of the second; "byte for byte" withdrawn).** `calendar_auto_posted_due()` (`2026-10-10-calendar-auto-posted.sql:208-247`) picks any card at Scheduled whose date has passed in ET and that has been quiet for an hour, then pushes Posted to Production. The fix is one clause in the due() SQL, written here once (review M12): `and not exists (a trial_reel_cards row for the card with rules = 'v2' and ( (enabled and winner_letter is null and trial_closed_at is null and (any version On trial, or at least two counted versions)) or swap_record.state = 'pending' ))`. **The pending-marker condition does not depend on `enabled`** (a switch-off sets `enabled = false` before `state = done`). **"At least two counted versions" counts versions, not rows, by `trial-reels`' own rules:** the client is matched without regard to case (`ilike`, `index.ts:235`) and there is one row per letter (`oneRowPerLetter`; duplicate "Video A" rows are documented, `logic.mjs:174-189`, and would make one version count as two). **Tests include a card with a duplicate A row (counts one version) and a switch-off with the marker pending.** So **a trial that ended without a winner, or a card down to one live version that never went on trial, falls back to the ordinary Posted robot**, while **a trial that is running stays skipped even if a drop leaves one counted version** (the strip then says "only Version B is left: pick it or end the trial"). A `v1` card is not skipped. **Test: a two-version trial running, drop B, due() does not list it.** **A held migration, live before step 4 reaches the test client.**
4. **Trial is shown clearly** (below). **No countdown, no hours.**
5. **Pick the winner**, any time while the trial runs (Q-K: yes, with a one-line confirm). The winner becomes the card by the swap in 3.3 and takes **Posted**; it is the default tab. **The others end as "Not chosen"** (today's `lost`, relabelled). A dropped version stays dropped.
6. **End the trial without a winner** is also offered, and it is new work (defined in 16.7): every On-trial version becomes `no clear winner`, `trial_closed_at` is set (so the Posted robot takes the card again), the client link shows only Version A, and the strip says so.

**What if some versions are not approved yet (Sidney's question).** Recommendation:
- **You cannot schedule the card, and you cannot press Start trial, while a live version is unapproved.** The gate is the answer to his Q-J: "only start a trial if all versions are approved or dropped". The fix for an unapproved version is to approve it or drop it.
- **A version sent back after scheduling** (a new cut, a change request) does not cancel the schedule. When the date arrives with a live version unapproved, **the trial does not start**: the card stays Scheduled, the strip says "Not started: Version C is not approved", and the trial starts by itself on the next check after C is approved or dropped. Nothing is ever started with some versions left out, so no version is silently excluded from a trial. **Two more lines (review L7, L8):** Today's quiet line also covers "date passed, trial not started (Version C not approved)", so a trial waiting on a version does not look stuck; and **switching on, or scheduling, after the date has passed starts the trial on the next read** (the morning rule uses "on or before"), which the strip and the mockup say plainly: "Starts now: the date has passed".
- Default: this. Alternatives (start with the approved ones and leave the rest out, or drop the unapproved automatically) are not recommended because a late version then cannot join and the batch is no longer one test.

**Where Trial shows (Sidney: "where would we say that it's in trial then?").** Recommendation: **no new card status; make Trial unmissable in three places the team already looks.**
1. **The trial strip on the card:** a status-style pill that reads **Trial** (replacing the pill that would read Scheduled) as soon as the versions are On trial, and **Posted** afterwards, nothing else (no "Winner: Version B" label and no trophy, per Sidney).
2. **Each version's tab:** its pip and a small "Trial" word.
3. **Month and Week:** the dot per version in a Trial colour, with "Trial" in its accessible name and tooltip; Production's parent line reads "Trial · N versions".

The stored card status stays **Scheduled** while the trial runs, and becomes **Posted** with the winner. This keeps Production, the status sync, the drift check, filters and all three Section 4 functions exactly as they are. **The alternative (Q-M): a real card status "Trial"** everywhere. It reads best, but it adds a status to every status list, map and filter, including Section 4's functions (so a fingerprint re-pin), and the robot's and Production's mappings. Not recommended unless he wants it.

**What changes against today (live for every client since 2 Nov; stays so until `trial_versions_v2` reaches them):**

| | Today | New (on `trial_versions_v2` clients) |
|---|---|---|
| What starts the trial | Once the card is **Posted** (the robot turns Scheduled into Posted at the **end** of the scheduled day), any read of the card puts every approved version on trial (`autoTrialPatches`, OPEN_REPAIRS 570) | **From 06:00 US Eastern on the scheduled date**, or a person presses Start trial; **never from the Post tab**. `autoTrialPatches` does not run for these clients. Non-trial cards still turn Posted at the end of the day, unchanged |
| What the card reads | Scheduled, then Posted at the end of the date | Scheduled, then the Trial label from the morning of the date (or Start trial), then Posted with the winner |
| The clock | `trial_ends_at` = start + 24 h; "On trial · 17 h left"; the winner is refused until then (`trial_not_over`) | No clock on screen. The winner can be picked any time. `trial_ends_at` left empty for new trials; old rows keep theirs |
| Unapproved versions | Whatever was approved at that moment goes on trial; the rest are left out | Cannot schedule or start with one unapproved; the date start waits |
| Losers | "lost" | "Not chosen" |
| Client link | Only the winner once picked | Unchanged |

**What Instagram does (my understanding; the review confirmed the code side and found third-party API documentation agreeing that sharing a trial reel to followers is not in Meta's API and is done in the Instagram app; no platform 24 h or 72 h window could be confirmed):** this repo posts trial reels with the manual setting only, so Instagram never shares one to followers by itself and has no 24 h end of its own; the 24 h was this team's rule. Picking the winner in SyncView does not change anything on Instagram. Sidney has decided there is **no reminder and no nudge**, so none is planned; the SMM's picture of the job above is the whole flow.

**One safeguard kept (cheap):** Start trial, the date start and Pick the winner each write a plain history line ("Trial started: Versions A, B, C", "Winner: Version B, chosen by <staff>"), so what happened and when can be read later.

**Risks:**
- **Two ways to start for a while:** clients on the switch use the new rules, others the old automatic start. `trial-reels` and the due() SQL branch on `trial_versions_v2`, and a test covers both. **Cards already Posted or already on trial when the flag reaches a client finish on the old rules** (Q-P).
- **The start (3.4)** is the morning rule or Start trial, as an on-read rule in `trial-reels` (no new function). Step 1a settles that it is idempotent (a card already on trial is not started twice), that it respects the gate on counted versions, the watchdog signal and whether either needs a fingerprint re-pin. The due() skip applies only while the trial is open (3.4), so a trial that ended or has one live version falls back to the ordinary Posted robot.
- **A card can become Scheduled or Posted another way** (a Production work item or SyncLinear moved through the status bridge). **The gate must hold on the server**, not only in the button: a v2 trial card that arrives at Scheduled with a live version unapproved does not start a trial; one that arrives at Posted does not start or end a trial or hide versions. Both are ignored for the trial and **warned about on the strip**. Step 1a lists every way in for both words.
- **A trial that waits for an unapproved version** needs a clear strip message, or it looks stuck. It is in the mockup.
- **Every reader of the 24 h** (the card's countdown, the Production line, the nightreel check, `trial_not_over`, the journey tests) must stop expecting it; step 5 owns this with its tests.
- **A version that is the only live one** after drops: trial cannot start (needs two). The strip says so.
- **Winner shown as Posted on SyncView while the reel is still trial-only on Instagram** is accepted by Sidney's description of the SMM's job; no reminder is built.

**Questions for Sidney: all answered** (Q-G and Q-H were dropped; Q-I to Q-O are recorded below).
- **Q-M.** **Answered:** yes, Trial is a label on the strip, tabs and Month and Week; the stored card status stays Scheduled until the winner.
- **Q-N.** **Answered (4 Nov) and confirmed (S2):** the trial starts on the morning of the scheduled date, or by Start trial, never from the Post tab.
- **Q-O.** **Answered, narrowed by S1:** a version that **staff** send back after scheduling holds the trial until it is approved or dropped; the strip says so. The client cannot send one back after Scheduled (3.6).

### 3.5 How the Production tab looks for a trial card (Sidney's question, 4 Nov)

Read from the docs and the Production fragment (`245`), not seen on a live screen; step 1a confirms each line against a throwaway linked card, and the mockup shows it.

- **The parent issue** is the post itself, as today. Its status is the route value (Scheduled while the trial is Scheduled or running, Posted after a winner). **A trial card's parent carries a "Trial · N versions" line** (N counts live versions) with the version dots; it does not show a status per version, because the parent has one status. Once a winner is picked the line is gone and the parent is an ordinary Posted parent.
- **The sub-issues** are the card's real work items, one for the video and one for the thumbnail (graphics) where the card has one, as today. **Nothing about them is duplicated per version.** A video sub-issue's status follows the route value, as today, and **only the route value: the work item never carries one version's state (2.2)**. Before Schedule, if C has a change asked the route is Tweaks Needed and the video item shows Tweaks; when the editor delivers C's fix and moves the item on, **no version's parts change** (Version A's approved video stays approved), and the strip says the versions are unchanged.
- **Versions B to E have no work items** (only Version A's work item exists, and after a winner the winner's content is attached to it). They show only in the video sub-issue's **Assets box**, which already has one "Deliverable file · Version A" to "· Version E" row per version, each with its own Edit and its sharing state (Available, Missing, Permission denied). That stays as it is, with the new naming. A version with no link yet shows as a row that says so.
- **Where a version's tweaks show:** a change asked on one version is a note named "Version C: ..." (today's naming). It appears in the sub-issue's **Feedback & tweaks** list as a tweak, labelled Video or Graphics and "Tweak · Round N", with the version's name at the start. **The sub-issue and the parent keep their status** (Scheduled): only Version C's own status goes to Tweaks Needed (Q-Q, Sidney: "only version C is marked tweaks needed"). The editor finds C's tweak on Today and in the SMM tab through the queues in 2.2, not through a changed work item.
- **After a winner:** the video sub-issue's file row for the winner is the card's video, the other rows read "Not chosen" (**new work in step 5b**: today a lost version gets no label, `svTrialLabelShown`, `189:588-592`), and the parent is Posted. Also new work in step 5b: `245:111` chooses "Video X" or "Version X" from the client's flag, and must branch on the card's `rules` instead.
- **What Production cannot do** (and the mockup says so): it cannot set a version's status, because B to E have no work item to set it on. Version statuses are set on the card only.

### 3.6 Journeys the earlier drafts missed (second Opus review)

Each is a rule with a test; the mockup shows the visible ones.

**After the card is Scheduled (review H3; Sidney's S1: "if it's scheduled it shouldn't be able to be changed by the client").** **The client can only leave notes, never a change request and never "Not this one", except on a version that has an open "needs the client's OK again" send-back (16.2), where it may only Approve.** Today a client can reopen a version only from Client Approval or Tweaks Needed (`194:282-288 TRV_REOPEN_FROM`, the card-level guards at `190:1114-1117`; the card-level Approve is guarded at `190:918-920`) and on Scheduled the button already reads "Send to your team" (a note; `195:3176, 3210`). **`production-write`'s client policy does not change** (no re-pin from this), but **the client's page does need one new override (review M8):** `_rsPartState` treats every part of an Approved, Scheduled or Posted card as done (`195:1657`) and `_rsCalPosts` lists only cards with a part waiting (`195:1783-1801`), so a Scheduled card never reaches the client's Review tab today, and the override in `195:1647-1652` fires only at Client Approval. **After Scheduled the client sees a trial card only while one of its versions needs their OK** (the needs-client send-back above); otherwise there is no read-only view and no way in, and "Not this one" is hidden. **The needs-client Approve always goes through `trial-reels` `answer`, even on the card's version, never the card-level `_calReviewApplyApprove`.** **What staff can do after Scheduled:** (1) **send a version back** with a note (its parts go to Tweaks Needed, and **the route is team only**, 16.2; the version is counted but not approved, so the date start waits until it is approved or dropped; the strip says "Not started: Version C was sent back"); (2) **edit a version's fields or link** ("New cut ready"), which restarts the changed part through the chain and holds the trial the same way; (3) **drop** a version (the trial needs at least two counted); (4) **unschedule** the card (default yes: the strip's Schedule action becomes Unschedule while Scheduled and the trial has not started; verified: `production-write` lets an SMM and an admin make any move, `policy.mjs:324`, `390`, and the bridge keeps the stamps, `2026-09-18` migration `:218-225`; step 1a re-checks it on a throwaway linked card); (5) once the trial is running, **pick the winner**.

**The editor gets a version back (review H7, S5).** Today the editor has no correct action:
- Production's version row has only Edit (`245:191`), which writes the link; Frame.io keeps **one link** for a new upload, so pasting the same link is a silent no-op that looks saved (`linkPatch`; the same-link no-op is `logic.mjs:432`). **"New cut ready" exists only in the card's old list** (`189:786, 1465`), which step 5 removes. Rule: **"New cut ready" moves onto Production's version row and the tab menu**, and a same-link paste says "Same link: press New cut ready".
- Pasting C's new cut on the A row copies it into A and restarts A, un-approving A (`healMainPatch`, `logic.mjs:463-471`). Rule: the A row is labelled "Version A, on the card", and replacing an approved one asks first.
- A thumbnail change on C has nowhere to go: there are no version rows on the graphic sub-issue (`245:107`), and `_tdyTrialAsks` ignores `change_part` (`097:391`). Rule (S5, Sidney: "both can"): **the designer does a version's thumbnail change on the thumbnail sub-issue, which gets per-version rows, and the SMM can paste a thumbnail link on the card; both are allowed**, and the editors' Today list reads by part.
- **The work item carries the route value, never one version's state** (review H4, replacing "A's work item is A's only"): the route writer pushes the route value and stores it as `route_written` (2.2). A card status save pushes to the work items before the card upsert (`170:1703-1763`, `_calPushStatusToLinear`, `140:2194-2203`), and the bridge records every work-item move as `source = 'native-bridge'`, `actor = null` (`2026-10-01` migration `:246-260`), so the bridge row cannot tell the writer from an editor; `route_written` can. **A work-item status that differs from it is a person's move and never changes a version's parts.** The urgent ping (`140:2766-2790`, `190:4157-4161`) and the sub-issue then show Tweaks only because the route is Tweaks Needed, and the strip says the versions are unchanged. After Schedule, if an editor moves the item off Scheduled the bridge moves the card, the writer does not push it back and does not write the card's columns alone (that would fail the drift check, `scripts/card-calendar-status-drift-check.js:86-88`); the strip says the trial will not start until it is Scheduled again. Step 1a tests both cases on a throwaway **linked** card.
- A change on a **borrowed thumbnail** (a version with none of its own) lands on the card's graphic part and the designer edits A's (`194:401-404`, `195:3831`). Rule: **"Give Version B its own" first**, then the change.

**Today shows version work (review H8, L6).** The SMM's "Captions to write" reads the card's caption status and excludes Scheduled (`097:318-326, 514`); "Missing links" checks only A (`_calSmmMediaGap`, `097:523`); the walk list excludes Scheduled (`566`); the editor list fetches only SMM, Kasper and Client approval (`097:360`) and **drops test clients (`097:366`), so the earlier test "C appears on Today" cannot pass on the test client**. Rules: every Today list reads the versions (`svTrialListSharedMany`), no Scheduled exclusion for trial cards, the link and caption gaps are checked per version, `097:360` is widened, and the test client gets a test-mode bypass of the test filter. Today says "Version C", not "Video C", on v2 (`097:463, 475`).

**A held client change or an approve is lost or comes back (review H10, L7).** `194:643-690` keeps pending client changes in the browser with no age limit and no sender key, and re-sends them on every read; e.g. the phone drops mid-send, the team approves C's new cut, the client opens the link days later and C flips back to "change asked". `185` re-reads before re-sending (`185:334-342`); `194` does not. A version **Approve** (`194:572-605`) is not queued at all: if Safari kills the tab, the approval is silently lost. Rules (a new step 1c): **re-read the version's revision before re-sending and drop the held change if it moved; queue approves the way 185 does; key the held list by who is signed in** (it is shared across users of one browser today).

**Other things that write or read one card (review M11, L2 to L5, L9).** In step 1a's inventory, each with a decision:
- SyncMate's `video_cards` (`higgsfield-mcp/index.ts:1706`, `videocards.mjs:307, 319, 328`) gives editors only the card's status, link and notes: it must read the version rows too.
- `caption-generate` (`index.ts:311`) writes the **card's** caption: a caption generated for B would land on A, or on the winner in the middle of a swap. Rule: it writes to the selected version through `version_fields_set`.
- Urgent pings (`140:2766-2790`) need the card at Tweaks or Kasper: a version's urgency must reach them.
- **Kasper's "Your notes in Frame.io" link** uses the card's `asset_url` (`195:3033`), so with B selected it opens A's Frame page: it reads the selected version's link.
- **Bulk caption generation** (the Sheet view's "Write captions for several cards", `180:2051`) writes the card's caption when it finishes, minutes later. It is in step 1a's inventory and carries the job guard of 16.3 (the version letter and the swap counter).
- **Nothing in this plan creates a sub-issue** (verified: component fill is a Calendar button, `160:3747`); a version never has one. The **designer's per-version thumbnail rows (S5) exist only where there is a thumbnail sub-issue** (6 of the 38 cards); none is created for the others, and there only the SMM's paste works.
- `frameio-view`'s client card (`client-card.mjs:79-80`) answers 404 when the card has no link even though B has one: it reads the effective version.
- Kasper's board still carries `asset_url`, thumbnail, caption and CTA in `KASPER_PATCH_SCALARS` (`305:363`) and keeps a 24 h local copy (`321:611`), but sends only fields that differ from `_patchBase` (`305:518-521`), so "no local copy for trial cards" still works. The real risk is a stale *status* decision, which the stale-save guard (16.3) covers. A test covers it.
- Editors' board counts rounds from work-item moves only (`340:120-201`), so a version's rounds do not count: noted, accepted.
- The Messages inbox drops Posted cards (`production-comments:494-495`): the losers' open notes vanish from it at the pick; accepted, noted in the mockup.
- The overdue bump happens on **every** staff status write (`production-write index.ts:5806`), not only a late Posted one, so a route write can also move a due date forward: cosmetic, noted.
- **No Slack goes to the creatives for a version change** (it has no work item): consistent with today, and Today (above) is how they find out.

**Redo and comments (review M5, M6).** Redo's armed state is keyed by the part and not the version (`195:3103, 1172`): armed on A, auto-advance to B, a second click redoes B. Rule: the key includes the letter and Redo exists only on the video row (`195:2943-2952`). **Deleting a change comment leaves the version's change open** (`190:3880-3889`; nothing calls `trial-reels`): deleting it reopens that part.

**Stuck with no signal (review M12, S3).** A trial with no winner ever picked, or one down to one counted version, would sit forever. Default (S3): **a quiet line on Today, "2 trials running: pick a winner"** (not a ping, no message), and the strip names a card that needs a second live version. A card that ends without a winner, or has one live version, goes back to the ordinary Posted robot (3.4).

**Analytics (review L1; Sidney's S6: "isn't the analytics being tracked on social media? I'm pretty sure it wouldn't track the trial to begin with").** The expectation, written down as an expectation and not a fact: analytics reads the client's **public profile posts**, and a trial reel is shown only to non-followers, so it should **not appear on the profile grid at all** and analytics should not see it. We keep counting what the profile shows, **no change to analytics for trials**. When the winner is shared to followers it appears on the profile and counts as an ordinary post. **How we would notice if trial reels did appear** (the review's worry: each of A to E would count and a loser could top the week; `pipeline-social/own-reads.mjs:51, 74` lets the AI match near-identical captions): step 1a adds one counts-only check to the weekly analytics report: the number of scraped posts whose caption equals a trial version's caption but are not the card's own `post_url`. If it is ever above zero, the staff report row says so and the rule is revisited. The card has one `post_url` and the swap does not move it; the SMM or the post-source records the winner's.

## 4. Seeing every version's status without switching

Four layers, from quietest to most detail. Recommended: build the first three, offer the fourth later.

1. **On each tab: three small pips** after the letter (Video, Thumbnail, Caption), each in its status colour, with the words in the tab's accessible name and tooltip. Today it is one dot.
2. **A status grid under the tabs, always visible, three rows by three columns:** rows A, B, C; columns Video, Thumbnail, Caption; each cell a coloured dot with a one-word state on hover. Clicking a cell selects that version. It is small (about 3 lines tall) and collapses to a single line of pips on the phone. This answers "know their statuses by just looking".
3. **Month and Week:** today's one dot per live version stays, showing that version's least-advanced part, before a winner. After a winner the card is one ordinary Posted card, with no dots. There is no card-level dot. Hover or focus opens the grid in a small popover.
4. **Later, if Sidney wants:** a filter "trial versions waiting on me" on the SMM and Kasper review tabs.

**Production:** no change in step order (one Deliverable file row per version already exists). A later option is to show the three pips next to each version row.
**Phone:** tabs scroll sideways if more than four; the grid is a one-line pip row that opens as a sheet.

## 5. Notes per version, and comments

- **Today:** a note belongs to the card; one written while a version is on screen is named "Version B: ..." (a text prefix; "Video B:" is accepted as the same), and the Notes view has a Video switch that only moves the player.
- **Wanted (Sidney: yes):** Notes opens on the selected version, with the same A to E switch, and shows that version's notes, with a **Whole post** filter.
- **Rule (review finding 6, replacing the first draft's "no prefix means A"):** a note with **no prefix is a Whole post note**, not Version A's. Card-wide notes written before the trial would otherwise land on A. Turning the trial on rewrites no note. A note typed while Version A is selected is tagged "Version A: ..." from then on. A's tab shows the "Version A:" notes; Whole post shows everything. Default for Q-C.
- **Word:** both "Video X" and "Version X" prefixes count (already true); new notes use "Version" on a `trial_versions_v2` client.
- **Mechanism, two stages:** first read-side on the prefix (no database change). Only if that proves too fragile, a real version field on notes. Whether the notes table can take one without touching a Section 4 function is a step 1 check.
- **Client and Kasper:** a change request already names its version and part ("Version C, thumbnail: ..."), so it lands on the right version, and after this plan it also moves **that version's part status** to Tweaks Needed.
- **A client deleting their own comment** already deletes the Production copy too (690). A delete is by id, so it cannot land on the wrong version.

## 6. Other surfaces

- **Review boards (client link, SMM Review tab, Kasper):** already show one version at a time with its own three parts (688 part 1). Change: each part's Approve moves *that part of that version* (today one Approve covers all three). The visible default can stay "Approve Version B" as one button that approves all three parts, with each part's own Approve under it for people who want it. This is Q4.
- **Production and SyncLinear sub-issues:** unchanged. One "Deliverable file" row per version already exists and is a link, not a status. **Sub-issues must not be creatable from SyncLinear** (standing rule); nothing here adds that.
- **Posting (Post for Me):** after a winner, see section 3.3. Before one, "From a card" lists a v2 trial card while its trial is open, whatever its date, and offers each **approved or On-trial** version (read by its parts) as its own Instagram trial reel with that version's video, thumbnail and caption (P4, held for Sidney's D3). **The call to action is not posted** (Post for Me has no call-to-action field); it stays a card and version field. This plan does not change which versions go. Approved means all three parts approved. Nothing posts automatically and no automated check ever posts.
- **Analytics (later):** the version rows already have `views, watch_time_s, shares, saves, follows`. Per-version results stay a later step and need nothing from this plan.

## 7. Data and live systems

### 7.1 Schema: what exists, what must change

- **Exists:** `trial_reel_cards`, `studio_trial_versions` with thumbnail, caption, change_part (migration `20261102200000`). No browser role can read or write either table; only the `trial-reels` function does.
- **One new migration (step 2), all nullable, so existing rows stay valid:** on `studio_trial_versions`: `cta`; `parts` (per-part stamps and change notes, 2.2; null means "follows the version's one status", today's behaviour, and the first per-part write fills all three so a version is never half old and half new). On `trial_reel_cards`: `rules` (`'v1'`/`'v2'`, 2.2), `swap_record` (the swap's protocol object with `state` pending or done, kept until Clear, 16.3, 21.2), `swap_count` (an integer bumped per pick and per Clear, 21.2), `trial_closed_at` (3.4), `card_updated_at_off` (the card's `updated_at` stored at switch-off, 2.2), `scheduled_at` (when the card was Scheduled, 21.4), `card_letter` (the version whose four fields are on the card, `'A'` to `'E'`, 23.1; **filled from today's `mainLetter` for every enabled card, never a blind `'A'`**, because some live cards already carry a version other than A through the old drop path, so a default of `'A'` would point them at a dropped version; new cards get `'A'`), `route_written` (the last route value the route writer pushed to the work items, 2.2). **This is the one list of columns, ten in all (review L2, M13): two on `studio_trial_versions` (`cta`, `parts`) and eight on `trial_reel_cards`. Steps 1a-bis and 2 and 16.5 point here and do not list columns of their own; step 1a-bis adds all of them.** **No `sent_at` and no `calendar_posts` column.** Every revoke names all four roles and reads the grants back, as the earlier migrations do. Rollback is dropping the columns.
- **Migration of trial cards already live:** none needed for the data. Fields already sit on the card; A's `parts` stay null and follow A's own status and stamps, and only the 2 cards with no A row get one seeded (2.2); null in the new columns means today's behaviour, so every existing version reads exactly as before. Counts read on 4 Nov (counts only): **63 switch rows, 38 on (5 real, 33 test); 189 version rows** (A 60, B 59, C 46, D 14, E 8, F 2, G 1), of which F and G are all dropped. All 5 winners are on the test client (2 are not A). Every one of the 38 enabled cards is linked to a Production video work item; 6 have a graphic (thumbnail) work item; none has a call to action; 4 versions are on trial, all on the test client; 2 real enabled cards have no version rows at all; one real enabled card is Posted with all three versions still waiting (the old auto-start never fired on it). **The migrations this plan needs:** (1) the columns above (step 2); (2) the due() SQL skip while a trial is open (3.4), held and **live before step 4 reaches the test client**.
- **Counts to use in step 1 are the enabled ones** (review, low 11): per the review, 38 trial cards are on, 33 of them on the test client and 5 real; 7 enabled version rows on real clients, none with its own thumbnail or caption; no trial card has a call to action; no duplicate letter rows. **The flag `trial_versions_v2` stays test client only** until Sidney clears each step.

### 7.2 Section 4 functions

`production-write`, `deliverable-write` and `batch-write` **do not need to change, and are used as they are**: the winner swap writes through their existing `attachment` and `status` operations (3.3), so it is several writes across three writers (Posted alone is video, graphic and card, `140:2180-2205`, each a step in `steps_done`, 16.3), none with new source, and **no re-pin** (true because no Section 4 source changes, not because they are not involved). `trial-reels` writes no calendar row. The route value is written through the existing writers, never by a new path. **If a step ever adds a column to `calendar_posts`, `calendar-upsert`'s frozen allow-list is touched; this plan avoids that on purpose** (part statuses live in the version rows). The tests prove it (no write to a card row except through those writers), and the PR checklist states "no Section 4 file touched, no fingerprint re-pin". If a step ever does touch one, re-pin with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`, in the same PR. The merge lane holds `trial-reels` until its migration is applied (it carries an `ef-auto-deploy-applied-when` line); Lighthouse applies it and runs the merge lane by hand. Sidney runs nothing.

### 7.3 Write-refusal log

Every new write (version field, version part status, the route writer, Start trial, Pick the winner) calls the existing refusal reporting (`_writeUiRecordFailure`, board `calendar`) and gets a read-back test, because absence from the log is not proof a save worked.

## 8. Edge cases (each is a test)

| Case | Behaviour |
|---|---|
| Version with no thumbnail | Shows "Using Version A's thumbnail · follows A's approval" with "Give Version B its own" (S4, 16.4). It never shows A's picture as if it were the version's own |
| Drop the version on screen | The card moves to the nearest live tab and says so |
| Two staff edit different versions | Fine: different rows. Same version: last save wins on that field only, and the second sees "Changed by someone else" (the card's existing check) |
| Two staff pick a winner | One wins; the other is refused with a plain message (race test exists). Clearing and re-picking go through one `swap_record` attempt at a time (16.3), so no stale copy can exist |
| Trial switched off with a winner | Allowed (S-B): the winner stays the card, the others are hidden (23.1) |
| Turning the trial on for a card with notes, comments and statuses | All read as Version A's; a test compares before and after, field by field |
| Reload mid-save | The save either lands or the field comes back with the typed words and a Try again (685 pattern) |
| Selected tab after reload | Reopens on the card's own version; a remembered tab is Q9 |
| Client deletes a comment | Section 5 |
| A version answered, then its field changes | Restarts through the SMM, **per part: only the part that changed restarts** (today `versionFieldsPatch` restarts the whole version, `logic.mjs:766-773`; step 2 changes that, review M1) |
| Phone | Tabs scroll; the grid collapses to pips; each field is full width; no sideways page scroll at 390; every tab and cell is a 44 px target |
| Client link | Never shows a dropped version's tab or a version not yet through the team; a client on a version they cannot see is never a dead end |
| Month opened on another month, Week | Fixtures use dates relative to today (the standing rule) |

## 9. Sidney's answers (4 Nov 2026 ~19:40 UTC) and the questions still open

| # | Answer | Where it landed |
|---|---|---|
| Q1 | "If it is trial, does it have a card own status? I think only the versions. And the data from before trial converts into version A." **No card status on screen; turning trial on converts the card's data into Version A.** | 2.2 (rewritten twice): a visual rule; a hidden route value stays for the queues, Production and the drift check; fields stay on the card, and part statuses live in the version rows, A's included (nothing is copied, 2.2) |
| Q2 | Yes: each version has its own caption and image, and part statuses | 2.2, 7.1 |
| Q3 | Yes: fallback shown, never silent | 2.2, 8 |
| Q4 | Yes: one "Approve Version B" plus a small per-part approve | 6, step 8 |
| Q5 | No single control for all three parts | 3.1 |
| Q6 | "No replacement, just winner gets highlighted in the toggle." **Superseded the same evening by Q-A and Q-B (3.3): the winner is highlighted, opens by default, and the card becomes the winner** | 3.3 (rewritten in revision 3) |
| Q7 | Yes: a dropped version keeps a muted tab with Bring back | 3.3 |
| Q8 | Yes: Notes open on the selected version, with a "Whole post" filter | 5 |
| Q9 | No: do not remember the last tab | 8 |
| Q10 | Yes: the status grid is always visible | 4 |
| Q11 | Yes: the old list goes in step 5 | 3.2 |
| Q12 | "Up to 5 versions, A to E" (he wrote "ABCDF"; read as five). **Assumption, flagged** | 2.2 |
| Q-S | **DECIDED by Sidney, 6 Nov ("yes to all").** Switching the trial back on always lets the SMM finish the trial: a Posted card's approved versions go straight on trial so a winner can be picked, and a trial that ended with no winner can run again. (The alternative, refusing to switch on a Posted card, is simpler but a dead end.) | 23.1 step 4, 16.7 |
| Q-T | **DECIDED by Sidney, 6 Nov ("yes to all").** Drop on the card's version stays, with the one-line confirm "Dropping Version A makes Version B the primary version (the one on the card).", done as a proper swap using the switch-off marker. (The alternative: refuse it, "make another version the card first".) | 2.2, 24.2, step 1a, step 5 |
| Q-U | **DECIDED by Sidney, 6 Nov ("yes to all").** Empty fields keep inheriting Version A's value after the card's version changes, as in S4; nothing changes silently. (The alternative: inherit from the current card version.) | 2.2, 16.4, step 3 |

**Questions this raised. Sidney answered Q13 to Q17 on 4 Nov (~20:05 UTC): Q13 yes; Q14 no button, so there is no "Keep Version C as the card"; Q15 yes; Q16 yes; Q17 yes, five versions, A to E.** Q-A to Q-R (sections 12, 13) and S1 to S7 (section 15) are all answered; Q1 to Q3 (section 17) are answered (section 18).

13. **Q13. Production's parent issue for a trial card.** It follows the hidden route value. Recommended: show "Trial · N versions" with the version dots on the parent.
14. **Q14. Ending a trial with a winner that is not A.** Answered: no extra button. The winner already becomes the card (3.3); switching the trial off keeps the winner as the card (23.1).
15. **Q15. After a winner, can the other versions still be posted?** Recommended: no; only the winner is offered, as an ordinary post.
16. **Q16. Calendar filters and counts.** Recommended: a trial card matches a status filter if any live version has it, and counts are by version.
17. **Q17. The cap of five.** Confirm "A to E" is what "ABCDF" meant. The three existing F and G rows are all dropped, so nothing is lost either way.

## 10. Build order: small PRs, each testable on the test client

Everything stays behind `trial_versions_v2`, on for the test client only. The card "Video 2 — TEST2" is never touched; test cards are throwaway ones for the test client, and the drift check is run only on an unlinked throwaway card. **Reordered after the review:** the queues move onto version rows *first*, and nothing visible ships until that is proven, so every step can be tested alone.

| Step | PR | What it is | What Sidney can click after |
|---|---|---|---|
| 0 | **Clickable mockup of the final card** (design only, no wiring) | Every state in sections 3, 4 and 8, on the card, Month, Week, the client link and the phone, **including every dead end**: no link yet, refused save, dropped version on screen, winner, trial off with a winner, a version the client cannot see, offline, empty fields, Start trial, Trial running, Pick the winner and its confirm line, End trial without a winner, a trial waiting for an unapproved version, **the send-back dialog with its "Needs the client's OK again" choice (off and on), the client's Approve-only view and the waiting strip (16.2)**, **the Schedule action and its gate**, a card whose Scheduled arrived from Production with a version unapproved (warned on the strip), the date start, **and the Production tab for a trial card (3.5): the parent with its "Trial · N versions" line, the video sub-issue's per-version file rows, a version's tweak in Feedback & tweaks, and the winner afterwards**. Approved before step 1; **it also shows the switch-off dialog (which version becomes the card; on a Scheduled card only versions whose three parts are approved are offered, the others greyed with the reason, "Version C's caption is not approved"), the trial-off strip and switching back on (23.1), the Drop confirm "Dropping Version A makes Version B the primary version (the one on the card)." (Q-T), the strip lines for a person's move in Production ("Production moved the video to For SMM Approval; the versions are unchanged", and after Schedule "the trial will not start until it is Scheduled again"), "Starts now: the date has passed" (3.4), Today's "date passed, trial not started" line, the client's caption part as "Ask for a change", and a note that a switch-off reaches Production's tab within about 30 seconds (`245` refreshes on broadcast or timer)** | Click through all of it |
| 1a | **Measure and write the rules** (docs and read-only tests) | Inventory every reader and **writer** of a card's status and of its `asset_url`, thumbnail, caption and CTA, including every item in 2.2 (the six status writers) and 3.6 (SyncMate `video_cards`, `caption-generate`, urgent pings, `frameio-view`'s client card, Kasper's board, the Messages inbox, analytics); the route-value rule sheet (counted versions, who writes when); the notes check; every way a card can arrive at **Scheduled or Posted**; **that `production-write` lets an SMM move Scheduled back (Unschedule)**; the new inheritance rule across the swap; **the drop path on the card's version (`194:741`, `194:789-814`, `189:1054`; Q-T)**; **the six extra writers of the card in 2.2** (the non-Kasper Tweaks branch `195:3735`, Kasper's `_calClearStaleApprovals` branch `195:3724-3733`, Approve after tweaks `195:3868`, the Undo toast `195:3769`/`4621-4643`, the client's caption edit `195:2747`/`4240-4275`, `svCalResolveVersionTweaks` `195:3744`) **and bulk caption generation (`180:2051`)**; **the client guards at `190:918-920` and `190:1114-1117` and the `_rsPartState` override (3.6)**; **which bridge body is live** (the `2026-10-08` file's header says NOT APPLIED, so read which one is live, not the `2026-10-01` text); **the two work-item tests of 3.6 on a throwaway linked card**; the swap's checks (graphic route, caption history origin, thumbnail revision baseline, Posted back to Scheduled, the dead-link probe); the watchdog signal for the on-read start; a test that fails if a version row ever gets a work item | The rule sheet |
| 1a-bis | **Columns and pure functions first** (migration plus tested functions, no behaviour change) | **All ten columns of the one list in 7.1** (including `card_letter`, filled from `mainLetter` for every enabled card, and `route_written`) and `routeStatusFor`, the `counted` and gate rules, and the effective-fields helper as **pure functions with unit tests**, before any reader uses them. Held migration; nothing reads the columns yet | Nothing visible |
| 1b | **Queues, Today and the client's gates read version rows; one route writer** (code, no new look) | SMM tab, Kasper, client link, Today (all its lists, per version, test-client bypass) and `trial-reels` decide "waits on me" from the version rows **whatever the route value is, Scheduled included**; on a Scheduled v2 trial card the client link is notes only and hides "Not this one" (S1); every route writer goes through `routeStatusFor`, with a test that fails on any bypass. Tests: A Approved and B at the SMM, B is in the SMM tab; card Scheduled, **staff** send C back: C appears in the SMM tab and on Today (also on the test client) and the work item stays Scheduled; the client link of a Scheduled trial card offers notes only | Nothing new on screen; the queues are right in the odd cases. **These changes reach every client, not only the test client** (`trial_reels_pages` is on for all), so v1 regression tests prove today's queues are unchanged for `rules = 'v1'` and untouched cards (16.5). **Step 1b also names the client's `_rsPartState` override for a Scheduled card with a version waiting on the client (3.6), and the needs-client Approve always goes through `trial-reels` `answer`; the six extra writers of 2.2 go through the route writer and are in this step's bypass test; the step 1b test "C appears on Today on the test client" needs the bypass at `097:366`, kept in the same PR as the test. Q1's server rule and the client-queue override live here:** the server allows a client Approve only on a version with an open needs-client send-back and answers `card_scheduled` to every other client change or pass; the client's queue lists a Scheduled card that has a version waiting on the client (today `195:1657` returns "ok" for Scheduled and skips it). **The new reading applies only to `rules = 'v2'`; a null `rules` counts as v1, with a regression test for null (21.5)** |
| 1c | **Client link safety** (code, no new look) | A held client change is re-checked against the version's revision before it is re-sent and dropped if the version moved; a version Approve is queued like 185's; the held list is keyed by who is signed in. Test: change held on a phone, the team approves the new cut, the client opens the link days later: C stays approved | Nothing new on screen; a late change no longer undoes an approval. **Reaches every client**; v1 regression tests; held jobs store the version's revision and send `expected_revision` (16.6). **The held queue (`194:662`) drops a held change only on `version_not_found`, `version_dropped`, `version_on_trial`, `trial_reels_off` and `not_enabled` and retries every other refusal, backing off to every 60 seconds (`194:672-683`); it now also drops `card_scheduled` and `version_moved` with a one-line message to the client, and retries `swap_in_progress` and `conflict` after a re-read** |
| 2 | **Migration and function** | The columns of the one list in 7.1, **already added in step 1a-bis**, which this step starts to use; `trial-reels` reads and writes them; per-part stamps and notes, only the changed part restarts, `placeOf` no longer reads the route value on v2; the cap moves to A to E for **adding** (`logic.mjs:7`, `higgsfield-mcp/trialreels.mjs:45`, the `189`/`194` regexes); the route writer and the effective-fields helper as tested functions; the **client's not-this-one** counted rule. Migration held until Lighthouse applies it; no `calendar_posts` column | Nothing visible (flag off to the page) |
| 3 | **Tabs edit the selected version** | The card's Video, Thumbnail, Caption and CTA follow the tab and save to it; the old list still present. **The effective-fields readers change here (review H1, M9): `readShape`'s `effective` and `effectiveFields` (`logic.mjs:617`, `725-729`), the client link (`194:392`, `401-408`), `post-source` (`handler.mjs:149`), `frameio-view`'s client card and the Post tab's `v.status === 'approved'` read (`299:273`): inherited means Version A's value, read from the card while `card_letter` = A and from A's row otherwise** | Type a caption on B, reload, see it on B, A unchanged |
| 4 | **Part states, pips, status grid, Schedule, Start trial, the Post tab** | **The route writer starts pushing to the test client's work items here, so the work-item rule (the route value only, `route_written`, 2.2, 3.6) ships in this step, not later.** Each part's pill on the selected tab (states in the version rows, lazy fill for A); the route writer runs; the **Schedule** (and **Unschedule**) action and **Start trial** with the gate on **counted** versions (every counted version approved, at least two counted), held on the server too; **the start is the morning rule or Start trial, never the Post tab's send**; the **Post tab lists counted versions that are approved or On trial** (all three parts approved), and **an On-trial version stays editable** until the winner is picked (`version_on_trial` goes; only the losers lock); **the `trial-reels` changes these need**: `trial_starts_when_posted` (`index.ts:672-673`), the 24 h end and `trial_not_over`; the **due() SQL skip migration** (held, **live before step 4 reaches the test client**); the Trial label on the strip, tabs, and Month and Week; version menus stop at Approved; the card shows no status pill | Set B's thumbnail to Approved; see the grid without switching; approve three versions, Schedule, press Start trial and see Trial on all of them; fix a typo on an On-trial version and see only that part go back to the SMM; see the Post tab still list the On-trial versions (nothing posts in a check; the test uses the mock); try with one unapproved and see why it will not start. **The start sits behind its own sub-switch until step 5 merges** (16.5) |
| 5 | **The old list goes; Pick the winner; the winner becomes the card** | Drop, bring back, add, Import from Frame move to the tab menu; **Pick the winner** during the trial; the others end as Not chosen; the swap of **link, thumbnail, caption and call to action** in the write order of 3.3, **with the current card version's four fields written first and the `swap_record` marker and its "Finish / Put back" recovery**, Posted last; inherited fields stay inherited through the swap (3.3) with no prompt; undo becomes the reverse swap; `mainLetter`/`on_card`/`healMainPatch` follow the marker and then `card_letter`; **`post-source` and the other effective-fields readers are already in step 3, so the test client never posts a wrong inherited thumbnail between 5 and 9; `switch_set` (today no checks at all, `index.ts:498-526`) gets the pending-marker refusal, the "with a winner, no choice" rule and "writes `v2` only when `rules` is null" on the server, not only in the dialog; Production disables Edit on the card's rows on both sub-issues while a marker is pending;** the card opens on the winner and a reload returns to it; End the trial without a winner (sets `trial_closed_at`); the 24 h readers and their tests retired. **Verified on a throwaway LINKED test-client card** (it needs a video and a graphic sub-issue), moved **only through UI writes**, never raw SQL status seeding (OPEN_REPAIRS 373), **including a reload in the middle of the swap**; the drift check runs only on an unlinked throwaway card | Run a whole trial: add, approve, Schedule, send, pick a winner, see the card become it and read Posted, close the tab mid-pick and see Finish / Put back, clear the winner and see A back; **a pick interrupted mid-way offers Finish / Put back**. **In this step the old list is hidden and the 24 h readers are dropped only on v2 cards**; the removal for v1 is a separate cleanup once no v1 trial is open (21.6). **"New cut ready" goes onto the selected tab's Video row here (3.2)** (21.7), plus the "Clear winner" button and the **switch-off dialog (23.1)** |
| 5b | **The editor's side in Production** | "New cut ready" **added to Production's version row** (the selected tab's Video row got it in step 5), with "Same link: press New cut ready"; the A row labelled "Version A, on the card" with a confirm before replacing an approved one; **per-version rows on the thumbnail sub-issue** for the designer (S5); the work-item rule of 3.6 (the route value only; a person's move never changes a version) with its strip lines, and its two tests on a linked card (ship in step 4, 5b only adds the editor's rows); **"Not chosen" labels and the `rules`-based "Video" or "Version" word (3.5)**; Today's editor list reads by part | Send C back, see it on Today, press New cut ready on C's row, see C back with the SMM and A still approved |
| 6 | **Notes per version** | Notes switch follows the tab; unprefixed notes are Whole post | Write a note on C, see it only under C |
| 7 | **Month, Week and phone** | Trial dots; popover; phone layout; after a winner an ordinary Posted card | Look at the Calendar at 390 and 1440 |
| 8 | **Review boards per part** (Q4) | Each part approves by itself; one "Approve Version B" stays. **The client's Approve-only view for a needs-client send-back (16.2): Approve only after the team approved the fix, "Your team is updating Version C" before that.** Caption edits on the boards for a version that is not the card's stay blocked on the stage (`195:2747`); a change goes through "ask for a change" on that version's caption part. **Every answer on every version, the card's version included, goes through `trial-reels` `answer` (`194:572-605`); the client's Approve-only view needs a `ready` rule for a team-only send-back on a Scheduled card (`throughTeam` reads the card status). Redo is keyed by the version and exists only on the video row; deleting a change comment reopens that part; a stale Kasper board cannot push old fields across a swap (test)** | Approve B's caption as the client link, see the grid change |
| 9 | **Posting after a winner, and the quiet Today line** | After a winner the winner is an ordinary post and the other versions are not offered; the effective-fields readers (`post-source`, the client card) are already done in step 3, so this step keeps only posting after a winner; the quiet "N trials running: pick a winner" line on Today (S3); nothing posts in a check | Pick the trial card on the Post tab (nothing is posted); see the line on Today |

Each step ships with a browser test at 1440 and 390 that fails on `main` and passes on the branch, the existing trial suites kept green (`trial-version-card-tabs-browser`, `trial-version-fields-browser`, `trial-reels-journey-browser`, `trial-version-review-parts-browser`), the identity check before pushing, and the refusal-log call plus a read-back on every new write. Rough size: step 0 a day; 1a and 1b two or three; 2 to 5 about a week and a half together; the rest another week. A fingerprint re-pin is not expected at any step; if a step touches a Section 4 function, re-pin in the same PR.

### Process before any build (Sidney, 4 Nov)

1. Sidney approves this plan (all questions are answered).
2. **A strong model reviews the plan once more**, after his approval.
3. **Only when the plan is final are the mockups made** (step 0). No mockup and no build starts before that.
4. **Sidney's plan (4 Nov, ~23:00): more review rounds until the reviewers find no bugs (the next is on Sunday), then the build, then merging for him and the test clients, then testing.**

## 11. Risks

- **The route value is a second copy of "where the card is".** It exists so Production, the drift check and old readers keep working; step 1a lists every reader, step 1b moves the queues off it, and the writer is one function with tests. A missed reader is the main risk.
- **Posted comes only with the winner now** (3.4); a Scheduled or Posted that arrives another way is ignored for the trial and warned about, and the end-of-day robot skips trial cards by the due() SQL change (a held migration, live before the flag widens). Step 1a lists every way in.
- **The winner swap** changes `trial-reels` (not Section 4) and writes the card through the page; a failed card write stops the pick and puts everything back. Its upside: every server reader already reads the card's columns, so none changes. **A reload in the middle is handled by the `swap_record` protocol (16.3).**
- **The trial flow (3.4)** retires the automatic start from Posted and the 24 h clock for v2 clients and moves the start to the morning of the scheduled date through a new check (the Posted robot is untouched); both ways coexist for a while, and every reader of the 24 h is updated with its tests.
- **A trial waiting for an unapproved version** must say so on the strip, or it looks stuck.
- **The 5 existing winners** are all on the test client and are reset or left as test data; no special rule.
- **Per-part approval changes what "approved" means** for the review boards and posting; steps 8 and 9 change those on purpose, not as a side effect.
- **A reload during a save** and **two staff on one version** are section 8 cases, each with a test.

## 12. Adversarial review round 1 (session Trialreview, 4 Nov) and what changed

| # | Finding | What the plan does now |
|---|---|---|
| 1 HIGH | The card's video status is the routing key for every queue and for `trial-reels` | "No status of its own" is a visual rule; a hidden system-written route value stays; queues move onto version rows first (step 1b). 2.2 |
| 2 HIGH | Posted and Scheduled live in A's video status and start every version's 24 h trial | Revision 6: the morning of the scheduled date (a new check, 06:00 US Eastern proposed) or a button starts the trial; Trial is a label and a version status, the stored card status stays Scheduled until the winner makes it Posted; version menus stop at Approved (3.4) |
| 3 HIGH | A winner needs `trial-reels` changes and every reader of the card's picture to agree | Revision 3: the winner becomes the card by a two-way swap (3.3), so server readers need no change; the `trial-reels` changes are listed (`attach_first`, undo, `mainLetter`/`on_card`/`healMainPatch`, `svTrialPick`). Supersedes the first helper-based answer. **Q-B** |
| 4 HIGH | 2.2 said "nothing is copied" and 3.3 said previews read the winner | Revision 3 removes the contradiction: the winner is copied (swapped) onto the card, A's data goes to A's row |
| 5 MED | The cap of five is in more places | Named in 2.2 and step 2; the table's check stays |
| 6 MED | "No prefix means A" is wrong | Unprefixed means Whole post. 5. **Q-C** |
| 7 MED | Video and Version words | Both count; new notes say Version |
| 8 MED | The drift check is safe only because B to E have no work items | An invariant with a test (step 1a); the check is run on a throwaway unlinked card |
| 9 MED | Steps could not be tested alone | Reordered (section 10) |
| 10 MED | Null part statuses | Null means "follows the version's one status"; the first write fills all three. 7.1 |
| 11 LOW | Use enabled counts | 7.1 |
| 12 LOW | `calendar-upsert`'s allow-list is frozen | No new `calendar_posts` column; A's part statuses live in A's row. 2.2, 7.2 |
| 13 LOW | Refusal log and read-back on every new write | 7.3 |
| 14 LOW | Client link never shows dropped tabs; 390 px; 44 px targets; the mockup shows every dead end | Section 8 and step 0 |

**Questions A to D, with defaults** (the review's A to F; E and F were relayed by the supervisor and both match the plan as written):
- **Q-A. Where do Posted and Scheduled live?** **Answered, reworked twice (~21:35):** Scheduled is the person's, with the card's one date; the Trial label shows at the date (by the robot or the button); Posted comes with the winner. See 3.4 and Q-M to Q-O.
- **Q-B. Does the winner show on Month and Week and get posted?** **Answered (~21:15):** yes, the card behaves as the winner everywhere. Built as the swap in 3.3.
- **Q-C. Notes with no version prefix?** **Answered:** they sit under Whole post.
- **Q-D. A card with A approved and B waiting on the client: does it stay in the client's queue?** **Answered:** yes, any version waiting for approval shows on that board.
- **Q-E. Approving.** **Answered:** one "Approve Version B" approves all three parts, and each part can also be approved alone.
- **Q-F. The cap.** **Answered:** A to E; existing F and G rows stay readable (all three are dropped) and are not shown as tabs.

## 13. Opus review of revision 6 (session Trialopus, 4 Nov) and what changed in revision 7

Verdict: the model is sound and matches Sidney's words; three claims were wrong against the code; none changes what the screens show. Live counts were read-only (in 7.1).

| # | Finding | What the plan does now |
|---|---|---|
| H1 | The end-of-day Posted robot cannot stay untouched and also skip v2 trial cards: with the card staying Scheduled, `calendar_auto_posted_due()` would turn every trial card that ran past its date Posted, and its work items with it | A real skip in the due() SQL, a held migration live before the flag widens; "byte for byte" withdrawn. 3.4 |
| H2 | The swap goes through `production-write` (`attachment`, `status`) and the graphic attachment, not the card save alone; the plan disagreed with itself about where statuses live | One rule: part statuses always in the version rows, the card's columns are only the route value; only link, thumbnail, caption and CTA swap; the write order ends with Posted; step 1a's four checks. 2.2, 3.3, 7.2 |
| H3 | A version sent back after scheduling reaches nobody (no work item, route value stays Scheduled) | Queues read version rows whatever the route value is, Scheduled included, with the test. 2.2, step 1b |
| M1 | No Schedule control; gate holes (Scheduled can arrive from Production or SyncLinear) | A Schedule action in the trial strip; the gate held on the server; both Scheduled and Posted arriving another way are ignored and warned about. 3.4 |
| M2 | Already-enabled cards never "switch on" again | Lazy fill of A's statuses on the first v2 read; cards mid-flight finish on the old rules (Q-P). 2.2 |
| M3 | The morning start is cheaper as an on-read rule | An on-read rule in `trial-reels`, `<=` today in ET, strip shows Trial from 06:00 ET; watchdog signal named in 1a. 3.4 |
| M4 | Start trial is refused before Posted and the 24 h end blocks the pick | Step 4 carries those `trial-reels` changes. Step 4 |
| M5 | Testing needs a linked card | Step 5 verified on a throwaway LINKED test card via UI writes; drift only on an unlinked one. Step 5 |
| L1 | Stale text; the 5 winners are all test data | Fixed; no special case. 3.3, 7.1, section 9 |
| L2 | Caption edits on the boards for a non-card version | Stay blocked; a change goes through "ask for a change". Step 8 |
| L3 | CTA and Post for Me | The call to action is not posted. Section 6 |
| L4 | Instagram claim | Holds; recorded in 3.4 |
| L5 | Kasper's old shared core in `305` | In 1a's inventory and 1b's readers. 2.2, step 1a |

**Three questions from the review (all answered 4 Nov ~22:10):**
- **Q-P.** **Answered:** the test-client trial cards are deleted by Sidney (he makes new ones). The one real Posted card finishes on the old rules and is left alone; nothing has to be done to it. The plan builds the `rules` marker (2.2) so it stays on the old rules when the flag reaches its client.
- **Q-Q.** **Answered:** only Version C is marked Tweaks Needed; the card and the Production work item keep their status. 3.5 shows where C's tweak appears.
- **Q-R.** **Answered:** yes. A trial needs at least two live versions; with one left it posts as a plain card.

## 14. Second Opus review (session Trialjourney, 4 Nov) and what changed in revision 9

Verdict: 10 HIGH, 13 MEDIUM, 9 LOW against revision 7. All applied in revision 9; **Sidney's answers (section 15) then replaced the fixes for H2, H3 and H5**. Live counts it read (4 Nov, counts only): enabled trial cards by card video status, real 2 In Progress, 2 Kasper Approval, 1 Posted (none Scheduled); test 18 In Progress, 4 Kasper, 2 Client, 2 Approved, 2 Tweaks, 1 For SMM, 4 Posted; versions: 4 on trial, 5 winners, 26 change asked, 12 with the client's "Not this one", 120 of 120 live B to E rows with no own thumbnail.

| # | Finding | Where it landed |
|---|---|---|
| H1 | Client "Not this one" absent: gate, route, pips, two-live miscount | `counted` = live and not passed, everywhere; grid and strip wording. 2.2, 3.4 step 1 |
| H2 | The 06:00 start freezes versions before the Post tab sends them | Revision 9 made the Post tab's send the start; **superseded by S2 (section 15)**: the start stays the morning rule or Start trial, and On trial no longer blocks posting or fixing |
| H3 | A client cannot ask for a change on a Scheduled card | **Superseded by S1 (section 15)**: that is wanted; the client can only leave notes after Scheduled |
| H4 | The swap is not safe across a reload and can lose A's fields | A's four fields first, `swap_record` marker, "Finish / Put back". 3.3, step 5 |
| H5 | "Empty = same as the card" does not survive the swap | **Resolved by S4 (section 15)**: inheritance points at Version A and is explicit through the swap; `swap_record` tells an edit from an untouched copy. 3.3 |
| H6 | Route writers outside `routeStatusFor` | Named, routed through one writer, with a bypass test. 2.2, step 1b |
| H7 | The editor has no correct action when a version comes back | New cut ready on the version row, same-link wording, A row labelled and confirmed, per-version rows on the thumbnail sub-issue, "A's work item is A's only". 3.6, step 5b. **S5** |
| H8 | Today misses version work and cannot pass its test on the test client | Per-version Today lists, no Scheduled exclusion, test-client bypass. 3.6, step 1b |
| H9 | The robot skip catches too much | Skip only while the trial is open; `trial_closed_at`; one-live-version falls back. 3.4 |
| H10 | Held client changes undo later approvals; approves are never kept | Re-read before re-send, queue approves, key by who is signed in. 3.6, step 1c |
| M1 | Per-part model mismatch, circular `placeOf`, whole-version restart | Per-part `parts` column; words derived; only the changed part restarts; `placeOf` ignores the route value on v2. 2.2, 7.1, section 8 |
| M2 | One change note per version | Per-part notes inside `parts`. 2.2 |
| M3 | Switch off then on leaves A stale; off would lower the card | On always copies; off never lowers Scheduled or Posted. 2.2 |
| M4 | Q-P needs a stored marker | `rules` column, backfilled when the flag is turned on for a client. 2.2 |
| M5, M6, M7 | Redo key; deleting a change comment; borrowed thumbnail | 3.6, step 8 |
| M8 | Card write and version write split in 305 | The writer reconciles. 2.2 |
| M9, M10 | Dead-link probe; thumbnail revision baseline | 3.3 |
| M11 | Other single-card readers | 3.6, step 1a |
| M12 | Stuck with no signal | Quiet Today line; fall back to the Posted robot. 3.6. **S3** |
| M13 | Route ambiguity | One sentence: once scheduled, the writer does not move the card until the winner. 2.2 |
| L1 to L9 | Analytics; Kasper's stale board; rounds; Messages inbox; overdue bump; "Video C"; shared held list; client as actor; no Slack to creatives | 3.6, 3.4, 2.2 as noted there |

**Seven questions for Sidney (all answered 4 Nov ~23:00; section 15):**
- **S1.** After a trial card is Scheduled, can the client still ask for a change on one version, which holds the trial? Default: yes. Example: Scheduled for Friday, Thursday the client asks to change C's caption, Friday the trial waits until C is fixed.
- **S2.** When does "on trial" start: 06:00 on the date, or when the SMM sends the reels from the Post tab? Default: when sent; 06:00 only if nothing went through SyncView. Example: the SMM posts at 15:00; until then C's caption typo can still be fixed. **This changes his Q-N.**
- **S3.** A quiet Today line "2 trials running: pick a winner", not a ping? Default: yes.
- **S4.** A winner with no thumbnail of its own (every B to E today): block, or post with A's? Default: ask once and record it as the version's own.
- **S5.** Who does a version's thumbnail change: the designer on the thumbnail sub-issue (which needs per-version rows) or the SMM pasting a link? Default: the designer.
- **S6.** Weekly analytics: count each trial reel, or only the winner? Default: only the winner; the losers listed under "trial reels", unranked.
- **S7.** The 4 real trial cards mid-review today: old rules or new? Default: new (none is Scheduled yet).

## 15. Sidney's answers to S1 to S7 (4 Nov ~23:00 UTC), and what changed in revision 10

| # | Sidney's answer | Where it landed |
|---|---|---|
| S1 | "If it's scheduled it shouldn't be able to be changed by the client." | After Scheduled the client can only leave notes (no change request, no "Not this one"). The reopen-gate widening of H3 and the client-change hold are dropped; no `production-write` client policy change, so no re-pin from this. Q-O's hold stays for **staff** sending a version back; what staff can do after Scheduled is listed in 3.6 |
| S2 | "No, cause maybe some SMM will post from their phone." | The trial starts on the morning of the scheduled date (06:00 ET) or by Start trial, never from the Post tab. H2 is re-solved by the simplest rule: On trial changes nothing about posting or fixing until the winner is picked; no `sent_at`. 3.4 step 3 |
| S3 | Yes | A quiet Today line "N trials running: pick a winner". 3.6, step 9 |
| S4 | "By default a version should inherit the old main card thumbnail and caption, unless changed." | Inheritance points at Version A, explicit through the swap; the winner posts with A's inherited value without a prompt; the ask-once prompt is dropped; `swap_record` tells an edit from an untouched copy at Clear. 3.3 |
| S5 | "Both can." | The designer on the thumbnail sub-issue and the SMM pasting a link are both allowed. 3.6, step 5b |
| S6 | "Isn't the analytics being tracked on social media? I'm pretty sure it wouldn't track the trial to begin with." | Written as an expectation: analytics reads the public profile, a trial reel is shown to non-followers, so it should not appear; no change to analytics; one counts-only check to notice if it ever does. 3.6 |
| S7 | New rules ("but I don't know when this will go live"). | The `rules` marker is decided on the first read under the v2 flag, from the card's state at that moment. 2.2 |

**Nothing is open for Sidney.** One engineering default of mine is marked in 2.2 for the next review to check: a card already Scheduled when the flag is turned on stays on the old rules (`v1`).

## 16. Rules added in revision 11 (third review)

Each is a rule with a test. Line references are to the code the review read.

### 16.1 "On trial" is a lifecycle state; approval lives in the parts (review H1, M11)

On a v2 version, `status` is a **lifecycle** word (waiting, on trial, dropped, winner, lost, no clear winner), and whether a version is approved is read from its **parts** (2.2). Today an edit sets the version's status back to `waiting` (`logic.mjs:773`), `placeOf` returns "on trial" before it looks at any stamp (`263`), and several functions refuse an On-trial version. All of that is changed for v2 rows, and **the sites are listed in step 4**: `answerPatches` (`345`) and `versionStatusPatches` (`677`) refuse `version_on_trial` and now read and write parts; `linkChange` (`452`) keeps approvals on a replaced link for an On-trial version and now **restarts the video part**; `newCutPatch` needs "change asked" (`486`) and now works on parts; Drop (`495`), Add (`198`) and Import (`389`) have their own on-trial rules below; `winnerPatches` (`562`) refuses a version that is no longer the status it expects and now reads parts; `versionFieldsPatch` (`766-773`) now restarts only the changed part. **An edit never moves a version off On trial.** **Pick the winner requires all three parts approved** and otherwise refuses with a plain line: "Version C's caption fix is not approved yet." **One status rule (review M3): a version's `status` is the lifecycle word when it is dropped, on trial, winner, lost or no clear winner, and otherwise derived from its parts (waiting, approved, change asked).** **One helper, `approvedByParts(v)`, includes A's inherited parts and is used by the gate, the Pick, the Post tab, `cardApprovable` (`logic.mjs:294-296`), `stageDone` (`286`), Kasper's board and `higgsfield-mcp/trialreels.mjs`**; `trial-reels` writes `status` by that rule on every write, and **a test asserts the rule and that the readers never disagree** (`299:273`, `readShape`). Drop is allowed while a trial runs; if one counted version is left the strip says "only Version B is left: pick it or end the trial". **Add and Import are refused while a trial runs** ("the trial is running; end it first"), so a version added late never sits half in a trial. Tests include: a new link on an On-trial version restarts its video part and the version stays On trial; a winner cannot be an unapproved fix.

### 16.2 A staff send-back after Scheduled: the sender chooses whether the client must approve again (review H2; Sidney's Q1)

Sidney: "depends, if it's for client approval or not; that depends on the SMM and Kasper." `placeOf` ends at the client, and the client cannot act on a Scheduled card (S1), so a send-back would wait on someone who cannot answer, and the only escape today is the SMM stamping a fake client approval (`client_ok_at`).

**The UI choice.** The send-back dialog (SMM and Kasper) has one checkbox under the note: **"Needs the client's OK again"**, **off by default**. Off: the route is **team only**: the SMM, then Kasper where the version's route includes him, then Approved. On: the route is the same and then **ends at the client**. The choice is stored on that part's change record (`parts`, 2.2), so it survives a reload.

**What the client sees when it is on.** The client link shows **only that version**, with **Approve** and the note box, and **nothing else**: no change request, no "Not this one" (S1). The version is counted but not approved while it waits, so the trial waits for the client's approval, and the strip says "Waiting for the client's OK on Version C". When it is off, the client link shows the version read only, with the note box.

**The server rule.** `trial-reels` refuses a client **change** or **pass** on a v2 card that is Scheduled or Posted with `card_scheduled`, as before (a direct-call test, since `answerPatches` has no card check today), **and allows a client Approve only for a version that has a "needs the client's OK again" send-back open** (otherwise `card_scheduled` too). A client's Approve on that version clears the flag and counts as the client's stamp for that part; the held-queue code (`194:643-690`) cannot re-send a stale change, only that Approve, and only with the matching `expected_revision` (16.6). **The way out of the wait is the version's normal status menu, as today (Sidney, S-A: "usually if the SMM wants to skip the client, he just clicks on the status and changes it himself on the content calendar").** **The card's own menu (D1) stays available to the SMM and Kasper at all times, including on a version with an open needs-client send-back**, and setting that version to **Approved clears the wait** and is recorded in the history as that person's change, exactly like a status change today. There is **no untick flow, no "Client said OK" button, and no rule against staff stamping for the client**, and no "Copy client link" button. **The client sees Approve only after the team has approved the fix** (`stageReady`/`throughTeam`); before that the client link says "Your team is updating Version C". The waiting strip and both client states are in the mockup list.

**Tests:** (1) schedule, staff send C back with the box off, SMM approves, Kasper approves, C counted again, the trial starts; (2) the same with the box on: the trial waits, the client's Approve starts it, a client change or pass is refused with `card_scheduled`; (3) a client Approve on a version with no open "needs the client's OK" send-back is refused. **Test (4):** with a needs-client send-back open, the SMM sets the version to Approved from the status menu: the wait clears, the history names the SMM, and the trial can start. **Both dialogs, the client's Approve-only view and the waiting strip are in the mockup list.**

### 16.3 The swap protocol (review H3, M7, M8)

`swap_record` is one object: `{attempt_id, direction (pick or clear), started_at, by, before, placed, steps_done[]}`.
- **One attempt at a time:** a new attempt may start only when the record is **empty or `done`** (a checked update; never while `pending`); every step checks its `attempt_id` before writing. **Before it replaces a `done` record, the attempt first files the outgoing card version's fields into its own row, explicit only where they differ from the old `placed`** (so a switch-off's `done` record never blocks the next pick or switch-off, and never throws away the `placed` values that say which fields were the card version's own and which inherited, 3.3 (c) and (d)). **Clear works only on a `done` record whose direction is `pick`.** The `trial-reels` action that writes the marker and the outgoing version's four fields is a new one (working name `swap_begin`): `version_fields_set` refuses the card's version (`version_is_card`) and On-trial versions and has no call to action, so it cannot do this. **Test:** switch off choosing B, switch on, pick C, Clear: B comes back as the card with its own edits, and A's inherited fields are still inherited.
- **While it is pending:** `trial-reels` refuses version writes (`swap_in_progress`), and the page refuses card-field saves, including Kasper's board (`305:363`, `321:611`). **The lock also covers Production and the caption jobs (review M4):** the "on the card" row's Edit on the video sub-issue is `production-write` `attachment` (`240:2728-2737`, `210:225`), not `version_link_set`, and any creative may attach (`policy.mjs` ~350) with only a compare-and-set check, so while the marker is pending Production disables Edit on the card's rows on **both** sub-issues (it already reads `trial-reels`); `healMainPatch` (`logic.mjs:468-475`) does nothing while the marker is pending; and `caption-generate` jobs, bulk ones included, carry the card's version letter and the swap counter and refuse on a mismatch. The Finish / Put back verify step is the backstop. The strip says "Version B is being made the card…" and edits are refused.
- **"Did not finish" appears only after about two minutes without progress.** Then the strip offers **Finish** or **Put back**, and either one first takes over the `attempt_id`.
- **The Posted robot also skips a card whose marker is pending** (it could otherwise post between `winner_set` and the Posted write): the due() skip covers `swap_record` pending as well as an open trial.
- **Clear the winner uses the same marker** with `direction = clear`. **The in-memory undo (`189 _trlCardFieldsBefore`) is removed.** The winner write today has no state check (`index.ts:691`); it gets one.
- **Steps are separate entries in `steps_done`**, including the three that make up Posted (video, graphic and card, `140:2180-2205`).
- **Dead links (M7):** before a pick, the winner's link and thumbnail are checked (`link_states`), and before a Clear, A's are, because the attachment probe checks the link being attached (`production-write index.ts:5747-5754`). A Clear whose target no longer opens is **refused, never partly done**: "Version A's video no longer opens: paste a working link first." (`assertGraphicsApprovalArtifact` is not on the swap path, since it runs only for a move to SMM approval, so it is not part of the pre-check.)

- **Clear can never be refused for good (review H1).** Losers are locked after the pick (`linkPatch` refuses a lost version, `logic.mjs:433`) and (before S-B) switching off was refused while a winner existed, so a dead link on A would have made Clear impossible. **One written exception to the loser lock:** the version named in `swap_record.before` (Version A) **accepts a new link or thumbnail while a winner exists**, checked with `link_states`. **The Clear dialog offers that paste in place** when the pre-check fails. The old sentence that Clear may leave the link as it is is removed. **Test:** pick B, make A's link private, Clear is refused, paste a public link in the dialog, Clear completes. **One field Clear (and Put back) cannot always restore (review M6):** `attachment` refuses an empty URL (`production-write index.ts:5694`, `invalid_artifact_url`), so on a card with a graphic item that had **no thumbnail** before the pick, the winner's file stays on the graphic item. The Clear and Put back dialogs then say "Version A has no thumbnail: paste one, or keep Version B's for now" (the paste-in-place above). **This is the only field Clear can leave behind.**
- **A stale card save cannot undo a swap (review M4).** On v2 trial cards, **every card-field save re-reads the trial row** (the card's version letter and a **swap counter** bumped per pick and per Clear) and refuses on a mismatch: "This card is now Version B. Reload." **Kasper's board keeps no local copy for trial cards.** Clear's confirm names the fields it keeps as B's own. Scope: v2 trial cards only (the 305 and 321 code is shared with every card).
- **Takeover without a race (review M5).** The marker (with `before`) is written first, then A's row; **the page re-checks `attempt_id` before each step**; **Finish and Put back each end with a verify step** (re-read the link, thumbnail, caption and call to action, redo any that differ, then clear the marker). **Test:** a first page paused mid-swap while a second page takes over.

### 16.4 Inherited parts and approval (review H4, L5, L7, Q3)

An inherited part has **no approval of its own**. Version B's inherited caption shows as "Using Version A's caption · follows A's approval" and **counts as approved only while A's is**: the gate, the Post tab and the Pick all check A's inherited parts too. "Give Version B its own" **starts that part at For SMM Approval**, and the mockup shows the pill. (Sidney: yes, Q3: no extra approval; B follows A.) For a card that has a graphic work item, an inherited thumbnail reads the graphic file (L5). After a winner, `readShape` today gives the losers only their own fields (`logic.mjs:617`); under S4 they inherit Version A's row, and step 5 names that change (L7).

### 16.5 Build order changes (review H5, M12)

- **Step 1a-bis** (new): the migration columns and the pure, tested functions (`routeStatusFor`, `counted` and the gate, the effective-fields helper) **before** step 1b, which needs them.
- **Steps 1b and 1c reach every client, not only the test client**: `trial_reels_pages` is on for all clients and `trial_versions_v2` only gates the new look. So each states which of its changes apply to everyone, and **v1 regression tests prove today's queues, Today lists and held-change behaviour are unchanged** for `rules = 'v1'` and for cards that never had a trial.
- **The due() skip migration is live before step 4 reaches the test client.**
- **Step 4 starts trials that only step 5 can end**: the start sits behind **its own sub-switch** (`trial_versions_v2_start`) until step 5 merges, **on for the test client only while it is tested** (the build session clears those test trials before step 5, review L9); shipping 4 and 5 together is the alternative.
- The migration columns are the one list in 7.1 (ten; no `sent_at`).

### 16.6 Posting, starting and writing (review H6, M1 to M6, M9, M10, L2 to L4, L6)

- **Post tab "From a card" (H6).** Today it lists only Approved or Scheduled cards, never Posted (`299:491`), drops cards dated before today (`299:504`), and reads `v.status === 'approved'` (`299:273`). Rule: **a v2 trial card is listed while its trial is open, whatever its date**, and its versions are read by their parts. **Posting a winner is new work (review M6):** the Post tab lists only Approved or Scheduled cards (`299:491`), drops dated-before-today (`299:504`) and reads `v.status` (`299:272-273`), so **a v2 card with a winner is listed for 7 days after the pick, whatever its date, as an ordinary card using the card's (the winner's) fields, with no prompt**. **The Post tab refuses a card whose `swap_record` is pending** ("Version B is being made the card…", L5). After a winner the card is Posted, and **SyncView neither forces nor forbids posting the winner** (Sidney's Q2: "it's the SMM that does what he wants; it doesn't matter if he uses SyncView or the phone to upload, he decides"): the Post tab still allows posting the winner if the SMM wants to, with no block and no prompt, and **nothing in the plan assumes it was, or was not, posted from SyncView**.
- **Start trial is new work (M1).** Today `trial_start` refuses unless the card is Posted and writes nothing (`index.ts:672-675`), `trialPatches` (`logic.mjs:509-518`) is unused and sets the 24 h end, and `svTrialStart` (`189:1470`) shows the 24 h optimistically. The new Start trial: the gate, the route value Scheduled, **no `trial_ends_at`**, a ledger line, idempotent, and **shared with the morning rule**.
- **The morning rule (M2).** "Now in ET is on or after the scheduled date at 06:00", and it requires the route value Scheduled; `readCard` must read `scheduled_date`, `status` and `cta` (`index.ts:213`). **Unschedule at 06:01 runs the start rule first.** Moving the date: to today starts it, after the start nothing moves; both are in the mockup.
- **The gate (M9).** **Every live version is approved or dropped**; a version the client passed on must be dropped or asked again (it blocks until then). "At least two" counts live versions that are not passed.
- **Concurrency (M3).** `version_fields_set`, `version_link_set`, `version_status_set` and `answer` take an `expected_revision` and answer 409 `conflict` when it moved; the page keeps a local draft per card, letter and person until it is read back.
- **Held jobs (M10).** A held client job stores the version's revision and sends `expected_revision` (`version_moved` when it moved); a job held before step 1c, which has none, is sent as a note; a queued approve is the same.
- **The status bridge (M4).** It is a SQL trigger (`2026-10-01-calendar-overall-status-bridge.sql:143-230`; the live body may be the `2026-10-08` file, step 1a reads which) and cannot call `routeStatusFor`, which is the **only SyncView-side writer**. `trial-reels` returns `route_status` computed from fresh rows with every answer; the page writes it with the card's compare check; a mismatch sets `route_behind`, which is healed or warned about. Step 1a tests moving a v2 work item in Production.
- **Rules marker (M5).** `rules` null is decided on the first read under the v2 flag (an only-if-null write), and `switch_set` writes `v2` **only when `rules` is null** (a v1 card switched off and on stays v1: switching the one real Posted v1 card off and on must not convert it mid-flight); the page branches on **the card's `rules`, not the client's flag**, so a v1 card keeps the old list and the old pick.
- **Switching off and on (M6, review M1).** **One order: the card's columns first, then `switch_set`** (23.1 step 1 follows it), with a recovery when refused, and never lower a Scheduled or Posted card. **`switch_set` reads the card's `updated_at` on the server as its last step and stores that** as `card_updated_at_off`, so the route write and any Production attachment or bridge move during a swap (the 2026-09-05 attachment SQL bumps `calendar_posts.updated_at`) cannot make every switch-on look like "changed while off". On: map a Scheduled or Posted card to all parts approved, and, only if the card changed while off, copy the card's part states into the card version's row. **What the copy writes into a part:** the stamps the card's status implies, and the "what was approved" values of 21.3 taken from the card's current link, thumbnail hash and caption hash, so a copied "Approved" still matches; per-part notes already in the row are kept.
- **Writes inside reads (L3)** are conditional, idempotent and logged as the system. **The Posted robot's switch (L2)** is read in step 1a (`STATE_OF_THINGS` says it is off); the quiet Today line also covers "trial ended, not Posted". **The analytics check (L4)** compares only versions that have their own caption and only when the card's `post_url` is set. **A quiet "does not change Instagram" note (L6)** shows on any edit after Scheduled.

### 16.7 End the trial without a winner (review L1)

New work, defined: every On-trial version becomes `no clear winner`; `trial_closed_at` is set; the switch row stays enabled; the card's version stays the card's version (`card_letter`); **the client link hides the trial and shows only the card's version**; the Posted robot takes the card again. **Q-S (default, pending Sidney): a trial ended with no winner can run again** after a switch-off and switch-on (23.1 step 4), which replaces the earlier "a closed trial is not reopened". **Step 5 names the `readShape` change** (`logic.mjs:600`) that makes a closed or finished trial read as the card's version and, after a winner, gives the losers Version A's row for inherited fields.

## 17. Third review (Trialreview3) and what changed in revision 11

| # | Finding | Where it landed |
|---|---|---|
| H1 | "On trial stays editable" breaks (edits reset status; seven refusal sites; winner can be an unapproved fix) | 16.1, step 4 |
| H2 | A staff send-back after Scheduled routes to a client who cannot act; the server lets the client act | 16.2 |
| H3 | `swap_record` needs a protocol | 16.3 |
| H4 | Inherited-field changes under an approved version | 16.4 |
| H5 | 1b needs step 2; 1b and 1c reach every client | 16.5, step 1a-bis |
| H6 | Post tab lists only Approved or Scheduled and reads `status` | 16.6 |
| M1 | `trial_start` is new work | 16.6 |
| M2 | Morning rule details | 16.6 |
| M3 | Concurrency | 16.6 |
| M4 | The bridge is a SQL trigger | 16.6 |
| M5 | `rules` null decided on first read; page branches on the card | 16.6 |
| M6 | Switch off and on | 16.6 |
| M7 | Dead-link probe on the link being attached | 16.3 |
| M8 | Posted is several writes | 16.3 |
| M9 | The gate is every live version | 16.6 |
| M10 | Held jobs store the revision | 16.6 |
| M11 | `status` written from parts on v2 rows | 16.1 |
| M12 | Step 4 starts trials only step 5 can end | 16.5 |
| L1 | Stale text | Fixed in 2.2, 8, 11 and 9; End the trial defined in 16.7 |
| L2 to L7 | Posted robot switch; writes inside reads; analytics check; graphic-item cards; "does not change Instagram" note; `readShape` after a winner | 16.4, 16.6 |
| Build table | The due() skip must be live before step 4 reaches the test client | 16.5 |

**Three questions for Sidney (defaults applied until he answers):**
- **Q1.** A staff send-back after Scheduled goes to the SMM, then Kasper where he is on the route, then Approved; the client sees it read only with a note box. Default: yes. **Answered, with a choice added, see section 18.**
- **Q2.** After a winner, the winner is posted as an ordinary post by a person from the Post tab. Default: yes. **Answered, see section 18.**
- **Q3.** An inherited part follows Version A's approval, with no extra approval needed. Default: yes. **Answered: yes, see section 18.**

## 18. Sidney's answers to Q1 to Q3 (4 Nov ~23:20 UTC), revision 12

| # | Sidney's answer | Where it landed |
|---|---|---|
| Q1 | "Depends, if it's for client approval or not. That depends on the SMM and Kasper." | The person sending a version back chooses whether it needs the client's OK again (a checkbox, off by default = team only). If on, the client link shows that version with Approve only; the server allows only that Approve, `card_scheduled` still refuses change and pass; the trial waits. 16.2; both states in the mockup list |
| Q2 | "It's the SMM that does what he wants. Doesn't matter if he uses SyncView or phone to upload, he decides." | After a winner the card is Posted; the Post tab still allows posting the winner (no block, no prompt); nothing assumes it was or was not posted from SyncView. 16.6 |
| Q3 | Yes | An inherited part follows Version A's approval, no extra approval. 16.4 |

**Nothing is open for Sidney.**

## 19. Fourth review (Trialreview4) and what changed in revision 13

Verdict: close; 2 HIGH, 6 MEDIUM, 6 LOW, all text fixes.

| # | Finding | Where it landed |
|---|---|---|
| H1 | Clear can be refused forever (losers are locked, switch-off is refused) | One written exception to the loser lock for the version in `swap_record.before`; the Clear dialog offers the paste; test written. 16.3 |
| H2 | "Needs the client's OK again" has no exit; "no staff can stamp" was unscoped | **Simplified by S-A (section 20)**: the version's normal status menu stays available to the SMM and Kasper at all times; setting it to Approved clears the wait; no untick flow and no rule against staff stamping. 16.2 |
| M1 | Carry Q1 into 3.6 and steps 1b and 8 | 3.6 (1), step 1b (server rule and client-queue override), step 8 (Approve-only view; "Your team is updating Version C" before the team approves) |
| M2 | The robot can post an open trial | Skip clause: trial open and (any version On trial or at least two counted); "counted but not approved" wording; test written. 3.4, 16.2, 3.6 |
| M3 | One status rule | Lifecycle word, else derived from parts; one `approvedByParts(v)` helper including A's inherited parts, named in every reader. 16.1 |
| M4 | Stale card saves after a swap | Every card-field save on a v2 trial card re-reads the trial row and refuses on a mismatch; Kasper's board keeps no local copy. 16.3 |
| M5 | Takeover race | Marker first, then A's row; re-check before each step; verify step; paused-page test. 16.3, 3.3 |
| M6 | Posting a winner is new work | Listed for 7 days after the pick, whatever its date, no prompt; refused while a marker is pending. 16.6, step 9 |
| L1 | `rules` decided on first read | 2.2, S7 row |
| L2 | Switch-on copy only if the card changed | `card_updated_at_off`. 2.2, 16.6, 7.1 |
| L3 | due() skip live before step 4 reaches the test client; step 2 uses the 1a-bis columns | 3.4, 7.1, step 4, step 2 |
| L4 | Step 4 testing | Sub-switch on for the test client only while tested, or ship 4 and 5 together. 16.5 |
| L5 | The Post tab refuses a pending marker | 16.6 |
| L6 | Name the `readShape` change; "Sidney: yes" for Q3; section 9 preamble | 16.7, 16.4, section 9 |

**One question for Sidney (answered in revision 14, section 20):**
- **S-A.** **Answered (section 20):** no untick flow; the normal status menu is the way out. No default is pending.

## 20. Sidney on S-A (4 Nov ~23:45 UTC), revision 14

| # | Sidney's answer | Where it landed |
|---|---|---|
| S-A | "I don't want to overcomplicate things. Usually if the SMM wants to skip the client, he just clicks on the status and changes it himself on the content calendar. So that's it." | The version's normal status menu (D1) stays available to the SMM and Kasper at all times, including on a version with an open needs-client send-back; setting it to Approved clears the wait and is logged as that person's change. Dropped: the untick flow, a "Client said OK" button, the rule against staff stamping for the client, and "Copy client link". 16.2 |

**Nothing is open for Sidney.**

## 21. Rules added in revision 15 (review round 5)

### 21.1 A closed or never-starting trial is an ordinary card (review H1)

A trial that ends with no winner, or is left with one counted version, would sit at Scheduled with no status pill on a v2 card, and the Posted robot may not be live (`STATE_OF_THINGS:1361` says its switch is off; it moves a client only when `calendar_auto_posted_client_on` is set). Rule: **once a trial is closed or can never start, the card becomes an ordinary card showing the card's version with its normal status pill**, and is Posted by the robot (if it is on for that client) or by a person. **"Warned about" applies only while a trial is open.** Step 1a **reads whether the robot's migration is live and puts the skip clause wherever `calendar_auto_posted_due` really comes from**, since a `create or replace` of the function elsewhere could drop it; **a test runs with the robot off**.

### 21.2 `swap_record` has a state (review H2, L11)

`swap_record` carries `state` = `pending` or `done`. **Every "while pending" rule (edits refused, card saves refused, the Post tab refusing, the robot skip, "did not finish") checks `state = pending`.** When a pick or Clear finishes, **`before` and `placed` are kept with `state = done` until a Clear finishes**; **Clear starts from `done`**. `trial_reel_cards` also gets **`swap_count`** (an integer, bumped per pick and per Clear; 7.1, step 1a-bis), which the stale-save guard (16.3) compares. **Writes that carry the current `attempt_id` are exempt from the swap guards.** Tests: after a finished pick, saves, the Post tab and the robot behave normally and no "did not finish" shows; Clear still keeps B's own edits.

### 21.3 An approval remembers what was approved (review H3)

Editing Version A through the card's own columns (the card save, Kasper's board `305`, `caption-generate`, Production's attachment and Edit, the graphic sub-issue, SyncMate) never took back the approval of A or of a version borrowing from it (`version_is_card`, `logic.mjs:752`; `attach_first`, `431`). Rule: **each part's approval stamp stores what was approved**: the video link, a hash of the thumbnail URL, a hash of the caption (**the call to action rides with the caption**). **`approvedByParts` compares the current effective value with the stored one; a mismatch reads For SMM Approval.** Tests: an edit through the card, through Kasper's board and through `caption-generate` each returns the part to For SMM Approval.

### 21.4 Production moving a work item (review M1b, replaced by review round 6, H4)

**Replaced.** The earlier rule ("a bridge move of A's work item is read as the same move of the card's version's matching part") is **withdrawn**: the route writer's own push fires the bridge with the same history row as an editor's move (`source = 'native-bridge'`, `actor = null`), so the two cannot be told apart and an editor delivering C's fix would un-approve Version A's video. The rule now is in 2.2 and 3.6: **the work item carries the route value, never one version's state; a work-item status that differs from `route_written` is a person's move and never changes any version's parts; the card follows it through the bridge as today.** `trial_reel_cards` still gets `scheduled_at` (when the card was Scheduled) and `route_written` (7.1). Step 1a tests both cases (before Schedule, after Schedule) on a throwaway **linked** card.

### 21.5 Rules null (review M2)

Step 1b's new reading applies **only to `rules = 'v2'`; a null `rules` counts as v1**, with a regression test for null.

### 21.6 Hiding the old list and dropping the 24 h (review M3)

Step 5 hides the old list and drops the 24 h readers **only on v2 cards**. Removing them for v1 is a **separate cleanup** once no v1 trial is open.

### 21.7 Where "New cut ready" lives (review M4)

Step 5 puts **"New cut ready" on the selected tab's Video row** (3.2). Step 5b only adds it to Production's version row.

### 21.8 Winner undo, switch-off, "ask again" and send-back part (review M5, M6; S-B, S-C)

- **Undo the winner (S-C):** a **"Clear winner"** button sits in the trial strip after a pick (SMM and admin), with a confirm that names the fields it keeps as B's own (16.3). Default: available for as long as the winner is the card's version.
- **Trial switch off (S-B, answered):** **allowed**, with a dialog that asks which version becomes the card (23.1). The earlier "refused" default is withdrawn.
- **"Ask again" after the client's "Not this one":** the SMM or Kasper **sets the version to Client Approval from its status menu**, which clears the pass (`versionStatusPatches`, `logic.mjs:695`). It is written in 2.2 and on the strip, and it is in the mockup list.
- **A staff send-back names the part** (like `change_part`): default **Video**, and **only that part restarts**. The send-back dialog's part picker is in the mockup list.

### 21.9 Smaller rules (review L1, L3 to L8, L10)

- **L1.** The Schedule gate is checked on the page; **the server holds the start** (it will not start a trial the gate would refuse).
- **L3.** Section 6 now says the Post tab lists On-trial versions and cards whatever their date.
- **L4.** After Scheduled the client sees a trial card **only while a version has an open needs-client send-back, and only that version has Approve** (16.2, 3.6; the read-only all-versions view was dropped in revision 17, review M8).
- **L5.** A queued client Approve on a version that is already approved is done: it is dropped quietly.
- **L6.** The Pick's refusal names the owner of a borrowed part: "Version A's caption (used by B) is not approved yet."
- **L7.** `post-source` (`handler.mjs:149`) uses the effective-fields helper in step 9.
- **L8.** After a winner the normal status pill returns; moving the card off Posted by hand does not undo the winner; `routeStatusFor` stops writing.
- **L10.** Step 1a lists everything that reacts to Scheduled or Posted (notifications, reports).

## 22. Review round 5 (Trialreview5) and what changed in revision 15

| # | Finding | Where it landed |
|---|---|---|
| H1 | A closed or never-starting trial gets stuck at Scheduled; the robot may be off | 21.1, step 1a |
| H2 | `swap_record` cannot be both cleared and kept | State pending or done; `swap_count`. 21.2, 7.1 |
| H3 | Editing A through the card never takes back approval | Stamps store what was approved. 21.3 |
| M1 | No lazy fill; a bridge move of A's work item | 2.2, 7.1, 21.4 |
| M2 | Rules null counts as v1 | 21.5, step 1b |
| M3 | Step 5 only on v2 cards | 21.6, step 5 |
| M4 | "New cut ready" on the tab's Video row | 21.7, steps 5 and 5b |
| M5 | Undo winner; switch off while running; "ask again" | 21.8. **S-B, S-C** |
| M6 | A send-back names the part | 21.8 |
| L1 to L11 | Gate on the page; one column list; section 6; client after Scheduled; queued Approve; Pick refusal names the owner; `post-source`; the pill after a winner; test trials; reactions to Scheduled and Posted; attempt-id exemption | 21.2, 21.9, 7.1, section 6, step 9 |

**Two questions for Sidney (both answered in revision 16, section 23):**
- **S-B.** **Answered (section 23):** switching off is allowed and asks which version becomes the card.
- **S-C.** **Answered: yes (section 23).**

## 23. Sidney's answers to S-B and S-C (5 Nov ~00:20 UTC), revision 16

| # | Sidney's answer | Where it landed |
|---|---|---|
| S-B | "SMM will probably just pick a winner... But they can also untoggle it. If they untoggle it, they should be able to choose the default one, and they should be able to retoggle it if they want to." | Switching the trial off is allowed (running or not, with or without a winner); the dialog asks which version becomes the card; switching back on restores the versions. 23.1. The earlier "refused" default is withdrawn |
| S-C | Yes ("Clear winner" in the strip with a confirm) | 21.8 |

### 23.1 Switching the trial off and on

**The dialog (SMM and admin, v2 cards only).** "Switch off the trial?" with a radio list of the card's live versions: **"Keep Version A"** (the default; or "Keep Version B" when B is already the card's version), then **"Make Version B the card"**, **"Make Version C the card"**, and so on. A line says "The other versions are kept, hidden. You can switch the trial back on." Buttons: Switch off, Cancel. **With a winner there is no choice**: the winner stays the card ("Version B is the card"), the others are hidden. **While the card is Scheduled, the dialog offers only versions whose three parts are approved** (review M3): the others are greyed with the reason ("Version C's caption is not approved"), because switching off never lowers a Scheduled or Posted card and the Posted robot could otherwise post an unapproved caption that night. **v1 cards keep today's switch unchanged.**

**New column: `card_letter`** on `trial_reel_cards` ('A' to 'E', default 'A'): the version whose four fields (link, thumbnail, caption, call to action) are on the card. It is set by a pick, by this dialog's choice, by dropping the card's version (Q-T) and by a Clear (**back to `swap_record.before.card_letter`, not blindly to A**), and `mainLetter` reads it (replacing the "carried" rule that made a link write silently change the card's version). Added in step 1a-bis, filled from `mainLetter` for every enabled card (7.1).

**Data path.**
1. **The chosen version is already the card's version** (Keep Version A before any pick; the winner after one): one write, **after the route writer has set the card's columns** (the one order of 16.6: card columns, then `switch_set`). `trial-reels` `switch_set` sets `enabled = false`; any On-trial version **and any `no clear winner` version** (which `live()` counts as live, `logic.mjs:151`) returns to the status its parts give (waiting, approved, change asked), with no trial leftovers; `trial_closed_at` is not set; `scheduled_at` is kept. The card's columns are set from the card version's parts and a **Scheduled or Posted card is never lowered** (16.6). The card is an ordinary card with its normal status pill.
2. **A different version is chosen** (for example Version B): **the same swap machinery and marker as a pick** (16.3, 21.2), with `direction = off`: the marker first (with `before`), then **the current card version's four fields into its own row** (explicit only where the previous `placed` record shows they were its own), the link attach, the thumbnail, caption and call to action, then the card's columns from B's parts through the route writer, then `switch_set` off with `card_letter = B` (which reads the card's `updated_at` last, 16.6), then `state = done`. **A switch-off record is `done` and is not cleared; the next attempt may start from `done` (16.3), and Clear works only on a `pick` record.** **No Posted write** (that belongs to a pick). The same guards, takeover, "Finish / Put back" recovery, pre-checks of the chosen version's link and thumbnail (16.3), stale-save guard and `swap_count` apply, so a reload in the middle is safe.
3. **Hidden versions** are kept in `studio_trial_versions` and are not shown on any surface (cards, Month and Week, the client link, Kasper's and the SMM's boards, the Post tab, Production's Assets box, which returns to its one "Deliverable file" row), are not counted, and do not hold the card. The Posted robot's skip needs `enabled`, so a switched-off card is not skipped.
4. **Switching back on (Q-S, decided by Sidney 6 Nov: it always lets the SMM finish the trial):** `switch_set` on restores the versions (`rules` stays as it was, 16.6). **The chosen version stays the card's version** and the previous card version's data stays in its row, so no swap is needed. The card's part states are copied into the card version's row only if the card changed while the trial was off (`card_updated_at_off`, 2.2; what the copy writes is in 16.6). `trial_closed_at` is cleared and a trial that ended with no winner can run again: Schedule, Start, Pick (16.7). **A Posted card:** its approved versions go straight on trial so a winner can be picked (what happens today); Start trial and the morning rule are allowed on it even though the route value is Posted, and the strip says so. With a winner, the winner flag is still there. **Inheritance stays on Version A (Q-U).**

**History lines:** "Trial switched off: Version A stays the card"; "Trial switched off: Version B is now the card (Versions A, C kept hidden)"; "Trial switched on: Version B stays the card; Versions A, C shown". Each is written by the person who did it.

**Tests:** (0) a Posted card switched off and on goes straight on trial and a winner can be picked; a trial ended with no winner switched off and on can run again; "no clear winner" versions return to their parts' status at switch-off; (1) off with Keep A, trial not running: the card is unchanged but for its normal pill, the versions are hidden everywhere, on restores them; (2) off choosing B: B's four fields are on the card and A's in A's row, a reload mid-swap offers Finish / Put back, on again shows A and B with B the card's, and the trial runs again; (3) off while a trial runs: the On-trial versions return to approved, nothing of the trial is left, and the Posted robot treats the card as ordinary; (4) off with a winner: the winner stays the card, the others are hidden, on restores the winner flag; (5) off refused while a swap is pending (`swap_in_progress`); (6) the client link and the Post tab show the ordinary card after switch-off; (7) a v1 card's switch behaves as today and stays v1 when switched off and on; (8) off choosing B, on, pick C, Clear: B is the card again with its own edits (16.3); (9) off on a Scheduled card offers only approved versions. **The dialog, the trial-off strip and switching back on are in the mockup list.**

## 24. One sheet per review board and per SyncLinear surface

Sidney asked that every review cover the review boards and SyncLinear. Each sheet says what the surface shows per version, what writes it makes, which build step changes it, and the gaps found.

### 24.1 The client's review link (Review tab and sheet)
- **Shows per version:** one version at a time, as tabs in the Quiet look with the dot of that version's answer for the client (688 part 1); each version's video, thumbnail, caption (an inherited one reads "Using Version A's caption", 16.4), and its three parts each with Approve and Ask for a change, plus "Not this one". **After Scheduled:** the client reaches the card only while a version has an open "needs the client's OK again" send-back, and only that version has Approve, after the team approved the fix ("Your team is updating Version C" before that); otherwise there is no view (3.6, 24.1 gap M8). **After a winner:** only the winner, as an ordinary card. **Trial off or closed:** the card's version only (`card_letter`: Version A, or the one a switch-off chose).
- **Writes:** **every answer on every version, the card's version included, goes through `trial-reels` `answer`** (approve, change, pass) with `expected_revision` (`194:572-605` uses the letter on screen); the card-level approve (`195:3765-3768`) runs only once a stage is finished for all versions, and a change on any version also writes a change note on a card part (`195:3833`); every card-status effect goes through `routeStatusFor`. **The client's caption edit** (`195:2747`, `_rsSaveEdit`) becomes "Ask for a change" on that caption part on a v2 trial card, so it never edits a caption that other versions inherit. The needs-client Approve never uses the card-level Approve guard (`190:918-920`). Drop on the card's version is the confirm swap of Q-T. The held-change queue (`194:643-690`) is keyed by who is signed in, re-reads the version's revision before re-sending, and queues approves like `185`. The server refuses client change or pass on a Scheduled or Posted v2 card (`card_scheduled`).
- **Steps:** 1b (the gates, the queue, the Scheduled override), 1c (held changes), 2 (counted rule), 8 (per-part Approve, the Approve-only view).
- **Gaps added:** the Scheduled card is unreachable today (3.6, review M8: needs the `_rsPartState` override); the held queue's refusal list (step 1c); a client deleting a change comment reopens that part (21.9, M6); the "Loading…" wait for the card's versions stays; phone at 390 and 44 px targets (mockup).

### 24.2 Kasper's Review Session
- **Shows per version:** sections Urgent, Waiting for your review, Tweaks pending, Approved history; a trial card is listed while any version waits for him; each version's tile with its own Approve, Ask for a change, Tweaks are on Frame, Redo (**video row only, keyed by the letter**), Drop, and Approve all; "Sent back to you"; the Trial label.
- **Writes:** `trial-reels` `answer` for **every** version, the card's included (the card-level paths run only when a stage is finished for all versions); **the send-back dialog from Kasper's part row calls `trial-reels` and the route writer, never `_kasperRequestTweakComp` on its own**; every card-status effect goes through the one route writer (2.2), including **Approve after tweaks (`195:3868`), the Undo toast (which also undoes the version stamp, `195:3769`, `4621-4643`) and `_rsTrialToTweaks` with its `_calClearStaleApprovals` (`195:3724-3733`)**. **Drop on the card's version** is the confirm swap "Dropping Version A makes Version B the primary version (the one on the card)." (Q-T), not a bare link move. The "Your notes in Frame.io" link reads the selected version's link (3.6). Kasper's old shared core (`305`, `KASPER_PATCH_SCALARS`, a 24 h local board copy `321:611`) keeps no local copy for trial cards and is guarded against a stale save across a swap (16.3).
- **Steps:** 1b (listing while Scheduled, the route writer), 8 (Redo keyed by letter, stale board test), 5 (after a winner or a switch-off the card is ordinary).
- **Gaps added:** **the staff send-back dialog** (with its part picker and the "Needs the client's OK again" choice, 16.2, 21.8) is available **from the trial strip and from Kasper's part row**; a send-back from Kasper's board is a team-only route by default.

### 24.3 The SMM's Review tab
- **Shows per version:** a trial card is listed while any version waits for the SMM, whatever the card's status; tiles per version; **Approve to Kasper** always (never "Approve to client" on a trial card's video), Edit, notes marked Team only or Client can see, **Change my mind** (scoped to that version's part).
- **Writes:** `trial-reels` `answer` for every version, the card's included; every card-status effect through the route writer, including the non-Kasper Tweaks branch (`_calApplyAutoStatus`, `195:3735`) and `svCalResolveVersionTweaks` (`195:3744`).
- **Steps:** 1b (queue per version, Scheduled included), 8 (per-part approve).
- **Gaps added:** an SMM's fix on a version restarts only that part (21.3, 16.1); the status menu's Approved is available to the SMM and Kasper at all times (16.2).

### 24.4 SyncLinear (the Production tab, sub-issues, the issue page, rename and status sync)
- **The list:** rows are unchanged. A **trial card's parent carries a "Trial · N versions" line** with the version dots (3.5); after a winner, switch-off or a closed trial the line is gone and the parent is ordinary. Status filters follow the route value (a trial card sits at Scheduled while its versions are On trial; a gap added: the Production Scheduled filter lists trial cards, and the "Trial" line says why).
- **The parent's issue page:** a container, status and assignee not editable (as today), with the "Trial · N versions" line, "Open in Calendar" opening the trial card, and "Back to card".
- **Sub-issues (video, thumbnail):** status follows the route value; **the work item carries the route value only** (2.2, 3.6); **versions B to E have no work item** (a test fails if one is ever created). The **Assets box** shows one "Deliverable file · Version A" to "· Version E" row per version with Edit (writes `version_link_set`, the same Production write gate; **the "on the card" row's Edit is `production-write` `attachment`, disabled while a swap marker is pending, 16.3**) and **"New cut ready"** (added in step 5b; the card's tab has it from step 5) and its sharing state; **the thumbnail sub-issue gets per-version rows** (S5). **Feedback & tweaks** shows a version's tweak as "Version C: ..." with Video or Graphics and "Tweak · Round N" (deleting its comment reopens the part). Production **cannot set a version's status** (no work item to set it on).
- **No creating here (standing rule):** there is no New issue or Add sub-issue button, and **no version creates a sub-issue**; "+ Add version" and Import exist only on the content calendar.
- **Rename:** renaming a card renames its linked sub-issues (keeping the "Video N — " prefix) and renaming a sub-issue renames its card (`rename_propagation`, on the server, never blocking a save). **A version's "Version B" label is not a title**: renaming never touches versions, and a swap or switch-off does not change titles. A test covers a rename on a trial card before and after a swap.
- **Status sync:** a status change in Production updates the card's video or graphic status on the server, then the card's overall status is worked out again; a status changed on the Calendar writes both sides. **For a trial card the card's columns hold the route value; the bridge is a SQL trigger and cannot call `routeStatusFor`, so `trial-reels` returns `route_status` with every answer and `route_behind` is healed or warned (16.6);** a person's move of a work item never changes a version's parts, and the writer does not push it back (21.4, 2.2). The drift check compares the work items with the card's route value and stays clean under that rule. After a swap or switch-off the **video sub-issue's file is the new card version's link** (the swap writes it through `production-write` `attachment`).
- **Steps:** 1a (inventory and the bridge test on a throwaway **linked** card), 1b, 4 (route writer), 5 (swap, switch-off), 5b (version rows, "New cut ready", the Trial line).
- **Gaps added:** workload counts work items per card as today (unchanged, a test names it); Production's issue page "status hover" and capacity labels are unchanged; the Messages inbox drops Posted cards, so losers' open notes leave it at the pick (accepted, noted).

## 25. What changed in revision 16

| # | Change | Where |
|---|---|---|
| S-B | Switching off is allowed and asks which version becomes the card; `card_letter` column; same swap machinery; tests and mockup | 23.1, 7.1, 2.2, step 5, step 0 |
| S-C | "Clear winner" confirmed | 21.8, 23 |
| Ask | One sheet per review board and SyncLinear surface, with what each shows per version, writes, build step and gaps | 24 |
| Withdrawn | The earlier "refused" defaults for switch-off | 2.2, 16.3, 21.8, Q14 |

## 26. Review round 6 (Trialreview6, 4 Nov) and what changed in revision 17

Verdict: the model is sound and matches every answer Sidney has given; revision 16's `card_letter` was not carried through the rest of the plan, and two board and SyncLinear write paths contradicted the plan. 5 HIGH, 13 MEDIUM, 15 LOW, all applied as text fixes. No mechanism was added except the `route_written` field and the `swap_begin` action name.

| # | Finding | Where it landed |
|---|---|---|
| H1 | "Version A" hard-coded where the card's version is a variable | `card_letter` sentence in 2.2; swap, Clear (`before.card_letter`), 3.3, 16.7, 21.1, 24.1 say "the card's version"; `readShape`/`effectiveFields` change moved to step 3; `card_letter` filled from `mainLetter`; Q-U |
| H2 | The swap record has no life after a switch-off | New attempt from empty or `done`; outgoing fields filed first; Clear only on a `pick` record; test. 16.3, 23.1 |
| H3 | Drop on the card's version moves the link outside any swap | Named (`194:741`, `194:789-814`); becomes a confirm swap; the bare link move goes. Q-T. 2.2, step 1a, 24.2 |
| H4 | The work item carries the route value, but 21.4 read every move as a person's move of A | The work item carries the route value only; `route_written`; a person's move never changes a version; both cases tested in step 4. 2.2, 3.5, 3.6, 21.4, 24.4 |
| H5 | The board sheets describe the writes wrongly and miss writers | Every answer through `trial-reels answer`; six writers added and cited; the client's caption edit becomes "Ask for a change"; Undo also undoes the stamp. 2.2, 24.1 to 24.3, step 1a/1b |
| M1 | Switch-off order; "changed while off" always fires | One order (card columns, then `switch_set`); `updated_at` read on the server last; the copy defined. 16.6, 23.1 |
| M2 | Closed trial and Posted card on switch-on | Q-S: always lets the SMM finish; "no clear winner" versions reset at switch-off; tests. 23.1, 16.7 |
| M3 | Switch-off to an unapproved version on a Scheduled card | Only approved versions offered, others greyed with the reason. 23.1, step 0 |
| M4 | The swap lock misses Production attach rows and caption jobs | Edit disabled while pending; `healMainPatch` idle; caption jobs carry letter and swap counter. 16.3, 24.4 |
| M5 | Posted is a full card save | Named as the card's status save with all three parts; separate `steps_done`; citations fixed. 3.3 |
| M6 | Clear cannot restore "no thumbnail" | Dialog says "paste one, or keep Version B's"; the only field Clear can leave behind. 16.3 |
| M7 | The held queue retries the new refusals | Drop `card_scheduled`, `version_moved`; retry `swap_in_progress`, `conflict`. Step 1c |
| M8 | The client cannot reach a Scheduled trial card | New `_rsPartState` override; needs-client Approve through `trial-reels`; read-only view dropped; citations fixed. 3.6, step 1b, 21.9, 24.1 |
| M9 | Effective-fields readers fixed after swaps ship | Moved into step 3; step 9 keeps posting after a winner. Steps 3, 5, 9 |
| M10 | "Not chosen" and the Video/Version word are new work | Listed in step 5b. 3.5 |
| M11 | `switch_set` would convert a v1 card | Writes `v2` only when `rules` is null. 16.6, step 5 |
| M12 | The robot's skip clause is in two halves and counts rows | Whole clause once in 3.4, with `enabled`-free marker condition, `ilike`, one row per letter, duplicate-A test |
| M13 | The column list is in four places | One list of ten in 7.1; steps 1a-bis, 2 and 16.5 point to it |
| L1 | Contradictions left in the text | 3.3 part-status bullet; section 8 switch-off row; section 9 Q1 row; probe checks the link being attached; Unschedule verified (`policy.mjs:324`, `390`) |
| L2 | `link_states` is advisory | Said so; `assertGraphicsApprovalArtifact` dropped from 16.3. 3.3, 16.3 |
| L3 | Wrong citations | `195:3724-3733`, `305:439-441` (is `_kasperJudgeConflict`), `logic.mjs:432`, which bridge body is live. 2.2, 3.6, step 1a |
| L4 | Kasper's stale board overstated | Corrected; the real risk is a stale status decision. 3.6 |
| L5 | Kasper's Frame notes link opens A's page | Reads the selected version's link. 3.6, 24.2 |
| L6 | Per-version thumbnail rows only where a thumbnail sub-issue exists | Said plainly (6 of 38); none created. 3.6 |
| L7, L8 | Today's line and a past date | "date passed, trial not started" line; "Starts now: the date has passed". 3.4, step 0 |
| L9 | Name the marker action | `swap_begin` (working name). 16.3 |
| L10 | Bulk caption generation | In 3.6, step 1a, with the job guard |
| L11 | The overdue bump is on every status write | Noted. 3.6 |
| L12 | A `ready` rule for a team-only send-back on Scheduled | Step 8 |
| L13 | Test client bypass `097:366` | Kept in the same PR as the test. Step 1b |
| L14 | `switch_set` has no checks | Server-side refusal and "with a winner, no choice". Step 5 |
| L15 | 30-second lag in Production | Noted in the mockup list. Step 0 |

**Three questions, all decided by Sidney on 6 Nov ("yes to all"; section 9):** Q-S (switching back on always lets the SMM finish the trial), Q-T (Drop on the card's version stays, as a confirm swap, worded "Dropping Version A makes Version B the primary version (the one on the card)."), Q-U (empty fields keep inheriting Version A's value). Defaults applied without asking (no product change): M3, H4, M8 and M11 above.
