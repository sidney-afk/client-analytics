# Track-B recovery package: local proof of schema-and-data reconstruction

**DRAFT / DORMANT / NOT A RETENTION OR RECOVERABILITY CLAIM.** This closes the
F-B schema-artifact blocker in source and local proof only. Base: PR #1311
`aab2acd23112f7bdff849a9c0b68306d41bbf62c` (stacked on preserved PR #1299
`85018bf83ab49527c79ca86d521c6a08a31e3277`). Remote `main` was observed at
`ab6366136c03239965c97b050ab5cf7c9763a228`; unrelated changes were not
integrated. No production or TEST access, merge, deployment, migration apply,
flag change, n8n action, provider call, credential or billing change, alert or
schedule occurred. The frozen anonymous client writers, authentication and
journal capture are byte-identical to the base.

## What is delivered

| Path | Role |
|---|---|
| `scripts/track-b-recovery-package.js` | capture (`capture`, `verify`), package format `SYNCVIEW_TRACK_B_RECOVERY_V1`, statement splitter and allowlist classifier, catalog fingerprint, reconstruction SQL, post-restore verification, dormant watcher evaluation |
| `scripts/track-b-recovery-reconstruct.js` | empty-target reconstruction CLI with production-ref refusal and `EMPTY_SCRATCH_ONLY` confirmation |
| `scripts/track-b-recovery-prerequisites.sql` | manual restricted-principal preparation, `mode=capture` / `mode=target` |
| `scripts/track-b-recovery-rehearsal.js` | local disposable end-to-end proof, wired into the unit CI job |
| `test/track-b-recovery-package.js` | offline format, classifier, tamper, reconstruction-order, verification and watcher gates |
| `docs/ops/TRACK_B_BACKUP.md` | recoverable boundary, prerequisites, operator use, rollback, unproved gates |

`scripts/card-history-closed-corpus-rehearsal.js` gained one export
(`seedDependencies`) so the new proof reuses the same synthetic dependency seed
and the same accepted comment-edit replay statement; its assertions are unchanged.

## Baseline fails, candidate passes

- At the base, the only restore path is data-only `COPY` into a *prepared*
  fixture. The candidate's rehearsal runs that exact base `restoreSql()` against
  the empty prerequisites-only target as the same restricted role and asserts
  that it fails (`relation does not exist`) and leaves zero public objects.
  The candidate's reconstruction of the same target then passes.
- `test/track-b-recovery-package.js` and the rehearsal do not exist at the base;
  `node test/run-all.js` at the base cannot exercise them.

## Local proof (PostgreSQL 16.13, SCRAM-authenticated, disposable)

Rehearsal result: **16 checks PASS**. Package SHA-256 of the proof run:
`2051cb34ac7f840e1a3667802019858957b35e8f4e9977f7ab06903cdc9722f6` (synthetic
data; the file was deleted with the databases).

| Check | Evidence |
|---|---|
| Capture prerequisites | a role holding INSERT is refused; then whole-schema SELECT is granted |
| Target prerequisites | a BYPASSRLS role and a non-empty target are refused before any grant |
| Password authentication | `pg_dump` and `psql` with wrong or empty passwords fail with `password authentication failed`/`fe_sendauth` for both roles; the correct password connects as the capture role |
| DDL race | an `ALTER TABLE` committed between the snapshot dumps and the post-check makes capture throw `catalog change` and no file is written |
| Capture | 616 schema statements, 33 data tables with rows, 4 omitted data tables, fingerprint equal to a direct source query, `pgcrypto` pinned, zero egress-capable functions, no password bytes in the package |
| Tampering | flipped tag byte, flipped body byte, wrong key, re-signed digest, statement-count, row-count and corpus mutations are all refused |
| Missing dependency / unexpected state | a required extension or role absent, or one pre-existing table, refuse before DDL with the target unchanged |
| Baseline control | base data-only restore fails on the empty target and leaves it empty |
| Failed restore | a corrupted `COPY` row rolls the whole reconstruction back to zero public objects |
| Reconstruction | receipt: fingerprint match, 33 tables, no egress, zero realtime membership restored (reported, not silently claimed); direct fingerprint query on the target equals the source |
| Exact content | `to_jsonb` rows for all 33 tables equal; `pg_sequences` state equal; `nextval` on the journal sequence returns the same value on both |
| Ownership | every relation and sequence owned by the restore role, which is not superuser, createrole, createdb or BYPASSRLS |
| RLS / grants / triggers | `anon`/`authenticated` denied on journal, HR, receipts and intake tables; `service_role` may read but not insert the journal; immutable guards refuse UPDATE/DELETE/TRUNCATE; a `service_role` card save produces a new journal row above the restored counter with the correct before/after image |
| Replay | the accepted comment-edit statement replays with no row change in any of the 33 tables; a changed fingerprint returns `idempotency_conflict` |
| No egress | no foreign server; extensions are only `plpgsql` and `pgcrypto`; outbox rows unchanged |
| Watcher | quiet inputs produce no alerts; stale, drifted, failed and changed inputs produce the four documented codes |

