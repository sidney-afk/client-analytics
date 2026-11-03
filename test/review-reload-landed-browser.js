'use strict';
/*
 * A reload while a client's change request is saving, and the save lands anyway (session Reviewguard, 2026-11-03).
 *
 * Seen (read-only, live): a real client on iPhone Safari asked for a change on a video. The page reloaded while
 * that save was still running, and the next page sent `review_reload_mid_save` (code tweak). The change had
 * landed: the card read Tweaks Needed with the note, one status change and one comment, nothing sent twice. But
 * nothing ever said so. The watcher's signature read only marks a report `retry_landed` when a `landed_after_retry`
 * for the same card, part and action follows, and nothing sent one for a reload. So every reload read as a
 * blocked client.
 *
 * On the review-stage fixture (fictional client and cards, nothing live), the client link, Chromium and WebKit:
 *   1. a change request on the video, a slow line, a reload mid-save, the save landing on the server: the next page
 *      reports the reload (code tweak), then, once the card it read shows the change, `landed_after_retry` for the
 *      same card, part and action;
 *   2. the same with a save that never lands (the server answers no save, before or after the reload, and the card
 *      stays waiting): the reload is reported and nothing says it landed.
 *   3. Kasper's board, the interrupted approve never landing, and Kasper approving again during the watch: his board
 *      shows the approve while his own save is still running, and that is not taken for a landing (Codex on #2576).
 * No words, titles or names in any report. On main, 1 fails: no "landed" report follows the reload.
 */
const { chromium, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let engineName = '';
function expect(value, message) { const m = '[' + engineName + '] ' + message; if (!value) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(100); } return -1; }
const card = t => t.state.cards.find(c => c.id === 'rs1');
const noWords = b => !JSON.stringify(b).match(/Fixture Studio|bigger please|first second|secret words/i);

// Reports are caught where they arrive (a route), so one sent by a page that is going away is caught too.
async function watchBeacons(t) {
  const list = t.beacons = [];
  await t.ctx.route('**/functions/v1/write-diagnostics', route => {
    const r = route.request();
    if (r.method() === 'POST') { try { list.push(JSON.parse(r.postData() || '{}')); } catch (e) { list.push({ raw: r.postData() }); } }
    return route.fulfill({ status: r.method() === 'OPTIONS' ? 204 : 202, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' }, contentType: 'application/json', body: r.method() === 'OPTIONS' ? '' : '{"ok":true}' });
  });
}
const url = origin => origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN });
async function openClientReview(browser, origin) {
  const t = await open(browser, origin, { stage: 'client', flags: 'on', polish: true, linkedParts: true, mergeComments: true, nativeReceipts: true, project: true });
  await watchBeacons(t);
  await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1500);
  return t;
}
async function askChangeOnVideo(t) {
  await inS(t.page, '#ta').fill('The music bigger please, under the voice.');
  await inS(t.page, '[data-pc="video"]').click();
  await inS(t.page, '#sendBtn').click();
}
const reloads = t => t.beacons.filter(b => b.operation === 'review_reload_mid_save');
const KASPER = { stage: 'kasper', flags: 'on', staff: STAFF, layout2: true, fast: true, expectNew: true, linkedParts: true, mergeComments: true, nativeReceipts: true, project: true };
async function goKasper(t, origin) {
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
  await sleep(1800);
}

