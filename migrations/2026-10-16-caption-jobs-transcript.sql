-- ============================================================
-- NOT YET APPLIED. Written 2026-10-16 for "Redo with a note" on the Calendar caption. Lighthouse applies it with the
-- owner's go, BEFORE the caption-generate function is deployed (the function copes if it is not there yet: a redo then
-- transcribes the video again instead of reusing the words).
--
-- public.caption_jobs.transcript: the words of the post's video (or the transcript a person pasted) from the Generate
-- that wrote the caption. A later redo for the same post reads the newest one, so a note like "bring in another example
-- from the video" has the video to work from. It is written and read by the caption-generate function with service_role
-- only. caption_jobs is closed to every browser role already, and the caption-jobs function names its columns, so it is
-- never sent to a page. Rows are pruned with the rest of caption_jobs after 14 days; a redo after that transcribes the
-- video again.
--
-- No new table, so no new grant: the table's existing grants cover the column. They are restated here anyway, naming
-- all four roles (Supabase grants service_role, anon and authenticated full rights on new objects by default), and the
-- assert at the end measures them.
--
-- Rollback: alter table public.caption_jobs drop column if exists transcript;
-- ============================================================
begin;
set local lock_timeout = '5s';

alter table public.caption_jobs
  add column if not exists transcript text
  check (transcript is null or char_length(transcript) <= 40000);

revoke all on table public.caption_jobs from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.caption_jobs to service_role;

-- Assert: no browser role can read or write the new column, and service_role holds exactly what it did.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_jobs'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'caption_jobs: a browser role holds privileges'; end if;
  if has_column_privilege('anon', 'public.caption_jobs', 'transcript', 'select')
     or has_column_privilege('authenticated', 'public.caption_jobs', 'transcript', 'select') then
    raise exception 'caption_jobs.transcript: a browser role can read it';
  end if;

  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_jobs' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'DELETE,INSERT,SELECT,UPDATE' then
    raise exception 'caption_jobs: service_role holds % (expected DELETE,INSERT,SELECT,UPDATE)', sr;
  end if;
end
$assert$;

commit;
