'use strict';
/*
 * TRIAL REELS ON THE REVIEW PAGE (src/index/194-review-trial-versions.js.part, hooked into 195), in a real browser,
 * fully offline. Session Trials, 2026-10-27; plan docs/features/TRIAL_REELS_PLAN.md section 5.
 *
 * The page is today's review page (layout C) on the shared offline fixture (test/fixtures/review-stage-fixture.js:
 * fictional clients, cards and tokens). The trial-reels function is answered by its own rules (supabase/functions/
 * trial-reels/logic.mjs) over an in-memory card. Proves, on the client link and on the SMM's Review tab:
 *   - switch off for this client: today's page, no version bar, the function never asked;
 *   - switch on: "Video A of 5" over the player with a dot per version and an arrow on each side, no hook text; the
 *     player plays the version on screen; the arrow moves to "Video B of 5";
 *   - Approve answers only the version on screen and saves nothing on the card until every version has this
 *     reviewer's OK; "Approve all" answers the rest and then today's approve moves the card (the client: Approved;
 *     the SMM: Kasper Approval);
 *   - Ask for a change records the change on the version on screen and sends today's change request starting
 *     "Video C:";
 *   - once a winner is picked the client sees only "Video C: the one we are posting";
 *   - no page errors.
 */
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const LINK = l => 'https://f.io/fixture-trial-' + l.toLowerCase();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const fresh = (over) => ['A', 'B', 'C', 'D', 'E'].map(l => Object.assign({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, updated_at: '2026-10-27T09:00:00.000Z',
    hook: 'Fictional hook ' + l, smm_ok_at: null, kasper_ok_at: null, client_ok_at: null }, (over || {})[l] || {}));

  async function start(mode, flag, versions) {
    // Kasper and the client answer a version only after the SMM (the server holds the order).
    if (mode !== 'smm') versions.forEach(v => { if (!v.smm_ok_at) v.smm_ok_at = '2026-10-27T08:00:00.000Z'; });
    const T = { versions, calls: [] };
    const t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', flagValues: { trial_reels_pages: { clients: flag ? [SLUG] : ['someotherclient'] } } },
      mode !== 'client' ? { staff: STAFF } : {}));
    t.T = T;
    T.views = [];
    // The link the player asks the viewer to play (the fixture answers it as usual).
    await t.ctx.route('**/functions/v1/frameio-view*', route => {
      const r = route.request();
      try { const u = new URL(r.url()); const b = r.postData() ? JSON.parse(r.postData()) : {}; T.views.push(String(b.link || b.url || u.searchParams.get('link') || u.searchParams.get('url') || '')); } catch (e) {}
      return route.fallback();
    });
    await t.ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const b = JSON.parse(r.postData() || '{}');
      T.calls.push(b);
      const client = mode === 'client';
      const shape = () => Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
        L.readShape(T.versions, { client, mainLink: T.versions[0].frame_url, cardStatus: 'Client Approval' }));
      const reply = (o, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list') return reply({ ok: true, cards: { rs1: shape() } });
      if (b.action === 'answer' && b.kind === 'change' && T.failChange > 0) { T.failChange--; return reply({ ok: false, error: 'write_failed' }, 500); }
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
    } else if (mode === 'kasper') {
      await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
    } else {
      await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('smmreview'));
    }
    await waitNew(t);
    await sleep(1500);
    return t;
  }
  const bar = t => t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const b = r.querySelector('.trv');
    const open = r.querySelector('#fvHost .fv-open-link');
    return {
      text: b ? b.innerText.replace(/\s+/g, ' ').trim() : '',
      dots: b ? [...b.querySelectorAll('.trv-dot i')].map(i => i.className || 'wait') : [],
      link: '',
      tab: ((r.querySelector('#novidMsg a') || {}).href) || '',
      player: !!r.querySelector('#fvHost .fv-player') && !r.getElementById('fvHost').hidden,
      ok: ((r.querySelector('[data-ok="video"]') || {}).textContent || '').trim(),
      hook: /Fictional hook/.test(r.innerHTML),
    };
  });
  const waitFor = async (f, n) => { for (let i = 0; i < (n || 60) && !(await f()); i++) await sleep(100); return f(); };

  try {
    // ---------- switch off for this client ----------
    let t = await start('client', false, fresh());
    let b = await bar(t);
    ok(!b.text && !t.T.calls.length && /Approve the video/.test(b.ok), 'switch off: today\'s page, no version bar, the function never asked');
    await t.ctx.close();

    // ---------- the client link ----------
    t = await start('client', true, fresh());
    b = await bar(t);
    b.link = t.T.views[t.T.views.length - 1] || '';
    ok(/^Video A of 5/.test(b.text) && b.dots.length === 5, 'client: "Video A of 5" over the player, a dot per version (' + b.text + ')');
    ok(!b.hook, 'client: no hook text anywhere on the page');
    ok(b.player && b.ok === 'Approve Video A', 'client: the player plays Video A (the card\'s own link), and the button names it (' + b.ok + ')');
    await inS(t.page, '.trv [data-trv-step="1"]').click();
    await sleep(900);
    b = await bar(t);
    b.link = t.T.views[t.T.views.length - 1] || '';
    ok(/^Video B of 5/.test(b.text) && !b.player && b.tab === LINK('B'), 'client: the arrow moves to Video B, which opens in a new tab on a client link (' + b.tab + ')');
    let n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    await waitFor(async () => t.T.calls.some(c => c.action === 'answer'));
    await sleep(900);
    b = await bar(t);
    ok(t.T.calls.some(c => c.action === 'answer' && c.kind === 'approve' && c.letter === 'B') && t.T.versions[1].status === 'approved', 'client: Approve answers only Video B');
    ok(!t.state.upserts.slice(n0).some(u => u.video_status), 'client: and saves nothing on the card while other versions wait');
    ok(/^Video A of 5/.test(b.text) && b.dots[1] === 'ok', 'client: the page moves to the next version waiting, and B\'s dot is approved (' + b.dots.join(',') + ')');
    await inS(t.page, '.trv [data-trv-all]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Approved'); i++) await sleep(100);
    ok(t.T.calls.some(c => c.kind === 'approve_all') && t.T.versions.every(v => v.status === 'approved'), 'client: Approve all answers the rest');
    ok(t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Approved'), 'client: then today\'s approve moves the video to Approved');
    ok(!t.errors.length, 'client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a change on one version ----------
    t = await start('client', true, fresh());
    await inS(t.page, '.trv [data-trv-go="C"]').click();
    await sleep(600);
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="video"]').click();
    await inS(t.page, '#ta').fill('Make the first word bigger.');
    await inS(t.page, '#sendBtn').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Tweaks Needed'); i++) await sleep(100);
    const chg = t.state.upserts.slice(n0).find(u => u.video_status === 'Tweaks Needed');
    ok(t.T.calls.some(c => c.kind === 'change' && c.letter === 'C' && c.note === 'Make the first word bigger.') && t.T.versions[2].status === 'change asked', 'client: Ask for a change records it on Video C');
    ok(!!chg && /Video C: Make the first word bigger\./.test(String(chg.video_tweaks || '')), 'client: and today\'s change request starts "Video C:"');
    ok(!t.errors.length, 'client change: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a version's own change that fails is kept and sent again ----------
    t = await start('client', true, fresh());
    t.T.failChange = 1;
    await inS(t.page, '.trv [data-trv-go="D"]').click();
    await sleep(600);
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="video"]').click();
    await inS(t.page, '#ta').fill('Shorter end card.');
    await inS(t.page, '#sendBtn').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Tweaks Needed'); i++) await sleep(100);
    ok(t.state.upserts.slice(n0).some(u => /Video D: Shorter end card\./.test(String(u.video_tweaks || ''))) && t.T.versions[3].status === 'waiting'
      && await t.page.evaluate(() => /Video D/.test(localStorage.getItem('syncview_trv_pending_v1') || '') || /"letter":"D"/.test(localStorage.getItem('syncview_trv_pending_v1') || '')),
      'a refused version write: today\'s change request still goes, and the version\'s change waits in this browser');
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await waitNew(t);
    for (let i = 0; i < 60 && t.T.versions[3].status !== 'change asked'; i++) await sleep(100);
    ok(t.T.versions[3].status === 'change asked' && t.T.versions[3].change_note === 'Shorter end card.' && !(await t.page.evaluate(() => localStorage.getItem('syncview_trv_pending_v1'))),
      'the next versions read sends it again, and Video D is marked as changed');
    await t.ctx.close();

    // ---------- a version with no link yet ----------
    t = await start('client', true, fresh({ E: { frame_url: null } }));
    await inS(t.page, '.trv [data-trv-go="E"]').click();
    await sleep(900);
    b = await bar(t);
    ok(/^Video E of 5/.test(b.text) && !b.player && /No video yet/.test(await inS(t.page, '#novidMsg').innerText()), 'a version with no link shows "No video yet", never another version\'s video');
    await t.ctx.close();

    // ---------- one live version still answers on its own ----------
    t = await start('client', true, fresh({ B: { status: 'dropped' }, C: { status: 'dropped' }, D: { status: 'dropped' }, E: { status: 'dropped' } }));
    b = await bar(t);
    n0 = t.state.upserts.length;
    ok(b.text === 'Video A' && !b.dots.length, 'one live version: the bar just names it (' + b.text + ')');
    await inS(t.page, '[data-ok="video"]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Approved'); i++) await sleep(100);
    ok(t.T.versions[0].status === 'approved' && t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Approved'), 'one live version: its own answer first, then today\'s approve, so the trial can start');
    await t.ctx.close();

    // ---------- once the winner is picked ----------
    t = await start('client', true, fresh({ A: { status: 'lost' }, B: { status: 'lost' }, C: { status: 'winner' }, D: { status: 'lost' }, E: { status: 'lost' } }));
    b = await bar(t);
    ok(b.text === 'Video C: the one we are posting' && !b.dots.length, 'client after the pick: only "Video C: the one we are posting" (' + b.text + ')');
    await t.ctx.close();

    // ---------- the SMM's Review tab ----------
    t = await start('smm', true, fresh());
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text) && /Approve to Kasper/.test(b.ok), 'SMM: the same bar, and today\'s Approve to Kasper (' + b.ok + ')');
    await inS(t.page, '.trv [data-trv-go="D"]').click();
    await sleep(1200);
    ok(t.T.views.includes(LINK('D')) && (await bar(t)).player, 'SMM: a staff page plays Video D in place (the player asks for its own link)');
    await inS(t.page, '.trv [data-trv-go="A"]').click();
    await sleep(600);
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    await waitFor(async () => t.T.calls.some(c => c.action === 'answer'));
    await sleep(900);
    ok(t.T.calls.some(c => c.action === 'answer' && c.stage === 'smm' && c.letter === 'A') && !!t.T.versions[0].smm_ok_at && !t.state.upserts.slice(n0).some(u => u.video_status), 'SMM: Approve stamps the SMM\'s OK on Video A only, the card waits');
    await inS(t.page, '.trv [data-trv-all]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Kasper Approval'); i++) await sleep(100);
    ok(t.T.versions.every(v => v.smm_ok_at) && t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), 'SMM: Approve all, then today\'s save moves the video to Kasper Approval');
    ok(!t.errors.length, 'SMM: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
    // ---------- Kasper's Review Session ----------
    t = await start('kasper', true, fresh());
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text), 'Kasper: the same bar (' + b.text + ')');
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    await waitFor(async () => t.T.calls.some(c => c.action === 'answer'));
    await sleep(900);
    ok(t.T.calls.some(c => c.stage === 'kasper' && c.letter === 'A') && !!t.T.versions[0].kasper_ok_at && !t.state.upserts.slice(n0).some(u => u.video_status), 'Kasper: Approve stamps his OK on Video A only');
    await inS(t.page, '.trv [data-trv-go="C"]').click();
    await sleep(600);
    const g0 = t.state.gateway.length;
    await inS(t.page, '[data-frame="video"]').click();
    const sent = () => t.state.gateway.slice(g0).map(String).join('|') + t.state.upserts.slice(n0).map(u => String(u.video_tweaks || '')).join('|');
    for (let i = 0; i < 80 && !/Tweaks are on Frame/.test(sent()); i++) await sleep(100);
    ok(t.T.versions[2].status === 'change asked' && /"body":"Tweaks are on Frame/.test(sent()) && !/Video C: Tweaks are on Frame/.test(sent()),
      'Kasper: Tweaks are on Frame on Video C records the change there and sends today\'s note word for word');
    ok(!t.errors.length, 'Kasper: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`trial-reels-review-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
