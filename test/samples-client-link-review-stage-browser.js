'use strict';
/*
 * A CLIENT SAMPLES LINK OPENS THE SAMPLES REVIEW, WITH THE NEW REVIEW PAGE ON.
 *
 * Since 2026-10-18 the new review page is on for every client
 * (review_stage_client_pages { "all": true }). Its switch handler moves a client
 * link that opened on Analytics to the Content Calendar. It judged "opened on
 * Analytics" by "no Calendar on screen and no tab picked", which a Samples link
 * also is, so every client Samples link (Share with client on the Samples
 * sheet, v=sample-reviews) was moved to the Calendar Review page a moment after
 * it loaded and the client could not reach the samples at all (session Reproof,
 * 2026-10-26, measured on the live site on the test client).
 *
 * Here the link must keep v=sample-reviews, show the sample, and never show the
 * Calendar Review page. A bare link (Analytics) must still move to the Calendar.
 *
 * Fictional client, token and card; every backend call is answered locally.
 * Run: node test/samples-client-link-review-stage-browser.js
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = 'Review Fixture';
const SLUG = 'reviewfixture';
const TOKEN = 'fixture-review-token';
const CARD = 'sr_review_stage_fixture_1';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

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

const sample = { id: CARD, client: SLUG, name: 'Fictional sample', status: 'Client Approval',
  order_index: 1, updated_at: '2026-10-20T12:00:00.000Z', asset_url: 'https://example.invalid/video.mp4', thumbnail_url: '',
  video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
  caption: 'A fictional caption.', comments: [], graphic_comments: [], caption_comments: [] };

const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

async function open(browser, origin, view) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  const errors = [];
  let flagsRead = false;
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin === origin) return route.continue();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (url.pathname === '/functions/v1/client-token-verify') {
      const b = JSON.parse(request.postData() || '{}');
      return json(route, b.slug === SLUG && b.token === TOKEN
        ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: b.view,
          strict: true, active: true, protocol: 'syncview-client-entry-v1' }
        : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
    }
    if (url.pathname === '/rest/v1/sample_reviews' && method === 'GET') return json(route, [sample]);
    if (url.pathname === '/rest/v1/clients' && method === 'GET') {
      return json(route, [{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
    }
    if (url.pathname === '/rest/v1/syncview_runtime_flags' && method === 'GET') {
      const raw = url.searchParams.get('key') || '';
      const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
      const values = { review_stage_client_pages: { all: true }, sample_review_ef_clients: { clients: [SLUG] } };
      if (keys.includes('review_stage_client_pages')) flagsRead = true;
      return json(route, keys.filter(key => Object.hasOwn(values, key)).map(key => ({ key, value: values[key] })));
    }
    if (url.pathname.startsWith('/rest/v1/') && method === 'GET') return json(route, []);
    if (url.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    if (url.pathname.startsWith('/functions/v1/') || url.pathname.startsWith('/webhook/')) return json(route, { ok: true });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 180)));
  const q = { c: CLIENT, t: TOKEN };
  if (view === 'sample-reviews') Object.assign(q, { v: 'sample-reviews', sxr: '1' });
  await page.goto(origin + '/index.html?' + new URLSearchParams(q), { waitUntil: 'domcontentloaded' });
  return { context, page, errors, flagsRead: () => flagsRead };
}

const stageShown = page => page.evaluate(() => {
  const h = document.getElementById('svReviewStage');
  return !!(h && !h.hidden && getComputedStyle(h).display !== 'none');
});

(async () => {
  const server = await serve(ROOT);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  let failures = 0;
  const check = (ok, label) => { console.log((ok ? '  ok  ' : 'FAIL  ') + label); if (!ok) failures++; };
  try {
    // 1. The Samples link: the sample shows, and stays, after the switch is read.
    const s = await open(browser, origin, 'sample-reviews');
    try {
      const card = `.kcard[data-cal-review-pid="${CARD}"]`;
      const shown = await s.page.locator(card).waitFor({ timeout: 30000 }).then(() => true, () => false);
      check(shown, 'the Samples link shows the sample');
      const read = await s.page.waitForFunction(() => typeof svRsFlagsLoaded === 'function' && svRsFlagsLoaded(), null, { timeout: 15000 }).then(() => true, () => false);
      check(read && s.flagsRead(), 'the review page switch was read (on for every client)');
      await s.page.waitForTimeout(2500);   // the switch handler runs as the read lands; give any move time to happen
      const after = await s.page.evaluate(sel => ({
        v: new URLSearchParams(location.search).get('v'),
        sample: !!document.querySelector(sel),
        cal: !!document.getElementById('calView'),
      }), card);
      check(after.v === 'sample-reviews', 'the address still says sample-reviews (was ' + after.v + ')');
      check(after.sample, 'the sample is still on screen');
      check(!after.cal && !(await stageShown(s.page)), 'the Calendar Review page was not drawn in its place');
      check(s.errors.length === 0, 'no page errors (' + s.errors.join(' | ') + ')');
    } finally { await s.context.close(); }

    // 2. A bare link (Analytics) is still moved to the Calendar: the guard did not switch that off.
    const a = await open(browser, origin, 'analytics');
    try {
      const moved = await a.page.waitForFunction(() => new URLSearchParams(location.search).get('v') === 'calendar', null, { timeout: 30000 }).then(() => true, () => false);
      check(moved, 'a bare link still opens on the Content Calendar');
    } finally { await a.context.close(); }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error('\nsamples-client-link-review-stage-browser: ' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\nsamples-client-link-review-stage-browser: a client Samples link stays on the Samples review');
})();
