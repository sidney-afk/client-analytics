-- G8 bounded Linear cutoff prerequisite: mirror_outbox dispatch lane only.
--
-- This additive primitive is INACTIVE by default. It does not change runtime
-- flags, F27 generations/authority, accepted native writers, n8n, inbound
-- webhooks, reconcilers, browser transports, credentials, or provider access.
-- The generation stamp, rather than sequence order alone, closes the race
-- between an accepted enqueue and cutoff activation. Rows accepted after an
-- active cutoff remain durable pending debt and are explicitly classified;
-- they are never rewritten as sent/skipped/terminal success.

begin;

create table if not exists public.linear_outbound_cutoff_control (
  lane text primary key check (lane = 'mirror_outbox'),
  generation bigint not null default 0 check (generation >= 0),
  cutoff_enabled boolean not null default false,
  high_water_id bigint,
  activated_at timestamptz,
  activated_by text,
  updated_at timestamptz not null default now(),
  check ((cutoff_enabled and activated_at is not null and activated_by is not null)
      or (not cutoff_enabled))
);

insert into public.linear_outbound_cutoff_control(lane)
values ('mirror_outbox') on conflict (lane) do nothing;

alter table public.mirror_outbox
  add column if not exists outbound_generation bigint not null default 0,
  add column if not exists cutoff_disposition text,
  add column if not exists dispatch_authorized_at timestamptz,
  add column if not exists dispatch_authorization uuid;

alter table public.mirror_outbox
  drop constraint if exists mirror_outbox_cutoff_disposition_check;
alter table public.mirror_outbox
  add constraint mirror_outbox_cutoff_disposition_check check (
    cutoff_disposition is null or cutoff_disposition in (
      'accepted_after_cutoff', 'claimed_before_cutoff', 'authorized_before_cutoff'
    )
  );

create or replace function public.linear_outbound_stamp_generation_v1()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_control public.linear_outbound_cutoff_control%rowtype;
begin
  select * into v_control from public.linear_outbound_cutoff_control
  where lane = 'mirror_outbox' for share;
  if not found then raise exception 'linear_cutoff_control_unavailable'; end if;
  new.outbound_generation := v_control.generation;
  if v_control.cutoff_enabled and new.status not in ('written', 'skipped') then
    new.cutoff_disposition := 'accepted_after_cutoff';
  else
    new.cutoff_disposition := null;
  end if;
  return new;
end $fn$;

drop trigger if exists linear_outbound_stamp_generation_v1 on public.mirror_outbox;
-- Run after the native receipt classifiers, which terminalize native-only
-- intents on INSERT. Their receipts are not outstanding provider debt.
create trigger zzzz_linear_outbound_stamp_generation_v1 before insert on public.mirror_outbox
for each row execute function public.linear_outbound_stamp_generation_v1();

-- Ordinary direct-table workers also acquire this shared control lock before
-- locking a queue row. Activation touches only the control row, so all worker
-- paths use one lock order without rewriting accepted queue history.
create function public.linear_outbound_control_lock_v1()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  perform 1 from public.linear_outbound_cutoff_control where lane='mirror_outbox' for share;
  if not found then raise exception 'linear_cutoff_control_unavailable'; end if;
  return null;
end $fn$;
create trigger linear_outbound_control_lock_v1 before insert or update on public.mirror_outbox
for each statement execute function public.linear_outbound_control_lock_v1();

