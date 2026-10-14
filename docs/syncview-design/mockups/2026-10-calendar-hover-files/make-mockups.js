'use strict';
/* Mockups for two proposed Calendar additions, drawn on the REAL page.
 *
 * Runs the app locally (staff Calendar, desktop) against fictional data that
 * never leaves the machine, then draws only the new parts on top using the
 * app's own CSS classes and colour tokens, and screenshots light and dark:
 *   item2-hover-card-{light,dark}.png  hover card on the SyncLinear video link
 *   item3-files-menu-{light,dark}.png  per-card files menu (replaces the Frame icon)
 * Nothing here ships: the overlays exist only in this script.
 *
 * Run:  node docs/syncview-design/mockups/2026-10-calendar-hover-files/make-mockups.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffGate } = require('../../../../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const out = __dirname;
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

const CLIENT = 'Test Client';
const SLUG = 'testclient';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const card = (id, name, date, vid, extra) => Object.assign({ id, client: SLUG, name, status: 'In Progress', order_index: Number(id.slice(-1)),
  updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: date, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  video_deliverable_id: vid, graphic_deliverable_id: '', caption: 'A made-up caption for a made-up video, long enough to wrap onto a second line.',
  comments: [], graphic_comments: [], caption_comments: [] }, extra || {});
const CARDS = [
  card('mk1', 'Morning routine reset', '2026-10-15', 'del_mock_1', { thumbnail_url: 'https://example.invalid/thumb.png' }),
  card('mk2', 'Three myths about sleep', '2026-10-17', 'del_mock_2'),
  card('mk3', 'Kitchen tour, part two', '2026-10-20', ''),
];

async function open(browser, origin, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', colorScheme: theme });
  const page = await ctx.newPage();
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = b => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Mock Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/brain') return json({ ok: true, frame: [{ url: 'https://example.invalid/frame', name: 'Batch', at: '2026-10-01' }], raw: [] });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Mock Staff', role: 'admin', team: null, active: true }]);
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
  await page.waitForSelector('.cal-prod-btn', { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

/* The proposed parts. Only app tokens (--white, --border, --text-*, --err-*)
   and existing classes (.dropdown-menu, .dropdown-item, .cal-status). */
const CSS = `
  .mk-hc { position: absolute; z-index: 60; width: 300px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px;
    background: var(--white); box-shadow: var(--shadow-md); font-family: 'Plus Jakarta Sans', sans-serif; color: var(--text-primary); }
  .mk-hc-id { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.06em; color: var(--text-muted); }
  .mk-hc-title { margin: 2px 0 10px; font-size: 0.86rem; font-weight: 700; line-height: 1.3; }
  .mk-hc-grid { display: grid; grid-template-columns: 84px 1fr; row-gap: 7px; font-size: 0.74rem; }
  .mk-hc-k { color: var(--text-muted); font-weight: 600; }
  .mk-hc-v { font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .mk-hc-late { color: var(--err-solid-bg); font-weight: 700; }
  .mk-hc-sub { color: var(--text-muted); font-weight: 500; }
  .mk-hc-av { width: 18px; height: 18px; border-radius: 50%; background: #6c5ce7; color: #fff; font-size: 0.6rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
  .mk-files.dropdown-menu { min-width: 236px; padding: 6px; }
  .mk-files .dropdown-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; font-size: 0.78rem; font-weight: 600; color: var(--text-primary); text-decoration: none; }
  .mk-files .dropdown-item svg { width: 15px; height: 15px; flex: 0 0 15px; opacity: 0.75; }
  .mk-files .dropdown-item .mk-ext { margin-left: auto; opacity: 0.45; width: 11px; height: 11px; flex-basis: 11px; }
  .mk-files .dropdown-item.is-missing { color: var(--text-muted); cursor: default; }
  .mk-files .dropdown-item.is-missing svg { opacity: 0.4; }
  .mk-files .mk-miss { margin-left: auto; font-size: 0.66rem; font-weight: 600; font-style: italic; color: var(--text-muted); }
  .mk-files .mk-hd { padding: 7px 12px 3px; font-size: 0.6rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .mk-mark { position: absolute; z-index: 61; border: 2px dashed #6c5ce7; border-radius: 10px; pointer-events: none; }
  .mk-note { position: absolute; z-index: 61; padding: 3px 8px; border-radius: 6px; background: #6c5ce7; color: #fff; font: 700 11px 'Plus Jakarta Sans', sans-serif; }
`;

