# Linear exit recovery checkpoint — 2026-09-10

## Latest priority restore contract

The nine priority tables now have a proposed preservation/acceptance contract
at docs/ops/LINEAR_EXIT_PRIORITY_RECOVERY_CONTRACT.md. One metadata-only hosted
read confirms eight declared primary keys and no primary key on the parent-claim
backup. That backup requires duplicate-sensitive multiset preservation; inventing
a key or silently deduplicating would not satisfy the contract. No declared FKs
were observed for these nine, but semantic dependencies remain open.

The contract preserves history, audit/import evidence and rate-window state;
separates private rescue configuration and thumbnail/document object custody;
and requires isolated exact-row, duplicate-loss, missing-object and permission
checks. No successor package or retention reset is implemented or authorized.
History-v11 and scheduled v3 meanings remain unchanged. Metadata receipt hashes
and observed keys are added to the scope register; no application rows or private
configuration values were read. Installation HOLD.


## Latest outside-corpus preservation review

A source-backed scope register now enumerates all 34 observed public tables
outside history-v11: docs/independence/LINEAR_EXIT_RECOVERY_SCOPE_20260910.json.
Nine need priority preservation decisions: thumbnail revisions; comment import
conflicts, read audit and rate-window state; protected archive rescue config;
legacy Workload; an untraced parent-claim backup; filming plans; and content
samples. The remaining 25 map to adjacent application-owner custody decisions.
No table is marked safe to exclude. No row contents were inspected and no data
loss is inferred from this scope gap.

Next preparation: define explicit restore/retention contracts for the priority
owners before extending the versioned corpus. Thumbnail objects and protected
configuration need separate custody; rate-window reset cannot stand in for
audit-history preservation. The parent-claim backup's provenance is unresolved.
Any successor must preserve history-v11's authenticated meaning and keep prior
evidence scoped. Scheduled v3 remains unchanged. Installation HOLD.


## Latest hosted recovery catalog inspection

The unchanged ordered recovery source also passes all 31 checks across 52 tables
on local PostgreSQL 17.11. The server stopped, exit 0. This adds major-version
coverage for the observed 17.6 host, not patch-identical or hosted recovery proof.
Use the explicit RecoveryPostgres17 runner switch; other lane restrictions remain.

At 2026-09-10T23:27:21.129Z, one read-only SELECT reused the recovery engine's
catalog fingerprint, inventory, prerequisite, dependency-edge and evaluated-
expression queries. Raw metadata remains private; its hash and aggregate counts
are published. The host reports PostgreSQL 17.6, with 67 public tables, five
views, 14 sequences, 115 routines, 28 triggers (none disabled), 31 policies,
177 indexes and 247 constraints. The selected queries return 11 dependency edges
and 536 evaluated expressions; these are not complete dependency closure.

Of the prepared history-v11 recovery corpus's 52 tables, 33 currently exist and
19 are absent. Another 34 current public tables fall outside that corpus and
need explicit exit-scope/custody classification; the count alone does not make
each one a migration requirement. The exact absent repository-owned names are
in aggregate evidence.
This is catalog inspection only: no application rows, sequence values or pg_dump
were captured. It is not a restorable backup or complete installation baseline.
No hosted mutations occurred. Installation HOLD.


## Latest hosted-view provenance resolution

The local view-provenance lane reproduces the captured hosted view definition
exactly from migrations/2026-08-23-attribution-slug-guard-widening.sql. PostgreSQL
16 computes SHA256 over the exact UTF8 pg_get_viewdef(...,true) bytes, matching
the published observation. Neither whitespace normalization nor execution of
private captured SQL is used. The other two predecessor stages and final
candidate definition differ. The earlier raw-SQL no-match is therefore resolved
by reconstruction, not by relaxing comparison.

All seven selected differing hosted objects now have repository predecessor
definition/body provenance. This does not establish complete definitions/ACLs,
dependencies, data custody or safe upgrade behavior on the full hosted baseline.
The run used working-tree tests over `ff49f33e`, exited 0 and stopped its server.
Focused source review found no blocker; repository-map validation passes. No
hosted refresh, mutation, merge or deployment. Installation HOLD.


## Latest selected hosted-definition capture

Offline independent comparison maps all six captured routine bodies to existing
predecessor migration owners: workload membership, append-v8, original component
fill, outbox parity and comment-thread lifecycle. One is byte-exact; five match
after CRLF-only normalization. The browser view has no exact/CRLF-only repository
definition match. Exact mapping is in aggregate evidence; body provenance alone
does not establish complete definition/dependency equivalence.

At 2026-09-10T23:19:15.226Z, one read-only catalog SELECT captured the six
present-but-incompatible routine definitions and the browser view privately.
All six routines match the checked security-definer mode, search path and
service/anonymous/authenticated execution requirements. Their bodies differ
from the candidate; CRLF-only normalization does not eliminate the differences.
This identifies body mismatches, not a semantic review of each difference.

The browser view has the required kind, security barrier and checked SELECT
permissions, but lacks the candidate native_intake_legacy_project reference.
Definition hashes and comparison booleans are published in aggregate evidence;
raw definitions and ACLs remain in the private receipt. No configuration or
application rows were read, and no hosted changes were made.

This seven-object capture is not a complete baseline, restorable backup or
authorization to replace definitions. It narrows the upgrade comparison needed
for the existing owners. Full dependencies/custody and the other open gates
remain unresolved. Installation HOLD.


## Latest hosted metadata observation

