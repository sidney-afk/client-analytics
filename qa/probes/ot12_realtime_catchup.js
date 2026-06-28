// ot12_realtime_catchup.js — cross-tab sync against the LIVE backend.
// The courier can't tunnel the realtime WebSocket, so this exercises the two
// mechanisms that actually keep tabs in sync here:
//  (1) background catch-up on tab return (_sxrRefreshOnReturn via focus/visibility)
//  (2) the realtime change handler (_sxrV2OnRealtimeChange) directly (simulated push)
// Tab-1 changes a status live; Tab-2 (initially stale) converges via each path.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_ot12_' + Date.now();
const NAME = 'OT realtime ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }
// read the video sub-status straight from the DOM (sxrState is module-scoped)
const readVid = (page) => page.evaluate((id) => { const w = document.querySelector(`[data-substatus-pid="${id}"][data-substatus-comp="video"]`); return w ? w.getAttribute('data-val') : null; }, ID);
const hasCard = (page) => page.waitForFunction((id) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${id}"]`), ID, { timeout: 12000 }).catch(() => {});

(async () => {
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/ot12', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'Approved', status: 'In Progress' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const p1 = await smm(browser);
    const p2 = await smm(browser);
    await hasCard(p1); await hasCard(p2);
    ok((await readVid(p1)) === 'In Progress' && (await readVid(p2)) === 'In Progress', 'both tabs start at In Progress', 'p1=' + (await readVid(p1)) + ' p2=' + (await readVid(p2)));

    // tab-1 changes the video status via the real picker → For SMM Approval (live)
    const cardSel = `#sxrStrip .cal-card[data-pid="${ID}"]`;
    await p1.click(`${cardSel} .cal-fld-substatus-trigger`);
    await p1.waitForTimeout(300);
    await p1.evaluate(() => { const t = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')].find(i => /For SMM Approval/i.test(i.textContent)); if (t) t.click(); });
    const live = await poll(() => { const r = supa('id=eq.' + ID + '&select=video_status'); return (r[0] && r[0].video_status === 'For SMM Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!live, 'tab-1 status change persisted live (For SMM Approval)');

    // tab-2 is still stale (no WS under courier)
    await p2.waitForTimeout(500);
    ok((await readVid(p2)) === 'In Progress', 'tab-2 still stale before catch-up (WS not tunneled — expected)');

    // (1) background catch-up on tab return. The return-refresh is throttled to
    // once / SXR_RETURN_REFRESH_MIN_MS (8s) to avoid hammering the backend, so wait
    // past that window before firing the return event (OBS-R3, intended behavior).
    await p2.waitForTimeout(8500);
    await p2.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); });
    const caught = await (async () => {
      for (let i = 0; i < 16; i++) { if ((await readVid(p2)) === 'For SMM Approval') return true; await p2.waitForTimeout(700); }
      return false;
    })();
    ok(caught, 'tab-2 caught up to For SMM Approval after focus/visibility return (past 8s throttle)');

    // (2) realtime handler directly (simulated push): move to Kasper live, fire handler
    up({ id: ID, video_status: 'Kasper Approval', status: 'Kasper Approval' });
    await poll(() => { const r = supa('id=eq.' + ID + '&select=video_status'); return (r[0] && r[0].video_status === 'Kasper Approval') ? r[0] : null; }, 12000, 800);
    await p2.evaluate((slug) => { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(slug); }, 'sidneylaruel');
    const pushCaught = await (async () => { for (let i = 0; i < 16; i++) { if ((await readVid(p2)) === 'Kasper Approval') return true; await p2.waitForTimeout(700); } return false; })();
    ok(pushCaught, 'tab-2 converged via _sxrV2OnRealtimeChange handler (simulated push)');

    ok((await appErrs(p1)).length === 0, 'tab-1: zero app JS errors');
    ok((await appErrs(p2)).length === 0, 'tab-2: zero app JS errors');
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot12_realtime_catchup: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
