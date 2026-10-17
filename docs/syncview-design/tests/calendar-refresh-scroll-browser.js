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
//
// Part 3, what the person is using (owner rule, 2026-10-13): a background
// refresh must never unfocus or reset anything. A long caption is opened with
// Show more and scrolled inside, the strip is scrolled sideways and the
// pointer rests on a card; then each real refresh path runs, one at a time:
// the fallback poll (realtime never connects, the 30 s timer pulls), a
// realtime change from a teammate, a tab return (visibility and focus events)
// and the echo of the person's own save while they type in that caption. After
// each, the caption is still open at the same inner scroll, focus and caret
// are where they were, the person's typed text is kept, an open status menu is
// still open, the strip has not moved and the hovered card is still hovered.
// The Samples Sheet shares the repaint and must keep its strip and focus too.
// Before the fix the first repaint closed the caption and dropped focus to
// the page, and a Samples repaint put its strip back at the start.
//
// Part 4, a background refresh is invisible (owner rule, 2026-10-14): see the
// banner above invisibleRefreshCase.
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
    }, { view, client: CLIENT });
    if(view==='organizer')await require('./staff-phone-browser').openEditableSheet(page);
    await page.evaluate(async () => {
      const strip = document.getElementById('calStrip');
      if (strip && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = 2000;
      const body=document.getElementById('calBody');
      if(body.closest('[data-thumb-collection]'))body.scrollTop=900;else window.scrollTo(0,900);
      await new Promise(r => setTimeout(r, 250));
    });
    const before = await page.evaluate(sel => {
      const strip = document.getElementById('calStrip');
      const sideways = !!(strip && strip.scrollWidth > strip.clientWidth);
      const body=document.getElementById('calBody');
      const box = sideways ? strip.getBoundingClientRect() : body.closest('[data-thumb-collection]')?body.getBoundingClientRect():{left:0,top:0};
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
// The phone Month case folds an empty day into the run before it. Today never
// folds, so keep that pair of days clear of today (it failed on every 13th).
const FOLD = Math.abs(NOW.getDate() - 14) <= 2 ? 21 : 14;
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
    const inner=body.closest('[data-thumb-collection]')?body.getBoundingClientRect():null;
    const box = s ? { left: r0.left, top: r0.top, right: r0.left + s.clientWidth, bottom: Math.min(r0.top + s.clientHeight, innerHeight) }
                  : inner?{left:inner.left,top:inner.top,right:inner.right,bottom:inner.bottom}:{left:0,top:0,right:innerWidth,bottom:innerHeight};
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
      if (d === FOLD - 1 || (d === FOLD && phase)) continue;
      out.push(post('p_moved_d' + d, day(d), { order_index: ++k }));
    }
    return out;
  }, async (page, state, label) => {
    await showView(page, 'month');
    const fold = day(FOLD);
    await page.evaluate(fold => {
      const t = document.querySelector('#calBody [data-iso="' + fold + '"]');
      const body=document.getElementById('calBody');
      if(body.closest('[data-thumb-collection]'))body.scrollTop+=t.getBoundingClientRect().top-body.getBoundingClientRect().top+30;
      else window.scrollTo(0,window.scrollY+t.getBoundingClientRect().top+30);   // its top 30px above the screen
    }, fold);
    await page.waitForTimeout(250);
    const before = await inView(page, false);
    assert.equal(before.items[0] && before.items[0].key, 'data-iso=' + fold, label + ': fixture did not put day ' + FOLD + ' first in view');
    await refresh(page, state);
    const after = await inView(page, false);
    assert(await page.evaluate(fold => !document.querySelector('#calBody [data-iso="' + fold + '"]').getClientRects().length, fold), label + ': day ' + FOLD + ' never folded away');
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

// ---- Part 3: what the person is using survives every refresh path ---------

const LONG_CAPTION = Array.from({ length: 60 }, (_, i) => 'Line ' + (i + 1) + ' of a fictional caption about a lighthouse that keeps lost umbrellas.').join('\n');
// A stand-in for the realtime library: channels never confirm (so the
// fallback poll stays armed) and a test can deliver a change to the
// Calendar's own handler.
const FAKE_SUPABASE_LIB = `window.supabase = { createClient: function () { return {
  channel: function (topic) { var ch = { topic: topic, handlers: [],
    on: function (ev, filter, cb) { ch.handlers.push(cb); return ch; },
    subscribe: function () { (window.__fixtureChannels = window.__fixtureChannels || []).push(ch); return ch; },
    unsubscribe: function () {} }; return ch; },
  removeChannel: function () {} }; } };`;

async function liveUiCase(browser, origin) {
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_live_fixture_unused' }, [], 'calendar');
  await seedStaffGate(ctx);
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE_LIB }));
  // Saving is switched on for the fixture client, so the person's caption
  // really goes out and its echo comes back.
  await ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const key = (new URL(route.request().url()).searchParams.get('key') || '').replace(/^eq\./, '');
    if (!/_clients$/.test(key)) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify([{ key, value: { clients: ['phonefixtureclient'] } }]) });
  });
  const net = { gets: 0, saves: 0 };
  await ctx.route('**/rest/v1/calendar_posts*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    // Only this board's reads count; other surfaces read the same table.
    const n = /[?&]client=eq\./.test(route.request().url()) ? ++net.gets : net.gets;
    const rows = [];
    // Every read brings a teammate's change on card 7, so every refresh repaints.
    for (let k = 0; k < 10; k++) rows.push(post('p_live_' + k, null, { order_index: k + 1, caption: k === 1 ? LONG_CAPTION : 'Short fixture caption.',
      linear_issue_id: 'FIXTURE-' + k, video_deliverable_id: 'fixture-deliverable-' + k, status: 'In Progress', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
      ...(k === 7 ? { name: 'Teammate edit ' + n, updated_at: new Date(Date.UTC(2026, 9, 10, 12, 0, n)).toISOString() } : {}) }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows), headers: CORS });
  });
  const page = await ctx.newPage();
  // The person's own caption save, wherever the page sends it.
  page.on('request', r => { if ((r.method() === 'POST' || r.method() === 'PATCH') && /typed by the person/.test(r.postData() || '')) { if (process.env.LIVE_DEBUG) console.log('WRITE', r.url().slice(0, 120)); net.saves++; } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navTo === 'function');
  await page.evaluate(() => navTo('calendar'));
  await page.locator('#calView').waitFor();
  await showView(page, 'organizer');
  await page.waitForFunction(() => (window.__fixtureChannels || []).some(c => /^cal-/.test(c.topic)), null, { timeout: 15000 });
  const CAP = '#calStrip .cal-card[data-pid="p_live_1"] textarea[data-fld="caption"]';
  const lines = [];

  // Open the long caption with Show more, scroll inside it, slide the strip,
  // rest the pointer on card 3.
  async function arrange() {
    await page.evaluate(() => { const s = document.getElementById('calStrip'); s.scrollLeft = 0; });
    if (!await page.evaluate(sel => document.querySelector(sel).closest('.cal-cap-wrap').classList.contains('expanded'), CAP)) {
      await page.click('#calStrip .cal-card[data-pid="p_live_1"] .cal-cap-toggle');
    }
    await page.evaluate(sel => { document.querySelector(sel).scrollTop = 420; document.getElementById('calStrip').scrollLeft = 150; }, CAP);
    const box = await page.locator('#calStrip .cal-card[data-pid="p_live_3"] .cal-card-title, #calStrip .cal-card[data-pid="p_live_3"]').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.waitForTimeout(300);
  }
  function snap() {
    return page.evaluate(sel => {
      const t = document.querySelector(sel), a = document.activeElement;
      const card = a && a.closest && a.closest('.cal-card');
      const menu = document.querySelector('body > .cal-fld-status-menu');
      return {
        open: t.closest('.cal-cap-wrap').classList.contains('expanded'), capTop: Math.round(t.scrollTop), capH: Math.round(t.clientHeight),
        strip: Math.round(document.getElementById('calStrip').scrollLeft),
        focus: a ? a.tagName + '.' + String(a.className).split(' ')[0] + '@' + (card ? card.getAttribute('data-pid') : '-') : '-',
        caret: a && a.tagName === 'TEXTAREA' ? a.selectionStart + ':' + a.selectionEnd : '', text: t.value.length,
        hovered: !!document.querySelector('#calStrip .cal-card[data-pid="p_live_3"]:hover'),
        menu: !!(menu && menu.isConnected), title7: (document.querySelector('#calStrip .cal-card[data-pid="p_live_7"] [data-fld="name"]') || {}).value || '',
      };
    }, CAP);
  }
  async function check(label, trigger, opts) {
    const before = await snap();
    const gets0 = net.gets;
    await trigger();
    const deadline = Date.now() + (opts && opts.waitMs || 15000);
    while (net.gets === gets0 && Date.now() < deadline) await page.waitForTimeout(250);
    assert(net.gets > gets0, label + ': the refresh never read the board');
    await page.waitForTimeout(1500);
    const after = await snap();
    if (!(opts && opts.deferred)) assert.notEqual(after.title7, before.title7, label + ': the refresh never repainted the board (teammate edit not shown)');
    for (const k of ['open', 'capTop', 'capH', 'strip', 'focus', 'caret', 'text', 'hovered', 'menu']) {
      assert.deepEqual(after[k], before[k], label + ': ' + k + ' changed from ' + JSON.stringify(before[k]) + ' to ' + JSON.stringify(after[k]) + (process.env.LIVE_DEBUG ? JSON.stringify([before, after]) : ''));
    }
    lines.push('Sheet keeps caption, focus, strip, hover across ' + label + ' (caption scroll ' + after.capTop + ', strip ' + after.strip + ', focus ' + after.focus + ')');
  }

  try {
    await arrange();
    const opened = await snap();
    assert(opened.open && opened.capTop > 0 && opened.strip > 0 && opened.hovered, 'fixture did not open, scroll and hover: ' + JSON.stringify(opened));

    // 1. The fallback poll: realtime never confirmed, so the 30 s timer pulls.
    await check('the fallback poll', async () => {}, { waitMs: 36000 });

    // 2. A realtime change from a teammate, through the Calendar's own handler.
    await page.waitForTimeout(2500);   // past the realtime reload floor
    await check('a realtime change', () => page.evaluate(() => {
      const ch = window.__fixtureChannels.filter(c => /^cal-/.test(c.topic)).pop();
      ch.handlers.forEach(cb => cb({ eventType: 'UPDATE', new: { id: 'p_live_7' }, old: { id: 'p_live_7' } }));
    }));

    // 3. A tab return: hidden, then visible and focused again.
    await page.waitForTimeout(4500);   // past the return de-dupe floor
    await check('a tab return', () => page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    }));

    // 4. An open status menu survives a refresh (realtime again).
    // Opened in place (a pointer click would first scroll the page to it).
    await page.evaluate(() => document.querySelector('#calStrip .cal-card[data-pid="p_live_3"] .cal-fld-substatus-trigger').click());
    await page.waitForSelector('body > .cal-fld-status-menu');
    await page.waitForTimeout(2500);
    await check('a realtime change with a status menu open', () => page.evaluate(() => {
      const ch = window.__fixtureChannels.filter(c => /^cal-/.test(c.topic)).pop();
      ch.handlers.forEach(cb => cb({ eventType: 'UPDATE', new: { id: 'p_live_7' } }));
    }), { deferred: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.waitForSelector('body > .cal-fld-status-menu', { state: 'detached', timeout: 3000 }).catch(() => {});

    // 5. The echo of the person's own save while they type in the caption.
    await page.click(CAP);
    await page.evaluate(sel => { const t = document.querySelector(sel); t.setSelectionRange(30, 30); t.scrollTop = 300; }, CAP);
    await page.keyboard.type(' typed by the person');
    const saves0 = net.saves;
    const saveBy = Date.now() + 8000;
    while (net.saves === saves0 && Date.now() < saveBy) await page.waitForTimeout(200);
    assert(net.saves > saves0, 'the typed caption was never saved');
    await page.waitForTimeout(500);
    await check('the echo of the person\'s own save while typing', () => page.evaluate(() => {
      const ch = window.__fixtureChannels.filter(c => /^cal-/.test(c.topic)).pop();
      ch.handlers.forEach(cb => cb({ eventType: 'UPDATE', new: { id: 'p_live_1' } }));
    }), { deferred: true, waitMs: 12000 });
    const typed = await page.evaluate(sel => document.querySelector(sel).value.includes(' typed by the person'), CAP);
    assert(typed, 'the person\'s typed caption text was lost');
    assert.deepEqual(errors, [], 'live-ui: page errors ' + errors.join(' | '));
    return lines;
  } finally {
    await ctx.close();
  }
}

