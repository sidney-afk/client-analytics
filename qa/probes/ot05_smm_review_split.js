// ot05_smm_review_split.js — SMM Review queue + approve-split routing (live).
// Seed a sample with BOTH components at 'For SMM Approval' + media. In the SMM
// Review tab: approve VIDEO via the PRIMARY route (→ Kasper) and approve GRAPHIC
// via the ALT route (→ Client). Confirm each live transition and the worst-of
// overall status.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_ot5_' + Date.now();
const NAME = 'OT smm split ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/ot5', thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
       video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', status: 'For SMM Approval' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await smm(browser);
    await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); });
    await page.waitForTimeout(500);

    const expanded = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      if (!card) return false; (card.querySelector('.kcard-strip') || card).click(); return true;
    }, NAME);
    ok(expanded, 'seeded sample present in SMM Review queue + expanded');
    await page.waitForTimeout(400);

    // video panel: approve-split present, primary routes to Kasper (unseen)
    const split = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const p = card && card.querySelector('.cal-review-panel[data-comp="video"]');
      if (!p) return null;
      return { hasSplit: !!p.querySelector('.cal-review-approve-split'),
        primary: (p.querySelector('.cal-review-approve-main .cal-ap-route') || {}).textContent,
        alt: (p.querySelector('.cal-review-approve-alt') || {}).textContent };
    }, NAME);
    ok(split && split.hasSplit, 'SMM approve-split present on video');
    ok(split && /Kasper/i.test(split.primary || ''), 'primary route = Kasper (not yet seen by Kasper)', JSON.stringify(split && split.primary));

    // click video primary → Kasper Approval
    await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-main');
      if (b) b.click();
    }, NAME);
    const r1 = await poll(() => { const r = supa('id=eq.' + ID + '&select=video_status'); return (r[0] && r[0].video_status === 'Kasper Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!r1, 'video primary approve → Kasper Approval (live)');

    // graphic panel: approve via ALT route (→ Client)
    await page.waitForTimeout(600);
    const altClicked = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const p = card && card.querySelector('.cal-review-panel[data-comp="graphic"]');
      const alt = p && p.querySelector('.cal-review-approve-alt');
      if (!alt) return false; alt.click(); return true;
    }, NAME);
    ok(altClicked, 'graphic alt-route approve button clicked');
    const r2 = await poll(() => { const r = supa('id=eq.' + ID + '&select=graphic_status,status'); return (r[0] && r[0].graphic_status === 'Client Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!r2, 'graphic alt approve → Client Approval (live)');

    // worst-of overall = Kasper Approval (Kasper < Client)
    const r3 = supa('id=eq.' + ID + '&select=video_status,graphic_status,status');
    const st = r3[0] || {};
    ok(st.status === 'Kasper Approval', 'overall = worst-of(video,graphic) = Kasper Approval', 'v=' + st.video_status + ' g=' + st.graphic_status + ' overall=' + st.status);

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot05_smm_review_split: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
