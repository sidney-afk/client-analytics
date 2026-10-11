'use strict';

/*
 * The schedule fallback guard never lets the PREVIOUS slot's timer run cover a
 * prompt GitHub copy (OPEN_REPAIRS 403, scripts/schedule-fallback-guard.js).
 *
 * The first version counted the slot before the newest one whenever GitHub's
 * copy arrived less than five minutes after its slot. If the database timer
 * died between two slots and GitHub delivered on time, the copy found the
 * timer's run from the slot before, stood down, and that slot never ran:
 *   - the Calendar nightly (08:00 daily): yesterday's 08:00 timer run
 *     "covered" today's 08:03 copy;
 *   - the dawn check (11:30 weekdays): Friday's timer run covered Monday's;
 *   - the private backup (every 6 hours at :23): 06:23 covered 12:25.
 * What must hold now: inside those five minutes only the newest slot counts.
 * The guard waits until slot + five minutes (capped), looks once more for that
 * slot only, and runs the job when the timer's run is still missing. Every
 * failure (a failed or slow API call, a failed wait) still means run=true.
 *
 * Each of the three scenarios fails against the first version and passes now.
 */

const fs = require('fs');
const path = require('path');
const guard = require('../scripts/schedule-fallback-guard.js');

const ROOT = path.join(__dirname, '..');
const MINUTE = 60000;

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.log('  FAIL ' + message); }
}

const at = iso => Date.parse(iso);
const run = (id, title, created, extra = {}) => ({ id, event: 'workflow_dispatch', display_title: title, created_at: created, head_branch: 'main', conclusion: 'success', ...extra });

// The three scenarios: the timer ran the slot before, died, and GitHub's copy
// for the next slot arrived within five minutes.
const SCENARIOS = [
  {
    name: 'daily 08:00 (Calendar nightly): yesterday\'s 08:00 timer run does not cover today\'s 08:03 copy',
    cron: '0 8 * * *', copy: '2026-10-10T08:03:00Z', slot: '2026-10-10T08:00:00Z',
    previous: run(101, 'Calendar E2E (nightly) (db-timer)', '2026-10-09T08:00:02Z'),
    current: run(102, 'Calendar E2E (nightly) (db-timer)', '2026-10-10T08:00:02Z'),
  },
  {
    name: 'dawn check (11:30 weekdays): Friday\'s timer run does not cover Monday\'s 11:33 copy',
    cron: '30 11 * * 1-5', copy: '2026-10-12T11:33:00Z', slot: '2026-10-12T11:30:00Z',
    previous: run(201, 'Dawn check (weekday mornings) (db-timer)', '2026-10-09T11:30:03Z'),
    current: run(202, 'Dawn check (weekday mornings) (db-timer)', '2026-10-12T11:30:03Z'),
  },
  {
    name: '6-hourly backup (:23): the 06:23 timer run does not cover the 12:25 copy',
    cron: '23 */6 * * *', copy: '2026-10-10T12:25:00Z', slot: '2026-10-10T12:23:00Z',
    previous: run(301, 'Track-B private backup (db-timer)', '2026-10-10T06:23:01Z'),
    current: run(302, 'Track-B private backup (db-timer)', '2026-10-10T12:23:01Z'),
  },
];

