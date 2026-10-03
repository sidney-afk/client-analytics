'use strict';
/* staff-calendar-phone-browser.js -- the staff Calendar, Samples and Upload
 * tabs on a phone, fully offline (OPEN_REPAIRS 337, 338 and 339).
 *
 * Drives the real index.html in a real browser at phone sizes, in dark and in
 * light, against a made-up client whose every backend answer is local, and
 * proves on the Sheet, Review, Month and Week views:
 *   - no sideways scrolling;
 *   - Sheet cards are stacked full width, not a sideways strip;
 *   - an opened review card puts Video, Thumbnail and Caption in ONE column;
 *   - the view switcher and every toolbar button fit and are at least 44px;
 *   - Sheet fields are at least 44px tall and typing boxes use 16px text.
 * No request leaves the machine; nothing is saved. Fixture names only.
 *
 * STAFF_PHONE_SHOTS=<dir> also saves a full-page picture of every view.
 */
const fs = require('fs'), http = require('http'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const s = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const f = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    const full = path.join(root, path.normalize(f));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}

const CLIENT = 'Fixture Studio', SLUG = 'fixturestudio';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const CAP = 'Three small habits that make a filming day calmer: plan the first shot the night before, keep one spare battery charged, and write the caption while the idea is still warm. #fixture #phone';
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const base = { client: SLUG, updated_at: '2026-09-20T12:00:00.000Z', comments: [], graphic_comments: [], caption_comments: [], video_deliverable_id: '', graphic_deliverable_id: '' };
const cards = [
  { id: 'fx1', name: 'Morning routine reel', status: 'For SMM Approval', order_index: 1, scheduled_date: day(0), video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', caption_status: 'In Progress', asset_url: 'https://example.invalid/v1.mp4', caption: CAP, video_deliverable_id: 'd1', graphic_deliverable_id: 'd2' },
  { id: 'fx2', name: 'Behind the scenes', status: 'Approved', order_index: 2, scheduled_date: day(2), video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', asset_url: 'https://example.invalid/v2.mp4', caption: CAP, video_deliverable_id: 'd3', graphic_deliverable_id: 'd4' },
  { id: 'fx3', name: 'Client question of the week, with a longer title that wraps', status: 'Tweaks Needed', order_index: 3, scheduled_date: day(4), video_status: 'Tweaks Needed', graphic_status: 'Client Approval', caption_status: 'Client Approval', asset_url: 'https://example.invalid/v3.mp4', caption: CAP, video_deliverable_id: 'd5', graphic_deliverable_id: 'd6' },
  { id: 'fx4', name: 'Untitled idea', status: 'In Progress', order_index: 4, scheduled_date: null, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress' },
].map(c => Object.assign({}, base, c));

const VIEWPORTS = [['small Android', 360, 800], ['iPhone 13/14', 390, 844], ['iPhone 15 Pro Max', 430, 932]];
const SHOTS = process.env.STAFF_PHONE_SHOTS || '';

const SURFACES = {
  calendar: { root: '#calView', url: '/index.html?v=calendar', pins: '_calSavePins', nav: 'calendar', view: 'onCalViewChange', more: ['month', 'week'] },
  samples: { root: '#sxrView', url: '/index.html?v=sample-reviews&sxr=1', pins: '_sxrSavePins', nav: 'sample-reviews', view: 'onSxrViewChange', more: [] },
};

async function run(browser, origin, [vp, w, hgt], th, surface) {
  const S = SURFACES[surface]; const ROOT = S.root;
  const label = `${surface} ${vp} ${th}`; const failures = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(t => { try { if (t === 'dark') localStorage.setItem('syncview_theme', 'dark'); else localStorage.removeItem('syncview_theme'); } catch (e) {} }, th);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 160)));
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname, sp = u.searchParams;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Fixture Staff', role: 'admin', team: null } });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Fixture Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) })));
    }
    if (p === '/rest/v1/calendar_posts' || p === '/rest/v1/sample_reviews') return json(cards);
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(origin + S.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(fn => typeof _syncviewStaffCan === 'function' && (() => { try { return typeof (0, eval)(fn) === 'function'; } catch (e) { return false; } })(), S.pins, { timeout: 30000 });
  await page.evaluate(([c, fn, nav]) => { _syncviewStaffIdentityVerified = true; (0, eval)(fn)([c]); navTo(nav); }, [CLIENT, S.pins, S.nav]);
  await page.waitForSelector(ROOT + ' .cal-toolbar', { timeout: 20000 }).catch(() => failures.push(`${label}: the tab never drew`));
  const setView = k => page.evaluate(([fn, v]) => (0, eval)(fn)(v), [S.view, k]);
  await page.waitForTimeout(1500);

  const wide = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const shot = async view => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `staff-${surface === 'calendar' ? '' : surface + '-'}${view}-${w}-${th}.png`), fullPage: true });
  };
  const chrome = async view => {
    const m = await page.evaluate(ROOT => {
      const W = document.documentElement.clientWidth;
      const t = document.querySelector(ROOT + ' .cal-view-toggle').getBoundingClientRect();
      const small = [...document.querySelectorAll(ROOT + ' .cal-toolbar button')].filter(b => b.getClientRects().length && !b.closest('.dropdown-menu'))
        .map(b => { const r = b.getBoundingClientRect(); return { what: (b.getAttribute('aria-label') || b.title || b.innerText || b.className).trim().slice(0, 24), w: r.width, h: r.height }; }).filter(b => b.w < 44 || b.h < 44);
      const bar = [...document.querySelectorAll('.header .header-nav-btn, .header .sv-client-badge, .header .sv-jump-touch, .header #headerMenuButton')].filter(b => b.getClientRects().length)
        .map(b => { const r = b.getBoundingClientRect(); return { what: (b.getAttribute('aria-label') || b.innerText || b.id).trim().slice(0, 24), w: r.width, h: r.height }; }).filter(b => b.w < 44 || b.h < 44);
      return { W, right: t.right, small, bar };
    }, ROOT);
    if (m.right > m.W + 0.5) failures.push(`${label}: the view switcher is cut off on ${view}`);
    // The top bar every staff tab shares (OPEN_REPAIRS 340).
    for (const b of m.bar) failures.push(`${label}: top bar "${b.what}" is ${Math.round(b.w)}x${Math.round(b.h)}px, under 44px`);
    for (const b of m.small) failures.push(`${label}: ${view} toolbar "${b.what}" is ${Math.round(b.w)}x${Math.round(b.h)}px, under 44px`);
    if (await wide() > 0) failures.push(`${label}: ${view} scrolls sideways`);
    await shot(view);
  };

  // Sheet: a feed of full-width cards with thumb-sized fields.
  await setView('organizer'); await page.waitForTimeout(900);
  const sh = await page.evaluate(ROOT => {
    const W = document.documentElement.clientWidth; const strip = document.querySelector(ROOT + ' .cal-organizer-strip');
    const cs = [...strip.querySelectorAll(':scope > .cal-card')].map(c => c.getBoundingClientRect());
    const c = strip.querySelector('.cal-card');
    const small = [...c.querySelectorAll('.cal-date-chip, .cal-link-pill-open, .cal-fld-cta, .cal-comments-btn, .cal-fld-setall')].filter(e => e.getClientRects().length)
      .map(e => ({ what: String(e.className).split(' ')[0], h: e.getBoundingClientRect().height })).filter(x => x.h < 44);
    const fonts = [...c.querySelectorAll('textarea, input[type="text"]')].filter(e => e.getClientRects().length && !e.readOnly).map(e => parseFloat(getComputedStyle(e).fontSize)).filter(f => f < 16);
    return { W, n: cs.length, lefts: [...new Set(cs.map(r => Math.round(r.left)))], maxRight: Math.max(...cs.map(r => r.right)), small, fonts };
  }, ROOT);
  if (sh.n < 2 || sh.lefts.length !== 1) failures.push(`${label}: Sheet cards are not stacked in one column (${JSON.stringify(sh.lefts)})`);
  if (sh.maxRight > sh.W + 0.5) failures.push(`${label}: a Sheet card runs off the screen`);
  for (const x of sh.small) failures.push(`${label}: Sheet "${x.what}" is ${Math.round(x.h)}px tall, under 44px`);
  if (sh.fonts.length) failures.push(`${label}: a Sheet text field uses ${sh.fonts[0]}px text, under 16px (iOS will zoom)`);
  await chrome('sheet');

  // Review: one card opened, its pieces in one column.
  await setView('review'); await page.waitForTimeout(900);
  await page.locator(ROOT + ' .kcard-expand-btn').first().tap();
  await page.waitForSelector(ROOT + ' .cal-review-body', { timeout: 5000 }).catch(() => failures.push(`${label}: review card did not open`));
  await page.waitForTimeout(400);
  const rv = await page.evaluate(ROOT => {
    const c = document.querySelector(ROOT + ' .kcard.expanded'); if (!c) return null;
    const lefts = [...c.querySelectorAll('.cal-review-panel')].map(p => Math.round(p.getBoundingClientRect().left));
    const small = [...c.querySelectorAll('button, a, textarea')].filter(e => e.getClientRects().length)
      .map(e => { const r = e.getBoundingClientRect(); return { what: (e.getAttribute('aria-label') || e.innerText || e.className).trim().slice(0, 24), w: r.width, h: r.height }; }).filter(b => b.w < 44 || b.h < 44);
    return { lefts, small };
  }, ROOT);
  if (!rv) failures.push(`${label}: no opened review card`);
  else {
    if (rv.lefts.length < 2 || new Set(rv.lefts).size !== 1) failures.push(`${label}: review panels are not in one column (${JSON.stringify(rv.lefts)})`);
    for (const b of rv.small) failures.push(`${label}: review "${b.what}" is ${Math.round(b.w)}x${Math.round(b.h)}px, under 44px`);
  }
  await chrome('review');

  for (const v of S.more) { await setView(v); await page.waitForTimeout(800); await chrome(v); }
  if (errs.length) failures.push(`${label}: page errors: ${errs.slice(0, 2).join(' | ')}`);
  await ctx.close();
  return failures;
}

