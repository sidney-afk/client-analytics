'use strict';
/*
 * Staff Calendar Sheet: one more, smaller card size, and a strip that runs the
 * full width of the window (owner, 2026-10-31: "Can we make a card size that's
 * even more zoomed out? Like one more level. And when I scroll, the cards get
 * cut on the left and the right. It would be better if it went to the full
 * width of the viewport.").
 *
 * Before: three sizes (s, m, l), and the strip sat inside the page's 32px and
 * the Calendar's 16px gutters, so at 1440 its scroll area ran from x=48 to
 * x=1392 and every card was cut 48px short of each screen edge while
 * scrolling sideways.
 * After: a fourth, smallest size ('xs', 212px cards) that keeps the title,
 * the thumbnail, the status pills and every control, and is saved like the
 * others; the strip's scroll area spans the window edge to edge, while the
 * first card still lines up with the toolbar at rest.
 *
 * Checked: 1280, 1440 and 1920 wide (strip spans the window, nothing scrolls
 * the page sideways, first card on the toolbar's edge, a card mid-scroll is
 * cut only by the window); at 1440 the - button reaches the new size, every
 * control of a card at that size sits inside the card, and the size survives a
 * reload; the staff phone layout and the client link keep their own strip.
 *
 * Fully offline, fictional client and cards. SHEET_WIDTH_SHOT_DIR saves a
 * screenshot per width and per size.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const NAME = 'Test Client';
const SHOTS = process.env.SHEET_WIDTH_SHOT_DIR || '';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const TOL = 1;
const failures = [];
let checks = 0;
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else { checks++; } }

const CARDS = Array.from({ length: 14 }, (_, i) => ({
  id: 'c' + (i + 1), client: SLUG, name: 'Test card ' + (i + 1), status: 'In Progress', order_index: i + 1,
  updated_at: '2026-10-08T12:00:00.000Z', scheduled_date: '', video_status: 'In Progress', graphic_status: 'In Progress',
  caption_status: 'In Progress', caption: 'Short test caption.', cta: '', thumbnail_url: '', asset_url: '',
  comments: [], graphic_comments: [], caption_comments: [],
}));

async function routeBackend(page, origin) {
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
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
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function openSheet(page, origin) {
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await page.evaluate(n => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; navTo('calendar'); }, NAME);
  await page.waitForFunction(() => document.querySelector('#calView'), null, { timeout: 15000 });
  await page.evaluate(() => { if (calState.view !== 'organizer') { calState.view = 'organizer'; _calRenderShell(); _calRenderBody(); } });
  return page.waitForSelector('#calStrip .cal-card', { timeout: 20000 }).then(() => true, () => false);
}

// The strip's scroll area against the window, and what it shows.
function stripGeometry() {
  const strip = document.getElementById('calStrip');
  const s = strip.getBoundingClientRect();
  const tb = document.querySelector('#calView .cal-toolbar').getBoundingClientRect();
  const first = strip.querySelector('.cal-card').getBoundingClientRect();
  return { left: s.left, right: s.right, vw: document.documentElement.clientWidth, pageScrollW: document.documentElement.scrollWidth,
    toolbarLeft: tb.left, firstLeft: first.left, scrollable: strip.scrollWidth > strip.clientWidth };
}

// Scroll part way so a card's middle sits on one window edge: its visible
// part must reach that edge, not stop at a gutter inside it.
async function midScroll(page) {
  return page.evaluate(() => {
    const strip = document.getElementById('calStrip');
    const vw = document.documentElement.clientWidth;
    const cards = [...strip.querySelectorAll('.cal-card')];
    const at = (edge) => {
      strip.scrollLeft = 0;
      // A card whose middle is past this edge at rest, so scrolling brings it there.
      const card = cards.find((e, i) => i >= 2 && e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2 > edge);
      const c = card.getBoundingClientRect();
      strip.scrollLeft = Math.round(c.left + c.width / 2 - edge);
      const r = card.getBoundingClientRect();
      const x = edge === 0 ? 2 : vw - 3;
      const hit = document.elementFromPoint(x, Math.round(r.top + 60));
      return { cut: r.left < edge && r.right > edge, shows: !!(hit && hit.closest('.cal-card') === card) };
    };
    const left = at(0), right = at(vw);
    return { leftCut: left.cut, rightCut: right.cut, leftShowsCard: left.shows, rightShowsCard: right.shows };
  });
}

async function widths(browser, origin) {
  for (const width of [1280, 1440, 1920]) {
    const label = `desktop ${width}`;
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
    await seedStaffGate(page);
    await routeBackend(page, origin);
    expect(await openSheet(page, origin), `${label}: the Sheet cards load`);
    await page.waitForTimeout(500);
    for (const zoom of ['xs', 's', 'm', 'l']) {
      await page.evaluate(z => { calState.zoom = z; _calApplyZoom(); document.getElementById('calStrip').scrollLeft = 0; }, zoom);
      await page.waitForTimeout(150);
      const g = await page.evaluate(stripGeometry);
      expect(Math.abs(g.left) <= TOL, `${label} ${zoom}: the strip's scroll area starts at the window's left edge (got ${Math.round(g.left)})`);
      expect(Math.abs(g.right - g.vw) <= TOL, `${label} ${zoom}: the strip's scroll area ends at the window's right edge (got ${Math.round(g.right)} of ${g.vw})`);
      expect(g.pageScrollW <= g.vw + TOL, `${label} ${zoom}: the page does not scroll sideways (${g.pageScrollW} > ${g.vw})`);
      expect(Math.abs(g.firstLeft - g.toolbarLeft) <= TOL && g.firstLeft >= 16, `${label} ${zoom}: at rest the first card lines up with the toolbar, off the screen edge (card ${Math.round(g.firstLeft)}, toolbar ${Math.round(g.toolbarLeft)})`);
      expect(g.scrollable, `${label} ${zoom}: the fixture scrolls sideways`);
      await shot(page, `${width}-zoom-${zoom}-start`);
      const m = await midScroll(page);
      expect(m.leftCut && m.rightCut, `${label} ${zoom}: mid-scroll a card crosses each window edge`);
      expect(m.leftShowsCard, `${label} ${zoom}: mid-scroll the card reaches the window's left edge (no gutter cuts it)`);
      expect(m.rightShowsCard, `${label} ${zoom}: mid-scroll the card reaches the window's right edge (no gutter cuts it)`);
      await shot(page, `${width}-zoom-${zoom}-scrolled`);
    }
    expect(errors.length === 0, `${label}: no page errors (${errors.join(' | ')})`);
    await ctx.close();
  }
}

// The - button reaches the new smallest size; that card keeps its title,
// thumbnail, status pills and every control; the size is saved.
async function smallest(browser, origin) {
  const label = 'desktop 1440 smallest size';
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await seedStaffGate(page);
  await routeBackend(page, origin);
  expect(await openSheet(page, origin), `${label}: the Sheet cards load`);
  await page.evaluate(() => { calState.zoom = 'm'; _calApplyZoom(); });
  let presses = 0;
  while (presses < 6 && await page.locator('#calZoomOut').isEnabled()) { await page.locator('#calZoomOut').click(); presses++; }
  const z = await page.evaluate(() => ({ zoom: document.getElementById('calView').dataset.zoom, outOff: document.getElementById('calZoomOut').disabled,
    inOn: !document.getElementById('calZoomIn').disabled, w: document.querySelector('#calStrip .cal-card').getBoundingClientRect().width }));
  expect(presses === 2, `${label}: from the default size the - button goes down two steps (pressed ${presses})`);
  expect(z.zoom === 'xs', `${label}: the smallest step is the new one (got ${z.zoom})`);
  expect(z.outOff && z.inOn, `${label}: at the smallest step - is off and + is on`);
  expect(Math.round(z.w) === 212, `${label}: cards are 212px wide (got ${Math.round(z.w)})`);
  const card = await page.evaluate(() => {
    const c = document.querySelector('#calStrip .cal-card');
    const cr = c.getBoundingClientRect();
    const vis = e => e && e.checkVisibility({ checkVisibilityCSS: true }) && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    const inside = e => { const r = e.getBoundingClientRect(); return r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5; };
    const controls = [...c.querySelectorAll('button, input:not([type=hidden]), textarea, select, [role="button"]')].filter(vis);
    const title = c.querySelector('.cal-fld-name');
    return {
      title: vis(title) && title.value === 'Test card 1' && title.getBoundingClientRect().width >= 120,
      thumb: vis(c.querySelector('.cal-card-thumb')) && c.querySelector('.cal-card-thumb').getBoundingClientRect().height >= 120,
      pills: [...c.querySelectorAll('.cal-fld-substatus-trigger')].filter(vis).filter(inside).length,
      setAll: vis(c.querySelector('.cal-fld-setall')),
      outside: controls.filter(e => !inside(e)).map(e => e.className || e.tagName),
      count: controls.length,
    };
  });
  expect(card.title, `${label}: the title shows`);
  expect(card.thumb, `${label}: the thumbnail shows`);
  expect(card.pills === 3, `${label}: the three status pills show inside the card (got ${card.pills})`);
  expect(card.setAll, `${label}: Set all shows`);
  expect(card.count >= 8 && card.outside.length === 0, `${label}: every control sits inside the card (${card.count} controls; outside: ${card.outside.join(', ')})`);
  await shot(page, 'smallest-1440');
  // Saved: a reload opens at the same size.
  const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('syncview_calendar_prefs') || '{}').zoom; } catch (e) { return null; } });
  expect(saved === 'xs', `${label}: the size is saved with the calendar preferences (got ${saved})`);
  expect(await openSheet(page, origin), `${label}: the Sheet loads again after a reload`);
  const after = await page.evaluate(() => ({ zoom: document.getElementById('calView').dataset.zoom, outOff: document.getElementById('calZoomOut').disabled }));
  expect(after.zoom === 'xs' && after.outOff, `${label}: after a reload the Sheet opens at the smallest size (got ${after.zoom})`);
  // And + climbs back through every size to the largest.
  let ups = 0;
  while (ups < 6 && await page.locator('#calZoomIn').isEnabled()) { await page.locator('#calZoomIn').click(); ups++; }
  expect(ups === 3, `${label}: + goes up three steps from the smallest to the largest (pressed ${ups})`);
  await ctx.close();
}

// The staff phone layout keeps its own strip.
async function phone(browser, origin) {
  const label = 'staff phone 390';
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await seedStaffGate(page);
  await routeBackend(page, origin);
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await page.evaluate(n => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; calState.zoom = 'xs'; _calSavePrefs(); navTo('calendar'); }, NAME);
  await page.waitForSelector('#calView .thumb-grid-card, #calStrip .cal-card', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const strip = document.querySelector('#calView .cal-organizer-strip');
    const cs = strip && getComputedStyle(strip);
    return { strip: !!strip, margin: cs ? cs.marginLeft + ' ' + cs.marginRight : '', pad: cs ? cs.paddingLeft : '',
      pageScrollW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
  });
  expect(!m.strip || m.margin === '0px 0px', `${label}: the phone strip keeps no bleed (margins ${m.margin})`);
  expect(!m.strip || m.pad === '0px', `${label}: the phone strip keeps its own padding (got ${m.pad})`);
  expect(m.pageScrollW <= m.vw + TOL, `${label}: the page does not scroll sideways`);
  await shot(page, 'phone-390');
  await ctx.close();
}

// The client link is untouched: every full-width and smallest-size rule is
// written for staff only.
function clientRulesStaffOnly() {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src/index/020-styles-surfaces.css.part'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '..', 'src/index/010-styles-foundation.css.part'), 'utf8');
  const rules = css.split('\n').filter(l => /--cal-strip-bleed|data-zoom="xs"|data-boot-cal-zoom|margin-inline: -48px/.test(l) && /\{/.test(l));
  expect(rules.length >= 6, `client link: the new rules are found (${rules.length})`);
  for (const r of rules) {
    const sel = r.slice(0, r.indexOf('{')).trim();
    expect(sel === '.cal-view[data-zoom="xs"]' || /:not\(\.boot-client\)/.test(sel), `client link: a new rule is staff-only: ${sel.slice(0, 120)}`);
  }
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await widths(browser, origin);
    await smallest(browser, origin);
    await phone(browser, origin);
    clientRulesStaffOnly();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed, ${checks} passed.`); process.exit(1); }
  console.log(`\ncalendar sheet full width and smallest size: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
