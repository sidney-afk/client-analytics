# Audit: are the Instagram "views" numbers right? (n8n CLIENTS METRICS)

Status: READ-ONLY AUDIT. No n8n edit, no data change. Counts only, no client
names. Measured 2026-10-01 on workflow `Q4n1bagJYBkurEaI`, the stored
`analytics_metrics` rows and the page code in `src/index/040`/`050`.

## How the daily job counts

- Per client: latest 50 Instagram reels and 30 TikToks (Apify); YouTube channel
  totals plus the last 50 uploads.
- One row per post is kept in PostTracking (views yesterday, views today).
  Gained today = sum over posts of max(0, views today - views yesterday). A post
  seen for the first time counts 0, unless published in the last 2 days.
- `ig_views_this_month` and `tiktok_plays_this_month` ("Compute Diffs") are
  yesterday's stored value + today's gain. They are **cumulative counters that
  never reset, by design**. The page turns them into "Views Last 30d" by
  subtracting the row from 30 days earlier (`getMonthRow`, `mBlockViews30d`,
  `mhViews30d`, `ncViewsDelta`). So the stored column is not itself a 30 day
  figure, and its name is misleading.
- YouTube: gained today = channel lifetime views today minus yesterday. Shorts
  and longs are views of videos published in the last 30 days.

## What the numbers show

- "Gained today" is correct. For the largest client (3.01M on 30 Sep) the raw
  per-post data shows one reel going 1.98M to 4.42M (+2.44M) and another 16.06M
  to 16.60M (+0.54M). Its 50 reels hold 22.9M views and its gains since 21 Sep
  add up to about 22M, so a viral reel is real. The other two top clients gained
  about 0.1M and 0.02M to 0.04M.
- The stored counter for that client is 24.57M, but 30 days earlier it was 2.28M.
  A page that subtracts correctly shows about 22.3M. A figure near 24.5M appears
  only where a surface reads the stored counter directly, or finds no row 30 days
  back. **Open question for the owner: which screen shows the 24.5M?** That is
  the surface to fix, not the n8n job.
- The jump from about 20k a day to 6.5M on 21 Sep cannot be checked against
  scraper output: n8n keeps raw runs only from 24 Sep.
- 29 and 30 Sep each have two identical stored rows for the largest client. The
  page keeps the last row per date, so it is not double counted there; any new
  code that sums rows must do the same.

## Verdict

The counting is right. The data is a real viral reel, not a bug. The only defect
is the misleading column name and whichever surface reads the raw counter.

## Not proposed

Replacing the counter with a rolling sum in the n8n node is **withdrawn**: every
page reader would then subtract two rolling totals and show a wrong (possibly
negative) number, and a naive sum would also double count the duplicate rows.
Any change must ship together with the page readers.
