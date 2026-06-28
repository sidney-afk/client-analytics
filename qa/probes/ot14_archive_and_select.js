// ot14_archive_and_select.js — per-card archive (works) + BUG-2 (bulk select dead).
//  POSITIVE: the per-card X (archiveSxrCard) archives the row live + removes the card.
//  BUG-2: the toolbar "select multiple samples to archive" button is rendered but
//  _sxrToggleSelectMode / _sxrCardSelectClick / _sxrArchiveSelected are empty stubs,
//  so clicking it does nothing (no select bar, no card overlays, no .active).
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const A = 'sr_ot14a_' + Date.now(), B = 'sr_ot14b_' + Date.now();
const NA = 'OT archive X ' + Date.now(), NB = 'OT select ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: A, name: NA, order_index: 1, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: B, name: NB, order_index: 2, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=in.(' + A + ',' + B + ')&select=id'); return (Array.isArray(r) && r.length >= 2) ? r : null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await smm(browser);
    const aSel = `#sxrStrip .cal-card[data-pid="${A}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), aSel, { timeout: 12000 }).catch(() => {});

    // --- POSITIVE: per-card archive via the X (confirms via #confirmYes) ---
    await page.click(`${aSel} .cal-card-del`);
    await page.waitForFunction(() => { const o = document.getElementById('confirmOverlay'); return o && o.classList.contains('active'); }, { timeout: 5000 }).catch(() => {});
    ok(await page.evaluate(() => (document.getElementById('confirmTitle') || {}).textContent === 'Archive this sample?'), 'archive confirm dialog shown');
    await page.click('#confirmYes');
    const arch = await poll(() => { const r = supa('id=eq.' + A + '&select=status'); return (r[0] && String(r[0].status) === 'Archived') ? r[0] : null; }, 14000, 1000);
    ok(!!arch, 'per-card X archives the row in the live DB');
    await page.waitForTimeout(600);
    const gone = await page.evaluate((s) => !document.querySelector(s), aSel);
    ok(gone, 'archived card removed from the Sheet');

    // --- BUG-2: multi-select button shown but dead ---
    const selBtn = await page.$('#sxrView .cal-select-btn');
    ok(!!selBtn, 'multi-select button is rendered in the toolbar (affordance shown)');
    if (selBtn) {
      await selBtn.click();
      await page.waitForTimeout(600);
      const st = await page.evaluate(() => ({
        bar: !!document.getElementById('sxrSelectBar'),
        active: !!document.querySelector('#sxrView .cal-select-btn.active'),
        overlays: document.querySelectorAll('#sxrStrip .cal-card-select-overlay').length,
        stubToggle: (typeof _sxrToggleSelectMode === 'function') ? !/sxrState|selectMode\s*=|querySelector/.test(_sxrToggleSelectMode.toString()) : 'n/a'
      }));
      ok(!st.bar && !st.active && st.overlays === 0, 'BUG-2 confirmed: clicking multi-select does NOTHING (no bar/active/overlays)', 'bar=' + st.bar + ' active=' + st.active + ' overlays=' + st.overlays);
      ok(st.stubToggle === true, 'BUG-2 root cause: _sxrToggleSelectMode is an empty stub');
      console.log('  >>> BUG-2: "select multiple samples to archive" button is shown but inert (Surface-6 stubs never wired).');
    }

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(A) && archiveSafe(B), 'cleanup: both seeds archived');
    const stray = supa('id=in.(' + A + ',' + B + ')&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active rows');
  }

  console.log('\nRESULT ot14_archive_and_select: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS (per-card archive works; documents BUG-2)'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
