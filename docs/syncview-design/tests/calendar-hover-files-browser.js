'use strict';
/* calendar-hover-files-browser.js -- two Calendar card additions, end to end,
 * fully offline, on fictional data.
 *
 *   Work item hover card: hovering (or keyboard-focusing) the SyncLinear
 *   sub-issue link shows identifier, title, status with "for N", assignee,
 *   due date (red when late) and last update. One read of the deliverables
 *   view serves every card; a second hover makes no request. Escape hides it.
 *
 *   Files menu: the pile's first button opens a small menu with Filming plan,
 *   Raw footage folder, Frame folder and Thumbnail file. Each opens in a new
 *   tab; a missing one reads "not linked yet". Keyboard: Enter opens on the
 *   first link, arrows move, Escape closes back to the button.
 *
 *   A tokened client link shows neither.
 *
 * Run:  node docs/syncview-design/tests/calendar-hover-files-browser.js
 * Pictures: set HOVER_FILES_SHOTS=<dir> to write light and dark PNGs.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
const shots = process.env.HOVER_FILES_SHOTS;
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

const CLIENT = 'Hover Fixture';
const SLUG = 'hoverfixture';
const TOKEN = 'fixture-hover-token';
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
];
const card = (id, name, date, vid, extra) => Object.assign({ id, client: SLUG, name, status: 'In Progress', order_index: Number(id.slice(-1)),
  updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: date, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  video_deliverable_id: vid, graphic_deliverable_id: '', caption: 'A made-up caption for a made-up video, long enough to wrap onto a second line.',
  comments: [], graphic_comments: [], caption_comments: [] }, extra || {});
const CARDS = [
  card('hv1', 'Three myths about sleep', '2026-10-15', 'del_hover_1', { thumbnail_url: THUMB_URL }),
  card('hv2', 'Morning routine reset', '2026-10-17', 'del_hover_2'),
  card('hv3', 'Kitchen tour, part two', '2026-10-20', ''),
];

let checks = 0; const failures = [];
function expect(v, m) { checks++; if (!v) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

async function newPage(browser, origin, theme, state, client) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', colorScheme: theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  if (!client) await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.url() === THUMB_URL) return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(root, 'syncview-favicon.png')) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      return json(body.slug === SLUG && body.token === TOKEN
        ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' }
        : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
    }
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
    if (p === '/rest/v1/calendar_posts') return json(client ? CARDS.map(c => Object.assign({}, c, { status: 'Client Approval', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', asset_url: 'https://example.invalid/video.mp4' })) : CARDS);
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
async function shot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name + '.png'), animations: 'disabled' });
}
const prodLink = (page, id) => page.locator(`a.cal-prod-btn[data-deliverable-id="${id}"]`);

async function staff(browser, origin, theme) {
  console.log(`--- Staff, ${theme} ---`);
  const state = { brain: 0, plans: 0, deliv: 0 };
  const t = await newPage(browser, origin, theme, state);
  const { page } = t;
  await openStaff(page, origin, theme);

  // ── Hover card
  expect(state.deliv === 0, theme + ': nothing is read before a hover');
  await prodLink(page, 'del_hover_1').hover();
  await page.locator('#calWorkCard').waitFor({ timeout: 5000 });
  const wc = await page.locator('#calWorkCard').innerText();
  expect(/VID-142/.test(wc) && /Three myths about sleep: video edit/.test(wc), theme + ': card shows identifier and title');
  expect(/In Progress/.test(wc) && /for 3 days/.test(wc), theme + ': status and how long it has been in it');
  expect(/Alex Editor/.test(wc), theme + ': assignee name from the roster');
  expect(/3 days late/.test(wc) && await page.locator('#calWorkCard .cal-wc-v.is-late').count() === 1, theme + ': overdue due date is red');
  expect(/Updated/.test(wc) && /2 hours ago/.test(wc), theme + ': last updated');
  expect(!/Priority|Comments/.test(wc), theme + ': no priority or comment count (owner decision)');
  expect(await prodLink(page, 'del_hover_1').getAttribute('aria-describedby') === 'calWorkCard', theme + ': link is described by the card');
  await shot(page, 'item2-built-' + theme);
  await page.mouse.move(5, 500);
  await page.waitForTimeout(100);
  expect(await page.locator('#calWorkCard').count() === 0, theme + ': card hides when the pointer leaves');
  await prodLink(page, 'del_hover_2').hover();
  await page.locator('#calWorkCard').waitFor({ timeout: 5000 });
  const wc2 = await page.locator('#calWorkCard').innerText();
  expect(/VID-143/.test(wc2) && /Unassigned/.test(wc2) && !/late/.test(wc2) && await page.locator('#calWorkCard .is-late').count() === 0, theme + ': on-time, unassigned item reads plainly');
  expect(state.deliv === 1, theme + ': one read serves every card (' + state.deliv + ' requests)');
  await page.mouse.move(5, 500);
  await prodLink(page, 'del_hover_1').focus();
  await page.locator('#calWorkCard').waitFor({ timeout: 5000 });
  expect(true, theme + ': keyboard focus shows the card');
  await page.keyboard.press('Escape');
  expect(await page.locator('#calWorkCard').count() === 0, theme + ': Escape hides it');
  expect(state.deliv === 1, theme + ': still one read after more hovers');

  // ── Files menu
  const filesBtn = (pid) => page.locator(`.cal-files-btn[data-files-pid="${pid}"]`);
  await filesBtn('hv1').click();
  await page.locator('#calFilesMenu').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => !!document.querySelector('#calFilesMenu a[data-files-kind="plan"]'), null, { timeout: 5000 }).catch(() => {});
  const rows = await page.$$eval('#calFilesMenu .cal-files-item', els => els.map(e => ({ kind: e.getAttribute('data-files-kind'), text: e.innerText.trim(), href: e.getAttribute('href'), target: e.getAttribute('target'), missing: e.classList.contains('is-missing') })));
  expect(rows.map(r => r.kind).join() === 'plan,raw,frame,thumb', theme + ': four rows in order');
  const by = Object.fromEntries(rows.map(r => [r.kind, r]));
  expect(by.plan.href === PLAN_URL && by.raw.href === RAW_URL && by.frame.href === FRAME_URL && by.thumb.href === THUMB_URL, theme + ': each row links to its source');
  expect(rows.every(r => r.target === '_blank'), theme + ': every link opens in a new tab');
  expect(await filesBtn('hv1').getAttribute('aria-expanded') === 'true', theme + ': button says the menu is open');
  await page.keyboard.press('Escape');
  expect(await page.locator('#calFilesMenu').count() === 0, theme + ': Escape closes it');

  await filesBtn('hv3').click();
  await page.locator('#calFilesMenu').waitFor({ timeout: 5000 });
  const thumbMissing = await page.$eval('#calFilesMenu [data-files-kind="thumb"]', e => ({ tag: e.tagName, text: e.innerText, disabled: e.getAttribute('aria-disabled') }));
  expect(thumbMissing.tag !== 'A' && /not linked yet/.test(thumbMissing.text) && thumbMissing.disabled === 'true', theme + ': a card with no thumbnail greys it out as "not linked yet"');
  await page.evaluate(() => { _calFrameFolders[calState.client].raw = ''; _calFilesMenuRefresh(); });
  expect(/not linked yet/.test(await page.locator('#calFilesMenu [data-files-kind="raw"]').innerText()), theme + ': a client with no raw folder shows it greyed');
  await shot(page, 'item3-built-' + theme);
  await page.mouse.click(5, 500);
  expect(await page.locator('#calFilesMenu').count() === 0, theme + ': a click outside closes it');

  await filesBtn('hv1').focus();
  await page.keyboard.press('Enter');
  await page.locator('#calFilesMenu').waitFor({ timeout: 5000 });
  expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-files-kind')) === 'plan', theme + ': Enter opens on the first link');
  await page.keyboard.press('ArrowDown');
  const second = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-files-kind'));
  expect(second === 'frame' || second === 'raw', theme + ': ArrowDown moves to the next link');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cal-files-btn')), theme + ': Escape returns focus to the button');
  expect(state.brain === 1 && state.plans <= 1, theme + ': folders read once, plans at most once');
  expect(t.errors.length === 0, theme + ': no browser errors ' + JSON.stringify(t.errors));
  await t.ctx.close();
}

async function main() {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await staff(browser, origin, 'light');
    await staff(browser, origin, 'dark');
    console.log('--- Client link ---');
    const state = { brain: 0, plans: 0, deliv: 0 };
    const t = await newPage(browser, origin, 'light', state, true);
    await t.page.goto(`${origin}/index.html?` + new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' }), { waitUntil: 'domcontentloaded' });
    await t.page.locator('.kcard[data-cal-review-pid]').first().waitFor({ timeout: 20000 });
    await t.page.waitForTimeout(800);
    expect(await t.page.locator('.cal-files-btn, a.cal-prod-btn').count() === 0, 'client link: no files menu, no work item link');
    expect(state.deliv === 0 && state.brain === 0 && state.plans === 0, 'client link: nothing is read');
    expect(t.errors.length === 0, 'client link: no browser errors ' + JSON.stringify(t.errors));
    await t.ctx.close();
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error('\ncalendar-hover-files: ' + failures.length + ' FAILED'); process.exit(1); }
  console.log('\ncalendar-hover-files: OK (' + checks + ' checks; light and dark; hover card, files menu, client link)');
}
main().catch(e => { console.error(e); process.exit(1); });
