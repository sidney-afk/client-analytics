# One card, many versions: the plan (session Trialplan, 4 Nov 2026)

**Plan only. No code, no migration, no deploy, no data change.** Plain English.
**Status: revised 4 Nov 2026 ~19:45 UTC with Sidney's answers (section 9). Ready for review.** Where an answer changed the plan, the text below is already rewritten; section 9 lists each answer and where it landed.
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

**A trial card has no status of its own (Sidney, 4 Nov).** Only versions have statuses. Turning the trial on **converts** the card's existing data into Version A: link, thumbnail, caption, call to action, the three part statuses, and the notes. This fits the finding "A is the card itself", with one rule changed:

- **Data does not move.** A's fields and A's three part statuses (`video_status`, `graphic_status`, `caption_status`) *stay in the card's own columns*. "Converting" means the page reads them as Version A. Nothing is copied, so there is nothing to get out of step, and switching the trial off gives the data back untouched. Notes already on the card read as Version A's (a note with no "Version X:" prefix is A's; the "Whole post" filter shows all).
- **The old roll-up idea is dropped.** The first draft kept the card's status as a roll-up of its versions. Sidney said no: the card has no status of its own. So **nothing writes a roll-up to the card**, and the card's status columns mean "Version A's" for as long as the trial is on.
- **B to E** keep theirs in the version rows (existing `status` plus approval stamps for Video; new columns for Thumbnail and Caption, section 7.1).

**What every reader of a card's status shows for a trial card (to be inventoried in step 1; the first list):**

| Reader | Shows for a trial card |
|---|---|
| Card (staff) | No card status pill. The part pills belong to the selected version. The trial strip says "Trial · 3 versions" |
| Month and Week | One dot per live version, each its least-advanced part (already built for the single status; the three-part version is step 7). No single status colour on the card |
| SMM Review tab, Kasper, client link | Already per version (688 part 1). A trial card is listed while any version waits on that reviewer |
| Production (parent issue and work items) | Work items follow the card's columns, which are Version A's. So **Production's parent status would reflect A only.** Recommended: the parent shows "Trial · N versions" with the version dots, and its status is left to A's. Needs the owner's eye (Q13). B to E already have one "Deliverable file" row each, unchanged |
| Calendar status filters and counts | A trial card is counted by Version A's status unless the filter is trial-aware. Recommended: a trial card matches a status filter if **any** live version has it, and counts are by version, not by card. The exact list of filters and reports that read card status is a step 1 inventory (not measured here) |
| Drift check (card against work items) | Unchanged: A's columns against A's work items, as today |
| Post tab "From a card" | Lists a trial card's versions by their own approvals (P4), not the card's status |
| Analytics | Per-version rows already exist; unchanged |

**When the trial ends or is switched off:**
- *Before a winner:* switching the trial off hides B to E and shows Version A as the plain card. Nothing is deleted; the page says "3 other versions are kept, hidden" and switching on again brings them back.
- *After a winner (Sidney, 4 Nov: "no replacement, just the winner gets highlighted in the toggle"):* **nothing is swapped or copied.** See section 3.3 for what the card, posting and the views use. Switching the trial off while a winner exists is **refused** with "Version C is the winner. Clear the winner first", so the winner is never silently lost. (Q14 asks whether Sidney wants an explicit "Keep Version C as the card" button that copies its data over; recommended: not now.)

**Why not make each version its own hidden card?** Considered and rejected. It would put every version through the status sync, the drift robot, Production work items and Month and Week, and it touches the three Section 4 functions. The current design (one card, version rows beside it) keeps all of that untouched.

**How many versions: up to five, A to E (Sidney, 4 Nov).** *Assumption to confirm:* he wrote "ABCDF"; this plan reads it as five versions, A to E. The function today allows A to G. Existing rows, counted live on 4 Nov (counts only): A 60, B 59, C 46, D 14, E 8, **F 2, G 1**, and **all three F and G rows are already dropped** (none live). So a cap of five **hides nothing anyone uses**: the three dropped rows stay in the table and in history, are not shown as tabs, and can still be read by the function. The cap applies to adding, so "+" stops at E. The function's limit moves from G to E in step 2 for new versions only. Worst case if the assumption is wrong: a cap of seven is a one-line change.

**Version A cannot be dropped** (it is the card's data) and **there is no "swap A out"** (Sidney, 4 Nov): the winner is highlighted, nothing moves.

## 3. The card UI

### 3.1 The switch is the main control

- **Where:** directly under the card header, above the picture, full width: `Version A  Version B  Version C   +`. The selected tab is underlined (the Quiet look Sidney chose on 3 Nov).
- **What follows the tab:** the picture, the Video link row with its status pill, the Thumbnail row and its pill, the Caption box and its pill, the Call to action, and the Notes button. Switching saves nothing. Typing saves to the selected version only, with the card's usual save indicator.
- **A card-level strip stays put** above the tabs: trial switch, date, platforms, post state, overall status. It never changes when you switch tab, so you always know what is card-wide.
- The status pills on each part use the card's own menu, wording and permissions exactly (Sidney's D1, 2 Nov): In Progress, For SMM Approval, Kasper Approval, Client Approval, Tweaks Needed, Approved. Scheduled and Posted stay card-level.
- Keyboard: left and right arrow move between tabs; Enter opens; the tab group is one tab stop.

### 3.2 The old dropdown list

**It goes** once the tabs are editable (step 5), because everything in it moves onto the card. What it did, and where it moves:

| Old list | New home |
|---|---|
| Paste or change a link, New cut ready | the Video row of the selected tab |
| Thumbnail and caption lines | the card's Thumbnail and Caption of the selected tab |
| Drop / Bring back | a menu on the tab (the three dots) |
| Winner trophy | the same menu, shown only when the 24 h are over |
| + Add version and Import from Frame | the `+` at the end of the tabs; Import from Frame inside it |

Until step 5 lands, the list stays and the tabs remain as they are, so nothing breaks half way.

### 3.3 Adding, dropping, bringing back, picking a winner

- **Add:** `+` offers the next free letter, empty, and selects it. An empty version shows "No link yet" and cannot be sent for review (as today).
- **Drop:** tab menu, "Drop Version C". The tab stays visible but muted with "Dropped" and a Bring back button, so it is never a surprise that it vanished. (Today a dropped version has no tab; changing that is Q7.) If the dropped version was the one on screen, the card moves to the nearest live tab and says so in one line.
- **Winner (Sidney, 4 Nov):** in the tab menu once the 24 h are over: "Make Version B the winner". **It writes nothing to the card.** Version B's tab gets a highlight (a small trophy mark and a quiet outline) and stays in the row with the other tabs, which stay readable. The winner can be cleared ("Clear the winner") by anyone who set it; there is no copy to undo, so **the old Undo-after-copy machinery (657) is removed**. Fewer moving parts: the pick is one flag on `trial_reel_cards`, as today.
- **After a winner is picked, what uses what:**
  - *The card's picture, title area and previews (Month, Week, lists):* read the winner's thumbnail, caption and call to action. The card's own columns still hold Version A's.
  - *Posting:* "From a card" on a trial card with a winner offers the **winner's** video, thumbnail, caption and call to action as an ordinary post (D3: nothing goes anywhere automatically). The other versions are not offered once a winner exists, unless Sidney asks (Q15).
  - *The client link:* shows only the winner (today's rule), with the winner's own fields.
  - *Production:* unchanged (one file row per version).
  - *Analytics:* the winner is flagged; per-version numbers stay separate.
  - One shared helper decides "which version's fields does this card show", used by every reader above, so none of them guesses (step 3).

## 4. Seeing every version's status without switching

Four layers, from quietest to most detail. Recommended: build the first three, offer the fourth later.

1. **On each tab: three small pips** after the letter (Video, Thumbnail, Caption), each in its status colour, with the words in the tab's accessible name and tooltip. Today it is one dot.
2. **A status grid under the tabs, always visible, three rows by three columns:** rows A, B, C; columns Video, Thumbnail, Caption; each cell a coloured dot with a one-word state on hover. Clicking a cell selects that version. It is small (about 3 lines tall) and collapses to a single line of pips on the phone. This answers "know their statuses by just looking".
3. **Month and Week:** today's one dot per live version stays, showing that version's least-advanced part, with a trophy on the winner's dot. There is no card-level dot. Hover or focus opens the grid in a small popover.
4. **Later, if Sidney wants:** a filter "trial versions waiting on me" on the SMM and Kasper review tabs.

**Production:** no change in step order (one Deliverable file row per version already exists). A later option is to show the three pips next to each version row.
**Phone:** tabs scroll sideways if more than four; the grid is a one-line pip row that opens as a sheet.

## 5. Notes per version, and comments

- **Today:** a note is the card's, with a "Version B:" text prefix and a Video switch that only moves the player.
- **Wanted:** the Notes panel opens on the version selected on the card, has the same A/B/C switch, and shows only that version's notes, with a "Whole post" filter for card-level notes. A new note is tagged to the selected version.
- **Recommended mechanism, in two stages:** first read-side, using the existing "Version B:" prefix so nothing in the database moves and old notes sort themselves (the page already accepts both "Video" and "Version" prefixes). Second, only if the first proves too fragile, a real version field on notes. Whether the notes table can take that field without touching a Section 4 function **was not measured in this session and is a step 1 check** (Q8 asks for nothing; it is engineering).
- **Client and Kasper:** a change request on the review boards already names its version and part ("Version C, thumbnail: ..."). Landing it on the right version is already true; after this plan it also moves **that version's** component status to Tweaks Needed, instead of the version's single status.
- **A client deleting their own comment:** it already deletes the Production copy too (690). It stays version-less (a delete is by id), so it cannot land on the wrong version.

## 6. Other surfaces

- **Review boards (client link, SMM Review tab, Kasper):** already show one version at a time with its own three parts (688 part 1). Change: each part's Approve moves *that part of that version* (today one Approve covers all three). The visible default can stay "Approve Version B" as one button that approves all three parts, with each part's own Approve under it for people who want it. This is Q4.
- **Production and SyncLinear sub-issues:** unchanged. One "Deliverable file" row per version already exists and is a link, not a status. **Sub-issues must not be creatable from SyncLinear** (standing rule); nothing here adds that.
- **Posting (Post for Me):** after a winner, see section 3.3. Before one, today "From a card" posts each *approved* version as its own Instagram trial reel with that version's video, thumbnail and caption (P4, held for Sidney's D3). This plan adds the CTA to what is sent only if the caption already carries it; it does not change which versions go. Approved means all three parts approved. Nothing posts automatically and no automated check ever posts.
- **Analytics (later):** the version rows already have `views, watch_time_s, shares, saves, follows`. Per-version results stay a later step and need nothing from this plan.

## 7. Data and live systems

### 7.1 Schema: what exists, what must change

- **Exists:** `trial_reel_cards`, `studio_trial_versions` with thumbnail, caption, change_part (migration `20261102200000`). No browser role can read or write either table; only the `trial-reels` function does.
- **One new migration (step 2), all nullable, so existing rows stay valid:** `cta`; `thumbnail_status`, `caption_status` (the card's status words; null means "follows the version's one status", today's behaviour); and for the new per-part approvals either stamps per part or reuse of the three stamps with a part. The exact shape is for step 2's own design review, because it must keep the existing "approved on all three" meaning for old rows. Every revoke names all four roles (anon, authenticated, public, service_role) and reads the grants back, as the earlier migrations do. Rollback is dropping the columns.
- **Migration of trial cards already live:** none needed for the data. A's data already sits on the card, and null in the new columns means today's behaviour, so every existing version reads exactly as before. Counts read on 4 Nov (counts only, one read-only query): **63 switch rows, 38 on, 5 winners; 189 version rows** (A 60, B 59, C 46, D 14, E 8, F 2, G 1), of which F and G are all dropped. The existing 5 winners keep their pick. **Behaviour change for them:** before, a winner's data had been copied onto the card by the page; from step 5 the card keeps whatever it holds and the highlight is the pick (nothing is un-copied, and nothing already copied is reverted).
- **The flag `trial_versions_v2` stays test client only** until Sidney clears each step.

### 7.2 Section 4 functions

`production-write`, `deliverable-write` and `batch-write` **do not need to change**: trial-reels writes no calendar row, and **with no roll-up and no winner copy, nothing about a trial card is written to the card by this work** except Version A's own edits through today's card save. The tests must prove this as a check (no write to a card row except the roll-up), and the PR checklist states "no Section 4 file touched, no fingerprint re-pin". If a step ever does touch one, re-pin with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`, in the same PR. The merge lane holds `trial-reels` until the migration is applied (it carries an `ef-auto-deploy-applied-when` line); Lighthouse applies it and runs the merge lane by hand. Sidney runs nothing.

### 7.3 Write-refusal log

Every new write (version field, version part status) must call the existing refusal reporting (`_writeUiRecordFailure`, board `calendar`) so a refused save, a dropped press and a reload mid-save show up for the watcher. Absence from the log is not proof a save worked, so each new write also gets a read-back test.

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
| Phone | Tabs scroll; the grid collapses to pips; each field is full width; no sideways page scroll at 390 |
| Month opened on another month, Week | Fixtures use dates relative to today (the standing rule) |

## 9. Sidney's answers (4 Nov 2026 ~19:40 UTC) and the questions still open

| # | Answer | Where it landed |
|---|---|---|
| Q1 | "If it is trial, does it have a card own status? I think only the versions. And the data from before trial converts into version A." **A trial card has no status of its own; turning trial on converts the card's data into Version A.** | 2.2 (rewritten): data stays in the card's columns and is read as A; no roll-up; reader table; what happens when the trial ends |
| Q2 | Yes: each version has its own caption and image, and part statuses | 2.2, 7.1 |
| Q3 | Yes: fallback shown, never silent | 2.2, 8 |
| Q4 | Yes: one "Approve Version B" plus a small per-part approve | 6, step 8 |
| Q5 | No single control for all three parts | 3.1 |
| Q6 | "No replacement, just winner gets highlighted in the toggle." **No swap, no copy** | 3.3 (rewritten), 2.2; step 5 simplified |
| Q7 | Yes: a dropped version keeps a muted tab with Bring back | 3.3 |
| Q8 | Yes: Notes open on the selected version, with a "Whole post" filter | 5 |
| Q9 | No: do not remember the last tab | 8 |
| Q10 | Yes: the status grid is always visible | 4 |
| Q11 | Yes: the old list goes in step 5 | 3.2 |
| Q12 | "Up to 5 versions, A to E" (he wrote "ABCDF"; read as five). **Assumption, flagged** | 2.2 |

**New questions this raised.** Each has a default; if Sidney says nothing, the default is built.

13. **Q13. Production's parent issue for a trial card.** It follows Version A's columns. Recommended: show "Trial · N versions" with the version dots on the parent and leave its status as A's.
14. **Q14. Ending a trial with a winner that is not A.** Recommended: no copy, the highlight is the pick; trial switch-off is refused until the winner is cleared. Alternative: an explicit "Keep Version C as the card" button.
15. **Q15. After a winner, can the other versions still be posted?** Recommended: no; only the winner is offered, as an ordinary post.
16. **Q16. Calendar filters and counts.** Recommended: a trial card matches a status filter if any live version has it, and counts are by version.
17. **Q17. The cap of five.** Confirm "A to E" is what "ABCDF" meant. The three existing F and G rows are all dropped, so nothing is lost either way.

## 10. Build order: small PRs, each testable on the test client

Everything stays behind `trial_versions_v2`, on for the test client only. The card "Video 2 — TEST2" is never touched; test cards are throwaway ones for the test client.

| Step | PR | What it is | What Sidney can click after |
|---|---|---|---|
| 0 | **Clickable mockup of the final card** (design only, no wiring) | Every state in sections 3, 4 and 8 on the card, Month/Week and the phone, using placeholder data. Approved before step 1 | Click through the tabs, the grid, drop, winner, empty field, phone |
| 1 | **Measure and write the rules** (docs and a read-only test) | List every reader of a card's status (views, filters, reports, Production, drift, posting) and what each shows for a trial card; write the field rules as a table with tests that fail on today's code; check the notes mechanism and that no Section 4 file is touched | Nothing visible; the rule sheet |
| 2 | **Migration and function: CTA and per-part status** | The migration; `trial-reels` writes and reads them; the cap moves from G to E for new versions; the "which version's fields does a card show" helper in `logic.mjs` with unit tests; migration held until applied by Lighthouse | Nothing visible yet (flag off to the page) |
| 3 | **Page: tabs edit the selected version** | The card's Video, Thumbnail, Caption and CTA follow the tab and save to it; the old list still present | Type a caption on B, reload, see it on B, A unchanged |
| 4 | **Page: part statuses on the card** | Each part's pill on the selected tab (A's are the card's columns, B to E's the rows); the tab pips; the status grid. No card status is written | Set B's thumbnail to Approved; see the grid without switching |
| 5 | **Page: the old list goes; drop, bring back, winner, add and Import from Frame move to the tab menu** | The winner is a highlight only (no copy, no Undo); the card, previews and the client link read the winner through the shared helper | Run a whole trial: add, drop, bring back, pick and clear a winner |
| 6 | **Notes per version** | Notes switch follows the card's tab; "Whole post" filter | Write a note on C, see it only under C |
| 7 | **Month, Week and phone** | Pips and popover on Month and Week; phone layout | Look at the Calendar at 390 and 1440 |
| 8 | **Review boards per part** (Q4) | Each part approves by itself; one "Approve Version B" stays | Approve B's caption as the client link, see the grid change |
| 9 | **Posting reads the new rule** | "Approved" for posting means all three parts; after a winner, only the winner is offered, with its own fields; nothing posts in a check | Pick the trial card on the Post tab, see only fully approved versions (nothing is posted) |

Each step ships with a browser test at 1440 and 390 that fails on `main` and passes on the branch, the existing trial suites (`trial-version-card-tabs-browser`, `trial-version-fields-browser`, `trial-reels-journey-browser`, `trial-version-review-parts-browser`) kept green, and the identity check before pushing. Rough size: step 0 is a day; steps 2 to 5 are the weight, about a week together; the rest is another week. No fingerprint re-pin is expected at any step.

## 11. Risks

- **A as the card, the others as rows** is the one seam. With no roll-up and no copy it is smaller than in the first draft, but every reader of a card's status must be found and made trial-aware; that inventory is step 1, and a missed reader is the main risk.
- **Production's parent status follows A only** (Q13).
- **Per-part approval changes what "approved" means** for the review boards and for posting; steps 8 and 9 exist to change those deliberately and never as a side effect.
- **A reload during a save** and **two staff on one version** are covered in section 8, and each has a test.
