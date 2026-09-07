'use strict';
// INACTIVE DRAFT. Never supplies credentials, installs schedules, or sends Slack.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const TIMING = Object.freeze({ assessmentTimeoutMs: 125000, pingTimeoutMs: 5000 });
const FAILURE_CODES = new Set(['receipt_unconfirmed', 'receipt_binding_mismatch', 'delivery_unconfirmed', 'sentinel_unconfirmed']);

async function run(env = process.env, deps = {}) {
  const refused = () => ({ ok: false, code: 'sentinel_heartbeat_refused' });
  if (env.CONTINUITY_HEARTBEAT_ACTIVATION !== 'OWNER_APPROVED_SENTINEL_HEARTBEAT') return refused();
  let url;
  try { url = new URL(env.CONTINUITY_HEALTHCHECKS_PING_URL); } catch { return refused(); }
  // One reviewed provider host; no redirects, arbitrary hosts, query secrets,
  // slug auto-provisioning, URL credentials, raw bodies, or diagnostic exports.
  if (url.origin !== 'https://hc-ping.com' || url.username || url.password || url.search || url.hash ||
      !/^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)) return refused();
  if (!path.isAbsolute(env.CONTINUITY_CHECKOUT || '')) return refused();
  const cwd = env.CONTINUITY_CHECKOUT;
  try { if (fs.realpathSync(cwd) !== fs.realpathSync(path.join(__dirname, '..'))) return refused(); } catch { return refused(); }
  const childEnv = { ...env, CONTINUITY_ACTIVATION: 'OWNER_APPROVED_CONTINUITY_SENTINEL' };
  // Existing CLI checks the exact clean Git release and its own enable bit.
  const execute = deps.execute || ((file, args, options) => spawnSync(file, args, options));
  let child, assessmentCode = 'sentinel_unconfirmed', healthy = false;
  try {
    child = execute(process.execPath, [path.join(__dirname, 'client-continuity-independent.js')],
      { cwd, env: childEnv, encoding: 'utf8', timeout: TIMING.assessmentTimeoutMs, maxBuffer: 16384, windowsHide: true });
    const result = JSON.parse(child.stdout);
    healthy = !child.error && !child.signal && child.status === 0 && result.ok === true &&
      result.code === 'pinned_receipts_and_sentinel_healthy' && result.lane === 'observer';
    if (!child.error && !child.signal && result.ok === false && result.lane === 'observer' && FAILURE_CODES.has(result.code)) assessmentCode = result.code;
  } catch { /* An unknown assessment is red and gets the same bounded failure signal. */ }
  // Signal observed failure immediately; do not stack a missed-success period
  // on receipt staleness. No start ping, diagnostic body, redirect or retry.
  const outcome = confirmed => healthy
    ? { ok: confirmed, code: confirmed ? 'sentinel_heartbeat_confirmed' : 'heartbeat_unconfirmed' }
    : { ok: false, code: confirmed ? 'sentinel_failure_signalled' : 'sentinel_failure_signal_unconfirmed', assessmentCode };
  try {
    const response = await (deps.fetchImpl || fetch)(url.href + (healthy ? '' : '/fail'), {
      method: 'POST', body: '', redirect: 'error', signal: AbortSignal.timeout(TIMING.pingTimeoutMs),
    });
    return outcome(response.status === 200 && (await response.text()).trim() === 'OK');
  } catch { return outcome(false); }
}
if (require.main === module) run().then(result => {
  console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 2;
}).catch(() => { console.error('{"ok":false,"code":"sentinel_heartbeat_refused"}'); process.exitCode = 2; });
module.exports = { run, TIMING };
