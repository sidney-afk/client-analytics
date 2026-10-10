-- ============================================================
-- 2026-10-10 — PTO Member setup leaves a record (OPEN_REPAIRS 399).
--
-- NOT APPLIED. Source-only until the owner applies it in the Supabase SQL
-- editor and a value-free readback is appended to EXECUTION_LOG.md.
--
-- WHY. The admin Member setup form (Kasper > Time Off) saves a member's PTO
-- start date and the "PTO enabled" switch through the pto Edge Function's
-- set_start_date action. Until now that went through pto_set_member_start_v1,
-- which overwrote pto_members in place: no actor, no prior value, no event.
-- The start date drives eligibility, the tenure bucket and therefore every
-- wellness grant and cap; switching PTO off zeroes the member's balances and
-- refuses their requests. A change to either moved balances with no trace,
-- against cross-tier invariant 3 in docs/QUALITY_TIERS.md ("HR/balance/
-- approval values never change without an audit trail").
--
-- WHAT.
--   1. public.pto_member_events: one row per Member setup save that created a
--      PTO profile or actually changed the start date or the enabled switch.
--      Who (the verified caller's roster name), before, after, when.
--      Append-only.
--   2. public.pto_set_member_start_v2(...same four..., p_actor text): v1's
--      checks unchanged (active roster row lock, profile lock, state_version
--      compare, history conflict). It refuses a blank actor and writes the
--      event row in the SAME transaction as the profile write, so a profile
--      change without its record cannot commit.
--   3. pto_set_member_start_v1 stays in place for the deploy window: the live
--      function calls it until the new pto function is deployed. After that
--      deploy, apply 2026-10-10-pto-member-setup-audit-step2-revoke-v1.sql so
--      nothing can still write a start date without a record.
--
-- ACCESS. RLS on, no policies. Every privilege on the table and its identity
-- sequence is revoked from all four roles (public, anon, authenticated,
-- service_role); then service_role alone gets SELECT. No role gets INSERT,
-- UPDATE, DELETE or TRUNCATE: the only writer is pto_set_member_start_v2,
-- which runs as its owner (SECURITY DEFINER, like v1), so nobody can forge,
-- edit or remove a row through the API. The identity column needs no
-- sequence privilege. v2 EXECUTE is revoked from all four roles and granted
-- to service_role only. test/pto-member-setup-audit.js measures every role on
-- a disposable PostgreSQL.
--
-- No HR rows, member ids, dates or flags are written here. Idempotent: safe
-- to run twice. Needs 2026-07-15-pto-tracker.sql (applied 2026-07-15).
-- ============================================================
begin;

do $pto_member_setup_audit_needs$
begin
  if to_regclass('public.pto_members') is null
     or to_regclass('public.pto_requests') is null
     or to_regclass('public.pto_adjustments') is null then
    raise exception 'pto_member_setup_audit needs migrations/2026-07-15-pto-tracker.sql applied first';
  end if;
end
$pto_member_setup_audit_needs$;

create table if not exists public.pto_member_events (
  id                bigint generated always as identity primary key,
  member_id         uuid not null references public.team_members (id),
  actor             text not null check (btrim(actor) <> ''),
  before_start_date date,
  before_enabled    boolean,
  after_start_date  date not null,
  after_enabled     boolean not null,
  at                timestamptz not null default now()
);
create index if not exists pto_member_events_member_idx
  on public.pto_member_events (member_id, at desc);

comment on table public.pto_member_events is
  'Append-only record of PTO Member setup: who created a PTO profile or changed its start date or enabled switch, the values before (null on first setup) and after, and when. Written only by pto_set_member_start_v2.';

create or replace function public.pto_set_member_start_v2(
  p_member_id uuid,
  p_start_date date,
  p_enabled boolean,
  p_expected_state_version bigint,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_member public.pto_members%rowtype;
  v_upserted public.pto_members%rowtype;
  v_has_history boolean;
  v_existed boolean;
  v_actor text := btrim(coalesce(p_actor, ''));
begin
  -- No record without a name on it: refuse before any lock or write.
  if v_actor = '' then
    raise exception 'pto_member_setup_actor_required' using errcode = '22023';
  end if;

  -- From here to the upsert this is pto_set_member_start_v1 unchanged.
  -- The stable roster row exists even before first-time PTO setup, so it
  -- serializes two expected-null setup calls and concurrent history inserts.
  perform 1
  from public.team_members
  where id = p_member_id
    and active is true
  for update;
  if not found then return jsonb_build_object('status', 'member_not_found'); end if;

  -- With no row, v_member stays all null; those nulls are the "before" values
  -- of a first-time setup.
  select * into v_member
  from public.pto_members
  where member_id = p_member_id
  for update;
  v_existed := found;

  if v_existed then
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

  -- The record, in the same transaction: a new profile, or a real change to
  -- the start date or the switch. A save that changes neither writes nothing.
  if not v_existed
     or v_member.pto_start_date is distinct from v_upserted.pto_start_date
     or v_member.pto_enabled is distinct from v_upserted.pto_enabled then
    insert into public.pto_member_events (
      member_id, actor,
      before_start_date, before_enabled,
      after_start_date, after_enabled
    ) values (
      p_member_id, left(v_actor, 200),
      v_member.pto_start_date, v_member.pto_enabled,
      v_upserted.pto_start_date, v_upserted.pto_enabled
    );
  end if;

  return jsonb_build_object('status', 'ok', 'member', to_jsonb(v_upserted));
end;
$fn$;

comment on function public.pto_set_member_start_v2(uuid, date, boolean, bigint, text) is
  'PTO Member setup with a record: pto_set_member_start_v1''s checks, plus one pto_member_events row (actor, before, after) in the same transaction when a profile is created or its start date or enabled switch changes. Refuses a blank actor.';

-- ---------- Access: RLS on, everything revoked, then the minimum ----------
alter table public.pto_member_events enable row level security;
revoke all on table public.pto_member_events from public, anon, authenticated, service_role;
grant select on table public.pto_member_events to service_role;

do $pto_member_events_seqs$
declare s text;
begin
  for s in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_depend d on d.objid = c.oid and d.deptype = 'i'
    where c.relkind = 'S' and n.nspname = 'public'
      and d.refobjid = 'public.pto_member_events'::regclass
  loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
  end loop;
end
$pto_member_events_seqs$;

revoke all on function public.pto_set_member_start_v2(uuid, date, boolean, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.pto_set_member_start_v2(uuid, date, boolean, bigint, text)
  to service_role;

commit;

-- READBACK (expect: events_table set, rls true, policies 0; anon, authenticated
-- and public false everywhere; service_role select true and every write false;
-- v2 execute true for service_role only; v1 still true for service_role until
-- step 2):
-- select to_regclass('public.pto_member_events') events_table,
--   (select relrowsecurity from pg_class where oid = 'public.pto_member_events'::regclass) rls,
--   (select count(*) from pg_policy where polrelid = 'public.pto_member_events'::regclass) policies,
--   has_table_privilege('anon', 'public.pto_member_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_any,
--   has_table_privilege('authenticated', 'public.pto_member_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') auth_any,
--   has_table_privilege('service_role', 'public.pto_member_events', 'SELECT') sr_select,
--   has_table_privilege('service_role', 'public.pto_member_events', 'INSERT,UPDATE,DELETE,TRUNCATE') sr_write,
--   has_function_privilege('anon', 'public.pto_set_member_start_v2(uuid,date,boolean,bigint,text)', 'EXECUTE') anon_v2,
--   has_function_privilege('authenticated', 'public.pto_set_member_start_v2(uuid,date,boolean,bigint,text)', 'EXECUTE') auth_v2,
--   has_function_privilege('service_role', 'public.pto_set_member_start_v2(uuid,date,boolean,bigint,text)', 'EXECUTE') sr_v2,
--   has_function_privilege('service_role', 'public.pto_set_member_start_v1(uuid,date,boolean,bigint)', 'EXECUTE') sr_v1,
--   exists (select 1 from aclexplode((select proacl from pg_proc where oid = 'public.pto_set_member_start_v2(uuid,date,boolean,bigint,text)'::regprocedure))
--     where grantee = 0) public_v2;

-- ROLLBACK. Keep public.pto_member_events: it is the record, and dropping it
-- deletes who changed what. To go back to the old behaviour:
--   1. redeploy the previous pto function (it calls v1; the new one calls v2);
--   2. if step 2 was applied, give v1 back to the function:
--        grant execute on function public.pto_set_member_start_v1(uuid, date, boolean, bigint) to service_role;
--   3. optionally remove the new function:
--        drop function if exists public.pto_set_member_start_v2(uuid, date, boolean, bigint, text);
