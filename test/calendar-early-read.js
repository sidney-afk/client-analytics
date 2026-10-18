'use strict';
/*
 * Calendar's and Samples' first card read starts as soon as the staff check passes.
 *
 * Speed sweep 2026-10-17: a cold open of /calendar/<slug> started the card
 * read (calendar_posts for that client) only after every script had loaded,
 * about 1.08 s in. The <head> boot script now starts its first page when
 * key-verify passes (never before: qa/boot/staff-entry-gate.js holds the rule
 * that a rejected check loads no staff data), the same way Today and SyncLinear
 * do, and the page takes that answer once, by exact URL.
 *
 * This suite pins:
 *   1. the head's URL and headers are byte-for-byte the first page the app's
 *      own reader asks for (_calV2FetchPosts + _calSupabaseFetchAllRows);
 *   2. the head waits for the early key-verify, only for a Calendar landing
 *      that names a well-formed client;
 *   3. the SHIPPED taker hands the answer over only for the same URL, member
 *      and key, once, inside ten seconds;
 *   4. the SHIPPED reader uses only a genuine answer on page 0, and re-asks
 *      anything else through its normal request.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src/index/150-calendar-hydration-import.js.part'), 'utf8');
const HEAD_SRC = fs.readFileSync(path.join(ROOT, 'src/index/005-head-boot.html.part'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

const startAt = HEAD_SRC.indexOf('var clId = JSON.parse');
ok(startAt > 0, 'the head carries the Calendar early-read block');
const block = HEAD_SRC.slice(startAt, HEAD_SRC.indexOf('} catch (e) {}', startAt));

// 1. The URL is the app's own first page, with the app's headers.
const appBase = (SRC.match(/const baseUrl = CAL_SUPABASE_URL \+ '(\/rest\/v1\/calendar_posts\?select=\*&or=\(status\.is\.null,status\.neq\.Archived\)&client=eq\.)' \+ encodeURIComponent\(slug\);/) || [])[1];
const headRest = (block.match(/clBase \+ '\/rest\/v1\/' \+ clTable \+ '(\?[^']+)' \+ encodeURIComponent\(clSlug\)/) || [])[1];
ok(/var clTable = target === 'calendar' \? 'calendar_posts' : 'sample_reviews';/.test(block), 'Calendar reads calendar_posts and Samples reads sample_reviews');
ok(appBase && appBase === '/rest/v1/calendar_posts' + headRest, 'the head asks for exactly _calV2FetchPosts\'s base URL');
const SXR_SRC = fs.readFileSync(path.join(ROOT, 'src/index/270-samples-model.js.part'), 'utf8');
ok(/const SXR_TABLE\s*= 'sample_reviews';/.test(SXR_SRC)
  && SXR_SRC.includes("const baseUrl = CAL_SUPABASE_URL + '/rest/v1/' + SXR_TABLE + '" + headRest + "' + encodeURIComponent(slug);")
  && /const _sxrSupabaseFetchAllRows = _calSupabaseFetchAllRows;/.test(SXR_SRC)
  && /const _sxrNormalizeClient = wlNormalizeClient;/.test(SXR_SRC),
  'and exactly _sxrFetchPosts\'s, which pages through the same reader and slugs clients the same way');
ok(/\+ '&order=id\.asc,client\.asc&limit=1000';/.test(block)
  && /let pageUrl = baseUrl \+ sep \+ 'order=id\.asc,client\.asc&limit=' \+ CAL_SUPABASE_PAGE;/.test(SRC)
  && /const CAL_SUPABASE_PAGE = 1000;/.test(SRC),
  'and the same first keyset page, order and size');
ok(/headers: \{ apikey: clKey, Authorization: 'Bearer ' \+ clKey, Accept: 'application\/json' \}/.test(block)
  && /const headers = \{ apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' \+ CAL_SUPABASE_ANON_KEY, Accept: 'application\/json' \};/.test(SRC),
  'with the same headers');
const appUrl = (INDEX.match(/const CAL_SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
const appKey = (INDEX.match(/const CAL_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
ok(appUrl && block.includes("var clBase = '" + appUrl + "'") && appKey && block.includes("var clKey = '" + appKey + "'"),
  'against the same project, with the same browser key');

// 2. Gated on the staff check, only for a Calendar landing naming a client.
ok(HEAD_SRC.lastIndexOf("if ((target === 'calendar' || target === 'sample-reviews') && window.fetch) {", startAt) > HEAD_SRC.lastIndexOf("if (target === 'production' && window.fetch) {", startAt),
  'only when the head predicts the Calendar or Samples tab, in its own branch');
ok(/window\.__svEarlyKeyVerify/.test(block) && /clGate\.then\(function \(\) \{ return fetch\(clUrl/.test(block)
  && /if \(!\(j && j\.ok === true\)\) throw new Error\('verify'\)/.test(block) && /Promise\.reject\(new Error\('verify'\)\)/.test(block),
  'the request waits for the early key-verify to pass; a rejected, malformed or missing check sends nothing');
ok(/\/\^\[a-z0-9&\]\+\$\/\.test\(clSlug\)/.test(block), 'and only for an address naming a well-formed client slug');

// 3. The shipped taker.
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
const U = 'https://example.test/rest/v1/calendar_posts?x=1';
function take(early, identity, now, url) {
  const ctx = { window: { __svEarlyCalendar: early }, Date: { now: () => now || 1000 }, String,
    _syncviewStaffIdentityForHeaders: () => identity };
  vm.createContext(ctx);
  vm.runInContext(grabFn('_calTakeEarlyPostsPage') + '\nthis.take = _calTakeEarlyPostsPage;', ctx);
  return { result: ctx.take(url || U), left: ctx.window.__svEarlyCalendar };
}
const id = { key: 'k1', role: 'smm', member: { id: 'm1', name: 'Staff One' } };
const seed = extra => Object.assign({ memberId: 'm1', key: 'k1', at: 900, url: U, response: 'P' }, extra || {});
let r = take(seed(), id);
ok(r.result === 'P' && r.left === null, 'same URL, member and key within ten seconds: handed over, and only once');
ok(take(seed(), id, 1000, U + '&y=2').result === null, 'a different URL is a miss');
ok(take(seed({ memberId: 'm2' }), id).result === null, 'a different member is refused');
ok(take(seed({ key: 'other' }), id).result === null, 'a different key is refused');
ok(take(seed(), id, 11000).result === null, 'an answer older than ten seconds is refused');
ok(take(seed(), null).result === null, 'a page with no verified identity is refused');
ok(take(null, id).result === null, 'and no early record at all is a miss');

// 4. The shipped reader.
const readerSrc = INDEX.slice(INDEX.search(/async\s+function\s+_calSupabaseFetchAllRows\s*\(/));
const readerFn = readerSrc.slice(0, (() => { let d = 0; for (let j = readerSrc.indexOf('{'); j < readerSrc.length; j++) { if (readerSrc[j] === '{') d++; else if (readerSrc[j] === '}' && --d === 0) return j + 1; } })());
async function read(early, fetchImpl) {
  const urls = [];
  const ctx = {
    CAL_SUPABASE_ANON_KEY: 'k', CAL_SUPABASE_PAGE: 1000, encodeURIComponent, Error, Array, DOMException,
    _calTakeEarlyPostsPage: (url) => { urls.push('take:' + url); return early; },
    fetch: async (url) => { urls.push('fetch:' + url); return fetchImpl(url); },
  };
  vm.createContext(ctx);
  vm.runInContext(readerFn + '\nthis.read = _calSupabaseFetchAllRows;', ctx);
  const rows = await ctx.read('https://example.test/rest/v1/calendar_posts?select=*', null);
  return { rows, urls };
}
const resp = (rows, okFlag = true) => ({ ok: okFlag, status: okFlag ? 200 : 500, json: async () => rows });
(async () => {
  let x = await read(Promise.resolve(resp([{ id: 'early', client: 'c' }])), async () => resp([{ id: 'net', client: 'c' }]));
  ok(x.rows[0].id === 'early' && !x.urls.some(u => u.startsWith('fetch:')), 'a genuine early answer is used and no second request is made');
  ok(x.urls[0] === 'take:https://example.test/rest/v1/calendar_posts?select=*&order=id.asc,client.asc&limit=1000', 'it is asked for by the exact first-page URL');
  x = await read(Promise.resolve(resp([], false)), async () => resp([{ id: 'net', client: 'c' }]));
  ok(x.rows[0].id === 'net', 'a server error is re-asked through the normal read');
  x = await read(Promise.reject(new Error('down')), async () => resp([{ id: 'net', client: 'c' }]));
  ok(x.rows[0].id === 'net', 'a failed early request is re-asked');
  x = await read(Promise.resolve({ ok: true, json: async () => { throw new Error('bad'); } }), async () => resp([{ id: 'net', client: 'c' }]));
  ok(x.rows[0].id === 'net', 'an unreadable early body is re-asked');
  const full = Array.from({ length: 1000 }, (_, i) => ({ id: 'e' + String(i).padStart(4, '0'), client: 'c' }));
  x = await read(Promise.resolve(resp(full)), async () => resp([{ id: 'z', client: 'c' }]));
  ok(x.rows.length === 1001 && x.urls.filter(u => u.startsWith('take:')).length === 1,
    'a full first page still walks on, and only the first page ever takes an early answer');
  console.log('\ncalendar-early-read: ' + passed + ' checks passed ✅');
})().catch(e => { console.error(e); process.exit(1); });
