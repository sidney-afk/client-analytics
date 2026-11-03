'use strict';
/*
 * V4 (plan docs/plans/2026-11-trial-and-posting/combined.md row V4): the review page with trial versions that carry their
 * own thumbnail and caption (behind trial_versions_v2), in a real browser, fully offline, on the shared review fixture
 * (fictional clients, cards and tokens). The trial-reels function is answered by its own rules (logic.mjs). Proves:
 *   - each version shows its own thumbnail and caption under its player (else the card's), on the client link, the
 *     SMM's Review tab and Kasper's second layout (its tiles show each version's thumbnail);
 *   - one Approve covers the version's parts: approving every version calls today's approve on the video, the
 *     thumbnail and the caption exactly once each (the client), and moves all three parts on (the SMM);
 *   - Ask for a change picks the part: a thumbnail change is stored on the version with its part and reaches the card's
 *     graphic part as today's change request ("Video C, thumbnail: ..."), never the video's;
 *   - a failed versions read falls back to today's page;
 *   - with the switch off, today's trial page exactly: no fields, no part picker, and Approve all approves the video only;
 *   - at 390 wide nothing scrolls sideways; no page errors anywhere.
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
const B_THUMB = 'https://e.example/fixture-version-b-thumb.jpg';
const B_CAPTION = 'Version B words, fictional.';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const fresh = () => ['A', 'B', 'C'].map(l => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0, updated_at: '2026-11-03T09:00:00.000Z',
    smm_ok_at: null, kasper_ok_at: null, client_ok_at: null, client_pass_at: null, change_by: null, change_note: null, change_at: null, change_part: null,
    thumbnail_url: l === 'B' ? B_THUMB : null, caption: l === 'B' ? B_CAPTION : null }));

  async function start(mode, v2, extra) {
    const x = extra || {};
    const T = { versions: fresh(), calls: [], failList: !!x.failList };
    if (mode !== 'smm') T.versions.forEach(v => { v.smm_ok_at = '2026-11-03T08:00:00.000Z'; if (mode === 'client') v.kasper_ok_at = '2026-11-03T08:10:00.000Z'; });
    const flagValues = { trial_reels_pages: { clients: [SLUG] }, trial_versions_v2: { clients: v2 ? [SLUG] : ['someotherclient'] } };
    if (x.layout2) flagValues.review_stage_kasper_layout2 = { all: true };
    const t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', flagValues, linkedParts: true }, x.polish ? { polish: true } : {}, mode !== 'client' ? { staff: STAFF } : {}, x.width ? { width: x.width, height: 844 } : {}));
    t.T = T;
    const status = mode === 'smm' ? 'For SMM Approval' : mode === 'kasper' ? 'Kasper Approval' : 'Client Approval';
    let CARD = null;
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
  const waitFor = async (f, n) => { for (let i = 0; i < (n || 80) && !(await f()); i++) await sleep(100); return f(); };
  const parts = (t, n0) => { const out = {}; t.state.upserts.slice(n0).filter(u => u.id === 'rs1').forEach(u => ['video', 'graphic', 'caption'].forEach(k => { if (u[k + '_status']) out[k] = u[k + '_status']; })); return out; };

  try {
    // ---------- the client link: each version's own thumbnail and caption ----------
    let t = await start('client', true);
    let s = await look(t);
    ok(s.fx && s.fxLetter === 'A' && /Most people decide in the first second/.test(s.cap) && !!s.img, 'client: Video A shows the card\'s thumbnail and caption under its player (' + s.cap.slice(0, 30) + ')');
    await inS(t.page, '.trv [data-trv-go="B"]').click(); await sleep(600);
    s = await look(t);
    ok(s.fxLetter === 'B' && s.cap === B_CAPTION && s.img === B_THUMB, 'client: Video B shows its own thumbnail and caption');
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
    ok(s.parts === 'video*,thumbnail,caption', 'client: the change box on Video C asks which part, Video first (' + s.parts + ')');
    await inS(t.page, '[data-trv-part="thumbnail"]').click(); await sleep(300);
    ok((await look(t)).parts === 'video,thumbnail*,caption', 'client: Thumbnail is picked');
    await inS(t.page, '#ta').fill('A brighter picture, please.');
    await inS(t.page, '#sendBtn').click();
    await waitFor(async () => t.state.upserts.slice(n0).some(u => /Video C, thumbnail: A brighter picture, please\./.test(String(u.graphic_tweaks || ''))) && t.T.versions[2].status === 'change asked');
    const sent = t.state.upserts.slice(n0);
    ok(t.T.calls.some(c => c.action === 'answer' && c.kind === 'change' && c.letter === 'C' && c.part === 'thumbnail') && t.T.versions[2].change_part === 'thumbnail',
      'client: the change is stored on Video C with its part, thumbnail');
    ok(sent.some(u => /Video C, thumbnail: A brighter picture, please\./.test(String(u.graphic_tweaks || ''))) && !sent.some(u => /A brighter picture/.test(String(u.video_tweaks || ''))),
      'client: today\'s change request goes on the card\'s graphic part, "Video C, thumbnail: ...", not the video\'s');
    ok(!sent.some(u => u.graphic_status === 'Tweaks Needed' || u.video_status === 'Tweaks Needed'), 'client: and the card keeps its status while other versions wait');
    // Codex on #2571: the client's change queue watches the part the change was saved on, so it never hands the words back.
    await sleep(1200);
    const box = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot, ta = r.getElementById('ta');
      return { back: /Not sent/.test(r.textContent || '') || /Not sent/.test(document.body.innerText || ''), words: ta ? ta.value : '' }; });
    ok(!box.back && !/brighter picture/i.test(box.words), 'client: the words are not handed back as "Not sent" (' + JSON.stringify(box) + ')');
    ok(!t.errors.length, 'client change: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- the same change with the client page's polish on: its queue watches the graphic part (Codex on #2571) ----------
    t = await start('client', true, { polish: true });
    await inS(t.page, '.trv [data-trv-go="C"]').click(); await sleep(600);
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="video"]').click(); await sleep(300);
    await inS(t.page, '[data-trv-part="caption"]').click(); await sleep(300);
    await inS(t.page, '#ta').fill('Shorter first line, please.');
    await inS(t.page, '#sendBtn').click();
    await waitFor(async () => t.state.upserts.slice(n0).some(u => /Video C, caption: Shorter first line, please\./.test(String(u.caption_tweaks || ''))));
    await sleep(1500);
    const cpBox = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot, ta = r.getElementById('ta');
      return { back: /Not sent/.test(r.textContent || '') || /Not sent/.test(document.body.innerText || ''), words: ta ? ta.value : '' }; });
    const cpSent = t.state.upserts.slice(n0);
    ok(cpSent.some(u => /Video C, caption: Shorter first line, please\./.test(String(u.caption_tweaks || ''))) && t.T.versions[2].change_part === 'caption',
      'client polish: a caption change on Video C goes on the caption part and is stored with its part');
    ok(!cpBox.back && !/Shorter first line/.test(cpBox.words) && cpSent.filter(u => /Shorter first line/.test(String(u.caption_tweaks || '') + String(u.video_tweaks || ''))).length >= 1
      && !cpSent.some(u => /Shorter first line/.test(String(u.video_tweaks || ''))),
      'client polish: the queue watches the caption part, so the words are never handed back as "Not sent" (' + JSON.stringify(cpBox) + ')');
    ok(!t.errors.length, 'client polish: no page errors (' + t.errors.join(' | ') + ')');
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
    s = await look(t);
    ok(s.fxLetter === 'B' && s.cap === B_CAPTION, 'SMM: Video B shows its own caption');
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-trv-all]').click();
    await waitFor(async () => { const p = parts(t, n0); return p.video === 'Kasper Approval' && p.graphic === 'Kasper Approval' && p.caption === 'Kasper Approval'; }, 150);
    const p2 = parts(t, n0);
    ok(p2.video === 'Kasper Approval' && p2.graphic === 'Kasper Approval' && p2.caption === 'Kasper Approval', 'SMM: Approve all moves the video, thumbnail and caption on to Kasper (' + JSON.stringify(p2) + ')');
    ok(!t.errors.length, 'SMM: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- Kasper's second layout: each tile shows its version's thumbnail ----------
    t = await start('kasper', true, { layout2: true });
    const k = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot;
      return { pics: [...r.querySelectorAll('.trk-v .trk-pic img')].map(i => i.getAttribute('src')), fx: !!r.querySelector('.trk .trv-fx') }; });
    ok(k.pics.length === 3 && k.pics[1] === B_THUMB && k.pics[0] !== B_THUMB && k.fx, 'Kasper: each tile shows its version\'s thumbnail, and the version on stage its thumbnail and caption (' + k.pics.length + ')');
    ok(!t.errors.length, 'Kasper: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a phone ----------
    t = await start('client', true, { width: 390 });
    s = await look(t);
    ok(s.fx && !s.wide, 'phone (390): the thumbnail and caption show, and nothing scrolls sideways');
    await t.ctx.close();
  } catch (e) {
    failures.push(String(e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\ntrial-version-review-parts-browser: ' + passed + ' passed, ' + failures.length + ' failed');
  process.exit(failures.length ? 1 : 0);
})();
