'use strict';
/*
 * OPEN_REPAIRS item 86 — the Sheets webhook answers 200 for clients who
 * demonstrably have cards, and the browser believed it.
 *
 * Measured live 2026-08-30, three clients the tester named:
 *   two returned HTTP 200 with a ZERO-BYTE body; one returned {ok:true,posts:[]}
 *   against 32, 17 and 24 non-archived calendar_posts rows respectively,
 *   updated as recently as that morning.
 *
 * The empty body already threw at resp.json(). The posts:[] shape did not, and
 * a zero-row census is indistinguishable downstream from a client who genuinely
 * has nothing -- so it became calState.posts AND was written to the localStorage
 * cache, meaning one bad fallback could blank a calendar and keep it blank
 * across a cold load. On the Kasper side the same answer dropped a client out
 * of the review queue with no notice at all, which looks exactly like that
 * client having no work.
 *
 * Both readers now treat a zero-row webhook answer as a FAILED READ. This suite
 * executes the shipped fallbacks against the three measured response shapes.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name, from) {
  const at = INDEX.indexOf(from || ('function ' + name + '('));
  if (at < 0) throw new Error('not found: ' + name);
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
  throw new Error('unbalanced: ' + name);
}

/* The three shapes, exactly as measured. */
const ZERO_BYTE = { ok: true, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
const EMPTY_POSTS = { ok: true, json: async () => ({ ok: true, posts: [] }) };
const REAL = { ok: true, json: async () => ({ ok: true, posts: [{ id: 'p1' }, { id: 'p2' }] }) };
const NOT_OK = { ok: true, json: async () => ({ ok: false }) };

/* ---- the calendar reader ------------------------------------------------ */
const calFn = grabFunc('_calV2FetchPosts', 'async function _calV2FetchPosts(');
function calSandbox(webhookResponse) {
  const cacheWrites = [];
  const fn = new Function('deps', `
    const { CAL_SUPABASE_URL, CALENDAR_GET_URL, _calSupabaseFetchAllRows, fetch, console, encodeURIComponent, Date } = deps;
    ${calFn}
    return _calV2FetchPosts;
  `)({
    CAL_SUPABASE_URL: 'https://stub.invalid',
    CALENDAR_GET_URL: 'https://stub.invalid/webhook/calendar-get',
    // Supabase always fails here: the webhook fallback is what is under test.
    _calSupabaseFetchAllRows: async () => { throw new Error('supabase down'); },
    fetch: async () => webhookResponse,
    console: { warn() {} },
    encodeURIComponent, Date,
  });
  return { fn, cacheWrites };
}

(async () => {
  for (const [label, resp] of [['a zero-byte 200', ZERO_BYTE], ['an {ok:true,posts:[]} 200', EMPTY_POSTS], ['an {ok:false} 200', NOT_OK]]) {
    let threw = false;
    try { await calSandbox(resp).fn('alaynabellquist'); } catch (e) { threw = true; }
    ok(threw, `the calendar reader treats ${label} as a FAILED read, not as an empty calendar`);
  }
  {
    const out = await calSandbox(REAL).fn('alaynabellquist');
    ok(out && Array.isArray(out.posts) && out.posts.length === 2,
      'a fallback that actually carries cards is still returned and used');
  }

  /* ---- the Kasper reader ------------------------------------------------ */
  const loader = grabFunc('_kasperFetchAllRelevantPosts');
  const oneAt = loader.indexOf('const fetchOne = async (client) => {');
  ok(oneAt >= 0, 'the Kasper per-client fallback exists');
  let d = 0, end = -1;
  for (let i = loader.indexOf('{', oneAt); i < loader.length; i++) {
    const c = loader[i];
    if (c === '{') d++;
    else if (c === '}' && --d === 0) { end = i + 1; break; }
  }
  const oneSrc = loader.slice(oneAt, end) + ';';

  function kasperSandbox(webhookResponse) {
    const cacheWrites = [];
    const fn = new Function('deps', `
      const { wlNormalizeClient, _kasperCalCacheRead, _kasperCalCacheWrite, extract,
              CALENDAR_GET_URL, fetch, encodeURIComponent, Date, forceRefresh } = deps;
      ${oneSrc}
      return fetchOne;
    `)({
      wlNormalizeClient: n => String(n).toLowerCase().replace(/[^a-z0-9&]+/g, ''),
      _kasperCalCacheRead: () => null,
      _kasperCalCacheWrite: (slug, json) => cacheWrites.push({ slug, count: (json.posts || []).length }),
      extract: (client, json) => ({ queue: (json.posts || []).map(p => ({ post: p })), history: [], replies: [], stranded: [] }),
      CALENDAR_GET_URL: 'https://stub.invalid/webhook/calendar-get',
      fetch: async () => webhookResponse,
      encodeURIComponent, Date,
      forceRefresh: true,
    });
    return { fn, cacheWrites };
  }

  for (const [label, resp] of [['a zero-byte 200', ZERO_BYTE], ['an {ok:true,posts:[]} 200', EMPTY_POSTS]]) {
    const sb = kasperSandbox(resp);
    let threw = false;
    try { await sb.fn('Alayna Bellquist'); } catch (e) { threw = true; }
    ok(threw, `the Kasper fallback rejects on ${label} instead of returning an empty queue`);
    ok(sb.cacheWrites.length === 0, `and caches nothing, so ${label} cannot poison the next five minutes`);
  }
  {
    const sb = kasperSandbox(REAL);
    const out = await sb.fn('Alayna Bellquist');
    ok(out.queue.length === 2, 'a real answer still populates the queue');
    ok(sb.cacheWrites.length === 1 && sb.cacheWrites[0].count === 2,
      'and only a non-empty truth is cached');
  }

  /* ---- the failure is reported, not swallowed --------------------------- */
  ok(/settled\.push\(\{ status: 'rejected', reason, client \}\)/.test(INDEX),
    'a rejected client load carries WHICH client it was');
  ok(/if \(s\.status === 'rejected' && s\.client/.test(INDEX),
    'and the aggregator collects those names instead of skipping them');
  ok(/_kasperRenderUnloadedNotice\(\) \+ _kasperRenderStrandedNotice\(\)/.test(INDEX),
    'and the queue paints a notice for them above everything else');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\ncalendar-get empty-200 checks passed');
})();
