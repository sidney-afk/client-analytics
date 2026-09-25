'use strict';
/* clients-admin-browser.js -- Kasper › More › Clients (admin, read-only), in a
 * real browser, fully offline.
 *
 * Proves, with synthetic clients and every backend answer local:
 *   - an ADMIN sees the Clients item and the list; the page asks analytics-read
 *     for `list_client_profiles` with the staff key and nothing else;
 *   - archived clients are hidden until asked for;
 *   - an SMM or CREATIVE session never sees the item and never sends the call;
 *   - on a phone (390 and 375 wide) the list, then a client's details, fit the
 *     screen with no sideways scroll and every control at least 44px tall;
 *   - nothing writes: no non-read request leaves the page.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffIdentity, refuseStubKeyProductionWrite } = require('../../../qa/staff-gate-seed');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const mk = (i, name, extra) => Object.assign({
  slug: 'fixture' + i, display_name: name, email: 'team' + i + '@example.invalid', instagram_handle: '@fixture' + i,
  tiktok_handle: null, youtube_channel_id: null, competitors: null, keywords: 'routines', specific_keywords: null,
  content_description: 'Short educational reels.', slack_channel_id: null, creative_channel_id: null, roam_channel_id: null,
  upload_post_profile: null, postforme_account_id: null, extra: {}, source: 'sheet', sheet_synced_at: '2026-09-25T06:00:00Z',
  archived_at: null, created_at: '2026-09-25T06:00:00Z', updated_at: '2026-09-25T06:00:00Z', updated_by: 'sheet-copy',
}, extra || {});
const ROWS = [mk(1, 'Avery Fixture'), mk(2, 'Blake Sample'), mk(3, 'Casey Example', { archived_at: '2026-09-20T00:00:00Z' })];

async function open(browser, origin, role, viewport) {
  const failures = [];
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
  const calls = [];
  const writes = [];
  const ctl = { fail: false };
  await ctx.route(u => !u.toString().startsWith(origin), route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = b => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/functions/v1/analytics-read' && ctl.fail) return route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: '{"ok":false,"error":"read_failed"}' });
    if (u.pathname === '/functions/v1/analytics-read') { calls.push({ body: r.postData(), key: r.headers()['x-syncview-key'] }); return json({ ok: true, principal: 'staff', authority: { source: 'sheet' }, clients: ROWS }); }
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role, member: { id: 'qa_' + role, name: 'QA ' + role, role, team: null } });
    if (r.method() !== 'GET' && !/functions\/v1\/(key-verify|write-diagnostics)/.test(u.pathname)) writes.push(r.method() + ' ' + u.pathname);
    if (/rest\/v1/.test(u.pathname)) return json([]);
    if (/functions|webhook/.test(u.pathname)) return json({});
    return route.abort();
  });
  await seedStaffIdentity(ctx, { id: 'qa_' + role, name: 'QA ' + role, role, team: null }, 'qa-' + role + '-key');
  await refuseStubKeyProductionWrite(ctx);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  await page.goto(origin + '/#kasper', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function' && document.querySelector('[data-kasper-tab="clients"]'), null, { timeout: 20000 })
    .catch(() => failures.push(`${role}: Kasper never rendered its tabs`));
  await page.waitForTimeout(1500);
  return { ctx, page, calls, writes, errors, failures, ctl };
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 667 }]) {
      const label = `admin ${vp.width}x${vp.height}`;
      const s = await open(browser, origin, 'admin', vp);
      failures.push(...s.failures);
      const visible = await s.page.$eval('[data-kasper-tab="clients"]', b => !b.hidden).catch(() => false);
      if (!visible) failures.push(`${label}: the Clients item is hidden for an admin`);
      await s.page.evaluate(() => _kasperGotoTab('clients'));
      await s.page.waitForSelector('.ca-row', { timeout: 10000 }).catch(() => failures.push(`${label}: the client list never drew`));
      const n = await s.page.$$eval('.ca-row', x => x.length).catch(() => 0);
      if (n !== 2) failures.push(`${label}: expected 2 active clients listed, found ${n}`);
      const call = s.calls[0];
      if (!call || JSON.parse(call.body || '{}').action !== 'list_client_profiles' || call.key !== 'qa-admin-key') failures.push(`${label}: analytics-read was not asked for list_client_profiles with the admin key`);
      await s.page.click('.ca-link');
      const withArchived = await s.page.$$eval('.ca-row', x => x.length);
      if (withArchived !== 3) failures.push(`${label}: "Show archived" did not reveal the archived client`);
      await s.page.click('.ca-row >> nth=0');
      await s.page.waitForSelector('.ca-detail-head', { timeout: 3000 }).catch(() => failures.push(`${label}: details never opened`));
      const m = await s.page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const small = [...document.querySelectorAll('.ca-wrap button, .ca-wrap input')].filter(e => e.getClientRects().length)
          .map(e => ({ what: (e.innerText || e.placeholder || '').trim().slice(0, 24), h: e.getBoundingClientRect().height })).filter(x => x.h < 44);
        return { W, sw: document.documentElement.scrollWidth, small };
      });
      if (m.sw > m.W) failures.push(`${label}: page scrolls sideways (${m.sw} > ${m.W})`);
      if (vp.width < 768) for (const x of m.small) failures.push(`${label}: "${x.what}" is ${Math.round(x.h)}px tall, under 44px`);
      if (s.writes.length) failures.push(`${label}: the read-only tab sent writes: ${s.writes.join(', ')}`);
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);
      if (vp.width === 1440) {
        // A failed Refresh keeps the rows but says so.
        s.ctl.fail = true;
        await s.page.click('.ca-wrap .cc-btn');
        await s.page.waitForSelector('.ca-stale', { timeout: 5000 }).catch(() => failures.push(`${label}: a failed Refresh was silent`));
        if (!(await s.page.$('.ca-row'))) failures.push(`${label}: a failed Refresh threw away the rows already shown`);
        s.ctl.fail = false;
        // Signing out purges the admin-only list from memory and screen.
        await s.page.evaluate(() => { _syncviewStaffIdentityClear(); _syncviewStaffPurgeSensitiveState(); });
        await s.page.waitForTimeout(800);
        const leftover = await s.page.evaluate(() => ({ rows: document.querySelectorAll('.ca-row').length, text: /Avery Fixture/.test(document.body.innerText), mem: (_caState.rows || []).length }));
        if (leftover.rows || leftover.text || leftover.mem) failures.push(`${label}: client details survived a sign-out (${JSON.stringify(leftover)})`);
      }
      console.log(`${failures.length ? '...' : 'ok  '} ${label}`);
      await s.ctx.close();
    }
    for (const role of ['smm', 'creative']) {
      const s = await open(browser, origin, role, { width: 1440, height: 900 });
      const hidden = await s.page.$eval('[data-kasper-tab="clients"]', b => b.hidden).catch(() => true);
      if (!hidden) failures.push(`${role}: the Clients item is visible to a non-admin`);
      await s.page.evaluate(() => _kasperGotoTab('clients')).catch(() => {});
      await s.page.waitForTimeout(800);
      if (s.calls.length) failures.push(`${role}: a non-admin session called list_client_profiles`);
      if (await s.page.$('.ca-row')) failures.push(`${role}: a non-admin session rendered the client list`);
      console.log(`ok   ${role} is kept out`);
      await s.ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error('\n' + failures.join('\n')); process.exit(1); }
  console.log('\nclients-admin-browser: OK (admin desktop + two phones, smm and creative kept out, read-only)');
})().catch(e => { console.error(e); process.exit(2); });
