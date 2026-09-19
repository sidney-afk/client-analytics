# Step 26/27 — native Workload

Execution-map phase 7, for the one capability `native_workload`.

This is a scoped, repository-only plan. It records committed source as of main;
it does not claim a live database read, a deployed function version, or a flag
state. No client, staff, token, or other private value belongs in this file.

## What this capability replaces

| Current dependency | What it fetches / does | Native equivalent on main | Exit verdict |
|---|---|---|---|
| `LINEAR_ISSUES_WEBHOOK` | Normal `loadLinearIssues()` already returns `wlFetchNativeSnapshot()` for boot, refresh, and snapshot adoption. The remaining caller is `wlDiscoverProviderIssues()`: a side-effect-free, no-cache provider read used only by the legacy Calendar post-create linker. | `workload_native_snapshot_v1()` is the normal rendered source and returns native rows, compatible plan rows, roster, authority, and native metadata. `workload-plan` already resolves native IDs without rewriting saved plan keys. | **Normal Workload reading is replaced. The post-create discovery dependency is not.** It must have a native replacement or reach zero dependent legacy rows before this webhook can retire. |
| `LINEAR_TWEAK_COMMENTS_WEBHOOK` | `wlFetchTweakComments()` POSTs displayed issue IDs and renders up to three provider comments in the Tweak Needed popover, with a short cache. | `production-comments` has a staff-only legacy-feedback projection from the linked Calendar/Samples tweak cells, in addition to canonical native comments. It needs a valid native deliverable-to-card binding. | **Partial.** It covers bound native rows; it does not cover unbound legacy rows, rows whose feedback only survived at the provider, or foreign/provider-authority rows without a native mapping. |
| `WORKLOAD_LINEAR_URL` / `workload-linear` | For `metadata`, validates active mirrored sub-issues then reads provider due dates and workload labels. For `set_due_date`, it authorizes a staff write, rechecks current provider team/authority, commits the provider due date, then best-effort updates `workload_issues`. | `production-write` already accepts native `due` writes from Workload with CAS; it also owns native `labels` writes and label receipts. The native snapshot carries verified due/label metadata. | **Built for SyncView-authoritative native rows.** It is not a substitute for a provider-authority/foreign team; those rows must remain explicit compatibility rows until their authority is migrated or they leave Workload. |

> **Correction, 2026-09-19 (read from `index.html`):** the feedback row above
> understates what is already wired. `wlFetchTweakComments()` already reads
> **native** rows' feedback from `production-comments`. Only **legacy** rows
> still read `LINEAR_TWEAK_COMMENTS_WEBHOOK`. The remaining feedback dependency
> is the legacy rows, not the popover as a whole.

`workload-linear` is source-only and deliberate-manual, with no CI deploy path.
The current browser routes a SyncView-authoritative due-date write to
`production-write`; its provider branch still calls `workload-linear`. Therefore
deleting or deploying `workload-linear` is not the Workload cutover. Retained
provider rows must keep their required provider route until a measured native
replacement exists or no dependent rows remain.

## Read this before anything else: blockers

| | Blocker | Why it blocks closure |
|---|---|---|
| B-1 | The remaining `linear-issues` call is post-create discovery, not normal Workload loading. | The legacy Calendar linker polls provider-created parent/sub-issues before the native snapshot can see them; removing the webhook without replacing this handoff makes cards unlinked or duplicated. |
| B-2 | Native feedback is conditional on a durable card binding. | Missing/broken bindings make `production-comments` return an explicit non-complete state; silently treating that as an empty thread would hide tweaks. |
| B-3 | Provider-authority/foreign-team rows are deliberately legacy. | The snapshot labels them `legacy`; neither `production-write` nor the native feedback projection can safely invent ownership or edit authority for them. Their provider routes cannot be removed merely by hiding native controls. |
| B-4 | Retirement has an unmeasured dependency condition. | Closure needs a measured replacement for post-create discovery and each retained provider route, or a measured zero of rows/callers that still require it. An owner disposition alone is not independence. |
| B-5 | The source-only Edge Functions need an operator release, not a merge. | `workload-plan`, `production-comments`, and `production-write` may need exact reviewed closures deployed after their SQL prerequisites; `workload-linear` has no CI deploy lane at all. |

