-- ============================================================
-- Calendar: add video_status_at + graphic_status_at (exact change-timestamps)
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent (safe to run more than once).
--
-- WHY: the Linear ⇄ SyncView reconciler decides direction by "which side changed
-- more recently". Until now the CARD side was timed to *polling granularity* — the
-- moment the reconciler happened to notice a change, not when it actually changed.
-- On the throttled GitHub schedule that drifted by hours and, on 2026-06-19, made a
-- stale card look "newer" than Linear and pushed a stale "Tweaks Needed" onto a
-- finished issue (GRA-6339 — see LINEAR_DRIFT_INCIDENT_2026-06-19.md). These two
-- columns record the EXACT moment a sub-status last changed, so "most recent wins"
-- runs on truth, not on when the job looked.
--
-- DESIGN: a BEFORE INSERT/UPDATE trigger stamps the column whenever the matching
-- sub-status actually changes. That captures EVERY write path (front-end save,
-- Linear→card sync, the reconciler's own pulls) server-side — so unlike the
-- kasper_finished_at / thumb_rev columns, this needs NO change to the
-- calendar-upsert-post allow-list and NO workflow edits. The reconciler reads the
-- columns when present and falls back to its old poll-timing when they are null, so
-- it is safe to deploy in either order. Existing rows are left null on purpose
-- (no backfill) — they simply use the poll-timing fallback until their next change
-- stamps them, which avoids guessing a fake change-time for historical cards.
--
-- VERIFY after running: open a card, change a video/thumbnail status, save — saving
-- still works, and that row's video_status_at / graphic_status_at now holds the
-- current time. (To roll back: drop trigger trg_calendar_posts_stamp_status_at on
-- public.calendar_posts; drop function public.calendar_posts_stamp_status_at;)
-- ============================================================

alter table public.calendar_posts
  add column if not exists video_status_at   timestamptz;

alter table public.calendar_posts
  add column if not exists graphic_status_at timestamptz;

create or replace function public.calendar_posts_stamp_status_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.video_status_at   := coalesce(new.video_status_at,   now());
    new.graphic_status_at := coalesce(new.graphic_status_at, now());
  else
    if new.video_status   is distinct from old.video_status   then
      new.video_status_at := now();
    end if;
    if new.graphic_status is distinct from old.graphic_status then
      new.graphic_status_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_calendar_posts_stamp_status_at on public.calendar_posts;

create trigger trg_calendar_posts_stamp_status_at
  before insert or update on public.calendar_posts
  for each row
  execute function public.calendar_posts_stamp_status_at();
