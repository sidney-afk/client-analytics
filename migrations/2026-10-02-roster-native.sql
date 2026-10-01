-- ============================================================
-- 2026-10-02 -- Clients Info and Social Media Managers: SyncView's database
-- becomes able to be the main copy (docs/plans/2026-10-02-roster-native.md,
-- Step 1).
--
-- SOURCE-ONLY. Not applied. Lighthouse applies it by hand in the SQL editor
-- after the owner's go; EXECUTION_LOG.md records the apply. Nothing in it
-- changes behaviour by itself: every write function below REFUSES to run
-- unless the runtime flag client_profiles_authority reads {"source":
-- "syncview"}, and that flag stays "sheet" until the owner approves the
-- switch (Step 3). Needs 2026-09-25-sheets-mirror-phase1.sql,
-- 2026-09-25-client-profile-edits.sql and 2026-07-10-smm-weekly-reports.sql.
--
-- WHAT IT ADDS (all additive):
--   social_media_managers.slack_profile_url   the Slack member id the Sheet
--                                             keeps in its slack_profile_url
--                                             column (one per manager).
--   smm_assignment_edits                      who moved which client to which
--                                             manager, append-only.
--   roster_sheet_outbox                       one row per DB write that the
--                                             read-only Sheet copy must catch
--                                             up with (retry list).
--   roster_authority()                        reads the one switch, fails
--                                             closed (missing flag = not
--                                             "syncview").
--   client_profile_service_write()            create or change one client from
--                                             n8n (onboarding, the Slack
--                                             channel finalizer) or an admin;
--                                             writes the field history in the
--                                             same transaction.
--   smm_assign_client()                       set which manager owns a client
--                                             and that manager's Slack id.
--   client_profile_admin_edit()               redefined with one addition: once
--                                             the database is the main copy, the
--                                             Clients tab's edit queues the Sheet
--                                             copy too (see its own comment).
--
-- A client's manager list stays in social_media_managers.source_clients (the
-- column the weekly reports already read), so nothing that reads managers today
-- has to change. A client has exactly one manager; smm_assign_client keeps it
-- that way.
--
-- ACCESS. RLS on, no policies. Every privilege on every new table and function
-- is revoked from all four roles (public, anon, authenticated, service_role);
-- then service_role alone gets what it needs: SELECT and INSERT on the edit
-- history (append-only: never UPDATE, DELETE or TRUNCATE), SELECT, INSERT and
-- UPDATE on the outbox, EXECUTE on the three functions. Identity sequences are
-- revoked from all four roles (identity columns need no sequence privilege).
-- test/roster-native-postgres.js measures every role.
--
-- Idempotent: safe to run twice.
-- ============================================================
begin;

alter table public.social_media_managers
  add column if not exists slack_profile_url text not null default '';

-- ---------- Who moved which client to which manager ----------
create table if not exists public.smm_assignment_edits (
  id                    bigint generated always as identity primary key,
  client_name           text not null,
  old_manager_slug      text,
  new_manager_slug      text,
  old_slack_profile_url text,
  new_slack_profile_url text,
  edited_by             text not null,
  edited_role           text not null,
  request_id            text,
  edited_at             timestamptz not null default now()
);
create index if not exists smm_assignment_edits_client_idx
  on public.smm_assignment_edits (client_name, edited_at desc);

-- ---------- What the read-only Sheet copy still owes ----------
-- The copy always writes the client's CURRENT database row, so several pending
-- rows for the same client collapse into one write when they are drained.
create table if not exists public.roster_sheet_outbox (
  id          bigint generated always as identity primary key,
  tab         text not null check (tab in ('Clients Info', 'Social Media Managers')),
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  client_name text not null,
  status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists roster_sheet_outbox_open_idx
  on public.roster_sheet_outbox (id) where status = 'pending';

-- ---------- The one switch, read fail-closed ----------
create or replace function public.roster_authority()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select f.value ->> 'source' from public.syncview_runtime_flags f where f.key = 'client_profiles_authority'),
    '');
$fn$;

