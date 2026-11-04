# One card, many versions: the plan (session Trialplan, 4 Nov 2026)

**Plan only. No code, no migration, no deploy, no data change.** Plain English.
**Status: revision 2, 4 Nov 2026 ~20:00 UTC: Sidney's answers (section 9) and the adversarial review's findings (section 12) are both in. Questions A to D (section 12) are with Sidney; each has a default that is built if he says nothing.** Where an answer changed the plan, the text below is already rewritten; section 9 lists each answer and where it landed.
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
- **Queues stop depending on the route value** (build step 1, before any visible change): for a trial card the SMM tab, Kasper's queue, the client link, Today and `trial-reels`' own reads decide "does this wait on me" from the **version rows**, not from the card's status. The review boards already do this per version (688 part 1); the remaining readers (`195:1640-1660`, `190:2435, 2620, 1112`, the Today page `097:359-392`, `trial-reels index.ts:160, 250, 543, 638, 643, 676`) get the same treatment. This fixes the case "A is Approved while B waits on the SMM, and B vanishes from the SMM tab". After it, the route value is only for Production, the drift check, filters and old readers.

**Turning a trial on converts the card's data into Version A:**
- **Fields stay put.** A's link, thumbnail, caption and call to action stay in the card's own columns; the page reads them as Version A's. Nothing is copied.
- **A's three part statuses move to A's version row** (a one-time, reversible copy at switch-on): A's row already has a video status today, and gets the same two new thumbnail and caption columns as B to E. They start from the card's `video_status`, `graphic_status` and `caption_status`. Then **every version, A to E, keeps its statuses in a row, the same way**; no special case in the part pills or the status grid. Switching the trial off copies A's three back to the card.
- **Notes** are not rewritten (section 5).
- **No new `calendar_posts` columns.** A's call to action is the card's existing `cta`; A's part statuses are in its row. This matters because `calendar-upsert`'s allow-list is frozen (review, low 12).

**The route value, precisely (rule sheet in step 1):** per part, in the order In Progress, Tweaks Needed, For SMM Approval, Kasper Approval, Client Approval, Approved. Tweaks Needed on any live version wins, so a change request is never hidden; otherwise the least-advanced live version sets it; all live versions Approved gives Approved. **The writer never overwrites Scheduled or Posted.**

**Posted and Scheduled are the post's, not a version's.** They live today in the card's video status and Posted starts every approved version's 24 h trial (`logic.mjs autoTrialPatches`, `189:474, 496, 639`). So they become a **separate control in the trial strip**: "Post: Not scheduled / Scheduled / Posted", with the card's own rules. It still writes the card's status column (so the 24 h start, the status sync and the posting code keep working unchanged). **Version menus stop at Approved** (they already omit Scheduled and Posted, V1 of 656). This placement is Q-A, with this as the default.

**What every reader of a card's status shows for a trial card (full inventory is step 1):**

| Reader | Shows for a trial card |
|---|---|
| Card (staff) | No status pill; the version's part pills; the trial strip with the Post control |
| Month and Week | One dot per live version, its least-advanced part, a trophy on the winner. No card-level dot |
| SMM Review tab, Kasper, client link, Today | Decided from the version rows (step 1). A card stays in a reviewer's queue while any live version waits on them, whatever the other versions say. The client's queue lists per version; the card stays while any version waits at the client (Q-D) |
| Production (parent issue, work items) | Follow the route value, as today. B to E have **no work items**, only one "Deliverable file" row each; **this must stay true** (the drift check is safe only because of it; step 1 adds a test that fails if a version row ever gets a work item). The parent shows "Trial · N versions" with dots (Q13) |
| Calendar status filters and counts | A trial card matches a status filter if **any** live version has it; counts are by version (Q16) |
| Drift check (card against work items) | Unchanged. Verified on a throwaway, unlinked test card, never on a card linked to Production work items (standing rule) |
| Post tab "From a card" | Lists a trial card's versions by their own approvals |
| Analytics | Per-version rows already exist; unchanged |

