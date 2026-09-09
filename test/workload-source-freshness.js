'use strict';

/*
 * Locks the Workload-source freshness watcher.
 *
 * The property under test is the one the browser cannot have: a source that
 * STOPS ADVANCING must be as loud as a source that errors. `workload_issues`
 * does not empty when Linear dies — the n8n reconcile's safety gate keeps the
 * old rows — so a frozen board and a healthy board are byte-identical to
 * `_wlV2CheckWatermark`, which only reacts when the watermark moves forward.
 * Everything below exists so that this script is the thing that can tell them
 * apart, and so that it can never report health about a look it did not take.
 */

const fs = require('fs');
const path = require('path');
const {
  MAX_AGE_MINUTES,
  VERDICTS,
  ageMinutes,
  assessSource,
  parseExactCount,
} = require('../scripts/workload-source-freshness');

let failures = 0;
function ok(condition, message) {
  if (!condition) {
    console.error('FAIL workload-source-freshness:', message);
    failures++;
  }
}

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const minutesAgo = minutes => new Date(NOW - minutes * 60000).toISOString();
const assess = (over = {}) => assessSource({
  activeRows: 2014, newestAt: minutesAgo(5), nowMs: NOW, ...over,
});

// ---------------------------------------------------------------------------
// The core property: freeze is an incident, not a quiet state.
// ---------------------------------------------------------------------------
{
  ok(assess().verdict === VERDICTS.HEALTHY && assess().ok === true,
    'a source advancing inside its window is healthy');

  const frozen = assess({ newestAt: minutesAgo(MAX_AGE_MINUTES + 1) });
  ok(frozen.verdict === VERDICTS.FROZEN && frozen.ok === false,
    'a source that stopped advancing must fail — this is the whole point of the watcher');
  ok(frozen.active_rows === 2014,
    'a frozen source still reports its row count, because "2000 rows and stale" is the diagnosis');

  const justInside = assess({ newestAt: minutesAgo(MAX_AGE_MINUTES - 1) });
  ok(justInside.ok === true, 'one minute inside the window must not page');
  const justOutside = assess({ newestAt: minutesAgo(MAX_AGE_MINUTES + 1) });
  ok(justOutside.ok === false, 'one minute outside the window must page');
}

// ---------------------------------------------------------------------------
// EVERY not-healthy shape must be a failure. None of them may read as quiet.
// ---------------------------------------------------------------------------
{
  const empty = assess({ activeRows: 0, newestAt: null });
  ok(empty.verdict === VERDICTS.EMPTY && empty.ok === false,
    'zero active rows is an incident: index.html:14553 falls back to the linear-issues webhook, '
    + 'so after the cutoff an empty mirror means the board reaches for a dead endpoint');

  const unreadable = assess({ activeRows: null });
  ok(unreadable.verdict === VERDICTS.UNREADABLE && unreadable.ok === false,
    'a count that could not be established is a failure, never "fresh"');

  const noStamp = assess({ newestAt: null });
  ok(noStamp.verdict === VERDICTS.NO_TIMESTAMP && noStamp.ok === false,
    'active rows with no parseable timestamp cannot be judged, so they must not be called healthy');

  const garbage = assess({ newestAt: 'not-a-date' });
  ok(garbage.ok === false, 'an unparseable timestamp is not treated as "now"');

  for (const verdict of [VERDICTS.FROZEN, VERDICTS.EMPTY, VERDICTS.NO_TIMESTAMP, VERDICTS.UNREADABLE]) {
    ok(verdict !== VERDICTS.HEALTHY, `${verdict} is a distinct verdict from healthy`);
  }
}

// A row count that is not a finite number must never be read as zero: reading a
// malformed API response as "no rows" turns a schema change into a permanent
// false EMPTY, and reading it as healthy turns it into a permanent false GREEN.
{
  for (const value of [null, undefined, NaN, '2014', Infinity]) {
    const decision = assess({ activeRows: value });
    ok(decision.ok === false && decision.verdict === VERDICTS.UNREADABLE,
      `a non-finite active row count (${String(value)}) must be unreadable, not zero and not healthy`);
  }
}

