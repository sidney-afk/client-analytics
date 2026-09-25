# Plan: SyncView v2 (Supabase + Next.js on Vercel)

Date: 2026-09-25. Status: PLAN ONLY. This document changes no code, no
database, no Edge Function and no n8n workflow.

Read with: `docs/plans/2026-09-24-owner-backlog.md` (item 2 is this plan,
item 1 is the private-repo question), `docs/plans/2026-09-24-sheets-to-supabase.md`,
`docs/plans/2026-09-24-modularization-c3-plan.md`, `docs/independence/SYSTEM_MAP.md`
and `REPO_MAP.md`.

## Words used below

- **v1**: today's SyncView. One page (`index.html`, built from
  `src/index/*.part`) served by GitHub Pages from this public repo.
- **v2**: the new SyncView. A Next.js app (a popular framework for building
  websites in React, with pages rendered partly on a server) hosted on Vercel
  (a hosting company built around Next.js), in a new private repo.
- **Edge Function**: a small server program running inside Supabase. v1
  already has about 40 of them under `supabase/functions/`.
- **RLS (row level security)**: database rules that decide which rows a
  given caller may read or write.
- **Runtime flag**: an on/off row in the existing `syncview_runtime_flags`
  table, read by the site at load, so behaviour changes without a deploy.
- **Parity**: v2 shows the same data and makes the same writes as v1 for
  the same action.
- **Route switch**: a rule that decides, per screen, whether a visitor lands
  on v1 or v2.

## 1. The answer in brief

1. v2 is a new front end only. It uses the **same Supabase project, the same
   tables and the same Edge Functions** as v1. No second database, no copy of
   data, no sync job.
2. Client approve and request changes are rebuilt **first**, tested harder
   than anything else, and switched over only after a period where both
   versions are proven to write the same result.
3. Screens move one at a time, behind a per-screen switch that can send
   people back to v1 in one change with no deploy.
4. **Every screen works well on phones**, staff screens and Kasper review
   included, not only client pages. v2 is designed phone-first: each screen
   is laid out for a phone screen first, then widened for desktop.
5. A **Clients** admin tab lets the owner edit client info in SyncView and
   retire the Clients Info Sheet. It is built in v1 first (decided), and v2
   reuses its tables and rules unchanged.
6. Expected new monthly cost: about **$20 for Vercel Pro** (one seat), plus
   whatever GitHub charges once repos are private (likely $0 to $4). Details
   in section 10.
7. Start only after C3 (the module work) finishes. v2 does not wait for the
   Sheets move, but the Analytics screens do (section 3).

## 2. Screens that exist today

From `docs/independence/SYSTEM_MAP.md` section 4. "Who" is who uses it.

| # | Screen | Who | Notes for v2 |
|---|---|---|---|
| A | Client links: approve, request changes, comment (Calendar and Sample Reviews portals) | Clients, via share link | Owner's top priority. |
| B | Analytics (home) and per-client Analytics, incl. client analytics share link | Staff, clients | Reads Google Sheets today; waits for the Sheets move. |
| C | Content Calendar (staff view, Create Post) | Staff | Biggest staff screen. |
| D | Samples New (Sample Reviews) | Staff, clients | Staff side of screen A. |
| E | Samples Old | Clients only (retired for staff) | Do not rebuild. Redirect old links to D. |
| F | Linear tab / SyncLinear (production hub: batches, deliverables) | Staff | Native since the 2026-09-20 Linear cutoff. |
| G | Kasper mode (review queue) | Reviewer | Small, reuses D and F data. |
| H | Workload | Staff | |
| I | Submit tab (native intake) | Staff | Shares Create Post code with C. |
| J | Filming Plans | Staff | |
| K | Templates and Caption prompts | Staff | |
| L | TikTok Upload (and hidden TikTok Pilot) | Staff | Used and important (owner, 2026-09-25). Rebuilt, not dropped. |
| M | Onboarding and Sales intake lists | Staff | |
| N | SMM Weekly Reports | Staff | |
| O | Client Credentials | Admin | Sensitive. |
| P | Time Off (PTO) | Staff | Already cleanly behind one Edge Function. |
| Q | Clients admin (new) | Owner/admin | Section 6. |

## 3. Rebuild order

Each step is one or more PRs in the v2 repo, then its own switch-over
(section 7). A step is "done" when the owner has tried it on v2 and chooses
to switch that screen over. There is no fixed waiting period; v1's copy
stays available as the way back.

