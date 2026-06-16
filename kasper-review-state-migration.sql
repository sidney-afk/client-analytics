-- ============================================================
-- Calendar: add kasper_finished_at + kasper_closed_at columns
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent (safe to run more than once).
--
-- WHY: Kasper's "Finish reviewing" (hand-off) and "X-close" used to live ONLY
-- in his browser's localStorage. So when he hit Finish on his device the card
-- never moved to "Tweaks pending" for the SMM, and clearing/refreshing on
-- another device lost the state entirely. These two timestamp columns make both
-- GLOBAL + cross-device, exactly like the existing `kasper_approved_at`:
--   • kasper_finished_at — the moment Kasper handed the card to the SMM. The
--     card stays in "Tweaks pending" until the SMM addresses it OR a fresh ask
--     supersedes it (an actionable component back at Kasper Approval, or a reply
--     newer than this stamp). It doubles as his "seen up to here" marker.
--   • kasper_closed_at  — the moment Kasper X-closed a card (no decision, just
--     hide it). It re-surfaces when a new message lands after this stamp.
-- Both ride the upsert echo + Supabase realtime to every open browser, so a
-- refresh on ANY device shows the same state.
--
-- ROLLOUT ORDER (important):
--   1. Run THIS migration first (adds the columns).
--   2. Then add 'kasper_finished_at' and 'kasper_closed_at' to the ALLOWED
--      array in the n8n "calendar-upsert-post" workflow's "Build Row From
--      Patch" node.
--   Doing step 2 before step 1 would make the Supabase mirror upsert
--   (autoMapInputData) send an unknown column and error. The front end can ship
--   anytime: until these are in the allow-list the upsert just drops them, and
--   Kasper's review still works per-device via its localStorage fallback.
-- ============================================================

alter table public.calendar_posts
  add column if not exists kasper_finished_at text;

alter table public.calendar_posts
  add column if not exists kasper_closed_at text;
