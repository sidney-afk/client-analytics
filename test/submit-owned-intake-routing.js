'use strict';

// Actual Submit selector; synthetic storage and route boundaries, no network.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { extractFunction } = require('./helpers/extract-function');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const base = execFileSync('git', ['--no-replace-objects', 'show', 'b60a9705492002830eed60ece874e0686fc4b538:index.html'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const native = JSON.stringify({ version: 3, payload: { request_id: 'submission:original' }, context: { initiating_actor_id: 'original-actor' }, result: { native_committed: true } });

function harness(source, options = {}) {
  const saved = new Map([['draft', 'original draft'], ['last-link', 'original link']]);
  if (options.native !== undefined) saved.set('native', options.native);
  if (options.legacy) saved.set('legacy', 'original-f44-receipt');
  const before = JSON.stringify([...saved]);
  const calls = [], status = { textContent: '' };
  const input = { value: 'Fictional client', dataset: { clientSlug: 'fictionalclient' } };
  const ctx = {
    console, JSON, String, Error, Promise,
    LINEAR_RECEIPTS_KEY: 'legacy', NATIVE_INTAKE_PENDING_KEY: 'native',
    localStorage: {
      getItem(key) { if (options.failRead === key) throw Error('synthetic read failure'); return saved.get(key) || null; },
      setItem() { throw Error('unexpected storage mutation'); },
      removeItem() { throw Error('unexpected storage deletion'); },
    },
    document: { getElementById: id => id === 'linearStatus' ? status : id === 'linearClientSearch' ? input : null },
    _linearIntakeRead: () => options.native ? JSON.parse(options.native) : null,
    _submitLinearFormLegacy: mode => { calls.push('legacy:' + mode); return { legacy: true }; },
    linearClientRows: [{}],
    _linearResolveClientRow: () => ({ slug: 'fictionalclient' }),
    // Stop at the existing authentication boundary; no invented actor or request.
    _syncviewRequireStaffIdentity: async () => { calls.push('native-auth'); throw Error('synthetic authentication stop'); },
    fetch: () => { throw Error('unexpected external request'); },
  };
  if (options.helper !== 'missing') ctx._writeUiRerouteUseGatewayWhenReady = async () => { calls.push('routing'); return options.enrolled === true; };
  vm.createContext(ctx);
  vm.runInContext('async ' + extractFunction(source, '_submitLinearFormRoutedOnce'), ctx);
  return { ctx, calls, saved, status, before };
}

async function run(source, options, expected) {
  const h = harness(source, options);
  const result = await h.ctx._submitLinearFormRoutedOnce('both');
  assert.deepEqual(h.calls, expected);
  assert.equal(JSON.stringify([...h.saved]), h.before, 'all saved bytes survive route selection');
  return { ...h, result };
}

(async () => {
  // Pinned unchanged-base counterexamples: a native receipt is downgraded,
  // and unreadable ownership also enters the legacy path.
  await run(base, { native, helper: 'missing' }, ['legacy:both']);
  await run(base, { native, failRead: 'legacy' }, ['legacy:both']);

  await run(html, { native, helper: 'missing' }, ['native-auth']);
  await run(html, { native, enrolled: false }, ['native-auth']);
  await run(html, { native, enrolled: true }, ['native-auth']);
  for (const options of [{ native, failRead: 'legacy' }, { native, failRead: 'native' }, { native: '{' }, { native: 'null' }, { native: '{}' }, { native: '{"payload":{}}' }]) {
    const h = await run(html, options, []);
    assert.equal(h.result.error, 'submission_recovery_unreadable');
    assert.match(h.status.textContent, /could not be read/);
    assert.match(h.status.textContent, /before recreating/);
  }
  // Existing F44 ownership retains its original priority, even when both
  // stores exist. New no-debt work retains today's offered routing behavior.
  await run(html, { legacy: true, native, helper: 'missing' }, ['legacy:both']);
  await run(html, { legacy: true, failRead: 'native' }, ['legacy:both']);
  await run(html, { helper: 'missing' }, ['legacy:both']);
  await run(html, { enrolled: false }, ['routing', 'legacy:both']);
  await run(html, { enrolled: true }, ['routing', 'native-auth']);
  console.log('PASS submit-owned-intake-routing: 16 groups, including 2 pinned base counterexamples; offline selector proof only');
})().catch(error => { console.error(error); process.exitCode = 1; });
