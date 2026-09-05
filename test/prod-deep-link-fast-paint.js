'use strict';
/*
 * A Production deep link paints from its own read, beside the board's, not
 * behind it.
 *
 * OWNER REPORT 2026-09-05, following a calendar card's "Open the SyncView
 * Production video sub-issue in a new tab" link: "it always takes a lot of
 * time to load. way too much time". The link opens ?prod=1&d=<id> in a FRESH
 * tab, so nothing is warm. _prodLoadData awaited the whole live projection
 * (thousands of rows, paged in sequence) and every batch before the one-row
 * catch-up read (_prodFetchDeepLinkRow) was allowed to start, so the one row
 * the reader asked for was the last thing to arrive.
 *
 * Pinned here:
 *   1. The one-row read starts the moment _prodLoadData does, before phase one
 *      resolves, and the detail becomes renderable (loaded, not loading) as
 *      soon as that row, its batch, its parent and the two small tables land.
 *   2. Phase one landing afterwards KEEPS the painted row when its own set
 *      does not carry it (a finished row), and the post-phase-one catch-up
 *      does not request it a second time.
 *   3. The fast paint consumes nothing and writes nothing: the deep link is
 *      still pending until the authoritative pass, and the cache is untouched.
 *   4. A fast read that lands after phase one is discarded, exactly as the
 *      catch-up read already is; a failed fast read leaves the old path alone.
 *   5. No deep link, or a snapshot that already holds the row: no extra read.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Comment-aware brace matcher, as in test/production-deep-link-survives-cache.js. */
