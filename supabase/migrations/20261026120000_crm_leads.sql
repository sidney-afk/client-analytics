-- ef-auto-deploy-applied-when: select to_regclass('public.crm_people') is not null and to_regclass('public.crm_events') is not null and to_regclass('public.crm_enrolments') is not null
--
-- Leads CRM, step 1 (docs/features/CRM_LEADS.md).
--
-- One row per person we might sell to (crm_people), an append-only timeline
-- (crm_events), where they came from (crm_sources), and the follow-up
-- sequences that will plug in later (crm_sequences, crm_sequence_steps,
-- crm_enrolments). Step 2 adds the sequence engine (data only) and seeds four
-- draft sequences, all OFF. Nothing here sends anything: a later n8n sender
-- asks crm-leads `due` what it may send and records each result.
--
-- Access: these rows hold contact details (PII). No browser key and no
-- signed-in role reads or writes them. Only the crm-leads Edge Function
-- (service role, staff key checked first) and the import script (run by a
-- person with the service role key) touch them. Supabase grants every new
-- table and sequence to anon, authenticated and service_role by default, so
-- all four roles are named in every revoke, then service_role is granted back
-- exactly what it needs.
--
-- crm_events is append-only: service_role gets select and insert only, and a
-- trigger refuses update and delete for every role.
--
-- Rollback (nothing else depends on these tables):
--   drop table public.crm_enrolments, public.crm_sequence_steps, public.crm_sequences,
--     public.crm_events, public.crm_people, public.crm_sources;
--   drop function public.crm_normalize_email(text), public.crm_normalize_phone(text),
--     public.crm_normalize_handle(text), public.crm_events_append_only(),
--     public.crm_apply_change(uuid, integer, jsonb, text, jsonb), public.crm_enrol(uuid, uuid, text),
--     public.crm_enrolment_apply(uuid, jsonb, text, jsonb, boolean),
--     public.crm_step_new_version(uuid, jsonb, text);
begin;

-- Normalisers: the same rules the Edge Function and the import script use
-- (supabase/functions/_shared/crm-leads-core.mjs), so dedupe is one rule.
create or replace function public.crm_normalize_email(v text) returns text
language sql immutable as $$
  select nullif(lower(btrim(coalesce(v, ''))), '')
