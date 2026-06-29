-- ============================================================
-- AI Funnel Onboarding Form → Supabase migration SQL
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent.
--
-- This is the AI-funnel sibling of client_onboarding (see
-- onboarding-supabase-migration.sql). The AI funnel (/ai_onboarding_form) has its
-- OWN table so the two intake streams stay cleanly separated for review/routing.
-- Schema mirrors client_onboarding, plus a `funnel` column (always 'ai' here).
--
-- SECURITY (same posture as client_onboarding):
-- This table holds SENSITIVE data (account usernames/passwords, backup codes,
-- personal contact info). It therefore has *** NO anon SELECT policy ***. The
-- public browser anon key (CAL_SUPABASE_ANON_KEY, committed in index.html) can
-- NEITHER read NOR write this table.
--   - Writes: only the service-role n8n webhook `ai-onboarding-submit`.
--   - Reads:  only service-role (n8n) — e.g. a Slack auto-post workflow, or a
--             future in-app review screen once real auth exists.
-- Do not add `grant select ... to anon` or an anon policy here.
-- ============================================================

create table if not exists public.ai_client_onboarding (
  id              text not null,          -- submission id, o_<ts36>_<rand> (client-minted)
  slug            text,                   -- wlNormalizeClient(first+last), best-effort match key
  first_name      text,
  last_name       text,
  email           text,
  phone           text,
  ai_avatar       text,                   -- always 'yes' for this funnel (AI avatar is the product)
  funnel          text default 'ai',      -- 'ai' (distinguishes from the standard funnel)
  answers         jsonb,                  -- full structured form payload (all sections)
  status          text default 'submitted', -- submitted | reviewed | archived
  source          text default 'syncview-ai-onboarding',
  created_at      text,
  updated_at      text,
  primary key (id)
);

-- RLS on, with NO anon policy on purpose. service_role bypasses RLS, so the
-- n8n webhook (service-role credential) keeps working; the public anon key is
-- locked out entirely.
alter table public.ai_client_onboarding enable row level security;
revoke all on public.ai_client_onboarding from anon;
revoke all on public.ai_client_onboarding from authenticated;

-- (No realtime publication — nothing in the public app subscribes to onboarding.)
