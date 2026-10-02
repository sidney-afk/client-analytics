'use strict';
/*
 * n8n exit, step K (Calendar): A CLIENT LINK ALWAYS SAVES THROUGH THE FUNCTION.
 *
 * Drives the client Approve and Request changes buttons on a tokened client
 * link against a fully mocked backend and records every request the page makes.
 * It replaces the old byte-for-byte carve-out suite, which froze the n8n route.
 * Now, in both flag situations (the routing flag lists the client, or its read
 * fails so the flag never loads), every save must:
 *   - go to the calendar-upsert function,
 *   - carry the link's own token in X-Syncview-Client-Token and no staff key,
 *   - never touch the n8n calendar-upsert-post webhook.
 * A retried save pinned to the n8n writer must also go to the function.
 *
 * Fictional client, fictional token, fictional card. Nothing here is a real
 * name, slug or key.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = 'Review Fixture';
const SLUG = 'reviewfixture';
const TOKEN = 'fixture-review-token';
const CARD = 'p_review_fixture_1';
const VIDEO = 'del_review_fixture_video';
const NOTE = 'Please shorten the opening line in this fixture.';
const FROZEN = '2026-09-29T12:00:00.000Z';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const loadModes = new Set();   // how the page was served in each run (parts, full or single-file)
const BROWSER_OWN = /^(user-agent|sec-ch-.*|origin|referer|accept-language|accept-encoding|connection|host|pragma|cache-control|sec-fetch-.*|priority)$/i;

function serve(root) {
  const server = http.createServer((req, res) => {
    let file;
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      file = path.resolve(root, decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1)));
    } catch (_) { res.writeHead(400).end(); return; }
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end(); return;
    }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function fixture() {
  return { id: CARD, client: SLUG, name: 'Fictional review post', status: 'Client Approval',
    order_index: 1, updated_at: '2026-09-20T12:00:00.000Z',
    asset_url: 'https://example.invalid/video.mp4', thumbnail_url: '',
    video_deliverable_id: VIDEO,
    video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
    caption: 'A fictional caption for a browser test.', comments: [], graphic_comments: [], caption_comments: [] };
}

const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for ' + label);
}

/* One button, one flag situation, one tree. Returns every request the page made
   to a backend, in a form that can be compared as text. */
