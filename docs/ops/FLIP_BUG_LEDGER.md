# Flip bug ledger — what the graphics flip cost, and what the video flip should avoid

Created 2026-08-20, four days after the graphics flip, from the 36 pull
requests merged since it. Written for **one reader: whoever runs the VIDEO
flip.**

The graphics flip itself went cleanly. Everything in this file happened
*after* it — in the four days it took to make the flipped world actually
work. None of it was visible from the flip runbook, because a runbook
describes the switch, not the estate the switch lands on.

**The organising question for every entry is the last line: `RECURS FOR
VIDEO?`** Three answers:

- **NO** — the fix was generic and already covers video. Listed so nobody
  re-diagnoses it from scratch at 2am.
- **YES** — the fix was correct but the *data* or *configuration* behind it
  is per-team, so the same work has to be repeated for video.
- **NEW** — video has no graphics precedent. These are the dangerous ones,
  and §3 explains why they exist.

Related files: `FLIP_RUNBOOK.md` (how to throw the switch),
`PRE_FLIP_HEALTH_CHECK.md` (the gates), `OPEN_REPAIRS.md` (live open items),
`EXECUTION_LOG.md` (every deploy and owner-run SQL).

---

## §0 — The video-flip pre-flight, in one page

Everything below, reduced to what to actually do. Do these **before** the
flip, not after.

**Measure first, in this order.** Each of these is a population the flip
makes live in one instant, and each has a graphics precedent where the
number was the whole story.

1. **Which gates begin applying to video work, and how much video data
   fails them today?** The graphics flip nearly refused every designer on
   day one because 1,972 of 2,009 active graphics deliverables carried no
   canonical `file_url` and the approval-artifact gate demanded one.
   *Measured 2026-08-20: 2,918 of 2,921 active VIDEO deliverables likewise
   carry no `file_url`.* The good news is that the gate is explicitly
   `team === "graphics"` only (`production-write/index.ts`), so this exact
   gate does not fire — but the **method** is the lesson: enumerate every
   gate whose condition names a team or an authority, and run its predicate
   against the live video population before flipping, not after.
   - *Swept 2026-08-24.* Every `team === "..."` and authority-keyed predicate
     in `production-write`, `linear-inbound`, `b1-linear-backfill`, both
     reconcilers and the browser was enumerated and run against live video
     data. Results: the two assignee-pool gates PASS (graphics has exactly one
     `default_for_team`, video has 4 editors carrying a Linear id — the
     `video_assignee_pool_unavailable` 409 cannot fire today); the
     graphics+`smm_approval` 409 does not bind video; the file-url approval
     gate stays `team === "graphics"` only; the create gates are closed for
     both teams outright (item 7), so the E2 steering class is gone rather
     than re-aimed. The remaining team-shaped behaviour changes at F1 are the
     DESIGNED ones: the browser's 11 `authority[...]` routing reads flip video
     to native, and `linear-inbound` goes detect-only for video. What is left
     of this item is watching the FIRST DAY, not finding more gates.
