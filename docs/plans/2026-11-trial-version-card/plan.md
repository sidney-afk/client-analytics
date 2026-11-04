# One card, many versions: the plan (session Trialplan, 4 Nov 2026)

**Plan only. No code, no migration, no deploy, no data change.** Plain English.
**Status: revision 10, 4 Nov 2026 ~23:05 UTC. Sidney's answers to S1 to S7 are applied (section 15); nothing is open for him. Held for the next review round (Sunday).** Sidney's plan: more review rounds until the reviewers find no bugs, then build, then merge for him and the test clients, then testing. Four rules changed: **a client cannot change anything once the card is Scheduled (notes only)**; **the trial starts only on the morning of the scheduled date or by Start trial, never from the Post tab**, with a simpler edit rule; **a version without its own thumbnail or caption inherits Version A's, explicitly, through the swap**; **analytics is not expected to see trial reels at all**.
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
- **Version A is the card itself.** Its row exists (marked `on_card`), but its link, thumbnail and caption are the card's own. Only B, C, and so on use the version columns for thumbnail and caption (null means "same as the card").
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
| **Call to action** | **new**: `cta` column, same rule: empty means the card's |
| **Component states: Video, Thumbnail, Caption** | **new, per part, in one nullable `parts` column on the version row** (review M1): each part keeps its own approval stamps (SMM, Kasper, client) and its own change note; the status **words** are derived from the stamps, as the video's are today. Null means "the whole version follows its one status and stamps", today's behaviour. `placeOf` (which reads the card status today) **must not read the route value on v2**, which breaks the circle where the route value, built from the versions, fed back into them |
| Notes | see section 5 |

**Rule for an empty field (Sidney: yes, 4 Nov):** each version has its own caption and image. An empty one still falls back to the card's in the data, so old trial cards keep working, but the screen says "Using Version A's thumbnail" with a one-click "Give Version B its own". It is never silent.

**A trial card has no status of its own (Sidney, 4 Nov): this is a visual rule.** Only versions have statuses on screen. The review (section 12, finding 1) showed that the *stored* card status cannot simply go away: the SMM tab, Kasper's queue, the client link, the Today page, `trial-reels` itself, Production's status sync and the drift check all read the card's `status` and `video_status` as their routing key. So:

- **On screen:** no card status pill on a trial card. The part pills belong to the selected version. The trial strip says "Trial · 3 versions".
- **Stored, hidden, system-written: a route status.** The card's own status columns stay and keep meaning what they mean today to every old reader. On a trial card they are a **route value** written by one function (today the page writes the "Approved once every version is approved or dropped" move; this plan gathers that into one tested writer, `routeStatusFor(versions)`). Nobody edits it by hand and no screen shows it as the card's status. It also carries the post's state (Scheduled, Posted), see below.
- **Queues stop depending on the route value** (build step 1b, before any visible change): for a trial card the SMM tab, Kasper's queue, the client link, Today (`097`, `_tdyTrialAsks`, which today reads only work items at SMM, Kasper or Client approval) and `trial-reels`' own reads decide "does this wait on me" from the **version rows, whatever the route value is, Scheduled included**. The review boards already do this per version (688 part 1); the remaining readers (`195:1640-1660`, whose overrides fire only when the card is at Kasper, Client or Tweaks; `190:2435, 2620, 1112`; `097:359-392`; `trial-reels index.ts:160, 250, 543, 638, 643, 676`; and Kasper's old shared core in `305`, which writes a card's caption, thumbnail and CTA with no trial awareness) get the same treatment. This fixes two cases: "A is Approved while B waits on the SMM, and B vanishes from the SMM tab", and a version that **staff** send back after the card is Scheduled (S1: the client cannot), which today reaches no queue at all because B to E have no work items and the route value never leaves Scheduled. **Test:** card Scheduled, staff send Version C back, C appears in the SMM tab and on Today, and the Production work item stays Scheduled (Q-Q). After 1b the route value is only for Production, the drift check, filters and old readers.

