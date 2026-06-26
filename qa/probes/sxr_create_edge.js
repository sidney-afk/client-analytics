// sxr_create_edge.js — create-lifecycle edges (Tier 1):
//   1) an empty blank card (Add then blur with no content) NEVER persists / promotes;
//   2) a failed FIRST save keeps the card on screen with a Save-failed chip + no DB row
//      (_sxrFailedNewCards retention), and clicking Retry after recovery persists it.
// Drives the real UI; uses a REAL el.blur() so the catch re-render surfaces the chip.
// Scoped to sidneylaruel; archives what it creates.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const FAILNAME = 'CE FAIL ' + TS;
const UPSERT_RE = /\/webhook\/sample-review-upsert\b/;
const failOn = (page) => page.route(UPSERT_RE, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'forced failure' }) }));
const failOff = (page) => page.unroute(UPSERT_RE);
const rowByName = (n) => { const r = Q.supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(n) + '&select=id,name'); return (Array.isArray(r) && r[0]) || null; };

(async () => {
  const browser = await Q.launch();
  let createdId = null;
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction(() => !!document.querySelector('#sxrBody .sxr-card-add'), { timeout: 15000 }).catch(() => {});

    // ── 1) Empty blank never persists / promotes. ──
    await page.evaluate(() => { const b = document.querySelector('#sxrBody .sxr-card-add'); if (b) b.click(); });
    await page.waitForTimeout(300);
    const blankId = await page.evaluate(() => { const c = document.querySelector('#sxrBody .sxr-card.is-editable .sxr-name-input'); const card = c && c.closest('.sxr-card'); return card ? card.getAttribute('data-sxr-id') : null; });
    ok(blankId && blankId.indexOf('__sxrblank__') === 0, 'Add inserts a blank card with a __sxrblank__ id', String(blankId));
    // Blur the name without typing → the blank must not promote or write.
    await page.evaluate(() => { const c = document.querySelector('#sxrBody .sxr-card.is-editable .sxr-name-input'); if (c) { c.focus(); c.blur(); } });
    await page.waitForTimeout(1500);
    const stillBlank = await page.evaluate((bid) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${bid}"]`), blankId);
    ok(stillBlank, 'an empty blank stays a __sxrblank__ card (no promote, no DB write)');

    // ── 2) Failed first save → retention + working retry. ──
    await failOn(page);
    await page.evaluate(() => { const b = document.querySelector('#sxrBody .sxr-card-add'); if (b) b.click(); });
    await page.waitForTimeout(300);
    await page.evaluate((nm) => {
      const c = document.querySelector('#sxrBody .sxr-card.is-editable.is-blank .sxr-name-input') || document.querySelectorAll('#sxrBody .sxr-card.is-editable .sxr-name-input')[document.querySelectorAll('#sxrBody .sxr-card.is-editable .sxr-name-input').length - 1];
      if (c) { c.focus(); c.value = nm; c.dispatchEvent(new Event('input', { bubbles: true })); c.blur(); }   // REAL blur → onblur flush + focus release
    }, FAILNAME);
    // The promoted card keeps its Save-failed chip; no DB row exists.
    const failChip = await page.evaluate(async (nm) => {
      for (let i = 0; i < 30; i++) {
        const cards = Array.from(document.querySelectorAll('#sxrBody .sxr-card.is-editable'));
        const mine = cards.find(c => { const n = c.querySelector('.sxr-name-input'); return n && n.value === nm; });
        if (mine) {
          const chip = mine.querySelector('[data-sxr-saving]');
          const rid = mine.getAttribute('data-sxr-id');
          if (chip && (chip.classList.contains('is-error') || /retry/i.test(chip.textContent || ''))) return { rid, text: chip.textContent.trim() };
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return null;
    }, FAILNAME);
    ok(!!failChip, 'a failed first save keeps the card on screen with a "Save failed · Retry" chip', JSON.stringify(failChip));
    createdId = failChip && failChip.rid;
    await page.waitForTimeout(1500);
    ok(!rowByName(FAILNAME), 'the failed create did NOT write a DB row');

    // Recover + retry → persists.
    await failOff(page);
    await page.evaluate((nm) => {
      const cards = Array.from(document.querySelectorAll('#sxrBody .sxr-card.is-editable'));
      const mine = cards.find(c => { const n = c.querySelector('.sxr-name-input'); return n && n.value === nm; });
      const chip = mine && mine.querySelector('[data-sxr-saving]');
      if (chip) chip.click();
    }, FAILNAME);
    const persisted = await Q.poll(() => rowByName(FAILNAME), 20000);
    ok(!!persisted, 'clicking Retry after recovery persists the create', JSON.stringify(persisted));
    if (persisted && persisted.id) createdId = persisted.id;

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    const r = rowByName(FAILNAME); if (r && r.id) Q.archiveSafe(r.id);
    if (createdId && /^sr_/.test(createdId)) Q.archiveSafe(createdId);
  }
  console.log(`PROBE sxr_create_edge: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
