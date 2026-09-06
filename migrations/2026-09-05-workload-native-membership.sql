-- Additive, manually installed prerequisites for the versioned staff Workload
-- reader. No stored plan IDs are rewritten, no flags change, no provider calls.
-- The existing native view and complete Workload-label projection are required.
begin;

create function public.workload_native_snapshot_v1()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $fn$
declare v_authority jsonb; v_rows jsonb; v_plans jsonb; v_count integer;
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
        'updated_at',d.updated_at,'workload_labels_complete',pv.workload_labels_complete,
        'workload_labels',pv.workload_labels) else null end) as row
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
        'native_plan_id',n.id,'native_plan_client_name',n.client_name)
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
    'legacy_teams',coalesce((select jsonb_agg(distinct r->>'team_key')
      from jsonb_array_elements(v_rows) r where r->>'source'='legacy'),'[]'::jsonb));
end;
$fn$;
revoke all on function public.workload_native_snapshot_v1() from public,anon,authenticated;
grant execute on function public.workload_native_snapshot_v1() to service_role;

-- A native ID or a retained provider UUID may identify the same owner. This
-- read refuses ambiguity; the plan writer below resolves it again under locks.
create function public.workload_native_plan_target_v1(p_issue_id text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $fn$
declare v_rows jsonb; v_authority jsonb;
begin
  select value into strict v_authority from public.syncview_runtime_flags where key='prod_authority';
  if coalesce(v_authority->>'video','') not in ('syncview','linear')
    or coalesce(v_authority->>'graphics','') not in ('syncview','linear') then
    raise exception using errcode='55000',message='workload_authority_unavailable';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'linear_id',n.linear_id,
    'client_slug',n.client_slug,'client_name',n.client_name,'active',n.active,
    'is_sub_issue',n.is_sub_issue,'authority',v_authority->>(case n.team_key when 'VID' then 'video' when 'GRA' then 'graphics' end),
    'provider_client_name',(select w.client_name from public.workload_issues w
      where w.id=n.linear_id and w.active is true and w.is_sub_issue is true))),'[]'::jsonb) into v_rows
    from public.workload_issues_native_v1 n where n.is_sub_issue
      and (n.id=p_issue_id or n.linear_id=p_issue_id);
  if jsonb_array_length(v_rows)>1 then
    raise exception using errcode='55000',message='workload_plan_alias_ambiguous';
  end if;
  return v_rows->0;
end;
$fn$;
revoke all on function public.workload_native_plan_target_v1(text) from public,anon,authenticated;
grant execute on function public.workload_native_plan_target_v1(text) to service_role;

create function public.workload_native_plan_set_v1(
  p_native_id text,p_client_slug text,p_client text,p_plan_date date,p_actor text,
  p_provider_client_name text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare v_del public.deliverables%rowtype; v_batch public.batches%rowtype;
  v_client public.clients%rowtype; v_keys text[]; v_key text;
  v_plan public.workload_plan%rowtype; v_count integer; v_authority jsonb;
begin
  -- Serialize old-ID and native-ID writes on the same real owner. No new
  -- crosswalk table, rename, delete, migration or provider validation is needed.
  select * into strict v_del from public.deliverables where id=p_native_id for update;
  select * into strict v_batch from public.batches where id=v_del.batch_id for share;
  select * into strict v_client from public.clients where slug=v_del.client_slug for share;
  select value into strict v_authority from public.syncview_runtime_flags where key='prod_authority' for share;
  if coalesce(v_authority->>v_del.team,'') not in ('syncview','linear') then
    raise exception using errcode='55000',message='workload_authority_unavailable';
  end if;
  if v_authority->>v_del.team='linear' then
    perform 1 from public.workload_issues w where w.id=v_del.linear_issue_uuid
      and w.active is true and w.is_sub_issue is true
      and w.client_name=p_provider_client_name for share;
    if not found then
      raise exception using errcode='55000',message='provider_plan_owner_unavailable';
    end if;
  end if;
  if v_del.client_slug is distinct from p_client_slug or v_client.active is not true
    or v_batch.status='archived' or coalesce(p_client,'') !~ '^[a-z0-9&]+$'
    or coalesce(btrim(p_actor),'')='' or not exists (
      select 1 from public.workload_issues_native_v1 n
       where n.id=p_native_id and n.is_sub_issue and n.active) then
    raise exception using errcode='55000',message='issue_not_writable';
  end if;
  -- A UUID may not be reused by a second native owner, even outside the current
  -- active board. Unproven historic alias ownership must remain a refusal.
  if v_del.linear_issue_uuid is not null and exists (
    select 1 from public.deliverables d where d.id<>v_del.id
      and (d.linear_issue_uuid=v_del.linear_issue_uuid or d.id=v_del.linear_issue_uuid)) then
    raise exception using errcode='55000',message='workload_plan_alias_ambiguous';
  end if;
  v_keys:=array_remove(array[v_del.id,v_del.linear_issue_uuid],null);
  perform 1 from public.workload_plan where issue_id=any(v_keys) for update;
  select count(*) into v_count from public.workload_plan where issue_id=any(v_keys);
  if v_count>1 then
    raise exception using errcode='55000',message='workload_plan_alias_conflict';
  end if;
  select * into v_plan from public.workload_plan where issue_id=any(v_keys);
  if found and v_plan.client<>p_client then
    raise exception using errcode='55000',message='workload_plan_scope_conflict';
  end if;
  v_key:=coalesce(v_plan.issue_id,case when v_authority->>v_del.team='linear'
    then v_del.linear_issue_uuid else v_del.id end);
  insert into public.workload_plan(issue_id,client,plan_date,updated_by,updated_at)
    values(v_key,p_client,p_plan_date,p_actor,clock_timestamp())
    on conflict(issue_id) do update set plan_date=excluded.plan_date,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at
    returning * into v_plan;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'updated',v_count,'plan',jsonb_build_object(
    'issue_id',v_del.id,'storage_issue_id',v_plan.issue_id,'client',v_plan.client,
    'plan_date',v_plan.plan_date,'updated_at',v_plan.updated_at));
end;
$fn$;
revoke all on function public.workload_native_plan_set_v1(text,text,text,date,text,text) from public,anon,authenticated;
grant execute on function public.workload_native_plan_set_v1(text,text,text,date,text,text) to service_role;
commit;
