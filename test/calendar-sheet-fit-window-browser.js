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
const MAC = [['Mac 1440x900', 1440, 789], ['Mac 1512x982', 1512, 871], ['Mac 1728x1117', 1728, 1006], ['Mac 1280x800', 1280, 689]];
const WIN = [['Windows 1920x1080 100%', 1920, 947], ['Windows 1536x864 125%', 1536, 731], ['Windows 1280x720 150%', 1280, 587],
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

async function wheelCases(engineName, browser, origin) {
  // On: the cards fit, so a plain vertical wheel slides them, on a card, on the toolbar and under the cards.
  {
    const L = `${engineName} wheel, switch on, cards fit`;
    const { ctx, page } = await staffPage(browser, origin, { flag: { staff: [ME] }, zoom: 'xs', viewport: { width: 1440, height: 789 }, reduced: true });
    const r = await page.evaluate(fitReport);
    expect(r.pageH <= r.inner, `${L}: nothing scrolls up or down`);
    const card = await page.locator('#calStrip .cal-card').nth(1).locator('.cal-card-thumb').boundingBox();
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(150);
    let left = await page.evaluate(() => document.getElementById('calStrip').scrollLeft);
    expect(left >= 200, `${L}: a real wheel over a card slides the cards sideways (${left}px)`);
    const tb = await page.locator('#calView .cal-toolbar').boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 4);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);
    const left2 = await page.evaluate(() => document.getElementById('calStrip').scrollLeft);
    expect(left2 - left >= 150, `${L}: the wheel over the toolbar slides the cards too (${left2 - left}px)`);
    expect(await page.evaluate(() => scrollY) === 0, `${L}: the page did not move up or down`);
    // At once, with no animation (reduced motion is on in this context).
    const sync = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaY: 100 }]);
    expect(sync.prevented && sync.moved === 100, `${L}: the cards move at once by the wheel's distance (${sync.moved}px)`);
    // Left alone: any sideways movement, Shift, Ctrl, a caption, an open menu.
    const swipe = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaX: 30, deltaY: 12 }]);
    expect(!swipe.prevented && swipe.moved === 0, `${L}: a trackpad or Magic Mouse swipe (deltaX) is left to the browser`);
    const shift = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaY: 100, shiftKey: true }]);
    expect(!shift.prevented && shift.moved === 0, `${L}: Shift+wheel is left to the browser`);
    const zoomGesture = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaY: 100, ctrlKey: true }]);
    expect(!zoomGesture.prevented && zoomGesture.moved === 0, `${L}: a pinch or Ctrl+wheel zoom is left to the browser`);
    const cap = await page.evaluate(wheelAt, ['#calStrip .cal-card textarea.cal-fld-cap', { deltaY: 100 }]);
    expect(!cap.prevented && cap.moved === 0, `${L}: never inside a caption`);
    await page.locator('#calView .cal-organize .dropdown-trigger').first().click();
    await page.waitForSelector('#calView .cal-organize .dropdown-menu.open', { timeout: 5000 }).catch(() => {});
    const menu = await page.evaluate(wheelAt, ['#calView .cal-organize .dropdown-menu.open .dropdown-item, #calView .cal-organize .dropdown-menu.open', { deltaY: 100 }]);
    expect(!menu.prevented && menu.moved === 0, `${L}: never inside an open menu`);
    await shot(page, `${engineName}-wheel-on`);
    await ctx.close();
  }
  // On, but a big size on a short window: the page scrolls up and down, and so does the wheel.
  {
    const L = `${engineName} wheel, switch on, cards taller than the window`;
    const { ctx, page } = await staffPage(browser, origin, { flag: { staff: [ME] }, zoom: 'l', viewport: { width: 1366, height: 635 } });
    const r = await page.evaluate(fitReport);
    expect(r.pageH > r.inner, `${L}: the page scrolls as it always did (page ${r.pageH}, window ${r.inner})`);
    const card = await page.locator('#calStrip .cal-card').nth(1).locator('.cal-card-thumb').boundingBox();
    await page.mouse.move(card.x + card.width / 2, card.y + 20);
    const w = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaY: 100 }]);
    expect(!w.prevented && w.moved === 0, `${L}: the wheel is left to scroll the page up and down`);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ y: scrollY, left: document.getElementById('calStrip').scrollLeft }));
    expect(after.y > 0 && after.left === 0, `${L}: a real wheel scrolls the page down (${after.y}px) and leaves the cards (${after.left}px)`);
    await ctx.close();
  }
  // Off: today's wheel. Over the strip it slides the cards (the old strip handler); over the toolbar it does nothing.
  {
    const L = `${engineName} wheel, switch off`;
    const { ctx, page } = await staffPage(browser, origin, { flag: undefined, zoom: 'xs', viewport: { width: 1440, height: 789 } });
    const strip = await page.evaluate(wheelAt, ['#calStrip .cal-card .cal-card-thumb', { deltaY: 100 }]);
    expect(strip.prevented && strip.moved === 100, `${L}: over the cards the wheel slides them as it did before (${strip.moved}px)`);
    const tb = await page.evaluate(wheelAt, ['#calView .cal-toolbar', { deltaY: 100 }]);
    expect(!tb.prevented && tb.moved === 0, `${L}: over the toolbar the wheel does nothing new`);
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
