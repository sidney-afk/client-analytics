'use strict';
/*
 * Calendar card status filter (STATE_OF_THINGS D3), driven in a real browser on
 * generated data. Nothing here reaches a live backend: the fixture transport
 * from client-phone-review-browser answers every request.
 *
 * Proves, on desktop and on a phone (Expanded layout):
 *   - the filter reads the card's OVERALL status (the roll-up), not a lane;
 *   - Show only and Hide both work in Sheet, Month and Week, and are absent
 *     from Review;
 *   - it is remembered per client with the other filters, and a second client
 *     is untouched;
 *   - when it is on, a strip says so and one tap clears it;
 *   - on a phone nothing scrolls sideways and every control is 44px or more.
 *
 * Run:  node docs/syncview-design/tests/calendar-card-status-filter-browser.js
 * Pictures: set CARD_STATUS_SHOTS=<dir> to write PNGs.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const root = path.resolve(__dirname, '../../..');
const shots = process.env.CARD_STATUS_SHOTS;
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

async function shot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  const overlay = await page.locator('dialog[open]').count();
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: !overlay, animations: 'disabled' });
}

/* Six cards. The status column is what the roll-up gives for the lanes, so a
   card with one lane in Tweaks Needed reads Tweaks Needed overall even though
   its other lanes are Posted. */
function fixturePosts(today) {
  const lanes = (v, g, c) => ({ video_status: v, graphic_status: g, caption_status: c });
  const day = n => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const mk = (id, name, date, l) => ({ ...BASE_ROW, id, name, scheduled_date: date, thumbnail_url: '', ...l });
  return [
    mk('p_sf_posted', 'Posted card', day(0), lanes('Posted', 'Posted', 'Posted')),
    mk('p_sf_approved', 'Approved card', day(0), lanes('Approved', 'Approved', 'Approved')),
    mk('p_sf_progress', 'In progress card', day(1), lanes('In Progress', 'In Progress', 'In Progress')),
    mk('p_sf_tweaks', 'Tweaks card', day(1), lanes('Tweaks Needed', 'Posted', 'Posted')),
    mk('p_sf_scheduled', 'Scheduled card', day(0), lanes('Scheduled', 'Scheduled', 'Scheduled')),
    mk('p_sf_undated', 'Undated approved card', null, lanes('Approved', 'Approved', 'Approved')),
  ];
}

