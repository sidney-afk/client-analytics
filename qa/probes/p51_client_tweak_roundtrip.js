// p51 — client-initiated tweak round-trip (the "client reviews → requests a change" loop).
//   1. caption at Client Approval is ACTIVE for the client.
//   2. client requests a change → caption Tweaks Needed; her tweak is role client / audience
//      client / is_tweak; the card LEAVES her review sheet (ball is in the editor's court).
//   3. SMM SEES the client tweak (client-audience visible to the team).
//   4. SMM resolves the tweak → Client Approval → caption is ACTIVE for the client again.
//   5. client approves → caption Approved; her tweak is now resolved (done).
const Q = require('./lib.js');
const PID = 'p_ctr_' + Math.floor(Date.now() / 1000);
const BODY = 'Client: please shorten the caption ' + PID.slice(-6);

(async () => {
  const S = Q.makeOk('P51 client tweak round-trip');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'CTR ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');

    // 1) caption active for the client
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    S.ok((await Q.clientCompActive(cli, PID, 'caption')) === true, 'caption is active for the client (Client Approval)');
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);

    // 2) client requests a change
    const reqRes = await Q.clientRequest(cli, PID, 'caption', BODY);
    S.ok(reqRes === 'ok', 'client request-change call ok (' + reqRes + ')');
    let r = await Q.pollRaw(PID, x => x.caption_status === 'Tweaks Needed' && (x.caption_tweaks || '').includes(BODY), 'caption_status,caption_tweaks', 15000);
    S.ok(r.caption_status === 'Tweaks Needed', 'caption → Tweaks Needed');
    let tw = []; try { tw = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const ct = tw.find(c => (c.body || '').includes(BODY));
    S.ok(ct && ct.is_tweak === true && ct.role === 'client' && ct.audience === 'client', 'client tweak is is_tweak + role client + audience client');
    // card leaves her review sheet (TN on a real client link is not active)
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Tweaks Needed'");
    S.ok((await Q.clientCompActive(cli, PID, 'caption')) === false, 'caption LEAVES the client review sheet while in Tweaks Needed');

    // 3) SMM sees the client tweak
    const smmSees = await smm.evaluate(async (a) => { for (let i = 0; i < 22; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800)); const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { const bodies = (_calCommentsForView(p, 'caption') || []).map(c => c.body); if (bodies.some(b => (b || '').includes(a.body))) return true; } } return false; }, { pid: PID, body: BODY });
    S.ok(smmSees, 'SMM sees the client tweak (client-audience visible to team)');

    // 4) SMM resolves → Client Approval
    await Q.smmResolveTweak(PID, 'caption', 'Client Approval');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Client Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Client Approval', 'SMM resolve → caption Client Approval (re-routed to client)');
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    S.ok((await Q.clientCompActive(cli, PID, 'caption')) === true, 'caption is ACTIVE for the client again after resolve');

    // 5) client approves
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);
    const apRes = await Q.clientApprove(cli, PID, 'caption');
    S.ok(apRes === 'ok', 'client approve call ok (' + apRes + ')');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Approved', 'caption_status,caption_tweaks', 15000);
    S.ok(r.caption_status === 'Approved', 'client approval → caption Approved');
    let tw2 = []; try { tw2 = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const ct2 = tw2.find(c => (c.body || '').includes(BODY));
    S.ok(ct2 && ct2.done === true, 'client tweak is now resolved/done after approval');

    S.ok(cli._errs.length === 0 && smm._errs.length === 0, 'no JS errors (' + JSON.stringify([...cli._errs, ...smm._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
