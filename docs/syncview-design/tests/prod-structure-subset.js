'use strict';
/*
 * Read-only structural subset adapted from the design-kit behav/sweep suites.
 *
 * Source of truth: docs/syncview-design/SyncView.html renderSidebar,
 * renderList/rowHTML, renderProjects, renderDetail, and statusSVG.
 * Mutation assertions from behav.js/sweep.js stay deferred to B3/B4; this lane
 * verifies the wired ?prod=1 tab has the same structure while remaining write-silent.
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

async function text(page, sel) {
  return (await page.locator(sel).first().textContent().catch(() => '') || '').trim();
}

async function expectCount(page, sel, min, label) {
  const n = await page.locator(sel).count();
  if (n < min) throw new Error(label + ' expected at least ' + min + ', saw ' + n);
  return n;
}

async function assertNoWriteRequests(requests) {
  const writes = requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
  if (writes.length) {
    throw new Error('Production structure subset made write-like browser requests: '
      + writes.slice(0, 5).map(r => `${r.method} ${r.url}`).join(' | '));
  }
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const requests = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push({ method: req.method(), url: req.url() }));
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));

  try {
    await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    if (await page.locator('.prod-error').count()) throw new Error('Production preview rendered an error card');

    if (!(await text(page, '.prod-brand')).includes('SyncView')) throw new Error('Sidebar brand missing');
    if (!(await text(page, '.prod-preview-chip')).includes('Preview - read-only')) throw new Error('Preview chip missing');
    if (!(await page.locator('.prod-search-btn[title*="Search"]').count())) throw new Error('Search command button missing');
    if (!(await page.locator('.prod-nav-btn', { hasText: 'My issues' }).count())) throw new Error('My issues nav missing');
    if (!(await page.locator('.prod-nav-section', { hasText: 'Workspace' }).count())) throw new Error('Workspace section missing');
    if (!(await page.locator('.prod-nav-btn', { hasText: 'Projects' }).count())) throw new Error('Projects nav missing');
    if (!(await page.locator('.prod-nav-section', { hasText: 'Your teams' }).count())) throw new Error('Your teams section missing');
    if (!(await page.locator('.prod-team-hd', { hasText: 'Video' }).count())) throw new Error('Video team missing');
    if (!(await page.locator('.prod-team-hd', { hasText: 'Graphics' }).count())) throw new Error('Graphics team missing');
    const removedNav = await page.locator('.prod-side').evaluate(el => /Inbox|Triage|Views|Invite|Switch workspace/.test(el.textContent || ''));
    if (removedNav) throw new Error('Removed prototype navigation item leaked into sidebar');

    await expectCount(page, '.prod-group .prod-status svg', 1, 'status-group glyphs');
    await expectCount(page, '.prod-group [data-prod-disabled="add-deliverable"][title="Preview - read-only"]', 1, 'disabled group add controls');
    const row = page.locator('.prod-row').first();
    if (!(await row.count())) throw new Error('No migrated rows rendered');
    for (const sel of ['.prod-check', '.prod-id', '.prod-status svg', '.prod-title b', '.prod-chip', '.prod-due', '.prod-avatar', '.prod-created']) {
      if (!(await row.locator(sel).count())) throw new Error('List row missing artifact part: ' + sel);
    }

    for (const tab of ['Active', 'Backlog', 'All issues']) {
      if (!(await page.locator('.prod-tab', { hasText: tab }).count())) throw new Error('Issue tab missing: ' + tab);
    }
    if (!(await page.locator('.prod-icon-btn[title="Preview - read-only"]').count())) throw new Error('Topbar inert controls missing');

    await row.click();
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    await expectCount(page, '[data-prod-detail-card="properties"]', 1, 'Properties detail card');
    await expectCount(page, '[data-prod-detail-card="project"]', 1, 'Project detail card');
    await expectCount(page, '.prod-subsection', 1, 'Sub-issues/detail sections');
    if (!(await text(page, '.prod-activity')).includes('Activity')) throw new Error('Activity section missing');
    if (!(await page.locator('[data-prod-disabled="composer"][title="Preview - read-only"]:disabled').count())) throw new Error('Disabled composer missing');
    if (!(await page.locator('[data-prod-disabled="detail-controls"][title="Preview - read-only"]:disabled').count())) throw new Error('Disabled detail controls missing');
    if (await page.locator('.prod-parent-link').count()) {
      await expectCount(page, '[data-prod-detail-card="parent"]', 1, 'Parent issue detail card');
    }

    await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
    await page.waitForSelector('.prod-board', { timeout: 10000 });
    const columns = await page.locator('.prod-col').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-prod-col')));
    for (const col of ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled']) {
      if (!columns.includes(col)) throw new Error('Projects board missing column: ' + col);
    }
    await expectCount(page, '.prod-col-head [data-prod-disabled="add-client-board-card"][title="Preview - read-only"]', 1, 'disabled board add controls');
    await expectCount(page, '[data-prod-client-card]', 1, 'project cards');
    const card = page.locator('[data-prod-client-card]').first();
    for (const sel of ['.prod-card-check', '.prod-card-ico', '.prod-card-title', '.prod-card-status svg', '.prod-avatar']) {
      if (!(await card.locator(sel).count())) throw new Error('Project card missing artifact part: ' + sel);
    }

    await page.locator('.prod-nav').filter({ hasText: 'Video' }).locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
    await page.waitForSelector('.prod-board', { timeout: 10000 });
    const teamUrl = new URL(page.url());
    if (teamUrl.searchParams.get('prod') !== '1' || teamUrl.searchParams.get('team') !== 'video' || teamUrl.searchParams.get('view') !== 'board') {
      throw new Error('Team-scoped Projects board did not preserve ?prod=1&team=video&view=board');
    }

    await assertNoWriteRequests(requests);
    if (errors.length) throw new Error('Browser errors: ' + errors.slice(0, 3).join(' | '));
    console.log('prod-structure-subset: artifact sidebar, list rows, status glyphs, detail cards, projects board, and read-only controls passed');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
