'use strict';

const { chromium } = require('playwright');
const {
  serveStatic,
  isWriteLikeRequest,
  installProductionInit,
  openProduction,
  formatFailures,
} = require('./prod-test-utils');

const viewports = [
  { name: 'desktop', width: 1440, height: 950 },
  { name: 'compact-desktop', width: 1180, height: 760 },
  { name: 'mobile', width: 390, height: 844 },
];

async function collectLayoutFailures(page, label) {
  return await page.evaluate(label => {
    const failures = [];
    const visible = el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const within = (child, parent, pad = 1) => {
      const c = child.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      return c.left >= p.left - pad && c.right <= p.right + pad && c.top >= p.top - pad && c.bottom <= p.bottom + pad;
    };
    const checkInside = (selector, innerSelector, desc, limit = 40) => {
      [...document.querySelectorAll(selector)].filter(visible).slice(0, limit).forEach((parent, i) => {
        [...parent.querySelectorAll(innerSelector)].filter(visible).forEach(child => {
          if (!within(child, parent, 2)) failures.push(`${label} ${desc} clipped outside row/card at item ${i}`);
        });
      });
    };
    checkInside('.prod-row', '.prod-due, .prod-created, .prod-avatar, .prod-chip-client, .prod-title, .prod-id', 'list metadata');
    checkInside('.prod-subrow', '.prod-due, .prod-created, .prod-avatar, .prod-chip-client, .prod-title, .prod-id', 'subrow metadata');
    checkInside('[data-prod-project-issue]', '.prod-due, .prod-created, .prod-avatar, .prod-chip-client, .prod-title, .prod-id', 'project issue metadata');
    checkInside('.prod-card', '.prod-card-check, .prod-card-ico, .prod-card-title, .prod-card-status, .prod-card-lead, .prod-card-target', 'project card controls');
    [...document.querySelectorAll('.prod-filter-pill')].filter(visible).forEach((pill, i) => {
      if (pill.getBoundingClientRect().height > 30) failures.push(`${label} filter pill ${i} wrapped taller than 30px`);
      const holder = pill.closest('.prod-filter-pills');
      if (holder && !within(pill, holder, 2)) failures.push(`${label} filter pill ${i} overflows its toolbar`);
    });
    [...document.querySelectorAll('.prod-pop, .prod-cmd, .prod-toast')].filter(visible).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) {
        failures.push(`${label} floating chrome ${i} is outside the viewport`);
      }
    });
    return failures;
  }, label);
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const requests = [];
  const errors = [];

  try {
    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      page.on('pageerror', e => errors.push(`${vp.name}: ${e.message}`));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(`${vp.name}: ${msg.text()}`); });
      page.on('request', req => requests.push(req));
      await installProductionInit(page);
      await openProduction(page, port);

      failures.push(...await collectLayoutFailures(page, `${vp.name} list`));

      await page.evaluate(() => {
        _prodState.view = 'list';
        _prodState.team = 'video';
        _prodState.tab = 'active';
        _prodState.clientSlug = '';
        const row = _prodIssues().find(i => i.team === 'video' && i.project && _prodTabAllows(i.status));
        if (row) {
          _prodState.filters = [
            { field: 'status', values: [_prodArtifactStatus(row.status)] },
            { field: 'client', values: [row.project] },
          ];
        }
        _prodRender();
      });
      failures.push(...await collectLayoutFailures(page, `${vp.name} combined filters`));

      const projectId = await page.evaluate(() => Object.keys(_prodProjects()).find(k => _prodIssues().some(i => i.project === k && !i.parent)) || '');
      if (projectId) {
        await page.evaluate(id => _prodOpenProject(id), projectId);
        await page.waitForSelector('[data-prod-project-detail]', { timeout: 10000 });
        failures.push(...await collectLayoutFailures(page, `${vp.name} project detail`));
        const projectIssueTitleHierarchy = await page.evaluate(() => {
          const row = document.querySelector('[data-prod-project-parent]:not([data-prod-project-parent=""])');
          if (!row) return true;
          const title = row.querySelector('.prod-project-title-main');
          const parent = row.querySelector('.prod-parent-title');
          if (!title || !parent) return false;
          const rowRect = row.getBoundingClientRect();
          const titleRect = title.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          return parentRect.top >= titleRect.bottom - 2
            && titleRect.left >= rowRect.left - 1
            && parentRect.left >= rowRect.left - 1
            && titleRect.right <= rowRect.right + 1
            && parentRect.right <= rowRect.right + 1;
        });
        if (!projectIssueTitleHierarchy) failures.push(`${vp.name} project detail parent issue trail should render as a secondary line inside the row`);
        const projectFilterEmptyExplained = await page.evaluate(() => {
          const filterCount = (_prodState.filters || []).length;
          const id = _prodState.openProjectId || '';
          const project = _prodClient(id);
          const allCount = _prodIssues().filter(i => i.project === id).length;
          const visibleCount = project ? _prodProjectRows(project).length : 0;
          if (!filterCount || !allCount || visibleCount) return true;
          const empty = document.querySelector('[data-prod-project-filter-empty]');
          return !!empty && /Clear filters/i.test(empty.textContent || '') && !!empty.querySelector('button');
        });
        if (!projectFilterEmptyExplained) failures.push(`${vp.name} project detail needs a clear filter-empty state when filters hide existing project issues`);
      }

      await page.evaluate(() => {
        _prodState.view = 'board';
        _prodState.team = 'video';
        _prodState.cardSel.clear();
        _prodState.focusCard = '';
        _prodRender();
      });
      if (vp.name === 'desktop') {
        const boardFitsDesktop = await page.evaluate(() => {
          const board = document.querySelector('.prod-board');
          if (!board) return true;
          const boardRect = board.getBoundingClientRect();
          const columns = [...board.querySelectorAll('.prod-col:not(.collapsed)')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1;
          });
          return board.scrollWidth <= board.clientWidth + 2
            && columns.every(col => col.getBoundingClientRect().right <= boardRect.right + 2);
        });
        if (!boardFitsDesktop) failures.push('desktop project board clips the final visible column at review width');
        const boardColumnBalance = await page.evaluate(() => {
          const cardCols = [...document.querySelectorAll('.prod-col.has-cards:not(.collapsed)')];
          const emptyCols = [...document.querySelectorAll('.prod-col.is-empty:not(.collapsed)')];
          const titleWidths = [...document.querySelectorAll('.prod-col.has-cards .prod-card-title')].slice(0, 8).map(el => el.getBoundingClientRect().width);
          return cardCols.length === 0 || (
            cardCols.every(col => col.getBoundingClientRect().width >= 250)
            && emptyCols.every(col => col.getBoundingClientRect().width <= 190)
            && titleWidths.every(width => width >= 80)
          );
        });
        if (!boardColumnBalance) failures.push('desktop project board should give non-empty columns enough width for readable project cards');
      }
      if (await page.locator('.prod-card[data-prod-client-card]').count()) {
        await page.locator('.prod-card[data-prod-client-card] [data-prod-cardcheck]').first().click({ force: true });
        failures.push(...await collectLayoutFailures(page, `${vp.name} selected card`));
        await page.locator('.prod-card[data-prod-client-card] [data-prod-cardcheck]').first().click({ force: true });
        const sticky = await page.locator('.prod-card.pcard-kfocus').count();
        if (sticky) failures.push(`${vp.name} project card kept a keyboard focus border after mouse deselect`);
      }

      await page.locator('.prod-search-btn').click().catch(() => {});
      if (await page.locator('.prod-cmd').count()) failures.push(...await collectLayoutFailures(page, `${vp.name} command palette`));
      await page.keyboard.press('Escape').catch(() => {});
      await page.close().catch(() => {});
    }

    const writes = requests.filter(isWriteLikeRequest);
    if (writes.length) failures.push('Write-like requests during layout pass: ' + writes.slice(0, 5).map(r => `${r.method()} ${r.url()}`).join(' | '));
    if (errors.length) failures.push('Console/page errors during layout pass: ' + errors.slice(0, 5).join(' | '));
    if (failures.length) throw new Error(formatFailures('prod-layout-polish failures', failures));
    console.log('prod-layout-polish: desktop, compact desktop, and mobile list/filter/project/card/menu clipping checks passed');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
