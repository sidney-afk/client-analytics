# SyncView

SyncView is the internal client-operations dashboard for Synchro Social — a single-page
web app for running the content pipeline end to end: planning the content calendar,
reviewing samples and thumbnails, tracking YouTube title review, handling client
onboarding, and keeping everything in sync with Linear.

**Live:** <https://syncview.synchrosocial.com> — served via GitHub Pages from `index.html` on `main`.

## What it does

- **Content calendar** — per-client posting calendar with per-component statuses
  (video / graphic / caption / title), drag-reorder, threaded comments, and live
  realtime updates.
- **Sample & thumbnail review** — Kasper and client approval flows for content samples.
- **Thumbnail revision history** — Drive-backed thumbnail change baselines for
  graphics sent to Tweaks Needed; see `THUMBNAIL_REVISION_HISTORY.md`.
- **YouTube title review** — title status plus tweak-round tracking.
- **Client onboarding** — in-app onboarding form and inbox (standard and AI funnels).
- **Sales intake** — subtab of the Kasper tab, filled right after a deal closes;
  submitting logs the intake to Supabase, creates the Sales & Service Agreement
  on eSignatures.com, and sends the client one combined email with the signing
  link + Stripe payment link. See `SALES_INTAKE_DESIGN.md`.
- **Workload view** — derived per-person workload, rebuilt from Linear.
- **Linear sync** — two-way status sync between the calendar and Linear issues.
- **Analytics** — follower/engagement metrics, top videos, and competitor /
  market-research briefs.

## Architecture

The entire front end is one file, `index.html` (~2 MB): an inline-`<script>` SPA with
no build step. A tiny **pre-paint boot gate** script in `<head>` re-derives the boot
mode (onboarding form, `?intake=1`, `?c=` client links, password gate, hash-tab
refresh) from the URL + storage before any body markup exists and tags `<html>`,
so the staff dashboard chrome never flashes on special entries; the app script lifts
each tag when its own routing takes over (the onboarding/intake tags are permanent,
like the body classes they anticipate). The app talks to three backends.

1. **Supabase** (Postgres + realtime) — the live operational store for everything that
   changes frequently: the content calendar, samples, onboarding, Kasper review state,
   title review, the workload cache, and the TikTok pilot. Reads come straight from the
   Supabase REST API; updates arrive over realtime channels (no polling — an idle tab
   makes no calls). The browser uses a committed publishable (anon) key; row-level
   security permits anonymous `SELECT` only — all writes go through n8n.
2. **n8n** (`synchrosocial.app.n8n.cloud`) — the write / integration layer. Webhooks
   handle saves, reorders, onboarding submissions, and the Linear ⇄ Supabase sync.
   Writers also dual-write to Google Sheets, so the Sheet stays a human-readable mirror
   and a lossless rollback path.
3. **Google Sheets** (via the `gviz` CSV endpoint) — still the source of truth for the
   **analytics** data that was never migrated: Metrics, Clients Info, TopVideos,
   Competitor / Market-Research Briefs, ContentSummaries, FilmingPlans, and the
   Social-Media-Manager map.

> **Migration history:** the calendar and samples features were moved from Google Sheets
> to Supabase (dual-write → hidden flag → flip-default) in June 2026. For those features
> the Sheet now survives only as an automatic fallback if Supabase is unreachable; for
> analytics it remains the live source. See `CALENDAR_REALTIME_MIGRATION.md`,
> `SAMPLES_SUPABASE_KICKOFF.md`, and the current source of truth `AUDIT_2026-06-15.md`.

## Repository layout

| Path | What it is |
|---|---|
| `index.html` | The entire application. |
| `test/` | Fast, offline unit/wiring tests that extract and exercise pieces of the inline script. Run with `npm test`. |
| `qa/` | Headless (Playwright) end-to-end probes against the live backend. Run with `npm run test:e2e`. |
| `scripts/` | The Linear ⇄ calendar reconcile job (`linear-sync-reconcile.js`). |
| `.github/workflows/` | CI: unit tests on every push, nightly E2E, and the 10-minute Linear reconcile cron. |
| `migrations/`, root `*.sql` | One-time, **manually applied** Supabase SQL-editor migrations, kept for provenance — there is no auto-runner. |
| `n8n-backups/` | Point-in-time snapshots of the n8n workflows (rollback anchors). |
| `docs/` | Test catalogs, the headless-testing guide, and archived handoff/incident notes under `docs/archive/`. |
| Top-level `*_DESIGN.md` / `*_MIGRATION.md` | Design specs and runbooks for individual features. |

## Development

No build step. Open `index.html` in a browser, or serve the folder statically.

```bash
npm install        # installs Playwright (only needed for the E2E probes)
npm test           # offline unit/wiring suite — no network; run before every commit
npm run test:e2e   # headless end-to-end probes (these hit the live backend)
```

## Deployment

GitHub Pages serves `index.html` from `main` at the `CNAME` domain
(`syncview.synchrosocial.com`). Merging to `main` ships to production immediately.
For the migrated features, per-browser rollback is available via `?v2=0` (calendar)
and `?sv2=0` (samples).

## Keeping this README current

Treat this README as part of the app: update it whenever the app's features, data
sources, or development / deployment steps change. A ready-made guard ships in
`.claude/hooks/readme-sync-reminder.sh` — once enabled as a `Stop` hook in
`.claude/settings.json`, it reminds you when a session changes `index.html` without
touching `README.md`.
