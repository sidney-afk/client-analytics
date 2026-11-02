'use strict';
/*
 * A VIDEO THE REVIEW PAGE IS LEAVING NEVER ASKS FOR A NEW ADDRESS (session Trialchange, 2026-11-02).
 *
 * The review page's player re-asks frameio-view for a fresh address when its video errors (187 _fvStageFailed: try
 * the smaller file, then ask for a new address once). The phone review lane went red on WebKit with "Fetch API
 * cannot load .../frameio-view due to access control checks" from exactly that re-ask, about a second after the last
 * approval, as the page moved on to the next card (#2507 / #2513 diagnostics). A video that is no longer in the
 * page, or whose card is no longer the one on stage, has nobody watching it: re-asking for it is wasted work, and
 * that wasted request is the one WebKit reported. This is expected, not yet proven, to stop the WebKit red.
 *
 * In a real Chromium, fully offline (the review-stage fixture), on a client link's Review:
 *   A. the player is taken out of the page and its video then errors twice (the first error tries the smaller file,
 *      the second would re-ask): no frameio-view request follows;
 *   B. the stage moves to another card, and the previous card's video then errors twice: no re-ask for it;
 *   C. control: the player stays in the page and its video errors twice: it still re-asks once, as it should.
 * A fails on main (one frameio-view request for the removed video). B passes on main too (the card switch already
 * replaced the stage video): it guards the explicit "another card" rule. C is the control.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let checks = 0;
function expect(value, message) { checks++; if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function ready(t) {
  await t.page.waitForFunction(() => document.getElementById('svReviewStage')?.shadowRoot?.querySelector('.fv-player')?.dataset.state === 'ready', null, { timeout: 30000 });
  await sleep(500);
}
function countAddressAsks(t) {
  const asks = [];
  t.page.on('request', r => { if (/\/functions\/v1\/frameio-view/.test(r.url()) && r.method() === 'POST') asks.push(r.postData() || ''); });
  return asks;
}
// Two error events on a video: the first moves it to the smaller file, the second is the one that would re-ask.
const twoErrors = 'for (let i = 0; i < 2; i++) { v.dispatchEvent(new Event("error")); await new Promise(r => setTimeout(r, 150)); }';

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // A. Taken out of the page.
    {
      const t = await openClient(browser, origin, { flags: 'on' });
      await ready(t);
      const asks = countAddressAsks(t);
      await t.page.evaluate(new Function('return (async () => { const sr = document.getElementById("svReviewStage").shadowRoot; const v = sr.querySelector("video"); const h = sr.getElementById("fvHost") || v.closest(".fv-player").parentElement; h.remove(); ' + twoErrors + ' })()'));
      await sleep(1200);
      expect(asks.length === 0, 'A. a video taken out of the page asks for no new address (' + asks.length + ' asked)');
      await t.ctx.close();
    }
    // B. The stage has moved to another card.
    {
      const t = await openClient(browser, origin, { flags: 'on' });
      await ready(t);
      const asks = countAddressAsks(t);
      await t.page.evaluate(() => { window.__leaving = document.getElementById('svReviewStage').shadowRoot.querySelector('video'); });
      const moved = await t.page.evaluate(() => { const sr = document.getElementById('svReviewStage').shadowRoot; const chip = Array.from(sr.querySelectorAll('.chipp[data-id]')).find(c => !c.classList.contains('cur')); if (!chip) return ''; chip.click(); return chip.dataset.id; });
      expect(!!moved, 'B. the strip offers another card to move to (' + moved + ')');
      await ready(t);
      const before = asks.length;
      const same = await t.page.evaluate(() => document.getElementById('svReviewStage').shadowRoot.querySelector('video') === window.__leaving);
      // If the page kept the same element for the new card, B says nothing about leaving: report it plainly.
      expect(!same, 'B. the new card plays in a new video element (the previous one is the one leaving)');
      await t.page.evaluate(new Function('return (async () => { const v = window.__leaving; ' + twoErrors + ' })()'));
      await sleep(1200);
      expect(asks.length === before, 'B. the previous card\'s video asks for no new address after the stage moved (' + (asks.length - before) + ' asked)');
      await t.ctx.close();
    }
    // C. Control: the player on stage still recovers.
    {
      const t = await openClient(browser, origin, { flags: 'on' });
      await ready(t);
      const asks = countAddressAsks(t);
      await t.page.evaluate(new Function('return (async () => { const v = document.getElementById("svReviewStage").shadowRoot.querySelector("video"); ' + twoErrors + ' })()'));
      await sleep(1500);
      expect(asks.length === 1, 'C. the video on stage still asks for a new address once after its errors (' + asks.length + ' asked)');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`review-stage-player-leaving-browser: ${checks} checks, ${failures.length} failures`);
  if (failures.length) process.exit(1);
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
