'use strict';
/*
 * OPEN_REPAIRS 699 (session Reviewguard, 2026-11-04): a client's change on a trial version's part (sent with keepStatus,
 * 587: the part keeps its status while other versions wait) that is refused once can never be sent again. Its
 * source-only delivery record keeps the part's status at the time, and the record check accepted only "Tweaks
 * Needed", so the same change sent again read as another one "still being confirmed" and was refused for good: Try
 * again, the client queue and a reload's re-send all. Found by 697's trial case (Codex P1 on #2598).
 *
 * On the review-stage fixture with trial versions (fictional client, card and versions; the trial-reels function
 * answered by its own rules, logic.mjs), the client link, Chromium and WebKit:
 *   1. a thumbnail change on Version C whose first send is refused: once the line answers, the same change (Try again,
 *      or the client queue's own re-send) lands once, its text unchanged ("Version C, thumbnail: ..."), and the
 *      thumbnail keeps its status;
 *   2. (guard) a different change on that part while another one's record waits is still refused, and nothing of it
 *      reaches the card.
 * On main, 1 fails ("Another change request for this item is still being confirmed").
 *
 * Bounded (supervisor, after a WebKit run on PR 2597 held the repair-checkpoint seat for 40 minutes with no log): a
 * watchdog ends the run at TRIAL_RETRY_DEADLINE_MS (default 4 min) and prints the last step reached; every page read,
 * close and launch has its own limit, so a stuck one fails fast and names its step; each step prints one short line.
 * The trial-reels stub answers from the fixture's own state, never by reading the page (a read of a page mid-load can
 * wait for as long as the page does).
 */
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let engineName = '';
// The step reached, printed by each step and by the watchdog (supervisor, PR 2597's 40-minute WebKit hold).
const T0 = Date.now();
let lastStep = 'start';
function step(name) { lastStep = '[' + engineName + '] ' + name; console.log('  · ' + lastStep + ' (' + ((Date.now() - T0) / 1000).toFixed(1) + ' s)'); }
const DEADLINE_MS = Number(process.env.TRIAL_RETRY_DEADLINE_MS || 240000);
const watchdog = setTimeout(() => {
  console.error('\nFAIL  trial-change-retry-browser: the whole run passed its ' + Math.round(DEADLINE_MS / 1000) + ' s limit; last step reached: ' + lastStep);
  process.exit(1);
}, DEADLINE_MS);
// Every page read, close and launch is bounded: one that does not answer in time fails, naming its step.
class Stuck extends Error {}
function bounded(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Stuck(what + ' did not answer in ' + Math.round(ms / 1000) + ' s (step: ' + lastStep + ')')), ms); });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}
const evalIn = (page, fn, arg, what) => bounded(page.evaluate(fn, arg), 10000, what || 'a page read');
function expect(value, message) { const m = '[' + engineName + '] ' + message; if (!value) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(250); } return -1; }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const LINK = l => 'https://f.io/fixture-trial-' + l.toLowerCase();
const WORDS = 'A brighter picture, please.';
const SENT = 'Version C, thumbnail: ' + WORDS;
const url = origin => origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN });
const card = t => t.state.cards.find(c => c.id === 'rs1');
async function closeCtx(t) { await bounded(t.ctx.close(), 20000, 'closing the page'); }
const notes = (t, comp) => { try { return JSON.parse(card(t)[comp + '_tweaks'] || '[]').map(n => String(n.body || '')); } catch (e) { return []; } };

