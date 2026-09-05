# Task 3 handoff — Workload and cross-view consistency

Workload is not yet proven usable without Linear. This pass adds executable,
synthetic evidence without changing application code. Five native-independent
product contracts remain red; live affected-record counts are **UNPROVEN**.
These are qualified source/simulation gaps, not five measured production incidents.

## Bounded eligibility correction after independent review

Review of draft head `519b49097b298fe1939338db8843574649ef805e` identified a
confirmed **P2 tooling defect**: the comparator counted every absent active
native child as missing from Workload without proving roster/date eligibility.
Its own C17 already showed that unassigned-undated Todo and off-team work can
legitimately be excluded. The comparator correction changes no application or
backend source and performs no live reads.

The same 16 correction fixtures give **7 PASS / 9 FAIL on the reviewed
comparator**, and **16 PASS / 0 FAIL after correction**. `evidence.json` →
`eligibilityCorrection` preserves exact expected/actual counts, the baseline
head and comparator/test hashes, and corrected helper/tool hashes and times.
The final targeted finite runner gives **45 PASS / 0 FAIL**; the five cutover
contracts still give **5 FAIL**, exit 1. Required map/truth checks passed; the
full suite was not repeated, per the bounded review mandate. Earlier full-suite
and serving evidence below remains historical and is not refreshed by this pass.

| Missing-observation case | Correct classification |
| --- | --- |
| Assigned, correct roster/team and client, complete Workload input | One genuinely missing eligible item |
| Unassigned Todo, both deadline and saved plan explicitly absent | One legitimate exclusion; zero missing |
| Unassigned with a deadline, a saved plan, or In Progress status | Still eligible; do not subtract all unassigned items |
| Name excluded by that row's actual team allowlist, or client excluded by the complete client roster | One legitimate exclusion; zero missing |
| Missing/incomplete roster, unknown owner, projected client name, or needed plan lookup | Unknown eligibility; zero asserted missing/excluded |
| Proven eligible, incomplete Workload input | Absence unproven; zero asserted missing |
| Observed filtered row | A filtering discrepancy only if canonical work is eligible; legitimate exclusions stay separate |

The comparator now executes the actual client/editor predicates and bucket
function with explicit policy evidence. Member role/team discrepancies remain
separate: those fields do not replace Workload's current name allowlists.
The original synthetic example still has one missing eligible native-only item;
it now supplies the roster and projected-name/plan evidence that justifies it.
Snapshots lacking that evidence now report unknown instead of false missing totals.

The five retained cutover tests mean precisely: the loader ignores native-only
population; forced refresh needs the provider; a saved-plan identity loss is
**conditional on changing the displayed key without compatibility**; repository
validator source rejects native IDs through its mirror lookup; and static-roster
membership is simulated. None is a measured live incident count. New C29 proves
that unchanged old IDs retain their saved dates, native-key entries resolve
independently, conflicting keys are not merged, and clearing the native key does
not fall back to or erase the old entry. No identity migration was implemented.

## Source and serving provenance

- Isolated clone/branch: `qa/workload-consistency-20260905`.
- Fetched remote main: `706359752e861969e6c68898daa26e29a2eb6edb` at
  `2026-09-05T06:37:08.4338823Z`. The coordinator's older reference was not used.
- Tested application SHA-256:
  `8f64f648d4b92ac2147bd9ecf3c3f0747f4081331df275b8c10ff25e0f10c53a`.
- **LIVE_READ:** one GET of the public site root, completed
  `2026-09-05T06:39:08.4139873Z`, returned bytes with that same SHA-256. This
  refreshes the September 4 browser-source uncertainty for this captured HTML
  only. It does not establish a Pages deployment ID, another cached browser's
  revision, API contents, or an Edge Function deployment revision.
- `workload-plan` / `workload-linear` deployed source remains **UNPROVEN**.
  The deliberate-manual entries in `EF_DEPLOY_MANIFEST.md` are source inventory,
  not current serving proof. The plan validator source hash is recorded in
  `evidence.json`; it was never deployed by this task.
- `evidence.json` pins each tool run to its actual checkout head and SHA-256 of
  every consumed source/helper/tool file. Publication head is separate from the
  application source tested; report/registration additions do not change it.

## Current ownership trace

Locations below refer to the pinned application SHA above, not historical line
numbers. They were re-found and inspected in this checkout.

