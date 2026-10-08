-- Disposable-cluster proof for migrations/2026-10-08-create-client.sql ("Create client", live) and
-- migrations/2026-10-09-create-client-slack-nudge.sql (its Slack nudge) applied on top.
-- Run on a THROWAWAY PostgreSQL (never a real project), as a superuser, from the repo root:
--   psql -v ON_ERROR_STOP=1 -d <empty database> -f scripts/client-create-proof.sql
-- It first runs scripts/native-client-test-provision-proof.sql (the real 2026-09-09 provisioning
-- migration, the checklist tables and the test-only path, against stand-ins), then adds a reduced
-- stand-in for Roster's manager table and smm_assign_client(), applies the create-client migration
-- twice and checks it. Fictional data only.
-- Ends with the line: CLIENT_CREATE_PROOF_OK
\set ON_ERROR_STOP on
\i scripts/native-client-test-provision-proof.sql

-- Roster's managers table and assignment, reduced to what Create client relies on: one manager per
-- client by display name, a history row, one Sheet outbox row, refused unless the switch reads syncview.
create table public.social_media_managers (slug text primary key, name text not null, email text not null default '',
  active boolean not null default true, source text, source_row_count int not null default 0,
  source_clients jsonb not null default '[]', slack_profile_url text not null default '',
  synced_at timestamptz, updated_at timestamptz);
create table public.smm_assignment_edits (id bigint generated always as identity primary key, client_name text not null,
  old_manager_slug text, new_manager_slug text, edited_by text not null, edited_role text not null, request_id text,
  edited_at timestamptz not null default now());
create function public.smm_assign_client(p_client_slug text, p_client_name text, p_manager_slug text, p_manager_name text,
  p_slack_profile_url text, p_actor text, p_role text, p_request_id text) returns jsonb language plpgsql as $$
declare cname text; old_slug text;
begin
  if public.roster_authority() is distinct from 'syncview' then raise exception 'roster_authority_not_syncview'; end if;
  select display_name into cname from public.client_profiles where slug = p_client_slug and archived_at is null;
  if cname is null then raise exception 'client_profile_missing'; end if;
  select slug into old_slug from public.social_media_managers m
   where exists (select 1 from jsonb_array_elements_text(m.source_clients) c where lower(c) = lower(cname)) order by slug limit 1;
  update public.social_media_managers m set source_clients = coalesce((select jsonb_agg(c) from jsonb_array_elements_text(m.source_clients) c where lower(c) <> lower(cname)), '[]');
  update public.social_media_managers set source_clients = source_clients || to_jsonb(cname) where slug = p_manager_slug;
  insert into public.smm_assignment_edits (client_name, old_manager_slug, new_manager_slug, edited_by, edited_role, request_id)
    values (cname, old_slug, p_manager_slug, p_actor, p_role, p_request_id);
  insert into public.roster_sheet_outbox (tab, client_slug, client_name) values ('Social Media Managers', p_client_slug, cname);
  return jsonb_build_object('client_name', cname, 'old_manager_slug', old_slug, 'manager_slug', p_manager_slug);
end $$;
insert into public.social_media_managers (slug, name, source_clients) values
  ('managera', 'Manager A', '["Real One"]'), ('managerb', 'Manager B', '["Someone Listed"]');
insert into public.social_media_managers (slug, name, active) values ('managergone', 'Manager Gone', false);

