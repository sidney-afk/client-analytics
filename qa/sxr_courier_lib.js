// ============================================================================
// sxr_courier_lib.js — REAL-browser test harness for the Samples (Review) tab.
//
// WHY: this sandbox's egress proxy refuses to relay the BROWSER's traffic
// (browser -> proxy -> backend fails for HTTP/1.1 CONNECT, HTTP/2 and WebSocket
// alike — see /root/.ccr/README.md "not supported through the proxy"). But
// Node/curl -> proxy -> backend works fine. So we run the REAL index.html in a
// REAL headless Chromium, and intercept the page's backend HTTP calls
// (supabase REST, the sample-review-* webhooks, the supabase-js CDN), performing
// each one in Node via curl and fulfilling the live response back into the page.
// The browser believes it is talking to the live backend; Node is the courier.
//
// This yields a genuine real-browser test of load/render/save/review against the
// LIVE backend. The ONE thing that cannot be tunneled is the realtime PUSH
// WebSocket (cross-tab live updates); the app falls back to its REST load, which
// is what these probes drive. (A routeWebSocket mock can simulate a push event to
// exercise the realtime handler when a probe needs it.)
//
// In an environment with open browser egress (GitHub Actions CI, a dev laptop),
// the same probes run WITHOUT the courier — set SXR_COURIER=0.
//
// Scope/safety (same rules as docs/HEADLESS-TESTING-GUIDE.md §5): only ever
// mutate the test client `sidneylaruel`; unique `sr_*` ids; archive what you
// create; assert 0 app JS errors.
// ============================================================================
const { execSync } = require('child_process');
const fs = require('fs');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }

const ORIGIN = 'http://localhost:8000';
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const HOOKS = 'https://synchrosocial.app.n8n.cloud/webhook';
const SXR_UPSERT = HOOKS + '/sample-review-upsert';
const SXR_REORDER = HOOKS + '/sample-review-reorder';
// Hosts the courier tunnels for the page (Node -> proxy -> host works; the
// browser's own egress does not). docs.google.com is included so the CLIENT
// SHARE surface boots: its router does `await fetchEssentials()` (Metrics +
// Clients Info Google-Sheet CSVs) BEFORE resolving ?c=…&v=sample-reviews, so
// without tunneling the sheet the client-link branch throws and the surface
// never mounts. (Analytics CSV is read-only seed data; safe to tunnel.)
// Backend hosts the courier tunnels for the page. Now also includes the common
// IMAGE/THUMBNAIL hosts so visual tests render REAL media instead of gray boxes
// (the browser's own egress is blocked, so an un-tunnelled image just fails to
// load — which is why earlier visual checks couldn't see thumbnails). curl fetches
// the bytes via Node and fulfils them back into the page.
const EXT = /(supabase\.co|synchrosocial\.app\.n8n\.cloud|cdn\.jsdelivr\.net|docs\.google\.com|drive\.google\.com|googleusercontent\.com|ytimg\.com|youtube\.com|ggpht\.com|vimeocdn\.com|frame\.io|placeholder\.com|imgur\.com)/;
const COURIER = process.env.SXR_COURIER !== '0';  // on by default; 0 in open-egress envs
const TMP = process.env.SXR_TMP || '/tmp/qa';
try { fs.mkdirSync(TMP, { recursive: true }); } catch {}

