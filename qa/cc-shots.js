'use strict';
/*
 * Credentials UX screenshot generator (WS3 deliverable).
 *
 * Renders the Kasper "Client Credentials" tab with obviously-fake dummy data
 * (TESTPASS-… on the Sidney TEST client) and captures light + dark, collapsed +
 * expanded. Serves whichever HTML file is passed so the same script produces the
 * "before" and "after" shots.
 *
 *   HTML_FILE=index.html         LABEL=after  node qa/cc-shots.js
 *   HTML_FILE=/tmp/before.html   LABEL=before node qa/cc-shots.js
 *
 * External hosts (fonts / Supabase / Sheets) are aborted cleanly so the sandbox
 * can't stall the render; no live backend or staff passphrase is involved.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const HTML_FILE = process.env.HTML_FILE || 'index.html';
const LABEL = process.env.LABEL || 'after';
const OUT = process.env.OUT_DIR || path.join(root, 'qa', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const htmlPath = path.isAbsolute(HTML_FILE) ? HTML_FILE : path.join(root, HTML_FILE);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(htmlPath).pipe(res);
    return;
  }
  let f = path.join(root, u.pathname.slice(1));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// Dummy, obviously-fake credentials on the Sidney TEST client plus one more
// client and one needs-review row, so the shots show the collapsed index, the
// expanded rows with the reveal control, and the needs-review chip.
const DUMMY = [
  { id: 'd1', client_slug: 'sidneylaruel', client_name: 'Sidney Laruel', platform: 'instagram', label: '', handle: '@sidney_test', password: 'TESTPASS-1111', notes: '2FA in test vault', status: 'active', source: 'manual', updated_at: '2026-07-06T10:00:00Z', updated_by: 'Kasper Hytonen' },
  { id: 'd2', client_slug: 'sidneylaruel', client_name: 'Sidney Laruel', platform: 'tiktok', label: '', handle: '@sidney_test_tt', password: 'TESTPASS-2222', notes: '', status: 'active', source: 'manual', updated_at: '2026-07-06T11:00:00Z', updated_by: 'Kasper Hytonen' },
  { id: 'd3', client_slug: 'novaskin', client_name: 'Nova Skin', platform: 'instagram', label: '', handle: '@novaskin_demo', password: 'TESTPASS-3333', notes: '', status: 'active', source: 'manual', updated_at: '2026-07-05T09:00:00Z', updated_by: 'Synchro Social' },
  { id: 'd4', client_slug: 'unmatched:acmedemo', client_name: 'Acme Demo', platform: 'facebook', label: 'backup', handle: '@acme_demo', password: 'TESTPASS-4444', notes: 'from onboarding — please verify', status: 'needs_review', source: 'onboarding', updated_at: '2026-07-04T09:00:00Z', updated_by: 'Onboarding' },
];

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${name}.png`), fullPage: true });
  console.log('  wrote', `${LABEL}-${name}.png`);
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    // Abort external hosts cleanly (fonts/supabase/sheets) so the sandbox can't stall.
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      if (url.includes('/functions/v1/client-credentials')) return route.continue();
      return route.abort();
    });
    await page.addInitScript((th) => {
      localStorage.setItem('syncview_auth_v1', 'ok');
      if (th === 'dark') localStorage.setItem('syncview_theme', 'dark');
      localStorage.setItem('syncview_client_credentials_identity_v1', JSON.stringify({ name: 'Kasper Hytonen', role: 'Kasper', key: 'dummy-key' }));
      sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
    }, theme);
    await page.route('**/functions/v1/client-credentials', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'list') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, credentials: DUMMY }) });
      if (body.action === 'history') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, events: [] }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.goto(`http://127.0.0.1:${port}/?Kasper=1#kasper/client-credentials`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cc-wrap', { timeout: 20000 });
    await page.waitForSelector('.cc-card', { timeout: 20000 });
    await page.waitForTimeout(300);
    await shoot(page, `${theme}-list`);            // collapsed index (after) / full list (before)

    // Narrow to a single column so the full row (handle · password · reveal/copy ·
    // history/edit/archive) is visible instead of being clipped by the dense
    // 3-up grid (which clips row actions in both before and after).
    await page.setViewportSize({ width: 680, height: 900 });
    await page.waitForTimeout(150);
    // Expand the Sidney TEST client + reveal one password to show the row layout.
    const toggle = page.getByRole('button', { name: /Expand or collapse Sidney Laruel/ });
    if (await toggle.count()) { await toggle.first().click(); await page.waitForTimeout(150); }
    const reveal = page.locator('.cc-row', { hasText: '@sidney_test' }).first().locator('button[aria-label="Reveal password"]');
    if (await reveal.count()) { await reveal.first().click().catch(() => {}); await page.waitForTimeout(150); }
    await shoot(page, `${theme}-expanded`);

    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(`done (${LABEL})`);
})().catch(err => { console.error(err.stack || err.message || err); server.close(); process.exit(1); });