| Owner | Current source location and contract |
| --- | --- |
| Board population | `index.html:14426` `loadLinearIssues`; `:14117` `_wlV2FetchIssues`; `:14159` `_wlNativeDiffEnabled`. Cache/mirror/provider feed the board; native diff is separate. |
| Actual bucket membership | `index.html:16528` `wlApplyData`; `:15672` `wlIsActiveStatus`; `:15770` `wlIsAllowedEditor`. The source-helper tests execute these instead of substituting the diagnostic scanner. |
| Internal plan | `index.html:14501` `wlFetchPlanRows` reads staff `action=list`; `:15874` `wlPlanDate` joins by row ID; `:15877` `wlAutoPlanDate` derives a work day; `:17269` `wlSetPlanDate` uses optimistic UI with exact receipt/revert handling. |
| Plan target authority | `supabase/functions/workload-plan/index.ts:162` `requireWritableIssue`, called before `setPlan`. A live list/readback or server persistence test was not executed. |
| Canonical due authority | `index.html:14681` `wlFetchNativeMetadata`; `:14892` `wlFetchLinearMetadata`; `:16760` `wlDueWriteRoute`. Current authority and a scoped native target govern due routing, while base population/status/assignee still come from the feeder. |
| Linked card semantics | `index.html:25610` `_writeUiNativeId` selects the component-specific deliverable; `:30038` `_calMapNativeStatusStrict` defines card status vocabulary. `:33037` `_calAdoptDeliverableLinks` and `:61986` `_sxrAdoptDeliverableLinks` can write during loading, so neither was invoked live. |
| Production input | `production_deliverables_browser_v1`, backed by native deliverables. The comparator accepts this observation separately from the canonical store. No client/role-filtered live Production census or visible journey was performed. |

## Executed validation

- **OFFLINE_TEST:** `node test/run-all.js` (the `npm test` entrypoint), once,
  `2026-09-05T06:51:15.169Z`–`06:55:10.859Z`: **397/399 suites exited zero**.
  All **15 `test/workload-*.js` suites passed**, including all seven requested
  suites. `repo-map-sync`: 275 checks passed; `truth-sync`: 526 checks passed.
- The full run remains **FAIL**, exit 1. `asset-access-any-team.js` stopped on
  Windows `ERR_UNSUPPORTED_ESM_URL_SCHEME`; `assurance-ledger-staleness.js`
  stopped on an unavailable hardcoded `/tmp` directory. These are harness
  failures outside this task, not Workload product results. Shared tests were
  neither repaired nor rerun. Disposable PostgreSQL sub-lanes were skipped;
  a zero suite exit does not imply those database proofs ran.
- **OFFLINE_TEST (initial pass):** finite runner **28/28 PASS**, exit 0. Desired native
  independence contracts **0 PASS / 5 FAIL**, exit 1. Exact timestamps, source
  hashes, and fixed expected/actual results are in `evidence.json`.
- The existing Workload Linear helper suite logged a missing diagnostic-helper
  warning in its mocked context while its assertions passed. It is not treated
  as rendered native-diff proof. No actual browser was launched.
- New tooling was finalized separately from the full-suite run. The full suite
  exercised unchanged application/shared-test source plus the map registrations;
  its staged-tree stamp is the start-of-run snapshot, not a claim that later
  tool edits or the final publication commit were part of that earlier run.
- The other tasks' drafts were read only as coordination evidence: #1268 at
  `c1aa4d934d1a1532632842295cddaf0b176c1b73`, #1269 at
  `6f0ac283d12a7d5c02fe3066c70e12eeead29bc3`, #1270 at
  `be39f7972adf7617e0e9b828e39b1c4937b6b597`, #1274 at
  `92d50240cebe8dc6855a89e69c08f76bd0a1ddc1`. None was checked out, edited,
  merged, or treated as working-product proof; their heads may move.

## Findings and smallest next implementation gates

All five rows below are **OFFLINE_TEST**, using real extracted source and
synthetic inputs. Each reproduction is an individual contract in
`node qa/workload-consistency/run.js --contracts`. No live incidence is implied.

| Ref | Trigger; expected / actual | Why it matters; smallest next gate |
| --- | --- | --- |
| WLC01 | A native child exists without a Linear ID. Expected: included in normal board input. Actual: `_wlV2FetchIssues` reads only active `workload_issues`; `?wlnative=1` is diagnostic only. | New work can exist in native storage without reaching the editor's board. Implement a native population adapter with explicit structural child/root rules and prove native-only video and graphics in actual rendered Workload. Coordinate identity compatibility first; do not flip the diagnostic flag as a repair. |
| WLC02 | Force refresh while the provider endpoint is unavailable and a native source could answer. Expected: usable native refresh. Actual: `loadLinearIssues(true)` bypasses the mirror and rejects on the Linear-backed webhook. Normal empty/failed mirror reads also fall through there. | Refresh can fail precisely when staff need to recover, after Linear is retired. Route all refresh and fallback modes through a complete native read, then prove cold, cached, forced, and failed reads in an isolated browser. |
| WLC03 | Replace a row's displayed Linear ID with its native ID, retaining an explicit legacy mapping and a saved old-key plan. Expected: saved day still resolves. Actual: `wlPlanDate` looks up only `sub.id`, so the saved day is missing. | A source switch can make manually planned work appear to move. Define the compatibility lookup and collision rules before cutover; prove old-key, native-only, migrated, clear, and conflicting-key cases offline. No plan migration was performed or authorized here. |
| WLC04 | Validate a native-only target that has no mirror row. Expected: accepted after native ownership/structure validation. Actual: the repository `requireWritableIssue` reads `workload_issues` by ID and throws `409 issue_not_writable`. | Changing the browser source alone cannot enable plan persistence for these rows. Implement native-aware validation in a separate reviewed change with unchanged staff/client scope; obtain deployed-source evidence and a separately authorized persistence drill before calling it working. This fake-database test does not prove the deployed refusal. |
| WLC05 | An active creative belongs to the correct team but has a name absent from the static Workload allowlist. Expected: work visible for that current member. Actual: `wlApplyData` excludes it via `wlIsAllowedEditor`. | A future roster addition can remain invisible despite valid assignment. Supply a canonical roster adapter with stable identity joins and one capacity lane per person; prove new-member, renamed, legacy-ID, inactive, cross-team, and duplicate-alias cases. Current real membership discrepancies remain UNPROVEN. |

