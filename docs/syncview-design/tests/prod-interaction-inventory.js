'use strict';
/*
 * Finished-read-only interaction inventory for the wired ?prod=1 tab.
 *
 * This is intentionally broader than the parity spot checks: it walks the main
 * Production states and proves that visible controls either change local state,
 * navigate, open guarded chrome, show the read-only guard, or are intentionally
 * disabled/active no-ops. It also checks right-click menus, hover tips, browser
 * errors, and the no-write request invariant.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const selectionOnly = process.argv.includes('--selection-only');
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

const candidateSelector = [
  '#prodRoot button',
  '#prodRoot [onclick]',
  '#prodRoot [oncontextmenu]',
  '#prodRoot .prod-row',
  '#prodRoot .prod-card[data-prod-client-card]',
  '#prodRoot .prod-subrow',
  '#prodRoot .prod-group',
  '#prodRoot .prod-status[data-st]',
  '#prodRoot .prod-due',
  '#prodRoot .prod-assign-hot',
  '#prodRoot [data-prod-pstatus]',
  '#prodRoot [data-prod-plead]',
  '#prodRoot [data-prod-ptarget]',
].join(',');

function writeLike(req) {
  const method = req.method();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const url = req.url();
  return /supabase|n8n|webhook|syncview|rest\/v1|functions\/v1/i.test(url);
}

async function reset(page, stateName) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(name => {
    window._prodClearLayer && window._prodClearLayer();
    document.querySelectorAll('.prod-cmd-bd').forEach(el => el.remove());
    const toast = document.getElementById('prodToast');
    if (toast) { toast.classList.remove('show'); toast.textContent = ''; }
    _prodState.paletteOpen = false;
    _prodState.view = 'list';
    _prodState.team = 'all';
    _prodState.clientSlug = '';
    _prodState.openId = '';
    _prodState.openBatchId = '';
    _prodState.openProjectId = '';
    _prodState.tab = 'active';
    _prodState.projectDetailsOpen = true;
    _prodState.groupBy = 'status';
    _prodState.orderBy = 'due';
    _prodState.showSubIssues = true;
    _prodState.filters = [];
    _prodState.collapsed = new Set();
    _prodState.colCollapsed = new Set();
    _prodState.selected = new Set();
    _prodState.selAnchor = '';
    _prodState.cardSel = new Set();
    _prodState.cardAnchor = '';
    _prodState.focusRow = '';
    _prodState.hoverRow = '';
    _prodState.focusCard = '';
    _prodState.hoverCard = '';
    if (name === 'detail') {
      const first = _prodIssueRows()[0] || _prodIssues()[0];
      if (first) _prodOpenDeliverable(first.id);
      return;
    }
    if (name === 'board' || name === 'boardSelected') {
      _prodOpenTeamView('video', 'board');
      if (name === 'boardSelected') {
        const first = _prodBoardFlat()[0];
        if (first) _prodState.cardSel = new Set([first]);
      }
      _prodRender();
      return;
    }
    if (name === 'project') {
      const projectId = Object.keys(_prodProjects()).find(k => _prodIssues().some(i => i.project === k && !i.parent));
      if (projectId) _prodOpenProject(projectId);
      return;
    }
    if (name === 'filteredEmpty') {
      _prodState.filters = [{ field: 'status', values: ['__none__'] }];
      _prodRender();
      return;
    }
    if (name === 'listSelected') {
      _prodRender();
      const first = _prodIssueRows()[0];
      if (first) _prodState.selected = new Set([first.id]);
      _prodRender();
      return;
    }
    _prodRender();
  }, stateName);
  await page.waitForTimeout(80);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function snapshot(page) {
  return await page.evaluate(() => {
    const layer = document.getElementById('prodLayer');
    const toast = document.getElementById('prodToast');
    const root = document.getElementById('prodRoot');
    const text = root ? root.textContent : '';
    return {
      url: location.href,
      view: _prodState.view,
      team: _prodState.team,
      clientSlug: _prodState.clientSlug,
      openId: _prodState.openId,
      openBatchId: _prodState.openBatchId,
      openProjectId: _prodState.openProjectId,
      tab: _prodState.tab,
      secOpen: JSON.stringify(_prodState.secOpen || {}),
      filters: JSON.stringify(_prodState.filters || []),
      groupBy: _prodState.groupBy,
      orderBy: _prodState.orderBy,
      collapsed: JSON.stringify([...(_prodState.collapsed || [])].sort()),
      selected: _prodState.selected ? _prodState.selected.size : 0,
      cardSel: _prodState.cardSel ? _prodState.cardSel.size : 0,
      layerOpen: !!(layer && layer.innerHTML),
      cmdOpen: !!document.querySelector('.prod-cmd-bd'),
      staffIdentityOpen: !!document.getElementById('staffIdentityOverlay'),
      toast: toast && toast.classList.contains('show') ? toast.textContent.trim() : '',
      textLen: text.length,
    };
  });
}

function changed(a, b) {
  return Object.keys(a).some(k => a[k] !== b[k]);
}

async function candidates(page) {
  return await page.evaluate(sel => {
    const seen = new Set();
    const all = Array.from(document.querySelectorAll(sel)).filter(el => {
      if (!el || seen.has(el)) return false;
      seen.add(el);
      if (el.classList && el.classList.contains('prod-row')) return false;
      if (el.classList && el.classList.contains('prod-check')) return false;
      if (el.classList && el.classList.contains('prod-status') && el.hasAttribute('onclick')) return false;
      if (el.classList && el.classList.contains('prod-due')) return false;
      if (el.classList && el.classList.contains('prod-assign-hot')) return false;
      if (el.classList && el.classList.contains('prod-chip-client')) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
    }).map((el, i) => {
      const attrs = {};
      for (const a of el.attributes) {
        if (/^(id|class|onclick|oncontextmenu|data-prod|data-|title|disabled|aria-disabled)$/i.test(a.name)) attrs[a.name] = a.value;
      }
      return {
        el,
        i,
        tag: el.tagName,
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
        cls: el.className || '',
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        attrs,
      };
    });
    const bucketCounts = new Map();
    const sampled = [];
    for (const item of all) {
      const attrs = item.attrs || {};
      const prodKeys = Object.keys(attrs)
        .filter(k => (k.startsWith('data-prod') && !k.startsWith('data-prod-probe')) || k === 'onclick' || k === 'oncontextmenu' || k === 'id')
        .sort()
        .map(k => `${k}=${attrs[k]}`)
        .join(',');
      const textShape = item.text.replace(/\d+/g, '#').replace(/[A-Z]{2,}-#/g, 'ID-#').slice(0, 36);
      const key = [item.tag, item.cls, prodKeys, textShape].join('|');
      const n = bucketCounts.get(key) || 0;
      if (n >= 2) continue;
      bucketCounts.set(key, n + 1);
      item.key = key;
      item.occ = n;
      sampled.push(item);
      if (sampled.length >= 70) break;
    }
    sampled.forEach((item, i) => {
      item.i = i;
      item.el.setAttribute('data-prod-probe-idx', String(i));
      delete item.el;
    });
    return sampled;
  }, candidateSelector);
}

function allowedNoop(c) {
  const cls = String(c.cls || '');
  const attrs = c.attrs || {};
  const text = c.text || '';
  return c.disabled
    || attrs['data-prod-disabled']
    || /\bactive\b/.test(cls)
    || /\bprod-readonly-control\b/.test(cls)
    || /\bprod-preview-chip\b/.test(cls)
    || /\bprod-created\b/.test(cls)
    || (c.attrs && c.attrs.oncontextmenu && !c.attrs.onclick)
    || (c.tag === 'BUTTON' && !attrs.onclick && /^Open$|^Active$/.test(text));
}

function sameCandidate(a, b) {
  return a && b && a.key === b.key && a.occ === b.occ;
}

async function clickInventory(page, stateName) {
  await reset(page, stateName);
  const list = await candidates(page);
  const failures = [];
  for (const c of list) {
    if (c.disabled) continue;
    await reset(page, stateName);
    const fresh = await candidates(page);
    const target = fresh.find(x => sameCandidate(x, c)) || fresh.find(x => x.key === c.key);
    if (!target) continue;
    await page.evaluate(() => {
      window._prodClearLayer && window._prodClearLayer();
      document.querySelectorAll('.prod-cmd-bd').forEach(el => el.remove());
    });
    const before = await snapshot(page);
    const beforeErrors = await page.evaluate(() => window.__prodProbeErrors.length);
    await page.evaluate(i => {
      const el = document.querySelector(`#prodRoot [data-prod-probe-idx="${i}"]`);
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }, target.i);
    await page.waitForTimeout(220);
    const after = await snapshot(page);
    const afterErrors = await page.evaluate(() => window.__prodProbeErrors.length);
    if (afterErrors > beforeErrors) failures.push(`${stateName} JS error after click: ${c.tag}.${c.cls} "${c.text}"`);
    if (!changed(before, after) && !allowedNoop(c)) {
      failures.push(`${stateName} silent no-op: ${c.tag}.${c.cls} "${c.text}" matched=${target.tag}.${target.cls} "${target.text}" attrs=${JSON.stringify(c.attrs)}`);
    }
  }
  return { stateName, checked: list.length, failures };
}

async function rightClickChecks(page) {
  const failures = [];
  await reset(page, 'list');
  const group = page.locator('.prod-group').first();
  if (await group.count()) {
    const prevented = await group.evaluate(el => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    if (!prevented) failures.push('list group right-click did not suppress the browser context menu');
    await page.evaluate(() => window._prodClearLayer && window._prodClearLayer());
  }

  const checks = [
    ['list', '.prod-row'],
    ['board', '.prod-card[data-prod-client-card]'],
    ['detail', '.prod-detail'],
    ['detail', '.prod-subrow'],
    ['project', '[data-prod-project-issue]'],
  ];
  for (const [stateName, sel] of checks) {
    await reset(page, stateName);
    const loc = page.locator(sel).first();
    if (!(await loc.count())) continue;
    await loc.click({ button: 'right', timeout: 2500, force: true });
    await page.waitForTimeout(150);
    const ok = await page.locator('#prodLayer .prod-pop [data-prod-ctx="copy"], #prodLayer .prod-pop [data-prod-ctx="status"]').count();
    if (!ok) failures.push(`${stateName} right-click did not open a Production context menu for ${sel}`);
    if (stateName === 'board') {
      const activeProjectActions = await page.locator('#prodLayer .prod-pop [data-prod-pctx="pstatus"], #prodLayer .prod-pop [data-prod-pctx="plead"], #prodLayer .prod-pop [data-prod-pctx="ptarget"]').count();
      const fakeProjectActions = await page.locator('#prodLayer .prod-pop [data-prod-disabled^="context-change-status"], #prodLayer .prod-pop [data-prod-disabled^="context-set-lead"], #prodLayer .prod-pop [data-prod-disabled^="context-set-target"]').count();
      if (activeProjectActions !== 3 || fakeProjectActions) failures.push('board project right-click menu did not expose active status/lead/target pickers');
    }
    await page.evaluate(() => window._prodClearLayer && window._prodClearLayer());
  }
  return failures;
}

async function hoverChecks(page) {
  await reset(page, 'list');
  const tips = await page.locator('#prodRoot [data-prod-tip]').count();
  const limit = Math.min(tips, 16);
  const failures = [];
  for (let i = 0; i < limit; i++) {
    const loc = page.locator('#prodRoot [data-prod-tip]').nth(i);
    const raw = await loc.getAttribute('data-prod-tip');
    if (!raw) continue;
    await loc.hover({ timeout: 2500, force: true });
    await page.waitForTimeout(460);
    const shown = await page.locator('#prodTip').evaluate(el => (el.textContent || '').trim()).catch(() => '');
    if (!shown) failures.push(`hover tip did not render for "${raw}"`);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(30);
  }
  return { checked: limit, failures };
}

async function selectionChecks(page) {
  const failures = [];
  await reset(page, 'list');
  const firstRowId = await page.locator('#prodRoot .prod-row').first().getAttribute('data-prod-row');
  await page.locator('#prodRoot .prod-row').first().click({ timeout: 2500, force: true });
  await page.waitForTimeout(120);
  const openedRow = await page.evaluate(expected => _prodState.openId === expected && _prodState.view === 'detail', firstRowId);
  if (!openedRow) failures.push('row click did not open the deliverable detail path');
  await reset(page, 'list');
  const before = await page.evaluate(() => _prodState.selected.size);
  await page.locator('#prodRoot .prod-check').first().click({ timeout: 2500, force: true });
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({
    selected: _prodState.selected.size,
    actionbar: !!document.querySelector('[data-prod-actionbar]'),
    view: _prodState.view,
  }));
  if (!(before === 0 && after.selected === 1 && after.actionbar && after.view === 'list')) {
    failures.push('row checkbox did not select locally without navigating');
  }
  await reset(page, 'list');
  const lockedWriteState = await page.evaluate(() => {
    window.__prodInteractionIdentityState = {
      mem: _syncviewStaffIdentityMem,
      loaded: _syncviewStaffIdentityLoaded,
      verified: _syncviewStaffIdentityVerified,
      authority: _prodState.authority,
      authorityLoaded: _prodState.authorityLoaded,
    };
    _syncviewStaffIdentityMem = {
      key: 'interaction-fixture-key',
      role: 'admin',
      member: { id: 'interaction-admin', name: 'Interaction Admin', role: 'admin', team: 'video' },
    };
    _syncviewStaffIdentityLoaded = true;
    _syncviewStaffIdentityVerified = true;
    _prodState.authority = { video: 'linear', graphics: 'linear' };
    _prodState.authorityLoaded = true;
    // The bounded active-TEST override is intentionally writable even while
    // team authority is Linear. Pin this locked-state proof to a real client.
    const issue = _prodIssues().find(row => row
      && row.id
      && !row.parent
      && (row.team === 'video' || row.team === 'graphics')
      && !_prodTestWriteOverride(row))
      || _prodIssues().find(row => row
        && row.id
        && (row.team === 'video' || row.team === 'graphics')
        && !_prodTestWriteOverride(row));
    if (issue) {
      _prodState.view = 'list';
      _prodState.team = issue.team;
      _prodState.tab = 'all';
      _prodState.filters = [];
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openBatchId = '';
      _prodState.openProjectId = '';
      _prodRender();
    }
    return {
      id: issue ? issue.id : '',
      nonTest: !!(issue && !_prodTestWriteOverride(issue)),
      status: _prodWriteGateText(issue, 'status'),
      due: _prodWriteGateText(issue, 'due'),
      assignee: _prodWriteGateText(issue, 'assignee'),
    };
  });
  if (!lockedWriteState.id || !lockedWriteState.nonTest
    || ![lockedWriteState.status, lockedWriteState.due, lockedWriteState.assignee]
    .every(text => text.includes('stays read-only while Linear is authoritative.'))) {
    failures.push('Linear-authoritative fixture did not expose a non-TEST locked row-control behavior');
  }
  const escapedLockedRowId = await page.evaluate(id => CSS.escape(String(id || '')), lockedWriteState.id);
  const lockedRowSelector = `#prodRoot [data-prod-row=${escapedLockedRowId}]`;
  const restoreLockedRow = async () => {
    const visible = await page.evaluate(id => {
      const issue = _prodIssue(id);
      if (!issue || _prodTestWriteOverride(issue)) return false;
      _prodState.view = 'list';
      _prodState.team = issue.team;
      _prodState.tab = 'all';
      _prodState.filters = [];
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openBatchId = '';
      _prodState.openProjectId = '';
      _prodRender();
      return !!document.querySelector('[data-prod-row="' + CSS.escape(id) + '"]');
    }, lockedWriteState.id);
    if (!visible) throw new Error('non-TEST Linear-authoritative fixture row was not visible');
  };
  await restoreLockedRow();
  await page.locator(`${lockedRowSelector} .prod-status[onclick]`).dispatchEvent('click');
  await page.waitForTimeout(120);
  const statusLayer = await page.locator('#prodLayer .prod-pop [data-prod-pick]').count();
  const statusToast = await page.locator('#prodToast.show').textContent().catch(() => '');
  if (statusLayer || !statusToast.includes(lockedWriteState.status)) failures.push('row status icon did not stay locked with the authority guard');
  await reset(page, 'list');
  await restoreLockedRow();
  await page.locator(`${lockedRowSelector} .prod-due`).dispatchEvent('click');
  await page.waitForTimeout(120);
  const dueLayer = await page.locator('#prodLayer .prod-duepop').count();
  const dueToast = await page.locator('#prodToast.show').textContent().catch(() => '');
  if (dueLayer || !dueToast.includes(lockedWriteState.due)) failures.push('row due pill did not stay locked with the authority guard');
  await reset(page, 'list');
  await restoreLockedRow();
  await page.locator(`${lockedRowSelector} .prod-assign-hot`).dispatchEvent('click');
  await page.waitForTimeout(120);
  const assignLayer = await page.locator('#prodLayer .prod-pop [data-prod-pick]').count();
  const assignToast = await page.locator('#prodToast.show').textContent().catch(() => '');
  if (assignLayer || !assignToast.includes(lockedWriteState.assignee)) failures.push('row assignee avatar did not stay locked with the authority guard');
  await page.evaluate(() => {
    const original = window.__prodInteractionIdentityState || {};
    _syncviewStaffIdentityMem = original.mem || null;
    _syncviewStaffIdentityLoaded = !!original.loaded;
    _syncviewStaffIdentityVerified = !!original.verified;
    _prodState.authority = original.authority || null;
    _prodState.authorityLoaded = !!original.authorityLoaded;
    delete window.__prodInteractionIdentityState;
    _prodRender();
  });
  await reset(page, 'list');
  const slug = await page.locator('#prodRoot .prod-chip-client').first().getAttribute('data-prod-crumbclient');
  if (slug) {
    await page.locator('#prodRoot .prod-chip-client').first().click({ timeout: 2500, force: true });
    await page.waitForTimeout(120);
    const opened = await page.evaluate(expected => _prodState.openProjectId === expected || _prodState.clientSlug === expected, slug);
    if (!opened) failures.push('row client chip did not open the project/client path');
  }
  await reset(page, 'list');
  const parentWithChild = await page.evaluate(() => {
    const rows = _prodIssues();
    const row = rows.find(d => rows.some(k => k.parent === d.id));
    return row ? row.id : '';
  });
  if (parentWithChild) {
    await page.evaluate(id => _prodOpenDeliverable(id), parentWithChild);
    await page.waitForSelector('#prodRoot .prod-subrow', { timeout: 5000 });
    const parentSubrow = await page.evaluate(() => {
      const row = document.querySelector('#prodRoot .prod-subrow');
      const id = row ? row.getAttribute('data-prod-subrow') : '';
      const issue = id ? _prodIssue(id) : null;
      return {
        id,
        label: issue ? _prodIssueLabel(issue) : '',
        text: row ? row.textContent.replace(/\s+/g, ' ').trim() : '',
        hasProjectChip: !!(row && row.querySelector('.prod-chip-client')),
        hasAddButton: !!document.querySelector('#prodRoot [data-prod-disabled="add-subissue"]'),
      };
    });
    if (!parentSubrow.hasAddButton) failures.push('parent detail did not expose the guarded add-sub-issue affordance');
    if (!parentSubrow.hasProjectChip) failures.push('parent sub-issue row did not expose project metadata');
    if (parentSubrow.label && parentSubrow.text.includes(parentSubrow.label)) {
      failures.push('parent sub-issue row still shows the child issue id instead of title-first Linear styling');
    }
    await page.evaluate(() => {
      const main = document.querySelector('#prodRoot .prod-detail-main');
      if (main) main.scrollTop = main.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    const clickedSubrow = await page.evaluate(() => {
      const row = document.querySelector('#prodRoot .prod-subrow');
      if (!row) return false;
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
      row.click();
      return true;
    });
    if (!clickedSubrow) failures.push('parent detail lost its sub-issue row before navigation');
    await page.waitForTimeout(180);
    const subDetail = await page.evaluate(() => {
      const main = document.querySelector('#prodRoot .prod-detail-main');
      const crumb = document.querySelector('#prodRoot .prod-detail-crumb');
      return {
        scrollTop: main ? main.scrollTop : -1,
        bodyTop: window.scrollY,
        crumbText: crumb ? crumb.textContent.replace(/\s+/g, ' ').trim() : '',
        contextText: (document.querySelector('#prodRoot [data-prod-subissue-of]') || {}).textContent || '',
        hasContextProject: !!document.querySelector('#prodRoot .prod-detail-context .prod-context-project'),
      };
    });
    if (subDetail.scrollTop > 2) failures.push('sub-issue detail did not reset its internal scroll to the top');
    if (!/Issue/.test(subDetail.crumbText) || !/Sub-issue/.test(subDetail.crumbText)) {
      failures.push('sub-issue breadcrumb did not expose Issue/Sub-issue context');
    }
    if (!/Sub-issue of/.test(subDetail.contextText)) failures.push('sub-issue detail did not expose the body-level Sub-issue of context');
    if (!subDetail.hasContextProject) failures.push('sub-issue detail did not expose the project context chip');
  }
  await reset(page, 'board');
  const cardCursor = await page.locator('#prodRoot .prod-card[data-prod-client-card]').first().evaluate(el => getComputedStyle(el).cursor).catch(() => '');
  if (cardCursor !== 'pointer') failures.push(`project card cursor should be pointer, got ${cardCursor || 'empty'}`);
  const topbarFakeControls = await page.locator('#prodRoot .prod-topbar [data-prod-disabled="favorite-view"], #prodRoot .prod-topbar [data-prod-disabled="favorite-issue"], #prodRoot .prod-topbar [data-prod-disabled="favorite-project"], #prodRoot .prod-topbar [data-prod-disabled="notifications"]').count();
  if (topbarFakeControls) failures.push(`Production topbars exposed ${topbarFakeControls} fake favorite/notification control(s)`);
  const emptyColumnActions = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#prodRoot .prod-col')];
    return cols.filter(col => col.querySelector('[data-prod-disabled="add-client-board-card"], [data-prod-disabled="board-column-options"]')).length;
  });
  if (emptyColumnActions) failures.push(`project board column headers exposed ${emptyColumnActions} fake add/options control set(s)`);
  return failures;
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const requests = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push(req));
  await page.addInitScript(() => {
    window.__prodProbeErrors = [];
    window.addEventListener('error', e => window.__prodProbeErrors.push(e.message || String(e.error || e)));
    window.addEventListener('unhandledrejection', e => window.__prodProbeErrors.push(String(e.reason || e)));
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
    await page.waitForSelector('.prod-row, .prod-empty-state, .prod-error', { timeout: 30000 });
    if (await page.locator('.prod-error').count()) throw new Error('Production preview rendered an error card');

    const results = [];
    const failures = [];
    let hoverChecked = 0;
    if (selectionOnly) {
      failures.push(...await selectionChecks(page));
      results.push('selection-only');
    } else {
      const states = ['list', 'listSelected', 'filteredEmpty', 'detail', 'board', 'boardSelected', 'project'];
      for (const state of states) {
        const r = await clickInventory(page, state);
        results.push(`${state}:${r.checked}`);
        failures.push(...r.failures);
      }
      failures.push(...await rightClickChecks(page));
      const hover = await hoverChecks(page);
      hoverChecked = hover.checked;
      failures.push(...hover.failures);
      failures.push(...await selectionChecks(page));
    }

    const writes = requests.filter(writeLike);
    if (writes.length) failures.push('write-like requests observed: ' + writes.slice(0, 5).map(r => `${r.method()} ${r.url()}`).join(' | '));
    if (errors.length) failures.push('browser errors: ' + errors.slice(0, 5).join(' | '));
    const probeErrors = await page.evaluate(() => window.__prodProbeErrors || []);
    if (probeErrors.length) failures.push('page probe errors: ' + probeErrors.slice(0, 5).join(' | '));

    if (failures.length) throw new Error(failures.join('\n'));
    if (selectionOnly) console.log('prod-interaction-inventory: locked non-TEST selection path and no writes/errors passed');
    else console.log(`prod-interaction-inventory: click states ${results.join(', ')}, right-click menus, ${hoverChecked} hover tips, no writes/errors passed`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
