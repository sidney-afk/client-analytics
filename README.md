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
  graphics sent to Tweaks Needed; see `docs/features/THUMBNAIL_REVISION_HISTORY.md`.
- **YouTube title review** — title status plus tweak-round tracking.
- **Client onboarding** — in-app onboarding form and inbox (standard and AI funnels).
- **Sales intake** — subtab of the Kasper tab, filled right after a deal closes;
  submitting logs the intake to Supabase, creates the Sales & Service Agreement
  on eSignatures.com, and sends the client one combined email with the signing
  link + Stripe payment link. See `docs/features/SALES_INTAKE_DESIGN.md`.
- **SMM weekly reports** — hidden weekly form for social media managers and a
  read-only Kasper viewer grouped by week and SMM. See `docs/features/SMM_WEEKLY_REPORTS.md`.
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
   SMM weekly reports, title review, the workload cache, and the TikTok pilot. Reads come straight from the
   Supabase REST API; updates arrive over realtime channels (no polling — an idle tab
   makes no calls). The browser uses a committed publishable (anon) key; row-level
   security permits anonymous `SELECT` only — writes go through n8n or
   Supabase Edge Functions using service-role credentials.
2. **n8n** (`synchrosocial.app.n8n.cloud`) — the write / integration layer. Webhooks
   handle saves, reorders, onboarding submissions, SMM roster sync/reminders, and the Linear ⇄ Supabase sync.
   Writers also dual-write to Google Sheets, so the Sheet stays a human-readable mirror
   and a lossless rollback path.
3. **Google Sheets** (via the `gviz` CSV endpoint) — still the source of truth for the
   **analytics** data that was never migrated: Metrics, Clients Info, TopVideos,
   Competitor / Market-Research Briefs, ContentSummaries, FilmingPlans, and the
   Social-Media-Manager map.

> **Migration history:** the calendar and samples features were moved from Google Sheets
> to Supabase (dual-write → hidden flag → flip-default) in June 2026. For those features
> the Sheet now survives only as an automatic fallback if Supabase is unreachable; for
> analytics it remains the live source. See `docs/archive/CALENDAR_REALTIME_MIGRATION.md`,
> `docs/archive/SAMPLES_SUPABASE_KICKOFF.md`, and the current source of truth `docs/archive/AUDIT_2026-06-15.md`.

## Repository layout

The full annotated map lives in **`REPO_MAP.md`** (enforced by
`test/repo-map-sync.js`, so it cannot go stale). The short version:

| Path | What it is |
|---|---|
| `index.html` | The entire application. |
| `test/` | Fast, offline unit/wiring tests that extract and exercise pieces of the inline script. Run with `npm test`. |
| `qa/` | Headless (Playwright) end-to-end probes against the live backend. Run with `npm run test:e2e`. |
| `scripts/` | CI reconcile jobs (Linear ⇄ calendar/samples) and tested one-shot ops tools. |
| `.github/workflows/` | CI: unit tests on every push, nightly E2E, the Production polish gate, and reconcile crons. |
| `migrations/` | One-time, **manually applied** Supabase SQL-editor migrations, kept for provenance — there is no auto-runner. See `migrations/README.md`. |
| `supabase/` | Supabase CLI config + Edge Function sources (path-triggered deploys). |
| `n8n-backups/` | Point-in-time snapshots of the n8n workflows (rollback anchors). |
| `docs/features/` | Living design/spec doc for each shipped feature. |
| `docs/ops/` | Runbooks: new-client onboarding, reconcile safety net, monitoring. |
| `docs/independence/` | The active independence program (Track A/B specs and plan). |
| `docs/testing/` | Test catalog, headless-testing guide, prod-polish automation. |
| `docs/archive/` | Completed migrations, superseded plans, old audits and QA reports. |
| `docs/syncview-design/` | The locked Production-tab design kit + its wired test gates. |
| `ROLLBACK.md`, `EXECUTION_LOG.md` | The rollback doctrine and the running execution log — kept at root on purpose. |

## Development

No build step. Open `index.html` in a browser, or serve the folder statically.

```bash
npm install        # installs Playwright (only needed for the E2E probes)
npm test           # offline unit/wiring suite — no network; run before every commit
npm run test:e2e   # headless end-to-end probes (these hit the live backend)
npm run test:prod-polish  # full Production polish gate for ?prod=1 UI work
```

## Deployment

GitHub Pages serves `index.html` from `main` at the `CNAME` domain
(`syncview.synchrosocial.com`). Merging to `main` ships to production immediately.
Samples Old retains a dormant read-source selector at `?sv2=0`; it is neither a current route nor a
writable recovery. Its old writer fans out to Sheet + Supabase, continues after a Sheet error, and
anchors success on the Supabase branch, so a successful save can still be absent from the Sheet that
sticky-off/automatic-fallback readers use (F57). **Do not use Calendar `?v2=0` as writable rollback
either (F125):** it reads the legacy Sheet while full-roster writes/reorders go only to Supabase, so
successful work can disappear on refresh or stale Sheet state can overwrite canonical fields. Until
coupled recovery ships, treat either legacy read mode as read-only and escalate.

A deploy also does **not** expire old tabs (F127). The current ETag banner is absent in direct
Production, unreliable on onboarding aliases/cached first checks, and dismissible; protected calls
carry no build/authority epoch. Do not use banner absence as a stale-caller, auth, cutover, or rollback
gate. Mandatory releases need server-side minimum-build/epoch rejection plus privacy-safe population
proof and draft/queue-safe reload.

## Keeping this README current

Treat this README as part of the app: update it whenever the app's features, data
sources, or development / deployment steps change. A ready-made guard ships in
`.claude/hooks/readme-sync-reminder.sh` — once enabled as a `Stop` hook in
`.claude/settings.json`, it reminds you when a session changes `index.html` without
touching `README.md`.
