'use strict';
/*
 * OPEN_REPAIRS 697 (session Reviewguard, 2026-11-04): a client's change request, a reload while it saves, and the
 * next page's re-send refused. Measured on main (fixture): the part said "Not saved... Please try again." with an empty
 * change box and no Try again button, and nothing re-sent the change later, on that page or on the next load (one
 * source-only delivery record stayed, never delivered). On the next load the error was gone too: the card looked
 * untouched, and the client's words had never reached the server.
 *
 * On the review-stage fixture (fictional client and cards, nothing live), the client link, Chromium and WebKit:
 *   1. same page: the refusal shows a real Try again button and offers the client's words back; once the line answers,
 *      Try again lands the change exactly once, and a further reload adds no second copy;
 *   2. next load: the change is either on the server, or the part still says it was not sent, with the words and Try
 *      again, and Try again lands it exactly once;
 *   3. a team member's internal change request kept in the same browser's delivery record is never offered to the
 *      client (only the client link's own requests are put back).
 * On main, both fail in both engines.
 */
const { chromium, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let engineName = '';
function expect(value, message) { const m = '[' + engineName + '] ' + message; if (!value) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(250); } return -1; }
const card = t => t.state.cards.find(c => c.id === 'rs1');
const WORDS = 'The music bigger please, under the voice.';
const copies = t => { try { return JSON.parse(card(t).video_tweaks || '[]').filter(n => n.body === WORDS).length; } catch (e) { return -1; } };
const url = origin => origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN });
// What the video part shows: the error block, a real Try again button in it, and whether the client's words are offered
// back (in the error's "Your unsent words", or in the change box).
const partShows = t => t.page.evaluate(words => {
  const r = document.getElementById('svReviewStage').shadowRoot;
  const e = r.querySelector('[data-err="video"]');
  const ta = r.getElementById('ta');
  return { err: !!e, retry: !!(e && e.querySelector('[data-retry="video"]')) || !!r.querySelector('[data-retry="video"]'),
    words: !!(e && (e.textContent || '').includes(words)) || !!(ta && ta.value.includes(words)) };
}, WORDS).catch(() => ({ err: false, retry: false, words: false }));
const pageState = t => t.page.evaluate(() => ({ saving: !!_calReviewState.saving['rs1|video'], inflight: !!_calSaveInFlight['rs1'], err: !!_calReviewState.errors['rs1|video'] }));

async function openClientReview(browser, origin) {
  const t = await open(browser, origin, { stage: 'client', flags: 'on', polish: true, linkedParts: true, mergeComments: true, nativeReceipts: true, project: true });
  await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1500);
  return t;
}
// The change request on a 3 s line, a reload 0.7 s in, and every write after the reload refused until it settles.
async function changeReloadRefused(t, origin) {
  Object.assign(t.state, { writeDelay: 3000, gatewayDelay: 3000 });
  await inS(t.page, '#ta').fill(WORDS);
  await inS(t.page, '[data-pc="video"]').click();
  await inS(t.page, '#sendBtn').click();
  await sleep(700);
  Object.assign(t.state, { writeFail: 50 });
  await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
  await waitNew(t);
  return until(async () => { const s = await pageState(t); return s.err && !s.saving && !s.inflight; }, 40000);
}
const lineBack = t => Object.assign(t.state, { writeFail: 0, writeDelay: 0, gatewayDelay: 0 });
async function pressRetry(t) {
  const b = inS(t.page, '[data-retry="video"]').first();
  if (!(await b.count())) return false;
  await b.click({ timeout: 5000 }).catch(() => {});
  return true;
}

