// p86 — a duplicate owner is no longer HIDDEN, so pasting its link now WARNS you
// (the TEST 1 ⇄ TESTTT bug). cardB owns VIDLINK and shares a graphic issue with
// cardA — the exact shape that used to make the dedupe hide one of them. Both stay
// visible now, so pasting cardB's video link onto cardA must surface the
// "already linked — Move it here?" conflict (it couldn't before, because the owner
// was invisible to the paste guard) and must NOT silently commit.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const A = 'p_howA_' + TS, B = 'p_howB_' + TS;
const SK = 'https://linear.app/synchro-social/issue/GRA-8' + (TS % 9000 + 1000) + '/sharedg';
const VIDLINK = 'https://linear.app/synchro-social/issue/VID-8' + (TS % 9000 + 1000) + '/ownedbyB';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const S = Q.makeOk('P86 hidden owner now warns');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: A, name: 'HOW-A ' + TS, graphic_linear_issue_id: SK, status: 'In Progress', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await sleep(1200);
    await Q.up({ id: B, name: 'HOW-B ' + TS, linear_issue_id: VIDLINK, graphic_linear_issue_id: SK, status: 'In Progress', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await Q.pollRaw(B, r => (r.linear_issue_id || '') === VIDLINK, 'linear_issue_id');
    await smm.evaluate(async (a) => { for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); if (a.ids.every(id => (calState.posts || []).some(p => p.id === id))) break; } }, { ids: [A, B] });

    // both visible (neither hidden by the shared graphic) — the precondition for the warning to work
    const vis = await smm.evaluate((ids) => ids.filter(id => (calState.posts || []).some(p => p.id === id)), [A, B]);
    S.ok(vis.includes(A) && vis.includes(B), 'both cards sharing a graphic issue stay visible (not hidden)');

    // paste cardB's video link onto cardA → must surface the conflict, NOT auto-commit
    const r = await smm.evaluate((a) => {
      window.__n = null; window.showNotify = (t) => { window.__n = t; };
      _calLinearCommit({ value: a.link, dataset: {} }, a.aPid, 'video');
      const conflictUI = !!document.querySelector('.cal-card[data-pid="' + a.aPid + '"] [data-link-conflict], [data-link-conflict="' + a.aPid + '"]');
      return { pending: !!(_calPendingLinkMove && _calPendingLinkMove[a.aPid]), committed: !!(_calPendingEdits[a.aPid] && _calPendingEdits[a.aPid].linear_issue_id), conflictUI, notify: window.__n };
    }, { aPid: A, link: VIDLINK });
    S.ok(r.pending === true || r.conflictUI === true, 'pasting the owner\'s link surfaces the "already linked — Move it here?" conflict');
    S.ok(r.committed === false, 'the paste is NOT silently committed onto the second card');
    await sleep(1500);
    const aLink = String((await Q.rawRow(A, 'linear_issue_id')).linear_issue_id || '');
    S.ok(aLink === '', 'card A did not take the contested link (no silent duplicate created)');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [A, B]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