-- Roster's profile write, widened from the earlier stand-in: it also updates an existing profile
-- (a null name keeps the profile's own) and saves the email, the one column Create client sends.
create or replace function public.client_profile_service_write(p_slug text, p_display_name text, p_columns jsonb, p_extra jsonb, p_expect jsonb,
  p_actor text, p_role text, p_request_id text) returns jsonb language plpgsql as $$
declare made boolean := false;
begin
  if public.roster_authority() is distinct from 'syncview' then raise exception 'roster_authority_not_syncview'; end if;
  if not exists (select 1 from public.client_profiles where slug = p_slug) then
    if coalesce(btrim(p_display_name), '') = '' then raise exception 'client_profile_missing'; end if;
    insert into public.client_profiles (slug, display_name, source, updated_by) values (p_slug, p_display_name, 'syncview', p_actor);
    insert into public.client_profile_edits (slug, field, new_value, edited_by, edited_role, request_id) values (p_slug, '(created)', p_display_name, p_actor, p_role, p_request_id);
    made := true;
  end if;
  if p_columns ? 'email' then
    update public.client_profiles set email = p_columns->>'email' where slug = p_slug;
    insert into public.client_profile_edits (slug, field, new_value, edited_by, edited_role, request_id) values (p_slug, 'email', p_columns->>'email', p_actor, p_role, p_request_id);
  end if;
  insert into public.roster_sheet_outbox (tab, client_slug, client_name) values ('Clients Info', p_slug, coalesce(p_display_name, p_slug));
  return jsonb_build_object('created', made);
end $$;

-- pg_net, reduced: every nudge is recorded instead of sent.
create schema if not exists net;
create table net.sent (id bigint generated always as identity primary key, url text, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
  language sql as $$ insert into net.sent (url, body) values (url, body) returning id $$;
alter table public.filming_plans add column if not exists doc_id text;

\i migrations/2026-10-08-create-client.sql
\i migrations/2026-10-08-create-client.sql
\i migrations/2026-10-09-create-client-slack-nudge.sql
\i migrations/2026-10-09-create-client-slack-nudge.sql

do $$
declare r jsonb; n int; k text; v record;
begin
  -- refusals, each leaving nothing behind
  begin perform public.client_create_native('req-c0', 'newone', 'New One', 'managera', '', 'Admin', 'bogus'); raise exception 'mode allowed'; exception when others then
    if sqlerrm <> 'client_create_bad_mode' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'newone', 'New One', 'managera', '', ' ', 'client'); raise exception 'no actor'; exception when others then
    if sqlerrm <> 'client_create_actor_required' then raise; end if; end;
  begin perform public.client_create_native('bad request', 'newone', 'New One', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'bad request'; exception when others then
    if sqlerrm <> 'client_create_request_invalid' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'new-one', 'New One', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'dash slug'; exception when others then
    if sqlerrm <> 'client_create_slug_invalid' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'newone', E'New\nOne', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'newline name'; exception when others then
    if sqlerrm <> 'client_create_name_invalid' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'newone', 'New One', 'managera', 'not an email', 'Admin', 'client'); raise exception 'bad email'; exception when others then
    if sqlerrm <> 'client_create_email_invalid' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'newone', 'New One', 'nobody', 'x@example.com', 'Admin', 'client'); raise exception 'unknown manager'; exception when others then
    if sqlerrm <> 'client_create_manager_unknown' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'newone', 'New One', 'managergone', 'x@example.com', 'Admin', 'client'); raise exception 'inactive manager'; exception when others then
    if sqlerrm <> 'client_create_manager_unknown' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'realonetwo', 'real one', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'name reused'; exception when others then
    if sqlerrm <> 'client_create_name_taken' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'someonelisted', 'Someone Listed', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'listed name'; exception when others then
    if sqlerrm <> 'client_create_name_on_a_manager_list' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'realone', 'Brand New Name', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'slug reused'; exception when others then
    if sqlerrm <> 'client_create_slug_taken' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'newone', 'New One', 'managera', '', 'Admin', 'test'); raise exception 'test with a real name'; exception when others then
    if sqlerrm <> 'client_create_test_needs_throwaway_name' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'zzthrowawayx', 'ZZ THROWAWAY X', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'throwaway as real'; exception when others then
    if sqlerrm <> 'client_create_throwaway_name_needs_test_mode' then raise; end if; end;
  begin perform public.client_create_native('req-c0', 'newone', 'New One', 'managera', '', 'Admin', 'client'); raise exception 'real client without email'; exception when others then
    if sqlerrm <> 'client_create_email_required' then raise; end if; end;
  if exists (select 1 from public.clients where slug in ('newone', 'zzthrowawayx', 'someonelisted', 'realonetwo')) then raise exception 'a refusal left a row'; end if;
  if (select count(*) from net.sent) <> 0 then raise exception 'a refusal sent a nudge'; end if;

  -- a refusal deep inside (switch flipped back to the Sheet) rolls back the whole create
  create or replace function public.roster_authority() returns text language sql as $f$ select 'sheet' $f$;
  begin perform public.client_create_native('req-c1', 'newone', 'New One', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'sheet mode allowed'; exception when others then
    if sqlerrm <> 'roster_authority_not_syncview' then raise; end if; end;
  create or replace function public.roster_authority() returns text language sql as $f$ select 'syncview' $f$;
  if exists (select 1 from public.clients where slug = 'newone') or exists (select 1 from public.production_native_client_provisions where client_slug = 'newone')
     or exists (select 1 from public.client_access where slug = 'newone') then raise exception 'half a client left behind'; end if;
  if (select value->'clients' from public.syncview_runtime_flags where key = 'settings_ef_clients') @> '["newone"]' then raise exception 'routing left behind'; end if;

  -- the real create
  r := public.client_create_native('req-c1', 'newone', 'New One', 'managera', 'new@example.com', 'Admin', 'client');
  if r->>'outcome' <> 'created' or r->>'kind' <> 'client' or (r->>'checklist_steps')::int <> 27 or (r->>'checklist_ticked')::int <> 4 then raise exception 'create %', r; end if;
  select * into v from public.clients where slug = 'newone';
  if v.kind <> 'client' or v.source <> 'syncview_native' or not v.active then raise exception 'roster row %', v; end if;
  if (select count(*) from public.production_native_client_provisions where client_slug = 'newone') <> 1 then raise exception 'no receipt'; end if;
  if not exists (select 1 from public.client_access where slug = 'newone' and btrim(review_token) <> '') then raise exception 'no token'; end if;
  foreach k in array array['calendar_upsert_ef_clients','sample_review_ef_clients','settings_ef_clients','write_ui_reroute_clients'] loop
    if not ((select value->'clients' from public.syncview_runtime_flags where key = k) @> '["newone"]'::jsonb) then raise exception 'not enrolled in %', k; end if;
  end loop;
  if (select email from public.client_profiles where slug = 'newone') is distinct from 'new@example.com' then raise exception 'email not saved'; end if;
  if not ((select source_clients from public.social_media_managers where slug = 'managera') @> '["New One"]') then raise exception 'manager not assigned'; end if;
  if (select count(*) from public.social_media_managers where source_clients @> '["New One"]') <> 1 then raise exception 'more than one manager'; end if;
  if (select count(*) from public.roster_sheet_outbox where client_slug = 'newone' and tab = 'Clients Info') < 1
     or (select count(*) from public.roster_sheet_outbox where client_slug = 'newone' and tab = 'Social Media Managers') <> 1 then raise exception 'the real client must reach the Sheet copy'; end if;
  select count(*) into n from public.client_onboarding_progress where client_slug = 'newone' and status = 'done';
  if n <> 4 then raise exception 'ticked %', n; end if;
  if (select source from public.client_onboarding_progress where client_slug = 'newone' and step_key = 'smm_assigned') <> 'manual'
     or (select source from public.client_onboarding_progress where client_slug = 'newone' and step_key = 'routing_enrolled') <> 'detected' then raise exception 'tick sources'; end if;
  if (select count(*) from public.client_onboarding_events where client_slug = 'newone' and action = 'create_client') <> 4 then raise exception 'tick history'; end if;
  -- Slack: one nudge to the finalizer's webhook, with the profile's name, for the real client
  if r->>'slack' <> 'finalizer_nudged' then raise exception 'real create did not nudge: %', r; end if;
  if (select count(*) from net.sent) <> 1 or (select body->>'client_name' from net.sent) <> 'New One'
     or (select url from net.sent) <> 'https://synchrosocial.app.n8n.cloud/webhook/slack-creative-finalize' then raise exception 'nudge %', (select json_agg(s) from net.sent s); end if;
  -- a filming plan link saved later nudges again; a save that does not change the link does not
  insert into public.filming_plans (client_slug, doc_url, doc_id) values ('newone', 'https://docs.google.com/document/d/abc', 'abc');
  if (select count(*) from net.sent) <> 2 then raise exception 'filming plan link did not nudge'; end if;
  update public.filming_plans set doc_url = doc_url where client_slug = 'newone';
  if (select count(*) from net.sent) <> 2 then raise exception 'an unchanged link nudged'; end if;
  -- once the finalizer has written the channel, nothing nudges any more
  update public.client_profiles set creative_channel_id = 'C0FAKE0001' where slug = 'newone';
  update public.filming_plans set doc_url = 'https://docs.google.com/document/d/def', doc_id = 'def' where client_slug = 'newone';
  if (select count(*) from net.sent) <> 2 then raise exception 'a client with a channel was nudged'; end if;
  update public.client_profiles set creative_channel_id = null where slug = 'newone';
  -- a link for something that is not a real active client never nudges
  insert into public.filming_plans (client_slug, doc_url, doc_id) values ('nosuchclient', 'https://docs.google.com/document/d/x', 'x');
  if (select count(*) from net.sent) <> 2 then raise exception 'an unknown slug was nudged'; end if;

  -- replay writes nothing new; a different name under the same request is refused by the provisioning function
  select count(*) into n from public.client_onboarding_events where client_slug = 'newone';
  r := public.client_create_native('req-c1', 'newone', 'New One', 'managera', 'new@example.com', 'Admin', 'client');
  if r->>'outcome' <> 'replayed' then raise exception 'replay %', r; end if;
  if (select count(*) from public.client_onboarding_events where client_slug = 'newone') <> n then raise exception 'replay wrote history'; end if;
  if (select count(*) from public.smm_assignment_edits where client_name = 'New One') <> 1 then raise exception 'replay reassigned'; end if;
  begin perform public.client_create_native('req-c1', 'newone', 'New One Changed', 'managera', 'x@example.com', 'Admin', 'client'); raise exception 'conflict allowed'; exception when others then
    if sqlerrm <> 'native_client_provision_idempotency_conflict' then raise; end if; end;
  begin perform public.client_create_native('req-c2', 'newonetoo', 'New One', 'managerb', 'x@example.com', 'Admin', 'client'); raise exception 'second client same name'; exception when others then
    if sqlerrm <> 'client_create_name_taken' then raise; end if; end;

  -- the throwaway (test mode): created, never on the Sheet copy, then removed completely
  r := public.client_create_native('req-t9', 'zzthrowawaynine', 'ZZ THROWAWAY Nine', 'managerb', 'zz@example.com', 'Admin', 'test');
  if r->>'outcome' <> 'created' or r->>'kind' <> 'test' or r->>'slack' <> 'not_queued' or (r->>'checklist_ticked')::int <> 4 then raise exception 'test create %', r; end if;
  if (select kind from public.clients where slug = 'zzthrowawaynine') <> 'test' then raise exception 'test kind'; end if;
  if r->>'slack' <> 'not_queued' or (select count(*) from net.sent) <> 2 then raise exception 'a test client was nudged'; end if;
  insert into public.filming_plans (client_slug, doc_url, doc_id) values ('zzthrowawaynine', 'https://docs.google.com/document/d/t', 't');
  if (select count(*) from net.sent) <> 2 then raise exception 'a test client filming plan nudged'; end if;
  delete from public.filming_plans where client_slug = 'zzthrowawaynine';
  if (select count(*) from public.production_native_client_provisions where client_slug = 'zzthrowawaynine') <> 0 then raise exception 'real receipt for a throwaway'; end if;
  if (select count(*) from public.roster_sheet_outbox where client_slug = 'zzthrowawaynine') <> 0 then raise exception 'throwaway reached the Sheet outbox'; end if;
  if (select email from public.client_profiles where slug = 'zzthrowawaynine') is distinct from 'zz@example.com' then raise exception 'throwaway email'; end if;
  if not ((select source_clients from public.social_media_managers where slug = 'managerb') @> '["ZZ THROWAWAY Nine"]') then raise exception 'throwaway manager'; end if;
  if (public.client_create_native('req-t9', 'zzthrowawaynine', 'ZZ THROWAWAY Nine', 'managerb', 'zz@example.com', 'Admin', 'test'))->>'outcome' <> 'replayed' then raise exception 'test replay'; end if;

  begin perform public.client_create_native_test_teardown('newone', 'Admin'); raise exception 'real client torn down'; exception when others then
    if sqlerrm <> 'client_create_teardown_not_throwaway' then raise; end if; end;
  r := public.client_create_native_test_teardown('zzthrowawaynine', 'Admin');
  if (r->'deleted'->>'roster_row') <> '1' or (r->>'manager_lists_cleared')::int <> 1 then raise exception 'teardown %', r; end if;
  if exists (select 1 from public.social_media_managers where source_clients @> '["ZZ THROWAWAY Nine"]') then raise exception 'still on a manager list'; end if;
  select count(*) into n from (
    select 1 from public.clients where slug = 'zzthrowawaynine'
    union all select 1 from public.client_access where slug = 'zzthrowawaynine'
    union all select 1 from public.client_profiles where slug = 'zzthrowawaynine'
    union all select 1 from public.client_onboarding_progress where client_slug = 'zzthrowawaynine'
    union all select 1 from public.production_native_client_test_provisions where client_slug = 'zzthrowawaynine'
    union all select 1 from public.roster_sheet_outbox where client_slug = 'zzthrowawaynine') z;
  if n <> 0 then raise exception 'teardown left % rows', n; end if;
  if not exists (select 1 from public.clients where slug = 'newone') then raise exception 'the real client was touched'; end if;
  -- a broken web call never fails the write it rides on
  create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
    language plpgsql as $f$ begin raise exception 'net down'; end $f$;
  update public.filming_plans set doc_url = 'https://docs.google.com/document/d/ghi', doc_id = 'ghi' where client_slug = 'newone';
  if (select doc_id from public.filming_plans where client_slug = 'newone') <> 'ghi' then raise exception 'the save was lost'; end if;
  -- the nudge's own lookup failing (a column gone) never fails the save either
  create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
    language sql as $f$ insert into net.sent (url, body) values (url, body) returning id $f$;
  alter table public.client_profiles rename column slack_channel_id to slack_channel_id_gone;
  update public.filming_plans set doc_url = 'https://docs.google.com/document/d/jkl', doc_id = 'jkl' where client_slug = 'newone';
  if (select doc_id from public.filming_plans where client_slug = 'newone') <> 'jkl' then raise exception 'a failing lookup lost the save'; end if;
  if public.slack_finalizer_nudge('newone') then raise exception 'a failing lookup reported a nudge'; end if;
  alter table public.client_profiles rename column slack_channel_id_gone to slack_channel_id;
end $$;

-- roles: service_role alone may execute; nobody else
do $$
declare rl text;
begin
  foreach rl in array array['anon','authenticated','public'] loop
    if rl <> 'public' and (has_function_privilege(rl, 'public.client_create_native(text,text,text,text,text,text,text)', 'execute')
       or has_function_privilege(rl, 'public.client_create_native_test_teardown(text,text)', 'execute')) then raise exception '% can execute', rl; end if;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_name in ('client_create_native', 'client_create_native_test_teardown') and grantee = 'PUBLIC') then
    raise exception 'PUBLIC can execute'; end if;
  if has_function_privilege('service_role', 'public.slack_finalizer_nudge(text)', 'execute')
     or has_function_privilege('anon', 'public.slack_finalizer_nudge(text)', 'execute')
     or has_function_privilege('authenticated', 'public.slack_finalizer_nudge(text)', 'execute') then raise exception 'someone may call the nudge directly'; end if;
  if not has_function_privilege('service_role', 'public.client_create_native(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.client_create_native_test_teardown(text,text)', 'execute') then raise exception 'service_role cannot execute'; end if;
end $$;
select 'CLIENT_CREATE_PROOF_OK' as result;
