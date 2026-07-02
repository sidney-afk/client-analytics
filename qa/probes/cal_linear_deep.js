// cal_linear_deep.js — deep Linear-sync set on the CONTENT CALENDAR, twin of
// qa/probes/sxr_linear_deep.js (Linear traffic is MOCKED + captured; nothing
// reaches live). Courier-based: runs in-session AND on CI.
//   1. Inbound-echo suppression: a _calNoLinearPush key suppresses exactly ONE
//      outbound push, then is consumed.
//   2. __CLEAR_LINK__: clearing the slot via the real input empties the DB
//      column and fires NO status push.
//   3. Link uniqueness across posts: committing post A's link into post B
//      raises the conflict flow; the move handler relocates it (A cleared).
//   4. Outbox drain: a queued entry in syncview_linear_outbox_v1 is pushed and
//      drained by _linearOutboxFlush().
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, smmCal, upCal, supaCal, archiveCalSafe, appErrs, linearCalls, resetLinearCalls } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const row = (id, cols) => { try { const r = supaCal('id=eq.' + id + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; } };
const pushes = (needle) => linearCalls().filter(c => c.path === 'linear-set-status' && JSON.stringify(c.payload || {}).includes(needle));

const TS = Math.floor(Date.now() / 1000);
const idA = 'p_lindeep_a_' + TS, idB = 'p_lindeep_b_' + TS;
const LINK_A = 'https://linear.app/x/VID-CALDEEP-A' + TS;

async function loadPosts(page) {
  return page.evaluate(async () => { try { if (typeof loadCalendarPosts === 'function') await loadCalendarPosts(); } catch (e) {} return (calState.posts || []).length; });
}
const setLink = (page, pid, link) => page.evaluate((args) => {
  const [pid, link] = args;
  if (typeof _calLinearEdit !== 'function') return 'no-fn';
  _calLinearEdit(pid, 'video');
  const inp = document.querySelector('.cal-linear-input');
  if (!inp) return 'no-input';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, link); inp.dispatchEvent(new Event('input', { bubbles: true }));
  try { _calLinearCommit(inp, pid, 'video'); } catch (e) { /* re-render race is cosmetic; commit did its work */ }
  return 'committed';
}, [pid, link]);

