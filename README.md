# SyncView

**Current state (2026-09-26):** Staff work in SyncView, including the native Workload board. Linear is off: its Edge Functions are not deployed and its API keys were revoked on 2026-09-23. Older Linear-named source and records remain for history and compatibility. See [State of things](docs/STATE_OF_THINGS.md) for the dated live check.

SyncView is the internal client-operations dashboard for Synchro Social — a single-page
web app for running the content pipeline end to end: planning the content calendar,
reviewing samples and thumbnails, tracking YouTube title review, handling client
onboarding, and managing production work.

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
- **PTO / time off** — staff balances, requests, and a team absence calendar,
  plus an admin approval subtab in Kasper. The server-owned policy engine and
  locked HR tables live behind one Supabase Edge Function. The feature is live
  behind `pto_v1={"mode":"on"}`. Owner decision D-36 explicitly accepted launch
  under the current shared-role-key identity model; individually revocable staff
  sessions remain post-launch security hardening, not a launch prerequisite.
  See `docs/features/PTO_TRACKER.md`.
- **Workload view** — per-person workload from the native snapshot. Work
  that is terminal does not consume capacity: completed, canceled,
  triage and **duplicate** are all excluded, matching what the Production
  surface already treats as done.
- **Production / Sync** — native staff work on deliverables, including status,
  comments, due dates and assignments.
- **Analytics** — follower/engagement metrics, top videos, and competitor /
  market-research briefs.

## Architecture

The served front end is one file, `index.html`, assembled from ordered `src/index/`
fragments with `npm run build:index`. A tiny **pre-paint boot gate** script in
`<head>` re-derives the boot mode (onboarding form, `?intake=1`, `?c=` client links, password gate, hash-tab
refresh) from the URL + storage before any body markup exists and tags `<html>`,
so the staff dashboard chrome never flashes on special entries; the app script lifts
each tag when its own routing takes over (the onboarding/intake tags are permanent,
like the body classes they anticipate). The app talks to three backends.

1. **Supabase** (Postgres + realtime) — the live operational store for everything that
   changes frequently: the content calendar, samples, onboarding, Kasper review state,
   SMM weekly reports, title review, the workload cache, and the TikTok pilot. PTO is deliberately
   different: its live private membership, request, and adjustment tables allow no browser reads and
   are projected only through a role-key-authenticated Edge Function. D-36 accepts the residual
   same-role impersonation risk for this launch; individual identity binding remains a documented
   post-launch hardening item. Other reads come straight from the
   Supabase REST API; realtime channels and freshness polling update different
   surfaces. The browser uses a committed publishable (anon) key; row-level
   security controls direct table access, while privileged writes go through n8n or
   Supabase Edge Functions using service-role credentials.
2. **n8n** (`synchrosocial.app.n8n.cloud`) — webhooks and integrations for selected
   saves, onboarding, reminders and other workflows. The retired Linear sync is
   historical; see [State of things](docs/STATE_OF_THINGS.md) for current lane status.
3. **Google Sheets** (via the `gviz` CSV endpoint) — still serves selected
   analytics and profile reads: Metrics, Clients Info, TopVideos, Competitor /
   Market-Research Briefs, ContentSummaries, FilmingPlans, and the
   Social-Media-Manager map. The Supabase mirror write is on and backfilled, but
   mirror READ is off and its enrollment contains only the TEST client;
   `client_profiles_authority` remains `sheet`. See the dated
   [State of things](docs/STATE_OF_THINGS.md) before changing a read path.

> **Migration history:** Calendar and Samples moved from Google Sheets to Supabase
> in June 2026. `docs/archive/CALENDAR_REALTIME_MIGRATION.md` and
> `docs/archive/SAMPLES_SUPABASE_KICKOFF.md` describe that migration, not today's
> fallback contract. Use `docs/STATE_OF_THINGS.md` and `docs/truth/SHEETS.md`
> for current data-source status.

## Repository layout

The full annotated map lives in **`REPO_MAP.md`**. `test/repo-map-sync.js`
checks top-level entries, `docs/` subdirectories and eligible backticked paths; factual
status still needs the dated [State of things](docs/STATE_OF_THINGS.md). The short version:

| Path | What it is |
|---|---|
| `index.html` | The entire application. |
| `test/` | Classified unit, browser and disposable Postgres suites. `npm test` runs the unit lane and reports required isolated profiles separately. |
| `qa/` | Headless browser checks, including mocked rigs and live TEST-scope probes. `npm run test:e2e` runs probes against the live backend. |
| `scripts/` | Build tools, tests, read-only monitors and one-shot operator tools. |
| `.github/workflows/` | CI checks, nightly probes, monitoring and scoped Edge Function release workflows. |
| `migrations/` | One-time, **manually applied** Supabase SQL-editor migrations, kept for provenance — there is no auto-runner. See `migrations/README.md`. |
| `supabase/` | Supabase CLI config and Edge Function sources; release lanes vary by function. |
| `n8n-backups/` | Point-in-time snapshots of the n8n workflows (rollback anchors). |
| `docs/features/` | Feature contracts and plans, with status in each document. |
| `docs/ops/` | Runbooks: new-client onboarding, reconcile safety net, monitoring. |
| `docs/independence/` | Linear-exit plans, evidence and handoffs; use `docs/STATE_OF_THINGS.md` for current state. |
| `docs/testing/` | Test catalog, headless-testing guide, prod-polish automation. |
| `docs/archive/` | Completed migrations, superseded plans, old audits and QA reports. |
| `docs/syncview-design/` | The locked Production-tab design kit + its wired test gates. |
| `ROLLBACK.md`, `EXECUTION_LOG.md` | The rollback doctrine and the running execution log — kept at root on purpose. |

## Development

Serve the repository statically to preview the current `index.html`. After editing
any `src/index/` fragment, rebuild and commit the served output. Run
`npm run check:index` after that commit: it compares assembled, working-tree and
committed bytes.

```bash
npm install           # installs the development and test dependencies
npm run build:index   # after changing src/index/ fragments
npm test              # offline unit/wiring suite; run before every commit
npm run check:index   # after committing source and rebuilt output
npm run test:e2e      # live TEST-scope probes; may write test data
npm run test:prod-polish  # Production gate for ?prod=1 UI work; includes live reads
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
