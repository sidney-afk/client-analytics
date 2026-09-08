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

---

SESSION NAME: LX-B Write path
KEEP THIS EXACT SESSION TITLE. Do not rename it. The owner tracks six parallel sessions by title.

SESSION NAME: LX-B Write path
Keep this exact session title. Do not rename it. The owner tracks parallel sessions by title.

You are ONE of six parallel sessions removing Linear from SyncView before Linear
access ends on 2026-09-15. Today is 2026-09-07. A coordinator session owns merge
order and the ledger; you own exactly one lane and nothing else.

YOUR BRANCH: claude/lx-b-write-path   (create it from origin/main, push there, never elsewhere)

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
Push, open a DRAFT PR titled `LX-B: <what it does>`, and in the body state:
  - what is done and proven, with the test names
  - what is NOT done
  - every live action the owner must take (migration, deploy, flag, n8n edit),
    each with its exact undo
  - anything you found that belongs to another lane
Then stop. Do not merge. Do not start another lane's work.


=== YOUR LANE: B ===
BRANCH: claude/lx-b-write-path
MERGE POSITION: 2nd, right after the monitoring split. You are the base that lanes C and G-folded-into-B rebase onto.

GOAL
After this lane, no code path in `supabase/functions/production-write/index.ts` that a staff or public caller can actually reach makes an HTTP request to `https://api.linear.app/graphql`, and Create Post / Submit / assignee / label writes all commit natively with terminal (`skipped`) outbox receipts.

DONE WHEN
  - `grep -n 'api.linear.app\|LINEAR_URL' supabase/functions/production-write/index.ts` on the deployed SHA shows every remaining call site is either (a) unreachable behind an unconditional throw, or (b) guarded by a server-resolved epoch/flag that is set to native.
  - `production_native_intake_epochs()` returns a non-empty epoch for BOTH `video` and `graphics`, so `intakeEpochs` -> `projectForIntake` / `parentRouteForAppend` / `assertEligibleAssignee` all take the native early-return (candidate index.ts lines 2537, 2718, 2728, 2846/2852).
  - `production_label_catalog_capability()` returns `{schema_version:1, mode:"native", version_id:<uuid>}` for both teams and an attested catalog version exists in `production_label_catalog_versions`, so `handleLabelsRead` and the `labels` operation never call `linearLabelSnapshot`.
  - `production_assignment_epoch('video')` and `('graphics')` return non-empty, so `handleAssigneeOptions` -> `existingAssignmentOptions` and the `assignee` operation never call `assigneeProviderPool`.
  - A Create Post (calendar surface, new batch AND append-to-latest) and a Submit both succeed end to end with outbound network to api.linear.app blocked, producing `mirror_outbox` rows with `status='skipped'` and `linear_result.native_only=true`.
  - Named posts still work: an append produces `Video N — <name>` / `Thumbnail N — <name>` and the NEXT append allocates ordinal N+1 (this is the exact regression the composed migration exists to prevent).
  - `node scripts/ef-fingerprint.js <main-tip> --slugs=linear-outbound,production-write,deliverable-write,batch-write --expected-only` matches the four `*_SOURCE_SHA256` / `*_FILE_COUNT` pins in `.github/workflows/deploy-f27-section4-closures.yml`, and `node test/f27-section4-deploy-lane.js` passes.
  - A Section 4 dispatch of https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml completes green with `production-write` at the new digest.

