# One card, many versions: the plan (session Trialplan, 4 Nov 2026)

**Plan only. No code, no migration, no deploy, no data change.** Plain English.
**Status: revision 8, 4 Nov 2026 ~22:25 UTC. Held for the next review round (session Trialjourney); no mockup starts before the reviews are done (Sidney: more review rounds first).** Revision 8 records Q-P, Q-Q and Q-R, adds a rule marker so cards already in flight stay on the old rules, and adds a plain description of how the Production tab looks for a trial card (3.5), which is also in the mockup list.
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
| **Component statuses: Video, Thumbnail, Caption** | **new**: two new columns for thumbnail and caption status, using the card's own status words. The video's is today's `status` |
| Notes | see section 5 |

**Rule for an empty field (Sidney: yes, 4 Nov):** each version has its own caption and image. An empty one still falls back to the card's in the data, so old trial cards keep working, but the screen says "Using Version A's thumbnail" with a one-click "Give Version B its own". It is never silent.

**A trial card has no status of its own (Sidney, 4 Nov): this is a visual rule.** Only versions have statuses on screen. The review (section 12, finding 1) showed that the *stored* card status cannot simply go away: the SMM tab, Kasper's queue, the client link, the Today page, `trial-reels` itself, Production's status sync and the drift check all read the card's `status` and `video_status` as their routing key. So:

- **On screen:** no card status pill on a trial card. The part pills belong to the selected version. The trial strip says "Trial · 3 versions".
- **Stored, hidden, system-written: a route status.** The card's own status columns stay and keep meaning what they mean today to every old reader. On a trial card they are a **route value** written by one function (today the page writes the "Approved once every version is approved or dropped" move; this plan gathers that into one tested writer, `routeStatusFor(versions)`). Nobody edits it by hand and no screen shows it as the card's status. It also carries the post's state (Scheduled, Posted), see below.
- **Queues stop depending on the route value** (build step 1b, before any visible change): for a trial card the SMM tab, Kasper's queue, the client link, Today (`097`, `_tdyTrialAsks`, which today reads only work items at SMM, Kasper or Client approval) and `trial-reels`' own reads decide "does this wait on me" from the **version rows, whatever the route value is, Scheduled included**. The review boards already do this per version (688 part 1); the remaining readers (`195:1640-1660`, whose overrides fire only when the card is at Kasper, Client or Tweaks; `190:2435, 2620, 1112`; `097:359-392`; `trial-reels index.ts:160, 250, 543, 638, 643, 676`; and Kasper's old shared core in `305`, which writes a card's caption, thumbnail and CTA with no trial awareness) get the same treatment. This fixes two cases: "A is Approved while B waits on the SMM, and B vanishes from the SMM tab", and (Q-O) a version sent back after the card is Scheduled, which today reaches no queue at all because B to E have no work items and the route value never leaves Scheduled. **Test:** card Scheduled, Version C sent back, C appears in the SMM tab and on Today, and the Production work item stays Scheduled (Q-Q). After 1b the route value is only for Production, the drift check, filters and old readers.

