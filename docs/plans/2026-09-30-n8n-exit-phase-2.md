# n8n exit, phase 2: move what is left that we can move

Session: Anvil, 2026-09-30, from main `9500994`. Plan only. Nothing here is built, and no n8n workflow was edited,
published, unpublished or run: every number below is a read of n8n's execution list.
Counts only, no client names or slugs.

## Where phase 1 left things

Phase 1 (`docs/plans/2026-09-28-n8n-exit.md`, PRs 1a to 4) is merged: #1846, #1854, #1858, #1862, #1864, all on 2026-09-29.
Measured against the week before (2026-09-23 to 09-29), the five routes it moved were:

| Route moved | Runs in 7 days | About per month |
|---|---|---|
| Filming Plan Tabs | 7,376 | 31,600 |
| Calendar Upsert Post | 3,463 | 14,800 |
| Calendar Comment Merge (helper) | 1,995 | 8,550 |
| Caption Prompts Get | 1,925 | 8,250 |
| Sample Review Upsert | 950 | 4,070 |
| Total | 15,709 | about 67,300 |

Today (09-30, about 14:30 UTC) the picture is: Filming Plan Tabs 0 (last run 09-29 18:04), Caption Prompts Get 0,
Calendar Upsert 24 and Comment Merge 12 (these two were partly still in use until the new page reached every open tab),
Sample Review Upsert **84**. The 84 is the one number that has not dropped: see "Checks before we build" below.

## How this was measured

Read only, through n8n's execution list (status and time, no payloads). Window: runs that started 2026-09-23 00:00 UTC
through 2026-09-30 about 14:35 UTC. "Per month" is the 7-day figure times 30 / 7, rounded. Nothing failed anywhere
except where noted. Runs counted by the API total for the four busiest, row by row for the rest.
119 workflows exist; 76 are active (Filming Plan Tabs is listed inactive, see the checks below); at least 18 of the active ones had zero runs in the window.

## The two Hiring timers: left alone

`Hiring - Practical Test Dispatch` and `Hiring - Interview Invite Dispatch` each run every 5 minutes: 2,029 runs each in 7 days,
about 8,700 a month each, 17,400 together. That is now the single largest block of n8n runs we are not touching
(owner decision). Both stay active until the hire closes. They are out of every number and order below.

## Every other active workflow, ranked by what it costs

| Workflow | Runs, 7 days | About per month | Phase 2 verdict |
|---|---|---|---|
| Slack Creative Channel Finalizer | 676 | 2,900 | **Move the polling** (step A) |
| Sales, Booking Recovery Dispatch | 776 | 3,300 this week, about 720 a month now it is hourly | **Gate it** (step C) |
| TikTok Upload, List | 400 | 1,700 | **Keep**, poll already adaptive; trim further (step D) |
| VIDEO PRODUCTION AUTOMATION | 295 | 1,260 | **Keep** for now, split later (step H) |
| Caption Jobs, Status | 141 | 600 | **Move** (step B) |
| TikTok Upload, Status | 128 | 550 | **Keep**, trim (step D) |
| Sales, Booking Recovery Capture | 117 | 500 | Keep (real intake, external webhook) |
| Filming Plan, Docs BatchUpdate | 58 | 250 | **Move and secure** (step E) |
| Error Alerts to DM | 41 | 175 | Keep (falls as the others move) |
| TikTok Result, Submit, Submit (Direct), Media Upload URL | 68 | 290 | Keep (outside callback and real uploads) |
| Hiring, Application Capture | 24 | 100 | Keep |
| Calendar, Get | 24 | 100 | **Retire** after a replacement fallback (step F) |
| Caption Jobs, Update | 22 | 95 | **Move** with Status (step B) |
| Kasper Ad Performance, Daily Pull | 14 | 60 | Optional move (step G) |
| Sales, Contract Signed | 14 | 60 | Keep |
| Arketa, daily report and watchdog | 14 | 60 | Keep |
| TOP VIDEOS | 8 | 35 | Keep |
| CLIENTS METRICS | 7 | 30 | Keep |
| SMM Reports, Manager Sync | 7 | 30 | Optional move (step G) |
| Calendar, Generate Caption | 7 | 30 | **Keep** (AI work) |
| Sales, Booking Recovery Heartbeat | 7 | 30 | Keep |
| Sales, Payment Received | 5 | 20 | Keep |
| Kasper, Queue (batch) | 3 | 13 | **Retire** with Calendar Get (step F) |
| Client Ideas (3 workflows) | 3 | 13 | Keep |
| MARKET RESEARCH (7 webhooks and a daily schedule) | 2 | 9 | Keep |
| Project Central, Sheet API | 2 | 9 | Keep |
| Sales, Call Booked, Meta CAPI, Call Cancelled, Invoice Paid, Onboarding Email | 8 | 35 | Keep |
| Sample Review, Reorder | 1 | 4 | Phase 1 workflow, see the switch-off table |
| Urgent Kasper Review to Slack | 1 | 4 | Keep (owner: preserve urgent notifications) |
| SyncView Weekly Backup, SMM Weekly Reminder | 2 | 9 | Keep |
| Zero runs in the window (18 workflows: onboarding list and submit, sales nurture, monthly check-in, content ready notify, inbound SMS relay, sales intake submit, editor music upload x2, editors labor week, others) | 0 | 0 | Keep, nothing to save. Candidates for a later tidy-up, not phase 2 |
| Edge Alert Relay to DM | not readable | not known | n8n answered "not available in MCP"; needs the owner to look in the n8n screen |

