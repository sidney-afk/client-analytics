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
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__prodCopied = text; } },
      });
    } catch (_) {}
  });

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
        ],
      });
      return {
        parentChildren: adapted.ISSUES.filter(i => i.parent === 'parent').map(i => i.id).sort(),
        childAChildren: adapted.ISSUES.filter(i => i.parent === 'child-a').length,
        statusKeys: adapted.ISSUES.map(i => i.status),
        projectEmoji: adapted.PROJECTS.noemoji.emoji,
        boardStatus: adapted.CLIENTS[0].status,
        editorInit: adapted.EDITORS.m1.init,
        editorColor: adapted.EDITORS.m1.color,
      };
    });
    if (adapterFixture.parentChildren.join(',') !== 'child-a,child-b') throw new Error('Adapter did not put children only under the batch-parent issue');
    if (adapterFixture.childAChildren !== 0) throw new Error('Adapter let a sibling list another sibling as a child');
    if (!adapterFixture.statusKeys.includes('prog') || !adapterFixture.statusKeys.includes('smm') || !adapterFixture.statusKeys.includes('client')) throw new Error('Adapter did not map B1 status slugs to artifact keys');
    if (adapterFixture.projectEmoji !== '') throw new Error('Adapter should preserve missing emoji as empty so the project glyph fallback renders');
    if (adapterFixture.boardStatus !== 'prog') throw new Error('Adapter did not map board in_progress to artifact prog');
    if (adapterFixture.editorInit !== 'MS' || !/^#[0-9a-f]{6}$/i.test(adapterFixture.editorColor)) throw new Error('Adapter did not produce artifact editor initials/color');

    if (!(await text(page, '.prod-brand')).includes('SyncView')) throw new Error('Sidebar brand missing');
    await expectCount(page, '.prod-brand[data-prod-brandmenu] .prod-brand-caret', 1, 'brand workspace caret/menu trigger');
    await page.locator('.prod-brand[data-prod-brandmenu]').click();
    await expectCount(page, '.prod-pop [data-prod-brand-action]', 1, 'brand workspace menu rows');
    await page.keyboard.press('Escape');
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
    await page.locator('#prodBulkActions').click();
    await expectCount(page, '#prodLayer .prod-actioncmd [data-prod-bulkact="status"]', 1, 'bulk Actions opens command menu');
    await page.locator('#prodLayer [data-prod-bulkact="status"]').click();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-pick]', 1, 'bulk status guard picker');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { _prodClearLayer(); _prodState.selected.clear(); _prodRender(); });
    await row.locator('.prod-status').click();
    await expectCount(page, '.prod-pop [data-prod-pick]', 1, 'row status click opens status picker');
    const statusPickerUrl = new URL(page.url());
    if (statusPickerUrl.searchParams.get('d')) throw new Error('Clicking row status icon navigated the row instead of opening the picker');
    await page.locator('.prod-pop [data-prod-pick]').first().click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    if (!(await text(page, '#prodToast')).includes('Preview - read-only')) throw new Error('Status picker did not route to read-only guard');
    await page.keyboard.press('Escape');
    await row.click({ button: 'right' });
    await expectCount(page, '.prod-pop [data-prod-ctx="copy"]', 1, 'row context Copy link item');
    await page.locator('.prod-pop').first().evaluate(pop => {
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await expectCount(page, '#prodLayer .prod-pop [data-prod-pick]', 1, 'context keyboard Enter opens submenu picker');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window._prodClearLayer && window._prodClearLayer());
    await row.click({ button: 'right' });
    const contextText = await text(page, '.prod-pop');
    if (!contextText.includes('⇧D') || !contextText.includes('Ctrl Delete')) throw new Error('Context menu keyboard hints do not match live Linear glyphs');
    const popBg = await page.locator('.prod-pop').first().evaluate(el => getComputedStyle(el).backgroundColor);
    if (!popBg || popBg === 'rgba(0, 0, 0, 0)' || popBg === 'transparent') throw new Error('Production context menu background is transparent');
    await page.locator('.prod-pop [data-prod-ctx="status"]').hover();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-pick]', 1, 'context Status hover opens submenu picker');
    await expectCount(page, '#prodLayer .prod-pop .tick', 1, 'context picker marks current value');
    await expectCount(page, '.prod-pop [data-prod-disabled^="context-"][title="Preview - read-only"]', 1, 'row context disabled mutation items');
    await page.locator('.prod-pop [data-prod-ctx="copy"]').click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    const copiedIssueLink = await page.evaluate(() => window.__prodCopied || window.__prodLastCopied || '');
    if (!copiedIssueLink.includes('?prod=1') || !copiedIssueLink.includes('d=')) throw new Error('Row Copy link did not create a ?prod=1&d= deep link');
    await expectExactCount(page, '.prod-pop', 0, 'context menu closed after Copy link');

    for (const tab of ['Active', 'Backlog', 'All issues']) {
      if (!(await page.locator('.prod-tab', { hasText: tab }).count())) throw new Error('Issue tab missing: ' + tab);
    }
    if (!(await page.locator('.prod-icon-btn[title="Preview - read-only"]').count())) throw new Error('Topbar inert controls missing');

    await page.evaluate(id => window._prodOpenDeliverable(id), firstRowId);
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    const linkified = await page.evaluate(() => _prodLinkify('Ship **bold** and `code` and [docs](https://ex.com) plus https://y.com'));
    if (!linkified.includes('<strong>bold</strong>') || !linkified.includes('<code>code</code>') || !linkified.includes('<a href="https://ex.com"')) {
      throw new Error('Production markdown/link renderer does not match artifact shape');
    }
    await expectCount(page, '[data-prod-crumb-client]', 1, 'clickable client crumb');
    await page.locator('[data-prod-crumb-client]').first().click();
    await page.waitForSelector('.prod-listwrap, .prod-empty', { timeout: 10000 });
    const clientUrl = new URL(page.url());
    if (clientUrl.searchParams.get('prod') !== '1' || !clientUrl.searchParams.get('client')) {
      throw new Error('Client breadcrumb did not navigate to ?prod=1 client view');
    }
    await page.evaluate(id => window._prodOpenDeliverable(id), firstRowId);
    await page.waitForSelector('.prod-detail-title', { timeout: 10000 });
    await page.locator('.prod-detail').click({ button: 'right', position: { x: 18, y: 18 } });
    await expectCount(page, '.prod-pop [data-prod-ctx="copy"]', 1, 'detail context Copy link item');
    await page.keyboard.press('Escape');
    await expectExactCount(page, '.prod-pop', 0, 'Escape closes detail context menu');
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
    if (!(await text(page, '.prod-activity')).includes('Activity')) throw new Error('Activity section missing');
    if (!(await page.locator('[data-prod-disabled="composer"][title="Preview - read-only"]').count())) throw new Error('Guarded composer missing');
    await page.locator('[data-prod-disabled="composer"]').click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    if (!(await text(page, '#prodToast')).includes('Preview - read-only')) throw new Error('Composer did not route to read-only guard');
    if (!(await page.locator('[data-prod-disabled="detail-controls"][title="Preview - read-only"]:disabled').count())) throw new Error('Disabled detail controls missing');
    await page.locator('[data-prod-prop="due"]').first().click();
    await expectCount(page, '.prod-duepop .prod-cal, .prod-duepop [data-prod-set="__custom__"]', 1, 'detail due property opens due popover');
    await page.locator('.prod-duepop [data-prod-set="__custom__"]').first().click().catch(() => {});
    await expectCount(page, '.prod-duepop .prod-cal', 1, 'due custom opens artifact calendar');
    await page.locator('.prod-duepop [data-prod-day]').first().click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    if (await page.locator('.prod-parent-link').count()) {
      await expectCount(page, '[data-prod-detail-card="parent"]', 1, 'Parent issue detail card');
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
    await expectCount(page, '.prod-col-head [data-prod-disabled="add-client-board-card"][title="Preview - read-only"]', 1, 'disabled board add controls');
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
    await expectCount(page, '[data-prod-pstatus]', 1, 'project detail status property');
    await expectCount(page, '[data-prod-plead]', 1, 'project detail lead property');
    await expectCount(page, '[data-prod-ptarget]', 1, 'project detail target property');
    await page.locator('[data-prod-pstatus]').first().click();
    await expectCount(page, '#prodLayer .prod-pop [data-prod-ppick]', 1, 'project detail guarded status picker');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window._prodSetView('board'));
    const cardIconBadFallback = await page.locator('[data-prod-client-card] .prod-card-ico').evaluateAll(nodes => nodes.some(n => (n.textContent || '').trim() === 'S' && !n.querySelector('svg')));
    if (cardIconBadFallback) throw new Error('Project card icon fell back to the letter S instead of the artifact project glyph');
    await card.click({ button: 'right' });
    await expectCount(page, '.prod-pop [data-prod-ctx="copy"]', 1, 'project card context Copy link item');
    await expectCount(page, '.prod-pop [data-prod-disabled^="context-"][title="Preview - read-only"]', 1, 'project card context disabled mutation items');
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
