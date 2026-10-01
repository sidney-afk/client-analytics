-- ============================================================
-- 2026-10-03 -- A test-only way to create (and delete) a throwaway client, so
-- the "Create client" button can be proved for real without leaving anything
-- behind (docs/plans/2026-10-01-onboarding-checklist-and-profile.md, step 2.5,
-- owner choice A on 2026-10-01).
--
-- SOURCE-ONLY. Not applied. Lighthouse applies it by hand in the SQL editor, and
-- only after the owner's go at that moment. The real function
-- production_native_client_provision() and its immutable receipt table are NOT
-- touched. APPLY ORDER: after Roster's 2026-10-02-roster-native.sql (the
-- profile is created by its client_profile_service_write(), which refuses
-- unless client_profiles_authority reads 'syncview') and after
-- 2026-10-03-onboarding-checklist-tables.sql (the checklist rows).
--
-- WHY A SEPARATE PATH. The real function always writes kind = 'client' and an
-- immutable receipt that references the client with ON DELETE RESTRICT, so a
-- client it creates can never be deleted. This path copies the real function's
-- creation steps (same checks, same project-id shape, same token, same four
-- routing lists) with four differences:
--   1. kind = 'test' and source = 'syncview_native_test';
--   2. the receipt goes to production_native_client_test_provisions, which can
--      be deleted with the client;
--   3. it refuses any client that is not clearly a throwaway: the display name
--      must start with "ZZ THROWAWAY" and the slug with "zzthrowaway";
--   4. it never queues Slack. Nothing in this file touches the Slack queue or
--      the channel finalizer, and the profile it creates has no Clients Info
--      Sheet row: the outbox row Roster's function queues is deleted in the same
--      transaction, so the Sheet copy never sees the throwaway. The "Create
--      client" Edge Function must also not call the finalizer for kind 'test'.
--
-- production_native_client_test_teardown() removes a throwaway completely:
-- routing entries, review token, profile, its edit history and its checklist
-- rows (they cascade with the profile), the test receipt and the roster row.
-- It refuses anything that is not a verified throwaway, and refuses (never
-- deletes around) a throwaway that has gained work: cards, samples, filming plan,
-- templates, credentials, batches, deliverables, triage or notification rows.
-- The checklist event history is append-only by design and stays.
--
-- ACCESS. Every privilege on the table and both functions is revoked from all
-- four roles (public, anon, authenticated, service_role); service_role alone
-- gets EXECUTE on the two functions. The table is reachable only through them.
--
-- Idempotent: safe to run twice. Rollback: drop the two functions and the table.
-- ============================================================
begin;

create extension if not exists pgcrypto;

create table if not exists public.production_native_client_test_provisions (
  request_id         text primary key,
  client_slug        text not null unique references public.clients (slug) on delete cascade,
  intent_sha256      text not null check (intent_sha256 ~ '^[0-9a-f]{64}$'),
  native_project_ids jsonb not null check (jsonb_typeof(native_project_ids) = 'object'),
  created_by         text not null,
  created_at         timestamptz not null default now()
);
alter table public.production_native_client_test_provisions enable row level security;
revoke all on table public.production_native_client_test_provisions from public, anon, authenticated, service_role;

