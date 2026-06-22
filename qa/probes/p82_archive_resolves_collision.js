// p82 — two active cards sharing a Linear issue are BOTH shown and flagged (never
// silently hidden), and archiving one clears the flag. This is the systemic fix for
// the TEST 1 ⇄ TESTTT situation: a collision can no longer hide a card behind your
// back — both stay visible with a "duplicate Linear issue" warning, and archiving
// one resolves it.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const A = 'p_colA_' + TS, B = 'p_colB_' + TS;
const SK = 'https://linear.app/synchro-social/issue/GRA-9' + (TS % 9000 + 1000) + '/collide';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// returns {visible, flagged, banner} for a card id, after a fresh load + render
const state = (smm, id) => smm.evaluate(async (a) => {
  for (let i = 0; i < 10; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); }
  const p = (calState.posts || []).find(x => x.id === a.id);
  const flagged = !!(p && typeof _calLinkDuplicatePeers === 'function' && _calLinkDuplicatePeers(p).length);
  const banner = !!document.querySelector('.cal-card[data-pid="' + a.id + '"] .cal-dupe-warn');
  return { visible: !!p, flagged, banner };
}, { id });

(async () => {
  const S = Q.makeOk('P82 duplicate flagged, not hidden');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: A, name: 'COL-A ' + TS, graphic_linear_issue_id: SK, video_status: 'Kasper Approval', status: 'Kasper Approval', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await sleep(1500);
    await Q.up({ id: B, name: 'COL-B ' + TS, graphic_linear_issue_id: SK, video_status: 'Approved', status: 'Approved', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await Q.pollRaw(B, r => (r.graphic_linear_issue_id || '') === SK, 'graphic_linear_issue_id');

    // BOTH active cards are visible — neither is silently hidden
    const a1 = await state(smm, A), b1 = await state(smm, B);
    S.ok(a1.visible === true && b1.visible === true, 'BOTH colliding cards stay visible (no silent hiding)');
    // and BOTH are flagged as duplicates (data + the on-card warning banner)
    S.ok(a1.flagged && b1.flagged, 'both cards are detected as duplicates (_calLinkDuplicatePeers)');
    S.ok(a1.banner === true && b1.banner === true, 'both cards render the "duplicate Linear issue" warning banner');

    // archive B → A stays visible AND the duplicate flag clears (collision resolved)
    await Q.up({ id: B, status: 'Archived' });
    await Q.pollRaw(B, r => String(r.status).toLowerCase() === 'archived', 'status');
    const a2 = await state(smm, A);
    S.ok(a2.visible === true, 'after archiving the twin, the card is still visible');
    S.ok(a2.flagged === false && a2.banner === false, 'archiving the twin clears the duplicate flag + banner (resolved)');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [A, B]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
