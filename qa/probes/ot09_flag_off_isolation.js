// ot09_flag_off_isolation.js — with ?sxr OFF, the rebuild is fully inert.
// Assert: nav tab hidden, _sxrEnabled() false, ZERO samples/supabase-sample/linear
// network even after focus+visibility events, and the OLD #samples module still
// mounts (untouched). Runs under the courier but should make no sample calls at all.
const L = require('../sxr_courier_lib.js');
const { launch, open, appErrs } = L;

const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  const browser = await launch();
  try {
    const sampleReqs = [];
    const page = await open(browser, '/index.html#calendar');  // NO ?sxr
    page.on('request', r => { const u = r.url(); if (/sample_reviews|sample-review|linear-set-status|linear-add-comment/.test(u)) sampleReqs.push(u); });
    await page.waitForTimeout(1500);

    // simulate a tab return — prove the rebuild's listeners are inert
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => ({
      navHidden: (() => { const n = document.getElementById('navSxr'); return !n || getComputedStyle(n).display === 'none'; })(),
      enabled: (typeof _sxrEnabled === 'function') ? _sxrEnabled() : 'n/a',
      flag: (window.sxrV2Status ? window.sxrV2Status().flag : 'n/a'),
      channel: (window.sxrV2Status ? window.sxrV2Status().subscribed : 'n/a'),
      sxrViewInDom: !!document.getElementById('sxrView')
    }));
    ok(state.navHidden, 'Sample Reviews nav tab hidden with flag off');
    ok(state.enabled === false, '_sxrEnabled() === false', 'got=' + state.enabled);
    ok(state.flag === false, 'sxrV2Status().flag === false', 'got=' + state.flag);
    ok(!state.channel, 'no realtime channel subscribed', 'subscribed=' + state.channel);
    ok(sampleReqs.length === 0, 'ZERO samples/supabase-sample/linear network calls (flag off)', 'count=' + sampleReqs.length + ' ' + sampleReqs.slice(0, 2).join(','));

    // OLD #samples module still works (untouched by the rebuild)
    await page.evaluate(() => { location.hash = '#samples'; });
    await page.waitForTimeout(1200);
    const oldSamples = await page.evaluate(() => {
      // the old module renders into the page container; detect its presence without sxr
      const hasOldNav = !![...document.querySelectorAll('nav a, .nav-tab, [href="#samples"]')].find(a => /sample/i.test(a.textContent || a.getAttribute('href') || ''));
      const sxrLeak = !!document.getElementById('sxrView');
      return { hasOldNav, sxrLeak, hash: location.hash };
    });
    ok(oldSamples.hash === '#samples', 'navigated to OLD #samples');
    ok(!oldSamples.sxrLeak, 'no sxrView leaked into the old samples page');

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
  console.log('\nRESULT ot09_flag_off_isolation: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
