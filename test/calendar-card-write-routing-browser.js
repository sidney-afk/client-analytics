'use strict';
/*
 * calendar-card-write routing (calendar-upsert retirement plan, step 1), in a real browser, fully mocked.
 *
 * A staff Calendar save goes to the new calendar-card-write function only when the runtime switch
 * calendar_card_write_clients lists the client (or says all) and the tab has a signed-in staff identity.
 * Everything else stays on calendar-upsert, today's path: no switch row, an empty or malformed roster, a failed
 * read, no identity. When the function itself refuses because its own switch says no (or it could not read it),
 * it has written nothing and the same save goes to calendar-upsert at once. Any other answer from the function
 * (a conflict, a guard, an error) is the save's answer: no second write.
 *
 * The existing saving-on check (calendar_upsert_ef_clients) still runs first on every save; this suite leaves it on.
 */
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
    cardFlag: 'absent',      // absent | list | all | empty | malformed | http500
    cardFlagReads: 0,
    cardAnswer: 'ok',        // ok | not_enabled | switch_unreadable | conflict | error500
    upsert: [],              // calendar-upsert POSTs
    card: [],                // calendar-card-write POSTs
    n8n: [],
  };
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (url.origin === origin) return route.continue();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (/n8n\.cloud$/.test(url.hostname)) { state.n8n.push(method + ' ' + url.pathname); return json(route, { ok: true }); }
      if (url.pathname === '/rest/v1/syncview_runtime_flags' && method === 'GET') {
        const raw = url.searchParams.get('key') || '';
        const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
        if (keys.length === 1 && keys[0] === 'calendar_card_write_clients') {
          state.cardFlagReads++;
          const k = keys[0];
          if (state.cardFlag === 'http500') return json(route, { message: 'fixture failure' }, 500);
          if (state.cardFlag === 'absent') return json(route, []);
          if (state.cardFlag === 'empty') return json(route, [{ key: k, value: { clients: [] } }]);
          if (state.cardFlag === 'malformed') return json(route, [{ key: k, value: { clients: [{}] } }]);
          if (state.cardFlag === 'all') return json(route, [{ key: k, value: { all: true } }]);
          return json(route, [{ key: k, value: { clients: [SLUG] } }]);
        }
        const values = {
          calendar_upsert_ef_clients: { clients: [SLUG] },
          write_ui_reroute_clients: { clients: [SLUG] },
          prod_authority: { video: 'syncview', graphics: 'syncview' },
        };
        return json(route, keys.filter(key => Object.hasOwn(values, key)).map(key => ({ key, value: values[key] })));
      }
      if (url.pathname === '/functions/v1/calendar-upsert' && method === 'POST') {
        state.upsert.push({ body: JSON.parse(request.postData() || '{}'), headers: request.headers() });
        return json(route, { ok: true, post: { id: 'from-upsert' } });
      }
      if (url.pathname === '/functions/v1/calendar-card-write' && method === 'POST') {
        state.card.push({ body: JSON.parse(request.postData() || '{}'), headers: request.headers() });
        if (state.cardAnswer === 'not_enabled') return json(route, { ok: false, error: 'client_not_enabled' }, 403);
        if (state.cardAnswer === 'switch_unreadable') return json(route, { ok: false, error: 'switch_unreadable' }, 503);
        if (state.cardAnswer === 'conflict') return json(route, { ok: false, conflict: true, error: 'Not saved: someone else updated this card' });
        if (state.cardAnswer === 'error500') return json(route, { ok: false, error: 'calendar update failed' }, 500);
        return json(route, { ok: true, post: { id: 'from-card-write' } });
      }
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
    await page.waitForFunction(() => typeof _calUpsertFetch === 'function' && typeof _calUpsertFetchPinned === 'function', null, { timeout: 30000 });
    await page.waitForTimeout(1500);   // let the boot flag reads settle

    // Each step starts from a fresh switch read, the way a save 30 seconds later would.
    const forget = () => page.evaluate(() => { _calCardWriteFlag = { value: null, at: 0 }; });
    const save = (id, source) => page.evaluate(async ({ slug, id, source }) => {
      try {
        const resp = await _calUpsertFetch(slug, { client: slug, post: { id, name: 'Fixture' } }, source || 'ui');
        return { sent: true, status: resp.status, body: await resp.json() };
      } catch (e) { return { sent: false, message: String(e && e.message) }; }
    }, { slug: SLUG, id, source });
    const step = async (label, work) => {
      const before = { up: state.upsert.length, card: state.card.length, reads: state.cardFlagReads, n8n: state.n8n.length };
      const result = await work();
      return { label, result, up: state.upsert.length - before.up, card: state.card.length - before.card,
        reads: state.cardFlagReads - before.reads, n8n: state.n8n.length - before.n8n };
    };

    // 1. No switch row: today's path.
    state.cardFlag = 'absent'; await forget();
    let r = await step('absent', () => save('card-1'));
    ok(r.result.sent && r.up === 1 && r.card === 0 && r.reads === 1, 'no switch row: one switch read, the save goes to calendar-upsert');

    // 2. The client is listed: the save goes to calendar-card-write, with the staff identity and the same body.
    state.cardFlag = 'list'; state.cardAnswer = 'ok'; await forget();
    r = await step('listed', () => save('card-2', 'calendar-component-fill'));
    const sent = state.card[state.card.length - 1] || { body: {}, headers: {} };
    ok(r.result.sent && r.card === 1 && r.up === 0 && r.result.body.post.id === 'from-card-write', 'listed client: the save goes to calendar-card-write and nowhere else');
    ok(!!sent.headers['x-syncview-key'] && sent.headers['x-syncview-source'] === 'calendar-component-fill' && sent.headers['x-syncview-role'] !== 'client',
      'calendar-card-write gets the staff key, the caller\'s source and a staff role');
    ok(JSON.stringify(sent.body) === JSON.stringify({ client: SLUG, post: { id: 'card-2', name: 'Fixture' } }), 'the body is exactly what calendar-upsert would have received');

    // 3. The switch is reused for 30 seconds: a second save does not read it again.
    r = await step('cached', () => save('card-3'));
    ok(r.card === 1 && r.reads === 0, 'a second save inside 30 seconds reuses the switch (no read)');

    // 4. A pinned supabase retry follows the same routing.
    r = await step('pinned', () => page.evaluate(async slug => {
      const resp = await _calUpsertFetchPinned(slug, { client: slug, post: { id: 'card-4', name: 'Fixture' } }, 'ui', 'supabase');
      return { status: resp.status };
    }, SLUG));
    ok(r.card === 1 && r.up === 0, 'a retry pinned to supabase goes to calendar-card-write too');

    // 5. {"all": true} turns it on for everyone.
    state.cardFlag = 'all'; await forget();
    r = await step('all', () => save('card-5'));
    ok(r.card === 1 && r.up === 0, '{"all": true}: calendar-card-write');

    // 6. Empty, malformed or unreadable switch: calendar-upsert.
    for (const mode of ['empty', 'malformed', 'http500']) {
      state.cardFlag = mode; await forget();
      r = await step(mode, () => save('card-6-' + mode));
      ok(r.result.sent && r.up === 1 && r.card === 0, `${mode} switch: the save stays on calendar-upsert`);
    }

    // 7. The function refuses before writing: the same save goes to calendar-upsert, and the next one goes there directly.
    for (const answer of ['not_enabled', 'switch_unreadable']) {
      state.cardFlag = 'list'; state.cardAnswer = answer; await forget();
      r = await step(answer, () => save('card-7-' + answer));
      ok(r.result.sent && r.card === 1 && r.up === 1 && r.result.body.post.id === 'from-upsert',
        `the function answers ${answer}: one try there, then the same save on calendar-upsert, which answers the page`);
      const upBody = state.upsert[state.upsert.length - 1].body;
      ok(upBody.post.id === 'card-7-' + answer, 'calendar-upsert got the same save');
      r = await step(answer + ' next', () => save('card-8-' + answer));
      ok(r.card === 0 && r.up === 1 && r.reads === 0, 'the next save inside 30 seconds goes straight to calendar-upsert');
    }

    // 8. Any other answer is the save's answer: no second write anywhere.
    for (const answer of ['conflict', 'error500']) {
      state.cardFlag = 'list'; state.cardAnswer = answer; await forget();
      r = await step(answer, () => save('card-9-' + answer));
      ok(r.result.sent && r.card === 1 && r.up === 0 && r.result.body.ok === false, `the function answers ${answer}: that answer reaches the page, calendar-upsert is not called`);
    }
    state.cardAnswer = 'ok';

    // 9. No signed-in staff identity: calendar-upsert (the function would refuse without a key).
    state.cardFlag = 'list'; await forget();
    await page.evaluate(() => { _syncviewStaffIdentityForHeaders = () => null; }).catch(() => null);
    const identityGone = await page.evaluate(() => { try { return _syncviewStaffIdentityForHeaders() === null; } catch (e) { return false; } });
    if (identityGone) {
      r = await step('no identity', () => save('card-10'));
      ok(r.up === 1 && r.card === 0, 'no staff identity: the save stays on calendar-upsert');
    } else {
      // The binding is not reassignable in this build: prove the rule from the source instead.
      const src = fs.readFileSync(path.join(ROOT, 'src/index/120-calendar-flags-write-repair.js.part'), 'utf8');
      ok(/try \{ identity = _syncviewStaffIdentityForHeaders\(\); \} catch \(e\) \{ identity = null; \}\s*if \(!identity\) return false;/.test(src),
        'no staff identity: the routing returns calendar-upsert (source rule)');
    }

    ok(state.n8n.filter(line => /\/webhook\/calendar-/.test(line)).length === 0, 'no Calendar request reached n8n');
    ok(errors.length === 0, 'no browser errors: ' + JSON.stringify(errors));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error('\ncalendar-card-write-routing-browser: ' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-card-write-routing-browser: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
