-- F203: atomic Production-only parent/sub-issue creation.
--
-- Additive and source-only. This adds three service-role-only RPCs (atomic
-- native create, atomic post-ack linkage, and a fail-closed identity-conflict
-- quarantine); it does not alter the mirror_outbox operation CHECK because
-- `create` is already allowed.
-- A root issue receives one structural native batch plus one deliverable, while
-- a sub-issue reuses its validated root parent's batch. Only the deliverable
-- emits a Linear create intent. Neither path accepts or writes a Calendar or
-- Samples card link.
--
-- PRIVACY BOUNDARY: the exact description and label selection must reach the
-- service-role-only mirror_outbox. The existing AFTER INSERT trigger consumes
-- that outbound envelope first; this RPC then redacts the envelope from the
-- otherwise public create audit row in the same transaction. Failure to find
-- exactly one audit row or one outbox row aborts the entire native create.
--
-- No migration, function deploy, flag, authority, n8n, or Linear write is
-- performed by this source file in this session. Live apply/deploy and the real
-- TEST drill require a separate post-merge owner-approved window.

begin;

create or replace function public.production_issue_create(
  p_batch jsonb,
  p_row jsonb,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_batch_input jsonb := coalesce(p_batch, '{}'::jsonb);
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_payload jsonb := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_raw jsonb := coalesce(v_row->'linear_raw', '{}'::jsonb);
  v_issue jsonb := coalesce(v_row->'linear_raw'->'issue', '{}'::jsonb);
  v_attribution jsonb := coalesce(v_row->'linear_raw'->'attribution', '{}'::jsonb);
  v_id text := nullif(btrim(v_row->>'id'), '');
  v_batch_id text := nullif(btrim(v_row->>'batch_id'), '');
  v_client_slug text := nullif(btrim(v_row->>'client_slug'), '');
  v_team text := nullif(btrim(v_row->>'team'), '');
  v_dedup text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_payload->>'_intent_fingerprint'), '');
  v_planned_linear_id text := nullif(btrim(v_payload->>'planned_linear_issue_id'), '');
  v_parent_id text := nullif(btrim(v_event->>'parent_deliverable_id'), '');
  v_parent_linear_id text;
  v_direct_parent_id text := nullif(btrim(v_payload->>'parent_linear_issue_id'), '');
  v_dependency_id bigint;
  v_test_only boolean := coalesce((v_outbound->>'test_only')::boolean, false);
  v_legacy_parity boolean := coalesce((v_outbound->>'legacy_parity')::boolean, false);
  v_replay boolean;
  v_result public.deliverables%rowtype;
  v_batch public.batches%rowtype;
  v_parent public.deliverables%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_outbox_id bigint;
  v_count integer;
  v_event_count integer;
  v_batch_parent_ids text[];
