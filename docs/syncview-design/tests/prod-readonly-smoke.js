'use strict';
/*
 * Track B B2 wired-tab smoke suite.
 *
 * The original design-kit suites in this folder target the standalone prototype
 * and intentionally exercise write interactions. B2 is read-only, so this lane
 * checks the wired SyncView Production preview surface instead:
 *   - ?prod=1 mounts without the analytics data path
 *   - migrated B1 rows render in the list
 *   - team filters, project-board filters, detail, batch links, and deep links work
 *   - the projects board renders all locked columns
 *   - visible write affordances remain authority-guarded or explicitly disabled
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

/* Where the suite has got to, printed as it goes.
 *
 * CI redirects this suite's whole output to a private runner-only log and
 * publishes one code from a fixed allowlist, so a red run said exactly
 * `Production read-only smoke [timeout_unspecified]` and nothing else -- the
 * same "which half broke?" blindness the per-suite summary was added to cure,
 * one level further in. Three separate sittings then went looking for the cause
 * by reading sources, because the sandbox this is maintained from cannot run
 * Chromium against a network at all.
 *
 * The marker is a bare token. prod-polish-gate.js harvests the legal stage names
 * out of THIS file's source and will only echo a name it found there, so nothing
 * this suite prints at runtime can reach a public log -- the same discipline as
 * BEHAV_WIRED_CHECKS. Keep the argument a plain single-quoted literal or the
 * gate will not see it and the stage silently stops being reportable. */
function stage(name) { console.log('SMOKE_STAGE ' + name); }

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
  const isCommentRead = r => {
    if (r.method !== 'POST') return false;
    let pathname = '';
    try { pathname = new URL(r.url).pathname; } catch (e) {}
    if (pathname !== '/functions/v1/production-comments') return false;
    let body = null;
    try { body = JSON.parse(r.postData || 'null'); } catch (e) { return false; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const keys = Object.keys(body).sort();
    if (keys.join(',') !== 'before,deliverable_id,limit') return false;
    return typeof body.deliverable_id === 'string'
      && body.deliverable_id.length > 0
      && body.limit === 50
      && (body.before === null || (body.before && typeof body.before === 'object'
        && typeof body.before.created_at === 'string' && typeof body.before.id === 'string'));
  };
  /* Two PROTECTED READS that happen to be POSTs, recognised by their exact
     body shape rather than by their verb.
     `asset_access_read` and `batch_files_read` carry no patch, no operation and
     no entity — they cannot mutate anything, and the gateway routes them by
     `action` before it reaches any write path. They are POSTs only because the
     typed asset columns are not browser-readable and the request has to carry a
     scope. prod-structure-subset has recognised the first this way since it
     shipped; this suite had not needed to, because until 2026-08-31 the surface
     it walks never opened anything that asked for one. It does now: a batch
     parent reads the post-level assets through a child, and the sub-issue list
     reads the file links behind its pills.
     The allowlist stays keyed on the EXACT key set. A shape-blind exemption for
     "reads" would be a hole big enough for a real write to walk through, which
     is the whole point of this guard. */
  const isProtectedRead = (r, action, keys) => {
    if (r.method !== 'POST') return false;
    let pathname = '';
    try { pathname = new URL(r.url).pathname; } catch (e) {}
    if (pathname !== '/functions/v1/production-write') return false;
    let body = null;
    try { body = JSON.parse(r.postData || 'null'); } catch (e) { return false; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    if (Object.keys(body).sort().join(',') !== keys) return false;
    return body.action === action && body.surface === 'production';
  };
  const writes = requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)
    && !isCommentRead(r)
    && !isProtectedRead(r, 'asset_access_read', 'action,client_slug,id,surface')
    && !isProtectedRead(r, 'batch_files_read', 'action,batch_id,client_slug,surface'));
  if (writes.length) {
    throw new Error('Production preview made write-like browser requests: '
      + writes.slice(0, 5).map(r => `${r.method} ${r.url}`).join(' | '));
  }
}

async function newAuthedPage(browser, viewport, errors, requests) {
  const page = await browser.newPage(viewport);
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push({ method: req.method(), url: req.url(), postData: req.postData() || '' }));
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));
  return page;
}

