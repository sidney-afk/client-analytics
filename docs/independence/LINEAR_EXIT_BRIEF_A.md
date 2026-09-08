SESSION NAME: LX-A Workload native
KEEP THIS EXACT SESSION TITLE. Do not rename it. The owner tracks six parallel sessions by title.

SESSION NAME: LX-A Workload native
Keep this exact session title. Do not rename it. The owner tracks parallel sessions by title.

You are ONE of six parallel sessions removing Linear from SyncView before Linear
access ends on 2026-09-15. Today is 2026-09-07. A coordinator session owns merge
order and the ledger; you own exactly one lane and nothing else.

YOUR BRANCH: claude/lx-a-workload-native   (create it from origin/main, push there, never elsewhere)

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
Push, open a DRAFT PR titled `LX-A: <what it does>`, and in the body state:
  - what is done and proven, with the test names
  - what is NOT done
  - every live action the owner must take (migration, deploy, flag, n8n edit),
    each with its exact undo
  - anything you found that belongs to another lane
Then stop. Do not merge. Do not start another lane's work.


=== YOUR LANE: A ===
BRANCH: claude/lx-a-workload-native
MERGE POSITION: 3rd. You must be live AND your acceptance measured BEFORE lane F stops the n8n Workload reconcile, because your acceptance check compares against workload_issues and becomes unrunnable once that table stops being rebuilt.

GOAL
The Workload board's entire population, status, assignee, weight, deadline, plan-day and Tweak-feedback surface is served from native SyncView data (deliverables/batches/team_members/clients/production_comments/workload_plan) with zero request to Linear or to any n8n Linear webhook, and it keeps working when `workload_issues` stops being rebuilt.

DONE WHEN
  - `node -e` / grep proof: no code path reachable from `initWorkloadView` fetches `LINEAR_ISSUES_WEBHOOK`, `LINEAR_TWEAK_COMMENTS_WEBHOOK`, or `WORKLOAD_LINEAR_URL` while `prod_authority = {video:syncview, graphics:syncview}` — the only Workload network calls are POST `/functions/v1/workload-plan` and POST `/functions/v1/production-comments`.
  - `migrations/2026-09-02-workload-native-view.sql` and `migrations/2026-09-05-workload-native-membership.sql` are both applied and read back; `select count(*) from public.workload_issues_native_v1` returns a number and `workload_native_snapshot_v1()` returns `complete:true` under service_role.
  - A `deliverables` row created natively AFTER outbound is off (so `linear_issue_uuid is null` and `linear_raw` carries no `issue.labels`) appears on the board at weight 1x. Today that row makes `wlFetchNativeSnapshot` throw `Native Workload deadlines or weights are incomplete.` and blanks the WHOLE board — this is the release gate.
  - A plan day saved BEFORE the cutover (keyed on the Linear uuid in `workload_plan.issue_id`) still renders on its row after the cutover, and re-dragging it updates the same storage row rather than creating a second one. `workload_native_plan_set_v1` returns `plan.issue_id = <native del_ id>` with `storage_issue_id = <linear uuid>`.
  - A plan-day write on a never-mirrored native deliverable (no `linear_issue_uuid`) succeeds and returns `updated:1` — the case that made a swap unsafe before.
  - OPEN_REPAIRS item 95's 40 rows: `window.wlNativeDiff()` reports them under `nativeOnly` (present natively, absent from `workload_issues`), and after the cutover they are visible on the board for their 10 active-roster clients.
  - OPEN_REPAIRS item 160's 12 status-drift rows show the NATIVE status on Workload, matching SyncLinear — the two surfaces stop disagreeing.
  - Tweak Needed popover renders feedback from `production-comments` for a native row with comments, and renders the explicit empty state (not a Linear error) for one without. Zero requests to `…/webhook/linear-tweak-comments`.
  - `WL_V2_REALTIME = true` with the channel bound to `public.deliverables` + `public.batches`, and an edit made in another browser appears on an open board within ~2s without a manual Refresh.
  - `sort_order` is not reintroduced: `_wlV2MapRow` still reads `r.sort_order`, the snapshot still publishes `native_sort_key`, and `wlSortSubIssues`'s `nativeOrder` branch stays false on live data.
  - Full `npm test` green except known-environment failures (`test/truth-sync.js` in a shallow clone; `npm run test:prod-polish` fails identically on origin/main in a sandbox).

