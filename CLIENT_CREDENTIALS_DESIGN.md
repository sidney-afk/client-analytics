# Client Credentials Design

SyncView now has a single source of truth for client social account logins. The feature lives in the `client-analytics` repo only; the public marketing site does not collect or display these credentials.

## Data model

Run `client-credentials-migration.sql` in the Supabase SQL editor before deploying the UI/function.

### `client_credentials`

Stores one live row per client/platform/label:

- `client_slug`, `client_name`
- `platform`, `label`
- `handle`, `password`, `notes`
- `status`: `active`, `needs_review`, `archived`
- `source`: `manual`, `onboarding`, `bulk_import`
- `raw_import`: original pasted/free-text source when available
- created/updated timestamps and actor metadata

The live uniqueness rule is `client_slug + lower(platform) + lower(label)` for rows that are not archived. Deletes from the UI archive the row so the audit trail remains intact.

### `client_credential_events`

Append-style audit log for creates, updates, deletes, reassignments, bulk/onboarding imports, and password reveals. Events include actor name, role, timestamp, field-level old/new values, IP address, best-effort country, and non-secret payload metadata. Password changes intentionally retain old/new values for recovery.

### `client_credentials_rev`

Non-secret realtime ping table. It contains only `client_slug`, `client_name`, `rev`, and `updated_at`. It is the only anon-readable credentials table and is added to Supabase realtime so open Kasper/SMM screens know when to refetch through the Edge Function.

## Security posture

The public Supabase key cannot read or write `client_credentials` or `client_credential_events`:

- RLS is enabled on both tables.
- Grants are revoked from `anon` and `authenticated`.
- No anon/authenticated policies are created.
- All credential reads/writes go through `supabase/functions/client-credentials` with the service role key.

The Edge Function requires `X-Syncview-Key` to match the `CREDENTIALS_STAFF_KEY` Edge secret. The passphrase is never committed to this repo. Staff enter it once per browser; the UI stores it locally and re-prompts on 401 so rotation is straightforward.

Client share links are guarded in two layers:

1. The calendar kebab item is not rendered when `_isClientLink` is true.
2. Even if someone calls front-end functions manually, the server-side credentials tables are unreachable without the staff passphrase.

Current limitation: this is still shared-passphrase auth with self-declared staff names. The audit trail records name, role, IP, country, and reveal events, but it is not a substitute for future per-user accounts.

## Edge Function actions

`POST /functions/v1/client-credentials`

Headers:

- `Content-Type: application/json`
- `X-Syncview-Key: <staff passphrase>`

Body always includes `action` and optionally `actor: { name, role }`.

Actions:

- `list`: returns credentials, optionally filtered by `client_slug`.
- `upsert`: creates/updates one credential and writes field-level audit events.
- `delete`: archives a credential and writes a delete snapshot.
- `reassign`: moves an unmatched/needs-review credential to a known client.
- `history`: returns audit events for `credential_id` or `client_slug`.
- `bulk_import`: dry-run preview or confirmed import for `Client | platform | handle | password | notes` lines.
- `onboarding_import`: parses free-text onboarding account access answers and stores them as `needs_review`.
- `log_reveal`: records that a password was revealed/copied.

The function avoids putting passwords in logs or error responses.

## Front-end surfaces

### Kasper tab

Kasper gets a `Client Credentials` subtab. It shows:

- search across clients/platforms/handles/notes
- unmatched/needs-review bucket
- client cards grouped by client
- masked passwords with reveal/copy buttons
- add/edit/delete actions
- credential history modal
- bulk import preview + confirm flow

### SMM calendar modal

Staff calendars get a `Client credentials` item in the More options menu. It opens the same credential rows for the currently selected client, without delete or bulk import controls.

### Identity prompt

On first use, the UI asks for staff name and passphrase. Name options are seeded from the Social Media Managers sheet through `_kasperLoadSMMMap()` plus Kasper/Synchro Social fallbacks. Both values are stored in localStorage for that device. If the Edge Function returns 401, the key is cleared and the prompt opens again.

## Rollout

1. Run `client-credentials-migration.sql` in Supabase SQL editor.
2. Set the Edge secret:

   ```bash
   supabase secrets set CREDENTIALS_STAFF_KEY='<passphrase>' --project-ref uzltbbrjidmjwwfakwve
   ```

3. Deploy the function:

   ```bash
   supabase functions deploy client-credentials --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   ```

4. Smoke-test with fake data:
   - public anon key cannot read `client_credentials`
   - missing/wrong `X-Syncview-Key` returns 401
   - add/edit/reveal/delete/history round-trip works through the function
   - `client_credentials_rev` increments after writes
5. Update n8n onboarding workflows to call `onboarding_import` after submission insert, with `onError: continue`.
6. Publish front end and distribute the passphrase out-of-band.
7. Use the Kasper bulk-import modal to load existing client credentials.
