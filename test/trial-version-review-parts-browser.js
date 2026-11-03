'use strict';
/*
 * V4 (plan docs/plans/2026-11-trial-and-posting/combined.md row V4): the review page with trial versions that carry their
 * own thumbnail and caption (behind trial_versions_v2), in a real browser, fully offline, on the shared review fixture
 * (fictional clients, cards and tokens). The trial-reels function is answered by its own rules (logic.mjs). Proves:
 *   - 688 (option B): the versions are one segmented control, "Version A, B, C" (Kasper's tiles too), and the stage's
 *     own Thumbnail and Caption parts show the selected version's (else the card's), each once: no separate block, no
 *     card caption beside a version's; a trial card carries a "Trial" chip on the board; the thumbnail part's own Ask
 *     for a change goes on the version with its part;
 *   - one Approve covers the version's parts: approving every version calls today's approve on the video, the
 *     thumbnail and the caption exactly once each (the client), and moves all three parts on (the SMM);
 *   - Ask for a change picks the part: a thumbnail change is stored on the version with its part and reaches the card's
 *     graphic part as today's change request ("Video C, thumbnail: ..."), never the video's;
 *   - a failed versions read falls back to today's page;
 *   - with the switch off, today's trial page exactly: no fields, no part picker, and Approve all approves the video only;
 *   - at 390 wide nothing scrolls sideways; no page errors anywhere.
 */
