'use strict';
/*
 * n8n exit, phase 2 step F: the n8n read fallbacks (calendar-get, sample-review-get,
 * kasper-queue) are gone from the page. Replaces calendar-get-empty-200.js, which pinned the
 * old webhook fallback's zero-row guard (OPEN_REPAIRS item 86).
 *
 * The replacement is: a failed Supabase read is tried once more after a short wait; if it
 * still fails the reader throws, and the caller keeps the cards or saved copy it already has
 * and says the data is unavailable. This suite runs the shipped functions with a Supabase that
 * always fails and proves (1) the recovery, (2) the message, (3) zero n8n requests.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let checks = 0, failures = 0;
function ok(condition, message) {
  checks++;
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(from) {
  const at = INDEX.indexOf(from);
  if (at < 0) throw new Error('not found: ' + from);
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
  throw new Error('unbalanced: ' + from);
}

const retrySrc = grabFunc('async function _svReadWithRetry(');
const calSrc = grabFunc('async function _calV2FetchPosts(');
const sxrSrc = grabFunc('async function _sxrFetchPosts(');
const UNAVAILABLE = 'The data is unavailable right now. Try again in a moment.';

function world(readImpl) {
  const net = { n8n: [], supabaseCalls: 0 };
  const deps = {
    CAL_SUPABASE_URL: 'https://db.invalid', SXR_TABLE: 'sample_reviews',
    SV_READ_RETRY_WAIT_MS: 0, SV_READ_UNAVAILABLE_TEXT: UNAVAILABLE,
    _calSupabaseFetchAllRows: async () => { net.supabaseCalls++; return readImpl(net.supabaseCalls); },
    _sxrSupabaseFetchAllRows: async () => { net.supabaseCalls++; return readImpl(net.supabaseCalls); },
    fetch: async (u) => { net.n8n.push(String(u)); throw new Error('no network expected'); },
    console: { warn() {} }, setTimeout, encodeURIComponent, Error, Promise,
  };
  const make = new Function('d', `
    const { CAL_SUPABASE_URL, SXR_TABLE, SV_READ_RETRY_WAIT_MS, SV_READ_UNAVAILABLE_TEXT, _calSupabaseFetchAllRows,
            _sxrSupabaseFetchAllRows, fetch, console, setTimeout, encodeURIComponent, Error, Promise } = d;
    ${retrySrc}
    ${calSrc}
    ${sxrSrc}
    return { _svReadWithRetry, _calV2FetchPosts, _sxrFetchPosts };
  `);
  return { fns: make(deps), net };
}

(async () => {
  // --- the retry itself ---
  { const w = world(() => 1);
    let calls = 0;
    const r = await w.fns._svReadWithRetry(async () => { calls++; if (calls === 1) throw new Error('blip'); return 'rows'; }, { waitMs: 0 });
    ok(r === 'rows' && calls === 2, 'one failure then success returns the rows after exactly one retry'); }
  { const w = world(() => 1);
    let calls = 0, msg = '';
    try { await w.fns._svReadWithRetry(async () => { calls++; throw new Error('down'); }, { waitMs: 0 }); } catch (e) { msg = e.message; }
    ok(calls === 2 && msg === UNAVAILABLE, 'two failures stop after two tries and say the data is unavailable'); }
  { const w = world(() => 1);
    let calls = 0, name = '';
    try { await w.fns._svReadWithRetry(async () => { calls++; const e = new Error('x'); e.name = 'AbortError'; throw e; }, { waitMs: 0 }); } catch (e) { name = e.name; }
    ok(calls === 1 && name === 'AbortError', 'an abort is never retried'); }

  // --- Calendar reader ---
  { const w = world(() => { throw new Error('supabase down'); });
    let msg = '';
    try { await w.fns._calV2FetchPosts('testclient'); } catch (e) { msg = e.message; }
    ok(msg === UNAVAILABLE, 'Calendar: Supabase down on both tries throws the unavailable message');
    ok(w.net.supabaseCalls === 2, 'Calendar: it tried Supabase exactly twice');
    ok(w.net.n8n.length === 0, 'Calendar: zero n8n requests while Supabase is down'); }
  { const w = world((n) => { if (n === 1) throw new Error('blip'); return [{ id: 'p1' }]; });
    const out = await w.fns._calV2FetchPosts('testclient');
    ok(out.ok === true && out.posts.length === 1 && w.net.n8n.length === 0, 'Calendar: a one second blip recovers on the retry with no n8n request');
    const empty = await world(() => []).fns._calV2FetchPosts('testclient');
    ok(empty.ok === true && empty.posts.length === 0, 'Calendar: a real empty answer from Supabase is returned as empty, not as a failure'); }

  // --- Samples reader ---
  { const w = world(() => { throw new Error('supabase down'); });
    let msg = '';
    try { await w.fns._sxrFetchPosts('testclient'); } catch (e) { msg = e.message; }
    ok(msg === UNAVAILABLE && w.net.supabaseCalls === 2 && w.net.n8n.length === 0, 'Samples: Supabase down throws the unavailable message after two tries and sends nothing to n8n'); }
  { const w = world((n) => { if (n === 1) throw new Error('blip'); return [{ id: 's1' }]; });
    const out = await w.fns._sxrFetchPosts('testclient');
    ok(out.ok === true && out.posts.length === 1 && w.net.n8n.length === 0, 'Samples: a blip recovers on the retry with no n8n request'); }

  // --- Kasper per-client reader ---
  { const loader = grabFunc('async function _kasperFetchAllRelevantPosts(').length ? grabFunc('async function _kasperFetchAllRelevantPosts(') : '';
    ok(loader.includes('_calV2FetchPosts(slug)'), 'Kasper: the per-client read is the Supabase reader');
    ok(!/KASPER_QUEUE_URL|kasper-queue/.test(loader), 'Kasper: the kasper-queue batch call is gone'); }

  // --- the page no longer names the three webhooks at all ---
  for (const hook of ['webhook/calendar-get', 'webhook/sample-review-get', 'webhook/kasper-queue']) {
    ok(!INDEX.includes(hook), 'index.html has no ' + hook + ' call');
  }
  ok(!/CALENDAR_GET_URL|SXR_GET_URL|KASPER_QUEUE_URL/.test(INDEX), 'the three URL constants are gone');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('read-fallbacks-retired: ' + checks + ' checks passed ✅');
})().catch((e) => { console.error(e); process.exit(1); });
