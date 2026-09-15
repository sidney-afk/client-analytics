-- Adds a second hiring role (Video Editor) to the existing Hiring Process
-- sidecar and gives that role its own middle stage: a practical-test email
-- (raw footage + a reference edit + written instructions) queued between
-- application review and the final interview invite.
--
-- Additive and backward-compatible only:
--   * Every existing Client Success & Content Manager row, check, and RPC
--     call keeps its exact current behavior. `role_slug` defaults to
--     'client-success-content-manager' for all 14 existing rows, and the
--     round-3 interview-invite gate only asks for a passed practical test
--     when role_slug = 'video-editor'.
--   * `hiring_practical_tests_enabled` is a brand-new kill switch, seeded
--     false with the same pre-existing-value abort guard as
--     `hiring_invites_enabled`. Nothing in this delta sends an email or
--     enables automation.
--   * The `video-editor-application` / `video-editor-interview` iClosed
--     events must exist (see the owner's iClosed dashboard) before this is
--     applied, or captures for that role will correctly fail closed with
--     `invalid_event`.
--
-- This file is source-only until EXECUTION_LOG.md records its manual
-- application in the Supabase SQL editor, per migrations/README.md.

begin;

-- ---------------------------------------------------------------------
-- 1. hiring_applications: role_slug + practical_test_verdict
-- ---------------------------------------------------------------------

alter table public.hiring_applications
  add column if not exists role_slug text not null default 'client-success-content-manager'
    check (role_slug in ('client-success-content-manager', 'video-editor'));

alter table public.hiring_applications
  add column if not exists practical_test_verdict text
    check (practical_test_verdict is null or practical_test_verdict in ('passed', 'not_selected'));

comment on column public.hiring_applications.role_slug is
  'Which hiring pipeline this application belongs to. Backfilled to client-success-content-manager for every pre-existing row.';
comment on column public.hiring_applications.practical_test_verdict is
  'Video Editor role only: set only after the practical-test email has actually been delivered. Gates the round-3 interview invite.';

create index if not exists hiring_applications_role_slug_idx
  on public.hiring_applications (role_slug, status);

-- Widen the fixed application-event check to both roles' application slugs.
do $$
declare
  v_constraint text;
begin
  select c.conname
    into v_constraint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'hiring_applications'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%source_event_slug%'
     and pg_get_constraintdef(c.oid) like '%client-success-content-manager-application%'
   order by c.conname
   limit 1;

  if v_constraint is not null then
    execute format('alter table public.hiring_applications drop constraint %I', v_constraint);
  end if;

  alter table public.hiring_applications
    add constraint hiring_applications_source_event_slug_check
    check (source_event_slug in ('client-success-content-manager-application', 'video-editor-application'));
end $$;

-- Widen the fixed interview-URL check on the (unchanged, single-per-role-stage)
-- interview invite outbox to both roles' interview event URLs.
do $$
declare
  v_constraint text;
begin
  select c.conname
    into v_constraint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'hiring_invite_jobs'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%interview_event_url%'
     and pg_get_constraintdef(c.oid) like '%client-success-content-manager-interview%'
   order by c.conname
   limit 1;

  if v_constraint is not null then
    execute format('alter table public.hiring_invite_jobs drop constraint %I', v_constraint);
  end if;

  alter table public.hiring_invite_jobs
    add constraint hiring_invite_jobs_interview_event_url_check
    check (interview_event_url in (
      'https://app.iclosed.io/e/synchrosocial/client-success-content-manager-interview',
      'https://app.iclosed.io/e/synchrosocial/video-editor-interview'
    ));
end $$;

-- Widen the audit event_type allowlist for the new practical-test stage.
do $$
declare
  v_constraint text;
begin
  select c.conname
    into v_constraint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'hiring_application_events'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%event_type%'
     and pg_get_constraintdef(c.oid) like '%invite_queued%'
   order by c.conname
   limit 1;

  if v_constraint is not null then
    execute format('alter table public.hiring_application_events drop constraint %I', v_constraint);
  end if;

  alter table public.hiring_application_events
    add constraint hiring_application_events_event_type_check
    check (event_type in (
      'received', 'refreshed', 'status_changed', 'invite_queued', 'invite_requeued',
      'invite_sent', 'invite_failed', 'invite_delivery_uncertain', 'interview_booked',
      'practical_test_queued', 'practical_test_requeued', 'practical_test_sent',
      'practical_test_failed', 'practical_test_delivery_uncertain', 'practical_test_verdict_set'
    ));
end $$;

-- ---------------------------------------------------------------------
-- 2. hiring_practical_test_jobs: the Video Editor round-2 outbox
-- ---------------------------------------------------------------------

create table if not exists public.hiring_practical_test_jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.hiring_applications(id) on delete restrict,
  recipient_email text not null
    check (position('@' in recipient_email) > 1),
  subject text not null
    check (btrim(subject) <> ''),
  body text not null
    check (btrim(body) <> ''),
  raw_footage_url text not null
    check (raw_footage_url ~ '^https://'),
  reference_edit_url text not null
    check (reference_edit_url ~ '^https://'),
  state text not null default 'queued'
    check (state in ('queued', 'dispatching', 'sent', 'failed', 'delivery_uncertain')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  send_authorized_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  failure_code text,
  requested_by text not null
    check (btrim(requested_by) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hiring_practical_test_jobs is
  'One durable practical-test-email job per Video Editor application: raw footage + a reference edit + instructions. A job is claimed before delivery so double clicks and retries cannot send a duplicate.';

create index if not exists hiring_practical_test_jobs_dispatch_idx
  on public.hiring_practical_test_jobs (state, created_at)
  where state in ('queued', 'dispatching');

drop trigger if exists hiring_practical_test_jobs_touch_updated_at on public.hiring_practical_test_jobs;
create trigger hiring_practical_test_jobs_touch_updated_at
before update on public.hiring_practical_test_jobs
for each row execute function public.hiring_touch_updated_at();

create or replace function public.hiring_require_practical_test_send_authorization()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.state = 'sent'
     and old.state <> 'sent'
     and (old.claimed_at is null
          or old.send_authorized_at is null
          or old.send_authorized_at < old.claimed_at) then
    raise exception using errcode = 'P0001', message = 'send_not_authorized';
  end if;
  return new;
end;
$$;

drop trigger if exists hiring_practical_test_jobs_require_send_auth on public.hiring_practical_test_jobs;
create trigger hiring_practical_test_jobs_require_send_auth
before update on public.hiring_practical_test_jobs
for each row execute function public.hiring_require_practical_test_send_authorization();

alter table public.hiring_practical_test_jobs enable row level security;
revoke all on table public.hiring_practical_test_jobs from public, anon, authenticated;
grant select, insert, update on table public.hiring_practical_test_jobs to service_role;
revoke delete, truncate, references, trigger on table public.hiring_practical_test_jobs from service_role;

-- One-step outbound kill switch for the new stage. Same abort-on-preexisting-
-- value posture as hiring_invites_enabled: never silently adopt a value this
-- migration did not write.
do $$
declare
  v_existing jsonb;
begin
  select value into v_existing
    from public.syncview_runtime_flags
   where key = 'hiring_practical_tests_enabled'
   for update;

  if found then
    if v_existing is distinct from '{"enabled": false}'::jsonb then
      raise exception using errcode = 'P0001', message = 'hiring_flag_preexisting';
    end if;
  else
    insert into public.syncview_runtime_flags (key, value, updated_by)
    values ('hiring_practical_tests_enabled', '{"enabled": false}'::jsonb, 'migration-hiring-video-editor-role');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Role-aware capture, and the round-3 practical-test-passed gate
-- ---------------------------------------------------------------------

create or replace function public.hiring_capture_application_v1(
  p_source_event_slug text,
  p_source_contact_id text,
  p_source_submission_key text,
  p_name text,
  p_email text,
  p_location text,
  p_when_can_start text,
  p_answers jsonb,
  p_video_url text,
  p_iclosed_preview_url text,
  p_submitted_at timestamptz,
  p_source_updated_at timestamptz default null
)
returns table(application_id uuid, created boolean, application_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_created boolean := false;
  v_existing public.hiring_applications%rowtype;
  v_slug text := lower(btrim(coalesce(p_source_event_slug, '')));
  v_role_slug text;
  v_contact_id text := btrim(coalesce(p_source_contact_id, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_answers jsonb := coalesce(p_answers, '[]'::jsonb);
  v_video_url text := btrim(coalesce(p_video_url, ''));
begin
  v_role_slug := case v_slug
    when 'client-success-content-manager-application' then 'client-success-content-manager'
    when 'video-editor-application' then 'video-editor'
    else null
  end;
  if v_role_slug is null then
    raise exception using errcode = 'P0001', message = 'invalid_event';
  end if;
  if v_contact_id = '' then
    raise exception using errcode = 'P0001', message = 'invalid_source_contact';
  end if;
  if v_name = '' or position('@' in v_email) <= 1 then
    raise exception using errcode = 'P0001', message = 'invalid_applicant';
  end if;
  if p_source_updated_at is null then
    raise exception using errcode = 'P0001', message = 'invalid_source_timestamp';
  end if;
  if jsonb_typeof(v_answers) not in ('array', 'object')
    or (case jsonb_typeof(v_answers)
      when 'array' then jsonb_array_length(v_answers) = 0
      when 'object' then v_answers = '{}'::jsonb
      else true
    end)
    or v_video_url = '' then
    raise exception using errcode = 'P0001', message = 'invalid_answers';
  end if;

  insert into public.hiring_applications (
    source_event_slug, role_slug, source_contact_id, source_submission_key, name, email,
    location, when_can_start, answers, video_url, iclosed_preview_url,
    submitted_at, source_updated_at
  ) values (
    v_slug, v_role_slug, v_contact_id, nullif(btrim(coalesce(p_source_submission_key, '')), ''), v_name, v_email,
    nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_when_can_start, '')), ''), v_answers,
    v_video_url, nullif(btrim(coalesce(p_iclosed_preview_url, '')), ''),
    coalesce(p_submitted_at, now()), p_source_updated_at
  ) on conflict (source_event_slug, source_contact_id) do nothing
  returning id into v_id;

  if found then
    v_created := true;
    insert into public.hiring_application_events (application_id, event_type, metadata)
    values (v_id, 'received', jsonb_build_object('source_event_slug', v_slug));
  else
    select * into v_existing
      from public.hiring_applications
     where source_event_slug = v_slug
       and source_contact_id = v_contact_id
     for update;
    v_id := v_existing.id;

    if p_source_updated_at is not null
       and (v_existing.source_updated_at is null or p_source_updated_at > v_existing.source_updated_at)
       and not exists (
         select 1 from public.hiring_invite_jobs j
          where j.application_id = v_existing.id
       )
       and not exists (
         select 1 from public.hiring_practical_test_jobs j
          where j.application_id = v_existing.id
       ) then
      update public.hiring_applications
         set source_submission_key = nullif(btrim(coalesce(p_source_submission_key, '')), ''),
             name = v_name,
             email = v_email,
             location = nullif(btrim(coalesce(p_location, '')), ''),
             when_can_start = nullif(btrim(coalesce(p_when_can_start, '')), ''),
             answers = v_answers,
             video_url = v_video_url,
             iclosed_preview_url = nullif(btrim(coalesce(p_iclosed_preview_url, '')), ''),
             source_updated_at = p_source_updated_at,
             state_version = state_version + 1
       where id = v_existing.id
       returning * into v_existing;
    end if;
  end if;

  select * into v_existing from public.hiring_applications where id = v_id;
  return query select v_id, v_created, v_existing.status;
end;
$$;

-- Round 3 (both roles' final interview invite): unchanged for
-- client-success-content-manager; for video-editor, requires a passed
-- practical test first, and validates against that role's interview URL.
create or replace function public.hiring_queue_interview_invite_v1(
  p_application_id uuid,
  p_expected_state_version bigint,
  p_recipient_email text,
  p_subject text,
  p_body text,
  p_interview_event_url text,
  p_actor text
)
returns table(job_id uuid, job_state text, existing boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.hiring_applications%rowtype;
  v_job public.hiring_invite_jobs%rowtype;
  v_enabled boolean := false;
  v_actor text := btrim(coalesce(p_actor, ''));
  v_expected_url text;
begin
  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled';
  if not coalesce(v_enabled, false) then
    raise exception using errcode = 'P0001', message = 'feature_disabled';
  end if;
  if v_actor = '' or position('@' in coalesce(p_recipient_email, '')) <= 1
    or btrim(coalesce(p_subject, '')) = '' or btrim(coalesce(p_body, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;

  select * into v_application
    from public.hiring_applications
   where id = p_application_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_not_found';
  end if;
  if v_application.state_version <> p_expected_state_version then
    raise exception using errcode = 'P0001', message = 'state_conflict';
  end if;
  if v_application.status in ('rejected', 'withdrawn', 'invited', 'interview_booked') then
    raise exception using errcode = 'P0001', message = 'terminal_status';
  end if;
  if v_application.role_slug = 'video-editor' and coalesce(v_application.practical_test_verdict, '') <> 'passed' then
    raise exception using errcode = 'P0001', message = 'practical_test_required';
  end if;
  if lower(btrim(coalesce(p_recipient_email, ''))) <> lower(v_application.email) then
    raise exception using errcode = 'P0001', message = 'recipient_conflict';
  end if;

  v_expected_url := case v_application.role_slug
    when 'video-editor' then 'https://app.iclosed.io/e/synchrosocial/video-editor-interview'
    else 'https://app.iclosed.io/e/synchrosocial/client-success-content-manager-interview'
  end;
  if btrim(coalesce(p_interview_event_url, '')) <> v_expected_url then
    raise exception using errcode = 'P0001', message = 'invalid_interview_event';
  end if;

  select * into v_job
    from public.hiring_invite_jobs
   where application_id = v_application.id
   for update;
  if found then
    return query select v_job.id, v_job.state, true;
    return;
  end if;

  insert into public.hiring_invite_jobs (
    application_id, recipient_email, subject, body, interview_event_url, requested_by
  ) values (
    v_application.id, lower(btrim(p_recipient_email)), btrim(p_subject), p_body,
    btrim(p_interview_event_url), v_actor
  ) returning * into v_job;

  update public.hiring_applications
     set status = case when status = 'new' then 'reviewing' else status end,
         state_version = state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where id = v_application.id;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (v_application.id, 'invite_queued', v_actor, jsonb_build_object('job_id', v_job.id));

  return query select v_job.id, v_job.state, false;
end;
$$;

-- Booking capture: accepts either role's interview slug. Matching is still
-- purely by stable iClosed contact id + status, unchanged from today.
create or replace function public.hiring_record_interview_booking_v1(
  p_source_event_slug text,
  p_source_contact_id text,
  p_booking_id text,
  p_booked_at timestamptz default null
)
returns table(application_id uuid, status text, state_version bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.hiring_applications%rowtype;
  v_contact_id text := btrim(coalesce(p_source_contact_id, ''));
  v_booking_id text := btrim(coalesce(p_booking_id, ''));
begin
  if lower(btrim(coalesce(p_source_event_slug, ''))) not in (
    'client-success-content-manager-interview', 'video-editor-interview'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_event';
  end if;
  if v_contact_id = '' or v_booking_id = '' then
    raise exception using errcode = 'P0001', message = 'invalid_booking';
  end if;

  select * into v_application
    from public.hiring_applications as h
   where h.source_contact_id = v_contact_id
     and h.status in ('invited', 'interview_booked')
   for update
   limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_not_found';
  end if;
  if v_application.interview_booking_id is not null and v_application.interview_booking_id <> v_booking_id then
    raise exception using errcode = 'P0001', message = 'booking_conflict';
  end if;

  update public.hiring_applications as a
     set status = 'interview_booked',
         interview_booking_id = v_booking_id,
         state_version = case when a.status = 'interview_booked' then a.state_version else a.state_version + 1 end
   where a.id = v_application.id
   returning * into v_application;
  if v_application.status = 'interview_booked' and v_application.interview_booking_id = v_booking_id then
    insert into public.hiring_application_events (application_id, event_type, metadata)
    select v_application.id, 'interview_booked', jsonb_build_object('booking_id', v_booking_id)
     where not exists (
       select 1 from public.hiring_application_events e
        where e.application_id = v_application.id
          and e.event_type = 'interview_booked'
          and e.metadata ->> 'booking_id' = v_booking_id
     );
  end if;
  return query select v_application.id, v_application.status, v_application.state_version;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Round-2 practical-test RPCs (Video Editor only), mirroring the
--    existing interview-invite claim/authorize/record/retry shape exactly.
-- ---------------------------------------------------------------------

create or replace function public.hiring_queue_practical_test_v1(
  p_application_id uuid,
  p_expected_state_version bigint,
  p_recipient_email text,
  p_subject text,
  p_body text,
  p_raw_footage_url text,
  p_reference_edit_url text,
  p_actor text
)
returns table(job_id uuid, job_state text, existing boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.hiring_applications%rowtype;
  v_job public.hiring_practical_test_jobs%rowtype;
  v_enabled boolean := false;
  v_actor text := btrim(coalesce(p_actor, ''));
begin
  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_practical_tests_enabled';
  if not coalesce(v_enabled, false) then
    raise exception using errcode = 'P0001', message = 'feature_disabled';
  end if;
  if v_actor = '' or position('@' in coalesce(p_recipient_email, '')) <= 1
    or btrim(coalesce(p_subject, '')) = '' or btrim(coalesce(p_body, '')) = ''
    or btrim(coalesce(p_raw_footage_url, '')) !~ '^https://'
    or btrim(coalesce(p_reference_edit_url, '')) !~ '^https://' then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;

  select * into v_application
    from public.hiring_applications
   where id = p_application_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_not_found';
  end if;
  if v_application.role_slug <> 'video-editor' then
    raise exception using errcode = 'P0001', message = 'wrong_role';
  end if;
  if v_application.state_version <> p_expected_state_version then
    raise exception using errcode = 'P0001', message = 'state_conflict';
  end if;
  if v_application.status in ('rejected', 'withdrawn', 'invited', 'interview_booked') then
    raise exception using errcode = 'P0001', message = 'terminal_status';
  end if;
  if lower(btrim(coalesce(p_recipient_email, ''))) <> lower(v_application.email) then
    raise exception using errcode = 'P0001', message = 'recipient_conflict';
  end if;

  select * into v_job
    from public.hiring_practical_test_jobs
   where application_id = v_application.id
   for update;
  if found then
    return query select v_job.id, v_job.state, true;
    return;
  end if;

  insert into public.hiring_practical_test_jobs (
    application_id, recipient_email, subject, body, raw_footage_url, reference_edit_url, requested_by
  ) values (
    v_application.id, lower(btrim(p_recipient_email)), btrim(p_subject), p_body,
    btrim(p_raw_footage_url), btrim(p_reference_edit_url), v_actor
  ) returning * into v_job;

  update public.hiring_applications
     set status = case when status = 'new' then 'reviewing' else status end,
         state_version = state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where id = v_application.id;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (v_application.id, 'practical_test_queued', v_actor, jsonb_build_object('job_id', v_job.id));

  return query select v_job.id, v_job.state, false;
end;
$$;

create or replace function public.hiring_claim_next_practical_test_v1(p_worker_id text)
returns table(
  job_id uuid,
  claim_token uuid,
  application_id uuid,
  recipient_email text,
  subject text,
  body text,
  raw_footage_url text,
  reference_edit_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hiring_practical_test_jobs%rowtype;
  v_worker text := btrim(coalesce(p_worker_id, ''));
  v_enabled boolean := false;
begin
  if v_worker = '' then
    raise exception using errcode = 'P0001', message = 'invalid_worker';
  end if;

  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_practical_tests_enabled';
  if not coalesce(v_enabled, false) then
    return;
  end if;

  with stale as (
    update public.hiring_practical_test_jobs as j
       set state = 'delivery_uncertain',
           claim_token = null,
           failure_code = 'dispatch_timeout'
     where j.state = 'dispatching'
       and coalesce(j.claimed_at, j.created_at) < now() - interval '30 minutes'
     returning j.id, j.application_id
  )
  insert into public.hiring_application_events (application_id, event_type, metadata)
  select s.application_id, 'practical_test_delivery_uncertain', jsonb_build_object('job_id', s.id, 'failure_code', 'dispatch_timeout')
    from stale s;

  select * into v_job
    from public.hiring_practical_test_jobs
   where state = 'queued'
   order by created_at asc
   for update skip locked
   limit 1;
  if not found then return; end if;

  update public.hiring_practical_test_jobs
     set state = 'dispatching',
         claim_token = gen_random_uuid(),
         claimed_at = now(),
         send_authorized_at = null,
         attempt_count = attempt_count + 1,
         failure_code = null
   where id = v_job.id
   returning * into v_job;
  return query select v_job.id, v_job.claim_token, v_job.application_id, v_job.recipient_email,
                      v_job.subject, v_job.body, v_job.raw_footage_url, v_job.reference_edit_url;
end;
$$;

create or replace function public.hiring_authorize_practical_test_send_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns table(
  authorized boolean,
  application_id uuid,
  recipient_email text,
  subject text,
  body text,
  raw_footage_url text,
  reference_edit_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hiring_practical_test_jobs%rowtype;
  v_enabled boolean := false;
begin
  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_practical_tests_enabled'
   for share;

  select * into v_job
    from public.hiring_practical_test_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  if v_job.state <> 'dispatching' or v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = 'P0001', message = 'claim_conflict';
  end if;
  if v_job.send_authorized_at is not null
     and (v_job.claimed_at is null or v_job.send_authorized_at >= v_job.claimed_at) then
    raise exception using errcode = 'P0001', message = 'send_already_authorized';
  end if;

  if not coalesce(v_enabled, false) then
    update public.hiring_practical_test_jobs
       set state = 'queued',
           claim_token = null,
           claimed_at = null,
           send_authorized_at = null
     where id = v_job.id;
    return query select false, null::uuid, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  update public.hiring_practical_test_jobs
     set send_authorized_at = now()
   where id = v_job.id
   returning * into v_job;

  return query select true, v_job.application_id, v_job.recipient_email, v_job.subject,
                      v_job.body, v_job.raw_footage_url, v_job.reference_edit_url;
end;
$$;

create or replace function public.hiring_record_practical_test_result_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_result text,
  p_provider_message_id text default null,
  p_failure_code text default null
)
returns table(application_id uuid, job_state text, application_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hiring_practical_test_jobs%rowtype;
  v_result text := lower(btrim(coalesce(p_result, '')));
  v_provider_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_failure_code text := nullif(btrim(coalesce(p_failure_code, '')), '');
  v_application public.hiring_applications%rowtype;
begin
  if v_result not in ('sent', 'failed', 'delivery_uncertain') then
    raise exception using errcode = 'P0001', message = 'invalid_result';
  end if;
  if v_result = 'sent' and v_provider_message_id is null then
    raise exception using errcode = 'P0001', message = 'missing_provider_receipt';
  end if;
  if v_result = 'sent' and v_failure_code is not null then
    raise exception using errcode = 'P0001', message = 'invalid_failure_code';
  end if;
  if v_result <> 'sent' and v_provider_message_id is not null then
    raise exception using errcode = 'P0001', message = 'invalid_provider_receipt';
  end if;
  if v_result = 'failed' and coalesce(v_failure_code, '') not in (
    'pre_send_provider_unavailable', 'pre_send_configuration'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_failure_code';
  end if;
  if v_result = 'delivery_uncertain' and coalesce(v_failure_code, '') not in (
    'provider_timeout', 'provider_ambiguous'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_failure_code';
  end if;
  select * into v_job
    from public.hiring_practical_test_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  if v_job.state <> 'dispatching' or v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = 'P0001', message = 'claim_conflict';
  end if;

  update public.hiring_practical_test_jobs
     set state = v_result,
         sent_at = case when v_result = 'sent' then now() else null end,
         provider_message_id = v_provider_message_id,
         failure_code = v_failure_code,
         claim_token = null
   where id = v_job.id
   returning * into v_job;

  select * into v_application
    from public.hiring_applications
   where id = v_job.application_id
   for update;
  if v_result = 'sent' then
    insert into public.hiring_application_events (application_id, event_type, metadata)
    values (v_application.id, 'practical_test_sent', jsonb_build_object('job_id', v_job.id));
  elsif v_result = 'failed' then
    insert into public.hiring_application_events (application_id, event_type, metadata)
    values (v_application.id, 'practical_test_failed', jsonb_build_object('job_id', v_job.id, 'failure_code', v_job.failure_code));
  elsif v_result = 'delivery_uncertain' then
    insert into public.hiring_application_events (application_id, event_type, metadata)
    values (v_application.id, 'practical_test_delivery_uncertain', jsonb_build_object('job_id', v_job.id, 'failure_code', v_job.failure_code));
  end if;

  return query select v_job.application_id, v_job.state, v_application.status;
end;
$$;

create or replace function public.hiring_retry_failed_practical_test_v1(
  p_application_id uuid,
  p_expected_state_version bigint,
  p_actor text
)
returns table(job_id uuid, job_state text, state_version bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.hiring_applications%rowtype;
  v_job public.hiring_practical_test_jobs%rowtype;
  v_actor text := btrim(coalesce(p_actor, ''));
  v_previous_failure text;
  v_enabled boolean := false;
begin
  if v_actor = '' then
    raise exception using errcode = 'P0001', message = 'invalid_actor';
  end if;
  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_practical_tests_enabled';
  if not coalesce(v_enabled, false) then
    raise exception using errcode = 'P0001', message = 'feature_disabled';
  end if;

  select * into v_application
    from public.hiring_applications
   where id = p_application_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_not_found';
  end if;
  if v_application.state_version <> p_expected_state_version then
    raise exception using errcode = 'P0001', message = 'state_conflict';
  end if;
  if v_application.status in ('rejected', 'withdrawn', 'invited', 'interview_booked') then
    raise exception using errcode = 'P0001', message = 'terminal_status';
  end if;

  select * into v_job
    from public.hiring_practical_test_jobs
   where application_id = v_application.id
   for update;
  if not found
     or v_job.state <> 'failed'
     or v_job.provider_message_id is not null
     or coalesce(v_job.failure_code, '') not in ('pre_send_provider_unavailable', 'pre_send_configuration') then
    raise exception using errcode = 'P0001', message = 'retry_not_available';
  end if;
  if lower(v_job.recipient_email) <> lower(v_application.email) then
    raise exception using errcode = 'P0001', message = 'recipient_conflict';
  end if;

  v_previous_failure := v_job.failure_code;
  update public.hiring_practical_test_jobs
     set state = 'queued',
         claim_token = null,
         claimed_at = null,
         send_authorized_at = null,
         sent_at = null,
         provider_message_id = null,
         failure_code = null
   where id = v_job.id
   returning * into v_job;
  update public.hiring_applications as a
     set state_version = a.state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where a.id = v_application.id
   returning * into v_application;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (
    v_application.id,
    'practical_test_requeued',
    v_actor,
    jsonb_build_object('job_id', v_job.id, 'previous_failure_code', v_previous_failure)
  );

  return query select v_job.id, v_job.state, v_application.state_version;
end;
$$;

-- A verdict may be recorded only after the practical-test email was actually
-- delivered, mirroring the "provider receipt before state change" posture
-- used everywhere else in this sidecar. A pass unblocks the round-3 interview
-- invite gate above; a non-pass moves the application to the existing
-- 'rejected' terminal status without sending anything.
create or replace function public.hiring_set_practical_test_verdict_v1(
  p_application_id uuid,
  p_expected_state_version bigint,
  p_verdict text,
  p_actor text
)
returns table(application_id uuid, status text, state_version bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.hiring_applications%rowtype;
  v_job public.hiring_practical_test_jobs%rowtype;
  v_verdict text := lower(btrim(coalesce(p_verdict, '')));
  v_actor text := btrim(coalesce(p_actor, ''));
begin
  if v_actor = '' then
    raise exception using errcode = 'P0001', message = 'invalid_actor';
  end if;
  if v_verdict not in ('passed', 'not_selected') then
    raise exception using errcode = 'P0001', message = 'invalid_verdict';
  end if;

  select * into v_application
    from public.hiring_applications
   where id = p_application_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_not_found';
  end if;
  if v_application.role_slug <> 'video-editor' then
    raise exception using errcode = 'P0001', message = 'wrong_role';
  end if;
  if v_application.state_version <> p_expected_state_version then
    raise exception using errcode = 'P0001', message = 'state_conflict';
  end if;

  select * into v_job
    from public.hiring_practical_test_jobs as j
   where j.application_id = v_application.id
   for update;
  if not found or v_job.state <> 'sent' then
    raise exception using errcode = 'P0001', message = 'practical_test_not_delivered';
  end if;

  update public.hiring_applications as a
     set practical_test_verdict = v_verdict,
         status = case when v_verdict = 'not_selected' then 'rejected' else a.status end,
         state_version = a.state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where a.id = v_application.id
   returning * into v_application;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (v_application.id, 'practical_test_verdict_set', v_actor, jsonb_build_object('verdict', v_verdict));

  return query select v_application.id, v_application.status, v_application.state_version;
end;
$$;

revoke all on function public.hiring_queue_practical_test_v1(uuid, bigint, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.hiring_claim_next_practical_test_v1(text) from public, anon, authenticated;
revoke all on function public.hiring_authorize_practical_test_send_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.hiring_record_practical_test_result_v1(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.hiring_retry_failed_practical_test_v1(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.hiring_set_practical_test_verdict_v1(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.hiring_queue_practical_test_v1(uuid, bigint, text, text, text, text, text, text) to service_role;
grant execute on function public.hiring_claim_next_practical_test_v1(text) to service_role;
grant execute on function public.hiring_authorize_practical_test_send_v1(uuid, uuid) to service_role;
grant execute on function public.hiring_record_practical_test_result_v1(uuid, uuid, text, text, text) to service_role;
grant execute on function public.hiring_retry_failed_practical_test_v1(uuid, bigint, text) to service_role;
grant execute on function public.hiring_set_practical_test_verdict_v1(uuid, bigint, text, text) to service_role;

commit;
