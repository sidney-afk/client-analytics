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

-- Budget reservation and retry dedupe, in one serialized step.
-- A lost response followed by a retry sends the same request again; the
-- idempotency key (a hash of who + model + inputs) returns the job already
-- started in the last 10 minutes instead of paying for a second video. The
-- advisory lock makes the cap check and the insert atomic across teammates.
alter table public.hf_generations add column if not exists idem_key text;
create index if not exists hf_generations_idem_key_idx on public.hf_generations (idem_key, created_at desc);

create or replace function public.hf_reserve_generation(
  p_member text, p_model text, p_prompt text, p_params jsonb,
  p_cost numeric, p_cap numeric, p_idem_key text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_existing public.hf_generations%rowtype;
  v_spent numeric;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('hf_generations_budget'));

  select * into v_existing from public.hf_generations
   where idem_key = p_idem_key
     and created_at > now() - interval '10 minutes'
     and status not in ('failed', 'nsfw', 'canceled', 'submit_failed')
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('outcome', 'duplicate', 'id', v_existing.id, 'request_id', v_existing.request_id);
  end if;

  select coalesce(sum(est_cost_usd), 0) into v_spent from public.hf_generations
   where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
     and status not in ('failed', 'nsfw', 'canceled', 'submit_failed');
  if v_spent + p_cost > p_cap then
    return jsonb_build_object('outcome', 'over_cap', 'spent', v_spent);
  end if;

  insert into public.hf_generations (member_name, model, prompt, params, est_cost_usd, idem_key)
  values (p_member, p_model, p_prompt, p_params, p_cost, p_idem_key)
  returning id into v_id;
  return jsonb_build_object('outcome', 'reserved', 'id', v_id, 'spent', v_spent);
end;
$$;

revoke all on function public.hf_reserve_generation(text, text, text, jsonb, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.hf_reserve_generation(text, text, text, jsonb, numeric, numeric, text) to service_role;
