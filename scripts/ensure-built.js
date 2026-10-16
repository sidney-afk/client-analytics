'use strict';
/*
 * ensure-built.js -- builds index.html and js/sv-*.js from src/index/ before a
 * local runner reads them. They are build output and are not committed (since
 * 2026-10-15), so a fresh checkout has none and an old one may hold a stale
 * copy. CI builds through .github/actions/build-index; the local runners
 * (test/run-all.js, qa/master.js, qa/run-probes.js) call this instead, which
 * runs the very same `node scripts/build-index.js`.
 *
 *   require('../scripts/ensure-built').ensureBuilt();   // exits 1 if the build fails
 *   node scripts/ensure-built.js
 */
const path = require('path');
const { spawnSync } = require('child_process');

function ensureBuilt({ quiet = true } = {}) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build-index.js')], { stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'] });
  if (r.status !== 0) {
    console.error('npm run build:index failed, so nothing that reads index.html was run');
    process.exit(1);
  }
}

if (require.main === module) ensureBuilt({ quiet: false });
module.exports = { ensureBuilt };
