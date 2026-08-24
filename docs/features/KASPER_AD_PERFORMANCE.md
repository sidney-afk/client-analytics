# Kasper Ad Performance

> **v1 LIVE (merged via #1127). v2 (per-ad breakdown + HubSpot lead-status funnel) SOURCE ONLY,
> branch `feat/kasper-ad-performance-v2` (2026-08-24).** v1 — table, Edge Function, n8n pull, and
> the browser panel — is fully live and backfilled from campaign launch. v2 adds two tables, extends
> the Edge Function response, rebuilds both n8n workflows (11 nodes each, adding a per-ad Meta pull
> and a HubSpot contact lookup), and adds a date-range toggle + per-ad table + per-lead list to the
> panel — all written, none yet applied/deployed/run. See `ROLLBACK.md`'s "Kasper Ad Performance
> panel" row for the exact current live state and `docs/truth/N8N.md` for both workflows' shapes.

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
before touching the service-role client, never writes any of its tables, and that the browser
caller sends the verified staff key. It also asserts (v2) that the function's console.log is
aggregate-counts-only and never references a lead's name or email. `test/kasper-priority-more-nav.js`
and `test/ef-cors-allow-headers.js` were updated in the v1 change (new tab/group in the hardcoded
nav contract; new CORS allow-header requirement for the staff identity triple).

## v2 — per-ad breakdown, date-range toggle, HubSpot lead-status funnel

Requested after using v1 for a day: aggregate-only numbers tell you *how* the campaign is doing,
not *what to do about it*. v2 adds three things, all requested together by Sidney:

1. **Date-range toggle** (7d / 14d / 30d / all). Handled entirely client-side: the Edge Function
   still returns the full dataset (it's small — daily rows, unlikely to exceed a few hundred for a
   long time), and `index.html` filters + recomputes the summary formulas locally when the range
   changes, using the exact same `safeDivide`-based math as the backend (`_kadSafeDivide` /
   `_kadSummarizeRows` mirror `safeDivide` / `summarize` in the Edge Function). No extra round-trip
   per toggle click.
2. **Per-ad breakdown.** New table `kasper_ad_performance_by_ad_daily`, PK `(date, ad_name)`. The
   n8n workflow adds a second Meta Insights pull at `level=ad` (same fields as the campaign pull,
   plus `ad_id`/`ad_name`). Bookings attribute to an ad by normalizing both Meta's `ad_name` and the
   booking's `utm_content` the same way (`+`→space, trim, collapse whitespace, case-insensitive
   compare) — this is the *same* attribution `iclosed_bookings.py` already proves works today in its
   "Bookings per ad" output, just ported into the automated pipeline rather than reinvented. The
   panel shows a table sorted by cost-per-booking (cheapest first; ads with zero bookings sort last)
   so the actionable read — which ad to scale, which to kill — is the default view, not something
   you have to compute yourself.
3. **Per-lead funnel status, joined from HubSpot.** New table `kasper_ad_leads` — one row per
   iClosed booking, **carries real PII (lead name + email)**. Confirmed feasible by querying
   HubSpot directly before building: iClosed bookings already sync into HubSpot as contacts with a
   structured `iclosed_status` property (`booked` / `potential` / `disqualified`), and HubSpot's own
   `lifecyclestage` property tracks the real funnel (`lead` → ... → `customer`) — `customer` is the
   actual closed-deal signal, not a proxy. The n8n workflow extracts unique emails from the
   in-window bookings, does one `POST /crm/v3/objects/contacts/batch/read` call (`idProperty:
   "email"`) via the existing "HubSpot account" n8n credential (already used by the unrelated
   Sales/Onboarding workflows — no new credential needed), and joins the result back onto each
   booking by email. The panel shows a per-lead table (booked date, name, email, ad, status badge);
   a lead's name links directly to its HubSpot contact record
   (`https://app.hubspot.com/contacts/245312721/record/0-1/<hubspot_contact_id>`) when matched, so
   there's no manual "copy the email, search HubSpot" step.

**PII handling for `kasper_ad_leads`:** same table-level lockdown as the other two tables (RLS, zero
anon/authenticated grant, service-role only), plus the Edge Function's aggregate-only logging
convention is enforced by a dedicated test (`test/kasper-ad-performance-auth.js`) that fails if the
function's log line ever references `lead_email`/`lead_name` or dumps the `leads` array itself
instead of just its length. The panel only ever renders leads to an already-admin-authenticated
Kasper — the same gate as the rest of this feature.

**n8n workflow shape change:** both the live pull and the one-time backfill went from 6 nodes to 11.
Trigger fans out to three parallel branches (campaign Meta pull, by-ad Meta pull, iClosed pull →
extract unique emails → HubSpot batch lookup), all three converge on a 3-input Merge node into one
`Build Daily Rows` Code node that now returns `{ daily, byAd, leads }`, fanning out to three
separate upsert HTTP nodes (one per table). See `docs/truth/N8N.md` for the exact node/workflow IDs.
