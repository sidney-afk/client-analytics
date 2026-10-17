'use strict';
/*
 * Pull-request runner seats (2026-10-17, session Throttle).
 *
 * The account runs at most 20 jobs at once, and the production lanes on main
 * (the notification sender, the rename drain, the scans, every 5 minutes) share
 * those 20 with every pull-request run. After the Calendar unit tests were split
 * into parts, one pull-request push started about 19 browser jobs at once, and a
 * few open pull requests filled every runner: over the 48 hours to 2026-10-17
 * 15:20 UTC the account sat at 20 jobs for 936 minutes, and a sender run waited
 * up to 48 minutes for a runner (90 of its 589 runs were cancelled while waiting).
 *
 * What must hold, from the workflow text:
 *   1. every slow job of calendar-unit-tests.yml holds a seat on a pull request:
 *      a job-level concurrency group named pr-runner-seat-*, with
 *      cancel-in-progress false and `queue: max`, so later jobs wait in line
 *      and none is ever cancelled for a seat;
 *   2. there are at most MAX_SEATS seats, counted from the matrices, so pull
 *      requests can never hold more than that many heavy runners together;
 *   3. a push to main or a manual run never waits for a seat: its group is
 *      unique to the run, the job and the matrix leg;
 *   4. only the short jobs named in QUICK run without a seat, and they stay short;
 *   5. a newer push to a pull request still cancels the run it replaces, so a
 *      superseded run gives its seats back;
 *   6. no other workflow uses a seat name, and no seat group can cancel.
 * Offline: reads files only.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { jobBlock } = require('../scripts/ci-changes');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, '.github/workflows');
const WF = fs.readFileSync(path.join(WF_DIR, 'calendar-unit-tests.yml'), 'utf8');
// 14 since 2026-10-17 19:30 UTC (Lighthouse): the three unit parts got a seat each. With one shared unit seat,
// every pull request's three unit parts ran one after another across all PRs, and PRs waited about an hour.
const MAX_SEATS = 14;
// Jobs that may run without a seat: each finishes in about a minute.
const QUICK = new Set(['changes', 'identity-exposure', 'module-check', 'f27-team-rollback-proof', 'calendar-ci-result']);
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks++; }

const jobIds = [...WF.slice(WF.indexOf('\njobs:\n')).matchAll(/\n {2}([A-Za-z0-9_-]+):\n/g)].map(m => m[1]);
ok(jobIds.length >= 10, 'found the jobs of calendar-unit-tests.yml');

function matrix(block) {
  const m = {};
  const at = block.indexOf('\n      matrix:\n');
  if (at < 0) return m;
  for (const line of block.slice(at).split('\n').slice(2)) {
    const kv = /^ {8}([a-z_-]+): \[([^\]]*)\]$/.exec(line);
    if (!kv) break;
    m[kv[1]] = kv[2].split(',').map(x => x.trim());
  }
  return m;
}
function legs(mx) {
  let out = [{}];
  for (const [k, vals] of Object.entries(mx)) out = out.flatMap(o => vals.map(v => ({ ...o, [k]: v })));
  return out;
}
// The job id is written out: github.job is only set inside a job's steps and is
// null when the concurrency group is worked out, which would make leg 0 of every
// job share one group on main (Codex review on #2148).
const prSide = id => new RegExp("^\\$\\{\\{ github\\.event_name == 'pull_request' && (.+) \\|\\| format\\('calendar-unit-tests-\\{0\\}-" + id + "-\\{1\\}', github\\.run_id, strategy\\.job-index\\) \\}\\}$");

const seats = new Map();
for (const id of jobIds) {
  const block = jobBlock(WF, id);
  const conc = /\n {4}concurrency:\n {6}group: (.+)\n {6}cancel-in-progress: (.+)\n {6}queue: (.+)\n/.exec(block);
  if (QUICK.has(id)) {
    const timeout = Number((/\n {4}timeout-minutes: (\d+)/.exec(block) || [])[1]);
    ok(!conc && !/\n {4}strategy:/.test(block) && !/playwright/i.test(block) && timeout > 0 && timeout <= 10,
      `${id} is a quick job: no matrix, no browser, a timeout of 10 minutes or less, and no seat`);
    continue;
  }
  ok(conc, `${id} holds a pull-request runner seat (job-level concurrency with cancel-in-progress and queue)`);
  ok(conc[2] === 'false' && conc[3] === 'max', `${id}: its seat queues later jobs and never cancels one (cancel-in-progress: false, queue: max)`);
  const pr = prSide(id).exec(conc[1]);
  ok(pr, `${id}: on a pull request it takes a seat; anywhere else its group names this job outright and is unique to the run and leg`);
  ok(!conc[1].includes('github.job'), `${id}: its group does not use github.job (null outside steps)`);
  const expr = pr[1];
  for (const leg of legs(matrix(block))) {
    let name;
    const lit = /^'(pr-runner-seat-[a-z0-9-]+)'$/.exec(expr);
    const fmt = /^format\('(pr-runner-seat-[a-z0-9-]+)\{0\}', matrix\.([a-z_-]+)\)$/.exec(expr);
    if (lit) name = lit[1];
    else if (fmt) { ok(fmt[2] in leg, `${id}: its seat names a matrix key the job has (${fmt[2]})`); name = fmt[1] + leg[fmt[2]]; }
    else ok(false, `${id}: seat expression must be a literal or format('pr-runner-seat-...{0}', matrix.x): ${expr}`);
    if (!seats.has(name)) seats.set(name, []);
    seats.get(name).push(`${id} ${JSON.stringify(leg)}`);
  }
}
ok(seats.size > 0 && seats.size <= MAX_SEATS,
  `pull requests share at most ${MAX_SEATS} heavy runners: ${seats.size} seats (${[...seats.keys()].join(', ')})`);

// A newer push to a pull request cancels the run it replaces (and its queued
// seat jobs); main is never cancelled.
ok(/\nconcurrency:\n {2}group: calendar-unit-tests-\$\{\{ github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| github\.sha \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}\n/.test(WF),
  'a newer push to a pull request still cancels the run it replaces, so its seats free up; main runs are never cancelled');

// Seat names belong to this workflow alone, and no seat group anywhere can cancel.
for (const file of fs.readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f) && f !== 'calendar-unit-tests.yml')) {
  ok(!fs.readFileSync(path.join(WF_DIR, file), 'utf8').includes('pr-runner-seat-'), `${file} does not use a pull-request runner seat`);
}
const seatGroups = WF.match(/group: .*pr-runner-seat-.*\n.*\n.*\n/g) || [];
ok(seatGroups.length > 0 && seatGroups.every(g => /cancel-in-progress: false\n {6}queue: max\n$/.test(g)), 'every seat group queues and never cancels');

console.log(`ci-runner-seats: ${checks} checks passed (${seats.size} seats)`);
