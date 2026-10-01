'use strict';
/*
 * SyncLinear's first-page reads start as soon as the staff check passes.
 *
 * Measured on the live site 2026-10-01: a cold open of the Linear tab started
 * its two big reads (batches, live deliverables) only after every script had
 * downloaded and the tab had mounted, about 0.3 s after the staff check
 * answered. The <head> boot script now starts the first page of each when
 * key-verify passes (and never before: qa/boot/staff-entry-gate.js holds the
 * rule that a rejected check loads no staff data), and the app takes each
 * answer once, by exact URL.
 *
 * This suite pins three things:
 *   1. the head's URLs are byte-for-byte the URLs the app's own first page
 *      asks for (its select lists and live filter are COPIES, so this is the
 *      only thing keeping them honest);
 *   2. the head waits for the early key-verify and only runs when it predicts the Linear tab;
 *   3. the SHIPPED taker hands an early answer over only for the same member
 *      and key, once, inside a minute, and only a successful answer is used.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src/index/210-production-state-writes.js.part'), 'utf8');
const HEAD_SRC = fs.readFileSync(path.join(ROOT, 'src/index/005-head-boot.html.part'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

// The head block, from its own marker to the end of its try.
const startAt = HEAD_SRC.indexOf('var pdId = JSON.parse');
ok(startAt > 0, 'the head carries the SyncLinear early-read block');
const block = HEAD_SRC.slice(startAt, HEAD_SRC.indexOf('} catch (e) {}', startAt));

// 1. URLs match the app's own first page.
const appBatchSelect = (SRC.match(/const PROD_BATCH_SELECT = '([^']+)'/) || [])[1];
const appDeliverableSelect = (SRC.match(/const PROD_DELIVERABLE_SELECT = '([^']+)'/) || [])[1];
const headBatchSelect = (block.match(/\/rest\/v1\/batches\?select=' \+ encodeURIComponent\('([^']+)'\)/) || [])[1];
const headDeliverableSelect = (block.match(/production_deliverables_browser_v1\?select=' \+ encodeURIComponent\('([^']+)'\)/) || [])[1];
ok(appBatchSelect && appBatchSelect === headBatchSelect, 'the head asks for exactly PROD_BATCH_SELECT');
ok(appDeliverableSelect && appDeliverableSelect === headDeliverableSelect, 'and exactly PROD_DELIVERABLE_SELECT');
const terminal = (SRC.match(/const PROD_CACHE_TERMINAL = \[([^\]]+)\]/) || [])[1].replace(/['\s]/g, '');
const headFilter = (block.match(/&or=\(status\.not\.in\.\(([^)]+)\),status\.is\.null\)'\);/) || [])[1];
ok(headFilter === terminal, 'the live filter lists exactly PROD_CACHE_TERMINAL, in order');
ok(/const PROD_LIVE_FILTER = 'or=\(status\.not\.in\.\(' \+ PROD_CACHE_TERMINAL\.join\(','\) \+ '\),status\.is\.null\)';/.test(SRC),
  'and the app still builds PROD_LIVE_FILTER in that same shape');
ok(/&limit=1000&order=id\.asc/.test(block) && /_prodRestRows\('batches', PROD_BATCH_SELECT, '', 1000, 25, \{ keysetColumn: 'id' \}\)/.test(fs.readFileSync(path.join(ROOT, 'src/index/250-production-controls-data.js.part'), 'utf8')),
  'both are the first page of a 1,000-row keyset walk, as the loader asks');
ok(/apikey: pdKey, Authorization: 'Bearer ' \+ pdKey, Accept: 'application\/json'/.test(block)
  && /function _prodHeaders\(\) \{\s*return \{ apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' \+ CAL_SUPABASE_ANON_KEY, Accept: 'application\/json' \};/.test(SRC),
  'with the same headers the app sends');

// 2. Gated on the staff check, only when the landing tab is the Linear tab.
ok(HEAD_SRC.lastIndexOf("if (target === 'production' && window.fetch) {", startAt) > HEAD_SRC.lastIndexOf("if (target === 'today' && window.fetch) {", startAt)
  && HEAD_SRC.lastIndexOf("if (target === 'production' && window.fetch) {", startAt) < startAt,
  'only when the head predicts the Linear tab as the landing page, in its own branch (not inside Today\'s)');
ok(/window\.__svEarlyKeyVerify/.test(block) && /pdGate\.then\(function \(\) \{ return fetch\(url/.test(block),
  'each request waits for the early key-verify to pass before it is sent');
ok(/if \(!\(j && j\.ok === true\)\) throw new Error\('verify'\)/.test(block) && /Promise\.reject\(new Error\('verify'\)\)/.test(block),
  'a rejected, malformed or missing check sends nothing');
ok(HEAD_SRC.indexOf('__svEarlyKeyVerify = {') < startAt, 'and it sits after the early key-verify is started');

// 3. The shipped taker, against a fake window.
function grabFn(name) {
  const at = INDEX.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
const takerSrc = grabFn('_prodTakeEarlyRead');
const URL1 = 'https://example.test/rest/v1/batches?x=1';
function take(early, identity, now) {
  const ctx = { window: { __svEarlyProd: early }, Date: { now: () => now || 1000 },
    _syncviewStaffIdentityForHeaders: () => identity };
  vm.createContext(ctx);
  vm.runInContext(takerSrc + '\nthis.take = _prodTakeEarlyRead;', ctx);
  return { result: ctx.take(URL1), left: ctx.window.__svEarlyProd };
}
const id = { key: 'k1', role: 'admin', member: { id: 'm1', name: 'Staff One' } };
const seed = extra => Object.assign({ memberId: 'm1', key: 'k1', at: 900, reads: { [URL1]: 'P' } }, extra || {});

let r = take(seed(), id);
ok(r.result === 'P', 'same member and key within a minute: the early read is handed over');
ok(!(URL1 in r.left.reads), 'and removed, so it can only be taken once');
ok(take(seed(), id).result === 'P' && take({ memberId: 'm1', key: 'k1', at: 900, reads: {} }, id).result === null, 'a URL that was not started is a miss');
ok(take(seed({ memberId: 'm2' }), id).result === null, 'a different member is refused');
ok(take(seed({ key: 'other' }), id).result === null, 'a different key is refused');
ok(take(seed({ at: 900 }), id, 61000).result === null, 'an answer older than a minute is refused');
ok(take(seed(), null).result === null, 'a page with no verified identity is refused');
ok(take(null, id).result === null, 'and no early record at all is a miss');

// 4. The page reader: only a genuine answer is reused, everything else is re-asked.
const pageSrc = INDEX.slice(INDEX.search(/async\s+function\s+_prodRestPage\s*\(/));
const pageFn = pageSrc.slice(0, (() => { let d = 0; for (let j = pageSrc.indexOf('{'); j < pageSrc.length; j++) { if (pageSrc[j] === '{') d++; else if (pageSrc[j] === '}' && --d === 0) return j + 1; } })());
async function readPage(page, early, fetchImpl) {
  let calls = 0;
  const ctx = {
    _prodTakeEarlyRead: () => early, _prodHeaders: () => ({}), _prodSleep: () => Promise.resolve(),
    fetch: (...a) => { calls++; return fetchImpl(...a); }, Error, Promise, Math
  };
  vm.createContext(ctx);
  vm.runInContext(pageFn + '\nthis.read = _prodRestPage;', ctx);
  const rows = await ctx.read('u', 'batches', page);
  return { rows, calls };
}
const goodResp = { ok: true, status: 200, json: async () => [{ id: 'early' }] };
const netResp = { ok: true, status: 200, json: async () => [{ id: 'net' }] };
(async () => {
  let x = await readPage(0, Promise.resolve(goodResp), async () => netResp);
  ok(x.rows[0].id === 'early' && x.calls === 0, 'a successful early answer is used and no second request is made');
  x = await readPage(0, Promise.resolve({ ok: false, status: 500, json: async () => ({}) }), async () => netResp);
  ok(x.rows[0].id === 'net' && x.calls === 1, 'a server error is re-asked through the normal read');
  x = await readPage(0, Promise.reject(new Error('down')), async () => netResp);
  ok(x.rows[0].id === 'net' && x.calls === 1, 'a failed early request is re-asked through the normal read');
  x = await readPage(0, Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }), async () => netResp);
  ok(x.rows[0].id === 'net' && x.calls === 1, 'an unreadable early body is re-asked through the normal read');
  x = await readPage(1, Promise.resolve(goodResp), async () => netResp);
  ok(x.rows[0].id === 'net' && x.calls === 1, 'only the first page ever takes an early answer');
  console.log('\nsynclinear-early-read: ' + passed + ' checks passed ✅');
})().catch(e => { console.error(e); process.exit(1); });
