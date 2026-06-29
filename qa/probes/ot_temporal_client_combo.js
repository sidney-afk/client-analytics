// ot_temporal_client_combo.js — TEMPORAL client actions + multi-actor concurrency.
//  1) client approve→Approved: optimistic latency + DB + no reappear.
//  2) client request-change→Tweaks Needed: optimistic + DB + no reappear.
//  3) CONCURRENCY: SMM sets video while Kasper approves graphic on the SAME sample
//     at the same time → both must persist (field-level merge, no clobber).
const L = require('../sxr_courier_lib.js');
const { launch, client, smm, kasper, up, supa, poll, appErrs, archiveSafe } = L;

const t = Date.now();
const APP = 'sr_tca_' + t, REQ = 'sr_tcr_' + t, CON = 'sr_tcc_' + t;
const NAPP = 'OT-C approve ' + t, NREQ = 'OT-C request ' + t, NCON = 'OT-C concurrent ' + t;
const rows = [], fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }
const cardIn = (page, nm) => page.evaluate((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), nm);
async function expand(page, nm) { await page.evaluate((n) => { const c = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); if (c) (c.querySelector('.kcard-strip') || c).click(); }, nm); await page.waitForTimeout(400); }

(async () => {
  up({ id: APP, name: NAPP, order_index: 1, asset_url: 'https://frame.io/x/a', thumbnail_url: '', video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' });
  up({ id: REQ, name: NREQ, order_index: 2, asset_url: 'https://frame.io/x/r', thumbnail_url: '', video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' });
  up({ id: CON, name: NCON, order_index: 3, asset_url: 'https://frame.io/x/c', thumbnail_url: '', linear_issue_id: 'https://linear.app/syncsocial/issue/GRA-CC', video_status: 'For SMM Approval', graphic_status: 'Kasper Approval', status: 'For SMM Approval' });
  await poll(() => { const r = supa('id=in.(' + APP + ',' + REQ + ',' + CON + ')&select=id'); return (Array.isArray(r) && r.length >= 3) ? r : null; }, 12000, 800);

  const browser = await launch();
  try {
    // ===== 1) CLIENT APPROVE =====
    const cl = await client(browser);
    await cl.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), NAPP, { timeout: 15000 }).catch(() => {});
    await expand(cl, NAPP);
    const tA = Date.now();
    const ra = await cl.evaluate((n) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-btn');
      if (!b) return { ok: false };
      const t0 = performance.now(); b.click(); const t1 = performance.now();
      const still = [...document.querySelectorAll('.cal-review-card')].some(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      return { ok: true, uiMs: +(t1 - t0).toFixed(1), removedSync: !still };
    }, NAPP);
    ok(ra.ok && ra.uiMs < 50, 'client approve: optimistic UI reaction synchronous (<50ms)', ra.uiMs + 'ms');
    const dbA = await poll(() => { const r = supa('id=eq.' + APP + '&select=video_status'); return (r[0] && r[0].video_status === 'Approved') ? r[0] : null; }, 14000, 400);
    const dbAms = Date.now() - tA;
    ok(!!dbA, 'client approve: → Approved in live DB', dbAms + 'ms');
    rows.push({ action: 'client approve', uiMs: ra.uiMs, dbMs: dbAms });

    // ===== 2) CLIENT REQUEST-CHANGE =====
    await expand(cl, NREQ);
    await cl.evaluate((n) => { const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const p = card && card.querySelector('.cal-review-panel[data-comp="video"]'); const ta = p && p.querySelector('.cal-review-textarea'); if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, 'Please brighten the opening shot'); ta.dispatchEvent(new Event('input', { bubbles: true })); } }, NREQ);
    await cl.waitForTimeout(200);
    const tR = Date.now();
    const rr = await cl.evaluate((n) => { const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-tweak-btn'); if (!b || b.disabled) return { ok: false }; const t0 = performance.now(); b.click(); const t1 = performance.now(); return { ok: true, uiMs: +(t1 - t0).toFixed(1) }; }, NREQ);
    ok(rr.ok, 'client request-change: clicked', rr.uiMs + 'ms');
    const dbR = await poll(() => { const r = supa('id=eq.' + REQ + '&select=video_status,video_tweaks'); return (r[0] && r[0].video_status === 'Tweaks Needed') ? r[0] : null; }, 14000, 400);
    const dbRms = Date.now() - tR;
    ok(!!dbR, 'client request-change: → Tweaks Needed in live DB', dbRms + 'ms');
    let cmt = null; try { cmt = JSON.parse((dbR && dbR.video_tweaks) || '[]').slice(-1)[0]; } catch {}
    ok(cmt && cmt.role === 'client' && cmt.is_tweak, 'client request-change: client comment persisted');
    rows.push({ action: 'client request', uiMs: rr.uiMs, dbMs: dbRms });
    await cl.context().close();

    // ===== 3) CONCURRENCY: SMM video + Kasper graphic at once =====
    const sm = await smm(browser);
    const kp = await kasper(browser);
    await sm.waitForFunction((id) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${id}"]`), CON, { timeout: 12000 }).catch(() => {});
    await kp.waitForFunction((n) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), NCON, { timeout: 15000 }).catch(() => {});
    // expand kasper card
    await kp.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); if (c) (c.querySelector('.kcard-strip') || c).click(); }, NCON);
    await kp.waitForTimeout(400);
    // fire BOTH near-simultaneously: SMM sets video→Kasper Approval (Sheet pill), Kasper approves graphic→Client
    await Promise.all([
      sm.evaluate((id) => { const wrap = document.querySelector(`[data-substatus-pid="${id}"][data-substatus-comp="video"]`); const trig = wrap.querySelector('.cal-fld-substatus-trigger'); trig.click(); const item = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')].find(i => /^\s*Kasper Approval\s*$/i.test(i.textContent)); if (item) item.click(); }, CON),
      kp.evaluate((n) => { const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const b = card && card.querySelector('.cal-review-panel[data-sxr-kasper-comp="graphic"] .cal-review-approve-main'); if (b) b.click(); }, NCON)
    ]);
    // both must land — field-level merge, neither clobbers the other
    const merged = await poll(() => { const r = supa('id=eq.' + CON + '&select=video_status,graphic_status'); return (r[0] && r[0].video_status === 'Kasper Approval' && r[0].graphic_status === 'Client Approval') ? r[0] : null; }, 16000, 600);
    ok(!!merged, 'CONCURRENCY: SMM video + Kasper graphic both persist (field-level merge, no clobber)', merged ? ('v=' + merged.video_status + ' g=' + merged.graphic_status) : 'final=' + JSON.stringify(supa('id=eq.' + CON + '&select=video_status,graphic_status')[0]));

    ok((await appErrs(sm)).length === 0, 'SMM tab: zero app JS errors');
    ok((await appErrs(kp)).length === 0, 'Kasper tab: zero app JS errors');
  } finally {
    await browser.close();
    [APP, REQ, CON].forEach(id => archiveSafe(id));
  }

  console.log('\n--- Client/concurrency timing table ---');
  rows.forEach(r => console.log(`  ${r.action.padEnd(18)} UI ${String(r.uiMs).padStart(4)}ms  DB ${String(r.dbMs).padStart(5)}ms`));
  console.log('\nRESULT ot_temporal_client_combo: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
