// p88_realtime_handler.js — REALTIME handler-injection probe (Layer B).
//
// The realtime WebSocket can't be tunneled headless (the egress proxy refuses WS
// upgrades), so we can't receive a REAL push. But we CAN prove the half that
// actually had the bugs: GIVEN a push, does the never-reloaded observer surface
// react correctly? We mutate a row as "another actor" (via the Node courier, NOT
// the page), then invoke the very function the realtime callback invokes
// (_sxrV2OnRealtimeChange / _sxrKasperLoadQueue) on a tab that was opened ONCE and
// never reloaded, and assert the DOM caught up — without a manual reload.
//
// Three assertions, one per thing we fixed:
//   B1  SMM sheet repaint path — an actor's status change reaches the observer.
//   B2  dataChanged gate — a NO-OP echo does NOT rebuild the queue (no flash). A
//       card-level sentinel survives the echo; a real change (B1) replaces the card.
//   B3  Kasper-queue realtime — a card routed to Kasper appears in the never-
//       reloaded Kasper samples sub-tab once the queue-refresh fires.
//
// (Lane A — realtime_parity.js — separately proves the WS is WIRED to call these.
// Together: A = "the socket calls the handler", B = "the handler updates the UI".)
//
// Run: node qa/probes/p88_realtime_handler.js   (exit 0 = all pass)
const L = require('../sxr_courier_lib.js');

const SLUG = 'sidneylaruel';
const results = [];
const ok = (cond, msg) => { results.push({ pass: !!cond, msg }); console.log((cond ? '  ✓ ' : '  ✗ ') + msg); };

// Fire the SMM-sheet realtime entry point on the observer, then poll the DOM for
// the wanted video sub-status — never a manual skipCache reload.
async function fireSmmEchoAndRead(page, id, wantSub, ms = 12000) {
  await page.evaluate(() => { try { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(sxrClientSlug(sxrState.client)); } catch (e) {} });
  return page.evaluate(async (a) => {
    const t = Date.now();
    const read = () => {
      const w = document.querySelector(`#sxrStrip .cal-card[data-pid="${a.id}"] [data-substatus-pid="${a.id}"][data-substatus-comp="video"]`);
      return w ? (w.textContent || '').replace(/\s+/g, ' ').trim() : '(no-pill)';
    };
    while (Date.now() - t < a.ms) { if (read().toLowerCase().includes(a.want.toLowerCase())) return read(); await new Promise(x => setTimeout(x, 500)); }
    return read();
  }, { id, want: wantSub, ms });
}