-- Only this RPC may acquire a new worker lease. A missing control row, active
-- cutoff, generation mismatch, or stale candidate produces no claim.
create or replace function public.linear_outbound_claim_v1(
  p_id bigint, p_status text, p_lock_timeout_seconds integer default 600
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_control public.linear_outbound_cutoff_control%rowtype;
  v_row public.mirror_outbox%rowtype;
begin
  if p_lock_timeout_seconds < 1 or p_lock_timeout_seconds > 3600 then
    raise exception 'linear_cutoff_invalid_lock_timeout';
  end if;
  lock table public.mirror_outbox in row exclusive mode;
  select * into v_control from public.linear_outbound_cutoff_control
  where lane = 'mirror_outbox' for share;
  if not found then raise exception 'linear_cutoff_control_unavailable'; end if;
  if v_control.cutoff_enabled then return null; end if;

  update public.mirror_outbox o set
    lock_token = gen_random_uuid(), locked_at = now(), updated_at = now(),
    outbound_generation = v_control.generation,
    dispatch_authorized_at = null, dispatch_authorization = null
  where o.id = p_id and o.status = p_status
    and o.outbound_generation = v_control.generation
    and o.cutoff_disposition is null
    and (o.lock_token is null or o.locked_at < now() - make_interval(secs => p_lock_timeout_seconds))
  returning o.* into v_row;
  if not found then return null; end if;
  return to_jsonb(v_row);
end $fn$;

-- Called immediately before the provider mutation. Cutoff activation and this
-- authorization serialize on the singleton row. An authorization that wins
-- first is counted explicitly; one that loses cannot dispatch.
create or replace function public.linear_outbound_authorize_dispatch_v1(
  p_id bigint, p_lock_token uuid, p_generation bigint
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_control public.linear_outbound_cutoff_control%rowtype;
  v_auth uuid := gen_random_uuid();
  v_row public.mirror_outbox%rowtype;
begin
  lock table public.mirror_outbox in row exclusive mode;
  select * into v_control from public.linear_outbound_cutoff_control
  where lane = 'mirror_outbox' for share;
  if not found then raise exception 'linear_cutoff_control_unavailable'; end if;
  if v_control.cutoff_enabled or v_control.generation is distinct from p_generation then
    raise exception 'linear_cutoff_dispatch_refused';
  end if;
  update public.mirror_outbox o set
    dispatch_authorized_at = now(), dispatch_authorization = v_auth, updated_at = now()
  where o.id = p_id and o.lock_token = p_lock_token
    and o.outbound_generation = p_generation and o.cutoff_disposition is null
  returning o.* into v_row;
  if not found then raise exception 'linear_cutoff_stale_claim'; end if;
  return jsonb_build_object('authorized', true, 'authorization', v_auth,
    'generation', p_generation, 'outbox_id', p_id);
end $fn$;

-- Refuse delayed writes from a worker whose generation lost a cutoff race.
-- This protects the actual existing direct-table checkpoint/release paths.
create or replace function public.linear_outbound_stale_worker_guard_v1()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_control public.linear_outbound_cutoff_control%rowtype;
begin
  -- Also cover an old worker acquiring its first lease after cutoff. Looking
  -- only at OLD.lock_token misses exactly that ordinary update path.
  if old.lock_token is null and new.lock_token is null
    and new.locked_at is not distinct from old.locked_at
    and new.dispatch_authorization is not distinct from old.dispatch_authorization
    and new.dispatch_authorized_at is not distinct from old.dispatch_authorized_at
    and new.status is not distinct from old.status then return new; end if;
  select * into v_control from public.linear_outbound_cutoff_control
  where lane = 'mirror_outbox' for share;
  if not found then raise exception 'linear_cutoff_control_unavailable'; end if;
  if v_control.cutoff_enabled or old.outbound_generation is distinct from v_control.generation then
    raise exception 'linear_cutoff_stale_worker_refused';
  end if;
  return new;
end $fn$;

drop trigger if exists linear_outbound_stale_worker_guard_v1 on public.mirror_outbox;
create trigger linear_outbound_stale_worker_guard_v1 before update on public.mirror_outbox
for each row execute function public.linear_outbound_stale_worker_guard_v1();

-- Activation is intentionally service-only and requires an exact expected
-- generation. It does not delete, terminalize, unlock, or rewrite queue rows.
create or replace function public.linear_outbound_cutoff_activate_v1(
  p_expected_generation bigint, p_actor text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_control public.linear_outbound_cutoff_control%rowtype;
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null then raise exception 'linear_cutoff_actor_required'; end if;
  lock table public.mirror_outbox in access share mode;
  select * into v_control from public.linear_outbound_cutoff_control
  where lane = 'mirror_outbox' for update;
  if not found then raise exception 'linear_cutoff_control_unavailable'; end if;
  if v_control.cutoff_enabled or v_control.generation is distinct from p_expected_generation then
    raise exception 'linear_cutoff_generation_conflict';
  end if;
  update public.linear_outbound_cutoff_control set
    generation = generation + 1, cutoff_enabled = true,
    high_water_id = (select max(id) from public.mirror_outbox),
    activated_at = now(), activated_by = btrim(p_actor), updated_at = now()
  where lane = 'mirror_outbox' returning * into v_control;
  -- Debt disposition is a derived view of retained facts. Do not update queue
  -- rows here: doing so conflicts with existing F27/receipt retention guards.
  return jsonb_build_object('lane', v_control.lane, 'generation', v_control.generation,
    'high_water_id', v_control.high_water_id, 'cutoff_enabled', true);
end $fn$;

create function public.linear_outbound_cutoff_debt_rows_v1()
returns table(id bigint,status text,outbound_generation bigint,disposition text)
language plpgsql security definer set search_path=public as $fn$
declare c public.linear_outbound_cutoff_control%rowtype;
begin
  select * into c from public.linear_outbound_cutoff_control where lane='mirror_outbox';
  if not found then raise exception 'linear_cutoff_control_unavailable'; end if;
  return query select o.id, o.status, o.outbound_generation,
  case
    when o.status in ('written','skipped') then 'terminal_receipt'
    when not c.cutoff_enabled then 'cutoff_inactive'
    when o.outbound_generation=c.generation then 'accepted_after_cutoff'
    when o.dispatch_authorization is not null then 'authorized_before_cutoff'
    when o.lock_token is not null then 'claimed_before_cutoff'
    else 'unclaimed_before_cutoff'
  end as disposition
  from public.mirror_outbox o;
end $fn$;
create view public.linear_outbound_cutoff_debt_v1 with (security_invoker=true) as
select * from public.linear_outbound_cutoff_debt_rows_v1();

revoke all on table public.linear_outbound_cutoff_control from public, anon, authenticated, service_role;
grant select on table public.linear_outbound_cutoff_control to service_role;
revoke all on public.linear_outbound_cutoff_debt_v1 from public, anon, authenticated, service_role;
grant select on public.linear_outbound_cutoff_debt_v1 to service_role;
revoke all on function public.linear_outbound_cutoff_debt_rows_v1() from public, anon, authenticated, service_role;
grant execute on function public.linear_outbound_cutoff_debt_rows_v1() to service_role;
revoke all on function public.linear_outbound_claim_v1(bigint,text,integer) from public, anon, authenticated;
revoke all on function public.linear_outbound_authorize_dispatch_v1(bigint,uuid,bigint) from public, anon, authenticated;
revoke all on function public.linear_outbound_cutoff_activate_v1(bigint,text) from public, anon, authenticated;
grant execute on function public.linear_outbound_claim_v1(bigint,text,integer) to service_role;
grant execute on function public.linear_outbound_authorize_dispatch_v1(bigint,uuid,bigint) to service_role;
grant execute on function public.linear_outbound_cutoff_activate_v1(bigint,text) to service_role;

commit;
