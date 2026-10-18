'use strict';
/*
 * THE PLAY BUTTON HAS ITS FINAL LOOK FROM THE FIRST FRAME (owner report 2026-10-18, session Curtain Ten).
 *
 * "First time loading the review page, a different video to review: the play button on the video looks huge and
 * black and really weird in the first second. There's a weird flicker."
 * Cause: until the player's own switch (frame_viewer_clients) has been read, the stage did not know the video plays
 * here and drew its fallback, "This video opens in a new tab" with a "Watch the video" link whose play icon had no
 * size (about 115 px, black on white), under a dark veil; a second later the real player replaced it.
 *
 * In a real browser, fully offline (the review-stage fixture, with the switch read slowed as on the live site), this
 * records every animation frame of the first load and of a post switch made while the switch is still unread, light
 * and dark, at 1440x900 and 390x844, and asserts that in every frame:
 *   - no icon in the media box is bigger than 24 px (the player's play icon is 16 px);
 *   - a play button, when there is one, is the player's 44 px round button;
 *   - the "opens in a new tab" fallback never shows for a card the player will play.
 * Fails on main.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

// Started before the page's own scripts: it records from the very first frame the stage exists.
function recorder() {
  window.__ff = [];
  const vis = e => { const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0)) return null; for (let n = e; n && n.nodeType === 1; n = n.parentNode || (n.getRootNode && n.getRootNode().host)) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null; } return b; };
  const tick = () => {
    const h = document.getElementById('svReviewStage'), r = h && h.shadowRoot, v = r && r.getElementById('view');
    if (v) {
      let big = 0, play = null, fallback = false;
      v.querySelectorAll('svg').forEach(s => { const b = vis(s); if (b) big = Math.max(big, Math.round(Math.max(b.width, b.height))); });
      const p = v.querySelector('.fv-play'); const pb = p && vis(p); if (pb) play = [Math.round(pb.width), Math.round(pb.height)];
      const nv = r.getElementById('novidMsg'); if (nv && vis(nv) && /new tab/.test(nv.textContent || '')) fallback = true;
      window.__ff.push({ t: Math.round(performance.now()), big, play, fallback });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function judge(frames, label) {
  expect(frames.length > 20, label + ': frames recorded (' + frames.length + ')');
  const big = Math.max(0, ...frames.map(f => f.big));
  expect(big <= 24, label + ': no icon in the media box bigger than 24 px in any frame (biggest ' + big + ' px)');
  const odd = frames.filter(f => f.play && (Math.abs(f.play[0] - 44) > 2 || Math.abs(f.play[1] - 44) > 2));
  expect(!odd.length, label + ': every play button is the 44 px player button (' + odd.length + ' frames otherwise)');
  const fb = frames.filter(f => f.fallback).length;
  expect(!fb, label + ': the "opens in a new tab" fallback never shows (' + fb + ' frames)');
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h, dark] of [[1440, 900, false], [1440, 900, true], [390, 844, false], [390, 844, true]]) {
      const label = w + 'x' + h + (dark ? ' dark' : ' light');
      for (const sw of [false, true]) {
        console.log('--- ' + label + (sw ? ', a post switch while the switch is unread' : ', first load') + ' ---');
        const t = await open(browser, origin, { stage: 'client', flags: 'on', frameDelay: sw ? 3200 : 1500, width: w, height: h, dark });
        await t.page.addInitScript(recorder);
        await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
        await waitNew(t);
        if (sw) { await sleep(300); await inS(t.page, '#skList [data-id="rs2"]').click(); }
        await sleep(sw ? 4200 : 2600);
        const frames = await t.page.evaluate(() => window.__ff);
        judge(frames, label + (sw ? ', post switch' : ', first load'));
        const end = frames[frames.length - 1] || {};
        expect(end.play && end.play[0] === 44, label + ': the player is there in the end (' + JSON.stringify(end.play) + ')');
        expect(!t.errors.length, label + ': no page errors (' + t.errors.join(' | ') + ')');
        await t.ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
