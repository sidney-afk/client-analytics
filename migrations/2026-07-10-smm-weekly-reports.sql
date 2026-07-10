-- SMM weekly reports.
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent. The app-facing source of truth is Supabase; n8n syncs the
-- temporary Google Sheet "Social Media Managers" tab into social_media_managers.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.social_media_managers (
  slug text primary key,
  name text not null,
  email text not null default '',
  active boolean not null default true,
  source text not null default 'google_sheet',
  source_row_count integer not null default 0,
  source_clients jsonb not null default '[]'::jsonb,
  synced_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists social_media_managers_name_unique
  on public.social_media_managers (lower(name));

create table if not exists public.smm_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,
  week_end_date date generated always as (week_start_date + 6) stored,

  smm_slug text not null,
  smm_name text not null,

  client_slug text not null,
  client_name text not null,

  overall_status text not null,
  what_got_done text not null,
  content_shipped_count integer not null default 0,
  biggest_win text not null,
  biggest_obstacle text not null,
  obstacle_support_status text not null,
  client_mood text not null,
  client_requests text not null,
  deliverables_schedule_status text not null,
  performance_signal text not null,
  performance_context text not null default '',
  extra_notes text not null,

  raw_payload jsonb not null default '{}'::jsonb,
  submitted_at timestamp with time zone not null default now(),
  submitted_user_agent text not null default '',

  constraint smm_weekly_reports_content_count_nonnegative
    check (content_shipped_count >= 0),
  constraint smm_weekly_reports_overall_status_check
    check (overall_status in ('On track', 'Minor friction', 'Needs your attention', 'Blocked')),
  constraint smm_weekly_reports_obstacle_support_check
    check (obstacle_support_status in ('Handling it', 'Need your input', 'Need you to act')),
  constraint smm_weekly_reports_client_mood_check
    check (client_mood in ('Great', 'Fine', 'Cooling', 'Concerned')),
  constraint smm_weekly_reports_schedule_check
    check (deliverables_schedule_status in ('Ahead', 'On track', 'Slightly behind', 'At risk')),
  constraint smm_weekly_reports_performance_signal_check
    check (performance_signal in ('Numbers up', 'Flat', 'Down', 'Too early to tell')),
  constraint smm_weekly_reports_one_per_week_smm_client
    unique (week_start_date, smm_slug, client_slug)
);

create index if not exists smm_weekly_reports_week_idx
  on public.smm_weekly_reports (week_start_date desc);

create index if not exists smm_weekly_reports_smm_idx
  on public.smm_weekly_reports (smm_slug, week_start_date desc);

create index if not exists smm_weekly_reports_client_idx
  on public.smm_weekly_reports (client_slug, week_start_date desc);

alter table public.social_media_managers enable row level security;
alter table public.smm_weekly_reports enable row level security;

drop policy if exists "anon read social media managers" on public.social_media_managers;
create policy "anon read social media managers"
  on public.social_media_managers
  as permissive
  for select
  to anon, authenticated
  using (true);

drop policy if exists "anon read smm weekly reports" on public.smm_weekly_reports;
create policy "anon read smm weekly reports"
  on public.smm_weekly_reports
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.social_media_managers to anon;
grant select on table public.social_media_managers to authenticated;
grant select, insert, update, delete on table public.social_media_managers to service_role;

grant select on table public.smm_weekly_reports to anon;
grant select on table public.smm_weekly_reports to authenticated;
grant select, insert, update, delete on table public.smm_weekly_reports to service_role;

alter table public.social_media_managers replica identity full;
alter table public.smm_weekly_reports replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'social_media_managers'
  ) then
    alter publication supabase_realtime add table public.social_media_managers;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'smm_weekly_reports'
  ) then
    alter publication supabase_realtime add table public.smm_weekly_reports;
  end if;
end $$;