(async () => {
  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  if (!indexSource.includes("q.get('prod') === '1') target = 'production'")) {
    throw new Error('Production query route is not mapped to the Production boot skeleton');
  }
  if (!indexSource.includes('html[data-boot-nav="production"] .boot-skeleton-production')
    || !indexSource.includes('boot-skeleton-variant boot-skeleton-production')) {
    throw new Error('Production boot skeleton is missing from the pre-paint skeleton set');
  }

  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const requests = [];
  const page = await newAuthedPage(browser, { viewport: { width: 1440, height: 950 } }, errors, requests);

  try {
    stage('boot');
    await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    const errorText = await page.locator('.prod-error').first().textContent().catch(() => '');
    if (errorText) throw new Error('Production preview rendered an error card');
    if (await page.locator('#navProd').count() !== 1) throw new Error('Production nav item was not mounted');

    stage('list_rows');
    const rows = await page.locator('.prod-row').count();
    if (rows < 1) throw new Error('Production preview rendered no migrated rows');
    const firstRowId = await page.locator('.prod-row').first().getAttribute('data-prod-row');
    if (!firstRowId) throw new Error('Production rows do not expose stable row ids');
    const rowStatuses = await page.locator('.prod-row').evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('data-prod-status')).filter(Boolean))]);
    if (!rowStatuses.length) throw new Error('Production rows did not expose migrated status slugs');
    await maybeShot(page, 'prod-list');

    stage('team_filter');
    await page.locator('.prod-nav').filter({ hasText: 'Video' }).locator('.prod-nav-btn', { hasText: 'Issues' }).first().click();
    await page.waitForSelector('.prod-row, .prod-empty', { timeout: 10000 });
    if (!new URL(page.url()).searchParams.has('team')) throw new Error('Video team filter did not preserve ?prod=1&team=...');
    const videoRows = await page.locator('.prod-row').count();
    if (videoRows) {
      const badTeamRows = await page.locator('.prod-row').evaluateAll(nodes => nodes.filter(n => n.getAttribute('data-prod-team') !== 'video').length);
      if (badTeamRows) throw new Error('Video team view included non-video deliverables');
    }
    await page.evaluate(() => window._prodOpenTeamView('all', 'list'));
    await page.waitForSelector('.prod-row', { timeout: 10000 });

    stage('detail_open');
    await page.locator('.prod-row').first().click();
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    if (await page.locator('.prod-detail-title').count() !== 1) throw new Error('Detail view did not open');
    const detailId = await page.locator('.prod-detail').first().getAttribute('data-prod-detail');
    if (!detailId) throw new Error('Detail view does not expose its deliverable id');
    const detailUrl = new URL(page.url());
    if (detailUrl.searchParams.get('prod') !== '1' || !detailUrl.searchParams.get('d')) throw new Error('Detail view did not write a stable ?prod=1&d=... URL');
    stage('detail_guards');
    const disabledControls = await page.locator('[data-prod-disabled]').count();
    if (disabledControls < 1) throw new Error('No disabled write affordances were rendered');
    const unguarded = await page.locator('[data-prod-disabled]').evaluateAll(nodes => nodes.filter(n => {
      if (n.disabled) return false;
      const titleOk = !!(n.getAttribute('title') || n.getAttribute('data-prod-tip'));
      const handler = String(n.getAttribute('onclick') || '');
      const guardOk = handler.includes('_prodReadonlyGuard') || handler.includes('_prodToast');
      return !(titleOk && guardOk);
    }).length);
    if (unguarded) throw new Error('A read-only write affordance is neither disabled nor guarded');
    if (!/read-only|authority|Sign in/.test(await text(page, '.prod-composer-box'))) throw new Error('Comment composer did not render the authority/authentication-gate hint');
    stage('comments_state');
    await page.waitForSelector('.prod-activity [data-prod-comments-state], .prod-activity .prod-comment-loading', { timeout: 15000 });
    await maybeShot(page, 'prod-detail');

    // The "Parent issue" side card opens the parent DELIVERABLE, not a batch:
    // c4c28479 (adapter fidelity, 2026-07-06) moved parents from batch rows to
    // real deliverable rows, so this control has written ?prod=1&d=<parent>
    // ever since. The assertion below kept demanding the pre-c4c28479 ?batch=
    // URL and only ever ran when the first row happened to have a parent, so it
    // sat green for seven weeks and went red the moment the data changed.
    /* Split into three markers on 2026-08-31, the run after the stage markers
       landed. The first instrumented run said `timeout_unspecified@parent_link`,
       which narrowed fourteen sections to one -- but this block holds three
       separate awaits of two different shapes, and a `locator.*` timeout
       classifies the same way for all of them. Splitting says WHICH.
       The click is bounded explicitly: every other wait in this file names its
       own timeout, and the 30s default was quietly spending a third of the fast
       lane's wall clock on one hung action. */
    stage('parent_link_probe');
    const parentBtn = page.locator('.prod-parent-link').first();
    if (await parentBtn.count()) {
      const childId = await page.locator('.prod-detail').first().getAttribute('data-prod-detail');
      stage('parent_link_click');
      await parentBtn.click({ timeout: 10000 });
      stage('parent_link_detail');
      await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
      const parentUrl = new URL(page.url());
      const parentId = parentUrl.searchParams.get('d');
      if (parentUrl.searchParams.get('prod') !== '1' || !parentId) throw new Error('Parent issue did not write a stable ?prod=1&d=... URL');
      if (parentId === childId) throw new Error('Parent issue link did not navigate off the child deliverable');
      if ((await page.locator('.prod-detail').first().getAttribute('data-prod-detail')) !== parentId) {
        throw new Error('Parent issue link opened a detail that does not match its own ?d= URL');
      }
    }

    stage('deep_link');
    await page.goto(`http://127.0.0.1:${port}/?prod=1&d=${encodeURIComponent(firstRowId)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-detail-title', { timeout: 30000 });
    if ((await page.locator('.prod-detail').first().getAttribute('data-prod-detail')) !== firstRowId) {
      throw new Error('Direct deliverable deep link did not open the requested row');
    }

    stage('board_open');
    await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
    await page.waitForSelector('.prod-board', { timeout: 10000 });
    if (await page.locator('.prod-col').count() !== 6) throw new Error('Projects board columns did not render');
    const boardCols = await page.locator('.prod-col').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-prod-col')));
    const expectedCols = ['backlog', 'planned', 'prog', 'paused', 'completed', 'canceled'];
    if (expectedCols.some(c => !boardCols.includes(c))) throw new Error('Projects board is missing expected columns: ' + boardCols.join(','));
    if (await page.locator('[data-prod-client-card]').count() < 1) throw new Error('Projects board rendered no real-data project cards');
    await maybeShot(page, 'prod-board');

    stage('project_detail');
    const clientSlug = await page.locator('[data-prod-client-card]').first().getAttribute('data-prod-client-card');
    if (!clientSlug) throw new Error('Projects board cards do not expose stable client slugs');
    await page.locator('[data-prod-client-card]').first().click();
    await page.waitForSelector('[data-prod-project-detail]', { timeout: 10000 });
    const projectUrl = new URL(page.url());
    if (projectUrl.searchParams.get('client') !== clientSlug || projectUrl.searchParams.get('view') !== 'project') throw new Error('Projects board card did not write a stable ?prod=1&view=project&client=... URL');
    if (await page.locator('[data-prod-pstatus]').count() < 1 || await page.locator('[data-prod-plead]').count() < 1 || await page.locator('[data-prod-ptarget]').count() < 1) {
      throw new Error('Project detail did not expose guarded status/lead/target controls');
    }
    stage('client_list');
    await page.evaluate(slug => window._prodOpenClient(slug), clientSlug);
    await page.waitForSelector('.prod-row', { timeout: 10000 });
    const clientUrl = new URL(page.url());
    if (clientUrl.searchParams.get('client') !== clientSlug || clientUrl.searchParams.get('view')) throw new Error('Client list did not write a stable ?prod=1&client=... URL');
    const badClientRows = await page.locator('.prod-row').evaluateAll((nodes, slug) => nodes.filter(n => n.getAttribute('data-prod-client') !== slug).length, clientSlug);
    if (badClientRows) throw new Error('Client-filtered list included another client');

    stage('mobile_boot');
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
    stage('mobile_detail');
    await mobile.locator('.prod-row').first().click();
    await mobile.waitForSelector('.prod-detail-title', { timeout: 10000 });
    if (await mobile.locator('.prod-detail-title').count() !== 1) throw new Error('Mobile detail view did not open');
    await maybeShot(mobile, 'prod-mobile-detail');
    await mobile.close();

    stage('no_write_requests');
    await assertNoWriteRequests(requests);
    if (errors.length) throw new Error('Browser errors: ' + errors.slice(0, 3).join(' | '));
    console.log('prod-readonly-smoke: list, team filter, client filter, detail, deep link, batch link, projects board, mobile, guarded controls, no-write requests, and console checks passed');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
