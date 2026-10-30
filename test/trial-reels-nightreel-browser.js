'use strict';
/*
 * TRIAL REELS, SESSION NIGHTREEL'S LIVE WALK (2026-10-30), in a real browser, fully offline, on the review page's shared
 * fixture (test/fixtures/review-stage-fixture.js: fictional clients, cards and tokens). The trial-reels function is
 * answered by its own rules (logic.mjs). Each part fails on main by itself:
 *   passtweaks  the client link: "Not this one" on the last version open to the client while another version waits for
 *               its new cut sends the card to Tweaks Needed; the passed version still says "Not this one", never
 *               "Video C waits: the card is with the editor".
 *   smmtweaks   the SMM's Review tab lists a card in Tweaks Needed while one version's new cut waits for the SMM and
 *               another version's change is still open (the new cut's toast says it goes back to the SMM), and the
 *               SMM's approve sends it on to Kasper.
 *   tile        Kasper's second layout: a "Client dropped" tile label is whole, never cut to "Client dropp…".
 *   sdate       Kasper's header on a card with no date: "First review" with no stray dot before it.
 *   kround      Kasper's standard layout: changes on several versions in one sitting are one round, and his change on one
 *               version (the card stays with him) never turns his header into "Back after tweaks, round N+1" mid-review, and the "Change sent for Video A" line is centred under the
 *               version like everything else on the stage, not at the stage's left edge.
 *   behind      every version already has this reviewer's answer but the card is still at their status (the tab reloaded
 *               between the version's save and today's stage approve): the SMM, Kasper (both layouts) and the client get
 *               a line and today's approve, which moves the card on; before, there was nothing to press.
 *   phonesmm    the SMM's Review tab on a staff phone starts right under the Calendar's bar, not a whole screen lower
 *               (the Calendar's box kept its one-screen height with only its bar showing).
 * At 1440 (and 390 where the surface exists), light and dark.
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
const part = k => !process.env.TRL_PART || process.env.TRL_PART === k;

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
    // The card's own status, as the real function reads it (per-version routing reads it; the client view is unchanged).
    T.cardStatus = () => ((t.state && t.state.cards || []).find(c => c.id === 'rs1') || {}).video_status || 'Client Approval';
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
        L.readShape(T.versions, { client, mainLink: T.mainLink || T.versions[0].frame_url, cardStatus: T.cardStatus() }));
      const reply = (o, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list') return reply({ ok: true, cards: Object.fromEntries((T.cards || ['rs1']).map(id => [id, shape()])) });
      if (b.action === 'answer' && b.kind === 'change' && T.failChange > 0) { T.failChange--; return reply({ ok: false, error: 'write_failed' }, 500); }
      if (b.action === 'answer') {
        // A slow line, or one refused answer, when a check asks for it (the page must answer at once all the same).
        if (T.delay) await new Promise(res => setTimeout(res, T.delay));
        if (T.failAnswer > 0 && b.kind !== 'change') { T.failAnswer--; return reply({ ok: false, error: 'write_failed' }, 500); }
        const res = L.answerPatches(T.versions, { stage: client ? 'client' : b.stage, kind: b.kind, letter: b.letter, note: b.note, cardStatus: T.cardStatus() }, new Date().toISOString());
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

  const R = (t, fn, arg) => t.page.evaluate(([f, a]) => (new Function('r', 'a', f))(document.getElementById('svReviewStage').shadowRoot, a), [String(fn), arg]);
  const said = t => R(t, `return [...r.querySelectorAll('.dst')].filter(n => n.offsetParent).map(n => n.textContent.trim()).join('|');`);
  const bar = t => R(t, `const b = r.querySelector('.trv-under'); return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';`);
  const press = (t, sel) => t.page.evaluate(q => { const b = document.getElementById('svReviewStage').shadowRoot.querySelector(q); if (b) b.click(); return !!b; }, sel);
  const waitFor = async (f, n) => { for (let i = 0; i < (n || 60) && !(await f()); i++) await sleep(100); return f(); };
  const theme = async (t, th) => { await t.page.evaluate(x => { document.documentElement.setAttribute('data-theme', x); try { localStorage.setItem('syncview_theme', x); } catch (e) {} }, th); await sleep(200); };
  const SETTLE_MS = Number((require('fs').readFileSync(path.join(__dirname, '..', 'src', 'index', '194-review-trial-versions.js.part'), 'utf8').match(/const TRV_SETTLE_MS = (\d+);/) || [])[1]);
  const routeMoved = (t, word, code) => t.state.upserts.some(u => u.video_status === word) || (t.gw || []).some(g => g.op === 'status' && g.status === code);
  const keepGateway = async t2 => {
    const native = { status: 'client_approval', at: '2026-10-27T09:00:00.000Z' };
    t2.T_native = native;
    await t2.ctx.route('**/rest/v1/deliverables?*', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify([{ id: 'del_rs1', status: native.status, status_at: native.at, updated_at: native.at }]) }));
    await t2.ctx.route('**/functions/v1/production-write', route => {
      let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (b.operation === 'attachment') return route.fallback();
      const at = new Date().toISOString();
      (t2.gw || (t2.gw = [])).push({ op: b.operation, status: b.status || '', body: b.comment ? b.comment.body : '' });
      if (b.operation === 'status' && b.status) Object.assign(native, { status: b.status, at });
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(Object.assign({ ok: true, native_committed: true, complete: true, row: { id: b.id || 'del_rs1', status: b.status, updated_at: at } },
        b.operation === 'comment' && b.comment ? { comment: Object.assign({}, b.comment, { id: b.comment.native_comment_id, created_at: at, updated_at: at, source_created_at: at, source_updated_at: at }) } : {})) });
    });
  };

  try {
    // ---------- passtweaks: the client's "Not this one" while another version waits for its new cut ----------
    for (const [w, h, label] of [[1440, 900, 'client 1440'], [390, 844, 'client 390']].filter(() => part('passtweaks'))) {
      // A and C came through the team; B's change is open (it waits for its new cut, so the client does not see it).
      const vs = fresh().slice(0, 3).map(v => Object.assign(v, { kasper_ok_at: '2026-10-27T08:30:00.000Z' }));
      Object.assign(vs[1], { status: 'change asked', smm_ok_at: null, kasper_ok_at: null, change_by: 'smm', change_note: 'Fictional note', change_at: '2026-10-27T08:40:00.000Z' });
      const t = await start('client', true, vs, Object.assign({ width: w, height: h, beforeOpen: keepGateway }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      ok(/Video A of 2/.test(await bar(t)), `${label}: the client sees A and C only ("${await bar(t)}")`);
      const t0 = Date.now();
      await press(t, '[data-ok="video"]');
      await waitFor(async () => t.T.versions[0].status === 'approved', 60);
      await sleep(Math.max(0, t0 + SETTLE_MS + 100 - Date.now()));
      ok(/Video C of 2/.test(await bar(t)), `${label}: after A's approve the page is on C ("${await bar(t)}")`);
      await press(t, '[data-pass="video"]');
      await waitFor(async () => !!t.T.versions[2].client_pass_at, 60);
      // Nothing waits for the client and B waits for its new cut: the card goes to Tweaks Needed (plan, per-version routing).
      await waitFor(async () => routeMoved(t, 'Tweaks Needed', 'tweak'), 80);
      await sleep(1500);
      ok(routeMoved(t, 'Tweaks Needed', 'tweak'), `${label}: the card goes to Tweaks Needed for B's new cut`);
      for (const th of ['light', 'dark']) {
        await theme(t, th);
        const s = await said(t);
        ok(/Video C of 2/.test(await bar(t)) && /Not this one/.test(s) && !/waits|with the editor/.test(s),
          `${label} ${th}: C's own screen still says "Not this one", never that C waits for the editor ("${s}")`);
      }
      await press(t, '[data-trv-go="A"]'); await sleep(600);
      const sA = await said(t);
      ok(/Video A approved|Approved/.test(sA) && !/waits/.test(sA), `${label}: A says it is approved ("${sA}")`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- smmtweaks: a new cut waits for the SMM while the card is in Tweaks Needed ----------
    for (const [w, h, label] of [[1440, 900, 'smm 1440'], [390, 844, 'smm 390']].filter(() => part('smmtweaks'))) {
      // Both versions were asked for a change at the SMM stage (the card went to Tweaks Needed); A's new cut is in, so A
      // waits for the SMM again, while B's change is still open, so the card stays in Tweaks Needed.
      const vs = fresh().slice(0, 2);
      Object.assign(vs[0], { revision: 1 });
      Object.assign(vs[1], { status: 'change asked', change_by: 'smm', change_note: 'Fictional note on B', change_at: '2026-10-27T08:40:00.000Z' });
      const t = await start('smm', true, vs, Object.assign({ width: w, height: h, beforeOpen: async t2 => {
        await keepGateway(t2);
        t2.T_native.status = 'tweak';
        for (const c of t2.state.cards) Object.assign(c, { video_status: 'Tweaks Needed', graphic_status: 'Approved', caption_status: 'Approved', status: 'Tweaks Needed' });
      } }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      await waitFor(async () => /Video A of 2/.test(await bar(t)), 40);
      const b = await bar(t);
      const okBtn = await R(t, `const b = r.querySelector('[data-ok="video"]'); return b && b.offsetParent ? b.textContent.trim() : '';`);
      ok(/Video A of 2/.test(b) && /^Approve/.test(okBtn), `${label}: the SMM's Review tab lists the card for A's new cut, on A with its Approve ("${b}" | "${okBtn}")`);
      await press(t, '[data-ok="video"]');
      await waitFor(async () => !!t.T.versions[0].smm_ok_at, 60);
      await waitFor(async () => routeMoved(t, 'Kasper Approval', 'kasper_approval'), 80);
      await sleep(1500);
      ok(!!t.T.versions[0].smm_ok_at && routeMoved(t, 'Kasper Approval', 'kasper_approval'), `${label}: the SMM's approve on A sends the card on to Kasper while B waits for its new cut (A smm ok: ${!!t.T.versions[0].smm_ok_at}; writes: ${(t.gw || []).map(g => g.op + ':' + g.status).concat(t.state.upserts.map(u => u.video_status).filter(Boolean)).join(',') || 'none'}; said: ${await said(t)})`);
      const bOpen = await t.page.evaluate(() => { const p = (calState.posts || []).find(x => x.id === 'rs1'); let l = []; try { l = _calCommentsFor(p, 'video') || []; } catch (e) {} return l.filter(c => /Video B:/.test(String(c.body || ''))).map(c => !!c.done); });
      ok(bOpen.every(d => !d), `${label}: B's change request stays open (${JSON.stringify(bOpen)})`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- kround: Kasper's standard layout, his change on one version while the card stays ----------
    for (const [w, h, label] of [[1440, 900, 'kasper 1440'], [1280, 860, 'kasper 1280']].filter(() => part('kround'))) {
      const vs = fresh().slice(0, 3);
      const t = await start('kasper', true, vs, { width: w, height: h, beforeOpen: async t2 => {
        await keepGateway(t2);
        t2.T_native.status = 'kasper_approval';
        // Two earlier rounds: on 20 Oct Kasper asked changes on A and B two minutes apart (one sitting), on 25 Oct one on A;
        // the card came back to him on 27 Oct.
        const card = t2.state.cards.find(c => c.id === 'rs1');
        card.video_status_at = '2026-10-27T08:00:00.000Z';
        const kn = (id, body, at) => ({ id, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, audience: 'internal', body, created_at: at, updated_at: at, done: true, done_at: '2026-10-26T10:00:00.000Z', done_by: 'Team Member' });
        card.video_tweaks = JSON.stringify([kn('k0', 'Video A: fictional earlier change', '2026-10-20T10:00:00.000Z'), kn('k1', 'Video B: fictional earlier change', '2026-10-20T10:02:00.000Z'), kn('k2', 'Video A: fictional second change', '2026-10-25T09:00:00.000Z')]);
      } });
      const head = () => R(t, `const d = r.getElementById('sdate'); return d ? d.innerText.replace(/\\s+/g, ' ').trim() : '';`);
      await waitFor(async () => /Video A of 3/.test(await bar(t)), 40);
      ok(/Back after tweaks, round 3/.test(await head(t)), `${label}: before his change the header reads round 3: two sittings, the first with changes on A and B ("${await head(t)}")`);
      await press(t, '[data-chg="video"]'); await sleep(300);
      await inS(t.page, '#ta').fill('Fictional note: a calmer start on A.');
      await inS(t.page, '#sendBtn').click();
      await waitFor(async () => t.T.versions[0].status === 'change asked', 60);
      await waitFor(async () => !!(await R(t, `const n = r.querySelector('.trv-sent .cp-done'); return !!(n && n.offsetParent);`)), 60);
      await sleep(800);
      const hd = await head(t);
      ok(/Back after tweaks, round 3/.test(hd) && !/round 4/.test(hd), `${label}: after his change on A, with B and C still his, the header still reads round 3 ("${hd}")`);
      for (const th of ['light', 'dark']) {
        await theme(t, th);
        const g = await R(t, `const n = r.querySelector('.trv-sent .cp-done'), u = r.querySelector('.trv-under .trv-n') || r.querySelector('.trv-under');
          if (!n || !u) return null; const x = n.getBoundingClientRect(), y = u.getBoundingClientRect(); return { sent: Math.round(x.left + x.width / 2), under: Math.round(y.left + y.width / 2), text: n.textContent.trim() };`);
        ok(!!g && /Change sent for Video A/.test(g.text) && Math.abs(g.sent - g.under) <= 6, `${label} ${th}: "Change sent for Video A" is centred under the version (${JSON.stringify(g)})`);
      }
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- behind: every version answered, the card still at this reviewer's status ----------
    for (const [mode, extra, label, word, code] of [
      ['smm', {}, 'smm', 'Kasper Approval', 'kasper_approval'],
      ['kasper', {}, 'kasper standard', 'Client Approval', 'client_approval'],
      ['kasper', { layout2: true }, 'kasper layout 2', 'Client Approval', 'client_approval'],
      ['client', {}, 'client', 'Approved', 'approved'],
    ].filter(() => part('behind'))) {
      const at = '2026-10-27T08:30:00.000Z';
      const vs = fresh().slice(0, 2).map(v => Object.assign(v, { smm_ok_at: at },
        mode === 'smm' ? {} : { kasper_ok_at: at }, mode === 'client' ? { status: 'approved', client_ok_at: at } : {}));
      const t = await start(mode, true, vs, Object.assign({ beforeOpen: async t2 => {
        await keepGateway(t2);
        t2.T_native.status = mode === 'smm' ? 'smm_approval' : mode === 'kasper' ? 'kasper_approval' : 'client_approval';
      } }, extra));
      if (extra.layout2) { await t.page.evaluate(() => _rsGo('rs1')); await sleep(800); }
      const g = await R(t, `const b = [...r.querySelectorAll('[data-ok="video"]')].find(n => n.offsetParent); const l = r.querySelector('.trv-behind');
        return { btn: b ? b.textContent.trim() : '', line: l && l.offsetParent ? l.textContent.trim() : '' };`);
      if (process.env.NR_SHOTS) await t.page.screenshot({ path: path.join(process.env.NR_SHOTS, 'behind-' + label.replace(/\s+/g, '-') + '.png') });
      ok(/approved every version|Every version is approved/.test(g.line) && /^Approve/.test(g.btn), `${label}: the card still at its status with every version answered offers today's approve ("${g.line}" | "${g.btn}")`);
      await press(t, '[data-ok="video"]');
      await waitFor(async () => routeMoved(t, word, code), 80);
      await sleep(800);
      ok(routeMoved(t, word, code), `${label}: the approve moves the card on to ${word}`);
      ok(!t.T.calls.some(c => c.action === 'answer'), `${label}: no version is answered again (${t.T.calls.filter(c => c.action === 'answer').length} answers)`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // The SMM's last approve on a slow line: while its answer is on its way the page never offers that save again.
    for (const label of ['smm slow last approve'].filter(() => part('behind'))) {
      const vs = fresh().slice(0, 2);
      vs[0].smm_ok_at = '2026-10-27T08:30:00.000Z';
      const t = await start('smm', true, vs, { beforeOpen: async t2 => { await keepGateway(t2); t2.T_native.status = 'smm_approval'; } });
      await waitFor(async () => /Video B of 2/.test(await bar(t)), 40);
      t.T.delay = 1500;
      await press(t, '[data-ok="video"]');
      let seen = false;
      for (let i = 0; i < 14; i++) { if (await R(t, `const l = r.querySelector('.trv-behind'); return !!(l && l.offsetParent);`)) seen = true; await sleep(100); }
      await waitFor(async () => routeMoved(t, 'Kasper Approval', 'kasper_approval'), 80);
      ok(!seen && routeMoved(t, 'Kasper Approval', 'kasper_approval'), `${label}: no "Every version is approved" while the answer is on its way, and the card goes on to Kasper by itself (seen: ${seen})`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- phonesmm: the SMM's Review tab on a staff phone ----------
    for (const [w, h, label] of [[390, 844, 'smm phone 390'], [360, 780, 'smm phone 360']].filter(() => part('phonesmm'))) {
      const vs = fresh().slice(0, 3);
      const t = await start('smm', true, vs, { width: w, height: h, context: { hasTouch: true, isMobile: true } });
      for (const th of ['light', 'dark']) {
        await theme(t, th);
        const g = await t.page.evaluate(() => {
          const host = document.getElementById('svReviewStage'), r = host && host.shadowRoot;
          const okb = r && r.querySelector('[data-ok="video"], .b-ok');
          const bar = document.querySelector('#calView > .cal-toolbar');
          return { phone: document.documentElement.classList.contains('sv-staff-phone'), hostTop: host ? Math.round(host.getBoundingClientRect().top) : -1,
            barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : -1, okTop: okb ? Math.round(okb.getBoundingClientRect().top) : -1, vh: innerHeight };
        });
        ok(g.phone && g.hostTop >= 0 && g.hostTop - g.barBottom < 120 && g.okTop > 0 && g.okTop < g.vh * 2,
          `${label} ${th}: the review starts right under the Calendar's bar, not a screen lower (${JSON.stringify(g)})`);
      }
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- tile + sdate: Kasper's second layout ----------
    for (const th of ['light', 'dark'].filter(() => part('tile') || part('sdate'))) {
      const vs = fresh().slice(0, 3).map(v => Object.assign(v, { kasper_ok_at: null }));
      Object.assign(vs[0], { kasper_ok_at: '2026-10-27T08:30:00.000Z' });
      Object.assign(vs[2], { client_pass_at: '2026-10-27T08:50:00.000Z' });
      const t = await start('kasper', true, vs, { layout2: true, dark: th === 'dark', beforeOpen: async t2 => {
        // The first card has no date yet ("First review" stands alone in the header).
        Object.assign(t2.state.cards.find(c => c.id === 'rs1'), { scheduled_date: '' });
      } });
      // A card with no date is listed last: put it on stage, as a press on its row in the list does.
      await t.page.evaluate(() => _rsGo('rs1'));
      await waitFor(async () => !!(await R(t, `return !!r.querySelector('.trk-v');`)), 60);
      await sleep(600);
      if (part('tile')) {
        const lab = await R(t, `const n = r.querySelector('.trk-lab[data-l="passed"]'); if (!n) return null; return { text: n.textContent.trim(), sw: n.scrollWidth, cw: n.clientWidth, lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight || '12')) };`);
        ok(!!lab && lab.text === 'Client dropped' && lab.sw <= lab.cw + 1, `${th}: the "Client dropped" tile label is whole (${JSON.stringify(lab)})`);
        const fits = await R(t, `return [...r.querySelectorAll('.trk-v')].every(v => { const a = v.getBoundingClientRect(); return [...v.querySelectorAll('.trk-acts > *')].every(c => { const b = c.getBoundingClientRect(); return b.right <= a.right + 0.5 && b.left >= a.left - 0.5; }); });`);
        ok(fits, `${th}: every tile's buttons and label sit inside the tile`);
      }
      if (part('sdate')) {
        const sd = await R(t, `const d = r.getElementById('sdate'); if (!d) return null; const n = d.querySelector('.sdn'); return { text: d.innerText.trim(), before: n ? getComputedStyle(n, '::before').content : '' };`);
        ok(!!sd && /^First review/.test(sd.text) && (sd.before === 'none' || sd.before === 'normal' || sd.before === '""'), `${th}: no stray dot before "First review" on a card with no date (${JSON.stringify(sd)})`);
      }
      ok(!t.errors.length, `${th}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.error('  - ' + f)); process.exit(1); }
})();
