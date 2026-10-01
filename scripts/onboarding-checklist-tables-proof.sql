-- Disposable-cluster proof for migrations/2026-10-03-onboarding-checklist-tables.sql.
-- Run on a THROWAWAY PostgreSQL (never a real project), as a superuser:
--   psql -v ON_ERROR_STOP=1 -d <empty database> -f scripts/onboarding-checklist-tables-proof.sql
-- from the repository root (it \i-includes the migration). Fictional data only.
-- Ends with the line: ONBOARDING_CHECKLIST_TABLES_PROOF_OK
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; -- Supabase gives service_role BYPASSRLS
end $$;

-- minimal stand-ins for the tables the migration references (only the columns it reads)
create table public.clients (slug text primary key, active boolean not null default true);
create table public.client_profiles (slug text primary key, email text, instagram_handle text, tiktok_handle text,
  youtube_channel_id text, slack_channel_id text, creative_channel_id text, postforme_account_id text,
  competitors text, keywords text, content_description text, archived_at timestamptz);
create table public.client_access (slug text primary key, review_token text);
create table public.syncview_runtime_flags (key text primary key, value jsonb not null);
create table public.filming_plans (client_slug text primary key, doc_url text);
create table public.templates (client_slug text primary key, data jsonb);
create table public.client_credentials (id bigserial primary key, client_slug text);
create table public.client_onboarding (id bigserial primary key, slug text);
create table public.ai_client_onboarding (id bigserial primary key, slug text);
create table public.calendar_posts (client text, id text, primary key (client, id));
create table public.sample_reviews (client text, id text, primary key (client, id));
create table public.analytics_metrics (client_slug text, date date);

insert into public.clients values ('alpha', true), ('beta', true);
insert into public.client_profiles (slug, email, creative_channel_id, keywords) values
  ('alpha', 'a@example.test', 'C0123456789', 'k'), ('beta', null, null, null);
insert into public.client_access values ('alpha', 'tok-alpha');
insert into public.syncview_runtime_flags values
  ('sample_review_ef_clients', '{"clients":["alpha"]}'), ('calendar_upsert_ef_clients', '{"clients":["alpha"]}'),
  ('settings_ef_clients', '{"clients":["alpha"]}'), ('write_ui_reroute_clients', '{"clients":["alpha","beta"]}');
insert into public.filming_plans values ('alpha', 'https://docs.example.test/d/1');
insert into public.templates values ('alpha', '{"thumbnails_canva_link":"https://www.canva.com/design/x"}');

\i migrations/2026-10-03-onboarding-checklist-tables.sql
\i migrations/2026-10-03-onboarding-checklist-tables.sql

