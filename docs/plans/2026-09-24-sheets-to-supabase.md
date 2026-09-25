# Plan: move the data SyncView reads from Google Sheets to Supabase

Date: 2026-09-24. Status: PLAN ONLY. This document changes no code, no
database, and no n8n workflow.

## Why

Parts of SyncView (mainly the Analytics screens and the review queue's
manager lookup) still download whole Google Sheets as CSV files every time
someone opens the site. CSV is a plain text spreadsheet export. The biggest
one, TopVideos, is about 16 MB and holds every client's rows, so every
visitor downloads all of it just to see one client. Supabase (our Postgres
database, which already holds the Calendar, Samples and Production data) can
send back only the rows a screen needs, can be secured row by row, and does
not depend on Google's CSV export staying fast.

A few terms used below:

- **n8n**: the automation tool that runs our scheduled jobs (scraping,
  writing sheets).
- **Apify**: the scraping service n8n calls to read public Instagram and
  TikTok data.
- **Dual-write**: n8n writes the same row to the Sheet AND to Supabase, so
  both stay identical while we compare them.
- **Publishable key**: the public, read-only key the browser uses to talk to
  Supabase.
- **RLS (row level security)**: database rules that decide which rows a
  given key may read or write.
- **Runtime flag**: an on/off switch stored in the existing
  `syncview_runtime_flags` table. The site reads it at load time, so we can
  flip a data source without a code deploy.
- **First paint**: the moment the screen first shows real content.

## 1. Inventory

Every sheet is a tab of one Google Sheet document (the SYNCVIEW sheet). All
are read with the Google "gviz" CSV export. The document ID is deliberately
not written here because this repository is public; it lives in
`src/index/040-shared-briefs.js.part` as `SHEET_ID`.

Size and read time: median of 3 downloads each, measured 2026-09-24 from a
cloud sandbox (not a home connection, so treat times as relative, not
absolute). All 21 downloads returned HTTP 200 on the first try.

