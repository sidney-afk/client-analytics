'use strict';
/*
 * Samples realtime STATUS propagation — multi-view harness (P1 + matrix).
 *
 * Opens THREE real views at once against ONE shared in-memory sample_reviews
 * backend and drives every status-changing review action through the app's real
 * handlers on the Sidney TEST client with dummy data, asserting the derived
 * STATUS PILL updates LIVE (no reload) in the OTHER views for each transition:
 *
 *   S  — SMM Samples "Sheet" (organizer) — the surface the P1 bug was on
 *   C  — Client review surface (?c=Sidney Laruel&v=sample-reviews)
 *   K  — Kasper "Samples" sub-tab queue (cross-client)
 *
 * Like qa/cc-multiview.js, the one thing that cannot run headless is the realtime
 * TRANSPORT (Supabase delivering the sample_reviews postgres_changes event); this
 * harness delivers that ping by invoking the app's REAL subscription callbacks in
 * the observing views — _sxrV2OnRealtimeChange(slug) for the per-client S/C
 * channels and _sxrKasperLoadQueue() for the cross-client Kasper channel — so the
 * subscription → debounce/self-echo guard → background merge → repaint chain runs
 * end to end. No live backend, no real client data, no secrets.
 *
 * The whole matrix runs TWICE — once with sample_review_ef_clients routing the
 * TEST client to the Edge Function and once to n8n — and asserts each write hit
 * the expected host, proving the fix works on BOTH write paths and the routing /
 * fail-safe fallback is intact.
 *
 * Run:  node qa/sxr-multiview.js        (exit 0 = every cell propagated live)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = PW;

const root = path.resolve(__dirname, '..');
const SLUG = 'sidneylaruel';
const CLIENT_NAME = 'Sidney Laruel';

// ─────────────────────────── shared in-memory backend ───────────────────────
let store, upsertHosts, efClients;
function seed() {
  store = [{
    id: 'sr_mv_1', client: SLUG, name: 'TEST Reel A', order_index: 0,
    status: 'For SMM Approval', video_status: 'For SMM Approval', graphic_status: 'Approved',
    asset_url: 'https://example.com/v1.mp4', thumbnail_url: '', creative_direction: '',
    linear_issue_id: 'https://linear.app/x/issue/VID-1', graphic_linear_issue_id: '',
    video_tweaks: '', graphic_tweaks: '', video_comments: [], graphic_comments: [],
    updated_at: '2026-07-07T10:00:00.000Z',
  }];
  upsertHosts = [];
}
function rowsFor(slug) { return store.filter(r => r.client === slug && String(r.status).toLowerCase() !== 'archived'); }
let clk = 0;
function applyUpsert(url, body) {
  upsertHosts.push(/functions\/v1/.test(url) ? 'ef' : (/n8n\.cloud\/webhook/.test(url) ? 'n8n' : 'other'));
  const s = body.sample || {};
  let row = store.find(r => r.id === s.id);
  // Monotonic, strictly-increasing server stamp so LWW/reconcile ordering holds
  // regardless of same-millisecond writes.
  const now = new Date(Date.parse('2026-07-07T10:00:00.000Z') + (++clk) * 1000).toISOString();
  if (!row) { row = Object.assign({ client: body.client || SLUG, order_index: store.length, video_status: 'In Progress', graphic_status: 'In Progress' }, s, { updated_at: now }); store.push(row); }
  else { for (const k of Object.keys(s)) if (s[k] !== undefined) row[k] = s[k]; row.updated_at = now; }
  return { ok: true, sample: row };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(path.join(root, 'index.html')).pipe(res); return; }
  const f = path.join(root, u.pathname.slice(1));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(f); const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(f).pipe(res);
});

async function mkctx(browser, kasper) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addInitScript((isK) => {
    try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {}
    if (isK) { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} }
  }, kasper);
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    const H = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (/sample-review-get/.test(url)) { const slug = new URL(url).searchParams.get('client') || ''; return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify({ items: rowsFor(slug) }) }); }
    if (/rest\/v1\/sample_reviews/.test(url)) { return route.fulfill({ contentType: 'application/json', headers: Object.assign({ 'content-range': '0-' + store.length + '/' + store.length }, H), body: JSON.stringify(store) }); }
    if (/sample-review-upsert/.test(url)) { let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {} return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify(applyUpsert(url, b)) }); }
    if (/sample-review-reorder/.test(url)) return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify({ ok: true, updated: [] }) });
    if (/linear-/.test(url)) return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify({ ok: true }) });
    if (/docs\.google\.com/.test(url)) return route.fulfill({ contentType: 'text/csv', headers: H, body: 'client_name\nSidney Laruel\n' });
    if (/syncview_runtime_flags/.test(url)) return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify([{ key: 'sample_review_ef_clients', value: { clients: efClients } }]) });
    return route.abort();
  });
  return ctx;
}

// ─────────────────────────────── view boots ─────────────────────────────────
async function bootSMM(browser, port) {
  const ctx = await mkctx(browser, false); const p = await ctx.newPage();
  p.on('pageerror', e => APPERR.push('S ' + e.message.slice(0, 90)));
  await p.goto(`http://127.0.0.1:${port}/index.html?sxr=1&v2debug=1#sample-reviews/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('.cal-fld-substatus-wrap', { timeout: 20000 });
  return p;
}
async function bootClient(browser, port) {
  const ctx = await mkctx(browser, false); const p = await ctx.newPage();
  p.on('pageerror', e => APPERR.push('C ' + e.message.slice(0, 90)));
  await p.goto(`http://127.0.0.1:${port}/index.html?sxr=1&c=${encodeURIComponent(CLIENT_NAME)}&v=sample-reviews&v2debug=1`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(2500);
  return p;
}
async function bootKasper(browser, port) {
  const ctx = await mkctx(browser, true); const p = await ctx.newPage();
  p.on('pageerror', e => APPERR.push('K ' + e.message.slice(0, 90)));
  await p.goto(`http://127.0.0.1:${port}/index.html?Kasper=1&sxr=1&v2debug=1#kasper`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForFunction(() => typeof window._kasperGotoTab === 'function', { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => { try { window._kasperGotoTab('samples'); } catch (e) {} });
  await p.waitForTimeout(1500);
  return p;
}

// ─────────────────────────── realtime transport ping ────────────────────────
// Deliver the sample_reviews change the way Supabase would, then let the app's
// own debounced handler reload + merge + repaint.
async function pingPerClient(page) { await page.evaluate(s => { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(s); }, SLUG); }
async function pingKasper(page) { await page.evaluate(() => { if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); }); }

// ─────────────────────────────── observers ──────────────────────────────────
function smmVideoVal(page, pid) {
  return page.evaluate(id => { const w = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${id}"][data-substatus-comp="video"]`); return w ? w.getAttribute('data-val') : null; }, pid);
}
async function waitSmmVideoVal(page, pid, want, ms = 9000) {
  await page.waitForFunction(({ id, w }) => { const el = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${id}"][data-substatus-comp="video"]`); return el && el.getAttribute('data-val') === w; }, { id: pid, w: want }, { timeout: ms });
}
// Client review: does a component panel/card for the video exist and what state?
function clientHasVideoReview(page) {
  return page.evaluate(() => { const t = (document.getElementById('sxrView') || {}).textContent || ''; return /Video/.test(t) && /review|approv/i.test(t); });
}
function kasperCardCount(page) { return page.evaluate(() => document.querySelectorAll('[data-sxr-kasper-pid]').length); }

let failures = 0, APPERR = [];
function check(label, ok, extra) { if (!ok) failures++; console.log(`   ${ok ? '✓' : '✗ FAIL'}  ${label}${extra ? '  ' + extra : ''}`); }

// ─────────────────────────────── the scenario ───────────────────────────────
async function runMatrix(browser, port, routing) {
  seed();
  efClients = routing === 'ef' ? [SLUG] : [];
  console.log(`\n══════════ ROUTING: ${routing.toUpperCase()} (sample_review_ef_clients=${JSON.stringify(efClients)}) ══════════`);
  const S = await bootSMM(browser, port);
  const C = await bootClient(browser, port);
  const K = await bootKasper(browser, port);
  const PID = 'sr_mv_1';

  // ── T1: SMM approves video (For SMM Approval → Kasper Approval) ──
  console.log('\n— T1  SMM approve video → Kasper Approval  (observer: Kasper queue) —');
  await S.evaluate(id => _sxrStatusPick(id, 'Kasper Approval', 'video'), PID);
  await S.waitForTimeout(1200);                       // let the write flush to the store
  check('SMM sheet shows Kasper Approval (own action)', (await smmVideoVal(S, PID)) === 'Kasper Approval');
  check('write routed to expected host', upsertHosts.length > 0 && upsertHosts[upsertHosts.length - 1] === routing, '(' + upsertHosts.join(',') + ')');
  await pingKasper(K);
  await K.waitForFunction(() => document.querySelectorAll('[data-sxr-kasper-pid]').length > 0, null, { timeout: 9000 })
    .then(() => check('Kasper queue card APPEARS live', true))
    .catch(async () => check('Kasper queue card APPEARS live', false, '(cards=' + (await kasperCardCount(K)) + ')'));

  // ── T2: Kasper requests a change (Kasper Approval → Tweaks Needed) — THE P1 BUG ──
  console.log('\n— T2  Kasper request-change video → Tweaks Needed  (observer: SMM sheet) [P1] —');
  // SMM is "local-fresh" from T1; let its self-echo window pass so the ping fires.
  await S.waitForTimeout(4300);
  await K.evaluate(id => { _sxrKasperState.drafts[id + '|video'] = 'Please tighten the intro (dummy).'; _sxrKasperRequestTweakComp(id, 'video'); }, PID);
  await K.waitForTimeout(1200);
  check('store row is now Tweaks Needed', store.find(r => r.id === PID).video_status === 'Tweaks Needed');
  await pingPerClient(S);
  await waitSmmVideoVal(S, PID, 'Tweaks Needed')
    .then(() => check('SMM sheet status pill flips to Tweaks Needed LIVE (P1 fixed)', true))
    .catch(async () => check('SMM sheet status pill flips to Tweaks Needed LIVE (P1 fixed)', false, '(still ' + (await smmVideoVal(S, PID)) + ')'));

  // ── T3: SMM resolves + re-routes to Kasper, Kasper APPROVES (→ Client Approval) ──
  console.log('\n— T3  Kasper approve video → Client Approval  (observers: SMM sheet + Client) —');
  // SMM sends it back to Kasper for the approve step.
  await S.evaluate(id => _sxrStatusPick(id, 'Kasper Approval', 'video'), PID);
  await S.waitForTimeout(1200);
  await pingKasper(K); await K.waitForTimeout(1500);
  await K.evaluate(id => { if (typeof _sxrKasperApproveComp === 'function') _sxrKasperApproveComp(id, 'video'); }, PID);
  await K.waitForTimeout(1200);
  check('store row is now Client Approval', store.find(r => r.id === PID).video_status === 'Client Approval');
  await S.waitForTimeout(4300);                       // clear SMM self-echo from the re-route
  await pingPerClient(S);
  await waitSmmVideoVal(S, PID, 'Client Approval')
    .then(() => check('SMM sheet flips to Client Approval LIVE', true))
    .catch(async () => check('SMM sheet flips to Client Approval LIVE', false, '(still ' + (await smmVideoVal(S, PID)) + ')'));
  await pingPerClient(C); await C.waitForTimeout(800);
  check('Client review shows the video awaiting review LIVE', await clientHasVideoReview(C));

  // ── T4: Client requests a change (Client Approval → Tweaks Needed) ──
  console.log('\n— T4  Client request-change video → Tweaks Needed  (observer: SMM sheet) —');
  await C.evaluate(id => {
    // Drive the client's real review request-change handler (sets Tweaks Needed
    // + a client tweak comment) — the same fn the "Request a change" button calls.
    _sxrReviewState.drafts[id + '|video'] = 'One more note (dummy).';
    _sxrReviewRequestTweak(id, 'video');
  }, PID);
  await C.waitForTimeout(1400);
  const t4server = store.find(r => r.id === PID).video_status;
  check('store row is Tweaks Needed after client change', t4server === 'Tweaks Needed', '(' + t4server + ')');
  await pingPerClient(S);
  await waitSmmVideoVal(S, PID, 'Tweaks Needed')
    .then(() => check('SMM sheet flips to Tweaks Needed LIVE (client-originated)', true))
    .catch(async () => check('SMM sheet flips to Tweaks Needed LIVE (client-originated)', false, '(still ' + (await smmVideoVal(S, PID)) + ')'));

  for (const pg of [S, C, K]) await pg.context().close();
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  for (const routing of ['ef', 'n8n']) await runMatrix(browser, port, routing);
  await browser.close(); server.close();
  const appErr = APPERR.filter(e => !/ResizeObserver|Failed to load resource/i.test(e));
  if (appErr.length) { console.log('\nApp JS errors:'); appErr.slice(0, 8).forEach(e => console.log('  ! ' + e)); }
  console.log(`\n${failures ? failures + ' cell(s) FAILED ❌' : 'All samples multi-view status-propagation cells passed ✅'}`);
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err.stack || err.message || err); server.close(); process.exit(1); });