**Turning a trial on converts the card's data into Version A:**
- **Fields stay put.** A's link, thumbnail, caption and call to action stay in the card's own columns; the page reads them as Version A's. Nothing is copied.
- **One rule for part statuses (review H2): they always live in the version rows, A included.** A's row already has a video status and gets the same two new thumbnail and caption columns as B to E. The card's own status columns hold **only the route value**. **Cards already switched on never "switch on" again** (38 are on today), so there is no one-time copy: A's part statuses are **filled lazily on the first read by a v2 client** (a null in A's row is filled from the card's `video_status`, `graphic_status` and `caption_status`). Two of the enabled cards have no A row at all and get one at that read. **Cards caught mid-flight when the flag reaches a client stay on the old rules until they are done (Q-P, answered).** This needs a real marker, not a habit: a nullable `rules` column on `trial_reel_cards` (`'v1'` or `'v2'`), **backfilled once when the flag is turned on for a client**: a card that is already Posted, or has a version on trial, gets `v1`; every other enabled card gets `v2`; a card enabled afterwards gets `v2`. Everything in this plan (the queues' trial-aware reading, the Schedule gate, the on-read morning start, the due() skip) applies only to `v2` rows; `v1` rows keep today's behaviour exactly, including the automatic start from Posted. The marker is added by the step 2 migration. The one real card in this state today (Posted, all three versions still waiting, per the review's count) simply stays `v1`: **nothing has to be done to it** and its data is not touched. Is that safe? Under the old rules, a Posted card starts any version that is approved on the next read, so if someone approves its three versions later the trial starts then, as it always did; nothing is lost or started by this plan. The test-client trial cards need nothing: Sidney is deleting them through the app and will make new ones (no SQL; OPEN_REPAIRS 373), so they never meet the new rules half way. Switching the trial off sets the card's status columns from A's row.
- **Notes** are not rewritten (section 5).
- **No new `calendar_posts` columns.** A's call to action is the card's existing `cta`; A's part statuses are in its row. This matters because `calendar-upsert`'s allow-list is frozen (review, low 12).

