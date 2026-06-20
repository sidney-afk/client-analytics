// p01 — §4.7 BUG repro: an UNDATED post passes EVERY concrete-month filter
// (masquerades under June, July, ... simultaneously). Seeds 1 undated + 1 June card,
// selects a concrete month, asserts the undated card is hidden.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const UND = 'p_und_' + TS;       // undated
const JUN = 'p_jun_' + TS;       // June 2026

(async () => {
  const S = Q.makeOk('P01 undated-month-filter');
  const browser = await Q.launch();
  try {
    // Seed: one undated card, one June-dated card. Both In Progress so SMM sees them.
    await Q.up({ id: UND, name: 'UNDATED ' + TS, platforms: 'instagram', scheduled_date: '', status: 'In Progress' });
    await Q.up({ id: JUN, name: 'JUNE ' + TS, platforms: 'instagram', scheduled_date: '2026-06-15', status: 'In Progress' });
    await Q.pollRaw(UND, r => r.id === UND, 'id');
    await Q.pollRaw(JUN, r => r.id === JUN, 'id');

    const smm = await Q.smmPage(browser);
    // make sure both cards are in calState
    const present = await smm.evaluate(async (a) => {
      for (let i = 0; i < 25; i++) {
        try { if (typeof loadCalendarPosts === 'function') await loadCalendarPosts(); } catch (e) {}
        await new Promise(x => setTimeout(x, 800));
        const ids = (calState.posts || []).map(p => p.id);
        if (ids.includes(a.UND) && ids.includes(a.JUN)) return true;
      }
      return false;
    }, { UND, JUN });
    S.ok(present, 'both seed cards loaded in calState');

    const res = await smm.evaluate(async (a) => {
      // ensure Sheet/organizer view
      if (calState.view !== 'organizer') { try { calState.view = 'organizer'; } catch (e) {} }
      try { _calRenderBody({ preserveScroll: false }); } catch (e) {}
      await new Promise(x => setTimeout(x, 400));
      const inDom = (pid) => !!document.querySelector('.cal-card[data-pid="' + pid + '"]');
      // baseline: all months — both visible
      onCalMonthFilterChange('all');
      await new Promise(x => setTimeout(x, 400));
      const base = { und: inDom(a.UND), jun: inDom(a.JUN) };
      // select June 2026 — June card should show, undated should NOT
      onCalMonthFilterChange('2026-06');
      await new Promise(x => setTimeout(x, 400));
      const june = { und: inDom(a.UND), jun: inDom(a.JUN) };
      // select August 2026 — neither should show (esp. undated must be hidden)
      onCalMonthFilterChange('2026-08');
      await new Promise(x => setTimeout(x, 400));
      const aug = { und: inDom(a.UND), jun: inDom(a.JUN) };
      // restore
      onCalMonthFilterChange('all');
      return { base, june, aug };
    }, { UND, JUN });
    console.log('RESULT:', JSON.stringify(res));

    S.ok(res.base.und && res.base.jun, 'baseline (all months): both cards visible');
    S.ok(res.june.jun, 'June filter: June card visible');
    S.ok(!res.june.und, 'June filter: UNDATED card hidden (BUG if visible)');
    S.ok(!res.aug.jun, 'Aug filter: June card hidden');
    S.ok(!res.aug.und, 'Aug filter: UNDATED card hidden (BUG if visible)');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,4)) + ')');
  } finally {
    await Q.up({ id: UND, status: 'Archived' });
    await Q.up({ id: JUN, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
