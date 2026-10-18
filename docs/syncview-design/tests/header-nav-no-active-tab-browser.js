'use strict';
/* header-nav-no-active-tab-browser.js -- the staff top bar keeps one look on
 * every page. On a page that has no tab of its own in the bar (Messages opens
 * from the chat button), the bar used to fall back to its old style: every tab
 * drawn as a white outlined box, while every other page shows flat tabs. Now
 * the tabs stay flat and no highlight shows. Fully offline, fictional data.
 *
 * Run:  node docs/syncview-design/tests/header-nav-no-active-tab-browser.js
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
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

let checks = 0; const failures = [];
function expect(v, m) { checks++; if (!v) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

const look = page => page.evaluate(() => {
  const nav = document.getElementById('headerNav');
  const btns = [...nav.querySelectorAll(':scope > .header-nav-btn')].filter(b => b.offsetWidth && !b.classList.contains('active'));
  const pill = nav.querySelector(':scope > .header-nav-pill');
  return {
    n: btns.length,
    outlined: btns.filter(b => { const cs = getComputedStyle(b); return cs.borderTopColor !== 'rgba(0, 0, 0, 0)' && cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0; }).length,
    filled: btns.filter(b => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
    active: nav.querySelectorAll(':scope > .header-nav-btn.active').length,
    pillShown: !!pill && getComputedStyle(pill).opacity !== '0' && pill.offsetWidth > 0,
  };
});

async function run(browser, origin, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', colorScheme: theme });
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
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(`${origin}/index.html#today`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await page.evaluate(t => { document.documentElement.setAttribute('data-theme', t); _syncviewStaffIdentityVerified = true; navTo('today'); }, theme);
  await page.waitForFunction(() => document.getElementById('headerNav').classList.contains('pill-ready'), null, { timeout: 15000 });
  await page.mouse.move(700, 600);
  await page.waitForTimeout(500);
  const today = await look(page);
  expect(today.n > 3 && today.outlined === 0 && today.filled === 0 && today.pillShown, `${theme}: on Today the other tabs are flat and the highlight sits on Today ${JSON.stringify(today)}`);
  await page.evaluate(() => navTo('messages'));
  await page.waitForTimeout(800);
  const msgs = await look(page);
  expect(msgs.active === 0, `${theme}: Messages has no tab of its own in the bar`);
  expect(msgs.outlined === 0, `${theme}: on Messages no tab is drawn as an outlined box (${msgs.outlined} of ${msgs.n})`);
  expect(msgs.filled === 0, `${theme}: on Messages no tab gets a white fill (${msgs.filled} of ${msgs.n})`);
  expect(!msgs.pillShown, `${theme}: and no highlight is left under a tab`);
  if (process.env.NAV_SHOTS) {
    fs.mkdirSync(process.env.NAV_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.NAV_SHOTS, `nav-messages-${theme}.png`), clip: { x: 0, y: 0, width: 1440, height: 60 } });
  }
  await page.evaluate(() => navTo('today'));
  await page.waitForTimeout(800);
  const back = await look(page);
  expect(back.outlined === 0 && back.pillShown && back.active === 1, `${theme}: back on Today the highlight returns under its tab ${JSON.stringify(back)}`);
  expect(errors.length === 0, `${theme}: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try { await run(browser, origin, 'light'); await run(browser, origin, 'dark'); }
  catch (e) { failures.push(String(e && e.stack || e)); console.error(e); }
  await browser.close(); server.close();
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) process.exit(1);
})();
