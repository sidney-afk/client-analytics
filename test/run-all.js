'use strict';
/*
 * Unit / wiring suite runner. Runs every top-level test/*.js (the fast,
 * dependency-free checks that extract and exercise repository contracts) and
 * exits non-zero if any fails — so CI gets a clean signal. Most suites are
 * fully offline; the F63 gate may use only an explicitly required disposable
 * PostgreSQL 16 service and never a live backend. Headless end-to-end probes
 * live in qa/probes/ and run separately (npm run test:e2e / nightly CI).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.js') && f !== 'run-all.js')
  .sort();

const failures = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failures.push(f); console.error('\n>>> FAILED: test/' + f + '\n'); }
}
/*
 * The names again, LAST.
 *
 * They are already printed above, inline, right after the suite that failed --
 * and that is exactly where a CI reader cannot get at them. A run of 300 suites
 * is tens of thousands of lines, log APIs hand back the tail, and the tail is
 * whatever ran last plus the service-container dump. On 2026-08-26 a red `unit`
 * job took four log fetches and still would not say which suite failed, because
 * the marker sat somewhere in the middle of the run.
 *
 * A failing run now ends with the list. Costs one line on the runs nobody has
 * to read, and makes the runs somebody does have to read self-explaining.
 */
if (failures.length) {
  console.error(`\n${failures.length} of ${files.length} unit suite(s) failed ❌`);
  console.error('failed suites: ' + failures.map(f => 'test/' + f).join(', '));
} else {
  console.log(`\nAll ${files.length} unit suites passed ✅`);
}
process.exit(failures.length ? 1 : 0);