Phase 1 workflows are not repeated here; they are in the switch-off table.

## Checks before we build (none of these change anything)

1. **Sample Review Upsert still ran 84 times today.** After #1864 every staff save should go to the function. Something still
   calls n8n: old tabs that have not reloaded, saved repairs pinned to n8n (the migration on load should drain these), or the
   client approve and request-changes path (carved out on purpose). Split the 84 by caller from the n8n run payloads
   (owner or Lighthouse, since it needs reading payloads) before we count this route as gone.
2. **Filming Plan Tabs shows as inactive in n8n but logged 7,376 runs.** Either the flag is stale, or a second live copy
   answers the same path. Confirm which before we say it can be switched off.
3. **Calendar Upsert and Comment Merge still ran 24 and 12 times today**, partial day. Same reasoning as 1: old tabs and
   pinned repairs. Measure again at 7 and 14 days.
4. **Calendar, Get had 9 errors in 24 runs** in the window (five of them within seconds on 09-24). Not ours to fix, but it
   is the fallback Kasper's review history uses, so it feeds step F.
5. **CLIENTS METRICS errored four mornings running (09-24 to 09-27), each about 70 minutes**, then recovered. Not a move
   candidate, but worth one owner look since Error Alerts fired with it.
6. **Security findings from reading the graphs** (no secret values are written here, and these workflow files must never be
   committed to this public repo):
   - Two workflows (VIDEO PRODUCTION AUTOMATION and Generate Caption) carry an AI key and a scraping token typed directly into
     code steps. Moving them into n8n's own credential store, and rotating them, is an owner decision (the standing "do not
     rotate the publishable key" decision covers only the Supabase publishable key, not these).
   - `Filming Plan, Docs BatchUpdate` has no sign-in check: anyone holding the URL and a Doc id the connected Google account
     can edit could rewrite that Doc. Step E closes this while moving it.

## The order, and why

Ordered by runs saved per month for the least risk. "Effort" is S (under a day), M (1 to 3 days), L (a week or more).
"Saved" is n8n runs a month that stop, from the table above.

**A. Slack Creative Channel Finalizer: stop the 15 minute polling.** Saves about 2,800 a month. Effort M. Risk medium.
What it does: every 15 minutes it looks at a queue of new clients, checks they are ready, then creates the client's Slack
channels, invites people, writes the channel ids back to the client sheet and posts the kickoff message. 96 runs a day, and
almost all of them find nothing to do.
Where it can live: the channel creation itself should stay on n8n for now (it is real Slack work across sheets, with manual
repair steps). What moves is the question "is there anything to do?". Put the queue in a Supabase table (today it is an n8n
data table), have the upstream step that adds a job write to it, and let a `pg_cron` job (a timer inside our database) run every
15 minutes, check the table, and call the n8n workflow only when a job is waiting and ready. Result: runs fall from 96 a day to
the number of real jobs. Also consider calling it the moment a job is added instead of on a timer.
Why not move it all: it creates public and private channels and invites people, so a bug is visible to clients and cannot be
cleanly undone. Reconsider after a month of the gated version.
Needs the owner's explicit go to edit the n8n workflow (its trigger and first step), and finding which step adds queue rows
(not traced in this read).

