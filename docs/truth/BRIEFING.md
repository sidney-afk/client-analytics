# Session briefing — read this first

> Last verified: 2026-07-20 @ 86fe60c + boot-audit branch (current-state reconciliation through F172; F04/F07/F08 implementation defects closed with live observations still gated; F12 corrected OPEN for missing real-generation/failure receipts; F124 CLIENTS METRICS half live-proved with TOP VIDEOS open; F143 deployed + preflight re-verified; F145 parent-link hierarchy merged as #885; Workload release and #889 grouping/group drag served with F147/F148 evidence follow-ups; boot/refresh/history/read-truth audit registered as F149–F172; coverage state in docs/testing/ASSURANCE_LEDGER.md)

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
  evidence-bearing complete recovery. F27's PR #894 candidate makes the final Track-B team
  authority reversal one guarded statement and passed an isolated TEST transaction, but remains
  live-blocked until cloud review, migration application/readback, and a deployed TEST-client drill; F51
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
  off, and auth is permissive. Two more live flags matter: `write_ui_reroute_clients` — the
  Phase-2 write-UI dark-launch allowlist (TEST client only; a missing/unreadable read fails to
  the LEGACY lane, the OPPOSITE fail direction from the Track-A allowlists) — and `pto_v1`
  (staff PTO tracker, live ON since 2026-07-15 under owner decision D-36). The exact TEST
  fixture identity stays in private operator config; `ROLLBACK.md` has the public-safe
  live-state table.
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
- The Workload internal-plan caller, locked sidecar, and exact-source `workload-plan` v2 are live.
  The private TEST release proved pre-write `409` rollback, Creative denial, save/reload/clear,
  due-date preservation, and exact cleanup with all 13 flags unchanged. This Order-1 docs pass
  performed none of those live actions. PR #889's client-only grouping/group drag is served from
  current main and reuses sequential one-row writes; #884's server-atomic batch contract remains
  open. F147 keeps the exact migration-correction artifact provenance open; F148 keeps the
  insufficient same-chain true-count source guard and reused-F141 test-label cleanup open.
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
  link (F137); and persisted native activity is requested only for status-history derivation, then
  failure-collapsed and never shown as Activity (F138).
- F145 is merged on `main` via #885 without a schema, n8n, writer, flag, or live-data change: Production
  projects each deliverable's persisted Linear parent UUID and resolves it globally to the live
  native parent row. Batch/title similarity no longer invents hierarchy; missing or malformed
  parents leave work visible as roots. Parent-only webhook changes retain the existing
  refresh-eventual convergence contract. Pages run `29713997171` deployed the merge, and read-only
  live HTML confirms the resolver/raw-parent path with `batchParent` absent. Exact-head run
  `29711105120` attempt 2 passed all four F145 lanes before merge; current-main run `29713997723`
  later failed fast + interaction while heavy/review-packet passed. The PR-head and merge trees are
  identical, so the red run is not evidence of an F145 code delta, but current-main test health
  remains open.
- The public-safe boot/refresh/history/read-truth audit owns F149–F172. Client entry remains first:
  F102/F117 plus the Calendar/Brief wrong-shell refresh in F149. Browser-proven silent read failures
  and indefinite boot states are F151/F152/F158; staff data, Back/Forward and deep-link continuity
  are F150/F153/F154; F155–F161 cover lower-severity route consistency. Publication-time
  **source-only targeted recon** adds Brief synthesis (F163), Samples Review fallback (F164),
  Filming (F165), Onboarding (F166), Weekly Reports (F167), Credentials/history (F168), and Editors
  (F169), while expanding existing Workload F29, Linear picker F45, Kasper Review/Messages F130,
  Production Activity F138, and deadline F152 ownership. No new browser proof is claimed for those
  source-only paths. Remediation-phase controlled synthetic-browser evidence adds Calendar
  primary/ancillary/realtime lifetime ownership in F170 and a P0 held client-A → client-B
  continuation/write boundary in F171. Draft #891 candidate `baa4ebf` proposes generation-owned
  abort/realtime/exit/BFCache guards, but it is unmerged and cloud review is pending. F172 is a
  separately labelled **source-only** staff Analytics document/BFCache lease gap; no staff browser
  reproduction or runtime frequency is claimed, and the client-only draft does not close it.
  Every remediation must satisfy F162 with a browser guard that observes the
  actual visible sequence from document start through visible failure, keyboard/touch Retry, and
  recovery. Calendar guards must also hold and release real primary/ancillary/realtime work across
  no-load exit, A → B replacement, pagehide and persisted pageshow. A settled-page assertion or
  source check does not close a boot finding.
- F140 is owner-ratified and fixed on the review branch: Samples matches Calendar, so Kasper may
  stack change requests and then Finish hands the card to the SMM. The strict Finish gate remains;
  the fix prevents a fresh status companion from being mistaken for recovery debt before its first
  send/source save. Branch run `29629528360` passed the exact owner-ratified tree leaf 8/8. The
  independent drag-reorder loss (F141) remains open. A stored UUID-form
  Linear link also poisons the shared status batch and intermittently fails the 15-min calendar
  reconcile (F139; repo-side fix staged). Check `docs/testing/ASSURANCE_LEDGER.md` — the per-surface
  proof ledger — before trusting any "surface X works" claim.
- Known standing hazard: several credentials remain exposed (per-SMM Linear API keys in a
  publicly readable sheet tab and the house Linear key in legacy n8n). F52 reverified one
  reachable Graphics title-generation workflow carrying a plaintext provider key across all 50
  retained versions; the complete wider workflow/export/backup population remains unverified.
  Rotation is owed; never add secrets to Sheets, workflow code, docs, or logs.
