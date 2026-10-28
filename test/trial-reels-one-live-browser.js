'use strict';
/*
 * TRIAL REELS: A CARD WITH ONE VERSION LEFT, in a real browser, fully offline. Session Probe, 2026-10-27.
 *
 * The team dropped Video B to E; Video A is the one live version. The client approves the video on the review page
 * (test/fixtures/review-stage-fixture.js, fictional data). What must hold: Video A records the client's OK
 * (trial-reels "answer"), so the card's versions agree with the card (Approved) and the SMM can start the trial.
 * Without it, A stays "waiting", card_approvable is false, "Start the 24 h" never shows and trial_start answers
 * nothing_approved: the trial cannot start.
 */
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const LINK = l => 'https://f.io/fixture-one-live-' + l.toLowerCase();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const NOW = '2026-10-27T09:00:00.000Z';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const versions = ['A', 'B', 'C', 'D', 'E'].map(l => ({ id: 'v' + l, letter: l, status: l === 'A' ? 'waiting' : 'dropped', frame_url: LINK(l), revision: 0,
    updated_at: NOW, smm_ok_at: NOW, kasper_ok_at: NOW, client_ok_at: null }));
  const calls = [];
  try {
    const t = await open(browser, origin, { stage: 'client', flags: 'on', flagValues: { trial_reels_pages: { clients: [SLUG] } } });
    await t.ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const b = JSON.parse(r.postData() || '{}');
      calls.push(b);
      const shape = () => Object.assign({ enabled: true, winner_letter: null }, L.readShape(versions, { client: true, mainLink: LINK('A'), cardStatus: 'Client Approval' }));
      const reply = (o, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list') return reply({ ok: true, cards: { rs1: shape() } });
      if (b.action === 'answer') {
        const res = L.answerPatches(versions, { stage: 'client', kind: b.kind, letter: b.letter, note: b.note }, new Date().toISOString());
        if (res.error) return reply({ ok: false, error: res.error }, 400);
        for (const p of res.patches) Object.assign(versions.find(v => v.id === p.id), p.patch);
        return reply(Object.assign({ ok: true }, shape()));
      }
      return reply({ ok: false, error: 'unknown_action' }, 400);
    });
    await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
    await waitNew(t);
    await sleep(1500);
    const n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Approved'); i++) await sleep(100);
    await sleep(800);
    ok(t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Approved'), 'the client\'s approve moves the card to Approved (today\'s save)');
    ok(calls.some(c => c.action === 'answer' && (c.letter === 'A' || c.kind === 'approve_all')) && versions[0].status === 'approved',
      'and Video A, the one live version, records the client\'s OK (A is "' + versions[0].status + '", ' + calls.filter(c => c.action === 'answer').length + ' answers sent)');
    const sh = L.readShape(versions, { client: false, mainLink: LINK('A'), cardStatus: 'Approved' });
    ok(sh.card_approvable === true && !L.trialPatches(versions, Date.now()).error, 'so the card\'s versions agree with the card and the trial can start');
    ok(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`trial-reels-one-live-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
