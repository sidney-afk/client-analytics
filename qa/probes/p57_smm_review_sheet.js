// p57 — the SMM's OWN review sheet (calState.view==='smmreview' → _calReviewMode()==='smm').
// The SMM reviews components at "For SMM Approval" and routes them onward:
//   • approve (default) → Kasper Approval → card surfaces to Kasper
//   • approve (dest 'client') → Client Approval → card surfaces to the client
//   • request change → Tweaks Needed (back to the editor)
const Q = require('./lib.js');
const PID = 'p_smr_' + Math.floor(Date.now() / 1000);

const setSmmReview = (smm) => smm.evaluate(() => { calState.view = 'smmreview'; return _calReviewMode(); });
const smmReviewApprove = (smm, pid, comp, dest) => smm.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return 'NO_POST'; try { _calReviewApprove(a.pid, a.comp, a.dest); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid, comp, dest });

(async () => {
  const S = Q.makeOk('P57 SMM review-sheet flow');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    // video + graphic + caption all awaiting SMM review
    await Q.up({ id: PID, name: 'SMR ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', caption_status: 'For SMM Approval', status: 'For SMM Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.video_status === 'For SMM Approval', 'video_status');
    await Q.waitForPost(smm, PID);

    // enter SMM review mode
    const mode = await setSmmReview(smm);
    S.ok(mode === 'smm', '_calReviewMode() is smm in review view (got ' + mode + ')');
    const active = await smm.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? [_calReviewComponentActive(p, 'video', 'smm'), _calReviewComponentActive(p, 'graphic', 'smm'), _calReviewComponentActive(p, 'caption', 'smm')] : null; }, PID);
    S.ok(active && active.every(Boolean), 'all three components active for SMM review (For SMM Approval)');

    // 1) approve video (default) → Kasper Approval
    S.ok((await smmReviewApprove(smm, PID, 'video')) === 'ok', 'SMM approve video call ok');
    let r = await Q.pollRaw(PID, x => x.video_status === 'Kasper Approval', 'video_status', 15000);
    S.ok(r.video_status === 'Kasper Approval', 'SMM approve (default) routes video → Kasper Approval');

    // 2) approve caption with dest client → Client Approval
    S.ok((await smmReviewApprove(smm, PID, 'caption', 'client')) === 'ok', 'SMM approve caption→client call ok');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Client Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Client Approval', 'SMM approve (dest client) routes caption → Client Approval');

    // 3) request change on graphic → Tweaks Needed (back to editor)
    await smm.evaluate((a) => { _calReviewState.drafts[a.pid + '|graphic'] = 'SMM: swap the thumbnail'; try { _calReviewRequestTweak(a.pid, 'graphic'); } catch (e) {} }, { pid: PID });
    r = await Q.pollRaw(PID, x => x.graphic_status === 'Tweaks Needed' && (x.graphic_tweaks || '').includes('swap the thumbnail'), 'graphic_status,graphic_tweaks', 15000);
    S.ok(r.graphic_status === 'Tweaks Needed', 'SMM request-change routes graphic → Tweaks Needed');

    // cross-surface: video now surfaces to Kasper, caption to client
    S.ok(await Q.kasperLoadHas(kas, PID), 'card surfaces to Kasper (video at Kasper Approval)');
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    S.ok((await Q.clientCompActive(cli, PID, 'caption')) === true, 'caption active for the client after SMM routed it');

    S.ok(smm._errs.length === 0 && kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...kas._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
