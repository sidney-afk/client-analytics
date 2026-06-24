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

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.js') && f !== 'run-all.js')
  .sort();

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error('\n>>> FAILED: test/' + f + '\n'); }
}
console.log(failed
  ? `\n${failed} of ${files.length} unit suite(s) failed ❌`
  : `\nAll ${files.length} unit suites passed ✅`);
process.exit(failed ? 1 : 0);
