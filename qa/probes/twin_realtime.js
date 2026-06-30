// twin_realtime.js — the cross-tab REALTIME diagnosis for both surfaces.
//
// The reported bug: editing in the CLIENT tab doesn't update another open tab
// without a refresh. The realtime push WebSocket CANNOT be tunnelled through the
// sandbox proxy (browser egress is blocked), so a headless probe can't receive a
// real push. Instead we isolate the two failure modes the report flags:
//
//   1. WS delivery — does the push ever ARRIVE on the observer tab? (env-level;
//      only a REAL browser with open egress can confirm — we just report whether
//      each surface even SUBSCRIBES, symmetrically.)
//   2. Repaint path — GIVEN a push, does the observer tab repaint to the new DB
//      state? We SIMULATE the push by invoking the surface's realtime handler
//      (_sxrV2OnRealtimeChange / _calV2OnRealtimeChange) on a never-reloaded tab
//      after a real backend write by the other actor, then check whether the tab
//      caught up. If calendar catches up but samples doesn't → a real divergence;
//      if BOTH catch up → the repaint path is at parity and any remaining bug is
//      WS-delivery only (needs a real two-tab browser to confirm).
//
// Run: node qa/probes/twin_realtime.js
const fs = require('fs');
const L = require('../sxr_courier_lib.js');
const T = require('../twin_live_lib.js');
const { SXR, CAL } = T;

// Read the displayed video sub-status text on a never-reloaded SMM Sheet tab.
async function sheetVideoStatus(page, S, id) {
  return page.evaluate((a) => {
    const card = document.querySelector('#' + a.strip + ' .cal-card[data-pid="' + a.id + '"]');
    if (!card) return '(no-card)';
    const wrap = card.querySelector('[data-substatus-pid="' + a.id + '"][data-substatus-comp="video"]');
    if (!wrap) return '(no-wrap)';
    return (wrap.textContent || '').replace(/\s+/g, ' ').trim();
  }, { strip: S.strip, id });
}

async function diagnose(browser, S) {
  const id = 'sr_rt_' + S.key + '_' + Date.now();
  const name = 'RT ' + S.key + ' ' + Date.now();
  const seed = { id, name, order_index: 1, asset_url: 'https://frame.io/x/' + id, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
    video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' };
  S.seed(seed);
  await L.poll(() => S.readRow(id, 'id') ? true : null, 12000, 600);

  const out = { surface: S.label, id };
  // tab A — SMM Sheet, opened ONCE, NEVER reloaded (the observer)
  const tabA = await S.openSmm(browser);
  await tabA.evaluate((s) => { const b = document.querySelector('#' + s.view + ' .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof window[s.loader] === 'function') window[s.loader]({ skipCache: true }); }, T.ser(S));
  await tabA.waitForFunction((a) => !!document.querySelector('#' + a.strip + ' .cal-card[data-pid="' + a.id + '"]'), { strip: S.strip, id }, { timeout: 10000 }).catch(() => {});
  out.before = await sheetVideoStatus(tabA, S, id);
  out.subscribedA = await tabA.evaluate((fn) => { try { return window[fn] ? window[fn]() : null; } catch (e) { return null; } }, S.statusFn);

  // tab B — client portal: the editor approves the video (real backend write)
  const tabB = await S.openClient(browser);
  out.subscribedB = await tabB.evaluate((fn) => { try { return window[fn] ? window[fn]() : null; } catch (e) { return null; } }, S.statusFn);
  const clientRes = await T.vClient(tabB, S, name, 'video', 'approve');
  out.clientApproveRes = clientRes;
  out.dbAfterWrite = await T.waitCol(S, id, 'video_status', 'Approved', 14000);

  // observer tab A WITHOUT reload — did it auto-reflect via realtime? (expected
  // false headless: the push WS can't be tunnelled)
  await tabA.waitForTimeout(2500);
  out.autoReflect = await sheetVideoStatus(tabA, S, id);

  // SIMULATE the push on tab A — invoke the realtime handler directly, the way a
  // real WS event would, then let the debounce + background load run.
  await tabA.evaluate((fn) => { try { window[fn] && window[fn]('sidneylaruel'); } catch (e) {} }, S.realtimeFn);
  await tabA.waitForTimeout(5000);
  out.afterSimPush = await sheetVideoStatus(tabA, S, id);

  out.autoReflected = /approved/i.test(out.autoReflect);
  out.pushRepainted = /approved/i.test(out.afterSimPush);
  out.errors = L.appErrs(tabA).concat(L.appErrs(tabB)).slice(0, 6);

  try { await tabA.context().close(); } catch {}
  try { await tabB.context().close(); } catch {}
  try { S.archive(id); } catch {}
  return out;
}

(async () => {
  const browser = await L.launch();
  let cal, sxr;
  try {
    cal = await diagnose(browser, CAL);
    sxr = await diagnose(browser, SXR);
  } finally { await browser.close(); }

  const report = { cal, sxr };
  console.log('\n═══ TWIN REALTIME diagnosis (cross-tab repaint) ═══');
  for (const r of [cal, sxr]) {
    console.log(`\n── ${r.surface} ──`);
    console.log('  observer before write     :', r.before);
    console.log('  client.approve(video) res :', r.clientApproveRes, '| DB reached Approved:', r.dbAfterWrite);
    console.log('  observer AUTO (no reload) :', r.autoReflect, ' → auto-reflected:', r.autoReflected);
    console.log('  observer after SIM push   :', r.afterSimPush, ' → push repainted:', r.pushRepainted);
    console.log('  status A (subscribed?)    :', JSON.stringify(r.subscribedA));
    console.log('  status B (subscribed?)    :', JSON.stringify(r.subscribedB));
    if (r.errors && r.errors.length) console.log('  app errors:', r.errors);
  }
  console.log('\n── VERDICT ──');
  console.log(`  auto-reflect (real WS):   calendar=${cal.autoReflected}  samples=${sxr.autoReflected}   (both false expected headless — WS untunnelable)`);
  console.log(`  push-repaint (handler):   calendar=${cal.pushRepainted}  samples=${sxr.pushRepainted}`);
  if (cal.pushRepainted && !sxr.pushRepainted) console.log('  → DIVERGENCE: samples repaint path FAILS where calendar succeeds (real bug, code-level).');
  else if (cal.pushRepainted && sxr.pushRepainted) console.log('  → repaint path AT PARITY; any remaining cross-tab bug is WS-delivery only (confirm in a real browser).');
  else console.log('  → inconclusive (calendar repaint did not fire) — investigate harness.');
  fs.writeFileSync('/tmp/twin_realtime_result.json', JSON.stringify(report, null, 2));
  console.log('\nwrote /tmp/twin_realtime_result.json');
  process.exit(0);
})().catch(e => { console.error('TWIN-REALTIME ERROR', e && e.stack || e); process.exit(2); });
