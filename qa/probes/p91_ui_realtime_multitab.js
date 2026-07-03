// p91_ui_realtime_multitab.js — UI-born row + realtime-style multi-tab merge.
//
// A row born through the real SXR Sheet UI must be adopted by another already-open
// SMM tab when the realtime handler fires. Then a remote edit to that same row
// must merge into the creator tab without duplicating the card or resurrecting a
// __sxrblank__ local ghost.
//
// Run with a static server on :8000:
//   SXR_COURIER=0 node qa/probes/p91_ui_realtime_multitab.js
const L = require('../sxr_courier_lib.js');

const results = [];
const ok = (cond, msg, extra) => {
  results.push({ pass: !!cond, msg, extra: extra || '' });
  console.log((cond ? 'PASS ' : 'FAIL ') + msg + (extra ? '  [' + extra + ']' : ''));
};
const sleep = (p, ms) => p.waitForTimeout(ms);

function liveByName(name) {
  return L.supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(name) + '&or=(status.neq.Archived,status.is.null)&select=id,name,status') || [];
}

async function createUiCard(page, name) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await sleep(page, 1700);
  const clicked = await page.evaluate(() => { const add = document.querySelector('#sxrStrip .cal-card-add'); if (!add) return 'no-add'; add.click(); return 'ok'; });
  if (clicked !== 'ok') return clicked;
  await sleep(page, 400);
  return page.evaluate((nm) => {
    const blanks = [...document.querySelectorAll('#sxrStrip .cal-card[data-pid^="__sxrblank__"]')];
    const card = blanks[blanks.length - 1];
    if (!card) return 'no-blank';
    const inp = card.querySelector('.cal-fld-name');
    if (!inp) return 'no-name';
    inp.focus(); inp.value = nm; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur();
    return 'ok';
  }, name);
}

async function fireRealtime(page) {
  await page.evaluate(() => { try { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(sxrClientSlug(sxrState.client)); } catch (e) {} });
}

async function readCardState(page, id, name) {
  return page.evaluate((a) => {
    const strip = document.getElementById('sxrStrip');
    const cards = strip ? [...strip.querySelectorAll('.cal-card[data-pid]')].map(c => {
      const pid = c.getAttribute('data-pid') || '';
      const inp = c.querySelector('.cal-fld-name');
      return { pid, name: inp ? inp.value : '' };
    }) : [];
    const state = (typeof sxrState !== 'undefined' && sxrState && Array.isArray(sxrState.posts))
      ? sxrState.posts.map(p => ({ id: p && p.id, name: p && p.name })) : [];
    return {
      domById: cards.filter(c => c.pid === a.id).length,
      domByName: cards.filter(c => c.name === a.name).length,
      stateById: state.filter(p => p.id === a.id).length,
      stateByName: state.filter(p => p.name === a.name).length,
      blanksWithName: cards.filter(c => String(c.pid).startsWith('__sxrblank__') && c.name === a.name).length,
      allNamesForId: cards.filter(c => c.pid === a.id).map(c => c.name),
    };
  }, { id, name });
}

(async () => {
  const browser = await L.launch();
  const base = 'P91 UI RT ' + Date.now();
  const renamed = base + ' remote';
  let creator, observer, id = '';
  try {
    observer = await L.smm(browser);
    await observer.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
    await sleep(observer, 1800);
    ok((await liveByName(base)).length === 0, 'setup: unique test name has no live row');

    creator = await L.smm(browser);
    const created = await createUiCard(creator, base);
    ok(created === 'ok', 'creator tab creates card through real UI', created);

    const row = await L.poll(() => { const rows = liveByName(base); return rows.length === 1 ? rows[0] : null; }, 20000, 700);
    id = row && row.id || '';
    ok(!!id, 'DB: exactly one UI-born row appears', id || 'none');

    await fireRealtime(observer);
    await observer.waitForFunction((a) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${a}"]`), id, { timeout: 16000 }).catch(() => {});
    const obs = await readCardState(observer, id, base);
    ok(obs.domById === 1 && obs.domByName === 1 && obs.stateById === 1 && obs.stateByName === 1 && obs.blanksWithName === 0,
      'observer tab adopts UI-born row via realtime handler exactly once', JSON.stringify(obs));

    L.up({ id, name: renamed });
    await L.poll(() => { const rows = liveByName(renamed); return rows.length === 1 ? rows[0] : null; }, 16000, 700);
    await fireRealtime(creator);
    await creator.waitForFunction((a) => {
      const c = document.querySelector(`#sxrStrip .cal-card[data-pid="${a.id}"]`);
      const inp = c && c.querySelector('.cal-fld-name');
      return inp && inp.value === a.name;
    }, { id, name: renamed }, { timeout: 16000 }).catch(() => {});
    const cr = await readCardState(creator, id, renamed);
    ok(cr.domById === 1 && cr.domByName === 1 && cr.stateById === 1 && cr.stateByName === 1 && cr.blanksWithName === 0,
      'creator tab merges remote edit to same UI-born row without duplicate/blank', JSON.stringify(cr));

    const oldRows = liveByName(base);
    ok(oldRows.length === 0, 'old name has no live duplicate row after remote rename', 'rows=' + oldRows.length);

    const errs = [...(creator ? L.appErrs(creator) : []), ...(observer ? L.appErrs(observer) : [])];
    ok(errs.length === 0, '0 app JS errors', JSON.stringify(errs.slice(0, 3)));
  } catch (e) {
    ok(false, 'probe threw', e && e.stack || String(e));
  } finally {
    try { await browser.close(); } catch {}
    if (id) { try { L.archiveSafe(id); } catch {} }
  }
  const fail = results.filter(r => !r.pass).length;
  console.log(`pass=${results.length - fail} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
