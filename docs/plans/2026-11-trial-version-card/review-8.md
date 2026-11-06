# Review round 8 of the trial-version card plan (session Trialreview8, 6 Nov 2026)

**Read:** `docs/plans/2026-11-trial-version-card/plan.md`, revision 18 (PR #2608, head `fa8eaa1`), end to end. I checked it against the code on that branch:
- `supabase/functions/trial-reels` (`logic.mjs`, `index.ts`), `higgsfield-mcp/trialreels.mjs`, `post-source/handler.mjs`, `production-write` (`policy.mjs`, `index.ts`), `notify` (`index.ts`, `format.ts`), `instagram-upload`;
- the fragments `245` (Production's trial rows), `299` (the Post tab's cancel), and the `cardStatus` readers in `logic.mjs` that the review boards and the client link sit on;
- the migrations `migrations/2026-10-01-calendar-overall-status-bridge.sql` (the bridge) and `migrations/2026-10-10-calendar-auto-posted.sql` (`calendar_auto_posted_due`).

**Not read:** the live database. No live reads or writes were made.

**Verdict in one line:** the round-7 fixes landed and are consistent, and Q-T and Q-U are carried through well. Sidney's two new decisions are written into the plan's headline sections (2.2, 3.3, 3.5, section 9), but **Q-V has no data source for the list row and the parent, and older sections still describe the opposite**. Also, **the way the plan tells "a push that did not land" from "a person's move" can turn an unrelated edit into a false "Fixed" on a version**. And **the plan stops only `placeOf` from reading the placement value, while five other helpers still read it**. Under Q-W's Clear, those helpers would send every reset version straight to the client. 3 HIGH, 6 MEDIUM, 7 LOW. All are text fixes. One adds a per-part flag ("the SMM sent this straight to the client"), nothing else new.

## Round-7 fixes: did they land?

| Round 7 | Landed? | Note |
|---|---|---|
| H1 Drop gets `direction = drop` | Yes (2.2, 16.3, 23.1 tests 10, step 1a, step 5, 24.2) | Target rule, Scheduled refusal, both bare moves (`194:789-814`, `189:1429-1446`) and v1's old move are all named |
| H2 `card_letter` null until `rules`; settle; step 3 scoped to v2 | Yes (2.2, 7.1, step 3) | The settle has no owner when the first v2 read comes from a client or an editor (M5). It is not limited to cards decided `v2` (M5) |
| H3 Q-S on Posted cards | **Replaced by Q-W** (23.1 step 4, 3.3, 16.7, 21.8) | Six older sentences still assume a Posted card can be switched back on, or that Clear returns to Scheduled (M1) |
| H4 SyncMate's studio | Yes (step 2, 7.1, step 1a) | `trialreels.mjs:129-135` really does let `update` write `on trial` today. The refusal is keyed to `rules = 'v2'` only (L3) |
| M1 `route_written {video, graphic, at}`, `route_behind` computed | Yes in wording (2.2, 16.6) | The rule needs a time for the work item's status, and none exists (H3) |
| M2 editor's move | **Replaced by Q-V** (2.2, 3.5, 3.6, 24.4) | 21.4's body, the 5b row and 3.5's last bullet still say a person's move never changes a version (L1) |
| M3 passed blocks the gate | Yes (2.2, 16.6) | |
| M4 "A = the card" sentences | Yes in the seven places | One more in 16.3's dead-link bullet: "before a Clear, A's are" checked (L6) |
| M5 writes inside reads held while pending | Yes (16.3) | Q-V adds two new writes inside reads (the exactly-one mapping and the push retry), and they are not in the list (H3) |
| L1 to L9 | Yes | L9's Q-S start line is gone with Q-W. No Clear line was added (L5) |

---

## HIGH

### H1. Only `placeOf` is stopped from reading the placement value; five other helpers still read it, and Q-W's Clear makes them send every reset version to the client

2.2 says "`placeOf` (which reads the card status today) **must not read the route value on v2**". But in `logic.mjs` the card status reaches the routing decision through more than `placeOf`'s own lines:
- `sentOnWhole(versions, stage, cardStatus)` (`323-325`). If the card reads Client Approval, Approved, Scheduled or **Posted**, and no live version has an SMM OK, every version counts as through the team. `placeOf` calls it (`269`). So does `readShape` (`599`, then `ready` at `614`).
- `kasperOnRoute(versions, cardStatus)` (`254-258`). Kasper is off the route when the card reads Client Approval or later. `placeOf` (`270`), `throughTeam` (`274-276`) and `versionStatusPatches` (`686`) call it.
- `stageReady(..., cardStatus)` (`305-311`) via `throughTeam`. It decides whether the **client** may answer a version.
- `stageDone(..., cardStatus)` (`284-291`) via `placeOf`.

On a v2 card the card status is the placement value, written from the versions. Three concrete failures:
1. **Q-W's Clear.** Clear resets every version (all SMM, Kasper and client stamps cleared) while the card still reads Posted, because the card goes back last, through the route writer. At that moment `sentOnWhole(…, "client", "Posted")` is true, since no version has an SMM OK. Then:
   - `placeOf` returns `client` for every version;
   - `routeStatusFor` computes **Client Approval**, not For SMM Approval;
   - `readShape` marks every version `ready` for the client;
   - so the client link offers Approve on versions the team has not looked at since the reset. That is the opposite of Sidney's "every version back to For SMM Approval".
2. **A person's move in Production.** Someone moves the video sub-issue to Client Approval. The bridge sets the card's `status` to Client Approval, as today. 2.2 says "the move changes no version", and no row changes. But every version with no SMM OK now **reads** as with the client (same path as 1). The client sees Approve on unreviewed cuts.
3. **Kasper skipped silently.** Before Schedule, if the least-advanced version is at Client Approval, the placement value is Client Approval. Then `kasperOnRoute` is false for every version without a Kasper OK. A version the SMM approves next (`versionStatusPatches`, `686`) goes past Kasper. On v2 nothing records whether the SMM chose "Approve to client" for that version, so the information that `kasperOnRoute` reads from the card status no longer exists anywhere.

**Fix (text).**
1. In 2.2, replace "`placeOf` … must not read the route value on v2" with: "**On `rules = 'v2'` no function in `trial-reels` reads the card's status to route a version.** That covers `placeOf`, `sentOnWhole`, `kasperOnRoute`, `throughTeam`/`stageReady`, `stageDone`, `readShape` (`ready`, `stages_done`) and `versionStatusPatches`. Each is passed `cardStatus = null` on v2. `sentOnWhole` is false on v2, because the whole-card send does not exist on a v2 card. **Whether Kasper is on a version's route is stored per part in `parts`** as `kasper_skipped`, set only when the SMM sends that version's part straight to the client (Approve to client, or the status menu's Client Approval)."
2. In 16.3 (Clear), add: "Clear resets the versions first and computes the card's route with the v2 reading above, so the route is For SMM Approval."
3. Add to step 1a-bis's unit tests:
   - a v2 card reading Posted with every version reset routes For SMM Approval, and no version is `ready` for the client;
   - a v2 card moved to Client Approval in Production leaves every unreviewed version unanswerable by the client;
   - the SMM's Approve to client on C sets `kasper_skipped` on C only.
4. In 1a's inventory, list these seven sites by line.

### H2. Q-V: the list row and the parent have no data source, and four older passages still describe the opposite

Q-V says "the parent issue, the list row and the video sub-issue show each version's own status", with no overall status. The plan does not say where the list row gets the versions:
- `245` reads `trial-reels` only for the **open video sub-issue's** Assets box, once per sub-issue, kept 30 s, staff key only (`245:48-60`, `TRL_PROD_TTL_MS`). Its header says "**The Production list rows are unchanged**" (`245:6-12`).
- A signed-out or unverified page reads no versions at all (`245:51-55`) and draws "today's single row". For a list row that means the placement value would be drawn as the status, which Q-V forbids.

Older text still says the opposite:
- 2.2's reader table, Production row: "Follow the route value, as today … The parent shows 'Trial · N versions' with dots".
- 24.4, the list: "rows are unchanged. A trial card's parent carries a 'Trial · N versions' line with the version dots"; and the parent's issue page: "status … not editable (as today), with the 'Trial · N versions' line".
- Section 4, last lines: "Production: no change … A later option is to show the three pips next to each version row".

Also unsaid: **which status each surface shows for a version.** A version has three parts.

**Fix (text).**
1. In 3.5 and 24.4, add:
   - "**The list reads versions with `list_many`, once per listed client** (the action exists, `index.ts:179`), cached like the Calendar's, and refreshed by the same broadcast as `245`."
   - "**Until the versions arrive, or when they cannot be read** (signed out, a failed read), a trial card's row shows 'Trial · N versions' with a quiet 'loading', **never the placement value**."
2. Say what each surface shows:
   - the **video sub-issue** shows each version's **video** part;
   - the **thumbnail sub-issue** shows each version's **thumbnail** part (see M4);
   - the **parent and the list row** show each version's least-advanced part, the same as the Month dot.
   - Lifecycle words (On trial, Not chosen, Dropped) replace a version's part word.
3. Rewrite 2.2's Production reader row to: "Shows each version's own status (3.5); the stored status is the placement value, used only for the column on boards and Workload." Replace the two 24.4 sentences in the same way. Delete section 4's "later option" line.
4. Change `245`'s header comment in step 5b. Its "list rows are unchanged" is now wrong.
5. Add the status control on the sub-issue to Question 1 below.

### H3. A failed push followed by any unrelated edit reads as a person's move, and with one version waiting it marks that version "Fixed" when nobody fixed it

2.2 says: "A work item that still shows its value from **before** `route_written.at` is a push that did not land … A work item that changed **after** `route_written.at` to a value other than `route_written` is a person's move". Then "moving the sub-issue out of Tweaks Needed counts as fixing a version only when exactly one counted version has that part waiting".

A work item has no status timestamp. The only time it has is `deliverables.updated_at`, which `calendar_auto_posted_due` itself uses (`2026-10-10:240-241`). That column moves on any write: a rename (`rename_propagation`), an assignee change, a comment, the overdue bump (`production-write index.ts:5806`).

The failure, before Schedule:
1. The video work item sits at For SMM Approval (every video part is fine).
2. The client asks for a change on Version B's video. The route writer writes `route_written.video = Tweaks Needed` and the page pushes. The push fails: the network drops, or the move is not one the signed-in key may make.
3. Ten minutes later an editor renames the sub-issue, so `updated_at` moves past `route_written.at`.
4. The next read sees a work item that "changed after `route_written.at`" to a value (For SMM Approval) other than `route_written` (Tweaks Needed). It reads that as **a person moving the sub-issue out of Tweaks Needed**.
5. B is the only version waiting for a video fix, so the exactly-one rule marks **B fixed**. B goes back to the SMM with the same old cut, and the client's change is silently treated as done.
6. The push is never retried, because a person's move is "never pushed back".

Even without step 5, **an unrelated edit after a failed push freezes the work item in a stale column for good**, and the drift check then compares the card with a work item the writer has stopped correcting.

Two more gaps:
- "logged as the editor": the bridge writes `actor = null`, `role = null` (`2026-10-01:246-260`, quoted in 3.6), so the person is not known.
- The mapping and the retry are **writes made inside a read** (a version's part restarts; a push is retried). 16.3's list of writes held while a marker is pending does not include them, and nothing makes them idempotent when two pages read at once.

**Fix (text), in 2.2 and 16.6.**
1. "**The only evidence of a person's move is a bridge row**: a `calendar_post_events` row with `source = 'native-bridge'`, `action = 'status_change'`, this component, `ts > route_written.at`, and `to_status` different from `route_written[component]`. Our own push writes a bridge row whose `to_status` equals `route_written`, so it is never mistaken for a person's."
2. "**A push that did not land** is a work item whose status differs from `route_written[component]` with **no** bridge row for that component after `route_written.at`. It is retried **only by an SMM or admin page**. A client's or an editor's page never pushes a retry."
3. "The exactly-one mapping runs once per bridge row (keyed by the row's id), with the version's `expected_revision`. It is logged as 'Marked fixed by a move in Production'. The person is named only when `production-write`'s receipt for that move names them."
4. Add both to 16.3's list of writes inside reads that wait for `state = done`.
5. Tests:
   - a failed push, then a rename: the push is retried and no version changes;
   - two reads at once after one real move: C is marked fixed once.

---

## MEDIUM

### M1. Q-W is not carried through: six sentences still let a Posted card switch back on, or Clear return to Scheduled
- **23.1, test (4):** "off with a winner: … on restores the winner flag". A card with a winner is Posted (the pick writes Posted last, 3.3), so under Q-W "on" is refused. Rewrite: "off with a winner: the winner stays the card, the others are hidden; on is refused with the Posted line."
- **23.1 step 4:** "With a winner, the winner flag is still there for a card that is not Posted." That can only happen after a person moved the card off Posted by hand (21.9 L8). Say so.
- **16.6, Switching off and on:** "On: map a Scheduled **or Posted** card to all parts approved". Drop "or Posted".
- **2.2, "When the trial ends or is switched off":** "switching back on restores the versions and the trial can run again". Add "unless the card is Posted (Q-W)".
- **3.3, write order (5):** "The same applies to **Clear's Posted to Scheduled** and to Unschedule". Clear now goes Posted to the route before Schedule (For SMM Approval). Rewrite it so, and keep the same three-entry `steps_done`.
- **Step 1a:** "the swap's checks (… **Posted back to Scheduled** …)". Rewrite as "Posted back to For SMM Approval (Clear)". `policy.mjs:324` (admin and SMM may make any move) covers it, but the bridge clears the card's Kasper and client stamps on that move (`2026-10-01`, the `case` arms of both `update`s). That is wanted here, and step 1a should check it on the throwaway linked card.

Two scope lines are missing:
- the refusal is for `rules = 'v2'` only (the one real Posted card is v1, and test (7) says v1 is unchanged);
- **a v2 card that is already Posted cannot be switched on for the first time either**. Otherwise it becomes a trial that can never start (Start trial and the morning rule both need Scheduled). Use the same plain line.

### M2. Clear on a Posted card: "every version" and what else it resets are not defined
Sidney decided "every version back to For SMM Approval" and "the card back to the route before Schedule". The build needs these lines (none of them reopens his decision):
- **Which versions.** Dropped versions stay dropped (3.4 step 5 already says "a dropped version stays dropped"). The winner and the Not-chosen versions become live again. Every live version's three parts lose their stamps, their "what was approved" values (21.3), the client's pass (`client_pass_at`) and any open "needs the client's OK" flag. Change notes stay in the history.
- **The card.** `winner_letter` null, `scheduled_at` null (already said). Also **`posted_at` and `post_url` cleared**: the analytics check (3.6) and the analytics read the card's `post_url`, and that would still point at the deleted wrong post.
- **The date.** The card keeps its past date, so a later Schedule hits "Starts now: the date has passed" (3.4) at once. Say: "Schedule after a Clear asks for a new date; it opens the date picker."
- **A post that has not gone out yet.** "SyncView cannot un-post" is true of a published post. But the Post tab can schedule ahead, and a Scheduled post there has a Cancel (`299:1689`, `1741`). Upload rows do not record which card they came from (no card field in `instagram-upload`). So the Clear dialog says: "If you scheduled it from the Post tab and it has not gone out yet, cancel it there first (Post tab, Scheduled). A post that is already live has to be deleted by hand."
- **History line:** "Winner cleared by <staff>: every version back to For SMM Approval, the card unscheduled" (23.1's list).

### M3. The placement pushes send Slack cards to the creatives; 3.6 says none go
3.6: "**No Slack goes to the creatives for a version change** (it has no work item)". But before Schedule the placement value moves the real work item, and `notify` sends a status card to the client's creative channel on those moves: `status_tweak` "Needs tweaks" and `status_smm_approval` (`notify/format.ts:13`, `62`; `notify/index.ts:184`, `204`).

So C's change sends "Video N needs tweaks" with no version named. C's fix sends a For SMM Approval card. B's change then sends another. On a five-version trial that is a stream of cards, none of which names the version.

The same is true of every surface that **displays** a work item's status as text, all outside Q-V's three Production surfaces: Workload's rows and popovers, the editors' board (`340`), Today's editor list, SyncMate's `video_cards`, and the urgent ping.

**Fix (text).**
1. Replace 3.6's sentence with: "The placement moves send the creative channel's status card as today. Its text names the version or versions waiting ('Version C needs tweaks'), from the versions read with the card."
2. Add to step 1a: "every surface that shows a work item's status as text (Workload, `340`, Today, SyncMate `video_cards`, the urgent ping, `notify`'s status cards) is listed. On a v2 trial card each shows the versions' statuses or the 'Trial · N versions' line, never the placement value as 'the status' (Q-V)."
3. If Sidney prefers no status cards for trial cards at all, that is Question 3.

### M4. The thumbnail sub-issue is not covered by Q-V's wording
- Q-V and 3.5 talk about "the video task" and "the video sub-issue".
- 2.2's exactly-one rule says "that part", and `route_written` has a `graphic` value.
- S5 gives the thumbnail sub-issue per-version rows (step 5b), but no row status and no "Fixed" action.

As written, the thumbnail sub-issue of a trial card shows the placement value as its status, and a designer has no per-version way to say a thumbnail is fixed.

**Fix (default applied, no new button).** In 3.5 and 24.4, say: "The thumbnail sub-issue mirrors the video sub-issue: each version's thumbnail status on its row, with 'Fixed / New thumbnail ready' (`version_new_cut` with `part = thumbnail`); the exactly-one rule applies to it with the thumbnail part." Add the `part` argument to step 2's `version_new_cut`. Today `staffAllows` already lets a creative call it (`logic.mjs:52`).

### M5. The one-time settle has no owner and is not limited to v2
2.2: "**the first v2 read settles the card once** through `swap_begin` with `direction = settle`". The settle writes the card's thumbnail, caption and call to action, and the link and graphic through `production-write`. `trial-reels` writes no calendar row (7.2), so a page must do those writes. But the first v2 read can come from places that cannot:
- the client's link (a client key);
- an editor's Production page (a creative key; `staffAllows` gives creatives no `swap_begin`);
- the morning rule.

In the same only-if-null write, `card_letter` is set to `mainLetter`, which is not A here. From that moment, inherited fields read A's row (Q-U), and A's row is empty until the settle runs. So until a staff page comes by, every inherited thumbnail and caption on that card reads as empty.

The text also never says the settle is skipped when `rules` is decided `v1`. A Posted or on-trial card the old Drop moved would then be changed, against "v1 keeps today's behaviour exactly".

**Fix (text).**
1. "The settle runs only on a card decided `v2`."
2. "It is begun only by an SMM or admin page. Until it is `done`, the card counts as pending (16.3). While pending, inherited fields read the card's columns as A's (the v1 reading), so nothing reads empty."
3. Step 1a's count of such cards also says how many are on real clients.

### M6. Step 4 starts pushing placement to the work items, but Production shows per-version statuses only from step 5b
Step 4 ships the route writer's pushes. Step 5b ships "each version's own status on the parent, the list row, the video sub-issue and each Assets box row". In between (steps 4 and 5, about a week by the plan's own estimate), the test client's trial cards show the placement value as the status in Production, which Q-V forbids. And step 4's "What Sidney can click" never looks at Production.

**Fix (text).**
- Move the **display** half of Q-V into step 4: each version's status line on the parent, the list row and the video sub-issue, with H2's `list_many` read and its loading rule.
- Step 5b keeps the editor's **actions** ("Fixed / New cut ready" on every row, "Which version did you fix?", the thumbnail rows).
- Add to step 4's click list: "open the test card in Production: no overall status, each version's own."

---

## LOW

1. **"A person's move never changes a version" survives in three places:** 21.4's body ("never changes any version's parts"), the 5b row ("a person's move never changes a version"), and 3.5's last bullet ("changed only by that row's 'Fixed / New cut ready' action and by the card"). Add Q-V's exception (exactly one version waiting) to each.
2. **2.2's Production reader row** (also in H2): it is the first table a builder reads. Fix it with H2.
3. **SyncMate's refusal keys on `rules = 'v2'` only.** On a card whose `rules` is still null, the studio can write `on trial` (`trialreels.mjs:129-135`). The first v2 read then decides `v1` ("has a version on trial", 2.2), so a studio call before the flag's first read pushes the card onto the old rules. Refuse when the client's `trial_versions_v2` is on and `rules` is null or `v2`.
4. **"Which version did you fix? B · C"** calls `version_new_cut` per version and per part (M4). Say that the line's buttons are exactly the rows' own actions, so there is one write path.
5. **History lines** missing from 23.1's list: Clear winner (M2), "Marked fixed by a move in Production" (H3), and "Not switched on: the card is Posted" (the refusal is not a write, but the attempt is worth one line for Sidney's checks; optional).
6. **16.3, dead links:** "before a Clear, **A's** are" checked, and "the version named in `swap_record.before` (**Version A**)". Write "the version named in `swap_record.before.card_letter`".
7. **The Clear dialog and Kasper.** 21.8 says Clear is for SMM and admin. `production-write` lets only admin and SMM keys make the Posted to For SMM Approval move (`policy.mjs:324`). Say that Kasper does not see Clear unless his key is an admin key, so the mockup does not show it on his board.

---

## Review boards

**The client's review link (24.1).**
- Correct: after Scheduled only the needs-client Approve, every answer through `answer`, the held queue, the caption as "Ask for a change".
- **After a Clear (Q-W):** the client must see "Your team is updating Version B" on every version until the team approves again. As written, `sentOnWhole` on a card still reading Posted makes every version `ready` for the client (H1). Add to 24.1: "After Clear winner, the client sees the trial again only when a version reaches Client Approval through the team."
- After a person moves the work item to Client Approval in Production, no unreviewed version may become answerable (H1).

**Kasper's Review Session (24.2).**
- Correct: the writers, Drop on the card's version with its target rule and Scheduled refusal, Redo keyed by letter, the Frame notes link.
- **His listing depends on `kasperOnRoute`.** With the card status as a placement value, a version can skip him silently (H1). The per-part `kasper_skipped` flag fixes that. His board then lists a version while any of its parts waits for him and is not `kasper_skipped`.
- No Clear on his board unless he holds an admin key (L7).

**The SMM's Review tab (24.3).**
- Correct as written.
- After a Clear, every live version is back in the SMM's queue at For SMM Approval. That is what Sidney decided, and the test in 23.1 (0) should also check the SMM tab lists them.

## SyncLinear

- **The list:** needs H2's `list_many` read and the loading rule. Otherwise it draws the placement value or nothing. Grouping and the board's columns use the placement value (correct, and the only place it is used).
- **The parent's issue page:** shows each version's least-advanced part (H2) instead of "Trial · N versions" alone, and "Open in Calendar" as today.
- **Sub-issues:**
  - the video sub-issue as Q-V;
  - the thumbnail sub-issue mirrored (M4);
  - the status control on the sub-issue is Question 1.
- **The Assets box:** each row's status and "Fixed / New cut ready" (step 5b). The card's row's Edit is disabled while any marker is pending, including `drop` and `settle`, as written.
- **Rename:** unaffected. Clear, Drop and settle change no title.
- **Status sync:**
  - the bridge stays a trigger;
  - a person's move is known only from a bridge row after `route_written.at` (H3);
  - Clear's move Posted to For SMM Approval clears the card's Kasper and client stamps in the bridge, which is wanted (M1);
  - the creative channel's status cards fire on placement moves (M3).
- **Workload placement:** correct (one column per work item from the placement value). Its status text must follow Q-V (M3).

## The journeys

- **SMM:**
  - Switch on, Add, approvals, Schedule, the morning start, Pick: fine.
  - Switch off and on before Posted: fine.
  - Posted: refused, as Sidney decided, but test (4) says the opposite (M1).
  - Clear on a Posted card: the versions route to the client instead of to the SMM (H1). The card keeps the deleted post's `post_url` and a past date (M2). A Post-tab post still scheduled is not mentioned (M2).
- **Kasper on a Mac:**
  - Approve, change, Redo, Approve after tweaks and Drop on the card's version: fine.
  - With the placement value at Client Approval, a version can skip him (H1).
- **Client on a phone:**
  - Before Scheduled and after Scheduled: fine.
  - After a Clear, or after a Production move to Client Approval: can be offered Approve on unreviewed versions (H1).
- **Editor:**
  - "Fixed / New cut ready" on C's row: fine.
  - Moving the sub-issue with one version waiting: fine.
  - After a failed push plus a rename, the work item freezes in a stale column (H3).
  - The creative channel gets unnamed "needs tweaks" cards for each version's change (M3).
- **Designer:**
  - The thumbnail sub-issue has per-version rows, but no status and no "Fixed" on them (M4).
- **Sidney:**
  - Clicks on the test client only.
  - Between steps 4 and 5b he would see the placement value as the status in Production (M6).

## Data safety and races

- **Covered well:** one swap attempt at a time with takeover and Finish / Put back, the stale-save guard with `swap_count`, the robot skip including a pending marker, expected revisions, the held queue, the Drop and settle directions.
- **Still open:**
  - the person's-move evidence and the retry (H3);
  - the new writes inside reads not held while a marker is pending, and not idempotent (H3);
  - Clear's routing through `sentOnWhole` (H1);
  - the settle's owner and its empty window (M5);
  - `post_url` after a Clear (M2).

## Each build step on its own

- **1a:** add the seven `cardStatus` sites (H1), every surface that shows a work item's status as text (M3), the bridge-row evidence check on the throwaway linked card (H3), and Clear's Posted to For SMM Approval move (M1).
- **1a-bis:** `kasper_skipped` lives inside `parts`, so no new column; the list of ten stands. Add H1's unit tests.
- **1b, 1c:** as written. With H1, the client gates in 1b also stop reading `sentOnWhole` on v2.
- **2:** `version_new_cut` takes `part` (M4). SyncMate's refusal also covers `rules` null (L3).
- **3:** stands alone, as written.
- **4:** the Production **display** of Q-V moves here (M6), with the `list_many` read (H2) and the bridge-row rule (H3).
- **5:** Clear's full reset list (M2), the settle's owner (M5), and Q-W's switch-on refusal including the first switch-on of a Posted v2 card (M1).
- **5b:** the editor's and the designer's actions (M4), the `245` header rewritten.
- **No step leaves a real client half-done**, provided the `v2` scoping stays as written: H1's change is v2-only, and the settle is v2-only (M5). Steps 1b and 1c are the only ones that reach every client, and their v1 regression tests cover them.

---

## Is the plan ready for mockups?

**Not yet; one short text-only revision (19) first.** Three findings change what a screen shows:
- Production's list row and parent need the loading state and the per-surface rule (H2). The thumbnail sub-issue gets the same rows as the video one (M4).
- The Clear dialog gains the Post-tab line and opens the date picker on the next Schedule (M2).
- The client link after a Clear shows "Your team is updating" on every version (H1).

The questions below decide one control on the sub-issue and whether Clear is reachable after a switch-off. Everything else is wording. Once revision 19 applies these and Sidney answers, the mockups can start.

## Questions only Sidney can answer (each has a default; fewer buttons wherever possible)

1. **The status control on a trial card's sub-issue in Production.** Production shows each version's own status (Q-V), but the work item still sits in a column, and people move it by hand.
   - Example: the video sub-issue shows "A · Approved B · For SMM Approval C · Tweaks needed". Today its header also has the one status menu an editor clicks.
   - **Recommended default:** keep that one menu, labelled **"Column"** on a trial card, so dragging and the menu still work. The version line beside it is the status. No new button.
   - The alternative: hide the menu on trial cards. The item then moves only by dragging on the board, and the "exactly one waiting" rule applies only to drags.
2. **Clear winner after the trial was switched off with a winner.** Q-W makes a Posted card's switch final. Switching off with a winner is allowed (S-B), and then the trial strip is gone.
   - Example: Version B was posted, the SMM switched the trial off, and the next day the team finds B was the wrong cut.
   - **Recommended default:** "Clear winner" stays in the card's menu while a winner exists, even with the trial off. Clear also switches the trial back on, since its only use is to run the trial again. No new button.
   - The alternative: switching off with a winner is final, and the team makes a new card.
3. **Slack's "needs tweaks" card for a trial card's version change** (before Schedule, when the placement moves the work item).
   - Example: Kasper asks for a change on Version C's video. The creative channel gets a "needs tweaks" card for the video.
   - **Recommended default:** keep the card and name the version in it ("Version C needs tweaks"). Nothing new to click.
   - The alternative: no status cards for trial cards. Editors find version work only on Today, as the plan said before.

Defaults I applied without asking (no product change):
- H1: on v2 no helper reads the card status, and Kasper's place on a version's route is stored per part.
- H3: the bridge row is the only evidence of a person's move; only staff pages retry a push.
- M2: Clear also clears `post_url`, `posted_at`, passes and needs-client flags; dropped versions stay dropped; the next Schedule asks for a date.
- M4: the thumbnail sub-issue mirrors the video one.
- M5: the settle is v2-only and begun by a staff page.
- M6: Q-V's display ships with the pushes in step 4.
