'use strict';
/*
 * THE REVIEW PAGE'S SKELETON HAS THE SHAPE OF WHAT LOADS (owner feedback 2026-10-17 23:40, session Curtain Nine).
 *
 * In a real browser, fully offline (the review-stage fixture, the card read answered slowly), on a switched-on
 * client link's Review at 1440 and 390 wide: while the cards load, the new page draws its own placeholders (the old
 * calendar's loader does not show), and each placeholder sits where the real part lands, at its size, within a few
 * pixels: a strip chip, the post title, the step bar, the media box (a video's shape), the buttons, the conversation.
 * Fails on main (no skeleton: the header and the old loader).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const TOL = 6;

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      console.log('--- client link, Review, ' + w + ' wide ---');
      const t = await openClient(browser, origin, { flags: 'on', postsDelay: 4000, width: w, height: h });
      const r = sel => t.page.evaluate(s => { const hh = document.getElementById('svReviewStage'); const e = hh && hh.shadowRoot && hh.shadowRoot.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); }, sel);
      const got = await t.page.waitForFunction(() => { const hh = document.getElementById('svReviewStage'); return !!(hh && !hh.hidden && hh.shadowRoot && hh.shadowRoot.querySelector('.app.skel')); }, null, { timeout: 15000 }).then(() => true, () => false);
      expect(got, w + ': while the cards load, the review page draws its skeleton');
      await sleep(400);
      const oldLoader = await t.page.evaluate(() => { const c = document.getElementById('calView'); return !!(c && c.offsetParent && c.querySelector('.cal-loader')); });
      expect(!oldLoader, w + ': the old calendar loader does not show under it');
      const say = await t.page.evaluate(() => { const rr = document.getElementById('svReviewStage').shadowRoot; const st = rr.getElementById('skSay'); return { busy: rr.getElementById('rsApp').getAttribute('aria-busy'), role: st && st.getAttribute('role'), text: st && st.textContent }; });
      expect(say.busy === 'true' && say.role === 'status' && /Loading/.test(say.text || ''), w + ': screen readers hear it is loading (' + JSON.stringify(say) + ')');
      const parts = { chip: '#skList .chipp', title: '#side h2', step: '#stepper li:first-child > *', dec: '#drow .dec', chat: '#chat', date: '#sdate' };
      const before = {};
      for (const [k, s] of Object.entries(parts)) before[k] = await r(s);
      before.media = await r('#skMedia');
      await t.page.waitForFunction(() => { const rr = document.getElementById('svReviewStage').shadowRoot; return !rr.querySelector('.app.skel') && rr.querySelector('#stepper button'); }, null, { timeout: 20000 });
      await sleep(1500);
      const after = {};
      for (const [k, s] of Object.entries(parts)) after[k] = await r(s);
      after.media = await r('#fvHost .fv-player');
      for (const k of Object.keys(after)) {
        const a = before[k], b = after[k];
        const close = a && b && Math.abs(a[0] - b[0]) <= TOL && Math.abs(a[1] - b[1]) <= TOL && (k === 'title' || k === 'step' ? true : Math.abs(a[2] - b[2]) <= TOL) && Math.abs(a[3] - b[3]) <= TOL;
        expect(close, w + ': the ' + k + ' placeholder sits where it lands, at its size (' + JSON.stringify(a) + ' then ' + JSON.stringify(b) + ')');
      }
      expect(!(await r('#skMedia')), w + ': the placeholders are gone once loaded');
      const after2 = await t.page.evaluate(() => { const rr = document.getElementById('svReviewStage').shadowRoot; return { busy: rr.getElementById('rsApp').getAttribute('aria-busy'), say: !!rr.getElementById('skSay') }; });
      expect(!after2.busy && !after2.say, w + ': the loading state is cleared once loaded (' + JSON.stringify(after2) + ')');
      expect(t.errors.length === 0, w + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview page skeleton: all passed');
})().catch(e => { console.error(e); process.exit(1); });
