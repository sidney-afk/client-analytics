// ot13_kasper_isolation.js — Kasper samples↔calendar isolation (live).
// A sample at Kasper Approval shows ONLY in the Samples sub-tab, and every card
// in that queue is a samples card (no calendar bleed). Switching to the calendar
// "Review Session" sub-tab must NOT show the sample.
const L = require('../sxr_courier_lib.js');
const { launch, kasper, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_ot13_' + Date.now();
const NAME = 'OT isolation ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/ot13', thumbnail_url: '', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await kasper(browser);  // opens Samples sub-tab

    // sample appears in the Samples sub-tab
    await page.waitForFunction((nm) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === nm), NAME, { timeout: 15000 }).catch(() => {});
    const inSamples = await page.evaluate((nm) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === nm), NAME);
    ok(inSamples, 'sample shows in the Kasper Samples sub-tab');

    // every card in the samples queue is a samples-sourced card (has the sxr kasper pid)
    const allSamples = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')];
      return { total: cards.length, samples: cards.filter(c => c.hasAttribute('data-sxr-kasper-pid')).length };
    });
    ok(allSamples.total > 0 && allSamples.total === allSamples.samples, 'every queue card is a samples card (no calendar bleed)', allSamples.samples + '/' + allSamples.total);

    // switch to the calendar "Review Session" sub-tab — the sample must NOT appear
    await page.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="review"]'); if (b) b.click(); });
    await page.waitForTimeout(1500);
    const leaked = await page.evaluate((nm) => {
      const txt = (document.getElementById('kasperContent') || {}).textContent || '';
      const sxrCards = document.querySelectorAll('#kasperContent [data-sxr-kasper-pid]').length;
      return { nameLeak: txt.includes(nm), sxrCards };
    }, NAME);
    ok(!leaked.nameLeak, 'sample does NOT appear in the calendar Review Session queue');
    ok(leaked.sxrCards === 0, 'no samples cards rendered under the calendar review tab', 'sxrCards=' + leaked.sxrCards);

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot13_kasper_isolation: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
