-- Way back for 2026-10-02-roster-native.sql. Safe while client_profiles_authority
-- still reads "sheet" (nothing has written through these objects). If the switch
-- was already flipped and rows were written natively, keep the two history tables
-- (they are the only record of those edits) and drop only the functions.
begin;
-- FIRST restore the original client_profile_admin_edit (copied from
-- 2026-09-25-client-profile-edits.sql). The new body calls roster_authority(), so
-- the function must be restored in this same transaction BEFORE that function is
-- dropped, or the Clients tab's save breaks. Its grants are untouched.
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

drop function if exists public.client_profile_archive(text, text, text, text);
drop function if exists public.smm_assign_client(text, text, text, text, text, text, text, text);
drop function if exists public.client_profile_service_write(text, text, jsonb, jsonb, jsonb, text, text, text);
drop function if exists public.roster_route_enrol(text, boolean);
drop function if exists public.roster_is_test_client(text);
drop function if exists public.roster_authority();
-- Clients added to, or taken off, the four save-permission lists by these functions are NOT
-- reverted by this file (the lists are live settings); review them by hand if the switch was used.
-- Only when nothing was written natively:
-- drop table if exists public.roster_sheet_outbox;
-- drop table if exists public.smm_assignment_edits;
-- alter table public.social_media_managers drop column if exists slack_profile_url;
commit;
