# Graphics flip — current status and path to cutover

> **Living coordination document.** Update it in the same PR as anything it
> tracks. Where this file and `docs/truth/` or `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`
> disagree, **those win** — this is a snapshot of where the program stands and
> why, not a truth doc.
>
> **Public repo.** No client identity, slug, secret, token, or private path
> belongs here. Cohorts are described by counts and team. Owner-held detail
> stays in the owner's private notes.

**Last updated:** 2026-08-28 (video flip) · **Verdict:** **EXECUTED — BOTH team flips are LIVE.** F1(video): `prod_authority` → `{"video":"syncview","graphics":"syncview"}` on 2026-08-28, stamped `owner-runbook` (video-flip day; read the live flags and `flag_flips` to confirm rather than trusting this line). Nothing is Linear-authoritative any more: a Linear edit to ANY team's issue is recorded and discarded, and B1 runs as the insert-only stray-catcher (same-day cutover PR; FLIP_RUNBOOK §F1). The pre-flip health check's item-1 amendment (per-team unexplained-growth gating) took effect in the same PR. Same-day context that does NOT block or qualify the flip: GitHub's cron scheduler was degraded from 2026-08-27 (sparse `schedule` events; the dead-man's switch caught it and paged, correctly) — the flip lanes are all n8n-dispatched and unaffected.

**Superseded graphics-only verdict, kept for history:** **Last updated:** 2026-08-20 (post-flip defect record) · **Verdict:** **EXECUTED — the graphics flip is LIVE.** `linear_outbound_enabled` → `{"mode":"live"}` at 2026-08-16T19:36Z and `prod_authority` → `{"video":"linear","graphics":"syncview"}` at 2026-08-16T19:58Z, both stamped `owner-runbook`; read the live flags to confirm rather than trusting this line. Graphics is SyncView-authoritative: a Linear edit to a graphics issue is recorded and discarded. Video is UNCHANGED and still Linear-authoritative.

> **This line said `NO-GO` until 2026-08-20, four days after the flip.** The file's own header requires it to be updated in the same PR as anything it tracks, and it was not — so the repository's mandated current-status route told any operator the exact opposite of the live state. Found by review on the PR that added `docs/ops/FLIP_BUG_LEDGER.md`, which is a file about writing things down. Recorded here rather than quietly corrected, because it is the same defect class the ledger exists to catch (see its §4-8).

**What happened after the flip:** the flip itself went cleanly; the four days after it produced 36 merged PRs, 12 edge-function deploys and eight hand-applied migrations. Every defect, its root cause, and whether it recurs for the VIDEO flip is recorded in **`docs/ops/FLIP_BUG_LEDGER.md`** — read that before planning the video flip. Open items carried forward are in `docs/ops/OPEN_REPAIRS.md` (items 16-22).

**Superseded pre-flip verdict, kept for history:** **Last updated:** 2026-08-14 (client comment lane incident + fix) · **Verdict:** NO-GO until the go-conditions block in `docs/ops/FLIP_RUNBOOK.md` clears — **engineering gates (F50, F40) CLOSED · flip STAGING DONE (literal GO printed 2026-08-11 ~22:24Z; chain consumed by design) · wave 2 live** · **Verdict basis:** the 2026-08-12 05:48:30Z production write drill FAILED (`production_write_comment_http_409_write_conflict`, `teams_completed 0`, watchdog latch `failing`; a GREEN drill is a hard pre-F2 go-condition, next auto ~04:17Z) and the owner rulings collected in the runbook's go-conditions block (enrollment scope, GO_LIVE_CHECKLIST scope, F133–F138, later waves) are outstanding · **Earliest honest flip date:** 2026-08-14, and the pole is now **a green drill plus owner rulings — not staging, not code**

