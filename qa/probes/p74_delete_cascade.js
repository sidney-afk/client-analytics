// p74 — delete a comment via the REAL handler (_calDeleteComment) and verify the
// tombstone cascades to its replies, disappears from every surface, and the open
// count drops to zero. Deletion uses a soft tombstone (deleted:true + fresh
// updated_at) so a laggy merge can't resurrect it. The confirm dialog is auto-
// accepted (we test the data effect, not the dialog UI).
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_del_' + TS;
const ROOT = 'DEL-ROOT-' + TS, REPLY = 'DEL-REPLY-' + TS;

const post = (page, pid, parent, body) => page.evaluate(async (a) => {
  _calComposeComp = 'caption'; _calComposeAudience = 'internal'; _calComposeIsTweak = false;
  _calAppendComment(a.pid, a.parent, a.body); try { await _calFlushCardSave(a.pid); } catch (e) {}
}, { pid, parent, body });

(async () => {
  const S = Q.makeOk('P74 delete cascade');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'DELETE ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID); await Q.waitForPost(cli, PID);

    await post(smm, PID, null, ROOT);
    const afterRoot = await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(ROOT), 'caption_tweaks');
    let arr = []; try { arr = JSON.parse(afterRoot.caption_tweaks || '[]'); } catch (e) {}
    const root = arr.find(c => (c.body || '') === ROOT);
    await post(smm, PID, root.id, REPLY);
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(REPLY), 'caption_tweaks');

    const liveCount = async () => { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} return a.filter(c => !c.deleted && /DEL-(ROOT|REPLY)/.test(c.body || '')).length; };
    S.ok((await liveCount()) === 2, 'root + reply live before delete');

    // SMM deletes the ROOT (auto-accept the confirm) → cascade to the reply
    await smm.evaluate(async (a) => {
      window.showConfirm = (t, m, cb) => { if (typeof cb === 'function') cb(); };
      _calOpenCommentsPid = a.pid; _calDeleteComment(a.rootId);
      try { await _calFlushCardSave(a.pid); } catch (e) {}
    }, { pid: PID, rootId: root.id });

    const after = await Q.pollRaw(PID, r => { let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const rt = a.find(c => (c.body || '') === ROOT), rp = a.find(c => (c.body || '') === REPLY); return rt && rt.deleted && rp && rp.deleted; }, 'caption_tweaks', 16000);
    let fa = []; try { fa = JSON.parse(after.caption_tweaks || '[]'); } catch (e) {}
    const rt = fa.find(c => (c.body || '') === ROOT), rp = fa.find(c => (c.body || '') === REPLY);
    S.ok(rt && rt.deleted === true, 'root tombstoned (deleted=true, preserved not dropped)');
    S.ok(rp && rp.deleted === true, 'reply tombstoned by cascade (deleted=true)');
    S.ok((await liveCount()) === 0, 'zero live messages after delete');

    // gone from both rendered surfaces
    const visible = (page) => page.evaluate(async (a) => { for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); } const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return []; return (_calCommentsForView(p, 'caption') || []).filter(c => !c.deleted).map(c => c.body || ''); }, { pid: PID });
    const smmVis = await visible(smm), cliVis = await visible(cli);
    S.ok(!smmVis.includes(ROOT) && !smmVis.includes(REPLY), 'SMM surface no longer shows the deleted thread');
    S.ok(!cliVis.includes(ROOT) && !cliVis.includes(REPLY), 'client surface no longer shows the deleted thread');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
