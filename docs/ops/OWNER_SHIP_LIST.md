# Owner ship list: one sitting

Session Shipwright, 2026-10-09. Every line was measured on the live system the same
day, read only (database SELECTs, the live function list, GitHub run history, n8n
run history). The full measured table is OPEN_REPAIRS 389; the raw readings are
`docs/audits/2026-10-09-repo-vs-live-snapshot.json`.

**The short version.** Most of the shelf is already live: the ledger labels were
behind, not the work. Today's Section 4 deploy shipped the 382 reply fix (534
failed saves of that reply on 2026-10-08 and 09, none since), and 381, 385, 357,
362, 363, 372 are all live. What is left for you is below, in order. **No sealed
capture is needed for anything on this list.**

Ways to read the marks: **(hold?)** means you may reasonably decide to leave it
for now; the line says what holding costs.

To see the shelf yourself at any time: `node scripts/repo-vs-live.js` (read only;
section "Keeping it visible" at the end).

---

## 1. Backup (387): nothing to do now, one look tomorrow

Your grant and the corpus switch worked: the run you dispatched at 14:45 UTC
today is green. The nightly run after it has not happened yet.

- Tomorrow, open https://github.com/sidney-afk/client-analytics/actions/workflows/track-b-backup.yml
  and check the newest **scheduled** run is green. If it is red, hand it to a session.
- **(hold?)** The restore rehearsal for the new corpus has never run. It needs a fresh,
  empty scratch Supabase project and two restricted roles (`docs/ops/TRACK_B_BACKUP.md`),
  so it is its own sitting. Holding it means the backup is proven to be taken, not yet
  proven to restore.

## 2. Deploy `analytics-read` (374 and 326)

Live is version 21 from 2026-10-02; main changed it on 2026-10-08.

1. Open https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
2. **Run workflow**, branch `main`, function `analytics-read`,
   commit `1018bba5ff2fa98acaa26b3250b86aef88328b26`.
3. Green means it is live and attested.

What it changes today: nothing you can see (the numbers read is on for everyone). It
gets the next step ready and gives this function the 2-hour preflight cache (326).
Risk: low. Way back: run the same lane with an older commit on main.

## 3. Check the two roster copies match (read only)

