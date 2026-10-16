'use strict';
/* calendar-prod-button-icons-browser.js -- the two Production buttons in a
 * Calendar card's pile (video work item, thumbnail work item) each carry their
 * own icon and tooltip, fully offline, on fictional data.
 *
 *   Thumbnail button: a picture icon, tooltip "Open thumbnail".
 *   Video button: a play icon, tooltip "Open video".
 *   Both: same size, same outline style in their own colour, and each still
 *   opens its own work item in a new tab. Desktop (light, dark) and phone.
 *   The Samples card twin draws the same pair from the same helper.
 *
 * Run:  node docs/syncview-design/tests/calendar-prod-button-icons-browser.js
 * Pictures: set PROD_ICON_SHOTS=<dir> to write PNGs of the pile.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const shots = process.env.PROD_ICON_SHOTS;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const CLIENT = 'Glyph Fixture';
const SLUG = 'glyphfixture';
const PLAN_URL = 'https://example.invalid/plan';
const RAW_URL = 'https://example.invalid/raw-folder';
const FRAME_URL = 'https://app.frame.io/reviews/fixture-folder';
const THUMB_URL = 'https://example.invalid/thumb.png';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const DAY = 86400000;
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = Date.now();
const DELIVERABLES = [
  { id: 'del_hover_1', identifier: 'VID-142', title: 'Three myths about sleep: video edit', status: 'In Progress',
    status_at: new Date(now - 3 * DAY).toISOString(), assignee_id: 'm2', due_date: ymd(new Date(now - 3 * DAY)), updated_at: new Date(now - 2 * 3600000).toISOString() },
  { id: 'del_hover_2', identifier: 'VID-143', title: 'Morning routine reset: video edit', status: 'Review',
    status_at: new Date(now - 5 * 3600000).toISOString(), assignee_id: '', due_date: ymd(new Date(now + 4 * DAY)), updated_at: new Date(now - 20 * 60000).toISOString() },
  { id: 'del_glyph_3', identifier: 'GRA-77', title: 'Three myths about sleep: thumbnail', status: 'In Progress',
    status_at: new Date(now - 2 * DAY).toISOString(), assignee_id: '', due_date: ymd(new Date(now + 2 * DAY)), updated_at: new Date(now - 3600000).toISOString() },
];
const card = (id, name, date, vid, extra) => Object.assign({ id, client: SLUG, name, status: 'In Progress', order_index: Number(id.slice(-1)),
  updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: date, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  video_deliverable_id: vid, graphic_deliverable_id: '', caption: 'A made-up caption for a made-up video, long enough to wrap onto a second line.',
  comments: [], graphic_comments: [], caption_comments: [] }, extra || {});
const CARDS = [
  card('gl1', 'Three myths about sleep', '2026-10-15', 'del_hover_1', { thumbnail_url: THUMB_URL, graphic_deliverable_id: 'del_glyph_3' }),
  card('gl2', 'Morning routine reset', '2026-10-17', 'del_hover_2'),
];

let checks = 0; const failures = [];
function expect(v, m) { checks++; if (!v) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

async function newPage(browser, origin, theme, state, phone) {
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block', colorScheme: theme },
    phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 860 } }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.url() === THUMB_URL) return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(root, 'syncview-favicon.png')) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/brain') { state.brain++; return json({ ok: true, frame: [{ url: FRAME_URL, name: 'Batch', at: '2026-10-01' }], raw: [{ url: RAW_URL, name: 'Batch', at: '2026-10-01' }] }); }
    if (p === '/functions/v1/filming-plans') { state.plans++; return json({ ok: true, plans: [{ client_slug: SLUG, client_name: CLIENT, doc_url: PLAN_URL }] }); }
    if (p === '/rest/v1/production_deliverables_browser_v1') {
      if (/assignee_id,due_date,updated_at$/.test(u.searchParams.get('select') || '')) state.deliv++;
      const raw = u.searchParams.get('id') || '';
      const ids = raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',');
      return json(DELIVERABLES.filter(d => ids.includes(d.id)));
    }
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }, { id: 'm2', name: 'Alex Editor', role: 'editor', team: 'video', active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = u.searchParams.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) })));
    }
    if (p === '/rest/v1/calendar_posts') return json(CARDS);
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  return { ctx, page, errors };
}
async function openStaff(page, origin, theme) {
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(([c, t]) => { document.documentElement.setAttribute('data-theme', t); _syncviewStaffIdentityVerified = true; _calSavePins([c]); navTo('calendar'); }, [CLIENT, theme]);
  await page.waitForSelector('.cal-prod-btn', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.fonts.ready);
}

/* What each Production button in a card's pile looks like and where it goes. */
async function readPile(page, pid) {
  return page.evaluate((pid) => {
    const card = document.querySelector(`[data-linear-slot="${pid}"]`);
    if (!card) return null;
    return [...card.querySelectorAll('a.cal-prod-btn')].map(a => {
      const cs = getComputedStyle(a), r = a.getBoundingClientRect();
      const svg = a.querySelector('svg'), sr = svg && svg.getBoundingClientRect();
      return { which: a.classList.contains('cal-linear-btn-graphic') ? 'graphic' : 'video', href: a.getAttribute('href'), target: a.getAttribute('target'),
        tip: a.getAttribute('title') || a.getAttribute('data-tip') || '', aria: a.getAttribute('aria-label') || '', icon: svg ? svg.innerHTML : '',
        oldArrow: !!(svg && /M6 10\.2 10\.2 6M7\.2 6h3v3/.test(svg.getAttribute('d') || svg.innerHTML)),
        w: Math.round(r.width), h: Math.round(r.height), iw: sr ? Math.round(sr.width) : 0, ih: sr ? Math.round(sr.height) : 0,
        color: cs.color, border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, bg: cs.backgroundColor };
    });
  }, pid);
}

