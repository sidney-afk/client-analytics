-- Corrective delta for the hiring interview-booking RPC.
-- The function returns a column named `status`, so its source-row status must
-- remain relation-qualified inside PL/pgSQL.
begin;

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

revoke all on function public.hiring_record_interview_booking_v1(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.hiring_record_interview_booking_v1(text, text, text, timestamptz) to service_role;

commit;
