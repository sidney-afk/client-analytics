-- Thumbnail media revision history.
--
-- A baseline row is created when a graphic/thumbnail component enters
-- "Tweaks Needed" for a single Google Drive image file. A scan then compares
-- Drive revision metadata and stores the after-snapshot when the file changes.
--
-- Folder links are intentionally not captured: they represent multi-image sets
-- (stories, batches) where there is no single image to compare.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'syncview-thumbnail-revisions',
  'syncview-thumbnail-revisions',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.thumbnail_media_revisions (
  id uuid primary key default gen_random_uuid(),
  surface text not null check (surface in ('calendar', 'samples')),
  client text not null,
  source_id text not null,
  component text not null default 'graphic',
  status text not null default 'pending' check (status in ('pending', 'changed', 'skipped', 'error')),
  reason text not null default 'graphic_tweaks_needed',
  thumbnail_url text not null,
  drive_file_id text,
  drive_file_name text,
  drive_mime_type text,
  baseline_revision_id text,
  baseline_md5 text,
  baseline_modified_time timestamptz,
  baseline_storage_path text,
  baseline_bytes integer,
  latest_revision_id text,
  latest_md5 text,
  latest_modified_time timestamptz,
  latest_storage_path text,
  latest_bytes integer,
  requested_at timestamptz not null default now(),
  requested_by text,
  request_role text,
  changed_at timestamptz,
  detected_at timestamptz,
  last_checked_at timestamptz,
  skip_reason text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists thumbnail_media_revisions_source_idx
  on public.thumbnail_media_revisions using btree (surface, client, source_id, requested_at desc);

create index if not exists thumbnail_media_revisions_pending_idx
  on public.thumbnail_media_revisions using btree (status, requested_at asc)
  where status = 'pending';

create unique index if not exists thumbnail_media_revisions_one_pending_idx
  on public.thumbnail_media_revisions using btree (surface, client, source_id, reason)
  where status = 'pending';

alter table public.thumbnail_media_revisions enable row level security;

drop policy if exists "anon read thumbnail_media_revisions" on public.thumbnail_media_revisions;
create policy "anon read thumbnail_media_revisions"
  on public.thumbnail_media_revisions
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.thumbnail_media_revisions to anon;
grant select on table public.thumbnail_media_revisions to authenticated;
grant select, insert, update, delete on table public.thumbnail_media_revisions to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thumbnail_media_revisions'
  ) then
    alter publication supabase_realtime add table public.thumbnail_media_revisions;
  end if;
end $$;