$$;
create or replace function public.crm_normalize_phone(v text) returns text
language sql immutable as $$
  select case when length(regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g')) >= 7
              then regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g') end
$$;
create or replace function public.crm_normalize_handle(v text) returns text
language sql immutable as $$
  select nullif(regexp_replace(lower(btrim(regexp_replace(coalesce(v, ''), '\[[^]]*\]', '', 'g'))), '^@+', ''), '')
$$;

create table if not exists public.crm_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  kind text not null default 'other' check (kind in ('csv_import', 'quiz', 'ad', 'referral', 'manual', 'other')),
  link text check (link is null or length(link) <= 600),
  created_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.crm_people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default '' check (length(display_name) <= 200),
  email text check (email is null or length(email) <= 320),
  phone text check (phone is null or length(phone) <= 40),
  instagram_handle text check (instagram_handle is null or length(instagram_handle) <= 100),
  lead_type text not null check (lead_type in ('dream100', 'ad_lead', 'past_call', 'email')),
  niche text check (niche is null or length(niche) <= 120),
  source_id uuid references public.crm_sources(id) on delete set null,
  stage text not null default 'to_contact' check (stage in ('to_contact', 'contacted', 'replied', 'call1_booked', 'no_show', 'call1_done', 'call2_done', 'nurture', 'won', 'lost')),
  owner text check (owner is null or length(owner) <= 80),
  next_step text check (next_step is null or length(next_step) <= 500),
  next_step_due date,
  lost_reason text check (lost_reason is null or lost_reason in ('price', 'trust', 'timing', 'budget', 'no_show')),
  tags text[] not null default '{}',
  timezone text check (timezone is null or length(timezone) <= 64),
  call_at timestamptz,
  opted_out_at timestamptz,
  state_version integer not null default 1 check (state_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email_norm text generated always as (public.crm_normalize_email(email)) stored,
  phone_norm text generated always as (public.crm_normalize_phone(phone)) stored,
  handle_norm text generated always as (public.crm_normalize_handle(instagram_handle)) stored
);
create unique index if not exists crm_people_email_norm_uq on public.crm_people (email_norm) where email_norm is not null;
create unique index if not exists crm_people_phone_norm_uq on public.crm_people (phone_norm) where phone_norm is not null;
create unique index if not exists crm_people_handle_norm_uq on public.crm_people (handle_norm) where handle_norm is not null;
create index if not exists crm_people_stage_idx on public.crm_people (stage, next_step_due);

-- Sequences (step 2). A sequence is OFF until someone switches it on, and a
-- step is a draft until an admin approves it; the `due` rule sends neither.
-- stay_stages: the stages a person must still be in for the sequence to go
-- on; a move anywhere else stops their enrolment.
create table if not exists public.crm_sequences (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 500),
  lead_type text check (lead_type is null or lead_type in ('dream100', 'ad_lead', 'past_call', 'email')),
  stay_stages text[] not null default '{}',
  active boolean not null default false,
  toggled_by text check (toggled_by is null or length(toggled_by) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Steps are versioned: an edit inserts a new row (version + 1, draft) and
-- marks the old one not current. Enrolments track sent steps by step_key, so
-- a step already sent stays sent and an unsent one picks up the new version.
-- audience: 'all', or a lost_reason variant ('lost_price', 'lost_trust',
-- 'lost_other' = any other or none).
create table if not exists public.crm_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.crm_sequences(id) on delete cascade,
  step_key text not null check (step_key ~ '^[a-z0-9_]{1,60}$'),
  position integer not null check (position >= 1),
  day_offset integer not null check (day_offset between 0 and 365),
  hour_offset integer not null default 0 check (hour_offset between 0 and 23),
  send_hour integer check (send_hour is null or send_hour between 6 and 20),
  channel text not null check (channel in ('sms', 'email')),
  audience text not null default 'all' check (audience in ('all', 'lost_price', 'lost_trust', 'lost_other')),
  subject text check (subject is null or length(subject) <= 200),
  template text not null default '' check (length(template) <= 4000),
  version integer not null default 1 check (version >= 1),
  is_current boolean not null default true,
  approval_state text not null default 'draft' check (approval_state in ('draft', 'approved')),
  approved_by text check (approved_by is null or length(approved_by) <= 80),
  approved_at timestamptz,
  edited_by text check (edited_by is null or length(edited_by) <= 80),
  created_at timestamptz not null default now(),
  check (channel <> 'sms' or length(template) <= 300),
  check ((approval_state = 'approved') = (approved_at is not null)),
  unique (sequence_id, step_key, version)
);
create unique index if not exists crm_sequence_steps_current_uq on public.crm_sequence_steps (sequence_id, step_key) where is_current;

create table if not exists public.crm_enrolments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.crm_people(id) on delete cascade,
  sequence_id uuid not null references public.crm_sequences(id) on delete restrict,
  current_step_id uuid references public.crm_sequence_steps(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  paused boolean not null default false,
  trigger_stage text,
  sent_step_keys text[] not null default '{}',
  skipped_step_keys text[] not null default '{}',
  stop_reason text check (stop_reason is null or length(stop_reason) <= 60),
  enrolled_by text check (enrolled_by is null or length(enrolled_by) <= 80),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_enrolments_status_idx on public.crm_enrolments (status, sequence_id);
create unique index if not exists crm_enrolments_one_active_uq on public.crm_enrolments (person_id, sequence_id) where status = 'active';

create table if not exists public.crm_events (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.crm_people(id) on delete cascade,
  kind text not null check (kind in ('created', 'imported', 'stage_changed', 'owner_changed', 'next_step_set', 'note', 'lost_reason_set', 'tags_changed', 'message_sent', 'reply', 'call',
    'booked', 'opted_out', 'call_at_set', 'timezone_set', 'call_outcome', 'enrolled', 'enrolment_paused', 'enrolment_resumed', 'step_skipped', 'enrolment_stopped', 'enrolment_completed', 'send_failed', 'send_skipped')),
  channel text check (channel is null or channel in ('instagram_dm', 'email', 'sms', 'call', 'task', 'system')),
  actor text not null default '' check (length(actor) <= 80),
  sequence_id uuid references public.crm_sequences(id) on delete set null,
  step_id uuid references public.crm_sequence_steps(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists crm_events_person_idx on public.crm_events (person_id, occurred_at desc);

create or replace function public.crm_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'crm_events is append-only';
end
$$;
drop trigger if exists crm_events_no_change on public.crm_events;
create trigger crm_events_no_change before update or delete on public.crm_events
  for each row execute function public.crm_events_append_only();

-- One change to a person, applied in one transaction: compare-and-swap on
-- state_version, then the timeline rows. Returns the new row, or no row when
-- the person is missing or someone else saved first (the caller re-reads and
-- answers 409). p_patch keys are whitelisted here as well as in the function.
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

-- Enrol a person in a sequence, with its timeline row, in one transaction.
-- At most one active enrolment per person per sequence: a second enrol
-- returns no row (the caller answers "already in it").
create or replace function public.crm_enrol(p_person uuid, p_sequence uuid, p_actor text)
returns setof public.crm_enrolments
language plpgsql security invoker set search_path = public as $$
declare
  r public.crm_enrolments;
begin
  insert into public.crm_enrolments (person_id, sequence_id, trigger_stage, enrolled_by)
  select p.id, p_sequence, p.stage, nullif(p_actor, '') from public.crm_people p where p.id = p_person
  on conflict (person_id, sequence_id) where status = 'active' do nothing
  returning * into r;
  if not found then return; end if;
  insert into public.crm_events (person_id, kind, channel, actor, sequence_id, detail)
  values (p_person, 'enrolled', 'system', coalesce(p_actor, ''), p_sequence, jsonb_build_object('stage', r.trigger_stage));
  return next r;
end
$$;

-- One change to an enrolment (pause, resume, skip a step, stop, complete, a
-- send result) and its timeline row, in one transaction. p_require_active:
-- refuse (no row) when the enrolment is no longer active. A send result is
-- recorded even then, so nothing a sender did goes unlogged.
create or replace function public.crm_enrolment_apply(p_id uuid, p_patch jsonb, p_actor text, p_event jsonb, p_require_active boolean)
returns setof public.crm_enrolments
language plpgsql security invoker set search_path = public as $$
declare
  r public.crm_enrolments;
begin
  update public.crm_enrolments set
    paused = case when p_patch ? 'paused' then (p_patch->>'paused')::boolean else paused end,
    status = case when p_patch ? 'status' and status = 'active' then p_patch->>'status' else status end,
    stop_reason = case when p_patch ? 'stop_reason' and status = 'active' then p_patch->>'stop_reason' else stop_reason end,
    sent_step_keys = case when p_patch ? 'add_sent' and not (p_patch->>'add_sent' = any(sent_step_keys))
      then sent_step_keys || array[p_patch->>'add_sent'] else sent_step_keys end,
    skipped_step_keys = case when p_patch ? 'add_skipped' and not (p_patch->>'add_skipped' = any(skipped_step_keys))
      then skipped_step_keys || array[p_patch->>'add_skipped'] else skipped_step_keys end,
    updated_at = now()
  where id = p_id and (not p_require_active or status = 'active')
  returning * into r;
  if not found then return; end if;
  if p_event is not null then
    insert into public.crm_events (person_id, kind, channel, actor, sequence_id, step_id, detail)
    values (r.person_id, p_event->>'kind', nullif(p_event->>'channel', ''), coalesce(p_actor, ''), r.sequence_id,
            nullif(p_event->>'step_id', '')::uuid, coalesce(p_event->'detail', '{}'::jsonb));
  end if;
  return next r;
end
$$;

-- Edit a step: the current row stops being current and a new version takes
-- its place as a draft, so every edit needs a fresh approval. Returns the new
-- row, or no row when p_step_id is not the current version (someone edited
-- first).
create or replace function public.crm_step_new_version(p_step_id uuid, p_fields jsonb, p_actor text)
returns setof public.crm_sequence_steps
language plpgsql security invoker set search_path = public as $$
declare
  o public.crm_sequence_steps;
  n public.crm_sequence_steps;
begin
  select * into o from public.crm_sequence_steps where id = p_step_id and is_current for update;
  if not found then return; end if;
  update public.crm_sequence_steps set is_current = false where id = o.id;
  insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience,
    subject, template, version, is_current, approval_state, edited_by)
  values (o.sequence_id, o.step_key, o.position,
    case when p_fields ? 'day_offset' then (p_fields->>'day_offset')::integer else o.day_offset end,
    case when p_fields ? 'hour_offset' then (p_fields->>'hour_offset')::integer else o.hour_offset end,
    case when p_fields ? 'send_hour' then nullif(p_fields->>'send_hour', '')::integer else o.send_hour end,
    o.channel, o.audience,
    case when p_fields ? 'subject' then p_fields->>'subject' else o.subject end,
    case when p_fields ? 'template' then p_fields->>'template' else o.template end,
    o.version + 1, true, 'draft', nullif(p_actor, ''))
  returning * into n;
  return next n;
end
$$;

alter table public.crm_sources enable row level security;
alter table public.crm_people enable row level security;
alter table public.crm_sequences enable row level security;
alter table public.crm_sequence_steps enable row level security;
alter table public.crm_enrolments enable row level security;
alter table public.crm_events enable row level security;

revoke all on table public.crm_sources, public.crm_people, public.crm_sequences, public.crm_sequence_steps,
  public.crm_enrolments, public.crm_events from public, anon, authenticated, service_role;
revoke all on sequence public.crm_events_id_seq from public, anon, authenticated, service_role;
revoke all on function public.crm_normalize_email(text), public.crm_normalize_phone(text),
  public.crm_normalize_handle(text), public.crm_events_append_only(),
  public.crm_apply_change(uuid, integer, jsonb, text, jsonb), public.crm_enrol(uuid, uuid, text),
  public.crm_enrolment_apply(uuid, jsonb, text, jsonb, boolean),
  public.crm_step_new_version(uuid, jsonb, text) from public, anon, authenticated, service_role;

grant select, insert, update on table public.crm_sources, public.crm_people, public.crm_sequences,
  public.crm_sequence_steps, public.crm_enrolments to service_role;
grant select, insert on table public.crm_events to service_role;
grant usage on sequence public.crm_events_id_seq to service_role;
grant execute on function public.crm_normalize_email(text), public.crm_normalize_phone(text),
  public.crm_normalize_handle(text), public.crm_apply_change(uuid, integer, jsonb, text, jsonb),
  public.crm_enrol(uuid, uuid, text), public.crm_enrolment_apply(uuid, jsonb, text, jsonb, boolean),
  public.crm_step_new_version(uuid, jsonb, text) to service_role;


-- Seed: the four follow-up sequences from Kasper's spec. Every sequence is
-- OFF and every step a DRAFT for Kasper to read, edit and approve in the
-- Sequences tab. Re-running is harmless (on conflict do nothing).
-- Placeholders: {first_name} and {niche} are filled from the person; the
-- {..._link} ones are filled by the sender. No results or numbers are claimed.
insert into public.crm_sequences (key, name, description, stay_stages, active) values ($t$no_show$t$, $t$No-show on call 1$t$, $t$Someone booked call 1 and did not show. Moves them to rebook, or closes their file.$t$, array[$t$no_show$t$]::text[], false) on conflict (key) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$ns_text_30m$t$, 1, 0, 0, null, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, it's Kasper. Looks like we missed each other just now, no stress, clinic days run long. If you still want to talk, pick a new time here: {rebook_link}$t$ from public.crm_sequences where key = $t$no_show$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$ns_text_morning$t$, 2, 1, 0, 9, $t$sms$t$, $t$all$t$, null, $t$Morning {first_name}, Kasper here. Want to find a better time this week? Rebooking takes a second: {rebook_link}$t$ from public.crm_sequences where key = $t$no_show$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$ns_email_d2$t$, 3, 2, 0, 10, $t$email$t$, $t$all$t$, $t$Missed you on our call$t$, $t$Hi {first_name},

We had a call booked and didn't get to connect. Totally fine, I know how full your days are.

I'd still like to hear about your course or program and where you want it to go. If that's still on your mind, grab a new time here:
{rebook_link}

Kasper$t$ from public.crm_sequences where key = $t$no_show$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$ns_text_d4$t$, 4, 4, 0, 11, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, Kasper again. Still happy to talk about getting more people into your program. If now's not the time, just tell me and I'll stop nudging. {rebook_link}$t$ from public.crm_sequences where key = $t$no_show$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$ns_email_d7$t$, 5, 7, 0, 10, $t$email$t$, $t$all$t$, $t$Rebook or close your file?$t$, $t$Hi {first_name},

I haven't heard back since our missed call, so I'll keep this short.

Should I keep your file open? If yes, pick a time that works: {rebook_link}

If the timing isn't right, no problem at all. Reply "close it" and I'll stop following up.

Kasper$t$ from public.crm_sequences where key = $t$no_show$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequences (key, name, description, stay_stages, active) values ($t$call1_no_call2$t$, $t$Did call 1, no call 2$t$, $t$Call 1 is done and call 2 is not booked. Helps them book call 2.$t$, array[$t$call1_done$t$]::text[], false) on conflict (key) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c1_text_same_day$t$, 1, 0, 2, null, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, Kasper here. Really enjoyed our chat today. When you're ready for the second call, where I walk you through the plan for your account, book it here: {call2_link}$t$ from public.crm_sequences where key = $t$call1_no_call2$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c1_email_d2$t$, 2, 2, 0, 10, $t$email$t$, $t$all$t$, $t$An example from {niche}$t$, $t$Hi {first_name},

Thanks again for the call. I said I'd send you something from your field, so here it is:
{case_study_link}

It shows how another doctor in {niche} uses short videos to bring people into their program. Worth five minutes before we talk again.

When you're ready for the second call: {call2_link}

Kasper$t$ from public.crm_sequences where key = $t$call1_no_call2$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c1_text_d4$t$, 3, 4, 0, 11, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, did you get a chance to look at the example I sent? Happy to go through the plan for your account whenever suits: {call2_link}$t$ from public.crm_sequences where key = $t$call1_no_call2$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c1_email_d7$t$, 4, 7, 0, 10, $t$email$t$, $t$all$t$, $t$Something useful for your account$t$, $t$Hi {first_name},

Whether or not we end up working together, I wanted to send you something you can use right away:
{useful_link}

Take what helps and ignore the rest.

If you'd like to talk through how it fits your program, here's the second call: {call2_link}

Kasper$t$ from public.crm_sequences where key = $t$call1_no_call2$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c1_text_d10$t$, 5, 10, 0, 11, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, Kasper here. Still keen to show you the plan we'd build for you. Grab a time if it's useful: {call2_link}$t$ from public.crm_sequences where key = $t$call1_no_call2$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c1_email_d14$t$, 6, 14, 0, 10, $t$email$t$, $t$all$t$, $t$Should I keep your spot?$t$, $t$Hi {first_name},

It's been two weeks since our first call, and I don't want to crowd your inbox.

If the second call still makes sense, book it here: {call2_link}

If something changed, just reply and tell me. Either answer is fine.

Kasper$t$ from public.crm_sequences where key = $t$call1_no_call2$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequences (key, name, description, stay_stages, active) values ($t$call2_no_sign$t$, $t$Did call 2, did not sign$t$, $t$Call 2 is done and they have not signed. Six touches over 14 days; the emails follow their lost reason.$t$, array[$t$call2_done$t$, $t$lost$t$]::text[], false) on conflict (key) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_text_d0$t$, 1, 0, 3, null, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, thanks for your time on our call today. No pressure at all. If any questions come up while you think it over, just text me back. Kasper$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_email_d2_price$t$, 2, 2, 0, 10, $t$email$t$, $t$lost_price$t$, $t$What it looks like in practice$t$, $t$Hi {first_name},

You mentioned the price was the sticking point. That's fair, and I'd rather you decide with a real example in front of you than with my word.

Here's how it went for another doctor who sells a program:
{case_study_link}

If it helps, I'm happy to go over what it would look like for you on a short call.

Kasper$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_email_d2_trust$t$, 2, 2, 0, 10, $t$email$t$, $t$lost_trust$t$, $t$Hear it from people we work with$t$, $t$Hi {first_name},

It makes sense to want more than my word before you commit. So here's what people we work with say, in their own words:
{testimonials_link}

If you'd like, I can also put you in touch with one of them.

Kasper$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_email_d2_other$t$, 2, 2, 0, 10, $t$email$t$, $t$lost_other$t$, $t$Something to look at while you decide$t$, $t$Hi {first_name},

Thanks again for the call. While you think it over, here's an example from another doctor's account:
{case_study_link}

Any questions, just reply here.

Kasper$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_text_d5$t$, 3, 5, 0, 11, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, Kasper here. Any questions I can answer while you decide? Happy to help either way.$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_email_d8$t$, 4, 8, 0, 10, $t$email$t$, $t$all$t$, $t$One idea for your account$t$, $t$Hi {first_name},

Here's one thing I'd try first on your account, whatever you decide about us:
{useful_link}

Kasper$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_text_d11$t$, 5, 11, 0, 11, $t$sms$t$, $t$all$t$, null, $t$Hi {first_name}, just checking in. If now isn't the right time, that's completely fine. Let me know so I don't keep bugging you. Kasper$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$c2_email_d14$t$, 6, 14, 0, 10, $t$email$t$, $t$all$t$, $t$What would need to change?$t$, $t$Hi {first_name},

This is my last note for now.

I'd really like to know: what would need to change for this to be a yes for you? Price, timing, something we didn't cover? A one-line reply is plenty, and it helps me a lot.

Kasper$t$ from public.crm_sequences where key = $t$call2_no_sign$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequences (key, name, description, stay_stages, active) values ($t$nurture$t$, $t$Nurture$t$, $t$Not ready now. One useful email a week, no pitch.$t$, array[$t$nurture$t$, $t$lost$t$]::text[], false) on conflict (key) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$nu_week1$t$, 1, 7, 0, 10, $t$email$t$, $t$all$t$, $t$A quick idea for your next video$t$, $t$Hi {first_name},

One thing that works well for doctors with a course or program: answer the question patients ask you most, in under a minute, and point them to your program at the end.

Here's what that can look like: {useful_link}

Kasper$t$ from public.crm_sequences where key = $t$nurture$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$nu_week2$t$, 2, 14, 0, 10, $t$email$t$, $t$all$t$, $t$The question behind the question$t$, $t$Hi {first_name},

When someone asks you a question online, there's usually a bigger worry behind it. Videos that answer the worry, not just the question, tend to bring in people who are ready for your program.

A short example: {useful_link}

Kasper$t$ from public.crm_sequences where key = $t$nurture$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$nu_week3$t$, 3, 21, 0, 10, $t$email$t$, $t$all$t$, $t$Your best material is already made$t$, $t$Hi {first_name},

Most doctors already have great material: talks, slides, the things you explain every day. Turning one of those into three short clips is often the easiest place to start.

Here's how: {useful_link}

Kasper$t$ from public.crm_sequences where key = $t$nurture$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$nu_week4$t$, 4, 28, 0, 10, $t$email$t$, $t$all$t$, $t$One small change to your profile$t$, $t$Hi {first_name},

Your profile is the first place people look after they see a video. One clear line on who your program is for, and one link, does more than a long bio.

More on that: {useful_link}

Kasper$t$ from public.crm_sequences where key = $t$nurture$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$nu_week5$t$, 5, 35, 0, 10, $t$email$t$, $t$all$t$, $t$What another doctor in {niche} is doing$t$, $t$Hi {first_name},

Thought you'd like to see how another doctor in {niche} is using short videos:
{case_study_link}

Kasper$t$ from public.crm_sequences where key = $t$nurture$t$
  on conflict (sequence_id, step_key, version) do nothing;
insert into public.crm_sequence_steps (sequence_id, step_key, position, day_offset, hour_offset, send_hour, channel, audience, subject, template)
  select id, $t$nu_week6$t$, 6, 42, 0, 10, $t$email$t$, $t$all$t$, $t$Still on your list?$t$, $t$Hi {first_name},

If growing your program with video is still on your list, I'm happy to pick up where we left off. Here's a time to talk: {rebook_link}

No rush, and no hard feelings if not.

Kasper$t$ from public.crm_sequences where key = $t$nurture$t$
  on conflict (sequence_id, step_key, version) do nothing;

commit;
