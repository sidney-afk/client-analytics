'use strict';
/*
 * "Watch here": the Frame.io viewer in a real page, fully offline. Every backend answer is local, the Frame.io
 * lookup is a stand-in for the frameio-view function, and the clip is a 12 second fixture. All names, links and
 * comments below are made up.
 *
 *   CALENDAR CARD     a card with a Frame.io link has "Watch here"; a Drive link or no link has none. Clicking it
 *                     opens the viewer with the link visible at once, asks the function with the staff key, plays the
 *                     video and lists the comments (time, author, text, replies). A comment click jumps the video.
 *   STATES            loading, "could not load" (with Try again and the normal Frame.io link still there), comments
 *                     failing alone, an address that stops working (asked for again once), a link the function refuses.
 *   SMM REVIEW        the same viewer opens from the review panel's video.
 *   KASPER REVIEW     and from Kasper's board, on the card row and inside the opened card.
 *   CLIENT LINK       a tokened client link shows no button anywhere and cannot open the viewer.
 *   THE SWITCH        the viewer shows only when the runtime flag row frame_viewer_clients lists the client (or says all: true); a missing row, wrong shape or failed read hides it, and realtime changes show and hide it live. Off, the page looks as it did before.
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
  await page.locator('.cal-card[data-pid="v1"] .cal-link-watch:visible').waitFor({ timeout: 8000 });
  expect(await page.locator('.cal-card[data-pid="v1"] .cal-link-watch:visible').count() === 1, `${label}: a card with a Frame.io link has "Watch here"`);
  expect(await page.locator('.cal-card[data-pid="d1"] .cal-link-watch').count() === 0, `${label}: a Drive link has none`);
  expect(await page.locator('.cal-card[data-pid="n1"] .cal-link-watch').count() === 0, `${label}: a card with no video has none`);
  await page.evaluate(() => document.querySelector('.cal-card[data-pid="v1"]').scrollIntoView({ block: 'center' }));
  await shot(page, `${tag}-1-card-light`);
  await theme(page, 'dark'); await shot(page, `${tag}-1-card-dark`); await theme(page, 'light');

  // Slow answer: loading state, and the normal Frame.io link is already there.
  state.delay = 1400;
  await page.locator('.cal-card[data-pid="v1"] .cal-link-watch').click();
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
  expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cal-link-watch')), `${label}: focus goes back to the button`);
  expect(await page.evaluate(() => !document.body.classList.contains('fv-lock')), `${label}: the page scrolls again`);

  // Could not load: message, Try again, normal link still there; Try again then works.
  state.view = n => (n === 2 ? { status: 502, body: { ok: false, error: 'frameio_unavailable', message: 'Frame.io did not answer. Try again in a minute.' } } : { status: 200, body: GOOD() });
  await page.locator('.cal-card[data-pid="v1"] .cal-link-watch').click();
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
  await page.locator('.cal-card[data-pid="v1"] .cal-link-watch').click();
  await waitReady(page);
  expect((await page.locator('#fvList').innerText()).includes('comments could not be loaded') && await page.evaluate(() => !!document.getElementById('fvVideo').getAttribute('src')), `${label}: comments failing alone leaves the video playing`);
  await page.keyboard.press('Escape');

  // No comments.
  state.view = () => ({ status: 200, body: Object.assign(GOOD(), { comments: [] }) });
  await page.locator('.cal-card[data-pid="v1"] .cal-link-watch').click();
  await waitReady(page);
  expect((await page.locator('#fvList').innerText()).includes('No comments on this video yet'), `${label}: an empty list is said plainly`);
  await shot(page, `${tag}-5-nocomments-light`);
  await page.keyboard.press('Escape');

  // A link the function refuses.
  state.view = () => ({ status: 422, body: { ok: false, error: 'unsupported_link', message: 'This link is not a Frame.io share or file link, so it cannot be played here.' } });
  await page.locator('.cal-card[data-pid="v1"] .cal-link-watch').click();
  await waitState(page, 'error');
  expect((await page.locator('#fvState').innerText()).includes('not a Frame.io share'), `${label}: a refused link shows the function's own sentence`);
  await page.keyboard.press('Escape');

  // An address that stopped working: asked for again once, then plays.
  state.calls.length = 0; state.mediaFail = 1; state.view = () => ({ status: 200, body: GOOD() });
  await page.locator('.cal-card[data-pid="v1"] .cal-link-watch').click();
  await page.waitForFunction(() => { const v = document.getElementById('fvVideo'); return v && v.readyState >= 1; }, null, { timeout: 20000 });
  expect(state.calls.length === 2, `${label}: an address that stopped working is asked for once more (${state.calls.length} requests)`);
  await page.keyboard.press('Escape');

  // Nothing is saved: no write went to a card.
  expect(pageErrors.length === 0, `${label}: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function smmReviewRun(browser, origin) {
  console.log('--- desktop: SMM review ---');
  const state = makeState({ cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval', thumbnail_url: '' })] });
  const { page, ctx, pageErrors } = await openCalendar(browser, origin, state, { viewport: { width: 1440, height: 900 } }, { view: 'smmreview' });
  await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-cal-review-pid="v1"] .cal-review-body', { timeout: 10000 });
  const btn = page.locator('.cal-review-panel[data-comp="video"] .fv-watch-review');
  await btn.and(page.locator(':visible')).waitFor({ timeout: 8000 });
  expect(await btn.and(page.locator(':visible')).count() === 1, 'SMM review: the video panel has "Watch here"');
  await shot(page, 'smm-review-1-light');
  await btn.click();
  await waitReady(page);
  expect(state.calls.length === 1 && state.calls[0].body.link === FRAME && !!state.calls[0].key, 'SMM review: opens the same viewer with the staff key');
  expect(await page.locator('.fv-c').count() === 3, 'SMM review: comments are there');
  await shot(page, 'smm-review-2-viewer-light');
  await page.keyboard.press('Escape');
  expect(pageErrors.length === 0, `SMM review: no page errors (${pageErrors.join(' | ')})`);
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
  await page.locator('.kcard[data-kasper-pid="k1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-kasper-pid="k1"] .cal-review-body', { timeout: 10000 });
  const inside = page.locator('.kcard[data-kasper-pid="k1"] .cal-review-body .fv-watch-btn:visible');
  expect(await inside.count() >= 1, `${label}: the opened card has "Watch here" on the video`);
  await shot(page, `kasper-${label}-1-light`);
  await inside.first().click();
  await waitReady(page);
  expect(state.calls.length === 1 && state.calls[0].body.link === FRAME && !!state.calls[0].key, `${label}: Kasper's viewer asks with the staff key`);
  const dot = await page.locator('.fv-mark').first().evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).minWidth]; });
  expect(dot[0] <= 16 && dot[1] <= 16, `${label}: the comment markers stay small (${dot.join('x')})`);
  expect(await page.locator('.fv-c').count() === 3, `${label}: Kasper sees the comments`);
  await shot(page, `kasper-${label}-2-viewer-light`);
  await theme(page, 'dark'); await shot(page, `kasper-${label}-2-viewer-dark`);
  await page.keyboard.press('Escape');
  expect(pageErrors.length === 0, `${label}: Kasper: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}

async function clientLinkRun(browser, origin) {
  console.log('--- phone: a client link page ---');
  const state = makeState({ cards: [card('c1', 'Client fixture card', FRAME, 1, { status: 'Client Approval', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', video_deliverable_id: 'del_client_v1' })] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await installRoutes(ctx, origin, state);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  await page.goto(`${origin}/index.html?${new URLSearchParams({ c: NAME, t: 'fixture-review-token', v: 'calendar' })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kcard[data-cal-review-pid="c1"]', { timeout: 30000 });
  await page.locator('.kcard[data-cal-review-pid="c1"] .kcard-expand-btn').click();
  await page.waitForSelector('.kcard[data-cal-review-pid="c1"] .cal-review-body', { timeout: 10000 });
  await page.locator('.kcard[data-cal-review-pid="c1"] .pocket-cal-fold > summary').first().click().catch(() => {});
  expect(await page.locator('.cal-review-panel[data-comp="video"]').count() >= 1, 'client link: the review card is on screen');
  expect(await page.locator('.fv-watch-btn, .cal-link-watch, .kcard-watch-here').count() === 0, 'client link: no "Watch here" button anywhere');
  expect(state.flagReads === 0, 'client link: the page never reads the switch row');
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-fv-link', 'https://f.io/fixture-video'); b.id = 'fakeBtn'; document.body.appendChild(b); return typeof svFrameViewerOpen === 'function' ? svFrameViewerOpen(b) : null; });
  await sleep(500);
  expect(!(await page.evaluate(() => !!document.getElementById('fvOverlay'))) && state.calls.length === 0, 'client link: calling the viewer anyway opens nothing and asks nothing');
  await shot(page, 'client-link-phone');
  expect(pageErrors.length === 0, `client link: no page errors (${pageErrors.join(' | ')})`);
  await ctx.close();
}


// WHO SEES IT: the one switch row. Hidden unless it lists the client (or says all), and hidden on any doubt.
const BUTTONS = '.cal-link-watch, .fv-watch-btn, .kcard-watch-here';
const visibleButtons = page => page.evaluate(sel => Array.from(document.querySelectorAll(sel)).filter(b => !b.hidden && getComputedStyle(b).display !== 'none').length, BUTTONS);
const canOpen = async page => {
  await page.evaluate(() => { const b = document.querySelector('.cal-link-watch, .fv-watch-btn, .kcard-watch-here'); if (b) svFrameViewerOpen(b); });
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
    const state = makeState({ frameFlag: null, cards: [card('v1', 'Video card', FRAME, 1, { video_status: 'For SMM Approval', status: 'For SMM Approval' })] });
    const { page, ctx } = await openCalendar(browser, origin, state, desktop, { view: 'smmreview' });
    await page.locator('.kcard[data-cal-review-pid="v1"] .kcard-expand-btn').click();
    await page.waitForSelector('.cal-review-panel[data-comp="video"]', { timeout: 10000 });
    await sleep(1200);
    expect(await visibleButtons(page) === 0, 'switch: no row: nothing shown in the SMM review panel');
    const tile = await page.evaluate(() => { const t = document.querySelector('.cal-review-panel[data-comp="video"] .cal-review-video-tile'); const w = t.parentElement; return { wrapper: w.className, display: getComputedStyle(w).display }; });
    expect(!/fv-review-video/.test(tile.wrapper) || tile.display === 'contents', `switch: no row: the review tile sits where it always did (${tile.wrapper || 'no wrapper'} / ${tile.display})`);
    await shot(page, 'switch-off-smm-review');
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
    await smmReviewRun(browser, origin);
    await kasperRun(browser, origin, 'desktop', { viewport: { width: 1440, height: 900 } });
    await kasperRun(browser, origin, 'phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await clientLinkRun(browser, origin);
    await flagRun(browser, origin);
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
  console.log('\nframeio-viewer-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
