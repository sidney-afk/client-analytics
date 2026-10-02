-- SOURCE ONLY. One transaction restores measured reads and the old transport.
-- Write revocations remain in force. No policies or standing read exceptions change.
begin;
revoke SELECT on table public.calendar_posts, public.sample_reviews
  from PUBLIC, anon, authenticated, service_role;
grant SELECT on table public.calendar_posts, public.sample_reviews to anon, authenticated, service_role;
update public.syncview_runtime_flags set value='{"mode":"public"}'::jsonb where key='card_reads_source';
commit;
