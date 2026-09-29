# Making this repository private: the plan (2026-09-29)

Plan only. Nothing in GitHub settings, workflows or Supabase was changed to write
it. Replaces the "stay public" decision in
`docs/ops/REPO_PRIVATE_COST_STUDY_2026-09-24.md` (owner, 2026-09-29, priority
item 6 in `docs/STATE_OF_THINGS.md`). Author: Atlas. Counts only, no client or
staff names.

## Summary for the owner

**Going private is doable, but not for free, and moving the scheduled jobs to
Supabase is not what makes it cheap.** Three things you should know:

1. **The bill is driven by tests on pull requests, not by scheduled jobs.** In
   the last 7 days GitHub would have billed **31,579 minutes** of automation,
   about **135,000 a month**. Your Pro plan includes 3,000. At today's pace
   that is roughly **$790 a month** in overage. Nine tenths of it is the
   automatic checks that run every time a session opens or updates a pull
   request (about 43 pull requests a day). Every scheduled job put together
   (the ones we could move to Supabase) is only about 2 percent, roughly $13 a
   month. So moving them to Supabase is worth doing for reliability (GitHub runs
   timers hours late; Supabase runs them on time), but it will not get the bill
   down.
2. **What does get the bill down:** (a) stop wasting runs, for example cancel a
   check when a newer push replaces it and skip the heavy browser checks on
   documentation-only changes; this is free and safe to do now, while the repo
   is still public and minutes are free; then (b) run the remaining checks on
   **a computer we own** (a "self-hosted runner": a rented server that GitHub
   sends the jobs to; its minutes are not billed). Expected total after both:
   **about $40 to $110 a month all-in** (the server plus a few dollars of GitHub
   overage). The earlier study said $10 to $15; that was sized for half of today's
   volume and one small server, so treat it as too low.
3. **A hidden problem: the live website currently publishes the whole
   repository.** I checked: `syncview.synchrosocial.com/docs/...`,
   `/CLAUDE.md`, `/scripts/...`, `/migrations/...` and
   `/supabase/functions/...` all open for anyone today. Going private on
   GitHub would hide the repository page but **not** those copies, because the
   site is built straight from the repo and GitHub's private-site option
   (site visible only to team members) needs an Enterprise plan. Before
   the switch, the site must be changed to publish only the files the app
   needs (pages, scripts, images). This can be done and tested while the repo
   is still public, and undone in one setting.

**Recommendation:** do it, in this order: fix the site publishing, trim wasted
runs, move the scheduled jobs whose timing matters, set up the server, then
flip to private with a written way back at every step. You decide three things
(section 9): accept about $40 to $110 a month, whether to keep the identity
check after the switch, and which day to flip.

**Do not flip to private before the site publishing fix and the spending
limit are in place.** Without them you either publish the repository anyway or
get billed about $790.

---

## 1. What I checked against the repo as it is today

| Claim in the study or backlog | Today | Verdict |
|---|---|---|
| 47 workflows | **50** files in `.github/workflows/` (new since 09-24: `clients-roster-sync`, `dawn-check`, `lane-ticker`, `sheets-mirror-daily`) | Out of date |
| About 72,700 billed minutes a month | **About 135,300** (31,579 billed in the last 7 days, per job, rounded up per job as GitHub bills) | Nearly doubled; PR volume rose (302 pull request branches in 7 days, about 94 billed minutes each) |
| PR checks are roughly three quarters of minutes | **89.8 percent** | Worse |
| About $420 a month in overage on Pro | **About $790 a month** at today's pace | Out of date |
| Self-hosted runner: $5 to $10 a month, one small server | 121,500 minutes a month of PR checks is about 2.8 machines busy around the clock, more at peak. Needs a mid-size server (or two), plus Docker for the test database | Undersized; see section 3 |
| Pages is not the expensive part | True for the bill (the GitHub Pages build is about 3,700 minutes a month), but the site serves the **whole repo** (section 5.1) | Incomplete |
| Moving schedules to pg_cron saves little now | Confirmed: about 2,100 minutes a month (about $13) | Correct |
| Removed Linear workflows still appear in the 30-day totals | Confirmed: they stopped running; last-7-day figures exclude them | Correct, use the 7-day pace |
| Owner is on GitHub Pro | **Not verifiable from here** (the token cannot read the plan). The account is a personal one (`sidney-afk`, not an organization) | Confirm at github.com/settings/billing (step 0) |
| `lane-ticker` keeps the frequent lanes on time | It ran 4 times in 30 days and each run finished in **under 15 seconds**, not the 5 hours 40 minutes its header describes. I did not read its logs; the likely cause is that its first check of its own state fails and it stops. The lanes it feeds still run at GitHub's best effort | Not doing its job; retire it when its lanes move (wave 1) |
| Repo is public with no forks | **0 forks, 0 stars, 0 watchers** | Good: nothing public can outlive the switch as a fork |
| `main` is protected | Ruleset `protect-main` is active (no deletion, no force push, pull request required, 0 approvals). Rulesets keep working on a private repo on Pro | Fine |