async function checkPile(page, label, phone) {
  const pile = await readPile(page, 'gl1');
  expect(pile && pile.length === 2, label + ': card with both work items shows two Production buttons');
  if (!pile || pile.length !== 2) return;
  const v = pile.find(b => b.which === 'video'), g = pile.find(b => b.which === 'graphic');
  expect(!v.oldArrow && !g.oldArrow, label + ': neither button uses the shared open-in-new-tab arrow');
  expect(v.icon !== g.icon, label + ': thumbnail and video buttons have different icons');
  expect(/<circle/.test(g.icon) && /<path/.test(g.icon), label + ': thumbnail button shows a picture icon');
  expect(/fill="currentColor"/.test(v.icon) && !/<circle/.test(v.icon), label + ': video button shows a play icon');
  expect(g.tip === 'Open thumbnail', label + ': thumbnail tooltip reads "Open thumbnail" (' + g.tip + ')');
  expect(v.tip === 'Open video', label + ': video tooltip reads "Open video" (' + v.tip + ')');
  expect(/d=del_hover_1(&|$)/.test(v.href) && /prod=1/.test(v.href), label + ': video button opens the video work item');
  expect(/d=del_glyph_3(&|$)/.test(g.href) && /prod=1/.test(g.href), label + ': thumbnail button opens the thumbnail work item');
  expect(v.target === '_blank' && g.target === '_blank', label + ': both still open in a new tab');
  expect(v.w === g.w && v.h === g.h && v.iw === g.iw && v.ih === g.ih, label + ': same button and icon size ' + JSON.stringify([v.w, v.h, v.iw, v.ih, g.w, g.h, g.iw, g.ih]));
  expect(v.color !== g.color, label + ': still two colours, one per component');
  if (!phone) expect(/solid/.test(v.border) && /solid/.test(g.border), label + ': both keep their solid outline');
  return { v, g };
}

