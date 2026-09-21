# Modularization execution plan — 2026-09-21

## Goal and non-goals
Split the app into ordered source fragments while preserving every deployed byte.
Keep `index.html` committed; GitHub Pages continues serving it unchanged on pushes to main.
Use plain concatenation: no bundler, framework, TypeScript, runtime ES modules or externalized assets.
Do not rename, reformat, clean up, remove dead code, change features or finish Linear retirement.
One session and one split PR at a time; ordinary fixes may proceed, but never two open PRs touching the same fragment.

## The gate

This is a strategy-only PR: the commands below specify tooling to implement in Step 0; none exists or has been executed as a build for this plan.
Byte identity of the **entire served document**, not just extracted JavaScript, is the split's correctness proof.
Existing required CI checks, identity protection and one Codex review round still apply.

From the repository root, Step 0 adds these exact npm aliases:

| Command | Implementation |
|---|---|
| `npm run build:index` | `node scripts/build-index.js` |
| `npm run check:index` | `node scripts/check-index.js` |

`build-index.js` reads the manifest in order, reads fragments as raw Buffers, concatenates without separators and writes `index.html` plus the generated `src/index/INDEX.md` map.
`check-index.js` assembles in memory without overwriting anything and fails unless all of these match byte-for-byte:
assembled bytes, working-tree `index.html`, and the committed blob returned by `git show HEAD:index.html`.
Print the full SHA-256 and byte length of each compared value as evidence; hashes are diagnostic, never a frozen baseline or additional CI constraint.
The output-identity gate is only assembled bytes = working-tree page = committed page; ordinary fixes may change all three together.
Missing, duplicate, unlisted or out-of-folder fragment paths fail; enumerate fragments only to validate coverage, never to choose order.
The manifest and `INDEX.md` are metadata and never included in output or the fragment-coverage set.

In `.github/workflows/calendar-unit-tests.yml`, add `npm run check:index` to the existing `unit` job before `node test/run-all.js`, on PRs and main, without path filters or conditional skips.
That check assembles in memory for verification; Pages needs no deployment build step.
The cut-only unchanged-page rule is enforced by the executor and supervisor below, not by an immutable hash in CI.
No later structural cut changes the scripts or CI wiring; ordinary fixes follow their own workflow below.

Boundary measurements were taken at `81f2bfa40cba48f9a15877a933ed21dc15e2f39c`; `wc -l index.html` = **86,122**.
Step 0 and every cut PR start from freshly fetched main; refresh affected boundary measurements when ordinary fixes change the page.

**Line endings and trailing newline:** `index.html` is already `text eol=lf`; preserve LF and its final newline.
Add `src/index/** text eol=lf` in Step 0, not broad `-text` exemptions.
Never decode/re-encode content, trim, append newlines, add BOMs or insert join separators.
A fragment need not end in a newline: the Step-0 head ends with the four indentation spaces immediately before the first script tag.
Preserve those bytes exactly; only the assembled document must retain the original EOF newline.

## Source layout

```text
index.html                         # committed, served build output
src/index/
  manifest.txt                     # one relative fragment filename per line
  INDEX.md                         # generated navigation table, not a fragment
  000-head.html.part
  005-head-boot.html.part
  010-styles-foundation.css.part
  020-styles-surfaces.css.part
  030-body-shell.html.part
  040-shared-briefs.js.part
  ...                              # exact filenames in the cut list
  340-editors-date-picker.js.part
  350-footer.html.part
scripts/build-index.js
scripts/check-index.js
test/index-build.js                 # small gate failure controls, Step 0 only
```

Numeric prefixes describe document order, not execution order; the explicit manifest alone determines concatenation.
Use `.part` because these are byte fragments, sometimes containing tags or spanning an existing scope, not independently executable files.
Keep every original style/script tag, comment, declaration, wrapper and inline handler in the same output position.
During extraction the uncut tail is `999-remainder.html.part`, always explicitly listed; replace only the relevant manifest entry or entries.
Step 0 documents `src/` and the tooling in `REPO_MAP.md`, including one row pointing to `src/index/INDEX.md`; later cuts regenerate the map without per-file paperwork.
`INDEX.md` has one row per manifest fragment: order, filename, line count and first banner comment found in that fragment (or an em dash if absent).
For a deterministic map, count LF-delimited lines plus a final nonempty unterminated line; select the first standalone HTML/block comment or decorated line-comment banner in source order.
Use its first nonempty descriptive line, excluding delimiters/decoration; escape Markdown table characters and omit timestamps.
Document that narrow banner rule in the builder; fragments without a banner need no source edits to supply one.
`test/index-build.js` independently derives the expected rows from the manifest and fragments and fails if `INDEX.md` differs, so the unit lane catches a stale map.

