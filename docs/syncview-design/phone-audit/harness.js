'use strict';
/* Offline harness for the phone audit (session Grip, 2026-10-25; first written by session Palm for the #2307 mockups).
   Staff pages: the shared mock backend in docs/syncview-design/tests/lost-work-lib.js (every backend answer
   local, nothing leaves the machine), seeded with fixture.js, plus the Messages inbox answered from the same notes.
   Client link: a local copy of the client-link fixture with the same posts. The bundled Plus Jakarta Sans
   (start/assets) is served for the Google Fonts request so the type matches the live site. */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep, REPO } = require('../tests/lost-work-lib');
const { cards } = require('./fixture');

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const FLAGS = {
  review_stage_client_pages: { all: true },
  workload_calm_staff: { all: true },
  // Mirrors what the owner's own login has on (read-only from syncview_runtime_flags, 2026-10-25); m1 is the
  // harness's signed-in staff member.
  unread_badges_v2: { staff: ['m1'] },
  caption_history_staff: { staff: ['m1'] },
  thumbnail_title_buttons_staff: { staff: ['m1'] },
  review_client_polish: { all: true },
};
if (process.env.PHONE_POLISH !== '0') FLAGS.phone_polish_staff = { staff: ['m1'] };
const FONT = fs.readFileSync(path.join(REPO, 'start', 'assets', 'plus-jakarta-sans.woff2'));

function rowFor(c, slug, i) {
  return {
    id: c.id, client: slug, name: c.name, status: c.status, order_index: i + 1,
    updated_at: new Date().toISOString(), scheduled_date: c.date, video_status: c.video, graphic_status: c.graphic,
    caption_status: c.caption, title_status: 'In Progress', caption: c.captionText, name_set: true, platforms: 'instagram',
    video_tweaks: JSON.stringify(c.parts.video || []), graphic_tweaks: JSON.stringify(c.parts.graphic || []),
    caption_tweaks: JSON.stringify(c.parts.caption || []), title_tweaks: '[]',
    comments: [], graphic_comments: [], caption_comments: [], title_comments: [],
    video_deliverable_id: 'dv_' + c.id, graphic_deliverable_id: 'dg_' + c.id, linear_issue_id: 'VID-' + (i + 1), graphic_linear_issue_id: 'GRA-' + (i + 1),
    asset_url: 'https://example.invalid/' + c.id + '.mp4', thumbnail_url: 'https://drive.google.com/file/d/mock_' + c.id + '/view',
  };
}
const HUES = ['#e8c9a0', '#c7b8ea', '#a8d5c2', '#f2b8b0', '#b8cfe8', '#e8e0a8', '#d0b8a8', '#a8c8e0', '#c8c8c8'];
function thumbSvg(id) {
  const i = Math.abs([...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) % HUES.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${HUES[i]}"/><stop offset="1" stop-color="#5a4a3a"/></linearGradient></defs><rect width="540" height="960" fill="url(#g)"/><circle cx="270" cy="420" r="120" fill="#fff" opacity=".25"/></svg>`;
}

async function fontsAndThumbs(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', headers: CORS,
    body: "@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:200 800;font-display:block;src:url(https://fonts.gstatic.com/pjs.woff2) format('woff2')}" }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.fulfill({ contentType: 'font/woff2', headers: CORS, body: FONT }));
  await ctx.route('https://lh3.googleusercontent.com/**', r => r.fulfill({ contentType: 'image/svg+xml', headers: CORS, body: thumbSvg(new URL(r.request().url()).pathname.split('=')[0]) }));
  await ctx.route('https://example.invalid/thumb/**', r => r.fulfill({ contentType: 'image/svg+xml', headers: CORS, body: thumbSvg(new URL(r.request().url()).pathname.replace(/^\/thumb\//, '/d/mock_').replace('.svg', '')) }));
}

function inboxFrom(list, slug, clientName) {
  const convs = [];
  for (const c of list) {
    const messages = [];
    for (const comp of Object.keys(c.parts)) for (const m of c.parts[comp]) messages.push(Object.assign({ component: comp }, m));
    if (!messages.length) continue;
    messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const seenAt = c.seen != null ? new Date(Date.now() - c.seen * 60000).toISOString() : '';
    const last = messages[messages.length - 1];
    convs.push({ post_id: c.id, client_slug: slug, client_name: clientName, title: c.name, thumbnail_url: 'https://example.invalid/thumb/' + c.id + '.svg', asset_url: '', status: c.status,
      last_at: last.created_at, last_author: last.author, last_author_member_id: '', last_role: last.role, last_body: last.body, last_read_at: seenAt,
      unread: messages.filter(m => m.created_at > seenAt && m.role !== 'smm').length, messages });
  }
  return convs.sort((a, b) => b.last_at.localeCompare(a.last_at));
}

/* Staff env: lost-work-lib + our posts + flags + inbox. */
async function staffEnv(opts) {
  const S = await createEnv(opts);
  const list = cards();
  S.cards.length = 0;
  list.forEach((c, i) => S.cards.push(rowFor(c, 'fixtureclient', i)));
  const seen = {};
  list.forEach(c => { if (c.seen != null) seen[c.id] = new Date(Date.now() - c.seen * 60000).toISOString(); });
  const convs = inboxFrom(list, 'fixtureclient', 'Sample Bakery');
  await S.ctx.addInitScript(([seenMap]) => { try { localStorage.setItem('syncview_notes_seen_v1', JSON.stringify(seenMap)); } catch (e) {} }, [seen]);
  await fontsAndThumbs(S.ctx);
  await S.ctx.route('**/rest/v1/clients**', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ slug: 'fixtureclient', display_name: 'Sample Bakery', active: true, kind: 'test', linear_project_ids: [{ id: 'proj1' }] }]) }));
  await S.ctx.route('**/rest/v1/syncview_runtime_flags**', async route => {
    const u = new URL(route.request().url()); const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: FLAGS[k] || (k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false }) }));
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fallback();
    let b = {}; try { b = r.method() === 'GET' ? { action: new URL(r.url()).searchParams.get('action') } : JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (b.action === 'inbox') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, scope: 'all', conversations: convs }) });
    if (b.action === 'inbox_mark') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, post_id: b.post_id, last_read_at: null }) });
    return route.fallback();
  });
  S.list = list;
  return S;
}

