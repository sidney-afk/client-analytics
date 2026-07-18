# Assurance ledger — what is proven, how, and how recently

> Owned by `/site-assurance` (see `.claude/skills/site-assurance/SKILL.md`). One row per
> surface of the quality contract (`docs/QUALITY_TIERS.md`). **An expired proof is an
> expired proof** — a row here is a claim about evidence, never a claim that "the site
> works." Public-safe: no secrets, client names, or HR values.
>
> **Last refreshed: 2026-07-17** (first run — back-filled from `EXECUTION_LOG.md`
> verification records 2026-07-03 → 2026-07-16, then refreshed by run cycles below;
> F140 branch proof added from `939bdfc` / run `29629528360`).

## Rules (deterministic)

- **Freshness** vs the tier window (T0 7d, T1 14d, T2 30d, T3 quarterly/on-change):
  `FRESH` = age ≤ ½ window · `NEAR` = ½ window < age ≤ window · `EXPIRED` = age > window
  **or** a promised half of the surface has never been positively proven.
- **Churn**: the surface's code changed after its last proof → proof is stale regardless
  of date; row is marked `CHURNED` and scores ×2.
- **Score** = tier weight (T0=8 T1=4 T2=2 T3=1) × staleness (EXPIRED=3 NEAR=2 FRESH=1)
  × churn (×2). Cycles work the top of the list, 1–3 surfaces per cycle.

