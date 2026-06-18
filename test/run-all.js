'use strict';
/*
 * Runs every top-level test/*.js suite (the fast, dependency-free unit/wiring
 * checks). Does NOT descend into test/headless/ — those drive a real browser
 * against the live backend and are run separately via `npm run test:headless`.
 * Exit code is non-zero if any suite fails, so CI gets a clean signal.
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
  ? `\n${failed} of ${files.length} suite(s) failed ❌`
  : `\nAll ${files.length} suites passed ✅`);
process.exit(failed ? 1 : 0);
