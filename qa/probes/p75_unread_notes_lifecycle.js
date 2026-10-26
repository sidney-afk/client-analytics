// p75 — unread-notes lifecycle on the client surface (_calHasUnreadNotes /
// _notesMarkSeen). A message from another role lights the unread dot; "catching up"
// (opening the thread marks it seen) clears it; a NEW later message lights it again.
// This is the dot that tells a client "there's something new to read."
//
// The lifecycle runs with the client on the Sheet. The test client's link opens on the Review
// page, and since #2325 (review_client_polish, test client only) a post whose conversation is on
// that stage counts as read as soon as it is drawn, so a probe card on stage never showed a dot and
// steps 1 and 3 were red every night from 2026-10-25. Step 4 asserts that rule itself.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_unread_' + TS;
const M1 = 'SMM-MSG-ONE-' + TS, M2 = 'SMM-MSG-TWO-' + TS, M3 = 'SMM-MSG-THREE-' + TS;

const smmPost = (page, pid, body) => page.evaluate(async (a) => {
  _calComposeComp = 'caption'; _calComposeAudience = 'client'; _calComposeIsTweak = false;
  _calAppendComment(a.pid, null, a.body); try { await _calFlushCardSave(a.pid); } catch (e) {}
}, { pid, body });

// reload the client page until `body` is visible, then report _calHasUnreadNotes
const unreadAfter = (cli, pid, body) => cli.evaluate(async (a) => {
  for (let i = 0; i < 16; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700));
    const p = (calState.posts || []).find(x => x.id === a.pid);
    if (p && (_calCommentsForView(p, 'caption') || []).some(c => (c.body || '') === a.body)) break; }
  const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return null;
  return !!_calHasUnreadNotes(p);
}, { pid, body });

(async () => {
  const S = Q.makeOk('P75 unread-notes lifecycle');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'UNREAD ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID); await Q.waitForPost(cli, PID);
    const sheet = await Q.clientOnSheet(cli);
    S.ok(sheet.view === 'organizer' && !sheet.stageShown, 'client is on the Sheet, off the Review stage (' + JSON.stringify(sheet) + ')');
    // client starts "caught up" on this card (baseline seen = now)
    await cli.evaluate((pid) => { try { _notesMarkSeen(pid); } catch (e) {} }, PID);

    // 1) SMM posts → client should see an unread note
    await smmPost(smm, PID, M1);
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(M1), 'caption_tweaks');
    S.ok((await unreadAfter(cli, PID, M1)) === true, 'unread dot lights after the SMM posts a client message');

    // 2) client catches up (opening the thread marks it seen) → unread clears
    await cli.evaluate((pid) => { try { _notesMarkSeen(pid); } catch (e) {} }, PID);
    const cleared = await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); return p ? !!_calHasUnreadNotes(p) : null; }, { pid: PID });
    S.ok(cleared === false, 'unread clears after the client catches up (marks seen)');

    // 3) a NEW later SMM message lights it again
    await new Promise(x => setTimeout(x, 1100)); // ensure a strictly-later timestamp than "seen"
    await smmPost(smm, PID, M2);
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(M2), 'caption_tweaks');
    S.ok((await unreadAfter(cli, PID, M2)) === true, 'a newer SMM message re-lights the unread dot');

    // 4) #2325's rule: with this post's conversation on the Review stage, a new SMM message is read
    //    as soon as it is drawn, so the dot stays dark and the seen mark moves past the message.
    const staged = await Q.clientStagePost(cli, PID);
    S.ok(staged.onStage === true, 'the probe post is on the client Review stage');
    await new Promise(x => setTimeout(x, 1100));
    await smmPost(smm, PID, M3);
    const r3 = await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(M3), 'caption_tweaks');
    let m3At = ''; try { const c = JSON.parse(r3.caption_tweaks || '[]').find(x => x && x.body === M3); m3At = c ? String(c.updated_at || c.created_at || '') : ''; } catch (e) {}
    const onStage = await cli.evaluate(async (a) => {
      let p = null;
      for (let i = 0; i < 16; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700));
        p = (calState.posts || []).find(x => x.id === a.pid);
        if (p && (_calCommentsForView(p, 'caption') || []).some(c => (c.body || '') === a.body) && String(_notesGetSeen(a.pid) || '') >= a.at) break; }
      return p ? { unread: !!_calHasUnreadNotes(p), seen: String(_notesGetSeen(a.pid) || '') } : null;
    }, { pid: PID, body: M3, at: m3At });
    S.ok(!!m3At && !!onStage && onStage.seen >= m3At && onStage.unread === false,
      'a message drawn on the Review stage counts as read (#2325): no dot (' + JSON.stringify(onStage) + ')');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
      const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() }));
      await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
