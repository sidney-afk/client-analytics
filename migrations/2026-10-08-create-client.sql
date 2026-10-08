-- ============================================================
-- 2026-10-08 -- "Create client" (step 2.5 of
-- docs/plans/2026-10-01-onboarding-checklist-and-profile.md): one call that
-- creates a client's roster row, review link, four save permissions, profile,
-- manager assignment and onboarding checklist, all in ONE transaction. Either
-- everything exists afterwards or nothing does.
--
-- SOURCE-ONLY. Not applied. Lighthouse applies it by hand in the SQL editor, and
-- only after the owner's go at that moment. APPLY ORDER: after
--   2026-09-09-native-client-provisioning.sql   (applied, live)
--   2026-10-02-roster-native.sql                 (applied, live)
--   2026-10-03-onboarding-checklist-tables.sql   (applied, live)
--   2026-10-03-native-client-test-provision.sql  (NOT applied yet; this file
--                                                 needs it for the throwaway path)
--
-- client_create_native(request_id, slug, display_name, manager_slug, email, actor, mode)
--   mode 'client': the real path. production_native_client_provision() (roster
--     row kind 'client', review token, four routing lists, immutable receipt),
--     then Roster's client_profile_service_write() (profile + history + Sheet
--     outbox), then smm_assign_client() (one manager, history, Sheet outbox),
--     then the 27 checklist rows. The steps this call itself proved are ticked:
--     roster_row_created, routing_enrolled, review_token_present (source
--     'detected') and smm_assigned (source 'manual', the admin's pick). Each
--     tick writes one checklist history row.
--   mode 'test': the throwaway path. production_native_client_test_provision()
--     (kind 'test', a deletable receipt, names that must start with
--     "ZZ THROWAWAY" / "zzthrowaway", profile and checklist), then the same
--     manager assignment and ticks. Every Sheet outbox row for the throwaway is
--     removed in the same transaction, so the Clients Info and Social Media
--     Managers tabs never see it.
--
-- SLACK. Neither mode queues the Slack channel finalizer. The finalizer is fed
-- by the onboarding form's provisioning snapshot and needs a filming plan link,
-- neither of which exists when an admin creates the client, so a queued job
-- could only end in "manual reconciliation". Nothing in this file touches Slack.
--
-- client_create_native_test_teardown(slug, actor) removes a throwaway made by
-- the test mode: it takes the name off its manager's list (the assignment
-- history row stays, like every history), then calls
-- production_native_client_test_teardown(), which refuses anything that is not
-- a verified throwaway or that has gained work.
--
-- Refusals are plain exceptions with stable names (client_create_*), mapped to
-- codes by supabase/functions/_shared/client-onboarding.mjs. A replay of the
-- same request id returns the first answer and writes nothing new.
--
-- ACCESS. Both functions: SECURITY DEFINER with a pinned search_path, every
-- privilege revoked from all four roles (public, anon, authenticated,
-- service_role), then EXECUTE granted to service_role alone. The browser never
-- calls them; the client-onboarding Edge Function does, after its admin check.
--
-- Rollback: drop the two functions (no table is created, no data is changed by
-- applying this file).
-- ============================================================
begin;

