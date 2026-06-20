// p33 — §4.6 regression: shift-range select must only grab VISIBLE cards, never ones hidden
// by the month filter. Seed C1(June), C2(Aug), C3(June); filter June (hides C2); select C1 then
// shift-click C3 → selection must be {C1,C3}, NOT C2.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const C1 = 'p_sr1_' + TS, C2 = 'p_sr2_' + TS, C3 = 'p_sr3_' + TS;

(async () => {
  const S = Q.makeOk('P33 shift-range');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: C1, name: 'SR1 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-11', order_index: 100, status: 'In Progress' });
    await Q.up({ id: C2, name: 'SR2 ' + TS, platforms: 'instagram', scheduled_date: '2026-08-11', order_index: 101, status: 'In Progress' });
    await Q.up({ id: C3, name: 'SR3 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-12', order_index: 102, status: 'In Progress' });
    for (const id of [C1, C2, C3]) await Q.pollRaw(id, r => r.id === id, 'id');
    await smm.evaluate(async (a) => { for (let i = 0; i < 25; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800)); const ids = (calState.posts || []).map(p => p.id); if (ids.includes(a.C1) && ids.includes(a.C2) && ids.includes(a.C3)) return; } }, { C1, C2, C3 });

    const res = await smm.evaluate(async (a) => {
      calState.view = 'organizer'; _calRenderBody({ preserveScroll: false });
      await new Promise(x => setTimeout(x, 300));
      onCalMonthFilterChange('2026-06');                 // hide the Aug card C2
      _calToggleSelectMode('archive');                   // enter select mode
      await new Promise(x => setTimeout(x, 400));
      const visible = Array.from(document.querySelectorAll('#calStrip .cal-card-selectable[data-pid]')).map(e => e.getAttribute('data-pid'));
      const ev = (shift) => ({ preventDefault() {}, stopPropagation() {}, shiftKey: shift });
      _calCardSelectClick(ev(false), a.C1);              // click C1
      _calCardSelectClick(ev(true), a.C3);               // shift-click C3 → range over visible
      const selected = Array.from(calState.selected || []);
      onCalMonthFilterChange('all'); calState.selectMode = false; calState.selected = new Set(); _calRenderBody({ preserveScroll: false });
      return { visible, selected };
    }, { C1, C2, C3 });
    console.log('RESULT:', JSON.stringify(res));
    S.ok(!res.visible.includes(C2), 'C2 (Aug) is hidden by the June filter');
    S.ok(res.selected.includes(C1) && res.selected.includes(C3), 'shift-range selected the two visible June cards');
    S.ok(!res.selected.includes(C2), 'shift-range did NOT grab the filter-hidden Aug card (regression guard holds)');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [C1, C2, C3]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