async function runEngine(browserType, origin) {
  const browser = await browserType.launch();
  try {
    // 1. same page
    console.log('--- 1. a reload during the change request, the re-send refused, Try again on the same page ---');
    let t = await openClientReview(browser, origin);
    const settled = await changeReloadRefused(t, origin);
    expect(settled >= 0, '1: (control) the refused re-send ends');
    let shown = await partShows(t);
    for (let i = 0; i < 20 && !(shown.retry && shown.words); i++) { await sleep(250); shown = await partShows(t); }
    expect(shown.err && shown.retry, '1: the part says it was not saved, with a real Try again button (' + JSON.stringify(shown) + ')');
    expect(shown.words, '1: and the client\'s words are offered back');
    expect(copies(t) === 0, '1: (control) nothing of it is on the server yet');
    lineBack(t);
    const pressed = await pressRetry(t);
    const landed = pressed ? await until(async () => copies(t) >= 1 && card(t).video_status === 'Tweaks Needed', 20000) : -1;
    expect(landed >= 0, '1: once the line answers, Try again lands the change (' + copies(t) + ' copies, ' + card(t).video_status + ')');
    await sleep(4000);
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    await sleep(8000);
    expect(copies(t) === 1, '1: exactly one copy on the server, after Try again and another reload (' + copies(t) + ')');
    await t.ctx.close();

    // 2. next load
    console.log('--- 2. the same, then the client comes back on a new load once the line answers ---');
    t = await openClientReview(browser, origin);
    await changeReloadRefused(t, origin);
    lineBack(t);
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    let state2 = null;
    const decided = await until(async () => { state2 = await partShows(t); return copies(t) >= 1 || (state2.err && state2.retry && state2.words); }, 20000);
    expect(decided >= 0, '2: on the next load the change is on the server, or the part says it was not sent, with the words and Try again (' + JSON.stringify({ copies: copies(t), shown: state2 }) + ')');
    if (copies(t) === 0 && state2 && state2.retry) {
      await pressRetry(t);
      await until(async () => copies(t) >= 1, 20000);
    }
    await sleep(6000);
    expect(copies(t) === 1, '2: exactly one copy on the server (' + copies(t) + ', ' + card(t).video_status + ')');
    await t.ctx.close();

    // 3. A team member's internal change request kept in this same browser's delivery record is never shown to the
    //    client as their words (Codex on #2598): only the client link's own requests are put back as not sent.
    console.log('--- 3. a team member\'s internal request in the same browser is not offered to the client ---');
    t = await open(browser, origin, { stage: 'client', flags: 'on', polish: true, linkedParts: true, mergeComments: true, nativeReceipts: true, project: true });
    const TEAM = 'Team only: tighten the cut at 0:12.';
    await t.ctx.addInitScript(words => {
      try {
        if (localStorage.getItem('rg697_seeded')) return;
        localStorage.setItem('rg697_seeded', '1');
        const id = 'rb_teamseed01';
        localStorage.setItem('syncview_linear_outbox_v1', JSON.stringify([{ id: 'deferred_calendar_' + id + '_source', kind: 'source_only', payload: {}, attempts: 0, lastError: '', lastAttempt: 0,
          queuedAt: Date.now() - 120000, transport: 'source_only', client_slug: 'fixturestudio',
          source_gate: { surface: 'calendar', client_slug: 'fixturestudio', source_transport: 'supabase', post_id: 'rs1', component: 'video', comment_id: id, comment_body: words,
            comment_author: 'Synchro Social', comment_role: 'smm', comment_audience: 'internal', comment_is_tweak: true, intended_status: 'Tweaks Needed', approval_clears: [], linear_issue: '', principal: 'staff:m1:smm' } }]));
      } catch (e) {}
    }, TEAM);
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    await sleep(9000);
    const shown3 = await t.page.evaluate(words => { const r = document.getElementById('svReviewStage').shadowRoot; const html = (r.getElementById('rsApp') || r).textContent || ''; const ta = r.getElementById('ta');
      return { teamWords: html.includes(words) || !!(ta && ta.value.includes(words)), err: !!r.querySelector('[data-err="video"]'), retry: !!r.querySelector('[data-retry="video"]') }; }, TEAM);
    expect(!shown3.teamWords && !shown3.retry, '3: the team\'s internal words are not offered to the client, and no Try again for them (' + JSON.stringify(shown3) + ')');
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
    const only = String(process.env.REVIEW_RETRY_ENGINES || '').split(',').filter(Boolean);
    for (const [name, type] of engines) {
      if (only.length && !only.includes(name)) continue;
      engineName = name;
      let probe = null;
      try { probe = await type.launch(); } catch (e) { probe = null; }
      if (!probe) {
        if (name === 'webkit' && process.env.REVIEW_RETRY_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
        else console.log('(' + name + ' is not installed here: skipped)');
        continue;
      }
      await probe.close();
      console.log('===== ' + name + ' =====');
      await runEngine(type, origin);
    }
  } finally { server.close(); }
  if (failures.length) { console.error('\nreview-reload-retry-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\nreview-reload-retry-browser: a refused re-send after a reload offers the words and Try again, and lands once ✅');
})().catch(e => { console.error(e); process.exit(1); });
