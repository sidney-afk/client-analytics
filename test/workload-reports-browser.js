'use strict';
/*
 * OPEN_REPAIRS 638 (session Reviewguard, 2026-11-02): the Workload calendar sends the same reports Kasper's review
 * board and the client link send (OPEN_REPAIRS 626), so the scheduled watcher sees Workload's problems too.
 *
 * Mocked end to end on the shared Workload harness (no live backend). Each case drives the real board:
 *   1. a saving card offers no drag handle (nothing is lost by hand); a second move that still reaches the board's
 *      guard while the first is saving (a race past the hidden controls) is dropped, and is now reported as
 *      workload_double_click / save_in_flight, board workload;
 *   2. a refused move is reported with board workload, and the same card's next move that lands is reported as
 *      landed_after_retry, so the watcher can tell a failure that recovered from one that did not;
 *   3. a reload while a move is on its way is reported once the board is back (workload_reload_mid_save);
 *   4. an uncaught error while Workload is open is reported by kind and place, never by its message;
 *   5. no report carries a client name, a card title or any words: ids and the client slug only.
 * On main every case fails (no Workload report carries a board, and 1, 3 and 4 send nothing at all).
 *
 * Engines: Chromium, and WebKit where installed (WORKLOAD_REPORTS_REQUIRE_WEBKIT=1 makes a missing WebKit fail).
 */
const assert = require('assert/strict');
const { chromium, webkit } = require('playwright');
const L = require('../docs/syncview-design/tests/workload-calm-fixture.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out: ' + what);
    await sleep(40);
  }
}

// A Workload board whose plan saves can be held, and whose diagnostic reports are kept.
async function board(engine) {
  const h = await L.launchCalmBoard({ calm: false, engine });
  const reports = [];
  await h.context.route('**/functions/v1/write-diagnostics', route => {
    try { reports.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {}
    return route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
  });
  const hold = { on: false, release: null, gate: null, sent: 0 };
  hold.arm = () => { hold.on = true; hold.gate = new Promise(r => { hold.release = r; }); };
  hold.open = () => { hold.on = false; if (hold.release) hold.release(); };
  await h.context.route('**/functions/v1/workload-plan*', async route => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (body.action === 'set') hold.sent++;
    if (body.action === 'set' && hold.on) await hold.gate;
    try { await route.fallback(); } catch (e) {}
  });
  return { h, reports, hold };
}
const wl = (reports, op) => reports.filter(r => r.operation === op);
// Two other days of the shown week for a card: not the one it is on.
async function twoOtherDays(page, id) {
  const b = await L.readBoard(page);
  const from = L.dayOf(b, id);
  const days = b.days.map(d => d.iso).filter(iso => iso && iso !== from);
  assert(from && days.length >= 2, 'card ' + id + ' is on the board with two other days to move to');
  return [days[0], days[1], from];
}
function noWords(reports) {
  const text = JSON.stringify(reports);
  for (const word of ['Client A', 'Client B', 'Client C', 'Launch teaser', 'Customer story', 'Quick tip', 'QA Staff', 'boom-secret']) {
    assert(!text.includes(word), 'a report carries "' + word + '"');
  }
}

