// p95 — #850 dark-lane guard: for the TEST-kind client on the write-UI
// reroute allowlist, a status save on a card with NO Linear link must FAIL
// CLOSED (native_link_required) before the source write — the UI-only edit
// must never persist a source row the native side can't see.
//
// This is the intentional behavior the 2026-07-17 nightly regression tripped
// over: every other probe now stubs the write_ui_reroute_clients flag DARK
// (legacy lane, what real clients run); this probe alone opts back into the
// LIVE flag to pin the guard itself. If the owner ever empties the allowlist,
// the guard scenario no longer applies and this probe self-skips green.
//
// Flow (real handlers, live backend, sidneylaruel only, archives its card):
//   seed video='Tweaks Needed' + one open client change-request, NO linear ids
//   → force the reroute flag to actually load (its 2000ms race can leave it
//     dark, which would silently test the wrong lane)
//   → resolve the last change-request → route "Kasper approval"
//   → assert: post._saveError === 'native_link_required',
//             NO sample-review-upsert POST left the page,
//             backend row still 'Tweaks Needed' (nothing persisted).
const lib = require('../sxr_courier_lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'sr_p95_' + TS;
const TW = 'tw_p95_' + TS;
const now = () => new Date().toISOString();

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
  const browser = await lib.launch();
  try {
    lib.up({
      id: PID, name: 'P95 dark-lane guard ' + TS,
      video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed',
      linear_issue_id: '', graphic_linear_issue_id: '',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/v.mp4',
      video_tweaks: JSON.stringify([{ id: TW, parent_id: null, author: 'Client', role: 'client', is_tweak: true, round: 1, audience: 'client', body: 'p95 client change-request', created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' }]),
    });
    await lib.poll(() => { const r = lib.supa(`id=eq.${PID}&select=video_status`); return r && r[0] && r[0].video_status === 'Tweaks Needed'; });

    const smm = await lib.smm(browser, 'sidneylaruel', { writeUiRerouteLive: true });
    const upserts = [];
    smm.on('request', rq => { if (rq.method() === 'POST' && rq.url().includes('sample-review-upsert')) upserts.push(rq.url()); });
    await smm.waitForFunction((pid) => !!document.querySelector(`.cal-card[data-pid="${pid}"]`), PID, { timeout: 30000 });

    // Deterministically load the live flag (retry past the 2000ms race).
    const flagClients = await smm.evaluate(async () => {
      await _writeUiPrimeRerouteFlag();
      let c = peekWriteUiRerouteClients();
      for (let i = 0; i < 3 && !c.length; i++) { await _writeUiFetchRerouteFlagOnce(); c = peekWriteUiRerouteClients(); }
      return c;
    });
    if (!flagClients.includes('sidneylaruel')) {
      console.log('  · reroute allowlist no longer contains the TEST client (' + JSON.stringify(flagClients) + ') — guard scenario not active, skipping green');
      console.log('\nP95 write-UI test-client guard: pass=0 fail=0 (skipped)');
      process.exit(0);
    }
    ok(true, 'live reroute flag loaded with the TEST client (' + JSON.stringify(flagClients) + ')');

    await smm.evaluate((a) => { openSxrComments(a.pid); _sxrToggleCommentDone(a.tw); }, { pid: PID, tw: TW });
    const chooser = await smm.evaluate(() => { const ov = document.getElementById('resolveDestOverlay'); return !!(ov && ov.classList.contains('active')); });
    ok(chooser, 'route chooser opened');
    await smm.evaluate(() => { const b = document.getElementById('resolveDestKasper'); if (b) b.click(); });
    await smm.waitForTimeout(2500);

    const state = await smm.evaluate((pid) => {
      const p = sxrState.posts.find(x => x.id === pid);
      return { saveError: p ? (p._saveError || null) : 'POST NOT FOUND' };
    }, PID);
    ok(state.saveError === 'native_link_required', `save fails closed with native_link_required (got ${JSON.stringify(state.saveError)})`);
    ok(upserts.length === 0, `no sample-review-upsert POST left the page (got ${upserts.length})`);
    const row = lib.supa(`id=eq.${PID}&select=video_status`);
    ok(row && row[0] && row[0].video_status === 'Tweaks Needed', `backend row untouched (got ${row && row[0] && row[0].video_status})`);
  } finally {
    try { await browser.close(); } catch (e) {}
    lib.archiveSafe(PID);
  }
  console.log(`\nP95 write-UI test-client guard: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('P95 FAILED', e); try { lib.archiveSafe(PID); } catch {} process.exit(1); });
