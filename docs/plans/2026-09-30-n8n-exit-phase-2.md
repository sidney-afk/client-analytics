# n8n exit, phase 2: move what is left that we can move

Session: Anvil, 2026-09-30, from main `95009946a5ee71daa44268f026fda5232270a9d5`. Plan only. Nothing here is built, and no n8n workflow was edited,
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
119 workflows exist; 76 are active and 43 inactive (Filming Plan Tabs is listed inactive, see the checks below); at least 18 of the active ones had zero runs in the window.

**How the set was closed.** The workflow list was read twice in different shapes (sorted by last edit, then sorted by
creation date, 200 per page, so 119 is below the page size and nothing was cut off). Both returned the same 119 ids, 76 active and
43 inactive. Every active id was then looked up for runs, so a workflow missing from the list would still have to show up as
an unknown id in the run list, and none did. Two workflows were hidden from this read access: one inactive (an old backup
workflow, still unreadable) and one active (`Edge Alert Relay to DM`, opened to access by the owner on 2026-09-30 and then read and
counted). A workflow hidden from this access in future would be missed the same way. This supersedes the
138 / 96 / 42 count in `docs/truth/N8N.md` (updated in this PR).

## Owner decisions, 2026-09-30 (recorded here, in this PR)

1. **Client approve and request-changes: move them off n8n (option b).** The two buttons move to the functions behind a new
   byte for byte test that proves the request the function receives, and what the client sees (the same success and error
   screens, the same saved card), are unchanged. This is the only step that touches the protected client path, so it is the last
   build, and it has its own PR. Once it ships and the 30 day rule passes, `Calendar, Upsert Post` and `Sample Review, Upsert`
   can be switched off.
2. **Go to edit two n8n workflows.**
   - *Slack Creative Channel Finalizer:* no 15 minute polling and no database timer. The onboarding session triggers the
     finalizer directly at the right step of the onboarding runbook, and one daily safety check catches a client who is ready
     but was never triggered. The onboarding runbook is updated in this PR (see step A).
   - *Generate Caption:* the AI generation stays on n8n. Progress is written to Supabase and the Calendar page reads it there.
     Tested end to end on the test client (step B).
3. **Booking Recovery gating: yes, after proof.** Before anything is switched, a test proves every due recovery still sends,
   with the same messages at the same time (step C).
4. **No key rotation.** The two keys typed into workflow code stay valid. Moving them into n8n credentials is approved when
   those workflows are edited anyway (steps A to C touch them). **I cannot create a credential from here** (the n8n tools I
   have can list credentials, not create them), so the owner creates the two credentials in n8n's Credentials screen and tells
   me their names; I then point the nodes at them. The Code steps that hold a key today become HTTP Request steps that use the
   credential, which is a larger edit than a swap, and is written down in the edit record.
5. **Edge Alert Relay: read on 2026-09-30 after the owner enabled access.** Active, three steps: a webhook that receives an
   edge function alert, a code step that strips every character except letters, digits and `_.:@-` (capped at 96 each) and builds
   one line of text, and a Slack message to the owner. It reads no data and calls nothing else. 45 runs in the 7 days, none
   failed. The webhook has no sign-in, so anyone with the URL can make it send the owner a DM; the content is sanitised text
   only, so the risk is noise, not data. **Verdict: keep, no change.**

**Order, as decided:** merge this plan first (Lighthouse), then one PR per step, smallest risk first. The resulting order is
D, B, A, E, F, C, then the client approve and request-changes move (call it step K), with G optional. Steps in the list below
keep their letters; the order is this one.

