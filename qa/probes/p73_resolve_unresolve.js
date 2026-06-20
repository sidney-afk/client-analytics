// p73 — resolve / unresolve a change-request via the REAL toggle handler
// (_calToggleCommentDone). Client raises TWO change-requests on caption; the SMM
// resolves the first (a second stays open, so the destination-chooser doesn't fire),
// then unresolves it. Verifies the done flag flips both ways, persists, and the
// other request is untouched. Mirrors the SMM clicking "Resolve" then "Reopen".
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_resolve_' + TS;
const T1 = 'REQ-ONE-' + TS, T2 = 'REQ-TWO-' + TS;

const toggle = (page, pid, rootId) => page.evaluate(async (a) => {
  _calOpenCommentsPid = a.pid; _calToggleCommentDone(a.rootId);
  try { await _calFlushCardSave(a.pid); } catch (e) {}
  return 'ok';
}, { pid, rootId });
const isDone = (r, body) => { let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const c = a.find(x => (x.body || '') === body); return c ? !!c.done : false; };

(async () => {
  const S = Q.makeOk('P73 resolve/unresolve');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'RESOLVE ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(cli, PID); await Q.waitForPost(smm, PID);

    // client raises two change-requests on caption
    for (const body of [T1, T2]) {
      await cli.evaluate(async (a) => { _calComposeComp = 'caption'; _calComposeIsTweak = true; _calAppendComment(a.pid, null, a.body); try { await _calFlushCardSave(a.pid); } catch (e) {} }, { pid: PID, body });
      await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(body), 'caption_tweaks');
    }
    const seed = await Q.rawRow(PID, 'caption_tweaks'); let arr = []; try { arr = JSON.parse(seed.caption_tweaks || '[]'); } catch (e) {}
    const r1 = arr.find(c => (c.body || '') === T1), r2 = arr.find(c => (c.body || '') === T2);
    S.ok(r1 && r1.is_tweak && !r1.done && r2 && r2.is_tweak && !r2.done, 'two open change-requests seeded by the client');

    // SMM resolves the FIRST (second stays open → no destination chooser)
    await Q.waitForPost(smm, PID, "p=>(_calCommentsFor(p,'caption')||[]).filter(c=>c.is_tweak&&!c.done&&!c.deleted).length>=2");
    await toggle(smm, PID, r1.id);
    const rA = await Q.pollRaw(PID, r => isDone(r, T1), 'caption_tweaks', 12000);
    S.ok(isDone(rA, T1) === true, 'first request marked resolved (done=true)');
    S.ok(isDone(rA, T2) === false, 'second request left untouched (still open)');

    // SMM unresolves the first (reopen) — wasDone=true so it just flips back, no chooser
    await Q.waitForPost(smm, PID, "p=>(_calCommentsFor(p,'caption')||[]).some(c=>c.body==='" + T1 + "'&&c.done)");
    await toggle(smm, PID, r1.id);
    const rB = await Q.pollRaw(PID, r => !isDone(r, T1), 'caption_tweaks', 12000);
    S.ok(isDone(rB, T1) === false, 'first request reopened (done=false again)');

    S.ok(cli._errs.length === 0 && smm._errs.length === 0, 'no JS errors (' + JSON.stringify([...cli._errs, ...smm._errs].slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
      const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() }));
      await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
