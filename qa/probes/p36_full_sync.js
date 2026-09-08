// p36 — CAPSTONE: a video component driven through the full review lifecycle by all three
// actors, asserting at EVERY step that the status is consistent across:
//   (a) the database (Supabase row), (b) the Kasper queue, (c) the client surface,
//   (d) the WRITE the browser actually sends (intercepted, nothing real is mutated).
//
// WHAT CHANGED ON 2026-09-08. (d) used to mean "the Linear push", and the probe waited for
// `linear-set-status` / `linear-add-comment`. Both teams have been SyncView-authoritative
// since 2026-08-28 and every active client is enrolled in `write_ui_reroute_clients`, so
// none of these five steps takes those webhooks in production — the probe stayed green only
// because the harness answered the roster read with `[]` and put the TEST client on a lane
// no real client runs. It now asserts native gateway intents, and asserts the two retired
// webhooks receive NOTHING. Same five steps, same three surfaces, same DB assertions.
//
// The card is given a native work item at fixture level (`qa/native_work_item_fixture.js`)
// because minting a real one needs a write this harness cannot make; read that file first.
const Q = require('./lib.js');
const NW = require('../native_work_item_fixture.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_fs_' + TS;
const VURL = 'https://linear.app/sidtest/issue/FS-' + TS;   // legacy link column, no longer the write target
const VID = NW.nativeDeliverableId(PID, 'video');

// One ledger for all three surfaces: the lifecycle crosses contexts, and a step's write may
// come from whichever surface acted. Retired-webhook captures stay per-context so a leak can
// be attributed to the surface that produced it.
const gateway = [];
const retiredCaptures = [];

async function mkPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagProduction(ctx);  // route the TEST client the way production routes a real one (see lib.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  retiredCaptures.push(await NW.captureRetiredWebhooks(ctx));
  await NW.stubNativeGateway(ctx, { onCall: payload => gateway.push(payload) });
  await NW.stubNativeWorkItems(ctx, [{ id: PID, components: ['video'] }]);
  const p = await ctx.newPage(); p._errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) p._errs.push(m.text()); });
  p.on('pageerror', e => p._errs.push(String(e && e.message)));
  return p;
}
const waitFor = async (pred, ms = 18000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await new Promise(x => setTimeout(x, 400)); } return false; };
const hasStatus = (native) => () => NW.statusCalls(gateway, VID).some(c => c.status === native);

