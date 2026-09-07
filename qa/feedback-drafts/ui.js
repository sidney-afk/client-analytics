'use strict';
const assert = require('node:assert/strict');
const ID = 'fixture-card-alpha';
const card = page => page.locator(`.cal-card[data-pid="${ID}"]`);
async function until(check, message, timeout = 10000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await new Promise(r => setTimeout(r, 40)); } while (Date.now() < end);
  assert.fail(message);
}
async function sheet(page) {
  const button = page.locator('[data-cal-view="organizer"]');
  if (await button.isVisible()) await button.click();
  await card(page).waitFor();
}
async function pill(page, comp, status) {
  const label = status === 'Client Approval' ? 'Lifecycle Approval' : status;
  await until(async () => (await card(page).locator(`[data-substatus-comp="${comp}"]`).innerText()).toLowerCase().includes(label.toLowerCase()),
    `visible ${comp} pill must say ${status}`);
}
async function closeNotes(page) {
  const close = page.locator('#calCommentsOverlay .cal-comments-close');
  if (await close.first().isVisible()) await close.first().click();
  else if (await page.locator('#calCommentsOverlay.open').isVisible()) await page.keyboard.press('Escape');
}
async function notes(page) {
  await sheet(page); await closeNotes(page);
  await card(page).locator('.cal-comments-btn').click();
  await page.locator('#calCommentsOverlay.open').waitFor();
}
async function resolve(page, destination = 'Kasper') {
  await notes(page);
  const button = page.getByRole('button', { name: 'Mark done', exact: true }).last();
  await button.locator('xpath=ancestor::*[@data-cm-row]').hover();
  await button.click();
  await page.locator('#resolveDestOverlay.active').waitFor();
  await page.locator(`#resolveDest${destination}`).click();
  await closeNotes(page);
}
async function review(page, comp, kasper = false) {
  if (!kasper && await page.locator('[data-cal-view="smmreview"]').isVisible()) {
    await page.locator('[data-cal-view="smmreview"]').click();
  }
  const c = kasper ? page.locator(`.kcard[data-kasper-pid="${ID}"]`)
    : page.locator('.cal-review-card').filter({ hasText: 'Fictional lifecycle card' });
  await c.waitFor();
  const panel = c.locator(`.cal-review-panel[data-comp="${comp}"]`);
  if (!(await panel.isVisible())) await c.locator('.kcard-expand-btn').click();
  await panel.waitFor(); return panel;
}
async function queue(page, kind, present) {
  const q = kind === 'kasper' ? page.locator(`.kcard[data-kasper-pid="${ID}"]`)
    : page.locator('.cal-review-card').filter({ hasText: 'Fictional lifecycle card' });
  if (present) await q.waitFor(); else await q.waitFor({ state: 'detached' });
}
async function reviewer(h, b, comp, role = 'admin') {
  const s = await h.session(b, role);
  const p = await h.open(s);
  await card(p).waitFor();
  await p.locator('#navKasper').click();
  await p.locator('#kasperReviewBody').waitFor();
  return s;
}
async function fresh(h, b, comp, status, expected = {}) {
  const s = await h.session(b);
  await h.open(s); await pill(s.page, comp, status);
  assert.equal(b.rows[0][`${comp}_status`], status, 'persisted fixture status agrees');
  if (expected.kasper !== undefined) {
    await s.page.locator('#navKasper').click(); await s.page.locator('#kasperReviewBody').waitFor();
    await until(async () => (await s.page.locator('#kasperReviewBody').innerText()).includes(expected.kasper ? 'Fictional lifecycle card' : 'caught up'), 'fresh Kasper queue agrees');
  }
  if (expected.client !== undefined) {
    const c = await h.session(b, 'client'); await h.open(c);
    await c.page.locator('.cal-review-wrap').waitFor();
    await queue(c.page, 'client', expected.client);
    await c.context.close();
  }
  await s.context.close();
}
async function accepted(b, start, action = 'calendar-upsert') {
  await until(() => b.records.slice(start).some(r => r.action === action && r.outcome === 'accepted'), `${action} accepted receipt required`);
}
async function tabTo(page, selector, max = 100) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(sel => document.activeElement?.matches(sel), selector)) {
      assert(await page.evaluate(() => document.activeElement.matches(':focus-visible')), 'keyboard focus is visible'); return;
    }
    await page.keyboard.press('Tab');
  }
  assert.fail('keyboard control unreachable');
}
module.exports = { ID, card, until, sheet, pill, closeNotes, notes, resolve, review, queue, reviewer, fresh, accepted, tabTo };
