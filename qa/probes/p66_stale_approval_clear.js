// p66 — audit-trail integrity: when the SMM regresses a component below Client Approval, its
// client_<comp>_approved_at sign-off must clear (the row shouldn't read "approved at <date>" on a
// card now in Tweaks Needed), and kasper_approved_at clears once NOTHING is at/above Client Approval.
// Components still at/above Client Approval keep their stamps.
const Q = require('./lib.js');
const PID = 'p_sa_' + Math.floor(Date.now() / 1000);
const stamp = '2026-06-10T12:00:00.000Z';

(async () => {
  const S = Q.makeOk('P66 stale-approval clearing');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'SA ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      client_video_approved_at: stamp, client_graphic_approved_at: stamp, client_caption_approved_at: stamp, kasper_approved_at: stamp,
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.client_caption_approved_at === stamp, 'client_caption_approved_at');
    await Q.waitForPost(smm, PID);

    // 1) regress caption → Tweaks Needed: caption stamp clears; video/graphic stamps + kasper stamp kept
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'Tweaks Needed', 'caption'); } catch (e) {} }, PID);
    let r = await Q.pollRaw(PID, x => x.caption_status === 'Tweaks Needed', 'caption_status,client_caption_approved_at,client_video_approved_at,kasper_approved_at', 15000);
    S.ok(!String(r.client_caption_approved_at || '').trim(), 'regressed caption: client_caption_approved_at CLEARED');
    S.ok(r.client_video_approved_at === stamp, 'video stamp KEPT (video still Approved)');
    S.ok(r.kasper_approved_at === stamp, 'kasper_approved_at KEPT (video/graphic still Approved)');

    // 2) regress video + graphic → For SMM Approval: their stamps clear; kasper stamp now clears too
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'For SMM Approval', 'video'); } catch (e) {} }, PID);
    await Q.pollRaw(PID, x => x.video_status === 'For SMM Approval', 'video_status');
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'For SMM Approval', 'graphic'); } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => x.graphic_status === 'For SMM Approval', 'graphic_status,client_video_approved_at,client_graphic_approved_at,kasper_approved_at', 15000);
    S.ok(!String(r.client_video_approved_at || '').trim(), 'regressed video: client_video_approved_at CLEARED');
    S.ok(!String(r.client_graphic_approved_at || '').trim(), 'regressed graphic: client_graphic_approved_at CLEARED');
    S.ok(!String(r.kasper_approved_at || '').trim(), 'kasper_approved_at CLEARED (nothing at/above Client Approval anymore)');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