At 2026-09-10T23:17:02.658Z, the prepared read-only preflight observed 149 hosted
metadata objects: 140 absent, seven present but incompatible, and two compatible.
The result is CONTRACT_ABSENT; configuration reads were skipped. The initial
CLI read was followed by one metadata-only read to retain both absent and
present-incompatible classifications (the CLI prioritizes absent objects).
No schema, configuration or application data was changed.

The 140 absent checks comprise 69 columns, 42 routines, 16 triggers, seven
relations, two constraints, two indexes and two sequences. These overlap by
owner and are not 140 independent migration tasks. The seven existing mismatches
are the browser deliverables view, workload snapshot, intake append, component
fill, deliverable writer, comment writer and comment lifecycle writer. The check
reports compatibility, not which body/ACL subcondition differs. Full keys and
the private receipt hash are retained in the aggregate evidence.

This confirms the prepared candidate has not reached hosted contract readiness.
It does not supply a complete installed catalog/backup, validate configuration,
or authorize replacing existing definitions. Next preparation priority is an
exact read-only baseline/custody package and reviewed upgrade classification for
existing owners, retaining the local installation/recovery evidence and remaining
interruption limits. Notification configuration/handover and WR-101 remain open.
Installation HOLD. No merge, deployment, workflow or n8n execution.


## Latest installed-candidate metadata preflight

The preflight-installed lane now proves all 149 release metadata objects match
on the same inventory-ordered disposable PG16 candidate. The initial run found
one real contract defect: the gate expected production_component_fill with three
JSON arguments, but both migration owners define five arguments (text, timestamptz,
text, jsonb, jsonb). The gate now uses that exact identity; body hashes, security,
search path and permission requirements are unchanged. Independent declaration
checks cover both owners; all 28 offline checks pass. Focused review found no blocker.

The successful run used working-tree changes over `149e9c9c`; exit 0 and server
stopped. The earlier 148-compatible/one-absent failure remains recorded. No line
ending normalization or source migration change was required. This validates
metadata on the disclosed local baseline only. Configuration values, current
hosted readiness and installation authorization remain unproven. Installation HOLD.


## Latest read-only readiness diagnostic preparation

The deploy preflight now validates catalog metadata before reading configuration.
Missing notification configuration reports CONTRACT_ABSENT with fixed public
object keys, instead of failing while parsing a reference to an absent table.
Runtime flag key/value columns are also validated before configuration reads.
Scalar destination JSON is guarded before object-key enumeration. Metadata alone
cannot produce PASS: both exact response sets and the combined contract must pass.

Validation: 26 offline checks pass; disposable PG16 proves an actually absent
notification table stops after the metadata request, plus seven JSON-shape cases
using the exact configuration predicates and a synthetic row source. The server
stopped, exit 0. Source base `c5219b25` plus working-tree changes. Focused review
found no blocker. These are two separate read-only SELECTs, not an atomic snapshot.
No hosted preflight rerun or readiness claim was made. The earlier hosted absence
remains historical evidence. Installation HOLD; no merge or deployment.


## Latest recovery under the shared installation order

The recovery-upstream-ledger lane now builds its source using the same published
63-entry inventory, disclosed bootstrap and remaining 42-entry order as the
installation rehearsal. All 31 recovery checks across the 52-table history-v11
corpus passed on disposable PG16, including authenticated capture/reconstruction,
row replay and restored ledger behavior. The owned server stopped, exit 0.

Ledger fixtures are inserted before the ledger owner and its exact two-event
backfill assertion runs immediately afterward; owners are not reapplied. The
source uses working-tree changes over `bcf27d1c`. Two earlier fixture failures
remain retained: premature ledger count assertion, then native epoch setup after
provisioning. Neither was bypassed; assertion/setup ordering was corrected and
focused independent review found no blocker. No extra schema was introduced.

This aligns ordered installation with this recovery lane, not every historical
rehearsal or the hosted database. The older filming-plans schema prefix is not
needed by these 31 cases and is not newly covered. Complete baseline/dependency
closure, all data/Storage custody, remaining interruption boundaries, parent
restart and hosted configuration/notification handover remain unproven.
Installation HOLD; no merge, deployment or production mutation.


## Latest selected internal-step interruption proof

Normal resume was rerun on the final shared test code: all 42 entries, 44
workers, 25 accepted-work boundaries and both refusal cases passed again.
That disposable server also stopped. Source-inventory and repository-map checks pass.

The installation-interruption lane passed on disposable PG16. It executes the
actual hash-verified atomic intake source up to its outer COMMIT, then terminates
its PostgreSQL connection (57P01). The prior catalog, affected table rows and
checkpoint remain unchanged; a fresh normal worker then completes atomic intake.
After 29 completed entries, it executes only the first Workload label-shape
function replacement, before REVOKE/GRANT, and terminates that connection. The
committed partial catalog differs; a fresh worker refuses before owner execution.
Accepted native work remains intact, including exact business-call replay at
that partial state. No migration repair or migration replay is attempted.

The owned server stopped with exit 0. Source base is `702ddb6f` plus working-tree
tests. Focused review found no blocker. After the run, log wording was clarified
from final to current row images and explicit false scope markers were added;
assertions were unchanged. This is two selected connection-termination points,
not every internal boundary, an operating-system process kill, parent restart,
concurrency or recovery of partially installed state. Installation remains HOLD.


## Latest accepted native work preservation

