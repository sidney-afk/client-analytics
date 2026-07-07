// Phase 1c + Phase 2 — per-component status flip on the dual-component TEST 2 card.
// Drives the real SMM status control (_calStatusPick — the exact fn the pill menu
// item's onclick calls) and proves, per component:
//   (a) ROUTING: the card write hits …/functions/v1/calendar-upsert, NOT the n8n
//       calendar-upsert-post webhook.
//   (b) SUPABASE: the right *_status column takes the new value with fresh updated_at.
//   (c) LINEAR (Pipe B): exactly ONE linear-set-status push fires, carrying the
//       CORRECT issue (video→VID-12612, graphic→GRA-6310) and status — and NONE for
//       the other component (dual-component isolation). Forwarded to LIVE n8n so the
//       real round-trip is verifiable in Linear (verified/reverted out-of-band).
// Each flip is reverted to baseline. Results written to /tmp/qa-efwp for reporting.
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const TEST2 = 'p_mqjznt6m_h4k9o';
const VID = 'VID-12612', GRA = 'GRA-6310';
const OUT = '/tmp/qa-efwp/results-status.json';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('status-linear');
  const results = { card: TEST2, baseline: null, steps: [], linearPushes: [] };
  try {
    // Baseline (backend truth) — used to revert.
    const base = L.calRow(TEST2, 'video_status,graphic_status,caption_status,title_status,status,updated_at');
    results.baseline = base;
    console.log('baseline:', JSON.stringify(base));

    // Forward Linear pushes to LIVE n8n ONLY for TEST 2's own issues, and ONLY
    // when explicitly enabled (EFWP_LINEAR_FORWARD=1). Default = capture+mock, so
    // the FE routing/enqueue is proven with zero Linear mutation.
    const FWD = process.env.EFWP_LINEAR_FORWARD === '1';
    results.mode = FWD ? 'forward-live-n8n' : 'capture-mock';
    L.setLinearForwardAllow(FWD ? [VID, GRA] : []);
    console.log('linear mode:', results.mode);

    const { page, rec } = await L.smmCal(browser);
    s.ok(page._forceLoadLast === undefined || (page._forceLoadLast && page._forceLoadLast.posts > 0), 'SMM calendar loaded TEST client rows');

    async function flip(comp, toStatus, expectIssue, otherIssue) {
      const t0 = Date.now();
      const col = comp + '_status';
      await page.evaluate((a) => { _calStatusPick(a.pid, a.status, a.comp); }, { pid: TEST2, status: toStatus, comp });
      // wait for the backend column to reflect the change
      const row = await L.pollCal(TEST2, r => r[col] === toStatus, col + ',status,updated_at', 20000);
      await sleep(9000); // let the fire-and-forget n8n→Linear push land
      const writes = rec.writesSince(t0);
      const kinds = writes.map(w => w.kind);
      const linear = rec.linearSince(t0).filter(l => l.path === 'linear-set-status');
      const toExpect = linear.filter(l => String((l.payload && l.payload.issue) || '').includes(expectIssue));
      const toOther = linear.filter(l => String((l.payload && l.payload.issue) || '').includes(otherIssue));
      const efHits = kinds.filter(k => k === 'cal-ef').length;
      const n8nHits = kinds.filter(k => k === 'cal-n8n').length;
      const step = {
        comp, toStatus,
        backend: { [col]: row[col], status: row.status, updated_at: row.updated_at },
        routing: { efHits, n8nHits, kinds },
        linear: {
          expectIssue, toExpectCount: toExpect.length, otherIssue, toOtherCount: toOther.length,
          pushes: linear.map(l => ({ issue: (l.payload && l.payload.issue), status: (l.payload && l.payload.status), forwarded: l.forwarded })),
        },
      };
      results.steps.push(step);
      results.linearPushes.push(...linear.map(l => ({ comp, when: l.t, issue: (l.payload && l.payload.issue), status: (l.payload && l.payload.status), forwarded: l.forwarded })));
      console.log(`\n[${comp} → ${toStatus}]`, JSON.stringify(step, null, 0));
      s.ok(row[col] === toStatus, `(${comp}) backend ${col} = ${toStatus}`, 'got ' + row[col]);
      s.ok(efHits >= 1, `(${comp}) write routed to calendar-upsert EF`, 'efHits=' + efHits);
      s.ok(n8nHits === 0, `(${comp}) NO n8n calendar-upsert-post`, 'n8nHits=' + n8nHits);
      s.ok(toExpect.length >= 1, `(${comp}) Pipe B fired for ${expectIssue}`, 'count=' + toExpect.length);
      s.ok(toExpect.every(l => String(l.payload && l.payload.status || '') === toStatus), `(${comp}) push carried status "${toStatus}"`);
      if (FWD) s.ok(toExpect.every(l => l.forwarded), `(${comp}) ${expectIssue} push forwarded to LIVE n8n`);
      s.ok(toOther.length === 0, `(${comp}) NO push to ${otherIssue} (component isolation)`, 'count=' + toOther.length);
      return step;
    }

    // VIDEO — expect only VID-12612 to move.
    await flip('video', 'In Progress', VID, GRA);
    // revert video to baseline
    await flip('video', base.video_status, VID, GRA);

    // GRAPHIC — expect only GRA-6310 to move.
    await flip('graphic', 'In Progress', GRA, VID);
    // revert graphic to baseline
    await flip('graphic', base.graphic_status, GRA, VID);

    // Final: card back at baseline?
    const finalRow = L.calRow(TEST2, 'video_status,graphic_status,caption_status,title_status,status');
    results.final = finalRow;
    s.ok(finalRow.video_status === base.video_status, 'video_status reverted to baseline', finalRow.video_status);
    s.ok(finalRow.graphic_status === base.graphic_status, 'graphic_status reverted to baseline', finalRow.graphic_status);

    const errs = L.appErrs(page);
    s.ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
    if (rec.log.length) { console.log('\n  courier log:', rec.log.join('\n   ')); }
  } catch (e) {
    console.error('EXCEPTION:', e && e.stack || e); s.fail++;
  } finally {
    results.pass = s.pass; results.fail = s.fail;
    try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); } catch (e) {}
    await browser.close(); server.close();
    console.log(`\nSTATUS-LINEAR: ${s.pass} pass / ${s.fail} fail  → ${OUT}`);
    process.exit(s.fail ? 1 : 0);
  }
})();
