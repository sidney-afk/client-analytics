// ============================================================================
// qa/ef-writepath/lib.js — REAL-browser harness for validating the Supabase
// Edge-Function (EF) write path end-to-end on the TEST client `sidneylaruel`.
//
// WHY a courier: this sandbox's egress proxy refuses to relay the BROWSER's
// traffic, but Node/curl -> proxy -> backend works. So we run the REAL index.html
// in a REAL headless Chromium and intercept the page's backend HTTP calls,
// performing each in Node via curl and fulfilling the live response back into the
// page. The browser believes it talks to the live backend; Node is the courier.
// (Same mechanism as qa/sxr_courier_lib.js — see its header.)
//
// DIFFERENCE vs the stock courier: the stock courier MOCKS every Linear webhook
// so a probe can never mutate a real editor's issue. This harness instead
// FORWARDS Linear status/comment pushes to LIVE n8n — but ONLY when the payload's
// issue URL matches an explicit allowlist of the TEST client's OWN test issues
// (VID-12612 / GRA-6310 / …). Any push to a non-allowlisted issue is MOCKED and
// logged LOUDLY. This lets us verify the real FE->n8n->Linear round-trip on the
// test client's own issues (then revert them) while making it impossible to touch
// any other issue. Every Linear call is recorded regardless.
//
// SAFETY: only ever drive the `sidneylaruel` test client. Reads/writes for any
// other client are neither performed nor expected. The realtime WebSocket cannot
// be tunneled (courier limitation) — cross-view LIVE propagation is exercised via
// the app's own realtime callback (_calV2OnRealtimeChange / _sxrV2OnRealtimeChange)
// which triggers the same REST refetch + pill re-render a real push would.
// ============================================================================
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }

// In-process static server (a detached Bash server gets killed by the sandbox, so
// we serve index.html + assets from inside the Node harness). Sets the
// dynamic origin used by the surface openers.
const ROOT = path.resolve(__dirname, '..', '..');
let _origin = 'http://127.0.0.1:8000';
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let u; try { u = new URL(req.url, 'http://127.0.0.1'); } catch (e) { res.writeHead(400); res.end('bad'); return; }
      let p = decodeURIComponent(u.pathname);
      if (p === '/' ) p = '/index.html';
      const f = path.join(ROOT, p.slice(1));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      const ext = path.extname(f);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(f).pipe(res);
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { _origin = 'http://127.0.0.1:' + srv.address().port; resolve({ server: srv, port: srv.address().port, origin: _origin }); });
  });
}

const ORIGIN = 'http://localhost:8000';
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const N8N = 'https://synchrosocial.app.n8n.cloud/webhook';

// EF vs n8n write endpoints (for routing classification).
const CAL_EF = SUPA + '/functions/v1/calendar-upsert';
const CAL_N8N = N8N + '/calendar-upsert-post';
const CAL_REORDER_EF = SUPA + '/functions/v1/calendar-reorder';
const CAL_REORDER_N8N_BATCH = N8N + '/calendar-reorder-batch';
const CAL_REORDER_N8N = N8N + '/calendar-reorder';
const SXR_EF = SUPA + '/functions/v1/sample-review-upsert';
const SXR_N8N = N8N + '/sample-review-upsert';
const SXR_REORDER_EF = SUPA + '/functions/v1/sample-review-reorder';
const SXR_REORDER_N8N = N8N + '/sample-review-reorder';
const LINEAR_HOOK = /\/webhook\/(linear-set-status|linear-add-comment|linear-subissues|linear-issue-statuses)\b/;
const EXT = /(supabase\.co|synchrosocial\.app\.n8n\.cloud|cdn\.jsdelivr\.net|docs\.google\.com|drive\.google\.com|googleusercontent\.com|ytimg\.com|youtube\.com|ggpht\.com|vimeocdn\.com|frame\.io|placeholder\.com|imgur\.com)/;

const TMP = process.env.EFWP_TMP || '/tmp/qa-efwp';
try { fs.mkdirSync(TMP, { recursive: true }); } catch {}

