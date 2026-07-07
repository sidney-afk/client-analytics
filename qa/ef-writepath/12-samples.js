// Phase 1 — SAMPLES (sxr) write interactions via the real SMM samples UI.
//   status flip (video/graphic) on the dual-component Sample 1 card:
//     -> sample-review-upsert EF (never n8n), correct *_status column,
//        Pipe B fires to the CORRECT issue (video→VID-12728, graphic→GRA-6496) ONLY.
//   reorder -> sample-review-reorder EF.
//   add + archive (disposable card) -> sample-review-upsert EF insert + archive.
// Linear pushes are captured+mocked by default; EFWP_LINEAR_FORWARD=1 forwards Sample 1's
// own issues to LIVE n8n for the real round-trip (verified/reverted out of band).
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const S1 = 'sr_mqvenh27_jp85b';
const VID = 'VID-12728', GRA = 'GRA-6496';
const OUT = '/tmp/qa-efwp/results-samples.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('samples');
  const results = { card: S1, steps: [] };
  const FWD = process.env.EFWP_LINEAR_FORWARD === '1';
  results.mode = FWD ? 'forward-live-n8n' : 'capture-mock';
  L.setLinearForwardAllow(FWD ? [VID, GRA] : []);
  let newId = null;
  try {
    const base = L.sampleRow(S1, 'video_status,graphic_status,status,order_index,updated_at');
    results.baseline = base;
    console.log('baseline:', JSON.stringify(base), '| mode:', results.mode);

    const { page, rec } = await L.smmSamples(browser);
    s.ok(page._forceLoadLast === undefined || (page._forceLoadLast && page._forceLoadLast.posts > 0), 'SMM samples loaded rows', JSON.stringify(page._forceLoadLast));
    const present = await page.evaluate((id) => (typeof sxrState === 'object' && (sxrState.posts || []).some(p => p.id === id)), S1);
    s.ok(present, 'Sample 1 present in sxrState');

    async function flip(comp, to, expectIssue, otherIssue) {
      const t0 = Date.now();
      const col = comp + '_status';
      await page.evaluate((a) => { _sxrStatusPick(a.pid, a.status, a.comp); }, { pid: S1, status: to, comp });
      const row = await L.pollSample(S1, r => r[col] === to, col + ',status,updated_at', 20000);
      await sleep(FWD ? 9000 : 3500);
      const kinds = rec.writesSince(t0).map(w => w.kind);
      const linear = rec.linearSince(t0).filter(l => l.path === 'linear-set-status');
      const toExpect = linear.filter(l => String((l.payload && l.payload.issue) || '').includes(expectIssue));
      const toOther = linear.filter(l => String((l.payload && l.payload.issue) || '').includes(otherIssue));
      const efHits = kinds.filter(k => k === 'sxr-ef').length;
      const n8nHits = kinds.filter(k => k === 'sxr-n8n').length;
      results.steps.push({ comp, to, backend: { [col]: row[col] }, efHits, n8nHits, kinds, toExpect: toExpect.length, toOther: toOther.length, pushes: linear.map(l => ({ issue: l.payload && l.payload.issue, status: l.payload && l.payload.status, forwarded: l.forwarded })) });
      console.log(`[${comp} → ${to}] ef=${efHits} n8n=${n8nHits} linear=${JSON.stringify(linear.map(l => ({ i: (l.payload && l.payload.issue || '').match(/(VID|GRA)-\d+/) && (l.payload.issue).match(/(VID|GRA)-\d+/)[0], st: l.payload && l.payload.status })))}`);
      s.ok(row[col] === to, `(${comp}) backend ${col} = ${to}`, row[col]);
      s.ok(efHits >= 1, `(${comp}) routed to sample-review-upsert EF`, 'ef=' + efHits);
      s.ok(n8nHits === 0, `(${comp}) NO n8n sample-review-upsert`, 'n8n=' + n8nHits);
      s.ok(toExpect.length >= 1, `(${comp}) Pipe B fired for ${expectIssue}`, 'count=' + toExpect.length);
      s.ok(toOther.length === 0, `(${comp}) NO push to ${otherIssue} (isolation)`, 'count=' + toOther.length);
      if (FWD) s.ok(toExpect.every(l => l.forwarded), `(${comp}) push forwarded to LIVE n8n`);
    }

    // VIDEO then revert
    await flip('video', 'In Progress', VID, GRA);
    await flip('video', base.video_status, VID, GRA);
    // GRAPHIC then revert
    await flip('graphic', 'In Progress', GRA, VID);
    await flip('graphic', base.graphic_status, GRA, VID);

    // ---- reorder (sample-review-reorder EF) — single item, restored ----
    let t0 = Date.now();
    const curOrd = Number(base.order_index || 0);
    const newOrd = curOrd + 3;
    await page.evaluate((a) => { _sxrReorderFetch('sidneylaruel', { client: 'sidneylaruel', items: [{ id: a.id, order_index: a.ord }] }, 'ui'); }, { id: S1, ord: newOrd });
    const rr = await L.pollSample(S1, r => Number(r.order_index) === newOrd, 'order_index', 15000);
    let kinds = rec.writesSince(t0).map(w => w.kind);
    s.ok(Number(rr.order_index) === newOrd, 'reorder: order_index updated', rr.order_index);
    s.ok(kinds.includes('sxr-reorder-ef') && !kinds.includes('sxr-reorder-n8n'), 'reorder routed to sample-review-reorder EF only', JSON.stringify(kinds));
    // restore original order
    await page.evaluate((a) => { _sxrReorderFetch('sidneylaruel', { client: 'sidneylaruel', items: [{ id: a.id, order_index: a.ord }] }, 'ui'); }, { id: S1, ord: curOrd });
    await L.pollSample(S1, r => Number(r.order_index) === curOrd, 'order_index', 15000);

    // ---- add + archive (disposable samples card) ----
    const uniq = 'EFWP-SXR-' + Date.now();
    t0 = Date.now();
    const addInfo = await page.evaluate((a) => {
      if (typeof addSxrBlankCard !== 'function') return { err: 'no addSxrBlankCard' };
      addSxrBlankCard();
      const card = document.querySelector('#sxrStrip .cal-card[data-pid^="__sxrblank__"], .cal-card[data-pid^="__sxrblank__"]');
      if (!card) return { err: 'no blank card' };
      const pid = card.getAttribute('data-pid');
      const setVal = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const nameEl = card.querySelector('.cal-fld-name');
      if (nameEl) { setVal(nameEl, a.name); if (typeof _sxrOnFieldBlur === 'function') _sxrOnFieldBlur(nameEl); }
      return { pid, hasName: !!nameEl };
    }, { name: uniq });
    console.log('sxr add:', JSON.stringify(addInfo));
    let created = null;
    for (let i = 0; i < 25 && !created; i++) { const r = L.supaSample(`client=eq.sidneylaruel&name=eq.${encodeURIComponent(uniq)}&select=id,name,status`); if (Array.isArray(r) && r[0]) created = r[0]; else await sleep(800); }
    newId = created && created.id;
    kinds = rec.writesSince(t0).map(w => w.kind);
    s.ok(!!created, 'add: samples row created', 'id=' + newId);
    s.ok(kinds.includes('sxr-ef') && !kinds.includes('sxr-n8n'), 'add: routed to sample-review-upsert EF only', JSON.stringify(kinds));

    if (newId) {
      t0 = Date.now();
      await page.evaluate((id) => { archiveSxrCard(id); }, newId);
      await page.waitForSelector('#confirmOverlay.active', { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => { const b = document.getElementById('confirmYes'); if (b) b.click(); });
      const af = await L.pollSample(newId, r => r.status === 'Archived', 'status', 15000);
      kinds = rec.writesSince(t0).map(w => w.kind);
      s.ok(af.status === 'Archived', 'archive: samples card archived', af.status);
      s.ok(kinds.includes('sxr-ef') && !kinds.includes('sxr-n8n'), 'archive: routed to EF only', JSON.stringify(kinds));
    }

    // final: statuses + order restored
    const fin = L.sampleRow(S1, 'video_status,graphic_status,order_index');
    s.ok(fin.video_status === base.video_status && fin.graphic_status === base.graphic_status, 'Sample 1 statuses restored', JSON.stringify(fin));
    s.ok(Number(fin.order_index) === curOrd, 'Sample 1 order restored');

    const errs = L.appErrs(page);
    s.ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
    if (rec.log.length) console.log('courier log:', rec.log.join('\n '));
  } catch (e) { console.error('EXCEPTION:', e && e.stack || e); s.fail++; }
  finally {
    // safety: ensure the disposable samples card is archived even on failure
    if (newId) { try { L.sampleUpN8n({ id: newId, status: 'Archived' }); } catch (e) {} }
    results.pass = s.pass; results.fail = s.fail;
    try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); } catch (e) {}
    await browser.close(); server.close();
    console.log(`\nSAMPLES: ${s.pass} pass / ${s.fail} fail  → ${OUT}`);
    process.exit(s.fail ? 1 : 0);
  }
})();