// ---------------------------------------------------------------------------
// The count header parser. Reading it wrong is how a healthy board would be
// reported empty, or an empty one healthy.
// ---------------------------------------------------------------------------
{
  ok(parseExactCount('0-0/2014') === 2014, 'a normal PostgREST content-range yields the total');
  ok(parseExactCount('*/0') === 0, 'an empty result yields a real zero');
  ok(parseExactCount('0-24/2014') === 2014, 'a paged range still yields the total, not the page size');
  for (const bad of ['', null, undefined, '0-0/*', 'nonsense', '0-0/']) {
    ok(parseExactCount(bad) === null,
      `an unparseable content-range (${JSON.stringify(bad)}) must be null, never 0`);
  }
}

// ---------------------------------------------------------------------------
// Ages.
// ---------------------------------------------------------------------------
{
  ok(ageMinutes(minutesAgo(90), NOW) === 90, 'age is reported in whole minutes');
  ok(ageMinutes(new Date(NOW + 60000).toISOString(), NOW) === 0,
    'a future timestamp clamps to zero rather than going negative');
  ok(ageMinutes('', NOW) === null && ageMinutes(null, NOW) === null,
    'an absent timestamp has no age, and no age is not zero age');
}

// ---------------------------------------------------------------------------
// PUBLIC SAFETY. This repository is public and this JSON lands in an Actions log.
// ---------------------------------------------------------------------------
{
  const rendered = JSON.stringify(assess({ newestAt: minutesAgo(9999) }));
  ok(!/[a-z0-9_-]*slug/i.test(rendered) && !/identifier/i.test(rendered),
    'the census reports counts and ages only — no slug, no identifier');
  ok(!/https?:\/\//.test(rendered), 'no URL may reach the log');
  const keys = Object.keys(assess()).sort().join(',');
  ok(keys === 'active_rows,age_minutes,detail,max_age_minutes,ok,source,verdict',
    `the output shape is fixed and aggregate-only, got: ${keys}`);
}

// ---------------------------------------------------------------------------
// Wiring. A watcher nothing runs is a comment.
// ---------------------------------------------------------------------------
{
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'workload-source-freshness.yml'), 'utf8');
  ok(/schedule:/.test(workflow) && /- cron:/.test(workflow),
    'the watcher must be scheduled, not dispatch-only');
  ok(/node scripts\/workload-source-freshness\.js/.test(workflow),
    'the workflow must actually run the watcher');
  ok(/--heartbeat=workload_source_freshness/.test(workflow),
    'the watcher must beat, or the dead-man\'s switch cannot report that it stopped');
  ok(/if: always\(\)[\s\S]{0,300}?--heartbeat=workload_source_freshness/.test(workflow),
    'the heartbeat must be written even when the run failed — it proves the lane ran, not that it passed');
  ok(!/LINEAR_/.test(workflow),
    'the watcher must hold no Linear credential — it has to outlive the thing it watches');

  const { LANES } = require('../scripts/monitoring-watchdog');
  const lane = LANES.find(entry => entry.key === 'workload_source_freshness');
  ok(Boolean(lane), 'the watcher must be a registered dead-man lane');
  ok(lane && !lane.retires_with,
    'this lane outlives Linear — it is the one that reports the board freezing BECAUSE Linear died');
  ok(lane && Array.isArray(lane.hosts) && lane.hosts.includes('workload-source-freshness.yml'),
    'the lane must name its host so the suite can check the registry against reality');
}

/*
 * THE ALARM PATH IS THE EXIT CODE, AND THAT IS DELIBERATE.
 *
 * `SLACK_ALERT_WEBHOOK` points at the n8n relay `Tfhc3vebZyG6obOg`
 * (scripts/monitoring-alert-relay.js:53), so NO page in this estate survives an
 * n8n outage. The non-zero exit does: it leaves the GitHub run red and GitHub
 * emails the owner, touching no n8n at all. So the exit code is the
 * n8n-independent channel and must never be softened into a warning — which is
 * exactly the defect that left both nightlies red for weeks with zero pages.
 */
{
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'workload-source-freshness.js'), 'utf8');
  ok(/process\.exit\(1\)/.test(source), 'a finding must leave the process non-zero');
  ok(/if \(!assessment\.ok\) \{[\s\S]{0,200}?throw new Error/.test(source),
    'a not-ok assessment must throw, so the run is red and the failed-run email fires');
  ok(!/sendAlert|monitoring-alert-relay/.test(source),
    'this watcher must NOT grow its own alarm — the dead-man\'s switch owns paging, latching and dedup');
}

console.log(failures
  ? `workload-source-freshness: ${failures} check(s) failed`
  : 'workload-source-freshness checks passed');
process.exit(failures ? 1 : 0);
