# Clean addresses

SyncView pages live at clean paths (`/synclinear`, `/calendar/<client>/<card>`)
instead of hashes and query flags (`#production`, `?prod=1&d=<id>`). Every old
address keeps working: it is forwarded to its clean path in the same tab, with
its client, card and filters kept. Old Slack messages, n8n messages, bookmarks
and docs never break.

## Never touched

- Client share links: `/?c=<client>&v=<view>&t=<token>` (with or without `sxr=1`).
- The onboarding forms: `/onboarding_form`, `/ai_onboarding_form` (and `?onboarding=1|ai`).
- Staff client profiles: `/#<ClientName>`.
- Developer switches (`wl2`, `v2`, `thumbcache`, ...) ride along as query flags.

## Mapping

| Clean path | Old addresses (all still work) |
|---|---|
| `/` | `#`, bare site |
| `/synclinear` | `#production`, `?prod=1#production` |
| `/synclinear/<card-id>` | `?prod=1&d=<id>#production` |
| `/synclinear/batch/<id>` | `?prod=1&batch=<id>` |
| `/submit` | `#linear` |
| `/workload` | `#workload` |
| `/calendar`, `/calendar/<client>/<card>` | `#calendar/...` |
| `/templates`, `/templates/<client>` | `#templates/...` |
| `/filming-plans` | `#filming-plans` |
| `/tiktok-upload` | `#tiktok-upload` |
| `/time-off` | `#time-off` |
| `/sample-reviews/<client>/<card>` | `#sample-reviews/...`, `#samples...` |
| `/smm-weekly-report`, `/smm-weekly-reports?week=...` | `#smm-weekly-report(s)...` |
| `/kasper`, `/kasper/<sub>` | `?Kasper=1`, `#kasper/...` |
| `/onboarding` | Kasper > Onboarding |
| `/onboarding/<client>` | `?onboarding_view=<client>` |
| `/client-credentials` | Kasper > Client Credentials |
| `/intake` | `?intake=1` |

SyncLinear view state (`group`, `order`, `team`, `view`, ...) stays in the query:
`/synclinear?group=status`.

## How it works

- `src/index/003-sv-route.html.part` runs first and is the only translator. The
  app still routes internally on the old form: it reads `svRoute.hash()` and
  `svRoute.search()`, never `location.hash` / `location.search`. Every
  `history.pushState/replaceState` is shown at its clean path, and an old
  address opened directly is forwarded.
- GitHub Pages can only serve files. Each top-level page has a tiny stub
  (`synclinear.html`, `calendar.html`, ...) so it answers 200; the stub hands off
  to `/?sv_path=<path>` and the app puts the clean path back. Deep links
  (`/calendar/<client>/<card>`) go through `404.html` the same way. Regenerate
  the stubs with `node scripts/build-route-stubs.js` after changing the route
  list; `test/clean-urls-routes.js` fails if one is missing or stale.
- Asset paths are absolute (`/syncview-favicon.png`, `/nav-icons/...`), so they
  load on nested paths.
- Slack alerts (`supabase/functions/notify`) and the copy-link buttons produce
  clean paths. The n8n urgent-Kasper message still sends `#kasper`, which
  forwards.

## Kasper is admin-only

The Kasper tab and `/kasper` are shown only to a signed-in member with the
`admin` role (two people). The role comes from the key-verify server check. A
browser that has seen a verified admin remembers it, so a slow or failed check
never hides Kasper from its owner; a verified non-admin or a sign-out forgets
it. `?Kasper=1` no longer unlocks anything; it forwards to `/kasper`.

This is a visibility gate. The data behind the admin-only sub-pages is guarded
by each sub-page's own server checks where they exist (hiring, quiz leads,
clients); Review, Samples, Messages, Editors and Ad Performance read data any
signed-in staff key can already read.

| Kasper sub-page | Who can use it | Where non-admins reach it |
|---|---|---|
| Review Session, Samples, Messages, Editors, Ad Performance | Admin (Kasper's own review work) | Not needed; SMMs use Sample Reviews at `/sample-reviews` |
| Filming Plans (Kasper review) | Admin | Staff use `/filming-plans` |
| Time Off (approvals) | Admin (`pto-admin`) | Staff request time off at `/time-off` (staff menu) |
| Sales Intake, Hiring Process, Quiz Leads, Clients | Admin (server-checked capabilities) | Not needed |
| Onboarding | Admin, SMM, creative | `/onboarding` (staff menu) |
| Client Credentials | Admin, SMM | `/client-credentials` (staff menu) |
| SMM weekly report | Admin, SMM (never a Kasper sub-page) | `/smm-weekly-report` |
