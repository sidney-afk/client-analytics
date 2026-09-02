'use strict';
/*
 * THE SNAPSHOT MOVED TO INDEXEDDB, WHICH IS WHY IT NO LONGER HAS TO DROP HALF
 * OF ITSELF TO FIT.
 *
 * This cache used to serialise into a localStorage string sharing a ~5MB
 * origin budget with the calendar and samples caches. Schema 1 could not fit
 * at all (5.44M characters) and its QuotaExceededError retry evicted every
 * neighbour trying to make room that no number of evictions could create.
 * Schemas 2 and 3 made it fit by DROPPING data instead: terminal deliverables
 * and batch descriptions were never written, which is also why a boot could
 * never delta against the snapshot -- a projection that never held the
 * terminal half of the estate has no watermark to reconcile that half from.
 *
 * IndexedDB stores structured-cloned JS values directly: no JSON.stringify,
 * no character budget, no neighbour to evict. Schema 4 therefore keeps every
 * row (live AND terminal) and every batch column (description included),
 * which is what lets a warm boot ask Supabase for a single `updated_at`
 * delta instead of repeating the live-first read (see
 * test/production-idb-delta-boot.js for that mechanism, executed).
 *
 * This file is what is left once the budget is gone: the codec that makes
 * key PRESENCE survive a round trip, the schema/column pinning that refuses
 * a snapshot written under a shape the running code no longer expects, and
 * the one rule that never changed regardless of storage engine -- authority
 * is never cached.
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
const hasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);

function fnSource(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const end = html.indexOf('\n        }', start);
  return end < 0 ? '' : html.slice(start, end + 10);
}
function constValue(decl, endToken) {
  const start = html.indexOf(decl);
  if (start < 0) return '';
  const end = html.indexOf(endToken, start + decl.length);
  return end < 0 ? '' : html.slice(start + decl.length, end).trim();
}
function selectColumns(decl) {
  const raw = constValue(decl, ';').replace(/^'|'$/g, '');
  return raw.split(',').map(name => name.trim()).filter(Boolean);
}

// ---- the shipped column lists, not restated ------------------------------
const DELIVERABLE_COLUMNS = selectColumns("const PROD_DELIVERABLE_SELECT = ");
const BATCH_COLUMNS_SHIPPED = selectColumns("const PROD_BATCH_SELECT = ");
ok(DELIVERABLE_COLUMNS.length >= 40,
  'the deliverable select is read from the shipped constant and is the FULL list ('
    + DELIVERABLE_COLUMNS.length + ' columns)');
ok(DELIVERABLE_COLUMNS.includes('identity_repair_state') && DELIVERABLE_COLUMNS.includes('raw_project_id'),
  'including the identity-repair and raw attribution columns, which _prodHasOwn probes for presence');
ok(BATCH_COLUMNS_SHIPPED.includes('description'),
  'and the batch select itself still asks for description -- unchanged, this was never the read that dropped it');

const schema = Number(constValue('const PROD_CACHE_SCHEMA = ', ';'));
ok(schema === 4, 'schema 4 -- IndexedDB-backed; a schema 1-3 entry was a localStorage string under a different key and cannot appear here');

// ---- the column lists the CACHE uses, EXECUTED — no drop any more --------
const columnFnSrc = [fnSource('_prodCacheDeliverableColumns'), fnSource('_prodCacheBatchColumns')].join('\n');
const columnScope = { PROD_DELIVERABLE_SELECT: constValue('const PROD_DELIVERABLE_SELECT = ', ';').replace(/^'|'$/g, ''), PROD_BATCH_SELECT: constValue('const PROD_BATCH_SELECT = ', ';').replace(/^'|'$/g, ''), String };
vm.createContext(columnScope);
vm.runInContext(columnFnSrc, columnScope);
ok(JSON.stringify(columnScope._prodCacheDeliverableColumns()) === JSON.stringify(DELIVERABLE_COLUMNS),
  'the cache deliverable columns are the FULL shipped select, executed');
ok(JSON.stringify(columnScope._prodCacheBatchColumns()) === JSON.stringify(BATCH_COLUMNS_SHIPPED)
  && columnScope._prodCacheBatchColumns().includes('description'),
  'and the cache batch columns are the FULL shipped select too -- description is no longer dropped, executed rather than asserted');

// ---- the shipped codec, EXECUTED (unchanged by the storage-engine move) --
const codecSrc = [
  'const _prodCacheHasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);',
  fnSource('_prodCachePackRows'),
  fnSource('_prodCacheUnpackRows'),
].join('\n');
ok(/function _prodCachePackRows/.test(codecSrc) && /function _prodCacheUnpackRows/.test(codecSrc),
  'both halves of the codec are findable (harness is not vacuous)');
const codec = { Map, Object, Array, String, Number, console };
vm.createContext(codec);
vm.runInContext(codecSrc, codec);

/* Three rows with three DIFFERENT key sets — the case a union-of-keys encoder
   gets wrong, and the one that decides whether a reader sees a real brief. */