## Step 0, the proof

First implementation PR: **exactly two content files**, `000-head.html.part` and `999-remainder.html.part`.
Split at the literal `<` of the first `<script>`, at line 27, including its four preceding spaces in the head.
This is the early boot script, not the Chart.js tag at line 232 or the main app script at line 8585.
The manifest lists those two names in that order. Do not extract CSS or any function yet.

Only this PR adds build/check scripts, npm aliases, unit-job wiring, generated-map support, attributes and gate tests.
Add `index.html linguist-generated=true` to `.gitattributes` while preserving its LF rule, so GitHub collapses the generated page diff.
Add this exact line to both `CLAUDE.md` and `AGENTS.md`: "index.html is a build output; edit src/index/ fragments and run npm run build:index, never edit index.html directly".
Prove the positive case with build/check, empty output diff and the two fast suites named below.
In disposable fixtures, prove the check rejects a changed byte, reordered/missing/duplicate part, line-ending conversion and altered EOF newline.
In a disposable Git fixture, prove a source/output edit passes once both are committed; an uncommitted output change still fails against HEAD.
Prove a stale `INDEX.md` fails the map test after a manifest/fragment change and passes after regeneration; restore every sabotage before committing.
Record the full hash, commands and results in the PR body; run one Codex round and merge only on green.
No new logs, journal entries, ledger allocation, runtime flags, database work or live drills are needed.

The exposure gate scans added lines: copying old application content into new paths can flag existing identities.
Keep the gate unchanged and report any such finding without printing identities; do not redact bytes, add exemptions or claim byte identity waives the public-repo rule.
A real finding requires an owner decision before publishing that cut; this plan authorizes no exposure exception.

## The cut list

Anchors below were verified with `grep -n` on the measured baseline, with short boundary samples only.
Ranges are start-inclusive/end-exclusive; numbers are navigation aids, not a substitute for matching the quoted anchors.
Except for the literal Step-0 split, cut at the **start of the complete anchor line**, retaining all indentation and preceding bytes.
For repeated comment openers, select the one immediately before the quoted heading; for script tags use the indicated occurrence.
Quoted shortened comments are literal matching prefixes. Preserve attached text as-is, even when the preceding fragment retains a related comment.

CSS first: cut 1 extracts its first range from the middle of the remainder, retaining the prefix as `005-head-boot.html.part`.
That retained prefix covers the first script token at L27 through L232 (about 206 lines), ending before "`<style>`" at L233.
The Step-0 head remains about 26 lines plus four spaces. Cut 2 extracts the rest of CSS; cut 3 extracts the shell.
Then cut JavaScript in existing order; each subsequent row splits the current tail.
Step 0 and cut 1 each get a single PR. Once both have merged, group 3–5 consecutive numbered cuts per PR; check byte identity after every individual cut.
Prefer seven batches for cuts 2–34: 2–6, 7–11, 12–16, 17–21, 22–26, 27–30 and 31–34.
Cut 34 also renames the final tail to `350-footer.html.part`; it does not need a separate PR.

