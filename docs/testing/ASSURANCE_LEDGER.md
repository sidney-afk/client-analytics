# Assurance ledger — what is proven, how, and how recently

**Corrected 2026-09-21:** Linear was retired as a work surface at the 2026-09-20 cutoff. Staff work in SyncView; normal outbound writes and legacy parity are off. The inbound webhook remains, and STEP 7 credential revocation is still owner-gated. The old intake/mirror row labels describe the surface at the date of each proof. They are not current Linear workflow requirements, and those old receipts do not certify today’s native flow. See [cutoff record](../ops/LINEAR_CUTOFF_RUNBOOK.md).

> Owned by `/site-assurance` (see `.claude/skills/site-assurance/SKILL.md`). One row per
> surface of the quality contract (`docs/QUALITY_TIERS.md`). **An expired proof is an
> expired proof** — a row here is a claim about evidence, never a claim that "the site
> works." Public-safe: no secrets, client names, or HR values.
>
> **Last refreshed: 2026-10-02** (Proof: priority ops checks, live TEST review and native projection; incomplete, see the dated audit). Previous **2026-09-23** (Atlas run: client review save, staff card save/rename, client Samples half, Workload/Analytics open; see run history). Previous refresh 2026-07-20 (Workload release plus #889 client-only display/group-drag refresh:
> exact-source deploy, private TEST 409/revert/notify, Creative denial, save/reload/clear and cleanup,
> plus current-main Pages/read-only source and synthetic sequential-group proof). The broader run 2
> remains dated 2026-07-19 (TEST-drill mandate; F141 root-caused + repo
> fix + guards on `claude/site-assurance-run-2-r0ovr9`; Tier-0 served-bytes integrity
> re-proven deployed≡main; the two client-facing Tier-0 drills could not be executed in
> this sandbox — see run history). Prior refresh 2026-07-17 (first run — back-filled from
> `EXECUTION_LOG.md` 2026-07-03 → 2026-07-16; F140 branch proof from `939bdfc` / run
> `29629528360`).
>
> Client-entry addendum (source-only review candidate, not live proof): a fully intercepted
> streamed-document lane now observes 23 visible boot/reload/history groups with fictional data,
> including real persisted BFCache returns and deliberately late analytics/Calendar/Brief/Samples responses after
> capability revocation; one attempt per navigation, zero unmocked requests, and zero browser
> errors. Exact-head cloud review plus deliberate-manual verifier deployment/readback and a TEST
> strict-protocol drill remain release gates.

## State restated 2026-08-22 — no new proof, just honest arithmetic

**Nothing here was re-proven on this date.** Every "Last proven" cell and every
method is untouched; only the State column was recomputed against the rules
below, and the header stamp above still names the last real cycle, 2026-07-20.

It needed doing because the document had quietly become the opposite of what it
exists to be. Thirteen rows read `FRESH` — including staff sign-in, submit
intake, and PTO data correctness — while every one of them was more than a month
past its window. Anyone opening this file got a reassuring picture of evidence
that had expired weeks earlier. The rows were honest on the day they were
written; they simply rotted, and nothing did the arithmetic.

Where it stands now: **15 of 19 rows are past their window**, including all
three Tier 0 client-facing rows at 33, 36 and 39 days against a **7-day**
window. The four Tier 3 rows are genuinely still inside their quarterly window.

**Why it stopped.** Nothing schedules this. `/site-assurance` is a skill someone
invokes by hand, no cron or workflow calls it, and no monitor notices its
absence — so the ledger going stale is silent by construction. That is the
actual defect behind "why did the proofs stop"; the dates are only its symptom.

Three things now make the silence audible:

- `node scripts/assurance-ledger-freshness.js` prints the arithmetic for every
  row. Read-only, never fails, public-safe.
- `test/assurance-ledger-freshness.js` refuses a row that claims MORE freshness
  than its date supports, judged as of the `State (YYYY-MM-DD)` column's own
  stamp — so an overstatement is caught when it is written, and a file nobody
  touched cannot spontaneously go red. (NOT the header's refresh stamp: the
  first version anchored there, and a restatement without a new cycle keeps that
  stamp old, so every row computes FRESH against it.)
