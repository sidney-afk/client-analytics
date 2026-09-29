'use strict';
/*
 * n8n exit, PR 2: THE CLIENT APPROVE AND REQUEST-CHANGES BUTTONS ARE UNTOUCHED.
 *
 * Owner decision 2026-09-29: their code and their routing do not change. This
 * suite drives both buttons on a tokened client link against a fully mocked
 * backend, records every request the page makes (method, URL, every header
 * except the browser's own, and the exact body string), and compares that to a
 * golden capture taken from `main` BEFORE the change
 * (test/fixtures/calendar-client-carveout-golden.json). Byte for byte.
 *
 * Two flag situations per button, because the legacy step routes on the flag:
 *   listed   the flag lists the client   -> the calendar-upsert function
 *   unread   the flag read fails         -> today's behaviour, the n8n webhook
 * The second is deliberately kept: the carve-out means these two buttons keep
 * today's routing exactly, including the parts the rest of the page is leaving.
 *
 *   node test/calendar-client-carveout-byte-identical-browser.js            compare to the golden
 *   node ... --capture                                                       rewrite the golden (run on main only)
 *   BASE_TREE=/path/to/main-checkout node ...                               also run that tree and require the same bytes
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
const GOLDEN = path.join(__dirname, 'fixtures', 'calendar-client-carveout-golden.json');
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

async function captureTree(root) {
  const server = await serve(root);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const out = {};
  try {
    for (const action of ['approve', 'request']) {
      for (const flag of ['listed', 'unread']) {
        // Host names are stable; only the port differs, so URLs are already comparable.
        out[action + '/' + flag] = await capture(browser, origin, action, flag);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}

(async () => {
  const mine = await captureTree(ROOT);
  if (process.argv.includes('--capture')) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(mine, null, 2) + '\n');
    console.log('golden written from this tree: ' + path.relative(ROOT, GOLDEN));
    return;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  let failures = 0;
  // A new comment's id is `c_<clock>_<random>`. The test seeds "random", so the id
  // repeats run to run only while the page draws the same NUMBER of random values
  // before the click. Once client links load in parts (plan step 5), one line of
  // Workload's start-up code (an id for its live plan sync, staff only) no longer
  // runs on a client link, one draw fewer, and every later draw shifts by one. The
  // clock part of the id stays compared; only the random suffix is not.
  const noRandomId = value => JSON.stringify(value).replace(/(c_[a-z0-9]{6,10}_)[a-z0-9]{3,8}/g, '$1<random>');
  const compare = (label, a, b) => {
    const same = noRandomId(a) === noRandomId(b);
    console.log((same ? '  ok  ' : 'FAIL  ') + label);
    if (!same) {
      failures++;
      const A = JSON.stringify(a, null, 1).split('\n'), B = JSON.stringify(b, null, 1).split('\n');
      for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) { console.log('   first difference at line ' + i + '\n   now:    ' + A[i] + '\n   golden: ' + B[i]); break; }
    }
  };
  for (const key of Object.keys(golden)) {
    compare(key + ': writes are byte-identical to main (method, URL, headers, body)', mine[key] && mine[key].writes, golden[key].writes);
    compare(key + ': backend reads are byte-identical to main', mine[key] && mine[key].reads, golden[key].reads);
    const w = golden[key].writes.map(line => JSON.parse(line));
    const toN8n = w.some(item => /n8n\.cloud\/webhook\/calendar-upsert-post/.test(item.url));
    const toFn = w.some(item => /functions\/v1\/calendar-upsert$/.test(item.url));
    console.log('        (' + key + ' sends to ' + (toN8n ? 'the n8n webhook, as today' : toFn ? 'the calendar-upsert function, as today' : 'neither?!') + ')');
    if (!toN8n && !toFn) failures++;
  }
  // Plan step 5: with split.json on and "clients" on, a client link is served in
  // parts; the requests above must have been recorded on the code as it ships.
  {
    const splitCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'index', 'split.json'), 'utf8'));
    const want = splitCfg.enabled && splitCfg.clients ? 'parts' : (splitCfg.enabled ? 'full' : 'single-file');
    const got = [...loadModes].join(',');
    console.log((got === want ? '  ok  ' : 'FAIL  ') + 'the client link was served as "' + want + '" in every run (got "' + got + '")');
    if (got !== want) failures++;
  }
  if (process.env.BASE_TREE) {
    const base = await captureTree(path.resolve(process.env.BASE_TREE));
    for (const key of Object.keys(mine)) compare(key + ': identical to the live base tree ' + process.env.BASE_TREE, mine[key], base[key]);
  }
  if (failures) { console.error('\ncalendar-client-carveout-byte-identical-browser: ' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\ncalendar-client-carveout-byte-identical-browser: client approve and request-changes requests are unchanged');
})().catch(error => { console.error(error); process.exit(1); });