| Step | Screen(s) | Why here |
|---|---|---|
| 0 | Skeleton: sign-in, client-link check, shared layout, error reporting, Vercel and test setup. No real screen. | Everything else needs it. |
| 1 | **A. Client approve / request changes / comment**, Calendar portal then Sample Reviews portal. | Owner's top priority. Small surface, all writes already go through Edge Functions, easy to compare. |
| 2 | D. Samples New staff side, G. Kasper mode | Staff half of the same flow; same functions. |
| 3 | Q. Clients admin: port the screen of the v1 tab (built in v1 first, section 6) | v2's roster reads depend on it. Tables and rules are reused, not redesigned. |
| 4 | C. Content Calendar, I. Submit | Largest staff screen; built on step 1's card code. |
| 5 | F. SyncLinear production hub, H. Workload | Heaviest and most tangled in v1 (C3 converts it late for a reason). |
| 6 | P. PTO, J. Filming Plans, K. Templates, N. SMM reports, M. Onboarding lists | Small, each behind one function already. Can run in parallel with 4 and 5. |
| 7 | B. Analytics | Only after the Sheets move (Phase 2 of the Sheets plan) puts the data in Supabase. Rebuilding it against Google Sheets would be wasted work. |
| 8 | L. TikTok Upload | Used and important, but its writes go through n8n only (section 4), so it needs its write inventory done first. Can move earlier if the owner wants it sooner. |
| 8b | O. Client Credentials | Last because it is sensitive. |
| 9 | Retire v1 | Section 7, "the end". |

Rule for every step: port the behaviour, not the code. Read the matching v1
module (C3 gives each screen a clear boundary) and the SYSTEM_MAP entry, then
write down the list of actions and their expected writes before building.
That list becomes the parity test (section 8).

## 4. Same database, same functions

- v2 talks to the **same Supabase project** with the same public
  (publishable) key the browser uses today, and calls the **same Edge
  Functions** with the same headers (`X-Syncview-Client-Token` for clients,
  the staff identity for staff).
- **v2 adds no new write path for existing data.** Each write goes through
  the same backend door v1 uses. For the core screens that is an Edge
  Function (`production-write`, `calendar-upsert`, `sample-review-upsert`,
  and so on), so server rules, conflict checks and history tables are shared
  and the two versions cannot disagree about what a write means.
- **Not every v1 write is an Edge Function.** Some screens still write
  through n8n webhooks (automation endpoints): Caption prompts can,
  TikTok Upload only does, and Onboarding and Sales intake use n8n as primary
  and fallback (SYSTEM_MAP 4.11 to 4.13). Before each of those screens is
  rebuilt, its step starts by listing every write and its transport from
  SYSTEM_MAP section 7, then either (a) calls the same n8n endpoint from v2,
  unchanged, or (b) moves it to an Edge Function as a separate PR in this
  repo, switched on for v1 first. Option (b) needs the owner's approval for
  any n8n change. The parity test covers whichever transport is used.
- Direct table reads from the browser stay limited to what v1 already reads.
  v2 should not add new open reads; if it needs new data, it gets a narrow
  Edge Function (the same rule as the Sheets plan, option (a)).
- **Schema changes stay in this repo.** Migrations and Edge Functions keep
  living in `client-analytics` (`supabase/`) with their existing deploy lanes
  and fingerprint checks until v1 is retired. The v2 repo holds only front-end
  code. This avoids two repos both changing one database. Moving `supabase/`
  into the private repo is a later, separate step (section 9).
- Any change a v2 screen needs from a function must stay **backward
  compatible** with v1 (add fields, never rename or remove) until v1's copy of
  that screen is retired.
- Next.js can run code on Vercel's servers. v2 should use that only for
  rendering pages and must **never hold the Supabase service key** (the
  all-powerful key). All privileged work stays in Edge Functions, so there is
  one place to audit.

## 5. Staff sign-in and client share links

**Staff: sign in with Google (decided 2026-09-25).** Today staff pick
their name from a list and type a personal key. In v2 they press "Sign in
with Google" instead.

How it works, in plain English:

- SyncView already has a staff list (the `team_members` table), one row per
  person, holding their name and role (admin, manager, editor, and so on).
- We add one thing to each row: **that person's Google email address.**
- When someone signs in, Google tells SyncView "this is really
  name@example.com". Google does the password checking, so SyncView never
  stores a password.
- SyncView then looks for that email in the staff list. **If it is there,**
  the person gets in with the role on their row. **If it is not there, they
  are refused**, even though Google recognised them. Having a Google account
  is not enough; being on the list is what grants access.
