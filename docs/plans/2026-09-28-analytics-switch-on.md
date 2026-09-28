# Analytics on Supabase: parity, readers, measurements and the switch-on plan

2026-09-28. Follows `docs/plans/2026-09-24-sheets-to-supabase.md` (Phases 2
and 3, section 5 are the contract). Counts only: a client is named by a short
sha256 reference of its slug, never by name or slug (this repository is
public).

## 1. Parity report (measured live 2026-09-28, before any fix)

Every row compared by its fingerprint (the `row_hash` analytics-write stores),
grouped per client per day, Supabase against the Sheet.
Tool: `scripts/sheets-mirror-parity.js`. 36 active clients on Clients Info.

| Dataset | Groups compared | Match | Differ | What differs |
|---|---|---|---|---|
| Metrics (all history, client x day) | 5,060 | 4,953 | 107 | 107 rows missing in Supabase: 26 and 27 Sept for all 36 clients, 28 Sept for 35 |
| TopVideos (last 90 days, client x day) | 2,735 | 2,663 | 72 | 601 rows missing in Supabase: 26 and 27 Sept, all 36 clients |
| ContentSummaries | 1 | 1 | 0 | none |
| Market Research Briefs (client x brief) | 13 | 13 | 0 | none |
| Clients Info (client profile) | 36 | 36 | 0 | none |
| Social Media Managers (client to manager) | 41 | 41 | 0 | Supabase does not keep the Slack profile link (41 of 41 rows have one in the Sheet) |

No value differs anywhere: every difference is a row Supabase does not have
yet. Causes:

- **Metrics, 26 to 28 Sept.** The CLIENTS METRICS "Mirror to Supabase" node
  sent only the test client until 14:15 UTC today, when it was switched to
  every client (owner go-ahead 2026-09-27). From tonight's run every client's
  row is mirrored; the three missing days are not.
- **TopVideos, 26 and 27 Sept.** TOP VIDEOS gained its mirror node on
  2026-09-27 (evening); its first mirrored run was 28 Sept. The two days before
  it were never copied.
- **Clients Info** matches today, but the plan's "copied once a day" job does
  not exist yet: the only copy is the 25 Sept backfill. It would drift the
  first time a client row is edited.
- **ContentSummaries and Market Research Briefs** match, but no n8n node
  mirrors them: a new brief would not reach Supabase. (The ContentSummaries
  writer is disabled in n8n, so that tab does not change today.)
- **Social Media Managers** is not part of the Analytics switch (only the
  review queue and n8n read it). Its Supabase copy lacks the Slack profile
  link, so the review queue cannot move off the Sheet yet. Its
  `linear_api_key` column is empty on every row.

**Fix (this PR):** a daily job, `.github/workflows/sheets-mirror-daily.yml`,
copies all six tabs through analytics-write (safe to repeat: rows are keyed by
fingerprint, so nothing already there is added twice) and then runs the
parity check, going red on any difference. Its first run fills the 26 to 28
Sept gap, and every later run covers Clients Info, the briefs and the
summaries until n8n mirrors them directly. It needs one secret and one
variable from the owner (section 5, step 3).

## 2. What this PR builds

