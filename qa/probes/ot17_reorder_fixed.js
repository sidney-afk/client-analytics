// ot17_reorder_fixed.js — VERIFIES BUG-1 FIX: drag-to-reorder persists live.
// Seeds 3 cards (A,B,C order 1,2,3), drags C to the front via the real HTML5 drag
// sequence, and asserts the live DB order_index reflects C→front (persisted via
// the sample-review-reorder webhook). Also checks no snap-back after a reload.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const A = 'sr_ot17a_' + Date.now(), B = 'sr_ot17b_' + Date.now(), C = 'sr_ot17c_' + Date.now();
const NA = 'OT-A ' + Date.now(), NB = 'OT-B ' + Date.now(), NC = 'OT-C ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }
const ordOf = (id) => { const r = supa('id=eq.' + id + '&select=order_index'); return r[0] ? Number(r[0].order_index) : null; };

(async () => {
  up({ id: A, name: NA, order_index: 1, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: B, name: NB, order_index: 2, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: C, name: NC, order_index: 3, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=in.(' + A + ',' + B + ',' + C + ')&select=id'); return (Array.isArray(r) && r.length >= 3) ? r : null; }, 12000, 800);

  const browser = await launch();
  let reorderHit = 0;
  try {
    const page = await smm(browser);
    page.on('request', r => { if (/sample-review-reorder/.test(r.url())) reorderHit++; });
    const aSel = `#sxrStrip .cal-card[data-pid="${A}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), aSel, { timeout: 12000 }).catch(() => {});

    // among OUR three cards, initial relative order is A,B,C
    const trio = (arr) => arr.filter(id => id === A || id === B || id === C);
    const domOrder = () => page.evaluate(() => Array.from(document.querySelectorAll('#sxrStrip .cal-card[draggable="true"]')).map(c => c.dataset.pid));
    const totalCards = await page.evaluate(() => document.querySelectorAll('#sxrStrip .cal-card[draggable="true"]').length);
    console.log('  (total draggable cards in Sheet:', totalCards, '— BUG-3 fix should keep this small)');
    const order0 = trio(await domOrder());
    ok(order0.join(',') === [A, B, C].join(','), 'initial relative order of our cards is A,B,C', order0.join(','));

    // drag C to the FRONT (onto A, before its midpoint) via the real DnD sequence
    await page.evaluate((ids) => {
      const [a, c] = ids;
      const strip = document.getElementById('sxrStrip');
      const drag = strip.querySelector(`.cal-card[data-pid="${c}"]`);
      const over = strip.querySelector(`.cal-card[data-pid="${a}"]`);
      const dt = new DataTransfer();
      const fire = (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, extra || {})));
      fire(drag, 'dragstart');
      const rect = over.getBoundingClientRect();
      fire(over, 'dragover', { clientX: rect.left + 4, clientY: rect.top + rect.height / 2 });
      fire(strip, 'drop');
      fire(drag, 'dragend');
    }, [A, C]);

    // among our trio, C should now lead
    await page.waitForTimeout(300);
    const order1 = trio(await domOrder());
    ok(order1[0] === C, 'after drag, C is first among our cards in the DOM', order1.join(','));

    // live DB: C now has the lowest order_index (persisted)
    const moved = await poll(() => {
      const oc = ordOf(C), oa = ordOf(A), ob = ordOf(B);
      return (oc != null && oa != null && ob != null && oc < oa && oc < ob) ? { oc, oa, ob } : null;
    }, 14000, 1000);
    ok(!!moved, 'C persisted to the front in the LIVE DB (order_index lowest)', moved ? ('C=' + moved.oc + ' A=' + moved.oa + ' B=' + moved.ob) : '');
    ok(reorderHit > 0, 'sample-review-reorder webhook was called', 'calls=' + reorderHit);

    // no snap-back: force a background reload, order must hold (optimistic guard)
    await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ background: true }); });
    await page.waitForTimeout(2500);
    const order2 = trio(await domOrder());
    ok(order2[0] === C, 'no snap-back: C still first among our cards after a background reload', order2.join(','));

    ok((await appErrs(page)).length === 0, 'zero app JS errors', (await appErrs(page)).slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(A) && archiveSafe(B) && archiveSafe(C), 'cleanup: all 3 seeds archived');
    const stray = supa('id=in.(' + A + ',' + B + ',' + C + ')&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active rows');
  }

  console.log('\nRESULT ot17_reorder_fixed: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
