// p87 — Kasper "Finish reviewing" survives a STALE auto-refresh (browser-driven).
//
// Drives the REAL app in headless Chromium (the real _kasperDismiss /
// _kasperLoadReview / _kasperPartitionItems / _kasperIsFinished handlers, the
// real rendered queue DOM) and proves the fix for the bug Kasper reported: a
// card he'd just finished popping back into "Waiting for your review" after the
// page auto-refreshed — "and not always the three components".
//
// WHY THIS IS HERMETIC (no live test-client writes). The bug is a TIMING RACE:
// an auto-refresh that ingests a server snapshot from BEFORE Kasper's decision/
// finish propagated. You cannot trigger that race on demand against the live
// backend. So this probe intercepts the calendar read (Supabase REST) and the
// upsert, letting us present the app with an exact stale snapshot at the moment
// of refresh. Everything the app DOES is real; only what the network RETURNS is
// scripted. No row is written to the live `sidneylaruel` data, so there is
// nothing to clean up.
//
// ARC (all observed in the real rendered queue):
//   0. load        → card renders under "Waiting for your review"
//   1. Finish      → real _kasperDismiss → card moves to "Tweaks pending"
//   2. STALE       → refresh returns video back at Kasper Approval, NO finish
//                    stamp, updated_at bumped past Kasper's (defeats local-prefer,
//                    so the stale row really replaces local state) → card MUST
//                    STAY in "Tweaks pending". This is the fix.
//   3. RE-ROUTE    → refresh returns video at Kasper Approval but WITH the finish
//                    stamp (a genuine SMM hand-back) → card MUST return to
//                    "Waiting". Proves the fix didn't just disable the feature.
const Q = require('./lib.js');
const { clientEntrySafeChildEnv } = require('../test-client-entry.js');
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const ORIGIN = Q.ORIGIN;
const PID = 'p_stale_' + Math.floor(Date.now() / 1000);
const STAMP = new Date(Date.now() - 3600 * 1000).toISOString();      // the tweak was created an hour ago
const future = (min) => new Date(Date.now() + min * 60000).toISOString();

function tweak(done) {
  return { id: 'tw1', role: 'kasper', author: 'Kasper', is_tweak: true, audience: 'internal',
           body: 'recut the open', created_at: STAMP, updated_at: done ? future(1) : STAMP,
           done: !!done, deleted: false };
}
// Base: a fully-decided hand-off card — caption approved (Client Approval), video
// change-requested (Tweaks Needed + an open Kasper tweak), graphic approved. No
// component at Kasper Approval, so Finish is allowed.
function rowDecided() {
  return {
    id: PID, client: 'sidneylaruel', name: 'STALE-REFRESH ' + PID.slice(-5),
    platforms: 'instagram', scheduled_date: '2026-06-29',
    asset_url: 'https://example.com/g.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    status: 'Tweaks Needed', video_status: 'Tweaks Needed', graphic_status: 'Approved',
    caption_status: 'Client Approval', graphic_linear_issue_id: '',
    kasper_finished_at: '', kasper_closed_at: '', updated_at: future(0),
    video_tweaks: JSON.stringify([tweak(false)]), graphic_tweaks: '[]', caption_tweaks: '[]',
  };
}
// Phase 2: the pre-decision read the store hasn't caught up on — video back at
// Kasper Approval, no tweak, NO finish stamp, updated_at newer than Kasper's
// finish (so local-prefer can't mask it).
function rowStale() {
  const r = rowDecided();
  r.status = 'Kasper Approval'; r.video_status = 'Kasper Approval';
  r.video_tweaks = '[]'; r.kasper_finished_at = ''; r.updated_at = future(5);
  return r;
}
// Phase 3: a GENUINE SMM hand-back — video at Kasper Approval but the finish
// stamp is present (server-confirmed), tweak resolved. Must re-surface.
function rowReroute() {
  const r = rowDecided();
  r.status = 'Kasper Approval'; r.video_status = 'Kasper Approval';
  r.video_tweaks = JSON.stringify([tweak(true)]); r.kasper_finished_at = STAMP; r.updated_at = future(10);
  return r;
}

