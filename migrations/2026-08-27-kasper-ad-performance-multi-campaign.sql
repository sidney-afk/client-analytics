-- Kasper Ad Performance — multi-campaign support.
--
-- The panel was built when exactly one campaign existed, so campaign identity
-- was implicit everywhere: kasper_ad_performance_daily is keyed on (date)
-- alone, and the n8n pull hardcoded that campaign's id in its insights URL.
-- Two campaigns now run side by side ("Prospecting | Booked Calls" on booked
-- calls, "Creative Test | Landing Page Views" on landing page views), so the
-- implicit assumption has to become an explicit column.
--
-- Owner's spec (2026-08-27):
--   * the Ad Performance chart/table can show ALL campaigns or a selected one
--   * existing history is preserved, not restarted
--   * booked leads and unfinished leads are NEVER filtered by that selector,
--     but they do show which campaign each lead came from
--
-- Shape, and why:
--
--   kasper_ad_campaign_daily   NEW. Per-campaign daily series, PK (date,
--                              campaign_id). This is what the campaign
--                              selector reads.
--
--   kasper_ad_performance_daily   UNCHANGED. Its PK (date) cannot hold two
--                              campaigns on one date, and altering a primary
--                              key is not additive. It keeps its exact
--                              historical meaning and becomes the ALL-CAMPAIGNS
--                              rollup — which is continuous, because every row
--                              in it so far already is the whole account.
--
--   kasper_ad_performance_by_ad_daily   Gains campaign_id/campaign_name as
--                              plain columns. Its PK (date, ad_name) stays
--                              valid and unique: the two live campaigns share
--                              zero ad names (Fast Pitch/Danny Training/We Are
--                              The Team/Your Week/Doctors vs Baya Results/
--                              Results Montage/Baya Training), so no key
--                              change is needed.
--
--   kasper_ad_leads, kasper_ad_unfinished_leads   Gain campaign_id/
--                              campaign_name for DISPLAY only. Deliberately
--                              not a filter: a booked call is a booked call
--                              regardless of which campaign the selector is
--                              showing.
--
-- Additive only: no column dropped, renamed, retyped, and no primary key
-- altered (ROLLBACK.md rule 3).

begin;

-- ---------- 1. per-campaign daily series ----------

create table if not exists public.kasper_ad_campaign_daily (
  date date not null,
  campaign_id text not null
    check (btrim(campaign_id) <> ''),
  campaign_name text not null
    check (btrim(campaign_name) <> ''),
  spend numeric(12,2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  bookings_all integer not null default 0,
  bookings_held integer not null default 0,
  updated_by text not null
    check (btrim(updated_by) <> ''),
  updated_at timestamptz not null default now(),
  primary key (date, campaign_id)
);

comment on table public.kasper_ad_campaign_daily is
  'One row per campaign per day. Added 2026-08-27 when a second campaign went live; kasper_ad_performance_daily is keyed on (date) alone and so can only carry the all-campaigns rollup. This table is what the panel''s campaign selector reads.';
comment on column public.kasper_ad_campaign_daily.campaign_id is
  'Meta campaign id. Stored as text, not bigint: Meta ids exceed what some JSON clients handle safely as numbers, and this is an identifier, never an arithmetic operand.';
comment on column public.kasper_ad_campaign_daily.bookings_all is
  'Bookings attributed to this campaign. Zero until per-campaign booking attribution lands (iClosed carries the campaign in tracking.utm_id but it is not captured yet) — read booked-call totals from kasper_ad_leads, not from this column, until then.';

create index if not exists kasper_ad_campaign_daily_campaign_idx
  on public.kasper_ad_campaign_daily (campaign_id, date);

alter table public.kasper_ad_campaign_daily enable row level security;
revoke all on table public.kasper_ad_campaign_daily from public, anon, authenticated;
grant select, insert, update on table public.kasper_ad_campaign_daily to service_role;
revoke delete, truncate, references, trigger on table public.kasper_ad_campaign_daily from service_role;

-- ---------- 2. campaign identity on the per-ad series ----------

alter table public.kasper_ad_performance_by_ad_daily
  add column if not exists campaign_id text,
  add column if not exists campaign_name text;

comment on column public.kasper_ad_performance_by_ad_daily.campaign_id is
  'Meta campaign this ad ran under. Nullable for rows written before 2026-08-27; backfilled below. The PK stays (date, ad_name) because ad names do not collide across the live campaigns.';

create index if not exists kasper_ad_by_ad_campaign_idx
  on public.kasper_ad_performance_by_ad_daily (campaign_id, date);

-- ---------- 3. campaign identity on leads (display only) ----------

alter table public.kasper_ad_leads
  add column if not exists campaign_id text,
  add column if not exists campaign_name text;

comment on column public.kasper_ad_leads.campaign_id is
  'Which campaign produced this booking. For DISPLAY only — the panel never filters booked leads by the campaign selector. Nullable: historical rows predate campaign capture, and iClosed only carries it as tracking.utm_id.';

alter table public.kasper_ad_unfinished_leads
  add column if not exists campaign_id text,
  add column if not exists campaign_name text;

comment on column public.kasper_ad_unfinished_leads.campaign_id is
  'Which campaign produced this abandoned booking. For DISPLAY only — never a filter, same as kasper_ad_leads.';

-- ---------- 4. backfill: everything so far came from one campaign ----------

update public.kasper_ad_performance_by_ad_daily
set campaign_id = '120243068755680573',
    campaign_name = 'Prospecting | Leads | US | Aug 2026'
where campaign_id is null;

update public.kasper_ad_leads
set campaign_id = '120243068755680573',
    campaign_name = 'Prospecting | Leads | US | Aug 2026'
where campaign_id is null;

update public.kasper_ad_unfinished_leads
set campaign_id = '120243068755680573',
    campaign_name = 'Prospecting | Leads | US | Aug 2026'
where campaign_id is null;

insert into public.kasper_ad_campaign_daily
  (date, campaign_id, campaign_name, spend, impressions, clicks,
   landing_page_views, bookings_all, bookings_held, updated_by, updated_at)
select d.date,
       '120243068755680573',
       'Prospecting | Leads | US | Aug 2026',
       d.spend, d.impressions, d.clicks, d.landing_page_views,
       d.bookings_all, d.bookings_held,
       'migration:kasper-ad-performance-multi-campaign-2026-08-27',
       now()
from public.kasper_ad_performance_daily d
on conflict (date, campaign_id) do nothing;

commit;
