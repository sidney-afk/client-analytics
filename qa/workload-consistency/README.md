# Workload cross-view consistency

Task-owned offline comparator and finite source-helper checks. No application
changes, live requests, writes, browser boot, monitoring, or scheduled jobs.
The [handoff](REPORT.md) records this pass and its limits.

```sh
node qa/workload-consistency/run.js
node qa/workload-consistency/run.js --contracts
node qa/workload-consistency/run.js --compare /absolute/private/normalized-snapshot.json
```

The first command checks the comparator and executes extracted production
helpers against synthetic inputs. It also prints counts from one explicitly
synthetic discrepancy fixture. The second asserts the desired native-independent
product behavior: failures remain failures, exit 1. It is deliberately separate
from the tool's self-tests. Exit 2 means an input/harness error, never a product
pass. There is no baseline allowance and no command that converts contract
failures into green CI. Direct invocation avoids changing the pinned package
manifest or any shared test implementation.

The comparison command is file-in only. Raw input must resolve outside this
repository, including through symlinks. Output contains fixed discrepancy codes,
counts, per-run ordinal references, source hashes, and an input-file hash; no
input values, paths, raw rows, or identifier hashes. Do not publish the input,
the ordinal-to-record mapping, or logs from other live scanners. Counts describe
observations (a record can have multiple discrepancies), not unique people.

## Normalized input contract

`fixtures.js` is an executable synthetic example. Schema: `workload-consistency/v1`.
Required arrays: `native`, `production`, `provider`, `workload`, `calendar`,
`samples`, `members`, `expected`. `coverage[eachArray].complete` must explicitly
be true to assert absence within that input. Missing/false completeness becomes
`incomplete_input` plus the relevant `*_absence_unproven` class.

| Input | Meaning |
| --- | --- |
| native | Authoritative deliverable store: `id`, optional `linearId`/`legacyIds`, `scope`, `kind`, `team`, `ownerId`, native `status`, canonical `dueDate`, explicit `archived` and `container` booleans. Do not derive container from a missing provider parent: structurally classify using the owning batch and importer rules. |
| production | Separate unfiltered SyncLinear/Production input observations. Same native snake_case status vocabulary; `nativeId` binds to the canonical store. A canonical row existing does not prove Production fetched it. |
| provider | Independently captured provider rows, with explicit `linearId` and/or `nativeId`. A mirror alone cannot establish provider-only work. |
| workload | Observed board input with display status, `nativeId` and/or `linearId`. `visible` must come from actual bucket/render evidence, never the old scanner. Missing visibility is unproven. |
| calendar / samples | One observation **per component slot**: scoped `id` (card ID), `kind` (`video`/`graphic`), `nativeId`, optional `linearId`, status, owner observation if available, and date plus semantics. Caption is not a video deliverable. |
| members | `id`, optional provider `linearId`/`legacyIds`, `active`, `roles`, `teams`. Identities join through unique explicit mappings, never display-name guesses. |
| expected | Independently justified expected card binding: `nativeId`, optional `linearId`, `surface`, `cardId`, `scope`, `kind`. Do not infer that every deliverable belongs on both Calendar and Samples. This list also supplies the expected-work universe for a genuinely absent record. |

Observed rows require explicit `ownerId` (null = unassigned; omission = unknown),
`status`, `dueDate`, `scope`, `kind`, and `dateSemantics`. Date semantics are
`canonical_due`, `publish_date`, or `internal_plan`; only the first is compared
to the native deadline. Missing fields remain proof gaps. If a view does not
represent an owner or canonical deadline, leave it unknown; do not fill it from
the canonical row and then claim cross-view agreement. Card status comes from
the real `_calMapNativeStatusStrict`; Workload/provider display names come from
the existing outbound map. Unsupported card states are explicitly unrepresented.

A private adapter must retain source/revision, capture time, full pagination,
scope, identity mapping, field availability, and a consistency window for every
input. A timestamp or `complete:true` alone does not prove a live census. For
this reason the comparator **always** labels population conclusions `UNPROVEN`;
it cannot attest its own input or deployed code. Only a separately reviewed
read receipt can upgrade a finding to `LIVE_READ`. This pass supplies no such
population receipt. No real snapshots are committed.

### Eligibility evidence for missing-work counts

`workloadRoster` supplies `complete:true` plus arrays `clientNames`,
`videoEditors`, `graphicsEditors`, and `inactiveEditors`, captured for the
tested browser source. These are the **actual Workload name allowlists**, not
a substitute inferred from a member's role or team. Every array must be supplied;
an empty array is an explicit empty roster, and a missing array is unknown.
Native records supply `workloadClientName` and, when assigned,
`workloadAssigneeName`: the projected names the board predicates would consume.
The ordinary `members` comparison remains a separate membership discrepancy.

`workloadPlanDate` is the saved plan lookup result for the **exact projected
board ID**, not a newly inferred migration fallback. A date proves a saved plan;
explicit null or empty string proves no override. Omission means unknown.
Resolve it using a complete plan snapshot and the actual `wlPlanDate` contract;
do not invent a fallback between native and provider keys. A known due date or
plan day makes unassigned work eligible; In Progress remains eligible without
dates. Only an explicitly absent due date **and** absent plan prove undated Todo
or tweak work excluded. Assigned undated work has its own visible strip.

The comparator executes the extracted `wlIsAllowedClient`, `wlIsAllowedEditor`,
and `wlApplyData` against these inputs. It reports `workloadEligibilityCounts`
as eligible/excluded/unknown. Only proven eligible work absent from a complete,
unambiguous Workload input increments `native_missing_from_workload`. Known
exclusions increment `legitimate_workload_exclusion`; missing eligibility proof
increments `workload_eligibility_unproven` and, if absent, `workload_absence_unproven`.
A missing or incomplete Workload snapshot never proves absence, even when the
work is eligible. Old snapshots without eligibility evidence remain accepted
but cannot establish missing-work totals. All live population verdicts remain
UNPROVEN regardless of the input's self-declared completeness.

`eligibility-checks.js` reproduces the reviewed false-positive counts with
synthetic fixtures and is included in the finite runner. `C29` independently
checks real exact-key plan lookup with conflicting old/native entries and a
clear; it implements no compatibility lookup or migration.

## Evidence boundaries

- `OFFLINE_TEST`: comparator, extracted loader/bucketing/date/flag helpers, and
  the plan validator body with its TypeScript signature and one cast removed.
  The latter uses a fake database; it proves lookup logic, not deployed behavior.
- `SOURCE_ONLY`: query ownership, scanner blind spots, structural SQL mapping.
- `LIVE_READ`: the report's one static public HTML capture, compared by SHA-256.
- `ISOLATED_BROWSER`: not run. VM helpers do not prove pixels or a human journey.
- `LIVE_WRITE_DRILL`: unavailable. No persistence, migration, or approval/comment
  journey is claimed. Calendar/Samples loaders are not executed because link
  adoption during loading can write.
- `UNPROVEN` / `NOT_TESTED`: deployed Edge revisions, live population counts,
  actual cross-view rendering, browser cache/BFCache behavior, and server writes.

The helper harness supplies a fictional roster to the **unchanged production
name predicates**. It deliberately does not copy private staff/client constants.
New staff eligibility checks are a synthetic future-member contract; they are
not a claim that a particular current employee is excluded.
