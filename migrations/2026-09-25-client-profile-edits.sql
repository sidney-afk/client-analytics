-- ============================================================
-- 2026-09-25 — Clients tab, step 2: admin edits and their history
-- (docs/plans/2026-09-24-sheets-to-supabase.md, "Later: a Clients admin tab").
--
-- WHAT. One table, client_profile_edits: one row per changed field (who, when,
-- from what, to what, and which Sheet row was written). One function,
-- client_profile_admin_edit(): applies an admin's changes to client_profiles
-- and writes their history in the same transaction, refusing if the row
-- changed since the editor loaded it (updated_at is the version).
--
-- ORDER. The client-profile-write Edge Function writes the Clients Info Sheet
-- FIRST (the Sheet stays the main copy while client_profiles_authority is
-- "sheet"), and only then calls this function. client_profiles_authority is
-- not touched here.
--
-- ACCESS. RLS on, no policies. Every privilege on the table and the function
-- is revoked from all four roles (public, anon, authenticated, service_role);
-- then service_role alone gets SELECT and INSERT on the history (never UPDATE,
-- DELETE or TRUNCATE: history is append-only) and EXECUTE on the function.
-- The identity column needs no sequence privilege; its sequence is revoked
-- from all four roles too. test/client-profile-edits-roles-postgres.js
-- measures every role.
--
-- Idempotent: safe to run twice. Needs 2026-09-25-sheets-mirror-phase1.sql.
-- ============================================================
begin;

create table if not exists public.client_profile_edits (
  id             bigint generated always as identity primary key,
  slug           text not null references public.client_profiles (slug),
  field          text not null,
  old_value      text,
  new_value      text,
  edited_by      text not null,
  edited_role    text not null,
  edited_member_id text,
  sheet_row      integer,
  request_id     text,
  edited_at      timestamptz not null default now()
);
create index if not exists client_profile_edits_slug_idx
  on public.client_profile_edits (slug, edited_at desc);

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
  return jsonb_build_object('changed', changed, 'row', to_jsonb(nxt) - 'row_hash');
end
$fn$;

-- ---------- Access: RLS on, everything revoked, then the minimum ----------
alter table public.client_profile_edits enable row level security;
revoke all on table public.client_profile_edits from public, anon, authenticated, service_role;
grant select, insert on table public.client_profile_edits to service_role;

do $seqs$
declare s text;
begin
  for s in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_depend d on d.objid = c.oid and d.deptype = 'i'
    where c.relkind = 'S' and n.nspname = 'public'
      and d.refobjid = 'public.client_profile_edits'::regclass
  loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
  end loop;
end
$seqs$;

revoke all on function public.client_profile_admin_edit(text, jsonb, timestamptz, text, text, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.client_profile_admin_edit(text, jsonb, timestamptz, text, text, text, integer, text)
  to service_role;

commit;

-- VERIFY (expect anon/authenticated false everywhere, service_role
-- select/insert true, update/delete/truncate false, execute true for
-- service_role only, rls true, policies 0):
-- select has_table_privilege('anon', 'public.client_profile_edits', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_any,
--   has_table_privilege('authenticated', 'public.client_profile_edits', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') auth_any,
--   has_table_privilege('service_role', 'public.client_profile_edits', 'SELECT') sr_select,
--   has_table_privilege('service_role', 'public.client_profile_edits', 'UPDATE,DELETE,TRUNCATE') sr_mutate,
--   has_function_privilege('anon', 'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)', 'EXECUTE') anon_exec,
--   has_function_privilege('authenticated', 'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)', 'EXECUTE') auth_exec,
--   has_function_privilege('service_role', 'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)', 'EXECUTE') sr_exec;

-- ROLLBACK (the Sheet keeps every edit; only the history and function go):
-- begin;
-- drop function if exists public.client_profile_admin_edit(text, jsonb, timestamptz, text, text, text, integer, text);
-- drop table if exists public.client_profile_edits;
-- commit;
