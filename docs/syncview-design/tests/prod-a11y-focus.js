'use strict';

const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const {
  serveStatic,
  isWriteLikeRequest,
  installProductionInit,
  openProduction,
  formatFailures,
} = require('./prod-test-utils');

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push(req));
  await installProductionInit(page);

  try {
    await openProduction(page, port);
    const failures = [];

    const axe = await new AxeBuilder({ page })
      .include('#prodRoot')
      .disableRules(['color-contrast'])
      .analyze();
    const serious = axe.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    if (serious.length) {
      failures.push(...serious.slice(0, 8).map(v => `${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`));
    }

    const names = await page.evaluate(() => {
      const root = document.getElementById('prodRoot');
      const out = [];
      if (!root) return ['#prodRoot missing'];
      const selectors = [
        'button:not([disabled])',
        'a[href]',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        '[role="button"]:not([aria-disabled="true"])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');
      const visible = el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
      };
      const nameOf = el => [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-prod-tip'),
        el.getAttribute('placeholder'),
        el.value,
        el.innerText,
        el.textContent,
      ].map(v => String(v || '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
      [...root.querySelectorAll(selectors)].forEach(el => {
        if (!visible(el)) return;
        const name = nameOf(el);
        if (!name) {
          const key = [
            el.tagName.toLowerCase(),
            el.id ? '#' + el.id : '',
            el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : '',
          ].join('');
          out.push('Focusable control has no visible/aria/title name: ' + key);
        }
        if (el.tagName === 'BUTTON' && !el.getAttribute('type')) {
          out.push('Button is missing explicit type: ' + (name || el.outerHTML.slice(0, 80)));
        }
      });
      return out;
    });
    failures.push(...names.slice(0, 12));

    const searchButton = page.locator('.prod-search-btn').first();
    await page.evaluate(() => document.querySelector('.prod-search-btn')?.focus());
    await page.keyboard.press('Enter');
    if (!(await page.locator('.prod-cmd .prod-cmd-input').count())) {
      await page.evaluate(() => document.querySelector('.prod-search-btn')?.focus());
      await page.keyboard.press('Space');
    }
    if (await page.locator('.prod-cmd .prod-cmd-input').count()) {
      const paletteFocus = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('prod-cmd-input'));
      if (!paletteFocus) failures.push('Command palette did not move focus to its search input');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.prod-cmd-bd', { state: 'detached', timeout: 5000 }).catch(() => {});
      if (await page.locator('.prod-cmd-bd').count()) failures.push('Escape did not close the command palette');
    } else {
      failures.push('Focused search button did not open the command palette with Enter or Space');
    }

    await page.evaluate(() => {
      window._prodClearLayer && window._prodClearLayer();
      document.querySelectorAll('.prod-cmd-bd').forEach(el => el.remove());
      _prodState.paletteOpen = false;
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.openId = '';
      _prodState.openProjectId = '';
      _prodState.filters = [];
      _prodRender();
    });
    await page.waitForSelector('#prodFilterBtn', { timeout: 5000 });

    const filterButton = page.locator('#prodFilterBtn').first();
    await page.evaluate(() => document.querySelector('#prodFilterBtn')?.focus());
    await page.keyboard.press('Enter');
    if (!(await page.locator('#prodLayer .prod-pop').count())) {
      await page.evaluate(() => document.querySelector('#prodFilterBtn')?.focus());
      await page.keyboard.press('Space');
    }
    if (await page.locator('#prodLayer .prod-pop').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      if (await page.locator('#prodLayer .prod-pop').count()) failures.push('Escape did not close the filter/display layer');
    } else {
      failures.push('Focused Filter button did not open the filter layer with Enter or Space');
    }

    await page.evaluate(() => {
      window._prodClearLayer && window._prodClearLayer();
      _prodState.view = 'list';
      _prodState.team = 'video';
      _prodState.openId = '';
      _prodState.openProjectId = '';
      _prodState.selected.clear();
      _prodState.focusRow = '';
      _prodState.hoverRow = '';
      _prodRender();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    await page.waitForSelector('.prod-row', { timeout: 5000 });
    await page.keyboard.press('ArrowDown');
    const focusState = await page.evaluate(() => ({
      row: !!document.querySelector('.prod-row.kfocus'),
      selected: _prodState.selected.size,
      view: _prodState.view,
    }));
    if (!focusState.row || focusState.view !== 'list' || focusState.selected !== 0) {
      failures.push('Keyboard ArrowDown did not create a single list focus without selecting or navigating');
    }
    await page.keyboard.press('Enter');
    if (!(await page.locator('.prod-detail').count())) failures.push('Keyboard Enter did not open the focused issue detail');

    const writes = requests.filter(isWriteLikeRequest);
    if (writes.length) failures.push('Write-like requests during a11y/focus pass: ' + writes.slice(0, 5).map(r => `${r.method()} ${r.url()}`).join(' | '));
    if (errors.length) failures.push('Console/page errors during a11y/focus pass: ' + errors.slice(0, 5).join(' | '));
    if (failures.length) throw new Error(formatFailures('prod-a11y-focus failures', failures));
    console.log(`prod-a11y-focus: ${axe.violations.length} axe findings (${serious.length} serious/critical after scoped rules), control names, focus, Escape, keyboard navigation passed`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
