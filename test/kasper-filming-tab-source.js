'use strict';
// Kasper > Filming reads Doc tabs from the filming-plan-tabs Edge Function when
// the runtime flag filming_plan_tabs_source says {"mode":"function"}, else from
// the n8n webhook (docs/plans/2026-09-28-n8n-exit.md, PR 1b). This runs the REAL
// functions out of the fragment with every fetch recorded, and asserts which
// hosts each path talked to. Nothing touches a network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function.js');

const ROOT = path.resolve(__dirname, '..');
const FRAG_PATH = 'src/index/321-kasper-dashboard-replies.js.part';
const SRC = fs.readFileSync(path.join(ROOT, FRAG_PATH), 'utf8');
const NAMES = ['_filmsTabSource', '_filmsTabsFromFunction', '_filmsTabResult', '_filmsFetchTabMonths',
  '_filmsParseMonth', '_filmsMapLimit', '_kasperLoadFilming'];
// extractFunction starts at `function name(`, so `async` has to be put back.
const isAsync = (n) => new RegExp('async\\s+function\\s+' + n + '\\s*\\(').test(SRC);
// The constants come from the fragment too, so the test uses the shipped values.
// Only the flag-read timeout is shortened, so the "never answers" case is quick.
const CONST_NAMES = ['FILMING_PLAN_TABS_EF_URL', 'FILMING_TABS_SOURCE_FLAG_KEY', 'FILMING_TABS_FLAG_TIMEOUT_MS',
  'FILMING_TABS_EF_TIMEOUT_MS', 'FILMING_TABS_EF_BATCH', 'FILMING_TABS_DOC_ID_RE'];
const CONSTS = CONST_NAMES.map((n) => {
  const m = SRC.match(new RegExp('^\\s*const ' + n + ' = [^\\n]*;', 'm'));
  assert(m, 'fragment declares ' + n);
  return m[0].replace(/FILMING_TABS_FLAG_TIMEOUT_MS = \d+/, 'FILMING_TABS_FLAG_TIMEOUT_MS = 25');
}).join('\n');
const CODE = CONSTS + '\n' + NAMES.map(n => (isAsync(n) ? 'async ' : '') + extractFunction(SRC, n)).join('\n');

const SUPA = 'https://supabase.example';
const N8N = 'https://n8n.example/webhook/filming-plan-tabs';
const id = (c) => c.repeat(44);
const DOCS = [id('a'), id('b'), id('c')];
const tabsFor = (docId, title) => [{ tabId: 't.0', title, url: 'https://docs.google.com/document/d/' + docId + '/edit?tab=t.0' }];
const titleOf = { [DOCS[0]]: 'June 2026', [DOCS[1]]: 'May 2026', [DOCS[2]]: 'July 2026' };

// A world: the flag row, the function's behaviour, n8n's behaviour, and a log.
function world(opts = {}) {
  const w = {
    flag: opts.flag === undefined ? { mode: 'function' } : opts.flag,   // row value, or 'missing'
    flagHttp: opts.flagHttp || 200,
    flagHangs: !!opts.flagHangs,
    flagThrows: !!opts.flagThrows,
    fnStatus: opts.fnStatus || 200,
    fnBad: new Set(opts.fnBad || []),
    fnThrows: !!opts.fnThrows,
    fnWrongTitle: opts.fnWrongTitle || null,
    log: [],
  };
  w.fetch = async (url, init) => {
    url = String(url);
    const rec = { url, init: init || {}, kind: '' };
    w.log.push(rec);
    const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (url.startsWith(SUPA + '/rest/v1/syncview_runtime_flags')) {
      rec.kind = 'flag';
      if (w.flagThrows) throw new Error('offline');
      if (w.flagHangs) return new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
      if (w.flagHttp !== 200) return json({}, w.flagHttp);
      return json(w.flag === 'missing' ? [] : [{ value: w.flag }]);
    }
    if (url.startsWith(SUPA + '/functions/v1/filming-plan-tabs')) {
      rec.kind = 'function';
      if (w.fnThrows) throw new Error('offline');
      if (w.fnStatus !== 200) return json({ ok: false }, w.fnStatus);
      const docs = {};
      for (const d of new URL(url).searchParams.get('docs').split(',')) {
        docs[d] = w.fnBad.has(d) ? { ok: false, docId: d, error: 'tabs_unavailable' }
          : { ok: true, docId: d, tabs: tabsFor(d, (w.fnWrongTitle || titleOf[d] || 'June 2026')) };
      }
      return json({ ok: true, docs });
    }
    if (url.startsWith(N8N)) {
      rec.kind = 'n8n';
      const d = new URL(url).searchParams.get('doc');
      return json({ ok: true, docId: d, tabs: tabsFor(d, titleOf[d] || 'June 2026') });
    }
    rec.kind = 'other';
    return json({});
  };
  w.count = (kind) => w.log.filter(r => r.kind === kind).length;
  return w;
}

