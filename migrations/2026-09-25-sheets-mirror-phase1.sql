-- ============================================================
-- Sheets to Supabase, Phase 1 (docs/plans/2026-09-24-sheets-to-supabase.md).
--
-- SOURCE-ONLY. Not applied. The owner's reviewer applies it by hand in the
-- SQL editor; EXECUTION_LOG.md records the apply. Nothing reads or writes
-- these tables until the flags seeded below are turned on.
--
-- What it adds (all additive, nothing existing is altered):
--   client_profiles                   Clients Info, one row per client.
--   analytics_metrics                 Metrics tab.
--   analytics_top_videos              TopVideos tab.
--   analytics_market_research_briefs  Market Research Briefs tab.
--   analytics_content_summaries       ContentSummaries tab.
--   analytics_ingest_receipts         one receipt per write batch, so a read
--                                     can tell "no rows" from "not copied yet".
--   three default-off runtime flags.
--
-- ROW IDENTITY. The Sheets hold both exact duplicate rows and several rows
-- for the same client and day with different values (measured 2026-09-25:
-- Metrics 14 exact / 111 differing; TopVideos 3,994 exact / 490 differing),
-- so no natural key is unique. Each mirrored row is keyed by row_hash (sha256
-- of its values, computed by the write function) plus row_occurrence (1 for
-- the first copy of those values in a batch, 2 for the second, ...). Writes
-- are upserts on that key, so a retried batch, or a backfill run after n8n
-- started writing, never double-counts. seq keeps arrival order.
-- For n8n, occurrence continues ACROSS calls: the writer counts identical
-- rows already stored by other (run_id, run_part) calls, so a real repeat in
-- a later run is kept while a retry of the same call is not doubled.
--
-- CLIENT PROFILES AND A FUTURE ADMIN TAB. Today the Sheet is the source and
-- the copy is one-way (Sheet -> Supabase, daily). Nothing here assumes that
-- stays true:
--   * client_profiles.source is 'sheet' or 'syncview'. The daily copy never
--     overwrites a row whose source is 'syncview' (edited in SyncView).
--   * the runtime flag client_profiles_authority ({"source":"sheet"}) is
--     the one switch: when it reads "syncview" the write function refuses
--     every Sheet copy of client_profiles, and SyncView becomes the main copy.
--   * a client missing from the Sheet is archived (archived_at), never
--     deleted, so switching the source cannot lose a row.
--   * every Clients Info column is a real column; unknown extra columns land
--     in extra (jsonb) instead of being dropped.
--
-- ACCESS. RLS is on for every table with NO policies. Every privilege is
-- revoked from all four roles (public, anon, authenticated, service_role);
-- then service_role alone gets SELECT, INSERT, UPDATE (no DELETE, no
-- TRUNCATE). The browser never reads these tables: the analytics-read Edge
-- Function reads them with service_role after checking a staff role key or a
-- client link token, and returns one client's rows. No sequence privilege is
-- granted: identity columns do not need one (test/sheets-mirror-roles-
-- postgres.js measures all four roles).
--
-- Idempotent: safe to run twice.
-- ============================================================
begin;

create extension if not exists pgcrypto;

-- ---------- Clients Info ----------
create table if not exists public.client_profiles (
  slug                  text primary key check (slug ~ '^[a-z0-9&]+$'),
  display_name          text not null check (length(display_name) between 1 and 200),
  email                 text,
  competitors           text,
  keywords              text,
  specific_keywords     text,
  content_description   text,
  instagram_handle      text,
  tiktok_handle         text,
  youtube_channel_id    text,
  slack_channel_id      text,
  creative_channel_id   text,
  roam_channel_id       text,
  upload_post_profile   text,
  postforme_account_id  text,
  extra                 jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  source                text not null default 'sheet' check (source in ('sheet', 'syncview')),
  row_hash              text,
  sheet_synced_at       timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            text not null default 'sheet-copy'
);

-- ---------- Metrics ----------
create table if not exists public.analytics_metrics (
  row_hash                   text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  row_occurrence             integer not null check (row_occurrence >= 1),
  seq                        bigint generated always as identity,
  client_slug                text not null check (client_slug ~ '^[a-z0-9&]+$'),
  client_name                text not null,
  date                       date not null,
  ig_followers               text,
  ig_avg_views               text,
  ig_avg_likes               text,
  tiktok_followers           text,
  tiktok_avg_plays           text,
  yt_subscribers             text,
  yt_total_views             text,
  ig_views_gained_today      text,
  tiktok_plays_gained_today  text,
  ig_views_this_month        text,
  tiktok_plays_this_month    text,
  yt_views_gained_today      text,
  yt_shorts_views            text,
  yt_longs_views             text,
  analytics_receipt          text,
  extra                      jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  source                     text not null check (source in ('sheet-backfill', 'n8n')),
  run_id                     text not null,
  run_part                   integer not null default 0 check (run_part >= 0),
  ingested_at                timestamptz not null default now(),
  primary key (row_hash, row_occurrence)
);
create index if not exists analytics_metrics_client_date_idx
  on public.analytics_metrics (client_slug, date, seq);

-- ---------- TopVideos ----------
create table if not exists public.analytics_top_videos (
  row_hash        text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  row_occurrence  integer not null check (row_occurrence >= 1),
  seq             bigint generated always as identity,
  client_slug     text not null check (client_slug ~ '^[a-z0-9&]+$'),
  client_name     text not null,
  scraped_date    date not null,
  platform        text,
  period          text,
  rank            text,
  caption         text,
  video_url       text,
  views           text,
  likes           text,
  comments        text,
  shares          text,
  extra           jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  source          text not null check (source in ('sheet-backfill', 'n8n')),
  run_id          text not null,
  run_part        integer not null default 0 check (run_part >= 0),
  ingested_at     timestamptz not null default now(),
  primary key (row_hash, row_occurrence)
);
-- The site reads one client's last 90 days (owner, 2026-09-25); older rows
-- stay stored but are never sent.
create index if not exists analytics_top_videos_client_recent_idx
  on public.analytics_top_videos (client_slug, scraped_date desc, seq);