How the minutes were measured: every run from 2026-08-30 to 2026-09-29 (20,224
runs) from the Actions history; for the last 7 days (4,977 completed runs,
12,007 jobs) each job's time was fetched and rounded up to a whole minute, as
GitHub bills. The 30-day run wall time is 57,203 minutes but includes the
Linear lanes that ended on 09-24, so the 7-day pace is the honest one. The 7
days end today (09-29), a heavy build week; a quiet week will be lower. Rate: $0.006
per minute for the standard Linux runner (GitHub docs, read 2026-09-29).

## 2. Every workflow: how often, and measured minutes

"Runs 30d" is measured. "Billed min/mo" is the last-7-day billed minutes times
30/7. The verdicts follow the table: **STAY** = must stay on GitHub, **MOVE** =
candidate for Supabase, **RUNNER** = keep the workflow but run it on our own
server.

| Workflow file | Triggers | Runs 30d | Billed min/mo |
|---|---|---:|---:|
| `assurance-ledger-freshness` | cron `37 7 * * *`, push main, manual | 36 | 43 |
| `calendar-e2e-nightly` | cron `0 8 * * *`, manual | 31 | 3,557 |
| `calendar-unit-tests` | PR, push main | 2648 | 74,966 |
| `card-calendar-status-drift` | cron `27 * * * *`, push main, manual | 244 | 823 |
| `client-entry-visible-boot` | PR, push main, manual | 1359 | 4,509 |
| `client-signoff-reconcile` | manual | 3 | 0 |
| `clients-roster-sync` | cron `41 6 * * *`, manual | 3 | 13 |
| `crosswalk-phase2-repair` | manual | 5 | 0 |
| `dawn-check` | cron `30 11 * * 1-5`, manual | 15 | 176 |
| `deploy-client-review-link` | manual | 0 | 0 |
| `deploy-description-image-upload` | push main, manual | 8 | 26 |
| `deploy-f27-section4-closures` | manual | 19 | 43 |
| `deploy-hiring-applications` | manual | 4 | 0 |
| `deploy-hiring-automation` | manual | 1 | 0 |
| `deploy-onboarding-edge-functions` | push main, manual | 14 | 4 |
| `deploy-pto-edge-functions` | push main, manual | 0 | 0 |
| `deploy-single-function` | manual | 37 | 159 |
| `deploy-thumbnail-edge-functions` | push main, manual | 9 | 26 |
| `edge-function-type-ratchet` | PR, push main | 504 | 1,080 |
| `f27-post-contract-capture` | manual | 0 | 0 |
| `f27-team-rollback-proof` | PR, manual | 228 | 51 |
| `f42-apply-rehearsal` | PR, manual | 147 | 0 |
| `f42-card-comment-import` | manual | 0 | 0 |
| `graphics-f2-evidence` | PR, manual | 12 | 26 |
| `graphics-f2-preflight` | manual | 0 | 0 |
| `lane-ticker` | cron `41 * * * *`, manual | 4 | 17 |
| `linear-deliverables-reconcile` | manual | 671 | 0 |
| `linear-exit-preparation-ci` | PR | 867 | 11,207 |
| `linear-outbound-drain` | manual, repo dispatch | 2229 | 0 |
| `monitoring-crosscheck` | cron `*/20 * * * *`, manual | 133 | 159 |
| `monitoring-cutover-proof` | manual | 1 | 9 |
| `monitoring-deadman` | cron `*/15 * * * *`, manual | 202 | 167 |
| `n8n-execution-quota-watchdog` | cron `17 13 * * *`, manual | 31 | 30 |
| `native-intake-completion-monitor` | cron `12,27,42,57 * * * *`, manual | 73 | 176 |
| `native-intake-completion` | cron `5,20,35,50 * * * *`, manual | 71 | 163 |
| `native-notification-monitor` | cron `2-59/5 * * * *`, manual | 73 | 167 |
| `native-notification-preview` | manual | 2 | 9 |
| `native-notification-sender` | cron `*/5 * * * *`, manual | 74 | 167 |
| `outbox-debt-census` | cron `13,43 * * * *`, manual | 68 | 159 |
| `production-polish-gate` | cron `17 9 * * 1-5`, PR, push main, manual | 1430 | 20,769 |
| `pto-ui-tests` | PR, push main, manual | 1347 | 6,711 |
| `rename-propagation-drain` | cron `*/5 * * * *`, manual | 35 | 150 |
| `samples-e2e-nightly` | cron `0 6 * * *`, manual | 31 | 1,157 |
| `sheets-mirror-daily` | cron `23 9 * * *`, manual | 2 | 17 |
| `syncview-retirement-census` | cron `19,49 * * * *`, manual | 70 | 159 |
| `thumbnail-revision-scan` | cron `*/10 * * * *`, manual | 207 | 407 |
| `tiktok-carousel-browser-journey` | PR, push main, manual | 936 | 2,447 |
| `track-b-backup` | cron `23 */6 * * *`, manual | 119 | 1,839 |
| `track-b-recovery-rehearsal` | manual | 0 | 0 |
| `workload-source-freshness` | manual | 54 | 94 |

