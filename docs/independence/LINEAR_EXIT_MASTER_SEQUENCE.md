# The Linear exit, as one ordered list

**Written 2026-09-08. This is the only document that spans every lane.**

Each lane has its own runbook and each is good. What none of them carries is the
order across all of them: which merge must precede which migration, which deploy
must precede which flag, and which of those the owner performs personally. That
gap is why this file exists.

**Read this beside `docs/ops/LINEAR_CUTOFF_RUNBOOK.md`** (PR #1350), which owns
the flag mechanics in far more detail than is repeated here. This file is the
sequence; that file is the procedure.

---

## How to read the status column

- **DONE** — verified, with the evidence named.
- **HELD** — finished and deliberately not merged, pending the owner's review.
- **OPEN** — not done, and named here because it is nobody's current task.

Nothing below is "in progress". If it is not DONE it is not relied upon.

---

## Phase 0 — already true

| What | Evidence |
|---|---|
| Both teams are SyncView-authoritative | `prod_authority = {video: syncview, graphics: syncview}`, flipped 2026-08-16 (graphics) and 2026-08-28 (video) |
| The Linear label catalog is captured | 2026-09-08 01:24Z. 46 labels reconciled against an independent second walk; 5,437 cards classified; the 5 one-way rows all re-read. **This was the only item in the programme that required Linear to be alive.** Item 170 |
| `2026-09-02-workload-native-view.sql` applied | `EXECUTION_LOG.md` 2026-09-08, recorded late; proven by the RPC answering over the view |
| `2026-09-05-workload-native-membership.sql` applied | Same entry; `workload_native_snapshot_v1()` is one of its functions and it answers |
| `workload-plan` Edge Function deployed | From exact SHA `d4b2365e`, 2026-09-08. Verified twice: `POST {"action":"native_snapshot"}` returns 401 where the pre-incident function returned `400 invalid_action`, **and the owner opened the Workload board and read real dates on every pill** |
| Monitoring survives the cutoff | PR #1348, merged |
| The label exporter and the naming mint SOURCE | PR #1349, merged. **Source only — see P1 below** |
| Media rescue preparation | PR #1345, merged. The lane shrank on evidence: `uploads.linear.app` URLs carry 300-second signatures and have rendered broken for months |
| The coordination set | PR #1351, merged 2026-09-08 |

## Deadline status — corrected, because the earlier wording was too strong

An earlier draft of this file, and several things said to the owner, claimed
**"nothing left is time-critical."** That conflates two different things and the
distinction matters for planning:

- **Nothing left is IRRECOVERABLE.** True. 2026-09-15 removes the ability to read
  the Linear API and to mint a fresh signature. The one artefact that needed the
  API — the label catalog — is captured. Nothing else must be *obtained* from
  Linear before that date.
- **Several surfaces DEGRADE ON THEIR OWN if the cutover has not happened.** Not
  true that this can wait. n8n webhooks that read Linear start failing when the
  account lapses, and SyncView calls them.

**What actually happens on 2026-09-15 with nothing merged**, best current
reading:

| Surface | Effect | Severity |
|---|---|---|
| Staff writes: status, due date, description, comments, attachments, labels | **Safe.** All 43 active clients are enrolled in the reroute and both teams are SyncView-authoritative, so these go native (item 175, 2026-09-07) | none |
| **Changing a card's assignee** | **NOT safe as things stand.** `validateAssignee` → `assigneeProviderPool` needs Linear, and a **missing or malformed** `production_assignee_eligibility` flag *stays strictest* (`docs/truth/APP.md:652-653`). Loss of Linear gives `assignee_provider_unavailable` before the native assignment. **Unlike the intake reads, this one has a documented off switch** — see P6 | **fixable by one flag; unsafe until it is set** |
| **Staff creating a post, or filling a component** | **NOT safe. See the section below.** `intake_create` and `component_fill` both read the Linear API before writing anything, and neither read is behind a flag | **the highest severity in this table** |
| Workload board | The n8n reconcile stops refreshing `workload_issues`, so the board **freezes rather than empties** — silently current-looking and stale | high, because it is invisible |
| Kasper → Editors subtab | `editors-week` fails | visible |
| Tweak comments | `linear-tweak-comments` fails | visible |
| Urgent Slack alerts | `send-urgent-slack` **also reads Linear** — it looks shaped like a pure Slack write, but it resolves the issue's current Linear assignee to pick who to mention. It fails with the account | high, and it was on no existing reader list |
| Import from Linear | Fails, and is moot after the exit anyway | none |

**Merging the four held PRs is necessary and NOT sufficient.** An earlier version
of this line said those four merges convert an uncontrolled degradation into a
controlled cutover. That is false as stated, and the section below on intake says
why: none of the four touches `production-write`, so post creation and component
filling stay Linear-dependent after all four land. **A controlled cutover needs the
four merges, the intake repair (P7), and the assignee flag (P6).** That is a real deadline on
the review, not on the engineering. It does not make anything unrecoverable, and
it is not a reason to rush the review — it is a reason to schedule it.

Today is 2026-09-08. That is one week.

**`send-urgent-slack` was added to this table on 2026-09-08 from PR #1356**, which
re-derived the endpoint list from `main` rather than carrying forward the July
audit. It is the one Linear reader that no previous list carried, precisely
because its name and its output are both about Slack. Worth stating as a method
point and not just a row: **an endpoint's dependencies are not inferable from
its name or its effect.** Two endpoints that look Linear-bound survive untouched
for the mirror-image reason — `log-linear-submission` only appends a Google
Sheet and `kasper-queue` only reads Sheets.

---

## There is a SECOND exit programme, and this document did not know about it

**Found 2026-09-08, after the first version of this file was merged. It is the
exact defect this file exists to prevent, committed by this file.** A document
whose stated purpose is to span every lane spanned one programme's lanes and was
silent about the other.

Three open **drafts** carry an earlier, separate Linear exit effort, authored
2026-09-04 to 2026-09-07 and last touched hours before this programme's lanes
started:

| PR | State | What it is |
|---|---|---|
| [#1268](https://github.com/sidney-afk/client-analytics/pull/1268) | Draft, base `main`, **docs only** (20 files) | Its "canonical plan", with `LINEAR_EXIT_RELEASE_PACKET_2026-09-07.md` as the reviewable status |
| [#1326](https://github.com/sidney-afk/client-analytics/pull/1326) | Draft, **base `main`**, all 8 hosted jobs green at `5bcc03bd` | A combined runtime candidate for the whole exit: native intake/assignments/labels, card and feedback recovery, Workload cutoff, tokenless writer composition, 42-table recovery |
| [#1341](https://github.com/sidney-afk/client-analytics/pull/1341) | Draft, stacked on #1326 | **A native urgent-alert replacement**, i.e. the `send-urgent-slack` fix |

**Do not merge any of them on the strength of this section.** All three are drafts
by their authors' own choice, #1268's own text says no merge or deploy is
authorized, and #1326 states that first installation and final recovery remain
unproven. They are listed for what they *know*, not because they are ready.

**#1326 needs stating precisely, because it is the one that could waste real
work.** It is not a stranded side branch: it targets `main`, and its author
reports all eight hosted jobs green at `5bcc03bd`. What it covers overlaps this
programme's lanes A (Workload), D (feedback recovery) and F (cutoff) directly.
Two separate, independently-CI-green attempts at the same exit now exist, built
without knowledge of each other.

**This document does not rule on which one wins, and neither should a session.**
That is an owner decision with a second model, and it is the single most valuable
thing for that review to settle, ahead of any individual PR. What can be said
factually: #1326 preserves `main` at `70715496a`, which is many merges behind
today's tip, so it would need a substantial re-merge before it could be
considered at all; this programme's four PRs are current. That is an argument
about freshness, not about which design is better.

### What it holds that this programme does not

**A live n8n inventory, where ours is source-derived.**
`N8N_REPLACEMENT_PLAN.md` (PR #1356) says plainly that **no live n8n workflow was
inspected** and its readbacks are eight weeks old. The release packet reports a
fresh read-only inventory covering **129 of 129 current workflow IDs, 93 active
and 36 inactive**, with every active published-version binding verified, and says
it supersedes an older 32-workflow missing-read gap. Where the two disagree about
what exists, **the live read wins** and our source-derived list is the one to
correct.

The two counts are not directly comparable and should not be reported as a
contradiction: ours counts **56 webhook endpoints** reached from the browser,
theirs counts **129 workflows** in the n8n account. Different units. What matters
is that theirs was measured and ours was inferred.

**A finding that touches the degradation table above.** *"Two legacy write fences
currently query Linear before refusing mutation, so native authority alone does
not eliminate their reads."* Nothing in this programme's documents says that. It
does not necessarily make "staff writes are safe" wrong — a fence that queries
Linear and then refuses may simply refuse harder when Linear is dead — but it
means the claim rests on a fence behaviour nobody here has checked. That row now
carries the caveat.

**A different decomposition of the remaining automation work**, into seven finite
groups rather than our per-endpoint list: F44 submit forwarding and native project
picker; native Workload/tweak scope and scheduled mirror replacement; native
urgent editor lookup; weekly editor statistics; linked-card status/metadata and
explicit provider import; conserved comment/status queues refusing **before** the
provider lookup; and two bounded external-destination checks.

**Independent corroboration of the `send-urgent-slack` finding.** #1341 exists
because *"the existing Slack workflow looks up the editor in Linear"* — reached
separately, from a different direction, before PR #1356 re-derived it from source.
Two independent derivations agreeing is the strongest evidence either has.

### A decision the owner may not know is on the table

The release packet says a **short Linear access extension targeting 2026-10-15**
was prepared for review, without adding seats or features, and that 2026-09-15
cancellation remains scheduled meanwhile. The owner has said he cannot extend, so
this is recorded rather than recommended — but it was prepared, and a prepared
option nobody is told about is the same as no option. **The owner's word is
authoritative here**; if extension is genuinely foreclosed, that fact belongs in
the packet too, because it is currently planning around an extension that is not
available.

### Why this was missed, since the method matters more than the miss

Every lane in this programme was scoped from `main` and from documents on `main`.
All three of these PRs are **drafts**, so none of their content is on `main` and
nothing any lane read could have mentioned them. The open-PR list would have, and
no lane read it, this coordinator included. **A document claiming to span every
lane must enumerate the lanes from the PR list, not from the branch it happens to
be standing on.**

Correcting one thing in the first version of this section, within the hour, so
the record is right: it said #1326 was based on an integration branch. **It is
based on `main`.** Only #1341 is on the integration branch. That mattered, and
getting it wrong understated the finding — a draft on `main` with green CI is a
live alternative to this programme's work, not a stranded experiment, and the
whole point of the section is what the review needs to weigh.

---

## Create Post is Linear-dependent, and none of the four held PRs fixes it

**The conclusion holds. The first version of this section reached it by tracing
dead code, and is corrected below.** Three review findings, all correct, all
against this section. Read the correction notice before the trace.

### Correction, 2026-09-08 — I traced an unreachable path

The first version said the `create` operation reads Linear twice. **`create` never
reaches a Linear read.** `production-write/index.ts:3592` throws
`GatewayError(403, "production_create_closed")` unconditionally, before
`productionCreateScope` on the next line, under an owner ruling of 2026-08-23 that
*"nothing is created from the Production tab."* Everything after that `throw` —
including both reads I counted — is dead code.

**I traced a path without checking it was reachable**, on the day this programme
logged three separate variants of "a document correct about what it says and wrong
about where it points". This is a fourth: **correct about what the code says, wrong
that the code runs.** Reachability is the first question, not a detail, and it is
cheaper to check than any of the tracing I did after it.

The conclusion survives because the browser does not send `create`. The Calendar
Create Post flow sends **`intake_create`** (`index.html:42155`), and that handler
is not closed and does depend on Linear. So the finding is real and its trace was
wrong, which is the least useful way to be right.

### What the reachable paths actually do

| Operation | Reachable? | Reads Linear? | Behind a flag? |
|---|---|---|---|
| `create` | **No** — 403 `production_create_closed` at `:3592` by owner ruling | Moot, the throw precedes every read | n/a |
| **`intake_create`** — the real Create Post | **Yes** | **Yes.** `handleIntakeCreate` calls `projectForIntake` **unconditionally, once per team**, in a loop before the first native row write; each mapped client reaches `readLinearProject`. Also `parentRouteForAppend` and `assertEligibleAssignee` | **No** |
| `component_fill` | **Yes** | **Yes, ALWAYS.** `handleComponentFill:6008` calls `projectForIntake` unconditionally, before `parentRouteForAppend` at `:6038` | **No** |
| **Changing a card's assignee** | **Yes** | **Yes** — `validateAssignee` → `assigneeProviderPool`. An everyday action on an existing card | **Yes**, `production_assignee_eligibility` |
| `status`, `due`, `description` | Yes | **No** | n/a |
| `comment`, `attachment`, `labels` | Yes | **No** | n/a |
| `batch_description`, `batch_asset` | Yes | **No** | n/a |

**A withdrawn claim.** The first version called `component_fill` "sometimes"
Linear-dependent and built a story on it: that it degrades gracefully for natively
created batches, and that this graceful path is unreachable because `create` is
blocked, so "the two defects conceal each other." **That was wrong in its premise.**
`projectForIntake` runs before any parent-route logic, so a fill on a mapped client
always reaches Linear regardless of its parent. There is no graceful path to
conceal. The row is **Always**, and `component_fill` belongs in the cutoff repair
scope; leaving it as "sometimes" would have let it be skipped, and every fill would
fail after provider access ends.

**The safe rows are verified forward, not by absence.** Tracing callers backwards
shows only what reaches a provider call and can never establish that a path is
clean. `handleEntityOperation` was read forward: `status`, `due` and `description`
each take their own branch and none calls `validateAssignee`, which is reached only
in the final `else`. That branch is the mutate path's entire Linear exposure.

### The load-bearing claim, verified end to end

Everything above rests on one sentence: **`handleIntakeCreate` calls
`projectForIntake` unconditionally.** Since this section has already been wrong
once about which code runs, that sentence is proved rather than asserted:

1. `teams` is built from the items and `teams.size < 1` throws
   `invalid_intake_teams`, so it has one or two members.
2. Any item whose team does not normalize throws the same error, so every member
   is a normalized team.
3. `normalizeTeam` returns **only** `"video"`, `"graphics"` or `""`, from a frozen
   `TEAM_KEYS` map in `policy.mjs:209-216`, and the `""` case is filtered out by
   `Boolean`.
4. `teamList = ["video","graphics"].filter(team => teams.has(team))` is therefore
   **non-empty**.
5. Between `teamList` and the loop there is **no `return`** — only throws.

So the loop runs at least once on every `intake_create` that passes validation, and
`projectForIntake` is reached every time. No flag, no early exit, no empty-list
path.

### Two request-construction sites, four flows

**Corrected twice. The first version of this table invented a sender and omitted a
whole surface.** There are exactly **two** places the browser builds an
`intake_create` request, and between them they serve **four** flows:

| Built at | Surface | Flows it serves |
|---|---|---|
| `index.html:42155` | Derived at `:42056` — `state.surface === 'sxr' ? 'sxr' : 'calendar'` | **Calendar** Create Post, **and Samples/SXR**, whose entry point calls `_calOpenNativePost(..., 'sxr')` at `:66086` |
| `index.html:48263` | `'submission'` | **Staff submission** from the normal tab, authenticated; **and the client link** — `production-write` admits a credential-less caller for `intake_create` on the `submission` surface only, behind a **default-off** runtime flag, rate-limited and marked `public-intake` |

**`index.html:47372` is NOT a sender**, and the first version of this section wrongly
listed it as one. It is inside `_linearIntakeRecoveryCopy`, which builds a scrubbed
`recovery_only: true, suspended: true` copy of an **already-committed** job;
`_runNativeIntakeJob` skips its gateway fetch whenever `job.result` exists.

**The omission mattered more than the invention.** Missing Samples/SXR left a live
surface out of the cutoff blast radius, and Samples is where a client's first
deliverables come from. Counting a recovery copy as a sender only inflated a number.
**A table that invents a row and drops a real one is not "roughly right"** — the two
errors do not cancel, and only one of them would have been caught by anyone
sanity-checking the total.

All four flows reach `handleIntakeCreate` and therefore the same unflagged
`projectForIntake`. The client-link flow is **conditional** on a default-off flag
whose live value this lane has not read.

### The failure mode, unchanged by the correction

When Linear is unreachable, `linearRead` throws
`GatewayError(503, "project_mapping_validation_unavailable")`. It **fails closed**,
so nothing is corrupted, and the operation is **refused**.

**"Nothing is corrupted" is checked.** For `intake_create` the read sits in the
block the source itself labels *"read-only validation ... before the first native
row write"*, and the only earlier write is the `public_intake_log` insert. Nothing
partial is left behind.

### Two orderings that make this worse than it first looks

**The provider read precedes the authority check.** In `handleIntakeCreate`,
`projectForIntake` runs before `authorityFor` in the same loop iteration, so a
client whose authority is fully `syncview` still pays the provider read. Flipping
authority native does not avoid it. This is the shape the other programme's release
packet describes as *"legacy write fences query Linear before refusing mutation, so
native authority alone does not eliminate their reads."*

**Neither read is flag-gated.** The assignee eligibility pool in the same file
**is** gated by `production_assignee_eligibility`, and its comment names a
retirement path. The intake and fill reads have no gate, so this cannot be fixed by
a flag flip at cutoff time.

### What this means for 2026-09-15

With `main` as it stands, once Linear stops answering, **for any real client:**

- **no post can be created** — from the Calendar, from **Samples/SXR**, from a staff
  submission, or from the client link (that last one conditional on its default-off
  flag);
- **no component can be filled.**

Nothing is lost or corrupted; every one of those fails closed. Those surfaces
simply stop accepting new work. **Samples/SXR is in this list because a reviewer
caught it missing**, and it is the one people are least likely to think of, since
it is a different tab from the Calendar dialog everyone pictures.

### None of the four held PRs fixes it, and #1326 does

Checked directly: `claude/lx-a-workload-native` (#1344), `claude/lx-c-endpoints`
(#1346) and `claude/lx-d-feedback` (#1347) change **zero** lines of
`production-write/index.ts`.

#1326 at `5bcc03bd` threads a `nativeEpoch` through `projectForIntake` that
short-circuits before the provider read, and **it is threaded into exactly the two
reachable call sites** — `handleComponentFill` and `handleIntakeCreate` — while the
dead `create` call site is left alone. That is a more precisely targeted fix than
the first version of this section credited it with.

### What has NOT been verified

**This is a reading of repo source, not of the deployed function.**
`production-write` reaches production only through the fingerprint-pinned F27
Section 4 lane, so the live function may differ. Two things settle it:

1. **P4, the `SYNCVIEW_QA_LINEAR_DEAD` rehearsal**, now the first Phase 2 action.
2. An `intake_create` attempted on the TEST client `sidneylaruel` with the provider
   unreachable.

Given that this section has already been wrong once about which code runs, prefer
the rehearsal over any further source reading.

---

## Phase 1 — the owner's review gate

Four PRs are finished, CI-green, and held **by choice**. Merging any of them
publishes the live site immediately, so none is merged until the owner has
reviewed them with a second model.

| PR | What it changes for a person | Merge-blocking defects |
|---|---|---|
| [#1344](https://github.com/sidney-afk/client-analytics/pull/1344) | The Workload board reads native data instead of the Linear mirror | **None.** Its backend is already deployed; `production-polish` went green on re-run |
| [#1347](https://github.com/sidney-afk/client-analytics/pull/1347) | Staff can read every piece of feedback on a deliverable without Linear | None known |
| [#1346](https://github.com/sidney-afk/client-analytics/pull/1346) | editors-week rebuilt natively; live writes fail closed instead of reaching Linear | None merge-blocking. **But it carries an attached obligation:** its native reader depends on `deliverable_events`, whose `anon` grant must be revoked separately (Phase 4). Merging without that trades one unauthenticated exposure for another |
| [#1350](https://github.com/sidney-afk/client-analytics/pull/1350) | The cutoff runbook and the watchers. **Merges last** | None known |

**Merge order is forced: A, then D, then C, then F.** Lane F's every step
presumes the other three are live.

**One ordering trap, in lane D.** Its Edge Function deploy lane accepts only a
`commit_sha` already on `main`, so #1347 must **merge before** its backend
deploys. In the window between, staff see an honest "feedback unavailable"
banner and clients see nothing different. That is the one place in the whole
programme where the browser half legitimately ships ahead of its backend.

---

## Phase 2 — what the owner must run, and P1 is not on anyone's list

These are live actions. None can be done by a session.

### P1. Apply the naming mint migration AND seed each team — OPEN, and load-bearing

`docs/ops/NATIVE_IDENTIFIER_MINT.md` opens with: *"Status: SOURCE ONLY.
`migrations/2026-09-07-native-identifier-mint.sql` has not been applied to the
live database and no team has been seeded."* `EXECUTION_LOG.md` has no record of
it either.

**Why this matters more than it sounds.** `deliverables.linear_identifier` is the
human-readable name on a card — the `VID-` and `GRA-` numbers staff actually say
out loud. Every writer of that column is Linear. Turn outbound off before this
migration is applied and seeded, and **every card created afterwards has no name**:
it renders as a raw internal id in the Production list, the command palette, the
Workload parent header and all three deep links. Nothing errors. The estate just
quietly stops producing names.

**Merging PR #1349 was not enough** and the runbook says so explicitly. The
trigger does not exist until the migration is applied and each team seeded.

**Applying and seeding is NOT enough — there are four steps and the fourth is the
gate.** `docs/ops/NATIVE_IDENTIFIER_MINT.md` §"Live actions, in order" is
explicit, and an earlier draft of this file named only the first three:

| # | Action |
|---|---|
| 1 | Apply `migrations/2026-09-07-native-identifier-mint.sql` |
| 2 | `select public.production_native_identifier_seed('video');` — record the returned `prefix`, `observed_provider_max` and `next_ordinal` |
| 3 | Same for `'graphics'` |
| 4 | **Flip `syncview_runtime_flags.production_native_identifier_mint` to `{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"native"}}`** |

**Step 4 is what lane F's outbound-off step actually waits on.** Steps 1 to 3
leave the allocator installed and refusing: `production_native_identifier_capability(team)`
returns `native` only when the flag says native **and** a seed row exists. Stop
after step 3 and the mint is inert, the TEST card still gets its name from
Linear, and turning outbound off produces the exact nameless-card failure this
section exists to prevent.

**One reassurance, from the same document:** the capability self-guards, so a
premature flip is inert rather than half-armed. This is deliberately unlike
`production_label_catalog_capability()`, which reports `native` with nothing
staged and 503s one call later.

**How to prove it worked:** do step 4 **per team, video first**, then create one
post on the TEST client `sidneylaruel` and read back a non-null
`deliverables.linear_identifier` that Linear did not mint — **before** seeding
the second team.

**Undo:** set the team back to `{"mode":"provider"}`. That stops new minting
immediately and renames nothing, by design. Note steps 2 and 3 are safely
undoable **only while no name has been handed out** for that team; once one has,
deleting the cursor and re-seeding re-issues names.

### P2. Apply `2026-09-08-workload-native-label-state-shape.sql` — OPEN

Lane A's corrective migration, written because the original certified the wrong
shape as absent: `is distinct from 'object'` is true for an array or a scalar as
well as for absence, so malformed provider state was answered
provably-unlabelled at 1x rather than refused. **Verify whether it is applied
before assuming either way** — this programme has now been wrong in both
directions about which migrations are live.

### P3. Deploy the comment reader — after #1347 merges

Dispatch https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml with `commit_sha` = the exact `main` tip.
**That one dispatch redeploys four functions**, not one: `linear-outbound`,
`production-write`, `production-comments`, `production-archive`. The other three
go out byte-identical, but it is a larger action than its name suggests.

### P4. The dead-Linear rehearsal — RUN THIS FIRST, ahead of everything else in Phase 2

`SYNCVIEW_QA_LINEAR_DEAD`. Prove the app behaves correctly with Linear
unreachable **before** flipping anything.

**Promoted to first place on 2026-09-08.** It was listed fourth as a
before-the-cutoff item. The Create Post finding above changes that: this rehearsal
is the instrument that either confirms the deployed write gateway refuses every
create with Linear dead, or proves the live function differs from repo source.
Everything else in Phase 2 is cheaper to decide once that is known, and the review
in Phase 1 is choosing between two programmes partly on this exact question. This rehearsal was quietly passing
until 2026-09-08, because four probes overrode the dead-mode switch with their
own always-succeeds Linear — covering exactly the write flows the rehearsal
exists to watch fail. Fixed; dead mode now returns a mix of abort, 502, 504 and
a 200-with-a-lie where it previously returned a flat 200.

### P6. Set the assignee provider-mapping flag — a one-value fix, easy to miss

`syncview_runtime_flags.production_assignee_eligibility` must be set to **exactly**
`{"provider_mapping_required": false}`. `docs/truth/APP.md:652-653` is explicit that
a missing or malformed flag **stays strictest**, so doing nothing is not neutral
here: it leaves every assignee change dependent on a provider that is about to stop
answering.

This is the **only** Linear-dependent write path with a documented off switch. Its
author built the retirement in. Use it.

Order it **after** the dead-Linear rehearsal, so the rehearsal observes the strict
behaviour first and the flag's effect is proved rather than assumed.

### P7. Repair intake, and prove it — REQUIRED BEFORE PHASE 3

**This is a gate, not a recommendation.** Post creation, Samples/SXR intake, staff
submission and component fill all read Linear through `production-write`, and
**none of the four held PRs changes that file**. Without a repair, following this
sequence to Phase 3 turns the cutoff on while every one of those surfaces is
already refusing.

The repair is the owner's choice, and this document deliberately does not pick:

- **Adopt #1326's approach** — its `nativeEpoch` short-circuits `projectForIntake`
  before the provider read, threaded into exactly the two reachable call sites; or
- **a fresh minimal change** to `production-write` doing the equivalent, if #1326's
  wider scope is unwanted.

Either way it is an Edge Function change and therefore an F27 Section 4 deploy,
with everything that implies: the sealed capture, the merge freeze, the exact SHA.

**The acceptance criterion is behavioural, not a green check.** With
`SYNCVIEW_QA_LINEAR_DEAD` active, on the TEST client `sidneylaruel`: create a post
from the Calendar, create one from Samples/SXR, and fill a component. All three must
**succeed**, not merely fail cleanly. Until they do, Phase 3 is not reachable, no
matter what else is done.

### P5. Schedule the watchers and fire each one on purpose once

`docs/ops/MONITORING.md`. A watcher that has never fired is a watcher nobody
knows is broken. **Note the gap recorded there:** `SLACK_ALERT_WEBHOOK` points at
the n8n relay, so **no page in this estate survives an n8n outage**. The red
workflow run does, because it emails through GitHub and touches no n8n.

---

## Phase 3 — the cutoff itself

Follow `docs/ops/LINEAR_CUTOFF_RUNBOOK.md`. STEP 0 is read-only and can be run
today. STEP 3 onward is gated on Phase 1 and Phase 2.

### Entry gate — check these before STEP 3, not after

An earlier version of this document let a reader arrive here having done everything
listed and still turn the cutoff on while post creation was already broken. The
rehearsal would have *confirmed* the refusal and been read as a pass, because
"fails cleanly" is what a rehearsal is usually looking for. **On the intake paths,
failing cleanly is the defect, not the proof.** So the gate is stated as behaviour
that must succeed:

| # | Must be true | Not merely |
|---|---|---|
| 1 | The four held PRs are merged | reviewed |
| 2 | The naming mint's **four** steps are done, flag flip included (P1) | migration applied |
| 3 | `production_assignee_eligibility` is exactly `{"provider_mapping_required": false}` (P6) | left absent |
| 4 | With Linear dead: a Calendar post, a Samples/SXR post, and a component fill all **succeed** on the TEST client (P7) | refuse cleanly |

**Any one of these unmet means Phase 3 is not reachable.** Item 4 is the one this
document previously permitted a reader to walk straight past.

**This gate is in the wrong document, and that is worth admitting rather than
leaving as a quiet weakness.** The failure it repairs was that a reader could
satisfy every listed step and still reach a forbidden state; repairing it with more
prose in the same document produces a second thing to walk past. **The operator at
cutoff time has `LINEAR_CUTOFF_RUNBOOK.md` open, not this file.**

The runbook lives on PR #1350's branch and is held, so this lane cannot add to it
without touching another lane's finished work. The precondition has therefore been
handed to that lane as a comment on #1350, phrased in its existing P-numbered style,
and **should be added there before its STEP 3 is ever run**. Until it is, item 4
above is a note in a coordination document rather than a real gate — which is
exactly the distinction this section exists to make, so it is stated plainly instead
of being papered over.

### There are TWO possible routes here, and only one of them is reversible

An earlier draft of this section said flatly "steps 0 through 6 are fully
reversible". That is true of the route the runbook takes and **dangerously untrue
of the other one**, and both are described in documents on `main`. Stating it
without the condition could induce a one-way action under a reassurance that does
not cover it.

**Route A — what `LINEAR_CUTOFF_RUNBOOK.md` actually does. Take this one.**
Flags only. The runbook's §0 computes, rather than assumes, that no Edge Function
deploy is needed: with `linear_outbound_enabled = {"mode":"off"}` and
`linear_legacy_parity_enabled = {"enabled":false}`, `linear-outbound/index.ts:1355`
skips the entire provider block — no rows read, no `readViewer()`, nothing reaches
`api.linear.app`. Both flags fail closed. On this route
`migrations/2026-09-06-linear-outbound-cutoff.sql` is **never installed**, so
**there is deliberately no irreversible database step**, every flag step names its
exact expected prior value and refuses if reality disagrees, and **steps 0 through
6 are fully reversible.** Only STEP 7, revoking the credentials, is one-way.

**Route B — installing the server fence. One-way. NOT part of the runbook.**
`LINEAR_EXIT_BRIEF_F.md` describes installing that migration (seven functions, a
control table, four `mirror_outbox` columns) and then activating the fence with
`select public.linear_outbound_cutoff_activate_v1(<generation>, '<operator>')`.
Its own live-action entry says of that step: *"NOT REVERSIBLE by design — there
is deliberately no re-enable RPC, public or automatic. Recovery requires a
reviewed migration delta issued only after every `authorized_before_cutoff` row is
reconciled against provider truth and every `accepted_after_cutoff` receipt is
classified."* And the install step's own undo carries: *"THIS UNDO IS VALID ONLY
BEFORE THE CUTOFF IS ACTIVATED. AFTER ACTIVATION IT DESTROYS THE EVIDENCE THE
RECOVERY NEEDS — DO NOT TAKE IT."*

**Route A's central claim is now verified from source, not quoted.** Given the
day's lesson about borrowed sentences, the one the entire cutoff plan rests on
deserved checking rather than citing. It holds:

`linear-outbound/index.ts` guards its whole provider block with
`if (initialMode !== "off" || parityEnabled || f27ReplayRequestValue)`. With
outbound `off` and parity `false`, `rows` is declared empty at the top and is only
ever assigned inside that block, so it stays empty. `readViewer()` is inside the
block and is skipped. Every other Linear call in the file — `readIssue`,
`readTeam`, `readLinearComment`, `readCommentByMarker`,
`readAttachmentRevisionPresent`, `currentControl` and the mutation execution
itself — runs inside `for (const candidate of rows)`, which therefore never
executes a single iteration. **Nothing reaches `api.linear.app`.** The runbook is
right and the flag really is sufficient.

**One caveat the runbook's wording does not carry: that guard has THREE
disjuncts, not two.** The third is `f27ReplayRequestValue`, and it needs a
qualification the first version of this section got wrong.

**An F27 DRILL provably cannot reach Linear**, even with the flag off. Two
independent guards: `readViewer()` is skipped when `f27Replay.isDrill === true`,
and inside the row loop a drill calls `executeF27DrillReplay` and `continue`s
before `currentControl` or any mutation. The source says so where it branches:
*"Branch here so a drill can never resolve an entity or call Linear."*

**Only a non-drill RECOVERY replay re-opens the provider path.** That is the
caveat, and it is narrower than "any replay dispatch". It is still worth naming,
because it needs an explicit owner action and "with outbound off, nothing reaches
Linear" is true of normal operation but not of a recovery replay. Telling an
incident operator that the drill mechanism reaches Linear would be worse than
saying nothing, since the drill is the safe thing they should feel free to run.

**Do not take Route B.** The runbook's reasoning for skipping it is sound and
costed: it needs an F27 Section 4 dispatch, which needs a merge freeze across
every exit branch, and dispatches were rejected on 2026-09-02 and 2026-08-08 for
exactly that. A flag at `off` stops the traffic equally well and is fully
reversible. If 2026-09-15 arrives with a real-client row still non-terminal, that
is an argument **for** the flag shape, not against it.

The briefs describe Route B because they were written when it was the plan. They
are a map of what exists, not an instruction to install it.

---

## Phase 4 — the n8n replacements

Several n8n webhooks read Linear and will fail when the account lapses. The full
inventory, classification and per-endpoint plan is
**`docs/independence/N8N_REPLACEMENT_PLAN.md`**, merged 2026-09-08 as PR #1356.
Read it before touching any of them; only the parts that change this sequence are
repeated here.

**Seven browser-called webhooks read Linear and die with it:** `editors-week`,
`linear-issues`, `linear-issue-statuses`, `linear-subissues`,
`linear-tweak-comments`, `linear-projects`, and `send-urgent-slack`. Four more
write Linear and die with it. That list was re-derived on `main` rather than
carried forward, and it corrected two things: `send-urgent-slack` belongs on it
(see the degradation table above) and `log-linear-submission` / `kasper-queue` do
not, despite their names.

**A blocker that belongs to lane C and is easy to lose.** The native
`editors-week` replacement in PR #1346 reads `public.deliverable_events`, which
`migrations/2026-07-06-b1-linear-data-model.sql:682-688,698` grants `select` to
`anon` under a permissive `using(true)` policy, and **no migration in this repo
revokes it** — the F53 revoke covered `batches` and `deliverables` and not this
table. That is F48's exposure shape reproduced natively.

**Revoking that grant is an independent, mandatory requirement, not an
alternative.** Serving the data through an authenticated Edge Function does not
satisfy it: the publishable key is committed, and it reaches the table through
PostgREST regardless of what any Edge Function does. Both are needed.

Two honest limits on that finding, carried over rather than smoothed away: it is
a **source-level reading and the live grant was not checked**, and tables in this
estate have been created by hand-run SQL that never reached the repo. Verify
against the live database before relying on either the finding or its absence.

**Every one of these needs the owner's explicit go-ahead in the moment.** They
are production sales automation. The house rule is in `CLAUDE.md` and it is not
negotiable by a session.

**Before executing any of this, reconcile it against the live inventory in
`LINEAR_EXIT_RELEASE_PACKET_2026-09-07.md`** (PR #1268, draft). Our plan is
derived from source with the live n8n account explicitly not inspected; theirs is
a read of the account covering 129 of 129 workflow IDs. Where they disagree about
what exists, the measured one wins. See the second-programme section above.

**And check PR #1341 before rebuilding the urgent alert.** It is a draft native
replacement for `send-urgent-slack` — the same endpoint this plan lists as needing
one. Rebuilding it from scratch without reading that first is the avoidable waste
this section exists to prevent.

### F48 — a security item with a forced order

`webhook/editors-week` is deployed, **unauthenticated**, accepts an arbitrary
historical range, and returns confidential per-editor, per-client work timelines.
Last week it returned 131 delivery keys to anyone who asked.

**It cannot be switched off yet.** `index.html:22342` still calls it on `main`
today, and it draws Kasper's Editors subtab. The native replacement is in
PR #1346. So the order is: merge #1346 → confirm the native panel works →
**then** export the workflow JSON to the private Drive backup, deactivate, and
commit only a public-safe stub to `n8n-backups/`.

Open since July. The exposure is unchanged by this programme; what changed is
that it is now written down with its dependency instead of being claimed closed.

---

## Phase 5 — observation

After the cutoff, watch. The specific thing worth watching for is the class of
defect this programme kept producing: **a change that only affects rows created
after the flip.** Those rows cannot exist before cutover, so defects in them
cannot be tested for in advance and surface on the day, when attention is
elsewhere and rollback is hardest. Three were found and fixed on one PR alone.

---

## The honest state, in one line each

- **Building: near done.** Four PRs finished and reviewed.
- **Installing: barely started.** Two migrations, two deploys, a rehearsal and the watchers, all owner actions.
- **The cutoff: not started**, and correctly so.
- **n8n: planned twice, built once in draft.** This programme wrote a plan; an
  earlier programme measured the account and drafted the urgent-alert replacement.
  Neither is merged, and until today neither knew about the other.

Roughly **60% complete** toward "staff and clients work without Linear and the
account can be cancelled safely". That figure has not moved much in two days, and
the reason is worth stating plainly: the engineering advanced a great deal and
the *installation* did not. Installation is the half that is behind, and no
amount of further code moves that number.

**The figure stays at ~60% after finding the second programme, and it is worth
saying why it did not go up.** Discovering that more work exists than was
credited does not mean more work is done. What it changes is the denominator's
honesty, not the numerator: some of what this programme listed as "to build" may
already be drafted elsewhere, and some of what it listed as done rests on a
source reading that a live measurement could overturn. Both directions are now
visible, which is the improvement. The percentage is not.
