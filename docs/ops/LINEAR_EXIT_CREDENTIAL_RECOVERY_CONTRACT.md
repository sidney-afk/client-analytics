# Credential recovery preparation contract

Status: prepared in-memory authenticated triple with isolated PostgreSQL acceptance.
Durable three-part storage, encryption, handler behavior and hosted recovery remain open.
No live credential rows were read. Installation remains HOLD.

The next coherent custody group among the 25 remaining tables is
`client_credentials`, `client_credential_events`, and `client_credentials_rev`.
The schema owner is `migrations/client-credentials-migration.sql`; application
behavior belongs to `supabase/functions/client-credentials/index.ts`. These
contain original values and history that cannot be assumed recoverable from
Linear or regenerated from revision counters.

## Preservation requirements

- Preserve every original column and row, including archived credentials,
  nullable fields, raw imports, actor metadata and timestamps. Preserve active
  replacement rows alongside archived versions; retain the partial uniqueness
  rule rather than deduplicating by client/platform/label.
- Preserve complete events, including reveal, change and reassignment history,
  old/new values and payloads. A missing current credential does not justify
  deleting its history. Verify actual dependency constraints before capture.
- Preserve revision counters and timestamps exactly. Resetting counters or
  reconstructing only current credentials cannot replace an authenticated copy.
- Use a separately versioned, authenticated custody contract. Do not silently
  widen history-v11 or the fixed nine-table companion. Bind the exact parent
  bytes and shared snapshot and compare restored row multisets before commit.
- Require private storage and explicitly proven encryption/off-device custody
  before hosted use. HMAC authentication does not encrypt these fields. Publish
  only source, synthetic test results and sanitized hashes/counts; never real
  credential values, raw imports, audit payloads or client display names.

## Isolated acceptance

Compose the exact schema owner and all discovered follow-up migrations in a
fresh disposable database. Seed only synthetic active, needs-review and archived
rows, including an active replacement with the same normalized label; populate
nullable/raw-import fields and multiple event types. Capture and restore using
the real versioned package path. Require exact columns, rows, keys, constraints,
policies and intended grants, plus rollback on omitted history or altered values.

Exercise actual anon and authenticated roles: credentials and events must remain
unreadable; revision metadata must retain its explicitly allowed SELECT policy.
Record the revision table's intended `supabase_realtime` membership as well.
Publication restoration needs an explicit later-stage contract: the current
recovery quarantine must not silently activate subscriptions. SELECT permission
alone does not prove revision notifications.
Do not infer an Edge Function's authorization from SQL ACL checks. Rehearse the
real handler separately with isolated SDK operations to verify staff authorization,
revision updates and audit writes; that remains distinct from a hosted save.
Restoring data must not trigger credential reveals or provider requests.

Existing source tests (`onboarding-credentials-import.js`,
`credentials-mark-reviewed.js`, `credentials-identity-persist.js`) are useful
regressions but do not prove populated capture/restore or byte custody. Source
onboarding payloads remain a separate preservation group even when credential
imports pass. No remaining table is approved for exclusion by this plan.

## Following groups

After this three-table contract, review original onboarding/fallback submissions,
human weekly reports, hiring event/invitation history, and authored templates and
caption prompts. Preserve pending-job identities without re-executing invitations.
These are source-based priorities, not findings of actual loss or authorization
for live migration, retirement or deletion.


## Prepared API and evidence

Use `captureTriple(options)` from the credential capture module, and object
arguments `{parentBytes, priorityBytes, credentialBytes, hmacInput}` for
`verifyTriple` and `reconstructTripleSql`. The credential envelope authenticates
both preceding component hashes and a pinned35-column schema. The parent carries
an authenticated requirement for the credential component; current incomplete
renderers refuse it. Older readers are unsupported for complete triple recovery.

The source schema and populated acceptance reports are
LINEAR_EXIT_CREDENTIAL_SCHEMA_20260911.json and
LINEAR_EXIT_CREDENTIAL_RECOVERY_20260911.json. Run the portable PG17
`credential-schema` and `credential-recovery` lanes to reproduce scoped checks.
The existing pair storage format does not store a credential triple. Do not
present a saved two-part container as the complete new backup.

Next: explicit versioned three-part durable storage and private encryption/custody,
then isolated handler behavior. Preserve the source revision publication intent
while keeping recovery quarantine inert. This does not authorize hosted use.