// The Samples Sheet shares the repaint: a background reload keeps its strip
// and the focused field with its caret.
async function samplesLiveUiCase(browser, origin) {
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'sr_live_unused' }, [], 'samples');
  await seedStaffGate(ctx);
  let gets = 0;
  await ctx.route('**/rest/v1/sample_reviews*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const n = ++gets;
    const rows = [];
    for (let k = 0; k < 10; k++) rows.push({ ...BASE_ROW, id: 'sr_live_' + k, name: k === 7 ? 'Teammate edit ' + n : 'Sample fixture ' + k, order_index: k + 1,
      video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', creative_direction: 'Fictional direction ' + k,
      updated_at: k === 7 ? new Date(Date.UTC(2026, 9, 10, 12, 0, n)).toISOString() : BASE_ROW.updated_at });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows), headers: CORS });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof navTo === 'function' && typeof _sxrSavePins === 'function');
    await page.evaluate(c => { _sxrSavePins([c]); sxrState.client = c; navTo('sample-reviews'); }, CLIENT);
    await page.waitForSelector('#sxrStrip .cal-card[data-pid="sr_live_2"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    const field = '#sxrStrip .cal-card[data-pid="sr_live_2"] [data-fld="creative_direction"]';
    await page.evaluate(() => { document.getElementById('sxrStrip').scrollLeft = 150; });
    await page.click(field);
    await page.evaluate(sel => document.querySelector(sel).setSelectionRange(4, 7), field);
    const read = () => page.evaluate(sel => {
      const a = document.activeElement;
      return { strip: Math.round(document.getElementById('sxrStrip').scrollLeft), focus: a && a.matches(sel) ? 'field' : (a ? a.tagName : '-'),
        caret: a && a.selectionStart != null ? a.selectionStart + ':' + a.selectionEnd : '',
        name7: (document.querySelector('#sxrStrip .cal-card[data-pid="sr_live_7"] [data-fld="name"]') || {}).value || '' };
    }, field);
    const before = await read();
    assert(before.strip > 0 && before.focus === 'field', 'samples fixture did not scroll and focus: ' + JSON.stringify(before));
    // The repaint a realtime change or a tab return runs once the reload lands.
    await page.evaluate(async () => { await loadSxrCards({ background: true }); _sxrRenderBody({ preserveScroll: true }); });
    await page.waitForTimeout(800);
    const after = await read();
    assert.notEqual(after.name7, before.name7, 'samples: the refresh never repainted the board');
    for (const k of ['strip', 'focus', 'caret']) assert.deepEqual(after[k], before[k], 'samples: ' + k + ' changed from ' + JSON.stringify(before[k]) + ' to ' + JSON.stringify(after[k]));
    assert.deepEqual(errors, [], 'samples: page errors ' + errors.join(' | '));
    return 'Samples Sheet keeps its strip (' + after.strip + ') and the focused field with its caret (' + after.caret + ') across a background repaint';
  } finally {
    await ctx.close();
  }
}


