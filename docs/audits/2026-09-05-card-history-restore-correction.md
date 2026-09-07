# Card-history restore correction: local proof and held gates

**DRAFT / UNAPPLIED. No production access or change.** This correction starts
from preserved PR #1299 `85018bf83ab49527c79ca86d521c6a08a31e3277` in a separate
checkout/branch. The independent review audited Claude's
`af929858628443cd6a44d85ad535d912dc26492a`,
`docs/audits/2026-09-05-card-history-adversarial-review.md`. Remote main was
captured once at `ab6366136c03239965c97b050ab5cf7c9763a228`; unrelated changes
were not incorporated. The original PR, journal migration/rollback, website,
Edge Functions, writers, anonymous policy and existing private proof stay intact.

## Adjudication

| Claim | Judgment and independent evidence | Bounded response |
|---|---|---|
| F-A: v4 cannot restore into the normal expanded schema | **CONFIRMED.** Actual PostgreSQL catalog built with real dependency migrations has 9 incoming FKs from 8 excluded tables; original `TRUNCATE` of the 21 covered relations fails even when those tables are empty. Exact F27 relation DDL adds the tenth incoming edge through rollback intents. | New explicit `history-v5`, exact 33 tables; actual catalog boundary checks and `RESTRICT`. No omitted relation is truncated or silently discarded. |
| F-A: PR #1299 alone made every existing legacy restore unusable | **OVERSTATED.** Its broad existence guard additionally rejected baseline Calendar/Samples. But raw pre-guard 14-table TRUNCATE already refuses the expanded dependency schema. | Narrow the extra guard to retained journal/manifests; preserve incoming/outgoing FK refusal and explicitly limited legacy restore. Full-schema legacy recovery is not claimed fixed. |
| F-B: data-only package cannot reconstruct the actual schema | **CONFIRMED / RELEASE BLOCKER.** `pgDumpArgs` requests data only; package authentication has no captured schema payload/binding. The original fixture supplies platform prerequisites rather than reconstructing the installed database. | Exact authenticated-schema/empty-target artifact contract in `TRACK_B_BACKUP.md`. No artifact producer or full reconstruction implemented in this finite correction. The prior migration failures/recipe remain historical evidence, not bypassed production gates. |
| F-C: omitted comment crosswalk and mutation receipts lose replay evidence if excluded from a future broader restore | **CONFIRMED.** Real lifecycle DDL has two crosswalk FKs and one mutation-receipt FK, with delete cascades from the canonical store. Intake receipt data is also absent from v4. Existing RESTRICT refuses rather than silently losing these tables. | Include all three in v5. Actual full-row restore plus the real lifecycle RPC proves exact accepted edit replay makes no new comment, event, journal or outbox change; a changed fingerprint still conflicts. |
| Adding those three relations removes 5 of the 9 FK edges | **WRONG.** Actual catalog: crosswalk 2, mutation receipts 1, intake receipts 0, total 3. | Correct the arithmetic without changing the substantive coverage finding. |
| Journal ordinary-write atomicity needs weakening to fix restore | **WRONG as a proposed remedy.** This defect is restore corpus/schema coverage. | Journal capture, immutable retained data and save-failure atomicity remain byte-identical. |

## Exact correction boundary

V3 remains 14 tables; v4 remains 21, with their original authentication meanings.
V5 adds the eight dependency tables, F27 rollback parent/intents/generations and
the provider-era intake receipt ledger. The complete list and manual rollout
are owned by `docs/ops/TRACK_B_BACKUP.md`. All 33 are mandatory even when empty;
F27's gated migration is not silently treated as optional because it is hard
to reconstruct. Unknown incoming/outgoing dependencies refuse source preflight
or restore. TRUNCATE remains `RESTRICT` and no FK is disabled or dropped.

The v5 grant artifact has its own scratch trigger helper and does not replace
the original v4 helper. Complete relation/key/identity/FK/role validation occurs
before grants. A real first rehearsal failed COPY because private receipt CHECK
validators lacked EXECUTE for the scratch role. The corrected artifact gives
only that scratch principal six exact immutable, security-invoker validators
and the pgcrypto digest dependency. The production backup principal receives
SELECT only; no writer RPC or anonymous access is widened. The failed rehearsal
database/package/log are retained privately as evidence.