## Tier 0 — never knowingly broken (window 7d)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-07-17) | Score |
|---|---|---|---|---|---|---|
| Client review links (`?c=` load, calendar view, samples review — read AND save) | **2026-07-17** (this run; prior 2026-07-15) | 07-15: live observation of real client saves on existing links after the un-gate (EXECUTION_LOG §07-15 INCIDENT). 07-17 run 1: live `index.html` byte-identical to `main` (SHA-256 match); writer EF CORS preflights healthy; `test/client-review-link-auth.js` + `client-review-link-security.js` green in 126/126 offline run | pass-with-caveats | Two client writers **intentionally un-gated** under the ⛔ owner freeze (integrity lock off by owner directive); F89: `client_access_events.ok` cannot prove token-valid access; no dedicated `?c=` e2e probe exists (needs a TEST-client drill — excluded this run) | FRESH + CHURNED (index.html merges 07-15/16 postdate the 07-15 save proof; source-level suites re-green 07-17) | 16 |
| Share-link issuance (`client-review-link`) | **2026-07-17** (this run; prior 2026-07-15, invalidated same day) | 07-15: issuer deployed + 33 tokens provisioned (CLI-proven; browser CORS defect found same day, fix committed `ebc4e2d`). **07-17 run 1: live OPTIONS preflight now returns `access-control-allow-headers` including `x-syncview-actor, x-syncview-role` → the CORS fix IS deployed** | pass-with-caveats | Preflight proven only; **one real staff browser share (issuance POST) has not been re-proven since #838** — needs staff key, owner action. The live redeploy that activated the fix is **not recorded in EXECUTION_LOG** (ROLLBACK law: log every deploy) — owner one-liner below | NEAR (issuance half unproven in a real browser) | 32 |
| Client-visible thumbnails/media rendering | 2026-07-14 | Thumbnail v2 rollout proof (PRs #831/#832): disposable TEST matrix, auth-denial matrix (401/400/403), 239-watch scan + scheduled run `29370658087` green, owner-selected real card desktop/mobile render, zero page errors | pass | Proof is on the **staff** calendar-card surface; the `?c=` client-link render half has never been separately proven (needs a tokened TEST link — excluded this run); F79/F80 (resolver CAS, scanner bounds) open | NEAR (client half unproven) | 16 |

## Tier 1 — no silent failures (window 14d)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-07-17) | Score |
|---|---|---|---|---|---|---|
| Calendar planning + staff writes | **2026-07-16** (nightly e2e + backend contract) | Calendar E2E nightly run #27 green 2026-07-16 10:10Z (TEST client, full probe suite); live writer/delete contracts exercised during F88 recovery same day (18 creates, 16 link fills, 12 archives, exact readback). 07-17 run 1: 126/126 offline suites (incl. write-routing/writer-durability/reorder) + `parity_logic.js` NO GAPS | pass-with-caveats | **F141 (new, this run): drag-reorder persist failed in the 07-16 samples-nightly scenarios lane — DOM ≡ DB on the WRONG order, no save-failure surfaced (silent-loss risk; drill-class repro queued).** F139 (new, this run): reconcile lane intermittently failed overnight on a poisoned status batch — repo fix in draft PR. `calendar-upsert` un-gated under the freeze | FRESH, two new open findings | 8 |
| Samples/SXR + Kasper approval flow | **2026-07-17** (F140 branch nightly; 2026-07-18 UTC) | Full unfiltered branch run `29629528360` at `939bdfc`: exact owner-ratified F140 tree leaf 8/8; parity + realtime green; production-preview-smoke green. Aggregate master remained red on independent F141 reorder, TEST-row divergence, and the workflow's shallow-checkout truth-sync defect. The skipped workflow probe set was then run in full from the same SHA: Kasper gating 13/13, Kasper audit 6/6, concurrency 8/8, cold-open 13/13, Samples realtime 9/9, Calendar realtime 12/12; three independent stale probes (four assertions) remained red. Hermetic `write-ui-repair-races` proves the enrolled-gateway fresh/recovery split. | **pass-with-caveats** | **F140 DONE on the review branch:** owner ruled Samples matches Calendar; `939bdfc` fixes fresh-companion persistence without relaxing the gate. F73 merged in #861. **F141 drag-reorder persist remains open**; F75 doc-rewrite residue open; shallow truth-sync and stale share/outbox probes remain robot debt outside F140. | FRESH branch proof; open independent P1 remains | 8+P1 |
| Submit intake (form → n8n → Linear → cards) incl. receipts/fallback | 2026-07-16 | Live TEST both-form E2E through production webhooks (executions `275479`/`275480`): receipts finalized, parent+child per team, one card + 6 events, exact cleanup; bounded recovery with exact readback | pass | F91: serving mutation routes authenticate no incoming principal (open P0 in register, containment documented); F81 capture abuse controls open | FRESH | 4 |
| Staff sign-in/identity | 2026-07-15 | Post-#836 live browser-walk (Admin loads onboarding/weekly/filming; no-key and cross-role blocked) + PTO EF role matrix (401/403/200); fullest matrix 07-11 (WP-A3b) | pass-with-caveats | Shared role keys cannot bind a person (F84/F85; individually revocable sessions not deployed); `clients`/`team_members` still anon-200 (F88 residual, owner-parked) — re-confirmed by this run's read-only posture probe | FRESH | 4 |
| Linear mirror data correctness (dark lanes included) | **2026-07-17** (this run, read-only refresh; fullest check 2026-07-15) | 07-17 run 1 (cycle 3): calendar reconcile Actions runs green through 04:15Z **except one red run at 01:30Z** (F139 poisoned batch); production-preview read-only smoke green in CI 07-16. 07-15 combined health check: 3 reconcilers green, day-8 zero status parity, webhooks 4/4, ledgers clean. Dark lanes: B3 inbound 15/0/1 (07-11), B4 outbound 17/17 TEST (07-11), browser write E2E (07-13) | pass-with-caveats | F139 (new): status-batch poisoning intermittently fails the reconcile lane and burns heal singles every pass until the stored UUID link is cleaned; F95 foreground staleness, F94 assignment eligibility, F11 mirror backfill (191 slots) open | FRESH (refreshed this run) | 8 |
| PTO data correctness (balances, approvals, accrual math) | 2026-07-16 | Admin-path writes with balance/accrual readback + before/after hashes proving no collateral change; go-live lifecycle 07-15 (N=9 seed target-balance checks, submit→approve→delete with zero residue); `test/pto-accrual.js` green 07-17 (this run) | pass | Individually-bound staff sessions not deployed (accepted under owner decision D-36); no post-launch outage drill | FRESH | 4 |

## Tier 2 — correct, with batched polish (window 30d)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-07-17) | Score |
|---|---|---|---|---|---|---|
| PTO tracker UI/UX | 2026-07-15 | Live browser proof at go-live: staff-menu entry, overview for Admin + one non-admin, disposable TEST request full lifecycle; `test/pto-ui-wiring.js` + `pto-control-behavior.js` green 07-17 | pass | — | FRESH | 2 |
| Workload view | 2026-07-15 (classifier only) | Unit regression `test/workload-tweak-exclusive-bucket.js` on the real `wlApplyData`; green 07-17 | pass (logic) | **View/browser half never proven** anywhere in the log (no e2e/visual of the rendered Workload view) | EXPIRED (unproven half) — queued next run | 6 |
| Analytics / market-research views | 2026-07-04 (analytics) | Local headless smoke (search, data-less empty state) + live marker check post-#675 | pass (smoke) | **Market-research half: no proof anywhere in the log**; analytics proof is the oldest live proof in this ledger | EXPIRED (market-research half) — queued next run | 6 |
| Templates | 2026-07-14 | F35 gated-writer proof (`templates-save` v30): deny 401s, managed-key TEST 200, exact restore; A4 parity 07-04/05; multi-link headless round-trip 07-06 | pass-with-caveats | Multi-link live round-trip on the n8n lane never owner-confirmed (07-06 note never closed) | FRESH | 2 |
| Filming plans | 2026-07-16 | Protected-read proof during F88 recovery (30 rows, both required client mappings, 3 executions traversed the repaired reader); staff screen load 07-15 | pass-with-caveats | Staff-tab UI e2e never run live (QA stubs `filming-plan-tabs` by default); F82 residuals open | FRESH | 2 |
| Weekly reports UI | 2026-07-15 | Staff browser-walk (screen loads, no-key/cross-role blocked); `smm-weekly-reports` v21 auth matrix + authenticated n8n branch (07-14) | pass-with-caveats | Positive report-submit / roster-sync e2e never proven post-gating | NEAR (submit half unproven) | 4 |

## Tier 3 — substance over looks (window quarterly/on change)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-07-17) | Score |
|---|---|---|---|---|---|---|
| docs/ accuracy guards (truth-sync, repo-map, system-map) | **2026-07-17** (this run) | 126/126 offline suites incl. `truth-sync`, `repo-map-sync`, `system-map-sync` (F93-hardened: exact date+commit stamps, register equality, P0/P1 presence) | pass | Guard is syntactic — does not replace semantic/live review; F71 lifecycle-map full rewrite open | FRESH | 1 |
| Monitors' dashboards/logs | **2026-07-17** (this run, read-only refresh) | Cycle 3 API sweep: all 20 Actions workflows active (both nightlies re-enabled); reconcile cadence live; quota-watchdog/pager last-mile proofs stand from 07-11/13. Commit `98564f8` now routes scheduled E2E failures through the existing SyncView Bot webhook | **fail-open-defect (process)** | F140 is closed on the review branch and F141 remains open. Scheduled nightly paging is now wired, but its first real scheduled-failure delivery is not yet proven. F09 remains open: 5 of 6 load-bearing cutover workflows lack the central `errorWorkflow`, and the central handler itself failed 29/30 sampled invocations — independent non-n8n pager required | FRESH data, open process gap | 2 |
| Admin/ops tooling (backup/restore, credentials) | **2026-07-17** (this run) | Cycle 3: five scheduled 6-hourly `Track-B private backup` runs since merge, ALL green (latest 2026-07-17T03:44Z) — the "first scheduled run pending" gap is closed. 07-15: proof run with Drive readback (MD5/bytes/HMAC) + 229s scratch restore, zero orphans | pass-with-caveats | PITR owner-declined (accepted residual); F49 capacity/egress evidence open; F84 credential-vault findings open (incl. the known plaintext house Linear key in n8n — F52 rotation owed, re-observed this run) | FRESH | 1 |
| Deploy workflows | **2026-07-17** (this run; prior 2026-07-15) | 07-15: PTO deploy run `29448635278` green with live version/fingerprint readback. **07-17 run 1: source-verified the F06 Part C fix on `main` — `deploy-thumbnail-edge-functions` deploys only the two thumbnail functions and no workflow references the frozen writers** | pass | Manual-dispatch re-gate path reserved behind an explicit owner-approval input (by design) | FRESH — F06 landmine defused | 1 |

## Cross-tier invariants — spot state (2026-07-17, read-only probes)

1. Existing client links keep working — un-gated writer posture intact (⛔ freeze honored; zero flag flips claimed since 07-16 per log).
2. No silent data loss — F44 durable receipts live (server + browser); Samples F73 reload-loss is a **navigation** loss, tracked above.
3. HR/audit trail — PTO writes carry `flag_flips`/event receipts; before/after hash proof 07-16.
4. Dark lanes stay dark — `write_ui_reroute_clients` TEST-only per 07-15 health check; locked tables re-probed 401 this run (`filming_plans`, `thumbnail_media_revisions`, `social_media_managers`, `smm_weekly_reports`, `pto_*`, onboarding/sales intake).
5. A fixed bug gets a guard — enforced per-fix; this run's F73 fix ships with the reworked `boot-gate-parity` semantic guard.

## Owner one-liners (decisions surfaced by this run — place, don't self-assign)

- **O-1:** The `client-review-link` CORS redeploy that activated fix `ebc4e2d` is live (proven by preflight 07-17) but has no EXECUTION_LOG deploy record — approve adding a dated back-record, and confirm who/when deployed it.
- **O-2:** One real staff browser share (issuance POST) is the remaining unproven half of Tier-0 share-link issuance — a 2-minute owner action with a staff key, or approve a TEST-client drill next run.
- **O-3:** A `?c=` client-link e2e probe (load + save + thumbnail render on a tokened TEST link) does not exist; approve building it as a permanent probe next run (needs the private TEST fixture, so it is drill-class).
- **O-4:** Market-research view has never been proven and is not explicitly named in `QUALITY_TIERS.md` Tier 2 beyond "analytics/market-research views" — confirm Tier 2 placement is intended.
- **O-5 (F139):** Approve the owner-gated half of the fix: snapshot + edit the `linear-issue-statuses` n8n Code node (strict ident extraction, bounded fallback) and correct/clear the UUID-form graphic link stored on card `p_mquxb0wk_emmed`.
- **O-6 (F140, ANSWERED 2026-07-17):** Owner ruled this a regression: Samples matches Calendar; Kasper can stack change requests, then Finish hands the card to the SMM. Fixed in `939bdfc` and pinned in the tree lane.
- **O-7 (F141):** Approve a TEST-client drag-reorder drill next run to classify the persist failure (silent-loss risk).
- **O-8 (process, IMPLEMENTED):** Scheduled Calendar/Samples nightly failures now route through the existing SyncView Bot webhook (`98564f8`); first real scheduled-failure delivery remains to be observed.

## Run history

### Run 2026-07-17 (first run) — mandate: back-fill ledger, all tiers, ≤6 cycles, read-only probes only, findings as draft PRs
- **Back-fill:** full EXECUTION_LOG extraction (2026-07-03 → 07-16) mapped to the QUALITY_TIERS surface list; churn marked from the `main` merge history since 07-13.
- **Cycle 1 (T0 posture):** live-vs-main hash match; anon-posture probe (11 tables + 6 reader EFs, all expected codes); issuer CORS preflight → the share-button fix confirmed LIVE (upgrades the 07-15 invalidated proof); writer EF preflights healthy. New live findings: none; one process gap (O-1).
- **Cycle 2 (T1 Samples, F73):** confirmed on `main` at source level (3 stale boot copies + the CI pin), fixed, guard reworked with semantic cases, verified in a local fresh-profile browser (mount / reload / opt-out / override), 126/126 suites green → draft PR `claude/f73-sxr-boot-gate-ga`.
- **Cycle 3 (T1 mirror / T3 monitors + backup, read-only APIs):** backup scheduled runs 5/5 green; calendar nightly green 07-16; **samples nightly red 4 nights untriaged → F140 + F141 registered; F139 found live** (5 webhook timeouts, 1 red reconcile run, heal-burst burn) and root-caused from the node's own code + payload + a local regex repro + the stored card row.
- **Cycle 4 (F139 repo-side fix):** strict ident extraction + batch hygiene at all three repo callers + `test/linear-ident-uuid-guard.js`; 127/127 suites + `parity_logic` NO GAPS → draft PR `claude/linear-ident-uuid-sanitize`.
- **Stop decision:** stopped after 4 of 6 cycles — every remaining top-scored gap requires either a TEST-client drill (excluded by the read-only mandate) or an owner decision (O-1…O-8). Two consecutive dry cycles were unreachable: cycles 3–4 produced findings.
- **Refuted/discarded this run:** 2 candidate signals — the 07-15 nightly carnage (environmental: the client-writer incident window, not a distinct defect) and the local `prod-readonly-smoke` timeout (sandbox browser egress, not an app failure; the same smoke is green in CI 07-16). Live-browser lanes remain CI/owner-machine provers for this sandbox.
- **Recommended next run:** 2026-07-24 (T0 window) or immediately after the owner answers O-5/O-7 — with TEST drills allowed, so the F141 reorder repro, the `?c=` client-link probe (O-3), and a real browser share (O-2) can close.
