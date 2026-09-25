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
 *   - an admin can edit: Save sends ONLY the changed fields, with the admin
 *     key, the admin's member id and the row version, to client-profile-write;
 *     "the sheet changed" is shown with the fields and a way to load them;
 *     on phones the edit form fits, inputs are 44px tall with 16px text;
 *   - nothing else writes: no other non-read request leaves the page.
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
  const ctl = { fail: false, edit: 'ok' };
  const edits = [];
  await ctx.route(u => !u.toString().startsWith(origin), route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = b => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/functions/v1/analytics-read' && ctl.fail) return route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: '{"ok":false,"error":"read_failed"}' });
    if (u.pathname === '/functions/v1/analytics-read') { calls.push({ body: r.postData(), key: r.headers()['x-syncview-key'] }); return json({ ok: true, principal: 'staff', authority: { source: 'sheet' }, clients: ROWS }); }
    if (u.pathname === '/functions/v1/client-profile-write') {
      const b = JSON.parse(r.postData() || '{}');
      edits.push({ body: b, key: r.headers()['x-syncview-key'] });
      if (b.action === 'status') return json({ ok: true, sheet_configured: true, service_account: 'robot@fixture.iam.example.invalid', sheet_id_secret: 'X' });
      if (ctl.edit === 'unshared') return route.fulfill({ status: 502, headers: CORS, contentType: 'application/json', body: '{"ok":false,"error":"sheet_not_shared"}' });
      if (b.action === 'refresh_from_sheet') return json({ ok: true, row: Object.assign({}, ROWS[0], { instagram_handle: '@from-sheet', updated_at: '2026-09-25T09:00:00Z' }) });
      if (ctl.edit === 'conflict') return route.fulfill({ status: 409, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'sheet_changed', fields: ['instagram_handle'] }) });
      const row = ROWS.find(x => x.slug === b.slug);
      return json({ ok: true, fields: Object.keys(b.changes || {}), row: Object.assign({}, row, b.changes, { source: 'syncview', updated_by: 'QA admin', updated_at: '2026-09-25T10:00:00Z' }) });
    }
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role, member: { id: 'qa_' + role, name: 'QA ' + role, role, team: null } });
    if (r.method() !== 'GET' && !/functions\/v1\/(key-verify|write-diagnostics|client-profile-write|analytics-read)/.test(u.pathname)) writes.push(r.method() + ' ' + u.pathname);
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
  return { ctx, page, calls, writes, errors, failures, ctl, edits };
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
      const lay = await s.page.evaluate(() => {
        const d = document.querySelector('.ca-detail'); const secs = [...d.querySelectorAll('.ca-group')];
        const last = secs[secs.length - 1];
        return { roam: /roam/i.test(d.innerText), lastIsResearch: !!last && last.matches('details.ca-fold') && /Content research/.test(last.innerText), open: !!last && last.open };
      });
      if (lay.roam) failures.push(`${label}: the Roam channel field is still shown`);
      if (!lay.lastIsResearch || lay.open) failures.push(`${label}: Content research is not last and folded (${JSON.stringify(lay)})`);
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
      // Edit: change one field, save, and only that field is sent.
      await s.page.click('.ca-edit-btn');
      await s.page.waitForSelector('#caIn_email', { timeout: 3000 }).catch(() => failures.push(`${label}: Edit never opened the form`));
      const em = await s.page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const ins = [...document.querySelectorAll('.ca-detail .ca-input')].filter(e => e.getClientRects().length);
        return { W, sw: document.documentElement.scrollWidth, n: ins.length, roam: !!document.querySelector('[data-ca-field="roam_channel_id"]'),
          small: ins.filter(e => e.getBoundingClientRect().height < 44).length, font: Math.min(...ins.map(e => parseFloat(getComputedStyle(e).fontSize))),
          buttons: [...document.querySelectorAll('.ca-editbar button')].filter(b => b.getBoundingClientRect().height < 44).length };
      });
      if (process.env.CA_SHOTS) await s.page.screenshot({ path: path.join(process.env.CA_SHOTS, `edit-${vp.width}.png`), fullPage: vp.width < 768 });
      if (em.n !== 12 || em.roam) failures.push(`${label}: expected 12 editable fields and no Roam field (${JSON.stringify(em)})`);
      if (em.sw > em.W) failures.push(`${label}: the edit form scrolls sideways`);
      if (vp.width < 768 && (em.small || em.font < 16 || em.buttons)) failures.push(`${label}: phone edit form: ${JSON.stringify(em)}`);
      await s.page.fill('#caIn_email', 'changed@example.invalid');
      await s.page.click('.ca-save');
      await s.page.waitForFunction(() => !document.querySelector('#caIn_email'), null, { timeout: 5000 }).catch(() => failures.push(`${label}: a successful save did not close the form`));
      const sent = s.edits[0];
      const want = { action: 'update_client_profile', slug: 'fixture1', member_id: 'qa_admin', expected_updated_at: '2026-09-25T06:00:00Z', changes: { email: 'changed@example.invalid' } };
      if (!sent || sent.key !== 'qa-admin-key' || JSON.stringify(sent.body, Object.keys(want).concat(['email']).sort()) !== JSON.stringify(want, Object.keys(want).concat(['email']).sort())) failures.push(`${label}: the save request was ${JSON.stringify(sent)}`);
      const shown = await s.page.evaluate(() => ({ email: /changed@example\.invalid/.test(document.querySelector('.ca-detail').innerText), pill: /Edited in SyncView/.test(document.querySelector('.ca-detail').innerText) }));
      if (!shown.email || !shown.pill) failures.push(`${label}: the saved values are not shown (${JSON.stringify(shown)})`);
      // The sheet changed underneath: nothing saved, fields named, a way to load them.
      s.ctl.edit = 'conflict';
      await s.page.click('.ca-edit-btn');
      await s.page.fill('#caIn_tiktok_handle', '@new-tiktok');
      await s.page.click('.ca-save');
      await s.page.waitForSelector('.ca-msg.is-error', { timeout: 5000 }).catch(() => failures.push(`${label}: a sheet conflict was silent`));
      const conflict = await s.page.evaluate(() => ({ msg: (document.querySelector('.ca-msg') || {}).innerText || '', flagged: !!document.querySelector('#caIn_instagram_handle.is-conflict'), kept: (document.querySelector('#caIn_tiktok_handle') || {}).value }));
      if (!/Instagram/.test(conflict.msg) || !conflict.flagged || conflict.kept !== '@new-tiktok') failures.push(`${label}: conflict handling: ${JSON.stringify(conflict)}`);
      await s.page.click('.ca-msg .cc-btn');
      await s.page.waitForFunction(() => /Loaded the latest values/.test((document.querySelector('.ca-msg') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => failures.push(`${label}: loading the sheet's values failed`));
      const refreshed = await s.page.evaluate(() => ({ ig: document.querySelector('#caIn_instagram_handle').value, tt: document.querySelector('#caIn_tiktok_handle').value }));
      if (refreshed.ig !== '@from-sheet' || refreshed.tt !== '@new-tiktok') failures.push(`${label}: after loading the sheet: ${JSON.stringify(refreshed)}`);
      if (s.edits.length !== 3 || s.edits[2].body.action !== 'refresh_from_sheet') failures.push(`${label}: expected save, save, refresh; got ${s.edits.map(e => e.body.action).join(',')}`);
      // The sheet is not shared yet: the page asks for the account to share with.
      s.ctl.edit = 'unshared';
      await s.page.click('.ca-save');
      await s.page.waitForFunction(() => /robot@fixture\.iam\.example\.invalid/.test((document.querySelector('.ca-msg') || {}).innerText || ''), null, { timeout: 5000 })
        .catch(() => failures.push(`${label}: an unshared sheet did not show the service account to share with`));
      if (s.edits.length !== 5 || s.edits[4].body.action !== 'status' || s.edits[4].key !== 'qa-admin-key') failures.push(`${label}: expected a status call with the admin key after the refusal; got ${s.edits.map(e => e.body.action).join(',')}`);
      s.ctl.edit = 'ok';
      s.page.once('dialog', d => d.accept());
      await s.page.click('.ca-editbar .cc-btn:not(.primary)');
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
      if (s.edits.length) failures.push(`${role}: a non-admin session called client-profile-write`);
      if (await s.page.$('.ca-row')) failures.push(`${role}: a non-admin session rendered the client list`);
      console.log(`ok   ${role} is kept out`);
      await s.ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error('\n' + failures.join('\n')); process.exit(1); }
  console.log('\nclients-admin-browser: OK (admin desktop + two phones, edit + sheet conflict, smm and creative kept out)');
})().catch(e => { console.error(e); process.exit(2); });
