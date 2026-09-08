// Extended harness for overnight calendar testing. Builds on the repo's golden_lib.
// Scope: ONLY the `sidneylaruel` test client. Every probe must clean up (archive) what it creates.
const G = require('../golden_lib.js');
const REROUTE_FIXTURE = require('../write_ui_reroute_fixture.js');
const {
  TEST_CLIENT,
  currentTestClientToken,
  gotoTestClientEntry,
} = require('../test-client-entry.js');
// Playwright: use the locally-installed module in CI; fall back to the
// container's global path for ad-hoc local runs.
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
const ORIGIN = 'http://localhost:8000';
const UPSERT = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const SUPA   = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const KEY    = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';

// generic upsert for the test client
const up = G.up;

// read an arbitrary column set from the backend row
const rawRow = async (pid, sel = '*') =>
  (await (await fetch(`${SUPA}?id=eq.${pid}&select=${sel}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json())[0] || {};
const pollRaw = async (pid, pred, sel = '*', ms = 18000) => { const t = Date.now(); let r;
  while (Date.now() - t < ms) { r = await rawRow(pid, sel); if (pred(r)) return r; await new Promise(x => setTimeout(x, 700)); } return r; };

function capture(page) {
  page._errs = [];
  page.on('console', m => { if (m.type() === 'error') { const t = m.text();
    if (!/Failed to load resource/i.test(t)) page._errs.push('[console.error] ' + t); } });
  page.on('pageerror', e => page._errs.push('[pageerror] ' + (e && e.message)));
  page.on('requestfailed', r => {
    const u = r.url(); if (!/synchrosocial|supabase/.test(u)) return;
    // Since the 2026-07-22 boot-lifecycle change (c899ac34) every calendar /
    // samples load run carries an AbortController, and a superseding load
    // (refresh, client switch, realtime reload, remount, teardown) deliberately
    // aborts its predecessor's in-flight fetches. Chromium surfaces those
    // by-design cancellations as requestfailed with net::ERR_ABORTED — they are
    // NOT network failures and must not fail the zero-error gate. Genuine
    // failures (DNS, refused, reset, proxy) carry other error texts and still gate.
    const err = (r.failure() && r.failure().errorText) || '';
    if (/ERR_ABORTED|NS_BINDING_ABORTED|\baborted\b/i.test(err)) return;
    page._errs.push('[reqfail] ' + u + (err ? ' (' + err + ')' : ''));
  });
}
// THE TEST CLIENT ROUTES THE WAY A REAL CLIENT ROUTES: NATIVE.
//
// This stub used to answer `[]` and claim that was faithful because "real
// clients run the legacy lane". They do not, and did not when that was
// written: measured 2026-09-07 against the live flag, all 43 active clients
// are enrolled (OPEN_REPAIRS 175). Both teams are SyncView-authoritative
// besides. So the nightly was exercising mocked Linear writes on a lane
// production never takes — a green suite describing a dead world, which is
// the shape of OPEN_REPAIRS 177.
//
// Serving `[]` also stopped meaning "dark" at all. After the fail-closed
// repair a SUCCESSFUL read with no usable roster routes a live write NATIVE,
// so `[]` now buys the native lane with a comment claiming legacy. The full
// reasoning, and the half of this that is NOT fixed (probe fixtures carry no
// native work item, and production cards do), is in
// `qa/write_ui_reroute_fixture.js`. Read it before changing this.
//
// Stub only this one flag read; every other runtime flag (Track-A rosters
// etc.) stays live. Probes that build their OWN context must call this on it
// too. p95_write_ui_test_guard.js opts into the genuinely live flag.
async function stubRerouteFlagProduction(ctx) {
  await ctx.route(u => REROUTE_FIXTURE.isRerouteFlagRequest(u.toString()), async (route) => {
    const CORS = REROUTE_FIXTURE.WRITE_UI_REROUTE_CORS;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: REROUTE_FIXTURE.productionRosterBody() });
  });
}
async function _ctx(browser, opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true, ...opts });
  await c.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  await stubRerouteFlagProduction(c);
  return c;
}
async function _open(browser, url, opts) { const c = await _ctx(browser, opts); const p = await c.newPage(); capture(p);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(700); return p; }
async function _openClient(browser, view, name, token, opts) {
  const c = await _ctx(browser, opts);
  const p = await c.newPage();
  capture(p);
  await gotoTestClientEntry(p, {
    origin: ORIGIN,
    view,
    name,
    token,
    gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 },
  });
  await p.waitForTimeout(700);
  return p;
}

// SMM surface (manager) — full edit rights
async function smmPage(browser, slug = 'sidneylaruel', opts) {
  const p = await _open(browser, `${ORIGIN}/index.html?v2debug=1#calendar/${slug}`, opts);
  await p.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
  return p;
}
async function clientPage(browser, opts) {
  const token = await currentTestClientToken();
  const p = await _openClient(browser, 'calendar', TEST_CLIENT.name, token, opts);
  await p.waitForTimeout(5000);
  return p;
}
async function kasperPage(browser, opts) { const p = await _open(browser, `${ORIGIN}/index.html?Kasper=1&v2debug=1`, opts); await p.waitForTimeout(8000); return p; }

// force a fresh calendar load + wait for a pid to appear in calState with optional predicate
async function waitForPost(page, pid, pred) {
  return page.evaluate(async (a) => {
    for (let i = 0; i < 25; i++) {
      try { if (typeof loadCalendarPosts === 'function') await loadCalendarPosts(); } catch (e) {}
      await new Promise(x => setTimeout(x, 800));
      const p = (calState.posts || []).find(x => x.id === a.pid);
      if (p) { if (!a.predSrc) return { found: true }; try { const f = eval('(' + a.predSrc + ')'); if (f(p)) return { found: true, post: { status: p.status, video_status: p.video_status, caption_status: p.caption_status, title_status: p.title_status } }; } catch (e) {} }
    }
    return { found: false };
  }, { pid, predSrc: pred ? pred.toString() : null });
}

// tiny assert harness
function makeOk(label) { const s = { pass: 0, fail: 0, label: label || '' };
  s.ok = (c, m) => { if (c) s.pass++; else s.fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); return c; };
  s.done = () => { console.log((s.label ? s.label + ': ' : '') + 'pass=' + s.pass + ' fail=' + s.fail, s.fail ? '❌' : '✅'); return s.fail ? 1 : 0; };
  return s; }

// ---- generic component helpers (any of video/graphic/caption/title) ----
const TWEAKS_FIELD = { video: 'video_tweaks', graphic: 'graphic_tweaks', caption: 'caption_tweaks', title: 'title_tweaks' };

// SMM resolves the newest unresolved tweak on `comp` and routes it onward (the upsert
// the SMM resolve control performs). dest: 'Kasper Approval' | 'Client Approval'.
async function smmResolveTweak(pid, comp, dest) {
  const field = TWEAKS_FIELD[comp];
  const r = await rawRow(pid, field + (comp === 'video' ? ',tweaks' : ''));
  let tweaks = [];
  try { tweaks = JSON.parse(r[field] || '[]'); } catch (e) {}
  for (let i = tweaks.length - 1; i >= 0; i--) {
    const t = tweaks[i];
    if (t && t.is_tweak && !t.done && !t.deleted) { t.done = true; t.done_at = new Date().toISOString(); t.updated_at = t.done_at; break; }
  }
  const patch = { id: pid, [comp + '_status']: dest, [field]: JSON.stringify(tweaks) };
  if (comp === 'video') patch.tweaks = JSON.stringify(tweaks); // keep legacy mirror in sync
  return up(patch);
}

// client review actions (real handlers, client page)
async function clientApprove(cli, pid, comp) {
  return cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return 'NO_POST';
    try { _calReviewApprove(a.pid, a.comp); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid, comp });
}
async function clientRequest(cli, pid, comp, body) {
  return cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return 'NO_POST';
    _calReviewState.drafts[a.pid + '|' + a.comp] = a.body || ('Client: tweak ' + a.comp);
    try { _calReviewRequestTweak(a.pid, a.comp); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid, comp, body });
}
// app-computed overall status on whichever page (Kasper item or client/SMM post)
async function overallOn(page, pid, where /* 'kasper'|'cal' */) {
  return page.evaluate((a) => {
    let post = null;
    if (a.where === 'kasper') { const it = (_kasperState.items || []).find(x => x.post.id === a.pid); post = it ? it.post : null; }
    else { post = (calState.posts || []).find(x => x.id === a.pid) || null; }
    if (!post) return 'NO_POST';
    try { return computeOverallStatus(post); } catch (e) { return 'ERR ' + e.message; }
  }, { pid, where });
}
// what the client surface shows for a component: is it an active review component (awaiting client)?
async function clientCompActive(cli, pid, comp) {
  return cli.evaluate((a) => {
    const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return 'NO_POST';
    try { return !!_calReviewComponentActive(p, a.comp, 'client'); } catch (e) { return 'ERR ' + e.message; }
  }, { pid, comp });
}

module.exports = Object.assign({}, G, {
  up, rawRow, pollRaw, capture, smmPage, clientPage, kasperPage, waitForPost, makeOk,
  smmResolveTweak, clientApprove, clientRequest, overallOn, clientCompActive,
  stubRerouteFlagProduction,
  ORIGIN, UPSERT, SUPA, KEY,
  TEST_CLIENT, currentTestClientToken, gotoTestClientEntry, launch: G.launch,
});
