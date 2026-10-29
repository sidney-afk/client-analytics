'use strict';
/*
 * THE "OPEN THE THUMBNAIL" CARD FITS ITS TILE (supervisor report 2026-10-29, session Linkcheck).
 *
 * On the client link, a Thumbnail step whose thumbnail lives in Frame.io shows "The thumbnail is in Frame.io." and a
 * white "Open the thumbnail" card. At 390 the card's open-in-new icon had no size (the video's own fallback link sizes
 * its icon, this one did not), so the icon filled the card and pushed the label off to the right, clipped ("Ope / thum").
 *
 * In a real browser, fully offline (the review-stage fixture), at 1440x900 and 390x844, light and dark, with and without
 * the client page's polish, this opens the Thumbnail step of a card whose thumbnail is a Frame.io link and asserts:
 *   - the icon in the card is at most 20 px;
 *   - the card sits inside the thumbnail tile;
 *   - the label is shown whole on one line inside the card (nothing clipped).
 * Fails on main.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, cards, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

function state() {
  const list = cards('client');
  list[0].thumbnail_url = 'https://f.io/FixtureThumb1';
  return { cards: list, upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0 };
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const dark of [false, true]) {
        for (const polish of [false, true]) {
          const label = w + 'x' + h + (dark ? ' dark' : ' light') + (polish ? ', polish' : '');
          console.log('--- ' + label + ' ---');
          const t = await open(browser, origin, { stage: 'client', flags: 'on', polish, width: w, height: h, dark, state: state() });
          await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
          await waitNew(t);
          await inS(t.page, '#stepper [data-step="graphic"]').click();
          await inS(t.page, '#tframe a').waitFor({ state: 'visible', timeout: 10000 });
          await sleep(400);
          const m = await t.page.evaluate(() => {
            const r = document.getElementById('svReviewStage').shadowRoot;
            const tile = r.getElementById('bigthumb').getBoundingClientRect();
            const a = r.querySelector('#tframe a'), ab = a.getBoundingClientRect();
            const ib = a.querySelector('svg').getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(a.lastChild);
            const rects = [...range.getClientRects()];
            const tb = range.getBoundingClientRect();
            return { tile: [tile.left, tile.right], card: [ab.left, ab.right], icon: Math.max(ib.width, ib.height), text: a.textContent.trim(),
              lines: rects.length, textIn: tb.left >= ab.left - 0.5 && tb.right <= ab.right + 0.5, over: a.scrollWidth - a.clientWidth };
          });
          expect(m.text === 'Open the thumbnail', label + ': the card says "Open the thumbnail"');
          expect(m.icon <= 20, label + ': the icon is at most 20 px (' + Math.round(m.icon) + ' px)');
          expect(m.card[0] >= m.tile[0] - 0.5 && m.card[1] <= m.tile[1] + 0.5, label + ': the card sits inside the tile (card ' + m.card.map(Math.round) + ', tile ' + m.tile.map(Math.round) + ')');
          expect(m.lines === 1 && m.textIn && m.over <= 0, label + ': the label is whole on one line inside the card (' + m.lines + ' line(s), overflow ' + m.over + ' px)');
          expect(!t.errors.length, label + ': no page errors (' + t.errors.join(' | ') + ')');
          if (process.env.THUMB_FRAME_SHOTS) await t.page.screenshot({ path: process.env.THUMB_FRAME_SHOTS + '/thumb-frame-' + w + (dark ? '-dark' : '-light') + (polish ? '-polish' : '') + '.png' });
          await t.ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-thumb-frame-browser: the "Open the thumbnail" card fits its tile at 1440 and 390, light and dark');
})().catch(e => { console.error(e); process.exit(1); });