do $$
declare r jsonb; v record; n int; ts timestamptz;
begin
  -- catalog
  if (select count(*) from public.onboarding_steps) <> 27 then raise exception 'catalog count'; end if;
  if (select count(*) from public.onboarding_steps where required) <> 26 then raise exception 'required count'; end if;
  if (select count(*) from public.onboarding_steps where step_key = 'syncview_link_sent' and not required) <> 1 then raise exception 'optional step'; end if;
  if exists (select 1 from public.onboarding_steps where step_key like '%kickoff_call%') then raise exception 'kickoff call must be out'; end if;

  -- ensure is idempotent
  if public.client_onboarding_ensure('alpha') <> 27 then raise exception 'ensure first'; end if;
  if public.client_onboarding_ensure('alpha') <> 0 then raise exception 'ensure second'; end if;
  begin perform public.client_onboarding_ensure('nobody'); raise exception 'ensure missing client'; exception when others then
    if sqlerrm <> 'client_onboarding_client_missing' then raise; end if; end;

  -- set_step: admin only, version checked, skip needs a note, history written
  select updated_at into ts from public.client_onboarding_progress where client_slug='alpha' and step_key='first_card_created';
  begin perform public.client_onboarding_set_step('alpha','first_card_created','done','link',null,'owner','smm',ts,'r1'); raise exception 'smm allowed'; exception when others then
    if sqlerrm <> 'client_onboarding_admin_only' then raise; end if; end;
  begin perform public.client_onboarding_set_step('alpha','first_card_created','skipped',null,'  ','owner','admin',ts,'r2'); raise exception 'skip without note'; exception when others then
    if sqlerrm <> 'client_onboarding_skip_needs_note' then raise; end if; end;
  begin perform public.client_onboarding_set_step('alpha','first_card_created','done',null,null,'owner','admin',ts - interval '1 second','r3'); raise exception 'stale version'; exception when others then
    if sqlerrm <> 'client_onboarding_version_conflict' then raise; end if; end;
  r := public.client_onboarding_set_step('alpha','first_card_created','done','evidence-link',null,'owner','admin',ts,'r4');
  if r->>'status' <> 'done' then raise exception 'set done'; end if;
  if (select done_by from public.client_onboarding_progress where client_slug='alpha' and step_key='first_card_created') <> 'owner' then raise exception 'done_by'; end if;
  if (select count(*) from public.client_onboarding_events where client_slug='alpha' and request_id='r4') <> 1 then raise exception 'event not written'; end if;
  begin perform public.client_onboarding_set_step('alpha','nope','done',null,null,'owner','admin',now(),'r5'); raise exception 'unknown step'; exception when others then
    if sqlerrm <> 'client_onboarding_unknown_step' then raise; end if; end;

  -- history cannot be changed, even by the owner role
  begin update public.client_onboarding_events set actor = 'x'; raise exception 'event update'; exception when others then
    if sqlerrm <> 'client_onboarding_events_append_only' then raise; end if; end;
  begin delete from public.client_onboarding_events; raise exception 'event delete'; exception when others then
    if sqlerrm <> 'client_onboarding_events_append_only' then raise; end if; end;
  begin truncate public.client_onboarding_events; raise exception 'event truncate'; exception when others then
    if sqlerrm <> 'client_onboarding_events_append_only' then raise; end if; end;

  -- a profile with no progress rows yet still shows every required step as todo
  select * into v from public.client_onboarding_summary_v1 where client_slug = 'beta';
  if v.required_steps <> 26 or v.required_todo <> 26 or v.onboarded then raise exception 'unensured summary %', v; end if;
  -- summary: one done, 25 required still todo, not onboarded
  select * into v from public.client_onboarding_summary_v1 where client_slug = 'alpha';
  if v.required_steps <> 26 or v.required_done <> 1 or v.required_todo <> 25 or v.onboarded then raise exception 'summary %', v; end if;
  -- decide every required step (skipped needs a note, unknown does not): onboarded
  update public.client_onboarding_progress set status = 'unknown' where client_slug='alpha'
     and step_key in (select step_key from public.onboarding_steps where required) and status = 'todo';
  select * into v from public.client_onboarding_summary_v1 where client_slug = 'alpha';
  if not v.onboarded or v.required_decided_other <> 25 then raise exception 'unknown must not count as todo'; end if;

  -- resource view: present or missing only
  select * into v from public.client_resource_status_v1 where client_slug = 'alpha';
  if not (v.token_present and v.routing_lists_enrolled = 4 and v.email_present and v.creative_channel_present
          and v.filming_plan_linked and v.templates_row_present and v.canva_link_present and v.keywords_present) then raise exception 'alpha view %', v; end if;
  if v.client_channel_present or v.credentials_present or v.cards_present or v.metrics_present then raise exception 'alpha false positives %', v; end if;
  select * into v from public.client_resource_status_v1 where client_slug = 'beta';
  if v.token_present or v.routing_lists_enrolled <> 1 or v.email_present or v.filming_plan_linked or v.canva_link_present then raise exception 'beta view %', v; end if;

  -- facts stored in client_resources show in the status view, as found only
  insert into public.client_resources (client_slug, resource_key, value, status) values
    ('alpha','drive_client_folder','folder-id-1','found'), ('alpha','brain_folder','','found'), ('alpha','hubspot_contact','c-9','missing');
  select * into v from public.client_resource_status_v1 where client_slug = 'alpha';
  if not v.drive_client_folder_found or v.brain_folder_found or v.hubspot_contact_found or v.sandcastles_project_found then raise exception 'stored resources %', v; end if;

  -- a required step added to the catalog later reopens "onboarded" for a client that had finished
  insert into public.onboarding_steps (step_key, position, label, kind, required) values ('later_required_step', 99, 'Later step', 'owner', true);
  select * into v from public.client_onboarding_summary_v1 where client_slug = 'alpha';
  if v.onboarded or v.required_steps <> 27 or v.required_todo <> 1 then raise exception 'new catalog step must reopen %', v; end if;
  delete from public.onboarding_steps where step_key = 'later_required_step';

  -- sales: an import must stay unknown
  insert into public.client_sales_state (client_slug, imported_unknown) values ('alpha', true);
  begin update public.client_sales_state set contract_state = 'signed' where client_slug = 'alpha'; raise exception 'import marked signed'; exception when check_violation then null; end;

  -- cascade: deleting a profile removes its progress, resources, sales state, proposals; history stays
  insert into public.client_resources (client_slug, resource_key, status) values ('beta','brain_folder','found');
  insert into public.client_backfill_proposals (client_slug, resource_key, proposed_value, source, confidence) values ('beta','drive_client_folder','x','drive','high');
  perform public.client_onboarding_ensure('beta');
  delete from public.client_profiles where slug = 'beta';
  select count(*) into n from (select 1 from public.client_onboarding_progress where client_slug='beta'
    union all select 1 from public.client_resources where client_slug='beta'
    union all select 1 from public.client_backfill_proposals where client_slug='beta') z;
  if n <> 0 then raise exception 'cascade left % rows', n; end if;
