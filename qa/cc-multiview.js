'use strict';
/*
 * Credentials multi-view realtime propagation test (Workstream 4).
 *
 * Opens THREE views at once against ONE shared in-memory credentials backend and
 * drives every Credentials interaction through the real UI with obviously-fake
 * dummy values (TESTPASS-…) on the Sidney TEST client:
 *
 *   K  — Kasper "Client Credentials" subtab list
 *   M  — SMM per-client modal for Sidney (the calendar "Client credentials" item)
 *   O  — Owner (Sidney) second Kasper session
 *
 * For each of add / edit / archive it performs the action in one view and
 * asserts the OTHER two update LIVE with no manual refresh, plus reveal/hide and
 * view-history (device-local by design). The one piece that cannot run headless
 * without live Supabase is the realtime TRANSPORT (Supabase delivering the
 * client_credentials_rev postgres_changes event); the shared backend bumps a rev
 * on every write and this harness delivers that ping by invoking the real
 * _ccRevChanged() handler in the other views — exactly the callback Supabase
 * wires to the subscription — so the subscription→reload→re-render chain is
 * exercised end to end. No live backend, no staff passphrase, no real secrets.
 *
 * Run:  node qa/cc-multiview.js   (exit 0 = all cells pass)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

// ---- shared in-memory backend (mirrors the client-credentials Edge Function) ----
let store = [
  { id: 'd1', client_slug: 'sidneylaruel', client_name: 'Sidney Laruel', platform: 'instagram', label: '', handle: '@sidney_test', password: 'TESTPASS-1111', notes: '2FA in test vault', status: 'active', source: 'manual', updated_at: '2026-07-06T10:00:00Z', updated_by: 'Kasper Hytonen' },
  { id: 'd2', client_slug: 'sidneylaruel', client_name: 'Sidney Laruel', platform: 'tiktok', label: '', handle: '@sidney_test_tt', password: 'TESTPASS-2222', notes: '', status: 'active', source: 'manual', updated_at: '2026-07-06T11:00:00Z', updated_by: 'Kasper Hytonen' },
];
let seq = 100;
const rev = {};
const events = [];
function bump(slug) { rev[slug] = (rev[slug] || 0) + 1; }
function activeFor(slug) { return store.filter(r => r.status !== 'archived' && (!slug || r.client_slug === slug)); }
const DBG = process.env.CC_DBG === '1';
function handleCc(body) {
  const a = body.action;
  if (a === 'list') { const slug = (body.client_slug || '').trim() || null; const out = activeFor(slug); if (DBG) console.error('[list]', slug, '->', out.map(r => r.platform + ':' + r.handle).join(',')); return { ok: true, credentials: out }; }
  if (a === 'history') return { ok: true, events: events.filter(e => !body.credential_id || e.credential_id === body.credential_id).slice().reverse() };
  if (a === 'log_reveal') { events.push({ credential_id: body.credential_id, action: 'reveal', actor: (body.actor && body.actor.name) || '?', actor_role: (body.actor && body.actor.role) || 'staff', event_at: new Date().toISOString() }); return { ok: true }; }
  if (a === 'upsert') {
    const c = body.credential || {};
    let row = store.find(r => r.id && r.id === c.id) ||
              store.find(r => r.status !== 'archived' && r.client_slug === c.client_slug && r.platform === c.platform && (r.label || '') === (c.label || ''));
    if (row) { const keepId = row.id; Object.assign(row, c, { id: keepId, status: c.status || 'active', updated_at: new Date().toISOString(), updated_by: (body.actor && body.actor.name) || 'staff' }); }
    else { row = Object.assign({ source: 'manual' }, c, { id: 'n' + (++seq), status: c.status || 'active', updated_at: new Date().toISOString(), updated_by: (body.actor && body.actor.name) || 'staff' }); store.push(row); }
    events.push({ credential_id: row.id, action: 'update', actor: (body.actor && body.actor.name) || '?', actor_role: (body.actor && body.actor.role) || 'staff', event_at: new Date().toISOString() });
    bump(row.client_slug);
    return { ok: true, credential: row };
  }
  if (a === 'delete') {
    const row = store.find(r => r.id === (body.credential_id || body.id));
    if (DBG) console.error('[delete]', body.credential_id || body.id, '->', row ? row.platform + ':' + row.handle : 'NOT FOUND');
    if (!row) return { ok: false, error: 'not found' };
    row.status = 'archived'; row.updated_at = new Date().toISOString();
    events.push({ credential_id: row.id, action: 'delete', actor: (body.actor && body.actor.name) || '?', actor_role: (body.actor && body.actor.role) || 'staff', event_at: new Date().toISOString() });
    bump(row.client_slug);
    return { ok: true, credential: row };
  }
  return { ok: false, error: 'unknown action ' + a };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(path.join(root, 'index.html')).pipe(res); return; }
  const f = path.join(root, u.pathname.slice(1));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(f); const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(f).pipe(res);
});

let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}${extra ? '  ' + extra : ''}`); }

async function newView(browser, port, kind) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));   // accept the archive confirm()
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  await page.route('**/functions/v1/client-credentials', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(handleCc(body)) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    localStorage.setItem('syncview_client_credentials_identity_v1', JSON.stringify({ name: 'Tester', role: 'Kasper', key: 'dummy-key' }));
    sessionStorage.setItem('syncview_kasper_unlocked', 'ok');
    window.confirm = () => true;   // auto-accept the archive confirm() in this harness
  });
  await page.goto(`http://127.0.0.1:${port}/?Kasper=1#kasper/client-credentials`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cc-wrap', { timeout: 20000 });
  await page.waitForSelector('.cc-card', { timeout: 20000 });
  if (kind === 'modal') {
    await page.evaluate(() => { window.calState = window.calState || {}; calState.client = 'Sidney Laruel'; _ccOpenModal('Sidney Laruel'); });
    await page.locator('#ccModalBody .cc-row').first().waitFor({ timeout: 10000 });
  }
  return page;
}

