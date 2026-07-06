'use strict';
/*
 * Track B B2 wired-tab smoke suite.
 *
 * The original design-kit suites in this folder target the standalone prototype
 * and intentionally exercise write interactions. B2 is read-only, so this lane
 * checks the wired SyncView Production preview surface instead:
 *   - ?prod=1 mounts without the analytics data path
 *   - migrated B1 rows render in the list
 *   - a deliverable opens in detail
 *   - the client board renders
 *   - visible write affordances remain disabled
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

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));

  try {
    await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    const errorText = await page.locator('.prod-error').first().textContent().catch(() => '');
    if (errorText) throw new Error('Production preview rendered an error card');

    const rows = await page.locator('.prod-row').count();
    if (rows < 1) throw new Error('Production preview rendered no migrated rows');
    await maybeShot(page, 'prod-list');

    await page.locator('.prod-row').first().click();
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    if (await page.locator('.prod-detail-title').count() !== 1) throw new Error('Detail view did not open');
    if (await page.locator('button:enabled', { hasText: 'Disabled' }).count()) throw new Error('A disabled write affordance is enabled');
    await maybeShot(page, 'prod-detail');

    await page.locator('.prod-tab', { hasText: 'Clients' }).first().click();
    await page.waitForSelector('.prod-board', { timeout: 10000 });
    if (await page.locator('.prod-col').count() !== 6) throw new Error('Client board columns did not render');
    await maybeShot(page, 'prod-board');

    if (errors.length) throw new Error('Browser errors: ' + errors.slice(0, 3).join(' | '));
    console.log('prod-readonly-smoke: list, detail, board, disabled controls, and console checks passed');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
