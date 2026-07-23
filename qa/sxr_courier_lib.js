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
// Scope/safety (same rules as docs/testing/HEADLESS-TESTING-GUIDE.md §5): only ever
// mutate the test client `sidneylaruel`; unique `sr_*` ids; archive what you
// create; assert 0 app JS errors.
// ============================================================================
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  clientEntrySafeChildEnv,
  currentTestClientToken,
  gotoTestClientEntry,
} = require('./test-client-entry.js');
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
const QA_THEME = /^(dark|light)$/i.test(process.env.SYNCVIEW_QA_THEME || '')
  ? String(process.env.SYNCVIEW_QA_THEME).toLowerCase()
  : '';
// TMP is only for local mocked-Linear coordination artifacts. Protected HTTP
// requests and responses never use it. Preserve the existing cross-platform
// path form for callers that provide SXR_TMP.
const TMP = process.env.SXR_TMP || (process.platform === 'win32'
  ? require('os').tmpdir().replace(/\\/g, '/') + '/qa'
  : '/tmp/qa');
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
const FILMING_TABS_HOOK = /\/webhook\/filming-plan-tabs\b/;
const LIVE_FILMING_TABS = process.env.SYNCVIEW_QA_LIVE_FILMING_TABS === '1';
const LINEAR_CALLS_FILE = `${TMP}/linear_calls.jsonl`;
const SUBISSUES_RESP_FILE = `${TMP}/linear_subissues_resp.json`;
let _courierCommitThenFailEvents = [];
function resetLinearCalls() { try { fs.unlinkSync(LINEAR_CALLS_FILE); } catch {} }
function linearCalls() {
  try { return fs.readFileSync(LINEAR_CALLS_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
function resetCourierCommitThenFailEvents() { _courierCommitThenFailEvents = []; }
function courierCommitThenFailEvents() {
  return _courierCommitThenFailEvents.map(event => Object.assign({}, event));
}
// Configure what linear-subissues returns next (point-adoption source status).
function setSubissuesResp(obj) { try { fs.writeFileSync(SUBISSUES_RESP_FILE, JSON.stringify(obj || {})); } catch {} }
function _subissuesResp() {
  try { return JSON.parse(fs.readFileSync(SUBISSUES_RESP_FILE, 'utf8')); }
  catch { return { ok: true, parent: { status: 'Kasper Approval', identifier: 'VID-1' }, subIssues: [] }; }
}
function _filmingTabsStubPayload(url) {
  if (LIVE_FILMING_TABS || !FILMING_TABS_HOOK.test(url)) return null;
  let docId = '';
  try { docId = new URL(url).searchParams.get('doc') || ''; } catch {}
  return { ok: true, docId, tabs: [] };
}

const _SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));
function _sleepSync(ms) {
  Atomics.wait(_SLEEP_CELL, 0, 0, ms);
}
const _CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';
const _CURL_OPTIONS = Object.freeze({
  timeout: 60000,
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true,
  env: clientEntrySafeChildEnv(),
});
const _COURIER_HEADER_SKIP = /^(host|origin|referer|connection|content-length|accept-encoding)$/i;

function _curlConfigValue(value) {
  let text;
  if (Buffer.isBuffer(value)) {
    text = value.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(value)) throw new Error('binary courier request bodies are unsupported');
  } else {
    text = String(value == null ? '' : value);
  }
  if (/[\u0000-\u0008\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error('unsupported control byte in courier request');
  }
  return '"' + text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\v/g, '\\v') + '"';
}
function _curlMarker() {
  return `__SYNCVIEW_CURL_META_${crypto.randomBytes(18).toString('hex')}__`;
}
function _curlRequestConfig(method, url, headers, postData, marker) {
  const lines = [
    'silent',
    'show-error',
    `max-time = ${_curlConfigValue(String(_CURL_OPTIONS.timeout / 1000))}`,
    `request = ${_curlConfigValue(method)}`,
    `url = ${_curlConfigValue(url)}`,
  ];
  for (const [k, v] of Object.entries(headers || {})) {
    if (_COURIER_HEADER_SKIP.test(k)) continue;
    const name = String(k || '').trim();
    const value = String(v == null ? '' : v);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\u0000\r\n]/.test(value)) {
      throw new Error('invalid courier header');
    }
    lines.push(`header = ${_curlConfigValue(`${name}: ${value}`)}`);
  }
  if (postData !== undefined && postData !== null) {
    // data-raw preserves literal request bytes and never treats a leading @ as
    // a filename, unlike data-binary.
    lines.push(`data-raw = ${_curlConfigValue(postData)}`);
  }
  lines.push(`write-out = ${_curlConfigValue(`${marker}%{http_code}\t%{content_type}${marker}`)}`);
  return lines.join('\n') + '\n';
}
function _curlResult(output, marker) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output || '');
  const markerBytes = Buffer.from(marker, 'utf8');
  const close = bytes.lastIndexOf(markerBytes);
  if (close < 0 || close + markerBytes.length !== bytes.length) throw new Error('curl metadata missing');
  const open = bytes.lastIndexOf(markerBytes, close - 1);
  if (open < 0) throw new Error('curl metadata malformed');
  const metadata = bytes.subarray(open + markerBytes.length, close).toString('utf8');
  const separator = metadata.indexOf('\t');
  const statusText = separator < 0 ? '' : metadata.slice(0, separator);
  const ctype = separator < 0 ? '' : metadata.slice(separator + 1);
  if (!/^\d{3}$/.test(statusText)) throw new Error('curl status missing');
  return {
    status: Number(statusText),
    ctype: ctype.trim() || 'application/json',
    body: Buffer.from(bytes.subarray(0, open)),
  };
}
function _curlRequestSync(method, url, headers, postData) {
  try {
    const marker = _curlMarker();
    const config = _curlRequestConfig(method, url, headers, postData, marker);
    const result = spawnSync(_CURL, ['--config', '-'], Object.assign({}, _CURL_OPTIONS, {
      input: config,
    }));
    if (result.error || result.status !== 0) throw new Error('curl request failed');
    return _curlResult(result.stdout, marker);
  } catch {
    throw new Error('curl request failed');
  }
}

