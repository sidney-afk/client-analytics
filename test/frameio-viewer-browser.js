'use strict';
/*
 * "Watch here": the Frame.io video and its notes in ONE view, in a real page, fully offline. Every backend answer is
 * local, the Frame.io lookup is a stand-in for the frameio-view function, and the clip is a 12 second fixture. All
 * names, links and comments below are made up.
 *
 *   ONE VIEW          the Sheet's play icon and the card's Notes button open the same view: the card's Notes dialog
 *                     with the player on the left and the notes on the right (on a phone the video on top, the notes
 *                     below). Opening never plays: the video stays paused until the play button (bottom centre of the
 *                     player) is pressed.
 *   THE LIST          the Frame.io comments are rows like the notes (avatar, name, time, status, text, replies, no box
 *                     per comment), in time order with the notes, each marked "Frame.io"; a comment's video time moves
 *                     the player there without playing it.
 *   LOADING           the poster with a quiet moving line, no spinner; comment rows shaped like the final ones while the
 *                     Frame.io comments load; no empty grey box.
 *   STATES            "could not load" (with Try again and the Frame.io link), comments failing alone, an address that
 *                     stops working (asked for again once), the fast start after a hover, the small file on a slow line.
 *   REVIEW TAB        staff (SMM review) and client link: the video preview opens the same view. A client link asks
 *                     with its token and only the card's id, and never sees a Frame.io comment.
 *   KASPER REVIEW     Kasper's "Watch here" opens the same view for a card the Calendar has not loaded.
 *   THE SWITCH        everything shows only when the runtime flag row frame_viewer_clients lists the client (or says
 *                     all: true); a missing row, wrong shape or failed read hides it, and realtime changes show and hide
 *                     it live. Off, the Notes dialog is the Notes dialog it always was.
 *   LOOK              desktop 1440x900 and phone 390x844, light and dark. Set FRAMEIO_VIEWER_SHOT_DIR to save screenshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate, seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const NAME = 'Fixture Client';
const SHOTS = process.env.FRAMEIO_VIEWER_SHOT_DIR || '';
const FRAME = 'https://f.io/fixture-video';
const OPEN_URL = 'https://next.frame.io/share/00000000-0000-4000-8000-000000000001/view/00000000-0000-4000-8000-000000000002';
const MEDIA = 'https://media.fixture.test/clip.webm';
const MEDIA_HQ = MEDIA + '?q=hq';
const CLIP = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip.webm'));
const CLIP_V = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip-vertical.webm'));
// Sound and no picture: what Chrome on Windows makes of an HEVC (H.265) upload. Here a 12 second audio-only file.
const SOUND_ONLY = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-sound-only.webm'));
const POSTER = { landscape: fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-poster-landscape.png')), portrait: fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-poster-vertical.png')) };
const POSTER_URL = 'https://media.fixture.test/poster.png';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const FAKE_SUPABASE = "window.__rts={};window.supabase={createClient:function(){return{channel:function(name){var ch={on:function(t,f,cb){window.__rts[name]=cb;return ch;},subscribe:function(){return ch;}};return ch;},removeChannel:function(){}};}};";
const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const RENDITIONS = { efficient: MEDIA, high_quality: MEDIA_HQ, original: MEDIA_HQ + '&o=1' };
const FRIO_COMMENTS = () => [
  { id: 'c1', frame: 48, time_seconds: 2, text: 'Open on the product, not the logo.', author: 'Team Member', guest: false, created_at: iso(300), done: true, replies: [] },
  { id: 'c2', frame: 120, time_seconds: 5, text: 'The caption covers her face here. Move it up a little?\nThanks!', author: '', guest: true, created_at: iso(90),
    done: false, replies: [{ id: 'r1', text: 'Moved, check the new version.', author: 'Another Member', guest: false, created_at: iso(20) }] },
  { id: 'c3', frame: 216, time_seconds: 9, text: 'Great ending.', author: '', guest: true, created_at: iso(10), done: false, replies: [] },
];
const GOOD = () => ({
  ok: true,
  video: { url: MEDIA_HQ, renditions: RENDITIONS, expires_at: new Date(Date.now() + 20 * 3600000).toISOString(), name: 'Fixture clip V2.mp4', file_id: 'f1', duration_seconds: 12, fps: 24 },
  comments: FRIO_COMMENTS(),
  comments_error: '', comments_truncated: false, reply_names_partial: false, open_url: OPEN_URL, fetched_at: iso(0), took_ms: 900,
});
// What the function answers for each part (the page asks for the video and the comments side by side).
function answerFor(body, g) {
  g = g || GOOD();
  // FRAMEIO_VIEWER_BUILD=before: how the function answered before this change (no parts, the small file first), to time the old page.
  if (process.env.FRAMEIO_VIEWER_BUILD === 'before' && !(body && body.part)) g = Object.assign({}, g, { video: Object.assign({}, g.video, { url: MEDIA }) });
  if (body && body.part === 'video') return { ok: true, video: g.video, open_url: g.open_url, fetched_at: g.fetched_at };
  if (body && body.part === 'comments') return { ok: true, comments: g.comments, comments_error: g.comments_error, comments_truncated: g.comments_truncated, reply_names_partial: g.reply_names_partial, open_url: g.open_url, fetched_at: g.fetched_at };
  return g;
}
const card = (id, name, assetUrl, order, over) => Object.assign({
  id, client: SLUG, name, status: 'In Progress', order_index: order, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '2026-10-1' + order, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  caption: 'A short fixture caption.', cta: '', thumbnail_url: '', asset_url: assetUrl,
  video_deliverable_id: '', graphic_deliverable_id: '', comments: [], graphic_comments: [], caption_comments: [],
}, over || {});

// The backend stand-in: `state.view` decides what the frameio-view function answers.
function makeState(extra) {
  return Object.assign({
    cards: [card('v1', 'Video card', FRAME, 1), card('d1', 'Drive link card', 'https://drive.google.com/file/d/fixture/view', 2), card('n1', 'No video card', '', 3)],
    calls: [], view: (n, body) => ({ status: 200, body: answerFor(body) }), delay: 0, mediaHits: 0, mediaFail: 0,
    // orient: which clip the media answers with. mediaDelay: how long the FIRST request for each rendition takes (ms).
    // serverModel: the function takes as long as the real one measured (resolve 520 the first time in 60 s, then the part).
    orient: 'landscape', hqFail: false, mediaDelay: { small: 0, full: 0 }, hqStall: 0, mediaLog: [], mediaSeen: {}, commentsDelay: 0, serverModel: false, resolveStartedAt: 0, resolveReadyAt: 0,
    // The switch row the page reads. null = no row, flagFail = the read itself fails.
    frameFlag: { all: false, clients: [SLUG] }, flagFail: false, flagReads: 0,
  }, extra || {});
}
async function installRoutes(ctx, origin, state) {
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (u.host === 'media.fixture.test' && /poster\.png$/.test(u.pathname)) return route.fulfill({ status: 200, headers: CORS, contentType: 'image/png', body: POSTER[state.orient === 'portrait' ? 'portrait' : 'landscape'] });
    if (u.host === 'media.fixture.test') {
      state.mediaHits++;
      const hq = sp.get('q') === 'hq';
      state.mediaLog.push(hq ? 'full' : 'small');
      const file = sp.get('o') === '1' ? 'original' : (hq ? 'high_quality' : 'efficient');
      (state.fileLog = state.fileLog || []).push(file);
      if (state.mediaFail > 0) { state.mediaFail--; return route.fulfill({ status: 403, headers: CORS, body: 'expired' }); }
      if (hq && state.hqFail) return route.fulfill({ status: 403, headers: CORS, body: 'this rendition fails' });
      const first = !state.mediaSeen[hq ? 'full' : 'small'];
      state.mediaSeen[hq ? 'full' : 'small'] = true;
      if (first) { const wait = hq ? (state.hqStall || state.mediaDelay.full) : state.mediaDelay.small; if (wait) await sleep(wait); }
      const clip = (state.soundOnly || []).includes(file) ? SOUND_ONLY : (state.orient === 'portrait' ? CLIP_V : CLIP);
      const range = /bytes=(\d+)-(\d*)/.exec(r.headers().range || '');
      // holdTail: the first answer carries only the first 35% of the file; the rest waits until state.releaseTail,
      // so the video plays a few seconds and then stalls (a slow or broken connection mid-playback).
      if (state.holdTail && file === state.holdTail) {
        const total = clip.length, cut = Math.floor(total * 0.35);
        const a = range ? Number(range[1]) : 0;
        if (a < cut) return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': `bytes ${a}-${cut - 1}/${total}`, 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip.subarray(a, cut) });
        state.tailAsked = (state.tailAsked || 0) + 1;
        while (!state.releaseTail) await sleep(100);
        const b = range && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': `bytes ${a}-${b}/${total}`, 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip.subarray(a, b + 1) });
      }
      if (range) {
        const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
        return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': `bytes ${a}-${b}/${clip.length}`, 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip.subarray(a, b + 1) });
      }
      return route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip });
    }
    if (state.fakeSupabase && /supabase-js/.test(r.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: CORS, body: FAKE_SUPABASE });
    if (p === '/functions/v1/frameio-view') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
      state.calls.push({ body, key: r.headers()['x-syncview-key'] || '', clientToken: r.headers()['x-syncview-client-token'] || '', method: r.method(), part: body.part || '', at: Date.now() });
      const n = state.calls.length;
      if (state.serverModel) {
        // The real function's cost, measured against Frame.io on 2026-10-16: finding the file ~520 ms the first time
        // within a minute (calls that arrive together share it), then ~95 ms for the address, ~185 for the comments;
        // the old all-in-one answer did every step one after the other.
        const now = Date.now();
        if (!state.resolveReadyAt || now - state.resolveStartedAt > 60000) { state.resolveStartedAt = now; state.resolveReadyAt = now + 520; }
        await sleep(Math.max(0, state.resolveReadyAt - Date.now()));
        await sleep(body.part === 'video' || body.card_id ? 95 : (body.part === 'comments' ? 185 : 280));
      } else if (state.delay) await sleep(state.delay);
      if (body.part === 'comments' && state.commentsDelay) await sleep(state.commentsDelay);
      const out = state.view(n, body);
      // A client link is answered the way the server answers it: the playable addresses and nothing else.
      if (r.headers()['x-syncview-client-token'] && out.status === 200 && out.body && out.body.ok) {
        const g = out.body;
        return json({ ok: true, video: { url: g.video.url, renditions: g.video.renditions, expires_at: g.video.expires_at, duration_seconds: g.video.duration_seconds, fps: 24 }, fetched_at: g.fetched_at }, 200);
      }
      return json(out.body, out.status);
    }
    // The notes thread of a card with a deliverable (Encore). notesDelay models the live read (about 1.8 s on the server).
    if (p === '/functions/v1/production-comments') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
      (state.notesCalls = state.notesCalls || []).push({ at: Date.now(), id: body.deliverable_id || '' });
      if (state.notesDelay) await sleep(state.notesDelay);
      return json({ ok: true, canonical_thread: true, comments: (state.notesRows || {})[body.deliverable_id] || [], has_more: false });
    }
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: ADMIN });
    if (p === '/functions/v1/client-token-verify') {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (_) {}
      return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: NAME, view: b.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      if (keys.includes('frame_viewer_clients')) {
        state.flagReads++;
        if (state.flagFail) return json({ message: 'fixture failure' }, 500);
        return json(state.frameFlag ? [{ key: 'frame_viewer_clients', value: state.frameFlag }] : []);
      }
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) })));
    }
    if (p === '/rest/v1/calendar_posts') {
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      if (/client=eq\./.test(u.search) && !new RegExp('client=eq\\.' + SLUG).test(u.search)) return json([]);
      return json(state.cards.filter(c => !one || c.id === one));
    }
    if (p === '/rest/v1/deliverables' || p === '/rest/v1/production_deliverables_browser_v1') {
      (state.crosswalkCalls = state.crosswalkCalls || []).push(Date.now());
      if (state.crosswalkDelay) await sleep(state.crosswalkDelay);
      return json(state.cards.filter(c => c.video_deliverable_id).map(c => ({ id: c.video_deliverable_id, card_id: c.id, client_slug: SLUG, team: 'video', origin: 'calendar', status: 'client_approval', updated_at: '2026-10-08T12:00:00.000Z' })));
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
}

async function openCalendar(browser, origin, state, device, opts) {
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, device));
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await installRoutes(ctx, origin, state);
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
  await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [NAME]);
  if (opts && opts.view === 'smmreview') {
    await page.waitForSelector('.cal-card[data-pid], .kcard[data-cal-review-pid]', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => onCalViewChange('smmreview'));
    await page.waitForSelector('.kcard[data-cal-review-pid]', { timeout: 20000 });
  } else {
    await page.waitForSelector('.cal-card[data-pid="v1"]', { timeout: 20000 }).catch((e) => { console.error('page errors:', pageErrors.join(' | ')); throw e; });
  }
  await sleep(600);
  return { page, ctx, pageErrors };
}
async function theme(page, mode) { await page.evaluate(m => { document.documentElement.setAttribute('data-theme', m); }, mode); await sleep(150); }
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(350);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
const PLAYER = '#calNotesStage .fv-player';
const vOpen = page => page.evaluate(() => { const o = document.getElementById('calCommentsOverlay'); return !!(o && o.classList.contains('open')); });
async function waitState(page, st) { await page.waitForFunction(s => { const p = document.querySelector('#calNotesStage .fv-player'); return p && p.getAttribute('data-state') === s; }, st, { timeout: 15000 }); }
const waitReady = page => waitState(page, 'ready');
const waitFio = page => page.waitForFunction(() => document.querySelectorAll('.cal-cm-row.is-frameio').length > 0, null, { timeout: 10000 });
// Where the parts of the view sit, and whether it is the video-and-notes view at all.
const viewShape = page => page.evaluate(() => {
  const shell = document.getElementById('calNotesShell'), stage = document.getElementById('calNotesStage'), modal = document.getElementById('calCommentsModal');
  const ovl = document.getElementById('calCommentsOverlay');
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  return { open: !!(ovl && ovl.classList.contains('open')), video: !!(shell && shell.hasAttribute('data-video')), stageShown: !!(stage && !stage.hidden && stage.getBoundingClientRect().width > 0),
    stage: r(stage), modal: r(modal), shell: r(shell), title: (modal && modal.querySelector('h3') || {}).textContent || '', overflowX: document.documentElement.scrollWidth > window.innerWidth + 1 };
});
const videoInfo = page => page.evaluate(() => { const v = document.querySelector('#calNotesStage .fv-video'); return v ? { has: true, paused: v.paused, t: v.currentTime, muted: v.muted, src: v.getAttribute('src') || '', ready: v.readyState } : { has: false }; });
// The notes list, as a person reads it: one entry per row, top to bottom.
const feedRows = page => page.evaluate(() => Array.from(document.querySelectorAll('#calCommentsFeed .cal-cm-row')).map((row) => {
  const cs = getComputedStyle(row);
  const label = row.querySelector('.cal-cm-src-label, .cal-cm-comp-label');
  return {
    fio: row.classList.contains('is-frameio'), reply: row.classList.contains('is-reply'),
    author: (row.querySelector('.cal-cm-author') || {}).textContent || '', authorPx: parseFloat(getComputedStyle(row.querySelector('.cal-cm-author')).fontSize),
    bodyPx: parseFloat(getComputedStyle(row.querySelector('.cal-cm-row-body')).fontSize),
    text: ((row.querySelector('.cal-cm-row-body') || {}).innerText || '').trim().slice(0, 40), label: label ? label.textContent.trim() : '',
    tc: (row.querySelector('.cal-cm-tc') || {}).textContent || '', avatar: !!row.querySelector('.cal-cm-avatar'), time: !!(row.querySelector('.cal-cm-time') || {}).textContent,
    box: parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor),
  };
}));
async function noMouse(page) { await page.mouse.move(2, 2).catch(() => {}); await sleep(120); }
async function closeView(page) { await page.evaluate(() => closeCalComments()); await sleep(250); }

// The checks every opening of the view must pass, from whichever door it was opened.
async function checkOneView(page, tag, device, opts) {
  const v = await viewShape(page);
  expect(v.open && v.video && v.stageShown, `${tag}: the view has the player and the notes together`);
  const phone = device.viewport.width < 768;
  if (phone) expect(v.stage.y + v.stage.h <= v.modal.y + 2 && v.stage.w >= device.viewport.width - 2, `${tag}: on a phone the video is on top and the notes below it (video ${v.stage.y}+${v.stage.h}, notes from ${v.modal.y})`);
  else expect(v.stage.x + v.stage.w <= v.modal.x + 2 && Math.abs(v.stage.y - v.modal.y) <= 2, `${tag}: the player is on the left and the notes on the right (player ${v.stage.x}..${v.stage.x + v.stage.w}, notes from ${v.modal.x})`);
  expect(/Notes|Resolved/.test(v.title), `${tag}: the right side is the card's Notes (${v.title})`);
  expect(!v.overflowX, `${tag}: nothing runs off the screen`);
  if (!(opts && opts.skipPlayCheck)) {
    await sleep(1200);
    const vi = await videoInfo(page);
    expect(!vi.has || (vi.paused && vi.t === 0), `${tag}: opening it does not play the video (paused ${vi.paused}, at ${vi.t})`);
  }
  return v;
}
async function checkPlayButton(page, tag) {
  const g = await page.evaluate(() => {
    const p = document.querySelector('#calNotesStage .fv-player').getBoundingClientRect(), b = document.querySelector('#calNotesStage .fv-play').getBoundingClientRect();
    const st = getComputedStyle(document.querySelector('#calNotesStage .fv-play'));
    return { pc: p.left + p.width / 2, bc: b.left + b.width / 2, pBottom: p.bottom, bBottom: b.bottom, pMid: p.top + p.height / 2, bTop: b.top, w: b.width, radius: st.borderRadius, bg: st.backgroundColor };
  });
  expect(Math.abs(g.pc - g.bc) <= 3, `${tag}: the play button is centred left to right (${Math.round(g.bc)} vs ${Math.round(g.pc)})`);
  expect(g.pBottom - g.bBottom <= 24 && g.bTop > g.pMid, `${tag}: and sits at the bottom of the video, not the middle (${Math.round(g.pBottom - g.bBottom)} px from the bottom)`);
  expect(g.w >= 40 && g.w <= 48 && /rgb\(/.test(g.bg) && !/rgba\(0, 0, 0, 0\)/.test(g.bg), `${tag}: a ${Math.round(g.w)} px round button in the page's own colour (${g.bg})`);
}

async function calendarRun(browser, origin, name, device, orient) {
  const label = name;
  const portrait = orient === 'portrait';
  const tag = name + (portrait ? '-vertical' : '');
  console.log(`--- ${name}${portrait ? ', vertical video' : ''}: Calendar card ---`);
  const notes = [
    { id: 'n1', role: 'smm', author: 'Fixture SMM', body: 'Note from the team: cut the first second.', created_at: iso(200), done: false },
    { id: 'n2', role: 'client', author: 'Fixture Client', body: 'Agreed.', created_at: iso(150), parent_id: 'n1' },
  ];
  const state = makeState({ orient: portrait ? 'portrait' : 'landscape', cards: [card('v1', 'Video card', FRAME, 1, { video_tweaks: JSON.stringify(notes), thumbnail_url: POSTER_URL }), card('d1', 'Drive link card', 'https://drive.google.com/file/d/fixture/view', 2), card('n1', 'No video card', '', 3)] });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
  const ICON = '.cal-card[data-pid="v1"] .cal-thumb-play';
  await page.locator(ICON + ':not([hidden])').waitFor({ state: 'attached', timeout: 8000 });
  expect(await page.locator(ICON + ':not([hidden])').count() === 1, `${label}: a card with a Frame.io link has the play icon on its thumbnail`);
  expect(await page.locator('.cal-card[data-pid="d1"] .cal-thumb-play').count() === 0, `${label}: a Drive link has none`);
  await page.locator('.cal-card[data-pid="v1"]').scrollIntoViewIfNeeded();
  if (!device.isMobile) await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover({ position: { x: 6, y: 6 } });
  await sleep(200);
  await shot(page, `${tag}-1-sheet-light`);

  // DOOR 1: the Sheet's play icon. The function is slow on purpose, so the loading look can be checked.
  state.delay = 1600;
  await page.locator(ICON).click({ force: true });
  await page.waitForSelector(PLAYER, { timeout: 8000 });
  await sleep(250);
  const loading = await page.evaluate(() => {
    const p = document.querySelector('#calNotesStage .fv-player');
    const line = p.querySelector('.fv-loadline');
    return { state: p.getAttribute('data-state'), spinner: document.querySelectorAll('.fv-spin').length, poster: !!p.querySelector('.fv-poster'), line: !!line && getComputedStyle(line).display !== 'none',
      skelRows: document.querySelectorAll('#calCommentsFeed .cal-cm-fio-skeleton .cal-cm-skel-row').length, oldBoxes: document.querySelectorAll('.fv-skel, .fv-side, .fv-list').length,
      controls: !!p.querySelector('.fv-play'), empty: Array.from(document.querySelectorAll('#calCommentsFeed .cal-comments-empty')).length };
  });
  expect(loading.state === 'loading' && loading.poster && loading.line && loading.spinner === 0, `${label}: while loading: the poster with a quiet loading line, no spinner (${JSON.stringify({ s: loading.state, p: loading.poster, l: loading.line, sp: loading.spinner })})`);
  expect(loading.skelRows >= 2 && loading.oldBoxes === 0 && loading.empty === 0, `${label}: while the Frame.io comments load, rows shaped like comments stand in for them, and there is no empty box (${loading.skelRows} rows)`);
  expect(loading.controls, `${label}: the controls are there from the first frame, so nothing jumps when the video is ready`);
  await shot(page, `${tag}-2-loading-light`);
  await waitReady(page);
  await waitFio(page);
  state.delay = 0;
  const shape1 = await checkOneView(page, `${label}: from the play icon`, device);
  await checkControlsFit(page, tag);
  expect(state.calls.some(c => c.part === 'video' && c.body.link === FRAME && !!c.key && !c.clientToken) && state.calls.some(c => c.part === 'comments'), `${label}: the video and the comments were asked for with the staff key`);
  await checkPlayButton(page, label);

  // THE LIST: one conversation, in time order; Frame.io rows look like the notes.
  await noMouse(page);
  const rows = await feedRows(page);
  const roots = rows.filter(r => !r.reply);
  expect(roots.map(r => (r.fio ? 'F:' : 'N:') + r.text.replace(/^\d+:\d+/, '').slice(0, 12)).join(' | ') === 'N:Note from th | F:The caption  | F:Great ending', `${label}: notes and Frame.io comments in one list, oldest first (${roots.map(r => (r.fio ? 'F:' : 'N:') + r.text.slice(0, 12)).join(' | ')})`);
  expect(rows.filter(r => r.reply).length === 2 && rows[1].reply && !rows[1].fio && rows[3].reply && rows[3].fio && rows[3].author === 'Another Member', `${label}: each reply sits under the comment it answers, a note's and a Frame.io one alike`);
  expect(rows.every(r => r.avatar && r.time && !r.box), `${label}: every row has an avatar, a name and a time, and none is a box`);
  expect(roots.filter(r => r.fio).every(r => r.label === 'Frame.io') && roots.filter(r => !r.fio).every(r => r.label !== 'Frame.io'), `${label}: Frame.io comments say "Frame.io" where a note names its part`);
  expect(rows.filter(r => r.fio && !r.reply).map(r => r.tc).join(',') === '0:05,0:09', `${label}: each Frame.io comment leads with its video time (${rows.filter(r => r.fio).map(r => r.tc).join(',')})`);
  const fioRoot = rows.find(r => r.fio && !r.reply), noteRoot = rows.find(r => !r.fio && !r.reply);
  expect(fioRoot.authorPx === noteRoot.authorPx && fioRoot.bodyPx === noteRoot.bodyPx, `${label}: same type as the notes (name ${fioRoot.authorPx}/${noteRoot.authorPx} px, text ${fioRoot.bodyPx}/${noteRoot.bodyPx} px)`);
  expect(rows.some(r => r.fio && r.author === 'Guest reviewer'), `${label}: a guest's comment says "Guest reviewer"`);
  expect(!rows.some(r => r.text.startsWith('Open on the product')), `${label}: a Frame.io comment marked done is with the resolved notes, not the open ones`);
  await shot(page, `${tag}-3-ready-light`);
  await theme(page, 'dark'); await shot(page, `${tag}-3-ready-dark`); await theme(page, 'light');

  // A video time moves the player there; it does not start playing.
  await page.locator('#calCommentsFeed .cal-cm-row.is-frameio .cal-cm-tc', { hasText: '0:09' }).click();
  await sleep(500);
  let vi = await videoInfo(page);
  expect(Math.abs(vi.t - 9) < 0.6 && vi.paused, `${label}: a comment's time moves the video there and leaves it paused (at ${vi.t.toFixed(2)})`);
  // The play button plays it, with sound; again pauses it.
  await page.locator('#calNotesStage .fv-play').click();
  await page.waitForFunction(() => { const v = document.querySelector('#calNotesStage .fv-video'); return v && !v.paused && v.currentTime > 9.2; }, null, { timeout: 8000 });
  vi = await videoInfo(page);
  expect(!vi.paused && !vi.muted, `${label}: pressing play plays it, with sound`);
  expect(await page.locator('#calNotesStage .fv-play').getAttribute('aria-label') === 'Pause', `${label}: and the button becomes Pause`);
  await page.locator(PLAYER).hover().catch(() => {});
  await page.locator('#calNotesStage .fv-play').click();
  await sleep(300);
  expect((await videoInfo(page)).paused, `${label}: pressing it again pauses it`);
  await shot(page, `${tag}-4-playing-light`);

  // DOOR 2: the card's Notes button opens the very same view, also paused.
  await closeView(page);
  expect(!(await vOpen(page)) && (await page.locator('#calNotesStage .fv-video').count()) === 0, `${label}: closing stops the video and takes the player away`);
  state.calls.length = 0;
  await page.locator('[data-comments-btn="v1"]').click();
  await waitReady(page);
  await waitFio(page);
  const shape2 = await checkOneView(page, `${label}: from the Notes button`, device);
  expect(Math.abs(shape1.stage.w - shape2.stage.w) <= 2 && Math.abs(shape1.modal.w - shape2.modal.w) <= 2 && Math.abs(shape1.modal.h - shape2.modal.h) <= 2, `${label}: both doors open the same layout (player ${shape1.stage.w}/${shape2.stage.w}, notes ${shape1.modal.w}/${shape2.modal.w})`);
  expect((await feedRows(page)).filter(r => r.fio).length === rows.filter(r => r.fio).length, `${label}: with the same Frame.io comments`);
  expect(await page.locator('#calCommentComposer').count() === 1, `${label}: and the notes can still be written in`);
  await closeView(page);

  // A card whose video is not a Frame.io link: the Notes dialog as it always was.
  await page.locator('[data-comments-btn="d1"]').click();
  await sleep(500);
  const plain = await viewShape(page);
  expect(plain.open && !plain.video && !plain.stageShown, `${label}: a Drive link card's Notes have no player`);
  if (!device.isMobile) expect(plain.modal.w <= 562, `${label}: and the Notes dialog keeps its own size (${plain.modal.w} px)`);
  await closeView(page);
  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

// The ways it can go wrong, on a desktop.
async function statesRun(browser, origin) {
  console.log('--- desktop: when things go wrong ---');
  const DESK = { viewport: { width: 1440, height: 900 } };
  // 1. the function refuses: a sentence, Try again and the Frame.io link; Try again asks again and it loads
  {
    const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    state.view = (n, body) => (body.part === 'video' && !state.okNow ? { status: 502, body: { ok: false, error: 'frameio_unavailable', message: 'Frame.io did not answer. Try again in a minute.' } } : { status: 200, body: answerFor(body) });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, DESK);
    await page.evaluate(() => openCalComments('v1'));
    await waitState(page, 'error');
    const txt = await page.locator(PLAYER + ' .fv-state').innerText();
    expect(txt.includes('Frame.io did not answer'), 'error: said in a sentence');
    expect(await page.locator(PLAYER + ' .fv-state a.fv-btn').getAttribute('href') === FRAME, 'error: the Frame.io link still works from the error');
    await shot(page, 'desktop-5-error-light');
    await theme(page, 'dark'); await shot(page, 'desktop-5-error-dark'); await theme(page, 'light');
    state.okNow = true;
    await page.locator(PLAYER + ' .fv-state button', { hasText: 'Try again' }).click();
    await waitReady(page);
    expect((await videoInfo(page)).paused, 'error: Try again loads the video, still without playing it');
    expect(pageErrors.length === 0, `error: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
  // 2. the comments fail alone: the video is fine, the list says so with Try again
  {
    const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1)] });
    state.view = (n, body) => (body.part === 'comments' && !state.okNow ? { status: 502, body: { ok: false, message: 'no' } } : { status: 200, body: answerFor(body) });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, DESK);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    await page.waitForSelector('#calCommentsFeed .cal-cm-fio-note', { timeout: 8000 });
    expect((await page.locator('#calCommentsFeed .cal-cm-fio-note').innerText()).includes('could not be loaded'), 'comments fail: the list says the Frame.io comments could not be loaded');
    expect(await page.locator('#calCommentsFeed .cal-cm-fio-skeleton').count() === 0, 'comments fail: and stops showing loading rows');
    state.okNow = true;
    await page.locator('#calCommentsFeed .cal-cm-fio-retry').click();
    await waitFio(page);
    expect(await page.locator('#calCommentsFeed .cal-cm-row.is-frameio').count() >= 2, 'comments fail: Try again brings them in');
    expect(pageErrors.length === 0, `comments fail: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
  // 3. no Frame.io comments and no notes: the empty message, once, and no box
  {
    const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1)] });
    state.view = (n, body) => ({ status: 200, body: Object.assign(answerFor(body), body.part === 'comments' ? { comments: [] } : {}) });
    const { page, ctx } = await openCalendar(browser, origin, state, DESK);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    await page.waitForFunction(() => !document.querySelector('.cal-cm-fio-skeleton'), null, { timeout: 8000 });
    expect(await page.locator('#calCommentsFeed .cal-comments-empty').count() === 1 && await page.locator('#calCommentsFeed .cal-cm-row').count() === 0, 'no comments: one "No notes yet" message');
    await shot(page, 'desktop-6-nocomments-light');
    await ctx.close();
  }
  // 4. the address stops working (the full-size and the small file both refused): asked for again once, and ready again
  {
    const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1)], mediaFail: 2 });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, DESK);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    expect(state.calls.filter(c => c.part === 'video').length === 2, `expired: the address was asked for once more (${state.calls.filter(c => c.part === 'video').length} video requests)`);
    expect(pageErrors.length === 0, `expired: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
  // 5. a slow connection starts on the small file; a full-size file that fails hands over to the small one
  for (const [what, extra, init] of [
    ['slow connection', {}, "Object.defineProperty(navigator,'connection',{value:{effectiveType:'3g',downlink:1.4,saveData:false},configurable:true});"],
    ['full-size file fails', { hqFail: true }, ''],
  ]) {
    const state = makeState(Object.assign({ cards: [card('v1', 'Video card', FRAME, 1)] }, extra));
    const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, DESK));
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    await seedStaffGate(page);
    await installRoutes(ctx, origin, state);
    await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
    await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [NAME]);
    await page.waitForSelector('.cal-card[data-pid="v1"]', { timeout: 20000 });
    await sleep(600);
    await page.evaluate(() => openCalComments('v1'));
    await page.waitForFunction(() => { const v = document.querySelector('#calNotesStage .fv-video'); return v && v.readyState >= 2 && (v.getAttribute('src') || '').indexOf('q=hq') === -1; }, null, { timeout: 20000 });
    expect(state.mediaLog.includes('small') && (what !== 'slow connection' || !state.mediaLog.includes('full')), `${what}: the small file plays (${state.mediaLog.join(',')})`);
    if (what !== 'slow connection') expect(!(await page.locator('#calNotesStage .fv-small-note').isHidden()), `${what}: and the player says so, quietly`);
    expect(await page.locator(PLAYER).getAttribute('data-state') === 'ready', `${what}: no error is shown`);
    await ctx.close();
  }
}

async function smmReviewRun(browser, origin, label, device, orient) {
  const portrait = orient === 'portrait';
  const tag = label + (portrait ? '-vertical' : '');
  console.log(`--- ${label}${portrait ? ', vertical video' : ''}: Review tab (staff) ---`);
  const state = makeState({ orient: portrait ? 'portrait' : 'landscape', cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval', thumbnail_url: POSTER_URL, video_tweaks: JSON.stringify([{ id: 'sn1', role: 'smm', author: 'Fixture SMM', body: 'Trim the end.', created_at: iso(60), done: false }]) })] });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device, { view: 'smmreview' });
  await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-cal-review-pid="v1"] .cal-review-body', { timeout: 10000 });
  const panel = '.cal-review-panel[data-comp="video"]';
  await page.locator(panel + ' .fv-frameio-link:not([hidden])').waitFor({ timeout: 8000 });
  expect((await page.locator(panel + ' .cal-review-video-tile').innerText()).trim() === 'Watch video', `${tag}: the preview says "Watch video"`);
  const fl = page.locator(panel + ' .fv-frameio-link');
  expect(await fl.getAttribute('href') === FRAME && await fl.getAttribute('target') === '_blank', `${tag}: a small "Watch in Frame.io" link opens Frame.io in a new tab`);
  await page.locator(panel).scrollIntoViewIfNeeded();
  await shot(page, `review-staff-${tag}-1-light`);
  await page.locator(panel + ' .cal-review-video-tile').click();
  await waitReady(page);
  await waitFio(page);
  await checkOneView(page, `${tag}: from the Review tab`, device);
  expect(await page.locator('#calCommentsFeed .cal-cm-row:not(.is-frameio)', { hasText: 'Trim the end.' }).count() === 1 && await page.locator('#calCommentsFeed .cal-cm-row.is-frameio').count() >= 2, `${tag}: the card's notes and its Frame.io comments, together`);
  expect(state.mediaLog[0] === 'full' && !state.mediaLog.includes('small'), `${tag}: the full-size file on a normal connection (${state.mediaLog.join(',')})`);
  await shot(page, `review-staff-${tag}-2-view-light`);
  await theme(page, 'dark'); await shot(page, `review-staff-${tag}-2-view-dark`); await theme(page, 'light');
  expect(pageErrors.length === 0, `${tag}: Review tab (staff): no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function kasperRun(browser, origin, label, device) {
  console.log(`--- ${label}: Kasper review ---`);
  const state = makeState({ fakeSupabase: true });
  state.cards = [card('k1', 'Kasper fixture card', FRAME, 1, {
    video_tweaks: JSON.stringify([{ id: 'kn1', role: 'smm', author: 'Fixture SMM', body: 'Kasper queue note.', created_at: iso(120), done: false }]),
    status: 'Kasper Approval', video_status: 'Kasper Approval', graphic_status: 'Client Approval', caption_status: 'Kasper Approval',
    thumbnail_url: POSTER_URL, video_deliverable_id: 'del_v_k1', graphic_deliverable_id: 'del_g_k1',
    video_status_at: '2026-09-30 19:38:51.555501+00', caption_status_at: '2026-09-30 19:38:52+00', kasper_finished_at: null, kasper_closed_at: null,
  })];
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, device));
  await installRoutes(ctx, origin, state);
  await seedStaffIdentity(ctx, ADMIN);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await page.goto(`${origin}/?Kasper=1#kasper`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window.__rts && window.__rts['kasper-cal']) === 'function' && typeof wlMergeClientsFromSheet === 'function', null, { timeout: 25000 });
  await page.evaluate(name => { wlMergeClientsFromSheet([name]); window.__rts['kasper-cal']({}); }, NAME);
  await page.waitForSelector('#kasperReviewBody .kcard[data-kasper-pid="k1"]', { timeout: 25000 });
  const row = page.locator('.kcard[data-kasper-pid="k1"] .kcard-watch-here');
  await row.and(page.locator(':visible')).waitFor({ timeout: 8000 });
  expect(await page.locator('.kcard[data-kasper-pid="k1"] a.kcard-watch-btn').count() === 1, `${label}: the normal "Watch video" link is still there`);
  await shot(page, `kasper-${label}-1-light`);
  await row.click();
  await waitReady(page);
  await waitFio(page);
  await checkOneView(page, `${label}: Kasper's "Watch here"`, device);
  expect(await page.locator('#calCommentsFeed .cal-cm-row:not(.is-frameio)', { hasText: 'Kasper queue note.' }).count() === 1 && await page.locator('#calCommentsFeed .cal-cm-row.is-frameio').count() >= 2, `${label}: Kasper sees the card's notes and its Frame.io comments, though the card is in his queue and not in the Calendar`);
  expect(state.calls.some(c => c.part === 'video' && !!c.key), `${label}: asked with the staff key`);
  await shot(page, `kasper-${label}-2-view-light`);
  await theme(page, 'dark'); await shot(page, `kasper-${label}-2-view-dark`); await theme(page, 'light');
  await page.keyboard.press('Escape');
  await sleep(300);
  expect(!(await vOpen(page)), `${label}: Escape closes it`);
  // The opened card's video preview opens the same view.
  await page.locator('.kcard[data-kasper-pid="k1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-kasper-pid="k1"] .cal-review-body', { timeout: 10000 });
  const kTile = page.locator('.kcard[data-kasper-pid="k1"] .cal-review-body .cal-review-panel[data-comp="video"] .cal-review-video-tile');
  expect((await kTile.innerText()).trim() === 'Watch video', `${label}: the opened card's preview says "Watch video"`);
  await kTile.click();
  await waitReady(page);
  await checkOneView(page, `${label}: Kasper's preview`, device);
  expect(pageErrors.length === 0, `${label}: Kasper: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function clientLinkRun(browser, origin, label, device, over) {
  const portrait = !!(over && over.portrait);
  const tag = label + (portrait ? ' vertical' : '');
  console.log(`--- ${label}${portrait ? ', vertical video' : ''}: a client link page ---`);
  const on = !(over && over.off);
  const notes = [{ id: 'cn1', role: 'client', author: 'Fixture Client', body: 'Love the start.', created_at: iso(100), done: false, audience: 'client' }];
  const state = makeState(Object.assign({ orient: portrait ? 'portrait' : 'landscape', cards: [card('c1', 'Client fixture card', FRAME, 1, { status: 'Client Approval', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', video_deliverable_id: 'del_client_v1', thumbnail_url: POSTER_URL, video_tweaks: JSON.stringify(notes) })] }, over && over.state));
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, device));
  await installRoutes(ctx, origin, state);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await page.goto(`${origin}/index.html?${new URLSearchParams({ c: NAME, t: 'fixture-review-token', v: 'calendar' })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kcard[data-cal-review-pid="c1"]', { timeout: 30000 });
  await page.locator('.kcard[data-cal-review-pid="c1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-cal-review-pid="c1"] .cal-review-body', { timeout: 10000 });
  await page.locator('.kcard[data-cal-review-pid="c1"] .pocket-cal-fold > summary').first().click().catch(() => {});
  await sleep(1200);
  const panel = '.cal-review-panel[data-comp="video"]';
  expect(await page.locator(panel).count() >= 1, `${label}: the review card is on screen`);
  expect(await page.locator('.fv-watch-btn, .cal-thumb-play, .kcard-watch-here').count() === 0, `${label}: no staff buttons on a client link`);
  expect(state.flagReads >= 1, `${label}: the page reads the switch row`);
  const tile = page.locator(panel + ' .cal-review-video-tile').first();
  if (!on) {
    expect((await tile.innerText()).trim() === 'Open video ↗' && await page.locator(panel + ' .fv-frameio-link:visible').count() === 0, `${label}: switched off: "Open video", no Frame.io link, as before`);
    expect(await tile.evaluate(e => !e.hasAttribute('data-fv-on') && e.getAttribute('href') === 'https://f.io/fixture-video' && e.getAttribute('target') === '_blank'), `${label}: switched off: the tile is still a plain link to the video`);
    await tile.evaluate(e => e.addEventListener('click', ev => ev.preventDefault(), { once: true })); await tile.click(); await sleep(400);
    expect(state.calls.length === 0 && !(await vOpen(page)), `${label}: switched off: clicking asks the function nothing and opens nothing`);
    await page.evaluate(() => openCalComments('c1')); await sleep(500);
    const v = await viewShape(page);
    expect(v.open && !v.video && state.calls.length === 0, `${label}: switched off: the Notes have no player`);
    expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
    return;
  }
  expect((await tile.innerText()).trim() === 'Watch video', `${label}: the preview says "Watch video"`);
  await page.locator(panel).first().scrollIntoViewIfNeeded();
  await shot(page, `review-client-${tag}-1-light`);
  await tile.click();
  await waitReady(page);
  await checkOneView(page, `${label}: from the Review tab`, device);
  await sleep(600);
  expect(state.calls.length >= 1 && state.calls.every(c => !!c.clientToken && !c.key), `${label}: asked with the client's token, never a staff key`);
  expect(state.calls.every(c => Object.keys(c.body).join() === 'card_id' && c.body.card_id === 'c1'), `${label}: every request carries only the card's id, never asks for comments (${state.calls.map(c => JSON.stringify(c.body)).join(' ')})`);
  expect(await page.locator('.cal-cm-row.is-frameio, .cal-cm-fio-skeleton, .cal-cm-fio-note, .cal-cm-src-label').count() === 0, `${label}: no Frame.io comment, loading row or note anywhere`);
  expect(await page.locator('#calCommentsFeed .cal-cm-row', { hasText: 'Love the start.' }).count() === 1, `${label}: the client's own notes are there`);
  await checkPlayButton(page, label);
  await shot(page, `review-client-${tag}-2-view-light`);
  await theme(page, 'dark'); await shot(page, `review-client-${tag}-2-view-dark`); await theme(page, 'light');
  await page.locator('#calNotesStage .fv-play').click();
  await page.waitForFunction(() => { const v = document.querySelector('#calNotesStage .fv-video'); return v && !v.paused && v.currentTime > 0.2 && !v.muted; }, null, { timeout: 8000 });
  expect(true, `${label}: pressing play plays it, with sound`);
  expect(await page.locator('#calNotesStage .fv-video').getAttribute('src') === MEDIA_HQ, `${label}: the full-size file the function gave`);
  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

// WHO SEES IT: the one switch row. Hidden unless it lists the client (or says all), and hidden on any doubt.
const BUTTONS = '.cal-thumb-play, .fv-watch-btn, .kcard-watch-here, .fv-frameio-link';
const visibleButtons = page => page.evaluate(sel => Array.from(document.querySelectorAll(sel)).filter(b => !b.hidden && getComputedStyle(b).display !== 'none').length, BUTTONS);
const canOpen = async page => {
  await page.evaluate(() => { const b = document.querySelector('.cal-thumb-play, .fv-watch-btn, .kcard-watch-here'); if (b) svFrameOpen(b); });
  await sleep(700);
  const viaDoor = await page.evaluate(() => !!document.querySelector('#calNotesShell[data-video]'));
  await page.evaluate(() => { if (typeof closeCalComments === 'function') closeCalComments(); openCalComments('v1'); });
  await sleep(500);
  const viaNotes = await page.evaluate(() => !!document.querySelector('#calNotesShell[data-video]'));
  await page.evaluate(() => closeCalComments());
  return viaDoor && viaNotes ? true : (!viaDoor && !viaNotes ? false : 'mixed');
};
async function flagRun(browser, origin) {
  console.log('--- desktop: the switch row ---');
  const desktop = { viewport: { width: 1440, height: 900 } };
  const cases = [
    ['no row at all', { frameFlag: null }, false],
    ['a row that lists a different client', { frameFlag: { all: false, clients: ['someotherclient'] } }, false],
    ['a row with an empty list', { frameFlag: { all: false, clients: [] } }, false],
    ['a row of the wrong shape (a list of names, no "all")', { frameFlag: 'fixtureclient' }, false],
    ['all as the text "true" (not the value true)', { frameFlag: { all: 'true', clients: [] } }, false],
    ['a read that fails', { flagFail: true }, false],
    ['a row that lists the client', { frameFlag: { all: false, clients: [SLUG] } }, true],
    ['a row that lists the client by its display name', { frameFlag: { all: false, clients: [NAME] } }, true],
    ['all: true, whoever the client is', { frameFlag: { all: true, clients: ['someotherclient'] } }, true],
  ];
  for (const [label, over, want] of cases) {
    const state = makeState(over);
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, desktop);
    await sleep(1200);   // the switch read lands
    const shownNow = await visibleButtons(page);
    expect(state.flagReads >= 1, `switch: ${label}: the page read the switch row`);
    expect(want ? shownNow >= 1 : shownNow === 0, `switch: ${label}: the play icon is ${want ? 'shown' : 'hidden'} on the Calendar card (${shownNow} visible)`);
    expect(await canOpen(page) === want, `switch: ${label}: the player ${want ? 'opens with the notes' : 'is not in the Notes, and the icon cannot open it even by calling it'}`);
    expect(want || state.calls.length === 0, `switch: ${label}: ${want ? 'ok' : 'nothing was asked of the function'}`);
    expect(pageErrors.length === 0, `switch: ${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }

  // Off on the Review tab, then on and off again live, without a reload.
  {
    const state = makeState({ fakeSupabase: true, frameFlag: null, cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval' })] });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, desktop, { view: 'smmreview' });
    await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
    await page.waitForSelector('.cal-review-panel[data-comp="video"]', { timeout: 10000 });
    await sleep(1200);
    const tileSel = '.cal-review-panel[data-comp="video"] .cal-review-video-tile';
    expect(await visibleButtons(page) === 0, 'switch: no row: nothing shown in the SMM review panel');
    const tile = await page.evaluate(() => { const t = document.querySelector('.cal-review-panel[data-comp="video"] .cal-review-video-tile'); const w = t.parentElement; return { wrapper: w.className, display: getComputedStyle(w).display, text: t.innerText.trim(), on: t.hasAttribute('data-fv-on'), label: t.getAttribute('aria-label') }; });
    expect(!/fv-review-video/.test(tile.wrapper) || tile.display === 'contents', `switch: no row: the review tile sits where it always did (${tile.wrapper || 'no wrapper'} / ${tile.display})`);
    expect(tile.text === 'Open video ↗' && !tile.on && tile.label === 'Open video', `switch: no row: the preview still says "Open video" (${tile.text})`);
    await page.locator(tileSel).evaluate(e => e.addEventListener('click', ev => ev.preventDefault(), { once: true }));
    await page.locator(tileSel).click(); await sleep(400);
    expect(state.calls.length === 0 && !(await vOpen(page)), 'switch: no row: clicking the preview just follows the link (nothing asked, nothing opened)');
    await shot(page, 'switch-off-smm-review');
    await page.waitForFunction(() => typeof (window.__rts && window.__rts['syncview-frame-viewer-flag']) === 'function', null, { timeout: 10000 });
    // Notes open while the switch is off; it turns on: the player joins the open view.
    await page.evaluate(() => openCalComments('v1')); await sleep(400);
    expect(!(await viewShape(page)).video, 'switch: no row: the Notes have no player');
    await page.evaluate(slug => window.__rts['syncview-frame-viewer-flag']({ new: { value: { all: false, clients: [slug] } } }), SLUG);
    await waitReady(page);
    expect((await viewShape(page)).video, 'switch: realtime: the row is added and the open Notes get the player without a reload');
    await page.evaluate(() => window.__rts['syncview-frame-viewer-flag']({ old: { key: 'frame_viewer_clients' } }));
    await sleep(400);
    const off = await viewShape(page);
    expect(off.open && !off.video && await page.locator('#calNotesStage .fv-video').count() === 0, 'switch: realtime: the row is deleted and the player leaves the open Notes (the notes stay)');
    await page.evaluate(() => closeCalComments());
    await page.evaluate(() => onCalViewChange('smmreview')); await sleep(600);
    const offNow = await page.evaluate(sel => ({ text: document.querySelector(sel).innerText.trim(), shown: Array.from(document.querySelectorAll('.fv-frameio-link')).filter(l => getComputedStyle(l).display !== 'none').length }), tileSel);
    expect(offNow.text === 'Open video ↗' && offNow.shown === 0, 'switch: realtime: the Review tab goes back to "Open video"');
    expect(pageErrors.length === 0, `switch: Review tab: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
  {
    const state = makeState({ fakeSupabase: true, frameFlag: null });
    state.cards = [card('k1', 'Kasper fixture card', FRAME, 1, { status: 'Kasper Approval', video_status: 'Kasper Approval', graphic_status: 'Client Approval', caption_status: 'Kasper Approval',
      thumbnail_url: 'https://example.invalid/t.jpg', video_deliverable_id: 'del_v_k1', graphic_deliverable_id: 'del_g_k1', video_status_at: '2026-09-30 19:38:51.555501+00', caption_status_at: '2026-09-30 19:38:52+00' })];
    const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, desktop));
    await installRoutes(ctx, origin, state);
    await seedStaffIdentity(ctx, ADMIN);
    const page = await ctx.newPage();
    const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
    await page.goto(`${origin}/?Kasper=1#kasper`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window.__rts && window.__rts['kasper-cal']) === 'function' && typeof wlMergeClientsFromSheet === 'function', null, { timeout: 25000 });
    await page.evaluate(name => { wlMergeClientsFromSheet([name]); window.__rts['kasper-cal']({}); }, NAME);
    await page.waitForSelector('#kasperReviewBody .kcard[data-kasper-pid="k1"]', { timeout: 25000 });
    await page.locator('.kcard[data-kasper-pid="k1"] .kcard-expand-btn').click();
    await page.waitForSelector('.kcard[data-kasper-pid="k1"] .cal-review-body', { timeout: 10000 });
    await sleep(1200);
    expect(await visibleButtons(page) === 0, 'switch: no row: nothing shown in Kasper\'s review (row and opened card)');
    await page.waitForFunction(() => typeof (window.__rts && window.__rts['syncview-frame-viewer-flag']) === 'function', null, { timeout: 10000 });
    await page.evaluate(slug => window.__rts['syncview-frame-viewer-flag']({ new: { value: { all: false, clients: [slug] } } }), SLUG);
    await sleep(300);
    expect(await visibleButtons(page) >= 2, `switch: realtime: the row is added and the buttons appear without a reload (${await visibleButtons(page)})`);
    await page.evaluate(() => window.__rts['syncview-frame-viewer-flag']({ new: { value: { all: false, clients: ['someotherclient'] } } }));
    await sleep(300);
    expect(await visibleButtons(page) === 0, 'switch: realtime: the list changes to someone else and they go');
    await page.evaluate(() => window.__rts['syncview-frame-viewer-flag']({ new: { value: { all: true, clients: [] } } }));
    await sleep(300);
    expect(await visibleButtons(page) >= 2, 'switch: realtime: all: true shows them');
    await page.evaluate(() => window.__rts['syncview-frame-viewer-flag']({ old: { key: 'frame_viewer_clients' } }));
    await sleep(300);
    expect(await visibleButtons(page) === 0, 'switch: realtime: the row is deleted (no new row) and they go');
    expect(pageErrors.length === 0, `switch: Kasper: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
}

// FAST START: press to first video frame, measured in a real page. The function and the media take as long as the real
// ones measured against Frame.io (see serverModel and mediaDelay in makeState), so the number is the page's own part.
// The first frame is shown, not played: nothing plays until the person presses play.
async function startTimes(browser, origin, label) {
  const out = {};
  for (const scenario of ['click only', 'after a 400 ms hover']) {
    const state = makeState({ serverModel: true, mediaDelay: { small: 230, full: 330 }, orient: 'landscape', cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    const { page, ctx } = await openCalendar(browser, origin, state, { viewport: { width: 1440, height: 900 } });
    const ICON = '.cal-card[data-pid="v1"] .cal-thumb-play';
    await page.locator('.cal-card[data-pid="v1"]').scrollIntoViewIfNeeded();
    await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover({ position: { x: 6, y: 6 } });
    await page.locator(ICON).waitFor({ state: 'attached', timeout: 8000 });
    await sleep(300);
    if (scenario !== 'click only') { await page.locator(ICON).hover(); await sleep(400); }
    const callsBefore = state.calls.length;
    const t0 = Date.now();
    await page.locator(ICON).click({ force: true });
    const firstCall = state.calls.length > callsBefore ? state.calls[callsBefore].at - t0 : 99999;
    await page.waitForFunction(() => { const v = document.querySelector('#calNotesStage .fv-video'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { polling: 16, timeout: 20000 });
    const ms = Date.now() - t0;
    out[scenario] = { ms, callsBeforeClick: callsBefore, firstCallMs: firstCall < 0 ? 0 : firstCall, callsAfterClick: state.calls.length - callsBefore, src: await page.evaluate(() => document.querySelector('#calNotesStage .fv-video').getAttribute('src')) };
    await ctx.close();
  }
  console.log('TIMING ' + JSON.stringify({ build: label, press_to_first_frame_ms: { click_only: out['click only'].ms, after_400ms_hover: out['after a 400 ms hover'].ms } }));
  return out;
}
async function fastStartRun(browser, origin) {
  console.log('--- desktop: fast start ---');
  const r = await startTimes(browser, origin, 'this change');
  const a = r['click only'], b = r['after a 400 ms hover'];
  expect(b.callsBeforeClick >= 2, `fast start: pointing at the icon already asks for the video and the comments (${b.callsBeforeClick} requests before the click)`);
  expect(b.callsAfterClick === 0, 'fast start: the click itself asks for nothing more (it uses what the hover fetched)');
  expect(a.firstCallMs < 400 && a.callsAfterClick >= 2, `fast start: even with no hover, pressing the icon sends the requests at once (the first ${a.firstCallMs} ms after the press)`);
  expect(b.ms < a.ms - 100, `fast start: after a short hover the first frame is much sooner (${b.ms} ms against ${a.ms} ms)`);
  expect(a.ms < 2500 && b.ms < 1500, `fast start: the first frame comes in time (click only ${a.ms} ms, after a hover ${b.ms} ms)`);
  expect(a.src === MEDIA_HQ, 'fast start: and it is the full-size file');
}


/* ENCORE (2026-10-16): the owner's five points after using the view on a real card.
     1  the picture froze while the sound played: the card's thumbnail sat on top of the playing video. And the file
        choice: a full-size H.264 copy before the original upload, and a file that plays sound but no picture gives
        way to the small copy.
     2  speed (1x, 1.5x, 2x, kept while the dialog is open) and 5 seconds back and forward.
     3  no "Syncing this thread" line: while the notes load only skeleton rows, and nothing moves when they arrive.
     4  notes as fast as possible (timed in notesTimes).
     5  the card's play button in the middle of the thumbnail, round, like the player's own. */
