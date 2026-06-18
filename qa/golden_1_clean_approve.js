// GOLDEN PATH 1 — clean approve:
// SMM send to Kasper -> Kasper approve -> client approve -> SMM mark posted.
const G = require('./golden_lib.js');
const PID = 'p_gold1_' + Math.floor(Date.now() / 1000);
(async () => {
  const S = G.makeOk();
  const browser = await G.launch();
  const kas = await G.kasperPage(browser);
  const cli = await G.clientPage(browser);
  try {
    // Step 1 — SMM sends caption to Kasper.
    await G.seedCaptionCard(PID, 'Kasper Approval');
    let r = await G.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(r.caption_status === 'Kasper Approval', 'step1 SMM→Kasper: caption at Kasper Approval');
    S.ok(await G.kasperLoadHas(kas, PID), 'step1: card present in Kasper queue (content gate cleared)');

    // Step 2 — Kasper approves → forwards to client.
    console.log('  kasperApprove:', await G.kasperApprove(kas, PID));
    r = await G.pollRow(PID, x => x.caption_status === 'Client Approval');
    S.ok(r.caption_status === 'Client Approval', 'step2 Kasper approve: caption → Client Approval');

    // Step 3 — client approves → Approved.
    S.ok(await G.clientHasCaption(cli, PID, 'Client Approval'), 'step3: client surface sees caption at Client Approval');
    console.log('  clientApprove:', await G.clientApproveCaption(cli, PID));
    r = await G.pollRow(PID, x => x.caption_status === 'Approved');
    S.ok(r.caption_status === 'Approved', 'step3 client approve: caption → Approved');

    // Step 4 — SMM marks posted.
    await G.smmMarkPosted(PID);
    r = await G.pollRow(PID, x => x.status === 'Posted');
    S.ok(r.status === 'Posted', 'step4 SMM mark posted: overall status → Posted');

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
    S.ok(cli._errs.length === 0, 'no JS errors on client (' + JSON.stringify(cli._errs.slice(0, 3)) + ')');
  } finally {
    await G.archive(PID);
    await browser.close();
  }
  console.log('GOLDEN 1: pass=' + S.pass + ' fail=' + S.fail, S.fail ? '❌' : '✅');
  process.exit(S.fail ? 1 : 0);
})();
