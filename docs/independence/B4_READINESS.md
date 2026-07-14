# B4 Readiness — gate evidence, auth operationalization, road to writable

**Date:** 2026-07-11 · **Status:** living checklist (update in the same PR as any item it tracks)
**Authority:** `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` defines every phase, gate, and design here —
where this file and the spec disagree, THE SPEC WINS. This file is the operational bridge: what
is live right now, evidence per gate item, who owns each remaining step, and the plain-language
answers to the owner's standing architecture questions.

## 1. Live posture (verified 2026-07-11, UTC)

| Metric | Value | Evidence |
|---|---|---|
| Mirror faithfulness (`diff_count` / `repair_list_size`) | 0 / 0 sustained; only single-run transients that self-clear on the next 15-min tick | reconciler v2 summary events in `deliverable_events` (e.g. events 7743–7746) |
| Pending card linkage (`linkage_actionable`) | **0** since 2026-07-11 03:22 UTC (drained 31 additive slot fills; residue 208 all classified non-actionable) | events 7744 (before) → 7746 (after); EXECUTION_LOG 2026-07-11 |
| Mirror coverage | all 4,323 deliverables checked, zero-row gap closed | event 7746 `deliverables_checked` |
| History parity | finished-work import complete: 3,187 deliverables + 800 batches, tag `created_by='history-backfill-2026-07-10'`, one-command rollback documented | EXECUTION_LOG 2026-07-10/11; ROLLBACK.md Live State |
| Inbound mirror | `linear_inbound_enabled={"enabled":true}` since 2026-07-07 23:17; fresh `mirror_in_*` events daily | `syncview_runtime_flags`; `deliverable_events` source=`mirror` |
| Reconciler cadence | ~15 min via the n8n monitoring pager; run duration ~110–150 s at full 4,323-row scale | GitHub Actions run history; summary event `started_at`/`finished_at` |
| Track A | COMPLETE and closed out 2026-07-10 (3-day audit: zero real-client fallback on all seven legacy write webhooks; ledgers clean; full-roster drift sweep clean) | EXECUTION_LOG 2026-07-10; ROLLBACK.md rows |
| Auth mode | `auth_enforcement={"mode":"permissive"}` (fail-open; flip rehearsed 2026-07-05) | flag + ROLLBACK.md B0 row |

## 2. B3 → B4 gate checklist (spec §14 L1115–1122 + §1.5)

| # | Gate item (spec wording) | Status | Owner |
|---|---|---|---|
| 1 | Mirror zero-diff (modulo §1.4) **7 consecutive days** | ✅ **RATIFIED reading (owner, 2026-07-11):** gate is met when **both** hold — (i) the **B3 inbound scenario harness** (`scripts/b3-mirror-scenario-harness.js`, full matrix) passes green with reconciler v2 at 0/0/0 through it, providing *positive correctness proof*; **and** (ii) diff/repair faithfulness stays clean over the soak (the spec §14 "7 days", §1.4d transients tolerated; linkage verified 0 at decision — it re-accrues from inflow by design and is a maintenance lane, not a faithfulness signal). The harness supplies coverage the passive soak can't; the soak supplies time-based stability the harness can't. Earliest ~2026-07-15. | Owner |
| 2 | Comments webhook subscribed + catch-up pull run (§4.3.4) | ✅ reconciler webhook probe: 4/4 enabled, `missing_comment_resource=0`; comment catch-up ran in B3 stage 3 | evidence in v2 summary `webhooks` block |
| 3 | Echo probe green (§12) | ✅ 2026-07-11 TEST probe: one app comment produced one Linear comment and remained exactly one app-thread entry after both Comments webhooks settled; zero duplicate `mirror_in_comment_add` events; Linear creation 3.096 s, settled proof 11.543 s; all TEST mutations restored | Codex |
| 4 | Editor/SMM UX feedback collected | ⏳ ongoing via the owner's feedback-expansion loop; needs an explicit "team tried the tab" note | Owner |
| 5 | Outbox drain + zero-diff + linkage-zero report (§1.5.3) | ⏳ linkage-zero done (event 7746); formal per-team report at flip time | Codex |
| 6 | Legacy-writer gates verified (reconcilers + n8n bridges) | ⏳ at flip time per team | Codex |
| 7 | Identifier seed check | ⏳ at flip time | Codex |
| 8 | Flip + rollback rehearsal (`prod_authority[team]` → and back) on TEST | ⏳ not yet run | Codex + Owner |
| 9 | Detect-only foreign-write alert tested | ⚠️ BLOCKED in this sprint: the live branch is reachable only when a team's `prod_authority` is `supabase`; both teams remain `linear`, and the sprint forbids every runtime-flag change. Source coverage is green but is not counted as live gate evidence. | Codex + Owner |
| 10 | Nightly due-date roller located AND disabled (D-9, with spec fallback) | ⚠️ BLOCKED on workspace-owned automation access; live signature and disable plan are recorded below. Nothing was disabled. | Codex + Owner |
| 11 | Dedicated Linear mirror identity distinct from the house account (D-18) | ❌ not created — owner action in Linear (dedicated user or OAuth app), key stored as EF secret only | Owner |
| 12 | Editor/SMM sign-off + DR drill | ⏳ | Owner |
| 13 | **Auth prerequisite (§6, this file §3):** write attribution enforced before any real write phase | ⏳ WP-A1/A2 live and proven; WP-A3 staff sign-in is live; the account-menu + sensitive-surface role consolidation is implemented in the current draft, while permissive telemetry and the enforcement gate remain | Owner + Codex |

