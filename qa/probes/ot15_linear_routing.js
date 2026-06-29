// ot15_linear_routing.js — Linear sync routing nuances (mocked Linear, live DB).
//  1) Graphic approve pushes to the GRAPHIC issue (graphic_linear_issue_id), not video.
//  2) Editing a non-status field (name) fires NO linear-set-status push.
const L = require('../sxr_courier_lib.js');
const { launch, smm, kasper, up, supa, poll, appErrs, archiveSafe, linearCalls, resetLinearCalls } = L;

const ID = 'sr_ot15_' + Date.now();
const NAME = 'OT linear routing ' + Date.now();
const VID = 'https://linear.app/syncsocial/issue/VID-15';
const GRA = 'https://linear.app/syncsocial/issue/GRA-15';
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  resetLinearCalls();
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/ot15', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
       linear_issue_id: VID, graphic_linear_issue_id: GRA,
       video_status: 'Approved', graphic_status: 'Kasper Approval', status: 'Kasper Approval' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    // --- 1) Kasper approve GRAPHIC → push must target the GRA issue ---
    const kp = await kasper(browser);
    await kp.waitForFunction((nm) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === nm), NAME, { timeout: 15000 }).catch(() => {});
    await kp.evaluate((nm) => { const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm); if (card) (card.querySelector('.kcard-strip') || card).click(); }, NAME);
    await kp.waitForTimeout(500);
    const clicked = await kp.evaluate((nm) => {
      const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const b = card && card.querySelector('.cal-review-panel[data-sxr-kasper-comp="graphic"] .cal-review-approve-main');
      if (!b) return false; b.click(); return true;
    }, NAME);
    ok(clicked, 'clicked Kasper approve on the GRAPHIC panel');
    const row = await poll(() => { const r = supa('id=eq.' + ID + '&select=graphic_status'); return (r[0] && r[0].graphic_status === 'Client Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!row, 'graphic → Client Approval (live)');
    await kp.waitForTimeout(600);
    const lc = linearCalls();
    const graPush = lc.find(c => c.path === 'linear-set-status' && /GRA-15/.test(JSON.stringify(c.payload)));
    const vidPush = lc.find(c => c.path === 'linear-set-status' && /VID-15/.test(JSON.stringify(c.payload)));
    ok(!!graPush, 'Linear push routed to the GRAPHIC issue (GRA-15)', graPush ? JSON.stringify(graPush.payload).slice(0, 110) : 'none');
    ok(!vidPush, 'NO push to the VIDEO issue (graphic approve must not touch video)');
    await kp.context().close();

    // --- 2) editing a non-status field (name) fires NO status push ---
    resetLinearCalls();
    const sm = await smm(browser);
    const cardSel = `#sxrStrip .cal-card[data-pid="${ID}"]`;
    await sm.waitForFunction((s) => !!document.querySelector(s), cardSel, { timeout: 12000 }).catch(() => {});
    await sm.click(`${cardSel} .cal-fld-name`);
    await sm.fill(`${cardSel} .cal-fld-name`, NAME + ' edited');
    await sm.keyboard.press('Tab');
    await poll(() => { const r = supa('id=eq.' + ID + '&select=name'); return (r[0] && /edited/.test(r[0].name || '')) ? r[0] : null; }, 12000, 800);
    await sm.waitForTimeout(1200);
    const afterName = linearCalls().filter(c => c.path === 'linear-set-status');
    ok(afterName.length === 0, 'editing the name fired NO linear-set-status push', 'pushes=' + afterName.length);

    ok((await appErrs(sm)).length === 0, 'zero app JS errors (smm)');
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot15_linear_routing: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
