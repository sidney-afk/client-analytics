'use strict';
/*
 * Track B B2 wired-tab smoke suite.
 *
 * The original design-kit suites in this folder target the standalone prototype
 * and intentionally exercise write interactions. B2 is read-only, so this lane
 * checks the wired SyncView Production preview surface instead:
 *   - ?prod=1 mounts without the analytics data path
 *   - migrated B1 rows render in the list
 *   - team filters, client-board filters, detail, batch links, and deep links work
 *   - the client board renders all locked columns
 *   - visible write affordances remain disabled
 *   - the preview makes no non-GET/HEAD/OPTIONS browser requests
 *   - a mobile viewport can open list and detail without errors
 *   - no console/page errors fire
 *
 * Optional: set SYNCVIEW_PROD_SCREENSHOT_DIR to save screenshots.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    p = path.normalize(p).replace(/^([.][\\/])+/, '');
    const full = path.join(root, p);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function maybeShot(page, name) {
  const dir = process.env.SYNCVIEW_PROD_SCREENSHOT_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true });
}

async function text(page, sel) {
  return (await page.locator(sel).first().textContent().catch(() => '') || '').trim();
}

async function assertNoWriteRequests(requests) {
  const writes = requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
  if (writes.length) {
    throw new Error('Production preview made write-like browser requests: '
      + writes.slice(0, 5).map(r => `${r.method} ${r.url}`).join(' | '));
  }
}

async function newAuthedPage(browser, viewport, errors, requests) {
  const page = await browser.newPage(viewport);
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push({ method: req.method(), url: req.url() }));
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));
  return page;
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const requests = [];
  const page = await newAuthedPage(browser, { viewport: { width: 1440, height: 950 } }, errors, requests);

  try {
    await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    const errorText = await page.locator('.prod-error').first().textContent().catch(() => '');
    if (errorText) throw new Error('Production preview rendered an error card');
    if (await page.locator('#navProd').count() !== 1) throw new Error('Production nav item was not mounted');

    const rows = await page.locator('.prod-row').count();
    if (rows < 1) throw new Error('Production preview rendered no migrated rows');
    const firstRowId = await page.locator('.prod-row').first().getAttribute('data-prod-row');
    if (!firstRowId) throw new Error('Production rows do not expose stable row ids');
    const rowStatuses = await page.locator('.prod-row').evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('data-prod-status')).filter(Boolean))]);
    if (!rowStatuses.length) throw new Error('Production rows did not expose migrated status slugs');
    await maybeShot(page, 'prod-list');

    await page.locator('.prod-nav-btn', { hasText: 'Video' }).first().click();
    await page.waitForSelector('.prod-row, .prod-empty', { timeout: 10000 });
    if (!new URL(page.url()).searchParams.has('team')) throw new Error('Video team filter did not preserve ?prod=1&team=...');
    const videoRows = await page.locator('.prod-row').count();
    if (videoRows) {
      const badTeamRows = await page.locator('.prod-row').evaluateAll(nodes => nodes.filter(n => n.getAttribute('data-prod-team') !== 'video').length);
      if (badTeamRows) throw new Error('Video team view included non-video deliverables');
    }
    await page.locator('.prod-nav-btn', { hasText: 'All issues' }).first().click();
    await page.waitForSelector('.prod-row', { timeout: 10000 });

    await page.locator('.prod-row').first().click();
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    if (await page.locator('.prod-detail-title').count() !== 1) throw new Error('Detail view did not open');
    const detailId = await page.locator('.prod-detail').first().getAttribute('data-prod-detail');
    if (!detailId) throw new Error('Detail view does not expose its deliverable id');
    const detailUrl = new URL(page.url());
    if (detailUrl.searchParams.get('prod') !== '1' || !detailUrl.searchParams.get('d')) throw new Error('Detail view did not write a stable ?prod=1&d=... URL');
    const disabledControls = await page.locator('[data-prod-disabled]').count();
    if (disabledControls < 1) throw new Error('No disabled write affordances were rendered');
    if (await page.locator('[data-prod-disabled]:not(:disabled)').count()) throw new Error('A write affordance is not disabled');
    if (!(await text(page, '.prod-composer-box')).includes('disabled')) throw new Error('Comment composer did not render the read-only hint');
    await maybeShot(page, 'prod-detail');

    const batchBtn = page.locator('.prod-prop').filter({ hasText: 'Batch' }).locator('button').first();
    if (await batchBtn.count()) {
      await batchBtn.click();
      await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
      if (!new URL(page.url()).searchParams.get('batch')) throw new Error('Batch detail did not write a stable ?prod=1&batch=... URL');
    }

    await page.goto(`http://127.0.0.1:${port}/?prod=1&d=${encodeURIComponent(firstRowId)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-detail-title', { timeout: 30000 });
    if ((await page.locator('.prod-detail').first().getAttribute('data-prod-detail')) !== firstRowId) {
      throw new Error('Direct deliverable deep link did not open the requested row');
    }

    await page.locator('.prod-tab', { hasText: 'Clients' }).first().click();
    await page.waitForSelector('.prod-board', { timeout: 10000 });
    if (await page.locator('.prod-col').count() !== 6) throw new Error('Client board columns did not render');
    const boardCols = await page.locator('.prod-col').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-prod-col')));
    const expectedCols = ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled'];
    if (expectedCols.some(c => !boardCols.includes(c))) throw new Error('Client board is missing expected columns: ' + boardCols.join(','));
    if (await page.locator('[data-prod-client-card]').count() < 1) throw new Error('Client board rendered no real-data client cards');
    await maybeShot(page, 'prod-board');

    const clientSlug = await page.locator('[data-prod-client-card]').first().getAttribute('data-prod-client-card');
    if (!clientSlug) throw new Error('Client board cards do not expose stable client slugs');
    await page.locator('[data-prod-client-card]').first().click();
    await page.waitForSelector('.prod-row', { timeout: 10000 });
    const clientUrl = new URL(page.url());
    if (clientUrl.searchParams.get('client') !== clientSlug) throw new Error('Client board card did not write a stable ?prod=1&client=... URL');
    const badClientRows = await page.locator('.prod-row').evaluateAll((nodes, slug) => nodes.filter(n => n.getAttribute('data-prod-client') !== slug).length, clientSlug);
    if (badClientRows) throw new Error('Client-filtered list included another client');

    const mobile = await newAuthedPage(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }, errors, requests);
    await mobile.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await mobile.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    if (await mobile.locator('.prod-error').count()) throw new Error('Mobile Production preview rendered an error card');
    if (await mobile.locator('.prod-row').count() < 1) throw new Error('Mobile Production preview rendered no migrated rows');
    await maybeShot(mobile, 'prod-mobile-list');
    await mobile.locator('.prod-row').first().click();
    await mobile.waitForSelector('.prod-detail-title', { timeout: 10000 });
    if (await mobile.locator('.prod-detail-title').count() !== 1) throw new Error('Mobile detail view did not open');
    await maybeShot(mobile, 'prod-mobile-detail');
    await mobile.close();

    await assertNoWriteRequests(requests);
    if (errors.length) throw new Error('Browser errors: ' + errors.slice(0, 3).join(' | '));
    console.log('prod-readonly-smoke: list, team filter, client filter, detail, deep link, batch link, board, mobile, disabled controls, no-write requests, and console checks passed');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
