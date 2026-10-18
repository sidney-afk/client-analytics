'use strict';
/*
 * SMALL FIXES ON THE CLIENT LINK (session Curtain Ten, 2026-10-18; card gauntlet, client side, "Other" 1, 3 and 4).
 *   1. The vertical player at 1440x900 and on a 390 phone keeps Full screen (the speed button gives way).
 *   2. Browser Back after switching tabs goes back a tab and stays on the page; Forward comes back.
 *   3. Escape closes the client Sheet's Notes panel even while its message box has focus.
 * In a real browser, fully offline (the review-stage fixture).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const shown = (t, sel) => t.page.evaluate(s => { const e = document.getElementById('svReviewStage').shadowRoot.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && b.width > 0 ? Math.round(b.width) : 0; }, sel);
const view = t => t.page.evaluate(() => calState.view);

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      console.log('--- the vertical player at ' + w + 'x' + h + ' ---');
      const t = await openClient(browser, origin, { flags: 'on', width: w, height: h });
      await waitNew(t);
      await t.page.waitForFunction(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('.fv-player .fv-full'), null, { timeout: 15000 });
      await sleep(1200);
      const pw = await shown(t, '.fv-player');
      expect(pw > 0 && pw < 300, w + ': the vertical player is narrower than 300 px (' + pw + ' px)');
      expect(await shown(t, '.fv-full') > 0, w + ': Full screen is there');
      expect(!(await shown(t, '.fv-rate')), w + ': the speed button gives way');
      expect(await shown(t, '.fv-play') === 44, w + ': the play button keeps its size');
      expect(!t.errors.length, w + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- Back and Forward between tabs ---');
    let t = await openClient(browser, origin, { flags: 'on', finished: true });
    await waitNew(t);
    await sleep(800);
    const url = t.page.url();
    await inS(t.page, '#rsTabs [data-tab="organizer"]').click();
    await sleep(800);
    await inS(t.page, '#rsTabs [data-tab="month"]').click();
    await sleep(800);
    expect(await view(t) === 'month', 'Month is open');
    await t.page.goBack();
    await sleep(800);
    expect(t.page.url() === url && await view(t) === 'organizer', 'Back goes back to Sheet, on the same page (' + await view(t) + ')');
    await t.page.goBack();
    await sleep(800);
    expect(t.page.url() === url && await view(t) === 'review', 'Back again goes back to Review (' + await view(t) + ')');
    await t.page.goForward();
    await sleep(800);
    expect(await view(t) === 'organizer', 'Forward comes back to Sheet (' + await view(t) + ')');
    expect(!t.errors.length, 'tabs: no page errors (' + t.errors.join(' | ') + ')');

    console.log('--- Escape in the Notes panel on the Sheet ---');
    await t.page.locator('[data-comments-btn="rf1"]').first().click();
    await t.page.waitForSelector('#calCommentsOverlay.open', { timeout: 10000 });
    await sleep(400);
    const focused = await t.page.evaluate(() => (document.activeElement || {}).id || (document.activeElement || {}).tagName);
    await t.page.locator('#calCommentComposer').focus();
    await t.page.locator('#calCommentComposer').fill('A note I will finish later');
    await t.page.keyboard.press('Escape');
    await sleep(400);
    expect(!(await t.page.locator('#calCommentsOverlay.open').count()), 'Escape closes the Notes panel with the message box focused (it opened on ' + focused + ')');
    expect(await view(t) === 'organizer', 'and the Sheet stays open');
    expect(!t.errors.length, 'notes: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
