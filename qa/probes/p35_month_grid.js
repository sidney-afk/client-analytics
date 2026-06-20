// p35 — §4.7/§14 month-grid placement in an Americas timezone. A 2026-07-01 card must land in
// the July-1 day cell, not Jun-30 (the off-by-one class). Driven under America/Argentina/Buenos_Aires.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_mg_' + TS;

(async () => {
  const S = Q.makeOk('P35 month-grid');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser, 'sidneylaruel', { timezoneId: 'America/Argentina/Buenos_Aires' });
  try {
    await Q.up({ id: PID, name: 'MG ' + TS, platforms: 'instagram', scheduled_date: '2026-07-01', status: 'In Progress' });
    await Q.pollRaw(PID, r => r.scheduled_date === '2026-07-01', 'scheduled_date');
    await Q.waitForPost(smm, PID);

    const res = await smm.evaluate(async (a) => {
      const off = new Date().getTimezoneOffset();
      calState.view = 'month';
      calState.monthCursor = '2026-07-01';
      _calRenderBody({ preserveScroll: false });
      await new Promise(x => setTimeout(x, 600));
      const inJul1 = !!document.querySelector('.cal-month-cell[data-iso="2026-07-01"] [data-cal-move="' + a.pid + '"]');
      const inJun30 = !!document.querySelector('.cal-month-cell[data-iso="2026-06-30"] [data-cal-move="' + a.pid + '"]');
      // which cell holds the pill, if any
      const pill = document.querySelector('[data-cal-move="' + a.pid + '"]');
      const cell = pill ? pill.closest('.cal-month-cell') : null;
      const cellIso = cell ? cell.getAttribute('data-iso') : null;
      return { off, inJul1, inJun30, cellIso };
    }, { pid: PID });
    console.log('RESULT:', JSON.stringify(res));
    S.ok(res.off === 180, 'Buenos Aires tz active (offset 180)');
    S.ok(res.inJul1, 'card placed in the July-1 day cell');
    S.ok(!res.inJun30, 'card NOT placed in Jun-30 (no off-by-one)');
    S.ok(res.cellIso === '2026-07-01', 'pill\'s containing cell is 2026-07-01 (got ' + res.cellIso + ')');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors in BA tz (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
