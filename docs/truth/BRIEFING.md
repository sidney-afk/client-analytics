# Session briefing — read this first

> Last verified: 2026-07-24 @ e02b942 (owner-approved F200 roster/data correction live; product source
> unchanged from audit base `1e7c0fd`) + source-only F27 operator-toolkit candidate (PR #901 stop
> evidence still governs live state; corrective source is not live) + Phase-3 reconciliation, the
> public-safe boot/refresh/history audits ending at F199, and the read-only Production/Graphics gap
> audit through F205. The owner split F176/F179 overnight-runner containment into parked draft #908
> for later review; it is not a blocker, must not be expanded or reopened, and was outside both
> audits. Client-token verifier v28 and the matching #891 browser are live. F186–F199 remain an
> unremediated staff punch list, with one BLOCKER at F186. F200 is live as a bounded roster/data
> correction: three active project mappings, one active personal-brand `internal`→`client` correction,
> and 87 owner-ratified CAS attribution repairs; F201–F205 remain unremediated Production/Graphics
> findings. F200 added no schema, migration, runtime flag, n8n workflow, Edge Function, frozen writer,
> deployment, or outbound/Linear mutation. Workload background refresh is on
> `main`, while its deliberate-manual function boundaries remain unchanged. Coverage state lives in
> `docs/testing/ASSURANCE_LEDGER.md`.

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
  evidence-bearing complete recovery. PR #901 records the correctly aborted F27 install: #894 had
  a late-writer authority-handoff race, an actorless replay-echo race, and no real-row-safe drill.
  The owner-merged corrective source adds a server generation fence, an exact open-rollback preflight
  echo proof, and a reserved no-provider drill with permanent audit, but remains not live. The final
  Track-B authority reversal stays live-blocked while the source-only operator toolkit is reviewed,
  then through two separate owner gates: first pin/deploy only `linear-inbound` and establish its
  source-exact baseline; later snapshot the queue, migrate, deploy the remaining four fenced closures,
  and run the bounded drill under `docs/ops/F27_INSTALL_RUNBOOK.md`. F51 records that historical
  transitive graphs are unrecoverable; rollback instead redeploys the exact captured provider source/
  JWT closure and requires independent deployed-source/JWT hash equality. Log every deploy,
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
- F27 is not live. PR #901's stop evidence preserves Linear/Linear authority, F2 off, F4 false,
  no F27 database objects, and no deployment. Do not infer otherwise from merged corrective source
  or its disposable proof. The toolkit candidate pins only `linear-inbound` to
  npm package @supabase/supabase-js version `2.49.8` with a frozen Deno v4
  lock/config. The four install closures retain byte-identical exact `2.49.8`
  import surfaces—direct in outbound/production-write and through
  `supabase/functions/_shared/b4-write.ts` for deliverable-write/batch-write—plus provider-returned
  source without synthetic historical locks. It also adds private snapshot/source rollback,
  inbound-freshness, and reserved-drill operators. It performs no live action. After a separately
  authorized inbound-only preparatory deployment establishes a pinned baseline, a later install
  must snapshot the full live outbox and definitions before DDL, deploy/read back only the remaining
  four generation-aware closures from one merged SHA, and retain the reserved drill audit.
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
  Candidate source separates list from write authorization so Creative can read the same global plan
  snapshot while Admin/SMM retain all set/clear authority; that widening is not live until the exact
  function source is manually deployed and changes no schema, grant, flag, or frozen writer. The
  historical private TEST release proved pre-write `409` rollback, Creative `403` list/set under the
  2026-07-20 deployment, save/reload/clear,
  due-date preservation, and exact cleanup with all 13 flags unchanged. Candidate source adds a
  separate deliberate-manual `workload-linear` function: all staff may read exact deadline and
  `2×`/`3× Workload` metadata, Admin/SMM may edit the Linear due date, and Creative remains
  read-only. It adds no migration, mirror column, n8n change, flag, or frozen-writer dependency and
  is not live until an exact-SHA deploy/readback/TEST drill. The visible board uses four weighted
  video units, retains the item-local no-reflow automatic plan, orders client pills by closest
  plan-to-due buffer, makes forced refreshes bypass the mirror, and reacts when a 60-second mirror-
  watermark poll advances. The upstream scheduled producer is unchanged, so the poll removes only
  the browser-side portion of mirror delay. This docs
  pass performed no live action. PR #889's grouping/group drag continues to reuse sequential
  one-row plan writes; #884's server-atomic batch contract remains open. F147 keeps the exact
  migration-correction artifact provenance open; #892 closed F148's same-chain guard/test-label gap.
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
- The 2026-07-23 findings-only Production/Graphics audit adds F200–F205 and authorizes no fix or live
  change. Of 4,600 mirror rows, 72 render-eligible nonterminal rows are `unattributed`: 70
  missing-project ambiguous and two hierarchy-attribution failures; zero are proven deliberate
  internal/TEST. F200 makes the active SyncView roster the sole client catalog and keeps F145 DONE.
  Owner-ratified full-day target gaps are labels/Workload round-trip (F201), parent/sub-issue
  description writes (F202), and native issue/sub-issue creation with no implicit Calendar linkage
  (F203). F204 owns saved/shared views and manual board ordering; F205 records project board/detail
  status/lead/target disagreement. Existing bridge, comments, assets, freshness, mobile, due,
  Activity, and navigation defects retain their prior F owners.
  F203 candidate source now implements the guarded Production-only creation contract with
  deterministic replay receipts and validated parent reuse; its additive RPC/function/UI release,
  service-only TEST drill, review, and merge remain gated and nothing is live from that candidate.
