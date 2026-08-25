-- Hiring application review sidecar.
--
-- iClosed remains the applicant-facing form and scheduler. These tables are a
-- private operational mirror used only by the staff-authenticated Hiring
-- Process surface and dedicated hiring automations. They intentionally do not
-- reuse sales_intakes, sales webhooks, or any public browser write path.
--
-- This source delta is deliberately default-off: it creates no application
-- rows, sends no email, and enables no automation. `hiring_invites_enabled`
-- stays false until a separately approved release has captured the current
-- iClosed payload, chosen the sender/reply mailbox, and passed a synthetic
-- end-to-end test.

begin;

create table if not exists public.hiring_applications (
  id uuid primary key default gen_random_uuid(),
  source_event_slug text not null
    check (source_event_slug = 'client-success-content-manager-application'),
  source_contact_id text not null
    check (btrim(source_contact_id) <> ''),
  source_submission_key text,
  name text not null
    check (btrim(name) <> ''),
  email text not null
    check (position('@' in email) > 1),
  location text,
  when_can_start text,
  answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(answers) in ('array', 'object')),
  video_url text,
  iclosed_preview_url text,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'hold', 'rejected', 'invited', 'interview_booked', 'withdrawn')),
  state_version bigint not null default 1
    check (state_version > 0),
  submitted_at timestamptz not null,
  source_updated_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  interview_booking_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_event_slug, source_contact_id)
);

comment on table public.hiring_applications is
  'Private iClosed application mirror for the Client Success and Content Manager hiring workflow. Browser roles have no direct access.';
comment on column public.hiring_applications.answers is
  'Full structured application answers, received only by the dedicated server-side hiring capture path.';
comment on column public.hiring_applications.source_contact_id is
  'Stable iClosed contact identifier used to deduplicate repeated application-status deliveries.';
comment on column public.hiring_applications.state_version is
  'Server-side compare-and-set version for reviewer actions. A stale browser may never overwrite a later decision.';

create index if not exists hiring_applications_status_submitted_idx
  on public.hiring_applications (status, submitted_at desc);
create index if not exists hiring_applications_email_idx
  on public.hiring_applications (lower(email));

