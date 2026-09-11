# Completed isolated evidence

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

## Previous schema/recovery preparation

Composition extends the previous 48 cases to **55 PASS** using sourced dated
card definitions and actual journal/crosswalk/feedback owners. New assertions
cover tenant keys, rollback, import/replay/identity checks and feedback refusal
after actual canonical deletion. The local catalog still lacks 16 of the
52 `history-v11` tables; its diagnostic names them without claiming full schema
coverage. Raw receipt: `linear-exit-composition-e260fd574add45bca9e3edc6d0c51dff`.

The separately exposed portable recovery lane **FAILS after five checks**.
Its stale extracted browser helper was repaired and its source setup now
includes both final ordinary-receipt repairs. Capture then refuses the real
volatile `client_access_mint_review_token()` default before the intended
catalog-race test. No backup/restore PASS is claimed. Both owned servers stopped.
Raw receipt: `linear-exit-recovery-631e6d7f09204d7fa9e18588f3777fcb`.
See `docs/ops/TRACK_B_BACKUP.md` for the proposed, unbuilt deferred-default
contract. These runs executed working-tree changes over `6437dedd`; prior
runtime/browser evidence below was not rerun because application code and
production migrations did not change in this preparation step.

## Current notification lifecycle repair

Prepared source: `93486bb421459255691bb603102f31a80dbfbd17`.
These runs executed its working-tree repair before commit; browser receipts
record the prior Git base, not a clean-checkout attestation. Aggregate receipts
and private-log hashes are under `latest_repair` in `evidence-20260910.json`.

- Composition: 48 assertions PASS, including actual ordinary-writer intent
  creation, with no synthetic deletion columns.
- Dedicated notification PostgreSQL proof: PASS, including archived cards,
  raw marker variants, comment deletion before claim, changed batches and
  valid video children under mixed/other batch summary labels.
- Captured-positive browser: 24 checkpoints PASS, exit 0.
- Repository-negative browser: 23 checkpoints, then preserved public 401,
  overall FAIL/exit 1.
- Both browser runs report zero external forwards after teardown; all four
  owned servers stopped. Gateway regressions, notification source contract,
  SQL preflight and prepared release-pin checks pass.

The repair consumes existing lifecycle fields and leaves both frozen writers
unchanged. Ordinary done-batch work and canceled visibility are preserved;
urgent still requires an active batch and the actual video's ownership.
Claim checks eligibility at that instant; a later external send is not atomic
with archive. No hosted notification delivery or full schema/restore proof.
The earlier 492-suite programme was not rerun for this new source revision.

Retained intermediate failures include the incorrect batch-summary-team guard
caught by the unchanged browser journey and a malformed synthetic provider
receipt caught by the dedicated SQL test. Their fixes did not relax assertions.

## Historical expanded composition: installation blocker exposed

The next composition revision reaches 44 passing assertions, then exits with
`NOTIFICATION_SOURCE_SCHEMA_REQUIRED`. It preserves the original 41 checks and
adds actual client provisioning, browser project/epoch projection and Workload
snapshot assertions. The provisioning migration now owns `native_project_ids`;
the harness no longer supplies that column manually.

The missing columns are `batches.deleted_at`, `deliverables.deleted_at`,
`calendar_posts.deleted_at` and `sample_reviews.deleted_at`. A separate hosted
catalog-only read confirmed all four tables exist and all four columns are
absent. No hosted rows were read or changed. Notification composition remains
unproven; this expanded lane is **FAIL**, not a new 44-check overall PASS.
The owned server stopped. Private receipt directory:
`linear-exit-composition-7867b68f4b0c47b287ae4846f62be281`.
Earlier evidence below remains tied to its older, narrower source revision.

## Repository-package reproduction

Commit `02964b12723284cefc395feaa93f221cd22fc095` was executed using the committed
portable runner and repository harness, with no application/SQL changes from
the previously tested candidate:

- Captured-positive: 24 checkpoints PASS, exit 0.
- Repository-negative: 23 checkpoints followed by the required 401, FAIL/exit 1.
- Real-owner composition: 41 assertions PASS, required marker present, exit 0.
- Both browser receipts check after teardown and report zero external forwards.
- All three owned PostgreSQL servers stopped successfully.

Aggregate receipts and hashes of retained private evidence are in
[`evidence-20260910.json`](evidence-20260910.json). The portable runner also
passed optional SQL with a space-containing output path and correctly refused
inherited credentials and an output path physically inside the checkout.

## Earlier full programme

Application/SQL source: `6276251fe2a961820dcc4de33c71a61bcb56db2b`.
These results were generated by the predecessor private harness, before this
portable package was committed. Reproduction on the committed package must
be recorded separately; copying a harness is not a new execution.

| Lane | Result | Boundary |
|---|---|---|
| Full PostgreSQL 16 programme | 492 suites PASS, exit 0 | Actual disposable SQL; some suites are source-only |
| PostgreSQL 17 F27 | PASS, F27_PROOF_OK | Separate rollback fixture, not full native composition |
| Optional SQL | Provisioning, component-fill, crosswalk-bind, batch-description PASS | Explicitly enabled disposable SQL |
| Captured Calendar public intake | 24 checkpoints PASS, exit 0 | Actual browser/handler/SQL; simulated SDK/provider |
| Repository Calendar negative | 23 checkpoints, then FAIL/exit 1 | Required 401, child retained, no card, recovery pending |

