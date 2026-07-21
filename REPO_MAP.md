# Repo map

The one-page guide to where everything lives. **This file is enforced**: the
offline unit suite (`test/repo-map-sync.js`, run by `npm test` and by CI on
every push) fails if a top-level path or `docs/` subdirectory is added,
renamed, or removed without updating this map — so keep it current in the same
commit as any structural change.

## Top level

| Path | What it is |
|---|---|
| `index.html` | **The entire application** — a single-file SPA, served to production by GitHub Pages from `main`. Merging to `main` ships immediately. Deliberate nav mapping: visible **Linear** = `navProd` / key `production` / `#production` (`?prod=1` alias, authority-gated native mirror); visible **Submit** = `navLinear` / key `linear` / `#linear` (submission form). The mirror's status/comment/due/assignee controls write only through `production-write` when role/team/authority gates pass (or for the bounded active-TEST override); current authority must be read back, not inferred from this map. |
| `404.html`, `CNAME` | GitHub Pages plumbing (SPA fallback redirect; the `syncview.synchrosocial.com` domain). Must stay at root. |
| `README.md` | Project overview: what SyncView does, architecture, development, deployment. |
| `REPO_MAP.md` | This file. |
| `AGENTS.md` | Instructions for coding agents (Production-tab rules, gates, doc upkeep). |
| `ROLLBACK.md` | **The one-step-rollback runbook ("law")** + the Live State table. Stays at root so it is findable in an emergency. |
| `EXECUTION_LOG.md` | Running dated log of every deploy, flag flip, migration, backup, and incident (rollback rule 5). |
| `package.json` | npm scripts for every test lane (see "Test & automation entry points" below); dev deps are Playwright + Argos only. |
| `synchro-social-favicon.png`, `synchro-social-logo.png`, `syncview-favicon.png` | Runtime images referenced by `index.html` via relative URL. Must stay at root. |
| `.gitattributes`, `.gitignore` | LF normalization (unit tests string-extract from `index.html`); ignore rules for generated artifacts. |

## Runtime asset folders (served by GitHub Pages — do NOT move)

All referenced from `index.html` by **relative URL**; moving them breaks the live site.

| Path | What it is |
|---|---|
| `onboarding-ai/` | Images for the AI onboarding funnel. |
| `onboarding-audio/` | Music-genre preview MP3s for the onboarding form. |
| `onboarding-video/` | Subtitle-style/sample preview MP4s for the onboarding form. |
| `thumbnail-styles/` | Thumbnail font/style preview JPGs for the onboarding form. |
| `thumbnails/` | **SyncThumbnails** — a self-contained sister app (own README/CLAUDE.md, no build step). Nothing in SyncView references it; it is served at `/thumbnails/`. |

## Backend & data

| Path | What it is |
|---|---|
| `supabase/` | Standard Supabase CLI layout: `supabase/config.toml` + `supabase/functions/` (Edge Functions). B4 outbound lives in `supabase/functions/linear-outbound/`, `supabase/functions/deliverable-write/`, `supabase/functions/batch-write/`, and shared write/auth code under `supabase/functions/_shared/`; `supabase/functions/linear-inbound/` owns strict echo suppression. `supabase/functions/workload-plan/index.ts` is the live, deliberate-manual, Admin/SMM-authenticated projection/writer for Workload's internal plan-date sidecar; Creative is denied. Scoped deploys are path-triggered by `.github/workflows/deploy-onboarding-edge-functions.yml`, `.github/workflows/deploy-thumbnail-edge-functions.yml`, and `.github/workflows/deploy-pto-edge-functions.yml` — do not move. |
| `migrations/` | Manually-applied Supabase SQL, kept for provenance (no auto-runner). `2026-07-11-b4-linear-outbound.sql` is the additive durable-outbox/switch delta; `2026-07-20-f27-team-rollback.sql` is the source-only, isolated-proved per-team rollback hold/snapshot/classification/final-CAS candidate (not live-applied); `2026-07-15-pto-tracker.sql` is the locked PTO schema plus default-off flag source; `2026-07-15-pto-cancellation-audit.sql` is the source-only additive cancellation-attribution hardening; `2026-07-19-workload-plan.sql` represents the live, service-role-only sidecar for internal Workload plan dates (effective grants read back; exact revoke-correction artifact provenance remains F147). PTO migrations contain no HR seed data. See `migrations/README.md` for the baseline-plus-deltas layout and source-only-vs-applied distinction. |
| `n8n-backups/` | Point-in-time n8n workflow snapshots — the rollback anchors required by `ROLLBACK.md` rule 2. Purely archival; read by no code. |