The strengthened installation-resume lane passed on disposable PG16: one actual
native parent/child request was accepted through the root and deliverable RPCs
after atomic intake, using the current F27 generation and exact manifest dedup.
Its parent, child, manifest, two skipped native receipts and associated events
retained every originally admitted field through 25 later installation entries.
Exact replay under the final schema preserved complete final row images without
duplicates. Global pending/inflight/failed outbox debt remained zero. All 42
entries, 44 fresh workers and both checkpoint refusal cases passed; server stopped.

Source: working-tree test changes over `43ed2a9f`; focused independent review
found no concrete blocker. Newly added schema columns are distinguished from old
field changes and included in final replay equality. Scope is one synthetic
request across five owner tables, not all data, card materialization or completion.
Full hosted baseline, internal-commit interruption, parent-crash/key custody,
concurrency and commit/checkpoint-gap recovery remain unproven. Next: exercise
real partial autocommit and atomic rollback interruption cases. Installation HOLD.


Read the newest evidence sections first. Older dated checkpoints below are retained
as history; their pending publication/integration instructions are superseded by
the published draft PR #1382 and subsequent evidence. No historical PASS grants
installation authorization.

## Latest entry-boundary resume evidence

The supported `installation-resume` lane passed 42 ordered entries in 44 fresh
worker processes on the scoped disposable PG16 baseline. Two negative workers
refused a forged longer completed prefix and committed catalog drift before
owner execution. The parent remained alive. The owned server stopped; exit 0.

The exact published inventory bytes and source hashes are checked before each
entry and before checkpoint advancement. HMAC binds each checkpoint to the run,
database, inventory, completed prefix and catalog; its ephemeral key is supplied
separately. Focused independent source review found the prior binding gaps resolved.
This run used working-tree test changes over `98d93c6b`. The earlier unsigned,
freshly generated inventory run is superseded for this stronger claim.

This is entry-boundary process resumption, not a production installer. Parent
crash/key custody, concurrent workers, internal-commit interruption, the gap
between SQL commit and checkpoint save, complete hosted baseline and accepted
business-work preservation remain unproven. The next concrete case is the real
synthetic native parent/child intake receipt preservation recipe in the repair
installation guide. Installation remains **HOLD**. No merge or deployment.


## Latest ordered installation experiment

The supported `installation-order` lane passes on the scoped local baseline:
20 fully sourced bootstrap owners, the separately disclosed partial dated
baseline, then42 entries in inventory order. It records43 after-entry catalog
MD5 fingerprints and verifies the exact published inventory before and after
execution. The owned server stopped. The aggregate evidence retains all
after-entry fingerprints without raw database contents.

This run used working-tree test changes over `6b3d2520`. Review corrected an
initial fresh-inventory binding gap; the final run verifies the published JSON.
An earlier fingerprint-format test failure remains private historical evidence.
No implicit transaction wrapper was added: per-file boundaries are preserved.

Declared-order execution now has isolated evidence. Complete hosted baseline,
accepted-business-work preservation, cumulative resume classification and
interruption at every internal commit remain unproven. The recovery lane still
uses its own installation order. Next: use these checkpoints to test actual
interruption/resumption and divergent-prefix refusal, preserving accepted
receipts. Installation HOLD.


## Latest shared source binding

Composition and full upstream-ledger recovery now verify the same63-entry
inventory before database creation and again before PASS. The refreshed runs
pass65 composition assertions and31 recovery checks across52 tables; both
owned servers stopped. They bind the exact same inventory bytes and reject
artifact/source drift. Execution used working-tree changes over `303350e0`.

Known graph edges now explicitly require F27 before atomic intake/assignment/
labels, typed guards before retirement admission, and foundational comment/event
owners before their consumers. Tests reverse the entry list to prove these are
dependency constraints, not incidental list order. Full dependency closure
remains unproven.

This is shared source verification, not shared ordered execution. Both rehearsals
still use their established independent order; cumulative catalog signatures
and interruption/resumption at every committed boundary remain the next work.
Installation HOLD.


## Latest source-inventory preparation

A non-executable63-entry inventory is now built in
`scripts/linear-exit-install-manifest.js`, with a dated output at
`docs/independence/LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260910.json`. It pins
62 source SQL owners plus the atomic intake artifact, including both input and
composer hashes. Declared dependencies and top-level transaction/savepoint
boundaries are validated. Offline hash-drift, graph-refusal and transaction
tests pass; the repository map passes428 checks. No SQL is executed by this tool.

This is the first manifest component, not the complete installation manifest.
Dependency closure, current hosted baseline, expected cumulative catalog
signatures and per-boundary resume proof remain unresolved; installation and
execution readiness are explicitly false. Neither rehearsal consumes it yet.
Next: reconcile its dependency/order coverage, then wire one ordered isolated
installation and cumulative-state/interruption evidence into both rehearsals.
Installation HOLD.


## Installation-manifest preparation checkpoint

The combined source is published at `d2bb2279`. A current read-only hosted
preflight returned `READ_FAILED_HTTP_400`; its database diagnostic identifies
missing `public.production_notification_config` (SQLSTATE42P01). This is a
failed preflight, not an inventory of every missing prerequisite and not a
reason to apply SQL. No hosted state changed.

Review of the existing rehearsals identifies concrete remaining manifest work:
composition installs journal/feedback/crosswalk after behavioral writes, and
its ordinary-receipt repair order differs from the installation document.
Recovery source pins omit parts of the transitive intake/Workload/projection
chain. Both use a scoped synthetic baseline. Only one committed installation
interruption boundary has been exercised. The77/31 proofs therefore do not
close complete installation or per-boundary resumption.

