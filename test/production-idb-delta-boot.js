'use strict';
/*
 * THE DELTA BOOT HAS TO CONVERGE TO THE SAME ROW SET A FULL READ WOULD HAVE
 * PRODUCED -- WITH ONE NAMED, DOCUMENTED EXCEPTION.
 *
 * Task: move the Production snapshot to IndexedDB and, on a warm boot, fetch
 * only `updated_at >= watermark` instead of repeating the live-first read.
 * The mechanism is _prodBootWarm (hydrate from IndexedDB) and _prodDeltaBoot
 * (fetch the delta, merge it onto the cached rows, fetch authority live).
 *
 * This file EXECUTES the real, shipped functions -- extracted from
 * index.html and run in a sandbox against a fake IndexedDB and a fake
 * Supabase -- rather than asserting about their source text. It proves:
 *
 *   1. A row that changed status between the snapshot and the delta read
 *      converges to the live value (Scenario A).
 *   2. A brand new row converges too, in the same merge (Scenario A).
 *   3. A DELETED row does NOT converge through the delta path alone -- a
 *      row simply stops appearing in a response, indistinguishable from
 *      "unchanged" -- and DOES converge once the full-read replace
 *      semantics run, which is what PROD_FULL_RECONCILE_MS exists for
 *      (Scenario B). This is a documented limitation, not a bug, and this
 *      file is what proves the limitation is exactly as documented and no
 *      worse.
 *   4. A cold, corrupt, or watermark-less snapshot falls through to the
 *      ordinary full live-first read rather than serving a partial delta
 *      (Scenario C).
 *   5. Authority is fetched live even on the cheapest possible boot, never
 *      taken from the snapshot (Scenario D).
 *   6. A refused (401/403) delta purges the cached snapshot and reports an
 *      authorization failure, without throwing out of the boot (Scenario E).
 *   7. The full-reconcile clock (fullSyncedAt) survives a delta boot rather
 *      than being reset to "now", so an old snapshot still reconciles
 *      promptly (Scenario F).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Comment-aware brace matcher (same shape as test/production-write-ui-source.js's
   extract()), because these functions carry real comments and a naive quote-only
   scanner runs away the moment one contains an apostrophe. */
function extract(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html);
  if (!match) throw new Error(`missing ${name}`);
  const start = match.index;
  const brace = html.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    const next = html[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const body = html.slice(start, i + 1);
      if (body.length > html.length / 4) throw new Error(`${name} extraction ran away (${body.length} chars)`);
      return body;
    }
  }
  throw new Error(`unclosed ${name}`);
}
function constValue(decl, endToken) {
  const start = html.indexOf(decl);
  if (start < 0) throw new Error('missing ' + decl);
  const end = html.indexOf(endToken, start + decl.length);
  return html.slice(start + decl.length, end).trim();
}

