// p07b — SMM positive control: the guards (if _isClientLink return) must be no-ops on SMM.
const Q = require('./lib.js');
const P = 'p_smmpos_' + Math.floor(Date.now()/1000);
(async () => {
  const S = Q.makeOk('P07b SMM-positive');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: P, name: 'SMMPOS ' + P.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status:'In Progress', graphic_status:'In Progress', caption_status:'In Progress', status:'In Progress' });
    await Q.pollRaw(P, r => r.caption_status === 'In Progress', 'caption_status');
    await Q.waitForPost(smm, P);
    // SMM _calStatusPick should work
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'For SMM Approval', 'caption'); } catch(e){} }, P);
    let bk = await Q.pollRaw(P, r => r.caption_status === 'For SMM Approval', 'caption_status');
    S.ok(bk.caption_status === 'For SMM Approval', 'SMM _calStatusPick works (caption=' + bk.caption_status + ')');
    // SMM archiveCalPost should work
    await smm.evaluate(async (pid) => { try { archiveCalPost(pid); } catch(e){} await new Promise(x=>setTimeout(x,300)); const y=document.getElementById('confirmYes'); if(y) y.click(); }, P);
    bk = await Q.pollRaw(P, r => r.status === 'Archived', 'status');
    S.ok(bk.status === 'Archived', 'SMM archiveCalPost works (status=' + bk.status + ')');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,3)) + ')');
  } finally { await Q.up({ id: P, status: 'Archived' }); await browser.close(); }
  process.exit(S.done());
})();
