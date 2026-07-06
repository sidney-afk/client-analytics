'use strict';
/*
 * Private visual aid for §10.8.6. This does not self-grade pixels; it captures
 * paired artifact/wired screenshots for reviewer inspection.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = process.env.SYNCVIEW_PROD_PARITY_SHOTS
  ? path.resolve(process.env.SYNCVIEW_PROD_PARITY_SHOTS)
  : path.join(root, '.codex-tmp', 'prod-parity-converge-session-2');
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

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: true });
}

async function safe(page, fn) {
  try { await fn(); } catch (e) { console.warn('[prod-parity-screenshots] skipped step:', e.message || e); }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const artifact = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const wired = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await wired.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__prodCopied = text; } },
      });
    } catch (_) {}
  });

  try {
    await artifact.goto(`http://127.0.0.1:${port}/docs/syncview-design/SyncView.html`, { waitUntil: 'domcontentloaded' });
    await wired.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await artifact.waitForSelector('.row, .empty-state', { timeout: 30000 });
    await wired.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });

    await shot(artifact, 'artifact-01-list');
    await shot(wired, 'wired-01-list');

    await safe(artifact, async () => {
      await artifact.locator('.row').first().click({ button: 'right' });
      await artifact.locator('[data-ctx="status"]').first().hover();
      await shot(artifact, 'artifact-02-context-status');
    });
    await safe(wired, async () => {
      await wired.locator('.prod-row').first().click({ button: 'right' });
      await wired.locator('[data-prod-ctx="status"]').first().hover();
      await shot(wired, 'wired-02-context-status');
    });

    await safe(artifact, async () => {
      await artifact.keyboard.press('Escape');
      await artifact.locator('.row').first().click();
      await artifact.waitForSelector('.d-title', { timeout: 10000 });
      await shot(artifact, 'artifact-03-detail');
      await artifact.locator('[data-due]').first().click();
      await artifact.locator('[data-set="__custom__"]').first().click();
      await shot(artifact, 'artifact-04-due-calendar');
    });
    await safe(wired, async () => {
      await wired.keyboard.press('Escape');
      const id = await wired.locator('.prod-row').first().getAttribute('data-prod-row');
      await wired.evaluate(rowId => window._prodOpenDeliverable(rowId), id);
      await wired.waitForSelector('.prod-detail-title', { timeout: 10000 });
      await shot(wired, 'wired-03-detail');
      await wired.locator('[data-prod-prop="due"]').first().click();
      await wired.locator('[data-prod-set="__custom__"]').first().click();
      await shot(wired, 'wired-04-due-calendar');
    });

    await safe(artifact, async () => {
      await artifact.evaluate(() => { S.view = { type: 'projects', team: 'video' }; S.open = null; render(); });
      await artifact.waitForSelector('.board', { timeout: 10000 });
      await shot(artifact, 'artifact-05-projects-board');
    });
    await safe(wired, async () => {
      await wired.evaluate(() => window._prodOpenTeamView('video', 'board'));
      await wired.waitForSelector('.prod-board', { timeout: 10000 });
      await shot(wired, 'wired-05-projects-board');
    });

    await safe(artifact, async () => {
      await artifact.keyboard.press('Escape');
      await artifact.evaluate(() => { S.view = { type: 'issues', team: 'video' }; S.open = null; S.filters = []; render(); });
      await artifact.locator('#filterbtn').click();
      await artifact.locator('[data-ffield="status"]').first().hover();
      await shot(artifact, 'artifact-06-filters-open');
    });
    await safe(wired, async () => {
      await wired.keyboard.press('Escape');
      await wired.evaluate(() => window._prodOpenTeamView('video', 'list'));
      await wired.waitForSelector('.prod-row, .prod-empty-state', { timeout: 10000 });
      await wired.locator('#prodFilterBtn').click();
      await wired.locator('[data-prod-ffield="status"]').first().hover();
      await shot(wired, 'wired-06-filters-open');
    });

    await safe(artifact, async () => {
      await artifact.keyboard.press('Escape');
      await artifact.locator('#groupbtn').click();
      await shot(artifact, 'artifact-07-group-by-menu');
    });
    await safe(wired, async () => {
      await wired.keyboard.press('Escape');
      await wired.locator('#prodGroupBtn').click();
      await shot(wired, 'wired-07-group-by-menu');
    });

    await safe(artifact, async () => {
      await artifact.keyboard.press('Escape');
      await artifact.evaluate(() => { S.view = { type: 'projects', team: 'video' }; S.projectOpen = null; S.colCollapsed = new Set(); render(); });
      await artifact.locator('[data-pcolcollapse]').first().click();
      await shot(artifact, 'artifact-08-collapsed-column');
    });
    await safe(wired, async () => {
      await wired.keyboard.press('Escape');
      await wired.evaluate(() => { window._prodOpenTeamView('video', 'board'); });
      await wired.waitForSelector('.prod-board', { timeout: 10000 });
      await wired.locator('[data-prod-pcolcollapse]').first().click();
      await shot(wired, 'wired-08-collapsed-column');
    });

    await safe(artifact, async () => {
      await artifact.keyboard.press('Escape');
      await artifact.locator('.sb-icobtn').click();
      await shot(artifact, 'artifact-09-palette');
    });
    await safe(wired, async () => {
      await wired.keyboard.press('Escape');
      await wired.locator('.prod-search-btn').click();
      await shot(wired, 'wired-09-palette');
    });

    await safe(artifact, async () => {
      await artifact.keyboard.press('Escape');
      await artifact.evaluate(() => { S.view = { type: 'issues', team: 'video' }; S.tab = 'active'; S.filters = [{ field: 'status', values: ['backlog'] }]; render(); });
      await shot(artifact, 'artifact-10-empty-state');
    });
    await safe(wired, async () => {
      await wired.keyboard.press('Escape');
      await wired.evaluate(() => { _prodState.view = 'list'; _prodState.team = 'video'; _prodState.clientSlug = ''; _prodState.tab = 'active'; _prodState.filters = [{ field: 'status', values: ['backlog'] }]; _prodRender(); });
      await shot(wired, 'wired-10-empty-state');
    });

    console.log('prod-parity-screenshots wrote paired shots to ' + outDir);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
