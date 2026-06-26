// sxr_f1_flag_off_isolation.js — the DEFAULT-OFF flag gate (section F).
// In a FRESH context with NO ?sxr param:
//   • _sxrEnabled()/sxrV2Status().flag is false; the #navSampleReviews nav button
//     stays hidden (display:none); no sxr realtime channel is subscribed;
//   • navigating to #sample-reviews shows the "Samples (Review) is off." view and
//     loads ZERO sample cards — a seeded live sample does NOT appear;
//   • the calendar still works (isolation: samples-off doesn't break the app).
// Control: a context WITH ?sxr=1 reveals the nav + flips the flag true — proving
// the gate is the flag, not a broken build.
//
// Scoped to sidneylaruel; unique sr_f1_* id; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };

(async () => {
  const id = 'sr_f1_' + Date.now();
  const ts = new Date().toISOString();
  // Seed a sample that WOULD render on the SMM samples surface if the flag were on.
  const seed = Q.up({
    id, name: 'F1 flag-off should-not-load', order_index: '1',
    asset_url: 'https://example.com/f1.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval', created_at: ts,
  });
  ok(seed && seed.ok === true, 'seed live sample (would render if sxr were on)', JSON.stringify(seed).slice(0, 120));

  const browser = await Q.launch();
  try {
    // ── flag OFF: fresh context, NO ?sxr param, land on the calendar ──
    const page = await Q.open(browser, '/index.html?v2debug=1#calendar/sidneylaruel');
    await page.waitForTimeout(1500);

    const off = await page.evaluate(() => {
      const st = (window.sxrV2Status && window.sxrV2Status()) || {};
      const nav = document.getElementById('navSampleReviews');
      const navHidden = !nav || nav.offsetParent === null || getComputedStyle(nav).display === 'none';
      let cards = -1, subscribed = null;
      try { cards = (sxrState.cards || []).length; } catch {}
      try { subscribed = st.subscribed; } catch {}
      return { flag: st.flag, navExists: !!nav, navHidden, cards, subscribed };
    });
    ok(off.flag === false, 'sxrV2Status().flag is false with no ?sxr param', off);
    ok(off.navExists === true && off.navHidden === true, 'Samples (Review) nav button is hidden (display:none) when off', off);
    ok(off.subscribed === false, 'no sxr realtime channel subscribed when off', off);
    ok(off.cards === 0, 'no sxr cards loaded when off', off);

    // Navigate to the samples view with the flag off → "off" message, zero cards,
    // the seeded sample does NOT appear.
    const viewOff = await page.evaluate(async (sid) => {
      try { navTo('sample-reviews'); } catch (e) {}
      await new Promise(r => setTimeout(r, 1800));
      const view = document.getElementById('sxrView');
      const txt = view ? view.textContent : '';
      let cards = -1; try { cards = (sxrState.cards || []).length; } catch {}
      const seededInDom = !!document.querySelector(`.sxr-card[data-sxr-id="${sid}"]`);
      return { offMsg: /Samples \(Review\) is off/i.test(txt), cards, seededInDom };
    }, id);
    ok(viewOff.offMsg === true, 'samples view shows "Samples (Review) is off." when flag off', viewOff);
    ok(viewOff.cards === 0 && viewOff.seededInDom === false, 'flag-off samples view loads ZERO cards (seeded sample absent)', viewOff);
    ok(Q.appErrs(page).length === 0, 'no app JS errors (flag off)', JSON.stringify(Q.appErrs(page).slice(0, 6)));
    await page.close();

    // ── control: WITH ?sxr=1 the nav reveals + the flag flips true ──
    const onPage = await Q.open(browser, '/index.html?sxr=1&v2debug=1#calendar/sidneylaruel');
    await onPage.waitForTimeout(1500);
    const on = await onPage.evaluate(() => {
      const st = (window.sxrV2Status && window.sxrV2Status()) || {};
      const nav = document.getElementById('navSampleReviews');
      const navShown = !!nav && getComputedStyle(nav).display !== 'none';
      return { flag: st.flag, navShown };
    });
    ok(on.flag === true, 'control: ?sxr=1 flips the flag true', on);
    ok(on.navShown === true, 'control: ?sxr=1 reveals the Samples (Review) nav button', on);
    ok(Q.appErrs(onPage).length === 0, 'no app JS errors (flag on control)', JSON.stringify(Q.appErrs(onPage).slice(0, 6)));
    await onPage.close();
  } finally {
    Q.archiveSafe(id);
    await browser.close();
  }
  console.log(`PROBE sxr_f1_flag_off_isolation: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
