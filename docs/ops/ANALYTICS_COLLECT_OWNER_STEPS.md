# Owner steps: start the shadow run of the daily metrics job

For the owner (Sidney). Plan and reasons: `docs/plans/2026-10-01-n8n-off-analytics.md`
(ledger entry OPEN_REPAIRS 322). Do these only after Lighthouse has merged the PR
that adds this file. Nothing here changes what anyone sees in SyncView: the new job
writes to its own shadow tables, and n8n keeps running untouched.

The two client slugs for day 1 are in the session chat, not in this file (this repo
is public). Below, `<REAL_CLIENT_SLUG>` stands for the one real client.

## Where every key lives (read this first)

| Key | Where it must be stored | Why |
|---|---|---|
| `APIFY_TOKEN` | Supabase, Edge Functions, Secrets | The new function scrapes with it. n8n keeps its own copy; leave that alone. |
| `YOUTUBE_API_KEY` | Supabase, Edge Functions, Secrets | Same, for YouTube. |
| `ANALYTICS_COLLECT_KEY` (new, you make it) | **1.** Supabase, Edge Functions, Secrets. **2.** Supabase **Vault** under the name `analytics_collect_key` (the timer reads it from there). **3.** Your Windows user, encrypted: the seed script asks for it once and saves it. **4.** Your password manager. | It is the password the timer and the seed script use to call the function. The function checks it against place 1; the timer sends the copy from place 2. If 1 and 2 differ, the timer is refused. |

Nothing goes in GitHub secrets, in n8n, or in any file in the repo.

## A. Make the new key (2 minutes)

1. Open **PowerShell** (any window, any folder).
2. Paste this whole block and press Enter. It prints 64 characters:

   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
   ```

3. Copy the 64 characters into your password manager as `ANALYTICS_COLLECT_KEY`
   (place 4). Keep the PowerShell window open until step D is done, or copy it again from
   the password manager.

## B. Get the Apify token and the YouTube key

n8n hides the values stored in its credentials, so take them from the source. If you
already have them in your password manager, use those and skip this part.

1. **Apify token:** open the Apify Console, then your name or avatar (bottom left), **Settings**,
   **API & Integrations**, **Personal API tokens**. Copy the token n8n uses, or press
   **Create new token**, name it `syncview-metrics`, and copy it.
2. **YouTube key:** open the Google Cloud Console, pick the project n8n's YouTube key belongs to,
   **APIs & Services**, **Credentials**, **API keys**. Copy that key, or **Create credentials**,
   **API key**, then under **API restrictions** choose **YouTube Data API v3**, and copy it.

## C. Store the three secrets in Supabase (place 1)

1. Open the Supabase dashboard, pick the **SyncView** project (the same one the other Edge
   Function secrets live in).
2. Left sidebar, **Edge Functions**, then **Secrets** (also shown as **Manage secrets**).
3. Add three secrets, each with a **Name** and a **Value**, then save:
   - Name `APIFY_TOKEN`, value: the Apify token.
   - Name `YOUTUBE_API_KEY`, value: the YouTube key.
   - Name `ANALYTICS_COLLECT_KEY`, value: the 64 characters from step A.
4. Check the list shows the three names. Supabase never shows a value again, which is normal.

Button names change a little between dashboard versions. The names and values are what matter.

## D. Store the key in Vault (place 2) and apply the database changes

Lighthouse applies the migrations; the Vault line is yours because it holds the key.

1. In Supabase, left sidebar, **SQL Editor**, **New query**.
2. Paste this, replace `PASTE_THE_64_CHARACTERS` with the key (keep the quotes), press **Run**:

   ```sql
   select vault.create_secret('PASTE_THE_64_CHARACTERS', 'analytics_collect_key');
   ```

   It should answer with one row (an id). If it says the name already exists, it is already stored.
3. Delete the query text from the editor and close the tab without saving it.
4. Tell Lighthouse the secrets are in. Lighthouse then, with your go, applies in this order:
   `migrations/2026-10-01-analytics-metrics-collect-shadow.sql` (and runs its VERIFY block).
   The second file, `...-collect-schedule.sql`, comes at step G.

## E. Deploy the function (once the migration is applied)

1. Lighthouse or this session gives you the exact 40-character commit to paste. **Nothing is merged
   between that moment and your click.**
2. Open https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
3. Right side, **Run workflow**. Branch: **main**. **function**: choose `analytics-metrics-collect`.
   **commit_sha**: paste the 40 characters. Green **Run workflow** button.
4. If it asks you to approve the `production` environment, approve it. Wait for a green run.

## F. Switch it on for day 1 (shadow, two clients) and copy the post tracking

1. SQL Editor, **New query**, paste, **Run** (replace the real slug from the chat):

   ```sql
   update public.syncview_runtime_flags
   set value = '{"mode":"shadow","clients":["sidneylaruel","<REAL_CLIENT_SLUG>"],"yt_split_clients":["<REAL_CLIENT_SLUG>"]}'
   where key = 'analytics_metrics_collect';
   ```

   It should say `Success. 1 row affected`. The job does nothing for anyone else.
2. **Copy the PostTracking tab** (this makes the shadow start from the same "yesterday" as n8n). Do it
   **after n8n's run of the day has finished (after about 05:20 UTC) and before 04:00 UTC the next day**.
   Pull the latest `main` in your copy of the repo first, then in File Explorer open the repo, then
   `scripts\windows`, right-click `analytics-metrics-seed.ps1`, **Copy as path**, and in PowerShell type `&`,
   a space, paste the path, Enter.
   - The first time it asks for the key (hidden). Paste the 64 characters (place 3: it saves them encrypted for
     your Windows user only).
   - It prints counts (about 5,600 rows) and asks `Type YES`. Type `YES`, Enter. It ends `Done.`
   - If it says the flag is not set to shadow, do step 1 first. If it says `run_in_progress`, today's run has
     started: wait until after 05:20 UTC and run it again.

## G. Turn on the timer

1. Tell Lighthouse the PostTracking copy says `Done`. Lighthouse applies
   `migrations/2026-10-01-analytics-metrics-collect-schedule.sql` (it refuses to run unless step D was done).
2. From the next 04:00 UTC the timer calls the function every minute until 08:59 UTC.

## H. The next morning (after about 05:20 UTC)

Lighthouse (or this session) runs, in the SQL Editor:

```sql
select client_slug, state, attempts, last_error
from public.analytics_metrics_collect_queue where run_date = (now() at time zone 'utc')::date;

select client_slug, matches, mismatched from public.analytics_metrics_shadow_compare();
```

Good day 1: both clients `done`, no `last_error`, `matches` true (or every difference named and explained).

## Days 2 to 4: all clients

Once day 1 is understood, widen to everyone (one statement; no `clients` list means all):

```sql
update public.syncview_runtime_flags
set value = '{"mode":"shadow","yt_split_clients":["<REAL_CLIENT_SLUG>"]}'
where key = 'analytics_metrics_collect';
```

Three clean days with all clients is the bar before this session proposes switching n8n off.
Apify is called twice on these days (the new job and n8n); you accepted that.

## Stop at any time

```sql
update public.syncview_runtime_flags set value = '{"mode":"off"}' where key = 'analytics_metrics_collect';
```

The function does nothing from the next minute. To also stop the timer: `select cron.unschedule('analytics-metrics-collect-tick');`.
