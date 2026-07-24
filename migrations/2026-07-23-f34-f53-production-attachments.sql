-- F34/F53/F137: guarded Graphics artifacts, explicit typed asset read states,
-- and private archive-asset rescue state.
--
-- DELIBERATE ADDITIVE-ONLY EXCEPTION (owner-approved): PostgreSQL cannot alter
-- a CHECK expression in place, so widening the named mirror operation CHECK
-- requires dropping and re-adding that constraint. The replacement is a
-- strict superset: it keeps create, status, comment, due, assignee, title,
-- priority, parent, archive, restore, labels, and description, and adds only
-- attachment. The replacement is data-safe because it runs in one transaction,
-- validates every existing row, and performs no data drop, table/column drop,
-- rename, type change, or backfill.
--
-- The new service-only artifact RPC reuses production_deliverable_write for
-- authority, CAS, event, idempotency, and outbox durability, then projects the
-- canonical Graphics file into the exact linked Calendar/Samples thumbnail
-- component in the same transaction. It never calls or changes either frozen
-- browser writer. Manual Production issues have no implicit card projection.
--
-- The archive sidecar retains the original Linear-hosted reference privately
-- while making a rescued private replacement or explicit owner disposition
-- available to the protected archive reader. It does not expose archive rows
-- or original URLs to browser roles and performs no live discovery/backfill.
--
-- The four typed asset columns and legacy body JSON were inherited under
-- permissive whole-table browser SELECT. This migration preserves existing
-- scalar browser reads with explicit column grants, withholds batches'
-- filming_doc_url/footage_folder_url/delivery_folder_url plus deliverables'
-- file_url/brief/linear_raw, and also withholds the legacy `comments` JSON on
-- both tables: those bodies can carry private uploads.linear.app references and
-- are the backfill source for the protected normalized comment table, so they
-- are served only through the scoped production-comments reader, never a raw
-- deliverables?select=comments / batches?select=comments browser read. Only
-- bounded derived Production and Workload fields are exposed through a body-free
-- browser projection. Service-role reads remain unchanged.
--
-- This file is source-only until a separate post-merge, owner-approved live
-- window. It does not deploy an Edge Function, run a real TEST attachment
-- drill, rescue any live asset, change a runtime flag or authority, or touch
-- n8n, calendar-upsert, or sample-review-upsert.

begin;

alter table public.deliverables
  add column if not exists artifact_revision bigint not null default 0;

do $do$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.deliverables'::regclass
      and conname = 'deliverables_artifact_revision_check'
  ) then
    alter table public.deliverables
      add constraint deliverables_artifact_revision_check
      check (artifact_revision between 0 and 9007199254740991);
  end if;
end;
$do$;

