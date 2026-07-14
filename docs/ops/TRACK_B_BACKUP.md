# Track-B private backup and restore rehearsal

The `Track-B private backup` GitHub Action takes one transactionally consistent
PostgreSQL snapshot of every Track-B authority, security, state, ledger,
comment, retry, and archive table, then uploads it to the existing private
Google Drive backup folder every six hours. It uses one non-parallel `pg_dump`
process with `--serializable-deferrable`; it does not page through the REST API
or read tables concurrently. The package exists only in the Actions runner's
temporary directory and Google Drive. It must never be uploaded as a GitHub
artifact or committed to this repository because it contains client review
tokens, comment bodies, and other service-only data.

## Coverage

The fixed allowlist is:

- `team_members`, `clients`, `client_access`, `client_access_events`
- `syncview_auth_events`, `syncview_runtime_flags`, `flag_flips`, `settings_events`
- `batches`, `deliverables`, `production_comments`, `deliverable_events`
- `mirror_outbox`, `linear_archive`

Every package has a manifest with its source project, source commit, snapshot
isolation mode, exact table row counts parsed from the dump's `COPY` sections,
primary keys, and SHA-256 checksums for both the PostgreSQL dump and its
compressed payload. The complete manifest and payload are authenticated with a
required HMAC-SHA-256 key that is not stored in Drive. A missing/extra table,
changed byte, wrong HMAC, row-count mismatch, or checksum mismatch fails the
run. The existing weekly full backup remains independent and unchanged.

## Repository configuration

Configure these before enabling the schedule on `main`:

| Type | Name | Purpose |
|---|---|---|
| Secret | `TRACK_B_BACKUP_DATABASE_URL` | Production direct/pooler PostgreSQL URL for a dedicated read-only backup role. The script rejects a non-production project ref and rejects the role if it has `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` on any covered table. |
| Secret | `TRACK_B_BACKUP_HMAC_KEY` | Canonical base64 encoding of at least 32 random bytes, used to authenticate every snapshot package before parsing or restore. Generate separately from Drive credentials, for example with a cryptographically secure 32-byte random generator. |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Read/write the deduplicated freshness marker only; it is not used to export table data. |
| Secret | `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON` | Google authorized-user refresh JSON, or a service-account JSON/base64 JSON. Authorized-user JSON needs `client_id`, `client_secret`, and `refresh_token`. A service account should target a Shared Drive or otherwise have confirmed upload ownership/quota. |
| Variable | `TRACK_B_BACKUP_DRIVE_FOLDER_ID` | Existing private backup folder; share it only with the backup principal. |
| Secret | `SLACK_ALERT_WEBHOOK` | Direct, non-n8n Slack incoming webhook for freshness and reconcile alerts. |

Create a dedicated PostgreSQL login for `TRACK_B_BACKUP_DATABASE_URL`. Grant it
`CONNECT`, `USAGE` on `public`, and `SELECT` on the 14 covered tables plus their
sequences; grant `BYPASSRLS` so service-only rows are complete, but do not grant
table writes or membership in a write-capable role. The preflight fails if RLS
would hide rows or if the role has a covered-table write privilege.
Set the password only in the GitHub secret and rotate it after any exposure.
The workflow runs a privilege preflight before `pg_dump`, and the credential is
passed through `PGDATABASE` rather than a command-line argument.
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
folder, prefer an authorized-user refresh credential. A service account often
cannot own My Drive files; use it only after a real upload/readback proves the
folder is compatible.

After upload, the workflow fetches the file's Drive metadata and content back.
It requires the exact folder, filename, byte length, Drive MD5, local byte-for-
byte match, package HMAC, and internal checksums before reporting upload
success. Drive's upload response alone is not success.

The freshness check lists and downloads candidate packages from the private
folder. Filename and Drive `createdTime` are discovery metadata only. Each
candidate must pass HMAC, checksum, strict-dump, production-source, canonical
UTC timestamp, filename-to-signed-timestamp, and future-clock-skew validation.
The 26-hour age is calculated only from the authenticated manifest
`generated_at`. A corrupt file, arbitrary new file, or newly uploaded replay of
an old signed package cannot reset freshness. If no authenticated package is
fresh, the workflow posts a public-safe alert directly to Slack and fails. A
successful alert writes a `track_b_backup_freshness_alert` marker to
`deliverable_events`, so the same stale snapshot does not page repeatedly.

## One-time restore rehearsal

The restore job is manual and destructive to its target. Create a dedicated
scratch Supabase project, apply the production schema migrations to it, and set:

| Type | Name | Purpose |
|---|---|---|
| Secret | `TRACK_B_RESTORE_DATABASE_URL` | Direct or pooler Postgres URL for the scratch project. |
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
6. restores those sections in one transaction with identities preserved;
7. verifies every table row count and core foreign-key joins; and
8. records the elapsed restore time in the private Actions run summary.

The rehearsal may truncate tables that depend on Track-B rows in the scratch
project through `TRUNCATE ... CASCADE`. Never point it at a shared development
project. After the single required rehearsal, retain the private Actions run as
the timing evidence; do not copy the package or database output into the repo.
Keep the HMAC key outside Drive. A Drive writer cannot create or alter a valid
package without it; rotating the key makes older packages unverifiable unless
the retired key is retained in the private recovery procedure.

## Flip-week PITR gate

This workflow does not enable Supabase point-in-time recovery. Before each flip
week, the owner must verify in the Supabase dashboard that PITR is enabled and
current, and record the verification timestamp in the cutover evidence. A green
six-hour snapshot run and one timed scratch restore rehearsal are both required;
neither substitutes for the PITR check.

## Rollback

Disable `.github/workflows/track-b-backup.yml`. This stops backup scheduling and
freshness alerts only; it changes no runtime flag, production authority, or live
write path. The existing weekly private backup continues independently.
