// sxr_a3_resolve_route_chooser.js — the SMM resolve chooser, driven through the
// REAL #sxrResolveDestOverlay. For each round we create an open Kasper tweak on
// the video component (flips it to Tweaks Needed), open the resolver via
// _sxrResolveLastTweak, then CLICK one of the overlay route buttons and read the
// live row back:
//   • route "Kasper"   → Kasper Approval (records kasper_seen)
//   • route "Client"   → Client Approval
//   • route "Approved" → Approved
//   • route "Stay"     → status unchanged (Tweaks Needed) but the tweak is done
// Also asserts the recommended (primary) route is "Client" once the component has
// been to Kasper, and that each resolve marks the change-request done (0 open).
//
// Scoped to sidneylaruel; unique sr_a3_* id; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
async function waitRow(id, pred, ms = 22000) { return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id); }
const norm = (s) => String(s == null ? '' : s).trim();
async function cardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate((id) => !!document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`), id)) return true;
    await page.waitForTimeout(900);
  }
  return false;
}
// Create a Kasper tweak on `comp` (flips it to Tweaks Needed) via the real handler.
async function makeTweak(page, id, comp, body) {
  return await page.evaluate(({ id, comp, body }) => _sxrKasperRequestTweakComp(id, comp, body), { id, comp, body });
}
// Open the resolver on the LAST open tweak; return recommend + which route is primary.
async function openResolver(page, id, comp) {
  return await page.evaluate(({ id, comp }) => {
    const sample = _sxrFind(id);
    const open = _sxrOpenTweaksForComp(sample, comp);
    const rootId = open && open[0] ? open[0].id : null;
    const recommend = _sxrResolveDestRecommend(sample, comp);
    if (rootId) _sxrResolveLastTweak(id, comp, rootId);
    const overlay = document.getElementById('sxrResolveDestOverlay');
    const primary = ['Kasper', 'Client', 'Approve'].find(k => {
      const b = document.getElementById('sxrResolveDest' + k);
      return b && b.classList.contains('primary');
    });
    return { active: !!(overlay && overlay.classList.contains('active')), recommend, primary, openCount: open.length, rootId };
  }, { id, comp });
}
async function clickRoute(page, key) { // key: 'Kasper' | 'Client' | 'Approve' | 'Stay'
  return await page.evaluate((key) => {
    const b = document.getElementById('sxrResolveDest' + key);
    if (!b) return false;
    b.click();
    return true;
  }, key);
}
function openTweakCount(id, comp) {
  const r = rowOf(id); if (!r) return -1;
  try {
    const raw = r[comp + '_tweaks']; if (!raw) return 0;
    const arr = JSON.parse(raw);
    return arr.filter(c => c && !c.parent_id && !c.deleted && !c.done && (c.is_tweak !== false)).length;
  } catch { return -1; }
}

(async () => {
  const id = 'sr_a3_' + Date.now();
  const ts = new Date().toISOString();
  const seed = Q.up({
    id, name: 'A3 resolve chooser', order_index: '1',
    asset_url: 'https://example.com/a3.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', created_at: ts,
  });
  ok(seed && seed.ok === true, 'seed live sample (video Kasper Approval)', JSON.stringify(seed).slice(0, 140));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, id), 'SMM card rendered', String(true));

    // Each round: create the tweak → POLL the live DB until it actually reads
    // Tweaks Needed with an open change-request (so the resolver acts on a
    // settled row), then open the resolver and click a route.
    async function round(n, route, expect, body) {
      await makeTweak(page, id, 'video', body);
      const seeded = await waitRow(id, x => norm(x.video_status) === 'Tweaks Needed' && openTweakCount(id, 'video') >= 1);
      ok(seeded && norm(seeded.video_status) === 'Tweaks Needed', `round ${n}: tweak created → Tweaks Needed (live)`, seeded && seeded.video_status);
      const o = await openResolver(page, id, 'video');
      ok(o.active, `round ${n}: resolve chooser overlay opened`, o);
      if (n === 1) ok(o.recommend === 'client' && o.primary === 'Client', 'recommended route = Client (already seen by Kasper)', o);
      ok(await clickRoute(page, route), `round ${n}: clicked route "${route}"`, true);
      const r = await waitRow(id, x => openTweakCount(id, 'video') === 0 && (expect == null || norm(x.video_status) === expect));
      ok(openTweakCount(id, 'video') === 0, `round ${n}: tweak marked done (0 open)`, openTweakCount(id, 'video'));
      return r;
    }

    // Route "Kasper" → Kasper Approval (records kasper_seen).
    let r = await round(1, 'Kasper', 'Kasper Approval', 'r1: please brighten');
    ok(r && norm(r.video_status) === 'Kasper Approval', 'route Kasper → video Kasper Approval (live)', r && r.video_status);
    ok(r && String(r.kasper_seen || '').includes('video'), 'route Kasper records kasper_seen=video', r && r.kasper_seen);

    // Route "Client" → Client Approval.
    r = await round(2, 'Client', 'Client Approval', 'r2: tighten copy');
    ok(r && norm(r.video_status) === 'Client Approval', 'route Client → video Client Approval (live)', r && r.video_status);

    // Route "Approved" → Approved.
    r = await round(3, 'Approve', 'Approved', 'r3: final nit');
    ok(r && norm(r.video_status) === 'Approved', 'route Approved → video Approved (live)', r && r.video_status);

    // Route "Stay" → status unchanged (stays Tweaks Needed), tweak still done.
    r = await round(4, 'Stay', null, 'r4: just a note');
    ok(r && norm(r.video_status) === 'Tweaks Needed', 'route Stay leaves status at Tweaks Needed', r && r.video_status);

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));
  } finally {
    // Close the browser BEFORE archiving so no trailing debounced flush can
    // re-save the row after the archive; then verify the archive stuck.
    try { await browser.close(); } catch {}
    Q.archiveSafe(id);
  }
  console.log(`PROBE sxr_a3_resolve_route_chooser: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
