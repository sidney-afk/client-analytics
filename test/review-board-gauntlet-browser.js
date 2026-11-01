'use strict';
/*
 * KASPER'S REVIEW BOARD AND THE CLIENT LINK UNDER KASPER'S OWN CONDITIONS (OPEN_REPAIRS 626, session Reviewguard,
 * 2026-11-01). Kasper said he sometimes has to approve twice. Real browsers (Chromium, and WebKit, Mac Safari's
 * engine, wherever it is installed; CI requires it with REVIEW_GAUNTLET_REQUIRE_WEBKIT=1), fully offline on the shared
 * review-stage fixture (fictional client, cards and people), his live setup (the Review Session, second layout, fast
 * boot), server times close to the live ones (permission read 40 ms, each production-write 900 ms, the card write
 * 650 ms), and the database's own copy of a native status onto its card (`project`).
 *
 *  1. Three Approves in a row on one card (video, graphic, caption), as his second layout invites: all three reach the
 *     server, and a refresh does not bring the card back. FAILED ON MAIN: the caption stayed at Kasper Approval while
 *     the screen said Approved and the card left his list; the next refresh brought it back. Also caption then video.
 *  2. A double click on Approve: one status write and one card write.
 *  3. A slow line (6 s per write): the part says it is still waiting, then lands approved.
 *  4. A dropped answer (the card write lands, its answer is lost): the part is not left waiting after a refresh.
 *  5. A reload while the approve saves: after the reload the part does not wait, and the page reported the reload.
 *  6. Two tabs: the approve in one; the other, brought to the front, shows it approved and sends nothing again.
 *  7. A tab left open five hours, then used: the approve lands.
 *  8. A nearly full browser store: the approve lands; a refused save is reported with the store's fill (all of it).
 *  9. An uncaught error on the board is reported by kind and place only, never its message.
 * 10. The client link: a double tap on Approve sends one approve; a refused approve is reported with its code.
 * Every report: ids and codes only, never a client name, a card title or typed words.
 */