| Constant | Tab | Screen / function that reads it | Size | Read time | Blocks first paint? | n8n writer |
|---|---|---|---|---|---|---|
| `METRICS_URL` | Metrics | Analytics overview and per-client Analytics; `fetchEssentials()` | 2.68 MB | 0.64 s | Yes. The staff Analytics overview waits for it (a saved copy is shown first if one exists). Client share links always wait for it. | CLIENTS METRICS (daily; Apify for Instagram and TikTok, YouTube API; appends rows) |
| `CLIENTS_URL` | Clients Info | Client roster for every screen: allowlist, client picker, share-link check, Calendar fast boot; `fetchEssentials()` | 74 KB | 0.32 s | Yes, same as Metrics. It is also the live client allowlist. | Mostly hand-edited. Onboarding: Append Client Row (live; runs on each client onboarding, owner confirmed 2026-09-24) upserts rows. Read by CLIENTS METRICS, TOP VIDEOS, MARKET RESEARCH. |
| `TOPVIDS_URL` | TopVideos | Per-client Analytics top videos; `fetchExtras()` | 16.08 MB | 2.88 s | Not for the overview (it no longer waits for it). Yes for a per-client Analytics page, which waits for all extras. | TOP VIDEOS (daily 04:00; Apify for Instagram and TikTok, YouTube API; appends rows, never deletes) |
| `BRIEFS_URL` | Competitor Briefs | **Retiring, not migrating.** The competitor brief generators were removed on 2026-09-24 (#1590); the site stopped downloading it in #1615 | 243 KB | 0.44 s | Per-client pages only | None. Owner confirmed 2026-09-24 the tab is retired. |
| `MR_BRIEFS_URL` | Market Research Briefs | Per-client Brief tab; `fetchExtras()` | 790 KB | 0.52 s | Per-client pages only | MARKET RESEARCH (scheduled; Apify Instagram and TikTok search; append-or-update) |
| `CONTENT_SUMMARIES_URL` | ContentSummaries | Per-client content summary bullets; `fetchExtras()` (optional, failure tolerated) | 3.7 KB | 0.43 s | No (optional) | MARKET RESEARCH (daily 06:00 branch; reads TopVideos, append-or-update) |
| `KASPER_SMM_URL` | Social Media Managers | Review queue: which manager owns each client; `_kasperLoadSMMMap()` | 1.8 KB | 0.43 s | Not the first card, but manager names fill in after it lands | Hand-edited. Onboarding: Append Client Row (live) also upserts. SMM Reports: Manager Sync (daily 06:00) already COPIES it into Supabase `social_media_managers`. |

Sum: about 19.9 MB per full load, of which TopVideos is 81 percent.

Other Sheet tabs n8n writes that the site does NOT read directly (out of
scope, listed so nobody is surprised): PostTracking (CLIENTS METRICS) and
Hook Library (MARKET RESEARCH).

## 2. What already exists in Supabase

- `clients` table (slug, display name, kind, active). The browser already
  reads it with the publishable key (Calendar templates code). It does not yet
  carry every Clients Info column (handles, competitors, keywords, Slack
  channel, and so on).
- `social_media_managers` table, filled daily from the sheet by the
  `smm-weekly-reports` Edge Function (called by SMM Reports: Manager Sync).
  It stores managers with their client list, not the per-client Slack ids the
  review queue uses.
- `syncview_runtime_flags` table, already used for several site switches.
  Reuse it for the new data-source flags.
- No tables exist yet for Metrics, TopVideos, Market Research Briefs or
  ContentSummaries. The migrations folder has no matches.

## 3. The plan, in three phases

The order is always: Supabase gets the data first, the site reads it second,
the Sheet is retired last. Scraping stays exactly where it is: n8n keeps
running on its schedules and keeps calling Apify and the YouTube API. Only
the place the results are stored changes.

### Phase 1: n8n writes to both Sheets and Supabase (dual-write)

**Status, 2026-09-25: database side built, not applied.** One PR adds
`migrations/2026-09-25-sheets-mirror-phase1.sql` (source-only; Lighthouse
applies it), the `analytics-read` and `analytics-write` Edge Functions (not
deployed, not used by the page), `scripts/sheets-mirror-backfill.js`,
`scripts/sheets-mirror-read-timing.js`, and two tests: an offline contract
(`test/sheets-mirror-policy.js`) and a role test that measures public, anon,
authenticated and service_role against every new table on a real PostgreSQL
(`test/sheets-mirror-roles-postgres.js`, its own isolated PG17 CI lane). No
n8n workflow was edited. What was built, and where it differs from the
sketch below:

- **Tables:** `client_profiles`, `analytics_metrics`, `analytics_top_videos`,
  `analytics_market_research_briefs`, `analytics_content_summaries`, and
  `analytics_ingest_receipts` (one row per write call, used for the
  "empty but complete" rule in Phase 2). Social Media Managers is not in this
  step: it already has its own daily copy.
- **Row identity (changed from the sketch):** there is no natural key. The
  Sheets hold exact duplicate rows and also several different rows for the
  same client and day (measured 2026-09-25: Metrics 14 exact duplicates and
  111 client-days with differing rows; TopVideos 3,994 and 490). A key like
  (client, platform, period, rank, date) would silently drop real rows. Each
  row is keyed instead by a fingerprint of its values plus how many identical
  rows came before it, so every Sheet row survives, a retried write never
  doubles, and the backfill can run after n8n starts writing without
  double-counting.
- **Access:** RLS on, no policies, every privilege revoked from all four roles,
  then SELECT/INSERT/UPDATE to service_role only (no DELETE, no TRUNCATE, no
  sequence rights). The role test shows public, anon and authenticated
  denied everything on all six tables.
- **Writer:** `analytics-write`, with its own secret
  (`ANALYTICS_MIRROR_WRITE_KEY`) and a default-off flag
  (`analytics_mirror_write_enabled`). n8n will call it; so does the backfill.
- **Reader:** `analytics-read` (owner decision 6, below): a staff role key or
  the client's own link token, one client's rows, TopVideos from the last 90
  days only. Staff reads work while `analytics_mirror_read_enabled` is off, so
  parity and timing can be checked first; client-link reads need the flag.
  A client link gets only its name and public handles from the profile,
  never email or Slack/Roam channel ids.

**Order to switch it on (Lighthouse):** apply the migration; set the
`ANALYTICS_MIRROR_WRITE_KEY` secret (32+ characters) and deploy both
functions; turn `analytics_mirror_write_enabled` on; run
`node scripts/sheets-mirror-backfill.js` (dry run) then `--apply`; run
`node scripts/sheets-mirror-read-timing.js` for the live timing. The n8n
dual-write nodes come after, one workflow at a time, each with the owner's
go-ahead.

**Measured 2026-09-25 (before anything is deployed):**

| | Today: all Sheets, all clients | Supabase read, one client |
|---|---|---|
| Bytes | 19,743,336 (5 tabs) | ~90 KB for the test client; ~0.9 MB for the largest client |
| Time | median 3.7 s (3.5 to 4.1 s, 5 runs, tabs in parallel, cloud sandbox) | database work ~1 ms (test client), ~2 ms (largest client) |

The Supabase side is the database query time on a local PostgreSQL loaded
with the real Sheet rows, plus the response size. The live function adds a
network round trip and the Edge Function start, which cannot be measured
until it is deployed; `scripts/sheets-mirror-read-timing.js` measures both
sides on the same machine once it is. The size difference is the part that
does not depend on the network: one client's data is about 0.5% to 5% of
today's download.

The original sketch, kept for reference:

1. One migration per dataset, creating these tables:
   `analytics_metrics`, `analytics_top_videos`,
   `analytics_market_research_briefs`, `analytics_content_summaries`, plus
   the missing roster columns on `clients` (or a companion
   `client_profiles` table) and per-client manager fields (or a
   `client_managers` table). Each table gets a `client_slug` column and an
   index on (`client_slug`, date) so a screen can ask for one client only.
2. Security, in the same migration:
   - Turn RLS on.
   - Important limit: the publishable key is shared by every visitor, so an
     RLS policy for it cannot keep one client from reading another client's
     rows. Anyone can change `client_slug` in the request. So either:
     (a) **recommended, and needed for client share links:** serve the data
     through an Edge Function (a small server program) that checks the staff
     session or the client's review token and returns only that one client's
     rows and columns; the tables themselves then grant the browser nothing;
     or (b) grant the publishable key SELECT on a column list the owner has
     written down as intentionally public to all visitors.
     This is an owner decision (see section 4). Anything sensitive stays in a
     separate service-only table either way.
   - Because Supabase gives `service_role`, `anon` and `authenticated` full
     rights on every new object by default, the migration must first
     `revoke all ... from public, anon, authenticated, service_role`
     (all four named) on each table and sequence, then grant back only
     what option (a) or (b) needs (SELECT to `anon` and `authenticated`
     only under option (b)), and INSERT/UPDATE to the one writer
     role. A test then measures each of the four roles, instead of assuming.
3. A small write path for n8n: an Edge Function (or reuse of the pattern in
   `smm-weekly-reports`) that takes a batch of rows with a staff key and
   upserts them. Upsert means "insert or replace the same row", so a re-run
   never creates duplicates. Each row gets a natural key, for example
   (client, platform, period, rank, scraped date) for TopVideos.
4. A one-time backfill that copies today's Sheet rows into the new tables.
5. The n8n change itself: add ONE extra node after each existing "write to
   sheet" node that sends the same rows to Supabase, set to "continue on
   error" so a Supabase outage can never break the Sheet write.

**The owner must approve every n8n edit in the same request that makes it.
This document edits none.** Workflows affected: CLIENTS METRICS, TOP VIDEOS,
MARKET RESEARCH, and Onboarding: Append Client Row. Append Client Row is
live and runs during every client onboarding, writing the Clients Info and
Social Media Managers tabs, so its dual-write must cover both tabs and be
tested on the test client before it is switched on.

Risks: the n8n edit breaks a production job; the Supabase write silently
fails and the two copies drift; a wrong grant exposes a column.
Rollback: disable or delete the added n8n node (the Sheet write never
changed); drop the new tables. Nothing the site reads has changed yet, so
users see no difference.

### Phase 2: the site reads Supabase, behind a flag, with the Sheet as fallback

One runtime flag per dataset, for example `analytics_source_metrics =
'sheets' | 'supabase'`. When it says `supabase`, the site reads Supabase.
It falls back to the Sheet CSV (and logs why) ONLY when the read failed or is
shown to be incomplete. To tell the difference, every write batch records a
small receipt (dataset, run time, clients covered, row count), and the site
checks the latest receipt. An empty result for one client, backed by a fresh
and complete receipt, is a real answer ("no rows") and is shown as such; it
never triggers the fallback. Code goes in `src/index/*.part` and is built with
`npm run build:index` as usual.

Switch order (most blocking and smallest first):

1. **Metrics + Clients Info together.** They gate the Analytics overview and
   the client share-link check, so they give the biggest first-paint win and
   are the most important to get right. Clients Info is also the allowlist,
   so the share-link check must give the same answer from both sources
   before the flag flips.
2. **Social Media Managers.** Tiny, and half done already.
3. **ContentSummaries**, then **Market Research Briefs**. Small,
   per-client, low risk. Competitor Briefs is not migrated (see Retiring
   now, below).
4. **TopVideos last.** At 16 MB it is the biggest win but needs a real
   change in how it is read: the site must ask for ONE client's rows (and
   only recent periods), filtered on the server, instead of downloading all
   clients. That turns a 16 MB download into a few KB per page. The saved
   local copy (`_analyticsCacheWrite`) must also stop storing the whole
   table.