begin
  if jsonb_typeof(v_batch_input) is distinct from 'object'
     or jsonb_typeof(v_row) is distinct from 'object'
     or jsonb_typeof(v_event) is distinct from 'object'
     or jsonb_typeof(v_outbound) is distinct from 'object'
     or jsonb_typeof(v_payload) is distinct from 'object'
     or v_id is null
     or v_batch_id is null
     or v_client_slug is null
     or v_team not in ('video', 'graphics')
     or v_dedup is null
     or v_fingerprint is null
     or v_planned_linear_id is null
     or v_event->>'source' is distinct from 'ui'
     or v_event->>'action' is distinct from 'create'
     or v_event->>'surface' is distinct from 'production'
     or nullif(btrim(v_event->>'actor'), '') is null
     or nullif(btrim(v_event->>'actor_key'), '') is null
     or nullif(btrim(v_event->>'role'), '') is null
     or nullif(btrim(v_event->>'auth_kind'), '') is null
     or nullif(btrim(v_event->>'ts'), '') is null
     or v_outbound->>'entity' is distinct from 'deliverable'
     or v_outbound->>'entity_id' is distinct from v_id
     or v_outbound->>'team' is distinct from v_team
     or v_outbound->>'operation' is distinct from 'create'
     or nullif(v_outbound->>'source_edited_at', '')::timestamptz
          is distinct from nullif(v_event->>'ts', '')::timestamptz
     or v_legacy_parity
     or v_row->>'kind' is distinct from 'other'
     or v_row->>'origin' is distinct from 'manual'
     or nullif(btrim(v_row->>'card_id'), '') is not null
     or v_row->>'created_by' is distinct from v_event->>'actor_key'
     or nullif(v_row->>'created_at', '')::timestamptz
          is distinct from nullif(v_event->>'ts', '')::timestamptz
     or v_row->>'linear_issue_uuid' is distinct from v_planned_linear_id
     or v_issue->>'id' is distinct from v_planned_linear_id
     or v_issue->'project'->>'id' is distinct from v_payload->>'project_id'
     or v_issue->'team'->>'id' is distinct from v_payload->>'team_id'
     or v_issue->'state'->>'id' is distinct from v_payload->>'state_id'
     or v_issue->>'title' is distinct from v_row->>'title'
     or v_payload->>'title' is distinct from v_row->>'title'
     or jsonb_typeof(v_payload->'description') is distinct from 'string'
     or v_payload->>'description' is distinct from coalesce(v_row->>'brief', '')
     or v_issue->>'description' is distinct from v_payload->>'description'
     or v_payload->>'status' is distinct from v_row->>'status'
     or coalesce(nullif(v_payload->>'due_date', ''), '')
          is distinct from coalesce(nullif(v_row->>'due_date', ''), '')
     or coalesce(nullif(v_issue->>'dueDate', ''), '')
          is distinct from coalesce(nullif(v_payload->>'due_date', ''), '')
     or coalesce(nullif(v_payload->>'assignee_id', ''), '')
          is distinct from coalesce(nullif(v_row->>'assignee_id', ''), '')
     or coalesce(nullif(v_issue->'assignee'->>'id', ''), '')
          is distinct from coalesce(nullif(v_payload->>'linear_user_id', ''), '')
     or jsonb_typeof(v_payload->'label_ids') is distinct from 'array'
     or jsonb_array_length(v_payload->'label_ids') > 250
     or v_issue->'labelIds' is distinct from v_payload->'label_ids'
     or jsonb_typeof(v_issue->'labels'->'nodes') is distinct from 'array'
     or jsonb_array_length(v_issue->'labels'->'nodes')
          is distinct from jsonb_array_length(v_payload->'label_ids')
     or v_issue->'labels'->'pageInfo'->'hasNextPage' is distinct from 'false'::jsonb
     or v_attribution->>'schema' is distinct from 'syncview_attribution_v1'
     or v_attribution->>'state' is distinct from 'resolved'
     or v_attribution->>'client_slug' is distinct from v_client_slug
     or v_attribution->>'project_id' is distinct from v_payload->>'project_id'
     or coalesce((v_attribution->>'repair_required')::boolean, true) then
    raise exception 'invalid_production_create_payload';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_payload->'label_ids') item
    where jsonb_typeof(item) is distinct from 'string'
  ) or (
    select coalesce(jsonb_agg(label order by label), '[]'::jsonb)
    from (
      select distinct value #>> '{}' as label
      from jsonb_array_elements(v_payload->'label_ids') value
    ) labels
  ) is distinct from v_payload->'label_ids' then
    raise exception 'invalid_production_create_payload';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_issue->'labels'->'nodes') node
    where jsonb_typeof(node) is distinct from 'object'
       or jsonb_typeof(node->'id') is distinct from 'string'
  ) or (
    select coalesce(jsonb_agg(label order by label), '[]'::jsonb)
    from (
      select distinct node->>'id' as label
      from jsonb_array_elements(v_issue->'labels'->'nodes') node
    ) labels
  ) is distinct from v_payload->'label_ids' then
    raise exception 'invalid_production_create_payload';
  end if;
  if (nullif(v_row->>'assignee_id', '') is null)
       is distinct from (nullif(v_payload->>'linear_user_id', '') is null) then
    raise exception 'invalid_production_create_payload';
  end if;
  begin
    v_dependency_id := nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
  exception when others then
    raise exception 'production_create_parent_route';
  end;

  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('production-batch:' || v_batch_id, 0));
  v_replay := public.production_outbox_replay(
    'deliverable',
    v_id,
    'create',
    v_client_slug,
    v_team,
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    v_test_only,
    false,
    v_fingerprint,
    v_dedup
  );

  if v_replay then
    select d.* into v_result
    from public.deliverables d
    where d.id = v_id
    for share;
    select b.* into v_batch
    from public.batches b
    where b.id = v_batch_id
    for share;
    if v_result.id is null
       or v_batch.id is null
       or v_result.batch_id is distinct from v_batch_id
       or v_result.client_slug is distinct from v_client_slug
       or v_result.team is distinct from v_team
       or v_result.kind is distinct from 'other'
       or v_result.origin is distinct from 'manual'
       or v_result.card_id is not null
       or v_result.created_by is distinct from v_row->>'created_by'
       or v_result.created_at is distinct from nullif(v_row->>'created_at', '')::timestamptz
       or v_result.linear_issue_uuid is distinct from v_planned_linear_id
       or v_batch.client_slug is distinct from v_client_slug
       or (v_batch.team is not null and v_batch.team is distinct from v_team) then
      raise exception 'production_create_id_conflict';
    end if;
    select count(*), max(o.id)
      into v_count, v_outbox_id
    from public.mirror_outbox o
    where o.dedup_key = v_dedup
      and o.entity = 'deliverable'
      and o.entity_id = v_id
      and o.operation = 'create'
      and o.client_slug = v_client_slug
      and o.team = v_team
      and o.actor is not distinct from nullif(v_event->>'actor', '')
      and o.role is not distinct from nullif(v_event->>'role', '')
      and o.test_only is not distinct from v_test_only
      and not o.legacy_parity
      and o.source_edited_at is not distinct from nullif(v_event->>'ts', '')::timestamptz
      and o.payload->>'_intent_fingerprint' = v_fingerprint
      and o.payload->>'planned_linear_issue_id' = v_planned_linear_id;
    select count(*)
      into v_event_count
    from public.deliverable_events e
    where e.deliverable_id = v_id
      and e.batch_id = v_batch_id
      and e.client_slug = v_client_slug
      and e.actor is not distinct from nullif(v_event->>'actor', '')
      and e.role is not distinct from nullif(v_event->>'role', '')
      and e.action = 'create'
      and e.source = 'ui'
      and e.ts is not distinct from nullif(v_event->>'ts', '')::timestamptz
      and e.payload->>'surface' = 'production'
      and e.payload->>'actor_key' = v_event->>'actor_key'
      and e.payload->>'auth_kind' = v_event->>'auth_kind'
      and e.payload->>'parent_deliverable_id' is not distinct from v_parent_id
      and not (e.payload ? 'outbound')
      and e.payload->'outbound_redacted'->>'operation' = 'create'
      and e.payload->'outbound_redacted'->>'dedup_key' = v_dedup
      and e.payload->'outbound_redacted'->>'intent_fingerprint' = v_fingerprint;
    if v_count <> 1 or v_outbox_id is null or v_event_count <> 1 then
      raise exception 'production_create_receipt_missing';
    end if;
    v_batch_parent_ids := public.production_batch_parent_ids_for_team(
      v_batch.linear_parent_ids,
      v_team
    );
    if v_parent_id is null then
      if nullif(btrim(coalesce(
           v_result.linear_raw->'issue'->'parent'->>'id',
           v_result.linear_raw->'issue'->>'parentId',
           ''
         )), '') is not null
         or cardinality(v_batch_parent_ids) <> 1
         or v_batch_parent_ids[1] is distinct from v_planned_linear_id
         or not exists (
           select 1
           from public.deliverable_events e
           where e.deliverable_id is null
             and e.batch_id = v_batch_id
             and e.client_slug = v_client_slug
             and e.actor is not distinct from nullif(v_event->>'actor', '')
             and e.role is not distinct from nullif(v_event->>'role', '')
             and e.action = 'production_issue_container_create'
             and e.source = 'system'
             and e.payload->>'surface' = 'production'
             and e.payload->>'deliverable_id' = v_id
             and e.payload->>'structural_only' = 'true'
         ) then
        raise exception 'production_create_id_conflict';
      end if;
    else
      select d.* into v_parent
      from public.deliverables d
      where d.id = v_parent_id
      for share;
      if not found
         or v_parent.batch_id is distinct from v_batch_id
         or v_parent.client_slug is distinct from v_client_slug
         or v_parent.team is distinct from v_team
         or v_parent.linear_issue_uuid is null
         or nullif(btrim(coalesce(
              v_parent.linear_raw->'issue'->'parent'->>'id',
              v_parent.linear_raw->'issue'->>'parentId',
              ''
            )), '') is not null
         or nullif(btrim(coalesce(
              v_result.linear_raw->'issue'->'parent'->>'id',
              v_result.linear_raw->'issue'->>'parentId',
              ''
            )), '') is distinct from v_parent.linear_issue_uuid
         or cardinality(v_batch_parent_ids) <> 1
         or v_batch_parent_ids[1] is distinct from v_parent.linear_issue_uuid then
        raise exception 'production_create_id_conflict';
      end if;
    end if;
    return jsonb_build_object(
      'row', to_jsonb(v_result),
      'batch', to_jsonb(v_batch),
      'outbox_id', v_outbox_id,
      'replay', true
    );
  end if;

  perform public.production_assert_authority(
    v_client_slug,
    v_team,
    v_test_only,
    false
  );
  if exists (
    select 1 from public.deliverables d
    where d.id = v_id or d.linear_issue_uuid = v_planned_linear_id
  ) then
    raise exception 'production_create_id_conflict';
  end if;

  if v_parent_id is null then
    if v_dependency_id is not null
       or v_direct_parent_id is not null
       or v_issue->'parent' is distinct from 'null'::jsonb
       or v_batch_input->>'id' is distinct from v_batch_id
       or v_batch_input->>'client_slug' is distinct from v_client_slug
       or v_batch_input->>'team' is distinct from v_team
       or v_batch_input->>'name' is distinct from v_row->>'title'
       or v_batch_input->>'status' is distinct from 'active'
       or nullif(btrim(v_batch_input->>'description'), '') is not null
       or jsonb_typeof(v_batch_input->'linear_parent_ids') is distinct from 'object' then
      raise exception 'invalid_production_create_payload';
    end if;
    v_batch_parent_ids := public.production_batch_parent_ids_for_team(
      v_batch_input->'linear_parent_ids',
      v_team
    );
    if cardinality(v_batch_parent_ids) <> 1
       or v_batch_parent_ids[1] is distinct from v_planned_linear_id
       or exists (select 1 from public.batches b where b.id = v_batch_id) then
      raise exception 'production_create_id_conflict';
    end if;
    v_batch := public.batch_write(
      v_batch_input,
      jsonb_build_object(
        'source', 'system',
        'action', 'production_issue_container_create',
        'actor', nullif(v_event->>'actor', ''),
        'role', nullif(v_event->>'role', ''),
        'ts', nullif(v_event->>'ts', ''),
        'surface', 'production',
        'deliverable_id', v_id,
        'structural_only', true
      )
    );
  else
    if v_batch_input <> '{}'::jsonb then
      raise exception 'invalid_production_create_payload';
    end if;
    select d.* into v_parent
    from public.deliverables d
    where d.id = v_parent_id
    for share;
    if not found
       or v_parent.client_slug is distinct from v_client_slug
       or v_parent.team is distinct from v_team
       or v_parent.batch_id is distinct from v_batch_id
       or v_parent.linear_issue_uuid is null
       or v_parent.linear_raw->'attribution'->>'state' is distinct from 'resolved'
       or v_parent.linear_raw->'attribution'->>'client_slug' is distinct from v_client_slug
       or v_parent.linear_raw->'issue'->'project'->>'id' is distinct from v_payload->>'project_id'
       or nullif(btrim(v_parent.linear_raw->'issue'->'parent'->>'id'), '') is not null then
      raise exception 'production_create_parent_scope';
    end if;
    v_parent_linear_id := v_parent.linear_issue_uuid;
    if v_issue->'parent'->>'id' is distinct from v_parent_linear_id then
      raise exception 'production_create_parent_route';
    end if;
    select b.* into v_batch
    from public.batches b
    where b.id = v_batch_id
    for share;
    if not found
       or v_batch.client_slug is distinct from v_client_slug
       or (v_batch.team is not null and v_batch.team is distinct from v_team)
       or v_batch.status is distinct from 'active' then
      raise exception 'production_create_batch_scope';
    end if;
    v_batch_parent_ids := public.production_batch_parent_ids_for_team(
      v_batch.linear_parent_ids,
      v_team
    );
    if cardinality(v_batch_parent_ids) <> 1
       or v_batch_parent_ids[1] is distinct from v_parent_linear_id
       or (v_direct_parent_id is null) = (v_dependency_id is null) then
      raise exception 'production_create_parent_route';
    end if;
    if v_dependency_id is not null then
      select o.* into v_dependency
      from public.mirror_outbox o
      where o.id = v_dependency_id
      for share;
      if not found
         or v_dependency.entity is distinct from 'deliverable'
         or v_dependency.entity_id is distinct from v_parent_id
         or v_dependency.operation is distinct from 'create'
         or v_dependency.client_slug is distinct from v_client_slug
         or v_dependency.team is distinct from v_team
         or v_dependency.payload->>'project_id' is distinct from v_payload->>'project_id'
         or v_dependency.status not in ('pending', 'failed', 'shadow_ok', 'written') then
        raise exception 'production_create_parent_route';
      end if;
      if v_dependency.status = 'written' and nullif(btrim(coalesce(
        v_dependency.linear_result->>'issue_id',
        v_dependency.linear_result->>'linear_issue_id',
        v_dependency.linear_result->'issue'->>'id',
        ''
      )), '') is distinct from v_parent_linear_id then
        raise exception 'production_create_parent_route';
      elsif v_dependency.status <> 'written'
            and (
              v_dependency.test_only is distinct from v_test_only
              or v_dependency.legacy_parity
            ) then
        raise exception 'production_create_parent_route';
      end if;
    elsif v_direct_parent_id is distinct from v_parent_linear_id then
      raise exception 'production_create_parent_route';
    end if;
  end if;

  v_result := public.production_deliverable_write(v_row, v_event);
  select count(*), max(o.id)
    into v_count, v_outbox_id
  from public.mirror_outbox o
  where o.dedup_key = v_dedup
    and o.entity = 'deliverable'
    and o.entity_id = v_id
    and o.operation = 'create';
  if v_count <> 1 or v_outbox_id is null then
    raise exception 'production_create_outbox_not_exact';
  end if;
  if v_parent_id is null and exists (
    select 1 from public.mirror_outbox o
    where o.entity = 'batch'
      and o.entity_id = v_batch_id
      and o.operation = 'create'
  ) then
    raise exception 'production_create_batch_outbox_forbidden';
  end if;

  update public.deliverable_events e
  set payload = (e.payload - 'outbound') || jsonb_build_object(
    'outbound_redacted',
    jsonb_build_object(
      'operation', 'create',
      'dedup_key', v_dedup,
      'intent_fingerprint', v_fingerprint
    )
  )
  where e.deliverable_id = v_id
    and e.action = 'create'
    and e.source = 'ui'
    and e.payload->'outbound'->>'dedup_key' = v_dedup;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'production_create_audit_redaction_not_exact';
  end if;

  return jsonb_build_object(
    'row', to_jsonb(v_result),
    'batch', to_jsonb(v_batch),
    'outbox_id', v_outbox_id,
    'replay', false
  );