> **2026-08-13/14 — CLIENT COMMENT INCIDENT, FIX, AND A CHANGED PRE-F1 DECISION.**
>
> - **The incident.** An enrolled client could not leave a comment on her
>   review screen — the UI printed the gateway's raw `comment_forbidden` in
>   red, and her requested change was lost (the card reached "Tweaks Needed"
>   with no instructions). Reported by the client through her SMM, not by any
>   test or alert. Root cause: the gateway's `clientCommentTargetAllowed`
>   (production-write policy) can NEVER authorize a calendar-surface or
>   unlinked-samples client comment, and wave-2 enrollment pointed enrolled
>   clients' comments at that always-locked door — the defect shipped dormant
>   and enrollment armed it. Exposure: the enrolled slugs (5, including the
>   owner's dogfood slug).
> - **The fix (PR #1064).** Route ALL client comments to the legacy n8n lane
>   regardless of enrollment (the only diverted requests are guaranteed 403s),
>   plus the retry-lane amendment: a client comment whose legacy send fails
>   transiently is now stamped `client_link` at enqueue so the outbox drain
>   retries it down the legacy lane instead of zero-retry quarantining it for
>   enrolled slugs. Staff writes untouched; the linked-samples client thread
>   (verified card_id) stays fail-closed on the gateway by design.
> - **The changed pre-F1 decision.** The go-conditions enrollment ruling's
>   premise is stale: enrolling the full roster no longer protects client
>   COMMENTS (only status/approvals). The real F1 choice for comments is now
>   **ship the gateway comment-door repair before F1** vs **explicitly accept
>   full-roster graphics-comment silent darkness post-F1**. Flagged for owner
>   re-ratification in the `FLIP_RUNBOOK.md` go-conditions block, which also
>   carries the new SEQUENCING CONSTRAINT: no wave-3 enrollment until PR #1064
>   is merged AND its Pages deploy completes (enrollment reaches open tabs via
>   the realtime flag subscription; enrolling first replays the incident at
>   ~7x scale).
> - **The systemic lesson.** No client-principal test coverage existed on
>   either comment path — every existing test exercised staff — which is why
>   enrollment could arm a client-facing outage without turning anything red.
>   A client-principal coverage plan is queued;
>   `test/client-comment-lane-routing.js` is its first installment.

> **RESET AUDIT 2026-08-11.** Re-derived from live data and current `main`:
>
> - **F50 closed** — #1053 merged 2026-08-10; both reconcilers pull-only under
>   `syncview`+outbound-live, native vocabulary mapped, ghost strings gone.
> - **F40 closed** — #1054 merged 2026-08-11; the owner's full-window refresh
>   healed the erased label relations (78 → 0 incomplete; 70 of 75 audited rows
>   provable). The floor of 5 (`GRA-4260`–`4264`, outside B1's 12-month import
>   window, no due dates set) is owner-accepted 2026-08-11: PASS at 5.
> - **The §5 "attribution stamp blocks a meaningful soak" section below is
>   STALE** — the claim/provenance split is built and deployed (`production-write`
>   leaves `mapping_revision` empty by design; the reconciler reports staleness
>   on non-gating counters, both 0 on live data today).
> - **Wave 2 enrolled 2026-08-11 15:56 UTC** (`owner-enrollment-wave-2`, five
>   clients — TEST + wave-1 two + the two most active roster clients). First
>   parity write confirmed delivered same hour; a 2-minute watcher guards
>   parity failures/pauses/error events for the new pair.
> - **Still open before F1** *(re-stamped 2026-08-12, flip eve)*: a **GREEN
>   production write drill** — the 2026-08-12 05:48:30Z drill FAILED
>   (`production_write_comment_http_409_write_conflict`, `teams_completed 0`,
>   watchdog latch `failing`, event ids 59028/59044; next auto ~04:17Z) — and
>   the **owner rulings** collected in the `FLIP_RUNBOOK.md` go-conditions
>   block: enrollment scope (5 of 36 roster clients enrolled; post-F1 an
>   unenrolled client's graphics status/comment write commits to the card but
>   is 409-blocked at both n8n authority guards with no gateway leg — it parks
>   silently), GO_LIVE_CHECKLIST scope, F133–F138, later waves.
> - **Resolved since the 2026-08-11 stamp:** item 9 flip staging is **DONE** —
>   the full chain printed the literal `GO graphics_f2_preflight` 2026-08-11
>   ~22:24Z (pre-f2 evidence run `31530468004` PASS on release `7c0822cf`,
>   scheduled drainer `31542047873`; the chain is consumed, flip night rebuilds
>   a fresh one — completion record in `docs/ops/F2_STAGING_CHECKLIST.md`). The
>   scheduled health-check prompt swap is **DONE** (2026-08-11 17:05Z, cron
>   `0 13,1 * * *`, the prompt is now a pointer to
>   `docs/ops/PRE_FLIP_HEALTH_CHECK.md`). And item 14 is now **monitor-only,
>   NOT a pre-F1 backfill**: the non-incremental backfill this bullet used to
>   recommend was **WITHDRAWN 2026-08-12** (`OPEN_REPAIRS.md` item 14 — the
>   full-mode apply cannot reach the item's own specimen, and it REPLACES the
>   parent map from a narrower, staler child set than the one it overwrites,
>   so running it can re-create the exact damage the 2026-08-11 refresh
>   healed). Watch `outbound_parent_mismatch` after F1 instead, and never
>   dispatch the deliverables reconciler with `apply=true` without
>   hand-checking the mismatch list.
> - **Open non-gates:** samples E2E nightly red 27 consecutive nights (fresh
>   triage owed on post-#1045 code); 4 production-polish suites red on `main`;
>   PTO public evidence stale since 2026-08-05 (regenerating commits ~100 UI
>   screenshots to a public repo — owner go-ahead required); item 13's seven
>   terminal mis-filed rows (bounded owner SQL); an ex-staffer still holds 9
>   active Backlog graphics sub-issues, distorting capacity-aware placement.


> **CORRECTION 2026-08-10 (gate audit + fresh-eyes reset):** the claim below
> that "what remains is soak time and evidence, not engineering" was FALSE when
> written — two engineering gates survived the 2026-07-28 re-scope and appeared
> in no flip document. **F50** (creative status projection — post-F1 a graphics
> status change would reach no reviewer/client surface; fix carried by PR
> #1053, merged 2026-08-10) and **F40** (per-team workload authority). See
> OPEN_REPAIRS items 12 and 15 and the FLIP_RUNBOOK banner.
>
> **F40 correction, 2026-08-11.** Item 12 recorded F40 as "unbuilt". It is not:
> the browser already routes a SyncView-authoritative team's due dates to the
> native gateway, so the `team_is_syncview_authoritative` 409 named above is
> never reached. What was not ready is the DATA that native path reads —
> measured against the rows the Workload page actually loads (it filters out
> parked/terminal and off-roster issues first, leaving 80 of 327 for graphics),
> **every audited row could not
> be proven** (75 with a label relation B1 had erased, 5 with no `deliverables`
> row). F40 is therefore a data gate now: `node
> scripts/f40-workload-readiness.js --team=graphics` must report 0, and the
> healing full-window B1 refresh MUST run before F1 — B1 refuses to write a team
> it does not own, so it cannot repair graphics afterwards.
>
> This is also a caution about the sentence below. "What remains is soak time
> and evidence, not engineering" was written from a reading of the code. Both
> F50 and F40 were found afterwards, by exercising paths that no test and no
> running system reaches until the flip itself.
>
> **2026-08-06 — the last code blocker closed.** The write path a designer
> actually uses now works end to end for the first time. What remains before the
> flip is *soak time and evidence*, not engineering. The gate that has held wave
> 1 since it was written — "drill green" — is satisfied, so enrollment is
> unblocked and is now the critical path, because the soak clock is the longest
> remaining pole and it has never started.

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

*(Trued up 2026-08-28 at the video flip; the previous table had silently kept
pre-graphics-flip values — both-linear authority, outbound off, a wave-1
roster — since early August. Same drift class as the header's NO-GO incident
above. Read live flags to verify; this table is a snapshot.)*

| Flag | Value |
|---|---|
| `prod_authority` | `{"video":"syncview","graphics":"syncview"}` (graphics 2026-08-16, video 2026-08-28) |
| `linear_outbound_enabled` | `{"mode":"live"}` (F2, 2026-08-16) |
| `linear_inbound_enabled` | `{"enabled":true}` (since 2026-07-07; detect-only for both teams post-flips) |
| `linear_legacy_parity_enabled` | `{"enabled":true}` |
| `auth_enforcement` | `{"mode":"permissive"}` — owner-accepted, see §6 |
| `client_comment_gateway_enabled` | `{"enabled":true}` (front-door chain step 3, 2026-08-14 rollout) |
| `write_ui_reroute_clients` | full roster — **wave 3 EXECUTED 2026-08-14 16:52 UTC** (`updated_by=owner-enrollment-wave-3-full-roster`); membership tracks the `*_ef_clients` rosters by equality |
| 3 × `*_ef_clients` rosters | identical to each other and to the reroute list (41 at the video flip; the count moves with onboarding — equality is the check) |

**Counters at the video flip (13:03Z 2026-08-28 reconcile summary):**
`outbound_diff_count` video 0 / graphics 107 (detect-only; gate on unexplained
growth per the health check's item-1 amendment) · `repair_list_size` 2 ·
`linkage_actionable` 0 · video `inbound_diff_count` 146 (provenance counter —
not a health signal, do not gate on it).

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
| 1 | **Real clients are still on the legacy write lane.** Flipping now breaks reviewer→designer messages silently (they fail closed into a hidden browser queue) and can drop whole submissions behind a success toast. | **WAVE 1 LIVE — soak clock STARTED 2026-08-07 15:17 UTC** (roccopiazza + edwardmannix; attempt 2, after attempt 1's clean rollback). Preceded same-day by an 11-checker fresh-eyes review: every load-bearing claim confirmed (parity lane delivers to Linear synchronously and independently of `linear_outbound_enabled`; one-step rollback safe mid-flight; no cross-lane double-send per action; both clients' mappings and resolvability clean). Soak target 4–5 clean days → wave 2. Watch lives in the 2x-daily scheduled check, now extended with a soak section: parity `failed`/`legacy_parity_paused` must stay 0, drain/shadow-audit runs must stay green, and activity-without-parity-traffic is investigated as a vacuous-soak warning. One-step rollback: restore `{"clients":["sidneylaruel"]}`. Known accepted risks for the soak: a parity push that fails 8 retries strands silently (caught by red drain runs + the 05:17 daily shadow audit); stale tabs can keep the legacy lane (dilutes but does not corrupt — both lanes end at Linear). |
| 2 | **Designers can only act on tasks assigned to them.** | **Largely closed.** All live unassigned Graphics issues assigned; intake auto-assigns new work (verified live). Post-flip native creation path still to verify. |
| 3 | **Cards carrying a Linear link but no `graphic_deliverable_id` break permanently on first update.** 129 total; 32 are live work across 7 active clients. | **In progress**, see §5. |
| 4 | **Monitoring could not report a failure.** Alarm content destroyed in transit; daily drill red 22+ nights; a cursor bug silently skipped 40 minutes of inbound data on 2026-07-28. | **CLOSED 2026-08-06.** The drill is green, the lane heartbeat reports `ok:true`, and `graphics_approval_artifact` left `parked_assertions` — it is now an enforced assertion rather than one excluded because it could not pass. See §5.1. |
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

**#1018 — REVIEWED 2026-08-06, DO NOT MERGE.** The keyset half was approved
earlier; the six B3 commits had never been reviewed. Four reviewers plus
adversarial verification produced 17 candidates, 16 surviving refutation, three
at P1 (full findings on the PR):

1. The "16th row" hole is only half closed — `cohortPopulationRows` excludes
   cards whose `status`/`graphic_status` is NULL or empty, so an unlisted
   eligible row still passes. That is the one-out/one-in swap the gate exists to
   prevent, on the lane that writes real client cards.
2. `deliverables_b3_exact_url_lookup_idx` is keyed on a function whose EXECUTE is
   revoked from `service_role`; PostgreSQL compiles index expressions as the
   writing role, so direct service-role writes to `deliverables` fail.
   Reproduced on PG 16.13.
3. `exact_scope_not_ready` — the gate stopping a BLOCKED cohort reaching
   production — is unreachable in the suite; every test passes a READY plan.

The P2 cluster shares one shape worth remembering: **the suite confirms the happy
path and stubs out the dangerous one.** `verifyReadback` (the only post-apply
confirmation of live state) never runs, no test supplies a present-but-wrong
`--expected-*` value, `verifyApplyReceipt` only sees valid receipts, and `run()`
is never invoked. A test that still passes when you delete the gate it covers is
not covering it.

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

**Also open (as of 2026-08-06):** roughly 6% of newly created cards still miss
the stamp (down from ~50% in mid-July), so the creation-path leak is not fully
closed. Repairing the backlog without closing the leak is a treadmill.

**RE-MEASURED 2026-08-22 — the leak is closed.** The 6% above kept being quoted
as current for two weeks, so it is now measurable on demand:
`node scripts/card-linkage-leak-check.js --weeks=8`.

Over eight weeks the headline figure is still 6.0% (20 of 331), which is exactly
why a single percentage is the wrong instrument: 14 of those 20 are one day in
July when thirteen cards were bulk-created unlinked and archived hours later.
Split three ways instead:

| Window | created | unlinked | unlinked AND live |
|---|---|---|---|
| week of 2026-08-17 | 43 | 0 | 0 |
| five weeks to 2026-08-22 | 215 | 5 (2.3%) | 1 |
| eight weeks to 2026-08-22 | 331 | 20 (6.0%) | 2 |

An unlinked card that was archived the same day is a discarded draft, not lost
work. Only two live unlinked cards exist in eight weeks, and neither is a leak:
one is a note card holding a document link in its caption (a legitimate use of
the calendar), the other is an empty card created 2026-07-10 and never touched
again — an abandoned blank, clutter rather than damage.

The backlog repair is therefore no longer a treadmill. The abandoned blank is a
real-client row, so archiving it is the owner's call, not this session's.

### 5.1 Monitoring (audit blocker 4) — CLOSED 2026-08-06

Nine defects, each hidden behind the previous. The last two only became visible
once the one in front of them was fixed, which is the whole shape of this
blocker: every green reading before 2026-08-06 was green because the check in
front had already failed.

**Drill run `31124807971`, 2026-08-06:** `graphics_artifact_attached: true`,
`graphics_artifact_rejected: null`, heartbeat `ok:true`, both fixtures settled at
zero diffs, `cleanup_ok: true`, `flags_unchanged: true`. Most importantly
`graphics_approval_artifact` is **no longer in `parked_assertions`** — it had
been parked precisely because it could not pass, and the drill now enforces it.
Only `description_roundtrip` remains parked.

1. Description round-trip — undeployed Edge Function; **still parked** (the only
   one left)
2. Graphics approval artifact / asset probe — the probe rewrote the Drive URL to
   a form its own allowlist rejected, so it refused its own link at hop 0.
   **Fixed** (#1026, deployed as `production-write` v30). The owner was sent to
   re-check Drive sharing twice on a wrong diagnosis; his file and settings were
   correct throughout. Live proof: `result_code: asset_available`,
   `http_status: 206`, `probe_completed: true`
3. Self-poisoning cleanup loop — `linear-outbound` returns `ok: counts.failed === 0`, an aggregate over every row the invocation selected. One stale failed row made every subsequent drain report failure, which failed the drill's cleanup, which created another failed row. **Fixed**
4. A whole-estate linkage figure gating a client-scoped drill — **fixed**
5. Crashed-drill residue with no collector — **fixed**
6. Whole-client gating on a shared TEST client — **fixed** (per-fixture reconciliation)
7. Attribution stamp mismatch — **fixed and deployed.** See below; the section is
   retained because its §8 diagnosis (the deployed gateway wrote *no* stamp at
   all, so the live comparison was 12-against-0, not 12-against-10) is the record
   of how a source-only reading of a defect can be confidently wrong
8. **TEST fixture filed in an unowned project — fixed 2026-08-06 (config).** The
   Graphics drill fixture was created in the shared `Test Project`, which no
   client owns, so its stamp honestly read `direct_project_unmapped` and diffed
   forever. Video's fixture was in `Sidney Laruel`, which the TEST client *does*
   own, and settled clean — that asymmetry is what located it. Fixed by pointing
   `B4_TEST_PROJECT_BY_TEAM` at the owned project for both teams. Deliberately
   NOT fixed by adding `Test Project` to the client's `linear_project_ids`: that
   would assert an ownership the roster cannot confirm, which is the exact
   over-claim `intakeAttribution` refuses to make
9. **The graphics attach could never succeed — fixed 2026-08-06.** Two defects in
   one function, invisible until the probe fix let a request reach them, and
   together they meant the button failed whether or not a card was linked. See
   §5.2

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

### 5.2 The graphics attach — CLOSED 2026-08-06

`public.production_artifact_write` refused **every** graphics attach, either way
it was called. Neither failure had ever been executed: the asset probe failed
earlier in the chain, so nothing reached them until #1026 shipped.

- **No card linked →** `artifact_card_projection_scope_invalid`. The scope
  predicate refused every origin other than `manual` regardless of `card_id`.
  Intake stamps a new deliverable `calendar` at birth and it acquires its card
  later, so **1,887 of 2,160 graphics rows — 214 of them mid-approval** — could
  never be attached to.
- **Card linked →** `artifact_card_projection_failed`. The projection wrote
  `thumb_rev='artifact-N'` then verified by reading that value back, but
  `syncview_thumbnail_thumb_rev_before_write` fires on
  `update of thumbnail_url` and overwrites it. That trigger is the owner's
  before/after and cache-busting mechanism and `thumbnail_revision_v2` is
  `{"mode":"on"}`, so the readback matched zero rows **for every active client**
  and rolled the `file_url` attach back with it.

Fixed in `migrations/2026-08-06-artifact-projection-scope-and-revision.sql`.
Both defects were **reproduced and then re-proven fixed on a disposable
PostgreSQL 16** using the real trigger extracted verbatim from its shipped
migration — `test/artifact-projection-scope-and-revision.js` asserts the OLD
definition still fails both ways, so the regression cannot return silently.

Two repairs were deliberately NOT made: the projection readback was not relaxed
to a row count (the contract is *exactly one row in the intended state*), and
the scope predicate was not widened past a null `card_id` — a row that NAMES an
unprojectable card must still refuse, or that card keeps a stale thumbnail while
the deliverable claims a new one. Recorded in `ROLLBACK.md`.

**No Edge Function deploy was required.** The gateway calls this RPC by name, so
replacing the function took effect immediately.

### 5.3 Edge Function deploy — done, and the lane is no longer owner-blocked

Three dispatches landed 2026-08-05 (`production-write` 27 → 30; the other three
byte-identical). Deployed versions and source-closure hashes are in
`EXECUTION_LOG.md` under `syncview_f27_section4_deployed_versions_v1`.

**The rollback-bundle blocker is permanently closed.** The lane locates its
sealed bundle by an exact content-addressed filename inside a Shared Drive root
identified only by a hash; a manual upload cannot satisfy that contract, which
cost most of an evening and one wrong instruction to the owner. The reviewer now
holds the folder and credential and performs capture *and* store before each
dispatch, so the owner's cost is one dispatch.

**Standing rule, learned the hard way:** the sealed bundle must postdate the most
recent deploy and **the lane will not tell you if it does not** — every check
verifies the bundle's own integrity, never its currency. Deploy #3 knowingly
reused a bundle one release stale; see `ROLLBACK.md`.

**F51 is closed for these four functions** and open everywhere else.

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

1. ~~Drill green on both teams~~ **DONE 2026-08-06** (run `31124807971`) · #1020 merged · #1018 reviewed and blocked on three P1s · #1019 behind it
2. ~~Stamp fix designed → approved → landed~~ **DONE**; pins regenerated
3. ~~**One** four-function deploy~~ **DONE** — three dispatches, `production-write` at v30
4. ~~TEST client's Graphics project registered~~ **DONE 2026-08-06** — fixed at the drill config rather than by over-claiming roster ownership
5. ~~Enrollment re-attempt → soak clock starts~~ **DONE** — wave 1 executed 2026-08-07 15:17 UTC (soak clock started); wave 2 executed 2026-08-11 15:56 UTC (five clients; parity clean, 35+ writes / 0 failures). Note #1018 is NOT a prerequisite: it repairs 33 broken card links, which is a client-facing annoyance *after* the flip, not a cutover gate
6. In parallel: correct the zero-extra contract, re-baseline or recover the cohort manifest, Gate 3 dry-run, Gate 4 apply, close the creation-path leak, then plan the remaining 17 cards
7. ~~Wave 2~~ **DONE 2026-08-11** → the remaining roster is an **OWNER RULING** (see the `FLIP_RUNBOOK.md` go-conditions block): enroll the full roster before F1, or accept named darkness for unenrolled clients until they are enrolled; merge #1010 and #1015 between waves
8. **← YOU ARE HERE. Flip day** (staging chain proved 2026-08-11 and consumed; a GREEN write drill and the owner rulings above are hard preconditions): re-run pre-f2 → freeze `main` → `scripts/graphics-f2-preflight.js` must print `GO` → clear-air window (n8n drainer-dispatch node disabled with owner approval, kept disabled until post-f2 PASSes) → **F2** → owner-attested drain + post-f2 evidence → **F1** → unfreeze
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
