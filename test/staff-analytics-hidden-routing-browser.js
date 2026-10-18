'use strict';
/*
 * STAFF ROUTING WHILE ANALYTICS IS HIDDEN (session Detour, 2026-10-18). Fully offline: a fictional staff member and
 * client from the review page's fixture, every backend call answered locally.
 *
 * Analytics is hidden for everyone unless analytics_hidden reads exactly { "hidden": false } (session Curtain Seven).
 * The staff bar has no Analytics tab then, so a route that still ended on Analytics left the person on a page they
 * could neither identify nor leave. This logs what every animation frame shows from the first script on and fails if
 * any frame of a hidden run shows Analytics (the overview, a client's Analytics page, its tab lit or its loading
 * skeleton) on these routes:
 *   - a bare visit, a refresh of Home, and #home;
 *   - the logo;
 *   - a saved #<client> address, and Back / Forward onto a client's Analytics history entry or a bare client hash;
 *   - a phone's bare visit, which still opens Today.
 * And with analytics_hidden = { hidden: false } Home and a client address still open Analytics, as before.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const fx = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const FRAME_LOG = () => {
  window.__aLog = [];
  let n = 0;
  const seen = () => {
    const de = document.documentElement;
    const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    const sk = document.querySelector('.boot-skeleton-analytics');
    const nav = document.getElementById('navHome');
    // Only what a person can see counts: the boot skeletons and the staff bar carry Analytics markup that stays hidden.
    const shownIn = sel => Array.from(document.querySelectorAll(sel)).some(el => vis(el) && !el.closest('[class*="boot-skeleton"]'));
    return {
      overview: shownIn('.overview-wrap'),
      clientPage: shownIn('.client-view:not(.cal-tab-view)'),
      lit: vis(nav) && nav.classList.contains('active'),
      skeleton: vis(sk),
      bootNav: de.getAttribute('data-boot-nav') || '',
    };
  };
  const tick = () => {
    try { const s = seen(); s.t = Math.round(performance.now()); s.body = !!document.getElementById('mainWrap'); window.__aLog.push(s); } catch (e) {}
    if (++n < 900) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const analyticsFrames = log => log.filter(f => f.body && (f.overview || f.clientPage || f.lit || f.skeleton || f.bootNav === 'analytics'));
const describe = f => f ? JSON.stringify({ overview: f.overview, clientPage: f.clientPage, lit: f.lit, skeleton: f.skeleton, bootNav: f.bootNav }) : '';

async function where(page) {
  return page.evaluate(name => ({
    hash: decodeURIComponent((window.svRoute && window.svRoute.hash()) || location.hash || '').replace(name, '<client>'),
    cal: !!document.getElementById('calView') || !!document.querySelector('.cal-page, #calToolbar'),
    calTab: document.getElementById('navCalendar') ? document.getElementById('navCalendar').classList.contains('active') : false,
    today: !!document.querySelector('.tdy') || (document.getElementById('navToday') ? document.getElementById('navToday').classList.contains('active') : false),
    clientPage: Array.from(document.querySelectorAll('.client-view:not(.cal-tab-view)')).some(el => el.getClientRects().length > 0),
    analytics: Array.from(document.querySelectorAll('.overview-wrap, .client-view:not(.cal-tab-view)')).some(el => el.getClientRects().length > 0 && !el.closest('[class*="boot-skeleton"]')),
    title: (document.querySelector('.pocket-staff-title') || {}).textContent || '',
  }), TEST_CLIENT);
}

// Opens a staff page, runs `go` (navigation steps), and returns the frame log that spans all of it.
async function run(browser, origin, opt, go) {
  const t = await fx.open(browser, origin, Object.assign({ stage: 'smm', staff: fx.STAFF }, opt));
  await t.page.addInitScript(FRAME_LOG);
  await go(t.page, origin);
  await fx.sleep(2500);
  const log = await t.page.evaluate(() => window.__aLog || []);
  return { t, log };
}
const load = (path, wait) => async (page, origin) => { await page.goto(origin + '/index.html' + path, { waitUntil: 'load' }); await fx.sleep(wait || 2500); };
// A reload after the page set its own history state, as a refresh of the page the person is on does.
const refreshWithState = (state, path) => async (page, origin) => {
  await page.goto(origin + '/index.html#calendar', { waitUntil: 'load' });
  await fx.sleep(2000);
  // What a visit to Home leaves behind: the history entry's state and the remembered tab.
  await page.evaluate(([s, p]) => { history.replaceState(s, '', p); try { localStorage.setItem('syncview_nav', 'home'); } catch (e) {} }, [state, path]);
  await page.reload({ waitUntil: 'load' });
  await fx.sleep(2500);
};
// A roster name, read from the running app so none is written in this file (the repository is public): a #<client>
// address for it is a real client route. It is never printed.
let TEST_CLIENT = '';
let CLIENT_HASH = '';

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    {
      const t = await fx.open(browser, origin, { stage: 'smm', staff: fx.STAFF });
      await t.page.goto(origin + '/index.html#calendar', { waitUntil: 'load' });
      await fx.sleep(2500);
      TEST_CLIENT = await t.page.evaluate(() => (window.getClientRoster() || [])[0] || '');
      CLIENT_HASH = '#' + encodeURIComponent(TEST_CLIENT);
      await t.ctx.close();
      expect(!!TEST_CLIENT, 'the app has a roster name to use as the client address');
    }
    // ---------- hidden (no analytics_hidden row, the live state) ----------
    const cases = [
      ['a bare visit', load(''), w => w.today || w.calTab],
      ['a refresh of Home', refreshWithState({ nav: 'home', client: null }, '/index.html'), w => w.calTab],
      ['#home', load('#home'), w => w.calTab],
      ['a saved #<client> address', load(CLIENT_HASH), w => w.calTab],
      ['a refresh on a client Analytics history entry', refreshWithState({ nav: 'home', client: TEST_CLIENT, clientTab: 'analytics' }, '/index.html' + CLIENT_HASH), w => w.calTab],
      ['a refresh on a client entry with no tab saved', refreshWithState({ nav: 'home', client: TEST_CLIENT }, '/index.html' + CLIENT_HASH), w => w.calTab],
    ];
    for (const [label, go, ok] of cases) {
      console.log('--- hidden: ' + label + ' ---');
      const { t, log } = await run(browser, origin, {}, go);
      const bad = analyticsFrames(log);
      expect(log.filter(f => f.body).length > 5, label + ': frames were logged (' + log.filter(f => f.body).length + ')');
      expect(!bad.length, label + ': no frame shows Analytics (' + bad.length + ' did; first ' + describe(bad[0]) + ')');
      const w = await where(t.page);
      expect(ok(w), label + ': it ends on the page that replaces Analytics (' + JSON.stringify(w) + ')');
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- hidden: a saved client address opens that client\'s Calendar ---');
    {
      const { t } = await run(browser, origin, {}, load(CLIENT_HASH));
      await fx.sleep(1500);
      const w = await where(t.page);
      expect(/^#calendar/.test(w.hash) && w.calTab, 'the address becomes the Calendar\'s (' + w.hash + ')');
      await t.ctx.close();
    }

    console.log('--- hidden: the logo ---');
    {
      const t = await fx.open(browser, origin, { stage: 'smm', staff: fx.STAFF });
      await t.page.addInitScript(FRAME_LOG);
      await t.page.goto(origin + '/index.html#templates', { waitUntil: 'load' });
      await fx.sleep(2500);
      await t.page.evaluate(() => { window.__aLog = []; });
      await t.page.locator('a.logo').first().click();
      await fx.sleep(2000);
      const log = await t.page.evaluate(() => window.__aLog || []);
      const bad = analyticsFrames(log);
      expect(!bad.length, 'the logo: no frame shows Analytics (' + bad.length + ' did; first ' + describe(bad[0]) + ')');
      const w = await where(t.page);
      expect(w.calTab && /^#calendar/.test(w.hash), 'the logo opens the Calendar (' + JSON.stringify(w) + ')');
      expect(t.errors.length === 0, 'the logo: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- hidden: Back and Forward ---');
    {
      const t = await fx.open(browser, origin, { stage: 'smm', staff: fx.STAFF });
      await t.page.addInitScript(FRAME_LOG);
      await t.page.goto(origin + '/index.html#templates', { waitUntil: 'load' });
      await fx.sleep(2500);
      await t.page.evaluate(() => { window.__aLog = []; });
      // A history entry for a client's Analytics page (as the old client list made), then one the address bar made.
      await t.page.evaluate(([c]) => {
        history.pushState({ nav: 'home', client: c, clientTab: 'analytics' }, '', '/#' + encodeURIComponent(c));
      }, [TEST_CLIENT]);
      await t.page.evaluate(() => history.back());
      await fx.sleep(1200);
      await t.page.evaluate(() => history.forward());
      await fx.sleep(2000);
      let w = await where(t.page);
      expect(w.calTab && !w.analytics, 'Forward onto a client\'s Analytics entry opens the Calendar (' + JSON.stringify(w) + ')');
      await t.page.evaluate(() => history.back());
      await fx.sleep(1200);
      // An entry with no state, as a typed or bookmarked address leaves (the address bar's own form).
      await t.page.evaluate(h => { history.pushState(null, '', '/' + h); }, CLIENT_HASH);
      await fx.sleep(500);
      await t.page.evaluate(() => history.back());
      await fx.sleep(1200);
      await t.page.evaluate(() => history.forward());
      await fx.sleep(2000);
      w = await where(t.page);
      expect(w.calTab && !w.analytics, 'Forward onto a bare client address opens the Calendar (' + JSON.stringify(w) + ')');
      const bad = analyticsFrames(await t.page.evaluate(() => window.__aLog || []));
      expect(!bad.length, 'Back and Forward: no frame shows Analytics (' + bad.length + ' did; first ' + describe(bad[0]) + ')');
      expect(t.errors.length === 0, 'Back and Forward: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- hidden: a phone\'s bare visit still opens Today ---');
    {
      const { t, log } = await run(browser, origin, { width: 390, height: 844 }, load(''));
      const w = await where(t.page);
      expect(w.title === 'Today' || w.today, 'the phone opens Today (' + JSON.stringify(w) + ')');
      expect(!analyticsFrames(log).length, 'the phone: no frame shows Analytics');
      expect(await t.page.locator('.pocket-staff-bar').count() === 1, 'the phone title bar is there');
      expect(t.errors.length === 0, 'the phone: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- shown: analytics_hidden = { hidden: false } changes nothing ----------
    for (const [label, go, ok] of [
      ['a refresh of Home', refreshWithState({ nav: 'home', client: null }, '/index.html'), w => w.analytics],
      ['#home', load('#home'), w => w.analytics],
      ['a saved #<client> address (it is a client\'s own Analytics page, not the overview)', load(CLIENT_HASH), w => w.clientPage],
    ]) {
      console.log('--- shown: ' + label + ' ---');
      const { t, log } = await run(browser, origin, { analytics: 'shown' }, go);
      const w = await where(t.page);
      expect(ok(w), label + ': Analytics still opens (' + JSON.stringify(w) + ')');
      expect(analyticsFrames(log).length > 0, label + ': the test can see Analytics when it is shown (control)');
      expect(await t.page.locator('#navHome').isVisible(), label + ': the Analytics tab is in the staff bar');
      await t.ctx.close();
    }
    console.log('--- shown: a bare visit keeps its default landing ---');
    {
      const { t } = await run(browser, origin, { analytics: 'shown' }, load(''));
      const w = await where(t.page);
      expect(w.today && !w.analytics, 'a bare visit still opens Today, not the Calendar (' + JSON.stringify(w) + ')');
      await t.ctx.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nstaff-analytics-hidden-routing-browser: all passed');
})();
