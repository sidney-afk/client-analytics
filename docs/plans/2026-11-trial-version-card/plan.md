# One card, many versions: the plan (session Trialplan, 4 Nov 2026)

**Plan only. No code, no migration, no deploy, no data change.** Plain English.
**Status: revision 4, 4 Nov 2026 ~21:45 UTC, final for review.** Includes Sidney's rethink of the trial flow (manual "Start trial", a Trial status on the versions, "Pick the winner" during the trial, the winner gets Posted and becomes the card). **Revision 4 replaces revision 3's section 3.4**: it removes the Posted-to-Approved step back, the Post control before a winner, the 24 h countdown and the automatic start. Open for Sidney: Q-I to Q-L (3.4). Q-G and Q-H are dropped.
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

**The route value, precisely (rule sheet in step 1):** per part, in the order In Progress, Tweaks Needed, For SMM Approval, Kasper Approval, Client Approval, Approved. Tweaks Needed on any live version wins, so a change request is never hidden; otherwise the least-advanced live version sets it; all live versions Approved gives Approved. **Once a winner exists the route value is the winner's statuses alone** (the others are ignored), so the card reads as an ordinary card of the winner. **The writer sets Posted only when a winner is picked, and never overwrites a Scheduled or Posted that came from elsewhere** (3.4).

**Posted and Scheduled are not used by a trial card before its winner (revision 4, 3.4).** A trial card stays at Approved while the trial runs; the trial is a status on the *versions*, not on the card, so no new card status is needed and no Section 4 status map changes. The winner takes **Posted** when it is picked. Version menus stop at Approved; "On trial" is set only by the Start trial button.

**What every reader of a card's status shows for a trial card (full inventory is step 1):**

| Reader | Shows for a trial card |
|---|---|
| Card (staff) | No status pill; the version's part pills; the trial strip with Start trial, Trial running and Pick the winner |
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
| Winner trophy | "Pick the winner" in the trial strip, available while the trial runs (3.4) |
| + Add version and Import from Frame | the `+` at the end of the tabs; Import from Frame inside it |

Until step 5 lands, the list stays and the tabs remain as they are, so nothing breaks half way.

### 3.3 Adding, dropping, bringing back, picking a winner

