'use strict';

/*
 * TODAY OPENS IN NEW TABS, AND SYNCLINEAR OFFERS "BACK TO CARD".
 *
 * 1. Today: "Open card" and "SyncLinear" always open a new tab. Open card goes
 *    to the exact Calendar card, using the address Today already builds
 *    (#calendar/<slug>/<card>).
 * 2. A SyncLinear tab opened from a card carries from=, card= and cslug= in its
 *    address, shows a "Back to card" button, keeps it after a reload, and the
 *    button lands on that card. Opened any other way: no button.
 *
 * Invented names only; the network is refused by the harness. Set
 * BACKCARD_SHOTS=<dir> to also save light, dark and 390px screenshots.
 * Run: node docs/syncview-design/tests/back-to-card-browser.js
 */

const fs = require('fs');
const path = require('path');
const { launchWorkloadHarness } = require('./workload-harness-lib.js');

let failures = 0;
function expect(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL back-to-card-browser: ' + message); }
}

(async () => {
  const h = await launchWorkloadHarness({ issues: [] });
  const shots = process.env.BACKCARD_SHOTS || '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    const { page, context } = h;
    const base = page.url().split('/').slice(0, 3).join('/');
    await page.waitForFunction(() => typeof window._tdyOpenCard === 'function' && typeof window.renderTodayView === 'function', null, { timeout: 15000 });

    /* ---- Today: both buttons open a new tab ---- */
    const today = await page.evaluate(() => {
      const iso = n => _tdyIso(_tdyDays(n));
      const slug = calClientSlug('Client A');
      const data = {
        names: { 'client-a': 'Client A' }, notListed: false, done: [], urgent: [],
        open: [
          { id: 'w1', client_slug: 'client-a', card_id: 'card-w1', title: 'Item one', status: 'smm_approval', status_at: new Date().toISOString(), due_date: iso(3), origin: 'calendar' },
          { id: 'w2', client_slug: 'client-a', card_id: null, title: 'Item two', status: 'smm_approval', status_at: new Date().toISOString(), due_date: iso(3), origin: 'production' },
        ],
        posts: [{ id: 'p1', client: 'client-a', name: 'Post one', scheduled_date: iso(2), status: 'Draft', video_deliverable_id: 'v1', graphic_deliverable_id: null }],
      };
      const who = _tdyWho(_tdyIdentity());
      _tdyCacheWrite(who, data);
      renderTodayView();
      const calls = [];
      window.open = (url, target, features) => { calls.push({ url: String(url), target, features }); return null; };
      const before = location.href;
      _tdyOpenCard('post', 'p1');
      _tdyOpenCard('del', 'w1');
      _tdyOpenCard('del', 'w2');
      _tdyOpenSync('v1', 'p1', 'client-a');
      _tdyOpenSync('w2');
      navTo('calendar');
      _tdyCardInAddress('client-a', 'p1');
      const address = location.pathname + location.hash;
      return { calls, same: before === location.href, slug, address, hasData: !!who };
    });
    expect(today.hasData, 'the harness has a staff identity for Today');
    expect(today.calls.length === 5 && today.calls.every(c => c.target === '_blank'), 'every Today button opens a new tab (' + today.calls.length + ' opened)');
    const wantCard = '#calendar/' + today.slug + '/p1';
    expect(today.address.endsWith('/' + today.slug + '/p1'), 'the address Today builds for a card names the client and the card (' + today.address + ')');
    expect(today.calls[0].url.endsWith(wantCard), 'Open card on a post opens that exact card: ' + today.calls[0].url);
    expect(today.calls[1].url.endsWith('#calendar/' + today.slug + '/card-w1'), 'Open card on a work item opens its card');
    expect(today.calls[2].url.endsWith('#calendar/' + today.slug), 'a work item with no card opens the client in a new tab');
    expect(/from=calendar/.test(today.calls[3].url) && /card=p1/.test(today.calls[3].url) && new RegExp('cslug=' + today.slug).test(today.calls[3].url),
      'SyncLinear from a card row carries from, card and cslug: ' + today.calls[3].url);
    expect(!/from=/.test(today.calls[4].url), 'SyncLinear from a row with no card carries no origin');
    await page.goto(base + '/#today'); // leave the calendar before the next checks

    /* ---- the SyncLinear tab ---- */
    const open = async (query, theme, width) => {
      const tab = await context.newPage();
      if (width) await tab.setViewportSize({ width, height: 900 });
      await tab.goto(base + '/?prod=1&d=deliv-1' + query + '#production');
      await tab.waitForSelector('.prod-topbar', { timeout: 15000 });
      if (theme) await tab.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      return tab;
    };
    const slug = today.slug;
    const calOrigin = '&from=calendar&card=card-77&cslug=' + slug;

    const plain = await open('');
    expect(await plain.locator('.prod-back-card').count() === 0, 'no Back to card when SyncLinear is opened normally');
    await plain.close();

    const from = await open(calOrigin);
    const btn = from.locator('.prod-back-card:visible');
    expect(await btn.count() === 1 && /Back to card/.test(await btn.innerText()), 'Back to card shows when opened from a Calendar card');
    expect(/^\/synclinear\/deliv-1/.test(await from.evaluate(() => location.pathname)), 'the tab sits at the clean SyncLinear address');
    // The local file server has no clean paths (the host's 404 page bounces them
    // to the app document), so a reload here is the same address in its app form.
    await from.goto(base + await from.evaluate(() => svRoute.fast(location.pathname + location.search)));
    await from.waitForSelector('.prod-topbar', { timeout: 15000 });
    expect(await from.locator('.prod-back-card:visible').count() === 1, 'the button survives a reload');
    expect(/from=calendar/.test(await from.evaluate(() => location.search)), 'the origin is in the address after the reload');

    /* where it sits: top of the left sidebar, above My issues, beside Search; not in the top bar */
    const spot = await from.evaluate(() => {
      const b = document.querySelector('.prod-side .prod-back-card');
      const r = el => { const q = el && el.getBoundingClientRect(); return q ? { x: q.x, y: q.y, w: q.width, h: q.height } : null; };
      const nav = Array.from(document.querySelectorAll('.prod-side .prod-nav-btn')).find(x => /My issues/.test(x.textContent));
      return {
        inSide: !!b, inTopbar: !!document.querySelector('.prod-topbar .prod-back-card'),
        btn: r(b), search: r(document.querySelector('.prod-side .prod-search-btn')), mine: r(nav),
        bg: b ? getComputedStyle(b).backgroundColor : '', fg: b ? getComputedStyle(b).color : '',
      };
    });
    expect(spot.inSide && !spot.inTopbar, 'the button is in the left sidebar and not in the top bar');
    expect(spot.btn && spot.search && spot.mine && spot.btn.y < spot.mine.y && spot.btn.x < spot.search.x && Math.abs(spot.btn.y - spot.search.y) < 20,
      'it sits above My issues and beside the search icon');
    expect(spot.btn.h >= 34 && spot.btn.w >= 120, 'it is a real button, not a small chip (' + Math.round(spot.btn.w) + 'x' + Math.round(spot.btn.h) + ')');
    expect(spot.bg !== 'rgba(0, 0, 0, 0)' && spot.bg !== 'rgb(255, 255, 255)' && spot.fg === 'rgb(255, 255, 255)', 'it is filled with the accent colour with white text (' + spot.bg + ')');

    /* a phone: the sidebar is hidden, so the button leads the page, full width, clipping nothing */
    const phone = await open(calOrigin, 'light', 390);
    const ph = await phone.evaluate(() => {
      const b = document.querySelector('.prod-back-strip .prod-back-card');
      const q = b && b.getBoundingClientRect();
      const top = document.querySelector('.prod-topbar');
      return { shown: !!b && b.getClientRects().length > 0, x: q && q.x, w: q && q.width, h: q && q.height, y: q && q.y,
        topY: top && top.getBoundingClientRect().y, vw: window.innerWidth, scroll: document.documentElement.scrollWidth,
        visibleCount: Array.from(document.querySelectorAll('.prod-back-card')).filter(x => x.getClientRects().length).length };
    });
    expect(ph.shown && ph.visibleCount === 1, 'on a phone exactly one Back to card shows, in the strip');
    expect(ph.x >= 0 && ph.x + ph.w <= ph.vw && ph.scroll <= ph.vw + 1, 'and it fits inside the screen');
    expect(ph.h >= 44 && ph.y < ph.topY, 'it is at least 44px tall and sits above the header');
    await phone.close();

    /* the button lands on the right card */
    await Promise.all([from.waitForURL(/\/calendar\//, { timeout: 15000 }), from.locator('.prod-back-card:visible').click()]);
    await from.waitForTimeout(1500);
    const landed = await from.evaluate(() => ({ path: location.pathname, nav: currentNav, slug: calClientSlug(calState.client || '') }));
    expect(landed.path === '/calendar/' + slug + '/card-77', 'Back to card lands on that card: ' + landed.path);
    expect(landed.nav === 'calendar', 'the Calendar is what opened');
    expect(landed.slug === slug, 'the client is chosen');
    await from.close();

    const samples = await open('&from=samples&card=card-5&cslug=' + slug);
    expect(await samples.locator('.prod-back-card:visible[data-prod-back-from="samples"]').count() === 1, 'a Samples origin also shows the button');
    expect(await samples.evaluate(() => svRoute.fromCard().href) === '/#sample-reviews/' + slug + '/card-5', 'and goes to the sample card');
    await samples.close();

    const half = await open('&from=calendar&card=card-77');
    expect(await half.locator('.prod-back-card').count() === 0, 'an origin with no client shows no button');
    await half.close();

    /* the links that open SyncLinear from a card carry the origin */
    const links = await page.evaluate(() => svRoute.cardOrigin('calendar', 'client-a', 'card id'));
    expect(links === '&from=calendar&card=card%20id&cslug=client-a', 'cardOrigin builds the parameters: ' + links);
    expect(await page.evaluate(() => svRoute.cardOrigin('calendar', '', 'x') === '' && svRoute.cardOrigin('other', 'a', 'x') === ''), 'cardOrigin gives nothing without a client or with an unknown origin');

    /* ---- screenshots ---- */
    if (shots) {
      for (const [width, theme] of [[1100, 'light'], [1100, 'dark'], [390, 'light'], [390, 'dark']]) {
        const tab = await open(calOrigin, theme, width);
        await tab.waitForTimeout(500);
        await tab.screenshot({ path: path.join(shots, `back-to-card-${width}-${theme}.png`) });
        const overflow = await tab.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        expect(!overflow, `no sideways scroll at ${width}px ${theme}`);
        await tab.close();
      }
    }
  } finally { await h.close(); }

  if (failures) { console.error(`\nback-to-card-browser: ${failures} check(s) failed`); process.exit(1); }
  console.log('\nback-to-card-browser: all checks passed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
