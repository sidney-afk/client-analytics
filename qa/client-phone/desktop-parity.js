'use strict';
/* desktop-parity.js -- proves a client-phone CSS change moved NO desktop pixel.
 *
 * Loads two builds of index.html (BEFORE = a git ref, default origin/main;
 * AFTER = the working-tree index.html) and screenshots each page at 1024,
 * 1280, 1440 and 1920 wide. Every pair must be byte-identical PNGs, and every
 * element's computed style must match too (catches changes a screenshot of
 * an empty state would not show).
 *
 *   Staff tabs: fully offline, stub staff identity, every backend answer
 *   empty. Every visible header tab is shot.
 *   Client pages: the canonical TEST client only, live READ-ONLY boot of
 *   analytics, calendar, brief and sample-reviews. Nothing is clicked.
 *
 * Both builds are served from the same origin by request interception, and
 * each pair is shot back to back so live data cannot drift between them.
 * Animations and transitions are frozen identically in both builds.
 *
 * Rendering noise, measured: with the SAME build on both sides
 * (PARITY_CONTROL=1), staff Analytics at 1920 renders its search-button icon
 * in one of two anti-aliased states at random (21 pixels). So each pair gets
 * up to four fresh attempts. A real CSS change moves the same pixels on every
 * load, so it can never pass by retrying; the attempt count is reported.
 *
 *   node qa/client-phone/desktop-parity.js [--before=<git ref>] [--out=<dir>] [--staff-only]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../staff-gate-seed');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BEFORE_REF = arg('before', 'origin/main');
const OUT = arg('out', '');
const STAFF_ONLY = process.argv.includes('--staff-only');
const WIDTHS = process.env.PARITY_W ? process.env.PARITY_W.split(',').map(Number) : [1024, 1280, 1440, 1920];
const HEIGHT = 900;
const ORIGIN = 'http://127.0.0.1:8765';
const SETTLE_STAFF = 3500;
const SETTLE_CLIENT = 12000;

const builds = {
  before: execFileSync('git', ['show', `${BEFORE_REF}:index.html`], { cwd: ROOT, maxBuffer: 64 << 20 }),
  after: fs.readFileSync(path.join(ROOT, 'index.html')),
};
if (process.env.PARITY_CONTROL) builds.after = builds.before; // same build twice: measures harness noise
const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function serveLocal(route, build) {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: builds[build] });
  const full = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)));
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, contentType: mime[path.extname(full)] || 'application/octet-stream', body: fs.readFileSync(full) });
}

function offlineAnswer(route) {
  const r = route.request(); const u = r.url();
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
  if (/\/rest\/v1\//.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' });
  if (/\/functions\/v1\/key-verify/.test(u)) return route.fallback();
  if (/\/functions\/v1\/|\/webhook\//.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });
  return route.abort();
}

// Live relay through Node (the sandbox proxy's CA is trusted by Node, not by
// the bundled browser). Read-only: GET/HEAD/OPTIONS pass; a POST passes ONLY
// to an exact, verified read-only Edge Function. Every other write, every
// PostgREST RPC included, is refused locally and never reaches the backend.
const LIVE_POST_READS = new Set(['/functions/v1/client-token-verify', '/functions/v1/thumbnail-revision-read']);
async function liveRelay(route) {
  const q = route.request();
  const u = new URL(q.url());
  const readOnly = q.method() === 'GET' || q.method() === 'HEAD' || q.method() === 'OPTIONS'
    || (q.method() === 'POST' && u.hostname.endsWith('.supabase.co') && LIVE_POST_READS.has(u.pathname));
  if (!readOnly) return route.fulfill({ status: 403, headers: CORS, body: '{"error":"parity harness is read-only"}' });
  try {
    const h = { ...q.headers() }; delete h.host;
    const r = await fetch(q.url(), { method: q.method(), headers: h, body: ['GET', 'HEAD'].includes(q.method()) ? undefined : q.postDataBuffer() });
    const body = Buffer.from(await r.arrayBuffer());
    const headers = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) headers[k] = v; });
    await route.fulfill({ status: r.status, headers, body });
  } catch (e) { await route.abort().catch(() => {}); }
}

async function shoot(browser, build, width, url, mode, clickId, view, token) {
  const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route(u => u.toString().startsWith(ORIGIN), r => serveLocal(r, build));
  if (mode === 'staff') {
    await ctx.route(u => !u.toString().startsWith(ORIGIN), offlineAnswer);
    await seedStaffGate(ctx);
    await ctx.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); sessionStorage.setItem('syncview_ttpilot_unlocked', 'ok'); } catch (e) {} });
  } else {
    await ctx.route(u => !u.toString().startsWith(ORIGIN), liveRelay);
  }
  await ctx.addInitScript(css => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }); }, FREEZE);
  const page = await ctx.newPage();
  if (view) {
    // Client pages go through the redacting helper: its errors never carry the token.
    await require('../test-client-entry.js').gotoTestClientEntry(page, { view, origin: ORIGIN, token, gotoOptions: { waitUntil: 'domcontentloaded' } });
  } else {
    await page.goto(ORIGIN + url, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(mode === 'staff' ? SETTLE_STAFF : SETTLE_CLIENT);
  if (clickId && clickId !== 'navHome') { await page.click(clickId.startsWith('[') ? clickId : '#' + clickId); await page.waitForTimeout(SETTLE_STAFF); }
  await page.evaluate(() => { try { document.activeElement && document.activeElement.blur(); } catch (e) {} });
  // Settle: keep shooting until three consecutive frames agree (max ~25s),
  // so a late loader or a "Refreshing" pill is not mistaken for a change.
  let png = await page.screenshot({ fullPage: true }); let streak = 0;
  for (let i = 0; i < 25 && streak < 2; i++) {
    await page.waitForTimeout(1000);
    const next = await page.screenshot({ fullPage: true });
    streak = next.equals(png) ? streak + 1 : 0; png = next;
  }
  const styles = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      out.push([el.tagName, Array.from(cs).sort().map(k => k + ':' + cs.getPropertyValue(k)).join(';'), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join('|'));
    }
    return out.join('\n');
  });
  await ctx.close();
  if (process.env.PARITY_DUMP) fs.writeFileSync(process.env.PARITY_DUMP + '-' + build + '.txt', styles);
  return { png, styleHash: crypto.createHash('sha256').update(styles).digest('hex') };
}

async function staffTabs(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: HEIGHT } });
  await ctx.route(u => u.toString().startsWith(ORIGIN), r => serveLocal(r, 'after'));
  await ctx.route(u => !u.toString().startsWith(ORIGIN), offlineAnswer);
  await seedStaffGate(ctx);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); sessionStorage.setItem('syncview_ttpilot_unlocked', 'ok'); } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_STAFF);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#headerNav > .header-nav-btn')]
    .filter(a => a.getClientRects().length && getComputedStyle(a).display !== 'none')
    .map(a => ({ id: a.id, href: a.getAttribute('href') })));
  await ctx.close();
  return tabs.map(t => ({ name: 'staff-' + t.id, url: '/', clickId: t.id, mode: 'staff' }));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let pages = await staffTabs(browser);
  if (!STAFF_ONLY) {
    const T = require('../test-client-entry.js');
    const token = await T.currentTestClientToken();
    for (const view of ['analytics', 'calendar', 'brief', 'sample-reviews']) {
      pages.push({ name: 'client-' + view, view, token, mode: 'client' });
      // The Calendar's Month and Week views are reached by a click, not a URL.
      if (view === 'calendar') for (const cv of ['month', 'week']) pages.push({ name: 'client-calendar-' + cv, view, token, mode: 'client', clickId: `[data-cal-view="${cv}"]` });
    }
  }
  if (process.env.PARITY_ONLY) pages = pages.filter(p => p.name === process.env.PARITY_ONLY);
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const rows = []; let fail = 0;
  for (const pg of pages) {
    for (const w of WIDTHS) {
      let a, b, same = false;
      let attempts = 0;
      for (let attempt = 0; attempt < 4 && !same; attempt++) {
        attempts++;
        a = await shoot(browser, 'before', w, pg.url, pg.mode, pg.clickId, pg.view, pg.token);
        b = await shoot(browser, 'after', w, pg.url, pg.mode, pg.clickId, pg.view, pg.token);
        same = a.png.equals(b.png) && a.styleHash === b.styleHash;
      }
      if (OUT) {
        fs.writeFileSync(path.join(OUT, `${pg.name}-${w}-before.png`), a.png);
        fs.writeFileSync(path.join(OUT, `${pg.name}-${w}-after.png`), b.png);
      }
      const row = { page: pg.name, width: w, pixels: a.png.equals(b.png) ? 'identical' : 'DIFFERENT', styles: a.styleHash === b.styleHash ? 'identical' : 'DIFFERENT', sha: crypto.createHash('sha256').update(b.png).digest('hex').slice(0, 12), attempts };
      if (!same) fail++;
      rows.push(row);
      console.log(`${same ? 'ok  ' : 'FAIL'} ${pg.name} @${w}: pixels ${row.pixels}, computed styles ${row.styles} (${row.sha}${attempts > 1 ? ', attempts ' + attempts : ''})`);
    }
  }
  await browser.close();
  if (OUT) fs.writeFileSync(path.join(OUT, 'parity.json'), JSON.stringify(rows, null, 1));
  console.log(`\n${rows.length - fail}/${rows.length} desktop shots identical to ${BEFORE_REF}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(String(e && e.message || e).replace(/[?&]t=[^&\s]+/g, '&t=<redacted>')); process.exit(2); });
