// p78 — Kasper approve → undo → RE-approve cycle. Beyond p54's single undo: after
// an undo, the card must be fully back in Kasper's queue AND re-approvable (the undo
// doesn't leave it in a wedged state). Verifies status + queue membership at every
// step of the cycle.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_recycle_' + TS;
const now = () => new Date().toISOString();
const kHas = (kas, pid) => kas.evaluate((pid) => (_kasperState.items || []).some(x => x.post.id === pid), pid);

(async () => {
  const S = Q.makeOk('P78 approve/undo/re-approve');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  try {
    await Q.up({ id: PID, name: 'RECYCLE ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Kasper Approval', 'caption_status');
    S.ok(await Q.kasperLoadHas(kas, PID), 'card starts in Kasper queue');

    // 1) approve → Client Approval, leaves the queue
    await kas.evaluate(async (pid) => { try { await _kasperApproveComp(pid, 'caption', 'client'); } catch (e) {} }, PID);
    let r = await Q.pollRaw(PID, x => x.caption_status === 'Client Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Client Approval', 'approve #1 → caption Client Approval (DB)');

    // 2) undo (toast) → back to Kasper Approval, back in the queue. Click the Undo
    // toast right after approve, BEFORE any queue reload (a reload dismisses it).
    await kas.waitForTimeout(700);
    const undo = await kas.evaluate(() => { const b = document.querySelector('.sv-toast-action'); if (!b) return 'NO_TOAST'; b.click(); return 'clicked'; });
    S.ok(undo === 'clicked', 'Undo toast present + clicked (' + undo + ')');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Kasper Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Kasper Approval', 'undo → caption back to Kasper Approval (DB)');
    S.ok(await Q.kasperLoadHas(kas, PID), 'undo → card is back in the Kasper queue (re-loadable)');

    // 3) RE-approve → Client Approval again, leaves the queue again (no wedge)
    await kas.evaluate(async (pid) => { try { await _kasperApproveComp(pid, 'caption', 'client'); } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => x.caption_status === 'Client Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Client Approval', 're-approve → caption Client Approval again (DB)');
    S.ok(await Q.kasperGoneFromQueue(kas, PID), 're-approve → card left the queue again');

    S.ok(kas._errs.length === 0, 'no JS errors (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
