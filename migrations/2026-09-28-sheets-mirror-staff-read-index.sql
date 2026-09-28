-- 2026-09-28 — one index for the staff Analytics read (analytics-read,
-- scope "extras"): every client's top videos from the last 90 days, paged in
-- (scraped_date, seq) order. Measured on 2026-09-28 without it: a parallel
-- sequential scan of the whole table and a sort, about 99 ms per 1000-row
-- page, repeated for each of about 29 pages. With it each page is an index
-- range read.
--
-- An index grants nothing to anyone and changes no data, so no role's rights
-- move (the four-role test in test/sheets-mirror-roles-postgres.js still
-- holds). Idempotent. NOT APPLIED: Lighthouse applies it.
create index if not exists analytics_top_videos_scraped_seq_idx
  on public.analytics_top_videos (scraped_date, seq);
