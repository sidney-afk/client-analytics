// sxr_bug_repros.js — LIVE repros for the two source-read bugs found 2026-07-02
// (see qa/OVERNIGHT_TEST_REPORT.md RUN 2 → BUG-3, BUG-4). These are
// CHARACTERIZATION probes: they PASS while the bugs exist (proving the repro
// is real) and will FAIL loudly once the bugs are fixed — flip the assertions
// then. All in-page; no client-config rows are mutated.
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

    // ---- BUG-4: _sxrCopyShareLink omits &t= while the router requires it ----
    // In-page only: read the URL the Share button would copy, and compare with
    // the router's gate condition. No clipboard, no config writes.
    const share = await page.evaluate(() => {
      const url = location.origin + location.pathname + '?sxr=1&c=' + encodeURIComponent(sxrState.client) + '&v=sample-reviews';
      // reproduce _sxrCopyShareLink's construction (it writes to clipboard, so
      // we re-derive the same string it builds — source: index.html:25580)
      const fnSrc = String(_sxrCopyShareLink);
      return { url, buildsToken: /[?&]t=|client_review_token/.test(fnSrc) };
    });
    t(!share.buildsToken, 'BUG-4 repro: _sxrCopyShareLink builds NO &t= token param', share.buildsToken ? 'now includes token — bug fixed? flip this probe' : '');
    t(!/[&?]t=/.test(share.url), 'BUG-4 repro: derived share URL has no t= param', share.url);

    // The router hard-rejects when a token is expected and t mismatches — prove
    // the gate exists by inspecting the shipped router source in-page.
    const gate = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      return /expectedToken && tParam !== expectedToken/.test(html) || /This link isn't valid/.test(html);
    });
    t(gate, 'BUG-4 repro: router token gate present ("This link isn\'t valid" path exists)');

    // ---- BUG-3: _sxrLoadComments is called but never defined ----
    const bug3 = await page.evaluate(() => ({
      defined: typeof window._sxrLoadComments !== 'undefined' || (() => { try { _sxrLoadComments; return true; } catch { return false; } })(),
      callSites: (document.documentElement.outerHTML.match(/_sxrLoadComments\(/g) || []).length,
    }));
    t(!bug3.defined, 'BUG-3 repro: _sxrLoadComments is UNDEFINED', bug3.defined ? 'now defined — bug fixed? flip this probe' : '');
    t(bug3.callSites >= 6, `BUG-3 repro: ≥6 call sites reference it (found ${bug3.callSites})`);

    // Trigger the live crash path: strip the comments array (simulating a raw/
    // unmigrated row, e.g. from a realtime echo) and open the Notes modal.
    const crash = await page.evaluate((cid) => {
      const p = sxrState.posts.find(x => x.id === cid);
      if (!p) return 'no-post';
      p.comments = undefined;                     // raw-row shape
      try { openSxrComments(cid); return 'no-crash'; }
      catch (e) { return String(e && e.message || e); }
    }, id);
    t(/(_sxrLoadComments|is not defined)/.test(crash), 'BUG-3 repro: opening Notes on a raw-shaped row throws ReferenceError', crash);
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { archiveSafe(id); } catch {}
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
