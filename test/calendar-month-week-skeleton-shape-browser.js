'use strict';
/*
 * Staff Calendar Month and Week: the loading skeleton has the shape of what
 * loads (owner, 2026-10-17: "Every skeleton should match the actual shape of
 * what is loading").
 *
 * Before: Month drew a narrow grid in the middle of the page with no month
 * name or day labels, under a gap; Week drew pills in seven columns of another
 * size. After: both draw the loaded view's own header, day labels and grid,
 * with no posts, so the posts land in place.
 *
 * How: fixture cards, every backend call answered locally; the cards' read is
 * held back, the skeleton measured, then released and the loaded view measured
 * at the same size. Checked on desktop, light and dark: the header (previous,
 * title, next, Today), the day-name row and every day cell in Month (1440,
 * plus 1280 and 1920 in light), the seven visible columns in Week, on two
 * pinned days: 15 Oct 2026 (five weeks) and 1 Nov 2026 (six weeks, posts in
 * the first rows). Tolerance 1px, except a Month row holding a post may grow
 * by up to 4px.
 *
 * The undated strip (OPEN_REPAIRS 632): the staff "Unscheduled" tray and the
 * client link's "Not scheduled yet" list sit above the grid and used to appear
 * only once the posts landed, dropping the whole grid by their height (249px on
 * the client link at 1440). Now the skeleton draws them from the count the last
 * visit remembered for that client. Checked for staff and the client link at
 * 1440 and 390 (on a client phone the strip is the folded row): with no memory
 * there is no strip in the skeleton; with memory the strip and the month header
 * are where they land and, at 1440, every day cell too; a strip that turns out
 * empty closes without the grid ever moving down, and at once with reduced
 * motion; and a browser whose storage refuses writes still loads.
 *
 * Fully offline, fictional test client. Set SKELETON_SHAPE_SHOT_DIR to save
 * skeleton and loaded screenshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');
const F = require('./fixtures/review-stage-fixture.js');

const SLUG = 'fixtureclient';
const NAME = 'Test Client';
const SHOTS = process.env.SKELETON_SHAPE_SHOT_DIR || '';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const TOL = 1;
const failures = [];
let checks = 0;
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else { checks++; } }

// Dates around a fixed "today" (three days before to four after), so the posts are in the week and month the
// views open on, and the page's clock pinned to the same day. Two days are proven: 15 Oct 2026 (a five-week month,
// the posts in its middle rows) and 1 Nov 2026 (a six-week month, a Sunday, the posts in its first two rows).
// Until 1 Nov this test measured only the first two weeks, which in mid-October held no post, so it never saw that
// a day with one post is taller than an empty day (main red from 1 Nov; OPEN_REPAIRS 625).
const DAYS = [['oct', new Date(2026, 9, 15, 12, 0, 0)], ['nov', new Date(2026, 10, 1, 12, 0, 0)]];
let TODAY = DAYS[0][1];
const isoFromToday = days => { const d = new Date(TODAY); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const card = (id, order) => ({
  id, client: SLUG, name: 'Test card ' + order, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: isoFromToday(order - 4), video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: 'Short test caption.', cta: '', thumbnail_url: '', asset_url: '', comments: [], graphic_comments: [], caption_comments: [],
});
const cards = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => card('c' + i, i));
let CARDS = cards();
const undatedCard = i => Object.assign(card('u' + i, 20 + i), { name: 'Undated test card ' + i, scheduled_date: '' });
const MEMO_KEY = 'syncview_cal_undated_v1';

function sameBox(a, b) { return a && b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= TOL); }
function show(b) { return b ? `${b.x},${b.y} ${b.w}x${b.h}` : 'missing'; }
function compare(label, skel, real) {
  expect(skel.length === real.length, `${label}: ${skel.length} skeleton boxes for ${real.length} loaded boxes`);
  real.forEach((b, i) => expect(sameBox(skel[i], b), `${label} #${i + 1}: skeleton ${show(skel[i])}, loaded ${show(b)}`));
}

function measure() {
  const box = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const b = document.getElementById('calBody');
  if (!b) return { header: [], cells: [] };
  const header = [...b.querySelectorAll('.cal-month-header > *')].map(box);
  const cells = [...b.querySelectorAll('.cal-month-head, .cal-month-cell')]
    .concat([...b.querySelectorAll('.cal-week-col')].filter(e => { const r = e.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; }))
    .map(box);
  return { header, cells };
}

async function routeBackend(page, origin, opts) {
  let release; const held = new Promise(r => { release = r; });
  const state = { hold: false, release };
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) {
      if (opts.noApp && /\/js\/sv-/.test(r.url())) return route.abort();
      return route.continue();
    }
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : { enabled: false } })));
    }
    if (p === '/rest/v1/calendar_posts') {
      if (state.hold) await held;
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(CARDS.filter(c => !one || c.id === one));
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p) || /n8n\.cloud$/.test(u.hostname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  return state;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function view(browser, origin, label, which, theme, viewport, zoom) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: viewport || { width: 1440, height: 900 } });
  await ctx.clock.setFixedTime(TODAY);
  await ctx.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  const backend = await routeBackend(page, origin, {});
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof onCalViewChange === 'function', null, { timeout: 30000 });
  backend.hold = true;
  await page.evaluate(([n, v, z]) => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; navTo('calendar'); if (z) calState.zoom = z; onCalViewChange(v); }, [NAME, which, zoom || '']);
  await page.waitForTimeout(900);
  const skel = await page.evaluate(measure);
  await shot(page, `${label}-skeleton`);
  backend.release();
  const loaded = await page.waitForSelector(which === 'month' ? '#calBody .cal-month-pill' : '#calBody .cal-week-col .cal-month-pill, #calBody .cal-week-col [onclick*="openCalPreview"]', { timeout: 20000 }).then(() => true, () => false);
  expect(loaded, `${label}: the posts load`);
  await page.waitForTimeout(800);
  const real = await page.evaluate(measure);
  await shot(page, `${label}-loaded`);
  expect(real.header.length === 4 && real.cells.length >= 7, `${label}: the loaded view has its header and grid (${real.header.length} header items, ${real.cells.length} cells)`);
  compare(`${label} header`, skel.header, real.header);
  expect(skel.cells.length === real.cells.length, `${label}: ${skel.cells.length} skeleton cells for ${real.cells.length} loaded cells`);
  real.cells.forEach((b, i) => {
    const s = skel.cells[i];
    const ok = s && Math.abs(s.x - b.x) <= TOL && Math.abs(s.w - b.w) <= TOL && Math.abs(s.y - b.y) <= 4 && b.h - s.h >= -TOL && b.h - s.h <= 4;
    expect(ok, `${label} cell #${i + 1}: skeleton ${show(s)}, loaded ${show(b)}`);
  });
  if (zoom) expect(await page.evaluate(z => (document.querySelector('.cal-view') || {}).dataset?.zoom === z, zoom), `${label}: the Month view is at card size ${zoom}`);
  expect(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

/* ── The undated strip (OPEN_REPAIRS 632) ────────────────────────────────────────────────────────────────── */
function stripMeasure() {
  const box = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const b = document.getElementById('calBody');
  const strips = b ? [...b.querySelectorAll('.cal-unscheduled-top')] : [];
  const below = b && b.querySelector('.cal-month-grid, .cal-week-viewport');
  return {
    skeleton: !!(b && b.querySelector('.cal-grid-skeleton, .cal-skeleton-loader')),
    header: b ? [...b.querySelectorAll('.cal-month-header > *')].map(box) : [],
    strips: strips.map(box),
    folded: strips.map(e => e.classList.contains('cal-notyet') && getComputedStyle(e.querySelector('.cal-notyet-tog')).display !== 'none'),
    cells: b ? [...b.querySelectorAll('.cal-month-head, .cal-month-cell')].map(box) : [],
    grid: box(below),
  };
}
// Every frame for ms: the top of the grid (or the phone timeline) below the strip, and whether the room is closing.
function watchGridTop(ms) {
  return new Promise(resolve => {
    const out = []; const t0 = performance.now();
    const tick = () => {
      const b = document.getElementById('calBody');
      const g = b && b.querySelector('.cal-month-grid, .cal-week-viewport, .pocket-cal-timeline-loading');
      out.push({ top: g ? Math.round(g.getBoundingClientRect().top) : null, closing: !!(b && b.querySelector('.cal-undated-collapse')), skel: !!(b && b.querySelector('.cal-grid-skeleton, .cal-skeleton-loader')) });
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  });
}
function compareStrips(label, skel, real, cellsToo) {
  expect(real.strips.length > 0, `${label}: the loaded view has its undated strip`);
  compare(`${label} header`, skel.header, real.header);
  compare(`${label} undated strip`, skel.strips, real.strips);
  expect(JSON.stringify(skel.folded) === JSON.stringify(real.folded), `${label}: the skeleton strip is folded as the loaded one is (${skel.folded} / ${real.folded})`);
  if (cellsToo) compare(`${label} day cells`, skel.cells, real.cells);
  else expect(!!skel.grid === false || !real.grid || skel.strips.length === real.strips.length, `${label}: same strips`);
}
// The collapse: the room closes from where the skeleton had the grid, never moving it down, to where it loads.
function checkCollapse(label, frames, reduced) {
  const skelTop = (frames.filter(f => f.skel).pop() || {}).top;
  const after = frames.filter(f => !f.skel && f.top != null);
  expect(skelTop != null && after.length > 0, `${label}: saw the skeleton and then the loaded view`);
  if (skelTop == null || !after.length) return;
  const maxAfter = Math.max(...after.map(f => f.top));
  expect(maxAfter <= skelTop + TOL, `${label}: the grid never moves down after the skeleton (skeleton ${skelTop}, lowest loaded ${maxAfter})`);
  const last = after[after.length - 1].top;
  expect(last < skelTop - 20, `${label}: the room closes (grid ${skelTop} -> ${last})`);
  if (reduced) {
    expect(!frames.some(f => f.closing), `${label}: with reduced motion the room closes at once, no animation`);
    expect(after[0].top === last, `${label}: with reduced motion the first loaded frame is already in place (${after[0].top} vs ${last})`);
  } else {
    expect(frames.some(f => f.closing), `${label}: the room closes smoothly (a closing spacer was drawn)`);
    const steps = after.filter((f, i) => i && f.top !== after[i - 1].top).length;
    expect(steps >= 3, `${label}: it closes over several frames (${steps} steps)`);
    for (let i = 1; i < after.length; i++) if (after[i].top > after[i - 1].top + TOL) { expect(false, `${label}: the grid moved down mid-close (${after[i - 1].top} -> ${after[i].top})`); break; }
  }
}

async function staffUndated(browser, origin, width) {
  const phone = width < 768;
  const label = `undated staff ${width}`;
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block', viewport: phone ? { width, height: 844 } : { width, height: 900 } }, phone ? { isMobile: true, hasTouch: true } : {}));
  await ctx.clock.setFixedTime(TODAY);
  const errors = [];
  // Each visit starts with no saved copy of the posts (a week old, or a first visit on this browser), which is when
  // staff see the skeleton at all: with a fresh copy the posts paint from it at once.
  const openMonth = async (hold) => {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
    await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('syncview_calCache_v2:')) localStorage.removeItem(k); } catch (e) {} });
    await seedStaffGate(page);
    const backend = await routeBackend(page, origin, {});
    backend.hold = hold;   // before the boot: a pinned client's posts are read during it
    await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof onCalViewChange === 'function', null, { timeout: 30000 });
    await page.evaluate(n => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; navTo('calendar'); onCalViewChange('month'); }, NAME);
    return { page, backend };
  };
  // 1. No memory yet: the skeleton draws no strip, as before.
  CARDS = cards().concat([1, 2, 3, 4, 5].map(undatedCard));
  const a = await openMonth(true);
  await a.page.waitForTimeout(900);
  const first = await a.page.evaluate(stripMeasure);
  expect(first.skeleton && first.strips.length === 0, `${label}: with no memory the skeleton draws no strip (${first.strips.length})`);
  a.backend.release();
  await a.page.waitForSelector('#calBody .cal-unscheduled-top', { timeout: 20000 }).catch(() => {});
  await a.page.waitForTimeout(600);
  const memo = await a.page.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } }, MEMO_KEY);
  const ids = Object.keys(memo);
  expect(ids.length === 1 && /^staff:/.test(ids[0]) && String((memo[ids[0]] || {}).t || '').length === 5, `${label}: the visit remembers 5 undated pills for this client (${JSON.stringify(memo)})`);
  await a.page.close();
  // 2. Memory: the strip is in the skeleton where it lands.
  const b = await openMonth(true);
  await b.page.waitForTimeout(900);
  const skel = await b.page.evaluate(stripMeasure);
  await shot(b.page, `${label.replace(/ /g, '-')}-skeleton`);
  b.backend.release();
  await b.page.waitForSelector('#calBody .cal-month-pill:not(.cal-month-pill-reserve)', { timeout: 20000 }).catch(() => {});
  await b.page.waitForTimeout(800);
  const real = await b.page.evaluate(stripMeasure);
  await shot(b.page, `${label.replace(/ /g, '-')}-loaded`);
  expect(skel.skeleton && skel.strips.length === 1, `${label}: the skeleton draws the remembered strip (${skel.strips.length})`);
  compareStrips(label, skel, real, !phone);
  await b.page.close();
  // 3. Everything got a date since: the strip in the skeleton closes, smoothly, then with reduced motion at once.
  CARDS = cards();
  for (const reduced of [false, true]) {
    // The empty visit above forgot the strip; remember it again, as the earlier visit wrote it.
    if (reduced) await ctx.addInitScript(([k, id, v]) => { try { localStorage.setItem(k, JSON.stringify({ [id]: v })); } catch (e) {} }, [MEMO_KEY, ids[0], memo[ids[0]]]);
    const c = await openMonth(true);
    if (reduced) await c.page.emulateMedia({ reducedMotion: 'reduce' });
    await c.page.waitForTimeout(900);
    const watching = c.page.evaluate(watchGridTop, 1400);
    await c.page.waitForTimeout(150);
    c.backend.release();
    const frames = await watching;
    checkCollapse(`${label} empty${reduced ? ' reduced motion' : ''}`, frames, reduced);
    if (!reduced) {
      const after = await c.page.evaluate(k => localStorage.getItem(k), MEMO_KEY);
      expect(!after || !/staff:/.test(after), `${label}: an empty strip is forgotten, so the next skeleton reserves nothing (${after})`);
    }
    await c.page.close();
  }
  expect(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

async function clientUndated(browser, origin, width) {
  const phone = width < 768;
  const label = `undated client link ${width}`;
  const undated = cards => { for (let i = 0; i < 6; i++) cards.push({ id: 'ru' + i, client: F.SLUG, name: 'Undated idea ' + (i + 1), status: 'Approved', order_index: 60 + i, updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: '', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', asset_url: F.FRAME, thumbnail_url: '', caption: 'No date yet.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] }); };
  const fixtureCards = F.cards('client'); undated(fixtureCards);
  const state = { cards: fixtureCards, upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0, postsDelay: 2500 };
  const t = await F.openClient(browser, origin, { state, flags: 'on', polish: true, width, height: phone ? 844 : 900, context: phone ? { hasTouch: true, isMobile: true } : {} });
  // The client link opens on Review; a client who taps Month before the posts land sees the Month skeleton.
  const openMonth = async (page) => {
    await page.waitForFunction(() => typeof calState === 'object' && calState.loading && typeof onCalViewChange === 'function', null, { timeout: 30000 });
    await page.evaluate(() => onCalViewChange('month'));
    await page.waitForSelector('#calBody .cal-grid-skeleton, #calBody .cal-skeleton-loader', { timeout: 20000 });
    await page.waitForTimeout(300);
  };
  await openMonth(t.page);
  const first = await t.page.evaluate(stripMeasure);
  expect(first.strips.length === 0, `${label}: with no memory the skeleton draws no strip (${first.strips.length})`);
  await t.page.waitForFunction(() => !calState.loading, null, { timeout: 20000 });
  await t.page.waitForTimeout(600);
  const visit = async () => {
    const page = await t.ctx.newPage();
    page.on('pageerror', e => t.errors.push(String(e.message || e).slice(0, 200)));
    await page.goto(origin + '/index.html?' + new URLSearchParams({ c: F.CLIENT, v: 'calendar', t: F.TOKEN }), { waitUntil: 'domcontentloaded' });
    return page;
  };
  const p2 = await visit();
  await openMonth(p2);
  const skel = await p2.evaluate(stripMeasure);
  await shot(p2, `${label.replace(/ /g, '-')}-skeleton`);
  await p2.waitForFunction(() => !calState.loading, null, { timeout: 20000 });
  await p2.waitForTimeout(800);
  const real = await p2.evaluate(stripMeasure);
  await shot(p2, `${label.replace(/ /g, '-')}-loaded`);
  expect(skel.strips.length === 1, `${label}: the skeleton draws the remembered "Not scheduled yet" strip (${skel.strips.length})`);
  if (phone) expect(real.folded[0] === true, `${label}: on a phone the strip is the folded row`);
  compareStrips(label, skel, real, !phone);
  await p2.close();
  // Every post got a date since: the remembered strip closes without the grid moving down.
  state.cards = F.cards('client');
  const p3 = await visit();
  await openMonth(p3);
  const frames = await p3.evaluate(watchGridTop, 3600);
  checkCollapse(`${label} empty`, frames, false);
  await p3.close();
  expect(t.errors.length === 0, `${label}: no page errors (${t.errors.join(' | ')})`);
  await t.ctx.close();
}