end;
$fn$;

revoke all on function public.production_issue_create(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_issue_create(jsonb, jsonb, jsonb)
  to service_role;

-- Link an acknowledged deterministic F203 create without spreading the stale
-- pre-network entity snapshot over a newer native edit. The current row is
-- locked and only immutable identity plus the original private outbox receipt
-- are compared. The three Linear linkage fields are patched into the current
-- native issue JSON; title/brief/status/due/assignee/labels stay byte-current.
create or replace function public.production_issue_create_linkage(
  p_deliverable_id text,
  p_outbox_id bigint,
  p_expected jsonb,
  p_issue jsonb
) returns public.deliverables
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id text := nullif(btrim(coalesce(p_deliverable_id, '')), '');
  v_expected jsonb := coalesce(p_expected, '{}'::jsonb);
  v_issue jsonb := coalesce(p_issue, '{}'::jsonb);
  v_linear_id text := nullif(btrim(v_issue->>'id'), '');
  v_identifier text := nullif(btrim(v_issue->>'identifier'), '');
  v_url text := nullif(btrim(v_issue->>'url'), '');
  v_outbox public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_current_issue jsonb;
  v_patched_issue jsonb;
  v_has_later_pending boolean;
begin
  if v_id is null
     or p_outbox_id is null
     or p_outbox_id < 1
     or jsonb_typeof(v_expected) is distinct from 'object'
     or jsonb_typeof(v_issue) is distinct from 'object'
     or v_expected->>'id' is distinct from v_id
     or v_linear_id is null
     or v_expected->>'planned_linear_issue_id' is distinct from v_linear_id
     or nullif(btrim(v_expected->>'intent_fingerprint'), '') is null then
    raise exception 'invalid_production_create_linkage';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_result
  from public.deliverables d
  where d.id = v_id
  for update;
  select o.* into v_outbox
  from public.mirror_outbox o
  where o.id = p_outbox_id
  for share;
  if v_result.id is null
     or v_outbox.id is null
     or v_outbox.entity is distinct from 'deliverable'
     or v_outbox.entity_id is distinct from v_id
     or v_outbox.operation is distinct from 'create'
     or v_outbox.client_slug is distinct from v_result.client_slug
     or v_outbox.team is distinct from v_result.team
     or v_outbox.status not in ('pending', 'failed', 'shadow_ok', 'written')
     or v_outbox.payload->>'planned_linear_issue_id' is distinct from v_linear_id
     or v_outbox.payload->>'_intent_fingerprint'
          is distinct from v_expected->>'intent_fingerprint'
     or v_result.batch_id is distinct from v_expected->>'batch_id'
     or v_result.client_slug is distinct from v_expected->>'client_slug'
     or v_result.team is distinct from v_expected->>'team'
     or v_result.kind is distinct from v_expected->>'kind'
     or v_result.origin is distinct from v_expected->>'origin'
     or coalesce(v_result.card_id, '')
          is distinct from coalesce(nullif(v_expected->>'card_id', ''), '')
     or v_result.created_by is distinct from v_expected->>'created_by'
     or v_result.created_at
          is distinct from nullif(v_expected->>'created_at', '')::timestamptz
     or v_result.linear_issue_uuid is distinct from v_linear_id
     or jsonb_typeof(v_result.linear_raw) is distinct from 'object'
     or jsonb_typeof(v_result.linear_raw->'issue') is distinct from 'object' then
    raise exception 'production_create_linkage_conflict';
  end if;

  v_current_issue := v_result.linear_raw->'issue';
  v_patched_issue := jsonb_set(
    jsonb_set(
      jsonb_set(v_current_issue, '{id}', to_jsonb(v_linear_id), true),
      '{identifier}', coalesce(to_jsonb(v_identifier), 'null'::jsonb), true
    ),
    '{url}', coalesce(to_jsonb(v_url), 'null'::jsonb), true
  );
  select exists (
    select 1
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_id
      and o.id > p_outbox_id
      and o.status in ('pending', 'failed', 'shadow_ok')
  ) into v_has_later_pending;

  -- This RPC writes its own exact linkage audit row below. Suppress the
  -- generic direct-write guard so one acknowledgement cannot emit a second,
  -- misleading rpc_bypass_guard event.
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set linear_issue_uuid = v_linear_id,
      linear_identifier = v_identifier,
      linear_issue_url = v_url,
      linear_raw = jsonb_set(v_result.linear_raw, '{issue}', v_patched_issue, true),
      sync_state = case when v_has_later_pending then 'pending' else 'clean' end,
      updated_at = now()
  where d.id = v_id
  returning d.* into v_result;

  insert into public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_result.batch_id,
    v_result.client_slug,
    now(),
    'SyncView Mirror',
    'system',
    'mirror_out_create_link',
    v_result.status,
    v_result.status,
    'outbound',
    jsonb_build_object(
      'outbox_id', p_outbox_id,
      'linkage_only', true,
      'later_pending', v_has_later_pending
    )
  );
  return v_result;
