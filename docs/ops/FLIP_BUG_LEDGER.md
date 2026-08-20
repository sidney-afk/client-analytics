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
2. **How many cards will lose their edit path?** After the graphics flip,
   12 cards showed greyed-out thumbnail controls reading "Link a Linear
   sub-issue first" because linkage backfill was blocked by an authority
   rule (#1075). *Measured 2026-08-20: 25 active video deliverables are
   bound to a card whose `video_deliverable_id` is still null.* Run the
   linkage backfill to zero **before** the flip.
3. **How many cards have a Linear link but no native row at all?** These are
   the legacy cards that produced the post-flip `outbound_diff` residue.
   *Measured 2026-08-20: 110 active cards carry a video Linear link with no
   native video deliverable* (graphics: 104). Every one of them is a card
   whose Linear edits will be discarded with nothing native to receive them.
4. **How much Linear traffic is about to become void?** *Measured over the
   7 days to 2026-08-20: 2,120 inbound mirror events on video rows across
   687 rows, versus 1,078 across 415 for graphics.* Video carries roughly
   **twice** the Linear-side edit volume. See §1 for what that produced.

**Fix or decide before flipping.**

5. **B1's remaining job.** `batchAllowed` requires every issue in a batch to
   be Linear-authoritative. Once video flips, no batch qualifies and the
   importer imports nothing. Decide deliberately whether B1 retires, narrows
   to a legacy sweep, or is left running as a no-op — and say so in the
   runbook. Do not let it be discovered.
6. **Every gate phrased "the Linear-authoritative team(s)".** After the
   video flip there are none. `PRE_FLIP_HEALTH_CHECK.md` item 1 binds
   exactly that phrase and will pass vacuously. Re-specify it first, or the
   health check stops meaning anything on the exact day it matters most.
7. **The Production create dialog's Video door.** `index.html:47948` says in
   so many words: "this door because Video is still Linear-authoritative;
   revisit it". At the video flip that comment becomes false. Close the
   door or re-scope it, and remember the graphics precedent (#1078): the
   dialog *preselected whichever team is SyncView-native*, which after the
   flip actively steered people into creating orphans.
8. **F40 stays a real gate.** It was demoted to CONTEXT for graphics only
   because its repair lane closed at the graphics flip. `PRE_FLIP_HEALTH_
   CHECK.md` item 10 says explicitly it "remains a real gate for the future
   VIDEO flip". Do not let the graphics demotion be read as a general one.
9. **Tell the editors before, not after.** See §1. This is the single
   highest-leverage item in the file and it costs nothing.
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

### The number that matters most: discarded Linear edits

Post-flip, a Linear edit to a graphics issue is recorded and **thrown away**.
Every one of these is a person who did work the system did not keep:

| Day | Discarded edits | Rows | Note |
|---|---|---|---|
| 2026-08-16 (flip) | **661** | 360 | mostly the flip's own settling |
| 2026-08-17 (first working day) | **119** | 98 | |
| 2026-08-18 | **30** | 18 | |
| 2026-08-19 | **88** | 44 | *went back up* |
| 2026-08-20 (partial) | **21** | 7 | |

Two things to take from this. First, it does **not** decay cleanly — day 4
was three times day 3, because habits are not a decay curve. Second, video
carries about twice the inbound traffic, so the video flip should be
budgeted at roughly **1,300 discarded edits on flip day** and a tail lasting
weeks.

Nothing in the system tells the person their edit was discarded. It is a
silent no-op on their screen. **Announce the flip to the people who work in
Linear, by name, before you throw the switch** — that single action would
have prevented more real harm than any code fix in this file.

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
Useful detail: `prod-write-gateway-browser` already **simulates the future
video flip** through its own `serverAuthority` mechanism — that simulation
is a written rehearsal, and it is the first thing to run when video flips.

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

**RECURS FOR VIDEO? G1 and G2: NO. G3: always.** It is the same failure mode
that created `OPEN_REPAIRS.md`, and this file exists for the same reason.

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
   650 batches vs 457; 2,120 inbound mirror events a week vs 1,078. Every
   number in §1 roughly doubles.
4. **Video is where the reviewer queue lives.** The graphics flip's worst
   single incident (B1, 20 hours) hit one reviewer on one issue. The video
   flip puts the full editor→SMM→Kasper→client chain on the native path at
   once.
5. **The rehearsal already exists.** `prod-write-gateway-browser` simulates
   the post-video-flip authority. Run it, and read what it asserts, before
   flipping — it is the closest thing to a dry run anyone has written.
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
  graphics-only. Decision open.
- **`write_ui_reroute_clients` is a manual step** the onboarding job does not
  perform. Documented in `NEW_CLIENT_ONBOARDING.md` §6e after a client sat
  unenrolled for fourteen hours. Post-flip an unenrolled client's writes park
  **silently, with no error anyone sees** — for video that means the busier
  half of the estate.
- **The shadow audit residue** — 33 unexpected divergences at 2026-08-20
  (29 graphics, 4 video); largest bucket is 15 due-date intents. CONTEXT,
  not a gate, but it is a work list.
- **F40 remains a gate for video.** §0-8.