-- ---------- Market Research Briefs (append-or-update by id) ----------
create table if not exists public.analytics_market_research_briefs (
  id           text primary key check (length(id) between 1 and 200),
  client_slug  text not null check (client_slug ~ '^[a-z0-9&]+$'),
  client_name  text not null,
  date         text,
  raw_json     text,
  raw_json_2   text,
  raw_json_3   text,
  extra        jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  row_hash     text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  source       text not null check (source in ('sheet-backfill', 'n8n')),
  run_id       text not null,
  ingested_at  timestamptz not null default now()
);
create index if not exists analytics_market_research_briefs_client_idx
  on public.analytics_market_research_briefs (client_slug);

-- ---------- ContentSummaries ----------
create table if not exists public.analytics_content_summaries (
  row_hash        text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  row_occurrence  integer not null check (row_occurrence >= 1),
  seq             bigint generated always as identity,
  client_slug     text not null check (client_slug ~ '^[a-z0-9&]+$'),
  client_name     text not null,
  date            text,
  bullets         text,
  extra           jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  source          text not null check (source in ('sheet-backfill', 'n8n')),
  run_id          text not null,
  run_part        integer not null default 0 check (run_part >= 0),
  ingested_at     timestamptz not null default now(),
  primary key (row_hash, row_occurrence)
);
create index if not exists analytics_content_summaries_client_idx
  on public.analytics_content_summaries (client_slug, seq);

-- ---------- Receipts ----------
create table if not exists public.analytics_ingest_receipts (
  id            uuid primary key default gen_random_uuid(),
  dataset       text not null check (dataset in
                  ('client_profiles', 'metrics', 'top_videos', 'market_research_briefs', 'content_summaries')),
  source        text not null check (source in ('sheet-backfill', 'sheet-copy', 'n8n')),
  run_id        text not null check (length(run_id) between 1 and 200),
  rows_received integer not null check (rows_received >= 0),
  rows_written  integer not null check (rows_written >= 0),
  client_slugs  text[] not null default '{}',
  run_part      integer not null default 0 check (run_part >= 0),
  complete      boolean not null,
  -- true only on the call that ends a whole-dataset copy (the backfill, the
  -- daily Clients Info copy): it covers every client, not just client_slugs.
  full_snapshot boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists analytics_ingest_receipts_dataset_idx
  on public.analytics_ingest_receipts (dataset, created_at desc);

-- ---------- Access: RLS on, everything revoked, then the minimum ----------
do $grants$
declare t text;
begin
  foreach t in array array[
    'client_profiles', 'analytics_metrics', 'analytics_top_videos',
    'analytics_market_research_briefs', 'analytics_content_summaries',
    'analytics_ingest_receipts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end
$grants$;

-- Identity sequences: revoke from all four roles too (Supabase default
-- privileges grant them on creation). Inserts through the identity column
-- need no sequence privilege; the role test proves it.
do $seqs$
declare s text;
begin
  for s in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_depend d on d.objid = c.oid and d.deptype = 'i'
    where c.relkind = 'S' and n.nspname = 'public'
      and d.refobjid in (
        'public.analytics_metrics'::regclass,
        'public.analytics_top_videos'::regclass,
        'public.analytics_content_summaries'::regclass)
  loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
  end loop;
end
$seqs$;

-- ---------- Default-off switches ----------
insert into public.syncview_runtime_flags (key, value, updated_by) values
  ('analytics_mirror_read_enabled',  '{"enabled": false}'::jsonb, 'migration:2026-09-25-sheets-mirror-phase1'),
  ('analytics_mirror_write_enabled', '{"enabled": false}'::jsonb, 'migration:2026-09-25-sheets-mirror-phase1'),
  ('client_profiles_authority',      '{"source": "sheet"}'::jsonb, 'migration:2026-09-25-sheets-mirror-phase1')
on conflict (key) do nothing;

commit;

-- VERIFY (expect every *_any = false for public/anon/authenticated,
-- service_role select/insert/update = true and delete/truncate = false,
-- rls = true, policies = 0):
-- select c.relname, c.relrowsecurity rls,
--   (select count(*) from pg_policy p where p.polrelid = c.oid) policies,
--   has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_any,
--   has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated_any,
--   has_table_privilege('service_role', c.oid, 'SELECT') sr_select,
--   has_table_privilege('service_role', c.oid, 'DELETE') sr_delete,
--   has_table_privilege('service_role', c.oid, 'TRUNCATE') sr_truncate
-- from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
--   ('client_profiles','analytics_metrics','analytics_top_videos',
--    'analytics_market_research_briefs','analytics_content_summaries','analytics_ingest_receipts');

-- ROLLBACK (nothing else depends on these objects; drops the mirror only):
-- begin;
-- drop table if exists public.analytics_ingest_receipts, public.analytics_content_summaries,
--   public.analytics_market_research_briefs, public.analytics_top_videos,
--   public.analytics_metrics, public.client_profiles;
-- delete from public.syncview_runtime_flags where key in
--   ('analytics_mirror_read_enabled', 'analytics_mirror_write_enabled', 'client_profiles_authority');
-- commit;
