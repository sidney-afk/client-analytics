# Proposal: "views this month" never resets (n8n CLIENTS METRICS)

Status: PROPOSAL ONLY. No n8n edit has been made. Needs the owner's go.
Counts only, no client names. Measured 2026-10-01 (read only) on workflow
`Q4n1bagJYBkurEaI` and the stored `analytics_metrics` rows.

## What the job does today

- Per client it pulls the latest 50 Instagram reels and the latest 30 TikToks
  (Apify), and YouTube channel totals plus the last 50 uploads.
- It keeps one row per post in the PostTracking sheet (views yesterday, views today).
- Gained today = sum over posts of max(0, views today - views yesterday). A post
  seen for the first time counts 0, unless it was published in the last 2 days.
- `ig_views_this_month` and `tiktok_plays_this_month` (node "Compute Diffs") are
  yesterday's stored value + today's gain. **There is no reset anywhere.**
- YouTube has no monthly figure. `yt_views_gained_today` = channel lifetime views
  today minus yesterday. Shorts/longs are views of videos published in the last 30
  days (this one is a true 30 day window).

## What the numbers show

- Month boundary on the largest client: 31 Aug stored 2,259,604, then 1 Sep stored
  2,280,666. It kept climbing through the month change. So the field is a running
  total since tracking began, not "this month" and not "30 days".
- For that client, 1 to 30 Sep real gains add up to about 22.3M, while the stored
  figure says 24.57M. The extra 2.28M is the pre-September carry-over (about 9%).
- "Gained today" (3.01M on 30 Sep) is **correctly counted**. In the raw per-post
  data for that run, 2.44M of it is one reel going from 1.98M to 4.42M views, and
  0.54M is a second reel (16.06M to 16.60M). The top 3 clients checked: one big
  (3.01M), two normal (about 0.1M and 0.02M to 0.04M). The big client's 50 reels
  hold 22.9M views today and its gains since 21 Sep add up to about 22M, so a
  viral reel is real, not a counting bug.
- Gains jumped from about 20k a day to 6.5M on 21 Sep. The raw data for that run
  is gone (n8n keeps only runs from 24 Sep), so the start of the spike cannot be
  independently verified from scraper output.

## Verdict

Gained today: right. Views this month: mislabeled and inflated by carry-over;
it will get much worse on 1 Oct, when it should restart but will not.

## Proposed fix (node "Compute Diffs", n8n edit NOT done)

Replace the running total with a rolling 30 day sum of stored daily gains. It
heals itself and does not depend on yesterday's total being clean:

```js
const sinceMs = Date.now() - 29 * 86400 * 1000;
const sumGains = (field) => allRows
  .filter(r => r.date && r.date < today && Date.parse(r.date) >= sinceMs)
  .reduce((s, r) => s + number(r[field]), 0);
output.ig_views_this_month = instagramFailed ? (previous ? previousIgMonth : null)
  : sumGains('ig_views_gained_today') + output.ig_views_gained_today;
output.tiktok_plays_this_month = tiktokFailed ? (previous ? previousTikTokMonth : null)
  : sumGains('tiktok_plays_gained_today') + output.tiktok_plays_gained_today;
```

Decisions for the owner:
1. Rolling 30 days (matches the page label "views in 30 days") or calendar month
   (reset to 0 on the 1st)? Recommended: rolling 30 days.
2. One-time correction of stored rows (and the Sheet) using the same formula,
   applied only with the owner's go.
3. Separately: some dates (29 and 30 Sep) have two identical stored rows
   (`row_occurrence` 2). Check the page does not sum both.
