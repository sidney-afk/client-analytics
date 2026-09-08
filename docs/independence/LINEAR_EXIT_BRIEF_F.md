⚠️ ⚠️  READ THIS BEFORE EXECUTING ANYTHING FROM THIS FILE  ⚠️ ⚠️

**333 lines across the six briefs are TRUNCATED MID-SENTENCE, and some of them are
owner-executable migration and rollback steps.** This is a defect in how the briefs
were generated: the scoping workflow that produced them capped each field at a fixed
character budget (clusters at 254, 264, 315, 329, 331 and 705 characters), and the
clipped text was never restored. Codex found it on 2026-09-08; nobody had noticed.

Real examples from this set: a prohibition that ends at `Never apply
2026-09-05-native-only-intake.sql ` without saying what to do instead, and a rollback
that ends at the incomplete identifier `dropping production_`.

**The rule, and it is not optional: if a line stops mid-sentence, DO NOT EXECUTE IT
and do not guess the rest.** Go to the source it names — the migration file, the
workflow, `docs/ops/`, `EXECUTION_LOG.md`, `ROLLBACK.md` — and re-derive the full
instruction there. A truncated `undo:` is the worst case, because it reads like a
complete recovery procedure and is not one.

These briefs remain useful as a map of what each lane covers and where to look. They
are NOT safe as a runbook until the clipped fields are restored.

### RESTORATION PASS, 2026-09-08 (lane LX-RESTORE) — read this before you trust a line below

The **executable** clipped lines in this file have been restored: the
`- [migration]`, `- [edge-function-deploy]`, `- [runtime-flag]`, `- [other]`,
`- [n8n-edit]`, `undo:` and `mitigate:` lines inside LIVE ACTIONS and RISKS.
Nothing else has been. The other clipped fields (`why:`, `confirmed:`,
`where:`, `lift:`, evidence, and the `[A1]`/`[B1]`-style work-item lines) are still
truncated, so the warning above stands and this file is still NOT a runbook.

**How to tell a restored line from an original one.** Every restored line ends
with a bracketed marker naming the date and the primary source it was
re-derived from:

> `**[RESTORED 2026-09-08 · source: …]**`

A line with that marker has been checked against the source it names. A line
without one has not been checked by this pass at all — it is either untouched
original text or one of the ~284 clipped fields still owed.

**Restored does not mean the original text was right.** The generating
workflow's output is gone, so nothing here is a recovery of what was written;
each line was re-derived from the repository. Where a source CONTRADICTED the
surviving fragment, the restored line says so in bold and does not smoothly
continue the false sentence. Where a procedure could not be established from
any primary source, the line says that too, in those words, instead of
supplying a plausible one — an honest gap is safe and a guess is not.

**This file: 11 executable lines restored, 0 left unrestored.** Two carry
corrections: the cutoff migration creates SEVEN functions, not the four the
`undo:` drops, and the "SQL alone leaves the old direct claimant able to take a
fresh lease" risk is pre-correction behaviour that the shipped guard now
refuses. The `count_unproven` / `inconclusive` line, first published here as an
honest gap, is now restored from `scripts/client-continuity-monitor.js` on the
continuity package's branch: both are non-ok codes, and the owner precondition
still stands for the reason the code cannot cover.

**Second correction to this pass, same day.** The first version of this
restoration reported some artifacts as existing on no branch this session could
reach, and left the instructions that depend on them as declared gaps. That was
wrong: the artifacts exist, on branches this session had not enumerated. The
lines are now restored from them and say so. The root cause was searching a few
branches (or a `head`-limited grep) and reporting the result as exhaustive. See
`docs/ops/OPEN_REPAIRS.md` item 179's correction section; the rule it earned is
that in a multi-branch estate, "not where I looked" is not "does not exist".



---

SESSION NAME: LX-F Cutoff and watchers
KEEP THIS EXACT SESSION TITLE. Do not rename it. The owner tracks six parallel sessions by title.

SESSION NAME: LX-F Cutoff and watchers
Keep this exact session title. Do not rename it. The owner tracks parallel sessions by title.

You are ONE of six parallel sessions removing Linear from SyncView before Linear
access ends on 2026-09-15. Today is 2026-09-07. A coordinator session owns merge
order and the ledger; you own exactly one lane and nothing else.

YOUR BRANCH: claude/lx-f-cutoff   (create it from origin/main, push there, never elsewhere)

READ FIRST, IN THIS ORDER:
1. AGENTS.md (house standard, outranks CLAUDE.md)
2. CLAUDE.md
3. docs/independence/LINEAR_EXIT_LANES.md  <-- the lane map. Your lane, your files, your boundaries.
4. The lane brief below.

THE OWNER'S ONE RULE, above everything: do not break the client lifecycle.
Clients approve posts and request changes through anonymous tokenless links.
Those must keep working, unchanged, at every point in your work.

HARD BOUNDARIES
- Touch ONLY the files listed as yours in LINEAR_EXIT_LANES.md. If you need a file
  another lane owns, STOP and write the need into the ledger instead of editing it.
- index.html is one 79k-line file that every lane touches. Stay inside your named
  functions. Never reformat, never reflow, never "clean up while you are here".
- Merging to main deploys the live site instantly. You do not merge. You open a PR
  and stop. The coordinator merges.
- calendar-upsert and sample-review-upsert must stay tokenless. Never deploy the
  repository copies of those writers as-is.
- Never edit an n8n workflow unless your brief explicitly authorizes that specific
  workflow. Export its JSON to the private Drive backup first and commit only a
  public-safe status stub to n8n-backups/.
- The repo is PUBLIC. No secrets, tokens, client display names, share-link tokens,
  or private file URLs in code, comments, commits, tests or CI output. Client slugs
  are fine. Prefer counts over names.
- Mutate only the test client `sidneylaruel` unless the owner names another.
- Additive-only SQL. No DROP, no RENAME, no type changes.

THE LEDGER IS NOT OPTIONAL
docs/ops/OPEN_REPAIRS.md is the ledger. Append, never rewrite. Before you push,
add an entry for anything you learned, deferred, or deliberately did not do,
including work you decided was out of scope. The owner reads this file. A thing
that is not in the ledger did not happen. Check for duplicate `## N.` headers
after any merge; concurrent branches routinely claim the same number, so take the
next free number at the moment you write, and if you collide, renumber yours.

PROOF BAR
- `npm test` is the full offline suite and takes several minutes. Run it before you push.
- `npm run test:prod-polish` CANNOT pass in this sandbox (no route to the live
  backend); all 8 lanes fail identically on origin/main. Verify against main before
  calling anything a regression.
- Add a test for every behavior you change. A change with no test does not land.
- Do not claim a live system state you did not read. If you could not verify it,
  say so in the PR body.

WHEN YOU FINISH, OR WHEN YOU ARE BLOCKED
Push, open a DRAFT PR titled `LX-F: <what it does>`, and in the body state:
  - what is done and proven, with the test names
  - what is NOT done
  - every live action the owner must take (migration, deploy, flag, n8n edit),
    each with its exact undo
  - anything you found that belongs to another lane
Then stop. Do not merge. Do not start another lane's work.


=== YOUR LANE: F ===
BRANCH: claude/lx-f-cutoff
MERGE POSITION: 1st for your monitoring split (F4+F6 only), then LAST for everything else. F turns things off and every flag flip presumes A/B/C/D are live and observed.

GOAL
Linear is switched off in a proven, reversible order with the mirror queue's pending debt classified rather than faked, everything that still reaches api.linear.app is stopped or retired, and a small set of loud, self-checking watchers proves afterwards that boards still fill, writes still land, comments still appear and alarms still ring — with the monitoring estate repaired first, because half of it dies with Linear.

DONE WHEN
  - A written cutoff runbook exists at docs/ops/LINEAR_CUTOFF_RUNBOOK.md with, per step, the exact SQL/UI action, the exact prior value to capture, what stops, and the restore statement — modelled on the fenced `do $$ ... get diagnostics n = row_count; if n <> 1 then raise exception` pattern already used at docs/ops/FLIP_RUNBOOK.md:893-916.
  - `select status, count(*) from public.mirror_outbox where legacy_parity=false and test_only=false group by 1` shows zero rows in ('pending','failed','shadow_ok') for real clients BEFORE `linear_outbound_enabled` is set off, or every remaining row is individually classified in the runbook with a named disposition.
  - After the flags are off, a scheduled drain summary event still writes every 10 min and reports `mode:"off"`, `alerts.oldest_pending_age:false` — i.e. the pending-age alarm (supabase/functions/linear-outbound/monitoring.mjs:17-24, threshold 30 min, fires only for syncview-authoritative teams — both are) is not left permanently stuck on.
  - scripts/monitoring-watchdog.js LANES (lines 56-110) no longer lists a lane whose workflow was disabled by the cutoff, and lists every new watcher lane. `node scripts/monitoring-watchdog.js --check` run against live heartbeats returns zero stale and zero failing lanes on the day after cutoff.
  - Zero GitHub workflow on a schedule still requires `LINEAR_API_KEY` / `LINEAR_MIRROR_API_KEY`. Verified by `grep -rn 'LINEAR_.*_KEY\|LINEAR_API_KEY' .github/workflows/ | grep -v workflow_dispatch` returning nothing on a scheduled lane.
  - A 'Linear is dead' rehearsal has been run end-to-end against the live backend with every api.linear.app route and all 10 n8n linear-* webhooks answering connection-refused/500, and its report records: Production list renders, a status write commits, a comment posts and is read back, the Workload board renders, and the client-facing Calendar/Samples anonymous links render their cards. Zero silent empties.
  - Each watcher below has fired at least once ON PURPOSE (injected fault) and the owner confirms he received the page in the SyncViewbot DM — acceptance-only (relay HTTP 200) is explicitly not accepted as proof, per docs/ops/MONITORING.md F09/F66/F81.
  - docs/ops/MONITORING.md's coverage table and ROLLBACK.md's Live State rows for `App -> Linear pushes`, `B4 Linear outbound`, `Linear inbound engine`, `Status drift healing` and `Linear -> dormant B1 history refresh` are updated to the post-cutoff truth with a fresh Last-verified date.

