'use strict';

const { chromium } = require('playwright');
const {
  serveStatic,
  isWriteLikeRequest,
  installReadConsoleAudit,
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
  let recoveredReadAttempts = 0;
  let navigationAborts = 0;

  try {
    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const readConsoleAudit = installReadConsoleAudit(page);
      page.on('request', req => requests.push(req));
      await installProductionInit(page);
      await openProduction(page, port);

      const longFallbackId = 'del_native_graphics_without_linear_identifier_0123456789abcdef';
      const fallbackIdLayout = await page.evaluate(id => {
        // Native-authoritative deliverables may have no Linear identifier after
        // the Graphics flip, so their raw IDs must stay inside the fixed column.
        const fixture = {
          id,
          identifier: null,
          linear_identifier: null,
          linear_issue_uuid: null,
          linear_issue_url: null,
          batch_id: '',
          client_slug: '',
          team: 'graphics',
          kind: 'graphic',
          title: 'Native graphics deliverable',
          status: 'todo',
          status_at: '2026-07-11T00:00:00.000Z',
          assignee_id: null,
          due_date: null,
          origin: 'native',
          card_id: null,
          sync_state: 'native',
          created_at: '2026-07-11T00:00:00.000Z',
          updated_at: '2026-07-11T00:00:00.000Z',
        };
        _prodState.deliverables = [..._prodState.deliverables.filter(row => row.id !== id), fixture];
        _prodState.adapter = _prodAdapter(_prodState);
        _prodState.view = 'list';
        _prodState.team = 'graphics';
        _prodState.tab = 'active';
        _prodState.clientSlug = '';
        _prodState.filters = [];
        _prodState.groupBy = 'status';
        _prodState.showSubIssues = true;
        _prodState.openId = '';
        _prodState.openBatchId = '';
        _prodState.openProjectId = '';
        _prodRender();

        const row = document.querySelector('[data-prod-row="' + CSS.escape(id) + '"]');
        const idCell = row && row.querySelector('.prod-id');
        const status = row && row.querySelector('.prod-status');
        const title = row && row.querySelector('.prod-title');
        if (!row || !idCell || !status || !title) return { found: false };
        const idRect = idCell.getBoundingClientRect();
        const statusRect = status.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const style = getComputedStyle(idCell);
        return {
          found: true,
          label: idCell.textContent || '',
          width: idRect.width,
          hasOverflowingContent: idCell.scrollWidth > idCell.clientWidth + 1,
          overflowX: style.overflowX,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
          boxesOrdered: idRect.right <= statusRect.left + 1 && statusRect.right <= titleRect.left + 1,
        };
      }, longFallbackId);
      if (!(fallbackIdLayout.found
        && fallbackIdLayout.label === longFallbackId
        && Math.abs(fallbackIdLayout.width - 76) <= 1
        && fallbackIdLayout.hasOverflowingContent
        && fallbackIdLayout.overflowX === 'hidden'
        && fallbackIdLayout.textOverflow === 'ellipsis'
        && fallbackIdLayout.whiteSpace === 'nowrap'
        && fallbackIdLayout.boxesOrdered)) {
        failures.push(`${vp.name} long native fallback ID should be ellipsized inside the fixed ID column: ${JSON.stringify(fallbackIdLayout)}`);
      }

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

      const filtersBeforeProject = await page.evaluate(() => JSON.parse(JSON.stringify(_prodState.filters || [])));
      const projectFixture = await page.evaluate(() => {
        const child = _prodIssues().find(i => i.project && i.parent);
        if (child) return { projectId: child.project, childId: child.id, team: child.team };
        const projectId = Object.keys(_prodProjects()).find(k => _prodIssues().some(i => i.project === k && !i.parent)) || '';
        const parent = projectId ? _prodIssues().find(i => i.project === projectId && !i.parent) : null;
        return { projectId, childId: '', team: parent ? parent.team : '' };
      });
      if (projectFixture.projectId) {
        if (!projectFixture.childId) failures.push(`${vp.name} project detail needs a real child-row fixture for the inline parent-trail check`);
        await page.evaluate(fixture => {
          _prodState.team = fixture.team || 'video';
          _prodState.tab = 'all';
          _prodState.filters = [];
          _prodState.showSubIssues = true;
          _prodOpenProject(fixture.projectId);
        }, projectFixture);
        await page.waitForSelector('[data-prod-project-detail]', { timeout: 10000 });
        failures.push(...await collectLayoutFailures(page, `${vp.name} project detail`));
        const projectIssueTitleHierarchy = await page.evaluate(childId => {
          if (!childId) return false;
          const row = document.querySelector('[data-prod-project-issue="' + CSS.escape(childId) + '"]');
          if (!row || !row.getAttribute('data-prod-project-parent')) return false;
          const holder = row.querySelector('.prod-title');
          const title = holder && holder.querySelector(':scope > b');
          const parent = row.querySelector('.prod-parent-title');
          if (!holder || !title || !parent || parent.parentElement !== holder) return false;
          const rowRect = row.getBoundingClientRect();
          const titleRect = title.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          return Math.abs(parentRect.top - titleRect.top) < 4
            && titleRect.left >= rowRect.left - 1
            && parentRect.left >= rowRect.left - 1
            && titleRect.right <= rowRect.right + 1
            && parentRect.right <= rowRect.right + 1;
        }, projectFixture.childId);
        if (!projectIssueTitleHierarchy) failures.push(`${vp.name} project detail parent issue trail should render inline beside the title`);
        await page.evaluate(filters => {
          _prodState.filters = filters;
          _prodRender();
        }, filtersBeforeProject);
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
        _prodState.filters = [];
        _prodState.cardSel.clear();
        _prodState.focusCard = '';
        _prodRender();
      });
      if (vp.name === 'desktop') {
        const boardScrollsHorizontally = await page.evaluate(() => {
          const board = document.querySelector('.prod-board');
          if (!board) return true;
          const boardRect = board.getBoundingClientRect();
          const firstCol = board.querySelector('.prod-col:not(.collapsed)');
          const firstRect = firstCol ? firstCol.getBoundingClientRect() : boardRect;
          return board.scrollWidth >= board.clientWidth
            && firstRect.left >= boardRect.left - 2
            && firstRect.right <= boardRect.right + 2;
        });
        if (!boardScrollsHorizontally) failures.push('desktop project board should use a stable horizontal board lane layout');
        const boardColumnBalance = await page.evaluate(() => {
          const cardCols = [...document.querySelectorAll('.prod-col.has-cards:not(.collapsed)')];
          const emptyCols = [...document.querySelectorAll('.prod-col.is-empty:not(.collapsed)')];
          const titleWidths = [...document.querySelectorAll('.prod-col.has-cards .prod-card-title')].slice(0, 8).map(el => el.getBoundingClientRect().width);
          const widths = [...cardCols, ...emptyCols].map(col => col.getBoundingClientRect().width);
          return cardCols.length === 0 || (
            cardCols.every(col => col.getBoundingClientRect().width >= 250)
            && emptyCols.every(col => col.getBoundingClientRect().width >= 250)
            && Math.max(...widths) - Math.min(...widths) <= 8
            && titleWidths.every(width => width >= 80)
          );
        });
        if (!boardColumnBalance) failures.push('desktop project board should give empty and non-empty columns the same readable lane width');
        const emptyColumnChrome = await page.evaluate(() => {
          const emptyCols = [...document.querySelectorAll('.prod-col.is-empty:not(.collapsed)')];
          const cardCols = [...document.querySelectorAll('.prod-col.has-cards:not(.collapsed)')];
          return emptyCols.length > 0
            && cardCols.length > 0
            && emptyCols.every(col => !col.querySelector('[data-prod-disabled="add-client-board-card"], [data-prod-disabled="board-column-options"]'))
            && cardCols.every(col => !col.querySelector('[data-prod-disabled="add-client-board-card"], [data-prod-disabled="board-column-options"]'));
        });
        if (!emptyColumnChrome) failures.push('project board columns should not show fake header add/options controls');
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
      const readConsole = await readConsoleAudit.settle();
      recoveredReadAttempts += readConsole.recoveredReadAttempts;
      navigationAborts += readConsole.navigationAborts;
      if (!readConsole.ok) failures.push(`${vp.name} console/page errors: ${readConsole.error}`);
      await page.close().catch(() => {});
    }

    const writes = requests.filter(isWriteLikeRequest);
    if (writes.length) failures.push('Write-like requests during layout pass: ' + writes.slice(0, 5).map(r => `${r.method()} ${r.url()}`).join(' | '));
    if (failures.length) throw new Error(formatFailures('prod-layout-polish failures', failures));
    console.log(`prod-layout-polish: desktop, compact desktop, and mobile list/filter/project/card/menu clipping checks plus ${recoveredReadAttempts} recovered read retries and ${navigationAborts} navigation-aborted reads passed`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
