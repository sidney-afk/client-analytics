# One card, many versions: the plan (session Trialplan, 4 Nov 2026)

**Plan only. No code, no migration, no deploy, no data change.** Plain English.
Counts quoted from earlier measurements are dated; step 1 below re-measures them before anything is built.
Nothing here was read from the live database in this session. What was read: STATE_OF_THINGS, OPEN_REPAIRS 688 (parts 1 to 3), 656/657/659/661, ATLAS "Trial reels", `src/index/189`, `194`, `245`, `299`, the `trial-reels` Edge Function (`logic.mjs`, `index.ts`), the three trial migrations, draft plans #2521, #2524 and the design-options PR #2581.

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

**Recommended rule for "empty":** an empty field still *falls back to the card's* in the data (so existing trial cards keep working), but the screen never hides that: it says "Using the card's thumbnail" with a one-click "Give Version B its own". See question Q3.

**What stays on the card, whichever tab is selected (card-level):** date and time, platforms, posting state (Scheduled, Posted) and the post itself, the trial switch, internal title, colour tag, archive, YouTube title, collaborative-editing settings, assignee. A **trial strip** at the top carries the switch, the date and the overall status. Reason: these describe the *post*, and a trial is one post with several cuts. (The 24 h trial clock is also per post: Posted starts it for all versions.)

**Why not make each version its own hidden card?** Considered and rejected. It would put every version through the status sync, the drift robot, Production work items and Month and Week, and it touches the three Section 4 functions. The current design (one card, version rows beside it) keeps all of that untouched.

**The one hard rule to settle (Q1):** how the card's own status relates to its versions' statuses. Today the card goes to Approved only when every live version is approved or dropped (the page writes it). With per-part statuses, the recommended rule is: **the card's component statuses are a roll-up of its live versions, least-advanced wins** (one version still with the client keeps the card's Video at Client Approval). The roll-up is what Month, Week, Production and the drift check keep seeing, so none of them change. A version's own statuses are never written to the card by anything except this roll-up.

**Version A's own statuses:** A's thumbnail and caption fields are the card's, so A's *component statuses* are read from and written to the card's `graphic_status` and `caption_status`, not copied into new columns (one source, so they cannot disagree). That means the roll-up must read A from the card and B, C from their rows. This is the part that needs the most care and the most tests (step 2).

**More than seven versions, or A dropped?** Seven is plenty for a trial (Instagram runs a handful). Dropping A is not allowed today (it is the card). Sidney's flow "A lost, make B the card's version" is the same machinery as picking a winner (copy fields onto the card). Recommended: **do not add a separate "swap A out" action**; "Make B the card's version" is offered only as part of picking a winner. See Q6.

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

### 3.3 Adding, dropping, bringing back, picking a winner, Undo

- **Add:** `+` offers the next free letter, empty, and selects it. An empty version shows "No link yet" and cannot be sent for review (as today).
- **Drop:** tab menu, "Drop Version C". The tab stays visible but muted with "Dropped" and a Bring back button, so it is never a surprise that it vanished. (Today a dropped version has no tab; changing that is Q7.) If the dropped version was the one on screen, the card moves to the nearest live tab and says so in one line.
- **Winner:** in the tab menu once the 24 h are over. It copies the winner's video, thumbnail, caption **and call to action** to the card (today's behaviour plus the CTA), then removes the tabs. The toast says "Version B is the winner · Undo". Undo puts back the card's own fields and is refused with a plain message if the card was edited since (already built in 657).
- **Undo** exists only on that toast, as today.

## 4. Seeing every version's status without switching

Four layers, from quietest to most detail. Recommended: build the first three, offer the fourth later.

