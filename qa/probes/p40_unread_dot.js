// p40 — §4.9 cross-actor unread-dot lifecycle.
//   - SMM client-audience note → CLIENT shows unread; mark-seen clears; a NEW note re-arms it
//   - SMM INTERNAL note → CLIENT shows NO unread (not visible to client)
//   - CLIENT note → SMM shows unread
//   - your OWN note never shows as unread to you
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_ud_' + TS;
const now = () => new Date().toISOString();
const note = (id, role, audience, body, t) => ({ id, parent_id: null, author: role === 'client' ? 'Client' : 'Synchro Social', role, is_tweak: false, audience, body, created_at: t || now(), updated_at: t || now(), done: false, done_at: '', done_by: '' });

const setNotes = async (arr) => Q.up({ id: PID, caption_tweaks: JSON.stringify(arr) });
const reloadHasUnread = (page) => page.evaluate(async (pid) => {
  try { await loadCalendarPosts(); } catch (e) {}
  await new Promise(x => setTimeout(x, 1500));
  const p = (calState.posts || []).find(x => x.id === pid);
  return p ? _calHasUnreadNotes(p) : '__nopost__';
}, PID);

(async () => {
  const S = Q.makeOk('P40 unread-dot');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'UD ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.id === PID, 'id');
    await Q.clientHasCaption(cli, PID, null);
    await Q.waitForPost(smm, PID);
    // ensure both pages start "seen" for this card so the baseline is no-unread
    await cli.evaluate((pid) => _notesMarkSeen(pid, new Date().toISOString()), PID);
    await smm.evaluate((pid) => _notesMarkSeen(pid, new Date().toISOString()), PID);
    await new Promise(x => setTimeout(x, 1200));

    // 1) SMM client-audience note → CLIENT unread
    await setNotes([note('c1_' + TS, 'smm', 'client', 'CLIENT-VISIBLE-1', now())]);
    S.ok((await reloadHasUnread(cli)) === true, 'client sees unread for an SMM client-audience note');

    // 2) client marks seen → clears
    await cli.evaluate((pid) => _notesMarkSeen(pid, new Date().toISOString()), PID);
    S.ok((await reloadHasUnread(cli)) === false, 'mark-seen clears the client unread dot');

    // 3) a NEW SMM client-note (newer) re-arms unread (no over-clear)
    await new Promise(x => setTimeout(x, 1200));
    await setNotes([note('c1_' + TS, 'smm', 'client', 'CLIENT-VISIBLE-1'), note('c2_' + TS, 'smm', 'client', 'CLIENT-VISIBLE-2', now())]);
    S.ok((await reloadHasUnread(cli)) === true, 'a new note after mark-seen re-arms the client unread dot (no over-clear)');

    // 4) INTERNAL SMM note → CLIENT shows NO unread (not visible)
    await cli.evaluate((pid) => _notesMarkSeen(pid, new Date().toISOString()), PID);
    await new Promise(x => setTimeout(x, 1200));
    await setNotes([note('i1_' + TS, 'smm', 'internal', 'INTERNAL-ONLY', now())]);
    S.ok((await reloadHasUnread(cli)) === false, 'client shows NO unread for an internal SMM note (invisible to client)');

    // 5) CLIENT note → SMM unread; and SMM's own note never unread to SMM
    await smm.evaluate((pid) => _notesMarkSeen(pid, new Date().toISOString()), PID);
    await new Promise(x => setTimeout(x, 1200));
    await setNotes([note('cl1_' + TS, 'client', 'client', 'FROM-CLIENT', now())]);
    S.ok((await reloadHasUnread(smm)) === true, 'SMM sees unread for a client note');
    // SMM's own internal note should NOT make SMM unread
    await smm.evaluate((pid) => _notesMarkSeen(pid, new Date().toISOString()), PID);
    await new Promise(x => setTimeout(x, 1200));
    await setNotes([note('s1_' + TS, 'smm', 'internal', 'SMM-OWN', now())]);
    S.ok((await reloadHasUnread(smm)) === false, 'SMM does NOT see unread for its OWN note');

    S.ok(cli._errs.length === 0 && smm._errs.length === 0, 'no JS errors (' + JSON.stringify([...cli._errs, ...smm._errs].slice(0, 3)) + ')');
  } finally {
    const row = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {}
    const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() }));
    try { await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