create or replace function public.client_create_native(
  p_request_id   text,
  p_client_slug  text,
  p_display_name text,
  p_manager_slug text,
  p_email        text,
  p_actor        text,
  p_mode         text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fn$
declare
  v_request_id text := btrim(coalesce(p_request_id, ''));
  v_slug       text := lower(btrim(coalesce(p_client_slug, '')));
  v_name       text := btrim(coalesce(p_display_name, ''));
  v_mgr_slug   text := btrim(coalesce(p_manager_slug, ''));
  v_email      text := btrim(coalesce(p_email, ''));
  v_actor      text := btrim(coalesce(p_actor, ''));
  v_mode       text := btrim(coalesce(p_mode, ''));
  v_mgr        public.social_media_managers;
  v_made       jsonb;
  v_step       text;
  v_cur        public.client_onboarding_progress;
  v_nxt        public.client_onboarding_progress;
  v_ticked     integer := 0;
  v_steps      integer;
begin
  if v_mode not in ('client', 'test') then raise exception 'client_create_bad_mode'; end if;
  if v_actor = '' then raise exception 'client_create_actor_required'; end if;
  if v_request_id = '' or v_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception 'client_create_request_invalid';
  end if;
  -- The profile's slug rule is narrower than the roster's, so it decides.
  if v_slug !~ '^[a-z0-9&]{1,60}$' then raise exception 'client_create_slug_invalid'; end if;
  if v_name = '' or length(v_name) > 160 or v_name ~ '[\n\r\t]' then raise exception 'client_create_name_invalid'; end if;
  if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    raise exception 'client_create_email_invalid';
  end if;
  if v_mode = 'test' and (v_slug !~ '^zzthrowaway' or v_name !~ '^ZZ THROWAWAY') then
    raise exception 'client_create_test_needs_throwaway_name';
  end if;
  if v_mode = 'client' and (v_slug ~ '^zzthrowaway' or v_name ~* '^zz throwaway') then
    raise exception 'client_create_throwaway_name_needs_test_mode';
  end if;

  select * into v_mgr from public.social_media_managers where slug = v_mgr_slug and active;
  if not found then raise exception 'client_create_manager_unknown'; end if;

  -- A replay of a finished request: the provisioning functions recognise the
  -- request id and certify the client is still whole; nothing else is written.
  if exists (select 1 from public.production_native_client_provisions where request_id = v_request_id)
     or exists (select 1 from public.production_native_client_test_provisions where request_id = v_request_id) then
    if v_mode = 'client' then
      v_made := public.production_native_client_provision(v_request_id, v_slug, v_name);
    else
      v_made := public.production_native_client_test_provision(v_request_id, v_slug, v_name, v_actor);
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'replayed', 'mode', v_mode, 'client_slug', v_slug, 'slack', 'not_queued');
  end if;

  -- The manager link and the Sheet match clients by display name, so a name
  -- already in use (even on an archived profile or on any manager's list) is
  -- refused rather than silently merged with an existing client.
  if exists (select 1 from public.client_profiles where lower(btrim(display_name)) = lower(v_name))
     or exists (select 1 from public.clients where lower(btrim(display_name)) = lower(v_name)) then
    raise exception 'client_create_name_taken';
  end if;
  if exists (select 1 from public.social_media_managers m, jsonb_array_elements_text(m.source_clients) c
              where lower(btrim(c)) = lower(v_name)) then
    raise exception 'client_create_name_on_a_manager_list';
  end if;
  if exists (select 1 from public.clients where slug = v_slug)
     or exists (select 1 from public.client_profiles where slug = v_slug) then
    raise exception 'client_create_slug_taken';
  end if;

  if v_mode = 'client' then
    v_made := public.production_native_client_provision(v_request_id, v_slug, v_name);
    perform public.client_profile_service_write(v_slug, v_name,
      case when v_email = '' then '{}'::jsonb else jsonb_build_object('email', v_email) end,
      '{}'::jsonb, '{}'::jsonb, v_actor, 'admin', v_request_id);
    perform public.client_onboarding_ensure(v_slug);
  else
    -- Creates the profile and the checklist itself, and drops its own outbox row.
    v_made := public.production_native_client_test_provision(v_request_id, v_slug, v_name, v_actor);
    if v_email <> '' then
      perform public.client_profile_service_write(v_slug, null, jsonb_build_object('email', v_email),
        '{}'::jsonb, '{}'::jsonb, v_actor, 'admin', v_request_id);
    end if;
  end if;

  perform public.smm_assign_client(v_slug, v_name, v_mgr.slug, v_mgr.name, '', v_actor, 'admin', v_request_id);

  if v_mode = 'test' then
    delete from public.roster_sheet_outbox where client_slug = v_slug;
  end if;

  select count(*) into v_steps from public.client_onboarding_progress where client_slug = v_slug;
  if v_steps < (select count(*) from public.onboarding_steps) then
    raise exception 'client_create_checklist_incomplete';
  end if;

  foreach v_step in array array['roster_row_created', 'routing_enrolled', 'review_token_present', 'smm_assigned'] loop
    select * into v_cur from public.client_onboarding_progress
     where client_slug = v_slug and step_key = v_step for update;
    if not found or v_cur.status = 'done' then continue; end if;
    update public.client_onboarding_progress
       set status = 'done',
           source = case when v_step = 'smm_assigned' then 'manual' else 'detected' end,
           evidence = 'Create client ' || v_request_id,
           done_by = v_actor, done_at = now(), updated_at = now()
     where client_slug = v_slug and step_key = v_step
    returning * into v_nxt;
    insert into public.client_onboarding_events
      (client_slug, step_key, action, before_row, after_row, actor, role, request_id)
    values (v_slug, v_step, 'create_client', to_jsonb(v_cur), to_jsonb(v_nxt), v_actor, 'admin', v_request_id);
    v_ticked := v_ticked + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'outcome', 'created', 'mode', v_mode, 'client_slug', v_slug,
    'kind', case when v_mode = 'test' then 'test' else 'client' end,
    'manager_slug', v_mgr.slug, 'checklist_steps', v_steps, 'checklist_ticked', v_ticked,
    'slack', 'not_queued');
end;
$fn$;

create or replace function public.client_create_native_test_teardown(
  p_client_slug text,
  p_actor       text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fn$
declare
  v_slug text := lower(btrim(coalesce(p_client_slug, '')));
  v_name text;
  v_out  jsonb;
  n      integer;
begin
  if btrim(coalesce(p_actor, '')) = '' then raise exception 'client_create_actor_required'; end if;
  if v_slug !~ '^zzthrowaway[a-z0-9]{0,60}$' then raise exception 'client_create_teardown_not_throwaway'; end if;
  select display_name into v_name from public.clients
   where slug = v_slug and kind = 'test' and source = 'syncview_native_test' and display_name ~ '^ZZ THROWAWAY';
  if v_name is null then raise exception 'client_create_teardown_not_throwaway'; end if;

  update public.social_media_managers m set
    source_clients = coalesce((select jsonb_agg(c order by c) from jsonb_array_elements_text(m.source_clients) c
                               where lower(btrim(c)) <> lower(v_name)), '[]'::jsonb),
    updated_at = clock_timestamp()
  where exists (select 1 from jsonb_array_elements_text(m.source_clients) c where lower(btrim(c)) = lower(v_name));
  get diagnostics n = row_count;

  v_out := public.production_native_client_test_teardown(v_slug, p_actor);
  return v_out || jsonb_build_object('manager_lists_cleared', n);
end;
$fn$;

revoke all on function public.client_create_native(text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.client_create_native_test_teardown(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.client_create_native(text, text, text, text, text, text, text) to service_role;
grant execute on function public.client_create_native_test_teardown(text, text) to service_role;

commit;
