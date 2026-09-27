# syncview-session: SyncView v2 login pass (design record, 2026-09-27)

Owner decisions (2026-09-27): SyncView v2 signs in with the same staff role
key and client share-link token as v1, turned into a short-lived login the
database can check. v1 does not change in any way. Closing the old public read
access (the ANON_READ_SCOPE "phase 2") is NOT part of this.

## Why this shape

The project signs access tokens with asymmetric keys (ES256, read from
`/auth/v1/.well-known/jwks.json` on 2026-09-27). Their private half never
leaves Supabase Auth, so an Edge Function cannot sign a token itself. Instead:

1. The v2 browser signs in as a Supabase **guest** (anonymous sign-in).
2. It calls `syncview-session` with that guest login plus exactly one
   credential: `X-Syncview-Key` (staff) or `X-Syncview-Client-Token` with
   `body.client` (client).
3. The function refuses anything that is not a guest (`auth.getUser`,
   `is_anonymous`), then checks the credential with the shared
   `authorizeBrowserWrite` (the same code every writer uses, including the
   client's `clients.active` offboarding check).
4. It writes the guest's `app_metadata` (service role only; the user cannot
   edit it):

   | claim | staff | client |
   |---|---|---|
   | `svc_scope` | `staff` | `client` |
   | `svc_client` | `""` | verified slug |
   | `svc_role` | `admin` / `smm` / `creative` | `""` |
   | `svc_version` | `1` | `1` |
   | `svc_stamped_at` | ISO time | ISO time |
   | `svc_expires_at` | stamped + 8 h | stamped + 8 h |

   Every key is always written, so a re-stamp never leaves a stale scope.
5. The browser refreshes its session; Supabase copies `app_metadata` into
   every new access token (`auth.jwt() -> 'app_metadata'`).

## Rules for anything that reads these claims

- Require `svc_scope` (and `svc_client` = the row's client for client rows)
  **and** `(auth.jwt() -> 'app_metadata' ->> 'svc_expires_at')::timestamptz > now()`.
- Never grant on `is_anonymous`, on the `authenticated` role alone, or on
  `user_metadata`.
- A refresh keeps `app_metadata`, so the 8-hour expiry is what bounds a stamp
  after its key or token is rotated or its client is offboarded. v2 re-runs
  the function (re-checking the credential) on load and before expiry.

## Preconditions (met 2026-09-27)

- Guest sign-in turns every guest into the `authenticated` role, so before it
  was turned on, `authenticated` had to hold nothing `anon` does not. The
  three tables where it did were revoked
  (`migrations/2026-09-27-authenticated-grants-revoke-three.sql`) and the full
  authenticated-minus-anon delta (tables, sequences, columns, functions,
  schemas, policies) was measured live at 0 rows. Re-run that readback before
  adding any policy for `authenticated`.
- No Edge Function trusts a Supabase login; all check SyncView keys or tokens.

## Deploy and rollback

- Deploy: the one-function exact-SHA lane
  (`.github/workflows/deploy-single-function.yml`, `syncview-session`), owner's
  go only. `verify_jwt = false`: the function checks the guest itself.
- Rollback: delete the function (v1 never calls it). Stamps already written
  expire within 8 hours and grant nothing while no policy reads them.
