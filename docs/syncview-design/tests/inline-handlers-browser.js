'use strict';
/* inline-handlers-browser.js -- every button's code exists, on every screen.
 *
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 1 (safety nets).
 *
 * Buttons in SyncView name their code in text: onclick="_calOpen('p1')". The
 * browser looks that name up on `window` only when the button is clicked. If
 * the code lives in a file that has not loaded yet (on-demand loading), or is
 * private to an ES module and was never put on `window`, the click does
 * nothing and no error appears anywhere. Every check before this one passes.
 *
 * This opens each screen for real, fully offline, reads every on* attribute
 * in the rendered page, and fails for any function it names that is not on
 * `window` at that moment. Screens:
 *   - every staff tab (admin, Kasper unlocked), after it has drawn;
 *   - the signed-out entry links (intake, both onboarding forms);
 *   - the client link on Calendar and on Sample reviews, with a review card
 *     opened so its Approve / Request change buttons are on screen.
 * Every request outside the local server is answered locally and empty; no
 * backend, key or client data is needed.
 */
const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const SETTLE_MS = Number(process.env.INLINE_HANDLERS_SETTLE_MS || 1500);
const { CORS, clientLinkRoute, clientLinkUrl, clientLinkCard } = require('./client-link-fixture');

// Reads the rendered page: every function an on* attribute calls, and which
// of them are not on window right now.
const collect = () => {
  const KW = new Set(['if', 'for', 'while', 'switch', 'return', 'function', 'typeof', 'new', 'catch', 'void', 'delete', 'in', 'of', 'await']);
  const names = new Set();
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (!/^on[a-z]+$/.test(a.name)) continue;
      for (const m of a.value.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!KW.has(m[2])) names.add(m[2]);
    }
  }
  // Resolvable the way the click resolves it (the page's global scope); and,
  // separately, whether it is on window, which real ES modules will need.
  const resolves = n => { try { return (0, eval)('typeof ' + n) === 'function'; } catch (e) { return false; } };
  return {
    checked: names.size,
    missing: [...names].filter(n => !resolves(n)).sort(),
    notOnWindow: [...names].filter(n => resolves(n) && typeof window[n] !== 'function').sort(),
  };
};

async function openContext(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route);
  return context;
}
const emptyAnswer = r => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS, body: '' });
  // Time Off only exists when its flag is on; turn it on so its view renders.
  if (/\/rest\/v1\/syncview_runtime_flags/.test(r.request().url()) && /pto_v1/.test(r.request().url())) {
    return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ key: 'pto_v1', value: { mode: 'on' } }]) }).catch(() => {});
  }
  return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }).catch(() => {});
};

const notOnWindow = new Set();
async function check(page, label, failures, totals) {
  const r = await page.evaluate(collect);
  totals.push(`${label} ${r.checked}`);
  for (const n of r.notOnWindow) notOnWindow.add(n);
  if (!r.checked) failures.push(`${label}: no inline handlers found on screen; the screen probably did not draw`);
  if (r.missing.length) failures.push(`${label}: ${r.missing.length} button function(s) do not exist: ${r.missing.slice(0, 12).join(', ')}`);
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const totals = [];
  try {
    // Staff tabs.
    {
      const context = await openContext(browser, emptyAnswer);
      await seedStaffGate(context);
      await context.addInitScript(() => {
        try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); localStorage.removeItem('syncview_nav'); } catch (e) {}
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.navTo === 'function' && document.getElementById('navLinear'));
      await page.waitForTimeout(SETTLE_MS);
      const tabs = await page.evaluate(() => [...document.querySelectorAll('#headerNav > .header-nav-btn')]
        .filter(a => a.getClientRects().length && getComputedStyle(a).display !== 'none').map(a => a.id));
      if (tabs.length < 5) failures.push(`expected the staff tab row, found ${tabs.length} visible tabs`);
      for (const id of tabs) {
        await page.click('#' + id);
        await page.waitForTimeout(SETTLE_MS);
        await check(page, `staff ${id}`, failures, totals);
      }
      // Kasper's subtabs (Review, Editors, Time Off, Hiring, Onboarding,
      // Credentials, Clients, ...), including the ones behind "More": each is
      // opened through the same function its button calls, and must mount
      // before its buttons are read.
      await page.click('#navKasper');
      await page.waitForTimeout(SETTLE_MS);
      const subtabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.kasper-subtab[data-kasper-tab]')]
        .map(b => b.getAttribute('data-kasper-tab')))]);
      if (subtabs.length < 3) failures.push(`expected Kasper's subtabs, found ${subtabs.length}`);
      for (const key of subtabs) {
        await page.evaluate(k => _kasperGotoTab(k), key);
        await page.waitForTimeout(SETTLE_MS);
        const now = await page.evaluate(() => _kasperState.tab);
        if (now !== key) { failures.push(`Kasper ${key}: subtab did not mount (on ${now})`); continue; }
        await check(page, `staff Kasper ${key}`, failures, totals);
      }
      // Standalone staff views that have an address but no top-level tab.
      for (const route of ['time-off', 'smm-weekly-reports', 'client-credentials']) {
        await page.evaluate(r => { location.hash = '#' + r; }, route);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof window.navTo === 'function');
        await page.waitForTimeout(SETTLE_MS);
        const at = await page.evaluate(() => currentNav);
        if (at !== route) { failures.push(`${route}: view did not mount (currentNav ${at})`); continue; }
        await check(page, `staff ${route}`, failures, totals);
      }
      if (errors.length) failures.push(`staff tabs: page errors: ${errors.slice(0, 2).join(' | ')}`);
      await context.close();
    }

    // Signed-out entry links.
    for (const [label, url] of [['intake link', '/?intake=1'], ['onboarding form', '/?onboarding=1'], ['onboarding AI form', '/?onboarding=ai']]) {
      const context = await openContext(browser, emptyAnswer);
      const page = await context.newPage();
      await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(SETTLE_MS * 2);
      await check(page, label, failures, totals);
      await context.close();
    }

    // Client link, with a review card open.
    for (const [label, surface] of [['client calendar', 'calendar'], ['client sample reviews', 'samples']]) {
      const context = await openContext(browser, clientLinkRoute(surface));
      const page = await context.newPage();
      await page.goto(clientLinkUrl(origin, surface), { waitUntil: 'domcontentloaded' });
      const sel = clientLinkCard(surface);
      const drew = await page.waitForSelector(sel, { timeout: 20000 }).then(() => true, () => false);
      if (!drew) { failures.push(`${label}: review card never drew`); await context.close(); continue; }
      await page.click(`${sel} .kcard-expand-btn`);
      await page.waitForSelector(`${sel} .cal-review-approve-btn`, { timeout: 5000 }).catch(() => failures.push(`${label}: Approve button never appeared`));
      await check(page, label, failures, totals);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`inline-handlers: functions checked per screen: ${totals.join('; ')}`);
  // Informational until the runtime switch to real modules, where each of
  // these must be put on window or its button stops working.
  if (notOnWindow.size) console.log(`inline-handlers: reachable today but not on window (${notOnWindow.size}): ${[...notOnWindow].sort().join(', ')}`);
  if (failures.length) {
    console.error(formatFailures('inline-handlers failures', failures));
    process.exit(1);
  }
  console.log('inline-handlers: PASS');
})().catch(err => { console.error(err); process.exit(1); });
