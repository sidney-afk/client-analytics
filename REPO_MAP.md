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
| `supabase/` | Standard Supabase CLI layout: `supabase/config.toml` + `supabase/functions/` (Edge Functions). B4 outbound lives in `supabase/functions/linear-outbound/`, `supabase/functions/deliverable-write/`, `supabase/functions/batch-write/`, and shared write/auth code under `supabase/functions/_shared/`; `supabase/functions/linear-inbound/` owns strict echo suppression. Deploys are path-triggered by `.github/workflows/deploy-onboarding-edge-functions.yml` — do not move. |
| `migrations/` | Manually-applied Supabase SQL, kept for provenance (no auto-runner). `2026-07-11-b4-linear-outbound.sql` is the additive durable-outbox/switch delta. See `migrations/README.md` for the baseline-plus-deltas layout. |
| `n8n-backups/` | Point-in-time n8n workflow snapshots — the rollback anchors required by `ROLLBACK.md` rule 2. Purely archival; read by no code. |

## Documentation (`docs/`)

| Path | What it is |
|---|---|
| `docs/CLIENT_LIFECYCLE_MAP.md` | The master client lifecycle map (traffic → booking → sales → onboarding → provisioning → samples → production). **MIRRORED**: a byte-identical copy lives in the `synchrosocial` repo at the same path — change both together, and do not move it into a subfolder (the path is part of the mirror contract). |
| `docs/features/` | **Living feature specs** — one doc per shipped feature (samples, onboarding, sales intake, thumbnails, title review, Kasper review, SMM reports, credentials, filming plans, dark mode…). |
| `docs/ops/` | Runbooks: new-client onboarding, Linear reconcile safety net, monitoring/rollback coverage map (`docs/ops/MONITORING.md`), pending cleanup checklists. |
| `docs/independence/` | The active independence program: `docs/independence/INDEPENDENCE_PLAN.md` (strategy), Track A (Edge Functions) and Track B (Linear replacement) specs, dependency audits. |
| `docs/testing/` | How to test — start at `docs/testing/README.md` (the map: suites, gates, the two safety contracts, and the four testing skills). Then: `docs/testing/CALENDAR-TEST-CATALOG.md` (what to check), `docs/testing/HEADLESS-TESTING-GUIDE.md` (how to run live probes), `docs/testing/PRODUCTION_POLISH_AUTOMATION.md` (the prod-polish gate), and the interaction-path generator. |
| `docs/truth/` | **Living current-truth docs** — start at `docs/truth/BRIEFING.md` (session briefing) and `docs/truth/README.md` (the contract). Updated in place, freshness-stamped, drift-checked by `test/truth-sync.js`. Conclusions live here; evidence stays in `docs/audits/`. |
| `docs/audits/` | Dated audit evidence (2026-07-03 →). Historical record — do not edit old audits; add new dated files. Current conclusions belong in `docs/truth/`. |
| `docs/archive/` | Completed/superseded docs: finished migration plans, spent prompts, incident notes, old QA reports (`docs/archive/qa/`). Nothing here is current truth. |
| `docs/syncview-design/` | The **locked design kit** for the visible **Linear** mirror (internally the `production` surface): `docs/syncview-design/SyncView.html` (behavior source of truth), `docs/syncview-design/linear-design-tokens.md` (visual build spec), `docs/syncview-design/WIRED-PARITY.md` (parity contract), wired test gates in `docs/syncview-design/tests/`, raw probe measurements in `docs/syncview-design/probe-data/`, prototype-era suites in `docs/syncview-design/tests/design-machine-originals/`. |

## Test & automation entry points

| Command / trigger | What runs | Notes |
|---|---|---|
| `npm test` | `test/run-all.js` → every `test/*.js` (offline, no network) | Runs on every push (`calendar-unit-tests.yml`). Run before every commit. |
| `npm run test:e2e` | `qa/run-probes.js` → probes in `qa/probes/nightly-manifest.txt` | **Live backend**, test client only. Nightly (`calendar-e2e-nightly.yml`). |
| `npm run test:master` | `qa/master.js` — all lanes (unit, parity, probes, scenarios, temporal, visual) | Samples nightly runs a lane subset (`samples-e2e-nightly.yml`). |
| `npm run test:prod-polish` | `docs/syncview-design/tests/prod-polish-gate.js` — 10 Production-surface suites: locked live-read/zero-mutation, fully mocked authority/write gateway, interaction, behavior, and visual lanes | PR fast gate plus post-merge/scheduled long lanes (`production-polish-gate.yml`); no suite may mutate a live backend. F105 records that the fast PR lane is green while interaction/heavy remain red after the write milestone. |
| `qa/overnight_runner.sh` | Continuous unattended QA loop | Local only; see the `/overnight-test` skill. |
| Reconcile crons | `scripts/linear-sync-reconcile.js`, `scripts/sample-linear-reconcile.js`, `scripts/linear-deliverables-reconcile.js`, `scripts/b1-linear-backfill.js` | Scheduled GitHub Actions; `scripts/` also holds tested one-shot ops tools. |
| n8n quota watchdog | `.github/workflows/n8n-execution-quota-watchdog.yml`, `scripts/n8n-execution-quota-watchdog.js`, `test/n8n-execution-quota-watchdog.js` | Daily GitHub-hosted n8n Insights count, 80%/90% owner alerts, month-scoped dedupe, and low-threshold dry-run support. Runs outside n8n so scheduler failure there cannot disable the watcher. |
| B4 outbound | `.github/workflows/linear-outbound-drain.yml`, `scripts/b4-linear-outbound-harness.js`, `scripts/b4-outbound-shadow-audit.js`, `scripts/b4-pager-outbound.js`, and matching `test/*.js` | Durable drainer cadence, fail-closed TEST-only live proof, read-only full-roster shadow analysis, and idempotent n8n pager wiring. Global mode defaults to `off`. |

## Meta

| Path | What it is |
|---|---|
| `.github/` | CI workflows (unit, nightlies, prod-polish gate, reconcile crons, edge-function deploy), PR template, Copilot instructions. |
| `.claude/` | Claude Code config: hooks (README-drift + repo-map reminders) and the four testing skills (`master-test`, `overnight-test`, `human-audit`, `feedback-expansion`) — each a general protocol + target binding; when to use which: `docs/testing/README.md`. |
| `test/` | Fast offline unit/wiring suites — auto-discovered by `test/run-all.js` (every `test/*.js` runs; fixtures live in `test/fixtures/`). |
| `qa/` | Live headless E2E: orchestrators, probes, the scenario engine, shared libs. See `qa/README.md`. |
| `scripts/` | Ops jobs run by CI crons + one-shot migration tools (each guarded by a `test/*.js` counterpart). |

## Where does a new file go?

- **Feature spec / design doc** → `docs/features/` (link it from the feature's code comments).
- **Runbook / operational procedure** → `docs/ops/`.
- **SQL migration** → `migrations/YYYY-MM-DD-<slug>.sql` (additive-only; log it in `EXECUTION_LOG.md`).
- **Offline test** → `test/` (it runs automatically; no registration needed).
- **Live probe** → `qa/probes/` + add it to `qa/probes/nightly-manifest.txt` if it should gate the nightly.
- **Production-tab (design-kit) test** → `docs/syncview-design/tests/` + wire it into `prod-polish-gate.js` or `package.json`.
- **Finished / superseded doc** → `docs/archive/` (don't delete history).
- **New top-level anything** → think twice, then document it here (CI will remind you).
