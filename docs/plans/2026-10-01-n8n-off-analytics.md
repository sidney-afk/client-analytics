# Moving the daily analytics jobs off n8n: Metrics first

Date: 2026-10-01. Session Harbor. Owner direction: the daily analytics data is
written straight to our database by our own Supabase Edge Functions, not by n8n
into Google Sheets. Order: (1) daily metrics (n8n "CLIENTS METRICS"), (2) Top
Videos, (3) Market Research briefs. This document maps and proposes the first
one and builds it to run **side by side** with n8n. Top Videos and Market
Research are not mapped yet (section 7).

Reads: `docs/plans/2026-09-24-sheets-to-supabase.md`,
`docs/plans/2026-09-28-analytics-switch-on.md`,
`docs/proposals/2026-10-01-analytics-views-audit.md` (the counting was checked
and is right; this port keeps it as it is, including the misleading column name).
Counts only, no client names or slugs (public repo).

Status: **built, nothing deployed, nothing applied, no n8n edit.** Owner and
Lighthouse steps are in section 5.

## 1. What CLIENTS METRICS does today (read from the live workflow, 2026-10-01)

Workflow `Q4n1bagJYBkurEaI`, active, one Schedule Trigger (daily 04:00 UTC).
Recent runs: 29 Sep to 1 Oct, 04:00 to about 05:15 UTC (75 minutes), success.
A disabled older copy of the whole flow sits beside it and is ignored. An error workflow is set.

**Sequence, per client, one at a time** (a loop over the Clients Info tab; 36
active clients):

| Step | n8n node(s) | What it does |
|---|---|---|
| Roster | Get row(s) in sheet, Initialize Run Contract | Reads Clients Info (name, instagram_handle, tiktok_handle, youtube_channel_id). Gives each client a key from its sheet row; refuses a missing name or duplicate key. |
| Instagram | Has Instagram?, Apify Instagram, Fetch Instagram Reels, Aggregate Instagram | A handle that is empty or "N/A" is skipped (platform "not configured"). Otherwise Apify `apify~instagram-profile-scraper` (followers) then `apify~instagram-reel-scraper` (latest 50 reels). Averages = mean over the reels of likes and of views (views = `videoPlayCount`, else `playCount`, else `videoViewCount`), rounded. Provider errors are classified (restricted profile, no items, blocked, HTTP, bad schema). |
| TikTok | Has TikTok?, Apify TikTok run, Wait2 (15 s), Fetch TikTok Dataset, Aggregate TikTok | Apify `clockworks~tiktok-profile-scraper`, 30 videos, run with a 120 s wait, then the dataset. Followers from `authorMeta.fans`; average = mean `playCount`. |
| YouTube | Has YouTube?, YouTube | YouTube Data API `channels?part=statistics`: subscribers and total views. |
| YouTube shorts/longs | If, YT Playlist Items, YT Video Stats, Classify & Sum | **Only for one named client** (an equality test on the name). Uploads of the last 30 days: at most 180 s long counts as a short, else long; summed views. Every other client gets the two cells as the two characters `""`, which the mirror already stores as empty. A client with no YouTube gets `0` and `0`. |
| Merge | Merge Data3 | Builds the day's row plus a receipt (per platform: configured, attempted, state success / genuinely_empty / provider_failed / not_configured, item count, error class). |
| Daily gains | Update Post Tracking, Read Post Tracking, Compute Post Gains, Write Post Tracking | The **PostTracking** tab holds one row per post (id, views yesterday, views today, first seen). Gain per post = max(0, views today minus the stored views); a post seen for the first time counts 0, except a TikTok published in the last 2 days (counts all its views); an Instagram reel's first sighting is always a 0 baseline. Instagram and TikTok gains are the sums. The tab is written (update by post id) before the row is. |
| Diffs | Get Previous Rows, Compute Diffs | Reads this client's earlier Metrics rows, takes the latest dated before today (UTC). `*_views_this_month` = previous value + today's gain: a **cumulative counter that never resets** (the pages subtract the value 30 days earlier). YouTube gain = max(0, total views today minus previous total). A platform whose provider failed copies the previous row's values, gains 0, keeps the counter, and is marked `used_last_good`. Row result is `success` or `degraded`. |
| Write | Write to Sheet, Mirror to Supabase | Appends the row to the Metrics tab, then POSTs the same row to `analytics-write` (dataset `metrics`, source `n8n`, one call per client, continue on error). |
| Checks | Emit Client Terminal Receipt, Validate Roster Coverage | After the loop: every client has exactly one terminal receipt, none missing, duplicated or unexpected, no write failure; fails the run on a **frozen Instagram** pattern (5 or more configured clients, all healthy, none with a gain). Partial provider failures raise a named error; the error workflow alerts. |