(async () => {
  const browser = await L.launch();
  const id = 'sr_p88_' + Date.now();
  const kid = 'sr_p88k_' + Date.now();
  let smm, kas;
  try {
    // ── B1 + B2 : SMM sheet ────────────────────────────────────────────────
    L.up({ id, name: 'P88 ' + id.slice(-6), order_index: 1, asset_url: 'https://frame.io/x/' + id,
      thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
      linear_issue_id: 'https://linear.app/x/VID-' + id.slice(-6), graphic_linear_issue_id: 'https://linear.app/x/GRA-' + id.slice(-6),
      video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' });
    await L.poll(() => { const r = L.supa('id=eq.' + id + '&select=video_status'); return (r && r[0]) ? r[0] : null; }, 12000, 600);

    smm = await L.smm(browser);
    // observer: organizer (Sheet) view, loaded ONCE here in setup
    await smm.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
    await smm.waitForFunction((a) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${a}"]`), id, { timeout: 12000 }).catch(() => {});
    const before = await smm.evaluate((a) => { const w = document.querySelector(`[data-substatus-pid="${a}"][data-substatus-comp="video"]`); return w ? (w.textContent || '').replace(/\s+/g, ' ').trim() : '(no-pill)'; }, id);

    // another actor (the courier, NOT the page) moves video → Kasper Approval
    L.up({ id, video_status: 'Kasper Approval', status: 'Kasper Approval' });
    await L.poll(() => { const r = L.supa('id=eq.' + id + '&select=video_status'); return (r && r[0] && r[0].video_status === 'Kasper Approval') ? r[0] : null; }, 12000, 600);

    const after = await fireSmmEchoAndRead(smm, id, 'Kasper');
    ok(/kasper/i.test(after) && !/kasper/i.test(before),
      `B1 SMM sheet caught up via realtime handler, no manual reload (before="${before}" → after="${after}")`);

    // B2 — dataChanged gate: stamp a sentinel on the current card, fire a NO-OP echo
    // (no DB change since the last sync), assert the card was NOT rebuilt.
    await smm.evaluate((a) => { const c = document.querySelector(`#sxrStrip .cal-card[data-pid="${a}"]`); if (c) c.setAttribute('data-rt-sentinel', 'keep'); }, id);
    await smm.evaluate(() => { try { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(sxrClientSlug(sxrState.client)); } catch (e) {} });
    await smm.waitForTimeout(3500);   // let the debounced background reload run (and choose to skip)
    const sentinelSurvived = await smm.evaluate((a) => { const c = document.querySelector(`#sxrStrip .cal-card[data-pid="${a}"]`); return !!(c && c.getAttribute('data-rt-sentinel') === 'keep'); }, id);
    ok(sentinelSurvived, 'B2 no-op realtime echo did NOT rebuild the queue (dataChanged gate held — no flash)');

    // ── B3 : Kasper samples queue ──────────────────────────────────────────
    L.up({ id: kid, name: 'P88K ' + kid.slice(-6), order_index: 1, asset_url: 'https://frame.io/x/' + kid,
      thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
      linear_issue_id: 'https://linear.app/x/VID-' + kid.slice(-6), graphic_linear_issue_id: 'https://linear.app/x/GRA-' + kid.slice(-6),
      video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' });   // NOT in the Kasper queue yet
    await L.poll(() => { const r = L.supa('id=eq.' + kid + '&select=id'); return (r && r[0]) ? r[0] : null; }, 12000, 600);

    kas = await L.kasper(browser);   // Kasper page, samples sub-tab, loaded ONCE
    await kas.evaluate(() => { try { if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); } catch (e) {} });
    await kas.waitForTimeout(2500);
    const absentBefore = await kas.evaluate((a) => !document.querySelector(`[data-sxr-kasper-pid="${a}"]`), kid);

    // actor routes the card to Kasper Approval, then the realtime queue-refresh fires
    L.up({ id: kid, video_status: 'Kasper Approval', status: 'Kasper Approval' });
    await L.poll(() => { const r = L.supa('id=eq.' + kid + '&select=video_status'); return (r && r[0] && r[0].video_status === 'Kasper Approval') ? r[0] : null; }, 12000, 600);

    await kas.evaluate(() => { try { if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(); } catch (e) {} });   // what _sxrKasperV2 fires
    const appeared = await kas.evaluate(async (a) => {
      const t = Date.now();
      while (Date.now() - t < 14000) { if (document.querySelector(`[data-sxr-kasper-pid="${a}"]`)) return true; await new Promise(x => setTimeout(x, 500)); }
      return false;
    }, kid);
    ok(absentBefore && appeared, `B3 Kasper samples queue updated via realtime handler, no manual reload (absentBefore=${absentBefore} → appeared=${appeared})`);

    const errs = [...(L.appErrs(smm) || []), ...(kas ? L.appErrs(kas) : [])];
    ok(errs.length === 0, 'no app JS errors (' + JSON.stringify(errs.slice(0, 3)) + ')');
  } catch (e) {
    ok(false, 'probe threw: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { L.archiveSafe(id); } catch {}
    try { L.archiveSafe(kid); } catch {}
  }

  const fails = results.filter(r => !r.pass).length;
  console.log('\n' + '─'.repeat(64));
  console.log('RESULT: ' + (fails ? fails + '/' + results.length + ' FAILED' : 'all ' + results.length + ' realtime handler checks passed'));
  process.exit(fails ? 1 : 0);
})();