async function run(engineName, engine) {
  const tag = '[' + engineName + ']';
  const ok = m => console.log('  ok  ' + tag + ' ' + m);

  // 1. A second move while the first is saving.
  {
    const { h, reports, hold } = await board(engine);
    try {
      const [dayA, dayB] = await twoOtherDays(h.page, 'a1');
      hold.arm();
      assert.equal((await L.dragIssueToDay(h.page, 'a1', dayA)).ok, true);
      await until(() => hold.sent >= 1 || null, 'the first move is sent');
      // The board hides a saving card's drag handle and disables its date controls, so a person cannot start a
      // second move by hand; the guard behind them is for the races that slip past (a control painted before the
      // save began). It is driven here through the board's own setter, as such a control would call it.
      assert.equal((await L.dragIssueToDay(h.page, 'a1', dayB)).ok, false, 'a saving card offers no drag handle');
      ok('a saving card offers no second drag (the board stops it in view, nothing is lost)');
      assert.equal(await h.page.evaluate(day => wlSetPlanDate('a1', day), dayB), false, 'the guard drops the second move');
      const drop = await until(() => wl(reports, 'workload_double_click')[0], 'the dropped second move is reported');
      assert.equal(drop.env && drop.env.board, 'workload');
      assert.equal(drop.env.code, 'save_in_flight');
      assert.equal(drop.identifiers && drop.identifiers.id, 'a1');
      ok('a second move while the first is saving is reported (workload_double_click, save_in_flight)');
      hold.open();
      await L.waitForPlanIdle(h.page);
      assert.equal(hold.sent, 1, 'the board still sends only the first move');
      assert.equal(L.dayOf(await L.readBoard(h.page), 'a1'), dayA, 'the card stays where the first move put it');
      ok('the board itself is unchanged: one save, the card on the first day');
      noWords(reports);
    } finally { await h.close(); }
  }

  // 2. A refused move, then the same card's move that lands.
  {
    const { h, reports } = await board(engine);
    try {
      const [dayA, dayB] = await twoOtherDays(h.page, 'b1');
      h.state.planWriteStatus = 503;
      await L.dragIssueToDay(h.page, 'b1', dayA);
      const fail = await until(() => wl(reports, 'workload_plan_save').find(r => r.code !== 'landed_after_retry'), 'the refused move is reported');
      assert.equal(fail.env && fail.env.board, 'workload', 'a refused Workload save names its board');
      assert.equal(fail.identifiers && fail.identifiers.id, 'b1');
      await L.waitForPlanIdle(h.page);
      ok('a refused move is reported with board workload');
      h.state.planWriteStatus = 200;
      await L.dragIssueToDay(h.page, 'b1', dayB);
      const landed = await until(() => wl(reports, 'workload_plan_save').find(r => r.env && r.env.code === 'landed_after_retry'), 'the move that landed is reported');
      assert.equal(landed.env.board, 'workload');
      assert.equal(landed.identifiers && landed.identifiers.id, 'b1');
      ok('the same card\'s next move that lands is reported as landed_after_retry');
      noWords(reports);
    } finally { await h.close(); }
  }

  // 3. A reload while a move is on its way.
  {
    const { h, reports, hold } = await board(engine);
    try {
      const [dayA] = await twoOtherDays(h.page, 'c1');
      hold.arm();
      await L.dragIssueToDay(h.page, 'c1', dayA);
      await until(() => hold.sent >= 1 || null, 'the move is sent');
      // A reload, as the calm suites do it: the board's own address (/workload) is not served by the test server.
      await h.page.goto(h.page.url().replace(/\/workload.*/, '/#workload'), { waitUntil: 'domcontentloaded' });
      hold.open();
      await h.page.waitForSelector('.workload-view', { timeout: 20000 });
      const r = await until(() => wl(reports, 'workload_reload_mid_save')[0], 'the reload during the save is reported');
      assert.equal(r.env && r.env.board, 'workload');
      assert.equal(r.env.code, 'plan');
      ok('a reload while a move was saving is reported (workload_reload_mid_save, plan)');
      await sleep(400);
      assert.equal(wl(reports, 'workload_reload_mid_save').length, 1, 'reported once');
      noWords(reports);
    } finally { await h.close(); }
  }

  // 4. An uncaught error while Workload is open: kind and place, never the message.
  {
    const { h, reports } = await board(engine);
    try {
      await h.page.evaluate(() => { setTimeout(() => { throw new TypeError('boom-secret'); }, 0); });
      await h.page.evaluate(() => { Promise.reject(new RangeError('boom-secret')); });
      const err = await until(() => wl(reports, 'workload_uncaught').find(r => r.env && r.env.code === 'uncaught_error'), 'the uncaught error is reported');
      const rej = await until(() => wl(reports, 'workload_uncaught').find(r => r.env && r.env.code === 'unhandled_rejection'), 'the unhandled rejection is reported');
      assert.equal(err.env.board, 'workload'); assert.equal(rej.env.board, 'workload');
      assert(!JSON.stringify([err, rej]).includes('boom-secret'), 'the error message is not in the report');
      ok('an uncaught error and an unhandled rejection are reported by kind, never by message');
      noWords(reports);
    } finally { await h.close(); }
  }
  ok('no report carries a client name, a title or any words');
}

(async () => {
  const want = String(process.env.WORKLOAD_REPORTS_ENGINES || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);
  for (const name of want) {
    const engine = name === 'webkit' ? webkit : chromium;
    if (name === 'webkit') {
      let usable = true;
      try { const b = await webkit.launch(); await b.close(); } catch (e) { usable = false; }
      if (!usable) {
        if (process.env.WORKLOAD_REPORTS_REQUIRE_WEBKIT === '1') throw new Error('WebKit is required here and is not installed');
        console.log('  skip [webkit] not installed here (CI runs it)');
        continue;
      }
    }
    await run(name, engine);
  }
  console.log('workload-reports-browser: Workload reports dropped moves, failures that recovered, reloads mid-save and uncaught errors, with no words ✅');
})().catch(e => { console.error(e); process.exit(1); });
