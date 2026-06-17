-- ============================================================
-- Calendar: YouTube Title Review — add title_status + title_tweaks
--           + client_title_approved_at columns
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent (safe to run more than once).
--
-- WHY: The title review (see YOUTUBE_TITLE_REVIEW_DESIGN.md) makes the YouTube
-- title a reviewable element with its OWN status + comment thread + client
-- approval stamp — reusing the existing status vocabulary, but DELIBERATELY
-- excluded from computeOverallStatus, so it never affects the card's overall
-- status. These three columns mirror the existing caption_* fields exactly:
--   • title_status              — one of the existing statuses (In Progress …
--                                 Approved); NOT folded into the overall status.
--   • title_tweaks              — JSON comment/tweak thread (same shape as
--                                 caption_tweaks); appears in Notes as "Title".
--   • client_title_approved_at  — client sign-off timestamp (mirrors
--                                 client_caption_approved_at).
--
-- ROLLOUT ORDER (important):
--   1. Run THIS migration first (adds the columns).
--   2. Then add 'title_status', 'title_tweaks' and 'client_title_approved_at'
--      to the ALLOWED array in the n8n "calendar-upsert-post" workflow's
--      "Build Row From Patch" Code node.
--   Doing step 2 before step 1 would make the Supabase mirror upsert
--   (autoMapInputData) send an unknown column and error. The front end can ship
--   any time: until these are in the allow-list the upsert just drops them, and
--   the title-review toggle stays off by default, so nothing changes.
-- ============================================================

alter table public.calendar_posts
  add column if not exists title_status text;

alter table public.calendar_posts
  add column if not exists title_tweaks text;

alter table public.calendar_posts
  add column if not exists client_title_approved_at text;
