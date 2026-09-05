# Native assignee eligibility and selection (draft, disabled by default)

Status: draft source and local proof only. Unmerged, undeployed, no flag moved,
no live row read or written. This is one bounded part of the Linear exit:
assignment-specific policy, catalog readiness and narrow caller integration.
It is not Decision A, not B5, not full Workload migration, not a label, card,
manifest or mirror change, and not authority to enable any native epoch.

## Exact base and drift

- Head of this draft: the branch `claude/native-assignee-eligibility-q8o1jd`.
- Base: PR1302 exact `8cb5cba91bc33fb17599b8f2a38625ae07f7743d`, which stands on
  PR1293 exact `5418ab5618595d9469f0527bd94623e9229a637e`. Both historical drafts
  are preserved unchanged; nothing here rewrites their migrations, harness copies
  or audits.
- Remote `main` recorded separately at `3d534cfa5598ef16e61c5ee7dc8072afaa9963c7`
  (29 commits past the drafts' common base `a05e1126`). Its production-write
  drift is confined to asset evidence reuse (`probeAssetUrl` held verdicts,
  `heldAssetEvidence`, `assetSnapshot(recheck)`); it does not touch the
  eligibility helpers, `autoAssigneeForIntake`, the intake handler's assignment
  block, or `policy.mjs`. It also appends `OPEN_REPAIRS` items 153 to 156 and
  Section 4 pins this draft does not carry. A later exact integration must merge
  that drift, rerun the asset, intake and this lane's suites, and recompute the
  Section 4 closure pins. That merge is not performed here so the tested base
  stays the one the evidence below was produced on.

**Addendum, later the same day.** After the draft PR opened, remote `main` had moved
again to `ab6366136c03239965c97b050ab5cf7c9763a228` (eight commits, all documentation:
`EXECUTION_LOG.md`, `docs/ops/CROSSWALK_REPAIR_STRATEGY.md`, `docs/ops/OPEN_REPAIRS.md`;
no source, migration or workflow change). A merge simulation of that main into this head
auto-merges `production-write/index.ts`, `EXECUTION_LOG.md`, `REPO_MAP.md` and
`ROLLBACK.md`, and conflicts only in the two Section 4 pin carriers
(`.github/workflows/deploy-f27-section4-closures.yml`, `test/f27-section4-deploy-lane.js`,
where main still carries its own production-write digests) and in the appended
`OPEN_REPAIRS.md` ledger tail. Those are the integration conflicts predicted above; they
are left to the coordinator's exact integration on purpose, so this branch's evidence
stays bound to the base it ran on. The drift is recorded here; the branch is unchanged.

**Historical, superseded the same day.** The coordinator retargeted PR1309 to the
branch `draft/native-only-intake-20260905`, verified at exact PR1302 head
`8cb5cba91bc33fb17599b8f2a38625ae07f7743d`. Against that base the PR is mergeable
with no conflict; the conflict list and the no-CI observation above describe the
earlier `main` target only. Integration into `main` and closure re-pinning remain
a separate exact-head gate; no current-main change is merged here.

## The confirmed defect

Explicit VIDEO assignment on a server-admitted native intake still reached
`assertEligibleAssignee` -> `assigneeEligibilityContext` ->
`assigneeProviderPool` whenever `production_assignee_eligibility` was missing,
unreadable or strict. PR1302's actual-handler control recorded the refusal with
zero partial native commit while Linear was unreachable; its automatic-assignment
successes never exercised the chosen-editor journey. The automatic path had its
own provider-era filter, `.filter(member => clean(member.linear_user_id))`, which
is reached on every intake with no explicit editor (every Submit, and every
Create Post that keeps the suggested default) and silently dropped any active
member without a stored mapping. On a native lane that could also turn a valid
default designer into `graphics_default_assignee_unavailable`.

## Correction after the independent handler review (same day)

An independent actual-handler PostgreSQL review of head `3c40c0ae` found two
regressions in the first draft's AUTOMATIC selection, both introduced by routing
the automatic pool through the eligibility flag policy instead of the eligibility
contract:

1. On the native lane `intakeAssigneePool` admitted every active same-team role
   and `autoAssigneeForIntake` took the sole graphics default without requiring
   the designer role. An active, unmapped SMM marked as the sole graphics
   default was assigned (201, one committed deliverable); exact PR1302 refuses
   with 409 and no commit. Both made zero provider requests.
2. With a valid mapped default designer beside an active, unmapped SMM default,
   the draft returned 409 `graphics_default_assignee_unavailable` while
   `nativeAssigneeCatalogReadiness` said ready; exact PR1302 assigns the designer.

The corrected shape: `policy.mjs` exports `nativeIntakePool(members, team)`, the
explicit path's `assigneeEligibility` verdict with the provider requirement off,
applied to a roster (active, exact team, exact creative role, mapping optional,
name-then-id order). On a native lane the gateway's automatic choice draws from
that pool, and `nativeAssigneeCatalogReadiness` counts creatives and eligible
defaults from the same function, so the dry-run and the handler answer from one
set. On the provider lane the automatic pool is the ORIGINAL contract, unchanged
from before this draft: every active same-team row with a stored
`linear_user_id`, no flag read, role decided by the caller as it always was
(graphics takes the single `default_for_team` row among mapped members whatever
its role; video takes mapped editors). The first draft's widening, under which
the exact retired flag value admitted unmapped automatic candidates the base had
always filtered, is withdrawn. So the accurate scope is: the explicit provider
path keeps its pre-existing flag behaviour (strictest on absence, retired value
drops the provider requirement); the automatic provider path never consulted the
flag and still does not; the native lane consults neither the flag nor Linear.
The earlier wording "provider lane byte for byte unchanged" and "disabled epochs
change nothing" was overbroad for the first draft and is retired here.

Both reviewed cases are pinned at the policy level and at the real handler on
both lanes, with the provider-lane results as same-base controls (they hold on
exact PR1302 head as well), plus three provider automatic contract checks: a
mapped SMM default is still admitted on the provider lane, the retired flag still
excludes unmapped automatic candidates there, and the automatic provider path
makes no flag read (fault-injected read never attempted).

## Native authorities, and what is distinguished

The genuine native authorities are the roster row itself, already read by the
gateway for sign-in: `team_members.active` (active staff identity),
`CREATIVE_ROLE_BY_TEAM` (compatible role, `video`=`editor`, `graphics`=`designer`),
`team_members.team` (team membership) and `team_members.default_for_team`
(the graphics default). `linear_user_id` is an optional provider identifier on a
native lane, and a prerequisite only on a provider lane.

Four situations that used to collapse are kept apart:

| Situation | Native lane | Provider lane (unchanged) |
|---|---|---|
| No roster row | `assignee_not_found` -> 403 `assignee_out_of_scope` | same |
| Inactive / wrong team / wrong role | exact reasons -> 403 | same |
| Active, compatible, no `linear_user_id` | eligible | 409 `assignee_mapping_unavailable` |
| `production_assignee_eligibility` missing / malformed / unreadable | not consulted | strictest, provider read |

Nothing is bypassed and nobody is admitted by name: an inactive, cross-team or
role-incompatible member is refused on both lanes with the same codes the
browser already translates.

## The policy

`policy.mjs` gains `assigneeLaneFor`, `assigneeLanePolicy` and
`nativeAssigneeCatalogReadiness`. The lane is decided by the per-team native
epoch the gateway resolves through `production_intake_epoch_read` (accepted
manifest or receipt first, the `native_intake_epochs` flag only for new
admission). A non-empty epoch is the only fact that makes a request native;
the browser cannot choose or override it. On that lane the policy is
`{ providerMappingRequired: false, providerVerificationRequired: false }` and the
gateway does not read `production_assignee_eligibility` at all, so no flag state
and no flag read failure can re-introduce a provider call. An empty epoch keeps
the pre-existing EXPLICIT-path contract: absence, unreadable and malformed values
are strictest, and only the exact `{"provider_mapping_required": false}` value
drops the provider requirement. The automatic provider path does not consult
the flag (see the correction above).

In `production-write/index.ts`: `assigneeLanePolicyFor` (returns before the flag
read on a native lane), `assigneeEligibilityContext`, `assertEligibleAssignee`,
`mappedCreateAssignees` and `autoAssigneeForIntake` take an optional
`nativeEpoch`; the automatic pool (`intakeAssigneePool`) is `nativeIntakePool` on
a native lane and the original stored-mapping filter on a provider lane;
`handleIntakeCreate` passes the epoch it already
resolved into both the explicit and the automatic path. Null unassignment
returns before any roster, policy or provider read, as before. The SyncLinear
`assignee` operation, Production `create`, and the `assignee_options` and
`create_options` pickers pass no epoch and stay on the provider lane: their
outbox rows are still provider work, so their mapping requirement is still real.

## How an accepted request keeps its decision

An accepted native request preserves its assignment across later policy changes
without any new provenance write: PR1293's immutable root manifest already pins
each expected child row, including `assignee_id`, and its fingerprint; PR1302's
manifest `native_epochs` pins the lane. On retry the gateway resolves the
original epoch before reading any flag, so the eligibility policy on replay is
the original lane's. A prior attempt's stored assignee also wins over a fresh
request by the existing rule. Proven below: replay after the epoch was
disabled and the eligibility flag set strict, and again under a new epoch,
returns the same accepted rows with zero provider requests and an unchanged
manifest and receipt set.

One replay boundary is recorded, not relaxed: a retry whose explicitly chosen
member has since been deactivated is refused (403) before the replay path, with
the accepted rows and their assignee retained. That is the pre-existing
current-authorization rule on both lanes; recovering that response then needs
the row active again or a coordinator-owned recovery route.

## Catalog readiness and the dry-run

`nativeAssigneeCatalogReadiness(rows)` applies the gateway's own native pool to the
whole roster: video is ready with at least one eligible editor; graphics with
exactly one eligible default designer. It reports counts only (active, unmapped,
inactive, role-incompatible, defaults, and `provider_lane_would_refuse`) and never
a name, id or provider identifier. `provider_lane_would_refuse` counts eligible
creatives whose STORED `linear_user_id` is missing or malformed; it measures
stored mappings, not live provider activity or reachability, which no dry-run can
know. `scripts/native-assignee-catalog-dryrun.js` prints the aggregate from an
exported JSON file, a disposable loopback PostgreSQL, or an explicit read-only
publishable-key REST read. The REST read pages with exact counts and REFUSES to
report anything when the server's total is unknown, the pages do not add up to
it, the total moves between pages, or the roster exceeds the bounded page budget
(exit 1, `unproven_roster_read`); the first draft's single `limit=1000` read
could have reported readiness from a truncated roster. It writes nothing and
exits 2 when a team is not ready. It was not run against the live roster in this
session, so no live count is claimed here.

## Evidence (local, disposable PostgreSQL 16, denied provider transport)

`test/native-assignee-eligibility.js` boots the same harness chain as PR1302
(real migrations through PR1293 and PR1302, exact repository F27 enqueue/hold
functions and trigger), then runs `scripts/native-intake-manifest/assignee-lane.mjs`:
the real `production-write` handler through the PR1302 loader seam, with the SQL
shim wrapped by `fault-shim.mjs` so one flag read can fail at the handler. Every
`api.linear.app` and `linear-outbound` request is recorded in-process and refused
in the native journeys. The run is repeated as a negative control against the
exact PR1302 head handler on a fresh database, which must fail its native
chosen-editor journeys; that is what proves the lane observes the handler.

Positive lane: 40 checks pass, 0 fail, 22 native journeys with zero provider
requests each (refusals included). Covered: provider-lane baseline (project read
refused first when Linear is fully down; chosen editor refused at the pool with
zero commit when only the pool is unreachable; accepted with the pool read when
Linear is up; unmapped refused 409; automatic excludes unmapped; unreadable flag
stays strictest; retired flag drops the pool read; unmapped graphics default
refused 409), native lane (mapped and unmapped chosen editor accepted with
terminal receipts; inactive, wrong-role, wrong-team and unknown refused 403 with
zero commit; graphics override and two-editor requests still refused 400;
automatic video balances over every active editor and picks the unmapped freest
one; unmapped default designer assigned; both teams automatic; flag missing,
malformed, strict and unreadable with the flag never read; public intake
automatic), concurrency (two distinct requests naming one editor; one identical
pair yields one durable row), replay across epoch disable, strict flag and new
epoch with an immutable manifest, lost response after the child commit recovered
under a disabled epoch with the original assignee, replay after member
deactivation refused with rows retained, the SyncLinear `assignee` operation
(non-null refused while Linear is down; null unassign succeeds with zero Linear
API calls; retired flag reassigns without a pool read), and preservation of every
provider-era assignment across all of the above. Negative control against PR1302
head: the native chosen-editor journeys fail with `assignee_provider_unavailable`
and the entry asserts that failure.

PR1302's own lane (`native-only-lane.mjs`) recorded this defect as a held readiness
gate, `chosen-editor-provider-dependency-readiness-held`, which expected the provider
refusal. That one check is replaced by `chosen-editor-native-no-provider` (201, zero
provider requests, the chosen editor on the row) and its readiness key now reports
PASS; the old expectation is retained as the FAIL branch so a regression reads as the
original defect. Every other PR1302 check is untouched: 50 pass, missing-child and
missing-card materialization stay FAIL there as before.

Full `npm test` on the final head with the disposable database required: 403 of 405
suites pass. The two red suites are `test/truth-sync.js`, whose 16 freshness-commit
failures are identical on the pristine PR1302 head in this shallow clone (the stamped
commits are not present locally) and are an environment classification, not a
regression; and, before the gate update above, `test/native-only-intake.js`, which
now passes. One suite reports its documented SKIP (artifact projection PostgreSQL
proof).

Offline: `test/native-assignee-policy.js` pins the lane policy matrix, native
verdicts, readiness aggregate and the gateway wiring. `test/production-write-gateway.js`
keeps every prior assertion; one source pin was updated to the new call
signature (`assertEligibleAssignee(..., team, nativeEpochByTeam[team])`).

Two observations recorded, not changed, because they are authorization scope
outside this slice: a credentialless public Submit may carry an explicit
`assignee_id` for a video item and is accepted on both lanes (the lane reports
`public_intake_explicit_editor_status`); and the SyncLinear non-null `assignee`
operation remains provider-dependent by design until its own native lane exists.

## What staff and clients would see

Nothing changes while both native epochs stay disabled: every assignment path is
on the provider lane and behaves exactly as today, including the strictest
reading of a missing flag. If a team's native epoch is later enabled through its
own gated process, Submit and Create Post on that team assign without any Linear
call: an explicitly chosen active editor is accepted whether or not they carry a
Linear mapping, the automatic pick balances over every active editor, and an
inactive, cross-team or wrong-role choice is refused with the same messages as
now. Clients see no new surface. The Create Post dialog still builds its
suggestion from a browser read filtered to mapped editors; on a native lane with
an unmapped active editor who is the freest, the dialog's suggestion and the
server's default can name different people. The dry-run's
`provider_lane_would_refuse` count is exactly that population, and a native epoch
must not be enabled for a team while it is non-zero unless the picker is first
moved onto a server projection of the intake pool.

## Rollout gate, deployment and inverse

- Default-disabled: the lane is native only when `native_intake_epochs` admits
  the team (seeded disabled by PR1302's migration) or an accepted manifest says
  so. No new flag, migration, RPC, grant or table is added by this draft.
- Deployment: `production-write` through the pinned Section 4 lane only, after
  PR1293's and PR1302's additive migrations, with the owner's sealed capture and
  the recomputed closure pins. Source alone is not serving evidence; a manual
  build is not either.
- Catalog completeness before any epoch: the dry-run must report both teams
  ready and `provider_lane_would_refuse` zero (or the picker parity follow-up
  landed) for the team being enabled.
- Inverse: disable the team's native epoch with the exact per-team CAS and
  readback. Accepted native rows keep their assignee and their manifest/receipt
  provenance; the epoch-aware gateway keeps replaying them on their original
  lane. New requests return to the provider policy. No row, receipt, manifest or
  flag needs rewriting, and none may be.

Expected `production-write` closure at the code commit `2ccbe00626bccea572597143eaf5abfaa5d326cc`:
source `267df5b88c7aabfbfbf8f3cd61363c590e48b71e31f1068e03553b5f7ad98374`, entrypoint
`244b9ecd7357461a3391123524b4fd3cc81fd3c5b18545c320fcc174fdd3188c`, five files;
regenerated with `node scripts/ef-fingerprint.js <sha> --slugs=production-write --expected-only`
and pinned in the Section 4 workflow and its lane test. The generated deployment
ownership manifest is unchanged.

## Remaining provider-dependent paths

SyncLinear `assignee` (non-null), Production `create`, `assignee_options`,
`create_options`, and the browser's Create Post editor pool read. Component fill
assigns nothing. Labels, cards, manifests, materialization, mirror retirement,
sub-issues and Workload are other owners' work and untouched.