const fullRow = Object.fromEntries(DELIVERABLE_COLUMNS.map(c => [c, c === 'id' ? 'row-a' : null]));
const missingRepair = Object.fromEntries(DELIVERABLE_COLUMNS
  .filter(c => c !== 'identity_repair_reason')
  .map(c => [c, c === 'id' ? 'row-b' : null]));
const sparse = { id: 'row-c', title: 'only two columns', runtime_added: 'kept' };
const shapes = [fullRow, missingRepair, sparse];
const packed = codec._prodCachePackRows(shapes, DELIVERABLE_COLUMNS);
const back = codec._prodCacheUnpackRows(packed);

ok(JSON.stringify(back) === JSON.stringify(shapes),
  'a round trip returns the rows byte-identical, key order included');
ok(!hasOwn(back[1], 'identity_repair_reason'),
  'an ABSENT key stays absent — this is the one that makes _prodHasOwn lie and paints "No description." over a real brief');
ok(hasOwn(back[0], 'identity_repair_reason') && back[0].identity_repair_reason === null,
  'and a key present with a null value stays present, which is the other half of the same distinction');
ok(back[2].runtime_added === 'kept',
  'a key outside the closed column list is carried through rather than dropped');
ok(packed.s.length === 3 && packed.c.length === DELIVERABLE_COLUMNS.length,
  'distinct key-shapes are stored once each and the column names exactly once');
for (const malformed of [null, {}, { c: ['id'], s: ['1'], x: [0], v: [] }, { c: ['id'], s: ['11'], x: [0], v: [[1]] }]) {
  if (codec._prodCacheUnpackRows(malformed) !== null) {
    failures++; console.error('FAIL  a malformed snapshot decoded instead of being refused: ' + JSON.stringify(malformed));
  }
}
ok(true, 'a malformed snapshot decodes to null rather than a partial list — half a snapshot painted as truth is worse than none');

// ---- the projection, EXECUTED: every row survives now, live and terminal -
const projectSrc = fnSource('_prodCacheProject');
ok(!!projectSrc, 'the projection is findable');
ok(!/authority:/.test(projectSrc),
  'AUTHORITY IS NOT CACHED — a stale snapshot must never decide whether write controls are live, least of all on a flip morning. This did not change when the storage engine did');