async function pileShot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const box = await page.locator('[data-linear-slot="gl1"]').boundingBox();
  if (!box) return;
  const card = await page.locator('[data-linear-slot="gl1"]').evaluate(el => { const c = el.closest('.cal-card, .kcard') || el.parentElement; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const x = Math.max(0, card.x - 4), y = Math.max(0, card.y - 4);
  await page.screenshot({ path: path.join(shots, name + '.png'), clip: { x, y, width: Math.min(card.w + 8, 600), height: Math.min(card.h + 8, 520) }, animations: 'disabled' });
}

async function desktop(browser, origin, theme) {
  console.log(`--- Desktop, ${theme} ---`);
  const state = { brain: 0, plans: 0, deliv: 0 };
  const t = await newPage(browser, origin, theme, state, false);
  const { page } = t;
  await openStaff(page, origin, theme);
  await checkPile(page, 'desktop ' + theme);
  await pileShot(page, 'desktop-' + theme);

  // The tooltip really shows on hover, and the work item card still comes up.
  await page.locator('[data-linear-slot="gl1"] a.cal-linear-btn-graphic').hover();
  await page.waitForTimeout(400);
  const tipG = await page.evaluate(() => { const t = document.getElementById('globalTooltip'); return t && t.checkVisibility() ? t.innerText.trim() : ''; });
  expect(tipG === 'Open thumbnail', 'desktop ' + theme + ': hovering the thumbnail button shows "Open thumbnail" (' + tipG + ')');
  await page.locator('#calWorkCard').waitFor({ timeout: 5000 });
  expect(/GRA-77/.test(await page.locator('#calWorkCard').innerText()), 'desktop ' + theme + ': the work item card still shows beside it');
  if (shots && theme === 'light') await page.screenshot({ path: path.join(shots, 'desktop-hover-thumbnail.png'), clip: await (async () => { const b = await page.locator('[data-linear-slot="gl1"]').boundingBox(); return { x: Math.max(0, b.x - 220), y: Math.max(0, b.y - 120), width: 600, height: 300 }; })(), animations: 'disabled' });
  await page.mouse.move(5, 500);
  await page.waitForTimeout(150);
  await page.locator('[data-linear-slot="gl1"] a.cal-linear-btn-video').hover();
  await page.waitForTimeout(400);
  const tipV = await page.evaluate(() => { const t = document.getElementById('globalTooltip'); return t && t.checkVisibility() ? t.innerText.trim() : ''; });
  expect(tipV === 'Open video', 'desktop ' + theme + ': hovering the video button shows "Open video" (' + tipV + ')');
  await page.mouse.move(5, 500);

  // Clicking really opens the right work item in a new tab.
  for (const [cls, id] of [['video', 'del_hover_1'], ['graphic', 'del_glyph_3']]) {
    const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }), page.locator(`[data-linear-slot="gl1"] a.cal-linear-btn-${cls}`).click()]);
    const u = popup.url();
    expect(new URL(u).searchParams.get('d') === id && new URL(u).searchParams.get('prod') === '1', 'desktop ' + theme + ': clicking the ' + (cls === 'graphic' ? 'thumbnail' : 'video') + ' button opens ' + id + ' in a new tab');
    await popup.close();
  }

  // A card with only a video work item shows only the video button, with its own icon.
  const one = await readPile(page, 'gl2');
  expect(one && one.length === 1 && one[0].which === 'video' && one[0].tip === 'Open video' && !one[0].oldArrow, 'desktop ' + theme + ': a video-only card shows just the video button');
  expect(t.errors.length === 0, 'desktop ' + theme + ': no browser errors ' + JSON.stringify(t.errors));
  await t.ctx.close();
}

async function phone(browser, origin) {
  console.log('--- Phone, light ---');
  const state = { brain: 0, plans: 0, deliv: 0 };
  const t = await newPage(browser, origin, 'light', state, true);
  const { page } = t;
  await openStaff(page, origin, 'light');
  await checkPile(page, 'phone', true);
  await pileShot(page, 'phone-light');
  expect(t.errors.length === 0, 'phone: no browser errors ' + JSON.stringify(t.errors));
  await t.ctx.close();
}

async function samples(browser, origin) {
  // The Samples card draws the same pair from the same helper.
  console.log('--- Samples twin ---');
  const state = { brain: 0, plans: 0, deliv: 0 };
  const t = await newPage(browser, origin, 'light', state, false);
  const { page } = t;
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _sxrProdSlotHtml === 'function' || !!window.__svModules, null, { timeout: 30000 }).catch(() => {});
  const html = await page.evaluate(() => {
    const f = (typeof _sxrProdSlotHtml === 'function') ? _sxrProdSlotHtml : null;
    if (!f) return null;
    const p = { id: 'gl1', video_deliverable_id: 'del_hover_1', graphic_deliverable_id: 'del_glyph_3' };
    return { v: f(p, 'video'), g: f(p, 'graphic') };
  });
  if (html) {
    expect(/title="Open video"/.test(html.v) && /title="Open thumbnail"/.test(html.g), 'samples: tooltips match the Calendar');
    expect(!/M6 10\.2 10\.2 6/.test(html.v + html.g) && /<circle/.test(html.g) && !/<circle/.test(html.v), 'samples: same two icons as the Calendar');
  } else {
    console.log('  --  samples: helper not reachable from the page scope; covered by the source check below');
  }
  const src = fs.readFileSync(path.join(root, 'src/index/270-samples-model.js.part'), 'utf8');
  const fn = src.slice(src.indexOf('function _sxrProdSlotHtml'), src.indexOf('function _sxrProdSlotHtml') + 1600);
  expect(/_calProdBtnIconSvg\(which\)/.test(fn) && /_calProdBtnTip\(which\)/.test(fn) && !/M6 10\.2 10\.2 6/.test(fn), 'samples: _sxrProdSlotHtml draws the shared icons and tooltips');
  await t.ctx.close();
}

async function main() {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await desktop(browser, origin, 'light');
    await desktop(browser, origin, 'dark');
    await phone(browser, origin);
    await samples(browser, origin);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error('\ncalendar-prod-button-icons: ' + failures.length + ' FAILED'); process.exit(1); }
  console.log('\ncalendar-prod-button-icons: OK (' + checks + ' checks; desktop light and dark, phone, Samples twin)');
}
main().catch(e => { console.error(e); process.exit(1); });
