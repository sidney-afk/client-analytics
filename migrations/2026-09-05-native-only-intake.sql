-- Draft only. Install after PR1293's manifest migration; do not activate here.
-- Accepted manifests and terminal receipts are retained on behavior rollback.
begin;
alter table public.production_intake_manifests
  add column native_epochs jsonb not null default '{}'::jsonb
  check (jsonb_typeof(native_epochs) = 'object');

insert into public.syncview_runtime_flags(key,value,updated_by)
values ('native_intake_epochs', '{"video":{"enabled":false,"epoch":null},"graphics":{"enabled":false,"epoch":null}}', 'native-intake-draft')
on conflict(key) do nothing;

-- This is a separate intake capability, NOT prod_authority or a full retired epoch.
-- Only an owner SQL operator may enable it; the existing flag table ACL is unchanged.
create function public.production_native_intake_epochs() returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_flags jsonb; v_team text; v_entry jsonb; v_result jsonb := '{}';
begin
  select value into v_flags from public.syncview_runtime_flags
    where key='native_intake_epochs' for share;
  if not found or jsonb_typeof(v_flags) is distinct from 'object' then
    raise exception 'authority_unavailable'; end if;
  foreach v_team in array array['video','graphics'] loop
    v_entry := v_flags->v_team;
    if jsonb_typeof(v_entry) is distinct from 'object'
      or jsonb_typeof(v_entry->'enabled') is distinct from 'boolean'
      or (v_entry->'enabled' = 'true'::jsonb and
        (jsonb_typeof(v_entry->'epoch') is distinct from 'string'
          or coalesce(v_entry->>'epoch','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$')) then
      raise exception 'authority_unavailable'; end if;
    v_result := v_result || jsonb_build_object(v_team,
      case when v_entry->'enabled'='true'::jsonb then v_entry->>'epoch' else '' end);
  end loop;
  return v_result;
end; $$;

-- Read only. Resolve history before mutable flags. The normal receipt identity
-- and fingerprint checks still execute; this function grants no replay by itself.
create function public.production_intake_epoch_read(
 p_request_id text,p_batch_id text,p_client_slug text,p_actor_key text,
 p_role text,p_auth_kind text,p_teams jsonb,p_dedups jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_manifest public.production_intake_manifests; v_result jsonb := '{}';
 v_flags jsonb; v_team text; v_receipt public.mirror_outbox; v_history boolean;
begin
  if jsonb_typeof(p_teams) is distinct from 'array' or jsonb_typeof(p_dedups) is distinct from 'array'
    then raise exception 'authority_unavailable'; end if;
  select * into v_manifest from public.production_intake_manifests where request_id=p_request_id;
  if found then
    if p_batch_id is distinct from v_manifest.batch_id
      or p_client_slug is distinct from v_manifest.client_slug
      or p_actor_key is distinct from v_manifest.actor_key
      or p_role is distinct from v_manifest.actor_role
      or p_auth_kind is distinct from v_manifest.auth_kind then
      raise exception 'idempotency_conflict'; end if;
    for v_team in select jsonb_array_elements_text(p_teams) loop
      v_result := v_result || jsonb_build_object(v_team,coalesce(v_manifest.native_epochs->>v_team,''));
    end loop;
    return v_result;
  end if;
  -- A pre-manifest root receipt pins the WHOLE root to its old provider lane,
  -- including a child that did not commit before interruption.
  v_history := p_batch_id <> '' and exists(select 1 from public.mirror_outbox
    where entity='batch' and entity_id=p_batch_id and operation='create');
  for v_team in select jsonb_array_elements_text(p_teams) loop
    if v_team not in ('video','graphics') then raise exception 'authority_unavailable'; end if;
    select * into v_receipt from public.mirror_outbox
      where team=v_team and dedup_key in (select jsonb_array_elements_text(p_dedups)) limit 1;
    if found then
      v_result := v_result || jsonb_build_object(v_team,coalesce(v_receipt.payload->>'_native_intake_epoch',''));
    elsif v_history then
      v_result := v_result || jsonb_build_object(v_team,'');
    else
      if v_flags is null then v_flags := public.production_native_intake_epochs(); end if;
      v_result := v_result || jsonb_build_object(v_team,v_flags->>v_team);
    end if;
  end loop;
  return v_result;
end; $$;

-- Called at INSERT, after the installed F27 hold trigger alphabetically. F27
-- sees the original pending intent and checks holds/generation BEFORE terminalization.
-- Never replace the installed enqueue helper or its generation contracts.
create function public.production_native_intake_receipt_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_epoch text; v_expected text; v_manifest public.production_intake_manifests;
 v_item jsonb; v_flags jsonb;
begin
  if tg_op='UPDATE' then
    if coalesce(new.payload->>'_native_intake_epoch','') is distinct from
      coalesce(old.payload->>'_native_intake_epoch','') then
      raise exception 'idempotency_conflict'; end if;
    if coalesce(old.payload->>'_native_intake_epoch','') <> '' and
      (new.status is distinct from 'skipped' or new.payload is distinct from old.payload
       or new.dedup_key is distinct from old.dedup_key or new.team is distinct from old.team
       or new.entity_id is distinct from old.entity_id or new.entity is distinct from old.entity
       or new.operation is distinct from old.operation or new.client_slug is distinct from old.client_slug
       or new.actor is distinct from old.actor or new.role is distinct from old.role
       or new.depends_on_id is distinct from old.depends_on_id
       or new.test_only is distinct from old.test_only or new.legacy_parity is distinct from old.legacy_parity) then
      raise exception 'idempotency_conflict'; end if;
    return new;
  end if;
  if new.operation <> 'create' or new.dedup_key not like 'write-ui:create:%' then return new; end if;
  v_epoch := coalesce(new.payload->>'_native_intake_epoch','');
  -- Match the manifest by exact receipt identity, including a stale gateway
  -- which omitted the marker. It cannot turn a missing native child into debt.
  select * into v_manifest from public.production_intake_manifests m
    where m.batch_id=new.batch_id and (m.parent_receipt->>'dedup_key'=new.dedup_key
      or exists(select 1 from jsonb_array_elements(m.expected_items) item
        where item->>'child_dedup'=new.dedup_key));
  if found then
    v_expected := coalesce(v_manifest.native_epochs->>new.team,'');
    if new.client_slug is distinct from v_manifest.client_slug then raise exception 'idempotency_conflict'; end if;
  else
    v_flags := public.production_native_intake_epochs();
    v_expected := v_flags->>new.team;
  end if;
  if v_expected is distinct from v_epoch then raise exception 'authority_unavailable'; end if;
  if v_epoch <> '' then
    if new.legacy_parity or coalesce(new.payload->>'_native_intake_request','') = '' then
      raise exception 'authority_unavailable'; end if;
    if v_manifest.request_id is not null and new.payload->>'_native_intake_request'
      is distinct from v_manifest.request_id then raise exception 'idempotency_conflict'; end if;
    perform public.production_assert_authority(new.client_slug,new.team,new.test_only,false);
    new.status := 'skipped';
    new.processed_at := clock_timestamp();
    new.next_retry_at := null;
    new.linear_result := jsonb_build_object('native_only',true,'epoch',v_epoch);
    new.last_error := null;
  end if;
  return new;
end; $$;
create trigger zz_native_intake_receipt_guard before insert or update on public.mirror_outbox
for each row execute function public.production_native_intake_receipt_guard();

create or replace function public.production_intake_root_begin(p_row jsonb, p_event jsonb, p_manifest jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_request text := nullif(p_manifest->>'request_id', '');
  v_out jsonb := p_event->'outbound';
  v_existing public.production_intake_manifests;
  v_item jsonb;
  v_ordinal bigint;
  v_receipt jsonb;
  v_result public.batches;
  v_epochs jsonb := '{}'; v_flags jsonb; v_team text; v_generation bigint;
  v_expected_epoch text; v_has_history boolean; v_provider_history boolean; v_held boolean;
begin
  -- Service-only caller is the already-authenticated gateway. Keep the existing
  -- database authority check BEFORE creating or consulting confidential evidence.
  perform public.production_assert_authority(p_row->>'client_slug', v_out->>'team',
    coalesce((v_out->>'test_only')::boolean, false),
    coalesce((v_out->>'legacy_parity')::boolean, false));
  if v_request is null or length(v_request) > 200
    or nullif(p_row->>'id', '') is null
    or nullif(p_event->>'actor_key', '') is null
    or nullif(p_event->>'role', '') is null
    or nullif(p_event->>'auth_kind', '') is null
    or p_event->>'action' is distinct from 'create'
    or v_out->>'entity' is distinct from 'batch'
    or v_out->>'operation' is distinct from 'create'
    or v_out->>'entity_id' is distinct from p_row->>'id'
    or v_out->>'dedup_key' is distinct from
      'write-ui:create:batch:' || (p_row->>'id') || ':' || v_request || ':' || (v_out->>'team')
    or nullif(v_out->'payload'->>'_intent_fingerprint', '') is null
    or jsonb_typeof(p_manifest->'request_intent') is distinct from 'object'
    or jsonb_typeof(p_manifest->'expected_items') is distinct from 'array'
  then raise exception 'invalid_intake_manifest'; end if;
  if jsonb_array_length(p_manifest->'expected_items') not between 1 and 100 then
    raise exception 'invalid_intake_manifest';
  end if;
  for v_item, v_ordinal in select value, ordinality
      from jsonb_array_elements(p_manifest->'expected_items') with ordinality loop
    if (v_item->>'item_index')::bigint is distinct from v_ordinal - 1
      or nullif(v_item->'row'->>'id', '') is null
      or v_item->'row'->>'batch_id' is distinct from p_row->>'id'
      or v_item->'row'->>'client_slug' is distinct from p_row->>'client_slug'
      or coalesce(v_item->'row'->>'team', '') not in ('video', 'graphics')
      or v_item->>'child_dedup' is distinct from
        'write-ui:create:deliverable:' || (v_item->'row'->>'id') || ':' || v_request
      or nullif(v_item->>'child_fingerprint', '') is null
    then raise exception 'invalid_intake_manifest'; end if;
  end loop;
  if (select count(distinct value->'row'->>'id')
      from jsonb_array_elements(p_manifest->'expected_items')) <> jsonb_array_length(p_manifest->'expected_items')
  then raise exception 'invalid_intake_manifest'; end if;

  v_receipt := jsonb_build_object('dedup_key', v_out->>'dedup_key',
    'intent_fingerprint', v_out->'payload'->>'_intent_fingerprint',
    'team', v_out->>'team', 'test_only', coalesce((v_out->>'test_only')::boolean, false),
    'legacy_parity', coalesce((v_out->>'legacy_parity')::boolean, false));
  perform pg_advisory_xact_lock(hashtextextended('root-intake-manifest:' || v_request, 0));
  select * into v_existing from public.production_intake_manifests where request_id = v_request;
  v_has_history := found;
  v_provider_history := exists(select 1 from public.mirror_outbox
    where entity='batch' and entity_id=p_row->>'id' and operation='create');
  if not v_has_history and not v_provider_history then v_flags := public.production_native_intake_epochs(); end if;
  for v_team in select distinct value->'row'->>'team' from jsonb_array_elements(p_manifest->'expected_items') loop
    v_expected_epoch := coalesce(p_manifest->'native_epochs'->>v_team,'');
    v_epochs := v_epochs || jsonb_build_object(v_team,v_expected_epoch);
    if v_has_history then
      if v_expected_epoch is distinct from coalesce(v_existing.native_epochs->>v_team,'') then
        raise exception 'idempotency_conflict'; end if;
    elsif v_provider_history then
      if v_expected_epoch <> '' then raise exception 'idempotency_conflict'; end if;
    elsif v_expected_epoch is distinct from v_flags->>v_team then
      raise exception 'authority_unavailable';
    end if;
    -- All child authorities and fresh generation prerequisites before the parent.
    -- Provider parity remains selected by current authority as in the gateway.
    perform public.production_assert_authority(p_row->>'client_slug',v_team,
      coalesce((v_out->>'test_only')::boolean,false),
      v_expected_epoch='' and not coalesce((v_out->>'test_only')::boolean,false)
        and (select value->>v_team from public.syncview_runtime_flags where key='prod_authority')='linear');
    select generation into v_generation from public.track_b_f27_team_fences where team=v_team for share;
    if (p_manifest ? 'authority_generations' or v_expected_epoch <> '') and
      (v_generation is null or nullif(p_manifest->'authority_generations'->>v_team,'') is null
        or v_generation is distinct from (p_manifest->'authority_generations'->>v_team)::bigint) then
      raise exception 'authority_unavailable'; end if;
    if to_regclass('public.track_b_team_rollbacks') is not null then
      execute 'select exists(select 1 from public.track_b_team_rollbacks where team=$1 and state=''open'')'
        into v_held using v_team;
      if v_held then raise exception 'authority_unavailable'; end if;
    end if;
  end loop;
  if v_existing.request_id is not null then
    -- First accepted plan stays immutable, including generated content and
    -- attribution. Compare caller intent and unchanged receipt semantics. Brief
    -- enrichment and attribution may regenerate without changing caller intent;
    -- return the FIRST accepted rows so the explicit retry uses that content.
    if v_existing.batch_id is distinct from p_row->>'id'
      or v_existing.client_slug is distinct from p_row->>'client_slug'
      or v_existing.actor_key is distinct from p_event->>'actor_key'
      or v_existing.actor_role is distinct from p_event->>'role'
      or v_existing.auth_kind is distinct from p_event->>'auth_kind'
      or v_existing.surface is distinct from p_event->>'surface'
      or (coalesce((p_manifest->'request_intent'->>'source_timestamp_supplied')::boolean, false)
        and v_existing.source_edited_at is distinct from (p_event->>'ts')::timestamptz)
      or v_existing.request_intent is distinct from p_manifest->'request_intent'
      or v_existing.parent_receipt is distinct from v_receipt
      or (select jsonb_agg(jsonb_set(value, '{row}', (value->'row') - 'linear_raw' - 'brief' - 'created_at' - 'status_at') order by ordinality)
          from jsonb_array_elements(v_existing.expected_items) with ordinality)
        is distinct from
        (select jsonb_agg(jsonb_set(value, '{row}', (value->'row') - 'linear_raw' - 'brief' - 'created_at' - 'status_at') order by ordinality)
          from jsonb_array_elements(p_manifest->'expected_items') with ordinality)
    then raise exception 'idempotency_conflict'; end if;
  else
    insert into public.production_intake_manifests(request_id, batch_id, client_slug,
      actor_key, actor_role, auth_kind, surface, source_edited_at,
      request_intent, batch_snapshot, expected_items, parent_receipt, native_epochs)
    values(v_request, p_row->>'id', p_row->>'client_slug', p_event->>'actor_key',
      p_event->>'role', p_event->>'auth_kind', p_event->>'surface', (p_event->>'ts')::timestamptz,
      p_manifest->'request_intent', p_row, p_manifest->'expected_items', v_receipt, v_epochs)
    returning * into v_existing;
  end if;
  -- The deferred FK, manifest and original parent receipt commit together.
  -- Any authority, receipt, writer or trigger failure rolls the entire call back.
  v_result := public.production_batch_write(p_row, p_event);
  return jsonb_build_object('batch', to_jsonb(v_result), 'expected_items', v_existing.expected_items,
    'source_edited_at', v_existing.source_edited_at);
end;
$$;


-- Compatibility replacement of 2026-08-26-production-intake-append-v7.sql; only native parent route added.
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
  select coalesce(max(substring(d.title from '^(?:Sample )?(?:Video|Thumbnail) ([1-9][0-9]*)$')::integer), 0)
    into v_base_ordinal
  from public.deliverables d
  where d.batch_id = v_batch.id
    and d.title ~ '^(?:Sample )?(?:Video|Thumbnail) [1-9][0-9]*$'
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
          or item->>'title' is distinct from (
            (case when coalesce(v_batch.purpose, 'calendar') = 'samples' then 'Sample ' else '' end)
            || (case
              when item->>'team' = 'graphics' then 'Thumbnail ' || v_expected_ordinal::text
              else 'Video ' || v_expected_ordinal::text
            end)
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

-- Compatibility replacement of 2026-08-31-production-component-fill.sql; only native parent route added.
create or replace function public.production_component_fill(
  p_batch_id text,
  p_expected_updated_at timestamptz,
  p_sibling_id text,
  p_row jsonb,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_batch public.batches%rowtype;
  v_sibling public.deliverables%rowtype;
  v_result public.deliverables%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_outbound jsonb;
  v_payload jsonb;
  v_team text;
  v_card_id text;
  v_title text;
  v_parent_id text;
  v_dependency_parent_id text;
  v_parent_ids text[];
  v_dep_parent_ids text[];
  v_shared_parent boolean;
  v_dependency_id bigint;
  v_project_id text;
  v_replay boolean;
  v_terminal_dependency boolean := false;
  v_own_parent_ids text[];
  v_sibling_parent_ids text[];
  v_card_found boolean;
  v_card_status text;
  v_card_video text;
  v_card_graphic text;
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_sibling_id, '')), '') is null
     or p_expected_updated_at is null
     or jsonb_typeof(p_row) is distinct from 'object'
     or jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'invalid_component_fill_payload';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status is distinct from 'active' then raise exception 'batch_not_active'; end if;

  v_outbound := coalesce(p_event->'outbound', '{}'::jsonb);
  v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_team := nullif(btrim(p_row->>'team'), '');
  v_card_id := nullif(btrim(p_row->>'card_id'), '');
  v_title := nullif(btrim(coalesce(p_row->>'title', '')), '');
  v_project_id := nullif(btrim(v_payload->>'project_id'), '');

  -- THE SIBLING IS THE AUTHORITY on where this component belongs. Locked in
  -- the same transaction as the batch so it cannot be re-carded underneath us.
  select d.* into v_sibling
  from public.deliverables d
  where d.id = p_sibling_id
  for update;
  if not found then raise exception 'component_fill_sibling_missing'; end if;
  if v_sibling.batch_id is distinct from v_batch.id
     or v_sibling.client_slug is distinct from v_batch.client_slug then
    raise exception 'component_fill_sibling_missing';
  end if;
  -- The card the caller named must be the card the sibling actually carries.
  -- Without this a caller could point any card at any batch's work.
  if v_card_id is null
     or nullif(btrim(coalesce(v_sibling.card_id, '')), '') is distinct from v_card_id then
    raise exception 'component_fill_card_mismatch';
  end if;
  if v_sibling.team is not distinct from v_team then
    raise exception 'component_fill_team_occupied';
  end if;

  -- THE DUPLICATE GUARD, against committed rows rather than the request: two
  -- tabs racing this button serialize on the batch lock, and the second one
  -- sees the first one's row and refuses.
  if exists (
    select 1
    from public.deliverables d
    where d.client_slug = v_batch.client_slug
      and nullif(btrim(coalesce(d.card_id, '')), '') = v_card_id
      and d.team = v_team
      and d.id is distinct from p_row->>'id'
  ) then
    raise exception 'component_fill_team_occupied';
  end if;

  /*
   * THE CARD ITSELF, READ AND LOCKED. Raised by Codex on PR 1195, and it was
   * right about something more fundamental than the race it named.
   *
   * Everything above validates the SIBLING: that it exists, that it carries
   * this card_id, that it is the other team. None of that reads the card, and
   * `deliverables.card_id` is plain text with no foreign key -- so before this
   * block the function could attach a live deliverable to a card that had been
   * archived since the tab loaded, or to one that does not exist at all. The
   * header of this migration claimed a card must "exist already, which is what
   * makes an orphaned component impossible"; that was enforced by the browser
   * and by a text column, not by the database.
   *
   * ARCHIVING IS THE CASE THAT BITES. Archiving a post PARKS its sub-issues
   * (owner ruling 2026-08-17, after 33 of 50 sub-issues on 37 archived cards
   * were found still open, several sitting in SMM or client approval -- "that
   * is phantom work on real people's lists"). The park moves only the
   * components captured BEFORE the archive write, so a fill landing after it
   * mints a fresh `todo` deliverable, mirrors it to Linear, and nothing will
   * ever park that one. Archiving does not advance batches.updated_at either,
   * so the CAS cursor above cannot see it.
   *
   * Locked FOR UPDATE, which is safe here: the archive path writes the card
   * row through calendar-upsert and parks the deliverables in SEPARATE
   * transactions, so there is no second transaction holding the card and
   * waiting on this batch. A concurrent archive either commits first -- and is
   * then seen, and refused -- or waits for this fill and parks after it.
   *
   * The TARGET SLOT is re-checked here too, on the card rather than on the
   * deliverables. The occupancy guard above reads `deliverables.card_id`; this
   * reads the other direction of the same link, so a card already pointing at
   * a component whose row lost its card_id is still refused rather than
   * silently gaining a second one.
   */
  if coalesce(v_batch.purpose, 'calendar') = 'samples' then
    select true, s.status, s.video_deliverable_id, s.graphic_deliverable_id
      into v_card_found, v_card_status, v_card_video, v_card_graphic
    from public.sample_reviews s
    where s.id = v_card_id and s.client = v_batch.client_slug
    for update;
  else
    select true, c.status, c.video_deliverable_id, c.graphic_deliverable_id
      into v_card_found, v_card_status, v_card_video, v_card_graphic
    from public.calendar_posts c
    where c.id = v_card_id and c.client = v_batch.client_slug
    for update;
  end if;
  if not coalesce(v_card_found, false) then
    raise exception 'component_fill_card_missing';
  end if;
  if lower(btrim(coalesce(v_card_status, ''))) = 'archived' then
    raise exception 'component_fill_card_archived';
  end if;
  if nullif(btrim(coalesce(
       case when v_team = 'graphics' then v_card_graphic else v_card_video end, '')), '')
     is distinct from null
     and nullif(btrim(coalesce(
       case when v_team = 'graphics' then v_card_graphic else v_card_video end, '')), '')
     is distinct from p_row->>'id' then
    raise exception 'component_fill_team_occupied';
  end if;

  if nullif(btrim(p_row->>'id'), '') is null
     or p_row->>'batch_id' is distinct from v_batch.id
     or p_row->>'client_slug' is distinct from v_batch.client_slug
     or v_team is null
     or v_team not in ('video', 'graphics')
     or v_title is null
     or length(v_title) > 500
     -- Same origin/purpose agreement as the append path: a samples row may
     -- only land in a samples batch and a calendar row only in a calendar one.
     or p_row->>'origin' not in ('calendar', 'samples')
     or p_row->>'origin' is distinct from coalesce(v_batch.purpose, 'calendar')
     -- Parenthesised because PL/pgSQL ends an IF condition at the first THEN.
     or p_row->>'kind' is distinct from (case when v_team = 'graphics' then 'thumbnail' else 'video' end)
     or p_event->>'source' is distinct from 'ui'
     or p_event->>'action' is distinct from 'create'
     or v_outbound->>'entity' is distinct from 'deliverable'
     or v_outbound->>'entity_id' is distinct from p_row->>'id'
     or v_outbound->>'team' is distinct from v_team
     or v_outbound->>'operation' is distinct from 'create'
     or nullif(btrim(v_outbound->>'dedup_key'), '') is null
     or nullif(btrim(v_payload->>'_intent_fingerprint'), '') is null
     or v_project_id is null then
    raise exception 'invalid_component_fill_payload';
  end if;

  -- SORT KEY IS INHERITED EXACTLY, null included. 21 of the 65 conforming
  -- siblings measured on 2026-08-31 carry a null sort_key, so "must be a
  -- number" would refuse a third of the population this exists to serve.
  -- Compared as numeric rather than as jsonb because jsonb preserves the
  -- scale it was given and 3 is not 3.0 textually.
  if p_row ? 'sort_key' and jsonb_typeof(p_row->'sort_key') not in ('number', 'null') then
    raise exception 'invalid_component_fill_payload';
  end if;
  if (p_row->>'sort_key')::numeric is distinct from v_sibling.sort_key then
    raise exception 'component_fill_sort_mismatch';
  end if;

  -- The parent route, byte-for-byte the append path's rule: either the batch's
  -- recorded parent for this team, or a pending batch-create outbox row this
  -- child depends on. Exactly one of the two.
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
    raise exception 'invalid_component_fill_route';
  end;
  if (v_parent_id is null) = (v_dependency_id is null) then
    raise exception 'invalid_component_fill_route';
  end if;
  /* THE PARENT ROUTE IS INHERITED TOO, and leaving it out was the one thing
     this function inherited from its sibling in principle and not in fact.
     Raised by Codex on PR 1195; measured before it was believed. Across the 47
     distinct batches behind the 127 half-complete cards this exists for, 25
     carry a parent entry for the team being FILLED and 22 do not -- nearly
     half. A single-team batch (a Video-only or Thumbnail-only post, the
     freshest thing anyone would press this button on) records a parent only for
     the team it was created with, so asking the map for the missing team's
     parent answers nothing and the write was refused
     batch_parent_mapping_missing on exactly the population it targets.

     A batch has ONE parent issue and every child of it hangs under that issue.
     The sibling is already the authority for which batch, which sort position,
     which due date and which title; it is the authority for the parent too. So
     the target team's own entry wins when it has one, and the sibling's is used
     when it does not -- the same resolution parentRouteForAppend performs in
     the gateway with `appendParentTeam`, and the same reason parentOwnerTeamFor
     exists: validate against the team that OWNS the parent, never the team
     doing the asking. */
  v_own_parent_ids := public.production_batch_parent_ids_for_team(
    v_batch.linear_parent_ids, v_team);
  if cardinality(v_own_parent_ids) > 1 then
    raise exception 'batch_parent_mapping_ambiguous';
  end if;
  v_sibling_parent_ids := public.production_batch_parent_ids_for_team(
    v_batch.linear_parent_ids, v_sibling.team);
  if cardinality(v_sibling_parent_ids) > 1 then
    raise exception 'batch_parent_mapping_ambiguous';
  end if;
  v_parent_ids := case
    when cardinality(v_own_parent_ids) = 1 then v_own_parent_ids
    else v_sibling_parent_ids
  end;

  if v_parent_id is not null then
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
    /* The shared-parent waiver from the append path (v4): one Linear issue can
       serve both teams, and when it does, a graphics child legitimately arrives
       carrying the VIDEO batch-create dependency -- whose team, parity and
       project describe its own lane, not the row's.

       EARNED TWO WAYS HERE, and the second is what a single-team batch needs.
       Either both teams resolve to the identical single parent (the original
       shape, unchanged), or the target team has NO recorded parent at all and
       the dependency is the sibling's own batch-create lane -- the only parent
       this batch has. Still not a blanket waiver: a dependency belonging to a
       team that is neither the target nor the sibling fails exactly as it did
       before, and so does one on a batch where the target team does have its
       own parent and the two disagree. */
    v_dep_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_dependency.team);
    v_shared_parent := v_dependency.team is distinct from v_team
      and (
        (cardinality(v_own_parent_ids) = 1 and v_own_parent_ids = v_dep_parent_ids)
        or (cardinality(v_own_parent_ids) = 0
            and lower(btrim(coalesce(v_dependency.team, '')))
                = lower(btrim(coalesce(v_sibling.team, ''))))
      );
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

  -- An exact retry returns the row it already made, and does not make a second.
  v_replay := public.production_outbox_replay(
    'deliverable',
    p_row->>'id',
    'create',
    v_batch.client_slug,
    v_team,
    nullif(p_event->>'actor', ''),
    nullif(p_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_payload->>'_intent_fingerprint',
    v_outbound->>'dedup_key'
  );
  if v_replay then
    select d.* into v_result from public.deliverables d where d.id = p_row->>'id';
    if not found
       or v_result.batch_id is distinct from v_batch.id
       or v_result.client_slug is distinct from v_batch.client_slug
       or v_result.team is distinct from v_team
       or v_result.card_id is distinct from v_card_id
       or v_result.title is distinct from v_title then
      raise exception 'idempotent_result_missing';
    end if;
    return jsonb_build_object('batch', to_jsonb(v_batch), 'item', to_jsonb(v_result), 'replay', true);
  end if;
  if v_terminal_dependency then raise exception 'batch_parent_mapping_missing'; end if;

  if v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'write_conflict';
  end if;

  v_result := public.production_deliverable_write(p_row, p_event);

  -- The cursor advances under the same batch lock and transaction as the child
  -- and its outbox intent, so a concurrent fill carrying this cursor now fails.
  perform set_config('app.event_written', '1', true);
  update public.batches b
  set updated_at = clock_timestamp()
  where b.id = v_batch.id
  returning b.* into v_batch;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_batch.id,
    v_batch.client_slug,
    coalesce(nullif(p_event->>'ts', '')::timestamptz, now()),
    nullif(p_event->>'actor', ''),
    nullif(p_event->>'role', ''),
    'component_fill',
    null,
    null,
    'ui',
    jsonb_build_object(
      'surface', nullif(p_event->>'surface', ''),
      'card_id', v_card_id,
      'team', v_team,
      'sibling_id', v_sibling.id
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'item', to_jsonb(v_result), 'replay', false);
end;
$fn$;

revoke all on function public.production_native_intake_epochs() from public,anon,authenticated;
revoke all on function public.production_intake_epoch_read(text,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.production_native_intake_receipt_guard() from public,anon,authenticated,service_role;
grant execute on function public.production_native_intake_epochs() to service_role;
grant execute on function public.production_intake_epoch_read(text,text,text,text,text,text,jsonb,jsonb) to service_role;
-- Existing replaced RPC ACLs are retained. No direct manifest write grant.
commit;
