'use strict';
/*
 * THE CLIENT LINK'S HEADER AND STRIP ON EVERY WIDTH (session Nightclient, 2026-10-30, OPEN_REPAIRS 612).
 * Real browser, fully offline, the same mocked backend as review-stage-browser.js (fictional client, cards and token).
 * Found walking the live test client's link at 1440, 1024, 768, 430, 390 and 320 wide:
 *   - picking a post far along the "waiting for you" strip scrolled it only part way: its picture and the start of
 *     its name sat hidden off the strip's left edge (the scroll was measured from the strip's parent, not the strip);
 *     now the picked post is wholly inside the strip;
 *   - on a phone the "Review" tab's count spilled out of its white pill (390 wide) and ran into "Sheet" (320 wide);
 *     now every tab's words and count sit inside its own button, and no two buttons overlap;
 *   - at 320 wide the open step ("Caption") was cut off at the right of the step bar; now the open step is in view.
 * Light and dark; no sideways page scroll at any width.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

function measure(page) {
  return page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const box = el => el.getBoundingClientRect();
    const sl = r.getElementById('skList');
    const cur = sl.querySelector('.chipp.cur');
    const L = box(sl), C = cur ? box(cur) : null;
    const tabs = Array.from(r.querySelectorAll('#rsTabs .cal-view-btn')).map(b => {
      const B = box(b);
      const kids = Array.from(b.querySelectorAll('*')).map(box);
      const rng = document.createRange(); rng.selectNodeContents(b); const T = rng.getBoundingClientRect();
      const inside = [T].concat(kids).every(k => k.left >= B.left - 0.5 && k.right <= B.right + 0.5);
      return { tab: b.dataset.tab, left: B.left, right: B.right, inside };
    });
    let overlap = false;
    for (let i = 1; i < tabs.length; i++) if (tabs[i].left < tabs[i - 1].right - 0.5) overlap = true;
    const stp = r.getElementById('stepper'), on = stp && stp.querySelector('.stp.on, .stp[aria-current="step"], .stp.cur');
    const S = stp ? box(stp) : null, O = on ? box(on) : null;
    const se = document.scrollingElement;
    return {
      chipIn: !!C && C.left >= L.left - 0.5 && C.right <= L.right + 0.5, chip: C && [Math.round(C.left), Math.round(C.right)], list: [Math.round(L.left), Math.round(L.right)],
      tabs, overlap,
      stepIn: !O || (O.left >= S.left - 0.5 && O.right <= S.right + 0.5), step: O && [Math.round(O.left), Math.round(O.right)], stepper: S && [Math.round(S.left), Math.round(S.right)],
      sideways: se.scrollWidth > se.clientWidth,
    };
  });
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [430, 932], [390, 844], [320, 640]]) {
      for (const dark of [false, true]) {
        const label = w + (dark ? ' dark' : ' light');
        const t = await openClient(browser, origin, { flags: 'on', width: w, height: h, tab: 'review', extraCards: 6, help: 'https://help.fixture.test/review', context: { colorScheme: dark ? 'dark' : 'light' } });
        await waitNew(t);
        await sleep(900);
        let M = await measure(t.page);
        expect(!M.overlap && M.tabs.every(x => x.inside), label + ': every tab\'s words and count sit inside its own button, none overlap (' + JSON.stringify(M.tabs.map(x => [x.tab, Math.round(x.left), Math.round(x.right), x.inside])) + ')');
        expect(M.stepIn, label + ': the open step is inside the step bar (' + M.step + ' in ' + M.stepper + ')');
        // Open the last step the way the page does when the first two are already answered (a click with no scroll).
        await t.page.evaluate(() => document.getElementById('svReviewStage').shadowRoot.querySelector('.stp[data-step="caption"]').click());
        await sleep(600);
        M = await measure(t.page);
        expect(M.stepIn, label + ': the Caption step, once open, is inside the step bar (' + M.step + ' in ' + M.stepper + ')');
        expect(!M.sideways, label + ': no sideways page scroll');
        // Pick posts far along the strip, one after another, by clicking their chips (as a client does): each chip is
        // scrolled to sit just inside the strip's right edge first, where the strip used to over-scroll it.
        const ids = await t.page.evaluate(() => Array.from(document.getElementById('svReviewStage').shadowRoot.querySelectorAll('#skList .chipp[data-id]')).map(c => c.dataset.id));
        for (const id of [ids[5], ids[ids.length - 2], ids[3]]) {
          await t.page.evaluate(id => { const sl = document.getElementById('svReviewStage').shadowRoot.getElementById('skList'); const c = sl.querySelector('[data-id="' + id + '"]'); const d = c.getBoundingClientRect().right - sl.getBoundingClientRect().right; sl.scrollLeft += d + 2; }, id);
          await t.page.locator('#svReviewStage').locator('#skList .chipp[data-id="' + id + '"]').click();
          await sleep(700);
          M = await measure(t.page);
          expect(M.chipIn, label + ': the picked post ' + id + ' is wholly inside the strip (' + M.chip + ' in ' + M.list + ')');
        }
        expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
        await t.ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-client-strip-tabs-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-client-strip-tabs-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
