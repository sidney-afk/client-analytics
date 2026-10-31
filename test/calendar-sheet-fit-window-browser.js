'use strict';
/*
 * The Calendar Sheet fits the window, behind the runtime switch sheet_fit_v1 (owner, 2026-10-31, round 2 of
 * session Sheetzoom). Sidney, at the smallest card size on 1920 x 1200: the page scrolled down to a big blank
 * area, with the sideways scrollbar at the very bottom.
 *
 * With the switch naming the person (staff) or the client link:
 *  - at the smallest size every card fits the window with no page scroll, at real laptop and desktop inner
 *    window sizes (the browser's own bars taken off): Mac 1440x900, 1512x982, 1728x1117, 1280x800 with overlay
 *    scrollbars; Windows 1920x1080 at 100%, 1536x864 (125%), 1280x720 (150%), 1366x768 with classic scrollbars
 *    that take room; plus 1920x1200. The sideways scrollbar sits right under the cards. Title, thumbnail and the
 *    three status pills show.
 *  - at a big size, when the cards are taller than the window, the page scrolls as it always did, and so does
 *    the wheel.
 *  - a plain vertical wheel slides the cards sideways when nothing scrolls up or down, wherever the pointer is
 *    on the Calendar; never inside a field, a menu or anything that scrolls on its own; a gesture with any
 *    sideways movement (trackpad, Magic Mouse) and Shift+wheel are left to the browser.
 *  - the client link fits too, and its smallest size comes back.
 * Switch off (missing, unreadable, the wrong shape, someone else named): the page is exactly today's: the same
 * boxes and the same wheel. The phone layout is the same with the switch on.
 *
 * Engines: Chromium always; WebKit too when it is installed (CI sets SHEET_FIT_REQUIRE_WEBKIT=1, where a missing
 * WebKit fails the run). Fully offline, fictional clients and cards. SHEET_FIT_SHOT_DIR saves screenshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');
const T = path.join(__dirname, '..', 'docs/syncview-design/tests');
const clientFixture = require(path.join(T, 'client-phone-review-browser.js'));

const SLUG = 'fixtureclient';
const NAME = 'Test Client';
const ME = 'm1';
const SHOTS = process.env.SHEET_FIT_SHOT_DIR || '';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const failures = [];
let checks = 0;
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else { checks++; } }

// Inner window sizes: the screen minus the menu bar, the Dock-free Chrome bars (Mac, 111 px) or the taskbar and
// Chrome bars (Windows, 133 px).
const MAC = [['Mac 1440x900', 1440, 789], ['Mac 1512x982', 1512, 871], ['Mac 1728x1117', 1728, 1006], ['Mac 1280x800', 1280, 689],
  ['MacBook Air Chrome 1470x830', 1470, 830], ['Mac 1440x800', 1440, 800]];
const WIN = [['Windows Opera 1920x1000', 1920, 1000], ['Windows 1920x1080 100%', 1920, 947], ['Windows 1536x864 125%', 1536, 731], ['Windows 1280x720 150%', 1280, 587],
  ['Windows 1366x768', 1366, 635], ['1920x1200 (Windows bars)', 1920, 1067], ['1920x1200 (whole screen)', 1920, 1200]];

const note = (id, author, body) => ({ id, author, role: 'smm', body, created_at: '2026-10-20T10:00:00Z' });
const CARDS = Array.from({ length: 9 }, (_, i) => ({
  id: 'c' + (i + 1), client: SLUG, name: 'Test card ' + (i + 1), status: 'In Progress', order_index: i + 1,
  updated_at: '2026-10-08T12:00:00.000Z', scheduled_date: i % 2 ? '2026-11-0' + (i % 9 + 1) : '',
  video_status: 'In Progress', graphic_status: 'For SMM Approval', caption_status: 'Approved',
  caption: 'A test caption that runs to a few lines, the way a real one does, with a hashtag or two. #fixture #sheet',
  cta: i % 3 ? 'Link in bio' : '', thumbnail_url: 'https://example.invalid/thumb-' + i + '.png', asset_url: 'https://example.invalid/video-' + i + '.mp4',
  comments: i % 2 ? [note('n' + i, 'SMM', 'A note'), note('m' + i, 'Editor', 'A reply')] : [], graphic_comments: [], caption_comments: [],
}));
const THUMB = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#c7b8ea"/></svg>';

async function routeBackend(page, origin, flag) {
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (u.hostname === 'example.invalid' && /thumb/.test(p)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: THUMB });
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: ME, name: 'Browser Staff', role: 'admin', team: null } });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: ME, name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.flatMap(k => {
        if (k === 'sheet_fit_v1') return flag === undefined ? [] : [{ key: k, value: flag }];
        return [{ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : { enabled: false } }];
      }));
    }
    if (p === '/rest/v1/calendar_posts') {
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(CARDS.filter(c => !one || c.id === one));
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p) || /n8n\.cloud$/.test(u.hostname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name.replace(/[^\w.-]+/g, '-') + '.png') });
}

// A staff page on the Sheet with the given switch value and saved card size.
async function staffPage(browser, origin, { flag, zoom, viewport, mobile, reduced }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, isMobile: !!mobile, hasTouch: !!mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  if (zoom) await ctx.addInitScript(z => { try { localStorage.setItem('syncview_calendar_prefs', JSON.stringify({ zoom: z, view: 'organizer' })); } catch (e) {} }, zoom);
  // Count what every ResizeObserver is watching right now (observe adds, unobserve and disconnect take away), so a
  // case can say whether anything watches #calBody.
  await ctx.addInitScript(() => {
    const Real = window.ResizeObserver;
    if (!Real) return;
    const live = new Map();
    window.__roWatching = () => [...live.values()].flatMap(set => [...set]).map(el => el.id || el.className || el.tagName);
    window.ResizeObserver = class extends Real {
      observe(el, o) { if (!live.has(this)) live.set(this, new Set()); live.get(this).add(el); return super.observe(el, o); }
      unobserve(el) { if (live.has(this)) live.get(this).delete(el); return super.unobserve(el); }
      disconnect() { live.delete(this); return super.disconnect(); }
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await routeBackend(page, origin, flag);
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await page.evaluate(n => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; navTo('calendar'); }, NAME);
  await page.waitForFunction(() => document.querySelector('#calView'), null, { timeout: 15000 });
  await page.evaluate(() => { if (calState.view !== 'organizer') { calState.view = 'organizer'; _calRenderShell(); _calRenderBody(); } });
  await page.waitForSelector(mobile ? '#calView .thumb-grid-card, #calStrip .cal-card' : '#calStrip .cal-card', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => typeof svRsFlagsLoaded !== 'function' || svRsFlagsLoaded(), null, { timeout: 8000 }).catch(() => {});
  await settle(page);
  return { ctx, page, errors };
}
async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120)))));
  await page.waitForTimeout(250);
}

// Does the Sheet fit the window? Page height, the cards' bottoms, the strip's scrollbar and what shows on a card.
function fitReport() {
  const de = document.scrollingElement || document.documentElement;
  const strip = document.getElementById('calStrip');
  const sr = strip.getBoundingClientRect();
  const cards = [...strip.querySelectorAll('.cal-card')];
  const vis = e => e && e.checkVisibility({ checkVisibilityCSS: true }) && e.getBoundingClientRect().height > 0;
  const c = cards[0];
  return {
    fit: document.documentElement.classList.contains('sv-sheet-fit'),
    zoom: document.getElementById('calView').dataset.zoom,
    inner: innerHeight, pageH: de.scrollHeight, scrollY: Math.round(scrollY),
    cardBottom: Math.round(Math.max(...cards.map(e => e.getBoundingClientRect().bottom))),
    stripBottom: Math.round(sr.bottom),
    // The sideways scrollbar is the strip's own bottom edge: how far it sits under the tallest card.
    barGap: Math.round(sr.bottom - Math.max(...cards.map(e => e.getBoundingClientRect().bottom))),
    scrollbarH: strip.offsetHeight - strip.clientHeight,
    thumbH: Math.round(c.querySelector('.cal-card-thumb').getBoundingClientRect().height),
    title: vis(c.querySelector('.cal-fld-name')),
    pills: [...c.querySelectorAll('.cal-fld-substatus-trigger')].filter(vis).length,
    sideways: strip.scrollWidth > strip.clientWidth,
  };
}

async function viewportCases(engineName, browser, origin, list, scrollbars) {
  const first = list[0];
  const { ctx, page, errors } = await staffPage(browser, origin, { flag: { staff: [ME] }, zoom: 'xs', viewport: { width: first[1], height: first[2] } });
  for (const [label, width, height] of list) {
    await page.setViewportSize({ width, height });
    await settle(page);
    const r = await page.evaluate(fitReport);
    const L = `${engineName} ${label} (${width}x${height}, ${scrollbars} scrollbars)`;
    expect(r.fit && r.zoom === 'xs', `${L}: the switch is on at the smallest size (fit ${r.fit}, size ${r.zoom})`);
    if (label === list[0][0]) expect(await page.evaluate(() => window.__roWatching && window.__roWatching().includes('calBody')), `${L}: with the switch on, the fit watches #calBody`);
    expect(r.pageH <= r.inner, `${L}: the page does not scroll up or down (page ${r.pageH} for a ${r.inner} window)`);
    expect(r.cardBottom <= r.inner, `${L}: every card fits the window (lowest card edge ${r.cardBottom} of ${r.inner})`);
    expect(r.stripBottom <= r.inner && r.barGap <= 6 + r.scrollbarH, `${L}: the sideways scrollbar sits right under the cards (${r.barGap}px under them)`);
    expect(r.thumbH >= 64 && r.title && r.pills === 3, `${L}: thumbnail (${r.thumbH}px), title and three status pills show`);
    expect(r.sideways, `${L}: the cards still scroll sideways`);
    if (scrollbars === 'classic') expect(r.scrollbarH > 0, `${L}: the classic scrollbar takes room in this run (${r.scrollbarH}px)`);
    await shot(page, `${engineName}-fit-xs-${label}`);
  }
  expect(errors.length === 0, `${engineName} ${scrollbars}: no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

// A WheelEvent the way the page receives one, so the handler's own decision can be read.
function wheelAt([sel, init]) {
  const el = document.querySelector(sel);
  const strip = document.getElementById('calStrip');
  const before = { left: strip.scrollLeft, y: scrollY };
  const ev = new WheelEvent('wheel', Object.assign({ bubbles: true, cancelable: true, deltaMode: 0 }, init));
  el.dispatchEvent(ev);
  return { prevented: ev.defaultPrevented, moved: strip.scrollLeft - before.left, y: scrollY - before.y };
}

// The default card size shows every card in full at the owner's 1920 x 1000 (Opera on Windows), and so does every
// smaller size; on a MacBook Air (1470 x 830) and 1440 x 800 the smallest size fits and the default is reported.
async function defaultSizeCases(engineName, browser, origin) {
  for (const [label, w, h, sizes] of [['Windows Opera 1920x1000', 1920, 1000, ['m', 's', 'xs']], ['MacBook Air Chrome 1470x830', 1470, 830, ['xs']], ['Mac 1440x800', 1440, 800, ['xs']]]) {
    const { ctx, page } = await staffPage(browser, origin, { flag: { staff: [ME] }, zoom: 'm', viewport: { width: w, height: h } });
    for (const z of ['m', 's', 'xs']) {
      await page.evaluate(z => { calState.zoom = z; _calApplyZoom(); }, z);
      await settle(page);
      const r = await page.evaluate(fitReport);
      const L = `${engineName} ${label}, size ${z}`;
      if (sizes.includes(z)) {
        expect(r.pageH <= r.inner && r.cardBottom <= r.inner, `${L}: every card shows in full down to its last status pill (lowest edge ${r.cardBottom} of ${r.inner}, page ${r.pageH})`);
        expect(r.pills === 3 && r.title, `${L}: title and three status pills show`);
      } else {
        console.log(`  ${L}: lowest card edge ${r.cardBottom} of ${r.inner}, thumbnail ${r.thumbH}px, page ${r.pageH} (reported, not required)`);
      }
      await shot(page, `${engineName}-${label}-${z}`);
    }
    await ctx.close();
  }
}

// A WheelEvent the way the page receives one, so the handler's own decision can be read.
async function stripLeft(page) { return page.evaluate(() => document.getElementById('calStrip').scrollLeft); }
async function pointAt(page, where) {
  return page.evaluate(where => {
    const strip = document.getElementById('calStrip');
    const all = [...strip.querySelectorAll('.cal-card')];
    const box = e => e.getBoundingClientRect();
    // The card nearest the middle of the window, so the pointer is on screen wherever the strip is scrolled.
    const mid = innerWidth / 2;
    const i = all.reduce((best, c, k) => Math.abs(box(c).left + box(c).width / 2 - mid) < Math.abs(box(all[best]).left + box(all[best]).width / 2 - mid) ? k : best, 0);
    const card = all[i], next = all[Math.min(i + 1, all.length - 1)];
    if (where === 'card') { const r = box(card.querySelector('.cal-card-body')); return { x: r.left + r.width / 2, y: r.top + 60 }; }
    if (where === 'between') { const a = box(card), b = box(next); return { x: (a.right + b.left) / 2, y: a.top + 120 }; }
    if (where === 'caption') { const r = box(card.querySelector('textarea.cal-fld-cap')); return { x: r.left + 20, y: r.top + 12 }; }
    if (where === 'toolbar') { const r = box(document.querySelector('#calView .cal-toolbar')); return { x: r.left + r.width * 0.45, y: r.top + 4 }; }
    if (where === 'empty') { const r = box(strip); return { x: r.right - 8, y: r.top + 80 }; }
    return null;
  }, where);
}
async function realWheel(page, where, dx, dy, shift) {
  const pt = await pointAt(page, where);
  await page.mouse.move(pt.x, pt.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.wheel(dx, dy);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(160);
}

async function wheelCases(engineName, browser, origin) {
  // The wheel follows the gesture wherever the pointer is (owner, 2026-10-31, round 2).
  for (const [label, w, h] of [['Windows Opera 1920x1000', 1920, 1000], ['MacBook Air Chrome 1470x830', 1470, 830]]) {
    // Every card fits: sideways moves slide the cards from anywhere; a vertical wheel has nothing to scroll up or
    // down, so it slides them too (the round-2 fallback, kept on purpose).
    const L = `${engineName} wheel ${label}, cards fit`;
    const { ctx, page } = await staffPage(browser, origin, { flag: { staff: [ME] }, zoom: 'xs', viewport: { width: w, height: h }, reduced: true });
    const r = await page.evaluate(fitReport);
    expect(r.pageH <= r.inner, `${L}: nothing scrolls up or down`);
    for (const where of ['card', 'between', 'caption', 'empty', 'toolbar']) {
      await page.evaluate(() => { document.getElementById('calStrip').scrollLeft = 300; });
      const before = await stripLeft(page);
      await realWheel(page, where, 120, 0);
      const after = await stripLeft(page);
      expect(after - before >= 100, `${L}: a sideways wheel over the ${where} slides the cards right (${after - before}px)`);
      await realWheel(page, where, -120, 0);
      expect(after - (await stripLeft(page)) >= 100, `${L}: and back left over the ${where}`);
      const b2 = await stripLeft(page);
      await realWheel(page, where, 0, 120, true);
      expect((await stripLeft(page)) - b2 >= 100, `${L}: Shift+wheel over the ${where} slides the cards`);
      const b3 = await stripLeft(page);
      await realWheel(page, where, 0, 120);
      expect((await stripLeft(page)) - b3 >= 100, `${L}: a plain vertical wheel over the ${where} slides the cards (nothing scrolls up or down)`);
      expect(await page.evaluate(() => scrollY) === 0, `${L}: the page did not move up or down (${where})`);
    }
    // Mac trackpad: many small, fractional steps add up; nothing is rounded away.
    const t0 = await stripLeft(page);
    const sum = await page.evaluate(() => {
      const el = document.querySelector('#calStrip .cal-card .cal-card-body');
      let prevented = 0;
      for (let i = 0; i < 40; i++) { const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 0.6, deltaY: 0.1 }); el.dispatchEvent(ev); if (ev.defaultPrevented) prevented++; }
      return prevented;
    });
    const t1 = await stripLeft(page);
    expect(sum === 40 && t1 - t0 >= 22 && t1 - t0 <= 25, `${L}: forty 0.6px trackpad steps move the cards about 24px (${t1 - t0}px, ${sum} handled)`);
    const shiftTrack = await page.evaluate(() => { const el = document.querySelector('#calView .cal-toolbar'); const s = document.getElementById('calStrip'); const b = s.scrollLeft; for (let i = 0; i < 10; i++) el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 2.5, shiftKey: true })); return s.scrollLeft - b; });
    expect(shiftTrack >= 24 && shiftTrack <= 26, `${L}: Shift with small trackpad steps over the toolbar slides the cards (${shiftTrack}px)`);
    // Left to the browser: Ctrl (zoom) and an open menu.
    const zoomGesture = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaY: 100, ctrlKey: true }]);
    expect(!zoomGesture.prevented && zoomGesture.moved === 0, `${L}: a pinch or Ctrl+wheel zoom is left to the browser`);
    await page.locator('#calView .cal-organize .dropdown-trigger').first().click();
    await page.waitForSelector('#calView .cal-organize .dropdown-menu.open', { timeout: 5000 }).catch(() => {});
    const menu = await page.evaluate(wheelAt, ['#calView .cal-organize .dropdown-menu.open .dropdown-item, #calView .cal-organize .dropdown-menu.open', { deltaY: 100 }]);
    expect(!menu.prevented && menu.moved === 0, `${L}: never inside an open menu`);
    await page.keyboard.press('Escape');
    // A caption that can scroll takes the wheel until its end, then the Sheet moves.
    await page.evaluate(() => {
      // The caption of the card nearest the middle of the window, where the pointer goes.
      const all = [...document.querySelectorAll('#calStrip .cal-card')];
      const d = c => Math.abs(c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2 - innerWidth / 2);
      const card = all.reduce((a, c) => (d(c) < d(a) ? c : a));
      const ta = card.querySelector('textarea.cal-fld-cap');
      ta.id = 'fitCaptionUnderTest';
      ta.value = Array.from({ length: 60 }, (_, i) => 'Line ' + (i + 1) + ' of a very long caption').join('\n');
      // Opened the way a person opens it: focused, it grows to a screen-high box that scrolls inside.
      ta.focus();
      ta.scrollTop = 0;
    });
    await settle(page);
    expect(await page.evaluate(() => { const ta = document.getElementById('fitCaptionUnderTest'); return getComputedStyle(ta).overflowY === 'auto' && ta.scrollHeight > ta.clientHeight + 10; }), `${L}: the opened long caption scrolls inside`);
    const s0 = await stripLeft(page);
    await realWheel(page, 'caption', 0, 100);
    const cap1 = await page.evaluate(() => ({ top: document.getElementById('fitCaptionUnderTest').scrollTop, left: document.getElementById('calStrip').scrollLeft }));
    expect(cap1.top > 0 && cap1.left === s0, `${L}: a caption with room takes the wheel (caption ${cap1.top}px, cards ${cap1.left - s0}px)`);
    await page.evaluate(() => { const ta = document.getElementById('fitCaptionUnderTest'); ta.scrollTop = ta.scrollHeight; });
    await realWheel(page, 'caption', 0, 100);
    const cap2 = await page.evaluate(() => { const de = document.scrollingElement || document.documentElement; return { left: document.getElementById('calStrip').scrollLeft, y: scrollY, room: de.scrollHeight > de.clientHeight + 1 }; });
    // The opened caption can make its card taller than the window; then the Sheet scrolls down, else sideways.
    expect(cap2.room ? cap2.y > 0 : cap2.left - s0 >= 80, `${L}: at the caption's end the Sheet moves (${cap2.room ? 'down ' + cap2.y : 'sideways ' + (cap2.left - s0)}px)`);
    await shot(page, `${engineName}-wheel-${label}`);
    await ctx.close();
  }
  // The cards are taller than the window: a vertical wheel scrolls the page up and down wherever the pointer is,
  // and a sideways one still slides the cards.
  {
    const L = `${engineName} wheel, cards taller than the window`;
    const { ctx, page } = await staffPage(browser, origin, { flag: { staff: [ME] }, zoom: 'l', viewport: { width: 1366, height: 600 } });
    const r = await page.evaluate(fitReport);
    expect(r.pageH > r.inner, `${L}: the page scrolls up and down (page ${r.pageH}, window ${r.inner})`);
    for (const where of ['card', 'between', 'empty', 'toolbar']) {
      await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('calStrip').scrollLeft = 200; });
      await page.waitForTimeout(80);
      await realWheel(page, where, 0, 120);
      const v = await page.evaluate(() => ({ y: scrollY, left: document.getElementById('calStrip').scrollLeft }));
      expect(v.y > 0 && v.left === 200, `${L}: a vertical wheel over the ${where} scrolls the page down (${v.y}px) and leaves the cards (${v.left - 200}px)`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      await realWheel(page, where, 120, 0);
      const s = await page.evaluate(() => ({ y: scrollY, left: document.getElementById('calStrip').scrollLeft }));
      expect(s.left - 200 >= 100 && s.y === 0, `${L}: a sideways wheel over the ${where} slides the cards (${s.left - 200}px) and not the page (${s.y}px)`);
    }
    // Mac trackpad: small vertical steps scroll the page, never the cards.
    const tv = await page.evaluate(() => { const el = document.querySelector('#calStrip .cal-card .cal-card-body'); let prevented = 0; for (let i = 0; i < 10; i++) { const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1.5, deltaX: 0.2 }); el.dispatchEvent(ev); if (ev.defaultPrevented) prevented++; } return prevented; });
    expect(tv === 0, `${L}: small vertical trackpad steps are left to the page (${tv} taken)`);
    await ctx.close();
  }
  // Off: today's wheel. Over the strip a vertical wheel slides the cards (the old strip handler); over the toolbar it
  // does nothing.
  {
    const L = `${engineName} wheel, switch off`;
    const { ctx, page } = await staffPage(browser, origin, { flag: undefined, zoom: 'xs', viewport: { width: 1440, height: 789 } });
    const strip = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaY: 100 }]);
    expect(strip.prevented && strip.moved === 100, `${L}: over the cards the wheel slides them as it did before (${strip.moved}px)`);
    const tb = await page.evaluate(wheelAt, ['#calView .cal-toolbar', { deltaY: 100 }]);
    expect(!tb.prevented && tb.moved === 0, `${L}: over the toolbar the wheel does nothing new`);
    const tbx = await page.evaluate(wheelAt, ['#calView .cal-toolbar', { deltaX: 100 }]);
    expect(!tbx.prevented && tbx.moved === 0, `${L}: a sideways wheel over the toolbar does nothing new`);
    await ctx.close();
  }
}

// Switch off in every form: the same boxes as a page with no row at all, and today's spacing.
function boxes() {
  const q = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), cs.padding, cs.margin].join(' '); };
  const card = document.querySelector('#calStrip .cal-card');
  return {
    fit: document.documentElement.classList.contains('sv-sheet-fit'),
    zoom: document.getElementById('calView').dataset.zoom,
    pageH: (document.scrollingElement || document.documentElement).scrollHeight,
    main: q('#mainWrap'), view: q('#calView'), toolbar: q('#calView .cal-toolbar'), strip: q('#calStrip'), card: q('#calStrip .cal-card'),
    rows: card ? [...card.querySelectorAll('.cal-card-body > *, .cal-card-substatus-row > *')].map(e => Math.round(e.getBoundingClientRect().height)).join(',') : '',
    thumbVar: document.getElementById('calView').style.getPropertyValue('--cal-fit-thumb-h'),
  };
}
async function offCases(browser, origin) {
  const variants = [['no row', undefined], ['empty', {}], ['someone else', { staff: ['someone-else'] }], ['staff not a list', { staff: ME }],
    ['a list', [ME]], ['a string', 'on'], ['clients only', { clients: [SLUG] }], ['all is not true', { all: 'true' }], ['star', { staff: ['*'] }]];
  for (const zoom of ['xs', 'm']) {
    let ref = null;
    for (const [label, flag] of variants) {
      const { ctx, page } = await staffPage(browser, origin, { flag, zoom, viewport: { width: 1440, height: 789 } });
      const b = await page.evaluate(boxes);
      const L = `switch off (${label}), size ${zoom}`;
      expect(!b.fit && !b.thumbVar, `${L}: the page is not marked`);
      // Nothing watches the Calendar body with the switch off (a watcher there on every Calendar page made WebKit
      // report a ResizeObserver loop error next to the review stage's own watcher, 31 Oct).
      const watching = await page.evaluate(() => (window.__roWatching ? window.__roWatching() : null));
      expect(Array.isArray(watching) && !watching.includes('calBody'), `${L}: no ResizeObserver watches #calBody (${JSON.stringify(watching)})`);
      if (!ref) {
        ref = b;
        expect(/ 80px /.test(' ' + b.main.split(' ').slice(4).join(' ') + ' ') || b.main.includes('80px'), `${L}: today's page padding (${b.main})`);
        expect(b.toolbar.endsWith('0px 0px 8px'), `${L}: today's toolbar spacing (${b.toolbar})`);
        expect(b.strip.includes('10px 4px 6px 48px'), `${L}: today's strip spacing (${b.strip})`);
      } else {
        expect(JSON.stringify(b) === JSON.stringify(ref), `${L}: identical to a page with no switch row (${JSON.stringify(b)} vs ${JSON.stringify(ref)})`);
      }
      await ctx.close();
    }
  }
}

// The staff phone layout is the same with the switch on.
async function phoneCase(browser, origin) {
  const m = async flag => {
    const { ctx, page } = await staffPage(browser, origin, { flag, zoom: 'xs', viewport: { width: 390, height: 844 }, mobile: true });
    const r = await page.evaluate(() => ({ fit: document.documentElement.classList.contains('sv-sheet-fit'), pageH: document.documentElement.scrollHeight,
      first: (() => { const e = document.querySelector('#calView .thumb-grid-card, #calStrip .cal-card'); if (!e) return ''; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(' '); })(),
      main: getComputedStyle(document.getElementById('mainWrap')).padding }));
    await ctx.close();
    return r;
  };
  const off = await m(undefined), on = await m({ staff: [ME] });
  expect(on.pageH === off.pageH && on.first === off.first && on.main === off.main, `staff phone 390: the same layout with the switch on (${JSON.stringify(on)} vs ${JSON.stringify(off)})`);
}

// The client link: named, it fits at its smallest size; not named, it is today's (three sizes, its old spacing).
async function clientCases(browser) {
  const server = await clientFixture.serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const open = async (flag, viewport) => {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await clientFixture.installFixture(ctx, origin, { ...clientFixture.BASE_ROW, id: 'p_unused' }, [], 'calendar');
    await ctx.route('**/rest/v1/calendar_posts*', r => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ ...clientFixture.BASE_ROW, id: 'p_c' + i, name: 'Client fixture ' + (i + 1), order_index: i + 1, status: 'Approved', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' }))) }));
    await ctx.route('**/rest/v1/syncview_runtime_flags*', r => {
      const u = new URL(r.request().url()); const raw = u.searchParams.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(keys.flatMap(k => k === 'sheet_fit_v1' ? (flag === undefined ? [] : [{ key: k, value: flag }]) : [{ key: k, value: k === 'prod_authority' ? { video: 'linear', graphics: 'linear' } : {} }])) });
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('syncview_calendar_prefs', JSON.stringify({ zoom: 'xs' })); } catch (e) {} });
    const page = await ctx.newPage();
    await page.goto(origin + '/index.html?c=Phone+Fixture+Client&t=synthetic-phone-token&v=calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-cal-view="organizer"]', { timeout: 20000 });
    await page.click('[data-cal-view="organizer"]');
    await page.waitForSelector('#calStrip .cal-card', { timeout: 20000 });
    await page.waitForTimeout(800);
    await settle(page);
    return { ctx, page };
  };
  for (const [label, w, h] of [['Mac 1440x900', 1440, 789], ['Windows 1280x720 150%', 1280, 587]]) {
    const { ctx, page } = await open({ clients: ['phonefixtureclient'] }, { width: w, height: h });
    const r = await page.evaluate(() => ({ fit: document.documentElement.classList.contains('sv-sheet-fit'), zoom: document.getElementById('calView').dataset.zoom,
      inner: innerHeight, pageH: document.documentElement.scrollHeight, cardBottom: Math.max(...[...document.querySelectorAll('#calStrip .cal-card')].map(e => e.getBoundingClientRect().bottom)) }));
    const L = `client link ${label}, switch names it`;
    expect(r.fit && r.zoom === 'xs', `${L}: on, at its saved smallest size (${r.zoom})`);
    expect(r.pageH <= r.inner && r.cardBottom <= r.inner, `${L}: the cards fit with no page scroll (page ${r.pageH}, window ${r.inner})`);
    await shot(page, `client-fit-${label}`);
    await ctx.close();
  }
  for (const [label, flag] of [['no row', undefined], ['staff only', { staff: [ME] }], ['another client', { clients: ['someoneelse'] }]]) {
    const { ctx, page } = await open(flag, { width: 1440, height: 789 });
    const r = await page.evaluate(() => ({ fit: document.documentElement.classList.contains('sv-sheet-fit'), zoom: document.getElementById('calView').dataset.zoom,
      outOff: document.getElementById('calZoomOut').disabled, main: getComputedStyle(document.getElementById('mainWrap')).paddingBottom }));
    const L = `client link, switch off (${label})`;
    expect(!r.fit && r.zoom === 's' && r.outOff && r.main === '80px', `${L}: today's page: three sizes, the saved smallest reads as s, old spacing (${JSON.stringify(r)})`);
    await ctx.close();
  }
  server.close();
}

async function launchOptional(type, opts) {
  try { return await type.launch(opts); } catch (e) { return null; }
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Chromium with overlay scrollbars (the Mac default) and with classic ones that take room (Windows).
  const overlay = await chromium.launch();
  const classic = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  const wk = await launchOptional(webkit);
  if (!wk && process.env.SHEET_FIT_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
  if (!wk) console.log('note: WebKit is not installed here; the WebKit cases run in CI (repair-checkpoint job)');
  try {
    await viewportCases('Chromium', overlay, origin, MAC, 'overlay');
    await viewportCases('Chromium', classic, origin, WIN, 'classic');
    if (wk) await viewportCases('WebKit', wk, origin, MAC.concat(WIN.slice(-1)), 'WebKit');
    await defaultSizeCases('Chromium', classic, origin);
    if (wk) await defaultSizeCases('WebKit', wk, origin);
    await wheelCases('Chromium', classic, origin);
    if (wk) await wheelCases('WebKit', wk, origin);
    await offCases(classic, origin);
    await phoneCase(overlay, origin);
    await clientCases(classic);
  } finally {
    await overlay.close(); await classic.close(); if (wk) await wk.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed, ${checks} passed.`); process.exit(1); }
  console.log(`\ncalendar sheet fits the window: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
