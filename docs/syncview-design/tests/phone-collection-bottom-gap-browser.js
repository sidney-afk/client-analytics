'use strict';
// The phone picture grid (Calendar and Samples, staff, 390 wide) fills the
// screen down to the "Review posts" bar. Before this fix the grid measured
// its distance from the top of the page once, when it first appeared and the
// desktop header was still above it (74px), and never measured again; once
// the phone layout took over, the grid sat at the top of the screen but was
// still 74px too short, so the last row was cut off over an empty band of
// about 90px above the bar. Fictional client and posts, fully offline.
//
// Run: node docs/syncview-design/tests/phone-collection-bottom-gap-browser.js
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const CLIENT = 'Phone Fixture Client';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*' };
const rows = Array.from({ length: 24 }, (_, i) => ({ ...BASE_ROW, id: 'p_gap_fixture_' + i, name: 'Gap fixture post ' + i, order_index: i + 1,
  scheduled_date: null, status: 'In Progress', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress' }));

let checks = 0; const failures = [];
function expect(v, m) { checks++; if (!v) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

async function run(browser, origin, height) {
  const ctx = await browser.newContext({ viewport: { width: 390, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_gap_fixture_unused' }, [], 'calendar');
  await seedStaffGate(ctx);
  await ctx.route('**/rest/v1/calendar_posts*', route => route.request().method() !== 'GET' ? route.fallback()
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows), headers: CORS }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navTo === 'function');
  await page.evaluate(() => navTo('calendar'));
  await page.locator('#calView').waitFor();
  // Live, the phone page header (74px) is still above the Calendar at the
  // moment the picture grid mounts, and is hidden right after; the posts then
  // arrive and paint. Same order here: a 74px bar above the view while the
  // grid mounts, gone before the posts load.
  await page.evaluate(async client => {
    const bar = document.createElement('div'); bar.id = 'gapFixtureBar'; bar.style.cssText = 'height:74px;flex:none';
    document.getElementById('calView').before(bar);
    _calInvalidateActiveLoad();
    Object.assign(calState, { loading: true, error: '', client, posts: [], view: 'organizer', monthFilter: 'all', statusFilter: 'all' });
    _calSavePins([client]);
    _calRenderShell();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    bar.remove();
    calState.loading = false;
    await loadCalendarPosts({ skipCache: true });
  }, CLIENT);
  await page.waitForSelector('#calView[data-thumb-collection] .thumb-tile', { timeout: 20000 });
  await page.waitForFunction(() => { const d = document.querySelector('#calView .thumb-review-dock'); return d && !d.hidden; }, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const v = document.getElementById('calView'), b = document.getElementById('calBody'), d = v.querySelector('.thumb-review-dock');
    const vr = v.getBoundingClientRect(), br = b.getBoundingClientRect(), dr = d.getBoundingClientRect();
    return { viewTop: vr.top, viewBottom: vr.bottom, bodyBottom: br.bottom, dockTop: dr.top, inner: innerHeight, scrolls: b.scrollHeight > b.clientHeight };
  });
  const tag = '390x' + height;
  expect(m.scrolls, `${tag}: the grid has more rows than fit, so it scrolls inside (${JSON.stringify(m)})`);
  expect(Math.abs(m.viewBottom - m.inner) <= 2, `${tag}: the Calendar runs to the bottom of the screen (ends ${Math.round(m.viewBottom)} of ${m.inner})`);
  expect(m.dockTop - m.bodyBottom <= 30 && m.dockTop - m.bodyBottom >= 0, `${tag}: the grid stops just above the Review bar, no empty band (gap ${Math.round(m.dockTop - m.bodyBottom)}px)`);
  expect(errors.length === 0, `${tag}: no page errors ${errors.join(' | ')}`);
  if (process.env.PHONE_GAP_SHOTS) await page.screenshot({ path: require('path').join(process.env.PHONE_GAP_SHOTS, `phone-gap-${height}.png`) });
  await ctx.close();
}

(async () => {
  const { server, origin } = await (async () => { const s = await serve(); return s.server ? s : { server: s, origin: 'http://127.0.0.1:' + s.address().port }; })();
  const browser = await chromium.launch();
  try { await run(browser, origin, 844); await run(browser, origin, 700); }
  catch (e) { failures.push(String(e && e.stack || e)); console.error(e); }
  await browser.close(); server.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) process.exit(1);
})();
