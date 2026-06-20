// p13 — §7 collab-gate: a NON-collab (read-only) client must not reschedule a card via
// _calMovePostToDate. Tests by setting collab_mode=false IN MEMORY ONLY (no backend write,
// so Sidney's real collab stays ON and needs no restore). On main this FAILS (bypass);
// after the guard it passes. Positive control: with collab on (in memory) the move works.
const Q = require('./lib.js');
const PID = 'p_mv_' + Math.floor(Date.now() / 1000);
const NEWDATE = '2026-07-15';

(async () => {
  const S = Q.makeOk('P13 move-guard');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'MOVE ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-10',
      video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress' });
    await Q.pollRaw(PID, r => r.scheduled_date === '2026-06-10', 'scheduled_date');
    await Q.waitForPost(cli, PID);

    // collab OFF (in memory only) → move must be blocked
    await cli.evaluate((a) => {
      try { if (!calState.settings) calState.settings = {}; calState.settings.collab_mode = false; } catch (e) {}
      try { _calMovePostToDate(a.pid, a.date); } catch (e) {}
    }, { pid: PID, date: NEWDATE });
    await cli.waitForTimeout(2500);
    let bk = await Q.rawRow(PID, 'scheduled_date');
    S.ok(bk.scheduled_date !== NEWDATE, 'collab OFF: client reschedule BLOCKED (date=' + bk.scheduled_date + ')');

    // collab ON (in memory) → move allowed (positive control)
    await cli.evaluate((a) => {
      try { calState.settings.collab_mode = true; } catch (e) {}
      try { _calMovePostToDate(a.pid, a.date); } catch (e) {}
    }, { pid: PID, date: NEWDATE });
    bk = await Q.pollRaw(PID, r => r.scheduled_date === NEWDATE, 'scheduled_date', 10000);
    S.ok(bk.scheduled_date === NEWDATE, 'collab ON: client reschedule allowed (date=' + bk.scheduled_date + ')');

    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