function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (!quote && char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

const ROW = { id: 'd_vid_1', identifier: 'VID-1', batch_id: 'bat_1', raw_issue_parent_id: 'lin-parent', status: 'for_smm_approval' };
const PARENT = { id: 'd_par_1', identifier: 'VID-0', linear_issue_uuid: 'lin-parent', status: 'posted' };

function newHarness(opts) {
  const o = opts || {};
  const log = { rowReads: [], parentReads: [], liveReads: 0, batchByIdReads: 0, renders: [], cacheWrites: 0 };
  const phase = { clients: defer(), members: defer(), batches: defer(), live: defer() };
  const sandbox = {
    String, Number, Array, Set, Promise, Date, Object, encodeURIComponent, console,
    setTimeout: () => 0,
    document: { getElementById: () => ({}) },
    PROD_LIVE_FILTER: 'live', PROD_BATCH_SELECT: 'id,name',
    _prodState: {
      loaded: false, loading: false, refreshing: false, error: '', cachePartial: false,
      clients: [], members: [], batches: [], deliverables: o.deliverables || [], adapter: null,
      projectionGeneration: 0, deepLink: o.deepLink === undefined ? { kind: 'issue', id: 'VID-1' } : o.deepLink,
      openId: 'VID-1', view: 'detail', deepLinkMissing: '',
      terminalTailPending: false, terminalTailFailed: false, terminalTailLoadedAt: 0,
    },
    _prodIssue(id) {
      const sid = String(id || '');
      return (sandbox._prodState.deliverables || []).find(r => r && (r.id === sid || r.identifier === sid)) || null;
    },
    _prodAdapter: input => ({ ISSUES: (input || {}).deliverables || [] }),
    _prodRender() { const s = sandbox._prodState; log.renders.push({ loaded: s.loaded, loading: s.loading, view: s.view }); },
    _prodFetchAuthority: () => Promise.resolve(null),
    _prodRestRows(table, select, params, pageSize, maxPages, options) {
      if (table === 'clients') return phase.clients.promise;
      if (table === 'team_members') return phase.members.promise;
      if (table === 'batches' && options && options.keysetColumn) return phase.batches.promise;
      if (table === 'batches') { log.batchByIdReads++; return Promise.resolve(/bat_1/.test(params) ? [{ id: 'bat_1', name: 'Batch 1' }] : []); }
      throw new Error('unexpected read ' + table);
    },
    _prodLoadDeliverableProjection(params) {
      if (params === 'live') { log.liveReads++; return phase.live.promise; }
      if (/^or=\(/.test(params)) { const d = defer(); log.rowReads.push({ params, d }); return d.promise; }
      if (/^linear_issue_uuid=in\./.test(params)) { log.parentReads.push(params); return Promise.resolve([PARENT]); }
      throw new Error('unexpected projection read ' + params);
    },
    _prodPreserveProjectedFields: incoming => incoming,
    _prodInvalidateScopedReads() {},
    _prodCacheWrite() { log.cacheWrites++; },
    _prodCachePurge() {},
    _prodApplyDeepLinkFallback(authoritative) {
      const s = sandbox._prodState;
      if (!authoritative || !s.deepLink) return;
      if (sandbox._prodIssue(s.deepLink.id)) { s.openId = s.deepLink.id; s.view = 'detail'; }
      else if (!s.terminalTailPending) { s.deepLinkMissing = s.deepLink.id; s.view = 'list'; }
      s.deepLink = null;
    },
    _prodLoadTerminalTail: async () => {},
    _prodLoadBriefs() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    ['_prodDeepLinkRowQuery', '_prodDeepLinkFastPaint', '_prodCarryDeepLinkRows', '_prodFetchDeepLinkRow', '_prodLoadData']
      .map(name => (source.includes('async function ' + name + '(') ? 'async ' : '') + extractFunction(name)).join('\n')
      + "\nlet _prodDeepLinkFastRows = null; let _prodDeepLinkFetchInFlight = '';"
      + '\nthis.load = _prodLoadData; this.fastRecord = () => _prodDeepLinkFastRows;',
    sandbox,
  );
  return { sandbox, log, phase, state: sandbox._prodState };
}

const landPhaseOne = (h, live) => {
  h.phase.clients.resolve([{ slug: 'acme', active: true }]);
  h.phase.members.resolve([{ id: 'm1', name: 'Editor' }]);
  h.phase.batches.resolve([]);
  h.phase.live.resolve(live);
};

(async () => {
  {
    /* 1 + 2 + 3: cold boot, fast read lands first, phase one does not carry the row. */
    const h = newHarness();
    const done = h.sandbox.load();
    ok(h.log.rowReads.length === 1 && h.log.liveReads === 1,
      'the one-row read starts beside phase one, before any of it resolves');
    ok(h.state.loading === true && h.state.loaded === false,
      'and until something lands the pane is the skeleton it always was');

    h.log.rowReads[0].d.resolve([ROW]);
    h.phase.clients.resolve([{ slug: 'acme', active: true }]);
    h.phase.members.resolve([{ id: 'm1', name: 'Editor' }]);
    await flush();
    ok(h.state.loaded === true && h.state.loading === false && h.state.view === 'detail',
      'once the row and the two small tables land the detail is renderable, with phase one still in flight');
    ok(!!h.sandbox._prodIssue('VID-1') && !!h.sandbox._prodIssue('d_par_1'),
      'the row AND its parent are on the board, so a sub-issue renders as one');
    ok(h.log.batchByIdReads === 1 && h.state.batches.some(b => b.id === 'bat_1'),
      'its batch was read by id, not by walking every batch');
    ok(h.state.refreshing === true, 'refreshing stays true, so the auto-refresh cannot start a second load');
    ok(h.state.deepLink && h.state.deepLink.id === 'VID-1',
      'the deep link is NOT consumed by the fast paint; the authoritative pass still owns that');
    ok(h.log.cacheWrites === 0, 'and nothing is written to the cache from a one-row paint');
    ok(h.log.renders.some(r => r.loaded && !r.loading), 'the pane was repainted after the fast paint');

    h.phase.batches.resolve([]);
    h.phase.live.resolve([]);                                  // phase one: a finished row is not in the live set
    await done; await flush();
    const copies = h.state.deliverables.filter(r => r.id === 'd_vid_1').length;
    ok(copies === 1, 'phase one carries the painted row across (exactly one copy), so the pane never drops to a skeleton');
    ok(h.log.rowReads.length === 1, 'and the post-phase-one catch-up does not request the same row again');
    ok(h.state.deepLink === null && h.state.openId === 'VID-1' && h.state.view === 'detail',
      'the authoritative pass consumes the link and the item stays open');
    ok(h.sandbox.fastRecord() === null, 'the carry record is spent once phase one has used it');
    ok(h.state.loaded && !h.state.loading && !h.state.refreshing && h.state.projectionGeneration === 1,
      'and the load finishes in its ordinary state');
  }

  {
    /* 4a: phase one lands first; the late fast read is discarded and the catch-up read stands. */
    const h = newHarness();
    const done = h.sandbox.load();
    landPhaseOne(h, []);
    await done; await flush();
    ok(h.log.rowReads.length === 2, 'phase one landing first leaves the catch-up read to run as it always did');
    h.log.rowReads[0].d.resolve([ROW]);                        // the fast read, arriving late
    await flush();
    ok(h.state.deliverables.filter(r => r.id === 'd_vid_1').length === 0,
      'a fast read that lands after the generation moved on is discarded, as the catch-up read would be');
    h.log.rowReads[1].d.resolve([ROW]);
    await flush();
    ok(h.state.deliverables.filter(r => r.id === 'd_vid_1').length === 1,
      'and the catch-up read then adds it exactly once');
  }

  {
    /* 4b: the fast read fails; the old path is untouched. */
    const h = newHarness();
    const done = h.sandbox.load();
    h.log.rowReads[0].d.reject(new Error('boom'));
    await flush();
    ok(h.state.loading === true && h.state.loaded === false,
      'a failed fast read changes nothing: the pane keeps waiting on phase one');
    ok(h.sandbox.fastRecord() === null, 'and leaves no record behind that could block a retry');
    landPhaseOne(h, [ROW]);
    await done; await flush();
    ok(h.state.loaded && h.sandbox._prodIssue('VID-1') && h.log.rowReads.length === 1,
      'phase one then paints the row itself and no catch-up read is needed');
  }

  {
    /* 5: nothing to fast-paint. */
    const none = newHarness({ deepLink: null });
    const p1 = none.sandbox.load();
    ok(none.log.rowReads.length === 0, 'no deep link, no one-row read');
    landPhaseOne(none, []); await p1;

    const warm = newHarness({ deliverables: [ROW] });
    const p2 = warm.sandbox.load();
    ok(warm.log.rowReads.length === 0, 'a snapshot that already holds the row asks for nothing extra');
    landPhaseOne(warm, [ROW]); await p2;
  }

  {
    /* Source-level: the call sits before the await it exists to skip, and the
       fast paint cannot reach the two things it is not allowed to touch. */
    const load = extractFunction('_prodLoadData');
    ok(load.indexOf('_prodDeepLinkFastPaint(') > 0 && load.indexOf('_prodDeepLinkFastPaint(') < load.indexOf('await Promise.all('),
      '_prodLoadData starts the fast paint BEFORE awaiting phase one');
    ok(/const mergedDeliverables = _prodCarryDeepLinkRows\(deliverables\)/.test(load),
      'and carries the painted rows across the phase-one replacement');
    const paint = extractFunction('_prodDeepLinkFastPaint');
    ok(!/_prodCacheWrite|_prodApplyDeepLinkFallback|deepLink = /.test(paint),
      'the fast paint never writes the cache, never applies or consumes the deep link');
    const fetch = extractFunction('_prodFetchDeepLinkRow');
    ok(/_prodDeepLinkRowQuery\(wanted\)/.test(fetch) && /_prodDeepLinkRowQuery\(wanted\)/.test(paint),
      'both readers build the one-row filter from the same helper');
  }

  if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
  console.log('prod-deep-link-fast-paint: all ok');
})().catch(e => { console.error(e); process.exit(1); });
