'use strict';
/*
 * TRIAL REELS, THE OWNER'S SECOND ROUND ON THE STAFF CARD (session Trials, 2026-10-28), in a real browser, fully
 * offline. Sidney, from the live test client's card:
 *   1. "the pink and blue thing should go ... like how it was before, the color should still go to the end": the
 *      Thumbnail (blue) and Video (pink) rows' colour runs to the row's end again, with the trial switch, the arrow and
 *      the row buttons inside it; the trial state never ends in "…" ("Video · 4  0/3 ap…"); a hover stays as #2392 made
 *      it (only the icon changes).
 *   4. "I approved one of them, but in the SMM's calendar I don't see that it's approved": the card reads its
 *      versions again by itself while it is on screen (every 30 s, and when the tab comes back), so a client's answer
 *      shows on the SMM's card with no reload and no click.
 *   3. (the team's side) a version the client passed on says "Client dropped" in the card's list, and the collapsed row
 *      does not count it as waiting.
 * Proves each at 1440 and 390, light and dark. TRIAL_R2_SHOTS=<dir> writes screenshots (fictional data only).
 */
const path = require('path');
const fs = require('fs');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-round2-' + l.toLowerCase();
const SHOTS = process.env.TRIAL_R2_SHOTS || '';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  const T = { calls: [] };
  const reset = () => {
    T.versions = ['A', 'B', 'C', 'D'].map((l, i) => ({ id: 'v' + l, letter: l, status: ['waiting', 'waiting', 'waiting', 'dropped'][i],
      frame_url: LINK(l), revision: 0, smm_ok_at: '2026-10-28T08:00:00.000Z', kasper_ok_at: '2026-10-28T08:05:00.000Z', updated_at: '2026-10-28T09:00:00.000Z', post_id: 'p_t1' }));
    T.calls = [];
    vid.file_url = LINK('A'); card.asset_url = LINK('A'); card.thumbnail_url = 'https://f.io/fixture-round2-thumb';
  };
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? { clients: ['fixtureclient'] } : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.calls.push(b);
    const shape = () => Object.assign({ enabled: true, winner_letter: null }, L.readShape(T.versions, { client: false, mainLink: String(vid.file_url || ''), cardStatus: card.video_status }));
    const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) }).catch(() => {});
    if (b.action === 'list') return reply({ ok: true, cards: { p_t1: shape() } });
    if (b.action === 'read') return reply(Object.assign({ ok: true }, shape()));
    return reply({ ok: false, error: 'unknown_action' });
  });

  // The video viewer: every version plays the fixture's vertical clip (a reel), as Frame.io's 9:16 cuts do.
  const VCLIP = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip-vertical.webm'));
  const MEDIA = 'https://media.fixture.test/clip-vertical.webm';
  await S.ctx.route('**/functions/v1/frameio-view*', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    // A beat before each answer, as live: the player waits for the address of the version picked.
    await sleep(400);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({
      ok: true, video: { url: MEDIA, renditions: { efficient: MEDIA, high_quality: MEDIA, original: MEDIA }, expires_at: new Date(Date.now() + 3600000).toISOString(), name: 'Fixture clip.webm', file_id: 'f1', duration_seconds: 12, fps: 24 },
      comments: [], comments_error: '', open_url: 'https://next.frame.io/share/00000000-0000-4000-8000-000000000001', fetched_at: new Date().toISOString() }) });
  });
  await S.ctx.route('https://media.fixture.test/**', route => route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: VCLIP }));
  const shot = async (page, name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    const c = await page.$('#calView .cal-card .cal-link-post');
    const box = c && await c.evaluate(n => { const k = n.closest('.cal-card') || n; const r = k.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    if (box && box.width) await page.screenshot({ path: path.join(SHOTS, name + '.png'), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: Math.min(900, box.height + 16) } });
  };
  const open = async (w, h, theme) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
    await S.openCalendar(page);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1000); }
    await sleep(1500);
    return page;
  };
  // Each link row's colour: the row's own fill (or its link's, when the row has none) at the row's right end, and
  // whether its last button sits inside that colour.
  const rows = page => page.evaluate(() => {
    const vis = n => n && n.offsetParent;
    const clear = c => /rgba\(0, 0, 0, 0\)|transparent/.test(c);
    return [...document.querySelectorAll('#calView .cal-card .cal-link-field.has-link')].filter(vis).map(f => {
      const pill = f.querySelector('.cal-link-pill-open'), fr = f.getBoundingClientRect(), pr = pill.getBoundingClientRect();
      const btns = [...f.children].filter(n => n !== pill && vis(n) && n.tagName === 'BUTTON');
      const last = btns[btns.length - 1];
      const fill = getComputedStyle(f).backgroundColor;
      // The colour that reaches the row's right end: the row's own, or the link's when the link is the row's end.
      const endFill = !clear(fill) ? fill : (Math.abs(pr.right - fr.right) < 1 ? getComputedStyle(pill).backgroundColor : 'none');
      return { kind: f.classList.contains('cal-link-thumb') ? 'thumb' : 'post', endFill, pillFill: getComputedStyle(pill).backgroundColor,
        lastInside: !last || (last.getBoundingClientRect().right <= fr.right + 0.5 && !clear(endFill)), btnBg: btns.map(b => getComputedStyle(b).backgroundColor) };
    });
  });
  const state = page => page.evaluate(() => {
    const s = [...document.querySelectorAll('.cal-link-post.trl-main')].find(n => n.offsetParent);
    if (!s) return null;
    const lab = s.querySelector('.cal-link-label'), st = s.querySelector('.trl-state'), pill = s.querySelector('.cal-link-pill-open');
    const cut = n => !!n && n.scrollWidth > n.clientWidth + 1;
    return { text: lab ? lab.innerText.replace(/\s+/g, ' ').trim() : '', cut: cut(lab) || cut(st) || cut(s.querySelector('.trl-main-label')), title: pill ? pill.getAttribute('title') || '' : '' };
  });
  const rowOf = (page, letter) => page.evaluate(l => {
    const r = [...document.querySelectorAll('.trl-list .trl-v')].find(n => n.offsetParent && /Video (\w)/.exec((n.querySelector('.trl-l') || {}).textContent || '') && (n.querySelector('.trl-l').textContent === 'Video ' + l));
    return r ? r.innerText.replace(/\s+/g, ' ').trim() : '';
  }, letter);
  const hover = async (page, sel) => {
    const read = () => page.evaluate(s => { const el = [...document.querySelectorAll(s)].find(n => n.offsetParent); if (!el) return null; const a = getComputedStyle(el), f = getComputedStyle(el.closest('.cal-link-field')), i = getComputedStyle(el.querySelector('svg')); return { bg: a.backgroundColor, field: f.backgroundColor, icon: i.transform + '|' + a.color }; }, sel);
    await page.mouse.move(1, 1); await sleep(200);
    const before = await read();
    await page.hover(sel); await sleep(250);
    const after = await read();
    await page.mouse.move(1, 1);
    return { before, after };
  };

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']].filter(x => !process.env.TRL_ONLY || x[2] === process.env.TRL_ONLY)) {
      for (const theme of ['light', 'dark']) {
        const tag = label + ' ' + theme;
        reset();
        const page = await open(w, h, theme);
        // ---- 1: the colour to the row's end, the state whole ----
        const R = await rows(page);
        const thumb = R.find(r => r.kind === 'thumb'), post = R.find(r => r.kind === 'post');
        if (label === 'desktop') {
          // The phone card draws its link rows as outlined buttons (staff phone polish), not coloured pills: unchanged.
          ok(thumb && thumb.endFill === thumb.pillFill && thumb.lastInside, `${tag}: the Thumbnail row's blue runs to its end, its buttons inside it: ${JSON.stringify(thumb)}`);
          ok(post && post.endFill === post.pillFill && post.lastInside, `${tag}: the Video row's pink runs to its end, the switch, arrow and pencil inside it: ${JSON.stringify(post)}`);
          ok(R.every(r => r.btnBg.every(c => /rgba\(0, 0, 0, 0\)|transparent/.test(c))), `${tag}: the buttons themselves stay unboxed (#2392)`);
          const hv = await hover(page, '#calView .cal-card .cal-link-post .cal-link-edit');
          ok(hv.before && hv.before.bg === hv.after.bg && hv.before.field === hv.after.field && hv.before.icon !== hv.after.icon, `${tag}: a hover on the pencil changes only its icon: ${JSON.stringify(hv)}`);
        }
        const st = await state(page);
        // "Video · N" counts the live versions, not the dropped one (Trialeyes E8, OPEN_REPAIRS 595).
        ok(st && /Video · 3/.test(st.text) && /0\/3/.test(st.text) && !st.cut, `${tag}: the trial state reads whole, no "…": ${JSON.stringify(st)}`);
        ok(st && /0 of 3 approved/.test(st.title), `${tag}: the full words are in the hover: "${st && st.title}"`);
        await shot(page, 'r2-card-' + label + '-' + theme);
        if (label === 'desktop') {
          // A narrower card (the live one that cut it was narrower than this fixture's 290 px row): the words step back.
          const tight = await page.addStyleTag({ content: '#calView .cal-card .cal-link-post.trl-main{width:236px!important;max-width:236px!important}' });
          await sleep(150);
          const st3 = await state(page);
          ok(st3 && /Video · 3/.test(st3.text) && /0\/3/.test(st3.text) && !st3.cut, `${tag}: on a 236 px row the state still reads whole (no "…"): ${JSON.stringify(st3)}`);
          await shot(page, 'r2-card-narrow-' + label + '-' + theme);
          await tight.evaluate(n => n.remove());
        }
        // ---- 4: a client's answer shows on the SMM's card by itself ----
        if (label === 'desktop' && theme === 'light') {
          await page.click('.cal-link-post .trl-chev');
          await sleep(300);
          ok(!/approved/.test(await rowOf(page, 'A')), `${tag}: Video A starts waiting`);
          // The client approves Video A on their link: the server has it, this page was told nothing.
          Object.assign(T.versions[0], { status: 'approved', client_ok_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          const t0 = Date.now();
          await page.waitForFunction(() => { const s = [...document.querySelectorAll('.cal-link-post.trl-main')].find(n => n.offsetParent); return s && /1\/3/.test(s.innerText); }, null, { timeout: 40000, polling: 500 }).catch(() => {});
          const took = Date.now() - t0;
          ok(took < 36000, `${tag}: the card says 1/3 within one refresh (${took} ms), no reload, no click`);
          ok(/approved/.test(await rowOf(page, 'A')), `${tag}: Video A's row says approved: "${await rowOf(page, 'A')}"`);
          ok(!!(await page.$('.cal-link-post.trl-main.trl-open')), `${tag}: the open list stays open through the refresh`);
          // The client passes on Video B: "Client dropped" on its row, and the row counts it as answered.
          Object.assign(T.versions[1], { client_pass_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          await sleep(2500);
          await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await sleep(200);
          await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await page.waitForFunction(() => /Client dropped/.test(document.body.innerText), null, { timeout: 5000, polling: 200 }).catch(() => {});
          ok(/Client dropped/.test(await rowOf(page, 'B')), `${tag}: back on the tab, Video B's row says "Client dropped": "${await rowOf(page, 'B')}"`);
          const st2 = await state(page);
          ok(st2 && /1\/2/.test(st2.text), `${tag}: the passed version is not counted as waiting: ${JSON.stringify(st2)}`);
          await shot(page, 'r2-card-passed-' + label + '-' + theme);
          // Codex on PR 2409: a trial whose 24 h end while the page is open changes nothing on the server, yet the row
          // must move from the countdown to the trophy on the next refresh.
          await sleep(2500);
          const ends = new Date(Date.now() + 2500).toISOString();
          T.versions.forEach(v => { if (v.status !== 'dropped') Object.assign(v, { status: 'on trial', client_pass_at: null, posted_at: new Date().toISOString(), trial_ends_at: ends }); });
          await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await page.waitForFunction(() => /On trial/.test((document.querySelector('.cal-link-post.trl-main') || {}).innerText || ''), null, { timeout: 5000, polling: 200 }).catch(() => {});
          ok(/On trial/.test(await page.evaluate(() => (document.querySelector('.cal-link-post.trl-main') || {}).innerText || '')), `${tag}: the trial starts on the card ("On trial · 1 h left")`);
          await sleep(4500);
          await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
          await page.waitForFunction(() => !!document.querySelector('.cal-link-post .trl-state-ico'), null, { timeout: 5000, polling: 200 }).catch(() => {});
          ok(!!(await page.$('.cal-link-post .trl-state-ico')), `${tag}: once the 24 h are up, the next read shows the trophy though nothing changed on the server`);
        }
        // ---- 2: the Notes player keeps the reel's vertical shape while the next version loads ----
        if (theme === 'light') {
          // The card's thumbnail is a Frame.io page (no picture), as on Sidney's card: nothing but the video gives the shape.
          await page.evaluate(() => openCalComments('p_t1'));
          await page.waitForFunction(() => { const p = document.querySelector('#calNotesShell .fv-player'); return p && p.getAttribute('data-state') === 'ready'; }, null, { timeout: 15000 }).catch(() => {});
          const shapeOf = () => page.evaluate(() => { const p = document.querySelector('#calNotesShell .fv-player'); if (!p) return null; const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), state: p.getAttribute('data-state') }; });
          const first = await shapeOf();
          ok(first && first.state === 'ready' && first.h > first.w, `${tag}: Notes plays Video A as a vertical reel (${JSON.stringify(first)})`);
          for (const pick of [2, 3]) {
            // Every frame from the press until the next version plays: never a wide box.
            await page.evaluate(() => { window.__shapes = []; const step = () => { const p = document.querySelector('#calNotesShell .fv-player'); if (p) { const r = p.getBoundingClientRect(); window.__shapes.push([Math.round(r.width), Math.round(r.height), p.getAttribute('data-state')]); } if (window.__shapes.length < 400) requestAnimationFrame(step); }; requestAnimationFrame(step); });
            await page.click('#calNotesShell .trl-notes-sw .cal-cm-aud-btn:nth-child(' + pick + ')');
            await page.waitForFunction(() => { const p = document.querySelector('#calNotesShell .fv-player'); return p && p.getAttribute('data-state') === 'ready' && (window.__shapes || []).some(x => x[2] !== 'ready'); }, null, { timeout: 15000 }).catch(() => {});
            await sleep(300);
            const shapes = await page.evaluate(() => window.__shapes || []);
            const wide = shapes.filter(x => x[0] && x[1] && x[0] > x[1]);
            ok(shapes.length > 5 && !wide.length, `${tag}: switching to Video ${'ABC'[pick - 1]}, the player never shows a wide frame while it loads (${shapes.length} frames, wide ${JSON.stringify(wide.slice(0, 3))})`);
          }
          await page.keyboard.press('Escape');
          await sleep(400);
        }
        if (page.errors.length) console.log('page errors', tag, page.errors);
        ok(!page.errors.length, `${tag}: no page errors`);
        await page.close();
      }
    }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-round2-card-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
