'use strict';
// A background refresh must never move what the user is looking at.
// Fictional client and posts, fully offline: every request is answered by the
// shared fixture.
//
// Part 1, a card lands ahead of the view: the refresh returns one new post
// ahead of the rest, the way a teammate's new card lands, and the card that
// was in view must stay put on every Calendar view, on a desktop and a phone
// screen. Before #2029 the Sheet kept the same scrollLeft and so showed the
// board one card further on.
//
// Part 2, the card in view itself moves: a teammate reschedules, reorders or
// schedules the card at the edge of the view, or the first day in view folds
// away on a phone. The board must not chase that one card to its new place;
// the cards around it stay where they were. #2029 followed a single card, so
// this jumped by many cards (Month 0 -> 852px, Sheet about 18 cards, Review
// and the client link by a screen or more) and a folded phone day pushed the
// page by twice its offset.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const CLIENT = 'Phone Fixture Client';
const TOKEN = 'synthetic-phone-token';
const VIEWS = ['smmreview', 'organizer', 'month', 'week'];
const SCREENS = [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]];
const DESKTOP = { width: 1280, height: 800 }, PHONE = { width: 390, height: 844 };
const TOLERANCE = 2;   // sub-pixel rounding only
const KEYS = '#calBody [data-pid], #calBody [data-cal-review-pid], #calBody [data-iso]';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*' };

function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function row(i, key) {
  const d = new Date(); d.setDate(d.getDate() + (i % 7) - 3);
  return { ...BASE_ROW, id: 'p_scroll_fixture_' + key, name: 'Scroll fixture post ' + key, order_index: i + 1, scheduled_date: isoOf(d),
    status: 'For SMM Approval', video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', caption_status: 'For SMM Approval' };
}

async function screen(browser, origin, [label, viewport, mobile]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_scroll_fixture_unused' }, [], 'calendar');
  await seedStaffGate(ctx);
  let withNewPost = false;
  await ctx.route('**/rest/v1/calendar_posts*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const rows = []; let i = 0;
    if (withNewPost) rows.push(row(i++, 'new'));
    for (let k = 0; k < 30; k++) rows.push(row(i++, k));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows), headers: CORS });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navTo === 'function');
  await page.evaluate(() => navTo('calendar'));
  await page.locator('#calView').waitFor();
  const results = [];
  for (const view of VIEWS) {
    withNewPost = false;
    await page.evaluate(async ({ view, client }) => {
      _calInvalidateActiveLoad();
      Object.assign(calState, { loading: false, error: '', client, posts: [], view, monthFilter: 'all', statusFilter: 'all' });
      _calSavePins([client]);
      _calRenderShell();
      await loadCalendarPosts({ skipCache: true });
      await new Promise(r => setTimeout(r, 400));
      const strip = document.getElementById('calStrip');
      if (strip && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = 2000;
      window.scrollTo(0, 900);
      await new Promise(r => setTimeout(r, 250));
    }, { view, client: CLIENT });
    const before = await page.evaluate(sel => {
      const strip = document.getElementById('calStrip');
      const sideways = !!(strip && strip.scrollWidth > strip.clientWidth);
      const box = sideways ? strip.getBoundingClientRect() : { left: 0, top: 0 };
      const el = [...document.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > box.left + 1 && r.bottom > box.top + 1 && r.top < innerHeight; });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { key: el.getAttribute('data-pid') || el.getAttribute('data-cal-review-pid') || el.getAttribute('data-iso'), x: r.left, y: r.top, sideways };
    }, KEYS);
    assert(before, label + ' ' + view + ': nothing in view to measure');
    withNewPost = true;
    // The same road a realtime change, the fallback poll and a tab return take.
    await page.evaluate(() => loadCalendarPosts({ background: true }));
    await page.waitForTimeout(500);
    const after = await page.evaluate(({ key, sel }) => {
      const el = [...document.querySelectorAll(sel)].find(e => (e.getAttribute('data-pid') || e.getAttribute('data-cal-review-pid') || e.getAttribute('data-iso')) === key);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, posts: calState.posts.length };
    }, { key: before.key, sel: KEYS });
    assert(after, label + ' ' + view + ': the card in view disappeared');
    assert.equal(after.posts, 31, label + ' ' + view + ': the refresh did not bring the new post');
    const dx = Math.round(after.x - before.x), dy = Math.round(after.y - before.y);
    results.push(label + ' ' + view + (before.sideways ? ' (sideways strip)' : '') + ': moved ' + dx + ',' + dy);
    assert(Math.abs(dx) <= TOLERANCE && Math.abs(dy) <= TOLERANCE,
      label + ' ' + view + ': a background refresh moved the card in view by ' + dx + 'px across and ' + dy + 'px down');
    if (view === 'organizer' && label === 'desktop') assert(before.sideways, 'desktop Sheet fixture never scrolled sideways');
  }
  assert.deepEqual(errors, [], label + ': page errors ' + errors.join(' | '));
  await ctx.close();
  return results;
}

