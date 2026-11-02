-- ef-auto-deploy: functions-cope-without-this
-- ef-auto-deploy-applied-when: select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'studio_trial_versions' and column_name in ('thumbnail_url', 'caption', 'change_part')
--
-- Trial versions get their own thumbnail and caption (plan docs/plans/2026-11-trial-and-posting/combined.md,
-- row F2; Sidney's decision D1 drops client_ok_by). Session Vbuild, 2026-11-02.
--
-- Three nullable columns on studio_trial_versions:
--   thumbnail_url  this version's thumbnail; null = the card's (https only, at most 2048)
--   caption        this version's caption; null = the card's (1 to 4000 characters)
--   change_part    which part a change was asked on: video, thumbnail or caption; null = video (today's meaning)
-- Existing rows do not move: null in all three is exactly what every row means today (same as the card, change on
-- the video). Version A is the card itself; only B, C... use these columns.
--
-- Why the functions cope without it: trial-reels reads these rows with select * and will name a new column only in
-- the actions that set it, which refuse until this is applied (the client_pass_at pattern,
-- 20261028150000_trial_reels_client_pass.sql). Nothing today reads or writes them.
--
-- Access: unchanged. A new column takes the table's privileges; the table stays service-role only
-- (SELECT, INSERT, UPDATE; 20261026200000_studio_trial_versions.sql). The block at the end reads back what anon,
-- authenticated, public and service_role hold, at table and column level, and stops if anything changed.
--
-- How to tell it is applied: the applied-when line above answers true.
--
-- Rollback: alter table public.studio_trial_versions drop column if exists thumbnail_url,
--   drop column if exists caption, drop column if exists change_part;
-- Anything written into them while live is lost; the card itself is never affected.
begin;

do $first$
begin
  if to_regclass('public.studio_trial_versions') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'studio_trial_versions' and column_name = 'client_pass_at') then
    raise exception 'Apply supabase/migrations/20261028150000_trial_reels_client_pass.sql first: public.studio_trial_versions is missing or older.';
  end if;
end
$first$;

alter table public.studio_trial_versions
  add column if not exists thumbnail_url text check (thumbnail_url is null or (thumbnail_url ~ '^https://' and length(thumbnail_url) <= 2048)),
  add column if not exists caption text check (caption is null or length(caption) between 1 and 4000),
  add column if not exists change_part text check (change_part is null or change_part in ('video', 'thumbnail', 'caption'));

comment on column public.studio_trial_versions.thumbnail_url is
  'This version''s own thumbnail (trial-reels). Null = the card''s thumbnail.';
comment on column public.studio_trial_versions.caption is
  'This version''s own caption (trial-reels). Null = the card''s caption.';
comment on column public.studio_trial_versions.change_part is
  'Which part a change was asked on: video, thumbnail or caption. Null = video.';

-- Read back what each role holds, so "unchanged" is measured, not assumed.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'studio_trial_versions'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'studio_trial_versions: a browser role (anon, authenticated or public) holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'studio_trial_versions' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'studio_trial_versions: service_role holds % (expected INSERT,SELECT,UPDATE)', sr;
  end if;
  select count(*) into n from pg_attribute
  where attrelid = 'public.studio_trial_versions'::regclass and attacl is not null;
  if n <> 0 then raise exception 'studio_trial_versions: % column(s) carry their own privileges', n; end if;
end
$assert$;

commit;