## 3. Auth — operationalizing spec §6 (design is already owner-ratified; do not redesign)

**Locked design (D6):** three role keys — `ROLE_KEY_ADMIN` (owner + reviewer), `ROLE_KEY_SMM`,
`ROLE_KEY_CREATIVE` — sent as `X-Syncview-Key` (timing-safe) + `X-Syncview-Actor` (name picked
from the `team_members` roster, not free text). Client review links stay no-login, gated by
per-client minted tokens verified server-side (`client-token-verify`, live). Single flip:
`auth_enforcement` `permissive ⇄ enforced`; rollback = set back to `permissive` (rehearsed).

**Already built (verified in repo + live):** B0 tables (`team_members`, `clients`,
`client_access` service-role-only, `client_access_events`, `syncview_auth_events`, `flag_flips`),
`client-token-verify` EF (timing-safe compare, permissive-mode logging, 410 on enforced+invalid,
FE blocks on a fresh 401/410/enforced-fail), `key-verify` EF, role/actor header plumbing on write
paths, flag-flip audit trigger. **F38 correction:** the frontend currently allows and positively
caches verifier 500/network/parse failures, and a cached allow bypasses later 410 revocation in the
same tab. This is acceptable only during the explicitly permissive epoch and blocks WP-A5.

**Remaining work-packages, in order:**

| WP | Status | What | Notes / rollback |
|---|---|---|---|
| WP-A1 | ✅ DONE 2026-07-11 | Every staff write EF now persists `X-Syncview-Actor` / `X-Syncview-Role`: calendar/sample upserts and reorders use their card event ledgers; template/caption-prompt saves use additive service-only `settings_events`. One disposable TEST write per EF proved all six paths and cleanup restored the two settings rows exactly with zero probe rows/events left. | Re-deploy the private pre-WP-A1 function snapshots; the additive `settings_events` table may remain dormant. No routing flag is involved. |
| WP-A2 | ✅ DONE 2026-07-11 | The three role keys were already minted in EF secrets. Their deployed digests match the private B0 backup, and `key-verify` resolved compatible active roster rows for admin, SMM, and creative in permissive mode (proof events 3–5). | Secrets only; no key material is committed. Rollback is unnecessary while auth stays permissive; remove/rotate a role secret only for credential compromise. |
| WP-A3 | ✅ DONE + LIVE 2026-07-11 | The §6.1 active-roster sign-in is on `main`: no free-text actor, role key stored locally, boot revalidation through `key-verify`, verified key/actor/role on Supabase EF requests only, normal Production navigation after verification, direct `?prod=1` diagnostics preserved, 401 clear, and verifier-outage fail-open. Dummy-only desktop/mobile coverage is green. Production “My issues” still ignores that identity (F37). | Revert the WP-A3 frontend commits; operational fail-open is tolerated only while `auth_enforcement={"mode":"permissive"}`. F37/F38 must close before creative authority or enforcement. |
| WP-A3b | 🔄 IMPLEMENTED IN DRAFT 2026-07-11 | One signed-in identity now owns every sensitive staff surface. The staff button opens an account popover (`Signed in as <name> · <Role>` + **Sign out**, no switch-user path); the full form exists only signed out. Credentials accept admin + SMM role keys, while unstripped onboarding and filming-plan writes accept admin only. The server derives role from the matching secret and keeps `CREDENTIALS_STAFF_KEY` / `ONBOARDING_STAFF_KEY` compatibility in parallel. Sign out and invalid-key 401 purge sensitive credential/onboarding UI + caches; recognized-but-disallowed 403 preserves the valid session. | Release backend first by manually dispatching the deploy workflow from the feature branch and verifying it green, then merge Pages. Roll back the frontend first while leaving additive backend support deployed; only then consider a separate backend rollback. Both legacy secrets remain unchanged. Do not retire them until every non-browser caller is inventoried and identifier-only telemetry proves zero legacy use through an owner-approved window. |
| WP-A4 | ⏳ BLOCKED BY F35 | Add credential outcomes to every actual Track-A write, then measure those write attempts over real traffic; **gate: zero unkeyed writes for 72 h**. `syncview_auth_events` sign-in-only rows cannot prove this. | no behavior change |
| WP-A5 | ⏳ OWNER GATE — BLOCKED BY F35/F38 | After every write door enforces auth and client verifier failures/revocation fail closed, flip `auth_enforcement` → `enforced` (owner action). | flip back = one flag; do not use rollback as a substitute for revocation correctness |
| WP-A6 | ⏳ OWNER DECISION | Owner decision: keep D6 (3 shared role keys + per-person actor from roster) or upgrade to per-person credentials. **Recommendation: keep D6 through B5; revisit after cutover.** Every write already carries a per-person actor name + role for the audit trail either way. | decision only |