let _seq = 0;
function _q(a) { return `'${String(a).replace(/'/g, "'\\''")}'`; }
const _exec = (cmd, extra) => execSync(cmd, Object.assign({ encoding: 'utf8', timeout: 60000 }, extra || {}));

// ---- Linear FORWARD allowlist (issue identifiers the test client owns) -------
// A push is forwarded to LIVE n8n only if its payload.issue contains one of these
// tokens; otherwise it is mocked ({ok:true}) and logged as BLOCKED. Empty = mock
// everything (the safe default).
let _linearAllow = [];
function setLinearForwardAllow(ids) { _linearAllow = (ids || []).map(String); }
function _issueAllowed(url) { const u = String(url || ''); return _linearAllow.some(id => u.includes(id)); }

// Fail-safe test aid: when on, n8n WRITE endpoints (…-n8n kinds) are recorded but
// NOT forwarded — mocked with {ok:true} — so the fallback route can be OBSERVED
// (routing proven by captured URL) without a real n8n/Sheet write landing.
let _blockN8nWrites = false;
function setBlockN8nWrites(v) { _blockN8nWrites = !!v; }

// ---- Node-side network (through the egress proxy) ---------------------------
function _courierFetch(method, url, headers, postData) {
  const bodyFile = `${TMP}/_resp_${process.pid}_${++_seq}.bin`;
  const args = ['-s', '-L', '-D', '-', '-o', bodyFile, '-X', method];
  for (const [k, v] of Object.entries(headers || {})) {
    if (/^(host|origin|referer|connection|content-length|accept-encoding)$/i.test(k)) continue;
    args.push('-H', `${k}: ${v}`);
  }
  if (postData) { const pf = `${TMP}/_pd_${process.pid}_${_seq}.bin`; fs.writeFileSync(pf, postData); args.push('--data-binary', '@' + pf); }
  args.push(url);
  let head = '';
  try { head = _exec('curl ' + args.map(_q).join(' '), { maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return { status: 502, ctype: 'text/plain', body: Buffer.from('courier-failed: ' + (e.message || '')) }; }
  const re = /HTTP\/[\d.]+\s+(\d{3})\b/g; let _m, _last = null;
  while ((_m = re.exec(head)) !== null) _last = _m[1];
  const status = _last ? parseInt(_last, 10) : 200;
  const ct = (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1];
  const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile) : Buffer.from('');
  return { status, ctype: (ct || 'application/json').trim(), body };
}

// Read helpers (Supabase REST via Node/proxy).
function _supaGet(table, qs) {
  const out = _exec(`curl -s ${_q(SUPA + '/rest/v1/' + table + '?' + qs)} -H ${_q('apikey: ' + KEY)} -H ${_q('Authorization: Bearer ' + KEY)}`, { maxBuffer: 32 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { return []; }
}
const supaCal = (qs) => _supaGet('calendar_posts', qs);
const supaSample = (qs) => _supaGet('sample_reviews', qs);
const supaCalEvents = (qs) => _supaGet('calendar_post_events', qs);
const supaSampleEvents = (qs) => _supaGet('sample_review_events', qs);
function calRow(pid, sel = '*') { const r = supaCal(`id=eq.${encodeURIComponent(pid)}&client=eq.sidneylaruel&select=${sel}`); return (Array.isArray(r) && r[0]) || {}; }
function sampleRow(pid, sel = '*') { const r = supaSample(`id=eq.${encodeURIComponent(pid)}&client=eq.sidneylaruel&select=${sel}`); return (Array.isArray(r) && r[0]) || {}; }
async function pollCal(pid, pred, sel = '*', ms = 20000, step = 800) {
  const t = Date.now(); let r;
  while (Date.now() - t < ms) { r = calRow(pid, sel); if (pred(r)) return r; await new Promise(x => setTimeout(x, step)); } return r;
}
async function pollSample(pid, pred, sel = '*', ms = 20000, step = 800) {
  const t = Date.now(); let r;
  while (Date.now() - t < ms) { r = sampleRow(pid, sel); if (pred(r)) return r; await new Promise(x => setTimeout(x, step)); } return r;
}
// Direct writes via a chosen endpoint (used for setup/teardown ONLY — clearly
// labeled; the LIVE tests drive the real UI). base='' keeps whole-card semantics.
function calUpN8n(post, base) {
  const f = `${TMP}/_up_${process.pid}_${++_seq}.json`;
  fs.writeFileSync(f, JSON.stringify({ client: 'sidneylaruel', post, comments_base_at: base || '' }));
  const out = _exec(`curl -s -X POST ${_q(CAL_N8N)} -H 'Content-Type: application/json' -d @${f}`);
  try { return JSON.parse(out); } catch { return { _raw: out }; }
}
function sampleUpN8n(sample, base) {
  const f = `${TMP}/_sup_${process.pid}_${++_seq}.json`;
  fs.writeFileSync(f, JSON.stringify({ client: 'sidneylaruel', sample, comments_base_at: base || '' }));
  const out = _exec(`curl -s -X POST ${_q(SXR_N8N)} -H 'Content-Type: application/json' -d @${f}`);
  try { return JSON.parse(out); } catch { return { _raw: out }; }
}

// ---- request classification -------------------------------------------------
function classify(url, method) {
  if (url.indexOf(CAL_EF) === 0) return 'cal-ef';
  if (url.indexOf(CAL_N8N) === 0) return 'cal-n8n';
  if (url.indexOf(CAL_REORDER_EF) === 0) return 'cal-reorder-ef';
  if (url.indexOf(CAL_REORDER_N8N_BATCH) === 0 || url.indexOf(CAL_REORDER_N8N) === 0) return 'cal-reorder-n8n';
  if (url.indexOf(SXR_EF) === 0) return 'sxr-ef';
  if (url.indexOf(SXR_N8N) === 0) return 'sxr-n8n';
  if (url.indexOf(SXR_REORDER_EF) === 0) return 'sxr-reorder-ef';
  if (url.indexOf(SXR_REORDER_N8N) === 0) return 'sxr-reorder-n8n';
  if (/\/functions\/v1\/(templates-save|caption-prompts-save)/.test(url)) return 'settings-ef';
  if (/\/webhook\/(templates-save|caption-prompts-save)/.test(url)) return 'settings-n8n';
  if (/linear-set-status/.test(url)) return 'linear-status';
  if (/linear-add-comment/.test(url)) return 'linear-comment';
  if (/linear-subissues|linear-issue-statuses/.test(url)) return 'linear-meta';
  if (/\/rest\/v1\//.test(url)) return 'supabase-rest';
  if (/\/functions\/v1\//.test(url)) return 'ef-other';
  if (/\/webhook\//.test(url)) return 'n8n-other';
  return 'other';
}

// ---- context + recorder -----------------------------------------------------
function makeRecorder() {
  const rec = {
    requests: [],     // { t, method, url, kind, body }
    linear: [],       // { t, path, payload, forwarded }
    log: [],          // notable events (blocked pushes etc.)
    reset() { this.requests.length = 0; this.linear.length = 0; this.log.length = 0; },
    since(ts) { return this.requests.filter(r => r.t >= ts); },
    writesSince(ts) { return this.since(ts).filter(r => r.method === 'POST' && r.kind !== 'supabase-rest' && r.kind !== 'other'); },
    kindsSince(ts) { return this.writesSince(ts).map(r => r.kind); },
    linearSince(ts) { return this.linear.filter(r => r.t >= ts); },
  };
  return rec;
}

async function makeCtx(browser, opts = {}) {
  const rec = makeRecorder();
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript((kasper) => {
    try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {}
    if (kasper) { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} }
  }, !!opts.kasper);
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS', 'cache-control': 'no-store' };
    // localhost app assets -> continue
    if (!EXT.test(url)) return route.continue();
    // record every backend request (entry mutated with status after fetch)
    let bodyStr = null; try { bodyStr = req.postData(); } catch (e) {}
    const kind = classify(url, method);
    const entry = { t: Date.now(), method, url, kind, body: bodyStr, status: null };
    if (method !== 'OPTIONS') rec.requests.push(entry);
    // CORS preflight -> answer locally
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    // write_ui_reroute_clients flag -> DARK for the harness: the TEST client
    // is the sole live allowlist member, so the real flag would put it on the
    // #850 gateway lane, which fails Linear-linkless harness cards closed
    // before the source save. Real clients run legacy; keep the stand-in
    // faithful. Only this one flag is stubbed — the Track-A rosters this
    // suite exists to exercise stay live. (Rationale: qa/probes/lib.js.)
    if (url.includes('syncview_runtime_flags') && url.includes('write_ui_reroute_clients')) {
      entry.status = 200;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '[]' });
    }
    // Speed/robustness: STUB the heavy analytics Google-Sheets (Metrics/TopVideos/
    // briefs/summaries) — they are irrelevant to the write path and otherwise
    // serialize the single-threaded curl courier behind ~1MB of CSV, stalling the
    // calendar load. The "Clients Info" sheet stays LIVE (client allowlist).
    if (/docs\.google\.com\/spreadsheets/.test(url) && !/sheet=Clients(%20|\+|\s)?Info/i.test(url)) {
      entry.status = 200;
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: CORS, body: '"stub"\n' });
    }
    // Linear webhooks: forward to LIVE only for allowlisted (test-client) issues.
    const lh = url.match(LINEAR_HOOK);
    if (lh) {
      let payload = null; try { payload = JSON.parse(bodyStr || 'null'); } catch (e) {}
      const issue = payload && (payload.issue || payload.issueUrl || payload.url) || '';
      const allow = _issueAllowed(issue);
      rec.linear.push({ t: Date.now(), path: lh[1], payload, forwarded: allow });
      if (lh[1] === 'linear-set-status' || lh[1] === 'linear-add-comment') {
        if (allow) {
          const r = _courierFetch(method, url, req.headers(), bodyStr); entry.status = r.status;
          return route.fulfill({ status: r.status, contentType: r.ctype, headers: CORS, body: r.body });
        }
        rec.log.push('[BLOCKED non-allowlisted linear push] ' + lh[1] + ' issue=' + JSON.stringify(issue));
        entry.status = 200;
        return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, _mocked: true }) });
      }
      // linear-subissues / linear-issue-statuses: tunnel to live (read-only lookups)
      const r = _courierFetch(method, url, req.headers(), bodyStr); entry.status = r.status;
      return route.fulfill({ status: r.status, contentType: r.ctype, headers: CORS, body: r.body });
    }
    // Fail-safe aid: capture + mock n8n WRITE endpoints instead of forwarding.
    if (_blockN8nWrites && method === 'POST' && /-n8n$/.test(kind)) {
      entry.status = 200; rec.log.push('[blocked n8n write] ' + kind);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, updated: 999, _mocked: true }) });
    }
    // everything else on an EXT host -> courier to LIVE
    const r = _courierFetch(method, url, req.headers(), bodyStr); entry.status = r.status;
    return route.fulfill({ status: r.status, contentType: r.ctype, headers: CORS, body: r.body });
  });
  return { ctx, rec };
}