Category totals (last 7 days, billed): pull-request and push checks **28,344
(89.8 percent, 121,500/mo)**; nightly browser runs **1,209 (5,200/mo)**; the
GitHub Pages build **854 (3,700/mo)**; Track-B backup **429 (1,800/mo)**;
everything else, scheduled monitors and deploy lanes together, **743 (3,200/mo)**.

### Verdict per workflow

**PR checks: RUNNER (after trimming).** `calendar-unit-tests` (6 jobs, 74,966
min/mo, 59 percent of the whole bill; no cancel of superseded runs, no path
filter, runs again on every merge to main), `production-polish-gate` (20,769),
`linear-exit-preparation-ci` (11,207), `pto-ui-tests` (6,711),
`client-entry-visible-boot` (4,509), `tiktok-carousel-browser-journey` (2,447),
`edge-function-type-ratchet`, `f27-team-rollback-proof`, `f42-apply-rehearsal`,
`graphics-f2-evidence`. They only exist on GitHub, so they cannot go to Supabase.

**Nightly browsers: RUNNER.** `calendar-e2e-nightly`, `samples-e2e-nightly`,
`dawn-check`, plus the weekday cron of `production-polish-gate`. They drive a
real browser; Supabase cannot host that.

**Scheduled monitors and drains: see section 4.**

**Deploy and manual lanes (about 20 workflows, under 300 min/mo together): STAY.**
They need your click and GitHub secrets (`deploy-*`, `f27-*`, `f42-*`,
`graphics-f2-*`, `crosswalk-phase2-repair`, `client-signoff-reconcile`,
`linear-*`, `monitoring-cutover-proof`, `native-notification-preview`,
`track-b-recovery-rehearsal`, `workload-source-freshness`).

## 3. What going private costs in Actions minutes on Pro

Pro: 3,000 included minutes a month, $0.006 a minute after. Public repos are
unmetered, which is why none of this matters today.

| Scenario | Billed min/mo | Overage/mo | Notes |
|---|---:|---:|---|
| A. Flip today, change nothing | 135,300 | **about $794** | Not acceptable |
| B. A, plus move every movable scheduled job to Supabase | about 133,200 | about $781 | Saves $13; the owner's original idea, not the lever |
| C. B, plus trim wasted runs (target) | about 60,000 to 80,000 | about $340 to $460 | **Estimate, not measured.** See 3.1 |
| D. C, plus PR checks and nightly browsers on our own server | about 8,000 to 9,000, trimming leaves about 5,000 | **about $0 to $30** GitHub overage, plus the server | Server $40 to $80/mo (estimate: 4 to 8 CPU cores, 16 GB RAM, Docker) |
| E. Stay public | 0 | $0 | Still available; the site-publishing fix (5.1) is useful either way |