ALREADY BUILT — LIFT THESE, DO NOT REBUILD
  * `public.workload_issues_native_v1` — the native replacement view, answering all 20 `_wlV2MapRow` fields as two `union all` arms (one per deliverable, one per batch carrying at least one). Total status map with a fail-the-transaction guard, `security_barrier`, anon+authenticated select. It is on ORIGIN/MAIN, not on the candidate.
    where: origin/main, `migrations/2026-09-02-workload-native-view.sql` (376 lines)
    confirmed: `cat migrations/2026-09-02-workload-native-view.sql` — read in full. Status CASE covers exactly the 13 values in the `deliverables.status` CHECK at `migrations/2026-07-06-b1-linear-data-model.sql:39-41`. Publishes `native_sort_key`, not `sort_order`. Not in EXECUTION_LOG → NOT APPLIED.
    lift: Nothing to lift — it is already in the tree. It must be APPLIED (owner, Supabase SQL editor). Zero code change needed to `_wlV2MapRow` because the view was shaped to that mapper.
  * `workload_native_snapshot_v1()`, `workload_native_plan_target_v1(text)`, `workload_native_plan_set_v1(...)` — the SECURITY DEFINER RPCs that serve one complete staff snapshot (native rows + explicit-legacy rows + every `workload_plan` row) and perform the alias-safe plan write under row locks.
    where: candidate 5bcc03bd, `migrations/2026-09-05-workload-native-membership.sql`
    confirmed: `git show 5bcc03bd…:migrations/2026-09-05-workload-native-membership.sql` — read in full. `workload_native_snapshot_v1` reads `workload_issues_native_v1` under one snapshot, refuses on duplicate/blank ids or >50000 rows with `workload_population_incomplete`, and joins `production_deliverables_browse
    lift: Cherry-pick the file verbatim, then apply ONE fix (work item A3) before applying it: the `native_metadata` object must not hand the browser `workload_labels_complete = false` for a row that legitimately has no provider labels.
  * `workload-plan` Edge Function gains `action:"native_snapshot"`, routes plan writes through `workload_native_plan_target_v1` + `workload_native_plan_set_v1`, and keeps `requireWritableIssue` only for the explicit provider-authority branch (now gated on reading `prod_authority` and refusing `native_issue_unavailable` for a syncview team).
    where: candidate 5bcc03bd, `supabase/functions/workload-plan/index.ts` (+62/-8) and new `supabase/functions/workload-plan/native-snapshot.mjs` (67 lines)
    confirmed: `git diff origin/main...5bcc03bd -- supabase/functions/workload-plan/index.ts` read in full; `git show 5bcc03bd…:supabase/functions/workload-plan/native-snapshot.mjs` read in full. `projectNativeSnapshot()` re-validates the envelope, builds an identity+alias map, refuses a plan whose owner's client 
    lift: Cherry-pick both files. On main the old code is `supabase/functions/workload-plan/index.ts:162-183` (`requireWritableIssue` selecting from `workload_issues`) — that is the exact function the scope doc names as blocking, and the candidate keeps it as the legacy-only branch rather than deleting it.
  * Browser: `wlFetchNativeSnapshot()` replaces `loadLinearIssues` (which now just delegates to it), plus `wlIssueClientAllowed` / `wlIssueEditorAllowed` swapping the hardcoded `WL_ALLOWED_EDITORS` / `WL_CLIENT_NAMES` allowlists for server-computed `native_client_active` / `native_assignee_eligible`, native metadata projection, `?prod=1&d=<del_…>` and `?prod=1&batch=<bat_…>` deep links, and `issue.url = ''` so the Linear ↗ chip disappears on native rows.
    where: candidate 5bcc03bd, `index.html` hunks `@@ -14074`, `@@ -14155`, `@@ -14530,7 +14545,120 @@`, `@@ -15321`, `@@ -16398`, `@@ -16658`, `@@ -18793`, `@@ -19472`
    confirmed: `git diff origin/main...5bcc03bd -- index.html | sed -n '19,540p'` read in full. `loadLinearIssues` body is now `return wlFetchNativeSnapshot();` with the whole old body preserved as `_wlLegacyLoadLinearIssues`. `?prod=1&batch=` is already handled on main at `index.html:59594-59606`, so the parent d
    lift: Cherry-pick the Workload hunks. HIGH collision risk: index.html is one file and every lane edits it. Take these hunks by line range, not the whole file.
  * Tweak Needed popover native path: `wlFetchTweakComments` pages `production-comments` by `deliverable_id`, refuses on an incomplete page/total/cursor, filters `deleted_at`/`resolved_at`, and `wlRenderTweakComments(comments, native)` renders an explicit empty state instead of "open the sub-issue in Linear".
    where: candidate 5bcc03bd, `index.html` hunk `@@ -19268,6 +19462,66 @@` and `@@ -19290`, `@@ -19305`
    confirmed: Read the hunk. The request body is exactly `{deliverable_id, limit:100, before}` — no `include_feedback`, no `media_comment_id`. `supabase/functions/production-comments/index.ts:383-388` on ORIGIN/MAIN already returns `canonical_thread`, `audience_scope`, `has_more`, `next_cursor`, and `production-c
    lift: Lift the two functions. It runs against the production-comments contract main ALREADY deploys, so it does not wait on lane D.
  * Test coverage: `test/workload-native-membership.js` (browser readers in an isolated vm realm, five mutation-rejection cases, exact-baseline negative control against `99d31c81`), `test/workload-native-postgres.js` (opt-in disposable loopback PG16 applying the real migrations), `qa/workload-native/handler.mjs` + `integrated-handler.mjs` (real workload-plan handler over disposable SQL, `unapproved_rpc` guard), `qa/workload-native/browser.js` (full index.html in Chromium).
    where: candidate 5bcc03bd, `test/workload-native-membership.js`, `test/workload-native-postgres.js`, `qa/workload-native/*`
    confirmed: `git show 5bcc03bd…:test/workload-native-membership.js | tail -30` — it asserts `wlLoadSnapshot` REJECTS when `native_metadata.workload_labels_complete = false`, that a native feedback read makes exactly one call and it ends `/production-comments`, and that an unknown old-cache row cannot fall back 
    lift: Lift all four. Then AMEND the `workload_labels_complete=false` rejection case (work item A3) — as pinned today it locks in the outage.
  * `?wlnative=1` / `window.wlNativeDiff()` diff harness: reads `workload_issues` and `workload_issues_native_v1` side by side, reports `nativeOnly` / `linearOnly` / `neverMirrored` / `differing` / `statusSpellingOnly`, names its excluded fields in its own output, and reports truncation.
    where: origin/main `index.html:14243-14428`; survives unchanged on the candidate at `index.html:14251-14428`
    confirmed: Read `index.html:14300-14428`. Comment at the `nativeOnly` field states item 95's 40 rows are expected there and are the acceptance test.
    lift: Already present. This is the tool for the item-95 acceptance measurement (work item A7); it only works while `workload_issues` is still being rebuilt, so run it BEFORE the outbound cutoff.

