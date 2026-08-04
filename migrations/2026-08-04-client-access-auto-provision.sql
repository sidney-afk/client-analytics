-- Auto-provision the per-client review token that "Share with client" links
-- are built from.
--
-- Why. `public.client_access` rows have only ever been created by the one-time
-- 2026-07-05/06 B0 seed (`scripts/b0-seed-auth-scaffold.js`); nothing has
-- created one since. Every client added after that seed therefore has a
-- `clients` row and no token, and `client-review-link` fails the SMM's share
-- button closed with `review_token_missing`. The first client to hit it was
-- `lukecutting` (roster row created 2026-07-29, after the seed).
--
-- Safety. Additive-only, and deliberately incapable of rotation: every write
-- below is INSERT ... ON CONFLICT DO NOTHING. Overwriting a stored token would
-- silently 401 every link the client already holds — the 2026-07-15
-- double-outage class (AGENTS.md frozen-writer callout, ROLLBACK.md F35 row).
-- There is no UPDATE against `client_access` anywhere in this file.
--
-- Belt and braces with the application: `client-review-link` also provisions a
-- missing token on demand for a verified staff caller. This trigger makes the
-- token exist before anyone clicks, including for the by-hand roster inserts
-- the new-client runbook step 6f prescribes.
--
-- Apply once, in the Supabase SQL editor. Source-only until `EXECUTION_LOG.md`
-- records the apply and readback.

begin;

create extension if not exists pgcrypto;

-- 24 random bytes -> exactly 32 unpadded base64url characters, the same shape
-- the B0 seeder minted with crypto.randomBytes(24).toString('base64url') and
-- the same shape `_shared/client-review-token-policy.mjs` mints.
create or replace function public.client_access_mint_review_token()
returns text
language sql
volatile
as $$
  select translate(
    replace(encode(gen_random_bytes(24), 'base64'), E'\n', ''),
    '+/',
    '-_'
  );
$$;

revoke all on function public.client_access_mint_review_token() from public;
grant execute on function public.client_access_mint_review_token() to service_role;

alter table public.client_access
  alter column review_token set default public.client_access_mint_review_token();

-- Every new roster client gets its token in the same transaction that creates
-- it, whether that insert comes from the app, a script, or the SQL editor.
create or replace function public.client_access_provision_for_client()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Internal bookkeeping rows are never shared with a client; the B0 seeder
  -- skipped them for the same reason.
  if new.kind = 'internal' then
    return new;
  end if;

  insert into public.client_access (slug, review_token, notes)
  values (
    new.slug,
    public.client_access_mint_review_token(),
    'Auto-provisioned on client creation'
  )
  on conflict (slug) do nothing;

  return new;
end;
$$;

revoke all on function public.client_access_provision_for_client() from public;

drop trigger if exists client_access_provision_for_client on public.clients;
create trigger client_access_provision_for_client
  after insert on public.clients
  for each row
  execute function public.client_access_provision_for_client();

-- Backfill the clients that already fell through the gap. ON CONFLICT DO
-- NOTHING means an existing token is left exactly as it is.
insert into public.client_access (slug, review_token, notes)
select
  c.slug,
  public.client_access_mint_review_token(),
  'Backfilled 2026-08-04 (post-B0-seed onboarding gap)'
from public.clients c
where c.active is true
  and c.kind <> 'internal'
on conflict (slug) do nothing;

commit;

-- Readback. The first query must return zero rows; the second proves every
-- token is the expected 32-character base64url shape. Neither selects a token.
select c.slug, c.display_name
from public.clients c
left join public.client_access a on a.slug = c.slug
where c.active is true
  and c.kind <> 'internal'
  and a.slug is null;

select
  count(*) as provisioned_rows,
  count(*) filter (where review_token ~ '^[A-Za-z0-9_-]{32}$') as well_formed_tokens
from public.client_access;

-- Rollback (owner-only, one command). Removes the automation and restores the
-- previous column default. It deliberately does NOT delete any minted token:
-- deleting one revokes a live client link, which is the outage this whole
-- change exists to prevent. Remove a specific row by hand only after that
-- client has been re-issued and confirmed on a fresh link.
--
--   begin;
--   drop trigger if exists client_access_provision_for_client on public.clients;
--   drop function if exists public.client_access_provision_for_client();
--   alter table public.client_access alter column review_token drop default;
--   drop function if exists public.client_access_mint_review_token();
--   commit;
