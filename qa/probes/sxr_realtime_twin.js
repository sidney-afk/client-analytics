// sxr_realtime_twin.js — TWO screens updating live at the same time.
// The real Supabase WebSocket can't tunnel in the sandbox, so we drive the
// exact handler the WS would call (_sxrV2OnRealtimeChange) to simulate a push.
//   1. Cross-screen propagation: actor B changes status via the backend; tab A
//      receives a "push" and background-reloads to show B's change WITHOUT a
//      manual refresh and WITHOUT losing its place.
//   2. Recent-save window: tab A makes a fresh local status change, THEN a push
//      arrives carrying the STALE pre-change server row — A's fresh edit must
//      survive (recent-save guard), not get clobbered.
//   3. Pending-edit protection: a queued (unsaved) local edit is kept across a
//      background reload triggered by a push.
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, archiveSafe, appErrs } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const row = (id, cols) => { try { const r = supa('id=eq.' + id + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; } };

// Read a component's status as tab A currently holds it IN MEMORY.
async function memStatus(page, id, comp) {
  return page.evaluate((args) => { const [cid, comp] = args; const p = (sxrState.posts || []).find(x => x.id === cid); return p ? p[comp + '_status'] : '(absent)'; }, [id, comp]);
}
// Fire the realtime handler the WebSocket would call.
async function firePush(page) {
  return page.evaluate(() => {
    const slug = sxrClientSlug(sxrState.client);
    if (typeof _sxrV2OnRealtimeChange !== 'function') return 'no-fn';
    _sxrV2OnRealtimeChange(slug);
    return 'fired';
  });
}

(async () => {
  const browser = await launch();
  const ts = Date.now();
  const id = 'sr_probe_rttwin_' + ts;
  try {
    up({ id, name: 'RT twin ' + ts, order_index: 1, video_status: 'In Progress', graphic_status: 'Approved', status: 'In Progress', linear_issue_id: 'https://linear.app/x/VID-RT' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-RT' + ts });
    await sleep(1500);

    // Tab A: the SMM's screen, loaded and idle.
    const A = await smm(browser);
    await A.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
    await sleep(1800);
    await A.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id, { timeout: 12000 });
    t((await memStatus(A, id, 'video')) === 'In Progress', 'tab A starts with video = In Progress');

    // ---------- 1. cross-screen propagation ----------
    // Actor B writes directly to the backend (as another screen would), then A
    // gets a realtime "push".
    up({ id, video_status: 'For SMM Approval', status: 'For SMM Approval' });
    await sleep(1500);
    t((await memStatus(A, id, 'video')) === 'In Progress', 'before push: tab A has NOT yet seen B\'s change (no manual refresh)');
    t((await firePush(A)) === 'fired', 'realtime push fired at tab A');
    let propagated = false;
    for (let i = 0; i < 20 && !propagated; i++) { propagated = (await memStatus(A, id, 'video')) === 'For SMM Approval'; if (!propagated) await sleep(1000); }
    t(propagated, 'cross-screen: tab A background-reloaded and now shows B\'s change');

    // ---------- 2. recent-save window protects a fresh local edit ----------
    // Tab A makes a FRESH local change (recent-save guard arms), then a push
    // arrives carrying the still-stale server row — A's fresh edit must survive.
    const picked = await A.evaluate((cid) => {
      const wrap = document.querySelector(`[data-substatus-pid="${cid}"][data-substatus-comp="video"]`);
      const trig = wrap && wrap.querySelector('.cal-fld-substatus-trigger'); if (!trig) return 'no-trigger';
      trig.click();
      const items = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')];
      const it = items.find(i => (i.getAttribute('onclick') || '').includes("'Kasper Approval'"));
      if (!it) return 'no-item'; it.click(); return 'ok';
    }, id);
    t(picked === 'ok', 'tab A makes a fresh local change → Kasper Approval');
    // immediately fire a push (server may still read the older value briefly)
    await firePush(A);
    await sleep(2500);
    const afterGuard = await memStatus(A, id, 'video');
    t(afterGuard === 'Kasper Approval', 'recent-save window: A\'s fresh edit survives a concurrent push', afterGuard);
    // and it actually persisted
    let persisted = false;
    for (let i = 0; i < 20 && !persisted; i++) { const r = row(id, 'video_status'); persisted = !!r && r.video_status === 'Kasper Approval'; if (!persisted) await sleep(1000); }
    t(persisted, 'A\'s fresh edit persisted to the backend');

    // ---------- 3. pending (unsaved) edit survives a push-driven reload ----------
    await A.evaluate((cid) => {
      // stage a pending field edit WITHOUT committing the save
      if (!_sxrPendingEdits[cid]) _sxrPendingEdits[cid] = {};
      _sxrPendingEdits[cid].name = 'PENDING_RT_EDIT';
      const p = (sxrState.posts || []).find(x => x.id === cid); if (p) p.name = 'PENDING_RT_EDIT';
    }, id);
    up({ id, name: 'server-side-name-' + ts });  // server has a different name
    await sleep(1200);
    await firePush(A);
    await sleep(2500);
    const keptPending = await A.evaluate((cid) => { const p = (sxrState.posts || []).find(x => x.id === cid); return p ? p.name : '(absent)'; }, id);
    t(keptPending === 'PENDING_RT_EDIT', 'pending unsaved edit is kept across a push-driven background reload', keptPending);

    const errs = appErrs(A) || [];
    t(errs.length === 0, '0 app JS errors', errs[0] || '');
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { archiveSafe(id); } catch {}
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
