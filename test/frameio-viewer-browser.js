'use strict';
/*
 * "Watch here": the Frame.io viewer in a real page, fully offline. Every backend answer is local, the Frame.io
 * lookup is a stand-in for the frameio-view function, and the clip is a 12 second fixture. All names, links and
 * comments below are made up.
 *
 *   SHEET             a card with a Frame.io link has a small play icon at the top centre of its thumbnail (on hover; always
 *                     on a phone); a Drive link or no link has none, and there is no "Watch here" text button. Clicking it
 *                     opens the pop-up with the link visible at once, asks the function with the staff key, plays the video
 *                     and lists the comments (time, author, text, replies). A comment click jumps the video.
 *   STATES            loading, "could not load" (with Try again and the normal Frame.io link still there), comments
 *                     failing alone, an address that stops working (asked for again once), a link the function refuses.
 *   REVIEW TAB        staff (SMM review) and client link: the video preview says "Play video", clicking it plays the video
 *                     in its place (no pop-up, no comments), and a small "Watch in Frame.io" link opens Frame.io in a new tab.
 *                     A client link asks with its token and only the card's id.
 *   KASPER REVIEW     Kasper's board keeps its "Watch here" button for the pop-up.
 *   THE SWITCH        everything shows only when the runtime flag row frame_viewer_clients lists the client (or says all: true); a missing row, wrong shape or failed read hides it, and realtime changes show and hide it live. Off, the page looks as it did before: "Open video", no icon, no link.
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
      if (state.mediaFail > 0) { state.mediaFail--; return route.fulfill({ status: 403, headers: CORS, body: 'expired' }); }
      if (hq && state.hqFail) return route.fulfill({ status: 403, headers: CORS, body: 'this rendition fails' });
      const first = !state.mediaSeen[hq ? 'full' : 'small'];
      state.mediaSeen[hq ? 'full' : 'small'] = true;
      if (first) { const wait = hq ? (state.hqStall || state.mediaDelay.full) : state.mediaDelay.small; if (wait) await sleep(wait); }
      const clip = state.orient === 'portrait' ? CLIP_V : CLIP;
      const range = /bytes=(\d+)-(\d*)/.exec(r.headers().range || '');
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
    await page.waitForSelector('.cal-card[data-pid], .kcard[data-cal-review-pid], .thumb-tile[data-thumb-card]', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => onCalViewChange('smmreview'));
    await page.waitForSelector('.kcard[data-cal-review-pid]', { timeout: 20000 });
  } else {
    await page.waitForSelector('.cal-card[data-pid="v1"], .thumb-tile[data-thumb-card="v1"]', { timeout: 20000 });
    await require('../docs/syncview-design/tests/staff-phone-browser').openEditableSheet(page);
    await page.waitForSelector('.cal-card[data-pid="v1"]', { timeout: 20000 });
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
const vOpen = page => page.evaluate(() => { const o = document.getElementById('fvOverlay'); return !!(o && o.classList.contains('open')); });
async function waitReady(page) { await page.waitForFunction(() => { const p = document.getElementById('fvPlayer'); return p && p.getAttribute('data-state') === 'ready'; }, null, { timeout: 15000 }); }
async function waitState(page, st) { await page.waitForFunction(s => { const p = document.getElementById('fvPlayer'); return p && p.getAttribute('data-state') === s; }, st, { timeout: 15000 }); }

async function calendarRun(browser, origin, name, device, orient) {
  const label = name;
  const portrait = orient === 'portrait';
  const tag = name + (portrait ? '-vertical' : '');
  console.log(`--- ${name}${portrait ? ', vertical video' : ''}: Calendar card ---`);
  const notes = [
    { id: 'n1', role: 'smm', author: 'Fixture SMM', body: 'Note from the team: cut the first second.', created_at: iso(200), done: false },
    { id: 'n2', role: 'client', author: 'Fixture Client', body: 'Agreed.', created_at: iso(150), parent_id: 'n1' },
  ];
  const state = makeState({ orient: portrait ? 'portrait' : 'landscape', cards: [card('v1', 'Video card', FRAME, 1, { video_tweaks: JSON.stringify(notes), thumbnail_url: POSTER_URL }), card('v2', 'Second video', FRAME + '-2', 4), card('v3', 'Third video', FRAME + '-3', 5, { video_tweaks: JSON.stringify(notes) }), card('v4', 'Fourth video', FRAME + '-4', 6, { video_tweaks: JSON.stringify(notes) }), card('v5', 'Fifth video', FRAME + '-5', 7), card('v6', 'Sixth video', FRAME + '-6', 8), card('v7', 'Seventh video', FRAME + '-7', 9), card('d1', 'Drive link card', 'https://drive.google.com/file/d/fixture/view', 2), card('n1', 'No video card', '', 3)] });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
  if (process.env.FV_DEBUG) console.log('DEBUG', JSON.stringify(await page.evaluate(() => { const p = calState.posts.find(x => x.id === 'v1'); return { n: calState.posts.length, keys: p && Object.keys(p).filter(k => /comment/.test(k)), c: p && p.comments, vc: p && p.video_comments }; })));
  const ICON = '.cal-card[data-pid="v1"] .cal-thumb-play';
  await page.locator(ICON + ':not([hidden])').waitFor({ state: 'attached', timeout: 8000 });
  expect(await page.locator(ICON + ':not([hidden])').count() === 1, `${label}: a card with a Frame.io link has the play icon on its thumbnail`);
  expect(await page.locator('.cal-card[data-pid="d1"] .cal-thumb-play').count() === 0, `${label}: a Drive link has none`);
  expect(await page.locator('.cal-card[data-pid="n1"] .cal-thumb-play').count() === 0, `${label}: a card with no video has none`);
  expect(await page.locator('.cal-link-watch').count() === 0 && !(await page.locator('.cal-card[data-pid="v1"]').innerText()).includes('Watch here'), `${label}: the "Watch here" text button is gone from the link row`);
  await page.evaluate(() => document.querySelector('.cal-card[data-pid="v1"]').scrollIntoView({ block: 'center' }));
  await page.mouse.move(2, 2); await sleep(250);
  const rest = await page.locator(ICON).evaluate(e => Number(getComputedStyle(e).opacity));
  const geo = await page.evaluate(() => { const t = document.querySelector('.cal-card[data-pid="v1"] .cal-card-thumb').getBoundingClientRect(), i = document.querySelector('.cal-card[data-pid="v1"] .cal-thumb-play').getBoundingClientRect(); return { dx: Math.abs((i.left + i.width / 2) - (t.left + t.width / 2)), top: i.top - t.top, w: Math.round(i.width) }; });
  expect(geo.dx <= 2 && geo.top >= 0 && geo.top <= 16 && geo.w <= 36, `${label}: the icon is small and sits at the top centre of the thumbnail (off by ${geo.dx.toFixed(1)}px, ${geo.top.toFixed(0)}px down, ${geo.w}px wide)`);
  if (name === 'phone') {
    expect(rest === 1, `${label}: on a phone the icon is always visible`);
    await shot(page, `${tag}-1-sheet-light`);
    await theme(page, 'dark'); await shot(page, `${tag}-1-sheet-dark`); await theme(page, 'light');
  } else {
    expect(rest === 0, `${label}: the icon is hidden until the thumbnail is hovered`);
    await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
    await sleep(350);
    expect(await page.locator(ICON).evaluate(e => Number(getComputedStyle(e).opacity)) === 1, `${label}: hovering the thumbnail shows it`);
    await shot(page, `${tag}-1-sheet-hover-light`);
    await theme(page, 'dark'); await shot(page, `${tag}-1-sheet-hover-dark`); await theme(page, 'light');
  }

  // Opening: the Frame.io link and the title are there at once, a spinner shows while the address comes, and the
  // address and the comments are two requests sent side by side.
  state.delay = 1400; state.commentsDelay = 900;
  await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
  await page.locator(ICON).click();
  await page.waitForSelector('#fvOverlay.open', { timeout: 5000 });
  expect(await page.locator('#fvPlayer').getAttribute('data-state') === 'loading', `${label}: loading state while Frame.io answers`);
  expect(await page.locator('#fvPlayer').evaluate(e => getComputedStyle(e).backgroundImage.includes('poster.png')), `${label}: the card's thumbnail is already on the stage while the video loads`);
  await page.waitForFunction(o => document.querySelector('.fv-panel').getAttribute('data-orient') === o, portrait ? 'portrait' : 'landscape', { timeout: 2000 });
  expect(true, `${label}: the layout already fits the video's shape from the thumbnail, before the video itself has loaded`);
  expect(await page.locator('#fvOpenLink').getAttribute('href') === FRAME, `${label}: the Frame.io button is in the header before anything loaded`);
  expect(await page.locator('#fvTitle').innerText() === 'Video card', `${label}: titled with the card`);
  expect(await page.locator('.fv-skel').count() > 0, `${label}: comment placeholders while loading`);
  const notesFirst = await page.locator('.fv-c .fv-src', { hasText: 'SyncView' }).count();
  expect(notesFirst === 1, `${label}: the card's own SyncView note is in the list at once, before Frame.io answers`);
  await shot(page, `${tag}-2-loading-light`);
  await waitReady(page);
  await page.waitForFunction(() => document.querySelectorAll('.fv-c').length >= 4, null, { timeout: 15000 });
  state.delay = 0; state.commentsDelay = 0;
  const vcalls = state.calls.filter(c => c.part === 'video'), ccalls = state.calls.filter(c => c.part === 'comments');
  expect(state.calls.length === 2 && vcalls.length === 1 && ccalls.length === 1 && vcalls[0].body.link === FRAME && Object.keys(vcalls[0].body).join() === 'link,part', `${label}: two requests, the video and the comments, each carrying only the card's link`);
  expect(Math.abs(vcalls[0].at - ccalls[0].at) < 400, `${label}: they were sent side by side (${Math.abs(vcalls[0].at - ccalls[0].at)} ms apart), so the video never waits for the comments`);
  expect(!!vcalls[0].key && !vcalls[0].clientToken, `${label}: sent with the staff key, never a client token`);
  expect(await page.evaluate(() => document.getElementById('fvVideo').getAttribute('src')) === MEDIA_HQ, `${label}: the player starts on the full-size file`);
  await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v.readyState >= 1; }, null, { timeout: 15000 }).catch(() => {});
  // Autoplay.
  await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v && !v.paused && v.currentTime > 0.1; }, null, { timeout: 8000 });
  expect(await page.evaluate(() => { const v = document.getElementById('fvVideo'); return !v.paused && !v.muted; }), `${label}: it plays by itself when the pop-up opens, with sound`);
  expect(await page.locator('#fvUnmute').isHidden(), `${label}: no "tap for sound" control when sound is allowed`);

  // The words that are gone.
  const popupText = await page.locator('.fv-panel').innerText();
  expect(!/FRAME\.IO/.test(popupText) && !/Refresh/i.test(popupText) && !/Comments stay in Frame\.io/i.test(popupText) && !/Reply in Frame\.io/i.test(popupText), `${label}: no "FRAME.IO" label, no Refresh, no "Comments stay in Frame.io" line, no per-comment "Reply in Frame.io"`);
  expect(await page.locator('#fvOpenLink, .fv-panel a[href]').count() === 1 && (await page.locator('#fvOpenLink').innerText()).trim() === 'Open in Frame.io' && await page.locator('#fvOpenLink').getAttribute('href') === OPEN_URL, `${label}: one "Open in Frame.io" button, and it opens that exact video`);
  expect(await page.locator('#fvOpenLink').getAttribute('target') === '_blank', `${label}: in a new tab`);
  expect(await page.locator('.fv-close').count() === 1 && await page.locator('#fvTitle').count() === 1, `${label}: the title and the close button stay`);

  // One list: Frame.io comments and SyncView notes together, oldest first, each marked with where it came from.
  const rows = await page.locator('.fv-c-list > .fv-c').evaluateAll(a => a.map(li => ({ src: li.className.includes('fv-src-frameio') ? 'frameio' : 'syncview', text: li.querySelector('.fv-c-text').innerText.slice(0, 22), label: li.querySelector('.fv-src').innerText, jump: !!li.getAttribute('data-t'), button: li.querySelector('.fv-c-main').tagName })));
  expect(rows.length === 4, `${label}: one list with all four (${rows.length})`);
  expect(rows.map(r => r.src).join() === 'frameio,syncview,frameio,frameio', `${label}: in time order, the two sources mixed (${rows.map(r => r.src).join()})`);
  expect(rows.every(r => r.label === (r.src === 'frameio' ? 'Frame.io' : 'SyncView')), `${label}: each is marked with its source`);
  expect(rows.filter(r => r.src === 'syncview').every(r => !r.jump && r.button === 'DIV') && rows.filter(r => r.src === 'frameio').every(r => r.jump && r.button === 'BUTTON'), `${label}: a Frame.io comment is a button that jumps, a note is not`);
  const srcStyle = await page.locator('.fv-src').first().evaluate(e => ({ size: parseFloat(getComputedStyle(e).fontSize), weight: Number(getComputedStyle(e).fontWeight) }));
  expect(srcStyle.size <= 11.5 && srcStyle.weight <= 700, `${label}: the source label is small and quiet (${srcStyle.size}px)`);
  const texts = await page.locator('.fv-c-list').innerText();
  expect(/0:02[\s\S]*Team Member[\s\S]*Open on the product/.test(texts), `${label}: time, author and text`);
  expect(texts.includes('Guest reviewer'), `${label}: a comment with no name reads "Guest reviewer"`);
  expect(/Another Member[\s\S]*Moved, check the new version/.test(texts) && /Fixture Client[\s\S]*Agreed/.test(texts), `${label}: replies are shown with their authors, for both sources`);
  expect(await page.locator('.fv-c.is-done .fv-done').count() === 1, `${label}: a finished comment is marked Done`);
  expect(await page.locator('.fv-c-text').nth(2).evaluate(e => getComputedStyle(e).whiteSpace) === 'pre-wrap', `${label}: line breaks in a comment are kept`);
  expect(await page.locator('.fv-mark').count() === 3, `${label}: a marker for each Frame.io comment under the video`);
  const dot = await page.locator('.fv-mark').first().evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  expect(dot[0] <= 16 && dot[1] <= 16, `${label}: the comment markers stay small (${dot.join('x')})`);
  expect(await page.locator('#fvCount').innerText() === '4', `${label}: comment count`);

  // Layout: a vertical video uses the height and the comments sit beside it; a wide one keeps the wide layout.
  const lay = await page.evaluate(() => {
    const panel = document.querySelector('.fv-panel'), pl = document.getElementById('fvPlayer').getBoundingClientRect(), ls = document.getElementById('fvList').getBoundingClientRect(), v = document.getElementById('fvVideo');
    const pr = panel.getBoundingClientRect();
    return { orient: panel.getAttribute('data-orient'), pw: pl.width, ph: pl.height, beside: ls.left >= pl.right - 1, below: ls.top >= pl.bottom - 1, panelH: pr.height, vw: v.videoWidth, vh: v.videoHeight, overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, panelFits: pr.right <= window.innerWidth + 1 && pr.bottom <= window.innerHeight + 1, vidAr: v.videoWidth / v.videoHeight };
  });
  expect(lay.orient === (portrait ? 'portrait' : 'landscape'), `${label}: the layout follows the video's shape (${lay.orient})`);
  expect(Math.abs((lay.pw / lay.ph) / lay.vidAr - 1) < 0.03, `${label}: the player is exactly the video's shape, so no black bars (player ${Math.round(lay.pw)}x${Math.round(lay.ph)}, video ${lay.vw}x${lay.vh})`);
  expect(!lay.overflowX && lay.panelFits, `${label}: nothing runs off the screen`);
  if (name === 'phone') {
    expect(lay.below, `${label}: on a phone the comments sit below the video`);
    if (portrait) expect(lay.ph <= 844 * 0.56 && lay.ph >= 844 * 0.3, `${label}: the vertical video uses the height it can (${Math.round(lay.ph)}px of 844)`);
  } else if (portrait) {
    expect(lay.beside && lay.ph >= lay.panelH * 0.7, `${label}: the vertical video fills the height and the comments sit beside it (${Math.round(lay.ph)}px of a ${Math.round(lay.panelH)}px panel)`);
    expect(lay.pw < lay.panelH * 0.7, `${label}: and no wide black stage around it (${Math.round(lay.pw)}px wide)`);
  } else {
    expect(lay.beside, `${label}: the comments sit beside the video`);
  }
  await shot(page, `${tag}-3-ready-light`);
  await theme(page, 'dark'); await shot(page, `${tag}-3-ready-dark`);
  await theme(page, 'light');
  if (portrait) {
    await page.keyboard.press('Escape');
    expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
    return;
  }

  // Jump: a Frame.io comment with a time moves the video; a note does nothing.
  await page.locator('.fv-c.fv-src-frameio').nth(1).locator('.fv-c-main').click();
  await sleep(500);
  const t = await page.evaluate(() => document.getElementById('fvVideo').currentTime);
  expect(Math.abs(t - 5) < 1.2, `${label}: clicking the 0:05 comment jumps the video there (at ${t.toFixed(2)}s)`);
  expect(await page.locator('.fv-c.is-now').count() === 1 && await page.locator('.fv-c.is-now').getAttribute('data-id') === 'c2', `${label}: that comment is highlighted`);
  await page.locator('.fv-mark').nth(2).click();
  await sleep(500);
  expect(Math.abs(await page.evaluate(() => document.getElementById('fvVideo').currentTime) - 9) < 1.2, `${label}: a marker jumps too`);
  const before = await page.evaluate(() => document.getElementById('fvVideo').currentTime);
  await page.locator('.fv-c.fv-src-syncview .fv-c-main').click();
  await sleep(300);
  expect(Math.abs(await page.evaluate(() => document.getElementById('fvVideo').currentTime) - before) < 1.0, `${label}: clicking a SyncView note does not move the video`);
  // Close with Escape; the video stops loading and focus returns to the icon.
  await page.keyboard.press('Escape');
  await sleep(200);
  expect(!(await vOpen(page)) && await page.evaluate(() => !document.getElementById('fvVideo')), `${label}: Escape closes it and stops the video`);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cal-thumb-play')), `${label}: focus goes back to the icon`);
  expect(await page.evaluate(() => !document.body.classList.contains('fv-lock')), `${label}: the page scrolls again`);

  const openCard = async (k) => { await page.locator(`.cal-card[data-pid="v${k}"]`).scrollIntoViewIfNeeded(); await page.locator(`.cal-card[data-pid="v${k}"] .cal-card-thumb`).hover(); await page.locator(`.cal-card[data-pid="v${k}"] .cal-thumb-play`).click(); };
  // Could not load: message, Try again, the Frame.io button still there; Try again then works.
  state.view = (n, body) => (body.part === 'video' && body.link.endsWith('-2') && state.calls.filter(c => c.part === 'video').length === 1 ? { status: 502, body: { ok: false, error: 'frameio_unavailable', message: 'Frame.io did not answer. Try again in a minute.' } } : { status: 200, body: answerFor(body) });
  state.calls.length = 0;
  await openCard(2);
  await waitState(page, 'error');
  expect((await page.locator('#fvState').innerText()).includes('Frame.io did not answer'), `${label}: the failure is said in a sentence`);
  expect(await page.locator('#fvOpenLink').getAttribute('href') === FRAME + '-2', `${label}: the Frame.io button still works from the error`);
  await page.waitForFunction(() => document.querySelectorAll('.fv-c').length >= 3, null, { timeout: 8000 });
  expect(true, `${label}: the comments still load when only the video failed`);
  await shot(page, `${tag}-4-error-light`);
  await theme(page, 'dark'); await shot(page, `${tag}-4-error-dark`); await theme(page, 'light');
  await page.locator('#fvState button', { hasText: 'Try again' }).click();
  await waitReady(page);
  expect(state.calls.filter(c => c.part === 'video').length === 2, `${label}: Try again asks once more and recovers`);
  await page.keyboard.press('Escape');

  // Comments failing alone: the video still plays.
  state.view = (n, body) => (body.part === 'comments' && body.link.endsWith('-3') ? { status: 200, body: Object.assign(answerFor(body), { comments: [], comments_error: 'frameio_unavailable' }) } : { status: 200, body: answerFor(body) });
  await openCard(3);
  await waitReady(page);
  await page.waitForFunction(() => /could not be loaded/.test(document.getElementById('fvList').innerText), null, { timeout: 8000 });
  expect(await page.evaluate(() => !!document.getElementById('fvVideo').getAttribute('src')) && await page.locator('.fv-c.fv-src-syncview').count() === 1, `${label}: comments failing alone leaves the video playing, and the SyncView notes are still listed`);
  await page.keyboard.press('Escape');

  // No Frame.io comments: the card's notes are still there.
  state.view = (n, body) => ({ status: 200, body: answerFor(body, body.link.endsWith('-4') ? Object.assign(GOOD(), { comments: [] }) : GOOD()) });
  await openCard(4);
  await waitReady(page);
  await page.waitForFunction(() => !document.querySelector('.fv-skel'), null, { timeout: 8000 });
  expect(await page.locator('.fv-c').count() === 1, `${label}: with no Frame.io comments the card's note is the one entry`);
  await shot(page, `${tag}-5-nocomments-light`);
  await page.keyboard.press('Escape');

  // A link the function refuses.
  state.view = (n, body) => (body.part === 'video' && body.link.endsWith('-5') ? { status: 422, body: { ok: false, error: 'unsupported_link', message: 'This link is not a Frame.io share or file link, so it cannot be played here.' } } : { status: 200, body: answerFor(body) });
  await openCard(5);
  await waitState(page, 'error');
  expect((await page.locator('#fvState').innerText()).includes('not a Frame.io share'), `${label}: a refused link shows the function's own sentence`);
  await page.keyboard.press('Escape');

  // An address that stopped working (the full-size file and then the small one both refuse): asked for again once, then plays.
  state.calls.length = 0; state.mediaFail = 2; state.view = (n, body) => ({ status: 200, body: answerFor(body) });
  await openCard(6);
  await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  expect(state.calls.filter(c => c.part === 'video').length === 2, `${label}: an address that stopped working is asked for once more (${state.calls.filter(c => c.part === 'video').length} video requests)`);
  await page.keyboard.press('Escape');

  // The full-size file fails for good: the small one takes over in the pop-up too.
  state.calls.length = 0; state.hqFail = true;
  await openCard(7);
  await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v && v.getAttribute('src') && v.getAttribute('src').indexOf('q=hq') === -1 && v.readyState >= 2; }, null, { timeout: 20000 });
  expect(state.calls.filter(c => c.part === 'video').length === 1, `${label}: when the full-size file fails for good the pop-up falls back to the small one without asking the function again`);
  await waitReady(page);
  await page.keyboard.press('Escape');
  state.hqFail = false;

  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function smmReviewRun(browser, origin, label, device, orient) {
  const portrait = orient === 'portrait';
  const tag = label + (portrait ? '-vertical' : '');
  console.log(`--- ${label}${portrait ? ', vertical video' : ''}: Review tab (staff) ---`);
  const state = makeState({ orient: portrait ? 'portrait' : 'landscape', cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval', thumbnail_url: POSTER_URL })] });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device, { view: 'smmreview' });
  await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-cal-review-pid="v1"] .cal-review-body', { timeout: 10000 });
  const panel = '.cal-review-panel[data-comp="video"]';
  await page.locator(panel + ' .fv-frameio-link:not([hidden])').waitFor({ timeout: 8000 });
  expect((await page.locator(panel + ' .cal-review-video-tile').innerText()).trim() === 'Play video', `${tag}: the preview says "Play video", not "Open video"`);
  expect(await page.locator(panel + ' .fv-watch-btn').count() === 0, `${tag}: the "Watch here" button is gone from the Review tab`);
  const fl = page.locator(panel + ' .fv-frameio-link');
  expect((await fl.innerText()).includes('Watch in Frame.io') && await fl.getAttribute('href') === FRAME && await fl.getAttribute('target') === '_blank', `${tag}: a small "Watch in Frame.io" link opens Frame.io in a new tab`);
  const small = await fl.evaluate(e => ({ font: parseFloat(getComputedStyle(e).fontSize), bg: getComputedStyle(e).backgroundColor }));
  expect(small.font <= 13 && /rgba\(0, 0, 0, 0\)|transparent/.test(small.bg), `${tag}: it is a link, not a button (${small.font}px, ${small.bg})`);
  await page.locator(panel).scrollIntoViewIfNeeded();
  await shot(page, `review-staff-${tag}-1-light`);
  await theme(page, 'dark'); await shot(page, `review-staff-${tag}-1-dark`); await theme(page, 'light');
  // Clicking the preview plays the video in its place: no pop-up, no comments.
  await page.locator(panel + ' .cal-review-video-tile').click();
  await page.waitForSelector(panel + ' .fv-inline-video', { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  expect(state.calls.length === 1 && state.calls[0].part === 'video' && state.calls[0].body.link === FRAME && Object.keys(state.calls[0].body).join() === 'link,part' && !!state.calls[0].key && !state.calls[0].clientToken, `${tag}: one request, for the video only, with the staff key and the card's link`);
  expect(await page.evaluate(() => !document.getElementById('fvOverlay') || !document.getElementById('fvOverlay').classList.contains('open')), `${tag}: no pop-up opened`);
  expect(await page.locator('.fv-c, .fv-side, .fv-list').count() === 0, `${tag}: no comments anywhere`);
  expect(await page.locator(panel + ' .cal-review-video-tile[data-fv-tile]').count() === 0 && await page.locator(panel + ' .fv-inline-video').getAttribute('src') === MEDIA_HQ, `${tag}: the video replaced the preview, and it is the full-size file, not the small proxy`);
  expect(state.mediaLog[0] === 'full' && !state.mediaLog.includes('small'), `${tag}: the small file was never requested on a normal connection (${state.mediaLog.join(',')})`);
  expect(await page.locator(panel + ' .fv-frameio-link').count() === 1, `${tag}: the "Watch in Frame.io" link is still under it`);
  await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && !v.paused && v.currentTime > 0.2; }, null, { timeout: 8000 });
  expect(await page.evaluate(() => { const v = document.querySelector('.fv-inline-video'); return !v.paused && !v.muted; }), `${tag}: it plays by itself, with sound`);
  const fits = await page.evaluate(() => { const v = document.querySelector('.fv-inline'), r = v.getBoundingClientRect(), vid = v.querySelector('video'); const vr = vid.getBoundingClientRect(); return { x: document.documentElement.scrollWidth > window.innerWidth + 1, w: Math.round(r.width), h: Math.round(r.height), ar: vid.videoWidth / vid.videoHeight, bw: vr.width / vr.height }; });
  expect(!fits.x && fits.w >= 120 && fits.h >= 60, `${tag}: it fits the column (${fits.w}x${fits.h}) and nothing runs off the screen`);
  expect(Math.abs(fits.bw / fits.ar - 1) < 0.04, `${tag}: no black bars around the video (box ${fits.bw.toFixed(2)}, video ${fits.ar.toFixed(2)})`);
  await shot(page, `review-staff-${tag}-2-playing-light`);
  await theme(page, 'dark'); await shot(page, `review-staff-${tag}-2-playing-dark`); await theme(page, 'light');
  expect(pageErrors.length === 0, `${tag}: Review tab (staff): no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

// Quality and fast start on the Review tab: the full-size file first; the small one only when the connection is slow.
async function reviewQualityRun(browser, origin) {
  console.log('--- desktop: Review tab, quality and a slow connection ---');
  const desktop = { viewport: { width: 1440, height: 900 } };
  const mk = () => makeState({ cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval', thumbnail_url: POSTER_URL })] });
  const open = async (state, init) => {
    const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, desktop));
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 200)));
    await seedStaffGate(page);
    await installRoutes(ctx, origin, state);
    await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof _calSavePins === 'function', null, { timeout: 30000 });
    await page.evaluate(names => { _syncviewStaffIdentityVerified = true; _calSavePins(names); calState.client = names[0]; navTo('calendar'); }, [NAME]);
    await page.waitForSelector('.cal-card[data-pid], .kcard[data-cal-review-pid]', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => onCalViewChange('smmreview'));
    await page.waitForSelector('.kcard[data-cal-review-pid="v1"]', { timeout: 20000 });
    await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
    await page.locator('.cal-review-panel[data-comp="video"] .fv-frameio-link:not([hidden])').waitFor({ timeout: 8000 });
    return { page, ctx, errs };
  };
  const tile = '.cal-review-panel[data-comp="video"] .cal-review-video-tile';
  // 1. a slow connection (data saver, 2g/3g or under 3 Mbit/s): the small file, and no full-size request at all
  {
    const state = mk();
    const { page, ctx, errs } = await open(state, "Object.defineProperty(navigator,'connection',{value:{effectiveType:'3g',downlink:1.4,saveData:false},configurable:true});");
    await page.locator(tile).click();
    await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
    expect(await page.locator('.fv-inline-video').getAttribute('src') === MEDIA && !state.mediaLog.includes('full'), `quality: a slow connection starts on the small file and never asks for the full-size one (${state.mediaLog.join(',')})`);
    expect(errs.length === 0, `quality: slow connection: no page errors (${errs.join(' | ')})`);
    await ctx.close();
  }
  // 2. the full-size file does not start in 4 seconds: carry on with the small one, from the same second, and say so
  {
    const state = mk(); state.hqStall = 6500;
    const { page, ctx, errs } = await open(state);
    await page.locator(tile).click();
    await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.getAttribute('src') && v.getAttribute('src').indexOf('q=hq') === -1 && v.readyState >= 2; }, null, { timeout: 20000 });
    expect(state.mediaLog[0] === 'full' && state.mediaLog.includes('small'), `quality: when the full-size file is slow to start it falls back to the small one (${state.mediaLog.join(',')})`);
    expect(await page.locator('.fv-inline[data-fv-small]').count() === 1, 'quality: and says so, quietly');
    await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return !v.paused && v.currentTime > 0.1; }, null, { timeout: 8000 });
    expect(true, 'quality: the small file plays');
    expect(errs.length === 0, `quality: fallback: no page errors (${errs.join(' | ')})`);
    await ctx.close();
  }
  // 3a. the full-size file fails for good (an encoding the browser cannot play, or that file alone is refused): the small one takes over
  {
    const state = mk(); state.hqFail = true;
    const { page, ctx, errs } = await open(state);
    await page.locator(tile).click();
    await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.getAttribute('src') && v.getAttribute('src').indexOf('q=hq') === -1 && v.readyState >= 2; }, null, { timeout: 20000 });
    expect(state.calls.length === 1 && state.mediaLog.includes('small'), `quality: when the full-size file fails the small one is tried before the address is refreshed (${state.calls.length} request to the function, media ${state.mediaLog.join(',')})`);
    await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return !v.paused && v.currentTime > 0.1; }, null, { timeout: 8000 });
    expect(await page.locator('.fv-inline .fv-inline-state:not([hidden])').count() === 0, 'quality: and it plays, with no error shown');
    expect(errs.length === 0, `quality: full-size failure: no page errors (${errs.join(' | ')})`);
    await ctx.close();
  }
  // 3. a browser that refuses sound: it plays muted and one tap turns the sound on
  {
    const state = mk();
    const { page, ctx, errs } = await open(state, "const _p=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(!this.muted){return Promise.reject(new DOMException('blocked','NotAllowedError'));}return _p.call(this);};");
    await page.locator(tile).click();
    await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && !v.paused && v.currentTime > 0.1; }, null, { timeout: 12000 });
    expect(await page.evaluate(() => document.querySelector('.fv-inline-video').muted) && await page.locator('.fv-inline .fv-unmute').isVisible(), 'quality: when sound is blocked the video plays muted and a "Tap for sound" control shows');
    await shot(page, 'review-staff-desktop-3-muted-light');
    await page.locator('.fv-inline .fv-unmute').click();
    await sleep(300);
    expect(!(await page.evaluate(() => document.querySelector('.fv-inline-video').muted)) && await page.locator('.fv-inline .fv-unmute').isHidden(), 'quality: one tap turns the sound on and the control goes');
    expect(errs.length === 0, `quality: muted: no page errors (${errs.join(' | ')})`);
    await ctx.close();
  }
}

async function reviewFailureRun(browser, origin) {
  console.log('--- desktop: Review tab, when the video cannot load ---');
  const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval' })] });
  state.view = (n, body) => (n === 1 ? { status: 502, body: { ok: false, error: 'frameio_unavailable', message: 'Frame.io did not answer. Try again in a minute.' } } : { status: 200, body: answerFor(body) });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, { viewport: { width: 1440, height: 900 } }, { view: 'smmreview' });
  await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
  const panel = '.cal-review-panel[data-comp="video"]';
  await page.locator(panel + ' .fv-frameio-link:not([hidden])').waitFor({ timeout: 8000 });
  await page.locator(panel + ' .cal-review-video-tile').click();
  await page.waitForSelector(panel + ' .fv-inline-state a.fv-btn', { timeout: 8000 });
  expect((await page.locator(panel + ' .fv-inline-state').innerText()).includes('Frame.io did not answer'), 'failure: said in a sentence');
  expect(await page.locator(panel + ' .fv-inline-state a.fv-btn').getAttribute('href') === FRAME, 'failure: the normal Frame.io link still works from the error');
  await shot(page, 'review-staff-error-light');
  await page.locator(panel + ' .fv-inline-state button', { hasText: 'Try again' }).click();
  await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  expect(state.calls.length === 2, 'failure: Try again asks once more and the video plays');
  expect(pageErrors.length === 0, `failure: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function kasperRun(browser, origin, label, device) {
  console.log(`--- ${label}: Kasper review ---`);
  const state = makeState({ fakeSupabase: true });
  const rows = [card('k1', 'Kasper fixture card', FRAME, 1, {
    video_tweaks: JSON.stringify([{ id: 'kn1', role: 'smm', author: 'Fixture SMM', body: 'Kasper queue note.', created_at: iso(120), done: false }]),
    status: 'Kasper Approval', video_status: 'Kasper Approval', graphic_status: 'Client Approval', caption_status: 'Kasper Approval',
    thumbnail_url: 'https://example.invalid/t.jpg', video_deliverable_id: 'del_v_k1', graphic_deliverable_id: 'del_g_k1',
    video_status_at: '2026-09-30 19:38:51.555501+00', caption_status_at: '2026-09-30 19:38:52+00', kasper_finished_at: null, kasper_closed_at: null,
  })];
  state.cards = rows;
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, device));
  await installRoutes(ctx, origin, state);
  await seedStaffIdentity(ctx, ADMIN);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await page.goto(`${origin}/?Kasper=1#kasper`, { waitUntil: 'domcontentloaded' });
  // The board reads only clients the page knows; teach it the fixture client, then fire its live refresh.
  await page.waitForFunction(() => typeof (window.__rts && window.__rts['kasper-cal']) === 'function' && typeof wlMergeClientsFromSheet === 'function', null, { timeout: 25000 });
  await page.evaluate(name => { wlMergeClientsFromSheet([name]); window.__rts['kasper-cal']({}); }, NAME);
  await page.waitForSelector('#kasperReviewBody .kcard[data-kasper-pid="k1"]', { timeout: 25000 });
  const row = page.locator('.kcard[data-kasper-pid="k1"] .kcard-watch-here');
  await row.and(page.locator(':visible')).waitFor({ timeout: 8000 });
  expect(await row.and(page.locator(':visible')).count() === 1, `${label}: Kasper's card row has "Watch here" next to the Frame.io link`);
  expect(await page.locator('.kcard[data-kasper-pid="k1"] a.kcard-watch-btn').count() === 1, `${label}: the normal "Watch video" link is still there`);
  await shot(page, `kasper-${label}-1-light`);
  await row.click();
  await waitReady(page);
  expect(state.calls.filter(c => c.part === 'video').length === 1 && state.calls[0].body.link === FRAME && !!state.calls[0].key, `${label}: Kasper's viewer asks with the staff key`);
  const dot = await page.locator('.fv-mark').first().evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).minWidth]; });
  expect(dot[0] <= 16 && dot[1] <= 16, `${label}: the comment markers stay small (${dot.join('x')})`);
  await page.waitForFunction(() => document.querySelectorAll('.fv-c').length >= 3, null, { timeout: 8000 });
  expect(await page.locator('.fv-c').count() === 4 && await page.locator('.fv-c.fv-src-syncview').count() === 1, `${label}: Kasper sees the Frame.io comments and the card's SyncView note, though the card is in his queue and not in the Calendar`);
  await shot(page, `kasper-${label}-2-viewer-light`);
  await theme(page, 'dark'); await shot(page, `kasper-${label}-2-viewer-dark`);
  await page.keyboard.press('Escape');
  // The opened card's video preview is the Review tab's: it plays in place.
  await page.locator('.kcard[data-kasper-pid="k1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-kasper-pid="k1"] .cal-review-body', { timeout: 10000 });
  const kTile = page.locator('.kcard[data-kasper-pid="k1"] .cal-review-body .cal-review-panel[data-comp="video"] .cal-review-video-tile');
  expect((await kTile.innerText()).trim() === 'Play video', `${label}: the opened card's preview says "Play video"`);
  state.calls.length = 0;
  await kTile.click();
  await page.waitForSelector('.kcard[data-kasper-pid="k1"] .fv-inline-video', { timeout: 8000 });
  expect(state.calls.length <= 1 && await page.evaluate(() => !document.getElementById('fvOverlay').classList.contains('open')), `${label}: it plays in place, no pop-up (the address from a moment ago is reused)`);
  expect(pageErrors.length === 0, `${label}: Kasper: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function clientLinkRun(browser, origin, label, device, over) {
  const portrait = !!(over && over.portrait);
  const tag = label + (portrait ? ' vertical' : '');
  console.log(`--- ${label}${portrait ? ', vertical video' : ''}: a client link page ---`);
  const on = !(over && over.off);
  const state = makeState(Object.assign({ orient: portrait ? 'portrait' : 'landscape', cards: [card('c1', 'Client fixture card', FRAME, 1, { status: 'Client Approval', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', video_deliverable_id: 'del_client_v1', thumbnail_url: POSTER_URL })] }, over && over.state));
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
  expect(await page.locator('.fv-watch-btn, .cal-thumb-play, .cal-link-watch, .kcard-watch-here').count() === 0, `${label}: no pop-up button or Sheet icon on a client link`);
  expect(state.flagReads >= 1, `${label}: the page reads the switch row`);
  const tile = page.locator(panel + ' .cal-review-video-tile').first();
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-fv-link', 'https://f.io/fixture-video'); b.id = 'fakeBtn'; document.body.appendChild(b); return typeof svFrameViewerOpen === 'function' ? svFrameViewerOpen(b) : null; });
  await sleep(400);
  expect(!(await page.evaluate(() => !!document.getElementById('fvOverlay'))) && state.calls.length === 0, `${label}: the pop-up cannot be opened from a client link, even by calling it`);
  if (!on) {
    expect((await tile.innerText()).trim() === 'Open video ↗' && await page.locator(panel + ' .fv-frameio-link:visible').count() === 0, `${label}: switched off: "Open video", no Frame.io link, as before`);
    expect(await tile.evaluate(e => !e.hasAttribute('data-fv-on') && e.getAttribute('href') === 'https://f.io/fixture-video' && e.getAttribute('target') === '_blank'), `${label}: switched off: the tile is still a plain link to the video`);
    await tile.evaluate(e => e.addEventListener('click', ev => ev.preventDefault(), { once: true })); await tile.click(); await sleep(400);
    expect(state.calls.length === 0 && await page.locator('.fv-inline-video').count() === 0, `${label}: switched off: clicking asks the function nothing and plays nothing`);
    expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
    return;
  }
  expect((await tile.innerText()).trim() === 'Play video', `${label}: the preview says "Play video"`);
  expect(await page.locator(panel + ' .fv-frameio-link:visible').first().getAttribute('href') === FRAME, `${label}: a small "Watch in Frame.io" link is under it`);
  await page.locator(panel).first().scrollIntoViewIfNeeded();
  await shot(page, `review-client-${tag}-1-light`);
  await theme(page, 'dark'); await shot(page, `review-client-${tag}-1-dark`); await theme(page, 'light');
  await tile.click();
  await page.waitForSelector(panel + ' .fv-inline-video', { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  const call = state.calls[0];
  expect(state.calls.length === 1 && !!call.clientToken && !call.key, `${label}: asked with the client's token, never a staff key`);
  expect(Object.keys(call.body).join() === 'card_id' && call.body.card_id === 'c1', `${label}: the request carries only the card's id (${JSON.stringify(call.body)})`);
  expect(await page.locator('.fv-inline-video').getAttribute('src') === MEDIA_HQ, `${label}: plays the full-size file the function gave, not the small proxy`);
  await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && !v.paused && v.currentTime > 0.1 && !v.muted; }, null, { timeout: 8000 });
  expect(true, `${label}: it plays by itself, with sound`);
  expect(await page.locator('.fv-c, .fv-side, .fv-list, #fvOverlay').count() === 0, `${label}: no comments and no pop-up`);
  await sleep(700);
  expect(await page.evaluate(() => document.querySelector('.fv-inline-video').currentTime) > 0.2, `${label}: it is playing`);
  const fits = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  expect(!fits.x, `${label}: nothing runs off the screen`);
  await shot(page, `review-client-${tag}-2-playing-light`);
  await theme(page, 'dark'); await shot(page, `review-client-${tag}-2-playing-dark`); await theme(page, 'light');
  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}


// WHO SEES IT: the one switch row. Hidden unless it lists the client (or says all), and hidden on any doubt.
const BUTTONS = '.cal-thumb-play, .fv-watch-btn, .kcard-watch-here, .fv-frameio-link';
const visibleButtons = page => page.evaluate(sel => Array.from(document.querySelectorAll(sel)).filter(b => !b.hidden && getComputedStyle(b).display !== 'none').length, BUTTONS);
const canOpen = async page => {
  await page.evaluate(() => { const b = document.querySelector('.cal-thumb-play, .fv-watch-btn, .kcard-watch-here'); if (b) svFrameViewerOpen(b); });
  await sleep(700);
  return page.evaluate(() => !!(document.getElementById('fvOverlay') && document.getElementById('fvOverlay').classList.contains('open')));
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
    expect(want ? shownNow >= 1 : shownNow === 0, `switch: ${label}: the viewer is ${want ? 'shown' : 'hidden'} on the Calendar card (${shownNow} visible)`);
    expect(await canOpen(page) === want, `switch: ${label}: the viewer ${want ? 'opens' : 'cannot be opened even by calling it'}`);
    expect(want || state.calls.length === 0, `switch: ${label}: ${want ? 'ok' : 'nothing was asked of the function'}`);
    if (!want) {
      // Off: nothing takes room. The link row is the same width and height as with the button not there at all.
      const row = await page.evaluate(() => { const f = document.querySelector('.cal-card[data-pid="v1"] .cal-link-post'); const r = f.getBoundingClientRect(); const kids = Array.from(f.children).filter(c => getComputedStyle(c).display !== 'none').map(c => c.className.split(' ')[0]); return { h: Math.round(r.height), kids }; });
      expect(!row.kids.includes('cal-link-watch'), `switch: ${label}: no extra control in the link row (${row.kids.join(', ')})`);
    }
    expect(pageErrors.length === 0, `switch: ${label}: no page errors (${pageErrors.join(' | ')})`);
    await ctx.close();
  }

  // Off for the page you are on, and the other places say the same.
  {
    const state = makeState({ fakeSupabase: true, frameFlag: null, cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval' })] });
    const { page, ctx } = await openCalendar(browser, origin, state, desktop, { view: 'smmreview' });
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
    expect(state.calls.length === 0 && await page.locator('.fv-inline-video').count() === 0, 'switch: no row: clicking the preview just follows the link (nothing asked, nothing played)');
    await shot(page, 'switch-off-smm-review');
    // Live: the row is added and the Review tab changes without a reload; then it is removed again.
    await page.waitForFunction(() => typeof (window.__rts && window.__rts['syncview-frame-viewer-flag']) === 'function', null, { timeout: 10000 });
    await page.evaluate(slug => window.__rts['syncview-frame-viewer-flag']({ new: { value: { all: false, clients: [slug] } } }), SLUG);
    await sleep(300);
    const onNow = await page.evaluate(sel => { const t = document.querySelector(sel); const l = document.querySelector('.cal-review-panel[data-comp="video"] .fv-frameio-link'); return { text: t.innerText.trim(), link: !!l && !l.hidden && getComputedStyle(l).display !== 'none' }; }, tileSel);
    expect(onNow.text === 'Play video' && onNow.link, 'switch: realtime: the row is added: "Play video" and the Frame.io link appear without a reload');
    // A video already playing in place stops when the row goes.
    await page.locator(tileSel).click();
    await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.readyState >= 2 && v.currentTime > 0.1; }, null, { timeout: 20000 });
    await page.evaluate(() => window.__rts['syncview-frame-viewer-flag']({ old: { key: 'frame_viewer_clients' } }));
    await sleep(300);
    expect(await page.locator('.fv-inline-video').count() === 0 && (await page.locator('.fv-inline').innerText()).includes('switched off'), 'switch: realtime: a video already playing in place stops when the row is deleted');
    await page.evaluate(() => onCalViewChange('smmreview')); await sleep(600);
    const offNow = await page.evaluate(sel => ({ text: document.querySelector(sel).innerText.trim(), shown: Array.from(document.querySelectorAll('.fv-frameio-link')).filter(l => getComputedStyle(l).display !== 'none').length }), tileSel);
    expect(offNow.text === 'Open video ↗' && offNow.shown === 0, 'switch: realtime: the row is deleted and the Review tab goes back to "Open video"');
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
    await shot(page, 'switch-off-kasper');
    // Live change: the row appears, the buttons appear; the row is deleted, they go.
    await page.waitForFunction(() => typeof (window.__rts && window.__rts['syncview-frame-viewer-flag']) === 'function', null, { timeout: 10000 });
    await page.evaluate(slug => window.__rts['syncview-frame-viewer-flag']({ new: { value: { all: false, clients: [slug] } } }), SLUG);
    await sleep(300);
    expect(await visibleButtons(page) >= 2, `switch: realtime: the row is added and the buttons appear without a reload (${await visibleButtons(page)})`);
    await shot(page, 'switch-on-kasper-live');
    await page.evaluate(slug => window.__rts['syncview-frame-viewer-flag']({ new: { value: { all: false, clients: ['someotherclient'] } } }), SLUG);
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

// FAST START: click to first video frame, measured in a real page. The function and the media take as long as the real ones
// measured against Frame.io (see serverModel and mediaDelay in makeState), so the number is the page's own part: how soon it
// asks, how much it waits for, and what it starts on. Run with FRAMEIO_VIEWER_TIMING_ONLY=1 to print only this.
async function startTimes(browser, origin, label) {
  const out = {};
  for (const scenario of ['click only', 'after a 400 ms hover']) {
    const state = makeState({ serverModel: true, mediaDelay: { small: 230, full: 330 }, orient: 'landscape', cards: [card('v1', 'Video card', FRAME, 1, { thumbnail_url: POSTER_URL })] });
    const { page, ctx } = await openCalendar(browser, origin, state, { viewport: { width: 1440, height: 900 } });
    const ICON = '.cal-card[data-pid="v1"] .cal-thumb-play';
    await page.locator('.cal-card[data-pid="v1"]').scrollIntoViewIfNeeded();
    await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
    await page.locator(ICON).waitFor({ state: 'attached', timeout: 8000 });
    await sleep(300);
    if (scenario !== 'click only') { await page.locator(ICON).hover(); await sleep(400); }
    const callsBefore = state.calls.length, mediaBefore = state.mediaLog.length;
    const t0 = Date.now();
    await page.locator(ICON).click({ force: true });
    const firstCall = state.calls.length > callsBefore ? state.calls[callsBefore].at - t0 : 99999;
    await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { polling: 16, timeout: 20000 });
    const ms = Date.now() - t0;
    out[scenario] = { ms, callsBeforeClick: callsBefore, firstCallMs: firstCall < 0 ? 0 : firstCall, callsAfterClick: state.calls.length - callsBefore, mediaBeforeClick: mediaBefore, src: await page.evaluate(() => document.getElementById('fvVideo').getAttribute('src')) };
    await page.keyboard.press('Escape').catch(() => {});
    await ctx.close();
  }
  console.log('TIMING ' + JSON.stringify({ build: label, click_to_first_frame_ms: { click_only: out['click only'].ms, after_400ms_hover: out['after a 400 ms hover'].ms } }));
  return out;
}
async function fastStartRun(browser, origin) {
  console.log('--- desktop: fast start ---');
  const r = await startTimes(browser, origin, 'this change');
  const a = r['click only'], b = r['after a 400 ms hover'];
  expect(b.callsBeforeClick >= 2, `fast start: pointing at the icon already asks for the video and the comments (${b.callsBeforeClick} requests before the click)`);
  expect(b.callsAfterClick === 0, 'fast start: the click itself asks for nothing more (it uses what the hover fetched)');
  expect(a.firstCallMs < 150 && a.callsAfterClick >= 2, `fast start: even with no hover, pressing the icon sends the requests at once (the first ${a.firstCallMs} ms after the press)`);
  expect(b.ms < a.ms - 100, `fast start: after a short hover the first frame is much sooner (${b.ms} ms against ${a.ms} ms)`);
  expect(a.ms < 2500 && b.ms < 1500, `fast start: the first frame comes in time (click only ${a.ms} ms, after a hover ${b.ms} ms)`);
  expect(a.src === MEDIA_HQ, 'fast start: and it is the full-size file');
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    if (process.env.FRAMEIO_VIEWER_TIMING_ONLY) { await startTimes(browser, origin, process.env.FRAMEIO_VIEWER_BUILD || 'this build'); return; }
    const DESK = { viewport: { width: 1440, height: 900 } }, PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const only = process.env.FRAMEIO_VIEWER_ONLY || '';
    const want = (n) => !only || only === n;
    if (want('fast')) await fastStartRun(browser, origin);
    if (want('calendar')) await calendarRun(browser, origin, 'desktop', DESK, 'landscape');
    if (want('calendar')) await calendarRun(browser, origin, 'phone', PHONE, 'landscape');
    if (want('calendar')) await calendarRun(browser, origin, 'desktop', DESK, 'portrait');
    if (want('calendar')) await calendarRun(browser, origin, 'phone', PHONE, 'portrait');
    if (want('smm')) await smmReviewRun(browser, origin, 'desktop', DESK, 'landscape');
    if (want('smm')) await smmReviewRun(browser, origin, 'phone', PHONE, 'landscape');
    if (want('smm')) await smmReviewRun(browser, origin, 'desktop', DESK, 'portrait');
    if (want('smm')) await smmReviewRun(browser, origin, 'phone', PHONE, 'portrait');
    if (want('quality')) await reviewQualityRun(browser, origin);
    if (want('failure')) await reviewFailureRun(browser, origin);
    if (want('kasper')) await kasperRun(browser, origin, 'desktop', DESK);
    if (want('kasper')) await kasperRun(browser, origin, 'phone', PHONE);
    if (want('client')) await clientLinkRun(browser, origin, 'client desktop', DESK);
    if (want('client')) await clientLinkRun(browser, origin, 'client phone', PHONE);
    if (want('client')) await clientLinkRun(browser, origin, 'client desktop', DESK, { portrait: true });
    if (want('client')) await clientLinkRun(browser, origin, 'client phone', PHONE, { portrait: true });
    if (want('client')) await clientLinkRun(browser, origin, 'client, switched off', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { off: true, state: { frameFlag: null } });
    if (want('client')) await clientLinkRun(browser, origin, 'client, another client listed', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { off: true, state: { frameFlag: { all: false, clients: ['someotherclient'] } } });
    if (want('flags')) await flagRun(browser, origin);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nframeio-viewer-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
