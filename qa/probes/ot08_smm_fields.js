// ot08_smm_fields.js — SMM Sheet field interactions against the LIVE backend.
//  1) hide-creative-direction eye toggle persists hide_creative_direction 1↔''
//  2) Linear video sub-issue: click slot → paste URL → blur commits linear_issue_id
//  3) thumbnail derivation: a YouTube thumbnail_url derives an <img> preview
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_ot8_' + Date.now();
const NAME = 'OT smm fields ' + Date.now();
const LINEAR = 'https://linear.app/syncsocial/issue/VID-123';
const BAD_LINEAR = 'https://example.com/not-linear';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: ID, name: NAME, order_index: 1, asset_url: '', thumbnail_url: '', creative_direction: 'Brief for editor',
       video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await smm(browser);
    const cardSel = `#sxrStrip .cal-card[data-pid="${ID}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), cardSel, { timeout: 12000 }).catch(() => {});
    ok(!!(await page.$(cardSel)), 'seeded card present in SMM Sheet');

    // --- 1) hide-creative-direction eye toggle ---
    await page.click(`${cardSel} .sxr-cd-eye`);
    const h1 = await poll(() => { const r = supa('id=eq.' + ID + '&select=hide_creative_direction'); return (r[0] && String(r[0].hide_creative_direction) === '1') ? r[0] : null; }, 12000, 800);
    ok(!!h1, 'hide-cd toggle → hide_creative_direction=1 (live)');
    // toggle back
    await page.click(`${cardSel} .sxr-cd-eye`);
    const h0 = await poll(() => { const r = supa('id=eq.' + ID + '&select=hide_creative_direction'); const v = r[0] && r[0].hide_creative_direction; return (r[0] && (v === '' || v === null || v === '0')) ? r[0] : null; }, 12000, 800);
    ok(!!h0, 'hide-cd toggle back → not hidden (live)');

    // --- 2) thumbnail derivation from a YouTube URL (before the Linear guard test) ---
    const thumbInp = await page.$(`${cardSel} .cal-link-input[data-fld="thumbnail_url"]`);
    ok(!!thumbInp, 'thumbnail link input present');
    if (thumbInp) {
      await thumbInp.click(); await thumbInp.fill(YT); await page.keyboard.press('Tab');
      const tr = await poll(() => { const r = supa('id=eq.' + ID + '&select=thumbnail_url'); return (r[0] && r[0].thumbnail_url === YT) ? r[0] : null; }, 12000, 800);
      ok(!!tr, 'thumbnail URL persisted (live)');
      await page.waitForTimeout(400);
      const derived = await page.evaluate((s) => { const img = document.querySelector(`${s} .cal-card-thumb img`); return img ? img.getAttribute('src') : null; }, cardSel);
      ok(derived && /ytimg\.com|dQw4w9WgXcQ/.test(derived), 'thumbnail derived a YouTube image preview', JSON.stringify(derived));
    }

    // settle: let the thumbnail edit's debounced save + re-render finish so it
    // can't wipe an inline Linear input we open next (race fixed by waiting).
    async function openLinearInput(openSel) {
      for (let i = 0; i < 3; i++) {
        if (!(await page.$(openSel))) return false;
        await page.click(openSel);
        const got = await page.waitForSelector(`${cardSel} .cal-linear-input`, { timeout: 2500 }).then(() => true).catch(() => false);
        if (got) { await page.waitForTimeout(150); if (await page.$(`${cardSel} .cal-linear-input`)) return true; }
        await page.waitForTimeout(900);  // a re-render wiped it — settle and retry
      }
      return false;
    }
    await page.waitForTimeout(1500);

    // --- 3) Linear video sub-issue: VALID URL commits → linear_issue_id ---
    ok(!!(await page.$(`${cardSel} .cal-linear-btn-video`)), 'video Linear slot present');
    let committed = false, attempts = 0;
    for (let i = 0; i < 4 && !committed; i++) {
      const opened = await openLinearInput(`${cardSel} .cal-linear-btn-video`);
      if (!opened) { await page.waitForTimeout(800); continue; }
      attempts++;
      await page.fill(`${cardSel} .cal-linear-input`, LINEAR);
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const lr = await poll(() => { const r = supa('id=eq.' + ID + '&select=linear_issue_id'); return (r[0] && r[0].linear_issue_id === LINEAR) ? r[0] : null; }, 4000, 600);
      committed = !!lr;
      if (!committed) await page.waitForTimeout(900);  // a re-render likely wiped the input — settle, retry
    }
    ok(committed, 'valid Linear video URL committed → linear_issue_id (live)', 'attempts=' + attempts);
    if (attempts > 1) console.log('  NOTE: inline Linear commit needed ' + attempts + ' attempts → see OBS on inline-editor re-render race');

    // --- 4) Linear guard on the still-unlinked GRAPHIC slot: malformed → rejected ---
    await page.waitForTimeout(1500);
    const gOpened = await openLinearInput(`${cardSel} .cal-linear-btn-graphic`);
    ok(gOpened, 'graphic Linear slot opened (for guard test)');
    if (gOpened) {
      await page.fill(`${cardSel} .cal-linear-input`, BAD_LINEAR);
      await page.keyboard.press('Enter'); await page.waitForTimeout(800);
      const notified = await page.evaluate(() => { const o = document.getElementById('confirmOverlay'); return !!(o && o.classList.contains('active')); });
      ok(notified, 'malformed Linear URL triggers the "isn’t a Linear link" guard');
      await page.evaluate(() => { try { dismissConfirm(); } catch (e) {} try { const o = document.getElementById('confirmOverlay'); if (o) o.classList.remove('active'); } catch (e) {} });
      await page.waitForTimeout(400);
      const gr = supa('id=eq.' + ID + '&select=graphic_linear_issue_id');
      const gv = gr[0] && gr[0].graphic_linear_issue_id;
      ok(!gv, 'malformed URL NOT saved (graphic link stays empty)', JSON.stringify(gv));
    }

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot08_smm_fields: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
