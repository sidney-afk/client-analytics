// GOLDEN PATH 5 — undo:
// SMM→Kasper -> Kasper approve -> Kasper UNDO approve (toast) -> Kasper request change.
const G = require('./golden_lib.js');
const PID = 'p_gold5_' + Math.floor(Date.now() / 1000);
(async () => {
  const S = G.makeOk();
  const browser = await G.launch();
  const kas = await G.kasperPage(browser);
  try {
    await G.seedCaptionCard(PID, 'Kasper Approval');
    await G.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(await G.kasperLoadHas(kas, PID), 'step1: card in Kasper queue');

    // approve persists before returning, so the Undo toast is already showing.
    console.log('  kasperApprove:', await G.kasperApprove(kas, PID));
    let r = await G.pollRow(PID, x => x.caption_status === 'Client Approval', 6000);
    S.ok(r.caption_status === 'Client Approval', 'step2 Kasper approve: caption → Client Approval');

    const u = await G.kasperUndoViaToast(kas);
    console.log('  undo:', u);
    S.ok(u === 'clicked', 'step3: Undo toast present and clicked');
    r = await G.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(r.caption_status === 'Kasper Approval', 'step3 undo approve: caption back → Kasper Approval');

    S.ok(await G.kasperLoadHas(kas, PID), 'step4: card back in Kasper queue after undo');
    console.log('  kasperRequest:', await G.kasperRequest(kas, PID));
    r = await G.pollRow(PID, x => x.caption_status === 'Tweaks Needed');
    S.ok(r.caption_status === 'Tweaks Needed', 'step4 Kasper request change: caption → Tweaks Needed');

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
  } finally { await G.archive(PID); await browser.close(); }
  console.log('GOLDEN 5: pass=' + S.pass + ' fail=' + S.fail, S.fail ? '❌' : '✅');
  process.exit(S.fail ? 1 : 0);
})();
