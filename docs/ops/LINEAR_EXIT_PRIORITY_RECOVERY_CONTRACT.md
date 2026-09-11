# Priority recovery contract for Linear-exit preparation

Status: proposed source contract, not an executable backup or approved retention policy.
The nine tables come from LINEAR_EXIT_RECOVERY_SCOPE_20260910.json. Their hosted
metadata was read at 2026-09-10T23:36:36.482Z; no application rows, configuration
values, sequence state or Storage objects were read. The private metadata receipt
SHA256 is 16608f16f644a4cd93a1c094442d870cf73589b5db6a268e20ca7a50529e4e7d.

| Table | Observed primary key | Required preservation contract |
|---|---|---|
| thumbnail_media_revisions | id | Preserve every revision field, ordering/linkage and private object references. Separately bind referenced object bytes to content hashes, media metadata and private access policy; restored compare/read behavior must use the restored objects. |
| production_comment_import_conflicts | id | Preserve complete conflict history and its payloads/identity evidence; restoration must not silently resolve or deduplicate conflicts. |
| production_comment_read_audit | id | Preserve complete access-audit history and actor/card/comment references; verify restored access controls without exposing audit contents publicly. |
| production_comment_read_budget | actor_key, window_start | Preserve exact captured counters/windows initially. Any reset or expiry policy needs a separate justified contract and test; it must never reset audit history. |
| linear_archive_asset_rescue_config | config_key | Preserve configuration privately with restricted custody and restored ACLs. Keep restored provider/rescue execution disabled until separately authorized; do not publish configuration values. |
| workload_issues | id | Preserve the captured legacy projection and its identifiers until all remaining consumers and retention requirements are resolved. Do not assume it can be rebuilt after Linear access ends. |
| batches_parent_claim_backup_20260824 | none | Preserve all rows as a duplicate-sensitive multiset, including nulls. Do not invent a unique key or deduplicate. Provenance and intended retention remain unresolved. |
| filming_plans | client_slug | Preserve full plan/link metadata and separately establish custody for referenced documents where required; a URL is not document-byte recovery. |
| content_samples | client, id | Preserve both key components and every original content field; classify external media/document references before claiming complete recovery. |

## Required implementation and acceptance evidence

1. Use an explicit successor contract or separately authenticated companion package.
   Do not change history-v11's authenticated table meaning or the scheduled v3
   default. No format extension is implemented by this document.
2. Capture schema and rows consistently with the source snapshot. Capture
   generated sequence state during the capture window and validate it separately:
   sequences are not MVCC-snapshot consistent. A reviewed writer fence or
   equivalent consistency proof is required before claiming a recoverable bound.
   Pin types, nullability, defaults, constraints, triggers, RLS, grants
   and dependencies. The current selected metadata capture does not supply all
   those facts. Absence of declared foreign keys is not dependency closure.
3. Use restricted private package custody for configuration, personal/access
   evidence and object paths. Public evidence contains only sanitized counts,
   source identities and hashes. A private local file alone does not establish
   durable backup custody or an independently verified restore.
4. Restore into an empty isolated target. Require exact original-field values,
   key sets, duplicate multiplicities and counts before exercising behavior.
   Preserve database-generated identity/sequence state where present. Never
   silently add surrogate keys to accommodate the parent-claim backup.
5. Demonstrate conflict retention, read-budget continuity, audit retention,
   thumbnail comparison and legacy-consumer reads with synthetic cases. Resolve
   semantic parent/card/comment/client references even where SQL has no FK.
   Deliberate missing-row, duplicate-loss, object-missing and schema/ACL drift
   cases must fail rather than be ignored.
6. Verify no provider sends, n8n activity or external writes during restoration.
   Restored configuration and triggers are not permission to activate them.
   Object/document copying, if later required, needs an explicit controlled
   custody workflow and its own evidence.
7. Record the remaining 25 outside-corpus tables with their independent owners
   and preservation decisions. This nine-table contract does not approve their
   exclusion, establish a complete backup, or close the Linear-exit gate.

## Open implementation work

The existing keyed table package cannot absorb the no-primary-key backup by
assuming uniqueness. A duplicate-preserving encoding and restore path must be
reviewed and tested, or a separately authenticated companion must retain it.
Thumbnail object custody and referenced documents are separate from SQL rows.
The rescue configuration needs a private recovery and activation boundary.
The predecessor backup's origin remains untraced. No row population or loss is
inferred from table existence. Installation remains HOLD; no merge, deployment,
retention change, production write or n8n execution is authorized.

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

## Required integration boundary

Pair verification must read and validate the actual parent package bytes using
`readRecoveryPackage`, require history-v11, and derive the parent SHA256/catalog
fingerprint itself. A caller-supplied identity or a previously parsed object is
not sufficient. Valid linkage still does not prove a shared capture snapshot.

The existing parent capture owns an exported repeatable-read snapshot and closes
it before final package construction. The nine-table test currently owns a
separate transaction. A future integrated capture must collect companion rows
through the parent's still-open snapshot, validate the exact row contract there,
and publish neither artifact as a complete set after any component fails. Bind
the finalized parent bytes after successful capture. Do not reopen a snapshot
later or infer consistency from timestamps or catalog fingerprints. Sequence
state is non-MVCC and still needs a separate writer fence or equivalent proof.

Acceptance must include a concurrent source write between capture stages: the
parent and companion must retain the same snapshot view, while a deliberately
separate capture must fail the consistency requirement. Also exercise companion
capture failure, parent validation failure and incomplete set publication.
These are pending requirements, not assertions covered by the current row test.

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
