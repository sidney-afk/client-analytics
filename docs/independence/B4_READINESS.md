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
FE blocks on 401/410/enforced-fail), `key-verify` EF, role/actor header plumbing on write paths,
flag-flip audit trigger.

**Remaining work-packages, in order:**

| WP | Status | What | Notes / rollback |
|---|---|---|---|
| WP-A1 | ✅ DONE 2026-07-11 | Every staff write EF now persists `X-Syncview-Actor` / `X-Syncview-Role`: calendar/sample upserts and reorders use their card event ledgers; template/caption-prompt saves use additive service-only `settings_events`. One disposable TEST write per EF proved all six paths and cleanup restored the two settings rows exactly with zero probe rows/events left. | Re-deploy the private pre-WP-A1 function snapshots; the additive `settings_events` table may remain dormant. No routing flag is involved. |
| WP-A2 | ✅ DONE 2026-07-11 | The three role keys were already minted in EF secrets. Their deployed digests match the private B0 backup, and `key-verify` resolved compatible active roster rows for admin, SMM, and creative in permissive mode (proof events 3–5). | Secrets only; no key material is committed. Rollback is unnecessary while auth stays permissive; remove/rotate a role secret only for credential compromise. |
| WP-A3 | ✅ DONE + LIVE 2026-07-11 | The §6.1 active-roster sign-in is on `main`: no free-text actor, role key stored locally, boot revalidation through `key-verify`, verified key/actor/role on Supabase EF requests only, normal Production navigation after verification, direct `?prod=1` diagnostics preserved, 401 clear, and verifier-outage fail-open. Dummy-only desktop/mobile coverage is green. | Revert the WP-A3 frontend commits; operational fail-open remains `auth_enforcement={"mode":"permissive"}`. |
| WP-A3b | 🔄 IMPLEMENTED IN DRAFT 2026-07-11 | One signed-in identity now owns every sensitive staff surface. The staff button opens an account popover (`Signed in as <name> · <Role>` + **Sign out**, no switch-user path); the full form exists only signed out. Credentials accept admin + SMM role keys, while unstripped onboarding and filming-plan writes accept admin only. The server derives role from the matching secret and keeps `CREDENTIALS_STAFF_KEY` / `ONBOARDING_STAFF_KEY` compatibility in parallel. Sign out and invalid-key 401 purge sensitive credential/onboarding UI + caches; recognized-but-disallowed 403 preserves the valid session. | Release backend first by manually dispatching the deploy workflow from the feature branch and verifying it green, then merge Pages. Roll back the frontend first while leaving additive backend support deployed; only then consider a separate backend rollback. Both legacy secrets remain unchanged. Do not retire them until every non-browser caller is inventoried and identifier-only telemetry proves zero legacy use through an owner-approved window. |
| WP-A4 | ⏳ PENDING | Permissive telemetry window: count unkeyed writes in `syncview_auth_events` over real traffic; **gate: zero unkeyed writes for 72 h** | no behavior change |
| WP-A5 | ⏳ OWNER GATE | Flip `auth_enforcement` → `enforced` (owner action) | flip back = one flag |
| WP-A6 | ⏳ OWNER DECISION | Owner decision: keep D6 (3 shared role keys + per-person actor from roster) or upgrade to per-person credentials. **Recommendation: keep D6 through B5; revisit after cutover.** Every write already carries a per-person actor name + role for the audit trail either way. | decision only |

## 4. Readiness-sprint probe ledger (2026-07-11)

| Probe / work item | Status | Evidence / next safe step |
|---|---|---|
| B3 legacy-comment echo (§12) | ✅ DONE | `scripts/b4-comment-echo-probe.js` snapshots the TEST deliverable thread, seeds one app comment through `deliverable_write`, sends the matching legacy Linear comment, proves exactly one app copy and no duplicate inbound event, then deletes the Linear comment and restores the original thread. Proof events `7769`–`7770` retain the audit trail; the TEST issue ended with its original two Linear comments and zero app comments. |
| B4 strict-AND outbound echo + TEST create→status→comment→due (§1.5.6) | ⚠️ BLOCKED | No `linear-outbound` EF/retry worker exists yet, and §4.4 requires those writes to use `mirror_outbox`; this sprint explicitly forbids mirror-outbox writes. The mirror key is correctly confined to an EF secret, so bypassing the missing outbound path with a personal/local key would not prove the contract. Build the B4 outbound path first, then run the scripted TEST round-trip and restore/archive every mutation. |
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

**"What about the Linear submission tab?"** Spec §9.1: during B3 (now), intake still creates in
Linear and mirrors in. **From B4, the intake creates natively** — batch row + deliverables in
Supabase first; during the split-authority window the Linear-authoritative team's leg still goes
through legacy intake and the inbound engine adopts the mirrored parent into the existing batch
(no duplicate batches). Auto-assign ports "Pick Freest Editor". At B5 the `linear-subissues`
webhook is retired with the rest of the legacy family (§13.4.g). No separate "B6" is needed —
this is inside B4/B5.

## 6. B4 rollout & UX — owner decisions (ratified 2026-07-11)

Recorded here in plain language; the authoritative entries are spec §14 **D-19…D-23** (this
section is the operational reflection, not a competing source).

- **Rollout granularity (D-19):** flip **both video + graphics together** (so a card is never
  split across systems mid-flight — removes the fiddliest adoption path), but roll out **per
  client** through an allowlist — TEST client → one pilot client → the rest — exactly like Track A
  did. Implication for the build: authority moves from the global per-team `prod_authority` switch
  to a **per-client(-per-team) allowlist**. Codex to cost this vs. the split-card code at B4 scoping.
- **Card → Production deep-link (D-20):** the card's old "open in Linear" button becomes
  **"View sub-issue,"** opening that deliverable in the Production tab in a **new browser tab**.
- **Legacy Linear-link fields (D-21):** keep them **inert but visible with a phase-aware
  disclaimer** during the fallback window; retire the field quietly after teardown.
- **Fallback grace period (D-22):** **~1 week, fully reversible** — the one-flag rollback to
  Linear stays armed all week so the team can keep working in Linear if the app needs a fix; after
  a clean week, freeze Linear read-only, then archive.
- **Submission tab UI (D-23):** **no change** for now — only its backend plumbing flips.
- **One password per person (D-24):** consolidate the three separate keys (role / credential /
  onboarding) into the **role key** — each person types one password once, and their role decides
  reach: **credentials → admin+smm; onboarding → admin only; creative → neither.** Additive +
  reversible (old key paths kept alive during transition, then retired). Signed-in state shows an
  **account menu** (name · role + Sign out; **no Switch user**). The sign-in surface to be polished
  to a finished/premium standard and thoroughly tested (master-tester vision pass + `/human-audit`).
  Runs its own careful auth sprint *after* the B3 harness; not blocking B4.

The remaining items are inputs for the B4/B5 build and design pass; D-24's
implemented-draft status and release gate are tracked in WP-A3b above.

## 7. Explicitly out of scope here

Write-path EF design for B4 (spec §4), teardown order (spec §13), and any change to gates —
all live in the spec. This file only tracks evidence and execution.
