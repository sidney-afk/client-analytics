'use strict';
/*
 * A CLIENT'S CAPTION EDIT, SENT TO THE TEAM, IS THEIR ANSWER FOR THE CAPTION STEP (owner report 2026-10-18, session
 * Onward). Real browser, fully offline, the shared mocked backend of review-stage-browser.js.
 *
 * - Edit the caption and press "Send to your team": the caption is stored, the team gets the plain note, the caption
 *   counts as approved by the client (one save, the one the Approve button makes) and the stage moves on.
 * - A refused save: stays on the caption step, nothing approved, the edited words are back in the edit box, and the
 *   existing "did not save" words show. Sending again then works.
 * - A double click approves once.
 * - The last step of the last post ends the way Approve does (Finish reviewing is ready).
 * - Phone (390) and desktop (1440).
 * Fails on main: the stage stayed on the caption step and the caption stayed waiting for Approve.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const NEW_CAPTION = 'The first second decides it.\n\nStart with the change, not the context.';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const notes = (u, col) => { try { return JSON.parse(String(u[col] || '[]')); } catch (e) { return []; } };
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
const stepNow = t => R(t.page, (r) => { const b = r.querySelector('.stp.on'); return b ? b.dataset.step : ''; });
const capState = t => R(t.page, (r) => { const b = r.querySelector('.stp[data-step="caption"]'); return b ? b.className : ''; });

async function openReview(browser, origin, o, tweak) {
  const t = await open(browser, origin, Object.assign({ stage: 'client', flags: 'on' }, o || {}));
  if (tweak) tweak(t.state.cards);
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1200);
  return t;
}
async function openEditor(t) {
  await inS(t.page, '.stp[data-step="caption"]').click();
  await sleep(500);
  await inS(t.page, '#editBtn').click();
}
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(100); } return -1; }
const approvals = (t, n0) => t.state.upserts.slice(n0).filter(u => u.id === 'rs1' && u.caption_status === 'Approved');

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      console.log('--- ' + w + ' wide: edit, send, move on ---');
      let t = await openReview(browser, origin, { width: w, height: h });
      await openEditor(t);
      await inS(t.page, '#capTa').fill(NEW_CAPTION);
      let n0 = t.state.upserts.length;
      await inS(t.page, '#capSave').click();
      const took = await until(async () => (await stepNow(t)) !== 'caption', 6000);
      expect(took >= 0, w + ': the stage moves on from the caption step after Send to your team');
      await sleep(800);
      const ups = t.state.upserts.slice(n0);
      expect(ups.some(u => u.caption === NEW_CAPTION), w + ': the card save carries the new caption');
      expect(ups.some(u => notes(u, 'caption_tweaks').some(n => /^Changed the caption to:/.test(n.body) && !n.is_tweak)), w + ': the team gets the plain note about the edit');
      expect(approvals(t, n0).length === 1, w + ': the caption is approved by the client exactly once (' + approvals(t, n0).length + ')');
      expect(!ups.some(u => u.caption_status === 'Tweaks Needed'), w + ': never sent as a change request');
      expect(/\bok\b/.test(await capState(t)) || /ok/.test(await capState(t)), w + ': the caption step reads approved (' + (await capState(t)) + ')');
      expect(!t.errors.length, w + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- a refused save stays, keeps the words, approves nothing ---');
    {
      const t = await openReview(browser, origin, {});
      await openEditor(t);
      await inS(t.page, '#capTa').fill(NEW_CAPTION);
      t.state.writeFail = 1;
      const n0 = t.state.upserts.length;
      await inS(t.page, '#capSave').click();
      await sleep(2500);
      expect((await stepNow(t)) === 'caption', 'refused: still on the caption step');
      expect(approvals(t, n0).length === 0 && !t.state.upserts.slice(n0).some(u => u.caption === NEW_CAPTION), 'refused: nothing saved and nothing approved');
      const flash = await R(t.page, (r) => (r.getElementById('flash') || {}).textContent || '');
      expect(/did not save/.test(flash), 'refused: the not-saved words show (' + flash + ')');
      const kept = await R(t.page, (r) => { const e = r.getElementById('capTa'); return e ? e.value : null; });
      expect(kept === NEW_CAPTION, 'refused: the edited text is still in the edit box');
      await inS(t.page, '#capSave').click();
      const took = await until(async () => (await stepNow(t)) !== 'caption', 6000);
      await sleep(800);
      expect(took >= 0 && approvals(t, n0).length === 1, 'sending again saves, approves once and moves on (' + approvals(t, n0).length + ')');
      expect(!t.errors.length, 'refused: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- a double click approves once ---');
    {
      const t = await openReview(browser, origin, {});
      await openEditor(t);
      await inS(t.page, '#capTa').fill(NEW_CAPTION);
      const n0 = t.state.upserts.length;
      await inS(t.page, '#capSave').dblclick();
      await sleep(3000);
      expect(approvals(t, n0).length === 1, 'double click: exactly one approval (' + approvals(t, n0).length + ')');
      expect(t.state.upserts.slice(n0).filter(u => notes(u, 'caption_tweaks').some(n => /^Changed the caption to:/.test(n.body))).length === 1, 'double click: the team is told once');
      await t.ctx.close();
    }

    console.log('--- the last step of the last post ends the way Approve does ---');
    {
      const only = cs => cs.forEach((c, i) => { if (i) { c.status = c.video_status = c.graphic_status = c.caption_status = 'Approved'; } else { c.video_status = c.graphic_status = 'Approved'; } });
      const fin = async (t) => R(t.page, (r) => { const b = r.getElementById('finishBtn'); return b ? { disabled: b.disabled, ready: b.classList.contains('ready') } : null; });
      let t = await openReview(browser, origin, {}, only);
      await inS(t.page, '.stp[data-step="caption"]').click(); await sleep(500);
      await inS(t.page, '[data-ok="caption"]').click(); await sleep(2500);
      const viaApprove = await fin(t); const stepA = await stepNow(t);
      await t.ctx.close();
      t = await openReview(browser, origin, {}, only);
      const n0 = t.state.upserts.length;
      await openEditor(t);
      await inS(t.page, '#capTa').fill(NEW_CAPTION);
      await inS(t.page, '#capSave').click(); await sleep(2500);
      const viaEdit = await fin(t); const stepB = await stepNow(t);
      expect(viaApprove && viaApprove.ready && !viaApprove.disabled, 'Approve on the last step makes Finish reviewing ready (' + JSON.stringify(viaApprove) + ')');
      expect(JSON.stringify(viaEdit) === JSON.stringify(viaApprove) && stepA === stepB, 'edit and send ends the same way (' + JSON.stringify(viaEdit) + ' on ' + stepB + ', Approve: ' + stepA + ')');
      expect(approvals(t, n0).length === 1, 'and approves once');
      await t.ctx.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