## Documentation (`docs/`)

| Path | What it is |
|---|---|
| `docs/CLIENT_LIFECYCLE_MAP.md` | **THE CANONICAL client lifecycle map** (traffic → booking → sales → onboarding → provisioning → samples → production). The former byte-identical mirror in the `synchrosocial` repo is retired (owner decision 2026-07-19, after proven silent drift — see docs/audits/2026-07-19-vault-audit.md): that repo now holds only a stub pointing here. Edit this copy only. |
| `docs/FIND_ANYTHING.md` | The one-hop retrieval router: "I want to know X → open exactly Y" for both repos, plus the register index (F-/D-/OQ-/KQ-/VA-numbers) and the owner's no-session path. Draft pending owner ratification (vault audit 2026-07-19, proposal P4). |
| `docs/features/` | **Status-bearing feature contracts** — one doc per shipped feature. Each must state whether it is current deployed truth, a blocked future design, or non-operative history; completed SQL/workflow rollout recipes must not remain executable-looking. Repo-wide visible-control rules live in `UI_DESIGN_STANDARDS.md`; `PTO_VISUAL_DIRECTIONS.html` is the synthetic, non-operative comparison board for the three staff and three Kasper layout directions. |
| `docs/ops/` | Runbooks: new-client onboarding, Linear reconcile safety net, monitoring/rollback coverage map (`docs/ops/MONITORING.md`), pending cleanup checklists. |
| `docs/independence/` | The active independence program: `docs/independence/INDEPENDENCE_PLAN.md` (strategy), Track A (Edge Functions) and Track B (Linear replacement) specs, dependency audits. |
| `docs/testing/` | How to test — start at `docs/testing/README.md` (the map: suites, gates, the two safety contracts, and the four testing skills). Then: `docs/testing/CALENDAR-TEST-CATALOG.md` (what to check), `docs/testing/HEADLESS-TESTING-GUIDE.md` (how to run live probes), `docs/testing/PRODUCTION_POLISH_AUTOMATION.md` (the prod-polish gate), and the interaction-path generator. |
| `docs/truth/` | **Living current-truth docs** — start at `docs/truth/BRIEFING.md` (session briefing) and `docs/truth/README.md` (the contract). Updated in place, freshness-stamped, drift-checked by `test/truth-sync.js`. Conclusions live here; evidence stays in `docs/audits/`. |
| `docs/audits/` | Dated audit evidence (2026-07-03 →). Historical record — do not edit old audits; add new dated files. `2026-07-19-boot-refresh-history-audit.md` preserves the immutable early-frame/refresh/history evidence behind F149–F162, the separately labelled publication source-only read-truth recon behind F163–F169, remediation-phase controlled synthetic-browser Calendar evidence behind F170–F171, the source-only staff Analytics follow-up behind F172, and successive exact-head remediation-review/current-candidate evidence behind F173–F184. Current unmerged PR #891 `c9a79ef` passed local `npm test` 150/150 and visible boot 23/23, with the earlier F179/F184 blockers locally remediated, but exact-head cloud source review `4741601566` (comment `3619744849`) expanded F176 again at `qa/overnight_runner.sh`'s ambient staff-issuer process boundary. Follow-up local source tracing found the transitive `qa/overnight_cron_chunk.sh` pass-through, unrelated helper inheritance and the missing declared scenario/master broker boundary. Scenario and master are legitimate issuer consumers; staff-only/Calendar/unknown/manual/cleanup/unit/server/timeout/Git children are not. No credential, data, browser, backend or write was used for either source pass. The review is not clean; all affected remediation rows remain OPEN pending F176 remediation, exact-head cloud re-review and owner merge. Current conclusions belong in `docs/truth/`. |
| `docs/vision/` | **Owner vision statements** — recorded owner intent behind major directions (dated, distilled from the owner's own words, with the owner's pinned follow-ups). Start at `STEP_BACK_2026-07-18.md` (the enterprise-atlas mandate and the sessions-feed-the-vault doctrine). |
| `docs/archive/` | Completed/superseded docs: finished migration plans, spent prompts, incident notes, old QA reports (`docs/archive/qa/`). Nothing here is current truth. |
| `docs/syncview-design/` | The **locked design kit** for the visible **Linear** mirror (internally the `production` surface): `docs/syncview-design/SyncView.html` (behavior source of truth), `docs/syncview-design/linear-design-tokens.md` (visual build spec), `docs/syncview-design/WIRED-PARITY.md` (parity contract), wired test gates in `docs/syncview-design/tests/`, raw probe measurements in `docs/syncview-design/probe-data/`, prototype-era suites in `docs/syncview-design/tests/design-machine-originals/`. |