- `.github/workflows/assurance-ledger-freshness.yml` runs
  `--gate` daily at 07:37 UTC and on every push that touches this file, and
  records the `assurance_ledger` dead-man lane. That gate is the one thing here
  that can reach a person unasked: it DMs the owner, once per incident, when a
  row stops supporting the state written beside it — a claim that was true when
  written and has since rotted — or when nobody has restated or re-proven
  anything for 60 days. It deliberately says nothing about a row that is merely
  old and already admits it, which is why it is green today with 15 of 19 rows
  past their window.

Neither of them takes a picture. Refreshing the Tier 0 rows for real needs a
staff key and a tokened TEST client link, which no session holds — that half is
still owner-gated, and it is the half that matters most.

## Rules (deterministic)

- **Freshness** vs the tier window (T0 7d, T1 14d, T2 30d, T3 quarterly/on-change):
  `FRESH` = age ≤ ½ window · `NEAR` = ½ window < age ≤ window · `EXPIRED` = age > window
  **or** a promised half of the surface has never been positively proven.
- **Churn**: the surface's code changed after its last proof → proof is stale regardless
  of date; row is marked `CHURNED` and scores ×2.
- **Score** = tier weight (T0=8 T1=4 T2=2 T3=1) × staleness (EXPIRED=3 NEAR=2 FRESH=1)
  × churn (×2). Cycles work the top of the list, 1–3 surfaces per cycle.

## Tier 0 — never knowingly broken (window 7d)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-10-02) | Score |
|---|---|---|---|---|---|---|
| Client review links (`?c=` load, calendar view, samples review — read AND save) | **2026-10-02** (existing TEST link, live backend with local candidate); prior deployed-source save **2026-09-23** | `qa/probes/client-review-assurance-live.js`: 25 checks; real browser comments on both surfaces, Calendar caption approve and request-change, Samples graphic request-change, timestamp/text/status readback, reload and cleanup. Streamed boot matrix: 23 mocked groups. [Evidence](../audits/2026-10-02-site-assurance.md). | **confirmed defect; candidate passes** | Plain comments persisted but left Approve disabled on both surfaces. Candidate repaints after successful save; Lighthouse merge/Pages publication still owed. Existing-token proof does not prove fresh issuance or native video/graphic approval. | CHURNED EXPIRED: candidate backend proof today; deployed frontend repair not proven | 48 |
| Share-link issuance (`client-review-link`) | **2026-07-17** (this run; prior 2026-07-15, invalidated same day) | 07-15: issuer deployed + 33 tokens provisioned (CLI-proven; browser CORS defect found same day, fix committed `ebc4e2d`). **07-17 run 1: live OPTIONS preflight now returns `access-control-allow-headers` including `x-syncview-actor, x-syncview-role` → the CORS fix IS deployed** | pass-with-caveats | Preflight proven only; **one real staff browser share (issuance POST) has not been re-proven since #838** — needs staff key, owner action. **Run 2 (07-19): the share-link mint drill (O-2) could NOT be executed in this sandbox — the issuance EF returns `401 credentials_required` without a staff key (live-confirmed), and none is present; drill re-queued with a prompt-ready spec.** The live redeploy that activated the fix is **not recorded in EXECUTION_LOG** (ROLLBACK law: log every deploy) — owner one-liner below | CHURNED EXPIRED 77d; real browser issuance still unproven | 48 |
| Client-visible thumbnails/media rendering | **2026-10-02** (client thumbnail bytes only); broader staff matrix **2026-07-14** | Real Chromium through existing strict client link, both Calendar and Samples; image complete and naturalWidth positive. [Evidence](../audits/2026-10-02-site-assurance.md). | partial pass | Thumbnails proven; video playback, fresh staff media/auth matrix and mobile visual review not repeated. Old F79/F80 gaps retained. | EXPIRED: partial thumbnail proof today; full media promise unproven | 24 |

