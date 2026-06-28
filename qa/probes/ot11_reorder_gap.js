// ot11_reorder_gap.js — DOCUMENTS BUG-1: the SMM Sheet shows a drag-to-reorder
// grip (cards are draggable="true") but drag-reorder is NOT wired
// (_sxrWireDragOnCard is an empty stub, no drag listeners exist, and
// SXR_REORDER_URL is never called). A real drag therefore changes nothing.
// This probe proves the affordance is present AND that dragging is a no-op
// against the live backend. Assertions describe the CURRENT (buggy) reality so
// the suite stays green while the defect is recorded in the report.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const A = 'sr_ot11a_' + Date.now(), B = 'sr_ot11b_' + Date.now();
const NA = 'OT reorder A ' + Date.now(), NB = 'OT reorder B ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: A, name: NA, order_index: 1, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: B, name: NB, order_index: 2, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=in.(' + A + ',' + B + ')&select=id'); return (Array.isArray(r) && r.length >= 2) ? r : null; }, 12000, 800);

  const browser = await launch();
  let reorderCalls = 0;
  try {
    const page = await smm(browser);
    page.on('request', r => { if (/sample-review-reorder/.test(r.url())) reorderCalls++; });
    const aSel = `#sxrStrip .cal-card[data-pid="${A}"]`, bSel = `#sxrStrip .cal-card[data-pid="${B}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), aSel, { timeout: 12000 }).catch(() => {});

    // affordance present: grip visible + draggable=true
    const aff = await page.evaluate((s) => { const c = document.querySelector(s); return c ? { grip: !!c.querySelector('.cal-card-grip'), draggable: c.getAttribute('draggable') } : null; }, aSel);
    ok(aff && aff.grip, 'drag grip rendered on card (affordance shown to user)');
    ok(aff && aff.draggable === 'true', 'card marked draggable="true"', 'got=' + (aff && aff.draggable));

    // root cause: wiring fn is an empty stub
    const stub = await page.evaluate(() => (typeof _sxrWireDragOnCard === 'function') ? _sxrWireDragOnCard.toString() : 'n/a');
    ok(!/addEventListener|dragstart|dataTransfer/.test(stub), 'BUG-1 root cause: _sxrWireDragOnCard has NO drag wiring (empty stub)');

    // attempt a REAL drag A → B via the grip; reorder must be a no-op
    try { await page.dragAndDrop(`${aSel} .cal-card-grip`, bSel, { timeout: 5000 }); } catch (e) { /* native DnD may no-op in headless — that's the point */ }
    await page.waitForTimeout(1500);

    const after = supa('id=in.(' + A + ',' + B + ')&select=id,order_index&order=order_index');
    const oa = (after.find(r => r.id === A) || {}).order_index, ob = (after.find(r => r.id === B) || {}).order_index;
    ok(String(oa) === '1' && String(ob) === '2', 'BUG-1 confirmed: order_index UNCHANGED after drag (reorder is a no-op)', 'A=' + oa + ' B=' + ob);
    ok(reorderCalls === 0, 'BUG-1 confirmed: sample-review-reorder webhook NEVER called', 'calls=' + reorderCalls);

    console.log('  >>> BUG-1: drag grip is shown + cards are draggable, but reorder does nothing (no handlers, webhook unused).');

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(A) && archiveSafe(B), 'cleanup: both seeds archived');
    const stray = supa('id=in.(' + A + ',' + B + ')&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active rows');
  }

  console.log('\nRESULT ot11_reorder_gap: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS (documents BUG-1)'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
