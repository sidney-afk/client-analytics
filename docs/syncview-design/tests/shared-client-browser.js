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
// An invented long first name: the picker label grows and squeezes the tab row.
const LONG = 'Wolfgangmaximilian Fixture Charlie';

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

      // Tab order: Today (the per-person summary, a team tab) leads, then the
      // six client tabs together, in the decided order.
      const order = await page.evaluate(() => [...document.querySelectorAll('#headerNav > .header-nav-btn')].map(a => a.id));
      const want = ['navToday', 'navCalendar', 'navSxr', 'navTemplates', 'navFilmingPlans', 'navTiktokUpload', 'navHome'];
      expect(JSON.stringify(order.slice(0, 7)) === JSON.stringify(want), `tab order is ${order.join(',')}`);
      // Fixture clients carry no analytics numbers, so Analytics' own renderer
      // throws reading them; that is pre-existing and not about the bar.
      const own = errors.filter(m => !/ig_followers/.test(m));
      if (own.length) failures.push('page errors: ' + own.slice(0, 3).join(' | '));
      await context.close();
    }

    // Recent list: remove one client, then clear the rest. The current client
    // and everything else stay as they were.
    {
      const { context, page } = await open(browser, port, '/calendar');
      const THIRD = 'Anchor Fixture Charlie';
      await page.evaluate(names => { names.forEach(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); }); }, [FIRST, SECOND, THIRD]);
      for (const n of [THIRD, SECOND, FIRST]) {
        await page.click('#svClientBadge');
        await page.fill('#svClientSearch', n.slice(0, 22));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
      }
      const recentNames = () => page.$$eval('#svClientResults [data-sv-client]:not(.is-current)', els => els.map(e => e.getAttribute('data-sv-client')));
      await page.click('#svClientBadge');
      expect(!(await page.$(`#svClientResults .is-current .sv-client-forget`)), 'recent: the current client must not offer a remove button');
      expect(JSON.stringify(await recentNames()) === JSON.stringify([SECOND, THIRD]), `recent: expected two recent clients, got ${await recentNames()}`);
      await page.hover(`#svClientResults [data-sv-client="${SECOND}"]`);
      await page.click(`#svClientResults [data-sv-forget="${SECOND}"]`);
      expect(await page.isVisible('#svClientPop'), 'recent: removing a client closed the dropdown');
      expect(JSON.stringify(await recentNames()) === JSON.stringify([THIRD]), 'recent: the removed client is still listed');
      expect(await page.evaluate(() => calState.client) === FIRST && await page.getAttribute('#svClientBadge', 'data-sv-current') === FIRST, 'recent: removing a recent client changed the current client');
      await page.click('#svClientResults [data-sv-forget-all]');
      expect((await recentNames()).length === 0, 'recent: Clear recent left clients behind');
      expect(await page.$('#svClientResults .is-current') !== null, 'recent: Clear recent removed the current client');
      expect(!(await page.$('#svClientResults [data-sv-forget-all]')), 'recent: Clear recent should hide once the list is empty');
      expect(await page.evaluate(() => calState.client) === FIRST, 'recent: Clear recent changed the current client');
      await context.close();
    }

    // My clients: an SMM sees their own clients above Recent, with no remove
    // button; Recent holds at most three others; an admin sees only Recent;
    // the current client is tinted wherever it shows; search still reaches
    // a client in neither list. The SMM assignment comes from the same source
    // Today reads (098-smm-clients): the social_media_managers roster from the
    // smm-weekly-reports options call, mocked here with an invented SMM, and
    // the current clients from Clients Info (clientMap), seeded in the page.
    {
      const { context, page } = await open(browser, port, '/calendar');
      const ROSTER_MINE = ['Anchor Fixture Mine One', 'Anchor Fixture Mine Two'];
      await context.route(/\/functions\/v1\/smm-weekly-reports\?action=options/, route => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ managers: [
          { name: 'QA Staff', email: '', active: true, source_clients: ROSTER_MINE },
          { name: 'Other Fixture Person', email: '', active: true, source_clients: ['Anchor Fixture Delta'] }
        ] }) }).catch(() => {});
      });
      const MINE = ['Anchor Fixture Mine One', 'Anchor Fixture Mine Two'];
      const OTHERS = ['Anchor Fixture Delta', 'Anchor Fixture Echo', 'Anchor Fixture Foxtrot', 'Anchor Fixture Golf'];
      const OUTSIDE = 'Anchor Fixture Hotel';
      const all = MINE.concat(OTHERS, [OUTSIDE]);
      await page.evaluate(({ all, mine }) => {
        all.forEach(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); });
        all.forEach(n => { clientMap[n] = { client_name: n }; });
      }, { all, mine: MINE });
      // Open the dropdown from a known closed state and wait for focus. An
      // Escape pressed before the search box had focus left it open on CI,
      // so the next badge click closed it and the checks read a stale render.
      const closePop = async () => {
        await page.evaluate(() => { if (!document.getElementById('svClientPop').hidden) _svClientPopClose(); });
        await page.waitForFunction(() => document.getElementById('svClientPop').hidden, null, { timeout: 5000 });
      };
      const openPop = async () => {
        await closePop();
        await page.click('#svClientBadge');
        await page.waitForFunction(() => !document.getElementById('svClientPop').hidden && document.activeElement && document.activeElement.id === 'svClientSearch', null, { timeout: 5000 });
      };
      const pick = async name => {
        await openPop();
        await page.fill('#svClientSearch', name);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
      };
      // Visit a mine client, then four others (Golf last = current).
      for (const n of [MINE[1], ...OTHERS]) await pick(n);
      const sections = () => page.$$eval('#svClientResults [data-sv-client]', els => els.map(e => ({
        n: e.getAttribute('data-sv-client'), sec: e.getAttribute('data-sv-section'), cur: e.classList.contains('is-current'),
        forget: !!(e.parentElement && e.parentElement.querySelector('.sv-client-forget'))
      })));
      const labels = () => page.$$eval('#svClientResults .sv-client-sec', els => els.map(e => ({ t: e.textContent.trim(), tt: getComputedStyle(e).textTransform })));

      // Admin not on the roster: no My clients, Recent capped at three.
      const asStaff = async (role, name) => {
        await page.evaluate(({ role, name }) => {
          const id = _syncviewStaffIdentityLoad();
          _syncviewStaffIdentitySave(Object.assign({}, id, { role, member: Object.assign({}, id.member, { role, name }) }));
        }, { role, name });
        await page.waitForFunction(r => _syncviewStaffIdentityValid() && _syncviewStaffIdentityLoad().member.role === r, role, { timeout: 15000 })
          .catch(() => failures.push(`${role}: the seeded identity never became valid`));
        await page.evaluate(all => { all.forEach(n => { clientMap[n] = { client_name: n }; }); }, all);
      };
      await asStaff('admin', 'Unlisted Admin Fixture');
      await openPop();
      await page.waitForTimeout(800);
      let rows = await sections();
      expect(rows.every(r => r.sec === 'recent'), 'admin: only Recent should show');
      expect(rows.length === 3, `admin: Recent should hold three rows, got ${rows.length}`);
      expect(rows[0].n === OTHERS[3] && rows[0].cur, 'admin: the current client should lead Recent, tinted');
      expect((await labels()).length === 0, 'admin: no section label when only Recent shows');
      await closePop();

      // Admin on the roster (the owner is an admin and an SMM): My clients
      // shows, with no remove button.
      await asStaff('admin', 'QA Staff');
      await openPop();
      await page.waitForFunction(() => document.querySelector('#svClientResults [data-sv-section="mine"]'), null, { timeout: 10000 })
        .catch(() => failures.push('rostered admin: My clients never appeared'));
      rows = await sections();
      expect(JSON.stringify(rows.filter(r => r.sec === 'mine').map(r => r.n)) === JSON.stringify(MINE), `rostered admin: My clients should be ${MINE}, got ${rows.filter(r => r.sec === 'mine').map(r => r.n)}`);
      expect(rows.filter(r => r.sec === 'mine').every(r => !r.forget), 'rostered admin: My clients must not offer a remove button');
      expect(rows.filter(r => r.sec === 'recent').every(r => !MINE.includes(r.n)), 'rostered admin: Recent repeats a My clients entry');
      await closePop();

      // Become a verified SMM whose first name matches the fixture map.
      await page.evaluate(() => {
        const id = _syncviewStaffIdentityLoad();
        _syncviewStaffIdentitySave(Object.assign({}, id, { role: 'smm', member: Object.assign({}, id.member, { role: 'smm', name: 'QA Staff' }) }));
      });
      // Boot keeps loading in the background (key-verify, Clients Info), and
      // on a slower runner that can land after the seed above. Wait for the
      // verified SMM identity, then seed Clients Info again and open the
      // dropdown once so the roster loads, as it does for a real SMM.
      await page.waitForFunction(() => _syncviewStaffIdentityValid() && _syncviewStaffIdentityLoad().member.role === 'smm', null, { timeout: 15000 })
        .catch(() => failures.push('smm: the seeded SMM identity never became valid'));
      await page.waitForTimeout(1500);
      await page.evaluate(all => { all.forEach(n => { clientMap[n] = { client_name: n }; }); }, all);
      await openPop();
      await page.waitForFunction(() => document.querySelector('#svClientResults [data-sv-section="mine"]'), null, { timeout: 10000 })
        .catch(() => failures.push('smm: My clients never appeared after the roster loaded'));
      rows = await sections();
      const mineRows = rows.filter(r => r.sec === 'mine');
      const recentRows = rows.filter(r => r.sec === 'recent');
      expect(JSON.stringify(mineRows.map(r => r.n)) === JSON.stringify(MINE), `smm: My clients should be ${MINE}, got ${mineRows.map(r => r.n)} (state: ${JSON.stringify(await page.evaluate(() => ({ valid: _syncviewStaffIdentityValid(), role: (_syncviewStaffIdentityLoad() || {}).role, roster: _srpState.managersLoaded })))})`);
      // Today and the dropdown agree: Today's own visible-client list for this
      // SMM is exactly the dropdown's My clients.
      const today = await page.evaluate(async () => {
        const v = await _tdyVisibleClients(_tdyIdentity());
        return [...v.keys].map(k => svCurrentClients().get(k)).sort((a, b) => a.localeCompare(b));
      }).catch(e => 'error: ' + e.message);
      expect(JSON.stringify(today) === JSON.stringify(mineRows.map(r => r.n)), `smm: Today's clients ${JSON.stringify(today)} differ from the dropdown's My clients ${JSON.stringify(mineRows.map(r => r.n))}`);
      expect(mineRows.every(r => !r.forget), 'smm: My clients must not offer a remove button');
      expect(recentRows.length <= 3 && recentRows.length > 0, `smm: Recent should hold one to three rows, got ${recentRows.length}`);
      expect(recentRows.every(r => !MINE.includes(r.n)), 'smm: Recent repeats a My clients entry');
      expect(recentRows.filter(r => !r.cur).every(r => r.forget), 'smm: Recent rows should offer a remove button');
      expect(rows.filter(r => r.cur).length === 1 && rows.find(r => r.cur).n === OTHERS[3], 'smm: the current client should be tinted once');
      const ls = await labels();
      expect(JSON.stringify(ls.map(l => l.t)) === JSON.stringify(['My clients', 'Recent']), `smm: section labels are ${ls.map(l => l.t)}`);
      expect(ls.every(l => l.tt === 'none'), 'smm: section labels should be sentence case, not uppercase');
      // Accessibility: listboxes hold options only; buttons sit outside them.
      const a11y = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('#svClientResults [role="listbox"]')];
        const optionOnly = boxes.every(b => [...b.children].every(c => c.querySelector(':scope > [role="option"]') && !c.matches('[role="option"] *')));
        const btnInOption = !!document.querySelector('#svClientResults [role="option"] button');
        const clearInList = !!document.querySelector('#svClientResults [role="listbox"] .sv-client-clear');
        return { n: boxes.length, optionOnly, btnInOption, clearInList };
      });
      expect(a11y.n === 2 && !a11y.btnInOption && !a11y.clearInList, `smm: remove / clear controls must sit outside options and listboxes (${JSON.stringify(a11y)})`);
      await closePop();

      // Current is one of My clients: tinted there, not repeated in Recent.
      await pick(MINE[0]);
      await openPop();
      rows = await sections();
      expect(rows.find(r => r.n === MINE[0] && r.sec === 'mine' && r.cur), 'smm: a current My client should be tinted in My clients');
      expect(rows.filter(r => r.sec === 'recent').length === 3 && rows.filter(r => r.sec === 'recent').every(r => !MINE.includes(r.n)), 'smm: Recent should show three others');
      // Search reaches a client in neither list.
      await page.fill('#svClientSearch', OUTSIDE);
      rows = await sections();
      expect(rows.length === 1 && rows[0].n === OUTSIDE, 'search: a client outside both lists is not found');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => calState.client) === OUTSIDE, 'search: picking a client outside both lists did not switch');
      // Escape pressed before focus reaches the search box still closes it.
      const earlyEsc = await page.evaluate(() => {
        const badge = document.getElementById('svClientBadge');
        badge.focus();
        svClientPopToggle();
        badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return document.getElementById('svClientPop').hidden;
      });
      expect(earlyEsc, 'escape: an Escape before the search box had focus left the dropdown open');

      await context.close();
    }

    // Touch device: the remove button is at least 44px square.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
      });
      await seedStaffGate(context);
      await context.addInitScript(v => { try { localStorage.setItem('syncview_recent_clients', JSON.stringify(v)); } catch (e) {} }, [FIRST, SECOND]);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.navTo === 'function' && document.getElementById('svClientBar'));
      await page.waitForTimeout(1500);
      await page.evaluate(names => { names.forEach(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); }); }, [FIRST, SECOND]);
      if (await page.locator('[data-pocket-staff-phone]').count()) await page.locator('[data-staff-menu=more]').click();
      await page.evaluate(() => svClientPopToggle());
      await page.waitForTimeout(200);
      const box = await page.evaluate(() => {
        const b = document.querySelector('#svClientResults .sv-client-forget');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { w: r.width, h: r.height, o: getComputedStyle(b).opacity };
      });
      expect(box && box.w >= 44 && box.h >= 44 && box.o === '1', `touch: the remove button should be a visible 44px target, got ${JSON.stringify(box)}`);
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

    // Toolbar balance (owner request 2026-09-27): the view switch sits at the
    // left end of the Calendar and Samples toolbars, the other controls at the
    // right, and nothing widens the page on a phone.
    for (const [path, zoom] of [['/calendar', '#calZoomCtl'], ['/sample-reviews', '#sxrZoomCtl']]) {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
        });
        await seedStaffGate(context);
        await context.addInitScript(v => { try { localStorage.setItem('syncview_shared_client', v); } catch (e) {} }, FIRST);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        const m = await page.evaluate(z => {
          const bar = document.querySelector('.cal-toolbar');
          const tog = bar && bar.querySelector('.cal-view-toggle');
          const zm = document.querySelector(z);
          const b = bar.getBoundingClientRect(), t = tog.getBoundingClientRect(), r = zm.getBoundingClientRect();
          // DOM order must equal visual order so keyboard Tab reaches the switch
          // first: it is the first child group of .cal-toolbar-mid holding a
          // focusable control.
          const mid = bar.querySelector('.cal-toolbar-mid');
          const firstFocusable = [...mid.children].find(el => el.matches('button,a[href],input,select,[tabindex]') || el.querySelector('button,a[href],input,select,[tabindex]'));
          return { phone: !!document.querySelector('[data-pocket-staff-phone], [data-pocket-staff-samples]'), toggleGap: Math.round(t.left - b.left), zoomGap: Math.round(b.right - r.right), togLeftOfZoom: t.left < r.left, togFirstInDom: firstFocusable === tog, page: document.documentElement.scrollWidth };
        }, zoom);
        const tag = `${path.slice(1)} @${width}`;
        expect(m.toggleGap < 40, `${tag}: the view switch is not at the left end of the toolbar (${m.toggleGap}px in)`);
        if (m.phone) {
          expect(await page.isVisible('.cal-view-toggle'), tag + ': phone view switch must remain visible');
          expect(!(await page.isVisible(zoom)), tag + ': card size belongs inside More');
          await page.locator('[data-staff-menu=more], [data-samples-menu=more]').click();
          expect(await page.isVisible(zoom), tag + ': More must expose the original card size control');
          await page.keyboard.press('Escape');
        } else expect(m.togLeftOfZoom, `${tag}: the view switch should sit left of zoom`);
        expect(m.togFirstInDom, `${tag}: the view switch is not the first focusable group in the toolbar DOM (tab order would jump)`);
        if (width > 800) expect(m.zoomGap < 200, `${tag}: zoom should stay on the right (${m.zoomGap}px from the edge)`);
        expect(m.page <= width, `${tag}: the page is ${m.page}px wide on a ${width}px screen`);
        await context.close();
      }
    }

    // Tab row fit (regression from the picker in #1779): with the Kasper tab
    // present, the whole row fits with no sideways scroll at 1280px and wider,
    // no tab is hidden, and the sliding highlight sits under the active tab.
    // Also under touch (no hover): compact keeps small labels, not icons only,
    // and switching to a client with a long first name re-fits the row.
    for (const touch of [false, true])
    for (const width of [1280, 1366, 1440]) {
      for (const path of ['/calendar', '/kasper']) {
        const context = await browser.newContext({ viewport: { width, height: 700 }, hasTouch: touch });
        await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
        });
        await seedStaffGate(context);
        await context.addInitScript(v => {
          try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); localStorage.setItem('syncview_shared_client', v); } catch (e) {}
        }, FIRST);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        const measure = () => page.evaluate(() => {
          const nav = document.getElementById('headerNav');
          const tabs = [...nav.querySelectorAll(':scope > .header-nav-btn')].filter(a => getComputedStyle(a).display !== 'none');
          const navBox = nav.getBoundingClientRect();
          const active = nav.querySelector(':scope > .header-nav-btn.active');
          const pill = nav.querySelector(':scope > .header-nav-pill').getBoundingClientRect();
          const act = active.getBoundingClientRect();
          return {
            over: nav.scrollWidth - nav.clientWidth,
            kasper: tabs.some(a => a.id === 'navKasper'),
            outside: tabs.filter(a => { const r = a.getBoundingClientRect(); return r.left < navBox.left - 1 || r.right > navBox.right + 1 || r.width < 20; }).map(a => a.id),
            pillOff: Math.round(Math.abs(pill.left - act.left) + Math.abs(pill.width - act.width)),
            noHover: matchMedia('(hover: none)').matches,
            iconOnly: tabs.filter(a => !a.classList.contains('active') && parseFloat(getComputedStyle(a).fontSize) < 1).map(a => a.id),
            unlabelled: tabs.filter(a => !a.classList.contains('active') && parseFloat(getComputedStyle(a).fontSize) < 1 && !String(a.getAttribute('aria-label') || '').trim()).map(a => a.id),
            unnamed: tabs.filter(a => !String(a.title || a.getAttribute('aria-label') || '').trim()).map(a => a.id),
          };
        });
        const check = (m, tag) => {
          expect(m.kasper, `${tag}: the Kasper tab should be present for this check`);
          expect(m.over <= 0, `${tag}: overflows by ${m.over}px`);
          expect(!m.outside.length, `${tag}: tabs cut off or hidden: ${m.outside.join(',')}`);
          expect(m.pillOff <= 2, `${tag}: the active highlight is ${m.pillOff}px off its tab`);
          expect(!m.unnamed.length, `${tag}: tabs with no title or accessible name: ${m.unnamed.join(',')}`);
          if (touch) {
            expect(m.noHover, `${tag}: the touch context does not report hover:none`);
            // Small labels where they fit; icons only is the last resort, and
            // then every tab must carry its name as an aria-label.
            if (width >= 1440 && !/long/.test(tag)) expect(!m.iconOnly.length, `${tag}: touch tabs shown as icons only: ${m.iconOnly.join(',')}`);
            expect(!m.unlabelled.length, `${tag}: icon-only touch tabs with no aria-label: ${m.unlabelled.join(',')}`);
          }
        };
        const base = `tab row @${width} on ${path}${touch ? ' (touch)' : ''}`;
        check(await measure(), base);
        // Switch to a client with a long first name: the label widens, the row
        // narrows with no window resize, and it must re-fit.
        await page.evaluate(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); }, LONG);
        await page.click('#svClientBadge');
        await page.fill('#svClientSearch', LONG.slice(0, 18));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(800);
        const labelNow = await page.evaluate(() => document.getElementById('svClientBadgeLabel').textContent);
        expect(labelNow === LONG.split(' ')[0], `${base}: the picker label did not switch to the long name (${labelNow})`);
        check(await measure(), `${base} after a long client name`);
        await context.close();
      }
    }

    // Full labels for the worst case (owner, 2026-09-28): an admin with every
    // tab including Kasper and a client selected keeps FULL labels (not compact,
    // not icons) at 1366px (typical client) and 1440px (long client name too).
    // Three visible labels were shortened for this; each keeps its full name
    // as title and aria-label. The client name is never truncated (owner,
    // 2026-09-28), so 1366px with a long name is accepted as compact: the
    // is-compact row (not is-icons), no overflow, nothing clipped, the pill
    // under the active tab, and the client name shown in full.
    for (const [width, clients] of [[1366, [FIRST, LONG]], [1440, [FIRST, LONG]]]) {
      for (const client of clients) {
        const context = await browser.newContext({ viewport: { width, height: 700 } });
        await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
        });
        await seedStaffGate(context);
        await context.addInitScript(v => {
          try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); localStorage.setItem('syncview_shared_client', v); } catch (e) {}
        }, FIRST);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}/calendar`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        await page.evaluate(n => { if (!WL_CLIENT_NAMES.includes(n)) WL_CLIENT_NAMES.push(n); }, client);
        await page.click('#svClientBadge');
        await page.fill('#svClientSearch', client.slice(0, 18));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(800);
        const m = await page.evaluate(() => {
          const nav = document.getElementById('headerNav');
          const tabs = [...nav.querySelectorAll(':scope > .header-nav-btn')].filter(a => getComputedStyle(a).display !== 'none');
          const navBox = nav.getBoundingClientRect();
          const short = {};
          for (const id of ['navFilmingPlans', 'navTiktokUpload', 'navProd']) {
            const a = document.getElementById(id);
            short[id] = { text: a.textContent.trim(), title: a.title, aria: a.getAttribute('aria-label') };
          }
          const lab = document.getElementById('svClientBadgeLabel');
          const badge = document.getElementById('svClientBadge');
          return {
            label: lab.textContent,
            labelW: Math.round(lab.getBoundingClientRect().width),
            truncated: lab.scrollWidth > lab.clientWidth,
            badgeTitle: badge.title,
            navW: Math.round(nav.scrollWidth), navClient: Math.round(nav.clientWidth),
            kasper: tabs.some(a => a.id === 'navKasper'),
            compact: nav.classList.contains('is-compact') || nav.classList.contains('is-icons'),
            isCompact: nav.classList.contains('is-compact'),
            isIcons: nav.classList.contains('is-icons'),
            ellipsis: getComputedStyle(lab).textOverflow === 'ellipsis',
            pillOff: (() => { const act = nav.querySelector(':scope > .header-nav-btn.active'); const pill = nav.querySelector(':scope > .header-nav-pill'); if (!act || !pill) return 99; const a = act.getBoundingClientRect(), p = pill.getBoundingClientRect(); return Math.round(Math.abs(p.left - a.left) + Math.abs(p.width - a.width)); })(),
            small: tabs.filter(a => parseFloat(getComputedStyle(a).fontSize) < 11).map(a => a.id),
            over: nav.scrollWidth - nav.clientWidth,
            outside: tabs.filter(a => { const r = a.getBoundingClientRect(); return r.left < navBox.left - 1 || r.right > navBox.right + 1; }).map(a => a.id),
            short,
          };
        });
        const compactCase = width === 1366 && client === LONG;
        const tag = `${compactCase ? 'compact labels' : 'full labels'} @${width} with ${client === LONG ? 'a long' : 'a typical'} client`;
        expect(m.label === client.split(' ')[0], `${tag}: the client was not selected (${m.label})`);
        if (process.env.SV_DEBUG) console.log(tag, JSON.stringify({ labelW: m.labelW, truncated: m.truncated, navW: m.navW, navClient: m.navClient, over: m.over }));
        // The client name always shows in full: no clipping, no ellipsis.
        expect(!m.truncated && !m.ellipsis, `${tag}: client name truncated (width ${m.labelW}px, ellipsis ${m.ellipsis})`);
        expect(m.badgeTitle === client, `${tag}: the badge title should hold the full name (got "${m.badgeTitle}")`);
        expect(m.kasper, `${tag}: the Kasper tab should be present for this check`);
        if (compactCase) {
          expect(m.isCompact && !m.isIcons, `${tag}: expected the compact row, not icons only (compact ${m.isCompact}, icons ${m.isIcons})`);
          expect(m.pillOff <= 2, `${tag}: the active highlight is ${m.pillOff}px off its tab`);
        } else {
          expect(!m.compact && !m.small.length, `${tag}: tabs compact or icons only: ${m.small.join(',') || 'row class'}`);
        }
        expect(m.over <= 0, `${tag}: overflows by ${m.over}px`);
        expect(!m.outside.length, `${tag}: tabs cut off: ${m.outside.join(',')}`);
        const want = compactCase ? {} : { navFilmingPlans: ['Filming', 'Filming Plans'], navTiktokUpload: ['TikTok', 'TikTok Upload'], navProd: ['Linear', 'SyncLinear'] };
        for (const [id, [text, full]] of Object.entries(want)) {
          const s = m.short[id];
          expect(s.text === text, `${tag}: ${id} reads "${s.text}", expected "${text}"`);
          expect(s.title === full && s.aria === full, `${tag}: ${id} title/aria-label should be "${full}" (got "${s.title}" / "${s.aria}")`);
        }
        await context.close();
      }
    }

    // Late web font (owner, 2026-09-27): on a wide desktop the tabs loaded as
    // icons only and needed a window resize to show their names. The first fit
    // ran on the fallback font, went compact, and nothing re-fit when the web
    // font swapped in. Hold the font back a few seconds, then require full
    // labels, no overflow and the pill under the active tab once it settles.
    // Also: the touch-only quick-jump button stays hidden on a mouse desktop.
    // Any narrow system TTF stands in for the web font file; the timing is what matters.
    const fontFile = ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
      .map(f => { try { return require('fs').readFileSync(f); } catch (e) { return null; } }).find(Boolean);
    for (const width of [1440, 1600]) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      let fontServed = false;
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), async route => {
        const u = route.request().url();
        try {
          if (/fonts\.googleapis\.com\/css2/.test(u)) {
            // Held back too, so document.fonts.ready has already settled on
            // the fallback before the face is even declared (as on a slow link).
            await new Promise(r => setTimeout(r, 2000));
            return await route.fulfill({ status: 200, contentType: 'text/css', body:
              "@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:300 800;font-display:swap;src:url(https://fonts.gstatic.com/s/fixture/late-font.ttf) format('truetype');}" });
          }
          if (/fonts\.gstatic\.com\/s\/fixture\//.test(u)) {
            await new Promise(r => setTimeout(r, 2000));
            fontServed = true;
            if (!fontFile) return await route.fulfill({ status: 404, body: '' });
            return await route.fulfill({ status: 200, contentType: 'font/ttf', body: fontFile });
          }
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        } catch (e) {}
      });
      await seedStaffGate(context);
      await context.addInitScript(v => {
        try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); localStorage.setItem('syncview_shared_client', v); } catch (e) {}
        // Stand-in for a wide system fallback (the owner's machine): until the
        // web font lands, the family renders from a wide local face.
        try {
          const wide = new FontFace('Plus Jakarta Sans', "local('DejaVu Sans Bold'), local('DejaVuSans-Bold')", { sizeAdjust: '135%' });
          document.fonts.add(wide);
          wide.load().catch(() => {});
          // The rest of the header is still settling too: a wide placeholder
          // in the actions area goes away as the web font lands.
          document.addEventListener('DOMContentLoaded', () => {
            const a = document.querySelector('.header-actions');
            if (!a) return;
            const ph = document.createElement('span');
            ph.style.cssText = 'display:inline-block;width:260px;height:1px;flex:none';
            a.appendChild(ph);
            setTimeout(() => { ph.remove(); document.fonts.delete(wide); }, 3800);
          });
        } catch (e) {}
      }, FIRST);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const early = await page.evaluate(() => { const n = document.getElementById('headerNav'); return n.className + ' w=' + n.clientWidth + ' sw=' + n.scrollWidth + ' ' + document.fonts.check("600 12px 'Plus Jakarta Sans'") + ' ' + [...document.fonts].map(f => f.status).join(','); });
      await page.waitForTimeout(5000);
      const tag = `late font @${width}`;
      if (process.env.SV_DEBUG) console.log(tag, 'before the font:', early);
      expect(fontServed, `${tag}: the delayed web font was never requested`);
      const m = await page.evaluate(() => {
        const nav = document.getElementById('headerNav');
        const tabs = [...nav.querySelectorAll(':scope > .header-nav-btn')].filter(a => getComputedStyle(a).display !== 'none');
        const navBox = nav.getBoundingClientRect();
        const active = nav.querySelector(':scope > .header-nav-btn.active');
        const pill = nav.querySelector(':scope > .header-nav-pill').getBoundingClientRect();
        const act = active.getBoundingClientRect();
        const jump = document.querySelector('.sv-jump-touch');
        return {
          fontLoaded: document.fonts.check("600 12px 'Plus Jakarta Sans'"),
          kasper: tabs.some(a => a.id === 'navKasper'),
          compact: nav.classList.contains('is-compact') || nav.classList.contains('is-icons'),
          iconOnly: tabs.filter(a => parseFloat(getComputedStyle(a).fontSize) < 1).map(a => a.id),
          over: nav.scrollWidth - nav.clientWidth,
          outside: tabs.filter(a => { const r = a.getBoundingClientRect(); return r.left < navBox.left - 1 || r.right > navBox.right + 1 || r.width < 20; }).map(a => a.id),
          pillOff: Math.round(Math.abs(pill.left - act.left) + Math.abs(pill.width - act.width)),
          jumpShown: !!jump && getComputedStyle(jump).display !== 'none',
        };
      });
      if (fontFile) expect(m.fontLoaded, `${tag}: the web font did not finish loading`);
      expect(m.kasper, `${tag}: the Kasper tab should be present for this check`);
      expect(!m.compact && !m.iconOnly.length, `${tag}: tabs stuck compact / icons only after the font arrived: ${m.iconOnly.join(',') || 'row class'}`);
      expect(m.over <= 0, `${tag}: overflows by ${m.over}px`);
      expect(!m.outside.length, `${tag}: tabs cut off or hidden: ${m.outside.join(',')}`);
      expect(m.pillOff <= 2, `${tag}: the active highlight is ${m.pillOff}px off its tab`);
      expect(!m.jumpShown, `${tag}: the touch-only quick-jump button shows on a mouse desktop`);
      await context.close();
    }
    // Resize burst (review, 2026-09-27): more than 30 resizes inside a second
    // trips the fit's loop cap. A narrow-then-wide burst must still end on
    // full labels, via the trailing fit, not stay stuck on icons.
    {
      const context = await browser.newContext({ viewport: { width: 1600, height: 800 } });
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
      });
      await seedStaffGate(context);
      await context.addInitScript(v => {
        try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); localStorage.setItem('syncview_shared_client', v); } catch (e) {}
      }, FIRST);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      // Burn the cap at the wide size, then go narrow (icons), then back wide
      // while the cap is still tripped.
      for (let i = 0; i < 40; i++) {
        await page.evaluate(() => new Promise(r => { window.dispatchEvent(new Event('resize')); requestAnimationFrame(() => r()); }));
      }
      await page.setViewportSize({ width: 1100, height: 800 });
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => new Promise(r => { window.dispatchEvent(new Event('resize')); requestAnimationFrame(() => r()); }));
      }
      await page.setViewportSize({ width: 1600, height: 800 });
      await page.waitForTimeout(1800);
      const stuck = await page.evaluate(() => {
        const nav = document.getElementById('headerNav');
        return nav.classList.contains('is-compact') || nav.classList.contains('is-icons') || nav.scrollWidth > nav.clientWidth;
      });
      expect(!stuck, 'resize burst: the tab row did not settle on full labels after the burst');
      await context.close();
    }
    // Quick-jump button: shown only on a touch-first device.
    {
      const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => {
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
      });
      await seedStaffGate(context);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      const shown = await page.evaluate(() => { const j = document.querySelector('.sv-jump-touch'); return !!j && getComputedStyle(j).display !== 'none'; });
      expect(shown, 'touch device: the quick-jump button is not showing');
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
