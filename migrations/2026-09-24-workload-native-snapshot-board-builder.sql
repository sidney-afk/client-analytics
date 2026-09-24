-- ============================================================
-- NOT APPLIED. Lighthouse reviews and applies; run
-- 2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql FIRST.
-- Rollback: 2026-09-24-workload-native-snapshot-board-builder.ROLLBACK.sql
-- ============================================================
-- Workload's cached snapshot builds only what the board draws.
--
-- MEASURED (read-only EXPLAIN ANALYZE, 2026-09-24 ~19:25Z): a cache rebuild
-- took ~2.6 s, 2.36 s of it in workload_native_snapshot_v1(), which builds
-- all 6,770 rows while workload-plan's boardSnapshot() (#1578) keeps ~2,200.
-- The label view production_deliverables_browser_v1 alone was ~0.55 s: it is
-- computed for every deliverable whatever the filter, so the new builder calls
-- production_workload_label_projection() per kept row instead.
--
-- 1. workload_native_snapshot_board_v1(): v1's population, predicates and
--    per-row JSON, restricted by boardSnapshot's keep-rule (see the KEEP-RULE
--    comment inside). Duplicate/blank-id refusal and legacy_teams still use
--    the whole population, exactly as v1.
-- 2. workload_native_snapshot_cached_v1() and _warm_v1() (the only two writers
--    of workload_snapshot_cache) call it instead of v1; nothing else changes.
--    v1, the `list` and `native_snapshot` actions, and slim_v1 are untouched,
--    and boardSnapshot() stays in the Edge Function as a second filter.
-- 3. Saved work days on closed cards drop out of plans_dropped (accepted,
--    Lighthouse 2026-09-24). Measured before/after on live data: 0 and 0.
-- 4. Marks the current copy stale so the warm job rebuilds it with this builder.
begin;

create or replace function public.workload_native_snapshot_board_v1()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $fn$
declare v_authority jsonb; v_rows jsonb; v_plans jsonb; v_roster jsonb; v_count integer;
  v_pop_count integer; v_pop_bad boolean; v_legacy_teams jsonb;
