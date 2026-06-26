// sxr_a2_stale_clear_and_idempotent.js — two lifecycle invariants:
//
//  (1) STALE-APPROVAL CLEARING: when a component drops below Client Approval via
//      the SMM pill, its client_<comp>_approved_at is cleared; kasper_approved_at
//      is cleared only once NOTHING is at/above Client Approval. Driven through
//      the real pill menu, read back from live Supabase.
//
//  (2) SAME-TICK DOUBLE-APPROVE IDEMPOTENCY: two synchronous _sxrKasperApproveComp
//      calls on the same (pid|comp) collapse to ONE effect (the in-flight guard);
//      the second returns null and the row transitions exactly once.
//
// Scoped to sidneylaruel; unique sr_a2_* ids; archived on exit; 0 app JS errors.
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
async function pickStatus(page, id, comp, status) {
  await page.evaluate(({ id, comp }) => {
    const btn = document.querySelector(`.sxr-card[data-sxr-id="${id}"] .sxr-pill-btn[data-sxr-comp-pill="${comp}"]`);
    if (btn) btn.click();
  }, { id, comp });
  await page.waitForTimeout(180);
  return await page.evaluate((status) => {
    const menu = document.querySelector('.cal-fld-status-menu');
    if (!menu) return { ok: false, reason: 'no menu' };
    const opt = Array.from(menu.querySelectorAll('.cal-fld-status-item')).find(b => b.textContent.trim() === status);
    if (!opt) return { ok: false, reason: 'no opt' };
    opt.click();
    return { ok: true };
  }, status);
}

(async () => {
  const stamp = Date.now();
  const idStale = 'sr_a2_stale_' + stamp;
  const idConc = 'sr_a2_conc_' + stamp;
  const ts = new Date().toISOString();
  const approvedAt = new Date(Date.now() - 60000).toISOString();

  // (1) seed: both comps Approved with client stamps + a kasper_approved_at stamp.
  const s1 = Q.up({
    id: idStale, name: 'A2 stale clear', order_index: '1',
    asset_url: 'https://example.com/a2.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    video_status: 'Approved', graphic_status: 'Approved', status: 'Approved',
    client_video_approved_at: approvedAt, client_graphic_approved_at: approvedAt,
    kasper_approved_at: approvedAt, kasper_approved_by: 'Kasper', created_at: ts,
  });
  // (2) seed: video at Kasper Approval (ready for the double-approve idempotency test).
  const s2 = Q.up({
    id: idConc, name: 'A2 idempotent', order_index: '2',
    asset_url: 'https://example.com/a2c.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', created_at: ts,
  });
  ok(s1 && s1.ok === true && s2 && s2.ok === true, 'seed 2 live samples', { stale: s1 && s1.ok, conc: s2 && s2.ok });

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, idStale), 'stale card rendered', String(true));
    ok(await cardReady(page, idConc), 'concurrency card rendered', String(true));

    // Confirm the seed actually loaded the stamps into the in-memory row.
    const seeded = rowOf(idStale);
    ok(seeded && seeded.client_video_approved_at && seeded.kasper_approved_at, 'seed carries client + kasper stamps', { cv: !!seeded.client_video_approved_at, k: !!seeded.kasper_approved_at });

    // ── (1a) drop VIDEO below Client Approval → clears client_video_approved_at;
    //         kasper_approved_at stays (graphic still Approved, i.e. at/above). ──
    const p1 = await pickStatus(page, idStale, 'video', 'Kasper Approval');
    ok(p1.ok, 'pill: video → Kasper Approval (drop below Client Approval)', p1);
    const r1 = await waitRow(idStale, x => norm(x.video_status) === 'Kasper Approval' && !norm(x.client_video_approved_at));
    ok(r1 && !norm(r1.client_video_approved_at), 'client_video_approved_at CLEARED on drop below Client Approval', r1 && r1.client_video_approved_at);
    ok(r1 && norm(r1.kasper_approved_at) === norm(approvedAt), 'kasper_approved_at KEPT (graphic still Approved ≥ Client Approval)', r1 && r1.kasper_approved_at);
    ok(r1 && norm(r1.client_graphic_approved_at) === norm(approvedAt), 'client_graphic_approved_at untouched (graphic still Approved)', r1 && r1.client_graphic_approved_at);

    // ── (1b) drop GRAPHIC below Client Approval → clears client_graphic_approved_at
    //         AND now kasper_approved_at clears (nothing at/above Client Approval). ──
    const p2 = await pickStatus(page, idStale, 'graphic', 'In Progress');
    ok(p2.ok, 'pill: graphic → In Progress (now nothing ≥ Client Approval)', p2);
    const r2 = await waitRow(idStale, x => norm(x.graphic_status) === 'In Progress' && !norm(x.kasper_approved_at));
    ok(r2 && !norm(r2.client_graphic_approved_at), 'client_graphic_approved_at CLEARED', r2 && r2.client_graphic_approved_at);
    ok(r2 && !norm(r2.kasper_approved_at), 'kasper_approved_at CLEARED (nothing ≥ Client Approval)', r2 && r2.kasper_approved_at);

    // ── (2) same-tick double-approve collapses to one effect ──
    const res = await page.evaluate((id) => {
      const a = _sxrKasperApproveComp(id, 'video');   // first: returns a snapshot object
      const b = _sxrKasperApproveComp(id, 'video');   // same tick: in-flight guard → null
      return { aIsSnapshot: !!(a && typeof a === 'object'), b: b };
    }, idConc);
    ok(res.aIsSnapshot === true, 'first approve returns a snapshot (effect applied)', res);
    ok(res.b === null, 'second same-tick approve returns null (no double effect)', res);
    const rc = await waitRow(idConc, x => norm(x.video_status) === 'Client Approval');
    ok(rc && norm(rc.video_status) === 'Client Approval', 'video transitioned to Client Approval exactly once', rc && rc.video_status);

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));
  } finally {
    Q.up({ id: idStale, status: 'Archived' });
    Q.up({ id: idConc, status: 'Archived' });
    await browser.close();
  }
  console.log(`PROBE sxr_a2_stale_clear_and_idempotent: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