// ---- Part 4: a background refresh is invisible (owner rule, 2026-10-14) ----
//
// A tab switch fires several triggers at once (the page becoming visible, the
// window taking focus, pageshow) and a teammate's change can land at the same
// moment. Measured on the test client before the fix: going back to the
// Calendar ran four loads and rebuilt the board four times, and every
// background refresh flashed the toolbar's "Refreshing…" chip. Here:
//   (a) a tab switch with a teammate's change landing on return costs at most
//       one read and one load, and when the read finds nothing new nothing on
//       screen changes at all (no node, attribute or text in the Calendar);
//   (b) while the person types in a caption, a teammate's change to another
//       card is drawn at once and only that card is redrawn: the caption keeps
//       its very node, its focus, the caret where it was, the typed text and
//       its look;
//   (c) screenshots before, during (the read held in flight) and after a
//       refresh match, and the caption being typed in matches before and after
//       a refresh that redraws another card (match: see looksSame).
// Set REFRESH_SHOTS_DIR to keep the screenshots.
const fs = require('node:fs');
const path = require('node:path');
// Realtime stand-in whose channels can be told they connected.
const FAKE_SUPABASE_LIB_CONNECTS = `window.supabase = { createClient: function () { return {
  channel: function (topic) { var ch = { topic: topic, handlers: [],
    on: function (ev, filter, cb) { ch.handlers.push(cb); return ch; },
    subscribe: function (cb) { ch.status = cb; (window.__fixtureChannels = window.__fixtureChannels || []).push(ch); return ch; },
    unsubscribe: function () {} }; return ch; },
  removeChannel: function () {} }; } };`;

