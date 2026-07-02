// sxr_concurrency.js — multi-actor race conditions on the samples system.
//   1. Same-tick double Kasper approve → exactly ONE transition (in-flight guard).
//   2. Two stale SMM tabs comment on the same component → comments MERGE
//      (field-level), neither clobbers the other.
//   3. Kasper approves video while SMM re-routes graphic → both sub-status
//      writes land (no cross-component clobber). Overall is characterized
//      (each writer computes it from a stale twin — logged, not failed).
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, smm, kasper, up, supa, supaEvents, archiveSafe, appErrs } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const row = (id, cols) => { const r = supa('id=eq.' + id + '&select=' + (cols || '*')); return (Array.isArray(r) && r[0]) || null; };

async function openNotes(page, id) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); });
  await page.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id, { timeout: 15000 });
  await page.evaluate((cid) => { const card = document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`); const b = card && card.querySelector('.cal-comments-btn, .cal-card-notes'); if (b) b.click(); }, id);
  await page.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 8000 });
}
async function sendNote(page, text) {
  return page.evaluate((text) => {
    const ta = document.getElementById('sxrCommentComposer'); if (!ta) return 'no-ta';
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const send = document.querySelector('#sxrCommentsOverlay .cal-cm-send'); if (!send || send.disabled) return 'disabled'; send.click(); return 'ok';
  }, text);
}

(async () => {
  const browser = await launch();
  const ts = Date.now();
  const id1 = 'sr_probe_race_dbl_' + ts, id2 = 'sr_probe_race_cm_' + ts, id3 = 'sr_probe_race_xc_' + ts;
  try {
    // ---------- 1. same-tick double Kasper approve ----------
    up({ id: id1, name: 'RACE dbl ' + ts, order_index: 1, video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', linear_issue_id: 'https://linear.app/x/VID-R1' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-R1' + ts });
    await sleep(1500);
    const kp = await kasper(browser);
    await kp.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
    await kp.waitForFunction((cid) => (typeof _sxrKasperFindItem === 'function') && !!_sxrKasperFindItem(cid), id1, { timeout: 20000 });
    await kp.evaluate((cid) => { _sxrKasperApproveComp(cid, 'video'); _sxrKasperApproveComp(cid, 'video'); }, id1);
    // Poll until the write lands (fixed sleeps flake under the courier); on a
    // miss, capture WHY: did the app surface "Save failed" (transient persist
    // failure — infra) or is the in-flight guard stuck (product bug)?
    let landed = false;
    for (let i = 0; i < 30 && !landed; i++) { const r = row(id1, 'video_status'); landed = !!r && r.video_status === 'Client Approval'; if (!landed) await sleep(1000); }
    if (!landed) {
      const diag = await kp.evaluate((cid) => ({
        savingKeys: Object.keys((_sxrKasperState && _sxrKasperState.saving) || {}).filter(k => _sxrKasperState.saving[k]),
        saveFailedNotify: !!document.querySelector('.notify, .sv-notify') && /save failed/i.test(document.body.textContent || ''),
        stillInQueue: (typeof _sxrKasperFindItem === 'function') && !!_sxrKasperFindItem(cid),
        localStatus: (() => { const it = _sxrKasperFindItem(cid); return it && it.post && it.post.video_status; })(),
      }), id1);
      console.log('   double-approve DIAG:', JSON.stringify(diag));
    }
    t(landed, 'double-approve: video landed at Client Approval', landed ? '' : String((row(id1, 'video_status') || {}).video_status));
    // One save legitimately writes TWO audit rows: the component transition
    // (component='video') AND the overall roll-up (component=null). Idempotency
    // is judged on the COMPONENT transition alone.
    const evs = supaEvents('sample_id=eq.' + id1 + '&action=eq.status_change&select=to_status,component') || [];
    const hits = evs.filter(e => e.to_status === 'Client Approval' && e.component === 'video');
    t(hits.length === 1, `double-approve: exactly ONE video Client-Approval transition in audit (got ${hits.length})`);

    // ---------- 2. two stale SMM tabs — comment merge ----------
    up({ id: id2, name: 'RACE cm ' + ts, order_index: 2, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
    await sleep(1500);
    const tabA = await smm(browser);
    const tabB = await smm(browser);           // second, independent context — stale twin
    await openNotes(tabA, id2);
    await openNotes(tabB, id2);                // BOTH open before either sends
    t((await sendNote(tabA, 'A_TOKEN first tab note')) === 'ok', 'merge race: tab A sent');
    await sleep(4000);                         // A's save lands; B is now stale
    t((await sendNote(tabB, 'B_TOKEN second tab note')) === 'ok', 'merge race: stale tab B sent');
    await sleep(5000);
    const r2 = row(id2, 'video_tweaks');
    const cell = String((r2 && r2.video_tweaks) || '');
    t(cell.includes('A_TOKEN'), 'merge race: tab A comment SURVIVES tab B save', cell.includes('A_TOKEN') ? '' : 'CLOBBERED — LWW whole-cell overwrite');
    t(cell.includes('B_TOKEN'), 'merge race: tab B comment present');

    // ---------- 3. cross-component concurrent writes ----------
    up({ id: id3, name: 'RACE xc ' + ts, order_index: 3, video_status: 'Kasper Approval', graphic_status: 'Tweaks Needed', status: 'Kasper Approval', linear_issue_id: 'https://linear.app/x/VID-R3' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-R3' + ts });
    await sleep(1500);
    const kp3 = await kasper(browser);
    await kp3.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
    await kp3.waitForFunction((cid) => (typeof _sxrKasperFindItem === 'function') && !!_sxrKasperFindItem(cid), id3, { timeout: 20000 });
    const smm3 = await smm(browser);
    await smm3.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id3, { timeout: 15000 });
    // fire both writes as close together as possible
    await Promise.all([
      kp3.evaluate((cid) => { _sxrKasperApproveComp(cid, 'video'); }, id3),
      smm3.evaluate((cid) => { _sxrStatusPick(cid, 'For SMM Approval', 'graphic'); }, id3),
    ]);
    await sleep(6000);
    const r3 = row(id3, 'video_status,graphic_status,status');
    t(r3 && r3.video_status === 'Client Approval', 'xc race: Kasper video write landed', r3 && r3.video_status);
    t(r3 && r3.graphic_status === 'For SMM Approval', 'xc race: SMM graphic write landed (no clobber)', r3 && r3.graphic_status);
    console.log(`   (characterization) overall after race: ${r3 && r3.status} — worst-of would be For SMM Approval`);

    for (const p of [kp, tabA, tabB, kp3, smm3]) { const errs = appErrs(p) || []; if (errs.length) t(false, 'appErrs', errs[0]); }
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    for (const id of [id1, id2, id3]) { try { archiveSafe(id); } catch {} }
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
