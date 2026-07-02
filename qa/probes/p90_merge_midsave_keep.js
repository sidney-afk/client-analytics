// p90_merge_midsave_keep.js — the _sxrMergeServerRows local-only KEEP branch
// (~index.html:28039), pinned DETERMINISTICALLY. The create_during_remote_merge
// scenario drives the same funnel with natural timing, but the save usually
// settles before the merge lands; here the sample-review-upsert POST is delayed
// 8s in-page so a background merge arrives strictly MID-SAVE. Verified red/green
// 2026-07-02: with the keep branch disabled the newborn card vanishes from
// sxrState.posts at merge time and the settled save strands an orphan DB row.
// Asserts:
//   1. mid-merge (save in flight): the newborn card is STILL in sxrState.posts
//   2. after settle: exactly one state entry + one DOM card, under the real id
//   3. after settle: exactly one live DB row (no loss, no twin)
//   4. 0 app JS errors
const L = require('../sxr_courier_lib.js');
let pass = 0, fail = 0;
const note = (ok, msg, extra) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}${extra ? '  [' + extra + ']' : ''}`); ok ? pass++ : fail++; };

(async () => {
  const browser = await L.launch();
  const page = await L.smm(browser);
  const NAME = 'P90 Merge Keep ' + Date.now();
  const minted = new Set();
  try {
    await page.evaluate(() => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).includes('sample-review-upsert')) {
          return new Promise(res => setTimeout(() => res(orig.apply(this, arguments)), 8000));
        }
        return orig.apply(this, arguments);
      };
    });
    await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
    await page.waitForFunction(() => !!document.querySelector('#sxrStrip .cal-card-add'), { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const created = await page.evaluate((nm) => {
      const add = document.querySelector('#sxrStrip .cal-card-add');
      if (!add) return 'no-add-btn';
      add.click();
      return 'ok';
    }, NAME);
    note(created === 'ok', 'click "+"', created);
    await page.waitForTimeout(400);
    const typed = await page.evaluate((nm) => {
      const blanks = [...document.querySelectorAll('#sxrStrip .cal-card[data-pid^="__sxrblank__"]')];
      const card = blanks[blanks.length - 1];
      if (!card) return 'no-blank-card';
      const inp = card.querySelector('.cal-fld-name');
      inp.focus(); inp.value = nm;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.blur();
      return 'ok';
    }, NAME);
    note(typed === 'ok', 'type + blur (save now held in flight 8s)', typed);

    await page.waitForTimeout(2000);
    const inflight = await page.evaluate(() => Object.keys(_sxrSaveInFlight || {}).length);
    note(inflight > 0, 'save is in flight at merge time', 'inflight=' + inflight);
    await page.evaluate(() => loadSxrCards({ background: true, skipCache: true }));
    await page.waitForTimeout(3000);
    const mid = await page.evaluate((nm) => (sxrState.posts || []).filter(p => String(p.name || '') === nm).length, NAME);
    note(mid === 1, 'MID-MERGE: newborn card kept in sxrState.posts (the keep branch)', 'entries=' + mid);

    await page.waitForTimeout(9000);   // save settles
    const end = await page.evaluate((nm) => {
      const state = (sxrState.posts || []).filter(p => String(p.name || '') === nm).map(p => p.id);
      const dom = [...document.querySelectorAll('#sxrStrip .cal-card[data-pid]')].filter(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === nm; }).map(c => c.getAttribute('data-pid'));
      return { state, dom };
    }, NAME);
    end.state.forEach(x => { if (!String(x).startsWith('__sxrblank__')) minted.add(x); });
    const okState = end.state.length === 1 && !String(end.state[0]).startsWith('__sxrblank__');
    const okDom = end.dom.length === 1 && end.dom[0] === end.state[0];
    note(okState && okDom, 'after settle: one state entry + one DOM card under the real id', JSON.stringify(end));

    let rows = [];
    try { rows = L.supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(NAME) + '&or=(status.neq.Archived,status.is.null)&select=id') || []; } catch {}
    rows.forEach(r => minted.add(r.id));
    note(Array.isArray(rows) && rows.length === 1, 'after settle: exactly one live DB row', 'rows=' + (Array.isArray(rows) ? rows.length : 'err'));

    const errs = L.appErrs(page) || [];
    note(errs.length === 0, '0 app JS errors', errs.slice(0, 3).join(' | ').slice(0, 200));
  } catch (e) {
    note(false, 'EXCEPTION: ' + (e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    for (const id of minted) { try { L.archiveSafe(id); } catch {} }
  }
  console.log(`pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('RUNNER ERROR', e && e.stack || e); process.exit(2); });
