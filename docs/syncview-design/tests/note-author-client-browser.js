'use strict';
/* note-author-client-browser.js -- a client never sees who on the team wrote a
 * note (Notes Step 2, "who wrote it").
 *
 * Staff notes store the writer's member id (author_member_id) beside the shared
 * author. Staff screens look the name up in the staff roster; the client link
 * must show every staff note as "Synchro team" and must never receive a staff
 * name or email: not on the page, not in anything it downloads.
 *
 * Opens the tokened client Calendar against a fictional card whose notes carry
 * a made-up colleague's member id, with every request answered locally, and
 * proves:
 *   - the staff note reads "Synchro team"; the client's own note keeps its name
 *   - the page never asks for the staff roster
 *   - neither the made-up staff name nor email appears in the page or in any
 *     response the page received
 * With SCREENSHOTS=<dir>, a light capture is written there.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const CLIENT = 'Author Fixture';
const SLUG = 'authorfixture';
const TOKEN = 'fixture-author-token';
const CARD = 'p_author_fixture_1';
const STAFF_NAME = 'Robin Testwell';
const STAFF_EMAIL = 'robin.testwell@example.invalid';
const SHOTS = process.env.SCREENSHOTS || '';
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
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
      '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function card() {
  const notes = [
    { id: 'n_staff', parent_id: null, author: 'Synchro Social', author_member_id: 'm7', role: 'smm', audience: 'client',
      is_tweak: false, body: 'Here is the new cut for you.', created_at: '2026-10-12T10:00:00.000Z', updated_at: '2026-10-12T10:00:00.000Z', done: false },
    { id: 'n_client', parent_id: 'n_staff', author: CLIENT, role: 'client',
      body: 'Thanks, looks good.', created_at: '2026-10-12T11:00:00.000Z', updated_at: '2026-10-12T11:00:00.000Z', done: false },
  ];
  return { id: CARD, client: SLUG, name: 'Fictional author post', status: 'Client Approval', order_index: 1,
    updated_at: '2026-10-12T12:00:00.000Z', asset_url: 'https://example.invalid/video.mp4', thumbnail_url: '',
    video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
    caption: 'A fictional caption.', caption_tweaks: JSON.stringify(notes), video_tweaks: '', graphic_tweaks: '' };
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const bodies = [];
  const rosterAsks = [];
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.routeWebSocket('**/*', socket => socket.close());
    const json = (route, body, status = 200) => {
      const text = JSON.stringify(body);
      bodies.push(text);
      return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: text });
    };
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (url.origin === origin) return route.continue();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (url.pathname === '/functions/v1/client-token-verify') {
        const body = JSON.parse(request.postData() || '{}');
        return json(route, body.slug === SLUG && body.token === TOKEN
          ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT,
            view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' }
          : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
      }
      // The roster holds staff names and emails. The client page must never ask.
      if (url.pathname === '/rest/v1/team_members') {
        rosterAsks.push(url.href);
        return json(route, [{ id: 'm7', name: STAFF_NAME, email: STAFF_EMAIL, role: 'smm', active: true }]);
      }
      if (url.pathname === '/rest/v1/calendar_posts' && method === 'GET') return json(route, [card()]);
      if (url.pathname === '/rest/v1/clients' && method === 'GET') {
        return json(route, [{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
      }
      if (url.pathname.startsWith('/rest/v1/') && method === 'GET') return json(route, []);
      if (url.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
      if (url.pathname.startsWith('/functions/v1/') || url.pathname.startsWith('/webhook/')) return json(route, {});
      return route.abort();
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 180)));
    const query = new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' });
    await page.goto(origin + '/index.html?' + query, { waitUntil: 'domcontentloaded' });
    const sel = `.kcard[data-cal-review-pid="${CARD}"]`;
    await page.locator(sel).waitFor({ timeout: 20000 });
    await page.locator(sel + ' .kcard-expand-btn').click();
    await page.locator(sel + ' .cal-review-body').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.cal-review-comment-head strong').length >= 2, null, { timeout: 10000 });
    const names = await page.evaluate(() => [...document.querySelectorAll('.cal-review-comment-head strong')].map(n => n.textContent));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'note-writer-client-light.png') }); }
    // Open the Notes panel as well, the other place a client reads notes.
    await page.evaluate(id => openCalComments(id), CARD);
    await page.waitForFunction(() => document.querySelectorAll('.cal-cm-author').length >= 2, null, { timeout: 10000 });
    const panelNames = await page.evaluate(() => [...document.querySelectorAll('.cal-cm-author')].map(n => n.textContent));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'note-writer-client-panel-light.png') });
    const html = await page.content();

    assert.ok(names.includes('Synchro team'), 'the staff note reads "Synchro team" on the card (' + names.join('|') + ')');
    assert.ok(names.includes(CLIENT), "the client's own note keeps its name");
    assert.ok(panelNames.includes('Synchro team'), 'the staff note reads "Synchro team" in the Notes panel (' + panelNames.join('|') + ')');
    assert.ok(!names.concat(panelNames).includes('Synchro Social'), 'no staff note shows the stored shared author');
    assert.deepEqual(rosterAsks, [], 'the client page never asks for the staff roster');
    assert.ok(!html.includes(STAFF_NAME) && !html.includes(STAFF_EMAIL), 'no staff name or email on the client page');
    assert.ok(!bodies.some(b => b.includes(STAFF_NAME) || b.includes(STAFF_EMAIL)), 'no staff name or email in anything the client page downloaded');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('ok card: ' + names.join('|') + ' · panel: ' + panelNames.join('|'));
    console.log('note-author-client-browser: the client sees "Synchro team" and receives no staff name or email');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
