'use strict';
/*
 * OPEN_REPAIRS 691 (session Reviewguard, 2026-11-03): a client's change request, a reload while it saves, and a line that
 * stays slow afterwards. The change's words must reach the server, or the page must say they were not sent, with a
 * way to send them again. Never "saving" for good.
 *
 * Found while building 685 (review-reload-landed-browser): on that fixture, with the line still slow after the reload,
 * the card reached Tweaks Needed but the client's words never reached the server, and the next page stayed saving
 * (_calSaveInFlight, _calPendingEdits) for good. Controls: no reload, the words land; a reload and then a fast line,
 * the next page sends them again and they land.
 *
 * On the review-stage fixture (fictional client and cards, nothing live), the client link, Chromium and WebKit:
 *   1. a change request on the video, a 3 s line before and after a reload in the middle of the save: within 40 s the
 *      client's words are on the card on the server, with no second copy, and the page is no longer saving;
 *   2. (control) the same with no reload: the words land;
 *   3. a reload in the middle of the save and every write after it refused: the page stops saving and says the change
 *      was not saved, with Try again.
 * On main, 1 fails: the words never reach the server and the page stays saving.
 */
const { chromium, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let engineName = '';
function expect(value, message) { const m = '[' + engineName + '] ' + message; if (!value) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(200); } return -1; }
const card = t => t.state.cards.find(c => c.id === 'rs1');
const WORDS = 'The music bigger please, under the voice.';
const notesOn = t => { try { return JSON.parse(card(t).video_tweaks || '[]').filter(n => n.body === WORDS); } catch (e) { return []; } };
const url = origin => origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN });
// WebKit reports a request the reload cancels as "... /functions/v1/<fn> due to access control checks": the reload, on purpose.
const pageErrors = t => t.errors.filter(e => !/\/functions\/v1\/(production-write|write-diagnostics|calendar-card-write|calendar-upsert) due to access control checks/.test(e));
const pageState = t => t.page.evaluate(() => ({ saving: !!_calReviewState.saving['rs1|video'], inflight: !!_calSaveInFlight['rs1'], pending: !!_calPendingEdits['rs1'], err: String(_calReviewState.errors['rs1|video'] || '') }));

async function openClientReview(browser, origin) {
  const t = await open(browser, origin, { stage: 'client', flags: 'on', polish: true, linkedParts: true, mergeComments: true, nativeReceipts: true, project: true });
  await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1500);
  return t;
}
async function askChangeOnVideo(t) {
  await inS(t.page, '#ta').fill(WORDS);
  await inS(t.page, '[data-pc="video"]').click();
  await inS(t.page, '#sendBtn').click();
}

async function runEngine(browserType, origin) {
  const browser = await browserType.launch();
  try {
    for (const reload of [true, false]) {
      const n = reload ? '1' : '2';
      console.log('--- ' + n + '. a change request on a 3 s line' + (reload ? ', a reload in the middle of the save' : ' (control: no reload)') + ' ---');
      const t = await openClientReview(browser, origin);
      Object.assign(t.state, { writeDelay: 3000, gatewayDelay: 3000 });
      await askChangeOnVideo(t);
      if (reload) {
        await sleep(700);
        await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
        await waitNew(t);
      }
      const landed = await until(async () => notesOn(t).length > 0, 40000);
      const st = await pageState(t);
      expect(card(t).video_status === 'Tweaks Needed', n + ': the change is on the server (' + card(t).video_status + ')');
      expect(landed >= 0, n + ': the client\'s words reach the server (' + (landed >= 0 ? landed + ' ms' : 'not after 40 s') + '; page ' + JSON.stringify(st) + ', ' + t.state.gateway.length + ' status writes, ' + t.state.upserts.length + ' card writes)');
      expect(notesOn(t).length <= 1, n + ': once, not twice (' + notesOn(t).length + ')');
      await until(async () => { const s = await pageState(t); return !s.saving && !s.inflight; }, 10000);
      const st2 = await pageState(t);
      expect(!st2.saving && !st2.inflight, n + ': the page is no longer saving (' + JSON.stringify(st2) + ')');
      expect(pageErrors(t).length === 0, n + ': no page errors (' + pageErrors(t).join(' | ') + ')');
      await t.ctx.close();
    }

    // 3. the next page's writes are refused: the words cannot land, and the page says so (never saving for good)
    console.log('--- 3. a reload in the middle of the save, and every write after it refused ---');
    const t = await openClientReview(browser, origin);
    Object.assign(t.state, { writeDelay: 3000, gatewayDelay: 3000 });
    await askChangeOnVideo(t);
    await sleep(700);
    Object.assign(t.state, { writeFail: 50 });
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    // The re-send runs, is refused, and ends: the error is on the part and nothing is still saving.
    const settled = await until(async () => { const s = await pageState(t); return !!s.err && !s.saving && !s.inflight; }, 40000);
    const shown = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return { err: !!String(_calReviewState.errors['rs1|video'] || ''), retry: /try again/i.test((r.getElementById('rsApp') || r).innerText) }; });
    expect(settled >= 0, '3: the page stops saving (' + JSON.stringify(await pageState(t)) + ')');
    expect(shown.err && shown.retry, '3: and says the change was not saved, with Try again (' + JSON.stringify(shown) + ')');
    expect(notesOn(t).length === 0, '3: (control) nothing of the refused re-send is on the server');
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
    const only = String(process.env.REVIEW_SLOW_WORDS_ENGINES || '').split(',').filter(Boolean);
    for (const [name, type] of engines) {
      if (only.length && !only.includes(name)) continue;
      engineName = name;
      let probe = null;
      try { probe = await type.launch(); } catch (e) { probe = null; }
      if (!probe) {
        if (name === 'webkit' && process.env.REVIEW_SLOW_WORDS_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
        else console.log('(' + name + ' is not installed here: skipped)');
        continue;
      }
      await probe.close();
      console.log('===== ' + name + ' =====');
      await runEngine(type, origin);
    }
  } finally { server.close(); }
  if (failures.length) { console.error('\nreview-reload-slow-words-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nreview-reload-slow-words-browser: a client\'s words reach the server after a reload on a slow line ✅');
})().catch(e => { console.error(e); process.exit(1); });
