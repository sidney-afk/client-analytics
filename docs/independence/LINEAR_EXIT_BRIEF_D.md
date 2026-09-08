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

**This file: 6 executable lines restored, 0 left unrestored.** One carries a
correction found by Codex review on #1352: the earlier-SHA dispatch rolls back
TWELVE functions, not four. The workflow's push-safe step is unguarded on
`workflow_dispatch`, so eight onboarding/credentials/filming/report closures
ship from the chosen SHA before the Track-B four. Both `undo:` lines and the
sequencing `mitigate:` now say so.

The deploy
`undo:` credits `ROLLBACK.md` with recording the browser-only revert path, and
it does: the row is at `ROLLBACK.md:107` on this lane's own branch
(`claude/lx-d-feedback`), not on `main` or the coordinator branch, so it ships
with the lane and should be checked for in the merge. An earlier version of this
restoration reported the row as missing, having searched only the coordinator
branch.

**Second correction to this pass, same day.** The first version of this
restoration reported some artifacts as existing on no branch this session could
reach, and left the instructions that depend on them as declared gaps. That was
wrong: the artifacts exist, on branches this session had not enumerated. The
lines are now restored from them and say so. The root cause was searching a few
branches (or a `head`-limited grep) and reporting the result as exhaustive. See
`docs/ops/OPEN_REPAIRS.md` item 179's correction section; the rule it earned is
that in a multi-branch estate, "not where I looked" is not "does not exist".



---

SESSION NAME: LX-D Comments and feedback
KEEP THIS EXACT SESSION TITLE. Do not rename it. The owner tracks six parallel sessions by title.

SESSION NAME: LX-D Comments and feedback
Keep this exact session title. Do not rename it. The owner tracks parallel sessions by title.

You are ONE of six parallel sessions removing Linear from SyncView before Linear
access ends on 2026-09-15. Today is 2026-09-07. A coordinator session owns merge
order and the ledger; you own exactly one lane and nothing else.

YOUR BRANCH: claude/lx-d-feedback   (create it from origin/main, push there, never elsewhere)

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
Push, open a DRAFT PR titled `LX-D: <what it does>`, and in the body state:
  - what is done and proven, with the test names
  - what is NOT done
  - every live action the owner must take (migration, deploy, flag, n8n edit),
    each with its exact undo
  - anything you found that belongs to another lane
Then stop. Do not merge. Do not start another lane's work.


=== YOUR LANE: D ===
BRANCH: claude/lx-d-feedback
MERGE POSITION: 4th. Depends on lane A. Your deploy lane redeploys four functions from one commit_sha.

GOAL
Staff read every piece of client/Kasper feedback for a deliverable inside SyncView — the SyncLinear "Feedback & tweaks" panel showing canonical comments plus a read-only projection of the notes still living in the Calendar/Samples card cells, and the Workload "Tweaks Needed" popover reading those comments from Supabase — with zero Linear reads on either path.

