-- ============================================================
-- VERIFY for 2026-09-24-workload-native-snapshot-board-builder.sql (NOT APPLIED).
-- Read-only in effect: creates the new builder inside a transaction, compares,
-- and ROLLS BACK. Nothing persists. Run before applying; expect 0 / 0 / 0.
-- The builder text below is byte-identical to the migration's (checked by
-- test/workload-board-builder-files.js).
-- ============================================================
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

-- 0 / 0 / 0 is the only passing answer; the block below raises otherwise. Row ids AND full row contents of the
-- new builder must equal boardSnapshot's keep-rule applied to v1's output,
-- and everything outside rows/count must be equal.
create temp table workload_board_verify on commit drop as
with v as (select public.workload_native_snapshot_v1() j),
     b as (select public.workload_native_snapshot_board_v1() j),
     r as (select e from v, jsonb_array_elements(v.j->'rows') e),
     o as (select e from r where e->'is_sub_issue' = 'true'::jsonb
             and lower(coalesce(e->>'status_type','')) not in ('completed','canceled','duplicate','triage')),
     want as (select e from o
              union all
              select e from r where e->'is_sub_issue' is distinct from 'true'::jsonb
                and e->>'id' in (select e->>'parent_id' from o where e->>'parent_id' is not null)),
     got as (select e from b, jsonb_array_elements(b.j->'rows') e)
select
  (select count(*) from ((select e->>'id' from want except all select e->>'id' from got)
                         union all (select e->>'id' from got except all select e->>'id' from want)) x) as id_differences,
  (select count(*) from ((select e from want except all select e from got)
                         union all (select e from got except all select e from want)) x) as row_content_differences,
  (select count(*) from v, b where (v.j - 'rows' - 'count') <> (b.j - 'rows' - 'count')
                               or (b.j->>'count')::int <> jsonb_array_length(b.j->'rows')) as envelope_differences,
  (select count(*) from r) as v1_rows, (select count(*) from got) as board_rows;
select * from workload_board_verify;
-- Fails loudly: a nonzero count aborts here, so no runner can read it as a pass.
do $verify$
declare v record;
begin
  select * into strict v from workload_board_verify;
  if v.id_differences <> 0 or v.row_content_differences <> 0 or v.envelope_differences <> 0 then
    raise exception 'workload_board_verify_failed: ids %, rows %, envelope %',
      v.id_differences, v.row_content_differences, v.envelope_differences;
  end if;
  raise notice 'workload_board_verify_passed: % v1 rows, % board rows', v.v1_rows, v.board_rows;
end;
$verify$;

rollback;
