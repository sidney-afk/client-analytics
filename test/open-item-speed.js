'use strict';
/*
 * Opening an item (a Calendar card, a batch, a sub-issue) from anywhere feels
 * instant. Every case below FAILS on the code before this change.
 *
 * Measured live 2026-10-01 as staff on the test client (docs/audits/2026-10-01-open-item-speed.md):
 *   - a link that opens in a new tab went through a 404 and a redirect before
 *     the app even started (about 0.2 to 0.3 s on every open);
 *   - a link at a FINISHED batch showed its title only after the whole
 *     finished-items read (about 5 s) and filled in at about 10 s;
 *   - a link at a finished card waited on the live read even with a saved list;
 *   - a click on a row started its reads only at the click.
 * Plus the two owner-approved cache changes: a 7 day saved list, and finished
 * rows kept in the IndexedDB copy so a boot reads only what changed (the hourly
 * full pass is kept so a hard delete still converges).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { routeTable } = require('../scripts/build-route-stubs.js');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };
const eq = (a, b, m) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(a === undefined ? null : a)), JSON.parse(JSON.stringify(b)), m + ' (got ' + JSON.stringify(a) + ')'); passed++; console.log('  ok  ' + m); };

function grab(name, kind) {
  const re = new RegExp((kind || '') + '\\s*function\\s+' + name + '\\s*\\(');
  const at = INDEX.search(re);
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0, quote = '', esc = false, lc = false, bc = false;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], n = INDEX[j + 1];
    if (lc) { if (c === '\n') lc = false; continue; }
    if (bc) { if (c === '*' && n === '/') { bc = false; j++; } continue; }
    if (!quote && c === '/' && n === '/') { lc = true; j++; continue; }
    if (!quote && c === '/' && n === '*') { bc = true; j++; continue; }
    if (quote) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

// ---- 1. links that open in a new tab skip the 404 hop -----------------------
const route = routeTable();
ok(typeof route.fast === 'function', 'the router offers a direct form for new-tab links');
eq(route.fast('/?prod=1&d=del_1'), '/?prod=1&d=del_1#production', 'a sub-issue link is the app document itself');
eq(route.fast('/?prod=1&batch=bat_1'), '/?prod=1&batch=bat_1#production', 'a batch link is the app document itself');
eq(route.fast('/#calendar/some-client/p_1'), '/#calendar/some-client/p_1', 'a calendar card link is the app document itself');
eq(route.fast('/#calendar/some-client'), '/#calendar/some-client', 'a calendar client link is the app document itself');
eq(route.fast('/?prod=1&d=a%2Fb'), '/?prod=1&d=a%2Fb#production', 'an id with a slash stays encoded');
eq(route.clean('/?prod=1&d=del_1'), '/synclinear/del_1', 'the clean address the app shows afterwards is unchanged');
// The app rewrites the direct form to its clean address once it loads.
const back = route.toClean('?prod=1&d=del_1', '#production');
eq(back, '/synclinear/del_1', 'the direct form lands on the same clean address');
const builders = [
  /svRoute\.fast\('\/\?prod=1&batch='/g, /svRoute\.fast\('\/\?prod=1&d='/g,
];
ok(builders.every(re => (INDEX.match(re) || []).length >= 3), 'Workload, Calendar, Samples and Today build their open links with the direct form');
ok(!/svRoute\.clean\('\/\?prod=1&/.test(INDEX), 'no new-tab production link still goes through the 404 hop');
ok(/window\.open\(svRoute\.fast\('\/synclinear\/'/.test(INDEX), "Today's open-in-SyncLinear button uses it too");
ok((INDEX.match(/const calUrl = svRoute\.fast\(`\/#calendar/g) || []).length === 4, 'the Kasper "open this card" links use it');

// ---- 2. a link at a finished batch paints from its own reads -----------------
async function batchHarness(opts) {
  const o = opts || {};
  const log = { batchReads: [], projReads: [], renders: 0, queries: [] };
  const sb = {
    String, Number, Array, Set, Promise, Object, Date, encodeURIComponent, console,
    document: { getElementById: () => ({}) },
    PROD_BATCH_SELECT: 'id,name,linear_parent_ids',
    _prodState: {
      loaded: false, loading: true, cachePartial: false, clients: [], members: [], batches: [], deliverables: [],
      adapter: null, projectionGeneration: 0, deepLink: { kind: 'batch', id: 'bat_1' },
      openBatchId: 'bat_1', openId: '', view: 'batch'
    },
    _prodAdapter: input => ({ ROWS: input.deliverables.slice(), BATCHES: input.batches.slice() }),
    _prodRender() { log.renders++; },
    _prodPreserveProjectedFields: incoming => incoming,
    _prodSetQuery(q) { log.queries.push(q); },
    _prodIssue(id) { return sb._prodState.deliverables.find(r => r.id === id || r.identifier === id) || null; },
    _prodBatch(id) { return sb._prodState.batches.find(b => b.id === id) || null; },
    _prodBatchRows(id) { return sb._prodState.deliverables.filter(r => r.batch_id === id); },
    _prodBatchParentIssue(batch) {
      const lp = batch && batch.linear_parent_ids || {};
      const ids = Object.values(lp).map(v => String(v.identifier || v));
      const hit = sb._prodState.deliverables.filter(r => ids.includes(r.identifier) && r.isHierarchyParent !== false);
      return hit.length === 1 ? Object.assign({ displayId: hit[0].identifier }, hit[0]) : null;
    },
    _prodRestRows(table, select, params) {
      log.batchReads.push(params);
      return Promise.resolve(/id=eq\.bat_1/.test(params)
        ? [{ id: 'bat_1', name: 'Batch 1', linear_parent_ids: { video: { identifier: 'VID-9' } } }] : []);
    },
    _prodLoadDeliverableProjection(params) {
      log.projReads.push(params);
      if (/^batch_id=eq\./.test(params)) return Promise.resolve([{ id: 'd_child', identifier: 'VID-10', batch_id: 'bat_1', status: 'approved' }]);
      if (/^or=\(/.test(params)) return Promise.resolve([{ id: 'd_parent', identifier: 'VID-9', status: 'posted' }]);
      return Promise.resolve([]);
    }
  };
  vm.createContext(sb);
  vm.runInContext('let _prodDeepLinkFastRows = null;\n' + grab('_prodDeepLinkRowQuery') + '\n' + grab('_prodDeepLinkFastPaint', 'async') + '\nthis.run = _prodDeepLinkFastPaint;', sb);
  const reads = { clients: Promise.resolve([{ slug: 'c' }]), members: Promise.resolve([{ id: 'm' }]) };
  const painted = await sb.run(reads);
  await flush();
  return { sb, log, painted };
}
(async () => {
  const b = await batchHarness();
  ok(b.painted === true, 'a link at a batch the saved list cannot place paints from its own reads');
  ok(b.log.batchReads.some(p => /id=eq\.bat_1/.test(p)), 'it reads the batch row by id');
  ok(b.log.projReads.some(p => p === 'batch_id=eq.bat_1'), 'it reads the batch children in one query');
  ok(b.log.projReads.some(p => /^or=\(.*VID-9/.test(p)), 'it reads the named parent card beside them');
  ok(b.sb._prodState.loaded === true && b.sb._prodState.loading === false, 'the pane stops showing the skeleton');
  eq(b.sb._prodState.openId, 'VID-9', 'and lands on the parent card, the way the authoritative pass would');
  eq(b.sb._prodState.view, 'detail', 'in the detail view');
  eq(b.sb._prodState.deepLink, { kind: 'batch', id: 'bat_1' }, 'the link itself is still pending for the authoritative pass');
  const held = await (async () => {
    const h = await batchHarness();
    return h;
  })();
  ok(held.log.renders >= 1, 'it repaints once');

  // ---- 3. the saved copies --------------------------------------------------
  ok(/const PROD_CACHE_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000;/.test(INDEX), 'the saved list is kept for 7 days');
  const COLS = 'id,identifier,status,updated_at,title';
  const store = new Map();
  const cs = {
    Date, Array, Object, Number, Set, Promise, String, JSON,
    PROD_DELIVERABLE_SELECT: COLS,
    PROD_CACHE_TTL_MS: 7 * 86400000,
    PROD_CACHE_TERMINAL: ['approved', 'posted', 'archived', 'canceled', 'cancelled', 'duplicate'],
    _prodCacheEnabled: () => true,
    _prodIdbRequest: (mode, run) => Promise.resolve(run({
      put: (v, k) => { store.set(k, JSON.parse(JSON.stringify(v))); }, get: k => ({ result: store.get(k) }).result, delete: k => store.delete(k)
    }))
  };
  vm.createContext(cs);
  vm.runInContext([
    'const _prodCacheHasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);',
    grab('_prodCacheDeliverableColumns'), grab('_prodCachePackRows'), grab('_prodCacheUnpackRows'), grab('_prodCacheIsTerminal'),
    'const PROD_TERMINAL_COPY_SCHEMA = 1; const PROD_IDB_TERMINAL_KEY = "k"; let _prodTerminalCopySeq = 0;',
    grab('_prodTerminalCopyWrite'), grab('_prodTerminalCopyDelete'), grab('_prodTerminalCopyValidate'), grab('_prodTerminalCopyRead'),
    'this.api = { write: _prodTerminalCopyWrite, read: _prodTerminalCopyRead, del: _prodTerminalCopyDelete, validate: _prodTerminalCopyValidate };'
  ].join('\n'), cs);
  const rows = [
    { id: 'a', identifier: 'A-1', status: 'approved', updated_at: '2026-09-01T00:00:00Z', title: 'x' },
    { id: 'b', identifier: 'A-2', status: 'in_progress', updated_at: '2026-09-02T00:00:00Z', title: 'y' },
    { id: 'c', identifier: 'A-3', status: 'posted', updated_at: '2026-09-03T00:00:00Z', title: 'z' }
  ];
  const fullAt = Date.now() - 1000;
  ok(await cs.api.write(rows, fullAt), 'finished rows are written to the saved copy');
  const back2 = await cs.api.read();
  eq(back2 && back2.rows.map(r => r.id), ['a', 'c'], 'only the finished rows are kept, and they come back whole');
  eq(back2 && back2.fullAt, fullAt, 'with the time of the last full pass');
  const rec = store.get('k');
  rec.savedAt = Date.now() - 8 * 86400000; store.set('k', rec);
  eq(await cs.api.read(), null, 'a copy older than 7 days is refused');
  rec.savedAt = Date.now(); rec.deliverables.c = ['id']; store.set('k', rec);
  eq(await cs.api.read(), null, 'a copy written for another column list is refused');
  rec.deliverables.c = COLS.split(','); rec.fullAt = 0; store.set('k', rec);
  eq(await cs.api.read(), null, 'a copy with no full-pass time is refused');
  await cs.api.del();
  eq(store.has('k'), false, 'sign-out purge removes it');
  ok(grab('_prodCachePurge').includes('_prodTerminalCopyDelete()'), 'the purge that runs on sign-out removes it too');

  // ---- 4. when a boot may read finished rows incrementally -------------------
  const now = Date.now();
  const ts = { Date, Number, PROD_TERMINAL_FULL_MS: 3600000, _prodState: {}, _prodCacheIsTerminal: r => r.status === 'approved' };
  ts._prodState = { terminalTailLoadedAt: 0, terminalTailFullAt: 0, terminalCopyBoot: false, loaded: false, fromCache: false, projectionGeneration: 1, deliverables: [], clients: [], members: [], batches: [] };
  ts._prodAdapter = x => x; ts._prodApplyDeepLinkFallback = () => {}; ts.document = { getElementById: () => null };
  vm.createContext(ts);
  vm.runInContext(grab('_prodTerminalTailFullDue') + '\n' + grab('_prodAdoptTerminalCopy') + '\nthis.due = _prodTerminalTailFullDue; this.adopt = _prodAdoptTerminalCopy;', ts);
  eq(ts.due(false), true, 'no saved copy: a boot reads the full finished list, as before');
  eq(ts.adopt({ rows: [{ id: 'a', status: 'approved' }], fullAt: now - 10 * 60000, savedAt: now }, 1), true, 'a fresh saved copy is taken before the live swap');
  eq(ts._prodState.deliverables.length, 1, 'its rows join the held set');
  eq(ts.due(false), false, 'a boot with a copy from under an hour ago reads only what changed');
  ts._prodState.terminalCopyBoot = false;
  eq(ts.due(false), true, 'but the next hand-pressed refresh is a full read again');
  ts._prodState.terminalCopyBoot = true; ts._prodState.terminalTailFullAt = now - 61 * 60000;
  eq(ts.due(false), true, 'a copy whose last full pass is over an hour old gets the full pass (deletions are still caught)');
  ts._prodState.terminalTailLoadedAt = now; ts._prodState.terminalTailFullAt = now - 61 * 60000; ts._prodState.terminalCopyBoot = false;
  eq(ts.due(true), true, 'the hourly full pass of a running tab is unchanged');
  ts._prodState.terminalTailFullAt = now - 5 * 60000;
  eq(ts.due(true), false, 'and a quiet poll inside the hour is incremental, as before');
  ts._prodState.deliverables = []; ts._prodState.terminalTailLoadedAt = 0; ts._prodState.terminalCopyBoot = false;
  eq(ts.adopt({ rows: [{ id: 'a' }], fullAt: now, savedAt: now }, 0), false, 'a copy for an older load generation is not taken');
  ts._prodState.loaded = true; ts._prodState.fromCache = false;
  eq(ts.adopt({ rows: [{ id: 'a' }], fullAt: now, savedAt: now }, 1), false, 'a copy that lands after the live swap is not taken');

  // ---- 5. a row's reads start on hover or press -----------------------------
  const calls = [];
  const ps = {
    String, document: { hidden: false },
    _prodEnabled: () => true,
    _prodState: { loaded: true, refreshing: false, view: 'list', openId: '' },
    _prodIssue: id => (id === 'row1' ? { id: 'row1' } : null),
    _prodOpenRowId: () => '',
    _prodBatchAssetSource: () => ({ id: 'batch-src' }),
    _prodComments: { ensure: id => calls.push('comments:' + id) },
    _prodEnsureLabels: id => calls.push('labels:' + id),
    _prodEnsureDescription: id => calls.push('description:' + id),
    _prodEnsureAssets: id => calls.push('assets:' + id)
  };
  vm.createContext(ps);
  vm.runInContext(grab('_prodPrefetchOpen') + '\nthis.p = _prodPrefetchOpen;', ps);
  ps.p('row1');
  eq(calls, ['comments:row1', 'labels:row1', 'description:row1', 'assets:row1', 'assets:batch-src'], 'hovering a row asks for the same reads the click would');
  calls.length = 0; ps.p('missing'); eq(calls, [], 'a row the page does not hold asks for nothing');
  ps._prodState.refreshing = true; ps.p('row1'); eq(calls, [], 'nothing starts while a refresh is swapping the list');
  ps._prodState.refreshing = false; ps._prodState.view = 'detail'; ps._prodOpenRowId = () => 'row1'; ps.p('row1'); eq(calls, [], 'the row already open asks for nothing more');
  ps._prodOpenRowId = () => ''; ps._prodState.view = 'list'; ps.document.hidden = true; ps.p('row1'); eq(calls, [], 'a hidden tab asks for nothing');
  ok(/document\.addEventListener\('pointerover'/.test(INDEX) && /setTimeout\(\(\) => \{ try \{ _prodPrefetchOpen\(id\)/.test(INDEX), 'hover waits 120 ms before asking, so a sweep across the list starts nothing');
  ok(/document\.addEventListener\('pointerdown'[\s\S]{0,260}_prodPrefetchOpen\(id\)/.test(INDEX), 'a press asks at once');

  const tailSrc = grab('_prodLoadTerminalTail', 'async');
  ok(/const nothingMoved = !!watermark && tail\.every\(/.test(tailSrc) && /if \(!nothingMoved\) _prodState\.adapter = _prodAdapter\(/.test(tailSrc),
    'an incremental read that returns only rows the copy already holds rebuilds nothing');
  ok(/_prodTerminalCopyWrite\(_prodState\.deliverables, _prodState\.terminalTailFullAt\)/.test(tailSrc),
    'a landed tail refreshes the saved copy, stamped with the last full pass (not "now")');
  const loadSrc = grab('_prodLoadData', 'async');
  ok(/Promise\.race\(\[[\s\S]{0,200}_prodTerminalCopyRead\(\)[\s\S]{0,200}setTimeout\(\(\) => resolve\(null\), 400\)/.test(loadSrc)
    && /_prodAdoptTerminalCopy\(copy, copyGeneration\);[\s\S]{0,260}?copyGeneration === _prodState\.projectionGeneration && _prodTerminalTailFullDue\(silent\)\) _prodStartTailPrefetch\(\);/.test(loadSrc),
    'the full-download prefetch waits (400 ms at most) for the saved copy before deciding');

  console.log('\nopen-item-speed: ' + passed + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
