// Shared harness for the golden-path interaction probes.
//
// Design (see docs/testing/CALENDAR-TEST-CATALOG.md §10.5):
//   - Kasper actions  -> real Kasper handlers on a live Kasper page.
//   - Client actions  -> real _calReview* handlers on a live client page (client mode).
//   - SMM status moves-> the upsert webhook (the exact write the SMM status control
//                        performs; the SMM Review tab routes via the same status field).
//   - Assertions      -> Supabase backend row (the source of truth every surface
//                        renders from) polled after each step, + Kasper-queue membership.
//
// Scope: ONLY the `sidneylaruel` test client. Every probe archives its card at the end.
//
// We drive ONE component (caption — no Linear dependency) through the lifecycle and
// pin video/graphic to 'Approved' so the overall status (lower-wins) tracks caption.
// Playwright: use the locally-installed module in CI; fall back to the
// container's global path for ad-hoc local runs.
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
const ORIGIN = 'http://localhost:8000';
const UPSERT = 'https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post';
const SUPA   = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts';
const KEY    = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';

const up = (post) => fetch(UPSERT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client: 'sidneylaruel', post, comments_base_at: '' }) }).then(r => r.json());

const SEL = 'caption_status,video_status,graphic_status,status,caption_tweaks,kasper_approved_after_tweaks';
const row = async (pid, sel = SEL) =>
  (await (await fetch(`${SUPA}?id=eq.${pid}&select=${sel}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json())[0] || {};
const pollRow = async (pid, pred, ms = 18000) => { const t = Date.now(); let r;
  while (Date.now() - t < ms) { r = await row(pid); if (pred(r)) return r; await new Promise(x => setTimeout(x, 700)); } return r; };

// ---- browser / surfaces ----
async function launch() { return await PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] }); }
function capture(page) {
  page._errs = [];
  page.on('console', m => { if (m.type() === 'error') { const t = m.text();
    // "Failed to load resource" = a network 503/404 (e.g. the placeholder image host),
    // not a JS exception. Only real script errors should fail a probe.
    if (!/Failed to load resource/i.test(t)) page._errs.push('[console.error] ' + t); } });
  page.on('pageerror', e => page._errs.push('[pageerror] ' + (e && e.message)));
  page.on('requestfailed', r => { const u = r.url(); if (/synchrosocial|supabase/.test(u)) page._errs.push('[reqfail] ' + u); });
}
async function _ctx(browser) {
  const c = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  await c.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  // write_ui_reroute_clients → DARK for the harness: the TEST client is the
  // sole allowlist member, so the live flag would put it on the #850 gateway
  // lane, which fails Linear-linkless harness cards closed before the source
  // save. Real clients run legacy; keep the stand-in faithful. Only this one
  // flag is stubbed. (Full rationale: qa/probes/lib.js; guard: p95.)
  await c.route(u => { const s = u.toString(); return s.includes('syncview_runtime_flags') && s.includes('write_ui_reroute_clients'); }, async (route) => {
    const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS', 'cache-control': 'no-store' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '[]' });
  });
  return c;
}
async function _open(browser, url) { const c = await _ctx(browser); const p = await c.newPage(); capture(p);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(700); return p; }
async function clientPage(browser) { const p = await _open(browser, `${ORIGIN}/index.html?c=Sidney%20Laruel&v=calendar&v2debug=1`); await p.waitForTimeout(5000); return p; }
async function kasperPage(browser) { const p = await _open(browser, `${ORIGIN}/index.html?Kasper=1&v2debug=1`); await p.waitForTimeout(8000); return p; }

// ---- seeds / SMM moves (upsert = the SMM status control's write) ----
async function seedCaptionCard(pid, captionStatus) {
  await up({ id: pid, name: 'GOLDEN ' + pid.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
    video_status: 'Approved', graphic_status: 'Approved', caption_status: captionStatus, status: 'In Progress',
    thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
}
async function smmSetCaption(pid, status, extra = {}) { return up(Object.assign({ id: pid, caption_status: status }, extra)); }
async function smmMarkPosted(pid) { return up({ id: pid, caption_status: 'Posted', video_status: 'Posted', graphic_status: 'Posted', status: 'Posted' }); }
async function archive(pid) { return up({ id: pid, status: 'Archived' }); }
// SMM resolves the newest unresolved caption tweak and routes the component onward.
async function smmResolveCaptionTweak(pid, dest /* 'Kasper Approval' | 'Client Approval' */) {
  const r = await row(pid, 'caption_tweaks'); let tweaks = [];
  try { tweaks = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
  for (let i = tweaks.length - 1; i >= 0; i--) {
    const t = tweaks[i];
    if (t && t.is_tweak && !t.done && !t.deleted) { t.done = true; t.done_at = new Date().toISOString(); t.updated_at = t.done_at; break; }
  }
  return up({ id: pid, caption_status: dest, caption_tweaks: JSON.stringify(tweaks) });
}

// ---- Kasper actions (real handlers) ----
async function kasperLoadHas(kas, pid) {
  return kas.evaluate(async (pid) => {
    for (let i = 0; i < 22; i++) { try { await _kasperLoadReview(true); } catch (e) {}
      await new Promise(x => setTimeout(x, 900));
      if ((_kasperState.items || []).some(x => x.post.id === pid)) return true; }
    return false;
  }, pid);
}
async function kasperApprove(kas, pid, comp = 'caption') {
  return kas.evaluate(async (a) => { try { await _kasperApproveComp(a.pid, a.comp, 'client'); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid, comp });
}
async function kasperRequest(kas, pid, comp = 'caption', body = 'Kasper: please tweak the caption') {
  return kas.evaluate(async (a) => {
    const it = (_kasperState.items || []).find(x => x.post.id === a.pid); if (!it) return 'NO_ITEM';
    it._drafts = it._drafts || {}; it._drafts[a.comp] = a.body;
    try { await _kasperRequestTweakComp(a.pid, a.comp, false); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
  }, { pid, comp, body });
}
async function kasperApproveAfterTweaks(kas, pid, comp = 'caption', body = 'Kasper: fix this then ship to client') {
  return kas.evaluate(async (a) => {
    const it = (_kasperState.items || []).find(x => x.post.id === a.pid); if (!it) return 'NO_ITEM';
    it._drafts = it._drafts || {}; it._drafts[a.comp] = a.body;
    try { await _kasperApproveAfterTweaksComp(a.pid, a.comp); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
  }, { pid, comp, body });
}

// Kasper "undo approve" is only reachable via the toast button (not a global), so
// drive it the way a human does: click the toast's Undo within its grace window.
async function kasperUndoViaToast(kas) {
  return kas.evaluate(() => { const b = document.querySelector('.sv-toast-action'); if (!b) return 'NO_TOAST'; b.click(); return 'clicked'; });
}
async function kasperGoneFromQueue(kas, pid) {
  return kas.evaluate(async (pid) => {
    for (let i = 0; i < 10; i++) { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 900)); }
    return !(_kasperState.items || []).some(x => x.post.id === pid);
  }, pid);
}

// ---- Client actions (real _calReview* handlers, client mode) ----
async function clientHasCaption(cli, pid, status) {
  return cli.evaluate(async (a) => {
    for (let i = 0; i < 22; i++) {
      try { if (typeof loadCalendarPosts === 'function') await loadCalendarPosts(); } catch (e) {}
      await new Promise(x => setTimeout(x, 900));
      const p = (calState.posts || []).find(x => x.id === a.pid);
      if (p && (!a.status || p.caption_status === a.status)) return true;
    }
    return false;
  }, { pid, status });
}
async function clientApproveCaption(cli, pid) {
  return cli.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); if (!p) return 'NO_POST';
    try { _calReviewApprove(pid, 'caption'); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, pid);
}
async function clientRequestCaption(cli, pid, body = 'Client: please change the caption') {
  return cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return 'NO_POST';
    _calReviewState.drafts[a.pid + '|caption'] = a.body;
    try { _calReviewRequestTweak(a.pid, 'caption'); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid, body });
}

// ---- tiny assert harness ----
function makeOk() { const s = { pass: 0, fail: 0 };
  s.ok = (c, m) => { if (c) s.pass++; else s.fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); return c; };
  return s; }

module.exports = {
  up, row, pollRow, launch, clientPage, kasperPage,
  seedCaptionCard, smmSetCaption, smmMarkPosted, archive, smmResolveCaptionTweak,
  kasperLoadHas, kasperApprove, kasperRequest, kasperApproveAfterTweaks,
  kasperUndoViaToast, kasperGoneFromQueue,
  clientHasCaption, clientApproveCaption, clientRequestCaption, makeOk,
};
