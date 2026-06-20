// p17 — Kasper "finish reviewing" (_kasperDismiss) lifecycle:
//  (a) BLOCKED while any component is still undecided (at Kasper Approval, no decision)
//  (b) clean-approve all → dismiss removes the card from the queue
//  (c) one tweak-requested → dismiss stamps kasper_finished_at + keeps it as "Tweaks pending"
// Multi-component card (video + caption) so we can leave one undecided.
const Q = require('./lib.js');

async function dismiss(kas, pid) {
  return kas.evaluate(async (pid) => { try { await _kasperDismiss(pid); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, pid);
}
async function undecided(kas, pid) {
  return kas.evaluate((pid) => { const it = (_kasperState.items||[]).find(x=>x.post.id===pid); return it ? _kasperUndecidedComps(it.post) : 'NO_ITEM'; }, pid);
}

(async () => {
  const S = Q.makeOk('P17 kasper-finish');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  try {
    // ---- (a) blocked while undecided: video=KA, caption=KA (both undecided) ----
    const A = 'p_kf_a_' + Math.floor(Date.now() / 1000);
    await Q.up({ id: A, name: 'KF-A ' + A.slice(-5), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(A, r => r.video_status === 'Kasper Approval' && r.caption_status === 'Kasper Approval', 'video_status,caption_status');
    await Q.kasperLoadHas(kas, A);
    // approve only video; leave caption undecided
    await Q.kasperApprove(kas, A, 'video');
    await Q.pollRow(A, x => x.video_status === 'Client Approval');
    const undec = await undecided(kas, A);
    S.ok(Array.isArray(undec) && undec.includes('caption'), '(a) caption still undecided (' + JSON.stringify(undec) + ')');
    const d1 = await dismiss(kas, A);
    await new Promise(x => setTimeout(x, 1500));
    const stillThere = await Q.kasperLoadHas(kas, A);
    S.ok(stillThere, '(a) finish BLOCKED while caption undecided — card remains in queue');
    await Q.archive(A);

    // ---- (b) clean approve all → dismiss removes from queue ----
    const B = 'p_kf_b_' + Math.floor(Date.now() / 1000);
    await Q.up({ id: B, name: 'KF-B ' + B.slice(-5), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(B, r => r.video_status === 'Kasper Approval' && r.caption_status === 'Kasper Approval', 'video_status,caption_status');
    await Q.kasperLoadHas(kas, B);
    await Q.kasperApprove(kas, B, 'video'); await Q.pollRow(B, x => x.video_status === 'Client Approval');
    await Q.kasperApprove(kas, B, 'caption'); await Q.pollRow(B, x => x.caption_status === 'Client Approval');
    const undecB = await undecided(kas, B);
    S.ok(Array.isArray(undecB) && undecB.length === 0, '(b) no undecided components after approving both');
    const d2 = await dismiss(kas, B);
    S.ok(d2 === 'ok', '(b) dismiss call ok (' + d2 + ')');
    S.ok(await Q.kasperGoneFromQueue(kas, B), '(b) clean-approve finish removes card from queue');
    await Q.archive(B);

    // ---- (c) one tweak-requested → dismiss stamps finished, stays as Tweaks pending ----
    const C = 'p_kf_c_' + Math.floor(Date.now() / 1000);
    await Q.up({ id: C, name: 'KF-C ' + C.slice(-5), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(C, r => r.video_status === 'Kasper Approval' && r.caption_status === 'Kasper Approval', 'video_status,caption_status');
    await Q.kasperLoadHas(kas, C);
    await Q.kasperApprove(kas, C, 'video'); await Q.pollRow(C, x => x.video_status === 'Client Approval');
    await Q.kasperRequest(kas, C, 'caption', 'Kasper: tweak caption'); await Q.pollRow(C, x => x.caption_status === 'Tweaks Needed');
    const undecC = await undecided(kas, C);
    S.ok(Array.isArray(undecC) && undecC.length === 0, '(c) no undecided (video approved, caption tweak-requested)');
    const d3 = await dismiss(kas, C);
    S.ok(d3 === 'ok', '(c) dismiss call ok (' + d3 + ')');
    const cRow = await Q.pollRaw(C, r => String(r.kasper_finished_at || '').trim() !== '', 'kasper_finished_at,caption_status', 12000);
    S.ok(String(cRow.kasper_finished_at || '').trim() !== '', '(c) kasper_finished_at stamped (' + cRow.kasper_finished_at + ')');
    S.ok(cRow.caption_status === 'Tweaks Needed', '(c) caption still Tweaks Needed (handed to SMM, not approved)');
    await Q.archive(C);

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0,4)) + ')');
  } finally { await browser.close(); }
  process.exit(S.done());
})();