### Explicit coverage boundary

The native path must report—not drop—these rows:

- Legacy rows already present in `workload_issues` but absent from the native
  snapshot or without a native deliverable/card binding.
- Foreign/provider-authority rows. They remain `source: 'legacy'` compatibility
  rows by design. No native due-date, label, or feedback claim applies to them.
- Native rows with no provider UUID are valid native work and are not “diff
  failures,” but they cannot be compared one-to-one against the provider mirror.

Closure requires a measured count for each category and a native replacement or
zero remaining dependent rows for every retained provider route—not an owner
disposition, hidden native controls, or a blanket assertion that the native
board covers the estate.

## Gate 0 — read-only checks before code or flags

Run these in the execution session using approved read-only access. Record only
aggregate counts and pass/fail receipts in the public checkpoint.

1. Read `prod_authority`, the native snapshot routine/version, and the native
   Workload SQL prerequisites. Confirm the snapshot returns a complete object,
   including authority, rows, plans, and roster.
2. Run `window.wlNativeDiff()` against the deployed browser. Record counts for
   native-only, provider-only, never-mirrored, field differences, and
   spelling-only status differences. A zero in compared fields is not evidence
   that excluded identity/URL/assignee fields match.
3. Read aggregate counts by snapshot `source`, active state, team bucket, and
   feedback binding state. Separately count provider-authority/foreign rows.
4. For a bounded TEST fixture only, read the current native due/label metadata,
   plan mapping, and feedback projection. Do not write in Gate 0.
5. Read deployed fingerprints for every Edge Function this release will call;
   compare them with the reviewed closure. A repository file is not proof of a
   deployed function.
6. Inventory every `wlDiscoverProviderIssues()` caller and the persisted Calendar
   job resume path. Measure the count of outstanding legacy post-create jobs and
   the rows/routes they still need; identify a native acknowledgement/linking
   replacement or prove that count is zero before retirement.
7. Confirm every retained provider-authority/foreign row has its required
   provider route and an independently measured replacement plan. Do not count
   a hidden native control as a replacement.

Stop if the snapshot is incomplete, a prerequisite is absent, a claimed native
row is not native-writable, or any category above is uncounted.

## What needs code

1. Preserve the existing normal `wlFetchNativeSnapshot()` load path and its
   explicit legacy rows; do not regress it back to the provider reader.
2. Replace the legacy Calendar post-create discovery/linking protocol:
   `_writeLinearVideoCardsToCalendar()` and its persisted resume path currently
   call `wlDiscoverProviderIssues()` to find newly created provider parents and
   sub-issues, then create/link Calendar cards. The replacement must return the
   exact native card/deliverable links within that bounded window and retain its
   idempotent retry/recovery semantics.
3. *(Native rows already route to `production-comments`; see the correction above. What remains is the legacy rows.)* Route the popover to `production-comments` for native rows; render explicit
   incomplete/unmapped/source-unavailable states, never an empty comment list.
   Keep the legacy reader only for the explicitly retained provider rows during
   the compatibility window.
4. Make all due-date and workload-label reads/writes use the snapshot and
   `production-write` for native rows. Remove `workload-linear` only after the
   browser has no provider write route and all foreign rows have a measured
   native replacement or zero remaining dependency.
5. Add browser and disposable-PostgreSQL coverage for mixed authority,
   never-mirrored rows, legacy/unbound feedback, plan-key compatibility,
   native due CAS, label receipts, post-create linking/retry recovery, and
   refresh/outage behavior.
6. Update the endpoint and Workload truth documents in the same source change.

## Deploy lane and flag

- **SQL first:** apply the reviewed native Workload snapshot/roster and plan
  compatibility prerequisites through the owner-approved database lane. This
  document authorizes no database access or write.
- **Functions:** use the owner-run, exact-SHA deliberate-manual release lane for
  `workload-plan` and any changed `production-comments` / `production-write`
  closure; read back fingerprints. `workload-linear` has **no CI deploy path**
  and should not be deployed merely because it is being replaced.
- **Browser:** publish the exact reviewed Pages commit only after the SQL and
  function checks pass.