**When the trial ends or is switched off:**
- *Before a winner:* switching off hides B to E, copies A's statuses back to the card, and shows A as the plain card. Nothing is deleted ("3 other versions are kept, hidden"); switching on again restores them.
- *After a winner (Sidney: "no replacement, just the winner gets highlighted in the toggle"):* **nothing is swapped or copied.** See 3.3. Switching the trial off while a winner exists is **refused** ("Version C is the winner. Clear the winner first").

**Why not make each version its own hidden card?** Considered and rejected. It would put every version through the status sync, the drift robot, Production work items and Month and Week, and it touches the three Section 4 functions. The current design (one card, version rows beside it) keeps all of that untouched.

**How many versions: up to five, A to E (Sidney, 4 Nov).** *Assumption to confirm:* he wrote "ABCDF"; this plan reads it as five versions, A to E. The function today allows A to G. Existing rows, counted live on 4 Nov (counts only): A 60, B 59, C 46, D 14, E 8, **F 2, G 1**, and **all three F and G rows are already dropped** (none live). So a cap of five **hides nothing anyone uses**: the three dropped rows stay in the table and in history, are not shown as tabs, and can still be read by the function. The cap applies to adding, so "+" stops at E. The cap is enforced in more places than the function: `trial-reels logic.mjs:7`, the AI editor's writer `higgsfield-mcp/trialreels.mjs:45`, and the version-name regexes in `189` and `194`. Step 2 moves **adding** to A to E in every one of them; the table's own check (`letter ~ '^[A-G]$'`) is left alone, so no migration is needed for the cap and old F and G rows stay valid. Worst case if the assumption is wrong: a cap of seven is a one-line change.

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
- **A winner with no copy needs `trial-reels` changes** (review finding 3; it is not a Section 4 function, so no re-pin). Today the winner is picked only after its link is on the card and the page copies link, thumbnail and caption over (`winnerPatches` refuses with `attach_first` unless the card's link equals the winner's; `undoWinnerPatches` puts it back; `mainLetter`, `on_card` and `healMainPatch` assume the card holds the main version; `svTrialPick`, `189:1486-1530`, does the copy). Step 5 removes the `attach_first` rule and the copy and its undo, keeps A as the `on_card` version, and re-tests `healMainPatch`.
- **One helper, `effectiveCardFields(post, shape)`,** answers "which version's link, thumbnail, caption and call to action does this card show?": the winner's if there is one, else Version A's (the card's own columns). **Every reader of the card's `asset_url`, `thumbnail_url`, `caption` and `cta` goes through it** (an inventory, step 1; known so far): the card and its previews, Month and Week (`180`), lists, the client link and the client card (`frameio-view/client-card.mjs:103-111`), the Post tab (`299`) and `post-source` (`index.ts:90`, which copies the card's video and thumbnail for posting), Production's file row (`245`) and the Notes player. A reader that bypasses the helper is a bug, and a test greps for direct reads.
- **After a winner is picked:**
  - *Previews and lists:* the winner's fields (via the helper). The card's own columns still hold Version A's.
  - *Posting:* "From a card" offers the winner's video, thumbnail, caption and call to action as an ordinary post (D3: nothing goes anywhere automatically). Other versions are not offered once a winner exists (Q15). This is Q-B, with this as the default.
  - *The client link:* shows only the winner, with the winner's own fields.
  - *Production, Analytics:* unchanged (a file row per version; the winner flagged).
- **The 5 winners that exist today** (2 are not A, from the review) had their data copied onto the card under the old rule. Nothing is reverted. For those cards Version A's original link was the card's and is already replaced, so step 1 lists them (counts only) and the rule is: leave as is, the helper reads the winner's row, and "Clear the winner" on them is refused with "this winner was picked before versions kept their own data".

## 4. Seeing every version's status without switching

Four layers, from quietest to most detail. Recommended: build the first three, offer the fourth later.

1. **On each tab: three small pips** after the letter (Video, Thumbnail, Caption), each in its status colour, with the words in the tab's accessible name and tooltip. Today it is one dot.
2. **A status grid under the tabs, always visible, three rows by three columns:** rows A, B, C; columns Video, Thumbnail, Caption; each cell a coloured dot with a one-word state on hover. Clicking a cell selects that version. It is small (about 3 lines tall) and collapses to a single line of pips on the phone. This answers "know their statuses by just looking".
3. **Month and Week:** today's one dot per live version stays, showing that version's least-advanced part, with a trophy on the winner's dot. There is no card-level dot. Hover or focus opens the grid in a small popover.
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
- **Posting (Post for Me):** after a winner, see section 3.3. Before one, today "From a card" posts each *approved* version as its own Instagram trial reel with that version's video, thumbnail and caption (P4, held for Sidney's D3). This plan adds the CTA to what is sent only if the caption already carries it; it does not change which versions go. Approved means all three parts approved. Nothing posts automatically and no automated check ever posts.
- **Analytics (later):** the version rows already have `views, watch_time_s, shares, saves, follows`. Per-version results stay a later step and need nothing from this plan.

## 7. Data and live systems

### 7.1 Schema: what exists, what must change

- **Exists:** `trial_reel_cards`, `studio_trial_versions` with thumbnail, caption, change_part (migration `20261102200000`). No browser role can read or write either table; only the `trial-reels` function does.
- **One new migration (step 2), all nullable, so existing rows stay valid:** `cta`; `thumbnail_status`, `caption_status` (the card's status words). **Null means "follows the version's one existing status"**, today's 688 behaviour where one status covers all three parts; the first per-part write on a version fills in all three explicitly, so a version is never half old and half new; and for the new per-part approvals either stamps per part or reuse of the three stamps with a part. The exact shape is for step 2's own design review, because it must keep the existing "approved on all three" meaning for old rows. Every revoke names all four roles (anon, authenticated, public, service_role) and reads the grants back, as the earlier migrations do. Rollback is dropping the columns.
- **Migration of trial cards already live:** none needed for the data. Fields already sit on the card, A's statuses are copied into A's row at switch-on, and null in the new columns means today's behaviour, so every existing version reads exactly as before. Counts read on 4 Nov (counts only, one read-only query): **63 switch rows, 38 on, 5 winners; 189 version rows** (A 60, B 59, C 46, D 14, E 8, F 2, G 1), of which F and G are all dropped. The existing 5 winners keep their pick. **Behaviour change for them:** before, a winner's data had been copied onto the card by the page; from step 5 the card keeps whatever it holds and the highlight is the pick (nothing is un-copied, and nothing already copied is reverted).
- **Counts to use in step 1 are the enabled ones** (review, low 11): per the review, 38 trial cards are on, 33 of them on the test client and 5 real; 7 enabled version rows on real clients, none with its own thumbnail or caption; no trial card has a call to action; no duplicate letter rows. **The flag `trial_versions_v2` stays test client only** until Sidney clears each step.

### 7.2 Section 4 functions

`production-write`, `deliverable-write` and `batch-write` **do not need to change**: trial-reels writes no calendar row. The review confirmed none of the three references the trial tables. The route value is written by the page through today's `calendar-card-write` save, as the "Approved once all are" move is today. **If a step ever adds a column to `calendar_posts`, `calendar-upsert`'s frozen allow-list is touched; this plan avoids that on purpose** (A's part statuses live in A's version row). The tests must prove this as a check (no write to a card row except the roll-up), and the PR checklist states "no Section 4 file touched, no fingerprint re-pin". If a step ever does touch one, re-pin with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`, in the same PR. The merge lane holds `trial-reels` until the migration is applied (it carries an `ef-auto-deploy-applied-when` line); Lighthouse applies it and runs the merge lane by hand. Sidney runs nothing.

### 7.3 Write-refusal log

Every new write (version field, version part status, the route writer, the Post control) calls the existing refusal reporting (`_writeUiRecordFailure`, board `calendar`) and gets a read-back test, because absence from the log is not proof a save worked.

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
| Q6 | "No replacement, just winner gets highlighted in the toggle." **No swap, no copy** | 3.3 (rewritten), 2.2; step 5 simplified |
| Q7 | Yes: a dropped version keeps a muted tab with Bring back | 3.3 |
| Q8 | Yes: Notes open on the selected version, with a "Whole post" filter | 5 |
| Q9 | No: do not remember the last tab | 8 |
| Q10 | Yes: the status grid is always visible | 4 |
| Q11 | Yes: the old list goes in step 5 | 3.2 |
| Q12 | "Up to 5 versions, A to E" (he wrote "ABCDF"; read as five). **Assumption, flagged** | 2.2 |

**Questions this raised. Sidney answered Q13 to Q17 on 4 Nov (~20:05 UTC): Q13 yes; Q14 no button ("no, no better"), so there is no "Keep Version C as the card"; Q15 yes; Q16 yes; Q17 yes, five versions, A to E.** Questions A to F (section 12) are still open with him; each has a default that is built if he says nothing.

13. **Q13. Production's parent issue for a trial card.** It follows the hidden route value. Recommended: show "Trial · N versions" with the version dots on the parent.
14. **Q14. Ending a trial with a winner that is not A.** Recommended: no copy, the highlight is the pick; trial switch-off is refused until the winner is cleared. Alternative: an explicit "Keep Version C as the card" button.
15. **Q15. After a winner, can the other versions still be posted?** Recommended: no; only the winner is offered, as an ordinary post.
16. **Q16. Calendar filters and counts.** Recommended: a trial card matches a status filter if any live version has it, and counts are by version.
17. **Q17. The cap of five.** Confirm "A to E" is what "ABCDF" meant. The three existing F and G rows are all dropped, so nothing is lost either way.

## 10. Build order: small PRs, each testable on the test client

Everything stays behind `trial_versions_v2`, on for the test client only. The card "Video 2 — TEST2" is never touched; test cards are throwaway ones for the test client, and the drift check is run only on an unlinked throwaway card. **Reordered after the review:** the queues move onto version rows *first*, and nothing visible ships until that is proven, so every step can be tested alone.

| Step | PR | What it is | What Sidney can click after |
|---|---|---|---|
| 0 | **Clickable mockup of the final card** (design only, no wiring) | Every state in sections 3, 4 and 8, on the card, Month, Week, the client link and the phone, **including every dead end**: no link yet, refused save, dropped version on screen, winner, trial off with a winner, a version the client cannot see, offline, empty fields, the Post control. Approved before step 1 | Click through all of it |
| 1a | **Measure and write the rules** (docs and read-only tests) | Inventory every reader of a card's status and of its `asset_url`, thumbnail, caption and CTA (list in 2.2 and 3.3 is a start); the route-value rule sheet; the notes check; the list of the 5 existing winners (counts only); a test that fails if a version row ever gets a work item | The rule sheet |
| 1b | **Queues read version rows** (code, no new look) | SMM tab, Kasper, client link, Today and `trial-reels` reads decide "waits on me" from versions for a trial card. Fixes "A approved, B waiting, B vanishes". Test: A Approved and B at the SMM, B is in the SMM tab; at Kasper, at the client | Nothing new on screen; the queues are right in the odd cases |
| 2 | **Migration and function** | CTA and thumbnail and caption status columns on the version rows; `trial-reels` reads and writes them; the cap moves to A to E for **adding** (in `logic.mjs:7`, `higgsfield-mcp/trialreels.mjs:45`, and the `189`/`194` regexes); the route writer and `effectiveCardFields` as tested functions. Migration held until Lighthouse applies it; no `calendar_posts` column | Nothing visible (flag off to the page) |
| 3 | **Tabs edit the selected version** | The card's Video, Thumbnail, Caption and CTA follow the tab and save to it; the old list still present | Type a caption on B, reload, see it on B, A unchanged |
| 4 | **Part statuses, pips, status grid and the Post control** | Each part's pill on the selected tab; the route writer runs; the Post control in the trial strip; version menus stop at Approved; the card shows no status pill | Set B's thumbnail to Approved; see the grid without switching; schedule the post and see every approved version's 24 h trial start (test client, nothing posts) |
| 5 | **The old list goes; winner as highlight** | Drop, bring back, add, Import from Frame, winner move to the tab menu; `trial-reels`: remove `attach_first`, the copy and its undo, re-test `healMainPatch`; every reader through `effectiveCardFields` | Run a whole trial: add, drop, bring back, pick and clear a winner; previews follow the winner |
| 6 | **Notes per version** | Notes switch follows the tab; unprefixed notes are Whole post | Write a note on C, see it only under C |
| 7 | **Month, Week and phone** | Dots with a trophy; popover; phone layout | Look at the Calendar at 390 and 1440 |
| 8 | **Review boards per part** (Q4) | Each part approves by itself; one "Approve Version B" stays | Approve B's caption as the client link, see the grid change |
| 9 | **Posting reads the new rule** | "Approved" means all three parts; after a winner only the winner is offered; `post-source` reads through the helper; nothing posts in a check | Pick the trial card on the Post tab (nothing is posted) |

Each step ships with a browser test at 1440 and 390 that fails on `main` and passes on the branch, the existing trial suites kept green (`trial-version-card-tabs-browser`, `trial-version-fields-browser`, `trial-reels-journey-browser`, `trial-version-review-parts-browser`), the identity check before pushing, and the refusal-log call plus a read-back on every new write. Rough size: step 0 a day; 1a and 1b two or three; 2 to 5 about a week and a half together; the rest another week. A fingerprint re-pin is not expected at any step; if a step touches a Section 4 function, re-pin in the same PR.

### Process before any build (Sidney, 4 Nov)

1. Sidney approves this plan (after Q-A to Q-F are answered).
2. **A strong model reviews the plan once more**, after his approval.
3. **Only when the plan is final are the mockups made** (step 0). No mockup and no build starts before that.

## 11. Risks

- **The route value is a second copy of "where the card is".** It exists so Production, the drift check and old readers keep working; step 1a lists every reader, step 1b moves the queues off it, and the writer is one function with tests. A missed reader is the main risk.
- **Posted and Scheduled still live in the card's status column**, shown as the Post control. The writer must never overwrite them; that is a test.
- **Winner without a copy** changes `trial-reels` (not Section 4) and touches every reader of the card's picture; mitigated by one helper and a test that greps for direct reads.
- **The 5 existing winners** (2 not A) keep their old copy; Clear-the-winner is refused on them.
- **Per-part approval changes what "approved" means** for the review boards and posting; steps 8 and 9 change those on purpose, not as a side effect.
- **A reload during a save** and **two staff on one version** are section 8 cases, each with a test.

## 12. Adversarial review round 1 (session Trialreview, 4 Nov) and what changed

| # | Finding | What the plan does now |
|---|---|---|
| 1 HIGH | The card's video status is the routing key for every queue and for `trial-reels` | "No status of its own" is a visual rule; a hidden system-written route value stays; queues move onto version rows first (step 1b). 2.2 |
| 2 HIGH | Posted and Scheduled live in A's video status and start every version's 24 h trial | A separate Post control in the trial strip; version menus stop at Approved; the writer never overwrites Posted or Scheduled. 2.2, step 4. **Q-A** |
| 3 HIGH | A winner with no copy needs `trial-reels` changes and every reader of the card's picture routed through one helper | Listed in 3.3 and step 5 (`attach_first`, undo, `mainLetter`/`on_card`/`healMainPatch`, `svTrialPick`); the helper `effectiveCardFields`, including the client card and `post-source`. **Q-B** |
| 4 HIGH | 2.2 said "nothing is copied" and 3.3 said previews read the winner | Reworded: fields are never copied; A's part statuses are copied once at switch-on; previews read the winner through the helper |
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
- **Q-A. Where do Posted and Scheduled live?** Default: a Post control in the trial strip, separate from the version pills.
- **Q-B. Does the winner show on Month and Week and get posted?** Default: yes, through the helper, as an ordinary post.
- **Q-C. Notes with no version prefix?** Default: Whole post, not Version A's.
- **Q-D. A card with A approved and B waiting on the client: does it stay in the client's queue?** Default: yes, listed per version, for as long as any version waits at the client.
- **Q-E. Approving.** Confirm that "Approve Version B" approves all three parts, and that each part can also be approved alone. Default: yes, as in section 6 and step 8.
- **Q-F. The cap.** Confirm it is A to E (he wrote "ABCDF"). Existing F and G rows stay readable (all three are dropped) and are simply not shown as tabs. Default: A to E. Same as Q17.
