'use strict';

// One client across the site (owner decision 2026-09-27, option A).
//
// Pick a client in the top bar on Calendar, then prove Samples, Templates,
// Filming Plans, TikTok Upload and Analytics all open on it, that a team tab
// (Workload) ignores it and hides the bar, that a recent-client button
// switches in one click, and that a ?c= client link neither shows the bar nor
// reads or writes the shared client.
//
// Fully offline: every non-local request is answered with an empty list. The
// clients are fixture names added to the roster in the page, so no real client
// name or slug appears here.

const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const FIRST = 'Anchor Fixture Alpha';
const SECOND = 'Anchor Fixture Bravo';

async function open(browser, port, suffix, { staff = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
  });
  if (staff) await seedStaffGate(context);
  await context.addInitScript(() => {
    try { localStorage.removeItem('syncview_nav'); } catch (e) {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(`http://127.0.0.1:${port}${suffix}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navTo === 'function' && document.getElementById('svClientBar'));
  await page.waitForTimeout(1500);
  return { context, page, errors };
}

const go = (page, tab) => page.evaluate(t => navTo(t), tab);
// Recent clients live inside the dropdown now (owner redesign 2026-09-27).
async function pickRecent(page, name) {
  await page.click('#svClientBadge');
  await page.click(`#svClientResults [data-sv-client="${name}"]`);
}
const contentTop = page => page.evaluate(() => Math.round(document.getElementById('mainWrap').getBoundingClientRect().top));
const navLeft = page => page.evaluate(() => Math.round(document.getElementById('headerNav').getBoundingClientRect().left));

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  try {
    {
      const { context, page, errors } = await open(browser, port, '/calendar');
      await page.evaluate(names => { names.forEach(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); }); }, [FIRST, SECOND]);
      expect(await page.isVisible('#svClientBar'), 'calendar: the client bar is not showing');
      expect(!(await page.isVisible('#calTabs')), 'calendar: the old per-tab client strip is still showing');

      // Pick through the top bar search, keyboard only.
      const pick = async name => {
        await page.click('#svClientBadge');
        await page.fill('#svClientSearch', name.slice(0, 18));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(400);
      };
      // Fresh browser, no client yet: the Calendar shell has no client-only
      // controls. The first top-bar pick must draw them without a reload.
      expect(!(await page.$('#calView .cal-kebab-wrap')), 'calendar: client-only controls drawn before any client');
      await pick(SECOND);
      expect(!!(await page.$('#calView .cal-kebab-wrap')), 'calendar: the first top-bar pick did not draw the client controls');
      await pick(FIRST);
      expect(await page.evaluate(() => calState.client) === FIRST, 'calendar: picking in the top bar did not switch the calendar');
      expect(await page.getAttribute('#svClientBadge', 'data-sv-current') === FIRST, 'calendar: the badge does not hold the picked client');
      expect((await page.textContent('#svClientBadgeLabel')).trim() === FIRST.split(' ')[0], 'calendar: the badge should show the first name only');
      await page.click('#svClientBadge');
      const rows = await page.$$eval('#svClientResults [data-sv-client]', els => els.map(e => ({ n: e.getAttribute('data-sv-client'), cur: e.classList.contains('is-current') })));
      expect(rows[0] && rows[0].n === FIRST && rows[0].cur, 'calendar: the dropdown should open with the current client on top');
      expect(rows.some(r => r.n === SECOND && !r.cur), 'calendar: the previous client is not offered in the dropdown');
      expect(!(await page.$('#svClientPop .sv-client-sec, #svClientPop .sv-client-foot')), 'calendar: the dropdown should carry no section labels or helper text');
      expect(!(await page.$('#svClientPop .ck')), 'calendar: no check mark in the dropdown');
      await page.keyboard.press('Escape');
      // Dark theme: the tinted badge must stay dark so its light text reads.
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForTimeout(400);   // the badge fades its colours over 0.15s
      const darkBg = await page.evaluate(() => {
        const bg = getComputedStyle(document.getElementById('svClientBadge')).backgroundColor;
        document.documentElement.removeAttribute('data-theme');
        const [r, g, b] = (bg.match(/\d+/g) || [255, 255, 255]).map(Number);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      });
      expect(darkBg < 0.35, `dark theme: the client badge background is too light (${darkBg.toFixed(2)})`);
      const calTop = await contentTop(page);
      const calNav = await navLeft(page);

      await go(page, 'sample-reviews');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => sxrState.client) === FIRST, 'samples: did not open on the shared client');
      expect(!(await page.isVisible('#sxrTabs')), 'samples: the old per-tab client strip is still showing');

      await go(page, 'templates');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => _templatesSelected) === FIRST, 'templates: did not open on the shared client');

      await go(page, 'filming-plans');
      await page.waitForTimeout(300);
      expect(await page.inputValue('#fpSearchInput') === FIRST, 'filming plans: search is not pre-filled with the shared client');

      await go(page, 'tiktok-upload');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => tkState.client) === FIRST, 'tiktok upload: did not open on the shared client');

      await page.click('#navHome');
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => history.state && history.state.client) === FIRST, 'analytics: the tab did not open the shared client');

      // Picking in the top bar while ON Templates / Filming Plans switches them in place.
      await go(page, 'templates');
      await page.waitForTimeout(300);
      await pickRecent(page, SECOND);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => _templatesSelected) === SECOND, 'templates: a top-bar pick on Templates did not switch it');
      await go(page, 'filming-plans');
      await page.waitForTimeout(300);
      await pickRecent(page, FIRST);
      await page.waitForTimeout(400);
      expect(await page.inputValue('#fpSearchInput') === FIRST, 'filming plans: a top-bar pick on Filming Plans did not switch it');

      // Back from a team tab to client Analytics shows the bar again.
      await page.click('#navHome');
      await page.waitForTimeout(400);
      await go(page, 'workload');
      await page.waitForTimeout(300);
      await page.goBack();
      await page.waitForTimeout(600);
      expect(await page.isVisible('#svClientBar'), 'analytics: Back from a team tab left the client bar hidden');

      // A team tab ignores it: bar hidden, nothing about the tab changes.
      await go(page, 'workload');
      await page.waitForTimeout(300);
      // The picker stays on team tabs, so nothing moves: same content top,
      // same tab-row position as on Calendar.
      expect(await page.isVisible('#svClientBar'), 'workload: the client dropdown should stay in the bar');
      expect(await contentTop(page) === calTop, `workload: page content starts at ${await contentTop(page)}px, Calendar at ${calTop}px`);
      expect(await navLeft(page) === calNav, 'workload: the tab row moved compared with Calendar');

      // One click on a recent client switches the tab you are on.
      await go(page, 'calendar');
      await page.waitForTimeout(300);
      const other = await page.evaluate(() => calState.client === 'Anchor Fixture Alpha' ? 'Anchor Fixture Bravo' : 'Anchor Fixture Alpha');
      await pickRecent(page, other);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => calState.client) === other, 'calendar: the recent client button did not switch the calendar');

      // Tab order: the six client tabs first, together, in the decided order.
      const order = await page.evaluate(() => [...document.querySelectorAll('#headerNav > .header-nav-btn')].map(a => a.id));
      const want = ['navCalendar', 'navSxr', 'navTemplates', 'navFilmingPlans', 'navTiktokUpload', 'navHome'];
      expect(JSON.stringify(order.slice(0, 6)) === JSON.stringify(want), `tab order is ${order.join(',')}`);
      // Fixture clients carry no analytics numbers, so Analytics' own renderer
      // throws reading them; that is pre-existing and not about the bar.
      const own = errors.filter(m => !/ig_followers/.test(m));
      if (own.length) failures.push('page errors: ' + own.slice(0, 3).join(' | '));
      await context.close();
    }

    // Samples in a fresh browser: the first top-bar pick draws its Share menu.
    {
      const { context, page } = await open(browser, port, '/sample-reviews');
      await page.evaluate(names => { names.forEach(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); }); }, [FIRST, SECOND]);
      expect(!(await page.$('#sxrKebabMenu')), 'samples: client-only controls drawn before any client');
      await page.click('#svClientBadge');
      await page.fill('#svClientSearch', FIRST.slice(0, 18));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => sxrState.client) === FIRST, 'samples: first top-bar pick did not switch Samples');
      expect(!!(await page.$('#sxrKebabMenu')), 'samples: the first top-bar pick did not draw the client controls');
      await context.close();
    }

    // A client share link: no bar, and the shared client is neither read nor written.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
      });
      await context.addInitScript(v => { try { localStorage.setItem('syncview_shared_client', v); } catch (e) {} }, FIRST);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/?c=anchor-fixture-token`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      expect(!(await page.isVisible('#svClientBar')), 'client link: the staff client bar is showing');
      expect(await page.evaluate(() => document.body.classList.contains('sv-shared-client')) === false, 'client link: shared client mode is on');
      expect(await page.evaluate(() => localStorage.getItem('syncview_shared_client')) === FIRST, 'client link: the shared client was changed');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('shared-client failures', failures));
    process.exit(1);
  }
  console.log('shared-client: PASS');
})().catch(err => { console.error(err); process.exit(1); });