- **Add:** `+` offers the next free letter, empty, and selects it. An empty version shows "No link yet" and cannot be sent for review (as today).
- **Drop:** tab menu, "Drop Version C". The tab stays visible but muted with "Dropped" and a Bring back button, so it is never a surprise that it vanished. (Today a dropped version has no tab; changing that is Q7.) If the dropped version was the one on screen, the card moves to the nearest live tab and says so in one line.
- **Winner (Sidney, 4 Nov ~21:15): the winner becomes the card.** His words: "once we have a winner, then it would be on that toggle by default... if B is the winner, then it kind of becomes the default of that card... even if he toggles back to another thing, when it refreshes it is back onto that" and "that card behaves as if version B was the part, like all the other cards".
  - **Rule:** one version at a time is "the card's version". It is A until a winner is picked, then the winner. **The card's version keeps its link, thumbnail, caption, call to action and part statuses in the card's own columns; every other version keeps its own in its row.** This is today's rule for A, made general (the function already has `mainLetter` and `on_card` for it).
  - **Picking the winner swaps the two sets of data:** the winner's fields and statuses go onto the card; the old card version's (A's) go into A's row, so nothing is lost. The winner becomes the `on_card` version.
  - **Why a real swap and not "read the winner's fields on screen":** the review showed that Production's sync, the drift check, the client card, `post-source`, Post for Me and the three Section 4 functions read the card's columns **on the server**, where a page helper cannot reach. If the card's columns hold the winner's data, every one of them is already right and none changes (no fingerprint re-pin). This is the mechanism for the Opus review to challenge. The first draft proposed "no copy, the winner only highlighted"; Sidney's answer on the same evening (card behaves as the winner everywhere) made that unworkable.
  - **Clear the winner reverses the swap with the data as it is now.** If B was edited after the pick, those edits go back to B's row, and A's data returns to the card. There is no saved snapshot to go stale, so the old "Undo is refused because the card was edited" case disappears.
  - **The tab:** the winner's tab has a trophy mark, **the card opens on it by default, and a reload returns to it** even after someone looked at another tab. Other tabs stay viewable. Before a winner the card opens on Version A, and no tab is remembered (Q9: no).
  - **`trial-reels` changes (not Section 4, no re-pin):** `winnerPatches` stops refusing with `attach_first` and does the two-way move, now including the call to action and the part statuses; `undoWinnerPatches` becomes the reverse swap; `mainLetter`, `on_card` and `healMainPatch` follow the winner; the page's `svTrialPick` (`189:1486-1530`) keeps writing the card through `calendar-card-write` with its `updated_at` check, and a pick whose card write fails stops and puts everything back (the 657 rule, kept).
- **After a winner, everywhere** (Q-A, Q-B, Q-D answered): views, the client link, posting, Production and Analytics treat the card as an ordinary card of the winner. The client link shows only the winner. Month and Week show one ordinary card, no per-version dots. Posting offers the winner as an ordinary post; the other versions are not offered (Q15). Scheduled and Posted are the winner's (3.4).
- **The 5 winners that exist today** (2 are not A) were copied under the old rule without keeping A's data. Nothing changes for them. "Clear the winner" on those is refused ("picked before versions kept their own data"). Step 1a lists them (counts only).

### 3.4 The trial flow: manual start, a Trial status, pick the winner

**Sidney's rethink (4 Nov ~21:30):** the trial must not start from the upload date or from Posted. A person starts it. Versions on trial show Trial. The SMM picks the winner, who gets Posted and becomes the card. "I'm not an expert in trials, so maybe I'm making a mistake": the plain recommendation below is to build his flow, with three small safeguards.

**The flow:**
1. **Approved.** Each version is approved on its own (Version A, B, C each reach Approved). The card stays Approved.
2. **Posted as trial reels, by a person, on the Post tab** (today's "From a card" with Trial reel on; nothing posts by itself, no automated check ever posts).
3. **Start trial** (one button in the trial strip, SMM and admin): every **approved** version goes to **On trial** at once, in one write. Nothing starts from the upload date, the Posted word or a timer. Versions not yet approved are left out and stay as they are (Q-J).
4. **Trial running** is shown on the strip and on each version's tab (small "Trial" status). **No countdown, no hours.**
5. **Pick the winner** is available the whole time the trial runs. The picked version becomes the card by the swap in 3.3 and takes the status **Posted**; it is the default tab. **The other versions end as "Not chosen"** (today's `lost` status, shown with that word). A version that was dropped stays dropped.
6. **End the trial without a winner** is also offered (today's `no clear winner` status): the card goes back to Version A as its version, still Approved.

**What changes against today (live for every client since 2 Nov, and it stays so until `trial_versions_v2` reaches them):**

| | Today | New (on `trial_versions_v2` clients) |
|---|---|---|
| What starts the trial | Automatic: once the card's video is Posted, any read of the card puts every approved version on trial (`autoTrialPatches`, since OPEN_REPAIRS 570), with `posted_at` from the card's Posted time | A person presses Start trial (the existing manual `trial_start` action, which exists and is already callable by hand). `autoTrialPatches` does not run for these clients |
| The clock | `trial_ends_at` = start + 24 h; "On trial · 17 h left" on the card, and the winner is refused until the 24 h are over (`trial_not_over`) | No clock on screen. The winner can be picked any time during the trial (Q-K). `trial_ends_at` is left empty for new trials; old rows keep theirs |
| The card's status | Posted starts it; the card then reads Posted or Scheduled | The card stays Approved during the trial; Posted comes only when the winner is picked, so **the card never steps back** (revision 3's risk is gone) |
| Losers | "lost", with the 24 h gone | "Not chosen" |
| Client link | The client sees only the winner once picked | Unchanged |

**What Instagram trial reels do, and what that means for this flow.** From what I know of Instagram, **not verified in this session** (step 1a checks Instagram's own documentation): a trial reel is shown mostly to people who do not follow the account, so the team can see how it does with a cold audience before followers see it. This repo posts them with the **manual** setting only (`instagram-upload` accepts `trial_reel_type = manual` and nothing else). Manual means **Instagram never shares it to followers by itself; a person shares it from Instagram when they decide.** So:
- Instagram has **no 24 h end** of its own for a manual trial. The 24 h was this team's own rule, so dropping the timer loses nothing on Instagram's side.
- **Picking the winner in SyncView does not change anything on Instagram.** The winner's Posted records that it is the chosen post. Someone still has to share that reel to followers from Instagram. A pick that says "Posted" while the reel is still trial-only is a trap (risk below). Safeguard 1: the pick's confirm dialog says "Share Version B to followers in Instagram", and Q-L asks whether that step is theirs or SyncView's to do one day (whether Instagram's publishing interface can do it, I do not know).

**Three safeguards (recommended):**
1. The confirm line above, in the pick dialog.
2. **A gentle nudge:** a trial running with no winner shows "Pick a winner" on the SMM's Today page after one day, once, in the app only, no message to Slack or anyone. Default yes, because a trial left running forever is the main way this flow goes wrong (Q-L). The day count is an ordinary setting.
3. **Start trial writes a plain history line** ("Trial started: Versions A, B, C") and Pick the winner another ("Winner: Version B, chosen by <staff>"), in the card's history, so what happened and when can be read later.

**Risks of this flow:**
- **Two ways to start for a while:** clients on the switch start by button, other clients start automatically as today. The function must branch on `trial_versions_v2` and a test must cover both.
- **A card can still become Posted another way** (a Production work item set to Posted flows to the card through the status sync, or SyncLinear). For a v2 trial card, Posted that arrives this way must not start or end a trial and must not hide the versions. Step 1a lists every way a card can become Posted; the rule is that such a Posted is ignored for the trial and shown as a warning on the strip.
- **"Posted" on the winner when nobody has shared it on Instagram** (above).
- **Every reader of the 24 h** (the card's countdown, the Production line, the nightreel check, `trial_not_over` in the function and its tests, the journey tests) must stop expecting it. Step 5 owns this; the existing trial suites are updated in the same PR.
- **An early pick** (hours in) is allowed; the dialog shows when the trial started, nothing else (Q-K).

**Questions for Sidney (defaults given; Q-G and Q-H are dropped, they no longer apply):**
- **Q-I.** Is the card staying **Approved** while the trial runs (not Scheduled or Posted) right? Default: yes.
- **Q-J.** A version approved *after* Start trial: it waits and does not join; the SMM can press Start trial again for the late ones. Default: yes.
- **Q-K.** The winner can be picked at any time during the trial, with a one-line confirm. Default: yes.
- **Q-L.** The in-app nudge after one day, and the reminder to share the winner from Instagram: yes? And who shares it to followers, the SMM in Instagram (default) or should SyncView one day do it?

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

**Questions this raised. Sidney answered Q13 to Q17 on 4 Nov (~20:05 UTC): Q13 yes; Q14 no button ("no, no better"), so there is no "Keep Version C as the card"; Q15 yes; Q16 yes; Q17 yes, five versions, A to E.** Questions A to F (section 12) are still open with him; each has a default that is built if he says nothing.

13. **Q13. Production's parent issue for a trial card.** It follows the hidden route value. Recommended: show "Trial · N versions" with the version dots on the parent.
14. **Q14. Ending a trial with a winner that is not A.** Answered: no extra button. The winner already becomes the card (3.3); switching the trial off is refused until the winner is cleared.
15. **Q15. After a winner, can the other versions still be posted?** Recommended: no; only the winner is offered, as an ordinary post.
16. **Q16. Calendar filters and counts.** Recommended: a trial card matches a status filter if any live version has it, and counts are by version.
17. **Q17. The cap of five.** Confirm "A to E" is what "ABCDF" meant. The three existing F and G rows are all dropped, so nothing is lost either way.

## 10. Build order: small PRs, each testable on the test client

Everything stays behind `trial_versions_v2`, on for the test client only. The card "Video 2 — TEST2" is never touched; test cards are throwaway ones for the test client, and the drift check is run only on an unlinked throwaway card. **Reordered after the review:** the queues move onto version rows *first*, and nothing visible ships until that is proven, so every step can be tested alone.

| Step | PR | What it is | What Sidney can click after |
|---|---|---|---|
| 0 | **Clickable mockup of the final card** (design only, no wiring) | Every state in sections 3, 4 and 8, on the card, Month, Week, the client link and the phone, **including every dead end**: no link yet, refused save, dropped version on screen, winner, trial off with a winner, a version the client cannot see, offline, empty fields, Start trial, Trial running, Pick the winner and its confirm line, End trial without a winner, the nudge. Approved before step 1 | Click through all of it |
| 1a | **Measure and write the rules** (docs and read-only tests) | Inventory every reader of a card's status and of its `asset_url`, thumbnail, caption and CTA (list in 2.2 and 3.3 is a start); the route-value rule sheet; the notes check; the list of the 5 existing winners (counts only); a test that fails if a version row ever gets a work item | The rule sheet |
| 1b | **Queues read version rows** (code, no new look) | SMM tab, Kasper, client link, Today and `trial-reels` reads decide "waits on me" from versions for a trial card. Fixes "A approved, B waiting, B vanishes". Test: A Approved and B at the SMM, B is in the SMM tab; at Kasper, at the client | Nothing new on screen; the queues are right in the odd cases |
| 2 | **Migration and function** | CTA and thumbnail and caption status columns on the version rows; `trial-reels` reads and writes them; the cap moves to A to E for **adding** (in `logic.mjs:7`, `higgsfield-mcp/trialreels.mjs:45`, and the `189`/`194` regexes); the route writer and `effectiveCardFields` as tested functions. Migration held until Lighthouse applies it; no `calendar_posts` column | Nothing visible (flag off to the page) |
| 3 | **Tabs edit the selected version** | The card's Video, Thumbnail, Caption and CTA follow the tab and save to it; the old list still present | Type a caption on B, reload, see it on B, A unchanged |
| 4 | **Part statuses, pips, status grid, Start trial** | Each part's pill on the selected tab; the route writer runs; **Start trial** in the trial strip (the existing manual `trial_start`, `autoTrialPatches` off for these clients); "Trial" on versions without a countdown; version menus stop at Approved; the card shows no status pill | Set B's thumbnail to Approved; see the grid without switching; approve three versions, press Start trial and see all three go to Trial at once (test client, nothing posts) |
| 5 | **The old list goes; Pick the winner; the winner becomes the card** | Drop, bring back, add, Import from Frame move to the tab menu; **Pick the winner** during the trial (no `trial_not_over`); the others end as Not chosen; `trial-reels`: `winnerPatches` does the two-way swap (fields, call to action, part statuses) in place of `attach_first`, and sets the winner Posted; undo becomes the reverse swap; `mainLetter`/`on_card`/`healMainPatch` follow the winner; the card opens on the winner and a reload returns to it; End trial without a winner; the 24 h readers and their tests retired; **first, step 1a's list of every way a card can become Posted is settled** | Run a whole trial: add, approve, Start trial, pick a winner, see the card become it and read Posted, clear the winner and see A back |
| 6 | **Notes per version** | Notes switch follows the tab; unprefixed notes are Whole post | Write a note on C, see it only under C |
| 7 | **Month, Week and phone** | Dots with a trophy; popover; phone layout | Look at the Calendar at 390 and 1440 |
| 8 | **Review boards per part** (Q4) | Each part approves by itself; one "Approve Version B" stays | Approve B's caption as the client link, see the grid change |
| 9 | **Posting reads the new rule + the nudge** | "Approved" means all three parts; the Post tab posts the approved versions as trial reels (a person, nothing automatic); after a winner the winner is an ordinary post and the other versions are not offered; the in-app "Pick a winner" nudge (Q-L); nothing posts in a check | Pick the trial card on the Post tab (nothing is posted); leave a trial running a day and see the nudge |

Each step ships with a browser test at 1440 and 390 that fails on `main` and passes on the branch, the existing trial suites kept green (`trial-version-card-tabs-browser`, `trial-version-fields-browser`, `trial-reels-journey-browser`, `trial-version-review-parts-browser`), the identity check before pushing, and the refusal-log call plus a read-back on every new write. Rough size: step 0 a day; 1a and 1b two or three; 2 to 5 about a week and a half together; the rest another week. A fingerprint re-pin is not expected at any step; if a step touches a Section 4 function, re-pin in the same PR.

### Process before any build (Sidney, 4 Nov)

1. Sidney approves this plan (after Q-I to Q-L are answered).
2. **A strong model reviews the plan once more**, after his approval.
3. **Only when the plan is final are the mockups made** (step 0). No mockup and no build starts before that.

## 11. Risks

- **The route value is a second copy of "where the card is".** It exists so Production, the drift check and old readers keep working; step 1a lists every reader, step 1b moves the queues off it, and the writer is one function with tests. A missed reader is the main risk.
- **Posted comes only with the winner now** (3.4); a Posted that arrives another way (Production sync, SyncLinear) is ignored for the trial and warned about. Step 1a lists every way in.
- **The winner swap** changes `trial-reels` (not Section 4) and writes the card through the page; a failed card write stops the pick and puts everything back. Its upside: every server reader already reads the card's columns, so none changes.
- **The trial flow change (3.4)** retires the automatic start and the 24 h clock for v2 clients; both ways coexist for a while, and every reader of the 24 h must be updated with its tests.
- **Winner Posted before it is shared on Instagram** (3.4): the confirm line and the nudge are the safeguards; whether SyncView can ever share it is unknown.
- **The 5 existing winners** (2 not A) keep their old copy; Clear-the-winner is refused on them.
- **Per-part approval changes what "approved" means** for the review boards and posting; steps 8 and 9 change those on purpose, not as a side effect.
- **A reload during a save** and **two staff on one version** are section 8 cases, each with a test.

## 12. Adversarial review round 1 (session Trialreview, 4 Nov) and what changed

| # | Finding | What the plan does now |
|---|---|---|
| 1 HIGH | The card's video status is the routing key for every queue and for `trial-reels` | "No status of its own" is a visual rule; a hidden system-written route value stays; queues move onto version rows first (step 1b). 2.2 |
| 2 HIGH | Posted and Scheduled live in A's video status and start every version's 24 h trial | Revision 4: no automatic start; Start trial is a button; the card stays Approved during the trial; Posted comes with the winner (3.4). Version menus stop at Approved |
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
- **Q-A. Where do Posted and Scheduled live?** **Answered, then reworked (~21:30):** after a winner they are the winner's, on the winner's tab, which is the default. Before a winner a trial card shows neither: see 3.4 and Q-I to Q-L.
- **Q-B. Does the winner show on Month and Week and get posted?** **Answered (~21:15):** yes, the card behaves as the winner everywhere. Built as the swap in 3.3.
- **Q-C. Notes with no version prefix?** **Answered:** they sit under Whole post.
- **Q-D. A card with A approved and B waiting on the client: does it stay in the client's queue?** **Answered:** yes, any version waiting for approval shows on that board.
- **Q-E. Approving.** **Answered:** one "Approve Version B" approves all three parts, and each part can also be approved alone.
- **Q-F. The cap.** **Answered:** A to E; existing F and G rows stay readable (all three are dropped) and are not shown as tabs.