// The Upload tab (TikTok and Instagram), OPEN_REPAIRS 339: the title is not
// squeezed beside the platform switch, the switch and Post now are thumb-sized,
// typing boxes use 16px text, and the page never scrolls sideways.
async function runUpload(browser, origin, [vp, w, hgt], th) {
  const label = `upload ${vp} ${th}`; const failures = [];
  const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(t => { try { if (t === 'dark') localStorage.setItem('syncview_theme', 'dark'); else localStorage.removeItem('syncview_theme'); sessionStorage.setItem('syncview_ttpilot_unlocked', 'ok'); sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} }, th);
  const page = await ctx.newPage();
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Fixture Staff', role: 'admin', team: null } });
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navTo === 'function' && typeof _syncviewStaffCan === 'function', null, { timeout: 30000 });
  await page.evaluate(() => { _syncviewStaffIdentityVerified = true; navTo('tiktok-upload'); });
  const drew = await page.waitForSelector('.tk-page .tk-title', { timeout: 20000 }).then(() => true, () => false);
  if (!drew) { await ctx.close(); return [`${label}: the Upload tab never drew`]; }
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const W = document.documentElement.clientWidth; const box = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const small = [...document.querySelectorAll('.tk-page .tk-q-tab, .tk-page .tk-submit-btn, .tk-page .tk-seg .tk-radio, .tk-page .tk-opts-more')].filter(e => e.getClientRects().length)
      .map(e => ({ what: e.innerText.trim().slice(0, 20), h: e.getBoundingClientRect().height })).filter(x => x.h < 44);
    const fonts = [...document.querySelectorAll('.tk-page input[type="text"], .tk-page input[type="search"], .tk-page textarea')].filter(e => e.getClientRects().length).map(e => parseFloat(getComputedStyle(e).fontSize)).filter(f => f < 16);
    return { W, sw: document.documentElement.scrollWidth, title: box('.tk-page .tk-title').width, sw2: box('.tk-page .tk-platform-switch').width, page: box('.tk-page').width, small, fonts };
  });
  if (m.sw > m.W) failures.push(`${label}: the page scrolls sideways`);
  if (m.title < m.page * 0.6) failures.push(`${label}: the title is squeezed to ${Math.round(m.title)}px beside the platform switch`);
  if (m.sw2 < m.page * 0.8) failures.push(`${label}: the platform switch is not full width (${Math.round(m.sw2)}px)`);
  for (const x of m.small) failures.push(`${label}: "${x.what}" is ${Math.round(x.h)}px tall, under 44px`);
  if (m.fonts.length) failures.push(`${label}: a typing box uses ${m.fonts[0]}px text, under 16px (iOS will zoom)`);
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `staff-upload-${w}-${th}.png`), fullPage: true }); }

  // The Analytics overview (OPEN_REPAIRS 341): its wide table scrolls inside its
  // own box instead of sliding the whole page, and its controls are thumb-sized.
  await page.evaluate(() => document.getElementById('navHome').click());
  const ov = await page.waitForSelector('.overview-wrap .overview-table', { timeout: 15000 }).then(() => true, () => false);
  if (!ov) failures.push(`${label}: the Analytics overview never drew`);
  else {
    await page.waitForTimeout(600);
    const a = await page.evaluate(() => {
      const W = document.documentElement.clientWidth; const wrap = document.querySelector('.overview-wrap');
      const small = [...document.querySelectorAll('.overview-wrap .overview-controls button, #pageTop .pin-add-btn')].filter(e => e.getClientRects().length)
        .map(e => ({ what: (e.title || e.innerText).trim().slice(0, 20), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter(x => x.w < 44 || x.h < 44);
      return { W, sw: document.documentElement.scrollWidth, inner: wrap.scrollWidth > wrap.clientWidth, ctl: document.querySelector('.overview-controls').getBoundingClientRect().right, small,
        font: parseFloat(getComputedStyle(document.querySelector('#pageTop .search-bar-input')).fontSize) };
    });
    if (a.sw > a.W) failures.push(`${label}: the Analytics overview scrolls the whole page sideways (${a.sw}px in ${a.W}px)`);
    if (!a.inner) failures.push(`${label}: the Analytics table does not scroll inside its own box`);
    if (a.ctl > a.W + 0.5) failures.push(`${label}: the Analytics controls run off the screen`);
    for (const x of a.small) failures.push(`${label}: Analytics "${x.what}" is ${Math.round(x.w)}x${Math.round(x.h)}px, under 44px`);
    if (a.font < 16) failures.push(`${label}: the client search uses ${a.font}px text, under 16px (iOS will zoom)`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `staff-analytics-${w}-${th}.png`), fullPage: true });
  }

  // Other staff tabs whose phone pass is sizes only: every listed control is at
  // least 44px, every typing box uses 16px text, and the page does not scroll
  // sideways. One entry per tab; add a tab here when it gets its phone block.
  const SIZED = [
    { nav: 'navLinear', name: 'Submit', root: '.linear-view', controls: '.linear-input, .linear-search-input, .linear-video-remove, .linear-add-video-btn, .linear-submit-btn', typing: '.linear-input, .linear-search-input, .linear-textarea' },
    { nav: 'navWorkload', name: 'Workload toolbar', root: '.workload-toolbar', controls: '.workload-nav button, .workload-pills button, .dropdown-trigger, .wl-client-search-input', typing: '.wl-client-search-input' },
    { nav: 'navTemplates', name: 'Templates start', root: '.tpl-index-centered', controls: '.search-bar-pill, .pin-add-btn', typing: '.search-bar-input' },
    { nav: 'navFilmingPlans', name: 'Filming Plans start', root: '.fp-view', controls: '.search-bar-pill, .fp-btn', typing: '.search-bar-input' },
    { nav: 'navKasper', sub: 'replies', name: 'Kasper Messages', root: '.kasper-wrap', controls: '.kasper-subtab, .kasper-refresh-btn', oneRow: '.kasper-subtabs' },
    { nav: 'navKasper', sub: 'filming', name: 'Kasper Filming', root: '.kasper-wrap', controls: '.kasper-subtab, .kasper-refresh-btn, .ked-info-btn', oneRow: '.kasper-subtabs' },
  ];
  for (const t of SIZED) {
    await page.evaluate(id => document.getElementById(id).click(), t.nav);
    const drewTab = await page.waitForSelector(t.root, { timeout: 15000 }).then(() => true, () => false);
    if (!drewTab) { failures.push(`${label}: the ${t.name} tab never drew`); continue; }
    if (t.sub) { await page.evaluate(k => _kasperGotoTab(k), t.sub); }
    await page.waitForTimeout(700);
    const z = await page.evaluate(t => {
      const W = document.documentElement.clientWidth; const shown = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const small = [...document.querySelectorAll(t.controls.split(',').map(x => t.root + ' ' + x.trim()).join(','))].filter(shown)
        .map(e => ({ what: (e.getAttribute('aria-label') || e.title || e.placeholder || e.innerText || e.className).toString().trim().slice(0, 22), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })).filter(x => x.w < 44 || x.h < 44);
      const fonts = t.typing ? [...document.querySelectorAll(t.typing.split(',').map(x => t.root + ' ' + x.trim()).join(','))].filter(shown).map(e => parseFloat(getComputedStyle(e).fontSize)).filter(f => f < 16) : [];
      const row = t.oneRow ? [...new Set([...document.querySelectorAll(t.root + ' ' + t.oneRow + ' > *')].filter(shown).map(e => Math.round(e.getBoundingClientRect().top)))].length : 1;
      return { W, sw: document.documentElement.scrollWidth, small: small.slice(0, 6), fonts, row };
    }, t);
    if (z.row > 1) failures.push(`${label}: ${t.name} tab bar is stacked in ${z.row} rows instead of one`);
    if (z.sw > z.W) failures.push(`${label}: ${t.name} scrolls sideways (${z.sw}px in ${z.W}px)`);
    for (const x of z.small) failures.push(`${label}: ${t.name} "${x.what}" is ${Math.round(x.w)}x${Math.round(x.h)}px, under 44px`);
    if (z.fonts.length) failures.push(`${label}: a ${t.name} typing box uses ${z.fonts[0]}px text, under 16px (iOS will zoom)`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `staff-${t.name.toLowerCase().replace(/\W+/g, '-')}-${w}-${th}.png`), fullPage: true });
  }
  await ctx.close();
  return failures;
}

