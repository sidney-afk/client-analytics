// p34 — §4.3 "Set all to…" (SMM). caption is always settable; video/graphic only if linked to
// Linear; terminal statuses require a confirm.
//   1. no-Linear card, set-all 'Kasper Approval' (non-terminal) → only caption moves
//   2. Linked card, set-all 'Kasper Approval' → all three move
//   3. no-Linear card, set-all 'Approved' (terminal) → confirm dialog → only caption moves
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const NOLINK = 'p_sa_nl_' + TS, LINK = 'p_sa_lk_' + TS, TERM = 'p_sa_tm_' + TS;

(async () => {
  const S = Q.makeOk('P34 set-all');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: NOLINK, name: 'SA-NL ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress' });
    await Q.up({ id: LINK, name: 'SA-LK ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress',
      linear_issue_id: 'https://linear.app/sidtest/issue/SAV-' + TS, graphic_linear_issue_id: 'https://linear.app/sidtest/issue/SAG-' + TS });
    await Q.up({ id: TERM, name: 'SA-TM ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress' });
    for (const id of [NOLINK, LINK, TERM]) await Q.pollRaw(id, r => r.id === id, 'id');
    await Q.pollRaw(LINK, r => String(r.linear_issue_id || '').includes('SAV-' + TS), 'linear_issue_id', 14000);
    await Q.waitForPost(smm, NOLINK); await Q.waitForPost(smm, LINK); await Q.waitForPost(smm, TERM);

    // 1) no-Linear, non-terminal → only caption moves
    await smm.evaluate((pid) => { try { localStorage.setItem('cal-skip-setall-confirm-kasper approval', '1'); } catch (e) {} _calSetAllStatus(pid, 'Kasper Approval'); }, NOLINK);
    let r = await Q.pollRaw(NOLINK, x => x.caption_status === 'Kasper Approval', 'caption_status,video_status,graphic_status', 14000);
    S.ok(r.caption_status === 'Kasper Approval', '1: caption moved to Kasper Approval');
    S.ok(r.video_status === 'In Progress' && r.graphic_status === 'In Progress', '1: video/graphic UNCHANGED (no Linear → not settable)');

    // 2) linked card → all three move
    await smm.evaluate((pid) => { _calSetAllStatus(pid, 'Kasper Approval'); }, LINK);
    r = await Q.pollRaw(LINK, x => x.video_status === 'Kasper Approval' && x.graphic_status === 'Kasper Approval' && x.caption_status === 'Kasper Approval', 'video_status,graphic_status,caption_status', 14000);
    S.ok(r.video_status === 'Kasper Approval' && r.graphic_status === 'Kasper Approval' && r.caption_status === 'Kasper Approval', '2: linked card — all three move to Kasper Approval');

    // 3) no-Linear, terminal 'Approved' → confirm dialog, then only caption moves
    const confirmShown = await smm.evaluate(async (pid) => {
      try { localStorage.removeItem('cal-skip-setall-confirm-approved'); } catch (e) {}
      _calSetAllStatus(pid, 'Approved');
      await new Promise(x => setTimeout(x, 300));
      const ov = document.getElementById('confirmOverlay');
      const shown = !!(ov && ov.classList.contains('active'));
      const yes = document.getElementById('confirmYes'); if (yes) yes.click();
      return shown;
    }, TERM);
    S.ok(confirmShown, '3: terminal status (Approved) shows a confirm dialog');
    r = await Q.pollRaw(TERM, x => x.caption_status === 'Approved', 'caption_status,video_status', 14000);
    S.ok(r.caption_status === 'Approved', '3: after confirm, caption moves to Approved');
    S.ok(r.video_status === 'In Progress', '3: video unchanged (no Linear)');

    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [NOLINK, LINK, TERM]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