begin
  select value into strict v_authority from public.syncview_runtime_flags where key='prod_authority';
  if jsonb_typeof(v_authority) <> 'object'
     or coalesce(v_authority->>'video','') not in ('syncview','linear')
     or coalesce(v_authority->>'graphics','') not in ('syncview','linear') then
    raise exception using errcode='55000', message='workload_authority_unavailable';
  end if;
  -- Same population and predicates as workload_native_snapshot_v1(). Pass 1
  -- carries only the columns the keep-rule reads; JSON, labels and joins are
  -- built in pass 2 for kept rows only.
  with native_pop as materialized (
    select n as nrow, n.id, n.is_sub_issue, n.status_type, n.parent_id, d.id as d_id
    from public.workload_issues_native_v1 n
      left join public.deliverables d on n.is_sub_issue and d.id=n.id
    where n.active is true and (
      (n.is_sub_issue and v_authority->>d.team='syncview')
      or (not n.is_sub_issue and exists (
        select 1 from public.deliverables child where child.batch_id=n.id
          and v_authority->>child.team='syncview')))
  ), legacy_pop as materialized (
    -- parent_id read from the row's JSON, as boardSnapshot reads it.
    select w as wrow, w.id, w.is_sub_issue, w.status_type, to_jsonb(w)->>'parent_id' as parent_id,
           n.id as n_id, n.client_name as n_client_name
    from public.workload_issues w
      left join public.workload_issues_native_v1 n on n.is_sub_issue and n.linear_id=w.id
    where w.active is true and (
      coalesce(w.team_key,'') not in ('VID','GRA')
      or v_authority->>case w.team_key when 'VID' then 'video' when 'GRA' then 'graphics' end='linear')
  ), pop as (
    select 'native' as src, id, is_sub_issue, status_type, parent_id from native_pop
    union all
    select 'legacy', id, is_sub_issue, status_type, parent_id from legacy_pop
  -- KEEP-RULE: identical to boardSnapshot() in
  -- supabase/functions/workload-plan/native-snapshot.mjs. A sub-issue is kept
  -- unless its status_type (lower-cased, null as '') is completed, canceled,
  -- duplicate or triage; any other row is kept only when a kept sub-issue
  -- names it as parent_id. Change one, change both.
  ), open_subs as (
    select src, id, parent_id from pop
    where is_sub_issue is true
      and lower(coalesce(status_type,'')) not in ('completed','canceled','duplicate','triage')
  ), keep as (
    select distinct src, id from open_subs
    union
    select p.src, p.id from pop p
    where p.is_sub_issue is not true
      and p.id in (select o.parent_id from open_subs o where o.parent_id is not null)
  ), source_rows as (
    select to_jsonb(p.nrow) || jsonb_build_object(
      'source','native', 'native_client_active',c.active,
      'native_assignee_eligible',coalesce(tm.active and tm.team=d.team
        and tm.role=case d.team when 'video' then 'editor' when 'graphics' then 'designer' end,false),
      'native_metadata',case when p.is_sub_issue then jsonb_build_object(
        'id',d.id,'client_slug',d.client_slug,'team',d.team,'due_date',d.due_date,
        'updated_at',d.updated_at,
        'workload_labels_complete',case
          when public.workload_native_label_state_absent(d.linear_raw) then true
          else (lp.projection->>'complete')::boolean end,
        'workload_labels',case
          when public.workload_native_label_state_absent(d.linear_raw) then '[]'::jsonb
          else lp.projection->'labels' end) else null end) as row
    from native_pop p
      join keep k on k.src='native' and k.id=p.id
      left join public.deliverables d on d.id=p.d_id
      left join public.clients c on c.slug=(p.nrow).client_slug
      left join public.team_members tm on tm.id=d.assignee_id
      -- The label projection production_deliverables_browser_v1 computes, for
      -- this row only (the view computes it for every deliverable).
      left join lateral (select public.production_workload_label_projection(d.linear_raw) as projection
        where d.id is not null and not public.workload_native_label_state_absent(d.linear_raw)) lp on true
    union all
    select to_jsonb(p.wrow) || jsonb_build_object('source','legacy',
        'native_plan_id',p.n_id,'native_plan_client_name',p.n_client_name,
        'native_assignee_eligible',exists (select 1 from public.team_members lm
          where lm.active is true and lm.linear_user_id=(p.wrow).assignee_id and (
            ((p.wrow).team_key='VID' and lm.team='video' and lm.role='editor')
            or ((p.wrow).team_key='GRA' and lm.team='graphics' and lm.role='designer'))))
      from legacy_pop p
        join keep k on k.src='legacy' and k.id=p.id
  ) select (select coalesce(jsonb_agg(row order by row->>'id'),'[]'::jsonb) from source_rows),
           (select count(*) from source_rows),
           (select count(*) from pop),
           -- v1 refuses on a duplicate or blank id anywhere in the population,
           -- closed rows included; so does this.
           exists (select 1 from pop group by id having count(*)<>1 or coalesce(id,'')=''),
           coalesce((select jsonb_agg(distinct (p.wrow).team_key) from legacy_pop p),'[]'::jsonb)
    into v_rows, v_count, v_pop_count, v_pop_bad, v_legacy_teams;
  if v_pop_count>50000 or v_pop_bad or exists (select 1 from jsonb_array_elements(v_rows) r
    group by r->>'id' having count(*)<>1 or coalesce(r->>'id','')='') then
    raise exception using errcode='55000', message='workload_population_incomplete';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',coalesce(tm.linear_user_id,tm.id::text),'native_id',tm.id::text,
    'name',tm.name,'team',tm.team)
    order by tm.team,tm.name,tm.id),'[]'::jsonb)
    into v_roster from public.team_members tm
    where tm.active is true and coalesce(btrim(tm.name),'')<>'' and (
      (tm.team='video' and tm.role='editor')
      or (tm.team='graphics' and tm.role='designer'));
  if jsonb_array_length(v_roster)>1000 then
    raise exception using errcode='55000', message='workload_roster_list_limit';
  end if;
  -- Every stored plan, as v1. A plan whose card is closed no longer has its
  -- owner row here, so it is neither re-keyed nor counted in plans_dropped
  -- (Lighthouse, 2026-09-24).
  select coalesce(jsonb_agg(jsonb_build_object('issue_id',p.issue_id,'client',p.client,
    'plan_date',p.plan_date,'updated_at',p.updated_at) order by p.issue_id),'[]'::jsonb)
    into v_plans from public.workload_plan p;
  if jsonb_array_length(v_plans)>50000 then
    raise exception using errcode='55000', message='workload_plan_list_limit';
  end if;
  -- legacy_teams is taken from the whole legacy population, as v1 does, so
  -- dropping a closed legacy row never changes it.
  return jsonb_build_object('ok',true,'contract','workload-native-snapshot-v1',
    'complete',true,'count',v_count,'authority',v_authority,'rows',v_rows,'plans',v_plans,
    'roster',v_roster,'legacy_teams',v_legacy_teams);
