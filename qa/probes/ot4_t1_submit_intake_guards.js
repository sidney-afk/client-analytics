// ot4_t1_submit_intake_guards.js — TIER 1: the Submit intake surface's
// FAIL-CLOSED guards + typed-work preservation (the tier's core promise:
// "may break, but never silently — preserve drafts/receipts"). All through
// the real form on #linear:
//   1) cold open renders the form, 0 JS errors;
//   2) submit with NO client → "Please select a client." and ZERO egress;
//   3) client typed + filming plan unresolved (harness stubs the tabs hook)
//      → "Add or reload the filming plan…" + "No create request was sent."
//      and ZERO egress;
//   4) typed notes survive a hard reload (saveLinearForm draft persistence).
// A belt-and-braces page route blocks any intake/linear create endpoint so
// nothing can reach n8n/Linear even if a guard regressed — a leaked request
// FAILS the probe instead of mutating production.
'use strict';
const H = require('./ot4_lib.js');
const { launch, open, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const NOTES = 'OT4 intake draft notes ' + TS;

(async () => {
  const browser = await launch();
  try {
    const p = await open(browser, '/index.html?v2debug=1#linear');
    const leaks = [];
    await p.route('**/webhook/**', async (route) => {
      const u = route.request().url();
      // READ-shaped lookups the form legitimately makes (projects list, status
      // batches, tab resolution) pass through to the harness courier/stubs.
      if (/linear-projects|linear-issue-statuses|linear-subissues|filming-plan-tabs|linear-filming/i.test(u)) return route.fallback();
      if (/linear|intake|submit|create/i.test(u)) {
        leaks.push(u);
        return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":false,"probe":"blocked"}' });
      }
      return route.fallback();
    });
    await p.waitForFunction(() => !!document.getElementById('linearClientSearch'), { timeout: 20000 });
    t(true, 'cold open: Submit intake form renders (#linear)');

    // 2) submit with no client
    const s1 = await p.evaluate(() => {
      const b = document.getElementById('linearSubmitBtnBoth');
      if (!b) return 'no-btn';
      b.click(); return 'ok';
    });
    t(s1 === 'ok', 'submit clicked with no client selected', s1);
    const msg1 = await p.waitForFunction(() => {
      const el = document.getElementById('linearStatus');
      return el && el.textContent.trim() ? el.textContent.trim() : false;
    }, { timeout: 8000 }).then(h => h.jsonValue()).catch(() => null);
    t(!!msg1 && /select a client/i.test(msg1), 'guard 1 announced: "Please select a client."', msg1);
    t(leaks.length === 0, 'guard 1: zero create/intake egress', leaks[0]);

    // 3) type the client, leave the filming plan unresolved, submit
    const typedClient = await p.evaluate(() => {
      const inp = document.getElementById('linearClientSearch');
      if (!inp) return 'no-input';
      inp.focus(); inp.value = 'Sidney Laruel';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    });
    t(typedClient === 'ok', 'client typed into the real search field', typedClient);
    await H.sleep(1200);
    await p.evaluate(() => {
      const hit = [...document.querySelectorAll('#linearSearchResults *')].find(e => /sidney laruel/i.test(e.textContent || '') && e.matches('[onclick],button,.linear-search-item,[class*="item"]'));
      if (hit) hit.click();
    });
    await H.sleep(1500);
    const s2 = await p.evaluate(() => { const b = document.getElementById('linearSubmitBtnBoth'); if (!b || b.disabled) return 'disabled'; b.click(); return 'ok'; });
    t(s2 === 'ok', 'submit clicked with client set + plan unresolved', s2);
    const msg2 = await p.waitForFunction(() => {
      const el = document.getElementById('linearStatus');
      const tx = el ? el.textContent.trim() : '';
      return /filming plan/i.test(tx) ? tx : false;
    }, { timeout: 10000 }).then(h => h.jsonValue()).catch(() => null);
    t(!!msg2 && /add or reload the filming plan/i.test(msg2), 'guard 2 announced: filming plan required', msg2);
    t(!!msg2 && /no create request was sent/i.test(msg2), 'guard 2 says explicitly that nothing was sent', msg2);
    t(leaks.length === 0, 'guard 2: zero create/intake egress', leaks[0]);

    // 4) typed notes survive a hard reload
    const noted = await p.evaluate((txt) => {
      const ta = document.getElementById('linearNotes');
      if (!ta) return 'no-notes';
      ta.focus();
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, txt); ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    }, NOTES);
    t(noted === 'ok', 'notes typed into the real textarea', noted);
    await H.sleep(800);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!document.getElementById('linearNotes'), { timeout: 20000 });
    const kept = await p.evaluate(() => (document.getElementById('linearNotes') || { value: '' }).value);
    t((kept || '').includes('OT4 intake draft notes'), 'typed notes survive a hard reload (draft preserved)', (kept || '').slice(0, 60));

    t(appErrs(p).length === 0, '0 app JS errors across the intake session', (appErrs(p)[0] || ''));
    t(leaks.length === 0, 'FINAL: zero requests ever left toward create/intake endpoints', leaks[0]);
    // scrub the local draft so the next visitor starts clean
    await p.evaluate(() => { try { localStorage.removeItem('linearFormDraft'); } catch (e) {} try { Object.keys(localStorage).filter(k => /linear.*form|linear.*draft/i.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {} });
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