**Recommended: D.** Expected all-in **$40 to $110 a month** at today's volume
(server plus small overage), versus about $790 for A. The server must be sized
from a measured peak: 43 pull requests a day in bursts, each fanning out into
6 to 10 jobs.

Also settle before the switch:
* **Spending limit $0** on Actions (GitHub billing budgets) so a miscount stops
  jobs instead of billing. Set on the day of the switch, not before.
* **Artifact storage:** the repo holds about **1.6 GB** of live workflow
  artifacts (2,588 listed, 14 to 30 day retention). Private repos have a quota
  (about 1 GB on Pro; confirm on the billing page) and overage is billed. Cut
  retention to 3 days on all upload steps and prune before the switch.
* **The self-hosted runner never runs on a public repo.** Anyone's pull request
  could run code on it. Register it only after the repo is private (step 9).

### 3.1 Trimming wasted runs (safe now, free while public)

Each is one small pull request, measured against a week of runs before and after:
1. `concurrency` with `cancel-in-progress: true` on `calendar-unit-tests` and
   `linear-exit-preparation-ci` (four other PR workflows already have it). A
   burst of pushes to one pull request currently runs every one to the end.
2. Path filters on `calendar-unit-tests` (a documentation-only change runs 6
   jobs today) and on `linear-exit-preparation-ci`.
3. Stop re-running the whole suite on `push: main` for changes that already
   passed on the pull request (539 runs a month of `calendar-unit-tests` alone),
   or keep only a cheap smoke job there.
4. Cache Playwright and npm downloads (each browser job re-installs).
5. Drop the GitHub Pages branch build (3,700 min/mo) when the deploy moves to
   the workflow in 5.1, which builds nothing and uploads a folder.

Owner review point: (2) and (3) reduce how often a full test runs. Both keep the
suite as the merge gate; I propose making the full suite run at "ready for
review" and on the merge, not on every push to a draft. That is the owner's call.

## 4. Scheduled jobs: what moves off Actions, in order, and what stays

Facts from the live database (read-only, 2026-09-29): `pg_cron` 1.6.4 is
installed and already runs 3 jobs (including one every 10 seconds); `pg_net`
(lets the database call an Edge Function) is available but **not yet enabled**;
`supabase_vault` (encrypted secrets) is installed. Every monitored lane writes a
`monitoring_heartbeat` row to `deliverable_events` (see
`scripts/monitoring-watchdog.js`); a moved lane must write the same row itself so
the dead-man's switch keeps seeing it.

Why move at all: GitHub scheduling is best effort. Measured: `*/5` crons fire
about 73 times in 30 days instead of 8,640, which is why `lane-ticker` was built
and why it is not enough. pg_cron runs on the second.

| Wave | Job | How it moves | Effort | Notes |
|---|---|---|---|---|
| 0 | `pg_net` | Enable the extension in a migration; store the runner keys in Vault | small | Prerequisite for waves 1 and 2. Reversible with `drop extension` |
| 1 | `rename-propagation-drain` | pg_cron calls the existing `rename_propagation_drain` function directly, every 5 min, in passes of 200 | small | Pure SQL already. Move its on/off from the repo variable to a `syncview_runtime_flags` row; keep the `rename_propagation` flag as is |
| 1 | `native-notification-sender` and `native-notification-monitor` | pg_cron plus pg_net POST to the existing `notify` function with the runner key from Vault | small | Same request the workflow sends today. Still dormant until the enable flag flips, and the move itself does not enable sending (AGENTS.md owner directive: nothing to client channels) |
| 1 | `thumbnail-revision-scan` | pg_cron plus pg_net calling the existing `thumbnail-revision-scan` Edge Function every 10 min with its signature header | small to medium | The workflow only calls the function. One batch per tick instead of 12 batches per run; the function's own limit stays 25 |
| 2 | `native-intake-completion` and its monitor | Port the runner (`scripts/native-intake-completion/*`, `native-intake-reconcile/runner-lib`) into an Edge Function, then pg_cron | medium | Needs its own test; keep the workflow until the parity check passes |
| 2 | Retire `lane-ticker` | Delete after waves 1 and 2 | tiny | Its lanes no longer need a ticker |
| 3 | `card-calendar-status-drift` | Port `scripts/card-calendar-status-drift-check.js` (550 lines; its test loads `index.html`) | medium to large | About 820 min/mo, the biggest scheduled saving. Move last |
| 3 | `syncview-retirement-census`, `outbox-debt-census` | Decision: they are **dormant** (their step says so and they only heartbeat). Retire both and their heartbeat rows, or leave dormant | tiny | Owner or Lighthouse call; about 320 min/mo of nothing |
| Stay | `monitoring-deadman`, `monitoring-crosscheck` | Stay on GitHub | none | They exist to watch Supabase from a second place; moving them in defeats the point |
| Stay | `track-b-backup` (1,800 min/mo) | Stay, on the self-hosted server after step 9 | none | A backup of the database must not run inside the database. Could go from every 6 h to every 12 h to halve it; owner call |
| Stay | `assurance-ledger-freshness` | Stay | none | Reads repo documents; runs once a day |
| Stay | `n8n-execution-quota-watchdog`, `clients-roster-sync`, `sheets-mirror-daily` | Stay (30, 13 and 17 min/mo) | none | Daily, reach outside Supabase (n8n, Google Sheets), negligible minutes. The cost study called the watchdog a candidate; it is 30 minutes a month and needs n8n and an Actions cache, so not worth it |
| Stay | `dawn-check`, both nightly browser suites | Self-hosted runner | none | Real browsers |