async function openTrialClient(browser, origin, L) {
  const versions = ['A', 'B', 'C'].map(l => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, updated_at: '2026-11-03T09:00:00.000Z',
    smm_ok_at: '2026-11-03T08:00:00.000Z', kasper_ok_at: '2026-11-03T08:10:00.000Z', client_ok_at: null, client_pass_at: null, change_by: null, change_note: null, change_at: null, change_part: null, thumbnail_url: null, caption: null }));
  const flagValues = { trial_reels_pages: { clients: [SLUG] }, trial_versions_v2: { clients: [SLUG] } };
  const t = await bounded(open(browser, origin, { stage: 'client', flags: 'on', flagValues, linkedParts: true, polish: true }), 30000, 'opening the fixture page');
  t.page.setDefaultTimeout(15000); t.page.setDefaultNavigationTimeout(30000);
  t.versions = versions;
  let CARD = null;
  await t.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    if (!CARD) { const p = card(t) || {}; CARD = { thumbnail_url: p.thumbnail_url || null, caption: p.caption || null }; }
    const shape = () => Object.assign({ enabled: true }, L.readShape(versions, { client: true, mainLink: versions[0].frame_url, cardStatus: 'Client Approval', card: CARD }));
    const reply = (o, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
    if (b.action === 'list') return reply({ ok: true, cards: { rs1: shape() } });
    if (b.action === 'answer') {
      const res = L.answerPatches(versions, { stage: 'client', kind: b.kind, letter: b.letter, note: b.note, cardStatus: 'Client Approval', part: b.part }, new Date().toISOString());
      if (res.error) return reply({ ok: false, error: res.error }, 400);
      for (const p of res.patches) Object.assign(versions.find(v => v.id === p.id), p.patch);
      return reply(Object.assign({ ok: true }, shape()));
    }
    return reply({ ok: false, error: 'unknown_action' }, 400);
  });
  step('load the client link');
  await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1800);
  return t;
}
const graphicShows = t => evalIn(t.page, sent => {
  const r = document.getElementById('svReviewStage').shadowRoot;
  const e = r.querySelector('[data-err="graphic"]'), ta = r.getElementById('ta');
  return { err: !!e || !!_calReviewState.errors['rs1|graphic'], retry: !!r.querySelector('[data-retry="graphic"]'),
    words: !!(e && (e.textContent || '').includes(sent)) || !!(ta && ta.value.includes(sent)),
    open: ((r.querySelector('.trs-s[aria-pressed="true"]') || {}).dataset || {}).trvGo || '' };
}, SENT, 'reading the thumbnail\'s state').catch(e => { if (e instanceof Stuck) throw e; return {}; });

async function askOnVersionC(t, words) {
  step('ask for a thumbnail change on Version C');
  await inS(t.page, '.trv [data-trv-go="C"]').click(); await sleep(600);
  await inS(t.page, '[data-chg="video"]').click(); await sleep(300);
  await inS(t.page, '[data-trv-part="thumbnail"]').click(); await sleep(300);
  await inS(t.page, '#ta').fill(words);
  await inS(t.page, '#sendBtn').click();
}

