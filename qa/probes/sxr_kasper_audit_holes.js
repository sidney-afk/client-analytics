// sxr_kasper_audit_holes.js — BUG-5 characterization (see OVERNIGHT_TEST_REPORT
// RUN 2): samples Kasper approve never stamps kasper_approved_at (so the
// kasper_approve audit event can never fire), and Kasper UNDO reverts the
// status without pushing the revert to Linear (issue left stale at the
// approved status). PASSES while the bugs exist; flip when fixed.
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
    up({ id, name: 'AUDIT hole ' + ts, order_index: 1, video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', linear_issue_id: 'https://linear.app/x/VID-AH' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-AH' + ts });
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

    // BUG-5a pin: kasper_approved_at is NOT stamped by the samples approve
    const stamps = row(id, 'kasper_approved_at');
    const stamped = !!(stamps && String(stamps.kasper_approved_at || '').trim());
    t(!stamped, 'BUG-5a PIN: kasper_approved_at NOT stamped by samples approve', stamped ? 'now stamped — bug fixed? flip this probe' : '');

    // undo via the toast → status reverts…
    const undo = await kp.waitForFunction(() => !!document.querySelector('.sv-toast-action'), { timeout: 9000 })
      .then(() => kp.evaluate(() => { const b = document.querySelector('.sv-toast-action'); b.click(); return 'ok'; })).catch(() => 'no-toast');
    t(undo === 'ok', 'undo toast clicked', undo);
    let reverted = false;
    for (let i = 0; i < 25 && !reverted; i++) { const r = row(id, 'video_status'); reverted = !!r && r.video_status === 'Kasper Approval'; if (!reverted) await sleep(1000); }
    t(reverted, 'undo reverted the DB status to Kasper Approval');

    // …BUG-5b pin: but NO Linear push of the reverted status — issue left stale
    await sleep(5000);
    const revertPushed = linearCalls().some(c => c.path === 'linear-set-status' && JSON.stringify(c.payload || {}).includes('"Kasper Approval"'));
    t(!revertPushed, 'BUG-5b PIN: undo pushes NOTHING to Linear (issue left stale at Client Approval)', revertPushed ? 'now pushes — bug fixed? flip this probe' : '');
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { archiveSafe(id); } catch {}
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