/* Client link env: its own browser context at phone size, with the same posts as the client sees them. */
const C_SLUG = 'fixturebakery', C_NAME = 'Fixture Bakery', C_TOKEN = 'synthetic-mockup-token';
async function clientPage(browser, origin, { width, height, theme }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, serviceWorkers: 'block' });
  const list = cards();
  // The client sees client-audience notes only; posts waiting for them first.
  const rows = list.filter(c => c.status !== 'Posted').map((c, i) => {
    const r = rowFor(c, C_SLUG, i);
    for (const k of ['video_tweaks', 'graphic_tweaks', 'caption_tweaks']) r[k] = JSON.stringify(JSON.parse(r[k]).filter(m => m.audience === 'client'));
    return r;
  });
  await ctx.route(u => !u.toString().startsWith(origin), async route => {
    const r = route.request(); const u = new URL(r.url());
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (/fonts\.googleapis/.test(u.host)) return route.fulfill({ contentType: 'text/css', headers: CORS, body: "@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:200 800;font-display:block;src:url(https://fonts.gstatic.com/pjs.woff2) format('woff2')}" });
    if (/fonts\.gstatic/.test(u.host)) return route.fulfill({ contentType: 'font/woff2', headers: CORS, body: FONT });
    if (u.host === 'lh3.googleusercontent.com') return route.fulfill({ contentType: 'image/svg+xml', headers: CORS, body: thumbSvg(u.pathname.split('=')[0]) });
    if (u.pathname === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      return json({ ok: true, valid: true, allowed: true, slug: C_SLUG, display_name: C_NAME, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (r.method() !== 'GET' && r.method() !== 'HEAD') return json({ ok: true });   // nothing is written anywhere
    if (u.pathname === '/rest/v1/calendar_posts') return json(rows);
    if (u.pathname === '/rest/v1/clients') return json([{ slug: C_SLUG, kind: 'client', active: true, display_name: C_NAME }]);
    if (u.pathname === '/rest/v1/syncview_runtime_flags') {
      if (/prod_authority/.test(u.search)) return json([{ key: 'prod_authority', value: { video: 'linear', graphics: 'linear' } }]);
      return json(Object.keys(FLAGS).map(k => ({ key: k, value: FLAGS[k] })));
    }
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  await ctx.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e.message || e).slice(0, 200)));
  const q = new URLSearchParams({ c: C_NAME, t: C_TOKEN, v: 'calendar' });
  await page.goto(`${origin}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

module.exports = { staffEnv, clientPage, sleep, REPO, FLAGS };
