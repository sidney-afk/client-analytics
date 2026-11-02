-- ef-auto-deploy-applied-when: select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'crm_people' and column_name in ('source_ad', 'call_showed', 'call_outcome', 'cash_collected')
--
-- Leads CRM: track each booked call (source ad, showed, outcome, cash).
--
-- The crm-leads Edge Function and the shared core in this merge READ these four
-- columns (PERSON_COLUMNS), so the function does NOT cope without this
-- migration: a read of crm_people would fail until the columns exist. That is
-- why this file carries no "functions-cope-without-this" line. The deploy lane
-- holds crm-leads until the probe on line 1 answers true (it counts the four
-- columns, read-only), or until Lighthouse applies this and runs the merge lane
-- by hand with migrations_applied (docs/ops/EF_AUTO_DEPLOY.md). To tell it is
-- applied by hand: the line-1 query returns true.
--
-- Sidney's mark on a lead is NOT a new column: it stays in the existing tags
-- (good-lead, ad-static, ad-video).
--
--   source_ad       free text, which ad or campaign the booking came from
--   call_showed     true / false, null = not known yet
--   call_outcome    won / lost / follow_up / pending, null = not set
--   cash_collected  dollars collected, null = none recorded
--
-- crm_apply_change is re-created with the four fields added to its whitelist
-- (the body is otherwise the definition in 20261026120000_crm_leads.sql). The
-- timeline gets one new row kind, call_tracking_set, so the change is logged
-- like the other fields; the existing call_outcome kind is left alone because
-- the Report counts it as a showed / no-show signal.
--
-- Grants follow the existing pattern: revoke from public, anon, authenticated
-- and service_role, then grant execute to service_role only. Table grants on
-- crm_people already cover new columns.
--
-- Rollback:
--   alter table public.crm_people drop column source_ad, drop column call_showed,
--     drop column call_outcome, drop column cash_collected;
--   (then re-run the crm_apply_change definition from 20261026120000_crm_leads.sql
--    and put back the old crm_events_kind_check once no row uses call_tracking_set)
begin;

alter table public.crm_people add column if not exists source_ad text
  check (source_ad is null or length(source_ad) <= 200);
alter table public.crm_people add column if not exists call_showed boolean;
alter table public.crm_people add column if not exists call_outcome text
  check (call_outcome is null or call_outcome in ('won', 'lost', 'follow_up', 'pending'));
alter table public.crm_people add column if not exists cash_collected numeric(12, 2)
  check (cash_collected is null or cash_collected >= 0);

alter table public.crm_events drop constraint if exists crm_events_kind_check;
alter table public.crm_events add constraint crm_events_kind_check check (kind in ('created', 'imported', 'stage_changed', 'owner_changed', 'next_step_set', 'note', 'lost_reason_set', 'tags_changed', 'message_sent', 'reply', 'call',
  'booked', 'opted_out', 'call_at_set', 'timezone_set', 'call_outcome', 'enrolled', 'enrolment_paused', 'enrolment_resumed', 'step_skipped', 'enrolment_stopped', 'enrolment_completed', 'send_failed', 'send_skipped',
  'merged', 'call_tracking_set'));

create or replace function public.crm_apply_change(p_id uuid, p_expected_version integer, p_patch jsonb, p_actor text, p_events jsonb)
returns setof public.crm_people
language plpgsql security invoker set search_path = public as $$
declare
  r public.crm_people;
  e jsonb;
begin
  update public.crm_people set
    stage = case when p_patch ? 'stage' then p_patch->>'stage' else stage end,
    owner = case when p_patch ? 'owner' then nullif(p_patch->>'owner', '') else owner end,
    next_step = case when p_patch ? 'next_step' then nullif(p_patch->>'next_step', '') else next_step end,
    next_step_due = case when p_patch ? 'next_step_due' then nullif(p_patch->>'next_step_due', '')::date else next_step_due end,
    lost_reason = case when p_patch ? 'lost_reason' then nullif(p_patch->>'lost_reason', '') else lost_reason end,
    tags = case when p_patch ? 'tags' then array(select jsonb_array_elements_text(p_patch->'tags')) else tags end,
    call_at = case when p_patch ? 'call_at' then nullif(p_patch->>'call_at', '')::timestamptz else call_at end,
    timezone = case when p_patch ? 'timezone' then nullif(p_patch->>'timezone', '') else timezone end,
    opted_out_at = case when p_patch ? 'opted_out' then (case when (p_patch->>'opted_out')::boolean then coalesce(opted_out_at, now()) end) else opted_out_at end,
    source_ad = case when p_patch ? 'source_ad' then nullif(p_patch->>'source_ad', '') else source_ad end,
    call_showed = case when p_patch ? 'call_showed' then (p_patch->>'call_showed')::boolean else call_showed end,
    call_outcome = case when p_patch ? 'call_outcome' then nullif(p_patch->>'call_outcome', '') else call_outcome end,
    cash_collected = case when p_patch ? 'cash_collected' then nullif(p_patch->>'cash_collected', '')::numeric else cash_collected end,
    state_version = state_version + 1,
    updated_at = now()
  where id = p_id and state_version = p_expected_version
  returning * into r;
  if not found then return; end if;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    insert into public.crm_events (person_id, kind, channel, actor, sequence_id, detail)
    values (p_id, e->>'kind', nullif(e->>'channel', ''), coalesce(p_actor, ''), nullif(e->>'sequence_id', '')::uuid, coalesce(e->'detail', '{}'::jsonb));
  end loop;
  return next r;
end
$$;

revoke all on function public.crm_apply_change(uuid, integer, jsonb, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.crm_apply_change(uuid, integer, jsonb, text, jsonb) to service_role;

commit;