// Storage that refuses every write: the Calendar still loads, with no reserve and no error.
async function storageRefuses(browser, origin) {
  const label = 'undated storage refuses';
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await ctx.clock.setFixedTime(TODAY);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await page.addInitScript(k => {
    const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
    Storage.prototype.setItem = function (key, v) { if (key === k) throw new Error('QuotaExceededError'); return set.call(this, key, v); };
    Storage.prototype.getItem = function (key) { if (key === k) throw new Error('SecurityError'); return get.call(this, key); };
  }, MEMO_KEY);
  CARDS = cards().concat([1, 2, 3].map(undatedCard));
  await routeBackend(page, origin, {});
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof onCalViewChange === 'function', null, { timeout: 30000 });
  await page.evaluate(n => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; navTo('calendar'); onCalViewChange('month'); }, NAME);
  const ok = await page.waitForSelector('#calBody .cal-unscheduled-top .cal-month-pill', { timeout: 20000 }).then(() => true, () => false);
  expect(ok, `${label}: the Month and its undated strip still load`);
  expect(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [day, today] of process.env.SKELETON_ONLY_UNDATED ? [] : DAYS) {
      TODAY = today; CARDS = cards();
      for (const which of ['month', 'week']) for (const theme of ['light', 'dark']) await view(browser, origin, `${day} ${which}-${theme}`, which, theme);
      // Month at the other desktop sizes: its tile is as wide as a day, so a day's height follows the window width.
      for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) await view(browser, origin, `${day} month-light ${vp.width}`, 'month', 'light', vp);
      // And at the smaller and larger tile sizes: the tile's height follows the card size (--cal-month-w).
      for (const zoom of ['s', 'l']) await view(browser, origin, `${day} month-light zoom ${zoom}`, 'month', 'light', null, zoom);
    }
    TODAY = DAYS[0][1];
    for (const width of [1440, 390]) await staffUndated(browser, origin, width);
    for (const width of [1440, 390]) await clientUndated(browser, origin, width);
    await storageRefuses(browser, origin);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed, ${checks} passed.`); process.exit(1); }
  console.log(`\ncalendar month and week skeleton shape: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