**Every n8n edit is written down.** Each PR that edits an n8n workflow adds an entry to `docs/ops/N8N_EDIT_LOG.md` (created by
the first such PR, append only) with: the workflow's name and id, its version id before and after (from n8n's own version
history), exactly which steps changed and why, how it was tested, and **how to undo it** (restore the named earlier version in
n8n, with the version id written there). Nothing is deleted. No secret value is ever written in that file or anywhere in the
repo. An edit that changes what a workflow does for a client (steps A and C) is first tried on the test client only.

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
| Filming Plan, Docs BatchUpdate | 58 | 250 | **Switched off 2026-10-01** (step E, caller already moved) |
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
| MARKET RESEARCH (five enabled webhooks; daily schedule and content-summary branch disabled in Atlas graph read, 2026-09-30) | 2 | 9 | Keep |
| Project Central, Sheet API | 2 | 9 | Keep |
| Sales, Call Booked, Meta CAPI, Call Cancelled, Invoice Paid, Onboarding Email | 8 | 35 | Keep |
| Sample Review, Reorder | 1 | 4 | Phase 1 workflow, see the switch-off table |
| Urgent Kasper Review to Slack | 1 | 4 | Keep (owner: preserve urgent notifications) |
| SyncView Weekly Backup, SMM Weekly Reminder | 2 | 9 | Keep |
| Zero runs in the window (18 workflows: onboarding list and submit, sales nurture, monthly check-in, content ready notify, inbound SMS relay, sales intake submit, editor music upload x2, editors labor week, others) | 0 | 0 | Keep, nothing to save. Candidates for a later tidy-up, not phase 2 |
| Edge Alert Relay to DM | 45 | 190 | **Keep**, read 2026-09-30 (decision 5): three steps, sanitised alert text to the owner's DM |

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
     code steps. Owner decision 2026-09-30: no rotation; moving them into n8n credentials is approved when those workflows are
     edited anyway (see decision 4).
   - `Filming Plan, Docs BatchUpdate` has no sign-in check: anyone holding the URL and a Doc id the connected Google account
     can edit could rewrite that Doc. Closed 2026-10-01: step E switched the workflow off.

## The order, and why

Ordered by runs saved per month for the least risk. "Effort" is S (under a day), M (1 to 3 days), L (a week or more).
"Saved" is n8n runs a month that stop, from the table above.

