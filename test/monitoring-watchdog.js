'use strict';

/*
 * Locks the dead-man's switch.
 *
 * The property under test is the one every other watcher in this repository
 * lacks: a lane that STOPS RUNNING must be as loud as a lane that reports a
 * problem. Silence is the failure mode, so "never checked in" has to page just
 * like "checked in too long ago".
 */

const fs = require('fs');
const path = require('path');
const {
  LANES,
  latchedLanes,
  newestHeartbeats,
  stalePageSpec,
  watchdogDecision,
} = require('../scripts/monitoring-watchdog');
const { assertPublicSafe, relayPayload } = require('../scripts/monitoring-alert-relay');

let failures = 0;
function ok(condition, message) {
  if (!condition) {
    console.error('FAIL monitoring-watchdog:', message);
    failures++;
  }
}

const NOW = Date.parse('2026-08-04T20:00:00.000Z');
const minutesAgo = minutes => new Date(NOW - minutes * 60000).toISOString();
const beat = (lane, minutes, extra = {}) => ({
  id: `${lane}-${minutes}`,
  ts: minutesAgo(minutes),
  payload: { lane, ok: true, at: minutesAgo(minutes), run_id: 'r1', ...extra },
});
const latch = (lane, state) => ({ id: `${lane}-${state}`, payload: { lane, incident_state: state } });

const laneKeys = LANES.map(lane => lane.key);
const allFresh = LANES.map(lane => beat(lane.key, 1));

// ---------------------------------------------------------------------------
// The core property.
// ---------------------------------------------------------------------------
{
  const decision = watchdogDecision({ heartbeatRows: allFresh, latchRows: [], nowMs: NOW });
  ok(decision.stale.length === 0, 'all lanes fresh must page nothing');
  ok(decision.healthy.length === LANES.length, 'all lanes fresh must be reported healthy');
}

{
  // The failure this whole file is about: no heartbeat has EVER been written.
  const decision = watchdogDecision({ heartbeatRows: [], latchRows: [], nowMs: NOW });
  ok(decision.stale.length === LANES.length,
    'a lane that has never checked in must page — "never" is the deadest a lane gets');
  ok(decision.stale.every(row => row.ever_seen === false && row.age_minutes === null),
    'a never-seen lane must be reported as never-seen, not as age 0');
}

for (const lane of LANES) {
  const others = LANES.filter(other => other.key !== lane.key).map(other => beat(other.key, 1));
  const justInside = watchdogDecision({
    heartbeatRows: [...others, beat(lane.key, lane.max_age_minutes - 1)],
    latchRows: [], nowMs: NOW,
  });
  ok(justInside.stale.length === 0, `${lane.key} inside its max age must not page`);

  const justOutside = watchdogDecision({
    heartbeatRows: [...others, beat(lane.key, lane.max_age_minutes + 1)],
    latchRows: [], nowMs: NOW,
  });
  ok(justOutside.stale.length === 1 && justOutside.stale[0].lane === lane.key,
    `${lane.key} past its max age must page, and only it`);
}

// A crashed run still proves the lane ran; whether it succeeded is that lane's
// own alarm. Conflating the two is exactly F131's bug.
{
  const rows = LANES.map(lane => beat(lane.key, 1, { ok: false }));
  const decision = watchdogDecision({ heartbeatRows: rows, latchRows: [], nowMs: NOW });
  ok(decision.stale.length === 0, 'an ok:false heartbeat still proves the lane ran');
}

// ---------------------------------------------------------------------------
// Latching — the watchdog must not become the noise it exists to replace.
// ---------------------------------------------------------------------------
{
  const rows = [
    ...LANES.filter(lane => lane.key !== 'reconciler_pager').map(lane => beat(lane.key, 1)),
    beat('reconciler_pager', 10000),
  ];
  const first = watchdogDecision({ heartbeatRows: rows, latchRows: [], nowMs: NOW });
  ok(first.stale.length === 1, 'first observation of a dead lane pages');

  const second = watchdogDecision({
    heartbeatRows: rows, latchRows: [latch('reconciler_pager', 'latched')], nowMs: NOW,
  });
  ok(second.stale.length === 0, 'a latched lane must not page again every run');
  ok(second.healthy.some(row => row.suppressed === 'already_latched'),
    'suppression must be visible in the output, not silent');

  const recovered = watchdogDecision({
    heartbeatRows: allFresh, latchRows: [latch('reconciler_pager', 'latched')], nowMs: NOW,
  });
  ok(recovered.recovered.length === 1 && recovered.recovered[0].lane === 'reconciler_pager',
    'a lane that comes back must un-latch so its next outage pages again');

  ok(latchedLanes([latch('a', 'reset'), latch('a', 'latched')]).get('a') === false,
    'the newest latch row wins — rows arrive newest-first');
}

