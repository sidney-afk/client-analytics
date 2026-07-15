'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
  root,
  serveStatic,
  isWriteLikeRequest,
  installProductionInit,
  openProduction,
  formatFailures,
} = require('./prod-test-utils');

const outDir = process.env.SYNCVIEW_PROD_REVIEW_PACKET
  ? path.resolve(process.env.SYNCVIEW_PROD_REVIEW_PACKET)
  : path.join(root, '.codex-tmp', 'prod-review-packet');

const generatedAt = new Date().toISOString();

function resetOutDir() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
}

async function screenshot(page, shots, name, label, note, extra = {}) {
  const file = `${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(outDir, file), fullPage: false });
  const viewport = page.viewportSize() || {};
  let state = null;
  try {
    state = await page.evaluate(() => {
      if (typeof _prodState === 'undefined') return null;
      return {
        view: _prodState.view || '',
        team: _prodState.team || '',
        tab: _prodState.tab || '',
        filters: Array.isArray(_prodState.filters) ? _prodState.filters.length : 0,
        selectedRows: _prodState.selected && typeof _prodState.selected.size === 'number' ? _prodState.selected.size : 0,
        selectedCards: _prodState.cardSel && typeof _prodState.cardSel.size === 'number' ? _prodState.cardSel.size : 0,
      };
    });
  } catch (err) {
    state = null;
  }
  shots.push({
    file,
    name,
    label,
    note,
    viewport: {
      width: viewport.width || null,
      height: viewport.height || null,
      isMobile: Boolean(extra.isMobile),
    },
    theme: extra.theme || 'light',
    surface: extra.surface || name,
    route: extra.route || 'production',
    state,
    evidence: extra.evidence || null,
    checks: extra.checks || [],
  });
}

async function collectParentDetailEvidence(page) {
  return page.evaluate(() => {
    const detail = document.querySelector('.prod-detail');
    const subSection = document.querySelector('[data-prod-section="subissues"]');
    const activity = document.querySelector('.prod-activity');
    const descText = (document.querySelector('.prod-detail .prod-desc')?.textContent || '').replace(/\s+/g, ' ').trim();
    const activityText = (activity?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    };
    return {
      detailId: detail ? detail.getAttribute('data-prod-detail') || '' : '',
      subIssueRows: document.querySelectorAll('.prod-subissue-row').length,
      hasGuardedAddSubIssue: !!document.querySelector('[data-prod-disabled="add-subissue"]'),
      addSubIssueText: (document.querySelector('[data-prod-section="subissues"] [data-prod-disabled="add-subissue"]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      hasActivity: !!activity,
      subIssueSectionVisible: visible(subSection),
      activityVisible: visible(activity),
      descText,
      activityText,
      hasScaffoldCopy: /migrated row/i.test(descText + ' ' + activityText),
      topbarFakeControls: document.querySelectorAll('.prod-topbar [data-prod-disabled="favorite-view"], .prod-topbar [data-prod-disabled="favorite-issue"], .prod-topbar [data-prod-disabled="favorite-project"], .prod-topbar [data-prod-disabled="notifications"]').length,
    };
  });
}

async function collectIssueDetailCopyEvidence(page) {
  return page.evaluate(() => {
    const descText = (document.querySelector('.prod-detail .prod-desc')?.textContent || '').replace(/\s+/g, ' ').trim();
    const activityText = (document.querySelector('.prod-activity')?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      descText,
      activityText,
      hasScaffoldCopy: /migrated row/i.test(descText + ' ' + activityText),
    };
  });
}

async function collectListGroupEvidence(page) {
  return page.evaluate(() => ({
    visibleGroups: document.querySelectorAll('.prod-listwrap .prod-group').length,
    groupAddControls: document.querySelectorAll('.prod-listwrap .prod-group [data-prod-disabled="add-deliverable"], .prod-listwrap .prod-group .prod-group-add').length,
    topbarFakeControls: document.querySelectorAll('.prod-topbar [data-prod-disabled="favorite-view"], .prod-topbar [data-prod-disabled="favorite-issue"], .prod-topbar [data-prod-disabled="favorite-project"], .prod-topbar [data-prod-disabled="notifications"]').length,
  }));
}

async function collectBulkActionEvidence(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('#prodLayer .prod-pop[data-prod-bulkcmd]');
    const actionBar = document.querySelector('[data-prod-actionbar]');
    const search = menu ? menu.querySelector('[data-prod-search]') : null;
    const menuRect = menu ? menu.getBoundingClientRect() : null;
    const actionBarRect = actionBar ? actionBar.getBoundingClientRect() : null;
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    };
    return {
      actionBarVisible: visible(actionBar),
      actionBarReceded: !!(actionBar && actionBar.classList.contains('menu-open')),
      menuCentered: !!(menuRect && Math.abs((menuRect.left + menuRect.width / 2) - window.innerWidth / 2) < 24),
      menuWidth: menuRect ? Math.round(menuRect.width) : 0,
      menuAboveActionBar: !!(menuRect && actionBarRect && menuRect.bottom <= actionBarRect.top - 6),
      submenuOpenOnHover: !!document.querySelector('#prodLayer .prod-pop [data-prod-pick]'),
      menuVisible: visible(menu),
      searchVisible: visible(search),
      selectedRows: _prodState.selected && typeof _prodState.selected.size === 'number' ? _prodState.selected.size : 0,
      commandLabels: menu ? [...menu.querySelectorAll('[data-prod-ctx] .mlbl')].map(el => el.textContent.trim()) : [],
    };
  });
}

async function collectCombinedFilterEvidence(page) {
  return page.evaluate(() => {
    const pills = [...document.querySelectorAll('.prod-filter-pill.interactive')];
    const rows = [...document.querySelectorAll('.prod-row[data-prod-row]')];
    const rowIds = rows.map(row => row.getAttribute('data-prod-row') || '');
    const pillLabel = pill => {
      const field = pill.querySelector(':scope > span:not(.ficon):not(.fop):not(.fval)');
      const op = pill.querySelector(':scope > .fop');
      const val = pill.querySelector(':scope > .fval span:last-child');
      return [field, op, val].map(el => el ? el.textContent.trim() : '').filter(Boolean).join(' ');
    };
    return {
      pillCount: pills.length,
      pillLabels: pills.map(pillLabel),
      visibleRows: rows.length,
      uniqueVisibleRows: new Set(rowIds).size,
      hasStatusPill: pills.some(pill => /Status/i.test(pill.textContent || '')),
      hasClientPill: pills.some(pill => /Client/i.test(pill.textContent || '')),
    };
  });
}

async function collectProjectBoardEvidence(page) {
  return page.evaluate(() => {
    const emptyCols = [...document.querySelectorAll('.prod-col.is-empty')];
    const cardCols = [...document.querySelectorAll('.prod-col.has-cards')];
    const hasAddOrOptions = col => !!col.querySelector('[data-prod-disabled="add-client-board-card"], [data-prod-disabled="board-column-options"]');
    const widths = [...document.querySelectorAll('.prod-col:not(.collapsed)')].map(col => Math.round(col.getBoundingClientRect().width));
    const scope = document.querySelector('[data-prod-static-scope="projects"]');
    const scopeStyle = scope ? getComputedStyle(scope) : null;
    const emptyTargets = [...document.querySelectorAll('[data-prod-client-card] [data-prod-target-empty="true"]')];
    const targetLabel = target => (target.textContent || '').trim();
    return {
      emptyColumns: emptyCols.length,
      populatedColumns: cardCols.length,
      emptyColumnsWithActionControls: emptyCols.filter(hasAddOrOptions).length,
      populatedColumnsWithActionControls: cardCols.filter(hasAddOrOptions).length,
      totalColumnsWithActionControls: [...document.querySelectorAll('.prod-col')].filter(hasAddOrOptions).length,
      columnWidths: widths,
      minColumnWidth: widths.length ? Math.min(...widths) : 0,
      maxColumnWidth: widths.length ? Math.max(...widths) : 0,
      staticScopeLabel: scope ? scope.textContent.trim() : '',
      staticScopeInteractive: !!(scope && (scope.hasAttribute('onclick') || scope.tabIndex >= 0)),
      staticScopeCursor: scopeStyle ? scopeStyle.cursor : '',
      staticScopePointerEvents: scopeStyle ? scopeStyle.pointerEvents : '',
      staticScopeBackground: scopeStyle ? scopeStyle.backgroundColor : '',
      emptyTargetControls: emptyTargets.length,
      emptyTargetIconOnly: emptyTargets.filter(target => !targetLabel(target) && target.querySelector('svg')).length,
      emptyTargetLabels: emptyTargets.map(targetLabel).filter(Boolean),
    };
  });
}

async function collectProjectDetailEvidence(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-prod-project-issue]')];
    const rowIds = rows.map(row => row.getAttribute('data-prod-project-issue') || '');
    const rowTeams = rowIds.map(id => {
      const issue = _prodIssue(id);
      return issue && issue.team || '';
    }).filter(Boolean);
    const crumbTeam = document.querySelector('.prod-detail-crumb [data-prod-crumb-team]');
    const groupCount = document.querySelector('.prod-subhead .prod-group-count');
    const sideCount = document.querySelector('[data-prod-detail-card="project-issues"] .prod-side-row');
    const emptyDuePills = rows.flatMap(row => [...row.querySelectorAll('.prod-due.optional')]);
    const emptyDueLabel = pill => (pill.querySelector(':scope > span:last-child')?.textContent || '').trim();
    return {
      stateTeam: _prodState.team || '',
      openProjectId: _prodState.openProjectId || '',
      crumbTeam: crumbTeam ? crumbTeam.textContent.trim() : '',
      detailScope: (document.querySelector('.prod-detail-id')?.textContent || '').trim(),
      descText: (document.querySelector('[data-prod-project-detail] .prod-desc')?.textContent || '').replace(/\s+/g, ' ').trim(),
      hasScaffoldCopy: /migrated row/i.test(document.querySelector('[data-prod-project-detail] .prod-desc')?.textContent || ''),
      visibleRows: rows.length,
      rowTeams: [...new Set(rowTeams)].sort(),
      groupCountText: groupCount ? groupCount.textContent.trim() : '',
      sideIssuesText: sideCount ? sideCount.textContent.trim() : '',
      emptyDueLabels: emptyDuePills.map(emptyDueLabel),
      emptyDueIconOnly: emptyDuePills.filter(pill => !emptyDueLabel(pill)).length,
      groupAddControls: document.querySelectorAll('.prod-project-groups .prod-project-group [data-prod-disabled="add-project-issue"], .prod-project-groups .prod-project-group .prod-group-add').length,
      topbarFakeControls: document.querySelectorAll('.prod-topbar [data-prod-disabled="favorite-view"], .prod-topbar [data-prod-disabled="favorite-issue"], .prod-topbar [data-prod-disabled="favorite-project"], .prod-topbar [data-prod-disabled="notifications"]').length,
    };
  });
}

async function setList(page) {
  await page.evaluate(() => {
    window._prodClearLayer && window._prodClearLayer();
    document.querySelectorAll('.prod-cmd-bd').forEach(el => el.remove());
    _prodState.view = 'list';
    _prodState.team = 'video';
    _prodState.tab = 'active';
    _prodState.clientSlug = '';
    _prodState.openId = '';
    _prodState.openBatchId = '';
    _prodState.openProjectId = '';
    _prodState.selected.clear();
    _prodState.filters = [];
    _prodState.groupBy = 'status';
    _prodState.orderBy = 'due';
    _prodState.showSubIssues = true;
    _prodRender();
  });
  await page.waitForSelector('.prod-row, .prod-empty-state', { timeout: 10000 });
}

async function setSelectedActionMenu(page) {
  await setList(page);
  await page.evaluate(() => {
    const rows = _prodIssueRows().slice(0, 2);
    _prodState.selected = new Set(rows.map(row => row.id));
    _prodRender();
  });
  await page.waitForSelector('[data-prod-actionbar]', { timeout: 10000 });
  await page.locator('#prodBulkActions').click();
  await page.waitForSelector('#prodLayer .prod-pop[data-prod-bulkcmd]', { timeout: 10000 });
  await page.locator('#prodLayer .prod-pop[data-prod-bulkcmd] [data-prod-ctx="status"]').hover();
  await page.waitForTimeout(120);
}

async function setCombinedFilters(page) {
  await setList(page);
  await page.evaluate(() => {
    const row = _prodIssues().find(i => i.team === 'video' && i.project && _prodTabAllows(i.status));
    if (row) {
      _prodState.filters = [
        { field: 'status', values: [_prodArtifactStatus(row.status)] },
        { field: 'client', values: [row.project] },
      ];
    }
    _prodRender();
  });
  await page.waitForSelector('.prod-filter-pill.interactive, .prod-empty-state', { timeout: 10000 });
}

async function setBoard(page) {
  await page.evaluate(() => {
    window._prodClearLayer && window._prodClearLayer();
    document.querySelectorAll('.prod-cmd-bd').forEach(el => el.remove());
    _prodState.filters = [];
    _prodState.selected.clear();
    _prodState.cardSel.clear();
    _prodState.focusCard = '';
    _prodState.clientSlug = '';
    _prodOpenTeamView('video', 'board');
  });
  await page.waitForSelector('.prod-board', { timeout: 10000 });
  const clean = await page.evaluate(() => _prodState.view === 'board' && _prodState.team === 'video' && (_prodState.filters || []).length === 0);
  if (!clean) throw new Error('Project board review screenshot did not reset to an unfiltered board state');
}

async function setProject(page) {
  await page.evaluate(() => {
    window._prodClearLayer && window._prodClearLayer();
    document.querySelectorAll('.prod-cmd-bd').forEach(el => el.remove());
    _prodState.view = 'board';
    _prodState.team = 'video';
    _prodState.filters = [];
    _prodState.groupBy = 'status';
    _prodState.showSubIssues = true;
    _prodState.collapsed = new Set();
    _prodState.selected.clear();
    _prodState.cardSel.clear();
    _prodState.focusCard = '';
    const projects = _prodProjects();
    const ids = Object.keys(projects);
    const filteredId = ids.find(key => {
      const all = _prodIssues().filter(i => i.project === key);
      return all.some(i => i.team === 'video') && all.some(i => i.team === 'graphics') && _prodProjectRows(projects[key]).length;
    }) || ids.find(key => _prodProjectRows(projects[key]).length);
    const id = filteredId
      || ids.find(key => _prodIssues().some(i => i.project === key && !i.parent))
      || ids[0]
      || '';
    if (id) _prodOpenProject(id);
  });
  await page.waitForSelector('[data-prod-project-detail]', { timeout: 10000 });
  const clean = await page.evaluate(() => _prodState.view === 'project' && _prodState.team === 'video' && (_prodState.filters || []).length === 0);
  if (!clean) throw new Error('Project detail review screenshot did not reset to an unfiltered project state');
}

async function setParentDetail(page) {
  await page.evaluate(() => {
    const rows = _prodIssues();
    const parents = rows
      .map(d => ({ row: d, kids: _prodChildrenOf(d.id) }))
      .filter(item => item.kids.length > 0)
      .sort((a, b) => {
        const score = item => {
          const label = _prodIssueLabel(item.row);
          const descLen = (item.row.desc || '').length;
          const titleLen = (item.row.title || '').length;
          const kidPenalty = item.kids.length >= 2 && item.kids.length <= 4 ? 0 : (item.kids.length === 1 ? 30 : 20);
          const typeBonus = /^VID-/i.test(label) ? -10 : 0;
          return kidPenalty + descLen + titleLen + typeBonus;
        };
        return score(a) - score(b);
      });
    const parent = (parents[0] && parents[0].row) || rows[0];
    if (parent) {
      window.__prodReviewParentId = parent.id;
      _prodOpenDeliverable(parent.id);
    }
  });
  await page.waitForSelector('.prod-detail', { timeout: 10000 });
  await page.waitForSelector('[data-prod-section="subissues"] .prod-subissue-row', { timeout: 10000 });
  const evidence = await collectParentDetailEvidence(page);
  if (!evidence.subIssueSectionVisible || !evidence.activityVisible) {
    throw new Error('Parent detail review screenshot must keep sub-issues and activity visible in the desktop viewport');
  }
}

async function setSubIssueDetail(page) {
  await page.evaluate(() => {
    const rows = _prodIssues();
    const parent = (window.__prodReviewParentId && _prodIssue(window.__prodReviewParentId))
      || rows.find(d => rows.some(k => k.parent === d.id));
    const child = parent ? rows.find(k => k.parent === parent.id) : null;
    if (child) _prodOpenDeliverable(child.id);
  });
  await page.waitForSelector('.prod-detail', { timeout: 10000 });
}

function writeManifest(shots) {
  const lines = [
    '# Production Review Packet',
    '',
    'Generated by `node docs/syncview-design/tests/prod-review-packet.js`.',
    '',
    'These screenshots are local review evidence for the read-only `?prod=1` Production surface. They can contain live customer-visible text, are regenerated on demand, and must not be committed or uploaded from this public repository. Open local `index.html` for a browsable gallery, `review-checklist.md` for the inspection checklist, or `review-manifest.json` for machine-readable metadata.',
    '',
    '| Screenshot | Surface | What to inspect |',
    '|---|---|---|',
  ];
  shots.forEach(shot => {
    lines.push(`| [${shot.file}](${shot.file}) | ${shot.label} | ${shot.note} |`);
  });
  lines.push('');
  lines.push('No write-like browser requests or page/console errors were observed while creating this packet.');
  fs.writeFileSync(path.join(outDir, 'manifest.md'), lines.join('\n') + '\n');
}

function writeReviewManifest(shots, result) {
  const payload = {
    schema: 'syncview.productionReviewPacket.v1',
    generatedAt,
    generator: 'docs/syncview-design/tests/prod-review-packet.js',
    surface: 'Production tab',
    queryGate: '?prod=1',
    readOnlyInvariant: {
      writeLikeRequests: result.writeLikeRequests,
      pageOrConsoleErrors: result.pageOrConsoleErrors,
      passed: result.writeLikeRequests === 0 && result.pageOrConsoleErrors === 0,
    },
    files: {
      gallery: 'index.html',
      markdown: 'manifest.md',
      checklist: 'review-checklist.md',
    },
    screenshots: shots,
  };
  fs.writeFileSync(path.join(outDir, 'review-manifest.json'), JSON.stringify(payload, null, 2) + '\n');
}

function writeReviewChecklist(shots) {
  const lines = [
    '# Production Review Checklist',
    '',
    'Use this checklist with the generated screenshots before approving visible Production UI changes.',
    '',
    '## Global Checks',
    '',
    '- [ ] The Production preview still reads as a finished, polished app surface.',
    '- [ ] No write-like behavior is enabled unless the PR explicitly says it is a writable milestone.',
    '- [ ] Navigation, back/forward, scroll position, hover, focus, right-click, selection, and Escape behavior feel intentional.',
    '- [ ] No text, metadata chip, menu, tooltip, focus ring, or row content is visibly clipped or overlapping.',
    '- [ ] Disabled or guarded controls are visually clear and do not lead to silent dead ends.',
    '',
    '## Screenshot Checks',
    '',
  ];
  shots.forEach((shot, index) => {
    const viewport = shot.viewport || {};
    const mode = viewport.isMobile ? 'mobile' : 'desktop';
    lines.push(`### ${String(index + 1).padStart(2, '0')} ${shot.label}`);
    lines.push('');
    lines.push(`- Screenshot: [${shot.file}](${shot.file})`);
    lines.push(`- Route: \`${shot.route}\``);
    lines.push(`- Surface: \`${shot.surface}\``);
    lines.push(`- Viewport: ${viewport.width || '?'} x ${viewport.height || '?'} (${mode}, ${shot.theme})`);
    lines.push('');
    (shot.checks || []).forEach(check => {
      lines.push(`- [ ] ${check}`);
    });
    lines.push('- [ ] No visual clipping, stale tooltip, browser-native menu, or unexpected focus state appears in this screenshot.');
    lines.push('');
  });
  lines.push('## Evidence');
  lines.push('');
  lines.push('- `review-manifest.json` should report `readOnlyInvariant.passed: true`.');
  lines.push('- `manifest.md` should list every screenshot in this checklist.');
  fs.writeFileSync(path.join(outDir, 'review-checklist.md'), lines.join('\n') + '\n');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function writeGallery(shots) {
  const cards = shots.map((shot, index) => `
      <article class="shot">
        <a href="${escapeHtml(shot.file)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(shot.file)}" alt="${escapeHtml(shot.label)} screenshot">
        </a>
        <div class="shot-meta">
          <span>${String(index + 1).padStart(2, '0')}</span>
          <h2>${escapeHtml(shot.label)}</h2>
          <p>${escapeHtml(shot.note)}</p>
        </div>
      </article>`).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Production Review Packet</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f8;
      color: #15171a;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1280px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      font-weight: 720;
      letter-spacing: 0;
    }
    .intro {
      max-width: 760px;
      margin: 0;
      color: #5c6370;
      line-height: 1.5;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 20px;
      align-items: start;
    }
    .shot {
      overflow: hidden;
      border: 1px solid #d9dde3;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgb(15 23 42 / 0.05);
    }
    .shot img {
      display: block;
      width: 100%;
      height: auto;
      background: #101214;
      border-bottom: 1px solid #e2e5e9;
    }
    .shot-meta {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 10px;
      padding: 14px 16px 16px;
    }
    .shot-meta span {
      grid-row: span 2;
      color: #7b8290;
      font-variant-numeric: tabular-nums;
    }
    .shot-meta h2 {
      margin: 0;
      font-size: 15px;
      line-height: 1.3;
    }
    .shot-meta p {
      margin: 0;
      color: #636b77;
      font-size: 13px;
      line-height: 1.45;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #0f1011;
        color: #f3f4f6;
      }
      .intro,
      .shot-meta p {
        color: #a6adb8;
      }
      .shot {
        border-color: #292d33;
        background: #17191c;
        box-shadow: none;
      }
      .shot img {
        border-bottom-color: #292d33;
      }
      .shot-meta span {
        color: #8b93a0;
      }
    }
    @media (max-width: 520px) {
      body {
        padding: 18px;
      }
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Production Review Packet</h1>
      <p class="intro">Visual evidence for the read-only Production tab. Use this gallery to scan the main list, action menu, filters, project board, project detail, issue detail, sub-issue detail, dark mode, and mobile layouts in one pass.</p>
    </header>
    <section class="grid" aria-label="Production screenshots">
${cards}
    </section>
  </main>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}