end $$;

-- roles: anon, authenticated and public can do nothing; service_role reads and calls the functions, never writes a table
do $$
declare rl text; t text; tbls text[] := array['onboarding_steps','client_onboarding_progress','client_onboarding_events',
  'client_resources','client_sales_state','client_backfill_proposals','client_resource_status_v1','client_onboarding_summary_v1'];
begin
  foreach t in array tbls loop
    foreach rl in array array['anon','authenticated'] loop
      if has_table_privilege(rl, 'public.'||t, 'select,insert,update,delete,truncate,references,trigger') then raise exception '% has a privilege on %', rl, t; end if;
    end loop;
    if not has_table_privilege('service_role', 'public.'||t, 'select') then raise exception 'service_role cannot read %', t; end if;
    if has_table_privilege('service_role', 'public.'||t, 'insert,update,delete,truncate') then raise exception 'service_role can write %', t; end if;
  end loop;
  foreach rl in array array['anon','authenticated'] loop
    if has_function_privilege(rl, 'public.client_onboarding_ensure(text)', 'execute')
       or has_function_privilege(rl, 'public.client_onboarding_set_step(text,text,text,text,text,text,text,timestamptz,text)', 'execute') then
      raise exception '% can execute', rl; end if;
  end loop;
  if not has_function_privilege('service_role', 'public.client_onboarding_set_step(text,text,text,text,text,text,text,timestamptz,text)', 'execute') then raise exception 'service_role cannot execute'; end if;
  if has_sequence_privilege('service_role', 'public.client_onboarding_events_id_seq', 'usage,update') then raise exception 'sequence open'; end if;
end $$;
-- the same, for real, as service_role
set role service_role;
select count(*) as service_role_can_read from public.client_onboarding_summary_v1;
do $$ begin
  begin insert into public.client_onboarding_events (client_slug, step_key, action, actor, role) values ('a','b','c','d','e'); raise exception 'service_role wrote history'; exception when insufficient_privilege then null; end;
  perform public.client_onboarding_set_step('alpha','smm_assigned','done','e',null,'owner','admin',(select updated_at from public.client_onboarding_progress where client_slug='alpha' and step_key='smm_assigned'),'r9');
end $$;
reset role;
set role anon;
do $$ begin begin perform 1 from public.onboarding_steps; raise exception 'anon read the catalog'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'ONBOARDING_CHECKLIST_TABLES_PROOF_OK' as result;
