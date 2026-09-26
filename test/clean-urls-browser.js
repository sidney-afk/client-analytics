'use strict';
// Clean addresses (docs/features/CLEAN_URLS.md). Drives the real page offline
// in a headless browser, behind a small server that answers the way GitHub
// Pages does (/x -> x.html when it exists, anything else -> 404.html with a
// 404 status). Proves:
//   1. every old address forwards to its clean path, and loading the old
//      address or the clean path lands on the same screen with the same
//      client and card (the legacy form the app routes on is identical);
//   2. client share links and the onboarding forms are never touched;
//   3. top-level pages answer 200 from their stub; deep links go through
//      404.html and still land on their clean path;
//   4. on a nested path every same-origin image, icon, stylesheet and script
//      loads (nothing 404s), the same set as at the root;
//   5. Kasper is admin-only: an SMM gets no tab and /kasper sends them home;
//      a remembered admin keeps the tab while the sign-in check is failing;
//   6. Onboarding and Client Credentials open at their own paths for an SMM.
// Uses fixture ids only: no client names, slugs or tokens.
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const SMM = { id: 'qa_smm', name: 'QA Smm', role: 'smm', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };

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

async function newContext(browser, member, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (opts.sheetsDown && /docs\.google\.com/.test(url)) return route.fulfill({ status: 500, headers: cors, body: 'down' });
    if (/\/functions\/v1\/key-verify/.test(url)) {
      if (opts.verifierDown) return route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: '{"ok":false}' });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: member.role, member }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
  });
  if (member) await seedStaffIdentity(context, member);
  // What the app starts from: the address right after the forward, and the
  // legacy form (with its client and card) before any screen logic runs.
  // Recorded in the microtask right after the router script finishes, before
  // the next script (the app) can run.
  await context.addInitScript(() => {
    let value;
    Object.defineProperty(window, 'svRoute', {
      configurable: true,
      get() { return value; },
      set(v) {
        value = v;
        queueMicrotask(() => {
          try {
            window.__svBootUrl = location.pathname + location.search + location.hash;
            window.__svBootLegacy = v.hash() + '|' + v.search();
          } catch (e) {}
        });
      },
    });
  });
  if (opts.rememberAdmin) await context.addInitScript(() => { try { localStorage.setItem('syncview_kasper_admin_seen', '1'); } catch (e) {} });
  return context;
}

// Where a load ends up: the address bar, the screen, and the legacy form the
// app routes on (which carries the client and card).
async function land(ctxOrPage, base, address) {
  // A fresh tab per address, so one case's history cannot steer the next.
  const page = ctxOrPage.newPage ? await ctxOrPage.newPage() : ctxOrPage;
  await page.goto(base + address, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof currentNav !== 'undefined' && !document.documentElement.hasAttribute('data-boot-nav'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const u = new URL(location.href);
    return {
      bootUrl: window.__svBootUrl,
      bootLegacy: window.__svBootLegacy,
      url: u.pathname + u.search + u.hash,
      nav: typeof currentNav !== 'undefined' ? currentNav : null,
      legacy: window.svRoute ? window.svRoute.hash() + '|' + window.svRoute.search() : null,
      kasperTab: !!(document.getElementById('navKasper') && document.getElementById('navKasper').style.display !== 'none'),
    };
  });
  if (ctxOrPage.newPage) await page.close();
  return out;
}

// old address -> clean path, and the screen both must land on
const ADMIN_CASES = [
  ['/#production', '/synclinear', 'production'],
  ['/?prod=1#production', '/synclinear', 'production'],
  ['/?prod=1&d=del_fixture_1#production', '/synclinear/del_fixture_1', 'production'],
  ['/?prod=1&batch=batch_fixture_1', '/synclinear/batch/batch_fixture_1', 'production'],
  ['/#linear', '/submit', 'linear'],
  ['/#workload', '/workload', 'workload'],
  ['/#calendar', '/calendar', 'calendar'],
  ['/#calendar/fixture-client/p_fixture_1', '/calendar/fixture-client/p_fixture_1', 'calendar'],
  ['/#templates', '/templates', 'templates'],
  ['/#filming-plans', '/filming-plans', 'filming-plans'],
  ['/#tiktok-upload', '/tiktok-upload', 'tiktok-upload'],
  ['/#sample-reviews', '/sample-reviews', 'sample-reviews'],
  ['/?sxr=1#sample-reviews/fixture-client/p_fixture_1', '/sample-reviews/fixture-client/p_fixture_1?sxr=1', 'sample-reviews'],
  ['/#samples', '/sample-reviews', 'sample-reviews'],
  ['/#samples/fixture-client/p_fixture_1', '/sample-reviews/fixture-client/p_fixture_1', 'sample-reviews'],
  ['/#smm-weekly-reports?week=2026-09-21', '/smm-weekly-reports?week=2026-09-21', 'smm-weekly-reports'],
  ['/#kasper', '/kasper', 'kasper'],
  ['/#kasper/hiring-process', '/kasper/hiring-process', 'kasper'],
  ['/?Kasper=1', '/kasper', 'kasper'],
  ['/?Kasper=1#calendar', '/calendar', 'calendar'],
  ['/#staff-onboarding', '/onboarding', 'staff-onboarding'],
  ['/#client-credentials', '/client-credentials', 'client-credentials'],
  ['/?intake=1', '/intake', null],
  ['/?onboarding_view=fixture-client', '/onboarding/fixture-client', null],
  ['/', '/', null],
];

