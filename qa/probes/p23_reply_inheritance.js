// p23 — §4.9 reply audience inheritance (privacy): a reply carries no audience field, so it
// must inherit its thread ROOT's audience. A reply under an INTERNAL root must stay hidden
// from the client; a reply under a CLIENT root must be visible. Verifies _calCommentsForView
// + the rendered client DOM.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_rep_' + TS;
const now = () => new Date().toISOString();

const CR = 'cr_' + TS, IR = 'ir_' + TS, RC = 'rc_' + TS, RI = 'ri_' + TS;
const root = (id, audience, body) => ({ id, parent_id: null, author: 'Synchro Social', role: 'smm', is_tweak: false, audience, body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const reply = (id, parent, role, body) => ({ id, parent_id: parent, author: role === 'client' ? 'Client' : 'Synchro Social', role, is_tweak: false, /* NO audience field */ body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });

const CLIENT_ROOT = 'CLIENTROOT-' + TS, INT_ROOT = 'INTROOT-' + TS, REPLY_CLIENT = 'REPLYC-' + TS, REPLY_INT = 'REPLYI-' + TS;
const COMMENTS = [
  root(CR, 'client', CLIENT_ROOT),
  root(IR, 'internal', INT_ROOT),
  reply(RC, CR, 'client', REPLY_CLIENT),    // reply under client root → inherits client
  reply(RI, IR, 'smm', REPLY_INT),          // reply under internal root → inherits internal
];

(async () => {
  const S = Q.makeOk('P23 reply-inheritance');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'REP ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify(COMMENTS) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(REPLY_INT), 'caption_tweaks');
    await Q.clientHasCaption(cli, PID, 'Client Approval');

    const view = await cli.evaluate((a) => {
      const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return { err: 'no post' };
      let bodies = [];
      try { bodies = _calCommentsForView(p, 'caption').map(c => c.body); } catch (e) { return { err: e.message }; }
      return { bodies };
    }, { pid: PID });
    console.log('client filter bodies:', JSON.stringify(view));
    S.ok(view.bodies && view.bodies.includes(CLIENT_ROOT), 'client sees the client root');
    S.ok(view.bodies && view.bodies.includes(REPLY_CLIENT), 'client sees the reply UNDER the client root');
    S.ok(view.bodies && !view.bodies.includes(INT_ROOT), 'client does NOT see the internal root');
    S.ok(view.bodies && !view.bodies.includes(REPLY_INT), 'client does NOT see the reply under the INTERNAL root (inheritance holds — no leak)');

    // rendered DOM check
    const dom = await cli.evaluate(async (a) => {
      try { calState.view = 'review'; _calRenderBody({ preserveScroll: false }); } catch (e) {}
      await new Promise(x => setTimeout(x, 400));
      try { _calReviewToggleCard(a.pid); } catch (e) {}
      await new Promise(x => setTimeout(x, 500));
      const t = document.body.innerText || '';
      return { hasClientRoot: t.includes(a.CLIENT_ROOT), hasReplyClient: t.includes(a.REPLY_CLIENT),
               hasIntRoot: t.includes(a.INT_ROOT), hasReplyInt: t.includes(a.REPLY_INT) };
    }, { pid: PID, CLIENT_ROOT, REPLY_CLIENT, INT_ROOT, REPLY_INT });
    console.log('client DOM:', JSON.stringify(dom));
    S.ok(dom.hasReplyClient, 'DOM: client reply shown');
    S.ok(!dom.hasIntRoot && !dom.hasReplyInt, 'DOM: internal root + its reply NOT shown to client');
    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,3)) + ')');
  } finally {
    const row = await Q.rawRow(PID, 'caption_tweaks');
    let arr = []; try { arr = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {}
    const tomb = arr.map(c => Object.assign({}, c, { deleted: true, updated_at: now() }));
    await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
