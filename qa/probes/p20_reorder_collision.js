// p20 — §4.5 reorder slot-collision (flagged MED). When a month filter hides some posts,
// the drop handler recycles the VISIBLE posts' order_index slots and de-dups ties by bumping
// up by 1 — but only against the visible set. A bumped slot can land on a HIDDEN post's
// order_index, creating a cross (visible↔hidden) tie that sorts nondeterministically on reload.
// Repro: 2 visible June cards sharing order_index 5, 1 hidden May card at 6 → after a June
// reorder, a visible card is bumped to 6, colliding with the hidden card.
// Asserts the invariant: after the reorder, no two posts share an order_index. On main: FAIL.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const V1 = 'p_ro1_' + TS, V2 = 'p_ro2_' + TS, H = 'p_roh_' + TS;

(async () => {
  const S = Q.makeOk('P20 reorder-collision');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    // Isolated far-future months (no real Sidney cards): two Jul-2027 cards sharing
    // order_index 5; one hidden Jun-2027 card at order_index 6.
    await Q.up({ id: V1, name: 'RO-V1 ' + TS, platforms: 'instagram', scheduled_date: '2027-07-12', order_index: 5, status: 'In Progress' });
    await Q.up({ id: V2, name: 'RO-V2 ' + TS, platforms: 'instagram', scheduled_date: '2027-07-13', order_index: 5, status: 'In Progress' });
    await Q.up({ id: H,  name: 'RO-H ' + TS,  platforms: 'instagram', scheduled_date: '2027-06-20', order_index: 6, status: 'In Progress' });
    await Q.pollRaw(V1, r => r.id === V1, 'id'); await Q.pollRaw(V2, r => r.id === V2, 'id'); await Q.pollRaw(H, r => r.id === H, 'id');

    // load all three
    const present = await smm.evaluate(async (a) => {
      for (let i = 0; i < 25; i++) { try { await loadCalendarPosts(); } catch (e) {}
        await new Promise(x => setTimeout(x, 800));
        const ids = (calState.posts || []).map(p => p.id);
        if (ids.includes(a.V1) && ids.includes(a.V2) && ids.includes(a.H)) return true; }
      return false;
    }, { V1, V2, H });
    S.ok(present, 'all 3 cards loaded');

    // filter to June (hides the May card), then simulate a drag-reorder of the two visible cards.
    const dragRes = await smm.evaluate(async (a) => {
      if (calState.view !== 'organizer') { calState.view = 'organizer'; _calRenderBody({ preserveScroll: false }); }
      await new Promise(x => setTimeout(x, 300));
      onCalMonthFilterChange('2027-07');      // hide Jun-2027 card H; show only V1,V2
      await new Promise(x => setTimeout(x, 400));
      const strip = document.getElementById('calStrip');
      if (!strip) return { err: 'no strip' };
      const c1 = strip.querySelector('.cal-card[data-pid="' + a.V1 + '"]');
      const c2 = strip.querySelector('.cal-card[data-pid="' + a.V2 + '"]');
      if (!c1 || !c2) return { err: 'cards not in strip', has1: !!c1, has2: !!c2 };
      const domBefore = Array.from(strip.querySelectorAll('.cal-card[draggable="true"]')).map(c => c.dataset.pid);
      // reorder DOM: move V1 to AFTER V2 (swap), then fire the strip's drop handler
      c2.parentNode.insertBefore(c1, c2.nextSibling);
      const domAfter = Array.from(strip.querySelectorAll('.cal-card[draggable="true"]')).map(c => c.dataset.pid);
      strip.dispatchEvent(new Event('drop'));
      return { domBefore, domAfter };
    }, { V1, V2, H });
    console.log('drag:', JSON.stringify(dragRes));
    S.ok(!dragRes.err, 'reorder simulated (' + JSON.stringify(dragRes.err || 'ok') + ')');

    // wait for the reorder write to settle, then read the three order_index values
    await smm.waitForTimeout(6000);
    const rows = {};
    for (const id of [V1, V2, H]) rows[id] = Number((await Q.rawRow(id, 'order_index')).order_index);
    console.log('order_index after reorder:', JSON.stringify({ V1: rows[V1], V2: rows[V2], H: rows[H] }));
    const vals = [rows[V1], rows[V2], rows[H]];
    const unique = new Set(vals).size === vals.length;
    S.ok(unique, 'INVARIANT: no two posts share an order_index after a filtered reorder (V1=' + rows[V1] + ' V2=' + rows[V2] + ' H=' + rows[H] + ')');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: V1, status: 'Archived' }); await Q.up({ id: V2, status: 'Archived' }); await Q.up({ id: H, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
