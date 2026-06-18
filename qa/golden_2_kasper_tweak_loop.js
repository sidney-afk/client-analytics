// GOLDEN PATH 2 — Kasper tweak loop:
// SMM→Kasper -> Kasper request change -> SMM resolve→Kasper -> Kasper approve -> client approve.
const G = require('./golden_lib.js');
const PID = 'p_gold2_' + Math.floor(Date.now() / 1000);
(async () => {
  const S = G.makeOk();
  const browser = await G.launch();
  const kas = await G.kasperPage(browser);
  const cli = await G.clientPage(browser);
  try {
    await G.seedCaptionCard(PID, 'Kasper Approval');
    await G.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(await G.kasperLoadHas(kas, PID), 'step1: card in Kasper queue');

    console.log('  kasperRequest:', await G.kasperRequest(kas, PID));
    let r = await G.pollRow(PID, x => x.caption_status === 'Tweaks Needed');
    S.ok(r.caption_status === 'Tweaks Needed', 'step2 Kasper request change: caption → Tweaks Needed');

    await G.smmResolveCaptionTweak(PID, 'Kasper Approval');
    r = await G.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(r.caption_status === 'Kasper Approval', 'step3 SMM resolve→Kasper: caption → Kasper Approval');

    S.ok(await G.kasperLoadHas(kas, PID), 'step4: card back in Kasper queue after re-send');
    console.log('  kasperApprove:', await G.kasperApprove(kas, PID));
    r = await G.pollRow(PID, x => x.caption_status === 'Client Approval');
    S.ok(r.caption_status === 'Client Approval', 'step4 Kasper approve: caption → Client Approval');

    S.ok(await G.clientHasCaption(cli, PID, 'Client Approval'), 'step5: client sees Client Approval');
    console.log('  clientApprove:', await G.clientApproveCaption(cli, PID));
    r = await G.pollRow(PID, x => x.caption_status === 'Approved');
    S.ok(r.caption_status === 'Approved', 'step5 client approve: caption → Approved');

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
    S.ok(cli._errs.length === 0, 'no JS errors on client (' + JSON.stringify(cli._errs.slice(0, 3)) + ')');
  } finally { await G.archive(PID); await browser.close(); }
  console.log('GOLDEN 2: pass=' + S.pass + ' fail=' + S.fail, S.fail ? '❌' : '✅');
  process.exit(S.fail ? 1 : 0);
})();