`wlFetchNativeMetadata` also queries native rows **by `linear_issue_uuid`** and
indexes the result by that field. This is **SOURCE_ONLY** corroboration of WLC01's
identity dependency, not a sixth independently counted blocker.

## What is consistent in the tested contract

The finite checks distinguish intended differences from defects. A manual plan
day overrides automatic placement without changing the canonical deadline;
automatic placement uses one working day before due, subject to capacity and
today's floor. A failed initial plan read falls back to the deadline. Native
`todo` maps to Calendar `In Progress`; approval states are legitimately absent
from the editor's active Workload buckets. Samples has no Scheduled/Posted
equivalent. Unassigned dated or in-progress work reaches Needs assignment;
unassigned undated Todo and off-team assignments are counted as exclusions.

Normal cold load, fresh cache, forced load, empty/failed mirror, healthy and
failed/missing/malformed authority reads, and native diagnostic versus board
input are executed with synthetic transports. Authority read failure stops
metadata routing. This proves helper behavior, not cold/cached DOM rendering or
server persistence. Existing plan and deadline suites retain receipt/revert,
identity-purge, native authority, refresh, and capacity assertions.

## Comparison counts and missing proof

The committed synthetic example has 2 native records, 2 Production observations,
2 provider observations, 1 Workload observation, 1 Calendar slot, and 0 Samples
slots. It intentionally seeds exactly **one each** of `provider_only`,
`owner_mismatch`, `status_mismatch`, `canonical_due_mismatch`,
`native_stored_but_filtered`, `native_missing_from_workload`, and
`card_binding_gap`. It also records one `native_only` classification and one
`intentional_date_semantics` observation. These are fixture counts, **not live
discrepancy counts**. Other finite cases cover duplicates, absent expected work,
unknown owners, incomplete views, and Samples-only bindings.

No complete authorized private snapshot bundle with established provenance was
found in the inspected adjacent task folders. No live data census was attempted.
The comparator keeps the canonical store, Production input, provider input,
Workload observations, and Calendar/Samples slots separate. An unknown or
unsupported field never becomes equality by copying authoritative data into the
observed side. Card identity includes scope and component; a record is not
required on both Calendar and Samples. Full population and visible consistency
remain **UNPROVEN** pending complete contemporaneous inputs and actual rendering.

## Scanner blind spots and safe use

The existing `scripts/workload-native-visibility-check.js` was read, never run or
imported. Its top-level IIFE immediately reads live data. It prints identifiers,
client values and raw discrepancy rows, including in JSON mode. Its filter
counts missing `linear_identifier` as stale and missing `raw_issue_parent_id`
as a batch parent, silently excluding native-only work. `workloadHides` does not
exercise client/assignee roster filters or Workload's actual buckets. An
unchanged count can also conceal changed membership. Existing offline scanner
tests validate the narrow classifier, not these omitted populations.

The browser native diff excludes identity fields, compares a bounded field set,
and never switches `wlState`. Its output is not proof of native visibility.
Calendar/Samples load paths can invoke link-adoption upserts: opening them without
request interception is not assumed read-only. No approval/comment journeys,
Samples reader repair, or native-intake work was duplicated.

## Assurance and stopping gate

One bounded site-assurance pass; Workload stays Tier 2. Its July 20 live proof is
expired (47 days as of September 5). This pass does not refresh that live-proof
date. `ISOLATED_BROWSER` is **NOT_TESTED**; `LIVE_WRITE_DRILL` is unavailable.
All five contract failures remain red. Next: review this draft's evidence, choose
the native identity compatibility contract, then implement WLC01–04 together
with isolated rendered proof. Establish complete private read inputs before
publishing any live discrepancy count. No merge or production action was taken.