(async () => {
  resetOutDir();
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const requests = [];
  const errors = [];
  const shots = [];

  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    desktop.on('pageerror', e => errors.push(e.message));
    desktop.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    desktop.on('request', req => requests.push(req));
    await installProductionInit(desktop);
    await openProduction(desktop, port);

    await setList(desktop);
    const listGroupEvidence = await collectListGroupEvidence(desktop);
    await screenshot(desktop, shots, 'desktop-list', 'Desktop list', 'Baseline grouped issue list, toolbar, filter/display buttons, row metadata.', {
      surface: 'list',
      route: 'production/video/issues',
      evidence: listGroupEvidence,
      checks: ['grouped issue list', 'toolbar controls', 'filter/display buttons', 'row metadata'],
    });

    await setSelectedActionMenu(desktop);
    const selectedActionsEvidence = await collectBulkActionEvidence(desktop);
    await screenshot(desktop, shots, 'selected-actions-menu', 'Selected issue Actions', 'Floating action bar and searchable selected-issue command menu.', {
      surface: 'bulk-actions',
      route: 'production/video/issues?selected=2',
      evidence: selectedActionsEvidence,
      checks: ['floating action bar', 'searchable command menu', 'selected row state'],
    });

    await setCombinedFilters(desktop);
    const combinedFiltersEvidence = await collectCombinedFilterEvidence(desktop);
    await screenshot(desktop, shots, 'combined-filters', 'Combined filters', 'Status/client pills, compact toolbar, deduped visible rows.', {
      surface: 'filters',
      route: 'production/video/issues?filters=status+client',
      evidence: combinedFiltersEvidence,
      checks: ['filter pill width', 'status/client labels', 'deduped visible rows'],
    });

    await setBoard(desktop);
    const projectBoardEvidence = await collectProjectBoardEvidence(desktop);
    await screenshot(desktop, shots, 'project-board', 'Project board', 'Board columns, project card spacing, card metadata, pointer/selection affordances.', {
      surface: 'projects-board',
      route: 'production/video/projects',
      evidence: projectBoardEvidence,
      checks: ['board columns', 'project card spacing', 'card metadata', 'selection affordance'],
    });

    await setProject(desktop);
    const projectDetailEvidence = await collectProjectDetailEvidence(desktop);
    await screenshot(desktop, shots, 'project-detail', 'Project detail', 'Project issue list, Filter/Project details/Display controls, right metadata.', {
      surface: 'project-detail',
      route: 'production/video/project-detail',
      evidence: projectDetailEvidence,
      checks: ['project issue list', 'team-scoped project rows', 'filter control', 'project details toggle', 'display control', 'right metadata'],
    });

    await setParentDetail(desktop);
    const parentDetailEvidence = await collectParentDetailEvidence(desktop);
    await screenshot(desktop, shots, 'parent-detail', 'Parent issue detail', 'Centered body, sub-issue rows, guarded add-sub-issue affordance, activity.', {
      surface: 'parent-issue-detail',
      route: 'production/issue-detail',
      evidence: parentDetailEvidence,
      checks: ['centered issue body', 'sub-issue rows', 'guarded add-sub-issue affordance', 'activity'],
    });

    await setSubIssueDetail(desktop);
    const subIssueCopyEvidence = await collectIssueDetailCopyEvidence(desktop);
    await screenshot(desktop, shots, 'subissue-detail', 'Sub-issue detail', 'Breadcrumb/body hierarchy, Sub-issue of context, project context.', {
      surface: 'subissue-detail',
      route: 'production/subissue-detail',
      evidence: subIssueCopyEvidence,
      checks: ['breadcrumb hierarchy', 'body-level parent context', 'project context'],
    });

    await desktop.evaluate(() => {
      localStorage.setItem('syncview_theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await setList(desktop);
    await screenshot(desktop, shots, 'dark-list', 'Dark list', 'Dark theme tokens, hover/selection contrast, row metadata.', {
      surface: 'list',
      route: 'production/video/issues',
      theme: 'dark',
      checks: ['dark theme tokens', 'hover contrast', 'selection contrast', 'row metadata'],
    });
    await desktop.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    mobile.on('pageerror', e => errors.push(`mobile: ${e.message}`));
    mobile.on('console', msg => { if (msg.type() === 'error') errors.push(`mobile: ${msg.text()}`); });
    mobile.on('request', req => requests.push(req));
    await installProductionInit(mobile);
    await openProduction(mobile, port);
    await setList(mobile);
    await screenshot(mobile, shots, 'mobile-list', 'Mobile list', 'Header/nav wrapping, list density, toolbar controls.', {
      surface: 'list',
      route: 'production/video/issues',
      isMobile: true,
      checks: ['mobile header', 'nav wrapping', 'list density', 'toolbar controls'],
    });
    await setParentDetail(mobile);
    await screenshot(mobile, shots, 'mobile-detail', 'Mobile detail', 'Top breadcrumb, title truncation, body spacing at phone width.', {
      surface: 'issue-detail',
      route: 'production/issue-detail',
      isMobile: true,
      checks: ['mobile breadcrumb', 'title truncation', 'body spacing'],
    });
    await mobile.close();

    const writes = requests.filter(isWriteLikeRequest);
    const failures = [];
    if (writes.length) failures.push('Write-like requests while generating review packet: ' + writes.slice(0, 5).map(r => `${r.method()} ${r.url()}`).join(' | '));
    if (errors.length) failures.push('Page/console errors while generating review packet: ' + errors.slice(0, 5).join(' | '));
    if (shots.length < 10) failures.push(`Expected at least 10 screenshots, wrote ${shots.length}`);
    if (failures.length) throw new Error(formatFailures('prod-review-packet failures', failures));
    writeReviewManifest(shots, {
      writeLikeRequests: writes.length,
      pageOrConsoleErrors: errors.length,
    });
    writeManifest(shots);
    writeReviewChecklist(shots);
    writeGallery(shots);
    console.log(`prod-review-packet: wrote ${shots.length} screenshots, JSON manifest, Markdown manifest, checklist, and gallery to ${outDir}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