Both final browser runs verified zero external proxy forwards after teardown.
The positive recorded one refused background CONNECT; the negative recorded
none. Original failed startup/provisional receipts remain preserved privately.
All owned database servers stopped. Node warnings remain visible.

Pinned captured Calendar source SHA256:
`5592a10798acabe2670e61867edbab73847c6eda65b0b2253b7f86756851fada`.
Thumbnail dependency SHA256:
`fb32db55aedb8955a577a8ad67185acd5da68475a3eeccbbb8f593c077e6d4c9`.

Installation is HOLD. Hosted schema lacks `clients.native_project_ids` on the
2026-09-10 read-only catalog check, while candidate boot selects it. The PR
Production-polish gate remains red. No production schema was changed to pass it.

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

## Combined reconstruction component

`reconstructPairSql` authenticates the actual parent and companion bytes before
building one transaction. It loads nine-table rows before post-data constraints
and triggers, retains parent schema/digest/sequence verification, then verifies
exact companion row multisets and key shapes. Other parent-omitted tables must
remain empty. The parent manifest's omitted list retains its original meaning;
companion coverage is separate. Default reconstruction has no supplement.

ISOLATED_POSTGRES PG16: 11 checks pass in
`linear-exit-priority-restore-202b7e706a274650b786cce7c9064855`, exit zero and
owned server stopped. This includes the seven snapshot cases plus all-nine
population, successful restricted-target reconstruction, late type failure
rollback and injected duplicate-loss verification rollback. The source has 52
synthetic parent tables and nine populated companion tables. The duplicate-loss
fault is test-only SQL manipulation; the production generator exposes no raw
SQL injection callback. Both negative restores leave the public schema empty.

Retained failure: `linear-exit-priority-restore-f7cf9109732044568a07644ed484201b`
lacked required platform roles in the bare test target scaffold. The fixture now
creates those roles explicitly; no target guard was relaxed. Offline recovery
package checks remain 18 PASS and pair checks nine PASS. The earlier 31/52
application-shaped recovery run predates this renderer change and is not a new
combined application recovery result.

This closes synthetic combined reconstruction only. Real application triggers,
foreign keys, full schema composition, source sequence fencing, referenced object
custody, hosted restore and durable pair publication remain unproven. No merge,
deployment, production or n8n write occurred. Installation remains HOLD.

## Actual application-schema gap result

The PG16 priority-application-schema lane failed as required: five exact row/key
contracts, four missing tables, zero mismatches. Receipt
`linear-exit-priority-application-schema-38ce8a9bcd1e42548a9d670eb550a95e`, exit1;
owned server stopped. Missing: content_samples, filming_plans,
thumbnail_media_revisions and batches_parent_claim_backup_20260824. Exact:
workload_issues, rescue configuration and the three comment evidence/budget
tables. No additional owners or priority fixtures were added; no application
rows were read. This does not close application recovery composition.

The sanitized report is LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_GAPS_20260910.json.
The owner/dependency and acceptance plan is in
`docs/ops/LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_PLAN.md`. Preserve this failing
probe while preparing explicitly scoped missing owners; the untraced backup
still requires provenance/full-schema evidence. Installation remains HOLD.

## Explicit known-owner supplement result

The optional PG16 priority-application-supplement lane reaches eight exact row/key
contracts and one missing table, with overall FAIL preserved. Receipt:
`linear-exit-priority-application-supplement-a2a72555281941a6b3f3e64ceaf3ff09`,
exit1, owned server stopped. The only missing table is
batches_parent_claim_backup_20260824. No definition was manufactured for it.

The separate helper pins four complete source hashes before execution. Samples
and filming use deterministic schema excerpts excluding application seeds;
thumbnail base and v2 execute in order using the existing disclosed platform
scaffold. Public report LINEAR_EXIT_PRIORITY_APPLICATION_SUPPLEMENT_20260910.json
contains source/excerpt hashes, not SQL or seed values. The original 63-entry
inventory and default five-exact/four-missing probe are unchanged.

This closes composition of the three known missing table owners in this scoped
supplement only. Application-shaped populated capture/restore, thumbnail behavior,
complete platform/schema equivalence and backup provenance remain open. Sequence
fencing, Storage object custody and durable package publication are separate.
Installation remains HOLD; no merge, deployment or hosted/n8n writes occurred.

## Remaining backup table: observed catalog, not historical owner

Read-only catalog observations at 2026-09-11 00:18:29, 00:19:31 and 00:20:04 UTC
are summarized in LINEAR_EXIT_BACKUP_TABLE_CATALOG_20260911.json. No application
rows were read. These were separate queries, not an atomic schema capture.
Fetched non-shallow Git history contains only recent recovery references, not
a creation owner for batches_parent_claim_backup_20260824.

