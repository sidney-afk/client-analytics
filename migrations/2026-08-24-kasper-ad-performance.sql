-- Kasper Ad Performance dashboard — daily rollup table.
--
-- One row per UTC day of the Meta prospecting campaign ("Prospecting | Leads |
-- US | Aug 2026", campaign id 120243068755680573, ad account 24069488506082034)
-- for Kasper's personal-brand coaching offer. Only raw counts are stored —
-- CPC, conversion rate, and cost-per-booking are computed at read time by the
-- kasper-ad-performance-read Edge Function, never persisted, so an upsert can
-- never leave a stale derived ratio next to updated raw counts.
--
-- Written by an n8n workflow (cron, 2x/day) that pulls Meta Ads Insights
-- (spend/impressions/clicks/landing_page_view) and iClosed bookings (matched
-- by utm_campaign=prospecting, same attribution as iclosed_bookings.py in the
-- Kasper Ads working folder) and re-pulls the trailing ~8 days each run so
-- late-attributed conversions land instead of being missed by a same-day-only
-- pull. Read only by the staff-authenticated kasper-ad-performance-read Edge
-- Function; there are no anon/authenticated policies or grants, and no runtime
-- flag or Linear-mirrored table is changed by this migration.

begin;

create table if not exists public.kasper_ad_performance_daily (
  date date primary key,
  spend numeric(12,2) not null default 0
    check (spend >= 0),
  impressions bigint not null default 0
    check (impressions >= 0),
  clicks bigint not null default 0
    check (clicks >= 0),
  landing_page_views bigint not null default 0
    check (landing_page_views >= 0),
  bookings_all integer not null default 0
    check (bookings_all >= 0),
  bookings_held integer not null default 0
    check (bookings_held >= 0 and bookings_held <= bookings_all),
  updated_by text not null
    check (btrim(updated_by) <> ''),
  updated_at timestamptz not null default now()
);

comment on table public.kasper_ad_performance_daily is
  'Daily Meta spend + iClosed booking counts for Kasper''s ad performance dashboard. Raw counts only; ratios are computed at read time.';
comment on column public.kasper_ad_performance_daily.bookings_all is
  'All iClosed bookings attributed to utm_campaign=prospecting for the day, including later-cancelled ones.';
comment on column public.kasper_ad_performance_daily.bookings_held is
  'Subset of bookings_all that were not cancelled as of the last pull.';
comment on column public.kasper_ad_performance_daily.updated_by is
  'Server-derived caller identity (the n8n workflow); caller-supplied actor metadata is never authoritative.';

create index if not exists kasper_ad_performance_daily_updated_at_idx
  on public.kasper_ad_performance_daily (updated_at);

alter table public.kasper_ad_performance_daily enable row level security;

revoke all on table public.kasper_ad_performance_daily from public, anon, authenticated;
grant select, insert, update on table public.kasper_ad_performance_daily to service_role;
revoke delete, truncate, references, trigger on table public.kasper_ad_performance_daily from service_role;

commit;
