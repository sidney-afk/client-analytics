'use strict';
/* The offline fixture behind the new review page's browser tests (layout C): a mocked backend with fictional
   clients, cards, people and tokens. Shared by review-stage-browser.js and review-stage-client-layout-browser.js. */
const fs = require('node:fs');
const path = require('node:path');

const CLIENT = 'Fixture Studio';
const SLUG = 'fixturestudio';
const TOKEN = 'fixture-review-stage-token';
const STAFF = { id: 'qa_marquee', name: 'Fixture Owner', role: 'admin', team: null };
const OTHER = { id: 'qa_other', name: 'Fixture Reviewer', role: 'admin', team: null };
const FRAME = 'https://f.io/FixtureClip1';
const MEDIA = 'https://media.fixture.test/clip.webm';
const POSTER = { l: 'https://media.fixture.test/poster-l.png', p: 'https://media.fixture.test/poster-p.png' };
const CLIP = { l: fs.readFileSync(path.join(__dirname, 'frameio-viewer-clip.webm')), p: fs.readFileSync(path.join(__dirname, 'frameio-viewer-clip-vertical.webm')) };
const PNG = { l: fs.readFileSync(path.join(__dirname, 'frameio-viewer-poster-landscape.png')), p: fs.readFileSync(path.join(__dirname, 'frameio-viewer-poster-vertical.png')) };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const FAKE_SUPABASE = "window.supabase={createClient:function(){return{channel:function(){var ch={on:function(){return ch;},subscribe:function(){return ch;}};return ch;},removeChannel:function(){}};}};";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const note = (id, role, author, body, at, extra) => Object.assign({ id, parent_id: null, author, role, is_tweak: false, audience: role === 'client' ? 'client' : 'client', body, created_at: at, updated_at: at, done: false, done_at: '', done_by: '' }, extra || {});
function cards(stage) {
  const S = stage === 'smm' ? 'For SMM Approval' : stage === 'kasper' ? 'Kasper Approval' : 'Client Approval';
  return [
    { id: 'rs1', client: SLUG, name: 'Why the first second matters', status: S, order_index: 1, updated_at: '2026-10-10T12:00:00.000Z',
      scheduled_date: '2026-10-23', video_status: S, graphic_status: S, caption_status: S, asset_url: FRAME, thumbnail_url: POSTER.p,
      caption: 'Most people decide in the first second. Here is how to earn the second one: start with the change, not the context.',
      video_deliverable_id: 'del_rs1', linear_issue_id: '', video_tweaks: JSON.stringify([note('n1', 'smm', 'Team Member', 'New cut uploaded. The intro is two seconds shorter.', '2026-10-12T16:12:00.000Z')]),
      graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] },
    { id: 'rs2', client: SLUG, name: 'Three habits for a calmer week', status: S, order_index: 2, updated_at: '2026-10-10T12:00:00.000Z',
      scheduled_date: '2026-10-25', video_status: S, graphic_status: 'Approved', caption_status: S, asset_url: FRAME, thumbnail_url: POSTER.l,
      caption: 'Three habits, one calmer week.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] },
    { id: 'rs3', client: SLUG, name: 'The question nobody asks', status: S, order_index: 3, updated_at: '2026-10-10T12:00:00.000Z',
      scheduled_date: '2026-10-28', video_status: S, graphic_status: S, caption_status: S, asset_url: FRAME, thumbnail_url: POSTER.p,
      caption: 'Ask it this week.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] },
  ].concat(['A slower morning', 'What to cut first', 'One list, not three', 'The Friday reset'].map((name, i) => ({
    id: 'rs' + (4 + i), client: SLUG, name, status: S, order_index: 4 + i, updated_at: '2026-10-10T12:00:00.000Z',
    scheduled_date: '2026-11-0' + (2 + i), video_status: S, graphic_status: S, caption_status: S, asset_url: FRAME, thumbnail_url: i % 2 ? POSTER.l : POSTER.p,
    caption: 'A short fixture caption.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] })));
}

// Finished posts, so the Sheet, Month and Week tabs have something to show (opt.finished).
function finished() {
  return ['Behind the scenes', 'Five quick wins', 'Monday reset', 'A year in one minute'].map((name, i) => ({
    id: 'rf' + (1 + i), client: SLUG, name, status: 'Approved', order_index: 20 + i, updated_at: '2026-10-10T12:00:00.000Z',
    scheduled_date: '2026-10-' + String(13 + i * 2).padStart(2, '0'), video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved',
    asset_url: FRAME, thumbnail_url: i % 2 ? POSTER.l : POSTER.p, caption: 'A finished fixture caption.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] }));
}

// A fuller conversation on the first post (opt.thread): change requests (one handled), team notes, the signed-in
// SMM's own note, Kasper's note, and a whole caption pasted as a change request (session Curtain Six).
const LONG_CAPTION = 'Please use this caption:\n\nMost people decide in the first second whether to keep watching. Here is how to earn the second one: '
  + 'start with the change, not the context. Show the result first, then rewind to how you got there. Keep the first line under ten words, '
  + 'cut every "so" and "today I want to", and let the picture do the talking for the first beat.\n\nSave this for your next edit.';
function thread(row) {
  const T = (id, role, author, body, at, extra) => note(id, role, author, body, at, extra);
  row.video_tweaks = JSON.stringify([
    T('t1', 'client', CLIENT, 'Can we cut the pause after the hook? It feels slow.', '2026-10-11T09:02:00.000Z', { is_tweak: true, done: true, done_at: '2026-10-12T10:00:00.000Z' }),
    T('t2', 'smm', 'Team Member', 'Done. The pause is gone in the new cut.', '2026-10-12T10:01:00.000Z', { author_member_id: OTHER.id }),
    T('t3', 'kasper', 'Kasper', 'Looks good to me. Sending it to the client.', '2026-10-12T15:20:00.000Z', { audience: 'team' }),
    T('t4', 'smm', 'Team Member', 'New cut uploaded. The intro is two seconds shorter.', '2026-10-12T16:12:00.000Z', { author_member_id: OTHER.id }),
    T('t5', 'client', CLIENT, 'Love it. Could the end card stay a beat longer?', '2026-10-13T08:40:00.000Z', { is_tweak: true }),
  ]);
  row.graphic_tweaks = JSON.stringify([
    T('g1', 'smm', STAFF.name, 'Thumbnail text is bigger now, as asked on the last post.', '2026-10-12T11:30:00.000Z', { author_member_id: STAFF.id }),
    T('g2', 'client', CLIENT, 'Thanks, that reads much better on the phone.', '2026-10-13T08:41:00.000Z'),
  ]);
  row.caption_tweaks = JSON.stringify([
    T('c1', 'client', CLIENT, LONG_CAPTION, '2026-10-13T08:45:00.000Z', { is_tweak: true }),
  ]);
  return row;
}

async function open(browser, origin, opt) {
  const state = { cards: cards(opt.stage).concat(opt.finished ? finished() : []), upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0 };
  if (opt.thread) thread(state.cards[0]);
  const ctx = await browser.newContext({ viewport: { width: opt.width || 1440, height: opt.height || 900 }, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.routeWebSocket('**/*', s => s.close());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  if (opt.staff) {
    const id = JSON.stringify({ key: 'qa-key', role: opt.staff.role, member: opt.staff, verified_at: new Date().toISOString() });
    await page.addInitScript(([v, dark]) => { try { localStorage.setItem('syncview_staff_identity_v1', v); localStorage.setItem('syncview_auth_v1', 'ok'); if (dark) localStorage.setItem('syncview_theme', 'dark'); } catch (e) {} }, [id, !!opt.dark]);
  } else if (opt.dark) {
    await page.addInitScript(() => { try { localStorage.setItem('syncview_theme', 'dark'); } catch (e) {} });
  }
  // opt.analytics === 'shown': analytics_hidden reads { hidden: false } (Analytics brought back), in a browser that
  // already saw it shown. Without it the row is missing, which hides Analytics (session Curtain Seven).
  if (opt.analytics === 'shown') await page.addInitScript(() => { try { localStorage.setItem('sv-analytics-shown', '1'); } catch (e) {} });
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname, sp = u.searchParams;
    if (/supabase-js/.test(r.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: CORS, body: FAKE_SUPABASE });
    if (u.host === 'media.fixture.test' && /\.png$/.test(p)) return route.fulfill({ status: 200, headers: CORS, contentType: 'image/png', body: /-l\.png$/.test(p) ? PNG.l : PNG.p });
    if (u.host === 'media.fixture.test') {
      const clip = CLIP[state.orient];
      const range = /bytes=(\d+)-(\d*)/.exec(r.headers().range || '');
      if (range) { const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1; return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': `bytes ${a}-${b}/${clip.length}`, 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip.subarray(a, b + 1) }); }
      return route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType: 'video/webm', body: clip });
    }
    if (u.host === 'fonts.googleapis.com' || u.host === 'fonts.gstatic.com') return route.abort();
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: opt.staff ? opt.staff.role : 'admin', member: opt.staff || STAFF });
    if (p === '/functions/v1/client-token-verify') {
      const b = JSON.parse(r.postData() || '{}');
      return json(b.slug === SLUG && b.token === TOKEN ? { ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: b.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' } : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
    }
    // The Messages inbox (opt.inbox: a list of fictional conversations); without it the inbox is empty.
    if (p === '/functions/v1/production-comments' && r.method() === 'POST' && opt.inbox) {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      if (b.action === 'inbox') return json({ ok: true, scope: 'all', conversations: opt.inbox });
      return json({ ok: true });
    }
    if (p === '/functions/v1/frameio-view') return json({ ok: true, video: { url: MEDIA, renditions: { efficient: MEDIA, high_quality: MEDIA, original: MEDIA }, expires_at: new Date(Date.now() + 3600000).toISOString(), name: 'Fixture clip.mp4', file_id: 'f1', duration_seconds: 12, fps: 24 }, comments: [], comments_error: '', open_url: 'https://next.frame.io/share/00000000-0000-4000-8000-000000000001', fetched_at: new Date().toISOString() });
    if (/\/functions\/v1\/(calendar-upsert|calendar-card-write)$/.test(p) && r.method() === 'POST') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      // A slow or failing card save, switched at run time by a test (state.writeDelay ms, state.writeFail count).
      if (state.writeDelay) await sleep(state.writeDelay);
      if (state.writeFail > 0) { state.writeFail--; return json({ ok: false, error: 'fixture_unavailable', message: 'The fixture refused this save.' }, 503); }
      const post = body.post || {};
      state.upserts.push(post);
      const row = state.cards.find(c => c.id === post.id);
      if (row) Object.assign(row, post, { updated_at: new Date().toISOString() });
      return json({ ok: true, post: row || post });
    }
    if (p === '/functions/v1/production-write' && r.method() === 'POST') {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      state.gateway.push(r.postData() || '');
      return json({ ok: true, native_committed: true, authority: 'syncview', complete: true, outcome: 'absent', row: { id: b.deliverable_id || 'del_rs1', card_id: b.card_id || 'rs1', client_slug: SLUG, team: 'video', status: b.status || 'client_approval' } });
    }
    if (p === '/rest/v1/syncview_runtime_flags') {
      state.flagReads++;
      const raw = sp.get('key') || '';
      const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
      if (opt.flags === 'unreadable' && keys.includes('review_stage_client_pages')) return json({ message: 'fixture' }, 500);
      // A slow switch read (opt.flagDelay ms), as on the live site, where it took 1.5 to 3.7 s (session Curtain Three).
      if (opt.flagDelay && keys.includes('review_stage_client_pages')) await sleep(opt.flagDelay);
      const values = {
        calendar_upsert_ef_clients: { clients: [SLUG] }, write_ui_reroute_clients: { clients: [SLUG] },
        client_comment_gateway_enabled: { enabled: true }, prod_authority: { video: 'syncview', graphics: 'syncview' },
        frame_viewer_clients: opt.frame === 'off' ? { clients: [] } : { all: true },
      };
      if (opt.flags === 'on') { values.review_stage_client_pages = { clients: [SLUG] }; values.review_stage_kasper_staff = { staff: [STAFF.id] }; }
      if (opt.help) values.review_help_video_url = { url: opt.help };
      // 'shownFresh': the same answer in a browser that has never seen Analytics shown.
      if (opt.analytics === 'shown' || opt.analytics === 'shownFresh') values.analytics_hidden = { hidden: false };
      else if (opt.analytics && typeof opt.analytics === 'object') values.analytics_hidden = opt.analytics;
      return json(keys.filter(k => Object.hasOwn(values, k)).map(k => ({ key: k, value: values[k] })));
    }
    if (p === '/rest/v1/calendar_posts') {
      if (opt.postsFail) return json({ message: 'fixture' }, 503);
      const slug = String(sp.get('client') || '').replace(/^eq\./, '');
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(state.cards.filter(c => (!slug || c.client === slug) && (!one || c.id === one)));
    }
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
    if (p === '/rest/v1/team_members') return json([STAFF, OTHER].map(m => Object.assign({ active: true }, m)));
    if (p.startsWith('/rest/v1/')) return json([]);
    if (u.host === 'docs.google.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    if (p.startsWith('/functions/v1/') || p.startsWith('/webhook/')) return json({ ok: true });
    return route.abort();
  });
  return { page, ctx, state, errors };
}
async function openClient(browser, origin, opt) {
  const t = await open(browser, origin, Object.assign({ stage: 'client' }, opt));
  await t.page.goto(origin + '/index.html?' + new URLSearchParams(Object.assign({ c: CLIENT, v: 'calendar' }, opt.tab ? { tab: opt.tab } : {}, { t: TOKEN })), { waitUntil: 'domcontentloaded' });
  return t;
}
const host = page => page.locator('#svReviewStage');
const inS = (page, sel) => page.locator('#svReviewStage').locator(sel);
async function waitNew(t) { await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && !h.hidden && h.shadowRoot && h.shadowRoot.getElementById('stepper') && h.shadowRoot.getElementById('stepper').children.length); }, null, { timeout: 30000 }); }
async function confirmText(page) { return page.evaluate(() => { const o = document.getElementById('confirmOverlay'); return o && o.classList.contains('active') ? (document.getElementById('confirmTitle') || {}).textContent + ' | ' + ((document.getElementById('confirmMsg') || document.querySelector('#confirmOverlay p') || {}).textContent || '') : ''; }); }
async function answerConfirm(page) { const txt = await confirmText(page); if (txt) { console.log('     (the page asked: ' + txt.replace(/\s+/g, ' ').slice(0, 160) + ')'); await page.locator('#confirmYes').click(); } return txt; }


module.exports = { CLIENT, SLUG, TOKEN, STAFF, OTHER, FRAME, MEDIA, cards, open, openClient, host, inS, waitNew, confirmText, answerConfirm, sleep };