Observed: three nullable columns, no defaults/identity/generated expressions,
constraints, indexes, user triggers, policies, rewrite rules, inheritance links,
referencing foreign keys or publication membership. The ordinary heap table has
RLS disabled and standard column storage. Its current four-role permissions
include PostgreSQL 17 MAINTAIN; PG16 cannot establish exact ACL fidelity. This
is evidence for a captured-current-schema preparation path, not proof of the
table's historical purpose, complete dependency closure or retention policy.

Next: bind a coherent current catalog snapshot, prepare an explicitly observed
baseline on PG17 preserving permissions, then compose/capture/restore it with the
application owners. Do not label it a recovered historical migration or silently
remove MAINTAIN for a green PG16 result. Keep the eight-of-nine application probe
red until the new scope is implemented and verified. Installation stays HOLD.

Private raw receipt SHA256s (catalog/details/publication respectively):
0041e2f7f38f2e173276ff6aea3a81685eb87fb924900ad5fdf3ccff3f79b417;
43802a40886df4fb839a686717d1ca9411eb3934178db2bbbb6e566cbd2ba60b;
3f86c130a0b8485e141e660e4e75e5aa8e07dc95d89373c99ec33b4a15c4d1b5.
No merge, deployment, production write or n8n action occurred.

## Observed backup baseline on PG17

A single read-only statement at 2026-09-11T00:22:58.695432Z captured the backup
table's selected current catalog, including full grant objects and comments.
Public artifact LINEAR_EXIT_BACKUP_TABLE_BASELINE_20260911.json is byte-pinned
(49a591e45484ff69e6034cca1e441743ea939924bb3fe18e6d4d31e724b1f0a6).
Private receipt SHA256:13ec1d7ec6d418682dccacdb7f25ee86c96ca60c8730b4abef211fff26ebf458.
No application rows were read. This supersedes the earlier separate observations
for selected catalog reconstruction, not historical provenance or full closure.

The explicit priority-observed-baseline lane passes on PG17.11: nine exact row
schemas, selected backup catalog equality and all 32 grant objects, including
MAINTAIN. Comparison runs before commit and on a fresh read; existing-table
reapplication refuses. Receipt:
`linear-exit-priority-observed-baseline-060d2319f101497e96edbba4a86de24b`, exit0,
owned server stopped. Earlier pre-replay-check pass42e0bdc822f54f2ab4e8ee501782b695
is superseded. Observed hosted patch170006 and local170011 are distinct.

The source baseline is explicitly reconstructed from current metadata, not
represented as a recovered historical migration. Default five-of-nine and
three-owner eight-of-nine failing lanes remain unchanged. The known-owner
supplement and observed backup baseline stay separate from the published63
inventory. Populated application capture/restore, restored behavior, sequence
fencing, object custody and durable publication remain open. No merge,
deployment, production data write or n8n activity; installation remains HOLD.

## Populated application-schema pair recovery

PG17 priority-application-recovery passed on the actual ordered application
owners, four-source supplement and observed backup baseline. Receipt:
`linear-exit-priority-application-recovery-096bc812ff0c4b85bd9ba3c7c409acf9`, exit0,
owned server stopped. All nine companion tables contain synthetic rows satisfying
actual constraints. A restricted capture role ran the real parent/companion
capture; a restricted empty target reconstructed the authenticated pair. The
existing parent52 schema/digest/sequence checks and companion row/key/multiset
verification passed before commit. No parser or migration constraint was relaxed.

The public receipt is LINEAR_EXIT_PRIORITY_APPLICATION_RECOVERY_20260911.json.
Source backup selected-catalog/32-grant comparison occurred before seeding.
Restoration retains the recovery engine's owner-relative model; it does not
claim identical hosted owner/grantor identity. This lane proves successful
application-shaped synthetic recovery, not all restored workflow behavior,
concurrent sequence fencing, real data/object custody, complete platform
baseline, hosted restoration or durable pair publication. Earlier default gap
failures retain their original scopes. Installation remains HOLD; no merge,
deployment, production data write or n8n operation occurred.

## Selected restored runtime behavior

PG17 application recovery plus nine behavior checks passed in receipt
`linear-exit-priority-application-recovery-77a1365b98cc449b87555e9f47cf8d2b`, exit0,
owned server stopped. Actual restored budget stayed in its captured five-minute
window and advanced119->120, then refused another request without increasing the
counter. Missing JSON fields/rows fail closed. Audit allocated a fresh non-null
ID beyond the restored maximum. The real thumbnail trigger advanced a token on
a same-link write while retaining one pending continuous watcher. Six actual
anon/authenticated role reads on protected audit/conflict/thumbnail tables were
denied. No provider calls were made.

The public result is LINEAR_EXIT_PRIORITY_RESTORED_BEHAVIOR_20260911.json.
Earlier pre-hardening pass dcf4b8fc7f4d422f87a5fa359abf89a9 is superseded by this
run. These are selected local behaviors, not complete end-user or provider
handover coverage. Row changes are rolled back; sequence nextval is not
transactional, so the local identity check does not establish source sequence
fencing. Object bytes/custody, durable pair publication and hosted recovery
remain open. No merge/deployment/production/n8n write; installation remains HOLD.
