# Session briefing — read this first

> Last verified: 2026-07-11 @ ae8a492

You are working on **SyncView**, the internal production app for a social-media agency
(Synchro Social). Read this once and you can skip an hour of re-discovery.

## What the system is (60 seconds)

- **The entire app is `index.html`** — a single-file SPA (~44k lines), served by GitHub Pages
  from `main` at `syncview.synchrosocial.com`. **Merging to `main` deploys immediately.**
- Backends: **Supabase** (Postgres REST + Edge Functions), **n8n** (webhook workflows),
  **Google Sheets** (roster/config via unauthenticated gviz CSV), **Linear** (the team's
  issue tracker, being replaced in-app by Track B).
- `thumbnails/` is a self-contained sister app; nothing in SyncView references it.
- Surfaces: content calendar, samples (SXR + legacy), three review flows (client / Kasper /
  SMM), onboarding funnel, sales intake, filming plans, thumbnail tools, SMM weekly reports,
  and the **Production tab** (`?prod=1`) — an in-app Linear mirror, **read-only by design**;
  do not add writes unless a milestone explicitly enables them.

## Read order for any task

1. `REPO_MAP.md` — where everything lives (CI-enforced, trustworthy).
2. This file.
3. The `docs/truth/` doc for your area (see `docs/truth/README.md` for the index) — these are
   living docs, updated in place, partially CI-enforced.
4. Feature specs in `docs/features/`, program state in `docs/independence/`
   (`INDEPENDENCE_PLAN.md`, `SYSTEM_MAP.md`).
5. Dated evidence in `docs/audits/` **only if** you need the raw proof behind a truth-doc
   claim. Do not start here.

## The don't-re-audit rule

Before exploring the codebase or live systems to answer a question, check whether a
`docs/truth/` doc already answers it. If it does and the freshness stamp is recent, **trust
it**. If the stamp is old and the claim is load-bearing for your task, verify **that one
claim**, correct the doc, bump the stamp. Full re-audits are a last resort, not a ritual.

## Laws and enforced invariants

- **`ROLLBACK.md` is law**: one-step rollback must always exist; log every deploy, flag flip,
  migration, backup, and incident in `EXECUTION_LOG.md`.
- `npm test` runs every `test/*.js` offline — including `test/repo-map-sync.js` (repo layout
  vs `REPO_MAP.md`) and `test/truth-sync.js` (truth docs vs code). CI runs it on every push.
- Production-tab / design-kit changes must pass `npm run test:prod-polish`.
- `docs/CLIENT_LIFECYCLE_MAP.md` is **byte-identical mirrored** to the `synchrosocial` repo —
  change both together, never move it.
- Line endings are LF-normalized (unit tests string-extract from `index.html`).
- Additive-only SQL in `migrations/` (baseline-plus-deltas; no auto-runner).

## Live-system safety

- Runtime kill-switches live in Supabase `syncview_runtime_flags` — flags are currently
  scoped to the TEST client only (`sidneylaruel`); `ROLLBACK.md` has the live-state table.
- n8n workflows are the production write path — snapshot to `n8n-backups/` before touching
  (rollback rule 2). Live QA uses the TEST client only.
- Known standing hazard *(per `docs/audits/2026-07-05-reaudit-summary.md`)*: several
  credentials are exposed (per-SMM Linear API keys in a publicly readable sheet tab; house
  Linear key hardcoded in n8n; an Anthropic key in two n8n nodes). Rotation is owed; don't
  add new secrets to sheets or n8n nodes.
