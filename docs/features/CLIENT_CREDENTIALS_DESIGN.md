# Client Credentials Design

> **P1 SECURITY BLOCKER (F84).** Current list responses bulk-deliver plaintext passwords before the
> UI mask; direct API/DevTools extraction creates no reveal event; shared/legacy keys are not bound
> to an active member; and the first password edit would store old/new plaintext in readable event
> history. Treat this as historical design context, not approval to operate the vault. Replace it
> with individual sessions, metadata-only list, one-secret synchronous audited reveal, and no old
> plaintext history before go-live.

SyncView now has a single source of truth for client social account logins. The feature lives in the `client-analytics` repo only; the public marketing site does not collect or display these credentials.

## Data model

Run `migrations/client-credentials-migration.sql` in the Supabase SQL editor before deploying the UI/function.

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

Append-style audit log for creates, updates, deletes, reassignments, bulk/onboarding imports, and
password reveals. Events include actor name, role, timestamp, field-level old/new values, IP address,
best-effort country, and non-secret payload metadata. **F84 correction:** retaining old/new password
plaintext is not an approved recovery design and must be removed or replaced by an owner-approved
encrypted, access-controlled, time-limited break-glass mechanism.

### `client_credentials_rev`

Non-secret realtime ping table. It contains only `client_slug`, `client_name`, `rev`, and `updated_at`. It is the only anon-readable credentials table and is added to Supabase realtime so open Kasper/SMM screens know when to refetch through the Edge Function.

## Security posture

The public Supabase key cannot read or write `client_credentials` or `client_credential_events`:

- RLS is enabled on both tables.
- Grants are revoked from `anon` and `authenticated`.
- No anon/authenticated policies are created.
- All credential reads/writes go through `supabase/functions/client-credentials` with the service role key.

The Edge Function resolves `X-Syncview-Key` with the same timing-safe secret matcher as
`key-verify`. An admin or SMM role key is accepted; the creative role key used by editors and
designers is denied. The role comes from the matching secret - `X-Syncview-Role` and actor data
are audit metadata and cannot elevate access.

During the role-key transition, both historical secrets remain valid in parallel:
`CREDENTIALS_STAFF_KEY` and `ONBOARDING_STAFF_KEY`. This compatibility path is intentional and
reversible; no secret value is rotated or removed in this tranche.

Client share links are guarded in two layers:

1. The calendar kebab item is not rendered when `_isClientLink` is true.
2. Even if someone calls front-end functions manually, the server-side credentials tables are unreachable without an allowed staff key.

Current blocker: role/legacy keys are shared and the gateway does not resolve/bind the active staff
member at request time; actor name is body metadata. The audit trail therefore cannot prove who read
or changed a secret. F84 requires individually revocable sessions and server-derived actor before
this can be called an authorization/audit boundary.

## Edge Function actions

`POST /functions/v1/client-credentials`

Headers:

- `Content-Type: application/json`
- `X-Syncview-Key: <verified admin/SMM role key>` (preferred), or a transition-only legacy key

Body always includes `action` and optionally `actor: { name, role }`.

Actions:

- `list`: currently returns full credentials including passwords, optionally filtered by
  `client_slug`; F84 requires metadata-only output.
- `upsert`: creates/updates one credential and writes field-level audit events.
- `delete`: archives a credential and writes a delete snapshot.
- `reassign`: moves an unmatched/needs-review credential to a known client.
- `history`: returns audit events for `credential_id` or `client_slug`.
- `bulk_import`: dry-run preview or confirmed import for `Client | platform | handle | password | notes` lines.
- `onboarding_import`: parses free-text onboarding account access answers and stores them as `needs_review`.
- `log_reveal`: caller-invoked audit after the password was already downloaded/revealed; F84 requires
  a single server reveal operation whose audit succeeds before the one secret is returned.

The function avoids putting passwords in logs or error responses.

## Front-end surfaces

### Kasper tab

Kasper gets a `Client Credentials` subtab. It shows:

- search across clients/platforms/handles/notes
- unmatched/needs-review bucket
- client cards grouped by client, **collapsed by default** (the header keeps the client name, credential count and any "needs review" chip visible; click to expand). Expanded state survives background realtime repaints.
- masked passwords with reveal/copy buttons. Current “instant reveal” is visual masking only: every
  password is already in JS memory and the audit is fire-and-forget. F84 blocks this pattern; future
  reveal must fetch one secret just-in-time after synchronous durable audit.