// The player's controls fit inside it and none covers another, at whatever width the player has.
async function checkControlsFit(page, label) {
  const bar = await page.evaluate(() => { const r = (s) => { const e = document.querySelector('#calNotesStage ' + s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { s, x: Math.round(b.left), r: Math.round(b.right), y: Math.round(b.top), b: Math.round(b.bottom) } : null; };
    const p = document.querySelector('#calNotesStage .fv-player').getBoundingClientRect(); return { p: { x: p.left, r: p.right, w: Math.round(p.width) }, items: ['.fv-clock', '.fv-rate', '.fv-back', '.fv-play', '.fv-fwd', '.fv-mute', '.fv-full'].map(r) }; });
  const shown = bar.items.filter(Boolean);
  const overlap = shown.some((a, i) => shown.some((b, j) => j > i && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1));
  expect(!overlap && shown.every(b => b.x >= bar.p.x - 1 && b.r <= bar.p.r + 1) && shown.some(b => b.s === '.fv-rate') && shown.some(b => b.s === '.fv-play'), `${label}: on a ${bar.p.w} px player the controls (speed included) fit without overlapping (${shown.map(b => b.s.slice(4)).join(',')}${overlap ? ': ' + JSON.stringify(shown) : ''})`);
}
const NOTE_ROWS = (n) => Array.from({ length: n }, (_, i) => ({ id: 'pc' + (i + 1), body: 'Thread note ' + (i + 1) + ': tighten the cut.', author: 'Fixture SMM', role: 'smm', audience: 'internal', component: 'video', created_at: iso(400 - i * 30), source_created_at: iso(400 - i * 30), version: 1 }));
const playerTop = page => page.evaluate(() => {
  const p = document.querySelector('#calNotesStage .fv-player'); const b = p.getBoundingClientRect();
  const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height * 0.35);
  const poster = p.querySelector('.fv-poster');
  return { top: el ? (el.className || el.tagName) : '', posterShown: !!poster && getComputedStyle(poster).display !== 'none' };
});
async function encoreRun(browser, origin, label, device) {
  console.log(`--- ${label}: Encore ---`);
  const phone = device.viewport.width < 768;
  // 1. The picture moves: once playing, the video is on top, not the card's thumbnail.
  {
    const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    const before = await playerTop(page);
    await page.locator('#calNotesStage .fv-play').click();
    await page.waitForFunction(() => { const v = document.querySelector('#calNotesStage .fv-video'); return v && !v.paused && v.currentTime > 0.6; }, null, { timeout: 8000 });
    const playing = await playerTop(page);
    const frames = await page.evaluate(() => document.querySelector('#calNotesStage .fv-video').getVideoPlaybackQuality().totalVideoFrames);
    expect(/fv-video/.test(playing.top) && !playing.posterShown, `${label}: playing, the video itself is on top and the card's thumbnail is gone (top: ${playing.top}, thumbnail shown: ${playing.posterShown}; ${frames} frames drawn)`);
    expect(!before.posterShown || /fv-video/.test(before.top), `${label}: once the first frame is there the thumbnail no longer covers it (top: ${before.top})`);
    expect(await page.evaluate(() => document.querySelector('#calNotesStage .fv-video').getAttribute('data-fv-file')) === 'high_quality', `${label}: the full-size H.264 copy is the file playing`);

    // 2. Speed and skips.
    await page.locator('#calNotesStage .fv-play').click(); await sleep(200);
    const rate = () => page.evaluate(() => ({ r: document.querySelector('#calNotesStage .fv-video').playbackRate, label: document.querySelector('#calNotesStage .fv-rate').textContent }));
    expect((await rate()).label === '1x', `${label}: the speed button starts at 1x`);
    await page.locator(PLAYER).hover().catch(() => {});
    await page.locator('#calNotesStage .fv-rate').click();
    let rr = await rate();
    expect(rr.r === 1.5 && rr.label === '1.5x', `${label}: one press: 1.5x (${rr.r}, "${rr.label}")`);
    await page.locator('#calNotesStage .fv-rate').click();
    rr = await rate();
    expect(rr.r === 2 && rr.label === '2x', `${label}: two presses: 2x (${rr.r})`);
    await page.evaluate(() => svFrameStageRetry());
    await waitReady(page); await sleep(300);
    rr = await rate();
    expect(rr.r === 2 && rr.label === '2x', `${label}: the speed is kept when the player loads the video again (${rr.r})`);
    await page.evaluate(() => svFrameSeek(6)); await sleep(300);
    await page.locator(PLAYER).hover().catch(() => {});
    await page.locator('#calNotesStage .fv-back').click(); await sleep(250);
    let t = (await videoInfo(page)).t;
    expect(Math.abs(t - 1) < 0.4, `${label}: back 5 seconds from 0:06 lands on 0:01 (${t.toFixed(2)})`);
    await page.locator('#calNotesStage .fv-back').click(); await sleep(250);
    t = (await videoInfo(page)).t;
    expect(t < 0.2, `${label}: and never before the start (${t.toFixed(2)})`);
    await page.locator('#calNotesStage .fv-fwd').click(); await sleep(250);
    t = (await videoInfo(page)).t;
    expect(Math.abs(t - 5) < 0.4 && (await videoInfo(page)).paused, `${label}: forward 5 seconds, still paused (${t.toFixed(2)})`);
    await page.locator('#calNotesStage .fv-fwd').focus();
    await page.keyboard.press('j'); await sleep(250);
    t = (await videoInfo(page)).t;
    expect(Math.abs(t - 0) < 0.4, `${label}: J goes back 5 seconds too (${t.toFixed(2)})`);
    await checkControlsFit(page, label);
    await shot(page, `encore-${label}-controls-light`);
    await theme(page, 'dark'); await shot(page, `encore-${label}-controls-dark`); await theme(page, 'light');
    await closeView(page);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    expect((await rate()).label === '1x', `${label}: a new opening starts at 1x again`);
    await closeView(page);

    // 5. The card's play button: in the middle of the thumbnail, round, white with a dark triangle, in both themes.
    await page.locator('.cal-card[data-pid="v1"]').scrollIntoViewIfNeeded();
    if (!device.isMobile) await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover({ position: { x: 6, y: 6 } });
    await sleep(250);
    for (const mode of ['light', 'dark']) {
      await theme(page, mode);
      const g = await page.evaluate(() => {
        const th = document.querySelector('.cal-card[data-pid="v1"] .cal-card-thumb').getBoundingClientRect();
        const btn = document.querySelector('.cal-card[data-pid="v1"] .cal-thumb-play'); const b = btn.getBoundingClientRect(); const cs = getComputedStyle(btn);
        const pb = getComputedStyle(document.createElement('div'));
        return { dx: (b.left + b.width / 2) - (th.left + th.width / 2), dy: (b.top + b.height / 2) - (th.top + th.height / 2), w: b.width, h: b.height, radius: cs.borderRadius, bg: cs.backgroundColor, fg: cs.color, op: cs.opacity, shadow: cs.boxShadow };
      });
      expect(Math.abs(g.dx) <= 1.5 && Math.abs(g.dy) <= 1.5, `${label} ${mode}: the card's play button is in the middle of the thumbnail (${g.dx.toFixed(1)}, ${g.dy.toFixed(1)})`);
      expect(g.w === g.h && g.w >= 36 && g.w <= 44 && /50%|21px|19px/.test(g.radius) && g.bg === 'rgb(255, 255, 255)' && /rgb\((0, 0, 0|7, 8, 9)\)/.test(g.fg) && g.shadow !== 'none' && Number(g.op) === 1, `${label} ${mode}: a ${g.w} px round white button with a dark triangle and a shadow, readable on light and dark thumbnails (${g.bg}, ${g.fg})`);
      await shot(page, `encore-${label}-card-button-${mode}`);
    }
    await theme(page, 'light');
    // The player's own play button looks the same.
    await page.evaluate(() => openCalComments('v1')); await waitReady(page);
    const pp = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#calNotesStage .fv-play')); return { bg: cs.backgroundColor, fg: cs.color }; });
    expect(pp.bg === 'rgb(255, 255, 255)' && /rgb\((0, 0, 0|7, 8, 9)\)/.test(pp.fg), `${label}: the player's own play button is the same white round button (${pp.bg})`);
    await closeView(page);
    expect(pageErrors.length === 0, `${label}: Encore: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
  if (phone) return;
  // 1. Which file: the original upload only when Frame.io has no H.264 copy.
  for (const sc of [
    { name: 'the function names the original first', video: { url: MEDIA_HQ + '&o=1', renditions: RENDITIONS }, want: 'high_quality' },
    { name: 'only the small copy and the original', video: { url: MEDIA_HQ + '&o=1', renditions: { efficient: MEDIA, original: MEDIA_HQ + '&o=1' } }, want: 'efficient' },
    { name: 'only the original', video: { url: MEDIA_HQ + '&o=1', renditions: { original: MEDIA_HQ + '&o=1' } }, want: 'original' },
  ]) {
    const g = GOOD(); g.video = Object.assign({}, g.video, sc.video);
    const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })], view: (n, body) => ({ status: 200, body: answerFor(body, g) }) });
    const { page, ctx } = await openCalendar(browser, origin, state, device);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    const f = await page.evaluate(() => document.querySelector('#calNotesStage .fv-video').getAttribute('data-fv-file'));
    expect(f === sc.want && (state.fileLog || [])[0] === sc.want, `${label}: ${sc.name}: plays ${sc.want} (${f}; fetched ${(state.fileLog || []).join(',')})`);
    await ctx.close();
  }
  // 1. Sound but no picture (an HEVC file on Windows Chrome): the small H.264 copy takes over from the same second.
  {
    const state = makeState({ soundOnly: ['high_quality'], cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    await page.locator('#calNotesStage .fv-play').click();
    await page.waitForFunction(() => { const v = document.querySelector('#calNotesStage .fv-video'); return v && v.getAttribute('data-fv-file') === 'efficient' && v.videoWidth > 0 && !v.paused && v.currentTime > 1.2; }, null, { timeout: 12000 }).catch(() => {});
    const v = await page.evaluate(() => { const e = document.querySelector('#calNotesStage .fv-video'); return { f: e.getAttribute('data-fv-file'), w: e.videoWidth, t: e.currentTime, paused: e.paused }; });
    expect(v.f === 'efficient' && v.w > 0 && !v.paused && v.t > 1, `${label}: sound but no picture: the small copy takes over and keeps playing with a picture (${JSON.stringify(v)})`);
    expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
  {
    const g = GOOD(); g.video = Object.assign({}, g.video, { url: MEDIA_HQ + '&o=1', renditions: { original: MEDIA_HQ + '&o=1' } });
    const state = makeState({ soundOnly: ['original'], view: (n, body) => ({ status: 200, body: answerFor(body, g) }), cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    const { page, ctx } = await openCalendar(browser, origin, state, device);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    await page.locator('#calNotesStage .fv-play').click();
    await waitState(page, 'error').catch(() => {});
    const txt = await page.evaluate(() => (document.querySelector('#calNotesStage .fv-state-text') || {}).textContent || '');
    expect(/sound but no picture/i.test(txt) && await page.locator('#calNotesStage .fv-state a[href]').count() === 1, `${label}: with only the original and no picture, the player says so and offers Frame.io ("${txt.slice(0, 60)}")`);
    await shot(page, `encore-${label}-no-picture-light`);
    await ctx.close();
  }
}


/* 6 (owner, 2026-10-17): whenever the video cannot play properly, "Having trouble playing this? Open it in Frame.io"
   over the player, with the same Frame.io link; in place, nothing moves; gone when playback recovers. */
async function troubleRun(browser, origin, label, device) {
  console.log(`--- ${label}: having trouble playing ---`);
  const geo = page => page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return ''; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round).join(','); };
    return r('#calNotesStage .fv-player') + '|' + r('#calCommentsModal .cal-cm-composer') + '|' + r('#calNotesStage .fv-stage-foot'); });
  // The error case: every file refuses (an address that keeps failing): the error panel says it, with the link.
  {
    const state = makeState({ mediaFail: 999, cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
    await page.evaluate(() => openCalComments('v1'));
    await waitState(page, 'error');
    const e = await page.evaluate(() => { const st = document.querySelector('#calNotesStage .fv-state'); const a = st.querySelector('a.fv-btn'); const b = st.getBoundingClientRect(), p = document.querySelector('#calNotesStage .fv-player').getBoundingClientRect();
      return { title: (st.querySelector('.fv-state-title') || {}).textContent || '', href: a ? a.getAttribute('href') : '', label: a ? a.textContent.trim() : '', over: Math.abs(b.left - p.left) < 2 && Math.abs(b.top - p.top) < 2 && Math.abs(b.width - p.width) < 2, open: document.querySelector('#calNotesStage .fv-open-link').getAttribute('href') }; });
    expect(e.title === 'Having trouble playing this? Open it in Frame.io', `${label}: a video that cannot be loaded says "${e.title}"`);
    expect(e.href === e.open && e.href === OPEN_URL && e.label === 'Open in Frame.io', `${label}: its button opens the same Frame.io link as "Open in Frame.io" (${e.href})`);
    expect(e.over, `${label}: the message sits over the player, in its place`);
    await shot(page, `trouble-${label}-error-light`);
    await theme(page, 'dark'); await shot(page, `trouble-${label}-error-dark`); await theme(page, 'light');
    expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
  // A stall that does not recover for a while, then does: the strip comes, nothing moves, and it goes again.
  {
    const g = GOOD(); g.video = Object.assign({}, g.video, { url: MEDIA_HQ, renditions: { high_quality: MEDIA_HQ } });
    const state = makeState({ holdTail: 'high_quality', view: (n, body) => ({ status: 200, body: answerFor(body, g) }), cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
    await page.evaluate(() => openCalComments('v1'));
    await waitReady(page);
    const g0 = await geo(page);
    const strip = () => page.evaluate(() => { const t = document.querySelector('#calNotesStage .fv-trouble'); const cs = getComputedStyle(t); const a = t.querySelector('a');
      return { shown: cs.display !== 'none', text: (t.querySelector('.fv-trouble-text') || {}).textContent || '', href: a.getAttribute('href'), pos: cs.position }; });
    expect(!(await strip()).shown, `${label}: no message while the video is fine`);
    await page.locator('#calNotesStage .fv-play').click();
    await page.waitForFunction(() => { const t = document.querySelector('#calNotesStage .fv-trouble'); return t && getComputedStyle(t).display !== 'none'; }, null, { timeout: 25000 }).catch(() => {});
    const s1 = await strip(), g1 = await geo(page);
    expect(s1.shown && s1.text === 'Having trouble playing this? Open it in Frame.io' && s1.href === OPEN_URL && s1.pos === 'absolute', `${label}: a stall that does not recover shows the message over the video with the Frame.io button (${JSON.stringify(s1)}; tail asked ${state.tailAsked || 0})`);
    expect(g1 === g0, `${label}: and nothing moves (${g0} -> ${g1})`);
    await shot(page, `trouble-${label}-stall-light`);
    await theme(page, 'dark'); await shot(page, `trouble-${label}-stall-dark`); await theme(page, 'light');
    state.releaseTail = true;
    await page.waitForFunction(() => { const t = document.querySelector('#calNotesStage .fv-trouble'); return t && getComputedStyle(t).display === 'none'; }, null, { timeout: 15000 }).catch(() => {});
    const s2 = await strip(), v = await videoInfo(page);
    expect(!s2.shown && !v.paused, `${label}: when playback recovers the message goes (shown ${s2.shown}, playing ${!v.paused}, at ${v.t.toFixed(1)})`);
    expect(await geo(page) === g0, `${label}: still nothing moved`);
    expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }
}

/* 3 and 4: the notes of a card with a deliverable. The link check and the thread take as long as the live ones
   (deliverables read about 0.2 s; production-comments p50 1.78 s on the server, measured from the function logs on
   2026-10-16, so 1.9 s with the network). Measured: press (after a 400 ms hover, and with no hover) to the first note
   on screen. FRAMEIO_VIEWER_BUILD names the build in the TIMING line. */
async function notesTimes(browser, origin, label, device, checks) {
  const out = {};
  for (const scenario of ['click only', 'after a 400 ms hover']) {
    const state = makeState({ crosswalkDelay: 200, notesDelay: 1900, serverModel: true, mediaDelay: { small: 230, full: 330 }, notesRows: { 'del-v1': NOTE_ROWS(3) },
      cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL, video_deliverable_id: 'del-v1' })] });
    const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
    await sleep(2500); // the page's own first reads settle
    state.notesCalls = []; state.crosswalkCalls = [];
    const BTN = '[data-comments-btn="v1"]';
    await page.locator(BTN).scrollIntoViewIfNeeded();
    if (scenario !== 'click only' && !device.isMobile) { await page.locator(BTN).hover(); await sleep(400); }
    // Watch the composer and the feed for movement from the press on.
    await page.evaluate(() => {
      window.__moves = []; window.__noteAt = 0; window.__syncText = false; window.__skelSeen = false; window.__sendPendingSeen = false;
      const t0 = performance.now(); let last = null;
      const tick = () => {
        const c = document.querySelector('#calCommentsModal .cal-cm-composer'), f = document.getElementById('calCommentsFeed');
        if (c && f) {
          const cr = c.getBoundingClientRect(), fr = f.getBoundingClientRect();
          const now = [Math.round(cr.top), Math.round(cr.height), Math.round(fr.top), Math.round(fr.height)].join(',');
          if (last && now !== last) window.__moves.push(Math.round(performance.now() - t0) + ':' + last + '->' + now);
          last = now;
          if (/Syncing this thread|Sending unlocks/.test(document.getElementById('calCommentsModal').innerText)) window.__syncText = true;
          if (f.querySelector('.cal-cm-skeleton .cal-cm-skel-row')) window.__skelSeen = true;
          const send = document.querySelector('#calCommentsModal .cal-cm-send');
          if (send && send.disabled && /finish loading/.test(send.title || '')) window.__sendPendingSeen = true;
          if (!window.__noteAt && f.querySelector('.cal-cm-row:not(.is-frameio)')) window.__noteAt = performance.now() - t0;
        }
        if (performance.now() - t0 < 8000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    await page.locator(BTN).click();
    await page.waitForFunction(() => window.__noteAt > 0, null, { polling: 16, timeout: 15000 });
    const noteMs = await page.evaluate(() => Math.round(window.__noteAt));
    await sleep(2600);
    const w = await page.evaluate(() => ({ moves: window.__moves, sync: window.__syncText, skel: window.__skelSeen, pending: window.__sendPendingSeen, notes: document.querySelectorAll('#calCommentsFeed .cal-cm-row:not(.is-frameio)').length }));
    out[scenario] = { noteMs, notesReadStartMs: state.notesCalls.length ? state.notesCalls[0].at - t0 : null, crosswalkStartMs: state.crosswalkCalls.length ? state.crosswalkCalls[0] - t0 : null, watch: w };
    if (checks) {
      expect(w.notes === 3, `${label} (${scenario}): the card's 3 notes arrive (${w.notes})`);
      expect(!w.sync, `${label} (${scenario}): no "Syncing this thread" line at any point`);
      expect(w.moves.length === 0, `${label} (${scenario}): nothing moves while the notes load and arrive (composer and list stay put: ${w.moves.slice(0, 3).join(' ; ') || 'no moves'})`);
      expect(w.skel || noteMs < 150, `${label} (${scenario}): while loading, only skeleton rows`);
      // A reopen still reads the thread again (new notes from others), even right after the first open.
      const readsBefore = state.notesCalls.length;
      await page.evaluate(() => closeCalComments()); await sleep(200);
      await page.locator(BTN).click(); await sleep(300);
      expect(state.notesCalls.length === readsBefore + 1, `${label} (${scenario}): reopening reads the thread again (${state.notesCalls.length - readsBefore} new read)`);
      expect(state.notesCalls.length === readsBefore + 1 && readsBefore === 1, `${label} (${scenario}): and the hover and the press shared one read (${readsBefore} before the reopen)`);
      expect(pageErrors.length === 0, `${label} (${scenario}): no page errors (${pageErrors.join(' | ')})`);
    }
    if (scenario === 'click only' && SHOTS && checks) { /* the loading look is covered by encore screenshots below */ }
    await ctx.close();
  }
  console.log('NOTES_TIMING ' + JSON.stringify({ build: process.env.FRAMEIO_VIEWER_BUILD || 'this change', device: label, press_to_first_note_ms: { click_only: out['click only'].noteMs, after_400ms_hover: out['after a 400 ms hover'].noteMs }, detail: out }));
  return out;
}
async function notesRun(browser, origin, label, device) {
  console.log(`--- ${label}: notes speed and steadiness ---`);
  const r = await notesTimes(browser, origin, label, device, true);
  const a = r['click only'], b = r['after a 400 ms hover'];
  expect(a.notesReadStartMs != null && a.crosswalkStartMs != null && Math.abs(a.notesReadStartMs - a.crosswalkStartMs) < 150, `${label}: the thread is asked for beside the link check, not after it (thread at ${a.notesReadStartMs} ms, check at ${a.crosswalkStartMs} ms)`);
  expect(a.noteMs < 2400, `${label}: with no hover the first note is on screen in ${a.noteMs} ms (the read alone takes 1900)`);
  if (!device.isMobile) {
    expect(b.notesReadStartMs != null && b.notesReadStartMs < 0, `${label}: pointing at Notes starts the read before the press (${b.notesReadStartMs} ms)`);
    expect(b.noteMs < a.noteMs - 250, `${label}: after a short hover the first note is sooner (${b.noteMs} ms against ${a.noteMs} ms)`);
  }
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    if (process.env.FRAMEIO_VIEWER_TIMING_ONLY) { await startTimes(browser, origin, process.env.FRAMEIO_VIEWER_BUILD || 'this build'); return; }
    if (process.env.FRAMEIO_VIEWER_NOTES_TIMING_ONLY) { await notesTimes(browser, origin, 'desktop', { viewport: { width: 1440, height: 900 } }, false); await notesTimes(browser, origin, 'phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, false); return; }
    const DESK = { viewport: { width: 1440, height: 900 } }, PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const only = process.env.FRAMEIO_VIEWER_ONLY || '';
    const want = (n) => !only || only === n;
    if (want('fast')) await fastStartRun(browser, origin);
    if (want('calendar')) await calendarRun(browser, origin, 'desktop', DESK, 'landscape');
    if (want('calendar')) await calendarRun(browser, origin, 'phone', PHONE, 'landscape');
    if (want('calendar')) await calendarRun(browser, origin, 'desktop', DESK, 'portrait');
    if (want('calendar')) await calendarRun(browser, origin, 'phone', PHONE, 'portrait');
    if (want('states')) await statesRun(browser, origin);
    if (want('smm')) await smmReviewRun(browser, origin, 'desktop', DESK, 'landscape');
    if (want('smm')) await smmReviewRun(browser, origin, 'phone', PHONE, 'portrait');
    if (want('kasper')) await kasperRun(browser, origin, 'desktop', DESK);
    if (want('kasper')) await kasperRun(browser, origin, 'phone', PHONE);
    if (want('client')) await clientLinkRun(browser, origin, 'client desktop', DESK);
    if (want('client')) await clientLinkRun(browser, origin, 'client phone', PHONE);
    if (want('client')) await clientLinkRun(browser, origin, 'client desktop', DESK, { portrait: true });
    if (want('client')) await clientLinkRun(browser, origin, 'client phone', PHONE, { portrait: true });
    if (want('client')) await clientLinkRun(browser, origin, 'client, switched off', PHONE, { off: true, state: { frameFlag: null } });
    if (want('client')) await clientLinkRun(browser, origin, 'client, another client listed', PHONE, { off: true, state: { frameFlag: { all: false, clients: ['someotherclient'] } } });
    if (want('flags')) await flagRun(browser, origin);
    if (want('encore')) await encoreRun(browser, origin, 'desktop', DESK);
    if (want('encore')) await encoreRun(browser, origin, 'phone', PHONE);
    if (want('trouble')) await troubleRun(browser, origin, 'desktop', DESK);
    if (want('trouble')) await troubleRun(browser, origin, 'phone', PHONE);
    if (want('notes')) await notesRun(browser, origin, 'desktop', DESK);
    if (want('notes')) await notesRun(browser, origin, 'phone', PHONE);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nframeio-viewer-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
