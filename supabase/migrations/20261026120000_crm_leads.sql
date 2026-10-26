-- ef-auto-deploy-applied-when: select to_regclass('public.crm_people') is not null and to_regclass('public.crm_events') is not null and to_regclass('public.crm_enrolments') is not null
--
-- Leads CRM, step 1 (docs/features/CRM_LEADS.md).
--
-- One row per person we might sell to (crm_people), an append-only timeline
-- (crm_events), where they came from (crm_sources), and the follow-up
-- sequences that will plug in later (crm_sequences, crm_sequence_steps,
-- crm_enrolments). Step 1 only reads and writes people and events; the
-- sequence tables exist so the model is settled, and nothing sends anything.
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
--     public.crm_apply_change(uuid, integer, jsonb, text, jsonb);
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

create table if not exists public.crm_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  lead_type text check (lead_type is null or lead_type in ('dream100', 'ad_lead', 'past_call', 'email')),
  active boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, version)
);

create table if not exists public.crm_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.crm_sequences(id) on delete cascade,
  position integer not null check (position >= 1),
  day_offset integer not null check (day_offset between 0 and 365),
  channel text not null check (channel in ('instagram_dm', 'email', 'sms', 'call', 'task')),
  template text not null default '' check (length(template) <= 4000),
  active boolean not null default true,
  version integer not null default 1 check (version >= 1),
  unique (sequence_id, position)
);

create table if not exists public.crm_enrolments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.crm_people(id) on delete cascade,
  sequence_id uuid not null references public.crm_sequences(id) on delete restrict,
  current_step_id uuid references public.crm_sequence_steps(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  paused boolean not null default false,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_enrolments_one_active_uq on public.crm_enrolments (person_id, sequence_id) where status = 'active';

create table if not exists public.crm_events (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.crm_people(id) on delete cascade,
  kind text not null check (kind in ('created', 'imported', 'stage_changed', 'owner_changed', 'next_step_set', 'note', 'lost_reason_set', 'tags_changed', 'message_sent', 'reply', 'call')),
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
    state_version = state_version + 1,
    updated_at = now()
  where id = p_id and state_version = p_expected_version
  returning * into r;
  if not found then return; end if;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    insert into public.crm_events (person_id, kind, channel, actor, detail)
    values (p_id, e->>'kind', nullif(e->>'channel', ''), coalesce(p_actor, ''), coalesce(e->'detail', '{}'::jsonb));
  end loop;
  return next r;
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
  public.crm_apply_change(uuid, integer, jsonb, text, jsonb) from public, anon, authenticated, service_role;

grant select, insert, update on table public.crm_sources, public.crm_people, public.crm_sequences,
  public.crm_sequence_steps, public.crm_enrolments to service_role;
grant select, insert on table public.crm_events to service_role;
grant usage on sequence public.crm_events_id_seq to service_role;
grant execute on function public.crm_normalize_email(text), public.crm_normalize_phone(text),
  public.crm_normalize_handle(text), public.crm_apply_change(uuid, integer, jsonb, text, jsonb) to service_role;

commit;
