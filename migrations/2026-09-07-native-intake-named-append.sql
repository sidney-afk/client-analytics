-- SOURCE_ONLY. Final additive append replacement: install AFTER BOTH
-- 2026-09-07-production-intake-append-v8.sql and 2026-09-05-native-only-intake.sql.
-- Native-only body retained; only v8's two ordinal regexes and named-title
-- predicate are composed in. Never apply either older replacement afterward.
-- No new owner, flag, provider route, authentication or component-fill change.
begin;
do $$ begin
  if to_regprocedure('public.production_native_intake_epochs()') is null or not exists(
    select 1 from pg_trigger where tgrelid='public.mirror_outbox'::regclass
      and tgname='zz_native_intake_receipt_guard' and tgenabled='O') then
    raise exception 'native_intake_named_append_prerequisite_missing';
  end if;
end $$;

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
  v_dep_parent_ids text[];
  v_shared_parent boolean;
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
  if v_count < 1 or v_count > 100 or v_count <> jsonb_array_length(p_events) then
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
  -- v2: a card group is a video+graphics pair OR a single-team row (the
  -- 2026-08-17 Video only / Thumbnail only modes), never two of one team.
  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    group by nullif(btrim(item->>'card_id'), '')
    having nullif(btrim(item->>'card_id'), '') is null
       or count(*) < 1 or count(*) > 2
       or count(*) filter (where item->>'team' = 'video') > 1
       or count(*) filter (where item->>'team' = 'graphics') > 1
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
       or v_card_id is null
       -- ORIGIN NOW AGREES WITH THE BATCH, rather than being pinned to one
       -- value (2026-08-19, samples native create). A samples row may append
       -- only to a purpose='samples' batch and a calendar row only to a
       -- calendar batch; the pair is checked for agreement, so neither can
       -- leak into the other's batch. An origin that is neither is refused
       -- outright, so the widening cannot become an open door.
       or v_row->>'origin' not in ('calendar', 'samples')
       or v_row->>'origin' is distinct from coalesce(v_batch.purpose, 'calendar')
       -- The CASE is parenthesised on purpose: PL/pgSQL finds the end of an
       -- IF condition by scanning for the first THEN, so a bare CASE...THEN
       -- here truncates the whole condition and the function will not compile.
       or v_row->>'kind' is distinct from (case when v_team = 'graphics' then 'thumbnail' else 'video' end)
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

    if coalesce(v_payload->>'_native_intake_epoch','') <> '' then
      if v_payload->>'_native_parent_batch_id' is distinct from v_batch.id
        or nullif(v_payload->>'parent_linear_issue_id','') is not null
        or nullif(v_outbound->>'depends_on_id','') is not null then
        raise exception 'batch_parent_mapping_missing'; end if;
    else
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
      if not found then
        raise exception 'batch_parent_mapping_missing';
      end if;
      -- v4: the gateway resolves ONE parent route per batch and shares it
      -- across every team on the card, because a batch must hang under a
      -- single parent issue. So a graphics row legitimately arrives carrying
      -- the VIDEO batch-create dependency -- and that dependency describes
      -- its OWN lane, not the row's: its team is video, its legacy_parity is
      -- the video lane's (true while video is Linear-authoritative; the
      -- graphics lane runs parity false post-flip), and its payload project
      -- is the video project. v3 waived only the team equality, so the very
      -- next comparison (parity) refused the same appends for the same
      -- underlying reason, and the project comparison was waiting behind it
      -- for any client whose per-team projects differ.
      --
      -- The waiver is earned, not assumed: it applies only when both teams
      -- resolve to the IDENTICAL single parent issue -- one issue really
      -- does serve both, which is exactly the shape the create flow writes.
      -- When the teams match, every check below is as strict as it ever was.
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      v_dep_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_dependency.team);
      v_shared_parent := v_dependency.team is distinct from v_team
        and cardinality(v_parent_ids) = 1
        and v_parent_ids = v_dep_parent_ids;
      if v_dependency.entity is distinct from 'batch'
         or v_dependency.entity_id is distinct from v_batch.id
         or v_dependency.operation is distinct from 'create'
         or v_dependency.client_slug is distinct from v_batch.client_slug
         or (v_dependency.team is distinct from v_team and not v_shared_parent)
         or v_dependency.test_only is distinct from coalesce((v_outbound->>'test_only')::boolean, false)
         or (v_dependency.legacy_parity is distinct from coalesce((v_outbound->>'legacy_parity')::boolean, false)
             and not v_shared_parent)
         or (v_dependency.payload->>'project_id' is distinct from v_project_id
             and not v_shared_parent)
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
  -- v2: Thumbnail titles advance the ordinal too, so a thumbnail-only
  -- batch never reissues an already-used number.
  -- The optional 'Sample ' prefix counts too: the first live samples batch
  -- predates the title ruling and its children read 'Video 1' / 'Thumbnail 1',
  -- so a strict per-purpose count would restart its numbering at 1.
  select coalesce(max(substring(d.title from '^(?:Sample )?(?:Video|Thumbnail) ([1-9][0-9]*)(?: — .+)?$')::integer), 0)
    into v_base_ordinal
  from public.deliverables d
  where d.batch_id = v_batch.id
    and d.title ~ '^(?:Sample )?(?:Video|Thumbnail) [1-9][0-9]*(?: — .+)?$'
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
          -- v2: titles are per kind; the Jul 13 text demanded 'Video N' on
          -- both halves, which the create path never produced.
          -- Parenthesised for the same reason as the kind check above: this
          -- CASE sits inside an IF condition, and its THEN would otherwise be
          -- read as the end of that condition.
          -- v6: a samples batch titles its children 'Sample Video N' /
          -- 'Sample Thumbnail N' (owner ruling 2026-08-19). The prefix is
          -- derived from the BATCH's purpose -- the same column the origin
          -- agreement above checks -- so a title can never disagree with the
          -- batch it lands in. Fully parenthesised for the same IF/THEN
          -- reason as every CASE in this condition.
          or not (
            item->>'title' = (
              (case when coalesce(v_batch.purpose, 'calendar') = 'samples' then 'Sample ' else '' end)
              || (case
                when item->>'team' = 'graphics' then 'Thumbnail ' || v_expected_ordinal::text
                else 'Video ' || v_expected_ordinal::text
              end)
            )
            or item->>'title' like (
              (case when coalesce(v_batch.purpose, 'calendar') = 'samples' then 'Sample ' else '' end)
              || (case
                when item->>'team' = 'graphics' then 'Thumbnail ' || v_expected_ordinal::text
                else 'Video ' || v_expected_ordinal::text
              end)
              || ' — _%'
            )
          )
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
      'card_count', (
        select count(distinct nullif(btrim(item->>'card_id'), ''))
        from jsonb_array_elements(p_rows) item
      )
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', false);
end;
$fn$;
revoke all on function public.production_intake_append(text,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.production_intake_append(text,timestamptz,jsonb,jsonb) to service_role;
commit;
