-- Corrective release gate for the already-installed Hiring Process sidecar.
--
-- A queued/claimed job is not permission to call Gmail. The private n8n
-- dispatcher must obtain this single-use, claim-token-scoped authorization
-- immediately before its provider node. It is intentionally separate from
-- browser/staff actions and leaves all delivery disabled until the runtime
-- flag is deliberately set to the exact JSON boolean true.

begin;

alter table public.hiring_invite_jobs
  add column if not exists send_authorized_at timestamptz;

comment on column public.hiring_invite_jobs.send_authorized_at is
  'Single-use claim-scoped authorization timestamp written immediately before the external email provider call.';

create or replace function public.hiring_require_invite_send_authorization()
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

drop trigger if exists hiring_invite_jobs_require_send_auth on public.hiring_invite_jobs;
create trigger hiring_invite_jobs_require_send_auth
before update on public.hiring_invite_jobs
for each row execute function public.hiring_require_invite_send_authorization();

create or replace function public.hiring_authorize_invite_send_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns table(
  authorized boolean,
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
  v_enabled boolean := false;
begin
  -- Lock the one-step flag before the job so an explicit disable cannot pass
  -- unnoticed during the authorization transaction.
  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled'
   for share;

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
  if v_job.send_authorized_at is not null
     and (v_job.claimed_at is null or v_job.send_authorized_at >= v_job.claimed_at) then
    raise exception using errcode = 'P0001', message = 'send_already_authorized';
  end if;

  if not coalesce(v_enabled, false) then
    -- No provider call is authorized. Returning the job to queued lets the
    -- dispatcher resume only after an explicit later re-enable.
    update public.hiring_invite_jobs
       set state = 'queued',
           claim_token = null,
           claimed_at = null,
           send_authorized_at = null
     where id = v_job.id;
    return query select false, null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;

  update public.hiring_invite_jobs
     set send_authorized_at = now()
   where id = v_job.id
   returning * into v_job;

  return query select true, v_job.application_id, v_job.recipient_email, v_job.subject,
                      v_job.body, v_job.interview_event_url;
end;
$$;

revoke all on function public.hiring_authorize_invite_send_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.hiring_require_invite_send_authorization() from public, anon, authenticated;
grant execute on function public.hiring_authorize_invite_send_v1(uuid, uuid) to service_role;

commit;
