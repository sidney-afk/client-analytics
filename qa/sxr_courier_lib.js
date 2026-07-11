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
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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
// TMP must be a path BOTH Node (fs.writeFileSync) and the curl-under-bash
// calls resolve to the same place. On win32 Node maps '/tmp' to <drive>:\tmp
// while git-bash maps it to its own msys tmp — use os.tmpdir() with forward
// slashes (git-bash accepts C:/... paths) so the two sides agree.
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
function _filmingTabsStubPayload(url) {
  if (LIVE_FILMING_TABS || !FILMING_TABS_HOOK.test(url)) return null;
  let docId = '';
  try { docId = new URL(url).searchParams.get('doc') || ''; } catch {}
  return { ok: true, docId, tabs: [] };
}

let _seq = 0;
function _q(a) { return `'${String(a).replace(/'/g, "'\\''")}'`; }
// Windows portability: the single-quoted curl commands above are POSIX shell
// syntax — under cmd.exe (Node's default shell on win32) the quotes pass
// through literally and every call silently returns junk ("'select' is not
// recognized…"). Route execSync through Git Bash on Windows. Git for Windows
// does not always add bash.exe itself to PATH, so resolve its normal install
// locations before falling back to PATH lookup.
function _windowsBash() {
  const candidates = [
    process.env.SXR_BASH,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || 'bash.exe';
}
const _SHELL = process.platform === 'win32' ? { shell: _windowsBash() } : {};
const _exec = (cmd, extra) => execSync(cmd, Object.assign({ encoding: 'utf8', timeout: 60000 }, _SHELL, extra || {}));

// ---- Node-side network (works through the egress proxy) --------------------
function nodePost(url, obj) {
  const f = `${TMP}/_post_${process.pid}_${++_seq}.json`;
  fs.writeFileSync(f, JSON.stringify(obj));
  const out = _exec(`curl -s -X POST ${_q(url)} -H 'Content-Type: application/json' -d @${f}`);
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
        try { _exec('sleep 1.5'); } catch {}
        continue;
      }
      sawRow = true;
      if (String(row.status) === 'Archived') return true;
      try { up({ id, status: 'Archived' }); } catch {}
      const after = supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      if (Array.isArray(after) && after[0] && String(after[0].status) === 'Archived') return true;
    } catch {}
    try { _exec('sleep 1.5'); } catch {}
  }
  return !sawRow;
}
function reorder(items) { return nodePost(SXR_REORDER, { client: 'sidneylaruel', items }); }
// Read a sample_reviews row (or rows) back from Supabase REST.
function supa(qs) {
  const out = _exec(`curl -s ${_q(SUPA + '/rest/v1/sample_reviews?' + qs)} -H ${_q('apikey: ' + KEY)} -H ${_q('Authorization: Bearer ' + KEY)}`);
  try { return JSON.parse(out); } catch { return []; }
}
function supaEvents(qs) {
  const out = _exec(`curl -s ${_q(SUPA + '/rest/v1/sample_review_events?' + qs)} -H ${_q('apikey: ' + KEY)} -H ${_q('Authorization: Bearer ' + KEY)}`);
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
  try { head = _exec('curl ' + args.map(_q).join(' '), { maxBuffer: 64 * 1024 * 1024 }); }
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
  // Windows headless Chromium can intermittently tile the second screenshot of
  // a page with black GPU layers. The master vision lane needs deterministic
  // pixels; browser behavior itself is covered separately by the normal-GPU B4
  // suite, so force software compositing only in this QA harness.
  return await PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--disable-gpu'] });
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
  const t = token ? `&t=${encodeURIComponent(token)}` : '';
  const p = await open(browser, `/index.html?sxr=1&c=${encodeURIComponent(name)}&v=sample-reviews${t}&v2debug=1`, opts);
  await p.waitForTimeout(1500);
  return p;
}

// Seed/save a CALENDAR post via the live calendar-upsert-post webhook — used to
// prove an unrelated calendar card NEVER appears in the samples sub-tab, and (in
// the twin-live tester) to seed the calendar SOURCE-OF-TRUTH row alongside the
// samples row so the SAME journey can be driven on both surfaces.
function upCal(post, base) { return nodePost(HOOKS + '/calendar-upsert-post', { client: 'sidneylaruel', post, comments_base_at: base || '' }); }
// Read a calendar_posts row (or rows) back from Supabase REST.
function supaCal(qs) {
  const out = _exec(`curl -s ${_q(SUPA + '/rest/v1/calendar_posts?' + qs)} -H ${_q('apikey: ' + KEY)} -H ${_q('Authorization: Bearer ' + KEY)}`);
  try { return JSON.parse(out); } catch { return []; }
}
// Archive a CALENDAR seed and VERIFY it stuck (mirror of archiveSafe for samples).
function archiveCalSafe(id, tries) {
  tries = tries || 4;
  let sawRow = false;
  for (let i = 0; i < tries; i++) {
    try {
      const r = supaCal('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      const row = Array.isArray(r) && r[0] ? r[0] : null;
      if (!row) {
        try { _exec('sleep 1.5'); } catch {}
        continue;
      }
      sawRow = true;
      if (String(row.status) === 'Archived') return true;
      try { upCal({ id, status: 'Archived' }); } catch {}
      const after = supaCal('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status');
      if (Array.isArray(after) && after[0] && String(after[0].status) === 'Archived') return true;
    } catch {}
    try { _exec('sleep 1.5'); } catch {}
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
  const t = token ? `&t=${encodeURIComponent(token)}` : '';
  const p = await open(browser, `/index.html?c=${encodeURIComponent(name)}&v=calendar${t}&v2debug=1`, opts);
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

module.exports = { PW, launch, open, smm, client, kasper, smmCal, clientCal, kasperCal, up, archiveSafe, upCal, archiveCalSafe, reorder, supa, supaCal, supaEvents, poll, appErrs, ORIGIN, SUPA, KEY, COURIER, linearCalls, resetLinearCalls, setSubissuesResp };
