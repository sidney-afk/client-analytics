'use strict';
const { randomUUID } = require('node:crypto');
const { report, bounded } = require('./client-continuity-monitor');
const ACTIONS = ['approve', 'comment', 'request_changes'];
function assert(ok) { if (!ok) throw new Error('test_scope_refused'); }

// Dependency-injected runner: no default credentials, client, URLs or mutation
// adapter. The private live adapter must implement the atomic server fence below.
// Cancellation is mandatory: a timeout is ambiguous, never permission to retry.
async function runApprovedActions(config, adapter, now = Date.now) {
  assert(config && ['fixture', 'live'].includes(config.mode));
  assert(config.enabled === true && config.activation === 'OWNER_APPROVED_TEST_ACTIONS');
  assert(typeof config.testScope === 'string' && config.testScope.length > 0);
  assert(/^[a-f0-9]{40}$/.test(config.releaseSha) && config.approvedSha === config.releaseSha);
  assert(Number.isFinite(config.expiresAt) && config.expiresAt > now() && config.expiresAt - now() <= 3600000);
  assert(adapter && adapter.mode === config.mode && adapter.atomicScopeFence === true && typeof adapter.quiesce === 'function');
  const runId = randomUUID();
  const deadline = now() + 90000;
  let attempted = false, completed = 0, cleanupOk = false, code = 'healthy';
  const invoke = (fn) => bounded(fn, 5000);
  async function fence() {
    assert(config.enabled === true && config.expiresAt > now() && now() < deadline);
    const scope = await invoke(signal => adapter.readScope(config.testScope, signal));
    assert(scope && scope.id === config.testScope && scope.kind === 'test' && scope.active === true);
    assert((typeof scope.version === 'string' && scope.version.length > 0) || Number.isSafeInteger(scope.version));
    return scope.version;
  }
  async function mutate(operation, surface) {
    const version = await fence(); // including seed and cleanup, immediately before every write
    return invoke(signal => adapter.mutate({ operation, surface, scope: config.testScope,
      scopeVersion: version, runId, ownedOnly: true, signal }));
  }
  try {
    await fence();
    // Durable private reservation BEFORE any action. A crashed process is found
    // by the independent observer; adapters may never adopt pre-existing rows.
    attempted = true;
    await mutate('reserve', 'both');
    for (const surface of ['calendar', 'samples']) {
      await mutate('seed', surface);
      for (const action of ACTIONS) {
        await mutate(action, surface); // no mutation retries, even on response loss
        const persisted = await invoke(signal => adapter.readback({ scope: config.testScope, runId, surface, action, signal }));
        // Readback must open a separate anonymous browser context AND query the
        // authoritative persisted row/receipt, not inspect the acting DOM.
        if (!persisted || persisted.runId !== runId || persisted.action !== action ||
            persisted.scope !== config.testScope || persisted.surface !== surface ||
            persisted.persisted !== true || persisted.freshContext !== true || persisted.receiptCount !== 1) {
          code = 'action_unpersisted'; throw new Error(code);
        }
        completed++;
      }
    }
  } catch { if (code === 'healthy') code = 'action_failed'; }
  finally {
    if (attempted) {
      try {
        // Never race cleanup against a request which may still commit later.
        assert(await invoke(signal => adapter.quiesce({ runId, signal })) === true);
        await mutate('cleanup', 'both');
        const proof = await invoke(signal => adapter.cleanupReadback({ scope: config.testScope, runId, signal }));
        cleanupOk = proof && proof.runId === runId && proof.residue === 0 && proof.preexistingUnchanged === true;
      } catch { cleanupOk = false; }
    }
  }
  if (attempted && !cleanupOk) code = 'cleanup_failed';
  return { ...report('actions', code, completed), cleanupOk, runId };
}
module.exports = { runApprovedActions };
