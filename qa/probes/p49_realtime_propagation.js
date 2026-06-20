// p49 — REALTIME cross-surface sync (no manual reload). The client subscribes to its
// Supabase realtime channel; an SMM status change must appear on the client WITHOUT the
// client calling loadCalendarPosts. Proves the "sync on the websites" path, not just the
// poll/reload path every other probe forces.
//   • SMM sets caption Approved→Tweaks Needed → client calState reflects it via realtime
//   • SMM posts a client-visible comment → it shows in the client's thread via realtime
const Q = require('./lib.js');
const PID = 'p_rt_' + Math.floor(Date.now() / 1000);
const now = () => new Date().toISOString();

// poll the client's IN-MEMORY calState ONLY — never force a reload — so a change can only
// arrive through the realtime subscription's debounced background refresh.
const rtField = (cli, pid, field, want, ms = 20000) => cli.evaluate(async (a) => {
  const t = Date.now();
  while (Date.now() - t < a.ms) { const p = (calState.posts || []).find(x => x.id === a.pid); if (p && p[a.field] === a.want) return true; await new Promise(x => setTimeout(x, 600)); }
  const p = (calState.posts || []).find(x => x.id === a.pid); return p ? p[a.field] : '__nopost__';
}, { pid, field, want, ms });

(async () => {
  const S = Q.makeOk('P49 realtime propagation (no manual reload)');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'RT ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');

    // make sure the client is subscribed AND has the card (one initial load is fine for setup)
    const subbed = await cli.evaluate(async () => { for (let i = 0; i < 20; i++) { if (window.calV2Status && window.calV2Status().subscribed) return true; await new Promise(x => setTimeout(x, 500)); } return false; });
    S.ok(subbed, 'client realtime channel subscribed');
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    await Q.waitForPost(smm, PID);

    // 1) SMM changes caption status — client must reflect it via REALTIME (no client reload)
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'Tweaks Needed', 'caption'); } catch (e) {} }, PID);
    const got = await rtField(cli, PID, 'caption_status', 'Tweaks Needed');
    S.ok(got === true, 'client saw caption→Tweaks Needed via realtime, no manual reload (got ' + got + ')');

    // 2) CLIENT posts a comment (client-audience, visible to the team) → SMM thread
    //    shows it via REALTIME (no SMM reload). (An SMM _calReviewComment is internal
    //    and correctly invisible to the client, so we test the direction the recipient
    //    is allowed to see — this exercises realtime delivery of a real thread change.)
    const CMT = 'RT-CLIENT-NOTE-' + PID.slice(-6);
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);
    await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { _calReviewState.drafts[a.pid + '|caption'] = a.body; try { _calReviewComment(a.pid, 'caption'); } catch (e) {} } }, { pid: PID, body: CMT });
    const smmSaw = await smm.evaluate(async (a) => {
      const t = Date.now();
      while (Date.now() - t < 20000) { const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { const bodies = (_calCommentsForView(p, 'caption') || []).map(c => c.body); if (bodies.some(b => (b || '').includes(a.cmt))) return true; } await new Promise(x => setTimeout(x, 600)); }
      return false;
    }, { pid: PID, cmt: CMT });
    S.ok(smmSaw === true, 'SMM saw the client comment via realtime (no manual reload)');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
