# Review round 6 of the trial-version card plan (session Trialreview6, 4 Nov 2026)

**Read:** `docs/plans/2026-11-trial-version-card/plan.md`, revision 16 (PR #2608, head `f15345c42`), end to end. I checked it against the code on that branch:
- `supabase/functions/trial-reels` (`logic.mjs`, `index.ts`), `production-write` (`index.ts`, `policy.mjs`), `calendar-auto-posted` and `post-source`;
- the fragments `097`, `140`, `160`, `170`, `180`, `185`, `189`, `190`, `194`, `195`, `245`, `299`, `305` and `321`;
- the migrations: the trial tables, `2026-10-10-calendar-auto-posted.sql`, the status bridge (`2026-09-18`, `2026-10-01`, `2026-10-08`) and rename propagation.

**Not read:** the live database (no live reads were made).

**Verdict in one line:** the model is sound and matches every answer Sidney has given, but **revision 16's new "card's version" (`card_letter`) was not carried through the rest of the plan**. Two board and SyncLinear write paths also contradict the plan. 5 HIGH, 13 MEDIUM, 15 LOW (L1 has five parts). All are text fixes; none needs a new idea from Sidney beyond the three questions at the end.

---

## HIGH

### H1. "Version A" is still hard-coded where revision 16 made "the card's version" a variable
Revision 16 lets the card's version become B without a winner (switch off and choose B, then switch on again; `card_letter`, 23.1). The rest of the plan still assumes the card's version is A until a winner:
- **Swap order:** 3.3 step (0) and 23.1 step 2 write "A's four fields into A's row".
- **Clear the winner:** 3.3 says "A's four fields return to the card", and 23.1 says Clear sets `card_letter` "back to A".
  - The code's `undoWinnerPatches` (`logic.mjs:584`) also takes the first live letter.
  - Example: switch off choosing B, switch back on, run the trial, pick C, then Clear. The card goes back to A, not B. B's row is never refilled from the card, so B's own edits made while B was the card are lost.
- **Other places that still say A:**
  - 2.2: "Version A cannot be dropped while it is the card's version. The card's version is A until a winner is picked."
  - 3.3: "Before a winner the card opens on Version A."
  - 16.7 and 21.1: "the card's version stays Version A", "an ordinary card showing Version A".
  - 24.1: "Trial off or closed: Version A only".
- **Inheritance code:** `readShape` calls `effectiveFields(v, card)` (`logic.mjs:617`, `725-729`), and the client link reads it directly (`194:392`, `401-408`). That falls back to *whatever the card holds*. So with `card_letter` = B, Versions C to E show **B's** thumbnail and caption as their inherited ones, not A's. B's tab also shows its stale row values instead of the card's. The plan schedules a `readShape` change only for closed trials and losers (16.4, 16.7).
- **Existing cards:** some live cards already carry a version other than A (see H3, the drop path). Defaulting `card_letter` to `'A'` would point them at a dropped version.

**Fix.**
1. Add one sentence to 2.2: "The card's version is `card_letter`. Every rule that said 'A' while meaning 'the card's version' means `card_letter`."
2. Write the swap as "the **current card version's** four fields go into its own row (explicit only where the previous `placed` record shows they were its own; see H2)".
3. Clear restores `swap_record.before.card_letter`, not A.
4. Change 2.2, 3.3, 16.7, 21.1 and 24.1 to say "the card's version".
5. Name the `readShape` and `effectiveFields` change in step 3, not step 5: inherited means Version A's value, read from the card while `card_letter` = A and from A's row otherwise.
6. Step 1a-bis fills `card_letter` from today's `mainLetter` for every enabled card, never a blind `'A'`.
7. Decide whether inheritance stays on A after a switch-off (Question 3).

### H2. The swap record has no defined life after a switch-off, so the next pick is either refused or loses data
- 16.3 says the record is "written only if empty".
- 21.2 says `before` and `placed` are "kept with `state = done` until a Clear finishes".
- 23.1 reuses the same record with `direction = off`.

There is no Clear for a switch-off, so after one the record is `done` and never empty. A later pick, or a second switch-off, is either:
- refused forever (if "only if empty" is kept), or
- written over (if it is not), which throws away the `placed` values that say which of the previous card version's fields were its own and which were inherited (3.3 (c) and (d)).

**Fix.**
- A new attempt may start when the record is empty **or** `done`.
- Before it replaces a `done` record, the attempt first files the outgoing card version's fields into its row, explicit only where they differ from the old `placed`.
- Clear works only on a `done` record whose direction is `pick`.
- Test: switch off choosing B, switch on, pick C, Clear. B comes back as the card with its own edits, and A's inherited fields are still inherited.

### H3. Dropping the version on the card already moves the card's link, outside any swap
On Kasper's and the client-link tiles, Drop is shown on the `on_card` version whenever another live version has a link (`194:741`).
- `svTrialReviewDrop` (`194:789-800`) first attaches the next version's link to the card (`svTrialMoveCard`, `189:1054`), then calls `version_drop`.
- That moves **only the link**. A's thumbnail, caption and call to action stay on the card, and `mainLetter`'s "carried" rule (`logic.mjs:240-242`) quietly makes B the card's version. `dropPatch` expects exactly this (`logic.mjs:504`).

Plan 2.2 says the card's version "cannot be dropped… refused", and 23.1 makes `mainLetter` read `card_letter`. With both in place, this button writes B's link onto a card whose `card_letter` is A, then is refused. The plan never names this path, and sheet 24.2 lists "Drop" as harmless.

**Fix.** Name `194:741` and `194:789-814` in step 1a. Then either:
- (a) on v2 cards, hide Drop on the card's version ("To drop Version A, make another version the card first"), or
- (b) make it a proper swap ("Drop Version A: Version B becomes the card"), using the same marker as a switch-off.

Which one is Question 2. Either way, the bare link move must go.

### H4. Production's video work item carries the route value, but 21.4 reads every move of it as a person's move of Version A
- Plan 2.2, 3.5 and 24.4 say the work items "follow the route value", which is the least-advanced version (or Tweaks Needed) across *all* counted versions.
- Plan 3.6, 21.4 and 24.4 also say "A's work item is A's only" and that a bridge move of it "is read as the same move of the card's version's matching part".

The code makes these two incompatible:
- A card status save pushes to the work items **before** the card upsert (`170:1703-1763`, through `_calPushStatusToLinear`, `140:2194-2203`).
- So the bridge fires on the route writer's own push.
- Its history row has `source = 'native-bridge'` and `actor = null` (`2026-10-01-calendar-overall-status-bridge.sql:246-260`), which looks exactly like an editor moving the item in Production.

**Before Schedule:** C has a change asked, so the route is Tweaks Needed and A's video item goes to Tweaks.
- The editor delivers C's fix and moves the item to For SMM Approval.
- Under 21.4, **Version A's approved video part drops to For SMM Approval**.
- The urgent ping (`140:2766-2790`, `190:4157-4161`) and the sub-issue also show Tweaks for a change that is only C's. That contradicts 3.6's "a work item's status never carries another version's change".

**After Schedule:** editors may make any move (`policy.mjs:184-188`).
- If an editor moves A's item off Scheduled, the bridge moves the card.
- The plan says the route writer "does not move the card again". `route_behind` "healed" then means one of two things:
  - push Scheduled back, which silently undoes the editor in Production; or
  - write the card's columns only, which makes the drift check fail (`scripts/card-calendar-status-drift-check.js:86-88`).

**Fix (keep it simple).**
- State that **the work item carries the route value, never one version's state**, and delete "A's work item is A's only" and 21.4's mapping.
- Store the last route value the writer pushed (a `route_written` field on the switch row, added to 7.1).
- A work-item status that differs from it is a person's move. **It never changes any version's parts.** The card follows it through the bridge as today, so there is no drift.
- The strip says one line: "Production moved the video to For SMM Approval; the versions are unchanged". After Schedule it says "Production moved the video off Scheduled; the trial will not start until it is Scheduled again".
- The route writer pushes again only on the next version change.
- The editor's right action stays "New cut ready" on C's row (3.6, step 5b).
- Step 1a tests both cases on a throwaway **linked** card.

### H5. The board sheets (24.1 to 24.3) describe the writes wrongly, and miss five writers of the card
**The sheets' description is wrong.**
- 24.2 and 24.3 say the card's version is written through the card-level paths and `trial-reels answer` handles "the others"; 24.1 says "the card's own parts through the existing client paths".
- In the code **every version, A included, is answered through `trial-reels answer`** (`194:572-605` uses the letter on screen).
- The card-level approve (`195:3765-3768`) runs only once a stage is finished for all versions.
- A change on *any* version also writes a change note on a card part (`195:3833`).
- Built as the sheets say, A's row would stop receiving stamps, which breaks 2.2's "part states always live in the version rows, A included".

**Writers of the card that the plan does not list:**
1. `_rsTrialToTweaks`' non-Kasper branch, `_calApplyAutoStatus(m.id,'client_added','video')` (`195:3735`). It moves the card to Tweaks Needed from the SMM tab and the client link.
2. The Kasper branch is at `195:3724-3733`, not `1724-1733` as cited. It also calls `_calClearStaleApprovals`, which wipes the card's stamps.
3. Kasper's **Approve after tweaks**: `_kasperApproveAfterTweaksComp` (`195:3868`) writes `video_status` and `kasper_approved_after_tweaks`.
4. Kasper's **Undo** toast after an approve (`_rsL2UndoArm`, `195:3769`, `4621-4643`). It reverts only the card part; the version keeps `kasper_ok_at`.
5. The **client's caption edit** (`195:2747`, saved by `_rsSaveEdit` at `195:4240-4275`). It edits the card's caption when the card's version has no caption of its own, which silently changes every version that inherits it, then stamps the card's caption part as approved.
6. `svCalResolveVersionTweaks` (`195:3744`), which resolves change comments on the card when the SMM approves a card that is further along.

**Fix.**
- Rewrite the "Writes" line of 24.1 to 24.3: every answer on every version goes through `trial-reels answer`; every card-status effect goes through `routeStatusFor`.
- Add items 1 to 6 to step 1a's inventory and to step 1b's bypass test.
- On a v2 trial card, the client's caption edit becomes "Ask for a change" on that caption part. This fits 3.6, where the client never edits after Scheduled, and stops a client edit landing on several versions at once.
- Kasper's Undo also undoes the version stamp.

---

## MEDIUM

### M1. The switch-off order contradicts itself, and the "changed while off" check always fires
- 16.6 says "Off: write the card's columns first, then `switch_set`". 23.1 step 1 says `switch_set` first, then the route writer sets the card's columns.
- With 23.1's order, the route write bumps the card's `updated_at` *after* `card_updated_at_off` is stored. So does every Production attachment and bridge move during a swap (the 2026-09-05 attachment SQL updates `calendar_posts.updated_at`).
- Result: every switch-on sees the card as "changed while off" and copies the card's statuses over A's per-part stamps, including the per-part notes and the "what was approved" values from 21.3.

**Fix.**
- One order: card columns, then `switch_set`.
- `switch_set` reads the card's `updated_at` **on the server, as its last step**, and stores that.
- Define what the copy writes into a part, including the approved values from 21.3, so a copied "Approved" still matches.

### M2. Switching back on: a closed trial and a Posted card
- **A closed trial:** 16.7 says "A closed trial is not reopened (default)". 23.1 step 4 says switching on clears `trial_closed_at` and "the trial can run again". The two contradict each other.
- **Leftover statuses:** 23.1 resets only On-trial versions at switch-off. It leaves "no clear winner" versions, which `live()` counts as live (`logic.mjs:151`).
- **A Posted card:** a card switched off is an ordinary card, so the robot or a person posts it. Switched back on, it is Posted with no winner.
  - Start trial and the morning rule both need the route value at Scheduled (16.6).
  - Unschedule exists only before a start.
  - A Posted arriving "another way" is ignored and warned about (3.4).
  - So "the trial can run again" is false for it: it sits forever with a warning.

**Fix.** Apply Question 1's answer. Whatever the answer, switch-off also turns "no clear winner" versions back into the status their parts give. Add a test for each case.

### M3. Switching off to a version that is not approved, on a Scheduled card
- 23.1 says the route writer "never lowers a Scheduled or Posted card".
- If the SMM switches off a Scheduled card choosing Version C, whose caption was sent back, the result is an ordinary Scheduled card with an unapproved caption.
- The robot's `calendar_auto_posted_parts_ok` reads card columns the writer did not lower, so the robot can post it that night.

**Fix (no new button).** While the card is Scheduled, the dialog offers only versions whose three parts are approved. Others are greyed with the reason ("Version C's caption is not approved"). Add this to the mockup list.

### M4. The swap lock does not cover Production's attach rows or caption jobs
- On the card's own video sub-issue, the "on the card" row's Edit is `production-write` `attachment` (`240:2728-2737`, `210:225`), not `version_link_set`. 24.4 says the opposite.
- Any creative may attach (`policy.mjs` ~350). The attachment checks only the compare-and-set and the link, never `swap_record`.
- So an editor or designer can attach during a pending pick, Clear or switch-off. The next staff read's `healMainPatch` (`logic.mjs:468-475`) then copies that link into the card version's row.
- The same gap applies to the graphic sub-issue's attach.
- It also applies to `caption-generate` jobs, including the Sheet view's bulk "Write captions for several cards" (`180:2051`). They run for minutes and write the card's caption when they finish, which can be after a swap.

**Fix.**
- While the marker is pending, Production disables Edit on the card's rows on both sub-issues. It already reads `trial-reels`.
- `healMainPatch` does nothing while the marker is pending.
- Caption jobs carry the card's version letter and the swap counter, and refuse on a mismatch.
- The Finish/Put back verify step (16.3) is the backstop.

### M5. The Posted step (and the step back to Scheduled) is a full card save, not one status write
- The bridge and the page both set the card's `status` to the worst of video, graphic and caption (bridge `:209`/`:226`, `_writeUiApplyOverallStatus` `170:1682`/`1767`).
- The work-item `status` op moves only video and graphic, so the card stays Scheduled unless `caption_status` is saved too.
- The page sends video and graphic in parallel with `allSettled` (`170:1703-1763`), so one can land and the other be refused.

**Fix.**
- Name step (5) as the card's normal status save with all three parts.
- Record video, graphic and caption as separate `steps_done`, and resolve a half-landed save in the verify step.
- Do the same for Clear's Posted to Scheduled and for Unschedule.
- Correct the citation: Posted is put together in `170:1703-1800`; `140:2180-2205` is the one-part push.

### M6. Clear and Put back cannot restore "no thumbnail" on a card with a graphic item
- `attachment` refuses an empty URL (`index.ts:5694`, `invalid_artifact_url`; and the SQL "production artifact url required").
- If the card had no thumbnail and the winner had one, the winner's file stays on the graphic item after Clear.

**Fix.**
- On a card with a graphic item, the Clear and Put back dialogs say "Version A has no thumbnail: paste one, or keep Version B's for now". This reuses 16.3's paste-in-place.
- Write down that this is the only field Clear can leave behind.

### M7. The client's held queue keeps retrying the new refusals
- `194:662` drops a held change only on `version_not_found`, `version_dropped`, `version_on_trial`, `trial_reels_off` and `not_enabled`.
- Every other refusal is retried for as long as the page stays open, backing off to every 60 seconds (`194:672-683`).
- The plan adds `card_scheduled`, `version_moved`, `conflict` and `swap_in_progress`.

**Fix.** In step 1c:
- drop `card_scheduled` and `version_moved` and tell the client in one line;
- retry `swap_in_progress` and `conflict` after a re-read.

### M8. The client cannot reach a Scheduled trial card, so the Scheduled views and the needs-client Approve have no way in
- `_rsPartState` treats every part of an Approved, Scheduled or Posted card as done (`195:1657`). `_rsCalPosts` lists only cards with a part waiting (`195:1783-1801`).
- So a Scheduled card never appears on the client's Review tab: neither the read-only view (3.6, 24.1, 21.9 L4) nor the needs-client Approve (16.2).
- The card-level client guards also refuse a Scheduled card: the Approve at `190:918-920`, and the change or reopen at `190:1114-1117`. The plan cites 918-920 as the reopen guard, which is wrong.
- So 3.6's "no gate is widened" is misleading. A new client override is needed in `_rsPartState` (`195:1647-1652` overrides only at Client Approval).

**Fix.**
- Step 1b names this override.
- The needs-client Approve always goes through `trial-reels answer` (even on the card's version), never the card-level `_calReviewApplyApprove`.
- Decide whether the read-only Scheduled view needs a way in at all. The simplest answer is no: after Scheduled the client sees a trial card only while one of its versions needs their OK. Drop the "all versions read only" sentence otherwise.

### M9. The readers that pick "which version's fields" are fixed in step 9, after swaps ship in step 5
- `post-source` (`handler.mjs:149`) gives a version `version.thumbnail_url || card.thumbnail_url`. That is the card's thumbnail, which is the winner's after a pick, or B's when `card_letter` = B.
- `frameio-view`'s client card and `readShape`'s `effective` (H1) have the same problem.
- From step 5 to step 9, the test client would post and show the wrong inherited thumbnail. Step 5's own check ("Run a whole trial… send") would exercise it.

**Fix.** Move the effective-fields reader changes (`readShape`, `post-source`, the client card, the Post tab's `v.status === 'approved'` read at `299:273`) into step 3 or step 5. Step 9 then keeps only "posting after a winner" and the Today line.

### M10. Production labels: "Not chosen" is new work, and "Video" or "Version" follows the client
- 3.5 says the losers' rows read "Not chosen" and the box "stays as it is". In the code, a lost version gets no label (`svTrialLabelShown`, `189:588-592`).
- `245:111` chooses "Video X" or "Version X" from the client's flag, not from the card's `rules` (16.6 M5 says the page branches on the card).

**Fix.** List both in step 5b.

### M11. `switch_set` "writes v2" would convert a v1 card mid-flight
- 16.6 M5 says `switch_set` writes `v2`. 23.1 says "v1 cards keep today's switch unchanged".
- Switching the one real Posted v1 card off and on would make it v2: Posted, with every version waiting, and stuck.

**Fix.** `switch_set` writes `v2` only when `rules` is null.

### M12. The robot's skip clause is written in two halves and counts rows, not versions
- 3.4 gives the clause. The "pending marker" condition is only in 16.3, and must not depend on `enabled`: a switch-off sets `enabled = false` before `state = done`.
- In SQL, "at least two counted versions" must follow `trial-reels`' rules:
  - match the client without regard to case (`ilike`, `index.ts:235`);
  - keep one row per letter (`oneRowPerLetter`). Duplicate "Video A" rows are documented (`logic.mjs:174-189`) and would make one version count as two.

**Fix.** Write the whole clause once in 3.4, with both rules, plus a test with a duplicate A row.

### M13. The column list is still in four places that disagree
- 7.1 says step 1a-bis adds all eleven columns, and 23.1 says `card_letter` is added in 1a-bis.
- Step 1a-bis, step 2 and 16.5 list five or six.
- H4 adds `route_written`.

**Fix.** One list in 7.1. Steps 1a-bis, 2 and 16.5 point to it.

---

## LOW
1. **Contradictions left in the text:**
   - 3.3, first bullet of the rule ("…and part statuses in the card's own columns") against the next bullet ("Part statuses never swap; they always live in the rows").
   - The section 8 row "Trial switched off with a winner: Refused until the winner is cleared" against S-B.
   - The section 9 row Q1 "A's part statuses are copied to A's row" against 2.2 (M1a: nothing is copied).
   - 3.3 "the attachment probe can refuse… when A's current link is dead" against 16.3. The probe checks the link *being attached* (`production-write index.ts:5751`), so on a pick it is the winner's link.
   - 3.6 "Unschedule / Posted back to Scheduled not verified": now verified. SMM and admin may make any move (`policy.mjs:324`, `390`), and the bridge keeps stamps on both moves (`2026-09-18…sql:218-225`).
2. **`link_states` probes only each version's video link** (`index.ts:596-614`), not thumbnails. Its checker is also a copy, not production-write's `probeAssetUrl`. Say that the pre-check is advisory and step (1)'s 409 is the real guard. `assertGraphicsApprovalArtifact` is not on the swap path (it runs only for a move to SMM approval); drop it from 16.3.
3. **Wrong citations:**
   - `305:439-441` is `_kasperJudgeConflict` (305 has no trial code); the split writes are in `195:3738-3768`.
   - `logic.mjs:433` is the on-trial refusal; the same-link no-op is `432`.
   - The live bridge body is the 2026-10-08 file (its header says NOT APPLIED, so step 1a must read which one is live).
4. **Kasper's stale board is overstated:** 305 sends only fields that differ from `_patchBase` (`305:518-521`). "No local copy for trial cards" still works. The real risk is a stale *status* decision, which the stale-save guard covers.
5. **Kasper's "Your notes in Frame.io" link** uses the card's `asset_url` (`195:3033`), so with B selected it opens A's Frame page. It should read the selected version's link.
6. **The designer's per-version thumbnail rows (S5) exist only where there is a thumbnail sub-issue** (6 of the 38 cards). Say plainly that none is created for the others, and that there only the SMM's paste works.
7. **Today's quiet line covers only running trials.** Add "date passed, trial not started (Version C not approved)", so a trial waiting on a version does not look stuck.
8. **Switching on, or scheduling, after the date has passed starts the trial on the next read**, because the morning rule uses "on or before". Add one line to the strip and the mockup ("Starts now: the date has passed").
9. **Name the `trial-reels` action that writes the marker and the outgoing version's four fields.** `version_fields_set` refuses the card's version (`version_is_card`) and On-trial versions, and has no call to action.
10. **Bulk caption generation** (`180:2051`, the Sheet view) is a writer of the card's caption the plan does not list. Add it to step 1a with the job guard from M4.
11. **The Messages inbox, rounds and overdue bump** are as noted. The overdue bump happens on **every** staff status write (`index.ts:5806`), not only the late Posted one, so a route write can also move a due date forward. That is cosmetic; note it.
12. **The client's Approve-only view needs a `ready` rule for a team-only send-back** on a Scheduled card (`throughTeam` reads the card status). Name it in step 8.
13. **The step 1b test "C appears on Today on the test client"** needs the bypass at `097:366`, which the plan has. Keep it in the same PR as the test.
14. **`switch_set` today has no checks at all** (`index.ts:498-526`). Step 5 must add the pending-marker refusal and the "with a winner, no choice" rule on the server, not only in the dialog.
15. **The 30-second lag** after a switch-off in Production (`245` refreshes on broadcast or timer) is acceptable; note it in the mockup.

---

## Review boards

**The client's review link (24.1).**
- Correct: which versions show before Scheduled (`readShape` client rows), the held queue gaps, `TRV_REOPEN_FROM`, and "Send to your team" as a note on Scheduled.
- Wrong or missing:
  - the write paths (H5);
  - the caption edit that writes the card (H5, item 5);
  - after a switch-off the link shows the **card's** version (B if chosen), not "Version A only" (H1);
  - Scheduled cards are not reachable (M8);
  - the needs-client Approve must not use the card-level Approve guard (M8);
  - the held queue's refusal list (M7);
  - Drop on the card's version (H3).
- Phone: tabs, 44 px targets and the "Loading…" wait are in the mockup list; fine.

**Kasper's Review Session (24.2).**
- Correct: listing per version, Redo keyed by `id|part` today (`195:3103`, `1172`; the plan's fix stands), no Redo on version thumbnail and caption rows, and no "Approve to client" on a trial video.
- Missing:
  - Approve after tweaks and Undo write the card directly (H5);
  - `_rsTrialToTweaks` clears stale approvals (H5);
  - Drop on the card's version (H3);
  - the Frame notes link (L5);
  - the stale board risk is smaller than stated (L4).
- The send-back dialog from Kasper's part row is a good addition. It must call `trial-reels` and the route writer, never `_kasperRequestTweakComp` on its own.

**The SMM's Review tab (24.3).**
- Correct: queue per version (once 1b lands) and "Change my mind" per part.
- Missing: the non-Kasper Tweaks branch (`195:3735`) and `svCalResolveVersionTweaks` (`195:3744`) write the card (H5).

## SyncLinear

**The Production tab list.**
- Rows are unchanged. The "Trial · N versions" line and its dots are new work in step 5b; fine.
- The Scheduled filter lists trial cards: right.
- Before Schedule the parent can sit at Tweaks Needed because of one version. That is the route value, and it is fine once H4's sentence says so.

**The issue page.**
- Container, "Open in Calendar" (`260:977-992`) and "Back to card" all verified.
- Feedback & tweaks shows "Tweak · Round N" (`230:1585`); fine.

**Sub-issues.**
- Status follows the route value. **H4 is the main SyncLinear bug:** an editor's move is indistinguishable from the route writer's push, and must not change Version A.
- Nothing in the plan creates a sub-issue (verified; component fill is a Calendar button, `160:3747`). Add the explicit sentence from L6.

**The Assets box.**
- No "A" is hard-coded: the card's row is `vs.find(v => v.on_card) || vs[0]` (`245:109`), and it falls back to one "Deliverable file" row when switched off (`245:67`, `102-104`). Both correct.
- Wrong or missing:
  - the "on the card" row's Edit is `production-write attachment`, not `version_link_set` (M4);
  - "Not chosen" does not exist yet (M10);
  - mid-swap, the card's row shows the card's link, so the marker rule must be in place before step 5 (it is).

**Rename and status sync.**
- Rename propagation fires only on `name` (`2026-09-23-rename-propagation.sql:199-204`), so swaps and version labels never touch titles. The plan is right.
- Status sync:
  - the attachment writes `deliverables.file_url` and the database copies it to the card's `asset_url` or `thumbnail_url`, with no status change and no bridge run (verified), so the swap's link and thumbnail steps are safe;
  - the Posted step is a full card save (M5);
  - Clear and Unschedule are allowed for SMM and admin and keep the stamps (L1);
  - the drift check stays clean only with H4's rule (the card follows a person's move; the writer never pushes back).

---

## The journeys
- **SMM.**
  - Trial on, versions, approvals and Schedule: fine. The SMM tab is fixed by 1b, plus H5's extra writers.
  - The 06:00 start: fine. Add the "date passed" lines (L7, L8).
  - Pick: fine.
  - Clear: wrong card after a switch-off (H1, H2).
  - Switch off: order bug (M1); an unapproved version can be chosen on a Scheduled card (M3).
  - Switch back on: stuck when Posted, and contradicts 16.7 on a closed trial (M2).
- **Kasper on a Mac.**
  - Approve, change and Redo: fine with H5.
  - Drop on the card's version moves only the link (H3).
  - Approve after tweaks and Undo bypass the route writer (H5).
- **Client on a phone.**
  - Before Scheduled: fine.
  - After Scheduled: cannot reach the card at all (M8).
  - Held changes: fine with 1c, plus M7.
  - The caption edit changes every version that inherits it (H5).
- **Editor.**
  - "New cut ready" on C's row is right.
  - Moving the work item by hand un-approves A today under 21.4 (H4).
  - Attaching on the card's row during a swap (M4).
- **Sidney.** Clicks on the test client only. Every step is behind the flag, apart from 1b and 1c, which carry v1 regression tests.

## Data safety and races
- **Covered well:** two people picking, the stale card save, the takeover, the swap halfway with Finish/Put back, refused writes with read-back, and the robot during an open trial.
- **Still open:**
  - a Production attach or caption job during the swap (M4);
  - Posted landing half-way (M5);
  - an empty thumbnail on Clear (M6);
  - the robot clause's row counting and the pending-marker condition (M12);
  - "changed while off" firing every time (M1);
  - the drop path's two writes (H3).

## Each build step on its own
- **1a:** add H3's path, H5's six writers, H4's two Production tests, M8's guards and L3's citations.
- **1a-bis:** one column list (M13) and `card_letter` filled from `mainLetter` (H1).
- **1b, 1c:** fine, plus H5 and M7. They reach every client with v1 tests, as written.
- **3:** move the `readShape` and effective-fields change here (H1, M9).
- **4:** the route writer starts pushing to the test client's work items here, so H4's rule must ship in 4, not later.
- **5:** needs H1, H2, M4, M5, M6 and moves `post-source` here (M9). Otherwise the test client posts the wrong thumbnail between 5 and 9.
- **5b and 8:** M10, M8, L12.
- No step leaves a real client half-done, as long as 1b and 1c keep their v1 regression tests and everything else stays behind the card's `rules`.

---

## Is the plan ready for mockups?

**Not yet, but close.** Three HIGHs change what screens show:
- what Drop does on the card's version (H3);
- what Production shows when an editor moves the video (H4);
- which version the card returns to after Clear or a switch-off (H1).

The switch-off and switch-on dialogs also change (M2, M3, M8). Make one more text-only revision (17) with these fixes and Sidney's three answers below, then start the mockups. No finding needs a new mechanism; each fix narrows or names something the plan already has.

## Questions only Sidney can answer (each has a default; fewer buttons wherever possible)

1. **Switching a trial back on after it ended or the card was posted.**
   - Example: Monday the SMM switches the trial off on a Scheduled card, the card posts that evening, and Wednesday they switch it back on. Or the trial was ended with no winner, and later switched off and on.
   - **Recommended default:** switching back on always lets the SMM finish the trial. If the card is already Posted, its approved versions go straight on trial so a winner can be picked, which is what happens today. A trial that was ended with no winner can run again.
   - The alternative is to refuse switching back on once the card is Posted. That is simpler, but it is a dead end.
2. **Dropping the version that is currently the card, before any winner.**
   - Example: Version A is on the card, Kasper decides A is bad and presses Drop on it.
   - Today this quietly moves only the video link to Version B.
   - **Recommended default:** keep the Drop button, with a one-line confirm, "Drop Version A: Version B becomes the card". It moves all four parts safely, the same way a switch-off does. There is no new button.
   - The alternative is to refuse it ("make another version the card first").
3. **Which version an empty field copies after the card's version changes without a winner.**
   - Example: the SMM switches the trial off making Version B the card, then switches it back on. Version C has no caption of its own. Should C show Version A's caption (the original card's) or Version B's (the card's now)?
   - **Recommended default:** Version A's, as you said in S4 ("inherit the old main card"). Nothing changes silently when the card's version moves.

Defaults I applied without asking (no product change):
- M3: only approved versions are offered when switching off a Scheduled card.
- H4: a Production move never changes a version.
- M8: after Scheduled the client sees a trial card only while a version needs their OK.
- M11: `switch_set` writes v2 only on new cards.
