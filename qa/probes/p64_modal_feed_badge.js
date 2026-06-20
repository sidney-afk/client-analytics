// p64 — the Notes modal's UNIFIED multi-component feed + the "N open" badge + unread-on-open.
//   • _calOpenCommentCount counts only OPEN change-requests (tweaks), across all components,
//     viewer-filtered — plain comments and resolved tweaks don't inflate it.
//   • the modal feed spans MULTIPLE components (caption + video threads in one list).
//   • opening the modal clears the unread dot (_notesMarkSeen).
//   • the "Show resolved" toggle reveals resolved threads.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_m64_' + TS;
const now = (off = 0) => new Date(Date.now() + off).toISOString();
const ctweak = (id, body, done) => ({ id, parent_id: null, author: 'Client', role: 'client', is_tweak: true, round: 1, audience: 'client', body, created_at: now(), updated_at: now(), done: !!done, done_at: done ? now() : '', done_by: done ? 'Synchro Social' : '' });
const ccomment = (id, body) => ({ id, parent_id: null, author: 'Client', role: 'client', is_tweak: false, audience: 'client', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });

(async () => {
  const S = Q.makeOk('P64 modal feed + badge + unread');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'M64 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Tweaks Needed', graphic_status: 'Tweaks Needed', caption_status: 'Tweaks Needed', status: 'Tweaks Needed',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([ctweak('ct_' + TS, 'OPEN caption tweak'), ccomment('cc_' + TS, 'plain caption comment')]),
      video_tweaks: JSON.stringify([ctweak('vt_' + TS, 'OPEN video tweak')]),
      graphic_tweaks: JSON.stringify([ctweak('gt_' + TS, 'RESOLVED graphic tweak', true)]) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes('OPEN caption tweak'), 'caption_tweaks');
    await Q.waitForPost(smm, PID, "p=>p.caption_status==='Tweaks Needed'");

    // 1) badge counts only OPEN tweaks across components (caption + video = 2; graphic resolved, plain comment excluded)
    const counts = await smm.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return { open: _calOpenCommentCount(p),
      compsWithVisible: _calComponentsFor(p).filter(c => (_calCommentsForView(p, c) || []).length > 0) }; }, PID);
    S.ok(counts.open === 2, '"N open" badge counts only open tweaks across components = 2 (got ' + counts.open + ')');
    S.ok(counts.compsWithVisible.length >= 2 && counts.compsWithVisible.includes('caption') && counts.compsWithVisible.includes('video'), 'unified feed spans multiple components (' + JSON.stringify(counts.compsWithVisible) + ')');

    // 2) opening the modal renders a multi-component feed + clears unread
    const feed = await smm.evaluate((pid) => {
      // arm an unread first: pretend we last saw long ago
      _notesMarkSeen(pid, new Date(Date.now() - 3600000).toISOString());
      const p = (calState.posts || []).find(x => x.id === pid);
      const unreadBefore = _calHasUnreadNotes(p);
      openCalComments(pid);
      const rows = document.querySelectorAll('#calCommentsFeed .cal-cm-thread, #calCommentsFeed [data-cm-root]');
      const unreadAfter = _calHasUnreadNotes(p);
      return { unreadBefore, unreadAfter, openPid: _calOpenCommentsPid, feedExists: !!document.getElementById('calCommentsFeed') };
    }, PID);
    S.ok(feed.unreadBefore === true, 'unread dot armed before opening (foreign-role notes newer than seen)');
    S.ok(feed.openPid === PID && feed.feedExists, 'comments modal opened on the card');
    S.ok(feed.unreadAfter === false, 'opening the modal CLEARS the unread dot (_notesMarkSeen)');

    // 3) "Show resolved" reveals the resolved graphic thread
    const resolved = await smm.evaluate((pid) => {
      const p = (calState.posts || []).find(x => x.id === pid);
      _calShowResolved = false; _calRenderCommentsModal();
      const liveHasResolved = !!document.querySelector('#calCommentsFeed') && document.getElementById('calCommentsFeed').textContent.includes('RESOLVED graphic tweak');
      _calShowResolved = true; _calRenderCommentsModal();
      const shownHasResolved = document.getElementById('calCommentsFeed').textContent.includes('RESOLVED graphic tweak');
      return { liveHasResolved, shownHasResolved };
    }, PID);
    S.ok(resolved.liveHasResolved === false, 'resolved thread hidden from the live feed by default');
    S.ok(resolved.shownHasResolved === true, '"Show resolved" reveals the resolved thread');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    try { for (const comp of ['caption', 'video', 'graphic']) { const r = await Q.rawRow(PID, comp + '_tweaks'); let a = []; try { a = JSON.parse(r[comp + '_tweaks'] || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); await Q.up({ id: PID, [comp + '_tweaks']: JSON.stringify(tomb) }); } await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
