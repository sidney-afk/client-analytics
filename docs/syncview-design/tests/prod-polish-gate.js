'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const groups = new Set(['all', 'fast', 'interaction', 'heavy']);
const laneArg = process.argv.find(arg => arg.startsWith('--lane='));
const lane = laneArg ? laneArg.slice('--lane='.length) : 'all';

if (!groups.has(lane)) {
  console.error(`Unknown Production polish lane: ${lane}`);
  process.exit(2);
}

const suites = [
  ['fast', 'Production boot budget', 'docs/syncview-design/tests/prod-boot-budget.js'],
  ['fast', 'Production structure subset', 'docs/syncview-design/tests/prod-structure-subset.js'],
  ['fast', 'Production read-only smoke', 'docs/syncview-design/tests/prod-readonly-smoke.js'],
  ['fast', 'Production comment thread', 'docs/syncview-design/tests/prod-comments-browser.js'],
  ['fast', 'Production write gateway', 'docs/syncview-design/tests/prod-write-gateway-browser.js'],
  ['interaction', 'Production interaction inventory', 'docs/syncview-design/tests/prod-interaction-inventory.js'],
  ['fast', 'Production accessibility/focus', 'docs/syncview-design/tests/prod-a11y-focus.js'],
  ['fast', 'Production layout polish', 'docs/syncview-design/tests/prod-layout-polish.js'],
  ['heavy', 'Production wired behavior', 'docs/syncview-design/tests/behav-wired.js'],
  ['heavy', 'Production pixel parity', 'docs/syncview-design/tests/pixel-wired.js'],
].filter(([group]) => lane === 'all' || group === lane);

const failures = [];
const started = Date.now();

for (const [, label, script] of suites) {
  console.log(`\n=== ${label} ===`);
  const run = spawnSync(process.execPath, [script], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (run.status !== 0) {
    failures.push(`${label} failed with exit ${run.status == null ? 'unknown' : run.status}`);
    break;
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) {
  console.error(`\nprod-polish-gate (${lane}) failed after ${elapsed}s`);
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}

console.log(`\nprod-polish-gate (${lane}): all ${suites.length} selected suite(s) passed in ${elapsed}s`);
