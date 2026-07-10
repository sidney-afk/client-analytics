-- Persist URGENT video tweak pings for the current Tweaks Needed lifecycle.
-- `video_urgent_status_at` stores the row's video_status_at at send time.
-- When a video leaves Tweaks Needed and later re-enters it, video_status_at
-- changes, so the old marker no longer makes the button render as Sent.

alter table public.calendar_posts
  add column if not exists video_urgent_pinged_at timestamptz,
  add column if not exists video_urgent_status_at timestamptz,
  add column if not exists video_urgent_issue text,
  add column if not exists video_urgent_editor text;

alter table public.sample_reviews
  add column if not exists video_urgent_pinged_at timestamptz,
  add column if not exists video_urgent_status_at timestamptz,
  add column if not exists video_urgent_issue text,
  add column if not exists video_urgent_editor text;
