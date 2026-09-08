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
  STALE_KIND,
  activeLanes,
  heartbeatFlagFor,
  latchKey,
  latchedLanes,
  newestHeartbeats,
  retiredLanes,
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
const WATCHED = activeLanes();
const allFresh = WATCHED.map(lane => beat(lane.key, 1));

/*
 * Fixtures name lanes by POSITION, not by key.
 *
 * They used to say `reconciler_pager` outright, which was fine until the Linear
 * exit made that lane retirable: retiring it would have failed four assertions
 * that are not about it at all, and the natural repair — swapping in another
 * hard-coded name — just re-arms the same trap for the next retirement. The
 * properties below hold of ANY two watched lanes, so they take any two.
 */
ok(WATCHED.length >= 2, 'the switch needs at least two watched lanes for the masking property to mean anything');
const CANARY_A = WATCHED[0].key;
const CANARY_B = WATCHED[1].key;

// ---------------------------------------------------------------------------
// The core property.
// ---------------------------------------------------------------------------
{
  const decision = watchdogDecision({ heartbeatRows: allFresh, latchRows: [], nowMs: NOW });
  ok(decision.stale.length === 0, 'all lanes fresh must page nothing');
  ok(decision.healthy.length === WATCHED.length, 'all lanes fresh must be reported healthy');
}

{
  // The failure this whole file is about: no heartbeat has EVER been written.
  const decision = watchdogDecision({ heartbeatRows: [], latchRows: [], nowMs: NOW });
  ok(decision.stale.length === WATCHED.length,
    'a lane that has never checked in must page — "never" is the deadest a lane gets');
  ok(decision.stale.every(row => row.ever_seen === false && row.age_minutes === null),
    'a never-seen lane must be reported as never-seen, not as age 0');
}

for (const lane of WATCHED) {
  const others = WATCHED.filter(other => other.key !== lane.key).map(other => beat(other.key, 1));
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
  const rows = WATCHED.map(lane => beat(lane.key, 1, { ok: false }));
  const decision = watchdogDecision({ heartbeatRows: rows, latchRows: [], nowMs: NOW });
  ok(decision.stale.length === 0, 'an ok:false heartbeat still proves the lane ran');
}

// ---------------------------------------------------------------------------
// Latching — the watchdog must not become the noise it exists to replace.
// ---------------------------------------------------------------------------
{
  const rows = [
    ...WATCHED.filter(lane => lane.key !== CANARY_A).map(lane => beat(lane.key, 1)),
    beat(CANARY_A, 10000),
  ];
  const first = watchdogDecision({ heartbeatRows: rows, latchRows: [], nowMs: NOW });
  ok(first.stale.length === 1, 'first observation of a dead lane pages');

  const second = watchdogDecision({
    heartbeatRows: rows, latchRows: [latch(CANARY_A, 'latched')], nowMs: NOW,
  });
  ok(second.stale.length === 0, 'a latched lane must not page again every run');
  ok(second.healthy.some(row => row.suppressed === 'already_latched'),
    'suppression must be visible in the output, not silent');

  const recovered = watchdogDecision({
    heartbeatRows: allFresh, latchRows: [latch(CANARY_A, 'latched')], nowMs: NOW,
  });
  ok(recovered.recovered.length === 1 && recovered.recovered[0].lane === CANARY_A,
    'a lane that comes back must un-latch so its next outage pages again');

  // 2026-08-07: latches became keyed by (kind, lane) so that "stopped running"
  // and "ran and failed" latch independently. The property asserted here —
  // newest row wins — is unchanged; only the key it is read under moved. A row
  // with no incident_kind still reads as a stale latch, which is what keeps
  // every historical latch meaning exactly what it meant when it was written.
  ok(latchedLanes([latch('a', 'reset'), latch('a', 'latched')]).get(latchKey(STALE_KIND, 'a')) === false,
    'the newest latch row wins — rows arrive newest-first');
}