// ---- Node-side network (works through the egress proxy) --------------------
function nodePost(url, obj) {
  const response = _curlRequestSync(
    'POST',
    url,
    { 'Content-Type': 'application/json' },
    JSON.stringify(obj),
  );
  const out = response.body.toString('utf8');
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
  let sawRow = false;
  for (let i = 0; i < tries; i++) {
    try {
      const r = supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      const row = Array.isArray(r) && r[0] ? r[0] : null;
      if (!row) {
        _sleepSync(1500);
        continue;
      }
      sawRow = true;
      if (String(row.status) === 'Archived') return true;
      try { up({ id, status: 'Archived' }); } catch {}
      const after = supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      if (Array.isArray(after) && after[0] && String(after[0].status) === 'Archived') return true;
    } catch {}
    _sleepSync(1500);
  }
  return !sawRow;
}
function reorder(items) { return nodePost(SXR_REORDER, { client: 'sidneylaruel', items }); }
// Read TEST rows back from Supabase REST using the same fileless transport as
// the browser courier. The protected URL and headers stay in stdin config, and
// curl's response stays in memory.
function _supaRead(table, qs) {
  const out = _curlRequestSync(
    'GET',
    SUPA + '/rest/v1/' + table + '?' + qs,
    { apikey: KEY, Authorization: 'Bearer ' + KEY },
  ).body.toString('utf8');
  try { return JSON.parse(out); } catch { return []; }
}
function supa(qs) { return _supaRead('sample_reviews', qs); }
function supaEvents(qs) { return _supaRead('sample_review_events', qs); }
async function poll(predFn, ms = 15000, step = 800) {
  const t = Date.now(); let last;
  while (Date.now() - t < ms) { last = predFn(); if (last && last.__ok !== false) { if (last !== undefined && last !== null && last !== false) return last; } await new Promise(r => setTimeout(r, step)); }
  return last;
}

function _courierFailure() {
  return { status: 502, ctype: 'text/plain', body: Buffer.from('courier-failed') };
}

// One intercepted request, performed in Node, returned as {status, ctype, body}.
// The complete request is a safely quoted curl config on stdin; curl returns
// the exact body plus a random metadata trailer on stdout. No request,
// credential, response, or protected URL enters argv or a temp file.
function _courierFetch(method, url, headers, postData) {
  try {
    return _curlRequestSync(method, url, headers, postData);
  } catch {
    return _courierFailure();
  }
}

