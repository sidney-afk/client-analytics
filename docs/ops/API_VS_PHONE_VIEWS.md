# Is posting to TikTok through the API hurting views?

Owner question, 6 Nov 2026. Repeatable, read-only comparison of videos posted through Post For Me
(the `tiktok-upload` path) against the same client's videos posted by phone before their first API post.
Query: `scripts/analytics/api-vs-phone-tiktok.sql`. No credits are spent and no key is touched.

## Re-run it

Paste the file into the Supabase SQL editor (or `execute_sql`). Read only. The `slug` column holds real client
slugs: keep that output private. The repo and PRs may carry `label` (Client A, B, ...) and counts only.
The pooled TOTAL is the commented block at the bottom of the file.

## How it decides which video is which

- **Source of videos:** `analytics_top_videos` (TikTok rows: top 3 of the week, top 5 of the month per client, with views,
  likes, comments, shares). The latest scrape of each video is used. It is free, but it is a top-videos sample, not every
  video, and it stops at the last scrape date (6 Oct 2026 when this was written).
- **Post time of a video:** TikTok video ids carry it (`id >> 32` = unix seconds). `tiktok_uploads.tiktok_url` holds only the
  profile address, never the video's, so the match is by time.
- **API group:** a video whose post time is within 10 minutes of a posted `tiktok_uploads` row that has a Post For Me post id.
  (Measured: 168 of 189 uploads matched within 3 minutes, the rest were posted after the last scrape.) This includes rows
  from the old Sheet queue (`source = 'sheet'`) as well as `source = 'syncview'`, since both go through Post For Me.
- **Phone group:** per client, the same number of that client's non-API videos posted just before the first API post, most
  recent first.
- **Fairness:** only videos at least 7 days old at their last scrape. Mean age is reported for both groups.
- **Outliers:** the output keeps every video, and `trimmed_mean_views` drops videos above 10 times that client's median
  (API and phone pooled). Change `outlier_x` to move it.
- Engagement rate is (likes + comments + shares) / views, pooled per group.

## Result on 6 Nov 2026 (counts only)

| | videos | clients | mean views | median views | engagement | mean age at last scrape |
|---|---|---|---|---|---|---|
| API | 136 | 10 | 20,113 | 1,184 | 5.85% | 19 days |
| Phone | 88 | 10 | 14,643 | 1,120 | 5.75% | 27 days |

Restricting to the 8 clients with at least 4 videos in each group: API median 1,184 vs phone 1,071, engagement 3.88% vs 5.34%.
Per client, the API median is above the phone median in 6 of 10 clients and below in 4. 320 posted API uploads exist across 12
clients; 167 of them are matched to a scraped video.

**Reading:** there is no sign that API posting lowers views. Medians are within about 6% of each other, and the API group is
the younger one, so the age gap, if anything, favors the phone group. The sample is small and uneven, so this is "no evidence of harm",
not proof of no harm.

## Caveats, in order of weight

1. **Before/after, not a randomized test.** The phone group is older content from the same client. Account growth, season and
   content changes since the first API post are mixed in. A clean test needs the same client posting at the same time both ways.
2. **Uneven groups.** Two clients have 19 or more API videos but only 2 phone videos in the data, because older scrapes only keep the
   top videos. Their per-client rows say little. The 4-or-more restriction above is the better read.
3. **Top-videos sample.** A video appears only if it ranked in a client's top 3 of a week or top 5 of a month. That lifts both groups
   and hides the flops, so absolute views are optimistic. Both groups are filtered the same way.
4. **Views grow with age.** Last-scrape views are not views at a fixed age. No timeline per video is stored.
5. **Heavy tails.** One viral video moves a mean a lot, so read medians first. Several clients drop 1 to 6 videos in the trimmed mean.
6. **Stale data.** Scrapes stop at 6 Oct, so videos from the last month are missing.

## Instagram

Posted API Instagram posts (`instagram_uploads`): 16 across 3 clients, all first posted from 1 Oct 2026. None is 7 days old in
the stored scrapes, and only 1 appears in them at all, so there is nothing to compare yet. Fresh data needs a live Scrape Creators
read (server key, through an Edge Function). Rerun the same method on `platform = 'instagram'` once those posts have aged, using the
`/reel/<code>/` address to match.

## Next step to make it sharper

A small read-only Edge Function that lists a client's profile videos live (Scrape Creators) would remove caveats 3 and 6, and give
a posting time per video. Not built here: the key is only reachable through a deployed function, and this work was read only.
