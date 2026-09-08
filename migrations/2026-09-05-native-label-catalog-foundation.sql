-- DORMANT FOUNDATION ONLY. No provider route, runtime flag, writer, receipt,
-- taxonomy UI, or retirement epoch changes. No real catalog is installed.
-- A closed page manifest proves its internal structure, NOT that the provider
-- returned the whole workspace. Activation/active reads always refuse below.
-- This private owner must join the schema/data backup corpus before rollout.
begin;

create table public.production_label_catalog_versions (
  version_id uuid primary key,
  schema_version integer not null check (schema_version = 1),
  manifest jsonb not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  staged_at timestamptz not null default clock_timestamp(),
  staged_db_session text not null default session_user,
  verification_state text not null default 'structure_validated_only'
    check (verification_state = 'structure_validated_only')
);
alter table public.production_label_catalog_versions enable row level security;
revoke all on public.production_label_catalog_versions from public, anon, authenticated, service_role;

-- Retain staged evidence across edits/deletes/rollback. A database owner can
-- still change DDL or disable a trigger; that privileged threat is not solved
-- by an ordinary row trigger and needs the private authenticated backup lane.
create function public.production_label_catalog_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $fn$
begin
  raise exception using errcode = '55000', message = 'label_catalog_immutable';
end;
$fn$;
revoke all on function public.production_label_catalog_immutable() from public, anon, authenticated, service_role;
create trigger production_label_catalog_no_change
  before update or delete on public.production_label_catalog_versions
  for each row execute function public.production_label_catalog_immutable();
create trigger production_label_catalog_no_truncate
  before truncate on public.production_label_catalog_versions
  for each statement execute function public.production_label_catalog_immutable();

-- Checks every label BEFORE applicability filtering, including foreign-team,
-- group and archived entries. Missing metadata is never treated as global.
create function public.production_label_catalog_check_manifest(p_manifest jsonb)
returns text language plpgsql immutable set search_path = pg_catalog, public as $fn$
declare
  v_page jsonb; v_label jsonb; v_team jsonb; v_value text;
  v_pages integer; v_index integer := 0; v_count integer := 0;
  v_after text := null; v_cursor text; v_more boolean;
  v_ids text[] := array[]::text[]; v_cursors text[] := array[]::text[];
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
     or octet_length(p_manifest::text) > 5242880
     or p_manifest->'schema_version' is distinct from '1'::jsonb
     or p_manifest->>'source_kind' is distinct from 'linear_workspace_issue_labels'
     or not coalesce(p_manifest->>'capture_id' ~ v_uuid, false)
     or not coalesce(p_manifest->>'source_sha256' ~ '^[0-9a-f]{64}$', false)
     or not coalesce(p_manifest->>'workspace_fingerprint' ~ '^[0-9a-f]{64}$', false)
     or p_manifest->'include_archived' is distinct from 'true'::jsonb
     or jsonb_typeof(p_manifest->'captured_at') is distinct from 'string'
     or not coalesce(p_manifest->>'captured_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$', false)
     or jsonb_typeof(p_manifest->'teams') is distinct from 'object'
     or not coalesce(p_manifest->'teams'->>'video' ~ v_uuid, false)
     or not coalesce(p_manifest->'teams'->>'graphics' ~ v_uuid, false)
     or p_manifest->'teams'->>'video' = p_manifest->'teams'->>'graphics'
     or jsonb_typeof(p_manifest->'expected_count') is distinct from 'number'
     or not coalesce(p_manifest->>'expected_count' ~ '^(0|[1-9][0-9]{0,3})$', false)
     or jsonb_typeof(p_manifest->'pages') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'label_catalog_manifest_invalid';
  end if;
  perform (p_manifest->>'captured_at')::timestamptz;
  v_pages := jsonb_array_length(p_manifest->'pages');
  if v_pages < 1 or v_pages > 50 or (p_manifest->>'expected_count')::integer > 5000 then
    raise exception using errcode = '22023', message = 'label_catalog_manifest_invalid';
  end if;
  for v_page in select value from jsonb_array_elements(p_manifest->'pages') loop
    v_index := v_index + 1;
    if jsonb_typeof(v_page) <> 'object'
       or not (v_page ? 'after')
       or (v_page->'after' <> 'null'::jsonb and jsonb_typeof(v_page->'after') <> 'string')
       or v_page->>'after' is distinct from v_after
       or jsonb_typeof(v_page->'nodes') is distinct from 'array'
       or jsonb_typeof(v_page->'pageInfo') is distinct from 'object'
       or jsonb_typeof(v_page->'pageInfo'->'hasNextPage') is distinct from 'boolean'
       or not (v_page->'pageInfo' ? 'endCursor')
       or (v_page->'pageInfo'->'endCursor' <> 'null'::jsonb
           and jsonb_typeof(v_page->'pageInfo'->'endCursor') <> 'string') then
      raise exception using errcode = '22023', message = 'label_catalog_page_invalid';
    end if;
    v_more := (v_page->'pageInfo'->>'hasNextPage')::boolean;
    v_cursor := v_page->'pageInfo'->>'endCursor';
    if v_more is distinct from (v_index < v_pages)
       or jsonb_array_length(v_page->'nodes') > 100
       or (v_more and (jsonb_array_length(v_page->'nodes') = 0 or coalesce(btrim(v_cursor), '') = ''))
       or (v_cursor is not null and (btrim(v_cursor) <> v_cursor or v_cursor = '' or length(v_cursor) > 1024 or v_cursor = any(v_cursors))) then
      raise exception using errcode = '22023', message = 'label_catalog_page_incomplete';
    end if;
    if v_cursor is not null then v_cursors := array_append(v_cursors, v_cursor); end if;
    v_after := v_cursor;
    for v_label in select value from jsonb_array_elements(v_page->'nodes') loop
      if jsonb_typeof(v_label) <> 'object'
         or not coalesce(v_label->>'id' ~ v_uuid, false)
         or jsonb_typeof(v_label->'name') is distinct from 'string'
         or coalesce(btrim(v_label->>'name'), '') = ''
         or length(v_label->>'name') > 1000
         or not coalesce(v_label->>'color' ~ '^#[0-9a-fA-F]{6}$', false)
         or not (v_label ? 'description')
         or (v_label->'description' <> 'null'::jsonb and jsonb_typeof(v_label->'description') <> 'string')
         or jsonb_typeof(v_label->'isGroup') is distinct from 'boolean'
         or not (v_label ? 'archivedAt') or not (v_label ? 'team') then
        raise exception using errcode = '22023', message = 'label_catalog_label_invalid';
      end if;
      if v_label->>'id' = any(v_ids) then
        raise exception using errcode = '22023', message = 'label_catalog_duplicate_identity';
      end if;
      if v_label->'archivedAt' <> 'null'::jsonb then
        if jsonb_typeof(v_label->'archivedAt') <> 'string'
           or not coalesce(v_label->>'archivedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$', false) then
          raise exception using errcode = '22023', message = 'label_catalog_label_invalid';
        end if;
        perform (v_label->>'archivedAt')::timestamptz;
      end if;
      v_team := v_label->'team';
      if v_team <> 'null'::jsonb and (jsonb_typeof(v_team) <> 'object'
          or not coalesce(v_team->>'id' ~ v_uuid, false)) then
        raise exception using errcode = '22023', message = 'label_catalog_team_invalid';
      end if;
      v_ids := array_append(v_ids, v_label->>'id'); v_count := v_count + 1;
    end loop;
  end loop;
  if v_count <> (p_manifest->>'expected_count')::integer then
    raise exception using errcode = '22023', message = 'label_catalog_count_mismatch';
  end if;
  -- PostgreSQL jsonb text digest, not the original export bytes. The independent
  -- source_sha256 remains an unverified claim until the held attestor exists.
  return encode(sha256(convert_to(p_manifest::text, 'UTF8')), 'hex');
