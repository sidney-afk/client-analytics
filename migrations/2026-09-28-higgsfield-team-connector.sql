-- ============================================================
-- Higgsfield team connector: who may use it, and a log of every video.
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
--
-- Backs supabase/functions/higgsfield-mcp, a connector teammates add to their
-- own Claude or ChatGPT. It spends the pay-per-video Higgsfield API balance,
-- so there is no Higgsfield subscription. Each teammate gets a personal link
-- (a random token), which is how the log knows who made what.
--
-- Both tables are server-only: RLS on, no policies, and every browser role
-- revoked by name (Supabase grants all four roles by default). Only the
-- function, running as service_role, reads or writes them.
-- Additive and idempotent: safe to run more than once.
-- ============================================================

create table if not exists public.hf_team_members (
  token      text primary key default replace(gen_random_uuid()::text, '-', ''),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.hf_generations (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  member_name   text not null,
  model         text not null,
  prompt        text not null,
  params        jsonb not null default '{}'::jsonb,
  est_cost_usd  numeric(10, 4) not null,
  request_id    text,
  status        text not null default 'submitted',
  video_url     text,
  error         text,
  updated_at    timestamptz not null default now()
);

create index if not exists hf_generations_created_at_idx on public.hf_generations (created_at desc);
create index if not exists hf_generations_request_id_idx on public.hf_generations (request_id);

alter table public.hf_team_members enable row level security;
alter table public.hf_generations enable row level security;

revoke all on table public.hf_team_members from public, anon, authenticated;
revoke all on table public.hf_generations from public, anon, authenticated;
revoke all on sequence public.hf_generations_id_seq from public, anon, authenticated;

grant select, insert, update on table public.hf_team_members to service_role;
grant select, insert, update on table public.hf_generations to service_role;
grant usage, select on sequence public.hf_generations_id_seq to service_role;
