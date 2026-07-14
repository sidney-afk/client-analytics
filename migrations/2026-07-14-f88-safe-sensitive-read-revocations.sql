-- F88 safe subset: close anonymous reads only where the browser now uses a
-- staff-gated/service-role Edge Function (or a narrower protected projection).
--
-- This migration is intentionally narrow. It does NOT change browser reads for
-- syncview_runtime_flags, calendar_posts, content_samples, templates,
-- caption_prompts, workload_issues, team_members, or clients. `clients` remains
-- a direct Production-tab PostgREST dependency and needs a scoped projection
-- before its raw grant can be removed.
--
-- Each guarded dynamic REVOKE is safe to run repeatedly and also tolerates an
-- environment where one of the later feature tables has not been created yet.

do $$
begin
  if to_regclass('public.thumbnail_media_revisions') is not null then
    execute 'revoke select on table public.thumbnail_media_revisions from anon';
  end if;

  if to_regclass('public.social_media_managers') is not null then
    execute 'revoke select on table public.social_media_managers from anon';
  end if;

  if to_regclass('public.smm_weekly_reports') is not null then
    execute 'revoke select on table public.smm_weekly_reports from anon';
  end if;

  if to_regclass('public.filming_plans') is not null then
    execute 'revoke select on table public.filming_plans from anon';
  end if;
end
$$;