// Deliver the realtime rev ping the way Supabase would, then let the debounced
// handler reload + re-render. (Sidney is the only client we touch.)
async function ping(page, scope) { await page.evaluate(s => { if (typeof _ccRevChanged === 'function') _ccRevChanged(s); }, scope); }
function rowsOf(page, kind) {
  const scope = kind === 'modal' ? '#ccModalBody' : '#ccKasperBody';
  return page.evaluate(sel => Array.from(document.querySelectorAll(sel + ' .cc-row')).map(r => (r.querySelector('.cc-handle code') || {}).textContent || ''), scope);
}
async function waitForHandle(page, kind, handle, present) {
  const scope = kind === 'modal' ? '#ccModalBody' : '#ccKasperBody';
  await page.waitForFunction(({ sel, h, want }) => {
    const has = Array.from(document.querySelectorAll(sel + ' .cc-row .cc-handle code')).some(c => (c.textContent || '').includes(h));
    return has === want;
  }, { sel: scope, h: handle, want: present }, { timeout: 8000 });
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const K = await newView(browser, port, 'kasper');
  const O = await newView(browser, port, 'kasper');
  const M = await newView(browser, port, 'modal');
  // Expand Sidney in the list views so new/edited rows are visible.
  for (const p of [K, O]) { const t = p.getByRole('button', { name: /Expand or collapse Sidney Laruel/ }); if (await t.count()) await t.first().click(); }

  console.log('\n— ADD (actor: Kasper list K) → propagates to SMM modal M + Owner O —');
  // Drive the real Add form on Sidney's card: platform youtube, dummy handle/password.
  await K.locator('.cc-card', { hasText: 'Sidney Laruel' }).locator('button', { hasText: 'Add' }).first().click();
  await K.locator('#ccEditHandle').waitFor({ timeout: 8000 });
  await K.locator('#ccEditPlatformBtn').click();
  await K.locator('#ccEditPlatformMenu .cc-select-option', { hasText: 'youtube' }).click();
  await K.locator('#ccEditHandle').fill('@sidney_yt');
  await K.locator('#ccEditPassword').fill('TESTPASS-9999');
  await K.locator('#ccEditSave').click();
  await waitForHandle(K, 'kasper', '@sidney_yt', true);   // actor updates itself
  check('ADD → Kasper actor shows new youtube row', true);
  await ping(M, 'modal'); await ping(O, 'kasper');
  await waitForHandle(M, 'modal', '@sidney_yt', true).then(() => check('ADD → SMM modal M updated live', true)).catch(() => check('ADD → SMM modal M updated live', false));
  await waitForHandle(O, 'kasper', '@sidney_yt', true).then(() => check('ADD → Owner O updated live', true)).catch(() => check('ADD → Owner O updated live', false));

  console.log('\n— EDIT (actor: Owner O) → propagates to K + M —');
  // Edit a stable seed row (the TikTok handle) in O.
  const oRow = O.locator('#ccKasperBody .cc-row', { hasText: '@sidney_test_tt' });
  await oRow.locator('button[aria-label="Edit"]').click();
  await O.locator('#ccEditHandle').waitFor({ timeout: 8000 });
  await O.locator('#ccEditHandle').fill('@sidney_tt_edited');
  await O.locator('#ccEditSave').click();
  await waitForHandle(O, 'kasper', '@sidney_tt_edited', true);
  check('EDIT → Owner actor shows edited handle', true);
  await ping(K, 'kasper'); await ping(M, 'modal');
  await waitForHandle(K, 'kasper', '@sidney_tt_edited', true).then(() => check('EDIT → Kasper K updated live', true)).catch(() => check('EDIT → Kasper K updated live', false));
  await waitForHandle(M, 'modal', '@sidney_tt_edited', true).then(() => check('EDIT → SMM modal M updated live', true)).catch(() => check('EDIT → SMM modal M updated live', false));

  console.log('\n— ARCHIVE (actor: SMM modal M) → propagates to K + O —');
  const mRow = M.locator('#ccModalBody .cc-row', { hasText: '@sidney_yt' });
  await mRow.locator('button[aria-label="Archive"]').click();
  await waitForHandle(M, 'modal', '@sidney_yt', false);
  check('ARCHIVE → SMM actor drops the row', true);
  await ping(K, 'kasper'); await ping(O, 'kasper');
  await waitForHandle(K, 'kasper', '@sidney_yt', false).then(() => check('ARCHIVE → Kasper K dropped row live', true)).catch(() => check('ARCHIVE → Kasper K dropped row live', false));
  await waitForHandle(O, 'kasper', '@sidney_yt', false).then(() => check('ARCHIVE → Owner O dropped row live', true)).catch(() => check('ARCHIVE → Owner O dropped row live', false));

  console.log('\n— REVEAL / HIDE (device-local by design; only the audit event is server-side) —');
  const kInsta = K.locator('#ccKasperBody .cc-row', { hasText: '@sidney_test' });
  await kInsta.locator('button[aria-label="Reveal password"]').click();
  await K.waitForFunction(() => Array.from(document.querySelectorAll('#ccKasperBody .cc-secret code')).some(c => c.textContent === 'TESTPASS-1111'), null, { timeout: 5000 });
  check('REVEAL → shows the password instantly in K', true);
  // Reveal must NOT leak to another device: O still masked.
  const oMasked = await O.evaluate(() => { const r = Array.from(document.querySelectorAll('#ccKasperBody .cc-row')).find(x => (x.querySelector('.cc-handle code') || {}).textContent === '@sidney_test'); return r ? (r.querySelector('.cc-secret code') || {}).textContent : null; });
  check('REVEAL → does NOT leak to Owner O (still masked)', oMasked === '••••••', 'got ' + JSON.stringify(oMasked));
  await kInsta.locator('button[aria-label="Hide password"]').click();
  await K.waitForFunction(() => Array.from(document.querySelectorAll('#ccKasperBody .cc-secret code')).some(c => c.textContent === '••••••'), null, { timeout: 5000 });
  check('HIDE → re-masks in K', true);

  console.log('\n— VIEW HISTORY (reads the audit log; opens for all roles) —');
  await K.locator('#ccKasperBody .cc-row', { hasText: '@sidney_test' }).locator('button[aria-label="History"]').click();
  await K.locator('#ccHistBody').waitFor({ timeout: 8000 });
  await K.waitForFunction(() => { const b = document.getElementById('ccHistBody'); return b && !/Loading history/i.test(b.textContent); }, null, { timeout: 8000 });
  const histText = await K.locator('#ccHistBody').innerText();
  check('HISTORY → modal opens with audited events', /reveal|update|delete/i.test(histText), '"' + histText.slice(0, 40).replace(/\n/g, ' ') + '"');

  await browser.close();
  server.close();
  console.log(`\n${failures ? failures + ' cell(s) FAILED ❌' : 'All multi-view propagation cells passed ✅'}`);
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err.stack || err.message || err); server.close(); process.exit(1); });