ALREADY BUILT — LIFT THESE, DO NOT REBUILD
  * A complete, reviewed, INACTIVE-by-default server-side outbound cutoff: singleton control table `public.linear_outbound_cutoff_control`, `mirror_outbox.outbound_generation` / `cutoff_disposition` / `dispatch_authorized_at` / `dispatch_authorization` columns, enqueue generation-stamping trigger, `linear_outbound_claim_v1` / `linear_outbound_authorize_dispatch_v1` / `linear_outbound_cutoff_activate_v1` RPCs, a stale-worker UPDATE guard, and a service-only debt census view `linear_outbound_cutoff_debt_v1`. Activation never deletes, terminalizes or invents success for a queued row.
    where: branch 5bcc03bd (draft PR 1326), migrations/2026-09-06-linear-outbound-cutoff.sql (single file, whole migration)
    confirmed: git show 5bcc03bd7d286f437ad51d4cc86a5ce80b7b63ea:migrations/2026-09-06-linear-outbound-cutoff.sql — read in full. `cutoff_enabled boolean not null default false`; activate RPC body contains only `update public.linear_outbound_cutoff_control ...` and a `jsonb_build_object` return, no mirror_outbox w
    lift: Cherry-pick the migration file verbatim. It is standalone SQL with no imports. DO NOT install it without the paired worker (below) — the doc states plainly that deploying only the Edge Function fails closed at claim, and installing only the SQL leaves the old direct-table claimant unfenced on its first post-cutoff lease.
  * The matching `linear-outbound` worker: claim goes through the RPC instead of a direct table UPDATE, and EVERY provider request — reads and pagination included, not just mutations — calls `authorizeProviderDispatch` immediately before `fetch(LINEAR_URL)`. The unconditional pre-loop `readViewer()` (which called Linear even when there was nothing to send) is moved inside the per-row loop behind a claim.
    where: branch 5bcc03bd, supabase/functions/linear-outbound/index.ts (+92/-33 vs origin/main)
    confirmed: git diff origin/main...5bcc03bd -- supabase/functions/linear-outbound/index.ts — read in full. `linearGraphql` now takes a `ProviderDispatch` and awaits `authorizeProviderDispatch` before `await fetch(LINEAR_URL,...)`; the old `mirrorActor = await readViewer()` at handler top is deleted and re-added
    lift: Take the whole file from the candidate. It ships in the four-function `deploy-f27-section4-closures.yml` lane, so it costs one sealed capture-bundle deploy (see live_actions_needed). Its offline proof `test/linear-outbound-cutoff.js` + `test/linear-outbound-read-cutoff.js` come with it and run with no database.
  * A ready-to-run disposable-Postgres rehearsal for the cutoff, including concurrent-session lock-order proofs and a pinned-base negative control (it proves the OLD worker could apply a delayed terminal receipt after the mode went off — i.e. it proves the bug the cutoff closes).
    where: branch 5bcc03bd: scripts/linear-outbound-cutoff-rehearsal.js (entry), scripts/linear-outbound-cutoff-lane.mjs (132 lines), scripts/linear-outbound-read-lane.mjs (95 lines), scripts/linear-outbound-read-seam.mjs (65 lines)
    confirmed: git show 5bcc03bd:scripts/linear-outbound-cutoff-rehearsal.js — refuses to run unless G8_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY, G8_TEST_PSQL absolute, G8_TEST_PORT numeric; otherwise prints `SKIP G8` and exits 0. The lane file contains a real check named 'unchanged base worker applies a delayed termina
    lift: Lift as-is; it needs a local psql, never touches the network (linear-outbound-read-lane.mjs supplies its own synthetic `provider` fetch and asserts `unexpected transport refused` on any non-Linear URL).
  * `workload-linear` extended to observe the SAME cutoff control before every provider request, returning 410 `workload_linear_retired` when cutoff is active and 503 `linear_cutoff_control_unavailable` when the control is missing/malformed. One flag therefore kills two provider surfaces.
    where: branch 5bcc03bd, supabase/functions/workload-linear/index.ts (+71/-... vs main); new `requireProviderAdmission(db)` called from `linearRequest`
    confirmed: git diff origin/main...5bcc03bd -- supabase/functions/workload-linear/index.ts — `requireProviderAdmission` reads linear_outbound_cutoff_control and throws WorkloadLinearError(410,'workload_linear_retired'); `linearRequest` awaits it before `fetch`.
    lift: Low priority for the exit. docs/ops/EF_DEPLOY_MANIFEST.md:57 records `workload-linear` as NO CI DEPLOY PATH / deliberate-manual, and OPEN_REPAIRS 79 says both its ends are already dead (browser never routes there while both teams are syncview; the writer 409s on authority). Lift only if the owner wants belt-and-braces; do not spend a deliberate-manual operator release on it.
  * A finished, unit-tested client-facing continuity monitor: `assessRead()` classifies a rendered client surface into `false_empty` / `stale_unwarned` / `stale_overdue` / `count_unproven` / `healthy` by correlating the rendered card count against an INDEPENDENT paged REST census of the same client scope, and `assessLiveness()` catches a lane that started and never produced a terminal receipt, an undelivered alert, and an unacknowledged incident. Plus `routeAlert()` with primary relay + separately-hosted fallback where a relay 2xx with no correlated terminal delivery counts as FAILURE.
    where: branch 5bcc03bd: scripts/client-continuity-monitor.js (119 lines), scripts/client-continuity-view.js (227), scripts/client-continuity-observer.js (94), scripts/client-continuity-delivery.js (66), scripts/client-continuity-hosted.js (128), tests test/client-continuity-{monitor,view,independent,operations,local-objects,heartbeat}.js, workflows .github/workflows/client-continuity-hosted-{view,observer,delivery-drill}.yml
    confirmed: git show 5bcc03bd:scripts/client-continuity-monitor.js — read in full: the enum list, `assessRead` decision ladder, `assessLiveness` cadence/terminal logic, `routeAlert` requiring `primary.hostname !== fallback.hostname` and treating an unconfirmed relay as undelivered. Workflows read in full: all t
    lift: This is the highest-value lift in the lane and it is DORMANT, not broken. Lift the scripts + tests + the three workflows unchanged. Cost to activate is entirely configuration, not code: ~12 repo secrets (CONTINUITY_* per docs/ops/CLIENT_CONTINUITY_PREPARATION.md private-inputs table), plus a read credential with complete unfiltered visibility of the designated client scope — the doc is explicit th
  * A whole dead-man's-switch estate that already solves 'silence is not green': per-lane heartbeats, `max_age_minutes`, 'never checked in counts as stale', separate (kind,lane) latches for stopped-running vs ran-and-failed, and two independent hosts so a dead workflow is still audible.
    where: origin/main: scripts/monitoring-watchdog.js (LANES at lines 56-110), scripts/monitoring-alert-relay.js (assertPublicSafe + confirmRelayDelivery), .github/workflows/monitoring-deadman.yml (*/15), plus the duplicate `--check` inside linear-deliverables-reconcile.yml:124-125
    confirmed: Read scripts/monitoring-watchdog.js lines 1-115 and .github/workflows/monitoring-deadman.yml in full. LANES currently holds 8 keys: reconciler_pager, monitoring_watchdog, production_write_drill, b1_incremental_refresh, production_shadow_audit, samples_e2e_nightly, calendar_e2e_nightly, assurance_led
    lift: Nothing to lift — it is on main. Lane F's job is to EDIT it (see work item F6): four of those eight lanes die with Linear, and the second `--check` host is inside a workflow the cutoff disables.
  * Three read-only, publishable-key-only, zero-Linear post-flip monitors that already exist and are scheduled by nothing (OPEN_REPAIRS 80 point 3 asks for exactly this).
    where: origin/main: scripts/workload-native-visibility-check.js (336 lines, gates: exit 1 above --baseline, default 13), scripts/foreign-write-strand-check.js (217), scripts/attribution-stuck-check.js (281), scripts/f40-workload-readiness.js (365)
    confirmed: grep of `process.env.*` in each: all four use only SUPABASE_URL + SUPABASE_ANON_KEY/PUBLISHABLE_KEY; `grep -c api.linear.app` returns 0 for all four. workload-native-visibility-check.js:287 `const failed = real.length > BASELINE` and its header line 99 states 'Exits 1 above the baseline so it can ga
    lift: Schedule workload-native-visibility-check (it already gates). foreign-write-strand-check and attribution-stuck-check become MOOT after cutoff (no Linear = no foreign writes, no Linear structure moves) — do not schedule them; retire them in the same PR. WARNING before scheduling any of them in this PUBLIC repo: foreign-write-strand-check's tail prints client slug AND `assigned to <person name>` per
  * A real-headless-browser QA harness that already intercepts Linear webhooks so a probe can never mutate a real editor's issue.
    where: origin/main: qa/sxr_courier_lib.js:76 `LINEAR_HOOK` regex + the route handler at :452-470; driven by qa/master.js, qa/run-probes.js, qa/scenario_engine.js (`expectLinear`/`expectNoLinear` verbs at :1006-1026)
    confirmed: Read qa/sxr_courier_lib.js:60-120 and :440-470. The handler records the payload to LINEAR_CALLS_FILE and returns `route.fulfill({status:200, ... body: {ok:true}})`.
    lift: This is the rehearsal harness — but it is the WRONG POLARITY and covers 4 of 10 webhooks. It mocks Linear HEALTHY (always 200/{ok:true}); it has no failure-injection mode. See work item F8: add a refusing mode and widen the regex. This is the single most important correction to the assumption that 'Linear-mocked overnight testing' already proves the app survives Linear's death.