Risks: numbers differ between sources (column names, number formats, dates,
the "No new posts" placeholder rows); a slow Supabase read makes paint worse;
the share-link check changes who can see what. Rollback: flip the flag back to
`sheets`. No deploy needed, and the Sheets are still being written.

### Phase 3: parity period, then retire the Sheets

1. Run each dataset on Supabase for at least **3 days** (owner decision
   2026-09-25; the sketch said two weeks). A daily comparison
   (script or scheduled check) counts rows per client per day in both
   sources and reports any difference.
2. Move every OTHER reader of the tab first. The site is not the only
   reader: MARKET RESEARCH, TOP VIDEOS and CLIENTS METRICS read Clients
   Info, CLIENTS METRICS reads its own previous Metrics rows, and the
   ContentSummaries branch of MARKET RESEARCH reads TopVideos. For each such
   reader: switch it to read Supabase (owner-approved n8n edit), run both
   side by side, and compare its outputs until they match. A tab's writer is
   not retired until every reader of that tab has passed this check. Also ask
   the owner about human readers (people or reports opening the Sheet).
3. When a dataset and all its readers have been clean for the whole period,
   stop writing to the Sheet with a SWITCH, not by deleting the node: the
   n8n Sheet write stays in place behind an on/off setting for the rest of
   Phase 3. Then remove the site's Sheet fallback code. The Sheet tab is kept
   read-only as an archive, not deleted.