// One lane's outage must never mask another's.
{
  const decision = watchdogDecision({
    heartbeatRows: [beat(CANARY_A, 10000), beat(CANARY_B, 10000)],
    latchRows: [latch(CANARY_A, 'latched')],
    nowMs: NOW,
  });
  ok(decision.stale.some(row => row.lane === CANARY_B),
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
  const rows = [beat(CANARY_A, 5), beat(CANARY_A, 90), beat('nonsense_lane', 1)];
  const newest = newestHeartbeats(rows);
  ok(newest.get(CANARY_A).at === minutesAgo(5), 'the newest heartbeat per lane wins');
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
  // The relay rewrites every non-alphanumeric to `_`, so these are the exact
  // substrings that appear in the DM.
  ok(payload.issue_identifier.includes('production_write_drill_never'),
    'a never-seen lane must read as "never", not as a number');
  ok(payload.issue_identifier.includes('reconciler_pager_8640m')
    || /plus\d+more/.test(payload.issue_identifier),
    'a lane that does not fit the relay budget must be announced as dropped, not silently omitted');
  ok(payload.issue_identifier.startsWith('lanes2'),
    'the dead-lane count must lead, so even a truncated page carries it');
  ok(payload.count === 2, 'the page must carry how many lanes are dead');
  ok(assertPublicSafe(payload), 'the page must be public-safe');
}

// ---------------------------------------------------------------------------
// Wiring: the switch is worthless if nothing writes heartbeats or runs it.
//
// This section used to name four workflow files by hand. That was the same trap
// the fixtures had, with a sharper edge: the Linear exit disables three of those
// four files, so the assertions would have had to be DELETED to get the suite
// green — and deleting an assertion is exactly how a lane stops being watched
// without anyone deciding that it should. Every check below is now derived from
// the lane registry's own `hosts` field and read back out of the workflow files,
// so the registry and the estate cannot drift apart in either direction.
// ---------------------------------------------------------------------------
const WORKFLOW_DIR = path.join(__dirname, '..', '.github', 'workflows');
const workflowExists = name => fs.existsSync(path.join(WORKFLOW_DIR, name));
const readWorkflow = name => fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');

/*
 * The `on:` block only — everything indented under the top-level `on:` key, up
 * to the next top-level key. Steps and comments elsewhere in the file must not
 * be able to make a workflow look scheduled when it is not.
 */
function triggerBlock(source) {
  const lines = String(source).split('\n');
  const start = lines.findIndex(line => /^on:/.test(line));
  if (start < 0) return '';
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join('\n');
}

/*
 * "Actively scheduled" means a `schedule:` key with at least one live `cron:`
 * entry. A commented-out cron is NOT a schedule — that is precisely how the
 * cutoff will stop these workflows, in a diff a reviewer can read, rather than
 * by a click in the Actions UI that leaves the repository lying about itself.
 */
function isActivelyScheduled(name) {
  if (!workflowExists(name)) return false;
  const lines = triggerBlock(readWorkflow(name)).split('\n');
  let inSchedule = false;
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue;
    if (/^ {2}schedule:\s*(#.*)?$/.test(line)) { inSchedule = true; continue; }
    if (/^ {2}\S/.test(line)) { inSchedule = false; continue; }
    if (inSchedule && /^\s*-\s*cron:\s*\S/.test(line)) return true;
  }
  return false;
}

const LINEAR_SECRET = /\bLINEAR_[A-Z0-9_]+\b/;

{
  for (const lane of LANES) {
    ok(Array.isArray(lane.hosts) && lane.hosts.length > 0,
      `${lane.key} must declare the workflow(s) that run it — an unhosted lane cannot be checked against reality`);

    const present = (lane.hosts || []).filter(workflowExists);
    const beaten = present.filter(host => readWorkflow(host).includes(`monitoring-watchdog.js ${heartbeatFlagFor(lane)}`));
    const scheduled = (lane.hosts || []).filter(isActivelyScheduled);

    if (lane.retired) {
      // THE HALF THAT KEEPS RETIREMENT HONEST IN ONE DIRECTION.
      ok(scheduled.length === 0,
        `${lane.key} is retired but ${scheduled.join(', ')} is still scheduled — a lane nobody watches whose workflow still runs`);
      ok(lane.retired.at && lane.retired.reason,
        `${lane.key} must record WHEN it was retired and WHY; an undated retirement is indistinguishable from a mistake`);
    } else {
      // AND THE HALF THAT KEEPS IT HONEST IN THE OTHER.
      //
      // This is the assertion that makes F4 and F6 one change instead of two.
      // Disabling a Linear workflow without retiring its lane fails here, so
      // the cutoff cannot leave a lane pointing at a workflow that no longer
      // runs — which would latch a permanent incident nobody can clear.
      ok(scheduled.length > 0,
        `${lane.key} is watched but none of its hosts (${lane.hosts.join(', ')}) is actively scheduled — `
        + 'either re-schedule the host or retire the lane, but do not leave the switch pointing at nothing');
      ok(beaten.length > 0,
        `${lane.key} must be beaten by at least one of its hosts via '${heartbeatFlagFor(lane)}'`);
    }

    // A heartbeat that only fires on success proves the lane PASSED, not that
    // it RAN, and the distinction is F131's entire bug. Every explicit
    // heartbeat step must therefore sit under `if: always()`.
    for (const host of beaten) {
      const source = readWorkflow(host);
      const flag = heartbeatFlagFor(lane);
      if (flag === '--check') continue; // the check writes its own beat at the end of a completed pass
      const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const guarded = new RegExp(`if: always\\(\\)[\\s\\S]{0,300}?${escaped}`);
      ok(guarded.test(source),
        `${lane.key}'s heartbeat in ${host} must be written under if: always() — it proves the lane ran, not that it passed`);
    }
  }
}

/*
 * THE PROPERTY THE CROSSCHECK HOST EXISTS FOR.
 *
 * "A checker cannot report its own death" is only true while TWO independent
 * workflows run `--check` and read each other's beat. Before 2026-09-07 the
 * second host was `linear-deliverables-reconcile.yml`, which the Linear exit
 * disables — so the cutoff would have quietly reduced the switch to one host,
 * and a single dead workflow would have become undetectable on the exact day
 * the estate needed it most. Nothing asserted the count, so nothing would have
 * said a word.
 *
 * Both halves are asserted: at least two live hosts, and at least one of them
 * free of any Linear credential so the count survives the cutoff.
 */
{
  const watchdog = LANES.find(lane => lane.key === 'monitoring_watchdog');
  const live = (watchdog.hosts || []).filter(isActivelyScheduled);
  ok(live.length >= 2,
    `the watchdog needs at least two independent scheduled hosts; found ${live.length} (${live.join(', ') || 'none'})`);
  const linearFree = live.filter(host => !LINEAR_SECRET.test(readWorkflow(host)));
  ok(linearFree.length >= 2,
    'at least two of the watchdog\'s hosts must hold no Linear credential, or the cutoff silently halves the switch. '
    + `Linear-free live hosts: ${linearFree.join(', ') || 'none'}`);
}

/*
 * THE CUTOFF LOCK, in both directions.
 *
 * Forward: every scheduled workflow that references a LINEAR_* secret must be
 * the registered host of a lane marked `retires_with: 'linear'`. A new one
 * cannot appear unnoticed, and after the cutoff — when the last of those
 * workflows is unscheduled — this loop is what makes "zero scheduled workflow
 * still requires a Linear credential" a fact the suite checks rather than a
 * grep somebody runs once.
 *
 * Backward: a lane marked `retires_with: 'linear'` must actually have a
 * Linear-credentialed host, so the marker cannot be decoration on a lane that
 * would have survived perfectly well.
 */
{
  const linearHosts = new Set();
  for (const lane of LANES) {
    if (lane.retires_with !== 'linear') continue;
    for (const host of lane.hosts || []) linearHosts.add(host);
    const credentialed = (lane.hosts || []).filter(host => workflowExists(host) && LINEAR_SECRET.test(readWorkflow(host)));
    ok(credentialed.length > 0,
      `${lane.key} claims retires_with:'linear' but none of its hosts references a LINEAR_* secret — the marker is wrong`);
  }

  for (const name of fs.readdirSync(WORKFLOW_DIR).filter(f => /\.ya?ml$/.test(f)).sort()) {
    if (!isActivelyScheduled(name)) continue;
    if (!LINEAR_SECRET.test(readWorkflow(name))) continue;
    ok(linearHosts.has(name),
      `${name} runs on a schedule and needs a LINEAR_* secret, but no dead-man lane marked retires_with:'linear' `
      + 'names it as a host. Every scheduled Linear credential must be on the cutoff inventory.');
  }
}

/*
 * Retirement must never be silent. `--check` reports its watched and retired
 * sets on every pass, so a reader of one run's JSON can see the whole estate.
 */
{
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'monitoring-watchdog.js'), 'utf8');
  const start = source.indexOf('async function runCheck(');
  const runCheckSource = source.slice(start, source.indexOf('\n/**', start));
  ok(/watching: activeLanes\(\)/.test(runCheckSource) && /retired: retiredLanes\(\)/.test(runCheckSource),
    'every --check must report which lanes it watches AND which it has retired');
  ok(retiredLanes().every(lane => lane.retired && lane.retired.at && lane.retired.reason),
    'a retired lane must carry its date and reason');
  ok(activeLanes().length + retiredLanes().length === LANES.length,
    'every registered lane is either watched or retired — there is no third state');
}

