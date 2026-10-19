# CI speed: from "PR opened" to green

Session Turbo, 2026-10-17 (PR #2136, OPEN_REPAIRS 428). Owner's goal: much faster pull request checks, no test
weakened, runner minutes are fine to spend.

## What was slow (measured on the Actions history, 2026-10-14 to 2026-10-17)

1,222 pull request runs, every job of every attempt. Durations are the job's own run time; queue time is separate.

| Check | Median | Worst | Runs with a failure | Failed, then passed on a re-run of the same commit |
|---|---|---|---|---|
| staff-phone-rules (390) | 36.7 min | 38.6 | 15 | 1 |
| staff-phone-rules (430) | 36.5 min | 39.0 | 11 | 0 |
| entry-links-boot | 31.4 min | 39.5 | 49 | 2 |
| split-preview | 12.7 min | 13.7 | 10 | 1 |
| unit | 11.5 min | 12.8 | 31 | 0 |
| browser-guards | 6.6 min | 18.3 | 20 | 2 |
| production-polish | 6.1 min | 8.8 | 30 | 14 |
| PTO synthetic-browser | 2.8 min | 4.6 | 5 | 1 |
| Pages build | 2.3 min | 3.6 | 0 | 0 |
| Edge Function type ratchet | 1.9 min | 2.2 | 7 | 0 |
| Client entry visible boot | 1.7 min | 2.6 | 2 | 0 |
| Linear exit preparation (4 jobs) | 1.1 to 1.4 min | 4.8 | 0 | 0 |
| TikTok carousel journey | 1.0 min | 3.3 | 2 | 2 |
| identity-exposure, module-check, f27 proof | under 1 min | 2.4 | 3 | 0 |

"Runs with a failure" includes real failures caused by the pull request. Most re-runs in this repo are new pushes,
not re-runs, so the last column undercounts flakes; the logs were read to find them (below).

Three more findings:

- **One step was most of the phone job.** In staff-phone-rules, "Existing staff phone state inventory" took 28 of the
  37 minutes (161 states, two themes). Splitting by step could not help; the script now splits itself (`--shard=k/n`).
- **entry-links-boot hit its 40-minute limit on main** and was cancelled on 4 of the 5 main pushes on 2026-10-16,
  with nothing failing.
- **Jobs wait for a free runner.** The account runs about 20 jobs at once (scheduled monitors take slots every few
  minutes). Queue time per job: median 47 s, 1 in 10 over 15 minutes, worst 1 h 42 min. On 2026-10-15, 1 job in 10
  waited 26 minutes or more. Superseded pushes kept running and held slots.

Per kind of pull request (median wall time from the first check queued to the last one finished, same window):

| Pull request | Pushes | Before (median, worst) |
|---|---|---|
| Docs only | 23 | 39 min, 69 min |
| One Edge Function (and its tests) | 17 | 40 min, 127 min |
| Page code (`src/index/`) | 112 | 41 min, 101 min |

## What changed (`.github/workflows/calendar-unit-tests.yml`)

1. **`changes` job, `scripts/ci-changes.js`.** On a pull request it decides whether the browser jobs
   (entry-links-boot, browser-guards, split-preview) and the staff phone matrix are needed. A file is skipped only when
   it sits in an area no browser suite reads (docs outside `docs/syncview-design`, Markdown, one Edge Function folder,
   migrations, unit tests, scripts, other workflows) **and** no suite the workflow starts reads it: the rule follows
   each suite's requires, the repository paths it names, and `path.join` paths (several suites load TikTok, PTO and
   Messages inbox Edge Function code). Page code, the build, `package.json`, the shared browser helpers and the
   workflow itself run everything. Anything unknown runs everything. **A push to main or a manual run always runs
   every suite.** Guarded by `test/ci-changes.js`.
2. **Parallel parts.** entry-links-boot in 3 parts, browser-guards in 2, staff-phone-rules in 2 parts per width,
   split-preview in 2, unit in 3 (`UNIT_SHARD=k/n` in `test/run-all.js`). Since 2026-10-19 (session Express) each
   browser part runs three of its suites side by side on its 4-CPU runner (`scripts/ci-lanes.js`; the suites mostly
   wait on timers), so the same suites need fewer, shorter jobs. `test/ci-shards-wired.js` fails when a lane
   command has no part, runs in two parts, names a part that does not exist, or the four quarters of the phone
   state inventory are not each run once per width; a unit job's count must match its parts.
3. **`calendar-ci-result`**: one check that is red when any job failed or was cancelled, and green when every job
   passed or was skipped as not needed. **This is the check to require** if the owner ever adds required checks: a
   matrix job that is skipped shows only its bare name, so requiring `entry-links-boot (1)` would stay pending.
   (Today the `protect-main` ruleset requires a pull request but no status checks.)
4. **A new push to a pull request cancels the run it replaces.** Main pushes are grouped by commit and never cancelled.
5. Suites inside a part keep running after one fails (`scripts/ci-lanes.js` runs every command and fails the job if any failed), so one red run names every broken suite.

Larger runners: not used. GitHub's larger runners need an organisation on the Team or Enterprise plan (this repository
belongs to a personal account), and they cost money per minute even on public repositories (about $0.032 a minute for
8 cores). The browser suites run one browser at a time, so more cores would not shorten them; more runners do.

## After (measured on GitHub, 2026-10-17)

Wall time from push to the last check finished, queue included, on PR #2136 and its measurement PR #2138 (closed):

| Pull request | Before (median) | After | Browser jobs | Notes |
|---|---|---|---|---|
| Docs only | 39 min | **11.4 min** | skipped, check green | unit parts 2.5 to 6.7 min |
| One Edge Function | 40 min | **16.1 min** | skipped, check green | 11 of the 16 minutes were waiting for a free runner |
| Page code (`src/index/`) | 41 min | **16.4 min** | all 23 jobs green | longest job 11.2 min (was 37) |

Per part on the page-code run: phone parts 9.7 to 10.5 min, entry-links parts 9.1 to 11.2, split-preview 5.2 and 8.0,
browser-guards 6.4, unit parts 3.2 to 4.6. Runner minutes for that workflow rose about 12% (about 155 against about 138),
mostly the per-job setup (checkout, build, browser install, about a minute each).

**The limit now is runner slots, not test time.** With no queue, the three kinds of PR finish in about 7, 7 and
12 minutes. At busy moments jobs wait 5 to 15 minutes for a slot, because the account runs about 20 jobs at once and
a page PR uses about 25 short jobs. If that wait becomes the problem, the options are: fewer phone parts (3 per width),
folding the four sub-minute jobs into one, or moving the scheduled monitors (which take a slot every few minutes) to
the database timer. None of them is needed to keep the gains above.

## Running everything by hand

[Calendar unit tests](https://github.com/sidney-afk/client-analytics/actions/workflows/calendar-unit-tests.yml), Run
workflow, pick the branch: a manual run always runs every suite.
