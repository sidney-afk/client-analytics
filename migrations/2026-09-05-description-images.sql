-- Pasted description images: the storage decision behind
-- docs/ops/DESCRIPTION_IMAGE_UPLOAD.md, made 2026-09-05 (owner: "let's do it").
--
-- PUBLIC BUCKET, UNGUESSABLE PATH. A description is mirrored to Linear
-- verbatim, so what it stores has to be a plain https URL that Linear renders
-- as an image itself. A private bucket with signed URLs would put a dead
-- token into Linear as literal text and force the SyncView renderer async.
-- Public here means "anyone holding the exact URL can fetch it", which is the
-- property every Drive and Frame.io link in the same field already has. The
-- path is <uuid>.<ext> minted by the upload function, never a caller value,
-- so the URL cannot be enumerated or guessed. A public bucket does not list
-- its objects publicly; only a direct object GET is open.
--
-- The browser NEVER writes this bucket. Only description-image-upload holds
-- the service role, and it binds every object to one verified roster member
-- before the write. There are no storage policies on purpose: the service
-- role bypasses RLS, and every other role keeps the default of no access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'syncview-description-images',
  'syncview-description-images',
  true,
  4194304,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- One row per accepted upload. It is the audit trail (who put what where, for
-- which issue) and the per-actor rate limit's source of truth: the function
-- counts an actor's rows in the last hour before it writes another object.
-- A public bucket makes attribution matter more, not less.
create table if not exists public.description_images (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  public_url text not null,
  mime_type text not null,
  byte_length integer not null check (byte_length > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  actor_key text not null,
  actor_name text not null,
  actor_role text not null,
  client_slug text,
  deliverable_id text,
  created_at timestamptz not null default now()
);

create index if not exists description_images_actor_created_idx
  on public.description_images (actor_key, created_at desc);

-- Service-role only. The browser reads the image through its public URL and
-- the description text, never through this table.
revoke all on table public.description_images from anon;
revoke all on table public.description_images from authenticated;

-- The server-side kill switch (Codex on #1310). description-image-upload
-- reads this row before it authenticates anyone and FAILS CLOSED on a
-- missing, unreadable or malformed value, so a revert of Pages is never the
-- only containment: cached tabs and direct callers hit this first.
-- Inserted ENABLED because the owner ratified the feature on 2026-09-05.
-- To switch uploads off in one statement (see ROLLBACK.md):
--   update public.syncview_runtime_flags
--     set value = '{"enabled": false}'::jsonb, updated_by = 'owner-kill'
--     where key = 'description_image_upload_enabled';
insert into public.syncview_runtime_flags (key, value, updated_by)
values ('description_image_upload_enabled', '{"enabled": true}'::jsonb, 'migration-description-images')
on conflict (key) do nothing;
