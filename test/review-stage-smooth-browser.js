'use strict';
/*
 * SMOOTH PART SWITCHING ON THE REVIEW PAGE (owner feedback 2026-10-17 23:40, session Curtain Nine).
 *
 * "Going from Video to Thumbnail makes parts of the page disappear and reappear, the conversation panel among them."
 * Cause: every switch drew the whole page again, so the conversation's entrance animation replayed (every message at
 * opacity 0, then fading in) and the strip's thumbnails were made again (blank for a frame while they decode).
 *
 * In a real browser, fully offline (the review-stage fixture), this records every animation frame during each kind of
 * switch (step bar, the next part after an approve, a strip chip, Finish opening the next post) on the client page and
 * the SMM's Review tab, and asserts that in every frame:
 *   - the header, the strip, the post title, the step bar, the decision row and the conversation panel are on screen;
 *   - no message or message box in the conversation is fainter than 35% (a step switch: never fainter at all; another
 *     post: a soft cross-fade, never a blink to nothing);
 *   - no strip thumbnail that was showing goes blank.
 * Only the media box may fade. Fails on main.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, STAFF, open, openClient, inS, waitNew, answerConfirm, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function startRec(page) {
  await page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const shown = sel => { const e = r.querySelector(sel); if (!e) return false; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.99; };
    // a thumbnail the strip had shown, now blank (one still loading off screen does not count)
    const blank = () => Array.from(r.querySelectorAll('#skList img')).filter(i => !(i.complete && i.naturalWidth) && window.__rsSeen && window.__rsSeen.has(i.getAttribute('src') + '#' + i.closest('[data-id],[data-reopen]').getAttribute('data-id'))).length;
    window.__rsSeen = new Set(Array.from(r.querySelectorAll('#skList img')).filter(i => i.complete && i.naturalWidth).map(i => i.getAttribute('src') + '#' + i.closest('[data-id],[data-reopen]').getAttribute('data-id')));
    window.__rsRec = { frames: [], on: true, base: blank() };
    const tick = () => {
      if (!window.__rsRec.on) return;
      const faint = Array.from(r.querySelectorAll('#tscroll .bub, #chat .compose, #tscroll'))
        .map(e => { let o = 1; for (let n = e; n && n !== r.host && n.nodeType === 1; n = n.parentNode) o *= +getComputedStyle(n).opacity; return o; });
      window.__rsRec.frames.push({
        hdr: !r.querySelector('.hdr') || shown('.hdr'), strip: shown('#strip'), side: shown('#side'), stepper: shown('#stepper'), drow: shown('#drow'),
        chat: shown('#chat'), chead: shown('.ch-head'), minOp: faint.length ? Math.min(...faint) : 1, blank: blank(),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopRec(page) { return page.evaluate(() => { window.__rsRec.on = false; return window.__rsRec; }); }
function judge(rec, label, minOp) {
  const f = rec.frames;
  const bad = k => f.filter(x => !x[k]).length;
  expect(f.length > 10, label + ': frames recorded (' + f.length + ')');
  for (const [k, name] of [['hdr', 'header'], ['strip', 'strip'], ['side', 'post title'], ['stepper', 'step bar'], ['drow', 'decision row'], ['chat', 'conversation panel'], ['chead', 'conversation heading']]) {
    expect(!bad(k), label + ': the ' + name + ' is on screen in every frame (' + bad(k) + ' frames without it)');
  }
  const low = Math.min(...f.map(x => x.minOp));
  expect(low >= minOp, label + ': no message fades below ' + Math.round(minOp * 100) + '% (lowest ' + Math.round(low * 100) + '%)');
  const blank = Math.max(...f.map(x => x.blank));
  expect(blank <= rec.base, label + ': no strip thumbnail goes blank (' + blank + ' blank at worst, ' + rec.base + ' before)');
}
async function during(t, label, minOp, act, ms) {
  await startRec(t.page);
  await act();
  await sleep(ms || 900);
  judge(await stopRec(t.page), label, minOp);
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- the client page ----------
    console.log('--- client page ---');
    let t = await openClient(browser, origin, { flags: 'on' });
    await waitNew(t);
    await sleep(2000);
    await during(t, 'client, step bar Video to Thumbnail', 0.99, () => inS(t.page, '.stp[data-step="graphic"]').click());
    await during(t, 'client, step bar Thumbnail to Caption', 0.99, () => inS(t.page, '.stp[data-step="caption"]').click());
    await during(t, 'client, step bar back to Video', 0.99, () => inS(t.page, '.stp[data-step="video"]').click());
    await during(t, 'client, a strip chip opens another post', 0.35, () => inS(t.page, '.chipp').nth(2).click(), 1000);
    await during(t, 'client, a strip chip opens the first post again', 0.35, () => inS(t.page, '.chipp').nth(0).click(), 1000);
    await during(t, 'client, approve moves on to the next part', 0.99, () => inS(t.page, '[data-ok="video"]').click(), 1400);
    expect(t.errors.length === 0, 'client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // Finish opening the next post: a page where only the first post's video waits (the fixture saves that one)
    t = await open(browser, origin, { stage: 'client', flags: 'on' });
    t.state.cards[0].graphic_status = 'Approved'; t.state.cards[0].caption_status = 'Approved';
    await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    await sleep(2000);
    await inS(t.page, '[data-ok="video"]').click();
    await sleep(1500);
    const fin = inS(t.page, '#finishBtn');
    expect(await fin.isEnabled(), 'client: Finish reviewing is ready once every part is answered');
    await during(t, 'client, Finish opens the next post', 0.35, () => fin.click(), 1000);
    expect(t.errors.length === 0, 'client (Finish): no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- the SMM's Review tab ----------
    console.log('--- SMM Review tab ---');
    t = await open(browser, origin, { stage: 'smm', flags: 'on', staff: STAFF });
    await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
    await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
    await t.page.evaluate(() => onCalViewChange('smmreview'));
    await waitNew(t);
    await sleep(2000);
    await during(t, 'SMM, step bar Video to Caption', 0.99, () => inS(t.page, '.stp[data-step="caption"]').click());
    await during(t, 'SMM, a strip chip opens another post', 0.35, () => inS(t.page, '.chipp').nth(1).click(), 1000);
    expect(t.errors.length === 0, 'SMM: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview stage smooth switching: all passed');
})().catch(e => { console.error(e); process.exit(1); });
