// p87 — selective resolve-on-route + the 3-route / checklist / ✕-close chooser.
// Drives the REAL app (sidneylaruel) headless against the live backend.
//
//   A) Notes "mark done" on the ONLY open change-request → chooser (no checklist,
//      because there's nothing to choose between) → the new "Approve" route sends
//      the caption straight to Approved and marks the change-request done.
//   B) SMM Review-tab "Approve & send" on a component with TWO open change-requests
//      → chooser shows a 2-item checklist → SMM un-ticks one → route to Kasper:
//      the TICKED one is resolved, the UN-ticked one stays open (selective),
//      caption routes to Kasper Approval. (This is the redundancy fix.)
//   C) ✕ close → "Keep editing" returns to the chooser; ✕ → "Discard & close"
//      applies nothing — the change-request stays open and the status is unchanged.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const now = () => new Date().toISOString();
const tweak = (id, body, round) => ({ id, parent_id: null, author: 'Client', role: 'client', is_tweak: true, round: round || 1, audience: 'client', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const isDone = async (pid, id) => { const r = await Q.rawRow(pid, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const c = a.find(x => x.id === id); return c ? !!c.done : '__missing__'; };
const MEDIA = { thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' };

const PIDA = 'p_rr_a_' + TS, TA = 'ta_' + TS;
const PIDB = 'p_rr_b_' + TS, TB1 = 'tb1_' + TS, TB2 = 'tb2_' + TS;
const PIDC = 'p_rr_c_' + TS, TC = 'tc_' + TS;

async function cleanup(pid) {
  try { const r = await Q.rawRow(pid, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() }));
    await Q.up({ id: pid, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
}

(async () => {
  const S = Q.makeOk('P87 resolve-on-route');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    // ───────────────────────── A: Notes mark-done → Approve route ─────────────
    await Q.up(Object.assign({ id: PIDA, name: 'RR-A ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Tweaks Needed', status: 'Tweaks Needed',
      caption_tweaks: JSON.stringify([tweak(TA, 'CR alpha ' + TS, 1)]) }, MEDIA));
    await Q.pollRaw(PIDA, r => (r.caption_tweaks || '').includes(TA), 'caption_tweaks');
    await Q.waitForPost(smm, PIDA, "p=>p.caption_status==='Tweaks Needed'");

    const oa = await smm.evaluate((a) => {
      try { openCalComments(a.pid); _calToggleCommentDone(a.id); } catch (e) { return 'ERR ' + e.message; }
      const ov = document.getElementById('resolveDestOverlay');
      return { active: !!ov.classList.contains('active'),
        hasApprove: !!document.getElementById('resolveDestApprove'),
        hasKasper: !!document.getElementById('resolveDestKasper'),
        hasClient: !!document.getElementById('resolveDestClient'),
        checklistHidden: document.getElementById('resolveDestChecklist').hidden };
    }, { pid: PIDA, id: TA });
    S.ok(oa && oa.active === true, 'A: marking the only open change-request opens the chooser');
    S.ok(oa.hasApprove && oa.hasKasper && oa.hasClient, 'A: chooser offers all three routes (Kasper / Client / Approve)');
    S.ok(oa.checklistHidden === true, 'A: one open change-request → no checklist (nothing to choose)');
    await smm.evaluate(() => { const b = document.getElementById('resolveDestApprove'); if (b) b.click(); });
    let rA = await Q.pollRaw(PIDA, x => x.caption_status === 'Approved', 'caption_status,caption_tweaks', 15000);
    S.ok(rA.caption_status === 'Approved', 'A: the new "Approve" route sends caption → Approved');
    S.ok((await isDone(PIDA, TA)) === true, 'A: the change-request is marked done by the route');

    // ───────────────────── B: Review-tab send, 2 open, selective ──────────────
    await Q.up(Object.assign({ id: PIDB, name: 'RR-B ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'For SMM Approval', status: 'For SMM Approval',
      caption_tweaks: JSON.stringify([tweak(TB1, 'CR one ' + TS, 1), tweak(TB2, 'CR two ' + TS, 2)]) }, MEDIA));
    await Q.pollRaw(PIDB, r => (r.caption_tweaks || '').includes(TB2), 'caption_tweaks');
    await Q.waitForPost(smm, PIDB, "p=>p.caption_status==='For SMM Approval'");

    const ob = await smm.evaluate((a) => {
      try { calState.view = 'smmreview'; _calReviewApprove(a.pid, 'caption', 'kasper'); } catch (e) { return 'ERR ' + e.message; }
      const cl = document.getElementById('resolveDestChecklist');
      const inputs = [...cl.querySelectorAll('input[data-rd-id]')];
      return { active: !!document.getElementById('resolveDestOverlay').classList.contains('active'),
        checklistHidden: cl.hidden, count: inputs.length, ids: inputs.map(i => i.getAttribute('data-rd-id')) };
    }, { pid: PIDB });
    S.ok(ob && ob.active === true, 'B: SMM Review approve with open change-requests opens the chooser');
    S.ok(ob.checklistHidden === false && ob.count === 2, 'B: two open change-requests → checklist lists both');
    // un-tick the FIRST, keep the second, then route to Kasper
    await smm.evaluate((a) => {
      const i = document.querySelector('#resolveDestChecklist input[data-rd-id="' + a.id + '"]');
      if (i) i.checked = false;
      const b = document.getElementById('resolveDestKasper'); if (b) b.click();
    }, { id: TB1 });
    let rB = await Q.pollRaw(PIDB, x => x.caption_status === 'Kasper Approval', 'caption_status,caption_tweaks', 15000);
    S.ok(rB.caption_status === 'Kasper Approval', 'B: routing sends caption → Kasper Approval');
    S.ok((await isDone(PIDB, TB2)) === true, 'B: the TICKED change-request is resolved');
    S.ok((await isDone(PIDB, TB1)) === false, 'B: the UN-ticked change-request stays open (selective resolve)');

    // ─────────────────────── C: ✕ close → keep / discard ──────────────────────
    await Q.up(Object.assign({ id: PIDC, name: 'RR-C ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Tweaks Needed', status: 'Tweaks Needed',
      caption_tweaks: JSON.stringify([tweak(TC, 'CR gamma ' + TS, 1)]) }, MEDIA));
    await Q.pollRaw(PIDC, r => (r.caption_tweaks || '').includes(TC), 'caption_tweaks');
    await Q.waitForPost(smm, PIDC, "p=>p.caption_status==='Tweaks Needed'");

    const oc = await smm.evaluate((a) => {
      try { openCalComments(a.pid); _calToggleCommentDone(a.id); } catch (e) { return 'ERR ' + e.message; }
      const ov = document.getElementById('resolveDestOverlay');
      document.getElementById('resolveDestClose').click();
      const discardShown = !document.getElementById('resolveDestDiscard').hidden && document.getElementById('resolveDestMain').hidden;
      document.getElementById('resolveDestKeep').click();
      const backToMain = !document.getElementById('resolveDestMain').hidden && document.getElementById('resolveDestDiscard').hidden && ov.classList.contains('active');
      document.getElementById('resolveDestClose').click();
      document.getElementById('resolveDestDiscardYes').click();
      return { discardShown, backToMain, active: ov.classList.contains('active') };
    }, { pid: PIDC, id: TC });
    S.ok(oc && oc.discardShown === true, 'C: ✕ close shows the discard-confirm screen');
    S.ok(oc.backToMain === true, 'C: "Keep editing" returns to the chooser');
    S.ok(oc.active === false, 'C: "Discard & close" closes the chooser');
    await smm.waitForTimeout(1800);
    const rC = await Q.rawRow(PIDC, 'caption_status,caption_tweaks');
    S.ok((await isDone(PIDC, TC)) === false, 'C: discarding leaves the change-request OPEN (nothing applied)');
    S.ok(rC.caption_status === 'Tweaks Needed', 'C: discarding leaves the status unchanged');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 4)) + ')');
  } finally {
    await cleanup(PIDA); await cleanup(PIDB); await cleanup(PIDC);
    await browser.close();
  }
  process.exit(S.done());
})();
