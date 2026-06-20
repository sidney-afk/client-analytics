// p41 — multi-round tweak loop across actors, with round numbering.
//   Kasper request (round 1) → SMM resolve→Kasper → Kasper request (round 2) → SMM resolve→client
//   → client request → and assert the tweak round increments correctly + statuses track.
const Q = require('./lib.js');
const PID = 'p_tr_' + Math.floor(Date.now() / 1000);

const tweaksOf = async () => { const row = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} return a.filter(c => c && c.is_tweak && !c.deleted); };

(async () => {
  const S = Q.makeOk('P41 tweak-rounds');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.seedCaptionCard(PID, 'Kasper Approval');
    await Q.pollRow(PID, x => x.caption_status === 'Kasper Approval');

    // round 1: Kasper request change
    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue');
    await Q.kasperRequest(kas, PID, 'caption', 'Kasper round 1: fix the hook');
    let r = await Q.pollRow(PID, x => x.caption_status === 'Tweaks Needed');
    S.ok(r.caption_status === 'Tweaks Needed', 'round1: caption → Tweaks Needed');
    let tw = await tweaksOf();
    S.ok(tw.length === 1 && tw[0].round === 1, 'round1: one tweak, round=1 (got ' + JSON.stringify(tw.map(t => t.round)) + ')');

    // SMM resolve → Kasper
    await Q.smmResolveTweak(PID, 'caption', 'Kasper Approval');
    r = await Q.pollRow(PID, x => x.caption_status === 'Kasper Approval');
    S.ok(r.caption_status === 'Kasper Approval', 'SMM resolve→Kasper: caption → Kasper Approval');

    // round 2: Kasper request change again
    S.ok(await Q.kasperLoadHas(kas, PID), 'card back in Kasper queue');
    await Q.kasperRequest(kas, PID, 'caption', 'Kasper round 2: still too long');
    r = await Q.pollRow(PID, x => x.caption_status === 'Tweaks Needed' && (x.caption_tweaks || '').includes('round 2'));
    tw = await tweaksOf();
    const rounds = tw.map(t => t.round).sort((a, b) => a - b);
    S.ok(tw.length === 2 && rounds[1] === 2, 'round2: tweak round INCREMENTED to 2 (rounds=' + JSON.stringify(rounds) + ')');

    // SMM resolve → client
    await Q.smmResolveTweak(PID, 'caption', 'Client Approval');
    r = await Q.pollRow(PID, x => x.caption_status === 'Client Approval');
    S.ok(r.caption_status === 'Client Approval', 'SMM resolve→client: caption → Client Approval');

    // client request change (round 3 — client tweak)
    await Q.clientHasCaption(cli, PID, 'Client Approval');
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 30; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);
    await Q.clientRequest(cli, PID, 'caption', 'Client round 3: change the CTA');
    r = await Q.pollRow(PID, x => x.caption_status === 'Tweaks Needed' && (x.caption_tweaks || '').includes('round 3'));
    S.ok(r.caption_status === 'Tweaks Needed', 'client request: caption → Tweaks Needed');
    tw = await tweaksOf();
    const allRounds = tw.map(t => t.round).sort((a, b) => a - b);
    S.ok(tw.length === 3 && allRounds[2] === 3, 'round3: client tweak round=3 (rounds=' + JSON.stringify(allRounds) + ')');
    // the client tweak is client-audience; the kasper ones are internal
    const clientTweak = tw.find(t => (t.body || '').includes('round 3'));
    S.ok(clientTweak && clientTweak.role === 'client' && clientTweak.audience === 'client', 'client tweak is role client + audience client');
    const kasperTweaks = tw.filter(t => t.role === 'kasper');
    S.ok(kasperTweaks.length === 2 && kasperTweaks.every(t => t.audience === 'internal'), 'both Kasper tweaks are internal');

    S.ok(kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...kas._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
