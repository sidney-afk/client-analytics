'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const suites = [
  ['Production boot budget', 'docs/syncview-design/tests/prod-boot-budget.js'],
  ['Production structure subset', 'docs/syncview-design/tests/prod-structure-subset.js'],
  ['Production interaction inventory', 'docs/syncview-design/tests/prod-interaction-inventory.js'],
  ['Production accessibility/focus', 'docs/syncview-design/tests/prod-a11y-focus.js'],
  ['Production layout polish', 'docs/syncview-design/tests/prod-layout-polish.js'],
  ['Production wired behavior', 'docs/syncview-design/tests/behav-wired.js'],
  ['Production pixel parity', 'docs/syncview-design/tests/pixel-wired.js'],
];

const failures = [];
const started = Date.now();

for (const [label, script] of suites) {
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
  console.error('\nprod-polish-gate failed after ' + elapsed + 's');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}

console.log('\nprod-polish-gate: all Production polish suites passed in ' + elapsed + 's');
