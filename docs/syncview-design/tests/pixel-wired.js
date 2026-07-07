'use strict';
/*
 * Track B §10.8 pixel-parity foundation lane.
 *
 * The frozen artifact is docs/syncview-design/SyncView.html. This lane drives the
 * artifact and wired ?prod=1 tab through matched states, then checks the visual
 * contracts that are safe in B2 read-only preview. Typography differences are
 * intentionally excluded per the owner exception.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const outDir = process.env.SYNCVIEW_PROD_PIXEL_SHOTS
  ? path.resolve(process.env.SYNCVIEW_PROD_PIXEL_SHOTS)
  : path.join(root, '.codex-tmp', 'prod-pixel-wired');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const STYLE_PROPS = [
  'backgroundColor',
  'borderTopColor',
  'borderTopWidth',
  'borderRadius',
  'width',
  'height',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'gap',
  'display',
  'alignItems',
  'justifyContent',
  'justifyItems',
  'cursor',
  'opacity',
  'boxShadow',
  'color',
];

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
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false });
}

async function shotElement(page, selector, name) {
  fs.mkdirSync(outDir, { recursive: true });
  const loc = page.locator(selector).first();
  if (await loc.count()) await loc.screenshot({ path: path.join(outDir, name + '.png') });
}

function cleanPaths(paths) {
  return paths.map(p => String(p || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

async function iconPaths(page, selector) {
  return cleanPaths(await page.locator(selector + ' svg path').evaluateAll(nodes => nodes.map(n => n.getAttribute('d'))));
}

async function pickerInventory(page, selector) {
  return page.locator(selector).evaluateAll(nodes => nodes.map(el => {
    const cs = getComputedStyle(el);
    return {
      label: (el.querySelector('.mlbl')?.textContent || '').trim(),
      kbd: (el.querySelector('.kbd')?.textContent || '').trim(),
      dres: (el.querySelector('.dres')?.textContent || '').trim(),
      cursor: cs.cursor,
      paths: Array.from(el.querySelectorAll('svg path')).map(p => (p.getAttribute('d') || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    };
  }));
}

async function commandInventory(page, selector) {
  return page.locator(selector).evaluateAll(nodes => nodes.map(el => {
    const cs = getComputedStyle(el);
    return {
      title: (el.querySelector('.ct')?.textContent || '').trim(),
      meta: (el.querySelector('.cmeta')?.textContent || '').trim(),
      cursor: cs.cursor,
      paths: Array.from(el.querySelectorAll('svg path')).map(p => (p.getAttribute('d') || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    };
  }));
}

async function emptyStateInventory(page, selector) {
  return page.locator(selector).first().evaluate(el => ({
    message: Array.from(el.children)
      .filter(child => child.tagName === 'SPAN' && !child.classList.contains('es-ico'))
      .map(child => (child.textContent || '').trim())
      .filter(Boolean)
      .join(' '),
    button: (el.querySelector('.es-clear')?.textContent || '').trim(),
    paths: Array.from(el.querySelectorAll('.es-ico svg path')).map(p => (p.getAttribute('d') || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
  }));
}

function comparePickerInventory(gaps, state, artifactRows, wiredRows) {
  if (artifactRows.length !== wiredRows.length) {
    gaps.push({ rank: 1, state, message: `picker row count mismatch artifact=${artifactRows.length} wired=${wiredRows.length}` });
    return;
  }
  artifactRows.forEach((a, i) => {
    const w = wiredRows[i] || {};
    if (a.label !== w.label) gaps.push({ rank: 1, state, message: `row ${i} label artifact=${a.label} wired=${w.label}` });
    if (a.kbd !== w.kbd) gaps.push({ rank: 1, state, message: `row ${i} kbd artifact=${a.kbd || '(empty)'} wired=${w.kbd || '(empty)'}` });
    if (a.cursor !== w.cursor) gaps.push({ rank: 2, state, message: `row ${i} cursor artifact=${a.cursor} wired=${w.cursor}` });
    if (a.paths.join('|') !== w.paths.join('|')) gaps.push({ rank: 1, state, message: `row ${i} icon path drift for ${a.label}` });
  });
}

function comparePaletteCommandRows(gaps, state, artifactRows, wiredRows, startIndex) {
  const aCmd = artifactRows.slice(startIndex);
  const wCmd = wiredRows.slice(startIndex);
  if (aCmd.length !== wCmd.length) {
    gaps.push({ rank: 1, state, message: `command row count mismatch artifact=${aCmd.length} wired=${wCmd.length}` });
    return;
  }
  aCmd.forEach((a, i) => {
    const w = wCmd[i] || {};
    if (a.title !== w.title) gaps.push({ rank: 1, state, message: `command ${i} title artifact=${a.title} wired=${w.title}` });
    if (a.meta !== w.meta) gaps.push({ rank: 1, state, message: `command ${i} meta artifact=${a.meta} wired=${w.meta}` });
    if (a.paths.join('|') !== w.paths.join('|')) gaps.push({ rank: 1, state, message: `command ${i} icon path drift for ${a.title}` });
  });
}

function compareMenuInventory(gaps, state, artifactRows, wiredRows) {
  if (artifactRows.length !== wiredRows.length) {
    gaps.push({ rank: 1, state, message: `menu row count mismatch artifact=${artifactRows.length} wired=${wiredRows.length}` });
    return;
  }
  artifactRows.forEach((a, i) => {
    const w = wiredRows[i] || {};
    if (a.label !== w.label) gaps.push({ rank: 1, state, message: `row ${i} label artifact=${a.label} wired=${w.label}` });
    if (a.kbd !== w.kbd) gaps.push({ rank: 1, state, message: `row ${i} kbd artifact=${a.kbd || '(empty)'} wired=${w.kbd || '(empty)'}` });
    if (a.paths.join('|') !== w.paths.join('|')) gaps.push({ rank: 1, state, message: `row ${i} icon path drift for ${a.label}` });
  });
}

function compareDueInventory(gaps, state, artifactRows, wiredRows) {
  if (artifactRows.length !== wiredRows.length) {
    gaps.push({ rank: 1, state, message: `due row count mismatch artifact=${artifactRows.length} wired=${wiredRows.length}` });
    return;
  }
  artifactRows.forEach((a, i) => {
    const w = wiredRows[i] || {};
    if (a.label !== w.label) gaps.push({ rank: 1, state, message: `row ${i} label artifact=${a.label} wired=${w.label}` });
    if (i > 1 && a.dres !== w.dres) gaps.push({ rank: 1, state, message: `row ${i} date hint artifact=${a.dres || '(empty)'} wired=${w.dres || '(empty)'}` });
    if (a.paths.join('|') !== w.paths.join('|')) gaps.push({ rank: 1, state, message: `row ${i} icon path drift for ${a.label}` });
  });
}

async function styles(page, selector, props = STYLE_PROPS) {
  return page.locator(selector).first().evaluate((el, names) => {
    const cs = getComputedStyle(el);
    const out = {};
    names.forEach(n => { out[n] = cs[n]; });
    return out;
  }, props);
}

function px(v) {
  const m = String(v || '').match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? Number(m[1]) : null;
}

function equivalentStyle(prop, a, w) {
  const ap = px(a);
  const wp = px(w);
  if (ap != null && wp != null) return Math.abs(ap - wp) <= 1;
  return String(a) === String(w);
}

async function compareStyles(gaps, name, artifact, wired, aSel, wSel, props = STYLE_PROPS) {
  const ac = await artifact.locator(aSel).count();
  const wc = await wired.locator(wSel).count();
  if (!ac || !wc) {
    gaps.push({ rank: 1, state: name, message: `missing pair ${aSel} -> ${wSel} (${ac}/${wc})` });
    return;
  }
  const a = await styles(artifact, aSel, props);
  const w = await styles(wired, wSel, props);
  Object.keys(a).forEach(prop => {
    if (!equivalentStyle(prop, a[prop], w[prop])) {
      gaps.push({ rank: 2, state: name, message: `${prop}: artifact=${a[prop]} wired=${w[prop]}` });
    }
  });
}

async function requirePair(gaps, state, artifact, wired, aSel, wSel) {
  const ac = await artifact.locator(aSel).count();
  const wc = await wired.locator(wSel).count();
  if (!ac || !wc) gaps.push({ rank: 1, state, message: `semantic inventory missing ${aSel} -> ${wSel} (${ac}/${wc})` });
}

async function setupSelection(artifact, wired) {
  await artifact.evaluate(() => {
    S.open = null;
    S.projectOpen = null;
    S.view = { type: 'issues', team: 'video' };
    S.selected.clear();
    const id = flatOrder()[0];
    if (id) S.selected.add(id);
    render();
  });
  await wired.evaluate(() => {
    _prodState.view = 'list';
    _prodState.team = 'video';
    _prodState.clientSlug = '';
    _prodState.openId = '';
    _prodState.openProjectId = '';
    _prodState.selected = new Set(_prodFlatOrder().slice(0, 1));
    _prodRender();
  });
}

async function setupFilterPill(artifact, wired) {
  await artifact.evaluate(() => {
    S.open = null;
    S.projectOpen = null;
    S.view = { type: 'issues', team: 'video' };
    S.filters = [{ field: 'status', values: ['todo'] }];
    render();
  });
  await wired.evaluate(() => {
    _prodState.view = 'list';
    _prodState.team = 'video';
    _prodState.clientSlug = '';
    _prodState.openId = '';
    _prodState.filters = [{ field: 'status', values: ['todo'] }];
    _prodRender();
  });
}

async function run() {
  const gaps = [];
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
    await artifact.waitForSelector('.row', { timeout: 30000 });
    await wired.waitForSelector('.prod-row, .prod-empty, .prod-error', { timeout: 30000 });
    if (await wired.locator('.prod-error').count()) throw new Error('wired Production tab rendered error state');
    await shot(artifact, 'artifact-list');
    await shot(wired, 'wired-list');

    await requirePair(gaps, 'list inventory', artifact, wired, '.sb-brand', '.prod-brand');
    await requirePair(gaps, 'list inventory', artifact, wired, '.sb-icobtn', '.prod-search-btn');
    await requirePair(gaps, 'list inventory', artifact, wired, '#filterbtn', '#prodFilterBtn');
    await requirePair(gaps, 'list inventory', artifact, wired, '#groupbtn', '#prodGroupBtn');
    await requirePair(gaps, 'list inventory', artifact, wired, '.grp-hd', '.prod-group');
    await requirePair(gaps, 'list inventory', artifact, wired, '.row', '.prod-row');
    const artifactTabs = await artifact.locator('.tb-tabs .tb-tab').evaluateAll(nodes => nodes.map(n => (n.textContent || '').trim()));
    const wiredTabs = await wired.locator('.prod-tabs .prod-tab').evaluateAll(nodes => nodes.map(n => (n.textContent || '').trim()));
    if (artifactTabs.join('|') !== 'All issues|Active|Backlog') {
      gaps.push({ rank: 1, state: 'list tabs', message: `artifact order ${artifactTabs.join(',')}` });
    }
    if (wiredTabs.join('|') !== artifactTabs.join('|')) {
      gaps.push({ rank: 1, state: 'list tabs', message: `wired order ${wiredTabs.join(',')} vs artifact ${artifactTabs.join(',')}` });
    }
    const wiredTopbar = (await wired.locator('.prod-topbar').first().innerText()).replace(/\s+/g, ' ');
    if (/\b(New issue|Refresh)\b/.test(wiredTopbar)) gaps.push({ rank: 1, state: 'topbar', message: 'wired topbar contains non-artifact New issue/Refresh chrome' });
    const previewChips = await wired.locator('.prod-preview-chip').count();
    if (previewChips !== 1) gaps.push({ rank: 2, state: 'topbar', message: `Preview chip count expected 1, saw ${previewChips}` });

    const filterA = await iconPaths(artifact, '#filterbtn');
    const filterW = await iconPaths(wired, '#prodFilterBtn');
    if (filterA.join('|') !== filterW.join('|')) gaps.push({ rank: 1, state: 'icons', message: `filter icon path drift: ${filterW.join('|')}` });
    const displayA = await iconPaths(artifact, '#groupbtn');
    const displayW = await iconPaths(wired, '#prodGroupBtn');
    if (displayA.join('|') !== displayW.join('|')) gaps.push({ rank: 1, state: 'icons', message: `display icon path drift: ${displayW.join('|')}` });
    await compareStyles(gaps, 'toolbar icon buttons', artifact, wired, '#filterbtn', '#prodFilterBtn', ['width', 'height', 'display', 'alignItems', 'justifyContent', 'cursor', 'borderRadius', 'color']);

    await artifact.locator('[data-act="search"]').click();
    await wired.locator('.prod-search-btn').click();
    await artifact.waitForSelector('.cmdk .cmdk-item');
    await wired.waitForSelector('.prod-cmd .prod-cmd-item');
    await shot(artifact, 'artifact-palette-default');
    await shot(wired, 'wired-palette-default');
    await shotElement(artifact, '.cmdk', 'artifact-crop-palette-default');
    await shotElement(wired, '.prod-cmd', 'wired-crop-palette-default');
    const palettePlaceholderA = await artifact.locator('.cmdk-inp').getAttribute('placeholder');
    const palettePlaceholderW = await wired.locator('.prod-cmd-input').getAttribute('placeholder');
    if (palettePlaceholderA !== palettePlaceholderW) gaps.push({ rank: 1, state: 'palette placeholder', message: `artifact=${palettePlaceholderA} wired=${palettePlaceholderW}` });
    const paletteA = await commandInventory(artifact, '.cmdk-item');
    const paletteW = await commandInventory(wired, '.prod-cmd-item');
    if (paletteA.length !== paletteW.length) gaps.push({ rank: 1, state: 'palette default inventory', message: `row count artifact=${paletteA.length} wired=${paletteW.length}` });
    const issueLikeA = paletteA.slice(0, 6).filter(r => r.meta !== 'Command').length;
    const issueLikeW = paletteW.slice(0, 6).filter(r => r.meta !== 'Command').length;
    if (issueLikeA !== issueLikeW || issueLikeW !== 6) gaps.push({ rank: 1, state: 'palette default inventory', message: `top issue rows artifact=${issueLikeA} wired=${issueLikeW}` });
    comparePaletteCommandRows(gaps, 'palette default commands', paletteA, paletteW, 6);
    await artifact.locator('.cmdk-inp').fill('my issues');
    await wired.locator('.prod-cmd-input').fill('my issues');
    await artifact.waitForFunction(() => Array.from(document.querySelectorAll('.cmdk-item')).some(el => el.textContent.includes('Go to My issues')));
    await wired.waitForFunction(() => Array.from(document.querySelectorAll('.prod-cmd-item')).some(el => el.textContent.includes('Go to My issues')));
    await shotElement(artifact, '.cmdk', 'artifact-crop-palette-search-command');
    await shotElement(wired, '.prod-cmd', 'wired-crop-palette-search-command');
    const searchA = await commandInventory(artifact, '.cmdk-item');
    const searchW = await commandInventory(wired, '.prod-cmd-item');
    if (searchA[0]?.title !== searchW[0]?.title || searchA[0]?.meta !== searchW[0]?.meta) {
      gaps.push({ rank: 1, state: 'palette command search', message: `artifact=${searchA[0]?.title}/${searchA[0]?.meta} wired=${searchW[0]?.title}/${searchW[0]?.meta}` });
    }
    await artifact.locator('.cmdk-inp').fill('zzzznomatch');
    await wired.locator('.prod-cmd-input').fill('zzzznomatch');
    await artifact.waitForSelector('.cmdk-empty');
    await wired.waitForSelector('.prod-cmd-empty');
    const emptyA = (await artifact.locator('.cmdk-empty').innerText()).trim();
    const emptyW = (await wired.locator('.prod-cmd-empty').innerText()).trim();
    if (emptyA !== emptyW) gaps.push({ rank: 1, state: 'palette empty', message: `artifact=${emptyA} wired=${emptyW}` });
    await artifact.keyboard.press('Escape');
    await wired.keyboard.press('Escape');

    await artifact.waitForSelector('.askdock');
    await wired.waitForSelector('[data-prod-askdock]');
    await shotElement(artifact, '.askdock', 'artifact-crop-askdock');
    await shotElement(wired, '.prod-askdock', 'wired-crop-askdock');
    await compareStyles(gaps, 'global Ask Linear dock', artifact, wired, '.askdock', '.prod-askdock', ['position', 'right', 'bottom', 'display', 'alignItems', 'gap', 'color']);
    await compareStyles(gaps, 'global Ask Linear main', artifact, wired, '#askdock-main', '#prodAskDockMain', ['height', 'display', 'alignItems', 'justifyContent', 'cursor', 'borderRadius', 'backgroundColor', 'paddingLeft', 'paddingRight']);
    await compareStyles(gaps, 'global Ask Linear history', artifact, wired, '#askdock-history', '#prodAskDockHistory', ['width', 'height', 'display', 'alignItems', 'justifyContent', 'cursor', 'borderRadius', 'backgroundColor']);
    const artifactDockPaths = await artifact.locator('.askdock svg path').evaluateAll(nodes => nodes.map(n => n.getAttribute('d') || '').join('|'));
    const wiredDockPaths = await wired.locator('.prod-askdock svg path').evaluateAll(nodes => nodes.map(n => n.getAttribute('d') || '').join('|'));
    if (artifactDockPaths !== wiredDockPaths) gaps.push({ rank: 1, state: 'global Ask Linear dock', message: 'icon path drift' });
    await artifact.waitForSelector('.newsdock');
    await wired.waitForSelector('[data-prod-newsdock]');
    await shotElement(artifact, '.newsdock', 'artifact-crop-newsdock');
    await shotElement(wired, '.prod-newsdock', 'wired-crop-newsdock');
    await compareStyles(gaps, 'bottom-left news dock', artifact, wired, '.newsdock', '.prod-newsdock', ['position', 'left', 'bottom', 'width', 'height', 'display', 'color']);
    await compareStyles(gaps, 'bottom-left news dock main', artifact, wired, '#newsdock-main', '#prodNewsDockMain', ['width', 'height', 'display', 'alignItems', 'justifyContent', 'gap', 'cursor', 'borderRadius', 'backgroundColor', 'paddingLeft', 'paddingRight']);
    await compareStyles(gaps, 'bottom-left news dock collapse', artifact, wired, '#newsdock-collapse', '#prodNewsDockCollapse', ['width', 'height', 'display', 'alignItems', 'justifyContent', 'cursor', 'borderRadius', 'backgroundColor']);
    const artifactNewsText = (await artifact.locator('.newsdock').innerText()).replace(/\s+/g, ' ').trim();
    const wiredNewsText = (await wired.locator('.prod-newsdock').innerText()).replace(/\s+/g, ' ').trim();
    if (artifactNewsText !== wiredNewsText) gaps.push({ rank: 1, state: 'bottom-left news dock', message: `text drift artifact=${artifactNewsText} wired=${wiredNewsText}` });
    const artifactNewsPath = await artifact.locator('.newsdock .news-collapse svg path').first().getAttribute('d');
    const wiredNewsPath = await wired.locator('.prod-newsdock .news-collapse svg path').first().getAttribute('d');
    if (artifactNewsPath !== wiredNewsPath) gaps.push({ rank: 1, state: 'bottom-left news dock', message: 'collapse icon path drift' });

    await setupSelection(artifact, wired);
    await artifact.waitForSelector('.actionbar');
    await wired.waitForSelector('[data-prod-actionbar]');
    await shot(artifact, 'artifact-selection-actionbar');
    await shot(wired, 'wired-selection-actionbar');
    await shotElement(artifact, '.actionbar', 'artifact-crop-selection-actionbar');
    await shotElement(wired, '.prod-actionbar', 'wired-crop-selection-actionbar');
    await compareStyles(gaps, 'selection actionbar', artifact, wired, '.actionbar', '.prod-actionbar', ['height', 'display', 'alignItems', 'gap', 'paddingTop', 'paddingBottom', 'borderRadius', 'backgroundColor', 'boxShadow']);
    const artifactQuick = await artifact.locator('#ab-status, #ab-assign, #ab-due').count();
    const wiredQuick = await wired.locator('#prodBulkStatus, #prodBulkAssign, #prodBulkDue').count();
    if (artifactQuick || wiredQuick) gaps.push({ rank: 1, state: 'selection quick buttons', message: `artifact=${artifactQuick} wired=${wiredQuick}; live Linear actionbar has no status/assignee/due quick buttons` });
    await compareStyles(gaps, 'selection actions button', artifact, wired, '#ab-actions', '#prodBulkActions', ['height', 'display', 'alignItems', 'justifyContent', 'cursor', 'borderRadius', 'backgroundColor']);
    const artifactAskButton = await artifact.locator('#ab-ask').count();
    const wiredAskButton = await wired.locator('#prodBulkAsk').count();
    if (artifactAskButton !== 1 || wiredAskButton !== 1) gaps.push({ rank: 1, state: 'selection Ask Linear button', message: `artifact=${artifactAskButton} wired=${wiredAskButton}` });
    await compareStyles(gaps, 'selection Ask Linear button', artifact, wired, '#ab-ask', '#prodBulkAsk', ['width', 'height', 'display', 'alignItems', 'justifyContent', 'cursor', 'borderRadius', 'backgroundColor']);
    const artifactAskPath = await artifact.locator('#ab-ask svg path').first().getAttribute('d');
    const wiredAskPath = await wired.locator('#prodBulkAsk svg path').first().getAttribute('d');
    if (artifactAskPath !== wiredAskPath) gaps.push({ rank: 1, state: 'selection Ask Linear button', message: 'icon path drift' });
    await compareStyles(gaps, 'selection checkbox', artifact, wired, '.check.on', '.prod-check.on', ['width', 'height', 'display', 'alignItems', 'justifyItems', 'borderRadius', 'backgroundColor']);

    await artifact.locator('#ab-actions').click();
    await wired.locator('#prodBulkActions').click();
    await artifact.waitForSelector('#layer .cmdk.actioncmd');
    await wired.waitForSelector('#prodLayer .prod-actioncmd');
    await compareStyles(gaps, 'selection Actions Ask Linear hint', artifact, wired, '#layer .cmdk-ask', '#prodLayer .prod-cmd-ask', ['display', 'alignItems', 'gap']);
    const askGap = await wired.locator('#prodLayer .prod-cmd-ask').first().evaluate(el => getComputedStyle(el).gap);
    if (parseFloat(askGap || '0') < 4) gaps.push({ rank: 2, state: 'selection Actions Ask Linear hint', message: `Tab hint gap too small: ${askGap}` });
    await compareStyles(gaps, 'selection Actions input focus outline', artifact, wired, '#layer .cmdk.actioncmd .cmdk-inp', '#prodLayer .prod-actioncmd .prod-cmd-input', ['outlineStyle', 'outlineWidth']);
    const actionInputOutline = await wired.locator('#prodLayer .prod-actioncmd .prod-cmd-input').first().evaluate(el => getComputedStyle(el).outlineStyle);
    if (actionInputOutline && actionInputOutline !== 'none') gaps.push({ rank: 2, state: 'selection Actions input focus outline', message: `unexpected focused outline: ${actionInputOutline}` });
    const actionRowsA = await commandInventory(artifact, '#layer .cmdk.actioncmd [data-bulkact]');
    const actionRowsW = await commandInventory(wired, '#prodLayer .prod-actioncmd [data-prod-bulkact]');
    if (actionRowsA.length !== actionRowsW.length) gaps.push({ rank: 1, state: 'selection Actions command', message: `row count mismatch artifact=${actionRowsA.length} wired=${actionRowsW.length}` });
    actionRowsA.forEach((a, i) => {
      const w = actionRowsW[i] || {};
      if (a.title !== w.title) gaps.push({ rank: 1, state: 'selection Actions command', message: `row ${i} title artifact=${a.title} wired=${w.title}` });
      if (a.meta !== w.meta) gaps.push({ rank: 1, state: 'selection Actions command', message: `row ${i} meta artifact=${a.meta || '(empty)'} wired=${w.meta || '(empty)'}` });
      if (a.paths.join('|') !== w.paths.join('|')) gaps.push({ rank: 1, state: 'selection Actions command', message: `row ${i} icon path drift for ${a.title}` });
    });
    const actionLabels = actionRowsW.map(r => r.title).join('|');
    ['Assign to...', 'Assign to me', 'Change status...', 'Move to project...', 'Change due date...', 'Copy issue ID', 'Copy issue URL', 'Copy issue title', 'Copy title as link', 'Copy issue description as Markdown', 'Copy issue content as Markdown', 'Copy git branch name', 'Copy as prompt'].forEach(label => {
      if (!actionLabels.includes(label)) gaps.push({ rank: 1, state: 'selection Actions command', message: 'missing ' + label });
    });
    ['Change priority', 'Add labels', 'Add to cycle', 'Move to a different team', 'Subscribe'].forEach(label => {
      if (actionLabels.includes(label)) gaps.push({ rank: 1, state: 'selection Actions command', message: 'removed Linear surface reappeared: ' + label });
    });
    await shotElement(artifact, '#layer .cmdk.actioncmd', 'artifact-crop-selection-actions-menu');
    await shotElement(wired, '#prodLayer .prod-actioncmd', 'wired-crop-selection-actions-menu');
    await artifact.locator('#layer .cmdk.actioncmd .cmdk-inp').fill('status');
    await wired.locator('#prodLayer .prod-actioncmd .prod-cmd-input').fill('status');
    await artifact.waitForSelector('#layer [data-bulkact="statusValue"]');
    await wired.waitForSelector('#prodLayer [data-prod-bulkact="statusValue"]');
    const actionSearchRowsA = await commandInventory(artifact, '#layer .cmdk.actioncmd [data-bulkact]');
    const actionSearchRowsW = await commandInventory(wired, '#prodLayer .prod-actioncmd [data-prod-bulkact]');
    if (!actionSearchRowsW.some(r => r.title === 'Change status Backlog')) gaps.push({ rank: 1, state: 'selection Actions status search', message: 'missing direct Backlog status command' });
    if (!actionSearchRowsW.some(r => r.title === 'Change status In Progress')) gaps.push({ rank: 1, state: 'selection Actions status search', message: 'missing direct In Progress status command' });
    if (actionSearchRowsA.length !== actionSearchRowsW.length) gaps.push({ rank: 1, state: 'selection Actions status search', message: `row count mismatch artifact=${actionSearchRowsA.length} wired=${actionSearchRowsW.length}` });
    await shotElement(artifact, '#layer .cmdk.actioncmd', 'artifact-crop-selection-actions-search-status');
    await shotElement(wired, '#prodLayer .prod-actioncmd', 'wired-crop-selection-actions-search-status');
    await artifact.locator('#layer .cmdk.actioncmd .cmdk-inp').fill('');
    await wired.locator('#prodLayer .prod-actioncmd .prod-cmd-input').fill('');
    await artifact.locator('#layer [data-bulkact="status"]').click();
    await wired.locator('#prodLayer [data-prod-bulkact="status"]').click();
    await artifact.waitForSelector('#layer .pop [data-i]');
    await wired.waitForSelector('#prodLayer .prod-pop [data-prod-pick]');
    const artifactStatusRows = await pickerInventory(artifact, '#layer .pop [data-i]');
    const wiredStatusRows = await pickerInventory(wired, '#prodLayer .prod-pop [data-prod-pick]');
    comparePickerInventory(gaps, 'status picker inventory', artifactStatusRows, wiredStatusRows);
    const statusOrder = wiredStatusRows.map(r => r.label);
    if (statusOrder[0] !== 'Backlog' || statusOrder[statusOrder.length - 1] !== 'Triage') {
      gaps.push({ rank: 1, state: 'status picker order', message: `wired order starts/ends ${statusOrder[0]} / ${statusOrder[statusOrder.length - 1]}` });
    }
    const statusHints = wiredStatusRows.map(r => r.kbd);
    const expectedHints = artifactStatusRows.map(r => r.kbd);
    if (statusHints.join('|') !== expectedHints.join('|')) {
      gaps.push({ rank: 1, state: 'status picker kbd hints', message: `wired ${statusHints.join(',')} vs artifact ${expectedHints.join(',')}` });
    }
    await compareStyles(gaps, 'status picker selected tick', artifact, wired, '#layer .pop .tick', '#prodLayer .prod-pop .tick', ['color', 'marginLeft', 'order', 'display']);
    const actionRects = {
      aPop: await artifact.locator('#layer .pop:last-child').first().boundingBox(),
      aBar: await artifact.locator('.actionbar').first().boundingBox(),
      wPop: await wired.locator('#prodLayer .prod-pop:last-child').first().boundingBox(),
      wBar: await wired.locator('.prod-actionbar').first().boundingBox(),
    };
    if (actionRects.wPop.y + actionRects.wPop.height > actionRects.wBar.y - 4) gaps.push({ rank: 1, state: 'bulk picker', message: 'wired bulk picker is not anchored above the action bar' });
    if (actionRects.wPop.y < 0 || actionRects.wPop.y + actionRects.wPop.height > 950) gaps.push({ rank: 1, state: 'bulk picker', message: 'wired bulk picker is off-screen' });
    // PORT-DELTA: owner-reported embedded-tab fix requires the wired picker to sit
    // above the action bar even when the standalone artifact overlaps it here.
    await shot(artifact, 'artifact-actionbar-status-picker');
    await shot(wired, 'wired-actionbar-status-picker');
    await shotElement(artifact, '#layer .pop:last-child', 'artifact-crop-status-picker');
    await shotElement(wired, '#prodLayer .prod-pop:last-child', 'wired-crop-status-picker');
    await artifact.keyboard.press('Escape');
    await artifact.evaluate(() => { if (typeof clearLayer === 'function') clearLayer(); });
    await wired.evaluate(() => { if (typeof _prodClearLayer === 'function') _prodClearLayer(); });
    await wired.keyboard.press('Escape');
    const cleared = await wired.evaluate(() => _prodState.selected.size === 0 && !document.querySelector('[data-prod-actionbar]'));
    if (!cleared) gaps.push({ rank: 1, state: 'escape cascade', message: 'Escape did not clear wired multi-select/actionbar before navigation' });

    await artifact.evaluate(() => {
      S.open = null;
      S.projectOpen = null;
      S.view = { type: 'issues', team: 'video' };
      S.selected.clear();
      render();
    });
    await wired.evaluate(() => {
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openProjectId = '';
      _prodState.selected.clear();
      _prodRender();
    });
    await artifact.locator('.row').first().click({ button: 'right' });
    await wired.locator('.prod-row').first().click({ button: 'right' });
    await artifact.waitForSelector('#layer .pop [data-ctx]');
    await wired.waitForSelector('#prodLayer .prod-pop [data-prod-ctx], #prodLayer .prod-pop [data-prod-disabled]');
    await shotElement(artifact, '#layer .pop', 'artifact-crop-row-context-menu');
    await shotElement(wired, '#prodLayer .prod-pop', 'wired-crop-row-context-menu');
    compareMenuInventory(gaps, 'row context menu inventory', await pickerInventory(artifact, '#layer .pop .mi'), await pickerInventory(wired, '#prodLayer .prod-pop .prod-mi'));
    await artifact.locator('#layer .pop [data-ctx="status"]').hover();
    await wired.locator('#prodLayer .prod-pop [data-prod-ctx="status"]').hover();
    await artifact.waitForSelector('#layer .pop [data-i]');
    await wired.waitForSelector('#prodLayer .prod-pop [data-prod-pick]');
    await shotElement(artifact, '#layer .pop:last-child', 'artifact-crop-context-status-submenu');
    await shotElement(wired, '#prodLayer .prod-pop:last-child', 'wired-crop-context-status-submenu');
    comparePickerInventory(gaps, 'context status submenu inventory', await pickerInventory(artifact, '#layer .pop [data-i]'), await pickerInventory(wired, '#prodLayer .prod-pop [data-prod-pick]'));
    await artifact.keyboard.press('Escape');
    await wired.evaluate(() => { if (typeof _prodClearLayer === 'function') _prodClearLayer(); });

    await artifact.evaluate(() => {
      if (typeof clearLayer === 'function') clearLayer();
      S.open = null;
      S.projectOpen = null;
      S.view = { type: 'issues', team: 'video' };
      S.filters = [];
      S.selected.clear();
      const ai = curIssues()[0] || ISSUES[0];
      if (ai) ai.due = '';
      render();
    });
    await wired.evaluate(() => {
      if (typeof _prodClearLayer === 'function') _prodClearLayer();
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openProjectId = '';
      _prodState.filters = [];
      _prodState.selected.clear();
      const wi = _prodIssueRows()[0] || _prodIssues()[0];
      if (wi) { wi.due = ''; wi.dueRaw = ''; }
      _prodRender();
    });
    await artifact.locator('.due.due-empty').first().click();
    await wired.locator('.prod-due.optional').first().click();
    await artifact.waitForSelector('#layer .pop.duepop .mi');
    await wired.waitForSelector('#prodLayer .prod-duepop .prod-mi');
    await shotElement(artifact, '#layer .pop.duepop', 'artifact-crop-due-popover');
    await shotElement(wired, '#prodLayer .prod-duepop', 'wired-crop-due-popover');
    compareDueInventory(gaps, 'due quick inventory', await pickerInventory(artifact, '#layer .pop.duepop .mi'), await pickerInventory(wired, '#prodLayer .prod-duepop .prod-mi'));
    const duePlaceholderA = await artifact.locator('#layer .pop.duepop [data-search]').first().getAttribute('placeholder');
    const duePlaceholderW = await wired.locator('#prodLayer .prod-duepop [data-prod-search]').first().getAttribute('placeholder');
    if (duePlaceholderA !== duePlaceholderW) gaps.push({ rank: 1, state: 'due popover placeholder', message: `artifact=${duePlaceholderA} wired=${duePlaceholderW}` });
    await artifact.locator('#layer .pop.duepop [data-set="__custom__"]').first().click();
    await wired.locator('#prodLayer .prod-duepop [data-prod-set="__custom__"]').first().click();
    await artifact.waitForSelector('#layer .pop.duepop .cal');
    await wired.waitForSelector('#prodLayer .prod-duepop .prod-cal');
    await shotElement(artifact, '#layer .pop.duepop', 'artifact-crop-due-calendar');
    await shotElement(wired, '#prodLayer .prod-duepop', 'wired-crop-due-calendar');
    const dueMonthA = (await artifact.locator('#layer .pop.duepop .cal-mo').first().innerText()).trim();
    const dueMonthW = (await wired.locator('#prodLayer .prod-duepop .prod-cal-mo').first().innerText()).trim();
    if (dueMonthA !== dueMonthW) gaps.push({ rank: 1, state: 'due calendar month', message: `artifact=${dueMonthA} wired=${dueMonthW}` });
    const dueTodayA = (await artifact.locator('#layer .pop.duepop .cal-d.today').first().innerText()).trim();
    const dueTodayW = (await wired.locator('#prodLayer .prod-duepop .prod-cal-d.today').first().innerText()).trim();
    if (dueTodayA !== dueTodayW) gaps.push({ rank: 1, state: 'due calendar today', message: `artifact=${dueTodayA} wired=${dueTodayW}` });
    await artifact.evaluate(() => { if (typeof clearLayer === 'function') clearLayer(); });
    await wired.evaluate(() => { if (typeof _prodClearLayer === 'function') _prodClearLayer(); });

    await setupFilterPill(artifact, wired);
    await artifact.waitForSelector('.fpill');
    await wired.waitForSelector('.prod-filter-pill.interactive');
    await shot(artifact, 'artifact-filter-pill');
    await shot(wired, 'wired-filter-pill');
    await shotElement(artifact, '.fpill', 'artifact-crop-filter-pill');
    await shotElement(wired, '.prod-filter-pill.interactive', 'wired-crop-filter-pill');
    await compareStyles(gaps, 'filter pill', artifact, wired, '.fpill', '.prod-filter-pill.interactive', ['height', 'paddingLeft', 'paddingRight', 'borderRadius', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'cursor', 'display', 'alignItems', 'gap']);
    const filterPillA = await iconPaths(artifact, '.fpill .ficon');
    const filterPillW = await iconPaths(wired, '.prod-filter-pill.interactive .ficon');
    if (filterPillA.join('|') !== filterPillW.join('|')) gaps.push({ rank: 1, state: 'filter pill icon', message: `filter field icon drift: ${filterPillW.join('|')}` });
    const filterRemoveA = (await artifact.locator('.fpill .fx').first().innerText()).trim();
    const filterRemoveW = (await wired.locator('.prod-filter-pill.interactive .fx').first().innerText()).trim();
    if (filterRemoveA !== filterRemoveW) gaps.push({ rank: 1, state: 'filter pill remove', message: `remove glyph artifact=${filterRemoveA} wired=${filterRemoveW}` });
    const fxCursor = await wired.locator('.prod-filter-pill.interactive .fx').first().evaluate(el => getComputedStyle(el).cursor);
    if (fxCursor !== 'pointer') gaps.push({ rank: 1, state: 'filter pill', message: `filter remove cursor is ${fxCursor}` });
    await wired.locator('.prod-filter-pill.interactive').first().click();
    await wired.waitForSelector('#prodLayer .prod-pop [data-prod-search]', { timeout: 5000 });
    await shot(wired, 'wired-filter-pill-editor');
    await wired.evaluate(() => { if (typeof _prodClearLayer === 'function') _prodClearLayer(); });
    await wired.locator('.prod-filter-pill.interactive .fx').first().click();
    const removed = await wired.evaluate(() => !_prodState.filters.length);
    if (!removed) gaps.push({ rank: 1, state: 'filter pill', message: 'filter × did not remove local read-only filter state' });

    await artifact.evaluate(() => {
      if (typeof clearLayer === 'function') clearLayer();
      S.open = null;
      S.projectOpen = null;
      S.view = { type: 'issues', team: 'video' };
      S.tab = 'active';
      S.filters = [{ field: 'status', values: ['duplicate'] }];
      S.selected.clear();
      render();
    });
    await wired.evaluate(() => {
      if (typeof _prodClearLayer === 'function') _prodClearLayer();
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.tab = 'active';
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openProjectId = '';
      _prodState.filters = [{ field: 'status', values: ['duplicate'] }];
      _prodState.selected.clear();
      _prodRender();
    });
    await artifact.waitForSelector('.empty-state');
    await wired.waitForSelector('.prod-empty-state');
    await shot(artifact, 'artifact-empty-filtered-list');
    await shot(wired, 'wired-empty-filtered-list');
    await shotElement(artifact, '.empty-state', 'artifact-crop-empty-filtered-list');
    await shotElement(wired, '.prod-empty-state', 'wired-crop-empty-filtered-list');
    const filteredEmptyA = await emptyStateInventory(artifact, '.empty-state');
    const filteredEmptyW = await emptyStateInventory(wired, '.prod-empty-state');
    if (filteredEmptyA.message !== filteredEmptyW.message) gaps.push({ rank: 1, state: 'filtered empty state', message: `message artifact=${filteredEmptyA.message} wired=${filteredEmptyW.message}` });
    if (filteredEmptyA.button !== filteredEmptyW.button) gaps.push({ rank: 1, state: 'filtered empty state', message: `button artifact=${filteredEmptyA.button} wired=${filteredEmptyW.button}` });
    if (filteredEmptyA.paths.join('|') !== filteredEmptyW.paths.join('|')) gaps.push({ rank: 1, state: 'filtered empty state', message: 'icon path drift' });
    await compareStyles(gaps, 'filtered empty state', artifact, wired, '.empty-state', '.prod-empty-state', ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'textAlign', 'color', 'display', 'alignItems', 'justifyContent', 'gap']);
    const wiredEmptyFill = await wired.evaluate(() => {
      const el = document.querySelector('.prod-empty-state');
      const parent = document.querySelector('.prod-content');
      if (!el || !parent) return false;
      return el.getBoundingClientRect().width >= parent.getBoundingClientRect().width - 2;
    });
    if (!wiredEmptyFill) gaps.push({ rank: 1, state: 'filtered empty state', message: 'wired empty state does not fill its pane' });
    await artifact.locator('.empty-state .es-clear').click();
    await wired.locator('.prod-empty-state .es-clear').click();
    const emptyCleared = await wired.evaluate(() => !_prodState.filters.length);
    if (!emptyCleared) gaps.push({ rank: 1, state: 'filtered empty state', message: 'Clear filters did not remove local read-only filter state' });

    await artifact.evaluate(() => { S.view = { type: 'projects', team: 'video' }; S.projectOpen = null; S.open = null; render(); });
    await wired.evaluate(() => window._prodOpenTeamView('video', 'board'));
    await artifact.waitForSelector('.board');
    await wired.waitForSelector('.prod-board');
    await requirePair(gaps, 'board inventory', artifact, wired, '.pcard', '.prod-card');
    await requirePair(gaps, 'board inventory', artifact, wired, '[data-pcolcollapse]', '[data-prod-pcolcollapse]');
    const artifactCardDescriptions = await artifact.locator('.pcard-desc').count();
    const wiredCardDescriptions = await wired.locator('.prod-card-desc').count();
    if (artifactCardDescriptions || wiredCardDescriptions) {
      gaps.push({ rank: 1, state: 'board card compactness', message: `description rows artifact=${artifactCardDescriptions} wired=${wiredCardDescriptions}` });
    }
    await shot(artifact, 'artifact-board');
    await shot(wired, 'wired-board');
    await compareStyles(gaps, 'board scroll axis', artifact, wired, '.board', '.prod-board', ['overflowX', 'overflowY']);
    await compareStyles(gaps, 'board column collapse control', artifact, wired, '.pcol-chev', '.prod-col-collapse', ['borderTopWidth', 'backgroundColor', 'opacity', 'cursor']);
    await compareStyles(gaps, 'board card drag cursor', artifact, wired, '.pcard', '.prod-card', ['cursor']);
    await artifact.evaluate(() => {
      const card = document.querySelector('.pcard[data-project]');
      if (!card) return;
      const id = card.getAttribute('data-project');
      const client = CLIENTS.find(c => c.id === id);
      const target = [...document.querySelectorAll('[data-pcol]')].find(col => !client || col.getAttribute('data-pcol') !== client.status);
      card.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
      if (target) target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    });
    await wired.evaluate(() => {
      const card = document.querySelector('.prod-card[data-prod-client-card]');
      if (!card) return;
      const id = card.getAttribute('data-prod-client-card');
      const client = _prodClient(id);
      const current = client ? _prodBoardStatus(client.status) : '';
      const target = [...document.querySelectorAll('[data-prod-col]')].find(col => col.getAttribute('data-prod-col') !== current);
      card.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
      if (target) target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    });
    await shotElement(artifact, '.pcol-drop', 'artifact-crop-board-drop-target');
    await shotElement(wired, '.prod-col-drop', 'wired-crop-board-drop-target');
    const artifactDragFx = await artifact.evaluate(() => ({
      dragging: !!document.querySelector('.pcard-dragging'),
      drop: !!document.querySelector('.pcol-drop'),
    }));
    const wiredDragFx = await wired.evaluate(() => ({
      dragging: !!document.querySelector('.prod-card-dragging.pcard-dragging'),
      drop: !!document.querySelector('.prod-col-drop'),
    }));
    if (artifactDragFx.dragging !== wiredDragFx.dragging) gaps.push({ rank: 1, state: 'board drag chrome', message: `dragging class artifact=${artifactDragFx.dragging} wired=${wiredDragFx.dragging}` });
    if (artifactDragFx.drop !== wiredDragFx.drop) gaps.push({ rank: 1, state: 'board drag chrome', message: `drop highlight artifact=${artifactDragFx.drop} wired=${wiredDragFx.drop}` });
    const wiredDropGuard = await wired.evaluate(() => {
      const card = document.querySelector('.prod-card[data-prod-client-card]');
      const id = card ? card.getAttribute('data-prod-client-card') : '';
      const before = id && _prodClient(id) ? _prodBoardStatus(_prodClient(id).status) : '';
      const target = document.querySelector('.prod-col-drop');
      if (target) target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
      const after = id && _prodClient(id) ? _prodBoardStatus(_prodClient(id).status) : '';
      const toast = document.getElementById('prodToast');
      return {
        same: before === after,
        toast: toast ? (toast.textContent || '').trim() : '',
        dragging: !!document.querySelector('.prod-card-dragging, .pcard-dragging'),
        drop: !!document.querySelector('.prod-col-drop'),
      };
    });
    if (!wiredDropGuard.same) gaps.push({ rank: 1, state: 'board drag guard', message: 'wired read-only drop changed project status' });
    if (!/Preview - read-only/.test(wiredDropGuard.toast)) gaps.push({ rank: 1, state: 'board drag guard', message: `wired drop toast was ${wiredDropGuard.toast || '(empty)'}` });
    if (wiredDropGuard.dragging || wiredDropGuard.drop) gaps.push({ rank: 2, state: 'board drag guard', message: 'wired drag/drop visual state did not clean up after guarded drop' });
    await artifact.evaluate(() => {
      const target = document.querySelector('.pcol-drop');
      if (target) target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
      if (typeof clearDropFx === 'function') clearDropFx();
    });

    await artifact.evaluate(() => { S.view = { type: 'issues', team: 'video' }; S.filters = []; render(); const id = flatOrder()[0]; if (id) openIssue(id); });
    await wired.evaluate(() => { _prodOpenTeamView('video', 'list'); const id = _prodFlatOrder()[0]; if (id) _prodOpenDeliverable(id); });
    await artifact.waitForSelector('.detail');
    await wired.waitForSelector('.prod-detail');
    await requirePair(gaps, 'detail inventory', artifact, wired, '.ds-card', '.prod-side-card');
    await requirePair(gaps, 'detail inventory', artifact, wired, '.composer-box', '.prod-composer-box');
    await shot(artifact, 'artifact-detail');
    await shot(wired, 'wired-detail');

    await artifact.evaluate(() => {
      if (typeof clearLayer === 'function') clearLayer();
      S.open = null;
      S.projectOpen = null;
      S.view = { type: 'issues', team: 'video' };
      S.filters = [];
      S.selected.clear();
      render();
      replaceLoc();
    });
    await wired.evaluate(() => {
      if (typeof _prodClearLayer === 'function') _prodClearLayer();
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.clientSlug = '';
      _prodState.openId = '';
      _prodState.openProjectId = '';
      _prodState.filters = [];
      _prodState.selected.clear();
      _prodSetQuery({}, false);
      _prodRender();
    });
    await artifact.locator('.row').first().click();
    await wired.locator('.prod-row').first().click();
    await artifact.waitForSelector('.detail');
    await wired.waitForSelector('.prod-detail');
    await shot(artifact, 'artifact-history-detail');
    await shot(wired, 'wired-history-detail');
    const detailIdBeforeRefresh = await wired.evaluate(() => _prodState.openId);
    await artifact.goBack();
    await wired.goBack();
    await artifact.waitForSelector('.row');
    await wired.waitForSelector('.prod-row');
    await shot(artifact, 'artifact-history-back-list');
    await shot(wired, 'wired-history-back-list');
    await artifact.goForward();
    await wired.goForward();
    await artifact.waitForSelector('.detail');
    await wired.waitForSelector('.prod-detail');
    await shot(artifact, 'artifact-history-forward-detail');
    await shot(wired, 'wired-history-forward-detail');
    const forwardRestored = await wired.evaluate(id => _prodState.view === 'detail' && _prodState.openId === id, detailIdBeforeRefresh);
    if (!forwardRestored) gaps.push({ rank: 1, state: 'browser history', message: 'wired forward navigation did not restore the opened detail' });
    await wired.reload({ waitUntil: 'domcontentloaded' });
    await wired.waitForSelector('.prod-detail', { timeout: 30000 });
    const refreshRestored = await wired.evaluate(id => _prodState.view === 'detail' && _prodState.openId === id, detailIdBeforeRefresh);
    if (!refreshRestored) gaps.push({ rank: 1, state: 'browser refresh', message: 'wired detail deep link did not restore after refresh' });
    await shot(wired, 'wired-history-refresh-detail');

    gaps.sort((a, b) => a.rank - b.rank || a.state.localeCompare(b.state));
    if (gaps.length) {
      console.error('pixel-wired gaps:');
      gaps.forEach(g => console.error(`  [P${g.rank}] ${g.state}: ${g.message}`));
      throw new Error(`${gaps.length} pixel parity gap(s) found`);
    }
    console.log('pixel-wired: list, icon paths, palette, selection/actionbar, status picker inventory, row context menu, context status submenu, due popover, bulk picker anchor, filter pill, filtered empty state, board drag/scroll, detail, and browser history parity checks passed');
    console.log('pixel-wired screenshots: ' + outDir);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

run().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
