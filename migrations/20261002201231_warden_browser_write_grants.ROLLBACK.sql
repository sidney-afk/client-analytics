-- SOURCE ONLY. Exact measured write grants, no PUBLIC grants.
begin;
revoke INSERT, UPDATE, TRUNCATE on table
  public.calendar_post_events,
  public.caption_prompts,
  public.clients,
  public.flag_flips,
  public.sample_review_events,
  public.syncview_runtime_flags,
  public.team_members,
  public.templates,
  public.thumbnail_media_revisions,
  public.workload_issues
  from PUBLIC, anon, authenticated, service_role;
grant INSERT, UPDATE, TRUNCATE on table
  public.calendar_post_events,
  public.caption_prompts,
  public.clients,
  public.flag_flips,
  public.sample_review_events,
  public.syncview_runtime_flags,
  public.team_members,
  public.templates,
  public.thumbnail_media_revisions,
  public.workload_issues
  to anon, authenticated, service_role;
commit;