// ---- Part 2: the card in view itself moves --------------------------------

const NOW = new Date();
const Y = NOW.getFullYear(), M = NOW.getMonth() + 1;
function day(d) { return Y + '-' + String(M).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
// Teammate's change: a later updated_at, so the refresh takes the new values.
const LATER = '2026-10-10T12:00:00.000Z';
function post(id, date, extra) {
  return { ...BASE_ROW, id, name: 'Moved anchor fixture ' + id, order_index: 1, scheduled_date: date,
    status: 'For SMM Approval', video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', caption_status: 'For SMM Approval', ...(extra || {}) };
}
function moved(extra) { return { updated_at: LATER, ...extra }; }

async function openCase(browser, origin, { viewport, mobile, client }, rowsFn) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_moved_fixture_unused' }, [], 'calendar');
  if (!client) await seedStaffGate(ctx);
  const state = { phase: 0 };
  await ctx.route('**/rest/v1/calendar_posts*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rowsFn(state.phase)), headers: CORS });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (client) {
    // The client's review link, the way a client opens it.
    const q = new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' });
    await page.goto(origin + '/index.html?' + q, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#calBody .kcard[data-cal-review-pid]', { timeout: 20000 });
    await page.waitForTimeout(800);
    assert(await page.evaluate(() => document.documentElement.classList.contains('boot-client')), 'client link did not boot as the client');
  } else {
    await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof navTo === 'function');
    await page.evaluate(() => navTo('calendar'));
    await page.locator('#calView').waitFor();
  }
  return { ctx, page, state, errors };
}

async function showView(page, view) {
  await page.evaluate(async ({ view, client }) => {
    _calInvalidateActiveLoad();
    Object.assign(calState, { loading: false, error: '', client, posts: [], view, monthFilter: 'all', statusFilter: 'all', sortMode: 'manual' });
    _calSavePins([client]);
    _calRenderShell();
    await loadCalendarPosts({ skipCache: true });
    await new Promise(r => setTimeout(r, 400));
  }, { view, client: CLIENT });
}

// Every outermost card, pill or day in view (of the sideways strip when one
// scrolls, otherwise of the screen), in page order, with where it sits.
function inView(page, strip) {
  return page.evaluate(strip => {
    const ANY = '[data-pid],[data-cal-review-pid],[data-iso],[data-cal-move]';
    const body = document.getElementById('calBody');
    const s = strip ? document.getElementById('calStrip') : null;
    const r0 = s ? s.getBoundingClientRect() : null;
    const box = s ? { left: r0.left, top: r0.top, right: r0.left + s.clientWidth, bottom: Math.min(r0.top + s.clientHeight, innerHeight) }
                  : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const keyOf = e => { for (const a of ['data-pid', 'data-cal-review-pid', 'data-iso', 'data-cal-move']) if (e.hasAttribute(a)) return a + '=' + e.getAttribute(a); return ''; };
    const items = [];
    for (const e of body.querySelectorAll(ANY)) {
      const outer = e.parentElement && e.parentElement.closest(ANY);
      if (outer && body.contains(outer)) continue;
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right <= box.left + 1 || r.bottom <= box.top + 1 || r.left >= box.right || r.top >= box.bottom) continue;
      items.push({ key: keyOf(e), x: r.left, y: r.top });
    }
    return { scrollY: window.scrollY, scrollLeft: s ? s.scrollLeft : 0, items };
  }, !!strip);
}

// Where those same items sit now; null for one that is gone or folded away.
function whereNow(page, keys) {
  return page.evaluate(keys => keys.map(k => {
    const i = k.indexOf('='), attr = k.slice(0, i), v = k.slice(i + 1);
    const e = [...document.querySelectorAll('#calBody [' + attr + ']')].find(x => x.getAttribute(attr) === v);
    if (!e || !e.getClientRects().length) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }), keys);
}

async function refresh(page, state) {
  state.phase = 1;
  // The same road a realtime change, the fallback poll and a tab return take.
  await page.evaluate(() => loadCalendarPosts({ background: true }));
  await page.waitForTimeout(700);
}

