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
| Staff writes (status, comments) | **Safe.** All 43 active clients are enrolled in the reroute and both teams are SyncView-authoritative, so writes already go native (item 175, 2026-09-07) | none |
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

### P4. The dead-Linear rehearsal — before the cutoff, not after

`SYNCVIEW_QA_LINEAR_DEAD`. Prove the app behaves correctly with Linear
unreachable **before** flipping anything. This rehearsal was quietly passing
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
- **n8n: planned, not built.**

Roughly **60% complete** toward "staff and clients work without Linear and the
account can be cancelled safely". That figure has not moved much in two days, and
the reason is worth stating plainly: the engineering advanced a great deal and
the *installation* did not. Installation is the half that is behind, and no
amount of further code moves that number.
