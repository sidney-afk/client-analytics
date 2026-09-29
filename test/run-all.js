'use strict';
/*
 * Unit / wiring suite runner. Runs the explicitly classified unit suites (the fast,
 * dependency-free checks that extract and exercise repository contracts) and
 * exits non-zero if any fails — so CI gets a clean signal for this lane only. Required isolated and private-input
 * profiles are reported NOT_RUN and are never counted as passing unit suites. Most suites are
 * fully offline; the F63 gate may use only an explicitly required disposable
 * PostgreSQL 16 service and never a live backend. Headless end-to-end probes
 * live in qa/probes/ and run separately (npm run test:e2e / nightly CI).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const plan = require('../scripts/test-suite-routing').unitPlan();
const files = plan.files;
for (const proof of plan.deferred) console.log(JSON.stringify({required_test:proof.file,status:proof.status,reason:proof.required_inputs,reproduce:proof.reproduce}));

const failures = [];
for (const f of files) {
  // With the split switch on, index.html is a loader; suites that read the app's
  // code from it get the single-file page through this preload (see the helper).
  const preload = '--require=' + JSON.stringify(path.join(dir, 'helpers', 'single-file-index.js'));
  const env = Object.assign({}, process.env, { NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' ') });
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env });
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
  console.log(`\nAll ${files.length} classified unit suites passed; ${plan.deferred.length} required profiles NOT_RUN in this lane ✅`);
}
process.exit(failures.length ? 1 : 0);