## 4. Readiness-sprint probe ledger (2026-07-11)

| Probe / work item | Status | Evidence / next safe step |
|---|---|---|
| B3 legacy-comment echo (§12) | ✅ DONE | `scripts/b4-comment-echo-probe.js` snapshots the TEST deliverable thread, seeds one app comment through `deliverable_write`, sends the matching legacy Linear comment, proves exactly one app copy and no duplicate inbound event, then deletes the Linear comment and restores the original thread. Proof events `7769`–`7770` retain the audit trail; the TEST issue ended with its original two Linear comments and zero app comments. |
| B4 strict-AND outbound echo + TEST create→status→comment→due (§1.5.6) | ✅ DONE 2026-07-11 (staged dark) | `linear-outbound`, guarded write wrappers, and the durable outbox are deployed behind `linear_outbound_enabled={"mode":"off"}`. Final fail-closed run `b4-1783817733488-ff8283` passed 17/17: shadow (4 intended writes, zero Linear mutations), then live TEST create/status ladder/atomic local-first comment/due/assignee/title/priority/parent/archive/restore, 23 strict echo drops with zero unexpected mirror events, pause/resume newest-edit-wins using the authenticated source-edit clock, mid-drain off, idempotent re-drain, cleanup, and reconciler 0/0/0. No production authority or runtime flag changed. |
| Detect-only foreign-write alert (§1.5.8) | ⚠️ BLOCKED | `linear-inbound` records `foreign_write_detected` only when the affected team's authority is `supabase`. With both teams Linear-authoritative and runtime-flag changes forbidden, no truthful live drill is possible. Next step is an owner-approved TEST-only authority override and immediate rollback; do not count the source test as gate evidence. |
| D-9 nightly due-date roller | ⚠️ BLOCKED | On 2026-07-10, 41 VID/GRA issues were touched from 23:45:28–23:45:35 UTC. Linear showed no visible field-change history and neither inbound webhook path received a material event, consistent with a hosted job re-saving an already-equal due date. A fresh read-only audit of all 127 live n8n workflows found no scheduled `issueUpdate`; the only due-date writer is the webhook-only status bridge and it had no execution during the burst. Repository Actions are also read-only at that time. The connected Drive identity cannot see the operational sheets or bound Apps Scripts. **Disable plan (owner action, not executed):** inspect Triggers and bound Apps Script under the workspace sheet-owner accounts; disable, do not delete, the 23:45 trigger; observe two nights. If absent, use the spec fallback: inventory and rotate remaining legacy personal Linear keys in a controlled window while keeping scoped due-date tolerance in detect-only monitoring. |
| B1 incremental-refresh heartbeat | ✅ DONE / LIVE | Private pre/post snapshots bracket n8n pager `qllIDZPkdNAPRj0b`. First live tick `244578` dispatched GitHub run `29143764570`, which completed green and wrote summary event `7772` (2 changed issues; 1 archive upsert). The prior summary was 103 minutes old, so the new stale condition emitted one identifier-free DM and the Slack node succeeded. Intervening tick `244646` proved the cadence gate: zero gate items, no incremental trigger, zero alerts. The active 15-minute pager therefore dispatches every ~30 minutes and pages when no summary is fresh within 90 minutes. Disable `Gate Incremental Refresh 30m` to stop only this dispatch, or disable the pager for the global kill switch. |

## 5. Plain-language answers (owner questions, 2026-07-11) — with spec citations

