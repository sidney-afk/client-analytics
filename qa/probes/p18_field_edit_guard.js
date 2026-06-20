// p18 — §7 collab-gate field edits: a NON-collab (read-only) client must not edit a card's
// name/caption/date via the field handlers. Tests with collab_mode toggled IN MEMORY ONLY
// (no backend write → Sidney's real collab stays ON, no restore needed). On main → FAIL
// (bypass); after the guard → blocked when collab off, allowed when collab on.
const Q = require('./lib.js');
const PID = 'p_fe_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P18 field-edit-guard');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'ORIG-NAME', platforms: 'instagram', scheduled_date: '2026-06-10', status: 'In Progress' });
    await Q.pollRaw(PID, r => r.name === 'ORIG-NAME', 'name');
    await Q.waitForPost(cli, PID);
    // render organizer so the editable name input exists
    await cli.evaluate(async () => { try { calState.view='organizer'; _calRenderBody({preserveScroll:false}); } catch(e){} await new Promise(x=>setTimeout(x,500)); });

    // collab OFF (in memory) → name edit must be blocked
    await cli.evaluate((pid) => {
      try { if (!calState.settings) calState.settings = {}; calState.settings.collab_mode = false; } catch(e){}
      const input = document.querySelector('.cal-card[data-pid="' + pid + '"] .cal-fld-name');
      if (input) { input.value = 'HACKED-OFF'; try { _calOnFieldBlur(input); } catch(e){} }
    }, PID);
    await cli.waitForTimeout(2500);
    let bk = await Q.rawRow(PID, 'name');
    S.ok(bk.name !== 'HACKED-OFF', 'collab OFF: client name edit BLOCKED (name=' + bk.name + ')');

    // collab OFF date edit must be blocked
    await cli.evaluate((pid) => {
      const di = document.querySelector('.cal-card[data-pid="' + pid + '"] .cal-fld-date-input');
      if (di) { di.value = '2026-09-09'; try { _calOnDateChange(di); } catch(e){} }
    }, PID);
    await cli.waitForTimeout(2500);
    bk = await Q.rawRow(PID, 'scheduled_date');
    S.ok(bk.scheduled_date !== '2026-09-09', 'collab OFF: client date edit BLOCKED (date=' + bk.scheduled_date + ')');

    // collab ON (in memory) → name edit allowed (positive control)
    await cli.evaluate((pid) => {
      try { calState.settings.collab_mode = true; } catch(e){}
      const input = document.querySelector('.cal-card[data-pid="' + pid + '"] .cal-fld-name');
      if (input) { input.value = 'COLLAB-EDIT'; try { _calOnFieldBlur(input); } catch(e){} }
    }, PID);
    bk = await Q.pollRaw(PID, r => r.name === 'COLLAB-EDIT', 'name', 10000);
    S.ok(bk.name === 'COLLAB-EDIT', 'collab ON: client name edit allowed (name=' + bk.name + ')');

    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