ALREADY BUILT — LIFT THESE, DO NOT REBUILD
  * The whole native-epoch gating of the intake path in production-write: `intakeEpochs()` (server-only epoch resolution via `production_intake_epoch_read`), `intakeEpochPayload()`, `providerDrainPlans()`, and the three native early-returns in `parentRouteForAppend` (`if (nativeEpoch) return {parent_linear_issue_id:null, depends_on_id:null, dependency_dedup_key:null}`), `projectForIntake` (`if (nativeEpoch) return tagged[0]` / `return projectId`), and `assigneeEligibilityContext` -> `assigneeLanePolicyFor`.
    where: 5bcc03bd7d286f437ad51d4cc86a5ce80b7b63ea:supabase/functions/production-write/index.ts lines 2686-2707 (intakeEpochs/intakeEpochPayload), 2535-2537, 2710-2736, 2807-2856
    confirmed: git show 5bcc03bd...:supabase/functions/production-write/index.ts | sed -n '2525,2560p;2660,2760p;2770,2900p' — read the actual bodies, not the names
    lift: Lift `supabase/functions/production-write/index.ts` and `policy.mjs` from the candidate. If you do NOT want the brief-media lane entangled, delete line 18 `import { projectBriefMedia } from "../_shared/native-brief-media.mjs";` and its single use at line 5306 — that keeps PRODUCTION_WRITE_FILE_COUNT at 5 instead of 6.
  * `assigneeLanePolicy` / `assigneeLaneFor` / `nativeIntakePool` / `nativeAssigneeCatalogReadiness` in policy.mjs — the native assignee eligibility contract that drops the `linear_user_id` mapping requirement while keeping active/team/role checks.
    where: 5bcc03bd...:supabase/functions/production-write/policy.mjs, +170 lines after `eligibleAssigneeProjection`
    confirmed: git diff origin/main...5bcc03bd... -- supabase/functions/production-write/policy.mjs — read the full added block
    lift: Straight file lift; it is purely additive to policy.mjs and has no imports outside the file.
  * `handleIntakeEditorOptions` — a NEW `action: "intake_editor_options"` gateway endpoint that returns the Create Post video-editor picker from Postgres only (team_members + deliverables + production_deliverables_browser_v1), with `lane: "provider"` fallback when the epoch is empty. Replaces the browser's direct PostgREST read that filters `linear_user_id=not.is.null`.
    where: 5bcc03bd...:supabase/functions/production-write/index.ts lines 3648-3713, routed at line 8092; browser caller at 5bcc03bd...:index.html line 40942
    confirmed: git show 5bcc03bd...:supabase/functions/production-write/index.ts | sed -n '3640,3715p' and grep -n 'intake_editor_options' on the candidate index.html
    lift: Comes with the index.ts lift; the browser half needs the matching index.html hunk (candidate index.html ~40942 + error taxonomy entry at 27283).
  * `migrations/2026-09-07-native-intake-named-append.sql` — the composed append RPC that has BOTH native routing and v8's named-title tolerance. Marked SOURCE_ONLY with an explicit `do $$ ... raise exception 'native_intake_named_append_prerequisite_missing'` guard requiring `production_native_intake_epochs()` and the `zz_native_intake_receipt_guard` trigger.
    where: 5bcc03bd...:migrations/2026-09-07-native-intake-named-append.sql (390 lines)
    confirmed: git show 5bcc03bd...:migrations/2026-09-07-native-intake-named-append.sql | head -120 — read the prerequisite DO block and the function signature
    lift: File lift. Do NOT apply it standalone against a target that lacks native-only-intake; the DO block will refuse.
  * `scripts/native-intake-named-append-compose.js` — builds ONE atomic SQL artifact from `2026-09-05-native-only-intake.sql` + `2026-09-07-native-intake-named-append.sql` by stripping the first file's COMMIT and the second's BEGIN, prepending `\set ON_ERROR_STOP on`, and asserting exactly one outer transaction. This is the answer to the 'interim old body' hazard.
    where: 5bcc03bd...:scripts/native-intake-named-append-compose.js
    confirmed: I EXECUTED it: extracted candidate scripts/ + migrations/ into the scratchpad and ran fromRepository(). It reproduced native_sha256=3c0cac06..., hybrid_sha256=2b26c56f..., composed_sha256=2571a909971f2bc52ef270400b7666c2b529d36ab4f6a56044f00d1b2ecf61ec, outer_transactions=1, 66659 bytes — byte-ident
    lift: File lift plus its dependency `scripts/track-b-recovery-package.js` (already on main). It never executes SQL; it returns {sql, manifest}. The owner/operator pastes the returned sql.
  * `migrations/2026-09-06-native-label-writes.sql` — `production_label_catalog_capability()`, `production_label_catalog_read_attested()`, `production_labels_write()`, plus outbox receipt/truncate guards; and the gateway's `nativeLabelCatalogConfig()` / `readNativeLabelCatalog()` / `verifiedNativeCatalog()` with a provider/native/hold three-way and a pre-install compatibility path that requires BOTH an absent RPC (42883/PGRST202) AND an exactly-absent flag row.
    where: 5bcc03bd...:migrations/2026-09-06-native-label-writes.sql; 5bcc03bd...:supabase/functions/production-write/index.ts lines 863-943 and the `labels` branch at 6124-6140, handleLabelsRead at 5330-5343
    confirmed: git show of both files; read nativeLabelCatalogConfig's error handling and the mode==='native' branch that calls production_labels_write instead of linearLabelSnapshot
    lift: File lifts. BUT the SQL is inert without a staged+attested catalog version — see work item B7; this is the piece of lane B that is NOT actually finished.
  * `migrations/2026-09-06-native-existing-assignment.sql` + gateway `existingAssignmentContext` / `existingAssignmentOptions` — assignee writes on existing cards on a `native_assignment_epochs` lane with `production_assignee_write`, bypassing `assigneeProviderPool`.
    where: 5bcc03bd...:migrations/2026-09-06-native-existing-assignment.sql; index.ts lines 2946-2975, 3785-3789, 6337-6341
    confirmed: git show of the migration DDL list and index.ts 2940-3020; the flag seeds as mode:provider so it is disabled by default
    lift: File lift; ships with test/native-existing-assignment.js and test/native-existing-assignment-preinstall.js.
  * main's `migrations/2026-09-07-production-intake-append-v8.sql` (the post-name v8 migration) is IDENTICAL on main and on the candidate — the candidate branched from 7071549 'Name the batch and name each post from Create Post', which already contains it.
    where: origin/main and 5bcc03bd..., migrations/2026-09-07-production-intake-append-v8.sql
    confirmed: git diff --name-only origin/main...5bcc03bd... | grep append → returns only the native-* files, no v8; and git diff origin/main 5bcc03bd... -- migrations/2026-09-07-production-intake-append-v8.sql is empty
    lift: Nothing to lift — it is already on main. It is NOT yet applied to the live database (EXECUTION_LOG.md:6270 'SOURCE ONLY, not yet applied').
  * main's production-write is ALREADY re-pinned and awaiting a Section 4 dispatch. PRODUCTION_WRITE_SOURCE_SHA256=ccbdd136... in the workflow exactly equals the computed closure of main's tip.
    where: .github/workflows/deploy-f27-section4-closures.yml:284; origin/main tip d2495eb
    confirmed: I ran: node scripts/ef-fingerprint.js $(git rev-parse origin/main) --slugs=production-write,linear-outbound,batch-write,deliverable-write --expected-only → production-write ccbdd136f488... files=5, matching the workflow pin exactly (all four match)
    lift: N/A — this is state, and it means main is dispatch-ready today. Any lane-B re-pin supersedes it, so lane B's deploy also ships the naming release.

