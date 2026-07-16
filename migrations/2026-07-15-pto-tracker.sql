-- PTO / Time Off tracker.
--
-- Additive, idempotent schema delta for project uzltbbrjidmjwwfakwve.
-- Apply manually in the Supabase SQL editor. The feature is seeded dark; its
-- one-step behavior kill is to keep pto_v1 at {"mode":"off"}.
--
-- PTO data is private HR data. Every table below is service-role-only: there
-- are deliberately no anon or authenticated RLS policies and no realtime
-- publication entries. Browser reads and writes must use the pto Edge Function.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pto_members (
  member_id uuid primary key references public.team_members(id),
  pto_start_date date not null,
  pto_enabled boolean not null default false,
  state_version bigint not null default 0 check (state_version >= 0),
  updated_at timestamptz not null default now()
);

alter table public.pto_members
  add column if not exists state_version bigint not null default 0;

create table if not exists public.pto_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members(id),
  type text not null
    check (type in ('wellness', 'sick', 'floating_holiday', 'unpaid')),
  start_date date not null,
  end_date date not null,
  days numeric(4,1) not null
    check (days > 0 and days * 2 = trunc(days * 2)),
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'cancelled')),
  decided_by text,
  decision_note text not null default '',
  source text not null default 'syncview'
    check (source in ('syncview', 'hrvey_migration')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  check (end_date >= start_date)
);

create index if not exists pto_requests_member_idx
  on public.pto_requests (member_id, status);

create index if not exists pto_requests_dates_idx
  on public.pto_requests (start_date, end_date);

create table if not exists public.pto_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members(id),
  kind text not null check (kind in ('wellness', 'sick')),
  delta numeric(4,1) not null
    check (delta <> 0 and delta * 2 = trunc(delta * 2)),
  effective_date date not null,
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists pto_adjustments_member_idx
  on public.pto_adjustments (member_id);

-- Pending already reserves the once-per-calendar-year floating allowance.
-- Fail generically rather than deleting or printing any conflicting HR rows.
do $$
begin
  if exists (
    select 1
    from public.pto_requests
    where type = 'floating_holiday'
      and status in ('pending', 'approved')
    group by member_id, extract(year from start_date)
    having count(*) > 1
  ) then
    raise exception 'PTO migration blocked: duplicate live floating-holiday rows require private owner review';
  end if;
end $$;

create unique index if not exists pto_requests_one_live_floating_per_year
  on public.pto_requests (member_id, (extract(year from start_date)::integer))
  where type = 'floating_holiday'
    and status in ('pending', 'approved');

-- Every balance-affecting write advances a per-member version. Approval uses
-- that monotonic version as an optimistic transaction boundary so two distinct
-- requests cannot both approve against the same balance snapshot.
create or replace function public.pto_bump_member_state_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id uuid;
begin
  v_member_id := case when tg_op = 'DELETE' then old.member_id else new.member_id end;
  update public.pto_members
  set state_version = state_version + 1
  where member_id = v_member_id;

  if tg_op = 'UPDATE' then
    if old.member_id is distinct from new.member_id then
      update public.pto_members
      set state_version = state_version + 1
      where member_id = old.member_id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.pto_bump_own_state_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.pto_start_date is distinct from new.pto_start_date
     or old.pto_enabled is distinct from new.pto_enabled then
    new.state_version := old.state_version + 1;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'pto_requests_bump_member_state' and tgrelid = 'public.pto_requests'::regclass) then
    create trigger pto_requests_bump_member_state
      after insert or update or delete on public.pto_requests
      for each row execute function public.pto_bump_member_state_version();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pto_adjustments_bump_member_state' and tgrelid = 'public.pto_adjustments'::regclass) then
    create trigger pto_adjustments_bump_member_state
      after insert or update or delete on public.pto_adjustments
      for each row execute function public.pto_bump_member_state_version();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pto_members_bump_own_state' and tgrelid = 'public.pto_members'::regclass) then
    create trigger pto_members_bump_own_state
      before update of pto_start_date, pto_enabled on public.pto_members
      for each row execute function public.pto_bump_own_state_version();
  end if;
end $$;

create or replace function public.pto_decision_snapshot_v1(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.pto_requests%rowtype;
  v_member public.pto_members%rowtype;
  v_requests jsonb;
  v_adjustments jsonb;
begin
  select * into v_request
  from public.pto_requests
  where id = p_request_id
  for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into v_member
  from public.pto_members
  where member_id = v_request.member_id
  for update;
  if not found then return jsonb_build_object('status', 'member_not_found'); end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.requested_at, r.id), '[]'::jsonb)
  into v_requests
  from public.pto_requests r
  where r.member_id = v_request.member_id;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
  into v_adjustments
  from public.pto_adjustments a
  where a.member_id = v_request.member_id;

  return jsonb_build_object(
    'status', 'ok',
    'request', to_jsonb(v_request),
    'member', to_jsonb(v_member),
    'requests', v_requests,
    'adjustments', v_adjustments,
    'state_version', v_member.state_version
  );
end;
$$;

