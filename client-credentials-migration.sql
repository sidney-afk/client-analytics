-- ============================================================
-- SyncView Client Credentials migration SQL
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent.
--
-- SECURITY (important): client credentials contain real third-party account
-- passwords. The public browser key must never read or write the credential or
-- audit tables. Those tables are RLS-enabled with no anon/authenticated grants;
-- the browser talks only to the client-credentials Edge Function, which uses the
-- service role key after checking the X-Syncview-Key staff passphrase.
--
-- client_credentials_rev is the only anon-readable table here. It contains only
-- client_slug/client_name/rev/updated_at so open staff screens can subscribe to
-- realtime and refetch through the Edge Function when something changed.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.client_credentials (
  id                uuid primary key default gen_random_uuid(),
  client_slug       text not null,
  client_name       text not null,
  platform          text not null,
  label             text not null default '',
  handle            text,
  password          text,
  notes             text,
  status            text not null default 'active' check (status in ('active','needs_review','archived')),
  source            text not null default 'manual' check (source in ('manual','onboarding','bulk_import')),
  raw_import        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text,
  created_by_role   text,
  updated_by        text,
  updated_by_role   text
);

create index if not exists client_credentials_client_idx
  on public.client_credentials (client_slug, status, lower(platform), lower(label));

-- One live row per client/platform/label. Archived rows keep history without
-- blocking a fresh active replacement later.
create unique index if not exists client_credentials_live_unique
  on public.client_credentials (client_slug, lower(platform), lower(coalesce(label, '')))
  where status <> 'archived';

alter table public.client_credentials enable row level security;
revoke all on public.client_credentials from anon;
revoke all on public.client_credentials from authenticated;

create table if not exists public.client_credential_events (
  id                uuid primary key default gen_random_uuid(),
  credential_id     uuid,
  client_slug       text,
  client_name       text,
  event_at          timestamptz not null default now(),
  actor             text,
  actor_role        text,
  action            text not null check (action in ('create','update','delete','bulk_import','onboarding_import','reassign','reveal')),
  field             text,
  old_value         text,
  new_value         text,
  ip                text,
  country           text,
  payload           jsonb
);

create index if not exists client_credential_events_credential_idx
  on public.client_credential_events (credential_id, event_at desc);
create index if not exists client_credential_events_client_idx
  on public.client_credential_events (client_slug, event_at desc);

alter table public.client_credential_events enable row level security;
revoke all on public.client_credential_events from anon;
revoke all on public.client_credential_events from authenticated;

create table if not exists public.client_credentials_rev (
  client_slug       text primary key,
  client_name       text,
  rev               bigint not null default 0,
  updated_at        timestamptz not null default now()
);

alter table public.client_credentials_rev enable row level security;
revoke all on public.client_credentials_rev from anon;
revoke all on public.client_credentials_rev from authenticated;
grant select on public.client_credentials_rev to anon;
grant select on public.client_credentials_rev to authenticated;

drop policy if exists "client credential rev anon read" on public.client_credentials_rev;
create policy "client credential rev anon read"
  on public.client_credentials_rev
  for select
  to anon, authenticated
  using (true);

-- Add the non-secret rev table to realtime. Supabase throws if it is already in
-- the publication, so catch duplicate_object to keep the migration idempotent.
do $$
begin
  alter publication supabase_realtime add table public.client_credentials_rev;
exception
  when duplicate_object then null;
end $$;