(async () => {
  const server = await serve(); const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(); let bad = 0;
  for (const surface of Object.keys(SURFACES)) for (const vp of VIEWPORTS) for (const th of ['dark', 'light']) {
    let f;
    try { f = await run(browser, origin, vp, th, surface); } catch (e) { f = [`${vp[0]} ${th}: ${String(e.message || e).split('\n')[0]}`]; }
    console.log((f.length ? 'FAIL ' : 'ok   ') + `staff ${surface} ${vp[0]} ${vp[1]}x${vp[2]} ${th}`);
    for (const x of f) console.log('       ' + x);
    bad += f.length;
  }
  for (const vp of VIEWPORTS) for (const th of ['dark', 'light']) {
    let f;
    try { f = await runUpload(browser, origin, vp, th); } catch (e) { f = [`upload ${vp[0]} ${th}: ${String(e.message || e).split('\n')[0]}`]; }
    console.log((f.length ? 'FAIL ' : 'ok   ') + `staff upload ${vp[0]} ${vp[1]}x${vp[2]} ${th}`);
    for (const x of f) console.log('       ' + x);
    bad += f.length;
  }
  await browser.close(); server.close();
  if (bad) { console.log(`\nstaff-calendar-phone: FAILED (${bad} problem(s))`); process.exit(1); }
  console.log('\nstaff-calendar-phone: OK (Calendar, Samples, Upload and the Analytics overview at 3 phone sizes, dark and light)');
})();
