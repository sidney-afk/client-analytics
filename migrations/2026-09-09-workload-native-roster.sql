-- Replace Workload's browser-maintained capacity roster with the active,
-- exact-role creative roster returned inside the authenticated native snapshot.
-- No data, runtime flags, provider state, grants or public table reads change.
begin;

create or replace function public.workload_native_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $fn$
declare v_authority jsonb; v_rows jsonb; v_plans jsonb; v_roster jsonb; v_count integer;
begin
  select value into strict v_authority from public.syncview_runtime_flags where key='prod_authority';
  if jsonb_typeof(v_authority) <> 'object'
     or coalesce(v_authority->>'video','') not in ('syncview','linear')
     or coalesce(v_authority->>'graphics','') not in ('syncview','linear') then
    raise exception using errcode='55000', message='workload_authority_unavailable';
  end if;
  -- STABLE RPC: all relations below are read under the same calling snapshot.
  -- A source cap cannot produce complete:true for a partial population.
  with source_rows as (
    select to_jsonb(n) || jsonb_build_object(
      'source','native', 'native_client_active',c.active,
      'native_assignee_eligible',coalesce(tm.active and tm.team=d.team
        and tm.role=case d.team when 'video' then 'editor' when 'graphics' then 'designer' end,false),
      'native_metadata',case when n.is_sub_issue then jsonb_build_object(
        'id',d.id,'client_slug',d.client_slug,'team',d.team,'due_date',d.due_date,
        'updated_at',d.updated_at,
        'workload_labels_complete',case
          when public.workload_native_label_state_absent(d.linear_raw) then true
          else pv.workload_labels_complete end,
        'workload_labels',case
          when public.workload_native_label_state_absent(d.linear_raw) then '[]'::jsonb
          else pv.workload_labels end) else null end) as row
    from public.workload_issues_native_v1 n
      left join public.deliverables d on n.is_sub_issue and d.id=n.id
      left join public.clients c on c.slug=n.client_slug
      left join public.team_members tm on tm.id=d.assignee_id
      left join public.production_deliverables_browser_v1 pv on pv.id=d.id
    where n.active is true and (
      (n.is_sub_issue and v_authority->>d.team='syncview')
      or (not n.is_sub_issue and exists (
        select 1 from public.deliverables child where child.batch_id=n.id
          and v_authority->>child.team='syncview')))
    union all
    select to_jsonb(w) || jsonb_build_object('source','legacy',
        'native_plan_id',n.id,'native_plan_client_name',n.client_name,
        'native_assignee_eligible',exists (select 1 from public.team_members lm
          where lm.active is true and lm.linear_user_id=w.assignee_id and (
            (w.team_key='VID' and lm.team='video' and lm.role='editor')
            or (w.team_key='GRA' and lm.team='graphics' and lm.role='designer'))))
      from public.workload_issues w
      left join public.workload_issues_native_v1 n on n.is_sub_issue and n.linear_id=w.id
      where w.active is true and (
        coalesce(w.team_key,'') not in ('VID','GRA')
        or v_authority->>case w.team_key when 'VID' then 'video' when 'GRA' then 'graphics' end='linear')
  ) select coalesce(jsonb_agg(row order by row->>'id'),'[]'::jsonb),count(*)
    into v_rows,v_count from source_rows;
  if v_count>50000 or exists (select 1 from jsonb_array_elements(v_rows) r
    group by r->>'id' having count(*)<>1 or coalesce(r->>'id','')='') then
    raise exception using errcode='55000', message='workload_population_incomplete';
  end if;
  -- The same authenticated statement snapshot carries the complete creative
  -- roster. Exact role/team predicates prevent managers or cross-team members
  -- from becoming capacity cards, and native member UUIDs match native rows.
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
  -- Every stored sidecar row is retained, including plans whose work has since
  -- completed. Alias resolution never invents a native owner from a title/name.
  select coalesce(jsonb_agg(jsonb_build_object('issue_id',p.issue_id,'client',p.client,
    'plan_date',p.plan_date,'updated_at',p.updated_at) order by p.issue_id),'[]'::jsonb)
    into v_plans from public.workload_plan p;
  if jsonb_array_length(v_plans)>50000 then
    raise exception using errcode='55000', message='workload_plan_list_limit';
  end if;
  return jsonb_build_object('ok',true,'contract','workload-native-snapshot-v1',
    'complete',true,'count',v_count,'authority',v_authority,'rows',v_rows,'plans',v_plans,
    'roster',v_roster,
    'legacy_teams',coalesce((select jsonb_agg(distinct r->>'team_key')
      from jsonb_array_elements(v_rows) r where r->>'source'='legacy'),'[]'::jsonb));
end;
$fn$;

commit;