// ---------------------------------------------------------------- the pure check
for (const s of SCENARIOS) {
  const verdict = guard.timerCovered({ cron: s.cron, atMs: at(s.copy), branch: 'main', runs: [s.previous] });
  ok(!verdict.covered && verdict.reason === 'timer_missed', `${s.name} (the check)`);
  ok(verdict.slot === new Date(at(s.slot)).toISOString(), `${s.name}: the slot judged is the newest one, ${s.slot}`);
  ok(guard.timerCovered({ cron: s.cron, atMs: at(s.copy), branch: 'main', runs: [s.previous, s.current] }).covered,
    `${s.name}: the current slot's own timer run still covers it`);
}
{
  // The combined message judges after the fact with the same function, so it
  // must accept a timer run the guard would have found after its wait.
  const late = guard.timerCovered({ cron: '0 8 * * *', atMs: at('2026-10-10T08:01:00Z'), branch: 'main',
    runs: [run(401, 'Calendar E2E (nightly) (db-timer)', '2026-10-10T08:03:30Z')] });
  ok(late.covered, 'a timer run created after a prompt copy but before slot + five minutes counts (what the guard finds after waiting)');
  ok(!guard.timerCovered({ cron: '0 8 * * *', atMs: at('2026-10-10T08:01:00Z'), branch: 'main',
    runs: [run(402, 'Calendar E2E (nightly) (db-timer)', '2026-10-10T08:05:30Z')] }).covered,
  'a timer run after slot + five minutes does not (the guard has stopped looking by then)');
  const w = guard.coverWindow('0 8 * * *', at('2026-10-10T08:03:00Z'));
  ok(w && w.slot === at('2026-10-10T08:00:00Z') && w.from === at('2026-10-10T07:58:00Z') && w.to === at('2026-10-10T08:05:00Z'),
    'the window for a prompt copy is this slot only: two minutes early to slot + five minutes');
  const lateWindow = guard.coverWindow('0 8 * * *', at('2026-10-10T14:18:00Z'));
  ok(lateWindow && lateWindow.to === at('2026-10-10T14:18:00Z'), 'the window for a late copy ends at the copy');
}