WORK ITEMS
  [B1] (medium risk, lift) Lift the native-epoch gateway (production-write index.ts + policy.mjs)
     Take the candidate's supabase/functions/production-write/index.ts and policy.mjs. Decide up front whether to keep the `../_shared/native-brief-media.mjs` import (line 18, one use at 5306): keeping it makes PRODUCTION_WRITE_FILE_COUNT 6 and couples lane B to the brief-media lane; deleting both lines keeps it at 5 and keeps the two lanes independent. The candidate's index.ts is a superset of main's — it carries the intake epoch plumbing, handleIntakeEditorOptions, the native label three-way, and existing-assignment. It also carries changes belonging to other lanes (legacy_intake_receive / legacy_intake_triage_list actions at 7972/8003, native comment/card media) — audit those before shipping s
     files: supabase/functions/production-write/index.ts, supabase/functions/production-write/policy.mjs
  [B2] (high risk, lift) Lift the browser half of Create Post (editor picker + label catalog_version)
     index.html on the candidate adds: `action: 'intake_editor_options'` (line 40942) replacing the direct PostgREST read at main index.html:40556 that filters `linear_user_id=not.is.null`; an `intake_editor_options_unavailable` entry in the failure taxonomy (line 27283); and `catalog_version` plumbing for labels (50833 read, 55710 send). This is a collision-heavy file — coordinate the hunks, do not lift index.html wholesale.
     files: index.html
  [B3] (low risk, mixed) Fix the two error strings that will lie to staff on Sept 15
     index.html:41370 maps anything matching /project|mapping|parent/ to "This client's Video and Graphics filing must be configured before a post can be created." — `project_mapping_validation_unavailable` and `batch_parent_validation_unavailable` both hit it, so a dead Linear reads as a client-configuration problem that no configuration can fix. And `assignee_provider_unavailable` falls through to the catch-all "safe to retry", which is false forever. Even if B1 lands, add explicit entries so a partial rollout or a stale browser says the true cause. This is cheap and it is the exact class of defect the file's own comments (41360-41400) were written about.
     files: index.html, test/create-post-error-names-the-cause.js
  [B4] (medium risk, lift) Lift the three intake migrations and the composer
     migrations/2026-09-05-native-intake-root-manifest.sql, migrations/2026-09-05-native-only-intake.sql, migrations/2026-09-07-native-intake-named-append.sql, scripts/native-intake-named-append-compose.js, test/native-intake-named-append.js, docs/ops/NATIVE_INTAKE_NAMED_APPEND.md, docs/audits/2026-09-07-native-named-append-evidence.json. All four SQL objects that get replaced (production_intake_root_begin, production_intake_append, production_component_fill) are `create or replace` on functions that already exist live; only production_intake_manifests and production_card_provenance are new tables.
     files: migrations/2026-09-05-native-intake-root-manifest.sql, migrations/2026-09-05-native-only-intake.sql, migrations/2026-09-07-native-intake-named-append.sql, scripts/native-intake-named-append-compose.js, test/native-intake-named-append.js, docs/ops/NATIVE_INTAKE_NAMED_APPEND.md
  [B5] (low risk, lift) Produce and review the composed atomic SQL artifact
     Run `node -e "console.log(require('./scripts/native-intake-named-append-compose.js').fromRepository().sql)"` and verify the manifest reports composed_sha256=2571a909971f2bc52ef270400b7666c2b529d36ab4f6a56044f00d1b2ecf61ec and outer_transactions=1. I reproduced these hashes locally from the candidate's files, so the builder is deterministic. Retain the artifact privately; it is 66659 bytes.
     files: scripts/native-intake-named-append-compose.js
  [B6] (medium risk, lift) Lift the existing-assignment migration and wire the assignee lane
     migrations/2026-09-06-native-existing-assignment.sql seeds native_assignment_epochs as mode:provider (disabled). The gateway side is already in B1's index.ts (existingAssignmentContext at ~2946, existingAssignmentOptions at ~2969, the epoch stamp at 6337-6341). Flipping the flag to a native epoch is the runtime action that actually stops `assigneeProviderPool` firing on the `assignee` operation and on `action: assignee_options`.
     files: migrations/2026-09-06-native-existing-assignment.sql, test/native-existing-assignment.js, test/native-existing-assignment-preinstall.js, docs/ops/NATIVE_EXISTING_ASSIGNMENT.md
  [B7] (high risk, mixed) CAPTURE THE LINEAR LABEL CATALOG BEFORE SEPT 15 — the one piece that is not built
     The two label migrations are lifted-ready, but `production_label_catalog_capability()` only returns mode:native when a version_id exists in production_label_catalog_versions, and the only way to create one is `production_label_catalog_stage_attested(uuid, manifest, attestation)`. NOTHING in the repo produces that manifest: `git ls-tree -r 5bcc03bd... | grep -i label` returns only migrations, docs, qa harnesses and tests — there is no export script. The manifest schema (validated by production_label_catalog_check_manifest, foundation migration line 40) demands archived-inclusive cursor-chain evidence, terminal page/count, distinct VIDEO/GRAPHICS team mapping, original UUIDs/name/color/descrip
     files: scripts/ (new label-catalog export script), migrations/2026-09-05-native-label-catalog-foundation.sql, migrations/2026-09-06-native-label-writes.sql
  [B8] (medium risk, mixed) STATE the deploy-lane pin you need. Do NOT edit the workflow.
     **This item was written wrong and is corrected here.** It used to tell this lane to bump the pins itself. `LINEAR_EXIT_LANES.md` §Single-writer resources says plainly: **no lane edits `.github/workflows/deploy-f27-section4-closures.yml`.** Three lanes need three different values, only one can be right, and a wrong pin burns an owner dispatch window rather than merely a merge. The coordinator computes the value on the ACTUAL merge commit and lands one re-pin commit (item 167). So: state in your PR body that PRODUCTION_WRITE_SOURCE_SHA256 needs regenerating for `production-write` (and that PRODUCTION_WRITE_FILE_COUNT moves to '6' only if you kept the brief-media import), and stop there. For reference only, the command the coordinator will run is `node scripts/ef-fingerprint.js <sha> --slugs=production-write --expected-only`; never hand-edit a digest. Say in the same breath that LINEAR_OUTBOUND_SOURCE_SHA256 must be LEFT at 1489a4c2...: the candidate bumps it to 43329cdf... for the outbound-cutoff lane and this lane must not drag that in. The lane redeploys all four functions regardless, so an unchanged pin just redeploys byte-identical bytes. test/f27-section4-deploy-lane.js runs ef-fingerprint against the repo and asserts the workflow pins match (line ~595 `currentCandidatesMatch`), and asserts docs/ops/EF
     files: NONE THAT YOU EDIT. The coordinator owns .github/workflows/deploy-f27-section4-closures.yml and test/f27-section4-deploy-lane.js. docs/ops/EF_DEPLOY_MANIFEST.md is regenerated with `node scripts/ef-deploy-manifest.js`, never hand-edited.
  [B9] (medium risk, new) Decide what to do with the two residual reachable Linear calls
     Two paths in production-write remain unconditionally provider even in the candidate. (1) `handleCreateOptions` (action `create_options`, router line 7197 on main / 8081-region on the candidate) calls `linearLabelCatalog(scope.teamId, scope.team)` with NO gate — the candidate's version is byte-identical to main's. It is browser-unreachable today because `_prodCreateGateText` returns PROD_CREATE_CLOSED_TEXT unconditionally (index.html:53293) and the gateway throws 403 production_create_closed (index.ts:3592), but the endpoint is live and any caller gets a 503 label_catalog_unavailable after Sept 15. docs/ops/NATIVE_LABEL_CATALOG_FOUNDATION.md explicitly says 'reachable create_options dependenc
     files: supabase/functions/production-write/index.ts

