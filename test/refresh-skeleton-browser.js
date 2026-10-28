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
const { analyticsShown } = require('./fixtures/analytics-shown.js');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
const C = 'linkfixtureclient';
/* A busy runner, made repeatable: the Clients Info sheet answers the FIRST
 * visit of each address late, the reloads at once. That is the order that
 * turned #2402 red (the first reading before Templates rewrote its address,
 * the reloads after). */
let slowSheetOnce = false;

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
  ['/post', 'tiktok'],   // the Post tab (TikTok and Instagram); its old /tiktok-upload address moves to /post on load
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
      const info = /Clients%20Info|Clients\+Info|Clients Info/.test(url);
      const csv = info ? 'client_name\nLink Fixture Client\n' : 'client_name,date\n';
      const answer = () => route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: csv }).catch(() => {});
      if (info && slowSheetOnce) { slowSheetOnce = false; return new Promise(r => setTimeout(r, 2500)).then(answer); }
      return answer();
    }
    // Time Off is switched on, as it is live; otherwise /time-off goes home.
    if (/\/rest\/v1\/syncview_runtime_flags/.test(url) && /pto_v1/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([{ value: { mode: 'on' } }]) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  // The '/' row refreshes Analytics, which is hidden by default and then never shown to staff (session Detour).
  await analyticsShown(context);
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

/* The address the page settles on. Some tabs rewrite their own address once
 * their data arrives: Templates swaps the client slug for the encoded display
 * name (060, replaceState '#templates/' + encodeURIComponent(name)). Reading
 * it before that lands made the before/after comparison race on a busy runner
 * (#2402, 2026-10-28). So wait until the address has held still for 750 ms
 * (at most 10 s) before reading it. */
async function settledAddress(page) {
  let last = null, since = Date.now();
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const now = await page.evaluate(() => location.pathname + location.hash).catch(() => null);
    if (now !== last) { last = now; since = Date.now(); }
    else if (Date.now() - since >= 750) break;
    await new Promise(r => setTimeout(r, 100));
  }
}
/* Tab and client, not their spelling: '/templates/linkfixtureclient' and
 * '/templates/Link%20Fixture%20Client' are the same place. A real change of
 * tab, client or deeper item still differs. */
function identity(at) {
  return String(at || '').split('/').map(part => {
    let d = part;
    try { d = decodeURIComponent(part); } catch (e) {}
    return d.toLowerCase().replace(/[^a-z0-9_]/g, '');
  }).join('/');
}

async function skeletons(page) {
  await page.waitForFunction(() => window.__svSkeletonsDone === true, null, { timeout: 30000 }).catch(() => {});
  await settledAddress(page);
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
        slowSheetOnce = true;
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
          check(r.nav === first.nav && identity(r.at) === identity(first.at), `${label}: tab changed from ${first.nav} ${first.at} to ${r.nav} ${r.at}`);
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
