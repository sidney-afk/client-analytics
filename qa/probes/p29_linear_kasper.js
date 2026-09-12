const { seedStaffGate } = require('../staff-gate-seed.js');
// p29 — KASPER REVIEW ACTIONS → WRITE ROUTING (no real Linear, no real gateway).
//
// WHAT CHANGED ON 2026-09-08. This probe waited for `linear-add-comment` and
// `linear-set-status` and passed when it saw them. Both teams have been
// SyncView-authoritative since 2026-08-28 and every active client is enrolled,
// so Kasper's approve and request-change have not taken those webhooks for
// weeks — the probe stayed green only because the harness put the TEST client
// on a lane no real client runs. It now asserts the same two behaviours against
// the native gateway, and asserts the retired webhooks receive NOTHING.
//   - Kasper "request change" on video → native comment intent on the VIDEO work item
//   - Kasper "approve" on video        → native status intent, status client_approval
// Both must target the card's OWN work item.
const Q = require('./lib.js');
const NW = require('../native_work_item_fixture.js');
const TS = Math.floor(Date.now() / 1000);
const REQ = 'p_lk_req_' + TS, APP = 'p_lk_app_' + TS;
const vurl = (id) => 'https://linear.app/sidtest/issue/' + id;
const REQ_VID = NW.nativeDeliverableId(REQ, 'video');
const APP_VID = NW.nativeDeliverableId(APP, 'video');

(async () => {
  const S = Q.makeOk('P29 kasper-write-routing');
  const browser = await Q.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagProduction(ctx);  // route the TEST client the way production routes a real one (see lib.js)
  await seedStaffGate(ctx);
  const retired = await NW.captureRetiredWebhooks(ctx);
  const gateway = await NW.stubNativeGateway(ctx);
  await NW.stubNativeWorkItems(ctx, [
    { id: REQ, components: ['video'] },
    { id: APP, components: ['video'] }
  ]);
  const kas = await ctx.newPage(); kas._errs = [];
  kas.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) kas._errs.push(m.text()); });
  kas.on('pageerror', e => kas._errs.push(String(e && e.message)));
  const waitFor = async (pred, ms = 16000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await new Promise(x => setTimeout(x, 400)); } return false; };

  try {
    const VREQ = vurl('LKREQ-' + TS), VAPP = vurl('LKAPP-' + TS);
    // two cards with a video work item, video at Kasper Approval (in queue)
    for (const [id, vu] of [[REQ, VREQ], [APP, VAPP]]) {
      await Q.up({ id, name: 'LK ' + id.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
        video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval',
        linear_issue_id: vu, thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    }
    await Q.pollRaw(REQ, r => String(r.linear_issue_id || '').includes('LKREQ-' + TS), 'linear_issue_id', 14000);
    await Q.pollRaw(APP, r => String(r.linear_issue_id || '').includes('LKAPP-' + TS), 'linear_issue_id', 14000);

    await kas.goto('http://localhost:8000/index.html?Kasper=1&v2debug=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await kas.waitForTimeout(8000);

    // The native lane needs a verified staff identity; the retired webhooks did
    // not. See qa/native_work_item_fixture.js.
    const staff = await NW.seedVerifiedProbeStaff(kas, { role: 'kasper', memberId: 'probe_kasper', memberName: 'Probe Kasper' });
    S.ok(staff === 'ok', 'a verified staff identity is in place, as a signed-in reviewer has (' + staff + ')');

    // Kasper request change on video → native comment intent on the video work item
    await Q.kasperLoadHas(kas, REQ);
    await Q.kasperRequest(kas, REQ, 'video', 'Kasper: tighten the cut at 0:12');
    await waitFor(() => NW.commentCalls(gateway, REQ_VID).length >= 1);
    const reqNote = NW.commentCalls(gateway, REQ_VID)[0];
    S.ok(!!reqNote, 'Kasper request-change went to the NATIVE gateway for the video work item');
    S.ok(reqNote && reqNote.comment && /tighten the cut/i.test(String(reqNote.comment.body || '')),
      'and carries the tweak body');
    await Q.pollRow(REQ, x => x.caption_status !== undefined); // settle

    // Kasper approve on video → native status intent
    await Q.kasperLoadHas(kas, APP);
    await Q.kasperApprove(kas, APP, 'video');
    await waitFor(() => NW.statusCalls(gateway, APP_VID).length >= 1);
    const approve = NW.statusCalls(gateway, APP_VID)
      .find(c => c && c.status === 'client_approval');
    S.ok(!!approve,
      'Kasper approve sent the native status intent client_approval for the video work item ('
      + JSON.stringify(NW.statusCalls(gateway, APP_VID).map(c => c.status)) + ')');

    // The assertion the old probe inverted.
    S.ok(NW.retiredCallCount(retired) === 0,
      'NOTHING reached the retired Linear webhooks (' + NW.retiredCallCount(retired) + ' calls)');

    // cross-client safety, re-expressed for native ids
    const targets = gateway.map(c => String((c && c.id) || (c && c.issue) || ''));
    S.ok(targets.length > 0 && targets.every(id => id === REQ_VID || id === APP_VID),
      'every gateway intent targeted these two cards\' own work items: ' + JSON.stringify([...new Set(targets)]));
    S.ok(kas._errs.length === 0, 'Kasper: 0 JS errors (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
    console.log('gateway intents:', JSON.stringify(gateway.map(c => ({ op: c.operation, id: c.id, status: c.status }))));
  } finally {
    await Q.up({ id: REQ, status: 'Archived' }); await Q.up({ id: APP, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
