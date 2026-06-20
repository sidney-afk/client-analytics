// p07 — §7 Role×Mode (client surface). SMM-only mutations must be rejected at the HANDLER
// level (not just hidden), AND client-allowed actions (review approve, collab create) must
// still work. Sidney has collab ON. Cleans up its cards.
const Q = require('./lib.js');
const G = 'p_grd_' + Math.floor(Date.now() / 1000);   // guard target
const C = 'p_grdok_' + Math.floor(Date.now() / 1000); // positive-control (client approve)

(async () => {
  const S = Q.makeOk('P07 client-guards');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  let collabBefore = null;
  try {
    collabBefore = await cli.evaluate(() => _calIsCollabOn());
    console.log('collab on?', collabBefore);

    await Q.up({ id: G, name: 'GUARD ' + G.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress' });
    await Q.up({ id: C, name: 'OK ' + C.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(G, r => r.caption_status === 'In Progress', 'caption_status');
    await Q.pollRaw(C, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(cli, G);
    await Q.clientHasCaption(cli, C, 'Client Approval');

    // --- NEGATIVE: SMM-only handlers must be blocked from client ---
    await cli.evaluate((pid) => { try { _calStatusPick(pid, 'Posted', 'caption'); } catch(e){} }, G);
    await cli.waitForTimeout(2200);
    let bk = await Q.rawRow(G, 'caption_status');
    S.ok(bk.caption_status !== 'Posted', '_calStatusPick blocked (caption=' + bk.caption_status + ')');

    await cli.evaluate((pid) => { try { _calSetAllStatus(pid, 'Kasper Approval'); } catch(e){} }, G);
    await cli.waitForTimeout(2200);
    bk = await Q.rawRow(G, 'caption_status');
    S.ok(bk.caption_status !== 'Kasper Approval', '_calSetAllStatus blocked (caption=' + bk.caption_status + ')');

    const tog = await cli.evaluate((pid) => { try { _calTogglePostPlatform(null, pid, 'tiktok'); } catch(e){} const p=(calState.posts||[]).find(x=>x.id===pid)||{}; return p.platforms; }, G);
    await cli.waitForTimeout(1500);
    bk = await Q.rawRow(G, 'platforms');
    S.ok(!/tiktok/i.test(String(bk.platforms||'')), '_calTogglePostPlatform blocked (platforms=' + bk.platforms + ')');

    const pe = await cli.evaluate(() => { try { openCalPlatformsEditor(); } catch(e){} const ovl=document.getElementById('calImportOverlay'); return ovl ? ovl.classList.contains('open') : 'no-ovl'; });
    S.ok(pe !== true, 'openCalPlatformsEditor blocked (editor did not open: ' + pe + ')');

    const collabAfterTry = await cli.evaluate(async () => { const b=_calIsCollabOn(); try { await _calToggleCollabMode(); } catch(e){} await new Promise(x=>setTimeout(x,500)); return { before:b, after:_calIsCollabOn() }; });
    S.ok(collabAfterTry.before === collabAfterTry.after, '_calToggleCollabMode blocked (collab unchanged: ' + JSON.stringify(collabAfterTry) + ')');

    await cli.evaluate(async (pid) => { try { archiveCalPost(pid); } catch(e){} await new Promise(x=>setTimeout(x,300)); const yes=document.getElementById('confirmYes'); if(yes) yes.click(); }, G);
    await cli.waitForTimeout(2800);
    bk = await Q.rawRow(G, 'status');
    S.ok(bk.status !== 'Archived', 'archiveCalPost blocked (status=' + bk.status + ')');

    // --- POSITIVE control: client review approve still works ---
    console.log('  clientApprove(caption on C):', await Q.clientApprove(cli, C, 'caption'));
    let r = await Q.pollRow(C, x => x.caption_status === 'Approved');
    S.ok(r.caption_status === 'Approved', 'POSITIVE: client review approve STILL works (caption→Approved)');

    // --- POSITIVE control: collab create (collab ON) still inserts a blank card ---
    // The "Suggest a post" affordance lives in the organizer view, so switch there first.
    const create = await cli.evaluate(async () => {
      try { calState.view = 'organizer'; _calRenderBody({ preserveScroll: false }); } catch(e){}
      await new Promise(x => setTimeout(x, 500));
      const hasStrip = !!document.getElementById('calStrip');
      const before = document.querySelectorAll('.cal-card.is-blank').length;
      try { addCalBlankCard(); } catch(e) { return { threw: e.message }; }
      const after = document.querySelectorAll('.cal-card.is-blank').length;
      return { hasStrip, before, after };
    });
    console.log('collab create:', JSON.stringify(create));
    S.ok(create && create.after > create.before, 'POSITIVE: collab create (collab ON) still inserts a card');

    S.ok(cli._errs.length === 0, 'client: no JS errors (' + JSON.stringify(cli._errs.slice(0,4)) + ')');
  } finally {
    await Q.up({ id: G, status: 'Archived' });
    await Q.up({ id: C, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
