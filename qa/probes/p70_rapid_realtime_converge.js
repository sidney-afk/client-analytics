// p70 — realtime robustness: the SMM fires several status changes in quick succession; the client
// (via realtime, NO manual reload) must converge to the FINAL value — no stuck intermediate state,
// no lost final write, no JS errors. Stresses the realtime debounce + the per-card save serialization.
const Q = require('./lib.js');
const PID = 'p_rr_' + Math.floor(Date.now() / 1000);

// poll the client's IN-MEMORY calState only (no forced reload) so convergence is via realtime.
const rtFinal = (cli, pid, field, want, ms = 25000) => cli.evaluate(async (a) => {
  const t = Date.now();
  while (Date.now() - t < a.ms) { const p = (calState.posts || []).find(x => x.id === a.pid); if (p && p[a.field] === a.want) return true; await new Promise(x => setTimeout(x, 500)); }
  const p = (calState.posts || []).find(x => x.id === a.pid); return p ? p[a.field] : '__nopost__';
}, { pid, field, want, ms });

(async () => {
  const S = Q.makeOk('P70 rapid realtime convergence');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'RR ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'For SMM Approval', status: 'For SMM Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'For SMM Approval', 'caption_status');
    const subbed = await cli.evaluate(async () => { for (let i = 0; i < 20; i++) { if (window.calV2Status && window.calV2Status().subscribed) return true; await new Promise(x => setTimeout(x, 500)); } return false; });
    S.ok(subbed, 'client realtime subscribed');
    await Q.waitForPost(cli, PID, "p=>p.id==='" + PID + "'");
    await Q.waitForPost(smm, PID);

    // rapid-fire: caption FSA → Kasper Approval → Client Approval → Approved, ~250ms apart
    const seq = ['Kasper Approval', 'Client Approval', 'Tweaks Needed', 'Client Approval', 'Approved'];
    for (const st of seq) {
      await smm.evaluate((a) => { try { delete _calPendingEdits[a.pid]; _calStatusPick(a.pid, a.st, 'caption'); } catch (e) {} }, { pid: PID, st });
      await smm.waitForTimeout(250);
    }

    // DB lands on the final value
    const r = await Q.pollRaw(PID, x => x.caption_status === 'Approved', 'caption_status', 20000);
    S.ok(r.caption_status === 'Approved', 'DB converged to the FINAL status (Approved)');

    // client converges to Approved via realtime (no manual reload), no stuck intermediate
    const got = await rtFinal(cli, PID, 'caption_status', 'Approved');
    S.ok(got === true, 'client converged to Approved via realtime (got ' + got + ')');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors under rapid changes (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
