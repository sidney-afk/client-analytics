'use strict';
/*
 * n8n exit, PR 2: every staff Calendar write, reorder and confirmation read goes
 * to the Supabase functions and NEVER to n8n, behind a fresh, bounded flag read.
 *
 * Fully mocked (no live backend). Every request to n8n.cloud is recorded and
 * asserted empty for each operation, and every flag read is counted so "each
 * write starts its own read" is a measured fact, not a comment.
 *
 * Covers the plan's list: a flag that lists the client (sends to the function),
 * a client removed from the flag between two writes (refused on the very next
 * write, no cache), a flag read that fails, times out, is malformed or is
 * absent (the save is HELD and nothing is sent anywhere), a Supabase-pinned
 * retry made right after the client is removed, a tab whose realtime channel is
 * disconnected (the sandbox cannot open one, and the guard never relies on it),
 * the reorder, and the confirmation read. The only n8n call left on this path is
 * a staff repair already pinned `webhook`, asserted as exactly that.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const ROOT = path.resolve(__dirname, '..');
const SLUG = 'fixtureclient';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

function serve() {
  const server = http.createServer((req, res) => {
    let file;
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      file = path.resolve(ROOT, decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1)));
    } catch (_) { res.writeHead(400).end(); return; }
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end(); return;
    }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 900 } });
  const errors = [];
  const state = {
    flag: 'list',            // list | empty | http500 | hang | malformed | absent
    flagReads: 0,
    efWrites: [],            // calendar-upsert POSTs
    efReorders: [],          // calendar-reorder POSTs
    n8n: [],                 // every request to n8n.cloud, boot included
    calendarGets: 0,
    armed: false,
    guardUrls: [],
    verifyUrls: [],
    flagHang: null,
  };
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (url.origin === origin) return route.continue();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (/n8n\.cloud$/.test(url.hostname)) {
        state.n8n.push(method + ' ' + url.pathname);
        if (url.pathname === '/webhook/calendar-get') state.calendarGets++;
        return json(route, { ok: true, posts: [] });
      }
      if (url.pathname === '/rest/v1/syncview_runtime_flags' && method === 'GET') {
        const raw = url.searchParams.get('key') || '';
        const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
        // Boot reads happen before any window is armed; inside a window the
        // only single-flag read of this key is the write guard's own.
        const isWriteGuardRead = state.armed && keys.length === 1 && keys[0] === 'calendar_upsert_ef_clients';
        if (isWriteGuardRead) {
          state.flagReads++;
          state.guardUrls.push(url.search);
          if (state.flag === 'http500') return json(route, { message: 'fixture failure' }, 500);
          if (state.flag === 'hang') { await new Promise(resolve => { state.flagHang = resolve; }); return route.abort(); }
          if (state.flag === 'malformed') return json(route, [{ key: keys[0], value: { unexpected: true } }]);
          if (state.flag === 'absent') return json(route, []);
          if (state.flag === 'empty') return json(route, [{ key: keys[0], value: { clients: [] } }]);
          return json(route, [{ key: keys[0], value: { clients: [SLUG] } }]);
        }
        const values = {
          calendar_upsert_ef_clients: { clients: [SLUG] },
          write_ui_reroute_clients: { clients: [SLUG] },
          prod_authority: { video: 'syncview', graphics: 'syncview' },
        };
        return json(route, keys.filter(key => Object.hasOwn(values, key)).map(key => ({ key, value: values[key] })));
      }
      if (url.pathname === '/functions/v1/calendar-upsert' && method === 'POST') {
        state.efWrites.push({ body: JSON.parse(request.postData() || '{}'), headers: request.headers() });
        return json(route, { ok: true, post: {} });
      }
      if (url.pathname === '/functions/v1/calendar-reorder' && method === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        state.efReorders.push(body);
        return json(route, { ok: true, updated: (body.items || []).length });
      }
      if (url.pathname === '/rest/v1/calendar_posts' && method === 'GET') { if (state.armed) state.verifyUrls.push(url.search); return json(route, []); }
      if (url.pathname === '/rest/v1/clients' && method === 'GET') {
        return json(route, [{ slug: SLUG, display_name: 'Fixture Client', kind: 'client', active: true }]);
      }
      if (url.pathname.startsWith('/rest/v1/') && method === 'GET') return json(route, []);
      if (url.pathname.startsWith('/functions/v1/')) return json(route, { ok: true });
      if (url.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
      return route.abort();
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 180)));
    await seedStaffGate(page);
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _calUpsertFetch === 'function' && typeof persistCalReorder === 'function'
      && typeof _calFetchPostsForVerify === 'function', null, { timeout: 30000 });
    await page.waitForTimeout(1500);   // let the boot flag reads settle

    const window_ = async (label, work) => {
      const before = { n8n: state.n8n.length, reads: state.flagReads, ef: state.efWrites.length, re: state.efReorders.length };
      state.armed = true;
      const result = await work();
      state.armed = false;
      return { label, result,
        n8n: state.n8n.slice(before.n8n), reads: state.flagReads - before.reads,
        ef: state.efWrites.length - before.ef, re: state.efReorders.length - before.re };
    };
    const save = (kind, id) => page.evaluate(async ({ slug, id }) => {
      try {
        const resp = await _calUpsertFetch(slug, { client: slug, post: { id, name: 'Fixture' } }, 'ui');
        return { sent: true, status: resp.status };
      } catch (e) { return { sent: false, code: e && e.code, held: !!(e && e.calWriteHeld), paused: !!(e && e.calWritePaused), message: String(e && e.message) }; }
    }, { slug: SLUG, id });
    const pinned = (transport, id) => page.evaluate(async ({ slug, id, transport }) => {
      try {
        const resp = await _calUpsertFetchPinned(slug, { client: slug, post: { id, name: 'Fixture' } }, 'ui', transport);
        return { sent: true, status: resp.status };
      } catch (e) { return { sent: false, code: e && e.code, held: !!(e && e.calWriteHeld), paused: !!(e && e.calWritePaused) }; }
    }, { slug: SLUG, id, transport });

    // 1. A flag that lists the client sends to the function, after its own read.
    state.flag = 'list';
    let r = await window_('listed', () => save('a', 'card-1'));
    ok(r.result.sent && r.ef === 1 && r.reads === 1 && r.n8n.length === 0,
      'listed client: one fresh flag read, one calendar-upsert function POST, zero n8n requests');
    ok(state.efWrites[0] && !!state.efWrites[0].headers['x-syncview-key'] && state.efWrites[0].headers['x-syncview-source'] === 'ui' && state.efWrites[0].headers['x-syncview-role'] !== 'client',
      'the function request keeps its staff identity headers');

    // 2. Two writes make two reads: nothing is cached or shared.
    r = await window_('two writes', async () => {
      const a = save('a', 'card-2'); const b = save('a', 'card-3');
      return Promise.all([a, b]);
    });
    ok(r.ef === 2 && r.reads === 2 && r.n8n.length === 0, 'two overlapping writes each start their own flag read (2 reads, 2 sends)');

    // 3. A client removed between two writes is refused on the very next one.
    state.flag = 'list';
    r = await window_('before removal', () => save('a', 'card-4'));
    state.flag = 'empty';
    r = await window_('after removal', () => save('a', 'card-5'));
    ok(!r.result.sent && r.result.paused && r.ef === 0 && r.n8n.length === 0 && r.reads === 1,
      'removed from the flag: the very next write is refused as "saving paused", nothing sent, zero n8n');
    ok(/paused/i.test(r.result.message), 'the refusal carries a visible message: ' + r.result.message);

    // 4. A Supabase-pinned retry right after removal (and right after a good read) is held too.
    state.flag = 'list';
    await window_('good read', () => save('a', 'card-6'));
    state.flag = 'empty';
    r = await window_('pinned supabase after removal', () => pinned('supabase', 'card-7'));
    ok(!r.result.sent && r.result.paused && r.ef === 0 && r.n8n.length === 0,
      'a supabase-pinned retry made right after removal is held, not sent');

    // 5. A pinned webhook repair is the ONE remaining n8n call, replayed as pinned.
    state.flag = 'list';
    r = await window_('pinned webhook', () => pinned('webhook', 'card-8'));
    ok(r.result.sent && r.n8n.length === 1 && r.n8n[0] === 'POST /webhook/calendar-upsert-post' && r.ef === 0,
      'a repair already pinned webhook still replays to its pinned writer (the only n8n call left, until the on-load migration moves it)');

    // 6. A flag that fails, is malformed or is absent HOLDS the save. Nothing goes anywhere.
    for (const mode of ['http500', 'malformed', 'absent']) {
      state.flag = mode;
      r = await window_(mode, () => save('a', 'card-9'));
      ok(!r.result.sent && r.result.held && r.ef === 0 && r.n8n.length === 0 && r.reads === 3,
        mode + ': the read is retried (3 fresh reads), the save is HELD, nothing sent to the function or n8n');
    }

    // 7. A flag read that never answers times out and holds.
    state.flag = 'hang';
    const t0 = Date.now();
    r = await window_('hang', () => save('a', 'card-10'));
    if (state.flagHang) state.flagHang();
    ok(!r.result.sent && r.result.held && r.result.code === 'authority_unavailable' && r.ef === 0 && r.n8n.length === 0,
      'a flag read that never answers times out and holds the save (' + (Date.now() - t0) + ' ms for 3 bounded tries)');
    ok(Date.now() - t0 < 12000, 'each read is bounded (about two seconds), not open ended');

    // 8. Reorder: one function POST after a fresh read; paused shows a message; never n8n.
    state.flag = 'list';
    r = await window_('reorder', () => page.evaluate(async slug => {
      await persistCalReorder([{ id: 'card-1', order_index: 1 }, { id: 'card-2', order_index: 2 }], null, slug);
      return true;
    }, SLUG));
    ok(r.re === 1 && r.reads === 1 && r.n8n.length === 0, 'reorder: one fresh read, one calendar-reorder function POST, zero n8n (no batch fallback)');
    state.flag = 'empty';
    r = await window_('reorder paused', async () => {
      await page.evaluate(async slug => { await persistCalReorder([{ id: 'card-1', order_index: 3 }], null, slug); }, SLUG);
      return page.locator('.sv-toast-msg').filter({ hasText: 'Saving is paused' }).count();
    });
    ok(r.result >= 1 && r.re === 0 && r.n8n.length === 0, 'reorder for a removed client: refused with the paused message, nothing sent, zero n8n');
    state.flag = 'http500';
    r = await window_('reorder held', () => page.evaluate(async slug => { await persistCalReorder([{ id: 'card-1', order_index: 4 }], null, slug); return true; }, SLUG));
    ok(r.re === 0 && r.n8n.length === 0, 'reorder with an unreadable flag: held, nothing sent, zero n8n');

    // 9. The confirmation read after a bulk import is always Supabase.
    r = await window_('verify read', () => page.evaluate(async slug => {
      calState.client = slug;
      const rows = await _calFetchPostsForVerify();
      return Array.isArray(rows);
    }, SLUG));
    ok(r.result === true && r.n8n.length === 0 && state.calendarGets === 0, 'the import confirmation read comes from calendar_posts, zero n8n calendar-get');

    // 9b. PostgREST answers 400 to any parameter it does not know (a cache-buster
    // did exactly that to the Filming flag read in PR 1b), so the EXACT query of
    // each REST URL built here is pinned. Freshness comes from cache: 'no-store'.
    const paramKeys = search => Array.from(new URLSearchParams(search).keys()).sort().join(',');
    ok(state.guardUrls.length > 5 && state.guardUrls.every(q => paramKeys(q) === 'key,limit,select'
      && new URLSearchParams(q).get('select') === 'value' && new URLSearchParams(q).get('key') === 'eq.calendar_upsert_ef_clients'
      && new URLSearchParams(q).get('limit') === '1'),
      'every flag read the guard made (' + state.guardUrls.length + ') has exactly select, key, limit and no cache-buster');
    ok(state.verifyUrls.length >= 1 && state.verifyUrls.every(q => paramKeys(q).split(',').every(k => ['select', 'client', 'limit', 'offset', 'order', 'id'].includes(k)) && !/_t=/.test(q)),
      'the confirmation read uses only known PostgREST parameters: ' + JSON.stringify(state.verifyUrls));
    const src = fs.readFileSync(path.join(ROOT, 'src/index/120-calendar-flags-write-repair.js.part'), 'utf8');
    const guardSrc = src.slice(src.indexOf('function _calReadWriteFlagFresh'), src.indexOf('async function _calAssertFlagAllows'));
    ok(guardSrc.length > 200 && /cache: 'no-store'/.test(guardSrc) && !/_t=|Date\.now\(\)/.test(guardSrc),
      'the guard source sets cache: no-store and builds no timestamp parameter');

    // 10. No Calendar n8n request at all outside the one pinned repair.
    const calendarN8n = state.n8n.filter(line => /\/webhook\/calendar-/.test(line));
    ok(calendarN8n.length === 1 && calendarN8n[0] === 'POST /webhook/calendar-upsert-post',
      'across the whole run the only Calendar n8n request is the single pinned-webhook replay (' + JSON.stringify(calendarN8n) + ')');
    ok(errors.length === 0, 'no browser errors: ' + JSON.stringify(errors));
  } finally {
    if (state.flagHang) state.flagHang();
    await browser.close();
    server.close();
  }
  if (failures) { console.error('\ncalendar-write-guard-browser: ' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-write-guard-browser: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
