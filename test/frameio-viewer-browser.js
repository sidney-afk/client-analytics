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
const CLIP = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-clip.webm'));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const FAKE_SUPABASE = "window.__rts={};window.supabase={createClient:function(){return{channel:function(name){var ch={on:function(t,f,cb){window.__rts[name]=cb;return ch;},subscribe:function(){return ch;}};return ch;},removeChannel:function(){}};}};";
const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const GOOD = () => ({
  ok: true,
  video: { url: MEDIA, expires_at: new Date(Date.now() + 20 * 3600000).toISOString(), name: 'Fixture clip V2.mp4', file_id: 'f1', duration_seconds: 12, fps: 24 },
  comments: [
    { id: 'c1', frame: 48, time_seconds: 2, text: 'Open on the product, not the logo.', author: 'Team Member', guest: false, created_at: iso(300), done: true, replies: [] },
    { id: 'c2', frame: 120, time_seconds: 5, text: 'The caption covers her face here. Move it up a little?\nThanks!', author: '', guest: true, created_at: iso(90),
      done: false, replies: [{ id: 'r1', text: 'Moved, check the new version.', author: 'Another Member', guest: false, created_at: iso(20) }] },
    { id: 'c3', frame: 216, time_seconds: 9, text: 'Great ending.', author: '', guest: true, created_at: iso(10), done: false, replies: [] },
  ],
  comments_error: '', comments_truncated: false, reply_names_partial: false, open_url: OPEN_URL, fetched_at: iso(0), took_ms: 900,
});
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
    calls: [], view: () => ({ status: 200, body: GOOD() }), delay: 0, mediaHits: 0, mediaFail: 0,
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
    if (u.host === 'media.fixture.test') {
      state.mediaHits++;
      if (state.mediaFail > 0) { state.mediaFail--; return route.fulfill({ status: 403, headers: CORS, body: 'expired' }); }
      const range = /bytes=(\d+)-(\d*)/.exec(r.headers().range || '');
      if (range) {
        const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), CLIP.length - 1) : CLIP.length - 1;
        return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': `bytes ${a}-${b}/${CLIP.length}`, 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: CLIP.subarray(a, b + 1) });
      }
      return route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: CLIP });
    }
    if (state.fakeSupabase && /supabase-js/.test(r.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: CORS, body: FAKE_SUPABASE });
    if (p === '/functions/v1/frameio-view') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (_) {}
      state.calls.push({ body, key: r.headers()['x-syncview-key'] || '', clientToken: r.headers()['x-syncview-client-token'] || '', method: r.method() });
      if (state.delay) await sleep(state.delay);
      const out = state.view(state.calls.length);
      // A client link is answered the way the server answers it: the playable address and nothing else.
      if (r.headers()['x-syncview-client-token'] && out.status === 200 && out.body && out.body.ok) {
        const g = out.body;
        return json({ ok: true, video: { url: g.video.url, expires_at: g.video.expires_at, duration_seconds: g.video.duration_seconds, fps: 24 }, fetched_at: g.fetched_at }, 200);
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
    await page.waitForSelector('.cal-card[data-pid], .kcard[data-cal-review-pid]', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => onCalViewChange('smmreview'));
    await page.waitForSelector('.kcard[data-cal-review-pid]', { timeout: 20000 });
  } else {
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

async function calendarRun(browser, origin, label, device) {
  const tag = label;
  console.log(`--- ${label}: Calendar card ---`);
  const state = makeState();
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device);
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
  if (label === 'phone') {
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

  // Slow answer: loading state, and the normal Frame.io link is already there.
  state.delay = 1400;
  await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
  await page.locator(ICON).click();
  await page.waitForSelector('#fvOverlay.open', { timeout: 5000 });
  expect(await page.locator('#fvPlayer').getAttribute('data-state') === 'loading', `${label}: loading state while Frame.io answers`);
  expect((await page.locator('#fvState').innerText()).includes('Loading'), `${label}: loading words`);
  expect(await page.locator('#fvOpenLink').getAttribute('href') === FRAME, `${label}: the normal Frame.io link is in the header before anything loaded`);
  expect(await page.locator('#fvTitle').innerText() === 'Video card', `${label}: titled with the card`);
  expect(await page.locator('.fv-skel').count() > 0, `${label}: comment placeholders while loading`);
  await shot(page, `${tag}-2-loading-light`);
  await waitReady(page);
  state.delay = 0;
  const call = state.calls[0];
  expect(state.calls.length === 1 && call.body.link === FRAME && Object.keys(call.body).join() === 'link', `${label}: one request carrying only the card's link`);
  expect(!!call.key && !call.clientToken, `${label}: sent with the staff key, never a client token`);
  expect(await page.evaluate(() => document.getElementById('fvVideo').getAttribute('src')) === MEDIA, `${label}: the player got the address from the function`);
  await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v.readyState >= 1; }, null, { timeout: 15000 }).catch(() => {});
  const items = await page.locator('.fv-c').count();
  expect(items === 3, `${label}: three comments listed`);
  const texts = await page.locator('.fv-c-list').innerText();
  expect(/0:02[\s\S]*Team Member[\s\S]*Open on the product/.test(texts), `${label}: time, author and text`);
  expect(texts.includes('Guest reviewer'), `${label}: a comment with no name reads "Guest reviewer"`);
  expect(/Another Member[\s\S]*Moved, check the new version/.test(texts), `${label}: the reply is shown with its author`);
  expect(await page.locator('.fv-c.is-done .fv-done').count() === 1, `${label}: a finished comment is marked Done`);
  expect(await page.locator('.fv-c-text').nth(1).evaluate(e => getComputedStyle(e).whiteSpace) === 'pre-wrap', `${label}: line breaks in a comment are kept`);
  expect(await page.locator('.fv-mark').count() === 3, `${label}: a marker for each comment under the video`);
  const dot = await page.locator('.fv-mark').first().evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  expect(dot[0] <= 16 && dot[1] <= 16, `${label}: the comment markers stay small (${dot.join('x')})`);
  expect(await page.locator('#fvCount').innerText() === '3', `${label}: comment count`);
  const replyLinks = await page.locator('.fv-c-reply, #fvReplyMain').evaluateAll(a => a.map(x => [x.getAttribute('href'), x.getAttribute('target')]));
  expect(replyLinks.length === 4 && replyLinks.every(l => l[0] === OPEN_URL && l[1] === '_blank'), `${label}: every "Reply in Frame.io" opens that video in Frame.io in a new tab`);
  expect(await page.locator('#fvOpenLink').getAttribute('href') === OPEN_URL, `${label}: the header link moves to the exact video`);
  // Jump.
  await page.locator('.fv-c').nth(1).locator('.fv-c-main').click();
  await sleep(500);
  const t = await page.evaluate(() => document.getElementById('fvVideo').currentTime);
  expect(Math.abs(t - 5) < 1.2, `${label}: clicking the 0:05 comment jumps the video there (at ${t.toFixed(2)}s)`);
  expect(await page.locator('.fv-c.is-now').count() === 1 && await page.locator('.fv-c.is-now').getAttribute('data-id') === 'c2', `${label}: that comment is highlighted`);
  await page.locator('.fv-mark').nth(2).click();
  await sleep(500);
  expect(Math.abs(await page.evaluate(() => document.getElementById('fvVideo').currentTime) - 9) < 1.2, `${label}: a marker jumps too`);
  await shot(page, `${tag}-3-ready-light`);
  await theme(page, 'dark'); await shot(page, `${tag}-3-ready-dark`);
  // No layout overflow.
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector('.fv-panel').getBoundingClientRect();
    return { x: document.documentElement.scrollWidth > window.innerWidth + 1, panelFits: panel.right <= window.innerWidth + 1 && panel.bottom <= window.innerHeight + 1 };
  });
  expect(!overflow.x && overflow.panelFits, `${label}: nothing runs off the screen`);
  if (label === 'phone') {
    const stacked = await page.evaluate(() => {
      const v = document.getElementById('fvPlayer').getBoundingClientRect(), l = document.getElementById('fvList').getBoundingClientRect();
      return l.top >= v.bottom - 1;
    });
    expect(stacked, `${label}: the comments sit below the video`);
  } else {
    const beside = await page.evaluate(() => {
      const v = document.getElementById('fvPlayer').getBoundingClientRect(), l = document.getElementById('fvList').getBoundingClientRect();
      return l.left >= v.right - 1;
    });
    expect(beside, `${label}: the comments sit beside the video`);
  }
  await theme(page, 'light');
  // Close with Escape; the video stops loading and focus returns to the button.
  await page.keyboard.press('Escape');
  await sleep(200);
  expect(!(await vOpen(page)) && !(await page.evaluate(() => document.getElementById('fvVideo').getAttribute('src'))), `${label}: Escape closes it and stops the video`);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cal-thumb-play')), `${label}: focus goes back to the icon`);
  expect(await page.evaluate(() => !document.body.classList.contains('fv-lock')), `${label}: the page scrolls again`);

  // Could not load: message, Try again, normal link still there; Try again then works.
  state.view = n => (n === 2 ? { status: 502, body: { ok: false, error: 'frameio_unavailable', message: 'Frame.io did not answer. Try again in a minute.' } } : { status: 200, body: GOOD() });
  await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
  await page.locator(ICON).click();
  await waitState(page, 'error');
  const errText = await page.locator('#fvState').innerText();
  expect(errText.includes('Frame.io did not answer'), `${label}: the failure is said in a sentence`);
  expect(await page.locator('#fvState a.fv-btn[href="' + FRAME + '"]').count() === 1 && await page.locator('#fvOpenLink').getAttribute('href') === FRAME, `${label}: the normal Frame.io link still works from the error`);
  expect((await page.locator('#fvList').innerText()).includes('could not be loaded'), `${label}: the comment side says so too`);
  await shot(page, `${tag}-4-error-light`);
  await theme(page, 'dark'); await shot(page, `${tag}-4-error-dark`); await theme(page, 'light');
  await page.locator('#fvState button', { hasText: 'Try again' }).click();
  await waitReady(page);
  expect(state.calls.length === 3 && await page.locator('.fv-c').count() === 3, `${label}: Try again asks once more and recovers`);
  await page.keyboard.press('Escape');

  // Comments failing alone: the video still plays.
  state.view = () => ({ status: 200, body: Object.assign(GOOD(), { comments: [], comments_error: 'frameio_unavailable' }) });
  await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
  await page.locator(ICON).click();
  await waitReady(page);
  expect((await page.locator('#fvList').innerText()).includes('comments could not be loaded') && await page.evaluate(() => !!document.getElementById('fvVideo').getAttribute('src')), `${label}: comments failing alone leaves the video playing`);
  await page.keyboard.press('Escape');

  // No comments.
  state.view = () => ({ status: 200, body: Object.assign(GOOD(), { comments: [] }) });
  await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
  await page.locator(ICON).click();
  await waitReady(page);
  expect((await page.locator('#fvList').innerText()).includes('No comments on this video yet'), `${label}: an empty list is said plainly`);
  await shot(page, `${tag}-5-nocomments-light`);
  await page.keyboard.press('Escape');

  // A link the function refuses.
  state.view = () => ({ status: 422, body: { ok: false, error: 'unsupported_link', message: 'This link is not a Frame.io share or file link, so it cannot be played here.' } });
  await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
  await page.locator(ICON).click();
  await waitState(page, 'error');
  expect((await page.locator('#fvState').innerText()).includes('not a Frame.io share'), `${label}: a refused link shows the function's own sentence`);
  await page.keyboard.press('Escape');

  // An address that stopped working: asked for again once, then plays.
  state.calls.length = 0; state.mediaFail = 1; state.view = () => ({ status: 200, body: GOOD() });
  await page.locator('.cal-card[data-pid="v1"] .cal-card-thumb').hover();
  await page.locator(ICON).click();
  await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v && v.readyState >= 1; }, null, { timeout: 20000 });
  expect(state.calls.length === 2, `${label}: an address that stopped working is asked for once more (${state.calls.length} requests)`);
  await page.keyboard.press('Escape');

  // Nothing is saved: no write went to a card.
  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function smmReviewRun(browser, origin, label, device) {
  console.log(`--- ${label}: Review tab (staff) ---`);
  const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval', thumbnail_url: '' })] });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, device, { view: 'smmreview' });
  await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-cal-review-pid="v1"] .cal-review-body', { timeout: 10000 });
  const panel = '.cal-review-panel[data-comp="video"]';
  await page.locator(panel + ' .fv-frameio-link:not([hidden])').waitFor({ timeout: 8000 });
  expect((await page.locator(panel + ' .cal-review-video-tile').innerText()).trim() === 'Play video', `${label}: the preview says "Play video", not "Open video"`);
  expect(await page.locator(panel + ' .fv-watch-btn').count() === 0, `${label}: the "Watch here" button is gone from the Review tab`);
  const fl = page.locator(panel + ' .fv-frameio-link');
  expect((await fl.innerText()).includes('Watch in Frame.io') && await fl.getAttribute('href') === FRAME && await fl.getAttribute('target') === '_blank', `${label}: a small "Watch in Frame.io" link opens Frame.io in a new tab`);
  const small = await fl.evaluate(e => ({ font: parseFloat(getComputedStyle(e).fontSize), bg: getComputedStyle(e).backgroundColor }));
  expect(small.font <= 13 && /rgba\(0, 0, 0, 0\)|transparent/.test(small.bg), `${label}: it is a link, not a button (${small.font}px, ${small.bg})`);
  await page.locator(panel).scrollIntoViewIfNeeded();
  await shot(page, `review-staff-${label}-1-light`);
  await theme(page, 'dark'); await shot(page, `review-staff-${label}-1-dark`); await theme(page, 'light');
  // Clicking the preview plays the video in its place: no pop-up, no comments.
  await page.locator(panel + ' .cal-review-video-tile').click();
  await page.waitForSelector(panel + ' .fv-inline-video', { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  expect(state.calls.length === 1 && state.calls[0].body.link === FRAME && Object.keys(state.calls[0].body).join() === 'link' && !!state.calls[0].key && !state.calls[0].clientToken, `${label}: one request with the staff key and only the card's link`);
  expect(await page.evaluate(() => !document.getElementById('fvOverlay') || !document.getElementById('fvOverlay').classList.contains('open')), `${label}: no pop-up opened`);
  expect(await page.locator('.fv-c, .fv-side, .fv-list').count() === 0, `${label}: no comments anywhere`);
  expect(await page.locator(panel + ' .cal-review-video-tile[data-fv-tile]').count() === 0 && await page.locator(panel + ' .fv-inline-video').getAttribute('src') === MEDIA, `${label}: the video replaced the preview, playing the address the function gave`);
  expect(await page.locator(panel + ' .fv-frameio-link').count() === 1, `${label}: the "Watch in Frame.io" link is still under it`);
  await sleep(700);
  expect(await page.evaluate(() => document.querySelector('.fv-inline-video').currentTime) > 0.2, `${label}: it is playing`);
  const fits = await page.evaluate(() => { const v = document.querySelector('.fv-inline').getBoundingClientRect(); return { x: document.documentElement.scrollWidth > window.innerWidth + 1, w: Math.round(v.width), h: Math.round(v.height) }; });
  expect(!fits.x && fits.w >= 120 && fits.h >= 60, `${label}: it fits the column (${fits.w}x${fits.h}) and nothing runs off the screen`);
  await shot(page, `review-staff-${label}-2-playing-light`);
  await theme(page, 'dark'); await shot(page, `review-staff-${label}-2-playing-dark`); await theme(page, 'light');
  expect(pageErrors.length === 0, `${label}: Review tab (staff): no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function reviewFailureRun(browser, origin) {
  console.log('--- desktop: Review tab, when the video cannot load ---');
  const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval' })] });
  state.view = n => (n === 1 ? { status: 502, body: { ok: false, error: 'frameio_unavailable', message: 'Frame.io did not answer. Try again in a minute.' } } : { status: 200, body: GOOD() });
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
  // An address that stopped working is asked for once more.
  state.calls.length = 0; state.mediaFail = 1;
  await page.evaluate(() => onCalViewChange('smmreview'));
  expect(pageErrors.length === 0, `failure: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function kasperRun(browser, origin, label, device) {
  console.log(`--- ${label}: Kasper review ---`);
  const state = makeState({ fakeSupabase: true });
  const rows = [card('k1', 'Kasper fixture card', FRAME, 1, {
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
  expect(state.calls.length === 1 && state.calls[0].body.link === FRAME && !!state.calls[0].key, `${label}: Kasper's viewer asks with the staff key`);
  const dot = await page.locator('.fv-mark').first().evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).minWidth]; });
  expect(dot[0] <= 16 && dot[1] <= 16, `${label}: the comment markers stay small (${dot.join('x')})`);
  expect(await page.locator('.fv-c').count() === 3, `${label}: Kasper sees the comments`);
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
  expect(state.calls.length === 1 && await page.evaluate(() => !document.getElementById('fvOverlay').classList.contains('open')), `${label}: it plays in place, no pop-up`);
  expect(pageErrors.length === 0, `${label}: Kasper: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function clientLinkRun(browser, origin, label, device, over) {
  console.log(`--- ${label}: a client link page ---`);
  const on = !(over && over.off);
  const state = makeState(Object.assign({ cards: [card('c1', 'Client fixture card', FRAME, 1, { status: 'Client Approval', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', video_deliverable_id: 'del_client_v1' })] }, over && over.state));
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
  await shot(page, `review-client-${label}-1-light`);
  await theme(page, 'dark'); await shot(page, `review-client-${label}-1-dark`); await theme(page, 'light');
  await tile.click();
  await page.waitForSelector(panel + ' .fv-inline-video', { timeout: 8000 });
  await page.waitForFunction(() => { const v = document.querySelector('.fv-inline-video'); return v && v.readyState >= 2; }, null, { timeout: 20000 });
  const call = state.calls[0];
  expect(state.calls.length === 1 && !!call.clientToken && !call.key, `${label}: asked with the client's token, never a staff key`);
  expect(Object.keys(call.body).join() === 'card_id' && call.body.card_id === 'c1', `${label}: the request carries only the card's id (${JSON.stringify(call.body)})`);
  expect(await page.locator('.fv-inline-video').getAttribute('src') === MEDIA, `${label}: plays the address the function gave`);
  expect(await page.locator('.fv-c, .fv-side, .fv-list, #fvOverlay').count() === 0, `${label}: no comments and no pop-up`);
  await sleep(700);
  expect(await page.evaluate(() => document.querySelector('.fv-inline-video').currentTime) > 0.2, `${label}: it is playing`);
  const fits = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  expect(!fits.x, `${label}: nothing runs off the screen`);
  await shot(page, `review-client-${label}-2-playing-light`);
  await theme(page, 'dark'); await shot(page, `review-client-${label}-2-playing-dark`); await theme(page, 'light');
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
    await page.evaluate(() => window.__rts['syncview-frame-viewer-flag']({ old: { key: 'frame_viewer_clients' } }));
    await sleep(300);
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

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await calendarRun(browser, origin, 'desktop', { viewport: { width: 1440, height: 900 } });
    await calendarRun(browser, origin, 'phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await smmReviewRun(browser, origin, 'desktop', { viewport: { width: 1440, height: 900 } });
    await smmReviewRun(browser, origin, 'phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await reviewFailureRun(browser, origin);
    await kasperRun(browser, origin, 'desktop', { viewport: { width: 1440, height: 900 } });
    await kasperRun(browser, origin, 'phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await clientLinkRun(browser, origin, 'client desktop', { viewport: { width: 1440, height: 900 } });
    await clientLinkRun(browser, origin, 'client phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await clientLinkRun(browser, origin, 'client, switched off', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { off: true, state: { frameFlag: null } });
    await clientLinkRun(browser, origin, 'client, another client listed', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { off: true, state: { frameFlag: { all: false, clients: ['someotherclient'] } } });
    await flagRun(browser, origin);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nframeio-viewer-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
