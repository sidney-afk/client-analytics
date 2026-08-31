// cal_linear_deep.js — deep Linear-sync set on the CONTENT CALENDAR, twin of
// qa/probes/sxr_linear_deep.js (Linear traffic is MOCKED + captured; nothing
// reaches live). Courier-based: runs in-session AND on CI.
//   1. Inbound-echo suppression: a _calNoLinearPush key suppresses exactly ONE
//      outbound push, then is consumed.
//   2. __CLEAR_LINK__: clearing the slot via the real input empties the DB
//      column and fires NO status push.
//   3. Link uniqueness across posts: committing post A's link into post B
//      raises the conflict flow; the move handler relocates it (A cleared).
//   4. Outbox drain (owner-leased since the 2026-08 write-gateway rework): an
//      entry queued through the REAL _linearOutboxEnqueue is retained (not
//      delivered) while the tab is unsigned, then pushed and drained by
//      _linearOutboxFlush() once a verified staff identity holds the lease.
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
const setLink = (page, pid, link) => page.evaluate(async (args) => {
  const [pid, link] = args;
  if (typeof _calLinearEdit !== 'function') return 'no-fn';
  _calLinearEdit(pid, 'video');
  const inp = document.querySelector('.cal-linear-input');
  if (!inp) return 'no-input';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, link); inp.dispatchEvent(new Event('input', { bubbles: true }));
  // AWAITED as of 2026-08-25: _calLinearCommit consults live authority before
  // it saves, so returning without awaiting reports 'committed' on a write that
  // has not been decided yet.
  try { await _calLinearCommit(inp, pid, 'video'); } catch (e) { /* re-render race is cosmetic; commit did its work */ }
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

    // ---------- 1.5. positive-path: the seal engages under REAL authority ----------
    // OPEN_REPAIRS item 61(b), twin of sxr_linear_deep's 1.5. Nothing else
    // here confirms the item-59 seal actually fires on the video slot -- only
    // that its DOWNSTREAM effects look right once bypassed below. Checked
    // under whatever authority genuinely holds right now (syncview for both
    // teams since 2026-08-28), before section 2's override changes it.
    const sealCheck = await page.evaluate((pid) => {
      document.getElementById('confirmTitle').textContent = '';
      document.getElementById('confirmMsg').textContent = '';
      if (typeof _calLinearEdit !== 'function') return { fn: false };
      _calLinearEdit(pid, 'video');
      return {
        fn: true,
        title: document.getElementById('confirmTitle').textContent,
        msg: document.getElementById('confirmMsg').textContent,
        hasInput: !!document.querySelector('.cal-linear-input'),
      };
    }, idA);
    t(sealCheck.fn === true, '_calLinearEdit reachable for the seal check', JSON.stringify(sealCheck));
    t(!sealCheck.hasInput, 'video slot under real (syncview) authority: no .cal-linear-input is inserted', JSON.stringify(sealCheck));
    t(/set automatically now/i.test(sealCheck.title) && /SyncView/.test(sealCheck.msg),
      'and the sealed notice fires, via the shared _writeUiLinkSlotSealedNotice copy', JSON.stringify(sealCheck));

    // ---------- authority override: exercise the pre-flip real-input path ----------
    // OPEN_REPAIRS item 61(a), twin of sxr_linear_deep's override. Sections
    // 2-3 below drive clear/re-link/move through the REAL <input> element,
    // which the seal check just proved only exists when the slot is NOT
    // sealed. Sidney's plan (2026-08-28) is to hold Linear open as a live
    // rollback path for roughly two weeks; this keeps that exact code path
    // under coverage for that window. Restored before section 4, which
    // asserts genuine authority-driven quarantine behavior.
    const authOverride = await page.evaluate(() => {
      if (typeof _writeUiRefreshAuthority !== 'function' || typeof _writeUiAuthoritySnapshot !== 'function') return false;
      window.__origWriteUiRefreshAuthority = _writeUiRefreshAuthority;
      window.__origWriteUiAuthoritySnapshot = _writeUiAuthoritySnapshot;
      _writeUiRefreshAuthority = async () => ({ video: 'linear', graphics: 'linear' });
      _writeUiAuthoritySnapshot = () => ({ video: 'linear', graphics: 'linear' });
      return true;
    });
    t(authOverride === true, 'rollback-path coverage: authority stubbed to linear for the real-input block');

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
    const moveDriven = await page.evaluate(async (args) => {
      const [selfPid, link, oldPid] = args;
      _calPendingLinkMove[selfPid] = { which: 'video', val: link, oldPid };
      if (typeof _calMoveLinkConfirm !== 'function') return 'no-fn';
      // _calMoveLink carries its own authority gate now; await it so 'ok' means
      // the move was decided, not merely started.
      await _calMoveLinkConfirm(selfPid);
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

    // Restore real authority: section 4 asserts genuine authority-driven
    // quarantine behavior and must not run under the section 2-3 stub.
    const authRestored = await page.evaluate(() => {
      let ok = true;
      if (window.__origWriteUiRefreshAuthority) { _writeUiRefreshAuthority = window.__origWriteUiRefreshAuthority; delete window.__origWriteUiRefreshAuthority; }
      else ok = false;
      if (window.__origWriteUiAuthoritySnapshot) { _writeUiAuthoritySnapshot = window.__origWriteUiAuthoritySnapshot; delete window.__origWriteUiAuthoritySnapshot; }
      else ok = false;
      return ok;
    });
    t(authRestored === true, 'real authority restored before the outbox-drain section');

    // ---------- 4. outbox drain ----------
    // Twin of sxr_linear_deep step 4 — see the notes there. The 2026-08
    // write-gateway rework made this lane owner-leased with production-stamped
    // entries: queue through the REAL enqueue, prove the unsigned deferral,
    // then seed a verified staff identity and drain for real. Since
    // F1(video) + the item-63 authority gate, an unenrolled slug's VID entry
    // QUARANTINES (flipped_team_legacy_push) instead of delivering — the
    // delivery path is rollback coverage, executed under a linear-world stub
    // in test/write-ui-writer-durability.js. The enrolled disposition —
    // quarantine as legacy_actor_unverifiable — is pinned in 4b.
    resetLinearCalls();
    const pre = await page.evaluate(async (slug) => {
      if (typeof _linearOutboxEnqueue !== 'function' || typeof _linearOutboxFlush !== 'function') return { state: 'no-fn' };
      await _linearOutboxEnqueue('status', { issue: 'https://linear.app/x/VID-880002', status: 'Kasper Approval' }, 'probe-injected', slug);
      const res = await _linearOutboxFlush();
      const box = JSON.parse(localStorage.getItem('syncview_linear_outbox_v1') || '[]');
      return { state: 'ok', deferred: !!(res && res.deferred), boxLen: box.length };
    }, 'probeunenrolled');
    t(pre.state === 'ok', 'outbox: REAL enqueue accepted the entry', pre.state);
    t(pre.deferred === true && pre.boxLen === 1, 'unsigned tab: drain defers under the owner lease, entry retained', JSON.stringify(pre));
    const drained = await page.evaluate(() => {
      try {
        localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({ key: 'probe-staff-key', role: 'smm', member: { id: 'probe_staff', name: 'Probe Staff', role: 'smm', team: null } }));
        _syncviewStaffIdentityMem = null; _syncviewStaffIdentityLoaded = false;
        _syncviewAcceptStaffVerification();
      } catch (e) { return 'seed-failed: ' + ((e && e.message) || e); }
      if (typeof _linearOutboxFlush !== 'function') return 'no-fn';
      _linearOutboxFlush();
      return 'ok';
    });
    t(drained === 'ok', 'outbox flush invoked on a queued entry', drained);
    if (drained === 'ok') {
      // the quarantine rewrite happens after the drain's authority read
      // resolves in-page — poll briefly rather than reading instantly
      let settled = null;
      for (let i = 0; i < 12 && !(settled && settled.boxLen === 0); i++) {
        settled = await page.evaluate(() => {
          const box = JSON.parse(localStorage.getItem('syncview_linear_outbox_v1') || '[]');
          const rows = (typeof peekWriteUiLegacyQuarantine === 'function' ? peekWriteUiLegacyQuarantine() : [])
            .filter(r => r && r.surface === 'calendar' && r.item && JSON.stringify(r.item.payload || {}).includes('VID-880002'));
          return { boxLen: box.length, reasons: rows.map(r => r.reason) };
        });
        if (settled.boxLen !== 0) await sleep(1000);
      }
      t(settled && settled.boxLen === 0 && settled.reasons.length === 1
        && settled.reasons[0] === 'flipped_team_legacy_push',
        'item 63: a flipped-team entry is quarantined by the drain, not delivered', JSON.stringify(settled));
      t(pushes('VID-880002').length === 0,
        'item 63: nothing reached the webhook for the flipped team');
    }

    // ---------- 4b. ENROLLED slug: quarantine, not delivery ----------
    // Twin of sxr_linear_deep 4b: production's disposition for an enrolled
    // slug's gate-less staff legacy status entry is QUARANTINE
    // ('legacy_actor_unverifiable'). Simulate enrollment via the in-page
    // roster, assert the quarantine ledger takes it and nothing is pushed.
    resetLinearCalls();
    const quar = await page.evaluate(async (slug) => {
      _writeUiRerouteClients.add(slug);
      try {
        await _linearOutboxEnqueue('status', { issue: 'https://linear.app/x/VID-434343', status: 'Kasper Approval' }, 'probe-injected', slug);
        await _linearOutboxFlush();
      } finally { _writeUiRerouteClients.delete(slug); }
      const box = JSON.parse(localStorage.getItem('syncview_linear_outbox_v1') || '[]');
      const rows = (typeof peekWriteUiLegacyQuarantine === 'function' ? peekWriteUiLegacyQuarantine() : [])
        .filter(r => r && r.surface === 'calendar' && r.item && JSON.stringify(r.item.payload || {}).includes('VID-434343'));
      return { boxLen: box.length, reasons: rows.map(r => r.reason) };
    }, 'sidneylaruel');
    t(quar.boxLen === 0 && quar.reasons.length === 1 && quar.reasons[0] === 'legacy_actor_unverifiable',
      'enrolled slug: gate-less staff legacy debt is quarantined, not delivered', JSON.stringify(quar));
    t(pushes('VID-434343').length === 0, 'enrolled slug: nothing reached the webhook');

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