**"The cards and the new-Linear sub-issues are the same thing, right?"** Almost — they stay two
linked rows, on purpose (locked decision 6; spec §2.3, §9.6). `deliverables` is the single source
row per task (13-status production vocabulary); the calendar/samples **card** keeps its own row
and its own 8-status review vocabulary (D-2), joined by `video_deliverable_id` /
`graphic_deliverable_id` ↔ `card_id`. A card's video slot and graphic slot each point at their
own deliverable — same reason a card has two Linear links today. Status/assignee/due changes fan
out from the one deliverable row to board, workload, and card via realtime. They are "the same
thing" in data, but merging the tables is deliberately NOT the plan — the review surface and the
production surface keep different vocabularies and lifecycles.

**"What happens to all the cards linked to Linear sub-issues at cutover?"** Already handled
continuously, not as a one-time migration: linkage maintenance (§4.3.5) keeps
`*_deliverable_id` current (drained to zero 2026-07-11; reconciler v2 watches it as a lane). At
each team's flip, the four link-keyed predicate families re-point from `linear_issue_id` to
`*_deliverable_id` (§9.2): the status-pill lock, dupe-link warning, link nudges, Kasper-queue
gates. After B5 teardown, the Linear link columns stay on cards but inert (§13.4.i).

**"What about the Linear submission tab?"** The visible **Submit** tab (internal `linear`) still
creates in Linear and mirrors in. The B4 outbound backend is staged dark and is not wired to the
SPA. At the separate owner-approved intake handoff, the same form creates natively — batch row +
deliverables in Supabase first — and outbound keeps Linear current. Auto-assign ports "Pick Freest
Editor". At B5 the `linear-subissues` webhook is retired with the rest of the legacy family
(§13.4.g). No separate "B6" is needed — this is inside B4/B5.

## 6. B4 rollout & UX — owner decisions (ratified 2026-07-11)

Recorded here in plain language; the authoritative entries are spec §14 **D-19…D-27** (this
section is the operational reflection, not a competing source).

- **Rollout model (D-25; supersedes D-19):** no per-client pilot. Keep global mode `off` while
  building, prove the exact mutation set in `shadow` across the full roster, require the outbound
  watchers and two-way zero-drift evidence, then the owner flips both teams/all clients to `live`
  together.
- **Reversible pause (D-26):** setting either team's `prod_authority` back to `linear` is a normal
  operational pause. Outbound writes and healing stop for that team, inbound keeps SyncView current,
  queued intents remain durable, and resume drops any intent older than the direct Linear edit.
- **Historical structure freeze (D-27):** outbound `parent` and `restore` operations are suppressed
  only for pre-B4 entities with explicit backfill provenance or a pre-B4 Linear completion marker.
  They remain counted as `tolerated_historical`; live-era parent moves/restores and all other fields
  remain writable.
- **Card → Production deep-link (D-20):** the card's old "open in Linear" button becomes
  **"View sub-issue,"** opening that deliverable in the Production tab in a **new browser tab**.
- **Legacy Linear-link fields (D-21):** keep them **inert but visible with a phase-aware
  disclaimer** during the fallback window; retire the field quietly after teardown.
- **Fallback grace period (D-22):** **~1 week, fully reversible** — the one-flag rollback to
  Linear stays armed all week so the team can keep working in Linear if the app needs a fix; after
  a clean week, freeze Linear read-only, then archive.
- **Submission form UI (D-23):** its form and behavior remain unchanged; the top-nav label alone is
  now **Submit** while its internal key/route stay `linear` / `#linear`. Only backend plumbing flips
  at B4.
- **One password per person (D-24):** consolidate the three separate keys (role / credential /
  onboarding) into the **role key** — each person types one password once, and their role decides
  reach: **credentials → admin+smm; onboarding → admin only; creative → neither.** Additive +
  reversible (old key paths kept alive during transition, then retired). Signed-in state shows an
  **account menu** (name · role + Sign out; **no Switch user**). The sign-in surface to be polished
  to a finished/premium standard and thoroughly tested (master-tester vision pass + `/human-audit`).
  Runs its own careful auth sprint *after* the B3 harness; not blocking B4.

D-24's implemented status and release evidence are tracked in WP-A3b above.
The outbound backend, TEST-only drills, and pager coverage are staged; the Production write UI,
all-client shadow observation window, and owner authority/live flips remain gated.

### Write-UI epoch human rollout (D-28 / D-29) — added 2026-07-12

