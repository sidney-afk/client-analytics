'use strict';
/*
 * OPEN_REPAIRS 639 (session Reviewguard, 2026-11-02): the content Calendar sends the same reports Kasper's review
 * board, the client link (OPEN_REPAIRS 626) and the Workload calendar send, so the scheduled watcher sees the
 * Calendar's problems too. Built by extending _writeUiRecordFailure's path (the shared beacon), not by a copy.
 *
 * Mocked end to end on the shared staff-Calendar harness (docs/syncview-design/tests/lost-work-lib.js; a fictional
 * test client and card, nothing reaches a live backend). Each case drives the Calendar's own card-save funnel
 * (_calFlushCardSave, the path every field edit, status pick and date move takes):
 *   1. a refused card save is reported with board calendar, and the same card's next save that lands is reported as
 *      landed_after_retry under the refused save's own action, so the watcher can tell a failure that recovered;
 *   2. a reload while a card save was on its way is reported once the Calendar is back (calendar_reload_mid_save);
 *   3. a press dropped because the same part is still saving is reported (calendar_double_click / save_in_flight);
 *   4. an uncaught error while the Calendar is open is reported by kind and place, never by its message;
 *   5. no report carries the card's title or any words (ids and the client slug only).
 * On main every case fails (no Calendar report carries a board, and 1's landing, 2, 3 and 4 send nothing).
 */
const assert = require('assert/strict');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib.js');

async function until(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out: ' + what);
    await sleep(40);
  }
}
async function env() {
  const S = await createEnv();
  const reports = [];
  await S.ctx.route('**/functions/v1/write-diagnostics', route => {
    try { reports.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {}
    return route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
  });
  const page = await S.openCalendar(await S.newPage());
  return { S, page, reports };
}
const edit = (page, text) => page.evaluate(t => {
  _calPendingEdits.p_t1 = Object.assign(_calPendingEdits.p_t1 || {}, { caption: t });
  return _calFlushCardSave('p_t1');
}, text);
const ops = (reports, op) => reports.filter(r => r.operation === op);
function noWords(reports) {
  const text = JSON.stringify(reports);
  // The fixture's client name is its slug, which reports may carry (the server hashes it), so it is not in this list.
  for (const word of ['Test card one', 'A fictional caption', 'first try words', 'retry words', 'slow words', 'boom-secret']) {
    assert(!text.includes(word), 'a report carries "' + word + '"');
  }
}
const ok = m => console.log('  ok  ' + m);

(async () => {
  // 1. A refused card save, then the same card's save that lands.
  {
    const { S, page, reports } = await env();
    try {
      S.behave['cal-upsert'] = { mode: 'http', status: 503, times: 1 };
      await edit(page, 'first try words');
      const fail = await until(() => ops(reports, 'status').find(r => !(r.env && r.env.code === 'landed_after_retry')), 'the refused save is reported');
      assert.equal(fail.surface, 'calendar');
      assert.equal(fail.env && fail.env.board, 'calendar', 'a refused Calendar save names its board');
      assert.equal(fail.identifiers && fail.identifiers.card, 'p_t1');
      ok('a refused card save is reported with board calendar');
      await edit(page, 'retry words');
      const landed = await until(() => ops(reports, 'status').find(r => r.env && r.env.code === 'landed_after_retry'), 'the save that landed is reported');
      assert.equal(landed.env.board, 'calendar');
      assert.equal(landed.identifiers && landed.identifiers.card, 'p_t1');
      ok('the same card\'s next save that lands is reported as landed_after_retry');
      await edit(page, 'third words');
      await sleep(300);
      assert.equal(ops(reports, 'status').filter(r => r.env && r.env.code === 'landed_after_retry').length, 1, 'a landing is reported once');
      noWords(reports);
    } finally { await S.close(); }
  }

  // 2. A reload while a card save is on its way.
  {
    const { S, page, reports } = await env();
    try {
      S.behave['cal-upsert'] = { delay: 8000 };
      page.evaluate(() => { _calPendingEdits.p_t1 = { caption: 'slow words' }; _calFlushCardSave('p_t1'); }).catch(() => {});
      await until(() => S.upserts.length >= 1 || null, 'the card save is sent');
      await S.openCalendar(page);
      const r = await until(() => ops(reports, 'calendar_reload_mid_save')[0], 'the reload during the save is reported');
      assert.equal(r.env && r.env.board, 'calendar');
      assert.equal(r.env.code, 'card_save');
      ok('a reload while a card save was on its way is reported (calendar_reload_mid_save)');
      await sleep(400);
      assert.equal(ops(reports, 'calendar_reload_mid_save').length, 1, 'reported once');
      noWords(reports);
    } finally { await S.close(); }
  }

  // 3. A press dropped because the same part is still saving; 4. an uncaught error while the Calendar is open.
  {
    const { S, page, reports } = await env();
    try {
      await page.evaluate(() => { _calReviewState.saving['p_t1|video'] = true; _calReviewApplyApprove('p_t1', 'video', 'client'); });
      const drop = await until(() => ops(reports, 'calendar_double_click')[0], 'the dropped press is reported');
      assert.equal(drop.env && drop.env.board, 'calendar');
      assert.equal(drop.env.code, 'save_in_flight');
      assert.equal(drop.env.part, 'video');
      assert.equal(drop.identifiers && drop.identifiers.card, 'p_t1');
      ok('a press dropped while the same part is saving is reported (calendar_double_click, save_in_flight)');
      await page.evaluate(() => { delete _calReviewState.saving['p_t1|video']; });

      await page.evaluate(() => { setTimeout(() => { throw new TypeError('boom-secret'); }, 0); });
      await page.evaluate(() => { Promise.reject(new RangeError('boom-secret')); });
      const err = await until(() => ops(reports, 'calendar_uncaught').find(r => r.env && r.env.code === 'uncaught_error'), 'the uncaught error is reported');
      const rej = await until(() => ops(reports, 'calendar_uncaught').find(r => r.env && r.env.code === 'unhandled_rejection'), 'the rejection is reported');
      assert.equal(err.env.board, 'calendar'); assert.equal(rej.env.board, 'calendar');
      assert(!JSON.stringify([err, rej]).includes('boom-secret'), 'the error message is not in the report');
      ok('an uncaught error and an unhandled rejection on the Calendar are reported by kind, never by message');
      noWords(reports);
    } finally { await S.close(); }
  }
  ok('no report carries the card\'s title or any words');
  console.log('calendar-reports-browser: the Calendar reports refused saves that recovered, reloads mid-save, dropped presses and uncaught errors, with no words ✅');
})().catch(e => { console.error(e); process.exit(1); });