- **Flag:** the governing authority flag is `prod_authority`. It must be read
  immediately before each action; it is not changed by this capability. A
  temporary browser source switch, if implemented, must be non-sticky,
  explicit, and removable before the provider mirror stops. Never use a flag to
  classify an unknown/foreign row as native.

## Step 27 — acceptance checks

| # | Acceptance check | Measurement |
|---:|---|---|
| 1 | Native snapshot is structurally complete. | Read-only invocation returns complete authority, rows, plans, roster, and per-row source/identity fields; malformed or missing sections fail closed. |
| 2 | Normal native-team board load stays native. | Browser network capture plus source test: boot, explicit refresh, and snapshot adoption call `wlFetchNativeSnapshot()` and do not call `wlDiscoverProviderIssues()` or `linear-issues`. |
| 3 | Legacy Calendar post-create linking is independent before `linear-issues` retires. | Source and browser/disposable-fixture tests cover creation and persisted-job resume: the replacement returns exact card/deliverable links inside the discovery window, retries idempotently, and never falls back to provider discovery. Alternatively, a read-only aggregate proves zero remaining callers and zero resumable jobs. |
| 4 | Native rows render with the same workload-visible fields. | Fixture/browser comparison for title, status, team, assignee, client, due date, active filtering, capacity, and plan placement; report excluded fields separately. |
| 5 | Saved plan days survive the identity switch. | Disposable PostgreSQL test plus TEST drill: a pre-existing provider-keyed plan and a never-mirrored native row both read and save through the compatibility RPC, with no duplicate/orphaned plan. |
| 6 | Native due-date writes use the native gateway. | TEST-only write receipt has exact native row/CAS acknowledgement; reload shows the new value; stale CAS is refused; network capture contains `production-write`, not `workload-linear`. |
| 7 | Native workload labels are complete and authoritative. | TEST-only label read/write receives a complete catalog and selected-label receipt; invalid/incomplete label state is refused rather than defaulted. |
| 8 | Tweak feedback is truthful. | Bound native fixture shows the expected feedback; unbound, changed-binding, source-limit, and source-unavailable fixtures show explicit states and never render a false empty thread. |
| 9 | Retained provider rows are actually replaced or gone. | Read-only aggregate identifies every provider-authority/foreign row and route; for each category, prove an equivalent native route or a zero remaining dependent-row count. Hidden controls and owner disposition do not pass this check. |
| 10 | The native/provider comparison is explained. | `wlNativeDiff()` receipt records all five categories from Gate 0, with a replacement-or-zero result for every non-zero provider-only/foreign count. |
| 11 | Failure is legible. | Simulated snapshot timeout/error preserves the last verified snapshot or shows a clear unavailable state; it never silently calls the provider fallback. |
| 12 | Release provenance is exact. | SQL receipt, reviewed commit SHA, function fingerprint readbacks, and browser release identity agree; no function is inferred deployed from a merge. |
| 13 | No public exposure regresses. | `node scripts/repo-identity-exposure-check.js --diff="origin/main"` passes on the final commit. The first attempt could not run it: authorized execution was not available, and no substitute was used. **Update, 2026-09-19:** Storage then ran it with authorized access against `origin/main` `0b2f16ae` on candidate `6a0ea50d`. It **passed**: 53 roster terms checked, 0 client slugs and 0 staff names added, in 0 files. The abbreviated commits above are superseded as evidence: the authoritative result for the final commit, with the full checked head and base SHAs, is the [PR #1432 exposure receipt](https://github.com/sidney-afk/client-analytics/pull/1432#issuecomment-5744603087). |

## Step 28 — closure sense

Close `native_workload` only when all Step 27 checks pass, normal loading remains
native, and the post-create Calendar discovery/linking dependency has an
equivalent native handoff or zero remaining callers/resumable jobs. Every
retained legacy/foreign provider route must likewise have an equivalent native
route or zero remaining dependent rows. Then retire the three browser
dependencies in order: provider discovery, provider feedback fallback, and
`workload-linear` route/function. Preserve the checkpoint with aggregate
evidence and the exact rollback boundary.

Do not call this closed because a native view, a gateway, or a flag exists. The
capability is closed only when Workload can load, plan, edit metadata, and show
feedback without Linear for every row it claims is native—and clearly excludes
the rows it does not claim.
