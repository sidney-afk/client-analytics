-- ef-auto-deploy: functions-cope-without-this
-- ============================================================
-- 2026-10-31 -- The client's Post For Me accounts, edited on the Kasper Clients tab:
--   the Facebook Page (new, for cross-posting) and the Instagram account beside it.
-- Written by session Fbpost, 2026-10-31 (UTC). OPEN_REPAIRS 620.
--
-- WHAT IT CHANGES (no new table or column):
--   client_profile_admin_edit()  redefined from 2026-10-23-client-slack-mention.sql
--       with ONE change: the keys postforme_facebook_account_id and
--       postforme_instagram_account_id may be in p_changes. They are kept in
--       client_profiles.extra (not columns), must be a Post For Me connection id
--       (spc_...) or blank (blank removes the key), and each gets one history
--       row named "extra.<key>". Everything else is unchanged: same arguments,
--       column allowlist, checks, history and Sheet copy queue (the queued copy
--       carries the Instagram id to its Clients Info column, as roster-write's
--       does; the Facebook Page is not a Sheet column). client-profile-write
--       checks with Post For Me that each account is on the right network
--       before it calls this.
--
-- WHY THE FUNCTIONS COPE WITHOUT IT (the marker on line 1):
--   Until this is applied, saving either account on the Kasper Clients tab
--   answers field_not_editable and nothing is written (the page says the
--   database update is not applied yet). Every other field saves as before,
--   and roster-write still sets the Instagram id as today.
--   instagram-upload reads extra.postforme_facebook_account_id directly; with
--   no Page on file the composer offers no Facebook cross-post, exactly as
--   today.
--
-- HOW TO TELL IT IS APPLIED (expect true):
--   select position('postforme_facebook_account_id' in pg_get_functiondef(
--     'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)'::regprocedure)) > 0 as applied;
--
-- The function's grants are restated below, all four roles named.
--
-- ROLLBACK: re-run the client_profile_admin_edit block of
--   2026-10-23-client-slack-mention.sql (values already saved stay in extra,
--   harmless; remove them with
--   update public.client_profiles set extra = extra - 'postforme_facebook_account_id';
--   the Instagram ids stay, as roster-write would have set them).
-- ============================================================
begin;
set local lock_timeout = '5s';

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
