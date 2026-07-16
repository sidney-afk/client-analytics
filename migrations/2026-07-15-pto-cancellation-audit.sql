-- PTO cancellation attribution + transactional request/setup/approval hardening.
--
-- Source-only until a value-free apply/readback entry is recorded in
-- EXECUTION_LOG.md. This delta is additive and does not alter pto_v1, member
-- rows, leave balances, or existing approval decisions. In addition to the
-- cancellation columns, it installs service-role-only request creation and
-- member setup RPCs that serialize on the stable team member row, plus an
-- approval finalizer that blocks approval after roster deactivation.

begin;

do $pto_cancellation_audit$
begin
  -- Alphabetic replay can encounter this same-day delta before the base PTO
  -- file. The idempotent base definition also includes these columns, so a
  -- fresh reconstruction may safely skip this delta until the table exists.
  if to_regclass('public.pto_requests') is null then
    raise notice 'pto_requests is not present; base PTO migration will create cancellation audit columns';
    return;
  end if;

  execute 'alter table public.pto_requests
    add column if not exists cancelled_by text,
    add column if not exists cancelled_at timestamptz';
  execute $sql$comment on column public.pto_requests.cancelled_by is
    'Verified staff attribution for cancellation; kept separate from the original approval/denial actor.'$sql$;
  execute $sql$comment on column public.pto_requests.cancelled_at is
    'Cancellation timestamp; kept separate from the original approval/denial timestamp.'$sql$;

  -- Reassert the table boundary so applying this standalone delta cannot widen
  -- browser access even if surrounding role defaults have drifted.
  execute 'alter table public.pto_requests enable row level security';
  execute 'revoke all on table public.pto_requests from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.pto_requests to service_role';

  -- Install the transactional request/setup pair alongside the audit columns.
  -- Dynamic DDL lets an alphabetic fresh replay safely skip this same-day
  -- delta when the idempotent base migration has not created the tables yet.
  execute $ddl_request$
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
    as $fn$
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
    $fn$;
  $ddl_request$;

  execute $ddl_start$
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
    as $fn$
    declare
      v_member public.pto_members%rowtype;
      v_upserted public.pto_members%rowtype;
      v_has_history boolean;
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
    $fn$;
  $ddl_start$;

  execute $ddl_finalize$
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
    as $fn$
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
    $fn$;
  $ddl_finalize$;

  execute 'revoke all on function public.pto_create_request_v1(uuid, text, date, date, numeric, text, text, bigint) from public, anon, authenticated';
  execute 'revoke all on function public.pto_set_member_start_v1(uuid, date, boolean, bigint) from public, anon, authenticated';
  execute 'revoke all on function public.pto_finalize_decision_v1(uuid, text, text, text, bigint) from public, anon, authenticated';
  execute 'grant execute on function public.pto_create_request_v1(uuid, text, date, date, numeric, text, text, bigint) to service_role';
  execute 'grant execute on function public.pto_set_member_start_v1(uuid, date, boolean, bigint) to service_role';
  execute 'grant execute on function public.pto_finalize_decision_v1(uuid, text, text, text, bigint) to service_role';
end
$pto_cancellation_audit$;

commit;