FILES YOU OWN (touch nothing else)
  supabase/functions/production-write/index.ts
  supabase/functions/production-write/policy.mjs
  migrations/2026-09-05-native-intake-root-manifest.sql
  migrations/2026-09-05-native-only-intake.sql
  migrations/2026-09-07-native-intake-named-append.sql
  migrations/2026-09-06-native-existing-assignment.sql
  migrations/2026-09-05-native-label-catalog-foundation.sql
  migrations/2026-09-06-native-label-writes.sql
  scripts/native-intake-named-append-compose.js
  docs/ops/NATIVE_INTAKE_NAMED_APPEND.md
  docs/ops/NATIVE_EXISTING_ASSIGNMENT.md
  docs/ops/NATIVE_LABEL_CATALOG_FOUNDATION.md
  docs/audits/2026-09-07-native-named-append-evidence.json
  test/native-intake-named-append.js
  test/native-existing-assignment.js
  test/native-existing-assignment-preinstall.js
  test/native-label-writes.js
  test/native-label-catalog-foundation.js
  test/native-assignee-eligibility.js
  test/native-assignee-policy.js
  test/native-assignee-catalog-dryrun.js
  test/native-intake-editor-projection.js
  test/native-intake-editor-browser.js
  test/native-intake-manifest.js
  NOT .github/workflows/deploy-f27-section4-closures.yml and NOT test/f27-section4-deploy-lane.js. Both are single-writer for the whole program and belong to the coordinator; see B8 and LINEAR_EXIT_LANES.md §Single-writer resources.
  docs/ops/EF_DEPLOY_MANIFEST.md (production-write closure row only, and only if file count moves; regenerate with `node scripts/ef-deploy-manifest.js`, never by hand)
  index.html (Create Post editor picker hunk ~40556/40942, failure taxonomy ~27283, _calNativePostErrorText ~41331-41400, labels catalog_version ~50833/55710 — SHARED FILE, coordinate)
  docs/ops/OPEN_REPAIRS.md (append only)