const path = require('node:path');
// TRIAL_TABS_ENGINE=webkit runs it in WebKit (CI requires it there: TRIAL_TABS_REQUIRE_WEBKIT=1).
const PW = require('playwright');
const ENGINE = String(process.env.TRIAL_TABS_ENGINE || 'chromium').trim();
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const LINK = l => 'https://f.io/fixture-trial-' + l.toLowerCase();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const B_THUMB = 'https://e.example/fixture-version-b-thumb.jpg';
const B_CAPTION = 'Version B words, fictional.';
const DRIVE = 'https://drive.google.com/file/d/FixtureDriveFile123/view?usp=sharing';
const CARD_CAP = /Most people decide in the first second/;
const PNG = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'frameio-viewer-poster-vertical.png'));

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try { browser = await PW[ENGINE].launch(); } catch (e) {
    if (process.env.TRIAL_TABS_REQUIRE_WEBKIT === '1') { console.error('FAIL  ' + ENGINE + ' could not start: ' + (e && e.message || e).split('\n')[0]); process.exit(1); }
    console.log('trial-version-review-parts-browser: ' + ENGINE + ' is not installed here; skipped'); server.close(); process.exit(0);
  }
  console.log('engine: ' + ENGINE);
  const fresh = () => ['A', 'B', 'C'].map(l => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, updated_at: '2026-11-03T09:00:00.000Z',
    smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, client_pass_at: null, change_by: null, change_note: null, change_at: null, change_part: null,
    thumbnail_url: l === 'B' ? B_THUMB : null, caption: l === 'B' ? B_CAPTION : null }));

  async function start(mode, v2, extra) {
    const x = extra || {};
    const T = { versions: fresh(), calls: [], failList: !!x.failList };
    if (x.thumbs) T.versions.forEach(v => { if (v.letter in x.thumbs) v.thumbnail_url = x.thumbs[v.letter]; });
    if (mode !== 'smm') T.versions.forEach(v => { v.smm_ok_at = '2026-11-03T08:00:00.000Z'; if (mode === 'client') v.kasper_ok_at = '2026-11-03T08:10:00.000Z'; });
    const flagValues = { trial_reels_pages: { clients: [SLUG] }, trial_versions_v2: { clients: v2 ? [SLUG] : ['someotherclient'] } };
    if (x.layout2) flagValues.review_stage_kasper_layout2 = { all: true };
    const t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', flagValues, linkedParts: true }, x.polish ? { polish: true } : {}, mode !== 'client' ? { staff: STAFF } : {}, x.width ? { width: x.width, height: 844 } : {}));
    t.T = T;
    const status = mode === 'smm' ? 'For SMM Approval' : mode === 'kasper' ? 'Kasper Approval' : 'Client Approval';
    let CARD = null;
    // A Google Drive file page as a version's own thumbnail (the team's usual link): Google's image host answers it here.
    T.pics = [];
    await t.ctx.route('https://lh3.googleusercontent.com/**', r => { T.pics.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
    if (x.brokenPics) await t.ctx.route('https://e.example/**', r => r.fulfill({ status: 404, body: '' }));
    await t.ctx.route('**/functions/v1/trial-reels', async route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      const b = JSON.parse(r.postData() || '{}');
      T.calls.push(b);
      if (!CARD) CARD = await t.page.evaluate(() => { const p = (calState.posts || []).find(x => x.id === 'rs1') || {}; return { thumbnail_url: p.thumbnail_url || null, caption: p.caption || null }; }).catch(() => ({}));
      const client = mode === 'client';
      const shape = () => Object.assign({ enabled: true }, L.readShape(T.versions, { client, mainLink: T.versions[0].frame_url, cardStatus: status, card: CARD }));
      const reply = (o, s) => route.fulfill({ status: s || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list') return T.failList ? reply({ ok: false, error: 'read_failed' }, 500) : reply({ ok: true, cards: { rs1: shape() } });
      if (b.action === 'answer') {
        const res = L.answerPatches(T.versions, { stage: client ? 'client' : b.stage, kind: b.kind, letter: b.letter, note: b.note, cardStatus: status, part: b.part }, new Date().toISOString());
        if (res.error) return reply({ ok: false, error: res.error }, 400);
        for (const p of res.patches) Object.assign(T.versions.find(v => v.id === p.id), p.patch);
        return reply(Object.assign({ ok: true }, shape()));
      }
      return reply({ ok: false, error: 'unknown_action' }, 400);
    });
    if (mode === 'client') await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
    else if (mode === 'kasper') {
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
    if (x.layout2) await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
    else await waitNew(t);
    // Count today's approve per part on the client link (window._calReviewApprove, 190; 195 calls it through window).
    t.wrapped = await t.page.evaluate(() => {
      const real = window._calReviewApprove;
      if (typeof real !== 'function') return false;
      window._calReviewApprove = function (id, comp) { (window.__apr || (window.__apr = [])).push(id + '|' + comp); return real.apply(this, arguments); };
      return window._calReviewApprove !== real;
    });
    await sleep(1800);
    return t;
  }
  const look = t => t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot, fx = r.querySelector('.trv-fx');
    return { bar: ((r.querySelector('.trv') || {}).innerText || '').replace(/\s+/g, ' ').trim(), fx: !!fx, fxLetter: fx ? fx.dataset.trvFx : '',
      cap: fx ? (fx.querySelector('.trv-fx-cap') || {}).textContent : '', img: fx ? ((fx.querySelector('img') || {}).getAttribute && (fx.querySelector('img') || { getAttribute: () => '' }).getAttribute('src')) || '' : '',
      parts: [...r.querySelectorAll('[data-trv-part]')].map(b => b.dataset.trvPart + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(','),
      wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  // 688: the segments, and what the selected version's Thumbnail and Caption parts show (a step first, on one-part pages).
  const see = async (t, step) => {
    if (step) { await t.page.evaluate(k => { const st = document.getElementById('svReviewStage').shadowRoot.querySelector('.stp[data-step="' + k + '"]'); if (st) st.click(); }, step); await sleep(700); }
    return t.page.evaluate(() => {
      const r = document.getElementById('svReviewStage').shadowRoot, segs = [...r.querySelectorAll('.trs-s')], on = segs.find(b => b.getAttribute('aria-pressed') === 'true');
      const img = r.getElementById('bigthumbImg'), vis = e => !!e && e.getClientRects().length > 0;
      return { segs: segs.map(b => b.textContent.replace(/\s+/g, ' ').trim()).join(','), on: on ? (on.dataset.trvGo || on.dataset.trkGo) : '', fx: !!r.querySelector('.trv-fx'),
        tiles: r.querySelectorAll('.trk-v').length, thumb: vis(img) && !img.hidden ? img.getAttribute('src') || '' : '', thumbSrc: img ? img.getAttribute('src') || '' : '', thumbOk: !!img && img.complete && img.naturalWidth > 0,
        thumbHidden: !!img && img.hidden, caps: [...r.querySelectorAll('.tc-text')].filter(vis).map(e => e.textContent.trim()), text: r.textContent || '',
        chips: [...r.querySelectorAll('.trv-chip')].filter(vis).length, okVideo: ((r.querySelector('[data-ok="video"]') || {}).textContent || '').trim(),
        okGraphic: !!r.querySelector('[data-ok="graphic"]'), chgGraphic: !!r.querySelector('[data-chg="graphic"]'), wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
  };
  const waitFor = async (f, n) => { for (let i = 0; i < (n || 80) && !(await f()); i++) await sleep(100); return f(); };
  const parts = (t, n0) => { const out = {}; t.state.upserts.slice(n0).filter(u => u.id === 'rs1').forEach(u => ['video', 'graphic', 'caption'].forEach(k => { if (u[k + '_status']) out[k] = u[k + '_status']; })); return out; };

  try {
    // ---------- the client link: each version's own thumbnail and caption ----------
    let t = await start('client', true);
    let s = await see(t);
    ok(s.segs === 'Version A,Version B,Version C' && s.on === 'A' && !s.fx && /Approve Version A/.test(s.okVideo),
      'client: the versions are one segmented control, Version A first, with no separate thumbnail-and-caption block (' + s.segs + ' | ' + s.okVideo + ')');
    ok(s.chips >= 1, 'client: the trial card carries its "Trial" chip on the board (' + s.chips + ')');
    s = await see(t, 'graphic');
    const cardPic = s.thumb;
    ok(!!s.thumb && s.thumb !== B_THUMB && !s.okGraphic && s.chgGraphic, 'client: Version A\'s Thumbnail part shows the card\'s thumbnail, with its own Ask for a change and no second Approve');
    s = await see(t, 'caption');
    ok(s.caps.length === 1 && CARD_CAP.test(s.caps[0]), 'client: Version A\'s Caption part shows the card\'s caption, once (' + s.caps.length + ')');
    await see(t, 'video');
    await inS(t.page, '.trv [data-trv-go="B"]').click(); await sleep(600);
    s = await see(t);
    ok(s.on === 'B' && /Approve Version B/.test(s.okVideo), 'client: picking B selects Version B (' + s.okVideo + ')');
    s = await see(t, 'graphic');
    ok(s.thumbSrc === B_THUMB && s.thumbSrc !== cardPic, 'client: Version B\'s Thumbnail part shows its own thumbnail (' + s.thumbSrc.slice(0, 40) + ')');
    s = await see(t, 'caption');
    ok(s.caps.length === 1 && s.caps[0] === B_CAPTION && !CARD_CAP.test(s.text), 'client: Version B\'s Caption part shows its own caption, once, and the card\'s caption nowhere beside it');
    await see(t, 'video');
    // ---------- one Approve covers the version's parts: today's approve once per part ----------
    let n0 = t.state.upserts.length;
    await inS(t.page, '[data-trv-all]').click();
    await waitFor(async () => { const p = parts(t, n0); return p.video === 'Approved' && p.graphic === 'Approved' && p.caption === 'Approved'; }, 120);
    await sleep(1500);
    const apr = await t.page.evaluate(() => (window.__apr || []).slice());
    const p1 = parts(t, n0);
    ok(t.T.versions.every(v => v.status === 'approved') && p1.video === 'Approved' && p1.graphic === 'Approved' && p1.caption === 'Approved',
      'client: Approve all answers every version, then the video, thumbnail and caption parts all go to Approved (' + JSON.stringify(p1) + ')');
    ok(t.wrapped && ['rs1|video', 'rs1|graphic', 'rs1|caption'].every(k => apr.filter(x => x === k).length === 1) && apr.length === 3,
      'client: today\'s approve is called on each part exactly once (' + apr.join(',') + ')');
    ok(!t.errors.length, 'client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- Ask for a change picks the part: a thumbnail change reaches the graphic part ----------
    t = await start('client', true);
    await inS(t.page, '.trv [data-trv-go="C"]').click(); await sleep(600);
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="video"]').click(); await sleep(300);
    s = await look(t);
    ok(s.parts === 'video*,thumbnail,caption', 'client: the change box on Version C asks which part, Video first (' + s.parts + ')');
    await inS(t.page, '[data-trv-part="thumbnail"]').click(); await sleep(300);
    ok((await look(t)).parts === 'video,thumbnail*,caption', 'client: Thumbnail is picked');
    await inS(t.page, '#ta').fill('A brighter picture, please.');
    await inS(t.page, '#sendBtn').click();
    await waitFor(async () => t.state.upserts.slice(n0).some(u => /Version C, thumbnail: A brighter picture, please\./.test(String(u.graphic_tweaks || ''))) && t.T.versions[2].status === 'change asked');
    const sent = t.state.upserts.slice(n0);
    ok(t.T.calls.some(c => c.action === 'answer' && c.kind === 'change' && c.letter === 'C' && c.part === 'thumbnail') && t.T.versions[2].change_part === 'thumbnail',
      'client: the change is stored on Video C with its part, thumbnail');
    ok(sent.some(u => /Version C, thumbnail: A brighter picture, please\./.test(String(u.graphic_tweaks || ''))) && !sent.some(u => /A brighter picture/.test(String(u.video_tweaks || ''))),
      'client: today\'s change request goes on the card\'s graphic part, "Version C, thumbnail: ...", not the video\'s');
    ok(!sent.some(u => u.graphic_status === 'Tweaks Needed' || u.video_status === 'Tweaks Needed'), 'client: and the card keeps its status while other versions wait');
    // Codex on #2571: the client's change queue watches the part the change was saved on, so it never hands the words back.
    await sleep(1200);
    const box = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot, ta = r.getElementById('ta');
      return { back: /Not sent/.test(r.textContent || '') || /Not sent/.test(document.body.innerText || ''), words: ta ? ta.value : '' }; });
    ok(!box.back && !/brighter picture/i.test(box.words), 'client: the words are not handed back as "Not sent" (' + JSON.stringify(box) + ')');
    ok(!t.errors.length, 'client change: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- 688: the Thumbnail part's own Ask for a change goes on the selected version, with its part ----------
    t = await start('client', true);
    await inS(t.page, '.trv [data-trv-go="C"]').click(); await sleep(600);
    await see(t, 'graphic');
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="graphic"]').click(); await sleep(400);
    await inS(t.page, '#ta').fill('Warmer colours, please.');
    await inS(t.page, '#sendBtn').click();
    await waitFor(async () => t.state.upserts.slice(n0).some(u => /Version C, thumbnail: Warmer colours, please\./.test(String(u.graphic_tweaks || ''))) && t.T.versions[2].status === 'change asked');
    const pSent = t.state.upserts.slice(n0);
    ok(t.T.calls.some(c => c.action === 'answer' && c.kind === 'change' && c.letter === 'C' && c.part === 'thumbnail') && t.T.versions[2].change_part === 'thumbnail'
      && pSent.some(u => /Version C, thumbnail: Warmer colours, please\./.test(String(u.graphic_tweaks || ''))) && !pSent.some(u => /Warmer colours/.test(String(u.video_tweaks || ''))),
      'client: the Thumbnail part\'s Ask for a change on Version C is stored on C with its part and reaches the graphic part as "Version C, thumbnail: ..."');
    await sleep(600);
    s = await see(t);
    ok(t.T.versions[1].status === 'waiting' && t.T.versions[0].status === 'waiting', 'client: the other versions keep their own state');
    s = await see(t, 'graphic');
    ok(/Change asked on Version C's thumbnail/.test(s.text), 'client: Version C\'s Thumbnail part then reads "Change asked on Version C\'s thumbnail"');
    ok(!t.errors.length, 'client part change: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- the same change with the client page's polish on: its queue watches the graphic part (Codex on #2571) ----------
    t = await start('client', true, { polish: true });
    await inS(t.page, '.trv [data-trv-go="C"]').click(); await sleep(600);
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="video"]').click(); await sleep(300);
    await inS(t.page, '[data-trv-part="caption"]').click(); await sleep(300);
    await inS(t.page, '#ta').fill('Shorter first line, please.');
    await inS(t.page, '#sendBtn').click();
    await waitFor(async () => t.state.upserts.slice(n0).some(u => /Version C, caption: Shorter first line, please\./.test(String(u.caption_tweaks || ''))));
    await sleep(1500);
    const cpBox = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot, ta = r.getElementById('ta');
      return { back: /Not sent/.test(r.textContent || '') || /Not sent/.test(document.body.innerText || ''), words: ta ? ta.value : '' }; });
    const cpSent = t.state.upserts.slice(n0);
    ok(cpSent.some(u => /Version C, caption: Shorter first line, please\./.test(String(u.caption_tweaks || ''))) && t.T.versions[2].change_part === 'caption',
      'client polish: a caption change on Video C goes on the caption part and is stored with its part');
    ok(!cpBox.back && !/Shorter first line/.test(cpBox.words) && cpSent.filter(u => /Shorter first line/.test(String(u.caption_tweaks || '') + String(u.video_tweaks || ''))).length >= 1
      && !cpSent.some(u => /Shorter first line/.test(String(u.video_tweaks || ''))),
      'client polish: the queue watches the caption part, so the words are never handed back as "Not sent" (' + JSON.stringify(cpBox) + ')');
    ok(!t.errors.length, 'client polish: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a Drive file page as a version's own thumbnail, and a picture that does not load (V4 live walk, 3 Nov) ----------
    t = await start('client', true, { thumbs: { C: DRIVE }, brokenPics: true });
    await inS(t.page, '.trv [data-trv-go="C"]').click(); await sleep(900);
    const dv = await see(t, 'graphic'), drv = { src: dv.thumb, loaded: dv.thumbOk };
    ok(/^https:\/\/lh3\.googleusercontent\.com\/d\/FixtureDriveFile123=w\d+/.test(drv.src) && drv.loaded,
      'a Drive file page as Video C\'s own thumbnail shows as its image, the way the card shows its own (' + drv.src.slice(0, 48) + ')');
    await see(t, 'video');
    await inS(t.page, '.trv [data-trv-go="B"]').click(); await sleep(600);
    const bk = await see(t, 'graphic'); await sleep(900);
    const brk = await t.page.evaluate(() => { const i = document.getElementById('svReviewStage').shadowRoot.getElementById('bigthumbImg'); return { hidden: !!i && i.hidden, broken: !!i && !i.hidden && i.complete && i.naturalWidth === 0 }; });
    ok(brk.hidden && !brk.broken, 'a version\'s thumbnail that does not load leaves the Thumbnail part empty, never a broken image (' + JSON.stringify(brk) + ')');
    ok(!t.errors.length, 'thumbnails: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a failed versions read falls back to today's page ----------
    t = await start('client', true, { failList: true });
    s = await look(t);
    const okWord = ((await t.page.evaluate(() => (document.getElementById('svReviewStage').shadowRoot.querySelector('[data-ok="video"]') || {}).textContent || '')) || '').trim();
    ok(!s.bar && !s.fx && /Approve the video/.test(okWord), 'a failed versions read: today\'s page, no versions, no fields (' + okWord + ')');
    await t.ctx.close();

    // ---------- the switch off for this client: today's trial page exactly ----------
    t = await start('client', false);
    s = await look(t);
    ok(/Video A of 3/.test(s.bar) && !s.fx, 'switch off: the versions as today, no thumbnail and caption block (' + s.bar + ')');
    await inS(t.page, '[data-chg="video"]').click(); await sleep(300);
    ok(!(await look(t)).parts, 'switch off: no part picker in the change box');
    await inS(t.page, '#cmpCancel, #chipX').first().click().catch(() => {});
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-trv-all]').click();
    await waitFor(async () => parts(t, n0).video === 'Approved', 120);
    await sleep(1500);
    const off = parts(t, n0), offApr = await t.page.evaluate(() => (window.__apr || []).slice());
    ok(off.video === 'Approved' && !off.graphic && !off.caption && offApr.join() === 'rs1|video', 'switch off: Approve all approves the video only, as today (' + JSON.stringify(off) + ' ' + offApr.join() + ')');
    await t.ctx.close();

    // ---------- the SMM's Review tab ----------
    t = await start('smm', true);
    await inS(t.page, '.trv [data-trv-go="B"]').click(); await sleep(600);
    s = await see(t, 'caption');
    ok(s.caps.length === 1 && s.caps[0] === B_CAPTION && !s.fx && s.chips >= 1, 'SMM: Version B\'s Caption part shows its own caption, once, and the board shows the Trial chip');
    await see(t, 'video');
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-trv-all]').click();
    await waitFor(async () => { const p = parts(t, n0); return p.video === 'Kasper Approval' && p.graphic === 'Kasper Approval' && p.caption === 'Kasper Approval'; }, 150);
    const p2 = parts(t, n0);
    ok(p2.video === 'Kasper Approval' && p2.graphic === 'Kasper Approval' && p2.caption === 'Kasper Approval', 'SMM: Approve all moves the video, thumbnail and caption on to Kasper (' + JSON.stringify(p2) + ')');
    ok(!t.errors.length, 'SMM: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- Kasper's second layout: each tile shows its version's thumbnail ----------
    t = await start('kasper', true, { layout2: true });
    let k = await see(t);
    ok(k.segs === 'Version A,Version B,Version C' && !k.tiles && !k.fx && k.chips >= 1, 'Kasper: the versions are one segmented control in place of the tiles, no separate block, the Trial chip on his list (' + k.segs + ', ' + k.tiles + ' tiles)');
    ok(k.caps.length === 1 && CARD_CAP.test(k.caps[0]) && !!k.thumb && k.thumb !== B_THUMB, 'Kasper: Version A\'s three parts, each once, the card\'s thumbnail and caption');
    await inS(t.page, '.trs [data-trk-go="B"]').click(); await sleep(900);
    k = await see(t);
    const kOk = await t.page.evaluate(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('.trs-acts [data-trk-ok="B"]'));
    ok(k.on === 'B' && k.thumbSrc === B_THUMB && k.caps.length === 1 && k.caps[0] === B_CAPTION && !CARD_CAP.test(k.text) && kOk,
      'Kasper: picking B shows Version B\'s own thumbnail and caption, each once, no card caption beside it, and B\'s own Approve');
    ok(!t.errors.length, 'Kasper: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a phone ----------
    t = await start('client', true, { width: 390 });
    s = await see(t);
    ok(s.segs === 'Version A,Version B,Version C' && !s.wide, 'phone (390): the segmented control shows, and nothing scrolls sideways');
    s = await see(t, 'caption');
    ok(s.caps.length === 1 && CARD_CAP.test(s.caps[0]) && !s.wide, 'phone (390): the caption part shows once, nothing sideways');
    await t.ctx.close();
  } catch (e) {
    failures.push(String(e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\ntrial-version-review-parts-browser (' + ENGINE + '): ' + passed + ' passed, ' + failures.length + ' failed');
  process.exit(failures.length ? 1 : 0);
})();