function load(w, extra = {}) {
  const state = { filmingData: null, filmingExpanded: {} };
  const painted = [];
  const sandbox = {
    console, URL, Date, Math, Set, Map, Array, Promise, JSON, String, encodeURIComponent, setTimeout, clearTimeout, AbortController,
    fetch: w.fetch,
    CAL_SUPABASE_URL: SUPA, CAL_SUPABASE_ANON_KEY: 'anon-key',
    FILMING_PLAN_TABS_URL: N8N,
    _syncviewEfHeaders: (h) => Object.assign({ 'X-Syncview-Key': 'staff-key' }, h),
    _kasperState: state, document: { getElementById: () => null },
    _filmsLoadCache: () => null, _filmsSaveCache: () => {}, _filmsPaint: () => painted.push(state.filmingData && state.filmingData.rows.length),
    _kasperRefreshTabCounts: () => {}, _svLoadingSkeletonHtml: () => '', _calEsc: (s) => String(s),
    svArea: async () => ({ fpEnsureLoaded: async () => ({ rows: [] }) }),
    _filmsRowsFromPlans: () => DOCS.map((docId, i) => ({ client: 'Client ' + i, slug: 's' + i, docId, docUrl: 'https://docs.google.com/document/d/' + docId, months: new Set() })),
    _filmsFetchContentBank: async () => 5,
    _filmsClassify: () => ({ status: 'green', reason: 'ok' }),
    _FILMS_RANK: { green: 2, amber: 1, red: 0 },
  };
  Object.assign(sandbox, extra);
  vm.createContext(sandbox);
  vm.runInContext(CODE + '\nthis.exports = { _filmsTabSource, _filmsTabsFromFunction, _filmsFetchTabMonths, _kasperLoadFilming };', sandbox);
  return { fns: sandbox.exports, state, painted };
}

const monthsOf = (state) => state.filmingData.rows.map(r => [...r.months].sort().join(','));