async function runEngine(browserType, origin, L) {
  const browser = await browserType.launch();
  try {
    console.log('--- 1. a thumbnail change on Version C, its first send refused, Try again ---'); step('case 1');
    let t = await openTrialClient(browser, origin, L);
    const before = card(t).graphic_status;
    Object.assign(t.state, { writeFail: 50 });
    await askOnVersionC(t, WORDS);
    // The refusal is either shown with Try again, or held by the client queue to be sent again by itself.
    await until(async () => { const s = await graphicShows(t); return (s.err && s.retry) || t.state.writeAttempts >= 2; }, 15000);
    await sleep(2000);
    expect(!notes(t, 'graphic').some(b => b.includes(WORDS)), '1: (control) nothing of it is on the server while the line refuses');
    step('the line answers again; Try again');
    Object.assign(t.state, { writeFail: 0 });
    const s = await graphicShows(t);
    if (s.retry) await inS(t.page, '[data-retry="graphic"]').first().click({ timeout: 5000 }).catch(() => {});
    await until(async () => notes(t, 'graphic').some(b => b.includes(WORDS)), 70000);
    step('read what landed');
    await sleep(5000);
    const err1 = await evalIn(t.page, () => String(_calReviewState.errors['rs1|graphic'] || ''), undefined, 'reading the page\'s error').catch(e => { if (e instanceof Stuck) throw e; return ''; });
    const got = notes(t, 'graphic').filter(b => b.includes(WORDS));
    expect(got.length === 1 && got[0] === SENT, '1: once the line answers, the same change lands once (Try again or the queue\'s own re-send), its text unchanged (' + JSON.stringify(got) + (err1 ? ', page says: ' + err1.slice(0, 90) : '') + ')');
    expect(card(t).graphic_status === before, '1: and the thumbnail keeps its status (' + before + ' -> ' + card(t).graphic_status + ')');
    expect(!notes(t, 'video').some(b => b.includes(WORDS)), '1: and nothing of it on the video part');
    await closeCtx(t);

    console.log('--- 2. (guard) a different change while another one\'s record waits is still refused ---'); step('case 2');
    t = await openTrialClient(browser, origin, L);
    const OLDER = 'Version C, thumbnail: An older change, still waiting.';
    // Another change's record for the same part, sent the trial way (the part's status kept), by this same link.
    step('seed another change\'s waiting record');
    await evalIn(t.page, ([older]) => {
      const post = (calState.posts || []).find(p => p.id === 'rs1');
      const id = 'rb_olderchange1';
      const gate = { surface: 'calendar', client_slug: _writeUiSourceClientSlug('calendar', { post }), source_transport: 'supabase', post_id: 'rs1', component: 'graphic',
        comment_id: id, comment_body: older, comment_author: String(calState.client || 'Client'), comment_role: 'client', comment_audience: 'client', comment_is_tweak: true,
        intended_status: String(post.graphic_status || ''), approval_clears: [], linear_issue: String(_calLinearUrlFor(post, 'graphic') || ''), principal: _writeUiPrincipalKey() };
      const rows = JSON.parse(localStorage.getItem('syncview_linear_outbox_v1') || '[]');
      rows.push({ id: 'deferred_calendar_' + id + '_source', kind: 'source_only', payload: {}, attempts: 0, lastError: '', lastAttempt: 0, queuedAt: Date.now(), transport: 'source_only', client_slug: gate.client_slug, source_gate: gate });
      localStorage.setItem('syncview_linear_outbox_v1', JSON.stringify(rows));
    }, [OLDER], 'seeding the waiting record').catch(e => console.log('seed failed: ' + String(e && e.message).slice(0, 120)));
    // The refusal's own report (699): caught where it arrives, so its count and words can be read.
    const reports = [];
    await t.ctx.route('**/functions/v1/write-diagnostics', route => {
      const r = route.request();
      if (r.method() === 'POST') { try { reports.push(JSON.parse(r.postData() || '{}')); } catch (e) { reports.push({ raw: r.postData() }); } }
      return route.fulfill({ status: r.method() === 'OPTIONS' ? 204 : 202, headers: Object.assign({ 'access-control-allow-methods': 'POST,OPTIONS' }, CORS), contentType: 'application/json', body: r.method() === 'OPTIONS' ? '' : '{"ok":true}' });
    });
    const NEWER = 'A different change, please.';
    await askOnVersionC(t, NEWER);
    await sleep(6000);
    const err2 = await evalIn(t.page, () => String(_calReviewState.errors['rs1|graphic'] || ''), undefined, 'reading the page\'s error').catch(e => { if (e instanceof Stuck) throw e; return ''; });
    expect(/still being confirmed|another change request/i.test(err2), '2: the different change is refused while the other one waits (' + err2.slice(0, 90) + ')');
    expect(!notes(t, 'graphic').some(b => b.includes(NEWER) || b.includes('older change')), '2: and nothing of either reaches the card');
    const conflictReports = reports.filter(b => /change_request_conflict/.test(JSON.stringify(b)));
    expect(conflictReports.length === 1, '2: the refusal is reported to the refusal log once (' + conflictReports.length + ': ' + conflictReports.map(b => (b.claim || b).code || (b.env && b.env.code) || '').join(',') + ')');
    expect(!JSON.stringify(reports).match(/different change|older change|brighter picture|Version C,/i), '2: with no words in any report');
    await closeCtx(t);

    console.log('--- 3. the same change, a reload mid-save, the re-send refused, Try again with Version A open ---'); step('case 3');
    t = await openTrialClient(browser, origin, L);
    const before3 = card(t).graphic_status;
    Object.assign(t.state, { writeDelay: 3000, gatewayDelay: 3000 });
    await askOnVersionC(t, WORDS);
    await sleep(700);
    // Every write after the reload refused by the server (a 400, not a line that is down, which the client queue holds).
    Object.assign(t.state, { writeRefuse: 50 });
    step('reload mid-save (a direct load of the same link)');
    await t.page.goto(url(origin), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    step('wait for the refused re-send to show Try again');
    await until(async () => { const v = await graphicShows(t); return v.err && v.retry; }, 40000);
    await inS(t.page, '.trv [data-trv-go="A"]').click().catch(() => {}); await sleep(600);
    const s3 = await graphicShows(t);
    expect(s3.err && s3.retry && s3.words, '3: the refused re-send shows the change as made, "' + SENT + '", with Try again (' + JSON.stringify(s3) + ')');
    expect(s3.open === 'A', '3: (control) Version A is open when Try again is pressed (' + s3.open + ')');
    step('Try again with Version A open');
    Object.assign(t.state, { writeRefuse: 0, writeDelay: 0, gatewayDelay: 0 });
    await inS(t.page, '[data-retry="graphic"]').first().click({ timeout: 5000 }).catch(() => {});
    await until(async () => notes(t, 'graphic').some(b => b.includes(WORDS)), 20000);
    await sleep(5000);
    const err3 = await evalIn(t.page, () => String(_calReviewState.errors['rs1|graphic'] || ''), undefined, 'reading the page\'s error').catch(e => { if (e instanceof Stuck) throw e; return ''; });
    const got3 = notes(t, 'graphic').filter(b => b.includes(WORDS));
    expect(got3.length === 1 && got3[0] === SENT, '3: Try again lands it once, its text unchanged and on Version C (' + JSON.stringify(got3) + (err3 ? ', page says: ' + err3.slice(0, 90) : '') + ')');
    expect(card(t).graphic_status === before3, '3: and the thumbnail keeps its status (' + before3 + ' -> ' + card(t).graphic_status + ')');
    await closeCtx(t);
  } finally {
    step('close the browser');
    await bounded(browser.close(), 20000, 'closing the browser');
  }
}

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const engines = [['chromium', chromium], ['webkit', webkit]];
    const only = String(process.env.TRIAL_RETRY_ENGINES || '').split(',').filter(Boolean);
    for (const [name, type] of engines) {
      if (only.length && !only.includes(name)) continue;
      engineName = name;
      let probe = null;
      step('launch');
      try { probe = await bounded(type.launch(), 60000, 'launching ' + name); } catch (e) { if (e instanceof Stuck) throw e; probe = null; }
      if (!probe) {
        if (name === 'webkit' && process.env.TRIAL_RETRY_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
        else console.log('(' + name + ' is not installed here: skipped)');
        continue;
      }
      await bounded(probe.close(), 20000, 'closing the launch check');
      console.log('===== ' + name + ' =====');
      await runEngine(type, origin, L);
    }
  } finally { server.close(); clearTimeout(watchdog); }
  if (failures.length) { console.error('\ntrial-change-retry-browser: ' + failures.length + ' failed'); process.exit(1); }
  console.log('\ntrial-change-retry-browser: a trial version\'s refused change is sent again unchanged, once; a different one is still refused ✅');
})().catch(e => { console.error((e instanceof Stuck ? 'FAIL  ' : '') + (e && e.message || e) + '\nlast step reached: ' + lastStep); process.exit(1); });
