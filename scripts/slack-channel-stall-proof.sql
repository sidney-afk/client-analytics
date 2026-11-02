-- Disposable-cluster proof for migrations/2026-11-02-slack-channel-stall-guard.sql (OPEN_REPAIRS 673).
-- Run on a THROWAWAY PostgreSQL (never a real project), as a superuser, from the repo root:
--   psql -v ON_ERROR_STOP=1 -d <empty database> -f scripts/slack-channel-stall-proof.sql
-- It first runs scripts/client-create-proof.sql (Create client and its Slack nudge, as live), gives
-- the two onboarding form tables their real columns, makes Roster's profile write honour its
-- expectation, applies the new file twice and checks it. Fictional data only; nothing reaches Slack
-- (the nudge's web call is recorded in net.sent instead of sent).
-- Ends with the line: SLACK_CHANNEL_STALL_PROOF_OK
\set ON_ERROR_STOP on
\i scripts/client-create-proof.sql

-- As live (measured 2026-11-02): id and created_at are TEXT, created_at an ISO 8601 string.
alter table public.client_onboarding alter column id drop default, alter column id type text using id::text;
alter table public.client_onboarding alter column id set default gen_random_uuid()::text;
alter table public.client_onboarding add column first_name text, add column last_name text, add column email text,
  add column created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
alter table public.ai_client_onboarding alter column id drop default, alter column id type text using id::text;
alter table public.ai_client_onboarding alter column id set default gen_random_uuid()::text;
alter table public.ai_client_onboarding add column first_name text, add column last_name text, add column email text,
  add column created_at text not null default to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

-- Roster's profile write, widened again: an expectation that no longer holds refuses the write, as the real one does.
create or replace function public.client_profile_service_write(p_slug text, p_display_name text, p_columns jsonb, p_extra jsonb, p_expect jsonb,
  p_actor text, p_role text, p_request_id text) returns jsonb language plpgsql as $$
declare made boolean := false;
begin
  if public.roster_authority() is distinct from 'syncview' then raise exception 'roster_authority_not_syncview'; end if;
  if p_role is null or p_role not in ('n8n', 'admin') then raise exception 'client_profile_write_bad_role'; end if;
  if not exists (select 1 from public.client_profiles where slug = p_slug) then
    if coalesce(btrim(p_display_name), '') = '' then raise exception 'client_profile_missing'; end if;
    insert into public.client_profiles (slug, display_name, source, updated_by, created_at) values (p_slug, p_display_name, 'syncview', p_actor, clock_timestamp());
    insert into public.client_profile_edits (slug, field, new_value, edited_by, edited_role, request_id) values (p_slug, '(created)', p_display_name, p_actor, p_role, p_request_id);
    made := true;
  end if;
  if coalesce(p_expect, '{}') ? 'email' and coalesce(btrim((select email from public.client_profiles where slug = p_slug)), '') <> coalesce(btrim(p_expect->>'email'), '') then
    raise exception 'client_profile_expectation_failed: email';
  end if;
  if p_columns ? 'email' then
    update public.client_profiles set email = p_columns->>'email' where slug = p_slug;
    insert into public.client_profile_edits (slug, field, new_value, edited_by, edited_role, request_id) values (p_slug, 'email', p_columns->>'email', p_actor, p_role, p_request_id);
  end if;
  insert into public.roster_sheet_outbox (tab, client_slug, client_name) values ('Clients Info', p_slug, coalesce(p_display_name, p_slug));
  return jsonb_build_object('created', made);
end $$;

\i migrations/2026-11-02-slack-channel-stall-guard.sql
\i migrations/2026-11-02-slack-channel-stall-guard.sql

create table public.proof_mark (k text primary key, n int);
create function pg_temp.nudges_for(p_name text) returns int language sql as $$ select count(*)::int from net.sent where body->>'client_name' = p_name $$;

-- A. The 2 Nov 2026 order: client created with no email, then the form arrives.
select (public.client_create_native('req-s1', 'patform', 'Pat Form', 'managera', '', 'Admin', 'client'))->>'slack';
do $$ begin
  if pg_temp.nudges_for('Pat Form') <> 1 then raise exception 'A: the create should nudge once, got %', pg_temp.nudges_for('Pat Form'); end if;
  if coalesce((select email from public.client_profiles where slug = 'patform'), '') <> '' then raise exception 'A: an email appeared before the form'; end if;
end $$;
insert into public.client_onboarding (first_name, last_name, email) values (' Pat ', 'Form', 'Pat@Example.com');
do $$ begin
  if (select email from public.client_profiles where slug = 'patform') is distinct from 'Pat@Example.com' then raise exception 'A: the form email was not copied'; end if;
  if not exists (select 1 from public.client_profile_edits where slug = 'patform' and field = 'email' and edited_by = 'Onboarding form (automatic)' and new_value = 'Pat@Example.com') then
    raise exception 'A: no history row for the copied email'; end if;
  if pg_temp.nudges_for('Pat Form') <> 2 then raise exception 'A: the email arriving should nudge the finalizer, got %', pg_temp.nudges_for('Pat Form'); end if;
end $$;

-- B. A typed email is never overwritten by a different form email (the view says why it waits instead).
select (public.client_create_native('req-s2', 'typedone', 'Typed One', 'managera', 'typed@example.com', 'Admin', 'client'))->>'slack';
insert into public.ai_client_onboarding (first_name, last_name, email) values ('Typed', 'One', 'other@example.com');
do $$ begin
  if (select email from public.client_profiles where slug = 'typedone') <> 'typed@example.com' then raise exception 'B: a typed email was overwritten'; end if;
  if pg_temp.nudges_for('Typed One') <> 1 then raise exception 'B: an unchanged email nudged'; end if;
end $$;

-- C. The other order: the form first, then Create client with no email (one transaction).
insert into public.client_onboarding (first_name, last_name, email) values ('Rev', 'Erse', 'rev@example.com');
select (public.client_create_native('req-s3', 'reverse', 'Rev Erse', 'managera', '', 'Admin', 'client'))->>'slack';
do $$ begin
  if (select email from public.client_profiles where slug = 'reverse') is distinct from 'rev@example.com' then raise exception 'C: a profile created after its form got no email'; end if;
  if pg_temp.nudges_for('Rev Erse') <> 1 then raise exception 'C: expected exactly the create''s own nudge, got %', pg_temp.nudges_for('Rev Erse'); end if;
end $$;

-- D. A test client is never filled or nudged.
select (public.client_create_native('req-s4', 'zzthrowawayform', 'ZZ THROWAWAY Form', 'managerb', '', 'Admin', 'test'))->>'slack';
insert into public.client_onboarding (first_name, last_name, email) values ('ZZ THROWAWAY', 'Form', 'zz@example.com');
do $$ begin
  if coalesce((select email from public.client_profiles where slug = 'zzthrowawayform'), '') <> '' then raise exception 'D: a test client was filled'; end if;
  if pg_temp.nudges_for('ZZ THROWAWAY Form') <> 0 then raise exception 'D: a test client was nudged'; end if;
end $$;

-- E. A client whose channels already exist is left alone.
select (public.client_create_native('req-s5', 'hasroom', 'Has Room', 'managera', '', 'Admin', 'client'))->>'slack';
update public.client_profiles set creative_channel_id = 'CPROOF0001' where slug = 'hasroom';
insert into public.client_onboarding (first_name, last_name, email) values ('Has', 'Room', 'room@example.com');
do $$ begin
  if coalesce((select email from public.client_profiles where slug = 'hasroom'), '') <> '' then raise exception 'E: a client with a channel was filled'; end if;
end $$;

-- F. Nothing here can fail a form insert or a profile save.
select (public.client_create_native('req-s6', 'brokenroster', 'Broken Roster', 'managera', '', 'Admin', 'client'))->>'slack';
create or replace function public.roster_authority() returns text language sql as $$ select 'sheet' $$;
insert into public.client_onboarding (first_name, last_name, email) values ('Broken', 'Roster', 'broken@example.com');
create or replace function public.roster_authority() returns text language sql as $$ select 'syncview' $$;
do $$ begin
  if (select count(*) from public.client_onboarding where email = 'broken@example.com') <> 1 then raise exception 'F: the form row was lost'; end if;
  if coalesce((select email from public.client_profiles where slug = 'brokenroster'), '') <> '' then raise exception 'F: wrote past a refusing roster'; end if;
end $$;
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
  language plpgsql as $f$ begin raise exception 'net down'; end $f$;
update public.client_profiles set email = 'later@example.com' where slug = 'brokenroster';
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
  language sql as $f$ insert into net.sent (url, body) values (url, body) returning id $f$;
do $$ begin
  if (select email from public.client_profiles where slug = 'brokenroster') <> 'later@example.com' then raise exception 'F: a broken nudge lost the save'; end if;
end $$;

-- G. An email typed later by anyone (the Clients tab, a backfill) nudges once; a second edit does not.
select (public.client_create_native('req-s7', 'latetyped', 'Late Typed', 'managera', '', 'Admin', 'client'))->>'slack';
update public.client_profiles set email = 'late@example.com' where slug = 'latetyped';
update public.client_profiles set email = 'late2@example.com' where slug = 'latetyped';
do $$ begin
  if pg_temp.nudges_for('Late Typed') <> 2 then raise exception 'G: expected the create''s nudge and one for the email, got %', pg_temp.nudges_for('Late Typed'); end if;
end $$;

-- H. The watcher's view.
update public.clients set created_at = now() - interval '2 hours' where slug in ('patform', 'typedone');
update public.client_onboarding set created_at = to_char((now() - interval '2 hours') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where first_name = ' Pat ';
-- a form whose time is not a time is read as no time, never an error
insert into public.client_onboarding (first_name, last_name, email, created_at) values ('Odd', 'Stamp', 'odd@example.com', 'yesterday-ish');
update public.ai_client_onboarding set created_at = to_char((now() - interval '2 hours') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where first_name = 'Typed';
insert into public.clients (slug, display_name, kind, created_at) values ('oldroom', 'Old Room', 'client', now() - interval '90 days');
insert into public.client_profiles (slug, display_name, created_at) values ('oldroom', 'Old Room', now() - interval '90 days');
do $$
declare v record;
begin
  select * into v from public.client_slack_channel_stalls_v1 where slug = 'patform';
  if v is null or v.hours_waiting < 1.9 or v.has_creative or v.has_private then raise exception 'H: patform row %', to_jsonb(v); end if;
  if v.waiting_for <> array['manager_slack_id', 'filming_plan'] then raise exception 'H: patform waits for %', v.waiting_for; end if;
  select * into v from public.client_slack_channel_stalls_v1 where slug = 'typedone';
  if not ('email_differs_from_form' = any (v.waiting_for)) then raise exception 'H: typedone waits for %', v.waiting_for; end if;
  if exists (select 1 from public.client_slack_channel_stalls_v1 where slug = 'zzthrowawayform') then raise exception 'H: a test client is listed'; end if;
  if exists (select 1 from public.client_slack_channel_stalls_v1 where slug = 'oldroom') then raise exception 'H: a 90 day old client is listed'; end if;
  if not exists (select 1 from public.client_slack_channel_stalls_v1 where slug = 'reverse' and form_received_at is not null) then raise exception 'H: reverse not listed'; end if;
end $$;
-- every piece in place: an empty waiting_for (the finalizer should have made the channels)
update public.social_media_managers set slack_profile_url = 'UPROOF0001' where slug = 'managera';
insert into public.filming_plans (client_slug, doc_url, doc_id) values ('patform', 'https://docs.google.com/document/d/p1', 'p1');
do $$ begin
  if (select waiting_for from public.client_slack_channel_stalls_v1 where slug = 'patform') <> '{}'::text[] then
    raise exception 'H: all pieces in, still waits for %', (select waiting_for from public.client_slack_channel_stalls_v1 where slug = 'patform'); end if;
end $$;
-- one channel made: still listed; both made: gone
update public.client_profiles set creative_channel_id = 'CPROOF0002' where slug = 'patform';
do $$ begin
  if not exists (select 1 from public.client_slack_channel_stalls_v1 where slug = 'patform' and has_creative and not has_private) then raise exception 'H: half done not listed'; end if;
end $$;
update public.client_profiles set slack_channel_id = 'CPROOF0003' where slug = 'patform';
do $$ begin
  if exists (select 1 from public.client_slack_channel_stalls_v1 where slug = 'patform') then raise exception 'H: a finished client is listed'; end if;
end $$;

-- I. Nobody but the owner runs these or reads the view.
do $$
declare rl text; f text;
begin
  foreach rl in array array['anon', 'authenticated', 'service_role'] loop
    foreach f in array array['public.onboarding_form_client_name(text,text)', 'public.onboarding_form_at(text)', 'public.client_profile_email_from_form(text,text)',
        'public.onboarding_form_fill_profile_email()', 'public.client_profiles_email_from_form()', 'public.client_profiles_email_slack_nudge()'] loop
      if has_function_privilege(rl, f, 'execute') then raise exception 'I: % can execute %', rl, f; end if;
    end loop;
    if has_table_privilege(rl, 'public.client_slack_channel_stalls_v1', 'select') then raise exception 'I: % can read the view', rl; end if;
  end loop;
end $$;

select 'SLACK_CHANNEL_STALL_PROOF_OK' as result;
