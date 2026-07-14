-- ============================================================
-- Calendar: add kasper_finished_at + kasper_closed_at columns
-- CURRENT STATUS: deployed historical idempotent definition, not a live rollout instruction.
--
-- WHY: Kasper's "Finish reviewing" (hand-off) and "X-close" used to live ONLY
-- in his browser's localStorage. So when he hit Finish on his device the card
-- never moved to "Tweaks pending" for the SMM, and clearing/refreshing on
-- another device lost the state entirely. These two timestamp columns make both
-- GLOBAL + cross-device, exactly like the existing `kasper_approved_at`:
--   • kasper_finished_at — the moment Kasper handed the card to the SMM. The
--     card stays in "Tweaks pending" until the SMM addresses it OR a fresh ask
--     supersedes it (an actionable component back at Kasper Approval). A generic
--     reply does not reopen Finished. It doubles as his "seen up to here" marker.
--   • kasper_closed_at  — the moment Kasper X-closed a card (no decision, just
--     hide it). It re-surfaces when a new message lands after this stamp.
-- Both ride the upsert echo + Supabase realtime to every open browser, so a
-- refresh on ANY device shows the same state.
--
-- HISTORICAL ROLLOUT ORDER (completed; do not execute from this file):
--   1. Run THIS migration first (adds the columns).
--   2. Then add 'kasper_finished_at' and 'kasper_closed_at' to the ALLOWED
--      array in the n8n "calendar-upsert-post" workflow's "Build Row From
--      Patch" node.
--   These steps are retained only to explain dependency order. Any current live
--   change follows the reviewed release and B4 fingerprint/readback process.
-- ============================================================

alter table public.calendar_posts
  add column if not exists kasper_finished_at text;

alter table public.calendar_posts
  add column if not exists kasper_closed_at text;
