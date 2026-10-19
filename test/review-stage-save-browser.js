'use strict';
/*
 * EVERY SAVE ON THE REVIEW STAGE ENDS ON SCREEN (owner feedback 2026-10-17 23:40, session Curtain Nine).
 *
 * The owner pressed "Approve to Kasper" on the SMM's Review tab and the stage read "Saving..." for good, although the
 * save had landed. Cause: an approval that clears the card's last waiting part takes the old page's "remove the card"
 * branch, which found no old card on screen and returned without telling the new stage to draw again.
 *
 * In a real browser, fully offline (the review-stage fixture), this proves:
 *   1. an SMM approval that clears the card shows "Approved to Kasper" within three seconds, never a stuck "Saving";
 *   2. a slow server: the pressed button spins (no "Saving..." words), after a few seconds the stage says, in words, that it is still waiting, and when the answer
 *      comes the part shows approved;
 *   3. a refused save: the stage shows the reason and a "Try again" button within a few seconds, and Try again saves.
 * Fails on main before this change (case 1 stays on "Saving").
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, inS, waitNew, answerConfirm, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function openSmm(browser, origin, only, edit) {
  const t = await open(browser, origin, { stage: 'smm', flags: 'on', staff: STAFF });
  // the first card: only the parts named in `only` still wait on the SMM
  for (const k of ['video', 'graphic', 'caption']) if (!only.includes(k)) t.state.cards[0][k + '_status'] = 'Approved';
  if (edit) edit(t.state.cards[0]);
  await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
  await t.page.evaluate(() => onCalViewChange('smmreview'));
  await waitNew(t);
  await sleep(800);
  return t;
}
const drow = t => inS(t.page, '#drow').textContent();
async function until(t, fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await answerConfirm(t.page); await sleep(100); } return -1; }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // 1. the approval that clears the card
    console.log('--- SMM: Approve to Kasper on the last waiting part ---');
    let t = await openSmm(browser, origin, ['video']);
    await inS(t.page, '[data-ok="video"]').click();
    let took = await until(t, async () => /Approved to Kasper/.test(await drow(t)), 3000);
    expect(t.state.upserts.some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), '1: the save reached the server');
    expect(took >= 0, '1: the stage shows "Approved to Kasper" within 3 s (' + took + ' ms; reads "' + (await drow(t)) + '")');
    expect(!/Saving/.test(await drow(t)), '1: no "Saving" left on the stage');
    expect(t.errors.length === 0, '1: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 2. a slow server
    console.log('--- SMM: a slow server ---');
    t = await openSmm(browser, origin, ['video', 'caption']);
    t.state.writeDelay = 11000;
    await inS(t.page, '[data-ok="video"]').click();
    await sleep(250);
    const busy = await t.page.evaluate(() => {
      const r = document.getElementById('svReviewStage').shadowRoot, b = r.querySelector('#drow [data-ok="video"]');
      const sp = b && b.querySelector('.spin');
      return { spin: !!sp, anim: sp ? getComputedStyle(sp).animationName : '', busy: b && b.getAttribute('aria-busy'), text: r.getElementById('drow').textContent, early: !!r.querySelector('#stepper .svd') };
    });
    expect(busy.spin && busy.anim === 'rsSpin' && busy.busy === 'true', '2: the pressed button spins while it saves (' + JSON.stringify(busy) + ')');
    expect(!/Saving/.test(busy.text), '2: no "Saving..." words while it saves');
    expect(!busy.early, '2: the step bar does not say "Saved" before the server answers');
    took = await until(t, async () => await inS(t.page, '[data-slow="video"]').count() > 0, 10500);
    expect(took >= 0, '2: after a few seconds the stage says it is still waiting (' + took + ' ms)');
    t.state.writeDelay = 0;
    took = await until(t, async () => await t.page.evaluate(() => !_calReviewState.saving['rs1|video']), 8000);
    await sleep(1000);   // after the stage's own move to the next part
    await inS(t.page, '.stp[data-step="video"]').click();
    await sleep(600);
    expect(took >= 0 && /Approved to Kasper/.test(await drow(t)), '2: when the answer comes the part shows approved (' + (await drow(t)) + ')');
    expect(!/Still waiting/.test(await drow(t)), '2: the waiting line goes away');
    await t.ctx.close();

    // 3. a refused save, then Try again
    console.log('--- SMM: a refused save, then Try again ---');
    t = await openSmm(browser, origin, ['video', 'caption']);
    t.state.writeFail = 1;
    await inS(t.page, '[data-ok="video"]').click();
    took = await until(t, async () => await inS(t.page, '[data-retry="video"]').count() > 0, 6000);
    const errText = await inS(t.page, '.err').first().textContent().catch(() => '');
    expect(took >= 0, '3: a refused save shows its reason and "Try again" within 6 s (' + took + ' ms: "' + errText + '")');
    expect(!/Saving/.test(await drow(t)), '3: no "Saving" left on the stage');
    const n0 = t.state.upserts.length;
    if (took >= 0) await inS(t.page, '[data-retry="video"]').click();
    took = await until(t, async () => t.state.upserts.slice(n0).some(u => u.video_status === 'Kasper Approval') && await t.page.evaluate(() => !_calReviewState.saving['rs1|video']), 6000);
    await sleep(1000);   // after the stage's own move to the next part
    await inS(t.page, '.stp[data-step="video"]').click();
    await sleep(600);
    expect(took >= 0 && /Approved to Kasper/.test(await drow(t)) && t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), '3: Try again saves and the part shows approved (' + (await drow(t)) + ')');
    expect(!(await inS(t.page, '.err').count()), '3: the error line goes away');
    expect(t.errors.length === 0, '3: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 4. an approve on a part with an open change request: no question (the pick is the answer), then a refused save
    console.log('--- SMM: approve with an open change request (no pop-up), then a refused save ---');
    t = await openSmm(browser, origin, ['video', 'caption'], c => {
      c.video_tweaks = JSON.stringify([{ id: 'tw1', parent_id: null, author: 'Team Member', role: 'smm', is_tweak: true, audience: 'internal', body: 'Tighten the intro.', created_at: '2026-10-12T16:12:00.000Z', updated_at: '2026-10-12T16:12:00.000Z', done: false, done_at: '', done_by: '' }]);
    });
    t.state.writeFail = 1;
    await inS(t.page, '[data-ok="video"]').click();
    await sleep(600);
    expect(!(await t.page.evaluate(() => { const o = document.getElementById('resolveDestOverlay'); return !!(o && o.classList.contains('active')); })), '4: no "where to next" pop-up opens (the pick of Kasper is the answer)');
    took = await until(t, async () => await inS(t.page, '[data-retry="video"]').count() > 0, 6000);
    expect(took >= 0, '4: a refused save with an open change request still shows its reason and Try again (' + took + ' ms)');
    expect(t.errors.length === 0, '4: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 5. a server that never answers: the save ends after about 20 s as a failed save, and Try again saves
    console.log('--- SMM: a server that never answers ---');
    t = await openSmm(browser, origin, ['video', 'caption']);
    t.state.writeHang = true;
    await inS(t.page, '[data-ok="video"]').click();
    took = await until(t, async () => await inS(t.page, '[data-retry="video"]').count() > 0, 26000);
    expect(took >= 18000 && took <= 25000, '5: the hung save ends as a failed save with Try again after about 20 s (' + took + ' ms)');
    expect(/not answered|not respond|didn.t answer/i.test(await inS(t.page, '.err').first().textContent().catch(() => '')), '5: the stage says the server has not answered');
    expect(!/Saving|Still waiting/.test(await drow(t)), '5: no waiting line left on the stage');
    t.state.writeHang = false;
    const n1 = t.state.upserts.length;
    if (took >= 0) await inS(t.page, '[data-retry="video"]').click();
    took = await until(t, async () => t.state.upserts.slice(n1).some(u => u.video_status === 'Kasper Approval'), 6000);
    expect(took >= 0, '5: Try again saves once the server answers');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview stage saves: all passed');
})().catch(e => { console.error(e); process.exit(1); });
