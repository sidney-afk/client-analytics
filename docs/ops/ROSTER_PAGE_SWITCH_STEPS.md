# The page stops reading Clients Info and Social Media Managers from the Sheet: Lighthouse steps

Session Quarry, 2026-10-08. Sheets move (STATE_OF_THINGS item A), slice 1 of
[the remaining map](../plans/2026-10-03-sheets-remaining-map.md): the page's own two Sheet reads.
Ledger: OPEN_REPAIRS 374. Nothing below has been done; every step needs the owner's go.

## What changes, in plain words

Since 2026-10-02 the database is the main copy of the client list (Clients Info) and of who manages
each client (Social Media Managers). The two Sheet tabs are a copy the database keeps up to date.
The page still downloaded both tabs itself. After the switch below it never does:

- **Client list.** Staff get it from `analytics-read` (the same call that already brings the numbers).
  If that call fails, this browser's saved copy is used; if there is none, the page shows its
  "could not load" state instead of reading the Sheet. A client link gets only its own row from the
  database (before, its fallback downloaded the whole Clients Info tab into the client's browser),
  also when the numbers read is not on for that link (it then asks for its own row only).
  If a client link's read fails, the client sees "We could not load your analytics" with Try again,
  which asks once more; the link is not called invalid and the client's saved calendar copy stays.
  The SMM weekly report pages, which open before sign-in, read the client list again once the SMM
  signs in (OPEN_REPAIRS 398).
- **Numbers.** Unchanged rule: if the database copy of the numbers is missing or older than 3 days,
  only the Metrics tab is read from the Sheet. Clients Info is not read with it any more.
- **Review queue managers.** Kasper's queue and the Samples queue read the manager list from
  `smm-weekly-reports` (the door Today and the weekly reports already use, unchanged); the queues
  show the manager's name only. No staff key, or a refused key: no manager shown, the same thing a
  failed Sheet read did.

Without the switch the page behaves exactly as today.

## Steps

1. **Merge (Lighthouse).** Merging deploys nothing.
   **Deploy `analytics-read` (owner's go)** from
   https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
   (function `analytics-read`, commit = main's tip after the merge). It adds one thing: under the
   switch, a client link may read its own profile row even when the numbers read is not on for it.
   Today the numbers read is on for everyone (`"enabled": true`), so this matters only if that is
   ever narrowed; deploy it before step 3 all the same.
2. **Check both copies match (read only).** The daily lane "Sheets mirror daily copy and parity" now
   compares both: `sheets-mirror-parity.js` (Clients Info, all columns) and
   `roster-managers-parity.js` (manager assignments). Both must end `PARITY: clean`. Run it by hand
   from https://github.com/sidney-afk/client-analytics/actions/workflows/sheets-mirror-daily.yml
   (Run workflow, branch main, leave "apply" unticked).
3. **Flip the switch (owner's go).** Supabase dashboard, SyncView project, SQL Editor:

   ```sql
   update public.syncview_runtime_flags
   set value = value || '{"roster":"database"}'::jsonb
   where key = 'analytics_mirror_read_enabled';
   ```

   It should say `1 row affected`. The other settings in that row stay as they are.
4. **Prove it on the test client only.** Sign in as staff, open Analytics, Kasper's review queue and
   the test client's (sidneylaruel) client link. In the browser's network list there is no request to
   `docs.google.com` for `Clients Info` or `Social Media Managers`; the console shows
   `analytics database overview read in ... ms`. The queue shows the managers as before.
5. **Way back, one step:**

   ```sql
   update public.syncview_runtime_flags
   set value = value - 'roster'
   where key = 'analytics_mirror_read_enabled';
   ```

## What still reads the two tabs after the switch (so they cannot be retired yet)

- n8n CLIENTS METRICS and TOP VIDEOS read Clients Info when they run. Analytics are paused by owner
  decision (2026-10-06), so they are off.
- `clients-roster-sync` (daily GitHub lane) reads Clients Info; moving it to the database is its own step.
- The daily parity above reads both tabs on purpose, to prove the copy.
- Weekly Backup copies the whole workbook.
- People may open the tabs; the owner still has to protect them in Google (OPEN_REPAIRS 331).

When those are gone: stop the database's Sheet copy, keep the tabs one month, archive them (owner).
