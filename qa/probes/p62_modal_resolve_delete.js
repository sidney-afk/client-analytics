// p62 — "SMM marks as done" (resolve) + delete, from the Notes modal.
//   • two open client tweaks: SMM marks the FIRST done → resolved (done_by SMM), no chooser
//     (another tweak still open), status unchanged.
//   • SMM marks the SECOND (last) done → resolve-destination chooser appears → pick Client →
//     resolved AND caption routes to Client Approval.
//   • SMM deletes a comment → tombstoned (deleted), gone cross-surface.
//   • client delete guard: a client CANNOT delete an SMM comment (_calCanDeleteComment).
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_m62_' + TS;
const now = () => new Date().toISOString();
const tweak = (id, body) => ({ id, parent_id: null, author: 'Client', role: 'client', is_tweak: true, round: 1, audience: 'client', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const smmNote = (id, body) => ({ id, parent_id: null, author: 'Synchro Social', role: 'smm', is_tweak: false, audience: 'client', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const R1 = 't1_' + TS, R2 = 't2_' + TS, SN = 'sn_' + TS;

const isDone = async (pid, id) => { const r = await Q.rawRow(pid, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const c = a.find(x => x.id === id); return c ? !!c.done : '__missing__'; };
const isDeleted = async (pid, id) => { const r = await Q.rawRow(pid, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const c = a.find(x => x.id === id); return c ? !!c.deleted : '__missing__'; };

(async () => {
  const S = Q.makeOk('P62 modal resolve + delete');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'M62 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Tweaks Needed', status: 'Tweaks Needed',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([tweak(R1, 'CR one ' + TS), tweak(R2, 'CR two ' + TS), smmNote(SN, 'SMM note ' + TS)]) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(R1), 'caption_tweaks');
    await Q.waitForPost(smm, PID, "p=>p.caption_status==='Tweaks Needed'");
    await smm.evaluate((pid) => openCalComments(pid), PID);

    // 1) resolve the FIRST tweak (another still open → no chooser)
    const res1 = await smm.evaluate((a) => { try { _calToggleCommentDone(a.R1); return !!document.getElementById('resolveDestOverlay').classList.contains('active'); } catch (e) { return 'ERR ' + e.message; } }, { R1 });
    S.ok(res1 === false, 'resolving the first of two tweaks did NOT open the chooser');
    let r = await Q.pollRaw(PID, x => { let a = []; try { a = JSON.parse(x.caption_tweaks || '[]'); } catch (e) {} const c = a.find(y => y.id === R1); return c && c.done; }, 'caption_tweaks,caption_status', 12000);
    S.ok((await isDone(PID, R1)) === true, 'first tweak marked done');
    S.ok((await isDone(PID, R2)) === false, 'second tweak still open');
    S.ok(r.caption_status === 'Tweaks Needed', 'status unchanged while a tweak is still open');
    const doneBy = await smm.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); const list = _calCommentsFor(p, 'caption'); const c = list.find(y => y.id === a.R1); return c ? c.done_by : null; }, { pid: PID, R1 });
    S.ok(!!doneBy, 'resolved tweak records done_by (' + doneBy + ')');

    // 2) resolve the LAST tweak → chooser → pick Client
    const opened = await smm.evaluate((a) => { try { _calToggleCommentDone(a.R2); } catch (e) {} return !!document.getElementById('resolveDestOverlay').classList.contains('active'); }, { R2 });
    S.ok(opened === true, 'resolving the LAST tweak OPENS the resolve-destination chooser');
    await smm.evaluate(() => { const b = document.getElementById('resolveDestClient'); if (b) b.click(); });
    r = await Q.pollRaw(PID, x => x.caption_status === 'Client Approval', 'caption_status,caption_tweaks', 15000);
    S.ok((await isDone(PID, R2)) === true, 'last tweak marked done');
    S.ok(r.caption_status === 'Client Approval', 'resolving the last tweak via chooser routes caption → Client Approval');

    // 3) SMM deletes a comment → tombstoned
    await smm.evaluate((a) => { try { _calDeleteComment(a.SN); } catch (e) {} }, { SN });
    await smm.waitForTimeout(400);
    await smm.evaluate(() => { const b = document.getElementById('confirmYes'); if (b) b.click(); });
    await Q.pollRaw(PID, x => { let a = []; try { a = JSON.parse(x.caption_tweaks || '[]'); } catch (e) {} const c = a.find(y => y.id === SN); return c && c.deleted; }, 'caption_tweaks', 12000);
    S.ok((await isDeleted(PID, SN)) === true, 'SMM delete tombstones the comment (deleted=true)');

    // 4) client delete guard — client cannot delete an SMM comment
    await Q.waitForPost(cli, PID, "p=>p.id==='" + PID + "'");
    const guard = await cli.evaluate((a) => {
      openCalComments(a.pid);
      const p = (calState.posts || []).find(x => x.id === a.pid);
      const list = _calCommentsFor(p, 'caption');
      const smmC = list.find(y => y.role === 'smm');
      const clientC = list.find(y => y.role === 'client');
      return { canDeleteSmm: smmC ? _calCanDeleteComment(smmC) : null, canDeleteOwn: clientC ? _calCanDeleteComment(clientC) : null, role: _calCommentRole() };
    }, { pid: PID });
    S.ok(guard.role === 'client' && guard.canDeleteSmm === false, 'client CANNOT delete an SMM comment');
    S.ok(guard.canDeleteOwn === true, 'client CAN delete its own comment');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
