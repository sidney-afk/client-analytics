-- ============================================================================
-- SyncView — First-party TikTok pilot ("Connect + Direct Post") schema
-- Project: Supabase uzltbbrjidmjwwfakwve.
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL editor and Run.
-- Idempotent (CREATE IF NOT EXISTS / CREATE OR REPLACE) — safe to re-run.
--
-- SECURITY POSTURE — READ THIS:
--   These three tables hold OAuth tokens and CSRF state. Unlike calendar_posts
--   / content_samples (which deliberately allow anon SELECT for the browser),
--   these tables must NEVER be reachable by the browser's publishable/anon key.
--   So: RLS is ENABLED, NO anon policy is created, and privileges are REVOKED
--   from anon + authenticated. With RLS on and no policy, those roles see zero
--   rows even if a grant slips back in; the explicit REVOKE is belt-and-suspenders.
--   Only n8n (service_role, which BYPASSES RLS) reads/writes these tables.
--   The SPA must reach this data ONLY through the token-free ttp-* webhooks.
--   These tables are intentionally NOT added to the supabase_realtime publication.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) tiktok_accounts — per-client connected TikTok accounts + OAuth tokens.
--    Keyed by open_id (TikTok's opaque, stable per-app user id). One client
--    may (re)connect; resolution picks the latest non-revoked row per client.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_accounts (
  id                        uuid primary key default gen_random_uuid(),
  client_name               text not null,
  open_id                   text not null unique,
  union_id                  text,
  display_name              text,
  avatar_url                text,
  scope                     text,
  access_token              text,
  access_token_expires_at   timestamptz,
  refresh_token             text,
  refresh_token_expires_at  timestamptz,
  creator_info_cache        jsonb,
  creator_info_fetched_at   timestamptz,
  connected_at              timestamptz default now(),
  updated_at                timestamptz default now(),
  revoked_at                timestamptz
);
create index if not exists tiktok_accounts_client_idx on public.tiktok_accounts (client_name);

alter table public.tiktok_accounts enable row level security;
revoke all on public.tiktok_accounts from anon, authenticated;
-- (No policy is created on purpose — anon/authenticated get zero rows.)

-- ---------------------------------------------------------------------------
-- 2) tiktok_oauth_state — single-use CSRF state for the OAuth round-trip.
--    Inserted by ttp-auth-init, consumed (and validated for expiry) by
--    ttp-auth-callback. Rows are short-lived (10 min TTL).
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_oauth_state (
  state        text primary key,
  client_name  text not null,
  created_at   timestamptz default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

alter table public.tiktok_oauth_state enable row level security;
revoke all on public.tiktok_oauth_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) tiktok_pilot_posts — the pilot's upload/queue rows (kept entirely
--    separate from the production Post-For-Me "TikTokUploads" Google Sheet).
--    id = the front-end idempotencyKey (dedupe + optimistic-row reconcile).
--    status mirrors TikTok's publish lifecycle; only PUBLISH_COMPLETE = posted.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_pilot_posts (
  id                        text primary key,           -- front-end idempotencyKey
  client_name               text,
  open_id                   text,
  caption                   text,
  privacy_level             text,
  disable_comment           boolean default false,
  disable_duet              boolean default false,
  disable_stitch            boolean default false,
  is_commercial             boolean default false,      -- commercial-disclosure toggle on
  disclose_your_brand       boolean default false,
  disclose_branded_content  boolean default false,
  video_cover_timestamp_ms  integer,
  publish_id                text,                        -- TikTok publish_id from video/init
  status                    text,                        -- uploading|processing|processing_upload|
                                                         -- processing_download|send_to_user_inbox|
                                                         -- publish_complete|failed|scheduled|cancelled
  tiktok_post_id            text,                        -- publicly_available_post_id
  tiktok_url                text,
  fail_reason               text,
  scheduled_for             timestamptz,                 -- Phase 2.5 (scheduling); null = immediate
  media_path                text,                        -- Phase 2.5 (Supabase Storage key)
  timezone                  text,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);
create index if not exists tiktok_pilot_posts_status_idx  on public.tiktok_pilot_posts (status);
create index if not exists tiktok_pilot_posts_created_idx on public.tiktok_pilot_posts (created_at desc);
create index if not exists tiktok_pilot_posts_publish_idx on public.tiktok_pilot_posts (publish_id);

alter table public.tiktok_pilot_posts enable row level security;
revoke all on public.tiktok_pilot_posts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sanity check after applying (run as the anon role / with the publishable key
-- from the browser — all three should return ZERO rows / permission denied):
--   select count(*) from public.tiktok_accounts;     -- must be 0 for anon
--   select count(*) from public.tiktok_oauth_state;  -- must be 0 for anon
--   select count(*) from public.tiktok_pilot_posts;  -- must be 0 for anon
-- n8n (service_role) bypasses RLS and reads/writes normally.
-- ---------------------------------------------------------------------------