// The cards (or days) that were in view, other than the one that moved, must
// still be exactly where they were.
async function assertOthersStill(page, label, before, movedKey, minimum) {
  const others = before.items.filter(it => it.key !== movedKey);
  const now = await whereNow(page, others.map(it => it.key));
  const shifts = [];
  others.forEach((it, i) => { if (now[i]) shifts.push({ key: it.key, dx: Math.round(now[i].x - it.x), dy: Math.round(now[i].y - it.y) }); });
  assert(shifts.length >= minimum, label + ': only ' + shifts.length + ' other items left in view to measure');
  const worst = shifts.reduce((w, s) => Math.max(w, Math.abs(s.dx), Math.abs(s.dy)), 0);
  const bad = shifts.find(s => Math.abs(s.dx) > TOLERANCE || Math.abs(s.dy) > TOLERANCE);
  assert(!bad, label + ': the board followed the moved card; ' + (bad && bad.key) + ' moved by ' + (bad && bad.dx) + 'px across and ' + (bad && bad.dy) + 'px down');
  return shifts.length + ' items held (worst ' + worst + 'px)';
}

const MOVED_CASES = [
  // (a) Desktop Month at the top of the page: a teammate schedules the first
  // Unscheduled tray post onto a day of the shown month.
  ['desktop Month, first tray post gets scheduled', { viewport: DESKTOP, mobile: false }, phase => {
    const out = [];
    for (let k = 0; k < 20; k++) out.push(post('p_moved_m' + String(k).padStart(2, '0'), day(1 + k), { order_index: k + 1 }));
    for (let k = 0; k < 5; k++) out.push(post('p_moved_u' + k, phase && !k ? day(24) : null, { order_index: 50 + k, ...(phase && !k ? moved() : {}) }));
    return out;
  }, async (page, state, label) => {
    await showView(page, 'month');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    const header = () => page.evaluate(() => document.querySelector('#calBody .cal-month-header').getBoundingClientRect().top);
    const before = await inView(page, false), headerBefore = await header();
    assert.equal(before.items[0] && before.items[0].key, 'data-cal-move=p_moved_u0', label + ': fixture did not put the first tray post first in view');
    await refresh(page, state);
    const after = await inView(page, false), headerAfter = await header();
    assert(await page.evaluate(() => !!document.querySelector('#calBody .cal-month-cell [data-cal-move="p_moved_u0"]')), label + ': the tray post never landed on its day');
    const dScroll = Math.round(after.scrollY - before.scrollY), dHeader = Math.round(headerAfter - headerBefore);
    assert(Math.abs(dScroll) <= TOLERANCE && Math.abs(dHeader) <= TOLERANCE,
      label + ': the page followed the scheduled post; scrollY ' + Math.round(before.scrollY) + ' -> ' + Math.round(after.scrollY) + ', month header moved ' + dHeader + 'px');
    const days = before.items.filter(it => it.key.startsWith('data-iso=')).slice(0, 7);
    return 'scrollY ' + Math.round(before.scrollY) + ' -> ' + Math.round(after.scrollY) + ', ' + await assertOthersStill(page, label, { items: days }, null, 7);
  }],
  // (b) Desktop Sheet: the first card in the sideways strip is dragged to the
  // end by a teammate.
  ['desktop Sheet, first card in view moves to the end', { viewport: DESKTOP, mobile: false }, phase => {
    const out = [];
    for (let k = 0; k < 30; k++) out.push(post('p_moved_s' + String(k).padStart(2, '0'), day(1 + (k % 28)), { order_index: phase && k === 10 ? 99 : k + 1, ...(phase && k === 10 ? moved() : {}) }));
    return out;
  }, async (page, state, label) => {
    await showView(page, 'organizer');
    await page.evaluate(() => {
      const strip = document.getElementById('calStrip');
      const card = strip.querySelector('.cal-card[data-pid="p_moved_s10"]');
      strip.scrollLeft += card.getBoundingClientRect().left - strip.getBoundingClientRect().left + 40;   // card 10 partly in view at the left
    });
    await page.waitForTimeout(250);
    const before = await inView(page, true);
    assert(before.scrollLeft > 0, label + ': fixture strip never scrolled sideways');
    assert.equal(before.items[0] && before.items[0].key, 'data-pid=p_moved_s10', label + ': fixture did not put card 10 first in view');
    await refresh(page, state);
    const after = await inView(page, true);
    return 'scrollLeft ' + Math.round(before.scrollLeft) + ' -> ' + Math.round(after.scrollLeft) + ', ' + await assertOthersStill(page, label, before, 'data-pid=p_moved_s10', 2);
  }],
  // (c) Desktop SMM Review: the first card in view is rescheduled later.
  ['desktop SMM Review, first card in view rescheduled later', { viewport: DESKTOP, mobile: false }, phase => {
    const out = [];
    for (let k = 0; k < 20; k++) out.push(post('p_moved_r' + String(k).padStart(2, '0'), phase && k === 6 ? day(27) : day(1 + k), { order_index: k + 1, ...(phase && k === 6 ? moved() : {}) }));
    return out;
  }, async (page, state, label) => {
    await showView(page, 'smmreview');
    await page.evaluate(() => {
      const card = document.querySelector('#calBody .kcard[data-cal-review-pid="p_moved_r06"]');
      window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top + 20);
    });
    await page.waitForTimeout(250);
    const before = await inView(page, false);
    assert.equal(before.items[0] && before.items[0].key, 'data-cal-review-pid=p_moved_r06', label + ': fixture did not put card 06 first in view');
    await refresh(page, state);
    const after = await inView(page, false);
    return 'scrollY ' + Math.round(before.scrollY) + ' -> ' + Math.round(after.scrollY) + ', ' + await assertOthersStill(page, label, before, 'data-cal-review-pid=p_moved_r06', 3);
  }],
  // (d) The client's review link on a phone: the first card in view is
  // rescheduled later.
  ['client link phone Review, first card in view rescheduled later', { viewport: PHONE, mobile: true, client: true }, phase => {
    const out = [];
    for (let k = 0; k < 12; k++) out.push(post('p_moved_c' + String(k).padStart(2, '0'), phase && k === 4 ? day(28) : day(1 + k), {
      order_index: k + 1, status: 'Client Approval', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
      ...(phase && k === 4 ? moved() : {}) }));
    return out;
  }, async (page, state, label) => {
    await page.evaluate(() => {
      const card = document.querySelector('#calBody .kcard[data-cal-review-pid="p_moved_c04"]');
      window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top + 20);
    });
    await page.waitForTimeout(250);
    const before = await inView(page, false);
    assert.equal(before.items[0] && before.items[0].key, 'data-cal-review-pid=p_moved_c04', label + ': fixture did not put card 04 first in view');
    await refresh(page, state);
    const after = await inView(page, false);
    return 'scrollY ' + Math.round(before.scrollY) + ' -> ' + Math.round(after.scrollY) + ', ' + await assertOthersStill(page, label, before, 'data-cal-review-pid=p_moved_c04', 2);
  }],
  // (e) Phone Month: the first day in view loses its only post (archived by
  // a teammate). The day before it is empty, so it folds into the "Nothing
  // scheduled" run and has no box left to measure.
  ['phone Month, first day in view folds away', { viewport: PHONE, mobile: true }, phase => {
    const out = []; let k = 0;
    for (let d = 1; d <= 28; d++) {
      if (d === 13 || (d === 14 && phase)) continue;
      out.push(post('p_moved_d' + d, day(d), { order_index: ++k }));
    }
    return out;
  }, async (page, state, label) => {
    await showView(page, 'month');
    const fold = day(14);
    await page.evaluate(fold => {
      const t = document.querySelector('#calBody [data-iso="' + fold + '"]');
      window.scrollTo(0, window.scrollY + t.getBoundingClientRect().top + 30);   // its top 30px above the screen
    }, fold);
    await page.waitForTimeout(250);
    const before = await inView(page, false);
    assert.equal(before.items[0] && before.items[0].key, 'data-iso=' + fold, label + ': fixture did not put the 14th first in view');
    await refresh(page, state);
    const after = await inView(page, false);
    assert(await page.evaluate(fold => !document.querySelector('#calBody [data-iso="' + fold + '"]').getClientRects().length, fold), label + ': the 14th never folded away');
    return 'scrollY ' + Math.round(before.scrollY) + ' -> ' + Math.round(after.scrollY) + ', ' + await assertOthersStill(page, label, before, 'data-iso=' + fold, 3);
  }],
];

