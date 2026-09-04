'use strict';
// Actual shipped reader, loader and cache; fictional rows, no network or writers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const row = (id = 'a', client = 'fixture-a') => ({ id, client, name: 'Fictional sample', status: 'In Progress' });
const response = (body, status = 200, count = Array.isArray(body) ? body.length : null) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => count === null ? null : `${Array.isArray(body) && body.length ? '0-' + (body.length - 1) : '*'}/${count}` },
  json: async () => { if (body === 'invalid-json') throw new SyntaxError('synthetic'); return body; },
});
function setup() {
  const storage = new Map(), effects = { renders: [], stale: false, subscriptions: [], cacheWrites: 0 };
  const timers = new Map(); let timerId = 0;
  const s = {
    CAL_SUPABASE_URL: 'https://fixture.invalid', CAL_SUPABASE_ANON_KEY: 'fictional',
    CAL_SUPABASE_PAGE: 2, SXR_TABLE: 'sample_reviews', SXR_GET_URL: 'https://fixture.invalid/fallback',
    SXR_COMPONENTS: [], SXR_ARCHIVE_GRACE_MS: 60000,
    sxrState: { client: 'fixture-a', posts: [], loading: false, error: null },
    sxrClientSlug: x => x || '', AbortController, Date, encodeURIComponent,
    console: { warn() {} },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    localStorage: { getItem: k => storage.get(k) || null,
      setItem: (k, v) => { storage.set(k, v); effects.cacheWrites++; },
      removeItem: k => storage.delete(k), key: i => [...storage.keys()][i], get length() { return storage.size; } },
    _writeUiAuthoritySnapshot: () => ({}), _writeUiFilterCachedPosts: p => p,
    _prodStripEphemeralCanonicalPosts: p => p.map(x => { const r = { ...x }; delete r._canonicalRead; return r; }),
    _sxrNormStatus: x => x || 'In Progress', _sxrArchivedReadRaw: () => ({}), _sxrArchivedRefs: () => new Set(),
    _sxrRenderBody: () => effects.renders.push({ loading: s.sxrState.loading, error: !!s.sxrState.error, ids: s.sxrState.posts.map(p => p.id) }),
    _sxrSetRefreshing: x => { effects.refreshing = x; }, _sxrSetStaleNotice: x => { effects.stale = x; },
    _thumbRefreshChangedCards() {}, _sxrAdoptDeliverableLinks: async () => {},
    _sxrV2EnsureSubscribed: slug => effects.subscriptions.push(slug), _sxrV2DrainPending() {},
    fetch: async () => { throw new Error('unmocked request'); },
  };
  vm.createContext(s);
  vm.runInContext(slice('    const SXR_LOAD_TIMEOUT_MS =', '    /* ============================================================\n       --- SURFACE 2:'), s);
  return { s, storage, effects, timers, key: 'syncview_sxr_cache_v2_fixture-a' };
}
let passed = 0;
async function test(label, run) { await run(); passed++; console.log('PASS ' + label); }
const ids = posts => Array.from(posts, p => p.id);
async function rejectsFallback(body, status = 200) {
  const { s } = setup();
  s.fetch = async url => url.includes('/fallback') ? response(body, status) : response({}, 500);
  await assert.rejects(s._sxrFetchPosts('fixture-a'));
}
(async () => {
  for (const status of [401, 403, 429, 500]) await test('reject fallback HTTP ' + status, () => rejectsFallback({ ok: true, posts: [row()], complete: true, total: 1 }, status));
  const invalid = [
    null, 'invalid-json', {}, { ok: false }, { ok: 'true', posts: [row()] },
    { ok: true }, { ok: true, posts: {} }, { ok: true, posts: [null] },
    { ok: true, posts: [{ id: 'a' }] }, { ok: true, posts: [row('a', 'fixture-b')] },
    { ok: true, posts: [row(), row()] }, { ok: true, posts: [row()], items: [row()] },
    { ok: true, posts: [] }, { ok: true, posts: [], complete: true, total: 0 },
    { ok: true, posts: [{ ...row(), status: 'Archived' }], complete: true, total: 1 },
    { ok: true, posts: [row()] }, { ok: true, posts: [row()], complete: true, total: 2 },
    ...['partial', 'has_more', 'hasMore', 'next_cursor', 'nextCursor', 'error', 'errors'].map(k => ({ ok: true, posts: [row()], complete: true, total: 1, [k]: true })),
  ];
  for (let i = 0; i < invalid.length; i++) await test('reject malformed/incomplete fallback ' + i, () => rejectsFallback(invalid[i]));
  await test('every bad fallback preserves populated cache and cannot become empty success', async () => {
    for (const payload of invalid) {
      const { s, storage, key, effects } = setup();
      const saved = JSON.stringify({ at: Date.now(), posts: [row()] }); storage.set(key, saved);
      s.fetch = async url => url.includes('/fallback') ? response(payload) : response({}, 500);
      await s.loadSxrCards();
      assert.deepEqual(ids(s.sxrState.posts), ['a']); assert.equal(storage.get(key), saved);
      assert.equal(effects.stale, true); assert.equal(effects.cacheWrites, 0);
    }
  });
  for (const key of ['items', 'samples', 'posts']) await test('complete fallback alias ' + key, async () => {
    const { s } = setup(); s.fetch = async url => url.includes('/fallback') ? response({ ok: true, [key]: [row()], complete: true, total: 1 }) : response({}, 500);
    assert.deepEqual(ids((await s._sxrFetchPosts('fixture-a')).posts), ['a']);
  });
  await test('primary complete pages and exact client cursor', async () => {
    const { s } = setup(); const calls = [];
    s.fetch = async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? response([row('a'), row('b')], 200, 3) : response([row('c')]); };
    assert.deepEqual(ids((await s._sxrFetchPosts('fixture-a')).posts), ['a', 'b', 'c']);
    assert.equal(calls.length, 2); assert.match(calls[1].url, /client=eq.fixture-a.*id=gt.b/);
    assert.equal(calls[0].init.headers.Prefer, 'count=exact');
  });
  for (const [label, pages] of [
    ['short count', [response([row()], 200, 2)]],
    ['missing count', [response([row()], 200, null)]],
    ['missing row identity', [response([{}])]],
    ['wrong client', [response([row('a', 'fixture-b')])]],
    ['later page failed', [response([row('a'), row('b')], 200, 3), response({}, 500)]],
    ['later page missing', [response([row('a'), row('b')], 200, 3), response([])]],
    ['nonadvancing cursor', [response([row('a'), row('b')], 200, 3), response([row('a')])]],
  ]) await test('primary refuses ' + label, async () => {
    const { s } = setup(); s.fetch = async url => url.includes('/fallback') ? response({ ok: false }) : pages.shift();
    await assert.rejects(s._sxrFetchPosts('fixture-a'));
  });
  await test('abort never falls back', async () => {
    const { s } = setup(); let calls = 0;
    s.fetch = async () => { calls++; throw Object.assign(new Error('synthetic'), { name: 'AbortError' }); };
    await assert.rejects(s._sxrFetchPosts('fixture-a'), { name: 'AbortError' }); assert.equal(calls, 1);
  });
  await test('authoritative empty replaces cards and cache; recovery clears error', async () => {
    const { s, storage, key, effects } = setup(); s.fetch = async () => response([]);
    s.sxrState.posts = [row()]; s._sxrCacheWrite('fixture-a', [row()]);
    await s.loadSxrCards({ skipCache: true });
    assert.deepEqual(ids(s.sxrState.posts), []); assert.equal(JSON.parse(storage.get(key)).posts.length, 0);
    assert.equal(effects.stale, false); assert.equal(s.sxrState.error, null);
    s.fetch = async () => { throw new Error('synthetic'); }; await s.loadSxrCards();
    assert.ok(s.sxrState.error); assert.equal(s.sxrState.loading, false);
    s.fetch = async () => response([row('recovered')]); await s.loadSxrCards({ skipCache: true });
    assert.deepEqual(ids(s.sxrState.posts), ['recovered']); assert.equal(s.sxrState.error, null);
  });
  await test('expired last-good cache remains visible and byte-identical during failures and retry', async () => {
    const { s, storage, key, effects } = setup();
    const saved = JSON.stringify({ schema: 2, at: Date.now() - 9 * 86400000, posts: [row()] }); storage.set(key, saved);
    assert.equal(s._sxrCacheRead('fixture-a'), null);
    await s.loadSxrCards(); await s.loadSxrCards({ skipCache: true });
    assert.deepEqual(ids(s.sxrState.posts), ['a']); assert.equal(storage.get(key), saved);
    assert.equal(effects.stale, true); assert.equal(s.sxrState.loading, false);
    assert.ok(effects.renders.every(r => !r.loading)); assert.equal(effects.cacheWrites, 0);
  });
  await test('foreign cache/state never paints or becomes target cache', async () => {
    const { s, storage, key, effects } = setup();
    s.sxrState.posts = [row('foreign', 'fixture-b')];
    storage.set(key, JSON.stringify({ at: Date.now(), posts: [row('foreign', 'fixture-b')] }));
    await s.loadSxrCards(); assert.deepEqual(ids(s.sxrState.posts), []); assert.ok(s.sxrState.error);
    assert.ok(effects.renders.every(r => !r.ids.includes('foreign'))); assert.equal(effects.cacheWrites, 0);
  });
  for (const reject of [false, true]) await test('late client-A ' + (reject ? 'failure' : 'success') + ' cannot touch B', async () => {
    const { s, storage, effects } = setup(); let release;
    s._sxrFetchPosts = () => new Promise((resolve, fail) => { release = () => reject ? fail(new Error('synthetic')) : resolve({ ok: true, posts: [row()] }); });
    const pending = s.loadSxrCards(); s.sxrState.client = 'fixture-b'; s.sxrState.posts = [row('b', 'fixture-b')];
    const before = effects.renders.length; release(); await pending;
    assert.deepEqual(ids(s.sxrState.posts), ['b']); assert.equal(storage.size, 0);
    assert.equal(effects.renders.length, before); assert.equal(effects.subscriptions.length, 0);
  });
  await test('same-client supersession and timeout keep the newest board', async () => {
    const { s, timers, effects } = setup(); let release;
    s._sxrFetchPosts = () => new Promise(resolve => { release = resolve; }); const old = s.loadSxrCards();
    s._sxrFetchPosts = async () => ({ ok: true, posts: [row('new')] }); await s.loadSxrCards();
    release({ ok: true, posts: [row('old')] }); await old; assert.deepEqual(ids(s.sxrState.posts), ['new']);
    s._sxrFetchPosts = () => new Promise(() => {}); const timed = s.loadSxrCards({ skipCache: true });
    [...timers.values()].find(t => t.ms === 20000).fn(); await timed;
    assert.equal(effects.stale, true); assert.equal(s.sxrState.loading, false); assert.deepEqual(ids(s.sxrState.posts), ['new']);
  });
  await test('no-cache timeout shows error and subsequent complete fallback recovers/cache-primes', async () => {
    const { s, timers, storage, key, effects } = setup();
    s.fetch = () => new Promise(() => {}); const pending = s.loadSxrCards();
    [...timers.values()].find(t => t.ms === 20000).fn(); await pending;
    assert.ok(s.sxrState.error); assert.equal(s.sxrState.loading, false); assert.equal(storage.size, 0);
    s.fetch = async url => url.includes('/fallback') ? response({ ok: true, items: [row()], complete: true, total: 1 }) : response({}, 500);
    await s.loadSxrCards({ skipCache: true });
    assert.deepEqual(ids(s.sxrState.posts), ['a']); assert.equal(s.sxrState.error, null);
    assert.equal(effects.stale, false); assert.equal(JSON.parse(storage.get(key)).posts.length, 1);
  });
  await test('source repair cache and ephemeral authority protections survive', async () => {
    const { s, storage, key } = setup(); const repair = { ...row(), _writeUiRetrySourceAt: 1, _canonicalRead: 'never persist' };
    s._sxrCacheWrite('fixture-a', [repair]); s._sxrCacheWrite('fixture-a', []);
    const saved = JSON.parse(storage.get(key)); assert.equal(saved.posts[0]._writeUiRetrySourceAt, 1); assert.equal(saved.posts[0]._canonicalRead, undefined);
    s._sxrCacheWrite('fixture-a', [], { clearRepairIds: ['a'] }); assert.equal(JSON.parse(storage.get(key)).posts.length, 0);
  });
  console.log(`Samples authoritative read: ${passed} cases passed (fully isolated).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