-- Reduce Linear's complete label relation to the only two values Workload
-- consumes. Malformed, duplicated, or paginated relations fail closed instead
-- of leaking the raw issue document or silently applying partial weighting.
create or replace function public.production_workload_label_projection(
  p_raw jsonb
) returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_issue jsonb;
  v_relation jsonb;
  v_nodes jsonb;
  v_page jsonb;
  v_node jsonb;
  v_value jsonb;
  v_id text;
  v_name text;
  v_color text;
  v_ids text[] := array[]::text[];
  v_names text[] := array[]::text[];
  v_selected text[] := array[]::text[];
  v_labels jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_raw) is distinct from 'object' then
    return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
  end if;
  v_issue := p_raw->'issue';
  v_relation := v_issue->'labels';
  v_nodes := v_relation->'nodes';
  v_page := v_relation->'pageInfo';
  if jsonb_typeof(v_issue) is distinct from 'object'
     or jsonb_typeof(v_relation) is distinct from 'object'
     or jsonb_typeof(v_nodes) is distinct from 'array'
     or jsonb_typeof(v_page) is distinct from 'object'
     or jsonb_typeof(v_page->'hasNextPage') is distinct from 'boolean'
     or (v_page->>'hasNextPage')::boolean is not false
     or jsonb_array_length(v_nodes) > 250 then
    return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
  end if;

  for v_node in select value from jsonb_array_elements(v_nodes)
  loop
    if jsonb_typeof(v_node) is distinct from 'object' then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
    v_id := nullif(btrim(v_node->>'id'), '');
    v_name := nullif(btrim(v_node->>'name'), '');
    if v_id is null or length(v_id) > 200
       or v_name is null or length(v_name) > 200
       or v_id = any(v_ids)
       or v_name = any(v_names) then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
    v_ids := array_append(v_ids, v_id);
    v_names := array_append(v_names, v_name);
    if v_name in (U&'2\00D7 Workload', U&'3\00D7 Workload') then
      v_color := case
        when coalesce(v_node->>'color', '') ~ '^#[0-9A-Fa-f]{6}$'
          then upper(v_node->>'color')
        else null
      end;
      v_labels := v_labels || jsonb_build_array(jsonb_build_object(
        'id', v_id,
        'name', v_name,
        'color', v_color
      ));
    end if;
  end loop;

  if v_issue ? 'labelIds' then
    if jsonb_typeof(v_issue->'labelIds') is distinct from 'array'
       or jsonb_array_length(v_issue->'labelIds') > 250 then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
    for v_value in select value from jsonb_array_elements(v_issue->'labelIds')
    loop
      if jsonb_typeof(v_value) is distinct from 'string' then
        return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
      end if;
      v_id := nullif(btrim(v_value #>> '{}'), '');
      if v_id is null or length(v_id) > 200 or v_id = any(v_selected) then
        return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
      end if;
      v_selected := array_append(v_selected, v_id);
    end loop;
    if cardinality(v_selected) <> cardinality(v_ids)
       or exists (
         select 1 from unnest(v_selected) selected_id
         where not selected_id = any(v_ids)
       )
       or exists (
         select 1 from unnest(v_ids) node_id
         where not node_id = any(v_selected)
       ) then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
  end if;

  return jsonb_build_object('complete', true, 'labels', v_labels);
exception when others then
  return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
end;
$fn$;

revoke all on function public.production_workload_label_projection(jsonb)
  from public, anon, authenticated;
grant execute on function public.production_workload_label_projection(jsonb)
  to anon, authenticated, service_role;

create view public.production_deliverables_browser_v1
with (security_barrier = true)
as
select
  d.id,
  d.identifier,
  d.batch_id,
  d.client_slug,
  d.team,
  d.kind,
  d.title,
  d.status,
  d.status_at,
  d.assignee_id,
  d.due_date,
  d.origin,
  d.card_id,
  d.sync_state,
  d.created_at,
  d.updated_at,
  d.artifact_revision,
  d.linear_issue_uuid,
  d.linear_identifier,
  d.linear_issue_url,
  case when d.linear_raw #>> '{identity_repair,state}' in ('required', 'resolved')
    then d.linear_raw #>> '{identity_repair,state}' end as identity_repair_state,
  case when d.linear_raw #>> '{identity_repair,reason}' ~ '^[a-z][a-z0-9_]{0,79}$'
    then d.linear_raw #>> '{identity_repair,reason}' end as identity_repair_reason,
  case when d.linear_raw #>> '{identity_repair,resolved_linear_issue_id}'
      ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    then d.linear_raw #>> '{identity_repair,resolved_linear_issue_id}' end
    as identity_repair_resolved_linear_issue_id,
  case when d.linear_raw #>> '{issue,parent,id}'
      ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    then d.linear_raw #>> '{issue,parent,id}' end as raw_issue_parent_id,
  case when d.linear_raw #>> '{issue,project,id}'
      ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    then d.linear_raw #>> '{issue,project,id}' end as raw_project_id,
  case when d.linear_raw #>> '{attribution,schema}' = 'syncview_attribution_v1'
    then 'syncview_attribution_v1' end as raw_attribution_schema,
  case when d.linear_raw #>> '{attribution,state}' in (
      'resolved', 'needs_attribution', 'provisional_child_family', 'conflict'
    ) then d.linear_raw #>> '{attribution,state}' end as raw_attribution_state,
  case when d.linear_raw #>> '{attribution,client_slug}'
      ~ '^[a-z0-9][a-z0-9_-]{0,99}$'
    then d.linear_raw #>> '{attribution,client_slug}' end
    as raw_attribution_client_slug,
  case when d.linear_raw #>> '{attribution,owner_kind}' in ('client', 'internal', 'test')
    then d.linear_raw #>> '{attribution,owner_kind}' end as raw_attribution_owner_kind,
  case when d.linear_raw #>> '{attribution,source}' in (
      'direct_project', 'nearest_mapped_ancestor',
      'explicit_roster_classification', 'explicit_internal_test_classification',
      'unanimous_child_family', 'none', 'conflict'
    ) then d.linear_raw #>> '{attribution,source}' end as raw_attribution_source,
  case when d.linear_raw #>> '{attribution,provisional_client_slug}'
      ~ '^[a-z0-9][a-z0-9_-]{0,99}$'
    then d.linear_raw #>> '{attribution,provisional_client_slug}' end
    as raw_attribution_provisional_client_slug,
  case when d.linear_raw #>> '{attribution,mapping_revision}' ~ '^[a-f0-9]{64}$'
    then d.linear_raw #>> '{attribution,mapping_revision}' end
    as raw_attribution_mapping_revision,
  case when jsonb_typeof(d.linear_raw #> '{attribution,repair_required}') = 'boolean'
    then (d.linear_raw #>> '{attribution,repair_required}')::boolean end
    as raw_attribution_repair_required,
  case when d.linear_raw #>> '{attribution,reason}' ~ '^[a-z][a-z0-9_]{0,79}$'
    then d.linear_raw #>> '{attribution,reason}' end as raw_attribution_reason,
  case when jsonb_typeof(d.linear_raw #> '{attribution,explicit_owner_approved}') = 'boolean'
    then (d.linear_raw #>> '{attribution,explicit_owner_approved}')::boolean end
    as raw_attribution_explicit_owner_approved,
  coalesce(
    d.linear_raw #>> '{attribution,explicit_decision_ref}'
      ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$',
    false
  ) as raw_attribution_has_explicit_decision_ref,
  case when d.linear_raw #>> '{attribution,explicit_manifest_sha256}' ~ '^[a-f0-9]{64}$'
    then d.linear_raw #>> '{attribution,explicit_manifest_sha256}' end
    as raw_attribution_explicit_manifest_sha256,
  case when d.linear_raw #>> '{issue,archivedAt}'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    then d.linear_raw #>> '{issue,archivedAt}' end as raw_issue_archived_at,
  case when d.linear_raw #>> '{issue,canceledAt}'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    then d.linear_raw #>> '{issue,canceledAt}' end as raw_issue_canceled_at,
  case when jsonb_typeof(d.linear_raw->'webhook_delete') = 'boolean'
    then (d.linear_raw->>'webhook_delete')::boolean end as raw_webhook_delete,
  case when jsonb_typeof(d.linear_raw->'deleted') = 'boolean'
    then (d.linear_raw->>'deleted')::boolean end as raw_deleted,
  case when jsonb_typeof(d.linear_raw->'delete') = 'boolean'
    then (d.linear_raw->>'delete')::boolean end as raw_delete,
  case when jsonb_typeof(d.linear_raw->'removed') = 'boolean'
    then (d.linear_raw->>'removed')::boolean end as raw_removed,
  case when jsonb_typeof(d.linear_raw->'archived') = 'boolean'
    then (d.linear_raw->>'archived')::boolean end as raw_archived,
  (wl.projection->>'complete')::boolean as workload_labels_complete,
  wl.projection->'labels' as workload_labels
from public.deliverables d
cross join lateral (
  select public.production_workload_label_projection(d.linear_raw) as projection
) wl;

revoke all on table public.production_deliverables_browser_v1
  from public, anon, authenticated;
grant select on table public.production_deliverables_browser_v1
  to anon, authenticated;

-- Preserve browser read continuity while closing the exact raw typed-asset
-- and legacy-body column bypasses. Release the compatible UI and protected
-- readers first; an old cached client requesting those columns fails closed.
revoke select on table public.batches from public, anon, authenticated;
grant select (
  id,
  client_slug,
  team,
  name,
  description,
  color,
  status,
  sort_key,
  created_by,
  created_at,
  updated_at,
  linear_parent_ids
) on table public.batches to anon, authenticated;

revoke select on table public.deliverables from public, anon, authenticated;
grant select (
  id,
  identifier,
  batch_id,
  client_slug,
  team,
  kind,
  title,
  status,
  status_at,
  assignee_id,
  due_date,
  priority,
  origin,
  card_id,
  sort_key,
  sync_state,
  created_by,
  created_at,
  updated_at,
  linear_issue_uuid,
  linear_identifier,
  linear_issue_url,
  linear_aliases,
  artifact_revision
) on table public.deliverables to anon, authenticated;

alter table public.mirror_outbox
  drop constraint if exists mirror_outbox_operation_b4_check;

alter table public.mirror_outbox
  add constraint mirror_outbox_operation_b4_check
  check (operation in (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels', 'description',
    'attachment'
  ));

-- Preserve the installed pre-F27 enqueue contract byte-for-byte in behavior;
-- only the operation allowlist is widened by attachment.
create or replace function public.mirror_outbox_enqueue(
  p_entity text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb,
  p_dedup_key text,
  p_source_edited_at timestamptz,
  p_client_slug text,
  p_team text,
  p_actor text default null,
  p_role text default null,
  p_deliverable_id text default null,
  p_batch_id text default null,
  p_comment_id text default null,
  p_depends_on_id bigint default null,
  p_test_only boolean default false
) returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id bigint;
  v_legacy_op text;
begin
  if coalesce(p_entity, '') not in ('deliverable', 'batch', 'comment') then
    raise exception 'invalid outbound entity';
  end if;
  if coalesce(p_operation, '') not in (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels', 'description',
    'attachment'
  ) then
    raise exception 'invalid outbound operation';
  end if;
  if nullif(btrim(coalesce(p_entity_id, '')), '') is null
     or nullif(btrim(coalesce(p_dedup_key, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null
     or nullif(btrim(coalesce(p_team, '')), '') is null
     or p_source_edited_at is null then
    raise exception 'incomplete outbound intent';
  end if;

  v_legacy_op := case p_operation
    when 'create' then 'create'
    when 'status' then 'update_state'
    when 'comment' then 'comment'
    when 'archive' then 'archive'
    else 'update_fields'
  end;

  insert into public.mirror_outbox (
    deliverable_id,
    op,
    payload,
    attempts,
    created_at,
    next_retry_at,
    entity,
    entity_id,
    batch_id,
    comment_id,
    operation,
    client_slug,
    team,
    dedup_key,
    source_edited_at,
    status,
    actor,
    role,
    depends_on_id,
    updated_at,
    test_only
  ) values (
    p_deliverable_id,
    v_legacy_op,
    coalesce(p_payload, '{}'::jsonb),
    0,
    now(),
    now(),
    p_entity,
    p_entity_id,
    p_batch_id,
    p_comment_id,
    p_operation,
    p_client_slug,
    p_team,
    p_dedup_key,
    p_source_edited_at,
    'pending',
    nullif(btrim(coalesce(p_actor, '')), ''),
    nullif(btrim(coalesce(p_role, '')), ''),
    p_depends_on_id,
    now(),
    coalesce(p_test_only, false)
  )
  on conflict (dedup_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.mirror_outbox
    where dedup_key = p_dedup_key;
  end if;

  return v_id;
end;
$fn$;

-- Links can contain client media and must not be exposed through the otherwise
-- browser-readable event ledger. The protected reader/service path retains the
-- complete actor/time/from/to evidence.
drop policy if exists "protect production attachment event bodies"
  on public.deliverable_events;
create policy "protect production attachment event bodies"
  on public.deliverable_events
  as restrictive
  for select
  to anon, authenticated
  using (action is distinct from 'attachment_change');

create or replace function public.production_artifact_write(
  p_row jsonb,
  p_event jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_id text := nullif(btrim(v_row->>'id'), '');
  v_current public.deliverables%rowtype;
  v_result public.deliverables%rowtype;
  v_projection_surface text;
  v_projection_updated integer := 0;
  v_projection_matches integer := 0;
  v_revision text;
  v_next_revision bigint;
  v_dedup text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_outbound->'payload'->>'_intent_fingerprint'), '');
begin
  if v_id is null then raise exception 'production artifact id required'; end if;
  if v_outbound->>'operation' is distinct from 'attachment' then
    raise exception 'invalid production artifact operation';
  end if;
  if nullif(btrim(v_row->>'file_url'), '') is null then
    raise exception 'production artifact url required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-artifact:' || v_id, 0));
  -- Match production_deliverable_write's lock order before taking the row
  -- lock. A concurrent scalar writer may already hold this advisory lock; by
  -- waiting here (rather than while holding the row) the two paths cannot
  -- form advisory-lock <-> row-lock deadlock.
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_current
  from public.deliverables d
  where d.id = v_id
  for update;
  if not found then raise exception 'production artifact not found'; end if;
  if not exists (
    select 1 from public.clients c
    where c.slug = v_current.client_slug
      and c.active is true
  ) then
    raise exception 'production artifact active client required';
  end if;
  if lower(coalesce(v_current.team, '')) <> 'graphics'
     or lower(coalesce(v_row->>'team', '')) <> 'graphics' then
    raise exception 'production artifact graphics only';
  end if;

  perform public.production_assert_authority(
    v_current.client_slug,
    v_current.team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  -- The artifact lock makes this replay check authoritative even when two
  -- identical gateway requests raced before either outbox row was visible.
  -- Exact replay returns without revision bump, event, or card projection.
  if public.production_outbox_replay(
    coalesce(nullif(v_outbound->>'entity', ''), 'deliverable'),
    v_id,
    'attachment',
    v_current.client_slug,
    v_current.team,
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_fingerprint,
    v_dedup
  ) then
    return jsonb_build_object(
      'row', to_jsonb(v_current),
      'projection', jsonb_build_object(
        'surface', case when v_current.origin in ('calendar', 'samples')
          then v_current.origin else null end,
        'card_id', case when v_current.origin in ('calendar', 'samples')
          then v_current.card_id else null end,
        'updated', false,
        'replay', true,
        'artifact_revision', v_current.artifact_revision
      )
    );
  end if;

  v_next_revision := coalesce(v_current.artifact_revision, 0) + 1;
  if v_next_revision > 9007199254740991 then
    raise exception 'production artifact revision exhausted';
  end if;
  v_outbound := jsonb_set(
    v_outbound,
    '{payload}',
    coalesce(v_outbound->'payload', '{}'::jsonb)
      || jsonb_build_object('artifact_revision', v_next_revision),
    true
  );
  v_event := jsonb_set(v_event, '{outbound}', v_outbound, true)
    || jsonb_build_object('artifact_revision', v_next_revision);
  v_result := public.production_deliverable_write(v_row, v_event);
  update public.deliverables d
  set artifact_revision = v_next_revision
  where d.id = v_result.id
  returning d.* into v_result;
  if not found then raise exception 'production artifact revision persist failed'; end if;
  v_revision := 'artifact-' || v_next_revision::text;

  if v_result.origin = 'calendar' and nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
    v_projection_surface := 'calendar';
    update public.calendar_posts p
    set thumbnail_url = v_result.file_url,
        thumb_rev = v_revision,
        updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id;
    get diagnostics v_projection_updated = row_count;

    select count(*)::integer into v_projection_matches
    from public.calendar_posts p
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id
      and p.thumbnail_url is not distinct from v_result.file_url
      and p.thumb_rev = v_revision;
  elsif v_result.origin = 'samples' and nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
    v_projection_surface := 'samples';
    update public.sample_reviews p
    set thumbnail_url = v_result.file_url,
        thumb_rev = v_revision,
        updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id;
    get diagnostics v_projection_updated = row_count;

    select count(*)::integer into v_projection_matches
    from public.sample_reviews p
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id
      and p.thumbnail_url is not distinct from v_result.file_url
      and p.thumb_rev = v_revision;
  elsif v_result.origin <> 'manual' or nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
    raise exception 'artifact_card_projection_scope_invalid';
  end if;

  if v_projection_surface is not null
     and (v_projection_updated > 1 or v_projection_matches <> 1) then
    raise exception 'artifact_card_projection_failed';
  end if;

  return jsonb_build_object(
    'row', to_jsonb(v_result),
    'projection', jsonb_build_object(
      'surface', v_projection_surface,
      'card_id', case when v_projection_surface is null then null else v_result.card_id end,
      'updated', v_projection_updated = 1,
      'replay', false,
      'artifact_revision', v_next_revision
    )
  );
end;
$fn$;

revoke all on function public.production_artifact_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_artifact_write(jsonb, jsonb)
  to service_role;

-- Server-owned access evidence contains no URL or response body. The exact
-- canonical URL is represented only by its SHA-256, and a status transition
-- must match both the deliverable and that hash within the freshness window.
create table if not exists public.production_asset_access_checks (
  deliverable_id text not null references public.deliverables(id),
  slot text not null
    check (slot in ('filming_plan', 'raw_footage', 'delivery_folder', 'deliverable_file')),
  url_sha256 text not null check (url_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null
    check (state in (
      'missing', 'invalid', 'available', 'expired',
      'permission_denied', 'unavailable'
    )),
  http_status smallint,
  result_code text not null,
  checked_at timestamptz not null,
  checker text not null default 'production-write',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deliverable_id, slot, url_sha256),
  constraint production_asset_access_checks_code_shape check (
    result_code ~ '^[a-z][a-z0-9_]{1,63}$'
    and checker = 'production-write'
    and (http_status is null or http_status between 100 and 599)
  )
);

create index if not exists production_asset_access_checks_fresh_idx
  on public.production_asset_access_checks (deliverable_id, slot, checked_at desc);

alter table public.production_asset_access_checks enable row level security;
revoke all on table public.production_asset_access_checks from public, anon, authenticated;
grant select, insert, update on table public.production_asset_access_checks to service_role;

-- The owner seeds this singleton only in the separate gated rescue window.
-- service_role cannot read or mutate the approved private destination or the
-- dedicated rescue capability hash; the SECURITY DEFINER transition below is
-- the sole service-callable certification boundary.
create table if not exists public.linear_archive_asset_rescue_config (
  config_key text primary key check (config_key = 'active'),
  destination_provider text not null
    check (destination_provider = 'google_drive_private'),
  approved_folder_id text not null
    check (approved_folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  rescue_capability_sha256 text not null
    check (rescue_capability_sha256 ~ '^[a-f0-9]{64}$'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linear_archive_asset_rescue_config enable row level security;
revoke all on table public.linear_archive_asset_rescue_config
  from public, anon, authenticated, service_role;

create table if not exists public.linear_archive_asset_refs (
  ref_id text primary key,
  linear_uuid text not null,
  deliverable_id text references public.deliverables(id),
  comment_id text,
  client_slug text not null,
  team text,
  audience text not null default 'internal'
    check (audience in ('internal', 'client')),
  source_kind text not null
    check (source_kind in (
      'operational_brief', 'issue_description', 'archive_raw',
      'normalized_comment_body', 'comment_attachment'
    )),
  location_key text not null,
  original_url text not null,
  original_url_sha256 text not null
    check (original_url_sha256 ~ '^[a-f0-9]{64}$'),
  rescued_url text,
  destination_provider text,
  destination_folder_id text,
  destination_file_id text,
  content_sha256 text,
  byte_length bigint,
  verified_at timestamptz,
  verification_receipt_hmac text,
  state text not null default 'pending'
    check (state in ('pending', 'rescued', 'owner_dispositioned', 'failed')),
  media_type text,
  last_error_code text,
  reviewed_by text,
  review_note text,
  owner_evidence jsonb,
  discovered_at timestamptz not null default now(),
  rescued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linear_archive_asset_refs_identity_unique
    unique (linear_uuid, source_kind, location_key, original_url_sha256),
  constraint linear_archive_asset_refs_url_state_check check (
    lower(original_url) ~ '^https://uploads[.]linear[.]app/'
    and (
      (state = 'rescued'
        and destination_provider = 'google_drive_private'
        and destination_folder_id ~ '^[A-Za-z0-9_-]{10,200}$'
        and destination_file_id ~ '^[A-Za-z0-9_-]{10,200}$'
        and rescued_url = 'https://drive.google.com/file/d/' || destination_file_id || '/view'
        and content_sha256 ~ '^[a-f0-9]{64}$'
        and byte_length between 1 and 52428800
        and verified_at is not null
        and verification_receipt_hmac ~ '^[a-f0-9]{64}$')
      or (state <> 'rescued'
        and rescued_url is null
        and destination_provider is null
        and destination_folder_id is null
        and destination_file_id is null
        and content_sha256 is null
        and byte_length is null
        and verified_at is null
        and verification_receipt_hmac is null)
    )
  ),
  constraint linear_archive_asset_refs_owner_evidence_check check (
    (state = 'owner_dispositioned'
      and jsonb_typeof(owner_evidence) = 'object'
      and nullif(btrim(owner_evidence->>'confirmed_by'), '') is not null
      and nullif(btrim(owner_evidence->>'confirmed_at'), '') is not null
      and nullif(btrim(owner_evidence->>'decision'), '') is not null)
    or (state <> 'owner_dispositioned' and owner_evidence is null)
  )
);

create index if not exists linear_archive_asset_refs_issue_idx
  on public.linear_archive_asset_refs (linear_uuid, audience, source_kind, location_key);
create index if not exists linear_archive_asset_refs_gap_idx
  on public.linear_archive_asset_refs (state, client_slug, team, updated_at);

alter table public.linear_archive_asset_refs enable row level security;
revoke all on table public.linear_archive_asset_refs from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.linear_archive_asset_refs
  from service_role;
grant select on table public.linear_archive_asset_refs to service_role;

create or replace function public.linear_archive_asset_ref_write(
  p_ref jsonb,
  p_expected_updated_at timestamptz default null,
  p_rescue_capability text default null
) returns public.linear_archive_asset_refs
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref jsonb := coalesce(p_ref, '{}'::jsonb);
  v_ref_id text := nullif(btrim(v_ref->>'ref_id'), '');
  v_linear_uuid text := nullif(btrim(v_ref->>'linear_uuid'), '');
  v_source_kind text := nullif(btrim(v_ref->>'source_kind'), '');
  v_location_key text := nullif(btrim(v_ref->>'location_key'), '');
  v_original_url text := nullif(btrim(v_ref->>'original_url'), '');
  v_hash text;
  v_state text := lower(coalesce(nullif(btrim(v_ref->>'state'), ''), 'pending'));
  v_rescued_url text := nullif(btrim(v_ref->>'rescued_url'), '');
  v_deliverable_id text := nullif(btrim(v_ref->>'deliverable_id'), '');
  v_comment_id text := nullif(btrim(v_ref->>'comment_id'), '');
  v_client_slug text;
  v_team text;
  v_audience text;
  v_media_type text := nullif(btrim(v_ref->>'media_type'), '');
  v_last_error_code text := nullif(btrim(v_ref->>'last_error_code'), '');
  v_reviewed_by text := nullif(btrim(v_ref->>'reviewed_by'), '');
  v_review_note text := nullif(btrim(v_ref->>'review_note'), '');
  v_owner_evidence jsonb := v_ref->'owner_evidence';
  v_destination_provider text := nullif(btrim(v_ref->>'destination_provider'), '');
  v_destination_folder_id text := nullif(btrim(v_ref->>'destination_folder_id'), '');
  v_destination_file_id text := nullif(btrim(v_ref->>'destination_file_id'), '');
  v_content_sha256 text := lower(nullif(btrim(v_ref->>'content_sha256'), ''));
  v_byte_length_text text := nullif(btrim(v_ref->>'byte_length'), '');
  v_byte_length bigint;
  v_verified_at_text text := nullif(btrim(v_ref->>'verified_at'), '');
  v_verified_at timestamptz;
  v_verification_receipt_hmac text :=
    lower(nullif(btrim(v_ref->>'verification_receipt_hmac'), ''));
  v_expected_receipt_hmac text;
  v_receipt_material text;
  v_config public.linear_archive_asset_rescue_config%rowtype;
  v_archive public.linear_archive%rowtype;
  v_deliverable public.deliverables%rowtype;
  v_comment public.production_comments%rowtype;
  v_existing public.linear_archive_asset_refs%rowtype;
  v_result public.linear_archive_asset_refs%rowtype;
begin
  v_hash := encode(
    extensions.digest(convert_to(coalesce(v_original_url, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  if v_source_kind = 'operational_brief' then
    if v_deliverable_id is null then
      raise exception 'archive_asset_deliverable_required';
    end if;
    select d.* into v_deliverable
    from public.deliverables d
    where d.id = v_deliverable_id
      and d.linear_issue_uuid = v_linear_uuid;
    if not found then raise exception 'archive_asset_deliverable_scope_invalid'; end if;
    v_comment_id := null;
    v_client_slug := nullif(btrim(v_deliverable.client_slug), '');
    v_team := nullif(lower(btrim(v_deliverable.team)), '');
    v_audience := 'internal';
    if position(v_original_url in coalesce(v_deliverable.brief, '')) = 0 then
      raise exception 'archive_asset_source_mismatch';
    end if;
  elsif v_source_kind in ('normalized_comment_body', 'comment_attachment') then
    v_deliverable_id := null;
    if v_comment_id is null then raise exception 'archive_asset_comment_required'; end if;
    select c.* into v_comment
    from public.production_comments c
    where c.id = v_comment_id
      and c.linear_issue_uuid = v_linear_uuid;
    if not found then raise exception 'archive_asset_comment_scope_invalid'; end if;
    v_client_slug := nullif(btrim(v_comment.client_slug), '');
    v_team := nullif(lower(btrim(v_comment.team)), '');
    v_audience := lower(v_comment.audience);
    if (v_source_kind = 'normalized_comment_body'
          and position(v_original_url in coalesce(v_comment.body, '')) = 0)
       or (v_source_kind = 'comment_attachment'
          and position(v_original_url in coalesce(v_comment.attachments::text, '')) = 0) then
      raise exception 'archive_asset_source_mismatch';
    end if;
  else
    v_deliverable_id := null;
    v_comment_id := null;
    select a.* into v_archive
    from public.linear_archive a
    where a.linear_uuid = v_linear_uuid;
    if not found then raise exception 'archive_asset_issue_not_found'; end if;
    v_client_slug := nullif(btrim(v_archive.client_slug), '');
    v_team := nullif(lower(btrim(v_archive.team)), '');
    v_audience := 'internal';
    if position(v_original_url in to_jsonb(v_archive)::text) = 0 then
      raise exception 'archive_asset_source_mismatch';
    end if;
  end if;

  if v_state = 'rescued' then
    if v_byte_length_text !~ '^[1-9][0-9]{0,7}$'
       or v_verified_at_text is null
       or v_verified_at_text !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then
      raise exception 'archive_asset_certification_invalid';
    end if;
    v_byte_length := v_byte_length_text::bigint;
    v_verified_at := v_verified_at_text::timestamptz;
    select c.* into v_config
    from public.linear_archive_asset_rescue_config c
    where c.config_key = 'active'
      and c.active is true;
    if not found
       or v_destination_provider is distinct from v_config.destination_provider
       or v_destination_folder_id is distinct from v_config.approved_folder_id
       or encode(
         extensions.digest(
           convert_to(coalesce(p_rescue_capability, ''), 'UTF8'),
           'sha256'
         ),
         'hex'
       ) is distinct from v_config.rescue_capability_sha256 then
      raise exception 'archive_asset_certification_forbidden';
    end if;
    if v_destination_file_id !~ '^[A-Za-z0-9_-]{10,200}$'
       or v_content_sha256 !~ '^[a-f0-9]{64}$'
       or v_byte_length not between 1 and 52428800
       or v_verified_at > now() + interval '5 minutes'
       or v_verification_receipt_hmac !~ '^[a-f0-9]{64}$' then
      raise exception 'archive_asset_certification_invalid';
    end if;
    v_rescued_url :=
      'https://drive.google.com/file/d/' || v_destination_file_id || '/view';
    v_receipt_material := concat_ws(
      chr(31),
      v_ref_id,
      v_hash,
      v_destination_folder_id,
      v_destination_file_id,
      v_content_sha256,
      v_byte_length::text,
      v_verified_at_text
    );
    v_expected_receipt_hmac := encode(
      extensions.hmac(
        convert_to(v_receipt_material, 'UTF8'),
        convert_to(p_rescue_capability, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    if v_verification_receipt_hmac is distinct from v_expected_receipt_hmac then
      raise exception 'archive_asset_certification_invalid';
    end if;
  elsif v_state = 'owner_dispositioned' then
    select c.* into v_config
    from public.linear_archive_asset_rescue_config c
    where c.config_key = 'active'
      and c.active is true;
    if not found
       or encode(
         extensions.digest(
           convert_to(coalesce(p_rescue_capability, ''), 'UTF8'),
           'sha256'
         ),
         'hex'
       ) is distinct from v_config.rescue_capability_sha256 then
      raise exception 'archive_asset_disposition_forbidden';
    end if;
  end if;

  if v_ref_id is null or v_ref_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,199}$'
     or v_linear_uuid is null or v_source_kind is null or v_location_key is null
     or v_original_url is null or v_hash !~ '^[a-f0-9]{64}$'
     or lower(v_original_url) !~ '^https://uploads[.]linear[.]app/'
     or v_source_kind not in (
       'operational_brief', 'issue_description', 'archive_raw',
       'normalized_comment_body', 'comment_attachment'
     )
     or v_state not in ('pending', 'rescued', 'owner_dispositioned', 'failed')
     or (v_state = 'rescued' and (
        v_rescued_url is null
        or v_rescued_url !~ '^https://drive[.]google[.]com/file/d/[A-Za-z0-9_-]+/view$'
        or v_destination_provider is null
        or v_destination_folder_id is null
        or v_destination_file_id is null
        or v_content_sha256 is null
        or v_byte_length is null
        or v_verified_at is null
        or v_verification_receipt_hmac is null
        or v_reviewed_by is null
        or v_review_note is null
      ))
     or (v_state <> 'rescued' and (
       v_rescued_url is not null
       or v_destination_provider is not null
       or v_destination_folder_id is not null
       or v_destination_file_id is not null
       or v_content_sha256 is not null
       or v_byte_length_text is not null
       or v_verified_at_text is not null
       or v_verification_receipt_hmac is not null
     ))
     or (v_state = 'owner_dispositioned' and (
       v_reviewed_by is null
       or v_review_note is null
       or jsonb_typeof(v_owner_evidence) is distinct from 'object'
       or nullif(btrim(v_owner_evidence->>'confirmed_by'), '') is null
       or nullif(btrim(v_owner_evidence->>'confirmed_at'), '') is null
       or nullif(btrim(v_owner_evidence->>'decision'), '') is null
       or v_owner_evidence->>'confirmed_by' is distinct from v_reviewed_by
     ))
     or (v_state <> 'owner_dispositioned' and v_owner_evidence is not null)
     or v_client_slug is null
     or v_audience not in ('internal', 'client') then
    raise exception 'invalid_archive_asset_ref';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('archive-asset:' || v_ref_id, 0));
  select r.* into v_existing
  from public.linear_archive_asset_refs r
  where r.ref_id = v_ref_id
  for update;

  if found then
    if v_existing.linear_uuid is distinct from v_linear_uuid
       or v_existing.source_kind is distinct from v_source_kind
       or v_existing.location_key is distinct from v_location_key
       or v_existing.original_url_sha256 is distinct from v_hash
       or v_existing.original_url is distinct from v_original_url
       or v_existing.deliverable_id is distinct from v_deliverable_id then
      raise exception 'archive_asset_identity_conflict';
    end if;
    -- Exact retries are immutable no-ops, including terminal provenance.
    if v_existing.comment_id is not distinct from v_comment_id
       and v_existing.client_slug is not distinct from v_client_slug
       and v_existing.team is not distinct from v_team
       and v_existing.audience is not distinct from v_audience
       and v_existing.state is not distinct from v_state
       and v_existing.rescued_url is not distinct from v_rescued_url
       and v_existing.destination_provider is not distinct from v_destination_provider
       and v_existing.destination_folder_id is not distinct from v_destination_folder_id
       and v_existing.destination_file_id is not distinct from v_destination_file_id
       and v_existing.content_sha256 is not distinct from v_content_sha256
       and v_existing.byte_length is not distinct from v_byte_length
       and v_existing.verified_at is not distinct from v_verified_at
       and v_existing.verification_receipt_hmac is not distinct from v_verification_receipt_hmac
       and v_existing.media_type is not distinct from v_media_type
       and v_existing.last_error_code is not distinct from v_last_error_code
       and v_existing.reviewed_by is not distinct from v_reviewed_by
       and v_existing.review_note is not distinct from v_review_note
       and v_existing.owner_evidence is not distinct from v_owner_evidence then
      return v_existing;
    end if;
    if p_expected_updated_at is null
       or v_existing.updated_at is distinct from p_expected_updated_at then
      raise exception 'archive_asset_write_conflict';
    end if;
    if v_existing.state in ('rescued', 'owner_dispositioned') then
      raise exception 'archive_asset_terminal';
    end if;

    update public.linear_archive_asset_refs r
    set deliverable_id = v_deliverable_id,
        comment_id = v_comment_id,
        client_slug = v_client_slug,
        team = v_team,
        audience = v_audience,
        state = v_state,
        rescued_url = v_rescued_url,
        destination_provider = v_destination_provider,
        destination_folder_id = v_destination_folder_id,
        destination_file_id = v_destination_file_id,
        content_sha256 = v_content_sha256,
        byte_length = v_byte_length,
        verified_at = v_verified_at,
        verification_receipt_hmac = v_verification_receipt_hmac,
        media_type = v_media_type,
        last_error_code = v_last_error_code,
        reviewed_by = v_reviewed_by,
        review_note = v_review_note,
        owner_evidence = v_owner_evidence,
        rescued_at = case
          when v_state = 'rescued' then coalesce(r.rescued_at, now())
          else null
        end,
        updated_at = now()
    where r.ref_id = v_ref_id
    returning r.* into v_result;
  else
    if p_expected_updated_at is not null then
      raise exception 'archive_asset_write_conflict';
    end if;
    insert into public.linear_archive_asset_refs (
      ref_id, linear_uuid, deliverable_id, comment_id, client_slug, team, audience,
      source_kind, location_key, original_url, original_url_sha256,
      rescued_url, destination_provider, destination_folder_id,
      destination_file_id, content_sha256, byte_length, verified_at,
      verification_receipt_hmac, state, media_type, last_error_code, reviewed_by,
      review_note, owner_evidence, rescued_at
    ) values (
      v_ref_id,
      v_linear_uuid,
      v_deliverable_id,
      v_comment_id,
      v_client_slug,
      v_team,
      v_audience,
      v_source_kind,
      v_location_key,
      v_original_url,
      v_hash,
      v_rescued_url,
      v_destination_provider,
      v_destination_folder_id,
      v_destination_file_id,
      v_content_sha256,
      v_byte_length,
      v_verified_at,
      v_verification_receipt_hmac,
      v_state,
      v_media_type,
      v_last_error_code,
      v_reviewed_by,
      v_review_note,
      v_owner_evidence,
      case when v_state = 'rescued' then now() else null end
    )
    returning * into v_result;
  end if;

  if v_result.client_slug is null or v_result.audience not in ('internal', 'client')
     or v_result.source_kind not in (
       'operational_brief', 'issue_description', 'archive_raw',
       'normalized_comment_body', 'comment_attachment'
     ) then
    raise exception 'invalid_archive_asset_ref';
  end if;
  return v_result;
end;
$fn$;

revoke all on function public.linear_archive_asset_ref_write(jsonb, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.linear_archive_asset_ref_write(jsonb, timestamptz, text)
  to service_role;

commit;
