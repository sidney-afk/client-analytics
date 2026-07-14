-- ============================================================
-- Calendar: add thumb_rev column (thumbnail cache-bust signal)
-- CURRENT STATUS: deployed historical idempotent definition, not a live rollout instruction.
--
-- WHY: changing a post's thumbnail link — or replacing the file behind an
-- UNCHANGED Google Drive link — needs to refresh the picture LIVE for every
-- viewer (the SMM, the client, Kasper), not just after a hard refresh. The
-- front end stamps a new `thumb_rev` token whenever a thumbnail/asset link is
-- written; that token rides this column through the upsert echo + Supabase
-- realtime to every open browser, which appends it to the image URL (`_r=…`)
-- so the cached thumbnail is busted and reloaded automatically. It changes on
-- a link write and when Graphics leaves Tweaks Needed; unrelated saves do not reload.
--
-- HISTORICAL ROLLOUT ORDER (completed; do not execute from this file):
--   1. Run THIS migration first (adds the column).
--   2. Then add 'thumb_rev' to the ALLOWED array in the n8n
--      "calendar-upsert-post" workflow's "Build Row From Patch" node.
--   These steps are retained only to explain dependency order. Any current live
--   change follows the reviewed release and B4 fingerprint/readback process.
-- ============================================================

alter table public.calendar_posts
  add column if not exists thumb_rev text;
