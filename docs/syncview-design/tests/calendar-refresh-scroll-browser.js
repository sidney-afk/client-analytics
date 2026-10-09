'use strict';
// A background refresh must never move what the user is looking at.
// Fictional client and posts, fully offline: every request is answered by the
// shared fixture. The refresh returns one new post ahead of the rest, the way
// a teammate's new card lands, and the card that was in view must stay put on
// every Calendar view, on a desktop and a phone screen. Before the fix the
// Sheet kept the same scrollLeft and so showed the board one card further on.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const CLIENT = 'Phone Fixture Client';
const VIEWS = ['smmreview', 'organizer', 'month', 'week'];
const SCREENS = [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]];
const TOLERANCE = 2;   // sub-pixel rounding only
const KEYS = '#calBody [data-pid], #calBody [data-cal-review-pid], #calBody [data-iso]';

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
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*' } });
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

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const s of SCREENS) (await screen(browser, origin, s)).forEach(line => console.log('  ok  ' + line));
    console.log('calendar-refresh-scroll-browser: PASS (' + VIEWS.length * SCREENS.length + ' view checks)');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error('calendar-refresh-scroll-browser: FAIL ' + (e && e.message)); process.exit(1); });
