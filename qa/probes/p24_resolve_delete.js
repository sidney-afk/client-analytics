// p24 — §4.9 resolve / reopen / delete on the SMM comments modal.
// Two open Kasper tweaks (so resolving one doesn't trigger the last-tweak dest chooser).
//  - resolve TW1 → done=true; reopen → done=false
//  - delete TW2 → tombstoned (deleted=true), excluded from _calCommentsForView, no resurrection.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_rd_' + TS;
const now = () => new Date().toISOString();
const TW1 = 'tw1_' + TS, TW2 = 'tw2_' + TS;
const tweak = (id, body) => ({ id, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, round: 1, audience: 'internal', body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });
const COMMENTS = [tweak(TW1, 'TWEAK-ONE-' + TS), tweak(TW2, 'TWEAK-TWO-' + TS)];

(async () => {
  const S = Q.makeOk('P24 resolve-delete');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'RD ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Tweaks Needed', status: 'Tweaks Needed',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify(COMMENTS) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes('TWEAK-TWO-' + TS), 'caption_tweaks');
    await Q.waitForPost(smm, PID);

    const getTweak = async (id) => { const row = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} return a.find(c => c.id === id) || {}; };

    // open the comments modal
    await smm.evaluate((pid) => { try { openCalComments(pid); } catch (e) {} }, PID);
    await smm.waitForTimeout(400);

    // resolve TW1 (otherOpen = TW2 = 1 > 0 → no chooser)
    await smm.evaluate((id) => { try { _calToggleCommentDone(id); } catch (e) {} }, TW1);
    let t1 = await (async () => { for (let i = 0; i < 20; i++) { const t = await getTweak(TW1); if (t.done === true) return t; await new Promise(x => setTimeout(x, 700)); } return await getTweak(TW1); })();
    S.ok(t1.done === true, 'resolve: TW1 marked done (done=' + t1.done + ')');

    // reopen TW1
    await smm.evaluate((id) => { try { _calToggleCommentDone(id); } catch (e) {} }, TW1);
    t1 = await (async () => { for (let i = 0; i < 20; i++) { const t = await getTweak(TW1); if (t.done === false) return t; await new Promise(x => setTimeout(x, 700)); } return await getTweak(TW1); })();
    S.ok(t1.done === false, 'reopen: TW1 back to open (done=' + t1.done + ')');

    // delete TW2 (+ confirm)
    await smm.evaluate(async (id) => { try { _calDeleteComment(id); } catch (e) {} await new Promise(x => setTimeout(x, 300)); const y = document.getElementById('confirmYes'); if (y) y.click(); }, TW2);
    let t2 = await (async () => { for (let i = 0; i < 20; i++) { const t = await getTweak(TW2); if (t.deleted === true) return t; await new Promise(x => setTimeout(x, 700)); } return await getTweak(TW2); })();
    S.ok(t2.deleted === true, 'delete: TW2 tombstoned (deleted=' + t2.deleted + ')');
    S.ok(String(t2.updated_at || '') > String(COMMENTS[1].updated_at), 'delete: tombstone carries a fresh updated_at (newer-wins keeps it dead)');

    // _calCommentsForView (SMM sees all non-deleted) must exclude the deleted TW2 but keep TW1
    const view = await smm.evaluate(async (pid) => {
      try { if (typeof loadCalendarPosts === 'function') await loadCalendarPosts(); } catch (e) {}
      await new Promise(x => setTimeout(x, 1200));
      const p = (calState.posts || []).find(x => x.id === pid); if (!p) return { err: 'no post' };
      return { bodies: _calCommentsForView(p, 'caption').map(c => c.body) };
    }, PID);
    console.log('view bodies:', JSON.stringify(view));
    S.ok(view.bodies && view.bodies.includes('TWEAK-ONE-' + TS), 'TW1 still visible');
    S.ok(view.bodies && !view.bodies.includes('TWEAK-TWO-' + TS), 'deleted TW2 NOT visible (no resurrection)');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,3)) + ')');
  } finally {
    const row = await Q.rawRow(PID, 'caption_tweaks');
    let arr = []; try { arr = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {}
    const tomb = arr.map(c => Object.assign({}, c, { deleted: true, updated_at: now() }));
    await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
