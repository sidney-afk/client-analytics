'use strict';
// A refresh never changes the tab and never paints another tab's loading
// skeleton. Drives the real page offline behind a server that answers like
// GitHub Pages (top-level pages hop through their stub, deep paths through
// 404.html), for every top-level tab and a deep path of each, on desktop and
// phone, for a first load, a normal reload and the update-banner reload
// (location.reload()). From the first painted frame until the app takes over,
// the only skeleton allowed on screen is the tab's own, or the neutral one.
// Uses an invented client slug only: nothing here reads or writes live data.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
const C = 'linkfixtureclient';

// address -> the skeleton that may paint ('neutral' is always allowed too)
const ROUTES = [
  ['/', 'analytics'],
  ['/synclinear', 'production'],
  ['/synclinear/del_fixture_1', 'production'],
  ['/submit', 'linear'],
  ['/workload', 'workload'],
  ['/calendar', 'calendar'],
  [`/calendar/${C}/p_fixture_1`, 'calendar'],
  ['/templates', 'templates'],
  [`/templates/${C}`, 'templates'],
  ['/filming-plans', 'filming'],
  ['/tiktok-upload', 'tiktok'],
  ['/time-off', 'neutral'],
  ['/sample-reviews', 'review'],
  [`/sample-reviews/${C}/p_fixture_1`, 'review'],
  ['/smm-weekly-report', 'sales-intake'],
  ['/smm-weekly-reports', 'kasper'],
  ['/kasper', 'kasper'],
  ['/kasper/hiring-process', 'kasper'],
  ['/onboarding', 'neutral'],
  ['/client-credentials', 'neutral'],
  ['/intake', 'neutral'],
];

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

async function newContext(browser, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/\/functions\/v1\/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: ADMIN.role, member: ADMIN }) });
    // The invented client exists only in the (mocked) Clients Info sheet.
    if (/docs\.google\.com/.test(url)) {
      const csv = /Clients%20Info|Clients\+Info|Clients Info/.test(url) ? 'client_name\nLink Fixture Client\n' : 'client_name,date\n';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: csv });
    }
    // Time Off is switched on, as it is live; otherwise /time-off goes home.
    if (/\/rest\/v1\/syncview_runtime_flags/.test(url) && /pto_v1/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([{ value: { mode: 'on' } }]) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  await context.addInitScript(() => { try { localStorage.setItem('syncview_kasper_admin_seen', '1'); } catch (e) {} });
  // Record every skeleton on screen, frame by frame, until the app takes over.
  await context.addInitScript(() => {
    if (location.pathname !== '/' && location.pathname !== '/index.html') return; // the stub page itself paints nothing
    const seen = []; window.__svSkeletons = seen;
    let frames = 0;
    const tick = () => {
      const de = document.documentElement;
      document.querySelectorAll('.boot-skeleton-variant').forEach(el => {
        if (getComputedStyle(el).display === 'none' || !el.getClientRects().length) return;
        const m = /boot-skeleton-([a-z-]+)/.exec(Array.from(el.classList).filter(c => c !== 'boot-skeleton-variant').join(' '));
        if (m && seen.indexOf(m[1]) < 0) seen.push(m[1]);
      });
      if ((document.body && !de.hasAttribute('data-boot-nav') && frames > 5) || ++frames > 600) { window.__svSkeletonsDone = true; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return context;
}

async function skeletons(page) {
  await page.waitForFunction(() => window.__svSkeletonsDone === true, null, { timeout: 30000 }).catch(() => {});
  return page.evaluate(() => ({ seen: window.__svSkeletons || [], nav: typeof currentNav !== 'undefined' ? currentNav : null, at: location.pathname }));
}

(async () => {
  const server = await pagesServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const fails = [];
  const check = (ok, msg) => { if (ok) checks++; else fails.push(msg); };
  try {
    for (const [device, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const ctx = await newContext(browser, viewport);
      for (const [addr, want] of ROUTES) {
        const page = await ctx.newPage();
        // A new visit to the bare address opens Today (#1798, 2026-09-27);
        // Analytics is what a refresh on it shows, so start from its history entry.
        if (want === 'analytics') await page.addInitScript(() => { try { if (!history.state) history.replaceState({ nav: 'home', client: null }, ''); } catch (e) {} });
        await page.goto(base + addr, { waitUntil: 'domcontentloaded' });
        const first = await skeletons(page);
        for (const [how, act] of [['reload', () => page.reload({ waitUntil: 'domcontentloaded' })], ['update-banner refresh', async () => {
          // location.reload() does not wait: read the NEW document once its
          // scripts have run (the split files load after the skeletons settle).
          const t = await page.evaluate(() => performance.timeOrigin);
          await page.evaluate(() => location.reload());
          await page.waitForFunction(t => performance.timeOrigin !== t && document.readyState === 'complete' && typeof currentNav !== 'undefined', t, { timeout: 30000 }).catch(() => {});
        }]]) {
          await act();
          const r = await skeletons(page);
          const label = `${device} ${addr.replace(C, '<client>')} ${how}`;
          const wrong = r.seen.filter(s => s !== want && s !== 'neutral');
          check(wrong.length === 0, `${label}: painted ${r.seen.join(' > ') || 'nothing'}, expected ${want}`);
          check(r.seen.length > 0, `${label}: painted no skeleton at all`);
          const tab = a => a.split('/')[1] || '';
          check(tab(r.at) === tab(addr), `${label}: the tab moved to ${r.at}`);
          check(r.nav === first.nav && r.at === first.at, `${label}: tab changed from ${first.nav} ${first.at} to ${r.nav} ${r.at}`);
        }
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (fails.length) {
    fails.forEach(f => console.error('  FAIL ' + f));
    console.error(`refresh-skeleton-browser: ${fails.length} failed, ${checks} passed`);
    process.exit(1);
  }
  console.log(`refresh-skeleton-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
