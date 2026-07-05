-- Track B B0: auth + runtime-flag observability scaffold.
-- Additive-only. Production authority stays Linear/n8n; auth starts permissive.

create extension if not exists pgcrypto;

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text not null check (role in ('admin','smm','editor','designer')),
  team text check (team in ('video','graphics')),
  slack_user_id text,
  linear_user_id text,
  avatar_color text,
  default_for_team boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists team_members_name_role_team_unique
  on public.team_members (lower(name), role, coalesce(team, ''));

alter table public.team_members enable row level security;

drop policy if exists "anon read team_members" on public.team_members;
create policy "anon read team_members"
  on public.team_members
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.team_members to anon;
grant select on table public.team_members to authenticated;
grant select, insert, update, delete on table public.team_members to service_role;

create table if not exists public.clients (
  slug text primary key,
  display_name text not null,
  active boolean not null default true,
  kind text not null default 'client' check (kind in ('client','internal','test')),
  source text not null default 'sheet',
  slack_channel_id text,
  brand_kit jsonb,
  linear_project_ids jsonb,
  emoji text,
  board_status text not null default 'in_progress' check (board_status in
    ('backlog','planned','in_progress','paused','completed','canceled')),
  lead_member_id uuid references public.team_members(id),
  target_date date,
  board_desc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;

drop policy if exists "anon read clients" on public.clients;
create policy "anon read clients"
  on public.clients
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.clients to anon;
grant select on table public.clients to authenticated;
grant select, insert, update, delete on table public.clients to service_role;

create table if not exists public.client_access (
  slug text primary key references public.clients(slug),
  review_token text not null,
  token_rotated_at timestamptz not null default now(),
  notes text
);

alter table public.client_access enable row level security;
revoke all on public.client_access from anon;
revoke all on public.client_access from authenticated;
grant select, insert, update, delete on table public.client_access to service_role;

create table if not exists public.client_access_events (
  id bigint generated always as identity primary key,
  slug text,
  event_at timestamptz not null default now(),
  ok boolean not null default false,
  mode text not null default 'permissive',
  reason text,
  source text,
  ip text,
  user_agent text
);

create index if not exists client_access_events_slug_idx
  on public.client_access_events (slug, event_at desc);

alter table public.client_access_events enable row level security;
revoke all on public.client_access_events from anon;
revoke all on public.client_access_events from authenticated;
grant select, insert, update, delete on table public.client_access_events to service_role;
grant usage, select on sequence public.client_access_events_id_seq to service_role;

create table if not exists public.syncview_auth_events (
  id bigint generated always as identity primary key,
  event_at timestamptz not null default now(),
  surface text not null,
  client_slug text,
  actor text,
  role text,
  source text,
  ok boolean not null default false,
  mode text not null default 'permissive',
  reason text,
  payload jsonb
);

create index if not exists syncview_auth_events_surface_idx
  on public.syncview_auth_events (surface, event_at desc);
create index if not exists syncview_auth_events_client_idx
  on public.syncview_auth_events (client_slug, event_at desc);

alter table public.syncview_auth_events enable row level security;
revoke all on public.syncview_auth_events from anon;
revoke all on public.syncview_auth_events from authenticated;
grant select, insert, update, delete on table public.syncview_auth_events to service_role;
grant usage, select on sequence public.syncview_auth_events_id_seq to service_role;

create table if not exists public.flag_flips (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  actor text,
  ts timestamptz not null default now()
);

create index if not exists flag_flips_key_ts_idx
  on public.flag_flips (key, ts desc);

alter table public.flag_flips enable row level security;

drop policy if exists "anon read flag_flips" on public.flag_flips;
create policy "anon read flag_flips"
  on public.flag_flips
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.flag_flips to anon;
grant select on table public.flag_flips to authenticated;
grant select, insert, update, delete on table public.flag_flips to service_role;
grant usage, select on sequence public.flag_flips_id_seq to service_role;

create or replace function public.syncview_runtime_flags_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists syncview_runtime_flags_touch_updated_at
  on public.syncview_runtime_flags;
create trigger syncview_runtime_flags_touch_updated_at
  before update on public.syncview_runtime_flags
  for each row
  execute function public.syncview_runtime_flags_touch_updated_at();

create or replace function public.syncview_runtime_flags_log_flip()
returns trigger
language plpgsql
as $$
begin
  if old.value is distinct from new.value then
    insert into public.flag_flips (key, old_value, new_value, actor)
    values (new.key, old.value, new.value, new.updated_by);
  end if;
  return new;
end;
$$;

drop trigger if exists syncview_runtime_flags_log_flip
  on public.syncview_runtime_flags;
create trigger syncview_runtime_flags_log_flip
  after update on public.syncview_runtime_flags
  for each row
  execute function public.syncview_runtime_flags_log_flip();

insert into public.syncview_runtime_flags (key, value, updated_by)
values
  ('auth_enforcement', '{"mode":"permissive"}'::jsonb, 'b0-migration'),
  ('prod_authority', '{"video":"linear","graphics":"linear"}'::jsonb, 'b0-migration'),
  ('linear_inbound_enabled', '{"enabled":false}'::jsonb, 'b0-migration')
on conflict (key) do nothing;

alter table public.clients replica identity full;
alter table public.team_members replica identity full;
alter table public.flag_flips replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clients'
  ) then
    alter publication supabase_realtime add table public.clients;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'flag_flips'
  ) then
    alter publication supabase_realtime add table public.flag_flips;
  end if;
end $$;
