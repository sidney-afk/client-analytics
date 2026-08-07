'use strict';
/*
 * Every lane that writes a heartbeat must be watched, and every watched lane
 * must write one.
 *
 * THE AUDIT THAT PRODUCED THIS (2026-08-07).
 *
 * Asked whether the alarms were right, the honest answer turned out to be no,
 * and the evidence was the owner's own Slack history rather than the code:
 *
 *   - `production_write_drill` is a watched lane, so "did it run?" was covered.
 *     "Did it pass?" was not — the drill died 22 consecutive nights from
 *     2026-07-14 to 2026-08-04 and sent ZERO alerts, because the three
 *     `production_write_drill_*` pager conditions live in a transform script
 *     that was never applied to the live n8n workflow.
 *   - `production_shadow_audit` was worse: dark on BOTH axes. No heartbeat step
 *     in its workflow, absent from the watchdog's lane list, and its three
 *     pager conditions equally unapplied. It had already stopped once in
 *     silence — an invalid `runner.temp` reference made GitHub reject the whole
 *     workflow from 2026-07-13 — and a human reading the file is what found it.
 *
 * The pager half is an n8n change and cannot be asserted from here. THIS half
 * can: the heartbeat wiring is two files that must agree, and they disagreed
 * for weeks because nothing compared them. A new monitored workflow is exactly
 * the moment someone adds one and forgets the other.
 */
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

const watchdog = fs.readFileSync(path.join(ROOT, 'scripts', 'monitoring-watchdog.js'), 'utf8');
const laneBlock = watchdog.slice(watchdog.indexOf('const LANES = Object.freeze(['),
  watchdog.indexOf(']);', watchdog.indexOf('const LANES = Object.freeze([')));
const watchedLanes = new Set([...laneBlock.matchAll(/\bkey: '([a-z0-9_]+)'/g)].map(match => match[1]));

// Heartbeats written from a workflow file, with the file that writes each.
const writtenLanes = new Map();
for (const file of fs.readdirSync(WORKFLOW_DIR).filter(name => name.endsWith('.yml'))) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
  for (const match of source.matchAll(/--heartbeat=([a-z0-9_]+)/g)) {
    if (!writtenLanes.has(match[1])) writtenLanes.set(match[1], []);
    writtenLanes.get(match[1]).push(file);
  }
}

ok(watchedLanes.size >= 5, `the watchdog watches every declared lane (${watchedLanes.size})`);
ok(watchedLanes.has('production_shadow_audit'),
  'production_shadow_audit is a watched lane — it was absent, and dark, until 2026-08-07');
ok(watchedLanes.has('production_write_drill'),
  'production_write_drill is still a watched lane');

/*
 * A heartbeat nobody watches is wasted work that reads like coverage. Lanes
 * written by something other than a workflow file (the reconciler pager writes
 * its own from n8n) are exempt by name, not by silence — an unexplained one
 * fails here.
 */
const NON_WORKFLOW_LANES = new Set(['reconciler_pager', 'monitoring_watchdog']);
for (const [lane, files] of writtenLanes) {
  ok(watchedLanes.has(lane),
    `the heartbeat written by ${files.join(', ')} names a lane the watchdog watches (${lane})`);
}
for (const lane of watchedLanes) {
  ok(writtenLanes.has(lane) || NON_WORKFLOW_LANES.has(lane),
    `watched lane "${lane}" has a workflow that actually writes its heartbeat`);
}

/*
 * `if: always()` is the whole point. A heartbeat that only fires on success
 * turns "the run failed" into "the lane vanished", which is a different alarm
 * with a different response, and it is why the watchdog deliberately records a
 * heartbeat with ok:false rather than skipping it.
 */
for (const [lane, files] of writtenLanes) {
  for (const file of files) {
    const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
    const index = source.indexOf(`--heartbeat=${lane}`);
    const step = source.slice(Math.max(0, index - 400), index);
    ok(/if:\s*always\(\)/.test(step),
      `${file} records the ${lane} heartbeat even when the job failed`);
    ok(/--ok=\$\{\{\s*job\.status == 'success'\s*\}\}/.test(source.slice(index, index + 200)),
      `${file} reports the ${lane} run's real outcome rather than a hardcoded ok`);
  }
}

if (failures) {
  console.error(`\n${failures} monitoring lane coverage check(s) failed`);
  process.exit(1);
}
console.log('\nMonitoring lane coverage checks passed');
