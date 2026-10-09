# Where a big token budget would make the biggest difference

Session Scout, 2026-10-09. Exploring only: nothing in the code, the data, n8n or
any live system was changed. Live systems were read with read-only queries
(SELECT on the database, n8n's execution list, GitHub run history, Meta's ad
statistics). Main was at `127b8fa4` (#2017) when this was written.

## The short answer

The business is not short of new features. It is short of three things:

1. **Alarms it can believe.** Several alarms have been red for weeks for reasons
   that are not real problems, one important robot shows green while doing
   nothing, and the nightly backup has been failing since 2026-10-07 with only
   a GitHub email to say so. A real failure today looks the same as the noise.
2. **Getting finished work out of the door.** About 20 fixes are built and
   waiting for an owner step (a deploy, a pasted database change, a switch).
   The ledger's labels no longer say which of them are actually live, so
   nobody can see the pile clearly.
3. **Fresh proof that the client-facing paths work.** The promise for client
   links is "proven every 7 days". The last proof is 16 days old, the Calendar
   robot has not passed since 2026-08-25, and four proof rows expire on
   2026-10-15.

Those three are my top picks. Ready-to-paste prompts for them are at the end.

---

## What I looked at

- `CLAUDE.md`, `AGENTS.md`, `docs/STATE_OF_THINGS.md`, `docs/QUALITY_TIERS.md`,
  `REPO_MAP.md`, every plan in `docs/plans/`, the newest audits in `docs/audits/`.
- `docs/ops/OPEN_REPAIRS.md`, entries 282 to 387, the last 60 read closely.
- Every merged change on main from 2026-09-18 to today (498 merged pull requests).
- Every scheduled GitHub lane, its recent runs and where its alarm goes.
- The four repos: this one, `synchro-pipelines`, `synchro-brain`, `synchrosocial`.
- Live, read only: the database's scheduled jobs, switches ("runtime flags"),
  the failed-save log, the upload queues; n8n's workflow list and runs; Meta ad
  spend for the last 28 days.

## What I found, in plain English

### 1. Finished work sits on a shelf, and the shelf is invisible

A "deploy" means copying new code onto the live servers. In SyncView the web
page goes live automatically when a change is merged, but server code
("Edge Functions", small programs that run on Supabase) and database changes
("migrations") only go live when the owner runs a step by hand. The most
important server program, `production-write` (the one every staff save in
Production goes through), can only be deployed through the sealed capture
ritual in `CLAUDE.md`.

- Of the ledger entries since number 280, **56 were filed as "built, not
  deployed / not applied / not merged"**. Many of those are now live (page-only
  fixes went live on merge) but their labels were never updated, so the ledger
  can no longer answer "what is waiting on me?".
- Counted properly, about **20 distinct owner actions** are still open
  (list in project 2 below). Examples:
  - The server half of the fix for entry 382: a staff member's reply failed
    **670 times over 21 hours** with an error; one comment was lost. The page
    half is live (checked on main), the server half waits for the ritual.
  - The backup fix (387): merged today, but the nightly backup stays red until
    the owner pastes one grant and sets one setting.
  - Entries 290, 313, 317, 320, 326, 357, 361, 363, 370, 374, 381, 385: each
    built and each waiting on a deploy, a paste or a switch.
- The ritual is the narrowest pipe in the business: four separate fixes
  (290, 326, 381, 382) all wait for the same `production-write` deploy, and
  one of them (381) has to be done first or the deploy's own safety check
  refuses.

### 2. The alarms cannot be trusted

- **The lane ticker shows green and does nothing.** It is meant to start the
  "every 5 minutes" robots on time, because GitHub only runs this repo's
  timers every 3 to 8 hours. It asks GitHub a question in a format GitHub does
  not support (`.github/workflows/lane-ticker.yml` line 55), gets "unknown",
  and stops itself in about 8 seconds, every hour, since 2026-09-28. Result:
  "every 5 minutes" robots run about 5 times a day, and a dead robot is noticed
  after 6 to 10 hours.