// ---- Linear webhook MOCK (M4) ----------------------------------------------
// The samples FE pushes statuses / comments to the GENERIC Linear webhooks
// (linear-set-status / linear-add-comment / linear-subissues / -issue-statuses).
// A real-browser probe must NEVER let those reach live Linear — that would
// mutate a real editor's issue. So we ALWAYS intercept the linear-* webhook
// paths in the page, RECORD the payload (for assertions), and fulfil a stub
// {ok:true} — independently of the courier (which still tunnels the sample-
// review-* webhooks to the LIVE backend on the same host). linear-subissues
// (point-adoption) returns a probe-configurable parent status.
const LINEAR_HOOK = /\/webhook\/(linear-set-status|linear-add-comment|linear-subissues|linear-issue-statuses)\b/;
const LINEAR_CALLS_FILE = `${TMP}/linear_calls.jsonl`;
const SUBISSUES_RESP_FILE = `${TMP}/linear_subissues_resp.json`;
function resetLinearCalls() { try { fs.unlinkSync(LINEAR_CALLS_FILE); } catch {} }
function linearCalls() {
  try { return fs.readFileSync(LINEAR_CALLS_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
// Configure what linear-subissues returns next (point-adoption source status).
function setSubissuesResp(obj) { try { fs.writeFileSync(SUBISSUES_RESP_FILE, JSON.stringify(obj || {})); } catch {} }
function _subissuesResp() {
  try { return JSON.parse(fs.readFileSync(SUBISSUES_RESP_FILE, 'utf8')); }
  catch { return { ok: true, parent: { status: 'Kasper Approval', identifier: 'VID-1' }, subIssues: [] }; }
}

let _seq = 0;
function _q(a) { return `'${String(a).replace(/'/g, "'\\''")}'`; }

// ---- Node-side network (works through the egress proxy) --------------------
function nodePost(url, obj) {
  const f = `${TMP}/_post_${process.pid}_${++_seq}.json`;
  fs.writeFileSync(f, JSON.stringify(obj));
  const out = execSync(`curl -s -X POST ${_q(url)} -H 'Content-Type: application/json' -d @${f}`, { encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(out); } catch { return { _raw: out }; }
}
// Seed/save a sample via the live upsert webhook (the same write the FE makes).
function up(sample, base) { return nodePost(SXR_UPSERT, { client: 'sidneylaruel', sample, comments_base_at: base || '' }); }
// Archive a seed and VERIFY it stuck, re-archiving a few times. Heavy probes can
// leave a trailing browser flush in-flight that lands AFTER an in-finally
// archive and re-saves the row's status; close the browser BEFORE calling this,
// then it confirms the row reads Archived (re-archiving if a late write clobbered).
function archiveSafe(id, tries) {
  tries = tries || 4;
  for (let i = 0; i < tries; i++) {
    try { up({ id, status: 'Archived' }); } catch {}
    try {
      const r = supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      if (Array.isArray(r) && r[0] && String(r[0].status) === 'Archived') return true;
    } catch {}
    try { execSync('sleep 1.5'); } catch {}
  }
  return false;
}
function reorder(items) { return nodePost(SXR_REORDER, { client: 'sidneylaruel', items }); }
// Read a sample_reviews row (or rows) back from Supabase REST.
function supa(qs) {
  const out = execSync(`curl -s ${_q(SUPA + '/rest/v1/sample_reviews?' + qs)} -H ${_q('apikey: ' + KEY)} -H ${_q('Authorization: Bearer ' + KEY)}`, { encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(out); } catch { return []; }
}
function supaEvents(qs) {
  const out = execSync(`curl -s ${_q(SUPA + '/rest/v1/sample_review_events?' + qs)} -H ${_q('apikey: ' + KEY)} -H ${_q('Authorization: Bearer ' + KEY)}`, { encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(out); } catch { return []; }
}
async function poll(predFn, ms = 15000, step = 800) {
  const t = Date.now(); let last;
  while (Date.now() - t < ms) { last = predFn(); if (last && last.__ok !== false) { if (last !== undefined && last !== null && last !== false) return last; } await new Promise(r => setTimeout(r, step)); }
  return last;
}

// One intercepted request, performed in Node, returned as {status, ctype, body}.
function _courierFetch(method, url, headers, postData) {
  const bodyFile = `${TMP}/_resp_${process.pid}_${++_seq}.bin`;
  const args = ['-s', '-D', '-', '-o', bodyFile, '-X', method];
  for (const [k, v] of Object.entries(headers || {})) {
    if (/^(host|origin|referer|connection|content-length|accept-encoding)$/i.test(k)) continue;
    args.push('-H', `${k}: ${v}`);
  }
  if (postData) { const pf = `${TMP}/_pd_${process.pid}_${_seq}.bin`; fs.writeFileSync(pf, postData); args.push('--data-binary', '@' + pf); }
  args.push(url);
  let head = '';
  try { head = execSync('curl ' + args.map(_q).join(' '), { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return { status: 502, ctype: 'text/plain', body: Buffer.from('courier-failed: ' + (e.message || '')) }; }
  // Parse the LAST status line's 3-digit code. Capture the code that follows
  // the HTTP version + whitespace — NOT the first digit run, which on an HTTP/2
  // response ("HTTP/2 200") is the version "2", not "200". Getting this wrong
  // makes resp.ok false in the page → the FE flush throws into its catch (a
  // silent console.warn), so the page's post-save success path never runs even
  // though the backend curl persisted fine. (Backend-state assertions still
  // pass; page-side assertions — e.g. M4's Linear push — would not.)
  const re = /HTTP\/[\d.]+\s+(\d{3})\b/g;
  let _m, _last = null;
  while ((_m = re.exec(head)) !== null) _last = _m[1];
  const status = _last ? parseInt(_last, 10) : 200;
  const ct = (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1];
  const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile) : Buffer.from('');
  return { status, ctype: (ct || 'application/json').trim(), body };
}

async function launch() {
  return await PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
}
function _capture(page) {
  page._errs = [];
  page.on('console', m => { if (m.type() === 'error') page._errs.push('[console.error] ' + m.text()); });
  page.on('pageerror', e => page._errs.push('[pageerror] ' + (e && e.message)));
}
// App-level errors only. Ignore placeholder-image 503s AND the realtime-WS
// connection failure — under the courier the Supabase realtime WebSocket can't
// be tunneled (the app falls back to its REST load), so that error is expected
// environmental noise here, NOT an app bug. (In open-egress envs it won't fire.)
function appErrs(page) {
  return (page._errs || []).filter(e =>
    /supabase|synchrosocial|sxr|_sxr|TypeError|ReferenceError|is not a function/.test(e) &&
    !/realtime\/v1\/websocket|WebSocket connection .* failed|ERR_CONNECTION_CLOSED.*realtime/i.test(e));
}

async function _ctx(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true, ...(opts || {}) });
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  // Always install the route: it MOCKS the linear-* webhooks (never live) and,
  // when the courier is on, tunnels every OTHER backend host to live via Node.
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    // 1) Linear webhooks → MOCK + capture (never reach real Linear).
    const lh = url.match(LINEAR_HOOK);
    if (lh) {
      let payload = null; try { payload = JSON.parse(req.postData() || 'null'); } catch {}
      try { fs.appendFileSync(LINEAR_CALLS_FILE, JSON.stringify({ path: lh[1], payload, at: Date.now() }) + '\n'); } catch {}
      const body = (lh[1] === 'linear-subissues') ? _subissuesResp() : { ok: true };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
    }
    // 2) Other backend hosts → courier to live (when the courier is on).
    if (COURIER && EXT.test(url)) {
      const r = _courierFetch(req.method(), url, req.headers(), req.postData());
      return route.fulfill({ status: r.status, contentType: r.ctype, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: r.body });
    }
    return route.continue();
  });
  return ctx;
}
async function open(browser, urlPath, opts) {
  const ctx = await _ctx(browser, opts);
  const page = await ctx.newPage();
  _capture(page);
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(600);
  return page;
}
// SMM surface for the samples tab (flag on, debug logs on).
async function smm(browser, slug = 'sidneylaruel', opts) {
  const p = await open(browser, `/index.html?sxr=1&v2debug=1#sample-reviews/${slug}`, opts);
  await p.waitForFunction(() => window.sxrV2Status && window.sxrV2Status().ready, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
  return p;
}
// Client share surface for the samples tab.
async function client(browser, name = 'Sidney Laruel', token, opts) {
  const t = token ? `&t=${encodeURIComponent(token)}` : '';
  const p = await open(browser, `/index.html?sxr=1&c=${encodeURIComponent(name)}&v=sample-reviews${t}&v2debug=1`, opts);
  await p.waitForTimeout(1500);
  return p;
}

// Seed/save a CALENDAR post via the live calendar-upsert-post webhook — used to
// prove an unrelated calendar card NEVER appears in the samples sub-tab.
function upCal(post) { return nodePost(HOOKS + '/calendar-upsert-post', { client: 'sidneylaruel', post, comments_base_at: '' }); }
// Read a calendar_posts row (or rows) back from Supabase REST.
function supaCal(qs) {
  const out = execSync(`curl -s ${_q(SUPA + '/rest/v1/calendar_posts?' + qs)} -H ${_q('apikey: ' + KEY)} -H ${_q('Authorization: Bearer ' + KEY)}`, { encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(out); } catch { return []; }
}

// Kasper review surface for the SAMPLES sub-tab (M5a). Opens ?Kasper=1&sxr=1,
// seeds the Kasper unlock (sessionStorage syncview_kasper_unlocked='ok',
// KASPER_UNLOCK_KEY ~25553) + the auth flag, waits for the Kasper page, then
// switches to the samples sub-tab via _kasperGotoTab('samples'). Returns the page.
async function kasper(browser, opts) {
  const ctx = await _ctx(browser, opts);
  // Seed BOTH the auth flag (localStorage) and the Kasper unlock (sessionStorage)
  // before any script runs, so the Kasper page mounts immediately on ?Kasper=1.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {}
    try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {}
  });
  const page = await ctx.newPage();
  _capture(page);
  await page.goto(ORIGIN + '/index.html?Kasper=1&sxr=1&v2debug=1#kasper', { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Wait for the Kasper view + the samples sub-tab handler to be wired.
  await page.waitForFunction(() => typeof window._kasperGotoTab === 'function' && typeof window._kasperRenderSamples === 'function', { timeout: 20000 }).catch(() => {});
  // Switch to the samples sub-tab.
  await page.evaluate(() => { try { window._kasperGotoTab('samples'); } catch (e) {} });
  await page.waitForTimeout(800);
  return page;
}

module.exports = { PW, launch, open, smm, client, kasper, up, archiveSafe, upCal, reorder, supa, supaCal, supaEvents, poll, appErrs, ORIGIN, SUPA, KEY, COURIER, linearCalls, resetLinearCalls, setSubissuesResp };