| Cut | Start anchor → exclusive end anchor | Baseline lines; approximate size | Result in `src/index/` |
|---|---|---|---|
| 1 | "`<style>`" (L233) → "`/* ── Templates view ── */`" | 233–4138; 3906 | `010-styles-foundation.css.part` |
| 2 | "`/* ── Templates view ── */`" → "`</style>`" | 4139–8135; 3997 | `020-styles-surfaces.css.part` |
| 3 | "`</style>`" → "`<script>`" (unindented app tag, L8585) | 8136–8584; 449 | `030-body-shell.html.part` |
| 4 | "`<script>`" (unindented app tag, L8585) → "`// ── Market Research Brief Tab Renderers`" | 8585–10947; 2363 | `040-shared-briefs.js.part` |
| 5 | "`// ── Market Research Brief Tab Renderers`" → "`function _tplRenderColorSetsView(name, hlOff) {`" | 10948–12528; 1581 | `050-market-briefs.js.part` |
| 6 | "`function _tplRenderColorSetsView(name, hlOff) {`" → "`/* ── Workload Calendar ── */`" | 12529–14316; 1788 | `060-templates-filming.js.part` |
| 7 | "`/* ── Workload Calendar ── */`" → "`async function initWorkloadView() {`" | 14317–17539; 3223 | `070-workload-source.js.part` |
| 8 | "`async function initWorkloadView() {`" → "`// ── Sub-issue popover`" | 17540–20872; 3333 | `080-workload-render.js.part` |
| 9 | "`// ── Sub-issue popover`" → "`/* ============================================================`" before "`CLIENT ONBOARDING MODULE`" | 20873–23485; 2613 | `090-workload-popovers-navigation.js.part` |
| 10 | "`/* ============================================================`" before "`CLIENT ONBOARDING MODULE`" → "`function _ptoClearValidation(errorId, controlIds) {`" | 23486–25737; 2252 | `100-onboarding-staff-controls.js.part` |
| 11 | "`function _ptoClearValidation(errorId, controlIds) {`" → "`function _calRuntimeFlagSlug(member) {`" | 25738–27761; 2024 | `110-time-off-reports.js.part` |
| 12 | "`function _calRuntimeFlagSlug(member) {`" → "`function _calMigratePostShape(p) {`" | 27762–30686; 2925 | `120-calendar-flags-write-repair.js.part` |
| 13 | "`function _calMigratePostShape(p) {`" → "`function _writeUiLegacyOutboxItems(surface) {`" | 30687–33432; 2746 | `130-calendar-model-cache.js.part` |
| 14 | "`function _writeUiLegacyOutboxItems(surface) {`" → "`function _calHydrateLinearMeta() {`" | 33433–36577; 3145 | `140-calendar-legacy-outbox.js.part` |
| 15 | "`function _calHydrateLinearMeta() {`" → "`function _calRefreshOrganize() {`" | 36578–39453; 2876 | `150-calendar-hydration-import.js.part` |
| 16 | "`function _calRefreshOrganize() {`" → "`function _calMoveLinkConfirm(pid) {`" | 39454–42170; 2717 | `160-calendar-organize-ui.js.part` |
| 17 | "`function _calMoveLinkConfirm(pid) {`" → "`async function _calFetchNativeBatchPostCounts(batches) {`" | 42171–44804; 2634 | `170-calendar-links-status.js.part` |
| 18 | "`async function _calFetchNativeBatchPostCounts(batches) {`" → "`function _calHasMedia(p) {`" | 44805–47458; 2654 | `180-calendar-native-post-media.js.part` |
| 19 | "`function _calHasMedia(p) {`" → "`function renderLinearView() {`" | 47459–50424; 2966 | `190-calendar-approval-comments.js.part` |
| 20 | "`function renderLinearView() {`" → "`/* ============================================================`" before "`PRODUCTION PREVIEW (Track B B2) / AUTHORITY-GATED WRITE UI`" | 50425–52446; 2022 | `200-intake-data-startup.js.part` |
| 21 | "`/* ============================================================`" before "`PRODUCTION PREVIEW (Track B B2) / AUTHORITY-GATED WRITE UI`" → "`function _prodConfiguredProjectIds(value) {`" | 52447–55448; 3002 | `210-production-state-writes.js.part` |
| 22 | "`function _prodConfiguredProjectIds(value) {`" → "`function _prodCreateParentChange(value) {`" | 55449–58102; 2654 | `220-production-attribution-views.js.part` |
| 23 | "`function _prodCreateParentChange(value) {`" → "`function _prodSyncDescriptionRow(id, value, updatedAt) {`" | 58103–60699; 2597 | `230-production-create-comments.js.part` |
| 24 | "`function _prodSyncDescriptionRow(id, value, updatedAt) {`" → "`function _prodLayerPop(html, x, y) {`" | 60700–63306; 2607 | `240-production-description.js.part` |
| 25 | "`function _prodLayerPop(html, x, y) {`" → "`function _prodManualRefresh() {`" | 63307–66008; 2702 | `250-production-controls-data.js.part` |
| 26 | "`function _prodManualRefresh() {`" → "`    // >>> SXR_BEGIN`" (exact four-space line, L68177) | 66009–68176; 2168 | `260-production-refresh-boot.js.part` |
| 27 | "`    // >>> SXR_BEGIN`" (exact four-space line, L68177) → "`function _sxrRenderBody(opts) {`" | 68177–70872; 2696 | `270-samples-model.js.part` |
| 28 | "`function _sxrRenderBody(opts) {`" → "`function _sxrLegacyPushStatusToLinear(issueUrl, status, meta) {`" | 70873–73759; 2887 | `280-samples-cards-notes.js.part` |
| 29 | "`function _sxrLegacyPushStatusToLinear(issueUrl, status, meta) {`" → "`/* ============================================================`" before "`TIKTOK UPLOAD MODULE`" | 73760–75569; 1810 | `290-samples-writes-review.js.part` |
| 30 | "`/* ============================================================`" before "`TIKTOK UPLOAD MODULE`" → "`/* ============================================================`" before "`TIKTOK PILOT MODULE`" | 75570–77247; 1678 | `300-tiktok-upload.js.part` |
| 31 | "`/* ============================================================`" before "`TIKTOK PILOT MODULE`" → "`// KASPER_UNLOCK_KEY + _kasperUnlocked were hoisted up to before init()`" | 77248–79216; 1969 | `310-tiktok-pilot-sales.js.part` |
| 32 | "`// KASPER_UNLOCK_KEY + _kasperUnlocked were hoisted up to before init()`" → "`async function _kasperRenderReview() {`" | 79217–81994; 2778 | `320-kasper-dashboard-replies.js.part` |
| 33 | "`async function _kasperRenderReview() {`" → "`function _kedPaint() {`" | 81995–84436; 2442 | `330-kasper-review-history.js.part` |
| 34 | "`function _kedPaint() {`" → "`</script>`" (first unindented closing tag, L85725) | 84437–85724; 1288 | `340-editors-date-picker.js.part` |
| Final tail, retained in cut 34 | "`</script>`" (L85725) → EOF after "`</html>`" | 85725–86122; 398 | `350-footer.html.part` |