WORK ITEMS
  [F0] (low risk, new) Write the cutoff runbook: exact order, exact SQL, exact rollback, with the pending-debt semantics stated
     New doc docs/ops/LINEAR_CUTOFF_RUNBOOK.md. Every flag step uses the house fenced-idempotent pattern from FLIP_RUNBOOK.md:893-916 — a `do $$ ... where key=... and value = <exact expected prior jsonb>; get diagnostics n=row_count; if n<>1 then raise exception '<name> refused: expected <exact prior>'; end if; end $$;` so a wrong current value stops the operator instead of silently widening.

THE ORDER (each step's rollback is the captured prior value; the order is chosen so the cheapest-to-reverse steps come first and the irreversible one comes last):

STEP 0 (no flag) — DRAIN TO ZERO. With outbound still `live`, dispatch https://github.com/sidney-afk/client-analytics/actions/workflows/linear-outbound-drain.yml repeatedly until the summary reports `oldest_
     files: docs/ops/LINEAR_CUTOFF_RUNBOOK.md
  [F1] (high risk, mixed) Lift the cutoff migration and reconcile it with the F27 recovery contract before installing
     Cherry-pick migrations/2026-09-06-linear-outbound-cutoff.sql verbatim from 5bcc03bd. It is additive and inactive-by-default.

The blocker is stated by the candidate's own doc and must not be waved past: docs/ops/LINEAR_OUTBOUND_CUTOFF.md says 'The new control owner is outside selected37 recovery and must be included in an explicit compatible recovery extension before installation', and 'the existing F27 install/recovery contract [must be] reconciled with the added table, columns, triggers, and changed function dependency'. So the work is: extend scripts/f27-database-rollback-recipe.js / f27-database-rollback-execute.js (and docs/ops/F27_INSTALL_CHECKLIST.md) to own `linear_outbound_cutoff_co
     files: migrations/2026-09-06-linear-outbound-cutoff.sql, scripts/f27-database-rollback-recipe.js, scripts/f27-database-rollback-execute.js, docs/ops/F27_INSTALL_CHECKLIST.md, test/linear-outbound-cutoff.js
  [F2] (high risk, lift) Lift the cutoff-aware linear-outbound worker (only if F1 installs)
     Take supabase/functions/linear-outbound/index.ts wholesale from 5bcc03bd plus test/linear-outbound-cutoff.js and test/linear-outbound-read-cutoff.js. Two independently valuable changes even before any cutoff is activated: (a) every provider READ is now authorized at the single transport boundary, closing the read-path gap the audit names; (b) the unconditional `readViewer()` that ran once per drain regardless of whether there was anything to send is gone — an empty queue no longer touches Linear at all.

Deploy path: https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml , which is the four-function lane (`linear-outbound`, `production-write`, `deliverable-write`, `batch-write`) and therefore requires the sealed
     files: supabase/functions/linear-outbound/index.ts, test/linear-outbound-cutoff.js, test/linear-outbound-read-cutoff.js, scripts/linear-outbound-cutoff-rehearsal.js, scripts/linear-outbound-cutoff-lane.mjs, scripts/linear-outbound-read-lane.mjs, scripts/linear-outbound-read-seam.mjs
  [F3] (medium risk, new) Inventory and close every remaining path to api.linear.app
     Grounded inventory as of origin/main.

A. EDGE FUNCTIONS (3 files, 4 call sites):
  - supabase/functions/linear-outbound/index.ts:62 — stopped by the flag (STEP 2), fenced by F1/F2.
  - supabase/functions/workload-linear/index.ts:66 — already dead on both ends per OPEN_REPAIRS 79 (browser never routes there while both teams are syncview; the write path 409s on `requireLinearAuthority`). EF_DEPLOY_MANIFEST.md:57 says it has NO CI deploy path. Stop = retire the function (`delete`/`404` readback is already the documented containment in ROLLBACK.md:316).
  - supabase/functions/production-write/index.ts:837 (`linearLabelsRequest` -> `label_catalog_unavailable` 503) and :2291 (`linearRead` -> `pro
     files: docs/ops/LINEAR_CUTOFF_RUNBOOK.md, docs/ops/MONITORING.md
  [F4] (high risk, new) Stop the schedulers, in the order that keeps the dead-man's switch honest
     Disable, in this order: (1) the n8n pager nodes that dispatch the card reconcilers and gate B1; (2) sample-linear-reconcile.yml, linear-deliverables-reconcile.yml, b1-linear-incremental-refresh.yml, production-shadow-audit.yml crons; (3) the 'SyncView Workload — Reconcile' n8n workflow — but ONLY after the Workload board no longer depends on `workload_issues` freshness.

CRITICAL COUPLING: linear-deliverables-reconcile.yml lines 120-126 carry BOTH the `reconciler_pager` heartbeat AND the second, independent host of `monitoring-watchdog.js --check`. monitoring-deadman.yml's header states outright that the two hosts watch each other and 'a checker cannot report its own death'. Disabling the re
     files: .github/workflows/sample-linear-reconcile.yml, .github/workflows/linear-deliverables-reconcile.yml, .github/workflows/b1-linear-incremental-refresh.yml, .github/workflows/production-shadow-audit.yml, .github/workflows/linear-sync-reconcile.yml, .github/workflows/assurance-ledger-freshness.yml
  [F5] (medium risk, new) WATCHER 1 — outbox debt census: the queue must be empty and STAY empty, and an unreadable census must scream
     WHAT IT CHECKS: counts by status in `public.mirror_outbox` for real clients (`test_only=false and legacy_parity=false`), plus `max(now()-created_at)` among ('pending','failed','shadow_ok'). If F1 installed, read `public.linear_outbound_cutoff_debt_v1` instead and report the five dispositions (`terminal_receipt`, `unclaimed_before_cutoff`, `claimed_before_cutoff`, `authorized_before_cutoff`, `accepted_after_cutoff`) as counts.
WHY: after STEP 2 anything still enqueuing a mirror intent (production_comment_write durably enqueues comments into this same lane) produces a row that will never be delivered and never fail. Silent, permanent, invisible debt.
HOW OFTEN: every 30 min, its own workflow.

     files: scripts/outbox-debt-census.js, .github/workflows/outbox-debt-census.yml, scripts/monitoring-watchdog.js, test/outbox-debt-census.js
  [F6] (high risk, new) WATCHER 2 — repair the dead-man's switch itself: four of its eight lanes die with Linear
     THE FINDING: scripts/monitoring-watchdog.js LANES (lines 56-110) registers 8 lanes. FOUR of them hard-require a Linear credential and will fail at their 'require secrets' step the instant the key is revoked or the workflow is disabled:
  - production_write_drill  <- production-write-drill.yml:73 requires LINEAR_API_KEY
  - production_shadow_audit <- production-shadow-audit.yml:37 requires LINEAR_API_KEY
  - b1_incremental_refresh  <- b1-linear-incremental-refresh.yml:61 requires LINEAR_API_KEY
  - reconciler_pager        <- linear-deliverables-reconcile.yml, whose script fetches api.linear.app:133
Each of those workflows records its heartbeat under `if: always()` (verified at production-writ
     files: scripts/monitoring-watchdog.js, test/monitoring-watchdog.js, .github/workflows/monitoring-deadman.yml, .github/workflows/assurance-ledger-freshness.yml, docs/ops/MONITORING.md
  [F7] (medium risk, mixed) WATCHER 3 — native write drill: prove a write, a status change and a COMMENT actually land, with no Linear anywhere
     WHAT IT CHECKS, daily on the TEST client `sidneylaruel` only: create a deliverable -> change its status -> post a production comment -> read every one of them back from the canonical store -> clean up. Assert `zero requests to api.linear.app` (install a fetch guard that throws on that host) and `zero rows added to mirror_outbox` for the drill's client.
WHY: this is the 'write that silently no-ops' and 'comment that never appears' detector, and it is exactly what today's `production-write-drill.js` does EXCEPT that it also asserts Linear reflection (scripts/production-write-drill.js:176) and its workflow refuses to run without LINEAR_API_KEY. Left alone it becomes a permanently red daily lane
     files: scripts/native-write-drill.js, .github/workflows/native-write-drill.yml, scripts/monitoring-watchdog.js, test/native-write-drill.js
  [F8] (medium risk, mixed) WATCHER 4 — the empty/stale board detector, and the Workload freeze nobody would see
     TWO CHECKS, one workflow, every 30 min:
(a) WORKLOAD SOURCE FRESHNESS. `select max(synced_at) from public.workload_issues where active=true`. After the n8n Workload reconcile stops, this value freezes and ~2000 rows stay `active=true` — the board looks perfectly normal and is silently a snapshot of Sept 15 forever. The browser will NOT catch it: `_wlV2CheckWatermark` (index.html:14484-14501) only reacts when the watermark moves FORWARD; on `if (!latest) { wlClearBackgroundRefreshFailure(); return; }` and on an unchanged value it does nothing. Freeze is indistinguishable from health, client-side. So this watcher must alert on a `synced_at` older than N hours UNTIL the Workload board's source 
     files: scripts/workload-source-freshness.js, .github/workflows/workload-source-freshness.yml, scripts/monitoring-watchdog.js, docs/ops/OPEN_REPAIRS.md
  [F9] (medium risk, lift) WATCHER 5 — activate the client-continuity view lane: the only watcher that looks at what a CLIENT sees
     LIFT the dormant package (scripts/client-continuity-{view,monitor,observer,hosted,delivery,independent,heartbeat}.js, qa/client-continuity*.js, test/client-continuity-*.js) and the three gated workflows.
WHAT IT CHECKS: opens the real anonymous Calendar and Samples client links in a fresh Chromium with a refusing loopback proxy, counts the cards actually rendered, and compares them against an INDEPENDENT paged REST census of the same canonical client scope taken before and after navigation, with sorted row-content digests — not counts alone. `assessRead` (scripts/client-continuity-monitor.js:22-38) then returns `false_empty` when the load did not succeed but the UI shows empty, `stale_unwarn
     files: scripts/client-continuity-view.js, scripts/client-continuity-monitor.js, scripts/client-continuity-observer.js, scripts/client-continuity-hosted.js, scripts/client-continuity-delivery.js, scripts/client-continuity-independent.js, scripts/client-continuity-heartbeat.js, scripts/client-continuity-run.js
  [F10] (low risk, mixed) WATCHER 6 — prove the alarm itself still rings, on a schedule
     WHAT IT CHECKS: monthly (and once immediately after cutoff), send one labelled synthetic page end-to-end and require a CORRELATED terminal delivery receipt, not an HTTP 200. Two existing pieces do this and neither is scheduled: `.github/workflows/monitoring-cutover-proof.yml` lane `alert-path` (dispatch-only after merge) and `.github/workflows/client-continuity-hosted-delivery-drill.yml` (workflow_dispatch only, gated on CLIENT_CONTINUITY_DRILL_ENABLED).
WHY: docs/ops/MONITORING.md records the exact failure this closes — both nightlies were red for WEEKS (samples 26 consecutive nights, calendar 16) 'because their only alarm was a Slack webhook step that degrades to a log warning when its sec
     files: .github/workflows/monitoring-alarm-proof.yml, docs/ops/MONITORING.md
  [F11] (medium risk, mixed) THE REHEARSAL — invert the existing QA harness so Linear is DEAD, not mocked-healthy, and run the whole app against it
     CORRECTION TO THE PREMISE FIRST. The 'Linear-mocked overnight testing' the docs mention is real (qa/master.js, qa/run-probes.js, qa/overnight_runner.sh, qa/scenario_engine.js `expectLinear`/`expectNoLinear`, qa/OVERNIGHT_TEST_REPORT.md), but its mock is the WRONG POLARITY and INCOMPLETE, so it cannot be pointed at this question as it stands:
  - qa/sxr_courier_lib.js:452-470 always fulfils 200 with `{ok:true}` (or a configurable `_subissuesResp()`), i.e. it simulates Linear WORKING. There is no failure-injection env var anywhere in that file.
  - LINEAR_HOOK at qa/sxr_courier_lib.js:76 matches only 4 of the 10 webhooks: linear-set-status, linear-add-comment, linear-subissues, linear-issue-st
     files: qa/sxr_courier_lib.js, qa/master.js, qa/run-probes.js, docs/audits/2026-09-XX-linear-dead-rehearsal.md
  [F12] (low risk, new) Update the operative docs so the post-cutoff estate describes one epoch
     ROLLBACK.md Live State rows to rewrite with a fresh Last-verified date: 'App -> Linear pushes (set-status/comment/intake)' (currently dated 2026-07-14 and still says 'current Linear/Linear authority' — already false, both teams are syncview), 'B4 Linear outbound', 'Linear inbound engine', 'Status drift healing', 'Linear -> dormant B1 history refresh', 'Legacy Linear -> Calendar/Samples/Workload fast sync'.
docs/ops/MONITORING.md: replace the five Linear rows in the coverage table; add rows for every new watcher lane with its cadence, alert path and containment; keep the 'Known monitoring and evidence gaps' section honest about what the cutoff does NOT close (see risks).
docs/ops/OPEN_REPAIRS
     files: ROLLBACK.md, docs/ops/MONITORING.md, docs/ops/OPEN_REPAIRS.md, docs/testing/ASSURANCE_LEDGER.md, EXECUTION_LOG.md

FILES YOU OWN (touch nothing else)
  docs/ops/LINEAR_CUTOFF_RUNBOOK.md
  docs/ops/MONITORING.md
  scripts/monitoring-watchdog.js
  test/monitoring-watchdog.js
  .github/workflows/monitoring-deadman.yml
  .github/workflows/assurance-ledger-freshness.yml
  .github/workflows/linear-deliverables-reconcile.yml
  .github/workflows/sample-linear-reconcile.yml
  .github/workflows/linear-sync-reconcile.yml
  .github/workflows/b1-linear-incremental-refresh.yml
  .github/workflows/production-shadow-audit.yml
  .github/workflows/production-write-drill.yml
  .github/workflows/linear-outbound-drain.yml
  .github/workflows/monitoring-alarm-proof.yml
  .github/workflows/outbox-debt-census.yml
  .github/workflows/workload-source-freshness.yml
  .github/workflows/native-write-drill.yml
  .github/workflows/client-continuity-hosted-view.yml
  .github/workflows/client-continuity-hosted-observer.yml
  .github/workflows/client-continuity-hosted-delivery-drill.yml
  scripts/outbox-debt-census.js
  scripts/workload-source-freshness.js
  scripts/native-write-drill.js
  scripts/client-continuity-view.js
  scripts/client-continuity-monitor.js
  scripts/client-continuity-observer.js
  scripts/client-continuity-hosted.js
  scripts/client-continuity-delivery.js
  scripts/client-continuity-independent.js
  scripts/client-continuity-heartbeat.js
  scripts/client-continuity-run.js
  scripts/client-continuity-actions.js
  scripts/client-continuity-transport.js
  scripts/client-continuity-test-ui.js
  scripts/linear-outbound-cutoff-rehearsal.js
  scripts/linear-outbound-cutoff-lane.mjs
  scripts/linear-outbound-read-lane.mjs
  scripts/linear-outbound-read-seam.mjs
  migrations/2026-09-06-linear-outbound-cutoff.sql
  supabase/functions/linear-outbound/index.ts
  test/linear-outbound-cutoff.js
  test/linear-outbound-read-cutoff.js
  test/outbox-debt-census.js
  test/native-write-drill.js
  test/client-continuity-monitor.js
  test/client-continuity-view.js
  test/client-continuity-independent.js
  test/client-continuity-operations.js
  test/client-continuity-heartbeat.js
  test/client-continuity-local-objects.js
  test/helpers/client-continuity-source.js
  qa/client-continuity.js
  qa/client-continuity-fixtures.js
  qa/client-continuity-transport.js
  qa/client-continuity-test-ui.js
  qa/sxr_courier_lib.js
  docs/ops/CLIENT_CONTINUITY_OPERATIONS.md
  docs/ops/CLIENT_CONTINUITY_PREPARATION.md
  docs/ops/client-continuity.config.example.json
  docs/ops/client-continuity-operations.example.json
  docs/audits/2026-09-XX-linear-dead-rehearsal.md

LIVE ACTIONS THE OWNER MUST TAKE (prepare them exactly; never execute them)
  - [other] Service-role read of public.mirror_outbox before anything else: `select status, legacy_parity, test_only, count(*) from public.mirror_outbox group by 1,2,3` plus the oldest created_at among ('pending','failed','shadow_ok') for real clients. OPEN_REPAIRS 75 names this as the single highest-value unresolved read from the 2026-08-30 backend audit — the browser's publishable key cannot read `mirror_outbox` at all, so nobody has ever looked. What it answers: whether any of the constantly-reported `backlog: 14` rows carry `legacy_parity = true`. Post-flip the drain's parity gate can never be true (`linear-outbound/index.ts:1377-1379` requires `authority === "linear"`), so such a row is counted `paused`, unlocked after 30 minutes and retried forever — it never reaches `failed`, `alerts.failed_write` stays false, and nothing pages. Item 75's own SQL is the fuller form and worth running in the same session: `select id, kind, legacy_parity, test_only, attempts, created_at from public.mirror_outbox where status <> 'written' order by created_at asc;` The answer decides STEP 0: the queue must drain to zero before the flags move, and a parity row that cannot drain has to be quarantined rather than waited on. **[RESTORED 2026-09-08 · source: docs/ops/OPEN_REPAIRS.md item 75 (lines 5581-5610)]**
    undo: Read-only; nothing to reverse.
  - [runtime-flag] Set `linear_legacy_parity_enabled` = {"enabled":false} via the fenced exact-prior-value UPDATE.
    undo: Restore the captured prior value {"enabled":true} with the same fenced pattern and read it back. ROLLBACK.md is explicit that any F2/F4 runtime-flag write requires capturing the exact current value first and defining rollback as restoring it.
  - [runtime-flag] Set `linear_outbound_enabled` = {"mode":"off"}.
    undo: Restore {"mode":"live"}; the queue resumes from where it paused because nothing was terminalized. Fully reversible until credentials are revoked.
  - [runtime-flag] Set `linear_inbound_enabled` = {"enabled":false}.
    undo: Restore {"enabled":true}. Deliveries during the off window are acknowledged but not applied and are NOT replayed, so the reversal restores the lane, not the missed events.
  - [other] Delete the two EF-bound Linear webhooks in Linear's own settings (the hard stop for inbound delivery).
    undo: Re-create them — only if the URL and LINEAR_INBOUND_SIGNING_SECRET are captured first. Capture both before deleting or this is one-way.
  - [migration] Install migrations/2026-09-06-linear-outbound-cutoff.sql via scripts/f27-apply-migration.js, ONLY as one release window with the matching linear-outbound source.
    undo: Additive: drop the three triggers, the four RPCs, the view and the control table; the four mirror_outbox columns can stay dormant. **COUNT CORRECTION FROM THE FILE: it creates SEVEN functions, not four.** The four service-only RPCs are `linear_outbound_claim_v1(bigint,text,integer)`, `linear_outbound_authorize_dispatch_v1(bigint,uuid,bigint)`, `linear_outbound_cutoff_activate_v1(bigint,text)` and `linear_outbound_cutoff_debt_rows_v1()`; the three TRIGGER functions `linear_outbound_stamp_generation_v1()`, `linear_outbound_control_lock_v1()` and `linear_outbound_stale_worker_guard_v1()` share their names with the triggers and must be dropped after them or they are left behind. Full order: drop view `linear_outbound_cutoff_debt_v1`, then `linear_outbound_cutoff_debt_rows_v1()`; drop triggers `zzzz_linear_outbound_stamp_generation_v1`, `linear_outbound_control_lock_v1`, `linear_outbound_stale_worker_guard_v1` on `public.mirror_outbox` and then their three functions; drop the three remaining RPCs; drop constraint `mirror_outbox_cutoff_disposition_check` (added by this file, and unmentioned in the original line) if the columns are dropped rather than left dormant; drop table `linear_outbound_cutoff_control`. The F27 recovery contract must own all of them BEFORE install (F1), or the documented one-step database rollback no longer covers the schema and nobody finds out until they need it — the cutoff doc states plainly that "the new control owner is outside selected37 recovery and must be included in an explicit compatible recovery extension before installation". If that extension cannot be reviewed in time, do not install: the runtime flag alone already stops the mirror and is fully reversible. **[RESTORED 2026-09-08 · sources: migrations/2026-09-06-linear-outbound-cutoff.sql lines 13-41, 43-75, 80-160, 165-223 @fix/cloud-outbound-cutoff-20260906; docs/ops/LINEAR_OUTBOUND_CUTOFF.md §"Installation, rehearsal, and recovery dependencies"]**
  - [edge-function-deploy] Deploy the cutoff-aware linear-outbound through https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml. Requires the sealed four-function rollback bundle: run `& "$env:USERPROFILE\.syncview\f27-capture.ps1"` from ANY directory, drag the printed .sourcebundle into the `SyncView Backups/` Shared Drive root, THEN dispatch with `commit_sha` = main's tip at that moment, `operation` = `deploy-reviewed-release`, `confirm` = `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`, and `rollback_bundle_sha256` / `rollback_bundle_byte_length` copied from the capture's own JSON (`sealed_bundle_sha256`, `sealed_bundle_byte_length`) with no re-derivation. The script prints the bundle's full path on its LAST line — read that rather than assuming a folder. Order is load-bearing and enforced: the lane FETCHES the bundle out of Drive by content-addressed name during the run, so dispatching before the upload fails in about 20 seconds with `{"status":"FAIL","code":"OBJECT_MISSING"}`, deploys nothing, and is recovered by uploading and pressing `Re-run jobs` on the SAME run (which keeps all five inputs) — never by re-capturing. Capture minutes before dispatching, not hours: a bundle that sealed an older live set restores the wrong code. And nothing may be merged to main between handing over the SHA and the run going green, because the lane requires `commit_sha` to equal main's tip at dispatch time. This deploy must land in the SAME release window as the cutoff migration — see the risk below. **[RESTORED 2026-09-08 · sources: CLAUDE.md (capture order, OBJECT_MISSING recovery, merge freeze); AGENTS.md:100-127; .github/workflows/deploy-f27-section4-closures.yml lines 9-33 and 318-345]**
    undo: The sealed bundle IS the rollback: restore the captured prior four-function source. Both lanes refuse on a fingerprint mismatch, so a wrong digest cannot deploy the wrong code — it can only decline.
  - [runtime-flag] Activate the server fence: `select public.linear_outbound_cutoff_activate_v1(<exact current generation>, '<operator>')` as service_role.
    undo: NOT REVERSIBLE by design — there is deliberately no re-enable RPC, public or automatic. Recovery requires a reviewed migration delta issued only after every `authorized_before_cutoff` row is reconciled against provider truth and every `accepted_after_cutoff` receipt is classified WITHOUT being deleted or rewritten as success — and that delta may advance from an exact generation only once that debt manifest and a compatible accepted-work rollback both exist. In other words the undo is a reviewed change plus a reconciliation against a provider that, after 2026-09-15, is gone. Treat this as one-way and plan the precondition instead of the recovery: `linear_outbound_cutoff_activate_v1` refuses unless the control row's generation exactly matches the one you pass and the cutoff is not already enabled (`linear_cutoff_generation_conflict`), it takes the high-water `max(id)` at that moment, and it deliberately does not delete, terminalize, unlock or rewrite a single queue row. The dispositions it makes derivable are `accepted_after_cutoff`, `claimed_before_cutoff`, `authorized_before_cutoff` and `unclaimed_before_cutoff`, read through `public.linear_outbound_cutoff_debt_v1` (service_role only). Run that census first; if it shows any non-terminal real-team row, do not activate. **[RESTORED 2026-09-08 · sources: docs/ops/LINEAR_OUTBOUND_CUTOFF.md §"Installation, rehearsal, and recovery dependencies"; migrations/2026-09-06-linear-outbound-cutoff.sql lines 34-41, 165-223]**
  - [n8n-edit] Disable the n8n pager nodes that dispatch the two card reconcilers (every 15 min) and gate B1 refresh (every 30 min) on workflow qllIDZPkdNAPRj0b; later deactivate the 'SyncView Workload — Reconcile' workflow (schedule: every 10 min).
    undo: Re-enable the nodes / re-activate the workflow. Capture the exact active version id first. CLAUDE.md forbids editing an n8n workflow without the owner's explicit go-ahead in the same request; the brief says n8n edits are authorized where safe, so re-enabling is an n8n edit under exactly the same rule and needs its own go-ahead in the request that asks for it — a prior authorization to DISABLE is not an authorization to re-enable later. Two mechanical preconditions for the undo to actually work: capture each workflow's `activeVersionId` in the same session as the edit and write it into an `n8n-backups/` status stub (never take a version id out of git — the brief's own risk list records those as already stale), and unpublish rather than delete, which is the documented reversible step. Reverse in the opposite order to the disable, and re-enable the pager nodes before re-activating `SyncView Workload — Reconcile` so the reconcilers are not dispatched into a lane nothing is watching. **[RESTORED 2026-09-08 · sources: CLAUDE.md (n8n standing constraint); docs/truth/N8N.md; ROLLBACK.md rule 2 (private snapshot before an n8n edit)]**
  - [runtime-flag] Disable the scheduled GitHub workflows: sample-linear-reconcile.yml, linear-deliverables-reconcile.yml, b1-linear-incremental-refresh.yml, production-shadow-audit.yml.
    undo: Re-enable in the Actions UI or revert the PR. MUST land together with the monitoring-watchdog LANES edit (F6) or the dead-man's switch pages forever on lanes that were deliberately retired.
  - [runtime-flag] Set the three repo vars CLIENT_CONTINUITY_VIEW_ENABLED / CLIENT_CONTINUITY_OBSERVER_ENABLED / CLIENT_CONTINUITY_RELEASE_SHA and the ~12 CONTINUITY_* repo secrets to activate the client-facing continuity lane.
    undo: Set the ENABLED vars back to false; the workflows' job-level `if:` makes them no-ops. Owner must first verify privately that the census credential has complete unfiltered read visibility for the designated client scope.
  - [other] Revoke LINEAR_MIRROR_API_KEY, LINEAR_API_KEY, LINEAR_READ_API_KEY, LINEAR_INBOUND_SIGNING_SECRET.
    undo: NOT REVERSIBLE after Sept 15 (the account is gone). HARD PRECONDITION: production-write's two 503-on-missing-key call sites (index.ts:837, :2291) must be removed and deployed first, or staff lose deliverable creation and label selection.

RISKS
  - Alarm fatigue, self-inflicted, on cutoff day. Four dead-man lanes break, the outbound `oldest_pending_age` alert pins ON for any undrained real-team row (both teams are syncview, threshold 30 min), and the assurance-ledger gate starts firing correctl
    mitigate: F6 (LANES repair + re-homed second --check host) lands in the SAME PR as F4 (disabling the workflows), never after. STEP 0 drains the queue to zero before STEP 2 so the pending-age alarm reads false. Restate the affected ASSURANCE_LEDGER rows in the same PR, to whatever their dates actually support — `test/assurance-ledger-freshness.js` refuses a restatement that claims more than the dates allow, so this cannot be fudged, and the gate fires when a row stops supporting the state written beside it rather than merely being old. The welding is already in the code and is what makes the same-PR rule enforceable rather than advisory: each lane in `scripts/monitoring-watchdog.js` carries `retires_with: 'linear'` and `retired`, and its comment states the invariant outright — "you cannot disable a Linear workflow without retiring its lane, and you cannot retire a lane while its workflow still runs. The two halves of the cutoff are welded together by the test suite instead of by a note in a runbook." The four lanes marked `retires_with: 'linear'` are `reconciler_pager`, `production_write_drill`, `b1_incremental_refresh` and `production_shadow_audit`; the watchdog's own lane keeps working only because its second `--check` host moves from `linear-deliverables-reconcile.yml` to `monitoring-crosscheck.yml`, which is the whole of the re-homing. **[RESTORED 2026-09-08 · sources: scripts/monitoring-watchdog.js lines 85-130 @claude/lx-f-cutoff-part2; docs/ops/MONITORING.md (assurance-ledger row); docs/testing/ASSURANCE_LEDGER.md]**
  - The cutoff SQL is installed without its worker, or the worker without the SQL. The candidate's own doc says the worker alone 'fails closed at claim' and the SQL alone leaves the unchanged old direct claimant able to take a fresh lease after cutoff.
    mitigate: One release window, enforced by the Section 4 lane's per-function fingerprint (digests are per function so two PRs re-pinning different functions do not conflict, but this pairing is SQL+function and CI does not check it). Add an explicit runbook precondition: the migration is applied and read back BEFORE the linear-outbound dispatch, in the same window, with the source closure pins recomputed on the combined release candidate — the cutoff doc requires exactly that ("installed/deployed as one release window, source/readback verified… Source closure pins must be recomputed on the combined release candidate"). **CORRECTION TO THE RISK THIS MITIGATES, from the same doc: the SQL-alone half is no longer true as stated.** The risk line says SQL alone "leaves the unchanged old direct claimant able to take a fresh lease after cutoff" — that was the pre-correction behaviour (the replacement real-schema proof came back 9 PASS / 2 FAIL on exactly that), and the corrected update guard now refuses a fresh lease from the unchanged old direct claimant after cutoff. What remains true, and is the reason the window still matters, is the other half: deploying only the Edge Function fails closed at claim. So SQL-first is the safe order, and function-first is the one that breaks the drain. **[RESTORED 2026-09-08 · source: docs/ops/LINEAR_OUTBOUND_CUTOFF.md §"Installation, rehearsal, and recovery dependencies" and §"Correction evidence and monitoring obligation"]**
  - Installing the migration without extending the F27 recovery contract. The doc says the new control owner is outside `selected37` recovery; installing anyway means the documented one-step database rollback silently no longer covers the schema, and nob
    mitigate: F1 gates install on the recovery-recipe extension plus a re-run preflight. If that cannot be reviewed before Sept 15, ship the flags and watchers and DO NOT install — the flag already stops the mirror and is fully reversible.
  - Revoking Linear credentials before production-write's two call sites are removed turns 'create a deliverable' and 'pick a label' into HTTP 503 for staff (`project_mapping_validation_unavailable`, `label_catalog_unavailable`), on a day when nobody wil
    mitigate: Credential revocation is the LAST step in the runbook and is explicitly gated on the production-write lane. The F11 rehearsal runs production-write with the keys unset specifically to surface this before the date, not after.
  - Scheduling the existing standalone monitors leaks into a PUBLIC repo. scripts/foreign-write-strand-check.js prints client slug and `assigned to <person name>` per stranded row into what would become a public Actions log.
    mitigate: Do not schedule it — post-cutoff it is moot anyway (no Linear, no foreign writes). Same for attribution-stuck-check.js. Schedule only workload-native-visibility-check.js, and **not on the assumption that `--json` is counts-only — IT IS NOT.** Verified in the source: `--json` prints `mirror_says_inactive`, `never_imported`, `parked_by_name` and `other` as full row arrays of `{id, identifier, team, status, client, why}` (scripts/workload-native-visibility-check.js:289-293, rows built at :238). Those carry no person names, which is the leak that matters here, and client SLUGS are permitted by the house rule — but row ids and identifiers in a public Actions log are still more than the gate needs. Either add a counts-only output mode and schedule THAT, or assert in `test/` that the scheduled invocation emits no personal name and no client display name, and keep the row detail for hand runs. For contrast, the thing being avoided: `scripts/foreign-write-strand-check.js:207` prints `<issue> <client> Linear: … SyncView: … assigned to <person name>` per stranded row. That is a person's name in a public log and it is why this script must not be scheduled. **The final clause of the original line, which began "The client-", is UNKNOWN and is not guessed here** — most likely about the client-continuity lane's own census output, which is gated behind repo vars and has its own precondition below; establish it before relying on it. **[RESTORED 2026-09-08 · sources: scripts/workload-native-visibility-check.js lines 106, 236-239, 285-306; scripts/foreign-write-strand-check.js lines 190-212; CLAUDE.md public-repo constraint. The trailing "The client-" clause is an honest gap.]**
  - The rehearsal passes because the harness is lying. As written the QA mock returns 200/{ok:true} for 4 of 10 webhooks and never touches api.linear.app, so running it unchanged 'proves' Linear-dead survival while actually proving Linear-healthy surviva
    mitigate: F11's whole point. Add SYNCVIEW_QA_LINEAR_DEAD=1, widen the regex to all ten names, abort api.linear.app at page level, and mix connection-refused with 502/504-non-JSON (OPEN_REPAIRS 78 records n8n logging 20 blocked calls as `success`, so a 200-with-a-refusal-body must be asserted as a FAILURE by the rehearsal, not passed as a success). The precedent in full, because it is the exact trap: since the flip, 14 calls to Calendar - Linear Set Status and 6 to Add Comment each necessarily returned `{ok:false, blocked:true, reason:'syncview_authoritative', http_status:409}` and wrote nothing — and n8n recorded all 20 executions as `success`, because the workflow completed. Green dashboard, zero effect. So the rehearsal must assert on the BODY and not the transport status, and "the mock returned 200" must never satisfy a dead-Linear assertion. Item 178's night summary records the same class already caught here once: four probes overrode the dead-mode switch with their own always-succeeds Linear, and after the fix dead mode returns `ABORT / 502 / 504 / 200-lie` where it returned a flat `200`. **[RESTORED 2026-09-08 · sources: docs/ops/OPEN_REPAIRS.md item 78 (lines 5732-5739) and item 178 (the dead-Linear rehearsal bullet)]**
  - Activating the cutoff RPC is one-way and there is deliberately no re-enable path. If it is activated while a real-team row is still `authorized_before_cutoff`, recovery requires reconciling that row against a provider that no longer exists.
    mitigate: Activation is the last, optional step, taken only after the F5 census reports zero non-terminal real-team rows. If Sept 15 arrives with any such row, do NOT activate — leave the flag at off, which is equally effective at stopping traffic and fully reversible, whereas activation is not reversible at all (there is deliberately no re-enable RPC; recovery needs a reviewed migration delta plus a reconciliation against a provider that no longer exists). Read the census through `public.linear_outbound_cutoff_debt_v1` (service_role only) and treat two answers as blocking: any real-team row disposed `authorized_before_cutoff` (a provider mutation was authorized and its outcome is unknown) and any `claimed_before_cutoff` (a worker holds a lease). A census ERROR or a missing control row is also a block — the debt function raises `linear_cutoff_control_unavailable` rather than returning an empty result precisely so that "no rows" can never be mistaken for "no debt". The flag-at-off state costs nothing and can be held indefinitely. **[RESTORED 2026-09-08 · sources: migrations/2026-09-06-linear-outbound-cutoff.sql lines 165-215; docs/ops/LINEAR_OUTBOUND_CUTOFF.md §"Installation, rehearsal, and recovery dependencies" and §"Correction evidence and monitoring obligation"]**
  - The client-continuity lane goes live with a census credential that RLS can filter, producing counts that look authoritative and are not — a watcher that says 'healthy' about a partially-hidden board is worse than no watcher.
    mitigate: The package already treats this as an owner precondition; make it a runbook checkbox with a named verification (compare the credential's count against a service-role count for one scope, once, privately). `count_unproven` and `inconclusive` are already NON-OK codes in the monitor: `scripts/client-continuity-monitor.js` @`origin/agent/continuity-release-package-20260906` builds every result through `report()`, which sets `ok: code === 'healthy' || code === 'recovered'`, so both are failures and neither can be mistaken for green. `assessRead` returns `count_unproven` whenever `complete !== true`, `authorityMatched !== true`, `authoritativeCount` is not a safe non-negative integer, or `renderedCount !== authoritativeCount`; its input contract is stated in the function's own comment as "ONE settled load, same generation/scope/snapshot, with a complete independent census for this exact visible filter (never whole roster)". A false-empty read is refused separately (`outcome !== 'success'` with `display === 'empty'` returns `false_empty`), and a stale one at 300s. **But that is exactly why the owner precondition still stands, and the code does not close it.** The monitor only compares two numbers it is handed. If the census credential is RLS-filtered, `authoritativeCount` is filtered too, and `renderedCount === authoritativeCount` is satisfied by two consistently-hidden numbers — a 'healthy' about a partially hidden board, which is the risk this line mitigates. The one comparison the monitor cannot make for itself is against a service-role count, so make that the checkbox, once, privately, per scope. **[RESTORED 2026-09-08 · source: scripts/client-continuity-monitor.js lines 6-37 @origin/agent/continuity-release-package-20260906. Replaces an earlier restoration that reported both identifiers as appearing on no reachable branch; they are in that package, and this is what they do.]**

TESTS
  EXISTING, lift with the code, run offline with no database: test/linear-outbound-cutoff.js (26 source assertions incl. 'cutoff activation never manufactures terminal queue success' and a pinned-base negative control against git object 8514a83e), test/linear-outbound-read-cutoff.js (~37 checks; VM-executes the real authorizeProviderDispatch and rejects 10 malformed generations, 8 malformed outbox_ids and 7 malformed receipts)
  EXISTING, needs a local disposable Postgres: node scripts/linear-outbound-cutoff-rehearsal.js with G8_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY + G8_TEST_PSQL + G8_TEST_PORT (prints 'SKIP G8' and exits 0 otherwise); and `--read-fence` for the read-path lane. Candidate reports 13 PASS / 0 FAIL with zero external requests.
  EXISTING, lift: test/client-continuity-monitor.js (--strict-source), test/client-continuity-view.js, test/client-continuity-independent.js, test/client-continuity-operations.js, test/client-continuity-heartbeat.js, test/client-continuity-local-objects.js, qa/client-continuity.js, qa/client-continuity-transport.js, node scripts/client-continuity-run.js --fixture (all fully intercepted, no credentials, no backend writes)
  EXISTING, must be UPDATED by this lane: test/monitoring-watchdog.js — it will pin the current 8-lane LANES list; changing LANES without updating it is a build break, and updating it silently is how a lane gets dropped unnoticed.
  EXISTING, must be UPDATED: test/workload-linear-cutoff.js (191 lines, candidate) only if F2's workload-linear half is lifted.
  EXISTING, the rehearsal vehicle: qa/master.js (--profile=full), qa/run-probes.js, qa/scenario_engine.js. NOTE npm test (test/run-all.js) is the full suite and takes several minutes; npm run test:prod-polish CANNOT pass in a sandbox with no route to the live backend — all 8 lanes fail identically on origin/main, so verify against main before calling anything a regression.
  NEW: test/outbox-debt-census.js — must include a negative case proving a census read error or a missing control row is reported as FAILURE and never as 'zero debt'.
  NEW: test/native-write-drill.js — must include a fetch guard proving the drill makes zero requests to api.linear.app, and a case proving a write that is accepted-but-not-persisted fails the drill.
  NEW: a test asserting no scheduled workflow references LINEAR_API_KEY / LINEAR_MIRROR_API_KEY / LINEAR_READ_API_KEY, so the cutoff cannot silently regress.


=== ADVERSARIAL REVIEW OF YOUR OWN BRIEF — READ THIS TWICE ===
A second agent tried to prove the brief above wrong. It found the following. Where the review disagrees with the brief, THE REVIEW WINS.

CLAIMS THAT ARE WRONG:
  ! already_built #7: 'Three read-only, publishable-key-only, zero-Linear post-flip monitors' — and F8(b): schedule scripts/workload-native-visibility-check.js as the post-cutoff invisible-work gate because 'grep -c api.linear.app returns 0'.
    why: `grep -c api.linear.app` returning 0 is the wrong test. /home/user/client-analytics/scripts/workload-native-visibility-check.js:220 pages `workload_issues?select=identifier,is_sub_issue,status,status_type,active` — the Linear-derived mirror. Its whole classification (`MIRROR SAYS INACTIVE`, `NEVER IMPORTED`) is a join 
    truth: Do not schedule workload-native-visibility-check.js as-is. It is Linear-derived-data-dependent even though it never calls api.linear.app. Either re-point it at the native source (`workload_issues_native_v1`) first, or drop it from F8 and let F8(a) (workload freshness) carry the lane. Re-word already_built #7 to 'no Lin
  ! already_built #4 / corrections_to_context #2: workload-linear gains `requireProviderAdmission` so 'One flag therefore kills two provider surfaces', and the cutoff control 'is observed by TWO Edge Functions, not one'.
    why: The source change is real (git diff origin/main...5bcc03bd -- supabase/functions/workload-linear/index.ts: `requireProviderAdmission` throws WorkloadLinearError(410,'workload_linear_retired') and 503 'linear_cutoff_control_unavailable', awaited inside `linearRequest`). The premise is not. /home/user/client-analytics/do
    truth: Treat workload-linear as source-only until an operator receipt proves otherwise. The candidate's workload-linear cutoff adapter and test/workload-linear-cutoff.js (191 lines) are dead weight for the exit, not belt-and-braces. F3.A's 'Stop = retire the function (delete/404 readback)' is retiring something that was never
  ! already_built #2 lift_how: 'Its offline proof test/linear-outbound-cutoff.js + test/linear-outbound-read-cutoff.js come with it and run with no database.' Repeated in tests[0]: 'EXISTING, lift with the code, run offline with no database'.
    why: Both tests have a CI branch that demands a real Postgres. test/linear-outbound-cutoff.js ends with `if(process.env.CI||process.env.F63_REQUIRE_POSTGRES==='1'){ assert.equal(process.env.F63_REQUIRE_POSTGRES,'1','explicit_disposable_binding_required'); assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST
    truth: F2 must budget CI provisioning (disposable loopback Postgres + `fetch-depth: 0` or an equivalent unshallow) as part of the lift, or gate the tests out of CI deliberately. 'Runs with no database' is only true for a local developer invocation with CI unset.
  ! live_actions_needed (migration reversibility): 'Additive: drop the three triggers, **the four functions**, the view and the control table'. F1 scopes the F27 recovery extension to 'the added table, the four new mirror_outbox columns and the three triggers'.
    why: migrations/2026-09-06-linear-outbound-cutoff.sql creates SEVEN functions: linear_outbound_stamp_generation_v1, linear_outbound_control_lock_v1, linear_outbound_claim_v1, linear_outbound_authorize_dispatch_v1, linear_outbound_stale_worker_guard_v1, linear_outbound_cutoff_activate_v1, linear_outbound_cutoff_debt_rows_v1 
    truth: The recovery-contract extension must enumerate 7 functions, 3 triggers, 1 view, 1 table, 4 columns and 1 check constraint. Grant lines must be covered too (the migration revokes from service_role then re-grants selectively).
  ! F5: 'If F1 installed, read `public.linear_outbound_cutoff_debt_v1` instead and report the five dispositions (`terminal_receipt`, `unclaimed_before_cutoff`, `claimed_before_cutoff`, `authorized_before_cutoff`, `accepted_after_cutoff`) as counts.'
    why: linear_outbound_cutoff_debt_rows_v1 has SIX branches, and the second one is `when not c.cutoff_enabled then 'cutoff_inactive'`. It is evaluated before every other non-terminal branch, so while `cutoff_enabled=false` EVERY non-terminal row returns `cutoff_inactive` and none of the four debt dispositions is ever produced
    truth: F5's census must be the raw `select status, count(*) from public.mirror_outbox where legacy_parity=false and test_only=false group by 1` in every scenario, and treat the debt view as an additional signal only after activation. State the sixth disposition explicitly so an operator does not read a wall of `cutoff_inactiv
  ! F3.A / risk #4 / F11: production-write has 'two Linear call sites' (index.ts:837 label catalog, :2291 project-mapping/assignee), and the rehearsal's expected server-side result is '503 label_catalog_unavailable on the label path and 503 project_mapping_validat
    why: There are four distinct staff-visible failure surfaces behind two transport functions in /home/user/client-analytics/supabase/functions/production-write/index.ts: (1) `linearLabelsRequest` :832-834 → 503 `label_catalog_unavailable`, called at :871/:918/:946; (2) `linearRead` :2282/:2325 → 503 `project_mapping_validatio
    truth: F11 must assert all four codes with the keys unset, and F0 STEP 7's hard precondition must gate on all four call sites being removed, not two. I confirmed at 5bcc03bd that the candidate branch does NOT remove any of them — depends_on is right that this is another lane's work.
  ! done_when #5: "Verified by `grep -rn 'LINEAR_.*_KEY\|LINEAR_API_KEY' .github/workflows/ | grep -v workflow_dispatch` returning nothing on a scheduled lane."
    why: The command cannot return nothing even after a perfect cutoff. `grep -v workflow_dispatch` filters LINES containing that literal, not workflows triggered by it. Three dispatch-only workflows keep matching on lines that do not contain the word: .github/workflows/slice5-test-drills.yml:123 (`SUPABASE_SERVICE_ROLE_KEY LIN
    truth: Replace with a real check: parse each workflow's `on:` block and fail only when a workflow that has a `schedule:` key also references a LINEAR_* secret. That is what the NEW test in tests[] should assert. Also add slice5-test-drills.yml and graphics-f2-evidence.yml to F3's inventory — both break on credential revocatio
  ! already_built #1 lift_how: 'Cherry-pick the migration file verbatim. It is standalone SQL with no imports.'
    why: It is standalone, but it is NOT re-runnable, which the brief never says and the F27 apply/preflight path assumes. Inside its single `begin;...commit;` the migration uses plain `create function public.linear_outbound_control_lock_v1()`, plain `create trigger linear_outbound_control_lock_v1`, plain `create function publi
    truth: Add an install precondition ('applies once; re-apply requires the drop block first') and record the statement-trigger blast radius in F1's risk. This is a second, independent reason F1 is correctly rated high-risk and correctly droppable for a Sept 15 deadline.
  ! tests[0]: 'test/linear-outbound-cutoff.js (26 source assertions...)'; tests[3]: 'test/monitoring-watchdog.js — it will pin the current 8-lane LANES list'.
    why: test/linear-outbound-cutoff.js at 5bcc03bd is 42 lines with 16 `ok(...)` assertions, not 26. (The read-cutoff test's breakdown IS accurate: 10 malformed generations, 8 malformed outbox_ids, 7 malformed receipts — I counted them in the source.) And test/monitoring-watchdog.js does not pin a lane count: it derives everyt
    truth: Cosmetic on the count; substantive on the watchdog test — the F6 work item is 'update the reconciler_pager fixtures at test/monitoring-watchdog.js:92-99', not 'update a pinned list'. Adding a lane needs no test change at all, which is the opposite of the brief's stated hazard.
  ! F0 STEP 0: 'Any row that will not drain (e.g. the structurally-unsendable `duplicate` rows described in the comment block at linear-outbound/index.ts:1418-1432) is named and dispositioned in the runbook by hand.'
    why: The comment block is real (I read supabase/functions/linear-outbound/index.ts:1415-1436) but it describes a fix, not an open condition. It says explicitly: 'SKIPPED, not failed, and deliberately so... Failing instead buys an identical outcome plus eight pointless API calls and a permanent false alarm.' Duplicate-status
    truth: Drop the duplicate rows as a STEP 0 example. The real open question for STEP 0 is the one the brief already has right in open_questions: whether any of the constant `backlog: 14` are real-client rows, which needs the service-role read. Note that `backlogCount` (:974-979) filters NEITHER test_only NOR legacy_parity whil

WORK THE BRIEF MISSED:
  + Sept 15 stops the estate minting human-readable task names, and STEP 3 is what stops it
    why: OPEN_REPAIRS 162 was filed today (commit 8483498, 2026-09-07) and the brief does not reference it once. I verified the mechanism: `deliverables.linear_identifier` — the `VID-13553`/`GRA-7197` name a human reads — is written only by supabase/functions/linear-inbound/index.ts:810 (on a Linear webhook) and supabase/functi
    files: /home/user/client-analytics/docs/ops/OPEN_REPAIRS.md, /home/user/client-analytics/supabase/functions/linear-inbound/index.ts, /home/user/client-analytics/supabase/functions/linear-outbound/index.ts, /home/user/client-analytics/index.html, /home/user/client-analytics/migrations/2026-09-07-native-intake-named-append.sql
  + The Workload board has a LIVE fallback to the `linear-issues` webhook — freeze is only half the failure
    why: corrections_to_context #7 and F8(a) rest on 'Linear dying freezes the board, it does not empty it'. That is true only on the happy path. index.html:14553 and :14555 log `'[Workload v2] Supabase returned 0 active rows — falling back to linear-issues'` and `'[Workload v2] Supabase read failed — falling back to linear-iss
    files: /home/user/client-analytics/index.html
  + `production_assignee_eligibility` — an existing runtime flag that gates a Linear read, absent from live_actions_needed
    why: supabase/functions/production-write/index.ts defines `ASSIGNEE_ELIGIBILITY_FLAG = 'production_assignee_eligibility'` and `assigneeEligibilityPolicyFor()` returns `{ providerMappingRequired: true }` when the flag row is absent or unreadable — the comment says 'absence means "strictest"'. So today, with no flag row, ever
    files: /home/user/client-analytics/supabase/functions/production-write/index.ts
  + No step recomputes the Edge Function fingerprint/closure pins for the combined release
    why: CLAUDE.md is explicit that both deploy lanes 'refuse on a fingerprint mismatch' and that digests are regenerated with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`, never by hand. docs/ops/LINEAR_OUTBOUND_CUTOFF.md closes its installation section with 'Source closure pins must be recomputed on t
    files: /home/user/client-analytics/scripts/ef-fingerprint.js, .github/workflows/deploy-f27-section4-closures.yml, /home/user/client-analytics/docs/ops/LINEAR_OUTBOUND_CUTOFF.md
  + F2's lift list omits the rehearsal's own dependencies
    why: scripts/linear-outbound-cutoff-rehearsal.js line 13 is `const {LocalDatabase,source}=require('./card-change-journal-rehearsal'), {setup}=require('./card-history-integrated-rehearsal');`. Both are candidate-only files (scripts/card-change-journal-rehearsal.js and scripts/card-history-integrated-rehearsal.js appear in th
    files: /home/user/client-analytics/scripts/linear-outbound-cutoff-rehearsal.js
  + linear-outbound-drain.yml has no heartbeat and is not a watchdog lane
    why: F5 leans on the drain summary as the 'SECOND, FREE SIGNAL ALREADY WIRED' and done_when #3 requires 'a scheduled drain summary event still writes every 10 min'. But .github/workflows/linear-outbound-drain.yml (cron */10) contains no `monitoring-watchdog.js --heartbeat=` step and no key for it exists in scripts/monitorin
    files: /home/user/client-analytics/.github/workflows/linear-outbound-drain.yml, /home/user/client-analytics/scripts/monitoring-watchdog.js
  + Old-isolate quiescence has no step in the runbook order
    why: docs/ops/LINEAR_OUTBOUND_CUTOFF.md lists as an explicit RED HOLD: 'provider reads from old deployed `linear-outbound` isolates, including their unconditional viewer: the source follow-up above requires exact deployment/readback and old-worker quiescence before this hold can clear'. The fix for the unconditional `readVi
    files: /home/user/client-analytics/docs/ops/LINEAR_OUTBOUND_CUTOFF.md, /home/user/client-analytics/supabase/functions/linear-outbound/index.ts
  + Two credential-consuming workflows and the alarm-proof lane are missing from the F3 inventory
    why: F3.B enumerates the scheduled Linear-key workflows correctly (I confirmed production-shadow-audit.yml:37, b1-linear-incremental-refresh.yml:61, production-write-drill.yml:73, linear-deliverables-reconcile.yml:72 and its `run: |` blocks at :86/:97 that do invoke scripts/linear-deliverables-reconcile.js). But the full gr
    files: /home/user/client-analytics/.github/workflows/slice5-test-drills.yml, /home/user/client-analytics/.github/workflows/graphics-f2-evidence.yml, /home/user/client-analytics/.github/workflows/monitoring-cutover-proof.yml

OPEN QUESTIONS — answer from the code if you can; escalate to the coordinator only if a wrong guess is expensive
  ? I did not read the live database. `linear_outbound_enabled={"mode":"live"}`, `linear_inbound_enabled={"enabled":true}` and `linear_legacy_parity_enabled={"enabled":true}` come from the brief and from ROLLBACK.md rows dated 2026-07-14 / 2026-08-02. ROLLBACK.md 
  ? How many real-client rows are actually sitting in mirror_outbox in a non-terminal status right now, and are any of them `legacy_parity=true`? OPEN_REPAIRS 75 says the observable is a constant backlog of 14 with both `oldest_pending_minutes` null (implying they
  ? Is `workload-linear` actually deployed? EF_DEPLOY_MANIFEST.md:57 says NO CI DEPLOY PATH / 'first deploy requires an exact-SHA operator release', and ROLLBACK.md's Workload row is marked SOURCE ONLY with 'there is no live rollback' — but OPEN_REPAIRS 79 and the
  ? Is the n8n 'SyncView Workload — Reconcile' graph I read (n8n-backups/workload-reconcile.2026-06-17.json) still the live version? The fail-safe behaviour I am relying on — return [] on a bad read, never mass-deactivate — is from a June backup. If the live graph
  ? Which n8n workflows besides the Workload reconcile hold Linear credentials and run on a schedule? I read only the repo's backups; the live inventory is in n8n. docs/ops/MONITORING.md names pager `qllIDZPkdNAPRj0b`, relay `Tfhc3vebZyG6obOg`, inactive receiver `
  ? Does the SyncViewbot Slack DM path still work end-to-end, today? Every watcher in this brief routes through it, and MONITORING.md records that the last time nobody checked, 42 consecutive nightly failures produced zero pages. F10 assumes the relay is healthy; 
  ? Is the F27 emergency provider replay path considered expendable after Sept 15? The cutoff permits no ordinary F27 requeue or provider dispatch, and after Linear is gone the replay half of F27 is impossible regardless. The Edge Function source rollback half (th
  ? Does the owner want the Workload board's Linear-derived population retired, or kept frozen as a read-only historical snapshot? He has ruled that historical Linear issues do not matter, which argues for retiring `workload_issues` entirely — but `public.workload


IF THIS LANE IS NOT FINISHED BY 2026-09-15, THIS BREAKS:
"Everything keeps looking fine for about a day, and then quietly stops being true. Concretely, on Sept 15 with this lane unfinished: the Workload board freezes — the n8n reconcile's own safety gate returns [] on a bad read so it never mass-deactivates, meaning ~2000 rows stay active=true with a synced_at that never advances, and the browser's watermark check only reacts when the value moves FORWARD, so a permanently stale board is indistinguishable from a healthy one to both the page and every existing monitor. Every mirror write keeps enqueuing into mirror_outbox and keeps re-pausing forever, so client comments and status changes accumulate as invisible, undeliverable debt that no failed_write alert will ever report because the rows never reach `failed`. Four of the eight dead-man's-switch lanes (production_write_drill, production_shadow_audit, b1_incremental_refresh, reconciler_pager) hard-require LINEAR_API_KEY and start failing on cutoff day — each heartbeats ok=false under `if: always()`, latches a permanent incident, and emails a red run daily, which trains the owner to ignore the one channel that would have told him about the real failure. One of those same workflows also hosts the watchdog's second `--check`, so disabling it removes the reason the watchdog can report its own death. And the only staff drill that proves a write actually lands end-to-end asserts Linear reflection, so it goes permanently red on the very day the write path changes underneath it. None of this pages anyone. The estate's own documents already name this failure mode twice — 'silence is unknown, not green' and 'five of six sampled load-bearing workflows had no errorWorkflow' — and the cutoff makes it four times worse before it makes it better."


START BY: reading docs/independence/LINEAR_EXIT_LANES.md on origin/main (the lane map and the index.html region ownership table), then OPEN_REPAIRS items 162-168. Then confirm for yourself that the 'already built' artifacts above really exist before you plan anything around them.