(async () => {
  // --- the flag: a fresh read every time, and only the exact value opens it ---
  for (const [label, w] of [
    ['function', world({ flag: { mode: 'function' } })],
  ]) {
    const { fns } = load(w);
    assert.equal(await fns._filmsTabSource(), 'function', label + ' mode reads as function');
    assert.equal(await fns._filmsTabSource(), 'function');
    assert.equal(w.count('flag'), 2, 'every call is its own read, never cached or shared');
    const r = w.log[0];
    assert.equal(r.init.cache, 'no-store', 'the flag read bypasses the HTTP cache');
    assert(/_t=\d+/.test(r.url), 'and carries a cache-buster');
  }
  for (const [label, opts] of [
    ['a missing row', { flag: 'missing' }],
    ['mode n8n', { flag: { mode: 'n8n' } }],
    ['an unknown mode', { flag: { mode: 'both' } }],
    ['a scalar value', { flag: 'function' }],
    ['an empty object', { flag: {} }],
    ['a null value', { flag: null }],
    ['an HTTP error', { flagHttp: 503 }],
    ['a network error', { flagThrows: true }],
    ['a read that never answers', { flagHangs: true }],
  ]) {
    const w = world(opts);
    const { fns } = load(w);
    assert.equal(await fns._filmsTabSource(), 'n8n', label + ' means n8n (the default)');
  }

  // --- function mode: one bulk request, zero n8n requests --------------------
  {
    const w = world({ flag: { mode: 'function' } });
    const { fns, state } = load(w);
    await fns._kasperLoadFilming(false);
    assert.equal(w.count('n8n'), 0, 'ZERO requests to n8n when the function answers every Doc');
    assert.equal(w.count('function'), 1, 'one bulk request covers every client');
    assert.equal(w.count('flag'), 1);
    const fn = w.log.find(r => r.kind === 'function');
    assert(fn.url.includes('docs=' + DOCS.join(',')) && !fn.url.includes('refresh=1'), 'all Docs, no refresh on an ordinary open');
    assert.equal(fn.init.headers['X-Syncview-Key'], 'staff-key', 'staff credential sent');
    assert(!w.log.some(r => /n8n\.cloud|n8n\.example/.test(r.url)), 'no request to any n8n host at all');
    assert.deepEqual(monthsOf(state), ['2026-06', '2026-05', '2026-07'], 'each client gets its own Doc months');
  }

  // --- the same rows come out of both sources -------------------------------
  {
    const a = world({ flag: { mode: 'function' } }); const A = load(a);
    const b = world({ flag: { mode: 'n8n' } }); const B = load(b);
    await A.fns._kasperLoadFilming(false); await B.fns._kasperLoadFilming(false);
    assert.deepEqual(monthsOf(A.state), monthsOf(B.state), 'function and n8n give the same months per client');
    const shape = (st) => JSON.parse(JSON.stringify(st.filmingData.rows.map(r => [r.tabRead, r.tabTitles, r.tabError])));   // plain JSON: the sandbox's arrays have another prototype
    assert.deepEqual(shape(A.state), shape(B.state), 'and the same titles, read flag and error');
  }

  // --- Refresh: asks the function to re-read from Google ---------------------
  {
    const w = world({ flag: { mode: 'function' } });
    const { fns } = load(w);
    await fns._kasperLoadFilming(true);
    assert(w.log.find(r => r.kind === 'function').url.endsWith('&refresh=1'), 'Refresh passes refresh=1');
    assert.equal(w.count('flag'), 1, 'and Refresh reads the flag afresh too');
  }

  // --- default n8n mode: the old path exactly as before, no function call ----
  {
    const w = world({ flag: { mode: 'n8n' } });
    const { fns } = load(w);
    await fns._kasperLoadFilming(false);
    assert.equal(w.count('function'), 0, 'in n8n mode the function is never called');
    assert.equal(w.count('n8n'), 3, 'one n8n call per Doc, as before');
    assert(w.log.filter(r => r.kind === 'n8n').every(r => /[?&]_t=\d+/.test(r.url)), 'with the old cache-buster');
  }

  // --- automatic n8n fallback ------------------------------------------------
  for (const [label, opts, n8nCalls] of [
    ['the function returns an HTTP error', { fnStatus: 500 }, 3],
    ['the function is unreachable', { fnThrows: true }, 3],
    ['the function cannot read one Doc', { fnBad: [DOCS[1]] }, 1],
  ]) {
    const w = world(Object.assign({ flag: { mode: 'function' } }, opts));
    const { fns, state } = load(w);
    await fns._kasperLoadFilming(false);
    assert.equal(w.count('n8n'), n8nCalls, label + ': n8n reads only what the function could not');
    assert.deepEqual(monthsOf(state), ['2026-06', '2026-05', '2026-07'], label + ': every client still gets its months');
  }

  // --- a Doc id the function would refuse never spoils the batch --------------
  {
    const w = world({ flag: { mode: 'function' } });
    const { fns } = load(w, { _filmsRowsFromPlans: () => [
      { client: 'A', slug: 'a', docId: DOCS[0], docUrl: 'u', months: new Set() },
      { client: 'B', slug: 'b', docId: 'short', docUrl: 'u', months: new Set() },
      { client: 'C', slug: 'c', docId: '', docUrl: '', months: new Set() },
    ] });
    await fns._kasperLoadFilming(false);
    const fn = w.log.find(r => r.kind === 'function');
    assert(fn.url.includes('docs=' + DOCS[0]) && !fn.url.includes('short'), 'only valid Doc ids are sent to the function');
    assert.equal(w.count('n8n'), 1, 'the malformed id goes to n8n as before; the empty one is skipped');
  }

  // --- batching ---------------------------------------------------------------
  {
    const w = world({ flag: { mode: 'function' } });
    const { fns } = load(w);
    const ids = Array.from({ length: 120 }, (_, i) => String(i).padStart(3, '0') + 'x'.repeat(40));
    const found = await fns._filmsTabsFromFunction(ids, false);
    assert.equal(w.count('function'), 3, '120 Docs are sent as 3 batches (50, 50, 20), under the function\'s limit of 60');
    assert.equal(found.size, 120);
  }

  // --- a stale tab: the flag flips while the function would still answer ------
  {
    const w = world({ flag: { mode: 'function' }, fnWrongTitle: 'January 2020' });
    const { fns, state } = load(w);
    await fns._kasperLoadFilming(false);   // this load sees function mode
    assert.equal(w.count('n8n'), 0);
    assert.deepEqual(monthsOf(state), ['2020-01', '2020-01', '2020-01'], 'the function is answering, successfully but wrongly');
    w.flag = { mode: 'n8n' };              // operator flips the switch back
    const before = w.count('function');
    await fns._kasperLoadFilming(false);   // the very next load on the same open tab
    assert.equal(w.count('function'), before, 'the next load does not call the function at all');
    assert.equal(w.count('n8n'), 3, 'it goes to n8n');
    assert.deepEqual(monthsOf(state), ['2026-06', '2026-05', '2026-07'], 'and shows the right months again');
  }

  // --- source-level wiring ----------------------------------------------------
  const load1 = extractFunction(SRC, '_kasperLoadFilming');
  assert(load1.indexOf('_filmsTabSource()') < load1.indexOf('_filmsMapLimit('), 'the flag is read before the per-client work');
  assert(/_filmsTabsFromFunction\(rows\.map\(r => r\.docId\), !!forceRefresh\)/.test(load1), 'Refresh reaches the function call');
  assert(/_filmsFetchTabMonths\(row\.docId, tabsFromFunction\)/.test(load1), 'each row asks the batch answer first');
  assert(!/cache|Cache/.test(extractFunction(SRC, '_filmsTabSource').replace(/cache: 'no-store'|no-store|HTTP cache|never cached/g, '')), 'the flag read holds no cache');

  console.log('KASPER_FILMING_TAB_SOURCE_OK');
})().catch((e) => { console.error(e); process.exit(1); });
