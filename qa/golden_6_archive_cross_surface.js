// GOLDEN PATH 6 — archive is cross-surface:
// archiving on SMM removes the card from Kasper's queue; un-archiving brings it back.
// Run from three representative stages.
const G = require('./golden_lib.js');
const BASE = 'p_gold6_' + Math.floor(Date.now() / 1000);
(async () => {
  const S = G.makeOk();
  const browser = await G.launch();
  const kas = await G.kasperPage(browser);
  try {
    // Archive from Kasper Approval (the card is live in Kasper's queue).
    const PID = BASE + '_ka';
    await G.seedCaptionCard(PID, 'Kasper Approval');
    await G.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(await G.kasperLoadHas(kas, PID), 'card in Kasper queue before archive');

    await G.archive(PID);
    let r = await G.pollRow(PID, x => x.status === 'Archived');
    S.ok(r.status === 'Archived', 'archive: status → Archived');
    S.ok(await G.kasperGoneFromQueue(kas, PID), 'archive: card removed from Kasper queue (cross-surface)');

    // Un-archive restores it to Kasper's queue.
    await G.smmSetCaption(PID, 'Kasper Approval', { status: 'In Progress' });
    r = await G.pollRow(PID, x => x.status !== 'Archived');
    S.ok(r.status !== 'Archived', 'undo archive: card no longer Archived');
    S.ok(await G.kasperLoadHas(kas, PID), 'undo archive: card back in Kasper queue');
    await G.archive(PID);

    // Archive from Tweaks Needed also clears the queue (a card pinned by a tweak).
    const PID2 = BASE + '_tn';
    await G.seedCaptionCard(PID2, 'Kasper Approval');
    await G.pollRow(PID2, x => x.caption_status === 'Kasper Approval');
    await G.kasperLoadHas(kas, PID2);
    await G.kasperRequest(kas, PID2);
    await G.pollRow(PID2, x => x.caption_status === 'Tweaks Needed');
    await G.archive(PID2);
    r = await G.pollRow(PID2, x => x.status === 'Archived');
    S.ok(r.status === 'Archived', 'archive from Tweaks Needed: status → Archived');
    S.ok(await G.kasperGoneFromQueue(kas, PID2), 'archive from Tweaks Needed: card removed from Kasper queue');
    await G.archive(PID2);

    S.ok(kas._errs.length === 0, 'no JS errors on Kasper (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
  } finally { await browser.close(); }
  console.log('GOLDEN 6: pass=' + S.pass + ' fail=' + S.fail, S.fail ? '❌' : '✅');
  process.exit(S.fail ? 1 : 0);
})();
