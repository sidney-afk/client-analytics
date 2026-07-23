'use strict';
/*
 * Headless end-to-end probe runner (the "do every interaction" suite).
 *
 * Serves index.html on :8000 and drives the REAL app in headless Chromium
 * against the LIVE Supabase + n8n backend, scoped to the test client
 * `sidneylaruel` (every probe cleans up after itself). Because these write to
 * the live backend and depend on network timing, they run on a schedule / on
 * demand (the e2e-nightly workflow), NOT on every push.
 *
 * Which probes run: qa/probes/nightly-manifest.txt (one filename per line, '#'
 * comments allowed). If that file is absent, every qa/probes/p*.js runs.
 * Each probe is retried up to MAX_ATTEMPTS times to absorb transient network /
 * realtime-timing flakiness; a probe counts as failed only if every attempt
 * fails. Exit code is non-zero if any probe fails, so CI gets a clean signal.
 *
 * Usage:  node qa/run-probes.js [probeName ...]   (explicit names override the manifest)
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  STAFF_KEY_ENV,
  clientEntrySafeChildEnv,
} = require('./test-client-entry.js');
const {
  NIGHTLY_PROBES_ENV,
  parseProbeSelection,
} = require('./nightly-input.js');

const ROOT = path.resolve(__dirname, '..');
const PROBES = path.join(__dirname, 'probes');
const MAX_ATTEMPTS = Number(process.env.PROBE_ATTEMPTS || 3);
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 240000);
const PORT = 8000;

function resolveProbeList() {
  const cliNames = process.argv.slice(2).filter(Boolean);
  if (cliNames.length) return parseProbeSelection(cliNames.join(' '));
  const dispatchNames = parseProbeSelection(process.env[NIGHTLY_PROBES_ENV]);
  if (dispatchNames.length) return dispatchNames;
  const manifest = path.join(PROBES, 'nightly-manifest.txt');
  if (fs.existsSync(manifest)) {
    return fs.readFileSync(manifest, 'utf8').split('\n')
      .map(l => l.replace(/#.*$/, '').trim()).filter(Boolean)
      .map(n => (n.endsWith('.js') ? n : n + '.js'));
  }
  return fs.readdirSync(PROBES).filter(f => /^p.*\.js$/.test(f) && f !== 'lib.js').sort();
}

async function serverUp() {
  try {
    const response = await fetch('http://localhost:' + PORT + '/index.html');
    return response.ok;
  } catch (_) {
    return false;
  }
}
async function waitForOwnedServer(child, failed, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (!child || child.exitCode !== null || failed()) return false;
    if (await serverUp()) {
      await new Promise(resolve => setImmediate(resolve));
      return child.exitCode === null && !failed();
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

(async () => {
  const probes = resolveProbeList();
  if (!probes.length) { console.error('No probes to run.'); process.exit(2); }
  const missing = probes.filter(f => !fs.existsSync(path.join(PROBES, f)));
  if (missing.length) {
    console.error('Unknown probe selection: ' + missing.join(', '));
    process.exit(2);
  }
  if (await serverUp()) {
    console.error('Port :' + PORT + ' is already occupied; refusing to send protected client URLs to an unowned server.');
    process.exit(2);
  }

  console.log('Starting static server on :' + PORT + ' …');
  let serverFailed = false;
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
    env: clientEntrySafeChildEnv(),
  });
  srv.once('error', () => { serverFailed = true; });
  srv.once('exit', () => { serverFailed = true; });
  const killServer = () => { try { process.kill(-srv.pid); } catch (e) { try { srv.kill('SIGKILL'); } catch (_) {} } };
  process.on('exit', killServer);

  if (!(await waitForOwnedServer(srv, () => serverFailed))) {
    console.error('Owned static server never came up on :' + PORT);
    killServer();
    process.exit(2);
  }
  console.log('Server up. Running ' + probes.length + ' probe(s), up to ' + MAX_ATTEMPTS + ' attempt(s) each.\n');

  const failed = [];
  for (const f of probes) {
    let ok = false, lastOut = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      const probeEnv = clientEntrySafeChildEnv();
      if (process.env[STAFF_KEY_ENV]) probeEnv[STAFF_KEY_ENV] = process.env[STAFF_KEY_ENV];
      const r = spawnSync(process.execPath, [path.join(PROBES, f)], {
        cwd: PROBES,
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        env: probeEnv,
      });
      lastOut = (r.stdout || '') + (r.stderr || '');
      ok = r.status === 0;
      if (!ok && attempt < MAX_ATTEMPTS) console.log('  · ' + f + ' attempt ' + attempt + ' failed — retrying');
    }
    const summary = (lastOut.match(/[^\n]*pass=\d+ fail=\d+[^\n]*/g) || []).pop() || '(no summary)';
    console.log((ok ? '✅ ' : '❌ ') + f + '  ' + summary.trim());
    if (!ok) { failed.push(f); console.log('--- ' + f + ' last-attempt output (tail) ---\n' + lastOut.split('\n').slice(-25).join('\n') + '\n'); }
  }

  killServer();
  console.log('\n' + (failed.length
    ? failed.length + ' of ' + probes.length + ' probe(s) FAILED after ' + MAX_ATTEMPTS + ' attempts ❌: ' + failed.join(', ')
    : 'All ' + probes.length + ' probes passed ✅'));
  process.exit(failed.length ? 1 : 0);
})().catch(() => {
  console.error('Probe runner failed before execution');
  process.exit(2);
});
