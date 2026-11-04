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
// The requests the fixture is holding unanswered (state.writeHang / gatewayHang), dropped once their page has gone:
// they never reach the server, and the browser does not keep their connections open for the next page.
const releaseHung = t => { const h = t.state.hung || []; t.state.hung = []; h.forEach(f => { try { f(); } catch (e) {} }); };
// WebKit reports a request the reload cancels as "Fetch API cannot load .../<function> due to access control checks".
// Only the two requests this test cuts off on purpose (the status write and the reload's own report) are excused:
// review-stage-phone and review-stage-player-leaving fixed the cause of the same wording, because there it was a
// page fault (a request asked again after its page had moved on).
const pageErrors = t => t.errors.filter(e => !/\/functions\/v1\/(production-write|write-diagnostics) due to access control checks/.test(e));
// reload: the same tab loaded again where Cmd-R on Kasper's board lands (the /kasper route stub hands the page to
// /?sv_path=/kasper#kasper), not the page opened again by /index.html. The requests the fixture holds are dropped as
// it starts, as a browser cancels its requests in flight.
// Not page.reload(): Playwright-WebKit crashes on the stub's location.replace hop, which real Safari runs on every Cmd-R (Kasper, daily, no reports).
async function goKasper(t, origin, afterGoto, reload) {
  if (reload) { const r = t.page.goto(origin + '/?sv_path=/kasper#kasper', { waitUntil: 'domcontentloaded' }); if (afterGoto) afterGoto(); await r; afterGoto = null; }
  else await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  if (afterGoto) afterGoto();
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
    // The requests already on their way stay slow (the server finishes them after the page has gone); the next page's
    // own are answered at once, as live, where the line was answering again by then. A line that stays slow after
    // the reload stalls the next page's re-send and loses the change's words: reported separately (OPEN_REPAIRS 685 notes it).
    Object.assign(t.state, { writeDelay: 0, gatewayDelay: 0 });
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
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
    // The review stage reports this reload (with its card, part and action, and later its landing). The Calendar's own
    // reload report, which has no card and never a landing, must not report it a second time on the client link: the
    // watcher read that one as a client still blocked (live, 4 Nov).
    const cardSave = t.beacons.filter(b => b.operation === 'calendar_reload_mid_save');
    expect(cardSave.length === 0, '1: the reload is reported once, by the review stage, not also by the Calendar (' + cardSave.map(b => (b.env && b.env.code) || '').join(',') + ')');
    expect(noWords(t.beacons), '1: no words, titles or names in any report');
    expect(pageErrors(t).length === 0, '1: no page errors (' + pageErrors(t).join(' | ') + ')');
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
    releaseHung(t);
    await waitNew(t);
    const rep2 = await until(async () => reloads(t).some(b => b.env && b.env.code === 'tweak'), 10000);
    expect(rep2 >= 0, '2: the reload during the save is reported');
    await sleep(8000);
    expect(card(t).video_status !== 'Tweaks Needed', '2: (control) the lost save is not on the server (' + card(t).video_status + ')');
    expect(!reloads(t).some(b => b.env && b.env.code === 'landed_after_retry'), '2: nothing says a lost save landed');
    await t.ctx.close();

    // 3. Kasper's board: the interrupted approve never lands, and he approves again during the watch. His board shows
    //    the approve at once while his own save is still running (and never answered): that is not a landing.
    //    Twice: the page opened again by address (goKasper), and a real reload of the same tab (Cmd-R).
    for (const how of ['goto', 'reload']) {
      console.log('--- 3 (' + how + '). Kasper approves again while the lost approve is watched ---');
      t = await open(browser, origin, KASPER);
      await watchBeacons(t);
      await goKasper(t, origin);
      Object.assign(t.state, { gatewayHang: true, writeHang: true });
      await inS(t.page, '.pn-d[data-pd="video"] [data-ok]').first().click();
      await sleep(700);
      const noteBefore = await t.page.evaluate(() => { try { return !!(sessionStorage.getItem('syncview_rs_inflight_v1') || localStorage.getItem('syncview_rs_inflight_v1')); } catch (e) { return 'err'; } });
      const heldBefore = (t.state.hung || []).length;
      // What the next page finds (read only; nothing changes): the note in each store when it starts, and when its
      // review board first mounts (the board reads and clears the note as it mounts), with the time since navigation.
      await t.ctx.addInitScript(() => {
        const k = 'syncview_rs_inflight_v1';
        const has = () => { try { return { s: !!sessionStorage.getItem(k), l: !!localStorage.getItem(k) }; } catch (e) { return 'err'; } };
        window.__rsNoteAtStart = has();
        try {
          const mo = new MutationObserver(() => {
            const h = document.getElementById('svReviewStage'); const app = h && h.shadowRoot && h.shadowRoot.getElementById('rsApp');
            if (!app || window.__rsAtMount) return;
            window.__rsAtMount = Object.assign({ ms: Math.round(performance.now()), mode: app.getAttribute('data-mode'), hidden: !!h.hidden }, has());
            mo.disconnect();
          });
          mo.observe(document, { childList: true, subtree: true });
        } catch (e) {}
      });
      const diagSeen = [];
      t.page.on('request', r => { if (/\/functions\/v1\/write-diagnostics/.test(r.url())) diagSeen.push(r.method()); });
      t.page.on('requestfailed', r => { if (/\/functions\/v1\/write-diagnostics/.test(r.url())) diagSeen.push('failed:' + ((r.failure() && r.failure().errorText) || '').slice(0, 60)); });
      // What the tab itself did from here (seconds since the reload): a crash or close, its navigations and loads.
      const t0nav = Date.now(), tabEvents = [];
      const ev = name => () => tabEvents.push(name + '@' + ((Date.now() - t0nav) / 1000).toFixed(1));
      t.page.on('crash', ev('crash')); t.page.on('close', ev('close'));
      t.page.on('domcontentloaded', ev('dcl')); t.page.on('load', ev('load'));
      t.page.on('framenavigated', f => { if (f === t.page.mainFrame()) ev('nav')(); });
      // Requests after the reload by path (top 6), and console errors: a loop on the next page shows as a storm here.
      const reqCount = {}; let consoleErrors = 0;
      t.page.on('request', r => { try { const u = new URL(r.url()); const k = u.pathname.replace(/[0-9a-f]{8,}/g, '#').slice(0, 60); reqCount[k] = (reqCount[k] || 0) + 1; } catch (e) {} });
      t.page.on('console', m => { if (m.type() === 'error') consoleErrors++; });
      const topReqs = () => Object.entries(reqCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
      try {
        await goKasper(t, origin, () => releaseHung(t), how === 'reload');
      } catch (e) {
        // The next page never showed his board: say what the tab did, count it as a miss, and go on to the next case.
        console.log('RELOAD3_TRACE ' + JSON.stringify({ how, noteBefore, heldBefore, heldNow: (t.state.hung || []).length, boardNeverShown: String(e && e.message || e).split('\n')[0].slice(0, 120), tab: tabEvents, requests: topReqs(), consoleErrors, reports: t.beacons.map(b => b.operation + ':' + ((b.env && b.env.code) || '')), diag: diagSeen }));
        expect(false, '3 (' + how + '): the reload during his approve is reported (his board did not come back)');
        await t.ctx.close().catch(() => {});
        continue;
      }
      const rep3 =await until(async () => reloads(t).some(b => b.env && b.env.code === 'approve'), 15000);
      // On a miss, what the test saw (fictional fixture data): the note before the reload, the requests the fixture held
      // then and now, the reports that arrived, the note at the next page's start and at its board's mount (with the
      // time since navigation and the board's mode), the note now, and the diagnostics requests the next page made.
      if (rep3 < 0) {
        const after = await t.page.evaluate(() => { const k = 'syncview_rs_inflight_v1'; const h = document.getElementById('svReviewStage'); const app = h && h.shadowRoot && h.shadowRoot.getElementById('rsApp');
          return { atStart: window.__rsNoteAtStart || null, atMount: window.__rsAtMount || null, nowS: !!sessionStorage.getItem(k), nowL: !!localStorage.getItem(k), stage: !!(h && !h.hidden), mode: app ? app.getAttribute('data-mode') : null, ms: Math.round(performance.now()) }; }).catch(e => ({ err: String(e && e.message).slice(0, 80) }));
        console.log('RELOAD3_TRACE ' + JSON.stringify({ how, noteBefore, heldBefore, heldNow: (t.state.hung || []).length, reports: t.beacons.map(b => b.operation + ':' + ((b.env && b.env.code) || '')), next: after, tab: tabEvents, diag: diagSeen }));
      }
      expect(rep3 >= 0, '3 (' + how + '): the reload during his approve is reported');
      const again = inS(t.page, '.pn-d[data-pd="video"] [data-ok]').first();
      if (await again.count()) await again.click({ timeout: 3000 }).catch(() => {});
      await sleep(6000);
      const saving3 = await t.page.evaluate(() => { const i = _kasperState.items.find(x => x.post && x.post.id === 'rs1'); return !!(i && i._saving && i._saving.video); });
      expect(card(t).video_status === 'Kasper Approval', '3 (' + how + '): (control) nothing reached the server (' + card(t).video_status + ', his save still running: ' + saving3 + ')');
      expect(!reloads(t).some(b => b.env && b.env.code === 'landed_after_retry'), '3 (' + how + '): his board showing the approve while it saves is not taken for a landing');
      await t.ctx.close();
    }

    // 3c. Control for the real reload: Kasper's board reloaded with nothing saving and nothing held. It must come back;
    //     if it does not, the reload itself is at fault, not the save it interrupts.
    console.log('--- 3c. Kasper reloads his board with nothing saving ---');
    t = await open(browser, origin, KASPER);
    await goKasper(t, origin);
    {
      const t0c = Date.now(), tabC = []; const evc = name => () => tabC.push(name + '@' + ((Date.now() - t0c) / 1000).toFixed(1));
      t.page.on('crash', evc('crash')); t.page.on('close', evc('close')); t.page.on('domcontentloaded', evc('dcl')); t.page.on('load', evc('load'));
      const reqC = {}; t.page.on('request', r => { try { const k = new URL(r.url()).pathname.replace(/[0-9a-f]{8,}/g, '#').slice(0, 60); reqC[k] = (reqC[k] || 0) + 1; } catch (e) {} });
      let back = true, why = '';
      try { await goKasper(t, origin, null, true); } catch (e) { back = false; why = String(e && e.message || e).split('\n')[0].slice(0, 120); }
      if (!back) console.log('RELOAD3C_TRACE ' + JSON.stringify({ why, tab: tabC, requests: Object.entries(reqC).sort((a, b) => b[1] - a[1]).slice(0, 6) }));
      expect(back, '3c: (control) his board comes back after a reload with nothing saving');
    }
    await t.ctx.close().catch(() => {});

    // 4. The order WebKit uses when a page with a save in flight goes: the page is leaving, then its unanswered request
    //    fails back to it, then the next page loads. Seen on case 3 in WebKit (4 Nov): the old page took its save as
    //    stopped and cleared its note of it on the way out, so the next page had nothing to report. Here the order is
    //    made by hand, so both engines see it every time.
    console.log('--- 4. the page leaves, then its unanswered approve fails, then the next page loads ---');
    t = await open(browser, origin, KASPER);
    await watchBeacons(t);
    await goKasper(t, origin);
    Object.assign(t.state, { gatewayHang: true, writeHang: true });
    await inS(t.page, '.pn-d[data-pd="video"] [data-ok]').first().click();
    await sleep(700);
    // The page is leaving; then its request fails back to it and every retry is refused at once, so the save ends with
    // an error while the page is still there, as it did on WebKit's way out.
    await t.page.evaluate(() => { window.dispatchEvent(new Event('beforeunload')); window.dispatchEvent(new Event('pagehide')); });
    Object.assign(t.state, { gatewayHang: false, writeHang: false, writeFail: 50 });
    releaseHung(t);
    // Past the 3 s in which an entry that stopped is dropped, and past the save's own end: the note must still be there
    // for the next page (without the fix it went within 5 s, in both engines).
    await sleep(4500);
    const kept = await t.page.evaluate(() => { const k = 'syncview_rs_inflight_v1'; return { s: !!sessionStorage.getItem(k), l: !!localStorage.getItem(k) }; });
    const ended = await t.page.evaluate(() => { const i = _kasperState.items.find(x => x.post && x.post.id === 'rs1'); return !(i && i._saving && i._saving.video); });
    expect(ended, '4: (control) the leaving page\'s save has ended');
    expect(kept.s && kept.l, '4: the leaving page keeps its note of the save after its request failed (' + JSON.stringify(kept) + ')');
    t.state.writeFail = 0;
    await goKasper(t, origin);
    const rep4 = await until(async () => reloads(t).some(b => b.env && b.env.code === 'approve'), 15000);
    expect(rep4 >= 0, '4: the next page reports the reload during his approve');
    expect(!reloads(t).some(b => b.env && b.env.code === 'landed_after_retry'), '4: and never says it landed');
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
