# Moving the daily analytics jobs off n8n: Metrics first

Date: 2026-10-01. Session Harbor. Owner direction: the daily analytics data is
written straight to our database by our own Supabase Edge Functions, not by n8n
into Google Sheets. Order: (1) daily metrics (n8n "CLIENTS METRICS"), (2) Top
Videos, (3) Market Research briefs. This document maps and proposes the first
one and builds it to run **side by side** with n8n. Top Videos (step 2) is
mapped and built the same way in section 7; Market Research is not mapped yet.

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
from 04:00 to 08:59 UTC). Same sources, same rules, same row.

Why a tick every minute and not one big call: an Edge Function request has a
time limit (the project is on the Pro plan, owner 2026-10-01: about 6 minutes
of wall time per request; the 100 s budget below stays well inside it), and n8n's 75 minutes is mostly waiting on
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

**Bar to switch (owner decision, 2026-10-01):** 3 clean days with all clients
(all 36 match every day, and every difference the report names has been read and
explained) before this session proposes switching n8n off.
Expected, explainable differences: n8n reads the TikTok dataset 15 s after the
run starts and may take a partial one; the function waits for the run to end.

**Rollout (owner decisions, 2026-10-01).** Apify is called twice on the side-by-side
days (n8n and the function); the owner accepted that. Day 1: the test client plus
ONE real active client that has Instagram, TikTok and YouTube (the test client has no
Instagram, so on its own it cannot exercise the Instagram path); the owner approved
that client for shadow mode, where nothing anyone sees changes. The client was chosen
from the live roster (8 of 36 have all three platforms; its slug is given to the owner
in the session, never written in this public repo). The pick also has the YouTube
shorts/longs split, so day 1 exercises every branch of the job. Days 2 to 4: all
clients, and the 3 clean days count from the first all-client day.

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

Click by click, with every place a key must be stored:
`docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`. In short:

1. Merge this PR (Lighthouse). No deploy, no database change yet.
2. **Owner:** two secrets in Supabase (Edge Functions, Secrets): `APIFY_TOKEN`,
   `YOUTUBE_API_KEY` (the same values n8n holds as credentials; never in a file),
   and a new `ANALYTICS_COLLECT_KEY`, at least 32 characters. The new key is stored
   in THREE places: the Edge Function secret, Supabase Vault (step 7), and the
   terminal session that runs the seed script (step 6).
3. **Lighthouse, with the owner's go:** apply
   `migrations/2026-10-01-analytics-metrics-collect-shadow.sql`; run its VERIFY.
4. **Deploy** `analytics-metrics-collect` from
   https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
   with the merged commit (the session pastes the SHA once the PR is merged; do not
   merge anything between handing it over and the dispatch).
5. Set the flag to shadow, day 1 (test client and the one real client; the YouTube
   split list holds the slug of the one client n8n gives the split to, which is the
   same client):
   `update public.syncview_runtime_flags set value = '{"mode":"shadow","clients":["<test client slug>","<real client slug>"],"yt_split_clients":["<real client slug>"]}' where key = 'analytics_metrics_collect';`
6. **Seed the post tracking** (after n8n's run of the day, before 04:00 UTC next
   day): `node scripts/analytics-metrics-shadow-seed.js` (dry run: counts), then
   with `ANALYTICS_COLLECT_KEY` set, `--apply`. Measured dry run today: 5,648 rows
   (4,076 Instagram, 1,572 TikTok), all usable.
7. Store the same key in Vault (`select vault.create_secret('<the key>', 'analytics_collect_key');`)
   and apply `migrations/2026-10-01-analytics-metrics-collect-schedule.sql` (pg_net,
   the two cron jobs). It refuses to run without the Vault secret.
8. Next morning (after about 05:20 UTC): run the comparison for the two clients;
   fix what it names. Then widen the flag to all clients
   (`{"mode":"shadow","yt_split_clients":["<real client slug>"]}`, no `clients` list
   means everyone) and watch 3 clean days.

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

## 7. Top Videos (built 2026-10-02, shadow, nothing deployed or applied); Market Research next

### 7a. What TOP VIDEOS does today (read from the live workflow and its 2026-10-02 run)

Workflow `DyVPx0neUZ94R0hJ`, active, one Schedule Trigger. It runs at **08:00 UTC** (the
instance's "4 am") and takes 53 to 60 minutes (runs of 30 Sep to 2 Oct, all success); 36
clients, one at a time, a 30 s wait after each. No error workflow was needed to read it; I
did not edit it.

| Step | n8n node(s) | What it does |
|---|---|---|
| Roster | Get Clients | Every row of Clients Info. |
| Instagram | Scrape Instagram Posts, Process Instagram Top Videos | **Not gated on the handle.** Apify `apify~instagram-reel-scraper`, latest 50 reels, one synchronous call with a 120 s limit. Views = `videoPlayCount`, else `playCount`, else `videoViewCount`. Top **3 of the last 7 days** (rank 1 to 3) and top **5 of the last 30 days**. No post in the week: ONE row, period week, rank 0, caption "No new posts in the last 7 days", zeros. An HTTP failure or timeout takes the node's error output: no Instagram rows at all. |
| TikTok | Has TikTok?, Apify TikTok Run, Fetch TikTok Dataset, Process TikTok Top Videos | Only for a handle that is not empty and not "N/A". `clockworks~tiktok-profile-scraper`, 50 videos, waits up to 120 s then reads the dataset (a partial one if the run is still going). Same week and month rules, by `playCount`. |
| YouTube | Has YouTube?, YouTube Search Shorts, YouTube Video Stats, Process YouTube Top Videos | Only for a channel id that is not empty and not "N/A". Search: this channel's SHORT videos (YouTube's under-4-minute class), most viewed first, published in the last 30 days, 20 results; then the statistics of those ids. Week = published in the last 7 days; month = all 20. No short in 30 days is a normal answer: the "no new posts" row (seen in the 2026-10-02 run). A failed call takes the error output: no YouTube rows. |
| Rows | Unpack Rows, If | A client's rows from the three platforms, caption cut at 200 characters then every run of whitespace made one space; nothing at all means nothing is written. |
| Write | Write to TopVideos Sheet, Build Supabase Mirror Payload, Mirror to Supabase | Appends every row to the TopVideos tab (never deletes), then POSTs the same rows, one call per client, to `analytics-write` (dataset `top_videos`, source `n8n`, run id `n8n-topvideos-<execution id>`). The thumbnail column is always empty and is not mirrored. |

