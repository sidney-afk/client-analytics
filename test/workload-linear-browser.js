'use strict';

// Hermetic browser contract for Workload's Linear due-date editor. The UI is
// optimistic, but any non-exact acknowledgement must restore the previous
// deadline. A confirmed Linear commit with a lagging mirror is the one case
// that stays visible and warns instead of pretending the write failed.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const ch = source[index], next = source[index + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; index++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; index++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

function harness(reply, role = 'admin') {
  const issue = {
    id: 'synthetic-issue-1',
    clientName: 'Synthetic Client',
    dueDate: '2026-08-10',
  };
  const notifies = [];
  const paints = [];
  let fetches = 0;
  let optimisticAtRequest = null;
  const context = {
    WORKLOAD_LINEAR_URL: 'https://example.invalid/functions/v1/workload-linear',
    WL_LINEAR_WRITE_TIMEOUT_MS: 12000,
    _wlPlanSessionGeneration: 0,
    _wlDueWriteInFlight: new Map(),
    wlState: {
      allActiveSubs: [issue],
      issueSnapshot: [issue],
      fetchedAt: 1,
      linearMetadataStatus: 'ready',
    },
    _syncviewStaffIdentityForHeaders: () => role ? { role } : null,
    _syncviewStaffRoleValue: identity => String(identity && identity.role || '').trim().toLowerCase(),
    _syncviewRequireStaffIdentity: async () => ({ key: 'synthetic' }),
    _syncviewEfHeaders: headers => headers,
    _syncviewStaffIdentityClear: () => {},
    wlPurgePlanSensitiveState: () => {},
    wlIsTweaksNeeded: () => false,
    wlApplyData: () => paints.push(issue.dueDate),
    renderWorkloadAll: () => paints.push(issue.dueDate),
    showNotify: (title, body) => notifies.push([title, body]),
    fetch: async () => {
      fetches++;
      optimisticAtRequest = issue.dueDate;
      if (reply instanceof Error) throw reply;
      return {
        ok: reply.httpOk !== false,
        status: reply.status || 200,
        json: async () => reply.body,
      };
    },
    document: { querySelector: () => ({}) },
    AbortController,
    setTimeout,
    clearTimeout,
    JSON, String, Number, Error, Promise, Map, Array, console,
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const name of [
    '_syncviewStaffCan',
    'wlLinearEditingEnabled',
    'wlApplyDueLocal',
    'wlValidRfc3339Timestamp',
    '_wlDueWriteRequest',
    'wlSetDueDate',
  ]) vm.runInContext(extract(name), context);
  return {
    context,
    issue,
    notifies,
    paints,
    get fetches() { return fetches; },
    get optimisticAtRequest() { return optimisticAtRequest; },
  };
}

async function run() {
  const happy = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await happy.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), true);
  assert.strictEqual(happy.optimisticAtRequest, '2026-08-12', 'new deadline is optimistic before the request');
  assert.strictEqual(happy.issue.dueDate, '2026-08-12');
  assert.deepStrictEqual(happy.notifies, []);

  const mismatch = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'different-issue',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await mismatch.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(mismatch.issue.dueDate, '2026-08-10', 'mismatched issue acknowledgement reverts');
  assert.match(mismatch.notifies[0][0], /Couldn't update/);

  const missingReceipt = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await missingReceipt.context.wlSetDueDate('synthetic-issue-1', null), false);
  assert.strictEqual(missingReceipt.issue.dueDate, '2026-08-10', 'missing null due-date receipt reverts');

  const trailingDate = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12garbage',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await trailingDate.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(trailingDate.issue.dueDate, '2026-08-10', 'non-exact returned date reverts');

  const inconsistentMirror = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 0,
    mirror_pending: false,
  } });
  assert.strictEqual(await inconsistentMirror.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(inconsistentMirror.issue.dueDate, '2026-08-10', 'inconsistent mirror receipt reverts');

  const missingUpdatedAt = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await missingUpdatedAt.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(missingUpdatedAt.issue.dueDate, '2026-08-10', 'missing update timestamp reverts');

  const malformedUpdatedAt = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: 'not-a-date',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await malformedUpdatedAt.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(malformedUpdatedAt.issue.dueDate, '2026-08-10', 'malformed update timestamp reverts');

  const rejected = harness({ httpOk: false, status: 409, body: { ok: false, error: 'issue_not_writable' } });
  assert.strictEqual(await rejected.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(rejected.issue.dueDate, '2026-08-10', 'pre-write rejection reverts');
  assert.match(rejected.notifies[0][1], /previous due date was restored/i);

  const shortMirror = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 0,
    mirror_pending: true,
  } });
  assert.strictEqual(await shortMirror.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), true);
  assert.strictEqual(shortMirror.issue.dueDate, '2026-08-12', 'confirmed Linear commit survives a short mirror update');
  assert.match(shortMirror.notifies[0][1], /Workload is catching up/);

  const network = harness(new Error('offline'));
  assert.strictEqual(await network.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(network.issue.dueDate, '2026-08-10', 'network failure restores the prior deadline');

  const creative = harness({ body: {} }, 'creative');
  assert.strictEqual(await creative.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(creative.fetches, 0, 'Creative cannot send a due-date write');
  assert.strictEqual(creative.issue.dueDate, '2026-08-10');
  assert.match(creative.notifies[0][0], /unavailable/);

  const refreshPayloads = [{ usedFallback: true }, { usedFallback: false }];
  const refreshContext = {
    document: { querySelector: () => ({}) },
    wlState: { error: null },
    wlSpinnerOn: () => {},
    wlSpinnerOff: () => {},
    wlLoadSnapshot: async () => refreshPayloads.shift(),
    renderWorkloadAll: () => {},
    console,
  };
  refreshContext.globalThis = refreshContext;
  vm.createContext(refreshContext);
  vm.runInContext(extract('wlRefetchSilent'), refreshContext);
  assert.strictEqual(await refreshContext.wlRefetchSilent(), false, 'snapshot fallback is not a fresh refresh');
  assert.strictEqual(await refreshContext.wlRefetchSilent(), true, 'a direct issue fetch is a fresh refresh');

  let watermarkRefreshes = 0;
  const refreshResults = [false, true];
  const watermarkContext = {
    _wlV2WatermarkBusy: false,
    wlState: {
      sourceSyncedAt: '2026-07-22T12:00:00.000Z',
      loading: false,
      refreshing: false,
      planStatus: 'ready',
    },
    document: { hidden: false, querySelector: () => ({}) },
    _wlV2FetchLatestWatermark: async () => '2026-07-22T12:01:00.000Z',
    wlRefetchSilent: async () => { watermarkRefreshes++; return refreshResults.shift(); },
    Date, console,
  };
  watermarkContext.globalThis = watermarkContext;
  vm.createContext(watermarkContext);
  vm.runInContext(extract('_wlV2CheckWatermark'), watermarkContext);
  await watermarkContext._wlV2CheckWatermark();
  assert.strictEqual(watermarkContext.wlState.sourceSyncedAt, '2026-07-22T12:00:00.000Z', 'failed refresh leaves watermark retryable');
  await watermarkContext._wlV2CheckWatermark();
  await watermarkContext._wlV2CheckWatermark();
  assert.strictEqual(watermarkRefreshes, 2, 'the watermark retries once after failure and does not repeat after success');
  assert.strictEqual(watermarkContext.wlState.sourceSyncedAt, '2026-07-22T12:01:00.000Z');

  console.log('Workload Linear browser fail-closed checks passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
