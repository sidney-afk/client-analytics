// Phase 1e — realtime STATUS-PILL propagation across a second view.
// The Supabase realtime WebSocket cannot be tunneled in this sandbox (the app's
// subscription TIMES_OUT), so we drive the app's OWN realtime handler
// (_calV2OnRealtimeChange) in the observer view — the identical REST-refetch +
// re-render path a real push triggers — and assert the observer's status PILL
// (data-val), not just the row, flips live WITHOUT a manual reload.
// A disposable card carries the change (caption_status → no Linear noise). Archived at end.
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const OUT = '/tmp/qa-efwp/results-realtime.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pill = (page, pid, comp) => page.evaluate((a) => {
  const w = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${a.pid}"][data-substatus-comp="${a.comp}"]`);
  return w ? w.getAttribute('data-val') : null;
}, { pid, comp });

(async () => {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('realtime');
  const results = {};
  L.setLinearForwardAllow([]);
  let newId = null;
  try {
    // View A (actor) — create a disposable card.
    const A = await L.smmCal(browser);
    const uniq = 'EFWP-RT-' + Date.now();
    await A.page.evaluate((a) => {
      addCalBlankCard();
      const card = document.querySelector('.cal-card[data-pid^="__blank__"]'); if (!card) return;
      const setVal = (el, v) => { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const nameEl = card.querySelector('.cal-fld-name'); if (nameEl) { setVal(nameEl, a.name); _calOnFieldBlur(nameEl); }
    }, { name: uniq });
    let created = null;
    for (let i = 0; i < 25 && !created; i++) { const r = L.supaCal(`client=eq.sidneylaruel&name=eq.${encodeURIComponent(uniq)}&select=id,caption_status`); if (Array.isArray(r) && r[0]) created = r[0]; else await sleep(800); }
    newId = created && created.id;
    s.ok(!!newId, 'disposable card created', 'id=' + newId);
    // make its caption_status a known starting value
    await A.page.evaluate((a) => { _calStatusPick(a.id, 'In Progress', 'caption'); }, { id: newId });
    await L.pollCal(newId, r => r.caption_status === 'In Progress', 'caption_status', 15000);

    // View B (observer) — opens with the card present.
    const B = await L.smmCal(browser);
    const pillB0 = await pill(B.page, newId, 'caption');
    results.observerBaselinePill = pillB0;
    s.ok(pillB0 === 'In Progress', 'observer pill baseline = In Progress', pillB0);

    // Actor flips caption_status → Approved.
    const t0 = Date.now();
    await A.page.evaluate((a) => { _calStatusPick(a.id, 'Approved', 'caption'); }, { id: newId });
    await L.pollCal(newId, r => r.caption_status === 'Approved', 'caption_status', 15000);

    // Observer receives the realtime ping the app's own way; then the pill must
    // move WITHOUT us calling loadCalendarPosts.
    await B.page.evaluate((slug) => { if (typeof _calV2OnRealtimeChange === 'function') _calV2OnRealtimeChange(slug); }, 'sidneylaruel');
    let moved = false, pillNow = pillB0;
    for (let i = 0; i < 14; i++) { pillNow = await pill(B.page, newId, 'caption'); if (pillNow === 'Approved') { moved = true; break; } await sleep(1000); }
    const readsB = B.rec.since(t0).filter(r => r.kind === 'supabase-rest' && /calendar_posts/.test(r.url)).length;
    results.live = { pillNow, moved, observerRefetches: readsB };
    console.log('observer pill after realtime handler:', pillNow, '| observer refetched calendar_posts x', readsB);
    s.ok(readsB >= 1, 'realtime handler triggered an observer REST refetch (no manual reload)', 'reads=' + readsB);
    s.ok(moved, 'observer STATUS PILL flipped to Approved LIVE (no manual reload)', 'pill=' + pillNow);

    const errsA = L.appErrs(A.page), errsB = L.appErrs(B.page);
    s.ok(errsA.length === 0 && errsB.length === 0, 'zero app JS errors in both views', (errsA.concat(errsB)).slice(0, 3).join(' | '));
  } catch (e) { console.error('EXCEPTION:', e && e.stack || e); s.fail++; }
  finally {
    if (newId) { try { L.calUpN8n({ id: newId, status: 'Archived' }); } catch (e) {} }
    results.pass = s.pass; results.fail = s.fail;
    try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); } catch (e) {}
    await browser.close(); server.close();
    console.log(`\nREALTIME: ${s.pass} pass / ${s.fail} fail  → ${OUT}`);
    process.exit(s.fail ? 1 : 0);
  }
})();
