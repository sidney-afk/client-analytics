'use strict';
// INACTIVE DRAFT. Never supplies credentials, installs schedules, or sends Slack.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

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
  let child;
  try {
    child = execute(process.execPath, [path.join(__dirname, 'client-continuity-independent.js')],
      { cwd, env: childEnv, encoding: 'utf8', timeout: 125000, maxBuffer: 16384, windowsHide: true });
  } catch { return { ok: false, code: 'sentinel_unconfirmed' }; }
  if (child.error || child.signal || child.status !== 0) return { ok: false, code: 'sentinel_unconfirmed' };
  let result;
  try { result = JSON.parse(child.stdout); } catch { return { ok: false, code: 'sentinel_unconfirmed' }; }
  if (result.ok !== true || result.code !== 'pinned_receipts_and_sentinel_healthy' || result.lane !== 'observer') return { ok: false, code: 'sentinel_unconfirmed' };
  // No failure/start ping and no retry. A missing success remains a missed beat.
  try {
    const response = await (deps.fetchImpl || fetch)(url.href, {
      method: 'POST', body: '', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200 || (await response.text()).trim() !== 'OK') return { ok: false, code: 'heartbeat_unconfirmed' };
    return { ok: true, code: 'sentinel_heartbeat_confirmed' };
  } catch { return { ok: false, code: 'heartbeat_unconfirmed' }; }
}
if (require.main === module) run().then(result => {
  console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 2;
}).catch(() => { console.error('{"ok":false,"code":"sentinel_heartbeat_refused"}'); process.exitCode = 2; });
module.exports = { run };
