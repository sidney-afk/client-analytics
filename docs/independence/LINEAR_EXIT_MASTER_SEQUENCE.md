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
| Staff writes: status, comments, edits | **Safe.** All 43 active clients are enrolled in the reroute and both teams are SyncView-authoritative, so these go native (item 175, 2026-09-07) | none |
| **Staff CREATING a post** | **NOT safe. See the section below.** Every create reads the Linear API twice before it writes anything, and neither read is behind a flag | **the highest severity in this table** |
| Workload board | The n8n reconcile stops refreshing `workload_issues`, so the board **freezes rather than empties** — silently current-looking and stale | high, because it is invisible |
| Kasper → Editors subtab | `editors-week` fails | visible |
| Tweak comments | `linear-tweak-comments` fails | visible |
| Urgent Slack alerts | `send-urgent-slack` **also reads Linear** — it looks shaped like a pure Slack write, but it resolves the issue's current Linear assignee to pick who to mention. It fails with the account | high, and it was on no existing reader list |
| Import from Linear | Fails, and is moot after the exit anyway | none |

**So the four held PRs merging before 2026-09-15 is what converts an
uncontrolled degradation into a controlled cutover.** That is a real deadline on
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

**This is the most consequential thing found on 2026-09-08, and it contradicts a
line this document carried for most of the day.** The degradation table said
"staff writes are safe". That is true of status, comment and edit writes. It is
**false of creating a post**, which is the write staff make most.

### What the source says

`supabase/functions/production-write/index.ts` on today's `main`. The `create`
operation dispatches to `handleProductionCreate`, which calls
`productionCreateScope`, which calls `projectForIntake` **unconditionally** as its
first substantive step. Every branch of that function that returns successfully
goes through `readLinearProject`, which is a live `POST https://api.linear.app/graphql`:

- a test-scope principal reads the configured test project;
- a real client with exactly one tagged project reads that project;
- a real client with none is refused `409 project_mapping_missing` anyway, and one
  with several is refused `409 project_mapping_ambiguous`.

**There is no path to a successful create that does not read Linear.** Then
`handleProductionCreate` reads it a second time, through
`linearStateIdForCreate`, to resolve the status state id.

When Linear is unreachable, `linearRead` throws
`GatewayError(503, "project_mapping_validation_unavailable")`. It **fails closed**,
which is the correct choice and means nothing is corrupted. It also means the
create is **refused**.

**"Nothing is corrupted" is checked, not assumed.** Everything `handleProductionCreate`
awaits before `productionCreateScope` is read-only: principal resolution,
deterministic id derivation, and `productionCreateReplay`, whose every database
call is a `.select(...)`. The 503 is therefore raised before any row is written,
and a refused create leaves no partial state behind.

### The full map, because "create" is not the only affected operation

Every Linear read in `production-write` traced to the operation that reaches it.
`create` is the worst case but not the only one:

| Operation | Reads Linear? | Behind a flag? |
|---|---|---|
| `create` | **Yes, twice** — `projectForIntake`, `linearStateIdForCreate`, plus parent validation via `productionCreateParentRoute` | **No** |
| `intake_create` | **Yes** — `projectForIntake`, and `parentRouteForAppend` | **No** |
| `component_fill` | **Sometimes** — `parentRouteForAppend` validates externally by default, so a batch with an existing Linear parent reads it; a native batch whose parent outbox row is not `written` does not | **No** |
| **Changing a card's assignee** | **Yes** — `validateAssignee` → `assigneeProviderPool`. This is an everyday staff action on an existing card, not only a create-time check | **Yes**, `production_assignee_eligibility`, and its comment describes a retirement path |
| `status`, `due`, `description` | **No** | n/a |
| `comment`, `attachment`, `labels` | **No** | n/a |
| `batch_description`, `batch_asset` | **No** | n/a |

**The safe rows are verified forward, not merely by absence.** Tracing callers
backwards only shows what reaches a Linear read; it cannot show that a path is
clean, and the reassuring half of a table is the more dangerous half to get wrong.
So `handleEntityOperation` was read forward: `status`, `due` and `description` each
take their own branch and none calls `validateAssignee`, which is reached only in
the final `else` — the assignee branch. That is the whole Linear exposure of the
mutate path.

