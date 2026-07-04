-- SyncView A1: calendar-upsert Edge Function support tables.
--
-- Additive-only. Safe to run before any traffic is pointed at the Edge Function.
-- Raw row access remains unchanged: browser reads are still governed by the
-- existing anon SELECT policies on calendar_posts.

create table if not exists public.calendar_post_events (
  id bigint generated always as identity primary key,
  client text not null,
  post_id text not null,
  ts timestamp with time zone not null default now(),
  actor text,
  role text,
  action text not null,
  component text,
  from_status text,
  to_status text,
  source text not null default 'ui',
  payload jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists calendar_post_events_post_idx
  on public.calendar_post_events using btree (client, post_id, ts desc);

create index if not exists calendar_post_events_action_idx
  on public.calendar_post_events using btree (action);

alter table public.calendar_post_events enable row level security;

drop policy if exists "anon read calendar_post_events" on public.calendar_post_events;
create policy "anon read calendar_post_events"
  on public.calendar_post_events
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.calendar_post_events to anon;
grant select on table public.calendar_post_events to authenticated;
grant select, insert, update, delete on table public.calendar_post_events to service_role;
grant usage, select on sequence public.calendar_post_events_id_seq to service_role;

alter table public.calendar_post_events replica identity full;

create table if not exists public.syncview_runtime_flags (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  updated_by text
);

alter table public.syncview_runtime_flags enable row level security;

drop policy if exists "anon read syncview_runtime_flags" on public.syncview_runtime_flags;
create policy "anon read syncview_runtime_flags"
  on public.syncview_runtime_flags
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.syncview_runtime_flags to anon;
grant select on table public.syncview_runtime_flags to authenticated;
grant select, insert, update, delete on table public.syncview_runtime_flags to service_role;

alter table public.syncview_runtime_flags replica identity full;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('calendar_upsert_ef_clients', '{"clients":[]}'::jsonb, 'migration')
on conflict (key) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calendar_post_events'
  ) then
    alter publication supabase_realtime add table public.calendar_post_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'syncview_runtime_flags'
  ) then
    alter publication supabase_realtime add table public.syncview_runtime_flags;
  end if;
end $$;
