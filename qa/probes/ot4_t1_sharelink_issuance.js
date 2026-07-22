// ot4_t1_sharelink_issuance.js — TIER 0/1: SHARE-LINK ISSUANCE (the
// client-review-link flow staff use to mint the links clients depend on),
// via the REAL kebab → "Share with client" control on the SMM calendar.
//   A) DENY, fail-closed: with NO staff identity the click produces the
//      sign-in error toast, NO clipboard write, and NO issuance request.
//   B) ISSUE (EF MOCKED — no real token minted): with a seeded staff identity
//      (key-verify mocked ok) the click sends X-Syncview-Key to the issuance
//      EF and copies a URL of exactly the promised shape
//      (?c=<client>&v=calendar&t=<token>).
//   C) The minted URL actually LOADS as a client link (calendar renders,
//      0 app JS errors).
// No real client-review-link EF call is ever made (both paths intercepted).
'use strict';
const H = require('./ot4_lib.js');
const { launch, open, smmCal, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();

async function clickShare(p) {
  await p.waitForFunction(() => !!document.querySelector('.cal-kebab'), { timeout: 20000 });
  await p.click('.cal-kebab');
  await H.sleep(300);
  return p.evaluate(() => {
    const item = [...document.querySelectorAll('#calKebabMenu .cal-kebab-item')].find(b => /share with client/i.test(b.textContent));
    if (!item) return 'no-share-item';
    item.click(); return 'ok';
  });
}
const CLIP_STUB = () => {
  window.__ot4Copied = null;
  try {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (s) => { window.__ot4Copied = String(s); return Promise.resolve(); } }, configurable: true
    });
  } catch (e) {}
};

(async () => {
  const browser = await launch();
  try {
    // ---- A) DENY without staff identity -----------------------------------
    {
      const p = await smmCal(browser);
      await p.evaluate(CLIP_STUB);
      let issuanceCalled = false;
      p.on('request', r => { if (r.url().includes('client-review-link')) issuanceCalled = true; });
      const clicked = await clickShare(p);
      t(clicked === 'ok', 'A: kebab → "Share with client" clicked (signed out)', clicked);
      const toast = await p.waitForFunction(() => {
        const el = document.querySelector('.sv-toast');
        return el && el.textContent.trim() ? el.textContent.trim() : false;
      }, { timeout: 10000 }).then(h => h.jsonValue()).catch(() => null);
      t(!!toast && /sign in with your staff account/i.test(toast), 'A: fail-closed sign-in error is announced', toast);
      const copied = await p.evaluate(() => window.__ot4Copied);
      t(copied === null, 'A: nothing was copied to the clipboard', copied);
      t(!issuanceCalled, 'A: no issuance request left the page');
      t(appErrs(p).length === 0, 'A: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- B) ISSUE with mocked EFs -----------------------------------------
    let mintedUrl = null;
    {
      const ctxSeed = (ts) => {
        try {
          localStorage.setItem('syncview_staff_identity_v1', JSON.stringify({
            key: 'ot4-qa-key', role: 'smm',
            member: { id: 'ot4-qa', name: 'OT4 QA', role: 'smm', team: null },
            verified_at: new Date(ts).toISOString()
          }));
        } catch (e) {}
      };
      const p = await smmCal(browser, 'sidneylaruel', {});
      // seed identity + stubs BEFORE the app verifies: reload after wiring.
      await p.context().route('**/functions/v1/key-verify*', (route) => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: JSON.stringify({ ok: true, role: 'smm', member: { id: 'ot4-qa', name: 'OT4 QA', role: 'smm', team: null } })
      }));
      let sawKeyHeader = null;
      await p.context().route('**/functions/v1/client-review-link*', (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' }, body: '' });
        sawKeyHeader = req.headers()['x-syncview-key'] || null;
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, client: 'sidneylaruel', token: 'ot4-mock-token-' + TS }) });
      });
      await p.evaluate(ctxSeed, TS);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => typeof calState === 'object' && !!calState.client, { timeout: 20000 }).catch(() => {});
      await H.sleep(1500);
      await p.evaluate(CLIP_STUB);
      const clicked = await clickShare(p);
      t(clicked === 'ok', 'B: kebab → "Share with client" clicked (signed in)', clicked);
      const copied = await p.waitForFunction(() => window.__ot4Copied, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
      t(!!copied, 'B: a link was copied to the clipboard', copied);
      mintedUrl = copied;
      t(!!sawKeyHeader && sawKeyHeader === 'ot4-qa-key', 'B: issuance request carried X-Syncview-Key', sawKeyHeader);
      if (copied) {
        const u = new URL(copied);
        t(u.searchParams.get('c') === 'Sidney Laruel', 'B: link carries c=Sidney Laruel', u.searchParams.get('c'));
        t(u.searchParams.get('v') === 'calendar', 'B: link carries v=calendar', u.searchParams.get('v'));
        t(u.searchParams.get('t') === 'ot4-mock-token-' + TS, 'B: link carries the issued token');
      }
      const toast = await p.evaluate(() => (document.querySelector('.sv-toast') || { textContent: '' }).textContent);
      t(/copied/i.test(toast), 'B: success is announced ("copied")', toast);
      t(appErrs(p).length === 0, 'B: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- C) the minted link loads as a client surface ---------------------
    if (mintedUrl) {
      const qs = new URL(mintedUrl).search;
      const p = await open(browser, '/index.html' + qs, {
        syntheticClientEntry: {
          slug: 'sidneylaruel',
          displayName: 'Sidney Laruel',
          token: 'ot4-mock-token-' + TS,
          view: 'calendar',
        },
      });
      await H.sleep(4000);
      const st = await p.evaluate(() => ({
        clientLink: (() => { try { return !!_isClientLink; } catch (e) { return 'n/a'; } })(),
        calLoaded: (() => { try { return typeof calState === 'object' && Array.isArray(calState.posts); } catch (e) { return false; } })(),
      }));
      t(st.clientLink === true, 'C: minted URL boots as a CLIENT link', String(st.clientLink));
      t(st.calLoaded, 'C: client calendar state loads');
      t(appErrs(p).length === 0, 'C: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    } else {
      t(false, 'C: skipped — no minted URL from part B');
    }
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
