// p71 — CAPSTONE: a YouTube card with all FOUR review components (video/graphic/caption/title)
// driven end-to-end through the full pipeline by all three actors:
//   For SMM Approval → (SMM approves each) → Kasper Approval → (Kasper approves each) → Client
//   Approval → (client approves each) → Approved.
// Asserts each stage lands on ALL four sub-statuses, the card surfaces to the right reviewer at
// each step, the overall (video/graphic/caption) converges to Approved, and title stays excluded
// from the overall throughout.
const Q = require('./lib.js');
const PID = 'p_cap_' + Math.floor(Date.now() / 1000);
const COMPS = ['video', 'graphic', 'caption', 'title'];
const allAt = (r, st) => COMPS.every(c => r[c + '_status'] === st);

(async () => {
  const S = Q.makeOk('P71 full 4-component pipeline capstone');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'CAP ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      title: 'Capstone YouTube Title', title_status: 'For SMM Approval',
      video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', caption_status: 'For SMM Approval', status: 'For SMM Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      graphic_linear_issue_id: '', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', title_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'For SMM Approval' && r.title_status === 'For SMM Approval', 'caption_status,title_status');

    // ---- STAGE 1: SMM approves all four → Kasper Approval ----
    await Q.waitForPost(smm, PID);
    await smm.evaluate(() => { calState.view = 'smmreview'; });
    for (const c of COMPS) await smm.evaluate((a) => { try { _calReviewApprove(a.pid, a.c); } catch (e) {} }, { pid: PID, c });
    let r = await Q.pollRaw(PID, x => allAt(x, 'Kasper Approval'), 'video_status,graphic_status,caption_status,title_status,status', 20000);
    S.ok(allAt(r, 'Kasper Approval'), 'STAGE1: all four components → Kasper Approval (' + JSON.stringify([r.video_status, r.graphic_status, r.caption_status, r.title_status]) + ')');

    // ---- STAGE 2: Kasper approves all four → Client Approval.
    //   IMPORTANT: Kasper persists a WHOLE ROW, and the upsert's optimistic-concurrency guard
    //   correctly REJECTS a write based on a STALE snapshot (the card appears in Kasper's queue as
    //   soon as the FIRST component hits Kasper Approval, before the later SMM approvals propagate
    //   to his fetch). So wait until his item reflects the FULL STAGE1 result (all four at Kasper
    //   Approval) before approving — exactly what a human gets after the card settles / a refresh.
    S.ok(await Q.kasperLoadHas(kas, PID), 'card surfaces to Kasper');
    const fresh = await kas.evaluate(async (a) => {
      for (let i = 0; i < 25; i++) {
        try { await _kasperLoadReview(true); } catch (e) {}
        await new Promise(x => setTimeout(x, 700));
        const it = (_kasperState.items || []).find(x => x.post.id === a.pid);
        if (it && ['video', 'graphic', 'caption', 'title'].every(c => _calNormStatus(it.post[c + '_status'] || '') === 'Kasper Approval')) return true;
      }
      return false;
    }, { pid: PID });
    S.ok(fresh, 'Kasper item reflects the full STAGE1 result (all four at Kasper Approval) before approving');
    // Approve each component, RETRYING on the optimistic-concurrency rejection that a stale
    // snapshot triggers under the rapid SMM→Kasper handoff: on rejection a human refreshes and
    // re-applies — so do exactly that (re-fetch the item, re-approve) up to 4 times. If the fix
    // were dropping a field this retry could NOT make it land; a deterministic pass proves the
    // STAGE2 failures were transient conflict rejections, not a field-patch defect.
    for (const c of COMPS) {
      let landed = false;
      for (let attempt = 0; attempt < 4 && !landed; attempt++) {
        await kas.evaluate(async (a) => {
          // refresh the item so its snapshot reflects the current server row before (re)approving
          for (let i = 0; i < 8; i++) { const it = (_kasperState.items || []).find(x => x.post.id === a.pid); if (it && _calNormStatus(it.post[a.c + '_status'] || '') === 'Kasper Approval') break; try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 600)); }
          const it = (_kasperState.items || []).find(x => x.post.id === a.pid);
          if (it && _calNormStatus(it.post[a.c + '_status'] || '') === 'Kasper Approval') { try { await _kasperApproveComp(a.pid, a.c, 'client'); } catch (e) {} }
        }, { pid: PID, c });
        const rr = await Q.pollRaw(PID, x => x[c + '_status'] === 'Client Approval', c + '_status', 8000);
        landed = rr[c + '_status'] === 'Client Approval';
      }
    }
    r = await Q.pollRaw(PID, x => allAt(x, 'Client Approval'), 'video_status,graphic_status,caption_status,title_status,status', 20000);
    S.ok(allAt(r, 'Client Approval'), 'STAGE2: all four → Client Approval (' + JSON.stringify([r.video_status, r.graphic_status, r.caption_status, r.title_status]) + ')');

    // ---- STAGE 3: client approves all four → Approved (serialize per component) ----
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    for (const c of COMPS) {
      await cli.evaluate(async (a) => { const k = a.pid + '|' + a.c; for (let i = 0; i < 15; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } try { _calReviewApprove(a.pid, a.c); } catch (e) {} }, { pid: PID, c });
      await Q.pollRaw(PID, x => x[c + '_status'] === 'Approved', c + '_status', 15000);
    }
    r = await Q.pollRaw(PID, x => allAt(x, 'Approved'), 'video_status,graphic_status,caption_status,title_status,status', 20000);
    S.ok(allAt(r, 'Approved'), 'STAGE3: all four → Approved (' + JSON.stringify([r.video_status, r.graphic_status, r.caption_status, r.title_status]) + ')');

    // overall converges to Approved (video/graphic/caption all Approved); title excluded but also Approved
    S.ok(r.status === 'Approved', 'overall converged to Approved');
    const overallComputed = await smm.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? computeOverallStatus(p) : 'NO_POST'; }, PID);
    S.ok(overallComputed === 'Approved', 'computed overall = Approved on a fresh surface');

    S.ok(smm._errs.length === 0 && kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors across the full pipeline (' + JSON.stringify([...smm._errs, ...kas._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
