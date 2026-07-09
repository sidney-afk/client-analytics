-- Store the Google Drive parent folder resolved from a thumbnail file link.
-- The browser renders from these columns and only asks the Edge Function to
-- refresh them when the thumbnail_url changes.

alter table public.calendar_posts
  add column if not exists thumbnail_folder_url text,
  add column if not exists thumbnail_folder_id text,
  add column if not exists thumbnail_file_id text,
  add column if not exists thumbnail_folder_resolved_at text;

alter table public.sample_reviews
  add column if not exists thumbnail_folder_url text,
  add column if not exists thumbnail_folder_id text,
  add column if not exists thumbnail_file_id text,
  add column if not exists thumbnail_folder_resolved_at text;
