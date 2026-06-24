'use strict';
/*
 * Unit / wiring suite runner. Runs every top-level test/*.js (the fast,
 * dependency-free checks that extract pieces of index.html's inline script and
 * exercise them) and exits non-zero if any fails — so CI gets a clean signal.
 * Does NOT touch the network or any backend, so it is always safe to run on
 * every push and pull request. The headless end-to-end probes live in
 * qa/probes/ and run separately (npm run test:e2e / the nightly workflow).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Expected-failure (xfail) reproductions: harnesses that DEMONSTRATE an open bug
// by exiting non-zero on purpose. They run as part of the suite (so the repro
// can't bit-rot), but their failure is expected and does NOT fail CI. The day a
// fix lands, the file starts PASSING — we flag that loudly so it gets promoted
// to a hard regression guard (just delete its line here). Keep each entry tied
// to the bug it documents.
const KNOWN_FAILING = new Set([
  'kasper-finish-refresh-popback.js', // finished card re-buckets to Waiting on a stale auto-refresh
]);

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.js') && f !== 'run-all.js')
  .sort();

let failed = 0;
let xfail = 0;
let promoted = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  const ok = r.status === 0;
  if (KNOWN_FAILING.has(f)) {
    if (!ok) { xfail++; console.error('\n>>> xfail (expected, documents an open bug): test/' + f + '\n'); }
    else { promoted++; console.error('\n>>> test/' + f + ' now PASSES — the bug looks fixed. Promote it: remove it from KNOWN_FAILING in run-all.js.\n'); }
    continue;
  }
  if (!ok) { failed++; console.error('\n>>> FAILED: test/' + f + '\n'); }
}
const realCount = files.length - KNOWN_FAILING.size;
console.log(failed
  ? `\n${failed} of ${realCount} unit suite(s) failed ❌`
  : `\nAll ${realCount} unit suites passed ✅`);
if (xfail) console.log(`(${xfail} expected-failure repro${xfail > 1 ? 's' : ''} ran and still fail as documented)`);
if (promoted) console.log(`(${promoted} repro${promoted > 1 ? 's' : ''} now pass — promote them, see above)`);
process.exit(failed ? 1 : 0);
