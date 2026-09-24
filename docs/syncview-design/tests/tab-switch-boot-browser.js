'use strict';

// Phase D: the last tab you clicked always wins.
//
// Owner's bug: open SyncView, click a tab (e.g. SyncLinear) while the first
// tab is still loading, and when the first tab finishes it pulls you back.
//
// Fully offline. Every non-local request is HELD (never answered) until the
// test releases it, so the landing tab is genuinely still loading when the
// second tab is clicked. For every visible tab this suite:
//   1. opens the app on Analytics (the landing that waits on data),
//   2. clicks the tab while boot is still waiting,
//   3. checks the switch was immediate (active pill + address bar at once),
//   4. releases the network and lets boot finish,
//   5. proves you are still on the tab you clicked: same active pill, same
//      address bar, focus not moved back to the landing tab.
// Then it proves the reverse (land on a fast tab, click Analytics mid-boot)
// and that refresh and Back return you to the tab you were on.

const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const SETTLE_MS = Number(process.env.TAB_SWITCH_SETTLE_MS || 2500);

async function openHeld(browser, port, suffix) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const held = [];
  let released = false;
  const answer = route => {
    // An empty answer lets every loader finish (and fail soft) the way a
    // slow network eventually does; the point is WHEN it finishes.
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
  };
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
    if (released) answer(route); else held.push(route);
  });
  await seedStaffGate(context);
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
      sessionStorage.setItem('syncview_ttpilot_unlocked', 'ok');
      localStorage.removeItem('syncview_nav');
    } catch (e) {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(`http://127.0.0.1:${port}${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navTo === 'function' && document.getElementById('navLinear'));
  const release = () => { released = true; held.splice(0).forEach(answer); };
  return { context, page, release, errors };
}

const snapshot = page => page.evaluate(() => {
  const active = [...document.querySelectorAll('#headerNav > .header-nav-btn.active')].map(a => a.id);
  return {
    active,
    hash: location.hash,
    search: location.search,
    currentNav: typeof currentNav === 'string' ? currentNav : null,
    focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '',
  };
});

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    // Which tabs exist for this (admin, Kasper + Pilot unlocked) session.
    const probe = await openHeld(browser, port, '/');
    await probe.page.waitForTimeout(400);
    const tabs = await probe.page.evaluate(() => [...document.querySelectorAll('#headerNav > .header-nav-btn')]
      .filter(a => a.id !== 'navHome' && a.getClientRects().length && getComputedStyle(a).display !== 'none')
      .map(a => ({ id: a.id, href: a.getAttribute('href') })));
    await probe.context.close();
    if (tabs.length < 5) failures.push(`expected the staff tab row, found only ${tabs.length} visible tabs`);

    // Baseline: nobody clicks, so boot still lands you on Analytics.
    {
      const { context, page, release } = await openHeld(browser, port, '/');
      try {
        await page.waitForTimeout(150);
        release();
        await page.waitForFunction(() => currentNav === 'home' && !document.documentElement.hasAttribute('data-boot-nav'), null, { timeout: 15000 })
          .catch(() => failures.push('baseline: untouched boot never finished routing to Analytics'));
      } finally {
        await context.close();
      }
    }

    for (const tab of tabs) {
      const { context, page, release, errors } = await openHeld(browser, port, '/');
      try {
        await page.waitForTimeout(150);
        const before = await snapshot(page);
        await page.click('#' + tab.id);
        const now = await snapshot(page);
        if (!now.active.includes(tab.id)) failures.push(`${tab.id}: switch not immediate (active ${now.active.join(',') || 'none'})`);
        release();
        await page.waitForTimeout(SETTLE_MS);
        const after = await snapshot(page);
        if (!after.active.includes(tab.id)) failures.push(`${tab.id}: boot pulled you back (active now ${after.active.join(',') || 'none'}; was on ${before.active.join(',')})`);
        if (after.hash !== now.hash || after.search !== now.search) failures.push(`${tab.id}: address bar changed after boot finished (${now.search}${now.hash} -> ${after.search}${after.hash})`);
        if (after.currentNav !== now.currentNav) failures.push(`${tab.id}: currentNav moved ${now.currentNav} -> ${after.currentNav}`);
        if (after.focus === 'navHome') failures.push(`${tab.id}: focus moved back to Analytics`);
        if (errors.length) failures.push(`${tab.id}: page errors: ${errors.slice(0, 2).join(' | ')}`);

        // Refresh returns you to the tab you were on.
        if (tab.id !== 'navProd') {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(SETTLE_MS);
          const re = await snapshot(page);
          if (!re.active.includes(tab.id)) failures.push(`${tab.id}: refresh landed on ${re.active.join(',') || 'none'}`);
        }
      } finally {
        await context.close();
      }
    }

    // Reverse: land on a fast tab, go to Analytics, then Back mid-boot.
    {
      const { context, page, release } = await openHeld(browser, port, '/#linear');
      try {
        await page.waitForTimeout(150);
        await page.click('#navHome');
        await page.click('#navCalendar');
        release();
        await page.waitForTimeout(SETTLE_MS);
        let s = await snapshot(page);
        if (!s.active.includes('navCalendar')) failures.push(`fast landing: pulled off Calendar to ${s.active.join(',')}`);
        await page.goBack();
        await page.waitForTimeout(600);
        s = await snapshot(page);
        if (!s.active.includes('navHome')) failures.push(`Back from Calendar landed on ${s.active.join(',')} (expected Analytics)`);
        await page.goForward();
        await page.waitForTimeout(600);
        s = await snapshot(page);
        if (!s.active.includes('navCalendar')) failures.push(`Forward landed on ${s.active.join(',')} (expected Calendar)`);
      } finally {
        await context.close();
      }
    }

    console.log(`tab-switch-boot: ${tabs.length} tabs checked (${tabs.map(t => t.id).join(', ')})`);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('tab-switch-boot failures', failures));
    process.exit(1);
  }
  console.log('tab-switch-boot: PASS');
})().catch(err => { console.error(err); process.exit(1); });