async function capture(browser, origin, action, flag) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const seen = [];
  const errors = [];
  let stored = fixture();
  let nativeStatus = 'client_approval';
  let saved = 0;
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (url.origin === origin) return route.continue();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const headers = {};
      // Credentials are compared by digest so no key-shaped string lands in the golden file.
      for (const [k, v] of Object.entries(request.headers())) {
        if (BROWSER_OWN.test(k)) continue;
        headers[k] = /^(apikey|authorization|x-syncview-key|x-client-token)$/i.test(k)
          ? 'sha256:' + crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 16) : v;
      }
      const body = request.postData() || '';
      seen.push({ method, url: url.origin + url.pathname + url.search, headers, body });
      if (url.pathname === '/functions/v1/client-token-verify') {
        const b = JSON.parse(body || '{}');
        return json(route, b.slug === SLUG && b.token === TOKEN
          ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT,
            view: b.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' }
          : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
      }
      if ((url.pathname === '/functions/v1/calendar-upsert' || url.pathname === '/webhook/calendar-upsert-post') && method === 'POST') {
        saved++;
        const b = JSON.parse(body || '{}');
        stored = { ...stored, ...(b.post || {}) };
        return json(route, { ok: true, post: { ...stored, updated_at: FROZEN } });
      }
      if (url.pathname === '/rest/v1/calendar_posts' && method === 'GET') return json(route, [stored]);
      if ((url.pathname === '/rest/v1/deliverables' || url.pathname === '/rest/v1/production_deliverables_browser_v1') && method === 'GET') {
        return json(route, [{ id: VIDEO, card_id: CARD, client_slug: SLUG, team: 'video', origin: 'calendar',
          status: nativeStatus, updated_at: '2026-09-20T12:00:00.000Z' }]);
      }
      if (url.pathname === '/rest/v1/clients' && method === 'GET') {
        return json(route, [{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
      }
      if (url.pathname === '/rest/v1/syncview_runtime_flags' && method === 'GET') {
        const raw = url.searchParams.get('key') || '';
        const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
        if (flag === 'unread' && keys.includes('calendar_upsert_ef_clients')) return json(route, { message: 'fixture' }, 500);
        const values = {
          calendar_upsert_ef_clients: { clients: [SLUG] },
          write_ui_reroute_clients: { clients: [SLUG] },
          client_comment_gateway_enabled: { enabled: true },
          prod_authority: { video: 'syncview', graphics: 'syncview' },
        };
        return json(route, keys.filter(key => Object.hasOwn(values, key)).map(key => ({ key, value: values[key] })));
      }
      if (url.pathname === '/functions/v1/production-write' && method === 'POST') {
        const b = JSON.parse(body || '{}');
        if (b.reconcile_only === true) return json(route, { ok: true, outcome: 'absent',
          row: { id: VIDEO, card_id: CARD, client_slug: SLUG, team: 'video', status: nativeStatus } });
        nativeStatus = b.status;
        return json(route, { ok: true, native_committed: true, authority: 'syncview', complete: true,
          row: { id: VIDEO, card_id: CARD, client_slug: SLUG, team: 'video', status: b.status, updated_at: FROZEN } });
      }
      if (url.pathname.startsWith('/rest/v1/') && method === 'GET') return json(route, []);
      if (url.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
      if (url.pathname.startsWith('/functions/v1/') || url.pathname.startsWith('/webhook/')) return json(route, { ok: true });
      return route.abort();
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 180)));
    // Same clock and the same "random" on every run and on both trees, so the
    // bodies (timestamps, generated ids) can be compared as text.
    await page.clock.setFixedTime(new Date(FROZEN));
    await page.addInitScript(() => {
      let seed = 1234567;
      Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
      let n = 0;
      try { crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'); } catch (e) {}
    });
    const query = new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' });
    await page.goto(origin + '/index.html?' + query, { waitUntil: 'domcontentloaded' });
    const card = `.kcard[data-cal-review-pid="${CARD}"]`;
    await page.locator(card).waitFor({ timeout: 30000 });
    loadModes.add(await page.evaluate(() => (self.__svLoad ? self.__svLoad.mode : 'single-file')));
    await page.locator(card + ' .kcard-expand-btn').click();
    await page.locator(card + ' .cal-review-body').waitFor();
    let button;
    if (action === 'approve') {
      button = card + ' .cal-review-panel[data-comp="video"] .cal-review-approve-btn';
    } else {
      const panel = card + ' .cal-review-panel[data-comp="caption"]';
      await page.locator(panel + ' .cal-review-textarea').fill(NOTE);
      button = panel + ' .cal-review-tweak-btn';
    }
    const startAt = seen.length;
    await page.locator(button).click();
    if (action === 'approve' && await page.locator('#confirmOverlay.active').count()) {
      await page.locator('#confirmYes').click();
    }
    await until(() => saved > 0, action + '/' + flag + ' save request');
    await page.waitForTimeout(1500);   // let follow-up reads and repairs settle
    assert.deepEqual(errors, [], action + '/' + flag + ': browser errors');
    // Only what the click caused, and only writes and backend reads that are not
    // page furniture. Sorted within each group so concurrent reads cannot flip it.
    const after = seen.slice(startAt).filter(item => /\/functions\/v1\/|\/webhook\/|\/rest\/v1\/syncview_runtime_flags/.test(item.url) || item.method !== 'GET');
    const key = item => JSON.stringify(item);
    const writes = after.filter(item => item.method !== 'GET').map(key);
    const reads = after.filter(item => item.method === 'GET').map(key).sort();
    return { writes, reads };
  } finally {
    await context.close();
  }
}


async function pinnedProbe(browser, origin) {
  // A saved-for-retry write pinned to the old n8n writer, on a client link, must
  // still go to the function. Drives the page's own retry helper directly.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const urls = [];
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (request.method() === 'POST' && /\/(functions\/v1|webhook)\/(calendar-upsert-post|calendar-upsert)$/.test(url.pathname)) urls.push(url.origin + url.pathname);
      if (url.pathname === '/functions/v1/client-token-verify') {
        const b = JSON.parse(request.postData() || '{}');
        return json(route, b.slug === SLUG && b.token === TOKEN
          ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: b.view,
            strict: true, active: true, protocol: 'syncview-client-entry-v1' }
          : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
      }
      if (url.pathname === '/rest/v1/calendar_posts' && request.method() === 'GET') return json(route, [fixture()]);
      if (url.pathname === '/rest/v1/clients' && request.method() === 'GET') {
        return json(route, [{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
      }
      if (url.pathname.startsWith('/rest/v1/')) return json(route, []);
      if (url.pathname.startsWith('/functions/v1/') || url.pathname.startsWith('/webhook/')) return json(route, { ok: true });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' }), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _calUpsertFetchPinned === 'function', null, { timeout: 30000 }).catch(() => {});
    const probe = await page.evaluate(async () => {
      if (typeof _calUpsertFetchPinned !== 'function') return { missing: true };
      await _calUpsertFetchPinned('reviewfixture', { client: 'reviewfixture', post: { id: 'probe' } }, 'ui', 'webhook');
      return { missing: false };
    });
    return { probe, urls };
  } finally {
    await context.close();
  }
}

(async () => {
  const server = await serve(ROOT);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  let failures = 0;
  const check = (ok, label) => { console.log((ok ? '  ok  ' : 'FAIL  ') + label); if (!ok) failures++; };
  try {
    for (const action of ['approve', 'request']) {
      for (const flag of ['listed', 'unread']) {
        const key = action + '/' + flag;
        const { writes } = await capture(browser, origin, action, flag);
        const w = writes.map(line => JSON.parse(line));
        const upserts = w.filter(item => /(calendar-upsert-post|calendar-upsert)$/.test(item.url));
        check(upserts.length > 0, key + ': the save was sent');
        check(upserts.every(item => /functions\/v1\/calendar-upsert$/.test(item.url)), key + ': every save goes to the calendar-upsert function');
        check(!w.some(item => /n8n\.cloud/.test(item.url)), key + ': nothing is sent to n8n');
        check(upserts.every(item => item.headers['x-syncview-client-token'] === TOKEN && !item.headers.authorization),
          key + ': the save carries the link token and no staff key');
      }
    }
    const pinned = await pinnedProbe(browser, origin);
    if (pinned.probe.missing) check(false, 'the retry helper is reachable from the page');
    else check(pinned.urls.length === 1 && /functions\/v1\/calendar-upsert$/.test(pinned.urls[0]),
      'a retried save pinned to the n8n writer goes to the function (got ' + pinned.urls.join(',') + ')');
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error('\ncalendar-client-approve-function-browser: ' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-client-approve-function-browser: client saves always go through the function');
})().catch(error => { console.error(error); process.exit(1); });
