// Phase 1 — calendar write interactions (non-status) via the real SMM UI handlers.
//   A add card (EF insert)      -> addCalBlankCard + real save flush
//   B caption edit (EF update)  -> _calPendingEdits + _calFlushCardSave (the blur path)
//   C caption_status/title_status NO-LEAK on a LINKED card (TEST 3): EF write, ZERO Linear
//   D reorder (calendar-reorder EF) -> persistCalReorder
//   E persist across a hard reload
//   F archive/remove (EF)       -> archiveCalPost
// Proves each hits …/functions/v1/calendar-upsert|calendar-reorder (never n8n), writes the
// right column, and that caption/title changes fire NO Linear push. Disposable card is a
// fresh unique-named row (archived at the end); TEST 3 status flips are reverted.
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const TEST3 = 'p_mqjzobk2_xnw24';
const OUT = '/tmp/qa-efwp/results-calwrites.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('cal-writes');
  const results = { steps: {} };
  // Never forward Linear here; we only assert NO push fires for caption/title.
  L.setLinearForwardAllow([]);
  let uniq, newId;
  try {
    const { page, rec } = await L.smmCal(browser);
    uniq = 'EFWP-' + Date.now();

    // ---- A: add card (EF insert) via the REAL blank-card UI (addCalBlankCard
    // inserts a blank card into the DOM strip; typing name+caption + blur promotes
    // it to a real row through _calOnFieldBlur/_calOnCaptionBlur → EF insert). ----
    let t0 = Date.now();
    const addInfo = await page.evaluate((a) => {
      addCalBlankCard();
      const card = document.querySelector('.cal-card[data-pid^="__blank__"]');
      if (!card) return { err: 'no blank card' };
      const pid = card.getAttribute('data-pid');
      const setVal = (el, v) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const set = Object.getOwnPropertyDescriptor(proto, 'value').set; set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const nameEl = card.querySelector('.cal-fld-name');
      const capEl = card.querySelector('textarea.cal-fld-cap, .cal-fld-cap');
      if (nameEl) { setVal(nameEl, a.name); if (typeof _calOnFieldBlur === 'function') _calOnFieldBlur(nameEl); }
      if (capEl) { setVal(capEl, a.cap); if (typeof _calOnCaptionBlur === 'function') _calOnCaptionBlur(capEl); else if (typeof _calOnFieldBlur === 'function') _calOnFieldBlur(capEl); }
      return { pid, hasName: !!nameEl, hasCap: !!capEl };
    }, { name: uniq, cap: 'efwp caption A' });
    console.log('add:', JSON.stringify(addInfo));
    // read back by unique name (blank id is promoted to a real id on save)
    let created = null;
    for (let i = 0; i < 25 && !created; i++) { const r = L.supaCal(`client=eq.sidneylaruel&name=eq.${encodeURIComponent(uniq)}&select=id,name,caption,status,updated_at`); if (Array.isArray(r) && r[0]) created = r[0]; else await sleep(800); }
    newId = created && created.id;
    let kinds = rec.writesSince(t0).map(w => w.kind);
    results.steps.add = { newId, created, kinds };
    s.ok(!!created, 'A: new card row created in Supabase', 'id=' + newId);
    s.ok(created && created.name === uniq, 'A: card name persisted on insert', created && created.name);
    s.ok(kinds.includes('cal-ef'), 'A: insert routed to calendar-upsert EF', JSON.stringify(kinds));
    s.ok(!kinds.includes('cal-n8n'), 'A: NO n8n calendar-upsert-post on insert');
    s.ok(rec.linearSince(t0).length === 0, 'A: no Linear push on plain add');

    // ---- B: caption edit (EF update) ----
    t0 = Date.now();
    await page.evaluate((a) => {
      const p = calState.posts.find(x => x.id === a.id) || calState.posts.find(x => x.name === a.name); if (!p) return;
      const id = p.id;
      if (!_calPendingEdits[id]) _calPendingEdits[id] = {};
      _calPendingEdits[id].caption = a.cap; p.caption = a.cap;
      _calFlushCardSave(id);
    }, { id: newId, name: uniq, cap: 'efwp caption B edited' });
    const rowB = await L.pollCal(newId, r => r.caption === 'efwp caption B edited', 'caption,updated_at', 15000);
    kinds = rec.writesSince(t0).map(w => w.kind);
    results.steps.caption = { caption: rowB.caption, kinds };
    s.ok(rowB.caption === 'efwp caption B edited', 'B: caption edit persisted', rowB.caption);
    s.ok(kinds.includes('cal-ef') && !kinds.includes('cal-n8n'), 'B: caption edit routed to EF only', JSON.stringify(kinds));
    s.ok(rec.linearSince(t0).length === 0, 'B: no Linear push on caption edit');

    // ---- C: caption_status + title_status NO-LEAK on linked TEST 3 ----
    const base3 = L.calRow(TEST3, 'caption_status,title_status,status');
    for (const [comp, to] of [['caption', 'Approved'], ['title', 'Client Approval']]) {
      t0 = Date.now();
      const cur = base3[comp + '_status'];
      const flipTo = (cur === to) ? 'In Progress' : to;
      await page.evaluate((a) => { _calStatusPick(a.pid, a.status, a.comp); }, { pid: TEST3, status: flipTo, comp });
      const r3 = await L.pollCal(TEST3, r => r[comp + '_status'] === flipTo, comp + '_status', 15000);
      await sleep(3500);
      const linear = rec.linearSince(t0);
      kinds = rec.writesSince(t0).map(w => w.kind);
      results.steps['status_' + comp] = { flipTo, got: r3[comp + '_status'], kinds, linearCount: linear.length };
      s.ok(r3[comp + '_status'] === flipTo, `C: TEST3 ${comp}_status = ${flipTo}`, r3[comp + '_status']);
      s.ok(kinds.includes('cal-ef') && !kinds.includes('cal-n8n'), `C: ${comp}_status routed to EF only`, JSON.stringify(kinds));
      s.ok(linear.length === 0, `C: ${comp}_status fired ZERO Linear pushes (no leak)`, 'count=' + linear.length);
      // revert
      await page.evaluate((a) => { _calStatusPick(a.pid, a.status, a.comp); }, { pid: TEST3, status: cur, comp });
      await L.pollCal(TEST3, r => r[comp + '_status'] === cur, comp + '_status', 15000);
    }

    // ---- D: reorder (calendar-reorder EF) — single item (our disposable card) ----
    t0 = Date.now();
    const curOrder = Number(created.order_index || (L.calRow(newId, 'order_index').order_index) || 0);
    const newOrder = curOrder + 7;
    await page.evaluate((a) => { persistCalReorder([{ id: a.id, order_index: a.ord }], null, 'sidneylaruel'); }, { id: newId, ord: newOrder });
    const rowD = await L.pollCal(newId, r => Number(r.order_index) === newOrder, 'order_index,updated_at', 15000);
    kinds = rec.writesSince(t0).map(w => w.kind);
    results.steps.reorder = { newOrder, got: rowD.order_index, kinds };
    s.ok(Number(rowD.order_index) === newOrder, 'D: order_index updated', rowD.order_index);
    s.ok(kinds.includes('cal-reorder-ef') && !kinds.includes('cal-reorder-n8n'), 'D: reorder routed to calendar-reorder EF only', JSON.stringify(kinds));

    // ---- E: persist across hard reload ----
    const h2 = await L.smmCal(browser);
    const persisted = await h2.page.evaluate((a) => {
      const p = (calState.posts || []).find(x => x.name === a.name);
      return p ? { id: p.id, caption: p.caption } : null;
    }, { name: uniq });
    results.steps.persist = persisted;
    s.ok(persisted && persisted.caption === 'efwp caption B edited', 'E: card + caption survive a hard reload', JSON.stringify(persisted));

    // ---- F: archive/remove (EF) via the real confirm-modal UI ----
    t0 = Date.now();
    await page.evaluate((a) => { archiveCalPost(a.id); }, { id: newId });
    await page.waitForSelector('#confirmOverlay.active', { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { const b = document.getElementById('confirmYes'); if (b) b.click(); });
    const rowF = await L.pollCal(newId, r => r.status === 'Archived', 'status,updated_at', 15000);
    kinds = rec.writesSince(t0).map(w => w.kind);
    results.steps.archive = { status: rowF.status, kinds };
    s.ok(rowF.status === 'Archived', 'F: card archived in Supabase', rowF.status);
    s.ok(kinds.includes('cal-ef') && !kinds.includes('cal-n8n'), 'F: archive routed to EF only', JSON.stringify(kinds));

    // TEST 3 restored?
    const fin3 = L.calRow(TEST3, 'caption_status,title_status');
    s.ok(fin3.caption_status === base3.caption_status && fin3.title_status === base3.title_status, 'TEST3 caption/title status restored');

    const errs = L.appErrs(page);
    s.ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
    if (rec.log.length) console.log('courier log:', rec.log.join('\n '));
  } catch (e) {
    console.error('EXCEPTION:', e && e.stack || e); s.fail++;
  } finally {
    // safety: ensure the disposable card is archived even on failure
    if (newId) { try { L.calUpN8n({ id: newId, status: 'Archived' }); } catch (e) {} }
    results.pass = s.pass; results.fail = s.fail;
    try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); } catch (e) {}
    await browser.close(); server.close();
    console.log(`\nCAL-WRITES: ${s.pass} pass / ${s.fail} fail  → ${OUT}`);
    process.exit(s.fail ? 1 : 0);
  }
})();
