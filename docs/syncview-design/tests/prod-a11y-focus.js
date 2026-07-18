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
  const pageErrors = [];
  const consoleErrors = [];
  const readOutcomes = new Map();
  const requests = [];
  const recordReadOutcome = (request, outcome) => {
    if (!request || !['GET', 'HEAD'].includes(request.method())) return;
    const key = `${request.method()} ${request.url()}`;
    const outcomes = readOutcomes.get(key) || [];
    outcomes.push(outcome);
    readOutcomes.set(key, outcomes);
  };
  const describeRead = ([key, outcomes]) => {
    const rawUrl = key.replace(/^[A-Z]+ /, '');
    try {
      const url = new URL(rawUrl);
      return {
        host: url.hostname,
        path: /supabase\.co$/i.test(url.hostname) ? url.pathname : '',
        queryKeys: [...url.searchParams.keys()],
        outcomes,
      };
    } catch (_) {
      return { host: 'unparseable', path: '', queryKeys: [], outcomes };
    }
  };
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', response => {
    recordReadOutcome(response.request(), response.status());
  });
  page.on('requestfailed', request => recordReadOutcome(request, 'network-error'));
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
      _prodState.collapsed.clear();
      _prodState.focusRow = '';
      _prodState.hoverRow = '';
      _prodRender();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    await page.waitForSelector('.prod-row', { timeout: 5000 });

    const containment = await page.locator('.prod-row').first().evaluate(row => {
      const style = getComputedStyle(row);
      const rect = row.getBoundingClientRect();
      return {
        contentVisibility: style.contentVisibility,
        contain: style.contain,
        intrinsicWidth: style.containIntrinsicWidth,
        intrinsicHeight: style.containIntrinsicHeight,
        height: rect.height,
      };
    });
    if (containment.contentVisibility !== 'auto'
      || containment.contain !== 'content'
      || !/^(?:auto )?0px$/.test(containment.intrinsicWidth)
      || !/^(?:auto )?44px$/.test(containment.intrinsicHeight)
      || Math.abs(containment.height - 44) > 0.01) {
      failures.push('Production row containment contract drifted: ' + JSON.stringify(containment));
    }

    const offscreenTarget = await page.evaluate(() => {
      const order = _prodFlatOrder();
      if (order.length < 3) return '';
      _prodState.focusRow = order[order.length - 2];
      _prodRender();
      const list = document.querySelector('.prod-listwrap');
      if (list) list.scrollTop = 0;
      window.scrollTo(0, 0);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const id = order[order.length - 1];
      const row = document.querySelector('[data-prod-row="' + CSS.escape(id) + '"]');
      const child = row && row.querySelector('.prod-id');
      const rect = row && row.getBoundingClientRect();
      return {
        id,
        startedOutsideViewport: !!rect && (rect.top >= window.innerHeight || rect.bottom <= 0),
        startedSkipped: !!(child && child.checkVisibility
          && !child.checkVisibility({ contentVisibilityAuto: true })),
      };
    });
    if (!offscreenTarget || !offscreenTarget.id
      || !offscreenTarget.startedOutsideViewport || !offscreenTarget.startedSkipped) {
      failures.push('Production list did not expose a skipped off-screen row for keyboard focus coverage: '
        + JSON.stringify(offscreenTarget));
    } else {
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(id => {
        const row = document.querySelector('[data-prod-row="' + CSS.escape(id) + '"]');
        return _prodState.focusRow === id && row && row.classList.contains('kfocus');
      }, offscreenTarget.id, { timeout: 5000 });
      await page.waitForTimeout(80);
      const offscreenFocus = await page.evaluate(id => {
        const row = document.querySelector('[data-prod-row="' + CSS.escape(id) + '"]');
        const list = document.querySelector('.prod-listwrap');
        if (!row || !list) return null;
        const rr = row.getBoundingClientRect();
        const lr = list.getBoundingClientRect();
        const child = row.querySelector('.prod-id');
        return {
          scrolled: list.scrollTop > 0 || window.scrollY > 0,
          visible: rr.top >= Math.max(0, lr.top) - 1 && rr.bottom <= Math.min(window.innerHeight, lr.bottom) + 1,
          focused: row.classList.contains('kfocus'),
          insetShadow: /inset/i.test(getComputedStyle(row).boxShadow),
          descendantVisible: !!(child && child.checkVisibility
            && child.checkVisibility({ contentVisibilityAuto: true })),
        };
      }, offscreenTarget.id);
      if (!offscreenFocus || !offscreenFocus.scrolled || !offscreenFocus.visible
        || !offscreenFocus.focused || !offscreenFocus.insetShadow || !offscreenFocus.descendantVisible) {
        failures.push('Off-screen data-prod-row focus/scroll or inset shadow regressed: ' + JSON.stringify(offscreenFocus));
      }
    }

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

    await page.evaluate(() => {
      _prodState.view = 'list';
      _prodState.openId = '';
      _prodState.openBatchId = '';
      _prodState.openProjectId = '';
      _prodState.focusRow = '';
      _prodState.hoverRow = '';
      _prodRender();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    const paletteTarget = await page.evaluate(() => {
      const order = _prodFlatOrder();
      const id = order[order.length - 1] || '';
      const issue = id && _prodIssue(id);
      return issue ? { id, label: _prodIssueLabel(issue) } : null;
    });
    if (!paletteTarget) {
      failures.push('Production list did not expose an issue for command-palette jump coverage');
    } else {
      await page.evaluate(() => _prodOpenPalette());
      await page.fill('.prod-cmd-input', paletteTarget.label);
      await page.waitForSelector('.prod-cmd-item', { timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.waitForSelector('.prod-detail', { timeout: 5000 });
      const paletteJumped = await page.evaluate(id => _prodState.openId === id, paletteTarget.id);
      if (!paletteJumped) failures.push('Command palette did not jump to the searched issue');
    }

    const writes = requests.filter(isWriteLikeRequest);
    if (writes.length) failures.push('Write-like requests during a11y/focus pass: ' + writes.slice(0, 5).map(r => `${r.method()} ${r.url()}`).join(' | '));
    const hasFailedRead = outcomes => outcomes.some(outcome => outcome === 'network-error' || outcome >= 400);
    if ([...readOutcomes.values()].some(hasFailedRead)) {
      await page.waitForTimeout(1500);
    }
    const readEntries = [...readOutcomes.entries()];
    const persistentReadFailures = readEntries.filter(([, outcomes]) => {
      if (!hasFailedRead(outcomes)) return false;
      const final = outcomes[outcomes.length - 1];
      return final === 'network-error' || final >= 400;
    });
    const persistentReadKeys = new Set(persistentReadFailures.map(([key]) => key));
    const recoveredReadAttempts = readEntries
      .filter(([key, outcomes]) => hasFailedRead(outcomes) && !persistentReadKeys.has(key))
      .reduce((count, [, outcomes]) => count + outcomes.filter(outcome => outcome === 'network-error' || outcome >= 400).length, 0);
    const resourceErrors = consoleErrors.filter(message => /^Failed to load resource:/i.test(message));
    const otherConsoleErrors = consoleErrors.filter(message => !/^Failed to load resource:/i.test(message));
    const unexplainedResourceErrors = resourceErrors.slice(recoveredReadAttempts);
    if (pageErrors.length || otherConsoleErrors.length || unexplainedResourceErrors.length || persistentReadFailures.length) {
      failures.push('Console/page errors during a11y/focus pass: '
        + [...pageErrors, ...otherConsoleErrors, ...unexplainedResourceErrors].slice(0, 5).join(' | ')
        + (persistentReadFailures.length
          ? ' | persistent read failures: ' + JSON.stringify(persistentReadFailures.slice(0, 8).map(describeRead))
          : ''));
    }
    if (failures.length) throw new Error(formatFailures('prod-a11y-focus failures', failures));
    console.log(`prod-a11y-focus: ${axe.violations.length} axe findings (${serious.length} serious/critical after scoped rules), control names, containment, focus/scroll, palette jump, Escape, keyboard navigation, ${recoveredReadAttempts} recovered read retries passed`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
