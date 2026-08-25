-- Correct ambiguous column references in hiring routines whose RETURNS TABLE
-- output names shadow mutable table columns. In PL/pgSQL those output names
-- are variables, so unqualified expressions can fail at runtime.
begin;

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

  update public.hiring_applications as a
     set status = v_status,
         state_version = a.state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where a.id = v_application.id
   returning * into v_application;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (v_application.id, 'status_changed', v_actor, jsonb_build_object('status', v_status));

  return query select v_application.id, v_application.status, v_application.state_version;
end;
$$;

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
  select value = '{"enabled": true}'::jsonb
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
    'invite_requeued',
    v_actor,
    jsonb_build_object('job_id', v_job.id, 'previous_failure_code', v_previous_failure)
  );

  return query select v_job.id, v_job.state, v_application.state_version;
end;
$$;

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

  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled';
  if not coalesce(v_enabled, false) then
    return;
  end if;

  with stale as (
    update public.hiring_invite_jobs as j
       set state = 'delivery_uncertain',
           claim_token = null,
           failure_code = 'dispatch_timeout'
     where j.state = 'dispatching'
       and coalesce(j.claimed_at, j.created_at) < now() - interval '30 minutes'
     returning j.id, j.application_id
  )
  insert into public.hiring_application_events (application_id, event_type, metadata)
  select s.application_id, 'invite_delivery_uncertain', jsonb_build_object('job_id', s.id, 'failure_code', 'dispatch_timeout')
    from stale s;

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
         send_authorized_at = null,
         attempt_count = attempt_count + 1,
         failure_code = null
   where id = v_job.id
   returning * into v_job;
  return query select v_job.id, v_job.claim_token, v_job.application_id, v_job.recipient_email,
                      v_job.subject, v_job.body, v_job.interview_event_url;
end;
$$;

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

revoke all on function public.hiring_set_application_status_v1(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.hiring_retry_failed_invite_v1(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.hiring_claim_next_invite_v1(text) from public, anon, authenticated;
revoke all on function public.hiring_record_interview_booking_v1(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.hiring_set_application_status_v1(uuid, bigint, text, text) to service_role;
grant execute on function public.hiring_retry_failed_invite_v1(uuid, bigint, text) to service_role;
grant execute on function public.hiring_claim_next_invite_v1(text) to service_role;
grant execute on function public.hiring_record_interview_booking_v1(text, text, text, timestamptz) to service_role;

commit;