const { chromium, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, openClient, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let engineName = '';
function expect(value, message) { const m = '[' + engineName + '] ' + message; if (!value) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

const LIVE = { authorityDelay: 40, gatewayDelay: 900, writeDelay: 650 };
const KASPER = { stage: 'kasper', flags: 'on', staff: STAFF, layout2: true, fast: true, expectNew: true, linkedParts: true, mergeComments: true, nativeReceipts: true, project: true };
const part = p => '.pn-d[data-pd="' + p + '"]';
const rowText = (t, p) => inS(t.page, part(p)).first().innerText({ timeout: 1000 }).catch(() => '');
const card = (t, id) => t.state.cards.find(c => c.id === (id || 'rs1'));
const statusWrites = (t, from) => t.state.gateway.slice(from || 0).map(b => { try { return JSON.parse(b); } catch (e) { return {}; } }).filter(b => b.operation === 'status');

// Reports are caught where they arrive (a route), so one sent by a page that is going away is caught too.
async function watchBeacons(t) {
  const list = t.beacons = [];
  await t.ctx.route('**/functions/v1/write-diagnostics', route => {
    const r = route.request();
    if (r.method() === 'POST') { try { list.push(JSON.parse(r.postData() || '{}')); } catch (e) { list.push({ raw: r.postData() }); } }
    return route.fulfill({ status: r.method() === 'OPTIONS' ? 204 : 202, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' }, contentType: 'application/json', body: r.method() === 'OPTIONS' ? '' : '{"ok":true}' });
  });
  return list;
}
async function goKasper(t, origin) {
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
  await sleep(1800);
}
async function openKasper(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({}, KASPER, o || {}));
  await watchBeacons(t);
  await goKasper(t, origin);
  Object.assign(t.state, LIVE);
  return t;
}
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(100); } return -1; }
async function refreshBoard(t) {
  await t.page.evaluate(() => _kasperLoadReview(true));
  await until(() => t.page.evaluate(() => !_kasperState.loading), 10000);
  await sleep(600);
}
const inList = (t, id) => t.page.evaluate(pid => _kasperState.items.some(i => i.post && i.post.id === pid), id || 'rs1');
const noWords = (beacons) => !JSON.stringify(beacons).match(/Fixture Studio|first second matters|Why the first|calmer week|secret words/i);

async function burst(browser, origin, order) {
  const t = await openKasper(browser, origin);
  for (const p of order) { await inS(t.page, part(p) + ' [data-ok]').first().click(); await sleep(250); }
  const done = await until(async () => order.every(p => card(t)[p + '_status'] === 'Client Approval') && !(await t.page.evaluate(() => _kasperState.items.some(i => i._persistChain && i._saving && Object.values(i._saving).some(Boolean)))), 15000);
  await sleep(1500);
  const c = card(t);
  expect(order.every(p => c[p + '_status'] === 'Client Approval'), '1 (' + order.join(', ') + '): every part approved reaches the server (server: video ' + c.video_status + ', graphic ' + c.graphic_status + ', caption ' + c.caption_status + '; ' + done + ' ms)');
  await refreshBoard(t);
  const back = await t.page.evaluate(parts => { const i = _kasperState.items.find(x => x.post.id === 'rs1'); return i ? parts.filter(p => i.post[p + '_status'] === 'Kasper Approval') : []; }, order);
  expect(!back.length, '1 (' + order.join(', ') + '): after a refresh no approved part waits for him again (' + back.join(', ') + ')');
  if (order.length === 3) expect(!(await inList(t)), '1: with every part approved the card does not come back to his list');
  expect(t.errors.length === 0, '1: no page errors (' + t.errors.join(' | ') + ')');
  await t.ctx.close();
}

async function runEngine(browserType, origin) {
  const browser = await browserType.launch();
  try {
    // 1. three approves in a row (the bug), and caption before video
    console.log('--- 1. approves in a row on one card ---');
    await burst(browser, origin, ['video', 'graphic', 'caption']);
    await burst(browser, origin, ['caption', 'video']);

    // 2. a double click
    console.log('--- 2. a double click on Approve ---');
    let t = await openKasper(browser, origin);
    let g0 = t.state.gateway.length, u0 = t.state.upserts.length;
    await inS(t.page, part('video') + ' [data-ok]').first().dblclick();
    await until(async () => card(t).video_status === 'Client Approval' && t.state.upserts.length > u0, 10000);
    await sleep(2500);
    expect(statusWrites(t, g0).length === 1, '2: one status write (' + statusWrites(t, g0).length + ')');
    expect(t.state.upserts.length - u0 === 1, '2: one card write (' + (t.state.upserts.length - u0) + ')');
    expect(/Approved/.test(await rowText(t, 'video')), '2: the video shows approved');
    await t.ctx.close();

    // 3. a slow line
    console.log('--- 3. a slow line ---');
    t = await openKasper(browser, origin);
    Object.assign(t.state, { gatewayDelay: 6000, writeDelay: 6000 });
    await inS(t.page, part('video') + ' [data-ok]').first().click();
    const landed = await until(async () => card(t).video_status === 'Client Approval' && t.state.upserts.length > 0, 25000);
    await sleep(1500);
    expect(landed >= 0, '3: the approve lands on a slow line (' + landed + ' ms)');
    expect(/Approved/.test(await rowText(t, 'video')) && !(await inS(t.page, '[data-err]').count()), '3: the part shows approved, no error');
    await t.ctx.close();

    // 4. a dropped answer
    console.log('--- 4. the card write lands, its answer is lost ---');
    t = await openKasper(browser, origin);
    t.state.dropAfter = 1;
    await inS(t.page, part('caption') + ' [data-ok]').first().click();
    await until(async () => card(t).caption_status === 'Client Approval', 10000);
    await sleep(3000);
    await refreshBoard(t);
    const capAfter = await t.page.evaluate(() => { const i = _kasperState.items.find(x => x.post.id === 'rs1'); return i ? i.post.caption_status : 'gone'; });
    expect(card(t).caption_status === 'Client Approval', '4: the server holds the caption approved');
    expect(capAfter !== 'Kasper Approval', '4: after a refresh the caption is not waiting for him again (' + capAfter + ')');
    await t.ctx.close();

    // 5. a reload during the save
    console.log('--- 5. a reload while the approve saves ---');
    t = await openKasper(browser, origin);
    Object.assign(t.state, { gatewayDelay: 3000 });
    await inS(t.page, part('video') + ' [data-ok]').first().click();
    await sleep(600);
    await goKasper(t, origin);
    // The board reads the cards again 4 s after it opens (then at 10 s); the slow server finished meanwhile.
    await until(() => t.page.evaluate(() => { const i = _kasperState.items.find(x => x.post.id === 'rs1'); return !i || i.post.video_status !== 'Kasper Approval'; }), 9000);
    const vAfter = await t.page.evaluate(() => { const i = _kasperState.items.find(x => x.post.id === 'rs1'); return i ? i.post.video_status : 'gone'; });
    expect(vAfter !== 'Kasper Approval', '5: after the reload the video is not waiting for him again (' + vAfter + ', server ' + card(t).video_status + ')');
    const reloadRep = t.beacons.find(b => b.operation === 'review_reload_during_save');
    expect(!!reloadRep && reloadRep.env && reloadRep.env.code === 'approve', '5: the reload during the save was reported (' + JSON.stringify(reloadRep || null) + ')');
    expect(noWords(t.beacons), '5: no names, titles or words in any report');
    await t.ctx.close();

    // 6. two tabs
    console.log('--- 6. two tabs ---');
    const a = await openKasper(browser, origin);
    const b = await open(browser, origin, Object.assign({}, KASPER, { state: a.state }));
    await watchBeacons(b);
    await goKasper(b, origin);
    await a.page.bringToFront();
    await inS(a.page, part('video') + ' [data-ok]').first().click();
    await until(async () => card(a).video_status === 'Client Approval' && a.state.upserts.length > 0, 10000);
    await sleep(1500);
    await b.page.bringToFront();
    await b.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    const caught = await until(async () => /Approved/.test(await rowText(b, 'video')) || !(await inS(b.page, part('video') + ' [data-ok]').count()), 8000);
    expect(caught >= 0, '6: the other tab shows the video approved once it is in front (' + caught + ' ms: "' + (await rowText(b, 'video')).replace(/\s+/g, ' ') + '")');
    g0 = a.state.gateway.length; u0 = a.state.upserts.length;
    if (await inS(b.page, part('video') + ' [data-ok]').count()) { await inS(b.page, part('video') + ' [data-ok]').first().click({ timeout: 2000 }).catch(() => {}); }
    await sleep(2500);
    expect(statusWrites(a, g0).length === 0, '6: the other tab sends no second approve');
    await a.ctx.close(); await b.ctx.close();

    // 7. a tab left open for hours
    console.log('--- 7. a tab left open five hours ---');
    t = await openKasper(browser, origin, { clock: true });
    await t.page.clock.fastForward(5 * 3600000);
    await t.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    for (let i = 0; i < 4; i++) { await t.page.clock.runFor(1000); await sleep(200); }
    await inS(t.page, part('video') + ' [data-ok]').first().click();
    let ok7 = -1;
    for (let i = 0; i < 30 && ok7 < 0; i++) { await t.page.clock.runFor(500); await sleep(150); if (card(t).video_status === 'Client Approval' && t.state.upserts.length > 0) ok7 = i; }
    expect(ok7 >= 0, '7: after five hours open, the approve lands (server ' + card(t).video_status + ')');
    expect(t.errors.length === 0, '7: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 8. a nearly full store
    console.log('--- 8. a nearly full browser store ---');
    t = await openKasper(browser, origin);
    const filled = await t.page.evaluate(() => {
      // One key the page never frees, filled until the browser refuses more, then 4,000 characters given back.
      let chunk = 'x'.repeat(1 << 20), big = '';
      for (;;) { try { localStorage.setItem('fixture_full_store', big + chunk); big += chunk; } catch (e) { if (chunk.length <= 16) break; chunk = chunk.slice(0, chunk.length >> 1); } }
      localStorage.setItem('fixture_full_store', big.slice(0, Math.max(0, big.length - 4000)));
      return big.length;
    });
    await inS(t.page, part('video') + ' [data-ok]').first().click();
    const ok8 = await until(async () => card(t).video_status === 'Client Approval' && t.state.upserts.length > 0, 12000);
    expect(ok8 >= 0, '8: with the store nearly full (' + filled + ' characters of filler) the approve lands');
    t.state.writeFail = 1;
    await inS(t.page, part('caption') + ' [data-ok]').first().click();
    const rep8 = await until(async () => t.beacons.some(x => x.operation === 'review_approve'), 15000);
    const r8 = t.beacons.find(x => x.operation === 'review_approve') || {};
    expect(rep8 >= 0 && r8.env && r8.env.storage_kc >= Math.floor(filled / 1000) - 10 && r8.env.storage_pct >= Math.min(99, Math.floor(filled / 5242880 * 100) - 1) && r8.env.code && r8.identifiers && r8.identifiers.card === 'rs1' && r8.identifiers.component === 'caption', '8: the refused approve is reported with its code and the store\'s fill (' + JSON.stringify(r8.env || null) + ')');
    expect(noWords(t.beacons), '8: no names, titles or words in any report');
    await t.ctx.close();

    // 9. an uncaught error
    console.log('--- 9. an uncaught error on the board ---');
    t = await openKasper(browser, origin);
    await t.page.evaluate(() => { setTimeout(() => { throw new TypeError('secret words from a card title'); }, 0); });
    const rep9 = await until(async () => t.beacons.some(x => x.operation === 'review_page_error'), 5000);
    const r9 = t.beacons.find(x => x.operation === 'review_page_error') || {};
    expect(rep9 >= 0 && r9.env && r9.env.code === 'uncaught_error' && /^TypeError/.test(String(r9.message || '')), '9: the error is reported by kind and place (' + JSON.stringify({ message: r9.message, env: r9.env }) + ')');
    expect(noWords(t.beacons), '9: its message is not in the report');
    await t.ctx.close();

    // 10. the client link
    console.log('--- 10. the client link ---');
    t = await openClient(browser, origin, { flags: 'on', polish: true, linkedParts: true, mergeComments: true, nativeReceipts: true, project: true });
    await watchBeacons(t);
    await waitNew(t); await sleep(1500);
    Object.assign(t.state, LIVE);
    g0 = t.state.gateway.length; u0 = t.state.upserts.length;
    await inS(t.page, '#drow [data-ok]').first().dblclick();
    await until(async () => card(t).video_status === 'Approved', 10000);
    await sleep(2500);
    expect(card(t).video_status === 'Approved', '10: the client\'s approve lands');
    expect(statusWrites(t, g0).filter(b => b.status === 'approved' || /approv/.test(String(b.status))).length <= 1 && t.state.upserts.length - u0 <= 1, '10: a double tap sends one approve (' + statusWrites(t, g0).length + ' status, ' + (t.state.upserts.length - u0) + ' card writes)');
    t.state.refusal = { code: 'client_scope_mismatch', status: 403 };   // a lasting refusal (a passing one is retried and lands)
    const b10 = inS(t.page, '#drow [data-ok]').first();
    if (await b10.count()) await b10.click();
    const rep10 = await until(async () => t.beacons.some(x => x.operation === 'review_approve' && x.page === 'client_link'), 15000);
    const r10 = t.beacons.find(x => x.operation === 'review_approve') || {};
    expect(rep10 >= 0 && r10.env && r10.env.code && typeof r10.env.storage_pct === 'number', '10: a refused client approve is reported with its code and the store\'s fill (' + JSON.stringify(r10.env || null) + ')');
    expect(noWords(t.beacons), '10: no names, titles or words in any report');
    expect(t.errors.length === 0, '10: no page errors (' + t.errors.join(' | ') + ')');
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
    const only = String(process.env.REVIEW_GAUNTLET_ENGINES || '').split(',').filter(Boolean);
    for (const [name, type] of engines) {
      if (only.length && !only.includes(name)) continue;
      engineName = name;
      let probe = null;
      try { probe = await type.launch(); } catch (e) { probe = null; }
      if (!probe) {
        if (name === 'webkit' && process.env.REVIEW_GAUNTLET_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
        else console.log('(' + name + ' is not installed here: skipped)');
        continue;
      }
      await probe.close();
      console.log('===== ' + name + ' =====');
      await runEngine(type, origin);
    }
  } finally { server.close(); }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nKasper\'s review board and the client link under his conditions: all passed');
})().catch(e => { console.error(e); process.exit(1); });
