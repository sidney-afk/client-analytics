'use strict';
/*
 * PLACEHOLDER TO CONTENT IS A FADE (session Lantern, 2026-10-18). Refreshes staff pages in a real browser, fully
 * offline (fictional staff member and client from the review page's fixture), logs every frame, and fails when the
 * page's content replaces its grey placeholder at full strength in one frame (a hard swap). With reduced motion the
 * content appears at once (no fade). Spinners and shimmers read one speed (test/loading-family.js holds the styles).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const fx = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const FRAME_LOG = () => {
  window.__fpLog = [];
  let n = 0;
  const tick = () => {
    const c = document.getElementById('content');
    if (c) {
      const fading = Array.from(c.querySelectorAll('*')).filter(el => Number(getComputedStyle(el).opacity) < 0.99 && el.getAnimations && el.getAnimations().some(a => a.animationName === 'sv-fade-in'));
      window.__fpLog.push({ t: Math.round(performance.now()), skel: c.querySelectorAll('.sv-skeleton').length, fading: fading.length, op: fading.length ? Math.min(...fading.map(el => Number(getComputedStyle(el).opacity))) : 1 });
    }
    if (++n < 400) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [hash, reduce] of [['kasper', false], ['today', false], ['kasper', true]]) {
      const name = hash + (reduce ? ' (reduced motion)' : '');
      console.log('--- refresh ' + name + ' ---');
      const t = await fx.open(browser, origin, { stage: 'smm', staff: fx.STAFF, dark: true });
      if (reduce) await t.page.emulateMedia({ reducedMotion: 'reduce' });
      await t.page.goto(origin + '/index.html#' + hash, { waitUntil: 'load' });
      await fx.sleep(2000);
      await t.page.addInitScript(FRAME_LOG);
      await t.page.reload({ waitUntil: 'load' });
      await fx.sleep(2000);
      const log = await t.page.evaluate(() => window.__fpLog || []);
      const sawSkel = log.some(f => f.skel);
      const fades = log.filter(f => f.fading);
      expect(sawSkel, name + ': a grey placeholder showed first');
      if (reduce) expect(!fades.length, name + ': no fade with reduced motion (' + fades.length + ' frame(s))');
      else {
        expect(fades.length >= 3, name + ': the content fades in over several frames (' + fades.length + ')');
        expect(fades.length && fades[0].op < 0.5, name + ': the fade starts faint (' + (fades[0] ? fades[0].op.toFixed(2) : '-') + ')');
      }
      const last = log[log.length - 1] || {};
      expect(last.op === 1 && !last.fading, name + ': the content ends at full strength');
      expect(!(await t.page.locator('#content > .sv-fade-in').count()), name + ': the fade class is removed when the fade ends');
      expect(t.errors.length === 0, name + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nloading-fade-browser: all passed');
})();