See the shared manifest specification at the end of
`docs/ops/LINEAR_EXIT_REPAIR_INSTALL.md` for the next implementation and its
acceptance criteria. The manifest is not yet built. Installation HOLD.


## Latest combined preparation source

The reviewed upstream changes through `fcebb856` are now applied to the
preparation branch, with both document conflicts reconciled additively. This
was a source patch, not a PR merge; main and hosted systems were not changed.
The frozen writer files match upstream exactly: only duplicate urgent ledger
emission was removed, with authentication unchanged. They remain unsuitable
for deployment over the frozen tokenless serving contract.

Focused Kasper and serving-divergence checks pass; the repository map passes425
checks. Combined-source isolated browser negative control completes23 checkpoints
then retains `PUBLIC_INTAKE_MATERIALIZATION_401` and exit1. Zero external
forwards were observed and the owned server stopped. The run used working-tree
source changes over `19dd9593`, not a clean-checkout attestation.

The exact upstream SQL bytes already passed77 composition and31 authenticated
recovery checks, including restored trigger behavior. Those prior receipts keep
their recorded source scope; no new full-suite or hosted proof is implied.
Remaining preparation gates concern complete installation/recovery ordering,
hosted configuration, real data/Storage custody and notification handover.
WR-101 remains a separate planned release. Installation HOLD.


## Latest verified recovery with upstream ledger

The supported `recovery-upstream-ledger` lane **PASSES31 checks across52
tables**, preserving all25 baseline recovery checks plus six checks for exact
ledger history and restored insert/update triggers on Calendar and Samples.
Ordinary saves and same-marker retries create no duplicate ping events. Both
upstream SQL owners are hash-pinned to `fcebb856` and included before capture.
The local server stopped. This closes the isolated reconstructed-trigger gap;
full upstream source integration and hosted recovery remain unproven.

Execution used working-tree rehearsal changes over `d5d1aa54`. An earlier
run failed because fixture snapshots preceded the new marker columns; schema
setup now precedes snapshots, and all original assertions remain. The failed
receipt is retained. This is synthetic schema/data proof, not real Storage
custody, hosted installation, or deployment authorization. Installation HOLD.

A non-mutating patch check found upstream source applies except two document
conflicts: `REPO_MAP.md` and `docs/truth/SUPABASE.md`. No upstream patch has
been applied. Reconcile those documents while preserving the prepared additions
when preparing combined source; keep frozen writer authentication unchanged.


## Latest upstream compatibility rehearsal

The separate `upstream-ledger` lane passes **77 checks**: the existing65
composition checks plus12 ledger cases on Calendar and Samples. It verifies
tenant/round-separated backfill, repeat migration execution, ordinary saves,
new-marker writes, same-marker retries and inserted markers. Both actual SQL
owners are read from pinned Git commit `fcebb856` and hash-verified before
execution. The owned local server stopped and temporary SQL files were removed.

This is isolated SQL compatibility evidence, executed with working-tree test
changes over `c67bdbc8`. Full upstream integration and ledger-trigger behavior
after authenticated reconstruction remain UNPROVEN. No frozen writer or main
branch changed. The earlier25-check recovery PASS retains its original scope.
Next preparation step: combine the reviewed upstream source with the candidate
in isolation and extend recovery to the new trigger owner. Installation HOLD.


## Latest verified local recovery

The full isolated history-v11 rehearsal now **PASSES all 25 checks for 52
tables**. It verifies authenticated capture, exact reconstructed rows/sequences,
unchanged tokens/defaults, retained receipt replay, restricted grants, rollback
on late failure and post-commit quarantine behavior. The owned server stopped.
Classification: `ISOLATED_MIGRATION_SHAPED_SCHEMA_DATA_REPLAY`. This uses a
synthetic source; hosted reconstruction, real Storage bytes/configuration and
private receipt custody remain UNPROVEN. Installation remains HOLD.

The last prerequisite repair aligns all five v11 trigger-helper names with
the restore renderer; 32 offline contract checks also pass. Execution used
working-tree changes over `677a1c4e`, not a clean-checkout attestation. The
earlier five-, 16- and 21-check failures below are historical and preserved.
The 65-check source composition and separate deferred-generator proof retain
their own scopes. Next: integrate and rehearse upstream `fcebb856`, then close
remaining installation/configuration/custody/notification handover gates.


## Previous preparation: 65 schema checks, recovery still held

Composition passes 65 assertions and contains all 52 corpus table names; this
is table-presence evidence, not complete installation proof. The supported
`deferred-defaults` lane passes real PostgreSQL generator non-execution,
value/default preservation, omission refusal and late rollback checks.

The full recovery journey now completes 21 checks, including exact reconstructed
row images and sequences, token preservation, canonical replay and quarantine
handling. It then FAILS because the history-v11 backup prerequisite references
an absent `id` column on `production_native_ordinary_receipt_admissions`.
A prepared prerequisite correction now uses the actual token/key columns and
retains required notification identity sequences. Its full recovery rerun is
still pending; the 21-check failure remains the latest full-run result.
The previous 16-check failure was a fixture actor-key/name mismatch: the gateway
uses the same actor name in both envelopes. The fixture now mirrors that mapping
and proves source replay before capture. Inconsistent direct service RPC input
remains a separate contract limitation; this fixture correction does not fix it.

