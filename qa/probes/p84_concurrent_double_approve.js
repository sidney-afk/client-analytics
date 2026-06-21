// p84 — two people approve the SAME component at the same time. Two independent client
// sessions both approve the caption (each has its own in-page save lock, but they don't
// share one) → must converge cleanly to Approved with no JS errors and no half-written
// state. ("What if two people approve at once.")
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_dblappr_' + TS;

(async () => {
  const S = Q.makeOk('P84 concurrent double-approve');
  const browser = await Q.launch();
  const cli1 = await Q.clientPage(browser);
  const cli2 = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'DBLAPPR ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(cli1, PID, "p=>p.caption_status==='Client Approval'");
    await Q.waitForPost(cli2, PID, "p=>p.caption_status==='Client Approval'");

    // both approve the caption at the same time
    const [r1, r2] = await Promise.all([
      Q.clientApprove(cli1, PID, 'caption'),
      Q.clientApprove(cli2, PID, 'caption'),
    ]);
    S.ok(r1 === 'ok' && r2 === 'ok', 'both approve calls ran (' + r1 + ',' + r2 + ')');

    const r = await Q.pollRaw(PID, x => x.caption_status === 'Approved', 'caption_status,status,client_caption_approved_at', 16000);
    S.ok(r.caption_status === 'Approved', 'caption converged to Approved (no stuck/half state)');
    S.ok(String(r.client_caption_approved_at || '').trim() !== '', 'client approval timestamp recorded');
    S.ok(r.status === 'Approved', 'overall converged to Approved (all components Approved)');
    S.ok(cli1._errs.length === 0 && cli2._errs.length === 0, 'no JS errors on either session (' + JSON.stringify([...cli1._errs, ...cli2._errs].slice(0, 3)) + ')');
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
