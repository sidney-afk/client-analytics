'use strict';
/* Shared harness for the 2026-10 Notes + Messages mockups: serves the repo,
 * loads the REAL index.html with every backend answer local (fictional
 * fixture data only), so the screens are the live app's own markup and CSS.
 * Nothing leaves the machine except Google Fonts. */
const fs = require('fs'), http = require('http'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../../../qa/staff-gate-seed.js');
const root = process.env.MOCK_APP_ROOT ? path.resolve(process.env.MOCK_APP_ROOT) : path.resolve(__dirname, '../../../../..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const s = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let f = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    const full = path.join(root, path.normalize(f));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full)] || 'application/octet-stream' }); fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}
const SLUG = 'samplebakery', CLIENT = 'Sample Bakery';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const ART = c => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/><circle cx="740" cy="420" r="200" fill="#fff" opacity=".25"/></svg>`;
const ARTS = [['#fcd34d', '#f97316'], ['#a5b4fc', '#6366f1'], ['#86efac', '#0d9488'], ['#f9a8d4', '#be185d'], ['#fde68a', '#d97706']];
async function open(browser, { width, theme, posts, url, role, clientLink }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York' });
  await ctx.route(u => !u.toString().startsWith('http://127.0.0.1'), async route => {
    const q = route.request(), u = new URL(q.url());
    const json = (b, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (q.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (u.hostname === 'img.example.invalid') { const i = +(u.pathname.match(/\d+/) || [0])[0] % ARTS.length; return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ART(ARTS[i]) }); }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) return route.continue();
    const p = u.pathname;
    if (p.endsWith('/key-verify')) return json({ ok: true, role: role || 'admin', member: { id: 'm1', name: 'Alex', role: role || 'admin', team: null } });
    if (p.endsWith('/client-token-verify')) return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: 'calendar', strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Alex', role: 'smm', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = u.searchParams.get('key') || ''; const keys = /^in\.\(/.test(raw) ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : {}) })));
    }
    if (p === '/rest/v1/calendar_posts' || /client-review-link|calendar-read/.test(p)) {
      if (q.method() !== 'GET' && !/client-review-link|calendar-read/.test(p)) return json([]);
      return p.startsWith('/rest') ? json(posts) : json({ ok: true, posts, rows: posts, comments: [] });
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/|\/webhook\//.test(p)) return json({ ok: true, rows: [], comments: [], items: [] });
    if (/docs\.google\.com/.test(u.hostname)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await ctx.route('**/*', r => r.request().resourceType() === 'media' ? r.abort() : r.fallback());
  if (!clientLink) await seedStaffGate(ctx);
  await ctx.addInitScript(() => { const N = Date, t = N.parse('2026-10-16T15:00:00Z'); window.Date = class extends N { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; });
  await ctx.addInitScript(t => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors };
}
async function settle(page) {
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
}
/* Freeze the rendered page into a standalone static HTML file: no scripts,
 * every style tag kept, so it opens anywhere and looks exactly as captured. */
const ART_URI = i => 'data:image/svg+xml;base64,' + Buffer.from(ART(ARTS[i % ARTS.length])).toString('base64');
/* Freeze the rendered page into a standalone static HTML file: no scripts, the
 * app's big stylesheet written once to app.css and linked, fixture images
 * inlined, so it opens anywhere and looks exactly as captured. */
async function freeze(page, file, note) {
  const arts = ARTS.map((_, i) => ART_URI(i));
  const { html, css } = await page.evaluate(([n, arts]) => {
    const d = document.documentElement.cloneNode(true);
    d.querySelectorAll('script,link[rel=preload],link[rel=modulepreload],iframe,video').forEach(e => e.remove());
    d.querySelectorAll('*').forEach(e => { for (const a of [...e.attributes]) if (/^on/.test(a.name)) e.removeAttribute(a.name); });
    d.querySelectorAll('textarea').forEach(t => { t.textContent = ''; });
    d.querySelectorAll('img').forEach(i => { const m = /img\.example\.invalid\/(\d+)/.exec(i.getAttribute('src') || ''); if (m) i.setAttribute('src', arts[+m[1] % arts.length]); });
    d.querySelectorAll('[style*="img.example.invalid"]').forEach(e => { e.setAttribute('style', e.getAttribute('style').replace(/url\([^)]*img\.example\.invalid\/(\d+)[^)]*\)/g, (x, k) => 'url(' + arts[+k % arts.length] + ')')); });
    d.querySelectorAll('img[src],link[rel~=icon][href]').forEach(e => { const k = e.tagName === 'IMG' ? 'src' : 'href'; const v = e.getAttribute(k); if (v && !/^(data:|https?:|\/\/|\.\.\/)/.test(v)) e.setAttribute(k, '../../../../' + v.replace(/^\//, '')); });
    let css = '';
    d.querySelectorAll('style').forEach(st => { if (st.textContent.length > 100000) { css += st.textContent + '\n'; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'app.css'; st.replaceWith(l); } });
    const tag = document.createElement('div');
    tag.setAttribute('style', 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:420px;font:12px/1.4 system-ui,sans-serif;background:#111;color:#fff;padding:8px 10px;border-radius:8px;opacity:.9');
    tag.textContent = n; d.querySelector('body').appendChild(tag);
    return { html: '<!doctype html>\n' + d.outerHTML, css };
  }, [note, arts]);
  const dir = require('path').dirname(file);
  if (css) fs.writeFileSync(require('path').join(dir, 'app.css'), css.replace(/http:\/\/127\.0\.0\.1:\d+\//g, '../../../../'));
  fs.writeFileSync(file, html.replace(/http:\/\/127\.0\.0\.1:\d+\//g, '../../../../'));
}
module.exports = { ART_URI, serve, open, settle, freeze, chromium, SLUG, CLIENT, root };
