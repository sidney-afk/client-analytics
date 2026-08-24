# Kasper Ad Performance

> **BACKEND LIVE, UI NOT YET MERGED (2026-08-24).** The migration is applied, the Edge Function is
> deployed, and the n8n pull workflow is published and writing real data twice a day. The one piece
> still on the unmerged branch `feat/kasper-ad-performance-dashboard` is the browser panel
> (`index.html`) — Kasper cannot see any of this yet inside SyncView until that branch merges to
> `main`. See `ROLLBACK.md`'s "Kasper Ad Performance panel" row for the current live state and
> `docs/truth/N8N.md` for the pull workflow's exact shape.

Read-only ad-performance dashboard for Kasper (the owner) inside his existing staff-only Kasper
tab — daily Meta spend, landing page views, conversion rate, and cost-per-booking for his own
Meta prospecting campaign, sourced from Meta Ads Insights and iClosed bookings, updating twice a
day. Built because Kasper wanted to see how the campaign is performing without asking Sidney to
pull numbers by hand, and because the campaign runs through Synchro Social's own ad account for
Kasper's personal-brand coaching offer — this is Kasper checking his own funnel, not a per-client
analytics feature.

## Why this design

The full architecture decision (why a new Supabase table instead of reusing Sheets, why n8n
instead of GitHub Actions, why the metrics are defined the way they are) was worked out with
Sidney before any code was written — see the chat history around 2026-08-24 if the reasoning
behind a specific choice isn't obvious here. The short version: this repo already has an
established pattern for exactly this shape of feature (`workload_plan` + `workload-plan` Edge
Function — a small internal staff sidecar table, locked to service-role-only, read through one
staff-gated function), so this feature copies that pattern instead of inventing a new one.

## URLs

None yet — this is a staff-only panel inside the existing SyncView app (`syncview.synchrosocial.com`),
not a separate page. Once live: Kasper tab → More → Analytics → Ad Performance.

## Data Model

Run `migrations/2026-08-24-kasper-ad-performance.sql` in the Supabase SQL editor to create
`public.kasper_ad_performance_daily` (one row per UTC day):

| Column | Type | Notes |
|---|---|---|
| `date` | `date` (PK) | UTC day |
| `spend` | `numeric(12,2)` | Meta spend for the day |
| `impressions` | `bigint` | |
| `clicks` | `bigint` | |
| `landing_page_views` | `bigint` | Meta's `landing_page_view` insights field |
| `bookings_all` | `integer` | All iClosed bookings attributed to `utm_campaign=prospecting`, including later-cancelled ones |
| `bookings_held` | `integer` | Subset of `bookings_all` not cancelled as of the last pull |
| `updated_by` | `text` | Server-derived caller identity (the n8n workflow) |
| `updated_at` | `timestamptz` | |

Only raw counts are stored. CPC, landing-page-view rate, conversion rate, and both cost-per-booking
variants are computed at read time by the Edge Function — never persisted — so a partial upsert can
never leave a stale derived ratio sitting next to updated raw counts.

RLS enabled, zero anon/authenticated policy or grant, service-role SELECT/INSERT/UPDATE only,
DELETE/TRUNCATE/REFERENCES/TRIGGER revoked even from service role — identical posture to
`workload_plan` (see `docs/truth/SUPABASE.md`).

## Read path

`supabase/functions/kasper-ad-performance-read/index.ts` — admin-role-key-gated GET
(`X-Syncview-Key` header, same shared `_shared/staff-role-auth.ts` helper every staff EF uses).
Returns `{ ok: true, rows: [...], summary: {...} }`. Read-only; never writes the table. Deploy:

```
supabase functions deploy kasper-ad-performance-read --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
```

Deliberate-manual: no CI deploy path yet, matching `workload-plan`'s first-release precedent.
**Deployed to production 2026-08-24**; anonymous GET verified returning `401`.

## Write path — live

`Kasper Ad Performance — Daily Pull` (n8n workflow id `UYUTvvj7YGJOeZuz`, published, cron
`0 9,21 * * *`) pulls Meta Ads Insights for campaign `120243068755680573`
("Prospecting | Leads | US | Aug 2026", ad account `24069488506082034`) and iClosed bookings
(reusing the UTM attribution logic in `iclosed_bookings.py`, in the Kasper Ads working folder
outside this repo), then upserts into `kasper_ad_performance_daily`. Each run re-pulls the
trailing ~8 days (not just today) so bookings or ad-platform attribution that lands a few days
late still gets picked up.

Getting there required a Meta System User + app (Sidney created "n8n automation" as the System
User and a bare "SynchroSocial Automation" app under the same Business Portfolio purely to mint a
non-expiring `ads_read` token — no App Review needed since this only reads the business's own ad
account), stored in n8n as a plain "Facebook Graph API" credential (access-token field, not the
OAuth2 login-flow credential types). iClosed access is a generic Header Auth credential
(`Authorization: Bearer <key>`). Two manual test runs (`427019`, `427095`) proved the pipeline
before publish — the first caught that Meta's flat `landing_page_view` field returns 0; the real
count is in the `actions` array (`action_type: "landing_page_view"`) for this API version, fixed
in the published revision. A one-time backfill run (same shape, date range from the 2026-08-10
campaign launch through 2026-08-15) is a separate follow-up to fill the days before the first
trailing-8-day pull.

## UI

`index.html`: `ad-performance` key added to `KASPER_SUBTABS`, new `Analytics` group added to
`KASPER_MORE_GROUPS`, dispatched from `_kasperRenderTab()` to `_kasperRenderAdPerformance()`.
Summary cards (spend, CPC, landing page views, conversion rate, cost-per-booking both including
and excluding cancelled bookings) plus one Chart.js trend chart (daily spend as bars, daily
bookings as a line, dual y-axis). No per-ad breakdown in v1 — aggregate + trend only, per Sidney's
call; a per-ad table is a contained v2 addition later since the ad-name UTM tagging already exists
in the iClosed data.

## Tests

`test/kasper-ad-performance-auth.js` — asserts the Edge Function is admin-only, authenticates
before touching the service-role client, never writes the table, and that the browser caller sends
the verified staff key. `test/kasper-priority-more-nav.js` and `test/ef-cors-allow-headers.js`
were updated in the same change (new tab/group in the hardcoded nav contract; new CORS
allow-header requirement for the staff identity triple).