The daily copy job has failed every day since 2026-10-03 and has not run since its fix
merged (#1997), so run it once by hand.

1. Open https://github.com/sidney-afk/client-analytics/actions/workflows/sheets-mirror-daily.yml
2. **Run workflow**, branch `main`, leave **apply unticked**.
3. Both checks must end `PARITY: clean`. If either does not, stop here and hand it to a session.

## 4. Flip the roster switch (374)

The page then stops downloading Clients Info and Social Media Managers from the Sheet.

1. Supabase dashboard, SyncView project, SQL Editor, paste and run:

   ```sql
   update public.syncview_runtime_flags
   set value = value || '{"roster":"database"}'::jsonb
   where key = 'analytics_mirror_read_enabled';
   ```

   It must say `1 row affected`.
2. Prove it on the test client only (step 4 of `docs/ops/ROSTER_PAGE_SWITCH_STEPS.md`):
   no `docs.google.com` request for those two tabs, and the console shows
   `analytics database overview read in ... ms`.

Way back, one step:

```sql
update public.syncview_runtime_flags
set value = value - 'roster'
where key = 'analytics_mirror_read_enabled';
```

## 5. Repository secret `SYNCVIEW_STAFF_KEY` (373)

I cannot read secrets, so I cannot tell whether you already did this.

1. Open https://github.com/sidney-afk/client-analytics/settings/secrets/actions
2. `SYNCVIEW_STAFF_KEY` must hold the same value as the Edge Function secret `ROLE_KEY_SMM`.
   If it already does, skip.

The Calendar and Samples nightly robots need it; their next runs show whether it is right.

## 6. Point Post For Me's result webhook at our function (370) **(hold?)**

The `tiktok-upload` function is live (deployed 2026-10-08), but results still arrive at
n8n: "SyncView TikTok Upload — Result" ran 7 times on 2026-10-07 and 08.

1. In PowerShell, in your copy of the repo:

   ```powershell
   $env:SYNCVIEW_ADMIN_KEY = "<your SyncView admin key>"
   node scripts/tiktok-pfm-webhook.js --register
   ```

2. After the next real TikTok post shows its result in the TikTok Upload tab, remove the
   old n8n webhook by the id the script lists: `node scripts/tiktok-pfm-webhook.js --remove=<id>`.
   That changes Post For Me's settings only, not n8n.

Holding it costs nothing new: n8n keeps receiving results as today.

## 7. Switch off five old n8n workflows (each its own go) **(hold?)**

All five had **zero runs since 2026-10-02** (n8n run history, read 2026-10-09), and each is
past your 5-day window. Switch each off by hand in n8n, then note it in
`docs/ops/N8N_EDIT_LOG.md` (or ask a session to). Way back: switch it on again.

| Workflow | Ledger | Replaced by |
|---|---|---|
| SyncView Caption Prompts — Save | 291 | `caption-prompts-save` and the `caption_prompts` table |
| SyncView Caption Jobs — Status | 303 | `caption-jobs` |
| SyncView Caption Jobs — Update | 303 | `caption-jobs` |
| SyncView Calendar — Get | 308 | the page reads the database |
| SyncView Kasper — Queue (batch) | 308 | the page reads the database |

**Do not switch off `Sample Review — Upsert`:** it ran **729 times since 2026-10-02**, and
was running while I read it. Something still saves Samples through n8n; a session has to
find out what before it can go. `Caption Prompts — Get` stays on (first-load fallback, 291).

## 8. Deploy `production-comments` (326) **(hold?)**

Live is from 2026-09-17; main added the 2-hour preflight cache on 2026-10-01. Its only lane
also redeploys eleven other functions from the same commit (among them `notify`,
`production-archive` and `production-write`). All eleven already match main, and
`production-write` matches it byte for byte since today's deploy, so this changes nothing
else. The gain is small (fewer preflight requests on comment reads), so holding is fine.

1. Open https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml
2. **Run workflow**, branch `main`, commit `1018bba5ff2fa98acaa26b3250b86aef88328b26`.

Do it only while nothing under `supabase/functions/production-write` has changed on main
since today; if it has, hold it until the next Section 4 deploy.

## 9. One combined Slack message (328) **(hold?)**

Still in shadow: the 09:37 UTC run today printed `ALERT_DIGEST_ENABLED` empty. Turning it on
needs your go on one n8n relay edit (`docs/ops/LINEAR_EXIT_STEP29C_ALERT_CONSOLIDATION.md`),
then the repository variable `ALERT_DIGEST_ENABLED=true` at
https://github.com/sidney-afk/client-analytics/settings/variables/actions.
The Watchtower project (alarms) may change this message first, so holding is reasonable.

## 10. Protect the two roster tabs in Google (331)

Clients Info and Social Media Managers are now a copy the database writes. In the Sheet:
**Data > Protect sheets and ranges**, protect both tabs so people stop editing the copy.
I could not measure this from here.

---

## Decisions only (nothing to do unless you choose to)

- **Analytics jobs (322, 327, 335, 356):** paused by you on 2026-10-06. The shadow parts are
  applied and deployed; the live mode is not applied. Live state matches your pause.
- **Frozen writers (334):** `calendar-upsert` and `sample-review-upsert` stay on their older
  live builds on purpose; the newer source needs the n8n caption login to carry the writer key first.
- **312:** whether to schedule a server-side catch-up for samples left behind their work item.
- **371 item 3:** Instagram accounts cannot be connected from the app (needs a database function
  change and a `client-profile-write` deploy).
- **376, 383, 384:** four product questions are listed in those entries (Today's approved posts,
  the "cleared today" meter, Today's "To approve" count, Back/Forward client).
- **382:** how much of the 551 MB of old `js/sv-*` bundles to keep.
- **293:** whether to delete the 141 old heartbeat rows of the two retired censuses.
- **A stray live function:** `fp-tab-test` (source in synchro-pipelines) looks like a leftover test.

## Needs a session, not you

- **326:** `production-write` does not carry the 2-hour preflight header in its source yet; a
  session adds it (with the fingerprint re-pin), and it ships at the next Section 4 deploy.
- **288:** the warning when someone moves a work item whose card is archived is not built.
- **313:** the five sample bridge routines are applied but not pinned in the deploy preflight.
- **314:** the six urgent-ping refusal codes are not recordable in the failed-saves log.
- **Sample Review — Upsert in n8n:** find what still calls it (729 runs since 2026-10-02).
- **Four old functions** (`calendar-reorder`, `caption-prompts-save`, `templates-save`,
  `kasper-ad-performance-read`) were deployed within an hour of their last change in July and
  August; only a byte check settles them, which needs a Management token. Nothing in the ledger
  waits on them.

## Keeping it visible

`scripts/repo-vs-live.js` prints, for every function, database change and switch on the shelf,
what the repo says next to what is live: `LIVE`, `WAITING`, `HELD` (you chose to wait),
`NOT MEASURED` (a secret or a Google setting it cannot read) or `CHECK BYTES`.

- With a Management token in `SUPABASE_ACCESS_TOKEN` it reads live itself and compares function
  bytes with the deploy lanes' own attestor.
- A session without one passes readings it took itself: `--live-json=<file>`.
- It prints only yes/no answers and counts, never a name, an email or a key.
- The shelf it checks is `scripts/repo-vs-live-shelf.json`. A session that builds something
  waiting on you adds one row there in the same pull request.
