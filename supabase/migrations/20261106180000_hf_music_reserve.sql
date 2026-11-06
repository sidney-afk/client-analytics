-- ef-auto-deploy-applied-when: select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'hf_music_reserve')
--
-- Hard limits for studio_action make_music (supabase/functions/higgsfield-mcp/music.mjs), enforced in ONE
-- serialized database step so two requests at the same moment cannot both pass a limit (Sidney, 2026-11-06:
-- nobody may use up a batch of ElevenLabs credits). It takes the same advisory lock as hf_reserve_generation
-- ('hf_generations_budget'), counts the music rows (model elevenlabs/music, not failed / nsfw / canceled /
-- submit_failed) for the person today, for the team today and the music dollars this month (UTC), refuses
-- past any limit, and only then calls hf_reserve_generation, which still applies the team's monthly cap and
-- the duplicate check. The Edge Function refuses to make music when this function is missing.
--
-- Grants: Supabase gives service_role, anon and authenticated full rights on every new function, so all four
-- are named: public, anon and authenticated lose EXECUTE; service_role (the Edge Function) keeps it.
--
-- Rollback: drop function public.hf_music_reserve(text, text, jsonb, numeric, numeric, text, int, int, numeric);
begin;

create or replace function public.hf_music_reserve(
  p_member text, p_prompt text, p_params jsonb, p_cost numeric, p_cap numeric, p_idem_key text,
  p_person_day int, p_team_day int, p_month_usd numeric
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_person int;
  v_team int;
  v_month numeric;
begin
  perform pg_advisory_xact_lock(hashtext('hf_generations_budget'));

  select count(*) filter (where member_name = p_member), count(*)
    into v_person, v_team
    from public.hf_generations
   where model = 'elevenlabs/music' and created_at >= v_day_start
     and status not in ('failed', 'nsfw', 'canceled', 'submit_failed');
  select coalesce(sum(est_cost_usd), 0) into v_month
    from public.hf_generations
   where model = 'elevenlabs/music' and created_at >= v_month_start
     and status not in ('failed', 'nsfw', 'canceled', 'submit_failed');

  if v_person >= p_person_day then return jsonb_build_object('outcome', 'person_limit', 'used', v_person); end if;
  if v_team >= p_team_day then return jsonb_build_object('outcome', 'team_limit', 'used', v_team); end if;
  if v_month + p_cost > p_month_usd then return jsonb_build_object('outcome', 'month_budget', 'used', v_month); end if;

  return public.hf_reserve_generation(p_member, 'elevenlabs/music', p_prompt, p_params, p_cost, p_cap, p_idem_key);
end;
$$;

revoke all on function public.hf_music_reserve(text, text, jsonb, numeric, numeric, text, int, int, numeric) from public, anon, authenticated;
grant execute on function public.hf_music_reserve(text, text, jsonb, numeric, numeric, text, int, int, numeric) to service_role;

commit;