- **Staff Analytics on Supabase.** `analytics-read` answers two new staff-only
  scopes: `overview` (every client's metrics and the roster) and `extras`
  (every client's top videos from the last 90 days, briefs and summaries).
  Rows come as one header plus arrays, gzipped when the browser accepts it.
  The page uses them when the flag says `"enabled": true` (everyone) or
  `"staff": true` (staff only, for trying it first). It falls back to the
  Sheets on a failed read, a timeout (10 s overview, 20 s extras), no complete
  whole-dataset copy, or a metrics copy older than 3 days. The answer is
  turned back into the Sheet's CSV shape, so the parse, the saved copy and the
  change detection are the same code as today.
- **Daily comparison check** (Phase 3 step 1): `scripts/sheets-mirror-parity.js`
  and the daily lane above.
- **Catch-up job** (Phase 3 rollback): `scripts/sheets-mirror-catchup.js`
  appends the rows Supabase has and a Sheet tab lacks, in the tab's own column
  order, and adds nothing on a second run. It refuses the live Sheet unless
  told `--production`, so it is rehearsed on a copy first.
  **Rehearsed 2026-09-28 on a copy of the Metrics tab:** 20 to 22 Sept (108
  rows) removed from the copy; the catch-up, reading the live Supabase rows,
  found exactly those 108; after appending them the copy matched the original
  in all 5,060 client-day groups; a second run found 0. Not yet rehearsed: the
  write into a real Google spreadsheet (needs a service account with edit
  access to a Drive copy; section 5, step 7).
- **Index migration** `migrations/2026-09-28-sheets-mirror-staff-read-index.sql`
  (NOT APPLIED).
- Tests: `test/sheets-mirror-parity-catchup.js` (offline, 11 checks) and four
  staff cases in `docs/syncview-design/tests/analytics-mirror-read-browser.js`.

## 3. Every other reader of these tabs, and the n8n change each needs

Read-only survey of 71 of 119 workflows on 2026-09-28 (the other 47 are sales,
hiring, calendar-helper and music workflows by name; BACKUPS could not be
opened over MCP). Nothing was edited.

**Metrics.** CLIENTS METRICS reads its own previous rows ("Get Previous Rows")
to compute daily gains, and appends ("Write to Sheet").
Change needed before the Metrics tab can stop being written: "Get Previous
Rows" must read the previous rows from Supabase. That needs a read path n8n
can use (today n8n holds only the mirror WRITE key); proposal: an
`analytics-read` scope for the mirror key that returns each client's latest
row. Then the Sheet write goes behind a switch (plan Phase 3 step 3).

**TopVideos.** TOP VIDEOS appends ("Write to TopVideos Sheet") and already
mirrors every client. Readers: MARKET RESEARCH "Get All Top Videos1"
(disabled) and Weekly Slack Top Reel plus its TEST copy (both inactive).
Change needed: none while they stay off; if either is switched back on, it
must read Supabase first.

**Market Research Briefs.** MARKET RESEARCH saves each brief
("Append or update row in sheet", `generate-market-brief` webhook).
Change needed: a mirror node after it sending the saved row to analytics-write
(dataset `market_research_briefs`, keyed by brief id). Until then the daily
copy carries new briefs within a day.

**ContentSummaries.** Its only writer (MARKET RESEARCH, daily 06:00 branch) is
disabled. Change needed: none today; if re-enabled, add a mirror node like the
briefs one.

**Clients Info** (stays hand-edited in the Sheet, owner decision 2026-09-25;
not retired). Readers: CLIENTS METRICS, TOP VIDEOS, MARKET RESEARCH (gviz),
Slack Creative Channel Finalizer (reads and writes `creative_channel_id`),
Content Ready Notify (reads one client's email). Writer: Onboarding Append
Client Row. Change needed: none now; the daily copy keeps Supabase in step.
The Creative Channel Finalizer's write and Onboarding's upsert would each need
a Supabase write before the Sheet stopped being the main copy.

**Social Media Managers** (not part of this switch). Readers: SMM Reports
Manager Sync, Creative Channel Finalizer, VIDEO PRODUCTION (three gviz reads),
and the review queue in the page. Writer: Onboarding Append Client Row.
Change needed before it moves: Manager Sync must also copy the Slack profile
link, then each reader switches in turn.

**Human readers:** unknown; the owner to confirm who opens these tabs.
**Seen in passing:** several n8n nodes carry pasted credentials in their
parameters (a caption generator, an editors workload report, a sales contract
webhook). Values left out here; they belong in n8n credentials.

## 4. Measurements on the test client (live, 2026-09-28, cloud sandbox)

| Path | Before (Sheets) | After (Supabase) |
|---|---|---|
| Client link, all its data | numbers 553 ms / 2.89 MB, then extras 2,967 ms / 17.05 MB (median of 5); the page waits for both | one call: median 427 ms, 90 KB (first call 923 ms) |
| Staff overview (numbers + roster) | median 553 ms, 2.89 MB (283 KB as sent) | database work 22 ms; answer 2.91 MB, 284 KB gzipped: about the same bytes, not faster |
| Staff per-client pages (videos, briefs, summaries) | median 2,967 ms, 17.05 MB (4.19 MB as sent) | answer 8.7 MB, 2.28 MB gzipped (90 days only), 46% fewer bytes sent |

The staff "after" column is the size of the answer built from today's rows
exactly as `analytics-read` shapes it, plus the database's own query time. The
live round trip cannot be measured until `analytics-read` is deployed and a
staff key is used:
`SYNCVIEW_STAFF_KEY=... node scripts/sheets-mirror-read-timing.js --scope=overview`
(and `--scope=extras`). A whole-page timing in the sandbox browser was not
usable: its other flag reads fail there on the network, as on main.

## 5. Switch-on plan (in plain English)

Nothing below has been done; each step is the owner's.

1. **Deploy** `analytics-read` from this PR through "Deploy one allowlisted
   Edge Function"
   (https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml),
   pasting main's commit SHA after the merge. Nothing changes for anyone: staff only use the new answers
   when the flag says so.
2. **Apply** `migrations/2026-09-28-sheets-mirror-staff-read-index.sql`.
3. **Turn on the daily copy.** In GitHub, Settings, Secrets and variables,
   Actions: add the secret `ANALYTICS_MIRROR_WRITE_KEY` (the same value as the
   Supabase secret of that name) and the variable `SHEETS_MIRROR_COPY_APPLY`
   = `true`. Then run "Sheets mirror daily copy and parity" once by hand with
   "apply" ticked:
   https://github.com/sidney-afk/client-analytics/actions/workflows/sheets-mirror-daily.yml Good result: green, the log ends `PARITY: clean`.
4. **Staff trial.** Set the flag to
   `{"enabled": false, "clients": ["<test client slug>"], "staff": true}`.
   Staff open Analytics and a client page; the browser console says
   `analytics database overview read in ... ms` with nothing after it.
5. **Wait 3 days** (owner decision) with the daily lane green.
6. **Switch on for everyone:** set the flag to `{"enabled": true}`, one
   statement in the Supabase SQL editor:
   `update public.syncview_runtime_flags set value = '{"enabled": true}' where key = 'analytics_mirror_read_enabled';`
   It takes effect on each person's next page load; no deploy.
7. **Before any Sheet write is switched off** (later, Phase 3): rehearse the
   catch-up's real write on a Drive copy of the Sheet with a service account
   that can edit it:
   `GOOGLE_CREDENTIALS_JSON=... node scripts/sheets-mirror-catchup.js --dataset=metrics --since=<date> --sheet-id=<copy id> --apply`,
   then run it again (it must report 0 missing).

**Rollback, one step:** set the flag back to
`{"enabled": false, "clients": ["<test client slug>"]}`. Every page reads the
Sheets again on its next load. The Sheets are still written by n8n every day,
so nothing is lost and nothing needs copying back.

**What to look at afterwards:**
- The daily lane "Sheets mirror daily copy and parity" stays green.
- The morning numbers appear after CLIENTS METRICS (about 05:15 UTC), as they
  do today.
- The browser console on a client link and on the overview shows the database
  read, not "using the Sheets". Any fallback message names its reason.
- A client link opens its Analytics in well under a second.
