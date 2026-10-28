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
 *     player plays the version on screen; the arrow moves to "Video B of 5", which plays in the page's player on the
 *     client link too (frameio-view is asked by card id and B's link);
 *   - Approve answers only the version on screen and saves nothing on the card until every version has this
 *     reviewer's OK; "Approve all" answers the rest and then today's approve moves the card (the client: Approved;
 *     the SMM: Kasper Approval);
 *   - Ask for a change records the change on the version on screen and sends today's change request starting
 *     "Video C:";
 *   - once a winner is picked the client sees only "Video C: the one we are posting";
 *   - one quiet "Trial" marker over the version's name wherever a trial card's video is reviewed: the client link, the
 *     SMM's Review tab and both of Kasper's layouts (Sidney, 2026-10-27), and none on today's page;
 *   - no page errors.
 * TRIAL_REVIEW_SHOTS=<dir> also writes a screenshot of Kasper's second layout (fictional data only).
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

  async function start(mode, flag, versions, extra) {
    // Kasper and the client answer a version only after the SMM (the server holds the order).
    if (mode !== 'smm') versions.forEach(v => { if (!v.smm_ok_at && !((extra && extra.noSmm) || []).includes(v.letter)) v.smm_ok_at = '2026-10-27T08:00:00.000Z'; });
    const T = { versions, calls: [], cards: extra && extra.cards };
    const t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', flagValues: { trial_reels_pages: { clients: flag ? [SLUG] : ['someotherclient'] } } },
      mode !== 'client' ? { staff: STAFF } : {}, extra || {}));
    t.T = T;
    T.views = [];
    T.asks = [];
    // The link the player asks the viewer to play (the fixture answers it as usual).
    await t.ctx.route('**/functions/v1/frameio-view*', route => {
      const r = route.request();
      try { const u = new URL(r.url()); const b = r.postData() ? JSON.parse(r.postData()) : {}; T.views.push(String(b.link || b.url || u.searchParams.get('link') || u.searchParams.get('url') || '')); T.asks.push(b); } catch (e) {}
      return route.fallback();
    });
    await t.ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const b = JSON.parse(r.postData() || '{}');
      T.calls.push(b);
      const client = mode === 'client';
      const shape = () => Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
        L.readShape(T.versions, { client, mainLink: T.mainLink || T.versions[0].frame_url, cardStatus: 'Client Approval' }));
      const reply = (o, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list') return reply({ ok: true, cards: Object.fromEntries((T.cards || ['rs1']).map(id => [id, shape()])) });
      if (b.action === 'answer' && b.kind === 'change' && T.failChange > 0) { T.failChange--; return reply({ ok: false, error: 'write_failed' }, 500); }
      if (b.action === 'answer') {
        // A slow line, or one refused answer, when a check asks for it (the page must answer at once all the same).
        if (T.delay) await new Promise(res => setTimeout(res, T.delay));
        if (T.failAnswer > 0 && b.kind !== 'change') { T.failAnswer--; return reply({ ok: false, error: 'write_failed' }, 500); }
        const res = L.answerPatches(T.versions, { stage: client ? 'client' : b.stage, kind: b.kind, letter: b.letter, note: b.note, cardStatus: 'Client Approval' }, new Date().toISOString());
        if (res.error) return reply({ ok: false, error: res.error }, 400);
        for (const p of res.patches) Object.assign(T.versions.find(v => v.id === p.id), p.patch);
        return reply(Object.assign({ ok: true }, shape()));
      }
      if (b.action === 'version_drop' && T.refuseDrop) { T.refuseDrop = false; return reply({ ok: false, error: 'conflict' }, 409); }
      if (b.action === 'version_drop') {
        const res = L.dropPatch(T.versions, b.letter, false, T.mainLink || T.versions[0].frame_url);
        if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
        if (res.patch) Object.assign(T.versions.find(v => v.letter === b.letter), res.patch);
        return reply(Object.assign({ ok: true }, shape()));
      }
      return reply({ ok: false, error: 'unknown_action' }, 400);
    });
    // Today's attach onto the card (Production's gateway), for the drop of the version on the card (default (c)).
    T.attaches = [];
    await t.ctx.route('**/rest/v1/production_deliverables_browser_v1*', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify([{ id: 'del_rs1', client_slug: SLUG, updated_at: '2026-10-27T09:00:00.000Z' }]) }));
    await t.ctx.route('**/functions/v1/production-write', route => {
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (b.operation !== 'attachment') return route.fallback();
      T.attaches.push(b.file_url); T.mainLink = b.file_url;
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, native_committed: true, row: { id: 'del_rs1', updated_at: new Date().toISOString() } }) });
    });
    // A route of the check's own (a video that cannot play), added last so it wins over the ones above.
    if (extra && extra.beforeOpen) await extra.beforeOpen(t);
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
    // Kasper's second layout has no steps: it is ready once its list of parts is drawn.
    if (extra && extra.layout2) await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
    else await waitNew(t);
    await sleep(1500);
    return t;
  }
  // The "Trial" marker (Sidney, 2026-10-27: one small marker, not a pill pile): the marker on screen, and how many times
  // the word shows on the page in all.
  const tags = t => t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const on = [...r.querySelectorAll('.trv-tag')].filter(n => n.getClientRects().length).map(n => n.textContent.trim()).join('|');
    const all = ([...r.children].map(c => c.innerText || '').join(' ').match(/\btrial\b/gi) || []).length;
    return on + ' x' + all;
  });
  const bar = t => t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const b = r.querySelector('.trv');
    const open = r.querySelector('#fvHost .fv-open-link');
    return {
      text: b ? b.innerText.replace(/\s+/g, ' ').trim() : '',
      dots: b ? [...b.querySelectorAll('.trv-dot')].map(d => d.classList.contains('ok') ? 'ok' : d.classList.contains('chg') ? 'chg' : 'wait') : [],
      letters: b ? [...b.querySelectorAll('.trv-dot')].map(d => d.textContent.trim()).join('') : '',
      // The mock's places (Probe E1 to E5, E7): the name and dots under the player, an arrow on each side of it, Approve
      // all beside Finish reviewing, which counts versions, and the player's badge naming the version.
      under: !!(b && b.closest('.trv-under-host') && b.closest('.trv-under-host').previousElementSibling === r.getElementById('view')),
      sides: (() => { const p = r.querySelector('#fvHost:not([hidden]), #novid'); const v = p && p.getBoundingClientRect();
        const l = r.querySelector('.trv-side.prev'), n = r.querySelector('.trv-side.next'); if (!v || !l || !n || !l.offsetParent) return '';
        const a = l.getBoundingClientRect(), c = n.getBoundingClientRect(); return a.right <= v.left && c.left >= v.right && Math.abs((a.top + a.bottom) / 2 - (v.top + v.bottom) / 2) < 4 ? 'beside' : 'elsewhere'; })(),
      all: ((r.querySelector('.dfin [data-trv-all]') || {}).textContent || '').trim(),
      finish: ((r.querySelector('#finishBtn .fc') || {}).textContent || '').trim(),
      badge: ((r.querySelector('#fvHost > .mpill') || {}).textContent || '').trim(),
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
    ok(await tags(t) === ' x0', 'switch off: no Trial marker (' + await tags(t) + ')');
    await t.ctx.close();

    // ---------- the client link ----------
    t = await start('client', true, fresh());
    b = await bar(t);
    b.link = t.T.views[t.T.views.length - 1] || '';
    ok(await tags(t) === 'Trial x1', 'client: one "Trial" marker on the video (' + await tags(t) + ')');
    ok(/Video A of 5/.test(b.text) && b.dots.length === 5 && b.letters === 'ABCDE', 'client: "Video A of 5" with a letter dot per version (' + b.text + ')');
    ok(b.under && b.sides === 'beside', 'client: the name and dots sit under the player and an arrow on each side of it (Probe E1; arrows ' + b.sides + ')');
    ok(b.all === 'Approve all (5 waiting)' && b.finish === '0 of 7', 'client: "Approve all (5 waiting)" beside Finish reviewing, which counts the versions (Probe E4, E5: ' + b.all + ' | ' + b.finish + ')');
    ok(b.badge === 'Video A', "client: the player's badge names the version (Probe E7: " + b.badge + ')');
    await t.page.keyboard.press('ArrowRight'); await sleep(500);
    const kb = (await bar(t)).text;
    await t.page.keyboard.press('ArrowLeft'); await sleep(500);
    ok(/Video B of 5/.test(kb) && /Video A of 5/.test((await bar(t)).text), 'client: the arrow keys move through the versions first (' + kb + ')');
    ok(!b.hook, 'client: no hook text anywhere on the page');
    ok(b.player && b.ok === 'Approve Video A', 'client: the player plays Video A (the card\'s own link), and the button names it (' + b.ok + ')');
    await inS(t.page, '.trv-side[data-trv-step="1"]').click();
    await sleep(900);
    b = await bar(t);
    b.link = t.T.views[t.T.views.length - 1] || '';
    const ask = t.T.asks[t.T.asks.length - 1] || {};
    ok(/^Video B of 5/.test(b.text) && b.player && ask.link === LINK('B') && !!ask.card_id && !ask.part, 'client: the arrow moves to Video B, which plays in the page\'s player (the client link asks by card id and names B\'s link: ' + JSON.stringify(ask) + ')');
    const seen = await t.page.evaluate(() => {
      const r = document.getElementById('svReviewStage').shadowRoot;
      return ['.trv-side.prev', '.trv-side.next'].map(sel => { const a = r.querySelector(sel); if (!a) return 'none'; const q = a.getBoundingClientRect();
        const hit = r.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return hit && (hit === a || a.contains(hit)) ? 'seen' : 'hidden'; }).join(',');
    });
    ok(seen === 'seen,seen', 'client: on Video B the arrows beside the player can be seen and pressed (Probe E1b: ' + seen + ')');
    let n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    await waitFor(async () => t.T.calls.some(c => c.action === 'answer'));
    await sleep(900);
    b = await bar(t);
    ok(t.T.calls.some(c => c.action === 'answer' && c.kind === 'approve' && c.letter === 'B') && t.T.versions[1].status === 'approved', 'client: Approve answers only Video B');
    ok(!t.state.upserts.slice(n0).some(u => u.video_status), 'client: and saves nothing on the card while other versions wait');
    ok(/^Video A of 5/.test(b.text) && b.dots[1] === 'ok', 'client: the page moves to the next version waiting, and B\'s dot is approved (' + b.dots.join(',') + ')');
    await inS(t.page, '[data-trv-all]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Approved'); i++) await sleep(100);
    ok(t.T.calls.some(c => c.kind === 'approve_all') && t.T.versions.every(v => v.status === 'approved'), 'client: Approve all answers the rest');
    ok(t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Approved'), 'client: then today\'s approve moves the video to Approved');
    ok(!t.errors.length, 'client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a version the SMM has not looked at yet is with the team (Probe rule-miss 13) ----------
    t = await start('client', true, fresh(), { noSmm: ['B'] });
    b = await bar(t);
    const teamDot = await t.page.evaluate(() => { const d = document.getElementById('svReviewStage').shadowRoot.querySelector('.trv-dot[data-trv-go="B"]'); return d ? d.className + '|' + d.getAttribute('aria-label') : ''; });
    ok(/team/.test(teamDot) && /with the team/.test(teamDot) && b.all === 'Approve all (4 waiting)', 'client: Video B (no SMM OK yet) has a muted dot, "with the team", and is not counted in Approve all (' + teamDot + ' | ' + b.all + ')');
    await inS(t.page, '.trv [data-trv-go="B"]').click();
    await sleep(700);
    const teamRow = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return { ok: !!r.querySelector('[data-ok="video"]'), txt: ((r.getElementById('drow') || {}).innerText || '').replace(/\s+/g, ' ') }; });
    ok(!teamRow.ok && /With the team: the SMM looks at Video B first/.test(teamRow.txt), 'client: on Video B no Approve, only "With the team" (' + teamRow.txt.slice(0, 80) + ')');
    await t.ctx.close();

    // ---------- sent for approval today's way, no version through the SMM: the client answers them (Sidney, 2026-10-27) ----------
    t = await start('client', true, fresh(), { noSmm: ['A', 'B', 'C', 'D', 'E'] });
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text) && b.ok === 'Approve Video A' && b.all === 'Approve all (5 waiting)' && b.dots.every(d => d === 'wait'),
      'client: a card sent to the client with no version through the SMM shows every version to answer (' + b.text + ' / ' + b.ok + ' / ' + b.all + ' / ' + b.dots.join(',') + ')');
    await inS(t.page, '[data-ok="video"]').click();
    await sleep(900);
    ok(t.T.versions[0].status === 'approved', 'client: and Approve answers Video A');
    ok(!t.errors.length, 'client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- Approve answers at once on a slow line, in order, and a refused one goes back (Sidney: "everything should feel fast") ----------
    t = await start('client', true, fresh());
    t.T.delay = 1500;
    n0 = t.state.upserts.length;
    let t0 = Date.now();
    await inS(t.page, '[data-ok="video"]').click();
    await waitFor(async () => /^Video B of 5/.test((await bar(t)).text) && (await bar(t)).dots[0] === 'ok', 40);
    const fast = Date.now() - t0;
    b = await bar(t);
    ok(/^Video B of 5/.test(b.text) && b.dots[0] === 'ok' && fast < 600 && t.T.versions[0].status === 'waiting',
      'client, slow line: Approve shows Video A approved and moves to Video B at once, before the server answers (' + fast + ' ms)');
    await inS(t.page, '[data-ok="video"]').click();
    await waitFor(async () => /^Video C of 5/.test((await bar(t)).text), 40);
    ok(/^Video C of 5/.test((await bar(t)).text), 'client, slow line: a second Approve right after is taken too, not lost');
    await waitFor(async () => t.T.versions[1].status === 'approved', 60);
    ok(t.T.versions[0].status === 'approved' && t.T.versions[1].status === 'approved' && t.T.calls.filter(c => c.action === 'answer').map(c => c.letter).join('') === 'AB',
      'client, slow line: both answers reach the server, in order (' + t.T.calls.filter(c => c.action === 'answer').map(c => c.letter).join('') + ')');
    b = await bar(t);
    ok(b.dots[0] === 'ok' && b.dots[1] === 'ok' && !t.state.upserts.slice(n0).some(u => u.video_status), 'client, slow line: A and B stay approved once the server agrees, and the card waits');
    t.T.delay = 300; t.T.failAnswer = 1;
    await inS(t.page, '[data-ok="video"]').click();
    await sleep(100);
    const early = (await bar(t)).dots[2];
    await waitFor(async () => (await bar(t)).dots[2] === 'wait' && /^Video C of 5/.test((await bar(t)).text), 40);
    b = await bar(t);
    ok(early === 'ok' && b.dots[2] === 'wait' && /^Video C of 5/.test(b.text) && t.T.versions[2].status === 'waiting',
      'client, refused: Video C reads approved at once, then goes back to waiting, on Video C (' + early + ' then ' + b.dots[2] + ', ' + b.text + ')');
    ok(await t.page.evaluate(() => /Video C was not approved/.test(document.body.innerText)), 'client, refused: and the page says Video C was not approved');
    ok(!t.errors.length, 'client, slow line: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a version this reviewer already approved shows its approved state (Probe rule-miss 14) ----------
    t = await start('client', true, fresh({ A: { status: 'approved', client_ok_at: '2026-10-27T08:30:00.000Z' } }));
    await inS(t.page, '.trv [data-trv-go="A"]').click();
    await sleep(700);
    const done = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return { ok: !!r.querySelector('[data-ok="video"]'), txt: ((r.getElementById('drow') || {}).innerText || '').replace(/\s+/g, ' ') }; });
    ok(!done.ok && /Video A approved/.test(done.txt), 'client: on a version already approved, "Video A approved", not Approve again (' + done.txt.slice(0, 60) + ')');
    await t.ctx.close();

    // ---------- the client link on a phone: no arrows, swipe the video (Probe E3) ----------
    t = await start('client', true, fresh(), { width: 390, height: 844, context: { hasTouch: true, isMobile: true } });
    b = await bar(t);
    const swipe = dx => t.page.evaluate(dx => {
      const r = document.getElementById('svReviewStage').shadowRoot, v = r.getElementById('view'), q = v.getBoundingClientRect();
      const x = q.left + q.width / 2, y = q.top + q.height / 3;
      const touch = (cx) => new Touch({ identifier: 1, target: v, clientX: cx, clientY: y });
      v.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(x)], changedTouches: [touch(x)], bubbles: true, composed: true }));
      v.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(x + dx)], bubbles: true, composed: true }));
    }, dx);
    const phone = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const s = r.querySelector('.trv-swipe');
      return { arrows: [...r.querySelectorAll('.trv-side')].some(a => a.offsetParent), hint: !!(s && s.offsetParent) && s.textContent.trim(),
        wide: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
    ok(!phone.arrows && phone.hint === 'Swipe for the next version' && /Video A of 5/.test(b.text) && !phone.wide, 'phone: no arrows, "Swipe for the next version" under the player, no sideways scroll');
    await swipe(-120); await sleep(700);
    b = await bar(t);
    ok(/Video B of 5/.test(b.text), 'phone: a swipe to the left shows the next version (' + b.text + ')');
    await swipe(120); await sleep(700);
    b = await bar(t);
    ok(/Video A of 5/.test(b.text), 'phone: a swipe to the right goes back (' + b.text + ')');
    ok(!t.errors.length, 'phone: no page errors (' + t.errors.join(' | ') + ')');
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
    // The fake server marks the version before its answer reaches the page, which then clears what it kept: wait for both.
    for (let i = 0; i < 60 && (t.T.versions[3].status !== 'change asked' || await t.page.evaluate(() => localStorage.getItem('syncview_trv_pending_v1'))); i++) await sleep(100);
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
    ok(await tags(t) === 'Trial x1', 'client after the pick: still the one "Trial" marker (' + await tags(t) + ')');
    await t.ctx.close();

    // ---------- the SMM's Review tab ----------
    t = await start('smm', true, fresh());
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text) && /Approve to Kasper/.test(b.ok), 'SMM: the same bar, and today\'s Approve to Kasper (' + b.ok + ')');
    ok(await tags(t) === 'Trial x1', 'SMM: one "Trial" marker (' + await tags(t) + ')');
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
    await inS(t.page, '[data-trv-all]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Kasper Approval'); i++) await sleep(100);
    ok(t.T.versions.every(v => v.smm_ok_at) && t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), 'SMM: Approve all, then today\'s save moves the video to Kasper Approval');
    ok(!t.errors.length, 'SMM: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
    // ---------- Kasper's second layout: every version side by side (decision 4) ----------
    t = await start('kasper', true, fresh(), { layout2: true });
    const tiles = () => t.page.evaluate(() => {
      const r = document.getElementById('svReviewStage').shadowRoot;
      return { names: [...r.querySelectorAll('.trk-v .trk-n')].map(n => n.textContent.trim()), bar: !!r.querySelector('.trv'),
        ok: r.querySelectorAll('.trk-v [data-trk-ok]').length, cur: ((r.querySelector('.trk-v.cur .trk-n') || {}).textContent || '').trim(),
        labs: [...r.querySelectorAll('.trk-v')].map(v => ((v.querySelector('.trk-lab') || {}).textContent || '').trim()), hook: /Fictional hook/.test(r.innerHTML),
        all: ((r.querySelector('[data-trk-all]') || {}).textContent || '').trim(),
        // Probe K2, K3, K4, K5: the video part's own Approve and Ask for change give way to the tiles (only Frame
        // tweaks stays, naming the version on stage); the badge names it; Approve all sits at the top right; the list
        // says "5 versions" under the card.
        vidOk: !!r.querySelector('.pn-d[data-pd="video"] [data-ok="video"], .pn-d[data-pd="video"] [data-chg="video"]'),
        frame: ((r.querySelector('.pn-d[data-pd="video"] [data-frame="video"]') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        badge: ((r.querySelector('#fvHost > .mpill') || {}).textContent || '').trim(),
        allRight: (() => { const a = r.querySelector('[data-trk-all]'), h = r.querySelector('.trk-h'); if (!a || !h) return false; return h.getBoundingClientRect().right - a.getBoundingClientRect().right < 2; })(),
        list: ((r.querySelector('#qlList .ql-r.cur .trv-vn') || {}).textContent || '').trim() };
    });
    if (process.env.TRIAL_REVIEW_SHOTS) { require('fs').mkdirSync(process.env.TRIAL_REVIEW_SHOTS, { recursive: true }); await t.page.screenshot({ path: path.join(process.env.TRIAL_REVIEW_SHOTS, 'kasper-layout2.png') }); }
    let k = await tiles();
    ok(k.names.join('|') === 'Video A|Video B|Video C|Video D|Video E' && !k.bar && !k.hook, 'Kasper, second layout: every version side by side, named Video A to E, no bar and no hook text');
    ok(k.ok === 5 && k.all === 'Approve all' && k.allRight && k.cur === 'Video A', 'each tile has its own Approve, and Approve all sits at the top right (Probe K4); Video A is on stage');
    ok(!k.vidOk && /Video A/.test(k.frame) && k.badge === 'Video A', "the video part's own Approve and Ask for change give way to the tiles; Frame tweaks and the badge name the version on stage (Probe K2, K3: " + k.frame + ' | ' + k.badge + ')');
    ok(k.list === '5 versions', 'the list says "5 versions" under the trial card (Probe K5: ' + k.list + ')');
    await inS(t.page, '.trk-v [data-trk-go="C"]').click();
    await sleep(1200);
    k = await tiles();
    ok(k.cur === 'Video C' && t.T.views.includes(LINK('C')), 'a press on Video C puts it on stage, and only its video loads');
    n0 = t.state.upserts.length;
    await inS(t.page, '.trk-v [data-trk-ok="B"]').click();
    await waitFor(async () => t.T.calls.some(c => c.action === 'answer' && c.letter === 'B'));
    await sleep(900);
    k = await tiles();
    ok(!!t.T.versions[1].kasper_ok_at && k.labs[1] === 'approved' && !t.state.upserts.slice(n0).some(u => u.video_status), "Video B's own Approve stamps his OK there and leaves the card waiting");
    await inS(t.page, '.trk-v [data-trk-drop="D"]').click();
    await waitFor(async () => t.T.versions[3].status === 'dropped');
    await sleep(900);
    k = await tiles();
    ok(t.T.versions[3].status === 'dropped' && k.names.length === 4, 'the team drops Video D from its tile');
    // A refused drop of the version on the card puts the card's link back (Probe bug 12b).
    t.T.refuseDrop = true;
    await inS(t.page, '.trk-v [data-trk-drop="A"]').click();
    await waitFor(async () => t.T.attaches.length >= 2);
    await sleep(900);
    // (The fixture card carries its own link; the put-back goes to exactly what the card carried before.)
    ok(t.T.attaches.length === 2 && t.T.attaches[0] === LINK('B') && t.T.attaches[1] !== LINK('B') && t.T.mainLink === t.T.attaches[1] && t.T.versions[0].status !== 'dropped',
      "a refused drop of Video A from its tile puts the card's link back to what it carried (" + t.T.attaches.join('|') + ')');
    t.T.mainLink = LINK('A');
    t.T.attaches = [];
    await t.page.evaluate(() => { const ov = document.getElementById('confirmOverlay'); if (ov) ov.classList.remove('active'); });
    // Default (c): Video A, on the card, drops too: today's attach first puts the next live version (B) on the card.
    await inS(t.page, '.trk-v [data-trk-drop="A"]').click();
    await waitFor(async () => t.T.versions[0].status === 'dropped');
    await sleep(900);
    k = await tiles();
    ok(t.T.attaches.join('|') === LINK('B') && t.T.versions[0].status === 'dropped' && k.names.join('|') === 'Video B|Video C|Video E',
      "Video A, on the card, drops from its tile after today's attach puts Video B on the card (" + t.T.attaches.join('|') + ')');
    const gk0 = t.state.gateway.length;
    await inS(t.page, '[data-trk-all]').click();
    for (let i = 0; i < 80 && !(t.state.upserts.slice(n0).some(u => u.video_status === 'Client Approval') || t.state.gateway.slice(gk0).some(x => /client_approval|Client Approval/.test(String(x)))); i++) await sleep(100);
    ok(['B', 'C', 'E'].every(l => !!t.T.versions.find(v => v.letter === l).kasper_ok_at)
      && (t.state.upserts.slice(n0).some(u => u.video_status === 'Client Approval') || t.state.gateway.slice(gk0).some(x => /client_approval|Client Approval/.test(String(x)))),
      'Approve all answers the rest, then today\'s approve sends the video on to the client');
    ok(!t.errors.length, 'Kasper second layout: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
    // Two trial cards whose tiles look the same (same versions, same poster): the tiles act on the card on screen (Codex
    // on PR 2366: the drawn tiles kept the first card's handlers).
    t = await start('kasper', true, fresh(), { layout2: true, cards: ['rs1', 'rs3'] });
    await inS(t.page, '#qlList [data-id="rs3"]').click();
    await sleep(1500);
    if (!(await inS(t.page, '.trk-v [data-trk-ok="B"]').count())) { await t.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1500); }
    const a0 = t.T.calls.length;
    await inS(t.page, '.trk-v [data-trk-ok="B"]').click();
    await waitFor(async () => t.T.calls.slice(a0).some(c => c.action === 'answer'));
    const asked = t.T.calls.slice(a0).find(c => c.action === 'answer') || {};
    ok(asked.post_id === 'rs3' && asked.letter === 'B', "a second trial card with the same tiles: its tile's Approve answers that card, not the first (" + asked.post_id + ')');
    await t.ctx.close();

    // ---------- two trial cards with the same versions: the dots answer the card on screen (Trialtest, 2026-10-28) ----------
    // The bar under the player was kept when its markup matched, so after a switch to a card with identical versions its
    // dots still held the first card: a press did nothing here and moved the first card instead.
    t = await start('client', true, fresh(), { cards: ['rs1', 'rs3'] });
    await inS(t.page, '#skList .chipp[data-id="rs3"]').click();
    await waitFor(async () => /^Video A of 5/.test((await bar(t)).text) && await t.page.evaluate(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('#skList .chipp.cur[data-id="rs3"]')), 60);
    await inS(t.page, '.trv [data-trv-go="B"]').click();
    await sleep(500);
    const onSecond = (await bar(t)).text;
    await inS(t.page, '#skList .chipp[data-id="rs1"]').click();
    await waitFor(async () => await t.page.evaluate(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('#skList .chipp.cur[data-id="rs1"]')), 60);
    await sleep(500);
    const onFirst = (await bar(t)).text;
    ok(/^Video B of 5/.test(onSecond) && /^Video A of 5/.test(onFirst), 'a second trial card with the same versions: its dot B shows Video B there and leaves the first card on Video A (' + onSecond + ' | ' + onFirst + ')');
    ok(!t.errors.length, 'two trial cards: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- Kasper's Review Session ----------
    t = await start('kasper', true, fresh());
    b = await bar(t);
    ok(/^Video A of 5/.test(b.text), 'Kasper: the same bar (' + b.text + ')');
    ok(await tags(t) === 'Trial x1', 'Kasper: one "Trial" marker (' + await tags(t) + ')');
    // Kasper approves only the version on screen, so his button names it, as the client's does (Trialtest, 2026-10-28).
    ok(b.ok === 'Approve Video A', 'Kasper: the approve button names the version on screen (' + b.ok + ')');
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
    // ---------- Kasper's second layout ----------
    t = await start('kasper', true, fresh(), { layout2: true });
    ok(await tags(t) === 'Trial x1', 'Kasper, second layout: one "Trial" marker (' + await tags(t) + ')');
    // Every version has its own tile here (build 6), so each tile's Approve names its own version (Trialtest, 551).
    const l2ok = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return [...r.querySelectorAll('.trk-ok')].map(n => n.getAttribute('aria-label') || n.textContent.trim()).join('|'); });
    ok(l2ok === 'Approve Video A|Approve Video B|Approve Video C|Approve Video D|Approve Video E', 'Kasper, second layout: each tile\'s Approve names its version (' + l2ok + ')');
    ok(!t.errors.length, 'Kasper, second layout: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
    // ---------- a video that cannot play: its message is never under the player's two pills (Trialtest, 2026-10-28) ----------
    // On the review page the version badge ("Video A") and "Open in Frame.io" sit over the top of the player. When the
    // video cannot load, the player's error panel fills it, and its title must start below the pills, not under them.
    const pillsClear = t => t.page.evaluate(() => {
      const r = document.getElementById('svReviewStage').shadowRoot;
      const st = [...r.querySelectorAll('.fv-player[data-state="error"] .fv-state-title')].find(n => n.getClientRects().length);
      if (!st) return 'no error panel';
      const a = st.getBoundingClientRect();
      const hit = [...r.querySelectorAll('#fvHost > .mpill, #fvHost .fv-stage-foot .fv-open-link')].filter(n => n.getClientRects().length).find(n => {
        const b = n.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; });
      return hit ? 'under ' + hit.className + ' (title top ' + Math.round(a.top) + ', pill bottom ' + Math.round(hit.getBoundingClientRect().bottom) + ')' : 'clear';
    });
    // Trialtest's case: a version whose link is refused before any load (a Frame.io project page, not a share or file
    // link) on a card with no thumbnail, so no poster and no aspect ratio: the player is only a short box.
    const PROJECT = 'https://next.frame.io/project/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
    const noPoster = async t => {
      t.state.cards.forEach(c => { c.thumbnail_url = ''; });
      // frameio-view refuses such a link before any load, as it does live (logic.mjs, unsupported_link).
      await t.ctx.route('**/functions/v1/frameio-view*', route => {
        const r = route.request();
        if (r.method() !== 'OPTIONS' && (r.postData() || '').includes('/project/')) return route.fulfill({ status: 422, headers: CORS, contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'unsupported_link', message: 'This link is not a Frame.io share or file link, so it cannot be played here.' }) });
        return route.fallback();
      });
    };
    t = await start('kasper', true, fresh({ C: { frame_url: PROJECT } }), { layout2: true, beforeOpen: noPoster });
    await inS(t.page, '[data-trk-go="C"]').click();
    await waitFor(async () => (await pillsClear(t)) !== 'no error panel', 80);
    let clear = await pillsClear(t);
    if (process.env.TRIAL_REVIEW_SHOTS) await t.page.screenshot({ path: path.join(process.env.TRIAL_REVIEW_SHOTS, 'video-error-kasper-l2.png') });
    ok(clear === 'clear', 'Kasper, second layout, 1440: a version that cannot play, with no poster, shows its message below the badge and "Open in Frame.io" (' + clear + ')');
    await t.ctx.close();
    // The same on the SMM's Review tab at 390, where the player is narrow.
    t = await start('smm', true, fresh({ C: { frame_url: PROJECT } }), { width: 390, height: 844, context: { hasTouch: true, isMobile: true }, beforeOpen: noPoster });
    await inS(t.page, '.trv [data-trv-go="C"]').click();
    await waitFor(async () => (await pillsClear(t)) !== 'no error panel', 80);
    clear = await pillsClear(t);
    if (process.env.TRIAL_REVIEW_SHOTS) await t.page.screenshot({ path: path.join(process.env.TRIAL_REVIEW_SHOTS, 'video-error-smm-390.png') });
    ok(clear === 'clear', 'SMM, 390: a version that cannot play, with no poster, shows its message below the badge and "Open in Frame.io" (' + clear + ')');
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
