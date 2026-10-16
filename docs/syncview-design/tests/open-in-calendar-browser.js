'use strict';

/*
 * "OPEN IN CALENDAR" BESIDE A WORK ITEM'S TITLE.
 *
 * 1. A work item made from a Calendar card (origin calendar, with a card id)
 *    shows one labelled button, the calendar icon and the words "Open in
 *    Calendar", right after its title in the top bar. It is drawn as the
 *    Calendar's Notify client button: same class, so the same pill shape,
 *    colour, size and hover, in light and dark.
 * 2. It opens a NEW tab on that card's address (#calendar/<client>/<card>),
 *    and that tab lands on the Calendar with exactly that card outlined.
 * 3. A Samples work item, or one with no card, shows no button.
 * 4. On a phone (390px and 430px) the header row has no room for it, so it
 *    drops to its own line under that row (44px tall, full label), the row
 *    above stays on one line with the id unsquashed, and nothing scrolls
 *    sideways.
 * 5. Opened from a card (from=, card=, cslug= in the address), SyncLinear
 *    shows "Back to card" instead, and Open in Calendar is hidden: it would
 *    only lead back to where the person came from. Exactly one of the two
 *    shows, on desktop and on a phone, and it stays that way when moving to
 *    another work item inside SyncLinear, after pressing Back to card and
 *    coming back, and (opened directly) when moving between work items.
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

    const open = async (id, width, theme, query) => {
      const tab = await context.newPage();
      tab.on('pageerror', e => pageErrors.push(e.message));
      if (width) await tab.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await tab.goto(base + '/?prod=1&d=' + id + (query || '') + '#production', { waitUntil: 'domcontentloaded' });
      await tab.waitForSelector('[data-prod-detail="' + id + '"]', { timeout: 20000 });
      await tab.waitForSelector('.prod-detail-top', { timeout: 20000 });
      if (theme) await tab.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      return tab;
    };

    /* ---- desktop: shown for a Calendar work item, beside its title ---- */
    const desk = await open('del_cal');
    const btn = desk.locator('.prod-detail-top [data-prod-open-card]');
    expect(await btn.count() === 1, 'a Calendar work item shows one Open in Calendar button');
    expect((await btn.innerText()).trim() === 'Open in Calendar' && await btn.locator('svg').count() === 1, 'it shows the words "Open in Calendar" with the calendar icon');
    expect(/\bnotify-client-btn\b/.test(await btn.getAttribute('class') || ''), 'it uses the Notify client button class');
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
    expect(Math.abs((spot.b.y + spot.b.h / 2) - (spot.dots.y + spot.dots.h / 2)) < 1.5, 'on the same line as its neighbours');
    /* the same look as a real Notify client button, drawn on this page for comparison */
    const LOOK = ['backgroundColor', 'color', 'borderRadius', 'height', 'paddingLeft', 'paddingRight', 'fontSize', 'fontWeight', 'borderTopWidth', 'gap'];
    const look = tab => tab.evaluate(keys => {
        const pick = el => { const c = getComputedStyle(el); const o = {}; keys.forEach(k => { o[k] = c[k]; }); return o; };
        const ref = document.createElement('button');
        ref.className = 'notify-client-btn'; ref.type = 'button'; ref.innerHTML = '<span>Notify client</span>';
        document.querySelector('.prod-detail-top').appendChild(ref);
        const want = pick(ref); ref.remove();
        return { got: pick(document.querySelector('[data-prod-open-card]')), want };
      }, LOOK);
    const same = (a, b, keys) => keys.every(k => a[k] === b[k]);
    const light = await look(desk);
    expect(same(light.got, light.want, LOOK), 'light: same pill shape, colour, size and font as Notify client (' + light.got.backgroundColor + ', ' + light.got.borderRadius + ', ' + light.got.height + ')');
    const hoverBg = await desk.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--notify-bg-hover').trim());
    await desk.locator('[data-prod-open-card]').hover();
    await desk.waitForTimeout(250);
    const hov = await desk.evaluate(() => getComputedStyle(document.querySelector('[data-prod-open-card]')).backgroundColor);
    const hexRgb = h => { const m = /^#([0-9a-f]{6})$/i.exec(h); if (!m) return h; const n = parseInt(m[1], 16); return 'rgb(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')'; };
    expect(hov === hexRgb(hoverBg) && hov !== light.got.backgroundColor, 'hover takes the Notify client hover colour (' + hov + ')');
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

    /* ---- opened from a card: Back to card shows, so Open in Calendar does not ---- */
    const ORIGIN = '&from=calendar&card=' + CARD + '&cslug=' + SLUG;
    const buttons = tab => tab.evaluate(() => {
      const seen = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const detail = document.querySelector('[data-prod-detail]');
      return {
        detail: detail && detail.getAttribute('data-prod-detail'),
        back: Array.from(document.querySelectorAll('.prod-back-card')).filter(seen).length,
        open: Array.from(document.querySelectorAll('[data-prod-open-card]')).filter(seen).length,
        scroll: document.documentElement.scrollWidth, vw: window.innerWidth,
      };
    });
    const showDetail = async (tab, id) => {
      await tab.evaluate(i => _prodOpenDeliverable(i), id);
      await tab.waitForSelector('[data-prod-detail="' + id + '"]', { timeout: 20000 });
      await tab.waitForTimeout(200);
    };
    const fromCard = await open('del_cal', 1280, null, ORIGIN);
    await fromCard.waitForSelector('.prod-back-card:visible', { timeout: 20000 });
    let fc = await buttons(fromCard);
    if (shots) await fromCard.screenshot({ path: path.join(shots, 'from-card-desktop.png') });
    expect(fc.back === 1, 'opened from a card: Back to card shows (' + fc.back + ')');
    expect(fc.open === 0, 'opened from a card: Open in Calendar is hidden (' + fc.open + ' shown)');
    await showDetail(fromCard, 'del_gra');
    fc = await buttons(fromCard);
    expect(fc.detail === 'del_gra' && fc.back === 1 && fc.open === 0, 'moving to another work item inside SyncLinear keeps Back to card and keeps Open in Calendar hidden');
    await fromCard.evaluate(() => _prodSetView('list'));
    await fromCard.waitForTimeout(300);
    await showDetail(fromCard, 'del_cal');
    fc = await buttons(fromCard);
    expect(fc.detail === 'del_cal' && fc.back === 1 && fc.open === 0, 'back on the first work item via the list, still only Back to card');
    await Promise.all([fromCard.waitForURL(/\/calendar\//, { timeout: 20000 }), fromCard.locator('.prod-back-card:visible').click()]);
    expect(/\/calendar\/cardlinkfixture\/p_card_b$/.test(new URL(fromCard.url()).pathname), 'Back to card goes to the card: ' + new URL(fromCard.url()).pathname);
    await fromCard.goBack({ waitUntil: 'domcontentloaded' });
    await fromCard.waitForSelector('[data-prod-detail="del_cal"]', { timeout: 20000 });
    await fromCard.waitForSelector('.prod-detail-top', { timeout: 20000 });
    await fromCard.waitForTimeout(300);
    fc = await buttons(fromCard);
    expect(fc.back === 1 && fc.open === 0, 'after Back to card and the browser Back button, still only Back to card (' + fc.back + '/' + fc.open + ')');
    await fromCard.close();

    /* the same rule for a Samples origin: its Back to card leads to the sample card */
    const fromSample = await open('del_cal', 1280, null, '&from=samples&card=sample-card-1&cslug=' + SLUG);
    await fromSample.waitForSelector('.prod-back-card:visible', { timeout: 20000 });
    fc = await buttons(fromSample);
    expect(fc.back === 1 && fc.open === 0, 'opened from a sample card: Back to card shows and Open in Calendar is hidden');
    await fromSample.close();

    /* opened directly: Open in Calendar stays, and stays when moving between work items */
    const direct = await open('del_cal');
    let dc = await buttons(direct);
    expect(dc.back === 0 && dc.open === 1, 'opened directly: Open in Calendar shows and Back to card does not');
    await showDetail(direct, 'del_gra');
    dc = await buttons(direct);
    expect(dc.detail === 'del_gra' && dc.back === 0 && dc.open === 1, 'opened directly, moving to another work item keeps Open in Calendar');
    await showDetail(direct, 'del_none');
    dc = await buttons(direct);
    expect(dc.back === 0 && dc.open === 0, 'and a work item with no card still shows neither');
    await showDetail(direct, 'del_cal');
    dc = await buttons(direct);
    expect(dc.back === 0 && dc.open === 1, 'and coming back to a Calendar work item shows Open in Calendar again');
    await direct.close();

    /* phone: from a card, only the Back to card strip; nothing scrolls sideways */
    for (const theme of ['light', 'dark']) {
      const phoneCard = await open('del_cal', 390, theme, ORIGIN);
      await phoneCard.waitForSelector('.prod-back-card:visible', { timeout: 20000 });
      await phoneCard.waitForTimeout(400);
      const pc = await buttons(phoneCard);
      if (shots) await phoneCard.screenshot({ path: path.join(shots, 'from-card-phone-' + theme + '.png') });
      expect(pc.back === 1 && pc.open === 0, `phone 390px ${theme}, opened from a card: one Back to card and no Open in Calendar (${pc.back}/${pc.open})`);
      expect(pc.scroll <= pc.vw + 1, `phone 390px ${theme}, opened from a card: no sideways scroll`);
      await showDetail(phoneCard, 'del_gra');
      const pg = await buttons(phoneCard);
      expect(pg.back === 1 && pg.open === 0, `phone 390px ${theme}: still only Back to card after moving to another work item`);
      await phoneCard.close();
    }

    /* ---- a narrow desktop window: the long title shortens, the button keeps its place ---- */
    const narrow = await open('del_cal', 820);
    const nw = await narrow.evaluate(() => {
      const b = document.querySelector('[data-prod-open-card]').getBoundingClientRect();
      const t = document.querySelector('.prod-detail-top .prod-crumb-title');
      const top = document.querySelector('.prod-detail-top').getBoundingClientRect();
      const a = document.querySelector('[data-prod-open-card]');
      return { w: b.width, natural: a.scrollWidth, right: b.right, topRight: top.right, cut: t.scrollWidth > t.clientWidth, topH: top.height, oneLine: a.getClientRects().length === 1 && b.height < 40 };
    });
    expect(nw.cut && nw.right <= nw.topRight && Math.abs(nw.w - nw.natural) < 1 && nw.oneLine && nw.topH <= 49, 'at 820px the title is cut short and the button keeps its full label on one line (' + Math.round(nw.w) + 'px)');
    await narrow.close();

    /* ---- phone: the header row is full, so the button drops under it ---- */
    for (const [width, theme] of [[390, 'light'], [390, 'dark'], [430, 'light']]) {
      const phone = await open('del_cal', width, theme);
      await phone.waitForTimeout(400);
      const ph = await phone.evaluate(() => {
        const b = document.querySelector('[data-prod-open-card]');
        const top = document.querySelector('.prod-detail-top');
        const back = top.querySelector(':scope > .prod-icon-btn:first-child');
        const crumb = top.querySelector('.prod-detail-crumb');
        const dots = top.querySelector(':scope > .prod-icon-btn:last-child');
        const q = b && b.getBoundingClientRect(); const t = top.getBoundingClientRect(); const d = dots.getBoundingClientRect();
        const k = back.getBoundingClientRect(); const c = crumb.getBoundingClientRect();
        const kid = window.getComputedStyle(crumb, '::after').content;
        return { shown: !!q && b.getClientRects().length > 0, text: b.innerText.trim(), h: q && q.height, x: q && q.x, y: q && q.y, right: q && q.right, bottom: q && q.bottom,
          rowBottom: Math.max(k.bottom, c.bottom, d.bottom), rowSame: Math.abs((k.y + k.height / 2) - (d.y + d.height / 2)) < 1.5 && Math.abs((c.y + c.height / 2) - (d.y + d.height / 2)) < 1.5,
          crumbFits: crumb.scrollWidth <= crumb.clientWidth + 1, crumbLabel: kid, left: k.x,
          topBottom: t.bottom, vw: window.innerWidth, scroll: document.documentElement.scrollWidth };
      });
      const tag = `phone ${width}px ${theme}`;
      expect(ph.shown && ph.text === 'Open in Calendar', `${tag}: the labelled button shows`);
      expect(ph.h >= 44, `${tag}: 44px tall like the Notify client button on a phone (${ph.h}px)`);
      expect(ph.rowSame && ph.crumbFits, `${tag}: Back, the id, Refresh and More options stay on one line, the id not squashed (${ph.crumbLabel})`);
      expect(ph.y >= ph.rowBottom && ph.bottom <= ph.topBottom, `${tag}: the button sits on its own line under the header row, inside the header`);
      expect(ph.x >= 0 && ph.right <= ph.vw && ph.scroll <= ph.vw + 1, `${tag}: inside the screen, no sideways scroll`);
      if (shots && width === 390) await phone.screenshot({ path: path.join(shots, `open-in-calendar-phone-${theme}.png`) });
      if (shots && width === 430) await phone.screenshot({ path: path.join(shots, 'open-in-calendar-phone-430.png') });
      await phone.close();
    }
    /* ---- dark desktop: the Notify client button's dark colours ---- */
    const dark = await open('del_cal', 1280, 'dark');
    await dark.waitForTimeout(300);
    const dk = await look(dark);
    expect(same(dk.got, dk.want, LOOK) && dk.got.backgroundColor !== light.got.backgroundColor, 'dark: same look as Notify client in dark (' + dk.got.backgroundColor + ' on ' + dk.got.color + ')');
    if (shots) await dark.screenshot({ path: path.join(shots, 'open-in-calendar-desktop-dark.png') });
    await dark.close();
    expect(pageErrors.length === 0, 'no page errors' + (pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures) { console.error(`\nopen-in-calendar-browser: ${failures} check(s) failed`); process.exit(1); }
  console.log('\nopen-in-calendar-browser: all checks passed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
