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
| `CLIENTS_URL` | Clients Info | Client roster for every screen: allowlist, client picker, share-link check, Calendar fast boot; `fetchEssentials()` | 74 KB | 0.32 s | Yes, same as Metrics. It is also the live client allowlist. | Mostly hand-edited. Onboarding: Append Client Row (webhook, on demand) upserts rows. Read by CLIENTS METRICS, TOP VIDEOS, MARKET RESEARCH. |
| `TOPVIDS_URL` | TopVideos | Per-client Analytics top videos; `fetchExtras()` | 16.08 MB | 2.88 s | Not for the overview (it no longer waits for it). Yes for a per-client Analytics page, which waits for all extras. | TOP VIDEOS (daily 04:00; Apify for Instagram and TikTok, YouTube API; appends rows, never deletes) |
| `BRIEFS_URL` | Competitor Briefs | Per-client Brief tab; `fetchExtras()` | 243 KB | 0.44 s | Per-client pages only | Unknown. No current n8n workflow was found that writes this tab. Older docs mention a COMPETITOR RESEARCH job, but no workflow by that name exists today. |
| `MR_BRIEFS_URL` | Market Research Briefs | Per-client Brief tab; `fetchExtras()` | 790 KB | 0.52 s | Per-client pages only | MARKET RESEARCH (scheduled; Apify Instagram and TikTok search; append-or-update) |
| `CONTENT_SUMMARIES_URL` | ContentSummaries | Per-client content summary bullets; `fetchExtras()` (optional, failure tolerated) | 3.7 KB | 0.43 s | No (optional) | MARKET RESEARCH (daily 06:00 branch; reads TopVideos, append-or-update) |
| `KASPER_SMM_URL` | Social Media Managers | Review queue: which manager owns each client; `_kasperLoadSMMMap()` | 1.8 KB | 0.43 s | Not the first card, but manager names fill in after it lands | Hand-edited. Onboarding: Append Client Row also upserts. SMM Reports: Manager Sync (daily 06:00) already COPIES it into Supabase `social_media_managers`. |

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
- No tables exist yet for Metrics, TopVideos, Competitor Briefs, Market
  Research Briefs or ContentSummaries. The migrations folder has no matches.

## 3. The plan, in three phases

The order is always: Supabase gets the data first, the site reads it second,
the Sheet is retired last. Scraping stays exactly where it is: n8n keeps
running on its schedules and keeps calling Apify and the YouTube API. Only
the place the results are stored changes.

### Phase 1: n8n writes to both Sheets and Supabase (dual-write)

What gets built:

1. One migration per dataset, creating these tables:
   `analytics_metrics`, `analytics_top_videos`, `analytics_competitor_briefs`,
   `analytics_market_research_briefs`, `analytics_content_summaries`, plus
   the missing roster columns on `clients` (or a companion
   `client_profiles` table) and per-client manager fields (or a
   `client_managers` table). Each table gets a `client_slug` column and an
   index on (`client_slug`, date) so a screen can ask for one client only.
2. Security, in the same migration:
   - Turn RLS on.
   - A read policy that lets the browser's publishable key SELECT only the
     columns the site shows. Anything sensitive stays in a separate
     service-only table.
   - Because Supabase gives `service_role`, `anon` and `authenticated` full
     rights on every new object by default, the migration must first
     `revoke all ... from public, anon, authenticated, service_role`
     (all four named) on each table and sequence, then grant back only
     SELECT to `anon` and `authenticated`, and INSERT/UPDATE to the one writer
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
MARKET RESEARCH, Onboarding: Append Client Row, and whichever job writes
Competitor Briefs once found.

Risks: the n8n edit breaks a production job; the Supabase write silently
fails and the two copies drift; a wrong grant exposes a column.
Rollback: disable or delete the added n8n node (the Sheet write never
changed); drop the new tables. Nothing the site reads has changed yet, so
users see no difference.

### Phase 2: the site reads Supabase, behind a flag, with the Sheet as fallback

One runtime flag per dataset, for example `analytics_source_metrics =
'sheets' | 'supabase'`. When it says `supabase`, the site reads Supabase; if
that read fails, is empty, or is older than the Sheet, it falls back to the
Sheet CSV and logs why. Code goes in `src/index/*.part` and is built with
`npm run build:index` as usual.

Switch order (most blocking and smallest first):

1. **Metrics + Clients Info together.** They gate the Analytics overview and
   the client share-link check, so they give the biggest first-paint win and
   are the most important to get right. Clients Info is also the allowlist,
   so the share-link check must give the same answer from both sources
   before the flag flips.
2. **Social Media Managers.** Tiny, and half done already.
3. **ContentSummaries**, then **Market Research Briefs**, then **Competitor
   Briefs**. Small, per-client, low risk.
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

1. Run each dataset on Supabase for at least two weeks. A daily comparison
   (script or scheduled check) counts rows per client per day in both
   sources and reports any difference.
2. When a dataset has been clean for the whole period, remove its Sheet
   fallback code, then (with owner approval) remove the Sheet write node from
   n8n. The Sheet tab is kept read-only as an archive, not deleted.
3. Update `docs/CLIENT_LIFECYCLE_MAP.md` and the weekly backup job so
   backups cover the new tables.

Risks: something else still reads a Sheet tab (a human, a report, another
workflow such as MARKET RESEARCH reading TopVideos and Clients Info).
Rollback: re-enable the Sheet write node and the fallback code from git
history; the archived tab still holds history up to the switch.

## 4. What the owner must decide

1. Approve Phase 1 n8n edits, one workflow at a time.
2. Who writes Competitor Briefs today? No workflow was found. If it is manual
   or retired, should the tab move at all, or be frozen as-is?
3. Should Clients Info stay hand-edited in the Sheet for now (n8n copies it
   to Supabase daily), or should editing move into SyncView itself?
4. How much TopVideos history the site needs (for example the last 90 days),
   so old rows can stay in the archive.
5. How long the parity period is (two weeks proposed).

## 5. Checks before each step

- `node scripts/repo-identity-exposure-check.js --diff="origin/main"` on
  every PR (public repo: no client names, slugs or sheet IDs).
- Migrations: prove each of the four roles' rights with a query, not by
  reading the revoke line.
- Site changes: run `node docs/syncview-design/tests/prod-boot-budget.js`
  and compare first paint before and after each flag flip.