The outbound *pipe* is proven live (flips 24/25) and then paused back to the D-26 stance. The
*team-facing write UI* is the remaining epoch (scope: `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md`),
and it rolls to humans in stages, not one flip:
1. **Silent shadow soak** (~1 week): write-UI shipped, team stays on Linear, outbound in `shadow`; catch bugs with nobody watching.
2. **Graphics team live first**; video stays on Linear as the safety net; roll video once graphics is boring.
3. **Bug policy (D-29):** cosmetic/UI bugs are fixed in place (no flip); only a data-integrity bug pauses *that team* (D-26). No whole-company flip-flop.

### Outbound readiness criteria (D-25 / D-26)

| Criterion | Current evidence | Gate state |
|---|---|---|
| TEST shadow matrix is exact and sends nothing | Summary event `8879`: 4 `shadow_ok`, 0 written | ✅ |
| TEST live operation matrix + strict echo drop | 25 written, 1 stale-dropped, 23 echoes dropped, 0 unexpected mirror writes; disposable issues archived | ✅ |
| Pause / inbound fallback / resume preserves newer Linear work | Pause event `8942`, resume event `8944`; queued older title marked `stale` | ✅ |
| Global off stops immediately and retains queue | Off event `8946`, resumed event `8948`, idempotent re-drain `8949` | ✅ |
| Two-way reconciler returns zero | TEST authority event `8950` and post-cleanup event `8959`: diff 0 / repair 0 / linkage actionable 0 | ✅ |
| Watchers deployed | Post-merge Action run `29181125012` completed green. Pager execution `251537` delivered the harmless failed-write signal; execution `251672` delivered harmless backlog-growth and shadow-mismatch signals. Normal event `9003` restored a clean mode-off summary. Volume/staleness branches remain source-tested. | ✅ live |
| Read-only full-roster shadow preflight | D-27 pre-alignment run `b4-shadow-1783877861264` returned 0 unexpected intents and reported all 73 prior findings as `tolerated_historical`. After the required SyncView-side terminal-row alignment, identical run `b4-shadow-1783878356762` returned 0 divergences, 0 intended writes, 0 repairs, and 72 historical parent tolerances. Both runs proved zero Linear mutations and unchanged flags/outbox. Public-safe evidence: `docs/audits/2026-07-11-b4-postmerge-shadow-evidence.md`. | ✅ RERUN GATE PASSED |
| Full-roster shadow window clean | Bounded deployed window (flip ids 20–23) held both teams SyncView-authoritative for 146.945 seconds: active roster had 0 unexpected intents / 72 historical tolerances; 40 additional tolerances belonged only to inactive internal rows. Drainer event `9162` was shadow with 0 writes/failures/backlog/echoes; controls were restored and post-window event `9163` was 0/0/0. | ✅ SHADOW STEP PASSED; ⏳ REVIEWER GO/NO-GO |
| All-client live handoff | Reviewer approved after the bounded shadow gate. Flip 24 set both teams SyncView-authoritative; flip 25 set outbound live; live drainer `9171`/`9172`/`9175` zero-write/zero-failure, reconciler `9174` 0/0/0, pager `256097` green. **Then flips 26/27 paused it back to the D-26 stance (authority Linear, outbound off)** because the team-facing write UI is not shipped (scope in `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md`); re-enable is two flips gated behind that epoch. No team message sent. | ✅ PROVEN LIVE 2026-07-12, now PAUSED (D-26) |

### Owner flip order (do not run before the gate)

1. Confirm the outbound Actions run and n8n pager tick are green, the real-client outbox backlog is
   zero, reconciler v2 is 0/0/0 in both directions, and all intended writable callers are merged.
2. Set `linear_outbound_enabled={"mode":"shadow"}` **first**. With both team authorities still
   `linear`, rows remain paused and no Linear mutation is possible.
3. In one audited flag update, set `prod_authority={"video":"syncview","graphics":"syncview"}`.
   Observe the full-roster shadow window; require zero failed rows, zero shadow mismatch, bounded
   backlog, and two-way reconciler 0/0/0.
4. After explicit owner approval, set `linear_outbound_enabled={"mode":"live"}`. Do not change the
   inbound flag or disable Linear webhooks.

Global rollback is one update: set outbound mode `off`. To pause only one team, change that team's
authority to `linear`; inbound keeps SyncView current and pending outbox rows remain. To resume, set
that team back to `syncview`; the drainer writes only still-current intents and marks older ones
`stale`. Every update must be read back and present in `flag_flips` before proceeding.

## 7. Explicitly out of scope here

Write-path EF design for B4 (spec §4), teardown order (spec §13), and any change to gates —
all live in the spec. This file only tracks evidence and execution.
