// sxr_kasper_audit_holes.js — REGRESSION guard for BUG-5 (fixed 2026-07-02;
// see OVERNIGHT_TEST_REPORT RUN 2). Flipped from characterization to assert the
// FIX: Kasper approve now STAMPS kasper_approved_at, and Kasper UNDO now PUSHES
// the reverted status to (mocked) Linear so the issue isn't left stale.
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, kasper, up, supa, archiveSafe, linearCalls, resetLinearCalls } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const row = (id, cols) => { const r = supa('id=eq.' + id + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; };

(async () => {
  const browser = await launch();
  const ts = Date.now();
  const id = 'sr_probe_audithole_' + ts;
  try {
    // asset_url is REQUIRED here since 2026-09-05: the review gate refuses to
    // approve a component with nothing to review, and this probe is about
    // approve/undo, not the gate. The gate has its own case at the bottom.
    up({ id, name: 'AUDIT hole ' + ts, order_index: 1, video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', asset_url: 'https://frame.io/probe/ah' + ts + '.mp4', linear_issue_id: 'https://linear.app/x/VID-AH' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-AH' + ts });
    await sleep(1500);
    resetLinearCalls();

    const kp = await kasper(browser);
    await kp.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
    await kp.waitForFunction((cid) => (typeof _sxrKasperFindItem === 'function') && !!_sxrKasperFindItem(cid), id, { timeout: 20000 });

    // approve → Client Approval, Linear push captured
    await kp.evaluate((cid) => { _sxrKasperApproveComp(cid, 'video'); }, id);
    let landed = false;
    for (let i = 0; i < 25 && !landed; i++) { const r = row(id, 'video_status'); landed = !!r && r.video_status === 'Client Approval'; if (!landed) await sleep(1000); }
    t(landed, 'kasper approve landed (Client Approval)');
    let pushed = false;
    for (let i = 0; i < 12 && !pushed; i++) { pushed = linearCalls().some(c => c.path === 'linear-set-status' && JSON.stringify(c.payload || {}).includes('Client Approval')); if (!pushed) await sleep(1000); }
    t(pushed, 'approve pushed Client Approval to the (mocked) Linear issue');

    // BUG-5a FIX: kasper_approved_at IS stamped by the samples approve
    let stamped = false;
    for (let i = 0; i < 15 && !stamped; i++) { const s = row(id, 'kasper_approved_at'); stamped = !!(s && String(s.kasper_approved_at || '').trim()); if (!stamped) await sleep(1000); }
    t(stamped, 'BUG-5a FIX: kasper_approved_at stamped by samples approve', stamped ? String((row(id, 'kasper_approved_at') || {}).kasper_approved_at).slice(0, 24) : 'still empty');

    // undo via the toast → status reverts…
    const undo = await kp.waitForFunction(() => !!document.querySelector('.sv-toast-action'), { timeout: 9000 })
      .then(() => kp.evaluate(() => { const b = document.querySelector('.sv-toast-action'); b.click(); return 'ok'; })).catch(() => 'no-toast');
    t(undo === 'ok', 'undo toast clicked', undo);
    let reverted = false;
    for (let i = 0; i < 25 && !reverted; i++) { const r = row(id, 'video_status'); reverted = !!r && r.video_status === 'Kasper Approval'; if (!reverted) await sleep(1000); }
    t(reverted, 'undo reverted the DB status to Kasper Approval');

    // …BUG-5b FIX: undo now pushes the reverted status to (mocked) Linear
    let revertPushed = false;
    for (let i = 0; i < 12 && !revertPushed; i++) { revertPushed = linearCalls().some(c => c.path === 'linear-set-status' && JSON.stringify(c.payload || {}).includes('"Kasper Approval"')); if (!revertPushed) await sleep(1000); }
    t(revertPushed, 'BUG-5b FIX: undo pushes the reverted status (Kasper Approval) to Linear', revertPushed ? '' : 'no revert push captured');

    // ── GATE (2026-09-05, PR 1278): approving a component with NO media ──────
    // The first draft of this guard wrote its reason to a store the samples
    // Kasper state never declared, threw a TypeError, and the Approve button
    // looked dead. This case asserts the refusal is OBSERVABLE, not just present:
    // the notice opens with the reason, the DB status does not move, and no
    // status push reaches Linear.
    const emptyId = 'sr_probe_audithole_empty_' + ts;
    up({ id: emptyId, name: 'AUDIT hole empty ' + ts, order_index: 2, video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', asset_url: '', thumbnail_url: '', linear_issue_id: 'https://linear.app/x/VID-AHE' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-AHE' + ts });
    await sleep(1500);
    resetLinearCalls();
    await kp.evaluate(() => { if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
    await kp.waitForFunction((cid) => (typeof _sxrKasperFindItem === 'function') && !!_sxrKasperFindItem(cid), emptyId, { timeout: 20000 });
    const refusal = await kp.evaluate((cid) => {
      let threw = '';
      try { _sxrKasperApproveComp(cid, 'video'); } catch (e) { threw = String(e && e.message || e); }
      const ov = document.getElementById('confirmOverlay');
      return {
        threw,
        open: !!(ov && ov.classList.contains('active')),
        title: String((document.getElementById('confirmTitle') || {}).textContent || ''),
        msg: String((document.getElementById('confirmMsg') || {}).textContent || ''),
      };
    }, emptyId);
    t(!refusal.threw, 'GATE: approving an empty component does not throw', refusal.threw);
    t(refusal.open && /nothing to review/i.test(refusal.title) && /video URL/i.test(refusal.msg),
      'GATE: the refusal is VISIBLE -- notice open, names the video', refusal.title + ' / ' + refusal.msg.slice(0, 60));
    await sleep(2500);
    const still = row(emptyId, 'video_status');
    t(!!still && still.video_status === 'Kasper Approval', 'GATE: the DB status did not move', still && still.video_status);
    t(!linearCalls().some(c => c.path === 'linear-set-status'), 'GATE: no status push reached Linear');
    try { await kp.evaluate(() => { if (typeof dismissConfirm === 'function') dismissConfirm(); }); } catch {}
    try { archiveSafe(emptyId); } catch {}
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { archiveSafe(id); } catch {}
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
