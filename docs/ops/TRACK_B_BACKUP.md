# Track-B private backup and restore rehearsal

> **Historical legacy-v3 status: MERGED & ACTIVE since 2026-07-15 (PR #840, merge `4f9d919`).** The recurring 6-hourly
> schedule was provisioned for the legacy configuration recorded in that release. Proof run
> `29444939853` uploaded and independently re-read a real 14-table Shared Drive package, and a 229 s
> dedicated-scratch restore matched every count with zero orphans. PITR is owner-declined (accepted
> residual). To roll back, disable the workflow or revert PR #840.

The new history-v4 preparation below is **DRAFT / UNAPPLIED**, with separate
schema, grant, restore and owner opt-in gates. The historical receipt above
proves only its original 14-table package, not the new 21-table coverage.

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
the selected exact 14- or 21-table corpus count, primary keys, and SHA-256 checksums for both the PostgreSQL dump and its
compressed payload. The complete manifest and payload are authenticated with a
required HMAC-SHA-256 key that is not stored in Drive. A missing/extra table,
changed byte, wrong HMAC, row-count mismatch, or checksum mismatch fails the
run. The existing weekly full backup remains independent and unchanged.

### Prepared history-v4 expansion: inactive until owner opt-in

`history-v4` adds exactly seven tables: `calendar_posts`, `sample_reviews`,
`calendar_post_events`, `sample_review_events`, `workload_plan`,
`card_change_journal`, and `production_intake_manifests`. The result is exactly
21 tables in one snapshot, including source comment cells, review events,
planning rows, retained row-change history, and native intake request receipts.
Calendar and Samples keys are the ordered pair `[client, id]`; Workload uses
`issue_id`, the journal uses `id`, and intake manifests use `request_id`.

This source change does **not** install schemas or grants, change the schedule,
or prove capture was enabled for any observation period. Corpus completeness
means those 21 tables were backed up; it does not prove uninterrupted capture,
client feedback conservation, historical backfill, asset bytes, or provider
exports. Rollback may disable capture while backups still preserve prior rows.

The package reader authenticates both v3 and v4. An old v3 package remains a
valid **limited legacy backup**; it is never evidence of the seven added
tables. Export preflight and the strict COPY parser require every table in the
selected corpus, even when a table has zero rows. One missing relation, grant,
COPY section, primary-key column, or failed dump aborts the export; there is no
partial-corpus success. V4 signs its corpus name, schema version, exact 21-table
manifest, composite keys, row counts and checksums under the existing HMAC.

The workflow uses `TRACK_B_BACKUP_CORPUS` (repository variable), defaulting to
`legacy-v3` when unset. **Do not set it to `history-v4` on source merge.** A manual
dispatch can explicitly select `backup_corpus=history-v4` for the approved proof
without changing subsequent scheduled runs. Both jobs use the same selection.
Once history is required, a fresh signed v3 package cannot satisfy freshness
or `download-latest`; a newest v3 candidate keeps freshness red even if an older
v4 is available. Before opt-in, a complete v4 package is an acceptable superset
for the legacy freshness requirement. A legacy-mode restore of that selected
v4 still requires the fully prepared v4 scratch schema and helper.

Proceed only through these manual gates:

1. Review the exact journal SQL and its staged-install gates in
   `CARD_CHANGE_HISTORY.md`, including the unresolved comment-refusal/reopen
   continuity gate. Install only after those gates separately pass. Confirm
   PR #1293's `production_intake_manifests` schema at reviewed commit `5418ab56`
   (migration `2026-09-05-native-intake-root-manifest.sql`) and its prerequisite
   native writer schema. It is a separate uninstalled/unmerged prerequisite;
   this backup change neither includes nor deploys that migration.
2. Independently record the actual production and disposable scratch targets
   privately. Apply the exact 21-table schema and its dependency closure in the
   dedicated scratch project. An uncovered table with a foreign key into the
   corpus causes `TRUNCATE ... RESTRICT` to refuse; prepare a dedicated target
   or stop. Never broaden the truncate or disable foreign-key constraints.
3. A database owner reviews and manually runs
   `scripts/track-b-history-backup-prerequisites.sql` using the **existing**
   dedicated role, `mode=backup`, and
   `confirmation=HISTORY_BACKUP_GRANTS_ONLY` on production. It validates all
   relations, actual primary keys, identity sequences and restrictive role
   privileges before granting SELECT. It creates no roles/passwords and does
   not grant table writes to the backup principal. Existing BYPASSRLS and
   connectivity remain separate prerequisites.
4. Only on the independently verified disposable scratch target, run that
   artifact with `mode=scratch`, the existing scratch role,
   `confirmation=DISPOSABLE_SCRATCH_ONLY`, and `scratch_project_ref`. The ref
   parameter records an operator assertion; it cannot verify a SQL connection's
   host. The actual restore launcher independently validates the host/ref.
   This grants SELECT/INSERT/TRUNCATE and sequence access on exactly 21 tables,
   creates the distinct private history trigger helper, and revokes its execute
   access from PUBLIC/anon/authenticated/service_role. A pre-existing history
   helper requires separate owner/ACL review; this artifact refuses replacement.
5. Explicitly dispatch the 21-table backup plus scratch restore. Retain private
   authenticated package and independent Drive readback, exact 21-table counts,
   composite-key checks, zero core integrity failures, identity behavior,
   trigger-state restoration, and failed-COPY/old-v3 restore refusal proofs.
   Preserve a pre-rehearsal scratch snapshot if its contents matter. No public
   raw package or rows. Local synthetic proof is preparation only.
6. After these proofs and owner review, explicitly set the repository variable
   to `history-v4`. Check the first scheduled authenticated 21-table export,
   seven-hour freshness and independent alert delivery. A missing grant/table
   stops this gate. Observe the agreed capture window separately; neither this
   workflow nor a green backup supplies that duration evidence automatically.

Clients continue using the same readers/writers while backup preparation runs;
SELECT-only export makes no product writes. Journal installation has its own
continuity gates and cannot be justified by this statement. If expansion fails,
keep the prior authenticated packages, fix prerequisites and leave the schedule
on v3; record history coverage as blocked. Returning the variable to v3 is
reversible scheduling rollback but explicitly abandons the expanded coverage
gate. Do not delete previously captured history or v4 packages.

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
scratch Supabase project, apply the production schema migrations to it, and set:

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
refuses any target where one of the seven history-v4 tables exists, before
changing triggers or data. Restore old packages only to an isolated legacy
schema; inspect their limited data there and use a separately reviewed recovery
procedure to transfer needed records. V4 uses the separate
`track_b_restore_set_history_user_triggers(boolean)` helper, with all scratch
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
