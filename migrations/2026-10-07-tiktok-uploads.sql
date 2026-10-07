-- ============================================================
-- NOT APPLIED. Written 2026-10-07 by Courier for the owner to approve before it is applied.
--
-- The TikTok upload queue moves off the TikTokUpload tab of the SYNCVIEW Sheet into this table
-- (OPEN_REPAIRS 362). One row per post sent to Post For Me, with the same 15 fields as the Sheet tab:
--   id, client, profile, title, post_comment, options_json, scheduled_for, timezone, status,
--   upload_post_id, tiktok_url, error, posted_at, created_at, updated_at
-- plus what the n8n workflows never kept: the exact Post For Me request (post_body, so a failed post can be
-- retried without re-uploading), when Post For Me was last asked (last_checked_at), who sent it
-- (created_by) and where the row came from (source: 'syncview', or 'sheet' for the one-time copy).
--
-- The tiktok-upload and tiktok-upload-cancel Edge Functions read and write it with service_role only;
-- no browser role holds anything (the page reaches it through the functions with the staff key).
-- Supabase grants service_role, anon and authenticated full rights on every new object by default, so the
-- revoke names all four and service_role is then given back only what the functions need.
--
-- The switch: syncview_runtime_flags key 'tiktok_upload_source'. It starts at {"source":"n8n"}, so applying
-- this changes nothing on the page. The page uses the Edge Functions only once it reads {"source":"supabase"}.
--
-- Rollback once posts were made through the function:
--   update syncview_runtime_flags set value = '{"source":"n8n","read_table":true}' where key = 'tiktok_upload_source';
--   New uploads go back to the n8n webhooks and the Sheet, and the page keeps showing the table's rows (read,
--   status, retry and cancel through the functions), so nothing sent while the function was on disappears.
--   Plain {"source":"n8n"} hides the table's rows; use it only if the table has none. To remove entirely:
--           delete from syncview_runtime_flags where key = 'tiktok_upload_source'; drop table public.tiktok_uploads;
--           (queue rows only; posts already sent stay on TikTok)
-- ============================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.tiktok_uploads (
  id              text primary key check (id ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  client          text not null check (char_length(client) between 1 and 200),
  profile         text not null default '' check (char_length(profile) <= 200),
  title           text not null default '' check (char_length(title) <= 4000),
  post_comment    text not null default '' check (char_length(post_comment) <= 4000),
  options_json    jsonb not null default '{}'::jsonb check (jsonb_typeof(options_json) = 'object'),
  scheduled_for   timestamptz,
  timezone        text not null default '' check (char_length(timezone) <= 80),
  status          text not null check (status in ('queued', 'uploading', 'processing', 'scheduled', 'posted', 'failed', 'cancelled')),
  upload_post_id  text not null default '' check (char_length(upload_post_id) <= 200),
  tiktok_url      text not null default '' check (char_length(tiktok_url) <= 1000),
  error           text not null default '' check (char_length(error) <= 600),
  posted_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  post_body       jsonb check (post_body is null or jsonb_typeof(post_body) = 'object'),
  last_checked_at timestamptz,
  created_by      text not null default '' check (char_length(created_by) <= 120),
  source          text not null default 'syncview' check (source in ('syncview', 'sheet')),
  -- The queue panel's order, the same as the n8n list: the scheduled time, else when it was sent.
  sort_at         timestamptz generated always as (coalesce(scheduled_for, created_at)) stored
);
create index if not exists tiktok_uploads_sort_idx on public.tiktok_uploads (sort_at desc);
create index if not exists tiktok_uploads_post_idx on public.tiktok_uploads (upload_post_id) where upload_post_id <> '';
create index if not exists tiktok_uploads_open_idx on public.tiktok_uploads (status)
  where status in ('queued', 'uploading', 'processing', 'scheduled');

alter table public.tiktok_uploads enable row level security;

revoke all on table public.tiktok_uploads from public, anon, authenticated, service_role;
grant select, insert, update on table public.tiktok_uploads to service_role;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('tiktok_upload_source', '{"source":"n8n"}'::jsonb, 'tiktok-uploads-migration')
on conflict (key) do nothing;

-- Assert: no browser role holds anything, service_role holds exactly select, insert and update.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'tiktok_uploads'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'tiktok_uploads: a browser role still holds a privilege'; end if;

  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'tiktok_uploads' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'tiktok_uploads: service_role holds % (expected INSERT,SELECT,UPDATE)', sr;
  end if;

  if not exists (select 1 from public.syncview_runtime_flags where key = 'tiktok_upload_source') then
    raise exception 'tiktok_uploads: the tiktok_upload_source switch is missing';
  end if;
end
$assert$;

commit;
