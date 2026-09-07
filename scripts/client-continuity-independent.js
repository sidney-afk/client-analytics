'use strict';
// Read-only consumer of the approved existing collector/evaluator. No send,
// observe, deliver, state recovery, acknowledgement or workflow dispatch call.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

async function assess(H, O, c, env, temp, binding, deps = {}) {
  const failed = code => ({ ok: false, lane: 'observer', code });
  try {
    const input = await H.collect(c, env, temp, deps.fetchImpl || fetch, deps.download);
    const now = (deps.now || Date.now)();
    if (input.unavailable || !input.previous) return failed('receipt_unconfirmed');
    // Historic unbound receipts are valid history, but cannot prove this target.
    if (!input.records.length || input.records.some(record =>
      ['pageSourceSha', 'pageBlobSha', 'pageSha256'].some(key => record[key] !== binding[key]))) return failed('receipt_binding_mismatch');
    const results = O.evaluate(input.records, c.activatedAt, now);
    if (results.length !== 2 || results.some(result => result.ok !== true)) return failed('receipt_unconfirmed');

    // Read the SAME newest observer artifact collect downloaded. A failed or
    // ambiguous Slack/n8n delivery cannot be hidden by fresh healthy view rows.
    const terminalFile = path.join(temp, 'previous', 'observer-terminal.json');
    if (!fs.lstatSync(terminalFile).isFile() || fs.statSync(terminalFile).size > 16384) return failed('delivery_unconfirmed');
    const terminal = JSON.parse(fs.readFileSync(terminalFile, 'utf8'));
    if (terminal.version !== 1 || terminal.releaseSha !== c.releaseSha ||
        !Number.isFinite(terminal.observedAt) || terminal.observedAt > now || now - terminal.observedAt >= 600000 ||
        terminal.pendingDelivery !== false || !Array.isArray(terminal.results) || terminal.results.length !== 2 ||
        ['calendar', 'samples'].some(lane => terminal.results.filter(r => r.lane === lane &&
          r.ok === true && ['healthy', 'recovered'].includes(r.code)).length !== 1)) return failed('delivery_unconfirmed');
    if (Object.values(input.previous.lanes).some(event => event.status !== 'confirmed' || event.result.ok !== true)) return failed('delivery_unconfirmed');

    // Recheck scheduler state after receipt work; API errors or a latest failed
    // delivery observer remain red. Never use an older success as a substitute.
    const sentinel = await H.sentinel(c, env, deps.fetchImpl || fetch, (deps.now || Date.now)());
    if (sentinel.ok !== true) return failed('sentinel_unconfirmed');
    return { ok: true, lane: 'observer', code: 'pinned_receipts_and_sentinel_healthy' };
  } catch { return failed('receipt_unconfirmed'); }
}

async function main(env = process.env) {
  if (!path.isAbsolute(env.CONTINUITY_CHECKOUT || '')) throw Error('private_config_required');
  const checkout = fs.realpathSync(env.CONTINUITY_CHECKOUT);
  if (checkout !== fs.realpathSync(path.join(__dirname, '..'))) throw Error('release_mismatch');
  const H = require(path.join(checkout, 'scripts', 'client-continuity-hosted.js'));
  const O = require(path.join(checkout, 'scripts', 'client-continuity-observer.js'));
  const R = require(path.join(checkout, 'scripts', 'client-continuity-run.js'));
  const c = H.config(env, 'sentinel'); // existing exact-clean-Git + enable checks
  const view = JSON.parse(env.CONTINUITY_PRIVATE_VIEW_JSON || '{}');
  if (view.releaseSha !== c.releaseSha || c.recoveryEnabled === true) throw Error('release_mismatch');
  const binding = R.resolvePageSource(view, checkout); // actual immutable blob
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-independent-'));
  try {
    R.privatePath(temp);
    return await assess(H, O, c, env, temp, binding);
  } finally {
    // Exact newly created private temp only; never a configured storage path.
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('continuity-independent-')) fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (require.main === module) {
  const deadline = setTimeout(() => process.exit(2), 120000);
  main().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 2; })
    .catch(() => { console.error('{"ok":false,"code":"independent_receipts_refused"}'); process.exitCode = 2; })
    .finally(() => clearTimeout(deadline));
}
module.exports = { assess, main };
