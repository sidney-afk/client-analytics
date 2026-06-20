// p79 — multi-round request/approve ping-pong across all three surfaces, driven by
// the REAL handlers. caption: client requests a change → SMM resolves + routes to
// Kasper → Kasper requests more → SMM resolves + routes back to client → client
// approves. Verifies every status transition lands AND both rounds' change-request
// comments accumulate in the thread (nothing lost across the hand-offs).
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_pingpong_' + TS;
const R1 = 'Client: round 1 fix the hook ' + TS;
const R2 = 'Kasper: round 2 tighten the copy ' + TS;
const now = () => new Date().toISOString();
const capList = async () => { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} return a.filter(c => !c.deleted); };

(async () => {
  const S = Q.makeOk('P79 request/approve ping-pong');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  const kas = await Q.kasperPage(browser);
  try {
    await Q.up({ id: PID, name: 'PINGPONG ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");

    // ROUND 1 — client requests a change
    S.ok((await Q.clientRequest(cli, PID, 'caption', R1)) === 'ok', 'client raised round-1 change request');
    let r = await Q.pollRaw(PID, x => x.caption_status === 'Tweaks Needed', 'caption_status', 15000);
    S.ok(r.caption_status === 'Tweaks Needed', 'after client request → caption Tweaks Needed');

    // SMM resolves it and routes the component to Kasper
    await Q.smmResolveTweak(PID, 'caption', 'Kasper Approval');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Kasper Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Kasper Approval', 'SMM resolved + routed → caption Kasper Approval');

    // ROUND 2 — Kasper (now holding the card) requests more
    S.ok(await Q.kasperLoadHas(kas, PID), 'card reached Kasper queue for round 2');
    S.ok((await Q.kasperRequest(kas, PID, 'caption', R2)) === 'ok', 'Kasper raised round-2 change request');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Tweaks Needed', 'caption_status', 15000);
    S.ok(r.caption_status === 'Tweaks Needed', 'after Kasper request → caption Tweaks Needed');

    // SMM resolves it and routes back to the client
    await Q.smmResolveTweak(PID, 'caption', 'Client Approval');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Client Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Client Approval', 'SMM resolved + routed → caption back to Client Approval');

    // client approves → Approved
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    S.ok((await Q.clientApprove(cli, PID, 'caption')) === 'ok', 'client approved the final caption');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Approved', 'caption_status', 15000);
    S.ok(r.caption_status === 'Approved', 'after client approve → caption Approved (cycle complete)');

    // both rounds' comments survived every hand-off
    const live = await capList();
    const hasR1 = live.some(c => (c.body || '') === R1 && c.role === 'client' && c.is_tweak);
    const hasR2 = live.some(c => (c.body || '') === R2 && c.role === 'kasper');
    S.ok(hasR1, 'round-1 client change-request still in the thread');
    S.ok(hasR2, 'round-2 Kasper change-request still in the thread');

    S.ok(cli._errs.length === 0 && kas._errs.length === 0, 'no JS errors (' + JSON.stringify([...cli._errs, ...kas._errs].slice(0, 3)) + ')');
  } finally {
    try { const row = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