ok(!/_prodCacheIsTerminal|filter\(row => !/.test(projectSrc),
  'and the projection no longer filters terminal rows out — the IndexedDB write has no budget forcing that trade-off any more');
ok(!/description.*continue|desc.*continue/.test(projectSrc),
  'nor does it strip batch description any more');
{
  const projectScope = Object.assign({}, codec, columnScope);
  vm.createContext(projectScope);
  vm.runInContext([columnFnSrc, codecSrc, projectSrc].join('\n'), projectScope);
  const liveRow = { id: 'd-live', status: 'todo', updated_at: '2026-08-31T10:00:00Z' };
  const terminalRow = { id: 'd-done', status: 'archived', updated_at: '2026-08-20T00:00:00Z' };
  const batchWithDesc = { id: 'b-1', description: 'a real brief', client_slug: 'acme', team: 'video' };
  const projected = projectScope._prodCacheProject({
    clients: [{ slug: 'acme' }],
    members: [{ id: 'm-1' }],
    batches: [batchWithDesc],
    deliverables: [liveRow, terminalRow],
    authority: { video: 'syncview', graphics: 'syncview' },
  });
  const roundTrippedDeliverables = projectScope._prodCacheUnpackRows(projected.deliverables);
  const roundTrippedBatches = projectScope._prodCacheUnpackRows(projected.batches);
  ok(roundTrippedDeliverables.length === 2
    && roundTrippedDeliverables.some(r => r.id === 'd-live')
    && roundTrippedDeliverables.some(r => r.id === 'd-done'),
    'BOTH the live row and the terminal (archived) row survive the projection — executed, not asserted from the source shape');
  ok(roundTrippedBatches.length === 1 && roundTrippedBatches[0].description === 'a real brief',
    'and the batch keeps its description');
  ok(!('authority' in projected),
    'and the projected object itself carries no authority key even though the input data did — executed, not just grepped for the word');
}

// ---- IndexedDB wrapper, EXECUTED against a minimal fake indexedDB --------
/*
 * Node has no IndexedDB, so this fakes just enough of the real event-based
 * API (open -> onupgradeneeded/onsuccess, transaction -> objectStore ->
 * get/put/delete -> oncomplete) for the four wrapper functions to run
 * unmodified against it. Every callback is scheduled with setTimeout(0) —
 * a real IDBRequest never resolves synchronously either, and code that
 * accidentally relied on that would pass against a synchronous fake and
 * fail in every browser.
 */
function makeFakeIndexedDB(opts) {
  opts = opts || {};
  const databases = new Map();
  function schedule(fn) { setTimeout(fn, 0); }
  return {
    open(name) {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      schedule(() => {
        if (opts.openError) { req.error = opts.openError; if (req.onerror) req.onerror({ target: req }); return; }
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
              get(key) {
                const r = { result: undefined, onsuccess: null, onerror: null };
                ops.push(() => { r.result = store.get(key); if (r.onsuccess) r.onsuccess({ target: r }); });
                return r;
              },
              put(value, key) {
                const r = { result: undefined, onsuccess: null, onerror: null };
                ops.push(() => {
                  if (opts.putError) { r.error = opts.putError; if (r.onerror) r.onerror({ target: r }); return; }
                  store.set(key, value); r.result = key; if (r.onsuccess) r.onsuccess({ target: r });
                });
                return r;
              },
              delete(key) {
                const r = { result: undefined, onsuccess: null, onerror: null };
                ops.push(() => { store.delete(key); if (r.onsuccess) r.onsuccess({ target: r }); });
                return r;
              },
            };
            tx.objectStore = () => api;
            schedule(() => {
              for (const op of ops) op();
              if (tx.oncomplete) tx.oncomplete();
            });
            return tx;
          },
          close() {},
        };
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}
const idbSrc = [
  fnSource('_prodIdbSupported'),
  fnSource('_prodIdbOpen'),
  'async ' + fnSource('_prodIdbGetRecord'),
  'async ' + fnSource('_prodIdbPutRecord'),
  'async ' + fnSource('_prodIdbDeleteRecord'),
].join('\n');
ok(idbSrc.split('\n').every(line => line.length > 0 || true) && /_prodIdbOpen/.test(idbSrc),
  'the IndexedDB wrapper functions are findable (harness is not vacuous)');
const PROD_IDB_DB_NAME = constValue('const PROD_IDB_DB_NAME = ', ';').replace(/^'|'$/g, '');
const PROD_IDB_STORE = constValue('const PROD_IDB_STORE = ', ';').replace(/^'|'$/g, '');
const PROD_IDB_RECORD_KEY = constValue('const PROD_IDB_RECORD_KEY = ', ';').replace(/^'|'$/g, '');
ok(!!PROD_IDB_DB_NAME && !!PROD_IDB_STORE && !!PROD_IDB_RECORD_KEY, 'the IndexedDB naming constants exist');

async function runIdbCase(indexedDBImpl) {
  const scope = {
    Promise, Error, console,
    PROD_IDB_DB_NAME, PROD_IDB_STORE, PROD_IDB_RECORD_KEY,
    indexedDB: indexedDBImpl,
  };
  vm.createContext(scope);
  vm.runInContext(idbSrc, scope);
  return scope;
}

(async () => {
  // 1. put -> get round trip, real async event flow.
  {
    const scope = await runIdbCase(makeFakeIndexedDB());
    const wrote = await scope._prodIdbPutRecord({ hello: 'world' });
    ok(wrote === true, 'a put against a fresh IndexedDB resolves true');
    const read = await scope._prodIdbGetRecord();
    ok(read && read.hello === 'world', 'and a get immediately after reads the same value back — executed round trip, not a mock');
  }
  // 2. get on an empty store -> null, not undefined and not a throw.
  {
    const scope = await runIdbCase(makeFakeIndexedDB());
    const read = await scope._prodIdbGetRecord();
    ok(read === null, 'a get with nothing ever written resolves null rather than undefined');
  }
  // 3. delete actually removes the record.
  {
    const scope = await runIdbCase(makeFakeIndexedDB());
    await scope._prodIdbPutRecord({ x: 1 });
    await scope._prodIdbDeleteRecord();
    const read = await scope._prodIdbGetRecord();
    ok(read === null, 'a delete removes the record — the next get sees nothing');
  }
  // 4. a broken IndexedDB (open throws / errors) rejects rather than hanging.
  {
    const scope = await runIdbCase(makeFakeIndexedDB({ openError: new Error('boom') }));
    let threw = false;
    try { await scope._prodIdbGetRecord(); } catch (e) { threw = true; }
    ok(threw, 'a broken IndexedDB open rejects the get — the caller (_prodCacheRead) is what turns this into a plain cache miss');
  }

  // ---- _prodCacheRead / _prodCacheWrite, EXECUTED against the fake IDB ---
  const readWriteSrc = [
    'const localStorage = { removeItem() {}, getItem() { return null; }, setItem() {} };',
    idbSrc,
    fnSource('_prodCacheHasOwn') || 'const _prodCacheHasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);',
    fnSource('_prodCachePackRows'),
    fnSource('_prodCacheUnpackRows'),
    columnFnSrc,
    projectSrc,
    'async ' + fnSource('_prodCacheRead'),
    'async ' + fnSource('_prodCacheWrite'),
  ].join('\n');
  function makeReadWriteScope(indexedDBImpl, overrides) {
    const scope = Object.assign({
      Promise, Error, console, Object, Array, String, Number, Map, Date, JSON,
      PROD_IDB_DB_NAME, PROD_IDB_STORE, PROD_IDB_RECORD_KEY,
      PROD_DELIVERABLE_SELECT: columnScope.PROD_DELIVERABLE_SELECT,
      PROD_BATCH_SELECT: columnScope.PROD_BATCH_SELECT,
      PROD_CACHE_SCHEMA: schema,
      PROD_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
      PROD_CACHE_KEY: 'syncview_production_cache_v1',
      indexedDB: indexedDBImpl,
      _prodCacheEnabled: () => true,
      _prodState: { lastFullSyncAt: 0 },
    }, overrides || {});
    vm.createContext(scope);
    vm.runInContext(readWriteSrc, scope);
    return scope;
  }

  {
    const scope = makeReadWriteScope(makeFakeIndexedDB());
    scope._prodState.lastFullSyncAt = 12345;
    const wrote = await scope._prodCacheWrite({
      clients: [{ slug: 'acme' }],
      members: [{ id: 'm1' }],
      batches: [{ id: 'b1', description: 'brief', client_slug: 'acme', team: 'video' }],
      deliverables: [{ id: 'd1', status: 'todo', updated_at: '2026-08-31T00:00:00Z' }, { id: 'd2', status: 'archived', updated_at: '2026-08-01T00:00:00Z' }],
      authority: { video: 'syncview', graphics: 'syncview' },
    });
    ok(wrote === true, 'a write against a working IndexedDB resolves true');
    const read = await scope._prodCacheRead();
    ok(!!read, 'and reads back non-null');
    ok(read.deliverables.length === 2, 'BOTH rows (live and terminal) round-trip through the full read/write cycle — executed end to end');
    ok(read.batches[0].description === 'brief', 'the batch description round-trips too');
    ok(read.fullSyncedAt === 12345, 'fullSyncedAt is carried through the write/read cycle from _prodState.lastFullSyncAt at write time');
    ok(!('authority' in read), 'authority never comes back from a read — it was never written');
  }
  {
    // Wrong schema: simulate by writing a raw record then rewriting schema.
    const idb = makeFakeIndexedDB();
    const scope = makeReadWriteScope(idb);
    await scope._prodIdbPutRecord({ schema: 1, savedAt: Date.now(), clients: [], members: [], batches: { c: [], s: [], x: [], v: [], e: [] }, deliverables: { c: [], s: [], x: [], v: [], e: [] } });
    const read = await scope._prodCacheRead();
    ok(read === null, 'a schema-1 (pre-IndexedDB) record is discarded rather than decoded');
  }
  {
    // Wrong column shape: a snapshot written under an older/different select.
    const scope = makeReadWriteScope(makeFakeIndexedDB());
    await scope._prodIdbPutRecord({
      schema, savedAt: Date.now(), fullSyncedAt: 0,
      clients: [], members: [],
      batches: { c: ['id'], s: ['1'], x: [], v: [[]], e: [] },
      deliverables: { c: ['id'], s: ['1'], x: [], v: [[]], e: [] },
    });
    const read = await scope._prodCacheRead();
    ok(read === null, 'a snapshot whose column list no longer matches PROD_DELIVERABLE_SELECT/PROD_BATCH_SELECT is discarded — "absent" is a real answer to _prodHasOwn and a stale shape would forge one');
  }
  {
    // Expired TTL.
    const scope = makeReadWriteScope(makeFakeIndexedDB());
    scope._prodState.lastFullSyncAt = 1;
    await scope._prodCacheWrite({ clients: [], members: [], batches: [], deliverables: [] });
    const stored = await scope._prodIdbGetRecord();
    stored.savedAt = Date.now() - (25 * 60 * 60 * 1000);
    await scope._prodIdbPutRecord(stored);
    const read = await scope._prodCacheRead();
    ok(read === null, 'a snapshot older than PROD_CACHE_TTL_MS (24h) is treated as a miss');
  }
  {
    // Absent: nothing ever written.
    const scope = makeReadWriteScope(makeFakeIndexedDB());
    const read = await scope._prodCacheRead();
    ok(read === null, 'no snapshot at all reads as a plain miss, not an error');
  }
  {
    // Corrupt: a record that is not an object shape _prodCacheUnpackRows can parse.
    const scope = makeReadWriteScope(makeFakeIndexedDB());
    await scope._prodIdbPutRecord({ schema, savedAt: Date.now(), fullSyncedAt: 0, clients: [], members: [], batches: 'not an object', deliverables: null });
    const read = await scope._prodCacheRead();
    ok(read === null, 'a corrupt/malformed record decodes to a miss rather than throwing or painting a partial list');
  }
  {
    // Kill switch: _prodCacheEnabled() false disables both read and write.
    const scope = makeReadWriteScope(makeFakeIndexedDB(), { _prodCacheEnabled: () => false });
    const wrote = await scope._prodCacheWrite({ clients: [], members: [], batches: [], deliverables: [] });
    ok(wrote === false, 'the kill switch (?prodcache=0) disables the write');
    const read = await scope._prodCacheRead();
    ok(read === null, 'and disables the read, without ever touching IndexedDB');
  }
  {
    // A broken IndexedDB degrades both to a plain miss/false, never a throw.
    const scope = makeReadWriteScope(makeFakeIndexedDB({ openError: new Error('boom') }));
    let readThrew = false, writeThrew = false;
    let read = 'unset', wrote = 'unset';
    try { read = await scope._prodCacheRead(); } catch (e) { readThrew = true; }
    try { wrote = await scope._prodCacheWrite({ clients: [], members: [], batches: [], deliverables: [] }); } catch (e) { writeThrew = true; }
    ok(!readThrew && read === null, 'a read against a broken IndexedDB resolves null rather than throwing — degrades to exactly the no-cache behaviour');
    ok(!writeThrew && wrote === false, 'and a write against a broken IndexedDB resolves false rather than throwing');
  }

  // ---- _prodCachePurge, EXECUTED ------------------------------------------
  {
    const purgeSrc = [idbSrc, fnSource('_prodCachePurge')].join('\n');
    const removed = [];
    const scope = {
      Promise, Error, console,
      PROD_IDB_DB_NAME, PROD_IDB_STORE, PROD_IDB_RECORD_KEY,
      indexedDB: makeFakeIndexedDB(),
      localStorage: { removeItem(k) { removed.push(k); } },
      _prodState: { fromCache: true },
      PROD_CACHE_KEY: 'syncview_production_cache_v1',
    };
    vm.createContext(scope);
    vm.runInContext(purgeSrc, scope);
    await scope._prodIdbPutRecord({ marker: true });
    await scope._prodCachePurge();
    const gone = await scope._prodIdbGetRecord();
    ok(gone === null, '_prodCachePurge deletes the IndexedDB record');
    ok(removed.includes('syncview_production_cache_v1'),
      'and cleans up the legacy localStorage key so a pre-migration entry does not sit dead in the origin');
    ok(scope._prodState.fromCache === false, 'and clears fromCache on the live state');
  }
  {
    // Purge must never throw even against a broken IndexedDB — every caller
    // (sign-out, a 401/403) calls it fire-and-forget.
    const purgeSrc = [idbSrc, fnSource('_prodCachePurge')].join('\n');
    const scope = {
      Promise, Error, console,
      PROD_IDB_DB_NAME, PROD_IDB_STORE, PROD_IDB_RECORD_KEY,
      indexedDB: makeFakeIndexedDB({ openError: new Error('boom') }),
      localStorage: { removeItem() {} },
      _prodState: { fromCache: true },
      PROD_CACHE_KEY: 'syncview_production_cache_v1',
    };
    vm.createContext(scope);
    vm.runInContext(purgeSrc, scope);
    let threw = false;
    try { await scope._prodCachePurge(); } catch (e) { threw = true; }
    ok(!threw, '_prodCachePurge against a broken IndexedDB still resolves rather than rejecting — every caller fires it without awaiting or catching');
  }

  // ---- the wiring: no code path reads/writes the snapshot through
  //      localStorage any more; only the one-time legacy-key cleanup does --
  const readSrc = fnSource('_prodCacheRead');
  const writeSrc = fnSource('_prodCacheWrite');
  ok(!/localStorage\.(get|set)Item\(PROD_CACHE_KEY/.test(readSrc + writeSrc),
    'neither the read nor the write path touches localStorage for the snapshot data any more — only IndexedDB');
  ok(/localStorage\.removeItem\(PROD_CACHE_KEY\)/.test(readSrc),
    'the read path opportunistically clears the legacy key once, so a pre-migration snapshot does not linger forever');

  // ---- _prodHydrateFromCache takes an already-resolved snapshot -----------
  const hydrateSrc = fnSource('_prodHydrateFromCache');
  ok(/function _prodHydrateFromCache\(cached\)/.test(html),
    'hydrate takes the resolved snapshot as a parameter rather than reading IndexedDB itself — the read (async I/O) and the hydrate (sync state) are independently testable');
  ok(!/_prodCacheRead\(\)/.test(hydrateSrc),
    'and does not call the (now async) read internally, which would make it impossible to keep this function synchronous');
  ok(/_prodState\.fromCache = true;\s*\n\s*_prodState\.cachePartial = true;/.test(html),
    'the cached paint still marks itself partial, which is what the background-revalidation wait in prod-test-utils.js keys off');
  ok(/_prodState\.lastFullSyncAt = Number\(cached\.fullSyncedAt\) \|\| 0;/.test(hydrateSrc),
    'and it restores the full-reconcile clock from the snapshot immediately, so PROD_FULL_RECONCILE_MS stays correct even if the delta boot that follows never completes');

  if (failures) {
    console.error(`\n${failures} production cache check(s) failed`);
    process.exit(1);
  }
  console.log('\nproduction cache (IndexedDB) — full row set, codec, and authority-exclusion checks passed');
})();