DONE WHEN
  - `supabase/functions/production-comments/feedback.mjs` exists on main and `index.ts` honours `include_feedback: true` for staff principals only; `node test/component-feedback-read.js` passes 26/26 (I ran it against the candidate closure in a scratch mirror: 26 PASS).
  - `node docs/syncview-design/tests/prod-feedback-browser.js` passes 13 Chromium scenarios and is registered in `docs/syncview-design/tests/prod-polish-gate.js` as `['fast','Production component feedback', …]` (candidate has it at line 21; main does not).
  - The SyncLinear component detail heading reads `Feedback & tweaks` (index.html, candidate line 63414) and the panel renders `From the original card` source rows with no Reply/Edit/Delete/Resolve buttons — `docs/syncview-design/tests/prod-structure-subset.js` asserts the heading and a *visible* `[data-prod-feedback-state]`.
  - A Samples/SXR **video** deliverable returns `feedback.status: 'complete'`, not `source_unavailable` — i.e. `feedback.mjs:90` no longer selects the nonexistent `sample_reviews.tweaks` column (see work item D3; this is a live defect in the candidate code).
  - `wlFetchTweakComments` returns native comments from `functions/v1/production-comments` for every issue whose `workloadSource === 'native'` and makes no request to `LINEAR_TWEAK_COMMENTS_WEBHOOK` for those ids; the popover shows `No feedback is available here. Open the post in SyncView to check its review notes.` instead of `+ N older comments on the sub-issue in Linear`.
  - `grep -n 'linear-tweak-comments' index.html` returns nothing, or returns only a dead-code path unreachable because every Workload row is `workloadSource === 'native'` (Lane A's ruling).
  - `npm test` (test/run-all.js auto-discovers every top-level `test/*.js`) is green with `test/component-feedback-read.js` and the updated `test/production-comments-ui-source.js` included.
  - `production-comments` is deployed from an exact main SHA via https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml and a staff read of a mapped Calendar deliverable returns a `feedback` object in the live response.

ALREADY BUILT — LIFT THESE, DO NOT REBUILD
  * The whole server side of the source-feedback projection: `feedbackScope`, `feedbackCardMatches`, `importedCommentId`, `sourceComment`, `sameCurrentComment`, `readLegacyFeedback` — 214 lines, no Linear reference anywhere in the file.
    where: candidate 5bcc03bd / PR 1297 head ce86295ba — `supabase/functions/production-comments/feedback.mjs` (new file, 214 lines)
    confirmed: `git show 5bcc03bd…:supabase/functions/production-comments/feedback.mjs` read in full; `git show …:supabase/functions/production-comments/feedback.mjs | grep -i linear` → exit 1, zero hits. I then built a scratch mirror of the six-file closure and ran `node test/component-feedback-read.js`: **26 PAS
    lift: Copy the file verbatim. It imports only `{ clean, normalizeTeam, safeAttachments }` from the existing `./policy.mjs`, all three of which already exist on origin/main (`policy.mjs:14`, `:22`, `:89`). Apply the D3 fix before shipping.
  * The `include_feedback` wiring in the reader handler: 13 added lines that call `readLegacyFeedback` AFTER the existing budget + target-authorization + durable allow-audit, then re-read the deliverable's five crosswalk fields and 403 if any moved.
    where: PR 1297 head ce86295ba — `supabase/functions/production-comments/index.ts`, +13 lines (one import, an 11-line block before the response, one spread `...(feedback ? { feedback } : {})`)
    confirmed: `git diff 731e7c24…ce86295ba -- supabase/functions/production-comments/index.ts` — exactly 13 added lines, nothing removed. Ordering verified by reading origin/main `index.ts:310-341`: `takeReadBudget` → target lookup → `staffTargetAllowed`/`clientTargetAllowed` → `authorizeAllowedRead` all precede 
    lift: Apply PR 1297's diff, **not** the candidate's version of this file. The candidate's `index.ts` diff is larger: it also adds `media_comment_id`, `projectCommentMedia`, `briefMediaOccurrences` and a `MediaPublicComment` type from the separate native-comment-media lane, which depends on the uninstalled `migrations/2026-09-07-native-comment-media.sql` and a `syncview_runtime_flags` row keyed `native_c
  * Staff-only `resolved_by_name` and `feedback_origin` on canonical comments — 4 lines, gated on `kind === 'staff'` so no client read widens.
    where: PR 1297 head ce86295ba — `supabase/functions/production-comments/policy.mjs`, +4 lines inside `publicComment`
    confirmed: `git diff 731e7c24…ce86295ba -- supabase/functions/production-comments/policy.mjs`. The `feedback_origin` allowlist `['native','linear','legacy','bridge']` matches the table's own constraint exactly: `migrations/2026-07-12-production-comments.sql:62` — `check (origin in ('native','linear','legacy','
    lift: Apply verbatim. Confirmed the client-facing Samples/Calendar review UI does NOT use this renderer — it maps canonical rows through `_prodCanonicalCardComment` (candidate index.html:56854) into the card comment shape, so the staff-only pills cannot leak into a client link.
  * The complete browser panel: `_prodFeedbackState` (response validation + stale retention), `_prodFeedbackHTML` (7 status messages + `From the original card` section + `Refresh feedback` button), the `_prodCommentNormalize` source fields, the `_prodCommentHTML` pill/label/action-suppression changes, the `.prod-feedback-*` CSS, `include_feedback`/`canonicalOnly` in the loader, and a staff-identity replacement guard.
    where: PR 1297 head ce86295ba — `index.html`, +92 lines net across 9 hunks (CSS ~3007, `_prodCommentNormalize` ~54408, `_prodCommentHTML` ~54473, `_prodFeedbackState`/`_prodFeedbackHTML` ~54651, `_prodComments.load` ~54771-54874, `readCanonical` ~54929, `render()` ~54959, detail heading ~59974)
    confirmed: `git diff 731e7c24…ce86295ba -- index.html` read hunk by hunk. Present in the candidate too: `grep -c` on candidate index.html gives `_prodFeedbackState`=3, `prod-feedback-source`=2, `include_feedback`=1, `Feedback &amp; tweaks`=1, `Refresh feedback`=1, `covered_by`=1 — all 0 on origin/main.
    lift: Apply PR 1297's index.html hunks. In the candidate `_prodCommentHTML`'s body call was later rerouted through `_prodCommentMediaHTML` (candidate:56340) — do not take that line; PR 1297's version calls `_prodLinkify(c.body)` directly and has no media dependency.
  * 13 real-Chromium scenarios over the actual renderer/normalizer/pager extracted from index.html by source boundary: coverage-by-proven-identity, pagination not hiding a source twin, refresh not reusing stale coverage, stale retention, deleted parents, actor switch, client exclusion, keyboard retry, 360/768/1280 × light/dark.
    where: candidate — `docs/syncview-design/tests/prod-feedback-browser.js` (193 lines, new; absent from origin/main)
    confirmed: Read in full. It extracts real source via `between('function _prodFeedbackState(', 'function _prodCanonicalCardComment(')` and `between('function _prodLinkifyInline(', 'function _prodIssueClientCommentSurfaceKnown(')` — both boundary symbols exist on origin/main (`_prodLinkifyInline` 4 hits, `_prodC
    lift: Copy verbatim plus the one-line gate registration. Needs playwright, already a repo dependency (other `docs/syncview-design/tests/*` suites use it).
  * 26 actual-handler checks against finite mocked Supabase tables, executing the real TypeScript handler with `--experimental-strip-types` and the real staff-role auth.
    where: candidate / PR 1297 — `test/component-feedback-read.js` (209 lines, new)
    confirmed: I ran it: `node test/component-feedback-read.js` in a scratch mirror of the candidate closure → 26 PASS, 'no live transport'. Auto-discovered by `test/run-all.js:15` (`readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'run-all.js')`).
    lift: Copy verbatim. Add the missing sxr+video case (D3).
  * The Workload popover's native comment reader: a strict paginated read of `production-comments` for `workloadSource === 'native'` issues, with owner-identity capture, `total`/`has_more`/`next_cursor` integrity checks, duplicate-id refusal and a scope-changed abort.
    where: candidate 5bcc03bd — `index.html`, the rewritten body of `wlFetchTweakComments` (candidate line 19464; +~57 lines) plus `_wlLegacyFetchTweakComments` (candidate 19524, the old main body moved down)
    confirmed: `git diff origin/main...5bcc03bd -- index.html` hunk `@@ -19268,6 +19462,66 @@` read in full. It builds no Linear URL; it POSTs `CAL_SUPABASE_URL + '/functions/v1/production-comments'` with `{deliverable_id: issue.nativeId, limit: 100, before}`.
    lift: Liftable ONLY after Lane A lands: `wlSnapshotIdentity` has 0 hits on origin/main (6 on candidate) and `workloadSource` has 0 hits on origin/main (10 on candidate). Both are Lane A's native-snapshot symbols. Lift after A, or stub them.

WORK ITEMS
  [D1] (low risk, lift) Lift PR 1297's production-comments closure (feedback.mjs + 13 lines index.ts + 4 lines policy.mjs)
     Cherry-pick the edge half of PR 1297 (base 731e7c24, head ce86295ba) onto main. Take PR 1297's index.ts diff, NOT the candidate's — the candidate additionally wires `media_comment_id` / `projectCommentMedia` / `briefMediaOccurrences`, which belong to the native-comment-media lane and require `migrations/2026-09-07-native-comment-media.sql` plus a `syncview_runtime_flags` row keyed `native_comment_media` (contract `native_comment_media_v1`), neither installed. Everything PR 1297 adds sits after the existing budget, target-team authorization and durable allow-audit; it adds no SQL (COMPONENT_FEEDBACK.md: 'Existing card tables, comment table, F42 links and read-auth RPCs are required; there is 
     files: supabase/functions/production-comments/feedback.mjs, supabase/functions/production-comments/index.ts, supabase/functions/production-comments/policy.mjs
  [D2] (low risk, lift) Lift PR 1297's browser panel into index.html
     The +92 lines: `.prod-feedback-status/.prod-feedback-source/.prod-feedback-heading/.prod-feedback-context` CSS; `_prodCommentNormalize` gains `source_only`, `source_surface`, `source_audience`, `parent_unavailable`, `feedback_origin`, `tweak_known`, and `row_updated_at` now prefers `row.row_updated_at`; `_prodCommentHTML` gains the origin/audience/component/tweak-round/Open-Resolved pills, the `Read-only here; manage on the original Calendar|Samples card.` note, and suppresses ALL action buttons when `c.source_only`; new `_prodFeedbackState` and `_prodFeedbackHTML`; the loader gains `includeFeedback = !_isClientLink && !clientSurface && options.canonicalOnly !== true`, a `pageIncomplete` fla
     files: index.html
  [D3] (low risk, new) Fix the confirmed sample_reviews `tweaks` column defect before shipping feedback.mjs
     `feedback.mjs:90` is `const fields = scope.component === 'video' ? ['video_tweaks','tweaks'] : ['graphic_tweaks'];` — unconditional on surface. Line 91 then builds `columns = ['id','client', component+'_deliverable_id', ...fields].join(',')` and line 92 selects them from `sample_reviews` when `scope.surface === 'sxr'`. `sample_reviews` has NO `tweaks` column: `migrations/live-schema-baseline-2026-07-03.sql` create block lists only `video_tweaks` (line 212) and `graphic_tweaks` (213), and `grep -rn 'sample_reviews' migrations/*.sql | grep 'add column'` returns nothing that adds it. `calendar_posts` DOES have it (`tweaks` at baseline line 36, alongside video_/graphic_/caption_/title_tweaks). P
     files: supabase/functions/production-comments/feedback.mjs, test/component-feedback-read.js
  [D4] (medium risk, lift) Lift the Workload native comment reader (wlFetchTweakComments native branch)
     Replace main's `wlFetchTweakComments` (index.html:19270), which POSTs `LINEAR_TWEAK_COMMENTS_WEBHOOK` (index.html:13970) with `{ids}`, by the candidate's split: native ids page `functions/v1/production-comments` under `_syncviewEfHeaders`, legacy ids fall through to `_wlLegacyFetchTweakComments` (the old body, unchanged). Also lift `wlRenderTweakComments(comments, native)`: the empty case returns the native copy 'No feedback is available here. Open the post in SyncView to check its review notes.' and the overflow copy drops 'on the sub-issue in Linear'. HARD DEPENDENCY on Lane A: `wlSnapshotIdentity` and `workloadSource` have zero occurrences on origin/main. Behaviour change to flag to the o
     files: index.html
  [D5] (medium risk, new) Decide whether the Workload popover should also show card-source notes (include_feedback)
     The candidate's native branch sends `{deliverable_id, limit, before}` only — no `include_feedback`. So the popover shows CANONICAL comments only, while the SyncLinear panel shows canonical + card source. A tweak note that took the legacy lane and was never imported (see item 102/104: the legacy lane writes the card cell and the n8n `linear-add-comment` webhook, never `production_comments`) is visible in SyncLinear and invisible in Workload. Today Linear is what makes the popover complete, because the legacy lane wrote there. After Sept 15 that union point is gone. Either add `include_feedback: true` and render `feedback.rows` in the popover, or accept the gap and say so in the popover copy. 
     files: index.html
  [D6] (high risk, new) uploads.linear.app inside comment and source bodies — the real remaining Linear read
     `docs/ops/NATIVE_COMMENT_MEDIA.md` (candidate) measures the population exactly: 49 current non-deleted native comments, 79 occurrences, 75 distinct `uploads.linear.app` URLs, including five videos 58-94 MB and two OpenType fonts. Those are Linear-CDN-hosted files linked from comment bodies the Feedback panel renders; they die with Linear access. The card-source cells (`video_tweaks`/`graphic_tweaks`) can carry the same URLs and `feedback.mjs`'s `sourceComment` passes `raw.body` through with no rehosting at all — it is not even counted in that 79. This is the native-comment-media lane's job to fix, not lane D's, but lane D's panel is where the breakage shows. Lane D must (a) not claim it is s
     files: supabase/functions/production-comments/feedback.mjs, index.html
  [D7] (medium risk, new) Source-only rows get an inert 'Refresh downloads' button when the media lane is merged
     CONFIRMED by reading the candidate, not executed. Candidate `_prodCommentHTML:56340` routes every row's body through `_prodCommentMediaHTML` (56307). That function short-circuits to `_prodLinkify(c.body)` unless the body matches `/https?:\/\/uploads\.linear\.app\//i` — so plain source notes render fine. But a SOURCE row whose card-cell body contains a `uploads.linear.app` URL has no `media` object, so `usable` is false and it renders 'File downloads need a fresh check. [Refresh downloads]'. That button calls `_prodComments.refreshMedia(deliverable, c.id)`, whose first line is `const original = find(id, commentId); if (!current || !original || _isClientLink) return;` — and `find` (candidate 5
     files: index.html
  [D8] (low risk, lift) Lift the test and gate registration set
     `test/component-feedback-read.js` (new, auto-discovered by test/run-all.js), `docs/syncview-design/tests/prod-feedback-browser.js` (new) + its registration line in `prod-polish-gate.js`, and the four small guard edits PR 1297 made so the existing house suites accept the new read shape: `prod-structure-subset.js` (allow `before,deliverable_id,include_feedback,limit` with `include_feedback === true`, and wait on a *visible* `[data-prod-comments-state]`/`[data-prod-feedback-state]`/`.prod-comment-loading`), `prod-readonly-smoke.js`, `prod-review-packet-validate.js`, `prod-comments-browser.js`, `behav-wired.js`, `pixel-wired.js`, `test/production-comments-ui-source.js` (which now executes the tw
     files: test/component-feedback-read.js, test/production-comments-ui-source.js, test/production-comment-mark-done-cas.js, test/prod-context-menu-pixel-contract.js, docs/syncview-design/tests/prod-feedback-browser.js, docs/syncview-design/tests/prod-polish-gate.js, docs/syncview-design/tests/prod-structure-subset.js, docs/syncview-design/tests/prod-readonly-smoke.js
  [D9] (medium risk, lift) Deploy the reader closure — and understand that it co-deploys two writers
     `docs/ops/EF_DEPLOY_MANIFEST.md:45` says `production-comments` deploys ONLY through `deploy-onboarding-edge-functions.yml`, workflow_dispatch only, pinned-SHA guard. That workflow's line 138 is `for fn in linear-outbound production-write production-comments production-archive; do` — one dispatch, four functions, deliberately in that order (its header comment: the provider and the write gateway must deploy BEFORE the readers, or a new reader against an old production-write turns an edit into a silent duplicate comment). Its only input is `commit_sha`. It is NOT the F27 Section 4 lane, so no capture bundle is needed — but it DOES redeploy `linear-outbound` and `production-write`, so it must be
     files: docs/ops/EF_DEPLOY_MANIFEST.md
  [D10] (low risk, mixed) Lift the docs and append to the ledger
     `docs/features/COMPONENT_FEEDBACK.md` (160 lines, new), the `production-comments` row in `docs/ops/EF_DEPLOY_MANIFEST.md` (candidate row names `feedback.mjs` as a bundled module; drop the two `native-*-media.mjs` shared deps if D1 lifts PR 1297 only), `docs/truth/APP.md`, `docs/syncview-design/WIRED-PARITY.md`, `docs/testing/README.md`, `REPO_MAP.md`, `ROLLBACK.md`, `EXECUTION_LOG.md`, and a NEW appended `## N.` entry in `docs/ops/OPEN_REPAIRS.md` recording the D3 defect. Append only, never rewrite; check for duplicate `## N.` headers after merge.
     files: docs/features/COMPONENT_FEEDBACK.md, docs/ops/EF_DEPLOY_MANIFEST.md, docs/truth/APP.md, docs/syncview-design/WIRED-PARITY.md, docs/testing/README.md, REPO_MAP.md, ROLLBACK.md, EXECUTION_LOG.md

FILES YOU OWN (touch nothing else)
  supabase/functions/production-comments/feedback.mjs
  supabase/functions/production-comments/index.ts
  supabase/functions/production-comments/policy.mjs
  test/component-feedback-read.js
  test/production-comments-ui-source.js
  test/production-comment-mark-done-cas.js
  test/prod-context-menu-pixel-contract.js
  docs/syncview-design/tests/prod-feedback-browser.js
  docs/syncview-design/tests/prod-polish-gate.js
  docs/syncview-design/tests/prod-structure-subset.js
  docs/syncview-design/tests/prod-readonly-smoke.js
  docs/syncview-design/tests/prod-review-packet-validate.js
  docs/syncview-design/tests/prod-comments-browser.js
  docs/syncview-design/tests/behav-wired.js
  docs/syncview-design/tests/pixel-wired.js
  docs/syncview-design/tests/README.md
  docs/features/COMPONENT_FEEDBACK.md
  docs/ops/EF_DEPLOY_MANIFEST.md
  docs/truth/APP.md
  docs/syncview-design/WIRED-PARITY.md
  docs/testing/README.md
  index.html — ONLY these named regions: the `.prod-feedback-*` CSS block (origin/main ~3007-3013); `_prodCommentNormalize`; `_prodCommentHTML`; the new `_prodFeedbackState` and `_prodFeedbackHTML`; inside the `_prodComments` IIFE the `load()` request-body/state/identity-guard lines, `readCanonical`'s `canonicalOnly`, and `render()`'s feedback wiring; the SyncLinear detail activity heading string `Comments` -> `Feedback & tweaks` (origin/main ~59974); the BODY of `wlFetchTweakComments` (origin/main:19270) and the new `_wlLegacyFetchTweakComments`; the signature and copy of `wlRenderTweakComments` (origin/main:19293).

LIVE ACTIONS THE OWNER MUST TAKE (prepare them exactly; never execute them)
  - [edge-function-deploy] **TWO ORDERING CONDITIONS, AND ONLY THE FIRST IS CONFINED TO THE OPTIONAL PATH (the second, on the writers this run bundles, applies to EVERY path and is stated after it). FIRST: if lane D lifts the candidate's media-aware `index.ts` (the conditional `- [migration]` two steps below), THAT MIGRATION AND ITS `mode:'off'` FLAG ROW GO FIRST, BEFORE THIS DISPATCH.** The media reader fails closed when either prerequisite is absent — a missing flag row reads as `mode:'required', complete:false, reason:'comment_files_unavailable'` rather than as disabled — so dispatching first puts the deployed reader in that state for the length of the window. On the default path (PR 1297's 13-line diff, no media coupling) lane D's OWN artifacts impose no such dependency — **BUT THAT DOES NOT MAKE THE DISPATCH FIRST, BECAUSE IT IS NOT ONLY LANE D'S DISPATCH.** The same run deploys `linear-outbound production-write production-archive` from the same SHA (workflow line 138; the sequencing risk below), so it is genuinely first only once every writer bundled at that SHA already has its own prerequisites live. The concrete case, read in the source rather than assumed: the candidate's `production-write` calls `production_native_intake_epochs` unconditionally in the intake-options path (`supabase/functions/production-write/index.ts:3678` @integration/linear-exit-candidate-20260906) and refuses 503 `authority_unavailable` when that RPC is absent, so dispatching a SHA that carries lane B's writers before lane B's SQL window has closed can take Create Post/Submit down for every client from a lane that has no SQL of its own. **SO THE PRECONDITION BELONGS ON THIS ACTION, NOT IN A RISK NOTE BELOW IT:** for the chosen SHA, confirm for each of the twelve functions this run deploys that every migration and flag row it needs is already installed live; if one is not, the dispatch waits. Whether the ancestry rule offers a way round it depends on merge order and this brief cannot settle it: `commit_sha` need only be an ANCESTOR of main, so if lane D's reader merges BEFORE lane B's writers there is a real SHA that carries the reader without them, and if lane B merges first there is not and the pre-dispatch check is the only lever. **I could not find a documented lane merge order anywhere in the repo** (searched `docs/independence/` and `docs/ops/OPEN_REPAIRS.md`), so which of those two cases applies is UNKNOWN and must be established with the coordinator before the SHA is chosen. Dispatch https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml with `commit_sha` = the exact main tip carrying the lifted `production-comments` closure. This is workflow_dispatch-only with a main-ancestry guard and runs in the `production` GitHub Environment. It is NOT the F27 Section 4 lane, so it needs NO sealed rollback bundle, no Drive upload and no `confirm` string: `commit_sha` is its only input, it must be exactly 40 lowercase hex characters, and it must be an ANCESTOR of `origin/main` — not necessarily main's tip (workflow lines 36-40 and 68-74). That ancestry check runs first, from the trusted default branch, with no production secret in scope and no script from the dispatched commit executed; only after it passes is the dispatched tree checked out. Practically this means lane D's dispatch does NOT impose the Section 4 merge freeze — an ancestor SHA stays valid if main moves — but see the sequencing risk below, because the SHA you choose also decides what version of `linear-outbound` and `production-write` goes live. **[RESTORED 2026-09-08 · sources: .github/workflows/deploy-onboarding-edge-functions.yml lines 1-21, 36-40, 44-53, 63-82 and 107-140; supabase/functions/production-write/index.ts:3678 @integration/linear-exit-candidate-20260906. The bundled-writer precondition was promoted onto the action after Codex round eleven (P1), which was right that "genuinely first" is true only of lane D's own artifacts.]**
    undo: Re-dispatch the same workflow with an earlier main SHA. **THAT ROLLS BACK TWELVE FUNCTIONS, NOT FOUR** — an earlier version of this line said four and it understated the blast radius. The workflow's first deploy step, "Deploy push-safe staff-sensitive functions" (yml:107-121), carries NO `if:` guard, so it runs on `workflow_dispatch` too and deploys `onboarding-list ai-onboarding-list legacy-onboarding-list onboarding-full client-credentials filming-plans smm-weekly-reports key-verify` from the dispatched SHA BEFORE the Track-B step (yml:122-140) deploys `linear-outbound production-write production-comments production-archive`. Choosing an older SHA therefore regresses eight unrelated live closures as well as the four. Before dispatching a rollback, diff those eight sources between the chosen SHA and current main and confirm they are unchanged, or accept and announce the regression; there is no per-function path in this lane. The browser-only revert is the cheaper lever and is genuinely safe here: reverting the index.html diff hides the panel without touching stored data (the whole lane is a pure reader — `production-comments/feedback.mjs` opens "Read-only staff projection" and issues no insert/update/delete, and COMPONENT_FEEDBACK.md states there is no new SQL), so prefer it and reach for the dispatch only when the deployed reader itself is the problem. `ROLLBACK.md` records this, on lane D's own branch: `claude/lx-d-feedback` ROLLBACK.md:107, whose rollback column reads **"Browser-only revert (no deploy, no data touched): `git revert` the merge and let Pages redeploy — the panel disappears and the heading returns to 'Comments'. Stored comments and card cells are untouched because this lane only reads."** That row is absent from `main` and the coordinator branch, so it ships with the lane; check it survives the merge, and correct its four-function description while you are there. **[RESTORED 2026-09-08 · sources: .github/workflows/deploy-onboarding-edge-functions.yml lines 107-121 and 122-140; ROLLBACK.md:107 @claude/lx-d-feedback; supabase/functions/production-comments/feedback.mjs:1-4 @claude/lx-d-feedback. Blast radius corrected after Codex review on #1352 (P1).]**
  - [edge-function-deploy] Understand that the same dispatch redeploys `linear-outbound`, `production-write` and `production-archive` from that SHA, in that order (workflow line 138). Whatever Lane B/C have merged into `linear-outbound/index.ts` or `production-write/index.ts` goes live with lane D's reader.
    undo: Only by re-dispatching an earlier SHA, which also reverts the reader — **and eight push-safe functions beyond the four named here**, because the workflow's first deploy step is unguarded on dispatch (yml:107-121). There is no per-function rollback in this lane. **[RESTORED 2026-09-08 · source: .github/workflows/deploy-onboarding-edge-functions.yml lines 107-121; corrected alongside the P1 above.]**
  - [migration] NONE required for the projection itself. COMPONENT_FEEDBACK.md is explicit: 'Existing card tables, comment table, F42 links and read-auth RPCs are required; there is no new SQL.' `readLegacyFeedback` reads only `calendar_posts` / `sample_reviews` / `production_comment_card_links` / `production_comments`, and every one of those already exists on the live database — the comment table and its links come from `migrations/2026-07-12-production-comments.sql` and the F42 crosswalk work, the card tables predate all of it. Verified in the source rather than assumed: `feedback.mjs` selects the card table at line 104 (`calendar_posts` or `sample_reviews` by surface), the link table at line 185 and `production_comments` at line 195, and it writes nothing anywhere. So there is no SQL step, no grant to add, and no flag to set for the projection as such — the only migration in this lane's blast radius is the optional media one below. **[RESTORED 2026-09-08 · source: supabase/functions/production-comments/feedback.mjs lines 1-4, 102-116, 185-195, 229-234 @claude/lx-d-feedback]**
    undo: n/a — no migration.
  - [migration] If (and only if) lane D also lifts the candidate's media-aware `index.ts`: `migrations/2026-09-07-native-comment-media.sql` must be applied AND a `syncview_runtime_flags` row keyed `native_comment_media` set to `{contract:'native_comment_media_v1', mode:'off'|'required', recovery_contract:'native_comment_media_recovery_v1', recovery_receipt_sha256:'<64 lowercase hex>', coverage_receipt_sha256:'<64 lowercase hex>'}`. All five fields are checked and the reader fails closed on any of them: a missing row, a wrong `contract`, or a `mode` outside `off`/`required` returns `mode:'required', complete:false, reason:'comment_files_unavailable'`; `mode:'required'` with a wrong `recovery_contract` or either receipt hash not matching `/^[a-f0-9]{64}$/` returns the same. Only `mode:'off'` returns a clean `mode:'off', reason:'not_enabled'`. So an applied migration with NO flag row is the worst of the three states — it reads as a broken media lane rather than a disabled one. The migration itself is additive-but-not-trivial: it swaps two check constraints and rebuilds the unique index on `native_brief_media_occurrences`, and it aborts with `native comment media bucket prerequisite mismatch` unless the private Storage bucket already matches its expected size/mime configuration. Apply the flag row (`mode:'off'`) in the same window as the migration. **[RESTORED 2026-09-08 · sources: supabase/functions/_shared/native-comment-media.mjs lines 3, 9-22 and migrations/2026-09-07-native-comment-media.sql lines 1-30, both @codex/native-urgent-dispatch-20260907]**
    undo: Set the flag's `mode` to 'off', which the reader honours before any signing (native-comment-media.mjs line 19-20) — **editing that one field in place, keeping `contract: 'native_comment_media_v1'`.** The reader tests `flag.data?.value?.contract !== COMMENT_MEDIA_CONTRACT || !['off','required'].includes(mode)` BEFORE the off branch, so a replacement document that drops `contract` does not disable the lane, it falls through to `mode:'required', complete:false, reason:'comment_files_unavailable'`. That is fail-closed rather than dangerous — this reader signs nothing and serves no media in that state — so unlike brief B's three flags a malformed value here degrades instead of breaking. Still write the whole document rather than a field if you are unsure of its current contents, and read it back: the receipt hashes (`recovery_receipt_sha256`, `coverage_receipt_sha256`) are only checked on the `required` path and can be left as they are. **[RESTORED 2026-09-08 · source: supabase/functions/_shared/native-comment-media.mjs lines 3, 17-22 @codex/native-urgent-dispatch-20260907. The contract-field clause was added in round six's flag-shape sweep, which found three genuinely broken flag undos in brief B; this one was not broken and is documented so the next reader does not have to re-derive that.]**
  - [n8n-edit] NO n8n edit is required by lane D. Retiring the `linear-tweak-comments` webhook is optional cleanup once `_wlLegacyFetchTweakComments` is unreachable; it is one of the 10 browser-called webhooks and is read-only.
    undo: n8n workflow version history; the browser path is guarded by `workloadSource !== 'native'` regardless.

RISKS
  - Lifting the candidate's `production-comments/index.ts` instead of PR 1297's drags in the native-comment-media coupling, which fails closed to `mode:'required', complete:false` when the migration and `syncview_runtime_flags` row are absent — and `_pro
    mitigate: Lift PR 1297's 13-line index.ts diff (base 731e7c24, head ce86295ba). Diff the two before applying: `git diff ce86295ba 5bcc03bd -- supabase/functions/production-comments/index.ts`.
  - D3 — the Samples/SXR video path is dead on arrival (`sample_reviews` has no `tweaks` column), and it fails as `source_unavailable`, which the panel words as 'could not load', i.e. indistinguishable from a transient failure. Kasper's review surface is
    mitigate: Fix `feedback.mjs:90` before any deploy, and add the sxr+video test case. The blast radius is small today (item 102's origin histogram: samples=38) but it is the surface the owner named.
  - The only deploy path for `production-comments` also redeploys `linear-outbound` and `production-write`. If Lane B/C have merged unreleased changes to those, lane D's dispatch releases them, and a rollback releases lane D's reader back to the old shap
    mitigate: Sequence the dispatch with Lane B/C. Read `.github/workflows/deploy-onboarding-edge-functions.yml` lines 1-20, 107-121 and 122-140 before dispatch and confirm what those functions are at the chosen SHA. State the SHA to the owner and DO NOT MERGE ANYTHING to `main` between handing it over and his run going green — not even a docs PR; that exact mistake rejected a dispatch on 2026-09-02 and four merged PRs did it again on 2026-08-08. Three facts to carry into that sequencing. (1) The dispatch deploys TWELVE functions, not four: the unguarded push-safe step ships `onboarding-list ai-onboarding-list legacy-onboarding-list onboarding-full client-credentials filming-plans smm-weekly-reports key-verify` first, then the Track-B four. Lane D's SHA choice therefore releases whatever those eight are at that commit, as well as lanes B and C. (2) The ORDER inside the Track-B set is `linear-outbound production-write production-comments production-archive`, chosen so the provider and write gateway land before the readers: a new reader against an old `production-write` can have an edit mis-handled as a create, producing a silent duplicate comment, while new-writer/old-reader stays safe. Do not reorder it and do not deploy the reader alone. (3) The ancestry guard tolerates main moving, but the SHA still pins all twelve, so "an older SHA is still valid" is not a licence to pick a stale one. **[RESTORED 2026-09-08 · sources: .github/workflows/deploy-onboarding-edge-functions.yml lines 1-21, 63-82, 107-121, 122-140; CLAUDE.md (dispatch freeze, the 2026-09-02 and 2026-08-08 rejections). Function count corrected after Codex review on #1352.]**
  - The panel's completeness claim outruns the crosswalk. `feedbackScope` returns null unless `origin` is calendar|samples AND `card_id` is non-empty; a null scope yields `status:'unmapped'` and the message 'This issue has no verified Calendar or Samples
    mitigate: Do not present the panel as complete coverage. Item 147 revision 1 is the honest framing: of the client-facing set (739 cards referencing 1,261 deliverables) 1,124 were already two-way and 137 were not; the ~5,013 unreferenced `manual` rows are B1 Linear imports — a deliverable created by importing a Linear issue that no SyncView card ever produced — so they cannot reach a client and are not this panel's gap. Two things follow and both belong in the panel's copy rather than in a ledger nobody reads at the keyboard: the honest denominator is 1,261, not 6,330, and the 137 unmapped rows are all `origin='manual'` (71 graphics, 66 video), so `status:'unmapped'` should say "this issue is not linked to a Calendar or Samples card" and never "there is no feedback". Note the population also stops growing on its own: the Linear exit removes B1, the generator of those imports, which is item 147's own argument for doing the exit before any large backfill. **[RESTORED 2026-09-08 · source: docs/ops/OPEN_REPAIRS.md item 147 "Revision 1" (lines 11893-11907 and 11945-11952)]**
  - Lane A and lane D both edit `wlFetchTweakComments` and its neighbours in index.html; a merge collision there is near-certain.
    mitigate: The contract in `open_questions`/below: A owns the call site and the snapshot row shape, D owns the function body. Land A first (D4 cannot even compile without A's `wlSnapshotIdentity` and `workloadSource`, both 0 hits on origin/main).
  - The Workload popover and the SyncLinear panel are two independent readers of the same endpoint with different completeness (popover: canonical only, filters out resolved/deleted; panel: canonical + card source). Staff will see two different answers f
    mitigate: D5 — either send `include_feedback` from the popover too, or make the popover copy say it is a summary and 'Open the post in SyncView' is the complete view (the candidate's empty-state copy already does exactly this).
  - The panel renders `uploads.linear.app` links that stop resolving on Sept 15 — 49 comments, 79 occurrences, 75 URLs per NATIVE_COMMENT_MEDIA.md, plus an uncounted set inside the card-source cells that `sourceComment` passes through untouched.
    mitigate: Not lane D's fix. Raise it explicitly to the owner as a media-lane dependency with that count, and do not let the Feedback panel imply the files are safe.

TESTS
  EXISTING, must stay green: `test/production-comments-ui-source.js` — PR 1297 rewrote its tail to execute the REAL `assertNoWriteRequests` guard out of both `prod-structure-subset.js` and `prod-readonly-smoke.js` and assert 22 refusals (include_feedback as false/'true'/1/null, action:'comment_edit', patch:{}, extra keys, limit 500, empty deliverable_id, PATCH method, wrong URL).
  EXISTING: `docs/syncview-design/tests/prod-structure-subset.js` — asserts the `.prod-activity` heading text and that only `before,deliverable_id,limit` (+ optional `include_feedback:true`) request shapes leave the page.
  EXISTING: `docs/syncview-design/tests/prod-comments-browser.js`, `prod-readonly-smoke.js`, `prod-review-packet-validate.js`, `behav-wired.js`, `pixel-wired.js` — all touched by PR 1297 and all in `prod-polish-gate.js`.
  EXISTING: `test/production-comment-mark-done-cas.js`, `test/prod-context-menu-pixel-contract.js` (PR 1297 added 45 lines of comparator checks here after a false pixel red).
  NEW (lift): `test/component-feedback-read.js` — 26 actual-handler checks. I ran it: 26 PASS.
  NEW (lift): `docs/syncview-design/tests/prod-feedback-browser.js` — 13 Chromium scenarios; needs the one-line registration in `prod-polish-gate.js`.
  NEW (write): a sxr + video case in `test/component-feedback-read.js` proving the Samples video path returns `complete`, not `source_unavailable` (D3). Note the current mock cannot detect a bad column — it must be paired with a column-existence assertion against `migrations/live-schema-baseline-2026-07-03.sql`.
  NEW (write): a `prod-feedback-browser.js` scenario for a source row whose body contains `https://uploads.linear.app/...`, asserting no inert 'Refresh downloads' control is rendered (D7) — only needed if the media lane merges.
  CANNOT run here: `npm run test:prod-polish` — CLAUDE.md records all 8 lanes fail identically on origin/main in a sandbox with no route to the live backend, so a red there is not by itself a regression.


=== ADVERSARIAL REVIEW OF YOUR OWN BRIEF — READ THIS TWICE ===
A second agent tried to prove the brief above wrong. It found the following. Where the review disagrees with the brief, THE REVIEW WINS.

CLAIMS THAT ARE WRONG:
  ! tests[]: "EXISTING: `test/production-comment-mark-done-cas.js`, `test/prod-context-menu-pixel-contract.js` (PR 1297 added 45 lines of comparator checks here after a false pixel red)." — and files_owned lists prod-context-menu-pixel-contract.js as an owned exis
    why: `test/prod-context-menu-pixel-contract.js` does not exist on origin/main and did not exist at PR 1297's base. `git cat-file -e origin/main:test/prod-context-menu-pixel-contract.js` -> fatal; `git cat-file -e 731e7c24:test/prod-context-menu-pixel-contract.js` -> fatal. `git diff --name-status 731e7c24...ce86295ba` marks
    truth: prod-context-menu-pixel-contract.js is a NEW file the lane must create by lifting it (I ran it on patched main: 'Production context-menu pixel contract: 14 checks passed'). production-comment-mark-done-cas.js is a one-line touch. Move the former from 'EXISTING' to 'NEW (lift)'.
  ! files_owned: index.html regions cited as "the `.prod-feedback-*` CSS block (origin/main ~3007-3013)" and "the SyncLinear detail activity heading string `Comments` -> `Feedback & tweaks` (origin/main ~59974)".
    why: Those are PR 1297 post-image line numbers, not origin/main. index.html has drifted +2,435 lines since PR 1297's base: `git diff --stat 731e7c24...origin/main -- index.html` = 2,301 insertions / 134 deletions. On current origin/main the only `.prod-activity-title` heading is at line 62068 (`grep -n 'prod-activity-title'
    truth: On current origin/main: heading is index.html:62068; CSS insertion point is after index.html:3013. The Workload numbers the brief gives (wlFetchTweakComments 19270, wlRenderTweakComments 19293, LINEAR_TWEAK_COMMENTS_WEBHOOK 13970) ARE correct — I verified each. Only the two prod-feedback numbers are stale.
  ! already_built #4 / D2: "`index.html`, +92 lines net across 9 hunks".
    why: `git diff --stat 731e7c24...ce86295ba -- index.html` = 84 insertions, 8 deletions (92 lines CHANGED, not +92 net), and `git diff ... | grep -c '^@@'` = 16 hunks, not 9.
    truth: 16 hunks, +84/-8. A session told '9 hunks' will stop seven hunks early. (Positive: I dry-ran and then applied the whole patch to a fresh `git archive origin/main` worktree — all 16 hunks apply, 2 with fuzz 2, zero rejects.)
  ! corrections_to_context: "The candidate's `index.ts` diff vs main is ~34 lines".
    why: `git diff --stat origin/main...5bcc03bd -- supabase/functions/production-comments/index.ts` = 41 insertions, 1 deletion.
    truth: 42 changed lines. The substance of the claim is right — I read the diff: it adds `readLegacyFeedback`, `projectCommentMedia` (`../_shared/native-comment-media.mjs`), `briefMediaOccurrences` (`../_shared/native-brief-media.mjs`), a `MediaPublicComment` type, a `media_comment_id` + SAFE_ID guard, and a media-projection b
  ! done_when #6: "`grep -n 'linear-tweak-comments' index.html` returns nothing, or returns only a dead-code path..."
    why: The first branch is unachievable under the lift the brief itself specifies. `grep -n 'linear-tweak-comments'` returns 2 lines on origin/main (13970 const, 19563 comment) and 2 lines on the candidate (13977, 19819) — the candidate deliberately KEEPS the constant to feed `_wlLegacyFetchTweakComments`.
    truth: State the acceptance criterion as the second branch only: two remaining references (a constant and a comment), both reachable only via `_wlLegacyFetchTweakComments`, which is gated on `workloadSource !== 'native'`. Also note I could not verify Lane A's 'every row is native' ruling from lane D's files — `workloadSource`
  ! already_built #7 / D4 scope: the lift is "the rewritten body of `wlFetchTweakComments` ... plus `_wlLegacyFetchTweakComments` ... [and] `wlRenderTweakComments(comments, native)`", with the call site assigned to Lane A.
    why: The candidate ALSO rewrites the popover's catch-branch copy, which lives in the call site: origin/main index.html:19596 `'Couldn&rsquo;t load the comments — open the sub-issue in Linear to read them.'` becomes candidate index.html:19852 `'Couldn&rsquo;t load feedback. Retry or open the post in SyncView.'`. Neither lane
    truth: Add the catch-branch string at index.html:19596 to lane D's owned regions (or name it explicitly in the A/D contract). As the brief is written, lane D can ship D4 and leave the popover's failure path still instructing staff to open Linear.
  ! already_built #3: "Confirmed the client-facing Samples/Calendar review UI does NOT use this renderer ... so the staff-only pills cannot leak into a client link."
    why: True for the pills, but the +4 policy.mjs lines are not inert. origin/main `_prodCanonicalCardComment` (index.html:55596) already reads `done_by: c.resolved_by_name || ''`, and `_prodCommentNormalize` (index.html:55048, field at ~55124) already normalizes `resolved_by_name`. Today `publicComment` never emits it, so `do
    truth: No client leak (client principals still get the field stripped — `test/component-feedback-read.js` asserts `r.body.comments[0].resolved_by_name === undefined` for a client token, and it passes). But it is a live staff-visible behaviour change in the Calendar/Samples card comment shape, not a no-op; say so to the owner.
  ! open_questions: "Is `production-comments` on origin/main byte-identical to the version deployed 2026-07-24 (`1738ad3`)? I could not check — this clone is SHALLOW."
    why: Partially answerable. The shallow fact is right (`.git/shallow` present, 347 commits, `git cat-file -t 1738ad3` -> 'Not a valid object name'), but `git log --oneline -- supabase/functions/production-comments/` returns ONLY the graft-boundary merge 784eb38 — no commit in the visible window (2026-09-02 -> 2026-09-07) tou
    truth: Narrow the question: no drift since 2026-09-02. Any drift from the 2026-07-24 deploy predates the graft and needs an unshallowed clone or a live function-version check to settle.

WORK THE BRIEF MISSED:
  + docs/ops/WORKLOAD_NATIVE_SOURCE.md documents the exact wiring D4 destroys, and is in no work item
    why: It states at line 78-80 that the popover calls `wlFetchTweakComments()` which POSTs row ids to `…/webhook/linear-tweak-comments`, and repeats it in the webhook table at line 160 (`| linear-tweak-comments | wlFetchTweakComments | read — the Tweak Needed popover |`). D4 makes both false. D10's doc list omits the file ent
    files: docs/ops/WORKLOAD_NATIVE_SOURCE.md
  + D4 lands with zero automated coverage and the brief proposes none
    why: `grep -rln 'wlFetchTweakComments|wlRenderTweakComments' test/ docs/ qa/` returns only docs/ops/WORKLOAD_NATIVE_SOURCE.md and docs/audits/2026-07-05-logic-sync.md — no suite anywhere. D4 is the brief's medium-risk item, it rewrites a 60-line paginated reader with integrity checks, a scope-changed abort and a filter that
    files: index.html, test/, docs/syncview-design/tests/
  + The house read-shape guard hard-requires limit === 50; the Workload native branch sends limit: 100
    why: `docs/syncview-design/tests/prod-structure-subset.js:80` (and the identical guard in prod-readonly-smoke.js) accepts a production-comments POST only when the key set is exactly `before,deliverable_id,limit` (or `before,deliverable_id,include_feedback,limit` with `include_feedback === true`) AND `body.limit === 50`. The
    files: docs/syncview-design/tests/prod-structure-subset.js, docs/syncview-design/tests/prod-readonly-smoke.js, index.html
  + D1 without D10's manifest row is a red suite — the brief splits them with no stated ordering
    why: `test/ef-deploy-provenance.js` validates `docs/ops/EF_DEPLOY_MANIFEST.md` against the real import closure. Adding `feedback.mjs` requires the row edit at manifest line 45 (`production-comments/policy.mjs` -> `production-comments/feedback.mjs<br>production-comments/policy.mjs`), which PR 1297 makes in the same commit. T
    files: docs/ops/EF_DEPLOY_MANIFEST.md, test/ef-deploy-provenance.js, supabase/functions/production-comments/feedback.mjs
  + The legacy tweak WRITE lane still POSTs linear-add-comment for source_gate items, and no lane owns it before Sept 15
    why: `_calLegacyPostLinearComment` (index.html:32558) and `_sxrLegacyPostLinearComment` (index.html:68036) still POST `LINEAR_ADD_COMMENT_URL` (index.html:22341), and the post-authority-flip drains at index.html:32358 and :67890 deliberately EXEMPT `it.source_gate` from quarantine — the in-code comment says the exemption 'p
    files: index.html, docs/ops/OPEN_REPAIRS.md
  + docs/truth/ENDPOINTS.md is enforced and describes the reader contract D1 changes
    why: `test/truth-sync.js` enforces (rule 2) that ENDPOINTS.md's inventory matches what index.html actually calls, (rule 4) that every `symbol()` it names still exists, and (rule 1) a freshness stamp naming a commit that is an ancestor of HEAD. ENDPOINTS.md:171-178 describes production-comments' exact response contract, whic
    files: docs/truth/ENDPOINTS.md, test/truth-sync.js
  + OPEN_REPAIRS.md already carries four duplicate ## N. headers on main
    why: `grep -o '^## [0-9]*\.' docs/ops/OPEN_REPAIRS.md | sort | uniq -d` returns `## 13.`, `## 14.`, `## 22.`, `## 23.` on origin/main today. D10 correctly tells a session to check for duplicates after merge, but without this baseline a session will find four, believe its own merge caused them, and start 'fixing' a ledger CL
    files: docs/ops/OPEN_REPAIRS.md
  + The panel never projects caption_tweaks or title_tweaks, and nothing says so
    why: `feedback.mjs:90` reads only `video_tweaks`+`tweaks` (video) or `graphic_tweaks` (graphics). `calendar_posts` also carries `caption_tweaks` (migrations/live-schema-baseline-2026-07-03.sql:50) and `title_tweaks` (:60). This is NOT a Sept-15 loss — `_writeUiComponentHasWorkItem` returns false for 'caption'/'title', so th
    files: supabase/functions/production-comments/feedback.mjs, docs/features/COMPONENT_FEEDBACK.md

OPEN QUESTIONS — answer from the code if you can; escalate to the coordinator only if a wrong guess is expensive
  ? Does the Workload popover need card-source feedback (`include_feedback`), or is 'open the post in SyncView' the accepted answer? Owner decision (D5).
  ? The native popover branch drops `deleted_at || resolved_at` rows. Linear showed resolved comments. Is losing resolved tweak notes from the popover acceptable, or should they render dimmed?
  ? Is `production-comments` on origin/main byte-identical to the version deployed 2026-07-24 (`1738ad3`, run `30129490033`, per docs/truth/ENDPOINTS.md:171)? I could not check — this clone is SHALLOW (`.git/shallow` present, 346 commits, oldest 784eb38 from 2026-
  ? OPEN_REPAIRS 147 says 'At least one collision is already inside the client-calendar set, and its two rows carry different video and graphic deliverables' among the 13 duplicated `calendar_posts.id` values. `feedback.mjs:92` reads on the composite `(client, id)
  ? How many deliverables today satisfy `feedbackScope` (origin in calendar|samples AND card_id not null)? The last measurement I can cite is item 102 at 2026-09-02 (1,091 non-null card_id; origin calendar 1,157 / samples 38) plus item 156's 100 binds on 2026-09-0
  ? Does the Samples/SXR crosswalk get repaired at all before Sept 15? The Phase 2 runner is calendar-only, and the F42 runbook recorded only 3 of 1,722 Samples cards linked at 2026-07-24. If it stays unrepaired, nearly every Samples deliverable renders `unmapped`
  ? Does the batch-parent detail view also get the Feedback panel, or only component detail? I found the `Feedback & tweaks` heading once in the candidate (index.html:63414) inside a deliverable-detail render; I did not trace whether batch parents reach it.
  ? Item 104's intermittent 17% failure (8 of 46 valid-crosswalk client change requests never reaching the deliverable) is unresolved and orthogonal to lane D. If the status bridge still drops writes after the exit, the Feedback panel will show the note while the 


IF THIS LANE IS NOT FINISHED BY 2026-09-15, THIS BREAKS:
On 2026-09-15 the Workload board's 'Tweaks Needed' popover stops showing feedback entirely — `wlFetchTweakComments` (index.html:19270) is a single unconditional POST to `https://synchrosocial.app.n8n.cloud/webhook/linear-tweak-comments`, so every popover falls into its catch branch and paints 'Couldn't load the comments — open the sub-issue in Linear to read them.' — an instruction to open a system that no longer exists. That popover is where an editor reads what the client asked to be changed before starting work. Separately, and worse because it is silent: SyncLinear's comment panel today shows ONLY `production_comments`, so every tweak note that took the legacy transport — the whole population behind OPEN_REPAIRS 99/102/104, deterministically 100% of broken-crosswalk cards — lives in the `calendar_posts`/`sample_reviews` tweak cells and, until Sept 15, in the Linear sub-issue. Linear was the union point. Without lane D, after the cutoff, feedback exists in the card cell and is visible nowhere else in the staff view, with no notice that anything is missing.


START BY: reading docs/independence/LINEAR_EXIT_LANES.md on origin/main (the lane map and the index.html region ownership table), then OPEN_REPAIRS items 162-168. Then confirm for yourself that the 'already built' artifacts above really exist before you plan anything around them.