## Tier 1 — no silent failures (window 14d)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-10-02) | Score |
|---|---|---|---|---|---|---|
| Calendar planning + staff writes | **2026-09-23** (Atlas: staff card save, card-to-sub-issue rename and restore, TEST client, live backend); before that **2026-07-16** (nightly e2e + backend contract) | Calendar E2E nightly run #27 green 2026-07-16 10:10Z (TEST client, full probe suite); live writer/delete contracts exercised during F88 recovery same day (18 creates, 16 link fills, 12 archives, exact readback). 07-17 run 1: 126/126 offline suites (incl. write-routing/writer-durability/reorder) + `parity_logic.js` NO GAPS | pass-with-caveats | Sub-issue-to-card rename ships flag off (not provable live). **F141 (run 2, 07-19): ROOT-CAUSED + FIXED repo-side — silent-loss in the samples reorder EF+client (EF echoed the requested count as `updated`; client never verified it). Fix + guards on `claude/site-assurance-run-2-r0ovr9`; EF redeploy + live TEST drill + n8n-fallback mirror pending (register F141).** F139 (new, this run): reconcile lane intermittently failed overnight on a poisoned status batch — repo fix in draft PR. `calendar-upsert` un-gated under the freeze | CHURNED EXPIRED: staff proof 9d old; current native writes not re-proven | 24 |
| Samples/SXR + Kasper approval flow | **2026-10-02** client comments/graphic request only; last live Kasper **2026-09-24** | Live client probe: comment persisted without status change, request text/status held through reload, cleanup. Kasper remains the maintained native probe, not executed without a real role key. [Evidence](../audits/2026-10-02-site-assurance.md). | partial pass; confirmed control defect fixed in candidate | Kasper/native create/approval needs private role key and actor. Existing F140/F141/F75 historical gaps are not closed by this client-only proof; post-comment control fix awaits merge. | CHURNED EXPIRED: client half today; current Kasper half not re-proven | 24 |
| Submit intake (form → n8n → Linear → cards) incl. receipts/fallback | 2026-07-16 | Live TEST both-form E2E through production webhooks (executions `275479`/`275480`): receipts finalized, parent+child per team, one card + 6 events, exact cleanup; bounded recovery with exact readback | pass | F91: serving mutation routes authenticate no incoming principal (open P0 in register, containment documented); F81 capture abuse controls open | CHURNED EXPIRED 78d: native receipt/write promise needs live authenticated proof | 24 |
| Staff sign-in/identity | 2026-07-15 | Post-#836 live browser-walk (Admin loads onboarding/weekly/filming; no-key and cross-role blocked) + PTO EF role matrix (401/403/200); fullest matrix 07-11 (WP-A3b) | pass-with-caveats | Shared role keys cannot bind a person (F84/F85; individually revocable sessions not deployed); `clients`/`team_members` still anon-200 (F88 residual, owner-parked) — re-confirmed by this run's read-only posture probe | CHURNED EXPIRED 79d: current mocked role matrix passes; live identity unproven | 24 |
| Linear mirror data correctness (dark lanes included) | **2026-10-02** native TEST projection only; prior legacy proof **2026-07-17** | `qa/probes/assurance-native-read-live.js`: all 444 scoped rows match canonical statuses; native authority, outbound off and absent active inbound endpoint. No mutations. [Evidence](../audits/2026-10-02-site-assurance.md). | partial pass | Live service-role projection equality does not prove browser-role reads, assignment or foreground refresh. Legacy dark-lane assertions are retired and cannot substitute for current native workflow proof. | CHURNED EXPIRED: read subset today; full current native data-flow proof missing | 24 |
| PTO data correctness (balances, approvals, accrual math) | 2026-07-16 | Admin-path writes with balance/accrual readback + before/after hashes proving no collateral change; go-live lifecycle 07-15 (N=9 seed target-balance checks, submit→approve→delete with zero residue); `test/pto-accrual.js` green 07-17 (this run) | pass | Individually-bound staff sessions not deployed (accepted under owner decision D-36); no post-launch outage drill | CHURNED EXPIRED 78d: 35 mocked lifecycle gates pass; live HR mutation excluded | 24 |