**The route value, precisely (rule sheet in step 1):** per part, in the order In Progress, Tweaks Needed, For SMM Approval, Kasper Approval, Client Approval, Approved. Tweaks Needed on any live version wins, so a change request is never hidden; otherwise the least-advanced live version sets it; all live versions Approved gives Approved. **Once a winner exists the route value is the winner's statuses alone** (the others are ignored), so the card reads as an ordinary card of the winner. **The writer sets Posted only when a winner is picked, and never overwrites a Scheduled or Posted that came from elsewhere** (3.4).

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
  - **The write order (review H2, and the writers it really uses):** the video link is `deliverables.file_url`, shown as `asset_url`, and the thumbnail is shown from the graphic work item when the card has one (6 of the 38 do), so the swap is **four or five separate writes across three writers, none of whose source changes** (so "no re-pin" stays true): (1) the **link** through `production-write` operation `attachment` (with its `updated_at` check, `189:921-965`); (2) the **thumbnail** through the graphic attachment when the card has a graphic item, otherwise a card save (a card-save thumbnail would leave Production showing A's); (3) **caption and CTA** by card save; (4) `trial-reels` `winner_set`; (5) the **Posted status last**, through `production-write` operation `status` (`140:2195`), because once Posted reaches Production it cannot be quietly put back. A failure before step 4 puts everything back, as the 657 rule does today.
  - **Step 1a also checks:** the graphic work item route for the thumbnail; that the caption history entry is named "trial winner" and not a typed edit; that the swap mints a thumbnail revision and that is acceptable; and the Posted-to-Scheduled question above.
  - **`trial-reels` changes (not Section 4, no re-pin):** `winnerPatches` stops refusing with `attach_first` and does the two-way move of the four fields; `undoWinnerPatches` becomes the reverse swap; `mainLetter`, `on_card` and `healMainPatch` follow the winner; the page's `svTrialPick` (`189:1486-1530`) is rewritten to the order above.
- **After a winner, everywhere** (Q-A, Q-B, Q-D answered): views, the client link, posting, Production and Analytics treat the card as an ordinary card of the winner. The client link shows only the winner. Month and Week show one ordinary card, no per-version dots. Posting offers the winner as an ordinary post; the other versions are not offered (Q15). Scheduled and Posted are the winner's (3.4).
- **The 5 winners that exist today** are all on the test client. They are reset (or left, they are test data); no special rule, and "Clear the winner" works on them like any other.

### 3.4 The trial flow: Scheduled, then Trial by the date or a button, then the winner

**Sidney's rethink (4 Nov ~21:30 and ~21:35).** The trial should start when the card's date arrives, as a Scheduled card goes to Posted today, and also by a button. Versions on trial show Trial. The SMM picks the winner, who gets Posted and becomes the card. His own picture of the SMM's job: "an SMM would start a trial reel, then put the card in trial status. Whenever he picks a winner he goes on SyncView and picks the winner. That's it." No reminders.

**The flow, one line per step:**
1. **Each version is approved** on its own (or dropped). A version needs all three of its parts approved to count as approved.
2. **A person schedules the card with a Schedule action in the trial strip** (a button, since a trial card shows no status pill), with its one date shared by every version. **Scheduling a trial card needs every live version approved** (dropped ones don't count), and at least two live versions (a trial of one is a plain post; turn the trial off instead).
3. **The trial starts** in either of two ways, with the same write and the same gate:
   - **By itself on the morning of the scheduled date (Sidney, Q-N: "if it was scheduled for the 5th, it's because on the 5th it's going to be posted in the morning"):** from **06:00 US Eastern** (a proposed hour; one setting) on the scheduled date, when the gate passes. **Recommended as an on-read rule inside `trial-reels`, not a new timed function** (review M3): `trial-reels` already starts trials on any list or read (`startIfPosted`, `index.ts:158` and `540`), and the SMM tab, the Calendar and Kasper all list, so a v2 date rule there needs no new function, no pg_cron job and no vault key. The strip can show Trial from 06:00 ET even before the first read. **The rule is "scheduled date on or before today in ET", never "equals today"**, so a trial that was held (an unapproved version) starts on any later day once the gate passes. If a timed check is kept instead, the same `<=` rule applies. A server-side failure there does not reach the browser refusal log, so the watchdog signal is named in step 1a. **The end-of-day Posted robot needs a real change** (next bullet).
   - **The end-of-day Posted robot gets a real skip (review H1; the earlier "byte for byte untouched" is withdrawn).** `calendar_auto_posted_due()` (migration `2026-10-10-calendar-auto-posted.sql:208-247`) picks any card at Scheduled whose date has passed in ET and that has been quiet for an hour, then pushes Posted to the work items through `production-write` and the status bridge moves the card. With the stored status staying Scheduled for the whole trial, every v2 trial card that ran past its date would turn Posted, and its Production work items with it, with no winner. The fix is one line in the due() SQL: `and not exists (an enabled trial_reel_cards row with rules = 'v2')` (a `v1` card still turns Posted at the end of its day, as today, because the old rules want that). **That is a migration, held for Lighthouse to apply, and it must be live before `trial_versions_v2` widens beyond the test client.** The other option, a check in `calendar-auto-posted/logic.mjs`, is not Section 4 either. Every other card is unaffected: ordinary Scheduled cards still turn Posted at the end of the day.
   - **By the button Start trial** in the trial strip (SMM and admin), any time the gate passes, even before the date. This is the existing manual `trial_start` action.
4. **Trial is shown clearly** (below). **No countdown, no hours.**
5. **Pick the winner**, any time while the trial runs (Q-K: yes, with a one-line confirm). The winner becomes the card by the swap in 3.3 and takes **Posted**; it is the default tab. **The others end as "Not chosen"** (today's `lost`, relabelled). A dropped version stays dropped.
6. **End the trial without a winner** is also offered (today's `no clear winner`): the card goes back to Version A as its version.

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
| What starts the trial | Once the card is **Posted** (the robot turns Scheduled into Posted at the **end** of the scheduled day), any read of the card puts every approved version on trial (`autoTrialPatches`, OPEN_REPAIRS 570) | **The morning of the scheduled date, from 06:00 US Eastern** (a check every 15 minutes, when the gate passes), or a person presses Start trial. `autoTrialPatches` does not run for these clients. Non-trial cards still turn Posted at the end of the day, unchanged |
| What the card reads | Scheduled, then Posted at the end of the date | Scheduled, then the Trial label on the morning of the date, then Posted with the winner |
| The clock | `trial_ends_at` = start + 24 h; "On trial · 17 h left"; the winner is refused until then (`trial_not_over`) | No clock on screen. The winner can be picked any time. `trial_ends_at` left empty for new trials; old rows keep theirs |
| Unapproved versions | Whatever was approved at that moment goes on trial; the rest are left out | Cannot schedule or start with one unapproved; the date start waits |
| Losers | "lost" | "Not chosen" |
| Client link | Only the winner once picked | Unchanged |

**What Instagram does (my understanding; the review confirmed the code side and found third-party API documentation agreeing that sharing a trial reel to followers is not in Meta's API and is done in the Instagram app; no platform 24 h or 72 h window could be confirmed):** this repo posts trial reels with the manual setting only, so Instagram never shares one to followers by itself and has no 24 h end of its own; the 24 h was this team's rule. Picking the winner in SyncView does not change anything on Instagram. Sidney has decided there is **no reminder and no nudge**, so none is planned; the SMM's picture of the job above is the whole flow.

**One safeguard kept (cheap):** Start trial, the date start and Pick the winner each write a plain history line ("Trial started: Versions A, B, C", "Winner: Version B, chosen by <staff>"), so what happened and when can be read later.

**Risks:**
- **Two ways to start for a while:** clients on the switch use the new rules, others the old automatic start. `trial-reels` and the due() SQL branch on `trial_versions_v2`, and a test covers both. **Cards already Posted or already on trial when the flag reaches a client finish on the old rules** (Q-P).
- **The morning start (3.4)** is a new check (default: a small new function; the Posted robot stays untouched for other cards). Step 1a settles it, that it is idempotent (a card already on trial is not started twice), that it respects the gate, whether it needs a fingerprint re-pin, and the hour (06:00 US Eastern proposed, one setting). Because the trial now starts about a day-part before the Posted robot would have run, a v2 trial card must never also reach the end-of-day Posted robot.
- **A card can become Scheduled or Posted another way** (a Production work item or SyncLinear moved through the status bridge). **The gate must hold on the server**, not only in the button: a v2 trial card that arrives at Scheduled with a live version unapproved does not start a trial; one that arrives at Posted does not start or end a trial or hide versions. Both are ignored for the trial and **warned about on the strip**. Step 1a lists every way in for both words.
- **A trial that waits for an unapproved version** needs a clear strip message, or it looks stuck. It is in the mockup.
- **Every reader of the 24 h** (the card's countdown, the Production line, the nightreel check, `trial_not_over`, the journey tests) must stop expecting it; step 5 owns this with its tests.
- **A version that is the only live one** after drops: trial cannot start (needs two). The strip says so.
- **Winner shown as Posted on SyncView while the reel is still trial-only on Instagram** is accepted by Sidney's description of the SMM's job; no reminder is built.

**Questions for Sidney: all answered** (Q-G and Q-H were dropped; Q-I to Q-O are recorded below).
- **Q-M.** **Answered:** yes, Trial is a label on the strip, tabs and Month and Week; the stored card status stays Scheduled until the winner.
- **Q-N.** **Answered:** the trial starts on the **morning** of the scheduled date, not at the end of the day. Built as above (06:00 US Eastern proposed; Posted for ordinary cards stays as it is, at the end of the day).
- **Q-O.** **Answered:** hold. A version sent back after scheduling (for example the client asks for changes on an approved version) holds the trial until it is approved or dropped; the strip says so.

### 3.5 How the Production tab looks for a trial card (Sidney's question, 4 Nov)

Read from the docs and the Production fragment (`245`), not seen on a live screen; step 1a confirms each line against a throwaway linked card, and the mockup shows it.

- **The parent issue** is the post itself, as today. Its status is the route value (Scheduled while the trial is Scheduled or running, Posted after a winner). **A trial card's parent carries a "Trial · N versions" line** (N counts live versions) with the version dots; it does not show a status per version, because the parent has one status. Once a winner is picked the line is gone and the parent is an ordinary Posted parent.
- **The sub-issues** are the card's real work items, one for the video and one for the thumbnail (graphics) where the card has one, as today. **Nothing about them is duplicated per version.** A video sub-issue's status follows the route value, as today.
- **Versions B to E have no work items** (only Version A's work item exists, and after a winner the winner's content is attached to it). They show only in the video sub-issue's **Assets box**, which already has one "Deliverable file · Version A" to "· Version E" row per version, each with its own Edit and its sharing state (Available, Missing, Permission denied). That stays as it is, with the new naming. A version with no link yet shows as a row that says so.
- **Where a version's tweaks show:** a change asked on one version is a note named "Version C: ..." (today's naming). It appears in the sub-issue's **Feedback & tweaks** list as a tweak, labelled Video or Graphics and "Tweak · Round N", with the version's name at the start. **The sub-issue and the parent keep their status** (Scheduled): only Version C's own status goes to Tweaks Needed (Q-Q, Sidney: "only version C is marked tweaks needed"). The editor finds C's tweak on Today and in the SMM tab through the queues in 2.2, not through a changed work item.
- **After a winner:** the video sub-issue's file row for the winner is the card's video, the other rows read "Not chosen", and the parent is Posted.
- **What Production cannot do** (and the mockup says so): it cannot set a version's status, because B to E have no work item to set it on. Version statuses are set on the card only.

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
- **One new migration (step 2), all nullable, so existing rows stay valid:** `cta`; `thumbnail_status`, `caption_status` (the card's status words). **Null means "follows the version's one existing status"**, today's 688 behaviour where one status covers all three parts; the first per-part write on a version fills in all three explicitly, so a version is never half old and half new; and for the new per-part approvals either stamps per part or reuse of the three stamps with a part. The exact shape is for step 2's own design review, because it must keep the existing "approved on all three" meaning for old rows. Every revoke names all four roles (anon, authenticated, public, service_role) and reads the grants back, as the earlier migrations do. Rollback is dropping the columns.
- **Migration of trial cards already live:** none needed for the data. Fields already sit on the card; A's part statuses are filled lazily on the first v2 read (2.2); null in the new columns means today's behaviour, so every existing version reads exactly as before. Counts read on 4 Nov (counts only): **63 switch rows, 38 on (5 real, 33 test); 189 version rows** (A 60, B 59, C 46, D 14, E 8, F 2, G 1), of which F and G are all dropped. All 5 winners are on the test client (2 are not A). Every one of the 38 enabled cards is linked to a Production video work item; 6 have a graphic (thumbnail) work item; none has a call to action; 4 versions are on trial, all on the test client; 2 real enabled cards have no version rows at all; one real enabled card is Posted with all three versions still waiting (the old auto-start never fired on it). **The migrations this plan needs:** (1) the new version columns (step 2); (2) the due() SQL skip for trial cards (H1), held and live before the flag widens.
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
| A version answered, then its field changes | Restarts through the SMM (already true for thumbnail and caption); per part, only that part restarts |
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
| 1a | **Measure and write the rules** (docs and read-only tests) | Inventory every reader and **writer** of a card's status and of its `asset_url`, thumbnail, caption and CTA (the lists in 2.2 and 3.3 are a start, including Kasper's old shared core in `305`); the route-value rule sheet; the notes check; every way a card can arrive at **Scheduled or Posted**; the swap's four checks (graphic route, caption history origin, thumbnail revision, Posted back to Scheduled); the watchdog signal for the on-read start; a test that fails if a version row ever gets a work item | The rule sheet |
| 1b | **Queues read version rows** (code, no new look) | SMM tab, Kasper, client link, Today and `trial-reels` reads decide "waits on me" from the version rows **whatever the route value is, Scheduled included**. Tests: A Approved and B at the SMM, B is in the SMM tab; at Kasper, at the client; **card Scheduled, C sent back: C appears in the SMM tab and on Today, the work item stays Scheduled** | Nothing new on screen; the queues are right in the odd cases |
| 2 | **Migration and function** | CTA and thumbnail and caption status columns on the version rows; `trial-reels` reads and writes them; the cap moves to A to E for **adding** (in `logic.mjs:7`, `higgsfield-mcp/trialreels.mjs:45`, and the `189`/`194` regexes); the route writer and `effectiveCardFields` as tested functions. Migration held until Lighthouse applies it; no `calendar_posts` column | Nothing visible (flag off to the page) |
| 3 | **Tabs edit the selected version** | The card's Video, Thumbnail, Caption and CTA follow the tab and save to it; the old list still present | Type a caption on B, reload, see it on B, A unchanged |
| 4 | **Part statuses, pips, status grid, Schedule, Start trial** | Each part's pill on the selected tab (statuses in the version rows, lazy fill for A); the route writer runs; the **Schedule** action and **Start trial** in the trial strip with the gate (every live version approved, at least two live), held on the server too; **the `trial-reels` changes Start trial needs**: it is refused today before Posted (`trial_starts_when_posted`, `index.ts:672-673`) and `trialPatches` still sets a 24 h end that blocks the pick (`trial_not_over`), so both change here, or Start trial moves to step 5; the **due() SQL skip migration** (held, live before the flag widens); the Trial label on the strip, tabs, and Month and Week; version menus stop at Approved; the card shows no status pill | Set B's thumbnail to Approved; see the grid without switching; approve three versions, Schedule, press Start trial and see Trial on all of them at once; try with one unapproved and see why it will not start (test client, nothing posts) |
| 5 | **The old list goes; the morning start; Pick the winner; the winner becomes the card** | Drop, bring back, add, Import from Frame move to the tab menu; **Pick the winner** during the trial; the others end as Not chosen; the swap of **link, thumbnail, caption and call to action** in the write order of 3.3 (attachment, graphic or card save, caption and CTA, `winner_set`, Posted last), part statuses staying in the rows; undo becomes the reverse swap; `mainLetter`/`on_card`/`healMainPatch` follow the winner; the card opens on the winner and a reload returns to it; End the trial without a winner; the 24 h readers and their tests retired; **the morning start** (an on-read rule in `trial-reels`, from 06:00 US Eastern, "scheduled date on or before today") with its idempotence and the waiting-for-approval rule tested. **Verified on a throwaway LINKED test-client card** (it needs a video and a graphic sub-issue), moved **only through UI writes**, never raw SQL status seeding (OPEN_REPAIRS 373); the drift check runs only on an unlinked throwaway card | Run a whole trial: add, approve, Schedule, Start trial, pick a winner, see the card become it and read Posted, clear the winner and see A back |
| 6 | **Notes per version** | Notes switch follows the tab; unprefixed notes are Whole post | Write a note on C, see it only under C |
| 7 | **Month, Week and phone** | Trial dots; popover; phone layout; after a winner an ordinary Posted card | Look at the Calendar at 390 and 1440 |
| 8 | **Review boards per part** (Q4) | Each part approves by itself; one "Approve Version B" stays. **Caption edits on the review boards for a version that is not the card's are blocked today (`195:2747`); decision: they stay blocked on the stage and the client's caption change goes through "ask for a change" on that version's caption part**, since a caption edit there would also approve | Approve B's caption as the client link, see the grid change |
| 9 | **Posting reads the new rule** | "Approved" means all three parts; the Post tab posts the approved versions as trial reels (a person, nothing automatic); after a winner the winner is an ordinary post and the other versions are not offered; nothing posts in a check | Pick the trial card on the Post tab (nothing is posted) |

Each step ships with a browser test at 1440 and 390 that fails on `main` and passes on the branch, the existing trial suites kept green (`trial-version-card-tabs-browser`, `trial-version-fields-browser`, `trial-reels-journey-browser`, `trial-version-review-parts-browser`), the identity check before pushing, and the refusal-log call plus a read-back on every new write. Rough size: step 0 a day; 1a and 1b two or three; 2 to 5 about a week and a half together; the rest another week. A fingerprint re-pin is not expected at any step; if a step touches a Section 4 function, re-pin in the same PR.

### Process before any build (Sidney, 4 Nov)

1. Sidney approves this plan (all questions are answered).
2. **A strong model reviews the plan once more**, after his approval.
3. **Only when the plan is final are the mockups made** (step 0). No mockup and no build starts before that.

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