Offline test: **10 groups PASS** (splitter, classifier accept/skip/reject
matrix including owner changes, extensions, roles, default privileges, `DO`,
publications, subscriptions, servers, event triggers, `COPY ... PROGRAM`,
non-`plpgsql`/`sql` languages, other schemas, unknown grantees, grant option,
`DROP`, `TRUNCATE`, `SET role`, `ALTER SYSTEM`, psql shell; round-trip;
tamper/splice/legacy-reader refusal; reconstruction ordering with no
destructive statement; unsafe-name refusal; verification enforcement; watcher
codes; CLI guards).

Source hashes bound by the proof run:

| Path | SHA-256 |
|---|---|
| `scripts/track-b-recovery-package.js` | `520d5f56d21d7a7e455cf61c5b3f3ab4f5780e2066663a14ebdd825ab382a9b8` |
| `scripts/track-b-recovery-reconstruct.js` | `30a559719cd3a8d47fa223f7bba12cbb8546fadfcc603d4015da6568a1942754` |
| `scripts/track-b-recovery-prerequisites.sql` | `7c61f3ab52280149c26554a820eb6128f73ee7a514c2ca35882ea41a8660f477` |
| `scripts/track-b-recovery-rehearsal.js` | `f1bda150b125a9b85151f68c6c0374e35436c098481d67c32074a586ae9862d7` |
| `scripts/track-b-backup.js` (unchanged from base) | `d7a60fddbeca8ac46dc305b32e0c18772d95dceee64460c725663d4426b05615` |
| `migrations/2026-09-05-card-change-journal.sql` (unchanged) | `1a353835fee61ab8d52ae3f9ed94d83ea1fdb85f6ba9e45eace642409c96ef1e` |

## Design decisions worth reviewing

- **Boundary is whole-`public` schema, corpus-only data.** `pg_dump -t` drops
  every function, so a corpus-only schema dump cannot recreate triggers; the
  whole schema is the smallest coherent unit. Non-corpus tables come back empty
  and are enumerated, so the omission is visible, never silent.
- **Snapshot import cannot be `--serializable-deferrable`.** PostgreSQL refuses
  to import an exported snapshot into a READ ONLY DEFERRABLE transaction, so the
  three dumps use repeatable read on the exported snapshot; the fingerprint
  before/after comparison is the DDL boundary.
- **Order pre-data, COPY, sequences, post-data** is what makes the restored
  journal exact: capture triggers and immutable guards do not exist during
  COPY, and no trigger can call out.
- **Platform objects are pinned, not fabricated.** Roles, extensions, schemas
  and the realtime publication are verified on the target; membership is not
  re-added because that needs publication ownership. The receipt states how
  many tables would need it.
- **Owner names are never restored** (`--no-owner`, `OWNER TO` rejected). The
  restricted target role owns everything, which is also why SECURITY DEFINER
  functions and the journal's owner-bypass keep working after reconstruction.

## Explicitly unproved

Private Drive storage and independent readback of a recovery package; parity
between the installed production schema and the reconstructed shape (the source
here is migration-shaped synthetic scaffolding with pinned local
prerequisites, not a Supabase project); asset bytes; HMAC key custody outside
GitHub secrets; fingerprint stability across PostgreSQL major versions;
elapsed retention; alert delivery; hosted CI on this head. Journal
installation, Linear shutdown and any billing change remain unauthorised.
