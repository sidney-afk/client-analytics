# Track-B private backup and restore rehearsal

> **Historical legacy-v3 status: MERGED & ACTIVE since 2026-07-15 (PR #840, merge `4f9d919`).** The recurring 6-hourly
> schedule was provisioned for the legacy configuration recorded in that release. Proof run
> `29444939853` uploaded and independently re-read a real 14-table Shared Drive package, and a 229 s
> dedicated-scratch restore matched every count with zero orphans. PITR is owner-declined (accepted
> residual). To roll back, disable the workflow or revert PR #840.

The history-v5 correction below is **DRAFT / UNAPPLIED / NOT RECOVERABILITY-READY**.
A matching authenticated schema artifact and empty-target restore proof are
missing: this is a RELEASE BLOCKER. The historical receipt above proves its
original limited 14-table package only. No live state was refreshed here.

The `Track-B private backup` GitHub Action takes one transactionally consistent
PostgreSQL snapshot of the selected, explicit Track-B corpus, then uploads it to the existing private
Google Drive backup folder every six hours. It uses one non-parallel `pg_dump`
process with `--serializable-deferrable`; it does not page through the REST API
or read tables concurrently. The package exists only in the Actions runner's
temporary directory and Google Drive. It must never be uploaded as a GitHub
artifact or committed to this repository because it contains client review
tokens, comment bodies, and other service-only data.

## Coverage

The installed historical format, `legacy-v3`, remains the default 14-table allowlist:

- `team_members`, `clients`, `client_access`, `client_access_events`
- `syncview_auth_events`, `syncview_runtime_flags`, `flag_flips`, `settings_events`
- `batches`, `deliverables`, `production_comments`, `deliverable_events`
- `mirror_outbox`, `linear_archive`

Every package has a manifest with its source project, source commit, snapshot
isolation mode, exact table row counts parsed from the dump's `COPY` sections,
the selected exact 14-, 21-, or 33-table corpus count, primary keys, and SHA-256 checksums for both the PostgreSQL dump and its
compressed payload. The complete manifest and payload are authenticated with a
required HMAC-SHA-256 key that is not stored in Drive. A missing/extra table,
changed byte, wrong HMAC, row-count mismatch, or checksum mismatch fails the
run. The existing weekly full backup remains independent and unchanged.

### Versioned coverage and current restore boundary

| Format | Exact data corpus | Meaning and limitations |
|---|---|---|
| legacy-v3 | Original 14 tables | Historical limited package; still readable and the default schedule. It omits source cards, journal and replay crosswalks. |
| history-v4 | Original 14 plus Calendar/Samples cards/events, Workload plan, journal and PR #1293 intake manifests: 21 | Preserved authenticated format. It omits real incoming FK dependencies and cannot restore into the normal migration-shaped schema. The previous minimal 21-table fixture did not prove that schema. |
| history-v5 | v4 plus the 12 relations below: 33 | New explicit opt-in format, closed over known FK dependencies. Data-only preparation; full-schema reconstruction, cloud delivery, installed grants and retention remain unproven. |

V5 additionally includes:

- `pto_members`, `pto_requests`, `pto_adjustments` and `linear_project_ids_shape_migration_20260728`;
- `production_asset_access_checks`, `linear_archive_asset_refs`;
- `production_comment_card_links`, `production_comment_mutation_receipts` and `linear_intake_receipts`;
- `track_b_team_rollbacks`, `track_b_team_rollback_intents` and `track_b_f27_team_fences`.

The private HR tables are necessary dependencies when restoring team-member
rows. Their inclusion requires explicit review of backup-principal and private
folder access before granting or activating this format. The rollback parent,
intents and corresponding generations travel together. This does not authorize
replaying recovered outbox/rollback work or reinstating saved provider authority.

The public package parser retains all three formats. V4's 21-table signed
meaning is unchanged; no format silently gains or drops a table. V5 authenticates
its corpus name, version, all 33 COPY sections, ordered primary keys, row counts
and dump/compression checksums. Empty but present tables are valid; missing
relations, grants, COPY sections or key columns refuse the whole export. Its
source preflight and every restore inspect the actual PostgreSQL FK catalog:
an incoming or outgoing FK across the selected corpus boundary aborts. A new
FK introduced between the separate source preflight and `pg_dump` is not
excluded by that preflight: it is not snapshot-wide closure proof. Controlled
DDL and matching schema/data capture remain the separate release gate below.
A new schema dependency requires a reviewed corpus revision. `TRUNCATE RESTRICT`
remains in place; it also refuses a concurrent new incoming FK after preflight.
No unbacked relation is truncated, constraints are not dropped, and no cascade
is used to manufacture a green restore.

Local source-derived catalog proof reproduced **9 incoming FKs from 8 omitted
v4 tables**, then **10** after adding the actual F27 intent FK. Raw legacy
14-table TRUNCATE also fails on that schema even without the later legacy guard:
this limitation predates PR #1299. The narrowed legacy guard stops treating
baseline Calendar/Samples existence alone as proof of installed history. It
still refuses a retained journal/intake manifest outside v3 and actual FK
boundaries. This is not a claim that full current-schema legacy restore works.

The older missing-table claims also need precision: adding the comment crosswalk
and mutation receipts internalizes **3** of those 9 FK edges; adding the intake
receipt table internalizes none. The prior audit's total of 5 is incorrect.

### RELEASE BLOCKER: authenticated schema and empty-target reconstruction

The package contains **data only**. `schema_version` is its format version, not
proof of a captured database schema. No schema artifact producer, authenticated
schema/data binding or empty-instance reconstruction is implemented here.
Applying every migration in filename order is not a valid substitute: baseline
function terminators/order, same-day ordering, Supabase-owned prerequisites,
superseded files and intentionally gated F27 installation require an explicit
recipe. Preserve the original failures; do not repair migrations ad hoc during
a purported recovery and then call the old package sufficient.

Before any v5 activation or claim of recoverable history, a separately reviewed
private capture/restore lane must provide all of the following:

1. An authenticated schema artifact bound to the exact data-package digest,
   corpus, server/extension versions, capture time, source commit and actual
   installed relation/function/trigger/constraint/grant fingerprints. Capture
   schema and data against the same exported snapshot with controlled DDL, or
   independently prove the schema did not change across that snapshot. A hash
   of repository migrations alone does not satisfy this requirement.
2. A versioned, tested reconstruction recipe for the needed public objects and
   cross-schema dependencies, extension versions, roles without passwords,
   ACLs, types, sequences, CHECK-validator functions, views, policies and user
   triggers. Inventory omitted non-FK operational state explicitly; 33 covered
   relations does not mean every platform table. No captured credential is
   published, and schema text may itself be confidential.
3. A truly empty, independently identified scratch target with external workers,
   webhooks, schedulers, provider credentials, realtime consumers and network
   effects disabled before restoration. Role/owner mapping and platform-owned
   Supabase objects need a reviewed recipe, not disposable id-only substitutes.
4. Restore the authenticated schema and data using that recipe, then compare
   exact current/historical values, source-to-canonical links and replay receipts;
   replay the same accepted comment/intake request without duplicate changes;
   prove FK/trigger/sequence safety and retain failed cases. Runtime verification
   currently checks counts and core integrity; full typed content equality is
   proven only in the separate local rehearsal, not the deployed restore job.

The 33-table local rehearsal adds seven complete real migrations and exact
CREATE/ALTER fragments and outbox CHECKs for the gated mapping/F27 relations to
the prior fixture. A real non-null F27 drill parent FK proves that rollback
parents must be copied before outbox rows; a reversed-order control fails.
Its platform foundation still supplies bounded role/storage/publication/table
scaffolding. It does not install the full F27 worker/functions or prove the
installed schema can be reconstructed. Its result closes the demonstrated
corpus defect, not this schema-artifact release blocker.

### Ordered rollout, still held

1. Preserve current default v3 exports and all old packages. Source merge does
   not switch the schedule, install capture, grant access or deploy any writer.
   The journal's failed-comment conservation gate in `CARD_CHANGE_HISTORY.md`
   remains a separate prerequisite. Source preparation changes no client UI.
2. Clear the schema-artifact blocker above. Independently verify installed
   objects against captured definitions, including F27 and PR #1293's manifest
   migration at `5418ab5618595d9469f0527bd94623e9229a637e`. All 33 relations
   are mandatory; absent prerequisites stop v5. This does not deploy the
   separate gateway or bypass any migration's installation guard.
3. After privacy review, a database owner may run
   `scripts/track-b-history-v5-backup-prerequisites.sql` with an existing
   restricted backup role, `mode=backup`,
   `confirmation=HISTORY_V5_BACKUP_GRANTS_ONLY`. The artifact validates exact
   relation keys, identity sequences, FK closure and forbidden privileges
   before granting SELECT. It creates no roles/passwords and gives that
   production backup principal no table writes or validator/writer RPC grants.
4. On independently verified isolated scratch only, run the same artifact with
   `mode=scratch`, `confirmation=DISPOSABLE_SCRATCH_ONLY` and its asserted
   `scratch_project_ref`. This assertion is not host proof; the restore
   launcher separately validates the target. The distinct
   `track_b_restore_set_history_v5_user_triggers(boolean)` helper is private
   to the scratch role; existing helpers are not overwritten. COPY also needs
   six exact immutable, security-invoker receipt CHECK validators plus the
   pgcrypto digest dependency. Only scratch receives those EXECUTE grants;
   anonymous/public/service-role permissions and writer RPC grants stay intact.
5. With explicit owner approval, dispatch `backup_corpus=history-v5` plus the
   isolated restore. Independently download/authenticate the stored private
   package and schema artifact, verify content and replay invariants, failed
   COPY rollback, unknown-FK refusal, sequences and unchanged user triggers.
   No raw packages, private rows or schema are GitHub artifacts. Clients use
   unchanged writers; export is SELECT-only and restore targets scratch.
6. Only after all preceding gates pass, explicitly select `history-v5` in
   `TRACK_B_BACKUP_CORPUS`. Its fresh v3/v4 predecessors cannot satisfy the
   v5 freshness/download requirement. Both jobs use the same selection. Prove
   first scheduled capture, independent alert delivery and the observation
   window. Code existence and one data snapshot do not prove 30-day retention.

Abort on a missing relation/constraint/validator, changed schema or target,
content/replay mismatch, capture/client regression or undelivered alert. Keep
all prior packages and retained journal data. A scheduling rollback to v3 is
reversible but abandons expanded coverage; it is not permission to delete
captured data. Recovery must keep provider workers off pending separate
review of restored authority/outbox/F27 generations and receipt debt.


## Repository configuration

These are already configured (the schedule is live on `main`); they are documented here for reference and rotation:

| Type | Name | Purpose |
|---|---|---|
| Secret | `TRACK_B_BACKUP_DATABASE_URL` | Production direct/pooler PostgreSQL URL for a dedicated read-only backup role. The script rejects a non-production project ref and rejects the role if it has `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` on any covered table. |
| Secret | `TRACK_B_BACKUP_HMAC_KEY` | Canonical base64 encoding of at least 32 random bytes, used to authenticate every snapshot package before parsing or restore. Generate separately from Drive credentials, for example with a cryptographically secure 32-byte random generator. |
| Secret | `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON` | Google authorized-user refresh JSON, or a service-account JSON/base64 JSON. Authorized-user JSON needs `client_id`, `client_secret`, and `refresh_token`. A service account **must** target a Shared Drive; sharing a normal My Drive folder as Editor does not give a service account storage quota. Otherwise use OAuth 2.0 on behalf of the human owner. |
| Variable | `TRACK_B_BACKUP_DRIVE_FOLDER_ID` | Existing private backup folder; share it only with the backup principal. |
| Optional secret | `SLACK_ALERT_WEBHOOK` | Legacy optional transport only. If absent, no Slack request is made. The standard alert is the failed GitHub Actions run and the repository owner's GitHub Actions email notification. |

Create a dedicated PostgreSQL login for `TRACK_B_BACKUP_DATABASE_URL`. Grant it
`CONNECT`, `USAGE` on `public`, and `SELECT` on the 14 covered tables plus their
sequences; grant `BYPASSRLS` so service-only rows are complete, but do not grant
table writes or membership in a write-capable role. The preflight fails if RLS
would hide rows or if the role has a covered-table write privilege.
Set the password only in the GitHub secret and rotate it after any exposure.
The workflow runs a privilege preflight before `pg_dump`. The validated host,
port, role, password, database, and TLS mode are passed through isolated libpq
`PG*` environment variables rather than a command-line connection argument.
The URL may have no query string or one `sslmode=require`, `verify-ca`, or
`verify-full` parameter. All redirection/configuration parameters (including
`host`, `hostaddr`, `user`, `dbname`, `service`, and `options`) are rejected,
fragments are rejected, and inherited `PG*` variables are removed before
launching PostgreSQL tools. The child process therefore uses the exact host,
project ref, user, database, and port that the guard validated; TLS defaults to
`require` when the URL omits `sslmode`.

`pg_dump` and `psql` output is treated as sensitive. On tool failure the Action
logs only the fixed stage, tool name, and exit state; it never includes stderr,
stdout, connection text, SQL, review tokens, comments, or row context. Captured
output is held in memory only for fixed-format checks. The dump/restore working
files stay under the runner temporary directory and are removed in `finally` or
the workflow cleanup step. No diagnostic file is persisted or uploaded.

The Google credential must be limited to the backup principal. For a My Drive
folder, use an authorized-user refresh credential. A service account has no My
Drive storage quota and must target a Shared Drive. Before dumping, the script
reads the configured folder with `supportsAllDrives=true`, requires add/list
capabilities, and requires a non-empty Shared Drive `driveId` for a service
account. Every folder listing uses `corpora=drive`, that exact `driveId`,
`includeItemsFromAllDrives=true`, and `supportsAllDrives=true`; create, metadata
readback, and byte download also set `supportsAllDrives=true` and verify the
exact parent folder plus Shared Drive ID.

After upload, the workflow fetches the file's Drive metadata and content back.
It requires the exact folder, filename, byte length, Drive MD5, local byte-for-
byte match, package HMAC, and internal checksums before reporting upload
success. Drive's upload response alone is not success. The last-known-good
pointer is derived from the newest package that passes complete authentication
and independent readback; it is never advanced from upload metadata alone. A
malformed newer candidate cannot supersede an older valid package.

The freshness check lists and downloads candidate packages from the private
folder. Filename and Drive `createdTime` are discovery metadata only. Each
candidate must pass HMAC, checksum, strict-dump, production-source, canonical
UTC timestamp, filename-to-signed-timestamp, and future-clock-skew validation.
The seven-hour age is calculated only from the authenticated manifest
`generated_at`. A corrupt file, arbitrary new file, or newly uploaded replay of
an old signed package cannot reset freshness. The newest discovered backup must
authenticate successfully, and the newest authenticated package must be no
older than seven hours. A missing, unverifiable, or stale newest backup prints
a public-safe failure reason and exits non-zero. GitHub therefore marks the run
failed so its built-in Actions email notification can reach the repository
owner; this requires the owner's GitHub notification settings to permit Actions
email. Slack is optional and is skipped entirely when its secret is absent. If
the optional Slack transport is configured, a successful alert writes an
HMAC-authenticated dedupe marker to the private Drive folder. The backup and
freshness paths make no write to the production database. Drive discovery
follows every page token and rejects missing, repeated, or excessive pagination
instead of silently accepting a truncated listing.

A later formatted-email transport such as Resend would require a verified
sending domain and DNS records, a scoped API key in GitHub Actions, an approved
From address, the owner recipient, and explicit retry/dedupe handling. None of
those are required for this zero-extra-service GitHub failure-email design.

## First Shared Drive proof

Manual branch run `29444939853` on 2026-07-15 used source `f9406b8` and remained
strictly read-only against production. It uploaded one 15,562,462-byte package,
matched Drive MD5 `130c2ec109239be280453462d81698a1`, downloaded the exact bytes,
verified the HMAC and exact parent, then independently listed/downloaded the
same package in the freshness step with zero invalid candidates. Package
SHA-256 was `3bc3f19d50f4f6c3d64559e15dacb2b1863ffcfbe256538392a12790d7ed66db`.
A separate Drive connector still listed the same filename and byte length after
runner cleanup. This proves the manual backup and durable Shared Drive storage;
the recurring schedule remains inactive until owner review and merge.

## Fault-injection contract

The focused backup test must keep these cases fail-closed before the workflow is
enabled:

- truncated or tampered packages fail HMAC authentication;
- Drive error-items and malformed newer candidates cannot replace the prior
  last-known-good package;
- a real zero-row `COPY` section is valid, while a missing section is not;
- Drive pagination must reach every page and reject repeated or truncated cursors;
- the workflow/corpus-count check requires one transactional exporter and the
  exact 14-table manifest/COPY set; this database-only F13 package does not claim
  to export n8n workflow JSON; and
- a metadata, MD5, length, folder, filename, or byte readback mismatch prevents
  last-known-good advancement;
- the freshness step folds in the file named by the same-run upload receipt
  when the Drive list index has not caught up: the file's live Drive metadata
  must still show the receipt's name in the configured folder on the
  configured drive (a moved or renamed file contributes nothing —
  `download-latest` could not discover it either), the candidate merges into
  the listing at its createdTime position so a newer malformed listed file
  keeps the newest-candidate canary seat, and the bytes are authenticated
  like every listed candidate — the receipt is discovery, never evidence
  (age comes only from the authenticated manifest timestamp).

The receipt exists because of the 2026-08-28 failure (run `33167562618`):
export uploaded and readback-verified a fresh snapshot, but the freshness
listing seconds later did not yet contain it, and the previous snapshot was
13.1h old because GitHub's degraded cron scheduler had skipped the intervening
`23 */6 * * *` runs. The list-index lag had been masked for as long as the
previous snapshot was always younger than the 7h threshold. A real cadence gap
with no same-run export (the scheduler skipping runs entirely) still fails the
gate — that half of the alert was correct and stays.

## One-time restore rehearsal

The restore job is manual and destructive to its target. Create a dedicated
scratch Supabase project using the authenticated schema artifact and reviewed
reconstruction recipe above; that capability is currently a release blocker.
A filename-order migration replay is insufficient. Then set:

| Type | Name | Purpose |
|---|---|---|
| Secret | `TRACK_B_RESTORE_DATABASE_URL` | Direct or pooler Postgres URL for a scratch-only restore role. Give it `SELECT`, `INSERT`, and `TRUNCATE` on the exact 14 tables plus `SELECT`, `USAGE`, and `UPDATE` on their six identity sequences; do not grant table `UPDATE` or `DELETE`. |
| Variable | `TRACK_B_RESTORE_EXPECTED_PROJECT_REF` | Exact scratch project ref parsed from that URL. |

Run `Track-B private backup` manually with `restore_rehearsal=true`. The job:

1. creates one consistent PostgreSQL snapshot and uploads its self-verifying package;
2. downloads it back and validates every manifest checksum;
3. authenticates the package HMAC before parsing or decompressing it;
4. refuses the production project ref and requires the exact scratch ref plus
   the literal `SCRATCH_ONLY` confirmation;
5. strictly parses the dump, rejecting every non-boilerplate statement,
   non-allowlisted table, unsafe identifier, and psql command, then regenerates
   only validated `COPY public.<Track-B table>` sections instead of executing
   the downloaded SQL;
6. restores those sections in one transaction with identities preserved; a
   scratch-only `SECURITY DEFINER` helper named
   `public.track_b_restore_set_user_triggers(boolean)` disables and re-enables
   only user triggers inside that transaction, while foreign-key constraints
   remain active. Deferred self-references are forced immediate and validated
   before user triggers are re-enabled. Revoke the helper from `PUBLIC` and
   grant it only to the scratch restore role;
7. verifies every table row count and core foreign-key joins; and
8. records the elapsed restore time in the private Actions run summary.

The rehearsal uses `TRUNCATE ... RESTRICT` and refuses uncovered dependencies.
It never truncates excluded tables by cascade. An old v3 restore additionally
refuses a target with a retained journal or intake manifest, before changing
triggers or data. Actual incoming/outgoing FK checks apply to every format.
Restore old packages only to an isolated compatible legacy
schema; inspect their limited data there and use a separately reviewed recovery
procedure to transfer needed records. V4 uses the separate
`track_b_restore_set_history_user_triggers(boolean)` helper; v5 uses the
separate `track_b_restore_set_history_v5_user_triggers(boolean)`, with all scratch
user triggers initially enabled normally; failed COPY rolls the transaction
and trigger changes back. Deferred constraints and trigger restoration precede
identity-counter adjustment. PostgreSQL sequence changes are not transactional:
the adjustment preserves the current counter as a floor and may advance it,
so a later failure can leave harmless numbering gaps but cannot rewind an
already-used counter. Restore proof must check this separately from row rollback.
Never point either mode at a shared development
project. After the single required rehearsal, retain the private Actions run as
the timing evidence; do not copy the package or database output into the repo.
Keep the HMAC key outside Drive. A Drive writer cannot create or alter a valid
package without it; rotating the key makes older packages unverifiable unless
the retired key is retained in the private recovery procedure.

## Point-in-time recovery status

This workflow does not enable Supabase point-in-time recovery. On 2026-07-15 the
owner explicitly opted out of the paid PITR add-on for this provisioning round.
Record PITR as unavailable and as accepted residual risk; do not invent a
verification timestamp or block the independent snapshot/restore proof on one.
The owner should revisit the narrower recovery window before a future authority
cutover. A green private-Drive readback and a timed scratch restore remain
separate requirements.

## Rollback

Disable `.github/workflows/track-b-backup.yml`. This stops backup scheduling and
freshness failure emails only; it changes no runtime flag, production authority,
or live write path. The existing weekly private backup continues independently.

**Integrated recovery follow-up, local/held:** `history-v6` adds the two FK-free recovery ledgers to v5 as a new exact35-table format. Prior versions retain their authenticated meaning; old restores refuse targets with newer recovery evidence. See `INTEGRATED_RECOVERY_CORPUS.md` for the finite combined proof, schema-artifact and feedback-RPC holds, manual prerequisites and unchanged legacy schedule default.

**Materialization recovery follow-up, local/held:** `history-v7` is an explicit
37-table format: v6's exact35 plus
`production_card_materialization_receipts` and
`production_card_materialization_ingress`, each with UUID `id` primary keys.
The scheduled default remains v3. v6 and earlier recovery paths refuse a target
that already contains either retained owner before the applicable source
preflight can proceed or restore can disable triggers/truncate data. This source-only package does
not install either table, grant an operational role, capture production data or
prove an authenticated schema reconstruction, restored writer behavior, or
live recovery. A future owner-run v7 grant artifact and an independently owned
scratch proof remain required before selecting v7 for any capture.
An initial disposable prerequisite attempt stopped at SQL parsing before any
grant or restore action because this artifact omitted the required parentheses
around its confirmation `CASE` expression. The source is corrected; the owner
must still re-run the prerequisites and complete the separate scratch restore
proof before v7 receives any recovery claim.
