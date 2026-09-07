-- DORMANT additive comment custody; install after native-brief-media.sql.
-- Requires separately approved global Storage ceiling >=104857600 before upload.
-- This proposal never changes global configuration, enables readers or admits files.
begin;
alter table public.native_brief_media_occurrences
  drop constraint native_brief_media_occurrences_source_kind_check,
  drop constraint native_brief_media_occurrences_check,
  add column source_audience text,
  add column source_version bigint;
alter table public.native_brief_media_occurrences
  add constraint native_media_source_check check (
    (source_kind='native_brief' and source_entity_id=deliverable_id and source_audience is null and source_version is null)
    or (source_kind='native_comment' and source_entity_id<>'' and source_audience in ('internal','client')
      and source_audience is not null and source_version is not null and source_version>=1)),
  add constraint native_media_verified_check check(state <> 'verified' or (
    content_sha256 is not null and readback_sha256 is not null and storage_path is not null
    and byte_length is not null and mime_type is not null and readback_sha256=content_sha256
    and storage_path=content_sha256||'/'||id::text and byte_length>0
    and byte_length <= case when source_kind='native_comment' and mime_type in ('video/mp4','video/quicktime') then 104857600 else 52428800 end
    and (mime_type in ('image/png','image/jpeg','image/webp','image/gif','application/pdf','image/svg+xml','video/mp4','video/quicktime')
      or (source_kind='native_comment' and mime_type='font/otf')) and verified_at is not null));
-- Audience participates in occurrence identity; changing it cannot reuse custody.
drop index public.native_brief_media_verified_occurrence;
create unique index native_brief_media_verified_occurrence on public.native_brief_media_occurrences
 (source_kind,source_entity_id,deliverable_id,client_slug,team,source_sha256,source_offset,coalesce(source_audience,'')) where state='verified';
do $$ begin
  if not exists(select 1 from storage.buckets where id='syncview-native-brief-media' and public=false
    and file_size_limit=52428800 and allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif','application/octet-stream'])
  then raise exception 'native comment media bucket prerequisite mismatch'; end if;
end $$;
update storage.buckets set file_size_limit=104857600 where id='syncview-native-brief-media';
insert into public.syncview_runtime_flags(key,value,updated_by)
values('native_comment_media','{"mode":"off","contract":"native_comment_media_v1"}'::jsonb,'native-comment-media-preparation')
on conflict(key) do nothing;
commit;