end;
$fn$;
revoke all on function public.workload_native_snapshot_board_v1() from public, anon, authenticated, service_role;

create or replace function public.workload_native_snapshot_cached_v1(p_if_version text default null)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public as $fn$
declare
  v_version text; v_valid boolean; v_body jsonb; v_snap pg_snapshot;
begin
  for attempt in 1..2 loop
    select c.version,
           not exists (select 1 from public.workload_snapshot_invalidation i
                       where not pg_visible_in_snapshot(i.xid, c.built_snapshot))
      into v_version, v_valid
      from public.workload_snapshot_cache c;
    if v_valid then
      if p_if_version is not null and p_if_version = v_version then
        return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_version,
                                  'contract', 'workload-native-snapshot-v2');
      end if;
      select c.body || jsonb_build_object('version', c.version)
        into v_body from public.workload_snapshot_cache c;
      return v_body;
    end if;
    exit when attempt = 2;
    perform pg_advisory_xact_lock(hashtext('workload_native_snapshot_cache'));
  end loop;

  select pg_current_snapshot(), public.workload_native_snapshot_slim_v1(public.workload_native_snapshot_board_v1())
    into v_snap, v_body;
  v_version := md5(v_body::text);
  insert into public.workload_snapshot_cache as c (singleton, version, built_snapshot, built_at, body)
    values (true, v_version, v_snap, now(), v_body)
    on conflict (singleton) do update
      set version = excluded.version, built_snapshot = excluded.built_snapshot,
          built_at = excluded.built_at, body = excluded.body;
  delete from public.workload_snapshot_invalidation i where pg_visible_in_snapshot(i.xid, v_snap);
  if p_if_version is not null and p_if_version = v_version then
    return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_version,
                              'contract', 'workload-native-snapshot-v2');
  end if;
  return v_body || jsonb_build_object('version', v_version);
end;
$fn$;
revoke all on function public.workload_native_snapshot_cached_v1(text) from public, anon, authenticated, service_role;
grant execute on function public.workload_native_snapshot_cached_v1(text) to service_role;

create or replace function public.workload_native_snapshot_warm_v1()
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public as $fn$
declare
  v_valid boolean; v_body jsonb; v_snap pg_snapshot; v_version text;
  v_started timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('workload_native_snapshot_cache')) then
    return jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'busy');
  end if;
  select not exists (select 1 from public.workload_snapshot_invalidation i
                     where not pg_visible_in_snapshot(i.xid, c.built_snapshot))
    into v_valid from public.workload_snapshot_cache c;
  if v_valid then
    return jsonb_build_object('ok', true, 'rebuilt', false, 'reason', 'fresh');
  end if;
  -- One statement: the body and the snapshot it was read under.
  select pg_current_snapshot(), public.workload_native_snapshot_slim_v1(public.workload_native_snapshot_board_v1())
    into v_snap, v_body;
  v_version := md5(v_body::text);
  insert into public.workload_snapshot_cache as c (singleton, version, built_snapshot, built_at, body)
    values (true, v_version, v_snap, now(), v_body)
    on conflict (singleton) do update
      set version = excluded.version, built_snapshot = excluded.built_snapshot,
          built_at = excluded.built_at, body = excluded.body;
  delete from public.workload_snapshot_invalidation i where pg_visible_in_snapshot(i.xid, v_snap);
  return jsonb_build_object('ok', true, 'rebuilt', true, 'version', v_version,
    'ms', round(extract(epoch from clock_timestamp() - v_started) * 1000));
end;
$fn$;
revoke all on function public.workload_native_snapshot_warm_v1() from public, anon, authenticated, service_role;
grant execute on function public.workload_native_snapshot_warm_v1() to service_role;

-- The stored copy was built by the other builder; mark it stale so the
-- 10-second warm job rebuilds it with the builder now in force.
insert into public.workload_snapshot_invalidation(xid)
  values (pg_current_xact_id()) on conflict (xid) do nothing;

commit;
