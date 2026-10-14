'use strict';
/*
 * Caption helper in a real browser, fully offline (every backend answer is local):
 *   THE BOX      Generate opens the box on the function path: platform (Instagram by default), the client's own call to
 *                action choices ("Let the AI choose" by default) and a note. What is chosen goes to the function.
 *                A client with no choices gets the note box only.
 *   THE PANEL    The title ideas (best one marked), the hashtags and copy buttons sit under the caption, never in it.
 *                "Use this title" fills the card's title.
 *   REDO         A note or a quick pick re-runs from the current caption. The new caption replaces the box only while
 *                the box still holds the caption the redo started from; a caption typed meanwhile is kept and the new
 *                version waits for a click.
 * Run at 1440 wide and at 390 wide, in light and dark. Set CAPTION_SHOT_DIR to save screenshots there.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const NAME = 'Fixture Client';
const SHOTS = process.env.CAPTION_SHOT_DIR || '';
const FRAME = 'https://f.io/fixture-video';
const CTAS = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'OMEGA', 'SIGMA'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const card = (id, name, assetUrl, order, caption) => ({
  id, client: SLUG, name, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: caption || '', cta: '', thumbnail_url: '', asset_url: assetUrl,
  video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [],
});
const TITLES = ['Rest is part of the work', 'Why I stopped earning my breaks', 'The Sunday rule', 'Work needs rest', 'Slow is a plan'];

async function open(browser, origin, opts) {
  const state = {
    ctas: opts.ctas === undefined ? CTAS : opts.ctas,
    cards: [card('v1', 'Video card', FRAME, 1), card('v2', 'Second video card', FRAME, 2), card('w1', 'Has a caption', FRAME, 3, 'A caption somebody wrote by hand.')],
    ef: [], jobs: new Map(), saves: [], doneMs: opts.doneMs || 900,
  };
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block', colorScheme: opts.theme }, opts.device));
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin }); } catch (e) {}
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
    if (/n8n\.cloud$/.test(u.hostname)) return json({ ok: true, prompts: {} });
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/caption-prompts-save' && r.method() === 'POST') {
      const body = JSON.parse(r.postData() || '{}');
      state.promptSave = body;
      return json({ ok: true, client: body.client, prompt: body.prompt });
    }
    if (p === '/functions/v1/caption-generate' && r.method() === 'POST') {
      const body = JSON.parse(r.postData() || '{}');
      if (body.action === 'cta_get') return json({ ok: true, client: body.client, options: state.ctas });
      if (body.action === 'cta_save') { state.ctaSave = body; return json({ ok: true, client: body.client, options: body.options }); }
      state.ef.push({ body });
      const now = () => new Date().toISOString();
      state.jobs.set(body.jobId, { jobId: body.jobId, client: body.client, postId: body.postId, status: 'running', stage: 'writing', caption: '', error: '', extras: {}, cancel_requested: false, updated_at: now() });
      setTimeout(() => {
        const redo = body.redo;
        const n = state.ef.length;
        const caption = redo ? (redo.quick === 'titles' ? redo.caption : 'A shorter caption after the redo.') : 'Caption written by the function';
        const titles = redo ? TITLES.map(t => 'New ' + t) : TITLES;
        const extras = { titles, best: redo ? 0 : 1, hashtags: ['#rest', '#habits', '#calm', '#slowliving'], cta: body.cta || (redo ? '' : 'ALPHA'), platform: body.platform, redo: !!redo };
        Object.assign(state.jobs.get(body.jobId), { status: 'done', stage: 'done', caption, extras, updated_at: now() });
        if (!redo) { const row = state.cards.find(c => c.id === body.postId); if (row) row.caption = caption; }   // a redo never saves to the card
      }, state.doneMs);
      return json({ ok: true, accepted: true, jobId: body.jobId });
    }
    if (p === '/functions/v1/caption-jobs') return json({ ok: true, jobs: Array.from(state.jobs.values()).filter(j => j.client === sp.get('client')) });
    if (r.method() === 'POST') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
      const post = body && (body.post || (body.payload && body.payload.post));
      if (post && post.id) {
        state.saves.push(Object.assign({}, post));
        const row = state.cards.find(c => c.id === post.id);
        if (row) for (const k of ['caption', 'name']) if (Object.prototype.hasOwnProperty.call(post, k)) row[k] = post[k];
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
        if (k === 'caption_generate_ef_clients') { rows.push({ key: k, value: { clients: [SLUG] } }); continue; }
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
  await page.evaluate(([names, theme]) => { document.documentElement.setAttribute('data-theme', theme); _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [[NAME], opts.theme]);
  await page.waitForSelector('.cal-card[data-pid="v1"]', { timeout: 20000 });
  await sleep(1500);
  return { page, ctx, state, pageErrors };
}

async function shot(page, name, pid) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  if (pid) await page.evaluate(id => { const el = document.querySelector(`.cal-card[data-pid="${id}"] .cal-capblock`) || document.querySelector(`.cal-card[data-pid="${id}"]`); el.scrollIntoView({ block: 'center', inline: 'center' }); }, pid);
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
const capSel = pid => `.cal-card[data-pid="${pid}"] textarea[data-fld="caption"]`;
const captionOf = (page, pid) => page.evaluate(s => (document.querySelector(s) || {}).value || '', capSel(pid));
async function waitFor(fn, ms) { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await fn()) return true; await sleep(200); } return false; }
const panel = pid => `.cal-card[data-pid="${pid}"] .cal-cap-ai`;
const noOverflow = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !el || el.scrollWidth <= el.clientWidth + 1; }, sel);

async function run(browser, origin, label, device, theme) {
  const tag = `${label}-${theme}`;
  console.log(`--- ${tag} ---`);
  const t = await open(browser, origin, { device, theme });
  const { page, state } = t;

  // THE BOX
  await page.locator('.cal-card[data-pid="v1"] .cal-cap-gen').click();
  await page.waitForSelector('#calPromptOverlay.open #calTxGo', { timeout: 5000 });
  await page.waitForSelector('#calCtaWrap .cal-gen-chip', { timeout: 5000 });
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#calCtaWrap .cal-gen-chip span')).map(e => e.textContent));
  expect(chips.join(',') === ['Let the AI choose'].concat(CTAS).join(','), `${tag}: the box offers the client's own choices after "Let the AI choose" (${chips.join(',')})`);
  expect(await page.evaluate(() => document.querySelector('input[name="calCta"]:checked').value === '' && document.querySelector('input[name="calPlat"]:checked').value === 'instagram'),
    `${tag}: "Let the AI choose" and Instagram are the defaults`);
  expect(await page.locator('#calNoteTA').count() === 1, `${tag}: there is a note box`);
  expect(await noOverflow(page, '#calPromptModal .cal-prompt-body') && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: the box does not scroll sideways`);
  await shot(page, `box-${tag}`);
  await page.locator('#calCtaWrap .cal-gen-chip', { hasText: 'BETA' }).click();
  await page.locator('.cal-gen-chip', { hasText: 'TikTok' }).click();
  await page.fill('#calNoteTA', 'mention the challenge starting Monday');
  await shot(page, `box-filled-${tag}`);
  await page.locator('#calTxGo').click();
  expect(await waitFor(async () => (await captionOf(page, 'v1')) === 'Caption written by the function'), `${tag}: the caption arrives in the box`);
  const b = (state.ef[0] || {}).body || {};
  expect(b.cta === 'BETA' && b.platform === 'tiktok' && b.note === 'mention the challenge starting Monday' && b.assetUrl === FRAME && !b.redo,
    `${tag}: the function got the call to action, the platform and the note with the video`);

  // THE PANEL
  await page.waitForSelector(panel('v1'), { timeout: 5000 });
  const info = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    return { titles: Array.from(el.querySelectorAll('.cal-cap-ai-ttxt')).map(e => e.textContent), best: Array.from(el.querySelectorAll('.cal-cap-ai-t')).findIndex(e => e.classList.contains('is-best')),
      tags: (el.querySelector('.cal-cap-ai-tagtxt') || {}).textContent, open: true };
  }, panel('v1'));
  expect(info.titles.length === 5 && info.best === 1 && info.open, `${tag}: five title ideas, the best one marked, open after a new caption`);
  expect(info.tags === '#rest #habits #calm #slowliving', `${tag}: the hashtags are listed apart from the caption`);
  const boxText = await captionOf(page, 'v1');
  expect(!TITLES.some(x => boxText.includes(x)) && !/#slowliving/.test(boxText), `${tag}: the caption box has the caption only, no titles`);
  await shot(page, `panel-${tag}`, 'v1');
  expect(await page.evaluate(sel => { const el = document.querySelector(sel); const c = el.closest('.cal-card'); return el.getBoundingClientRect().right <= c.getBoundingClientRect().right + 1 && el.scrollWidth <= el.clientWidth + 1; }, panel('v1')), `${tag}: the panel stays inside the card`);
  // copy
  await page.locator(`${panel('v1')} .cal-cap-ai-t:nth-child(2) .cal-cap-ai-btn`, { hasText: 'Copy' }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'unreadable'));
  expect(clip === TITLES[1] || clip === 'unreadable', `${tag}: Copy puts the title on the clipboard (${clip})`);
  // use this title
  await page.locator(`${panel('v1')} .cal-cap-ai-t:nth-child(3) .cal-cap-ai-btn`, { hasText: 'Use this title' }).click();
  expect(await page.evaluate(() => document.querySelector('.cal-card[data-pid="v1"] [data-fld="name"]').value) === TITLES[2], `${tag}: "Use this title" fills the card's title`);
  expect(await waitFor(async () => state.saves.some(s => s.id === 'v1' && s.name === TITLES[2]), 8000), `${tag}: the title is saved through the card's normal save`);

  // REDO with a note: replaces the box because the box still holds the caption the redo started from
  const before = state.saves.length;
  await page.locator(`${panel('v1')} .cal-cap-ai-note`).fill('shorter, and a hookier hook');
  await page.locator(`${panel('v1')} .cal-cap-ai-redo .cal-cap-ai-btn`).click();
  expect(await waitFor(async () => (await captionOf(page, 'v1')) === 'A shorter caption after the redo.'), `${tag}: the redo's caption replaces the untouched one`);
  const rb = (state.ef[1] || {}).body || {};
  expect(rb.redo && rb.redo.caption === 'Caption written by the function' && rb.note === 'shorter, and a hookier hook' && !rb.assetUrl && !rb.transcript && rb.redo.titles.length === 5,
    `${tag}: the redo sent the current caption, the note and the earlier titles, no video`);
  expect(await waitFor(async () => state.saves.slice(before).some(s => s.id === 'v1' && s.caption === 'A shorter caption after the redo.'), 8000), `${tag}: the redo is saved through the card's normal save`);
  expect((await page.evaluate(sel => Array.from(document.querySelector(sel).querySelectorAll('.cal-cap-ai-ttxt')).map(e => e.textContent), panel('v1')))[0] === 'New ' + TITLES[0], `${tag}: the redo brings new title ideas`);

  // Quick pick New titles: the caption is untouched
  await page.locator(`${panel('v1')} .cal-cap-ai-chip`, { hasText: 'New titles' }).click();
  expect(await waitFor(async () => state.ef.length === 3 && (await page.locator(`${panel('v1')} .cal-cap-ai-chip`).first().isEnabled())), `${tag}: New titles runs`);
  expect(((state.ef[2] || {}).body || {}).redo.quick === 'titles' && (await captionOf(page, 'v1')) === 'A shorter caption after the redo.', `${tag}: New titles leaves the caption as it is`);

  // A caption typed while a redo runs is never overwritten
  state.doneMs = 2500;
  await page.locator(`${panel('v1')} .cal-cap-ai-chip`, { hasText: 'Shorter' }).click();
  await sleep(300);
  const ta = page.locator(capSel('v1'));
  await ta.click();
  await ta.fill('Typed by hand while the redo was running.');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  expect(await waitFor(async () => state.ef.length === 4 && !(await page.evaluate(() => _calCapJobsActiveList().length)), 20000), `${tag}: the slow redo finishes`);
  await sleep(600);
  expect(await captionOf(page, 'v1') === 'Typed by hand while the redo was running.', `${tag}: the typed caption is still in the box`);
  expect(!state.saves.some(s => s.id === 'v1' && s.caption === 'A shorter caption after the redo.' && state.saves.indexOf(s) > before + 1), `${tag}: nothing was saved over the typed caption`);
  const pend = await page.locator(`${panel('v1')} .cal-cap-ai-pending`).count();
  expect(pend === 1, `${tag}: the new version waits in the panel for a click`);
  await shot(page, `pending-${tag}`, 'v1');
  await page.locator(`${panel('v1')} .cal-cap-ai-pending .is-primary`).click();
  const usedOk = await waitFor(async () => (await captionOf(page, 'v1')) === 'A shorter caption after the redo.');
  if (!usedOk) console.log('DEBUG', JSON.stringify(await page.evaluate(() => ({ box: (document.querySelector('.cal-card[data-pid="v1"] textarea[data-fld="caption"]') || {}).value, post: calState.posts.find(p => p.id === 'v1').caption, pe: _calPendingEdits.v1, entry: _calCapAiEntry('v1') }))));
  expect(usedOk, `${tag}: clicking "Use this version" puts it in the box`);

  // A hand-written caption: a small pill, no panel (the card does not grow) until it is opened; then Redo and no titles
  const wTog = `.cal-card[data-pid="w1"] .cal-cap-ai-tog`;
  expect(await page.locator(wTog).count() === 1 && await page.locator(panel('w1')).count() === 0, `${tag}: a caption somebody wrote has a "Redo with a note" pill and no panel yet`);
  const h0 = await page.evaluate(() => document.querySelector('.cal-card[data-pid="w1"]').getBoundingClientRect().height);
  await page.locator(wTog).click();
  await page.waitForSelector(panel('w1'), { timeout: 5000 });
  expect(await page.locator(`${panel('w1')} .cal-cap-ai-t`).count() === 0 && await page.locator(`${panel('w1')} .cal-cap-ai-note`).count() === 1, `${tag}: opened, it offers Redo with a note and no titles`);
  expect(await page.evaluate(() => document.querySelector('.cal-card[data-pid="w1"]').getBoundingClientRect().height) > h0, `${tag}: the card only grows once the panel is opened`);
  await page.locator(wTog).click();
  expect(await page.locator(panel('w1')).count() === 0, `${tag}: the pill closes it again`);
  expect(await page.locator('.cal-card[data-pid="v2"] .cal-cap-ai-tog').count() === 0 && await page.locator(panel('v2')).count() === 0, `${tag}: a card with no caption has no pill and no panel`);
  expect(t.pageErrors.length === 0, `${tag}: no page errors (${t.pageErrors.join(' | ')})`);
  await t.ctx.close();
}

async function runNoChoices(browser, origin) {
  console.log('--- a client with no call to action choices ---');
  const t = await open(browser, origin, { device: { viewport: { width: 1440, height: 900 } }, theme: 'light', ctas: [] });
  await t.page.locator('.cal-card[data-pid="v2"] .cal-cap-gen').click();
  await t.page.waitForSelector('#calPromptOverlay.open #calTxGo', { timeout: 5000 });
  await sleep(800);
  expect(await t.page.locator('#calCtaWrap .cal-gen-chip').count() === 0 && await t.page.locator('#calNoteTA').count() === 1, 'no choices: the box shows the note box and no call to action group');
  await t.page.locator('#calTxGo').click();
  await waitFor(async () => t.state.ef.length === 1);
  const b = t.state.ef[0].body;
  expect(b.cta === '' && b.platform === 'instagram' && b.note === '', 'no choices: nothing chosen goes as no call to action, Instagram, no note');
  expect(t.pageErrors.length === 0, `no choices: no page errors (${t.pageErrors.join(' | ')})`);
  await t.ctx.close();
}

async function runEditor(browser, origin) {
  console.log('--- the call to action list in the caption prompt editor ---');
  const t = await open(browser, origin, { device: { viewport: { width: 1440, height: 900 } }, theme: 'light' });
  await t.page.evaluate(() => _calOpenCaptionPromptModal());
  await t.page.waitForFunction(() => document.getElementById('calCtaTA') && document.getElementById('calCtaTA').getAttribute('data-loaded') === '1', null, { timeout: 5000 });
  expect(await t.page.inputValue('#calCtaTA') === CTAS.join('\n'), 'editor: the saved choices are loaded, one per line');
  await shot(t.page, 'editor-desktop-light');
  await t.page.fill('#calCtaTA', 'ALPHA\nBETA\n\nALPHA');
  await t.page.fill('#calPromptTA', 'A tailored prompt for the fixture client.');
  await t.page.locator('#calPromptSaveBtn').click();
  expect(await waitFor(async () => !!t.state.promptSave && !!t.state.ctaSave, 5000), 'editor: saving sends the prompt and the choices');
  expect(JSON.stringify(t.state.ctaSave.options) === JSON.stringify(['ALPHA', 'BETA', 'ALPHA']) && t.state.ctaSave.action === 'cta_save', 'editor: the choices go one per line, blanks dropped (the function removes repeats)');
  expect(!('cta_options' in t.state.promptSave), 'editor: the prompt save itself is unchanged');
  expect(t.pageErrors.length === 0, `editor: no page errors (${t.pageErrors.join(' | ')})`);
  await t.ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const desktop = { viewport: { width: 1440, height: 900 } };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
  try {
    for (const theme of ['light', 'dark']) await run(browser, origin, 'desktop', desktop, theme);
    for (const theme of ['light', 'dark']) await run(browser, origin, 'phone', phone, theme);
    await runNoChoices(browser, origin);
    await runEditor(browser, origin);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\ncaption-helper-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