(async () => {
  const S = Q.makeOk('P36 full-sync');
  const browser = await Q.launch();
  const smm = await mkPage(browser);
  const kas = await mkPage(browser);
  const cli = await mkPage(browser);
  try {
    await Q.up({ id: PID, name: 'FS ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval',
      linear_issue_id: VURL, thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => String(r.linear_issue_id || '').includes('FS-' + TS) && r.video_status === 'Kasper Approval', 'linear_issue_id,video_status', 14000);

    await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
    await smm.waitForTimeout(2500);
    await kas.goto('http://localhost:8000/index.html?Kasper=1&v2debug=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await kas.waitForTimeout(8000);
    // The native lane needs a VERIFIED staff identity on the two STAFF surfaces; the retired
    // webhooks needed none. The client tab is deliberately excluded — its review token is its
    // credential, and a second one is rejected as ambiguous_credentials.
    const smmStaff = await NW.seedVerifiedProbeStaff(smm);
    const kasStaff = await NW.seedVerifiedProbeStaff(kas, { role: 'kasper', memberId: 'probe_kasper', memberName: 'Probe Kasper' });
    S.ok(smmStaff === 'ok' && kasStaff === 'ok',
      'both staff surfaces carry a verified identity (' + smmStaff + '/' + kasStaff + ')');
    const clientToken = await Q.currentTestClientToken();
    await Q.gotoTestClientEntry(cli, {
      origin: Q.ORIGIN,
      view: 'calendar',
      name: Q.TEST_CLIENT.name,
      token: clientToken,
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 },
    });
    await cli.waitForTimeout(5000);

    // STEP 1 — initial: in Kasper queue, client does NOT see video (internal KA)
    S.ok(await Q.kasperLoadHas(kas, PID), 'step1 DB=KA: card in Kasper queue');
    await Q.clientHasCaption(cli, PID, null);
    S.ok((await Q.clientCompActive(cli, PID, 'video')) === false, 'step1: client does NOT see video (internal Kasper Approval)');

    // STEP 2 — Kasper approve → Client Approval. DB + native write + queue + client.
    await Q.kasperApprove(kas, PID, 'video');
    let r = await Q.pollRaw(PID, x => x.video_status === 'Client Approval', 'video_status', 16000);
    S.ok(r.video_status === 'Client Approval', 'step2 DB: video → Client Approval (Kasper approve)');
    S.ok(await waitFor(hasStatus('client_approval')), 'step2 NATIVE: status intent client_approval for the video work item');
    S.ok(await Q.kasperGoneFromQueue(kas, PID), 'step2 QUEUE: card leaves Kasper queue');
    await cli.evaluate(async () => { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 1200)); });
    S.ok((await Q.clientCompActive(cli, PID, 'video')) === true, 'step2 CLIENT: client now sees video awaiting approval');

    // STEP 3 — Client request change → Tweaks Needed. DB + native status + native comment.
    await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return; _calReviewState.drafts[a.pid + '|video'] = a.body; try { _calReviewRequestTweak(a.pid, 'video'); } catch (e) {} }, { pid: PID, body: 'Client: re-cut the intro' });
    r = await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed', 'video_status', 16000);
    S.ok(r.video_status === 'Tweaks Needed', 'step3 DB: video → Tweaks Needed (client request)');
    S.ok(await waitFor(hasStatus('tweak')), 'step3 NATIVE: status intent tweak');
    S.ok(await waitFor(() => NW.commentCalls(gateway, VID)
      .some(c => /re-cut the intro/i.test(String(c.comment && c.comment.body || '')))),
      'step3 NATIVE: the client tweak comment went to the video work item');

    // STEP 4 — SMM moves video back to Client Approval. DB + native write.
    // Refresh the SMM page so it has seen the client's step-3 write FIRST — otherwise the SMM's
    // save base is stale and the upsert's conflict guard correctly rejects it ("someone else
    // updated this card"). A human would see the Tweaks-Needed flip before acting; mirror that.
    await Q.waitForPost(smm, PID, "p=>p.video_status==='Tweaks Needed'");
    const beforeStep4 = NW.statusCalls(gateway, VID).filter(c => c.status === 'client_approval').length;
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'Client Approval', 'video'); } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => x.video_status === 'Client Approval', 'video_status', 16000);
    S.ok(r.video_status === 'Client Approval', 'step4 DB: SMM moves video → Client Approval');
    S.ok(await waitFor(() => NW.statusCalls(gateway, VID).filter(c => c.status === 'client_approval').length > beforeStep4),
      'step4 NATIVE: a FURTHER status intent client_approval (the SMM re-push, not step 2\'s)');

    // STEP 5 — Client approve → Approved. DB + native write.
    await cli.evaluate(async () => { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 1200)); });
    await cli.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); if (!p) return; try { _calReviewApprove(pid, 'video'); } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => x.video_status === 'Approved', 'video_status', 16000);
    S.ok(r.video_status === 'Approved', 'step5 DB: video → Approved (client approve)');
    S.ok(await waitFor(hasStatus('approved')), 'step5 NATIVE: status intent approved');

    // Nothing anywhere in the lifecycle reached the retiring webhooks. After 2026-09-15 those
    // URLs accept a write and drop it, so one call here is a silent loss in production.
    S.ok(NW.retiredCallCount(retiredCaptures) === 0,
      'NOTHING reached the retired Linear webhooks across all three surfaces ('
      + NW.retiredCallCount(retiredCaptures) + ' calls)');

    // every native intent targeted this card's own work item
    const targets = gateway.map(c => String((c && c.id) || (c && c.issue) || ''));
    S.ok(targets.length > 0 && targets.every(id => id === VID),
      'all gateway intents targeted this card\'s own work item (no cross-leak): ' + JSON.stringify([...new Set(targets)]));
    S.ok(smm._errs.length === 0 && kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors on any surface (' + JSON.stringify([...smm._errs, ...kas._errs, ...cli._errs].slice(0, 3)) + ')');
    console.log('NATIVE status intents:', JSON.stringify(NW.statusCalls(gateway, VID).map(c => c.status)));
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
