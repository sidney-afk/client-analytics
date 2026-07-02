-- Fallback capture table for the onboarding forms (see ONBOARDING_FALLBACK.md).
-- Written ONLY by the onboarding-capture Edge Function (service role, bypasses
-- RLS). Holds autosaved drafts, fallback-captured submissions and `submitted`
-- markers, one row per client submission id.
--
-- SENSITIVE: draft/submission payloads can include the same account credentials
-- as client_onboarding, so the table gets the identical locked-down posture —
-- RLS on, zero policies, explicit revokes; the committed anon key can neither
-- read nor write.
--
-- Idempotent. Run once in the Supabase SQL editor (project uzltbbrjidmjwwfakwve).

create table if not exists public.onboarding_fallback (
  id text primary key,          -- client-minted submission id (o_<ts36>_<rand>)
  kind text,                    -- draft | submit-fallback | submitted
  funnel text,                  -- standard | ai
  client_name text,
  email text,
  payload jsonb,                -- full submission/draft; null for bare markers
  note text,                    -- why it landed here (e.g. "primary submit failed: HTTP 500")
  created_at text,
  updated_at text
);

alter table public.onboarding_fallback enable row level security;
revoke all on public.onboarding_fallback from anon;
revoke all on public.onboarding_fallback from authenticated;