(async () => {
  const server = await pagesServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const fails = [];
  const check = (ok, msg) => { if (ok) checks++; else fails.push(msg); };
  try {
    // 1. Old addresses forward, and old and new land on the same screen.
    const ctx = await newContext(browser, ADMIN);
    const errors = [];
    ctx.on('page', pg => pg.on('pageerror', e => errors.push(e.message)));
    // A real roster client (read from the page, never written here) so the
    // calendar and sample-review deep links resolve to an actual client.
    const probe = await ctx.newPage();
    await probe.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await probe.waitForFunction(() => typeof WL_CLIENT_NAMES !== 'undefined' && WL_CLIENT_NAMES.length > 0, null, { timeout: 20000 });
    const slug = await probe.evaluate(() => wlNormalizeClient(WL_CLIENT_NAMES[0]));
    await probe.close();
    const cases = ADMIN_CASES.map(c => c.map(v => typeof v === 'string' ? v.replace(/fixture-client/g, slug) : v));
    for (const [oldAddr, clean, nav] of cases) {
      const fromOld = await land(ctx, base, oldAddr);
      const fromNew = await land(ctx, base, clean);
      const label = oldAddr.replace(slug, '<client>');
      check(fromOld.bootUrl === clean, `${label}: forwarded to ${String(fromOld.bootUrl).replace(slug, '<client>')}`);
      check(fromNew.bootUrl === clean, `${label}: clean path changed at load`);
      check(fromOld.bootLegacy === fromNew.bootLegacy, `${label}: the app starts from different addresses for old and new`);
      check(fromOld.url === fromNew.url, `${label}: old and new settle on different addresses`);
      check(fromOld.legacy === fromNew.legacy, `${label}: old and new settle on different screens state`);
      check(fromOld.nav === fromNew.nav, `${label}: screen ${fromOld.nav} vs ${fromNew.nav}`);
      if (nav) check(fromNew.nav === nav, `${label}: screen ${fromNew.nav}, expected ${nav}`);
    }
    // The client and card reach the app intact.
    const deepCal = await land(ctx, base, `/calendar/${slug}/p_fixture_1`);
    check(deepCal.bootLegacy === `#calendar/${slug}/p_fixture_1|`, 'calendar deep link carries client and card');
    const deepProd = await land(ctx, base, '/synclinear/del_fixture_1');
    check(/[?&]d=del_fixture_1/.test(deepProd.bootLegacy), 'SyncLinear deep link carries the card');
    check(errors.length === 0, 'page errors: ' + errors.slice(0, 3).join(' | '));

    const page = await ctx.newPage();
    // In-app navigation writes clean paths; back returns to the previous screen.
    await land(page, base, '/workload');
    await page.evaluate(() => navTo('calendar'));
    check((await page.evaluate(() => location.pathname)).startsWith('/calendar'), 'navTo(calendar) shows a /calendar path');
    await page.goBack();
    await page.waitForTimeout(500);
    const back = await page.evaluate(() => ({ p: location.pathname, nav: currentNav }));
    check(back.p === '/workload' && back.nav === 'workload', `back: ${JSON.stringify(back)}`);
    // Copy-link style builders produce clean absolute addresses.
    const copy = await page.evaluate(() => svRoute.cleanAbs('/#calendar/fixture-client/p_fixture_1'));
    check(copy === base + '/calendar/fixture-client/p_fixture_1', 'copy link: ' + copy);
    // The menu links point at clean paths.
    const hrefs = await page.$$eval('#headerNav .header-nav-btn', els => els.map(e => e.getAttribute('href')));
    check(hrefs.every(h => /^\/[a-z-]*$/.test(h)), 'menu hrefs: ' + hrefs.join(' '));
    await ctx.close();

    // 2. Share links and onboarding forms are left exactly as they are.
    const anon = await newContext(browser, null);
    const ap = await anon.newPage();
    for (const addr of ['/?c=Fixture%20Client&v=calendar&t=fixture-token', '/?sxr=1&c=Fixture%20Client&v=sample-reviews&t=fixture-token', '/onboarding_form', '/ai_onboarding_form']) {
      await ap.goto(base + addr, { waitUntil: 'domcontentloaded' });
      await ap.waitForTimeout(600);
      const u = await ap.evaluate(() => location.pathname + location.search + location.hash);
      check(u === addr, `${addr} must not change, became ${u}`);
    }
    await anon.close();

    // 3. Stubs answer 200; deep links hop through 404.html and land.
    for (const name of ['synclinear', 'submit', 'workload', 'calendar', 'templates', 'kasper', 'onboarding', 'client-credentials', 'intake']) {
      const r = await fetch(`${base}/${name}`);
      check(r.status === 200, `/${name} answers ${r.status}`);
    }
    const deep = await fetch(`${base}/calendar/fixture-client/p_fixture_1`);
    check(deep.status === 404, 'a deep link is served by 404.html');

    // 4. Every same-origin asset loads on a nested path, same set as the root.
    const assetsAt = async (addr) => {
      const c = await newContext(browser, ADMIN);
      const p = await c.newPage();
      const seen = new Map();
      p.on('response', r => {
        const u = new URL(r.url());
        if (u.origin !== base || r.request().resourceType() === 'document') return;
        seen.set(u.pathname, r.status());
      });
      p.on('requestfailed', r => { const u = new URL(r.url()); if (u.origin === base) seen.set(u.pathname, 'failed'); });
      await p.goto(base + addr, { waitUntil: 'load' });
      await p.waitForTimeout(1500);
      // Force every menu icon to paint so its background image is requested.
      await p.evaluate(() => document.querySelectorAll('.header-nav-ico').forEach(e => getComputedStyle(e).backgroundImage));
      await p.waitForTimeout(300);
      await c.close();
      return seen;
    };
    const rootAssets = await assetsAt('/');
    const nestedAssets = await assetsAt('/calendar/fixture-client/p_fixture_1');
    const bad = [...nestedAssets].filter(([, s]) => s !== 200 && s !== 304);
    check(bad.length === 0, 'assets failing on a nested path: ' + JSON.stringify(bad));
    check(nestedAssets.size > 0 && [...nestedAssets.keys()].some(k => k.startsWith('/nav-icons/')), 'menu icons were requested on the nested path: ' + [...nestedAssets.keys()].join(' '));
    const missing = [...rootAssets.keys()].filter(k => !nestedAssets.has(k));
    check(missing.length === 0, 'assets loaded at / but not on the nested path: ' + missing.join(' '));
    check(![...nestedAssets.keys()].some(k => k.startsWith('/calendar/')), 'nothing resolved relative to the nested path');

    // 5. Kasper is admin-only, and a remembered admin is never locked out.
    const smm = await newContext(browser, SMM);
    const sp = await smm.newPage();
    const smmKasper = await land(sp, base, '/kasper');
    check(smmKasper.nav === 'home' && !smmKasper.kasperTab, `SMM on /kasper: ${JSON.stringify(smmKasper)}`);
    const smmParam = await land(sp, base, '/?Kasper=1');
    check(smmParam.nav === 'home' && !smmParam.kasperTab, `SMM with ?Kasper=1: ${JSON.stringify(smmParam)}`);
    // 6. The pages SMMs use stay reachable at their own paths.
    for (const [addr, nav] of [['/onboarding', 'staff-onboarding'], ['/client-credentials', 'client-credentials'], ['/filming-plans', 'filming-plans'], ['/time-off', null], ['/smm-weekly-report', 'smm-weekly-report'], ['/sample-reviews', 'sample-reviews']]) {
      const r = await land(sp, base, addr);
      if (nav) check(r.nav === nav, `SMM ${addr}: screen ${r.nav}`);
      check(r.url.split('?')[0] === addr || r.nav === 'home', `SMM ${addr}: address ${r.url}`);
    }
    const onb = await land(sp, base, '/onboarding');
    const onbText = await sp.evaluate(() => (document.getElementById('kasperContent') || {}).innerText || '');
    check(onb.nav === 'staff-onboarding' && !/needs an SMM or Admin sign-in/.test(onbText), 'SMM sees the onboarding page, not a sign-in wall');
    const menu = await sp.evaluate(() => ({ onb: !document.getElementById('headerOnboardingMenuItem').hidden, cc: !document.getElementById('headerCredentialsMenuItem').hidden }));
    check(menu.onb && menu.cc, 'SMM menu shows Onboarding and Client Credentials: ' + JSON.stringify(menu));
    await smm.close();

    // Kasper and the standalone staff pages do not wait on the analytics
    // sheets: they still mount when those reads fail.
    const sheetsDown = await newContext(browser, ADMIN, { sheetsDown: true });
    for (const [addr, nav] of [['/kasper', 'kasper'], ['/kasper/hiring-process', 'kasper'], ['/onboarding', 'staff-onboarding'], ['/client-credentials', 'client-credentials']]) {
      const r = await land(sheetsDown, base, addr);
      check(r.nav === nav, `${addr} with the analytics sheets down: screen ${r.nav}`);
    }
    await sheetsDown.close();

    const down = await newContext(browser, ADMIN, { verifierDown: true, rememberAdmin: true });
    const dp = await down.newPage();
    const kept = await land(dp, base, '/calendar');
    check(kept.kasperTab, 'a remembered admin keeps the Kasper tab while the sign-in check fails');
    await down.close();

    const fresh = await newContext(browser, SMM, { verifierDown: true });
    const fp = await fresh.newPage();
    const none = await land(fp, base, '/calendar');
    check(!none.kasperTab, 'no remembered admin: no Kasper tab while the check fails');
    await fresh.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (fails.length) {
    console.error(fails.map(f => '  FAIL ' + f).join('\n'));
    console.error(`clean-urls-browser: ${fails.length} failed, ${checks} passed`);
    process.exit(1);
  }
  console.log(`clean-urls-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
