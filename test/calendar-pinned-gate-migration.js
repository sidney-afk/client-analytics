'use strict';
/*
 * n8n exit, PR 2: a staff browser that returns after the change and still holds
 * a Calendar or Samples repair pinned to the n8n writer is moved onto Supabase ON LOAD, by
 * code, and the move is ATOMIC.
 *
 * "Atomic" is proven here, not asserted: the writer choice
 * (`_writeUiLegacyPinnedSourceTransport`) and the verification source
 * (`_writeUiLegacySourceRows`) are the REAL functions, both read the ONE field
 * `source_gate.source_transport`, and the migration changes that field in ONE
 * write of the whole queue. So there is no state, not even a partial one,
 * where the writer has moved and the reader has not.
 *
 * Runs the real extracted functions from index.html. No network, no browser.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}
const load = (ctx, name) => {
  const asyncFn = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(INDEX);
  vm.runInContext((asyncFn ? 'async ' : '') + extractFunction(INDEX, name), ctx);
};

function gateItem(id, over) {
  return Object.assign({
    id, transport: 'source_only', kind: 'source_only', queuedAt: 1000,
    payload: {},
    source_gate: { surface: 'calendar', client_slug: 'fixture', source_transport: 'webhook',
      post_id: 'card-' + id, component: 'caption', comment_id: 'c-' + id, principal: 'staff:fixture' },
  }, over || {});
}

function world(items, options) {
  const opts = options || {};
  let store = JSON.parse(JSON.stringify(items));
  const calls = { writes: 0, stateChecks: [], fetches: [] };
  const ctx = {
    _isClientLink: !!opts.client,
    LINEAR_OUTBOX_KEY: 'q', SXR_LINEAR_OUTBOX_KEY: 'qs', CAL_SUPABASE_URL: 'https://db.invalid',
    SXR_TABLE: 'sample_reviews', SXR_GET_URL: 'https://n8n.invalid/webhook/sample-review-get',
    CALENDAR_GET_URL: 'https://n8n.invalid/webhook/calendar-get',
    localStorage: { getItem: () => JSON.stringify(store) },
    _writeUiLegacyCommittedTweakRead: () => opts.ledger || [],
    _writeUiLegacyOutboxWithLock: (_surface, cb) => Promise.resolve().then(() => cb()),
    _writeUiLegacyOutboxWrite: (_surface, rows) => { calls.writes++; store = JSON.parse(JSON.stringify(rows)); return true; },
    _writeUiLegacySourceGateState: async item => {
      calls.stateChecks.push(item.source_gate.source_transport);
      return opts.state || 'pending';
    },
    _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(store)),
    _calSupabaseFetchAllRows: async url => { calls.fetches.push(url); return []; },
    _sxrSupabaseFetchAllRows: async url => { calls.fetches.push(url); return []; },
    fetch: async url => { calls.fetches.push(String(url)); return { ok: false }; },
    encodeURIComponent, Date, JSON, Object, String, Array, Error, Promise, Set,
  };
  vm.createContext(ctx);
  ['_writeUiLegacyRawOutboxRows', '_writeUiLegacyTweakKey', '_writeUiLegacyPinnedSourceTransport',
    '_writeUiLegacySourceRows', '_writeUiMigratePinnedGates'].forEach(name => load(ctx, name));
  return { ctx, calls, get store() { return store; } };
}

(async () => {
  // 1. Staff, pinned webhook, Supabase can answer: moved together, in ONE write.
  let w = world([gateItem('a'), gateItem('b', { source_gate: Object.assign(gateItem('b').source_gate, { source_transport: 'supabase' }) })]);
  const before = JSON.parse(JSON.stringify(w.store));
  ok(w.ctx._writeUiLegacyPinnedSourceTransport('calendar', ['a']) === 'webhook',
    'before: the writer for the pinned repair is the n8n webhook');
  let res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 1 && res.kept === 0, 'one pinned gate migrated: ' + JSON.stringify(res));
  ok(w.calls.writes === 1, 'the whole queue is rewritten in exactly ONE write (atomic)');
  ok(w.calls.stateChecks.length === 1 && w.calls.stateChecks[0] === 'supabase',
    'it was re-verified against Supabase first (the probe copy read as supabase)');
  ok(w.calls.fetches.every(u => !/n8n\./.test(u)), 'verification made no n8n request');
  const a = w.store.find(x => x.id === 'a');
  ok(a.source_gate.source_transport === 'supabase', 'the pinned gate now says supabase');
  ok(w.ctx._writeUiLegacyPinnedSourceTransport('calendar', ['a']) === 'supabase',
    'the WRITER (real function) now resolves to supabase from that one field');
  await w.ctx._writeUiLegacySourceRows(a);
  ok(w.calls.fetches.some(u => /db\.invalid\/rest\/v1\/calendar_posts\?/.test(u)) && !w.calls.fetches.some(u => /calendar-get/.test(u)),
    'the READER (real function) now reads calendar_posts, not the n8n calendar-get, from the same field');
  const strip = item => { const c = JSON.parse(JSON.stringify(item)); if (c.source_gate) c.source_gate.source_transport = '*'; return c; };
  ok(JSON.stringify(w.store.map(strip)) === JSON.stringify(before.map(strip)),
    'nothing else in the queue changed (ids, order, payload, every other gate field)');
  ok(w.store[1].source_gate.source_transport === 'supabase', 'a gate already on supabase is left as it was');

  // 2. Supabase cannot answer: leave the pin alone and try again next time.
  w = world([gateItem('a')], { state: 'unknown' });
  res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 0 && res.kept === 1 && w.calls.writes === 0 && w.store[0].source_gate.source_transport === 'webhook',
    'an unanswerable verification leaves the pin exactly as it was, zero writes');

  // 3. Another person's gate is not touched.
  w = world([gateItem('a')], { state: 'principal_mismatch' });
  res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 0 && w.calls.writes === 0, 'a gate owned by another identity is left alone');

  // 4. A client link is carved out entirely: no read, no write.
  w = world([gateItem('a')], { client: true });
  res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 0 && w.calls.writes === 0 && w.calls.stateChecks.length === 0 && w.calls.fetches.length === 0,
    'on a client link nothing is read, checked or written (approve and request-changes carve-out)');

  // 5. A gate with a committed-tweak ledger row stays pinned (signature includes the transport).
  w = world([gateItem('a')], { ledger: [{ key: 'calendar|fixture|card-a|caption' }] });
  res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 0 && res.kept === 1 && w.calls.writes === 0, 'a gate with a committed-tweak ledger row is left pinned, not half-moved');

  // 6. Samples gates (PR 4).
  w = world([gateItem('a', { source_gate: Object.assign(gateItem('a').source_gate, { surface: 'sxr' }) })]);
  res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 1 && w.calls.writes === 1 && w.store[0].source_gate.source_transport === 'supabase',
    'a Samples gate migrates the same way (n8n exit PR 4), verified against Supabase first');
  ok(w.calls.stateChecks.length === 1 && w.calls.stateChecks[0] === 'supabase', 'the Samples probe copy read as supabase');
  // A Samples gate is read from the sample_reviews table once it has moved, never sample-review-get.
  w.calls.fetches.length = 0;
  await w.ctx._writeUiLegacySourceRows(w.store[0]);
  ok(w.calls.fetches.some(u => /db\.invalid\/rest\/v1\/sample_reviews\?/.test(u)) && !w.calls.fetches.some(u => /sample-review-get/.test(u)),
    'the moved Samples gate is verified from sample_reviews, not the n8n sample-review-get');

  // 7. Row changed under us between the check and the lock: no rewrite.
  w = world([gateItem('a')]);
  const inner = w.ctx._writeUiLegacySourceGateState;
  w.ctx._writeUiLegacySourceGateState = async item => {
    const s = await inner(item);
    w.ctx._writeUiLegacyOutboxWrite('calendar', [gateItem('a', { source_gate: Object.assign(gateItem('a').source_gate, { source_transport: 'supabase' }) })]);
    w.calls.writes = 0;
    return s;
  };
  res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 0 && w.calls.writes === 0, 'a gate another tab already moved is not rewritten a second time');

  // 8. Idempotent.
  w = world([gateItem('a')]);
  await w.ctx._writeUiMigratePinnedGates();
  res = await w.ctx._writeUiMigratePinnedGates();
  ok(res.migrated === 0 && res.kept === 0 && w.calls.writes === 1, 'running it again does nothing');

  if (failures) { console.error('\ncalendar-pinned-gate-migration: ' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-pinned-gate-migration: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