let serverRows = [rowDecided()];   // mutated between phases; the route reads it live

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const jsonFulfill = (route, obj) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) });
};

async function section(page, pid) {
  return page.evaluate((pid) => {
    const sel = window.CSS && CSS.escape ? CSS.escape(pid) : pid;
    const el = document.querySelector('.kcard[data-kasper-pid="' + sel + '"]');
    if (!el) return 'absent';
    if (el.closest('#kasperTweaksWrap')) return 'tweaks';
    if (el.closest('#kasperWaitingWrap')) return 'waiting';
    return 'other';
  }, pid);
}
const refresh = (page) => page.evaluate(async () => { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(r => setTimeout(r, 300)); });

(async () => {
  const S = Q.makeOk('P87 kasper finish — stale auto-refresh holds');
  const browser = await PW.chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
    env: clientEntrySafeChildEnv(),
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagDark(ctx);  // keep the TEST client on the legacy lane real clients run (see lib.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  // Scripted backend: SMM sheet (empty), upsert (echo, no live write), calendar read (our rows).
  await ctx.route('**docs.google.com/spreadsheets/**', route =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, contentType: 'text/csv', headers: CORS, body: 'client_name,social_media_manager\n' }));
  await ctx.route('**/webhook/calendar-upsert-post', route => {
    let post = {}; try { post = (JSON.parse(route.request().postData() || '{}').post) || {}; } catch (e) {}
    return jsonFulfill(route, { ok: true, post });
  });
  await ctx.route('**/rest/v1/calendar_posts**', route => jsonFulfill(route, serverRows));

  const page = await ctx.newPage();
  Q.capture(page);
  try {
    await page.goto(ORIGIN + '/index.html?Kasper=1&v2debug=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction((pid) => typeof _kasperState !== 'undefined'
      && (_kasperState.items || []).some(x => x.post.id === pid), PID, { timeout: 25000 });
    await page.waitForTimeout(500);

    // 0 — starts in Waiting
    S.ok(await section(page, PID) === 'waiting', '0) card loads under "Waiting for your review"');

    // 1 — Finish (real handler) → Tweaks pending
    const fin = await page.evaluate(async (pid) => { try { await _kasperDismiss(pid); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, PID);
    S.ok(fin === 'ok', '1) finish-reviewing ran (' + fin + ')');
    await page.waitForTimeout(600);
    S.ok(await section(page, PID) === 'tweaks', '1) after Finish, card is in "Tweaks pending"');
    const st1 = await page.evaluate((pid) => !!(_kasperState.dismissed && _kasperState.dismissed[pid]), PID);
    S.ok(st1 === true, '1) same-device finished flag is set');

    // 2 — STALE auto-refresh must NOT pop it back
    serverRows = [rowStale()];
    await refresh(page);
    await page.waitForTimeout(400);
    const ingested = await page.evaluate((pid) => { const it = (_kasperState.items || []).find(x => x.post.id === pid); return it ? { vs: it.post.video_status, stamp: String(it.post.kasper_finished_at || '') } : null; }, PID);
    S.ok(ingested && ingested.vs === 'Kasper Approval' && ingested.stamp === '',
      '2) stale snapshot really replaced local state (video=Kasper Approval, no stamp) — so the FIX, not local-prefer, is what holds it');
    S.ok(await section(page, PID) === 'tweaks',
      '2) STALE auto-refresh → card STAYS in "Tweaks pending" (the bug is fixed)');

    // 3 — GENUINE re-route (stamp present) still re-surfaces
    serverRows = [rowReroute()];
    await refresh(page);
    await page.waitForTimeout(400);
    S.ok(await section(page, PID) === 'waiting',
      '3) GENUINE re-route (Kasper Approval WITH finish stamp) → card correctly returns to "Waiting"');

    S.ok(page._errs.length === 0, 'no JS errors (' + JSON.stringify(page._errs.slice(0, 3)) + ')');
  } finally {
    await browser.close();
  }
  process.exit(S.done());
})();
