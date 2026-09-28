'use strict';
/* save-problems-browser.js -- Kasper › More › Save problems (admin, read-only),
 * in a real browser, fully offline (OPEN_REPAIRS 101 release A, 2026-09-27).
 *
 * Proves, with synthetic rows and every backend answer local:
 *   - an ADMIN sees the item; the page asks write-diagnostics for
 *     `staff_list` with the admin key, 7 days, automation hidden;
 *   - the table shows when, screen, action, who (client link hash prefix or
 *     verified staff role), card, error, cleaned message, browser, version;
 *   - every filter (period, screen, who, automated tests) uses the SyncView
 *     dropdown and asks the SERVER again, so a capped page never hides rows;
 *   - an SMM or CREATIVE session never sees the item and never sends the call;
 *   - a phone (390 wide) has no sideways page scroll and 44px controls;
 *   - nothing writes: no other non-read request leaves the page.
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
const ROWS = [
  { recorded_at: '2026-09-27T14:05:00Z', origin: 'browser_claim', surface: 'calendar', operation: 'status', ui_action: 'approve', code: 'write_conflict', status: 409, page: 'client_link', staff_role: null, card_ref: 'p_card_1', client_ref: 'abcdef012345', detail: 'Someone else changed this card', browser: 'safari', os: 'ios', app_version: '2026-09-27T13:00', traffic: 'person' },
  { recorded_at: '2026-09-27T12:00:00Z', origin: 'browser_claim', surface: 'production', operation: 'labels', ui_action: 'labels', code: 'label_selection_invalid', status: 422, page: 'staff_page', staff_role: 'smm', card_ref: 'b1_d_2', client_ref: null, detail: null, browser: 'chrome', os: 'windows', app_version: null, traffic: 'person' },
  { recorded_at: '2026-09-26T09:00:00Z', origin: 'gateway', surface: 'sxr', operation: 'comment', ui_action: null, code: 'comment_forbidden', status: 403, page: 'unknown', staff_role: null, card_ref: null, client_ref: null, detail: null, browser: null, os: null, app_version: null, traffic: 'unknown' },
];

async function open(browser, origin, role, viewport) {
  const failures = [];
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
  const calls = [];
  const writes = [];
  await ctx.route(u => !u.toString().startsWith(origin), route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = b => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/functions/v1/write-diagnostics') {
      const b = JSON.parse(r.postData() || '{}');
      if (b.action === 'staff_list') {
        calls.push({ body: b, key: r.headers()['x-syncview-key'] });
        return json({ ok: true, result: { days: b.days, include_automation: b.include_automation, total: 3, hidden_automation: 5, rows: ROWS } });
      }
      return route.fulfill({ status: 202, headers: CORS, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role, member: { id: 'qa_' + role, name: 'QA ' + role, role, team: null } });
    if (r.method() !== 'GET' && !/functions\/v1\/(key-verify|write-diagnostics|analytics-read)/.test(u.pathname)) writes.push(r.method() + ' ' + u.pathname);
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
  await page.waitForFunction(() => typeof _kasperGotoTab === 'function' && document.querySelector('[data-kasper-tab="save-problems"]'), null, { timeout: 20000 })
    .catch(() => failures.push(`${role}: Kasper never rendered its tabs`));
  await page.waitForTimeout(1500);
  return { ctx, page, calls, writes, errors, failures };
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const label = `admin ${vp.width}`;
      const s = await open(browser, origin, 'admin', vp);
      failures.push(...s.failures);
      const visible = await s.page.$eval('[data-kasper-tab="save-problems"]', b => !b.hidden).catch(() => false);
      if (!visible) failures.push(`${label}: the Save problems item is hidden for an admin`);
      await s.page.evaluate(() => _kasperGotoTab('save-problems'));
      await s.page.waitForSelector('.sp-table tbody tr', { timeout: 10000 }).catch(() => failures.push(`${label}: the table never drew`));
      const first = s.calls[0];
      if (!first || first.key !== 'qa-admin-key' || first.body.days !== 7 || first.body.include_automation !== false) failures.push(`${label}: staff_list was not asked with the admin key, 7 days, automation hidden (${JSON.stringify(first)})`);
      const text = await s.page.$eval('.sp-table', t => t.innerText).catch(() => '');
      for (const want of ['Client link · abcdef012345', 'Staff (SMM)', 'p_card_1', 'write_conflict (409)', 'Someone else changed this card', 'safari / ios', '2026-09-27 13:00 UTC', 'Samples', 'Production'])
        if (!text.includes(want)) failures.push(`${label}: the table is missing "${want}"`);
      const summary = await s.page.$eval('.sp-summary', e => e.innerText).catch(() => '');
      if (!/3 shown/.test(summary) || !/5 automated test rows hidden/.test(summary)) failures.push(`${label}: summary reads "${summary}"`);
      // SyncView dropdowns: open the trigger, pick the option.
      const pick = async (id, value) => {
        await s.page.click('#' + id + 'Btn');
        await s.page.click('#' + id + 'Menu [data-value="' + value + '"]');
        await s.page.waitForTimeout(400);
      };
      if (await s.page.$('.sp-controls select')) failures.push(`${label}: a browser-native select is still on the page`);
      await pick('spScreen', 'production');
      let lastBody = s.calls[s.calls.length - 1] && s.calls[s.calls.length - 1].body;
      if (!lastBody || lastBody.surface !== 'production' || lastBody.page !== null) failures.push(`${label}: the Screen filter did not ask the server (${JSON.stringify(lastBody)})`);
      await pick('spPage', 'client_link');
      lastBody = s.calls[s.calls.length - 1].body;
      if (lastBody.surface !== 'production' || lastBody.page !== 'client_link') failures.push(`${label}: the Who filter did not ask the server (${JSON.stringify(lastBody)})`);
      await pick('spScreen', '');
      await pick('spPage', '');
      await s.page.check('[data-sp-automation]');
      await s.page.waitForTimeout(400);
      await pick('spDays', '30');
      const last = s.calls[s.calls.length - 1];
      if (s.calls.length !== 7 || !last || last.body.days !== 30 || last.body.include_automation !== true || last.body.surface !== null) failures.push(`${label}: filters did not ask again as expected (${JSON.stringify(s.calls.map(c => c.body))})`);
      const m = await s.page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const small = [...document.querySelectorAll('.sp-control .sv-select-trigger, .sp-check, .sp-refresh')].filter(e => e.getClientRects().length)
          .map(e => ({ what: (e.innerText || e.tagName).trim().slice(0, 24), h: e.getBoundingClientRect().height })).filter(x => x.h < 44);
        return { W, sw: document.documentElement.scrollWidth, small };
      });
      if (process.env.SP_SHOTS) await s.page.screenshot({ path: path.join(process.env.SP_SHOTS, `save-problems-${vp.width}.png`), fullPage: true });
      if (m.sw > m.W) failures.push(`${label}: page scrolls sideways (${m.sw} > ${m.W})`);
      if (vp.width < 768) for (const x of m.small) failures.push(`${label}: "${x.what}" is ${Math.round(x.h)}px tall, under 44px`);
      if (s.writes.length) failures.push(`${label}: the read-only tab sent writes: ${s.writes.join(', ')}`);
      if (s.errors.length) failures.push(`${label}: page errors: ${s.errors.join(' | ')}`);
      await s.ctx.close();
    }
    for (const role of ['smm', 'creative']) {
      const s = await open(browser, origin, role, { width: 1440, height: 900 });
      const shown = await s.page.$eval('[data-kasper-tab="save-problems"]', b => !b.hidden).catch(() => false);
      if (shown) failures.push(`${role}: the Save problems item is visible`);
      await s.page.evaluate(() => _kasperGotoTab('save-problems')).catch(() => {});
      await s.page.waitForTimeout(800);
      if (s.calls.length) failures.push(`${role}: staff_list was sent`);
      await s.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('save-problems-browser FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('save-problems-browser: admin list, filters, role gating and phone layout passed');
})().catch(e => { console.error(e); process.exit(1); });
