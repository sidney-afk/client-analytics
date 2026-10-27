'use strict';
/*
 * Frame.io comments in a Calendar card's Notes, without the player (switch frame_comments_in_notes_staff, staff only;
 * session Framenotes, 2026-10-26). A real page, fully offline: every backend answer is local and the frameio-view
 * function is a stand-in. All names, links and comments below are made up.
 *
 *   A  the switch names the signed-in staff member and the card's client has no player (frame_viewer_clients does not
 *      list it): Notes opens as it always did (no frameio-view request while it opens, no stand-in rows), then the
 *      Frame.io comments arrive as rows marked "Frame.io", in time order with the notes, with their video time as a
 *      label (there is no player to move), read only.
 *   B  opening the same card again within five minutes shows them at once and asks Frame.io nothing.
 *   C  a card whose Frame.io comments cannot be read shows one muted line, nothing else (no Try again, no box).
 *   D  a card whose video is not a Frame.io link asks nothing.
 *   E  with the player on, the player's comments read is kept too: a second opening asks for the video only.
 *   F  with the switch off (no row), Notes is exactly as before: no Frame.io request and no Frame.io rows.
 *
 * On the code before this change A, B, C and E fail.
 * Screenshots (desktop 1440x900, phone 390x844, light and dark) when FRAME_NOTES_SHOT_DIR is set.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');
const { openEditableSheet } = require('../docs/syncview-design/tests/staff-phone-browser');

const SLUG = 'fixtureclient';
const NAME = 'Fixture Client';
const SHOTS = process.env.FRAME_NOTES_SHOT_DIR || '';
const STAFF_ID = 'qa_staff';   // the member seedStaffGate signs in
const FRAME = 'https://f.io/fixture-video';
const FRAME_BAD = 'https://f.io/fixture-broken';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

const FRIO_COMMENTS = () => [
  { id: 'c1', frame: 48, time_seconds: 2, text: 'Open on the product, not the logo.', author: 'Team Member', guest: false, created_at: iso(300), done: false, replies: [] },
  { id: 'c2', frame: 120, time_seconds: 65, text: 'The caption covers her face here. Move it up a little?', author: '', guest: true, created_at: iso(90),
    done: false, replies: [{ id: 'r1', text: 'Moved, check the new version.', author: 'Another Member', guest: false, created_at: iso(20) }] },
];
const NOTES = [
  { id: 'n1', role: 'smm', author: 'Fixture SMM', body: 'Note from the team: cut the first second.', created_at: iso(200), done: false },
  { id: 'n2', role: 'client', author: 'Fixture Client', body: 'Agreed.', created_at: iso(150), parent_id: 'n1' },
];
const card = (id, name, assetUrl, order, over) => Object.assign({
  id, client: SLUG, name, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: 'A short fixture caption.', cta: '', thumbnail_url: '', asset_url: assetUrl,
  video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [],
}, over || {});

function makeState(extra) {
  return Object.assign({
    cards: [
      card('v1', 'Video card', FRAME, 1, { video_tweaks: JSON.stringify(NOTES) }),
      card('b1', 'Broken Frame card', FRAME_BAD, 2),
      card('d1', 'Drive link card', 'https://drive.google.com/file/d/fixture/view', 3),
    ],
    calls: [], frameFlag: { all: false, clients: ['someotherclient'] }, notesFlag: { staff: [STAFF_ID] }, delay: 400,
  }, extra || {});
}
async function installRoutes(ctx, origin, state) {
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (u.host === 'media.fixture.test') return route.fulfill({ status: 404, headers: CORS, body: '' });
    if (p === '/functions/v1/frameio-view') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
      state.calls.push({ part: body.part || '', link: body.link || '', at: Date.now(), clientToken: r.headers()['x-syncview-client-token'] || '' });
      if (state.delay) await sleep(state.delay);
      if (body.link === FRAME_BAD) return json({ ok: false, error: 'frameio_unavailable', message: 'Frame.io did not answer. Try again in a minute.' }, 502);
      if (body.part === 'video') return json({ ok: true, video: { url: 'https://media.fixture.test/clip.webm', renditions: {}, expires_at: iso(-600), duration_seconds: 80, fps: 24 }, open_url: FRAME, fetched_at: iso(0) });
      return json({ ok: true, comments: FRIO_COMMENTS(), comments_error: '', comments_truncated: false, reply_names_partial: false, open_url: FRAME, fetched_at: iso(0) });
    }
    if (p === '/functions/v1/production-comments') return json({ ok: true, canonical_thread: true, comments: [], has_more: false });
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: STAFF_ID, name: 'QA Staff', role: 'admin', team: null } });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: STAFF_ID, name: 'QA Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      if (keys.includes('frame_viewer_clients')) return json(state.frameFlag ? [{ key: 'frame_viewer_clients', value: state.frameFlag }] : []);
      const rows = keys.map(k => {
        if (k === 'frame_comments_in_notes_staff') return state.notesFlag ? { key: k, value: state.notesFlag } : null;
        if (k === 'prod_authority') return { key: k, value: { video: 'syncview', graphics: 'syncview' } };
        return { key: k, value: /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } };
      }).filter(Boolean);
      return json(rows);
    }
    if (p === '/rest/v1/calendar_posts') {
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      if (/client=eq\./.test(u.search) && !new RegExp('client=eq\\.' + SLUG).test(u.search)) return json([]);
      return json(state.cards.filter(c => !one || c.id === one));
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
}
async function openCalendar(browser, origin, state, device) {
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, device));
  const page = await ctx.newPage();
  // FRAME_NOTES_CPU_THROTTLE=N: a slow runner (CDP CPU throttling, N times slower). Proof knob only.
  if (process.env.FRAME_NOTES_CPU_THROTTLE) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.FRAME_NOTES_CPU_THROTTLE) }); }
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await installRoutes(ctx, origin, state);
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [NAME]);
  await page.waitForSelector('.cal-card[data-pid="v1"], .thumb-tile[data-thumb-card="v1"]', { timeout: 20000 });
  await openEditableSheet(page);
  await page.waitForSelector('.cal-card[data-pid="v1"]', { timeout: 20000 });
  await sleep(800);
  return { page, ctx, pageErrors };
}
// Opens a card's Notes and records, inside the page, every change of the list (did a stand-in row ever show?) and
// the frame each frameio-view request was sent in, counted from the opening. Frame 1's callback runs before the
// dialog's first paint, so a request sent in frame 2 or later was sent after the dialog had painted. Counted in the
// page, not sampled from here: a busy test process cannot make a late request look early, or an early one late.
async function openNotes(page, state, pid) {
  const before = state.calls.length;
  await page.evaluate(id => {
    const st = window.__fn = { skel: false, frames: 0, fetchFrames: [] };
    if (!window.__fnFetchWrapped) {
      window.__fnFetchWrapped = true;
      const real = window.fetch;
      window.fetch = function (input) {
        try { if (/\/functions\/v1\/frameio-view/.test(String(input && input.url || input)) && window.__fn) window.__fn.fetchFrames.push(window.__fn.frames); } catch (e) {}
        return real.apply(this, arguments);
      };
    }
    const tick = () => { if (window.__fn !== st) return; st.frames++; if (st.frames < 600) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const look = () => { const f = document.getElementById('calCommentsFeed'); if (f && f.querySelector('.cal-cm-skeleton, .cal-cm-fio-skeleton')) st.skel = true; };
    const mo = new MutationObserver(look);
    mo.observe(document.body, { childList: true, subtree: true });
    st.stop = () => mo.disconnect();
    openCalComments(id);
    look();
  }, pid);
  // FRAME_NOTES_SAMPLE_LAG=ms: the test process busy before it looks (a loaded runner). Proof knob only.
  if (process.env.FRAME_NOTES_SAMPLE_LAG) await sleep(Number(process.env.FRAME_NOTES_SAMPLE_LAG));
  return { before };
}
// The frame the first frameio-view request of this opening was sent in (null: none within 3 s).
const firstFetchFrame = page => page.waitForFunction(() => window.__fn.fetchFrames.length > 0, null, { timeout: 3000 })
  .then(() => page.evaluate(() => window.__fn.fetchFrames[0]), () => null);
const stopWatch = page => page.evaluate(() => { window.__fn.stop(); return window.__fn.skel; });
const fioRows = page => page.evaluate(() => Array.from(document.querySelectorAll('#calCommentsFeed .cal-cm-row.is-frameio')).map(r => ({
  label: (r.querySelector('.cal-cm-src-label') || {}).textContent || '', reply: r.classList.contains('is-reply'),
  tc: (r.querySelector('.cal-cm-tc') || {}).textContent || '', tcButton: !!r.querySelector('button.cal-cm-tc'),
  actions: r.querySelectorAll('button:not(.cal-cm-tc)').length, text: ((r.querySelector('.cal-cm-row-body') || {}).innerText || '').trim().slice(0, 30),
})));
const order = page => page.evaluate(() => Array.from(document.querySelectorAll('#calCommentsFeed .cal-cm-thread > .cal-cm-row')).map(r => r.classList.contains('is-frameio') ? 'F' : 'N').join(''));
const waitFio = (page, ms) => page.waitForFunction(() => document.querySelectorAll('#calCommentsFeed .cal-cm-row.is-frameio').length > 0, null, { timeout: ms || 6000 }).then(() => true, () => false);
const closeNotes = async page => { await page.evaluate(() => closeCalComments()); await sleep(250); };
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function runOn(browser, origin, label, device) {
  console.log(`--- ${label}: switch on, no player ---`);
  const state = makeState();
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
  // A: lazily, after the dialog painted, with no stand-in rows.
  const a = await openNotes(page, state, 'v1');
  const shell = await page.evaluate(() => !!document.getElementById('calNotesShell').hasAttribute('data-video'));
  expect(!shell, `${label}: the card's client has no player (frame_viewer_clients does not list it)`);
  const sentIn = await firstFetchFrame(page);
  expect(sentIn != null && sentIn >= 2, `${label}: opening Notes sends no Frame.io request before the dialog has painted (sent in frame ${sentIn} after the opening; 2 or later is after the first paint)`);
  const came = await waitFio(page);
  expect(came, `${label}: the Frame.io comments arrive in Notes without the player`);
  expect(!(await stopWatch(page)), `${label}: Notes shows no stand-in rows while they load (it paints as it always did)`);
  const calls = state.calls.filter(c => c.link === FRAME);
  expect(calls.length === 1 && calls[0].part === 'comments', `${label}: one comments-only request for the card's link (${calls.map(c => c.part).join(',')})`);
  const rows = await fioRows(page);
  const roots = rows.filter(r => !r.reply);
  expect(roots.length === 2 && rows.length === 3, `${label}: both Frame.io comments and the reply are rows (${roots.length} comments, ${rows.length} rows)`);
  expect(roots.every(r => r.label === 'Frame.io'), `${label}: each comment is marked "Frame.io"`);
  expect(roots[0] && roots[0].tc === '0:02' && roots[1] && roots[1].tc === '1:05', `${label}: with its video time (${roots.map(r => r.tc).join(', ')})`);
  expect(rows.every(r => !r.tcButton && r.actions === 0), `${label}: read only: no buttons on a Frame.io row, the time is a label (no player to move)`);
  const ord = await order(page);
  expect(ord === 'FNF', `${label}: in time order with the notes (${ord})`);
  for (const mode of ['light', 'dark']) {
    await page.evaluate(m => document.documentElement.setAttribute('data-theme', m), mode);
    await shot(page, `after-${label}-${mode}`);
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await closeNotes(page);

  // B: again within five minutes: at once, nothing asked.
  const n = state.calls.length;
  await openNotes(page, state, 'v1');
  const now = (await fioRows(page)).length;
  await stopWatch(page);
  await sleep(700);
  expect(now === 3, `${label}: opening the same card again shows them at once (${now} rows on the first frame)`);
  expect(state.calls.length === n, `${label}: and asks Frame.io nothing (${state.calls.length - n} requests)`);
  await closeNotes(page);

  // C: one muted line when they cannot be read.
  await openNotes(page, state, 'b1');
  await stopWatch(page);
  await page.waitForFunction(() => !!document.querySelector('#calCommentsFeed .cal-cm-fio-note'), null, { timeout: 6000 }).catch(() => {});
  const fail = await page.evaluate(() => {
    const notes = Array.from(document.querySelectorAll('#calCommentsFeed .cal-cm-fio-note'));
    const n0 = notes[0];
    const cs = n0 ? getComputedStyle(n0) : null;
    return { count: notes.length, text: n0 ? n0.textContent.trim() : '', buttons: n0 ? n0.querySelectorAll('button,a').length : -1, retry: !!document.querySelector('.cal-cm-fio-retry'),
      muted: !!cs && cs.color !== getComputedStyle(document.querySelector('#calCommentsFeed .cal-comments-empty, #calCommentsFeed') || document.body).color || (!!cs && parseFloat(cs.fontSize) < 14),
      rows: document.querySelectorAll('#calCommentsFeed .cal-cm-row.is-frameio').length };
  });
  expect(fail.count === 1 && /could not be loaded/i.test(fail.text), `${label}: a failed read is one line (${fail.count}: "${fail.text}")`);
  expect(fail.buttons === 0 && !fail.retry && fail.rows === 0 && fail.muted, `${label}: quiet: small muted text, no Try again, no rows`);
  if (/desktop/.test(label)) await shot(page, `after-${label}-failed-light`);
  await closeNotes(page);

  // D: a Drive link asks nothing.
  const m = state.calls.length;
  await openNotes(page, state, 'd1');
  await stopWatch(page);
  await sleep(800);
  expect(state.calls.length === m && (await fioRows(page)).length === 0, `${label}: a card whose video is not a Frame.io link asks nothing (${state.calls.length - m})`);
  await closeNotes(page);
  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}
async function runWithPlayer(browser, origin) {
  console.log('--- desktop: switch on, with the player ---');
  const state = makeState({ frameFlag: { all: true } });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, { viewport: { width: 1440, height: 900 } });
  await openNotes(page, state, 'v1'); await stopWatch(page);
  expect(await page.evaluate(() => document.getElementById('calNotesShell').hasAttribute('data-video')), 'with the player: the Notes view holds it');
  expect(await waitFio(page), 'with the player: the Frame.io comments are rows as before');
  const tcButton = (await fioRows(page)).some(r => r.tcButton);
  expect(tcButton, 'with the player: a comment\'s video time still moves the player');
  await closeNotes(page);
  const before = state.calls.filter(c => c.part === 'comments').length;
  await openNotes(page, state, 'v1'); await stopWatch(page);
  await sleep(900);
  const after = state.calls.filter(c => c.part === 'comments').length;
  expect(before === 1 && after === 1, `with the player: opening it again within five minutes asks for the video only, not the comments again (${before} then ${after})`);
  expect((await fioRows(page)).length === 3, 'with the player: and the comments are there');
  await closeNotes(page);
  expect(pageErrors.length === 0, `with the player: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}
async function runOff(browser, origin, label, device) {
  console.log(`--- ${label}: switch off ---`);
  const state = makeState({ notesFlag: null });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
  await openNotes(page, state, 'v1');
  await stopWatch(page);
  await sleep(1500);
  expect(state.calls.length === 0, `${label}, switch off: no Frame.io request (${state.calls.length})`);
  expect((await fioRows(page)).length === 0, `${label}, switch off: no Frame.io rows, Notes exactly as before`);
  for (const mode of ['light', 'dark']) {
    await page.evaluate(m => document.documentElement.setAttribute('data-theme', m), mode);
    await shot(page, `before-${label}-${mode}`);
  }
  await closeNotes(page);
  expect(pageErrors.length === 0, `${label}, switch off: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const DESK = { viewport: { width: 1440, height: 900 } }, PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  try {
    await runOn(browser, origin, 'desktop', DESK);
    await runOn(browser, origin, 'phone', PHONE);
    await runWithPlayer(browser, origin);
    await runOff(browser, origin, 'desktop', DESK);
    await runOff(browser, origin, 'phone', PHONE);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nframe-comments-in-notes-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
