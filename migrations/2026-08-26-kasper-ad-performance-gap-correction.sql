-- Corrects two real gaps in the Kasper Ad Performance tables, both caused by
-- the same root cause: the "Kasper Ad Performance — Daily Pull" n8n workflow
-- (6OtjILbhkYLY6yVE) stopped running successfully after 2026-08-25 15:42 UTC
-- because its Facebook Graph API credential started returning
-- "API access blocked" (OAuthException code 200) on every scheduled run
-- since (executions 433765, 436025 both errored on the `Pull Meta Insights`
-- node). See EXECUTION_LOG.md for the full write-up.
--
-- Gap 1 (pre-existing, known): kasper_ad_performance_by_ad_daily is missing
-- Fast Pitch/Danny Training/Baya Training for 2026-08-14, and all of
-- 2026-08-15 -- an earlier partial-branch failure, unrelated to the
-- credential block. kasper_ad_performance_daily (campaign-level) was already
-- correct for both days.
--
-- Gap 2 (new, from the credential block): 2026-08-25 in both tables only
-- captured a partial day (the last successful run was mid-morning MT), and
-- 2026-08-26 has no rows at all yet.
--
-- All values below are pulled directly from Meta's Graph API
-- (graph.facebook.com/v21.0/<id>/insights) via a live, working credential
-- (not the blocked n8n one), matched day-for-day and ad-for-ad against what
-- was already correct in the tables. No bookings fall on any of these four
-- dates (the only four bookings to date are 08-11 x2 and 08-13 x2), so
-- bookings_all/bookings_held are 0 throughout -- nothing here touches that
-- data. 2026-08-26 is a PARTIAL day as of this write (~14:35 America/Costa_Rica)
-- and will read low until the pipeline resumes and completes it naturally.

begin;

-- ---- kasper_ad_performance_by_ad_daily ----

insert into public.kasper_ad_performance_by_ad_daily
  (date, ad_name, spend, impressions, clicks, landing_page_views, bookings_all, bookings_held, updated_by, updated_at)
values
  ('2026-08-14', 'Video | Fast Pitch',     93.97, 347, 8, 6, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-14', 'Video | Danny Training', 21.13, 55,  2, 1, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-14', 'Video | Baya Training',  15.07, 58,  1, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),

  ('2026-08-15', 'Video | Mechanism Pitch', 11.83, 79,  1, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-15', 'Video | Results Montage', 9.99,  32,  0, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-15', 'Video | Fast Pitch',      43.07, 183, 2, 2, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-15', 'Video | Danny Training',  11.14, 69,  1, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-15', 'Video | Baya Training',   12.34, 33,  2, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),

  ('2026-08-25', 'Video | Fast Pitch',      42.30, 124, 3, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-25', 'Video | Danny Training',  2.69,  5,   0, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),

  ('2026-08-26', 'Video | Fast Pitch',      25.34, 66,  4, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26 (PARTIAL DAY)', now()),
  ('2026-08-26', 'Video | Danny Training',  0.59,  4,   0, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26 (PARTIAL DAY)', now())
on conflict (date, ad_name) do update set
  spend = excluded.spend,
  impressions = excluded.impressions,
  clicks = excluded.clicks,
  landing_page_views = excluded.landing_page_views,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

-- ---- kasper_ad_performance_daily (campaign-level) ----

insert into public.kasper_ad_performance_daily
  (date, spend, impressions, clicks, landing_page_views, bookings_all, bookings_held, updated_by, updated_at)
values
  ('2026-08-25', 44.99, 129, 3, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26', now()),
  ('2026-08-26', 25.93, 70,  4, 0, 0, 0, 'backfill-correction:kasper-ad-performance-gap-2026-08-26 (PARTIAL DAY)', now())
on conflict (date) do update set
  spend = excluded.spend,
  impressions = excluded.impressions,
  clicks = excluded.clicks,
  landing_page_views = excluded.landing_page_views,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

commit;