1. **On each tab: three small pips** after the letter (Video, Thumbnail, Caption), each in its status colour, with the words in the tab's accessible name and tooltip. Today it is one dot.
2. **A status grid under the tabs, always visible, three rows by three columns:** rows A, B, C; columns Video, Thumbnail, Caption; each cell a coloured dot with a one-word state on hover. Clicking a cell selects that version. It is small (about 3 lines tall) and collapses to a single line of pips on the phone. This answers "know their statuses by just looking".
3. **Month and Week:** today's one dot per live version stays, now showing each version's roll-up (least-advanced part). Hover or focus opens the grid in a small popover.
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
- **Posting (Post for Me):** today "From a card" posts each *approved* version as its own Instagram trial reel with that version's video, thumbnail and caption (P4, held for Sidney's D3). This plan adds the CTA to what is sent only if the caption already carries it; it does not change which versions go. Approved means all three parts approved. Nothing posts automatically and no automated check ever posts.
- **Analytics (later):** the version rows already have `views, watch_time_s, shares, saves, follows`. Per-version results stay a later step and need nothing from this plan.

## 7. Data and live systems

### 7.1 Schema: what exists, what must change

- **Exists:** `trial_reel_cards`, `studio_trial_versions` with thumbnail, caption, change_part (migration `20261102200000`). No browser role can read or write either table; only the `trial-reels` function does.
- **One new migration (step 2), all nullable, so existing rows stay valid:** `cta`; `thumbnail_status`, `caption_status` (card's status words, null meaning "same as the video's overall, today's behaviour"); and for the new per-part approvals either stamps per part or reuse of the three stamps with a part. The exact shape is for step 2's own design review, because it must keep the existing "approved on all three" meaning for old rows. Every revoke names all four roles (anon, authenticated, public, service_role) and reads the grants back, as the earlier migrations do. Rollback is dropping the columns.
- **Migration of trial cards already live:** none needed for the data. With null meaning today's behaviour, every existing version reads exactly as before. As of 2 Nov: 161 versions, 52 switch rows, 34 on, 5 winners, one real client card with the switch on. Re-measure in step 1 and report counts only.
- **The flag `trial_versions_v2` stays test client only** until Sidney clears each step.

### 7.2 Section 4 functions

`production-write`, `deliverable-write` and `batch-write` **do not need to change**: trial-reels writes no calendar row, and the roll-up reaches the card only through today's `calendar-card-write` save. The tests must prove this as a check (no write to a card row except the roll-up), and the PR checklist states "no Section 4 file touched, no fingerprint re-pin". If a step ever does touch one, re-pin with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`, in the same PR. The merge lane holds `trial-reels` until the migration is applied (it carries an `ef-auto-deploy-applied-when` line); Lighthouse applies it and runs the merge lane by hand. Sidney runs nothing.

### 7.3 Write-refusal log

Every new write (version field, version part status) must call the existing refusal reporting (`_writeUiRecordFailure`, board `calendar`) so a refused save, a dropped press and a reload mid-save show up for the watcher. Absence from the log is not proof a save worked, so each new write also gets a read-back test.

## 8. Edge cases (each is a test)

| Case | Behaviour |
|---|---|
| Version with no thumbnail | Shows "No thumbnail yet" with "Use the card's" and "Add one" (Q3). It never shows the card's picture as if it were the version's |
| Drop the version on screen | The card moves to the nearest live tab and says so |
| Two staff edit different versions | Fine: different rows. Same version: last save wins on that field only, and the second sees "Changed by someone else" (the card's existing check) |
| Two staff pick a winner | One wins; the other is refused with a plain message (race test exists) |
| Reload mid-save | The save either lands or the field comes back with the typed words and a Try again (685 pattern) |
| Selected tab after reload | Reopens on the card's own version; a remembered tab is Q9 |
| Client deletes a comment | Section 5 |
| A version answered, then its field changes | Restarts through the SMM (already true for thumbnail and caption); per part, only that part restarts |
| Phone | Tabs scroll; the grid collapses to pips; each field is full width; no sideways page scroll at 390 |
| Month opened on another month, Week | Fixtures use dates relative to today (the standing rule) |

## 9. Questions only Sidney can answer

Each has a recommended default; if he says nothing, the default is what gets built.

1. **Q1. The card's status when it has several versions.** Roll-up, least advanced wins, per part (recommended), or keep today's "card is Approved when all are" for one overall status only?
2. **Q2. Per-part statuses on every version, or only video?** Recommended: all three parts, using the card's words, because that is what he described.
3. **Q3. An empty thumbnail, caption or CTA on B.** Recommended: it falls back to the card's, but the screen says "Using the card's" with a one-click "Give Version B its own". Alternative: B must always have its own (stricter, more typing).
4. **Q4. Approving.** Keep one "Approve Version B" that approves all three parts plus a small per-part approve (recommended), or per-part only?
5. **Q5. A single control for Video, Thumbnail, Caption together?** Recommended: no. Each part has its own pill as on a normal card.
6. **Q6. Swapping A out.** Recommended: only through picking a winner. Alternative: a "Make B the card's version" action any time.
7. **Q7. A dropped version.** Recommended: its tab stays, muted, with Bring back. Alternative: no tab, as today.
8. **Q8. Notes.** Recommended: Notes opens on the selected version, with a "Whole post" filter; confirm that card-wide notes still exist.
9. **Q9. Remember the last tab per card?** Recommended: no, always open on the card's own version.
10. **Q10. The status grid.** Recommended: always visible under the tabs, collapsing to pips on a phone. Alternative: only the pips.
11. **Q11. The old list.** Recommended: it goes in step 5 once the card can do everything it did.
12. **Q12. How many versions?** Recommended: stay at A to G.

## 10. Build order: small PRs, each testable on the test client

Everything stays behind `trial_versions_v2`, on for the test client only. The card "Video 2 — TEST2" is never touched; test cards are throwaway ones for the test client.

| Step | PR | What it is | What Sidney can click after |
|---|---|---|---|
| 0 | **Clickable mockup of the final card** (design only, no wiring) | Every state in sections 3, 4 and 8 on the card, Month/Week and the phone, using placeholder data. Approved before step 1 | Click through the tabs, the grid, drop, winner, empty field, phone |
| 1 | **Measure and write the rules** (docs and a read-only test) | Re-measure counts; write the roll-up rule and the field rules as a table with tests that fail on today's code; check the notes mechanism and that no Section 4 file is touched | Nothing visible; the rule sheet |
| 2 | **Migration and function: CTA and per-part status** | The migration; `trial-reels` writes and reads them; roll-up logic in `logic.mjs` with unit tests; migration held until applied by Lighthouse | Nothing visible yet (flag off to the page) |
| 3 | **Page: tabs edit the selected version** | The card's Video, Thumbnail, Caption and CTA follow the tab and save to it; the old list still present | Type a caption on B, reload, see it on B, A unchanged |
| 4 | **Page: part statuses on the card** | Each part's pill on the selected tab; the tab pips; the status grid; the roll-up reaches the card | Set B's thumbnail to Approved; see the grid without switching |
| 5 | **Page: the old list goes; drop, bring back, winner, add and Import from Frame move to the tab menu** | Includes the CTA in the winner copy and Undo | Run a whole trial: add, drop, bring back, winner, Undo |
| 6 | **Notes per version** | Notes switch follows the card's tab; "Whole post" filter | Write a note on C, see it only under C |
| 7 | **Month, Week and phone** | Pips and popover on Month and Week; phone layout | Look at the Calendar at 390 and 1440 |
| 8 | **Review boards per part** (Q4) | Each part approves by itself; one "Approve Version B" stays | Approve B's caption as the client link, see the grid change |
| 9 | **Posting reads the new rule** | "Approved" for posting means all three parts; nothing posts in a check | Pick the trial card on the Post tab, see only fully approved versions (nothing is posted) |

Each step ships with a browser test at 1440 and 390 that fails on `main` and passes on the branch, the existing trial suites (`trial-version-card-tabs-browser`, `trial-version-fields-browser`, `trial-reels-journey-browser`, `trial-version-review-parts-browser`) kept green, and the identity check before pushing. Rough size: step 0 is a day; steps 2 to 5 are the weight, about a week together; the rest is another week. No fingerprint re-pin is expected at any step.

## 11. Risks

- **A as the card, the others as rows** is the one seam; it is why step 1 writes the rule sheet first and step 2 tests the roll-up hardest.
- **Per-part approval changes what "approved" means** for the review boards and for posting; steps 8 and 9 exist to change those deliberately and never as a side effect.
- **A reload during a save** and **two staff on one version** are covered in section 8, and each has a test.