**Non-clean family boundaries stay mixed.** The Templates CSS heading is followed by Workload media rules; retain those in the second CSS fragment.
Workload popovers lead into approval/navigation, staff controls into time-off/reporting, and Calendar functions interleave with `_writeUi` and `_linear` helpers.
Production refresh leads into boot code; Samples includes its own review code; TikTok pilot leads into sales intake.
Use the listed complete function/comment boundaries and mixed filenames, not a family-name search that gathers noncontiguous code.
Do not relocate constants or hoisted unlock state to their apparent owner; do not close/reopen any enclosing scope to make a fragment parse alone.
The footer retains the original main-script closing tag, intervening HTML, last inline script and document closing tags together.
All final content fragments are below 5,000 lines (largest: 3,997); the temporary remainder exceeds that until extraction finishes.

## Changing the site during the split

An ordinary fix edits the relevant fragment (including `999-remainder.html.part` while that region is uncut), runs `npm run build:index`, and commits the fragment and `index.html` together, plus regenerated `INDEX.md` if changed.
Run `npm run check:index` after committing: it passes because assembled bytes equal the working-tree and committed page, even though the page differs from main.
Run the tests and review required for the fix; it is a separate PR, never mixed into a structural cut batch.
Cut PRs always start from latest main. Never have two open PRs touching the same fragment; the executor checks open PR paths before starting.
Disjoint fixes can proceed alongside the one split PR; resolve generated `index.html`/`INDEX.md` conflicts by rebuilding from merged fragments, never hand-editing the outputs.
If main advances during a cut PR, incorporate latest main, re-cut from its current fragments as needed, and repeat the cut-only empty-diff check and tests before merge.
Keep this scheduling check human and explicit; no new locking service or workflow is needed.

## Per-cut procedure

1. Fetch main successfully, start a clean branch from latest main, and confirm one split PR only and no other open PR touches the planned fragments.
2. Cut the next listed contiguous bytes, preserve the remainder, and update the ordered manifest and affected fragments.
3. Run `npm run build:index`, `npm run check:index`, then `git diff --exit-code -- index.html`; repeat steps 2–3 for each of the PR's 3–5 cuts after the two single-PR pilots.
4. Run `node test/run-all.js` (including the generated-map test) and `node docs/syncview-design/tests/prod-write-gateway-browser.js` once per completed batch; retain existing CI gates.
5. Commit; run `npm run check:index`, `git diff --exit-code origin/main...HEAD -- index.html` and `node scripts/repo-identity-exposure-check.js --diff="origin/main"`.
6. Push and open the cut PR; put the cut range, output hash, empty-diff result and fast-suite results in its body.
7. Complete one Codex review round on the candidate; address findings before merge, with a focused re-review only if a correction requires it.
8. Before merging, refresh main and incorporate any intervening fixes, rerun checks if changed; merge on green, fetch main, then start the next batch; never stack split PRs.