4. Only after the owner signs off the whole move are the switched-off Sheet
   write nodes removed.
5. Update `docs/CLIENT_LIFECYCLE_MAP.md` and the weekly backup job so
   backups cover the new tables.

Risks: something else still reads a Sheet tab (a human, a report, another
workflow such as MARKET RESEARCH reading TopVideos and Clients Info).
Rollback: Metrics and TopVideos only ever add rows, so simply turning the
Sheet write back on would leave a gap for the days it was off. Rollback is
therefore: (1) turn the Sheet write switch back on, (2) run a catch-up job
that copies every Supabase row written since the switch-off into the Sheet,
using the same natural keys so nothing is doubled, (3) check row counts per
client per day match, and only then (4) restore the site's Sheet fallback
code. This catch-up job is written and rehearsed on a copy of the Sheet
BEFORE any Sheet write is switched off.

## Retiring now: Competitor Briefs

The owner retired competitor briefs on 2026-09-24 (#1590 removed the
generators). The tab is not migrated. Separate from the phases above:

1. Done in #1615: the site no longer downloads `BRIEFS_URL` (243 KB and one
   request off every per-client page) and the Brief tab no longer shows it.
2. Leave the tab in the Sheet, frozen, as an archive. Nothing writes it.
3. Delete it with the rest of the Sheet in Phase 3.

