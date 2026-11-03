-- ============================================================
-- ROLLBACK of 2026-11-02-client-postforme-accounts.sql (OPEN_REPAIRS 666).
-- Drops the five unique indexes and restores client_profile_admin_edit exactly as
-- 2026-10-31-client-facebook-page.sql left it (the block below is that file's,
-- unchanged). Values already saved in extra stay there, harmless; to remove them:
--   update public.client_profiles set extra = extra - 'postforme_youtube_account_id'
--     - 'postforme_linkedin_account_id' - 'youtube_made_for_kids';
-- HOW TO TELL IT IS ROLLED BACK (expect true):
--   select position('youtube_made_for_kids' in pg_get_functiondef(
--     'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)'::regprocedure)) = 0
--     and (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'client_profiles'
--          and indexname like 'client\_profiles\_postforme\_%\_uniq') = 0 as rolled_back;
-- ============================================================
begin;
set local lock_timeout = '5s';

drop index if exists public.client_profiles_postforme_account_id_uniq;
drop index if exists public.client_profiles_postforme_instagram_account_id_uniq;
drop index if exists public.client_profiles_postforme_facebook_account_id_uniq;
drop index if exists public.client_profiles_postforme_youtube_account_id_uniq;
drop index if exists public.client_profiles_postforme_linkedin_account_id_uniq;

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
    'content_description', 'keywords', 'specific_keywords', 'competitors',
    'slack_mention_user_id'];
  -- Kept in client_profiles.extra, never in a column.
  allowed_extra constant text[] := array['postforme_facebook_account_id', 'postforme_instagram_account_id'];
  cols jsonb := '{}'::jsonb;
  extras jsonb := '{}'::jsonb;
  cur public.client_profiles;
  nxt public.client_profiles;
  ex jsonb;
  k text;
  oldv text;
  newv text;
  changed int := 0;
begin
  if p_role is distinct from 'admin' then raise exception 'client_profile_edit_admin_only'; end if;
  if coalesce(btrim(p_actor), '') = '' then raise exception 'client_profile_edit_actor_required'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'client_profile_edit_bad_changes'; end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k = any (allowed_extra) then
      newv := nullif(btrim(coalesce(p_changes ->> k, '')), '');
      if newv is not null and newv !~ '^spc_[A-Za-z0-9]{6,80}$' then
        raise exception 'client_profile_edit_bad_value: %', k;
      end if;
      extras := extras || jsonb_build_object(k, newv);
    elsif k = any (allowed) then
      cols := cols || jsonb_build_object(k, p_changes -> k);
    else
      raise exception 'client_profile_edit_field_not_editable: %', k;
    end if;
  end loop;

  select * into cur from public.client_profiles where slug = p_slug for update;
  if not found then raise exception 'client_profile_missing'; end if;
  if cur.archived_at is not null then raise exception 'client_profile_archived'; end if;
  if cur.updated_at is distinct from p_expected_updated_at then raise exception 'client_profile_version_conflict'; end if;

  nxt := jsonb_populate_record(cur, cols);
  for k in select jsonb_object_keys(cols) loop
    if (to_jsonb(cur) ->> k) is distinct from (to_jsonb(nxt) ->> k) then
      insert into public.client_profile_edits
        (slug, field, old_value, new_value, edited_by, edited_role, edited_member_id, sheet_row, request_id)
      values
        (p_slug, k, to_jsonb(cur) ->> k, to_jsonb(nxt) ->> k, p_actor, p_role, p_member_id, p_sheet_row, p_request_id);
      changed := changed + 1;
    end if;
  end loop;

  ex := coalesce(cur.extra, '{}'::jsonb);
  for k in select jsonb_object_keys(extras) loop
    oldv := nullif(btrim(coalesce(cur.extra ->> k, '')), '');
    newv := extras ->> k;
    if oldv is distinct from newv then
      ex := case when newv is null then ex - k else ex || jsonb_build_object(k, newv) end;
      insert into public.client_profile_edits
        (slug, field, old_value, new_value, edited_by, edited_role, edited_member_id, sheet_row, request_id)
      values
        (p_slug, 'extra.' || k, oldv, newv, p_actor, p_role, p_member_id, p_sheet_row, p_request_id);
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
    slack_mention_user_id = nxt.slack_mention_user_id,
    extra = ex,
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

revoke all on function public.client_profile_admin_edit(text, jsonb, timestamptz, text, text, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.client_profile_admin_edit(text, jsonb, timestamptz, text, text, text, integer, text)
  to service_role;

commit;