Order rationale: wave 1 needs no new code, moves the jobs whose lateness
hurts (notifications, drains), and each can be turned back on in the workflow by
re-enabling its cron. Wave 2 needs a port plus a parity test. Wave 3 is the
most code for the least gain.

Rules for every move: (1) the workflow stays in place with its schedule
**commented out, not deleted**, until the moved job has written correct
heartbeats for 7 days; (2) the dead-man's switch is the acceptance test: no lane
may show stale during the overlap; (3) mutate only the test client during
checks; (4) a moved job's key never sits in a migration file or in the cron
command text, only in Vault.

## 5. What breaks when the repo is private

### 5.1 GitHub Pages (the one that matters most)
* **Pages from a private repo works on Pro**, but the site stays **publicly
  reachable**; restricting it to logged-in members needs Enterprise Cloud (GitHub
  docs, read 2026-09-29). Nothing about the app's public URLs changes, which is
  what we want.
* **Today the site is built from the branch root and publishes everything.** I
  fetched these live on 2026-09-29, all HTTP 200: `/docs/STATE_OF_THINGS.md`,
  `/CLAUDE.md`, `/package.json`, `/scripts/repo-identity-exposure-check.js`,
  `/migrations/*.sql`, `/supabase/functions/brain/index.ts`. (`/.github/...`
  and `/n8n-backups/` returned 404.) Going private without changing this
  leaves the repository readable at the site address. The repo cannot be
  called private until this is fixed.
* **Fix:** switch Pages to **"GitHub Actions" as the source** and deploy an
  explicit allowlist: the root `*.html` pages, `404.html`, `CNAME`, `js/`,
  `nav-icons/`, `onboarding-*` media, `thumbnails/`, `thumbnail-styles/`, the
  favicons and logos. Nothing under `docs/`, `scripts/`, `migrations/`,
  `supabase/`, `test/`, `qa/`, `n8n-backups/`, `*.md`, `package.json`. Check the
  list against a crawl of the live site first; keep every old hashed file in
  `js/` (staff on an old page still load them). Nothing in the repo fetches the
  site's docs paths (searched `scripts`, `test`, `qa`, `supabase`, `js`, `src`).
* The custom domain (`CNAME`) must survive the source change: confirm the domain
  still shows "DNS check successful" and HTTPS still enforced after the switch,
  before going private.
* The deploy uses the `deploy-pages` workflow (a few minutes on push to `main`,
  cheaper than the branch build) and can run on the self-hosted server too.

### 5.2 Public raw links and repo links
* `raw.githubusercontent.com` and `github.com` links to this repo stop working
  for anyone not logged in with access. Searched the four repositories in this
  session's scope: **no code fetches this repo by raw link.** Runtime GitHub
  API calls in `brain` and `higgsfield-mcp` read the separate
  `synchro-brain` repo with their own token, not this one.
* 50 files under `docs/` mention repo paths or links, and `synchro-pipelines`
  points at `client-analytics` for the connector code; those links will 404 for
  people without access. Staff or contractors who only have a shared link need
  a GitHub seat or a copy in Drive. Check who has opened links from Slack.
