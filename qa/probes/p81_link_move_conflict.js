// p81 — "Move it here" link-move flow end-to-end. Pasting a Linear link that already
// lives on another LIVE card surfaces the conflict UI; confirming the move must clear
// the OLD card's slot and set the NEW card's — the load-bearing order (await the clear
// first, send __CLEAR_LINK__) so the upsert's duplicate guard doesn't reject the move.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const OLD = 'p_mvOld_' + TS, NEW = 'p_mvNew_' + TS;
const LINK = 'https://linear.app/synchro-social/issue/VID-8' + (TS % 9000 + 1000) + '/move';

(async () => {
  const S = Q.makeOk('P81 link-move conflict');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: OLD, name: 'MV-OLD ' + TS, linear_issue_id: LINK, status: 'In Progress', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await Q.up({ id: NEW, name: 'MV-NEW ' + TS, linear_issue_id: '', status: 'In Progress', thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await Q.pollRaw(OLD, r => (r.linear_issue_id || '') === LINK, 'linear_issue_id');
    await smm.evaluate(async (a) => { for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); if (a.ids.every(id => (calState.posts || []).some(p => p.id === id))) break; } }, { ids: [OLD, NEW] });

    // paste OLD's link into NEW → must surface the conflict, NOT auto-commit
    const conflict = await smm.evaluate((a) => {
      _calLinearCommit({ value: a.link, dataset: {} }, a.newPid, 'video');
      return { pending: !!(_calPendingLinkMove && _calPendingLinkMove[a.newPid]), committed: !!(_calPendingEdits[a.newPid] && _calPendingEdits[a.newPid].linear_issue_id) };
    }, { link: LINK, newPid: NEW });
    S.ok(conflict.pending === true && conflict.committed === false, 'duplicate link surfaces the Move/Cancel conflict (not auto-committed)');

    // confirm the move
    await smm.evaluate((a) => { _calMoveLinkConfirm(a.newPid); }, { newPid: NEW });
    await smm.waitForTimeout(3500);

    const oldRow = await Q.pollRaw(OLD, r => String(r.linear_issue_id || '') === '', 'linear_issue_id', 12000);
    const newRow = await Q.pollRaw(NEW, r => String(r.linear_issue_id || '') === LINK, 'linear_issue_id', 12000);
    S.ok(String(oldRow.linear_issue_id || '') === '', 'OLD card lost the link (cleared via sentinel)');
    S.ok(String(newRow.linear_issue_id || '') === LINK, 'NEW card now holds the link (move landed, not rejected)');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [OLD, NEW]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
