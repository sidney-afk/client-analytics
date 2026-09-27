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
          return { toggleGap: Math.round(t.left - b.left), zoomGap: Math.round(b.right - r.right), togLeftOfZoom: t.left < r.left, togFirstInDom: firstFocusable === tog, page: document.documentElement.scrollWidth };
        }, zoom);
        const tag = `${path.slice(1)} @${width}`;
        expect(m.toggleGap < 40, `${tag}: the view switch is not at the left end of the toolbar (${m.toggleGap}px in)`);
        expect(m.togLeftOfZoom, `${tag}: the view switch should sit left of zoom`);
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