* Anything outside the repo that starts a workflow here (the `linear-outbound-drain`
  lane accepts a repository dispatch; old n8n backups in this repo show n8n
  calling the GitHub API for that) needs a token with access to the private repo.
  Check the n8n list read-only before the switch; do not edit n8n without the
  owner's go.

### 5.3 The identity check and the "public repo" rules
* `scripts/repo-identity-exposure-check.js` exists because the repo is public
  and the roster is in it (45 of 50 identifying terms in the tree, measured
  2026-09-02). Going private stops *new* exposure to strangers; it does **not**
  remove what is already in git history, in anyone's earlier clone, or in a
  search engine's cache. There are no forks, which helps.
* Recommendation: **keep the gate running through the switch and for 30 days
  after**, then decide with the owner whether to keep it as a warning, since
  the repo may be made public again or shared with a contractor. It is a
  5-minute job inside `calendar-unit-tests`; dropping it saves about nothing.
* `CLAUDE.md`, `AGENTS.md`, the `synchro-brain` policy and `synchrosocial`
  docs say "this repository is public". They change **after** step 11, in one
  documentation pull request, not before.
* The owner's rule "no secrets in code" does not relax: private is not a
  secrets store.

### 5.4 Codex review
Codex runs as a GitHub-connected review on open, ready-for-review and
`@codex review` (AGENTS.md). Access to a private repo needs the connector
authorized for it on the owner's ChatGPT/Codex side. I cannot verify that from
here. Test: right after the switch, open a one-line documentation pull request
and confirm Codex answers. If not, re-authorize the repo in Codex settings;
that is a per-repo toggle, not a code change. The "do not merge inside a review
window" rule stays.

