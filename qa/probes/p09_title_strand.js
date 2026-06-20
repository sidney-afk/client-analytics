// p09 — §5 title-review strand: removing YouTube from a card whose title is engaged
// (title_status set) leaves title_status stranded (unreachable but persisted).
// On clean main this FAILS (strand); after the fix title_status clears to ''.
const Q = require('./lib.js');
const PID = 'p_tstr_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P09 title-strand');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    // YouTube card with an engaged title in Kasper review.
    await Q.up({ id: PID, name: 'TSTRAND ' + PID.slice(-6), platforms: 'youtube,instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', title_status: 'Kasper Approval', status: 'Approved',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.title_status === 'Kasper Approval', 'title_status');
    await Q.waitForPost(smm, PID);

    // confirm title is an active component before removal
    const before = await smm.evaluate((pid) => {
      const p = (calState.posts || []).find(x => x.id === pid);
      return { comps: _calComponentsFor(p), titleStatus: p.title_status };
    }, PID);
    console.log('before remove:', JSON.stringify(before));
    S.ok(before.comps.includes('title'), 'before: title is an active review component');

    // SMM removes YouTube from the card
    await smm.evaluate((pid) => { try { _calTogglePostPlatform(null, pid, 'youtube'); } catch (e) {} }, PID);
    // wait past the debounced save
    await smm.waitForTimeout(3500);

    const after = await smm.evaluate((pid) => {
      const p = (calState.posts || []).find(x => x.id === pid);
      return { comps: _calComponentsFor(p), platforms: p.platforms, titleStatus: p.title_status };
    }, PID);
    console.log('after remove (local):', JSON.stringify(after));
    const bk = await Q.pollRaw(PID, r => !/youtube/i.test(String(r.platforms||'')), 'platforms,title_status', 8000);
    console.log('after remove (backend):', JSON.stringify(bk));

    S.ok(!after.comps.includes('title'), 'after: title is no longer a reachable component (youtube gone)');
    // THE BUG: title_status persists. After the fix it should be cleared ('').
    S.ok(!String(bk.title_status || '').trim(), 'after: title_status CLEARED on backend (strand fixed) — got "' + bk.title_status + '"');
    S.ok(!String(after.titleStatus || '').trim(), 'after: title_status cleared locally too');

    // POSITIVE control: removing a NON-YouTube platform must NOT clear the title.
    const CTRL = 'p_tctrl_' + Math.floor(Date.now() / 1000);
    await Q.up({ id: CTRL, name: 'TCTRL ' + CTRL.slice(-6), platforms: 'youtube,instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', title_status: 'Kasper Approval', status: 'Approved',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(CTRL, r => r.title_status === 'Kasper Approval', 'title_status');
    await Q.waitForPost(smm, CTRL);
    await smm.evaluate((pid) => { try { _calTogglePostPlatform(null, pid, 'instagram'); } catch (e) {} }, CTRL);
    await smm.waitForTimeout(3500);
    const ctrlBk = await Q.pollRaw(CTRL, r => !/instagram/i.test(String(r.platforms||'')), 'platforms,title_status', 8000);
    console.log('control (removed instagram):', JSON.stringify(ctrlBk));
    S.ok(ctrlBk.title_status === 'Kasper Approval', 'control: removing a non-YouTube platform keeps title_status intact');
    await Q.up({ id: CTRL, status: 'Archived' });

    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
