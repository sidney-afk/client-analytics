'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const M = require('../scripts/client-continuity-monitor');
const { runApprovedActions } = require('../scripts/client-continuity-actions');
const { sourceChecks } = require('./helpers/client-continuity-source');
let passed = 0;
function eq(actual, expected) { assert.deepEqual(actual, expected); passed++; }
const now = 1000000;
const healthy = { version: 1, correlated: true, settled: true, outcome: 'success', display: 'content',
  renderedCount: 2, warningVisible: false, retryVisible: false, verifiedAt: now,
  complete: true, authorityMatched: true, authoritativeCount: 2 };

let stage='detectors';
async function main() {
  for (const lane of ['calendar', 'samples']) {
    eq(M.assessRead(lane, healthy, now).code, 'healthy');
    for (const status of [401, 403]) eq(M.assessRead(lane, { validLink: true, authStatus: status }, now).code, 'valid_link_auth');
    eq(M.assessRead(lane, { ...healthy, renderedCount: 0, authoritativeCount: 0, display: 'empty' }, now).code, 'healthy');
    for (const outcome of ['failure', 'partial']) {
      eq(M.assessRead(lane, { ...healthy, outcome, display: 'empty' }, now).code, 'false_empty');
      eq(M.assessRead(lane, { ...healthy, outcome }, now).code, 'stale_unwarned');
    }
    eq(M.assessRead(lane, { ...healthy, verifiedAt: now - 300001 }, now).code, 'stale_unwarned');
    eq(M.assessRead(lane, { ...healthy, verifiedAt: now - 300001, warningVisible: true }, now).code, 'stale_overdue');
    eq(M.assessRead(lane, { ...healthy, authoritativeCount: 3 }, now).code, 'count_unproven');
    eq(M.assessRead(lane, { ...healthy, complete: false }, now).code, 'count_unproven');
    eq(M.assessRead(lane, { ...healthy, authoritativeCount: undefined }, now).code, 'count_unproven');
    eq(M.assessRead(lane, { ...healthy, verifiedAt: now + 1 }, now).code, 'stale_unwarned');
    eq(M.assessRead(lane, { ...healthy, correlated: false }, now).code, 'integration_missing');
    eq(M.assessRead(lane, null, now).code, 'integration_missing');
    let calls = 0;
    eq((await M.viewingCheck(lane, async () => { calls++; throw new Error('private'); })).code, 'read_failed'); eq(calls, 2);
    calls = 0;
    eq((await M.viewingCheck(lane, async () => { calls++; return { validLink: true, authStatus: 401 }; })).code, 'valid_link_auth'); eq(calls, 1);
  }
  stage='actual_source';
  const sourceResult = await sourceChecks();
  passed += sourceResult.passed;
  stage='liveness_and_routing';
  const terminal = { startedAt: now - 1000, finishedAt: now, code: 'healthy' };
  const state = { lane: 'calendar', enabled: true, activatedAt: 1, terminal, lastStartedAt: terminal.startedAt };
  eq(M.assessLiveness(state, now).code, 'healthy');
  eq(M.assessLiveness({ ...state, terminal: null }, now).code, 'monitor_missing');
  eq(M.assessLiveness({ ...state, lastStartedAt: now - 120001 }, now).code, 'terminal_missing');
  eq(M.assessLiveness({ ...state, terminal: { ...terminal, code: 'read_failed' } }, now).code, 'read_failed');
  eq(M.assessLiveness({ ...state, incident: { delivered: false } }, now).code, 'alert_undelivered');
  eq(M.assessLiveness({ ...state, incident: { delivered: true, openedAt: now - 600001 } }, now).code, 'ack_overdue');
  eq(M.assessLiveness({ ...state, enabled: false }, now).code, 'inactive');
  const config = { enabled: true, activation: 'OWNER_APPROVED_DELIVERY_DRILL', primaryUrl: 'https://relay.invalid/hook',
    fallbackUrl: 'https://independent.invalid/hook', fallbackToken: 'synthetic', n8nApiKey: 'synthetic', n8nBaseUrl: 'https://relay.invalid' };
  let calls = 0;
  const fallbackFetch = async (url, init) => {
    calls++;
    if (String(url).includes('relay.invalid')) throw new Error('https://private.invalid/SECRET');
    const body = JSON.parse(init.body);
    assert.equal(body.issue_identifier, 'samples_false_empty');
    return { ok: true, json: async () => ({ run_id: body.details.run_id, delivered: true }) };
  };
  let delivery = await M.routeAlert(M.report('samples', 'false_empty'), config, fallbackFetch);
  eq(delivery.fallbackDelivered, true); eq(delivery.primaryDelivered, false); eq(calls, 2);
  eq(JSON.stringify(delivery).includes('SECRET'), false);
  delivery = await M.routeAlert(M.report('samples', 'false_empty'), config, async () => ({ status: 200, ok: true, text: async () => '{}', json: async () => ({}) }));
  eq(delivery.delivered, false); eq(delivery.exitCode, 1);
  await assert.rejects(M.routeAlert(M.report('samples', 'false_empty'), { ...config, enabled: false }, fallbackFetch)); passed++;
  await assert.rejects(M.routeAlert(M.report('samples', 'false_empty'), { ...config, fallbackUrl: config.primaryUrl }, fallbackFetch)); passed++;
  let acceptedPayload, fallbackCalls = 0;
  delivery = await M.routeAlert(M.report('calendar', 'recovered'), config, async (url, init) => {
    if (String(url).includes('independent')) { fallbackCalls++; throw new Error('must not call'); }
    if (init.method === 'POST') {
      acceptedPayload = JSON.parse(init.body);
      return { status: 200, text: async () => '{}' };
    }
    return { ok: true, json: async () => ({ data: [{ id: 'synthetic', status: 'success', data: { resultData: {
      runData: { 'Receive Edge Alert': [{ data: { main: [[{ json: { body: acceptedPayload } }]] } }] },
    } } }] }) };
  });
  eq(delivery.primaryDelivered, true); eq(delivery.acknowledged, false); eq(fallbackCalls, 0);
  eq(acceptedPayload.issue_identifier, 'calendar_recovered');

  stage='test_actions';
  // Disk-backed isolated fixture: independent readback reopens the persisted
  // store, atomic scope-version and ownership fences protect an unrelated row.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-'));
  const file = path.join(dir, 'store.json');
  const write = v => fs.writeFileSync(file, JSON.stringify(v));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const initial = { sentinel: { content: 'preexisting synthetic' }, rows: {}, scope: { id: 'synthetic', kind: 'test', active: true, version: 1 } };
  let writes = 0, reads = 0, lose = false, drift = false;
  const adapter = {
    mode: 'fixture', atomicScopeFence: true,
    async quiesce() { return true; },
    async readScope() { reads++; return read().scope; },
    async mutate(m) {
      const db = read();
      if (drift && m.operation === 'comment') db.scope.kind = 'client';
      assert.ok(db.scope.kind === 'test' && db.scope.active && db.scope.id === m.scope && db.scope.version === m.scopeVersion);
      writes++;
      if (m.operation === 'cleanup') db.rows = Object.fromEntries(Object.entries(db.rows).filter(([k]) => !k.startsWith(m.runId)));
      else db.rows[`${m.runId}:${m.surface}:${m.operation}`] = { runId: m.runId, scope: m.scope, surface: m.surface, action: m.operation };
      write(db);
      if (lose && m.operation === 'comment') throw new Error('response lost after commit');
    },
    async readback(m) { const row = read().rows[`${m.runId}:${m.surface}:${m.action}`]; return { ...row, persisted: !!row, freshContext: true, receiptCount: row ? 1 : 0 }; },
    async cleanupReadback(m) { const db = read(); return { runId: m.runId, residue: Object.keys(db.rows).filter(k => k.startsWith(m.runId)).length, preexistingUnchanged: JSON.stringify(db.sentinel) === JSON.stringify(initial.sentinel) }; },
  };
  const approved = { mode: 'fixture', enabled: true, activation: 'OWNER_APPROVED_TEST_ACTIONS', testScope: 'synthetic',
    releaseSha: 'a'.repeat(40), approvedSha: 'a'.repeat(40), expiresAt: now + 600000 };
  try {
    write(initial);
    let r = await runApprovedActions(approved, adapter, () => now);
    eq(r.code, 'healthy'); eq(r.count, 6); eq(r.cleanupOk, true); eq(reads, writes + 1); eq(read(), initial);
    for (const patch of [{ enabled: false }, { testScope: '' }, { expiresAt: now }, { approvedSha: 'b'.repeat(40) }, { mode: 'live' }]) {
      await assert.rejects(runApprovedActions({ ...approved, ...patch }, adapter, () => now)); passed++;
    }
    write({ ...initial, scope: { ...initial.scope, kind: 'client' } });
    const before = writes;
    r = await runApprovedActions(approved, adapter, () => now); eq(r.code, 'action_failed'); eq(writes, before);
    write(initial); lose = true;
    r = await runApprovedActions(approved, adapter, () => now); eq(r.code, 'action_failed'); eq(r.cleanupOk, true); eq(read(), initial);
    lose = false; drift = true; write(initial);
    r = await runApprovedActions(approved, adapter, () => now); eq(r.code, 'action_failed'); eq(r.cleanupOk, true);
    drift = false; write(initial);
    r = await runApprovedActions(approved, { ...adapter, readback: async () => ({ persisted: false }) }, () => now);
    eq(r.code, 'action_unpersisted'); eq(r.cleanupOk, true);
    write(initial);
    r = await runApprovedActions(approved, { ...adapter, cleanupReadback: async () => ({ residue: 1 }) }, () => now);
    eq(r.code, 'cleanup_failed');
    write(initial);
    r = await runApprovedActions(approved, { ...adapter, quiesce: async () => false }, () => now);
    eq(r.code, 'cleanup_failed'); eq(Object.keys(read().rows).length > 0, true);
    write(initial);
    const noVersionWrites = writes;
    r = await runApprovedActions(approved, { ...adapter, readScope: async () => ({ ...initial.scope, version: undefined }) }, () => now);
    eq(r.code, 'action_failed'); eq(writes, noVersionWrites);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(JSON.stringify({ suite: 'client_continuity_monitor', passed, originalDefectsDetected: sourceResult.originalDefectsDetected, repairedSource: true, live: false }));

}
main().catch(error => { console.error(JSON.stringify({suite:'client_continuity_monitor',stage,code:error.name==='AssertionError'?'assertion_failed':'fixture_failed'})); process.exitCode = 1; });
