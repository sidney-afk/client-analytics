const { seedStaffGate } = require('../staff-gate-seed.js');
// p30 — CLIENT REVIEW ACTIONS → WRITE ROUTING (no real Linear, no real gateway).
//
// WHAT CHANGED ON 2026-09-08. This probe waited for `linear-set-status` and
// `linear-add-comment` and passed when it saw them. Every active client is
// enrolled in `write_ui_reroute_clients` and both teams are
// SyncView-authoritative, so a real client's approve and request-change have
// not taken those webhooks for weeks; the probe stayed green only because the
// harness put the TEST client on a lane no real client runs.
//
// A CLIENT COMMENT HAS A SECOND GATE the staff surfaces do not: the
// `client_comment_gateway_enabled` FRONT DOOR (live `{"enabled":true}` since
// 2026-08-14) plus a crosswalk that proves the work item describes this card.
// Both are supplied here the way production supplies them —
// `qa/write_ui_reroute_fixture.js` serves the real flag value, and
// `qa/native_work_item_fixture.js` answers the crosswalk with a row that
// genuinely matches the card — so the comment exercises the shipped native
// path rather than the legacy fallback.
//   - client "request change" on video → native comment intent + status intent tweak
//   - client "approve" on video        → native status intent approved
const Q = require('./lib.js');
const NW = require('../native_work_item_fixture.js');
const TS = Math.floor(Date.now() / 1000);
const REQ = 'p_lc_req_' + TS, APP = 'p_lc_app_' + TS;
const vurl = (id) => 'https://linear.app/sidtest/issue/' + id;
const REQ_VID = NW.nativeDeliverableId(REQ, 'video');
const APP_VID = NW.nativeDeliverableId(APP, 'video');

(async () => {
  const S = Q.makeOk('P30 client-write-routing');
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
  const cli = await ctx.newPage(); cli._errs = [];
  cli.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) cli._errs.push(m.text()); });
  cli.on('pageerror', e => cli._errs.push(String(e && e.message)));
  const waitFor = async (pred, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await new Promise(x => setTimeout(x, 400)); } return false; };

  try {
    const VREQ = vurl('LCREQ-' + TS), VAPP = vurl('LCAPP-' + TS);
    for (const [id, vu] of [[REQ, VREQ], [APP, VAPP]]) {
      await Q.up({ id, name: 'LC ' + id.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
        video_status: 'Client Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Client Approval',
        linear_issue_id: vu, thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    }
    await Q.pollRaw(REQ, r => String(r.linear_issue_id || '').includes('LCREQ-' + TS), 'linear_issue_id', 14000);
    await Q.pollRaw(APP, r => String(r.linear_issue_id || '').includes('LCAPP-' + TS), 'linear_issue_id', 14000);

    // A client link carries its own credential (the review token). No staff
    // identity is seeded here — a second credential is rejected as
    // ambiguous_credentials, which is production behaviour, not a workaround.
    const clientToken = await Q.currentTestClientToken();
    await Q.gotoTestClientEntry(cli, {
      origin: Q.ORIGIN,
      view: 'calendar',
      name: Q.TEST_CLIENT.name,
      token: clientToken,
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 },
    });
    await cli.waitForTimeout(5000);

    const seenNativeId = await cli.evaluate((a) => {
      const p = (calState.posts || []).find(x => x.id === a.pid);
      return p ? String(p.video_deliverable_id || '') : null;
    }, { pid: REQ });
    S.ok(seenNativeId === REQ_VID,
      'the card carries its native work item in the client tab (' + seenNativeId + ')');

    // fire both client actions, then wait generously and assert on the final captured
    // arrays (gateway latency can delay one past a per-step window — not a routing error).
    await Q.clientHasCaption(cli, REQ, null);
    await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return; _calReviewState.drafts[a.pid + '|video'] = a.body; try { _calReviewRequestTweak(a.pid, 'video'); } catch (e) {} }, { pid: REQ, body: 'Client: please brighten the thumbnail frame' });
    await Q.clientHasCaption(cli, APP, null);
    await cli.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); if (!p) return; try { _calReviewApprove(pid, 'video'); } catch (e) {} }, APP);

    await waitFor(() => NW.commentCalls(gateway, REQ_VID).length >= 1);
    await waitFor(() => NW.statusCalls(gateway, APP_VID).some(c => c.status === 'approved'));
    await cli.waitForTimeout(2000);

    const reqNote = NW.commentCalls(gateway, REQ_VID)[0];
    S.ok(!!reqNote && /brighten/i.test(String(reqNote.comment && reqNote.comment.body || '')),
      'client request-change posted the tweak to the VIDEO work item through the NATIVE gateway');
    S.ok(!!reqNote && reqNote.comment && reqNote.comment.audience === 'client',
      'and is filed as a client-audience comment (audience=' + (reqNote && reqNote.comment && reqNote.comment.audience) + ')');
    S.ok(NW.statusCalls(gateway, REQ_VID).some(c => c.status === 'tweak'),
      'client request-change sent the native status intent tweak for the VIDEO work item');
    S.ok(NW.statusCalls(gateway, APP_VID).some(c => c.status === 'approved'),
      'client approve sent the native status intent approved for the VIDEO work item');

    // The assertion the old probe inverted. After 2026-09-15 those URLs accept
    // a write and drop it, so one call here is a silent loss in production.
    S.ok(NW.retiredCallCount(retired) === 0,
      'NOTHING reached the retired Linear webhooks (' + NW.retiredCallCount(retired) + ' calls)');

    const targets = gateway.map(c => String((c && c.id) || (c && c.issue) || ''));
    S.ok(targets.length > 0 && targets.every(id => id === REQ_VID || id === APP_VID),
      'all client→gateway intents targeted these cards\' own work items: ' + JSON.stringify([...new Set(targets)]));
    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0, 3)) + ')');
    console.log('gateway intents:', JSON.stringify(gateway.map(c => ({ op: c.operation, id: c.id, status: c.status }))));
  } finally {
    try { await Q.up({ id: REQ, status: 'Archived' }); } catch (e) {}
    try { await Q.up({ id: APP, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
