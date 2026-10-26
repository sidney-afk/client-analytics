-- ef-auto-deploy: functions-cope-without-this
-- ============================================================
-- 2026-10-23 -- "Notify client" tags the client: the Slack person to at-mention.
-- Written by session Tagline, 2026-10-23 (UTC).
--
-- WHAT IT ADDS (additive):
--   client_profiles.slack_mention_user_id  ONE Slack member id (U... or W...)
--       of the client's contact. client-review-alert starts the "ready for
--       your review" message with <@that id> so Slack notifies them. Staff set
--       it on the Kasper > Clients tab ("Slack person to tag"). Null = not
--       linked: the alert posts exactly as before, untagged.
--   client_profile_admin_edit()  redefined from 2026-10-02-roster-native.sql
--       with ONE change: slack_mention_user_id is editable (the allowlist and
--       the update both name it). Same arguments, checks, history and Sheet
--       copy queue. The read-only Sheet copy does not carry the new field.
--
-- WHY THE FUNCTIONS COPE WITHOUT IT (the marker on line 1):
--   client-review-alert reads the column in its own query; if the column is
--   missing it sends the untagged message and the confirm box says tagging is
--   not available yet. analytics-read and client-profile-write select the
--   column only once a probe finds it. Until this is applied, saving the new
--   field answers field_not_editable and nothing is written.
--
-- HOW TO TELL IT IS APPLIED (expect true, true):
--   select exists (select 1 from information_schema.columns where table_schema = 'public'
--            and table_name = 'client_profiles' and column_name = 'slack_mention_user_id') as column_there,
--          position('slack_mention_user_id' in pg_get_functiondef(
--            'public.client_profile_admin_edit(text,jsonb,timestamptz,text,text,text,integer,text)'::regprocedure)) > 0 as editable;
--
-- No grant changes on the table: client_profiles already grants the browser
-- nothing (the Clients tab reads it through analytics-read, admin key only).
-- The function's grants are restated below, all four roles named.
--
-- ROLLBACK:
--   begin;
--   -- re-run the client_profile_admin_edit block of 2026-10-02-roster-native.sql
--   alter table public.client_profiles drop column if exists slack_mention_user_id;
--   commit;
-- ============================================================
begin;

alter table public.client_profiles add column if not exists slack_mention_user_id text;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_profiles_slack_mention_user_id_shape'
                 and conrelid = 'public.client_profiles'::regclass) then
    alter table public.client_profiles add constraint client_profiles_slack_mention_user_id_shape
      check (slack_mention_user_id is null or slack_mention_user_id ~ '^[UW][A-Z0-9]{8,}$');
  end if;
end
$chk$;

comment on column public.client_profiles.slack_mention_user_id is
  'Slack member id (U... or W...) of the client contact that "Notify client" at-mentions. Null = not linked, the alert posts untagged.';

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
    slack_mention_user_id = nxt.slack_mention_user_id,
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
