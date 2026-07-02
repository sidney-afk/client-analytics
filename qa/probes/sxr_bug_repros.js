// sxr_bug_repros.js — REGRESSION guards for BUG-3 and BUG-4 (fixed 2026-07-02;
// see qa/OVERNIGHT_TEST_REPORT.md RUN 2). Originally characterization probes
// that passed WHILE the bugs existed; now flipped to assert the FIX holds:
//   BUG-3: _sxrLoadComments is defined and opening Notes on a raw-shaped row
//          does NOT throw.
//   BUG-4: the copied share URL carries &t=<token> when the client has one.
// All in-page; no client-config rows are mutated.
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, archiveSafe } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };

(async () => {
  const browser = await launch();
  const id = 'sr_probe_bugrepro_' + Date.now();
  try {
    up({ id, name: 'BUG repro ' + id.slice(-6), order_index: 1, status: 'In Progress', video_status: 'In Progress', graphic_status: 'In Progress' });

    const page = await smm(browser);
    await page.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id, { timeout: 15000 }).catch(() => {});

    // ---- BUG-4 FIX: _sxrCopyShareLink carries &t=<token> when the client has one ----
    // Inject a token for the test client, capture what the Share button copies.
    const share = await page.evaluate(() => {
      const client = sxrState.client;
      const prior = clientMap[client] ? clientMap[client].client_review_token : undefined;
      if (!clientMap[client]) clientMap[client] = {};
      clientMap[client].client_review_token = 'TESTTOKEN123';
      let captured = '';
      const realClip = navigator.clipboard && navigator.clipboard.writeText;
      try {
        // stub clipboard to capture the URL the function builds
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => { captured = s; return Promise.resolve(); } } });
        _sxrCopyShareLink();
      } catch (e) { captured = 'ERR:' + (e && e.message); }
      // restore
      if (prior === undefined) delete clientMap[client].client_review_token; else clientMap[client].client_review_token = prior;
      return { captured };
    });
    t(/[?&]t=TESTTOKEN123\b/.test(share.captured), 'BUG-4 FIX: share URL carries &t=<token> when the client has one', share.captured);
    t(/[?&]c=/.test(share.captured) && /v=sample-reviews/.test(share.captured), 'BUG-4 FIX: share URL still carries client + view', share.captured);

    // ---- BUG-3 FIX: _sxrLoadComments defined; Notes on a raw-shaped row is safe ----
    const bug3 = await page.evaluate(() => {
      let defined = false; try { defined = typeof _sxrLoadComments === 'function'; } catch { defined = false; }
      return { defined };
    });
    t(bug3.defined, 'BUG-3 FIX: _sxrLoadComments is now defined');

    // The former crash path: strip the comments array (raw/unmigrated row) and
    // open the Notes modal — must NOT throw now.
    const crash = await page.evaluate((cid) => {
      const p = sxrState.posts.find(x => x.id === cid);
      if (!p) return 'no-post';
      p.comments = undefined;                     // raw-row shape
      try { openSxrComments(cid); return 'no-crash'; }
      catch (e) { return String(e && e.message || e); }
    }, id);
    t(crash === 'no-crash', 'BUG-3 FIX: opening Notes on a raw-shaped row no longer throws', crash);
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { archiveSafe(id); } catch {}
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