end;
$fn$;

revoke all on function public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  to service_role;

-- A deterministic Linear create-id collision means the planned UUID belongs
-- to another issue. Persist a narrow, auditable quarantine without erasing the
-- one committed native issue or its immutable create receipt. Mutable native
-- fields remain intact, but sync_state plus the private identity marker make
-- the row read-only until an explicit identity-repair process replaces the
-- linkage and records a resolved marker.
create or replace function public.production_issue_create_quarantine(
  p_deliverable_id text,
  p_outbox_id bigint
) returns public.deliverables
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id text := nullif(btrim(coalesce(p_deliverable_id, '')), '');
  v_outbox public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_raw jsonb;
  v_marker jsonb;
begin
  if v_id is null or p_outbox_id is null or p_outbox_id < 1 then
    raise exception 'invalid_production_create_quarantine';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_result
  from public.deliverables d
  where d.id = v_id
  for update;
  select o.* into v_outbox
  from public.mirror_outbox o
  where o.id = p_outbox_id
  for share;

  if v_result.id is null
     or v_outbox.id is null
     or v_outbox.entity is distinct from 'deliverable'
     or v_outbox.entity_id is distinct from v_id
     or v_outbox.operation is distinct from 'create'
     or v_outbox.client_slug is distinct from v_result.client_slug
     or v_outbox.team is distinct from v_result.team
     or nullif(btrim(v_outbox.payload->>'planned_linear_issue_id'), '') is null
     or v_outbox.payload->>'planned_linear_issue_id'
          is distinct from v_result.linear_issue_uuid
     or v_outbox.linear_result->'conflict'->>'decision'
          is distinct from 'idempotency_conflict'
     or jsonb_typeof(v_result.linear_raw) is distinct from 'object' then
    raise exception 'production_create_quarantine_conflict';
  end if;

  v_raw := v_result.linear_raw;
  if v_raw->'identity_repair'->>'state' = 'required'
     and (v_raw->'identity_repair'->>'outbox_id')::bigint = p_outbox_id then
    return v_result;
  end if;
  if v_raw ? 'identity_repair' then
    raise exception 'production_create_quarantine_conflict';
  end if;

  v_marker := jsonb_build_object(
    'schema', 'syncview_create_identity_repair_v1',
    'state', 'required',
    'reason', 'linear_create_idempotency_conflict',
    'outbox_id', p_outbox_id,
    'planned_linear_issue_id', v_result.linear_issue_uuid,
    'detected_at', now()
  );

  -- This RPC emits its own exact audit row below.
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set sync_state = 'error',
      linear_raw = jsonb_set(v_raw, '{identity_repair}', v_marker, true),
      updated_at = now()
  where d.id = v_id
  returning d.* into v_result;

  insert into public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_result.batch_id,
    v_result.client_slug,
    now(),
    'SyncView Mirror',
    'system',
    'production_create_identity_quarantined',
    v_result.status,
    v_result.status,
    'outbound',
    jsonb_build_object(
      'outbox_id', p_outbox_id,
      'state', 'required',
      'reason', 'linear_create_idempotency_conflict',
      'read_only', true
    )
  );
  return v_result;
end;
$fn$;

revoke all on function public.production_issue_create_quarantine(text, bigint)
  from public, anon, authenticated;
grant execute on function public.production_issue_create_quarantine(text, bigint)
  to service_role;

commit;