create or replace function public.production_native_client_test_provision(
  p_request_id text,
  p_client_slug text,
  p_display_name text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fn$
declare
  v_request_id text := btrim(coalesce(p_request_id, ''));
  v_slug text := lower(btrim(coalesce(p_client_slug, '')));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_actor text := btrim(coalesce(p_actor, ''));
  v_intent_sha256 text;
  v_existing public.production_native_client_test_provisions;
  v_client public.clients;
  v_epochs jsonb;
  v_flags jsonb := '{}'::jsonb;
  v_authority jsonb;
  v_project_ids jsonb;
  v_flag record;
  v_flag_count integer;
  v_route_key text;
  v_token text;
  v_route_value jsonb;
  v_route_keys text[] := array[
    'calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'];
  v_lock_keys text[] := array[
    'calendar_upsert_ef_clients', 'native_intake_epochs', 'prod_authority',
    'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'];
begin
  if v_request_id = '' or length(v_request_id) > 160
     or v_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception 'native_client_test_provision_request_invalid';
  end if;
  if v_slug !~ '^zzthrowaway[a-z0-9]{0,60}$' then
    raise exception 'native_client_test_provision_slug_not_throwaway';
  end if;
  if v_display_name !~ '^ZZ THROWAWAY( [^\n\r\t]{1,140})?$' then
    raise exception 'native_client_test_provision_display_name_not_throwaway';
  end if;
  if v_actor = '' then raise exception 'native_client_test_provision_actor_required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('native-client-provision-request:' || v_request_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('native-client-provision-slug:' || v_slug, 0));

  v_intent_sha256 := encode(digest(convert_to(
    jsonb_build_object('client_slug', v_slug, 'display_name', v_display_name)::text, 'UTF8'), 'sha256'), 'hex');

  for v_flag in
    select key, value from public.syncview_runtime_flags
     where key = any(v_lock_keys) order by key for update
  loop
    v_flags := v_flags || jsonb_build_object(v_flag.key, v_flag.value);
  end loop;
  select count(*) into v_flag_count from jsonb_object_keys(v_flags);
  if v_flag_count <> cardinality(v_lock_keys) then
    raise exception 'native_client_test_provision_runtime_flag_missing';
  end if;

  v_authority := v_flags->'prod_authority';
  if jsonb_typeof(v_authority) is distinct from 'object'
     or lower(coalesce(v_authority->>'video', '')) <> 'syncview'
     or lower(coalesce(v_authority->>'graphics', '')) <> 'syncview' then
    raise exception 'native_client_test_provision_authority_unavailable';
  end if;
  v_epochs := public.production_native_intake_epochs();
  if jsonb_typeof(v_epochs) is distinct from 'object'
     or coalesce(v_epochs->>'video', '') = '' or coalesce(v_epochs->>'graphics', '') = '' then
    raise exception 'native_client_test_provision_epochs_unavailable';
  end if;

  foreach v_route_key in array v_route_keys loop
    v_route_value := v_flags->v_route_key;
    if jsonb_typeof(v_route_value) is distinct from 'object'
       or jsonb_typeof(v_route_value->'clients') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(v_route_value->'clients') entry
                   where jsonb_typeof(entry) is distinct from 'string'
                      or entry #>> '{}' !~ '^[a-z0-9][a-z0-9_&-]{0,99}$')
       or (select count(*) from jsonb_array_elements_text(v_route_value->'clients'))
          <> (select count(distinct entry #>> '{}') from jsonb_array_elements(v_route_value->'clients') entry) then
      raise exception 'native_client_test_provision_routing_flag_invalid';
    end if;
  end loop;

  select * into v_existing from public.production_native_client_test_provisions where request_id = v_request_id;
  if found then
    if v_existing.intent_sha256 is distinct from v_intent_sha256 then
      raise exception 'native_client_test_provision_idempotency_conflict';
    end if;
    select * into v_client from public.clients where slug = v_slug;
    if not found or v_client.kind is distinct from 'test' or v_client.source is distinct from 'syncview_native_test'
       or v_client.native_project_ids is distinct from v_existing.native_project_ids then
      raise exception 'native_client_test_provision_state_drift';
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'replayed', 'kind', 'test', 'client_slug', v_slug,
      'native_project_ids', v_existing.native_project_ids, 'slack', 'not_queued');
  end if;

  if exists (select 1 from public.clients where slug = v_slug) then
    raise exception 'native_client_test_provision_client_exists';
  end if;

  v_project_ids := jsonb_build_object(
    'video', 'svproj_video_' || encode(gen_random_bytes(16), 'hex'),
    'graphics', 'svproj_graphics_' || encode(gen_random_bytes(16), 'hex'));
  if v_project_ids->>'video' !~ '^svproj_video_[0-9a-f]{32}$'
     or v_project_ids->>'graphics' !~ '^svproj_graphics_[0-9a-f]{32}$'
     or v_project_ids->>'video' = v_project_ids->>'graphics' then
    raise exception 'native_client_test_provision_project_id_generation_failed';
  end if;

  insert into public.clients (slug, display_name, active, kind, source, native_project_ids)
  values (v_slug, v_display_name, true, 'test', 'syncview_native_test', v_project_ids);

  insert into public.client_access (slug, review_token, notes)
  values (v_slug, public.client_access_mint_review_token(), 'Auto-provisioned by the test-only native client path')
  on conflict (slug) do nothing;
  select review_token into v_token from public.client_access where slug = v_slug;
  if coalesce(v_token, '') = '' then raise exception 'native_client_test_provision_token_missing'; end if;

  foreach v_route_key in array v_route_keys loop
    v_route_value := v_flags->v_route_key;
    update public.syncview_runtime_flags
       set value = jsonb_set(v_route_value, '{clients}', (v_route_value->'clients') || jsonb_build_array(v_slug), false)
     where key = v_route_key;
  end loop;

  insert into public.production_native_client_test_provisions (request_id, client_slug, intent_sha256, native_project_ids, created_by)
  values (v_request_id, v_slug, v_intent_sha256, v_project_ids, v_actor);

  -- The profile comes from Roster's function (it refuses unless the switch reads
  -- 'syncview'). It queues a Clients Info Sheet write for every create; a
  -- throwaway must never reach the Sheet, so that outbox row is removed in this
  -- same transaction, before anything can read it. The checklist rows follow.
  perform public.client_profile_service_write(v_slug, v_display_name, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, v_actor, 'admin', v_request_id);
  delete from public.roster_sheet_outbox where client_slug = v_slug;
  perform public.client_onboarding_ensure(v_slug);

  return jsonb_build_object('ok', true, 'outcome', 'created', 'kind', 'test', 'client_slug', v_slug,
    'native_project_ids', v_project_ids, 'slack', 'not_queued');
end;
$fn$;

create or replace function public.production_native_client_test_teardown(
  p_client_slug text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fn$
declare
  v_slug text := lower(btrim(coalesce(p_client_slug, '')));
  v_client public.clients;
  v_route_key text;
  v_route_value jsonb;
  v_route_keys text[] := array[
    'calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'];
  v_flag record;
  t text;
  n integer;
  v_deleted jsonb := '{}'::jsonb;
begin
  if btrim(coalesce(p_actor, '')) = '' then raise exception 'native_client_test_teardown_actor_required'; end if;
  if v_slug !~ '^zzthrowaway[a-z0-9]{0,60}$' then raise exception 'native_client_test_teardown_slug_not_throwaway'; end if;
  perform pg_advisory_xact_lock(hashtextextended('native-client-provision-slug:' || v_slug, 0));

  select * into v_client from public.clients where slug = v_slug for update;
  if not found then raise exception 'native_client_test_teardown_client_missing'; end if;
  if v_client.kind is distinct from 'test' or v_client.source is distinct from 'syncview_native_test'
     or v_client.display_name !~ '^ZZ THROWAWAY'
     or not exists (select 1 from public.production_native_client_test_provisions where client_slug = v_slug) then
    raise exception 'native_client_test_teardown_not_a_verified_throwaway';
  end if;

  -- Refuse, never delete around, a throwaway that gained work.
  for t, n in
    select 'calendar_posts', count(*) from public.calendar_posts where client = v_slug
    union all select 'sample_reviews', count(*) from public.sample_reviews where client = v_slug
    union all select 'filming_plans', count(*) from public.filming_plans where client_slug = v_slug
    union all select 'templates', count(*) from public.templates where client_slug = v_slug
    union all select 'client_credentials', count(*) from public.client_credentials where client_slug = v_slug
    union all select 'batches', count(*) from public.batches where client_slug = v_slug
    union all select 'deliverables', count(*) from public.deliverables where client_slug = v_slug
    union all select 'legacy_intake_native_triage', count(*) from public.legacy_intake_native_triage where client_slug = v_slug
    union all select 'production_notification_intents', count(*) from public.production_notification_intents where client_slug = v_slug
  loop
    if n > 0 then raise exception 'native_client_test_teardown_blocked: %', t; end if;
  end loop;

  -- Routing lists (locked in key order, malformed lists refuse the whole call).
  for v_flag in select key, value from public.syncview_runtime_flags where key = any(v_route_keys) order by key for update loop
    if jsonb_typeof(v_flag.value) is distinct from 'object' or jsonb_typeof(v_flag.value->'clients') is distinct from 'array' then
      raise exception 'native_client_test_teardown_routing_flag_invalid';
    end if;
  end loop;
  foreach v_route_key in array v_route_keys loop
    select value into v_route_value from public.syncview_runtime_flags where key = v_route_key;
    update public.syncview_runtime_flags
       set value = jsonb_set(v_route_value, '{clients}',
             coalesce((select jsonb_agg(e) from jsonb_array_elements(v_route_value->'clients') e where e <> to_jsonb(v_slug)), '[]'::jsonb), false)
     where key = v_route_key;
  end loop;

  delete from public.roster_sheet_outbox where client_slug = v_slug;
  get diagnostics n = row_count; v_deleted := v_deleted || jsonb_build_object('sheet_outbox', n);
  delete from public.client_profile_edits where slug = v_slug;
  get diagnostics n = row_count; v_deleted := v_deleted || jsonb_build_object('profile_edits', n);
  delete from public.client_profiles where slug = v_slug;   -- checklist, resources, sales state, proposals cascade
  get diagnostics n = row_count; v_deleted := v_deleted || jsonb_build_object('profile', n);
  delete from public.client_access where slug = v_slug;
  get diagnostics n = row_count; v_deleted := v_deleted || jsonb_build_object('review_token', n);
  delete from public.production_native_client_test_provisions where client_slug = v_slug;
  get diagnostics n = row_count; v_deleted := v_deleted || jsonb_build_object('test_receipt', n);
  delete from public.clients where slug = v_slug;
  get diagnostics n = row_count; v_deleted := v_deleted || jsonb_build_object('roster_row', n);

  return jsonb_build_object('ok', true, 'client_slug', v_slug, 'deleted', v_deleted);
end;
$fn$;

revoke all on function public.production_native_client_test_provision(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.production_native_client_test_teardown(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.production_native_client_test_provision(text, text, text, text) to service_role;
grant execute on function public.production_native_client_test_teardown(text, text) to service_role;

commit;
