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
  // TRL_PART=pass|kasper|shape|dblclick|cok|push runs one part (each fails on main by itself).
  const part = k => !process.env.TRL_PART || process.env.TRL_PART === k;
  const three = () => fresh().slice(0, 3).map(v => Object.assign(v, { kasper_ok_at: '2026-10-27T08:30:00.000Z' }));

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
        await waitFor(async () => !!t.T.versions[1].client_pass_at, 40);
        await sleep(600);
        d = await dec(t);
        ok(/Video C/.test(d.bar) && !d.pass && d.ok === 'Approve Video C', `${tag}: Video C, the last one not passed, offers Approve and a change but no "Not this one" (${JSON.stringify(d)})`);
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
      ok(/Video A/.test(d.bar) && d.pass && /not passed on/.test(said), `client: a refused pass puts Video A back on screen and says so (${said.replace(/\s+/g, ' ').slice(0, 120)})`);
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

    // ---------- Follow-up: a version only the client approved says so to the team, and the team's Approve works ----------
    // A card sent straight to Client Approval: nobody on the team has answered, the client approved Video A.
    const clientOnly = () => three().map(v => Object.assign(v, { kasper_ok_at: null, smm_ok_at: null }, v.letter === 'A' ? { status: 'approved', client_ok_at: '2026-10-28T10:00:00.000Z' } : {}));
    for (const [mode, w, h, label] of [['kasper', 1280, 860, 'kasper standard'], ['smm', 1440, 900, 'SMM review'], ['smm', 390, 844, 'SMM review 390']].filter(() => part('cok'))) {
      for (const th of ['light', 'dark']) {
        const t = await start(mode, true, clientOnly(), Object.assign({ width: w, height: h, noSmm: ['A', 'B', 'C'] }, w < 600 ? { context: { hasTouch: true, isMobile: true } } : {}));
        await theme(t, th);
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
      const t = await start('kasper', true, clientOnly(), { layout2: true, noSmm: ['A', 'B', 'C'] });
      const tile = await R(t, `const v = [...r.querySelectorAll('.trk-v')].find(n => /Video A/.test(n.innerText)); const b = [...r.querySelectorAll('.trk-v')].find(n => /Video B/.test(n.innerText));
        return { a: v ? v.innerText.replace(/\s+/g, ' ') : '', b: b ? !!b.querySelector('.trv-cok') : true, wide: [...r.querySelectorAll('.trk-v, .trk-go')].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.className + ':' + n.scrollWidth + '>' + n.clientWidth).join(' ') };`);
      ok(/Client approved/.test(tile.a) && !tile.b && !tile.wide, `kasper tiles: A's tile says "Client approved", B's does not, nothing spills (${JSON.stringify(tile)})`);
      // A version the SMM has not looked at is "with the team" on its tile, never "change asked".
      ok(/with the team/.test(tile.a) && !/change asked/.test(tile.a), `kasper tiles: a version still with the SMM says "with the team", not "change asked" ("${tile.a}")`);
      await shot(t, 'cok-kasper-tiles');
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

    // ---------- 2: the review page keeps the reel's shape while the next version loads ----------
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
