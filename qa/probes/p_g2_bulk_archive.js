// p_g2 — §7 client write-guard gap (part 2): SMM-only multi-select/metadata handlers must
// reject a client direct call. Each tested on its OWN fresh card. On main → bulk-archive +
// color + altcap bypass (FAIL); on the fix branch → all blocked. Positive: client review approve works.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const ARCH1 = 'p_g2arch1_' + TS, ARCH2 = 'p_g2arch2_' + TS;
const COL = 'p_g2col_' + TS, OK = 'p_g2ok_' + TS;

(async () => {
  const S = Q.makeOk('P_G2 client-write-guards-2');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: ARCH1, name: 'G2ARCH1 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29', status: 'In Progress' });
    await Q.up({ id: ARCH2, name: 'G2ARCH2 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29', status: 'In Progress' });
    await Q.up({ id: COL,  name: 'G2COL ' + TS,  platforms: 'instagram', scheduled_date: '2026-06-29', status: 'In Progress', color: '' });
    await Q.up({ id: OK,   name: 'G2OK ' + TS,   platforms: 'youtube',   scheduled_date: '2026-06-29',
      video_status:'Approved', graphic_status:'Approved', caption_status:'Client Approval', status:'Client Approval',
      thumbnail_url:'https://via.placeholder.com/320x180.png', asset_url:'https://example.com/g.mp4' });
    for (const id of [ARCH1, ARCH2, COL]) await Q.pollRaw(id, r => r.id === id, 'id');
    await Q.pollRaw(OK, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(cli, COL);
    await Q.clientHasCaption(cli, OK, 'Client Approval');

    // 1) bulk archive via select mode
    await cli.evaluate(async (a) => {
      try { _calToggleSelectMode('archive'); } catch(e){}
      try { calState.selected = new Set([a.ARCH1, a.ARCH2]); } catch(e){}
      try { _calArchiveSelected(); } catch(e){}
      await new Promise(x => setTimeout(x, 300));
      const yes = document.getElementById('confirmYes'); if (yes) yes.click();
    }, { ARCH1, ARCH2 });
    await cli.waitForTimeout(3000);
    const a1 = await Q.rawRow(ARCH1, 'status'); const a2 = await Q.rawRow(ARCH2, 'status');
    S.ok(a1.status !== 'Archived' && a2.status !== 'Archived', 'client bulk-archive BLOCKED (A1=' + a1.status + ' A2=' + a2.status + ')');

    // 2) per-card color (valid color, fresh non-archived card)
    await cli.evaluate((pid) => { try { _calSetCardColor(null, pid, 'red'); } catch(e){} }, COL);
    await cli.waitForTimeout(2200);
    const c = await Q.rawRow(COL, 'color');
    S.ok(String(c.color || '').toLowerCase() !== 'red', '_calSetCardColor BLOCKED from client (color=' + c.color + ')');

    // 3) bulk link overlay must not enter link select mode
    const linkOpen = await cli.evaluate(() => { try { calState.selected = new Set(); _calToggleSelectMode('archive'); _calOpenBulkLinkOverlay(); } catch(e){} return !!(calState.selectMode); });
    S.ok(linkOpen !== true, 'select mode not entered from client (_calToggleSelectMode/_calOpenBulkLinkOverlay blocked: ' + linkOpen + ')');

    // POSITIVE: client review approve still works
    S.ok((await Q.clientApprove(cli, OK, 'caption')) === 'ok', 'POSITIVE: client review approve call ok');
    const okRow = await Q.pollRow(OK, x => x.caption_status === 'Approved');
    S.ok(okRow.caption_status === 'Approved', 'POSITIVE: client review approve still works (caption→Approved)');

    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,4)) + ')');
  } finally {
    for (const id of [ARCH1, ARCH2, COL, OK]) await Q.up({ id, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
