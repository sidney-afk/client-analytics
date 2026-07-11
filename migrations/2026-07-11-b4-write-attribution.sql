-- B4 readiness: durable actor/role attribution for settings writers.
-- Additive-only. Existing settings rows and write routing are unchanged.

create table if not exists public.settings_events (
  id bigint generated always as identity primary key,
  event_at timestamptz not null default now(),
  surface text not null,
  client_slug text not null,
  actor text,
  role text,
  action text not null default 'save',
  source text not null default 'settings',
  payload jsonb
);

create index if not exists settings_events_client_idx
  on public.settings_events (client_slug, event_at desc);

create index if not exists settings_events_surface_idx
  on public.settings_events (surface, event_at desc);

alter table public.settings_events enable row level security;
revoke all on public.settings_events from anon;
revoke all on public.settings_events from authenticated;
grant select, insert, update, delete on table public.settings_events to service_role;
grant usage, select on sequence public.settings_events_id_seq to service_role;