end;
$fn$;
revoke all on function public.production_label_catalog_check_manifest(jsonb) from public, anon, authenticated, service_role;

create function public.production_label_catalog_stage(p_version_id uuid, p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_hash text; v_row public.production_label_catalog_versions%rowtype;
begin
  if p_version_id is null then raise exception using errcode = '22023', message = 'label_catalog_version_required'; end if;
  v_hash := public.production_label_catalog_check_manifest(p_manifest);
  insert into public.production_label_catalog_versions (version_id, schema_version, manifest, manifest_sha256)
    values (p_version_id, 1, p_manifest, v_hash) on conflict (version_id) do nothing;
  select * into strict v_row from public.production_label_catalog_versions where version_id = p_version_id;
  if v_row.manifest is distinct from p_manifest or v_row.manifest_sha256 <> v_hash then
    raise exception using errcode = '23505', message = 'label_catalog_version_conflict';
  end if;
  return jsonb_build_object('ok', true, 'version_id', v_row.version_id,
    'manifest_sha256', v_row.manifest_sha256, 'verification_state', v_row.verification_state,
    'native_activation_allowed', false, 'native_commit_allowed', false);
end;
$fn$;

create function public.production_label_catalog_read_version(p_version_id uuid, p_team text)
returns jsonb language plpgsql security definer stable set search_path = pg_catalog, public as $fn$
declare v_row public.production_label_catalog_versions%rowtype; v_catalog jsonb;
begin
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception using errcode = '22023', message = 'label_catalog_team_invalid';
  end if;
  select * into v_row from public.production_label_catalog_versions where version_id = p_version_id;
  if not found then raise exception using errcode = 'P0002', message = 'label_catalog_version_unavailable'; end if;
  if public.production_label_catalog_check_manifest(v_row.manifest) <> v_row.manifest_sha256 then
    raise exception using errcode = '55000', message = 'label_catalog_digest_mismatch';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', n->>'id', 'name', btrim(n->>'name'),
    'color', n->>'color', 'description', nullif(btrim(n->>'description'), '')) order by n->>'id'), '[]'::jsonb)
    into v_catalog
    from jsonb_array_elements(v_row.manifest->'pages') p,
         lateral jsonb_array_elements(p->'nodes') n
    where n->'isGroup' = 'false'::jsonb and n->'archivedAt' = 'null'::jsonb
      and (n->'team' = 'null'::jsonb or n->'team'->>'id' = v_row.manifest->'teams'->>p_team);
  return jsonb_build_object('ok', true, 'schema_version', 1, 'version_id', v_row.version_id,
    'manifest_sha256', v_row.manifest_sha256, 'team', p_team,
    'verification_state', v_row.verification_state, 'catalog', v_catalog,
    'structure_complete', true, 'provider_completeness_verified', false,
    'native_activation_allowed', false, 'native_commit_allowed', false);
