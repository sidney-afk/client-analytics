'use strict';
/*
 * Caption history in a real browser, fully offline (every backend answer is local). Session Versions, 2026-10-23.
 *   THE SWITCH   caption_history_staff off (or naming someone else): no history icon anywhere, the caption box exactly
 *                as before. On for the signed-in staff member: the icon shows only on a card whose caption has
 *                changed (the index answer), just below the regenerate icon; never on a card that has not changed.
 *                Before the migration (available:false) no icon shows.
 *   THE POP-UP   The approved design (option C): one step per version, oldest on the left, newest marked Now and
 *                chosen; the kind of change above the caption with Changes / Clean text and the arrows on its right;
 *                the redo note; words taken out and added marked; a mostly rewritten caption shown Before and After.
 *                No word counts, no colour key, no Close button (the X closes), no button on the newest version.
 *                Escape and the X close it and focus goes back to the icon; nothing scrolls sideways.
 *   RESTORE      "Put this version back" puts the text in the caption box, saves it through the card's normal save
 *                with caption_origin { kind: restored, from: <version id> }; Undo on the toast puts the newest one
 *                back the same way. When the caption changed while the pop-up was open, nothing is put back and the
 *                pop-up says so.
 *   REDO         A redo's save carries caption_origin { kind: redo, note }.
 *   EMPTY        A card with one version shows "No earlier versions yet".
 * Run at 1440 wide and at 390 wide (staff phone), in light and dark. Set CAPTION_SHOT_DIR to save screenshots there.
 * Synthetic client, people and captions only.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { openEditableSheet } = require('../docs/syncview-design/tests/staff-phone-browser');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const NAME = 'Fixture Client';
const SHOTS = process.env.CAPTION_SHOT_DIR || '';
const FRAME = 'https://f.io/fixture-video';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const V1 = 'Most people stretch for 30 seconds and call it a warm up.\n\nHere is the 4 minute routine our coaches use before every heavy session: hips, ankles, upper back, then two light sets.\n\nComment WARMUP and we\'ll send you the full routine.';
const V2 = 'Your warm up is why your first set feels heavy.\n\nOur coaches spend 4 minutes on hips, ankles and upper back before every session. Then two light sets.\n\nComment WARMUP and we\'ll send you the full routine.';
const V3 = 'Your warm up is why your first set feels heavy.\n\nOur coaches spend 4 minutes on hips, ankles and upper back before every lift. Then two easy sets.\n\nComment WARMUP and we\'ll send you the full routine.';
const V4 = 'Your warm up is why your first set feels heavy.\n\nOur coaches spend 4 minutes on hips, ankles and upper back before every lift. Then two easy sets.\n\nDM us WARMUP and we\'ll send you the full routine.';
const VERSIONS = [
  { id: 11, kind: 'generated', text: V1, note: null, from: null, actor: null, role: null, at: '2026-10-20T14:02:00Z' },
  { id: 12, kind: 'redo', text: V2, note: 'shorter, and a hookier first line', from: null, actor: 'Browser Staff', role: 'admin', at: '2026-10-20T14:06:00Z' },
  { id: 13, kind: 'typed', text: V3, note: null, from: null, actor: 'Alex', role: 'smm', at: '2026-10-21T09:40:00Z' },
  { id: 14, kind: 'client', text: V4, note: null, from: null, actor: 'Client', role: null, at: '2026-10-21T18:12:00Z' },
];

const card = (id, name, order, caption) => ({
  id, client: SLUG, name, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: caption || '', cta: '', thumbnail_url: '', asset_url: FRAME,
  video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [],
});

async function open(browser, origin, opts) {
  const state = {
    cards: [card('h1', 'Has history', 1, V4), card('n1', 'Never changed', 2, 'Written once.'), card('e1', 'One version', 3, 'Only one.')],
    saves: [], ef: [], jobs: new Map(), reads: [], flag: opts.flag === undefined ? { staff: ['m1'] } : opts.flag,
    available: opts.available !== false, versions: VERSIONS.map(v => Object.assign({}, v)),
  };
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block', colorScheme: opts.theme }, opts.device));
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
    if (p === '/functions/v1/caption-generate' && r.method() === 'GET') {
      const action = sp.get('action');
      state.reads.push(action);
      if (action === 'caption_history_index') {
        if (!state.available) return json({ ok: true, available: false, changed: [] });
        const ids = String(sp.get('ids') || '').split(',');
        return json({ ok: true, available: true, changed: ids.filter(id => id === 'h1' || id === 'e1') });
      }
      if (action === 'caption_history') {
        if (sp.get('post') === 'e1') return json({ ok: true, available: true, versions: [{ id: 1, kind: 'typed', text: 'Only one.', at: '2026-10-20T10:00:00Z' }] });
        return json({ ok: true, available: true, versions: state.versions });
      }
      return json({ ok: true, client: sp.get('client'), options: [] });
    }
    if (p === '/functions/v1/caption-generate' && r.method() === 'POST') {
      const body = JSON.parse(r.postData() || '{}');
      state.ef.push({ body });
      state.jobs.set(body.jobId, { jobId: body.jobId, client: body.client, postId: body.postId, status: 'running', stage: 'writing', caption: '', error: '', extras: {}, cancel_requested: false, updated_at: new Date().toISOString() });
      setTimeout(() => Object.assign(state.jobs.get(body.jobId), { status: 'done', stage: 'done', caption: 'A redo caption from the note.', updated_at: new Date().toISOString() }), 700);
      return json({ ok: true, accepted: true, jobId: body.jobId });
    }
    if (p === '/functions/v1/caption-jobs') return json({ ok: true, jobs: Array.from(state.jobs.values()).filter(j => j.client === sp.get('client')) });
    if (r.method() === 'POST') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
      const post = body && (body.post || (body.payload && body.payload.post));
      if (post && post.id) {
        state.saves.push({ url: p, post: Object.assign({}, post), origin: body.caption_origin || null });
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
        if (k === 'caption_history_staff') { if (state.flag) rows.push({ key: k, value: state.flag }); continue; }
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
  await page.waitForSelector('.cal-card[data-pid="h1"], .thumb-tile[data-thumb-card="h1"]', { timeout: 20000 });
  await openEditableSheet(page);
  await page.waitForSelector('.cal-card[data-pid="h1"]', { timeout: 20000 });
  await sleep(1500);
  return { page, ctx, state, pageErrors };
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(250);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function waitFor(fn, ms) { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; }
const histBtn = pid => `.cal-card[data-pid="${pid}"] .cal-cap-hist-open`;
const redoBtn = pid => `.cal-card[data-pid="${pid}"] .cal-cap-redo-open:not(.cal-cap-hist-open)`;
const capSel = pid => `.cal-card[data-pid="${pid}"] textarea[data-fld="caption"]`;
const captionOf = (page, pid) => page.evaluate(s => (document.querySelector(s) || {}).value || '', capSel(pid));
const modalText = page => page.evaluate(() => (document.querySelector('#calPromptModal') || {}).innerText || '');
const isOpen = page => page.evaluate(() => !!document.querySelector('#calPromptOverlay.open .caph'));

async function runOff(browser, origin, label, flag, available) {
  const t = await open(browser, origin, { device: { viewport: { width: 1440, height: 900 } }, theme: 'light', flag, available });
  await sleep(1200);
  expect(await t.page.locator('.cal-cap-hist-open').count() === 0, `${label}: no history icon on any card`);
  expect(await t.page.locator(redoBtn('h1')).count() === 1, `${label}: the regenerate icon is there as before`);
  if (flag && flag.staff && flag.staff.includes('m1') && available === false) expect(t.state.reads.filter(a => a === 'caption_history_index').length === 1, `${label}: asked once, then stops asking`);
  if (!flag || !flag.staff || !flag.staff.includes('m1')) expect(t.state.reads.length === 0 || t.state.reads.every(a => a !== 'caption_history_index'), `${label}: the history is never even asked about`);
  expect(t.pageErrors.length === 0, `${label}: no page errors (${t.pageErrors.join(' | ')})`);
  await t.ctx.close();
}

async function run(browser, origin, label, device, theme) {
  const tag = `${label}-${theme}`;
  console.log(`--- ${tag} ---`);
  const t = await open(browser, origin, { device, theme });
  const { page, state } = t;

  // THE ICON
  expect(await waitFor(async () => (await page.locator(histBtn('h1')).count()) === 1, 8000), `${tag}: a card whose caption changed shows the history icon`);
  expect(await page.locator(histBtn('n1')).count() === 0, `${tag}: a card whose caption never changed shows none`);
  const ico = await page.evaluate(([h, r]) => {
    const a = document.querySelector(h), b = document.querySelector(r);
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return { phone: document.documentElement.classList.contains('sv-staff-phone'), title: a.getAttribute('title'), aria: a.getAttribute('aria-label'), below: ra.top >= rb.bottom - 1, sameColumn: Math.abs(ra.right - rb.right) <= 1, rightOf: ra.left >= rb.right - 1, sameRow: Math.abs(ra.top - rb.top) <= 1, w: Math.round(ra.width), h: Math.round(ra.height) };
  }, [histBtn('h1'), redoBtn('h1')]);
  expect(ico.title === 'Caption history' && ico.aria === 'Caption history', `${tag}: the icon is labelled "Caption history"`);
  if (ico.phone) expect(ico.rightOf && ico.sameRow && ico.w >= 44 && ico.h >= 44, `${tag}: on the staff phone it follows the regenerate icon in the row under the box, big enough to tap (${JSON.stringify(ico)})`);
  else expect(ico.below && ico.sameColumn, `${tag}: it sits just below the regenerate icon (${JSON.stringify(ico)})`);
  if (!ico.phone) await page.evaluate(id => document.querySelector(`.cal-card[data-pid="${id}"] .cal-capblock`).scrollIntoView({ block: 'center' }), 'h1');
  await shot(page, `icon-${tag}`);

  // THE POP-UP
  await page.locator(histBtn('h1')).click();
  expect(await waitFor(() => page.evaluate(() => document.querySelectorAll('#calPromptModal .caph-step').length === 4), 5000), `${tag}: the pop-up shows one step per version`);
  let txt = await modalText(page);
  const st = await page.evaluate(() => {
    const steps = Array.from(document.querySelectorAll('#calPromptModal .caph-step'));
    return { labels: steps.map(s => s.querySelector('.caph-sl').textContent), sel: steps.findIndex(s => s.getAttribute('aria-selected') === 'true'),
      nowOn: steps.findIndex(s => s.querySelector('.caph-now')), ins: document.querySelectorAll('#calPromptModal .caph-cap ins').length, del: document.querySelectorAll('#calPromptModal .caph-cap del').length,
      restore: document.querySelectorAll('#calPromptModal .caph-restore').length, close: Array.from(document.querySelectorAll('#calPromptModal button')).filter(b => b.textContent.trim() === 'Close').length,
      x: document.querySelectorAll('#calPromptModal .caph-x').length, seg: document.querySelectorAll('#calPromptModal .caph-seg button').length, nav: document.querySelectorAll('#calPromptModal .caph-nav button').length,
      segRight: (() => { const h = document.querySelector('#calPromptModal .caph-story-h'); const s = document.querySelector('#calPromptModal .caph-nav'); return !!h && !!s && s.getBoundingClientRect().right >= h.getBoundingClientRect().right - 2; })() };
  });
  expect(st.labels.join('|') === 'Generated|Redo with note|Edited|Client edit', `${tag}: oldest on the left, newest on the right (${st.labels.join('|')})`);
  expect(st.sel === 3 && st.nowOn === 3, `${tag}: the newest version is chosen and marked Now`);
  expect(/Client edited on the review link/.test(txt) && st.ins === 1 && st.del === 1 && /DM us/.test(txt), `${tag}: the client's change shows as one word taken out and two added (${st.ins}/${st.del})`);
  expect(st.restore === 0, `${tag}: no button on the version that is already the caption`);
  expect(st.close === 0 && st.x === 1, `${tag}: no Close button; the X closes`);
  expect(st.seg === 2 && st.nav === 2 && st.segRight, `${tag}: Changes / Clean text and the arrows sit top right of the version`);
  expect(!/words added|taken out|What this changed|Taken out|Added/.test(txt), `${tag}: no word counts and no colour key`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: nothing scrolls sideways`);
  await shot(page, `popup-now-${tag}`);
  // Clean text, then the arrows and the steps.
  await page.locator('#calPromptModal .caph-seg button', { hasText: 'Clean text' }).click();
  expect(await page.evaluate(() => document.querySelectorAll('#calPromptModal .caph-cap ins, #calPromptModal .caph-cap del').length === 0), `${tag}: Clean text shows the caption with no marks`);
  await page.locator('#calPromptModal .caph-seg button', { hasText: 'Changes' }).click();
  await page.locator('#calPromptModal .caph-nav .caph-back').click();
  txt = await modalText(page);
  expect(/Edited by hand/.test(txt) && /Alex/.test(txt), `${tag}: the back arrow goes to the version before (Edited by hand, by Alex)`);
  expect(await page.locator('#calPromptModal .caph-restore').count() === 1, `${tag}: an older version has "Put this version back"`);
  await shot(page, `popup-edit-${tag}`);
  await page.locator('#calPromptModal .caph-step').nth(1).click();
  txt = await modalText(page);
  expect(/Regenerated with note/.test(txt) && /shorter, and a hookier first line/.test(txt) && await page.locator('#calPromptModal .caph-note').count() === 1, `${tag}: the redo shows its note`);
  expect(/Mostly rewritten/.test(txt) && /before/i.test(txt) && /after/i.test(txt), `${tag}: a mostly rewritten caption is shown Before and After whole`);
  await shot(page, `popup-redo-${tag}`);
  // Keyboard: Home on the strip goes to the first version.
  await page.locator('#calPromptModal .caph-step[aria-selected="true"]').focus();
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => document.querySelectorAll('#calPromptModal .caph-step')[0].getAttribute('aria-selected') === 'true'), `${tag}: Home on the strip goes to the first version`);
  // Escape closes it and focus goes back to the icon.
  await page.keyboard.press('Escape');
  await sleep(250);
  expect(!(await isOpen(page)) && await page.evaluate(() => /cal-cap-hist-open/.test(document.activeElement.className)), `${tag}: Escape closes it and focus goes back to the history icon`);

  // RESTORE, then Undo
  await page.locator(histBtn('h1')).click();
  await waitFor(() => page.evaluate(() => document.querySelectorAll('#calPromptModal .caph-step').length === 4), 5000);
  await page.locator('#calPromptModal .caph-step').nth(2).click();
  const before = state.saves.length;
  await page.locator('#calPromptModal .caph-restore').click();
  await sleep(200);
  expect(!(await isOpen(page)) && await captionOf(page, 'h1') === V3, `${tag}: "Put this version back" puts that text in the caption box and closes`);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  expect(await waitFor(async () => state.saves.slice(before).some(s => s.post.id === 'h1' && s.post.caption === V3), 8000), `${tag}: it saves through the card's normal save`);
  const rs = state.saves.slice(before).find(s => s.post.id === 'h1' && s.post.caption === V3) || {};
  expect(rs.origin && rs.origin.kind === 'restored' && String(rs.origin.from) === '13', `${tag}: the save says it was put back from version 13 (${JSON.stringify(rs.origin)})`);
  expect(/card-write/.test(rs.url || ''), `${tag}: through calendar-card-write (${rs.url})`);
  expect(await waitFor(() => page.evaluate(() => /That version is back in the caption/.test(document.body.innerText)), 3000), `${tag}: a toast says so, with Undo`);
  await shot(page, `restored-${tag}`);
  const beforeUndo = state.saves.length;
  await page.locator('.sv-toast-action', { hasText: 'Undo' }).click();
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  expect(await waitFor(async () => (await captionOf(page, 'h1')) === V4, 4000), `${tag}: Undo puts the newest version back in the box`);
  expect(await waitFor(async () => state.saves.slice(beforeUndo).some(s => s.post.id === 'h1' && s.post.caption === V4 && s.origin && s.origin.kind === 'restored' && String(s.origin.from) === '14'), 8000), `${tag}: and saves it as put back from version 14`);

  // A typed edit afterwards is a plain typed edit (no origin rides on it).
  const ta = page.locator(capSel('h1'));
  await ta.click();
  await ta.fill(V4 + ' Today.');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  expect(await waitFor(async () => state.saves.some(s => s.post.id === 'h1' && s.post.caption === V4 + ' Today.'), 8000), `${tag}: a typed edit saves`);
  expect(state.saves.filter(s => s.post.id === 'h1' && s.post.caption === V4 + ' Today.').every(s => !s.origin), `${tag}: and carries no origin (the server calls it typed)`);

  // STALE: the caption changed while the pop-up was open
  state.versions = VERSIONS.map(v => Object.assign({}, v));
  state.versions.push({ id: 15, kind: 'typed', text: V4 + ' Today.', actor: 'Browser Staff', at: '2026-10-23T20:00:00Z' });
  await page.locator(histBtn('h1')).click();
  await waitFor(() => page.evaluate(() => document.querySelectorAll('#calPromptModal .caph-step').length === 5), 5000);
  await page.evaluate(() => { const el = document.querySelector('.cal-card[data-pid="h1"] textarea[data-fld="caption"]'); el.value = 'Changed in another tab meanwhile.'; });
  await page.locator('#calPromptModal .caph-step').nth(0).click();
  await page.locator('#calPromptModal .caph-restore').click();
  await sleep(200);
  expect(await isOpen(page) && /The caption changed while this was open/.test(await modalText(page)) && await captionOf(page, 'h1') === 'Changed in another tab meanwhile.',
    `${tag}: when the caption changed while it was open, nothing is put back and the pop-up says so`);
  await shot(page, `stale-${tag}`);
  await page.locator('#calPromptModal .caph-x').click();
  await sleep(200);
  expect(!(await isOpen(page)), `${tag}: the X closes it`);
  await page.evaluate(([v]) => { const el = document.querySelector('.cal-card[data-pid="h1"] textarea[data-fld="caption"]'); el.value = v; }, [V4 + ' Today.']);

  // EMPTY
  if (await page.locator(histBtn('e1')).count()) {
    await page.locator(histBtn('e1')).click();
    expect(await waitFor(async () => /No earlier versions yet/.test(await modalText(page)), 4000), `${tag}: a card with one version shows "No earlier versions yet"`);
    await shot(page, `empty-${tag}`);
    await page.keyboard.press('Escape');
    await sleep(200);
  } else expect(false, `${tag}: the one-version card shows its icon (the index named it)`);

  // REDO: its save carries the note
  await page.locator(redoBtn('h1')).click();
  await page.waitForSelector('#calPromptOverlay.open #calRedoTA', { timeout: 5000 });
  await page.fill('#calRedoTA', 'more energy');
  await page.locator('#calRedoGo').click();
  expect(await waitFor(async () => (await captionOf(page, 'h1')) === 'A redo caption from the note.', 15000), `${tag}: the redo's caption arrives`);
  expect(await waitFor(async () => state.saves.some(s => s.post.id === 'h1' && s.post.caption === 'A redo caption from the note.' && s.origin && s.origin.kind === 'redo' && s.origin.note === 'more energy'), 8000),
    `${tag}: the redo's save says it was a redo, with the note`);

  expect(t.pageErrors.length === 0, `${tag}: no page errors (${t.pageErrors.join(' | ')})`);
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
    console.log('--- the switch ---');
    await runOff(browser, origin, 'switch missing', null, true);
    await runOff(browser, origin, 'switch names someone else', { staff: ['someone-else'] }, true);
    await runOff(browser, origin, 'switch with the wrong shape', { all: true }, true);
    await runOff(browser, origin, 'migration not applied', { staff: ['m1'] }, false);
    for (const theme of ['light', 'dark']) await run(browser, origin, 'desktop', desktop, theme);
    for (const theme of ['light', 'dark']) await run(browser, origin, 'phone', phone, theme);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed'); process.exit(1); }
  console.log('\ncaption-history-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
