'use strict';
/*
 * TRIAL REELS, THE OWNER'S THIRD ROUND ON THE STAFF CARD (session Trials, 2026-10-28), in a real browser, fully offline.
 * Sidney, from the test client's card versions list:
 *   1. "if a client does something on the trial, like approves, it shows immediately on the calendar": the card listens
 *      to trial-reels' broadcast for its client and reads that one card again at once (under 2 s), not on the 30 s list.
 *   2. Each version row says its state ("approved" on A and B, not blank), with who said it per stage in its hover.
 *   3. "Client passed" reads "Client dropped".
 *   4. No "Posted as trial reels? Start the 24 h" link: the trial starts when the card is Posted.
 *   5. The state labels are small tags with a small radius, not pills.
 *   6. The "Video E  Paste the Frame.io link" row is a minimal "+ Add version" that opens the paste field.
 *   7. The row's pencil, then Escape, drew the whole versions list twice for a moment.
 *   Follow-up (Trialtest's live walk): a version dropped before its link was pasted shows no paste placeholder.
 * At 1440 and 390, light and dark. TRIAL_R3_SHOTS=<dir> writes screenshots (fictional data only).
 */
const path = require('path');
const fs = require('fs');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-round3-' + l.toLowerCase();
const SHOTS = process.env.TRIAL_R3_SHOTS || '';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  const T = { calls: [] };
  const reset = () => {
    T.versions = ['A', 'B', 'C', 'D'].map((l, i) => ({ id: 'v' + l, letter: l, status: ['waiting', 'waiting', 'waiting', 'dropped'][i],
      frame_url: LINK(l), revision: 0, smm_ok_at: '2026-10-28T08:00:00.000Z', kasper_ok_at: '2026-10-28T08:05:00.000Z', updated_at: '2026-10-28T09:00:00.000Z', post_id: 'p_t1' }));
    // D was dropped before anyone pasted its link (Trialtest, 2026-10-28): its row shows no paste placeholder.
    T.versions[3].frame_url = '';
    T.calls = [];
    vid.file_url = LINK('A'); card.asset_url = LINK('A'); card.thumbnail_url = 'https://f.io/fixture-round3-thumb';
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
    if (b.action === 'version_new_cut') {
      const res = L.newCutPatch(T.versions, b.letter);
      if (res.error) return reply({ ok: false, error: res.error });
      Object.assign(T.versions.find(v => v.letter === b.letter), res.patch);
      return reply(Object.assign({ ok: true }, shape()));
    }
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

  const state = page => page.evaluate(() => { const s = [...document.querySelectorAll('.cal-link-post.trl-main')].find(n => n.offsetParent); return s ? s.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const rowsOf = page => page.evaluate(() => [...document.querySelectorAll('.trl-list .trl-v')].filter(n => n.offsetParent).map(n => {
    const lab = n.querySelector('.trl-lab, .sv-dropped-note');
    return { t: n.innerText.replace(/\s+/g, ' ').trim(), lab: lab ? lab.textContent.trim() : '', title: lab ? lab.getAttribute('title') || '' : '',
      radius: lab ? parseFloat(getComputedStyle(lab).borderTopLeftRadius) : 0, add: n.classList.contains('trl-add') };
  }));
  const lists = page => page.evaluate(() => { const c = [...document.querySelectorAll('#calView .cal-card')].find(n => n.offsetParent && n.querySelector('.cal-link-post.trl-main')); return c ? c.querySelectorAll('.trl-list').length : -1; });
  const openList = async page => { if (!(await page.$('.trl-list'))) { await page.click('.cal-link-post .trl-chev'); await sleep(300); } };

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']].filter(x => !process.env.TRL_ONLY || x[2] === process.env.TRL_ONLY)) {
      for (const theme of ['light', 'dark']) {
        const tag = label + ' ' + theme;
        reset();
        // Sidney's card: A and B approved, C waiting, D dropped by the team, E with no link yet... and a client drop on C.
        Object.assign(T.versions[0], { status: 'approved', client_ok_at: '2026-10-28T10:00:00.000Z' });
        Object.assign(T.versions[1], { status: 'approved', client_ok_at: '2026-10-28T10:01:00.000Z' });
        Object.assign(T.versions[2], { client_pass_at: '2026-10-28T10:02:00.000Z' });
        const page = await open(w, h, theme);
        await openList(page);
        // ---- 2, 3, 5: each row says its state, "Client dropped", small tags ----
        let R = await rowsOf(page);
        const A = R.find(r => /^Video A/.test(r.t)), B = R.find(r => /^Video B/.test(r.t)), C = R.find(r => /^Video C/.test(r.t));
        ok(A && A.lab === 'approved' && B && B.lab === 'approved', `${tag}: A and B say "approved" (${A && A.lab} | ${B && B.lab})`);
        ok(A && /SMM: approved/.test(A.title) && /Kasper: approved/.test(A.title) && /Client: approved/.test(A.title), `${tag}: A's hover says who approved, per stage ("${A && A.title}")`);
        ok(C && C.lab === 'Client dropped' && !/passed/i.test(await page.evaluate(() => document.querySelector('.trl-list').innerText)), `${tag}: C says "Client dropped", never "passed" (${C && C.lab})`);
        ok(R.filter(r => r.lab && r.lab !== 'dropped').every(r => r.radius > 0 && r.radius <= 6), `${tag}: the state tags have a small radius, not a pill (${R.map(r => r.radius).join(',')})`);
        const D = R.find(r => /^Video D/.test(r.t));
        ok(D && /dropped/.test(D.t) && !/Paste the Frame\.io link/.test(D.t) && await page.evaluate(() => ![...document.querySelectorAll('.trl-list .trl-v')].some(n => /^Video D/.test(n.innerText.trim()) && n.querySelector('.trl-paste'))), `${tag}: a dropped version with no link shows no paste placeholder ("${D && D.t}")`);
        // ---- 4: no start link ----
        ok(!/Posted as trial reels|Start the 24 h/i.test(await page.evaluate(() => document.querySelector('.trl-list').innerText)) && !(await page.$('.trl-start')), `${tag}: no "Posted as trial reels? Start the 24 h" link`);
        // ---- 6: "+ Add version" ----
        const add = R.find(r => r.add);
        ok(add && /^\+ ?Add version$/.test(add.t) && !/Paste the Frame\.io link|Video E/.test(add.t), `${tag}: the add row is a minimal "+ Add version" (${add && add.t})`);
        await page.click('.trl-list .trl-add button');
        await sleep(250);
        ok(!!(await page.$('.trl-list .trl-add .trl-link-input')) && await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('trl-link-input')), `${tag}: pressing it opens the paste field, focused`);
        await page.keyboard.press('Escape');
        await sleep(250);
        await shot(page, 'r3-card-' + label + '-' + theme);
        // ---- 7: the row's pencil, then Escape: one list, never two ----
        // Escape and a click away, three times over (the Supervisor's ask): the list never doubles.
        await page.evaluate(() => { window.__lists = []; const step = () => { const c = [...document.querySelectorAll('#calView .cal-card')].find(n => n.offsetParent && n.querySelector('.cal-link-post.trl-main')); window.__lists.push(c ? c.querySelectorAll('.trl-list').length : -1); if (window.__lists.length < 400) requestAnimationFrame(step); }; requestAnimationFrame(step); });
        const leaves = [];
        for (const how of ['Escape', 'click away', 'Escape', 'click away', 'Escape', 'click away']) {
          await page.click('#calView .cal-card .cal-link-post.trl-main .cal-link-edit');
          await sleep(200);
          if (how === 'Escape') await page.keyboard.press('Escape');
          else await page.mouse.click(3, h - 3);
          await sleep(600);
          leaves.push(how + '=' + await lists(page));
        }
        await sleep(600);
        const seen = await page.evaluate(() => window.__lists || []);
        ok(seen.length > 20 && seen.every(n => n === 1) && leaves.every(x => /=1$/.test(x)), `${tag}: the pencil then Escape or a click away, three times each, keep exactly one versions list on every frame (${[...new Set(seen)].join(',')}; ${leaves.join(' ')})`);
        // ---- 1: a client's answer shows on the open card at once (the trial-reels broadcast) ----
        if (theme === 'light') {
          const subscribed = await page.evaluate(() => (window.__rtChannels || []).some(c => c.name === 'trial-reels'));
          ok(subscribed, `${tag}: the card listens on the one trial-reels channel`);
          Object.assign(T.versions[2], { client_pass_at: null, status: 'approved', client_ok_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          // The broadcast carries only the first 12 hex of sha256(post_id): no client, no card id.
          const h = require('crypto').createHash('sha256').update('p_t1').digest('hex').slice(0, 12);
          // Another card's change first: no read.
          const c0 = T.calls.length;
          await page.evaluate(() => (window.__rtChannels || []).filter(c => c.name === 'trial-reels').forEach(c => c._cbs.forEach(x => { try { x.cb({ event: 'changed', payload: { h: '0123456789ab' } }); } catch (e) {} })));
          await sleep(500);
          ok(T.calls.length === c0, `${tag}: another card's change reads nothing`);
          const t0 = Date.now();
          await page.evaluate(hh => (window.__rtChannels || []).filter(c => c.name === 'trial-reels').forEach(c => c._cbs.forEach(x => { try { x.cb({ event: 'changed', payload: { h: hh } }); } catch (e) {} })), h);
          await page.waitForFunction(() => { const s = [...document.querySelectorAll('.cal-link-post.trl-main')].find(n => n.offsetParent); return s && /3\/3/.test(s.innerText); }, null, { timeout: 5000, polling: 50 }).catch(() => {});
          const ms = Date.now() - t0;
          ok(ms < 2000 && /3\/3/.test(await state(page)), `${tag}: the client's approve on C shows on the card in ${ms} ms (under 2 s): "${await state(page)}"`);
          ok(T.calls.slice(-3).some(c => c.action === 'read' && c.post_id === 'p_t1'), `${tag}: it reads only that card (no client-wide list)`);
        }
        if (page.errors.length) console.log('page errors', tag, page.errors);
        ok(!page.errors.length, `${tag}: no page errors`);
        await page.close();
      }
    }
    // Trialeyes E2 (2026-10-29): a waiting version says how far it got, never the grey "waiting" of one nobody saw.
    for (const theme of ['light', 'dark'].filter(() => !process.env.TRL_ONLY || process.env.TRL_ONLY === 'desktop')) {
      reset();
      Object.assign(T.versions[0], { kasper_ok_at: null });                      // A: the SMM said yes
      Object.assign(T.versions[2], { smm_ok_at: null, kasper_ok_at: null });   // C: nobody has looked yet
      const page = await open(1440, 900, theme);
      await openList(page);
      const R = await rowsOf(page);
      const lab = l => (R.find(r => new RegExp('^Video ' + l).test(r.t)) || {}).lab;
      const col = await page.evaluate(() => [...document.querySelectorAll('.trl-list .trl-v .trl-lab')].map(n => n.textContent.trim() + '=' + getComputedStyle(n).backgroundColor));
      const bg = t => (col.find(c => c.startsWith(t + '=')) || '').split('=')[1];
      ok(lab('A') === 'with Kasper' && lab('B') === 'with client' && lab('C') === 'waiting', `stages ${theme}: A says "with Kasper", B "with client", C "waiting" (${lab('A')} | ${lab('B')} | ${lab('C')})`);
      ok(bg('with Kasper') && bg('with Kasper') !== bg('waiting') && bg('with client') !== bg('waiting') && bg('with Kasper') !== bg('with client'), `stages ${theme}: each has its own colour, none the grey of "waiting" (${col.join(' | ')})`);
      ok(/SMM: approved · Kasper: waiting/.test((R.find(r => /^Video A/.test(r.t)) || {}).title || ''), `stages ${theme}: A's hover still says who said what`);
      await shot(page, 'r3-stages-' + theme);
      await page.close();
    }
    // The owner's choice (a), 2026-10-29 (OPEN_REPAIRS 587): a card waits in Tweaks Needed only while a change is open.
    // "New cut ready" on the last one sends the card back to For SMM Approval (today's status pick); with another change
    // still open, the card stays.
    for (const other of [false, true].filter(() => !process.env.TRL_ONLY || process.env.TRL_ONLY === 'desktop')) {
      reset();
      Object.assign(T.versions[0], { status: 'approved', client_ok_at: '2026-10-29T01:00:00.000Z' });
      Object.assign(T.versions[1], other ? { status: 'change asked', change_by: 'client', change_note: 'Fictional note B' } : { status: 'approved', client_ok_at: '2026-10-29T01:00:00.000Z' });
      Object.assign(T.versions[2], { status: 'change asked', change_by: 'client', change_note: 'Fictional note C' });
      card.video_status = 'Tweaks Needed'; vid.status = 'tweak';
      const page = await open(1440, 900, 'light');
      await openList(page);
      const u0 = S.upserts.length;
      const row = await page.$$('.trl-list .trl-v');
      await row[2].hover();
      await page.click('.trl-list .trl-v:nth-child(3) .trl-ico[title="New cut ready"]');
      await page.waitForFunction(() => true, null, { timeout: 100 }).catch(() => {});
      await sleep(2500);
      const moved = S.upserts.slice(u0).some(u => u.post && u.post.video_status === 'For SMM Approval') || vid.status === 'smm_approval';
      if (!other) ok(T.versions[2].status === 'waiting' && moved, `new cut: the last open change's new cut sends the card back to For SMM Approval (deliverable ${vid.status})`);
      else ok(T.versions[2].status === 'waiting' && !moved, `new cut: with B's change still open, C's new cut leaves the card in Tweaks Needed (deliverable ${vid.status})`);
      card.video_status = 'For SMM Approval'; vid.status = 'smm_approval';
      await page.close();
    }
    // chart.js (loaded async from the same CDN as the realtime library on every page) lands after the card joined the
    // trial-reels channel, as on a slow first boot on CI (#2418): the card still hears a client's change.
    if (!process.env.TRL_ONLY || process.env.TRL_ONLY === 'desktop') {
      reset();
      let release; const late = new Promise(r => { release = r; });
      const hold = async route => { await late; return route.fallback(); };
      await S.ctx.route('**/chart.js@*/**', hold);
      const page = await open(1440, 900, 'light');
      await openList(page);
      await page.waitForFunction(() => (window.__rtChannels || []).some(c => c.name === 'trial-reels'), null, { timeout: 8000, polling: 100 }).catch(() => {});
      release();
      await page.waitForFunction(() => typeof window.Chart !== 'undefined' || (document.querySelectorAll('script[src*="chart.js"]').length && performance.getEntriesByType('resource').some(e => /chart\.js@/.test(e.name))), null, { timeout: 8000 }).catch(() => {});
      await sleep(500);
      const kept = await page.evaluate(() => (window.__rtChannels || []).some(c => c.name === 'trial-reels'));
      ok(kept, 'late chart.js: the card still listens on the trial-reels channel after the CDN\'s other script lands');
      await S.ctx.unroute('**/chart.js@*/**', hold);
      await page.close();
    }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-round3-card-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