create table if not exists public.hiring_invite_jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.hiring_applications(id) on delete restrict,
  recipient_email text not null
    check (position('@' in recipient_email) > 1),
  subject text not null
    check (btrim(subject) <> ''),
  body text not null
    check (btrim(body) <> ''),
  interview_event_url text not null
    check (interview_event_url ~ '^https://app[.]iclosed[.]io/e/synchrosocial/client-success-content-manager-interview/?$'),
  state text not null default 'queued'
    check (state in ('queued', 'dispatching', 'sent', 'failed', 'delivery_uncertain')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  failure_code text,
  requested_by text not null
    check (btrim(requested_by) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hiring_invite_jobs is
  'One durable interview-invitation job per application. A job is claimed before email delivery so double clicks and retries cannot send a duplicate.';

create index if not exists hiring_invite_jobs_dispatch_idx
  on public.hiring_invite_jobs (state, created_at)
  where state in ('queued', 'dispatching');

create table if not exists public.hiring_application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.hiring_applications(id) on delete restrict,
  event_type text not null
    check (event_type in (
      'received', 'refreshed', 'status_changed', 'invite_queued', 'invite_requeued',
      'invite_sent', 'invite_failed', 'invite_delivery_uncertain', 'interview_booked'
    )),
  actor text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.hiring_application_events is
  'Private minimal audit history. Full answers, email bodies, video URLs, and event URLs are never copied into this table.';

create index if not exists hiring_application_events_application_created_idx
  on public.hiring_application_events (application_id, created_at desc);

create or replace function public.hiring_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists hiring_applications_touch_updated_at on public.hiring_applications;
create trigger hiring_applications_touch_updated_at
before update on public.hiring_applications
for each row execute function public.hiring_touch_updated_at();

drop trigger if exists hiring_invite_jobs_touch_updated_at on public.hiring_invite_jobs;
create trigger hiring_invite_jobs_touch_updated_at
before update on public.hiring_invite_jobs
for each row execute function public.hiring_touch_updated_at();

alter table public.hiring_applications enable row level security;
alter table public.hiring_invite_jobs enable row level security;
alter table public.hiring_application_events enable row level security;

revoke all on table public.hiring_applications from public, anon, authenticated;
revoke all on table public.hiring_invite_jobs from public, anon, authenticated;
revoke all on table public.hiring_application_events from public, anon, authenticated;
grant select, insert, update on table public.hiring_applications to service_role;
grant select, insert, update on table public.hiring_invite_jobs to service_role;
grant select, insert on table public.hiring_application_events to service_role;
grant usage, select on sequence public.hiring_application_events_id_seq to service_role;
revoke delete, truncate, references, trigger on table public.hiring_applications from service_role;
revoke delete, truncate, references, trigger on table public.hiring_invite_jobs from service_role;
revoke delete, truncate, references, trigger on table public.hiring_application_events from service_role;

-- One-step outbound kill switch. A pre-existing value is never silently
-- preserved: it could be an accidentally enabled or malformed live flag. The
-- migration instead stops before adding anything, so the owner must inspect
-- and explicitly resolve that prior state.
do $$
declare
  v_existing jsonb;
begin
  select value into v_existing
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled'
   for update;

  if found then
    if v_existing is distinct from '{"enabled": false}'::jsonb then
      raise exception using errcode = 'P0001', message = 'hiring_flag_preexisting';
    end if;
  else
    insert into public.syncview_runtime_flags (key, value, updated_by)
    values ('hiring_invites_enabled', '{"enabled": false}'::jsonb, 'migration-hiring-applications');
  end if;
end;
$$;

-- Server-side capture from the isolated iClosed application-status workflow.
-- Repeated status deliveries update the original source snapshot but return
-- created=false, so downstream notifications run only once.
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
  v_contact_id text := btrim(coalesce(p_source_contact_id, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_answers jsonb := coalesce(p_answers, '[]'::jsonb);
  v_video_url text := btrim(coalesce(p_video_url, ''));
begin
  if v_slug <> 'client-success-content-manager-application' then
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
    source_event_slug, source_contact_id, source_submission_key, name, email,
    location, when_can_start, answers, video_url, iclosed_preview_url,
    submitted_at, source_updated_at
  ) values (
    v_slug, v_contact_id, nullif(btrim(coalesce(p_source_submission_key, '')), ''), v_name, v_email,
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

    -- Status webhooks can be partial and can arrive out of order. Only a
    -- complete, strictly newer source snapshot may alter an application, and
    -- never after an invitation job exists (whose recipient/body must remain
    -- frozen for exactly-once delivery).
    if p_source_updated_at is not null
       and (v_existing.source_updated_at is null or p_source_updated_at > v_existing.source_updated_at)
       and not exists (
         select 1 from public.hiring_invite_jobs j
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
      insert into public.hiring_application_events (application_id, event_type, metadata)
      values (v_existing.id, 'refreshed', jsonb_build_object('source_event_slug', v_slug));
    end if;
  end if;

  return query
    select a.id, v_created, a.status
      from public.hiring_applications a
     where a.id = v_id;
end;
$$;

-- Reviewer state changes are atomic and version-checked. Invited and booked
-- applications are immutable through this operation so a stale browser cannot
-- erase a delivery or booking outcome.
create or replace function public.hiring_set_application_status_v1(
  p_application_id uuid,
  p_expected_state_version bigint,
  p_status text,
  p_actor text
)
returns table(application_id uuid, status text, state_version bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.hiring_applications%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_actor text := btrim(coalesce(p_actor, ''));
begin
  if v_status not in ('reviewing', 'hold', 'rejected') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  if v_actor = '' then
    raise exception using errcode = 'P0001', message = 'invalid_actor';
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
  if v_application.status in ('rejected', 'invited', 'interview_booked', 'withdrawn') then
    raise exception using errcode = 'P0001', message = 'terminal_status';
  end if;
  if exists (
    select 1
      from public.hiring_invite_jobs j
     where j.application_id = v_application.id
       and j.state in ('queued', 'dispatching', 'delivery_uncertain')
  ) then
    raise exception using errcode = 'P0001', message = 'invite_pending';
  end if;

  update public.hiring_applications
     set status = v_status,
         state_version = state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where id = v_application.id
   returning * into v_application;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (v_application.id, 'status_changed', v_actor, jsonb_build_object('status', v_status));

  return query select v_application.id, v_application.status, v_application.state_version;
end;
$$;

-- Queue, but never claim a message has been sent. A separate dispatcher must
-- claim this job and return an actual provider receipt before status changes to
-- invited.
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
begin
  select coalesce(value ->> 'enabled', 'false') = 'true'
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
  if lower(btrim(coalesce(p_recipient_email, ''))) <> lower(v_application.email) then
    raise exception using errcode = 'P0001', message = 'recipient_conflict';
  end if;
  if btrim(coalesce(p_interview_event_url, ''))
       <> 'https://app.iclosed.io/e/synchrosocial/client-success-content-manager-interview' then
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

-- A dispatcher claims exactly one job at a time. The opaque token is required
-- to record the result, so a late worker can never overwrite a later attempt.
create or replace function public.hiring_claim_next_invite_v1(p_worker_id text)
returns table(
  job_id uuid,
  claim_token uuid,
  application_id uuid,
  recipient_email text,
  subject text,
  body text,
  interview_event_url text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hiring_invite_jobs%rowtype;
  v_worker text := btrim(coalesce(p_worker_id, ''));
  v_enabled boolean := false;
begin
  if v_worker = '' then
    raise exception using errcode = 'P0001', message = 'invalid_worker';
  end if;

  -- The kill switch is checked both when a reviewer queues a job and again
  -- when a dispatcher claims it. Turning it off therefore also stops jobs
  -- that were queued earlier but have not reached the provider yet.
  select coalesce(value ->> 'enabled', 'false') = 'true'
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled';
  if not coalesce(v_enabled, false) then
    return;
  end if;

  -- A worker that disappeared after claiming a job may have reached the mail
  -- provider. It is never retried automatically: preserve it as uncertain
  -- until an administrator confirms the outcome.
  with stale as (
    update public.hiring_invite_jobs
       set state = 'delivery_uncertain',
           claim_token = null,
           failure_code = 'dispatch_timeout'
     where state = 'dispatching'
       and coalesce(claimed_at, created_at) < now() - interval '30 minutes'
     returning id, application_id
  )
  insert into public.hiring_application_events (application_id, event_type, metadata)
  select application_id, 'invite_delivery_uncertain', jsonb_build_object('job_id', id, 'failure_code', 'dispatch_timeout')
    from stale;

  select * into v_job
    from public.hiring_invite_jobs
   where state = 'queued'
   order by created_at asc
   for update skip locked
   limit 1;
  if not found then return; end if;

  update public.hiring_invite_jobs
     set state = 'dispatching',
         claim_token = gen_random_uuid(),
         claimed_at = now(),
         attempt_count = attempt_count + 1,
         failure_code = null
   where id = v_job.id
   returning * into v_job;
  return query select v_job.id, v_job.claim_token, v_job.application_id, v_job.recipient_email,
                      v_job.subject, v_job.body, v_job.interview_event_url;
end;
$$;

create or replace function public.hiring_record_invite_result_v1(
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
  v_job public.hiring_invite_jobs%rowtype;
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
    from public.hiring_invite_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  if v_job.state <> 'dispatching' or v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = 'P0001', message = 'claim_conflict';
  end if;

  update public.hiring_invite_jobs
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
    update public.hiring_applications
       set status = 'invited', state_version = state_version + 1
     where id = v_application.id
     returning * into v_application;
    insert into public.hiring_application_events (application_id, event_type, metadata)
    values (v_application.id, 'invite_sent', jsonb_build_object('job_id', v_job.id));
  elsif v_result = 'failed' then
    insert into public.hiring_application_events (application_id, event_type, metadata)
    values (v_application.id, 'invite_failed', jsonb_build_object('job_id', v_job.id, 'failure_code', v_job.failure_code));
  elsif v_result = 'delivery_uncertain' then
    insert into public.hiring_application_events (application_id, event_type, metadata)
    values (v_application.id, 'invite_delivery_uncertain', jsonb_build_object('job_id', v_job.id, 'failure_code', v_job.failure_code));
  end if;

  return query select v_job.application_id, v_job.state, v_application.status;
end;
$$;

-- A failed job is retried only after an administrator deliberately asks for
-- it, and only when the dispatcher proved it never reached the provider. A
-- timeout or any ambiguous delivery is intentionally not eligible here.
create or replace function public.hiring_retry_failed_invite_v1(
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
  v_job public.hiring_invite_jobs%rowtype;
  v_actor text := btrim(coalesce(p_actor, ''));
  v_previous_failure text;
  v_enabled boolean := false;
begin
  if v_actor = '' then
    raise exception using errcode = 'P0001', message = 'invalid_actor';
  end if;
  select coalesce(value ->> 'enabled', 'false') = 'true'
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled';
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
    from public.hiring_invite_jobs
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
  update public.hiring_invite_jobs
     set state = 'queued',
         claim_token = null,
         claimed_at = null,
         sent_at = null,
         provider_message_id = null,
         failure_code = null
   where id = v_job.id
   returning * into v_job;
  update public.hiring_applications
     set state_version = state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where id = v_application.id
   returning * into v_application;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (
    v_application.id,
    'invite_requeued',
    v_actor,
    jsonb_build_object('job_id', v_job.id, 'previous_failure_code', v_previous_failure)
  );

  return query select v_job.id, v_job.state, v_application.state_version;
end;
$$;

-- The interview-event webhook calls this after a genuine booking. It accepts
-- only the dedicated hiring event and idempotently records a booking against
-- the stable iClosed contact that submitted the original application.
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
  if lower(btrim(coalesce(p_source_event_slug, ''))) <> 'client-success-content-manager-interview' then
    raise exception using errcode = 'P0001', message = 'invalid_event';
  end if;
  if v_contact_id = '' or v_booking_id = '' then
    raise exception using errcode = 'P0001', message = 'invalid_booking';
  end if;

  select * into v_application
    from public.hiring_applications
   where source_contact_id = v_contact_id
     and status in ('invited', 'interview_booked')
   for update
   limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_not_found';
  end if;
  if v_application.interview_booking_id is not null and v_application.interview_booking_id <> v_booking_id then
    raise exception using errcode = 'P0001', message = 'booking_conflict';
  end if;

  update public.hiring_applications
     set status = 'interview_booked',
         interview_booking_id = v_booking_id,
         state_version = case when status = 'interview_booked' then state_version else state_version + 1 end
   where id = v_application.id
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

revoke all on function public.hiring_capture_application_v1(text, text, text, text, text, text, text, jsonb, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.hiring_set_application_status_v1(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.hiring_queue_interview_invite_v1(uuid, bigint, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.hiring_claim_next_invite_v1(text) from public, anon, authenticated;
revoke all on function public.hiring_record_invite_result_v1(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.hiring_retry_failed_invite_v1(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.hiring_record_interview_booking_v1(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.hiring_touch_updated_at() from public, anon, authenticated;
grant execute on function public.hiring_capture_application_v1(text, text, text, text, text, text, text, jsonb, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.hiring_set_application_status_v1(uuid, bigint, text, text) to service_role;
grant execute on function public.hiring_queue_interview_invite_v1(uuid, bigint, text, text, text, text, text) to service_role;
grant execute on function public.hiring_claim_next_invite_v1(text) to service_role;
grant execute on function public.hiring_record_invite_result_v1(uuid, uuid, text, text, text) to service_role;
grant execute on function public.hiring_retry_failed_invite_v1(uuid, bigint, text) to service_role;
grant execute on function public.hiring_record_interview_booking_v1(text, text, text, timestamptz) to service_role;

commit;
