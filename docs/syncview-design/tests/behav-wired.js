'use strict';
/*
 * Guard-mode behavioral baseline for the wired ?prod=1 tab.
 *
 * This adapts the artifact behav.js assertions to live B1 data. Mutation
 * assertions run in guard mode: the picker/menu opens, clicking a mutating value
 * shows "Preview - read-only", and the adapter state does not change.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const TOTAL = 138;
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

async function txt(page, sel) {
  return (await page.locator(sel).first().textContent().catch(() => '') || '').trim();
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  const requests = [];
  const results = {};
  page.on('pageerror', e => errors.push(e.message));
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

  const ok = async (name, fn) => {
    try { results[name] = await fn(); }
    catch (e) { results[name] = e && e.message ? e.message : String(e); }
  };
  const reset = async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      window._prodClearLayer && window._prodClearLayer();
      const cmd = document.querySelector('.prod-cmd-bd');
      if (cmd) cmd.remove();
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openBatchId = '';
      _prodState.tab = 'active';
      _prodState.groupBy = 'status';
      _prodState.filters = [];
      _prodState.collapsed = new Set();
      _prodState.colCollapsed = new Set();
      _prodState.selected = new Set();
      _prodState.focusRow = '';
      window._prodRender();
    });
  };
  const guardClick = async (openSelector, valueSelector) => {
    const before = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status, i.assignee, i.due, i.project])));
    await page.locator(openSelector).first().click();
    await page.waitForSelector(valueSelector, { timeout: 5000 });
    await page.locator(valueSelector).first().click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    const toast = await txt(page, '#prodToast');
    const after = await page.evaluate(() => JSON.stringify(window._prodIssues().map(i => [i.id, i.status, i.assignee, i.due, i.project])));
    await page.keyboard.press('Escape').catch(() => {});
    return toast.includes('Preview - read-only') && before === after;
  };

  try {
    await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row, .prod-empty-state, .prod-error', { timeout: 30000 });
    if (await page.locator('.prod-error').count()) throw new Error('Production preview rendered an error card');

    await ok('sidebarMyIssues', async () => await page.locator('.prod-nav-btn', { hasText: 'My issues' }).count() > 0);
    await ok('sidebarTeamProjects', async () => await page.locator('.prod-team-hd', { hasText: 'Video' }).count() > 0 && await page.locator('.prod-nav-btn', { hasText: 'Projects' }).count() > 0);
    await ok('searchButtonOpensPalette', async () => { await page.locator('.prod-search-btn').click(); return await page.locator('.prod-cmd').count() === 1; }); await reset();
    await ok('cmdKOpensPalette', async () => { await page.keyboard.press('Control+k'); return await page.locator('.prod-cmd').count() === 1; }); await reset();
    await ok('paletteSearchFindsIssue', async () => {
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', await page.locator('.prod-row .prod-id').first().textContent());
      return await page.locator('.prod-cmd-item').count() > 0;
    }); await reset();
    await ok('paletteCommandSwitchesView', async () => {
      await page.locator('.prod-search-btn').click();
      await page.fill('.prod-cmd-input', 'my issues');
      await page.keyboard.press('Enter');
      return await page.locator('.prod-nav-btn.active', { hasText: 'My issues' }).count() === 1;
    }); await reset();
    await ok('groupCollapse', async () => {
      const before = await page.locator('.prod-row').count();
      await page.locator('.prod-group').first().click();
      const after = await page.locator('.prod-row').count();
      return before > after && await page.locator('.prod-group.collapsed').count() === 1;
    }); await reset();
    await ok('groupCheckGuard', async () => {
      await page.locator('.prod-group-check').first().click();
      await page.waitForSelector('#prodToast.show', { timeout: 3000 });
      return (await txt(page, '#prodToast')).includes('Preview - read-only');
    }); await reset();
    await ok('filterMenuOpens', async () => { await page.locator('#prodFilterBtn').click(); return await page.locator('.prod-pop [data-prod-ffield]').count() >= 3; }); await reset();
    await ok('filterSubSearchable', async () => {
      await page.locator('#prodFilterBtn').click();
      await page.locator('.prod-pop [data-prod-ffield="status"]').hover();
      return await page.locator('#prodLayer .prod-pop [data-prod-search]').count() > 0;
    }); await reset();
    await ok('filterAppliesLive', async () => {
      const before = await page.locator('.prod-row').count();
      await page.locator('#prodFilterBtn').click();
      await page.locator('.prod-pop [data-prod-ffield="status"]').hover();
      await page.locator('#prodLayer .prod-pop [data-prod-fv]').first().click();
      const pills = await page.locator('.prod-filter-pill.interactive').count();
      const after = await page.locator('.prod-row').count();
      return pills === 1 && after <= before;
    }); await reset();
    await ok('clearFiltersEmptySafe', async () => {
      await page.evaluate(() => { _prodState.filters = [{ field: 'status', values: ['__none__'] }]; window._prodRender(); });
      const empty = await page.locator('[data-prod-empty-state]').count();
      await page.locator('.es-clear').click();
      return empty === 1 && await page.locator('.prod-filter-pill.interactive').count() === 0;
    }); await reset();
    await ok('groupByAssignee', async () => {
      await page.locator('#prodGroupBtn').click();
      await page.locator('.prod-pop [data-prod-grp="assignee"]').click();
      return await page.evaluate(() => _prodState.groupBy === 'assignee');
    }); await reset();
    await ok('groupByClient', async () => {
      await page.locator('#prodGroupBtn').click();
      await page.locator('.prod-pop [data-prod-grp="client"]').click();
      return await page.evaluate(() => _prodState.groupBy === 'client');
    }); await reset();
    await ok('rowStatusGuard', async () => await guardClick('.prod-row .prod-status', '.prod-pop [data-prod-pick]')); await reset();
    await ok('rowDueGuard', async () => await guardClick('.prod-row .prod-due', '.prod-pop [data-prod-day]')); await reset();
    await ok('contextStatusSubmenu', async () => {
      await page.locator('.prod-row').first().click({ button: 'right' });
      await page.locator('.prod-pop [data-prod-ctx="status"]').hover();
      return await page.locator('#prodLayer .prod-pop [data-prod-pick]').count() > 0;
    }); await reset();
    await ok('contextCopyDeepLink', async () => {
      await page.locator('.prod-row').first().click({ button: 'right' });
      await page.locator('.prod-pop [data-prod-ctx="copy"]').click();
      const copied = await page.evaluate(() => window.__prodCopied || window.__prodLastCopied || '');
      return copied.includes('?prod=1') && copied.includes('d=');
    }); await reset();
    await ok('keyboardArrowFocus', async () => {
      await page.keyboard.press('ArrowDown');
      return await page.locator('.prod-row.kfocus').count() === 1;
    }); await reset();
    await ok('keyboardEnterOpens', async () => {
      await page.keyboard.press('ArrowDown');
      const id = await page.locator('.prod-row.kfocus').getAttribute('data-prod-row');
      await page.keyboard.press('Enter');
      return await page.locator('[data-prod-detail="' + id + '"]').count() === 1;
    }); await reset();
    await ok('keyboardStatusGuardOpens', async () => {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('s');
      return await page.locator('.prod-pop [data-prod-pick]').count() > 0;
    }); await reset();
    await ok('detailPropertyGuard', async () => {
      await page.locator('.prod-row').first().click();
      await page.waitForSelector('.prod-detail');
      return await guardClick('[data-prod-prop="assignee"]', '.prod-pop [data-prod-pick]');
    }); await reset();
    await ok('boardColumnCollapse', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('[data-prod-pcolcollapse]').first().click();
      return await page.locator('.prod-col.collapsed .prod-col-rail').count() === 1;
    }); await reset();
    await ok('boardContextLeadUsesPersonIconGuarded', async () => {
      await page.locator('.prod-nav-btn', { hasText: 'Projects' }).first().click();
      await page.waitForSelector('.prod-board');
      await page.locator('.prod-card').first().click({ button: 'right' });
      const lead = page.locator('.prod-pop .prod-mi', { hasText: 'Set lead' }).first();
      return await lead.locator('.mic svg path[d*="M3.8 13"]').count() > 0;
    }); await reset();
    await ok('noWriteRequests', async () => requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).length === 0);
    await ok('noConsoleErrors', async () => errors.length === 0);

    const failed = Object.entries(results).filter(([, v]) => v !== true);
    console.log(JSON.stringify(results));
    const passed = Object.keys(results).length - failed.length;
    console.log('behav-wired: ' + passed + '/' + TOTAL + ' (guard mode)');
    if (failed.length) {
      console.error('behav-wired failures: ' + failed.map(([k, v]) => k + '=' + v).join(', '));
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error('behav-wired crash:', e); process.exit(2); });
