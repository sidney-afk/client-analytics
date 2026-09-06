# Recovery package correction: sequences, executable dependencies, failure recovery, staged catalog

**DRAFT / DORMANT / NOT A RETENTION OR RECOVERABILITY CLAIM.** This corrects the
bounded schema-and-data recovery slice. It is not a new audit and not a broader
recovery redesign.

## Exact tree

| Item | Value |
|---|---|
| Preserved reviewed commit | `8fa163b79475f50474c092eafa6e6db446d2241e` (PR #1313) |
| Its base | `aab2acd23112f7bdff849a9c0b68306d41bbf62c` (PR #1311) |
| Pinned dependency, integrated as a recorded merge | `f0e77a47a1e26a1e2a97b514ee06cec824c31b90` (PR #1316), parent `ab6366136c03239965c97b050ab5cf7c9763a228` |
| Dependency migration | `migrations/2026-09-05-native-label-catalog-foundation.sql`, SHA-256 `ba19247491e2f809aaf211fb517838eeda9d1edb246cb1698943e70a14e1aa1a` (verified in-tree and re-asserted by the rehearsal at run time) |
| Remote `main` observed, NOT chased | `99d31c815de3e1a46deeb01c45c09bf2937040ad` |

The original 8fa evidence, the 16-group rehearsal it recorded, and the
coordinator's completed probes are preserved as separately attributed baseline
controls. No original failure was replaced with a corrected result.

## Baseline controls carried forward

The coordinator's three completed capture/reconstruct probes at 8fa returned
success with matching schema fingerprints while LOSING state. Each is now a
named regression control in the rehearsal, and each fails on 8fa's behaviour:

| Coordinator probe at 8fa | Corrected behaviour |
|---|---|
| Large sequence: source next `9007199254740994`, restored next `9007199254740993` | Exact `(last_value, is_called)` as validated decimal strings; restored next allocation is `9007199254740994`, asserted equal to the source's |
| Uncalled sequence: source next `9000`, restored next `1` | `is_called` is carried as a real boolean; restored next allocation is `9000` |
| Executing CHECK: restored ordered digest differed after a routine changed another copied corpus row | A writing CHECK function now REFUSES the capture (`impure public callable` / `writing statement`) and writes no package |

The independent permission review's 10 offline groups and the six actual-source
classifier probes (callable CHECK/index expressions, a cross-schema CHECK, a
multi-target cross-schema grant, function bodies with writes or a program
primitive) proved filter ACCEPTANCE, not absence of side effects. Those exact
shapes are now refused; the multi-target/cross-schema grant gap is closed and
covered by its own offline group.

## Corrections

### 1. Exact sequence state

`sequencesSql` (8fa line 300) projected `pg_sequences.last_value`, which is NULL
for an uncalled sequence and is not its state, and `sequenceValueSql` (line 484)
re-emitted it through a JavaScript Number with `is_called` hard-coded `true`.
Verification (line 543) compared the same lossy projection, so both losses
verified green.

Now: `sequenceStateSql` reads the sequence relation itself for `(last_value,
is_called)` plus its catalog definition, all as text. `validateSequenceState`
requires canonical decimal STRINGS, a real boolean `is_called`, a supported type
and an in-range value, and is applied at read time, at SQL generation and at
verification. `setval` is emitted with the exact string and the real flag. The
manifest binding covers every sequence, so a re-signed value cannot ride along
under an unchanged binding.

Compatibility: `recovery_version` is now **2**. Version 1 packages carried the
lossy projection and are REFUSED with a message naming the reason, never
reinterpreted. No absent historical state is invented.

Explicit limit: sequences are not MVCC objects. Their state is read inside the
capture window but can legitimately be later than the row snapshot; it can never
be earlier than any value the rows use. That is stated in the manifest's
`snapshot_isolation` field and the runbook.

### 2. Executable dependencies and effective permissions

`classifySchemaStatement` (8fa lines 157-189) permitted callable expressions and
bodies; `reconstructSql` (502-505) emitted them around COPY; the keyword count
at line 171 was not an execution boundary.

Now there is a positively bounded callable contract, described in the runbook.
Every callable an evaluated expression names must resolve to a non-denylisted
`pg_catalog` function, a pinned extension function, a PURE public function
(immutable, invoker, `sql`/`plpgsql`, no writing statement, transitively
checked), or nothing. Anything else refuses the capture. Capture and reader
derive the token set with the SAME extraction over the SAME statements, so they
cannot disagree; the target re-verifies before any DDL.

Effective permissions are re-checked on the actual connecting role immediately
before reconstruction, including the no-BYPASSRLS requirement, inherited
superuser, eight dangerous role memberships, and EXECUTE on the file,
large-object and configuration catalog functions. **Measured, not assumed:** on
PostgreSQL 16 a plain LOGIN role can already execute `pg_sleep`, `set_config`,
`pg_notify`, `pg_advisory_lock`, `pg_export_snapshot` and `pg_terminate_backend`
because they are granted to PUBLIC by default, so holding them proves nothing
about a role; exactly eight signatures are withheld by default and those are the
privilege signal. All of them stay on the expression denylist regardless.

The prerequisite script's `grant execute on all functions in schema extensions`
(8fa lines 67-69) is replaced by EXECUTE on exactly three reviewed signatures,
with the script refusing if the role ends up holding more. This defect was found
by the new check, not assumed. An extension's PUBLIC default EXECUTE is reported
as a pinned platform property, never widened, never revoked.

ACL validation now requires exactly one `public` target with no comma list, no
other schema, no grant option and no `GRANTED BY`. The confirmed 8fa parser gap,
`GRANT SELECT ON TABLE public.review_card, auth.users TO anon`, is refused, as
are the cross-schema and `ALL TABLES IN SCHEMA` forms. No claim is made that
ordinary `pg_dump` emits that shape.

### 3. Precommit versus postcommit failure recovery

8fa committed at `reconstructSql` line 506 and verified separately at
`track-b-recovery-reconstruct.js` lines 56-58, so a verification failure left
committed state while the runbook (lines 240-242) called deleting the package a
rollback.

Now verification of fingerprint, per-table content digests, exact sequence state
and ownership runs **inside the transaction before COMMIT**, so every detectable
mismatch prevents the commit. The three outcomes `rolled_back`,
`committed_unverified` and `verified` are never conflated; classification
compares the target's relation count observed before the attempt with the count
after, so a pre-DDL refusal on a populated target is a rollback and a transport
failure is never read as an empty rollback. A `committed_unverified` target is
quarantined with a private diagnostic receipt, is never erased automatically,
and is recovered onto a FRESH empty target. The runbook rollback claim is
corrected: deleting the package is not a database rollback.

Both paths are tested separately: an in-transaction failure (forged content
digest) leaves the target empty, and a post-commit transport failure on its own
fresh target yields `committed_unverified` with the data actually committed.

### 4. Native catalog: schema AND staged data

`public.production_label_catalog_versions` has a UUID primary key, seven
columns, no foreign key and no sequence, with two immutable triggers covering
UPDATE/DELETE and TRUNCATE, RLS with no policies and explicit ACLs. v5's 33
tables do not cover its rows, and whole-public schema capture is NOT its data
restoration.

A new explicitly versioned corpus `history-v6` adds exactly that one relation
(34 tables). v3, v4 and v5 keep their exact table sets, magic bytes and signed
meanings; the offline suite asserts this. Because its rows are trigger-protected,
the destructive TRUNCATE + disable-user-triggers snapshot restore REFUSES v6
outright rather than bypassing the protections; the empty-target recovery
package is its only restore, where the immutability triggers are created after
the rows load and come back enabled. The rehearsal proves the staged content,
identity, `verification_state`, both triggers enabled, refusal of
UPDATE/DELETE/TRUNCATE on the restored copy, and that activation and
`read_active` remain held after recovery. No activation, importer, runtime
caller or provider work is built here.

## Results on the final pinned source

| Lane | Result |
|---|---|
| `scripts/track-b-recovery-rehearsal.js` (disposable PostgreSQL 16.13, SCRAM) | **PASS, 30 groups** |
| `test/track-b-recovery-package.js` (offline) | **PASS, 18 groups** |
| `test/track-b-backup-closed-corpus.js` (preserved v5) | **PASS, 41 groups** |
| `test/track-b-backup-corpus.js` (preserved v3/v4/v5) | **PASS, 33 groups** |
| `test/track-b-backup.js` (preserved) | **PASS** |

The rehearsal's 30 groups contain the original 16 and their refusal/negative
controls unchanged in intent, plus the corrected controls above. Executed
versus skipped status is preserved: nothing is skipped in these lanes.

The full offline suite ran 409 suites with two failures, both pre-existing on
this base and unrelated to this correction: `test/truth-sync.js` (freshness
commits unresolvable in a shallow clone; it passes 527/527 in hosted CI) and,
during development, `test/comment-strip-is-honest.js`. The latter was a REAL
defect this gate caught in my own rewrite: two block-comment strips used the
raw non-greedy regex the gate forbids (OPEN_REPAIRS 145). PostgreSQL block
comments nest, so that regex stops at the first inner terminator and leaves
commented-out code visible to the purity scan — a writing statement inside a
nested comment could have read as pure. It is replaced by a depth-counting
`stripBlockComments`, and both suites pass on the final source.

Aggregate receipts on the final pinned source (public-safe; synthetic data only):

| Item | Value |
|---|---|
| Rehearsal | PASS, 30 groups, 34 data tables, 14 sequences, 647 schema statements |
| Callable classes classified | 23 `pg_catalog`, 11 `public_pure`, 1 `extension`, 2 `not_a_function` |
| Synthetic package SHA-256 | `d97956fb8329fc6840c055c837c34c0897e5ad9f83fbe038d9326fad2367c9f0` |
| `scripts/track-b-recovery-package.js` | `90768f446046a6e7809eda0c5bff188c9b00291700db0ccf91987f1444d5fbdd` |
| `scripts/track-b-recovery-reconstruct.js` | `f7552223ac898f4ded6801a6a0e39b7d264f389bb57bef3b3f83cae4c9ef9b16` |
| `scripts/track-b-recovery-prerequisites.sql` | `c9572d74ac636eb3a423095048c01aaa830dbdc656ec196966c79c7fa4d463e0` |
| `scripts/track-b-recovery-rehearsal.js` | `2e410e8626a2c36c655cee1d75c102fb5847f0e8fe82636aa4d5883d6629212a` |
| `scripts/track-b-backup.js` | `ea15180b2bb05e6f3d38006f99c3656b8aa7dcfef24c40d12580c62f627f1247` |
| `scripts/track-b-restore-rehearsal.js` | `32ffc422cb39914ef03d7c6f921a8c8ac6b71b47d7c2e6effbfb58128b4532c6` |
| `migrations/2026-09-05-card-change-journal.sql` (unchanged) | `1a353835fee61ab8d52ae3f9ed94d83ea1fdb85f6ba9e45eace642409c96ef1e` |
| `migrations/2026-09-05-native-label-catalog-foundation.sql` (pinned dependency) | `ba19247491e2f809aaf211fb517838eeda9d1edb246cb1698943e70a14e1aa1a` |

Both runners re-hash every bound source before and after execution and refuse a
PASS if any changed mid-run.

## Two honest boundaries, stated rather than papered over

- A re-signed content digest passes the reader (a row digest cannot be
  recomputed from COPY text without a database) and is caught in-transaction.
- A re-signed sequence VALUE is authoritative input, not a checksum: it is
  applied verbatim and the verifier then agrees with it. Only the HMAC key
  protects that field. Malformed shapes are refused at read time.

## Explicitly unproved, unchanged by this correction

Cloud retrieval and private Drive readback of a recovery package; parity between
the installed production schema and the reconstructed shape (the source here is
migration-shaped synthetic scaffolding with pinned local platform
prerequisites, not a Supabase project); asset bytes; HMAC key custody; elapsed
retention; alert delivery; installed grants; serving behaviour. The journal's
comment-failure continuity gate, label catalog activation, `read_active`,
runtime callers, provider completeness and live import remain held. No
production or TEST access, migration apply, deployment, merge, workflow
dispatch, flag change, n8n action, provider call, credential or billing action,
or alert occurred. No grant approval is requested by this correction.
