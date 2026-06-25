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
const EXT = /(supabase\.co|synchrosocial\.app\.n8n\.cloud|cdn\.jsdelivr\.net)/;
const COURIER = process.env.SXR_COURIER !== '0';  // on by default; 0 in open-egress envs
const TMP = process.env.SXR_TMP || '/tmp/qa';
try { fs.mkdirSync(TMP, { recursive: true }); } catch {}

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
  const codes = head.match(/HTTP\/[\d.]+\s+(\d+)/g) || [];
  const status = codes.length ? parseInt(codes[codes.length - 1].match(/(\d+)/)[1]) : 200;
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
// App-level errors only (ignore placeholder-image 503s etc.).
function appErrs(page) { return (page._errs || []).filter(e => /supabase|synchrosocial|sxr|_sxr|TypeError|ReferenceError|is not a function/.test(e)); }

async function _ctx(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true, ...(opts || {}) });
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  if (COURIER) {
    await ctx.route('**/*', async (route) => {
      const req = route.request();
      if (!EXT.test(req.url())) return route.continue();
      const r = _courierFetch(req.method(), req.url(), req.headers(), req.postData());
      await route.fulfill({ status: r.status, contentType: r.ctype, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: r.body });
    });
  }
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

module.exports = { PW, launch, open, smm, client, up, reorder, supa, supaEvents, poll, appErrs, ORIGIN, SUPA, KEY, COURIER };
