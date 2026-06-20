// p10 — §4.1/§6 (user example): same Linear sub-issue link on two cards.
// Actual behaviour: the backend PREVENTS the duplicate — the second card's linear_issue_id is
// blanked on write, so two cards never truly share a link (no hidden card, no corruption).
// This probe documents/verifies that handling.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const LINK = 'https://linear.app/test/issue/DUPE-' + TS;
const A = 'p_dup_a_' + TS;
const B = 'p_dup_b_' + TS;

(async () => {
  const S = Q.makeOk('P10 linear-dedupe');
  const browser = await Q.launch();
  try {
    await Q.up({ id: A, name: 'DUPE-A ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      linear_issue_id: LINK, order_index: 1000, status: 'In Progress' });
    const aRow = await Q.pollRaw(A, r => r.linear_issue_id === LINK, 'linear_issue_id', 12000);
    S.ok(aRow.linear_issue_id === LINK, 'first card keeps the Linear link');

    await new Promise(x => setTimeout(x, 2000));
    await Q.up({ id: B, name: 'DUPE-B ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      linear_issue_id: LINK, order_index: 2000, status: 'In Progress' });
    await Q.pollRaw(B, r => r.id === B, 'id');
    // give any backend dedupe-on-write a beat to settle
    await new Promise(x => setTimeout(x, 4000));
    const bRow = await Q.rawRow(B, 'linear_issue_id,name');
    console.log('B row:', JSON.stringify(bRow));
    S.ok(!String(bRow.linear_issue_id || '').trim(), 'second card with a COLLIDING link is blanked server-side (dupe prevented)');

    // Both cards still coexist and are visible (no silent hiding / no corruption).
    const smm = await Q.smmPage(browser);
    const seen = await smm.evaluate(async (a) => {
      for (let i = 0; i < 20; i++) {
        try { await loadCalendarPosts(); } catch (e) {}
        await new Promise(x => setTimeout(x, 800));
        const ids = (calState.posts || []).map(p => p.id);
        if (ids.includes(a.A) && ids.includes(a.B)) return { hasA: true, hasB: true };
      }
      const ids = (calState.posts || []).map(p => p.id);
      return { hasA: ids.includes(a.A), hasB: ids.includes(a.B) };
    }, { A, B });
    console.log('visibility:', JSON.stringify(seen));
    S.ok(seen.hasA && seen.hasB, 'both cards remain visible (no card hidden by a phantom dupe)');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: A, status: 'Archived' });
    await Q.up({ id: B, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