end;
$fn$;

-- Validation-only service seam. p_selected must eventually come from the exact
-- authenticated, locked native deliverable, never browser-supplied metadata.
-- Existing selected-only/archived/foreign labels can be retained or removed;
-- the same identity cannot be newly added on another card through this seam.
create function public.production_label_catalog_validate_selection(
  p_version_id uuid, p_team text, p_selected jsonb, p_requested_ids jsonb
) returns jsonb language plpgsql security definer stable set search_path = pg_catalog, public as $fn$
declare v_read jsonb; v_node jsonb; v_value jsonb; v_id text; v_selected jsonb := '[]'::jsonb;
  v_known jsonb := '{}'::jsonb; v_seen text[] := array[]::text[];
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  v_read := public.production_label_catalog_read_version(p_version_id, p_team);
  if p_selected is null or jsonb_typeof(p_selected) <> 'array'
     or p_requested_ids is null or jsonb_typeof(p_requested_ids) <> 'array'
     or jsonb_array_length(p_selected) > 5000 or jsonb_array_length(p_requested_ids) > 5000 then
    raise exception using errcode = '22023', message = 'native_label_state_incomplete';
  end if;
  for v_node in select value from jsonb_array_elements(p_selected) loop
    v_id := v_node->>'id';
    if jsonb_typeof(v_node) <> 'object' or not coalesce(v_id ~ v_uuid, false)
       or jsonb_typeof(v_node->'name') is distinct from 'string'
       or coalesce(btrim(v_node->>'name'), '') = ''
       or not coalesce(v_node->>'color' ~ '^#[0-9a-fA-F]{6}$', false)
       or not (v_node ? 'description')
       or (v_node->'description' <> 'null'::jsonb and jsonb_typeof(v_node->'description') <> 'string')
       or v_known ? v_id then
      raise exception using errcode = '22023', message = 'native_label_state_incomplete';
    end if;
    v_known := v_known || jsonb_build_object(v_id, jsonb_build_object(
      'id', v_id, 'name', btrim(v_node->>'name'), 'color', v_node->>'color',
      'description', nullif(btrim(v_node->>'description'), '')));
  end loop;
  -- Current eligible metadata wins, matching the existing provider lane.
  for v_node in select value from jsonb_array_elements(v_read->'catalog') loop
    v_known := v_known || jsonb_build_object(v_node->>'id', v_node);
  end loop;
  for v_value in select value from jsonb_array_elements(p_requested_ids) loop
    v_id := v_value #>> '{}';
    if jsonb_typeof(v_value) <> 'string' or not coalesce(v_id ~ v_uuid, false) or v_id = any(v_seen) then
      raise exception using errcode = '22023', message = 'invalid_label_ids';
    end if;
    if not (v_known ? v_id) then raise exception using errcode = '22023', message = 'label_not_applicable'; end if;
    v_seen := array_append(v_seen, v_id);
  end loop;
  select coalesce(jsonb_agg(v_known->x order by x), '[]'::jsonb) into v_selected from unnest(v_seen) x;
  return (v_read - 'catalog') || jsonb_build_object('validation_only', true,
    'selected_label_ids', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(v_seen) x),
    'selected_labels', v_selected);
end;
$fn$;

-- No activation row/table/flag exists to flip. Implementing a real attestor
-- and joining the existing authority/F27/retirement receipt contract requires
-- a separately reviewed source change. Service credentials cannot waive this.
create function public.production_label_catalog_activate(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  raise exception using errcode = '55000', message = 'label_catalog_activation_held';
end;
$fn$;
create function public.production_label_catalog_read_active(p_team text)
returns jsonb language plpgsql security definer stable set search_path = pg_catalog, public as $fn$
begin
  raise exception using errcode = '55000', message = 'label_catalog_activation_held';
end;
$fn$;

revoke all on function public.production_label_catalog_stage(uuid,jsonb),
  public.production_label_catalog_read_version(uuid,text),
  public.production_label_catalog_validate_selection(uuid,text,jsonb,jsonb),
  public.production_label_catalog_activate(uuid), public.production_label_catalog_read_active(text)
  from public, anon, authenticated, service_role;
grant execute on function public.production_label_catalog_stage(uuid,jsonb),
  public.production_label_catalog_read_version(uuid,text),
  public.production_label_catalog_validate_selection(uuid,text,jsonb,jsonb),
  public.production_label_catalog_activate(uuid), public.production_label_catalog_read_active(text)
  to service_role;
commit;