**A. Slack Creative Channel Finalizer: triggered by onboarding, not by a timer.** Saves about 2,800 runs a month. Effort M.
Risk medium (it creates Slack channels that clients' staff see). Owner decision: no 15 minute polling and no database timer.
What it does today: every 15 minutes it looks at a queue of new clients, checks they are ready, then creates the client's
channels, invites people, writes the channel ids back to the client sheet and posts the kickoff message. 96 runs a day, almost
all finding nothing to do.
What changes (an n8n edit, with the owner's go already given):
1. The 15 minute schedule is replaced by a **direct trigger**: a new webhook on the same workflow,
   `POST /webhook/slack-creative-finalize`, that processes the waiting queue row for the client named in the body (or the
   oldest ready one if none is named) using the **same readiness checks and the same steps as today**. Nothing else in the
   channel creation changes. The webhook only acts on a queue row that is already ready, and it is safe to call twice (a row
   that is done is skipped), so a stray or repeated call does nothing harmful.
2. **One daily safety check** is kept: the same workflow on a once a day schedule, which runs the same pass for every waiting
   row. This catches a client who was ready but whose onboarding session forgot to trigger. It is one run a day (about 30 a
   month) instead of 96.
3. **The onboarding runbook is updated in this PR** (`docs/ops/NEW_CLIENT_ONBOARDING.md`, section 6c) so a new session knows exactly
   when and how to call the trigger. Until the n8n edit ships and is confirmed, the runbook says the 15 minute check is still the
   active path, and the trigger step is marked "live only after the Finalizer PR".
4. The queue stays where it is for now (n8n's own data table); moving it to Supabase is not needed, since nothing polls it.
Ship order inside the PR: add the webhook and the daily schedule **alongside** the existing 15 minute schedule, test the trigger
on the test client (create a queue row for it, call the trigger, see one channel created, see a second call do nothing), then
remove the 15 minute schedule in the same edit session, and record both versions. If anything is wrong, undo is to restore the
saved earlier version, which brings the 15 minute schedule back.
Why not move it all off n8n: it creates public and private channels and invites people, so a bug is visible and cannot be
cleanly undone. Reconsider after a month.
Not yet traced: which step adds queue rows (the onboarding provisioning workflow writes the private brief snapshot; the exact
moment "ready" is true is the three checks in the runbook). The PR's first job is to read that and write the exact trigger
moment in the runbook from what it finds, not from this plan.

**A status 2026-09-30:** the webhook and the daily safety check are built and published next to the 15 minute timer
(`docs/ops/N8N_EDIT_LOG.md`, version `7afd1d3c`; restore `8f194a42`). Owner decision: no real Slack channels are created for a test. The
trigger moment was read from the workflow and is written in the onboarding runbook section 6c (a pending queue row, one Clients Info
row with neither channel id set, one SMM row with a Slack id, one filming plan row). **Still to do: the 15 minute timer is removed in
a small follow-up PR only after the next real client's channels were created through the webhook and the timer found nothing left
to do.** Measured before the edit: the queue holds 3 rows ever, all `manual`, none pending since 2026-09-03; the timer ran 705 times
for nothing.

**B. Caption Jobs: progress in Supabase, generation stays on n8n.** Saves about 700 a month (141 and 22 a week). Effort M.
Risk low to medium. Owner decision: AI generation stays on n8n; progress goes to Supabase; the page reads it there; tested end to
end on the test client.
What it does today: while a caption is being generated, the Calendar page asks every few seconds "how far along is it?" and n8n
reads its own small data table. Update writes progress into that table.
**Split in two, like Filming (PR 1a and 1b), because the page ships at merge while the migration and deploy are manual.**
*B1 (backend only, built 2026-09-30):* table `caption_jobs` and ONE function `caption-jobs` that does both old webhooks
(`GET` is status, `POST` is update, same keys). Nothing is switched. *B2 (after Lighthouse applies the migration and deploys
the function and it is read back once):* the n8n edit and the page switch behind a server-readable flag. **Owner decision
2026-09-30 (keys):** use the existing n8n credentials `Claude` (header auth) and `APIFY @HOUSE` (query auth) for the two typed
keys; if either fails the test run on the test client, stop and tell the owner, never put the typed key back; no key value
anywhere in the repo, PR or reply. **Resolved 2026-09-30:** the owner named `SyncView Client Credentials Staff Key` as the login for the new function. Its first
real test answered 401 because that login holds the `CREDENTIALS_STAFF_KEY` that `client-credentials` accepts (a legacy secret),
not a role key. Owner decision: `caption-jobs` also accepts `CREDENTIALS_STAFF_KEY` (OPEN_REPAIRS 300). The workflow edit is
drafted and stays unpublished until a real end to end test passes after that deploy.
**B2 status 2026-09-30:** the Generate Caption workflow edit is published (OPEN_REPAIRS 302, `docs/ops/N8N_EDIT_LOG.md`), tested end to end on the test client. **Not yet switched: the Calendar page** still polls the old n8n status webhook, so until the page PR (flag gated) ships, progress and Cancel do not reflect new runs.
**Later step (recorded, not started):** Generate Caption still saves the finished caption through the old n8n
`calendar-upsert-post` webhook from a Code step. That call must move to the `calendar-upsert` function (staff key login,
same hold on failure rule, test on the test client) before the n8n Calendar upsert workflow can be switched off.
Original plan: a Supabase table `caption_jobs` with two small functions (status read, update write) behind a server-readable flag with
the same rules as phase 1 (fresh bounded read before each write, hold on failure, no write ever falls back to n8n). The Generate
Caption workflow (an n8n edit, owner go given) writes progress through the update function instead of its data table; the page
reads from the status function. **The page switches only after the workflow edit is live and the function has been proven to
receive real progress**, so there is never a moment the page reads a table nothing writes to.
Also in the same edit: the key and scraping token typed into two code steps move into n8n credentials (decision 4). This makes the
edit bigger than a swap, so it is tested separately: the same caption generated before and after must be the same kind of result.
End to end test on the test client (run on the test client only, real generation, no mocks): start a caption on a test card,
watch progress appear in Supabase in order (queued, scraping, transcribing, writing, done), see the page show the same stages,
cancel one mid run and see it stop, see a finished caption saved to the card. The test also asserts the page makes zero
requests to n8n's `caption-job-status` and `caption-job-update`.
Cheaper first step (S, goes first inside this PR): the page polls less often and stops as soon as the job finishes.
Undo: the page flag back to the old route is not allowed to reopen a write hole, so undo for the workflow is restoring its earlier
saved version (recorded in the edit log); the old data table is kept untouched until the 30 day rule passes.

**C. Sales, Booking Recovery Dispatch: only run when something is due, after proof.** Saves about 600 a month (it is already
hourly, so the large saving of the old 10 minute schedule is already taken). Effort M. Risk medium, because it sends emails and
texts to real prospects. Owner decision: yes, but prove first.
What it does: re-checks unfinished bookings and sends a recovery email and text. It re-checks our booked rows and HubSpot before
each send so anyone who booked is never chased.
Plan: a database timer (`pg_cron`, a timer inside our own database) runs the same "is anything due?" test the workflow runs today
and calls the workflow only when at least one row is due. **Before switching, a test proves "every due recovery still sends":**
a replay test takes a set of recovery rows at known times (including rows due exactly at the hour, rows due in the same hour as a
booking, rows whose person just booked, and rows already sent) and compares, row by row, what the current hourly workflow would
send (message text, channel, send time) against what the gated path sends. They must match exactly, and zero rows may be missed
or sent twice. Only after that passes on the test data is the trigger edited, and the old hourly schedule is kept running beside
the new trigger for one week, with a check that the two never disagree, before it is removed. Test recipients are the test
client's and the owner's own address only.
Undo: restore the saved earlier version of the workflow (brings back the hourly schedule); the timer is turned off in the database.

**C status 2026-10-01:** the replay proof is built and passes (`test/booking-recovery-replay.js`, `docs/ops/BOOKING_RECOVERY_GATE.md`):
the gated schedules send the same messages as the hourly one. **Not switched.** The plan assumed the queue could be read from
Supabase; it is an n8n data table (`booking_recovery`) written by two capture workflows and read by Dispatch and the Heartbeat, and
`pg_net` is not installed, so a database timer can neither see due rows nor wake the workflow. Switching means a Supabase mirror
of the queue written by those workflows plus `pg_net`, which edits four live sales workflows. It waits for the owner's decision
among: leave it hourly, go to every 2 hours, trigger per lead, or build the mirror.

**D. TikTok Upload: list and status.** Saves about 1,000 a month. Effort S first, M later. Risk low.
What it does: the TikTok tab asks n8n to read the upload sheet (the last 100 rows) and, for one upload, asks Post For Me
whether it posted. The poll is already adaptive (only while the tab is visible and something is pending), so the remaining 400
and 128 a week are real activity. S step: poll less while nothing changes (longer gaps after each unchanged answer, stop on
posted or failed, never poll the list and the single status together). M step, later: move the list into a Supabase table written by the
submit and result workflows, read by a function. The uploads themselves, the result callback from Post For Me and cancel stay on n8n
(outside service, real work, about 70 runs a week).

**E. Filming Plan, Docs BatchUpdate: switched off (done 2026-10-01).** Saved about 250 runs a month and closed an open write hole.
What it was: a no sign-in n8n webhook that passed the filming plan pipeline's edits straight to Google Docs. The earlier text of this
step assumed the Filming Plan editor page called it and proposed a new function; both were wrong. Measured: the only caller was the
pipeline script `synchro-pipelines/filming_plan_write_doc.py`, which by 2026-09-30 already wrote Docs through the pipeline's own
`pipeline-google` function (password from the `PIPELINE_GOOGLE_KEY` environment variable; see that repo's `GOOGLE_WRITES.md`).
The workflow had no runs after 2026-09-29 15:55 UTC, so on 2026-10-01 it was deactivated (not deleted); the version to restore and
the evidence are in `docs/ops/N8N_EDIT_LOG.md`. No new function was needed (a duplicate built from a stale checkout was closed
unmerged, client-analytics PR 1893).

**F. Retire the read fallbacks: Calendar Get, Sample Review Get, Kasper Queue.** Saves about 120 a month, but the real win is that
the n8n reads of the Calendar sheets go (Caption Prompts Get and the TikTok list still read sheets and stay). Effort M. Risk low once tested.
Phase 1 kept these as the recovery path when the Supabase read fails. Build the replacement first: a retry of the Supabase read
with a short wait, then a saved copy in the browser, then a clear "data is unavailable, try again" message. Add a test that forces
the Supabase read to fail and proves the page recovers with no n8n request. Only then can the three be switched off.

**F status 2026-10-01:** the page side is built (see OPEN_REPAIRS, step F): one retry, then the saved copy and a clear message, no n8n
request, proved by `test/read-fallbacks-retired.js`. The three n8n workflows stay on until the page change is live and a later check
of their runs shows zero calls; switching them off is a separate small PR with its own `N8N_EDIT_LOG.md` entry.

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

**Step K: move the client approve and request-changes calls off n8n (owner decision 1).** Phase 1 carved these two buttons out
completely, so a client link whose pause switch has not loaded still sends them to n8n. That is the only reason
`Calendar, Upsert Post` and `Sample Review, Upsert` cannot be switched off. Effort M. Risk high, because this is the one path the owner
protected, so it is built last, alone, in its own PR.
Plan: the two calls go to the existing functions (the same functions staff saves use, which accept a client link's signed-in
identity through `client-token-verify`). The page keeps its current behaviour for a client: the same buttons, the same success
and error messages, the same saved card afterwards. The shared save step's pause and hold rules do not apply to these two calls
the way they do to staff saves; the exact rule is decided in the PR from how a client link loads its flag, and written in its
description before any code.
**The test.** A new browser test, `test/calendar-client-approve-function-browser.js` (and a Samples twin), drives a client link
on the test client through approve and request-changes against a mock that records everything, and asserts: (1) the body the
function receives has the same fields and values the n8n request carried (the existing golden files are the reference, and each
field is mapped one to one in the test), (2) the client sees the same screens, strings and saved card as the current tests
record, (3) zero requests to n8n, (4) a failed function answer shows the same error the n8n failure shows today and leaves the
card as it was. The two existing byte for byte tests stay in the repo and stay green until this step ships, then are replaced by
these in the same PR.
After it ships, run the real thing once on the test client (approve and request-changes on a test card, read the card back from
Supabase), then the 30 day rule starts for the two upsert workflows.

## Rules that carry over unchanged

Every step above: a fresh bounded read of its flag before each write, a failed read holds the write, no write ever falls back to
n8n, every new database read is run once against the real database with exact query parameters and no cache buster on
`/rest/v1/` URLs, new browser tests run in CI, real exit lines quoted for every suite, one branch and one PR each, Lighthouse
merges. No n8n workflow is edited without the owner's go in that same request: steps A, B and C each edit one, so each needs it.

## Open items after the owner's decisions

1. The owner creates two credentials in n8n (one for the AI service, one for the scraping service) and tells me their names,
   before step B (I cannot create them from here). No key is rotated.
2. Sample Review Upsert still ran 84 times on 2026-09-30 (check 1 above): someone reads the callers before step K.
3. The two "hidden from this access" items: one old inactive backup workflow is unreadable, and is left alone.

## Step C status 2026-10-01

Owner decision: Booking Recovery stays hourly with no n8n edits (saves 600 runs a month, not worth editing four live sales workflows). Replay test and design doc kept. Step K report: `docs/plans/2026-10-01-n8n-exit-step-k-report.md`.

## Step K status 2026-10-01

Built. A client link always saves through the functions (no flag lookup, retried saves included); tests replaced as in OPEN_REPAIRS. All 525 n8n save runs since 2026-09-30 were read: 520 test client, 5 from one real client via n8n's own Generate Caption Save step, 0 from a browser or client link. The n8n Calendar save workflow cannot be switched off until Generate Caption's Save step is moved to the function; the Samples one has no real caller left. Switch-off still follows the 30 day zero-calls rule (earliest 2026-10-29).

## Generate Caption Save step, 2026-10-03

Done (OPEN_REPAIRS 334, `docs/ops/N8N_EDIT_LOG.md`). The "Later step" under B2 is closed: Generate Caption saves through `calendar-upsert`. All 395 runs of the two n8n save workflows since 2026-10-02 23:55 UTC were read: all test-client drills, no real caller. Switch-off stays a separate step with the owner's go after the 5 day window.
