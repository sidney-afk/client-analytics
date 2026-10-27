'use strict';
/*
 * TRIAL REELS: A CHANGE IS ABOUT THE VERSION IT WAS ASKED ON, in a real browser, fully offline. Session Probe,
 * 2026-10-27 (findings 10, 10b and 11 in docs/features/trial-reels/OVERNIGHT_PROBE_2026-10-27.md).
 *
 * The review page (test/fixtures/review-stage-fixture.js, fictional data) with the trial-reels function answered by its
 * own rules (logic.mjs). What must hold:
 *   - the client opens "Ask for a change" on Video C, then looks at Video D before sending: the change is Video C's
 *     (the version marked, and today's request starting "Video C:");
 *   - Kasper's second layout: "Ask for a change" on tile C, then a press on tile E to look at it, then send: Video C's;
 *   - Kasper's "Approve after tweaks" on a trial card records which version the editor must fix (the version on stage
 *     is marked "change asked"), as every other change on a trial card does.
 */
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const LINK = l => 'https://f.io/fixture-naming-' + l.toLowerCase();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const OK_AT = '2026-10-27T08:00:00.000Z';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const fresh = () => ['A', 'B', 'C', 'D', 'E'].map(l => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, updated_at: OK_AT,
    smm_ok_at: OK_AT, kasper_ok_at: null, client_ok_at: null }));

  async function start(mode, extra) {
    const T = { versions: fresh(), calls: [] };
    if (mode === 'client') T.versions.forEach(v => { v.kasper_ok_at = OK_AT; });
    const t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', flagValues: { trial_reels_pages: { clients: [SLUG] } } },
      mode !== 'client' ? { staff: STAFF } : {}, extra || {}));
    t.T = T;
    await t.ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const b = JSON.parse(r.postData() || '{}');
      T.calls.push(b);
      const client = mode === 'client';
      const shape = () => Object.assign({ enabled: true, winner_letter: null }, L.readShape(T.versions, { client, mainLink: LINK('A'), cardStatus: 'Client Approval' }));
      const reply = (o, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list') return reply({ ok: true, cards: { rs1: shape() } });
      if (b.action === 'answer') {
        const res = L.answerPatches(T.versions, { stage: client ? 'client' : b.stage, kind: b.kind, letter: b.letter, note: b.note }, new Date().toISOString());
        if (res.error) return reply({ ok: false, error: res.error }, 400);
        for (const p of res.patches) Object.assign(T.versions.find(v => v.id === p.id), p.patch);
        return reply(Object.assign({ ok: true }, shape()));
      }
      return reply({ ok: false, error: 'unknown_action' }, 400);
    });
    if (mode === 'client') {
      await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
    } else {
      await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
    }
    if (extra && extra.layout2) await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
    else await waitNew(t);
    await sleep(1500);
    return t;
  }
  const sentText = (t, n0, g0) => t.state.upserts.slice(n0).map(u => String(u.video_tweaks || '')).join('|') + '|' + t.state.gateway.slice(g0).map(String).join('|');
  const changes = t => t.T.calls.filter(c => c.action === 'answer' && c.kind === 'change').map(c => c.letter);
  const until = async (f, n) => { for (let i = 0; i < (n || 80) && !(await f()); i++) await sleep(100); return f(); };

  try {
    // ---------- 10: the client asks a change on C, looks at D, then sends ----------
    let t = await start('client');
    await inS(t.page, '.trv [data-trv-go="C"]').click();
    await sleep(600);
    let n0 = t.state.upserts.length, g0 = t.state.gateway.length;
    await inS(t.page, '[data-chg="video"]').click();
    await inS(t.page, '#ta').fill('Fictional note: a shorter first line.');
    await inS(t.page, '.trv [data-trv-step="1"]').click();   // a look at the next version before sending
    await sleep(600);
    const onScreen = await t.page.evaluate(() => ((document.getElementById('svReviewStage').shadowRoot.querySelector('.trv-n') || {}).textContent || '').trim());
    if (await inS(t.page, '#sendBtn').count()) await inS(t.page, '#sendBtn').click();
    await until(() => changes(t).length > 0 && /Fictional note/.test(sentText(t, n0, g0)));
    await sleep(600);
    ok(changes(t).join(',') === 'C' && t.T.versions[2].status === 'change asked' && t.T.versions[3].status !== 'change asked',
      '10 client: the change asked on Video C is recorded on C, though ' + onScreen + ' was on screen when it was sent (marked: ' + (changes(t).join(',') || 'none') + ')');
    ok(/Video C: Fictional note/.test(sentText(t, n0, g0)) && !/Video D: Fictional note/.test(sentText(t, n0, g0)), '10 client: today\'s change request starts "Video C:"');
    await t.ctx.close();

    // ---------- 10b: Kasper's tiles: change on C, a press on tile E, then send ----------
    t = await start('kasper', { layout2: true });
    n0 = t.state.upserts.length; g0 = t.state.gateway.length;
    await inS(t.page, '.trk-v [data-trk-chg="C"]').click();
    await sleep(400);
    await inS(t.page, '#ta').fill('Fictional note: the hook word lands late.');
    await inS(t.page, '.trk-v [data-trk-go="E"]').click();
    await sleep(800);
    if (await inS(t.page, '#sendBtn').count()) await inS(t.page, '#sendBtn').click();
    await until(() => changes(t).length > 0 && /hook word lands late/.test(sentText(t, n0, g0)));
    await sleep(600);
    ok(changes(t).join(',') === 'C' && t.T.versions[2].status === 'change asked' && t.T.versions[4].status !== 'change asked',
      '10b Kasper tiles: the change opened on tile C is Video C\'s, though tile E was on stage when it was sent (marked: ' + (changes(t).join(',') || 'none') + ')');
    ok(/Video C: Fictional note: the hook/.test(sentText(t, n0, g0)), '10b Kasper tiles: today\'s note starts "Video C:"');
    await t.ctx.close();

    // ---------- 11: Kasper's "Approve after tweaks" on a trial card ----------
    t = await start('kasper');
    await inS(t.page, '.trv [data-trv-go="B"]').click();
    await sleep(600);
    n0 = t.state.upserts.length; g0 = t.state.gateway.length;
    await inS(t.page, '[data-menu="video"]').click();
    await sleep(300);
    await inS(t.page, '[data-alt="aat"]').click();
    await sleep(300);
    await inS(t.page, '#ta').fill('Fictional note: fix the caption burn-in, then send it on.');
    await inS(t.page, '#sendBtn').click();
    await until(() => /caption burn-in/.test(sentText(t, n0, g0)));
    await sleep(1200);
    ok(/caption burn-in/.test(sentText(t, n0, g0)), '11 Kasper\'s Approve after tweaks goes as today');
    ok(changes(t).join(',') === 'B' && t.T.versions[1].status === 'change asked',
      '11 and it records which version the editor must fix: Video B, the one on stage (marked: ' + (changes(t).join(',') || 'none') + ')');
    await t.ctx.close();
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`trial-reels-change-naming-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
