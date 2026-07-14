// sxr_bug_repros.js — REGRESSION guards for BUG-3 and BUG-4 (fixed 2026-07-02;
// see qa/OVERNIGHT_TEST_REPORT.md RUN 2). Originally characterization probes
// that passed WHILE the bugs existed; now flipped to assert the FIX holds:
//   BUG-3: _sxrLoadComments is defined and opening Notes on a raw-shaped row
//          does NOT throw.
//   BUG-4: the copied share URL carries &t=<token> returned by the
//          staff-authenticated client-review-link issuer.
// All in-page; no client-config rows or live issuer state are mutated.
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

    // ---- BUG-4 FIX: _sxrCopyShareLink awaits the authenticated issuer ----
    // Stub only the staff identity + issuer response and capture the clipboard.
    // This deliberately never puts a token in the public clientMap or calls the
    // live issuer.
    const share = await page.evaluate(async () => {
      let captured = '';
      let capability = '';
      const issuerCalls = [];
      const realRequire = _syncviewRequireStaffIdentity;
      const realFetch = window.fetch;
      const ownClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      try {
        _syncviewRequireStaffIdentity = async requested => {
          capability = requested;
          return { key: 'SYNTHETIC_PROBE_ROLE_KEY', member: { id: 'probe-member', name: 'Probe SMM' } };
        };
        window.fetch = async (url, options) => {
          if (String(url) !== String(CLIENT_REVIEW_LINK_URL)) return realFetch(url, options);
          issuerCalls.push({
            url: String(url),
            headers: Object.assign({}, options && options.headers),
            body: JSON.parse(String(options && options.body || '{}'))
          });
          return { ok: true, status: 200, json: async () => ({ ok: true, slug: 'sidneylaruel', token: 'TESTTOKEN123' }) };
        };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => { captured = s; return Promise.resolve(); } } });
        await _sxrCopyShareLink();
      } catch (e) { captured = 'ERR:' + (e && e.message); }
      finally {
        _syncviewRequireStaffIdentity = realRequire;
        window.fetch = realFetch;
        if (ownClipboard) Object.defineProperty(navigator, 'clipboard', ownClipboard);
        else delete navigator.clipboard;
      }
      return { captured, capability, issuerCalls };
    });
    const issued = share.issuerCalls[0] || {};
    t(share.capability === 'review-link'
      && share.issuerCalls.length === 1
      && issued.headers && issued.headers['X-Syncview-Key'] === 'SYNTHETIC_PROBE_ROLE_KEY'
      && issued.headers['X-Syncview-Actor'] === 'Probe SMM'
      && issued.body && issued.body.member_id === 'probe-member' && !!issued.body.slug
      && /[?&]t=TESTTOKEN123\b/.test(share.captured),
    'BUG-4 FIX: share URL carries the token from one staff-authenticated issuer request', share.captured);
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
