'use strict';
/* messages-badge-boot-browser.js -- the header Messages button's unread badge (owner report, 2026-10-23).
 * Fully mocked (lost-work-lib.js and a local answer for production-comments' `inbox`). Fictional data only.
 *   A  the badge shows from page load on the Calendar, without the pointer ever reaching the Messages button
 *   B  the badge sits on the button's corner: the speech-bubble icon does not move when it appears, the
 *      button keeps its size, and the count stays readable, in light and dark, at desktop and phone widths
 *   C  the Production tab still makes no inbox call it was not asked for
 *   D  a first read that fails (503) is tried again by itself and the badge appears without a click
 *   E  a first read refused with 403 is not tried again
 *   F  the automatic read is a GET (every page treats a POST it did not ask for as a write), and the Time Off
 *      page makes none
 * With SCREENSHOTS=<dir>, the header at 1440 is captured there in light and dark.
 */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };
const SHOTS = process.env.SCREENSHOTS || '';

(async () => {
  const S = await createEnv();
  let inboxCalls = 0;
  let unread = 0;
  let failNext = [];
  const inboxMethods = [];   // statuses to answer the next inbox calls with, in order, before answering normally
  try {
    await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (route.request().method() === 'GET') body = { action: new URL(route.request().url()).searchParams.get('action') || '' };   // the inbox list is read with GET ?action=inbox
      if (route.request().method() === 'OPTIONS' || body.action !== 'inbox') return route.fallback();
      inboxCalls++;
      inboxMethods.push(route.request().method());
      const fail = failNext.shift();
      if (fail) return route.fulfill({ status: fail, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'fixture_' + fail }) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, scope: 'all', conversations: [
        { post_id: 'p_new', client_slug: 'fixtureclient', client_name: 'Fixture Client', title: 'Fixture reel', thumbnail_url: '', asset_url: '', status: 'In Progress',
          last_at: '2026-10-23T09:00:00.000Z', last_author: 'Fixture Client', last_author_member_id: '', last_role: 'client', last_body: 'Can we cut the intro?', unread },
      ] }) });
    });
    const badge = pg => pg.evaluate(() => {
      const btn = document.getElementById('navMessages');
      const el = btn && btn.querySelector('[data-msg-count]');
      const ico = btn && btn.querySelector('svg');
      const b = btn && btn.getBoundingClientRect(), i = ico && ico.getBoundingClientRect(), e = el && el.getBoundingClientRect();
      return { shown: !!(el && !el.hidden && e.width > 0), text: el ? el.textContent : '', btnHidden: !btn || btn.hidden,
        btn: b && { w: Math.round(b.width), h: Math.round(b.height) },
        icoCenter: i && b ? Math.round((i.left + i.width / 2) - (b.left + b.width / 2)) : null,
        badge: e && { w: Math.round(e.width), h: Math.round(e.height), right: Math.round(e.right - b.right), top: Math.round(e.top - b.top) },
        fg: el ? getComputedStyle(el).color : '', bg: el ? getComputedStyle(el).backgroundColor : '' };
    });

    // A: page load on the Calendar, the pointer kept away from the header
    unread = 3;
    const page = await S.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await S.openCalendar(page);
    await page.mouse.move(700, 700);
    check(await until(async () => (await badge(page)).shown, 10000), 'A: the Messages badge shows from page load, no hover or click (inbox calls: ' + inboxCalls + ')');
    let s = await badge(page);
    check(s.text === '1', 'A: it counts the conversation with something new (' + s.text + ')');

    // B: the icon stays centred and the button keeps its size
    // (Measured on its own, so it holds even while A fails: the count is put there by hand.)
    const setBadge = (text, hidden) => page.evaluate(([t, h]) => { const el = document.querySelector('#navMessages [data-msg-count]'); el.textContent = t; el.hidden = h; }, [text, hidden]);
    await setBadge('3', true);
    const without = await badge(page);
    await setBadge('3', false);
    const withBadge = await badge(page);
    check(withBadge.icoCenter === without.icoCenter && Math.abs(withBadge.icoCenter) <= 1, 'B: the icon does not move when the badge appears (offset from centre ' + without.icoCenter + ' -> ' + withBadge.icoCenter + ' px)');
    check(withBadge.btn.w === without.btn.w && withBadge.btn.h === without.btn.h, 'B: the button keeps its size (' + JSON.stringify(without.btn) + ' -> ' + JSON.stringify(withBadge.btn) + ')');
    check(withBadge.badge && withBadge.badge.top <= 0 && withBadge.badge.right >= 0, 'B: the badge sits on the top-right corner (' + JSON.stringify(withBadge.badge) + ')');
    for (const t of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), t);
      await sleep(200);
      const x = await badge(page);
      check(x.fg !== x.bg && x.shown, 'B: the badge is visible in ' + t + ' (' + x.fg + ' on ' + x.bg + ')');
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const box = await page.evaluate(() => { const r = document.getElementById('navMessages').getBoundingClientRect(); return { x: r.left - 140, y: Math.max(0, r.top - 12), width: 300, height: r.height + 24 }; });
        await page.screenshot({ path: path.join(SHOTS, 'messages-badge-header-' + t + '.png'), clip: box });
      }
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    // A count of two digits still keeps the icon where it is
    await setBadge('12', false);
    s = await badge(page);
    check(s.icoCenter === without.icoCenter, 'B: a two-digit count does not move the icon either (' + s.icoCenter + ')');

    // C: the Production tab makes no inbox call on its own
    const callsBefore = inboxCalls;
    const prod = await S.newPage();
    await prod.setViewportSize({ width: 1440, height: 900 });
    await S.openProduction(prod);
    await sleep(2500);
    check(inboxCalls === callsBefore, 'C: the Production tab makes no inbox call it was not asked for (' + (inboxCalls - callsBefore) + ')');

    // D: the first automatic read answers 503; the retry brings the badge, no hover or click
    {
      failNext = [503];
      const n0 = inboxCalls;
      const pg = await S.newPage();
      await pg.setViewportSize({ width: 1440, height: 900 });
      await S.openCalendar(pg);
      await pg.mouse.move(700, 700);
      check(await until(async () => (await badge(pg)).shown, 15000), 'D: after a failed first read (503) the badge still appears without a click (calls: ' + (inboxCalls - n0) + ')');
      check(inboxCalls - n0 === 2, 'D: one failed read, then one retry that worked (' + (inboxCalls - n0) + ')');
      await sleep(3500);
      check(inboxCalls - n0 === 2, 'D: no further boot retries once it worked (' + (inboxCalls - n0) + ')');
      await pg.close();
    }
    // E: refused (403): no retry
    {
      failNext = [403, 403, 403, 403];
      const n0 = inboxCalls;
      const pg = await S.newPage();
      await pg.setViewportSize({ width: 1440, height: 900 });
      await S.openCalendar(pg);
      await pg.mouse.move(700, 700);
      check(await until(() => inboxCalls > n0, 8000), 'E: the first automatic read is made');
      await sleep(5000);
      check(inboxCalls - n0 === 1, 'E: a 403 is not tried again (' + (inboxCalls - n0) + ')');
      failNext = [];
      await pg.close();
    }

    // F: GET only, and nothing on the Time Off page
    check(inboxMethods.length > 0 && inboxMethods.every(m => m === 'GET'), 'F: every automatic inbox read was a GET (' + [...new Set(inboxMethods)].join(',') + ')');
    {
      const pg = await S.newPage();
      await pg.setViewportSize({ width: 1440, height: 900 });
      // Time Off is on for this page (as pto-ui-polish's fixture answers the pto_v1 switch), so it stays there.
      await pg.route('**/rest/v1/syncview_runtime_flags*', r => /pto_v1/.test(r.request().url())
        ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ value: { mode: 'on' } }]) })
        : r.fallback());
      await pg.goto(S.origin + '/index.html#time-off', { waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => typeof navTo === 'function' && typeof _syncviewStaffCan === 'function', null, { timeout: 30000 });
      await pg.evaluate(() => { _syncviewStaffIdentityVerified = true; try { _ptoSetFlagValue({ mode: 'on' }); } catch (e) {} navTo('time-off', false); });
      const onTimeOff = await pg.evaluate(() => currentNav);
      // (This fixture turns Time Off on only after load, so the page passed through Home first: count from here,
      // and only this page's own requests: the first page is still open and refreshes on its own.)
      await sleep(300);
      let mine = 0;
      pg.on('request', r => { if (/\/functions\/v1\/production-comments/.test(r.url()) && r.method() !== 'OPTIONS') mine++; });
      await sleep(4000);
      check(onTimeOff !== 'time-off' || mine === 0, 'F: while on the Time Off page no inbox read starts (' + onTimeOff + ', ' + mine + ')');
      const stillOn = await pg.evaluate(() => currentNav);
      check(onTimeOff === 'time-off' && stillOn === 'time-off', 'F: the page really was on Time Off the whole time (' + onTimeOff + ' -> ' + stillOn + ')');
      await pg.close();
    }

    check(page.errors.length === 0, 'no page errors ' + JSON.stringify(page.errors));
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.log('FAIL  crashed: ' + (e && e.stack || e));
  } finally {
    await S.close();
  }
  if (failures.length) { console.log('\nmessages-badge-boot-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nmessages-badge-boot-browser: all checks passed');
})();
