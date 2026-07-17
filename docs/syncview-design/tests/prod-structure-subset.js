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

async function expectExactCount(page, sel, expected, label) {
  const n = await page.locator(sel).count();
  if (n !== expected) throw new Error(label + ' expected ' + expected + ', saw ' + n);
  return n;
}

async function expectToastContains(page, expected, label) {
  await page.waitForSelector('#prodToast.show', { timeout: 3000 });
  const actual = await text(page, '#prodToast');
  if (!actual.includes(expected)) throw new Error(label + ' expected toast containing "' + expected + '", saw "' + actual + '"');
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
  const writes = requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method) && !isCommentRead(r));
  if (writes.length) {
    throw new Error('Production structure subset made write-like browser requests: '
      + writes.slice(0, 5).map(r => `${r.method} ${r.url}`).join(' | '));
  }
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push({ method: req.method(), url: req.url(), postData: req.postData() || '' }));
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__prodCopied = text; } },
      });
    } catch (_) {}
  });
  await page.route('**/functions/v1/production-comments', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ comments: [], next_cursor: null, has_more: false }),
  }));

  try {
    await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    if (await page.locator('.prod-error').count()) throw new Error('Production preview rendered an error card');
    const adapterFixture = await page.evaluate(() => {
      const adapted = window._prodAdapter({
        clients: [{ slug: 'noemoji', display_name: 'No Emoji', board_status: 'in_progress' }],
        members: [{ id: 'm1', name: 'Maya Singh' }],
        batches: [{ id: 'b1', client_slug: 'noemoji', team: 'video', name: 'Root Batch' }],
        deliverables: [
          { id: 'parent', identifier: 'VID-1', batch_id: 'b1', client_slug: 'noemoji', team: 'video', title: 'Root Batch', status: 'in_progress', assignee_id: 'm1' },
          { id: 'child-a', identifier: 'VID-2', batch_id: 'b1', client_slug: 'noemoji', team: 'video', title: 'Child A', status: 'smm_approval', assignee_id: 'm1' },
          { id: 'child-b', identifier: 'VID-3', batch_id: 'b1', client_slug: 'noemoji', team: 'video', title: 'Child B', status: 'client_approval', assignee_id: 'm1' },
          { id: 'child-c', identifier: 'VID-4', batch_id: 'b1', client_slug: 'noemoji', team: 'video', title: 'Child C', status: 'canceled', assignee_id: 'm1', raw_issue_canceled_at: '2026-07-08T20:26:05.371Z' },
          { id: 'child-d', identifier: 'VID-5', batch_id: 'b1', client_slug: 'noemoji', team: 'video', title: 'Child D', status: 'approved', assignee_id: 'm1', raw_issue_archived_at: '2026-07-08T20:26:05.371Z' },
        ],
      });
      return {
        parentChildren: adapted.ISSUES.filter(i => i.parent === 'parent').map(i => i.id).sort(),
        childAChildren: adapted.ISSUES.filter(i => i.parent === 'child-a').length,
        statusKeys: adapted.ISSUES.map(i => i.status),
        canceledIssue: adapted.ISSUES.some(i => i.id === 'child-c' && i.status === 'canceled'),
        archivedDropped: !adapted.ISSUES.some(i => i.id === 'child-d'),
        projectEmoji: adapted.PROJECTS.noemoji.emoji,
        boardStatus: adapted.CLIENTS[0].status,
        editorInit: adapted.EDITORS.m1.init,
        editorColor: adapted.EDITORS.m1.color,
      };
    });
    if (adapterFixture.parentChildren.join(',') !== 'child-a,child-b,child-c') throw new Error('Adapter did not put children only under the batch-parent issue');
    if (adapterFixture.childAChildren !== 0) throw new Error('Adapter let a sibling list another sibling as a child');
    if (!adapterFixture.statusKeys.includes('prog') || !adapterFixture.statusKeys.includes('smm') || !adapterFixture.statusKeys.includes('client')) throw new Error('Adapter did not map B1 status slugs to artifact keys');
    if (!adapterFixture.canceledIssue) throw new Error('Adapter dropped a canceled deliverable; canceled is a visible status (Canceled group), not a deleted row');
    if (!adapterFixture.archivedDropped) throw new Error('Adapter kept a deliverable with an archived marker; archive/delete markers must hide rows');
    if (adapterFixture.projectEmoji !== '') throw new Error('Adapter should preserve missing emoji as empty so the project glyph fallback renders');
    if (adapterFixture.boardStatus !== 'prog') throw new Error('Adapter did not map board in_progress to artifact prog');
    if (adapterFixture.editorInit !== 'MS' || !/^#[0-9a-f]{6}$/i.test(adapterFixture.editorColor)) throw new Error('Adapter did not produce artifact editor initials/color');

    if (!(await text(page, '.prod-brand')).includes('SyncView')) throw new Error('Sidebar brand missing');
    await expectExactCount(page, '.prod-brand[data-prod-brandmenu]', 0, 'brand workspace menu trigger removed');
    await expectExactCount(page, '.prod-brand .prod-brand-caret', 0, 'brand workspace caret removed');
    await page.locator('.prod-brand').click();
    await expectExactCount(page, '.prod-pop [data-prod-brand-action]', 0, 'brand workspace menu removed');
    if (!(await text(page, '.prod-preview-chip')).includes('Preview - read-only')) throw new Error('Preview chip missing');
    if (!(await page.locator('.prod-search-btn[title*="Search"]').count())) throw new Error('Search command button missing');
    await expectExactCount(page, '.prod-topbar [data-prod-disabled="favorite-view"], .prod-topbar [data-prod-disabled="favorite-issue"], .prod-topbar [data-prod-disabled="favorite-project"], .prod-topbar [data-prod-disabled="notifications"]', 0, 'fake topbar favorite/notification controls');
    await page.keyboard.press('Slash');
    await expectCount(page, '.prod-cmd .prod-cmd-input', 1, 'Slash opens command palette');
    await page.keyboard.press('Escape');
    if (!(await page.locator('.prod-nav-btn', { hasText: 'My issues' }).count())) throw new Error('My issues nav missing');
    if (!(await page.locator('.prod-nav-section', { hasText: 'Workspace' }).count())) throw new Error('Workspace section missing');
    if (!(await page.locator('.prod-nav-btn', { hasText: 'Projects' }).count())) throw new Error('Projects nav missing');
    if (!(await page.locator('.prod-nav-section', { hasText: 'Your teams' }).count())) throw new Error('Your teams section missing');
    if (!(await page.locator('.prod-team-hd', { hasText: 'Video' }).count())) throw new Error('Video team missing');
    if (!(await page.locator('.prod-team-hd', { hasText: 'Graphics' }).count())) throw new Error('Graphics team missing');
    const teamIssueCountBadges = await page.locator('.prod-team-hd', { hasText: /Video|Graphics/ }).evaluateAll(heads => heads.reduce((total, head) => {
      const nav = head.closest('.prod-nav');
      const issues = nav ? [...nav.querySelectorAll('.prod-nav-btn')].find(btn => (btn.textContent || '').includes('Issues')) : null;
      return total + (issues && issues.querySelector('.prod-nav-count') ? 1 : 0);
    }, 0));
    if (teamIssueCountBadges) throw new Error('Team issue nav should not show numeric sidebar badges');
    const removedNav = await page.locator('.prod-side').evaluate(el => /Inbox|Triage|Views|Invite/.test(el.textContent || ''));
    if (removedNav) throw new Error('Removed prototype navigation item leaked into sidebar');

    await expectCount(page, '.prod-group .prod-status svg', 1, 'status-group glyphs');
    await expectExactCount(page, '.prod-listwrap .prod-group [data-prod-disabled="add-deliverable"]', 0, 'issue-list group add controls');
    const groupContextPrevented = await page.locator('.prod-group').first().evaluate(el => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    if (!groupContextPrevented) throw new Error('Production group header did not suppress the browser context menu');
    const beforeCollapse = await page.locator('.prod-row').count();
    await page.locator('.prod-group').first().click();
    const afterCollapse = await page.locator('.prod-row').count();
    if (!(afterCollapse < beforeCollapse) || !(await page.locator('.prod-group.collapsed .prod-group-chev').count())) throw new Error('Group header did not collapse with chevron state');
    await page.locator('.prod-group').first().click();
    await page.locator('.prod-group-check').first().click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    if (!(await text(page, '#prodToast')).includes('Preview - read-only')) throw new Error('Group checkbox did not guard read-only selection');
    await page.keyboard.press('Escape');
    await page.locator('#prodFilterBtn').click();
    await expectCount(page, '.prod-pop [data-prod-ffield="status"]', 1, 'Filter menu status condition');
    await page.locator('.prod-pop').first().evaluate(pop => {
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    await expectCount(page, '#prodLayer .prod-pop [data-prod-search]', 1, 'Filter keyboard ArrowRight opens value picker');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window._prodClearLayer && window._prodClearLayer());
    await page.locator('#prodFilterBtn').click();
    await expectCount(page, '.prod-pop [data-prod-ffield="status"]', 1, 'Filter menu status condition after keyboard submenu check');
    await expectCount(page, '.prod-pop [data-prod-ffield="assignee"] .mic svg', 1, 'Filter menu assignee uses person icon');
    await page.locator('.prod-pop [data-prod-ffield="status"]').hover();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-search]', 1, 'Filter value picker is searchable');
    await page.fill('#prodLayer .prod-pop [data-prod-search]', 'zzzznomatch');
    await expectCount(page, '#prodLayer .prod-pop-empty', 1, 'Filter value picker no-results row');
    await page.fill('#prodLayer .prod-pop [data-prod-search]', '');
    await page.locator('#prodLayer .prod-pop [data-prod-fv]').first().click();
    await expectCount(page, '.prod-filter-pill.interactive', 1, 'Filter pill after applying condition');
    await page.locator('.prod-filter-pill .fx').first().click();
    await expectExactCount(page, '.prod-filter-pill.interactive', 0, 'Remove filter clears pill');
    await page.locator('#prodGroupBtn').click();
    await expectCount(page, '.prod-pop [data-prod-grp="status"]', 1, 'Display menu status grouping');
    await expectCount(page, '.prod-pop [data-prod-show-subissues]', 1, 'Display menu Show sub-issues toggle');
    await expectCount(page, '.prod-pop [data-prod-order="due"]', 1, 'Display menu due ordering');
    await expectCount(page, '.prod-pop [data-prod-order="updated"]', 1, 'Display menu updated ordering');
    await expectCount(page, '.prod-pop [data-prod-order="created"]', 1, 'Display menu created ordering');
    await page.locator('.prod-pop [data-prod-grp="assignee"]').click();
    if (!(await page.evaluate(() => _prodState.groupBy === 'assignee'))) throw new Error('Display menu did not switch to assignee grouping');
    await page.locator('#prodGroupBtn').click();
    await page.locator('.prod-pop [data-prod-grp="client"]').click();
    if (!(await page.evaluate(() => _prodState.groupBy === 'client'))) throw new Error('Display menu did not switch to client grouping');
    await expectCount(page, '.prod-group-title.navp[data-prod-project]', 1, 'Client-group header opens project/client view');
    await page.evaluate(() => { _prodState.groupBy = 'status'; _prodRender(); });
    await page.locator('.prod-search-btn').click();
    await expectCount(page, '.prod-cmd .prod-cmd-input', 1, 'Command palette input');
    await page.fill('.prod-cmd-input', await page.locator('.prod-row .prod-id').first().textContent());
    await expectCount(page, '.prod-cmd-item', 1, 'Command palette results');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { _prodState.filters = [{ field: 'status', values: ['__none__'] }]; _prodRender(); });
    await expectCount(page, '[data-prod-empty-state] .es-clear', 1, 'Filtered empty state with Clear filters');
    await page.locator('.es-clear').click();
    await expectExactCount(page, '[data-prod-empty-state]', 0, 'Clear filters exits empty state');
    const row = page.locator('.prod-row').first();
    if (!(await row.count())) throw new Error('No migrated rows rendered');
    const firstRowId = await row.getAttribute('data-prod-row');
    const lockedWriteState = await page.evaluate(id => {
      _syncviewStaffIdentityMem = {
        key: 'structure-fixture-key',
        role: 'admin',
        member: { id: 'structure-admin', name: 'Structure Admin', role: 'admin', team: 'video' },
      };
      _syncviewStaffIdentityLoaded = true;
      _syncviewStaffIdentityVerified = true;
      _prodState.authority = { video: 'linear', graphics: 'linear' };
      _prodState.authorityLoaded = true;
      _prodRender();
      const issue = _prodIssue(id);
      return {
        team: _prodWriteTeam(issue && issue.team),
        canStatus: _prodCanWrite(issue, 'status'),
        statusGate: _prodWriteGateText(issue, 'status'),
        commentGate: _prodWriteGateText(issue, 'comment'),
        dueGate: _prodWriteGateText(issue, 'due'),
      };
    }, firstRowId);
    if (!['video', 'graphics'].includes(lockedWriteState.team)
      || lockedWriteState.canStatus
      || !lockedWriteState.statusGate.includes('stays read-only while Linear is authoritative.')) {
      throw new Error('Linear-authoritative fixture did not fail closed: ' + JSON.stringify(lockedWriteState));
    }
    await expectExactCount(row, '[data-prod-write="on"]', 0, 'Linear-authoritative fixture row exposes no writable controls');
    for (const sel of ['.prod-check', '.prod-id', '.prod-status svg', '.prod-title b', '.prod-chip', '.prod-due', '.prod-avatar', '.prod-created']) {
      if (!(await row.locator(sel).count())) throw new Error('List row missing artifact part: ' + sel);
    }
    await expectCount(page, '.prod-row .prod-chip-client[data-prod-crumbclient]', 1, 'row client chip navigation control');
    await expectCount(page, '.prod-row [data-prod-assign]', 1, 'row assignee picker control');
    await page.keyboard.press('x');
    await expectCount(page, '[data-prod-actionbar] [data-prod-select-count]', 1, 'x toggles focused/hovered row selection');
    await page.evaluate(() => { _prodState.selected.clear(); _prodRender(); });
    await page.keyboard.press('Control+a');
    await expectCount(page, '[data-prod-actionbar] [data-prod-select-count]', 1, 'read-only multi-select actionbar');
    if (await page.locator('#prodBulkStatus, #prodBulkAssign, #prodBulkDue').count()) throw new Error('Compact actionbar should not expose direct bulk status/assignee/due buttons');
    await page.locator('#prodBulkActions').click();
    await expectCount(page, '#prodLayer .prod-pop[data-prod-bulkcmd] [data-prod-search]', 1, 'bulk command menu search');
    const bulkLabels = await page.locator('#prodLayer .prod-pop[data-prod-bulkcmd] [data-prod-ctx] .mlbl').evaluateAll(els => els.map(el => el.textContent.trim()).join('|'));
    if (bulkLabels !== 'Assign to...|Change status...|Move to project...|Copy issue IDs|Change due date...|Delete issues') throw new Error('Unexpected bulk command menu: ' + bulkLabels);
    await page.evaluate(() => document.querySelector('#prodLayer [data-prod-ctx="status"]')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })));
    await expectExactCount(page, '#prodLayer .prod-pop [data-prod-pick]', 0, 'bulk command hover does not open a blocking picker');
    await page.locator('#prodLayer [data-prod-ctx="status"]').click();
    await expectExactCount(page, '#prodLayer .prod-pop [data-prod-pick]', 0, 'Linear-authoritative bulk status stays locked');
    await expectToastContains(page, lockedWriteState.statusGate, 'Linear-authoritative bulk status lock');
    await page.evaluate(() => window._prodClearLayer && window._prodClearLayer());
    await page.evaluate(() => { _prodState.selected.clear(); _prodRender(); });
    await row.locator('.prod-status').click();
    await expectExactCount(page, '.prod-pop [data-prod-pick]', 0, 'Linear-authoritative row status stays locked');
    const statusPickerUrl = new URL(page.url());
    if (statusPickerUrl.searchParams.get('d')) throw new Error('Clicking row status icon navigated the row instead of opening the picker');
    await expectToastContains(page, lockedWriteState.statusGate, 'Linear-authoritative row status lock');
    await page.keyboard.press('Escape');
    await row.click({ button: 'right' });
    await expectCount(page, '.prod-pop [data-prod-ctx="copy"]', 1, 'row context Copy link item');
    await page.locator('.prod-pop').first().evaluate(pop => {
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await expectExactCount(page, '#prodLayer .prod-pop [data-prod-pick]', 0, 'Linear-authoritative context keyboard status stays locked');
    await expectToastContains(page, lockedWriteState.statusGate, 'Linear-authoritative context keyboard lock');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window._prodClearLayer && window._prodClearLayer());
    const lockedContextState = await page.evaluate(() => ({
      view: _prodState.view,
      openId: _prodState.openId,
      rows: document.querySelectorAll('.prod-row').length,
      selected: _prodState.selected ? _prodState.selected.size : -1,
    }));
    if (lockedContextState.view !== 'list' || lockedContextState.openId || lockedContextState.rows < 1) {
      throw new Error('Linear-authoritative context lock changed list navigation: ' + JSON.stringify(lockedContextState));
    }
    await row.click({ button: 'right' });
    const contextText = await text(page, '.prod-pop');
    if (!contextText.includes('⇧D') || !contextText.includes('Ctrl ⌫')) throw new Error('Context menu keyboard hints do not match artifact glyphs');
    const popBg = await page.locator('.prod-pop').first().evaluate(el => getComputedStyle(el).backgroundColor);
    if (!popBg || popBg === 'rgba(0, 0, 0, 0)' || popBg === 'transparent') throw new Error('Production context menu background is transparent');
    await page.locator('.prod-pop [data-prod-ctx="status"]').hover();
    await expectExactCount(page, '#prodLayer .prod-pop [data-prod-pick]', 0, 'Linear-authoritative context hover status stays locked');
    await expectToastContains(page, lockedWriteState.statusGate, 'Linear-authoritative context hover lock');
    await expectCount(page, '.prod-pop [data-prod-disabled^="context-"][title="Preview - read-only"]', 1, 'row context disabled mutation items');
    await page.locator('.prod-pop [data-prod-ctx="copy"]').click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    const copiedIssueLink = await page.evaluate(() => window.__prodCopied || window.__prodLastCopied || '');
    if (!copiedIssueLink.includes('?prod=1') || !copiedIssueLink.includes('d=')) throw new Error('Row Copy link did not create a ?prod=1&d= deep link');
    await expectExactCount(page, '.prod-pop', 0, 'context menu closed after Copy link');

    for (const tab of ['Active', 'Backlog', 'All issues']) {
      if (!(await page.locator('.prod-tab', { hasText: tab }).count())) throw new Error('Issue tab missing: ' + tab);
    }
    await expectExactCount(page, '.prod-topbar [data-prod-disabled="favorite-view"], .prod-topbar [data-prod-disabled="favorite-issue"], .prod-topbar [data-prod-disabled="favorite-project"], .prod-topbar [data-prod-disabled="notifications"]', 0, 'fake topbar favorite/notification controls');

    await page.evaluate(id => window._prodOpenDeliverable(id), firstRowId);
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    const linkified = await page.evaluate(() => _prodLinkify('Ship **bold** and `code` and [docs](https://ex.com) plus https://y.com\n---\n## Client Resources\n**Instagram: [theopenposturedoc](<https://www.instagram.com/theopenposturedoc/#>)**\n**Brand Guidelines:** **[Document](<https://docs.google.com/document/d/abc/edit>)\n****Personal Pictures:** [**Folder**](<https://drive.google.com/drive/folders/abc>)'));
    if (!linkified.includes('<strong>bold</strong>') || !linkified.includes('<code>code</code>') || !linkified.includes('<a href="https://ex.com"') || !linkified.includes('prod-md-heading') || !linkified.includes('prod-md-rule') || !linkified.includes('<strong>Instagram: <a href="https://www.instagram.com/theopenposturedoc/#"') || !linkified.includes('<strong>Brand Guidelines:</strong> <a href="https://docs.google.com/document/d/abc/edit"') || !linkified.includes('<strong>Personal Pictures:</strong> <a href="https://drive.google.com/drive/folders/abc"') || linkified.includes('****')) {
      throw new Error('Production markdown/link renderer does not match artifact shape');
    }
    await expectCount(page, '[data-prod-crumb-client]', 1, 'clickable client crumb');
    await page.locator('[data-prod-crumb-client]').first().click();
    await page.waitForSelector('[data-prod-project-detail]', { timeout: 10000 });
    const clientUrl = new URL(page.url());
    if (clientUrl.searchParams.get('prod') !== '1' || !clientUrl.searchParams.get('client')) {
      throw new Error('Client breadcrumb did not navigate to ?prod=1 project view');
    }
    await page.evaluate(id => window._prodOpenDeliverable(id), firstRowId);
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    await page.locator('.prod-detail').click({ button: 'right', position: { x: 18, y: 18 } });
    await expectCount(page, '.prod-pop [data-prod-ctx="copy"]', 1, 'detail context Copy link item');
    await page.keyboard.press('Escape');
    await expectExactCount(page, '.prod-pop', 0, 'Escape closes detail context menu');
    await page.evaluate(id => {
      if (_prodState.view !== 'detail' || _prodState.openId !== id) window._prodOpenDeliverable(id);
    }, firstRowId);
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    if (await page.locator('[data-prod-crumb-batch]').count()) {
      await page.locator('[data-prod-crumb-batch]').first().click();
      await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
      const parentUrl = new URL(page.url());
      if (parentUrl.searchParams.get('prod') !== '1' || !parentUrl.searchParams.get('d')) {
        throw new Error('Parent breadcrumb did not navigate to a ?prod=1 parent issue detail');
      }
      await page.evaluate(id => window._prodOpenDeliverable(id), firstRowId);
      await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    }
    await expectCount(page, '[data-prod-detail-card="properties"]', 1, 'Properties detail card');
    await expectCount(page, '[data-prod-detail-card="project"]', 1, 'Project detail card');
    if (!(await text(page, '.prod-activity')).includes('Comments')) throw new Error('Comments section missing');
    await page.waitForSelector('.prod-activity [data-prod-comments-state], .prod-activity .prod-comment-loading', { timeout: 10000 });
    const commentRowsAreBodyFirst = await page.evaluate(() => {
      const row = document.querySelector('.prod-comment');
      return !row || (!!row.querySelector('.prod-comment-author') && !!row.querySelector('.prod-comment-body'));
    });
    if (!commentRowsAreBodyFirst) throw new Error('Comment rows should render author and body');
    const composer = page.locator('[data-prod-disabled="composer"]');
    if (!(await composer.count()) || (await composer.first().getAttribute('title')) !== lockedWriteState.commentGate) {
      throw new Error('Linear-authoritative composer did not expose its lock reason');
    }
    await page.locator('[data-prod-disabled="composer"]').click();
    await expectToastContains(page, lockedWriteState.commentGate, 'Linear-authoritative composer lock');
    await expectExactCount(page, '[data-prod-disabled="detail-controls"], .prod-disabled-pill', 0, 'detail disabled scaffold controls');
    for (const operation of ['status', 'assignee', 'due']) {
      const control = page.locator('[data-prod-prop="' + operation + '"]').first();
      if ((await control.getAttribute('data-prod-write')) !== 'off'
        || (await control.getAttribute('aria-disabled')) !== 'true') {
        throw new Error('Linear-authoritative detail ' + operation + ' control was not marked locked');
      }
    }
    await page.locator('[data-prod-prop="due"]').first().dispatchEvent('click');
    await expectExactCount(page, '.prod-duepop', 0, 'Linear-authoritative detail due stays locked');
    await expectToastContains(page, lockedWriteState.dueGate, 'Linear-authoritative detail due lock');
    if (await page.locator('.prod-parent-link').count()) {
      await expectCount(page, '[data-prod-detail-card="parent"]', 1, 'Parent issue detail card');
    }
    const parentWithChild = await page.evaluate(() => {
      const rows = _prodIssues();
      const parent = rows.find(d => rows.some(k => k.parent === d.id));
      return parent ? parent.id : '';
    });
    if (parentWithChild) {
      await page.evaluate(id => window._prodOpenDeliverable(id), parentWithChild);
      await page.waitForSelector('[data-prod-section="subissues"] .prod-subrow', { timeout: 10000 });
      await expectCount(page, '[data-prod-disabled="add-subissue"][title="Preview - read-only"]', 1, 'guarded add sub-issue affordance');
      if (!(await text(page, '[data-prod-section="subissues"] [data-prod-disabled="add-subissue"]')).includes('Add sub-issues')) {
        throw new Error('Parent sub-issue affordance should use visible Add sub-issues text');
      }
      const parentSubIssueShape = await page.evaluate(() => {
        const row = document.querySelector('[data-prod-section="subissues"] .prod-subrow');
        const id = row ? row.getAttribute('data-prod-subrow') : '';
        const issue = id ? _prodIssue(id) : null;
        const label = issue ? _prodIssueLabel(issue) : '';
        const text = row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
        return !!row && !!row.querySelector('.prod-title') && !!row.querySelector('.prod-chip-client') && (!label || !text.includes(label));
      });
      if (!parentSubIssueShape) throw new Error('Parent sub-issue rows should show title plus project metadata, without child issue IDs');
      await page.locator('[data-prod-section="subissues"] .prod-subrow').first().click();
      await page.waitForSelector('[data-prod-subissue-of]', { timeout: 10000 });
      if (!(await text(page, '[data-prod-subissue-of]')).includes('Sub-issue of')) throw new Error('Child issue missing Sub-issue of body context');
      await expectCount(page, '.prod-detail-context .prod-context-project', 1, 'child issue project context chip');
    }
    await page.evaluate(() => window._prodSetView('list'));
    await page.waitForSelector('.prod-row, .prod-empty', { timeout: 10000 });
    const zeroChildRow = page.locator('.prod-row[data-prod-child-count="0"]').first();
    if (await zeroChildRow.count()) {
      await zeroChildRow.click();
      await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
      if (await page.locator('[data-prod-section="subissues"]').count()) {
        throw new Error('Empty Sub-issues section should be hidden');
      }
      await expectCount(page, '[data-prod-section="subissues-empty"] [data-prod-disabled="add-subissue"]', 1, 'leaf issue guarded Add sub-issues affordance');
    }
    await page.evaluate(() => window._prodSetView('list'));
    await page.waitForSelector('.prod-row, .prod-empty', { timeout: 10000 });
    const selfParentRow = page.locator('.prod-row[data-prod-self-parent="1"]').first();
    if (await selfParentRow.count()) {
      await selfParentRow.click();
      await page.waitForSelector('.prod-detail[data-prod-self-parent="1"]', { timeout: 10000 });
      if (await page.locator('[data-prod-crumb-batch], [data-prod-detail-card="parent"]').count()) {
        throw new Error('Self-referential batch parent crumb/card should be suppressed');
      }
    }

    await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
    await page.waitForSelector('.prod-board', { timeout: 10000 });
    const columns = await page.locator('.prod-col').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-prod-col')));
    for (const col of ['backlog', 'planned', 'prog', 'paused', 'completed', 'canceled']) {
      if (!columns.includes(col)) throw new Error('Projects board missing column: ' + col);
    }
    await page.locator('[data-prod-pcolcollapse]').first().click();
    await expectCount(page, '.prod-col.collapsed .prod-col-rail', 1, 'collapsed board column rail');
    await page.locator('[data-prod-pcolcollapse]').first().click();
    await expectCount(page, '.prod-col-head [data-prod-disabled="add-client-board-card"], .prod-col-head [data-prod-disabled="board-column-options"]', 0, 'fake board column add/options controls');
    const emptyColumnsStatic = await page.evaluate(() => {
      const emptyCols = [...document.querySelectorAll('.prod-col.is-empty')];
      const cardCols = [...document.querySelectorAll('.prod-col.has-cards')];
      return emptyCols.length > 0
        && cardCols.length > 0
        && emptyCols.every(col => !col.querySelector('[data-prod-disabled="add-client-board-card"], [data-prod-disabled="board-column-options"]'))
        && cardCols.every(col => !col.querySelector('[data-prod-disabled="add-client-board-card"], [data-prod-disabled="board-column-options"]'));
    });
    if (!emptyColumnsStatic) throw new Error('Project-board columns should not show fake header add/options controls');
    await expectCount(page, '[data-prod-client-card]', 1, 'project cards');
    const card = page.locator('[data-prod-client-card]').first();
    for (const sel of ['.prod-card-check', '.prod-card-ico', '.prod-card-title', '.prod-card-status svg', '.prod-avatar']) {
      if (!(await card.locator(sel).count())) throw new Error('Project card missing artifact part: ' + sel);
    }
    await expectCount(page, '[data-prod-client-card] [data-prod-pstatus]', 1, 'project card status picker control');
    await expectCount(page, '[data-prod-client-card] [data-prod-plead]', 1, 'project card lead picker control');
    await expectCount(page, '[data-prod-client-card] [data-prod-ptarget]', 1, 'project card target picker control');
    await card.click({ modifiers: ['Control'] });
    await expectCount(page, '[data-prod-card-actionbar] [data-prod-card-select-count]', 1, 'read-only project card selection actionbar');
    await page.locator('#cb-status').click();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-ppick]', 1, 'project card bulk guarded status picker');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { _prodState.cardSel.clear(); _prodRender(); });
    await page.locator('[data-prod-client-card] [data-prod-pstatus]').first().click();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-ppick]', 1, 'project card guarded status picker');
    await page.keyboard.press('Escape');
    await card.click();
    await page.waitForSelector('[data-prod-project-detail]', { timeout: 10000 });
    await expectCount(page, '[data-prod-project-subbar]', 1, 'project detail issue-list toolbar');
    await expectExactCount(page, '[data-prod-project-tab]', 0, 'project detail status tabs removed');
    await expectCount(page, '[data-prod-project-details-toggle]', 1, 'project details visibility toggle');
    await expectCount(page, '#prodFilterBtn', 1, 'project detail filter control');
    await expectCount(page, '#prodGroupBtn', 1, 'project detail display control');
    const projectToolbarOrderOk = await page.evaluate(() => {
      const subbar = document.querySelector('[data-prod-project-subbar]');
      const buttons = subbar ? [...subbar.querySelectorAll('button')].map(el => el.id || (el.hasAttribute('data-prod-project-details-toggle') ? 'details' : '')) : [];
      return buttons.indexOf('details') === buttons.indexOf('prodFilterBtn') + 1;
    });
    if (!projectToolbarOrderOk) throw new Error('Project details control should sit next to the Filter button');
    await page.locator('#prodGroupBtn').click();
    await page.locator('#prodLayer [data-prod-grp="assignee"]').click();
    await page.waitForSelector('[data-prod-project-groups="assignee"]', { timeout: 5000 });
    if (!(await page.evaluate(() => _prodState.groupBy === 'assignee' && document.querySelectorAll('[data-prod-project-group]').length > 0))) {
      throw new Error('Project Display group-by option did not regroup project rows');
    }
    const childRowsBeforeToggle = await page.locator('[data-prod-project-parent]:not([data-prod-project-parent=""])').count();
    await page.locator('#prodGroupBtn').click();
    await page.locator('#prodLayer [data-prod-show-subissues]').click();
    await page.waitForTimeout(120);
    const childRowsAfterToggle = await page.locator('[data-prod-project-parent]:not([data-prod-project-parent=""])').count();
    if (childRowsBeforeToggle && childRowsAfterToggle) {
      throw new Error('Project Display Show sub-issues toggle did not hide project child rows');
    }
    const projectSideCountTracksVisible = await page.evaluate(() => {
      const visible = document.querySelectorAll('[data-prod-project-issue]').length;
      const sideText = (document.querySelector('[data-prod-detail-card="project-issues"] .prod-side-row')?.textContent || '').trim();
      return sideText === String(visible) + ' issue' + (visible === 1 ? '' : 's');
    });
    if (!projectSideCountTracksVisible) throw new Error('Project side issue count should track visible project rows');
    const projectRowShapeOk = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-prod-project-issue]')];
      const emptyDuePills = [...document.querySelectorAll('[data-prod-project-issue] .prod-due.optional')];
      const emptyDueLabel = pill => (pill.querySelector(':scope > span:last-child')?.textContent || '').trim();
      return (rows.length === 0 || rows.every(row => row.querySelector('.prod-status[data-st]') && row.querySelector('.prod-id') && row.querySelector('.prod-title') && row.querySelector('.prod-due') && row.querySelector('[data-prod-assign]')))
        && emptyDuePills.every(pill => emptyDueLabel(pill) === 'Add date');
    });
    if (!projectRowShapeOk) throw new Error('Project issue rows are missing issue-list metadata controls or readable empty due labels');
    await expectExactCount(page, '.prod-project-groups .prod-project-group [data-prod-disabled="add-project-issue"]', 0, 'project-detail group add controls');
    await expectCount(page, '[data-prod-pstatus]', 1, 'project detail status property');
    await expectCount(page, '[data-prod-plead]', 1, 'project detail lead property');
    await expectCount(page, '[data-prod-ptarget]', 1, 'project detail target property');
    await expectExactCount(page, '[data-prod-disabled="project-controls"], .prod-disabled-pill', 0, 'project detail disabled scaffold controls');
    await page.locator('[data-prod-pstatus]').first().click();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-ppick]', 1, 'project detail guarded status picker');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window._prodSetView('board'));
    const cardIconBadFallback = await page.locator('[data-prod-client-card] .prod-card-ico').evaluateAll(nodes => nodes.some(n => (n.textContent || '').trim() === 'S' && !n.querySelector('svg')));
    if (cardIconBadFallback) throw new Error('Project card icon fell back to the letter S instead of the artifact project glyph');
    await card.click({ button: 'right' });
    await expectCount(page, '.prod-pop [data-prod-ctx="copy"]', 1, 'project card context Copy link item');
    await expectCount(page, '.prod-pop [data-prod-pctx="pstatus"]', 1, 'project card context status action');
    await expectCount(page, '.prod-pop [data-prod-pctx="plead"]', 1, 'project card context lead action');
    await expectCount(page, '.prod-pop [data-prod-pctx="ptarget"]', 1, 'project card context target action');
    await expectExactCount(page, '.prod-pop [data-prod-disabled^="context-change-status"], .prod-pop [data-prod-disabled^="context-set-lead"], .prod-pop [data-prod-disabled^="context-set-target"]', 0, 'project card context disabled mutation items');
    await page.locator('.prod-pop [data-prod-pctx="pstatus"]').click();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-ppick]', 1, 'project context guarded status picker');
    await page.keyboard.press('Escape');
    await card.click({ button: 'right' });
    await page.locator('.prod-pop [data-prod-ctx="copy"]').click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    const copiedProjectLink = await page.evaluate(() => window.__prodCopied || window.__prodLastCopied || '');
    if (!copiedProjectLink.includes('?prod=1') || !copiedProjectLink.includes('client=')) throw new Error('Project Copy link did not create a ?prod=1 client deep link');

    await page.locator('.prod-nav').filter({ hasText: 'Video' }).locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
    await page.waitForSelector('.prod-board', { timeout: 10000 });
    const teamUrl = new URL(page.url());
    if (teamUrl.searchParams.get('prod') !== '1' || teamUrl.searchParams.get('team') !== 'video' || teamUrl.searchParams.get('view') !== 'board') {
      throw new Error('Team-scoped Projects board did not preserve ?prod=1&team=video&view=board');
    }

    await page.evaluate(() => localStorage.setItem('syncview_theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    if (await page.locator('.prod-error').count()) throw new Error('Dark Production preview rendered an error card');
    const darkSmoke = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark' && !!document.querySelector('.prod-view'));
    if (!darkSmoke) throw new Error('Production preview did not follow syncview_theme=dark');

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
