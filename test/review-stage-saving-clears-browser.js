'use strict';
/*
 * "SAVING…" CLEARS AS SOON AS THE SAVE ANSWERS (session Gauntlet Client, 2026-10-17; the owner saw "Saving…" stuck
 * after an approve). Real browser, fully offline, the same mocked backend as review-stage-browser.js.
 *
 * Measured on the live client link that night: when a client's answer was the LAST one a post owed (approve or ask
 * for a change), the save answered in about 0.6 s and the saving flag cleared, but the new review page kept showing
 * "Saving…" for 4 to 14 s, until an unrelated background reload redrew it. The save's finish step removed the old
 * page's card (_calReviewRemoveCard), found none on the new page and returned without redrawing the stage.
 *
 * Proves, with review_stage_client_pages on:
 *   - approve a caption that is not the last part (rs3): "Saving…" clears within 1.5 s of the save answering;
 *   - approve a caption that is the last part (rs2, video and thumbnail approved): "Saving…" clears within 1.5 s and
 *     the stage shows "Approved";
 *   - in a new page, ask for a change on that last caption: "Saving…" clears within 1.5 s and the stage shows
 *     "Change asked".
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const drow = page => page.evaluate(() => (document.getElementById('svReviewStage').shadowRoot.getElementById('drow') || {}).textContent || '');

// Wait for the save to be recorded, then time how long the stage still says "Saving…".
async function savingClears(t, n0, pred) {
  for (let i = 0; i < 100 && !t.state.upserts.slice(n0).some(pred); i++) await sleep(50);
  const saved = t.state.upserts.slice(n0).some(pred);
  const t0 = Date.now();
  let text = await drow(t.page);
  while (/Saving/.test(text) && Date.now() - t0 < 6000) { await sleep(100); text = await drow(t.page); }
  return { saved, ms: Date.now() - t0, text };
}
// rs2 with its video and thumbnail already approved: the caption is the last part it owes.
const captionLast = cards => Object.assign(cards.find(c => c.id === 'rs2'), { video_status: 'Approved', graphic_status: 'Approved' });
async function openOn(browser, origin, id, editCards) {
  const t = await openClient(browser, origin, { flags: 'on', editCards });
  await waitNew(t);
  await sleep(800);
  await inS(t.page, '.chipp[data-id="' + id + '"]').click();
  await sleep(600);
  return t;
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    console.log('--- approve a caption that is not the last part ---');
    let t = await openOn(browser, origin, 'rs3');
    await inS(t.page, '.stp[data-step="caption"]').click();
    await sleep(300);
    let n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="caption"]').click();
    let r = await savingClears(t, n0, u => u.id === 'rs3' && u.caption_status === 'Approved');
    expect(r.saved && r.ms < 1500, 'not the last part: "Saving…" clears within 1.5 s of the save (' + r.ms + ' ms)');
    await t.ctx.close();

    console.log('--- approve the last part ---');
    t = await openOn(browser, origin, 'rs2', captionLast);
    expect(await inS(t.page, '.stp.on').getAttribute('data-step') === 'caption', 'rs2 opens on its caption, the one part left');
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="caption"]').click();
    r = await savingClears(t, n0, u => u.id === 'rs2' && u.caption_status === 'Approved');
    expect(r.saved && r.ms < 1500, 'the last part: "Saving…" clears within 1.5 s of the save (' + r.ms + ' ms)');
    expect(/Approved/.test(r.text), 'the last part: the stage then shows Approved (' + r.text.replace(/\s+/g, ' ').slice(0, 60) + ')');
    expect(t.errors.length === 0, 'approve: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    console.log('--- ask for a change on the last part ---');
    t = await openOn(browser, origin, 'rs2', captionLast);
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="caption"]').click();
    await inS(t.page, '#ta').fill('Shorter, please.');
    await inS(t.page, '#sendBtn').click();
    r = await savingClears(t, n0, u => u.id === 'rs2' && u.caption_status === 'Tweaks Needed');
    expect(r.saved && r.ms < 1500, 'change on the last part: "Saving…" clears within 1.5 s of the save (' + r.ms + ' ms)');
    expect(/Change asked/.test(r.text), 'change: the stage then shows Change asked (' + r.text.replace(/\s+/g, ' ').slice(0, 60) + ')');
    expect(t.errors.length === 0, 'change: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-saving-clears-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-saving-clears-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