async function launch() { return await PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] }); }

function _capture(page) {
  page._errs = [];
  page._logs = [];
  page.on('console', m => { const t = m.text(); page._logs.push('[' + m.type() + '] ' + t); if (m.type() === 'error') page._errs.push('[console.error] ' + t); });
  page.on('pageerror', e => page._errs.push('[pageerror] ' + (e && e.message)));
  page.on('dialog', d => d.accept().catch(() => {}));  // auto-accept archive/confirm dialogs
}
// App JS errors only; ignore the un-tunnelable realtime WS failure + image 503s.
function appErrs(page) {
  return (page._errs || []).filter(e =>
    /supabase|synchrosocial|sxr|_sxr|_cal|TypeError|ReferenceError|is not a function/.test(e) &&
    !/realtime\/v1\/websocket|WebSocket connection .* failed|ERR_CONNECTION_CLOSED|Failed to load resource/i.test(e));
}

async function _open(browser, urlPath, opts = {}) {
  const { ctx, rec } = await makeCtx(browser, opts);
  const page = await ctx.newPage();
  _capture(page);
  await page.goto(_origin + urlPath, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(600);
  return { page, ctx, rec };
}

// ---- surface openers --------------------------------------------------------
// The realtime WS can't be tunneled in this sandbox, so the app's subscription
// TIMES_OUT and its auto-load never fires; we deterministically trigger the app's
// OWN REST load (loadCalendarPosts) — the exact fallback path the app uses when
// realtime is unavailable — then wait for calState to populate.
// SMM: open the client tab DIRECTLY via the app's own _calOpenClientTab (the
// deep-link resolver only fires after full essentials merge, which is slow via
// the courier). Then poll calState until client + posts populate.
// NOTE: calState / loadCalendarPosts / _calOpenClientTab are `let`/`function`
// globals — reachable as BARE identifiers inside evaluate, but NOT as window.X
// (only explicitly-assigned hooks like calV2Status live on window).
async function _openCalClient(page, name = 'Sidney Laruel', ms = 45000) {
  const t = Date.now();
  await page.waitForFunction(() => typeof _calOpenClientTab === 'function' && typeof loadCalendarPosts === 'function', { timeout: 20000 }).catch(() => {});
  let last = null;
  while (Date.now() - t < ms) {
    const res = await page.evaluate(async (n) => {
      try {
        if (!(typeof calState === 'object' && calState.client)) {
          if (typeof _calOpenClientTab === 'function') _calOpenClientTab(n);
          if (!calState.client) calState.client = n;  // app sets exactly this
        }
      } catch (e) {}
      try { if (typeof calState === 'object' && calState.client && (calState.posts || []).length === 0) await loadCalendarPosts(); } catch (e) {}
      return { client: (typeof calState === 'object' && calState.client) || null, posts: (typeof calState === 'object' && (calState.posts || []).length) || 0 };
    }, name).catch(e => ({ err: String(e && e.message || e) }));
    last = res;
    if (res && res.client && res.posts > 0) return true;
    await page.waitForTimeout(1200);
  }
  page._forceLoadLast = last;
  return false;
}
// Client-link surface: no _calOpenClientTab; the client is fixed by ?c=. Trigger
// the app's own REST load and wait for posts.
async function _forceCalLoad(page, ms = 45000) {
  const t = Date.now();
  await page.waitForFunction(() => typeof loadCalendarPosts === 'function', { timeout: 20000 }).catch(() => {});
  let last = null;
  while (Date.now() - t < ms) {
    const res = await page.evaluate(async () => {
      try { if ((typeof calState === 'object' && (calState.posts || []).length) === 0) await loadCalendarPosts(); } catch (e) { return { err: String(e && e.message || e) }; }
      return { client: (typeof calState === 'object' && calState.client) || null, posts: (typeof calState === 'object' && (calState.posts || []).length) || 0 };
    }).catch(e => ({ err: String(e && e.message || e) }));
    last = res;
    if (res && res.posts > 0) return true;
    await page.waitForTimeout(1500);
  }
  page._forceLoadLast = last;
  return false;
}
async function smmCal(browser, slug = 'sidneylaruel') {
  const h = await _open(browser, `/index.html?v2debug=1#calendar/${encodeURIComponent(slug)}`);
  await h.page.waitForFunction(() => window.calV2Status && window.calV2Status().ready, { timeout: 20000 }).catch(() => {});
  await h.page.waitForTimeout(2500); // let the deep-link resolver + essentials settle
  h.loaded = await _openCalClient(h.page);
  await h.page.waitForTimeout(500);
  return h;
}
async function clientCal(browser, name = 'Sidney Laruel') {
  const h = await _open(browser, `/index.html?c=${encodeURIComponent(name)}&v=calendar&v2debug=1`);
  h.loaded = await _forceCalLoad(h.page);
  await h.page.waitForTimeout(500);
  return h;
}
async function kasperCal(browser) {
  const h = await _open(browser, `/index.html?Kasper=1&v2debug=1#kasper`, { kasper: true });
  await h.page.waitForFunction(() => typeof window._kasperGotoTab === 'function' && typeof window._kasperLoadReview === 'function', { timeout: 20000 }).catch(() => {});
  await h.page.evaluate(() => { try { window._kasperGotoTab('review'); } catch (e) {} });
  await h.page.waitForTimeout(800);
  return h;
}
async function _forceSxrLoad(page, name = 'Sidney Laruel', ms = 45000) {
  const t = Date.now();
  await page.waitForFunction(() => typeof loadSxrCards === 'function', { timeout: 20000 }).catch(() => {});
  let last = null;
  while (Date.now() - t < ms) {
    const res = await page.evaluate(async (n) => {
      try {
        if (!(typeof sxrState === 'object' && sxrState.client)) {
          if (typeof _sxrOpenClientTab === 'function') _sxrOpenClientTab(n);
          if (!sxrState.client) sxrState.client = n;
        }
      } catch (e) {}
      try { if (typeof sxrState === 'object' && sxrState.client && (sxrState.posts || []).length === 0) await loadSxrCards({ skipCache: true }); } catch (e) {}
      return { client: (typeof sxrState === 'object' && sxrState.client) || null, posts: (typeof sxrState === 'object' && (sxrState.posts || []).length) || 0 };
    }, name).catch(e => ({ err: String(e && e.message || e) }));
    last = res;
    if (res && res.client && res.posts > 0) return true;
    await page.waitForTimeout(1500);
  }
  page._forceLoadLast = last;
  return false;
}
async function smmSamples(browser, slug = 'sidneylaruel') {
  const h = await _open(browser, `/index.html?sxr=1&v2debug=1#sample-reviews/${encodeURIComponent(slug)}`);
  await h.page.waitForFunction(() => window.sxrV2Status && window.sxrV2Status().ready, { timeout: 15000 }).catch(() => {});
  await h.page.waitForTimeout(2500);
  h.loaded = await _forceSxrLoad(h.page);
  await h.page.waitForTimeout(500);
  return h;
}
async function clientSamples(browser, name = 'Sidney Laruel') {
  const h = await _open(browser, `/index.html?sxr=1&c=${encodeURIComponent(name)}&v=sample-reviews&v2debug=1`);
  await h.page.waitForTimeout(2500);
  return h;
}
async function kasperSamples(browser) {
  const h = await _open(browser, `/index.html?Kasper=1&sxr=1&v2debug=1#kasper`, { kasper: true });
  await h.page.waitForFunction(() => typeof window._kasperGotoTab === 'function' && typeof window._kasperRenderSamples === 'function', { timeout: 20000 }).catch(() => {});
  await h.page.evaluate(() => { try { window._kasperGotoTab('samples'); } catch (e) {} });
  await h.page.waitForTimeout(800);
  return h;
}

// tiny assert harness
function makeOk(name) {
  const s = { name, pass: 0, fail: 0, rows: [] };
  s.ok = (c, m, detail) => { if (c) s.pass++; else s.fail++; const line = (c ? 'PASS ' : 'FAIL ') + m + (detail ? '  — ' + detail : ''); s.rows.push(line); console.log((c ? '  ✅ ' : '  ❌ ') + m + (detail ? '  — ' + detail : '')); return c; };
  return s;
}

module.exports = {
  PW, ORIGIN, SUPA, KEY, N8N, startServer,
  CAL_EF, CAL_N8N, SXR_EF, SXR_N8N,
  launch, makeCtx, _open, appErrs,
  smmCal, clientCal, kasperCal, smmSamples, clientSamples, kasperSamples,
  supaCal, supaSample, supaCalEvents, supaSampleEvents, supaGet: _supaGet, calRow, sampleRow, pollCal, pollSample,
  calUpN8n, sampleUpN8n, setLinearForwardAllow, setBlockN8nWrites, classify, makeOk,
};
