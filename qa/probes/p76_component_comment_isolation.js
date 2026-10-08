// p76 — per-component comment isolation. A note posted on the caption thread must
// land in caption_tweaks ONLY, and a note on the video thread in video_tweaks ONLY —
// never bleeding across components. _calCommentsFor(post, comp) must return each
// component's own messages. (Cross-component bleed would show a client the wrong
// feedback under the wrong asset.)
//
// THE VIDEO SIDE MOVED (OPEN_REPAIRS 373). Since the 2026-08-28 video flip a
// video note lives on the card's native video work item, and a card with no
// work item refuses one (native_link_required) -- so this probe, which seeded
// a card with none, had its video note refused and went red. The card now
// carries a video work item (qa/native_work_item_fixture.js, gateway mocked),
// and the same isolation is asserted where each note lives today: the caption
// note in caption_tweaks and never at the gateway, the video note at the
// gateway against the VIDEO work item and never in caption_tweaks.
const Q = require('./lib.js');
const NW = require('../native_work_item_fixture.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_compiso_' + TS;
const CAP = 'CAPTION-NOTE-' + TS, VID = 'VIDEO-NOTE-' + TS;
const VIDEO_WORK_ITEM = NW.nativeDeliverableId(PID, 'video');
NW.registerProbeWorkItems([{ id: PID, components: ['video'] }]);

const post = async (page, pid, comp, body) => {
  const thread = await NW.waitForNoteThread(page, pid, comp);
  return page.evaluate(async (a) => {
    _calComposeComp = a.comp; _calComposeAudience = 'internal'; _calComposeIsTweak = false;
    const saved = await _calAppendComment(a.pid, null, a.body); try { await _calFlushCardSave(a.pid); } catch (e) {}
    return a.thread + '/' + saved;
  }, { pid, comp, body, thread });
};

(async () => {
  const S = Q.makeOk('P76 component comment isolation');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const gateway = await NW.stubNativeGateway(smm.context());
  try {
    await Q.up({ id: PID, name: 'COMPISO ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Client Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID);
    S.ok(await NW.seedVerifiedProbeStaff(smm) === 'ok', 'a verified staff identity is in place, as a signed-in SMM has');

    const capSent = await post(smm, PID, 'caption', CAP);
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(CAP), 'caption_tweaks');
    const capGateway = gateway.length;
    const vidSent = await post(smm, PID, 'video', VID);
    S.ok(vidSent === 'ready/true', 'the video note is accepted once its thread has loaded (' + vidSent + ', caption ' + capSent + ')');
    const t = Date.now(); while (Date.now() - t < 16000 && !NW.commentCalls(gateway, VIDEO_WORK_ITEM).length) await new Promise(x => setTimeout(x, 400));
    const r = await Q.rawRow(PID, 'caption_tweaks,video_tweaks');
    const vidCalls = NW.commentCalls(gateway, VIDEO_WORK_ITEM);

    S.ok((r.caption_tweaks || '').includes(CAP), 'caption note is in caption_tweaks');
    S.ok(!(r.caption_tweaks || '').includes(VID), 'caption_tweaks does NOT contain the video note');
    S.ok(capGateway === 0, 'the caption note never reached a work item (gateway calls ' + capGateway + ')');
    S.ok(vidCalls.length === 1 && String(vidCalls[0].comment && vidCalls[0].comment.body || '').includes(VID)
      && vidCalls[0].comment.component === 'video', 'video note went to the VIDEO work item, filed against video');
    S.ok(gateway.every(c => !String(c && c.comment && c.comment.body || '').includes(CAP)), 'no work item received the caption note');
    S.ok(!(r.video_tweaks || '').includes(CAP), 'video_tweaks does NOT contain the caption note');

    // app-level: _calCommentsFor keeps them separate
    const split = await smm.evaluate(async (a) => {
      for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700));
        const p = (calState.posts || []).find(x => x.id === a.pid);
        if (p && (_calCommentsFor(p, 'caption') || []).length && (_calCommentsFor(p, 'video') || []).length) break; }
      const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return null;
      return { cap: (_calCommentsFor(p, 'caption') || []).filter(c => !c.deleted).map(c => c.body),
               vid: (_calCommentsFor(p, 'video') || []).filter(c => !c.deleted).map(c => c.body) };
    }, { pid: PID });
    S.ok(split && split.cap.includes(CAP) && !split.cap.includes(VID), '_calCommentsFor(caption) returns only the caption note');
    S.ok(split && split.vid.includes(VID) && !split.vid.includes(CAP), '_calCommentsFor(video) returns only the video note');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks,video_tweaks'); const now = new Date().toISOString();
      const tomb = (s) => { let a = []; try { a = JSON.parse(s || '[]'); } catch (e) {} return JSON.stringify(a.map(c => Object.assign({}, c, { deleted: true, updated_at: now }))); };
      await Q.up({ id: PID, caption_tweaks: tomb(r.caption_tweaks), video_tweaks: tomb(r.video_tweaks), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
