# Graphics flip — current status and path to cutover

> **Living coordination document.** Update it in the same PR as anything it
> tracks. Where this file and `docs/truth/` or `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`
> disagree, **those win** — this is a snapshot of where the program stands and
> why, not a truth doc.
>
> **Public repo.** No client identity, slug, secret, token, or private path
> belongs here. Cohorts are described by counts and team. Owner-held detail
> stays in the owner's private notes.

**Last updated:** 2026-08-05 · **Verdict:** NO-GO · **Earliest honest date:** late August 2026

---

## 1. What "the flip" is

Move the Graphics team off Linear onto SyncView. It is **two owner-run SQL
statements**, in this order (`docs/ops/FLIP_RUNBOOK.md`; rule F98 — never
reverse them):

1. **F2:** `linear_outbound_enabled` → `{"mode":"live"}`, while authority is still `linear/linear`
2. **F1:** `prod_authority.graphics` → `"syncview"`

`prod_authority` has **no per-client dimension**, so a partial team flip is
impossible by construction. The designer moves to SyncView for every client at
the same moment. Linear stays readable for roughly a week afterwards (D-22).

**Enrollment is a different switch.** `write_ui_reroute_clients` decides, per
client, whether staff writes travel the legacy n8n bridges or the native
gateway. **Both end at Linear.** Enrolling a client changes nothing the design
team can see; it is the soak mechanism, not the cutover.

---

## 2. Live posture

| Flag | Value |
|---|---|
| `prod_authority` | `{"video":"linear","graphics":"linear"}` |
| `linear_outbound_enabled` | `{"mode":"off"}` |
| `linear_inbound_enabled` | `{"enabled":true}` (since 2026-07-07) |
| `linear_legacy_parity_enabled` | `{"enabled":true}` |
| `auth_enforcement` | `{"mode":"permissive"}` — owner-accepted, see §6 |
| `write_ui_reroute_clients` | TEST client only; enrollment attempt 1 rolled back |
| 3 × `*_ef_clients` rosters | 34 entries each, identical |

**Counters:** `outbound_diff_count` 0 · `repair_list_size` 27 (24 video / 3
graphics) · `linkage_actionable` 31–33 · `inbound_diff_count` ≈4,358 (stamp-age
counter from PR #920 — not a health signal, do not gate on it).

**F27 per-team rollback:** installed and production-verified 2026-08-02,
`F27_FINAL_VERIFICATION_OK`, 17/17. Docs corrected in #1017.

**Database:** four partial indexes live (worst query cost 4688 → 0.85).
`57014` statement timeouts persist on uncovered shapes; root cause is unbounded
lifetime reads, fixed by #1018 (reconciler) and #1019 (browser comments), both
unmerged.

---

## 3. Readiness audit, 2026-08-04 — NO_GO

Sixteen-agent adversarial audit (verify → refute → synthesize) run against live
data and current `main`, covering all 14 `B4_READINESS.md` gates plus non-gate
flip conditions. Five real blockers survived refutation.

| # | Blocker | Status |
|---|---|---|
| 1 | **Real clients are still on the legacy write lane.** Flipping now breaks reviewer→designer messages silently (they fail closed into a hidden browser queue) and can drop whole submissions behind a success toast. | **In progress.** Wave 1 cohort selected (2 clients, one SMM, briefed). Attempt 1 executed and cleanly rolled back on a failed TEST proof. Soak clock has **not** started. |
| 2 | **Designers can only act on tasks assigned to them.** | **Largely closed.** All live unassigned Graphics issues assigned; intake auto-assigns new work (verified live). Post-flip native creation path still to verify. |
| 3 | **Cards carrying a Linear link but no `graphic_deliverable_id` break permanently on first update.** 129 total; 32 are live work across 7 active clients. | **In progress**, see §5. |
| 4 | **Monitoring could not report a failure.** Alarm content destroyed in transit; daily drill red 22+ nights; a cursor bug silently skipped 40 minutes of inbound data on 2026-07-28. | **Major progress, not green.** See §5. |
| 5 | **Runbook traps** — stale "rollback unusable" text and unguarded copy-paste blocks. | **Closed** (#1017, #1021). |

**Cleared as stale documentation, not real blockers:** creative-regression risk
(fixed and drilled 2026-07-26/28), collapsed video assets (fixed; video-only),
drag-only reordering (owner-waived), duplicate-write risk at F2 (**none** — n8n
guards verified armed in the live workflows), inactive-client residue (3 rows,
not the documented 67), identifier seeding (a B5 concern), mirror identity
(done), the webhook count dropping 4→2 (deliberate retirement, 2026-07-17).

---

## 4. Pull requests

**Merged:** #1011 (owner-attested F2 drainer dispatch — removed the scheduled-
drainer dependency; proven live) · #1016 (client review-token auto-provision +
backfill) · #1017 (F27 documentation correction) · #1021 (Graphics F2 hard
preflight gate).