- The public-safe boot/refresh/history/read-truth audit owns F149–F185. Client entry remains first:
  F102/F117 plus the Calendar/Brief wrong-shell refresh in F149. Browser-proven silent read failures
  and indefinite boot states are F151/F152/F158; staff data, Back/Forward and deep-link continuity
  are F150/F153/F154; F155–F161 cover lower-severity route consistency. Publication-time
  **source-only targeted recon** adds Brief synthesis (F163), Samples Review fallback (F164),
  Filming (F165), Onboarding (F166), Weekly Reports (F167), Credentials/history (F168), and Editors
  (F169), while expanding existing Workload F29, Linear picker F45, Kasper Review/Messages F130,
  Production Activity F138, and deadline F152 ownership. No new browser proof is claimed for those
  source-only paths. Remediation-phase controlled synthetic-browser evidence adds Calendar
  primary/ancillary/realtime lifetime ownership in F170 and a P0 held client-A → client-B
  continuation/write boundary in F171. Draft #891 candidate `02105e9` proposes generation-owned
  abort/realtime/exit/BFCache guards, but it is unmerged. F172 is a
  separately labelled **source-only** staff Analytics document/BFCache lease gap; no staff browser
  reproduction or runtime frequency is claimed, and the client-only draft does not close it.
  Initial exact-head source review added F173/F174; `02105e9` carries their source corrections.
  Completed exact-head review of candidate `02105e9` with audit companion `3189203` then found
  seven further P1 release-control gaps: direct shared-SXR curl argv/error exposure (F175),
  job-wide TEST-token export (F176), static-server and Playwright navigation error/log disclosure
  (F178), manual-dispatch shell injection in credential-bearing steps (F179), and private
  shell/file transports in the full-quota probe, EF auxiliary checks, and optional vision API
  path (F180–F182). F177 records and resolves the stale APP/SYSTEM_MAP wording that still
  described review as pending. Evidence is source-only except for isolated local synthetic
  Python/Playwright proof of F178 and inert, no-payload-execution substitution proof of F179; no
  real token/staff/API key, external network, backend/API, live data or writer was used.
  Post-F182 cloud source review at PR #891 `59022d` found that `run-probes` still reattaches the
  staff issuer key to every manually selected probe, including non-client probes (expanded F176),
  and that valid selector components can mask empty/unknown components before the scenario runner
  (expanded F179). It also added F183: client Brief purge clears polling/summary state without
  first cancelling the retained intervals/controllers, so late pagehide/BFCache work can mutate
  cache, state or visible output after capability revocation. Source inspection reconfirmed F183
  at then-current candidate `93fc297`. Candidate `13c042b` passed local `npm test` 149/149 and both
  direct and master visible boot lanes 22/22, but exact-head cloud source review (review
  `4741233371`; comments `3619424490`, `3619424493`) expanded F176 to the omitted workflow-direct
  `sxr_client_persist_guard.js` issuer consumer and expanded F179 to the one-selector/two-catalog
  defect.
  A prior cloud source review at `adb1bca`, reconfirmed unchanged at `13c042b`, added F184: the
  unconditional legacy-queue startup plus focus/pageshow/online/visible/timer triggers can read or
  replay residual staff/session Calendar, Samples, Linear and intake debt on any client-link
  document before strict verification settles. Pre-split candidate `c9a79ef` locally closed
  the previously known F176 probe-registry omission and remediates F179/F184; it passed 150/150
  unit suites plus 23/23 actual visible boot groups.
  Its registry contains the exact 39 registered probe consumers (37 manifest, one workflow-direct, one
  temporal); selector validation uses the real flat/tree/visual union; and the F184 lane drives the
  actual retry timeout, held finalizer lock, pagehide/BFCache cancellation and same-slug foreign
  principal exclusion. Exact-head cloud source review of `c9a79ef` (review `4741601566`; comment
  `3619744849`) returned one further P1 occurrence under existing F176, not a new row: when an
  operator supplies `SYNCVIEW_STAFF_KEY`, `qa/overnight_runner.sh` retains it across its direct
  process tree before probe classification. Follow-up local source tracing found the transitive
  `qa/overnight_cron_chunk.sh` pass-through, unrelated helper inheritance and no declared broker
  boundary for the legitimate scenario/master consumers.
  The cloud review returned no separate F179/F184 thread. Those F176/F179/F183/F184 source reviews
  used no browser, backend, credential value, live data or write. On 2026-07-22 the owner split the
  completed F176/F179 overnight-runner containment into parked, unmerged draft #908 for later review.
  It remains recorded and OPEN/parked, did not block #891, and must not be expanded or reopened.
  Final #891 exact-head cloud review completed at `babbb2d` with no new findings, and the owner
  subsequently merged #891; its browser and verifier boundary are live. F185 stays separately
  deferred.
  Every remediation must satisfy F162 with a browser guard that observes the
  actual visible sequence from document start through visible failure, keyboard/touch Retry, and
  recovery. Calendar guards must also hold and release real primary/ancillary/realtime work across
  no-load exit, A → B replacement, pagehide and persisted pageshow. The Brief guard must hold its
  poll and tab-summary responses across actual pagehide/persisted BFCache, release them late, and
  prove zero stale mutation/cache/paint plus exactly one fresh owner. The historical F176/F179
  containment requirements remain in their register rows and dated evidence, with their complete
  work retained only in parked #908. They are not rerun or extended as part of #891. Preserve the
  product branch's F184 matching-A/foreign-B/unknown/staff-only
  synthetic debt, real lifecycle triggers, held-lock, timeout/pagehide cancellation, byte-identity
  and fresh-owner assertions. The verifier is live at v28 and must not be redeployed; the
  owner-selected hard cutover does
  not wait for link confirmations, and old links intentionally use the existing updated-link screen.
  An earlier exact-head cloud review at `f91aba17` (review `4759712636`, comment `3634666109`)
  registered deferred F185: the visible-boot workflow restores cached Chromium binaries without
  reinstalling Linux system dependencies on the cache-hit path. The exact hosted lane still passed
  23/23, so this is a runner-portability risk, not a reproduced product boot failure. By the owner's
  scope-frozen rule it is non-blocking for #891 and belongs in a separate follow-up PR; do not fix it
  here or reopen F176/F179.
  A settled-page assertion or
  source check does not close a boot finding.
- The public-safe staff-facing Round 2 audit at `a479cd0` registers F186–F199. F186 is the only
  BLOCKER: protected weekly-report state is outside the shared identity-loss/BFCache purge owner.
  Production route replacement and async ownership are F187/F188; Workload reload/BFCache
  freshness is F189/F190; weekly filter request ownership is F191; uploader read truth/readiness/
  selection ownership is F192–F194; caption prompt readiness and Submit/intake draft isolation are
  F195/F196; admin More notifications and BFCache freshness are F197/F198; Hook Library receipt
  truth is F199. A controlled fictional browser observation expanded existing F155 for the
  password-to-deep-link wrong-shell handoff; all new numbered rows are source-only and make no
  production-frequency claim. This audit changed documentation only and built no fix or harness.
  The owner questions in `docs/audits/2026-07-22-staff-boot-refresh-history-audit.md` are the
  remediation boundary.
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
