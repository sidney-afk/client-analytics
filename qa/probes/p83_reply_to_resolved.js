// p83 — replying to an already-RESOLVED change-request thread. A reply must persist,
// attach to the parent's component, and inherit the parent's audience (so a reply in a
// client-visible thread stays client-visible) — without silently dropping it or
// flipping the resolved root back open behind the user's back.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_replyres_' + TS;
const ROOT = 'CLIENT-REQ-' + TS, REPLY = 'SMM-REPLY-ON-RESOLVED-' + TS;
const now = () => new Date().toISOString();

(async () => {
  const S = Q.makeOk('P83 reply to resolved thread');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    // seed a card with ONE client change-request already RESOLVED (done:true)
    const root = { id: 'r_' + TS, parent_id: null, author: 'Client', role: 'client', is_tweak: true, audience: 'client', body: ROOT, created_at: now(), updated_at: now(), done: true, done_at: now(), done_by: 'Synchro Social', round: 1 };
    await Q.up({ id: PID, name: 'REPLYRES ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: JSON.stringify([root]) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(ROOT), 'caption_tweaks');
    await Q.waitForPost(smm, PID, "p=>(_calCommentsFor(p,'caption')||[]).some(c=>c.body==='" + ROOT + "')");

    // SMM replies to the resolved thread
    await smm.evaluate(async (a) => { _calComposeComp = 'caption'; _calAppendComment(a.pid, a.rootId, a.body); try { await _calFlushCardSave(a.pid); } catch (e) {} }, { pid: PID, rootId: 'r_' + TS, body: REPLY });
    const r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(REPLY), 'caption_tweaks', 12000);
    let arr = []; try { arr = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const reply = arr.find(c => (c.body || '') === REPLY);
    const rootAfter = arr.find(c => (c.body || '') === ROOT);

    S.ok(!!reply, 'reply persisted to the resolved thread');
    S.ok(reply && reply.parent_id === 'r_' + TS, 'reply is attached to the resolved root (right component thread)');
    S.ok(rootAfter && rootAfter.done === true, 'the resolved root stays resolved (reply did not silently reopen it)');

    // a reply in a client-audience thread is visible to the client (inherits audience)
    const cliSees = await cli.evaluate(async (a) => {
      for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700));
        const p = (calState.posts || []).find(x => x.id === a.pid); if (p && (_calCommentsForView(p, 'caption') || []).some(c => (c.body || '') === a.body)) return true; }
      return false;
    }, { pid: PID, body: REPLY });
    S.ok(cliSees === true, 'reply inherits the client audience → visible on the client surface');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { const row = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