/*
 * THE READ MUST BE PER-LANE, NOT A SHARED ROW WINDOW.
 *
 * Everything above hands `watchdogDecision` its rows, so none of it could see
 * the defect found on 2026-08-16: `readState` fetched the newest
 * `LANES.length * 25` heartbeat rows and picked each lane's newest out of that
 * slice. A ROW bound cannot satisfy a TIME tolerance — the three ~15-minute
 * lanes filled all 175 rows in about fifteen hours, so three of the four DAILY
 * lanes (36h tolerance) fell outside the window and were reported
 * `ever_seen:false`, "never checked in", while their beats sat in the table.
 *
 * The damage was not just noise: `isFailing` requires a beat to be present, so
 * samples_e2e_nightly and production_shadow_audit each beat `ok:false` for
 * three consecutive nights without ever paging as FAILING. A watchdog that
 * cannot see a lane cannot report that the lane failed.
 *
 * So pin the shape of the read itself.
 */
{
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'monitoring-watchdog.js'), 'utf8');
  const start = source.indexOf('async function readState(');
  const readStateSource = source.slice(start, source.indexOf('\nasync function runCheck(', start));
  ok(start > -1 && readStateSource.length > 0, 'readState is present and sliceable');
  ok(/const watched = activeLanes\(\);/.test(readStateSource)
      && /watched\.map\(lane =>/.test(readStateSource)
      && /payload->>lane=eq\.\$\{encodeURIComponent\(lane\.key\)\}/.test(readStateSource)
      && /order=id\.desc&limit=1/.test(readStateSource),
  'the heartbeat read asks each WATCHED lane for its own newest beat, keyed on the lane');
  const heartbeatRead = readStateSource.slice(
    readStateSource.indexOf('HEARTBEAT_ACTION'),
    readStateSource.indexOf('LATCH_ACTION'));
  ok(!/limit=\$\{(?:LANES|watched)\.length \* \d+\}/.test(heartbeatRead),
    'no shared row window may bound the heartbeat read — a chatty lane would evict a daily one');
}

console.log(failures ? `monitoring-watchdog: ${failures} check(s) failed` : 'monitoring-watchdog checks passed');
process.exit(failures ? 1 : 0);