async function movedCase(browser, origin, [label, opts, rowsFn, drive]) {
  const { ctx, page, state, errors } = await openCase(browser, origin, opts, rowsFn);
  try {
    const line = await drive(page, state, label);
    assert.deepEqual(errors, [], label + ': page errors ' + errors.join(' | '));
    return label + ': ' + line;
  } finally {
    await ctx.close();
  }
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const failures = [];
  let checks = 0;
  try {
    for (const s of SCREENS) {
      checks += VIEWS.length;
      try { (await screen(browser, origin, s)).forEach(line => console.log('  ok  ' + line)); }
      catch (e) { failures.push(e.message); console.log('  FAIL ' + e.message); }
    }
    for (const c of MOVED_CASES) {
      checks += 1;
      try { console.log('  ok  ' + await movedCase(browser, origin, c)); }
      catch (e) { failures.push(e.message); console.log('  FAIL ' + e.message); }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) throw new Error(failures.length + ' failing: ' + failures.join(' || '));
  console.log('calendar-refresh-scroll-browser: PASS (' + checks + ' checks: ' + VIEWS.length * SCREENS.length + ' insertion views, ' + MOVED_CASES.length + ' moved-card cases)');
})().catch(e => { console.error('calendar-refresh-scroll-browser: FAIL ' + (e && e.message)); process.exit(1); });
