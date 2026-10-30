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
 *   - at 320 wide the open step ("Caption") was cut off at the right of the step bar; now the open step is in view;
 *   - on Sheet, Month and Week, no header button covers another: the round buttons, the tabs and the calendar tools
 *     slotted into the header (the phone's More button) each keep their own place (Codex review on PR 2462);
 *   - on Sheet at tablet widths (768, 820) the Organize menu, laid out from its button's left edge, ran 17 px past the
 *     window: closed, it gave the page a sideways scroll; open, it was cut off. It now opens right-aligned under the
 *     button, inside the window.
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
        const t = await openClient(browser, origin, { flags: 'on', width: w, height: h, tab: 'review', finished: true, extraCards: 6, help: 'https://help.fixture.test/review', context: { colorScheme: dark ? 'dark' : 'light' } });
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
        // Sheet, Month and Week: nothing in the header covers anything else, the slotted tools included.
        for (const v of ['organizer', 'month', 'week', 'review']) {
          await t.page.evaluate(x => onCalViewChange(x), v);
          await t.page.waitForFunction(x => typeof calState === 'object' && calState.view === x, v, { timeout: 15000 });
          await sleep(900);
          const H = await t.page.evaluate(() => {
            const host = document.getElementById('svReviewStage'), r = host.shadowRoot;
            const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
            const items = [['help', r.getElementById('rsHelp')], ['theme', r.getElementById('rsTheme')], ['tabs', r.getElementById('rsTabs')], ['name', r.getElementById('rsName')]];
            for (const el of host.querySelectorAll('[slot="tools"] button, [slot="tools"] [role="button"], [slot="tools"] a')) items.push(['tool:' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20), el]);
            const boxes = items.filter(([, el]) => vis(el)).map(([n, el]) => { const b = el.getBoundingClientRect(); return [n, b.left, b.top, b.right, b.bottom]; });
            const hits = [];
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i], b = boxes[j];
              if (a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5 && a[2] < b[4] - 0.5 && b[2] < a[4] - 0.5) hits.push(a[0] + ' x ' + b[0]);
            }
            const se = document.scrollingElement;
            return { hits, n: boxes.length, tools: boxes.filter(b => /^tool/.test(b[0])).length, sideways: se.scrollWidth > se.clientWidth };
          });
          expect(!H.hits.length, label + ' ' + v + ': no header button covers another, slotted tools included (' + H.n + ' boxes, ' + H.tools + ' tools; ' + H.hits.join(', ') + ')');
          expect(!H.sideways, label + ' ' + v + ': no sideways page scroll');
          // Sheet: the Organize menu, when it is in the header, opens inside the window.
          if (v === 'organizer' && await t.page.evaluate(() => { const b = document.getElementById('calOrganizeBtn'); return !!b && b.getClientRects().length > 0 && !!b.closest('#svReviewStage'); })) {
            await t.page.locator('#calOrganizeBtn').click();
            await sleep(400);
            const M = await t.page.evaluate(() => { const m = document.getElementById('calOrganizeMenu'); const b = m.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), vis: getComputedStyle(m).visibility, w: innerWidth }; });
            expect(M.vis === 'visible' && M.l >= 0 && M.r <= M.w, label + ': the open Organize menu is inside the window (' + JSON.stringify(M) + ')');
            await t.page.keyboard.press('Escape');
            await sleep(300);
          }
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
