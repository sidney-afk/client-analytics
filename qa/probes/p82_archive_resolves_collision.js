// p82 — archiving a twin un-hides the live card (the TEST 1 ⇄ TESTTT situation, and
// the integration proof of the dedupe fix). Two LIVE cards share a graphic Linear
// issue → the calendar keeps only the most-recent, so the other is hidden. Archiving
// the visible twin must make the hidden one re-appear (archived cards no longer
// compete for the link key).
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const A = 'p_colA_' + TS, B = 'p_colB_' + TS;
const SK = 'https://linear.app/synchro-social/issue/GRA-9' + (TS % 9000 + 1000) + '/collide';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const visible = (smm, id) => smm.evaluate(async (a) => { for (let i = 0; i < 10; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); } return (calState.posts || []).some(p => p.id === a.id); }, { id });

(async () => {
  const S = Q.makeOk('P82 archive resolves collision');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    // A first, then B → B is newer and WINS the shared graphic key (A hidden)
    await Q.up({ id: A, name: 'COL-A ' + TS, graphic_linear_issue_id: SK, video_status: 'Kasper Approval', status: 'Kasper Approval', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await sleep(1500);
    await Q.up({ id: B, name: 'COL-B ' + TS, graphic_linear_issue_id: SK, video_status: 'Approved', status: 'Approved', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await Q.pollRaw(B, r => (r.graphic_linear_issue_id || '') === SK, 'graphic_linear_issue_id');

    S.ok((await visible(smm, B)) === true, 'newer twin (B) is visible');
    S.ok((await visible(smm, A)) === false, 'older twin (A) is HIDDEN by the shared Linear issue (collision reproduced)');

    // archive B → A must re-appear
    await Q.up({ id: B, status: 'Archived' });
    await Q.pollRaw(B, r => String(r.status).toLowerCase() === 'archived', 'status');
    S.ok((await visible(smm, A)) === true, 'archiving the twin (B) un-hides the live card (A) — collision resolved');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [A, B]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