async function run(browser, origin, label, viewport, phone) {
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_sf_boot' }, [], 'calendar');
  await seedStaffGate(ctx);
  const errors = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof navTo === 'function');
    await page.evaluate(() => navTo('calendar'));
    await page.locator('#calView').waitFor();
    await page.evaluate(() => localStorage.removeItem(CAL_FILTERS_KEY));
    const today = await page.evaluate(() => _calIsoOf(new Date()));
    await page.evaluate(async ({ rows }) => {
      _calInvalidateActiveLoad();
      calState.loading = false; calState.error = '';
      calState.client = 'Fixture Client';
      calState.posts = rows.map(r => { const p = { ...r }; p.status = computeOverallStatus(p); return p; });
      calState.view = 'organizer';
      calState.monthFilter = 'all'; calState.statusFilter = 'all';
      calState.cardStatusFilter = { mode: 'show', picks: [] };
      calState.monthCursor = _calIsoFirstOfMonth(new Date());
      calState.weekCursor = _calIsoMondayOf(new Date());
      _calSavePins(['Fixture Client', 'Other Fixture Client']);
      _calRenderShell(); _calRenderBody();
    }, { rows: fixturePosts(today) });

    const shown = view => page.evaluate(v => {
      if (v === 'organizer') return document.querySelectorAll('#calStrip > .cal-card').length;
      if (v === 'month') return document.querySelectorAll('.cal-month-cell .cal-month-pill, .cal-unscheduled .cal-month-pill').length;
      return document.querySelectorAll('.cal-week-card, .cal-unscheduled .cal-month-pill').length;
    }, view);

    // The overall status the filter reads is the one the card carries.
    const overall = await page.evaluate(() => Object.fromEntries(calState.posts.map(p => [p.id, p.status])));
    eq(overall.p_sf_tweaks, 'Tweaks Needed', 'a lane in Tweaks Needed rolls the card up to Tweaks Needed');
    eq(overall.p_sf_posted, 'Posted', 'all lanes Posted rolls up to Posted');

    // Pure rules: junk is off, picks keep the status order, a blank or retired
    // status reads as In Progress (the chip's own default), and the filter never
    // looks at the lanes, only at the card's overall status.
    const rules = await page.evaluate(() => ({
      junk: _calNormCardStatusFilter({ mode: 'x', picks: ['Nope', 'Posted', 'Posted'] }),
      off: _calPostInCardStatusFilter({ status: 'Posted' }, { mode: 'hide', picks: [] }),
      blank: _calPostInCardStatusFilter({ status: '' }, { mode: 'show', picks: ['In Progress'] }),
      draft: _calPostInCardStatusFilter({ status: 'Draft' }, { mode: 'show', picks: ['In Progress'] }),
      overallOnly: _calPostInCardStatusFilter({ status: 'Posted', video_status: 'Tweaks Needed' }, { mode: 'hide', picks: ['Tweaks Needed'] }),
      unknownHide: _calPostInCardStatusFilter({ status: 'Canceled' }, { mode: 'hide', picks: ['Posted'] }),
      unknownShow: _calPostInCardStatusFilter({ status: 'Canceled' }, { mode: 'show', picks: ['Posted'] }),
    }));
    eq(rules, { junk: { mode: 'show', picks: ['Posted'] }, off: true, blank: true, draft: true, overallOnly: true, unknownHide: true, unknownShow: false }, label + ': filter rules');

    const openPill = async () => {
      if (phone && !(await page.locator('dialog.pocket-staff-cal-menu[open]').count())) {
        await page.locator('[data-staff-menu=more]').click();
      }
      if (!(await page.locator('#calCardStatusMenu.open').count())) await page.locator('#calCardStatusBtn').click();
      await page.locator('#calCardStatusMenu.open').waitFor();
    };
    const pick = async status => { await page.locator('#calCardStatusMenu [data-status="' + status + '"]').click(); };
    const closeMore = async () => { if (phone) { await page.keyboard.press('Escape'); if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape'); } else if (await page.locator('#calCardStatusMenu.open').count()) await page.keyboard.press('Escape'); };

    // ── Off by default: no strip, pill is not solid, all six cards show.
    ok(await page.locator('#calCardStatusBtn').count() === 1, label + ': the Status pill is missing from the Sheet');
    ok(await page.locator('#calCardStatusStrip').count() === 0, label + ': strip must not show while the filter is off');
    ok(!(await page.locator('#calCardStatusBtn.is-filtered').count()), label + ': pill must not look on when off');
    eq(await shown('organizer'), 6, label + ': all cards show with no filter');
    await shot(page, label + '-1-off');

    // ── Hide: everything Posted.
    await openPill();
    await shot(page, label + '-2-menu');
    await page.locator('.cal-sf-mode', { hasText: 'Hide' }).click();
    await pick('Posted');
    eq(await shown('organizer'), 5, label + ': Hide Posted removes only the Posted card');
    ok(await page.locator('#calCardStatusMenu.open').count() === 1, label + ': menu stays open while picking');
    await closeMore();
    ok(await page.locator('#calCardStatusBtn.is-filtered').count() === 1 || phone, label + ': pill must read as on');
    ok(await page.locator('#calCardStatusStrip').count() === 1, label + ': strip must show while on');
    ok(/Hiding Posted/.test(await page.locator('#calCardStatusStrip').innerText()), label + ': strip must say what is hidden');
    await shot(page, label + '-3-hide-posted');

    // ── Month and Week follow the same filter.
    await page.evaluate(() => onCalViewChange('month'));
    ok(await page.locator('#calCardStatusStrip').count() === 1, label + ': strip must show in Month');
    eq(await shown('month'), 4 + 1, label + ': Month hides the Posted card and keeps the other dated cards plus the tray');
    await shot(page, label + '-4-month');
    await page.evaluate(() => onCalViewChange('week'));
    ok(await page.locator('#calCardStatusStrip').count() === 1, label + ': strip must show in Week');
    eq(await shown('week'), 4 + 1, label + ': Week hides the Posted card');
    await page.evaluate(() => onCalViewChange('smmreview'));
    ok(await page.locator('#calCardStatusBtn').count() === 0, label + ': Review has no status pill');
    ok(await page.locator('#calCardStatusStrip').count() === 0, label + ': Review has no strip');
    await page.evaluate(() => onCalViewChange('organizer'));

    // ── Show only, two statuses.
    await openPill();
    await page.locator('.cal-sf-mode', { hasText: 'Show only' }).click();
    // switching mode keeps the picks (Posted); add Approved, drop Posted
    await pick('Approved'); await pick('Posted');
    eq(await page.evaluate(() => calState.cardStatusFilter), { mode: 'show', picks: ['Approved'] }, label + ': picks and mode');
    eq(await shown('organizer'), 2, label + ': Show only Approved keeps both Approved cards');
    await pick('Tweaks Needed');
    eq(await shown('organizer'), 3, label + ': Show only Approved + Tweaks Needed');
    await closeMore();
    ok(/Showing only Tweaks Needed, Approved/.test(await page.locator('#calCardStatusStrip').innerText()), label + ': strip names the picks');
    await shot(page, label + '-5-show-only');

    // ── Remembered per client, and the other client is untouched.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(CAL_FILTERS_KEY))[calClientSlug('Fixture Client')]);
    eq(saved.cs, { mode: 'show', picks: ['Tweaks Needed', 'Approved'] }, label + ': saved with the client filters');
    ok(saved.month === 'all' && saved.status === 'all' && 'sort' in saved, label + ': existing filter keys are preserved');
    const afterReload = await page.evaluate(() => {
      calState.cardStatusFilter = { mode: 'show', picks: [] };
      _calLoadClientFilters('Fixture Client');
      const mine = calState.cardStatusFilter;
      _calLoadClientFilters('Other Fixture Client');
      const other = calState.cardStatusFilter;
      _calLoadClientFilters('Fixture Client');
      return { mine, other };
    });
    eq(afterReload.mine, { mode: 'show', picks: ['Tweaks Needed', 'Approved'] }, label + ': restored for the same client');
    eq(afterReload.other, { mode: 'show', picks: [] }, label + ': another client is not filtered');
    // An older saved row with no status entry loads as off.
    eq(await page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem(CAL_FILTERS_KEY));
      map.legacyclient = { month: 'all', status: 'all', sort: 'manual' };
      localStorage.setItem(CAL_FILTERS_KEY, JSON.stringify(map));
      _calLoadClientFilters('Legacy Client');
      const v = calState.cardStatusFilter;
      _calLoadClientFilters('Fixture Client');
      return v;
    }), { mode: 'show', picks: [] }, label + ': old saved rows load as off');

    // ── Nothing matches: the empty state says why and offers Clear.
    await openPill();
    await pick('Approved'); await pick('Tweaks Needed'); await pick('N/A');
    eq(await shown('organizer'), 0, label + ': nothing matches N/A');
    ok(/No posts match the status filter/.test(await page.locator('.cal-filter-empty-title').innerText()), label + ': empty state says why');
    await pick('N/A'); await pick('Approved');
    await closeMore();

    // ── One-tap clear from the strip.
    const clear = page.locator('#calCardStatusStrip .cal-sf-clear');
    if (phone) { const box = await clear.boundingBox(); ok(box.width >= 43.5 && box.height >= 43.5, label + ': Clear needs a 44px target ' + JSON.stringify(box)); }
    await clear.click();
    ok(await page.locator('#calCardStatusStrip').count() === 0, label + ': Clear removes the strip');
    eq(await shown('organizer'), 6, label + ': Clear brings every card back');
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem(CAL_FILTERS_KEY))[calClientSlug('Fixture Client')].cs.picks), [], label + ': Clear is saved');
    await shot(page, label + '-6-cleared');

    // ── Phone layout: no sideways scroll, every control 44px or more.
    if (phone) {
      await page.evaluate(() => { calState.cardStatusFilter = { mode: 'hide', picks: ['Posted', 'Approved'] }; _calSaveClientFilters(); _calRenderBody(); _calRefreshCardStatus(); });
      await page.locator('[data-staff-menu=more]').click();
      await page.locator('#calCardStatusBtn').click();
      await page.locator('#calCardStatusMenu.open').waitFor();
      const m = await page.evaluate(() => {
        const roots = [document.querySelector('dialog[open]'), document.querySelector('#calCardStatusStrip')].filter(Boolean);
        const small = [];
        for (const r of roots) for (const n of r.querySelectorAll('button, [role=menuitemcheckbox], [role=radio]')) {
          if (!n.checkVisibility({ checkVisibilityCSS: true })) continue;
          const b = n.getBoundingClientRect();
          if (b.width < 43.5 || b.height < 43.5) small.push((n.className || n.tagName) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
        }
        return { small, sw: document.documentElement.scrollWidth, w: innerWidth };
      });
      eq(m.small, [], label + ': every status control is 44px or more');
      ok(m.sw <= m.w + 1, label + ': page scrolls sideways (' + m.sw + ' > ' + m.w + ')');
      await shot(page, label + '-7-more-sheet');
      await page.keyboard.press('Escape');
      ok(await page.locator('#calCardStatusStrip').isVisible(), label + ': the strip is visible without opening More');
      await shot(page, label + '-8-strip');
    } else {
      await page.evaluate(() => { calState.cardStatusFilter = { mode: 'hide', picks: ['Posted', 'Approved'] }; _calSaveClientFilters(); _calRenderBody(); _calRefreshCardStatus(); });
      await shot(page, label + '-7-hide-two');
    }
    ok(errors.length === 0, label + ': page errors: ' + errors.join(' | '));
  } finally { await ctx.close(); }
}

(async () => {
  const server = await serve(root);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await run(browser, origin, 'desktop', { width: 1280, height: 860 }, false);
    await run(browser, origin, 'phone', { width: 390, height: 844 }, true);
  } finally { await browser.close(); server.close(); }
  console.log('calendar-card-status-filter: OK (' + checks + ' checks; desktop and phone; Sheet, Month, Week, Review)');
})().catch(error => { console.error(error); process.exitCode = 1; });
