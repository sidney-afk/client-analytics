-- ef-auto-deploy-applied-when: select to_regprocedure('public.crm_merge_people(uuid,uuid,text)') is not null
-- ef-auto-deploy: functions-cope-without-this
--
-- Leads CRM, round 3 (docs/features/CRM_LEADS.md):
--   1. A "referral" lead type, for clients and past clients who came to us by
--      word of mouth rather than from an ad or a list.
--   2. external_ids (where else this person lives, such as their HubSpot
--      contact and deal) and deal_value (what the deal is worth), so the
--      HubSpot import keeps the links a later HubSpot takeover needs.
--   3. crm_merge_people: folds a duplicate into the person we keep. The
--      duplicate's history moves across, blanks on the kept person are filled,
--      tags are joined, and the duplicate is deleted. One "merged" timeline row
--      records it. The timeline stays append-only: the only change the trigger
--      now allows is moving rows to another person, and only inside this
--      function.
--
-- The functions cope without this file: crm-leads answers "merge" with an
-- error and everything else works as before.
--
-- Access: all four roles are named in every revoke, then service_role gets
-- execute back.
--
-- Rollback: drop function public.crm_merge_people(uuid, uuid, text);
--   restore crm_events_append_only from 20261026120000_crm_leads.sql;
--   alter table public.crm_people drop column external_ids, drop column deal_value;
--   (put back the old lead_type and kind checks once no row uses the new values)

begin;

alter table public.crm_people drop constraint if exists crm_people_lead_type_check;
alter table public.crm_people add constraint crm_people_lead_type_check
  check (lead_type in ('dream100', 'ad_lead', 'past_call', 'email', 'referral'));
alter table public.crm_sequences drop constraint if exists crm_sequences_lead_type_check;
alter table public.crm_sequences add constraint crm_sequences_lead_type_check
  check (lead_type is null or lead_type in ('dream100', 'ad_lead', 'past_call', 'email', 'referral'));

alter table public.crm_people add column if not exists external_ids jsonb not null default '{}'::jsonb
  check (jsonb_typeof(external_ids) = 'object');
alter table public.crm_people add column if not exists deal_value numeric(12, 2)
  check (deal_value is null or deal_value >= 0);

alter table public.crm_events drop constraint if exists crm_events_kind_check;
alter table public.crm_events add constraint crm_events_kind_check check (kind in ('created', 'imported', 'stage_changed', 'owner_changed', 'next_step_set', 'note', 'lost_reason_set', 'tags_changed', 'message_sent', 'reply', 'call',
  'booked', 'opted_out', 'call_at_set', 'timezone_set', 'call_outcome', 'enrolled', 'enrolment_paused', 'enrolment_resumed', 'step_skipped', 'enrolment_stopped', 'enrolment_completed', 'send_failed', 'send_skipped',
  'merged'));

-- Append-only, except moving rows to the kept person during a merge.
create or replace function public.crm_events_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('crm.merging', true) = 'on'
     and (to_jsonb(new) - 'person_id') = (to_jsonb(old) - 'person_id') then
    return new;
  end if;
  raise exception 'crm_events is append-only';
end
$$;

create or replace function public.crm_merge_people(p_keep uuid, p_drop uuid, p_actor text)
returns setof public.crm_people
language plpgsql security definer set search_path = public as $$
declare
  k public.crm_people;
  d public.crm_people;
  stage_rank text[] := array['to_contact', 'contacted', 'replied', 'call1_booked', 'no_show', 'call1_done', 'call2_done', 'nurture', 'lost', 'won'];
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'merge needs two different people';
  end if;
  select * into k from public.crm_people where id = p_keep for update;
  select * into d from public.crm_people where id = p_drop for update;
  if k.id is null or d.id is null then
    raise exception 'person not found';
  end if;

  -- Free the duplicate's unique contact keys before the kept person takes them.
  update public.crm_people set email = null, phone = null, instagram_handle = null where id = p_drop;

  update public.crm_people set
    display_name = case when btrim(display_name) = '' then d.display_name else display_name end,
    email = coalesce(email, d.email),
    phone = coalesce(phone, d.phone),
    instagram_handle = coalesce(instagram_handle, d.instagram_handle),
    niche = coalesce(niche, d.niche),
    source_id = coalesce(source_id, d.source_id),
    stage = case when array_position(stage_rank, d.stage) > array_position(stage_rank, stage) then d.stage else stage end,
    owner = coalesce(owner, d.owner),
    next_step = coalesce(next_step, d.next_step),
    next_step_due = coalesce(next_step_due, d.next_step_due),
    lost_reason = coalesce(lost_reason, d.lost_reason),
    tags = array(select distinct t from unnest(tags || d.tags) t order by t),
    timezone = coalesce(timezone, d.timezone),
    call_at = coalesce(call_at, d.call_at),
    opted_out_at = coalesce(opted_out_at, d.opted_out_at),
    external_ids = d.external_ids || external_ids,
    deal_value = coalesce(deal_value, d.deal_value),
    created_at = least(created_at, d.created_at),
    state_version = state_version + 1,
    updated_at = now()
  where id = p_keep;

  -- Enrolments: move across, unless the kept person is already in that sequence.
  update public.crm_enrolments e set status = 'stopped', stop_reason = 'merged', updated_at = now()
    where e.person_id = p_drop and e.status = 'active'
      and exists (select 1 from public.crm_enrolments x where x.person_id = p_keep and x.sequence_id = e.sequence_id and x.status = 'active');
  update public.crm_enrolments set person_id = p_keep, updated_at = now() where person_id = p_drop;

  perform set_config('crm.merging', 'on', true);
  update public.crm_events set person_id = p_keep where person_id = p_drop;
  perform set_config('crm.merging', 'off', true);

  insert into public.crm_events (person_id, kind, channel, actor, detail)
    values (p_keep, 'merged', 'system', left(coalesce(p_actor, ''), 80),
      jsonb_build_object('merged_name', d.display_name, 'merged_id', d.id::text, 'merged_created_at', d.created_at));

  delete from public.crm_people where id = p_drop;
  return query select * from public.crm_people where id = p_keep;
end
$$;

revoke all on function public.crm_merge_people(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.crm_merge_people(uuid, uuid, text) to service_role;
revoke all on function public.crm_events_append_only() from public, anon, authenticated, service_role;

commit;
