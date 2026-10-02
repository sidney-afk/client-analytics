# Owner steps: start the shadow run of the daily Top Videos job

For the owner (Sidney). Plan and reasons: `docs/plans/2026-10-01-n8n-off-analytics.md`, section 7
(ledger entry OPEN_REPAIRS 327). Do these only after Lighthouse has merged the PR that adds this file,
and **after the metrics shadow steps** (`docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`) are done. Nothing
here changes what anyone sees in SyncView: the new job writes to its own shadow tables, and n8n keeps
running untouched.

## What is new for you: nothing to create

The Top Videos job uses the SAME three secrets and the SAME Vault key as the metrics job
(`APIFY_TOKEN`, `YOUTUBE_API_KEY`, `ANALYTICS_COLLECT_KEY`, and the Vault secret
`analytics_collect_key`). If the metrics shadow run is working, they are already in place. If not, do
parts A to D of the metrics steps first.

## Steps

1. **Lighthouse, with your go:** apply `migrations/2026-10-02-analytics-top-videos-collect-shadow.sql`
   (it refuses to run unless the two 2026-10-01 metrics migrations are applied) and run the VERIFY at its
   end. Nothing runs yet; the switch is off.
2. **Deploy** `analytics-top-videos-collect` from
   https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
   with the merged commit (the session pastes the SHA once the PR is merged; do not merge anything
   between handing it over and the dispatch).
3. **Day 1 switch** (test client plus the one real client, same as for metrics; the slugs are in the
   session chat, not in this file):
   `update public.syncview_runtime_flags set value = '{"mode":"shadow","clients":["<test client slug>","<real client slug>"]}' where key = 'analytics_top_videos_collect';`
4. **Apply the timer:** `migrations/2026-10-02-analytics-top-videos-collect-schedule.sql` (it refuses
   to run without the Vault secret). The job runs from 08:00 UTC the next morning.
5. **Next morning, after about 09:30 UTC:** run the comparison for the two clients:
   `select * from public.analytics_top_videos_shadow_compare();` and fix what it names. Then widen the
   switch to everyone (`'{"mode":"shadow"}'`, no `clients` list) and watch 3 clean days.

Apify is called twice on the side-by-side days (n8n and the function); you accepted that for the
metrics job and it is the same for this one.

## Rollback at any point

`update public.syncview_runtime_flags set value = '{"mode":"off"}' where key = 'analytics_top_videos_collect';`
(the function stops at once), and `select cron.unschedule('analytics-top-videos-collect-tick');` if wanted.
The shadow tables hold nothing the pages read.