**B. Caption Jobs Status and Update.** Saves about 700 a month (141 and 22 a week). Effort M. Risk low to medium.
What it does: while a caption is being generated, the Calendar page asks every few seconds "how far along is it?" and n8n reads
its own small data table to answer. Update writes progress into that table.
Where it can live: a Supabase table `caption_jobs` with two small functions. The generation workflow (which stays on n8n)
writes progress to the function instead of its data table, and the page reads from the function. Until the generation workflow
is edited, the function can mirror the data table, so the page can switch first.
Needs the owner's go to edit the Generate Caption workflow. Gate by a server-readable flag with the same rules as phase 1
(fresh bounded read, hold on failure, no fallback to n8n writes). Cheaper first step (S): the page polls less often and stops as
soon as the job finishes, which alone should cut most of the 600.

**C. Sales, Booking Recovery Dispatch: only run when something is due.** Saves about 600 a month (it is already down to
hourly, so the big saving of the 10 minute schedule has been taken). Effort S to M. Risk medium, because it sends emails and texts.
What it does: re-checks unfinished bookings and sends a recovery email and text. Where it can live: same shape as A. A database
timer checks for due rows and calls n8n only when there are some. Not started until the owner agrees, because it touches sales
messages.

**D. TikTok Upload: list and status.** Saves about 1,000 a month. Effort S first, M later. Risk low.
What it does: the TikTok tab asks n8n to read the upload sheet (the last 100 rows) and, for one upload, asks Post For Me
whether it posted. The poll is already adaptive (only while the tab is visible and something is pending), so the remaining 400
and 128 a week are real activity. S step: poll less while nothing changes (longer gaps after each unchanged answer, stop on
posted or failed, never poll the list and the single status together). M step, later: move the list into a Supabase table written by the
submit and result workflows, read by a function. The uploads themselves, the result callback from Post For Me and cancel stay on n8n
(outside service, real work, about 70 runs a week).

