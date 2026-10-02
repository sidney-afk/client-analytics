-- SOURCE ONLY. Never applied by this PR. Counts remeasured 2026-10-02.
-- Each target: anon/authenticated/service_role held INSERT, UPDATE, TRUNCATE;
-- PUBLIC held none; zero browser write policies. Other privileges stay intact.
begin;
do $guard$ declare t text; p text; begin
  if exists (select 1 from pg_policy where polrelid = any(array['public.calendar_post_events'::regclass,'public.caption_prompts'::regclass,'public.clients'::regclass,'public.flag_flips'::regclass,'public.sample_review_events'::regclass,'public.syncview_runtime_flags'::regclass,'public.team_members'::regclass,'public.templates'::regclass,'public.thumbnail_media_revisions'::regclass,'public.workload_issues'::regclass])
    and polcmd <> 'r' and (0=any(polroles) or 'anon'::regrole::oid=any(polroles) or 'authenticated'::regrole::oid=any(polroles))) then
    raise exception 'browser_write_policy_drift';
  end if;
  foreach t in array array['calendar_post_events','caption_prompts','clients','flag_flips','sample_review_events','syncview_runtime_flags','team_members','templates','thumbnail_media_revisions','workload_issues'] loop
    foreach p in array array['INSERT','UPDATE','TRUNCATE'] loop
      if not has_table_privilege('service_role','public.'||t,p) then raise exception 'service_write_grant_drift'; end if;
    end loop;
    if exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) x
      where a.attrelid=('public.'||t)::regclass and x.privilege_type in ('INSERT','UPDATE')
      and x.grantee in (0,'anon'::regrole::oid,'authenticated'::regrole::oid)) then raise exception 'browser_column_write_grant_drift'; end if;
  end loop;
end $guard$;
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
-- Only restore the three service privileges actually measured, not ALL.
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
  to service_role;
do $readback$ declare t text; p text; begin
  foreach t in array array['calendar_post_events','caption_prompts','clients','flag_flips','sample_review_events','syncview_runtime_flags','team_members','templates','thumbnail_media_revisions','workload_issues'] loop
    foreach p in array array['INSERT','UPDATE','TRUNCATE'] loop
      if has_table_privilege('anon','public.'||t,p) or has_table_privilege('authenticated','public.'||t,p)
        or not has_table_privilege('service_role','public.'||t,p) then raise exception 'write_grants_readback_failed'; end if;
    end loop;
  end loop;
end $readback$;
commit;
