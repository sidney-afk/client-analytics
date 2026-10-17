-- ef-auto-deploy-applied-when: select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hf_studio_downloads' and column_name = 'toolkit') and exists (select 1 from storage.buckets where id = 'brain-snapshots' and public = false)
--
-- Toolkit downloads and brain snapshots (item 1, PR 2; session Toolkit,
-- 2026-10-17). Used by two Edge Functions:
--   higgsfield-mcp   "toolkit_latest" logs every download in
--                    hf_studio_downloads with the toolkit's name. A studio row
--                    leaves the column out and gets the default 'studio', so
--                    "studio_latest" writes exactly the row it wrote before.
--   pipeline-google  "brain.snapshot" keeps one zip of the Synchro Brain per
--                    commit in the private bucket brain-snapshots
--                    (<commit>.zip) and hands out a 10-minute signed link.
--
-- Access. The new column is covered by the table's existing grants
-- (service_role SELECT and INSERT; no browser role holds anything), and the
-- assert at the end checks that is still so. No table or function is created,
-- so no new default grant needs revoking. The bucket is private (public =
-- false) and no storage policy is added, so anon and authenticated cannot read,
-- list or write it; only the service role (which bypasses storage policies)
-- does, from pipeline-google. The assert checks that no policy on
-- storage.objects names the bucket.
--
-- Rollback:
--   delete from storage.objects where bucket_id = 'brain-snapshots';
--   delete from storage.buckets where id = 'brain-snapshots';
--   alter table public.hf_studio_downloads drop column if exists toolkit;
-- Written by session Toolkit 2026-10-17; applied by Lighthouse.
begin;

alter table public.hf_studio_downloads
  add column if not exists toolkit text not null default 'studio'
  check (toolkit ~ '^[a-z0-9][a-z0-9-]{0,39}$');

comment on column public.hf_studio_downloads.toolkit is
  'Which toolkit was asked for (studio, filming-plan). Studio rows leave it out and get the default.';

-- About 10 MB per commit measured on 2026-10-17; 200 MB leaves room to grow.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brain-snapshots', 'brain-snapshots', false, 209715200, array['application/zip'])
on conflict (id) do nothing;

do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_studio_downloads'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'hf_studio_downloads: a browser role holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_studio_downloads' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT' then
    raise exception 'hf_studio_downloads: service_role holds % (expected INSERT,SELECT)', sr;
  end if;
  select count(*) into n
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'hf_studio_downloads'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception 'hf_studio_downloads: a browser role holds a column privilege'; end if;

  if not exists (select 1 from storage.buckets where id = 'brain-snapshots' and public = false) then
    raise exception 'brain-snapshots: the bucket is missing or public';
  end if;
  select count(*) into n from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual, '') like '%brain-snapshots%' or coalesce(with_check, '') like '%brain-snapshots%');
  if n <> 0 then raise exception 'brain-snapshots: a storage policy names the bucket'; end if;
end
$assert$;

commit;
