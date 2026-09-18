-- Draft/unapplied. Replaces TWO routine bodies from the dormant catalog
-- foundation. Adds nothing, grants nothing, and changes no flag.
--
-- WHY. A Linear label can be RETIRED (`retiredAt` set), which is a different
-- state from archived, and 19 of the 46 labels in the live workspace are
-- retired today. The exporter's query asked for id, name, color, description,
-- isGroup, archivedAt and team -- and nothing else -- so a capture could not
-- see retirement at all, and the serving path would have offered every retired
-- label as a live, selectable one.
--
-- THE DECISION, and it mirrors archived exactly:
--   * retired labels are KEPT in the catalog, carrying their retiredAt, so the
--     manifest still describes the whole workspace and its count still
--     reconciles. Dropping them would be a label_catalog_count_mismatch, not a
--     tidier capture.
--   * they are NEVER served as applicable. production_label_catalog_read_version
--     already filters groups and archived entries out of the catalog it serves
--     a team; retired now joins them.
--   * an EXISTING selection of a retired label still resolves for display.
--     That falls out of production_label_catalog_validate_selection unchanged:
--     it builds its known set from the card's own locked selection FIRST and
--     only then overlays the eligible catalog, so a label already on a card can
--     be retained or removed but cannot be newly added anywhere. Same as
--     archived, by the same mechanism, which is why that routine is untouched.
--
-- IT FAILS CLOSED ON AN OLD CAPTURE. `retiredAt` is REQUIRED on every label,
-- exactly as `archivedAt` is. A manifest produced by the pre-retirement
-- exporter therefore raises label_catalog_label_invalid rather than being read
-- as "nothing here is retired" -- which is the whole point, because that
-- silent reading is the bug this migration exists to prevent.
--
-- ANY CAPTURE TAKEN BEFORE THIS MERGES MUST BE RETAKEN. No capture has been
-- staged, so nothing is being invalidated in place; but a package sitting on
-- the owner's machine from an earlier run cannot satisfy this checker and must
-- not be attested.
begin;

create or replace function public.production_label_catalog_check_manifest(p_manifest jsonb)
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
         or not (v_label ? 'archivedAt') or not (v_label ? 'retiredAt') or not (v_label ? 'team') then
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
      if v_label->'retiredAt' <> 'null'::jsonb then
        if jsonb_typeof(v_label->'retiredAt') <> 'string'
           or not coalesce(v_label->>'retiredAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$', false) then
          raise exception using errcode = '22023', message = 'label_catalog_label_invalid';
        end if;
        perform (v_label->>'retiredAt')::timestamptz;
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

create or replace function public.production_label_catalog_read_version(p_version_id uuid, p_team text)
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
      and n->'retiredAt' = 'null'::jsonb
      and (n->'team' = 'null'::jsonb or n->'team'->>'id' = v_row.manifest->'teams'->>p_team);
  return jsonb_build_object('ok', true, 'schema_version', 1, 'version_id', v_row.version_id,
    'manifest_sha256', v_row.manifest_sha256, 'team', p_team,
    'verification_state', v_row.verification_state, 'catalog', v_catalog,
    'structure_complete', true, 'provider_completeness_verified', false,
    'native_activation_allowed', false, 'native_commit_allowed', false);
end;
$fn$;

-- The ACLs both routines already carry, re-stated rather than changed.
-- `create or replace function` preserves them; all four roles are named so the
-- posture is a statement, not an omission.
revoke all on function public.production_label_catalog_check_manifest(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.production_label_catalog_read_version(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.production_label_catalog_read_version(uuid,text) to service_role;
commit;
