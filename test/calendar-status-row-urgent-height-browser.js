'use strict';
/*
 * Staff Calendar and Samples Sheet: every status row stays one line and the
 * same height as the others when a part is Urgent.
 *
 * Before: the URGENT button docked beside a status squeezed the status text,
 * so on a narrow card "KASPER APPROVAL" wrapped onto two lines and the
 * Thumbnail and Caption rows grew from 21px to 32px.
 * After: the urgent mark on a status row is a compact "!" segment, the status
 * name never wraps (it ends in an ellipsis only if it truly cannot fit) and
 * its title always carries the full name.
 *
 * Measured on desktop (all three card sizes) and phone, light and dark, both
 * status palettes, for the Calendar and the Samples Sheet. Fully offline,
 * fictional client and cards. Set URGENT_ROW_SHOT_DIR to save a picture of
 * each urgent card.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('../docs/syncview-design/tests/client-phone-review-browser');
const { seedStaffGate } = require('../qa/staff-gate-seed');

const CLIENT = 'Phone Fixture Client';
const SHOTS = process.env.URGENT_ROW_SHOT_DIR || '';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const KA = 'Kasper Approval';
const SCREENS = [['desktop', { width: 1280, height: 900 }, false, ['s', 'm', 'l']], ['phone', { width: 360, height: 800 }, true, ['m']]];
const linked = k => ({ linear_issue_id: 'FIXTURE-' + k, graphic_linear_issue_id: 'FIXTURE-G' + k, video_deliverable_id: 'fixture-video-' + k, graphic_deliverable_id: 'fixture-graphic-' + k });
const SURFACES = {
  calendar: {
    table: 'calendar_posts', strip: '#calStrip', urgent: 'p_urgent_row', calm: 'p_calm_row',
    rows: () => [
      { ...BASE_ROW, ...linked(1), id: 'p_urgent_row', name: 'Urgent fixture', order_index: 1, status: KA, video_status: 'Tweaks Needed', graphic_status: KA, caption_status: KA },
      { ...BASE_ROW, ...linked(2), id: 'p_calm_row', name: 'Calm fixture', order_index: 2, status: 'In Progress', video_status: 'In Progress', graphic_status: 'For SMM Approval', caption_status: 'In Progress' },
    ],
    open: async (page, zoom) => page.evaluate(async ({ c, zoom }) => {
      navTo('calendar'); Object.assign(calState, { client: c, view: 'organizer', zoom }); _calSavePins([c]); _calRenderShell();
      await loadCalendarPosts({ skipCache: true });
    }, { c: CLIENT, zoom }),
    zoom: (page, zoom) => page.evaluate(z => { calState.zoom = z; _calApplyZoom(); }, zoom),
  },
  samples: {
    table: 'sample_reviews', strip: '#sxrStrip', urgent: 'sr_urgent_row', calm: 'sr_calm_row',
    rows: () => [
      { ...BASE_ROW, ...linked(3), id: 'sr_urgent_row', name: 'Urgent sample fixture', order_index: 1, status: KA, video_status: 'Tweaks Needed', graphic_status: KA },
      { ...BASE_ROW, ...linked(4), id: 'sr_calm_row', name: 'Calm sample fixture', order_index: 2, status: 'In Progress', video_status: 'In Progress', graphic_status: 'For SMM Approval' },
    ],
    open: async (page, zoom) => page.evaluate(({ c, zoom }) => {
      _sxrSavePins([c]); sxrState.client = c; sxrState.zoom = zoom; navTo('sample-reviews');
    }, { c: CLIENT, zoom }),
    zoom: (page, zoom) => page.evaluate(z => { sxrState.zoom = z; _sxrApplyZoom(); }, zoom),
  },
};

async function measure(page, s) {
  return page.evaluate(({ strip, urgent, calm }) => {
    const rows = sel => [...document.querySelectorAll(`${strip} .cal-card[data-pid="${sel}"] .cal-fld-substatus-wrap`)];
    const read = w => {
      const label = w.querySelector('.cal-fld-substatus-label');
      const lh = parseFloat(getComputedStyle(label).lineHeight) || parseFloat(getComputedStyle(label).fontSize) * 1.3;
      return {
        comp: w.dataset.substatusComp, h: Math.round(w.getBoundingClientRect().height), urgent: !!w.querySelector('.cal-urgent-btn'),
        oneLine: label.getBoundingClientRect().height <= lh * 1.5, text: label.textContent.trim(), title: label.title || '',
        cut: label.scrollWidth > label.clientWidth + 1,
      };
    };
    return { urgent: rows(urgent).map(read), calm: rows(calm).map(read) };
  }, s);
}

async function run(browser, origin, surface, [screen, viewport, mobile, zooms], theme, palette) {
  const s = SURFACES[surface];
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: theme, reducedMotion: 'reduce' });
  const lines = [];
  try {
    await installFixture(ctx, origin, { ...BASE_ROW, id: 'unused_fixture' }, [], surface);
    await seedStaffGate(ctx);
    await ctx.addInitScript(([t, p]) => { localStorage.setItem('syncview_theme', t); localStorage.setItem('syncview_status_palette', p); }, [theme, palette]);
    // The Kasper ping is switched on, so parts at Kasper Approval carry URGENT.
    await ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
      if (!/kasper_urgent_ping_enabled/.test(route.request().url())) return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify([{ key: 'kasper_urgent_ping_enabled', value: { enabled: true } }]) });
    });
    await ctx.route(`**/rest/v1/${s.table}*`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(s.rows()) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof navTo === 'function' && typeof _calSavePins === 'function' && typeof _sxrSavePins === 'function');
    await s.open(page, zooms[0]);
    await page.waitForSelector(`${s.strip} .cal-card[data-pid="${s.urgent}"] .cal-urgent-btn`, { timeout: 20000 });
    await page.waitForTimeout(600);
    for (const zoom of zooms) {
      await s.zoom(page, zoom);
      await page.waitForTimeout(250);
      const label = `${surface} ${screen} ${theme} ${palette}${zooms.length > 1 ? ' zoom ' + zoom : ''}`;
      const m = await measure(page, { strip: s.strip, urgent: s.urgent, calm: s.calm });
      const all = m.urgent.concat(m.calm);
      assert(m.urgent.length >= 2 && m.calm.length === m.urgent.length, label + ': fixture rows missing');
      assert(m.urgent.every(r => r.urgent), label + ': not every status row of the urgent card carries the urgent mark');
      assert(m.calm.every(r => !r.urgent), label + ': the calm card carries an urgent mark');
      const heights = [...new Set(all.map(r => r.h))];
      assert.equal(heights.length, 1, label + ': status rows differ in height ' + all.map(r => r.comp + (r.urgent ? '!' : '') + '=' + r.h).join(' '));
      const wrapped = all.find(r => !r.oneLine);
      assert(!wrapped, label + ': the ' + (wrapped && wrapped.comp) + ' status wraps onto a second line');
      const untitled = all.find(r => r.title !== r.text);
      assert(!untitled, label + ': the ' + (untitled && untitled.comp) + ' status has no full-name tooltip');
      const cut = m.urgent.filter(r => r.cut).map(r => r.comp);
      lines.push(label + ': ' + all.length + ' rows all ' + heights[0] + 'px, one line' + (cut.length ? ' (shortened with tooltip: ' + cut.join(', ') + ')' : ', full names shown'));
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const card = page.locator(`${s.strip} .cal-card[data-pid="${s.urgent}"]`).first();
        await card.scrollIntoViewIfNeeded();
        await card.screenshot({ path: path.join(SHOTS, `${surface}-${screen}-${theme}-${palette}-${zoom}.png`) });
      }
    }
    assert.deepEqual(errors, [], surface + ' ' + screen + ': page errors ' + errors.join(' | '));
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
    for (const surface of Object.keys(SURFACES)) for (const screen of SCREENS) for (const theme of ['light', 'dark']) for (const palette of ['vibrant', 'classic']) {
      try { const lines = await run(browser, origin, surface, screen, theme, palette); checks += lines.length; lines.forEach(l => console.log('  ok  ' + l)); }
      catch (e) { failures.push(e.message); console.log('  FAIL ' + e.message); }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('calendar-status-row-urgent-height-browser: FAIL ' + failures.length + ' failing'); process.exit(1); }
  console.log('calendar-status-row-urgent-height-browser: PASS (' + checks + ' layouts, every status row one line and the same height with Urgent on)');
})().catch(e => { console.error('calendar-status-row-urgent-height-browser: FAIL ' + (e && e.message)); process.exit(1); });