-- ---------- Create or change one client ----------
-- p_columns: real client_profiles columns to set (a blank string clears one).
-- p_extra:   fields kept in client_profiles.extra (postforme_instagram_account_id).
-- p_expect:  optional compare-and-set: field -> the value it must hold now,
--            or the whole call is refused (the Slack finalizer uses it so it
--            never overwrites a channel id someone else just set).
-- p_display_name: given only when the caller means "create if missing, and
--            bring back an archived client" (onboarding); a plain field change
--            leaves it null and is refused for a missing or archived client.
create or replace function public.client_profile_service_write(
  p_slug         text,
  p_display_name text,
  p_columns      jsonb,
  p_extra        jsonb,
  p_expect       jsonb,
  p_actor        text,
  p_role         text,
  p_request_id   text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  allowed constant text[] := array[
    'email', 'competitors', 'keywords', 'specific_keywords', 'content_description',
    'instagram_handle', 'tiktok_handle', 'youtube_channel_id', 'slack_channel_id',
    'creative_channel_id', 'roam_channel_id', 'upload_post_profile', 'postforme_account_id'];
  allowed_extra constant text[] := array['postforme_instagram_account_id'];
  cols    jsonb;
  extras  jsonb;
  expect  jsonb;
  cur     public.client_profiles;
  nxt     public.client_profiles;
  ex      jsonb;
  k       text;
  oldv    text;
  newv    text;
  made    boolean := false;
  restored boolean := false;
  changed int := 0;
  stamp   timestamptz := clock_timestamp();
begin
  if public.roster_authority() is distinct from 'syncview' then
    raise exception 'roster_authority_not_syncview';
  end if;
  if p_role is null or p_role not in ('n8n', 'admin') then raise exception 'client_profile_write_bad_role'; end if;
  if coalesce(btrim(p_actor), '') = '' then raise exception 'client_profile_write_actor_required'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9&]+$' then raise exception 'client_profile_bad_slug'; end if;
  if jsonb_typeof(coalesce(p_columns, '{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(p_extra, '{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(p_expect, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'client_profile_write_bad_changes';
  end if;
  cols := coalesce(p_columns, '{}'::jsonb);
  extras := coalesce(p_extra, '{}'::jsonb);
  expect := coalesce(p_expect, '{}'::jsonb);
  for k in select jsonb_object_keys(cols) loop
    if not (k = any (allowed)) then raise exception 'client_profile_field_not_writable: %', k; end if;
  end loop;
  for k in select jsonb_object_keys(extras) loop
    if not (k = any (allowed_extra)) then raise exception 'client_profile_field_not_writable: %', k; end if;
  end loop;
  for k in select jsonb_object_keys(expect) loop
    if not (k = any (allowed) or k = any (allowed_extra)) then
      raise exception 'client_profile_field_not_writable: %', k;
    end if;
  end loop;
  -- Blank means clear; surrounding spaces never matter.
  cols := coalesce((select jsonb_object_agg(e.key, to_jsonb(nullif(btrim(e.value), '')))
                    from jsonb_each_text(cols) e), '{}'::jsonb);

  select * into cur from public.client_profiles where slug = p_slug for update;
  if not found then
    if coalesce(btrim(p_display_name), '') = '' then raise exception 'client_profile_missing'; end if;
    insert into public.client_profiles (slug, display_name, source, updated_by, updated_at, created_at)
      values (p_slug, btrim(p_display_name), 'syncview', btrim(p_actor), stamp, stamp)
      returning * into cur;
    made := true;
    insert into public.client_profile_edits (slug, field, old_value, new_value, edited_by, edited_role, request_id)
      values (p_slug, '(created)', null, cur.display_name, btrim(p_actor), p_role, p_request_id);
  elsif cur.archived_at is not null then
    if coalesce(btrim(p_display_name), '') = '' then raise exception 'client_profile_archived'; end if;
    update public.client_profiles set archived_at = null where slug = p_slug returning * into cur;
    restored := true;
    insert into public.client_profile_edits (slug, field, old_value, new_value, edited_by, edited_role, request_id)
      values (p_slug, '(restored)', null, cur.display_name, btrim(p_actor), p_role, p_request_id);
  end if;

  for k in select jsonb_object_keys(expect) loop
    oldv := case when k = any (allowed_extra) then cur.extra ->> k else to_jsonb(cur) ->> k end;
    if coalesce(btrim(oldv), '') is distinct from coalesce(btrim(expect ->> k), '') then
      raise exception 'client_profile_expectation_failed: %', k;
    end if;
  end loop;

  nxt := jsonb_populate_record(cur, cols);
  for k in select jsonb_object_keys(cols) loop
    oldv := to_jsonb(cur) ->> k;
    newv := to_jsonb(nxt) ->> k;
    if oldv is distinct from newv then
      insert into public.client_profile_edits (slug, field, old_value, new_value, edited_by, edited_role, request_id)
        values (p_slug, k, oldv, newv, btrim(p_actor), p_role, p_request_id);
      changed := changed + 1;
    end if;
  end loop;
  ex := cur.extra;
  for k in select jsonb_object_keys(extras) loop
    oldv := ex ->> k;
    newv := nullif(btrim(extras ->> k), '');
    if oldv is distinct from newv then
      insert into public.client_profile_edits (slug, field, old_value, new_value, edited_by, edited_role, request_id)
        values (p_slug, 'extra.' || k, oldv, newv, btrim(p_actor), p_role, p_request_id);
      ex := case when newv is null then ex - k else ex || jsonb_build_object(k, newv) end;
      changed := changed + 1;
    end if;
  end loop;

  if changed = 0 and not made and not restored then
    return jsonb_build_object('created', false, 'changed', 0, 'row', to_jsonb(cur) - 'row_hash');
  end if;

  update public.client_profiles set
    email = nxt.email,
    competitors = nxt.competitors,
    keywords = nxt.keywords,
    specific_keywords = nxt.specific_keywords,
    content_description = nxt.content_description,
    instagram_handle = nxt.instagram_handle,
    tiktok_handle = nxt.tiktok_handle,
    youtube_channel_id = nxt.youtube_channel_id,
    slack_channel_id = nxt.slack_channel_id,
    creative_channel_id = nxt.creative_channel_id,
    roam_channel_id = nxt.roam_channel_id,
    upload_post_profile = nxt.upload_post_profile,
    postforme_account_id = nxt.postforme_account_id,
    extra = ex,
    source = 'syncview',
    updated_by = btrim(p_actor),
    updated_at = stamp
  where slug = p_slug
  returning * into nxt;

  insert into public.roster_sheet_outbox (tab, client_slug, client_name)
    values ('Clients Info', p_slug, nxt.display_name);
  return jsonb_build_object('created', made, 'changed', changed, 'row', to_jsonb(nxt) - 'row_hash');
end
$fn$;

-- ---------- Which manager owns a client ----------
-- p_manager_name blank = the client has no manager any more. A manager that
-- does not exist yet is created. p_slack_profile_url, when not blank, becomes
-- that manager's Slack id (it is per manager, as in the Sheet).
create or replace function public.smm_assign_client(
  p_client_slug       text,
  p_client_name       text,
  p_manager_slug      text,
  p_manager_name      text,
  p_slack_profile_url text,
  p_actor             text,
  p_role              text,
  p_request_id        text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  cname    text := btrim(coalesce(p_client_name, ''));
  mname    text := btrim(coalesce(p_manager_name, ''));
  slack    text := btrim(coalesce(p_slack_profile_url, ''));
  old_slug text;
  old_slack text;
  new_row  public.social_media_managers;
  stamp    timestamptz := clock_timestamp();
begin
  if public.roster_authority() is distinct from 'syncview' then
    raise exception 'roster_authority_not_syncview';
  end if;
  if p_role is null or p_role not in ('n8n', 'admin') then raise exception 'smm_assign_bad_role'; end if;
  if coalesce(btrim(p_actor), '') = '' then raise exception 'smm_assign_actor_required'; end if;
  if cname = '' then raise exception 'smm_assign_client_required'; end if;
  if p_client_slug is null or p_client_slug !~ '^[a-z0-9&]+$' then raise exception 'client_profile_bad_slug'; end if;
  if mname <> '' and (p_manager_slug is null or p_manager_slug !~ '^[a-z0-9&]+$') then
    raise exception 'smm_assign_bad_manager_slug';
  end if;

  select m.slug, m.slack_profile_url into old_slug, old_slack
    from public.social_media_managers m
    where exists (select 1 from jsonb_array_elements_text(m.source_clients) c where lower(btrim(c)) = lower(cname))
    order by m.slug limit 1;

  if mname <> '' then
    insert into public.social_media_managers
      (slug, name, email, active, source, source_row_count, source_clients, slack_profile_url, synced_at, updated_at)
    values (p_manager_slug, mname, '', true, 'syncview', 0, '[]'::jsonb, slack, stamp, stamp)
    on conflict (slug) do update set
      active = true,
      source = 'syncview',
      slack_profile_url = case when slack <> '' then slack else public.social_media_managers.slack_profile_url end,
      updated_at = stamp;
  end if;

  -- One manager per client: take the client off every list, then put it on the new one.
  update public.social_media_managers m set
    source_clients = coalesce((select jsonb_agg(c order by c)
                               from jsonb_array_elements_text(m.source_clients) c
                               where lower(btrim(c)) <> lower(cname)), '[]'::jsonb),
    updated_at = stamp
  where exists (select 1 from jsonb_array_elements_text(m.source_clients) c where lower(btrim(c)) = lower(cname));

  if mname <> '' then
    update public.social_media_managers m set
      source_clients = (select jsonb_agg(c order by c)
                        from (select cname as c
                              union
                              select x from jsonb_array_elements_text(m.source_clients) x) u),
      updated_at = stamp
    where m.slug = p_manager_slug
    returning * into new_row;
  end if;

  if old_slug is distinct from nullif(p_manager_slug, '') or (mname <> '' and slack <> '' and slack is distinct from old_slack) then
    insert into public.smm_assignment_edits
      (client_name, old_manager_slug, new_manager_slug, old_slack_profile_url, new_slack_profile_url,
       edited_by, edited_role, request_id)
    values (cname, old_slug, case when mname = '' then null else p_manager_slug end, old_slack,
            case when mname = '' then null else coalesce(nullif(slack, ''), new_row.slack_profile_url) end,
            btrim(p_actor), p_role, p_request_id);
  end if;

  insert into public.roster_sheet_outbox (tab, client_slug, client_name)
    values ('Social Media Managers', p_client_slug, cname);
  return jsonb_build_object(
    'client_name', cname,
    'old_manager_slug', old_slug,
    'manager_slug', case when mname = '' then null else p_manager_slug end,
    'slack_profile_url', case when mname = '' then null else new_row.slack_profile_url end);
end
$fn$;

-- ---------- The Clients tab's own edit now also queues the Sheet copy ----------
-- client_profile_admin_edit (2026-09-25-client-profile-edits.sql) is redefined
-- with ONE addition: once the database is the main copy, a successful edit
-- queues the read-only Sheet copy in the same transaction. While the Sheet is
-- the main copy nothing is queued and the function behaves exactly as before.
-- Same arguments, same checks, same history; the grants below are unchanged
-- (create or replace keeps them).
create or replace function public.client_profile_admin_edit(
  p_slug text,
  p_changes jsonb,
  p_expected_updated_at timestamptz,
  p_actor text,
  p_role text,
  p_member_id text,
  p_sheet_row integer,
  p_request_id text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  allowed constant text[] := array[
    'email', 'instagram_handle', 'tiktok_handle', 'youtube_channel_id',
    'slack_channel_id', 'creative_channel_id', 'upload_post_profile', 'postforme_account_id',
    'content_description', 'keywords', 'specific_keywords', 'competitors'];
  cur public.client_profiles;
  nxt public.client_profiles;
  k text;
  changed int := 0;
begin
  if p_role is distinct from 'admin' then raise exception 'client_profile_edit_admin_only'; end if;
  if coalesce(btrim(p_actor), '') = '' then raise exception 'client_profile_edit_actor_required'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'client_profile_edit_bad_changes'; end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any (allowed)) then raise exception 'client_profile_edit_field_not_editable: %', k; end if;
  end loop;

  select * into cur from public.client_profiles where slug = p_slug for update;
  if not found then raise exception 'client_profile_missing'; end if;
  if cur.archived_at is not null then raise exception 'client_profile_archived'; end if;
  if cur.updated_at is distinct from p_expected_updated_at then raise exception 'client_profile_version_conflict'; end if;

  nxt := jsonb_populate_record(cur, p_changes);
  for k in select jsonb_object_keys(p_changes) loop
    if (to_jsonb(cur) ->> k) is distinct from (to_jsonb(nxt) ->> k) then
      insert into public.client_profile_edits
        (slug, field, old_value, new_value, edited_by, edited_role, edited_member_id, sheet_row, request_id)
      values
        (p_slug, k, to_jsonb(cur) ->> k, to_jsonb(nxt) ->> k, p_actor, p_role, p_member_id, p_sheet_row, p_request_id);
      changed := changed + 1;
    end if;
  end loop;
  if changed = 0 then
    return jsonb_build_object('changed', 0, 'row', to_jsonb(cur) - 'row_hash');
  end if;

  update public.client_profiles set
    email = nxt.email,
    instagram_handle = nxt.instagram_handle,
    tiktok_handle = nxt.tiktok_handle,
    youtube_channel_id = nxt.youtube_channel_id,
    slack_channel_id = nxt.slack_channel_id,
    creative_channel_id = nxt.creative_channel_id,
    upload_post_profile = nxt.upload_post_profile,
    postforme_account_id = nxt.postforme_account_id,
    content_description = nxt.content_description,
    keywords = nxt.keywords,
    specific_keywords = nxt.specific_keywords,
    competitors = nxt.competitors,
    source = 'syncview',
    updated_by = p_actor,
    updated_at = clock_timestamp()
  where slug = p_slug
  returning * into nxt;
  if public.roster_authority() = 'syncview' then
    insert into public.roster_sheet_outbox (tab, client_slug, client_name) values ('Clients Info', p_slug, nxt.display_name);
  end if;
  return jsonb_build_object('changed', changed, 'row', to_jsonb(nxt) - 'row_hash');
end
$fn$;

-- ---------- Access: RLS on, everything revoked, then the minimum ----------
alter table public.smm_assignment_edits enable row level security;
alter table public.roster_sheet_outbox enable row level security;
revoke all on table public.smm_assignment_edits from public, anon, authenticated, service_role;
revoke all on table public.roster_sheet_outbox from public, anon, authenticated, service_role;
grant select, insert on table public.smm_assignment_edits to service_role;
grant select, insert, update on table public.roster_sheet_outbox to service_role;

do $seqs$
declare s text;
begin
  for s in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_depend d on d.objid = c.oid and d.deptype = 'i'
    where c.relkind = 'S' and n.nspname = 'public'
      and d.refobjid in ('public.smm_assignment_edits'::regclass, 'public.roster_sheet_outbox'::regclass)
  loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
  end loop;
end
$seqs$;

revoke all on function public.roster_authority() from public, anon, authenticated, service_role;
revoke all on function public.client_profile_service_write(text, text, jsonb, jsonb, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.smm_assign_client(text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.roster_authority() to service_role;
grant execute on function public.client_profile_service_write(text, text, jsonb, jsonb, jsonb, text, text, text) to service_role;
grant execute on function public.smm_assign_client(text, text, text, text, text, text, text, text) to service_role;

commit;

-- VERIFY (expect every anon/authenticated column false, service_role: edits
-- select+insert true / mutate false, outbox select+insert+update true, delete
-- false, execute true for service_role only, rls true, policies 0):
-- select c.relname,
--   has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_any,
--   has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') auth_any,
--   has_table_privilege('service_role', c.oid, 'DELETE,TRUNCATE') sr_destroy,
--   c.relrowsecurity rls,
--   (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) policies
-- from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('smm_assignment_edits', 'roster_sheet_outbox');
-- select p.proname,
--   has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
--   has_function_privilege('service_role', p.oid, 'EXECUTE') sr_exec
-- from pg_proc p where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('roster_authority', 'client_profile_service_write', 'smm_assign_client');