async function hoverCard(page) {
  await page.evaluate(css => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const a = document.querySelector('.cal-prod-btn'); const b = a.getBoundingClientRect();
    const sx = scrollX, sy = scrollY;
    const mark = document.createElement('div'); mark.className = 'mk-mark';
    Object.assign(mark.style, { left: (b.left + sx - 4) + 'px', top: (b.top + sy - 4) + 'px', width: (b.width + 8) + 'px', height: (b.height + 8) + 'px' });
    const hc = document.createElement('div'); hc.className = 'mk-hc'; hc.setAttribute('role', 'tooltip');
    hc.innerHTML = `<div class="mk-hc-id">VID-142</div><div class="mk-hc-title">Three myths about sleep: video edit</div>
      <div class="mk-hc-grid">
        <span class="mk-hc-k">Status</span><span class="mk-hc-v"><span class="cal-status cal-status-in-progress">In Progress</span><span class="mk-hc-sub">for 3 days</span></span>
        <span class="mk-hc-k">Assignee</span><span class="mk-hc-v"><span class="mk-hc-av">AE</span>Alex Editor</span>
        <span class="mk-hc-k">Due</span><span class="mk-hc-v mk-hc-late">Fri Oct 10 · 3 days late</span>
        <span class="mk-hc-k">Priority</span><span class="mk-hc-v">High</span>
        <span class="mk-hc-k">Updated</span><span class="mk-hc-v">2 hours ago</span>
        <span class="mk-hc-k">Comments</span><span class="mk-hc-v">4</span>
      </div>`;
    document.body.append(mark, hc);
    Object.assign(hc.style, { left: (b.right + sx + 10) + 'px', top: (b.top + sy - 8) + 'px' });
  }, CSS);
}

const ICONS = {
  plan: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 1.8h5.5L12.5 5v9.2H4z"/><path d="M6 8h4.5M6 10.6h4.5"/></svg>',
  raw: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M1.8 4h4l1.5 1.6h6.9v7.6H1.8z"/></svg>',
  frame: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6.5 6.3v3.4l3-1.7z"/></svg>',
  thumb: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="2"/><circle cx="6" cy="6.5" r="1.3"/><path d="M2.5 12l3.8-3.5 2.6 2.3 2-1.6 2.6 2.3"/></svg>',
  ext: '<svg class="mk-ext" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2v8h8V7M7 2h3v3M10 2L5.5 6.5"/></svg>',
};
async function filesMenu(page) {
  await page.evaluate(([css, I]) => {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const a = document.querySelector('.cal-frame-btn'); const b = a.getBoundingClientRect();
    const sx = scrollX, sy = scrollY;
    const mark = document.createElement('div'); mark.className = 'mk-mark';
    Object.assign(mark.style, { left: (b.left + sx - 4) + 'px', top: (b.top + sy - 4) + 'px', width: (b.width + 8) + 'px', height: (b.height + 8) + 'px' });
    const row = (ico, label, on) => on
      ? `<a class="dropdown-item" role="menuitem" href="#" target="_blank" rel="noopener">${I[ico]}<span>${label}</span>${I.ext}</a>`
      : `<span class="dropdown-item is-missing" role="menuitem" aria-disabled="true">${I[ico]}<span>${label}</span><span class="mk-miss">not linked yet</span></span>`;
    const m = document.createElement('div'); m.className = 'dropdown-menu open mk-files'; m.setAttribute('role', 'menu');
    m.innerHTML = `<div class="mk-hd">Files</div>${row('plan', 'Filming plan', true)}${row('raw', 'Raw footage folder', false)}${row('frame', 'Frame folder', true)}${row('thumb', 'Thumbnail file', true)}`;
    m.style.position = 'absolute';
    document.body.append(mark, m);
    Object.assign(m.style, { left: (b.right + sx + 8) + 'px', top: (b.top + sy - 6) + 'px', right: 'auto' });
  }, [CSS, ICONS]);
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const theme of ['light', 'dark']) {
      let t = await open(browser, origin, theme);
      await hoverCard(t.page);
      await t.page.screenshot({ path: path.join(out, `item2-hover-card-${theme}.png`), animations: 'disabled' });
      await t.ctx.close();
      t = await open(browser, origin, theme);
      await filesMenu(t.page);
      await t.page.screenshot({ path: path.join(out, `item3-files-menu-${theme}.png`), animations: 'disabled' });
      await t.ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log('mockups written to ' + path.relative(root, out));
})().catch(e => { console.error(e); process.exitCode = 1; });
