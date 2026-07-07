// Runs the EF write-path harness suite in order. Linear pushes are captured+mocked
// by default (zero mutation). Set EFWP_LINEAR_FORWARD=1 to forward the test client's
// own allow-listed issues to live n8n for the real round-trip (10/12 scripts).
'use strict';
const { execSync } = require('child_process');
const SCRIPTS = [
  '00-smoke.js',
  '10-status-linear.js',
  '11-calendar-writes.js',
  '12-samples.js',
  '13-settings.js',
  '14-realtime.js',
  '20-routing-failsafe.js',
  '21-drift-check.js',
  '30-master-readonly.js',
];
let fails = 0;
for (const sc of SCRIPTS) {
  process.stdout.write(`\n===== ${sc} =====\n`);
  try { execSync(`node ${__dirname}/${sc}`, { stdio: 'inherit', timeout: 300000, env: process.env }); }
  catch (e) { fails++; process.stdout.write(`  !! ${sc} exited non-zero\n`); }
}
process.stdout.write(`\n===== SUITE: ${SCRIPTS.length - fails}/${SCRIPTS.length} scripts green =====\n`);
process.exit(fails ? 1 : 0);
