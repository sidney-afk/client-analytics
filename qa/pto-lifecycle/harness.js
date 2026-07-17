'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../../docs/syncview-design/tests/prod-test-utils');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PRIVATE_OUTPUT = path.join(ROOT, '.codex-tmp', 'pto-lifecycle');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function slug(value) {
  return String(value || 'step')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'step';
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function settle(page) {
  await page.waitForTimeout(70);
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })).catch(() => {});
}

async function clearPriorToast(page) {
  await page.evaluate(() => {
    if (document.querySelector('.sv-toast') && typeof hideToast === 'function') hideToast();
  }).catch(() => {});
  await page.locator('.sv-toast').waitFor({ state: 'detached', timeout: 1500 }).catch(() => {});
}

async function tabToControl(page, selector, maxTabs = 120) {
  for (let count = 0; count <= maxTabs; count += 1) {
    const focused = await page.evaluate(target =>
      !!document.activeElement && document.activeElement.matches(target), selector);
    if (focused) {
      assert(await page.evaluate(() => document.activeElement.matches(':focus-visible')),
        `${selector} has a visible keyboard-focus affordance`);
      return page.locator(selector);
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard Tab navigation did not reach ${selector}`);
}

async function injectSyntheticBanner(page) {
  return page.evaluate(() => {
    let banner = document.getElementById('ptoLifecycleSyntheticBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'ptoLifecycleSyntheticBanner';
      banner.setAttribute('role', 'note');
      banner.textContent = 'SYNTHETIC PTO TEST · NO REAL DATA';
      banner.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'padding:5px 7px',
        'border:1px solid rgba(255,255,255,.38)',
        'border-radius:999px',
        'background:#5b21b6',
        'box-shadow:0 4px 18px rgba(0,0,0,.22)',
        'color:#fff',
        'font:800 9px/1.2 Inter,system-ui,sans-serif',
        'letter-spacing:.055em',
        'box-sizing:border-box',
        'max-width:calc(100vw - 16px)',
        'pointer-events:none',
        'white-space:nowrap',
      ].join(';');
      document.body.appendChild(banner);
    }
    banner.setAttribute('role', 'note');
    const baseLabel = banner.dataset.baseLabel || banner.textContent;
    banner.dataset.baseLabel = baseLabel;
    const clockCue = String(document.documentElement.dataset.ptoLifecycleClockCue || '').trim();
    banner.textContent = clockCue
      ? `${baseLabel} | SYNTHETIC CLOCK ${clockCue}`
      : baseLabel;
    const gap = 8;
    const viewport = window.visualViewport;
    const viewportLeft = viewport ? viewport.offsetLeft : 0;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportWidth = viewport ? viewport.width : innerWidth;
    const viewportHeight = viewport ? viewport.height : innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const controlBlockers = [...document.querySelectorAll(
      '.sv-toast.show, button:not([hidden]), a[href], input:not([type="hidden"]), textarea, select, [role="button"]',
    )];
    const meaningfulTextBlockers = [...document.querySelectorAll('.header *, .pto-wrap *, .pto-admin *')]
      .filter(element => [...element.childNodes].some(node =>
        node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim()
      ));
    const blockers = [...new Set([...controlBlockers, ...meaningfulTextBlockers])].filter(element => {
      if (element === banner || element.closest('#ptoLifecycleSyntheticBanner')) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none'
        && rect.width > 0 && rect.height > 0
        && rect.bottom > viewportTop && rect.right > viewportLeft
        && rect.top < viewportBottom && rect.left < viewportRight;
    });
    function intersects(a, b) {
      return a.left < b.right + 4 && a.right + 4 > b.left
        && a.top < b.bottom + 4 && a.bottom + 4 > b.top;
    }
    banner.style.removeProperty('right');
    banner.style.removeProperty('bottom');
    banner.style.top = `${viewportTop + gap}px`;
    banner.style.left = `${viewportLeft + gap}px`;
    const size = banner.getBoundingClientRect();
    const minLeft = viewportLeft + gap;
    const minTop = viewportTop + gap;
    const maxLeft = Math.max(minLeft, viewportRight - size.width - gap);
    const maxTop = Math.max(minTop, viewportBottom - size.height - gap);
    const xPositions = [...new Set([
      minLeft,
      Math.round(viewportLeft + (viewportWidth - size.width) / 2),
      maxLeft,
    ].map(value => Math.max(minLeft, Math.min(maxLeft, value))))];
    const yPositions = [...new Set([
      minTop,
      Math.round(viewportTop + (viewportHeight - size.height) / 2),
      maxTop,
      ...Array.from(
        { length: Math.max(0, Math.floor((maxTop - minTop) / Math.max(18, size.height + 6)) + 1) },
        (_, index) => Math.min(maxTop, minTop + index * Math.max(18, size.height + 6)),
      ),
    ].map(value => Math.max(minTop, Math.min(maxTop, value))))];
    const candidates = [];
    for (const top of yPositions) {
      for (const left of xPositions) candidates.push({ top, left });
    }
    let chosen = candidates[candidates.length - 1];
    for (const candidate of candidates) {
      banner.style.top = `${candidate.top}px`;
      banner.style.left = `${candidate.left}px`;
      const rect = banner.getBoundingClientRect();
      if (!blockers.some(element => intersects(rect, element.getBoundingClientRect()))) {
        chosen = candidate;
        break;
      }
    }
    banner.style.top = `${chosen.top}px`;
    banner.style.left = `${chosen.left}px`;
    const rect = banner.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0
      && rect.top >= viewportTop && rect.left >= viewportLeft
      && rect.bottom <= viewportBottom && rect.right <= viewportRight;
    const overlap = blockers.some(element => intersects(rect, element.getBoundingClientRect()));
    return { visible, overlap };
  });
}

class LifecycleHarness {
  constructor(backend, options = {}) {
    this.backend = backend;
    this.outputDir = path.resolve(options.outputDir || DEFAULT_PRIVATE_OUTPUT);
    this.publicOutput = !!options.publicOutput;
    this.headless = options.headless !== false;
    this.browser = null;
    this.server = null;
    this.port = 0;
    this.sessions = new Map();
    this.shots = [];
    this.stepNumbers = new Map();
    this.failures = [];
  }

  async start() {
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.server = await serveStatic();
    this.port = this.server.address().port;
    this.browser = await chromium.launch({ headless: this.headless });
    return this;
  }

  async createSession(personaKey, options = {}) {
    const persona = this.backend.personas[personaKey];
    assert(persona, `Unknown synthetic persona ${personaKey}`);
    const sessionKey = options.sessionKey || personaKey;
    const viewport = options.viewport || { width: 1360, height: 920 };
    const contextOptions = {
      viewport,
      colorScheme: options.colorScheme || 'light',
      hasTouch: !!options.hasTouch,
      isMobile: !!options.isMobile,
      timezoneId: 'America/Guatemala',
      reducedMotion: options.reducedMotion || 'no-preference',
    };
    if (options.isMobile) {
      contextOptions.screen = viewport;
      contextOptions.deviceScaleFactor = 1;
      contextOptions.userAgent = 'Mozilla/5.0 (Linux; Android 14; Mobile) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
    }
    const context = await this.browser.newContext(contextOptions);
    await context.addInitScript(({ identity, key }) => {
      localStorage.setItem('syncview_auth_v1', 'ok');
      localStorage.removeItem('syncview_theme');
      localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({
        key,
        role: identity.role,
        member: identity,
        verified_at: '2030-04-10T12:00:00.000Z',
      }));
      sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
      sessionStorage.setItem('syncview_staff_prompted_v1', '1');
    }, { identity: persona.member, key: persona.key });
    await context.route('**/*', route => this.backend.handleRoute(route));
    const session = {
      key: sessionKey,
      personaKey,
      persona,
      context,
      pages: [],
      pageErrors: [],
      consoleErrors: [],
      requestFailures: [],
      requestFailureAllowances: [],
    };
    this.sessions.set(sessionKey, session);
    await this.newPage(session);
    return session;
  }

  async newPage(session) {
    const page = await session.context.newPage();
    session.pages.push(page);
    page.on('pageerror', error => session.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') session.consoleErrors.push(message.text());
    });
    page.on('requestfailed', request => {
      const failure = request.failure();
      const url = request.url();
      if (!failure || !/functions\/v1\/pto/i.test(url)) return;
      let action = '';
      try {
        const parsed = new URL(url);
        action = parsed.searchParams.get('action') || '';
        if (!action) action = String(request.postDataJSON()?.action || '');
      } catch (_) {}
      const allowance = session.requestFailureAllowances.find(item =>
        item.remaining > 0 && (item.action === '*' || item.action === action)
      );
      if (allowance) allowance.remaining -= 1;
      session.requestFailures.push({
        action: action || 'unknown',
        error: failure.errorText || 'request failed',
        expected: !!allowance,
      });
    });
    return page;
  }

  expectPtoRequestFailure(session, action = '*', count = 1) {
    assert(session && this.sessions.get(session.key) === session, 'request-failure allowance uses a known session');
    assert(Number.isInteger(count) && count > 0, 'request-failure allowance count is positive');
    session.requestFailureAllowances.push({ action, remaining: count });
  }

  page(session, index = 0) {
    return session.pages[index];
  }

  async openStaffMenu(session, page = this.page(session), options = {}) {
    await page.goto(`http://127.0.0.1:${this.port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.navTo === 'function'
      && typeof window._ptoEnabled === 'function'
      && window._ptoEnabled()
      && document.getElementById('headerTimeOffMenuItem')?.hidden === false);
    if (options.keyboard) {
      await tabToControl(page, '#headerMenuButton');
      await page.keyboard.press('Enter');
    } else {
      await page.locator('#headerMenuButton').click();
    }
    const timeOffItem = page.locator('#headerTimeOffMenuItem');
    await timeOffItem.waitFor({ state: 'visible', timeout: 5000 });
    assert(await timeOffItem.getAttribute('role') === 'menuitem', 'Time Off opens from the real staff menu item');
    await settle(page);
    await injectSyntheticBanner(page);
  }

  async chooseStaffTimeOff(session, page = this.page(session), options = {}) {
    const timeOffItem = page.locator('#headerTimeOffMenuItem');
    await timeOffItem.waitFor({ state: 'visible', timeout: 5000 });
    if (options.keyboard) {
      await tabToControl(page, '#headerTimeOffMenuItem');
      await page.keyboard.press('Enter');
    } else {
      await timeOffItem.click();
    }
    await page.waitForFunction(() => typeof _ptoState !== 'undefined'
      && !!_ptoState.overview && !_ptoState.loading
      && !!document.getElementById('ptoRequestTypeBtn'), null, { timeout: 15000 });
    await settle(page);
    await injectSyntheticBanner(page);
  }

  async openStaff(session, page = this.page(session), options = {}) {
    await this.openStaffMenu(session, page, options);
    await this.chooseStaffTimeOff(session, page, options);
  }

  async openAdmin(session, page = this.page(session), options = {}) {
    // Time Off is a fast boot route in the single-file app. Start there so the
    // staff shell and Kasper state are ready without waiting on unrelated
    // analytics, then enter Kasper through its real visible navigation control.
    await page.goto(`http://127.0.0.1:${this.port}/#time-off`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.navTo === 'function'
      && typeof window._ptoEnabled === 'function'
      && window._ptoEnabled()
      && typeof _kasperState !== 'undefined'
      && document.getElementById('navKasper')?.style.display !== 'none');
    if (options.keyboard) {
      await tabToControl(page, '#navKasper');
      await page.keyboard.press('Enter');
    } else {
      await page.locator('#navKasper').click();
    }
    const timeOffTab = page.locator('.kasper-subtab[data-kasper-tab="time-off"]');
    await timeOffTab.waitFor({ state: 'visible', timeout: 10000 });
    if (options.keyboard) {
      await tabToControl(page, '.kasper-subtab[data-kasper-tab="time-off"]');
      await page.keyboard.press('Enter');
    } else {
      await timeOffTab.click();
    }
    assert(await timeOffTab.getAttribute('aria-selected') === 'true'
      || await timeOffTab.getAttribute('aria-current') === 'page'
      || await timeOffTab.evaluate(element => element.classList.contains('active')),
    'Kasper Time Off opens through the real subtab control');
    await page.waitForSelector('#ptoAdminMemberBtn', { timeout: 15000 });
    await page.waitForFunction(() => typeof _ptoAdminState !== 'undefined'
      && !!_ptoAdminState.overview && !_ptoAdminState.loading);
    await settle(page);
    await injectSyntheticBanner(page);
  }

  async step(options) {
    const {
      scenario,
      session,
      page = this.page(session),
      label,
      action,
      see,
      target,
      expected = '',
      profile = 'desktop',
    } = options;
    const count = (this.stepNumbers.get(scenario) || 0) + 1;
    this.stepNumbers.set(scenario, count);
    let actionError = null;
    try {
      await clearPriorToast(page);
      if (typeof action === 'function') await action(page);
      if (typeof see === 'function') await see(page);
    } catch (error) {
      actionError = error;
    }
    try {
      if (target) {
        const locator = typeof target === 'string' ? page.locator(target).first() : target;
        assert(await locator.count().catch(() => 0), `screenshot target exists for "${label}"`);
        assert(await locator.isVisible().catch(() => false), `screenshot target is visible for "${label}"`);
        await locator.evaluate(element => element.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: 'instant',
        }));
      }
      await settle(page);
      const banner = await injectSyntheticBanner(page);
      assert(banner && banner.visible, 'synthetic-data banner is visible in the screenshot viewport');
      assert(!banner.overlap, 'synthetic-data banner does not cover visible controls or toasts');
      const file = `${slug(scenario)}-${String(count).padStart(2, '0')}-${slug(label)}.jpg`;
      const full = path.join(this.outputDir, file);
      await page.screenshot({
        path: full,
        type: 'jpeg',
        quality: 78,
        fullPage: false,
        animations: 'disabled',
        caret: 'hide',
      });
      const viewport = page.viewportSize() || { width: 0, height: 0 };
      this.shots.push({
        scenario,
        step: count,
        label,
        action: label,
        expected,
        persona: session.key,
        profile,
        viewport,
        file,
        path: full,
        sha256: sha256(full),
        verdict: actionError ? 'broken' : 'pending_visual_review',
      });
    } catch (captureError) {
      if (!actionError) actionError = captureError;
    }
    if (actionError) {
      this.failures.push(`${scenario} step ${count} ${label}: ${actionError.message || actionError}`);
      throw actionError;
    }
  }

  assertClean() {
    const errors = [];
    for (const session of this.sessions.values()) {
      if (session.pageErrors.length) errors.push(`${session.key} page errors: ${session.pageErrors.join(' | ')}`);
      const unexpectedConsole = session.consoleErrors.filter(message =>
        !/Failed to load resource|net::ERR_FAILED|net::ERR_ABORTED/i.test(message));
      if (unexpectedConsole.length) errors.push(`${session.key} console errors: ${unexpectedConsole.join(' | ')}`);
      const unexpectedFailures = session.requestFailures.filter(failure => !failure.expected);
      if (unexpectedFailures.length) {
        errors.push(`${session.key} unexpected PTO request failures: ${unexpectedFailures
          .map(failure => `${failure.action}:${failure.error}`).join(' | ')}`);
      }
      const unmetAllowances = session.requestFailureAllowances.filter(item => item.remaining > 0);
      if (unmetAllowances.length) {
        errors.push(`${session.key} expected PTO request failures did not occur: ${unmetAllowances
          .map(item => `${item.action}x${item.remaining}`).join(' | ')}`);
      }
    }
    if (this.backend.unexpectedWrites.length) {
      errors.push(`unexpected external writes: ${this.backend.unexpectedWrites.length}`);
    }
    assert(errors.length === 0, errors.join('\n'));
  }

  async close() {
    for (const session of this.sessions.values()) {
      await session.context.close().catch(() => {});
    }
    if (this.browser) await this.browser.close().catch(() => {});
    if (this.server) await new Promise(resolve => this.server.close(resolve));
  }
}

module.exports = {
  ROOT,
  DEFAULT_PRIVATE_OUTPUT,
  LifecycleHarness,
  assert,
  clearPriorToast,
  settle,
  slug,
};