**E. Filming Plan, Docs BatchUpdate: move to a function, with sign-in.** Saves about 250 a month and closes an open write hole.
Effort M. Risk medium.
What it does: passes the Filming Plan editor's edits straight to Google Docs. Where it can live: a Supabase function next to
`filming-plan-tabs` (same Google service account the owner already authorised), requiring the same staff sign-in as the other
write functions and accepting only Docs we own. Flag gated, with the same hold on failure rule. The owner must share the Docs
with the service account for writes (today's read work already asked for this).

**F. Retire the read fallbacks: Calendar Get, Sample Review Get, Kasper Queue.** Saves about 120 a month, but the real win is that
the last n8n reads that depend on Google Sheets go. Effort M. Risk low once tested.
Phase 1 kept these as the recovery path when the Supabase read fails. Build the replacement first: a retry of the Supabase read
with a short wait, then a saved copy in the browser, then a clear "data is unavailable, try again" message. Add a test that forces
the Supabase read to fail and proves the page recovers with no n8n request. Only then can the three be switched off.

**G. Small scheduled jobs: Kasper Ad Performance, SMM Reports Manager Sync.** Saves about 90 a month. Effort M each.
Optional. Kasper Ad Performance already stores everything in Supabase; it could be a function on a `pg_cron` timer. SMM Manager
Sync reads a sheet into Supabase once a day; it moves when the sheet does. Not worth doing before A to F.

**H. VIDEO PRODUCTION AUTOMATION: keep, then split.** 1,260 a month, nothing saved in phase 2. Effort L. Risk high.
What it does: six webhooks (video request form, graphic request form, the Linear project and issue helpers, add to calendar, and the
intake log) that check the Supabase authority flag, record a receipt, then create the work in Linear and post Slack messages.
It also holds older branches for titles, captions and thumbnails using AI and scraping services. It is 142 steps, had 37 errors
all on 09-23, 09-24 and 09-26 and none since. Keep on n8n. Phase 3 could peel off the two forms that already pass through
`production-write` and the intake log (the plan from phase 1 already lists it). Leave untouched until the secrets in its code
steps are dealt with.

**Keep on n8n, with the reason:**
- Generate Caption: an AI job with a long wait for the transcription callback. About 30 runs a month.
- TikTok submit, direct submit, media upload URL, result, cancel: an outside service and real uploads. About 290 a month.
- All sales, payment, contract, booking and onboarding webhooks: they receive calls from outside tools (iClosed, Stripe, Commas,
  eSignatures, Twilio), run rarely, and are money or client facing. Under 400 runs a month together.
- TOP VIDEOS, CLIENTS METRICS, MARKET RESEARCH: scraping with Apify and YouTube, a few runs a day, output goes to sheets.
- Arketa daily report and watchdog, Weekly Backup, SMM Weekly Reminder, Error Alerts, Urgent Kasper Review to Slack: small, and they
  are the safety nets or preserve urgent notifications.
- Hiring timers: owner decision.

## What this saves in total

If A to F land: about 2,800 + 700 + 600 + 1,000 + 250 + 120 = about 5,500 runs a month, on top of the roughly 67,300 phase 1
already removed. Of the current n8n bill, about 17,400 (the hiring timers) stays until the hire closes, and the rest is
work we chose to keep (video production about 1,260, sales, TikTok uploads, scraping, AI).

## Phase 1 workflows that can be switched off, and when

Rule from phase 1: the old n8n workflows stay on for 30 days after the migration on load code ships, then the workflow's exact
JSON is exported privately, a public-safe status stub is committed, and it is **deactivated, never deleted**
(ROLLBACK.md rule 2). Lighthouse does it with the owner's go; I edit none of them. All five phase 1 PRs merged 2026-09-29, so the
earliest date for the first four rows is **2026-10-29**.

Every row also needs the same three checks on the day: (1) seven days in a row of zero runs in n8n's execution list for that
workflow, except where noted, (2) the route's own browser test still green on main, (3) the "zero requests to n8n" assertion in that
test, which records every `n8n.cloud` request and asserts none.

| Workflow | Earliest off | Extra condition | Test that proves it is safe |
|---|---|---|---|
| Filming Plan Tabs | after the owner retires the Filming flag (after a bake, not before 2026-10-29) | check 2 above resolved; function mode confirmed | `test/filming-plan-tabs-source.js` (both modes, stale tab) and `test/kasper-filming-tab-source.js`; plus the forced failure of the function, where it must show "unavailable" not call n8n |
| Calendar, Upsert Post | 2026-10-29 | pinned repairs drained (migration on load ran in every browser that opened; zero runs for 7 days) | `test/calendar-write-guard-browser.js` (zero n8n requests, hold and pause), `test/calendar-pinned-gate-migration.js`, `test/write-ui-n8n-authority-gates.js`, and both client carve out tests below |
| Calendar Comment Merge (helper) | with Upsert Post | it runs only inside Upsert Post | same as Upsert Post |
| Calendar, Reorder, Reorder (batch), Append Post, Delete Post | 2026-10-29 (already 0 to 1 runs a week) | none beyond the common checks | `test/calendar-write-guard-browser.js` (reorder requests go to the function) |
| Caption Prompts, Save | 2026-10-29 | none | `test/caption-prompts-guard-browser.js` (pause and hold, never n8n) |
| Sample Review, Upsert and Reorder | 2026-10-29 | check 1 above resolved (84 runs today); pinned repairs drained | `test/samples-write-guard-browser.js`, `test/calendar-pinned-gate-migration.js` (Samples branch), and the Samples carve out test below |
| Caption Prompts, Get | **not in phase 2**: first-load fallback | only after a durable server copy of prompts exists | n/a |
| Calendar, Get; Sample Review, Get; Kasper, Queue | after step F ships and 30 days pass | replacement recovery read built | the new forced Supabase failure test from step F |

**The blocker for the Calendar and Sample Review rows.** Phase 1 carved the client approve and request-changes buttons out
completely (owner decision), so a client link whose pause switch has not loaded still sends those two calls to n8n. The byte for
byte tests prove they are unchanged
(`test/calendar-client-carveout-byte-identical-browser.js` and `test/samples-client-carveout-byte-identical-browser.js`), which is
exactly why switching off Calendar Upsert or Sample Review Upsert would break a client's button. Before either workflow is turned
off, the owner has to decide how those two buttons are served. This is one new owner decision, not a change I will make: the
options are (a) keep those two workflows on for good, or (b) move those two calls to the functions with a new byte for byte
test that shows the request body and result the client sees are unchanged, then switch off. I recommend (b), but it touches the
one path the owner protected, so it needs an explicit go.

## Rules that carry over unchanged

Every step above: a fresh bounded read of its flag before each write, a failed read holds the write, no write ever falls back to
n8n, every new database read is run once against the real database with exact query parameters and no cache buster on
`/rest/v1/` URLs, new browser tests run in CI, real exit lines quoted for every suite, one branch and one PR each, Lighthouse
merges. No n8n workflow is edited without the owner's go in that same request: steps A, B and C each edit one, so each needs it.

## Open owner decisions, in one place

1. Approve and request-changes for clients: keep those two n8n workflows forever, or move them with a byte for byte test (above).
2. Go to edit the n8n Finalizer trigger (A) and the Generate Caption workflow (B).
3. Sales Booking Recovery gating (C): yes or no.
4. Rotate the AI and scraping keys typed into two workflows, and move them to n8n's credential store.
5. Someone to open the Edge Alert Relay workflow in the n8n screen (not readable from here).