create or replace function public.pto_finalize_decision_v1(
  p_request_id uuid,
  p_decision text,
  p_decision_note text,
  p_actor text,
  p_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.pto_requests%rowtype;
  v_member public.pto_members%rowtype;
  v_updated public.pto_requests%rowtype;
begin
  if p_decision not in ('approved', 'denied') then
    return jsonb_build_object('status', 'invalid_decision');
  end if;

  select * into v_request
  from public.pto_requests
  where id = p_request_id
  for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_decision = 'approved' then
    perform 1
    from public.team_members
    where id = v_request.member_id
      and active is true
    for update;
    if not found then return jsonb_build_object('status', 'member_inactive'); end if;
  end if;
  select * into v_member
  from public.pto_members
  where member_id = v_request.member_id
  for update;
  if not found then return jsonb_build_object('status', 'member_not_found'); end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('status', 'request_not_pending');
  end if;
  if v_member.state_version <> p_expected_state_version then
    return jsonb_build_object('status', 'stale');
  end if;

  update public.pto_requests
  set status = p_decision,
      decided_by = p_actor,
      decision_note = coalesce(p_decision_note, ''),
      decided_at = now()
  where id = p_request_id
    and status = 'pending'
  returning * into v_updated;

  if not found then return jsonb_build_object('status', 'request_not_pending'); end if;
  return jsonb_build_object('status', 'ok', 'request', to_jsonb(v_updated));
end;
$$;

-- Request creation and start-date setup share the same locked profile row and
-- optimistic state version. This closes the race where a start date could be
-- changed after request validation but immediately before its insert.
create or replace function public.pto_create_request_v1(
  p_member_id uuid,
  p_type text,
  p_start_date date,
  p_end_date date,
  p_days numeric,
  p_note text,
  p_source text,
  p_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.pto_members%rowtype;
  v_inserted public.pto_requests%rowtype;
begin
  perform 1
  from public.team_members
  where id = p_member_id
    and active is true
  for update;
  if not found then return jsonb_build_object('status', 'member_not_found'); end if;

  select * into v_member
  from public.pto_members
  where member_id = p_member_id
  for update;
  if not found then return jsonb_build_object('status', 'member_not_found'); end if;
  if not v_member.pto_enabled then return jsonb_build_object('status', 'not_enabled'); end if;
  if v_member.state_version <> p_expected_state_version then
    return jsonb_build_object('status', 'stale');
  end if;

  insert into public.pto_requests (
    member_id, type, start_date, end_date, days, note, source
  ) values (
    p_member_id, p_type, p_start_date, p_end_date, p_days,
    coalesce(p_note, ''), p_source
  )
  returning * into v_inserted;

  return jsonb_build_object('status', 'ok', 'request', to_jsonb(v_inserted));
exception
  when unique_violation then
    if p_type = 'floating_holiday' then
      return jsonb_build_object('status', 'floating_holiday_used');
    end if;
    raise;
end;
$$;

create or replace function public.pto_set_member_start_v1(
  p_member_id uuid,
  p_start_date date,
  p_enabled boolean,
  p_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.pto_members%rowtype;
  v_upserted public.pto_members%rowtype;
  v_has_history boolean;
begin
  -- The stable roster row exists even before first-time PTO setup, so it
  -- serializes two expected-null setup calls and concurrent history inserts.
  perform 1
  from public.team_members
  where id = p_member_id
    and active is true
  for update;
  if not found then return jsonb_build_object('status', 'member_not_found'); end if;

  select * into v_member
  from public.pto_members
  where member_id = p_member_id
  for update;

  if found then
    if p_expected_state_version is null or v_member.state_version <> p_expected_state_version then
      return jsonb_build_object('status', 'stale');
    end if;
  elsif p_expected_state_version is not null then
    return jsonb_build_object('status', 'stale');
  end if;

  select exists (
    select 1 from public.pto_requests where member_id = p_member_id
    union all
    select 1 from public.pto_adjustments where member_id = p_member_id
  ) into v_has_history;

  if v_has_history and (v_member.member_id is null or v_member.pto_start_date <> p_start_date) then
    return jsonb_build_object('status', 'history_conflict');
  end if;

  insert into public.pto_members (
    member_id, pto_start_date, pto_enabled, updated_at
  ) values (
    p_member_id, p_start_date, p_enabled, now()
  )
  on conflict (member_id) do update
  set pto_start_date = excluded.pto_start_date,
      pto_enabled = excluded.pto_enabled,
      updated_at = excluded.updated_at
  returning * into v_upserted;

  return jsonb_build_object('status', 'ok', 'member', to_jsonb(v_upserted));
end;
$$;

alter table public.pto_members enable row level security;
alter table public.pto_requests enable row level security;
alter table public.pto_adjustments enable row level security;

revoke all on table public.pto_members from public, anon, authenticated;
revoke all on table public.pto_requests from public, anon, authenticated;
revoke all on table public.pto_adjustments from public, anon, authenticated;

grant select, insert, update, delete on table public.pto_members to service_role;
grant select, insert, update, delete on table public.pto_requests to service_role;
grant select, insert, update, delete on table public.pto_adjustments to service_role;

revoke all on function public.pto_bump_member_state_version() from public, anon, authenticated;
revoke all on function public.pto_bump_own_state_version() from public, anon, authenticated;
revoke all on function public.pto_decision_snapshot_v1(uuid) from public, anon, authenticated;
revoke all on function public.pto_finalize_decision_v1(uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.pto_create_request_v1(uuid, text, date, date, numeric, text, text, bigint) from public, anon, authenticated;
revoke all on function public.pto_set_member_start_v1(uuid, date, boolean, bigint) from public, anon, authenticated;
grant execute on function public.pto_decision_snapshot_v1(uuid) to service_role;
grant execute on function public.pto_finalize_decision_v1(uuid, text, text, text, bigint) to service_role;
grant execute on function public.pto_create_request_v1(uuid, text, date, date, numeric, text, text, bigint) to service_role;
grant execute on function public.pto_set_member_start_v1(uuid, date, boolean, bigint) to service_role;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('pto_v1', '{"mode":"off"}'::jsonb, 'migration')
on conflict (key) do nothing;