**Turning a trial on converts the card's data into Version A:**
- **Fields stay put.** A's link, thumbnail, caption and call to action stay in the card's own columns; the page reads them as Version A's. Nothing is copied.
- **One rule for part states (review H2, M1): they always live in the version rows, A included, as per-part stamps and notes (the `parts` column), with the words derived.** The card's own status columns hold **only the route value**. Cards already switched on never "switch on" again (38 are on today), so A's `parts` are **filled lazily on the first read by a v2 client** from the card's `video_status`, `graphic_status`, `caption_status` and approval stamps; two enabled cards have no A row at all and get one at that read. **Switching the trial on again always copies the card's part states into A's row** (a lazy fill alone would leave A stale after off then on; review M3), and **switching off never lowers a Scheduled or Posted card**: it sets the card's columns from A's row only while the card is before Scheduled.
- **Cards in flight when the flag reaches a client (Q-P, answered; review M4; S7):** a nullable `rules` column on `trial_reel_cards` (`'v1'` or `'v2'`), **backfilled once, on the day the flag is turned on for a client**, from each card's state that day (Sidney does not know when it goes live, so no list is fixed today): a card that is already **Posted, or has a version on trial, or is already Scheduled** gets `v1` and keeps today's behaviour exactly (including the automatic start from Posted); every other enabled card gets `v2`. (Scheduled counts as `v1` because the Schedule gate cannot be applied to a card retroactively; this one line is my engineering default, not Sidney's, and step 1a re-checks it.) Today's four real cards that are mid-review (2 In Progress, 2 at Kasper; none Scheduled) would get `v2` if the flag were turned on now, as Sidney said (S7). A card enabled afterwards gets `v2`. Everything in this plan applies only to `v2`. The one real Posted card stays `v1` and nothing has to be done to it. The test-client trial cards are deleted by Sidney through the app (no SQL; OPEN_REPAIRS 373).
- **Notes** are not rewritten (section 5).
- **No new `calendar_posts` columns.** A's call to action is the card's existing `cta`; A's part statuses are in its row. This matters because `calendar-upsert`'s allow-list is frozen (review, low 12).

**The route value, precisely (rule sheet in step 1a), and who may write it (review H6, M8, M13):** per part, in the order In Progress, Tweaks Needed, For SMM Approval, Kasper Approval, Client Approval, Approved, over the **counted** versions (live and **not passed by the client**, below). **Before a person schedules the card:** Tweaks Needed on any counted version wins, otherwise the least-advanced counted version sets it, and all Approved gives Approved. **Once a person schedules, the writer does not move the card again until the winner** (so "Tweaks wins" never fights "Scheduled stays"). **Posted is set only by the winner pick.** There is **one writer**, `routeStatusFor`. Today at least these write the card's status directly and **must go through it**, with a test that fails on any bypass (step 1b): `_rsTrialToTweaks`' Kasper branch (`195:1724-1733`); any change with `after === 'tweaks'` including **Redo** (`195:3833, 3867`, card-level `_kasperRequestTweakComp`, which today sets the CARD to Tweaks Needed for a Redo on one version); a card approve with `after === 'move'` (`195:3843`); `_rsTrialCoverParts` (`195:3782-3796`, which stamps the card's graphic and caption Approved whichever version was approved); the **status bridge** (`2026-10-01-calendar-overall-status-bridge.sql:143-230`); and Kasper's old shared core (`305:439-441`, where the card write and the version write are separate steps the writer must reconcile).

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
- *Before a winner:* switching off hides B to E, copies A's statuses back to the card, and shows A as the plain card. Nothing is deleted ("3 other versions are kept, hidden"); switching on again restores them.
- *After a winner (Sidney, 4 Nov ~21:15: "if B is the winner, it becomes the default of that card"):* the card becomes an ordinary card made of the winner's fields and statuses. See 3.3. Switching the trial off while a winner exists is **refused** ("Version C is the winner. Clear the winner first").

**Why not make each version its own hidden card?** Considered and rejected. It would put every version through the status sync, the drift robot, Production work items and Month and Week, and it touches the three Section 4 functions. The current design (one card, version rows beside it) keeps all of that untouched.

**How many versions: up to five, A to E (Sidney, 4 Nov).** *Assumption to confirm:* he wrote "ABCDF"; this plan reads it as five versions, A to E. The function today allows A to G. Existing rows, counted live on 4 Nov (counts only): A 60, B 59, C 46, D 14, E 8, **F 2, G 1**, and **all three F and G rows are already dropped** (none live). So a cap of five **hides nothing anyone uses**: the three dropped rows stay in the table and in history, are not shown as tabs, and can still be read by the function. The cap applies to adding, so "+" stops at E. The cap is enforced in more places than the function: `trial-reels logic.mjs:7`, the AI editor's writer `higgsfield-mcp/trialreels.mjs:45`, and the version-name regexes in `189` and `194`. Step 2 moves **adding** to A to E in every one of them; the table's own check (`letter ~ '^[A-G]$'`) is left alone, so no migration is needed for the cap and old F and G rows stay valid. Worst case if the assumption is wrong: a cap of seven is a one-line change.

**Version A cannot be dropped while it is the card's version.** The card's version is A until a winner is picked, then the winner. Dropping the card's version is refused with a plain message.

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
  - **Rule:** one version at a time is "the card's version". It is A until a winner is picked, then the winner. **The card's version keeps its link, thumbnail, caption, call to action and part statuses in the card's own columns; every other version keeps its own in its row.** This is today's rule for A, made general (the function already has `mainLetter` and `on_card` for it).
  - **Picking the winner swaps four things, and only four: link, thumbnail, caption and call to action.** The winner's go onto the card; the old card version's (A's) go into A's row, so nothing is lost. The winner becomes the `on_card` version. **Part statuses never swap** (they always live in the rows); the card's route value becomes Posted at the end.
  - **Why a real swap and not "read the winner's fields on screen":** the review showed that Production's sync, the drift check, the client card, `post-source`, Post for Me and the three Section 4 functions read the card's columns **on the server**, where a page helper cannot reach. If the card's columns hold the winner's data, every one of them is already right and none changes (no fingerprint re-pin). This is the mechanism for the Opus review to challenge. The first draft proposed "no copy, the winner only highlighted"; Sidney's answer on the same evening (card behaves as the winner everywhere) made that unworkable.
  - **Clear the winner reverses the swap with the data as it is now.** If B was edited after the pick, those edits go back to B's row and A's four fields return to the card. There is no saved snapshot to go stale. Whether `production-write` lets an SMM move a card from Posted back to Scheduled is not verified; step 1a checks it. All 5 existing winners are on the test client (review count), so they are reset and there is no special case for old winners.
  - **The tab:** the winner's tab has no mark of its own (Sidney: it just shows Posted, that's it), **the card opens on it by default, and a reload returns to it** even after someone looked at another tab. Other tabs stay viewable. Before a winner the card opens on Version A, and no tab is remembered (Q9: no).
  - **The write order (review H2 and H4, and the writers it really uses):** the video link is `deliverables.file_url`, shown as `asset_url`, and the thumbnail is shown from the graphic work item when the card has one (6 of the 38 do), so the swap is **several separate writes across three writers, none of whose source changes** (no re-pin). **A reload, a closed tab or a sleeping phone in the middle must not half-swap the card or lose A's fields** (today the rollback lives only in page memory, `189 _trlCardFieldsBefore`, and after the link write `mainLetter`'s "carried" rule, `logic.mjs:240-242`, silently makes the winner the card's version even if `winner_set` never ran). So: **(0) first, A's four fields are written into A's row (as explicit values, never null) together with a `swap_record` marker** on `trial_reel_cards` holding the before and after; (1) the **link** through `production-write` operation `attachment` (with its `updated_at` check, `189:921-965`); (2) the **thumbnail** through the graphic attachment when the card has a graphic item, otherwise a card save; (3) **caption and CTA** by card save; (4) `trial-reels` `winner_set`; (5) the **Posted status last**, through `production-write` operation `status` (`140:2195`); (6) the marker is cleared. **While a marker exists, `mainLetter` follows the marker's target.** A staff read that finds a stale marker shows **"Winner pick did not finish: Finish / Put back"**, and either completes the remaining writes or reverses them from the marker. **Before step 1 the pick checks the link's state** (`link_states`); the attachment probe can refuse with `artifact_not_resolvable` (409; `production-write index.ts:5747-5754`) when A's current link is dead, so the pick says so in plain words instead of failing at step 1, and **Clear the winner may leave the link as it is** if the old link no longer resolves (review M9).
  - **Inheritance and the swap (review H5; Sidney's S4: "by default a version should inherit the old main card thumbnail and caption, unless changed").** None of the 120 live B to E versions has its own thumbnail today, so inheritance is the normal case. **A version with no thumbnail, caption or call to action of its own inherits Version A's (the pre-trial card's), never "whatever the card holds".** Rule: `effective(V, field) = V's own value if it has one, else Version A's value`, where A's value is the card's column while A is the card's version and A's row afterwards. The swap therefore: (a) writes A's four fields into A's row as **explicit** values (never null); (b) puts the winner's effective four values on the card, so a winner that inherited a field **posts with A's value, with no prompt**; (c) leaves the winner's row as it was (its inherited fields stay inherited, and now read A's row); (d) keeps every other version's inheritance pointing at A, so a loser never starts inheriting the winner's own thumbnail. **`swap_record` keeps the values the swap placed on the card until the winner is cleared**, so Clear can tell an edit made while B was the card's from an untouched copy: it writes a field into B's row as B's own **only if the card's value differs from what the swap placed**, otherwise B stays inherited; A's explicit values go back to the card. The earlier "ask once" prompt is dropped.
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
   - **Re-solving review H2 under this rule (the simplest rule that works): being On trial changes nothing about posting or fixing until the winner is picked or the trial is ended.** (1) **The Post tab lists every counted version that is approved or On trial** (today it lists only `approved`, `299-instagram-upload:273`, so from 06:00 it would say "No version of this card is approved yet"), provided all three of its parts are approved. (2) **An On-trial version stays editable** (caption, thumbnail, link, "New cut ready"): today `version_on_trial` refuses edits (`logic.mjs:432, 750`) and this refusal goes. An edit restarts only the part that changed through the chain, as any change does, so a typo fix costs a re-approval of that part and the Post tab will not send the version until it is approved again. (3) The only locks are **after the winner is picked, the losers are read only**, and a card whose trial ended without a winner is no longer a trial. (4) A quiet note shows on an On-trial version being edited: "Already running as a trial: this change does not change Instagram." (5) **No `sent_at` and no "mark as posted"** are needed: SyncView does not try to know whether anything is posted. The alternative (a "Mark as posted" per version, with edits locked after it) is not recommended: it adds a button people forget and locks fixes that harm nothing.
   - **The end-of-day Posted robot gets a real skip, only while the trial is open (review H1 of the first review, and H9 of the second; "byte for byte" withdrawn).** `calendar_auto_posted_due()` (`2026-10-10-calendar-auto-posted.sql:208-247`) picks any card at Scheduled whose date has passed in ET and that has been quiet for an hour, then pushes Posted to Production. The fix is one clause in the due() SQL: `and not exists (a trial_reel_cards row with rules = 'v2', enabled, winner_letter is null, trial_closed_at is null, and at least two counted live versions)`. So **a trial that ended without a winner, or a card down to one live version, falls back to the ordinary Posted robot** and cannot sit Scheduled forever. A `v1` card is not skipped. **A held migration, live before the flag widens beyond the test client.**
4. **Trial is shown clearly** (below). **No countdown, no hours.**
5. **Pick the winner**, any time while the trial runs (Q-K: yes, with a one-line confirm). The winner becomes the card by the swap in 3.3 and takes **Posted**; it is the default tab. **The others end as "Not chosen"** (today's `lost`, relabelled). A dropped version stays dropped.
6. **End the trial without a winner** is also offered (today's `no clear winner`): the card goes back to Version A as its version, `trial_closed_at` is set (so the Posted robot takes the card again), and the strip says so.

**What if some versions are not approved yet (Sidney's question).** Recommendation:
- **You cannot schedule the card, and you cannot press Start trial, while a live version is unapproved.** The gate is the answer to his Q-J: "only start a trial if all versions are approved or dropped". The fix for an unapproved version is to approve it or drop it.
- **A version sent back after scheduling** (a new cut, a change request) does not cancel the schedule. When the date arrives with a live version unapproved, **the trial does not start**: the card stays Scheduled, the strip says "Not started: Version C is not approved", and the trial starts by itself on the next check after C is approved or dropped. Nothing is ever started with some versions left out, so no version is silently excluded from a trial.
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
- **The sub-issues** are the card's real work items, one for the video and one for the thumbnail (graphics) where the card has one, as today. **Nothing about them is duplicated per version.** A video sub-issue's status follows the route value, as today.
- **Versions B to E have no work items** (only Version A's work item exists, and after a winner the winner's content is attached to it). They show only in the video sub-issue's **Assets box**, which already has one "Deliverable file · Version A" to "· Version E" row per version, each with its own Edit and its sharing state (Available, Missing, Permission denied). That stays as it is, with the new naming. A version with no link yet shows as a row that says so.
- **Where a version's tweaks show:** a change asked on one version is a note named "Version C: ..." (today's naming). It appears in the sub-issue's **Feedback & tweaks** list as a tweak, labelled Video or Graphics and "Tweak · Round N", with the version's name at the start. **The sub-issue and the parent keep their status** (Scheduled): only Version C's own status goes to Tweaks Needed (Q-Q, Sidney: "only version C is marked tweaks needed"). The editor finds C's tweak on Today and in the SMM tab through the queues in 2.2, not through a changed work item.
- **After a winner:** the video sub-issue's file row for the winner is the card's video, the other rows read "Not chosen", and the parent is Posted.
- **What Production cannot do** (and the mockup says so): it cannot set a version's status, because B to E have no work item to set it on. Version statuses are set on the card only.

### 3.6 Journeys the earlier drafts missed (second Opus review)

Each is a rule with a test; the mockup shows the visible ones.

**After the card is Scheduled (review H3; Sidney's S1: "if it's scheduled it shouldn't be able to be changed by the client").** **The client can only leave notes, never a change request and never "Not this one".** Today a client can reopen a version only from Client Approval or Tweaks Needed (`194:282-288 TRV_REOPEN_FROM`, the guard at `190:918-920`) and on Scheduled the button already reads "Send to your team" (a note; `195:3176, 3210`); the client's list skips Scheduled cards (`195:1657`). So **no gate is widened and `production-write`'s client policy does not change** (no re-pin from this). For a v2 trial card at Scheduled the client link shows the approved versions read only with the note box, and "Not this one" is hidden. **What staff can do after Scheduled:** (1) **send a version back** with a note (its parts go to Tweaks Needed; the version is no longer counted, so the date start waits until it is approved or dropped; the strip says "Not started: Version C was sent back"); (2) **edit a version's fields or link** ("New cut ready"), which restarts the changed part through the chain and holds the trial the same way; (3) **drop** a version (the trial needs at least two counted); (4) **unschedule** the card (default yes: the strip's Schedule action becomes Unschedule while Scheduled and the trial has not started; step 1a checks that `production-write` lets an SMM move Scheduled back); (5) once the trial is running, **pick the winner**.

**The editor gets a version back (review H7, S5).** Today the editor has no correct action:
- Production's version row has only Edit (`245:191`), which writes the link; Frame.io keeps **one link** for a new upload, so pasting the same link is a silent no-op that looks saved (`linkPatch`, `logic.mjs:433`). **"New cut ready" exists only in the card's old list** (`189:786, 1465`), which step 5 removes. Rule: **"New cut ready" moves onto Production's version row and the tab menu**, and a same-link paste says "Same link: press New cut ready".
- Pasting C's new cut on the A row copies it into A and restarts A, un-approving A (`healMainPatch`, `logic.mjs:463-471`). Rule: the A row is labelled "Version A, on the card", and replacing an approved one asks first.
- A thumbnail change on C has nowhere to go: there are no version rows on the graphic sub-issue (`245:107`), and `_tdyTrialAsks` ignores `change_part` (`097:391`). Rule (S5, Sidney: "both can"): **the designer does a version's thumbnail change on the thumbnail sub-issue, which gets per-version rows, and the SMM can paste a thumbnail link on the card; both are allowed**, and the editors' Today list reads by part.
- **A's work item is A's only** (review H7d): an editor moving A's only work item to Tweaks for C's change would pull the card off Scheduled and wipe A's approval stamps through the status bridge. Written rule: a work item's status never carries another version's change; the strip warns when it happens, and a test covers it.
- A change on a **borrowed thumbnail** (a version with none of its own) lands on the card's graphic part and the designer edits A's (`194:401-404`, `195:3831`). Rule: **"Give Version B its own" first**, then the change.

**Today shows version work (review H8, L6).** The SMM's "Captions to write" reads the card's caption status and excludes Scheduled (`097:318-326, 514`); "Missing links" checks only A (`_calSmmMediaGap`, `097:523`); the walk list excludes Scheduled (`566`); the editor list fetches only SMM, Kasper and Client approval (`097:360`) and **drops test clients (`097:366`), so the earlier test "C appears on Today" cannot pass on the test client**. Rules: every Today list reads the versions (`svTrialListSharedMany`), no Scheduled exclusion for trial cards, the link and caption gaps are checked per version, `097:360` is widened, and the test client gets a test-mode bypass of the test filter. Today says "Version C", not "Video C", on v2 (`097:463, 475`).

**A held client change or an approve is lost or comes back (review H10, L7).** `194:643-690` keeps pending client changes in the browser with no age limit and no sender key, and re-sends them on every read; e.g. the phone drops mid-send, the team approves C's new cut, the client opens the link days later and C flips back to "change asked". `185` re-reads before re-sending (`185:334-342`); `194` does not. A version **Approve** (`194:572-605`) is not queued at all: if Safari kills the tab, the approval is silently lost. Rules (a new step 1c): **re-read the version's revision before re-sending and drop the held change if it moved; queue approves the way 185 does; key the held list by who is signed in** (it is shared across users of one browser today).

**Other things that write or read one card (review M11, L2 to L5, L9).** In step 1a's inventory, each with a decision:
- SyncMate's `video_cards` (`higgsfield-mcp/index.ts:1706`, `videocards.mjs:307, 319, 328`) gives editors only the card's status, link and notes: it must read the version rows too.
- `caption-generate` (`index.ts:311`) writes the **card's** caption: a caption generated for B would land on A, or on the winner in the middle of a swap. Rule: it writes to the selected version through `version_fields_set`.
- Urgent pings (`140:2766-2790`) need the card at Tweaks or Kasper: a version's urgency must reach them.
- `frameio-view`'s client card (`client-card.mjs:79-80`) answers 404 when the card has no link even though B has one: it reads the effective version.
- Kasper's board still carries `asset_url`, thumbnail, caption and CTA in `KASPER_PATCH_SCALARS` (`305:363`) and keeps a 24 h local copy (`321:611`): a stale board could push old fields across a swap. A test covers it.
- Editors' board counts rounds from work-item moves only (`340:120-201`), so a version's rounds do not count: noted, accepted.
- The Messages inbox drops Posted cards (`production-comments:494-495`): the losers' open notes vanish from it at the pick; accepted, noted in the mockup.
- The late Posted write bumps an overdue due date through to Linear (`production-write:5806`): cosmetic.
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
- **Posting (Post for Me):** after a winner, see section 3.3. Before one, today "From a card" posts each *approved* version as its own Instagram trial reel with that version's video, thumbnail and caption (P4, held for Sidney's D3). **The call to action is not posted** (Post for Me has no call-to-action field); it stays a card and version field. This plan does not change which versions go. Approved means all three parts approved. Nothing posts automatically and no automated check ever posts.
- **Analytics (later):** the version rows already have `views, watch_time_s, shares, saves, follows`. Per-version results stay a later step and need nothing from this plan.

## 7. Data and live systems

### 7.1 Schema: what exists, what must change

- **Exists:** `trial_reel_cards`, `studio_trial_versions` with thumbnail, caption, change_part (migration `20261102200000`). No browser role can read or write either table; only the `trial-reels` function does.
- **One new migration (step 2), all nullable, so existing rows stay valid:** on `studio_trial_versions`: `cta`; `parts` (per-part stamps and change notes, 2.2; null means "follows the version's one status", today's behaviour, and the first per-part write fills all three so a version is never half old and half new). On `trial_reel_cards`: `rules` (`'v1'`/`'v2'`, 2.2), `swap_record` (the swap's before, after and pending flag, kept until Clear, 3.3), `trial_closed_at` (3.4). **No `sent_at` and no `calendar_posts` column.** Every revoke names all four roles and reads the grants back, as the earlier migrations do. Rollback is dropping the columns.
- **Migration of trial cards already live:** none needed for the data. Fields already sit on the card; A's part statuses are filled lazily on the first v2 read (2.2); null in the new columns means today's behaviour, so every existing version reads exactly as before. Counts read on 4 Nov (counts only): **63 switch rows, 38 on (5 real, 33 test); 189 version rows** (A 60, B 59, C 46, D 14, E 8, F 2, G 1), of which F and G are all dropped. All 5 winners are on the test client (2 are not A). Every one of the 38 enabled cards is linked to a Production video work item; 6 have a graphic (thumbnail) work item; none has a call to action; 4 versions are on trial, all on the test client; 2 real enabled cards have no version rows at all; one real enabled card is Posted with all three versions still waiting (the old auto-start never fired on it). **The migrations this plan needs:** (1) the columns above (step 2); (2) the due() SQL skip while a trial is open (3.4), held and live before the flag widens.
- **Counts to use in step 1 are the enabled ones** (review, low 11): per the review, 38 trial cards are on, 33 of them on the test client and 5 real; 7 enabled version rows on real clients, none with its own thumbnail or caption; no trial card has a call to action; no duplicate letter rows. **The flag `trial_versions_v2` stays test client only** until Sidney clears each step.

### 7.2 Section 4 functions

`production-write`, `deliverable-write` and `batch-write` **do not need to change, and are used as they are**: the winner swap writes through their existing `attachment` and `status` operations (3.3), so it is four or five writes across three writers, none with new source, and **no re-pin** (true because no Section 4 source changes, not because they are not involved). `trial-reels` writes no calendar row. The route value is written through the existing writers, never by a new path. **If a step ever adds a column to `calendar_posts`, `calendar-upsert`'s frozen allow-list is touched; this plan avoids that on purpose** (part statuses live in the version rows). The tests prove it (no write to a card row except through those writers), and the PR checklist states "no Section 4 file touched, no fingerprint re-pin". If a step ever does touch one, re-pin with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`, in the same PR. The merge lane holds `trial-reels` until its migration is applied (it carries an `ef-auto-deploy-applied-when` line); Lighthouse applies it and runs the merge lane by hand. Sidney runs nothing.

### 7.3 Write-refusal log

Every new write (version field, version part status, the route writer, Start trial, Pick the winner) calls the existing refusal reporting (`_writeUiRecordFailure`, board `calendar`) and gets a read-back test, because absence from the log is not proof a save worked.

## 8. Edge cases (each is a test)

| Case | Behaviour |
|---|---|
| Version with no thumbnail | Shows "No thumbnail yet" with "Use the card's" and "Add one" (Q3). It never shows the card's picture as if it were the version's |
| Drop the version on screen | The card moves to the nearest live tab and says so |
| Two staff edit different versions | Fine: different rows. Same version: last save wins on that field only, and the second sees "Changed by someone else" (the card's existing check) |
| Two staff pick a winner | One wins; the other is refused with a plain message (race test exists). Clearing and re-picking is one flag, so no stale copy can exist |
| Trial switched off with a winner | Refused until the winner is cleared |
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
| Q1 | "If it is trial, does it have a card own status? I think only the versions. And the data from before trial converts into version A." **No card status on screen; turning trial on converts the card's data into Version A.** | 2.2 (rewritten twice): a visual rule; a hidden route value stays for the queues, Production and the drift check; fields stay on the card, A's part statuses are copied to A's row |
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

**Questions this raised. Sidney answered Q13 to Q17 on 4 Nov (~20:05 UTC): Q13 yes; Q14 no button, so there is no "Keep Version C as the card"; Q15 yes; Q16 yes; Q17 yes, five versions, A to E.** Q-A to Q-O (section 12) are all answered; Q-P to Q-R (section 13) came from the Opus review and are open, with defaults.

13. **Q13. Production's parent issue for a trial card.** It follows the hidden route value. Recommended: show "Trial · N versions" with the version dots on the parent.
14. **Q14. Ending a trial with a winner that is not A.** Answered: no extra button. The winner already becomes the card (3.3); switching the trial off is refused until the winner is cleared.
15. **Q15. After a winner, can the other versions still be posted?** Recommended: no; only the winner is offered, as an ordinary post.
16. **Q16. Calendar filters and counts.** Recommended: a trial card matches a status filter if any live version has it, and counts are by version.
17. **Q17. The cap of five.** Confirm "A to E" is what "ABCDF" meant. The three existing F and G rows are all dropped, so nothing is lost either way.

## 10. Build order: small PRs, each testable on the test client

Everything stays behind `trial_versions_v2`, on for the test client only. The card "Video 2 — TEST2" is never touched; test cards are throwaway ones for the test client, and the drift check is run only on an unlinked throwaway card. **Reordered after the review:** the queues move onto version rows *first*, and nothing visible ships until that is proven, so every step can be tested alone.

| Step | PR | What it is | What Sidney can click after |
|---|---|---|---|
| 0 | **Clickable mockup of the final card** (design only, no wiring) | Every state in sections 3, 4 and 8, on the card, Month, Week, the client link and the phone, **including every dead end**: no link yet, refused save, dropped version on screen, winner, trial off with a winner, a version the client cannot see, offline, empty fields, Start trial, Trial running, Pick the winner and its confirm line, End trial without a winner, a trial waiting for an unapproved version, **the Schedule action and its gate**, a card whose Scheduled arrived from Production with a version unapproved (warned on the strip), the date start, **and the Production tab for a trial card (3.5): the parent with its "Trial · N versions" line, the video sub-issue's per-version file rows, a version's tweak in Feedback & tweaks, and the winner afterwards**. Approved before step 1 | Click through all of it |
| 1a | **Measure and write the rules** (docs and read-only tests) | Inventory every reader and **writer** of a card's status and of its `asset_url`, thumbnail, caption and CTA, including every item in 2.2 (the six status writers) and 3.6 (SyncMate `video_cards`, `caption-generate`, urgent pings, `frameio-view`'s client card, Kasper's board, the Messages inbox, analytics); the route-value rule sheet (counted versions, who writes when); the notes check; every way a card can arrive at **Scheduled or Posted**; **that `production-write` lets an SMM move Scheduled back (Unschedule)**; the new inheritance rule across the swap; the swap's checks (graphic route, caption history origin, thumbnail revision baseline, Posted back to Scheduled, the dead-link probe); the watchdog signal for the on-read start; a test that fails if a version row ever gets a work item | The rule sheet |
| 1b | **Queues, Today and the client's gates read version rows; one route writer** (code, no new look) | SMM tab, Kasper, client link, Today (all its lists, per version, test-client bypass) and `trial-reels` decide "waits on me" from the version rows **whatever the route value is, Scheduled included**; on a Scheduled v2 trial card the client link is notes only and hides "Not this one" (S1); every route writer goes through `routeStatusFor`, with a test that fails on any bypass. Tests: A Approved and B at the SMM, B is in the SMM tab; card Scheduled, **staff** send C back: C appears in the SMM tab and on Today (also on the test client) and the work item stays Scheduled; the client link of a Scheduled trial card offers notes only | Nothing new on screen; the queues are right in the odd cases |
| 1c | **Client link safety** (code, no new look) | A held client change is re-checked against the version's revision before it is re-sent and dropped if the version moved; a version Approve is queued like 185's; the held list is keyed by who is signed in. Test: change held on a phone, the team approves the new cut, the client opens the link days later: C stays approved | Nothing new on screen; a late change no longer undoes an approval |
| 2 | **Migration and function** | The columns of 7.1 (`cta`, `parts` on the versions; `rules`, `swap_record`, `trial_closed_at` on the switch rows); `trial-reels` reads and writes them; per-part stamps and notes, only the changed part restarts, `placeOf` no longer reads the route value on v2; the cap moves to A to E for **adding** (`logic.mjs:7`, `higgsfield-mcp/trialreels.mjs:45`, the `189`/`194` regexes); the route writer and the effective-fields helper as tested functions; the **client's not-this-one** counted rule. Migration held until Lighthouse applies it; no `calendar_posts` column | Nothing visible (flag off to the page) |
| 3 | **Tabs edit the selected version** | The card's Video, Thumbnail, Caption and CTA follow the tab and save to it; the old list still present | Type a caption on B, reload, see it on B, A unchanged |
| 4 | **Part states, pips, status grid, Schedule, Start trial, the Post tab** | Each part's pill on the selected tab (states in the version rows, lazy fill for A); the route writer runs; the **Schedule** (and **Unschedule**) action and **Start trial** with the gate on **counted** versions (every counted version approved, at least two counted), held on the server too; **the start is the morning rule or Start trial, never the Post tab's send**; the **Post tab lists counted versions that are approved or On trial** (all three parts approved), and **an On-trial version stays editable** until the winner is picked (`version_on_trial` goes; only the losers lock); **the `trial-reels` changes these need**: `trial_starts_when_posted` (`index.ts:672-673`), the 24 h end and `trial_not_over`; the **due() SQL skip migration** (held, live before the flag widens); the Trial label on the strip, tabs, and Month and Week; version menus stop at Approved; the card shows no status pill | Set B's thumbnail to Approved; see the grid without switching; approve three versions, Schedule, press Start trial and see Trial on all of them; fix a typo on an On-trial version and see only that part go back to the SMM; see the Post tab still list the On-trial versions (nothing posts in a check; the test uses the mock); try with one unapproved and see why it will not start |
| 5 | **The old list goes; Pick the winner; the winner becomes the card** | Drop, bring back, add, Import from Frame move to the tab menu; **Pick the winner** during the trial; the others end as Not chosen; the swap of **link, thumbnail, caption and call to action** in the write order of 3.3, **with A's four fields written first and the `swap_record` marker and its "Finish / Put back" recovery**, Posted last; inherited fields stay inherited through the swap (3.3) with no prompt; undo becomes the reverse swap; `mainLetter`/`on_card`/`healMainPatch` follow the marker and then the winner; the card opens on the winner and a reload returns to it; End the trial without a winner (sets `trial_closed_at`); the 24 h readers and their tests retired. **Verified on a throwaway LINKED test-client card** (it needs a video and a graphic sub-issue), moved **only through UI writes**, never raw SQL status seeding (OPEN_REPAIRS 373), **including a reload in the middle of the swap**; the drift check runs only on an unlinked throwaway card | Run a whole trial: add, approve, Schedule, send, pick a winner, see the card become it and read Posted, close the tab mid-pick and see Finish / Put back, clear the winner and see A back |
| 5b | **The editor's side in Production** | "New cut ready" on Production's version row and in the tab menu, with "Same link: press New cut ready"; the A row labelled "Version A, on the card" with a confirm before replacing an approved one; **per-version rows on the thumbnail sub-issue** for the designer (S5); "A's work item is A's only" with a strip warning; Today's editor list reads by part | Send C back, see it on Today, press New cut ready on C's row, see C back with the SMM and A still approved |
| 6 | **Notes per version** | Notes switch follows the tab; unprefixed notes are Whole post | Write a note on C, see it only under C |
| 7 | **Month, Week and phone** | Trial dots; popover; phone layout; after a winner an ordinary Posted card | Look at the Calendar at 390 and 1440 |
| 8 | **Review boards per part** (Q4) | Each part approves by itself; one "Approve Version B" stays. Caption edits on the boards for a version that is not the card's stay blocked on the stage (`195:2747`); a change goes through "ask for a change" on that version's caption part. **Redo is keyed by the version and exists only on the video row; deleting a change comment reopens that part; a stale Kasper board cannot push old fields across a swap (test)** | Approve B's caption as the client link, see the grid change |
| 9 | **Posting after a winner, and the quiet Today line** | After a winner the winner is an ordinary post and the other versions are not offered; `post-source` and the client card read the effective version; the quiet "N trials running: pick a winner" line on Today (S3); nothing posts in a check | Pick the trial card on the Post tab (nothing is posted); see the line on Today |

Each step ships with a browser test at 1440 and 390 that fails on `main` and passes on the branch, the existing trial suites kept green (`trial-version-card-tabs-browser`, `trial-version-fields-browser`, `trial-reels-journey-browser`, `trial-version-review-parts-browser`), the identity check before pushing, and the refusal-log call plus a read-back on every new write. Rough size: step 0 a day; 1a and 1b two or three; 2 to 5 about a week and a half together; the rest another week. A fingerprint re-pin is not expected at any step; if a step touches a Section 4 function, re-pin in the same PR.

### Process before any build (Sidney, 4 Nov)

1. Sidney approves this plan (all questions are answered).
2. **A strong model reviews the plan once more**, after his approval.
3. **Only when the plan is final are the mockups made** (step 0). No mockup and no build starts before that.
4. **Sidney's plan (4 Nov, ~23:00): more review rounds until the reviewers find no bugs (the next is on Sunday), then the build, then merging for him and the test clients, then testing.**

## 11. Risks

- **The route value is a second copy of "where the card is".** It exists so Production, the drift check and old readers keep working; step 1a lists every reader, step 1b moves the queues off it, and the writer is one function with tests. A missed reader is the main risk.
- **Posted comes only with the winner now** (3.4); a Scheduled or Posted that arrives another way is ignored for the trial and warned about, and the end-of-day robot skips trial cards by the due() SQL change (a held migration, live before the flag widens). Step 1a lists every way in.
- **The winner swap** changes `trial-reels` (not Section 4) and writes the card through the page; a failed card write stops the pick and puts everything back. Its upside: every server reader already reads the card's columns, so none changes.
- **The trial flow change (3.4)** retires the automatic start and the 24 h clock for v2 clients; both ways coexist for a while, and every reader of the 24 h must be updated with its tests.
- **The trial flow (3.4)** retires the automatic start from Posted and the 24 h clock for v2 clients and moves the start to the morning of the scheduled date through a new check (the Posted robot is untouched); both ways coexist for a while, and every reader of the 24 h is updated with its tests.
- **A trial waiting for an unapproved version** must say so on the strip, or it looks stuck.
- **The 5 existing winners** (2 not A) keep their old copy; Clear-the-winner is refused on them.
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
| S7 | New rules ("but I don't know when this will go live"). | The `rules` marker is backfilled on the day the flag is turned on, from each card's state that day. 2.2 |

**Nothing is open for Sidney.** One engineering default of mine is marked in 2.2 for the next review to check: a card already Scheduled when the flag is turned on stays on the old rules (`v1`).
