// Phase 4 (focused) — read-only surface health for the EF path. Passively LOAD the
// SMM + client calendar and samples surfaces and assert: (1) zero app console errors,
// (2) zero WRITE requests (no calendar/sample upsert/reorder/settings, no Linear
// status/comment push) fire on a passive load — writes must only happen on user action.
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const OUT = '/tmp/qa-efwp/results-readonly.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WRITE_KINDS = new Set(['cal-ef', 'cal-n8n', 'sxr-ef', 'sxr-n8n', 'cal-reorder-ef', 'cal-reorder-n8n', 'sxr-reorder-ef', 'sxr-reorder-n8n', 'settings-ef', 'settings-n8n', 'linear-status', 'linear-comment']);

(async () => {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('readonly');
  const results = {};
  L.setLinearForwardAllow([]);
  try {
    const surfaces = [
      ['SMM calendar', () => L.smmCal(browser)],
      ['SMM samples', () => L.smmSamples(browser)],
      ['client calendar (read-only role)', () => L.clientCal(browser)],
      ['client samples (read-only role)', () => L.clientSamples(browser)],
    ];
    for (const [label, open] of surfaces) {
      const h = await open();
      const t0 = Date.now();
      await sleep(5000); // passive dwell — no interaction
      const writes = h.rec.since(t0).filter(r => r.method === 'POST' && WRITE_KINDS.has(r.kind));
      const errs = L.appErrs(h.page);
      results[label] = { writes: writes.map(w => w.kind), errs };
      console.log(`[${label}] passive writes: ${writes.length ? JSON.stringify(writes.map(w => w.kind)) : 'NONE'} | errs: ${errs.length}`);
      s.ok(writes.length === 0, `${label}: zero WRITE/Linear POSTs on passive load`, writes.map(w => w.kind).join(','));
      s.ok(errs.length === 0, `${label}: zero app console errors`, errs.slice(0, 2).join(' | '));
      await h.ctx.close();
    }
  } catch (e) { console.error('EXCEPTION:', e && e.stack || e); s.fail++; }
  finally {
    results.pass = s.pass; results.fail = s.fail;
    try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); } catch (e) {}
    await browser.close(); server.close();
    console.log(`\nREADONLY: ${s.pass} pass / ${s.fail} fail  → ${OUT}`);
    process.exit(s.fail ? 1 : 0);
  }
})();
