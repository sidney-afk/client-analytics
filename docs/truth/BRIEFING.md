# Session briefing — read this first

> Last verified: 2026-07-14 @ 1ce7c91 (second-pass current-state reconciliation through F138)

You are working on **SyncView**, the internal production app for a social-media agency
(Synchro Social). Read this once and you can skip an hour of re-discovery.

## What the system is (60 seconds)

- **The entire app is `index.html`** — a single-file SPA (~45.8k lines at this checkpoint), served by GitHub Pages
  from `main` at `syncview.synchrosocial.com`. **Merging to `main` deploys immediately.**
- Backends: **Supabase** (Postgres REST + Edge Functions), **n8n** (webhook workflows),
  **Google Sheets** (roster/config via unauthenticated gviz CSV), **Linear** (the team's
  issue tracker, being replaced in-app by Track B).
- `thumbnails/` is a self-contained sister app; nothing in SyncView references it.
- Surfaces: content calendar, Samples/SXR (plus a retained legacy client/backend compatibility
  path whose staff route is Phase-1 retired), three review flows (client / Kasper /
  SMM), onboarding funnel, sales intake, filming plans, thumbnail tools, SMM weekly reports,
  and the visible **Linear** tab (`#production`, `?prod=1`; internal key `production`) — an in-app
  mirror with authority-gated status/comment/due/assignee controls — and the visible **Submit**
  form (`#linear`; internal key `linear`). Real teams are currently read-only because authority is
  Linear, not because the surface is permanently read-only; only the gated cutover plan may enable
  writes.

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

- **`ROLLBACK.md` is law**: every forward change needs a one-step behavior kill plus a rehearsed,
  evidence-bearing complete recovery. F27 means Track-B authority reversal is not one-step; F51
  means an EF source rebuild is not automatically an exact runtime rollback. Log every deploy,
  flag flip, migration, backup, recovery, and incident in `EXECUTION_LOG.md`.
- `npm test` runs every `test/*.js` offline — including `test/repo-map-sync.js` (repo layout
  vs `REPO_MAP.md`) and `test/truth-sync.js` (truth docs vs code). CI runs it on every push.
- Production-tab / design-kit changes must pass `npm run test:prod-polish`.
- `docs/CLIENT_LIFECYCLE_MAP.md` is **byte-identical mirrored** to the `synchrosocial` repo —
  change both together, never move it.
- Line endings are LF-normalized (unit tests string-extract from `index.html`).
- Additive-only SQL in `migrations/` (baseline-plus-deltas; no auto-runner).

## Live-system safety

- Runtime kill-switches live in Supabase `syncview_runtime_flags`. The three Track-A client
  allowlists carry the full active roster; Track-B authority remains Linear/Linear, outbound is
  off, and auth is permissive. The exact TEST fixture identity stays in private operator config;
  `ROLLBACK.md` has the public-safe live-state table.
- Permissive auth is a pre-enforcement posture only. GO_LIVE Phase 0.75 must execute and prove the
  F5 forward CAS before any real-client parity cohort; the old canonical sequence omitted it (F97).
- The first human authority handoff uses fail-safe F2→F1 order: normal outbound is armed/read back
  and proves correlated terminal drainer/credential receipts plus an observer outside n8n, zero
  normal writes, and exact both-team normal-lane zero while both teams remain Linear, then Graphics
  authority opens. A fresh pager timestamp is not health (F131/F132). Any parity writes are separately classified;
  paused normal residue is not green. The former F1→F2 sequence could strand work (F98).
- Production writes are mixed: full-roster Calendar/SXR/settings writes use Edge Functions with
  dormant n8n fallback, while many unmigrated surfaces still use n8n. Snapshot any workflow
  privately plus a public-safe `n8n-backups/` stub before touching it (rollback rule 2). Every live
  write drill uses only the private TEST fixture.
- Green Linear-reader executions are not completeness proof: F29 covers partial multi-source/status
  snapshots and deterministic 100-ID starvation; F126 covers unpaged child/comment expansion that
  can drive Calendar import/link/status writes. Require complete receipts and zero mutation on any
  partial source before merge, flip or B5.
- The update banner is not stale-caller retirement (F127): direct Production has no check,
  onboarding aliases probe 404, and cached old code can baseline/dismiss a new ETag while continuing.
  Require an embedded build/auth-authority epoch, server `upgrade_required` before mutation, and
  privacy-safe population evidence for every mandatory release.
- Public onboarding must not be treated as a safe fake-client harness (F128/F129): its primary
  path can launch real provider/CRM work without invitation/sale/staff approval and can place raw
  account-access answers in Slack. Separate/authorize the durable job, structurally exclude secrets,
  and require provider sandboxes plus captured inverses before any live drill.
- Kasper mobile/recovery is not complete: all eight subtabs require contained accessible navigation
  at 390/768 px (F121), and Review/Messages need active-tab-aware failure plus visible retry rather
  than an indefinite skeleton/dead-end error (F130).
- Monitoring quiet is not terminal health: B1's event/cursor can advance after failed or partial work
  (F131), while the combined pager can stop before later lanes or suppress alerts behind pending/
  malformed state (F132). Require success-only checkpoints, correlated terminal receipts, lane
  isolation, authenticated relay sources, and an observer outside n8n.
- The bounded SMM/editor walks remain blocked: native Create Post can split title truth and strand
  browser-owned recovery (F133/F134); Calendar/Samples reorder has no touch/keyboard path (F135);
  creatives can regress reviewer/terminal work (F136); Video assets collapse into one mislabeled
  link (F137); and persisted native activity is never loaded or shown (F138).
- Known standing hazard: several credentials remain exposed (per-SMM Linear API keys in a
  publicly readable sheet tab and the house Linear key in legacy n8n). F52 reverified one
  reachable Graphics title-generation workflow carrying a plaintext provider key across all 50
  retained versions; the complete wider workflow/export/backup population remains unverified.
  Rotation is owed; never add secrets to Sheets, workflow code, docs, or logs.
