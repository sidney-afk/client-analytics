-- Disposable-cluster proof for migrations/2026-10-03-native-client-test-provision.sql.
-- Run on a THROWAWAY PostgreSQL (never a real project), as a superuser, from the repo root:
--   psql -v ON_ERROR_STOP=1 -d <empty database> -f scripts/native-client-test-provision-proof.sql
-- It applies the REAL 2026-09-09 provisioning migration, the checklist tables migration and the
-- test-only path, against stand-ins for the tables and Roster functions they use. Fictional data.
-- Ends with the line: NATIVE_CLIENT_TEST_PROVISION_PROOF_OK
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- stand-ins for what the migrations expect to find
create table public.clients (slug text primary key, display_name text not null, active boolean not null default true,
  kind text not null check (kind in ('client','internal','test')), source text not null default 'sheet',
  slack_channel_id text, board_status text not null default 'in_progress', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table public.client_access (slug text primary key references public.clients (slug), review_token text, token_rotated_at timestamptz, notes text);
create function public.client_access_mint_review_token() returns text language sql as $$ select encode(extensions.gen_random_bytes(24), 'hex') $$;
create table public.syncview_runtime_flags (key text primary key, value jsonb not null, updated_by text, updated_at timestamptz default now());
insert into public.syncview_runtime_flags(key, value) values
  ('calendar_upsert_ef_clients','{"clients":[]}'), ('sample_review_ef_clients','{"clients":[]}'),
  ('settings_ef_clients','{"clients":[]}'), ('write_ui_reroute_clients','{"clients":[]}'),
  ('prod_authority','{"video":"syncview","graphics":"syncview"}'), ('native_intake_epochs','{"video":"v1","graphics":"g1"}');
create function public.production_native_intake_epochs() returns jsonb language sql as $$ select '{"video":"v1","graphics":"g1"}'::jsonb $$;
-- dependents that reference clients(slug) in production
create table public.batches (id bigserial primary key, client_slug text references public.clients (slug));
create table public.deliverables (id bigserial primary key, client_slug text references public.clients (slug));
create table public.legacy_intake_native_triage (id bigserial primary key, client_slug text references public.clients (slug));
create table public.production_notification_intents (id bigserial primary key, client_slug text references public.clients (slug));
-- profile and history tables (Roster's and the Sheet mirror's), reduced
create table public.client_profiles (slug text primary key, display_name text not null, email text, instagram_handle text,
  tiktok_handle text, youtube_channel_id text, slack_channel_id text, creative_channel_id text, postforme_account_id text,
  competitors text, keywords text, content_description text, extra jsonb not null default '{}', source text, updated_by text,
  archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.client_profile_edits (id bigint generated always as identity primary key, slug text not null references public.client_profiles (slug),
  field text not null, old_value text, new_value text, edited_by text not null, edited_role text not null, request_id text, edited_at timestamptz not null default now());
create table public.roster_sheet_outbox (id bigint generated always as identity primary key, tab text not null, client_slug text not null,
  client_name text not null, status text not null default 'pending');
create function public.roster_authority() returns text language sql as $$ select 'syncview' $$;
-- Roster's client_profile_service_write, reduced to what the throwaway path relies on: create the profile, write history,
-- queue a Sheet outbox row, refuse unless the switch reads syncview.
create function public.client_profile_service_write(p_slug text, p_display_name text, p_columns jsonb, p_extra jsonb, p_expect jsonb,
  p_actor text, p_role text, p_request_id text) returns jsonb language plpgsql as $$
begin
  if public.roster_authority() is distinct from 'syncview' then raise exception 'roster_authority_not_syncview'; end if;
  insert into public.client_profiles (slug, display_name, source, updated_by) values (p_slug, p_display_name, 'syncview', p_actor);
  insert into public.client_profile_edits (slug, field, new_value, edited_by, edited_role, request_id) values (p_slug, '(created)', p_display_name, p_actor, p_role, p_request_id);
  insert into public.roster_sheet_outbox (tab, client_slug, client_name) values ('Clients Info', p_slug, p_display_name);
  return jsonb_build_object('created', true);
end $$;
-- tables the checklist views read
create table public.client_access_dummy (x int);
create table public.filming_plans (client_slug text primary key, doc_url text);
create table public.templates (client_slug text primary key, data jsonb);
create table public.client_credentials (id bigserial primary key, client_slug text);
create table public.client_onboarding (id bigserial primary key, slug text);
create table public.ai_client_onboarding (id bigserial primary key, slug text);
create table public.calendar_posts (client text, id text, primary key (client, id));
create table public.sample_reviews (client text, id text, primary key (client, id));
create table public.analytics_metrics (client_slug text, date date);
create table public.caption_prompts (client_slug text primary key, prompt text, updated_by text);
create table public.settings_events (id bigserial primary key, client_slug text, action text);

\i migrations/2026-09-09-native-client-provisioning.sql
\i migrations/2026-10-03-onboarding-checklist-tables.sql
\i migrations/2026-10-03-native-client-test-provision.sql
\i migrations/2026-10-03-native-client-test-provision.sql

do $$
declare r jsonb; real jsonb; tst jsonb; n int; k text; v record;
begin
  -- the real function, for parity
  real := public.production_native_client_provision('req-real-1', 'realone', 'Real One');
  if real->>'outcome' <> 'created' then raise exception 'real create %', real; end if;

  -- refusals: not clearly a throwaway, no actor, bad request
  begin perform public.production_native_client_test_provision('req-t0', 'realtwo', 'ZZ THROWAWAY Two', 'owner'); raise exception 'slug allowed'; exception when others then
    if sqlerrm <> 'native_client_test_provision_slug_not_throwaway' then raise; end if; end;
  begin perform public.production_native_client_test_provision('req-t0', 'zzthrowawaytwo', 'Real Two', 'owner'); raise exception 'name allowed'; exception when others then
    if sqlerrm <> 'native_client_test_provision_display_name_not_throwaway' then raise; end if; end;
  begin perform public.production_native_client_test_provision('req-t0', 'zzthrowawaytwo', 'ZZ THROWAWAY Two', ' '); raise exception 'no actor allowed'; exception when others then
    if sqlerrm <> 'native_client_test_provision_actor_required' then raise; end if; end;
  begin perform public.production_native_client_test_provision('bad request', 'zzthrowawaytwo', 'ZZ THROWAWAY Two', 'owner'); raise exception 'bad request allowed'; exception when others then
    if sqlerrm <> 'native_client_test_provision_request_invalid' then raise; end if; end;

  -- the throwaway
  tst := public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner');
  if tst->>'outcome' <> 'created' or tst->>'kind' <> 'test' or tst->>'slack' <> 'not_queued' then raise exception 'test create %', tst; end if;
  select * into v from public.clients where slug = 'zzthrowawayone';
  if v.kind <> 'test' or v.source <> 'syncview_native_test' or not v.active then raise exception 'row %', v; end if;
  if not exists (select 1 from public.client_access where slug = 'zzthrowawayone' and btrim(review_token) <> '') then raise exception 'no token'; end if;
  foreach k in array array['calendar_upsert_ef_clients','sample_review_ef_clients','settings_ef_clients','write_ui_reroute_clients'] loop
    if not ((select value->'clients' from public.syncview_runtime_flags where key = k) @> '["zzthrowawayone"]'::jsonb) then raise exception 'not enrolled in %', k; end if;
  end loop;
  if (select count(*) from public.roster_sheet_outbox where client_slug = 'zzthrowawayone') <> 0 then raise exception 'throwaway reached the Sheet outbox'; end if;
  if (select count(*) from public.client_profiles where slug = 'zzthrowawayone') <> 1 then raise exception 'no profile'; end if;
  if (select count(*) from public.client_onboarding_progress where client_slug = 'zzthrowawayone') <> 27 then raise exception 'checklist not started'; end if;
  if (select count(*) from public.production_native_client_provisions where client_slug = 'zzthrowawayone') <> 0 then raise exception 'real receipt written'; end if;

  -- parity with the real function: same response shape, same project-id shape, same token and lists
  if (select array_agg(x order by x) from jsonb_object_keys(real) x) is distinct from (select array_agg(x order by x) from jsonb_object_keys(tst - 'kind' - 'slack') x) then
    raise exception 'response shape differs: % vs %', real, tst; end if;
  if (real->'native_project_ids'->>'video') !~ '^svproj_video_[0-9a-f]{32}$' or (tst->'native_project_ids'->>'video') !~ '^svproj_video_[0-9a-f]{32}$' then raise exception 'project ids'; end if;
  if (select count(*) from public.client_access where slug in ('realone','zzthrowawayone') and btrim(review_token) <> '') <> 2 then raise exception 'tokens'; end if;

  -- replay and conflict
  if (public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner'))->>'outcome' <> 'replayed' then raise exception 'replay'; end if;
  begin perform public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One changed', 'owner'); raise exception 'conflict allowed'; exception when others then
    if sqlerrm <> 'native_client_test_provision_idempotency_conflict' then raise; end if; end;
  begin perform public.production_native_client_test_provision('req-t2', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner'); raise exception 'duplicate allowed'; exception when others then
    if sqlerrm <> 'native_client_test_provision_client_exists' then raise; end if; end;

  -- a replay of a throwaway that lost a token, a routing entry, its profile or its checklist is refused, never certified
  delete from public.client_access where slug = 'zzthrowawayone';
  begin perform public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner'); raise exception 'replay without token'; exception when others then
    if sqlerrm <> 'native_client_test_provision_token_missing' then raise; end if; end;
  insert into public.client_access (slug, review_token) values ('zzthrowawayone', 'restored-token');
  update public.syncview_runtime_flags set value = jsonb_set(value, '{clients}', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(value->'clients') e where e <> '"zzthrowawayone"'::jsonb)) where key = 'settings_ef_clients';
  begin perform public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner'); raise exception 'replay without routing'; exception when others then
    if sqlerrm <> 'native_client_test_provision_routing_drift' then raise; end if; end;
  update public.syncview_runtime_flags set value = jsonb_set(value, '{clients}', value->'clients' || '"zzthrowawayone"'::jsonb) where key = 'settings_ef_clients';
  update public.client_profiles set archived_at = now() where slug = 'zzthrowawayone';
  begin perform public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner'); raise exception 'replay with archived profile'; exception when others then
    if sqlerrm <> 'native_client_test_provision_profile_missing' then raise; end if; end;
  update public.client_profiles set archived_at = null where slug = 'zzthrowawayone';
  update public.clients set active = false where slug = 'zzthrowawayone';
  begin perform public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner'); raise exception 'replay inactive'; exception when others then
    if sqlerrm <> 'native_client_test_provision_state_drift' then raise; end if; end;
  update public.clients set active = true where slug = 'zzthrowawayone';
  if (public.production_native_client_test_provision('req-t1', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner'))->>'outcome' <> 'replayed' then raise exception 'healthy replay after repairs'; end if;

  -- teardown refuses a real client, a throwaway that gained work, and a missing one
  begin perform public.production_native_client_test_teardown('realone', 'owner'); raise exception 'real client torn down'; exception when others then
    if sqlerrm <> 'native_client_test_teardown_slug_not_throwaway' then raise; end if; end;
  begin perform public.production_native_client_test_teardown('zzthrowawaymissing', 'owner'); raise exception 'missing'; exception when others then
    if sqlerrm <> 'native_client_test_teardown_client_missing' then raise; end if; end;
  insert into public.deliverables (client_slug) values ('zzthrowawayone');
  begin perform public.production_native_client_test_teardown('zzthrowawayone', 'owner'); raise exception 'work ignored'; exception when others then
    if sqlerrm <> 'native_client_test_teardown_blocked: deliverables' then raise; end if; end;
  delete from public.deliverables where client_slug = 'zzthrowawayone';
  insert into public.caption_prompts (client_slug, prompt) values ('zzthrowawayone', 'p');
  begin perform public.production_native_client_test_teardown('zzthrowawayone', 'owner'); raise exception 'prompt ignored'; exception when others then
    if sqlerrm <> 'native_client_test_teardown_blocked: caption_prompts' then raise; end if; end;
  delete from public.caption_prompts where client_slug = 'zzthrowawayone';
  insert into public.calendar_posts (client, id) values ('zzthrowawayone', 'c1');
  begin perform public.production_native_client_test_teardown('zzthrowawayone', 'owner'); raise exception 'card ignored'; exception when others then
    if sqlerrm <> 'native_client_test_teardown_blocked: calendar_posts' then raise; end if; end;
  delete from public.calendar_posts where client = 'zzthrowawayone';

  -- put a history event on the throwaway so we can see history stay
  perform public.client_onboarding_set_step('zzthrowawayone', 'first_card_created', 'unknown', null, null, 'owner', 'admin',
     (select updated_at from public.client_onboarding_progress where client_slug='zzthrowawayone' and step_key='first_card_created'), 'rq9');

  -- the real teardown
  r := public.production_native_client_test_teardown('zzthrowawayone', 'owner');
  if (r->'deleted'->>'roster_row') <> '1' or (r->'deleted'->>'profile') <> '1' or (r->'deleted'->>'review_token') <> '1' or (r->'deleted'->>'test_receipt') <> '1' then raise exception 'teardown counts %', r; end if;
  select count(*) into n from (
    select 1 from public.clients where slug = 'zzthrowawayone'
    union all select 1 from public.client_access where slug = 'zzthrowawayone'
    union all select 1 from public.client_profiles where slug = 'zzthrowawayone'
    union all select 1 from public.client_profile_edits where slug = 'zzthrowawayone'
    union all select 1 from public.client_onboarding_progress where client_slug = 'zzthrowawayone'
    union all select 1 from public.production_native_client_test_provisions where client_slug = 'zzthrowawayone'
    union all select 1 from public.roster_sheet_outbox where client_slug = 'zzthrowawayone') z;
  if n <> 0 then raise exception 'teardown left % rows', n; end if;
  foreach k in array array['calendar_upsert_ef_clients','sample_review_ef_clients','settings_ef_clients','write_ui_reroute_clients'] loop
    if ((select value->'clients' from public.syncview_runtime_flags where key = k) @> '["zzthrowawayone"]'::jsonb) then raise exception 'still enrolled in %', k; end if;
    if not ((select value->'clients' from public.syncview_runtime_flags where key = k) @> '["realone"]'::jsonb) then raise exception 'real client lost from %', k; end if;
  end loop;
  if (select count(*) from public.client_onboarding_events where client_slug = 'zzthrowawayone') < 1 then raise exception 'history must stay'; end if;
  if (select count(*) from public.production_native_client_provisions where client_slug = 'realone') <> 1 then raise exception 'real receipt touched'; end if;
  -- and the throwaway name is free again
  perform public.production_native_client_test_provision('req-t3', 'zzthrowawayone', 'ZZ THROWAWAY One', 'owner');
  perform public.production_native_client_test_teardown('zzthrowawayone', 'owner');
end $$;

-- roles
do $$
declare rl text;
begin
  foreach rl in array array['anon','authenticated'] loop
    if has_function_privilege(rl, 'public.production_native_client_test_provision(text,text,text,text)', 'execute')
       or has_function_privilege(rl, 'public.production_native_client_test_teardown(text,text)', 'execute')
       or has_table_privilege(rl, 'public.production_native_client_test_provisions', 'select,insert,update,delete,truncate') then
      raise exception '% has access', rl; end if;
  end loop;
  if not has_function_privilege('service_role', 'public.production_native_client_test_provision(text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.production_native_client_test_teardown(text,text)', 'execute') then raise exception 'service_role cannot execute'; end if;
  if has_table_privilege('service_role', 'public.production_native_client_test_provisions', 'select,insert,update,delete,truncate') then raise exception 'service_role reaches the table directly'; end if;
end $$;
select 'NATIVE_CLIENT_TEST_PROVISION_PROOF_OK' as result;