- add/edit/delete actions
- credential history modal (the full audited change log; there is no longer an inline "Updated by" line under each row)

Bulk import is no longer surfaced as a Kasper button. The `bulk_import` Edge Function action still exists for onboarding and programmatic imports; re-add a UI entry point if a manual paste-import flow is needed again.

The list refreshes live on any peer add/edit/archive (via the `client_credentials_rev` realtime ping), and also background-refreshes when Kasper returns to the subtab so a change made while he was on another tab is never stale. A background refresh defers briefly while a client/platform picker dropdown is open so it cannot collapse the reassign control mid-use.

### SMM calendar modal

Staff calendars get a `Client credentials` item in the More options menu. It opens the same credential rows for the currently selected client, without bulk import controls. The top-right × closes it (the redundant footer "Close" button was removed). It subscribes to the per-client realtime ping, so a change made by Kasper or another staff member updates the open modal live.

### Signed-in identity

With a valid `syncview_staff_identity_v1` identity, the credentials surfaces reuse the verified
name, role, and role key from staff sign-in; they do not show a separate credentials prompt. If
the Edge Function returns 401, the shared identity is cleared and the normal staff sign-in form
opens again. The key is sent only to Edge Function writes/guarded reads, never to n8n fallbacks or
client links.

## Role-key transition and legacy retirement

The transition is deliberately additive. Keep both legacy secrets configured until all of these
proof gates are complete:

1. The offline source matrix is green for admin, SMM, creative/editor/designer, invalid keys, and
   every legacy fallback.
2. TEST/dummy browser checks prove admin can open onboarding and save a filming-plan link, admin
   and SMM can complete credentials reads/writes, recognized-but-disallowed roles receive 403
   without losing their valid staff session, and invalid keys receive 401 and clear that identity.
3. Inventory every non-browser caller of the legacy keys, including the known
   `onboarding_import` automations. Migrate each caller to an approved role/service identity or
   explicitly keep its legacy path indefinitely.
4. Add identifier-only authorization telemetry (`auth.via=role|legacy`, never a key value) and
   observe zero legacy use for an owner-approved window that includes at least one normal
   `onboarding_import` run.
5. Staff have used the shared sign-in identity through a normal working window with no unexpected
   re-prompts or lockouts. `auth_enforcement` remains `permissive` throughout.

Retirement is a later, owner-approved PR: remove only the legacy comparisons and obsolete
surface-specific browser storage after the proof gates, then keep the old secret values available
privately for one rollback window. Do not rotate or delete either legacy secret as part of this
consolidation sprint.

### No-lockout release and rollback order

1. From the feature branch, manually dispatch **Deploy onboarding + credentials edge functions**.
2. Verify every function deploy is green and run the role/legacy smoke matrix against TEST data.
3. Only then merge the frontend so Pages begins reusing the signed-in role identity.
4. If the frontend has trouble, roll back Pages first while leaving the additive backend deployed.
   After the prior UI is confirmed healthy, the backend may be rolled back separately if needed.

Do not use a whole-commit revert that can race Pages against older function code.

## Rollout

1. Run `migrations/client-credentials-migration.sql` in Supabase SQL editor.
2. Keep the existing legacy Edge secret configured during the role-key proof window (no value
   change is required):

   ```bash
   supabase secrets set CREDENTIALS_STAFF_KEY='<passphrase>' --project-ref uzltbbrjidmjwwfakwve
   ```

3. Manually dispatch **Deploy onboarding + credentials edge functions** from the feature branch and
   wait for the complete workflow to pass before publishing the frontend.

4. Smoke-test with fake data:
   - public anon key cannot read `client_credentials`
   - admin + SMM role keys pass
   - creative/editor/designer role keys return 403 and keep the valid shared identity
   - missing/wrong keys return 401 and clear the invalid identity
   - both existing legacy key paths still pass
   - add/edit/reveal/delete/history round-trip works through the function
   - `client_credentials_rev` increments after writes
5. Update n8n onboarding workflows to call `onboarding_import` after submission insert, with `onError: continue`.
6. Only after the backend workflow and smoke matrix are green, publish the frontend. Do not mint,
   rotate, or redistribute a separate surface passphrase for this transition.
7. Use the Kasper bulk-import modal to load existing client credentials.