async function invisibleRefreshCase(browser, origin) {
  const ctx = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_tab_fixture_unused' }, [], 'calendar');
  await seedStaffGate(ctx);
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE_LIB_CONNECTS }));
  await ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const key = (new URL(route.request().url()).searchParams.get('key') || '').replace(/^eq\./, '');
    if (!/_clients$/.test(key)) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify([{ key, value: { clients: ['phonefixtureclient'] } }]) });
  });
  // The board as the server holds it. teammate: how many times a teammate has
  // renamed card 7; hold: a promise the next read waits on (a read in flight).
  const server = { teammate: 0, hold: null, gets: 0 };
  const stampOf = n => new Date(Date.UTC(2026, 9, 10, 12, 0, n)).toISOString();
  await ctx.route('**/rest/v1/calendar_posts*', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (!/[?&]client=eq\./.test(route.request().url())) return route.fallback();
    server.gets++;
    if (server.hold) await server.hold;
    const rows = [];
    for (let k = 0; k < 10; k++) rows.push(post('p_tab_' + k, null, { order_index: k + 1, caption: k === 1 ? LONG_CAPTION : 'Short fixture caption ' + k + '.',
      linear_issue_id: 'FIXTURE-T' + k, video_deliverable_id: 'fixture-tab-deliverable-' + k, status: 'In Progress', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
      ...(k === 7 ? { name: 'Teammate edit ' + server.teammate, updated_at: stampOf(server.teammate) } : {}) }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows), headers: CORS });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const shotsDir = process.env.REFRESH_SHOTS_DIR || '';
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  const shoot = async (name, clip) => {
    const buf = await page.screenshot({ animations: 'disabled', caret: 'hide', ...(clip ? { clip } : {}) });
    if (shotsDir) fs.writeFileSync(path.join(shotsDir, name + '.png'), buf);
    return buf;
  };
  // Two screenshots look the same when no pixel differs by more than 16 of
  // 255 on any channel. Chromium's software rasterizer can repaint a few
  // anti-aliased edge pixels a shade or two apart (measured: at most 5) with
  // nothing on the page changed; anything a person could notice (the
  // "Refreshing" chip, a faded Generate pill, a collapsed caption, a moved
  // card) differs by far more. Compared in a blank page of its own.
  const judge = await ctx.newPage();
  await judge.setContent('<canvas id="a"></canvas><canvas id="b"></canvas>');
  const looksSame = async (x, y) => {
    const r = await judge.evaluate(async ([x, y]) => {
      const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + src; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { over: -1, max: 255 };
      const px = img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      const a = px(ia), b = px(ib);
      let over = 0, max = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; if (d > 16) over++; }
      return { over, max };
    }, [x.toString('base64'), y.toString('base64')]);
    return r.over === 0;
  };
  const lines = [];
  try {
    await page.bringToFront();
    await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof navTo === 'function');
    await page.evaluate(() => navTo('calendar'));
    await page.locator('#calView').waitFor();
    await showView(page, 'organizer');
    await page.waitForFunction(() => (window.__fixtureChannels || []).some(c => /^cal-/.test(c.topic) && c.status), null, { timeout: 15000 });
    // Realtime connects, as on the live site (so the fallback poll is idle).
    await page.evaluate(() => window.__fixtureChannels.filter(c => /^cal-/.test(c.topic)).forEach(c => c.status('SUBSCRIBED')));
    // Count every Calendar load and every change on the Calendar's screen.
    await page.evaluate(() => {
      const rc = window.__rc = { loads: 0, mutations: 0, chip: 0 };
      const load = window.loadCalendarPosts;
      window.loadCalendarPosts = function () { rc.loads++; return load.apply(this, arguments); };
      new MutationObserver(list => { rc.mutations += list.length; }).observe(document.getElementById('calView'), { subtree: true, childList: true, attributes: true, characterData: true });
      const chip = document.getElementById('calRefreshing');
      if (chip) new MutationObserver(() => { if (!chip.hidden) rc.chip++; }).observe(chip, { attributes: true });
    });
    const CAP = '#calStrip .cal-card[data-pid="p_tab_1"] textarea[data-fld="caption"]';
    // Open the long caption and scroll inside it; slide the strip a little.
    await page.evaluate(() => { document.getElementById('calStrip').scrollLeft = 0; });
    await page.click('#calStrip .cal-card[data-pid="p_tab_1"] .cal-cap-toggle');
    await page.evaluate(sel => { document.querySelector(sel).scrollTop = 300; document.getElementById('calStrip').scrollLeft = 120; }, CAP);
    await page.mouse.move(5, 790);
    await page.waitForTimeout(4500);   // past the return floor
    const counters = () => page.evaluate(() => Object.assign({}, window.__rc));
    const deliver = (id, stamp) => page.evaluate(({ id, stamp }) => {
      const ch = window.__fixtureChannels.filter(c => /^cal-/.test(c.topic)).pop();
      ch.handlers.forEach(cb => cb({ eventType: 'UPDATE', new: { id, updated_at: stamp }, old: { id } }));
    }, { id, stamp });
    const hide = () => page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    // Everything a real return fires, in one go.
    const show = () => page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    });

    // (a) Tab switch; a teammate renamed card 7 while the person was away and
    // the change's realtime message lands on return, right after the return
    // read went out. The read already holds it: one read, one load.
    const a0 = await counters(), g0 = server.gets;
    const before = await shoot('tab-switch-before');
    await hide();
    server.teammate = 1;
    await page.waitForTimeout(1500);
    await show();
    await deliver('p_tab_7', stampOf(1));
    await page.waitForTimeout(6000);
    const a1 = await counters();
    const tabReads = server.gets - g0, tabLoads = a1.loads - a0.loads;
    const title7 = await page.evaluate(() => document.querySelector('#calStrip .cal-card[data-pid="p_tab_7"] [data-fld="name"]').value);
    assert.equal(title7, 'Teammate edit 1', 'tab switch: the teammate\'s change never reached the board');
    assert(tabReads <= 1 && tabLoads <= 1, 'tab switch: ' + tabReads + ' reads and ' + tabLoads + ' loads (at most one each)');
    assert.equal(a1.chip - a0.chip, 0, 'tab switch: the "Refreshing" chip showed during a background refresh');
    lines.push('tab switch with a teammate change landing on return: ' + tabReads + ' read, ' + tabLoads + ' load, chip shown ' + (a1.chip - a0.chip) + ' times');

    // ... and a tab switch that finds nothing new changes nothing on screen.
    await page.waitForTimeout(4500);
    // Shot first: the screenshot hides the caret by touching every field's
    // style, which the counters below must not include.
    const quiet0 = await shoot('quiet-before');
    const b0 = await counters(), gb = server.gets;
    await hide();
    await page.waitForTimeout(800);
    await show();
    await page.waitForTimeout(4000);
    const b1 = await counters();
    assert.equal(server.gets - gb, 1, 'quiet tab switch: expected exactly one read, saw ' + (server.gets - gb));
    assert.equal(b1.mutations - b0.mutations, 0, 'quiet tab switch: a refresh that found nothing new changed the screen (' + (b1.mutations - b0.mutations) + ' DOM changes)');
    const quiet1 = await shoot('quiet-after');
    assert(await looksSame(quiet0, quiet1), 'quiet tab switch: the screen before and after the refresh differ');
    lines.push('tab switch that finds nothing new: 1 read, 0 changes on screen, before and after screenshots match');

    // (c) Screenshots during a refresh: the read is held in flight, the screen
    // is shot while it waits, again once it lands, and a moment later.
    await page.waitForTimeout(4500);
    let release; server.hold = new Promise(r => { release = r; });
    const held0 = await shoot('held-before');
    await hide();
    await page.waitForTimeout(300);
    const gh = server.gets;
    await show();
    for (let i = 0; i < 100 && server.gets === gh; i++) await page.waitForTimeout(50);
    assert(server.gets > gh, 'held refresh: the tab return never read the board');
    await page.waitForTimeout(600);
    const during = await shoot('held-during');
    release(); server.hold = null;
    await page.waitForTimeout(300);
    const right = await shoot('held-right-after');
    await page.waitForTimeout(1500);
    const later = await shoot('held-later');
    assert(await looksSame(held0, during), 'held refresh: the screen changed while the read was in flight');
    assert(await looksSame(held0, right) && await looksSame(held0, later), 'held refresh: the screen changed when the read landed');
    lines.push('refresh held in flight: screenshots before, during, right after and 1.5 s after match');

    // (b) The person types in the open caption; a teammate renames card 7 and
    // its realtime change arrives mid-typing.
    await page.click(CAP);
    await page.evaluate(sel => { const t = document.querySelector(sel); t.__personsField = true; t.setSelectionRange(24, 24); }, CAP);
    await page.keyboard.type(' typed while a teammate edits');
    const typedBefore = await page.evaluate(() => { const a = document.activeElement; return { value: a.value, caret: a.selectionStart + ':' + a.selectionEnd, top: Math.round(a.scrollTop) }; });
    // Let the person's own autosave settle (its "Saved" tick is theirs, not
    // the refresh's), then frame the caption area itself.
    await page.waitForTimeout(3000);
    const capClip = await page.evaluate(() => { const r = document.querySelector('#calStrip .cal-card[data-pid="p_tab_1"] .cal-cap-wrap').getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: Math.min(r.height, innerHeight - Math.max(0, r.top)) }; });
    const capBefore = await shoot('caption-area-before', capClip);
    await page.evaluate(() => { document.querySelector('#calStrip .cal-card[data-pid="p_tab_7"]').__old = true; });
    const gt = server.gets;
    server.teammate = 2;
    await deliver('p_tab_7', stampOf(2));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const t = await page.evaluate(() => document.querySelector('#calStrip .cal-card[data-pid="p_tab_7"] [data-fld="name"]').value);
      if (t === 'Teammate edit 2') break;
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(500);
    const typedAfter = await page.evaluate(() => {
      const a = document.activeElement;
      const c7 = document.querySelector('#calStrip .cal-card[data-pid="p_tab_7"]');
      return { same: !!a.__personsField, value: a.value, caret: a.selectionStart + ':' + a.selectionEnd, top: Math.round(a.scrollTop),
        title7: c7.querySelector('[data-fld="name"]').value, card7Redrawn: !c7.__old };
    });
    assert(server.gets > gt, 'typing: the teammate\'s change never started a read');
    assert.equal(typedAfter.title7, 'Teammate edit 2', 'typing: the teammate\'s change to another card waited for the person to stop typing');
    assert(typedAfter.card7Redrawn, 'typing: the changed card was not redrawn');
    assert(typedAfter.same, 'typing: the caption being typed in was replaced by a new node');
    assert.equal(typedAfter.value, typedBefore.value, 'typing: the typed text changed');
    assert.equal(typedAfter.caret, typedBefore.caret, 'typing: the caret moved');
    assert.equal(typedAfter.top, typedBefore.top, 'typing: the caption scrolled inside');
    const capAfter = await shoot('caption-area-after', capClip);
    assert(await looksSame(capBefore, capAfter), 'typing: the caption area looks different after the refresh');
    lines.push('typing in a caption while a teammate edits another card: that card redrawn at once; the caption keeps its node, focus, caret ' + typedAfter.caret + ', text and look');
    assert.deepEqual(errors, [], 'invisible refresh: page errors ' + errors.join(' | '));
    return lines;
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
    checks += 1;
    try { (await liveUiCase(browser, origin)).forEach(line => console.log('  ok  ' + line)); }
    catch (e) { failures.push(e.message); console.log('  FAIL ' + e.message); }
    checks += 1;
    try { console.log('  ok  ' + await samplesLiveUiCase(browser, origin)); }
    catch (e) { failures.push(e.message); console.log('  FAIL ' + e.message); }
    checks += 1;
    try { (await invisibleRefreshCase(browser, origin)).forEach(line => console.log('  ok  ' + line)); }
    catch (e) { failures.push(e.message); console.log('  FAIL ' + e.message); }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) throw new Error(failures.length + ' failing: ' + failures.join(' || '));
  console.log('calendar-refresh-scroll-browser: PASS (' + checks + ' checks: ' + VIEWS.length * SCREENS.length + ' insertion views, ' + MOVED_CASES.length + ' moved-card cases, 2 live-UI cases, 1 invisible-refresh case)');
})().catch(e => { console.error('calendar-refresh-scroll-browser: FAIL ' + (e && e.message)); process.exit(1); });
