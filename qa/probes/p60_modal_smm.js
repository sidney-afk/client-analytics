const { seedStaffGate } = require('../staff-gate-seed.js');
// p60 — Comments/Notes MODAL (openCalComments) — SMM side. The "clicks on Notes" entry point
// distinct from the Review tab. SMM posts:
//   • an INTERNAL note (Kasper/team) on caption → client does NOT see it
//   • a CLIENT-audience note on caption → client SEES it
//   • a threaded REPLY → inherits the thread's audience (client sees it)
//   • a VIDEO note → routes to the NATIVE gateway (intercepted; nothing real is written)
// Verifies role=smm, audience tagging, threading (parent_id), and cross-surface visibility.
//
// WHAT CHANGED ON 2026-09-08. The video-note check waited for `linear-add-comment`. Both
// teams have been SyncView-authoritative since 2026-08-28 and every active client is
// enrolled, so a real SMM's video note has not taken that webhook for weeks — the probe
// stayed green only because the harness answered the roster read with `[]`. It now asserts
// the native gateway intent, and asserts the retired webhooks receive NOTHING. The card gets
// its native work item from `qa/native_work_item_fixture.js`; read that file first.
const Q = require('./lib.js');
const NW = require('../native_work_item_fixture.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_m60_' + TS;
const INT = 'SMM-INTERNAL-' + TS, CLI = 'SMM-CLIENT-' + TS, REP = 'SMM-REPLY-' + TS, VID = 'SMM-VIDEO-' + TS;
// The card's native work item — the write target on the lane production takes. Named
// VIDEO_WORK_ITEM rather than VID, which is already this probe's video-note body marker.
const VIDEO_WORK_ITEM = NW.nativeDeliverableId(PID, 'video');

const modalPost = (page, pid, o) => page.evaluate((a) => {
  if (_calOpenCommentsPid !== a.pid) openCalComments(a.pid);
  if (a.replyTo) { _calBeginReply(a.replyTo); }
  else { _calReplyTarget = null;
    if (a.comp) _calSetComposeComp(a.comp);
    if (a.audience) _calSetComposeAudience(a.audience);
    if (a.isTweak != null) _calSetComposeIsTweak(!!a.isTweak); }
  const ta = document.getElementById('calCommentComposer');
  if (!ta) return 'NO_COMPOSER';
  ta.value = a.body;
  try { _calSubmitComposer(); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
}, { pid, ...o });

const rootIdByBody = async (pid, comp, needle) => { const r = await Q.rawRow(pid, comp + '_tweaks'); let a = []; try { a = JSON.parse(r[comp + '_tweaks'] || '[]'); } catch (e) {} const m = a.find(c => (c.body || '').includes(needle) && !c.parent_id); return m ? m.id : null; };

(async () => {
  const S = Q.makeOk('P60 comments modal — SMM');
  const browser = await Q.launch();
  // SMM context with Linear interception
  const sctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await Q.stubRerouteFlagProduction(sctx);  // route the TEST client the way production routes a real one (see lib.js)
  await seedStaffGate(sctx);
  // Both contexts are watched, not just the acting one: the client tab below is a separate
  // context, and a capture installed only on the SMM side would let a client-side push slip
  // past the zero-assertion AND out to the live TEST backend. Same finding as p47.
  const retiredCaptures = [];
  const gateway = [];
  async function watch(ctx) {
    retiredCaptures.push(await NW.captureRetiredWebhooks(ctx));
    await NW.stubNativeGateway(ctx, { onCall: payload => gateway.push(payload) });
  }
  await watch(sctx);
  await NW.stubNativeWorkItems(sctx, [{ id: PID, components: ['video'] }]);
  const smm = await sctx.newPage(); smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));
  await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
  await smm.waitForTimeout(2500);
  // The native lane needs a VERIFIED staff identity; the retired webhooks needed none.
  const staff = await NW.seedVerifiedProbeStaff(smm);
  const cli = await Q.clientPage(browser);
  // Watched once it exists; every action under test happens after this point.
  await watch(cli.context());
  try {
    await Q.up({ id: PID, name: 'M60 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'For SMM Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'For SMM Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      linear_issue_id: 'https://linear.app/syn/issue/TEST-60/video', video_tweaks: '[]', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID);

    // 1) internal caption note
    S.ok(await modalPost(smm, PID, { comp: 'caption', audience: 'internal', body: INT }) === 'ok', 'SMM internal caption note posted');
    let r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(INT), 'caption_tweaks', 12000);
    let cap = []; try { cap = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    let mi = cap.find(c => (c.body || '').includes(INT));
    S.ok(mi && mi.role === 'smm' && mi.audience === 'internal' && mi.is_tweak === false, 'internal note: role smm / audience internal / not a tweak');

    // 2) client-audience caption note
    S.ok(await modalPost(smm, PID, { comp: 'caption', audience: 'client', body: CLI }) === 'ok', 'SMM client-audience caption note posted');
    r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(CLI), 'caption_tweaks', 12000);
    cap = JSON.parse(r.caption_tweaks || '[]');
    const mc = cap.find(c => (c.body || '').includes(CLI));
    S.ok(mc && mc.role === 'smm' && mc.audience === 'client', 'client note: role smm / audience client');

    // 3) threaded reply to the client note → inherits client audience
    const clientRootId = await rootIdByBody(PID, 'caption', CLI);
    S.ok(await modalPost(smm, PID, { replyTo: clientRootId, body: REP }) === 'ok', 'SMM reply posted');
    r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(REP), 'caption_tweaks', 12000);
    cap = JSON.parse(r.caption_tweaks || '[]');
    const mr = cap.find(c => (c.body || '').includes(REP));
    S.ok(mr && mr.parent_id === clientRootId, 'reply is threaded under the client root (parent_id matches)');

    // 4) video note routes to the NATIVE gateway (intercepted)
    S.ok(staff === 'ok', 'a verified staff identity is in place, as a signed-in SMM has (' + staff + ')');
    S.ok(await modalPost(smm, PID, { comp: 'video', audience: 'internal', body: VID }) === 'ok', 'SMM video note posted');
    await Q.pollRaw(PID, x => (x.video_tweaks || '').includes(VID), 'video_tweaks', 12000);
    await smm.waitForTimeout(1500);
    S.ok(NW.commentCalls(gateway, VIDEO_WORK_ITEM)
      .some(c => String(c.comment && c.comment.body || '').includes(VID)),
      'video note ROUTED to the NATIVE gateway, against the card\'s own video work item');
    S.ok(!gateway.some(c => JSON.stringify(c).includes(INT) || JSON.stringify(c).includes(CLI)),
      'caption notes transported NOTHING (caption owns no work item — OPEN_REPAIRS 127)');
    S.ok(NW.retiredCallCount(retiredCaptures) === 0,
      'NOTHING reached the retired Linear webhooks, from EITHER surface ('
      + NW.retiredCallCount(retiredCaptures) + ' calls)');

    // 5) cross-surface: client sees the client note + reply, NOT the internal note
    await Q.waitForPost(cli, PID, "p=>p.id==='" + PID + "'");
    const cliView = await cli.evaluate(async (a) => { for (let i = 0; i < 10; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); } const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return null; const bodies = (_calCommentsForView(p, 'caption') || []).map(c => c.body || ''); return { sawClient: bodies.some(b => b.includes(a.CLI)), sawReply: bodies.some(b => b.includes(a.REP)), sawInternal: bodies.some(b => b.includes(a.INT)) }; }, { pid: PID, CLI, REP, INT });
    S.ok(cliView && cliView.sawClient && cliView.sawReply, 'client sees the client-audience note + its reply');
    S.ok(cliView && !cliView.sawInternal, 'client does NOT see the internal note');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { for (const comp of ['caption', 'video']) { const r = await Q.rawRow(PID, comp + '_tweaks'); let a = []; try { a = JSON.parse(r[comp + '_tweaks'] || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() })); await Q.up({ id: PID, [comp + '_tweaks']: JSON.stringify(tomb) }); } await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
