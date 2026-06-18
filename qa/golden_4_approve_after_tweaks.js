// GOLDEN PATH 4 — approve-after-tweaks shortcut:
// SMM→Kasper -> Kasper "approve after tweaks" -> SMM resolve→client (NO Kasper re-review) -> client approve.
const G = require('./golden_lib.js');
const PID = 'p_gold4_' + Math.floor(Date.now() / 1000);
(async () => {
  const S = G.makeOk();
  const browser = await G.launch();
  const kas = await G.kasperPage(browser);
  const cli = await G.clientPage(browser);
  try {
    await G.seedCaptionCard(PID, 'Kasper Approval');
    await G.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(await G.kasperLoadHas(kas, PID), 'step1: card in Kasper queue');

    console.log('  kasperApproveAfterTweaks:', await G.kasperApproveAfterTweaks(kas, PID));
    let r = await G.pollRow(PID, x => x.caption_status === 'Tweaks Needed');
    S.ok(r.caption_status === 'Tweaks Needed', 'step2 approve-after-tweaks: caption → Tweaks Needed');
    console.log('  kasper_approved_after_tweaks =', JSON.stringify(r.kasper_approved_after_tweaks));
    S.ok(!!r.kasper_approved_after_tweaks && String(r.kasper_approved_after_tweaks) !== 'false',
      'step2: kasper_approved_after_tweaks flag is set (pre-approved for client)');

    await G.smmResolveCaptionTweak(PID, 'Client Approval');
    r = await G.pollRow(PID, x => x.caption_status === 'Client Approval');
    S.ok(r.caption_status === 'Client Approval', 'step3 SMM resolve→client (skips Kasper re-review): caption → Client Approval');

    S.ok(await G.clientHasCaption(cli, PID, 'Client Approval'), 'step4: client sees Client Approval');
    console.log('  clientApprove:', await G.clientApproveCaption(cli, PID));
    r = await G.pollRow(PID, x => x.caption_status === 'Approved');
    S.ok(r.caption_status === 'Approved', 'step4 client approve: caption → Approved');

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
    S.ok(cli._errs.length === 0, 'no JS errors on client (' + JSON.stringify(cli._errs.slice(0, 3)) + ')');
  } finally { await G.archive(PID); await browser.close(); }
  console.log('GOLDEN 4: pass=' + S.pass + ' fail=' + S.fail, S.fail ? '❌' : '✅');
  process.exit(S.fail ? 1 : 0);
})();
