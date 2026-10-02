# Owner steps: start the shadow run of the Market Research brief job

For the owner (Sidney). Plan and reasons: `docs/plans/2026-10-01-n8n-off-analytics.md`, section 7c
(ledger entry OPEN_REPAIRS 329). Do these only after Lighthouse has merged the PR that adds this file,
and **after the metrics shadow steps** (`docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`) are done. Nothing
here changes what anyone sees in SyncView: the new job writes to its own shadow tables, and n8n keeps
running untouched.

Unlike the other two jobs this one does not run every day. It builds **one brief when you ask for one**, and
one brief costs real money (Apify searches, Whisper transcripts, one long Claude answer). So everything below
is for the test client only unless you decide otherwise.

## What is new for you: one secret, and one to confirm

| Secret | Where | What to do |
|---|---|---|
| `ANALYTICS_COLLECT_KEY`, `APIFY_TOKEN` | Supabase, Edge Functions, Secrets | Already there from the metrics steps. Nothing to do. |
| `OPENAI_KEY` | Supabase, Edge Functions, Secrets | Already there (the image function uses it). The new job uses it for Whisper (transcripts). Confirm it is the OpenAI key you are happy to have used for that, or tell the session. |
| `ANTHROPIC_API_KEY` | Supabase, Edge Functions, Secrets | **New.** The same key n8n holds as its Anthropic credential. Add it as a secret named exactly `ANTHROPIC_API_KEY`. Never in a file. |

## Steps

1. **Lighthouse, with your go:** apply `migrations/2026-10-02-analytics-market-research-collect-shadow.sql`
   (it refuses to run unless the two 2026-10-01 metrics migrations are applied) and run the VERIFY at its end.
   Nothing runs yet; the switch is off.
2. **You:** add `ANTHROPIC_API_KEY` and confirm `OPENAI_KEY` (table above).
3. **Deploy** `analytics-market-research-collect` from
   https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
   with the merged commit (the session pastes the SHA once the PR is merged; do not merge anything
   between handing it over and the dispatch).
4. **Switch it on for the test client only.** The switch has a list of the clients it may build (it builds
   nobody else) and a cap on new briefs per day. Replace the placeholder with the test client's slug (it is in
   the session chat, not in this file) and paste in the Supabase SQL editor:
   `update public.syncview_runtime_flags set value = '{"mode":"shadow","clients":["<test client slug>"],"max_new_per_day":2}'::jsonb where key = 'analytics_market_research_collect';`
   (or ask the session to print it). Off again: `'{"mode":"off"}'`.
5. **Apply the timer:** `migrations/2026-10-02-analytics-market-research-collect-schedule.sql` (it refuses to
   run without the Vault secret). It calls the function every minute, but only while a request is open.
6. **Ask for one brief.** The session or Lighthouse prints the statement with the slug and keywords as inputs,
   and you paste it into the Supabase SQL editor:
   `node scripts/analytics-market-research-request.js --client=<test client slug> --keyword="first keyword" --keyword="second keyword"`
   (1 to 10 keywords; it connects to nothing and rejects anything that is not a slug). The brief takes from
   several minutes to about an hour. Watch it:
   `select state, attempts, last_error, outcome from public.analytics_market_research_collect_queue order by created_at desc limit 3;`
   `done` means the brief is in `analytics_market_research_shadow`.
7. **Compare with n8n** (only possible if n8n also built a brief for the same client that day, with the same
   keywords, by you calling its webhook; the copy of n8n's brief reaches the database up to a day later):
   `select * from public.analytics_market_research_shadow_compare();`
   Without an n8n brief the answer is `no_n8n_brief`; then judge the shadow brief by eye (read it in
   `analytics_market_research_shadow`, or ask the session to show its sections) and by `outcome` (how many
   reels, how many transcribed, which model, the prompt fingerprint).

## Rollback at any point

`update public.syncview_runtime_flags set value = '{"mode":"off"}' where key = 'analytics_market_research_collect';`
(the function stops at once), and `select cron.unschedule('analytics-market-research-collect-tick');` if wanted.
The shadow tables hold nothing the pages read.
