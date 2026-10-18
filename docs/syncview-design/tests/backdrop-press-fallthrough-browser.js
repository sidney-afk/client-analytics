'use strict';
/* backdrop-press-fallthrough-browser.js -- clicking a pop-up's dimmed
 * backdrop with a mouse closes it and puts focus back on the button that
 * opened it. It must never hand the click to whatever sits underneath. The
 * shared pop-up layer used to close on the press itself, removing the
 * backdrop mid-click, so the rest of the click landed on the page below (a
 * card's name field took focus behind the Archived list). Fully offline,
 * fictional data; two desktop widths, mouse (on a phone the list fills the
 * screen, so there is no backdrop to press).
 *
 * Run:  node docs/syncview-design/tests/backdrop-press-fallthrough-browser.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..');
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

const CLIENT = 'Overlap Fixture';
const SLUG = 'overlapfixture';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const card = (id, name, extra) => Object.assign({ id, client: SLUG, name, status: 'In Progress', order_index: Number(id.slice(-1)),
  updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: '2026-10-20', video_status: 'Approved', graphic_status: 'N/A', caption_status: 'In Progress',
  video_deliverable_id: '', graphic_deliverable_id: '', caption: 'A made-up caption.', comments: [], graphic_comments: [], caption_comments: [] }, extra || {});
// ov1: no video link, nothing linked in Production (Files button only).
// ov2: no video link, and a linked video part (Files and SyncLinear stacked).
// ov3: no video or thumbnail link (the longer two-part warning).
const CARDS = [
  card('ov1', 'Warning with the files button'),
  card('ov2', 'Warning with a linked part', { video_deliverable_id: 'del_ov_2' }),
  card('ov3', 'Warning for both parts', { graphic_status: 'Approved' }),
];

let checks = 0; const failures = [];
function expect(v, m) { checks++; if (!v) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

async function run(browser, origin, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/calendar_posts') return json(CARDS);
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof _arxOpen === 'function', null, { timeout: 30000 });
  await page.evaluate(c => { _syncviewStaffIdentityVerified = true; _calSavePins([c]); navTo('calendar'); }, CLIENT);
  await page.waitForTimeout(1200);
  const tag = width + 'px';
  for (let round = 0; round < 2; round++) {
    // A field and an opener button on the page, the field right where the backdrop click will land.
    await page.evaluate(() => {
      document.getElementById('fallthroughField')?.remove(); document.getElementById('fallthroughOpener')?.remove();
      const f = document.createElement('input'); f.id = 'fallthroughField';
      f.style.cssText = 'position:fixed;left:8px;top:120px;width:120px;height:30px;z-index:1';
      const b = document.createElement('button'); b.id = 'fallthroughOpener'; b.textContent = 'Archived';
      b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:1';
      document.body.append(f, b);
      b.focus(); _arxOpen('cal');
    });
    await page.waitForSelector('#arxOverlay', { timeout: 5000 });
    await page.waitForTimeout(300);
    const pt = await page.evaluate(() => { const r = document.getElementById('fallthroughField').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 15 }; });
    const onBackdrop = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id === 'arxOverlay', pt);
    expect(onBackdrop, `${tag} round ${round + 1}: the point clicked is the dimmed backdrop (the field is underneath it)`);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({ open: !!document.getElementById('arxOverlay'), active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
    expect(!after.open, `${tag} round ${round + 1}: a click on the backdrop closes the Archived list`);
    expect(after.active !== 'fallthroughField', `${tag} round ${round + 1}: the click does not fall through to the field underneath (focus: ${after.active})`);
    expect(after.active === 'fallthroughOpener', `${tag} round ${round + 1}: focus goes back to the button that opened it (focus: ${after.active})`);
  }
  expect(errors.length === 0, `${tag}: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try { await run(browser, origin, 1280); await run(browser, origin, 1024); }
  catch (e) { failures.push(String(e && e.stack || e)); console.error(e); }
  await browser.close(); server.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) process.exit(1);
})();
