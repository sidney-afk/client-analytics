'use strict';
/*
 * Create Post was completely broken, and the cause was a cache nobody bounded.
 *
 * Round-3 tester, 2026-08-31 (PR 1186), outside the numbered brief and
 * arguably worse than either P0 in it.
 *
 * `_kasperFetchAllRelevantPosts` walks EVERY allowed client and writes a full
 * calendar payload per client under `syncview_kasper_cal_<slug>_v1`. Nothing
 * evicted them. So the store grew with the roster and never shrank: a client
 * seen once in July still held a payload in August. The tester measured 34 of
 * these alongside a 4.6MB cache, together reaching Chrome's ~10MB per-origin
 * ceiling — at which point `localStorage.setItem` throws and the native intake
 * write that stages a new post fails.
 *
 * Round 1 saw the same pressure as a harmless console warning. It escalated to
 * blocking a core write path because nothing here was bounded.
 *
 * TWO BOUNDS, because either alone leaves a hole:
 *   - AGE clears what the reader would refuse anyway (`_kasperCalCacheRead`
 *     returns null past the TTL), so those entries are pure dead weight.
 *   - COUNT is what actually caps growth. Age alone bounds nothing when the
 *     roster is larger than the cap and every entry is fresh, which is exactly
 *     the shape a full sweep produces.
 *
 * And a failed write drops its own stale entry rather than leaving one behind:
 * a cache miss costs one fetch, a full store costs Create Post.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

const MAX = Number((INDEX.match(/const KASPER_CAL_CACHE_MAX_CLIENTS = (\d+);/) || [])[1]);
const TTL = 60 * 60 * 1000;

function makeStore(entries, opts) {
  const map = new Map(entries);
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i]; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (opts && opts.full) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
    removeItem(k) { map.delete(k); },
    _map: map,
  };
}

function run(entries, slug, opts) {
  const store = makeStore(entries, opts);
  const ctx = {
    localStorage: store,
    KASPER_CAL_CACHE_TTL: TTL,
    Date,
    JSON,
    Number,
    Math,
  };
  vm.createContext(ctx);
  vm.runInContext(
    'const KASPER_CAL_CACHE_MAX_CLIENTS = ' + MAX + ';\n'
    + grabFunc('_kasperCalCacheKey') + '\n'
    + grabFunc('_kasperCalCachePrune') + '\n'
    + grabFunc('_kasperCalCacheWrite') + '\n'
    + 'this.write = _kasperCalCacheWrite;', ctx);
  ctx.write(slug, { rows: [1, 2, 3] });
  return store._map;
}

const now = Date.now();
const entry = (ageMs) => JSON.stringify({ data: { x: 1 }, savedAt: now - ageMs });
const key = (slug) => 'syncview_kasper_cal_' + slug + '_v1';

ok(Number.isFinite(MAX) && MAX > 0, 'the cap is a real number (' + MAX + ')');

/* ---- 1. The shape that broke Create Post -------------------------------- */
{
  // 34 fresh clients, exactly what a full roster sweep leaves behind.
  const many = Array.from({ length: 34 }, (_, i) => [key('client' + i), entry(1000 * i)]);
  const after = run(many, 'newclient');
  const kasperKeys = [...after.keys()].filter(k => /^syncview_kasper_cal_.*_v1$/.test(k));
  ok(kasperKeys.length === MAX,
    'a 34-client sweep leaves exactly ' + MAX + ' entries, not 35 (saw ' + kasperKeys.length + ') -- '
    + 'THIS is the bound, and age alone would have kept all 34 because every one of them is fresh');
  ok(after.has(key('newclient')),
    'the client just written survives, which is the one the reader is about to want');
  ok(after.has(key('client0')) && !after.has(key('client33')),
    'and the survivors are the NEWEST, so eviction costs the least-recently-refreshed fetch');
}

/* ---- 2. Age, which count alone would leave behind ------------------------ */
{
  const mixed = [
    [key('fresh1'), entry(1000)],
    [key('stale1'), entry(TTL + 5000)],
    [key('stale2'), entry(TTL * 3)],
  ];
  const after = run(mixed, 'writing');
  ok(!after.has(key('stale1')) && !after.has(key('stale2')),
    'entries past the TTL are dropped even when the count is nowhere near the cap -- '
    + 'the reader would refuse them anyway, so they are pure dead weight');
  ok(after.has(key('fresh1')) && after.has(key('writing')),
    '...while live entries under the cap are untouched');
}

/* ---- 3. What must NOT be touched ---------------------------------------- */
{
  const foreign = [
    [key('a'), entry(1000)],
    ['syncview_cal_archived_v1_someclient', 'KEEP'],
    ['syncview_prod_cache_v1', 'KEEP'],
    ['syncview_auth_v1', 'ok'],
    ['syncview_kasper_cal_partial', 'KEEP'],   // prefix but no _v1 suffix
  ];
  const after = run(foreign, 'b');
  ok(after.get('syncview_cal_archived_v1_someclient') === 'KEEP'
    && after.get('syncview_prod_cache_v1') === 'KEEP'
    && after.get('syncview_auth_v1') === 'ok',
    'THE LOAD-BEARING NEGATIVE: nothing outside this cache is evicted. The archive ledger in '
    + 'particular is NOT a cache -- it holds local state that cannot be re-fetched');
  ok(after.get('syncview_kasper_cal_partial') === 'KEEP',
    'and the key pattern is anchored at both ends, so a near-miss name is not swept up');
}

/* ---- 4. A store that is full anyway ------------------------------------- */
{
  const before = [[key('old'), entry(1000)], [key('victim'), 'PREVIOUS']];
  const after = run(before, 'victim', { full: true });
  ok(!after.has(key('victim')),
    'when the write still fails, this client own stale entry is removed rather than left standing -- '
    + 'a cache miss costs one fetch, a full store costs Create Post');
  ok(after.has(key('old')),
    '...without taking unrelated live entries down with it');
}

/* ---- 5. The failure text stopped inviting a doomed retry ---------------- */

const codeText = INDEX.slice(INDEX.indexOf('native_intake_storage_unavailable: {'));
ok(/native_intake_storage_unavailable: \{/.test(INDEX),
  'the storage failure has its OWN branch now -- it had none, and fell to the generic safe-to-retry text');
ok(/run out of storage/.test(codeText.slice(0, 700)),
  'it names browser storage, which is the only thing that makes it actionable');
ok(/retrying will fail the same way/.test(codeText.slice(0, 700)),
  '...and says retrying will NOT help, because it genuinely could not: the store stays full and the '
  + 'write fails identically, forever');
ok(/Nothing was saved/.test(codeText.slice(0, 700)),
  '...and that nothing is half-made, which is the question a failed create actually raises');

console.log(failures === 0
  ? '\nKasper cache bound checks passed'
  : '\n' + failures + ' cache bound check(s) failed');
process.exit(failures === 0 ? 0 : 1);
