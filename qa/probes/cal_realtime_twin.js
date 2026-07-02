// cal_realtime_twin.js — TWO screens updating live, CONTENT-CALENDAR twin of
// qa/probes/sxr_realtime_twin.js. Uses the COURIER harness (browser egress is
// blocked in the sandbox; backend calls tunnel via Node) — so unlike the
// CI-only goldens, this runs both in-session and on CI. The real Supabase
// WebSocket can't tunnel, so we drive the exact handler the WS calls
// (_calV2OnRealtimeChange) to simulate a push at a never-reloaded SMM tab.
//   1. Cross-screen propagation: actor B changes status via the backend; tab A
//      receives a "push" and background-reloads to show it — no manual refresh.
//   2. Recent-save window: tab A makes a fresh local status change, then a push
//      arrives while the server row may still be stale — A's edit must survive.
//   3. Pending-edit protection: a queued (unsaved) local edit is kept across a
//      push-driven background reload.
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, smmCal, upCal, supaCal, archiveCalSafe, appErrs } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const row = (id, cols) => { try { const r = supaCal('id=eq.' + id + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; } };

const TS = Math.floor(Date.now() / 1000);
const PID = 'p_rttwin_' + TS;

const memStatus = (page, pid) => page.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? p.video_status : '(absent)'; }, pid);
const firePush = (page) => page.evaluate(() => { if (typeof _calV2OnRealtimeChange !== 'function') return 'no-fn'; _calV2OnRealtimeChange(calClientSlug(calState.client)); return 'fired'; });

(async () => {
  const browser = await launch();
  try {
    // no Linear link → the video pill is freely pickable
    upCal({ id: PID, name: 'RTtwin ' + TS, platforms: 'youtube', scheduled_date: '2026-07-03', video_status: 'In Progress', graphic_status: 'Approved', caption_status: 'Approved', status: 'In Progress' });
    let seeded = false;
    for (let i = 0; i < 15 && !seeded; i++) { const r = row(PID, 'video_status'); seeded = !!r && r.video_status === 'In Progress'; if (!seeded) await sleep(1000); }
    t(seeded, 'seed persisted');

    const A = await smmCal(browser);
    // wait for the post in calState (fresh load)
    const found = await A.evaluate(async (pid) => {
      for (let i = 0; i < 25; i++) {
        try { if (typeof loadCalendarPosts === 'function') await loadCalendarPosts(); } catch (e) {}
        await new Promise(x => setTimeout(x, 800));
        if ((calState.posts || []).some(x => x.id === pid)) return true;
      }
      return false;
    }, PID);
    t(found, 'tab A loaded the card');
    t((await memStatus(A, PID)) === 'In Progress', 'tab A starts with video = In Progress');

    // ---------- 1. cross-screen propagation ----------
    upCal({ id: PID, video_status: 'For SMM Approval', status: 'For SMM Approval' });
    let landed = false;
    for (let i = 0; i < 15 && !landed; i++) { const r = row(PID, 'video_status'); landed = !!r && r.video_status === 'For SMM Approval'; if (!landed) await sleep(1000); }
    t(landed, 'actor B\'s backend change persisted');
    t((await memStatus(A, PID)) === 'In Progress', 'before push: tab A has NOT yet seen B\'s change (no manual refresh)');
    t((await firePush(A)) === 'fired', 'realtime push fired at tab A');
    let propagated = false;
    for (let i = 0; i < 20 && !propagated; i++) { propagated = (await memStatus(A, PID)) === 'For SMM Approval'; if (!propagated) await sleep(1000); }
    t(propagated, 'cross-screen: tab A background-reloaded and shows B\'s change');

    // ---------- 2. recent-save window protects a fresh local edit ----------
    await A.evaluate((pid) => { try { delete _calPendingEdits[pid]; } catch (e) {} }, PID);
    const picked = await A.evaluate((pid) => { try { _calStatusPick(pid, 'Kasper Approval', 'video'); return 'ok'; } catch (e) { return String(e && e.message || e); } }, PID);
    t(picked === 'ok', 'tab A makes a fresh local change → Kasper Approval', picked);
    await firePush(A);              // push lands while the server row may still be stale
    await sleep(2500);
    const afterGuard = await memStatus(A, PID);
    t(afterGuard === 'Kasper Approval', 'recent-save window: A\'s fresh edit survives a concurrent push', afterGuard);
    let persisted = false;
    for (let i = 0; i < 20 && !persisted; i++) { const r = row(PID, 'video_status'); persisted = !!r && r.video_status === 'Kasper Approval'; if (!persisted) await sleep(1000); }
    t(persisted, 'A\'s fresh edit persisted to the backend');

    // ---------- 3. pending (unsaved) edit survives a push-driven reload ----------
    await A.evaluate((pid) => {
      if (!_calPendingEdits[pid]) _calPendingEdits[pid] = {};
      _calPendingEdits[pid].name = 'PENDING_CAL_RT_EDIT';
      const p = (calState.posts || []).find(x => x.id === pid); if (p) p.name = 'PENDING_CAL_RT_EDIT';
    }, PID);
    upCal({ id: PID, name: 'server-name-' + TS });
    await sleep(1500);
    await firePush(A);
    await sleep(2500);
    const keptPending = await A.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? p.name : '(absent)'; }, PID);
    t(keptPending === 'PENDING_CAL_RT_EDIT', 'pending unsaved edit kept across a push-driven background reload', keptPending);

    const errs = appErrs(A) || [];
    t(errs.length === 0, '0 app JS errors', errs[0] || '');
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { archiveCalSafe(PID); } catch {}
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