The extra HR and provider recovery payloads remain confidential. Their actual
private backup-principal/folder access needs owner review before activation.
The v5 source privilege check runs a catalog DO block. Actual non-quiet psql
prints a command tag even with tuples-only, so the production preflight now
uses an explicitly quiet argument builder. The local proof runs those exact
arguments and preserves an unquiet negative control; errors and exit status
remain enforced.

Public output contains source symbols, hashes and aggregate test outcomes only.
The operational tools continue to suppress raw PostgreSQL stdout/stderr errors.

## Finite local proof

The explicit local-only runner `scripts/card-history-closed-corpus-rehearsal.js`
uses its own isolated server/database identities, never a production URL. The
production-origin string used for pure package metadata never reaches a
connection function. It adds seven full source migrations (F201, F202, F203,
comment lifecycle, attachments, PTO and intake receipts), the exact mapping
CREATE TABLE, and the three F27 CREATE TABLEs plus actual outbox FK/columns.
It includes F27's exact outbox CHECKs and a non-null drill-parent FK, with a
wrong-COPY-order negative control. It records full-file and extracted-DDL hashes.
It does not execute F27's gated
installer, substitute a successful install receipt, start provider workers, or
run a real client drill.

The 19 finite database checks cover the actual 9/10 FK counts, the old raw14/21
TRUNCATE failures, all33 read-only grants, nonempty typed data in every table,
real `pg_dump`/authenticated package/restore, unexpected source and target FK
refusal, failing COPY rollback with unchanged data/triggers, exact full-row
equality, comment replay/conflict behavior, source crosswalk/intake payloads,
private access denial and absence of network extensions/foreign servers.
The prior 21-table rehearsal separately retains its 14 COPY/FK/sequence/rollback
checks. Offline tests retain all 33 v3/v4 groups and add 41 v5 groups.

These are local source-shaped proofs. The platform foundation still includes
minimal roles, storage/publication and foundational relation scaffolding; F27
function/worker semantics and the installed whole-schema fingerprint are not
proved. The separate source catalog preflight does not prevent a DDL race before
pg_dump; matching snapshot/controlled-DDL schema capture remains required.
No cloud delivery, live capacity, client UX, alert delivery, retention
duration or live serving revision is claimed. The schema-artifact blocker and
the separately failing comment-save/reopen conservation prerequisite remain
held. A schema hash or a successful 33-table data COPY alone cannot lift them.

## Source evidence ledger

Prior behavior is auditable at `85018bf83ab49527c79ca86d521c6a08a31e3277`:

| Path / symbol | Evidence |
|---|---|
| `scripts/track-b-backup.js` / `TABLES`, `HISTORY_TABLES`, `pgDumpArgs` | Exact14/21 data-only coverage |
| `scripts/track-b-restore-rehearsal.js` / `restoreSql` | Broad old legacy guard; RESTRICT; no omitted-data destruction |
| `migrations/2026-07-15-pto-tracker.sql` / three PTO CREATE TABLEs | Three team-member FKs |
| `migrations/2026-07-28-linear-project-ids-team-shape.sql` / mapping CREATE TABLE | Client FK |
| `migrations/2026-07-23-f34-f53-production-attachments.sql` / access-check and asset-ref CREATE TABLEs | Two deliverable FKs |
| `migrations/2026-07-23-production-comment-thread-lifecycle.sql` / links, receipts, `production_comment_lifecycle_write` | Three dependency FKs and exact replay/conflict contract |
| `migrations/2026-07-20-f27-team-rollback.sql` / rollback intents and outbox ALTER | Installed-shape incoming intent FK plus its parent and corresponding generation state |
| `migrations/2026-07-14-linear-intake-receipts.sql` / receipt table and immutable validator functions | Stored canonical recovery payload; COPY's real CHECK-function permission dependency |

Current proof receipts record exact hashes for the changed runtime, manual SQL
and runner plus the unchanged journal. Historical proof documents remain
historical; they are not rewritten to claim their old minimal fixture covered
the expanded schema.
