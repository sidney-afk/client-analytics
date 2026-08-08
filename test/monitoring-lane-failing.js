'use strict';
/*
 * A lane that RAN and FAILED must page, and must page differently from a lane
 * that stopped running.
 *
 * THE GAP THIS CLOSES (2026-08-07).
 *
 * The dead-man's switch deliberately ignores `ok` when judging staleness, and
 * is right to: a heartbeat with ok:false still proves the lane RAN, and
 * conflating the two is how F131 looked green while skipping work. But nothing
 * then asked the second question, and the answer was sitting inside the
 * heartbeat the whole time.
 *
 * The production write drill failed 22 consecutive nights from 2026-07-14 to
 * 2026-08-04, wrote ok:false on every one of them, and sent ZERO alerts. The
 * conditions that would have caught it were written — in an n8n transform
 * script that was never applied to the live pager. The alarm existed on paper
 * and nowhere else.
 *
 * This puts the answer where the alerting demonstrably works: the same
 * dead-man's switch, on the same 15-minute cadence, through the same relay
 * whose pages actually arrive in the owner's DMs.
 */
const {
  FAILING_KIND,
  LANES,
  STALE_KIND,
  failingPageSpec,
  latchKey,
  latchedLanes,
  stalePageSpec,
  watchdogDecision,
} = require('../scripts/monitoring-watchdog.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const LANE = 'production_write_drill';
const OTHER = 'monitoring_watchdog';

const beat = (lane, { ok: okFlag = true, minutesAgo = 5 } = {}) => ({
  id: `${lane}-${minutesAgo}-${okFlag}`,
  ts: new Date(NOW - minutesAgo * 60000).toISOString(),
  payload: {
    lane,
    ok: okFlag,
    at: new Date(NOW - minutesAgo * 60000).toISOString(),
    run_id: '1:1',
  },
});
const latch = (lane, state, kind) => ({
  id: `latch-${lane}-${kind}-${state}`,
  ts: new Date(NOW).toISOString(),
  payload: { lane, incident_state: state, ...(kind ? { incident_kind: kind } : {}) },
});
const decide = (heartbeatRows, latchRows = []) => watchdogDecision({
  heartbeatRows, latchRows, nowMs: NOW, lanes: LANES,
});

// Fresh, healthy beats for every OTHER lane, so only the lane under test moves.
const quiet = LANES.filter(lane => lane.key !== LANE).map(lane => beat(lane.key));

// --- 1. The 22 nights ------------------------------------------------------
const failed = decide([...quiet, beat(LANE, { ok: false })]);
ok(failed.failing.map(row => row.lane).includes(LANE),
  'a fresh heartbeat carrying ok:false pages — the exact signal 22 red drill runs emitted unheard');
ok(!failed.stale.map(row => row.lane).includes(LANE),
  'it does NOT also page as stale: the lane ran, it just failed');

// --- 2. It stays a heartbeat check, not a success check --------------------
const healthy = decide([...quiet, beat(LANE, { ok: true })]);
ok(healthy.failing.length === 0, 'a passing lane pages nothing');
ok(healthy.stale.length === 0, 'and is not stale');

// --- 3. Stale and failing are different incidents --------------------------
// A lane that has not run cannot be said to have failed. Reporting both would
// be two pages for one fact, and the second would be guesswork.
const staleRows = decide([...quiet, beat(LANE, { ok: false, minutesAgo: 5000 })]);
ok(staleRows.stale.map(row => row.lane).includes(LANE),
  'a lane whose newest heartbeat is old pages as STALE');
ok(!staleRows.failing.map(row => row.lane).includes(LANE),
  'a stale lane is never also reported as failing, even though its last beat said ok:false');

// --- 4. Latches are independent ---------------------------------------------
// This is the whole reason latches are keyed by (kind, lane). If they shared a
// key, a lane already latched as stale would swallow the page saying it came
// back and is now failing — the transition an operator most needs.
const staleLatched = decide(
  [...quiet, beat(LANE, { ok: false })],
  [latch(LANE, 'latched')],
);
ok(staleLatched.failing.map(row => row.lane).includes(LANE),
  'an existing STALE latch does not suppress the failing page');

const failLatched = decide(
  [...quiet, beat(LANE, { ok: false })],
  [latch(LANE, 'latched', FAILING_KIND)],
);
ok(failLatched.failing.length === 0,
  'once latched, a still-failing lane stops re-paging every 15 minutes');
ok(failLatched.stale.length === 0,
  'and the failing latch does not accidentally suppress or trigger staleness');

const recoveredRows = decide(
  [...quiet, beat(LANE, { ok: true })],
  [latch(LANE, 'latched', FAILING_KIND)],
);
ok(recoveredRows.recovered_failing.map(row => row.lane).includes(LANE),
  'a latched lane that starts passing again un-latches, so the NEXT failure pages');

// A legacy latch row with no incident_kind must still read as a stale latch.
ok(latchedLanes([latch(LANE, 'latched')]).get(latchKey(STALE_KIND, LANE)) === true,
  'a latch row written before incident_kind existed still reads as a stale latch');
ok(latchedLanes([latch(LANE, 'latched')]).get(latchKey(FAILING_KIND, LANE)) === undefined,
  'and never as a failing latch, so no historical row changes meaning');
ok(latchedLanes([latch(LANE, 'latched', FAILING_KIND), latch(LANE, 'reset')])
  .get(latchKey(FAILING_KIND, LANE)) === true,
'both kinds coexist for one lane without overwriting each other');

// --- 5. The page must be distinguishable ------------------------------------
const failingPage = failingPageSpec(failed.failing);
const stalePage = stalePageSpec([{ lane: LANE, age_minutes: 9, ever_seen: true, max_age_minutes: 5 }]);
ok(failingPage.type === 'monitoring_lane_failing' && stalePage.type === 'monitoring_heartbeat_stale',
  'the two incidents carry different types — different causes, different responses');
ok(failingPage.summaryParts[0] === `lanes${failed.failing.length}`,
  'counts come first, so a relay-truncated line still says how many lanes failed');
ok(/RAN and reported failure/.test(failingPage.text) && failingPage.text.includes(LANE),
  'the text names what happened and which lane');
ok(failingPage.team === 'monitoring' && Array.isArray(failingPage.details.lanes),
  'the page carries only lane keys — no client, row or payload content');

// --- 6. Several lanes at once ------------------------------------------------
const both = decide([
  ...LANES.filter(lane => ![LANE, OTHER].includes(lane.key)).map(lane => beat(lane.key)),
  beat(LANE, { ok: false }),
  beat(OTHER, { ok: false }),
]);
ok(both.failing.length === 2, 'every failing lane is reported, not just the first');

if (failures) {
  console.error(`\n${failures} lane-failing check(s) failed`);
  process.exit(1);
}
console.log('\nMonitoring lane-failing checks passed');