- To add a new staff member: add their Google email to their row. To remove
  someone: remove the email (or mark the row inactive), and their next page
  load is refused.

Technically this uses Supabase Auth (Supabase's built-in login system) with
Google as the sign-in provider, plus a check in the Edge Functions that
matches the signed-in email to an active `team_members` row. Because each
write now carries a real, signed login, it also fixes the open attribution
issue (F31: v1 cannot prove which person made a write). While v1 and v2 run
side by side, the Edge Functions accept **both** the v1 personal key and the
new Google login.

**Clients.** No login, as today. The share link carries a client token; v2
checks it with the existing `client-token-verify` function and sends it on
every write. Staff keep minting links with `client-review-link`. The link
format should be the same so a client's existing link keeps working when the
route switch moves them to v2.

**Client links work exactly as today; nothing is refused (decided
2026-09-25).** `calendar-upsert` and `sample-review-upsert` stay
deliberately un-gated by owner directive (`AGENTS.md`, "FROZEN client write
gate"), because re-gating them has broken client approvals twice. v2 copies
v1's behaviour, including letting a client through when the link check
errors. Any future tightening is a new owner decision and still needs both
conditions in `AGENTS.md`: the owner's explicit yes, and every active client
re-issued and confirmed on a fresh link.

## 6. Clients admin tab

Goal: the owner edits client info (handles, competitors, keywords, Slack
channel, manager, active or not) inside SyncView, and the Clients Info Sheet
is retired.

- **Data.** Use the `clients` table plus the companion table the Sheets plan
  proposes (`client_profiles`, and `client_managers` for per-client manager
  fields). Do not design a second schema in v2.
- **Built in v1 first (decided 2026-09-25)**, right after Prism's Sheets to
  Supabase Phase 1 puts client data in Supabase. v2 reuses those tables, the
  same Edge Function for saving, and the same rules for who may edit. v2
  only rebuilds the screen.
- **Writes** go through one admin-only Edge Function that records who changed
  what and when (a history table), so a wrong edit can be seen and undone.
  No direct browser writes.
- **Who can edit:** owner and admins only. Others may view a limited set of
  fields.
- **Retiring the Sheet:** n8n workflows that read Clients Info (CLIENTS
  METRICS, TOP VIDEOS, MARKET RESEARCH) and the onboarding workflow that
  writes it (Append Client Row) must be switched to Supabase first, each with
  the owner's approval in the same request, as the Sheets plan section 3,
  Phase 3 describes. Only then does the Sheet become read-only.

## 7. Running v1 and v2 side by side

**Addresses.** v1 stays at `syncview.synchrosocial.com` on GitHub Pages.
v2 starts at its own "v2" address, for example
`v2.syncview.synchrosocial.com` (decided 2026-09-25). Moving v2 to the normal
address later is a setting change (a DNS record, the internet's address
book, plus Vercel's domain setting), not a rebuild.

**Switching one screen at a time.** A runtime flag, for example
`v2_routes`, lists which screens (and optionally which clients or staff) go
to v2. v1 reads it on load: if the current screen is listed, it redirects to
the same screen on v2, keeping the link's parameters. v2 does the reverse:
if its screen is not listed, it sends the visitor back to v1.

- Start each screen with the test client and the owner only. **The owner
  tries it and decides when to switch it** for staff, then clients. There is
  no fixed side-by-side period (decided 2026-09-25).
- **The way back** is removing the screen from the flag. No deploy, takes
  effect on the next page load. Because both versions write through the same
  functions to the same tables, nothing needs copying back.
- Keep v1's copy of a screen working and tested until the owner says it
  can be retired.

**The end.** When every screen is on v2: point `syncview.synchrosocial.com`
at Vercel (the setting change above), keep v1 reachable at a backup address for one more month, then
archive it. Old share links keep working because the address and format do
not change.

## 8. Testing and deploy

**Before a screen is switched on:**

1. **Parity script** per screen: perform the same actions (approve, request
   changes with a note, comment, save a card) on the test client in v1 and in
   v2, then compare the resulting database rows and history events. Must
   match exactly, apart from time and id fields.
2. **Browser tests** (Playwright, which drives a real browser) for every
   screen, staff and client alike, on a phone-size screen first and a
   desktop screen second. A screen that fails on the phone size is not
   ready.
3. **The existing morning check** (`dawn-check`) gets a v2 variant for each
   switched screen, so both versions are checked each weekday while both run.
4. Unit tests and type checks on every PR in the v2 repo.

**Deploy.** Vercel builds a preview address for every PR, so the owner can
click through a change before it merges; merging to `main` deploys v2
production. A bad v2 deploy is rolled back in Vercel with one click
("promote previous deployment"), and the route switch can also send everyone
to v1 meanwhile. Edge Function and migration deploys stay on today's lanes in
this repo.

**Error reporting.** v1's biggest diagnosis gap is that a refused write
leaves no server trace (OPEN_REPAIRS 101). v2 should send every failed write
to the existing `write-diagnostics` function from day one.

## 9. The private repo and GitHub Actions cost

- **v2 repo** is private from the start (for example `syncview-v2`). Vercel
  hosts it, so the GitHub Pages rule (Pages from a private repo needs a paid
  plan) does not apply to it.
- **GitHub Actions minutes.** The free plan gives private repos 2,000 minutes
  a month, shared across all of the account's private repos. Public repos are
  free. v2 needs little: tests on each PR (a few minutes each). Vercel does
  the build and deploy on its own machines, so deploys cost no Actions
  minutes.
- **This repo stays public while v1 runs.** Its 47 workflows (nightlies, the
  morning check, reconcilers, deploy lanes) keep running free. Making it
  private would put all of them on the 2,000-minute allowance, and its
  schedules alone could exceed it. That is backlog item 1's question and it
  gets its own plan; the v2 plan does not depend on it.
- **After v1 retires**, item 1 gets simpler: no Pages site to move. What is
  left is moving schedules to Supabase (pg_cron, the database's built-in
  scheduler) where sensible, and measuring the remaining minutes before
  going private.
- Public-repo rules (no client names, slugs, secrets) still apply to this
  repo. In the private v2 repo they may relax, but real secrets still go in
  Vercel's and GitHub's secret settings, never in code.

## 10. Monthly cost

Prices below are from public price lists as known in mid-2026 and must be
re-checked before signing up.

| Item | Cost | Notes |
|---|---|---|
| Vercel Pro | about $20 per seat per month | The free Hobby plan is for non-commercial use only, so a business app needs Pro. One seat (the owner) is enough; AI sessions deploy through GitHub, not a seat. Includes generous bandwidth for an internal tool. |
| Supabase | no change | Same project, same plan. v2 adds no new database. Watch Edge Function call counts during side-by-side running. |
| GitHub | $0 to $4 per month | $0 if the private v2 repo stays within 2,000 free Actions minutes. GitHub Pro ($4) only if this repo later goes private while still using Pages. |
| Domain | no change | A subdomain of the existing domain. |
| **Total new** | **about $20 to $24 per month** | |

## 11. Risks

- **Two front ends, one database, diverging rules.** Mitigation: all writes
  through shared Edge Functions; function changes must be backward
  compatible; parity script per screen.
- **Double work during side-by-side running:** a v1 bug fix may also need a
  v2 fix. Mitigation: the owner switches each screen as soon as they are
  happy with it, so windows stay short.
- **Staff sign-in change** could lock someone out (for example a missing or
  misspelled email on the list). Mitigation: fill in every staff email
  before step 0 ends, and functions accept both methods until every staff
  member has signed in once on v2.
- **Phone-first staff screens** are harder for dense screens (SyncLinear,
  Workload, Calendar). Mitigation: design each one's phone layout before
  building it, and have the owner try it on a phone before switching.

## 12. Decisions for the owner

All decided by the owner on 2026-09-25.

1. **Staff sign-in: decided.** Google sign-in. Each staff member's Google
   email is added to the existing staff list; an email not on the list is
   refused (section 5).
2. **Client links: decided.** They work exactly as today; nothing is
   refused (section 5).
3. **Clients admin tab: decided.** Built in the current SyncView first,
   after Prism's Sheets to Supabase Phase 1; v2 reuses it (section 6).
4. **Side-by-side period: decided.** No fixed period. The owner tries each
   v2 screen and decides when to switch it (section 7).
5. **TikTok Upload: decided.** Used and important; it stays and is rebuilt
   (section 3). Samples Old is still not rebuilt; its old client links are
   redirected.
6. **Phones: decided.** Every screen must work well on phones, staff
   screens and Kasper review included. v2 is designed phone-first.
7. **Cost: decided.** Vercel at about $20 a month is approved.
8. **Address: decided.** v2 starts at a "v2" web address; moving it to the
   normal address later is a setting change (section 7). The repo name
   (for example `syncview-v2`) is chosen when it is created.