**Open, reviewed, approved — merge in this order:**

| PR | Scope | Gate |
|---|---|---|
| #1020 | Monitoring: alert-relay contract, watchdog + dead-man's switch, refresh-cursor safety, drill fixes, F27 closure re-pin (9→11 files, independently verified) | Merges **first**, on the drill going green |
| #1018 | Reconciler keyset pagination for five support readers; proof-harness isolation + identity guard | After #1020. **Must rebase and recompute** its `f27-reconciler-closure.js` pin — both PRs edit it — then re-run the acceptance proof on the rebased head |
| #1019 | Bounded canonical comment read (up to 40 requests → 1); fixes the staff-facing `canonical_comment_read_required` failure | After #1018. Needs a separate owner-gated Edge Function deploy plus observation window. Follow-up filed: threads over 1,000 comments return a permanent 409 — alert before the cliff |

**Parked:** #1010 (canonical post title) and #1015 (native-ID rendering
containment) — rebase and merge **between soak waves**; #1010 softens one of the
enrollment rough edges.

**Closed unmerged:** #901 (superseded record asserting F27 was not installed),
#908 (dead harness).

### Main-freeze protocol
`main` is **not** frozen day to day. It freezes only between pre-f2 evidence
capture and post-f2 completion on flip day. A merge inside that window
invalidates the binder (`pre_post_binder_mismatch`). This occurred once; because
#1011 had landed, recovery was about ten minutes.

---

## 5. Open work

### Owner-requested UX, recorded 2026-08-06 so it is not forgotten