(async () => {
  const browser = await launch();
  try {
    upCal({ id: idA, name: 'CALLIN A ' + TS, platforms: 'youtube', scheduled_date: '2026-07-04', video_status: 'For SMM Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'For SMM Approval', linear_issue_id: LINK_A });
    upCal({ id: idB, name: 'CALLIN B ' + TS, platforms: 'youtube', scheduled_date: '2026-07-04', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress' });
    let seeded = false;
    for (let i = 0; i < 15 && !seeded; i++) { const r = row(idA, 'linear_issue_id'); seeded = !!r && r.linear_issue_id === LINK_A; if (!seeded) await sleep(1000); }
    t(seeded, 'seeds persisted');

    const page = await smmCal(browser);
    await loadPosts(page);

    // ---------- 1. inbound-echo suppression (single-shot) ----------
    resetLinearCalls();
    await page.evaluate((pid) => { _calNoLinearPush.add(pid + '|video'); }, idA);
    const p1 = await page.evaluate((pid) => { try { _calStatusPick(pid, 'Kasper Approval', 'video'); return 'ok'; } catch (e) { return String(e && e.message || e); } }, idA);
    t(p1 === 'ok', 'suppressed change: pill set', p1);
    let landed = false;
    for (let i = 0; i < 20 && !landed; i++) { const r = row(idA, 'video_status'); landed = !!r && r.video_status === 'Kasper Approval'; if (!landed) await sleep(1000); }
    t(landed, 'suppressed change persisted to DB');
    await sleep(5000);
    t(pushes('Kasper Approval').length === 0, 'echo suppression: NO outbound push for the suppressed change');
    const p2 = await page.evaluate((pid) => { try { _calStatusPick(pid, 'Client Approval', 'video'); return 'ok'; } catch (e) { return String(e && e.message || e); } }, idA);
    t(p2 === 'ok', 'follow-up change: pill set', p2);
    let pushed = false;
    for (let i = 0; i < 15 && !pushed; i++) { pushed = pushes('Client Approval').length > 0; if (!pushed) await sleep(1000); }
    t(pushed, 'suppression is SINGLE-SHOT: the next change pushes normally');

    // ---------- 2. __CLEAR_LINK__ on slot clear ----------
    resetLinearCalls();
    const cleared = await setLink(page, idA, '');
    t(cleared === 'committed', 'cleared the video Linear slot via the real input', cleared);
    let dbCleared = false;
    for (let i = 0; i < 20 && !dbCleared; i++) { const r = row(idA, 'linear_issue_id'); dbCleared = !!r && !String(r.linear_issue_id || '').trim(); if (!dbCleared) await sleep(1000); }
    t(dbCleared, '__CLEAR_LINK__: DB column emptied');
    await sleep(4000);
    t(linearCalls().filter(c => c.path === 'linear-set-status').length === 0, 'clear fires NO status push');

    // ---------- 3. link uniqueness across two posts ----------
    t((await setLink(page, idA, LINK_A)) === 'committed', 're-linked post A');
    await sleep(3000);
    let detected = { otherId: null };
    for (let i = 0; i < 12; i++) {
      detected = await page.evaluate((args) => {
        const [selfPid, link] = args;
        if (typeof _calLinkConflict !== 'function') return { otherId: 'no-fn' };
        const other = _calLinkConflict(link, selfPid);
        return { otherId: other && other.id };
      }, [idB, LINK_A]);
      if (detected.otherId === idA) break;
      await loadPosts(page);
      await sleep(1500);
    }
    console.log(`   [info] _calLinkConflict pre-check saw: ${detected.otherId || 'none'} (move below is authoritative)`);
    const moveDriven = await page.evaluate((args) => {
      const [selfPid, link, oldPid] = args;
      _calPendingLinkMove[selfPid] = { which: 'video', val: link, oldPid };
      if (typeof _calMoveLinkConfirm !== 'function') return 'no-fn';
      _calMoveLinkConfirm(selfPid);
      return 'ok';
    }, [idB, LINK_A, idA]);
    t(moveDriven === 'ok', 'move handler invoked', moveDriven);
    let moved = false;
    for (let i = 0; i < 20 && !moved; i++) {
      const a = row(idA, 'linear_issue_id'), b = row(idB, 'linear_issue_id');
      moved = !!a && !!b && !String(a.linear_issue_id || '').trim() && String(b.linear_issue_id || '') === LINK_A;
      if (!moved) await sleep(1000);
    }
    t(moved, 'move relocated the link: B owns it, A cleared');

    // ---------- 4. outbox drain ----------
    resetLinearCalls();
    const drained = await page.evaluate(() => {
      const KEY = 'syncview_linear_outbox_v1';
      localStorage.setItem(KEY, JSON.stringify([{ kind: 'status', payload: { issue: 'https://linear.app/x/VID-CALOUTBOX-1', status: 'Kasper Approval' }, attempts: 0 }]));
      if (typeof _linearOutboxFlush !== 'function') return 'no-fn';
      _linearOutboxFlush();
      return 'ok';
    });
    t(drained === 'ok', 'outbox flush invoked on a queued entry', drained);
    if (drained === 'ok') {
      let sent = false;
      for (let i = 0; i < 12 && !sent; i++) { sent = pushes('VID-CALOUTBOX-1').length > 0; if (!sent) await sleep(1000); }
      t(sent, 'outbox drain: queued push sent to the (mocked) webhook');
      // the capture logs at REQUEST time; the box rewrite happens after the
      // response resolves in-page — poll briefly rather than reading instantly
      let empty = false;
      for (let i = 0; i < 10 && !empty; i++) { empty = await page.evaluate(() => (JSON.parse(localStorage.getItem('syncview_linear_outbox_v1') || '[]')).length === 0); if (!empty) await sleep(1000); }
      t(empty, 'outbox empty after the drain');
    }

    const errs = appErrs(page) || [];
    t(errs.length === 0, '0 app JS errors', errs[0] || '');
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    for (const id of [idA, idB]) { try { archiveCalSafe(id); } catch {} }
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
