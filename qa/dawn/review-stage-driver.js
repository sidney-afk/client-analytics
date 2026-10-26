// review-stage-driver.js: drives the client's new Review page (#2131, the
// review_stage_client_pages switch, on for every client since 2026-10-18)
// through its real buttons. One post at a time on a stage drawn in its own
// shadow root, picked from a strip of chips. Playwright's CSS locators pierce
// the open shadow root. Shared by dawn-check.js and tier0-live-proof.js.
'use strict';
const H = require('../probes/ot4_lib.js');

const STAGE = '#svReviewStage';
async function stageShown(p) {
  return p.evaluate((sel) => { const h = document.querySelector(sel); return !!(h && !h.hidden && h.shadowRoot && h.shadowRoot.querySelector('.chipp[data-id]')); }, STAGE);
}
// The post `id` on the stage (its chip in the strip clicked), with the caption step open.
async function stagePick(p, id) {
  const chip = p.locator(`${STAGE} .chipp[data-id="${id}"]`);
  await chip.waitFor({ timeout: 15000 });
  if (await chip.getAttribute('aria-current') !== 'true') await chip.click();
  await p.waitForFunction(([sel, id]) => { const c = document.querySelector(sel).shadowRoot.querySelector(`.chipp[data-id="${id}"]`); return !!c && c.getAttribute('aria-current') === 'true'; }, [STAGE, id], { timeout: 10000 });
  const step = p.locator(`${STAGE} .stp[data-step="caption"]`);
  if (await step.count()) await step.first().click();
  await H.sleep(400);
}
// One client action on the stage, through its real buttons: 'approve' clicks
// "Approve the caption"; 'request' clicks "Ask for a change", types `text` in the
// message box and sends it. Same answers as H.clientAct: 'ok', 'disabled', 'no-btn'.
async function stageAct(p, id, kind, text) {
  await stagePick(p, id);
  const btn = p.locator(`${STAGE} [data-${kind === 'request' ? 'chg' : 'ok'}="caption"]`);
  if (!(await btn.count())) return 'no-btn';
  if (await btn.first().isDisabled()) return 'disabled';
  await btn.first().click();
  if (kind !== 'request') return 'ok';
  const ta = p.locator(`${STAGE} #ta`);
  await ta.waitFor({ timeout: 5000 });
  await ta.fill(text);
  const send = p.locator(`${STAGE} #sendBtn`);
  for (let i = 0; i < 12 && await send.isDisabled(); i++) await H.sleep(250);
  if (await send.isDisabled()) return 'disabled';
  await send.click();
  return 'ok';
}
async function stageRetry(p, id, kind, text) {
  for (let i = 0; i < 12; i++) { const r = await stageAct(p, id, kind, text); if (r !== 'disabled') return r; await H.sleep(1000); }
  return 'disabled';
}

module.exports = { STAGE, stageShown, stagePick, stageAct, stageRetry };
