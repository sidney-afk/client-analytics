'use strict';

/*
 * "OPEN IN CALENDAR" BESIDE A WORK ITEM'S TITLE.
 *
 * 1. A work item made from a Calendar card (origin calendar, with a card id)
 *    shows one icon button right after its title in the top bar, with the
 *    tooltip "Open in Calendar", the same size as its icon-button neighbours.
 * 2. It opens a NEW tab on that card's address (#calendar/<client>/<card>),
 *    and that tab lands on the Calendar with exactly that card outlined.
 * 3. A Samples work item, or one with no card, shows no button.
 * 4. On a phone (390px) the button is 44px like its neighbours, sits on the
 *    one header row, and nothing scrolls sideways.
 *
 * Fixture names only; every outside request is answered by the mock below.
 * Set OPENCAL_SHOTS=<dir> to also save desktop and phone screenshots.
 * Run: node docs/syncview-design/tests/open-in-calendar-browser.js
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffIdentity } = require('../../../qa/staff-gate-seed.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
const NAME = 'Card Link Fixture';
const SLUG = 'cardlinkfixture';
const CARD = 'p_card_b';

let failures = 0;
function expect(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL open-in-calendar-browser: ' + message); }
}

// Answers the way GitHub Pages does: /x -> x.html, anything else -> 404.html.
function pagesServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const safe = path.normalize(p).replace(/^([.][\\/])+/, '');
    let file = path.join(ROOT, safe);
    let status = 200;
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (fs.existsSync(file + '.html')) file = file + '.html';
      else { file = path.join(ROOT, '404.html'); status = 404; }
    }
    res.writeHead(status, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const row = (id, identifier, team, title, extra) => ({ id, identifier, linear_identifier: identifier, raw_project_id: 'proj-fixture', client_slug: SLUG, team, title, status: 'in_progress', status_at: now, assignee_id: null, due_date: null, created_at: now, updated_at: now, ...extra });
  const deliverables = [
    row('del_cal', 'VID-9001', 'video', 'Video 1 · Calendar fixture title that is long enough to need cutting short on a narrow screen', { origin: 'calendar', card_id: CARD }),
    row('del_gra', 'GRA-9002', 'graphics', 'Thumbnail 1 · Calendar fixture', { origin: 'calendar', card_id: CARD }),
    row('del_samples', 'VID-9003', 'video', 'Sample fixture', { origin: 'samples', card_id: 'sample-card-1' }),
    row('del_none', 'VID-9004', 'video', 'No card fixture', { origin: 'production', card_id: null }),
    row('del_nocard', 'VID-9005', 'video', 'Calendar origin, card missing', { origin: 'calendar', card_id: null }),
  ];
  const clients = [{ slug: SLUG, display_name: NAME, active: true, kind: 'video', linear_project_ids: [{ id: 'proj-fixture' }] }];
  const posts = ['p_card_a', CARD, 'p_card_c'].map((id, i) => ({ id, client: SLUG, name: 'Card fixture ' + i, status: 'Draft', scheduled_date: today, sort_order: i }));

  const server = await pagesServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const shots = process.env.OPENCAL_SHOTS || '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
      if (/docs\.google\.com/.test(url)) {
        const csv = /Clients%20Info|Clients\+Info|Clients Info/.test(url) ? 'client_name\n' + NAME + '\n' : 'client_name,date\n';
        return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: csv });
      }
      if (/\/functions\/v1\/key-verify/.test(url)) return json({ ok: true, role: ADMIN.role, member: ADMIN });
      const rest = /\/rest\/v1\/([a-z0-9_]+)/.exec(url);
      if (rest) {
        const table = rest[1];
        const q = new URL(url).searchParams;
        if (table === 'calendar_posts' && String(q.get('client') || '') === 'eq.' + SLUG) return json(posts);
        if (table === 'clients') return json(clients);
        if (table === 'deliverables' || table === 'production_deliverables_browser_v1') {
          const id = String(q.get('id') || '').replace(/^eq\./, '');
          return json(id ? deliverables.filter(d => d.id === id) : deliverables);
        }
        return json([]);
      }
      return json({});
    });
    await seedStaffIdentity(context, ADMIN);

    const open = async (id, width, theme) => {
      const tab = await context.newPage();
      tab.on('pageerror', e => pageErrors.push(e.message));
      if (width) await tab.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await tab.goto(base + '/?prod=1&d=' + id + '#production', { waitUntil: 'domcontentloaded' });
      await tab.waitForSelector('[data-prod-detail="' + id + '"]', { timeout: 20000 });
      await tab.waitForSelector('.prod-detail-top', { timeout: 20000 });
      if (theme) await tab.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      return tab;
    };

    /* ---- desktop: shown for a Calendar work item, beside its title ---- */
    const desk = await open('del_cal');
    const btn = desk.locator('.prod-detail-top [data-prod-open-card]');
    expect(await btn.count() === 1, 'a Calendar work item shows one Open in Calendar button');
    expect(await btn.getAttribute('data-prod-tip') === 'Open in Calendar' && await btn.getAttribute('aria-label') === 'Open in Calendar', 'its tooltip and label say "Open in Calendar"');
    expect(await btn.getAttribute('target') === '_blank' && /noopener/.test(await btn.getAttribute('rel') || ''), 'it opens a new tab');
    const href = await btn.getAttribute('href');
    expect(/#calendar\/cardlinkfixture\/p_card_b$/.test(href || ''), 'it links to that exact card: ' + href);
    const spot = await desk.evaluate(() => {
      const r = el => { const q = el.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, right: q.right }; };
      const b = document.querySelector('[data-prod-open-card]');
      const title = document.querySelector('.prod-detail-top .prod-crumb-title');
      const dots = document.querySelector('.prod-detail-top > .prod-icon-btn:last-child');
      const top = document.querySelector('.prod-detail-top');
      return { b: r(b), title: r(title), dots: r(dots), top: r(top), prev: b.previousElementSibling && b.previousElementSibling.className };
    });
    expect(spot.prev === 'prod-detail-crumb', 'it sits right after the title in the top bar');
    expect(spot.b.x >= spot.title.right - 1 && spot.b.x - spot.title.right < 16, 'it is next to the title (' + Math.round(spot.b.x - spot.title.right) + 'px gap)');
    expect(Math.abs(spot.b.w - spot.dots.w) < 0.5 && Math.abs(spot.b.h - spot.dots.h) < 0.5, 'same size as the More options button (' + spot.b.w + 'x' + spot.b.h + ')');
    expect(Math.abs((spot.b.y + spot.b.h / 2) - (spot.dots.y + spot.dots.h / 2)) < 1.5, 'on the same line as its neighbours');
    await desk.locator('[data-prod-open-card]').hover();
    await desk.waitForTimeout(700);
    const tip = await desk.evaluate(() => Array.from(document.querySelectorAll('.prod-tooltip, [class*="prod-tip"]')).filter(el => el.getClientRects().length && /Open in Calendar/.test(el.textContent)).length);
    expect(tip >= 1, 'hovering shows the "Open in Calendar" tooltip');
    if (shots) await desk.screenshot({ path: path.join(shots, 'open-in-calendar-desktop-light.png') });

    /* ---- the click opens a new tab that lands on that card ---- */
    const before = desk.url();
    const [cal] = await Promise.all([context.waitForEvent('page'), desk.locator('[data-prod-open-card]').click()]);
    cal.on('pageerror', e => pageErrors.push(e.message));
    await cal.waitForLoadState('domcontentloaded');
    await cal.waitForFunction(() => !!document.querySelector('.cal-card-focused'), null, { timeout: 20000 }).catch(() => {});
    await cal.waitForTimeout(600);
    const landed = await cal.evaluate(() => {
      const el = document.querySelector('.cal-card-focused');
      return { nav: typeof currentNav !== 'undefined' ? currentNav : null, pid: el && el.getAttribute('data-pid'), path: location.pathname, focused: document.querySelectorAll('.cal-card-focused').length };
    });
    expect(landed.nav === 'calendar', 'the new tab opens the Calendar');
    expect(landed.pid === CARD && landed.focused === 1, 'with exactly that card opened and outlined (got ' + landed.pid + ')');
    expect(landed.path === '/calendar/' + SLUG + '/' + CARD, 'and the card stays in its address: ' + landed.path);
    expect(desk.url() === before, 'the SyncLinear tab stays where it was');
    if (shots) await cal.screenshot({ path: path.join(shots, 'open-in-calendar-landed.png') });
    await cal.close();

    /* a sub-issue of the same card (the thumbnail) links to the same card */
    const gra = await open('del_gra');
    expect(/#calendar\/cardlinkfixture\/p_card_b$/.test(await gra.locator('[data-prod-open-card]').getAttribute('href') || ''), 'a Graphics work item from the card links to the same card');
    await gra.close();
    await desk.close();

    /* ---- hidden when there is no Calendar card ---- */
    for (const [id, why] of [['del_samples', 'a Samples work item'], ['del_none', 'a work item with no card'], ['del_nocard', 'a Calendar-origin work item whose card id is empty']]) {
      const tab = await open(id);
      expect(await tab.locator('[data-prod-open-card]').count() === 0, why + ' shows no button');
      await tab.close();
    }

    /* ---- a narrow desktop window: the long title shortens, the button keeps its place ---- */
    const narrow = await open('del_cal', 820);
    const nw = await narrow.evaluate(() => {
      const b = document.querySelector('[data-prod-open-card]').getBoundingClientRect();
      const t = document.querySelector('.prod-detail-top .prod-crumb-title');
      const top = document.querySelector('.prod-detail-top').getBoundingClientRect();
      return { w: b.width, right: b.right, topRight: top.right, cut: t.scrollWidth > t.clientWidth, topH: top.height };
    });
    expect(nw.w === 25 && nw.right <= nw.topRight && nw.cut, 'at 820px the title is cut short and the button keeps its full size (' + nw.w + 'px)');
    await narrow.close();

    /* ---- phone ---- */
    for (const theme of ['light', 'dark']) {
      const phone = await open('del_cal', 390, theme);
      await phone.waitForTimeout(400);
      const ph = await phone.evaluate(() => {
        const b = document.querySelector('[data-prod-open-card]');
        const top = document.querySelector('.prod-detail-top');
        const dots = document.querySelector('.prod-detail-top > .prod-icon-btn:last-child');
        const q = b && b.getBoundingClientRect(); const t = top.getBoundingClientRect(); const d = dots.getBoundingClientRect();
        return { shown: !!q && b.getClientRects().length > 0, w: q && q.width, h: q && q.height, x: q && q.x, right: q && q.right, cy: q && q.y + q.height / 2,
          dw: d.width, dh: d.height, dcy: d.y + d.height / 2, topH: t.height, vw: window.innerWidth, scroll: document.documentElement.scrollWidth };
      });
      expect(ph.shown, `phone ${theme}: the button shows`);
      expect(Math.abs(ph.w - ph.dw) < 0.5 && Math.abs(ph.h - ph.dh) < 0.5 && ph.h >= 44, `phone ${theme}: same 44px size as its neighbours (${ph.w}x${ph.h})`);
      expect(Math.abs(ph.cy - ph.dcy) < 1.5 && ph.topH < 80, `phone ${theme}: on the one header row, no wrap (header ${Math.round(ph.topH)}px)`);
      expect(ph.x >= 0 && ph.right <= ph.vw && ph.scroll <= ph.vw + 1, `phone ${theme}: inside the screen, no sideways scroll`);
      if (shots) await phone.screenshot({ path: path.join(shots, `open-in-calendar-phone-${theme}.png`) });
      await phone.close();
    }
    if (shots) {
      const dark = await open('del_cal', 1280, 'dark');
      await dark.waitForTimeout(300);
      await dark.screenshot({ path: path.join(shots, 'open-in-calendar-desktop-dark.png') });
      await dark.close();
    }
    expect(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\nopen-in-calendar-browser: ${failures} check(s) failed`); process.exit(1); }
  console.log('\nopen-in-calendar-browser: all checks passed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
