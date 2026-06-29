// p39 — Kasper Messages/Replies inbox interaction (the Kasper side).
//   - a reply to one of Kasper's OWN internal threads surfaces the card in his inbox
//   - a fresh SMM internal note Kasper never touched does NOT surface (it's not his conversation)
//   - Kasper replies from the inbox → reply is internal, role kasper, THREADED under his root,
//     on the right component; card clears from the inbox
//   - SMM sees the Kasper reply (internal visible to team); client does NOT (internal hidden)
//   - mark-as-read on a second card clears it from the inbox
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_kib_' + TS, PID2 = 'p_kib2_' + TS, PID3 = 'p_kib3_' + TS;
const now = () => new Date().toISOString();
const kasNote  = (id, body) => ({ id, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: false, audience: 'internal', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const smmReply = (id, parent, body) => ({ id, parent_id: parent, author: 'Synchro Social', role: 'smm', is_tweak: false, audience: 'internal', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const smmNote  = (id, body) => ({ id, parent_id: null, author: 'Synchro Social', role: 'smm', is_tweak: false, audience: 'internal', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const KNOTE1 = 'KASPER-NOTE-' + TS, SREPLY1 = 'SMM-REPLY-' + TS;
const KNOTE2 = 'KASPER-NOTE2-' + TS, SREPLY2 = 'SMM-REPLY2-' + TS;
const SNOTE3 = 'SMM-FRESH-NOTE-' + TS;          // a fresh SMM note with NO Kasper involvement
const REPLY  = 'KASPER-REPLY-' + TS;

(async () => {
  const S = Q.makeOk('P39 kasper-inbox');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    // PID / PID2: an SMM reply on one of Kasper's own internal notes — genuine responses to him.
    await Q.up({ id: PID, name: 'KIB ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([ kasNote('kn1_' + TS, KNOTE1), smmReply('sr1_' + TS, 'kn1_' + TS, SREPLY1) ]) });
    await Q.up({ id: PID2, name: 'KIB2 ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([ kasNote('kn2_' + TS, KNOTE2), smmReply('sr2_' + TS, 'kn2_' + TS, SREPLY2) ]) });
    // PID3: a fresh SMM internal note Kasper never touched — must NOT surface.
    await Q.up({ id: PID3, name: 'KIB3 ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([ smmNote('sn3_' + TS, SNOTE3) ]) });
    await Q.pollRaw(PID,  r => (r.caption_tweaks || '').includes(SREPLY1), 'caption_tweaks');
    await Q.pollRaw(PID2, r => (r.caption_tweaks || '').includes(SREPLY2), 'caption_tweaks');
    await Q.pollRaw(PID3, r => (r.caption_tweaks || '').includes(SNOTE3),  'caption_tweaks');

    // 1) the two reply cards surface; the fresh-SMM-note card does NOT.
    const surfaced = await kas.evaluate(async (a) => {
      for (let i = 0; i < 18; i++) {
        try { await _kasperLoadReview(true); } catch (e) {}
        await new Promise(x => setTimeout(x, 900));
        const ids = new Set((_kasperState.replies || []).map(x => x.post.id));
        if (ids.has(a.pid)) return { has: true, hasP2: ids.has(a.pid2), hasNeg: ids.has(a.neg) };
      }
      const ids = new Set((_kasperState.replies || []).map(x => x.post.id));
      return { has: ids.has(a.pid), hasP2: ids.has(a.pid2), hasNeg: ids.has(a.neg) };
    }, { pid: PID, pid2: PID2, neg: PID3 });
    S.ok(surfaced.has, 'card surfaces in Kasper Messages inbox (SMM reply to his note)');
    S.ok(!surfaced.hasNeg, 'fresh SMM note Kasper never touched does NOT surface in the inbox');

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
    S.ok(reply && reply.parent_id === 'kn1_' + TS, 'reply is THREADED under Kasper\'s own internal root (parent_id matches)');

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
    S.ok(surfaced.hasP2, 'second card in inbox before mark-read');
    await kas.evaluate((pid) => { try { _kasperMarkRepliesRead(pid); } catch (e) {} }, PID2);
    const cleared = await kas.evaluate((pid) => !(_kasperState.replies || []).some(x => x.post.id === pid), PID2);
    S.ok(cleared, 'mark-as-read clears the card from the Kasper inbox');

    S.ok(kas._errs.length === 0 && smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors on any surface (' + JSON.stringify([...kas._errs, ...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    for (const id of [PID, PID2, PID3]) { const row = await Q.rawRow(id, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); try { await Q.up({ id, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