## Supervisor checklist for each PR

1. Check the paths: after Step 0, only expected fragments/manifest/generated `INDEX.md`; run `git diff --exit-code origin/main...HEAD -- index.html` against freshly fetched, incorporated main and require an empty diff.
2. Read the unit results: assembled/working-tree/committed bytes match, `INDEX.md` matches the fragments, and both fast suites are green on the final commit.
3. Confirm the cut range's anchors/order, one completed Codex round with no unresolved findings, one split PR only, and no other open PR touching its fragments.

These are under-a-minute checks of recorded evidence, not another test run or full-file review.
A failure is investigated at the failing assertion against freshly fetched main; a similarly red baseline is not permission to merge.
The [retrospective](../retrospectives/2026-09-20-linear-exit-retrospective.md#what-actually-caught-bugs) ranks Codex review first, with at least 14 concrete findings; byte-identical cuts retain one round.

## What happens to the tests that slice index.html

**Nothing.** The [retrospective's measurement](../retrospectives/2026-09-20-linear-exit-retrospective.md#the-indexhtml-test-coupling-measurement) counts **249 test entry points**: 247 under `test/`, one under `docs/syncview-design/tests/`, and one under `scripts/`.
Of these, 246 read the text directly and three delegate to helpers. Keeping the committed assembled artifact byte-identical preserves their anchors, neighboring declarations and extracted inputs.
The existing browser suite executes the assembled page; no assertion is deleted, relaxed or redirected to accommodate a cut.
Later, consider pointing these readers at source files deliberately. That changes test inputs and extraction contracts, so it is explicitly out of scope for this split.

## Rollback

Revert the cut with `git revert`; rerun build/check to prove the restored source layout assembles the same committed page (reverting Step 0 removes the tooling and leaves the already-identical page).

## Done criteria and a rough count

Done means all 34 numbered cuts merged, no `999-remainder.html.part`, 37 content fragments in manifest order, no fragment over 5,000 lines, an up-to-date generated map, and every cut PR leaving the page unchanged against its current main base.
There are **39 files under `src/index/` including the manifest and `INDEX.md`**, plus the two scripts and one gate test created in Step 0; `index.html` remains committed.
Budget **9–13 implementation PRs**: Step 0 and cut 1 singly, then 7–11 PRs carrying the remaining 33 cuts in groups of 3–5; **10–14 including this strategy PR**.
The preferred seven-batch schedule needs **9 implementation PRs**. Estimate **2–3 working days** for one session, including CI and one Codex round per PR.
This assumes a working baseline and no exposure finding, review queue delay or substantial rework from intervening fixes; fix PRs and optional later passes are excluded from the budget.
After completion, feature authors continue editing fragments and regenerating the committed output and map; the three-way byte check remains useful for ordinary changes.

## What changed from the existing plan and why

Starting point: [draft PR #1389](https://github.com/sidney-afk/client-analytics/pull/1389), branch `claude/sleepy-sagan-t2t3ac`, `docs/MODULARIZATION_STRATEGY.md`; this plan supersedes its split strategy without merging that draft.

- **Replace external CSS/classic scripts and later ES modules with offline concatenation into the same document.** Externalization changes loading; modules change scope. Neither is necessary to split source files.
- **Keep ES modules and state ownership out of scope because of D28.** The [retrospective](../retrospectives/2026-09-20-linear-exit-retrospective.md#what-actually-caught-bugs) records extracted `applySettledWorld` referencing an out-of-scope `j` while export/call/single-source assertions passed. It does not say ES modules caused D28; it demonstrates why changing scope is separate work. Here no execution boundary changes.
- **Replace the exhaustive globals/handlers/dependency census with verified contiguous cuts and a two-file proof.** Nothing changes ownership, handlers or evaluation order, so a census would delay this mechanical task.
- **Strengthen textual move integrity into whole-output byte identity.** Compare assembled, working-tree and committed bytes; do not freeze a baseline digest. The old scope warning remains correct; the cut-only main diff proves that a structural PR preserves the complete document.
- **Keep the 249 slicing tests unchanged and retain both fast suites plus one Codex round.** Remove new temporal-rule projects, visual-baseline projects and feature-specific acceptance expansion; no behavior or pixels change.
- **Serialize split PRs while allowing ordinary fixes to distinct fragments.** Start cuts from latest main, regenerate shared outputs after merging fixes, and never overlap open PRs on a fragment.
- **Batch 3–5 cuts after two single-PR proofs and generate the source map.** This reduces review/CI cycles without losing per-cut byte checks; unit coverage prevents navigation metadata from going stale.
- **Use one PR evidence record, not repeated Production/journal/ledger updates.** The retrospective found real coordination cost in duplicated status and numbering. Existing public-identity and required CI protections remain.

## Second pass, decided after the split

Optional future work only; neither pass is part of this plan's implementation, acceptance or budget.
First, consider sub-splitting any fragment over 2,000 lines at function boundaries, preserving order under the same three-way byte-identity gate and the cut-only empty diff against main.
Separately, consider a tidy pass moving functions from the four mixed fragments `090-workload-popovers-navigation.js.part`, `100-onboarding-staff-controls.js.part`, `260-production-refresh-boot.js.part` and `310-tiktok-pilot-sales.js.part` into their family fragment.
That reordering changes output bytes and can change scope, initialization or execution order: use a different behavior-preservation gate (tests plus a real page load exercising the moved functions), not a claim of unchanged output.
Keep the three-way assembly-consistency check, but do not require the tidy PR's page to equal main; decide scope and acceptance separately after the split, with D28 in mind.

## Execution notes (appended as the split runs)

- **Step 0 merged 2026-09-21 as #1464; cut 1 opened as #1465.** Page hash unchanged throughout: `5990e9fc9495c7420dad4bf55f4699f61a964f802be2927a513103efe28de745`, 5,768,894 bytes.
- **The `package.json` edit ripples into two hash pins.** Adding the two npm aliases changed the committed bytes of `package.json`, which `scripts/f27-reconciler-closure.js` (`REVIEWED_BLOB_SHA256`) and `docs/audits/2026-07-17-pto-lifecycle-simulation/manifest.json` (`source_tree_sha256`) pin. Both were re-pinned from tooling, never by hand, with the file's own comment convention. No numbered cut touches `package.json`, so this was Step 0 only.
- **The identity gate and moved bytes.** `scripts/repo-identity-exposure-check.js --diff` counts an added line whose exact bytes already exist as a line in the base's `index.html` as not-new — and only when the destination path is `src/index/*.part`. The first version exempted any destination; the Codex bot's P1 on #1464 was right that this would have been a permanent bypass, and it was scoped before merge. `test/repo-identity-exposure-moved-lines.js` proves all three directions with synthetic names.
- **`production-polish` can go red on a byte-identical page.** #1464's first run failed at "Production structure subset, page_error_pending_read" during a window when the Supabase API was returning 502s; the next push passed on the same bytes. The tell is the page hash: if it equals main's, the lane failed for a reason outside the PR. One re-run, then look elsewhere.
- **The supervisor does the open-PR check.** The executor's first two PRs each spent ~250k tokens surveying every open PR for `src/index/` paths. The plan's "no other open PR touches the planned fragments" gate is now the supervisor's, stated in each batch prompt; the executor does not survey.
- **Ordinary fixes may run alongside a cut PR when their hunks are in a different region of the remainder.** Two fix sessions were dispatched during cut 1 (calendar archive-park, Production batch-view ordering). They edit `999-remainder.html.part` in regions cut 1 does not move; each rebases onto merged main and rebuilds before merge. The rule that matters is "never two open PRs moving the same bytes", not "never two open PRs naming the same file".
- **2026-09-21: the split is complete.** All 34 numbered cuts landed; `999-remainder.html.part` is retired (deleted, dropped from `manifest.txt`) and `350-footer.html.part` carries the original tail through `</html>`. `src/index/manifest.txt` lists 37 content fragments. The served page is byte-unchanged throughout the whole split: `6b5f44936a5e5123cdeb343b778430be3d8680bb418b0a89a01046253bdf483d`, 5,776,430 bytes, matching `npm run check:index`'s three-way assembled/working-tree/committed comparison on the final commit.
