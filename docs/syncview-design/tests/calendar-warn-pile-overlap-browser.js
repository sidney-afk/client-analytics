'use strict';
/* calendar-warn-pile-overlap-browser.js -- the "No video linked" warning on a
 * Calendar card must not sit under the card's button pile (the Files button,
 * and the SyncLinear buttons when a part is linked). Since the Files button
 * went on every card, the warning ran to the card's right edge and the folder
 * button covered its last words. Fully offline, fictional data.
 *
 * Run:  node docs/syncview-design/tests/calendar-warn-pile-overlap-browser.js
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

async function run(browser, origin, theme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', colorScheme: theme });
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
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(([c, t]) => { document.documentElement.setAttribute('data-theme', t); _syncviewStaffIdentityVerified = true; _calSavePins([c]); navTo('calendar'); }, [CLIENT, theme]);
  await page.waitForSelector('.cal-smm-warn-overlay', { timeout: 20000 });
  await page.waitForTimeout(600);
  const tag = `${theme} ${width}px`;
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.cal-card-thumb')].map(t => {
    const w = t.querySelector('.cal-smm-warn-overlay'); const p = t.querySelector('.cal-linear-pile');
    if (!w || !p || !p.children.length) return null;
    const a = w.getBoundingClientRect(), b = p.getBoundingClientRect(), c = t.getBoundingClientRect();
    const cardEl = t.closest('[data-post-id],[data-pid],[data-id]');
    return { id: cardEl ? (cardEl.getAttribute('data-post-id') || cardEl.getAttribute('data-pid') || cardEl.getAttribute('data-id')) : '',
      overlap: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
      inside: a.left >= c.left - 0.5 && a.right <= c.right + 0.5, width: Math.round(a.width), text: w.scrollHeight <= w.clientHeight + 1 };
  }).filter(Boolean));
  expect(boxes.length === 3, `${tag}: three cards show the warning beside their button pile (${boxes.length})`);
  for (const b of boxes) {
    expect(!b.overlap, `${tag}: card ${b.id || '?'}: the warning does not run under the button pile`);
    expect(b.inside, `${tag}: card ${b.id || '?'}: the warning stays inside the thumbnail`);
    expect(b.text, `${tag}: card ${b.id || '?'}: the warning's text is not clipped`);
  }
  expect(errors.length === 0, `${tag}: no page errors ${errors.join(' | ')}`);
  if (process.env.WARN_OVERLAP_SHOTS) {
    fs.mkdirSync(process.env.WARN_OVERLAP_SHOTS, { recursive: true });
    const first = page.locator('.cal-card-thumb', { has: page.locator('.cal-smm-warn-overlay') }).first();
    await first.screenshot({ path: path.join(process.env.WARN_OVERLAP_SHOTS, `warn-${theme}-${width}.png`) });
  }
  await ctx.close();
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await run(browser, origin, 'light', 1440);
    await run(browser, origin, 'dark', 1100);
  } catch (e) { failures.push(String(e && e.stack || e)); console.error(e); }
  await browser.close(); server.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.error(failures.length + ' failure(s)'); process.exit(1); }
})();