2. **How many cards will lose their edit path?** After the graphics flip,
   12 cards showed greyed-out thumbnail controls reading "Link a Linear
   sub-issue first" because linkage backfill was blocked by an authority
   rule (#1075). *Measured 2026-08-20: 78 fillable linkage slots — 74
   calendar video, 4 calendar graphic.* Run the linkage backfill to zero
   **before** the flip; it invents nothing, it just resolves a link the card
   already carries to the deliverable that link already names.
   - *Re-measured 2026-08-24 (identifier-match, not URL-suffix — the suffix
     form under-counts): 78 → **3 video, 0 graphics**.* The backfill has
     effectively run to zero on its own. Three cards remain whose link names a
     deliverable that exists; clear them before F1 and this item is closed.
3. **How many cards have a Linear link but no native row at all?** *Measured
   2026-08-20: 110 for video, 104 for graphics — but break them down by
   status before drawing any conclusion.* Of the video 110: **75 Posted, 21
   N/A, 12 Approved, and 2 In Progress.** Only the last two are live work,
   and both already have their deliverable — the card just fails to record
   it, which item 2 fixes. The other 108 are finished or deliberately
   not-applicable and want no action at all.

   *This entry originally read "110 cards whose Linear edits will be
   discarded" and drove a recommendation to deal with them before the flip.
   That was a raw count treated as a work list. The status split is one
   query and it turned a 110-row migration into a 2-row no-op.*
   - *Re-measured 2026-08-24: video 110 → 85, split 75 Posted / 9 Approved /
     **1 In Progress**.* Still a no-op class; the one live card is item 2's
     last stragglers' neighbour, worth one look in the same pass.
4. **How much Linear traffic is about to stop having any effect?** Count
   `mirror_in_status_change` — a Linear-originated status change the system
   **actually applied**. *In the week before the graphics flip: 1,406 on
   graphics rows, 2,105 on video rows. Since the flip: graphics 8, video
   1,948.* The graphics flip took ~1,400 applied changes a week to zero. The
   video flip will do the same to **~2,000 a week**. This is the number to
   plan against — see §1 for why the more obvious counter is wrong.
   - *Re-measured 2026-08-24: video is now **2,542 applied changes in the
     last 7 days** — the number has grown ~20% since this was written. Plan
     against ~2,500, and re-measure the week of the flip; the day-one support
     load scales with it.*

**Fix or decide before flipping.**

5. **B1's remaining job.** `batchAllowed` requires every issue in a batch to
   be Linear-authoritative. Once video flips, no batch qualifies and the
   importer imports nothing. Decide deliberately whether B1 retires, narrows
   to a legacy sweep, or is left running as a no-op — and say so in the
   runbook. Do not let it be discovered.
   - *Corollary found 2026-08-24, precision fixed in review:* B1 writes the
     `b1_incremental_refresh` dead-man heartbeat (97 beats in the last 26h),
     and the heartbeat step runs `if: always()` with `ok` bound to the job's
     real outcome — so the three possible futures page DIFFERENTLY, and the
     wording of the decision has to say which one is meant. **Disable the
     workflow** → the heartbeat stops and the watchdog pages a MISSING
     MONITOR within 4 hours. **Leave it running as a red no-op** (importer
     step failing) → the heartbeat says `ok:false` and the watchdog sends one
     latched RAN-AND-FAILED page. **Narrow it to a deliberate green no-op**
     (exits 0 having imported nothing) → quiet, forever, which is its own
     hazard: a monitor that can never again say anything. Whatever is chosen
     for B1, choose the lane's fate in the same sentence — the false alarm
     fires on DISABLING, not on narrowing.
   - **OWNER RULING 2026-08-24, two decisions in one.** (a) *The import:* "we
     should import them — once — and from now on everything active should be
     in SyncView." (b) *B1's future:* "B1 would just be in case someone
     forgets and creates a sub-issue in Linear. We import it, but that's it."
     Together that is a coherent new job description: **B1 stays running after
     the flip as the stray-catcher** — anything created in Linear gets pulled
     into SyncView, continuously, and the one-time import largely dissolves
     into the new role's first passes over the existing 655. Keeping it
     running also keeps the `b1_incremental_refresh` heartbeat honest, per the
     corollary above. NOT YET IMPLEMENTED — and review of the first draft of
     this ruling (PR #1123) caught two holes in it, so the pre-F1 work is FOUR
     pieces, not two:
     1. *Re-scope the authority gate.* `batchAllowed` / `deliverableAllowed`
        require the team to be LINEAR-authoritative, which after the flip is
        nothing.
     2. *Widen the operational filter* (`linked || alreadyTracked || created
        >= cutoff`) to "active ⇒ import".
     3. *A full-traversal path for the standing 655.* The filter change alone
        CANNOT import them: `buildIncrementalPlan` calls
        `loadIssues({ updatedSince: changedSince })` before any filter runs,
        so an issue that has not changed since the cursor is never even
        loaded — and the existing `mode=full` lane refuses outright now that
        graphics is SyncView-authoritative (`assertFullApplyAuthority`
        demands BOTH teams on Linear). Without an explicit full sweep or
        cursor reset, "the import dissolves into the new role's first
        passes" — the first draft's claim — is FALSE for every unchanged
        issue, which is most of them.
     4. *Parent-map synthesis.* `batchRowsFor` builds `linear_parent_ids`
        solely from the teams present in the imported group, so a video-only
        Linear batch imports as a video-only map — the stray-catcher would
        keep regrowing item 16's class after the flip, not end it. The
        synthesis mirrors what the modern native shape and the item-16
        backfill both already do: one parent entry serves both teams,
        `owner_team` recording whose board it lives on.
     All four need the same care as any B1 change: the label-relation and
     self-echo lessons in this file all came from this importer.
6. **Every gate phrased "the Linear-authoritative team(s)".** After the
   video flip there are none. `PRE_FLIP_HEALTH_CHECK.md` item 1 binds
   exactly that phrase and will pass vacuously. Re-specify it first, or the
   health check stops meaning anything on the exact day it matters most.
   - *Verified 2026-08-24: the replacement text is already written, in full,
     as the PRE-REGISTERED block inside item 1 itself (growth-per-team, both
     teams, repairs recorded in the same run). Applying it at F1 is a paste,
     and the original clause is to be marked superseded, not deleted. Nothing
     more to prepare here.*
   - **Re-specified 2026-08-22, pre-registered rather than applied.** Item 1
     now carries the replacement text to apply AT F1(video): report both
     teams' `outbound_diff_count` as context, and gate on unexplained GROWTH
     per team instead of on an absolute zero no detect-only counter can ever
     reach. It is written down so it is a paste, not a redesign, on the day.
     Still owed on that day: actually applying it.
7. **The Production create dialog's Video door.** `index.html:47948` says in
   so many words: "this door because Video is still Linear-authoritative;
   revisit it". At the video flip that comment becomes false. Close the
   door or re-scope it, and remember the graphics precedent (#1078): the
   dialog *preselected whichever team is SyncView-native*, which after the
   flip actively steered people into creating orphans.
   - **ATTEMPTED AND REVERTED 2026-08-22 — and the choice is sharper than it
     looked.** Deriving the picker from live authority closes the door with no
     flip-day edit, but hiding an option is not gating a draft: the submit path
     reads `draft.team` directly and every loose draft defaults to `video`.
     Adding the submit gate then made parent-mode creation unreachable in EVERY
     configuration — a loose graphics context resolves to Video by design, so
     refusing Video leaves no open door at all. `prod-write-gateway-browser.js`
     simulates this flip precisely so the modal choreography stays testable, and
     the gate cost ~15 assertions of coverage. Backed out in full.
     What this established: parent-mode creation here is **only ever reachable
     after a flip**, so this item is not cosmetic — choosing nothing means the
     door opens by itself on flip day. Full record and the two options in
     `OPEN_REPAIRS.md` item 31.
   - **INVESTIGATED 2026-08-23, still not implemented. Three things worth
     knowing before the ruling.** (a) Closing by MODE — refuse when there is no
     parent — is orthogonal to both rulings that killed the team-level attempt:
     it never touches the picker, never touches the `|| 'video'` default, never
     touches the raw parent pin. One line in `_prodCreateGateText`, and the four
     create-related UNIT suites all still pass under it. (b) The reverted
     attempt's "~15 assertions" was an estimate, not a measurement. A
     mode-level closure aborts `prod-write-gateway-browser.js` at its FIRST
     failing assertion — that suite is strictly fail-fast, one `try` around the
     whole scenario — and **114 `expect()` calls from that point to EOF never
     execute.** The suite must be re-pointed at a graphics parent in the SAME
     change, not after it. (c) **It does not close the orphan class.** This
     dialog makes the MILD orphan: a native row with `card_id: null`, visible in
     SyncView, visible in Workload, assignable, just absent from any review
     queue. `GRA-7109`'s class is an issue born in Linear with no native row at
     all — invisible and unrepairable — and video is carrying **670** of those.
     Closing the only SyncView door for cardless work is a behavioural bet that
     nobody needs it; anyone who does will do it in Linear instead, where it
     becomes the worse kind. If the goal is the orphan class, the work is #9
     (tell the humans) plus the pre-flip import, not this dialog.
   - **CLOSED 2026-08-23 — the owner ruled BOTH modes shut, and the measured
     cost was zero.** Ruling: *"a sub-issue is a card, not a parent issue ... we
     shouldn't be able to do parent issues or sub-issues because we don't want
     to do posts in sync linear that are not in the calendar."* He was right on
     the fact the earlier analysis had wrong: `production-write` hardcodes
     `card_id: null` in the create insert for BOTH modes, so a sub-issue created
     under a parent that HAS a card is just as cardless as a top-level one.
     Closing only the top-level door would have left the actual live door open.
     **Cost, measured rather than argued:** a Production-tab create leaves a
     unique signature (`origin='manual'` on the row + `legacy_parity=false` on
     its outbox intent). Every row in the live outbox carrying it: **53, all
     `test_only`. ZERO for a real client, ever.** The discriminator is not
     vacuous — those 53 prove it matches. So this closed a door nobody has ever
     walked through. This item no longer needs anything on flip day.
8. **F40 stays a real gate.** It was demoted to CONTEXT for graphics only
   because its repair lane closed at the graphics flip. `PRE_FLIP_HEALTH_
   CHECK.md` item 10 says explicitly it "remains a real gate for the future
   VIDEO flip". Do not let the graphics demotion be read as a general one.
   - **Measured 2026-08-22: video is NOT READY — 5 unprovable rows.** Three
     carry live 2026-08-24 deadlines and are repairable ONLY before F1; two are
     the same pre-cutoff shape as the accepted graphics floor. Graphics itself
     regressed past its floor in the same reading. Full numbers, causes and the
     dispatch that repairs the three: `OPEN_REPAIRS.md` item 31. The gate's own
     repair instruction was also wrong — it prescribed `mode=full`, which has
     been unable to apply since the graphics flip.
   - **Re-measured 2026-08-23: both teams READY, 0 unprovable — read the reason
     before trusting it.** The three with live deadlines are genuinely repaired
     (still Todo, still audited, now provable), so the clock on this item has
     stopped. The remaining eight rows did not get repaired: **every one of them
     was Backlog**, and Backlog stopped counting as active work in Workload the
     same day, so the page no longer loads them and this gate no longer audits
     them. That is a legitimate narrowing — none of the eight has a due date, and
     a row the page never draws cannot lose one there — but it is a change of
     scope, not a repair. The `graphics: 5` floor is retired in the same change:
     its members are outside the audited set now, so the allowance could only be
     spent on five FUTURE failures. Full before/after in `OPEN_REPAIRS.md`
     item 31.
9. **Tell the editors before, not after.** See §1. This is the single
   highest-leverage item in the file and it costs nothing.
   - *Owner confirmed 2026-08-24: he will tell the editors at the flip to stop
     using Linear for video edits. The message's content is drafted in the
     register discussion: from flip day, status/deadline/assignee changes
     happen in SyncView; Linear still shows the work but edits there stop
     flowing back (~2,500 applied changes a week go silent).*
10. **Book the week.** Twelve edge-function deploys, eight hand-applied
    migrations and 36 merged PRs followed the graphics flip. Plan for the
    same, not for a quiet Monday.

---

## §1 — What the graphics flip actually cost

Flip executed **2026-08-16**: `linear_outbound_enabled` → `live` at 19:36Z,
`prod_authority` → `{"video":"linear","graphics":"syncview"}` at 19:58Z.

In the four days that followed:

| | |
|---|---|
| PRs merged | **36** (#1070–#1105) |
| Edge-function deploys | **12** (#7–#18); `production-write` v34 → v44, `linear-outbound` → v42 |
| Hand-applied migrations | **8** — five of them successive revisions of the *same* append RPC (v2 → v6) |
| Longest single outage | **~5 hours** of no Linear→SyncView import at all (§2-A1) |
| Longest single stranding | **20 hours** — one reviewer's tweak invisible in Linear (§2-B1) |

### The number that matters most — and the one that looks like it and is wrong

**The wrong one first, because it is the one you will reach for.** After the
flip, every inbound Linear webhook for a SyncView-authoritative team is
recorded as `foreign_write_detected`. It is tempting to read that count as
"edits people lost". *It is not*, and the first draft of this file made
exactly that mistake. Corrected by audit:

| Day | `foreign_write_detected` | issue-shaped | comment-shaped | what it actually was |
|---|---|---|---|---|
| 2026-08-16 (flip) | 661 | 661 | 0 | **all 661 in a single hour, 23:00Z, all carrying `cycle` 187 starting `2026-08-16T23:00:00Z` — Linear's own cycle rollover. Zero human edits.** |
| 2026-08-17 | 119 | 110 | 9 | 14 correlate with our own mirror writes |
| 2026-08-18 | 30 | 17 | 13 | 6 correlate |
| 2026-08-19 | 88 | 73 | 15 | 11 correlate |
| 2026-08-20 (partial) | 34 | 31 | 3 | 10 correlate |

Three separate reasons the raw count overstates loss:

- **Comments are not discarded at all.** `handleCommentEvent` calls
  `persistProductionComment` *before* `recordDetectOnly`
  (`linear-inbound/index.ts`), so a comment written in Linear on a graphics
  issue **is kept**. 40 of the 932 events are comments.
- **Linear fires an issue-update webhook for its own housekeeping** — cycle
  assignment, project moves, sub-issue rollups. That is the entire flip-day
  spike, and it is why "day 4 was three times day 3" is noise, not a habit
  curve.
- **58 events are provably our own writes coming home** — the issue clock is
  within two seconds of an acknowledged `linear_result.updated_at` on one of
  our own `written` outbox rows (the same method as §2-B1's 81/81 audit).

**The right number:** count what the system was *applying* before the flip
and stopped applying after. `mirror_in_status_change` is a Linear-originated
status change that took effect.

| | week before the flip | since the flip |
|---|---|---|
| **graphics** | **1,406** | **8** |
| **video** | 2,105 | 1,948 *(still authoritative)* |

That is the real cost and it is bigger than the bad number implied: **~1,400
Linear-originated status changes a week stopped having any effect** the
moment graphics flipped, and video is running at ~2,000 a week today.

What survives from the wrong version is the part that matters most. Nothing
in the system tells the person their edit did nothing — it is a silent no-op
on their screen. The residue proves people are still doing it: the shadow
audit still shows **29 graphics rows** in live disagreement with Linear four
days on. **Announce the flip to the people who work in Linear, by name,
before you throw the switch** — that single action would have prevented more
real harm than any code fix in this file.

> **Method note, and the reason this section was rewritten.** The first draft
> reported the raw `foreign_write_detected` count as discarded human edits.
> A PR review challenged it, and the challenge was right. Two of the three
> corrections above (cycle rollover, own-write echo) were found only by
> classifying the events instead of counting them. *A count of events is not
> a count of consequences* — which is, unhappily, the same lesson as §4-2.

---

## §2 — The ledger

### A. Authority-rule collisions
*A rule that read "the team must be Linear-authoritative" and silently
became wrong for the flipped team. This was the largest class by far.*

**A1. The importer jammed completely — 5 hours, no imports** *(#1077)*
`batchAllowed` requires **every** issue in a batch to be Linear-authoritative.
After the flip, an ordinary mixed week — one video issue and one graphics
issue under the same parent — failed that test, so the batch was withheld.
Its video child still passed on its own, so B1 inserted a deliverable
against a parent that was never created: `23503 … violates foreign key
constraint`. The throw aborted the *whole run*, so ~30 other permitted
writes never landed either. The first mixed batch created after the flip
jammed the importer permanently. Owner was getting alert emails; the cause
was invisible because the lane keeps its detail off the public log.
*Fix:* withhold the orphan, count it in `gated.orphan_batch_deliverables`,
let the rest of the plan apply.
**RECURS FOR VIDEO? NEW — worse.** After the video flip *no* batch is
Linear-authoritative, so this is not a jam but a total stop. See §0-5.

**A2. Linkage backfill blocked — 12 cards uneditable** *(#1075)*
Two different writes shared one authority rule. Linkage backfill merely
fills a null `*_deliverable_id` from the card's own existing Linear link —
it invents nothing — but it was gated on Linear authority, so after the flip
twelve cards showed "Link a Linear sub-issue first" on a thumbnail whose
deliverable had existed the whole time. *Fix:* split the rule. Backfill is
authority-agnostic; archive promotion (which *concludes* from Linear state)
keeps the requirement.
**RECURS FOR VIDEO? YES — as data.** The rule is fixed, but 25 video cards
are in that state today. §0-2.

**A3. The linkage precondition vetoed its own repairs** *(#1076)*
The strict precondition counted **every** failing slot in the system —
367 failures, overwhelmingly stale drill fixtures — against a plan of 10
real repairs, and refused to write any of them. It would have kept refusing
for as long as a single stale fixture existed anywhere, which is
permanently. Three people were blocked behind those repairs that day.
*Fix:* a failure blocks only when it lands on a slot this run intends to
write. A sibling fix (#1077) did the same for the post-write sweep, which
was reporting successful repairs as failures.
**RECURS FOR VIDEO? NO.**

**A4. The health check's own gates became unclearable** *(#1086)*
For a SyncView-authoritative team the reconciler is detect-only, so the
graphics component of `outbound_diff_count` counts Linear edits the native
store deliberately ignores — it can never be driven to 0. Same for F40,
whose repair lane closed at the flip. Both produced a guaranteed daily FAIL
no action could clear, which is exactly how a report becomes something
people skim. *Fix:* both moved to CONTEXT with growth rules.
**RECURS FOR VIDEO? NEW.** Item 1 now binds "the Linear-authoritative
team(s)" — after the video flip, that set is empty. §0-6.

**A5. The nightly drill died on its own echo** *(#1072)*
Post-flip, inbound records every webhook for a SyncView-authoritative team
as a detect-only `foreign_write_detected`, so the unfiltered count the drill
gated on can never be 0 again. *Fix:* subtract exactly the drill's own
comment ids; anything else still trips it.
**RECURS FOR VIDEO? NO** — the exclusion is generic. Re-verify it fires on
the video lane, which has never produced a foreign write before.

**A6. Four polish suites pinned the pre-flip world** *(#1087)*
`prod-structure-subset` pinned the pre-flip authority chip label;
`prod-write-gateway-browser` choreographed a dialog the flip had made
Video-only. Red since 2026-07-23 and masked by other reds.
**RECURS FOR VIDEO? YES.** These suites now encode *mixed* authority.
~~Useful detail: `prod-write-gateway-browser` already **simulates the future
video flip** through its own `serverAuthority` mechanism — that simulation
is a written rehearsal, and it is the first thing to run when video flips.~~
**Stale as of #1121 (2026-08-24): that simulation was deliberately DELETED**
when the suite was re-pointed at the live mixed authority — a suite proving
a simulated future had been the thing masking real breakage, so it now
proves the present instead. What replaces the rehearsal: on flip day the
suite is this item's work list, not its safety net. Known flip-day edits,
recorded now so they are a paste later: the vid-fixture ROW-WRITE assertions
(status/due/assignee refusing with the Linear-authority sentence) stop being
true at F1 — flip THOSE to writable expectations in the same PR as the flag.
**The CREATION assertions are the opposite: do not touch them.** The owner
closure is authority-independent, and the suite's own step 1d already
simulates `video: syncview` and proves both creation doors STAY SHUT after
the flip — that assertion is the closure's guard, and "flipping" it would
mean reopening a door the owner ruled closed. (First drafted wrong here, as
"flip the Add-Sub gate too"; caught in review of the PR that added this
note. The distinction: authority refusals expire at F1, owner rulings do
not.)

---

### B. Our own writes read as somebody else's

**B1. The mirror vetoed its own writes — 81 of 81** *(#1099, deploy #18)*
A SyncView action carrying a comment *and* a status enqueues two outbox
rows. Delivering the comment bumps `issue.updatedAt`; the status row then
read that bump as "a human edited Linear more recently" and dropped itself
as stale. One reviewer's tweak was stranded **20 hours** — SyncView said
Tweaks Needed, Linear said For Kasper approval — until a human flipped
Linear by hand.

The audit is the part worth keeping: **81 of 81** stale status drops carried
a veto clock byte-identical to the acknowledged `updated_at` of an earlier
*own* written row for the same issue. Not one was a human edit. 31 were
never followed by a later successful write and were still live divergences
across 18 issues and 10 clients.

This bug also masqueraded as three other bugs. It was reported repeatedly as
"Kasper's cards reappear" and as data loss, and a fix aimed at the wrong
cause was written, reviewed, refuted and reverted before the real one landed.
*Fix:* `decideConflict` discounts an issue clock at or before our own latest
acknowledged write. Verified: 91 self-echo drops before, **0** after.
**RECURS FOR VIDEO? NO** — but **re-run the audit on video's first day.**
The method (compare every stale drop's veto clock against our own receipts)
is a one-query check and it is how this was found.

---

### C. Parent/child topology

**C1. The graphics parent silently adopted the video parent** *(#1081)*
`batchParentId` fell back to `parents[0]` when it found no team match. Two
failure modes, both seen in production hours apart. With different projects
per team: terminal refusal, and two thumbnails for a live client failed for
two hours against a parent that could never exist. With the same project:
**no error at all** — the thumbnail is created in Graphics, nested under a
Video parent. The commit's own line is the lesson: *"A hard failure is
recoverable; this is not, and it is the reason the defect survived."*
**RECURS FOR VIDEO? NO** (team-labelled maps resolve nothing for an absent
team), **but its data legacy does — see C3.**

**C2. Appends validated the parent against the asker, not the owner**
*(#1089)* A thumbnail append was refused `batch_parent_mapping_missing` and
the dialog blamed the client's filing, which was fine. The native flow
creates one issue serving every team and stamps `owner_team`; the append
route validated against the team *asking*. This refused a thumbnail append
to **any** batch the native flow created.
**RECURS FOR VIDEO? NO.**

**C3. Legacy single-team parent maps** *(#1104)*
Of 430 active calendar batches, **255 carry a video-only parent map and 132
a graphics-only one** — all predating ONE PARENT PER CARD (deploy #12).
Exactly one could still have succeeded through an outbox dependency the
browser cannot see. *Fix so far is cosmetic and honest:* the picker no
longer offers a batch that cannot parent the chosen post, ranks empty
duplicate twins last, and names the batch instead of blaming the client.
**RECURS FOR VIDEO? YES.** The backfill decision is still open
(`OPEN_REPAIRS.md`). Whatever is decided, decide it *before* the video flip
— the video-only maps are the majority and video is the team about to lose
its Linear-side escape hatch.

---

### D. Migrations

**D1. An RPC written five weeks earlier had never been applied** *(#1088)*
`2026-07-13-production-intake-append.sql` was written and never run. Every
batch append since the picker shipped called a function that does not exist;
the gateway translated `PGRST202` to a generic 500. **Zero batches held a
second native card** — every post ever created had gone through "start a new
batch", and nobody noticed because the failure looked transient.

**D2. A bare `CASE` inside an `IF` refuses to compile** *(#1089)*
PL/pgSQL finds the end of an `IF` condition by scanning for the first
`THEN`, and `CASE` brings its own. Postgres reports `syntax error at end of
input`, pointing at a line that looks perfectly valid. It surfaced in
production because a migration is only ever executed by hand, by the owner.

**D3. An explicit column list silently dropped a new column** *(#1095)*
`batch_write` inserts through a named column list, so `purpose` was
discarded with no error. The symptom would have been "samples create does
not work" with nothing in any log. Caught only because it was proven on a
disposable PG16 first.

**D4. The column-grant trap — a live 401 that pointed nowhere** *(#1097)*
The samples picker returned "Could not load batches", HTTP 401, *permission
denied for table batches* — the whole table, not the column. f34/f53 had
deliberately replaced the table-wide grant with a column allowlist, and
**column privileges are not inherited by columns added later**; PostgreSQL
then refuses the entire statement. The migration **had** been compiled and
behaviour-proven on a real PG16 — *as superuser, with no RLS and no grants*.
Every claim made about the column was true; the privilege governing reach
was invisible to the method.

> **The rule this produced, and the most transferable thing in this file:**
> compiling a migration on a disposable PG16 is **necessary and not
> sufficient**. Prove it **as the role that will run it**, against a replica
> of the real grants. The guard now lives in CI
> (`test/batches-column-grants.js`) and cross-references every `batches`
> column the browser selects *or filters on* against the granted allowlist.

**RECURS FOR VIDEO? D1–D4 are method lessons, not team-specific.** Expect
the video flip to need its own migrations; apply all four rules.

---

### E. Defaults and gates that were only wrong once the team flipped

**E1. The approval gate would have refused essentially every designer**
*(#1069)* Measured on flip day: **1,972 of 2,009** active graphics
deliverables carried no canonical `file_url`, and the gate guarding
`smm_approval` demanded one — with a dialog telling people to reload the
page. Three separate causes: the gate demanded a *file* when the team ships
Frame.io links and Drive folders; the probe demanded media bytes, which no
share URL or folder can return; and it read only `deliverables.file_url`,
settable solely through a source the flip retired **the same day**.
**RECURS FOR VIDEO? NO for this gate** — it is `team === "graphics"` only.
**YES for the method:** §0-1.

**E2. The create dialog steered people into making orphans** *(#1078)*
The Production create dialog writes only the issue hierarchy, so a thumbnail
made there has no card behind it. Its default preselected *whichever team is
SyncView-native* — after the flip, Graphics. Three orphans were created in
one day; all three duplicated existing cards, and one was invisible to the
designer meant to make it.
**RECURS FOR VIDEO? NEW.** §0-7.

**E3. Every submission created both deliverables** *(#1078)*
Video-only and Thumbnail-only existed but sat behind an "Advanced"
disclosure. Result: **60 calendar cards** carrying a video deliverable plus
an empty "Video 1" graphics placeholder nobody asked for.

**E4. New work was born In Progress** *(#1073)*
An editor reported it: *"Subissues are automatically appearing as in
progress even though I haven't marked them."* He was right — nobody had.
Four separate creation paths each stamped `in_progress`. Four copies of a
default is how they drifted from the intent.

**E5. A five-minute asset refresh pre-blocked approval** *(#1074)*
The UI required an asset probe recorded in the last five minutes before it
would even let a designer *select* For SMM approval — duplicating a check
the gateway already does properly. She hit it the moment the flip put her on
that path.

**E6. A state machine nobody had ruled on** *(#1072)*
The picker offered a designer only Backlog and In Progress, so submitting
for approval meant a detour. It was a fail-closed default awaiting an
answer; the answer turned out to be that there should be no state machine.

**E7. `f.io` redirects to `next.frame.io`, which was not allowlisted**
*(#1071)* Every Frame.io artifact died at the redirect. A previous widening
meant to accept Frame.io links was therefore **inert for the exact case it
was requested for**. The link passed every shape check and then failed a
fetch that never completed — the least debuggable shape a refusal has.

**E8. "No asset", then N/A** *(#1089 → #1093 → #1100)*
An inferred "No asset" label read an empty field and made a claim about
intent it could not support; withdrawn. N/A became a real status an SMM
picks — and needed three unrelated guards, each a way it could have shipped
broken: Linear has no N/A state (the legacy push would have burned its whole
retry budget on a write that can never land); it carries no priority (an
all-N/A card would have fallen through the rollup to its `Posted` seed and
reported itself published); and its slug contains a slash, which would have
emitted the unmatchable CSS class `cal-fld-status-n/a`.

Then the reconcilers, which had not been taught: 21 freshly parked
components generated 13 push-N/A-to-Linear corrections plus 9 pull-backs
that would have reverted the SMM's choice minutes after they made it —
together blowing the 15-correction safety cap, so **the 15-minute lane
aborted every run for over an hour** and nothing reconciled, including the
legitimate corrections queued behind the cap.

> **Transferable:** a new status is not a UI change. Every consumer that
> enumerates statuses — the mirror, both reconcilers, the rollup, the CSS
> slug, the queue predicates — is a place it can fail, and the reconcilers
> failed *loudest* by taking everything else down with them.

**E9. Archiving left the sub-issues alive** *(#1080)*
Archiving wrote the card row and nothing else. Measured: of 37 archived
cards carrying deliverables, **33 of their 50 sub-issues were still open**,
several sitting in SMM or client approval — phantom work on real people's
lists, invisible because the card is gone.

**E10. A creative could not fix her own mistake** *(#1084)*
`attachment` was assignee-bound, so a designer who mis-attached a file could
not repair a row that was not assigned to her; only an admin could.

**RECURS FOR VIDEO? E3, E4, E8, E9, E10: NO** — all generic. **E1, E2, E5,
E6, E7: the pattern recurs.** Each was a default or gate written when the
team in question was Linear-authoritative, and each only became visible when
a real person hit it on the first working day. §0-1 is the systematic answer.

---

### F. Queues, saved jobs and the browser

**F1. A refused job re-POSTed forever and blocked every other create**
*(#1086)* One SMM carried an **eleven-day-old** terminally refused job that
409ed on every page load and blocked every later Create Post, with two red
console calls as the only trace. *Fix:* discard after two strikes — resumes
only, 4xx only, never 401/403, never when anything committed, and announced
with the client named.

**F2. A 500 that never counted a strike** *(#1089)*
A job failing with a 500 (D1's missing RPC) was treated as always transient,
so no strike ever counted and nothing on the page could clear it. *Fix:*
server errors strike too, with a larger budget and only on a fresh page load.

**F3. A signed-out recovery copy wedged the browser permanently** *(#1088)*
The copy carried a signature that can never match a freshly composed post,
so every later Create Post hit the pending-conflict error; it could not
clear itself either, and the next sign-out rewrote it.

**F4. The batch parent page showed three red errors on a healthy page**
*(#1084)* The description refresh, the asset prober and the comment thread
all queried by node id — and a batch id has no deliverable row.

**F5. Native sub-issues rendered as top-level issues** *(#1083)*
Parent resolution only mapped among deliverable rows, which was fine while
every parent was an imported issue. A native card's parent exists solely as
a batch, so every natively created sub-issue rendered top-level with an
"Add sub-issue" affordance on something that is already a sub-issue.

**F6. Late link adoption, three times** *(#1080 calendar → #1098 samples →
#1105 placement and repaint)* A native card is written once, at
materialization, taking its Linear URL from the create response — so if the
mirror has not drained by then the card is written with an empty link and
nothing fills it in. Fixed for the calendar; rebuilt for samples; then found
misplaced *inside a catch block*, so it only ran when the page failed to
load. And the calendar twin turned out to be arming a scheduler without
setting the flag it checks, so it adopted links correctly and never
repainted.

**RECURS FOR VIDEO? All NO.** Listed because F1–F3 are the class of bug that
makes the whole app look broken to one person while every dashboard reads
green, and a flip week generates them.

---

### G. Monitoring that told us nothing

**G1. Three of four daily lanes were invisible to the watchdog** *(#1071)*
The heartbeat read fetched a fixed number of recent rows and picked each
lane's newest from that slice — **a row bound cannot satisfy a time
tolerance.** The three ~15-minute lanes emit ~175 rows in fifteen hours, so
every daily lane fell outside the window and was reported "never checked
in". The cost was not noise: a lane that ran and **failed** could not page
as failing, only as missing, and be dismissed as such. `samples_e2e_nightly`
and `production_shadow_audit` each beat `ok:false` on three consecutive days
without ever raising a page. Every existing suite passed against the defect,
because they hand the decision function its rows and never exercise the read.

**G2. Five deploys went unrecorded, and the recorded rollback was four
releases stale** *(#1089)* The log's newest entry was deploy #8 at
`production-write` v36 while live was v40. Anyone reading the file to answer
*"what is the current restore bundle?"* would have dispatched a restore that
reverted four releases.

**G3. A plan recorded only in chat read as done** *(#1095)*
*"The overnight session produced a plan and no code, and recorded that only
inside a long status message — so the feature read as done when it was not."*

**G4. The living flip-status doc said NO-GO for four days after the flip**
*(found reviewing the PR that added this file)*
`docs/independence/GRAPHICS_FLIP_STATUS.md` is the repository's mandated
current-status route for the flip, and its own header says *"Update it in the
same PR as anything it tracks."* It was last updated 2026-08-14 and read
**Verdict: NO-GO … Earliest honest flip date: 2026-08-14** — so for four days
after the flip executed, an operator following the documented route was told the
exact opposite of the live state. Nobody was misled in practice only because
nobody consulted it. Corrected 2026-08-20; the superseded verdict is kept inline
rather than deleted.

The uncomfortable part is where it was found: on the pull request adding *this
file*, a document whose whole subject is writing things down. A doc-hygiene rule
does not enforce itself just because you are currently thinking about doc
hygiene.

**G5. The rollback row named a bundle thirteen releases back** *(found
reviewing the PR that recorded deploy #19)*
`ROLLBACK.md`'s F27 Section 4 row is what an operator reads **during an
incident** to choose a restore bundle. It claimed live was v33/v38/v29/v29 and
named `7e40504c…` as freshest — a bundle capturing `production-write` **v32**,
while live was **v45**. Restoring from it would have rolled back thirteen
releases in the middle of an outage.

It was **eleven deploys stale** (#9 through #19), and it had already been
corrected once on 2026-08-08 for being *two* deploys stale. Its own middle
column states the exact law it keeps breaking: *"The sealed rollback bundle must
postdate the most recent deploy, and the lane will NOT tell you if it does
not."*

The cause is structural, not carelessness. The lane writes its deployed-versions
block into `EXECUTION_LOG.md` **automatically**; this row is hand-maintained, so
it decays silently after every dispatch and nothing anywhere compares it to
reality. Updating it is now step 3 of the operator conventions in
`F27_INSTALL_RUNBOOK.md`.

> **Three instances in one week — G2, G4, G5 — is a pattern, not three
> mistakes.** Each is a hand-maintained document that states current state,
> consulted at the worst possible moment, decaying silently while an automated
> record beside it stays correct. All three were found by review rather than by
> use, which means the failure mode is invisible until someone needs the
> document. Before the video flip, decide for each such document whether it can
> be generated, checked in CI, or folded into the automated record — and treat a
> warning written *inside* the stale cell as evidence the convention does not
> work, since all three carried one.

**RECURS FOR VIDEO? G1 and G2: NO. G3, G4 and G5: always.** It is the same
failure mode that created `OPEN_REPAIRS.md`, and this file exists for the same
reason. **Before the video flip, make updating the flip-status doc and the
rollback row part of the flip's own checklist**, in the same breath as flipping
the flags — not a follow-up.

---

## §3 — What is structurally different about the video flip

The graphics flip landed in a **mixed** world: one team native, one team
still on Linear. Every rule that had to change could still be expressed as
"the Linear-authoritative team". The video flip ends that world, and the
difference is not a matter of degree.

1. **There is no Linear-authoritative team left.** Any rule, gate, test
   fixture or health-check item phrased in terms of one either becomes
   vacuous (passes without checking anything) or undefined. This class does
   not exist in the graphics ledger, because graphics always had video
   standing behind it. Grep for the phrase before flipping. Known members
   already: `PRE_FLIP_HEALTH_CHECK.md` item 1, `batchAllowed`, the Video-only
   create-dialog carve-out, and the four polish suites' authority fixtures.
2. **B1 has no remaining input.** §0-5.
3. **Video is the bigger, busier half.** ~2,921 active deliverables vs 2,291;
   650 batches vs 457; and — the measure that counts — **2,105 applied
   Linear-originated status changes in the pre-flip week against graphics'
   1,406.** Every number in §1 goes up by roughly half again.
4. **Video is where the reviewer queue lives.** The graphics flip's worst
   single incident (B1, 20 hours) hit one reviewer on one issue. The video
   flip puts the full editor→SMM→Kasper→client chain on the native path at
   once.
5. ~~**The rehearsal already exists.**~~ **Superseded 2026-08-24:** the
   simulation was deleted in #1121 when the suite was re-pointed at live
   mixed authority (see §2-A6 for why and for the recorded flip-day edits).
   There is no dry run any more; the suite is part of the flip-day diff.
6. **The soak clock and the flip runbook were written for the graphics
   shape.** Re-read `FLIP_RUNBOOK.md` against this file rather than
   assuming its go-conditions still describe the risk.

---

## §4 — Method lessons

These changed how the work was done, and they are worth more than any single
fix above.

1. **Prove migrations as the role, not as superuser.** §2-D4.
2. **A test that greps source can pass while the code is dead.** Three times
   in four days: a renderer referencing an undefined constant passed a
   247-suite run because nothing executed it; a link adopter sat in a catch
   block and satisfied an assertion that only checked the call string
   existed *somewhere*; and a scheduler *was* being called and could do
   nothing, which a source check calls correct. **Execute the code.**
3. **Measure the mutation by exit code, not by counting FAIL lines.** A
   crashing test prints a stack trace, not a FAIL line, and reads as zero
   failures.
4. **Diagnose before fixing a repeatedly-reported bug.** "Kasper's cards
   reappear" was reported for days, attracted two wrong fixes, and was
   really §2-B1. Live forensics against the event trail found it; theory did
   not.
5. **A gate that can never be cleared trains people to skim the report.**
   This is `PRE_FLIP_HEALTH_CHECK.md`'s own founding rule and it was applied
   twice more during the flip week (§2-A4).
6. **Deploy-lane fingerprint pins drift on *commit*, not on edit** — green
   locally while uncommitted, red on the PR. Expect it; re-pin in the same
   commit.
7. **Squash merges discard branch commits**, so any stamp citing the commit
   it shipped in goes red on main minutes after passing on the branch.
8. **Write it in a file, not in a message.** §2-G3.

---

## §5 — Carried into the video flip

Live items are tracked in `OPEN_REPAIRS.md`; these are the ones that
specifically shape the video flip.

- **The single-team batch parent maps** (§2-C3) — 255 video-only, 132
  graphics-only. Decision open. *Re-measured 2026-08-24: **272 video-only**,
  133 graphics-only, 50 both — the video-only class is still growing, which
  is exactly why the decision cannot wait for the flip.*
- **`write_ui_reroute_clients` is a manual step** the onboarding job does not
  perform. Documented in `NEW_CLIENT_ONBOARDING.md` §6e after a client sat
  unenrolled for fourteen hours. Post-flip an unenrolled client's writes park
  **silently, with no error anyone sees** — for video that means the busier
  half of the estate.
- **The shadow audit residue** — 33 unexpected divergences at 2026-08-20
  (29 graphics, 4 video); largest bucket is 15 due-date intents. CONTEXT,
  not a gate, but it is a work list. *2026-08-24: video repair_count rose
  0 → 16 on 2026-08-22 and has been flat since; no recorded repair explains
  the step. Flat is not growth, but an unexplained step the week before the
  flip deserves one look.*
- **The Linear-born population** (issues with no native row at all — the
  class GRA-7109 made famous): *measured 2026-08-24 for video: 655 total,
  of which **93 are live work, 31 assigned, 0 carrying a future due date**;
  arriving at roughly 39/week. This is the pre-flip import decision, and the
  93/31/0 split is the honest size of it — the 655 headline is the same
  raw-count trap §0-3 documents. After F1, whatever is not imported is
  permanently invisible to SyncView.*
- **F40 remains a gate for video.** §0-8.
