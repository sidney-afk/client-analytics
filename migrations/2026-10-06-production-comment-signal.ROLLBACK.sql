-- ============================================================
-- NOT APPLIED -- rollback for migrations/2026-10-06-production-comment-signal.sql.
-- Removes both triggers, both functions and the comments_changed_at column.
-- The page needs no change to roll back: with the column gone, realtime
-- payloads simply stop carrying it and open screens fall back to the slow
-- poll for comments, exactly as before. No comment and no work item status,
-- title or updated_at is touched.
-- ============================================================
begin;
set local lock_timeout = '5s';

drop trigger if exists zzz_production_comment_signal on public.production_comments;
drop trigger if exists zzzz_comment_signal_hold_clock on public.deliverables;
drop function if exists public.production_comment_signal_stamp();
drop function if exists public.production_comment_signal_hold_clock();
alter table public.deliverables drop column if exists comments_changed_at;

commit;