// One lane's outage must never mask another's.
{
  const decision = watchdogDecision({
    heartbeatRows: [beat('reconciler_pager', 10000), beat('production_write_drill', 10000)],
    latchRows: [latch('reconciler_pager', 'latched')],
    nowMs: NOW,
  });
  ok(decision.stale.some(row => row.lane === 'production_write_drill'),
    'a latched lane must not suppress a different lane going dead');
}

// ---------------------------------------------------------------------------
// Lane registry and heartbeat parsing.
// ---------------------------------------------------------------------------
ok(laneKeys.includes('monitoring_watchdog'),
  'the watchdog must watch itself — a checker cannot report its own death, so the other workflow reads this lane');
ok(laneKeys.includes('reconciler_pager') && laneKeys.includes('production_write_drill')
  && laneKeys.includes('b1_incremental_refresh'),
  'every lane whose silence caused a real outage must be registered');
ok(LANES.every(lane => Number.isFinite(lane.max_age_minutes) && lane.max_age_minutes > 0),
  'every lane needs a finite max age');

{
  const rows = [beat('reconciler_pager', 5), beat('reconciler_pager', 90), beat('nonsense_lane', 1)];
  const newest = newestHeartbeats(rows);
  ok(newest.get('reconciler_pager').at === minutesAgo(5), 'the newest heartbeat per lane wins');
  ok(!newest.has('nonsense_lane'), 'an unregistered lane must be ignored, not invent a lane');
}

// ---------------------------------------------------------------------------
// The page itself must be readable and public-safe.
// ---------------------------------------------------------------------------
{
  const spec = stalePageSpec([
    { lane: 'reconciler_pager', label: 'reconciler drift pager', max_age_minutes: 240, age_minutes: 8640, ever_seen: true },
    { lane: 'production_write_drill', label: 'production write drill', max_age_minutes: 2160, age_minutes: null, ever_seen: false },
  ]);
  const payload = relayPayload(spec);
  ok(payload.issue_identifier.includes('reconciler_pager=8640m'),
    'the page must name the dead lane and its age in the field the relay renders');
  ok(payload.issue_identifier.includes('production_write_drill=never'),
    'a never-seen lane must read as "never", not as a number');
  ok(payload.count === 2, 'the page must carry how many lanes are dead');
  ok(assertPublicSafe(payload), 'the page must be public-safe');
}

// ---------------------------------------------------------------------------
// Wiring: the switch is worthless if nothing writes heartbeats or runs it.
// ---------------------------------------------------------------------------
{
  const workflows = path.join(__dirname, '..', '.github', 'workflows');
  const read = name => fs.readFileSync(path.join(workflows, name), 'utf8');

  const deadman = read('monitoring-deadman.yml');
  ok(/schedule:/.test(deadman) && /monitoring-watchdog\.js --check/.test(deadman),
    'a dedicated scheduled workflow must run the check independently of the lanes it watches');

  const reconcile = read('linear-deliverables-reconcile.yml');
  ok(/monitoring-watchdog\.js --heartbeat=reconciler_pager/.test(reconcile),
    'the reconciler pager lane must write a heartbeat');
  ok(/monitoring-watchdog\.js --check/.test(reconcile),
    'the reconciler workflow must also run the check so it and the deadman workflow watch each other');
  ok(/--heartbeat=reconciler_pager[\s\S]{0,200}?if: always\(\)|if: always\(\)[\s\S]{0,200}?--heartbeat=reconciler_pager/.test(reconcile),
    'the heartbeat must be written even when the run failed — it proves the lane ran, not that it passed');

  ok(/monitoring-watchdog\.js --heartbeat=production_write_drill/.test(read('production-write-drill.yml')),
    'the write-drill lane must write a heartbeat');
  ok(/monitoring-watchdog\.js --heartbeat=b1_incremental_refresh/.test(read('b1-linear-incremental-refresh.yml')),
    'the B1 refresh lane must write a heartbeat');
}

console.log(failures ? `monitoring-watchdog: ${failures} check(s) failed` : 'monitoring-watchdog checks passed');
process.exit(failures ? 1 : 0);