Readers of the output: the pages, through `analytics-read` (last 90 days), and the daily
parity lane. Sources: Apify (two actors, token held as an n8n credential), YouTube Data API
(key held as an n8n credential), Clients Info.

### 7b. What was built (this PR): `analytics-top-videos-collect`

Built the way section 2 and 3 built the metrics job:

- **Edge Function** `analytics-top-videos-collect`; pure rules in
  `supabase/functions/_shared/analytics-top-videos-collect.mjs`, one function per n8n Code node.
- **Shadow only.** It writes only `analytics_top_videos_shadow` (and its own queue). It never writes
  `analytics_top_videos` (what the pages read) and never touches a Sheet. n8n is not edited.
- **Roster** from `client_profiles` (active, not archived), the same list the metrics job uses.
- **Switch row** `analytics_top_videos_collect`, default `{"mode":"off"}`; `shadow` turns it on;
  optional `clients` list (slugs) and `batch` (1 to 4).
- **Timer:** every minute from 08:00 to 12:59 UTC (n8n starts at 08:00 and ends about 09:00). One client
  per tick, a slow Apify run is resumed from its saved id, the 8th attempt records a provider failure.
- **Same key and secrets as the metrics job** (`ANALYTICS_COLLECT_KEY` in Edge Function secrets and
  Vault, `APIFY_TOKEN`, `YOUTUBE_API_KEY`). Nothing new for the owner to create.
- **Comparison**, every morning after about 09:30 UTC (counts only into any doc):

```sql
select client_slug, matches, mismatched, n8n_rows, shadow_rows, shadow_states
from public.analytics_top_videos_shadow_compare();      -- today
-- summary: select count(*) filter (where matches) ok, count(*) filter (where not matches) off
-- from public.analytics_top_videos_shadow_compare();
```

A client-day "matches" when, for every platform and period, the same videos are present (by link),
each has the same rank and caption, and views agree within 10 percent (minimum 50) and likes, comments
and shares within 10 percent (minimum 10). A row one side lacks is named (`instagram:week:only_n8n`),
and so is a client one side did not write at all. A client with no rows on either side agrees and is
not listed. Only n8n's newest run of the day is compared.

**Differences that are expected and explainable, not bugs:**
- Both jobs scrape live data up to an hour apart: two videos with close views can swap rank, and a
  video published in between appears on one side only.
- n8n reads the TikTok dataset after 120 s even if the run is still going (it may take a partial one);
  the function waits until the run ends. A TikTok run that ends FAILED or TIMED-OUT is a provider failure
  here (no rows); n8n might have read a partial dataset.
- n8n scrapes Instagram for every client, even one with no handle (that call fails and writes nothing).
  The function skips an unconfigured Instagram handle, so the same nothing is written.
- n8n waits 120 s on a synchronous Apify call and gives up (no rows); the function waits longer.

**Not proven, and why:** nothing here has talked to Apify, YouTube, pg_net or pg_cron (no keys or live
access in the build environment). The first real proof is the first shadow day. The equivalence is shown
against the n8n Code nodes themselves (`test/fixtures/n8n-top-videos-code.js`, copied from the live
workflow), not against a recorded production run.

**Proof (offline):** `test/analytics-top-videos-collect.js` (600 random clients through the n8n Code nodes
and through the port, identical rows, and identical to what the real mirror would store; two deliberate
breakages caught), `test/analytics-top-videos-collect-function.js` (the real function against an in-memory
database and scripted providers), `test/analytics-top-videos-collect-postgres.js` (the migration on a
real PostgreSQL 16, four roles measured on every table and function, claim, commit, comparison).

**Steps** (nothing happens until the owner says go; click by click in
`docs/ops/ANALYTICS_TOP_VIDEOS_OWNER_STEPS.md`): merge (Lighthouse); apply the shadow migration (after
the two metrics migrations); deploy `analytics-top-videos-collect` from the single-function lane with the
merged commit; set the flag to shadow for the test client plus the one real client, then all clients; apply
the schedule migration; compare each morning. Bar to switch: 3 clean days with all clients, as for metrics.

**What this PR does NOT do:** write `analytics_top_videos`; edit n8n; port the Sheet append (the
TopVideos tab stops growing only when n8n is switched off, in the later switch PR, which also needs one
more value in the table's `source` check and a decision on the daily Sheet copy lane); alert on a failed
platform (the function records every platform's outcome in the queue and in the comparison).

### 7c. Market Research (not started)

MARKET RESEARCH is webhook-driven briefs (Apify search, append or update on a brief id) and a disabled
content-summary branch. It reads Clients Info. It gets its own PR.

## 8. Decisions for the owner

All three answered by the owner on 2026-10-01: (1) Apify spend accepted, day 1 is the
test client plus one real client with Instagram, TikTok and YouTube, then all clients
for 3 days; (2) 3 clean days is the bar before proposing to switch n8n off;
(3) Supabase is on the Pro plan.
