// ot06_smm_resolve_on_approve.js — SMM simplified resolve (live).
// This rebuild intentionally has NO resolve-destination chooser modal (the prior
// attempt's 4-route picker was dropped under "fewer options"). Instead, approving
// an SMM component that still has OPEN change-requests marks them resolved as part
// of the send. Verify: seed a For-SMM-Approval video carrying an open client tweak,
// approve it → video goes to Kasper AND the open tweak is persisted done=true.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_ot6_' + Date.now();
const NAME = 'OT smm resolve ' + Date.now();
const now = new Date().toISOString();
const openTweak = [{ id: 'cm_ot6_' + Date.now(), parent_id: null, author: 'Client', role: 'client', is_tweak: true, audience: 'client', round: 1, body: 'Open request to resolve', created_at: now, updated_at: now, done: false, done_at: '', done_by: '' }];
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/ot6', thumbnail_url: '',
       video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval',
       video_tweaks: JSON.stringify(openTweak) });
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
    ok(expanded, 'sample with open tweak present in SMM Review + expanded');
    await page.waitForTimeout(400);

    // approve video (primary → Kasper) — should auto-resolve the open tweak
    const clicked = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-main');
      if (!b || b.disabled) return false; b.click(); return true;
    }, NAME);
    ok(clicked, 'approved video (primary route)');

    const row = await poll(() => { const r = supa('id=eq.' + ID + '&select=video_status,video_tweaks'); return (r[0] && r[0].video_status === 'Kasper Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!row, 'video → Kasper Approval (live)');
    if (row) {
      let resolved = false;
      try { const arr = JSON.parse(row.video_tweaks || '[]'); resolved = arr.length && arr.every(c => c.done === true); } catch {}
      ok(resolved, 'open change-request auto-resolved (done=true) on approve');
    }

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot06_smm_resolve_on_approve: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
