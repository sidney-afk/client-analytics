'use strict';
/*
 * Serves the app on :8000, runs every probe_*.js in this folder against it, then
 * stops the server. Used by `npm run test:headless` (locally and in CI).
 *
 * These probes hit the LIVE backend and mutate the `sidneylaruel` test client
 * (cleaning up after themselves). They are intentionally NOT part of `npm test`.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const PORT = 8000;

function waitForServer(timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function tick() {
      const req = http.get({ host: 'localhost', port: PORT, path: '/index.html' }, res => { res.resume(); resolve(); });
      req.on('error', () => { if (Date.now() - t0 > timeoutMs) reject(new Error('server never came up')); else setTimeout(tick, 300); });
    })();
  });
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: repoRoot, stdio: 'ignore' });
  let failed = 0;
  try {
    await waitForServer(15000);
    console.log('static server up on :' + PORT);
    const probes = fs.readdirSync(__dirname).filter(f => /^probe_.*\.js$/.test(f)).sort();
    for (const f of probes) {
      console.log('\n=== ' + f + ' ===');
      const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
      if (r.status !== 0) { failed++; console.error('>>> FAILED: ' + f); }
    }
    console.log(failed ? `\n${failed} probe(s) failed ❌` : `\nAll ${probes.length} headless probes passed ✅`);
  } catch (e) {
    failed++; console.error('runner error: ' + e.message);
  } finally {
    try { server.kill('SIGTERM'); } catch (e) {}
  }
  process.exit(failed ? 1 : 0);
})();
