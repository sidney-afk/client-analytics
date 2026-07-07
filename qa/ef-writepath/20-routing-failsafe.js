// Phase 3 — fail-safe fork. Asserts the REAL in-page routing functions return the
// EF url for a flagged client and the n8n url for an unflagged/empty-flag client,
// across calendar-upsert, calendar-reorder, sample-review-upsert, settings. Then a
// LIVE observation: with sidneylaruel temporarily removed from the in-memory flag,
// a real caption edit routes to the n8n webhook (captured), NOT the EF. The n8n
// write is blocked (mocked) so nothing lands; the flag is restored afterwards.
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
      out.reorder_flagged = _calReorderUrlForClient(flagged);
      out.reorder_unflagged = _calReorderUrlForClient(un);
      out.sxr_flagged = { useEf: _sxrSampleUseEf(flagged), url: _sxrUpsertUrlForClient(flagged) };
      out.sxr_unflagged = { useEf: _sxrSampleUseEf(un), url: _sxrUpsertUrlForClient(un) };
      out.settings_flagged = _settingsUseEf(flagged);
      out.settings_unflagged = _settingsUseEf(un);
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
    s.ok(/functions\/v1\/calendar-reorder$/.test(unit.reorder_flagged), 'flagged → calendar-reorder EF', unit.reorder_flagged);
    s.ok(/\/webhook\/calendar-reorder/.test(unit.reorder_unflagged), 'unflagged → calendar-reorder n8n', unit.reorder_unflagged);
    s.ok(unit.sxr_flagged.useEf === true && unit.sxr_flagged.url === L.SXR_EF, 'flagged → sample-review-upsert EF', unit.sxr_flagged.url);
    s.ok(unit.sxr_unflagged.useEf === false && unit.sxr_unflagged.url === L.SXR_N8N, 'unflagged → sample-review-upsert n8n', unit.sxr_unflagged.url);
    s.ok(unit.sxr_emptyflag.useEf === false, 'empty flag → sample-review-upsert n8n (fail-safe)');
    s.ok(unit.settings_flagged === true, 'flagged → settings EF');
    s.ok(unit.settings_unflagged === false, 'unflagged → settings n8n');

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

    // now clear the flag in memory + block n8n writes, then edit caption
    L.setBlockN8nWrites(true);
    const cleared = await page.evaluate(() => { const had = _calUpsertEfClients.has('sidneylaruel'); _calUpsertEfClients = new Set(); return had; });
    s.ok(cleared, 'live: sidneylaruel was in the in-memory flag (now cleared for the test)');
    t0 = Date.now();
    await page.evaluate((a) => {
      const p = calState.posts.find(x => x.name === a.name) || calState.posts.find(x => x.id === a.id); if (!p) return;
      const id = p.id; if (!_calPendingEdits[id]) _calPendingEdits[id] = {};
      _calPendingEdits[id].caption = 'failsafe routed-to-n8n'; p.caption = 'failsafe routed-to-n8n';
      _calFlushCardSave(id);
    }, { name: uniq, id: newId });
    await sleep(5000);
    const fsKinds = rec.writesSince(t0).map(w => w.kind);
    results.live = { create: baseKinds, unflaggedEdit: fsKinds };
    console.log('live unflagged edit kinds:', JSON.stringify(fsKinds), '| courier log:', rec.log.slice(-3).join(' | '));
    s.ok(fsKinds.includes('cal-n8n'), 'live: with flag cleared, caption edit routed to n8n webhook', JSON.stringify(fsKinds));
    s.ok(!fsKinds.includes('cal-ef'), 'live: with flag cleared, NO EF write', JSON.stringify(fsKinds));

    // restore flag + unblock
    await page.evaluate(() => { _calUpsertEfClients = new Set(_calUpsertEfClients); _calUpsertEfClients.add('sidneylaruel'); });
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
