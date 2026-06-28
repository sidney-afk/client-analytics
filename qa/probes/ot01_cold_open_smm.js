// ot01_cold_open_smm.js — COLD-OPEN SMM journey against the LIVE backend.
// Seeds NOTHING. Drives the REAL UI: click the create button, type a name (→
// promote + live upsert), set video URL + creative direction, change a status via
// the real picker — reading the LIVE sample_reviews row back at each step — then
// archive. Scopes to the card it creates (the test client may hold other rows).
// Asserts 0 app JS errors.
const L = require('../sxr_courier_lib.js');
const { launch, smm, supa, supaEvents, poll, appErrs, archiveSafe } = L;

const NAME = 'OT cold-open ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  const browser = await launch();
  let createdId = null;
  try {
    const page = await smm(browser);

    // --- 1) create a sample via the REAL add button ---
    const addBtn = await page.$('#sxrStrip .cal-card-add-hero, #sxrStrip .cal-card-add');
    ok(!!addBtn, 'add-card affordance present');
    if (addBtn) await addBtn.click();
    await page.waitForFunction(() => !!document.querySelector('#sxrStrip .cal-card[data-pid^="__sxrblank__"]'), { timeout: 8000 }).catch(() => {});
    const blankPid = await page.evaluate(() => { const c = document.querySelector('#sxrStrip .cal-card[data-pid^="__sxrblank__"]'); return c ? c.getAttribute('data-pid') : null; });
    ok(!!blankPid, 'blank card created', 'pid=' + blankPid);

    // --- 2) type a name into the BLANK card → debounced promote + live upsert ---
    const nameSel = `#sxrStrip .cal-card[data-pid="${blankPid}"] .cal-fld-name`;
    const nameInput = await page.$(nameSel);
    ok(!!nameInput, 'name field present on blank card');
    if (nameInput) { await nameInput.click(); await nameInput.type(NAME); await page.keyboard.press('Tab'); }

    const row = await poll(() => {
      const r = supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(NAME) + '&select=id,name,video_status,graphic_status,status');
      return (Array.isArray(r) && r[0]) ? r[0] : null;
    }, 20000, 1000);
    ok(!!row, 'name persisted to LIVE sample_reviews');
    if (!row) throw new Error('row never persisted — aborting (nothing to clean)');
    createdId = row.id;
    ok(String(row.id).startsWith('sr_'), 'minted real sr_* id', 'id=' + row.id);
    ok(row.status === 'In Progress', 'fresh sample status = In Progress', 'got=' + row.status);

    const cardSel = `#sxrStrip .cal-card[data-pid="${createdId}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), cardSel, { timeout: 8000 }).catch(() => {});
    const promoted = await page.$(cardSel);
    ok(!!promoted, 'DOM card promoted to real id', 'id=' + createdId);

    // --- 3) set the video URL via the real link input ---
    const VIDEO = 'https://frame.io/x/ot-' + Date.now();
    const vid = await page.$(`${cardSel} .cal-link-input[data-fld="asset_url"]`);
    ok(!!vid, 'video URL input present');
    if (vid) {
      await vid.click(); await vid.fill(VIDEO); await page.keyboard.press('Tab');
      const r2 = await poll(() => { const r = supa('id=eq.' + createdId + '&client=eq.sidneylaruel&select=asset_url'); return (r[0] && r[0].asset_url === VIDEO) ? r[0] : null; }, 12000, 1000);
      ok(!!r2, 'video URL persisted to LIVE row');
    }

    // --- 4) creative direction via the real textarea ---
    const CD = 'Punchy hook, fast cuts ' + Date.now();
    const cd = await page.$(`${cardSel} .sxr-cd-input`);
    ok(!!cd, 'creative-direction textarea present');
    if (cd) {
      await cd.click(); await cd.fill(CD); await page.keyboard.press('Tab');
      const r3 = await poll(() => { const r = supa('id=eq.' + createdId + '&client=eq.sidneylaruel&select=creative_direction'); return (r[0] && r[0].creative_direction === CD) ? r[0] : null; }, 12000, 1000);
      ok(!!r3, 'creative direction persisted to LIVE row');
    }

    // --- 5) change a status via the real picker (video → For SMM Approval) ---
    const trigger = await page.$(`${cardSel} .cal-fld-substatus-trigger`);
    ok(!!trigger, 'status trigger present');
    if (trigger) {
      await trigger.click(); await page.waitForTimeout(350);
      const picked = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')];
        const t = items.find(i => /For SMM Approval/i.test(i.textContent));
        if (t) { t.click(); return t.textContent.trim(); }
        return null;
      });
      ok(!!picked, 'picked "For SMM Approval" from real menu', 'picked=' + picked);
      const r4 = await poll(() => {
        const r = supa('id=eq.' + createdId + '&client=eq.sidneylaruel&select=video_status,graphic_status');
        return (r[0] && (r[0].video_status === 'For SMM Approval' || r[0].graphic_status === 'For SMM Approval')) ? r[0] : null;
      }, 14000, 1000);
      ok(!!r4, 'status change persisted to LIVE row', r4 ? ('v=' + r4.video_status + ' g=' + r4.graphic_status) : '');
    }

    // --- 6) audit trail ---
    const events = supaEvents('sample_id=eq.' + createdId + '&select=id&limit=20');
    ok(Array.isArray(events) && events.length > 0, 'audit events recorded', 'count=' + (Array.isArray(events) ? events.length : 'n/a'));

    // --- 7) zero app JS errors ---
    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));

  } finally {
    await browser.close();
    if (createdId) { const cleaned = archiveSafe(createdId); ok(cleaned, 'cleanup: created row archived', 'id=' + createdId); }
    const stray = supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(NAME) + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active rows', 'stray=' + (Array.isArray(stray) ? stray.length : 'n/a'));
  }

  console.log('\nRESULT ot01_cold_open_smm: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