## Test & automation entry points

| Command / trigger | What runs | Notes |
|---|---|---|
| `npm test` | `test/run-all.js` → every `test/*.js` (offline, no network) | Runs on every push (`calendar-unit-tests.yml`). Run before every commit. |
| `npm run test:e2e` | `qa/run-probes.js` → probes in `qa/probes/nightly-manifest.txt` | **Live backend**, test client only. Nightly (`calendar-e2e-nightly.yml`). |
| `npm run test:master` | `qa/master.js` — all master-registered lanes (unit, parity, probes, scenarios, temporal, visual); feature-scoped PTO runs separately | Samples nightly runs a lane subset (`samples-e2e-nightly.yml`). |
| `npm run test:pto-lifecycle` | `qa/pto-lifecycle/run.js` — stateful synthetic PTO human journeys with action/result screenshots and policy time travel | Fully mocked and CI-safe (`pto-ui-tests.yml`); curated synthetic evidence lives in the dated PTO lifecycle audit. |
| `npm run test:pto-live-drill` | `qa/pto-lifecycle/live-drill.js` — one privately gated disposable unpaid TEST request, approval, exact deletion, zero request-row residue, and flag readback | Local release drill only; never CI, never a real staff profile, screenshots remain untracked. |
| `npm run test:prod-polish` | `docs/syncview-design/tests/prod-polish-gate.js` — 10 Production-surface suites: locked live-read/zero-mutation, fully mocked authority/write gateway, interaction, behavior, and visual lanes | PR fast gate plus post-merge/scheduled/manual long lanes (`production-polish-gate.yml`); no suite may mutate a live backend. F105 repaired the post-#813 fixture/layout/read-audit epoch; only exact eligible read recovery is accepted, pending/unmatched errors stay red, and the exact candidate must pass the full aggregate before merge. |
| `qa/overnight_runner.sh` | Continuous unattended QA loop | Local only; see the `/overnight-test` skill. F176 remains OPEN at PR #891 `c9a79ef`: `qa/overnight_runner.sh` and `qa/overnight_cron_chunk.sh` propagate the supplied staff issuer beyond the 39-probe registry. Both shell entries must capture then unset it before any child; only registry-approved probes and explicitly declared scenario/master brokers may restore the staff issuer to the final operative Node process, never the legacy token, timeout/wrapper argv, logs or unrelated helpers. |
| Reconcile crons | `scripts/linear-sync-reconcile.js`, `scripts/sample-linear-reconcile.js`, `scripts/linear-deliverables-reconcile.js`, `scripts/b1-linear-backfill.js` | Scheduled GitHub Actions; `scripts/` also holds tested one-shot ops tools. |
| n8n quota watchdog | `.github/workflows/n8n-execution-quota-watchdog.yml`, `scripts/n8n-execution-quota-watchdog.js`, `test/n8n-execution-quota-watchdog.js` | Daily GitHub-hosted n8n Insights count, 80%/90% owner alerts, month-scoped dedupe, and low-threshold dry-run support. Runs outside n8n so scheduler failure there cannot disable the watcher. |
| B4 outbound | `.github/workflows/linear-outbound-drain.yml`, `scripts/b4-linear-outbound-harness.js`, `scripts/b4-outbound-shadow-audit.js`, `scripts/b4-pager-outbound.js`, and matching `test/*.js` | Durable drainer cadence, fail-closed TEST-only live proof, read-only full-roster shadow analysis, and idempotent n8n pager wiring. Global mode defaults to `off`. |
| F27 team rollback | `.github/workflows/f27-team-rollback-proof.yml`, the F27 job in `calendar-unit-tests.yml`, `scripts/f27-team-rollback-proof.sql`, and `test/f27-team-rollback.js` | Disposable PostgreSQL flip/stop/classify/final-CAS transaction with exact-state/data hashes, correlated terminal receipts, other-team isolation, and a GitHub observer outside n8n. It never targets the live project. |
| Track-B private recovery | `.github/workflows/track-b-backup.yml`, `scripts/track-b-backup.js`, `scripts/track-b-restore-rehearsal.js`, `test/track-b-backup.js`, `docs/ops/TRACK_B_BACKUP.md` | Six-hour production-read-only PostgreSQL snapshots to private Drive, direct non-n8n freshness alerting, and a production-ref-blocked scratch restore rehearsal. Sensitive packages are never Actions artifacts. |
| Thumbnail revision watcher | `.github/workflows/thumbnail-revision-scan.yml`, `scripts/thumbnail-revision-scan.js`, `test/thumbnail-revision-scheduler.js`, `test/thumbnail-revision-history.js` | Ten-minute, dedicated-signature caller with bounded aggregate-only scanning; the repository variable is the independent scheduler kill. |

