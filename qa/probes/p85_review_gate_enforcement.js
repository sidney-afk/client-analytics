// p85 — the review-gate is enforced in the HANDLER, not just hidden in the UI. A client
// must NOT be able to approve a component that's still in internal review (Kasper / For
// SMM Approval) — only one on their surface (Client Approval) or sent back for tweaks.
// Guards against a client forcing a component straight to Approved, skipping Kasper.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_gate_' + TS;

(async () => {
  const S = Q.makeOk('P85 review-gate enforcement');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  try {
    // caption is in KASPER review (not client purview); graphic is on the client surface
    await Q.up({ id: PID, name: 'GATE ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Client Approval', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Kasper Approval', 'caption_status');
    await Q.waitForPost(cli, PID, "p=>p.graphic_status==='Client Approval'");

    // client tries to approve the Kasper-stage caption → must be a NO-OP
    await Q.clientApprove(cli, PID, 'caption');
    await cli.waitForTimeout(2500);
    let r = await Q.rawRow(PID, 'caption_status,graphic_status');
    S.ok(r.caption_status === 'Kasper Approval', 'client CANNOT approve a Kasper-stage component (stays Kasper Approval)');

    // client tries to approve a (hypothetical) For-SMM-Approval component too → blocked
    await Q.up({ id: PID, video_status: 'For SMM Approval' });
    await Q.waitForPost(cli, PID, "p=>p.video_status==='For SMM Approval'");
    await Q.clientApprove(cli, PID, 'video');
    await cli.waitForTimeout(2500);
    r = await Q.rawRow(PID, 'video_status');
    S.ok(r.video_status === 'For SMM Approval', 'client CANNOT approve a For-SMM-Approval component either');

    // but the client CAN approve the component on their surface (Client Approval)
    await Q.clientApprove(cli, PID, 'graphic');
    r = await Q.pollRaw(PID, x => x.graphic_status === 'Approved', 'graphic_status', 12000);
    S.ok(r.graphic_status === 'Approved', 'client CAN approve the component on their surface (graphic → Approved)');

    S.ok(cli._errs.length === 0, 'no JS errors (' + JSON.stringify(cli._errs.slice(0, 3)) + ')');
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
