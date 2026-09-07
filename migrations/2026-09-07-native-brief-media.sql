-- DORMANT. Separate native-brief-media-v1 recovery extension; not selected37/v8.
-- No copy or admission is enabled by installing this file. Never use public or
-- thumbnail storage. Preserve occurrence history when source rows are deleted.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('syncview-native-brief-media','syncview-native-brief-media',false,52428800,
  array['image/png','image/jpeg','image/webp','image/gif','application/octet-stream']) on conflict (id) do nothing;
do $$ begin
  if not exists(select 1 from storage.buckets where id='syncview-native-brief-media' and public=false
    and file_size_limit=52428800 and allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif','application/octet-stream'])
  then raise exception 'native brief media bucket contract mismatch'; end if;
end $$;
create table public.native_brief_media_occurrences (
  id uuid primary key,
  deliverable_id text not null,
  source_kind text not null check(source_kind='native_brief'),
  source_entity_id text not null,
  client_slug text not null,
  team text not null,
  source_updated_at timestamptz not null,
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  source_offset integer not null check(source_offset >= 0),
  source_length integer not null check(source_length > 0),
  original_url_sha256 text not null check(original_url_sha256 ~ '^[a-f0-9]{64}$'),
  audience text not null check(audience='staff'),
  state text not null check(state in ('pending','verified','held')),
  content_sha256 text check(content_sha256 ~ '^[a-f0-9]{64}$'),
  readback_sha256 text,
  storage_path text,
  byte_length bigint,
  mime_type text,
  verified_at timestamptz,
  source_receipt_sha256 text not null check(source_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check(state <> 'verified' or (content_sha256 is not null and readback_sha256 is not null
    and storage_path is not null and byte_length is not null and mime_type is not null and readback_sha256=content_sha256
    and storage_path=content_sha256||'/'||id::text and byte_length between 1 and 52428800
    and mime_type in ('image/png','image/jpeg','image/webp','image/gif','application/pdf','image/svg+xml','video/mp4','video/quicktime') and verified_at is not null))
);
create unique index native_brief_media_verified_occurrence on public.native_brief_media_occurrences
  (source_kind,source_entity_id,deliverable_id,client_slug,team,source_sha256,source_offset) where state='verified';
alter table public.native_brief_media_occurrences enable row level security;
revoke all on public.native_brief_media_occurrences from public,anon,authenticated,service_role;
grant select,insert on public.native_brief_media_occurrences to service_role;
-- Pending/held attempts remain as evidence; a new immutable verified attempt may
-- follow a successful readback. No operator update/delete shortcut.
insert into public.syncview_runtime_flags(key,value,updated_by)
values('native_brief_media','{"mode":"off","contract":"native_brief_media_v1"}'::jsonb,'native-brief-media-preparation')
on conflict(key) do nothing;
commit;
