// p05 — §10.6 multi-component interleaving + §6/§14 cross-surface.
// A YouTube card runs VIDEO through a Kasper tweak loop WHILE CAPTION sits at Client
// Approval. Asserts at each step: component sub-statuses (backend), app-computed overall
// (lower-wins), Kasper-queue membership, and client-surface component activeness — and that
// acting on one component never disturbs the other.
const Q = require('./lib.js');
const PID = 'p_intl_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P05 interleave');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    // Seed: video=Kasper Approval, graphic=Approved, caption=Client Approval. YouTube, asset+thumb.
    await Q.up({ id: PID, name: 'INTERLEAVE ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval' && r.caption_status === 'Client Approval', 'video_status,caption_status');

    // step1: Kasper queue has it (video at KA); client shows caption active, video NOT active.
    S.ok(await Q.kasperLoadHas(kas, PID), 'step1: card in Kasper queue (video at KA)');
    S.ok(await Q.clientHasCaption(cli, PID, 'Client Approval'), 'step1: client loaded card, caption at Client Approval');
    S.ok((await Q.clientCompActive(cli, PID, 'caption')) === true, 'step1: client sees CAPTION as awaiting approval');
    S.ok((await Q.clientCompActive(cli, PID, 'video')) === false, 'step1: client does NOT see VIDEO (it is internal Kasper Approval)');
    S.ok((await Q.overallOn(kas, PID, 'kasper')) === 'Kasper Approval', 'step1: overall = Kasper Approval (lower-wins video KA < caption CA)');

    // step2: Kasper requests change on VIDEO → Tweaks Needed; caption untouched; overall TN.
    console.log('  kasperRequest(video):', await Q.kasperRequest(kas, PID, 'video', 'Kasper: tweak the video'));
    let r = await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed', 'video_status,caption_status');
    S.ok(r.video_status === 'Tweaks Needed', 'step2: video → Tweaks Needed');
    S.ok(r.caption_status === 'Client Approval', 'step2: caption UNCHANGED at Client Approval (cross-component independence)');
    S.ok(await Q.kasperLoadHas(kas, PID), 'step2: card stays in Kasper queue (pinned with unresolved video tweak)');
    S.ok((await Q.overallOn(kas, PID, 'kasper')) === 'Tweaks Needed', 'step2: overall = Tweaks Needed (video TN drags it down)');

    // step3: client approves CAPTION independently → caption Approved; video untouched (TN); overall still TN.
    await Q.clientHasCaption(cli, PID, 'Client Approval');
    console.log('  clientApprove(caption):', await Q.clientApprove(cli, PID, 'caption'));
    r = await Q.pollRaw(PID, x => x.caption_status === 'Approved', 'video_status,caption_status');
    S.ok(r.caption_status === 'Approved', 'step3: caption → Approved (client)');
    S.ok(r.video_status === 'Tweaks Needed', 'step3: video UNCHANGED at Tweaks Needed (client approve didnt touch video)');

    // step4: SMM resolves video tweak → client → video Client Approval; card leaves Kasper queue.
    await Q.smmResolveTweak(PID, 'video', 'Client Approval');
    r = await Q.pollRaw(PID, x => x.video_status === 'Client Approval', 'video_status,caption_status');
    S.ok(r.video_status === 'Client Approval', 'step4: SMM resolve→client: video → Client Approval');
    S.ok(await Q.kasperGoneFromQueue(kas, PID), 'step4: card LEAVES Kasper queue (no KA, no unresolved tweak)');

    // step5: client approves VIDEO → Approved; overall Approved.
    S.ok(await Q.clientHasCaption(cli, PID, null), 'step5: client still has card');
    // reload client posts so video shows as Client Approval
    await cli.evaluate(async () => { try { await loadCalendarPosts(); } catch(e){} await new Promise(x=>setTimeout(x,1200)); });
    S.ok((await Q.clientCompActive(cli, PID, 'video')) === true, 'step5: client now sees VIDEO awaiting approval');
    console.log('  clientApprove(video):', await Q.clientApprove(cli, PID, 'video'));
    r = await Q.pollRaw(PID, x => x.video_status === 'Approved', 'video_status,graphic_status,caption_status');
    S.ok(r.video_status === 'Approved', 'step5: video → Approved');
    S.ok((await Q.overallOn(cli, PID, 'cal')) === 'Approved', 'step5: overall = Approved (all 3 components Approved)');

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0,3)) + ')');
    S.ok(cli._errs.length === 0, 'no JS errors on client (' + JSON.stringify(cli._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
