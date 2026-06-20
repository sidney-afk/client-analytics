// p15 — §10.6 component-pair interleaving: VIDEO (Kasper tweak loop) × TITLE (its own
// Kasper→Client→Approved) on one YouTube card. Asserts the TITLE INVARIANT (title never
// affects overall), independent queue membership, and that acting on one never disturbs the other.
const Q = require('./lib.js');
const PID = 'p_vt_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P15 video×title');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    // video=KA, graphic+caption=Approved, title engaged at KA. overall = lower(video,graphic,caption) = KA.
    await Q.up({ id: PID, name: 'VT ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', title_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval' && r.title_status === 'Kasper Approval', 'video_status,title_status');

    S.ok(await Q.kasperLoadHas(kas, PID), 'step0: card in Kasper queue (video+title at KA)');
    S.ok((await Q.overallOn(kas, PID, 'kasper')) === 'Kasper Approval', 'step0: overall = Kasper Approval (title excluded)');

    // 1) Kasper approves TITLE → Client Approval. overall unchanged (still KA from video). video untouched.
    console.log('  kasperApprove(title):', await Q.kasperApprove(kas, PID, 'title'));
    let r = await Q.pollRaw(PID, x => x.title_status === 'Client Approval', 'title_status,video_status');
    S.ok(r.title_status === 'Client Approval', 'step1: title → Client Approval');
    S.ok(r.video_status === 'Kasper Approval', 'step1: video UNCHANGED (KA) — title approve didnt touch video');
    S.ok((await Q.overallOn(kas, PID, 'kasper')) === 'Kasper Approval', 'step1: overall still Kasper Approval (title at CA does not raise overall)');
    S.ok(await Q.kasperLoadHas(kas, PID), 'step1: card stays in queue (video still KA)');

    // 2) Kasper requests change on VIDEO → Tweaks Needed. overall = TN. title untouched.
    console.log('  kasperRequest(video):', await Q.kasperRequest(kas, PID, 'video', 'Kasper: tweak video'));
    r = await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed', 'video_status,title_status');
    S.ok(r.video_status === 'Tweaks Needed', 'step2: video → Tweaks Needed');
    S.ok(r.title_status === 'Client Approval', 'step2: title UNCHANGED (Client Approval)');
    S.ok((await Q.overallOn(kas, PID, 'kasper')) === 'Tweaks Needed', 'step2: overall = Tweaks Needed (video TN; title irrelevant)');

    // 3) Client approves TITLE → Approved. overall still TN (video). video untouched.
    await Q.clientHasCaption(cli, PID, null);
    await cli.evaluate(async () => { try { await loadCalendarPosts(); } catch(e){} await new Promise(x=>setTimeout(x,1200)); });
    console.log('  clientApprove(title):', await Q.clientApprove(cli, PID, 'title'));
    r = await Q.pollRaw(PID, x => x.title_status === 'Approved', 'title_status,video_status');
    S.ok(r.title_status === 'Approved', 'step3: title → Approved (client)');
    S.ok(r.video_status === 'Tweaks Needed', 'step3: video UNCHANGED (TN)');
    S.ok((await Q.overallOn(cli, PID, 'cal')) === 'Tweaks Needed', 'step3: overall still Tweaks Needed (title Approved does NOT raise overall)');

    // 4) SMM resolves video → client. overall = Client Approval. card leaves queue.
    await Q.smmResolveTweak(PID, 'video', 'Client Approval');
    r = await Q.pollRaw(PID, x => x.video_status === 'Client Approval', 'video_status');
    S.ok(r.video_status === 'Client Approval', 'step4: video → Client Approval (SMM resolve)');
    S.ok(await Q.kasperGoneFromQueue(kas, PID), 'step4: card leaves Kasper queue (no KA, no unresolved tweak)');

    // 5) Client approves VIDEO → Approved. overall = Approved (all 3 real comps Approved).
    await cli.evaluate(async () => { try { await loadCalendarPosts(); } catch(e){} await new Promise(x=>setTimeout(x,1200)); });
    console.log('  clientApprove(video):', await Q.clientApprove(cli, PID, 'video'));
    r = await Q.pollRaw(PID, x => x.video_status === 'Approved', 'video_status,title_status');
    S.ok(r.video_status === 'Approved', 'step5: video → Approved');
    S.ok((await Q.overallOn(cli, PID, 'cal')) === 'Approved', 'step5: overall = Approved');

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0,3)) + ')');
    S.ok(cli._errs.length === 0, 'no JS errors on client (' + JSON.stringify(cli._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
