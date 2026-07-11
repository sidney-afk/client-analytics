-- ============================================================
-- Calendar: add thumb_rev column (thumbnail cache-bust signal)
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent (safe to run more than once).
--
-- WHY: changing a post's thumbnail link — or replacing the file behind an
-- UNCHANGED Google Drive link — needs to refresh the picture LIVE for every
-- viewer (the SMM, the client, Kasper), not just after a hard refresh. The
-- front end stamps a new `thumb_rev` token whenever a thumbnail/asset link is
-- written; that token rides this column through the upsert echo + Supabase
-- realtime to every open browser, which appends it to the image URL (`_r=…`)
-- so the cached thumbnail is busted and reloaded automatically. It changes
-- ONLY on a link write, so unrelated saves never reload (and never flicker).
--
-- ROLLOUT ORDER (important):
--   1. Run THIS migration first (adds the column).
--   2. Then add 'thumb_rev' to the ALLOWED array in the n8n
--      "calendar-upsert-post" workflow's "Build Row From Patch" node.
--   Doing step 2 before step 1 would make the Supabase mirror upsert
--   (autoMapInputData) send an unknown column and error. The front end can
--   ship anytime: until 'thumb_rev' is in the allow-list the upsert just drops
--   it, and the editor still updates locally via its in-session fallback.
-- ============================================================

alter table public.calendar_posts
  add column if not exists thumb_rev text;
