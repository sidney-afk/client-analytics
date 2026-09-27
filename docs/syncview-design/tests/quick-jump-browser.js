'use strict';

// Quick jump (owner decision 2026-09-27): press / anywhere, type part of a
// client and a tab ("alpha cal"), press Enter, land there with that client as
// the shared client. "/" inside a text field types a slash, Escape closes,
// SyncLinear keeps its own "/" and a ?c= client link has no quick jump at all.
//
// Fully offline; the clients are fixture names added to the roster in the page.

const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const FIRST = 'Anchor Fixture Alpha';
const SECOND = 'Anchor Fixture Bravo';

function blank(context) {
  return context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
  });
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  const jump = async (page, text) => {
    await page.keyboard.press('/');
    await page.waitForSelector('#svJump:not([hidden])', { timeout: 3000 }).catch(() => {});
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  };
  try {
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await blank(context);
      await seedStaffGate(context);
      await context.addInitScript(() => { try { localStorage.removeItem('syncview_nav'); } catch (e) {} });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      await page.goto(`http://127.0.0.1:${port}/workload`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.navTo === 'function' && document.getElementById('svJump'));
      await page.waitForTimeout(1500);
      await page.evaluate(names => names.forEach(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); }), [FIRST, SECOND]);
      await page.click('body', { position: { x: 5, y: 600 } });

      // From a team tab: client + tab.
      await jump(page, 'bravo cal');
      expect(await page.evaluate(() => currentNav) === 'calendar', 'bravo cal: did not open the Calendar');
      expect(await page.evaluate(() => calState.client) === SECOND, 'bravo cal: Calendar is not on the named client');

      // Tab word first works too, and tab abbreviations.
      await page.click('body', { position: { x: 5, y: 600 } });
      await jump(page, 'samp alpha');
      expect(await page.evaluate(() => currentNav) === 'sample-reviews', 'samp alpha: did not open Samples');
      expect(await page.evaluate(() => sxrState.client) === FIRST, 'samp alpha: Samples is not on the named client');

      // A client alone stays on the tab you are on.
      await page.click('body', { position: { x: 5, y: 600 } });
      await jump(page, 'bravo');
      expect(await page.evaluate(() => currentNav) === 'sample-reviews' && await page.evaluate(() => sxrState.client) === SECOND, 'bravo: a client alone should switch the current tab');

      // A tab alone just opens it.
      await page.click('body', { position: { x: 5, y: 600 } });
      await jump(page, 'workload');
      expect(await page.evaluate(() => currentNav) === 'workload', 'workload: a tab alone did not open it');

      // Tab stays inside the dialog.
      await page.click('body', { position: { x: 5, y: 600 } });
      await page.keyboard.press('/');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'svJumpInput', 'Tab left the quick jump dialog');
      await page.keyboard.press('Escape');

      // A jump drops a stale card link for another client from the address.
      await page.evaluate(() => history.replaceState(history.state, '', location.pathname + '#sample-reviews/stale-fixture/card-1'));
      await page.click('body', { position: { x: 5, y: 600 } });
      await jump(page, 'alpha samp');
      expect(!(await page.evaluate(() => location.hash)).includes('stale-fixture'), 'a jump kept the old client card link in the address');

      // Escape closes without moving.
      await page.click('body', { position: { x: 5, y: 600 } });
      await page.keyboard.press('/');
      await page.keyboard.type('alpha');
      await page.keyboard.press('Escape');
      expect(await page.isHidden('#svJump'), 'Escape did not close quick jump');
      expect(await page.evaluate(() => currentNav) === 'sample-reviews', 'Escape moved the page');

      // "/" typed into a field stays a slash.
      await page.evaluate(() => navTo('filming-plans'));
      await page.waitForTimeout(300);
      await page.click('#svClientBadge');
      await page.focus('#svClientSearch');
      await page.keyboard.press('/');
      expect(await page.isHidden('#svJump'), '"/" in a text field opened quick jump');
      expect((await page.inputValue('#svClientSearch')).includes('/'), '"/" in a text field was swallowed');

      if (errors.length) failures.push('page errors: ' + errors.slice(0, 3).join(' | '));
      await context.close();
    }
    // Touch screens have no "/" key: a small button next to the client opens it.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
      await blank(context);
      await seedStaffGate(context);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.navTo === 'function' && document.getElementById('svJump'));
      await page.waitForTimeout(1500);
      expect(await page.isVisible('.sv-jump-touch'), 'touch: the quick jump button is not showing');
      await page.tap('.sv-jump-touch');
      await page.waitForTimeout(200);
      expect(await page.isVisible('#svJump'), 'touch: tapping the button did not open quick jump');
      await context.close();
    }
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await blank(context);
      await seedStaffGate(context);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      expect(!(await page.isVisible('.sv-jump-touch')), 'desktop: the touch-only quick jump button should stay hidden');
      await context.close();
    }
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
      await blank(context);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/?c=anchor-fixture-token`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await page.keyboard.press('/');
      await page.waitForTimeout(200);
      expect(await page.isHidden('#svJump'), 'client link: "/" opened quick jump');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('quick-jump failures', failures));
    process.exit(1);
  }
  console.log('quick-jump: PASS');
})().catch(err => { console.error(err); process.exit(1); });
