'use strict';
/*
 * FINISH REVIEWING DRAWS THE EYE WHEN EVERY PART IS ANSWERED (owner feedback 2026-10-17 23:40, session Curtain Nine).
 *
 * In a real browser, fully offline (the review-stage fixture), on the client page and the SMM's Review tab:
 *   - while a part still waits, Finish reviewing is quiet (no glow);
 *   - once the last part is answered it carries a soft ring that breathes slowly (three times, then stays still);
 *   - a redraw (another step clicked) does not restart the breathing;
 *   - with reduced motion there is no breathing, only the still ring.
 * Fails on main (no glow).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const look = page => page.evaluate(() => {
  const b = document.getElementById('svReviewStage').shadowRoot.getElementById('finishBtn');
  if (!b) return null;
  const a = b.getAnimations ? b.getAnimations().find(x => x.animationName === 'finGlow') : null;
  return { ready: b.classList.contains('ready'), disabled: b.disabled, anim: getComputedStyle(b).animationName, t: a ? (c => (c.currentIteration + c.progress) * 2400)(a.effect.getComputedTiming()) : -1, state: a ? a.playState : '', shadow: getComputedStyle(b).boxShadow };
});

async function openOne(browser, origin, who, reduced) {
  const t = await open(browser, origin, Object.assign({ stage: who === 'smm' ? 'smm' : 'client', flags: 'on' }, who === 'smm' ? { staff: STAFF } : {}));
  if (reduced) await t.page.emulateMedia({ reducedMotion: 'reduce' });
  // only the first post's video waits (the fixture saves that one)
  t.state.cards[0].graphic_status = 'Approved'; t.state.cards[0].caption_status = 'Approved';
  if (who === 'smm') {
    await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
    await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
    await t.page.evaluate(() => onCalViewChange('smmreview'));
  } else {
    await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  }
  await waitNew(t);
  await sleep(1500);
  return t;
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const who of ['client', 'smm']) {
      console.log('--- ' + who + ' ---');
      let t = await openOne(browser, origin, who, false);
      let f = await look(t.page);
      expect(f && f.disabled && !f.ready && f.anim === 'none', who + ': while a part waits, Finish is quiet (' + JSON.stringify(f) + ')');
      await inS(t.page, '[data-ok="video"]').click();
      await sleep(1200);
      f = await look(t.page);
      expect(f && !f.disabled && f.ready && f.anim === 'finGlow' && f.state === 'running', who + ': once every part is answered, Finish breathes (' + JSON.stringify(f) + ')');
      const t1 = f ? f.t : -1;
      await inS(t.page, '.stp').first().click();   // a redraw
      await sleep(700);
      f = await look(t.page);
      expect(f && f.ready && f.t > t1 + 400, who + ': a redraw does not restart it (' + Math.round(t1) + ' ms, then ' + Math.round(f ? f.t : -1) + ' ms)');
      await sleep(7000);
      f = await look(t.page);
      expect(f && f.ready && f.state === 'finished' && /0px 0px 0px 3px/.test(f.shadow), who + ': after three slow breaths it stays still with its ring (' + (f && f.state) + ')');
      expect(t.errors.length === 0, who + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();

      t = await openOne(browser, origin, who, true);
      await inS(t.page, '[data-ok="video"]').click();
      await sleep(1200);
      f = await look(t.page);
      expect(f && f.ready && f.state !== 'running' && /0px 0px 0px 3px/.test(f.shadow), who + ', reduced motion: a still ring, no breathing (' + JSON.stringify(f && { state: f.state, shadow: f.shadow }) + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview stage Finish glow: all passed');
})().catch(e => { console.error(e); process.exit(1); });
