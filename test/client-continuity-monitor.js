'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../scripts/client-continuity-monitor');
const { runApprovedActions } = require('../scripts/client-continuity-actions');
const { captureView } = require('../scripts/client-continuity-view');
let passed = 0;
function eq(actual, expected) { assert.deepEqual(actual, expected); passed++; }
const now = 1000000;
const healthy = { version: 1, correlated: true, settled: true, outcome: 'success', display: 'content',
  renderedCount: 2, warningVisible: false, retryVisible: false, verifiedAt: now,
  complete: true, authorityMatched: true, authoritativeCount: 2 };

// Execute actual source readers with intercepted dependencies, following the
// established calendar-get-empty-200 source harness. No repaired product copy.
function sourceReader(lane, primary, response) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const name = lane === 'samples' ? '_sxrFetchPosts' : '_calV2FetchPosts';
  const start = html.indexOf(`    async function ${name}(`);
  assert.ok(start >= 0);
  const end = html.indexOf('\n    }', start) + 6;
  const context = vm.createContext({ CAL_SUPABASE_URL: 'https://fixture.invalid', SXR_TABLE: 'sample_reviews',
    SXR_GET_URL: 'https://fixture.invalid/samples', CALENDAR_GET_URL: 'https://fixture.invalid/calendar',
    _sxrSupabaseFetchAllRows: primary, _calSupabaseFetchAllRows: primary,
    fetch: async () => response, console: { warn() {} }, Date });
  return vm.runInContext(`${html.slice(start, end)}; ${name}`, context);
}

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
    const reader = sourceReader(lane, async () => [], null);
    eq((await reader('syntheticfixture')).posts.length, 0);
    const goodFallback = sourceReader(lane, async () => { throw new Error('synthetic'); },
      { ok: true, json: async () => ({ ok: true, posts: [{ id: 'synthetic' }] }) });
    eq((await goodFallback('syntheticfixture')).posts.length, 1);
  }
  // Current main is defective. These assertions prove the detector catches it;
  // strict mode is the coordinator's red/green gate for the repaired source.
  let sourceDefects = 0;
  const bad = [{ status: 401, body: {} }, { status: 403, body: {} }, { status: 429, body: {} },
    { status: 500, body: {} }, { status: 200, body: { ok: false } },
    { status: 200, body: {} }, { status: 200, body: { ok: true, posts: [] } }];
  for (const lane of ['calendar', 'samples']) {
    for (const fixture of bad) {
      const fn = sourceReader(lane, async () => { throw new Error('synthetic read failure'); },
        { ok: fixture.status === 200, status: fixture.status, json: async () => fixture.body });
      let swallowed = false;
      try { const value = await fn('syntheticfixture'); swallowed = value.ok && value.posts.length === 0; } catch {}
      if (swallowed) {
        sourceDefects++;
        eq(M.assessRead(lane, { ...healthy, outcome: 'failure', display: 'empty', renderedCount: 0 }, now).code, 'false_empty');
      } else passed++;
      if (lane === 'calendar') eq(swallowed, false);
    }
    for (const kind of ['malformed', 'timeout']) {
      const fn = sourceReader(lane, async () => { throw new Error('synthetic'); }, {
        ok: true, json: async () => { const e = new Error(kind); if (kind === 'timeout') e.name = 'AbortError'; throw e; },
      });
      await assert.rejects(fn('syntheticfixture')); passed++;
    }
  }
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

  // Prepared viewing adapter: fail closed without the product hook/census, fresh
  // context isolation and mutation refusal independent of product guard state.
  let routes, closed = 0, hookMissing = false, responseListener;
  const snapshot = { ...healthy, verifiedAt: Date.now(), snapshot: 'a'.repeat(32) };
  const browser = { async newContext(options) {
    eq(options.serviceWorkers, 'block');
    return { async route(_, fn) { routes = fn; }, async close() { closed++; }, async newPage() {
      return { setDefaultTimeout() {}, on(_, fn) { responseListener = fn; }, async goto() {},
        async waitForFunction() { if (hookMissing) throw new Error('no hook'); }, async evaluate() { return snapshot; } };
    } };
  } };
  const viewConfig = { lane: 'calendar', enabled: true, activation: 'OWNER_APPROVED_VIEW_CHECKS',
    shareLink: 'https://fixture.invalid/?c=synthetic&t=synthetic', verifierUrl: 'https://fixture.invalid/verify' };
  const census = async () => ({ snapshot: snapshot.snapshot, count: 2, complete: true });
  eq((await captureView(browser, viewConfig, census)).code, 'healthy');
  let aborted = 0, continued = 0;
  for (const [method, url, redirect] of [['POST', 'https://fixture.invalid/writer', false], ['DELETE', 'https://fixture.invalid/row', false], ['POST', viewConfig.verifierUrl, true], ['POST', viewConfig.verifierUrl, false]]) {
    await routes({ request: () => ({ method: () => method, url: () => url, redirectedFrom: () => redirect }), abort: () => aborted++, continue: () => continued++ });
  }
  eq(aborted, 3); eq(continued, 1);
  eq((await captureView(browser, viewConfig, async () => ({ count: 2, complete: true, snapshot: 'b'.repeat(32) }))).code, 'count_unproven');
  hookMissing = true;
  eq((await captureView(browser, viewConfig, census)).code, 'integration_missing'); eq(closed, 3);
  await assert.rejects(captureView(browser, { ...viewConfig, enabled: false }, census)); passed++;
  await assert.rejects(captureView(browser, { ...viewConfig, shareLink: 'private-value' }, census), { message: 'private_view_config_required' }); passed++;
  await assert.rejects(M.routeAlert(M.report('samples', 'false_empty'), { ...config, fallbackUrl: 'private-value' }, fallbackFetch), { message: 'private_route_config_required' }); passed++;

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
  console.log(JSON.stringify({ suite: 'client_continuity_monitor', passed, sourceDefects, live: false }));
  if (process.argv.includes('--strict-source')) assert.equal(sourceDefects, 0, 'coordinator Samples repair required');
}
main().catch(() => { console.error('client_continuity_monitor_failed'); process.exitCode = 1; });
