'use strict';
/* Tokened client Calendar review, with every external request intercepted.
 * Exercise visible actions against a fictional row; never contact a backend. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const CLIENT = 'Review Fixture';
const SLUG = 'reviewfixture';
const TOKEN = 'fixture-review-token';
const CARD = 'p_review_fixture_1';
const NOTE = 'Please shorten the opening line in this fixture.';
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

function fixture() {
  return { id: CARD, client: SLUG, name: 'Fictional review post', status: 'Client Approval',
    order_index: 1, updated_at: '2026-09-20T12:00:00.000Z',
    asset_url: 'https://example.invalid/video.mp4', thumbnail_url: '',
    video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
    caption: 'A fictional caption for a browser test.', comments: [], graphic_comments: [], caption_comments: [] };
}

async function until(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for ' + label);
}

function json(route, body, status = 200) {
  return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
}

async function run(browser, origin, action, mode) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const errors = [];
  const unknownWrites = [];
  const diagnostics = [];
  const saves = [];
  const initial = fixture();
  let stored = { ...initial };
  let releaseSave;
  const held = new Promise(resolve => { releaseSave = resolve; });
  const label = action + '/' + mode;
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
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
      if ((url.pathname === '/functions/v1/calendar-upsert'
        || url.pathname === '/webhook/calendar-upsert-post') && method === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        saves.push({ path: url.pathname, post: body.post || {} });
        if (mode === 'slow' || mode === 'double') await held;
        if (mode === 'refused') return json(route, { ok: false, error: 'fixture_save_refused' }, 403);
        stored = { ...stored, ...(body.post || {}) };
        return json(route, { ok: true, post: { ...stored, updated_at: new Date().toISOString() } });
      }
      if (url.pathname === '/rest/v1/calendar_posts' && method === 'GET') return json(route, [stored]);
      if (url.pathname === '/rest/v1/clients' && method === 'GET') {
        return json(route, [{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
      }
      if (url.pathname === '/rest/v1/syncview_runtime_flags' && method === 'GET') {
        return json(route, [{ value: { video: 'linear', graphics: 'linear' } }]);
      }
      if (url.pathname === '/functions/v1/write-diagnostics' && method === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        diagnostics.push({ fields: Object.keys(body), code: body.code || '', stage: body.stage || '' });
        return json(route, { ok: true });
      }
      if (url.pathname.startsWith('/rest/v1/') && method === 'GET') return json(route, []);
      if (url.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
      if (method !== 'GET' && method !== 'HEAD') unknownWrites.push(method + ' ' + url.pathname);
      if (url.pathname.startsWith('/functions/v1/') || url.pathname.startsWith('/webhook/')) return json(route, {});
      return route.abort();
    });

    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 180)));
    const query = new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' });
    await page.goto(origin + '/index.html?' + query, { waitUntil: 'domcontentloaded' });
    const card = `.kcard[data-cal-review-pid="${CARD}"]`;
    await page.locator(card).waitFor({ timeout: 20000 });
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
    assert.equal(await page.locator(button).isDisabled(), false, label + ': action must be enabled');
    if (mode === 'double') {
      // Two clicks in one browser task model taps that arrive before a repaint.
      await page.evaluate(selector => {
        const control = document.querySelector(selector);
        control.click();
        const confirm = document.querySelector('#confirmOverlay.active #confirmYes');
        const target = confirm || control;
        target.click();
        if (confirm) target.click();
      }, button);
    } else {
      await page.locator(button).click();
      if (action === 'approve' && await page.locator('#confirmOverlay.active').count()) {
        await page.locator('#confirmYes').click();
      }
    }

    await until(() => saves.length > 0, label + ' save attempt');
    const statusField = action === 'approve' ? 'video_status' : 'caption_status';
    const expected = action === 'approve' ? 'Approved' : 'Tweaks Needed';
    if (mode === 'slow' || mode === 'double') {
      await page.locator('.sv-toast-msg').filter({ hasText: 'Sending...' }).waitFor();
      assert.equal(stored[statusField], initial[statusField], label + ': held save must not be committed');
      assert.equal(saves.length, 1, label + ': a pending action must send once');
      releaseSave();
    }
    if (mode === 'refused') {
      await page.locator('#confirmOverlay.active #confirmTitle').filter({ hasText: 'was not saved' }).waitFor();
      assert.equal(stored[statusField], initial[statusField], label + ': refused save changed stored row');
      assert.equal(saves.length, 1, label + ': refused save should not be silently retried');
      if (action === 'request') {
        await until(async () => (await page.locator(card + ' .cal-review-panel[data-comp="caption"] .cal-review-textarea').inputValue()) === NOTE,
          label + ' preserved draft');
      } else {
        assert.equal(await page.locator(card + ' .cal-review-panel[data-comp="video"] .cal-review-approve-btn').isDisabled(), false,
          label + ': client must be able to retry approval');
      }
    } else {
      await until(() => stored[statusField] === expected, label + ' stored status');
      await page.locator('.sv-toast-msg').filter({ hasText: action === 'approve' ? 'Approved' : 'Changes sent' }).waitFor();
      if (mode === 'double') await page.waitForTimeout(400);
      assert.equal(saves.length, 1, label + ': duplicate source save');
      if (action === 'approve') assert.ok(stored.client_video_approved_at, label + ': missing client sign-off stamp');
      else {
        const comments = JSON.parse(stored.caption_tweaks || '[]');
        assert.equal(comments.filter(comment => comment.body === NOTE).length, 1,
          label + ': change request must be saved exactly once');
      }
    }
    assert.deepEqual(unknownWrites, [], label + ': unexpected write route');
    if (mode !== 'refused' && action === 'approve') {
      assert.deepEqual(diagnostics, [], label + ': unexpected write diagnostic');
    }
    if (mode !== 'refused' && action === 'request') {
      // The fictional row has no linked team target; team delivery may remain pending.
      assert.ok(diagnostics.length <= 1 && diagnostics.every(d => d.code === 'legacy_tweak_confirmation_pending'),
        label + ': unexpected write diagnostic');
    }
    assert.deepEqual(errors, [], label + ': browser errors');
    console.log('ok ' + label);
  } finally {
    releaseSave();
    await context.close();
  }
}

(async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const action of ['approve', 'request']) {
      for (const mode of ['normal', 'slow', 'refused', 'double']) await run(browser, origin, action, mode);
    }
    console.log('client-review-write-browser: 8 offline client-link cases passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
