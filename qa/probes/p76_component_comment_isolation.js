// p76 — per-component comment isolation. A note posted on the caption thread must
// land in caption_tweaks ONLY, and a note on the video thread in video_tweaks ONLY —
// never bleeding across components. _calCommentsFor(post, comp) must return each
// component's own messages. (Cross-component bleed would show a client the wrong
// feedback under the wrong asset.)
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_compiso_' + TS;
const CAP = 'CAPTION-NOTE-' + TS, VID = 'VIDEO-NOTE-' + TS;

const post = (page, pid, comp, body) => page.evaluate(async (a) => {
  _calComposeComp = a.comp; _calComposeAudience = 'internal'; _calComposeIsTweak = false;
  _calAppendComment(a.pid, null, a.body); try { await _calFlushCardSave(a.pid); } catch (e) {}
}, { pid, comp, body });

(async () => {
  const S = Q.makeOk('P76 component comment isolation');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'COMPISO ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Client Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID);

    await post(smm, PID, 'caption', CAP);
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(CAP), 'caption_tweaks');
    await post(smm, PID, 'video', VID);
    const r = await Q.pollRaw(PID, x => (x.video_tweaks || '').includes(VID), 'caption_tweaks,video_tweaks', 16000);

    S.ok((r.caption_tweaks || '').includes(CAP), 'caption note is in caption_tweaks');
    S.ok(!(r.caption_tweaks || '').includes(VID), 'caption_tweaks does NOT contain the video note');
    S.ok((r.video_tweaks || '').includes(VID), 'video note is in video_tweaks');
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