- **Calendar card → Production navigation: SHIPPED** (PR #1027). Cards that
  carry a native deliverable id now show a teal icon beside the Linear icon
  (video and graphic independently) opening `?prod=1` detail in a new tab.
  Staff-only, render-only, nothing new is written. Legacy cards without native
  linkage show nothing new.
- **Link an existing Production issue to a calendar card afterwards: NOT
  BUILT, wanted.** A `New issue` creation is born card-less and there is no
  safe user-facing way to connect it to a card later. A card-side-only paste
  is actively dangerous (the F42 crosswalk treats a half-link as broken and
  the legacy-comment fallback exists precisely because a bad link can wipe a
  card's comment history). The correct shape is a bounded two-sided link write
  — the same contract the B3 scoped-repair lane establishes. Build it AFTER
  the B3 lane lands and reuse its validation. Owner explicitly asked for this
  on 2026-08-06.

### Card linkage repair (audit blocker 3)
Cohort of 32 live cards splits three ways: **15** repairable by the existing B3
planner; **14** archive-backed, needing a reviewed promotion lane; **3** with no
deliverable and no archive row, needing a bounded two-sided creation repair.

A scoped transactional RPC is **installed** (9/9 functions, service-role-only
execute, PUBLIC/`anon`/`authenticated` at zero, zero rows written by the
install). It applies all 15 or none, and keeps the global sweep visibly
`BLOCKED` with its 266-failure digest unchanged rather than painting it green.

**Gate 3 (dry-run) is blocked, correctly.** The retained evidence holds only
aggregates, not the original per-row manifest, so set equality cannot be
certified without regenerating "requested" from today's eligible rows — which
would be circular and could hide a one-out/one-in swap. Source review also found
the runner accepts a manifest without rejecting an unlisted 16th eligible row;
that zero-extra contract must be corrected and proven before Gate 4.

**Also open:** roughly 6% of newly created cards still miss the stamp (down from
~50% in mid-July), so the creation-path leak is not fully closed. Repairing the
backlog without closing the leak is a treadmill.

### Monitoring (audit blocker 4)
Seven defects, each hidden behind the previous:

1. Description round-trip — undeployed Edge Function; **parked**
2. Graphics approval artifact — the probe rejects Google Drive's 303 redirect. **The committed source already follows it**; the deployed function is older. F51 class. **Parked on deploy**
3. Self-poisoning cleanup loop — `linear-outbound` returns `ok: counts.failed === 0`, an aggregate over every row the invocation selected. One stale failed row made every subsequent drain report failure, which failed the drill's cleanup, which created another failed row. **Fixed**
4. A whole-estate linkage figure gating a client-scoped drill — **fixed**
5. Crashed-drill residue with no collector — **fixed**
6. Whole-client gating on a shared TEST client — **fixed** (per-fixture reconciliation)
7. **Attribution stamp mismatch — highest open priority.** See below

### The attribution stamp defect (blocks a meaningful soak)
`production-write` stamps created rows with a 10-key attribution object and an
empty `mapping_revision`. The reconciler independently computes a 12-key object
— including `ancestor_issue_id`, `ancestor_distance`, and a real
`mapping_revision` — and compares the whole object. The two can never match.

**Consequence:** every row the gateway creates diffs immediately on
`client_attribution`. Measured: **1 diff per created row** when the project is
mapped, **2 plus a repair** when it is not. Direction confirmed **outbound**
(inbound was 0 on both teams), and after the flip a rerouted client's team is
`syncview`, so these land in `outbound_diff_count` — the counter the soak
exists to watch. Scheduled reconciliation is dry-run, so nothing heals them:
the count rises monotonically with healthy traffic.

Only `production-write` is affected. `deliverable-write` and `batch-write`
preserve existing `linear_raw` rather than creating stamps; the B1 incremental
refresh uses the same code path as the reader.

**Agreed design** (`docs/audits/2026-08-05-attribution-stamp-soak-signal.md`):
separate the **claim** (state, client, owner kind, source, project ids, ancestor
path, repair flag, reason — compared strictly) from the **provenance**
(`mapping_revision` — reported on a non-gating staleness counter, not diffed).
Writing the full 12 keys including a live `mapping_revision` was rejected: that
value hashes the entire roster and mapping table, so every stamp in the system
would go stale at once whenever a client is onboarded or offboarded — trading a
steady per-row defect for fleet-wide bursts correlated with business events.
Widening the comparison was rejected as removing real detection.

### Edge Function deploy
One dispatch (`deploy-f27-section4-closures.yml`) ships **four** functions
together: `linear-outbound`, `production-write`, `deliverable-write`,
`batch-write`. All four candidate fingerprints currently equal `main`; the lane
refuses on drift, requires a verified sealed prior-version bundle before any
forward deploy, and read-backs `ACTIVE` / `verify_jwt=false` afterwards.

**Deferred deliberately.** It fixes the artifact probe and probably the
description round-trip, but not the stamp defect or the project-mapping gap. The
stamp fix must land on `main` and the lane's pins be regenerated first, so a
single deploy carries everything and the four-function blast radius is taken
once, not twice. Deploying while only the TEST client is enrolled is the
smallest window that will exist.

**F51 remains open:** nothing in the repository attests what is *currently*
deployed. Both of the day's surprises traced to that gap.

---

## 6. Owner decisions on record

1. **Auth risk accepted** (2026-08-04) — real-client cohort enrollment proceeds
   with `auth_enforcement` permissive, per `B4_READINESS.md` WP-A6 option (b).
   Engineering cannot close it under the standing no-rotation constraint, and the
   legacy lane it replaces carries no authentication at all. Scope: cohort
   enrollment for the Graphics migration. The flag itself is untouched.
2. **No credential rotation.** Standing.
3. **Drag-only reordering: waived.**
4. **Wave 1** is two clients under a single SMM, both free of linkage defects.
   The quieter pairing is accepted, so the soak reads over 4–5 days rather than 2–3.
5. **Every Graphics issue carries an assignee.**
6. **n8n workflows are production sales automation** — read freely, never edit
   without explicit owner go-ahead.
7. **Deploy sequencing:** stamp fix first, then one four-function deploy.

Pending, none blocking: approve the stamp-fix implementation; Gate 4 apply for
the 15-card cohort; disposition of a large duplicate backlog batch; whether to
identify or accept the unattributed nightly process editing Linear due dates;
capacity/egress review; recording designer sign-off; soak length.

---

## 7. Path to cutover

1. Drill green on both teams → merge #1020 → #1018 → #1019
2. Stamp fix designed → approved → landed on `main`; regenerate deploy-lane pins
3. **One** four-function deploy (probe + round-trip + stamp together)
4. TEST client's Graphics project added to the client mapping (owner action)
5. Enrollment re-attempt in a held window with no concurrent TEST dispatches → **soak clock starts** (4–5 days)
6. In parallel: correct the zero-extra contract, re-baseline or recover the cohort manifest, Gate 3 dry-run, Gate 4 apply, close the creation-path leak, then plan the remaining 17 cards
7. Wave 2 once the linkage cohort is repaired → remaining roster → about one clean week; merge #1010 and #1015 between waves
8. **Flip day:** re-run pre-f2 → freeze `main` → `scripts/graphics-f2-preflight.js` must print `GO` → clear-air window → **F2** → owner-attested drain + post-f2 evidence → **F1** → unfreeze
9. If the first post-F2 drain fails: F2 rollback → fresh pre-f2 → reflip. Roughly 30 minutes, documented in `FLIP_RUNBOOK.md`
10. Post-flip: Linear readable ~1 week; F27 is the tested reversal; remaining Edge Function deploys

---

## 8. Flip-night failure mode (found and mitigated)

`linear-outbound` returns `ok: counts.failed === 0`, an aggregate over every row
the invocation selected. The drain workflow requires `.ok == true`; the evidence
lane rejects a non-`success` conclusion (`drainer_terminal_not_ok`, and
`outside_observer_absent` at the observer check); and the post-f2 drainer must be
the **first** eligible run after F2 — a later success cannot substitute
(`post_drainer_not_first_eligible_after_f2`).

So a single selected-row failure in that first run makes post-f2 evidence
unobtainable for that attempt. Two scope corrections apply: only rows that
invocation selects count (TEST-only rows are excluded from production drains),
and non-parity SyncView writes remain paused while authority is `linear/linear`,
so parity rows and infrastructure faults are the live exposure.

**Mitigation** (#1021): a machine preflight that refuses unless production
`pending`, `failed` and `shadow_ok` are all zero across every team and both
parity lanes, regardless of attempt count or retry time; a clear-air timing rule;
and a documented ~30-minute recovery. It reduces but cannot eliminate the risk —
the runbook says so explicitly rather than implying a green preflight guarantees
a passing first attempt.

Narrowing the assertion to "the caller's own rows" was considered and
**rejected**: the F2 dispatch owns no outbox row, so the scope is undefined, and
narrowing would conceal parity failures and rows terminalised as `skipped`.

---

## 9. Coordination rules for concurrent sessions

Several sessions work this program in parallel. These rules are not style
preferences — each one was learned from something that went wrong on
2026-08-04, and the first one cost a rolled-back enrollment.

- **Announce before dispatching any TEST-mutating run.** A monitoring drill
  collided with an enrollment proof, failed it, and forced a rollback. The
  drill lanes are now opt-in via explicit commit-message markers, so a push
  without a marker dispatches nothing.
- **Never run a TEST drill during an enrollment proof window.** The §F6 proof
  depends on the daily drill; a concurrent drill fails it. Hold a clear window.
- **A session's turn ends when it reports.** It does not keep working in the
  background, and a run left in flight sits finished and unread. If a run must
  be watched to completion, say so explicitly.
- **Verify claims rather than accepting them — including claims from review.**
  Several review conclusions were overturned by sessions during this period,
  correctly each time: a "fix the probe" instruction that the committed source
  already implemented, a scoping claim that was broader than the code, and a
  deploy-lane pin read as stale that was pinned to a path string rather than
  file contents. The reviewer being wrong is an ordinary event; say so.
- **Fix the code, not the test.** Where a proof was corrected, the correction
  had to be shown to preserve or strengthen what the proof asserts. A
  concurrency test whose race was removed to make it pass is not a fix; one
  case was rebuilt on advisory barriers and lock inspection instead.
- **Report a failure at the boundary you actually proved.** "The repository
  source accepts this" and "the deployed function accepts this" are different
  claims, and conflating them sent the owner to re-check work he had done
  correctly. Nothing in this repository attests what is deployed (F51).
