-- ============================================================
-- URGENT ping for a card sitting at Kasper Approval.
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
-- Idempotent (safe to run more than once).
--
-- WHY: the existing URGENT ping covers ONE case — a video at Tweaks Needed,
-- pinging the editor in #video-editing (see 2026-07-10-urgent-tweak-pings.sql).
-- A card stuck waiting on Kasper had no equivalent: the SMM could only chase him
-- by hand. This adds the second ping (DM to Kasper) and, with it, the marker
-- Kasper's review tab groups its new "Urgent" section by.
--
-- SHAPE: deliberately the same four-column shape as the video ping, one marker
-- per card rather than per component, because the ping is about the CARD ("this
-- one needs you now") and Kasper's review card covers every component at once.
--   kasper_urgent_pinged_at  — when the ping was sent
--   kasper_urgent_comp       — which component pill it was fired from
--   kasper_urgent_status_at  — that component's *_status_at at send time, so the
--                              marker dies with its round exactly like the video
--                              one (leave Kasper Approval and come back later and
--                              the card is not still wearing the old ping)
--   kasper_urgent_by         — who sent it, for the ledger
-- ============================================================

alter table public.calendar_posts
  add column if not exists kasper_urgent_pinged_at timestamptz,
  add column if not exists kasper_urgent_status_at timestamptz,
  add column if not exists kasper_urgent_comp      text,
  add column if not exists kasper_urgent_by        text;

alter table public.sample_reviews
  add column if not exists kasper_urgent_pinged_at timestamptz,
  add column if not exists kasper_urgent_status_at timestamptz,
  add column if not exists kasper_urgent_comp      text,
  add column if not exists kasper_urgent_by        text;

-- ---- caption/title change-stamps -------------------------------------------
-- The round key above needs a *_status_at for the component the ping was fired
-- from. calendar_posts only stamped video and graphic (the video ping never
-- needed the other two); a card can sit at Kasper Approval on its caption or
-- title, so those two get the same server-side stamp. Same trigger, two more
-- columns — no new write path, and nothing in calendar-upsert's allow-list
-- changes for them (the trigger stamps them, the browser never sends them).
--
-- Existing rows stay null on purpose, exactly like the 2026-06 migration: a
-- null simply means "never changed since the stamp existed", and the front-end
-- treats an unstamped component as still-in-round rather than inventing a
-- change-time for it. sample_reviews needs nothing here — samples only carry
-- video and graphic, both already stamped.

alter table public.calendar_posts
  add column if not exists caption_status_at timestamptz;

alter table public.calendar_posts
  add column if not exists title_status_at timestamptz;

create or replace function public.calendar_posts_stamp_status_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.video_status_at   := coalesce(new.video_status_at,   now());
    new.graphic_status_at := coalesce(new.graphic_status_at, now());
    new.caption_status_at := coalesce(new.caption_status_at, now());
    new.title_status_at   := coalesce(new.title_status_at,   now());
  else
    if new.video_status   is distinct from old.video_status   then
      new.video_status_at := now();
    end if;
    if new.graphic_status is distinct from old.graphic_status then
      new.graphic_status_at := now();
    end if;
    if new.caption_status is distinct from old.caption_status then
      new.caption_status_at := now();
    end if;
    if new.title_status   is distinct from old.title_status   then
      new.title_status_at := now();
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

-- VERIFY: change a card's caption status and save — that row's caption_status_at
-- now holds the current time, and video_status_at is untouched.
-- ROLLBACK: re-run 2026-06-XX calendar-status-at-migration.sql to restore the
-- two-column trigger; the four marker columns can be left in place (unused).

-- ============================================================
-- KILL-SWITCH ROW — run this ONLY after the four kasper_urgent_* fields are
-- live in the un-gated calendar-upsert / sample-review-upsert (see the ⛔ FROZEN
-- banner in those files, and OPEN_REPAIRS item 187).
--
-- The browser fails closed without it: no flag row means no URGENT button on a
-- Kasper Approval pill, which means no click, no write and no DM. Running the
-- schema above WITHOUT this row is the correct intermediate state.
-- ============================================================
-- The value is a ROSTER, so a rollout starts with one client rather than the
-- whole book. Substitute the slug; do not commit a real one to this repo.
-- insert into public.syncview_runtime_flags (key, value)
-- values ('kasper_urgent_ping_enabled', '{"clients": ["<slug>"]}'::jsonb)
-- on conflict (key) do update set value = excluded.value;
--
-- '{"enabled": true}' opens it for every client instead. Keep that for after
-- the roster has proven itself.
--
-- To turn it back off (instant, no deploy) -- either value is OFF:
-- update public.syncview_runtime_flags
--    set value = '{"enabled": false}'::jsonb
--  where key = 'kasper_urgent_ping_enabled';