## Tier 2 — correct, with batched polish (window 30d)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-10-02) | Score |
|---|---|---|---|---|---|---|
| PTO tracker UI/UX | 2026-07-15 | Live browser proof at go-live: staff-menu entry, overview for Admin + one non-admin, disposable TEST request full lifecycle; `test/pto-ui-wiring.js` + `pto-control-behavior.js` green 07-17 | pass | — | CHURNED EXPIRED 79d: mock matrix only; visual review pending | 12 |
| Workload view | **2026-09-24** write half (Atlas: TEST work day set and cleared, each surviving a fresh load, 7/7, restored); open 2026-09-23; before that **2026-09-23** open only (Atlas: dawn-check opened the board, 15.2 s cold from the sandbox); before that **2026-07-20** (live release + client-only #889) | Current-main Pages run `29752646229` served `c903676`, including #889's date → editor → client hierarchy and sequential client-group drag. The private TEST browser drill still supplies the backend proof: real pre-write 409 optimistic revert + notify, Creative 403 list/set + read-only UI, one-row persistence through a fresh server list, clear-to-due fallback, and exact cleanup with unchanged deadline/flags. #889's synthetic six-item proof kept four successes, restored two exact failures, held concurrency to one, and emitted one aggregate notice; its exact reviewed head passed all 138 suites. | pass-with-caveats | #889 implements the owner-approved client-only sequential outcome; #884's server-atomic multi-row contract remains open. F147: exact revoke-correction migration artifact provenance is unresolved. F148: the source regex still does not actually bind `.select(...)` to the same fluent upsert chain, and the Workload tests still reuse F141, so future-regression protection/naming remain weaker than claimed even though live one-row behavior passed. | CHURNED EXPIRED: last live 8d old; subsequent native source changes unproven live | 12 |
| Analytics / market-research views | **2026-09-23** analytics half (Atlas: first numbers rendered, 10.7 s cold from the sandbox); before that 2026-07-04 (analytics) | Local headless smoke (search, data-less empty state) + live marker check post-#675 | pass (smoke) | **Market-research half: no proof anywhere in the log**; analytics proof is the oldest live proof in this ledger | CHURNED EXPIRED: market-research populated half never proven | 12 |
| Templates | 2026-07-14 | F35 gated-writer proof (`templates-save` v30): deny 401s, managed-key TEST 200, exact restore; A4 parity 07-04/05; multi-link headless round-trip 07-06 | pass-with-caveats | Multi-link live round-trip on the n8n lane never owner-confirmed (07-06 note never closed) | CHURNED EXPIRED 80d | 12 |
| Filming plans | 2026-07-16 | Protected-read proof during F88 recovery (30 rows, both required client mappings, 3 executions traversed the repaired reader); staff screen load 07-15 | pass-with-caveats | Staff-tab UI e2e never run live (QA stubs `filming-plan-tabs` by default); F82 residuals open | CHURNED EXPIRED 78d; source test passes, live staff-tab proof missing | 12 |
| Weekly reports UI | 2026-07-15 | Staff browser-walk (screen loads, no-key/cross-role blocked); `smm-weekly-reports` v21 auth matrix + authenticated n8n branch (07-14) | pass-with-caveats | Positive report-submit / roster-sync e2e never proven post-gating | CHURNED EXPIRED 79d; submit half still unproven | 12 |

## Tier 3 — substance over looks (window quarterly/on change)

| Surface | Last proven | Method | Verdict | Open gaps | State (2026-10-02) | Score |
|---|---|---|---|---|---|---|
| docs/ accuracy guards (truth-sync, repo-map, system-map) | **2026-10-02** | Correct split-source preloader: truth-sync 503/0, system-map-sync 17/0; repo-map-sync 1062/0 after audit/integration edits. [Evidence](../audits/2026-10-02-site-assurance.md). | pass (source guards) | Syntactic guards do not establish semantic/live truth. F71 historical map-rewrite gap not closed. | FRESH 0d; guards re-proven | 1 |
| Monitors' dashboards/logs | **2026-10-02** | Existing watchdog/lane tests and actual pager receipt pass. Nine active lanes healthy at 20:12Z/20:56Z; after integrating main, 21:03Z watcher sees ten lanes and failing alert_digest. Hosted digest run 37062027005 failed with Supabase 57014; local real dry-run at 21:05Z succeeds and reports five scheduled/age incidents. [Evidence](../audits/2026-10-02-site-assurance.md). | **FAIL observed; intermittent digest failure not reproduced locally** | No alert sent by this run. Watchdog exit 0 does not mean healthy. Digest reports stale backup, expired ledger and red scheduled Calendar/drift/Samples; fresh source/live root-cause proofs not closed by log inspection. Historical F09 gap remains. | CHURNED EXPIRED: current added digest lane has failing heartbeat; partial positive inspection only | 6 |
| Admin/ops tooling (backup/restore, credentials) | **2026-10-02** backup receipt inspection; last scratch restore **2026-07-15** | Existing Track-B tests and streaming guards pass. Scheduled run 37009430350: history-v11, HMAC/Drive bytes/parent verified; freshness passed at 13:08Z. [Evidence](../audits/2026-10-02-site-assurance.md). | partial pass; restore unproven | A historical freshness receipt is not current Drive freshness. Fresh download/HMAC/scratch restore needs private backup inputs and an isolated target; none available. Credential recovery not exercised. PITR owner-declined, F49/F84/F52 historical gaps remain. | EXPIRED: backup subset today; fresh restore/credential promise not proven | 3 |
| Deploy workflows | **2026-10-02** | Existing deploy provenance and Section-4 lane guards pass; manifest checked; Sep-30 run 36785832200 receipt inspected; required live functions ACTIVE (frozen writers retained tokenless). [Evidence](../audits/2026-10-02-site-assurance.md). | pass (workflow policy/catalog) | No deployment performed; ACTIVE/version readback does not prove every current source byte deployed. Existing approval-controlled manual path remains as designed. | FRESH 0d; policy guards and live catalog inspected | 1 |

## Cross-tier invariants — spot state (2026-07-17, read-only probes)

1. Existing client links keep working — un-gated writer posture intact (⛔ freeze honored; zero flag flips claimed since 07-16 per log).
2. No silent data loss — F44 durable receipts live (server + browser); Samples F73 reload-loss is a **navigation** loss, tracked above. **Run 2 (07-19): the samples drag-reorder silent-loss (F141) is closed repo-side — the EF now reports the true matched-row count and the client fails closed on `updated < items.length` (guards `a2-writer-edge-source.js` + `sxr-reorder-failclosed.js`); EF redeploy + owner-gated n8n-fallback mirror still owed.**
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
- **O-9 (F141, run 2):** After the EF redeploys, approve the owner-gated n8n mirror: the dormant `Sample Review — Reorder` fallback workflow's "Wrap Response" node returns `updated: items.length` — change it to count only rows the Supabase update actually returned (snapshot first, rollback rule 2). Dormant today (all 33 clients EF-routed), so low urgency, but it carries the same silent-loss contract the EF fix removes.
- **O-10 (run 2, environment):** This sandbox cannot execute any authenticated write drill (no staff key; client review tokens are not anon-readable; Chromium egress TLS is reset). The two Tier-0 client-facing drills (O-2 share mint, O-3 `?c=` save) and the F141 live browser repro therefore need an owner-machine / CI runner with a staff key. Confirm that channel so these oldest client-facing gaps can finally close.

## Run history

### Run 2026-10-02 (Proof, owner machine) — live backend, TEST-only writes; incomplete

The four OPEN_REPAIRS 205a priority rows were checked before client workflow drills. Real dates above describe the specific positive proof; partial checks do not reset a missing half. Source churn makes untouched old proofs stale even inside their calendar window.

The client comment control defect was independently reproduced on both surfaces and fixed in the candidate with a deferred-success/refusal regression guard. Windows import/CRLF checker failures and a stale staff browser harness were reproduced and corrected. See [dated audit](../audits/2026-10-02-site-assurance.md) and OPEN_REPAIRS 328. Every disposable card was archived and read back; retained archive history is intentional.

This run does **not** satisfy the stop condition: real staff credentials/actor, fresh issuance, native staff/intake/Kasper proofs, and private restore inputs are missing; live HR mutations fall outside TEST-client-only scope. Two final cycles can be dry for available scoped checks without certifying unexecuted surfaces. Resume when private inputs are loaded and the candidate is published; do not mark all Tier 0/1 fresh.

### Run 2026-09-24 (Atlas, role key in env) — rename both ways, Kasper review save, Workload save; TEST client only
- **Card → sub-issue rename:** dawn check 8/8 flows passed (includes the rename and its restore on card and sub-issue).
- **Sub-issue → card rename:** `qa/probes/rename_subissue_to_card_live.js` 5/5 (card and sibling followed, all three restored). One earlier attempt aborted silently mid-flow; the probe now records any exception as a failure.
- **Kasper review save:** new `qa/probes/kasper_samples_native_live.js` 7/7. It creates a native TEST sample through the Samples "Create post" dialog, the SMM sends it to Kasper from the status menu, Kasper approves, and both the sample (Client Approval) and its sub-issue (client_approval) advance; then the sub-issue is canceled and the sample archived. A SyncLinear status change does not move a sample card: samples-origin rows are out of scope of the calendar status projection by design (the trigger says so), so the SMM step is the correct path.
- **Workload save:** new `qa/probes/workload_plan_set_clear_live.js` 7/7. Workload hides Backlog, client-approval and done rows, and every TEST sub-issue was in one of those, so the probe moves one TEST sub-issue Backlog → Todo through the real SyncLinear status write, sets and clears its work day (each surviving a fresh load), then moves it back to Backlog.
- **Cleanup:** 0 probe samples open, 0 probe sub-issues open (7 canceled probe sub-issues remain as records). **Confirmed findings: none.**

### Run 2026-09-24 (Atlas, with role key) — sub-issue-to-card rename, Kasper Samples, Workload saves; TEST client only
- **Sub-issue-to-card rename: PROVEN LIVE.** `qa/probes/rename_subissue_to_card_live.js` 5/5: the real SyncLinear title edit on a TEST video sub-issue saved ("Renamed. The card will follow."), the card name and the sibling graphic sub-issue both followed, and all three were restored to their exact originals. The earlier 401/403 was the harness, not the app: `production-write` needs the real key AND the real `x-syncview-actor`; the probe now sends both.
- **Workload saves: not provable on the TEST client by design.** The board shows only rows whose client is active (`wlIssueClientAllowed` → `nativeClientActive`); with the live key the board held 289 rows and none for the TEST client. Proving set/clear would need a real client's row, which the mandate excludes. Owner one-liner: allow a TEST-only Workload fixture (make the TEST client board-visible), or accept the mocked `qa/workload-native` lanes as the proof.
- **Kasper Samples half: not provable yet.** The TEST client has 3 Samples, all blank and none linked to a native deliverable, so no Kasper approve/request can land (`native_link_required`). Needs a native-linked TEST sample created through the normal intake path first.
- **Confirmed findings: none.**

### Run 2026-09-24 (Atlas, follow-up) — mandate: sub-issue-to-card rename live, Kasper Samples half, Workload saves, market research; TEST client only
- **Sub-issue-to-card rename: BLOCKED on credentials, not proven.** New probe `qa/probes/rename_subissue_to_card_live.js` drives the real SyncLinear title edit on a TEST card with two native sub-issues. `production-write` answers 401 to the harness stub key and 403 to the repo `SYNCVIEW_STAFF_KEY`; the page shows "This write is not allowed for the selected issue." (refusal visible, nothing changed, restore verified). Needs an editor/admin role key in the runner (`SYNCVIEW_ROLE_KEY`).
- **Kasper Samples half: not proven.** `sxr_kasper_audit_holes` and `sxr_gating_flags` are red on the Kasper approve/request steps, and both are documented in-file as expected red until migrated to the native write lane (OPEN_REPAIRS 175). A live drill goes through the same role-gated writer as above.
- **Workload saves: not attempted.** `workload-plan` is role-gated (the dawn check records 401 with the staff key); same role key needed.
- **Market research:** TEST client Brief tab opens (Keywords / Competitors) and shows the "No Keywords Brief yet" empty state with 0 page errors. The populated tabs exist only on real clients, which the mandate excludes, so that half stays unproven.
- **Confirmed findings: none.** Refuted: a TEST sub-issue titled "Video 1 — Video 1 — TEST 2" looked like a doubled prefix, but the card itself is named "Video 1 — TEST 2" (test data), so the composed title is correct.
- **Unit fix:** `test/assurance-ledger-staleness.js` now reads the real ledger's State stamp instead of pinning 2026-08-22, keeping every other assertion.


### Run 2026-09-23 (Atlas) — mandate: client-first sweep of this week's changes; TEST-client writes only, all restored; one fix PR per confirmed bug
- **Proven (real Chromium, live backend, test client only):** client link lands on Review; client approve and request-changes save and hold; staff card save ("Saved, syncing" path, saved at 760 ms); card-to-sub-issue rename follows and restores; Notes audience filtering (client sees only client notes) and the unread-note lifecycle; Samples review comment, graphic request-change, worst-of status and cleanup; staff tabs Workload, SyncLinear, Analytics, Kasper, Calendar and TikTok Upload render with 0 page errors.
- **Not reached:** sub-issue-to-card rename (release 2 ships flag off, nothing live to prove); TikTok Upload write path (no test-client post made).
- **Confirmed findings:** none. **Refuted: 3** — Samples-probe video approve on a disposable seed (by design: `native_link_required`, seeds have no native deliverable); realtime WebSocket 500 console errors (sandbox proxy, not app); Workload "Failed to fetch" in an ad-hoc sweep with no role key (harness, the dawn check opened Workload fine).
- **Uncertain / cosmetic (for review):** cold opens ran 1.6x to 2x the 2026-09-23 speed map (Workload 15.2 s, SyncLinear 7.2 s, Analytics 10.7 s, staff calendar 17.4 s) from a sandbox behind a proxy, so not comparable until measured from the owner machine; TikTok Upload preview's "?" avatar badge overlaps the placeholder text; upload limit reads "up to 287.0 MB" (odd figure).
- **Housekeeping:** `ot4_t0_client_samples.js` still asserts a video approve on a seed card that can never succeed; it should act on the caption like the dawn check.


### Run 2026-07-19 (run 2) — mandate: TEST-drill mandate; F141 first, then the two unproven Tier-0 halves, then expired Tier-0/1 by score; drills TEST-only, archive all, ⛔ frozen writers untouched, no flag changes, adversarial verification, ship as draft PRs; night-shift checkpointing
- **Self-supervision:** Run 1 ended blocked on drill-class work; run 2 carried the drill mandate but the sandbox's own constraints (no staff key, tokens not anon-readable, Chromium TLS reset) blocked every *authenticated write*. Pivoted to what the sandbox CAN do decisively: read-only live probes + source/hermetic proof + repo-side fix. Yield: one confirmed Tier-1 finding root-caused and fixed; two client-facing drills honestly deferred with executable specs.
- **Cycle 1 (F141, T1 Samples reorder):** Root-caused the 07-16 silent reorder loss to the `sample-review-reorder` EF returning `updated: parsed.items.length` (requested count, not matched count) while `_sxrPersistReorder` checked only the ok flag — so a reorder referencing any non-matching id (stale/mid-create/archived/raced) was silently dropped. Classified per the register's question: **not a signed-in 401** (keyless → `401 credentials_required`, live-proven; signed-in carries the key), **write fires (200)**, **reverts silently**. The calendar sibling was already correct; samples diverged at the F35 EF gating (07-14), matching green-13→red-16. **Fixed** EF (true count) + client (fail-closed on `updated < items.length`, EF route) + guards (`a2-writer-edge-source.js` symmetry + hermetic `sxr-reorder-failclosed.js`). 133/133 suites green → draft PR. Adversarial: source symmetry vs calendar; hermetic revert-on-partial proof; sibling scan (no other EF affected); n8n fallback confirmed to share the lie (owner-gated O-9).
- **Cycle 2 (Tier-0 client-facing drills, O-2/O-3):** NOT REACHED — both require credentials unavailable in this sandbox. Live read-only confirmations recorded instead: issuance EF enforces auth (`401 credentials_required`); `client_access` tokens are not anon-readable (correct posture); deployed `index.html` ≡ `origin/main` (SHA-256 `f03d6e18…`) refreshing the Tier-0 served-bytes integrity proof. Drills re-queued with prompt-ready specs (O-2/O-3) plus an owner one-liner (O-10) to name a staff-key-bearing runner.
- **Stop decision:** stopped after Cycle 1's confirmed fix + Cycle 2's blocked-but-characterized drills. Remaining top-scored gaps are all authenticated-write drills the sandbox cannot run; continuing would only re-derive the same blocker. No expired Tier-0/1 rows by date at 07-19 (windows still open since the 07-17 refresh).
- **Refuted/not-claimed:** did NOT claim the 07-16 nightly is now green — the fix converts silent loss into a surfaced revert and closes the invariant, but live confirmation on current code needs the deferred browser drill. The specific create+drag trigger may already pass on current code (post-#813 the newborn id reconciles before drag); the durable win is the route-independent silent-loss class being closed + guarded.
- **Recommended next run:** after the EF redeploys and a staff-key runner is available (O-10) — then close O-2, O-3, the F141 live drill, and O-9 (n8n mirror) in one drilled pass.

### Run 2026-07-17 (first run) — mandate: back-fill ledger, all tiers, ≤6 cycles, read-only probes only, findings as draft PRs
- **Back-fill:** full EXECUTION_LOG extraction (2026-07-03 → 07-16) mapped to the QUALITY_TIERS surface list; churn marked from the `main` merge history since 07-13.
- **Cycle 1 (T0 posture):** live-vs-main hash match; anon-posture probe (11 tables + 6 reader EFs, all expected codes); issuer CORS preflight → the share-button fix confirmed LIVE (upgrades the 07-15 invalidated proof); writer EF preflights healthy. New live findings: none; one process gap (O-1).
- **Cycle 2 (T1 Samples, F73):** confirmed on `main` at source level (3 stale boot copies + the CI pin), fixed, guard reworked with semantic cases, verified in a local fresh-profile browser (mount / reload / opt-out / override), 126/126 suites green → draft PR `claude/f73-sxr-boot-gate-ga`.
- **Cycle 3 (T1 mirror / T3 monitors + backup, read-only APIs):** backup scheduled runs 5/5 green; calendar nightly green 07-16; **samples nightly red 4 nights untriaged → F140 + F141 registered; F139 found live** (5 webhook timeouts, 1 red reconcile run, heal-burst burn) and root-caused from the node's own code + payload + a local regex repro + the stored card row.
- **Cycle 4 (F139 repo-side fix):** strict ident extraction + batch hygiene at all three repo callers + `test/linear-ident-uuid-guard.js`; 127/127 suites + `parity_logic` NO GAPS → draft PR `claude/linear-ident-uuid-sanitize`.
- **Stop decision:** stopped after 4 of 6 cycles — every remaining top-scored gap requires either a TEST-client drill (excluded by the read-only mandate) or an owner decision (O-1…O-8). Two consecutive dry cycles were unreachable: cycles 3–4 produced findings.
- **Refuted/discarded this run:** 2 candidate signals — the 07-15 nightly carnage (environmental: the client-writer incident window, not a distinct defect) and the local `prod-readonly-smoke` timeout (sandbox browser egress, not an app failure; the same smoke is green in CI 07-16). Live-browser lanes remain CI/owner-machine provers for this sandbox.
- **Recommended next run:** 2026-07-24 (T0 window) or immediately after the owner answers O-5/O-7 — with TEST drills allowed, so the F141 reorder repro, the `?c=` client-link probe (O-3), and a real browser share (O-2) can close.
