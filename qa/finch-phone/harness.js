'use strict';
/* Offline phone harness for the staff screens (upload, analytics, workload,
 * Linear). The real generated index.html is served from loopback and driven in
 * Chromium. Every backend host is refused; Supabase reads answer from the
 * `mocks` table below (empty by default) and every write is refused and
 * recorded, so nothing here can reach a live system. Data is invented. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { seedStaffIdentity } = require('../staff-gate-seed.js');

/* FINCH_ROOT serves another checkout (the "before" pictures use a clean copy of the base branch). */
const root = process.env.FINCH_ROOT ? path.resolve(process.env.FINCH_ROOT) : path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve(sourceRoot = root) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/__vendor/') && global.__finchVendor) {
      const vf = path.join(global.__finchVendor, path.basename(url.pathname));
      if (fs.existsSync(vf)) { res.writeHead(200, { 'Content-Type': 'font/ttf' }); fs.createReadStream(vf).pipe(res); return; }
    }
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(sourceRoot, file);
    if (!full.startsWith(sourceRoot) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* opts: { width, height, theme: 'light'|'dark', hash, rest: {table: rows|fn},
 *         fn: {name: body|fn}, csv: {matcher: text}, init: string, role } */
async function open(opts) {
  const o = opts || {};
  const role = o.role || 'admin';
  const member = { id: 'qa_staff', name: 'QA Staff', role, team: null };
  const state = { blocked: [], writes: [], errors: [] };
  const server = await serve(o.sourceRoot ? path.resolve(o.sourceRoot) : root);
  global.__finchVendor = o.vendor || process.env.FINCH_VENDOR;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROMIUM || undefined });
  const context = await browser.newContext({
    viewport: { width: o.width || 390, height: o.height || 844 },
    deviceScaleFactor: o.dsf || 2, isMobile: !o.desktop, hasTouch: !o.desktop,
    colorScheme: o.theme === 'dark' ? 'dark' : 'light',
  });
  /* Pin the clock so dates in the screenshots are the same on every run. */
  await context.clock.install({ time: new Date(o.now || '2026-10-05T15:00:00.000Z') });
  const page = await context.newPage();
  page.on('pageerror', e => state.errors.push(e.message));
  await context.addInitScript(({ theme }) => {
    try { localStorage.setItem('syncview_theme', theme); localStorage.setItem('sv_theme', theme); } catch (e) {}
  }, { theme: o.theme || 'light' });
  if (o.init) await context.addInitScript(o.init);
  const base = `http://127.0.0.1:${server.address().port}/`;
  /* Optional local copies of the CDN scripts and fonts (FINCH_VENDOR=<dir>),
   * so screenshots can draw charts and use the app's typeface offline. */
  const vendor = o.vendor || process.env.FINCH_VENDOR;
  const vfile = (n, type) => route => { try { return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(path.join(vendor, n)) }); } catch (e) { return route.abort(); } };
  await context.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (vendor && /chart\.js@4/.test(u)) return vfile('chart.umd.min.js', 'text/javascript')(route);
    if (vendor && /supabase-js@2/.test(u)) return vfile('supabase.js', 'text/javascript')(route);
    if (vendor && /fonts\.googleapis\.com/.test(u)) {
      const face = w => `@font-face{font-family:'Plus Jakarta Sans';font-weight:${w};src:url(${base}__vendor/plus-jakarta-${w}.ttf)}`;
      return route.fulfill({ status: 200, contentType: 'text/css', body: [400, 500, 600, 700, 800].map(face).join('') });
    }
    if (vendor && u.startsWith(base + '__vendor/')) return route.continue();
    state.blocked.push(u);
    return route.abort();
  });
  await seedStaffIdentity(context, member);
  const json = (r, body, status) => r.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route(/\.supabase\.co\/(rest|functions)\/v1\//, async route => {
    const req = route.request();
    const u = new URL(req.url());
    const isRest = u.pathname.includes('/rest/v1/');
    const name = u.pathname.split('/').pop();
    let body = null;
    try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
    const table = isRest ? (o.rest || {}) : (o.fn || {});
    const src = table[name];
    // Table reads (GET) and Edge Function calls with a hook are answered from
    // the fixtures. Every other write is refused and recorded.
    if (src && src.__hold) return new Promise(() => {});
    if (isRest && req.method() !== 'GET') {
      state.writes.push({ name, method: req.method(), body });
      return json(route, { ok: false, error: 'offline_harness' }, 403);
    }
    if (!isRest && src !== undefined && !(body && body.action === 'list')) state.writes.push({ name, body });
    if (src === undefined) {
      if (!isRest && req.method() !== 'GET') { state.writes.push({ name, body }); return json(route, { ok: false, error: 'offline_harness' }, 403); }
      return json(route, isRest ? [] : { ok: true });
    }
    try { return json(route, typeof src === 'function' ? (isRest ? src(req) : src(body, req)) : src); } catch (e) { return json(route, { ok: false, error: 'offline_harness_refused' }, 500); }
  });
  await context.route('**/functions/v1/key-verify', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, role, member }) }));
  for (const [needle, text] of Object.entries(o.csv || {})) {
    await context.route(u => u.href.includes(needle), r => (text && text.hold ? new Promise(() => {}) : text && typeof text === 'object' ? r.fulfill(text) : r.fulfill({ status: 200, contentType: 'text/csv', body: typeof text === 'function' ? text() : text })));
  }
  for (const [glob, handler] of o.routes || []) await context.route(glob, handler);
  await page.goto(base + (o.query ? '?' + o.query : '') + (o.hash || ''), { waitUntil: 'domcontentloaded' });
  const close = async () => { await context.close().catch(() => {}); await browser.close().catch(() => {}); await new Promise(r => server.close(r)); };
  return { page, context, state, close, base };
}
module.exports = { open };