**Sources:** Apify (two Instagram actors, one TikTok actor, token held as an n8n
credential), YouTube Data API (key held as an n8n credential), Clients Info tab.
**Reads of its own earlier output:** Metrics tab (previous rows), PostTracking tab.
**Outputs:** Metrics tab (one row per client per day, 17 columns), PostTracking
tab (state), the mirror row in `analytics_metrics`. Also, the YouTube split is
the only place the workflow knows a client by name.

**Readers of the output:** the pages (through `analytics-read` once the mirror
read is on, which it is for everyone since 2026-10-01), the daily parity lane.

## 2. Proposal: one Edge Function, one timer

**`analytics-metrics-collect`** (Edge Function) plus **pg_cron** (every minute
from 04:00 to 06:59 UTC). Same sources, same rules, same row.

Why a tick every minute and not one big call: an Edge Function request has a
time limit (about 2 minutes on the Free plan and 6 on paid, we have not
confirmed which this project has), and n8n's 75 minutes is mostly waiting on
Apify. So each minute the timer calls the function; it works on **one client**
(configurable up to 4) until its time budget (100 s) is spent, saves what it
has, and the next tick picks up where it stopped. A scraper that is still running
keeps its Apify run id in the queue row, so it is read later, never restarted.
After 8 attempts a source that never answered is recorded as a provider failure,
exactly as n8n records one. 36 clients fit in the window with room to spare.

What it reuses: the roster (`client_profiles`, copied daily from Clients Info),
`analytics_metrics` for "previous rows" (the same rows n8n reads from the
Sheet, so the cumulative counters line up), the shared slug rule.

What is new in the database (migration, **not applied**):
`analytics_post_tracking` (the PostTracking state), `analytics_metrics_collect_queue`
(one row per client per day), `analytics_metrics_shadow` (the function's row, for
comparing), two functions (claim a client, commit a client atomically) and the
comparison query. Row, post tracking and "done" are written **in one transaction**,
which n8n does not do (it writes the tab, then the row; a failure between the two
makes the next day's gains too big).

Where the Google-Sheet-specific parts go: PostTracking becomes the table;
"Get Previous Rows" becomes a query on `analytics_metrics`; the roster check
becomes the queue (one row per active client).

## 3. Side by side (this PR): shadow mode only

The flag `analytics_metrics_collect` (default `{"mode":"off"}`). In `shadow` the
function does the whole job and writes **only** `analytics_metrics_shadow` and its
own post-tracking. It never writes `analytics_metrics` (what the pages read) and
never touches a Sheet. n8n is not edited and keeps running. Tests assert both
(`test/analytics-metrics-collect-function.js`).

**Comparison, every morning after about 05:20 UTC** (Lighthouse; counts only
into any doc):

```sql
select client_slug, matches, mismatched
from public.analytics_metrics_shadow_compare();           -- today
-- summary: select count(*) filter (where matches) ok, count(*) filter (where not matches) off
-- from public.analytics_metrics_shadow_compare();
```

Both jobs scrape live data minutes apart, so numbers will not be identical:
a client-day "matches" when followers agree within 0.5 percent (minimum 5),
averages within 10 percent (minimum 50), YouTube totals within 0.5 percent
(minimum 500), gains within 10 percent (minimum 500), the cumulative counters
within the day's gain tolerance, shorts/longs within 1 percent, and the
per-platform receipt states are equal. A client missing on either side is named.

**Proposed bar to switch (owner decides):** 3 consecutive days where all 36
clients match, and every difference the report names has been read and explained.
Expected, explainable differences: n8n reads the TikTok dataset 15 s after the
run starts and may take a partial one; the function waits for the run to end.

**Cost to know:** during the side-by-side days Apify is called twice (n8n and the
function), roughly doubling those days' scraping bill. To limit it, start with
`{"mode":"shadow","clients":["<test client slug>"]}` (the test client only),
then all clients for the 3 days.

## 4. How the proof was made (all offline, nothing live)

- `test/analytics-metrics-collect.js`: the n8n Code nodes, exactly as they ran
  (`test/fixtures/n8n-clients-metrics-code.js`), and the function's rules run on
  the same 600 random clients (reels, TikToks, YouTube answers, error-shaped
  provider answers, stored posts, stored previous rows, clients with and without
  each platform). Identical final rows and post-tracking rows. Two deliberate
  breakages of the port were caught.
- `test/analytics-metrics-collect-function.js`: the real function against an
  in-memory database and scripted Apify and YouTube: auth, off switch, one client
  per tick, resume from a saved Apify run, the 8th-attempt timeout, a refused
  commit leaving the client retryable, the seed refusing once a run has started.
- `test/analytics-metrics-collect-postgres.js`: the migration on a real
  PostgreSQL 16 (applied twice), the four roles measured on every table and
  function, the claim, the atomic commit, the comparison.

**Not proven, and why:** nothing here has talked to Apify, YouTube, pg_net or
pg_cron (no keys or live access in the build environment). The first real proof
is the first shadow day. The 100 s budget assumes the request limit is at least
2 minutes. I could not pull a full n8n run's raw data for a replay (the MCP
connection dropped on the large result), so equivalence is shown against the n8n
code itself, not against a recorded production run.