// ---------------------------------------------------------------- the guard job
const ENV = { GITHUB_EVENT_NAME: 'schedule', GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42' };

/**
 * A fake GitHub API: the copy itself, then one answer per runs listing, in
 * order (the last one repeats). An answer that is an Error is thrown.
 */
function fakeApi(copyCreated, listings) {
  const calls = { own: 0, lists: 0, signals: [] };
  const fetchImpl = async (url, options) => {
    calls.signals.push(options && options.signal);
    if (/\/actions\/runs\/42$/.test(url)) {
      calls.own++;
      return { ok: true, json: async () => ({ id: 42, workflow_id: 7, created_at: copyCreated, head_branch: 'main' }) };
    }
    const answer = listings[Math.min(calls.lists, listings.length - 1)];
    calls.lists++;
    if (answer instanceof Error) throw answer;
    if (answer && answer.status) return { ok: false, status: answer.status };
    return { ok: true, json: async () => ({ workflow_runs: answer }) };
  };
  return { fetchImpl, calls };
}

function clockAt(iso) {
  const state = { t: at(iso), waits: [] };
  return {
    state,
    now: () => state.t,
    sleep: async ms => { state.waits.push(ms); state.t += ms; },
  };
}

(async () => {
  for (const s of SCENARIOS) {
    // The timer is dead: neither listing has the current slot's run.
    const api = fakeApi(s.copy, [[s.previous], [s.previous]]);
    const clock = clockAt(new Date(at(s.copy) + 10000).toISOString());
    const verdict = await guard.decide({ env: { ...ENV, SCHEDULE_CRON: s.cron }, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    const expectedWait = at(s.slot) + guard.DUE_GRACE_MINUTES * MINUTE - (at(s.copy) + 10000);
    ok(verdict.run === true && verdict.reason === 'timer_missed', `${s.name} (the guard job runs the copy)`);
    ok(clock.state.waits.length === 1 && clock.state.waits[0] === expectedWait && api.calls.lists === 2,
      `${s.name}: it waited once, until slot + five minutes (${expectedWait / 1000}s), then looked again`);
  }

  {
    // The timer is only slow: its run for the slot appears during the wait.
    const s = SCENARIOS[0];
    const api = fakeApi(s.copy, [[s.previous], [s.previous, s.current]]);
    const clock = clockAt('2026-10-10T08:03:05Z');
    const verdict = await guard.decide({ env: { ...ENV, SCHEDULE_CRON: s.cron }, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    ok(verdict.run === false && verdict.reason === 'timer_ran' && verdict.timer_run === s.current.id && clock.state.waits.length === 1,
      'a slow timer: its run appears during the wait and the copy stands down');
  }
  {
    // The timer already ran this slot: no wait at all.
    const s = SCENARIOS[1];
    const api = fakeApi(s.copy, [[s.previous, s.current]]);
    const clock = clockAt('2026-10-12T11:33:05Z');
    const verdict = await guard.decide({ env: { ...ENV, SCHEDULE_CRON: s.cron }, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    ok(verdict.run === false && clock.state.waits.length === 0 && api.calls.lists === 1,
      'the timer already ran this slot: the copy stands down without waiting');
  }
  {
    // A late copy (the usual case, hours late) never waits.
    const api = fakeApi('2026-10-10T14:18:02Z', [[]]);
    const clock = clockAt('2026-10-10T14:18:10Z');
    const verdict = await guard.decide({ env: { ...ENV, SCHEDULE_CRON: '0 8 * * *' }, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    ok(verdict.run === true && clock.state.waits.length === 0 && api.calls.lists === 1, 'a copy hours late with no timer run runs at once');
  }
  {
    // The wait is capped whatever the runner's clock says.
    const api = fakeApi('2026-10-10T08:00:20Z', [[], []]);
    const clock = clockAt('2026-10-10T06:00:00Z');
    await guard.decide({ env: { ...ENV, SCHEDULE_CRON: '0 8 * * *' }, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    ok(clock.state.waits.length === 1 && clock.state.waits[0] === guard.DUE_GRACE_MINUTES * MINUTE,
      'a runner clock two hours behind still waits five minutes at most');
  }

  // Fail open: anything going wrong around the wait means the copy runs.
  const s = SCENARIOS[2];
  const envS = { ...ENV, SCHEDULE_CRON: s.cron };
  {
    const api = fakeApi(s.copy, [[], { status: 502 }]);
    const clock = clockAt('2026-10-10T12:25:05Z');
    const verdict = await guard.decide({ env: envS, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    ok(verdict.run === true && verdict.reason === 'guard_error', 'the second look fails (HTTP 502): the copy runs');
  }
  {
    const api = fakeApi(s.copy, [[]]);
    const clock = clockAt('2026-10-10T12:25:05Z');
    const verdict = await guard.decide({ env: envS, fetchImpl: api.fetchImpl, now: clock.now, sleep: async () => { throw new Error('timer broke'); } });
    ok(verdict.run === true && verdict.reason === 'guard_error', 'the wait itself fails: the copy runs');
  }
  {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const api = fakeApi(s.copy, [timeout]);
    const clock = clockAt('2026-10-10T12:25:05Z');
    const verdict = await guard.decide({ env: envS, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    ok(verdict.run === true && verdict.reason === 'guard_error', 'an API call that times out: the copy runs');
  }
  {
    const api = fakeApi(s.copy, [[]]);
    const verdict = await guard.decide({ env: envS, fetchImpl: api.fetchImpl, now: () => NaN, sleep: async () => { throw new Error('no wait expected'); } });
    ok(verdict.run === true && verdict.reason === 'timer_missed', 'an unreadable clock skips the wait and the copy runs');
  }
  {
    const api = fakeApi(s.copy, [[]]);
    const clock = clockAt('2026-10-10T12:25:05Z');
    await guard.decide({ env: envS, fetchImpl: api.fetchImpl, now: clock.now, sleep: clock.sleep });
    ok(api.calls.signals.length >= 2 && api.calls.signals.every(signal => signal instanceof AbortSignal),
      `every API call carries a ${guard.REQUEST_TIMEOUT_MS / 1000}-second time limit`);
  }

  // The guard job's own time limit stays above its worst case: three API calls
  // at their limit, the capped wait, and two minutes for checkout and start.
  {
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'schedule-fallback-guard.yml'), 'utf8');
    const limit = /^ {4}timeout-minutes: (\d+)$/m.exec(workflow);
    const worst = guard.DUE_GRACE_MINUTES * MINUTE + 3 * guard.REQUEST_TIMEOUT_MS + 2 * MINUTE;
    ok(Boolean(limit) && Number(limit[1]) * MINUTE >= worst,
      `the guard job's timeout (${limit ? limit[1] : '?'} min) covers its worst case (${worst / MINUTE} min), so it can never time out and skip the job`);
  }

  console.log(failures ? `schedule-fallback-guard: ${failures} check(s) failed` : 'schedule-fallback-guard checks passed');
  process.exit(failures ? 1 : 0);
})();