## 4. What the owner must decide

1. Approve Phase 1 n8n edits, one workflow at a time.
2. ~~Who writes Competitor Briefs?~~ Decided 2026-09-24: retired, not
   migrated (see Retiring now).
3. ~~Clients Info: Sheet or SyncView?~~ Decided 2026-09-25: it stays
   hand-edited in the Sheet for now and is copied to Supabase once a day,
   one way. The tables are built so SyncView can take over later (see
   "Later: a Clients admin tab").
4. ~~TopVideos history?~~ Decided 2026-09-25: the site gets the last 90 days
   only. Older rows stay stored in Supabase but are never downloaded.
5. ~~Parity period?~~ Decided 2026-09-25: 3 days, not two weeks.
6. ~~Security?~~ Decided 2026-09-25: the Edge Function option. It checks the
   staff session (role key) or the client's link token and returns only that
   client's rows. The tables grant the browser nothing.

## Later: a Clients admin tab (SyncView becomes the main copy)

The owner may later want a Clients tab in this version of SyncView where
client info is edited directly, with Supabase as the main copy. Phase 1 is
built so that switch is a setting, not a rebuild:

- `client_profiles` already has every Clients Info column as a real column
  (unknown extra Sheet columns land in `extra`), plus `source` ('sheet' or
  'syncview'), `updated_by`, `updated_at` and `archived_at`.
- The daily Sheet copy never overwrites a row whose `source` is 'syncview',
  and it stops entirely once the runtime flag `client_profiles_authority`
  reads `{"source": "syncview"}`. A client missing from the Sheet is archived,
  never deleted.

What the admin tab itself would still need, as a later step:

1. A staff-only write path: an Edge Function (or an action on
   `analytics-write` guarded by an admin role key, not the n8n secret) that
   edits one client's row, sets `source = 'syncview'`, `updated_by` to the
   verified staff member, and uses the row's `updated_at` as a version check
   so two people editing at once cannot overwrite each other silently.
2. An edit history table (who changed which field, from what, to what), the
   same way the other native writes in SyncView keep a ledger.
3. The tab: a list of clients with search, an edit form per client, add
   client, and archive client (never delete). Admin role only.
4. The switch-over: copy the Sheet one last time, flip
   `client_profiles_authority` to "syncview", make the Sheet tab read-only
   (or retire it), and move every other reader of Clients Info to Supabase
   first: the page (Phase 2), MARKET RESEARCH, TOP VIDEOS and CLIENTS METRICS
   in n8n, and the Onboarding: Append Client Row workflow, which would then
   write to Supabase instead of the Sheet.
5. Decide which client fields a client may see about themselves (today: name
   and public handles only), and keep review tokens out of this table
   (they stay in `client_access`).

## 5. Checks before each step

- `node scripts/repo-identity-exposure-check.js --diff="origin/main"` on
  every PR (public repo: no client names, slugs or sheet IDs).
- Migrations: prove each of the four roles' rights with a query, not by
  reading the revoke line.
- Site changes: measure the three Analytics entry paths before and after
  each flag flip: the staff Analytics overview, a staff per-client Analytics
  page, and a client share link. For each, record time to first real numbers
  and check the loading placeholders (skeletons) appear and clear correctly.
  The existing `prod-boot-budget.js` covers the Production tab, not
  Analytics, so it is not enough here.
