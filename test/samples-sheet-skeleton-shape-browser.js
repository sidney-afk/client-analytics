'use strict';
/*
 * Staff Samples Sheet and Review: the loading skeleton has the shape of what loads (owner,
 * 2026-10-17: "Every skeleton should match the actual shape of what is
 * loading").
 *
 * Before: while the samples loaded, the Sheet drew three small list cards in
 * the middle of the page; the loaded Sheet is a strip of tall cards.
 * After: a strip of cards at the loaded cards' boxes, row for row (title, two
 * links, creative direction, Notes, Set all, two status rows). The Review tab
 * drew the same three small cards; it now draws the loaded list's wide cards
 * (thumbnail, title, the "needs approval" line, chips, two buttons). The
 * Review count badge no longer makes the toolbar 3px taller when it arrives.
 *
 * How: fixture samples, every backend call answered locally; the samples'
 * read is held back, the skeleton measured, released, the loaded Sheet
 * measured at the same size. Desktop, light and dark. Tolerance 1px.
 * Fully offline, fictional test client. SKELETON_SHAPE_SHOT_DIR saves shots.
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
  id, client: SLUG, client_slug: SLUG, name: 'Test card ' + order, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: 'Short test caption.', cta: '', thumbnail_url: '', asset_url: '', comments: [], graphic_comments: [], caption_comments: [],
});
const CARDS = [1, 2, 3, 4, 5, 6, 7, 8].map(i => card('c' + i, i));
// The Review tab lists samples waiting on the SMM, with their links.
const REVIEW_CARDS = CARDS.map((c, i) => Object.assign({}, c, { video_status: 'For SMM Approval', graphic_status: 'For SMM Approval',
  asset_url: 'https://drive.google.com/file/d/fixturevideo' + i + '/view', thumbnail_url: 'https://drive.google.com/file/d/fixturethumb' + i + '/view' }));
let SERVE = CARDS;

function sameBox(a, b) { return a && b && ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= TOL); }
function show(b) { return b ? `${b.x},${b.y} ${b.w}x${b.h}` : 'missing'; }
function compare(label, skel, real) {
  expect(skel.length === real.length, `${label}: ${skel.length} skeleton boxes for ${real.length} loaded boxes`);
  real.forEach((b, i) => expect(sameBox(skel[i], b), `${label} #${i + 1}: skeleton ${show(skel[i])}, loaded ${show(b)}`));
}

// Boxes, in page order, of what the person sees. `which` picks skeleton or loaded.
function measure(which) {
  const box = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const vis = e => e && e.getClientRects().length && e.getBoundingClientRect().width > 0;
  const firstVisible = sel => [...document.querySelectorAll(sel)].find(vis);
  const inView = e => e.getBoundingClientRect().left < innerWidth;
  if (which === 'skeleton') {
    const phone = firstVisible('.cal-sk-phone');
    if (phone) return { phone: [phone.querySelector('.cal-sk-phone-bar'), phone.querySelector('.cal-sk-phone-display'), ...[...phone.querySelectorAll('.cal-sk-phone-tile')].filter(e => e.getBoundingClientRect().top < innerHeight)].map(box) };
    const tbS = document.querySelector('#sxrView .cal-toolbar');
    const kc = [...document.querySelectorAll('#sxrBody .cal-sk-kcard')];
    if (kc.length) return { tb: [box(tbS)], review: kc.filter(e => e.getBoundingClientRect().top < innerHeight).map(box),
      inner: [...kc[0].querySelectorAll('.cal-sk-kcard-thumb, .cal-sk-kcard-main > *, .cal-sk-kcard-chips > *, .cal-sk-kcard-btn')].map(box) };
    const root = document.querySelector('#sxrBody .cal-sheet-skeleton');
    if (!root) return {};
    const cards = [...root.querySelectorAll('.cal-sk-card')].filter(vis).filter(inView);
    const c = cards[0];
    const tb = root.querySelector('.cal-sk-toolbar');
    return {
      cards: cards.map(box),
      thumb: c ? [box(c.querySelector('.cal-skeleton-thumb'))] : [],
      rows: c ? [...c.querySelectorAll('.cal-sk-body > *, .cal-sk-status-row > *')].map(box) : [],
      toolbar: tb && vis(tb) ? [box(tb), ...[...tb.querySelectorAll('.sv-skeleton')].map(box)] : null,
    };
  }
  const bar = document.querySelector('#calView .thumb-collection-bar');
  if (bar && vis(bar)) return { phone: [bar, bar.querySelector('.thumb-display'), ...[...document.querySelectorAll('#calView .thumb-grid-card')].filter(e => e.getBoundingClientRect().top < innerHeight)].map(box) };
  const tbL = document.querySelector('#sxrView .cal-toolbar');
  const kl = [...document.querySelectorAll('#sxrBody .kcard')];
  if (kl.length) return { tb: [box(tbL)], review: kl.filter(e => e.getBoundingClientRect().top < innerHeight).map(box),
    inner: [...kl[0].querySelectorAll('.kcard-thumb, .kcard-main > *, .cal-review-sub-row > *, .kcard-actions > button')].map(box) };
  const cards = [...document.querySelectorAll('#sxrBody .cal-card')].filter(vis).filter(inView);
  const c = cards[0];
  const tb = document.querySelector('#calView .cal-toolbar');
  const tbBox = tb && tb.getBoundingClientRect();
  const items = tb ? [...tb.querySelectorAll('.cal-toolbar-mid > *, .cal-toolbar-right > *')].filter(vis)
    .filter(e => { const r = e.getBoundingClientRect(); return r.top >= tbBox.top && r.bottom <= tbBox.bottom; }) : [];
  return {
    cards: cards.slice(0, 6).map(box),
    thumb: c ? [box(c.querySelector('.cal-card-thumb'))] : [],
    rows: c ? [...c.querySelectorAll('.cal-card-body > *, .cal-card-substatus-row > *')].filter(vis).map(box) : [],
    sheet: !!document.querySelector('#sxrBody .cal-sheet-skeleton'),
    toolbar: tb ? [box(tb), ...items.map(box)] : null,
  };
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
    if (p === '/rest/v1/sample_reviews') {
      if (state.hold) await held;
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(SERVE.filter(c => !one || c.id === one));
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

// In the app: open the Sheet with the cards' read held, measure, release, measure.
async function inApp(browser, origin, label, viewport, theme, review) {
  SERVE = review ? REVIEW_CARDS : CARDS;
  const phone = viewport.width < 500;
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, colorScheme: theme, isMobile: phone, hasTouch: phone });
  await ctx.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  const backend = await routeBackend(page, origin, {});
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof onSxrPickClient === 'function' && typeof onSxrViewChange === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  backend.hold = true;
  await page.evaluate(([n, r]) => { _syncviewStaffIdentityVerified = true; navTo('samples'); onSxrPickClient(n); if (r) onSxrViewChange('smmreview'); }, [NAME, !!review]);
  await page.waitForFunction(() => document.querySelector('#sxrBody [role="status"]'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const skel = await page.evaluate(measure, 'skeleton');
  await shot(page, `${label}-skeleton`);
  backend.release();
  const loaded = await page.waitForSelector(review ? '#sxrBody .kcard' : '#sxrBody .cal-card', { timeout: 20000 }).then(() => true, () => false);
  expect(loaded, `${label}: the cards load`);
  await page.waitForTimeout(800);
  const real = await page.evaluate(measure, 'loaded');
  await shot(page, `${label}-loaded`);
  if (review) {
    expect(Array.isArray(skel.review), `${label}: the skeleton is the Review list`);
    compare(`${label} toolbar`, skel.tb || [], real.tb || []);
    compare(`${label} list cards`, (skel.review || []).slice(0, (real.review || []).length), real.review || []);
    compare(`${label} first card insides`, skel.inner || [], real.inner || []);
  } else if (phone) {
    expect(Array.isArray(skel.phone), `${label}: the skeleton shows the phone grid (got ${Object.keys(skel).join(',') || 'nothing'})`);
    // The skeleton draws three rows of tiles; the fixture fills two and a half.
    // Every loaded tile must sit on a skeleton tile.
    compare(`${label} posts bar, switch and tiles`, (skel.phone || []).slice(0, (real.phone || []).length), real.phone || []);
  } else {
    expect((skel.cards || []).length > 0, `${label}: the skeleton is a strip of cards`);
    compare(`${label} cards`, skel.cards || [], real.cards.slice(0, (skel.cards || []).length || real.cards.length));
    compare(`${label} thumbnail`, skel.thumb || [], real.thumb);
    compare(`${label} first card rows`, skel.rows || [], real.rows);
  }
  expect(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`);
  await ctx.close();
  return real;
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const desk = { width: 1440, height: 900 };
    await inApp(browser, origin, 'samples-desktop-light', desk, 'light');
    await inApp(browser, origin, 'samples-desktop-dark', desk, 'dark');
    await inApp(browser, origin, 'samples-review-desktop-light', desk, 'light', true);
    await inApp(browser, origin, 'samples-review-desktop-dark', desk, 'dark', true);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed, ${checks} passed.`); process.exit(1); }
  console.log(`\nsamples sheet and review skeleton shape: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