// Playwright route callbacks must leave the protocol loop free while a fault
// injector forwards the source write. A synchronous curl can commit upstream
// but prevent route.fulfill() from delivering the deliberately lost
// acknowledgement to the page. Keep the normal courier unchanged; use this
// async twin only for courierCommitThenFail.
function _courierFetchAsync(method, url, headers, postData) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const marker = _curlMarker();
      const config = _curlRequestConfig(method, url, headers, postData, marker);
      const child = spawn(_CURL, ['--config', '-'], {
        timeout: _CURL_OPTIONS.timeout,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: clientEntrySafeChildEnv(),
      });
      const chunks = [];
      let outputBytes = 0;
      let overflow = false;
      let stdinFailed = false;
      child.stdout.on('data', chunk => {
        if (overflow) return;
        const bytes = Buffer.from(chunk);
        outputBytes += bytes.length;
        if (outputBytes > _CURL_OPTIONS.maxBuffer) {
          overflow = true;
          child.kill();
          return;
        }
        chunks.push(bytes);
      });
      child.on('error', () => finish(_courierFailure()));
      child.on('close', code => {
        if (settled) return;
        if (code !== 0 || overflow || stdinFailed) {
          finish(_courierFailure());
          return;
        }
        try { finish(_curlResult(Buffer.concat(chunks), marker)); }
        catch { finish(_courierFailure()); }
      });
      child.stdin.on('error', () => { stdinFailed = true; });
      try {
        child.stdin.end(config);
      } catch {
        stdinFailed = true;
        try { child.kill(); } catch { finish(_courierFailure()); }
      }
    } catch {
      finish(_courierFailure());
    }
  });
}