- **Robots red so long they are noise.** The Calendar nightly robot has not
  passed since 2026-08-25. The Samples nightly robot has been red 35 runs in a
  row; after the 2026-10-08 fix (entry 373) it now fails on a different step
  (Kasper's approval does not move the status), which may be a real bug, and
  the pager will not tell anyone because it only pages once per lane until the
  lane recovers.
- **Alarm messages arrive empty.** The nightly robots and the morning check
  send plain text, which the n8n relay throws away, so the owner gets a line
  like "type=edge_alert issue=unknown" (found in entry 328: 3 of 6 relay runs).
- **The backup alarm is an email.** The private database backup has failed
  every run since 2026-10-07 23:12 UTC. It is not wired to Slack.
- **Important things have no alarm at all:** posts to clients' TikTok and
  Instagram (live today: 3 posts still "scheduled" hours after their time,
  1 stuck "processing" since 2026-09-10, 1 stuck "uploading" since May,
  18 failed in total); Create client; the failed-save log (1,153 refusals on
  2026-10-08 alone; nobody is told); money spent at Apify, Post For Me, OpenAI,
  Anthropic.
- **The one-message Slack digest** (entry 328) is built and has run in
  "shadow" for a week. Today it would report 5 open problems.

Silent failures found in the last three weeks, and how long they lasted:
TikTok Cancel never cancelled (361, since the feature existed); the daily
Sheet copy failed 5 days (374); the backup 2 days and counting (387); one reply
failed 670 times (382); the live site published the whole repo (294, for its
whole history). Every one of them was found by a session reading things, not
by an alarm.

### 3. The client-facing promise has lapsed

`docs/QUALITY_TIERS.md` promises that client links ("Tier 0") are proven every
7 days. `docs/testing/ASSURANCE_LEDGER.md` says: client review links last
proven 2026-09-23, link issuance 2026-07-17, client-visible thumbnails
2026-07-14. Four rows reach 90 days around **2026-10-15** and turn the ledger
lane red again (entry 205a). The morning check covers client approve and
request changes, but only on weekdays, hours late, not watched by the pager,
and it has no Samples flow (the owner asked for one on 2026-09-22).

### 4. The page sometimes says a save worked when it did not

The Sentinel sessions (entries 371, 375, 376, 377, 383, 384) found and fixed
about 50 of these on the page, for example: an edit saved under the wrong
client, a failed reschedule left on the new day, a failed archive shown as
done, a refused Instagram post shown as "could not confirm". One fix (#2000)
itself leaked an unsent internal comment into a client-visible thread for a
few hours (379, corrected in #2007). Six candidates are still unverified
(383), and the server side has a recurring shape: some functions answer
"200 OK" with `{"ok":false}` inside, which pages keep reading as success.

### 5. The repo itself has become expensive to work in

- In three weeks: 498 merged changes. Seven of the eight most-edited files are
  bookkeeping (the ledger, the repo map, the built page, the test list), not
  app code. About 55% of changes were docs, tests or internal restructuring.
- About one "catch up with main, keep both ledger entries, rebuild the page"
  commit per merged change (105 in three weeks). One such merge silently
  dropped the comment fix and it had to be restored (`88d3c505`); another lost
  a style block (`47fa301f`).
- Old copies of the built page are never deleted: **308 files, 618 MB** in
  `js/`, 100 copies of the full page at 5.5 MB each. Entry 382 already hit a
  crash from this and asked for an owner decision on how many to keep.
- CI (the automatic checks on each change) uses about **135,000 minutes a
  month**, 90% on pull requests. It is free only because the repo is public;
  private would cost about $790 a month (`docs/plans/2026-09-29-repo-private-plan.md`).

### 6. The other three repos

- **Filming-plan pipeline (`synchro-pipelines`).** Works end to end, but only
  3 of about 30 clients are set up. The first real use by someone other than
  the owner (2026-10-08, `kasper-feedback/`) went badly: 2 of 7 ideas sounded
  like the client, one contradicted the client's own words, and the batch
  passed the checker anyway because the checker does not stop on ideas marked
  "revise". Fixes shipped the same day; none has run on a real batch yet. No
  automatic checks run on that repo (a broken change merged in #89). Its
  Google relay password is committed in `google_relay_key.txt` (the repo is
  private, but the password can edit client Docs through a public address).
- **Brain Keeper (`synchro-brain`).** Runs daily and weekly. It missed SyncView
  comments for 6 days and onboarding forms for 9 days (2026-09-30 to 10-08),
  still reads the client roster from the Sheet although the database became
  the main copy on 2026-10-02, and has not recorded its token use since
  2026-09-30 (runs used 3 to 18 million tokens each, from the same weekly
  pool as all other Claude work).
- **Marketing site and ads (`synchrosocial`).** Read live: about **$2,041 of
  Meta ad spend in 28 days**. The active campaign got 4 booked calls at about
  $226 each; a paused campaign spent $1,136 with no recorded results. The
  booking tool's own events (qualified, scheduled), verified in August, have
  not appeared at all in 28 days, and nobody wrote that down. The plan to send
  "this lead became a paying client" back to Meta (so ads learn to find
  clients, not just leads) is not built. Open owner decision with legal weight:
  recovery text messages on the main funnel are sent with no stored consent
  (`docs/meta-ads/` booking recovery notes, sections 7.1 and 8.2). The
  partial-lead capture function that handles personal data is not in any repo.

### 7. Money you can save with a decision, not a project

- **n8n:** 64 workflows active. On 2026-10-08 n8n ran 808 times; **71% were the
  two hiring dispatchers** (every 5 minutes each). Without them the pace is
  about 7,000 a month. Priority item 2 (plan downgrade) was due 2026-10-01 and
  is still open; at today's pace even the smallest paid tier looks enough once
  hiring closes. (The watchdog's configured cap is 135,000; the ledger says
  "200k plan"; the real tier is unconfirmed.)
- **Analytics are paused** (owner, 2026-10-06): no new client numbers since
  then. That is a decision, not a fault, but every day it stays paused the
  numbers clients see get older.

---

## The ranked list

Size is in "sessions": one session is roughly one long working day of an
executor, about 1 to 3 million tokens. Risk is the chance of hurting something
live.

### 1. Alarms you can believe (top pick, prompt below)

- **What:** make every alarm mean "a real thing is wrong now". Fix the ticker;
  send typed messages instead of empty ones; page again when *what* fails
  changes; put the backup on Slack; add a watcher for client posts (TikTok and
  Instagram queues) and for spikes in the failed-save log; get the one-message
  digest ready to switch on.
- **Why it matters:** every silent failure in the last three weeks was found
  by luck. A lost post, a lost backup or a lost client approval costs trust.
- **Evidence:** `lane-ticker.yml` line 55; entries 328, 373, 382, 387; live
  upload queue counts above; `scripts/monitoring-watchdog.js` (pages once per
  lane).
- **Size:** 2 to 3 sessions. **Risk:** low (robots and messages only; the
  relay edit in n8n stays an owner decision).
- **We know it worked when:** for one week every alarm the owner receives is
  readable and points at a real problem; the ticker's runs last hours, not
  seconds; the "5 minute" robots really run every few minutes; a test stuck
  post on the test client raises an alarm within the hour.

### 2. Ship what is already built (top pick, prompt below)

- **What:** check every "built, not live" item against the live system, fix
  the ledger labels, and give the owner one ordered sitting: which deploys,
  pastes and switches, in which order, with direct links, so the pile goes to
  zero. Also a small script that compares "what the repo says" with "what is
  live" so the pile can never become invisible again.
- **Why it matters:** these fixes are already paid for. Until they are live
  they protect nobody, and one of them is the only database backup.
- **Evidence:** 56 headers since entry 280; about 20 open owner actions
  (entries 290, 313, 317, 320/324, 326, 357, 361, 363, 370, 374, 381, 382, 385,
  387, plus the analytics steps); STATE_OF_THINGS "Needs the owner".
- **Size:** 1 to 2 sessions of reading and writing, then one owner sitting of
  about 1 to 2 hours. **Risk:** low for the session (read only); each owner
  step carries its own small risk, already written into its entry.
- **We know it worked when:** the reconciliation table shows zero items in
  "built, waiting for owner" that the owner has not explicitly chosen to hold,
  and the backup lane is green.

### 3. Prove the client paths again, and keep them proven (top pick, prompt below)

- **What:** re-prove the Tier 0 rows (client link loads and saves, link
  issuance, client-visible thumbnails) on the test client before 2026-10-15;
  find out why Kasper's approval step fails in the Samples robot (a real bug or
  a test bug); get the Calendar and Samples nightly robots green; add the
  Samples flow the owner asked for to the morning check.
- **Why it matters:** these are the only things clients touch. The promise is
  7 days; the proof is 16 days to 3 months old.
- **Evidence:** `docs/testing/ASSURANCE_LEDGER.md`; entry 205a; entry 373;
  Samples nightly run of 2026-10-09 (204 of 210, Kasper approval).
- **Size:** 2 sessions. **Risk:** low to medium (live writes only on the test
  client; the frozen client writers are not touched).
- **We know it worked when:** both nightlies pass three nights in a row, the
  assurance lane is green past 2026-10-15, and the morning check includes a
  Samples approve.

### 4. Client posts on TikTok and Instagram: nothing goes out wrong or silently fails

- **What:** read every stuck or failed row in the upload queues and find out
  what really happened at Post For Me; move the result notice off the last
  n8n workflow (370); prove Cancel really cancels (361) and one real Reel
  (301) on the test client.
- **Why:** a wrong or missing post is seen by the client and their audience.
- **Evidence:** entries 361, 370, 377 item 1 to 3, 384; live counts in
  section 2.
- **Size:** 1 to 2 sessions. **Risk:** medium (real posting; test account only).
- **Worked when:** zero rows stuck past one hour for a week; Cancel proven
  live; the n8n result workflow switched off with the owner's go.

### 5. Honest saves, round 4

- **What:** finish Sentinel's open list (6 unverified candidates in 383, the
  cycle 2 list in 377), and fix the server-side shape where functions answer
  "OK" with a refusal inside, so pages cannot misread it.
- **Why:** staff stop re-doing work and stop trusting "Saved" when it lies.
- **Evidence:** entries 316, 318, 371, 375, 377, 379, 383, 384.
- **Size:** 2 to 3 sessions. **Risk:** medium (touches the save engines; the
  #2000 leak shows why every change needs an independent review).
- **Worked when:** every candidate is fixed or closed with a reason, each with
  a test that fails on the old code; the failed-save log shows no new
  "reported as saved" shapes for two weeks.

### 6. Filming-plan pipeline: a real quality gate, then more clients

- **What:** make the checker refuse ideas marked "revise" or contradicting the
  client's own words; add basic automatic checks to the repo; redo the newest
  client's batch under the 2026-10-08 rules; then set up the next 5 to 10
  clients with a per-run credit count.
- **Why:** this is the agency's product. 3 of about 30 clients are covered.
- **Evidence:** `synchro-pipelines/STATE.md` (2026-10-08 OPEN),
  `kasper-feedback/`, #89 and #91.
- **Size:** 2 to 4 sessions. **Risk:** low (Docs are written through the
  relay; a test Doc first).
- **Worked when:** Kasper rates a fresh batch "sounds like the client" for
  most ideas; checker fails on a planted "revise" idea; 5 more clients set up.

### 7. Marketing money: tracking health and "cost per client won"

- **What:** a monthly tracking check (expected events by source, the booking
  tool's events, cost per booked call per campaign); write down that the
  booking tool's events went quiet; design (not build) the loop that sends
  "became a client" and its value back to Meta. Owner decisions first: text
  message consent, and whether n8n may be touched.
- **Why:** about $2,000 a month of ads are optimised on leads, not clients.
- **Evidence:** live Meta read (section 6); `synchrosocial/docs/meta-ads/README.md`
  sections 7 and 9.
- **Size:** 1 session to measure and design, 2 to 3 to build. **Risk:** medium
  to high once n8n sales automation is touched (owner go required).
- **Worked when:** a monthly report exists; ads can be judged by cost per
  client won.

### 8. Cut the repo tax

- **What:** stop every change from fighting over the same files: one file per
  ledger entry (keeping the old file as is), build the page in a check instead
  of committing it every time if the owner agrees, a keep-the-last-N rule for
  old page copies (owner decides N), and skip heavy browser checks on
  docs-only changes.
- **Why:** every future session pays this cost; it has already lost two fixes
  in merges.
- **Evidence:** 105 catch-up commits in 3 weeks; `88d3c505`, `47fa301f`;
  618 MB in `js/`; entry 382; repo-private plan (CI minutes).
- **Size:** 2 sessions. **Risk:** medium (old page copies keep already-open
  browser tabs working; pruning needs care).
- **Worked when:** catch-up commits per change fall by half; `js/` stops
  growing.

### 9. Brain Keeper: close the blind spots, cut the bill

- **What:** read the roster from the database; give the routine one fixed,
  read-only way to fetch comments and forms; record token use again; fetch
  Slack with a cheap script and only send likely threads to Claude.
- **Evidence:** `synchro-brain/POLICY/sources.md`, `PROPOSALS/brain-keeper-runs.md`.
- **Size:** 1 to 2 sessions. **Risk:** low.
- **Worked when:** no source unread for more than a day; token use per run
  recorded and lower.

### 10. Onboarding: the approvals screen and the first real client end to end

- **What:** build the screen (3.3) where the owner approves the 192 high
  confidence client matches; then walk the first real "Create client" through
  every step (the automatic chain has not carried a new client since 2026-09-03).
- **Evidence:** `docs/audits/2026-10-08-stage3-matching-dry-run.md`,
  `docs/audits/2026-10-01-client-onboarding-as-it-really-is.md`, entries 372, 385.
- **Size:** 2 sessions. **Risk:** medium (real client records; approvals only
  by the owner).
- **Worked when:** all 192 are approved or rejected; one new client goes from
  form to first card with no hand steps beyond those the owner chose.

### 11. Security housekeeping across the four repos

- **What:** move the pipeline relay password out of git and change it; change
  the ad tracking token flagged since 2026-07-08; put the partial-lead capture
  function's source in a repo; remove browser-role write and TRUNCATE rights
  on the ten tables in STATE_OF_THINGS item 8.
- **Size:** 1 session plus owner steps. **Risk:** low to medium.

### Not recommended now

- **SyncView v2 rewrite, modularization step 13, making the repo private:**
  each is large, the owner has parked them, and none fixes a problem a client
  or staff member feels today.
- **More phone polish:** six batches just landed; let staff use them first.

### Things I could not settle

- Entries 385 and part of STATE_OF_THINGS are dated 2026-10-10, after today.
  A session's clock or wording is off; worth a glance.
- The stuck upload rows may be stale labels rather than missed posts. I did
  not check them at Post For Me (project 4 does).
- The n8n plan tier is unconfirmed (135,000 cap in the watchdog, "200k" in
  entry 233).

---

## Ready-to-paste prompts

### Prompt 1: Watchtower (alarms you can believe)

```
You are the session named Watchtower.

Repo: sidney-afk/client-analytics. Read CLAUDE.md, AGENTS.md and
docs/STATE_OF_THINGS.md first, then docs/plans/2026-10-09-token-budget-opportunities.md
(sections 2 and project 1). Goal: every alarm the owner receives means a real
problem now, and the things that matter most have an alarm.

Work on ONE branch and open ONE pull request. Do not merge it. Do not deploy,
apply migrations, flip switches or edit n8n; write the owner's steps instead,
with direct Actions links. Any live write only on the test client sidneylaruel.
No client names or slugs anywhere (code, comments, tests, commits, PR text).

Do, in this order, measuring before you change anything:
1. Lane ticker: .github/workflows/lane-ticker.yml line 55 asks
   `gh workflow view --json`, which is not supported, so every run stops in
   seconds and still shows green. Fix the state check, and make the run fail
   (red) if it stops early for any reason other than the workflow being
   disabled. Prove with a real run log that it now stays up.
2. Typed alarms: the nightly Calendar and Samples robots and the morning check
   send plain text that the relay drops (OPEN_REPAIRS 328). Send them in the
   typed form the relay reads.
3. Re-page when the reason changes: scripts/monitoring-watchdog.js pages once
   per lane until it recovers. Page again when the failing step changes.
4. Backup: track-b-backup alerts by GitHub email only. Add it to the pager.
5. New watchers (read-only queries): client posts (tiktok_uploads,
   instagram_uploads: "scheduled" over 1 hour past its time, "processing" or
   "uploading" over 1 hour, any new "failed"), and failed-save log spikes
   (write_refusal_diagnostics; alert on a single request retried more than 20
   times, the shape of OPEN_REPAIRS 382).
6. Make the alert digest (OPEN_REPAIRS 328) include 4 and 5, so switching it on
   is one owner step.

Every change gets a test that fails on the old code. Run
`node scripts/repo-identity-exposure-check.js --diff="origin/main"` after
committing and the relevant suites. Append one OPEN_REPAIRS entry (check for a
duplicate number after any merge of main). Update docs/STATE_OF_THINGS.md.

At the end, report in plain English: what changed, what the owner must do
(with direct links), and the REAL last lines of every check you ran, copied,
not summarized. State your token usage.
```

### Prompt 2: Shipwright (ship what is already built)

```
You are the session named Shipwright.

Repo: sidney-afk/client-analytics. Read CLAUDE.md (especially the capture
ritual and "do not merge between handing over a deploy SHA and the dispatch"),
AGENTS.md, docs/STATE_OF_THINGS.md, then
docs/plans/2026-10-09-token-budget-opportunities.md (section 1 and project 2).
Goal: no finished fix sits unshipped without the owner knowing and choosing.

Work on ONE branch and open ONE pull request. Do not merge it. This session is
READ ONLY on live systems: SELECT queries, function lists, GitHub run history.
Never deploy, apply, flip or edit n8n. Test client sidneylaruel only if any
check needs a client. No client names or slugs anywhere.

Do:
1. For every docs/ops/OPEN_REPAIRS.md entry from 280 to the newest whose
   header or body says built / not deployed / not applied / not merged / not
   flipped, find out the truth: is the page part on main? Is each function's
   live version equal to main (use scripts/ef-fingerprint.js the way the deploy
   lanes do)? Is each migration's effect present in the live database? Is each
   switch set? Write one table: entry, what is waiting, live state measured,
   owner step, risk, way back.
2. Do NOT rewrite old entries. Append one new entry that records the measured
   status of each, and fix docs/STATE_OF_THINGS.md lines that are wrong.
3. Write docs/ops/OWNER_SHIP_LIST.md: one ordered sitting for the owner,
   grouped so one deploy carries everything for that function (for example one
   Section 4 dispatch for OPEN_REPAIRS 290, 326, 381 and 382, with 381's pin
   change first). Backup first (387). Give direct Actions links and say which
   steps need the capture script. Mark anything the owner might want to hold.
4. Add a read-only script (and a test for it) that prints "repo vs live" for
   functions, migrations and switches, so the shelf stays visible. It must not
   print secrets or client names.

Run `node scripts/repo-identity-exposure-check.js --diff="origin/main"` after
committing, plus the tests you touched. At the end, report in plain English
with the REAL last lines of each check copied, not summarized, the number of
items still waiting, and your token usage.
```

### Prompt 3: Gatekeeper (prove the client paths again)

```
You are the session named Gatekeeper.

Repo: sidney-afk/client-analytics. Read CLAUDE.md, AGENTS.md (especially the
FROZEN client write gate: never re-gate calendar-upsert or sample-review-upsert),
docs/STATE_OF_THINGS.md, docs/QUALITY_TIERS.md, docs/testing/ASSURANCE_LEDGER.md,
OPEN_REPAIRS 205, 329 and 373, then
docs/plans/2026-10-09-token-budget-opportunities.md (section 3, project 3).
Goal: the client-facing paths are freshly proven before 2026-10-15 and stay
proven by robots that are green.

Work on ONE branch and open ONE pull request. Do not merge it. Live writes
ONLY on the test client sidneylaruel. Do not deploy, apply migrations, flip
switches or edit n8n; write the owner's steps with direct Actions links. No
client names or slugs anywhere (only the test client).

Do:
1. Samples nightly robot: the 2026-10-09 run failed 6 of 210, all on Kasper's
   approval not moving the status. Decide, with evidence, whether it is a real
   product bug or a test bug. If real, fix it with a test that fails on the
   old code. If test, fix the test.
2. Calendar nightly robot: no pass since 2026-08-25. Finish what OPEN_REPAIRS
   373 left (the owner steps it lists stay owner steps) and get it green
   against the test client.
3. Re-prove the Tier 0 rows in the assurance ledger whose proof is stale
   (client link load and saves, link issuance, client-visible thumbnails), in a
   real browser against the live site, on the test client. Record the proof
   the way the ledger requires.
4. Add a Samples approve flow to the morning check (owner asked 2026-09-22).
   Run `node docs/syncview-design/tests/prod-write-gateway-browser.js` before
   pushing any page change to Calendar or Production.

Run the repo identity check after committing:
`node scripts/repo-identity-exposure-check.js --diff="origin/main"`.
Append one OPEN_REPAIRS entry; update docs/STATE_OF_THINGS.md. At the end,
report in plain English, with the REAL last lines of every check and robot
run copied, not summarized, links to the runs, and your token usage.
```
