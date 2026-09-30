'use strict';
/* calendar-frame-folder-button-browser.js -- the Frame.io folder button on
 * Calendar cards, end to end, fully offline.
 *
 * Drives the real page in a real browser against a synthetic client whose
 * every backend answer is local, and proves:
 *   - staff see the button on every card, at the TOP of the pile (above the
 *     SyncView production button), opening the client's saved Frame folder in
 *     a new tab, and the folder is read ONCE for the whole calendar;
 *   - when the client has several saved folders, a frame.io one wins;
 *   - a client with no saved folder, or a failed lookup, shows no button;
 *   - a tokened client link never shows it and never asks for the folder.
 * No request leaves the machine. Fixture names only.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const CLIENT = 'Frame Fixture';
const SLUG = 'framefixture';
const TOKEN = 'fixture-frame-token';
const FRAME_URL = 'https://app.frame.io/reviews/fixture-folder';
const DRIVE_URL = 'https://drive.google.com/drive/folders/fixture-folder';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const cards = (forClient) => [
  { id: 'fr1', client: SLUG, name: 'Card with a production link', status: 'In Progress', order_index: 1, updated_at: '2026-09-20T12:00:00.000Z',
    scheduled_date: '2026-10-03', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
    video_deliverable_id: 'del_fixture_video', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [] },
  { id: 'fr2', client: SLUG, name: 'Card with no links', status: 'In Progress', order_index: 2, updated_at: '2026-09-20T12:00:00.000Z',
    scheduled_date: '2026-10-04', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
    video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [] }
].map(c => forClient ? Object.assign(c, { status: 'Client Approval', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
  asset_url: 'https://example.invalid/video.mp4', caption: 'A fictional caption.' }) : c);

/* mode: 'folder' | 'both' | 'none' | 'error' */
async function newPage(browser, origin, mode, state, client) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  if (!client) await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      return json(body.slug === SLUG && body.token === TOKEN
        ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' }
        : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
    }
    if (p === '/functions/v1/brain') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      state.brain.push(body);
      if (mode === 'error') return json({ ok: false, error: 'fixture_down' }, 500);
      const frame = mode === 'none' ? [] : mode === 'both'
        ? [{ url: DRIVE_URL, name: 'Newest batch', at: '2026-09-29' }, { url: FRAME_URL, name: 'Older batch', at: '2026-09-01' }]
        : [{ url: FRAME_URL, name: 'Newest batch', at: '2026-09-29' }];
      return json({ ok: true, frame, raw: [] });
    }
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) })));
    }
    if (p === '/rest/v1/calendar_posts') return json(cards(!!client));
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  return { page, ctx, pageErrors };
}

async function openStaff(page, origin) {
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(client => { _syncviewStaffIdentityVerified = true; _calSavePins([client]); navTo('calendar'); }, CLIENT);
  await page.waitForSelector('.cal-linear-pile', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function main() {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // 1. folder saved: button on every card, first in the pile, opens the folder
    console.log('--- Staff, folder saved ---');
    let state = { brain: [] };
    let t = await newPage(browser, origin, 'folder', state);
    await openStaff(t.page, origin);
    const btns = await t.page.$$eval('.cal-linear-pile', piles => piles.map(pile => {
      const first = pile.firstElementChild;
      const prod = pile.querySelector('.cal-prod-btn');
      const fr = pile.querySelector('.cal-frame-btn');
      return {
        first: !!first && first.classList.contains('cal-frame-btn'),
        href: fr ? fr.getAttribute('href') : '', target: fr ? fr.getAttribute('target') : '',
        rel: fr ? fr.getAttribute('rel') : '', title: fr ? fr.getAttribute('title') : '', hasSvg: !!(fr && fr.querySelector('svg')),
        above: fr && prod ? fr.getBoundingClientRect().top < prod.getBoundingClientRect().top : null,
        hasProd: !!prod
      };
    }));
    expect(btns.length === 2, 'both cards have a button pile (got ' + btns.length + ')');
    expect(btns.every(b => b.first), 'the Frame button is the first item in every pile');
    expect(btns.every(b => b.href === FRAME_URL), 'it links to the saved Frame folder');
    expect(btns.every(b => b.target === '_blank' && /noopener/.test(b.rel)), 'it opens in a new tab with noopener');
    expect(btns.every(b => /Frame\.io folder/.test(b.title) && b.hasSvg), 'it carries the Frame icon and a tooltip');
    expect(btns.some(b => b.hasProd && b.above === true), 'on a card with a production button the Frame button sits above it');
    expect(state.brain.length === 1 && state.brain[0].action === 'folders', 'the folder is read once for the whole calendar (' + state.brain.length + ' request)');
    expect(t.pageErrors.length === 0, 'no browser errors ' + JSON.stringify(t.pageErrors));
    await t.ctx.close();

    // 2. several saved folders: the frame.io one wins over a newer non-Frame link
    console.log('--- Staff, several folders ---');
    state = { brain: [] };
    t = await newPage(browser, origin, 'both', state);
    await openStaff(t.page, origin);
    const hrefs = await t.page.$$eval('.cal-frame-btn', els => els.map(e => e.getAttribute('href')));
    expect(hrefs.length === 2 && hrefs.every(h => h === FRAME_URL), 'a frame.io folder is chosen over a newer Drive one');
    await t.ctx.close();

    // 3. no folder saved: hidden
    console.log('--- Staff, no folder saved ---');
    state = { brain: [] };
    t = await newPage(browser, origin, 'none', state);
    await openStaff(t.page, origin);
    expect(state.brain.length === 1, 'the folder was asked for');
    expect(await t.page.$$eval('.cal-frame-btn', els => els.length) === 0, 'no Frame button when the client has no saved folder');
    expect(t.pageErrors.length === 0, 'no browser errors ' + JSON.stringify(t.pageErrors));
    await t.ctx.close();

    // 4. lookup fails: hidden, page keeps working
    console.log('--- Staff, lookup fails ---');
    state = { brain: [] };
    t = await newPage(browser, origin, 'error', state);
    await openStaff(t.page, origin);
    expect(await t.page.$$eval('.cal-frame-btn', els => els.length) === 0, 'no Frame button when the lookup fails');
    expect(await t.page.$$eval('.cal-card-thumb', els => els.length) === 2, 'the calendar still renders both cards');
    expect(t.pageErrors.length === 0, 'no browser errors ' + JSON.stringify(t.pageErrors));
    await t.ctx.close();

    // 5. tokened client link: never shown, never asked for
    console.log('--- Client link ---');
    state = { brain: [] };
    t = await newPage(browser, origin, 'folder', state, true);
    await t.page.goto(`${origin}/index.html?` + new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' }), { waitUntil: 'domcontentloaded' });
    await t.page.locator('.kcard[data-cal-review-pid]').first().waitFor({ timeout: 20000 });
    await t.page.waitForTimeout(800);
    expect(await t.page.$$eval('.cal-frame-btn', els => els.length) === 0, 'a client link shows no Frame button');
    expect(state.brain.length === 0, 'a client link never asks for the folder');
    expect(t.pageErrors.length === 0, 'no browser errors ' + JSON.stringify(t.pageErrors));
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\ncalendar-frame-folder-button-browser: ' + failures.length + ' FAILED'); process.exit(1); }
  console.log('\ncalendar-frame-folder-button-browser: all checks passed');
}
main().catch(e => { console.error(e); process.exit(1); });
