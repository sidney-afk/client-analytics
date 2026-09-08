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

**Deadline status: nothing left is time-critical.** 2026-09-15 removes the
ability to *mint* a fresh Linear signature and to read the API. The one artefact
that needed the API is captured. Everything remaining can be done at any pace.

---

## Phase 1 — the owner's review gate

Four PRs are finished, CI-green, and held **by choice**. Merging any of them
publishes the live site immediately, so none is merged until the owner has
reviewed them with a second model.

| PR | What it changes for a person | Merge-blocking defects |
|---|---|---|
| [#1344](https://github.com/sidney-afk/client-analytics/pull/1344) | The Workload board reads native data instead of the Linear mirror | **None.** Its backend is already deployed; `production-polish` went green on re-run |
| [#1347](https://github.com/sidney-afk/client-analytics/pull/1347) | Staff can read every piece of feedback on a deliverable without Linear | None known |
| [#1346](https://github.com/sidney-afk/client-analytics/pull/1346) | editors-week rebuilt natively; live writes fail closed instead of reaching Linear | None known |
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

**How to prove it worked:** create one card on the TEST client `sidneylaruel`
after seeding, then read back a non-null `deliverables.linear_identifier` that
Linear did not mint.

### P2. Apply `2026-09-08-workload-native-label-state-shape.sql` — OPEN

Lane A's corrective migration, written because the original certified the wrong
shape as absent: `is distinct from 'object'` is true for an array or a scalar as
well as for absence, so malformed provider state was answered
provably-unlabelled at 1x rather than refused. **Verify whether it is applied
before assuming either way** — this programme has now been wrong in both
directions about which migrations are live.

### P3. Deploy the comment reader — after #1347 merges

`deploy-onboarding-edge-functions.yml`, `commit_sha` = the exact `main` tip.
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

The runbook's own shape is worth stating here because it is the reassuring part:
**there is deliberately no irreversible database step.** Every flag step names its
exact expected prior value, refuses if reality disagrees, and has a restore block
of the same shape. Steps 0 through 6 are fully reversible. Only STEP 7, revoking
the credentials, is one-way, and only after 2026-09-15.

---

## Phase 4 — the n8n replacements

Several n8n webhooks read Linear and will fail when the account lapses. The full
inventory, classification and per-endpoint plan is being prepared as
`docs/independence/N8N_REPLACEMENT_PLAN.md`.

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