## 5. Steps (nothing happens until the owner says go)

1. Merge this PR (Lighthouse). No deploy, no database change yet.
2. **Owner:** two secrets in Supabase (Edge Functions, Secrets): `APIFY_TOKEN`,
   `YOUTUBE_API_KEY` (the same values n8n holds as credentials; never in a file),
   and a new `ANALYTICS_COLLECT_KEY`, at least 32 characters (`openssl rand -hex 32`).
3. **Lighthouse, with the owner's go:** apply
   `migrations/2026-10-01-analytics-metrics-collect-shadow.sql`; run its VERIFY.
4. **Deploy** `analytics-metrics-collect` from
   https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
   with the merged commit (the session pastes the SHA once the PR is merged; do not
   merge anything between handing it over and the dispatch).
5. Set the flag to shadow, test client only:
   `update public.syncview_runtime_flags set value = '{"mode":"shadow","clients":["<test client slug>"]}' where key = 'analytics_metrics_collect';`
6. **Seed the post tracking** (after n8n's run of the day, before 04:00 UTC next
   day): `node scripts/analytics-metrics-shadow-seed.js` (dry run: counts), then
   with `ANALYTICS_COLLECT_KEY` set, `--apply`. Measured dry run today: 5,648 rows
   (4,076 Instagram, 1,572 TikTok), all usable.
7. Store the same key in Vault (`select vault.create_secret('<the key>', 'analytics_collect_key');`)
   and apply `migrations/2026-10-01-analytics-metrics-collect-schedule.sql` (pg_net,
   the two cron jobs). It refuses to run without the Vault secret.
8. Next morning: run the comparison for the test client; fix what it names.
   Then widen the flag to all clients and watch 3 days.

Rollback at any point: set the flag to `{"mode":"off"}` (the function stops at once),
`select cron.unschedule('analytics-metrics-collect-tick');` if wanted. Shadow tables
hold nothing the pages read.

## 6. What this PR does NOT do (the switch is a separate PR, after the days match)

- Write `analytics_metrics`. It needs one more value allowed in the table's
  `source` check, the write through the same fingerprint rules as `analytics-write`,
  and a decision on the daily Sheet copy lane (it would stop finding rows in the
  Sheet; the parity lane compares Sheet to database).
- The n8n safety checks (every client has exactly one terminal receipt; the
  frozen-Instagram detector; the alert on partial provider failure). The function
  records every client's receipt and `last_error` in the queue; the alert and the
  roster check must be rebuilt (a SQL check on the queue plus the one-message Slack
  alert already agreed in STATE_OF_THINGS) before n8n is switched off.
- The YouTube shorts/longs client list is a flag value (`yt_split_clients`, a list
  of slugs), set at step 5 by whoever knows which client it is; no name is in the code.
- Edit n8n. Switching n8n off is the owner's explicit go in that same request.
- The PostTracking Sheet tab stops being updated once n8n is off; nothing else
  in this repo reads it.

## 7. Next: Top Videos, then Market Research (not started)

Same method: map the workflow node by node, shadow function, daily comparison,
then the switch. From the earlier surveys: TOP VIDEOS runs daily 04:00 (Apify
Instagram and TikTok, YouTube API, appends rows, never deletes) and already mirrors
every client; MARKET RESEARCH is webhook-driven briefs (Apify search, append or
update on a brief id) and a disabled content-summary branch. Both read Clients Info.
Each gets its own PR.

## 8. Decisions for the owner

1. Apify spend: accept roughly double on the side-by-side days, or test client only first?
2. The switch bar: 3 clean days with all clients, as proposed?
3. Is the project on the Free or a paid Supabase plan (request time limit)? The
   per-minute design works on either; it only changes how many clients finish per tick.
