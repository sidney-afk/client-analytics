// ot04_kasper_review.js — KASPER samples sub-tab against the LIVE backend.
// Seed a sample with a component at 'Kasper Approval', open the Kasper view,
// switch to the Samples sub-tab (cross-client queue), expand the seeded card, and
// drive the REAL approve → Client. Confirms live DB transition + queue eviction +
// the (mocked) Linear push. Also asserts the sub-tab is flag-gated.
const L = require('../sxr_courier_lib.js');
const { launch, kasper, up, supa, poll, appErrs, archiveSafe, linearCalls, resetLinearCalls } = L;

const ID = 'sr_otk_' + Date.now();
const NAME = 'OT kasper review ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  resetLinearCalls();
  // seed: video at Kasper Approval (with a linked Linear issue → push assertion), graphic Approved
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/otk', thumbnail_url: '',
       linear_issue_id: 'https://linear.app/syncsocial/issue/VID-OT', graphic_linear_issue_id: '',
       video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await kasper(browser);  // ?Kasper=1&sxr=1#kasper → Samples sub-tab

    // sub-tab present (flag-gated)
    const hasSub = await page.evaluate(() => !!document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'));
    ok(hasSub, 'Kasper Samples sub-tab present (flag on)');

    // my seeded card surfaces in the cross-client queue
    await page.waitForFunction((nm) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === nm), NAME, { timeout: 15000 }).catch(() => {});
    const inQueue = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      if (!card) return null;
      return { clientLabel: (card.querySelector('.kcard-client') || {}).textContent, pending: (card.querySelector('.kcard-pending-strong') || {}).textContent };
    }, NAME);
    ok(!!inQueue, 'seeded sample surfaces in Kasper cross-client queue');
    if (inQueue) ok(/Video/i.test(inQueue.pending || ''), 'queue shows Video awaiting review', JSON.stringify(inQueue.pending));

    // expand + approve the video → Client
    await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      if (card) (card.querySelector('.kcard-strip') || card).click();
    }, NAME);
    await page.waitForTimeout(500);
    const approved = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const b = card && card.querySelector('.cal-review-panel[data-sxr-kasper-comp="video"] .cal-review-approve-main');
      if (!b) return false; b.click(); return true;
    }, NAME);
    ok(approved, 'clicked Kasper approve (→ Client) on video panel');

    const row = await poll(() => { const r = supa('id=eq.' + ID + '&select=video_status,status'); return (r[0] && r[0].video_status === 'Client Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!row, 'Kasper approve → video_status Client Approval in LIVE DB', row ? ('status=' + row.status) : '');

    // queue eviction (no more Kasper-Approval components on this card)
    await page.waitForTimeout(800);
    const stillThere = await page.evaluate((nm) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === nm), NAME);
    ok(!stillThere, 'card evicted from Kasper queue after approve');

    // Linear push (mocked) fired for the video issue with the new status
    const lc = linearCalls();
    const push = lc.find(c => c.path === 'linear-set-status' && c.payload && /VID-OT/.test(JSON.stringify(c.payload)));
    ok(!!push, 'Linear set-status push captured (mocked)', push ? JSON.stringify(push.payload).slice(0, 120) : 'none');
    ok(!push || /Client Approval/.test(JSON.stringify(push.payload)), 'Linear push carries the new status');

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot04_kasper_review: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
