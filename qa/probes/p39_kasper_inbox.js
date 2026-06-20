// p39 — Kasper Messages/Replies inbox interaction (the Kasper side).
//   - an internal SMM note surfaces the card in Kasper's inbox
//   - Kasper replies from the inbox → reply is internal, role kasper, THREADED under the SMM root,
//     on the right component; card clears from the inbox
//   - SMM sees the Kasper reply (internal visible to team); client does NOT (internal hidden)
//   - mark-as-read on a second card clears it from the inbox
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_kib_' + TS, PID2 = 'p_kib2_' + TS;
const now = () => new Date().toISOString();
const smmNote = (id, body) => ({ id, parent_id: null, author: 'Synchro Social', role: 'smm', is_tweak: false, audience: 'internal', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const NOTE1 = 'SMM-NOTE-' + TS, NOTE2 = 'SMM-NOTE2-' + TS, REPLY = 'KASPER-REPLY-' + TS;

(async () => {
  const S = Q.makeOk('P39 kasper-inbox');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'KIB ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([smmNote('sn1_' + TS, NOTE1)]) });
    await Q.up({ id: PID2, name: 'KIB2 ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([smmNote('sn2_' + TS, NOTE2)]) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(NOTE1), 'caption_tweaks');
    await Q.pollRaw(PID2, r => (r.caption_tweaks || '').includes(NOTE2), 'caption_tweaks');

    // 1) both cards surface in Kasper's replies inbox
    const inboxHas = async (pid) => kas.evaluate(async (pid) => {
      for (let i = 0; i < 18; i++) { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 900)); if ((_kasperState.replies || []).some(x => x.post.id === pid)) return true; }
      return (_kasperState.replies || []).some(x => x.post.id === pid);
    }, pid);
    S.ok(await inboxHas(PID), 'card surfaces in Kasper Messages inbox (unread internal SMM note)');

    // 2) Kasper replies from the inbox
    const replyRes = await kas.evaluate(async (a) => {
      const it = (_kasperState.replies || []).find(x => x.post.id === a.pid); if (!it) return 'NO_ITEM';
      it._replyDraft = a.body;
      try { await _kasperRepliesReply(a.pid); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
    }, { pid: PID, body: REPLY });
    S.ok(replyRes === 'ok', 'Kasper reply call ok (' + replyRes + ')');
    const r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(REPLY), 'caption_tweaks', 15000);
    let arr = []; try { arr = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const reply = arr.find(c => (c.body || '').includes(REPLY));
    S.ok(reply && reply.role === 'kasper' && reply.audience === 'internal' && reply.is_tweak === false, 'reply is internal + role kasper + not a tweak');
    S.ok(reply && reply.parent_id === 'sn1_' + TS, 'reply is THREADED under the SMM internal root (parent_id matches)');

    // 3) card cleared from Kasper inbox after replying
    const stillInbox = await kas.evaluate((pid) => (_kasperState.replies || []).some(x => x.post.id === pid), PID);
    S.ok(!stillInbox, 'card cleared from Kasper inbox after reply');

    // 4) SMM sees the reply; client does NOT
    await Q.waitForPost(smm, PID);
    const smmSees = await smm.evaluate(async (a) => { for (let i = 0; i < 18; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800)); const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { const bodies = _calCommentsForView(p, 'caption').map(c => c.body); if (bodies.some(b => b.includes(a.REPLY))) return true; } } return false; }, { pid: PID, REPLY });
    S.ok(smmSees, 'SMM sees the Kasper reply (internal visible to the team)');
    await Q.clientHasCaption(cli, PID, null);
    const cliSees = await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return false; return _calCommentsForView(p, 'caption').map(c => c.body).some(b => b.includes(a.REPLY)); }, { pid: PID, REPLY });
    S.ok(!cliSees, 'client does NOT see the Kasper reply (internal hidden)');

    // 5) mark-as-read clears the second card from the inbox
    S.ok(await inboxHas(PID2), 'second card in inbox before mark-read');
    await kas.evaluate((pid) => { try { _kasperMarkRepliesRead(pid); } catch (e) {} }, PID2);
    const cleared = await kas.evaluate((pid) => !(_kasperState.replies || []).some(x => x.post.id === pid), PID2);
    S.ok(cleared, 'mark-as-read clears the card from the Kasper inbox');

    S.ok(kas._errs.length === 0 && smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors on any surface (' + JSON.stringify([...kas._errs, ...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    for (const id of [PID, PID2]) { const row = await Q.rawRow(id, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); try { await Q.up({ id, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
