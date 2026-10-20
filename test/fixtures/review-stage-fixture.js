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
/* The page's real web font, served from the repo's own copy (the start page bundles Plus Jakarta Sans, weights 300 to
   800). Blocking Google Fonts left text in each machine's fallback font, so layout measurements differed between a
   sandbox and CI (review-stage-skeleton failed only on CI, 2026-10-18). */
const WEB_FONT = fs.readFileSync(path.join(__dirname, '..', '..', 'start', 'assets', 'plus-jakarta-sans.woff2'));
const WEB_FONT_CSS = "@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:300 800;font-display:swap;src:url(https://fonts.gstatic.com/fixture/plus-jakarta-sans.woff2) format('woff2')}";
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
  const state = opt.state || { cards: cards(opt.stage).concat(opt.finished ? finished() : []), upserts: [], gateway: [], flagReads: 0, orient: opt.orient || 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0 };
  const stamp = () => new Date(Date.now() + Number(state.clockOffset || 0)).toISOString();
  // Gauntlet Three can share a backend across independent tabs and interrupt an actual save request.
  if (!state.attempts) state.attempts = [];
  // opt.orient: 'l' makes the video clip wide; opt.thumbs: 'l' or 'p' gives every card a wide or a vertical thumbnail.
  if (opt.thumbs && !opt.state) state.cards.forEach(c => { c.thumbnail_url = POSTER[opt.thumbs]; });
  // opt.extraCards: that many more waiting posts, for a list that has to scroll.
  if (opt.extraCards && !opt.state) {
    const S = opt.stage === 'smm' ? 'For SMM Approval' : opt.stage === 'kasper' ? 'Kasper Approval' : 'Client Approval';
    for (let i = 0; i < opt.extraCards; i++) state.cards.push({ id: 'rx' + i, client: SLUG, name: 'Extra post ' + (i + 1), status: S, order_index: 40 + i, updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: '2026-12-' + String(1 + (i % 27)).padStart(2, '0'), video_status: S, graphic_status: S, caption_status: S, asset_url: FRAME, thumbnail_url: POSTER.p, caption: 'An extra fixture caption.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] });
  }
  if (opt.linkedParts) state.cards.forEach(c => { c.graphic_deliverable_id = 'fixture_graphic_' + c.id; });
  if (opt.youtube) { state.cards[0].platforms = 'youtube'; state.cards[0].title_status = opt.stage === 'kasper' ? 'Kasper Approval' : 'Client Approval'; state.cards[0].title_tweaks = '[]'; }
  if (opt.nativeReceipts && !state.nativeRows) {
    state.nativeRows = {};
    state.nativeReceipts = {};
    for (const c of state.cards) for (const comp of ['video', 'graphic']) if (c[comp + '_deliverable_id']) {
      state.nativeRows[c[comp + '_deliverable_id']] = { id: c[comp + '_deliverable_id'], card_id: c.id, client_slug: SLUG, team: comp === 'graphic' ? 'graphics' : 'video', status: opt.stage === 'kasper' ? 'kasper_approval' : 'client_approval', updated_at: c.updated_at, status_at: c.updated_at };
    }
  }
  if (opt.thread) thread(state.cards[0]);
  // opt.collab: the calendar's Collaborative mode is on (a settings row, as the live calendar keeps it).
  if (opt.collab) state.cards.push({ id: 'p_cal_settings', client: SLUG, caption: JSON.stringify({ collab_mode: true }) });
  // opt.unscheduled: one card with no date, so Month and Week show their undated list where it is offered ('approved' makes it a finished post, which a client sees with Collaborative mode off too).
  if (opt.unscheduled) { const done = opt.unscheduled === 'approved' ? 'Approved' : 'Client Approval'; state.cards.push({ id: 'ru1', client: SLUG, name: 'An undated idea', status: done, order_index: 30, updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: '', video_status: done, graphic_status: done, caption_status: done, asset_url: FRAME, thumbnail_url: POSTER.p, caption: 'No date yet.', cta: 'Link in bio', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] }); }
  const ctx = await browser.newContext(Object.assign({ viewport: { width: opt.width || 1440, height: opt.height || 900 }, serviceWorkers: 'block', colorScheme: 'light' }, opt.context || {}));
  await ctx.routeWebSocket('**/*', s => s.close());
  const page = await ctx.newPage();
  if (opt.clock) await page.clock.install();
  const errors = [];
  page.on('pageerror', e => {
    // Phone runs (opt.context) keep a longer stack so a WebKit-only error can be located.
    errors.push(String(opt.context ? e.stack || e.message || e : e.message || e).slice(0, opt.context ? 1200 : 200));
    if (opt.errorStacks) (state.errorStacks || (state.errorStacks = [])).push(String(e.stack || e));
  });
  if (opt.phone) await page.addInitScript(() => {
    window.__phoneErrorLocations = [];
    addEventListener('error', e => {
      let file = ''; try { file = new URL(e.filename).pathname; } catch (_) {}
      window.__phoneErrorLocations.push({ message: e.message, file, line: e.lineno, column: e.colno, stack: String(e.error?.stack || '').replace(/\?[^\s)]+/g, '?fixture') });
    });
    addEventListener('unhandledrejection', e => window.__phoneErrorLocations.push({ message: String(e.reason?.message || e.reason), rejection: true, stack: String(e.reason?.stack || '').replace(/\?[^\s)]+/g, '?fixture') }));
  });
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
    if (opt.stageSource && r.url().startsWith(origin + '/js/') && /\/sv-\d+-reviewstage-[a-f0-9]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: opt.stageSource });
    if (r.url().startsWith(origin)) return route.continue();
    const json = (body, status) => {
      if (state.clockOffset && body && body.video) { body.video.expires_at = new Date(Date.now() + state.clockOffset + 3600000).toISOString(); body.fetched_at = stamp(); }
      return route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname, sp = u.searchParams;
    if (/\/functions\/v1\/(calendar-upsert|calendar-card-write|production-write)$/.test(p) && r.method() === 'POST') {
      state.attempts.push({ endpoint: p.split('/').pop(), body: JSON.parse(r.postData() || '{}') });
      if (state.dropBefore > 0) { state.dropBefore--; return route.abort('connectionfailed'); }
      if (state.refusal) return json({ ok: false, error: state.refusal.code, message: 'The fixture refused this save.' }, state.refusal.status || 409);
    }
    if (/supabase-js/.test(r.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: CORS, body: FAKE_SUPABASE });
    if (u.host === 'media.fixture.test' && /\.png$/.test(p)) return route.fulfill({ status: 200, headers: CORS, contentType: 'image/png', body: /-l\.png$/.test(p) ? PNG.l : PNG.p });
    if (u.host === 'media.fixture.test') {
      const clip = CLIP[state.orient];
      const contentType = 'video/webm';
      const range = /bytes=(\d+)-(\d*)/.exec(r.headers().range || '');
      if (range) { const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1; return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': `bytes ${a}-${b}/${clip.length}`, 'accept-ranges': 'bytes' }, CORS), contentType, body: clip.subarray(a, b + 1) }); }
      return route.fulfill({ status: 200, headers: Object.assign({ 'accept-ranges': 'bytes' }, CORS), contentType, body: clip });
    }
    // opt.noWebFont: keep the old no-font conditions (a test about layout that must not see the font swap).
    if (opt.noWebFont && (u.host === 'fonts.googleapis.com' || u.host === 'fonts.gstatic.com')) return route.abort();
    if (u.host === 'fonts.googleapis.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'text/css', body: WEB_FONT_CSS });
    if (u.host === 'fonts.gstatic.com') return route.fulfill({ status: 200, headers: CORS, contentType: 'font/woff2', body: WEB_FONT });
    // A slow staff sign-in check (opt.keyVerifyDelay ms): routing waits for it, so the page sits unrouted that long.
    if (p === '/functions/v1/key-verify' && opt.keyVerifyDelay) await sleep(opt.keyVerifyDelay);
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
    if (p === '/functions/v1/frameio-view') {
      // Windows WebKit's media loader bypasses Playwright routing. Serve its generated H.264 fixture on loopback.
      const media = opt.phoneMedia ? origin + '/test/fixtures/review-stage-phone-clip.mp4' : MEDIA;
      return json({ ok: true, video: { url: media, renditions: { efficient: media, high_quality: media, original: media }, expires_at: new Date(Date.now() + 3600000).toISOString(), name: 'Fixture clip.mp4', file_id: 'f1', duration_seconds: 12, fps: 24 }, comments: [], comments_error: '', open_url: 'https://next.frame.io/share/00000000-0000-4000-8000-000000000001', fetched_at: new Date().toISOString() });
    }
    if (/\/functions\/v1\/(calendar-upsert|calendar-card-write)$/.test(p) && r.method() === 'POST') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      state.writeAttempts++;
      // A slow or failing card save, switched at run time by a test (state.writeDelay ms, state.writeFail count).
      if (state.writeHang) return new Promise(() => {});   // a server that never answers
      state.upsertAt = (state.upsertAt || []).concat(Date.now());
      if (state.writeDelay) await sleep(state.writeDelay);
      if (state.writeOffline) return route.abort('internetdisconnected');
      if (state.writeFail > 0) { state.writeFail--; return json({ ok: false, error: 'fixture_unavailable', message: 'The fixture refused this save.' }, 503); }
      const post = body.post || {};
      state.upserts.push(post);
      const row = state.cards.find(c => c.id === post.id);
      if (row) {
        const patch = { ...post };
        if (opt.mergeComments) for (const key of ['video_tweaks', 'graphic_tweaks', 'caption_tweaks', 'title_tweaks']) {
          if (!(key in patch)) continue;
          // The real endpoint unions comment ids when comments_base_at is empty (the v2 wire contract).
          const byId = new Map(JSON.parse(row[key] || '[]').map(n => [n.id, n]));
          JSON.parse(patch[key] || '[]').forEach(n => { const old = byId.get(n.id); if (!old || String(n.updated_at) >= String(old.updated_at)) byId.set(n.id, n); });
          patch[key] = JSON.stringify([...byId.values()]);
        }
        Object.assign(row, patch, { updated_at: stamp() });
      }
      if (state.dropAfter > 0) { state.dropAfter--; return route.abort('connectionfailed'); }
      return json({ ok: true, post: row || post });
    }
    if (p === '/functions/v1/production-write' && r.method() === 'POST') {
      state.writeAttempts++;
      if (state.networkDelay) await sleep(state.networkDelay);
      if (state.writeOffline) return route.abort('internetdisconnected');
      if (opt.nativeReceipts && state.writeDelay) await sleep(state.writeDelay);
      if (opt.nativeReceipts && state.writeFail > 0) { state.writeFail--; return json({ ok: false, error: 'fixture_unavailable', message: 'The fixture refused this save.' }, 503); }
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      if (state.gatewayDelay) await sleep(state.gatewayDelay);   // a slow status write (state.gatewayDelay ms, set at run time)
      state.gateway.push(r.postData() || '');
      if (opt.nativeReceipts) {
        const row = state.nativeRows[b.id];
        if (!row) return json({ ok: false, error: 'entity_not_found' }, 404);
        if (b.reconcile_only) return json(state.nativeReceipts[b.request_id] ? { ...state.nativeReceipts[b.request_id], outcome: 'committed_exact' } : { ok: true, outcome: 'absent', row });
        if (state.nativeReceipts[b.request_id]) return json(state.nativeReceipts[b.request_id]);
        row.updated_at = stamp();
        if (b.operation === 'status') { row.status = b.status; row.status_at = row.updated_at; }
        const result = { ok: true, native_committed: true, complete: true, row: { ...row }, ...(b.operation === 'comment' ? { comment: { ...b.comment, id: b.comment.native_comment_id, created_at: b.source_edited_at, updated_at: b.source_edited_at, source_created_at: b.source_edited_at, source_updated_at: b.source_edited_at } } : {}) };
        state.nativeReceipts[b.request_id] = result;
        return json(result);
      }
      if (opt.phone && !opt.nativeReceipts) {
        const id = b.id || b.deliverable_id || 'del_rs1';
        const card = state.cards.find(c => c.video_deliverable_id === id || c.graphic_deliverable_id === id);
        const prior = state.native[id], seen = b.request_id && state.receipts[b.request_id];
        const now = new Date().toISOString();
        const row = { id, card_id: card?.id || b.card_id || 'rs1', client_slug: SLUG,
          team: card?.graphic_deliverable_id === id ? 'graphics' : 'video',
          status: b.status || prior?.status || 'client_approval',
          status_at: b.operation === 'status' ? now : prior?.status_at || now, updated_at: now };
        // Reconciliation reads do not commit an intent; retries return its original receipt.
        if (!b.reconcile_only && !seen) {
          state.native[id] = row;
          if (b.request_id) state.receipts[b.request_id] = row;
        }
        const committed = !b.reconcile_only || !!seen;
        return json({ ok: true, native_committed: committed, authority: 'syncview', complete: committed,
          outcome: committed ? 'committed_exact' : 'absent', row: b.reconcile_only ? seen || prior || row : seen || row });
      }
      return json({ ok: true, native_committed: true, authority: 'syncview', complete: true, outcome: 'absent', row: { id: b.deliverable_id || 'del_rs1', card_id: b.card_id || 'rs1', client_slug: SLUG, team: 'video', status: b.status || 'client_approval' } });
    }
    if (p === '/rest/v1/syncview_runtime_flags') {
      state.flagReads++;
      const raw = sp.get('key') || '';
      const keys = raw.startsWith('in.(') ? raw.slice(4, -1).split(',') : [raw.replace(/^eq\./, '')];
      if (opt.flags === 'unreadable' && keys.includes('review_stage_client_pages')) return json({ message: 'fixture' }, 500);
      // A slow switch read (opt.flagDelay ms), as on the live site, where it took 1.5 to 3.7 s (session Curtain Three).
      if (opt.flagDelay && keys.includes('review_stage_client_pages')) await sleep(opt.flagDelay);
      // A slow read of the player's switch (opt.frameDelay ms).
      if (opt.frameDelay && keys.includes('frame_viewer_clients')) await sleep(opt.frameDelay);
      const values = {
        calendar_upsert_ef_clients: { clients: [SLUG] }, write_ui_reroute_clients: { clients: [SLUG] },
        client_comment_gateway_enabled: { enabled: true }, prod_authority: { video: 'syncview', graphics: 'syncview' },
        frame_viewer_clients: opt.frame === 'off' ? { clients: [] } : { all: true },
      };
      if (opt.flags === 'on') { values.review_stage_client_pages = { clients: [SLUG] }; values.review_stage_kasper_staff = { staff: [STAFF.id] }; }
      // opt.layout2: Kasper's second layout (all parts at once, a list on the left) for the signed-in staff member.
      if (opt.layout2) values.review_stage_kasper_layout2 = opt.layout2 === true ? { staff: [STAFF.id] } : opt.layout2;
      if (opt.help) values.review_help_video_url = { url: opt.help };
      // 'shownFresh': the same answer in a browser that has never seen Analytics shown.
      if (opt.analytics === 'shown' || opt.analytics === 'shownFresh') values.analytics_hidden = { hidden: false };
      else if (opt.analytics && typeof opt.analytics === 'object') values.analytics_hidden = opt.analytics;
      return json(keys.filter(k => Object.hasOwn(values, k)).map(k => ({ key: k, value: values[k] })));
    }
    if (p === '/rest/v1/calendar_posts') {
      if (opt.postsFail) return json({ message: 'fixture' }, 503);
      // A slow card read (opt.postsDelay ms, or state.postsDelay set at run time).
      if (opt.postsDelay || state.postsDelay) await sleep(state.postsDelay || opt.postsDelay);
      const slug = String(sp.get('client') || '').replace(/^eq\./, '');
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(state.cards.filter(c => (!slug || c.client === slug) && (!one || c.id === one)));
    }
    if (opt.phone && p === '/rest/v1/deliverables') {
      const id = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(state.native[id] ? [state.native[id]] : []);
    }
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, kind: 'client', active: true }]);
    if (p === '/rest/v1/team_members') return json([STAFF, OTHER].map(m => Object.assign({ active: true }, m)));
    if (p === '/rest/v1/deliverables' && opt.nativeReceipts) {
      const id = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(Object.values(state.nativeRows).filter(row => !id || row.id === id));
    }
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