LIVE ACTIONS THE OWNER MUST TAKE (prepare them exactly; never execute them)
  - [migration] Apply migrations/2026-09-05-native-intake-root-manifest.sql to the live database (creates production_intake_manifests + production_intake_root_begin).
    undo: drop table public.production_intake_manifests; drop function public.production_intake_root_begin(jsonb,jsonb,jsonb). Safe ONLY while the table is empty — once a root intake is accepted, the manifest rows are the acceptance evidence and the migration 
  - [migration] Apply migrations/2026-09-07-production-intake-append-v8.sql (still SOURCE ONLY per EXECUTION_LOG.md:6270). Not a hard prerequisite of the composed artifact, but apply it first so that if the composed install aborts, the target still supports main's already-pinned naming gateway.
    undo: Re-apply migrations/2026-08-26-production-intake-append-v7.sql. Pure title-predicate widening; no table/column/index/policy/grant moves.
  - [migration] Apply the COMPOSED artifact from scripts/native-intake-named-append-compose.js (composed_sha256 2571a909971f2bc52ef270400b7666c2b529d36ab4f6a56044f00d1b2ecf61ec, 66659 bytes, one outer transaction) — this is native-only-intake and named-append together. Never apply 2026-09-05-native-only-intake.sql 
    undo: Not cleanly. Reverting means re-applying v8's append body, dropping trigger zz_native_intake_receipt_guard and functions production_native_intake_epochs / production_intake_epoch_read / production_native_intake_receipt_guard, and dropping production_
  - [migration] Apply migrations/2026-09-05-native-intake-reconcile.sql (server-owned completion of accepted native intake + production_card_provenance table and its two card-table triggers).
    undo: drop trigger zz_production_card_provenance on calendar_posts and on sample_reviews; drop the reconcile RPCs; drop table production_card_provenance. Append-only fact-recording triggers that never refuse or reorder a write, so dropping them loses histo
  - [migration] Apply migrations/2026-09-05-native-label-catalog-foundation.sql then migrations/2026-09-06-native-label-writes.sql (the second alters the first's table).
    undo: Both seed mode:provider and refuse to serve until a version is activated, so installed-but-provider is a genuine no-op state. Undo = drop the two triggers on mirror_outbox (zzz_native_label_receipt_guard, zzz_native_label_truncate_guard), the new RPC
  - [migration] Apply migrations/2026-09-06-native-existing-assignment.sql.
    undo: Seeds native_assignment_epochs as mode:provider for both teams, so it is inert on install. Undo = drop triggers zzz_native_assignment_receipt_guard / zzz_native_assignment_truncate_guard and the three functions. Once an epoch has been enabled and nat
  - [other] Owner runs the sealed four-function rollback capture on his Windows machine and uploads the named .sourcebundle to the SyncView Backups/ Shared Drive root BEFORE dispatching.
    undo: Read-only capture; nothing to undo. If the upload is skipped the dispatch fails in ~20s with OBJECT_MISSING, deploys nothing, and the fix is upload-then-Re-run jobs on the same run.
  - [edge-function-deploy] Dispatch https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml with operation=deploy-reviewed-release. Deploys all four of batch-write, deliverable-write, linear-outbound, production-write.
    undo: Same workflow, operation=restore-captured-prior-four, confirm=RESTORE_CAPTURED_F27_SECTION4_CLOSURES, using the same sealed bundle sha256/byte length. Both operations fail closed on a fingerprint mismatch.
  - [runtime-flag] Flip syncview_runtime_flags.native_intake_epochs to {"video":{"enabled":true,"epoch":"<id>"},"graphics":{"enabled":true,"epoch":"<id>"}} — this is the switch that actually stops Create Post/Submit calling Linear.
    undo: Set enabled:false. Reversible for NEW admission only: production_intake_epoch_read pins an already-accepted manifest/receipt to its original epoch, so in-flight work does not change lanes. Do it per team; video first.
  - [runtime-flag] Flip syncview_runtime_flags.native_assignment_epochs to a native epoch per team.
    undo: Set mode back to provider. Same one-way property: accepted native assignment receipts stay native.
  - [runtime-flag] Stage + attest a real label catalog version (production_label_catalog_stage_attested) and set production_native_label_catalog to {schema_version:1, mode:"native", version_id:<uuid>}. REQUIRES a Linear label export taken before Sept 15.
    undo: mode:"hold" (blocks new label writes with 503 native_label_catalog_held, gateway retained) or mode:"provider" — but provider stops working the moment Linear dies, so hold is the real containment. Catalog versions are immutable by trigger and must nev

RISKS
  - THE NAMED-APPEND ORDERING HAZARD. migrations/2026-09-05-native-only-intake.sql line 268 and migrations/2026-09-07-production-intake-append-v8.sql both `create or replace function public.production_intake_append(text,timestamptz,jsonb,jsonb)`. The nat
    mitigate: Do NOT install 2026-09-05-native-only-intake.sql as a standalone step. Install the COMPOSED artifact from scripts/native-intake-named-append-compose.js, which splices native-only-intake and named-append into ONE transaction (I verified: it strips nat
  - The composed artifact has NEVER been executed against a target that lacks the native columns. docs/audits/2026-09-07-native-named-append-evidence.json records atomic_composition.first_install_execution = "UNPROVEN_existing_target_already_has_native_c
    mitigate: Before the real window, run the composed artifact once against a disposable PostgreSQL 16 built from migrations/live-schema-baseline-2026-07-03.sql plus deltas with only v7 installed, exactly as EXECUTION_LOG.md:6270's house rule requires ('no migrat
  - THE LABEL LANE IS NOT ACTUALLY FINISHED. The two label migrations are lift-ready but inert: production_label_catalog_capability() only reports mode:native when a version_id exists, and the only way to create one is production_label_catalog_stage_atte
    mitigate: Treat B7 as a separate, earlier deadline than the deploy: write the exporter and take the capture in the next few days, independent of whether the gateway ships. If the capture is not taken by Sept 15, labels are permanently frozen at whatever native
  - docs/ops/NATIVE_LABEL_CATALOG_FOUNDATION.md step 2 states installation is HELD until the authenticated recovery corpus (history-v7, 37 tables) is extended to cover production_label_catalog_versions, its immutable triggers, the new RPCs and the outbox
    mitigate: Either extend the recovery corpus (there are candidate scripts/track-b-history-v8/v9-backup-prerequisites.sql that may already do this — verify) or get an explicit owner waiver naming the gap. Do not install through a documented hold silently.
  - FILE-COUNT / PIN COLLISION IN THE DEPLOY LANE. The candidate bumps PRODUCTION_WRITE_FILE_COUNT 5 -> 6 (new import `../_shared/native-brief-media.mjs`) AND LINEAR_OUTBOUND_SOURCE_SHA256 1489a4c2 -> 43329cdf in the same workflow file that another lane 
    mitigate: **Lane B edits NEITHER pin.** See B8 and `LINEAR_EXIT_LANES.md` §Single-writer resources: the workflow and its guard test belong to the coordinator, who computes both values on the final merged commit. Lane B's job here is to REPORT: say in the PR body which PRODUCTION_WRITE_* values the closure needs and that LINEAR_OUTBOUND_* must be left alone. What lane B does control is the file count itself: drop the native-brief-media import (one import line plus one call at index.ts:5306) unless the brief-media lane ships in the same release, which keeps the count at 5 and the two lanes independent. Never hand-edit a digest; the coordinator regenerates with `node scripts/ef-fin
  - MERGING ANYTHING BETWEEN HANDOVER AND DISPATCH. The Section 4 lane requires commit_sha == main's tip at dispatch time; a docs PR merged in that window rejected a dispatch on 2026-09-02 and four PRs did on 2026-08-08. Lane B is one of several lanes al
    mitigate: Freeze merges to main the moment the deploy SHA is handed to the owner, and do not unfreeze until he says the run is green. Fails in ~19s and deploys nothing, so the cost is a cycle, but it is fully avoidable.
  - Both the browser picker (index.html:40556, `linear_user_id=not.is.null`) and the gateway's autoAssigneeForIntake (index.ts:2703-2712, `.filter(member => clean(member.linear_user_id))`) require a Linear user id to be assignable. These are Postgres rea
    mitigate: The candidate already fixes this: nativeIntakePool drops the mapping requirement on the native lane, and handleIntakeEditorOptions replaces the browser's direct read. Make sure B2 actually ships the browser half; shipping only the gateway leaves the 
  - The candidate's production-write index.ts also carries other lanes' surfaces — `legacy_intake_receive` and `legacy_intake_triage_list` actions (candidate lines 7972, 8003), native comment media, native card materialization. Lifting index.ts wholesale
    mitigate: Diff the candidate index.ts against main handler-by-handler and consciously accept or strip each non-lane-B addition before pinning. The pin is the audit point: whatever is in the closure at that digest is what deploys.
  - `teamIdFor` still gates the live Create Post path even on a native lane: productionCreateScope (index.ts:3085) throws 503 linear_team_mapping_unavailable when LINEAR_VIDEO_TEAM_ID / LINEAR_GRAPHICS_TEAM_ID are unset, and projectForIntake still throws
    mitigate: Keep the env vars and the existing clients.linear_project_ids values in place after Sept 15 (they are inert identifiers, not credentials). Longer term, make projectId optional on the native lane, otherwise no client onboarded after Sept 15 can ever h

TESTS
  EXISTING, pass offline on main — I ran them: test/production-intake-append.js (exit 0), test/intake-post-names.js (exit 0), test/create-post-picker.js (51 checks passed).
  EXISTING on main, must keep passing: test/f27-section4-deploy-lane.js (runs scripts/ef-fingerprint.js and asserts the workflow pins + EF_DEPLOY_MANIFEST rows), test/create-post-error-names-the-cause.js, test/create-post-refusal-advice.js, test/create-post-count-stepper.js, test/intake-created-status-server-guard.js, test/linear-intake-receipt-contract.js, test/linear-intake-submission-cap.js, test/linear-submit-durability.js, test/intake-retry-mirror-convergence.js, test/samples-intake-lane.js, test/b1-workload-labels-preserved.js, test/batch-parent-labels-terminate.js.
  LIFT FROM CANDIDATE: test/native-intake-named-append.js, test/native-intake-manifest.js, test/native-intake-retained-refusals.js, test/native-intake-ui-source.js, test/native-intake-editor-projection.js, test/native-intake-editor-browser.js, test/native-assignee-eligibility.js, test/native-assignee-policy.js, test/native-assignee-catalog-dryrun.js, test/native-existing-assignment.js, test/native-existing-assignment-preinstall.js, test/native-label-catalog-foundation.js, test/native-label-writes.js, test/submit-owned-intake-routing.js.
  NEW NEEDED: a test asserting that on a native epoch NO code path in production-write can reach api.linear.app — i.e. every remaining `linearRead` / `linearLabelsRequest` caller is behind a native early-return, an unconditional throw, or a mode!=native branch. Grep-plus-reachability, in the style of test/f27-section4-deploy-lane.js's source assertions.
  NEW NEEDED: a test for the Create Post error mapper covering `project_mapping_validation_unavailable`, `batch_parent_validation_unavailable` and `assignee_provider_unavailable` — that they do NOT render the 'configure this client's filing' or 'safe to retry' sentences (work item B3).
  NOT RUNNABLE HERE: `npm run test:prod-polish` needs a route to the live backend; per CLAUDE.md all 8 lanes fail identically on origin/main in a sandbox. Verify against main before calling anything a regression.
  NOT EXECUTED BY ME: none of the candidate's 109 changed test files were run — they need the candidate's index.html / index.ts on disk. Treat their pass status as unverified.


=== ADVERSARIAL REVIEW OF YOUR OWN BRIEF — READ THIS TWICE ===
A second agent tried to prove the brief above wrong. It found the following. Where the review disagrees with the brief, THE REVIEW WINS.

CLAIMS THAT ARE WRONG:
  ! risks[8] and work_items B9: "`teamIdFor` still gates the live Create Post path even on a native lane: productionCreateScope (index.ts:3085) throws 503 linear_team_mapping_unavailable when LINEAR_VIDEO_TEAM_ID / LINEAR_GRAPHICS_TEAM_ID are unset ... which IS on
    why: `productionCreateScope` has exactly two callers in /home/user/client-analytics/supabase/functions/production-write/index.ts on origin/main: line 3343 (`handleCreateOptions`, action `create_options`) and line 3594 (`handleProductionCreate`, which is dead behind the unconditional `throw new GatewayError(403, "production_
    truth: `linear_team_mapping_unavailable` is reachable only on the Production-tab surfaces (`create_options`, and the already-closed production create). Create Post / Submit are unaffected by LINEAR_VIDEO_TEAM_ID / LINEAR_GRAPHICS_TEAM_ID. The half of that risk that IS real is `projectForIntake`: even with a native epoch it st
  ! work_items B4: "All four SQL objects that get replaced (production_intake_root_begin, production_intake_append, production_component_fill) are `create or replace` on functions that already exist live; only production_intake_manifests and production_card_proven
    why: Two errors. (1) `production_intake_root_begin` does not exist anywhere on origin/main: `git grep -l production_intake_root_begin origin/main -- migrations/` returns nothing, and /home/user/client-analytics/migrations/2026-09-05-native-intake-root-manifest.sql line 28 is a plain `create function public.production_intake
    truth: B4 creates one new table (`production_intake_manifests`), one new function (`production_intake_root_begin`), and replaces two live functions (`production_intake_append`, `production_component_fill`). `production_card_provenance` and its two triggers on `calendar_posts` / `sample_reviews` belong to the reconcile migrati
  ! already_built[6] and risks[3]: "`production_label_catalog_capability()` only returns mode:native when a version_id exists in `production_label_catalog_versions`"; done_when: "`production_label_catalog_capability()` returns {...} for both teams".
    why: Read the function body — /home/user/client-analytics migrations/2026-09-06-native-label-writes.sql lines 57-72. It does exactly one read: `select value into v_value from public.syncview_runtime_flags where key='production_native_label_catalog' for share`, then validates the JSON shape (schema_version=1, mode in provide
    truth: Setting the flag to `{"schema_version":1,"mode":"native","version_id":"<any uuid>"}` makes capability() report native with NO version staged. The refusal then lands one call later, in `readNativeLabelCatalog` -> `production_label_catalog_read_attested` (503 `native_label_catalog_unavailable`, candidate index.ts:929-941
  ! work_items B7: "`production_label_catalog_capability()` only returns mode:native when a version_id exists in production_label_catalog_versions, and the only way to create one is `production_label_catalog_stage_attested(uuid, manifest, attestation)`."
    why: migrations/2026-09-05-native-label-catalog-foundation.sql line 138 creates `production_label_catalog_stage(p_version_id uuid, p_manifest jsonb)`, which calls the same `production_label_catalog_check_manifest` and inserts a row into `production_label_catalog_versions` with no attestation. There are two staging entry poi
    truth: A version staged through the plain `production_label_catalog_stage` is unusable by the gateway — `production_label_catalog_read_attested` (native-label-writes.sql:46-55) raises `native_label_catalog_unverified` when `operator_attestation is null`. So B7's conclusion (an attested manifest is required, and no repo script
  ! work_items B2 and risks[6]: `handleIntakeEditorOptions` / `action: 'intake_editor_options'` "Replaces the browser's direct PostgREST read at main index.html:40556 that filters `linear_user_id=not.is.null`", and "The candidate already fixes this ... Make sure B
    why: The candidate keeps that read. `grep -n "linear_user_id=not.is.null" cand.html` returns line 40999, inside a retained helper `_calLegacyVideoEditorPool()` (candidate index.html:40967). `_calNativeVideoEditorPool()` (candidate:40919) calls the gateway, and at 40952-40956 does: `if (result.lane === 'provider' && result.e
    truth: It is a lane-conditional replacement, not a replacement. B2 must lift `_calLegacyVideoEditorPool` as well as the new caller, and the risk's mitigation is wrong about causality: shipping the browser half does NOT stop unmapped editors being hidden — only the `native_intake_epochs` flip does. Until that flip, the picker 
  ! work_items B5 / live_actions: the composed artifact "is 66659 bytes".
    why: I ran `require('./scripts/native-intake-named-append-compose.js').fromRepository()` against the candidate's extracted scripts/ + migrations/. `r.sql.length` is 66659 (JS characters) but `Buffer.byteLength(r.sql,'utf8')` is 66665. The file contains non-ASCII bytes, so an operator checking the artifact's size on disk wil
    truth: 66659 characters / 66665 bytes. Everything else in B5 reproduced exactly: native_sha256=3c0cac06bcae41928f1c99d0359dea6562f1ec2f9b0546123f1548eac48746e4, hybrid_sha256=2b26c56fbbefa70e06e16aab4feb652aa2a83f81a4dd4ffade18f23f780e0c52, composed_sha256=2571a909971f2bc52ef270400b7666c2b529d36ab4f6a56044f00d1b2ecf61ec, oute
  ! open_questions[1]: "Both the composed artifact and the native migrations CALL public.production_batch_parent_ids_for_team without creating it — it is created by v7 (and re-created by v8). If v7 is not installed the composed artifact will fail on an undefined f
    why: `git grep -ln "function public.production_batch_parent_ids_for_team" origin/main -- migrations/` returns 2026-07-13-production-intake-append.sql, then v2, v3, v4, v5, v6, v7, v8. It has existed since the original 2026-07-13 append migration, not since v7.
    truth: The function is near-certainly live (it predates v7 by six weeks and every append version re-creates it). The open question worth keeping is narrower and still unanswered: is v7's or v8's body the one currently installed, since the composed artifact overwrites `production_intake_append` outright. The "undefined functio
  ! open_questions[7]: "Is n8n involved anywhere in this lane? I found no n8n webhook on the production-write write path."
    why: Three fire-and-forget `fetch(LOG_SUBMISSION_WEBHOOK, ...)` calls sit directly on the Submit path in /home/user/client-analytics/index.html at lines 47437, 47910 (`_linearIntakeSendTelemetry`) and 47948 (`_linearIntakeLogSubmissionRequest`), pointing at `https://synchrosocial.app.n8n.cloud/webhook/log-linear-submission`
    truth: The telemetry calls are `.catch(() => {})` so they cannot fail a submission — but `_linearIntakeLogSubmissionRequest` is the fallback log built after the 2026-08-26 eleven-refusal incident (its own comment at index.html:47921-47943 says the raw submission is logged FIRST precisely so a refused submission is recoverable
  ! open_questions[3]: "Has the authenticated recovery corpus (track-b history v8/v9) been extended to cover production_label_catalog_versions and the new native triggers? ... I found scripts/track-b-history-v8/v9-backup-prerequisites.sql on the candidate but did 
    why: Verifiable in one grep, and it changes the answer. `production_label_catalog_versions` is in the covered-relation array of BOTH scripts/track-b-history-v8-backup-prerequisites.sql (line 47, plus key handling at 84, 98, 114, 129-130, 186) and scripts/track-b-history-v9-backup-prerequisites.sql (line 47, plus 85, 99, 123
    truth: Table-level coverage exists. What remains unmet in docs/ops/NATIVE_LABEL_CATALOG_FOUNDATION.md step 2 is the rest of the sentence — "explicit versioned data/schema/ACL/trigger coverage ... Prove exact full catalog/attestation/native-receipt restoration, terminal status, enabled immutable guards and failure rollback wit

WORK THE BRIEF MISSED:
  + The legacy n8n Submit lane: `write_ui_reroute_clients` decides whether Submit reaches production-write at all
    why: Lane B's goal and every done_when criterion are scoped to supabase/functions/production-write/index.ts. But Submit does not unconditionally go there. `_submitLinearFormRoutedOnce` (index.html:47583) falls back to `_submitLinearFormLegacy` -> `_submitLinearFormOnce` -> `_linearAwaitCreate` -> POST to the n8n `video-form
    files: /home/user/client-analytics/index.html
  + `production_assignee_eligibility` — a one-flag, no-deploy kill switch for `assignee_provider_unavailable` that the brief never mentions
    why: The brief treats the assignee lane as requiring the B1 gateway lift plus B6's `native_assignment_epochs` migration and flip. It misses that the ALREADY-DEPLOYED code has the lever. On origin/main, index.ts:2566 declares `ASSIGNEE_ELIGIBILITY_FLAG = "production_assignee_eligibility"`; `assigneeEligibilityPolicyFor` (mai
    files: /home/user/client-analytics/supabase/functions/production-write/index.ts, /home/user/client-analytics/supabase/functions/production-write/policy.mjs
  + The native-intake reconcile lane is scheduled for install but never scheduled for lifting
    why: live_actions_needed[3] says "Apply migrations/2026-09-05-native-intake-reconcile.sql" and its reversible_how names `production_card_provenance` and the two card-table triggers — but that migration appears in NO work_item's `files` and is absent from `files_owned`. Neither are its companions on the candidate: .github/wo
    files: /home/user/client-analytics/migrations/2026-09-05-native-intake-reconcile.sql, /home/user/client-analytics/.github/workflows/native-intake-reconcile.yml, /home/user/client-analytics/test/native-intake-reconcile.js
  + `handleCreateOptions` has TWO ungated Linear reaches, not one — B9 only names `linearLabelCatalog`
    why: B9 says `handleCreateOptions` "calls `linearLabelCatalog(scope.teamId, scope.team)` with NO gate". It calls two things in one `Promise.all` (candidate index.ts:3724-3727, byte-identical to main:3342-3345 — I diffed the two function bodies and they match exactly): `linearLabelCatalog(...)` AND `mappedCreateAssignees(sup
    files: /home/user/client-analytics/supabase/functions/production-write/index.ts
  + Browser half ships on merge, gateway half only on dispatch — and the client→project admin picker dies with Linear
    why: Two ordering facts absent from live_actions_needed. (1) Per CLAUDE.md, a push to main auto-deploys index.html via GitHub Pages, while production-write only moves on a Section 4 dispatch. So between merging B2 and the owner's dispatch, the browser sends `action: 'intake_editor_options'` to a gateway that answers 400 `un
    files: /home/user/client-analytics/index.html, /home/user/client-analytics/supabase/functions/production-write/index.ts
  + `public_intake_enabled` is an unlisted prerequisite of the "a Submit succeeds end to end" criterion
    why: Public (credential-less) Submit on the `submission` surface is gated by the runtime flag `public_intake_enabled` (main index.ts:218 `PUBLIC_INTAKE_FLAG`, read at 1203) plus the rate ledger `public_intake_log` (1227-1237, caps at index.ts:235-238). The brief's done_when asserts a Submit must succeed end to end, and its 
    files: /home/user/client-analytics/supabase/functions/production-write/index.ts

OPEN QUESTIONS — answer from the code if you can; escalate to the coordinator only if a wrong guess is expensive
  ? Has migrations/2026-09-07-production-intake-append-v8.sql been applied to the live database since EXECUTION_LOG.md:6270 was written? That entry says SOURCE ONLY, not yet applied, and I have no way to read the live schema. If it has already been applied, the or
  ? Is migrations/2026-08-26-production-intake-append-v7.sql actually live? Both the composed artifact and the native migrations CALL public.production_batch_parent_ids_for_team without creating it — it is created by v7 (and re-created by v8). If v7 is not install
  ? Does an authenticated export of the Linear label catalog already exist privately (owner's machine / Drive), or does one have to be taken? Nothing in the repo produces the manifest that production_label_catalog_stage_attested requires. This is the deadline-crit
  ? Has the authenticated recovery corpus (track-b history v8/v9) been extended to cover production_label_catalog_versions and the new native triggers? docs/ops/NATIVE_LABEL_CATALOG_FOUNDATION.md step 2 blocks installation on it; I found scripts/track-b-history-v8
  ? Which lane owns the LINEAR_OUTBOUND_SOURCE_SHA256 bump to 43329cdf...? Lane B should leave it alone, but if the outbound-cutoff lane also ships in the same Section 4 dispatch, the two pins must be reconciled in one PR — only one dispatch can carry both.
  ? I did not execute any of the candidate's 109 changed test files. Their pass status on a merged lane-B branch is unverified.
  ? Does the owner want the Production-tab `create_options` endpoint hard-closed (work item B9)? It is currently browser-unreachable but live, and it is the last unguarded linearLabelCatalog caller. Closing it is a behaviour change to a documented-but-dormant surf
  ? Is n8n involved anywhere in this lane? I found no n8n webhook on the production-write write path — the ten browser->n8n->Linear webhooks in the CONTEXT are the read/mirror surfaces, not the intake path. I did not verify the n8n side.


IF THIS LANE IS NOT FINISHED BY 2026-09-15, THIS BREAKS:
Create Post and Submit stop creating work entirely, for every client, on both teams — and they say the wrong reason. Concretely, on `operation: intake_create`: (1) `projectForIntake` -> `readLinearProject` -> `linearRead` fetch to api.linear.app throws, giving HTTP 503 `project_mapping_validation_unavailable` (index.ts:2282-2303, 2319-2337); the browser at index.html:41370 matches it against /project|mapping|parent/ and tells the SMM "This client's Video and Graphics filing must be configured before a post can be created." — a permanent lie, since no configuration can fix a dead API. (2) Append-to-an-existing-batch additionally fails at `parentRouteForAppend` -> `validateLinearBatchParent` with 503 `batch_parent_validation_unavailable`, same wrong sentence. (3) Whenever the Create Post dialog's editor dropdown resolves (it sends `assignee_id` for video), `assertEligibleAssignee` -> `assigneeProviderPool` returns 503 `assignee_provider_unavailable`, which no branch of _calNativePostErrorText matches, so the reader gets the catch-all "safe to retry" — advice that is false forever and, per the file's own 2026-08-26 note, cost a videographer eleven identical submissions the last time it appeared. Separately: every label read and every label write dies — `action: labels_read` (index.ts:4947) and `operation: labels` (index.ts:5491) both call `linearLabelSnapshot`, which is 503 `label_catalog_unavailable`, so staff cannot see or change labels on any deliverable; and `action: assignee_options` (index.ts:3405 -> mappedCreateAssignees) returns 503 `assignee_provider_unavailable`, so the Production assignee picker cannot even populate. Net: no new work can enter the system, and no existing card can be relabelled or reassigned.


START BY: reading docs/independence/LINEAR_EXIT_LANES.md on origin/main (the lane map and the index.html region ownership table), then OPEN_REPAIRS items 162-168. Then confirm for yourself that the 'already built' artifacts above really exist before you plan anything around them.