async function launch() {
  // Windows headless Chromium can intermittently tile the second screenshot of
  // a page with black GPU layers. The master vision lane needs deterministic
  // pixels; browser behavior itself is covered separately by the normal-GPU B4
  // suite, so force software compositing only in this QA harness.
  return await PW.chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--disable-gpu'],
    env: clientEntrySafeChildEnv(),
  });
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
  // opts.writeUiRerouteLive: p95's guard probe opts back into the LIVE
  // write_ui_reroute_clients flag; every other probe gets it stubbed dark
  // (see the route case below).
  //
  // opts.courierCommitThenFail: one-shot lost-ack injection. For the first
  // matching POST whose forwarded JSON response confirms a 2xx commit, record
  // that proof and abort only the browser-visible acknowledgement.
  // Strip both harness-only keys before newContext.
  const { writeUiRerouteLive, courierCommitThenFail, syntheticClientEntry, ...ctxOpts } = opts || {};
  let courierCommitThenFailUsed = false;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true, ...ctxOpts });
  await ctx.addInitScript((theme) => {
    try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {}
    // These scenarios exercise Samples/Calendar behavior, not the optional
    // global staff sign-in invitation. Keep that auto-prompt from obscuring the
    // visual lane; B4's dedicated real-browser suite owns the complete auth UX.
    try { sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1'); } catch (e) {}
    try {
      if (theme === 'dark') localStorage.setItem('syncview_theme', 'dark');
      else if (theme === 'light') localStorage.removeItem('syncview_theme');
    } catch (e) {}
  }, QA_THEME);
  // Always install the route: it MOCKS the linear-* webhooks (never live) and,
  // when the courier is on, tunnels every OTHER backend host to live via Node.
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    // 0) write_ui_reroute_clients flag → DARK for the harness. The TEST
    //    client is the sole live allowlist member; with the flag loaded the
    //    page takes the #850 gateway lane, which fails Linear-linkless
    //    harness cards closed (kind='test' → native_link_required) before
    //    the source save the probes assert on. Real clients run legacy —
    //    keep the stand-in faithful. Only this flag is stubbed; p95 opts
    //    back in via writeUiRerouteLive to cover the guard itself.
    if (!writeUiRerouteLive && url.includes('syncview_runtime_flags') && url.includes('write_ui_reroute_clients')) {
      const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS', 'cache-control': 'no-store' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '[]' });
    }
    // Fully intercepted share-link tests can supply one fictional strict
    // verifier contract. Live TEST lanes never set this option and therefore
    // still exercise the deployed verifier with the job-scoped current token.
    if (syntheticClientEntry && url.includes('/functions/v1/client-token-verify')) {
      const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'cache-control': 'no-store' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch {}
      const valid = body && body.strict === true
        && body.slug === syntheticClientEntry.slug
        && body.token === syntheticClientEntry.token
        && body.view === syntheticClientEntry.view;
      return route.fulfill({
        status: valid ? 200 : 410,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify(valid ? {
          ok: true,
          valid: true,
          active: true,
          strict: true,
          protocol: 'syncview-client-entry-v1',
          slug: syntheticClientEntry.slug,
          view: syntheticClientEntry.view,
          display_name: syntheticClientEntry.displayName,
        } : { ok: false, valid: false, reason: 'invalid_link' }),
      });
    }
    // 1) Linear webhooks → MOCK + capture (never reach real Linear).
    const lh = url.match(LINEAR_HOOK);
    if (lh) {
      let payload = null; try { payload = JSON.parse(req.postData() || 'null'); } catch {}
      try { fs.appendFileSync(LINEAR_CALLS_FILE, JSON.stringify({ path: lh[1], payload, at: Date.now() }) + '\n'); } catch {}
      const body = (lh[1] === 'linear-subissues') ? _subissuesResp() : { ok: true };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
    }
    // 2) Filming Plan Tabs -> stub by default. QA cold boots do not exercise
    // the Google Docs tab parser; let the app
    // render the empty-state contract without spending n8n executions.
    const filmingTabsStub = _filmingTabsStubPayload(url);
    if (filmingTabsStub) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
        body: JSON.stringify(filmingTabsStub),
      });
    }
    // 3) Other backend hosts → courier to live (when the courier is on).
    // The fault path always forwards through Node, even with SXR_COURIER=0,
    // because the marker is authoritative only after a parsed successful reply.
    const commitThenFailMatch = !courierCommitThenFailUsed && courierCommitThenFail &&
      req.method() === 'POST' && url.includes(String(courierCommitThenFail));
    if (EXT.test(url) && (COURIER || commitThenFailMatch)) {
      const r = commitThenFailMatch
        ? await _courierFetchAsync(req.method(), url, req.headers(), req.postData())
        : _courierFetch(req.method(), url, req.headers(), req.postData());
      let forwardedJson = null;
      try { forwardedJson = JSON.parse(Buffer.from(r.body || '').toString('utf8')); } catch {}
      const sourceCommitted = commitThenFailMatch &&
        r.status >= 200 && r.status < 300 &&
        forwardedJson && typeof forwardedJson === 'object' &&
        forwardedJson.ok !== false;
      if (sourceCommitted) {
        courierCommitThenFailUsed = true;
        _courierCommitThenFailEvents.push({
          url,
          method: req.method(),
          sourceCommitted: true,
          forwardStatus: r.status,
          at: Date.now()
        });
        return route.abort('failed');
      }
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
async function openClient(browser, view, name, token, opts) {
  const ctx = await _ctx(browser, opts);
  const page = await ctx.newPage();
  _capture(page);
  await gotoTestClientEntry(page, {
    origin: ORIGIN,
    view,
    name,
    token,
    gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 },
  });
  await page.waitForTimeout(600);
  return page;
}
// SMM surface for the samples tab (flag on, debug logs on).
async function smm(browser, slug = 'sidneylaruel', opts) {
  const p = await open(browser, `/index.html?sxr=1&v2debug=1#sample-reviews/${slug}`, opts);
  await p.waitForFunction(() => window.sxrV2Status && window.sxrV2Status().ready, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
  // SXR_TRACE_UPSERT=1 → log a JS stack for every sample-review-upsert POST the
  // page makes (debugging duplicate-create issues). Reads via page console.
  if (process.env.SXR_TRACE_UPSERT === '1') {
    p.on('console', m => { const t = m.text(); if (t.startsWith('[TRACE]')) console.log(t); });
    await p.evaluate(() => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        try {
          if (String(url).includes('sample-review-upsert')) {
            const body = opts && opts.body ? JSON.parse(opts.body) : {};
            const s = body.sample || {};
            console.log('[TRACE] UPSERT id=' + s.id + ' name=' + JSON.stringify(s.name) + ' status=' + s.status + ' at=' + new Date().toISOString().slice(11, 23) + ' stack=' + new Error().stack.split('\n').slice(2, 6).join(' <- ').replace(/https?:\/\/[^)\s]+/g, mm => mm.split('/').pop()));
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    });
  }
  return p;
}
// Client share surface for the samples tab.
async function client(browser, name = 'Sidney Laruel', token, opts) {
  const currentToken = token === undefined ? await currentTestClientToken() : token;
  const p = await openClient(browser, 'sample-reviews', name, currentToken, opts);
  await p.waitForTimeout(1500);
  return p;
}

// Seed/save a CALENDAR post via the live calendar-upsert-post webhook — used to
// prove an unrelated calendar card NEVER appears in the samples sub-tab, and (in
// the twin-live tester) to seed the calendar SOURCE-OF-TRUTH row alongside the
// samples row so the SAME journey can be driven on both surfaces.
function upCal(post, base) { return nodePost(HOOKS + '/calendar-upsert-post', { client: 'sidneylaruel', post, comments_base_at: base || '' }); }
// Read a calendar_posts row (or rows) back from Supabase REST.
function supaCal(qs) { return _supaRead('calendar_posts', qs); }
// Archive a CALENDAR seed and VERIFY it stuck (mirror of archiveSafe for samples).
function archiveCalSafe(id, tries) {
  tries = tries || 4;
  let sawRow = false;
  for (let i = 0; i < tries; i++) {
    try {
      const r = supaCal('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      const row = Array.isArray(r) && r[0] ? r[0] : null;
      if (!row) {
        _sleepSync(1500);
        continue;
      }
      sawRow = true;
      if (String(row.status) === 'Archived') return true;
      try { upCal({ id, status: 'Archived' }); } catch {}
      const after = supaCal('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      if (Array.isArray(after) && after[0] && String(after[0].status) === 'Archived') return true;
    } catch {}
    _sleepSync(1500);
  }
  return !sawRow;
}

// ============================================================================
// CALENDAR-SIDE role helpers (the SOURCE OF TRUTH surface). Same actors as the
// samples helpers above, but WITHOUT ?sxr=1 — they open the original calendar:
//   smmCal     → the content calendar Sheet/Review (#calendar/<slug>)
//   clientCal  → the calendar client share surface (?c=<name>&v=calendar)
//   kasperCal  → the Kasper page's "Review" sub-tab (the calendar Kasper queue,
//                the source-of-truth that the samples "Samples" sub-tab clones)
// The twin-live tester drives each scenario on BOTH a samples tab and a calendar
// tab and diffs the observable snapshot. (The linear-* webhooks are still mocked
// and every other backend host is tunnelled, exactly as for the samples helpers.)
// ============================================================================
// SMM content-calendar surface. The #calendar/<slug> deep link resolves the
// active client + loads calendar_posts once the analytics/clients sheets merge.
async function smmCal(browser, slug = 'sidneylaruel', opts) {
  const p = await open(browser, `/index.html?v2debug=1#calendar/${encodeURIComponent(slug)}`, opts);
  await p.waitForFunction(() => typeof calState === 'object' && !!calState.client, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1200);
  return p;
}
// Calendar client share surface (?c=<name>&v=calendar) — the original of the
// samples client portal.
async function clientCal(browser, name = 'Sidney Laruel', token, opts) {
  const currentToken = token === undefined ? await currentTestClientToken() : token;
  const p = await openClient(browser, 'calendar', name, currentToken, opts);
  await p.waitForTimeout(1800);
  return p;
}
// Kasper page → the CALENDAR "Review" sub-tab (source of truth for the samples
// "Samples" sub-tab). No ?sxr=1; seeds the same auth + Kasper unlock as kasper(),
// waits for _kasperLoadReview, then switches to the review tab.
async function kasperCal(browser, opts) {
  const ctx = await _ctx(browser, opts);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {}
    try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {}
  });
  const page = await ctx.newPage();
  _capture(page);
  await page.goto(ORIGIN + '/index.html?Kasper=1&v2debug=1#kasper', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window._kasperGotoTab === 'function' && typeof window._kasperLoadReview === 'function', { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { try { window._kasperGotoTab('review'); } catch (e) {} });
  await page.waitForTimeout(800);
  return page;
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

module.exports = {
  PW, launch, open, smm, client, kasper, smmCal, clientCal, kasperCal,
  up, archiveSafe, upCal, archiveCalSafe, reorder, supa, supaCal, supaEvents,
  poll, appErrs, ORIGIN, SUPA, KEY, COURIER, filelessHttpRequest: _curlRequestSync,
  linearCalls, resetLinearCalls,
  courierCommitThenFailEvents, resetCourierCommitThenFailEvents, setSubissuesResp,
  __test: Object.freeze({
    courierFetch: _courierFetch,
    courierFetchAsync: _courierFetchAsync,
    nodePost,
  }),
};