### 5.5 Claude sessions
* This session's GitHub access is scoped by repository and goes through the
  Claude GitHub App and the session proxy, which work for private repos the
  App is installed on. The App must be installed on this repo with private
  access (owner check on the App's installation page). Claude Approvals and
  Claude Code Review are Apps too; same check.
* Anything a session fetches without the proxy (unauthenticated `curl` to
  `github.com` or `raw.githubusercontent.com`) stops working. Sessions should
  clone through the tools they already use.
* Fresh cloud sessions clone the repo at start; if the App were missing, they
  fail at clone with a clear error, which is the first sign in the way back.

### 5.6 Smaller items
* **Actions logs and artifacts** become private (an improvement) and count
  against the storage quota (section 3).
* **Ruleset `protect-main`** keeps working. Merge behaviour is unchanged.
* **Secret scanning push protection** is a paid add-on on private repos; today
  it is free because the repo is public. The existing rule (no secrets in
  commits) becomes the only guard. Confirm whether the owner wants the add-on.
* **`pages-build-deployment`** disappears when Pages moves to Actions; any
  dashboard or doc that names it needs an edit.

## 6. Step-by-step switch-over, with a way back

Nothing in steps 0 to 8 makes the repo private, so all of them are reversible by
reverting a pull request or one setting. Only step 9 changes visibility.

| # | Step | Who | Way back |
|---|---|---|---|
| 0 | Confirm the account is on Pro at github.com/settings/billing; note Actions minutes included, artifact quota, current spend; confirm the Claude, Codex and Approvals apps can be granted private access | Owner | Nothing changed |
| 1 | Trim wasted runs (3.1) in small pull requests; measure a week of before and after billed minutes | Session | Revert each pull request |
| 2 | Publish an allowlisted site (5.1) via a new deploy workflow **while the repo is public**, on a test branch first; compare the served file list to the allowlist; confirm every app URL, hashed script, client link and the `404.html` fallback still work and `/docs/`, `/CLAUDE.md`, `/scripts/`, `/migrations/` now return 404 | Session, owner clicks the Pages source setting | Settings, Pages, Source back to "Deploy from a branch, main, root" (takes about a minute to republish) |
| 3 | Wave 0 and wave 1 of section 4 (pg_net, Vault, rename drain, notification sender and monitor, thumbnail scan). Keep the workflow crons commented, not deleted | Session, Lighthouse merges | Uncomment the cron in each workflow; `cron.unschedule('<name>')` |
| 4 | Watch 7 days: dead-man's switch shows no stale lane; heartbeats present | Lighthouse | As step 3 |
| 5 | Waves 2 and 3 (intake completion, drift, retire `lane-ticker` and the dormant censuses) as separate pull requests, each with a parity test | Session | Same |
| 6 | Provision the self-hosted runner server (Linux, Docker, Playwright browsers, Node 22, 4 to 8 cores). **Do not register it yet.** Prepare the runner install steps and a way to alert when it is offline | Owner buys, session writes the runbook | Cancel the server |
| 7 | Change every PR and nightly workflow to `runs-on: ${{ vars.CI_RUNNER \|\| 'ubuntu-latest' }}` so a repository variable picks the runner. Merge with the variable unset (nothing changes) | Session | Revert |
| 8 | Prune artifacts and set retention to 3 days; lower `Actions` artifact quota use below the private-repo limit. Dry-run the 30-day counts | Session | n/a |
| 9 | **Day of the switch** (a quiet day, no deploy handed over; the Section 4 rule against merging between a deploy SHA and dispatch applies). In order: (a) set the Actions spending limit to $0; (b) settings, General, Danger Zone, Change visibility, **Make private**; (c) register the runner on the now-private repo; (d) set repository variable `CI_RUNNER` to the runner label | Owner clicks; session prepares the exact text | See "Way back from private" below |
| 10 | Verify within the hour: site loads at the domain with HTTPS; Pages still redeploys on a merge; one client review link and one staff sign-in work; a pull request runs all checks on the runner; Codex answers a test pull request; a fresh Claude session clones; `raw.githubusercontent.com/...` from a logged-out browser returns 404; the Actions billing page shows $0 spend | Owner and Vigil | As below |
| 11 | After 30 days: update the "public repo" wording (5.3), the cost study, `STATE_OF_THINGS.md`; decide on keeping the identity gate | Session | n/a |

### Way back from private
1. **Instant, no billing risk:** clear the `CI_RUNNER` variable if the server
   is the problem; jobs fall back to GitHub runners (billed, but the spending
   limit at $0 stops them instead of billing, so checks would stall rather than
   cost). Raise the limit only if you accept the cost.
2. **Flip visibility back:** Settings, General, Danger Zone, Change visibility,
   **Make public**. Actions minutes are unmetered again. The site source stays
   the allowlisted deploy, which is fine public or private.
3. **Site broken:** Settings, Pages, Source back to the branch. (Restores the
   whole-repo publishing, so do this only as an emergency.)
4. **Moved job misbehaving:** `cron.unschedule('<name>')` plus uncomment the
   cron in the workflow file.
5. **Note:** making it private then public again does not restore stars or
   watchers (there are none) and re-exposes history exactly as before; nothing
   is lost.

Test the way back before the day: run step 2's revert once on the test branch
so the setting is known to work.

## 7. Risks and unknowns

* **Plan and quotas unverified** (step 0). If the account is not on Pro, Pages
  from a private repo does not work and step 9 must not happen.
* **The 7-day pace is a heavy week.** Re-measure at step 8; the server size and
  spending limit depend on it.
* **Self-hosted runner** is a machine to patch, monitor and back up; when it is
  down, checks stall and merges wait. Decide who owns it. The platform's
  self-hosted pricing could change; re-read GitHub's billing page at step 6
  (the current doc page I fetched does not state a self-hosted charge, and the
  earlier study quoted "free").
* **Trimming (3.1) changes the merge gate.** It needs the owner's sign-off on
  which checks run when.
* **The dead-man's switch** can go noisy during overlap; that is the signal, not
  the fault.
* **History stays exposed** to anyone who cloned earlier (5.3).

## 8. What I did not do

No settings were changed, no workflow edited, no migration applied, no n8n
touched. Queries against Supabase were read-only (installed extensions, the list
of cron jobs). The billing plan and GitHub app installations could not be read
from this session.

## 9. Decisions for the owner

1. Accept about **$40 to $110 a month** all-in (server plus small overage) for a
   private repo, versus $0 public? (The site-publishing fix is worth doing even
   if the answer is no.)
2. Approve trimming the checks (3.1), in particular running the full suite at
   "ready for review" and on merge rather than on every push?
3. Keep the identity gate for 30 days after the switch, then review?
4. Retire the two dormant censuses and `lane-ticker`?
5. Track-B backup every 6 hours or every 12?
6. A day for step 9, and who owns the server after that.
