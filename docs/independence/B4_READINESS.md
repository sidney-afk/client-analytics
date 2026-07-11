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
| 1 | Mirror zero-diff (modulo §1.4) **7 consecutive days** | ⏳ diff/repair clean since ~2026-07-08; all three metrics (incl. linkage) at zero from 2026-07-11. **Owner must ratify the reading:** (a) strict all-three-zero clock from 2026-07-11 → gate ~2026-07-18, or (b) faithfulness-primary (diff/repair, transients tolerated per §1.4d; linkage verified 0 at decision time) → gate ~2026-07-15. Recommendation: (b) — linkage re-accrues from live inflow by design and is a maintenance lane, not a faithfulness signal. | Owner |
| 2 | Comments webhook subscribed + catch-up pull run (§4.3.4) | ✅ reconciler webhook probe: 4/4 enabled, `missing_comment_resource=0`; comment catch-up ran in B3 stage 3 | evidence in v2 summary `webhooks` block |
| 3 | Echo probe green (§12) | ❓ needs a fresh run + recorded result | Codex |
| 4 | Editor/SMM UX feedback collected | ⏳ ongoing via the owner's feedback-expansion loop; needs an explicit "team tried the tab" note | Owner |
| 5 | Outbox drain + zero-diff + linkage-zero report (§1.5.3) | ⏳ linkage-zero done (event 7746); formal per-team report at flip time | Codex |
| 6 | Legacy-writer gates verified (reconcilers + n8n bridges) | ⏳ at flip time per team | Codex |
| 7 | Identifier seed check | ⏳ at flip time | Codex |
| 8 | Flip + rollback rehearsal (`prod_authority[team]` → and back) on TEST | ⏳ not yet run | Codex + Owner |
| 9 | Detect-only foreign-write alert tested | ⏳ not yet run | Codex |
| 10 | Nightly due-date roller located AND disabled (D-9, with spec fallback) | ❓ locate first | Codex |
| 11 | Dedicated Linear mirror identity distinct from the house account (D-18) | ❌ not created — owner action in Linear (dedicated user or OAuth app), key stored as EF secret only | Owner |
| 12 | Editor/SMM sign-off + DR drill | ⏳ | Owner |
| 13 | **Auth prerequisite (§6, this file §3):** write attribution enforced before any real write phase | ⏳ WP-A1/A2 live and proven; WP-A3 implementation complete in draft, awaiting owner merge; permissive telemetry and enforcement gates remain | Owner + Codex |

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
| WP-A3 | ✅ DONE 2026-07-11 (staged; owner merge pending) | Built the §6.1 staff sign-in modal: active `team_members` roster picker only (no free text) + role key → localStorage; `key-verify` revalidation at boot; verified identity decorates Supabase EF writes with key/actor/role and reveals normal Production navigation. Direct `?prod=1` remains the diagnostic B2 route. Missing keys can be deferred while enforcement is permissive; 401 clears the identity; verifier outage fails open for the app but hides Production. Dummy-data desktop/mobile browser coverage proves sign-in, reload, invalid-key clearing, header isolation, and direct-preview compatibility. | Revert the WP-A3 frontend commit. Until owner merge, production remains unchanged. After merge, auth still remains permissive and the modal has a `Not now` path. |
| WP-A4 | ⏳ PENDING | Permissive telemetry window: count unkeyed writes in `syncview_auth_events` over real traffic; **gate: zero unkeyed writes for 72 h** | no behavior change |
| WP-A5 | ⏳ OWNER GATE | Flip `auth_enforcement` → `enforced` (owner action) | flip back = one flag |
| WP-A6 | ⏳ OWNER DECISION | Owner decision: keep D6 (3 shared role keys + per-person actor from roster) or upgrade to per-person credentials. **Recommendation: keep D6 through B5; revisit after cutover.** Every write already carries a per-person actor name + role for the audit trail either way. | decision only |

## 4. Plain-language answers (owner questions, 2026-07-11) — with spec citations

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

## 5. Explicitly out of scope here

Write-path EF design for B4 (spec §4), teardown order (spec §13), and any change to gates —
all live in the spec. This file only tracks evidence and execution.
