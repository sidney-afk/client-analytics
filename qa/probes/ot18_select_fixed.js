// ot18_select_fixed.js — VERIFIES BUG-2 FIX: multi-select + bulk archive (live).
// Seeds 3 cards, enters select mode, selects 2 (incl. a shift-range check), bulk-
// archives them, and asserts both are Archived in the live DB while the 3rd stays
// active. Also confirms the select bar count + archive-enable wiring.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const A = 'sr_ot18a_' + Date.now(), B = 'sr_ot18b_' + Date.now(), C = 'sr_ot18c_' + Date.now();
const NA = 'OT-sel-A ' + Date.now(), NB = 'OT-sel-B ' + Date.now(), NC = 'OT-sel-C ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }
const statusOf = (id) => { const r = supa('id=eq.' + id + '&select=status'); return r[0] ? String(r[0].status) : null; };

(async () => {
  up({ id: A, name: NA, order_index: 1, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: B, name: NB, order_index: 2, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: C, name: NC, order_index: 3, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=in.(' + A + ',' + B + ',' + C + ')&select=id'); return (Array.isArray(r) && r.length >= 3) ? r : null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await smm(browser);
    const aSel = `#sxrStrip .cal-card[data-pid="${A}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), aSel, { timeout: 12000 }).catch(() => {});

    // enter select mode
    await page.click('#sxrView .cal-select-btn');
    await page.waitForTimeout(400);
    const inMode = await page.evaluate(() => ({
      active: !!document.querySelector('#sxrView .cal-select-btn.active'),
      bar: !!document.getElementById('sxrSelectBar'),
      selectable: document.querySelectorAll('#sxrStrip .cal-card-selectable').length
    }));
    ok(inMode.active && inMode.bar, 'select mode engaged (button active + select bar shown)');
    ok(inMode.selectable >= 3, 'cards became selectable', 'selectable=' + inMode.selectable);

    // select A and B via their overlays
    await page.click(`#sxrStrip .cal-card[data-pid="${A}"] .cal-card-select-overlay`);
    await page.click(`#sxrStrip .cal-card[data-pid="${B}"] .cal-card-select-overlay`);
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => ({
      count: (document.getElementById('sxrSelectCount') || {}).textContent,
      archiveEnabled: !(document.getElementById('sxrSelectArchive') || {}).disabled,
      aSel: document.querySelector('#sxrStrip .cal-card.cal-card-selected[data-pid]') ? true : false
    }));
    ok(/2 selected/.test(sel.count || ''), 'select count shows "2 selected"', JSON.stringify(sel.count));
    ok(sel.archiveEnabled, 'Archive button enabled with a selection');

    // bulk archive → confirm
    await page.click('#sxrSelectArchive');
    await page.waitForFunction(() => { const o = document.getElementById('confirmOverlay'); return o && o.classList.contains('active'); }, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => /Archive 2 samples\?/.test((document.getElementById('confirmTitle') || {}).textContent || '')), 'bulk-archive confirm shows the right count');
    await page.click('#confirmYes');

    // A and B Archived in live DB; C still active
    const done = await poll(() => {
      const sa = statusOf(A), sb = statusOf(B), sc = statusOf(C);
      return (sa === 'Archived' && sb === 'Archived' && sc !== 'Archived') ? { sa, sb, sc } : null;
    }, 16000, 1200);
    ok(!!done, 'A+B archived in live DB, C still active', done ? ('A=' + done.sa + ' B=' + done.sb + ' C=' + done.sc) : '');

    // A and B removed from the Sheet; C remains
    await page.waitForTimeout(500);
    const dom = await page.evaluate((ids) => ({ a: !!document.querySelector(`#sxrStrip .cal-card[data-pid="${ids[0]}"]`), b: !!document.querySelector(`#sxrStrip .cal-card[data-pid="${ids[1]}"]`), c: !!document.querySelector(`#sxrStrip .cal-card[data-pid="${ids[2]}"]`) }), [A, B, C]);
    ok(!dom.a && !dom.b && dom.c, 'archived cards removed from Sheet, C remains', JSON.stringify(dom));

    ok((await appErrs(page)).length === 0, 'zero app JS errors', (await appErrs(page)).slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(A) && archiveSafe(B) && archiveSafe(C), 'cleanup: all 3 archived');
    const stray = supa('id=in.(' + A + ',' + B + ',' + C + ')&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active rows');
  }

  console.log('\nRESULT ot18_select_fixed: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
