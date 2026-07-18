// ot4_t0_client_saves_reliability.js — TIER 0: "a client whose approval
// silently vanishes is our worst-case bug." Proves client review writes land
// in the backend EVERY time, three ways, all through REAL clicks on the
// samples client share surface:
//   A) 3 sequential approvals, each polled to the DB before the next click;
//   B) 3 rapid typed request-changes fired ~1s apart with NO waiting between
//      clicks (a client zipping through their queue) — then all 3 verified;
//   C) same-tick DOUBLE-CLICK on one approve → exactly ONE status change and
//      exactly ONE audit event (the saving-guard dedupes);
//   D) audit-event count == 1 for every acted component (no dup, no gap).
'use strict';
const H = require('./ot4_lib.js');
const { launch, client, up, supaEvents, archiveSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const N = 6;
const ids = [], names = [];
for (let i = 0; i < N; i++) { ids.push(`sr_ot4r_${TS}_${i}`); names.push(`OT4 Rel ${i} ${TS}`); }
const POLL = 35000;

(async () => {
  const browser = await launch();
  try {
    for (let i = 0; i < N; i++) {
      up({ id: ids[i], name: names[i], order_index: i + 1,
        video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval',
        thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
    }
    await H.pollRow(() => H.rowSxr(ids[N - 1], 'id,status'), r => r.status === 'Client Approval');

    const p = await client(browser);

    // A) sequential approvals — every single one must land before the next.
    let landedA = 0;
    for (let i = 0; i < 3; i++) {
      const c0 = Date.now();
      const r = await H.clientAct(p, names[i], 'video', 'approve');
      if (r !== 'ok') { t(false, `A: approve click ${i} → ${r}`); continue; }
      const row = await H.pollRow(() => H.rowSxr(ids[i], 'video_status'), x => x.video_status === 'Approved', POLL);
      const okA = !!row && row.video_status === 'Approved';
      if (okA) landedA++;
      console.log(`   A${i}: approve landed=${okA} in ${((Date.now() - c0) / 1000).toFixed(1)}s`);
    }
    t(landedA === 3, `A: 3/3 sequential approvals landed (got ${landedA})`);

    // B) rapid burst — click through 3 request-changes without waiting.
    for (let i = 3; i < 6; i++) {
      const r = await H.clientAct(p, names[i], 'video', 'request', `OT4 rapid req ${i} ${TS}`);
      t(r === 'ok', `B: rapid request click ${i}`, r);
      await H.sleep(900);
    }
    let landedB = 0;
    for (let i = 3; i < 6; i++) {
      const row = await H.pollRow(() => H.rowSxr(ids[i], 'video_status,video_tweaks'), x => x.video_status === 'Tweaks Needed', POLL);
      const okB = !!row && row.video_status === 'Tweaks Needed' && JSON.stringify(row.video_tweaks || '').includes(`OT4 rapid req ${i}`);
      if (okB) landedB++; else console.log(`   B${i}: MISSING → ${JSON.stringify(row).slice(0, 160)}`);
    }
    t(landedB === 3, `B: 3/3 rapid request-changes landed with their typed text (got ${landedB})`);

    // C) same-tick double-click on card 1's graphic approve.
    const dbl = await p.evaluate((n) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      const b = card && card.querySelector('.cal-review-panel[data-comp="graphic"] .cal-review-approve-btn');
      if (!b || b.disabled) return 'no-btn';
      b.click(); b.click(); return 'ok';
    }, names[1]);
    t(dbl === 'ok', 'C: same-tick double-click fired', dbl);
    const rowC = await H.pollRow(() => H.rowSxr(ids[1], 'graphic_status'), x => x.graphic_status === 'Approved', POLL);
    t(!!rowC && rowC.graphic_status === 'Approved', 'C: double-clicked approve landed once as Approved');

    // D) audit-event exactness: every acted component has exactly ONE event.
    await H.sleep(4000);
    const expect = [];
    for (let i = 0; i < 3; i++) expect.push([ids[i], 'video', 'Approved']);
    for (let i = 3; i < 6; i++) expect.push([ids[i], 'video', 'Tweaks Needed']);
    expect.push([ids[1], 'graphic', 'Approved']);
    let exact = 0;
    for (const [id, comp, to] of expect) {
      const evs = await H.pollRow(
        () => supaEvents(`sample_id=eq.${id}&component=eq.${comp}&action=eq.status_change&select=to_status`),
        e => Array.isArray(e) && e.length >= 1, 15000);
      // The SEED write logs its own `→ Client Approval` event — expected. The
      // dedupe/loss proof is: exactly ONE event for the ACTED status.
      const hits = (Array.isArray(evs) ? evs : []).filter(e => e.to_status === to);
      if (hits.length === 1) exact++;
      else console.log(`   D ${id}/${comp}: events=${JSON.stringify(evs).slice(0, 120)}`);
    }
    t(exact === expect.length, `D: exactly one audit event per action (${exact}/${expect.length})`);

    t(appErrs(p).length === 0, '0 app JS errors', (appErrs(p)[0] || ''));
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    let clean = true;
    for (const id of ids) if (!archiveSafe(id)) clean = false;
    t(clean, 'cleanup: all 6 seeds archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
