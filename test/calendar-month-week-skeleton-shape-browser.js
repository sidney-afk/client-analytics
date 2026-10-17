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
 * title, next, Today), the day-name row and the first two weeks of cells in
 * Month, the seven visible columns in Week. Tolerance 1px, except a Month row
 * holding a post may grow by up to 4px (its tile is taller than an empty day).
 *
 * Fully offline, fictional test client. Set SKELETON_SHAPE_SHOT_DIR to save
 * skeleton and loaded screenshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const NAME = 'Test Client';
const SHOTS = process.env.SKELETON_SHAPE_SHOT_DIR || '';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const TOL = 1;
const failures = [];
let checks = 0;
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else { checks++; } }

const card = (id, order) => ({
  id, client: SLUG, name: 'Test card ' + order, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: 'Short test caption.', cta: '', thumbnail_url: '', asset_url: '', comments: [], graphic_comments: [], caption_comments: [],
});
const CARDS = [1, 2, 3, 4, 5, 6, 7, 8].map(i => card('c' + i, i));

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
  const cells = [...b.querySelectorAll('.cal-month-head, .cal-month-cell')].slice(0, 21)
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

async function view(browser, origin, label, which, theme) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  const backend = await routeBackend(page, origin, {});
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof onCalViewChange === 'function', null, { timeout: 30000 });
  backend.hold = true;
  await page.evaluate(([n, v]) => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; navTo('calendar'); onCalViewChange(v); }, [NAME, which]);
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
  expect(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const which of ['month', 'week']) for (const theme of ['light', 'dark']) await view(browser, origin, `${which}-${theme}`, which, theme);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed, ${checks} passed.`); process.exit(1); }
  console.log(`\ncalendar month and week skeleton shape: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
