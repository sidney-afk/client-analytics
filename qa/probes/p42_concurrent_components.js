// p42 — §8/§9 concurrency: Kasper and the client act on DIFFERENT components of the SAME card
// at the same instant. Kasper request-change on video (→Tweaks Needed) WHILE client approves
// caption (→Approved). Both must land — neither whole-row write may clobber the other component.
const Q = require('./lib.js');
const PID = 'p_cc_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P42 concurrent-components');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'CC ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval' && r.caption_status === 'Client Approval', 'video_status,caption_status');

    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue (video at KA)');
    S.ok(await Q.clientHasCaption(cli, PID, 'Client Approval'), 'client has card (caption at CA)');
    // make sure client's review state isn't mid-save
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);

    // FIRE BOTH AT ONCE: Kasper request-change on video + client approve caption
    await Promise.all([
      kas.evaluate(async (pid) => { const it = (_kasperState.items || []).find(x => x.post.id === pid); if (it) { it._drafts = it._drafts || {}; it._drafts.video = 'Kasper: re-cut'; try { await _kasperRequestTweakComp(pid, 'video', false); } catch (e) {} } }, PID),
      cli.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); if (p) { try { _calReviewApprove(pid, 'caption'); } catch (e) {} } }, PID),
    ]);

    // wait for both writes to settle, then assert BOTH took effect
    const r = await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed' && x.caption_status === 'Approved', 'video_status,caption_status', 22000);
    console.log('final:', JSON.stringify({ video: r.video_status, caption: r.caption_status }));
    S.ok(r.video_status === 'Tweaks Needed', 'video landed at Tweaks Needed (Kasper request not clobbered)');
    S.ok(r.caption_status === 'Approved', 'caption landed at Approved (client approval not clobbered)');

    S.ok(kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...kas._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
