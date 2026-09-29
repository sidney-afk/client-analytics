// Phase 3 — fail-safe fork. Asserts the REAL in-page routing functions: the EF url
// for a flagged client across calendar-upsert, sample-review-upsert and settings,
// and the n8n url still chosen for sample-review and settings (PR 4 and PR 3 move
// those). CALENDAR changed in n8n exit PR 2: the calendar reorder router is gone,
// and a staff Calendar save no longer falls back to n8n. Then a LIVE observation on
// the test client: with the flag READ answered as "does not list this client" (only
// the browser's read is answered locally, the live flag is never edited) a real
// caption edit is REFUSED and sends NOTHING, neither to the EF nor to n8n; with the
// read answered 500 it is HELD the same way; with the real answer it saves again.
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const OUT = '/tmp/qa-efwp/results-failsafe.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('failsafe');
  const results = {};
  let newId = null;
  try {
    const { page, rec } = await L.smmCal(browser);

    // ---- UNIT: routing functions, flagged vs unflagged vs empty-flag ----
    const unit = await page.evaluate((U) => {
      const out = {};
      const flagged = 'sidneylaruel', un = '__unflagged_test_slug__';
      out.cal_flagged = { useEf: _calUpsertUseEf(flagged), url: _calUpsertUrlForClient(flagged) };
      out.cal_unflagged = { useEf: _calUpsertUseEf(un), url: _calUpsertUrlForClient(un) };
      out.reorder_router_removed = typeof _calReorderUrlForClient === 'undefined' && typeof _calAssertSavingOn === 'function';
      out.sxr_flagged = { useEf: _sxrSampleUseEf(flagged), url: _sxrUpsertUrlForClient(flagged) };
      out.sxr_unflagged = { useEf: _sxrSampleUseEf(un), url: _sxrUpsertUrlForClient(un) };
      out.settings_guard = typeof _settingsAssertSavingOn === 'function' && typeof _settingsWriteUrlForClient === 'undefined' && typeof _settingsUseEf === 'undefined';
      // empty-flag: flagged client must fall back to n8n when the flag set is empty
      const orig = _calUpsertEfClients;
      try { _calUpsertEfClients = new Set(); out.cal_emptyflag = { useEf: _calUpsertUseEf(flagged), url: _calUpsertUrlForClient(flagged) }; }
      finally { _calUpsertEfClients = orig; }
      const origS = _sxrSampleEfClients;
      try { _sxrSampleEfClients = new Set(); out.sxr_emptyflag = { useEf: _sxrSampleUseEf(flagged), url: _sxrUpsertUrlForClient(flagged) }; }
      finally { _sxrSampleEfClients = origS; }
      return out;
    });
    results.unit = unit;
    console.log('UNIT:', JSON.stringify(unit, null, 1));
    s.ok(unit.cal_flagged.useEf === true && unit.cal_flagged.url === L.CAL_EF, 'flagged → calendar-upsert EF', unit.cal_flagged.url);
    s.ok(unit.cal_unflagged.useEf === false && unit.cal_unflagged.url === L.CAL_N8N, 'unflagged → calendar-upsert n8n', unit.cal_unflagged.url);
    s.ok(unit.cal_emptyflag.useEf === false && unit.cal_emptyflag.url === L.CAL_N8N, 'empty flag → calendar-upsert n8n (fail-safe)', unit.cal_emptyflag.url);
    s.ok(unit.reorder_router_removed === true, 'calendar-reorder has no n8n router any more; the shared fresh flag check is present');
    s.ok(unit.sxr_flagged.useEf === true && unit.sxr_flagged.url === L.SXR_EF, 'flagged → sample-review-upsert EF', unit.sxr_flagged.url);
    s.ok(unit.sxr_unflagged.useEf === false && unit.sxr_unflagged.url === L.SXR_N8N, 'unflagged → sample-review-upsert n8n', unit.sxr_unflagged.url);
    s.ok(unit.sxr_emptyflag.useEf === false, 'empty flag → sample-review-upsert n8n (fail-safe)');
    s.ok(unit.settings_guard === true, 'caption prompt save has no n8n router any more; the shared fresh settings-flag check is present (n8n exit PR 3)');

    // ---- LIVE: unflagged path routes to n8n (test client, flag cleared, write blocked) ----
    // create a disposable card first (flag ON → EF insert)
    const uniq = 'EFWP-FS-' + Date.now();
    let t0 = Date.now();
    await page.evaluate((a) => {
      addCalBlankCard();
      const card = document.querySelector('.cal-card[data-pid^="__blank__"]'); if (!card) return;
      const setVal = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const nameEl = card.querySelector('.cal-fld-name'); if (nameEl) { setVal(nameEl, a.name); _calOnFieldBlur(nameEl); }
    }, { name: uniq });
    let created = null;
    for (let i = 0; i < 25 && !created; i++) { const r = L.supaCal(`client=eq.sidneylaruel&name=eq.${encodeURIComponent(uniq)}&select=id`); if (Array.isArray(r) && r[0]) created = r[0]; else await sleep(800); }
    newId = created && created.id;
    s.ok(!!newId, 'live: disposable card created (EF)', 'id=' + newId);
    const baseKinds = rec.writesSince(t0).map(w => w.kind);
    s.ok(baseKinds.includes('cal-ef') && !baseKinds.includes('cal-n8n'), 'live: create routed to EF while flagged', JSON.stringify(baseKinds));

    // Answer ONLY the browser's own flag read locally (the live flag row is never
    // edited): first "the flag does not list this client", then "the read fails".
    L.setBlockN8nWrites(true);
    const FLAG_URL = '**/rest/v1/syncview_runtime_flags?*key=eq.calendar_upsert_ef_clients*';
    const editCaption = async (text) => {
      const t = Date.now();
      await page.evaluate((a) => {
        const p = calState.posts.find(x => x.name === a.name) || calState.posts.find(x => x.id === a.id); if (!p) return;
        const id = p.id; if (!_calPendingEdits[id]) _calPendingEdits[id] = {};
        _calPendingEdits[id].caption = a.text; p.caption = a.text;
        _calFlushCardSave(id);
      }, { name: uniq, id: newId, text });
      await sleep(6000);
      return rec.writesSince(t).map(w => w.kind);
    };
    await page.route(FLAG_URL, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ value: { clients: ['__nobody__'] } }]) }));
    const pausedKinds = await editCaption('failsafe paused');
    results.live = { create: baseKinds, paused: pausedKinds };
    console.log('live paused edit kinds:', JSON.stringify(pausedKinds));
    s.ok(!pausedKinds.includes('cal-n8n') && !pausedKinds.includes('cal-ef'), 'live: flag read says the client is not listed → the save is refused, NOTHING sent (no n8n, no EF)', JSON.stringify(pausedKinds));
    await page.unroute(FLAG_URL);
    await page.route(FLAG_URL, route => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"probe"}' }));
    const heldKinds = await editCaption('failsafe held');
    results.live.held = heldKinds;
    s.ok(!heldKinds.includes('cal-n8n') && !heldKinds.includes('cal-ef'), 'live: flag read fails → the save is HELD, nothing sent (no n8n, no EF)', JSON.stringify(heldKinds));
    await page.unroute(FLAG_URL);
    const okKinds = await editCaption('failsafe restored');
    results.live.restored = okKinds;
    s.ok(okKinds.includes('cal-ef') && !okKinds.includes('cal-n8n'), 'live: with the real flag answer the same edit saves through the EF, never n8n', JSON.stringify(okKinds));
    L.setBlockN8nWrites(false);

    const errs = L.appErrs(page);
    s.ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } catch (e) { console.error('EXCEPTION:', e && e.stack || e); s.fail++; }
  finally {
    if (newId) { try { L.calUpN8n({ id: newId, status: 'Archived' }); } catch (e) {} }
    results.pass = s.pass; results.fail = s.fail;
    try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); } catch (e) {}
    await browser.close(); server.close();
    console.log(`\nFAILSAFE: ${s.pass} pass / ${s.fail} fail  → ${OUT}`);
    process.exit(s.fail ? 1 : 0);
  }
})();