All three owned local servers stopped. Results bind to working-tree changes
over `8616df22`; no full recovery or hosted readiness is claimed. Upstream
`fcebb856` remains pending integration. Installation HOLD.


**Installation HOLD. Documentation only; no runtime changes or deployment authorization.**

## Earlier run: recovery advances, replay remains red

The source-composed schema rehearsal now passes **65 assertions** and contains
all 52 `history-v11` table names. This is `RECOVERY_TABLE_PRESENCE_ONLY`;
synthetic external Storage scaffolding does not prove hosted configuration,
object custody, or complete installation order.

The authenticated deferred-default engine is implemented in preparation code.
The full isolated recovery run advances from five to **16 completed checks**:
restricted reconstruction verifies exact corpus row images, sequences and
schema fingerprints, including unchanged review-token bytes and their restored
default. The overall journey still **FAILS** at canonical comment replay with
`idempotency_conflict`; retain that failure until its cause is resolved.
These are working-tree results over `8616df22`, not clean-checkout evidence.

Upstream `main` advanced to `fcebb856d3f5ea607cf5665ac391c258ad173abb`
(PR #1383, urgent-ping ledger and serving-divergence checks). This branch still
uses integration baseline `340a3be037c6622982c9ebaf563ea3ba3abda683`.
The newer work requires a separate integration review, including its writer
changes; it has not been incorporated or deployed by this preparation.

## Previous preparation update: schema and recovery

Composition now passes **55 assertions** with dated source-backed card keys
and the actual journal/crosswalk/feedback owners. Seven new cases cover tenant
separation, rollback, imports and stale-feedback refusal. The bounded local
catalog still lacks 16 of the 52 recovery-corpus tables; the public aggregate
evidence records the exact names for the next extension.

The portable `recovery` lane reaches a real **FAIL after five checks**: capture
refuses the volatile review-token default before its catalog-race test. See
`../ops/TRACK_B_BACKUP.md` for the proposed versioned deferred-default design,
which is not implemented. Do not drop the default, omit tokens or weaken the
capture assertion. Both owned local servers stopped. No application source,
production migration, frozen writer or hosted state changed in this step.

## Previous preparation update: notification lifecycle repair

Prepared code `93486bb421459255691bb603102f31a80dbfbd17` replaces the mistaken
four-column deletion assumption with existing archive/lifecycle ownership.
Isolated composition now passes 48 assertions, dedicated notification SQL
passes, and the captured-serving browser passes all 24 checkpoints. The
repository-writer control still fails with the required 401 after 23 checkpoints.
Both browser runs verify zero external forwards after teardown. Results were
executed in the working tree before commit; see the evidence's explicit source
binding limit in `../../qa/linear-exit-rehearsal/RESULTS.md`.

No frozen writer changed. No merge, deployment, workflow dispatch, n8n execution
or hosted write occurred. Full schema/recovery composition, interrupted install,
hosted configuration/notification handover and retirement gates remain open.

## Historical preparation update: expanded composition

Draft PR #1382 contains the integrated build and portable rehearsal package.
The expanded composition preserves 41 earlier assertions and adds three real
provisioning/browser/Workload checks, then correctly fails at the notification
schema prerequisite. `deleted_at` is absent on hosted `batches`, `deliverables`,
`calendar_posts` and `sample_reviews`, confirmed by catalog-only reads; no
repository migration owner was found for those four columns. Synthetic test
columns do not satisfy this requirement. Resolve canonical deletion semantics
and the source owner before claiming full notification composition. See
`../../qa/linear-exit-rehearsal/RESULTS.md` and
`../ops/LINEAR_EXIT_REPAIR_INSTALL.md` for the bounded evidence and dependency.
No merge, deployment, workflow dispatch or production change is authorized.

## Preserved source

The returned local repair is commit `78b8c62adda4c8ee4853025cdff6def82f27ba63`,
tree `32d3968354c6d2d5de30eacd6fd2ce5808830f48`.
Its bundle SHA256 is
`376a59f640caa5ead0a03ebd79373d86326561b2244bbd97ecaa1e7a6b685976`.
The accompanying evidence archive SHA256 is
`ec6cada1ac1c9320456c4a590607b27b31c45d2ce9390c867a896c17eace3481`.

Both owner-supplied attachments were recovered after temporary workspace
maintenance and their hashes rechecked. The code snapshot is NOT published by
this documentation PR. An application-source upload was rejected by automatic
approval review over possible sensitive content. Do not claim orphan GitHub
objects constitute a published candidate. Publication authorization is already
given; resolve the content-review concern before retrying the blocked payload.

## Reviewed results and limits

The prior review inspected the returned raw log reporting all 485 PG16 suites
passed, the PG17 F27 result, and the overall failed browser journey receipt.
These were executions by the local session, not a repeated hosted verification.
The receipt identifies the same source commit and 23 passing checkpoints.

Three local application fixes were reviewed without a concrete defect:
live status events use transaction time for notification creation while retaining
outbound retry identity; accepted native intake/component-fill initializes
known empty labels; parentless native append choices require a fresh capability
read covering every selected team. Focused offline checks also passed.

The public Submit journey remains failed: intake commits a child, then the
repository Calendar materializer returns 401, leaving no card and pending
recovery. This is NOT proof that the deliberately different deployed tokenless
writer fails. Read the frozen-writer contract and compare actual serving source
read-only before selecting a repair. Do not re-gate the frozen pair, deploy the
repository copies blindly, or elevate the public fixture to staff credentials.

Deno retained 16 baseline error headers. Synthetic HTTP/SQL adapters do not prove
hosted JWT/RLS, real Slack delivery, current production schema or full recovery.

## Original recovery next steps (historical)

1. Recover the exact bundle into an isolated clone with its prerequisite history;
   preserve the existing source snapshot and evidence.
2. Finish public-content review before retrying application publication. Publish
   a complete, hash-checked draft candidate, never an incomplete substitute.
3. Integrate newer main and concurrent editor/onboarding work; repeat affected
   journeys on that exact integrated revision.
4. Resolve the public-intake serving-contract discrepancy, full native/F27 owner
   composition, schema upgrade/interruption, database/data/Storage recovery,
   hosted source/auth/configuration and notification handover evidence.
5. Keep installation HOLD. Do not merge, dispatch, deploy, mutate production,
   run/edit n8n, or remove retirement admission refusal merely to pass tests.

## WR-101 — separate planned release

Durable write-failure receipts remain an explicit open reliability item based on
OPEN_REPAIRS item 101. Browser draft preservation and some diagnostic identifiers
already exist; accepted-write receipts and a 50-row local browser ring do not
provide durable per-card refusal diagnostics.

Lane B coordinates private server-owned refusal storage and gateway coverage;
Lane D supplies bounded browser/comment context; Lane F owns a protected
per-card lookup, 24-hour summary, retention and telemetry health.

Record bounded attempt, time, operation, entity/card/thread, verified principal,
status and refusal code; separate browser claims from verified facts. Exclude
credentials, tokens, display names, comment text and raw payloads. Diagnostics
must survive business rollback, preserve the original error and expose
telemetry failure. Browser-only reporting is bounded, nonblocking and best
effort without retry; offline delivery cannot be guaranteed.

**Implementation needs its OWN reviewed Edge Function release**, additive SQL,
bounded deploy scope and rollback. It is not implemented by this plan and must
not be bundled with the current migration. No new n8n executions. Close it only
after actual gateway/SQL/browser refusal, draft preservation, redaction,
telemetry-failure and operator-lookup checks.


## Serving-source follow-up — 2026-09-10

Read-only Supabase source retrieval found active calendar-upsert version 49
with verify_jwt=false and no authorizeBrowserWrite call. Its POST handler
parses the body and proceeds to card guards/storage without that auth gate
(saved readback lines 525-570). The candidate repository writer invokes
authorizeBrowserWrite at line 501.

A bounded Node VM execution of the retrieved handler accepted an unauthenticated
synthetic card request: HTTP 200, ok=true, one mocked calendar_posts insert.
Network calls were prohibited. Database SDK operations and auxiliary thumbnail
work were mocked. This is source/handler evidence, not a hosted save or a
complete browser/SQL journey. The saved readback fixture SHA256 is
5592a10798acabe2670e61867edbab73847c6eda65b0b2253b7f86756851fada.

Reclassify the earlier 401 as a repository-versus-serving test-source mismatch,
not a confirmed production intake defect. The outstanding gate is now a full
public intake/materialize/readback/recovery rehearsal using the captured,
hash-pinned tokenless serving body and its dependency closure. Keep the old
repository 401 as a negative control. Do not modify either frozen writer.

## Isolated continuation — 2026-09-10

Recovered the exact candidate into a fresh GitHub clone. Bundle SHA256 and
candidate tree match the preserved identifiers above; Git connectivity passes.
The prior checkout's automatic repack failed on an unreadable object and was
not used as the new repository's object store.

Integrated main `340a3be037c6622982c9ebaf563ea3ba3abda683` in local merge
`3591325ec8a029b7975087801bd80aab60ce75e9`; refreshed source pins and endpoint
inventory at `6276251fe2a961820dcc4de33c71a61bcb56db2b`.
The integration explicitly combines native editor urgent delivery receipts and
uncertainty handling with main's separate Kasper endpoint, payload and switch.
New regression controls exclude Kasper requests from native editor actions.
Main's approval-stamp recovery, client status no-op policy, archive refresh and
editor updates remain included. Both frozen repository writers equal main
byte-for-byte; neither was deployed or changed by the continuation.

A fresh read-only Calendar capture again returned v49, verify_jwt=false,
source SHA256 `5592a10798acabe2670e61867edbab73847c6eda65b0b2253b7f86756851fada`
and thumbnail dependency SHA256
`fb32db55aedb8955a577a8ad67185acd5da68475a3eeccbbb8f593c077e6d4c9`.
This is a new capture matching the earlier hash, not recovery of the old archive.
Private test fixtures pin both files and keep the repository writer separately.

The complete integrated diff received an independent heuristic content scan:
298 changed files, 188 new files, no changed binary files and no recognized new
credential/private-key/JWT/share-token matches. Identity-shaped matches were
reviewed as synthetic fixtures or existing source. This is not an exhaustive
live-roster audit and does not override automatic publication review.

Docker Desktop failed to start because it could not rename a local socket.
No reset was performed. Disposable loopback PostgreSQL 16/17 binaries provide
the local execution environment instead. Initial browser attempts stopped
before application checkpoints because the refusing proxy also blocked the
owned loopback server. Those failed receipts are preserved; the corrected
proxy forwards only the two validated local server origins and refuses
external requests, CONNECT and redirects.

The remaining full-composition gap is explicit: existing ordinary-receipt
tests substitute four prerequisite triggers and the separate F27 proof does
not install the entire native owner set. A real combined owner manifest and
interruption/resumption rehearsal are still required, alongside the hosted,
notification-handover and complete recovery gates above. Installation stays HOLD.

The private combined-owner prototype was executed and failed at the first real
F27 migration with `F27_PREINSTALL_GATE_REQUIRED_BOUNDARY_MISSING`. Source
comparison identifies `public.flag_flips`, owned by the B0 authentication
scaffold, as the first missing bootstrap boundary. The next composition step
must install the real B0 owner before B1/intake rather than adding a placeholder
table or suppressing F27's gate. Subsequent exact ACL/authority gates remain
unproven. This is a test-baseline gap, not a demonstrated production defect.

A second isolated bootstrap attempt applies real B0 before the intake chain.
It stops because B0's runtime-flag trigger requires `syncview_runtime_flags`,
whose real owner is `2026-07-03-a1-calendar-upsert.sql`. The source-owned baseline
must therefore include A1 before B0, after checking A1's prerequisites. Both
failed attempts and shutdown receipts are retained; no placeholder was added.

### Verified continuation results

Application/SQL source tested: `6276251fe2a961820dcc4de33c71a61bcb56db2b`.

- Captured-Calendar public lane: PASS, 24 browser/handler/SQL checkpoints,
  unauthenticated public materialization persisted exactly one linked card,
  pending recovery cleared, and staff reload/open/edit succeeded.
- Repository negative control: FAIL as deliberately preserved, 23 checkpoints
  then HTTP 401, one child retained, no materialized card, recovery pending.
- Both final receipts check proxy forwarding after teardown: zero external
  forwards. The positive run recorded one refused background connection;
  blocked attempts are not successful traffic. Earlier provisional receipts
  are superseded, not deleted.
- Separate real PostgreSQL 17 F27 proof: PASS with `F27_PROOF_OK`.
- Optional real SQL provisioning, component-fill, crosswalk-bind and
  batch-description CAS checks: PASS.
- Focused urgent, approval recovery, editor/Workload, archive-refresh,
  attribution, release-fingerprint and documentation checks: PASS.
- Full integrated PostgreSQL 16 suite: PASS, all 492 suites, exit 0. The owned
  local database stopped cleanly. This supersedes the prior pending status
  and does not substitute the older 485-suite result.

These are isolated Windows PostgreSQL/browser proofs. They do not establish
hosted JWT/RLS/PostgREST, real Slack delivery, complete production upgrade or
database/data/Storage recovery. No merge, deployment, workflow dispatch,
production data write or n8n execution was performed by this continuation.

### Published candidate and current-schema compatibility gate

The complete candidate is now published in draft PR #1382. Initial published
head `97d644854c4a3ead0dacbb122eabb352db61ec57` and tree
`a488b7e1bf39d73d6286f0cb5a45e1ff9bd809ca` matched GitHub readback.
The application/SQL bytes remain those tested at `6276251f`; later changes in
this checkpoint are documentation only.

PR Production-polish CI is red: structure, boot/read-only smoke, comment
selection, accessibility and layout checks failed. Those checks combine the
candidate HTML with hosted reads, unlike the disposable-schema journey.
A read-only `information_schema.columns` query confirmed that hosted
`public.clients.native_project_ids` is absent. The candidate's mandatory
Production clients select requests that field, introduced by
`2026-09-09-native-client-provisioning.sql`; main does not request it.
This confirms an unfulfilled compatibility prerequisite that can prevent
candidate boot. It does not attribute every individual CI failure without
its private trace and does not imply the currently served main page is broken.
Do not merge the candidate into the current schema, suppress the failures or
apply SQL merely to turn CI green. The reviewed installation order and full
schema/recovery proof must be completed first.

### Reproducible preparation package — 2026-09-10

Owner reaffirmed: preparation of build and strategy only. No PR merges or live
implementation. The reusable harness, portable PostgreSQL runner, reviewed
hash-pinned Calendar source/dependency and public aggregate receipts now live
under `qa/linear-exit-rehearsal/`; no external attachment is needed to repeat
the selected journeys from a full checkout. Raw private evidence remains
excluded. The fixtures are never deployment entrypoints.

Package commit `02964b12723284cefc395feaa93f221cd22fc095` reproduced 24 positive
checkpoints and the preserved 23-checkpoint/401 negative. Both final receipts
report zero external forwarding after teardown. The new composition lane
also passes 41 assertions with actual A1/B0, full F27 and selected native
owners, including stale-generation rollback and receipt preservation across
an interrupted/resumed admission-installation step. All owned databases stopped.
Application files, production migrations and deployment workflows are unchanged
by this package.

The earlier missing-baseline errors are superseded for this bounded lane by
real A1-before-B0 ownership. Legacy artifact migrations must precede F27;
running their old enqueue replacements afterward loses F27's wrapper. The
new lane installs the four actual prerequisite guards instead of no-op test
triggers. See `scripts/linear-exit-composition/README.md` for the exact scope.

Next preparation work is the complete installation manifest: add the remaining
Workload, provisioning, notifications, media and recovery owners to a source-owned
baseline; exercise actual intake/assignment/label operations and every separately
committed interruption boundary; then prove database/data/Storage restore and
old/new browser/gateway combinations. The 41 checks do not close those gates.
Hosted configuration and notification handover still require their separately
authorized future implementation windows. Installation remains HOLD.

## Pending upstream integration review

Read-only comparison of baseline `340a3be` to `fcebb856` finds no changes to
`index.html` or `production-write`. Preserve both candidate runtime-flag helper
extractions and upstream ledger assertions in the overlapping Kasper test.
Reconcile the operational documents additively. Upstream writer diffs remove
only urgent-ping event emission in favor of SQL ownership; they do not change
authentication. No integration or writer change was performed in this review.

The new `2026-09-10-kasper-urgent-ping-ledger.sql` owns four card triggers and a
per-client/per-round historical backfill. Before claiming upstream integration
verified, exercise backfill replay, ordinary saves and restored trigger behavior
against the combined candidate. Existing 65-check composition and browser
receipts do not cover that owner. Production installation remains separately
authorized future work.

## Priority companion offline component

The explicit `priority-nine-companion-v1` encoder/validator is implemented in
`scripts/linear-exit-priority-companion.js`. Its pinned row schema covers nine
tables and 106 columns. `node test/linear-exit-priority-companion.js` passes 17
OFFLINE_TEST checks, including tamper, parent/schema mismatch, table/column/key
shape, sparse-cell refusal, nullability and duplicate preservation checks.
Authentication precedes inner JSON parsing. The envelope binds the supplied
parent package SHA256 and catalog MD5; callers must separately validate that
parent package. Text/null cells preserve representation, but PostgreSQL type
validity and actual capture/restore remain unproven. Authentication is not
encryption: private custody remains necessary.

Next: implement and rehearse isolated PostgreSQL capture/restore against this
contract, including exact rows and duplicate multiplicities. Full schema,
sequence consistency, semantic dependencies, object/document custody and the
remaining 25 tables still require evidence. Existing v11 and scheduled v3 are
unchanged. Installation remains HOLD. No merge, deployment or production writes.

## Priority companion typed rehearsal

ISOLATED_POSTGRES: the PG16 `priority-companion` lane passes seven checks for
nine synthetic tables and all 106 pinned columns. Receipt:
`linear-exit-priority-companion-7258d9870f96441ab456be0905c6e78e`.
The runner exited zero and the owned server stopped. Actual typed rows survived
capture, authenticated packaging and transactional restore with exact textual
multisets, including large integers, escaping and keyless duplicates. Tampering,
source/target column drift and nonempty targets were refused; a late timestamp
conversion failure left every target table empty.

This is a test-only restore algorithm over synthetic row schemas, not an
operational backup tool. The parent identity is synthetic. The final source adds
`parent_package_validation_proven:false` to the report after this run; assertions
are unchanged. Real parent-package validation, concurrent capture/DDL behavior,
complete schema/ACL/trigger restoration, identity sequence state, semantic
references and object/document custody remain unproven. Integrating this row
component with the existing recovery package is still required. Installation
remains HOLD; no merge, deployment, hosted write or n8n operation occurred.

## Authenticated parent/companion pair verification

OFFLINE_TEST: `node test/linear-exit-priority-companion-pair.js` passes nine
checks; the existing companion test retains 17 passes. `verifyPair` validates
actual parent bytes with the existing recovery reader, requires history-v11,
then derives the package SHA256 and catalog fingerprint before validating the
companion. It rejects caller-provided identity objects, altered packages, wrong
corpus and a different valid parent even when its catalog fingerprint matches.
The synthetic parent exercises the real parser for 52 tables; it is not a
PostgreSQL-restorable or hosted backup receipt. No database operations occur.

This closes offline pair-linkage validation only. Shared-snapshot capture and
combined database restoration remain pending; the API reports
`same_snapshot_proven:false`. See the priority recovery contract's required
integration boundary for concurrent-write and incomplete-publication tests.
Full schema, sequence and object custody remain open. Installation stays HOLD.

## Shared-snapshot capture component

The opt-in `scripts/linear-exit-priority-capture.js` API now captures companion
rows through the still-open parent exported snapshot. It validates final parent
bytes and the companion before returning both buffers. It publishes no files;
owned temporary staging is removed on success or failure. Existing default
capture callers do not supply the new optional snapshot callback.

ISOLATED_POSTGRES PG16: seven checks pass in receipt
`linear-exit-priority-snapshot-a53a8500038847949f229e6dac7d61df` (exit zero,
owned server stopped). Actual restricted-role pg_dump and companion reads retain
the earlier rows despite an intervening write; a separate capture sees the newer
state and cross-pair validation refuses mixing them. German date formatting is
normalized to ISO during companion reads. Parent validation and companion schema
failures return no pair and leave no new private staging directory. An earlier
four-check receipt `linear-exit-priority-snapshot-f11c9a082ad64d6ea34abd0391b0de97`
is superseded by the strengthened test. Offline regression: 18 recovery package
checks and nine pair checks pass.

Scope: a synthetic 61-table database with selected populated rows, not the full
application owners or hosted data. This proves the selected concurrent-write
snapshot case; combined reconstruction, full row population, sequence fencing,
object custody, arbitrary concurrent DDL and durable pair publication remain
open. The pair verifier alone still cannot infer snapshot provenance from bytes.
Installation remains HOLD; no merge, deployment or hosted/n8n writes occurred.

Default recovery regression after the optional hook: PG16 recovery-upstream-ledger PASS31/52, receipt linear-exit-recovery-upstream-ledger-74c52cbeebea44d2a3fc77d87b8115c6, exit0 and server stopped. Existing ordered baseline and restored upstream-ledger proof retained. This separate run does not reconstruct the companion.
