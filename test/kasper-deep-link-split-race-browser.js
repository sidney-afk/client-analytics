'use strict';
/*
 * A fresh open of a Kasper sub-tab address (/kasper/<subtab>, #kasper/<subtab>)
 * reaches that sub-tab even when the later script files are still on their
 * way. Found 2026-10-10 (Digger, bug archaeology, OPEN_REPAIRS 396) by
 * test/clean-urls-browser.js, which no workflow had ever run.
 *
 * Since the page loads in parts (#1848, 2026-09-29), boot (fragment 260,
 * js/sv-13-core-*) starts init() at its end and init waits only for the staff
 * check that the head script started early. When that answer came back before
 * the next file (fragment 305, js/sv-15-core-*, where _kasperResolveSubtab
 * lives) had run, the Kasper branch called a function that did not exist yet:
 * init threw, and an admin saw "Could not load data. Make sure the Google
 * Sheet is set to 'Anyone with the link can view'." instead of Kasper. A
 * first visit after a deploy (nothing cached) or a slow line was enough.
 *
 * This holds the later files back on purpose and answers the staff check at
 * once, so the race is decided the bad way every time. Every backend answer
 * is local.
 */
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
const HOLD_MS = Number(process.env.KDL_HOLD_MS || 1500);

function pagesServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    let file = path.join(ROOT, path.normalize(p).replace(/^([.][\\/])+/, ''));
    let status = 200;
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (fs.existsSync(file + '.html')) file = file + '.html';
      else { file = path.join(ROOT, '404.html'); status = 404; }
    }
    // Every split file after boot's own arrives late (a cold cache on a slow line).
    const late = /^\/js\/sv-(\d\d)-/.exec(p);
    const send = () => { res.writeHead(status, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); };
    if (late && Number(late[1]) >= 14) setTimeout(send, HOLD_MS); else send();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  const split = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'index', 'split.json'), 'utf8'));
  if (!split.enabled) { console.log('kasper-deep-link-split-race-browser: split loading is off; nothing to race'); return; }
  const server = await pagesServer();
  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (const addr of ['/kasper/hiring-process', '/#kasper/hiring-process', '/kasper/editors']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
        const req = route.request(); const url = req.url();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (/\/functions\/v1\/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
        if (/docs\.google\.com/.test(url)) return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: 'client_name\n' });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
      });
      await seedStaffIdentity(context, ADMIN);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message || e)));
      await page.goto(base + addr, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof currentNav !== 'undefined' && (currentNav === 'kasper' || /Could not load data/.test((document.getElementById('content') || {}).textContent || '')), null, { timeout: 30000 }).catch(() => {});
      const seen = await page.evaluate(() => ({
        nav: typeof currentNav === 'undefined' ? null : currentNav,
        tab: typeof _kasperState === 'undefined' ? null : _kasperState.tab,
        errorCard: /Could not load data/.test((document.getElementById('content') || {}).textContent || ''),
        cardText: ((document.querySelector('.error-state') || {}).textContent || '').slice(-80),
      }));
      results.push({ addr, ...seen, errors });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  for (const r of results) {
    assert.ok(!r.errorCard, `${r.addr}: an admin got "Could not load data" instead of Kasper (${r.cardText.trim()})`);
    assert.equal(r.nav, 'kasper', `${r.addr}: lands on Kasper (landed on ${r.nav})`);
    assert.equal(r.tab, r.addr.split('/').pop(), `${r.addr}: on its sub-tab (on ${r.tab})`);
  }
  console.log(`kasper-deep-link-split-race-browser: ${results.length} Kasper sub-tab addresses open on their sub-tab with the later files ${HOLD_MS} ms late ✅`);
})().catch(e => { console.error(e); process.exit(1); });
