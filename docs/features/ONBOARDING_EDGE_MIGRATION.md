# Onboarding: Edge Functions + Templates merge + Kasper full view

> **SECURITY BLOCKERS (F77/F85).** The three credential-stripped list readers are anonymous P0
> disclosures. The unstripped full reader denies missing keys but accepts shared/legacy secret
> possession without active-member binding or read audit. This document is historical rollout
> context; do not use its key-retention steps as current authorization approval.

This replaces the n8n onboarding **list** webhooks with Supabase Edge Functions, moves
the onboarding inbox out of Templates, and gives Kasper a full (credentials-included)
onboarding view. Builds on `LEGACY_ONBOARDING.md` (the old-forms import).

## What changed

### 1. Reads are Edge Functions now (not n8n)
Four functions under `supabase/functions/` (service-role; the onboarding tables have no
anon access):

| Function | Auth | Returns |
|---|---|---|
| `onboarding-list` | none | standard `client_onboarding`, **logins stripped** |
| `ai-onboarding-list` | none | `ai_client_onboarding`, **logins stripped** |
| `legacy-onboarding-list` | none | `legacy_onboarding` `fields` only (never `credentials`) |
| `onboarding-full` | **admin role key** + legacy `X-Syncview-Key` fallback | all three, **UN-stripped** — names, emails, phones, credentials |

The three list functions strip the account-login answer keys
(`instagram, instagram_backup, tiktok, facebook, linkedin, youtube`) exactly like the old
n8n "Strip Credentials" node. `onboarding-full` accepts the admin role key sent in
`X-Syncview-Key`; SMM and creative/editor/designer keys are denied. F85 proves secret-derived role
alone is insufficient because the reader does not bind an active member or audit access. For the additive transition, the old
`ONBOARDING_STAFF_KEY` remains valid and still falls back to `CREDENTIALS_STAFF_KEY` only when no
dedicated onboarding key is configured. All comparisons use the shared timing-safe matcher.

The dashboard points at `https://<project>.supabase.co/functions/v1/<name>`
(`ONBOARDING_EDGE_BASE` in `index.html`). The n8n list webhooks are left in place for a
clean revert; archive them once the functions are confirmed live.

### 2. Onboarding left the Templates tab
The Templates/Onboarding sub-tab toggle is gone — Templates is just templates again. On a
client's template profile, an **"Onboarding" button next to the name** (shown only when a
record exists, matched by `slug`) opens that client's onboarding in a **new tab**
(`?onboarding_view=<slug>`): read-only, credential-free, **no email/phone** — a boot mode
that mirrors `?onboarding=` (bypasses the staff password, hides chrome, loads no dashboard
data).

### 3. Kasper gets an Onboarding tab
A new **Onboarding** subtab in Kasper's area shows the three-section inbox (Standard / AI /
Old forms + search), fed by `onboarding-full`. Kasper sees **everything**: names, emails,
phones, and an **Account access** section with the account logins. For the standard/AI
funnels that comes from the full `answers`; for old forms it comes from the
`legacy_onboarding.credentials` column.

### 4. `legacy_onboarding.credentials` column
Old-form logins were stripped from `fields` at import. They now live in a separate
service-role-only `credentials jsonb` column (added by `migrations/legacy-onboarding-migration.sql`'s
`alter table ... add column if not exists`). The values are loaded **out of band** — never
committed to this repo. Only `onboarding-full` returns them.

## Deploy checklist (order matters)

1. **Deploy the 4 functions** (from this branch):
   ```
   supabase functions deploy onboarding-list        --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   supabase functions deploy ai-onboarding-list     --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   supabase functions deploy legacy-onboarding-list --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   supabase functions deploy onboarding-full        --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   ```
2. **Keep the legacy Kasper passphrase secret during the proof window** (do not rotate it; skip if
   the existing `CREDENTIALS_STAFF_KEY` fallback already covers it):
   ```
   supabase secrets set ONBOARDING_STAFF_KEY='<staff passphrase>' --project-ref uzltbbrjidmjwwfakwve
   ```
3. **Add the credentials column** (one line, in the Supabase SQL editor):
   ```sql
   alter table public.legacy_onboarding add column if not exists credentials jsonb;
   ```
4. **Load the old-form credentials** into that column (done out of band — via the loader,
   not committed).
5. **Merge** so `index.html` (pointing at the edge functions) goes live.
6. Once verified, **archive** the n8n list workflows (`slqt2zCDyIc7OAmY`, `oDZ1Oljvaig5KSLD`,
   `ydbhXgV3X7SVnkSy`).

> From the feature branch, manually dispatch **Deploy onboarding + credentials edge functions**
> and verify it is green **before** the frontend merge. If the frontend needs rollback, restore
> Pages first and leave the additive functions deployed until the prior UI is healthy.

The shared retirement gate is documented in `docs/features/CLIENT_CREDENTIALS_DESIGN.md`. Do not
remove either legacy secret path until the admin role-key onboarding read and filming-plan write
have both passed TEST/dummy browser proof, all non-browser callers (including
`onboarding_import`) are inventoried, identifier-only telemetry shows zero legacy use across the
approved window, and the owner approves the separate retirement PR.

**Not migrated:** the form **submit** path stays on n8n (it also fires the Slack DMs); moving
that is a separate job.
