-- Proof for scripts/client-resource-census.js on a disposable PostgreSQL.
-- Fictional data only. Run by test/client-resource-census.js when CENSUS_PSQL is
-- set (for example CENSUS_PSQL="psql -h /path/to/socket -p 55432 -U postgres -d t");
-- the test cuts this file at the marker below, puts the census query there and
-- turns its one result into the psql variable :census.
-- Last line when everything matches: CLIENT_RESOURCE_CENSUS_PROOF_OK
\set ON_ERROR_STOP on
begin;
create table clients (slug text primary key, active boolean not null, kind text not null);
create table client_profiles (slug text primary key, email text, instagram_handle text, tiktok_handle text,
  youtube_channel_id text, slack_channel_id text, creative_channel_id text, postforme_account_id text,
  competitors text, keywords text, content_description text, archived_at timestamptz);
create table client_access (slug text, review_token text);
create table syncview_runtime_flags (key text primary key, value jsonb);
create table filming_plans (client_slug text, doc_url text);
create table templates (client_slug text, data jsonb);
create table client_credentials (client_slug text);
create table client_onboarding (slug text);
create table ai_client_onboarding (slug text);
create table legacy_onboarding (slug text);
create table calendar_posts (client text);
create table sample_reviews (client text);
create table analytics_metrics (client_slug text);

insert into clients values ('c1', true, 'client'), ('c2', true, 'client'), ('c3', true, 'client'),
  ('c4', true, 'client'), ('c5', true, 'client'), ('t1', true, 'test'), ('x1', false, 'client');
insert into client_profiles (slug, email, instagram_handle, tiktok_handle, youtube_channel_id, slack_channel_id,
  creative_channel_id, postforme_account_id, competitors, keywords, content_description) values
  ('c1', 'a@example.test', 'ig1', 'tt1', 'yt1', 'S1', 'S2', 'pfm1', 'comp', 'kw', 'desc'),
  ('c2', 'b@example.test', 'ig2', null, null, null, null, null, null, 'kw', null),
  ('c3', null, null, 'tt3', null, null, null, null, null, null, null),
  ('c4', '  ', '', ' ', '', '', '', '', '', '', ''),
  ('x1', 'x@example.test', 'igx', null, null, null, null, null, null, null, null),
  ('t1', 't@example.test', 'igt', null, null, null, null, null, null, null, null);
insert into client_access values ('c1', 'tok1'), ('c2', 'tok2'), ('c3', 'tok3'), ('c4', ''), ('t1', 'tokt');
insert into syncview_runtime_flags values
  ('sample_review_ef_clients',   '{"clients":["c1","c2","c3","c4","t1","gone1","x1"]}'),
  ('calendar_upsert_ef_clients', '{"clients":["c1","c2","c3","t1"]}'),
  ('settings_ef_clients',        '{"clients":["c1","c2","t1"]}'),
  ('write_ui_reroute_clients',   '{"clients":["c1","c2","t1"]}');
insert into filming_plans values ('c1', 'https://docs.example.test/1'), ('c2', '');
-- c1: single link; c2: list whose first slot is blank and second is a link; c3: empty list, so the single field is NOT read
insert into templates values ('c1', '{"thumbnails_canva_link":"https://www.canva.com/x"}'),
  ('c2', '{"thumbnails_canva_link_list":"[\"\", \"https://www.canva.com/y\"]"}'),
  ('c3', '{"thumbnails_canva_link_list":"[\"\"]","thumbnails_canva_link":"https://www.canva.com/z"}'),
  ('c4', '{"thumbnails_canva_link":"see the brief"}');
insert into client_credentials values ('c1'), ('c3');
insert into client_onboarding values ('c1');
insert into ai_client_onboarding values ('c2');
insert into legacy_onboarding values ('c3');
insert into calendar_posts values ('c1'), ('c1'), ('c2'), ('t1');
insert into sample_reviews values ('c1');
insert into analytics_metrics values ('c1'), ('c2'), ('c3');
commit;

-- @@QUERY@@

create temp table census_json as select :'census'::jsonb as j;
do $proof$
declare
  j jsonb := (select j from census_json);
  r record;
  n int := 0;
begin
  for r in select * from (values
    ('roster_row', 5, 0), ('profile', 4, 1), ('review_token', 3, 2), ('email', 2, 3),
    ('instagram_handle', 2, 3), ('tiktok_handle', 2, 3), ('youtube_channel', 1, 4),
    ('any_social_handle', 3, 2), ('competitors', 1, 4), ('keywords', 2, 3), ('description', 1, 4),
    ('research_complete', 1, 4), ('creative_channel', 1, 4), ('client_channel', 1, 4), ('postforme_tiktok', 1, 4),
    ('filming_plan_link', 1, 4), ('templates_row', 4, 1), ('canva_link', 2, 3),
    ('credentials_vault', 2, 3), ('onboarding_form', 3, 2), ('calendar_cards', 2, 3),
    ('sample_reviews', 1, 4), ('analytics_metrics', 3, 2),
    ('routing_sample_review_ef_clients', 4, 1), ('routing_calendar_upsert_ef_clients', 3, 2),
    ('routing_settings_ef_clients', 2, 3), ('routing_write_ui_reroute_clients', 2, 3),
    ('routing_all_four', 2, 3)
  ) as t(k, have, missing) loop
    n := n + 1;
    if (j->'resources'->r.k->>'have')::int is distinct from r.have
       or (j->'resources'->r.k->>'missing')::int is distinct from r.missing then
      raise exception 'census mismatch for %: got %', r.k, j->'resources'->r.k;
    end if;
  end loop;
  if (j->>'active_clients')::int <> 5 or (j->>'active_test_clients')::int <> 1 or (j->>'inactive_roster_rows')::int <> 1 then
    raise exception 'census roster counts wrong: %', j - 'resources' - 'routing_lists';
  end if;
  -- the seven-entry list has two entries that are not an active roster row (one unknown, one inactive)
  if (j->'routing_lists'->'sample_review_ef_clients'->>'entries')::int <> 7
     or (j->'routing_lists'->'sample_review_ef_clients'->>'not_an_active_roster_row')::int <> 2
     or (j->'routing_lists'->'settings_ef_clients'->>'not_an_active_roster_row')::int <> 0 then
    raise exception 'census routing counts wrong: %', j->'routing_lists';
  end if;
  if (j->>'checklist_installed')::boolean then raise exception 'checklist tables are not in the fixture'; end if;
  -- the result is numbers and yes/no only: not one text value, so no slug, token, handle, email or link can be in it
  if exists (select 1 from jsonb_path_query(j, 'strict $.**') v where jsonb_typeof(v) = 'string') then
    raise exception 'the census returned a text value: %', j::text;
  end if;
  raise notice 'checked % resources', n;
end
$proof$;
\echo CLIENT_RESOURCE_CENSUS_PROOF_OK
