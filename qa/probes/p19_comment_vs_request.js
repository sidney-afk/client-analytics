// p19 — §4.9: a client COMMENT must NOT flip status (and is client-audience, visible to SMM);
// a client CHANGE-REQUEST flips the component to Tweaks Needed. Verifies the distinction live.
const Q = require('./lib.js');
const PID = 'p_cmt_' + Math.floor(Date.now() / 1000);

const clientComment = (cli, pid, comp, body) => cli.evaluate((a) => {
  const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return 'NO_POST';
  _calReviewState.drafts[a.pid + '|' + a.comp] = a.body;
  try { _calReviewComment(a.pid, a.comp); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
}, { pid, comp, body });

(async () => {
  const S = Q.makeOk('P19 comment-vs-request');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'CMT ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.clientHasCaption(cli, PID, 'Client Approval');

    // 1) plain COMMENT → no status flip
    console.log('  clientComment:', await clientComment(cli, PID, 'caption', 'CLIENT-COMMENT-' + PID.slice(-5)));
    // poll until the comment lands, then assert status unchanged
    let row = await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes('CLIENT-COMMENT-' + PID.slice(-5)), 'caption_status,caption_tweaks', 15000);
    S.ok((row.caption_tweaks || '').includes('CLIENT-COMMENT-' + PID.slice(-5)), 'comment landed in caption_tweaks');
    S.ok(row.caption_status === 'Client Approval', 'plain COMMENT did NOT flip status (still Client Approval)');
    // audience + not-a-tweak
    let arr = []; try { arr = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {}
    const cmt = arr.find(c => (c.body || '').includes('CLIENT-COMMENT-' + PID.slice(-5)));
    S.ok(cmt && cmt.is_tweak === false, 'comment is_tweak === false');
    S.ok(cmt && cmt.audience === 'client', 'comment audience === client (visible to SMM)');

    // 2) CHANGE-REQUEST → flips to Tweaks Needed.
    // The UI disables the Comment/Request buttons while saving[key] is true (so a real
    // user cannot fire this during the comment's save). Mirror that: wait for saving to clear.
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 30; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);
    console.log('  clientRequest:', await Q.clientRequest(cli, PID, 'caption', 'CLIENT-REQ-' + PID.slice(-5)));
    row = await Q.pollRaw(PID, r => r.caption_status === 'Tweaks Needed', 'caption_status,caption_tweaks', 15000);
    S.ok(row.caption_status === 'Tweaks Needed', 'CHANGE-REQUEST flipped caption → Tweaks Needed');
    let arr2 = []; try { arr2 = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {}
    const req = arr2.find(c => (c.body || '').includes('CLIENT-REQ-' + PID.slice(-5)));
    S.ok(req && req.is_tweak === true, 'change-request is_tweak === true');
    // the earlier plain comment is still present (not lost)
    S.ok(arr2.some(c => (c.body || '').includes('CLIENT-COMMENT-' + PID.slice(-5))), 'earlier comment still present after change-request');

    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,3)) + ')');
  } finally {
    // tombstone comments + archive
    const row = await Q.rawRow(PID, 'caption_tweaks');
    let arr = []; try { arr = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {}
    const tomb = arr.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() }));
    await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
