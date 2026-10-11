'use strict';
/*
 * Generate caption off n8n: the Calendar page in a real browser, fully offline (every backend answer is local).
 *
 *   SWITCH OFF (no caption_generate_ef_clients row, the default): Generate behaves exactly as before. A card with a
 *     Frame.io link calls the n8n generate-caption webhook with the same five keys; the caption-generate function is
 *     never called; a card with no video keeps a disabled Generate and no transcript box exists.
 *   SWITCH ON for the client: a card with a video still generates in one click, now on the function, with the staff
 *     headers and zero n8n calls. A card with no video: Generate opens the transcript box, its button stays disabled
 *     until text is pasted, and the caption is written from it. A card with a video also offers an optional
 *     Transcript pill whose text rides along with the video.
 *   PHONE (390 x 844, touch): the same, with the transcript box as a bottom sheet.
 *   QUEUED CARD TYPED INTO: bulk Generate on three cards runs two at a time; a caption typed and saved on the third
 *     while it waits in the queue is kept, and caption-generate is never called for that card.
 *
 * Set CAPTION_SHOT_DIR to save before/after screenshots there. The client shown defaults to a fixture; a proof run
 * can name another with CAPTION_SHOT_SLUG and CAPTION_SHOT_NAME (nothing is sent anywhere either way).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const SLUG = process.env.CAPTION_SHOT_SLUG || 'fixtureclient';
const NAME = process.env.CAPTION_SHOT_NAME || 'Fixture Client';
const SHOTS = process.env.CAPTION_SHOT_DIR || '';
const FRAME = 'https://f.io/fixture-video';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const card = (id, name, assetUrl, order) => ({
  id, client: SLUG, name, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: '', cta: '', thumbnail_url: '', asset_url: assetUrl,
  video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [],
});

async function open(browser, origin, opts) {
  const state = {
    flag: opts.flag, cards: opts.cards || [card('v1', 'Video card', FRAME, 1), card('v2', 'Video card with notes', FRAME, 2), card('n1', 'No video card', '', 3), card('d1', 'Drive link card', 'https://drive.google.com/file/d/fixture/view', 4)],
    n8n: [], ef: [], jobs: new Map(), saves: [], efDoneMs: opts.efDoneMs || 1200,
  };
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, opts.device));
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (/n8n\.cloud$/.test(u.hostname)) {
      if (p === '/webhook/generate-caption') {
        const body = JSON.parse(r.postData() || '{}');
        state.n8n.push(body);
        await sleep(400);
        const row = state.cards.find(c => c.id === body.postId); if (row) row.caption = 'Caption from n8n';
        return json({ ok: true, caption: 'Caption from n8n', jobId: body.jobId });
      }
      return json({ ok: true, prompts: {} });
    }
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/caption-generate' && r.method() === 'POST') {
      const body = JSON.parse(r.postData() || '{}');
      state.ef.push({ body, key: r.headers()['x-syncview-key'] || '' });
      const now = () => new Date().toISOString();
      state.jobs.set(body.jobId, { jobId: body.jobId, client: body.client, postId: body.postId, status: 'running', stage: body.assetUrl ? 'scraping' : 'writing', caption: '', error: '', cancel_requested: false, updated_at: now() });
      setTimeout(() => {
        const caption = body.transcript ? 'Caption written from the pasted transcript' : 'Caption written by the function';
        Object.assign(state.jobs.get(body.jobId), { status: 'done', stage: 'done', caption, updated_at: now() });
        const row = state.cards.find(c => c.id === body.postId); if (row) row.caption = caption;
      }, state.efDoneMs);
      return json({ ok: true, accepted: true, jobId: body.jobId });
    }
    if (p === '/functions/v1/caption-jobs') {
      return json({ ok: true, jobs: Array.from(state.jobs.values()).filter(j => j.client === sp.get('client')) });
    }
    if (r.method() === 'POST') {
      // Any card save (calendar-upsert or the write gateway): note the caption it carries.
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
      const post = body && (body.post || (body.payload && body.payload.post));
      if (post && post.id && Object.prototype.hasOwnProperty.call(post, 'caption')) {
        state.saves.push({ path: p, id: post.id, caption: post.caption });
        const row = state.cards.find(c => c.id === post.id); if (row) row.caption = post.caption;
      }
      return json({ ok: true });
    }
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/caption_prompts') return json([{ client_slug: SLUG, prompt: 'Fixture caption prompt' }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      const rows = [];
      for (const k of keys) {
        if (k === 'caption_generate_ef_clients') { if (state.flag) rows.push({ key: k, value: state.flag }); continue; }
        rows.push({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) });
      }
      return json(rows);
    }
    if (p === '/rest/v1/calendar_posts') {
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(state.cards.filter(c => !one || c.id === one));
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [NAME]);
  await page.waitForSelector('.cal-card[data-pid="n1"]', { timeout: 20000 });
  await sleep(1500);   // the switch read and the button repaint
  return { page, ctx, state, pageErrors };
}

const sel = (pid, cls) => `.cal-card[data-pid="${pid}"] .cal-cap-wrap[data-capwrap="main"] ${cls}`;
async function shot(page, name, pid) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  if (pid) await page.evaluate(id => document.querySelector(`.cal-card[data-pid="${id}"]`).scrollIntoView({ block: 'center', inline: 'center' }), pid);
  await sleep(250);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function captionOf(page, pid) { return page.evaluate(id => (document.querySelector(`.cal-card[data-pid="${id}"] textarea[data-fld="caption"]`) || {}).value || '', pid); }
async function waitCaption(page, pid, ms) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) { const v = await captionOf(page, pid); if (v) return v; await sleep(250); }
  return '';
}
const modalOpen = page => page.evaluate(() => !!document.querySelector('#calPromptOverlay.open #calTxTA'));

async function runDesktopOrPhone(browser, origin, label, device) {
  const prefix = label === 'phone' ? 'iphone' : 'desktop';

  // ---------- BEFORE: switch off (the default) ----------
  console.log(`--- ${label}: switch off (default, n8n) ---`);
  let t = await open(browser, origin, { flag: null, device });
  expect(await t.page.locator(sel('n1', '.cal-cap-gen')).isDisabled(), `${label} off: a card with no video keeps a disabled Generate`);
  expect(await t.page.locator(sel('v1', '.cal-cap-tx')).count() === 0, `${label} off: no Transcript pill`);
  await shot(t.page, `before-${prefix}`, 'v1');
  await t.page.locator(sel('v1', '.cal-cap-gen')).click();
  const offCaption = await waitCaption(t.page, 'v1');
  expect(offCaption === 'Caption from n8n', `${label} off: Generate writes the caption through n8n (${offCaption})`);
  expect(t.state.n8n.length === 1 && t.state.ef.length === 0, `${label} off: one n8n call, zero function calls`);
  expect(t.state.n8n[0] && Object.keys(t.state.n8n[0]).sort().join(',') === 'assetUrl,captionPrompt,client,jobId,postId'
    && t.state.n8n[0].client === SLUG && t.state.n8n[0].assetUrl === FRAME && t.state.n8n[0].captionPrompt === 'Fixture caption prompt',
    `${label} off: the n8n body is the same five keys as before`);
  await t.page.evaluate(() => _calGenerateCaption('n1'));
  await sleep(300);
  expect(!(await modalOpen(t.page)), `${label} off: no transcript box`);
  expect(t.state.n8n.length === 1 && t.state.ef.length === 0, `${label} off: a card with no video sends nothing`);
  await shot(t.page, `before-${prefix}-done`, 'v1');
  expect(t.pageErrors.length === 0, `${label} off: no page errors (${t.pageErrors.join(' | ')})`);
  await t.ctx.close();

  // ---------- AFTER: switch on for this client ----------
  console.log(`--- ${label}: switch on for the client (function) ---`);
  t = await open(browser, origin, { flag: { clients: [SLUG] }, device });
  expect(!(await t.page.locator(sel('n1', '.cal-cap-gen')).isDisabled()), `${label} on: Generate is enabled on a card with no video`);
  expect(await t.page.locator(sel('v2', '.cal-cap-tx')).count() === 1 && await t.page.locator(sel('n1', '.cal-cap-tx')).count() === 0,
    `${label} on: the optional Transcript pill shows on video cards only`);
  await shot(t.page, `after-${prefix}`, 'v2');

  // 1. Video card, one click, as before but on the function.
  await t.page.locator(sel('v1', '.cal-cap-gen')).click();
  await sleep(300);
  expect(!(await modalOpen(t.page)), `${label} on: a video card generates in one click (no box)`);
  let v = await waitCaption(t.page, 'v1');
  expect(v === 'Caption written by the function', `${label} on: the video card's caption comes from the function (${v})`);
  const e1 = t.state.ef[0] || { body: {} };
  expect(t.state.n8n.length === 0 && e1.body.assetUrl === FRAME && e1.body.transcript === '' && e1.body.client === SLUG && e1.body.captionPrompt === 'Fixture caption prompt',
    `${label} on: zero n8n calls; the function got the video link, the client and its prompt`);
  expect(!!e1.key, `${label} on: the function call carries the staff key`);

  // 2. No video: Generate opens the transcript box.
  await t.page.locator(sel('n1', '.cal-cap-gen')).click();
  await t.page.waitForSelector('#calPromptOverlay.open #calTxTA', { timeout: 5000 });
  expect(await t.page.locator('#calTxGo').isDisabled(), `${label} on: the box's Generate waits for text`);
  await t.page.fill('#calTxTA', 'Today I want to talk about why rest is part of the work, not a reward for finishing it.');
  expect(!(await t.page.locator('#calTxGo').isDisabled()), `${label} on: pasting text enables it`);
  await shot(t.page, `after-${prefix}-transcript-box`);
  await t.page.locator('#calTxGo').click();
  await sleep(200);
  expect(!(await modalOpen(t.page)), `${label} on: the box closes on Generate`);
  v = await waitCaption(t.page, 'n1');
  expect(v === 'Caption written from the pasted transcript', `${label} on: the no-video card's caption is written from the transcript (${v})`);
  const e2 = t.state.ef[1] || { body: {} };
  expect(e2.body.postId === 'n1' && e2.body.assetUrl === '' && /rest is part of the work/.test(e2.body.transcript || ''), `${label} on: the function got the transcript and no video link`);

  // 3. Video + optional transcript.
  await t.page.locator(sel('v2', '.cal-cap-tx')).click();
  await t.page.waitForSelector('#calPromptOverlay.open #calTxTA', { timeout: 5000 });
  expect(!(await t.page.locator('#calTxGo').isDisabled()), `${label} on: with a video the transcript is optional (button enabled while empty)`);
  await t.page.fill('#calTxTA', 'Notes: keep the line about Sunday walks.');
  await shot(t.page, `after-${prefix}-optional-box`);
  await t.page.locator('#calTxGo').click();
  v = await waitCaption(t.page, 'v2');
  const e3 = t.state.ef[2] || { body: {} };
  expect(e3.body.postId === 'v2' && e3.body.assetUrl === FRAME && /Sunday walks/.test(e3.body.transcript || ''), `${label} on: the video link and the pasted notes go together`);
  expect(t.state.n8n.length === 0, `${label} on: still zero n8n calls`);
  await shot(t.page, `after-${prefix}-done`, 'n1');

  // 4. A non Frame.io link: the box does not claim there is no video.
  await t.page.locator(sel('d1', '.cal-cap-gen')).click();
  await t.page.waitForSelector('#calPromptOverlay.open #calTxTA', { timeout: 5000 });
  const lead = await t.page.evaluate(() => document.querySelector('#calPromptModal .cal-prompt-head-text p').textContent);
  expect(/not a Frame\.io link/.test(lead) && !/no video linked/.test(lead), `${label} on: a Drive link is called out as not Frame.io (${lead})`);

  // 5. Closing with pasted text asks first; Cancel in the confirm keeps the text; Discard closes.
  await t.page.fill('#calTxTA', 'Some pasted words');
  await t.page.locator('#calPromptModal .cal-prompt-btn:not(.is-primary)').click();
  await sleep(200);
  expect(await t.page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active')) && await modalOpen(t.page),
    `${label} on: closing with pasted text asks first and keeps the box open`);
  await shot(t.page, `after-${prefix}-discard-confirm`);
  await t.page.evaluate(() => document.getElementById('confirmYes').click());
  await sleep(200);
  expect(!(await modalOpen(t.page)), `${label} on: Discard closes the box`);
  await t.page.locator(sel('d1', '.cal-cap-gen')).click();
  await t.page.waitForSelector('#calPromptOverlay.open #calTxTA', { timeout: 5000 });
  await t.page.keyboard.press('Escape');
  await sleep(200);
  expect(!(await modalOpen(t.page)), `${label} on: an empty box closes without asking`);

  // 6. The Transcript pill never sits on the "Show more" toggle (desktop), and on a phone it hides once a caption exists.
  if (label === 'desktop') {
    const overlap = await t.page.evaluate(sel => {
      const wrap = document.querySelector(sel);
      const toggle = wrap.querySelector('.cal-cap-toggle'); const tx = wrap.querySelector('.cal-cap-tx');
      toggle.hidden = false;
      const a = toggle.getBoundingClientRect(), b = tx.getBoundingClientRect();
      return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    }, '.cal-card[data-pid="v1"] .cal-cap-wrap[data-capwrap="main"]'.replace('v1', 'v2'));
    expect(!overlap, `${label} on: the Transcript pill and the Show more toggle do not overlap`);
  } else {
    // v2 got a caption from step 3; the pill must be hidden next to it.
    const shown = await t.page.evaluate(() => {
      const tx = document.querySelector('.cal-card[data-pid="v2"] .cal-cap-tx');
      return tx ? getComputedStyle(tx).display !== 'none' : 'missing';
    });
    expect(shown === false, `${label} on: with a caption in the box the Transcript pill is hidden (${shown})`);
  }
  expect(t.pageErrors.length === 0, `${label} on: no page errors (${t.pageErrors.join(' | ')})`);
  await t.ctx.close();
}

// A caption typed and saved on a card that is still waiting in the bulk queue must win: the queued job is
// dropped before it is sent, so the function never writes over it.
async function runQueuedTypedCaption(browser, origin) {
  console.log('--- desktop: bulk Generate, a queued card gets a typed caption ---');
  const t = await open(browser, origin, {
    flag: { clients: [SLUG] }, device: { viewport: { width: 1440, height: 900 } }, efDoneMs: 6000,
    cards: [card('b1', 'Bulk card one', FRAME, 1), card('b2', 'Bulk card two', FRAME, 2), card('b3', 'Bulk card three', FRAME, 3), card('n1', 'No video card', '', 4)],
  });
  await t.page.evaluate(() => { calState.selected = new Set(['b1', 'b2', 'b3']); _calBulkGenerateCaptions(); });
  const end = Date.now() + 10000;
  while (Date.now() < end && t.state.ef.length < 2) await sleep(100);
  const queued = await t.page.evaluate(() => { const j = _calCaptionJobs.get('b3'); return j ? j.status + (j.posted ? ':posted' : '') : 'none'; });
  expect(t.state.ef.length === 2 && queued === 'queued', `queued: two cards run at once, the third waits (${t.state.ef.length} sent, b3 ${queued})`);
  const typed = 'Typed by hand while the others were generating.';
  const ta = t.page.locator('.cal-card[data-pid="b3"] textarea[data-fld="caption"]');
  await ta.click();
  await ta.fill(typed);
  await t.page.evaluate(() => document.activeElement && document.activeElement.blur());
  const saveEnd = Date.now() + 10000;
  while (Date.now() < saveEnd && !t.state.saves.some(s => s.id === 'b3' && s.caption === typed)) await sleep(100);
  expect(t.state.saves.some(s => s.id === 'b3' && s.caption === typed), 'queued: the typed caption autosaves while the card waits');
  // Let both running jobs finish and the queue move on.
  const doneEnd = Date.now() + 20000;
  while (Date.now() < doneEnd) {
    const left = await t.page.evaluate(() => _calCapJobsActiveList().length);
    if (!left) break;
    await sleep(250);
  }
  await sleep(1500);
  const sentB3 = t.state.ef.filter(e => e.body.postId === 'b3').length;
  expect(sentB3 === 0, `queued: caption-generate is never called for the card that got a typed caption (${sentB3} call(s))`);
  expect(t.state.ef.length === 2, `queued: only the two empty cards were sent (${t.state.ef.map(e => e.body.postId).join(',')})`);
  expect(await captionOf(t.page, 'b3') === typed, 'queued: the typed caption is still in the box');
  expect(!t.state.saves.some(s => s.id === 'b3' && s.caption && s.caption !== typed), 'queued: nothing else was saved over it');
  const b1 = await captionOf(t.page, 'b1'), b2 = await captionOf(t.page, 'b2');
  expect(b1 === 'Caption written by the function' && b2 === 'Caption written by the function', `queued: the two empty cards still got their captions (${b1} | ${b2})`);
  expect(t.pageErrors.length === 0, `queued: no page errors (${t.pageErrors.join(' | ')})`);
  await t.ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await runDesktopOrPhone(browser, origin, 'desktop', { viewport: { width: 1440, height: 900 } });
    await runDesktopOrPhone(browser, origin, 'phone', {
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    await runQueuedTypedCaption(browser, origin);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\ncaption-generate-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
