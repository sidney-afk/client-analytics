// sxr_cold_open.js — the COLD-OPEN create journey, rebuilt for the post-rebuild
// FE (the original sxr_cold_open_journey was deleted with the old FE). Seeds
// NOTHING: open the tab as a human, click Add, type into the real inputs,
// save, comment, archive — proving the feature is usable from zero (the exact
// blind spot that once shipped a Samples tab with no Add button).
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, smm, supa, archiveSafe, appErrs } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function typeField(page, pid, fld, text) {
  return page.evaluate((args) => {
    const [pid, fld, text] = args;
    const el = document.querySelector(`.cal-card[data-pid="${pid}"] [data-fld="${fld}"]`);
    if (!el) return 'no-field';
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
    set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }));
    if (typeof _sxrOnFieldBlur === 'function') _sxrOnFieldBlur(el);
    return 'ok';
  }, [pid, fld, text]);
}

(async () => {
  const browser = await launch();
  const name = 'ColdOpen ' + Date.now();
  let realId = null;
  try {
    const page = await smm(browser);
    await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); });
    await sleep(1500);

    // 1. Add — a blank card appears and focuses its name field
    const before = await page.evaluate(() => document.querySelectorAll('#sxrStrip .cal-card').length);
    const addClicked = await page.evaluate(() => { const b = document.querySelector('.cal-card-add'); if (!b) return 'no-add-btn'; b.click(); return 'ok'; });
    t(addClicked === 'ok', 'Add button exists and was clicked', addClicked);
    await sleep(800);
    const blankPid = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#sxrStrip .cal-card')];
      const last = cards[cards.length - 1];
      return last ? last.dataset.pid : null;
    });
    const after = await page.evaluate(() => document.querySelectorAll('#sxrStrip .cal-card').length);
    t(after === before + 1 && !!blankPid, 'blank card rendered', `pid=${blankPid}`);

    // 2. Type a name → blur promotes the blank to a REAL persisted row
    t((await typeField(page, blankPid, 'name', name)) === 'ok', 'typed name into the real input');
    let row = null;
    for (let i = 0; i < 25 && !row; i++) { const r = supa(`client=eq.sidneylaruel&name=eq.${encodeURIComponent(name)}&select=id,name,status`); row = (Array.isArray(r) && r[0]) || null; if (!row) await sleep(1000); }
    t(!!row, 'row persisted to DB after name blur (blank promoted)', row && row.id);
    realId = row && row.id;
    if (realId) {
      const promoted = await page.evaluate((rid) => !!document.querySelector(`.cal-card[data-pid="${rid}"]`), realId);
      t(promoted, 'card re-keyed to the real id in the DOM');
    }

    // 3. Paste an asset URL → persists on blur
    if (realId) {
      t((await typeField(page, realId, 'asset_url', 'https://frame.io/x/coldopen')) === 'ok', 'typed asset url');
      let saved = false;
      for (let i = 0; i < 20 && !saved; i++) { const r = supa(`id=eq.${realId}&select=asset_url`); saved = !!r[0] && /coldopen/.test(r[0].asset_url || ''); if (!saved) await sleep(1000); }
      t(saved, 'asset_url persisted on blur');
    }

    // 4. Add a note through the Notes modal
    if (realId) {
      await page.evaluate((cid) => { const card = document.querySelector(`.cal-card[data-pid="${cid}"]`); const b = card && card.querySelector('.cal-comments-btn, .cal-card-notes'); if (b) b.click(); }, realId);
      const opened = await page.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 8000 }).then(() => true).catch(() => false);
      t(opened, 'notes modal opens on the fresh card');
      if (opened) {
        await page.evaluate(() => {
          const ta = document.getElementById('sxrCommentComposer');
          const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          set.call(ta, 'cold-open note'); ta.dispatchEvent(new Event('input', { bubbles: true }));
          const send = document.querySelector('#sxrCommentsOverlay .cal-cm-send'); if (send && !send.disabled) send.click();
        });
        let noted = false;
        for (let i = 0; i < 15 && !noted; i++) { const r = supa(`id=eq.${realId}&select=video_tweaks`); noted = !!r[0] && /cold-open note/.test(r[0].video_tweaks || ''); if (!noted) await sleep(1000); }
        t(noted, 'note persisted');
        await page.evaluate(() => { if (typeof closeSxrComments === 'function') closeSxrComments(); });
        await sleep(400);
      }
    }

    // 5. Archive via the card X → confirm → gone + Archived + no resurrect
    if (realId) {
      const del = await page.evaluate((cid) => { const card = document.querySelector(`.cal-card[data-pid="${cid}"]`); const b = card && card.querySelector('.cal-card-del'); if (!b) return 'no-del'; b.click(); return 'ok'; }, realId);
      t(del === 'ok', 'archive (X) clicked');
      await page.waitForFunction(() => { const ov = document.getElementById('confirmOverlay'); return ov && ov.classList.contains('active'); }, { timeout: 6000 }).catch(() => {});
      await page.evaluate(() => { const b = document.querySelector('#confirmOverlay .brief-action-btn.primary'); if (b) b.click(); });
      let archived = false;
      for (let i = 0; i < 20 && !archived; i++) { const r = supa(`id=eq.${realId}&select=status`); archived = !!r[0] && r[0].status === 'Archived'; if (!archived) await sleep(1000); }
      t(archived, 'row Archived in DB');
      // no-resurrect: hard reload, card must not come back
      await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
      await sleep(2500);
      const back = await page.evaluate((cid) => !!document.querySelector(`.cal-card[data-pid="${cid}"]`), realId);
      t(!back, 'archived card does not resurrect after a fresh load');
    }

    const errs = appErrs(page) || [];
    t(errs.length === 0, '0 app JS errors across the journey', errs[0] || '');
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    if (realId) { try { archiveSafe(realId); } catch {} }
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
