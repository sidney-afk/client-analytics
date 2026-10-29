'use strict';
/*
 * TRIAL REELS, THE OWNER'S SECOND ROUND ON THE REVIEW PAGE (session Trials, 2026-10-28), in a real browser, fully
 * offline, on the review page's shared fixture (test/fixtures/review-stage-fixture.js: fictional clients, cards and
 * tokens). The trial-reels function is answered by its own rules (logic.mjs). Sidney:
 *   3. "when it's a trial, shouldn't the client have the option to reject it, like to drop it?": a "Not this one" on
 *      the version on screen of the client link. At once the page moves on; the version is the client's pass (never
 *      the last one left), the rest can still be approved and the card moves to Approved; Kasper's tiles say "Client
 *      passed" with Drop.
 *   5. Kasper's "TRIAL 3 versions" tiles "appeared really late": the read starts with his queue, and while it is not
 *      in, a row of tile placeholders holds their place, so nothing under it moves when the tiles land; a card with no
 *      picture shows a video mark in each tile, never a black square.
 *   2. On the review page too, switching versions never shows a wide box while the next version loads.
 * Follow-up (Trialtest's live walk, 2026-10-28): a version only the client approved (a card sent straight to Client
 *   Approval) says "Client approved" to the team on the SMM's Review tab and Kasper's two layouts, and the team's own
 *   answer works as before; a tile still with the SMM says "with the team", never "change asked".
 * At 1440 and 390, light and dark. TRIAL_R2_SHOTS=<dir> writes screenshots (fictional data only).
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
  const SHOTS = process.env.TRIAL_R2_SHOTS || '';
  const shot = async (t, name) => { if (!SHOTS) return; require('fs').mkdirSync(SHOTS, { recursive: true }); await t.page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const theme = async (t, th) => { await t.page.evaluate(x => { document.documentElement.setAttribute('data-theme', x); try { localStorage.setItem('syncview_theme', x); } catch (e) {} }, th); await sleep(200); };
  const R = (t, fn, arg) => t.page.evaluate(([f, a]) => (new Function('r', 'a', f))(document.getElementById('svReviewStage').shadowRoot, a), [String(fn), arg]);
  const dec = t => R(t, `const b = r.querySelector('.trv-under'); const p = r.querySelector('[data-pass="video"]');
    return { bar: b ? b.innerText.replace(/\\s+/g, ' ').trim() : '', pass: !!(p && p.offsetParent), dots: b ? [...b.querySelectorAll('.trv-dot')].map(d => d.className.replace('trv-dot', '').trim() || 'wait').join(',') : '',
      ok: ((r.querySelector('[data-ok="video"]') || {}).textContent || '').trim(), said: [...r.querySelectorAll('.dst')].map(n => n.textContent.trim()).join('|'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };`);
  // A press inside the review page's own root, found at the moment of the press (a repaint may have replaced it).
  const press = (t, sel) => t.page.evaluate(q => { const b = document.getElementById('svReviewStage').shadowRoot.querySelector(q); if (b) b.click(); return !!b; }, sel);
  const waitFor = async (f, n) => { for (let i = 0; i < (n || 60) && !(await f()); i++) await sleep(100); return f(); };
  // TRL_PART=pass|kasper|shape|dblclick|cok|keepcard|e1|e10|push|e11|hint|retry|route|routek|routec runs one part (each fails on main by itself).
  const part = k => !process.env.TRL_PART || process.env.TRL_PART === k;
  const three = () => fresh().slice(0, 3).map(v => Object.assign(v, { kasper_ok_at: '2026-10-27T08:30:00.000Z' }));
  // The page ignores a press that lands within TRV_SETTLE_MS of an answer moving it on (its double-click guard), so a
  // check that answers one version and then another waits that long from the first press, read from the page's source.
  const SETTLE_MS = Number((require('fs').readFileSync(path.join(__dirname, '..', 'src', 'index', '194-review-trial-versions.js.part'), 'utf8').match(/const TRV_SETTLE_MS = (\d+);/) || [])[1]);
  if (!(SETTLE_MS > 0)) throw new Error('TRV_SETTLE_MS not found in 194-review-trial-versions.js.part');
  const pastSettle = async since => { const left = since + SETTLE_MS + 50 - Date.now(); if (left > 0) await sleep(left); };

  try {
    // ---------- 3: the client's "Not this one" ----------
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']].filter(() => part('pass'))) {
      for (const th of ['light', 'dark']) {
        const tag = 'client ' + label + ' ' + th;
        const t = await start('client', true, three(), label === 'phone' ? { width: w, height: h, context: { hasTouch: true, isMobile: true } } : {});
        await theme(t, th);
        let d = await dec(t);
        ok(/Video A/.test(d.bar) && d.pass && d.ok === 'Approve Video A', `${tag}: Video A on screen, with "Not this one" beside Approve (${JSON.stringify(d)})`);
        await t.page.evaluate(() => { const b = document.getElementById('svReviewStage').shadowRoot.querySelector('[data-pass="video"]'); if (b) b.scrollIntoView({ block: 'center' }); });
        await sleep(200);
        await shot(t, 'r2-client-' + label + '-' + th);
        if (label === 'phone') {
          // The three buttons fit the phone's row or wrap whole: none cut off, none under another.
          const fit = await R(t, `const bs = [...r.querySelectorAll('.dec > button, .dec > .split')].filter(n => n.offsetParent).map(n => n.getBoundingClientRect());
            const vw = innerWidth; return { n: bs.length, inside: bs.every(b => b.left >= 0 && b.right <= vw + 0.5), apart: bs.every((a, i) => bs.every((b, j) => i >= j || a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5)) };`);
          ok(fit.n === 3 && fit.inside && fit.apart, `${tag}: Approve, Ask for a change and Not this one all fit the 390 screen, none on another (${JSON.stringify(fit)})`);
        }
        t.T.delay = 1500;
        // How long the page takes to show the next version after the press, measured in the page (the server waits 1.5 s).
        const ms = await t.page.evaluate(() => new Promise(res => {
          const r = document.getElementById('svReviewStage').shadowRoot, t0 = performance.now();
          r.querySelector('[data-pass="video"]').click();
          const look = () => { const b = r.querySelector('.trv-under'); if (b && /Video B/.test(b.innerText)) res(Math.round(performance.now() - t0)); else if (performance.now() - t0 > 3000) res(Infinity); else requestAnimationFrame(look); };
          look();
        }));
        d = await dec(t);
        ok(ms < 600 && /Video B/.test(d.bar) && /^on pass|pass/.test(d.dots.split(',')[0]), `${tag}: at once (${ms} ms) the page moves to Video B, and A's dot says not this one (${d.dots})`);
        await waitFor(async () => !!t.T.versions[0].client_pass_at, 40);
        ok(!!t.T.versions[0].client_pass_at && t.T.versions[0].status === 'waiting' && t.T.calls.some(c => c.action === 'answer' && c.kind === 'pass' && c.letter === 'A'), `${tag}: the server has the client's pass on Video A (its status left as it was)`);
        t.T.delay = 0;
        // Back on Video A: what the client said, no buttons.
        await press(t, '[data-trv-go="A"]');
        await sleep(300);
        d = await dec(t);
        ok(/Not this one: the team will take Video A out/.test(d.said) && !d.pass && !d.ok, `${tag}: on Video A the page says the team will take it out (${d.said})`);
        // A pass on B too: C is then the last version the client has not passed, so it offers Approve and a change only.
        await press(t, '[data-trv-go="B"]');
        await sleep(300);
        const n0 = t.state.upserts.length;
        await press(t, '[data-pass="video"]');
        const movedAt = Date.now();
        await waitFor(async () => !!t.T.versions[1].client_pass_at, 40);
        await sleep(600);
        d = await dec(t);
        ok(/Video C/.test(d.bar) && !d.pass && d.ok === 'Approve Video C', `${tag}: Video C, the last one not passed, offers Approve and a change but no "Not this one" (${JSON.stringify(d)})`);
        // Approve on C right after the pass on B moved the page there is a double press to the page: wait it out.
        await pastSettle(movedAt);
        await press(t, '[data-ok="video"]');
        for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Approved'); i++) await sleep(100);
        ok(t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Approved'), `${tag}: C approved, A and B passed: today's approve moves the video to Approved`);
        ok(!d.overflow, `${tag}: no sideways scroll`);
        ok(!t.errors.length, `${tag}: no page errors (${t.errors.join(' | ')})`);
        await t.ctx.close();
      }
    }
    // A pass the server cannot take yet (before the migration): the version comes back and the client is told.
    if (part('pass')) {
      const t = await start('client', true, three());
      await t.ctx.route('**/functions/v1/trial-reels', async route => {
        const b = JSON.parse(route.request().postData() || '{}');
        if (b.action === 'answer' && b.kind === 'pass') return route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'pass_unavailable' }) });
        return route.fallback();
      });
      await press(t, '[data-pass="video"]');
      await sleep(1200);
      const d = await dec(t);
      const said = await t.page.evaluate(() => (document.getElementById('confirmOverlay') || {}).innerText || '');
      ok(/Video A/.test(d.bar) && d.pass && /Video A was not saved/.test(said) && !/passed on/.test(said), `client: a refused pass puts Video A back on screen and says so (${said.replace(/\s+/g, ' ').slice(0, 120)})`);
      await t.ctx.close();
    }

    // ---------- Kasper: "Client dropped" on the tile, and 5: the tiles draw with the card ----------
    for (const th of ['light', 'dark'].filter(() => part('kasper'))) {
      const tag = 'kasper 1440 ' + th;
      const vs = three(); vs[1].client_pass_at = '2026-10-28T09:00:00.000Z';
      // The trial read takes 1.2 s (live it is 0.5 to 0.9 s), and the card has no picture (a Frame.io thumbnail page).
      const t = await start('kasper', true, vs, { layout2: true, beforeOpen: async t2 => {
        t2.state.cards.forEach(c => { c.thumbnail_url = 'https://next.frame.io/share/00000000-0000-4000-8000-000000000009'; });
        await t2.ctx.route('**/functions/v1/trial-reels', async route => {
          const b = JSON.parse(route.request().postData() || '{}');
          if (b.action === 'list') await sleep(1200);
          return route.fallback();
        });
        // Every frame from the first draw: where the panes under the tiles sit.
        await t2.page.addInitScript(() => { window.__l2 = []; const step = () => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; const g = r && r.getElementById('l2g'); const k = r && r.getElementById('l2trv');
          if (g && g.querySelector('.pn')) window.__l2.push([Math.round(g.getBoundingClientRect().top), k ? (k.querySelector('.trk-skel') ? 'skel' : k.querySelector('.trk') ? 'tiles' : 'none') : 'none', k ? Math.round(k.getBoundingClientRect().height) : 0]);
          if (window.__l2.length < 2000) requestAnimationFrame(step); }; requestAnimationFrame(step); });
      } });
      await theme(t, th);
      await waitFor(async () => !!(await R(t, `return !!r.querySelector('#l2trv .trk:not(.trk-skel)');`)), 60);
      await sleep(300);
      const frames = await t.page.evaluate(() => window.__l2 || []);
      const kinds = [...new Set(frames.map(f => f[1]))];
      // Every frame from the first draw of the panes: where they sit, before and after the tiles land.
      const tops = frames.map(f => f[0]);
      ok(frames.length && frames[0][1] !== 'none', `${tag}: from the first frame the card is drawn with its tiles or their placeholders (${kinds.join(' then ')})`);
      ok(tops.length && Math.max(...tops) - Math.min(...tops) <= 2, `${tag}: and nothing under them moves when the tiles land (panes top ${Math.min(...tops)} to ${Math.max(...tops)}; ${[...new Set(frames.map(f => f[1] + ':' + f[2]))].join(' ')})`);
      const tiles = await R(t, `return [...r.querySelectorAll('#l2trv .trk-v')].map(v => ({ n: (v.querySelector('.trk-n') || {}).textContent, lab: ((v.querySelector('.trk-lab') || {}).textContent || '').trim(), drop: !!v.querySelector('[data-trk-drop]'), ok: !!v.querySelector('[data-trk-ok]'),
        pic: (() => { const p = v.querySelector('.trk-pic'); return p ? (p.querySelector('img') ? 'img' : p.querySelector('.trk-mark') ? 'mark' : 'empty') : 'none'; })() }));`);
      ok(tiles.length === 3 && tiles[1].lab === 'Client dropped' && tiles[1].drop && !tiles[1].ok, `${tag}: Video B's tile says "Client dropped", with Drop and no Approve (${JSON.stringify(tiles[1])})`);
      ok(tiles.every(x => x.pic === 'mark'), `${tag}: a card with no picture: each tile shows a video mark, never a black square (${tiles.map(x => x.pic).join(',')})`);
      await shot(t, 'r2-kasper-l2-' + th);
      ok(!t.errors.length, `${tag}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- Trialtest, round 2 live: the client's pass on Kasper's standard layout and the SMM's Review tab ----------
    // Kasper without his second layout (1280 wide, and a phone) and the SMM's Review tab: a version the client passed on
    // says so on its dot and in its place, offers no Approve, and Approve all leaves it out.
    for (const [mode, w, h, label] of [['kasper', 1280, 860, 'kasper standard 1280'], ['kasper', 390, 844, 'kasper 390'], ['smm', 1440, 900, 'SMM review 1440']].filter(() => part('staffpass'))) {
      const vs = three().map(v => Object.assign(v, mode === 'smm' ? { kasper_ok_at: null } : {}));
      if (mode === 'smm') vs.forEach(v => { v.smm_ok_at = null; });
      vs[1].client_pass_at = '2026-10-28T09:00:00.000Z'; vs[1].smm_ok_at = '2026-10-28T08:00:00.000Z';
      if (mode === 'kasper') vs[1].kasper_ok_at = null;
      const t = await start(mode, true, vs, Object.assign({ width: w, height: h }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      let d = await dec(t);
      const all0 = await R(t, `return ((r.querySelector('[data-trv-all]') || {}).textContent || '').trim();`);
      ok(/pass/.test(d.dots.split(',')[1] || '') && /Approve all \(2 waiting\)|^$/.test(all0) && !/\(3 waiting\)/.test(all0), `${label}: Video B's dot says the client passed, and Approve all counts only A and C (${d.dots} | ${all0})`);
      const aria = await R(t, `const b = r.querySelector('[data-trv-go="B"]'); return b ? b.getAttribute('aria-label') : '';`);
      ok(/client dropped/i.test(aria), `${label}: B's dot is read out as client dropped ("${aria}")`);
      await press(t, '[data-trv-go="B"]');
      await sleep(400);
      d = await dec(t);
      ok(/Client dropped Video B/.test(d.said) && !d.ok, `${label}: on Video B, "Client dropped" in place of Approve (${d.said} | ok "${d.ok}")`);
      await shot(t, 'r2-staffpass-' + label.replace(/\s+/g, '-'));
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- Trialtest, round 2 live: the client's own dot shows the change at once, with the box still open ----------
    if (part('clientchg')) {
      // Only the video is left to review on this card (the thumbnail and caption are approved), as on Trialtest's card,
      // so the page stays on the Video step after the change.
      const t = await start('client', true, three(), { beforeOpen: async t2 => { const c = t2.state.cards.find(x => x.id === 'rs1'); Object.assign(c, { graphic_status: 'Approved', caption_status: 'Approved' }); } });
      await press(t, '[data-trv-go="C"]');
      await sleep(300);
      await press(t, '[data-chg="video"]');
      await sleep(300);
      await inS(t.page, '#ta').fill('Fictional note: a shorter end card.');
      // The live answer takes a moment, and the box can keep the focus meanwhile (Trialtest's case).
      t.T.delay = 1500;
      await inS(t.page, '#ta').press('Enter');
      await t.page.evaluate(() => { const ta = document.getElementById('svReviewStage').shadowRoot.querySelector('#ta'); if (ta) ta.focus(); });
      await sleep(400);
      const early = await dec(t);
      ok(/chg/.test(early.dots.split(',')[2] || ''), `client: C's dot says change asked at once, before the server answers, with the box still focused (${early.dots})`);
      await waitFor(async () => t.T.versions[2].status === 'change asked', 40);
      await sleep(600);
      // (No press anywhere after the send: the bar must follow by itself.)
      const d = await dec(t);
      if (process.env.TRL_DEBUG) console.log('DEBUG', JSON.stringify(d), await R(t, `return [!!r.querySelector('.trv-under'), (r.activeElement || {}).id, !!r.querySelector('#ta'), [...r.querySelectorAll('.stp')].map(n => n.className + ':' + n.textContent.trim()).join('|'), ((r.querySelector('.trv-under-host') || {}).innerHTML || '').slice(0, 300)];`));
      ok(t.T.versions[2].status === 'change asked' && /chg/.test(d.dots.split(',')[2] || ''), `client: after a change on Video C, C's own dot says change asked at once (${d.dots})`);
      ok(!t.errors.length, `client change: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- Allactions (567b, 567c): a double click on Approve answers one version; the client never sees a code ----------
    for (const [mode, w, h, label] of [['client', 1440, 900, 'client 1440'], ['client', 390, 844, 'client 390'], ['kasper', 1280, 860, 'kasper standard'], ['smm', 1440, 900, 'SMM review']].filter(() => part('dblclick'))) {
      const vs = three().map(v => Object.assign(v, mode === 'kasper' ? { kasper_ok_at: null } : mode === 'smm' ? { kasper_ok_at: null, smm_ok_at: null } : {}));
      const t = await start(mode, true, vs, Object.assign({ width: w, height: h }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      t.T.delay = 400;
      // Two presses as fast as a double click: the first moves the page to B at once, the second must not answer B.
      await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const b = r.querySelector('[data-ok="video"]'); b.click(); setTimeout(() => { const b2 = r.querySelector('[data-ok="video"]'); if (b2) b2.click(); }, 60); });
      await sleep(2500);
      const answered = t.T.calls.filter(c => c.action === 'answer').map(c => c.letter || c.kind).join(',');
      ok(answered === 'A', `${label}: a double click on Approve Video A answers A only (${answered})`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    if (part('dblclick')) {
      // Kasper's tiles: each tile's own Approve names its version, so A then B pressed quickly answers both.
      const vs = three().map(v => Object.assign(v, { kasper_ok_at: null }));
      const t = await start('kasper', true, vs, { layout2: true });
      await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; r.querySelector('[data-trk-ok="A"]').click(); setTimeout(() => { const b = r.querySelector('[data-trk-ok="B"]'); if (b) b.click(); }, 120); });
      await sleep(2500);
      const answered = t.T.calls.filter(c => c.action === 'answer').map(c => c.letter || c.kind).join(',');
      ok(answered === 'A,B', `kasper tiles: A's Approve then B's, pressed quickly, answer both (${answered})`);
      await t.ctx.close();
    }
    if (part('dblclick')) {
      // A refused approve on the client link: plain words, never the server's code.
      const t = await start('client', true, three());
      await t.ctx.route('**/functions/v1/trial-reels', async route => {
        const b = JSON.parse(route.request().postData() || '{}');
        if (b.action === 'answer') return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'request_failed' }) });
        return route.fallback();
      });
      await press(t, '[data-ok="video"]');
      await sleep(1500);
      const said = await t.page.evaluate(() => ((document.getElementById('confirmOverlay') || {}).innerText || '').replace(/\s+/g, ' '));
      ok(/not approved/.test(said) && !/answered|request_failed|write_failed|"/.test(said), `client: a refused approve says it in plain words, no server code ("${said.slice(0, 140)}")`);
      await t.ctx.close();
    }
    if (part('dblclick')) {
      // A refused "Not this one" (offline): its title says the answer did not save, never "was not passed on" (Trialtest nit 4).
      const t = await start('client', true, three());
      t.T.failAnswer = 1;
      await press(t, '[data-pass="video"]');
      await sleep(1500);
      const said = await t.page.evaluate(() => ((document.getElementById('confirmOverlay') || {}).innerText || '').replace(/\s+/g, ' '));
      ok(/Video A was not saved/.test(said) && !/passed on/.test(said), `client: a refused "Not this one" reads "Video A was not saved" ("${said.slice(0, 120)}")`);
      await t.ctx.close();
    }

    // ---------- Follow-up: a version only the client approved says so to the team, and the team's Approve works ----------
    // A card sent straight to Client Approval: nobody on the team has answered, the client approved Video A.
    const clientOnly = () => three().map(v => Object.assign(v, { kasper_ok_at: null, smm_ok_at: null }, v.letter === 'A' ? { status: 'approved', client_ok_at: '2026-10-28T10:00:00.000Z' } : {}));
    for (const [mode, w, h, label] of [['kasper', 1280, 860, 'kasper standard'], ['smm', 1440, 900, 'SMM review'], ['smm', 390, 844, 'SMM review 390']].filter(() => part('cok'))) {
      for (const th of ['light', 'dark']) {
        // Kasper's page: C has the SMM's OK, so the card was not sent on whole and A and B are still with the SMM (the
        // function now reads the card's status, as the live one does; with no SMM OK at all Kasper answers every version).
        const t = await start(mode, true, clientOnly(), Object.assign({ width: w, height: h, noSmm: mode === 'kasper' ? ['A', 'B'] : ['A', 'B', 'C'] }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
        await theme(t, th);
        // Kasper's page opens on C, the one version waiting for him: step to A.
        if (mode === 'kasper') { await press(t, '[data-trv-go="A"]'); await sleep(600); }
        const d = await dec(t);
        const mark = await R(t, `const n = r.querySelector('.trv-under .trv-cok'); if (!n || !n.offsetParent) return null; const s = getComputedStyle(n); return { t: n.textContent.trim(), bg: s.backgroundColor, fg: s.color, title: n.title };`);
        const aria = await R(t, `const b = r.querySelector('[data-trv-go="A"]'); return b ? b.getAttribute('aria-label') : '';`);
        ok(mark && mark.t === 'Client approved' && /Video A/.test(mark.title), `${label} ${th}: Video A, approved by the client only, says "Client approved" (${JSON.stringify(mark)})`);
        ok(/client approved/.test(aria), `${label} ${th}: A's dot names the client's OK ("${aria}")`);
        // The SMM answers first, so the SMM's Approve is there; Kasper's page says the SMM looks at it first (stage order).
        ok(mode === 'smm' ? /^Approve/.test(d.ok) && !d.overflow : /With the team/.test(d.said) && !d.overflow, `${label} ${th}: the team's own answer stays as before ("${d.ok}" | "${d.said}", overflow ${d.overflow})`);
        await shot(t, 'cok-' + label.replace(/\s+/g, '-') + '-' + th);
        if (th === 'light' && mode === 'smm') {
          await press(t, '[data-ok="video"]');
          await waitFor(async () => t.T.calls.some(c => c.action === 'answer'), 40);
          const a = t.T.calls.find(c => c.action === 'answer') || {};
          ok(a.letter === 'A' && a.kind === 'approve' && a.stage === 'smm', `${label}: the SMM's Approve answers Video A for the SMM (${JSON.stringify(a)})`);
          // B, which nobody has answered, has no such mark.
          await sleep(900);
          await press(t, '[data-trv-go="B"]');
          await sleep(400);
          ok(!(await R(t, `return !!r.querySelector('.trv-under .trv-cok');`)), `${label}: Video B, not approved by the client, has no "Client approved" mark`);
        }
        ok(!t.errors.length, `${label} ${th}: no page errors (${t.errors.join(' | ')})`);
        await t.ctx.close();
      }
    }
    if (part('cok')) {
      // One live version left (the team dropped the others): the tag still shows (Codex on #2418).
      const vs = clientOnly().map(v => v.letter === 'A' ? v : Object.assign(v, { status: 'dropped' }));
      const t = await start('smm', true, vs, { noSmm: ['A', 'B', 'C'] });
      const mark = await R(t, `const n = r.querySelector('.trv-under .trv-cok'); return n && n.offsetParent ? n.textContent.trim() : '';`);
      const d = await dec(t);
      ok(mark === 'Client approved' && /^Approve/.test(d.ok), `SMM review, one version left: "Client approved" shows and the SMM's Approve stays ("${mark}" | "${d.ok}")`);
      await t.ctx.close();
    }
    if (part('cok')) {
      // Kasper's second layout: A's tile says it too, and keeps its Approve.
      const t = await start('kasper', true, clientOnly(), { layout2: true, noSmm: ['A', 'B'] });
      const tile = await R(t, `const v = [...r.querySelectorAll('.trk-v')].find(n => /Video A/.test(n.innerText)); const b = [...r.querySelectorAll('.trk-v')].find(n => /Video B/.test(n.innerText));
        return { a: v ? v.innerText.replace(/\s+/g, ' ') : '', b: b ? !!b.querySelector('.trv-cok') : true, wide: [...r.querySelectorAll('.trk-v, .trk-go')].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.className + ':' + n.scrollWidth + '>' + n.clientWidth).join(' ') };`);
      ok(/Client approved/.test(tile.a) && !tile.b && !tile.wide, `kasper tiles: A's tile says "Client approved", B's does not, nothing spills (${JSON.stringify(tile)})`);
      // A version the SMM has not looked at is "with the team" on its tile, never "change asked".
      ok(/with the team/.test(tile.a) && !/change asked/.test(tile.a), `kasper tiles: a version still with the SMM says "with the team", not "change asked" ("${tile.a}")`);
      await shot(t, 'cok-kasper-tiles');
      await t.ctx.close();
    }

    // ---------- The owner's choice (a), 2026-10-29 (OPEN_REPAIRS 587): a change on one version keeps the card ----------
    // where it is while other versions still wait for this reviewer; the editor gets the note at once; the card goes to
    // Tweaks Needed only when nothing else waits. Trialtest's bug 1 (the client, a card sent straight to the client),
    // Trialeyes' E1 (the SMM approves A, asks a change on B) and E14 (the same on the client side), and Kasper.
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
    const tweaked = t => t.state.upserts.some(u => u.video_status === 'Tweaks Needed') || (t.gw || []).some(g => g.op === 'status' && g.status === 'tweak');
    const askChange = async (t, note) => {
      await press(t, '[data-chg="video"]');
      await sleep(300);
      await inS(t.page, '#ta').fill(note);
      await inS(t.page, '#sendBtn').click();
    };
    for (const [mode, w, h, label, prep] of [
      ['client', 390, 844, 'client 390 (bug 1)', vs => vs.map(v => Object.assign(v, { kasper_ok_at: null, smm_ok_at: null }))],
      ['client', 1440, 900, 'client 1440 (E14)', vs => vs],
      ['smm', 1440, 900, 'SMM review (E1)', vs => vs.map(v => Object.assign(v, { kasper_ok_at: null, smm_ok_at: null }))],
      ['kasper', 1280, 860, 'kasper standard', vs => vs.map(v => Object.assign(v, { kasper_ok_at: null }))],
    ].filter(() => part('keepcard'))) {
      const vs = prep(three());
      const t = await start(mode, true, vs, Object.assign({ width: w, height: h, beforeOpen: keepGateway }, mode === 'client' && label.includes('bug 1') ? { noSmm: ['A', 'B', 'C'] } : {}, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      const stage = mode === 'client' ? 'client' : mode;
      await askChange(t, 'Fictional note: a shorter start on A.');
      await waitFor(async () => t.T.versions[0].status === 'change asked', 50);
      await sleep(2500);
      const said = (t.gw || []).filter(g => g.op === 'comment').map(g => g.body).join('|') + '|' + t.state.upserts.map(u => String(u.video_tweaks || '')).join('|');
      ok(t.T.versions[0].status === 'change asked' && /Video A: Fictional note: a shorter start on A\./.test(said), `${label}: A's change is recorded and its note goes to the editor ("Video A: ...")`);
      ok(!tweaked(t), `${label}: while B and C still wait for this reviewer, the card stays where it is (no Tweaks Needed)`);
      // Back to the Video step and on to B if the page moved elsewhere.
      if (await R(t, `const b = r.querySelector('.stp[data-step="video"]'); return !!b && b.getAttribute('aria-current') !== 'step';`)) { await press(t, '.stp[data-step="video"]'); await sleep(500); }
      if (!/Video B of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="B"]'); await sleep(600); }
      let d = await dec(t);
      ok(/Video B of 3/.test(d.bar) && /^Approve/.test(d.ok), `${label}: B is on screen with its own Approve ("${d.bar}" | "${d.ok}")`);
      await press(t, '[data-ok="video"]');
      await waitFor(async () => t.T.versions[1][stage === 'client' ? 'client_ok_at' : stage + '_ok_at'], 40);
      await sleep(900);
      ok(!tweaked(t), `${label}: after B, C still waits: the card still stays`);
      if (!/Video C of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="C"]'); await sleep(600); }
      await press(t, '[data-ok="video"]');
      if (mode === 'client') {
        await waitFor(async () => tweaked(t), 60);
        ok(tweaked(t) && !t.state.upserts.some(u => u.video_status === 'Approved'),
          `${label}: with B and C answered and A's change open, the card goes to Tweaks Needed, never on to Approved`);
      } else {
        // Per-version routing (Sidney, 2026-10-29): B and C go on to the next reviewer now; A waits for its new cut alone.
        const next = mode === 'smm' ? ['Kasper Approval', 'kasper_approval'] : ['Client Approval', 'client_approval'];
        const moved = () => t.state.upserts.some(u => u.video_status === next[0]) || (t.gw || []).some(g => g.op === 'status' && g.status === next[1]);
        await waitFor(async () => moved(), 60);
        ok(moved() && !tweaked(t), `${label}: with B and C answered and A's change open, B and C take the card on to ${next[0]}, never Tweaks Needed`);
      }
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // Trialtest (2026-10-29, after #2434): once a change is sent, the box closes with "Change sent for Video C", and the
    // next version shows its own Approve and "Not this one", never the sent change's box (whose Cancel read like taking
    // the change back).
    for (const [w, h, label, go] of [[1440, 900, 'client 1440', 'arrow'], [390, 844, 'client 390', 'dot']].filter(() => part('keepcard'))) {
      // The live client link runs the polished page (review_client_polish), whose change box stays open for the next change.
      const t = await start('client', true, three(), Object.assign({ width: w, height: h, beforeOpen: keepGateway, flagValues: { trial_reels_pages: { clients: [SLUG] }, review_client_polish: { all: true } } }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      if (!/Video C of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="C"]'); await sleep(600); }
      await askChange(t, 'Fictional note: a warmer colour on C.');
      await waitFor(async () => t.T.versions[2].status === 'change asked', 50);
      await sleep(800);
      const sentNote = () => R(t, `const n = r.querySelector('.trv-sent'); return n ? n.textContent.trim() : '';`);
      ok(!(await R(t, `return !!r.querySelector('#drow textarea');`)) && /Change sent for Video C/.test(await sentNote()), `${label}: once sent, the box closes and says "Change sent for Video C" ("${await sentNote()}")`);
      await press(t, go === 'dot' ? '[data-trv-go="A"]' : '[data-trv-step="-1"]');
      await sleep(700);
      if (go === 'arrow') { await press(t, '[data-trv-step="-1"]'); await sleep(700); }
      const d = await dec(t);
      const box = await R(t, `return !!r.querySelector('#drow textarea');`);
      ok(/Video A of 3/.test(d.bar) && /^Approve/.test(d.ok) && !box, `${label} (${go}): after C's change is sent, A shows its own Approve, not the change box ("${d.bar}" | "${d.ok}" | box ${box})`);
      ok(await R(t, `return !!r.querySelector('[data-pass="video"]');`) && /Change sent for Video C/.test(await sentNote()), `${label} (${go}): A offers "Not this one" too, and the "Change sent for Video C" note stays`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    // A refused change never says "Change sent" (Codex on #2444): the note goes, and the words come back into the box.
    if (part('keepcard')) {
      const t = await start('client', true, three(), { width: 1440, height: 900, beforeOpen: keepGateway, flagValues: { trial_reels_pages: { clients: [SLUG] }, review_client_polish: { all: true } } });
      if (!/Video C of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="C"]'); await sleep(600); }
      t.state.writeFail = 50;   // the card's save is refused
      await askChange(t, 'Fictional note: a warmer colour on C.');
      // The refused change keeps its own Try again and its words (the save path's "Your unsent words").
      const retry = () => R(t, `return !!r.querySelector('[data-retry="video"]');`);
      await waitFor(retry, 80);
      await sleep(400);
      const n = await R(t, `const n = r.querySelector('.trv-sent'); return n ? n.textContent.trim() : '';`);
      const row = await R(t, `const d = r.querySelector('#drow'); return d ? d.innerText.replace(/\\s+/g, ' ').trim() : '';`);
      ok(!/Change sent/.test(n) && await retry(), `refused: no "Change sent" ("${n}"), and the change offers Try again ("${row.slice(0, 160)}")`);
      await t.ctx.close();
    }
    // Trialtest, live on #2444: the version's own "change asked" write refused once was never tried again while the
    // page stayed open (the retry waited for a versions read that never came). It is tried again on its own now.
    for (const [w, h, label] of [[1440, 900, 'client 1440'], [390, 844, 'client 390']].filter(() => part('retry'))) {
      const t = await start('client', true, three(), Object.assign({ width: w, height: h, beforeOpen: keepGateway, flagValues: { trial_reels_pages: { clients: [SLUG] }, review_client_polish: { all: true } } }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      if (!/Video B of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="B"]'); await sleep(600); }
      t.T.failChange = 1;
      await askChange(t, 'Fictional note: a calmer start on B.');
      const t0 = Date.now();
      await waitFor(async () => t.T.versions[1].status === 'change asked', 150);
      const tries = t.T.calls.filter(c => c.action === 'answer' && c.kind === 'change' && c.letter === 'B').length;
      ok(t.T.versions[1].status === 'change asked' && tries >= 2, `${label}: a refused version mark is tried again on its own: B is "change asked" on the server after ${Math.round((Date.now() - t0) / 1000)} s (${tries} tries)`);
      const said = await t.page.evaluate(() => (document.getElementById('confirmMsg') || {}).textContent || '');
      ok(/Your words are kept/.test(said) && !/was sent/.test(said), `${label}: the notice never claims the change was sent ("${said}")`);
      await t.page.evaluate(() => { const b = document.getElementById('confirmYes'); if (b) b.click(); });
      // Offline: the notice says it goes once the connection is back, and it goes the moment it is.
      if (w > 600) {
        if (!/Video C of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="C"]'); await sleep(600); }
        // The fixture's routes still answer offline, so the version write is refused once by hand, as offline it would be.
        await t.ctx.setOffline(true);
        t.T.failChange = 1;
        await askChange(t, 'Fictional note: a warmer end on C.');
        await waitFor(async () => /connection is back/.test(await t.page.evaluate(() => (document.getElementById('confirmMsg') || {}).textContent || '')), 60);
        const off = await t.page.evaluate(() => (document.getElementById('confirmMsg') || {}).textContent || '');
        ok(/once your connection is back/.test(off), `${label} offline: the notice says the mark goes once the connection is back ("${off}")`);
        await t.ctx.setOffline(false);
        const t1 = Date.now();
        await waitFor(async () => t.T.versions[2].status === 'change asked', 60);
        const back = Date.now() - t1;
        ok(t.T.versions[2].status === 'change asked' && back < 2500, `${label}: back online, C is marked as changed at once, not on its next timer (${Math.round(back / 100) / 10} s)`);
      }
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- Trialeyes E1 (2026-10-29): after a change on one version, another version never shows that change ----------
    // The SMM approves A, then asks for a change on B: C still waits, so the card stays (OPEN_REPAIRS 587) and C, which
    // nobody has looked at, keeps its own Approve, never B's "Change asked" quote; A says it is approved; B says its own
    // "Change asked" and note, never Approve again.
    for (const [w, h, label] of [[1440, 900, 'SMM review'], [390, 844, 'SMM review 390']].filter(() => part('e1'))) {
      const vs = three().map(v => Object.assign(v, { kasper_ok_at: null, smm_ok_at: null }));
      // The SMM's saves go through Production's gateway: it commits them, as live (the fixture's own answer is for phones).
      const native = { status: 'For SMM Approval', at: '2026-10-27T09:00:00.000Z' };
      const gateway = async t2 => { await t2.ctx.route('**/rest/v1/deliverables?*', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json',
        body: JSON.stringify([{ id: 'del_rs1', status: native.status, status_at: native.at, updated_at: native.at }]) })); return t2.ctx.route('**/functions/v1/production-write', route => {
        let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        if (b.operation === 'attachment') return route.fallback();
        const at = new Date().toISOString();
        if (b.operation === 'status' && b.status) Object.assign(native, { status: b.status, at });
        return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(Object.assign({ ok: true, native_committed: true, complete: true, row: { id: b.id || 'del_rs1', status: b.status, updated_at: at } },
          b.operation === 'comment' && b.comment ? { comment: Object.assign({}, b.comment, { id: b.comment.native_comment_id, created_at: at, updated_at: at, source_created_at: at, source_updated_at: at }) } : {})) });
      }); };
      const t = await start('smm', true, vs, Object.assign({ width: w, height: h, beforeOpen: gateway }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      await press(t, '[data-ok="video"]');
      await waitFor(async () => t.T.versions[0].smm_ok_at && /Video B/.test((await dec(t)).bar), 50);
      await sleep(900);
      const n0 = t.state.upserts.length;
      await press(t, '[data-chg="video"]');
      await sleep(300);
      await inS(t.page, '#ta').fill('Fictional note: cut the first second.');
      await inS(t.page, '#sendBtn').click();
      await waitFor(async () => t.T.versions[1].status === 'change asked', 80);
      await sleep(900);
      ok(t.T.versions[1].status === 'change asked' && !!t.T.versions[0].smm_ok_at && t.T.versions[2].status === 'waiting' && !t.T.versions[2].smm_ok_at, `${label}: the server has A approved by the SMM, B's change, C untouched`);
      // The page moves on to the Thumbnail after the video's answer, as today: go back to the Video step.
      await sleep(600);
      await press(t, '.stp[data-step="video"]');
      await sleep(600);
      await press(t, '[data-trv-go="C"]');
      await sleep(700);
      let d = await dec(t);
      ok(/Video C of 3/.test(d.bar) && !/cut the first second/.test(d.said + d.bar) && !/Change asked/.test(d.said), `${label}: Video C never shows B's change ("${d.said}")`);
      // C still waits for the SMM, so the card stays where it is and C keeps its own Approve (the owner's choice (a),
      // OPEN_REPAIRS 587; before it, C said it waited for B's change).
      ok(/^Approve/.test(d.ok) && !t.state.upserts.slice(n0).some(u => u.video_status === 'Tweaks Needed'), `${label}: Video C keeps its own Approve while B's change is open, and the card stays ("${d.ok}")`);
      await shot(t, 'e1-C-' + label.replace(/\s+/g, '-'));
      await press(t, '[data-trv-go="A"]');
      await sleep(700);
      d = await dec(t);
      ok(/Video A approved/.test(d.said) && !/cut the first second/.test(d.said), `${label}: Video A says it is approved ("${d.said}")`);
      await press(t, '[data-trv-go="B"]');
      await sleep(700);
      d = await dec(t);
      ok(/Change asked/.test(d.said) && /cut the first second/.test(d.said + (await R(t, `return [...r.querySelectorAll('.dq')].map(n => n.textContent).join('|');`))), `${label}: Video B keeps its own "Change asked" and note ("${d.said}")`);
      await shot(t, 'e1-' + label.replace(/\s+/g, '-'));
      ok(!t.errors.length && !d.overflow, `${label}: no page errors, no sideways scroll (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- Trialeyes E10 (2026-10-29): "Not this one" on the last open version keeps saying so on its own screen ----------
    // A and C approved by the client; B is the last one waiting; "Not this one" on B lets the card move to Approved.
    // B's screen keeps "the team will take Video B out" (never the card's "Approved · Change my mind") and its dot a cross.
    for (const [w, h, label] of [[390, 844, 'client 390'], [1440, 900, 'client 1440']].filter(() => part('e10'))) {
      const at = '2026-10-29T01:00:00.000Z';
      const vs = three().map(v => v.letter === 'B' ? v : Object.assign(v, { status: 'approved', client_ok_at: at }));
      const t = await start('client', true, vs, Object.assign({ width: w, height: h }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      await press(t, '[data-trv-go="B"]');
      await sleep(500);
      await press(t, '[data-pass="video"]');
      await waitFor(async () => !!t.T.versions[1].client_pass_at, 40);
      await waitFor(async () => t.state.upserts.some(u => u.video_status === 'Approved'), 60);
      await sleep(3500);
      // The page may have moved on to the Thumbnail (the video is done): back to the Video step, on B.
      if (await R(t, `const b = r.querySelector('.stp[data-step="video"]'); return !!b && b.getAttribute('aria-current') !== 'step';`)) { await press(t, '.stp[data-step="video"]'); await sleep(600); }
      if (!/Video B of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="B"]'); await sleep(600); }
      const d = await dec(t);
      const card = t.state.upserts.some(u => u.video_status === 'Approved');
      const cross = await R(t, `const i = r.querySelector('[data-trv-go="B"] i'); return i ? getComputedStyle(i, '::after').content : '';`);
      ok(card, `${label}: the card moved to Approved (the other versions carried it)`);
      ok(/Video B of 3/.test(d.bar) && /the team will take Video B out/.test(d.said) && !/Approved|Change my mind/.test(d.said), `${label}: B's screen keeps its own "Not this one", never the card's "Approved" ("${d.said}")`);
      ok(/pass/.test(d.dots.split(',')[1] || '') && /×/.test(cross), `${label}: B's dot shows the drop with a cross (${d.dots} | ${cross})`);
      await shot(t, 'e10-' + label.replace(/\s+/g, '-'));
      ok(!t.errors.length && !d.overflow, `${label}: no page errors, no sideways scroll (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- Trialtest minor 3 (2026-10-29): a second client tab hears trial-reels' broadcast ----------
    // Another tab answers Video B; this tab, open on the card, shows it at once (not on its 30 s refresh) and reads
    // only when the hash is this client's card.
    if (part('push')) {
      const REC = `if (!window.__rtChannels) window.__rtChannels = [];
        if (!window.supabase) window.supabase = { createClient: function () { return {
          channel: function (name) { var ch = { name: name, _cbs: [], on: function (t, f, cb) { ch._cbs.push({ f: f, cb: cb }); return ch; },
            subscribe: function () { window.__rtChannels.push(ch); return ch; }, unsubscribe: function () {} }; return ch; },
          removeChannel: function () { return Promise.resolve(); } }; } };`;
      const t = await start('client', true, three(), { beforeOpen: async t2 => t2.ctx.route(u => /supabase-js/.test(u.href), route => route.fulfill({ status: 200, contentType: 'application/javascript', headers: CORS, body: REC })) });
      const joined = await waitFor(async () => t.page.evaluate(() => (window.__rtChannels || []).some(c => c.name === 'trial-reels')), 50);
      ok(joined, 'second tab: the client page listens on the one trial-reels channel');
      const fire = hh => t.page.evaluate(x => (window.__rtChannels || []).filter(c => c.name === 'trial-reels').forEach(c => c._cbs.forEach(k => { try { k.cb({ event: 'changed', payload: { h: x } }); } catch (e) {} })), hh);
      let n0 = t.T.calls.filter(c => c.action === 'list').length;
      await fire('0123456789ab');
      await sleep(600);
      ok(t.T.calls.filter(c => c.action === 'list').length === n0, 'second tab: another card\'s change reads nothing');
      // The other tab approved Video B.
      Object.assign(t.T.versions[1], { status: 'approved', client_ok_at: new Date().toISOString() });
      const h = require('crypto').createHash('sha256').update('rs1').digest('hex').slice(0, 12);
      const t0 = Date.now();
      await fire(h);
      const seen = await waitFor(async () => /ok/.test((await dec(t)).dots.split(',')[1] || ''), 30);
      ok(seen && Date.now() - t0 < 2000 && t.T.calls.filter(c => c.action === 'list').length > n0, `second tab: the other tab's approve on B shows here in ${Date.now() - t0} ms (dots ${(await dec(t)).dots})`);
      ok(!t.errors.length, 'second tab: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- Trialeyes E11 and E12 (2026-10-29): the client is told why there are versions; the bottom buttons stay one line ----------
    for (const [mode, w, h, label] of [['client', 390, 844, 'client 390'], ['client', 1440, 900, 'client 1440'], ['smm', 1440, 900, 'SMM review'], ['kasper', 390, 844, 'kasper 390 (E21)']].filter(() => part('e11'))) {
      for (const th of mode === 'client' && w < 600 ? ['light', 'dark'] : ['light']) {
        const t = await start(mode, true, three().map(v => Object.assign(v, mode === 'smm' || mode === 'kasper' ? { kasper_ok_at: null } : {})), Object.assign({ width: w, height: h }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
        await theme(t, th);
        const why = await R(t, `const n = r.querySelector('.trv-why'); return n && n.offsetParent ? n.textContent.trim() : '';`);
        if (mode === 'client') ok(why === "We'll test each version for 24 h and keep the best one.", `${label} ${th}: one plain line says why there are several versions ("${why}")`);
        else ok(!why, `${label}: the team's page has no such line`);
        const btns = await R(t, `return [...r.querySelectorAll('.dfin button')].filter(b => b.offsetParent).map(b => { const c = b.getBoundingClientRect(); return { t: b.textContent.replace(/\\s+/g, ' ').trim(), h: Math.round(c.height), fits: b.scrollWidth <= b.clientWidth + 1 }; });`);
        ok(btns.length >= 2 && btns.every(b => b.h <= 46 && b.fits), `${label} ${th}: "Approve all" and "Finish reviewing" each on one line (${JSON.stringify(btns)})`);
        await R(t, `const n = r.querySelector('.trv-why') || r.querySelector('.trv-under'); if (n) n.scrollIntoView({ block: 'start' }); return 1;`);
        await sleep(200);
        await shot(t, 'e11-' + label.replace(/\s+/g, '-') + '-' + th);
        ok(!t.errors.length && !(await dec(t)).overflow, `${label} ${th}: no page errors, no sideways scroll`);
        await t.ctx.close();
      }
    }

    // ---------- Trialeyes E20 (2026-10-29): leaving the client link with unsent words in the change box asks first ----------
    if (part('e11')) {
      const t = await start('client', true, three(), { width: 390, height: 844, context: { hasTouch: true, isMobile: true } });
      const held = () => t.page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
      ok(!(await held()), 'client: with nothing typed, leaving asks nothing');
      await press(t, '[data-chg="video"]');
      await sleep(300);
      await inS(t.page, '#ta').fill('Fictional words not sent yet');
      await sleep(200);
      ok(await held(), 'client: with words typed in the change box, leaving asks first');
      await inS(t.page, '#ta').fill('');
      await sleep(200);
      ok(!(await held()), 'client: once the box is empty again, leaving asks nothing');
      await t.ctx.close();
    }

    // ---------- Per-version routing (Sidney, 2026-10-29: "Other videos should go to Kasper while one of them is out for a
    // change"). The SMM approves A and C and asks a change on B: A and C go to Kasper now. B's new cut comes back to the
    // SMM while the card is at Kasper: the SMM's Review tab lists the card for B alone, and the SMM's approve sends B to
    // Kasper without moving the card back. ----------
    const routeMoved = (t, word, code) => t.state.upserts.some(u => u.video_status === word) || (t.gw || []).some(g => g.op === 'status' && g.status === code);
    const reopenSmm = async t => {
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('smmreview'));
      await waitNew(t);
      await sleep(1500);
    };
    for (const [w, h, label] of [[1440, 900, 'route 1440'], [390, 844, 'route 390']].filter(() => part('route'))) {
      const vs = three().map(v => Object.assign(v, { kasper_ok_at: null, smm_ok_at: null }));
      const t = await start('smm', true, vs, Object.assign({ width: w, height: h, beforeOpen: keepGateway }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      // 1440: A approve, B a change, C approve (the approve moves the card). 390: A and C approve, B's change last (the
      // change moves the card).
      const toVideo = async l => {
        if (await R(t, `const b = r.querySelector('.stp[data-step="video"]'); return !!b && b.getAttribute('aria-current') !== 'step';`)) { await press(t, '.stp[data-step="video"]'); await sleep(500); }
        if (!new RegExp('Video ' + l + ' of 3').test((await dec(t)).bar)) { await press(t, '[data-trv-go="' + l + '"]'); await sleep(600); }
      };
      const approve = async (l, i) => { await toVideo(l); await press(t, '[data-ok="video"]'); await waitFor(async () => !!t.T.versions[i].smm_ok_at, 50); await sleep(900); };
      const change = async () => { await toVideo('B'); await askChange(t, 'Fictional note: a calmer start on B.'); await waitFor(async () => t.T.versions[1].status === 'change asked', 60); await sleep(900); };
      if (w > 600) { await approve('A', 0); await change(); await approve('C', 2); }
      else { await approve('A', 0); await approve('C', 2); await change(); }
      await waitFor(async () => routeMoved(t, 'Kasper Approval', 'kasper_approval'), 80);
      await sleep(1500);
      ok(routeMoved(t, 'Kasper Approval', 'kasper_approval') && !routeMoved(t, 'Tweaks Needed', 'tweak'),
        `${label}: A and C approved, B changed: the card goes on to Kasper Approval now, never to Tweaks Needed`);
      // B's change request stays open for the editor: forwarding A and C never marks it done (Codex on PR 2452).
      const bNote = await t.page.evaluate(() => { const p = (calState.posts || []).find(x => x.id === 'rs1'); let l = []; try { l = typeof _calCommentsFor === 'function' ? _calCommentsFor(p, 'video') : JSON.parse(p.video_tweaks || '[]'); } catch (e) {} return (l || []).filter(c => /Video B: Fictional note/.test(String(c.body || c.text || ''))).map(c => ({ done: !!c.done })); });
      const resolved = (t.gw || []).filter(g => !['status', 'comment'].includes(g.op)).map(g => g.op);
      ok(bNote.length >= 1 && bNote.every(c => !c.done) && !t.state.upserts.some(u => /Video B: Fictional note[^\]]*"done":true/.test(String(u.video_tweaks || ''))),
        `${label}: B's change request stays open while A and C go on (${JSON.stringify(bNote)} | other writes: ${resolved.join(',') || 'none'})`);
      // B's new cut is in (its OKs cleared, as the function's "New cut ready" does), while the card is at Kasper Approval.
      const card = t.state.cards.find(c => c.id === 'rs1');
      card.video_status = 'Kasper Approval'; card.status = 'Kasper Approval';
      if (t.T_native) Object.assign(t.T_native, { status: 'kasper_approval', at: new Date().toISOString() });
      Object.assign(t.T.versions[1], { status: 'waiting', smm_ok_at: null, kasper_ok_at: null, change_by: null, change_note: null, change_at: null, revision: 1 });
      const u0 = t.state.upserts.length, g0 = (t.gw || []).length;
      await reopenSmm(t);
      // The page may open on the Thumbnail (it still waits for the SMM too): to the Video step, on B.
      await waitFor(async () => !!(await R(t, `return !!r.querySelector('.stp[data-step="video"]');`)), 40);
      await toVideo('B');
      const d = await dec(t);
      ok(/Video B of 3/.test(d.bar) && /^Approve/.test(d.ok), `${label}: the card is at Kasper Approval, and the SMM's Review tab lists it for B's new cut, on B with its Approve ("${d.bar}" | "${d.ok}")`);
      await press(t, '[data-trv-go="A"]'); await sleep(600);
      const dA = await dec(t);
      ok(!/^Approve/.test(dA.ok || '') || /approved/i.test(dA.said), `${label}: A, already with Kasper, takes no Approve from the SMM ("${dA.said}" | "${dA.ok}")`);
      await toVideo('B');
      await press(t, '[data-ok="video"]');
      await waitFor(async () => !!t.T.versions[1].smm_ok_at, 60);
      await sleep(2500);
      const after = t.state.upserts.slice(u0).map(u => u.video_status).filter(Boolean).concat((t.gw || []).slice(g0).filter(g => g.op === 'status').map(g => g.status));
      ok(!!t.T.versions[1].smm_ok_at && !after.some(x => /For SMM|smm_approval|Tweaks|tweak/.test(x)),
        `${label}: the SMM's approve sends B to Kasper, and the card never moves back (status writes: ${after.join(',') || 'none'})`);
      // B's new cut answered its change request: the SMM's approve marks it done, though nothing forwarded the card.
      await waitFor(async () => (await t.page.evaluate(() => { const p = (calState.posts || []).find(x => x.id === 'rs1'); return (_calCommentsFor(p, 'video') || []).some(c => /Video B: Fictional note/.test(String(c.body || '')) && c.done); })), 40);
      const bAfter = await t.page.evaluate(() => { const p = (calState.posts || []).find(x => x.id === 'rs1'); return (_calCommentsFor(p, 'video') || []).filter(c => /Video B: Fictional note/.test(String(c.body || ''))).map(c => !!c.done); });
      ok(bAfter.length >= 1 && bAfter.every(Boolean), `${label}: B's change request is marked done once its new cut passes the SMM (${JSON.stringify(bAfter)})`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // Kasper: a card already with the client (A and C through him) still reaches him while B, through the SMM, waits for
    // him; his approve on B sends B to the client and never moves the card.
    for (const [w, h, label] of [[1280, 860, 'route kasper 1280'], [390, 844, 'route kasper 390']].filter(() => part('routek'))) {
      const vs = three().map((v, i) => Object.assign(v, { smm_ok_at: '2026-10-29T08:00:00.000Z', kasper_ok_at: i === 1 ? null : '2026-10-29T08:30:00.000Z' }));
      const t = await start('kasper', true, vs, Object.assign({ width: w, height: h, beforeOpen: async t2 => {
        await keepGateway(t2);
        const card = t2.state.cards.find(c => c.id === 'rs1');
        Object.assign(card, { video_status: 'Client Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Client Approval' });
        if (t2.T_native) Object.assign(t2.T_native, { status: 'client_approval' });
      } }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      await waitFor(async () => /Video B of 3/.test((await dec(t)).bar) || !!(await R(t, `return !!r.querySelector('[data-trv-go="B"]');`)), 60);
      if (!/Video B of 3/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="B"]'); await sleep(600); }
      const d = await dec(t);
      ok(/Video B of 3/.test(d.bar) && /^Approve/.test(d.ok), `${label}: the card is at Client Approval, and Kasper's Review Session lists it for B, with its Approve ("${d.bar}" | "${d.ok}")`);
      const u0 = t.state.upserts.length, g0 = (t.gw || []).length;
      await press(t, '[data-ok="video"]');
      await waitFor(async () => !!t.T.versions[1].kasper_ok_at, 60);
      await sleep(2500);
      const after = t.state.upserts.slice(u0).map(u => u.video_status).filter(Boolean).concat((t.gw || []).slice(g0).filter(g => g.op === 'status').map(g => g.status));
      ok(!!t.T.versions[1].kasper_ok_at && !after.length, `${label}: Kasper's approve sends B to the client, and writes no status (the card is already there: ${after.join(',') || 'none'})`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    // Kasper's second layout (Trialtest, live on PR 2452): his own Approve on B's tile, with the card already with the
    // client, never reads "Approved in another window".
    for (const [w, h, label] of [[1440, 900, 'route kasper tiles 1440']].filter(() => part('routek'))) {
      const vs = three().map((v, i) => Object.assign(v, { smm_ok_at: '2026-10-29T08:00:00.000Z', kasper_ok_at: i === 1 ? null : '2026-10-29T08:30:00.000Z' }));
      const t = await start('kasper', true, vs, { width: w, height: h, layout2: true, beforeOpen: async t2 => {
        await keepGateway(t2);
        const card = t2.state.cards.find(c => c.id === 'rs1');
        Object.assign(card, { video_status: 'Client Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Client Approval' });
        if (t2.T_native) Object.assign(t2.T_native, { status: 'client_approval' });
      } });
      await waitFor(async () => !!(await R(t, `return !!r.querySelector('[data-trk-ok="B"]');`)), 60);
      await press(t, '[data-trk-ok="B"]');
      await waitFor(async () => !!t.T.versions[1].kasper_ok_at, 60);
      await sleep(2500);
      const said = await R(t, `return (r.textContent || '').replace(/\\s+/g, ' ');`);
      ok(!!t.T.versions[1].kasper_ok_at && !/in another window/i.test(said), `${label}: Kasper's own Approve on B's tile never says "Approved in another window" (${(said.match(/[^.]*another window[^.]*\./i) || ['none'])[0] + ' | B ok ' + !!t.T.versions[1].kasper_ok_at})`);
      await shot(t, 'route-kasper-tiles-1440');
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    // Kasper's second layout, his last tile (Trialtest, live on PR 2455): A, B and C wait for him with the card at Kasper
    // Approval; his Approve on C, the last, moves the card to the client. It is his own answer: the page never says
    // "answered in another window".
    for (const [w, h, label] of [[1440, 900, 'route kasper last tile 1440']].filter(() => part('routek'))) {
      const vs = three().map(v => Object.assign(v, { smm_ok_at: '2026-10-29T08:00:00.000Z', kasper_ok_at: null }));
      const t = await start('kasper', true, vs, { width: w, height: h, layout2: true, beforeOpen: async t2 => {
        await keepGateway(t2);
        const card = t2.state.cards.find(c => c.id === 'rs1');
        Object.assign(card, { video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval' });
        if (t2.T_native) Object.assign(t2.T_native, { status: 'kasper_approval' });
      } });
      const said = [];
      for (const [l, i] of [['A', 0], ['B', 1], ['C', 2]]) {
        await waitFor(async () => !!(await R(t, `return !!r.querySelector('[data-trk-ok="${l}"]:not([disabled])');`)), 60);
        await press(t, `[data-trk-ok="${l}"]`);
        await waitFor(async () => !!t.T.versions[i].kasper_ok_at, 60);
        await sleep(i === 2 ? 3500 : 1500);
        said.push(await R(t, `return (r.textContent || '').replace(/\\s+/g, ' ');`));
      }
      const moved = routeMoved(t, 'Client Approval', 'client_approval');
      const bad = said.map((x, i) => /another window/i.test(x) ? 'ABC'[i] + ': ' + (x.match(/[A-Z][^.]{0,80}another window[^.]*\./) || [''])[0] : '').filter(Boolean);
      ok(moved && !bad.length, `${label}: his own approves on A, B and C move the card to the client and never say "another window" (moved ${moved}; ${bad.join(' | ') || 'none'})`);
      ok(/Approved, sent to the client/.test(said[2]), `${label}: after C the stage says it in his own words: "Approved, sent to the client"`);
      await shot(t, 'route-kasper-last-tile-1440');
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    // ...and another window's answer still says so: Kasper only looks; another window approves every version and the
    // card moves to the client.
    for (const [w, h, label] of [[1440, 900, 'route kasper other window 1440']].filter(() => part('routek'))) {
      const vs = three().map(v => Object.assign(v, { smm_ok_at: '2026-10-29T08:00:00.000Z', kasper_ok_at: null }));
      const t = await start('kasper', true, vs, { width: w, height: h, layout2: true, beforeOpen: async t2 => {
        await keepGateway(t2);
        const card = t2.state.cards.find(c => c.id === 'rs1');
        Object.assign(card, { video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval' });
        if (t2.T_native) Object.assign(t2.T_native, { status: 'kasper_approval' });
      } });
      await waitFor(async () => !!(await R(t, `return !!r.querySelector('[data-trk-ok="A"]');`)), 60);
      t.T.versions.forEach(v => { v.kasper_ok_at = new Date().toISOString(); });
      Object.assign(t.state.cards.find(c => c.id === 'rs1'), { video_status: 'Client Approval', status: 'Client Approval', updated_at: new Date().toISOString() });
      // The page hears it through the next read of the versions (the 30 s re-read; the broadcast is not mocked here).
      await sleep(31000);
      await t.page.evaluate(() => _kasperLoadReview(true));
      await sleep(3000);
      const said = await R(t, `return (r.textContent || '').replace(/\\s+/g, ' ');`);
      ok(/answered in another window/.test(said) && !/Approved, sent to the client, so it has left/.test(said),
        `${label}: a card another window answered still says "answered in another window" (${(said.match(/[A-Z][^.]{0,80}(another window|left your list)[^.]*\./) || ['none'])[0]})`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    // The client link shows only versions that have come through the team: A and C, not B (still with Kasper).
    for (const [w, h, label] of [[1440, 900, 'route client 1440'], [390, 844, 'route client 390']].filter(() => part('routec'))) {
      const vs = three().map((v, i) => Object.assign(v, { smm_ok_at: '2026-10-29T08:00:00.000Z', kasper_ok_at: i === 1 ? null : '2026-10-29T08:30:00.000Z' }));
      const t = await start('client', true, vs, Object.assign({ width: w, height: h }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      const d = await dec(t);
      const letters = await R(t, `return [...r.querySelectorAll('[data-trv-go]')].map(b => b.dataset.trvGo).join('');`);
      ok(/of 2/.test(d.bar) && letters === 'AC', `${label}: the client sees A and C only, never B while it is with Kasper ("${d.bar}" | ${letters})`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    // A waits for the client, B is with Kasper (out of the client's sight), C is approved: a change on A keeps the card in
    // Client Approval, because B still has to reach the client (Codex on PR 2452: the routing read only the versions on
    // screen and sent the card to Tweaks Needed).
    for (const [w, h, label] of [[1440, 900, 'route client change 1440'], [390, 844, 'route client change 390']].filter(() => part('routec'))) {
      const vs = three().map((v, i) => Object.assign(v, { smm_ok_at: '2026-10-29T08:00:00.000Z', kasper_ok_at: i === 1 ? null : '2026-10-29T08:30:00.000Z' },
        i === 2 ? { status: 'approved', client_ok_at: '2026-10-29T09:00:00.000Z' } : {}));
      const t = await start('client', true, vs, Object.assign({ width: w, height: h, beforeOpen: keepGateway }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
      if (!/Video A of 2/.test((await dec(t)).bar)) { await press(t, '[data-trv-go="A"]'); await sleep(600); }
      await askChange(t, 'Fictional note: a calmer start on A.');
      await waitFor(async () => t.T.versions[0].status === 'change asked', 60);
      await sleep(3000);
      ok(t.T.versions[0].status === 'change asked' && !tweaked(t), `${label}: A's change keeps the card in Client Approval while B is still with Kasper (no Tweaks Needed)`);
      ok(!t.errors.length, `${label}: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }

    // ---------- 2: the review page keeps the reel's shape while the next version loads ----------
    // ---------- The client's Sheet and Month (the Supervisor's ruling, 2026-10-29): a small muted "N versions" tag beside
    // the card's title says there are several versions; tapping it opens the Review page on the first waiting version. ----------
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']].filter(() => part('hint'))) {
      const t = await start('client', true, three());
      // Collaborative mode on: without it the client's Sheet and Month show finished posts only, so a card still to
      // review is not on them at all.
      await t.page.evaluate(() => { calState.settings = Object.assign({}, calState.settings, { collab_mode: true }); onCalViewChange('organizer'); });
      const tagOf = sel => t.page.evaluate(q => {
        const n = [...document.querySelectorAll(q)].find(x => x.offsetParent);
        if (!n) return null;
        const cs = getComputedStyle(n), host = n.closest('.cal-card, .cal-month-pill'), title = host && host.querySelector('.cal-fld-name, .cal-month-pill-name');
        const r = n.getBoundingClientRect(), tr = title ? title.getBoundingClientRect() : null;
        return { t: n.textContent.trim(), size: parseFloat(cs.fontSize), color: cs.color, bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius),
          beside: !!tr && Math.abs((r.top + r.bottom) / 2 - (tr.top + tr.bottom) / 2) < 14, inside: !!host && r.right <= host.getBoundingClientRect().right + 1 };
      }, sel);
      let sheet = null;
      for (let i = 0; i < 40 && !(sheet = await tagOf('#calView .cal-card .cal-trial-tag')); i++) await sleep(150);
      ok(sheet && sheet.t === '3 versions' && sheet.size <= 11 && sheet.radius > 0 && sheet.radius <= 6 && sheet.beside && sheet.inside, `${label}: the client's Sheet card says "3 versions" in a small tag beside its title (${JSON.stringify(sheet)})`);
      await shot(t, 'hint-sheet-' + label);
      await t.page.evaluate(() => { const n = [...document.querySelectorAll('#calView .cal-card .cal-trial-tag')].find(x => x.offsetParent); if (n) n.click(); });
      await waitNew(t);
      await sleep(800);
      const opened = await t.page.evaluate(() => calState.view);
      const d = await dec(t);
      ok(opened === 'review' && /^on/.test(d.dots.split(',')[0] || ''), `${label}: tapping it opens the Review page on the first waiting version (${opened}, ${d.dots})`);
      await t.page.evaluate(() => onCalViewChange('month'));
      let month = null;
      for (let i = 0; i < 40 && !(month = await tagOf('#calView .cal-month-pill .cal-trial-tag')); i++) await sleep(150);
      await shot(t, 'hint-month-' + label);
      ok(month && month.t === '3 versions' && month.inside, `${label}: the Month card says "3 versions" too (${JSON.stringify(month)})`);
      ok(!t.errors.length, `${label} hint: no page errors (${t.errors.join(' | ')})`);
      await t.ctx.close();
    }
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']].filter(() => part('shape'))) {
      const t = await start('client', true, three(), Object.assign({ beforeOpen: async t2 => {
        t2.state.cards.forEach(c => { c.thumbnail_url = ''; });
        await t2.ctx.route('**/functions/v1/frameio-view*', async route => { await sleep(500); return route.fallback(); });
      } }, label === 'phone' ? { width: w, height: h, context: { hasTouch: true, isMobile: true } } : {}));
      await waitFor(async () => !!(await R(t, `const p = r.querySelector('#fvHost .fv-player'); return p && p.getAttribute('data-state') === 'ready';`)), 100);
      await t.page.evaluate(() => { window.__sh = []; const step = () => { const r = document.getElementById('svReviewStage').shadowRoot; const p = r.querySelector('#fvHost .fv-player'); if (p) { const b = p.getBoundingClientRect(); window.__sh.push([Math.round(b.width), Math.round(b.height), p.getAttribute('data-state')]); } if (window.__sh.length < 300) requestAnimationFrame(step); }; requestAnimationFrame(step); });
      await press(t, '[data-trv-go="B"]');
      await waitFor(async () => !!(await t.page.evaluate(() => (window.__sh || []).some(x => x[2] !== 'ready') && (window.__sh || []).slice(-1)[0][2] === 'ready')), 100);
      const sh = await t.page.evaluate(() => window.__sh || []);
      const wide = sh.filter(x => x[0] && x[1] && x[0] > x[1]);
      ok(sh.length > 5 && !wide.length, `review ${label}: switching to Video B never shows a wide box while it loads (${sh.length} frames, wide ${JSON.stringify(wide.slice(0, 2))})`);
      await t.ctx.close();
    }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`trial-reels-round2-review-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
