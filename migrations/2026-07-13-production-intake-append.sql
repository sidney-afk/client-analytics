-- Write-UI epoch: atomic append-to-existing-batch intake.
--
-- Additive only. Runtime authority/outbound/parity flags are untouched. The
-- browser never receives RPC execute permission; production-write supplies the
-- authenticated rows/events after project and Linear-parent validation.

begin;

-- Canonical, exact team-parent extraction for the append RPC. Unlike the
-- outbound drainer's historical compatibility reader, this never falls back to
-- another team's first parent.
create or replace function public.production_batch_parent_ids_for_team(
  p_value jsonb,
  p_team text
) returns text[]
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_wanted text := case lower(btrim(coalesce(p_team, '')))
    when 'video' then 'video'
    when 'vid' then 'video'
    when 'graphics' then 'graphics'
    when 'graphic' then 'graphics'
    when 'gra' then 'graphics'
    else null
  end;
  v_key text;
  v_key_team text;
  v_entry jsonb;
  v_list jsonb;
  v_id text;
  v_ids text[] := array[]::text[];
begin
  if v_wanted is null or p_value is null then return v_ids; end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_entry in select key, value from jsonb_each(p_value)
    loop
      v_key_team := case lower(btrim(v_key))
        when 'video' then 'video'
        when 'vid' then 'video'
        when 'graphics' then 'graphics'
        when 'graphic' then 'graphics'
        when 'gra' then 'graphics'
        else null
      end;
      if v_key_team is distinct from v_wanted then continue; end if;
      if jsonb_typeof(v_entry) = 'string' then
        v_id := nullif(btrim(v_entry #>> '{}'), '');
        if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
      elsif jsonb_typeof(v_entry) = 'object' then
        for v_id in
          select nullif(btrim(value), '')
          from (values (v_entry->>'id'), (v_entry->>'uuid'), (v_entry->>'linear_issue_id')) ids(value)
        loop
          if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
        end loop;
      end if;
    end loop;

    v_key_team := case lower(btrim(coalesce(
      p_value->>'team', p_value->>'team_key', p_value->>'key', p_value->>'kind', ''
    )))
      when 'video' then 'video'
      when 'vid' then 'video'
      when 'graphics' then 'graphics'
      when 'graphic' then 'graphics'
      when 'gra' then 'graphics'
      else null
    end;
    if v_key_team = v_wanted then
      for v_id in
        select nullif(btrim(value), '')
        from (values (p_value->>'id'), (p_value->>'uuid'), (p_value->>'linear_issue_id')) ids(value)
      loop
        if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
      end loop;
    end if;
    v_list := p_value->'parents';
  elsif jsonb_typeof(p_value) = 'array' then
    v_list := p_value;
  end if;

  if jsonb_typeof(v_list) = 'array' then
    for v_entry in select value from jsonb_array_elements(v_list)
    loop
      if jsonb_typeof(v_entry) is distinct from 'object' then continue; end if;
      v_key_team := case lower(btrim(coalesce(
        v_entry->>'team', v_entry->>'team_key', v_entry->>'key', v_entry->>'kind', ''
      )))
        when 'video' then 'video'
        when 'vid' then 'video'
        when 'graphics' then 'graphics'
        when 'graphic' then 'graphics'
        when 'gra' then 'graphics'
        else null
      end;
      if v_key_team is distinct from v_wanted then continue; end if;
      for v_id in
        select nullif(btrim(value), '')
        from (values (v_entry->>'id'), (v_entry->>'uuid'), (v_entry->>'linear_issue_id')) ids(value)
      loop
        if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
      end loop;
    end loop;
  end if;

  select coalesce(array_agg(found.id order by found.id), array[]::text[])
    into v_ids
  from (select distinct unnest(v_ids) as id) found;
  return v_ids;
end;
$fn$;

revoke all on function public.production_batch_parent_ids_for_team(jsonb, text)
  from public, anon, authenticated;

create or replace function public.production_intake_append(
  p_batch_id text,
  p_expected_updated_at timestamptz,
  p_rows jsonb,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_batch public.batches%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_row jsonb;
  v_event jsonb;
  v_outbound jsonb;
  v_payload jsonb;
  v_count integer;
  v_index integer;
  v_team text;
  v_card_id text;
  v_parent_id text;
  v_dependency_parent_id text;
  v_parent_ids text[];
  v_dependency_id bigint;
  v_project_id text;
  v_replay boolean;
  v_replay_count integer := 0;
  v_terminal_dependency boolean := false;
  v_rows_out jsonb := '[]'::jsonb;
  v_base_sort numeric;
  v_base_ordinal integer;
  v_group record;
  v_group_index integer := 0;
  v_expected_sort numeric;
  v_expected_ordinal integer;
  v_first_event jsonb;
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or p_expected_updated_at is null
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid_intake_append_payload';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 2 or v_count > 100 or v_count <> jsonb_array_length(p_events) then
    raise exception 'invalid_intake_append_payload';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status is distinct from 'active' then raise exception 'batch_not_active'; end if;

  if (
    select count(distinct nullif(btrim(value->>'id'), ''))
    from jsonb_array_elements(p_rows)
  ) <> v_count then
    raise exception 'invalid_intake_append_payload';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    group by nullif(btrim(item->>'card_id'), '')
    having nullif(btrim(item->>'card_id'), '') is null
       or count(*) <> 2
       or count(*) filter (where item->>'team' = 'video') <> 1
       or count(*) filter (where item->>'team' = 'graphics') <> 1
  ) then
    raise exception 'invalid_intake_append_pair';
  end if;

  -- Validate the complete trusted plan and acquire every dedup lock before the
  -- first child write. An exact concurrent replay is recognized before CAS.
  for v_index in 0..v_count - 1
  loop
    v_row := p_rows->v_index;
    v_event := p_events->v_index;
    v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
    v_team := nullif(btrim(v_row->>'team'), '');
    v_card_id := nullif(btrim(v_row->>'card_id'), '');
    v_project_id := nullif(btrim(v_payload->>'project_id'), '');
    if nullif(btrim(v_row->>'id'), '') is null
       or v_row->>'batch_id' is distinct from v_batch.id
       or v_row->>'client_slug' is distinct from v_batch.client_slug
       or v_team is null
       or v_team not in ('video', 'graphics')
       or (v_batch.team is not null and v_team is distinct from v_batch.team)
       or v_card_id is null
       or v_row->>'origin' is distinct from 'calendar'
       or v_row->>'kind' is distinct from case when v_team = 'graphics' then 'thumbnail' else 'video' end
       or coalesce(v_row->>'_intake_ordinal', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_row->>'sort_key', '') !~ '^-?[0-9]+([.][0-9]+)?$'
       or v_event->>'source' is distinct from 'ui'
       or v_event->>'action' is distinct from 'create'
       or v_outbound->>'entity' is distinct from 'deliverable'
       or v_outbound->>'entity_id' is distinct from v_row->>'id'
       or v_outbound->>'team' is distinct from v_team
       or v_outbound->>'operation' is distinct from 'create'
       or nullif(btrim(v_outbound->>'dedup_key'), '') is null
       or nullif(btrim(v_payload->>'_intent_fingerprint'), '') is null
       or v_project_id is null then
      raise exception 'invalid_intake_append_payload';
    end if;

    v_parent_id := nullif(btrim(v_payload->>'parent_linear_issue_id'), '');
    begin
      v_dependency_id := nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
    exception when others then
      raise exception 'invalid_intake_append_route';
    end;
    if (v_parent_id is null) = (v_dependency_id is null) then
      raise exception 'invalid_intake_append_route';
    end if;
    if v_parent_id is not null then
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      if cardinality(v_parent_ids) > 1 then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
      if cardinality(v_parent_ids) <> 1 or v_parent_ids[1] is distinct from v_parent_id then
        raise exception 'batch_parent_mapping_missing';
      end if;
    else
      select o.* into v_dependency
      from public.mirror_outbox o
      where o.id = v_dependency_id
      for share;
      if not found
         or v_dependency.entity is distinct from 'batch'
         or v_dependency.entity_id is distinct from v_batch.id
         or v_dependency.operation is distinct from 'create'
         or v_dependency.client_slug is distinct from v_batch.client_slug
         or v_dependency.team is distinct from v_team
         or v_dependency.test_only is distinct from coalesce((v_outbound->>'test_only')::boolean, false)
         or v_dependency.legacy_parity is distinct from coalesce((v_outbound->>'legacy_parity')::boolean, false)
         or v_dependency.payload->>'project_id' is distinct from v_project_id
         or v_dependency.status not in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale') then
        raise exception 'batch_parent_mapping_missing';
      end if;
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      if cardinality(v_parent_ids) > 1 then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
      if cardinality(v_parent_ids) = 1 then
        v_dependency_parent_id := nullif(btrim(coalesce(
          v_dependency.linear_result->>'issue_id',
          v_dependency.linear_result->>'linear_issue_id',
          v_dependency.linear_result->'issue'->>'id',
          ''
        )), '');
        if v_dependency_parent_id is distinct from v_parent_ids[1] then
          raise exception 'batch_parent_mapping_ambiguous';
        end if;
      end if;
      if v_dependency.status in ('skipped', 'stale') then
        v_terminal_dependency := true;
      end if;
    end if;

    perform public.production_assert_authority(
      v_batch.client_slug,
      v_team,
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false)
    );
    v_replay := public.production_outbox_replay(
      'deliverable',
      v_row->>'id',
      'create',
      v_batch.client_slug,
      v_team,
      nullif(v_event->>'actor', ''),
      nullif(v_event->>'role', ''),
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false),
      v_payload->>'_intent_fingerprint',
      v_outbound->>'dedup_key'
    );
    if v_replay then v_replay_count := v_replay_count + 1; end if;
  end loop;

  if v_replay_count > 0 and v_replay_count <> v_count then
    raise exception 'idempotency_conflict';
  end if;
  if v_replay_count = v_count then
    for v_index in 0..v_count - 1
    loop
      v_row := p_rows->v_index;
      select d.* into v_result from public.deliverables d where d.id = v_row->>'id';
      if not found
         or v_result.batch_id is distinct from v_batch.id
         or v_result.client_slug is distinct from v_batch.client_slug
         or v_result.team is distinct from v_row->>'team'
         or v_result.card_id is distinct from v_row->>'card_id'
         or v_result.title is distinct from v_row->>'title'
         or v_result.sort_key is distinct from (v_row->>'sort_key')::numeric then
        raise exception 'idempotent_result_missing';
      end if;
      v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_result));
    end loop;
    return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', true);
  end if;
  if v_terminal_dependency then raise exception 'batch_parent_mapping_missing'; end if;

  if v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'write_conflict';
  end if;

  select coalesce(max(d.sort_key), -1)
    into v_base_sort
  from public.deliverables d
  where d.batch_id = v_batch.id
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item where item->>'id' = d.id
    );
  select coalesce(max(substring(d.title from '^Video ([1-9][0-9]*)$')::integer), 0)
    into v_base_ordinal
  from public.deliverables d
  where d.batch_id = v_batch.id
    and d.title ~ '^Video [1-9][0-9]*$'
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item where item->>'id' = d.id
    );

  for v_group in
    select item->>'card_id' as card_id, min(ordinality) as first_ordinality
    from jsonb_array_elements(p_rows) with ordinality entries(item, ordinality)
    group by item->>'card_id'
    order by min(ordinality)
  loop
    v_group_index := v_group_index + 1;
    v_expected_sort := v_base_sort + v_group_index;
    v_expected_ordinal := v_base_ordinal + v_group_index;
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where item->>'card_id' = v_group.card_id
        and (
          (item->>'sort_key')::numeric is distinct from v_expected_sort
          or (item->>'_intake_ordinal')::integer is distinct from v_expected_ordinal
          or item->>'title' is distinct from 'Video ' || v_expected_ordinal::text
        )
    ) then
      raise exception 'invalid_intake_append_order';
    end if;
  end loop;

  for v_index in 0..v_count - 1
  loop
    v_row := p_rows->v_index;
    v_event := p_events->v_index;
    v_result := public.production_deliverable_write(v_row - '_intake_ordinal', v_event);
    v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_result));
  end loop;

  -- The cursor advances under the same batch lock and transaction as both
  -- children/outbox intents. A concurrent append with this cursor now fails.
  perform set_config('app.event_written', '1', true);
  update public.batches b
  set updated_at = clock_timestamp()
  where b.id = v_batch.id
  returning b.* into v_batch;

  v_first_event := p_events->0;
  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    null,
    v_batch.id,
    v_batch.client_slug,
    coalesce(nullif(v_first_event->>'ts', '')::timestamptz, now()),
    nullif(v_first_event->>'actor', ''),
    nullif(v_first_event->>'role', ''),
    'intake_append',
    null,
    null,
    'ui',
    jsonb_build_object(
      'surface', nullif(v_first_event->>'surface', ''),
      'item_count', v_count,
      'card_count', v_count / 2
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', false);
end;
$fn$;

revoke all on function public.production_intake_append(text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_intake_append(text, timestamptz, jsonb, jsonb)
  to service_role;

commit;

-- OWNER-ONLY ONE-COMMAND ROLLBACK (after redeploying the prior Edge version):
-- begin;
-- revoke all on function public.production_intake_append(text, timestamptz, jsonb, jsonb)
--   from public, anon, authenticated, service_role;
-- drop function if exists public.production_intake_append(text, timestamptz, jsonb, jsonb);
-- drop function if exists public.production_batch_parent_ids_for_team(jsonb, text);
-- commit;