WORK ITEMS
  [A1] (DONE — do not re-run) Apply the two migrations (owner window)
     **BOTH MIGRATIONS ARE APPLIED. This item is closed and its original text was wrong.** It said
     `migrations/2026-09-02-workload-native-view.sql` was "on main and NOT installed", inferring that from its absence
     from `EXECUTION_LOG.md`. Absence from the log is absence of a RECORD, not of the change: an owner migration window
     had already been spent without being logged. Item 176 disproved the claim with a live REST read, and on 2026-09-08
     the owner ran `public.workload_native_snapshot_v1()` in the SQL editor and it answered
     `ok=true complete=true contract=workload-native-snapshot-v1 count=6450 rows_len=6450 plans_len=262
     authority={"video":"syncview","graphics":"syncview"}`. A function that answers completely cannot be uninstalled.
     `migrations/2026-09-05-workload-native-membership.sql` was applied by the owner the same night.
     **Do not act on the drop instruction.** This item also claimed the view file's header tells the operator to
     `drop view if exists public.workload_issues_native_v1;`. It does not, unconditionally. The header states at :28-29
     that "Nothing is dropped, no table is touched, no row is written, and re-running it is a no-op", and the drop line
     at :153 is conditional on an EARLIER REVISION having been applied — a case the file itself describes as never
     having happened in production, which is the same false premise corrected above. Dropping a view that production
     now reads, on the strength of a stale parenthetical, is a live risk for no gain.
     files: EXECUTION_LOG.md only, and only to RECORD the two applications that already happened. Do not re-apply either migration.
  [A2] (medium risk, lift) Lift the workload-plan handler + native-snapshot.mjs onto main
     Cherry-pick `supabase/functions/workload-plan/index.ts` and `supabase/functions/workload-plan/native-snapshot.mjs` from 5bcc03bd. This is the row-identity + plan-key half of question 2: `requireWritableIssue` stops being the validator for syncview teams (it stays only for the explicit provider branch, now preceded by a `prod_authority` read that returns 409 `native_issue_unavailable` for a syncview team), and every write goes through `workload_native_plan_target_v1` → `workload_native_plan_set_v1`.
     files: supabase/functions/workload-plan/index.ts, supabase/functions/workload-plan/native-snapshot.mjs
  [A3] (high risk, mixed) FIX THE RELEASE-BLOCKING DEFECT: a row with no Linear labels must not blank the board
     `workload_native_snapshot_v1` puts `pv.workload_labels_complete` (from `production_deliverables_browser_v1`) into `native_metadata`. That column is `(production_workload_label_projection(d.linear_raw)->>'complete')::boolean` — and `production_workload_label_projection` (migrations/2026-07-23-f34-f53-production-attachments.sql:64-165) returns `complete:false` for ANY `linear_raw` that lacks a well-formed `issue.labels` relation with `pageInfo.hasNextPage = false`. Native intake writes `linear_raw: { attribution: … }` only (production-write index.ts:6069, 6657); the labels relation is stamped ONLY by `linear-outbound` (index.ts:870 `linear_raw: {…raw, issue: completeIssue}`). So after outbound
     files: migrations/2026-09-05-workload-native-membership.sql, index.html, test/workload-native-membership.js
  [A4] (high risk, lift) Lift the Workload browser hunks (source swap + identity + deep links + tweak popover)
     Take these index.html hunks from 5bcc03bd by line range, not the whole file: `_wlV2Ready` (drop the sticky ?wl2=0 kill switch — it could reopen a provider read path); `wlRenderableIssueProjection` → `wlIssueClientAllowed`/`wlIssueEditorAllowed`; `wlFetchNativeSnapshot` + `loadLinearIssues` delegation; `wlLoadSnapshot`; `wlRefetchSilent`; `wlManualRefresh`; `wlApplyData` filter/logging changes (client names and editor names are removed from console output — the repo is public and these logs were naming clients); `wlLooseParentInfo.nativeBatchId`; `wlSyncLinearUrl(s.nativeId || s.identifier)`; the popover header `?prod=1&batch=`; `wlFetchTweakComments` + `wlRenderTweakComments(comments, native
     files: index.html
  [A5] (medium risk, mixed) Turn realtime on, and repoint it
     `WL_V2_REALTIME = false` at index.html:14058 and the channel subscribes to `table: 'workload_issues'` (index.html:14452-14453). The stated reason for the gate — "the reconcile re-writes every row each run" — dies with the reconcile. Repoint the channel to `public.deliverables` and `public.batches` and set the constant true. The data layer is already ready: both tables are `replica identity full` and in the `supabase_realtime` publication (migrations/2026-07-06-b1-linear-data-model.sql:725-746) and anon has `grant select` + a `using (true)` RLS policy (same file, :674-680, :694-695), so no new exposure and no migration. ALSO: the candidate replaced `_wlV2CheckWatermark`'s cheap one-row `synce
     files: index.html
  [A6] (medium risk, new) Decide and implement the post-exit fallback story (there is none today)
     `loadLinearIssues`'s n8n `linear-issues` fallback is the board's whole "v2 can never blank the board" rollback story and it dies with Linear. The candidate replaces it with: a fail-closed completeness contract in SQL (`workload_population_incomplete`), re-validation in `projectNativeSnapshot` and again in `wlFetchNativeSnapshot`, and `wlLoadSnapshot`'s catch which RETAINS the last good in-memory snapshot, sets `planStatus='stale'` and shows a banner. That is a warm-path net only. The cold path regressed: `wlAdoptLinearMetadata` is now called with `{skipIssueCacheWrite:true}` and `wlFetchNativeSnapshot` never calls `wlWriteCache`, so the `syncview_linearIssuesCache_v1` localStorage warm start
     files: index.html
  [A7] (low risk, lift) Run the item-95 acceptance measurement BEFORE the outbound cutoff
     Open the board with `?wlnative=1` (or call `window.wlNativeDiff()`) once the view is applied. Expect item 95's 40 rows under `nativeOnly` and item 160's status drift under `differing[].field='status'` (spelling-only differences are counted separately and are not drift). Record the numbers in OPEN_REPAIRS items 95 and 160. This harness compares against `workload_issues`, so it stops being meaningful the moment the reconcile stops — it must run while Linear is still connected. Note `scripts/f40-workload-readiness.js` is NOT the tool: the candidate deliberately downgrades it to `population: 'unsupported'` → UNPROVEN under the native loader, so there is no native population census.
     files: docs/ops/OPEN_REPAIRS.md
  [A8] (medium risk, new) Measure what the native assignee-eligibility rule hides
     `native_assignee_eligible` is computed in SQL as `tm.active and tm.team = d.team and tm.role = (video→'editor' | graphics→'designer')`, and `wlRenderableIssueProjection` drops any assigned row that fails it. That REPLACES `wlIsAllowedEditor`, a hardcoded name allowlist under which (per index.html's own log line) graphics designers passed through with no allowlist at all. `team_members.role` is CHECK-constrained to `('admin','smm','editor','designer')` (migrations/2026-07-05-b0-linear-auth-scaffold.sql:10), so a graphics deliverable assigned to someone whose role is `smm` or `admin`, or whose `team` column disagrees with the deliverable's team, silently leaves the board. Count those rows agai
     files: docs/ops/OPEN_REPAIRS.md
  [A9] (medium risk, new) Delete the legacy Workload code once legacy_teams is empty
     After the cutover, remove `_wlLegacyLoadLinearIssues`, `_wlLegacyLoadSnapshot`, `_wlLegacyRefetchSilent`, `_wlLegacyFetchTweakComments`, `_wlLegacyCheckWatermark`, `LINEAR_ISSUES_WEBHOOK`, `LINEAR_TWEAK_COMMENTS_WEBHOOK`, `LINEAR_ISSUES_TTL_MS`, `wlIsAllowedEditor`/`WL_ALLOWED_EDITORS`/`WL_ALLOWED_GRAPHICS`, and the browser's `wlFetchForeignLinearMetadata` → `WORKLOAD_LINEAR_URL` calls. BLOCKED ON A DECISION (see open questions): the snapshot's legacy `union all` arm still emits `workload_issues` rows whose `team_key` is not VID/GRA — the view's own header records 8 such parent rows on Linear teams CON (Content Research) and STR (Strategy/Filming Plans). While that arm returns anything, `leg
     files: index.html, migrations/2026-09-05-workload-native-membership.sql
  [A10] (high risk, lift) Deploy workload-plan (owner, deliberate-manual)
     `docs/ops/EF_DEPLOY_MANIFEST.md:58` — `workload-plan` has **NO CI DEPLOY PATH, DELIBERATE-MANUAL**. Live v2 was deployed by the operator from `fd3e0eaa` on 2026-07-20; a redeploy requires `--no-verify-jwt` and an exact-SHA fingerprint readback. Capture the current deployed closure first so the prior version can be restored. Deploy AFTER A1 (the RPCs must exist, or `native_snapshot` answers 503 `workload_snapshot_unavailable`) and BEFORE the browser cutover ships to `main` (GitHub Pages auto-deploys index.html on push, so a merged browser change is live immediately and will call an action the deployed function does not know).
     files: docs/ops/EF_DEPLOY_MANIFEST.md, EXECUTION_LOG.md
  [A11] (low risk, new) Update the docs the owner reads
     `docs/ops/WORKLOAD_NATIVE_SOURCE.md` §3b and §5 step 2 both state that a swap needs a `workload_plan` KEY MIGRATION. The built solution deliberately does not migrate keys — it resolves aliases. Correct §3b, mark §6.1 (row identity → native `del_…`) and §6.2 (`url` → SyncView deep link, Linear chip removed) as DECIDED by the shipped code, and record steps 1-5 as done. Append (never rewrite) to `docs/ops/OPEN_REPAIRS.md`: item 95 closed by measurement, item 160 closed via option 3 (the full cutover), item 72 closed (status/assignee/population now native). Check for duplicate `## N.` headers after the merge.
     files: docs/ops/WORKLOAD_NATIVE_SOURCE.md, docs/ops/OPEN_REPAIRS.md, migrations/README.md

FILES YOU OWN (touch nothing else)
  index.html — the Workload block only: main lines ~13960-14600 (constants, wlState, `_wlV2*`, `_wlV2MapRow`, the `?wlnative=1` diff harness, realtime, `loadLinearIssues`), ~14580-15400 (`_wlPendingNativeDueReceipt*`, metadata readers, `wlNativeMetadataRow`, `wlMetadataTeamBucket`), ~15300-16800 (`wlLoadSnapshot`, `initWorkloadView`, `wlRefetchSilent`, `wlManualRefresh`, `wlApplyData`), ~17770-18500 (`wlSortSubIssues`, editor roster, `renderEditorWorkload`), ~18700-19900 (`wlLooseParentInfo`, loose strips, popover, `wlFetchTweakComments`, `wlRenderTweakComments`). NOT lines 22300-22600 (staff identity/capability), NOT 40000+ (calendar), NOT 48600+ (Production tab).
  migrations/2026-09-02-workload-native-view.sql (apply only; no edit expected)
  migrations/2026-09-05-workload-native-membership.sql (lift + the A3 label-completeness fix)
  supabase/functions/workload-plan/index.ts
  supabase/functions/workload-plan/native-snapshot.mjs
  test/workload-native-membership.js
  test/workload-native-postgres.js
  test/workload-native-view-contract.js
  test/workload-native-source-diff.js
  test/workload-native-visibility.js
  test/workload-plan-source.js
  test/workload-plan-failclosed.js
  test/workload-syncview-links.js
  test/workload-tweak-exclusive-bucket.js
  test/workload-loose-strip-grouping.js
  test/workload-overdue-ruling.js
  test/workload-history-integrated.js
  test/workload-capacity-placement.js
  test/workload-duplicate-not-active.js
  test/workload-excluded-reported.js
  test/f40-workload-readiness-source.js
  scripts/f40-workload-readiness.js
  qa/workload-native/browser.js
  qa/workload-native/handler.mjs
  qa/workload-native/integrated-handler.mjs
  docs/ops/WORKLOAD_NATIVE_SOURCE.md

LIVE ACTIONS THE OWNER MUST TAKE (prepare them exactly; never execute them)
  - [migration] Apply `migrations/2026-09-02-workload-native-view.sql` in the Supabase SQL editor. Creates one read-only view, grants select to anon+authenticated, prints a row census. Writes nothing, drops nothing, re-runnable. NOTE: it is on origin/main and has never been applied — it is not one of the 15 candida
    undo: `drop view if exists public.workload_issues_native_v1;` — nothing reads it until the browser cutover ships.
  - [migration] Apply the amended `migrations/2026-09-05-workload-native-membership.sql`. Creates three SECURITY DEFINER functions, service_role execute only, revoked from public/anon/authenticated. No table, row, flag or grant on existing objects changes. Must run AFTER the view.
    undo: `drop function if exists public.workload_native_snapshot_v1(); drop function if exists public.workload_native_plan_target_v1(text); drop function if exists public.workload_native_plan_set_v1(text,text,text,date,text,text);` — safe while the deployed 
  - [edge-function-deploy] Deploy the `workload-plan` Edge Function from an exact reviewed SHA with `--no-verify-jwt` and a fingerprint readback. EF_DEPLOY_MANIFEST.md:58 records NO CI DEPLOY PATH — DELIBERATE-MANUAL. Capture the currently deployed closure before deploying.
    undo: Redeploy the captured prior closure (live v2 was deployed from `fd3e0eaa` on 2026-07-20). The new handler is backward compatible: `action:"list"` still answers, and `legacyPlanAliases` emits both the native and the Linear key so an older browser bund
  - [n8n-edit] NONE required in n8n for this lane. `linear-issues` and `linear-tweak-comments` simply stop being called by the browser; leaving both workflows running costs nothing and preserves a manual read while the cutover is observed. Retiring them is a separate, later, owner-authorized action.
    undo: N/A — no edit is made. Do not disable either workflow before the board has been observed native for a full working day.
  - [runtime-flag] Flip `WL_V2_REALTIME` to true and repoint the channel. This ships in index.html, so a push to `main` auto-deploys it to syncview.synchrosocial.com.
    undo: One-line revert and push; the 60s poll (or its longer replacement) keeps the board fresh with realtime off.

RISKS
  - THE BOARD FAILS TOTALLY ON THE FIRST POST CREATED AFTER THE CUTOFF. `wlFetchNativeSnapshot` throws `Native Workload deadlines or weights are incomplete.` if any live native sub-issue has `workload_labels_complete !== true`, and that flag is `producti
    mitigate: Work item A3, and treat it as the release gate: emit `workload_labels_complete: true` with an empty label array when the row provably has no provider label state, AND degrade the single row through the existing `unavailableIssueIds`/`partialFailure` 
  - There is no fallback after the cutover, and the cold-start cache silently stopped being written. `wlAdoptLinearMetadata` is called with `{skipIssueCacheWrite:true}` on the native path and `wlFetchNativeSnapshot` never calls `wlWriteCache`, yet `wlRea
    mitigate: A6 — decide explicitly: re-enable the cache write on the native path, or delete the read and make the empty state honest. Do not ship it half-wired. Independently, deploy workload-plan before the browser change and canary it with one staff account.
  - Native assignee eligibility silently hides work. `native_assignee_eligible = tm.active and tm.team = d.team and tm.role = 'editor'|'designer'` replaces a name allowlist under which graphics designers previously passed with no allowlist at all. An ass
    mitigate: A8 — count the affected rows against live data before cutover and get an owner ruling. The candidate also removed the console lines that named the dropped clients and editors (correctly, for a public repo) — replace them with counts that are still ac
  - A permanent, unclearable warning banner. The snapshot's legacy arm still emits `workload_issues` rows with `team_key` not in (VID, GRA) — the view header records 8 such parent rows on Linear teams CON and STR — so `legacy_teams` is never empty and `w
    mitigate: A9 plus an owner decision: those 8 are parents with no sub-issues and render nothing today. Drop the legacy arm's `team_key not in ('VID','GRA')` clause once `workload_issues` stops refreshing, or scope the banner to teams that actually carry sub-iss
  - A Linear column stays load-bearing after the exit. The view answers `assignee_id = coalesce(tm.linear_user_id, d.assignee_id::text)` on purpose, because `WL_VIDEO_EDITORS` (index.html:15861-15865) seeds the freest-first roster with three ids the view
    mitigate: Verify the three ids against `team_members` before cutover (I could not — read-only, no DB). If they are `linear_user_id`, either re-seed `WL_VIDEO_EDITORS` with `team_members.id` and drop the coalesce, or accept `linear_user_id` as an opaque groupin
  - Full-snapshot polling cost. The candidate replaced the cheap one-row `synced_at` watermark with an unconditional `wlRefetchSilent()` every 60s, and each of those is a workload-plan POST that reads ~2000 view rows plus every `workload_plan` row under 
    mitigate: A5 — turn realtime on and lengthen the poll to a 5-10 minute safety net. Measure the snapshot response time on live data before the cutover; `WL_PLAN_READ_TIMEOUT_MS` is 8000ms and the whole board fails if the snapshot exceeds it.
  - index.html collision. Every lane edits this one file, and lane A touches roughly 500 lines across eight regions of it.
    mitigate: Lift by named function, not by file or by whole hunk range. Merge lane A before or after the other index.html lanes, never concurrently. Do not merge anything between handing the owner a deploy SHA and their dispatch.
  - Tweak feedback may be empty for rows whose Linear comments were never ingested. `linear-inbound` writes Linear comments into `production_comments` (index.ts:548, 1186), but I have not verified backfill completeness for the currently-tweak rows.
    mitigate: Before cutover, spot-check `production_comments` for the live Tweak Needed deliverables against what the `linear-tweak-comments` webhook returns today. The candidate's empty-state copy is already honest ("No feedback is available here. Open the post 

TESTS
  EXISTING, lift as-is: `qa/workload-native/handler.mjs` + `qa/workload-native/integrated-handler.mjs` — runs the REAL workload-plan request handler against a disposable loopback PG16 with only the Deno/Supabase transports replaced, and hard-fails on any RPC outside `workload_native_snapshot_v1` / `workload_native_plan_target_v1` / `workload_native_plan_set_v1` (`throw Error('unapproved_rpc')`).
  EXISTING, lift as-is: `qa/workload-native/browser.js` — full unmodified index.html in Chromium via Playwright, only network/storage/time fixtured.
  EXISTING, lift then AMEND: `test/workload-native-membership.js` — extracts the real `wlFetchNativeSnapshot` / `wlLoadSnapshot` / `wlRefetchSilent` / `wlFetchTweakComments` into an isolated vm realm, asserts a failed native read preserves the visible old board and never retries through a provider, asserts native feedback makes exactly one call ending `/production-comments`, and carries an exact-baseline negative control (`git show 99d31c81…:index.html`) proving the OLD `loadLinearIssues(true)` entered the n8n transport. AMEND: its mutation list pins `workload_labels_complete=false` → whole-snapshot rejection, which is the A3 outage. Replace with: that row degrades and every other row still renders.
  EXISTING, opt-in: `test/workload-native-postgres.js` — applies `2026-07-05-b0`, `2026-07-06-b1`, `2026-07-19-workload-plan.sql`, the native view and the membership migration to a fresh disposable database. Gated on `WORKLOAD_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY` + absolute `WORKLOAD_TEST_PSQL` + a loopback port. Run it in this lane rather than skipping — it is the only thing that executes the plan-alias SQL.
  EXISTING on main, keep green: `test/workload-native-view-contract.js` — pins the view's status display names against `STATUS_NAMES` in `supabase/functions/linear-outbound/mapping.mjs`, the workflow types against the 2026-09-02 live census, the `native_sort_key` naming, `security_barrier`, and that the migration writes/drops nothing. Source-pattern only, not a DB run.
  EXISTING, re-pin: `test/workload-syncview-links.js` (it EXECUTES the header-link resolution across single-video / multi-video / parent-missing / nothing-resolves; the candidate adds the `?prod=1&batch=` and `nativeId` cases), `test/workload-tweak-exclusive-bucket.js`, `test/workload-loose-strip-grouping.js`, `test/workload-overdue-ruling.js`, `test/workload-plan-source.js`, `test/workload-plan-failclosed.js`.
  NEW NEEDED 1 — the A3 regression guard: a snapshot fixture containing a live native sub-issue with `linear_issue_uuid: null` and `linear_raw: {attribution:{}}` must render at weight 1x and must NOT reject the snapshot. This is the exact shape of every deliverable created after 15 Sept.
  NEW NEEDED 2 — realtime: `WL_V2_REALTIME === true` and the channel's `postgres_changes` table set is exactly `{deliverables, batches}`; a synthetic change event triggers one debounced `wlRefetchSilent` and no `workload_issues` read.
  NEW NEEDED 3 — no-provider closure sweep: assert that the Workload block of index.html contains no reachable reference to `LINEAR_ISSUES_WEBHOOK`, `LINEAR_TWEAK_COMMENTS_WEBHOOK` or `WORKLOAD_LINEAR_URL` after A9. A grep-style source guard, in the style `test/workload-linear-source.js` already uses.
  NEW NEEDED 4 — plan-key continuity: a `workload_plan` row keyed on a Linear uuid, whose deliverable is now identified natively, projects as `issue_id = del_…` / `storage_issue_id = <uuid>` and a re-drag updates that same storage row. Partly covered by `workload_native_plan_set_v1`'s own `workload_plan_alias_conflict` path in `test/workload-native-postgres.js`; needs the browser half.
  CONTEXT: `npm test` is the full suite and takes several minutes. `npm run test:prod-polish` cannot pass in this sandbox — all 8 lanes fail identically on origin/main — so verify against main before calling anything a regression.


=== ADVERSARIAL REVIEW OF YOUR OWN BRIEF — READ THIS TWICE ===
A second agent tried to prove the brief above wrong. It found the following. Where the review disagrees with the brief, THE REVIEW WINS.

CLAIMS THAT ARE WRONG:
  ! already_built #1: `migrations/2026-09-02-workload-native-view.sql` ... 'It is on ORIGIN/MAIN, not on the candidate.'
    why: `git ls-tree origin/main migrations/2026-09-02-workload-native-view.sql` and `git ls-tree 5bcc03bd7d... migrations/2026-09-02-workload-native-view.sql` both return blob `386b9b8f079684e7a129128082f1ef4e834671e0`. It is byte-identical on BOTH refs. Everything else in that entry is confirmed: 376 lines, status CASE cover
    truth: The file is on origin/main AND on the candidate, same blob. Still unapplied (no EXECUTION_LOG entry; migrations/README.md:614 describes it as pending). The A1 sequencing conclusion is unaffected.
  ! done_when #6 and A7: "OPEN_REPAIRS item 95's 40 rows: `window.wlNativeDiff()` reports them under `nativeOnly`" / "Expect item 95's 40 rows under `nativeOnly`."
    why: docs/ops/OPEN_REPAIRS.md:6733-6741 measures 195 live deliverables absent from `workload_issues`, decomposed as 116 TEST client (`sidneylaruel`), 39 on one former off-roster client, and 40 active-roster. `_wlNativeDiffReport` (index.html:14329-14392) applies NO client filter — it keys purely on `linear_id` presence — so
    truth: Acceptance is `nativeOnly.count ≈ 195`, of which the 40 active-roster rows are the actionable subset; the harness cannot separate them, so the 40 must be re-derived by joining against the client roster. A session told to expect 40 will read ~195 and treat a working harness as broken.
  ! A3 detail: "Native intake writes `linear_raw: { attribution: … }` only (production-write index.ts:6069, 6657) ... So after outbound stops, EVERY new deliverable has `workload_labels_complete = false`."
    why: `handleProductionCreate` (supabase/functions/production-write/index.ts:3523) builds `linearIssue.labels = { nodes: selectedLabels, pageInfo: { hasNextPage: false, endCursor: null } }` at index.ts:3663-3667 and writes `linear_raw: { issue: linearIssue, attribution }` at index.ts:3689. `production_workload_label_projecti
    truth: The rows that are attribution-only are the INTAKE paths: `handleIntakeCreate` (index.ts:6160, write at 6657, with the comment "No Linear issue exists yet; `linear-outbound` adds `issue` alongside this on drain") and `handleComponentFill` (index.ts:5949, write at 6069). Those are the volume path for new posts, so A3 is 
  ! corrections_to_context #5: "Workload's only remaining Linear-touching server call is the `workload-linear` LABEL METADATA read — and the candidate replaces that with `native_metadata.workload_labels`."
    why: On origin/main, `wlFetchLinearMetadata` (index.html:14998-15040) reads `wlFetchProductionAuthority()` and partitions active ids: `if (authority[team] === 'syncview') nativeIds.push(...)` else `linearIds.push(...)`, then `Promise.allSettled([wlFetchForeignLinearMetadata(linearIds), wlFetchNativeMetadata(nativeIds)])`. W
    truth: The label/deadline metadata read is ALREADY native on main. What the candidate actually changes is (a) it folds that read into the snapshot RPC, and (b) it replaces main's per-row degradation with a hard throw. That reframes A3: it is not a defect the candidate inherits, it is a REGRESSION the candidate introduces agai
  ! live_actions_needed (workload-plan deploy) reversible_how: "The new handler is backward compatible: `action:\"list\"` still answers."
    why: On the candidate, `listPlans` is defined at supabase/functions/workload-plan/index.ts:137 and is never called — `grep -n "listPlans"` on the candidate blob returns only the definition. The dispatcher is `if (action === "list" || action === "native_snapshot") { requireListStaff(req); const snapshot = await nativeSnapsho
    truth: `action:"list"` is NOT independent any more. Deploying the new function before A1 makes the CURRENTLY-SHIPPED browser lose its plan days (503 `workload_snapshot_unavailable`), and after A1 any single condition that fails the snapshot — `workload_population_incomplete` on a duplicate/blank id, `workload_plan_alias_ambig
  ! corrections_to_context #2: "`docs/ops/WORKLOAD_NATIVE_SOURCE.md` §3b says the identity change 'needs a key migration (or a compatibility mapping) AND a validation-source change in the gateway'. The built solution takes the compatibility-mapping branch..." — pr
    why: docs/ops/WORKLOAD_NATIVE_SOURCE.md:117 reads "So the identity change needs a key migration (or a compatibility mapping) **and** a validation-source change in the gateway." The doc already sanctions the compatibility-mapping branch; there is nothing to correct there. Line 236 (§5 step 2) is the one that asserts "repair 
    truth: Only §5 step 2 (line 236) needs correcting. §3b (line 117) is already right and should be left alone; A11's instruction to "Correct §3b" will produce a wrong edit to a correct doc.

WORK THE BRIEF MISSED:
  + The TEST client and the off-roster client flood the live board at cutover — the client half of A8 is missing
    why: `wlIsAllowedClient` (index.html:15952) tests membership in `WL_CLIENT_NAMES` (index.html:15913-15935). The candidate replaces it with `wlIssueClientAllowed` → `native_client_active`, computed in the RPC as `c.active` from `left join public.clients c on c.slug=n.client_slug`. That is the ONLY client gate on the native p
    files: index.html, migrations/2026-09-05-workload-native-membership.sql, docs/ops/OPEN_REPAIRS.md
  + OPEN_REPAIRS item 162 — every readable task name is minted by Linear, and it names Workload rows as an open surface
    why: Item 162 is the HEAD commit of this repo (`8483498 Ledger 162`) and the brief never cites it. `deliverables.linear_identifier` has exactly one writer, `supabase/functions/linear-inbound/index.ts:810`, reachable only from a Linear webhook. The native view answers `coalesce(d.linear_identifier, d.identifier) as identifie
    files: docs/ops/OPEN_REPAIRS.md, migrations/2026-09-02-workload-native-view.sql, migrations/2026-09-07-native-intake-named-append.sql, index.html
  + `test/workload-linear-browser.js` and `test/workload-linear-source.js` are lane-A files and appear nowhere in the brief
    why: `git diff --stat origin/main...5bcc03bd -- test/` shows `test/workload-linear-browser.js | 290 +++---` and `test/workload-linear-source.js | 10 +-`. workload-linear-browser.js is the largest Workload browser suite: it `extract()`s real functions out of index.html (its extractor at line 15-16 was changed on the candidat
    files: test/workload-linear-browser.js, test/workload-linear-source.js, test/workload-native-adapter.js, test/workload-native-capture.js, test/workload-today-formatter-hoisted.js, qa/workload-consistency/compare.js
  + 2x/3x Workload weighting stops being settable at the cutover, and A3(a) silently makes that permanent
    why: A3(a) proposes emitting `workload_labels_complete: true` with `workload_labels = '[]'` for rows with no provider label state. That is the right fix for the outage, but it means every post-cutoff deliverable is pinned at weight 1x forever — `wlNativeWorkloadLabel` (cand index.html:14886-14900) only ever returns a weight
    files: migrations/2026-09-05-workload-native-membership.sql, migrations/2026-09-06-native-label-writes.sql, supabase/functions/production-write/index.ts, index.html
  + The Tweak popover loses its cache and adds a durable audit write per read
    why: The candidate's `wlFetchTweakComments` (cand index.html:19464-19521) never reads or writes `_wlTweakCommentsCache` — that Map is now used only by `_wlLegacyFetchTweakComments`. So every popover open re-pages the full comment thread for every Tweak Needed sub-issue in that parent group, sequentially, with no TTL. Each c
    files: index.html, supabase/functions/production-comments/index.ts
  + `window.wlDebug` reads a cache the native path never fills
    why: A6 correctly identifies that `wlWriteCache` is only called from `_wlLegacyLoadLinearIssues` (cand index.html:14678, 14699) and from `wlAdoptLinearMetadata` behind `!options.skipIssueCacheWrite` (cand index.html:15314-15316), while the native path always passes `{skipIssueCacheWrite:true}` (cand index.html:15457). It na
    files: index.html

OPEN QUESTIONS — answer from the code if you can; escalate to the coordinator only if a wrong guess is expensive
  ? Confirm on live data that `production_deliverables_browser_v1.workload_labels_complete` is false for a deliverable whose `linear_raw` carries only `{attribution:…}`. I read the SQL (production_workload_label_projection returns complete:false for a non-object `
  ? Are the three ids in `WL_VIDEO_EDITORS` (index.html:15861-15865) `team_members.linear_user_id` values or `team_members.id` values? The view's header asserts the former, "raised by review on #1222 and verified". I could not verify. The whole capacity/grouping k
  ? How many rows currently visible on the board would `native_assignee_eligible` drop? Not measured anywhere I could find, including `docs/audits/2026-09-05-native-assignee-eligibility.md`, which reports only local disposable-Postgres journeys.
  ? Are the Linear comments behind today's Tweak Needed popovers all present in `production_comments`? If linear-inbound only ingested from the day it went live, older tweak feedback may be missing and the popover will render its empty state.
  ? Owner: should the snapshot's legacy `union all` arm (CON/STR and null-team `workload_issues` rows) be deleted outright at cutover? Keeping it means a permanent banner and a dependency on a table nobody rebuilds.
  ? Owner: §6.2 (`url` after Linear) — the candidate answers it by setting `issue.url = ''` on native rows, which removes the Linear ↗ chip everywhere on the board and leaves `?prod=1&d=<del_…>` / `?prod=1&batch=<bat_…>` as the only link out. Confirm that is what 
  ? Does `production-comments` need a redeploy for lane A? I believe not — origin/main's deployed version already returns the exact contract the popover consumes — but if lane D redeploys it with `feedback.mjs` / media projection, lane A's call site must be re-ver
  ? `native_sort_key`: for a never-mirrored native deliverable both `linear_identifier` and `identifier` can be null (native creation writes `identifier` null per OPEN_REPAIRS item 161), so `wlSortSubIssues` falls all the way through to `id.localeCompare` for sub-


IF THIS LANE IS NOT FINISHED BY 2026-09-15, THIS BREAKS:
"On 15 September the Workload board goes blank and stays blank. `public.workload_issues` is rebuilt entirely from a Linear query by an n8n reconcile — nothing else writes it — so the moment Linear access ends the table stops refreshing and then decays: every editor's day and week view, the freest-editor capacity panel, the Overdue / In progress / Tweaks-needed queues, the team workload matrix, the plan-day drag, and the Tweak Needed feedback popover all read from it or from the `linear-tweak-comments` webhook. Staff lose the single page they use to know what they owe today; SMM/Admin lose the ability to plan work days at all. It also freezes two known live defects permanently: OPEN_REPAIRS item 95's 40 deliverables across 10 active-roster clients stay invisible, and item 160's 12 rows keep showing a different status on Workload than on SyncLinear. Clients are not directly affected — Workload is a staff surface — but the work that does not get scheduled is client work."


START BY: reading docs/independence/LINEAR_EXIT_LANES.md on origin/main (the lane map and the index.html region ownership table), then OPEN_REPAIRS items 162-168. Then confirm for yourself that the 'already built' artifacts above really exist before you plan anything around them.
