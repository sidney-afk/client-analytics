// p08 — §4.9/§10/§14 privacy boundary: internal (team/Kasper) notes must NEVER reach the
// client surface; client-audience notes must. Also: an internal note surfaces in Kasper's
// Messages/Replies inbox. Injects 3 root notes (smm-internal, smm-client, kasper-internal).
const Q = require('./lib.js');
const PID = 'p_note_' + Math.floor(Date.now() / 1000);
const now = () => new Date().toISOString();
const mk = (id, role, audience, body) => ({ id, parent_id: null, author: role === 'kasper' ? 'Kasper' : (role === 'client' ? 'Client' : 'Synchro Social'),
  role, is_tweak: false, audience, body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });

const INTERNAL = 'INTERNAL-SECRET-' + PID.slice(-5);
const CLIENTV  = 'CLIENT-VISIBLE-' + PID.slice(-5);
const KASPERS  = 'KASPER-SECRET-' + PID.slice(-5);
const TS = PID.slice(-6);
const COMMENTS = [
  mk('cn_int_' + TS, 'smm', 'internal', INTERNAL),
  mk('cn_cli_' + TS, 'smm', 'client',   CLIENTV),
  mk('cn_kas_' + TS, 'kasper', 'internal', KASPERS),
];

(async () => {
  const S = Q.makeOk('P08 note-audience');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  const kas = await Q.kasperPage(browser);
  try {
    await Q.up({ id: PID, name: 'NOTE ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify(COMMENTS) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(CLIENTV), 'caption_tweaks');

    // CLIENT: filter must return only the client-audience note.
    S.ok(await Q.clientHasCaption(cli, PID, 'Client Approval'), 'client loaded card at Client Approval');
    const filt = await cli.evaluate((a) => {
      const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return { err: 'no post' };
      let view = [];
      try { view = _calCommentsForView(p, 'caption').map(c => c.body); } catch (e) { return { err: e.message }; }
      return { bodies: view };
    }, { pid: PID });
    console.log('client _calCommentsForView bodies:', JSON.stringify(filt));
    S.ok(filt.bodies && filt.bodies.includes(CLIENTV), 'client filter INCLUDES the client-audience note');
    S.ok(filt.bodies && !filt.bodies.includes(INTERNAL), 'client filter EXCLUDES the SMM internal note');
    S.ok(filt.bodies && !filt.bodies.includes(KASPERS), 'client filter EXCLUDES the Kasper internal note');

    // CLIENT: rendered DOM must show the client note, never the internal ones.
    const dom = await cli.evaluate(async (a) => {
      try { calState.view = 'review'; _calRenderBody({ preserveScroll: false }); } catch (e) {}
      await new Promise(x => setTimeout(x, 400));
      try { _calReviewToggleCard(a.pid); } catch (e) {}
      await new Promise(x => setTimeout(x, 500));
      const t = document.body.innerText || '';
      return { hasClient: t.includes(a.CLIENTV), hasInternal: t.includes(a.INTERNAL), hasKasper: t.includes(a.KASPERS) };
    }, { pid: PID, CLIENTV, INTERNAL, KASPERS });
    console.log('client DOM:', JSON.stringify(dom));
    S.ok(dom.hasClient, 'client DOM shows the client note (render path active)');
    S.ok(!dom.hasInternal, 'client DOM does NOT show the SMM internal note');
    S.ok(!dom.hasKasper, 'client DOM does NOT show the Kasper internal note');
    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,3)) + ')');

    // KASPER: an internal unread note should surface this card in the Replies/Messages inbox.
    const inbox = await kas.evaluate(async (a) => {
      for (let i = 0; i < 18; i++) {
        try { await _kasperLoadReview(true); } catch (e) {}
        await new Promise(x => setTimeout(x, 900));
        const inReplies = (_kasperState.replies || []).some(x => x.post.id === a.pid);
        if (inReplies) return { inReplies: true };
      }
      return { inReplies: (_kasperState.replies || []).some(x => x.post.id === a.pid) };
    }, { pid: PID });
    console.log('kasper inbox:', JSON.stringify(inbox));
    S.ok(inbox.inReplies, 'Kasper Messages inbox surfaces the card (internal unread note)');
    S.ok(kas._errs.length === 0, 'kasper: 0 JS errors (' + JSON.stringify(kas._errs.slice(0,3)) + ')');
  } finally {
    // tombstone the comments + archive (leave Sidney clean)
    const tomb = COMMENTS.map(c => Object.assign({}, c, { deleted: true, updated_at: now() }));
    await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
