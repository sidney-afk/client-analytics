-- Kasper Ad Performance dashboard v2 — per-ad breakdown + per-lead funnel status.
--
-- Two new tables, same locked-down posture as kasper_ad_performance_daily
-- (migrations/2026-08-24-kasper-ad-performance.sql): RLS enabled, zero
-- anon/authenticated policy or grant, service-role SELECT/INSERT/UPDATE only,
-- DELETE/TRUNCATE/REFERENCES/TRIGGER revoked even from service role.
--
-- kasper_ad_leads carries real PII (lead name + email) synced from iClosed +
-- HubSpot. It must never be exposed through browser PostgREST, and the
-- reading Edge Function must never log a row's name/email — aggregate-only
-- logging, matching every other staff-sensitive function in this repo.

begin;

create table if not exists public.kasper_ad_performance_by_ad_daily (
  date date not null,
  ad_name text not null
    check (btrim(ad_name) <> ''),
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
  updated_at timestamptz not null default now(),
  primary key (date, ad_name)
);

comment on table public.kasper_ad_performance_by_ad_daily is
  'Per-ad daily Meta spend + iClosed booking counts, same fields as kasper_ad_performance_daily but broken out by ad_name (Meta ad_name, joined to iClosed bookings via utm_content).';

create index if not exists kasper_ad_performance_by_ad_daily_ad_name_idx
  on public.kasper_ad_performance_by_ad_daily (ad_name);

alter table public.kasper_ad_performance_by_ad_daily enable row level security;

revoke all on table public.kasper_ad_performance_by_ad_daily from public, anon, authenticated;
grant select, insert, update on table public.kasper_ad_performance_by_ad_daily to service_role;
revoke delete, truncate, references, trigger on table public.kasper_ad_performance_by_ad_daily from service_role;

create table if not exists public.kasper_ad_leads (
  iclosed_booking_id text primary key
    check (btrim(iclosed_booking_id) <> ''),
  booked_date date not null,
  call_date date,
  ad_name text,
  lead_name text not null
    check (btrim(lead_name) <> ''),
  lead_email text not null
    check (btrim(lead_email) <> ''),
  cancelled boolean not null default false,
  iclosed_status text,
  hubspot_lifecyclestage text,
  hubspot_contact_id text,
  updated_by text not null
    check (btrim(updated_by) <> ''),
  updated_at timestamptz not null default now()
);

comment on table public.kasper_ad_leads is
  'One row per iClosed booking for the prospecting campaign (real name/email — PII). iclosed_status and hubspot_lifecyclestage are synced from the matching HubSpot contact (joined by email) so the dashboard can show real funnel outcome, not just "booked". Never exposed to anon/authenticated PostgREST; the reading Edge Function must log aggregate counts only, never a row''s name or email.';
comment on column public.kasper_ad_leads.iclosed_status is
  'HubSpot contact property "iclosed_status" (booked / potential / disqualified / etc.) as of the last sync — this is the sales-qualification status, distinct from iClosed''s own call-scheduling eventType.';
comment on column public.kasper_ad_leads.hubspot_lifecyclestage is
  'HubSpot contact property "lifecyclestage" (lead / opportunity / customer / etc.) as of the last sync — "customer" is the actual closed-deal signal.';

create index if not exists kasper_ad_leads_booked_date_idx
  on public.kasper_ad_leads (booked_date);
create index if not exists kasper_ad_leads_ad_name_idx
  on public.kasper_ad_leads (ad_name);

alter table public.kasper_ad_leads enable row level security;

revoke all on table public.kasper_ad_leads from public, anon, authenticated;
grant select, insert, update on table public.kasper_ad_leads to service_role;
revoke delete, truncate, references, trigger on table public.kasper_ad_leads from service_role;

commit;