## Meta

| Path | What it is |
|---|---|
| `.github/` | CI workflows (unit, nightlies, prod-polish gate, reconcile crons, edge-function deploy), PR template, Copilot instructions. |
| `.claude/` | Claude Code config: hooks (README-drift + repo-map reminders), the six quality skills (`master-test`, `overnight-test`, `human-audit`, `feedback-expansion`, `bug-archaeology`, `site-assurance`) — each a general protocol + target binding; when to use which: `docs/testing/README.md`; the shared prioritization contract: `docs/QUALITY_TIERS.md` — plus the meta skills `skill-forge` (the house method for creating/improving skills: amplification intake + house invariants; see `docs/vision/STEP_BACK_2026-07-18.md`) and `night-shift` (unattended work under shared usage limits: checkpoint-every-unit, pause-not-failure, sleep-across-the-reset). |
| `test/` | Fast offline unit/wiring suites — auto-discovered by `test/run-all.js` (every `test/*.js` runs; fixtures live in `test/fixtures/`). Workload plan-date coverage is split between `workload-plan-source.js`, the hermetic production-helper harness `workload-plan-failclosed.js`, and the extended tweak/literal-bucket guard. |
| `qa/` | Headless browser QA: live test-client probes/scenarios plus the fully mocked PTO lifecycle simulator and its separately gated disposable live lane. See `qa/README.md`. |
| `scripts/` | Ops jobs run by CI crons + one-shot migration tools (each guarded by a `test/*.js` counterpart). |

## Where does a new file go?

- **Feature spec / design doc** → `docs/features/` (link it from the feature's code comments).
- **Runbook / operational procedure** → `docs/ops/`.
- **SQL migration** → `migrations/YYYY-MM-DD-<slug>.sql` (additive-only; log it in `EXECUTION_LOG.md`).
- **Offline test** → `test/` (it runs automatically; no registration needed).
- **Live probe** → `qa/probes/` + add it to `qa/probes/nightly-manifest.txt` if it should gate the nightly.
- **Stateful feature journey** → a feature-scoped folder under `qa/`; make its live-vs-mocked contract explicit and keep any live lane separately gated.
- **Production-tab (design-kit) test** → `docs/syncview-design/tests/` + wire it into `prod-polish-gate.js` or `package.json`.
- **Finished / superseded doc** → `docs/archive/` (don't delete history).
- **New top-level anything** → think twice, then document it here (CI will remind you).