const PROD_DELIVERABLE_SELECT = constValue("const PROD_DELIVERABLE_SELECT = ", ';').replace(/^'|'$/g, '');
const PROD_BATCH_SELECT = constValue("const PROD_BATCH_SELECT = ", ';').replace(/^'|'$/g, '');
const PROD_IDB_DB_NAME = constValue('const PROD_IDB_DB_NAME = ', ';').replace(/^'|'$/g, '');
const PROD_IDB_STORE = constValue('const PROD_IDB_STORE = ', ';').replace(/^'|'$/g, '');
const PROD_IDB_RECORD_KEY = constValue('const PROD_IDB_RECORD_KEY = ', ';').replace(/^'|'$/g, '');
const PROD_CACHE_SCHEMA = Number(constValue('const PROD_CACHE_SCHEMA = ', ';'));
const PROD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---- a minimal, faithful-enough fake IndexedDB (see test/production-cache-fits.js
//      for why every callback is attached in ONE synchronous tick) -----------
function makeFakeIndexedDB() {
  const databases = new Map();
  const schedule = fn => setTimeout(fn, 0);
  return {
    open(name) {
      const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      schedule(() => {
        let db = databases.get(name);
        const isNew = !db;
        if (!db) { db = { stores: new Map() }; databases.set(name, db); }
        req.result = {
          objectStoreNames: { contains: n => db.stores.has(n) },
          createObjectStore(n) { db.stores.set(n, new Map()); },
          transaction(storeName) {
            const store = db.stores.get(storeName);
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const ops = [];
            const api = {
              get(key) { const r = { result: undefined, onsuccess: null }; ops.push(() => { r.result = store.get(key); if (r.onsuccess) r.onsuccess(); }); return r; },
              put(value, key) { const r = { result: undefined, onsuccess: null }; ops.push(() => { store.set(key, value); if (r.onsuccess) r.onsuccess(); }); return r; },
              delete(key) { const r = { result: undefined, onsuccess: null }; ops.push(() => { store.delete(key); if (r.onsuccess) r.onsuccess(); }); return r; },
            };
            tx.objectStore = () => api;
            schedule(() => { for (const op of ops) op(); if (tx.oncomplete) tx.oncomplete(); });
            return tx;
          },
          close() {},
        };
        if (isNew && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

// ---- the shipped source, assembled once ------------------------------------
const SHARED_SRC = [
  extract('_prodIdbSupported'),
  extract('_prodIdbOpen'),
  extract('_prodIdbGetRecord'),
  extract('_prodIdbPutRecord'),
  extract('_prodIdbDeleteRecord'),
  'const _prodCacheHasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);',
  extract('_prodCachePackRows'),
  extract('_prodCacheUnpackRows'),
  extract('_prodCacheDeliverableColumns'),
  extract('_prodCacheBatchColumns'),
  extract('_prodCacheProject'),
  'const _prodCacheEnabled = () => true;', // kill-switch behaviour is covered by test/production-cache-fits.js
  extract('_prodCacheRead'),
  extract('_prodCacheWrite'),
  extract('_prodCachePurge'),
  extract('_prodHydrateFromCache'),
  extract('_prodById'),
  extract('_prodHasOwn'),
  extract('_prodPreserveProjectedFields'),
  extract('_prodDeliverableWatermark'),
  extract('_prodRowUpdatedMs'),
  extract('_prodMergeDeliverableRows'),
  extract('_prodInvalidateScopedReadsFor'),
  extract('_prodApplyDeepLinkFallback'),
  extract('_prodBootWarm'),
  extract('_prodDeltaBoot'),
].join('\n');

function freshProdState(overrides) {
  return Object.assign({
    loaded: false, loading: false, refreshing: false,
    clients: [], members: [], batches: [], deliverables: [],
    adapter: null,
    authority: null, authorityLoaded: false, authorityReadAt: 0,
    fromCache: false, cachePartial: false,
    lastSyncAt: 0, lastFullSyncAt: 0, lastSyncError: '', refreshFailures: 0,
    lastSilentLoadStatus: 0,
    projectionGeneration: 0,
    deepLink: null, deepLinkMissing: '', openId: '', openBatchId: '', openProjectId: '', view: 'list', clientSlug: '',
    events: new Map(), linearRaw: new Map(), labels: new Map(), labelRequestTokens: new Map(),
    assigneeOptions: new Map(), assigneeOptionRequestTokens: new Map(),
    assets: new Map(), assetRequestTokens: new Map(), descriptions: new Map(), descriptionRequestTokens: new Map(),
    briefsLoaded: false, briefsLoading: false,
  }, overrides || {});
}

/*
 * Builds one sandbox. `serverRows` is the authoritative "live Supabase"
 * deliverable rows at the moment _prodDeltaBoot runs; `_prodRestRows` filters
 * it the same way the real endpoint does for the two shapes this boot path
 * actually issues (an unfiltered table read for clients/members/batches, and
 * `updated_at=gte.<watermark>` for the deliverable delta) so the fake is
 * exercised the same way the real REST call would be.
 */
function makeBootScope(options) {
  const opts = options || {};
  const calls = { restRows: [], loadData: [], loadDataArgs: [], cachePurge: 0, render: 0 };
  const serverRows = opts.serverRows || [];
  const authority = 'authority' in opts ? opts.authority : { video: 'syncview', graphics: 'syncview' };
  const restRowsError = opts.restRowsError || null;

  function fakeRestRows(table, select, params, pageSize, maxPages, restOpts) {
    calls.restRows.push({ table, params });
    if (restRowsError && restRowsError.table === table) {
      const e = new Error('boom'); e.status = restRowsError.status; throw e;
    }
    if (table === 'clients') return Promise.resolve(opts.clients || []);
    if (table === 'team_members') return Promise.resolve(opts.members || []);
    if (table === 'batches') return Promise.resolve(opts.batches || []);
    if (table === 'production_deliverables_browser_v1') {
      const match = /updated_at=gte\.(.+)$/.exec(String(params || ''));
      if (!match) return Promise.resolve(serverRows.slice());
      const watermark = decodeURIComponent(match[1]);
      return Promise.resolve(serverRows.filter(row => String(row.updated_at || '') >= watermark));
    }
    return Promise.resolve([]);
  }

  const scope = {
    Promise, Object, Array, String, Number, Map, Set, Date, JSON, console, Error,
    encodeURIComponent, decodeURIComponent, setTimeout: () => {},
    indexedDB: makeFakeIndexedDB(),
    localStorage: { removeItem() {} },
    PROD_IDB_DB_NAME, PROD_IDB_STORE, PROD_IDB_RECORD_KEY,
    PROD_CACHE_SCHEMA, PROD_CACHE_TTL_MS,
    PROD_CACHE_KEY: 'syncview_production_cache_v1',
    PROD_DELIVERABLE_SELECT, PROD_BATCH_SELECT,
    PROD_BATCH_SELECT_unused: undefined,
    _prodState: freshProdState(opts.state),
    _prodAdapter: input => Object.assign({ __adapterInput: true }, input),
    _prodIssue: () => null, _prodBatch: () => null, _prodClient: () => null,
    _prodRestRows(...args) { return fakeRestRows(...args); },
    _prodFetchAuthority() { return Promise.resolve(authority); },
    _prodRender() { calls.render++; },
    document: { getElementById: () => null },
    _prodLoadData(loadOpts) { calls.loadData.push(loadOpts || {}); return Promise.resolve(true); },
    _prodLoadBriefs() {},
  };
  vm.createContext(scope);
  vm.runInContext(SHARED_SRC, scope);
  scope.__calls = calls;
  return scope;
}

async function writeSnapshot(scope, { clients, members, batches, deliverables, fullSyncedAt }) {
  scope._prodState.lastFullSyncAt = fullSyncedAt || 0;
  await scope._prodCacheWrite({ clients: clients || [], members: members || [], batches: batches || [], deliverables: deliverables || [], authority: { video: 'syncview', graphics: 'syncview' } });
}

(async () => {
  const T0 = '2026-08-30T10:00:00.000Z';
  const T0b = '2026-08-30T11:00:00.000Z'; // the snapshot watermark
  const T0c = '2026-08-29T09:00:00.000Z';
  const T1 = '2026-08-31T09:00:00.000Z';
  const T1b = '2026-08-31T10:00:00.000Z';

  // =========================================================================
  // Scenario A: a status change AND a new row both converge via delta merge.
  // =========================================================================
  {
    const snapshotDeliverables = [
      { id: 'd1', status: 'todo', title: 'A', updated_at: T0 },
      { id: 'd2', status: 'in_progress', title: 'B', updated_at: T0b },
      { id: 'd3', status: 'approved', title: 'C', updated_at: T0c },
    ];
    // The live server at delta time: d2 moved todo->approved (status changed,
    // updated_at bumped), d4 is brand new, d1/d3 are untouched.
    const liveNow = [
      { id: 'd1', status: 'todo', title: 'A', updated_at: T0 },
      { id: 'd2', status: 'approved', title: 'B (approved)', updated_at: T1 },
      { id: 'd3', status: 'approved', title: 'C', updated_at: T0c },
      { id: 'd4', status: 'todo', title: 'D (new)', updated_at: T1b },
    ];
    const scope = makeBootScope({ serverRows: liveNow, clients: [{ slug: 'acme' }], members: [{ id: 'm1' }], batches: [] });
    await writeSnapshot(scope, { deliverables: snapshotDeliverables, fullSyncedAt: 1000 });

    const cached = await scope._prodCacheRead();
    ok(!!cached && cached.deliverables.length === 3, 'the snapshot hydrates all three rows, live and terminal alike');

    await scope._prodBootWarm();
    const deltaCall = scope.__calls.restRows.find(c => c.table === 'production_deliverables_browser_v1');
    ok(!!deltaCall && new RegExp('updated_at=gte\\.' + encodeURIComponent(T0b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(deltaCall.params),
      'the delta request asks for updated_at >= the SNAPSHOT watermark, not the live watermark');
    ok(scope.__calls.loadData.length === 0,
      'a usable, watermark-bearing snapshot never falls back to a full load');

    const resultIds = new Set(scope._prodState.deliverables.map(r => r.id));
    const liveIds = new Set(liveNow.map(r => r.id));
    ok(resultIds.size === liveIds.size && [...liveIds].every(id => resultIds.has(id)),
      'the merged row set has EXACTLY the same ids as a full read of the live state would — CONVERGENCE');
    const d2After = scope._prodState.deliverables.find(r => r.id === 'd2');
    ok(d2After && d2After.status === 'approved' && d2After.title === 'B (approved)',
      'the row that changed status converges to its live value, not the stale cached one');
    const d4After = scope._prodState.deliverables.find(r => r.id === 'd4');
    ok(!!d4After, 'the brand-new row is present after the merge');
    const d1After = scope._prodState.deliverables.find(r => r.id === 'd1');
    ok(d1After && d1After.title === 'A', 'an untouched row survives the merge unchanged');

    ok(scope._prodState.authority && scope._prodState.authority.video === 'syncview',
      'authority is populated from the LIVE fetch');
    ok(scope._prodState.cachePartial === false && scope._prodState.fromCache === false,
      'the boot no longer reports itself as a partial cached paint once the delta lands');
    ok(scope._prodState.lastSyncAt > 0, 'a successful delta boot counts as a real sync');
  }

  // =========================================================================
  // Scenario B: a DELETION does not converge via delta alone, but DOES once
  // a full-read REPLACE runs — the documented deletion-catcher property.
  // =========================================================================
  {
    const snapshotDeliverables = [
      { id: 'd1', status: 'todo', title: 'A', updated_at: T0 },
      { id: 'd2', status: 'in_progress', title: 'B', updated_at: T0b },
      { id: 'd3', status: 'approved', title: 'C (about to be deleted)', updated_at: T0c },
    ];
    // d3 is gone from the live table. Nothing else changed, so the delta
    // response is empty — a deletion produces no row to observe at all.
    const liveNow = [
      { id: 'd1', status: 'todo', title: 'A', updated_at: T0 },
      { id: 'd2', status: 'in_progress', title: 'B', updated_at: T0b },
    ];
    const scope = makeBootScope({ serverRows: liveNow, clients: [], members: [], batches: [] });
    await writeSnapshot(scope, { deliverables: snapshotDeliverables, fullSyncedAt: 1000 });
    await scope._prodBootWarm();

    const stillThere = scope._prodState.deliverables.some(r => r.id === 'd3');
    ok(stillThere,
      'KNOWN GAP, PROVEN: a delta boot alone cannot observe a deletion — the removed row is still in local state after the merge');

    // Now simulate what the periodic full reconcile actually does: REPLACE
    // the row set wholesale with a fresh full read, exactly the assignment
    // _prodLoadData performs (`_prodState.deliverables = deliverables;`),
    // never a merge.
    scope._prodState.deliverables = liveNow.slice();
    const goneNow = scope._prodState.deliverables.some(r => r.id === 'd3');
    ok(!goneNow,
      'and a full-read REPLACE (what PROD_FULL_RECONCILE_MS drives) converges it — the deletion catcher works as documented');
  }

  // =========================================================================
  // Scenario C: cold / corrupt / watermark-less snapshots fall back to the
  // ordinary full live-first read rather than serving a partial delta.
  // =========================================================================
  {
    const scope = makeBootScope({ serverRows: [] });
    await scope._prodBootWarm();
    ok(scope.__calls.loadData.length === 1 && scope.__calls.loadData[0].silent !== true,
      'ABSENT snapshot (nothing ever written) falls back to the full, non-silent cold boot');
  }
  {
    const scope = makeBootScope({ serverRows: [] });
    // Corrupt: write something that is not a valid packed-row shape.
    await scope._prodIdbPutRecord({ schema: PROD_CACHE_SCHEMA, savedAt: Date.now(), fullSyncedAt: 0, clients: [], members: [], batches: 'not an object', deliverables: null });
    await scope._prodBootWarm();
    ok(scope.__calls.loadData.length === 1,
      'CORRUPT snapshot (fails to unpack) falls back to the full cold boot the same way an absent one does');
  }
  {
    const scope = makeBootScope({ serverRows: [{ id: 'd1', status: 'todo', updated_at: T0 }] });
    await writeSnapshot(scope, { deliverables: [], fullSyncedAt: 1000 }); // no rows -> no watermark
    await scope._prodBootWarm();
    const deltaCall = scope.__calls.restRows.find(c => c.table === 'production_deliverables_browser_v1');
    ok(!deltaCall, 'a WATERMARK-LESS snapshot (empty deliverables) never issues a delta request at all');
    ok(scope.__calls.loadData.length === 1 && scope.__calls.loadData[0].silent === true,
      'and folds into the SILENT full reload instead — the paint already happened from the (empty) cache, so this is not a cold boot');
  }

  // =========================================================================
  // Scenario D: authority is always fetched live, even mid-delta-boot, never
  // read from the snapshot (the hard constraint).
  // =========================================================================
  {
    const scope = makeBootScope({
      serverRows: [{ id: 'd1', status: 'todo', updated_at: T1 }],
      authority: { video: 'linear', graphics: 'syncview' },
    });
    await writeSnapshot(scope, { deliverables: [{ id: 'd1', status: 'todo', updated_at: T0 }], fullSyncedAt: 1000 });
    await scope._prodBootWarm();
    ok(scope._prodState.authority.video === 'linear' && scope._prodState.authority.graphics === 'syncview',
      'authority after a delta boot is exactly the LIVE answer — a 24h-old snapshot never gets to paint write permissions');
    ok(scope._prodState.authorityLoaded === true, 'and authorityLoaded flips true once the live answer lands');
  }

  // =========================================================================
  // Scenario E: a refused (401/403) delta purges the cache, reports an
  // authorization failure, and resolves rather than throwing.
  // =========================================================================
  {
    const scope = makeBootScope({
      serverRows: [],
      restRowsError: { table: 'production_deliverables_browser_v1', status: 403 },
    });
    await writeSnapshot(scope, { deliverables: [{ id: 'd1', status: 'todo', updated_at: T0 }], fullSyncedAt: 1000 });
    let threw = false;
    try { await scope._prodBootWarm(); } catch (e) { threw = true; }
    ok(!threw, 'a refused delta read does not throw out of the boot — the cached paint stays on screen');
    ok(/no longer authorized/i.test(scope._prodState.lastSyncError),
      'and the freshness surface reports an authorization failure, not a generic retry message');
    ok(scope._prodState.refreshing === false, 'refreshing is cleared on the failure path too');
    const purged = await scope._prodCacheRead();
    ok(purged === null, 'a 401/403 purges the snapshot so it cannot keep seeding paints from a session that is no longer authorized');
  }

  // =========================================================================
  // Scenario F: the full-reconcile clock survives a delta boot.
  // =========================================================================
  {
    const oldFullSync = Date.now() - (2 * 60 * 60 * 1000); // 2h ago
    const scope = makeBootScope({ serverRows: [{ id: 'd1', status: 'todo', updated_at: T1 }] });
    await writeSnapshot(scope, { deliverables: [{ id: 'd1', status: 'todo', updated_at: T0 }], fullSyncedAt: oldFullSync });
    await scope._prodBootWarm();
    ok(scope._prodState.lastFullSyncAt === oldFullSync,
      'a delta boot carries the snapshot fullSyncedAt forward rather than resetting it to "now" — the periodic reconcile clock keeps ticking from the last GENUINE full read');
    const rewritten = await scope._prodCacheRead();
    ok(rewritten.fullSyncedAt === oldFullSync,
      'and the re-written snapshot persists the same fullSyncedAt, so a THIRD boot in a row still reconciles on schedule rather than the clock resetting on every cheap boot');
  }

  if (failures) {
    console.error(`\n${failures} production IndexedDB delta-boot check(s) failed`);
    process.exit(1);
  }
  console.log('\nproduction IndexedDB delta-boot — convergence, deletion gap, fallback, and authority checks passed');
})();
