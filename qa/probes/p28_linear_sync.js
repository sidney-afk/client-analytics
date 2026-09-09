// p28 — WRITE ROUTING FOR A STATUS CHANGE AND A NOTE (the user's top priority).
//
// WHAT THIS PROBE USED TO ASSERT, AND WHY IT WAS WRONG. Until 2026-09-08 it
// waited for calls to `linear-set-status` and `linear-add-comment` and passed
// when it saw them. Both teams have been SyncView-authoritative since
// 2026-08-28 and every active client is enrolled in `write_ui_reroute_clients`,
// so a real staff status change has not taken those webhooks for weeks. The
// probe stayed green only because the harness answered the roster read with
// `[]` and put the TEST client on a lane no real client runs
// (`qa/write_ui_reroute_fixture.js`). Fixing the roster left this probe
// asserting the retired traffic, which is the defect one layer down: a green
// nightly describing a dead world.
//
// WHAT IT ASSERTS NOW. The same six routing questions, against the lane the
// product actually takes:
//   - video status change   → native gateway intent {operation:'status', id:<video deliverable>}
//   - graphic status change → native gateway intent for the GRAPHIC deliverable
//   - caption status change → no transport at all (no work item of its own)
//   - video note            → native gateway intent {operation:'comment', id:<video deliverable>}
//   - caption note          → no transport at all
//   - and the two retired Linear webhooks receive NOTHING, which is the
//     assertion whose absence let the old version pass.
//
// The card is given a native work item at fixture level
// (`qa/native_work_item_fixture.js`) because minting a real one needs a write
// this harness cannot make; read that file before changing this.
const Q = require('./lib.js');
const NW = require('../native_work_item_fixture.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_lin_' + TS;
const VURL = 'https://linear.app/sidtest/issue/SIDV-' + TS;     // legacy link column, no longer the write target
const GURL = 'https://linear.app/sidtest/issue/SIDG-' + TS;
const VID = NW.nativeDeliverableId(PID, 'video');
const GID = NW.nativeDeliverableId(PID, 'graphic');

(async () => {
  const S = Q.makeOk('P28 write-routing');
  const browser = await Q.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagProduction(ctx);  // route the TEST client the way production routes a real one (see lib.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const retired = await NW.captureRetiredWebhooks(ctx);
  const gateway = await NW.stubNativeGateway(ctx);
  await NW.stubNativeWorkItems(ctx, [{ id: PID, components: ['video', 'graphic'] }]);
  const smm = await ctx.newPage();
  smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));

  const waitFor = async (pred, ms = 14000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await new Promise(x => setTimeout(x, 400)); } return false; };

  try {
    await Q.up({ id: PID, name: 'LIN ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress',
      linear_issue_id: VURL, graphic_linear_issue_id: GURL,
      // Both approval picks below need something to review (2026-09-05 owner
      // rule, `_kasperCompReviewable`): a status move into an approval state is
      // refused on an empty component, so the card carries a video asset and a
      // thumbnail exactly as a real card at this point in the pipeline does.
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    // backend may blank a colliding link; these are unique so they persist
    await Q.pollRaw(PID, r => String(r.linear_issue_id || '').includes('SIDV-' + TS), 'linear_issue_id', 14000);

    await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
    await smm.waitForTimeout(2500);
    await Q.waitForPost(smm, PID);

    // The native lane needs a VERIFIED staff identity; the retired webhooks
    // needed none, which is one more way this probe used to exercise a softer
    // path than a real SMM does. Synthetic key, mocked gateway — see the
    // fixture header.
    const staff = await NW.seedVerifiedProbeStaff(smm);
    S.ok(staff === 'ok', 'a verified staff identity is in place, as a signed-in SMM has (' + staff + ')');

    // The fixture only helps if the page actually READ the stamped id — assert
    // that first, so a later "no gateway call" cannot be misread as a routing
    // finding when it was really a fixture that never landed.
    const seenNativeId = await smm.evaluate((a) => {
      const p = (calState.posts || []).find(x => x.id === a.pid);
      return p ? { v: p.video_deliverable_id || '', g: p.graphic_deliverable_id || '' } : null;
    }, { pid: PID });
    S.ok(!!seenNativeId && seenNativeId.v === VID && seenNativeId.g === GID,
      'the card carries its native work items in the page (' + JSON.stringify(seenNativeId) + ')');

    // 1) video status change → native gateway, video deliverable, mapped status
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'Tweaks Needed', 'video'); } catch (e) {} }, PID);
    await waitFor(() => NW.statusCalls(gateway, VID).length >= 1);
    const vcall = NW.statusCalls(gateway, VID)[0];
    S.ok(!!vcall, 'video status change went to the NATIVE gateway for the video work item');
    S.ok(vcall && vcall.status === 'tweak',
      'video intent carries the mapped native status (status=' + (vcall && vcall.status) + ')');
    S.ok(vcall && vcall.surface === 'calendar' && vcall.entity === 'deliverable',
      'and is shaped as a calendar deliverable write');

    // 2) graphic status change → the GRAPHIC deliverable, never the video one
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'For SMM Approval', 'graphic'); } catch (e) {} }, PID);
    await waitFor(() => NW.statusCalls(gateway, GID).length >= 1);
    const gcall = NW.statusCalls(gateway, GID)[0];
    S.ok(!!gcall, 'graphic status change went to the GRAPHIC work item, not the video one');
    S.ok(gcall && gcall.status === 'smm_approval',
      'graphic intent carries the mapped native status (status=' + (gcall && gcall.status) + ')');

    // 3) caption status change → no transport at all. Caption owns no work
    //    item (OPEN_REPAIRS 127), so this must not reach the gateway EITHER —
    //    the old probe only checked it did not reach Linear.
    const beforeCap = gateway.length;
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'Kasper Approval', 'caption'); } catch (e) {} }, PID);
    await smm.waitForTimeout(6000);
    S.ok(gateway.length === beforeCap,
      'caption status change transports NOTHING (gateway calls ' + beforeCap + '→' + gateway.length + ')');

    // 4) video NOTE → native gateway comment intent on the video work item
    await smm.evaluate((a) => {
      openCalComments(a.pid); _calComposeComp = 'video'; _calComposeIsTweak = false;
      const ta = document.getElementById('calCommentComposer'); if (ta) ta.value = a.body;
      _calSubmitComposer();
    }, { pid: PID, body: 'VIDEO-NOTE-' + TS });
    await waitFor(() => NW.commentCalls(gateway, VID).length >= 1);
    const vnote = NW.commentCalls(gateway, VID)[0];
    S.ok(!!vnote, 'video note went to the NATIVE gateway');
    S.ok(vnote && vnote.comment && String(vnote.comment.body || '').includes('VIDEO-NOTE-' + TS),
      'video note carries its body to the VIDEO work item');
    S.ok(vnote && vnote.comment && vnote.comment.component === 'video',
      'and is filed against the video component');

    // 5) caption NOTE → no transport at all
    const beforeCapNote = gateway.length;
    await smm.evaluate((a) => {
      openCalComments(a.pid); _calComposeComp = 'caption'; _calComposeIsTweak = false;
      const ta = document.getElementById('calCommentComposer'); if (ta) ta.value = a.body;
      _calSubmitComposer();
    }, { pid: PID, body: 'CAPTION-NOTE-' + TS });
    await smm.waitForTimeout(6000);
    S.ok(gateway.length === beforeCapNote,
      'caption note transports NOTHING (gateway calls ' + beforeCapNote + '→' + gateway.length + ')');

    // 6) THE ASSERTION THE OLD PROBE INVERTED. Nothing reached the retiring
    //    webhooks. After 2026-09-15 those URLs accept a write and drop it, so a
    //    single call here is a silent data loss in production.
    S.ok(NW.retiredCallCount(retired) === 0,
      'NOTHING reached the retired Linear webhooks (' + NW.retiredCallCount(retired) + ' calls)');

    // 7) cross-client safety, re-expressed for native ids: every intent this
    //    run produced names one of THIS card's two work items.
    const targets = gateway.map(c => String((c && c.id) || (c && c.issue) || ''));
    S.ok(targets.length > 0 && targets.every(id => id === VID || id === GID),
      'every gateway intent targeted this card\'s own work items (no cross-client leak): '
      + JSON.stringify([...new Set(targets)]));
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
    console.log('gateway intents:', JSON.stringify(gateway.map(c => ({ op: c.operation, id: c.id, status: c.status }))));
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