**The `component_fill` row contains a trap worth naming.** It degrades gracefully
for natively-created batches and fails for batches that already have a Linear
parent — which is every card that exists today. So the graceful path is the one
that only applies to cards that cannot be created, because `create` is blocked by
the row above it. The two defects protect each other from being noticed
separately.

**The assignee row is the shape the other two should have.** Same dependency, but
behind a flag, with an explicit comment about the pre-retirement state and a
deliberate choice that an absent flag row means strictest rather than a 503. That
is what a retirable provider dependency looks like, and it is why the create-path
reads stand out: not that they read Linear, but that nothing can turn them off.

### Two orderings that make this worse than it first looks

**The Linear read happens before the authority check.** `projectForIntake` runs,
and only then does `productionCreateScope` call `authorityFor` and `authorityLane`.
So a client whose authority is fully `syncview` still pays the provider read, and
flipping authority native does not avoid it. This is the precise shape the other
programme's release packet describes as *"legacy write fences query Linear before
refusing mutation, so native authority alone does not eliminate their reads."*
Confirmed here from source, and narrower and more actionable than that sentence.

**Neither read is behind a runtime flag.** A third Linear-reading fence in the same
file, the assignee eligibility pool, *is* flag-gated
(`production_assignee_eligibility`) and has a documented retirement path. The two on
the create path have neither. They cannot be turned off from the flags table, so
this is not fixable in Phase 3 by a flag flip.

### What this means for 2026-09-15

With `main` as it stands: **staff cannot create a post for any real client once
Linear stops answering.** Nothing is lost or corrupted, because it fails closed.
The surface simply stops accepting new work.

### None of the four held PRs fixes it, and #1326 does

Checked directly: `claude/lx-a-workload-native` (#1344), `claude/lx-c-endpoints`
(#1346) and `claude/lx-d-feedback` (#1347) change **zero** lines of
`production-write/index.ts`. This programme's held set does not close this gap.

The other programme's #1326 does, at `5bcc03bd`, with a `nativeEpoch` parameter
that short-circuits both reads:

```
-async function projectForIntake(client, team, principal)
+async function projectForIntake(client, team, principal, nativeEpoch = "")
     ...
+    if (nativeEpoch) return projectId;      // test-scope branch
     ...
+    if (nativeEpoch) return tagged[0];      // real-client branch
```

**That is the single strongest argument in favour of the other programme's work**,
and it is a concrete gap rather than a matter of taste: this programme's set,
merged in full, still leaves Create Post dependent on Linear.

### What has NOT been verified, and it matters

**This is a reading of repo source, not of the deployed function.**
`production-write` reaches production only through the fingerprint-pinned F27
Section 4 lane, so the live function is whatever was last deployed through it and
could differ. Two things settle it, neither of which is a session's to run:

1. **P4, the `SYNCVIEW_QA_LINEAR_DEAD` rehearsal.** This is exactly what it exists
   to catch, and it moves from "before the cutoff" to **the first thing to run**,
   because it either confirms this or proves the deployed function differs.
2. A create attempted on the TEST client `sidneylaruel` with the provider
   unreachable.

Until one of those runs, treat this as a strongly-evidenced source finding and not
as a measured fact about the live system.

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

### P5. Schedule the watchers and fire each one on purpose once

`docs/ops/MONITORING.md`. A watcher that has never fired is a watcher nobody
knows is broken. **Note the gap recorded there:** `SLACK_ALERT_WEBHOOK` points at
the n8n relay, so **no page in this estate survives an n8n outage**. The red
workflow run does, because it emails through GitHub and touches no n8n.

---

## Phase 3 — the cutoff itself

Follow `docs/ops/LINEAR_CUTOFF_RUNBOOK.md`. STEP 0 is read-only and can be run
today. STEP 3 onward is gated on Phase 1 and Phase 2.

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
disjuncts, not two.** The third is `f27ReplayRequestValue`. An F27 replay request
re-opens the provider path even with the flag `off`. That is a deliberate recovery
and drill mechanism rather than a leak, and it is an explicit owner action, so it
cannot happen by accident. It is named here because "with outbound off, nothing
reaches Linear" is true of normal operation and not of a replay dispatch, and
someone reading the shorter version during an incident is exactly the person who
might issue one.

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
