# Review round 7 of the trial-version card plan (session Trialreview7, 6 Nov 2026)

**Read:** `docs/plans/2026-11-trial-version-card/plan.md`, revision 17 with the 6 Nov decisions (PR #2608, head `ab232a6`), end to end. I checked it against the code on that branch:
- `supabase/functions/trial-reels` (`logic.mjs`, `index.ts`), `higgsfield-mcp/trialreels.mjs` and its writer in `higgsfield-mcp/index.ts`, `post-source/handler.mjs`;
- the fragments `188`, `189`, `194` and `195` (the drop paths, Kasper's tiles, the client link), plus the citations of earlier rounds that the round-6 fixes lean on;
- the migrations: `migrations/2026-10-10-calendar-auto-posted.sql` (`calendar_auto_posted_due`) and the four trial migrations.

**Not read:** the live database (no live reads or writes were made).

**Verdict in one line:** the round-6 fixes landed and are consistent in the places round 6 named, but **two of Sidney's 6 Nov decisions (Q-T and Q-S) were written onto mechanisms that do something else** (Drop reuses a marker that switches the trial off; switching a Posted card back on relies on an automatic start the plan turned off), `card_letter` is filled at the wrong moment for cards the old Drop already moved, and **SyncMate can still put a version "on trial" directly**, around every gate. 4 HIGH, 5 MEDIUM, 9 LOW. All are text fixes; one adds a `direction = drop` value and a one-time "settle" step, nothing else new.

## Round-6 fixes: did they land?

| Round 6 | Landed? | Note |
|---|---|---|
| H1 `card_letter` carried through | **Mostly.** 2.2, 3.3, 16.7, 21.1, 24.1 and step 3 say "the card's version" | Seven sentences still mean "A = the card" (M4). The fill rule is right in spirit but wrong in timing (H2) |
| H2 swap record after a switch-off | Yes (16.3, 23.1 step 2) | Q-T then reuses `direction = off` for Drop (H1) |
| H3 Drop on the card's version | **Partly.** The 194 path is named and Q-T decides it | The card's old list has the same bare link move (`189:1429-1446`) and is not named (H1) |
| H4 work item carries the route value only | Yes (2.2, 3.5, 3.6, 21.4, 24.4) | `route_written` is written in a separate request from the push, has one value for two work items, and 16.6's "healed" contradicts "never pushed back" (M1). The editor's natural move now delivers nothing (M2) |
| H5 board writes | Yes (24.1 to 24.3, 2.2) | 24.1 now lists a Drop the client never has (L1) |
| M1 switch-off order | Yes (16.6, 23.1) | |
| M2 switch back on | Decided as Q-S, but see H3 | |
| M3 Scheduled switch-off offers approved only | Yes (23.1) | Not applied to the Q-T Drop, which is the same move (H1) |
| M4 swap lock | Yes (16.3) | Writes made inside reads are not covered (M5) |
| M5, M6, M7, M8, M10, M11, M12, M13 | Yes | |
| M9 effective-fields readers in step 3 | Yes | Step 3's change is not scoped to `rules = 'v2'` (H2) |
| L1 to L15 | Yes | |

---

## HIGH

### H1. Q-T's Drop is written onto the switch-off marker, which switches the trial off
2.2 (Q-T) says Drop on the card's version is "a proper swap using the switch-off marker (23.1, `direction = off`)".
- 23.1 step 2 defines `direction = off` as: marker, outgoing fields, link, thumbnail, caption and call to action, card columns, **then `switch_set` off with `card_letter = B`**, then `done`.
- 16.3: "Clear works only on a `done` record whose direction is `pick`", and the history line for `off` is "Trial switched off".
- A build that follows the text literally switches the whole trial off when Kasper drops Version A. One that does not has no written step list for Drop at all.

Three more gaps in the same rule:
- **Which version becomes the card is not said.** The confirm hard-codes "Version B". The code's choice today is the first other live version **with a link** (`_trvNextLive`, `194:781`; `_trlNextLive`, `189:1430`), which can be a version the client passed on, or one that is not approved.
- **The Scheduled rule of 23.1 (round 6 M3) is not applied.** Drop on a Scheduled card with two versions leaves one counted version, so the robot skip no longer holds (3.4 clause: open trial and at least two counted). That night the robot posts the card as Version B even if B's caption is unapproved. It is the same hole M3 closed for switch-off.
- **There are two bare link moves, not one.** The card's old list does the same thing (`189:1429-1446`: `_trlSetCardLink`, then `version_drop`). The old list stays for v1 cards (21.6) and for v2 cards until step 5. Neither 2.2 nor step 1a names it. Also unsaid: whether v1 cards keep today's bare move. 16.6 says the page branches on the card's `rules`, so they should.

**Fix (text).**
1. In 2.2 Q-T, replace "using the switch-off marker (23.1, `direction = off`)" with: "a swap with its own direction, `direction = drop`: the marker (with `before`), the current card version's four fields into its own row (explicit only where `placed` shows they were its own), the link, the thumbnail, the caption and call to action of the new card version, the card's columns through the route writer, then `version_drop` of the old version with `card_letter` set to the new one in the same `trial-reels` call, then `state = done`. No `switch_set` and no Posted write. Clear does not apply to it."
2. Add: "The new card version is the first other live version, in letter order, that has a link and is counted. **On a Scheduled card it must also have all three parts approved** (as 23.1); if none does, Drop is refused: 'Version B is not approved yet: approve it first, or end the trial.' The confirm names the version chosen."
3. Name `189:1429-1446` beside `194:789-814` in 2.2 and step 1a. Say "v1 cards keep today's move; on v2 cards both buttons call the new swap."
4. Add `drop` to the `direction` list in 16.3, and the history line "Version A dropped: Version B is now the card" to 23.1's list.
5. Tests: drop A on a two-version Scheduled card whose B is unapproved is refused; drop A with B approved makes B the card, the trial stays switched on, and Bring back A restores A's fields from its row.

### H2. `card_letter` is filled too early, and on cards the old Drop already moved, the card's columns do not belong to the version it names
7.1 and step 1a-bis fill `card_letter` from today's `mainLetter` **when the migration runs**. Three problems:
1. **It goes stale before anything reads it.** Both bare link moves (H1) stay live for every client until step 5. Each one moves `mainLetter` (the "carried" rule, `logic.mjs:240-242`) and never writes `card_letter`. Step 3 is the first reader ("A's value from the card while `card_letter` = A, from A's row otherwise"), weeks later. A Drop in between leaves `card_letter` pointing at a dropped version.
2. **On a card the old Drop moved, the card holds a mix.**
   - `_trlSetCardLink` writes **only the link** (`189:925-933`; through `production-write` `attachment` when there is a sub-issue).
   - So after "drop A" the card carries B's link, but **A's thumbnail, caption and call to action**. A's row has none of them, because the card's version never keeps its fields in its row (`logic.mjs:719-724`).
   - Any thumbnail or caption B has of its own sits in B's row, and today B shows it (`effectiveFields(v, card)` puts the row first, `logic.mjs:725-729`).
   - Under the plan's rule ("the card's version keeps its four fields in the card's columns", 3.3) with `card_letter` = B: B's tab shows A's caption as B's own, B's own caption is ignored, and C's inherited caption reads "A's row", which is empty.
3. **Step 3's reader change is not scoped to `rules = 'v2'`.** `readShape`, the client link, `post-source` and `frameio-view` are shared by every client (`trial_reels_pages` is on for all). On a real v1 card that the old Drop moved, C loses the caption it shows and posts today.

**Fix (text).**
- 7.1 and step 1a-bis: "`card_letter` stays null until `rules` is decided (2.2). It is decided **in the same only-if-null write**, from `mainLetter` at that moment."
- New sentence in 2.2: "If, at that moment, `mainLetter` is not A and A's row has no thumbnail, caption or call to action of its own, the first v2 read **settles** the card once, through `swap_begin` with `direction = settle`. It files the card's thumbnail, caption and call to action into A's row as explicit values, and puts the card version's own values (where its row has them) onto the card. Then `card_letter` is written. Until the settle is `done`, the card is treated as pending (16.3)."
- Step 1a counts such cards (counts only). If none is on a real client, the settle needs only its test.
- Step 3: "The new reading applies to `rules = 'v2'` only. v1 and null keep `coalesce(version, card)`, as today. Regression test: a v1 card whose old Drop moved the link reads exactly as before."

### H3. Q-S ("switching back on always lets the SMM finish") points at a start the plan turned off, contradicts the gate, and lets Clear lower a Posted card
23.1 step 4 says: "A Posted card: its approved versions go straight on trial so a winner can be picked (what happens today)."
- **"What happens today" is `autoTrialPatches`** (`logic.mjs:526-556`, called on every read by `startIfPosted`, `index.ts:250`). The 3.4 table says it "does not run for these clients" (v2). The morning rule that replaces it "requires the route value Scheduled" (16.6). So no written mechanism starts it. 23.1 adds "Start trial and the morning rule are allowed on it even though the route value is Posted", which contradicts 16.6 without saying so.
- **The gate:** 3.4 says "Nothing is ever started with some versions left out", and the Start gate needs every counted version approved. Q-S's words, "its approved versions go", start the trial with the unapproved ones left out. Sidney decided Q-S on those words. The plan must write this down as the one exception, or the build will refuse it with the gate.
- **One approved version:** today's function makes a single approved version the **winner at once** (`logic.mjs:546-550`). The plan says a trial needs two (Q-R). Unsaid for this case.
- **Clear on that card:** 3.3 step (5) says Clear moves "Posted to Scheduled". On a card that was Posted *before* the trial (the reel really went out), Clear lowers it to Scheduled. That breaks "never lower a Posted card" (2.2, 16.6) and puts the card back where the morning rule and the robot act on it.
- **"A trial that ended with no winner can run again: Schedule, Start, Pick" (16.7, 23.1 step 4):** by then the robot has usually Posted the card (21.1). "Schedule" on a Posted card would lower it.

**Fix (text), keeping Q-S as decided.**
- 23.1 step 4: "A Posted v2 card switched back on: on the next read, `trial-reels` puts every counted version whose three parts are approved On trial (`approvedByParts`). **This is the one written exception to the all-approved gate (Q-S).** The others stay out with 'Not in this trial'. Fewer than two approved: no trial, and the strip says 'Only Version B is approved: approve another, or switch the trial off'. Never an automatic winner. The rule is shared with Start trial and logged as the system."
- 16.6: "The morning rule requires the route value Scheduled, **or** Posted on a card switched back on under Q-S."
- 16.3 and 3.3 step (5): "`swap_record.before` stores the card's route value before the pick. **Clear restores that value** (Scheduled, or Posted for a card that was Posted before the trial), never a fixed Scheduled."
- 16.7: "A trial that ended with no winner runs again from the card's current status: Start trial, if it is still Scheduled; the Q-S rule above, if the robot or a person has Posted it. Schedule is not offered on a Posted card."
- Tests: a Posted card with A and B approved and C waiting is switched on, A and B go on trial, and C reads "Not in this trial". Pick B, then Clear: the card is Posted again, not Scheduled.

### H4. SyncMate (the AI editor) can set a version "on trial" directly, around every gate, and tells the SMM to
`higgsfield-mcp/trialreels.mjs` writes `studio_trial_versions` with the service role (`index.ts:1603`), not through `trial-reels`.
- Its `update` step refuses "approved", "change asked", "dropped" and "waiting" on a row that is on a card (`CARD_OWNED`, `:20`, `:132`), but **allows `on trial`** and stamps `posted_at` (`:129-135`).
- Its guide says: "After posting, the SMM sets each version to 'on trial'. After 24 hours the winner is picked" (`:34`).
- Its `log` step inserts new letters on a card at any time (`:106-108`; it checks only "the same letter twice"), so a version can be added mid-trial. The plan says Add is refused while a trial runs (16.1).
- It is test-client-only (`TEST_CLIENT_RE`, `:17`), which is exactly where v2 is tested.
- On a v2 card this write: bypasses the Start gate and the Schedule (S2, Q-N); ignores `swap_in_progress` and `expected_revision`; writes a lifecycle word with no `parts`; and turns on the robot skip ("any version On trial", 3.4) for a card that never started.

The plan names this file only for the letter cap (2.2) and as an `approvedByParts` reader (16.1). 7.1's "only the `trial-reels` function" reads or writes these tables is not true.

**Fix (text).**
- 7.1: "Writers of `studio_trial_versions`: `trial-reels`, and SyncMate's trial log (`higgsfield-mcp/trialreels.mjs`, service role)."
- Step 1a: list it as a writer of version **status** and of new rows.
- Step 2 (where the cap moves): "On a row with a `post_id` whose card has `rules = 'v2'`, the studio's `update` refuses `on trial` ('The trial starts on the card: Start trial, or the morning of the scheduled date'). Its `log` refuses a new letter while that card's trial is open, and beyond E. Its guide's last two lines become: 'The trial starts on the SyncView card (Start trial, or the morning of the date); the winner is picked there, with no 24 hours.'"
- Test: the studio's `update` with `on trial` on a v2 card row is refused, and the row is unchanged.

---

## MEDIUM

### M1. `route_written` cannot tell a failed push from a person's move, holds one value for two work items, and 16.6 "heals" what 2.2 says is never pushed back
- **Two writers, two requests.** The page pushes the route value to the work items (`170:1703-1763`). `route_written` is on `trial_reel_cards`, which only `trial-reels` writes. Whichever order is used, a closed tab in between leaves the work item ≠ `route_written`. Per 2.2 that reads as "a person's move": the strip then says "Production moved the video…" when nobody did, and the writer stops pushing until the next version change.
- **Per part.** The route value is per part ("per part, in the order…", 2.2). The video and graphic work items can differ, but `route_written` is "the last route value" (7.1).
- **Heal against no push back.** 16.6: "a mismatch sets `route_behind`, which is healed or warned about". 2.2 and 3.6: a person's move is followed, "the writer does not push it back". As written, a heal undoes the editor's move. `route_behind` is also not in 7.1's one list of ten columns.

**Fix (text).**
- 7.1: "`route_written` holds `{video, graphic, at}`."
- 2.2: "`trial-reels` writes `route_written` (the intent) in the same answer that returns `route_status`, and only then does the page push. A work item that still shows its value from **before** `route_written.at` is a push that did not land: the writer retries it. A work item that changed **after** `route_written.at` to a value other than `route_written` is a person's move: it is followed and never pushed back."
- 16.6: "`route_behind` is computed in the answer, not stored, and means only 'the writer's own push did not land'. It is healed by retrying the push and is never set by a person's move."

### M2. The editor's natural action (moving the sub-issue out of Tweaks Needed) now delivers nothing, and nobody is told
- **Before Schedule:** the route is Tweaks Needed because C's video part is, so the video sub-issue shows Tweaks (3.5). The editor uploads the fix to the same Frame.io link and does what they do on every other card: moves the sub-issue to For SMM Approval.
- Under 2.2 that is "a person's move": no version changes, and C stays at Tweaks Needed. The SMM tab reads the version rows, so C never reaches the SMM. The card waits forever, and the only signal is a strip line on the Calendar card, which the editor does not open.
- "New cut ready" on C's row (step 5b) is the right action, but nothing leads the editor to it.
- Round 6 H4 withdrew the old mapping because the writer's push and the editor's move looked identical. **`route_written` (M1) now tells them apart**, so the old reason is gone.

**Fix (text), pending Sidney's answer (question 1).** 2.2 and 3.6: "When a person moves the video (or thumbnail) sub-issue out of Tweaks Needed and **exactly one** counted version has that part at Tweaks Needed, it is that version's 'New cut ready' (the same write, logged as the editor). With two or more, Production's issue page shows one line, 'Which version did you fix? B · C', and nothing changes until one is pressed." Test on a throwaway linked card: C at Tweaks, the editor moves the sub-issue to For SMM Approval, C goes to the SMM, and A stays approved.

### M3. A version the client passed on: counted out of the gate in 2.2, blocking the gate in 16.6
- 2.2: "counted = live and not passed **everywhere: the Schedule and Start gate**…", so a passed C would not block. The morning rule then puts only the counted versions On trial (3.4, step 3), and C is silently left out.
- 16.6 (round 3, M9): "Every live version is approved or dropped; a version the client passed on must be dropped or asked again (**it blocks until then**)". 3.4 says "Nothing is ever started with some versions left out", and Q-J says "only start a trial if all versions are approved or dropped".
- Q-J and 16.6 agree, so 2.2 is the stray sentence.

**Fix (text).** 2.2: "counted = live and not passed, for the route value, the pips and the grid, and 'at least two'. **The Schedule and Start gate is every live version approved or dropped, so a passed version blocks until it is dropped or asked again** (16.6, Q-J)." The robot clause keeps "at least two counted".

### M4. Seven sentences still mean "A is the card", against `card_letter` and Q-U
- **16.4:** "For a card that has a graphic work item, an inherited thumbnail reads the graphic file (L5)." Under Q-U, inherited means **Version A's**. When `card_letter` ≠ A, the graphic file holds the card version's thumbnail, not A's. Fix: "…reads the graphic file only while `card_letter` = A; otherwise A's row."
- **3.6, editor bullets and step 5b:** "the A row is labelled 'Version A, on the card'" and "Pasting C's new cut on the A row copies it into A and restarts A". Fix: "the card's version's row is labelled 'Version B, on the card' (`card_letter`)", and "pasting on the card's row…".
- **3.6, borrowed thumbnail:** "lands on the card's graphic part and the designer edits A's". Fix: "…edits the card's graphic only while A is the card's version; otherwise the change goes to A's row, through 'Give Version B its own' first".
- **3.4 step 6:** "the client link shows only Version A". Fix: "only the card's version" (as 16.7 says).
- **3.5:** "only Version A's work item exists". Fix: "only the card's work items exist".
- **Section 8, "Turning the trial on…":** "All read as Version A's" contradicts section 5 (unprefixed notes are Whole post). Fix: "fields and statuses read as Version A's; unprefixed notes read as Whole post".
- **23.1:** "`card_letter` … default 'A'" against 7.1's "never a blind 'A'". Fix: point to 7.1 and H2.

### M5. Writes made inside reads are not held while a swap is pending
16.3's lock refuses version writes from requests (`swap_in_progress`), and "`healMainPatch` does nothing while the marker is pending". The other writes that `trial-reels` makes **inside a read** are not covered:
- the morning start (16.6), and the Q-S start (H3);
- the `rules` decision (2.2), and the A-row seed (`switch_set`, `index.ts:513-520`; 2.2's "seeded at their first v2 read").

Example: a switch-off choosing B is pending at 06:01 on the scheduled date. Kasper's queue reads the card, and the morning rule puts A and B On trial in the middle of the swap. The card is switched off with versions On trial.

**Fix (text).** 16.3: "**Every write made inside a read** (the morning and Q-S start, the `rules` decision, the A-row seed, `healMainPatch`, the settle of H2) **is skipped while `state = pending`** and runs on the next read after `done`." Test: a switch-off paused before `switch_set`, then a read at 06:01 on the date: no version changes.

---

## LOW

1. **24.1 lists "Drop on the card's version" among the client link's writes.** The client never has Drop. The tiles with Drop show only in Kasper's wide layout (`_rsL2Wanted`, `195:4416-4419`; `svRsKasperLayout2On`, `188:484-485`), and the code says "only the team drops (Q2)". Remove it from 24.1, and keep it in 24.2.
2. **Drop on the winner or a loser:** `dropPatch` refuses both (`version_on_trial`, `logic.mjs:495`). Say "the tab menu has no Drop on the winner or on a Not-chosen version" in 3.3, and show it in the mockup.
3. **One word for one thing.** Sidney's Q-T confirm says "primary version". Everywhere else, and on Production's row, it is "the card's version" or "on the card". Keep his sentence word for word, use "on the card" for every label, and put a line in the mockup showing both, so he sees them side by side.
4. **`scheduled_at` on a person's Production move.** 2.2 says "once a person schedules, the writer does not move the card again until the winner". Say whether a person moving the work item off Scheduled clears `scheduled_at`. Recommended: only Unschedule from the strip clears it; a Production move keeps it, and the writer keeps holding.
5. **Section 6** says "Production and SyncLinear sub-issues: unchanged". 3.5 and step 5b add the "Trial · N versions" line, "Not chosen", "New cut ready" and the per-version thumbnail rows. Change it to "unchanged in structure (no new sub-issue, no version work item); the additions are in 3.5".
6. **7.1 grants:** "no browser role can read or write either table" is true, but `post-source` reads the version rows too (`handler.mjs:140`). List both readers next to H4's writer.
7. **`rules` on a card never read before the robot runs:** a card that is still null stays outside the skip, which is right, because a null card is v1 (21.5). Add one line so step 1a does not read it as a hole.
8. **The Q-T refusal "no other live version has a link"** should also cover "every other live version was passed by the client" (H1 item 2 picks counted versions first). Wording: "No other version can be the card yet: give Version B a link, or ask the client again."
9. **History lines** for the H2 settle ("Card settled: Version B's fields on the card, Version A's kept in its row", written as the system) and for the Q-S start ("Trial started on a posted card: Versions A, B") belong in 23.1's list.

---

## Review boards

**The client's review link (24.1).**
- Correct: after Scheduled only the needs-client Approve, the `_rsPartState` override, every answer through `answer`, the held queue, and the caption edit as "Ask for a change".
- Wrong: the client has no Drop (L1).
- New with H3: after a Q-S switch-on of a Posted card, the client link shows nothing per version. The card is Posted and the client cannot act, so the link shows it read only, as an ordinary Posted card. Say so in 24.1.

**Kasper's Review Session (24.2).**
- Correct: the writers, Redo keyed by letter, and the Frame notes link.
- Drop on the card's version needs H1's target rule and the Scheduled refusal, and the confirm must name the version actually chosen.
- His wide-layout tiles show Drop on the card's version whenever another live version has a link (`194:741`). After H1 they must also hide it, or explain why it is greyed, on a Scheduled card where no other version is approved.

**The SMM's Review tab (24.3).**
- Correct as written. M2 is what fills it when an editor delivers through Production instead of the card.

## SyncLinear

- **The list and the parent:** unchanged and correct. The "Trial · N versions" line counts live versions; after an H1 Drop the count drops by one.
- **Sub-issues:**
  - correct apart from M1 (when a difference is a person's move) and M2 (what that move does);
  - the card's row label follows `card_letter` (M4);
  - "Edit" on the card's row stays disabled while any marker is pending, including `drop` and `settle` (H1, H2).
- **The Assets box:**
  - after an H1 Drop, the dropped version's row reads "Dropped", and the new card version's row reads "on the card";
  - the box already takes the card's row from `on_card` (`245:109`), so no "A" is hard-coded there.
- **The issue page:** the M2 one-line question appears only when two or more versions wait on that part.
- **Rename:** unaffected. Drop and settle change no title.
- **Status sync:**
  - the bridge stays a trigger;
  - `route_written` with its time (M1) is what keeps the drift check clean without undoing a person's move;
  - a Q-S start on a Posted card writes no status, so Production stays Posted.

## The journeys

- **SMM:**
  - Switch on, Add, approvals, Schedule, the morning start, Pick, Clear: fine.
  - Switch off and on: fine, except on a Posted card (H3).
  - Clear after a Q-S trial lowers Posted (H3).
- **Kasper on a Mac:**
  - Approve, change, Redo and Approve after tweaks: fine.
  - Drop on the card's version: switches the trial off as written (H1); on Scheduled it can make an unapproved version the card (H1).
- **Client on a phone:**
  - Before Scheduled: fine.
  - After Scheduled: only the needs-client Approve; fine.
  - A Q-S Posted card: read only (above).
- **Editor:**
  - New cut ready on the version's row: fine once found.
  - Moving the sub-issue as on every other card does nothing (M2).
- **Designer:**
  - Per-version thumbnail rows exist only where there is a graphic sub-issue (6 of 38), as said.
  - An inherited thumbnail must read A's row once the card's version moves (M4, the first bullet).
- **Sidney:**
  - Clicks on the test client only.
  - SyncMate can start a test trial around the gate (H4), which would confuse his checks.

## Data safety and races

- **Covered well:** one attempt at a time, the takeover, Finish / Put back, the stale-save guard with `swap_count`, the robot skip including a pending marker, expected revisions, and the held queue.
- **Still open:**
  - the Drop swap has no step list (H1);
  - `card_letter` goes stale between 1a-bis and 5, and the card's columns are mixed on cards the old Drop moved (H2);
  - writes made inside reads during a pending marker (M5);
  - a push that did not land reads as a person's move (M1);
  - the studio's service-role write of `on trial` (H4).

## Each build step on its own

- **1a:** add `189:1429-1446` (H1), SyncMate as a writer of version status and rows (H4), and the count of enabled cards whose `mainLetter` is not A (H2).
- **1a-bis:** the columns as listed. `card_letter` stays null until `rules` is decided (H2); no data is filled at migration time. Nothing reads them, so the step stands alone.
- **1b, 1c:** reach every client with v1 tests, as written. Nothing new.
- **2:** add the studio's refusals (H4). The cap move is already here.
- **3:** scope the reader change to `rules = 'v2'` (H2), or every real v1 card the old Drop moved changes what it shows and posts. With that, it stands alone.
- **4:** the route writer starts pushing here, so M1's `route_written` with its time ships here, not in 5b.
- **5:** the Drop swap with `direction = drop` (H1), the settle (H2), Clear restoring `before`'s route value (H3), and the write-in-read hold (M5).
- **5b:** M2's mapping (if Sidney says yes) and the label fixes (M4).
- **No step leaves a real client half-done**, provided step 3 is scoped to v2 (H2) and H4's studio refusal is in place before any real client's card gets `rules = 'v2'`. The studio is test-client-only today, but that gate is a regex, not a promise.

---

## Is the plan ready for mockups?

**Not yet; one short text-only revision (18) first.** Two findings change what a screen shows:
- the Drop confirm must name the version actually chosen, and is refused on a Scheduled card with no approved alternative (H1);
- a switched-on Posted card shows "Not in this trial" on unapproved versions and never an automatic winner (H3).

Question 1 below may add the one-line "Which version did you fix?" to Production's issue page. Everything else is wording. Once revision 18 applies these and Sidney answers the two questions, the mockups can start.

## Questions only Sidney can answer (each has a default; fewer buttons wherever possible)

1. **The editor finishes a version's fix and moves the sub-issue on, instead of pressing "New cut ready".**
   - Example: Kasper asked for a change on Version C's video. The editor uploads the new cut to the same Frame.io link, then moves the video sub-issue from Tweaks Needed to For SMM Approval, as on any other card.
   - **Recommended default:** if only one version is waiting for a video fix, that move counts as "New cut ready" on it, so C goes to the SMM and nothing else changes. If two or more are waiting, Production asks in one line, "Which version did you fix? B · C". No new button otherwise.
   - The alternative: the move changes nothing, and the editor must press "New cut ready" on C's row. C waits until someone notices.
2. **"Clear winner" on a card that was already Posted before the trial ran** (the Q-S case: switched off, posted, switched back on, winner picked).
   - Example: the SMM picks Version B, then presses Clear winner the next day.
   - **Recommended default:** the card goes back to how it was before the pick, Posted, with the versions back on trial. It is never lowered to Scheduled. No new button.
   - The alternative: Clear always goes back to Scheduled. The card would then read Scheduled although the reel is already out.

Defaults I applied without asking (no product change):
- H1: on a Scheduled card, Drop on the card's version picks an approved version or is refused, as switch-off already does.
- H2: the one-time settle of cards the old Drop moved.
- H4: SyncMate's studio log cannot start or extend a v2 trial.
- M3: a passed version blocks the gate (Q-J).
- M5: writes made inside reads wait for a pending marker.
