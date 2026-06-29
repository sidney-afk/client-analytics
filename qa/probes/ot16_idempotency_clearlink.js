// ot16_idempotency_clearlink.js — two correctness edges (live).
//  A) same-tick double-approve = ONE effect (saving-guard): two synchronous clicks
//     on the SMM approve button produce a single status-changing upsert + correct
//     final status (not double-advanced).
//  B) __CLEAR_LINK__: clearing a linked Linear slot empties linear_issue_id live.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const A = 'sr_ot16a_' + Date.now(), B = 'sr_ot16b_' + Date.now();
const NA = 'OT idem ' + Date.now(), NB = 'OT clearlink ' + Date.now();
const VID = 'https://linear.app/syncsocial/issue/VID-16';
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: A, name: NA, order_index: 1, asset_url: 'https://frame.io/x/ot16a', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' });
  up({ id: B, name: NB, order_index: 2, asset_url: 'https://frame.io/x/ot16b', thumbnail_url: '', linear_issue_id: VID, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=in.(' + A + ',' + B + ')&select=id'); return (Array.isArray(r) && r.length >= 2) ? r : null; }, 12000, 800);

  const browser = await launch();
  try {
    // ---- A) idempotency ----
    const page = await smm(browser);
    let statusUpserts = 0;
    page.on('request', r => { if (/sample-review-upsert/.test(r.url())) { const d = r.postData() || ''; if (/"video_status"\s*:\s*"Kasper Approval"/.test(d)) statusUpserts++; } });
    await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); });
    await page.waitForTimeout(500);
    await page.evaluate((nm) => { const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm); if (card) (card.querySelector('.kcard-strip') || card).click(); }, NA);
    await page.waitForTimeout(400);
    // two synchronous clicks on the same approve button
    const dbl = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-main');
      if (!b) return 0; b.click(); b.click(); return 2;
    }, NA);
    ok(dbl === 2, 'fired two synchronous approve clicks');
    const r1 = await poll(() => { const r = supa('id=eq.' + A + '&select=video_status'); return (r[0] && r[0].video_status === 'Kasper Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!r1, 'video reached Kasper Approval (single correct transition)');
    await page.waitForTimeout(1200);
    ok(statusUpserts <= 1, 'same-tick double-click → at most ONE status-changing upsert (idempotent)', 'statusUpserts=' + statusUpserts);
    const r1b = supa('id=eq.' + A + '&select=video_status,status');
    ok(r1b[0] && r1b[0].video_status === 'Kasper Approval', 'not double-advanced past Kasper Approval', 'v=' + (r1b[0] || {}).video_status);

    // ---- B) __CLEAR_LINK__ ----
    await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); });
    await page.waitForTimeout(600);
    const bSel = `#sxrStrip .cal-card[data-pid="${B}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), bSel, { timeout: 10000 }).catch(() => {});
    // open the linked video slot (pencil), clear it, commit
    await page.waitForTimeout(1200);
    const opened = await page.evaluate((s) => {
      const wrap = document.querySelector(`${s} .cal-linear-link-wrap .cal-linear-edit`) || document.querySelector(`${s} .cal-linear-btn-video`);
      if (!wrap) return false; wrap.click(); return true;
    }, bSel);
    ok(opened, 'opened the linked Linear slot to clear it');
    const got = await page.waitForSelector(`${bSel} .cal-linear-input`, { timeout: 5000 }).then(() => true).catch(() => false);
    if (got) {
      await page.fill(`${bSel} .cal-linear-input`, '');
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const cleared = await poll(() => { const r = supa('id=eq.' + B + '&select=linear_issue_id'); const v = r[0] && r[0].linear_issue_id; return (r[0] && (!v || v === '')) ? r[0] : null; }, 12000, 900);
      ok(!!cleared, 'clearing the slot emptied linear_issue_id (__CLEAR_LINK__) in live DB');
    } else { ok(false, 'Linear input opened for clearing'); }

    ok((await appErrs(page)).length === 0, 'zero app JS errors', (await appErrs(page)).slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(A) && archiveSafe(B), 'cleanup: both seeds archived');
    const stray = supa('id=in.(' + A + ',' + B + ')&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active rows');
  }

  console.log('\nRESULT ot16_idempotency_clearlink: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