async function runEngine(browserType, origin) {
  const browser = await browserType.launch();
  try {
    // 1. the save lands after the reload
    console.log('--- 1. a reload while the change request saves; the save lands ---');
    let t = await openClientReview(browser, origin);
    Object.assign(t.state, { writeDelay: 3000, gatewayDelay: 3000 });
    await askChangeOnVideo(t);
    await sleep(700);
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    Object.assign(t.state, { writeDelay: 0, gatewayDelay: 0 });
    const onServer = await until(async () => card(t).video_status === 'Tweaks Needed', 15000);
    expect(onServer >= 0, '1: the change request lands on the server after the reload (' + card(t).video_status + ')');
    const rep = await until(async () => reloads(t).some(b => b.env && b.env.code === 'tweak'), 10000);
    expect(rep >= 0, '1: the next page reports the reload during the save (code tweak)');
    const landed = await until(async () => reloads(t).some(b => b.env && b.env.code === 'landed_after_retry'), 20000);
    const first = reloads(t).find(b => b.env && b.env.code === 'tweak') || {};
    const land = reloads(t).find(b => b.env && b.env.code === 'landed_after_retry') || {};
    expect(landed >= 0 && land.env.part === 'video' && land.env.board === 'client' && land.identifiers && first.identifiers && land.identifiers.card && land.identifiers.card === first.identifiers.card,
      '1: once the card shows the change, the page says the save landed, for the same card and part (' + JSON.stringify(land.env || null) + ')');
    expect(reloads(t).filter(b => b.env && b.env.code === 'landed_after_retry').length === 1, '1: it says so once');
    expect(noWords(t.beacons), '1: no words, titles or names in any report');
    expect(t.errors.length === 0, '1: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 2. the save never lands
    console.log('--- 2. a reload while the change request saves; the save never lands ---');
    t = await openClientReview(browser, origin);
    Object.assign(t.state, { writeHang: true, gatewayHang: true });
    await askChangeOnVideo(t);
    await sleep(700);
    // The next page's own reads work; its saves still get no answer, so the change never reaches the server (the
    // next page retries it from its recovery copy, and that retry lands as soon as the line answers: not here).
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    const rep2 = await until(async () => reloads(t).some(b => b.env && b.env.code === 'tweak'), 10000);
    expect(rep2 >= 0, '2: the reload during the save is reported');
    await sleep(8000);
    expect(card(t).video_status !== 'Tweaks Needed', '2: (control) the lost save is not on the server (' + card(t).video_status + ')');
    expect(!reloads(t).some(b => b.env && b.env.code === 'landed_after_retry'), '2: nothing says a lost save landed');
    await t.ctx.close();

    // 3. Kasper's board: the interrupted approve never lands, and he approves again during the watch. His board shows
    //    the approve at once while his own save is still running (and never answered): that is not a landing.
    console.log('--- 3. Kasper approves again while the lost approve is watched ---');
    t = await open(browser, origin, KASPER);
    await watchBeacons(t);
    await goKasper(t, origin);
    Object.assign(t.state, { gatewayHang: true, writeHang: true });
    await inS(t.page, '.pn-d[data-pd="video"] [data-ok]').first().click();
    await sleep(700);
    await goKasper(t, origin);
    const rep3 = await until(async () => reloads(t).some(b => b.env && b.env.code === 'approve'), 10000);
    expect(rep3 >= 0, '3: the reload during his approve is reported');
    const again = inS(t.page, '.pn-d[data-pd="video"] [data-ok]').first();
    if (await again.count()) await again.click({ timeout: 3000 }).catch(() => {});
    await sleep(6000);
    const saving3 = await t.page.evaluate(() => { const i = _kasperState.items.find(x => x.post && x.post.id === 'rs1'); return !!(i && i._saving && i._saving.video); });
    expect(card(t).video_status === 'Kasper Approval', '3: (control) nothing reached the server (' + card(t).video_status + ', his save still running: ' + saving3 + ')');
    expect(!reloads(t).some(b => b.env && b.env.code === 'landed_after_retry'), '3: his board showing the approve while it saves is not taken for a landing');
    await t.ctx.close();
  } finally {
    await browser.close();
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const engines = [['chromium', chromium], ['webkit', webkit]];
    const only = String(process.env.REVIEW_RELOAD_ENGINES || '').split(',').filter(Boolean);
    for (const [name, type] of engines) {
      if (only.length && !only.includes(name)) continue;
      engineName = name;
      let probe = null;
      try { probe = await type.launch(); } catch (e) { probe = null; }
      if (!probe) {
        if (name === 'webkit' && process.env.REVIEW_RELOAD_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
        else console.log('(' + name + ' is not installed here: skipped)');
        continue;
      }
      await probe.close();
      console.log('===== ' + name + ' =====');
      await runEngine(type, origin);
    }
  } finally { server.close(); }
  if (failures.length) { console.error('\nreview-reload-landed-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nreview-reload-landed-browser: a reload during a save that lands says it landed; a lost one does not ✅');
})().catch(e => { console.error(e); process.exit(1); });
