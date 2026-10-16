'use strict';
/* note-send-outbox-browser.js -- a note shows the moment it is sent and is
 * never lost (owner, 2026-10-15; the note outbox in 190-calendar-approval-comments).
 *
 * Drives the real pages, fully mocked (nothing reaches a live backend):
 *
 *   Staff, Notes dialog (lost-work-lib.js; the video part, so the save goes
 *   through the write gateway and then the card):
 *     A fast path: the note is in the thread, marked "Sending…", at once, the
 *       box is empty and ready, and the mark goes when the server confirms
 *     B slow server: a second note can be written and sent while the first is
 *       still on its way; both arrive, once each, in order
 *     C server error then retry: "Not sent" with Tap to retry, the refusal is
 *       in the write-refusal log, Retry sends it once
 *     D double click on Send: one note
 *     E refresh mid-send, server committed but the answer was lost: after the
 *       reload the note is still there as "Not sent", Retry does not make a
 *       second one (one id per note, the server keeps one per id)
 *     L a caption note refused by the card save stays "Not sent" across a
 *       reopen and a refresh, and Retry saves it once
 *     K a card refreshed during its link lookup does not keep Send locked
 *     F a reply from the Messages page shows in the chat at once, then is saved
 *   Client, review link (own fixture; the caption part, saved on the card):
 *     G a plain comment shows "Sending…" at once and clears when saved
 *     H comment refused, then the page is refreshed: still there as "Not
 *       sent", Retry saves it once
 *     I Request changes with a note: the note stays in sight, "Sending…",
 *       while the request is on its way
 *
 * Every lane runs at desktop and 390 px; screenshots in light and dark go to
 * $SCREENSHOTS when set.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createEnv, sleep } = require('./lost-work-lib');
const { chromium } = require('playwright');

const failures = [];
let checks = 0;
const check = (c, m) => { checks++; console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60); } return false; };
const SHOTS = process.env.SCREENSHOTS || '';
const VIEWS = [
  { name: 'desktop', context: { viewport: { width: 1280, height: 900 } } },
  { name: 'phone', context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await sleep(120);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
}
const rowState = (page, text) => page.evaluate(text => {
  const rows = [...document.querySelectorAll('.cal-cm-row, .cal-review-comment, .msg-b')].filter(r => (r.textContent || '').includes(text));
  return rows.map(r => ({
    sending: r.classList.contains('is-outbox-sending'), failed: r.classList.contains('is-outbox-failed'),
    status: (r.querySelector('.sv-note-outbox') || {}).textContent || '', retry: !!r.querySelector('.sv-note-outbox-retry'),
    visible: !!(r.offsetParent || r.getClientRects().length),
  }));
}, text);

// ---------------------------------------------------------------- staff
async function staffLanes(view) {
  const S = await createEnv({ context: view.context });
  const tag = s => view.name + ' ' + s;
  try {
    // The real server keeps ONE comment per native_comment_id: a repeat of the
    // same id is answered with the comment it already has. The lib's mock does
    // not, so this route answers repeats and lets first sends through to it.
    const byNative = new Map();
    let lastNative = '';
    const commentsWith = text => S.comments.filter(c => c.body === text);
    const origPush = S.comments.push.bind(S.comments);
    S.comments.push = (...items) => { items.forEach(c => { c._nid = lastNative; if (lastNative) byNative.set(lastNative, c); }); return origPush(...items); };
    await S.ctx.route('**/functions/v1/production-write', async route => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (route.request().method() !== 'POST' || body.operation !== 'comment') return route.fallback();
      const nid = body.comment && body.comment.native_comment_id || '';
      if (nid && byNative.has(nid)) {
        S.log.push({ t: S.since(), key: 'gw:comment-replay', summary: nid });
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json',
          body: JSON.stringify({ ok: true, native_committed: true, mirror_pending: true, row: S.deliv[0], comment: byNative.get(nid) }) });
      }
      lastNative = nid;
      return route.fallback();
    });

    const page = await S.newPage();
    await S.openCalendar(page);
    const open = async () => {
      await page.evaluate(() => { openCalComments('p_t1'); });
      await page.waitForSelector('#calCommentsModal #calCommentComposer');
      await page.evaluate(() => _calSetComposeComp('video'));
    };
    const send = async (text, how = 'click') => {
      await page.fill('#calCommentComposer', text);
      const t0 = Date.now();
      if (how === 'double') await page.evaluate(() => { const b = document.querySelector('#calCommentsModal .cal-cm-send'); b.click(); b.click(); });
      else await page.click('#calCommentsModal .cal-cm-send');
      return t0;
    };
    await open();

    // A fast path
    S.behave['gw:comment'] = { delay: 900 };
    let t0 = await send('Outbox note A');
    const shownA = await until(async () => (await rowState(page, 'Outbox note A')).some(r => r.sending && r.visible), 1500);
    const shownMs = Date.now() - t0;
    check(shownA && shownMs < 600, tag(`A: the note is in the thread, marked Sending…, ${shownMs} ms after the click`));
    check(await page.evaluate(() => document.getElementById('calCommentComposer').value === ''), tag('A: the box is empty and ready for the next note'));
    await shot(page, `staff-notes-sending-${view.name}`);
    check(await until(async () => { const r = await rowState(page, 'Outbox note A'); return r.length === 1 && !r[0].sending && !r[0].failed; }, 6000), tag('A: when the server confirms, the mark goes and the note stays once'));
    check(commentsWith('Outbox note A').length === 1, tag('A: saved once'));

    // B slow server, two notes in a row
    S.behave['gw:comment'] = { delay: 2500, times: 2 };
    await send('Outbox note B1');
    await sleep(150);
    t0 = await send('Outbox note B2');
    const bothShown = await until(async () => (await rowState(page, 'Outbox note B2')).some(r => r.sending), 1500);
    check(bothShown && Date.now() - t0 < 1500, tag('B: a second note can be sent while the first is still on its way, and shows at once'));
    check((await rowState(page, 'Outbox note B1')).some(r => r.sending), tag('B: the first is still marked Sending…'));
    check(await until(() => commentsWith('Outbox note B1').length === 1 && commentsWith('Outbox note B2').length === 1, 12000), tag('B: both are saved, once each'));
    const order = S.comments.map(c => c.body).filter(b => /Outbox note B/.test(b));
    check(order.join(',') === 'Outbox note B1,Outbox note B2', tag('B: in the order they were sent'));
    await until(async () => !(await rowState(page, 'Outbox note B2')).some(r => r.sending), 6000);

    // C server error, then retry
    delete S.behave['gw:comment'];
    S.behave['gw:comment'] = { mode: 'http', status: 503, times: 2, commit: false };
    const diagBefore = S.log.filter(l => l.key === 'write-diagnostics').length;
    await send('Outbox note C');
    check(await until(async () => (await rowState(page, 'Outbox note C')).some(r => r.failed && r.retry && /Not sent/.test(r.status)), 8000), tag('C: a refused note stays in the thread as "Not sent" with Tap to retry'));
    await shot(page, `staff-notes-failed-${view.name}`);
    check(await until(() => S.log.filter(l => l.key === 'write-diagnostics').length > diagBefore, 6000), tag('C: the refusal is in the write-refusal log'));
    check(commentsWith('Outbox note C').length === 0, tag('C: nothing saved yet'));
    await page.click('.cal-cm-row.is-outbox-failed .sv-note-outbox-retry');
    check(await until(() => commentsWith('Outbox note C').length === 1, 8000), tag('C: Retry sends it'));
    check(await until(async () => { const r = await rowState(page, 'Outbox note C'); return r.length === 1 && !r[0].failed && !r[0].sending; }, 6000), tag('C: then it is a normal note, once'));

    // D double click
    await send('Outbox note D', 'double');
    await until(() => commentsWith('Outbox note D').length >= 1, 8000);
    await sleep(1200);
    check(commentsWith('Outbox note D').length === 1, tag('D: a double click sends one note'));
    check((await rowState(page, 'Outbox note D')).length === 1, tag('D: and shows one'));

    // E refresh mid-send: the server commits, the answer never arrives
    S.behave['gw:comment'] = { mode: 'reject', commit: true, delay: 600, times: 2 };
    await send('Outbox note E');
    await until(async () => (await rowState(page, 'Outbox note E')).some(r => r.sending), 1500);
    await sleep(300);
    // A refresh: the same page loaded again from scratch.
    await S.openCalendar(page);
    await open();
    check(await until(async () => (await rowState(page, 'Outbox note E')).some(r => r.failed && r.retry), 6000), tag('E: after a refresh mid-send the note is still there, "Not sent", with its words'));
    delete S.behave['gw:comment'];
    const committedE = commentsWith('Outbox note E').length;
    await page.click('.cal-cm-row.is-outbox-failed .sv-note-outbox-retry');
    check(await until(async () => { const r = await rowState(page, 'Outbox note E'); return r.length === 1 && !r[0].failed && !r[0].sending; }, 8000), tag('E: Retry confirms it'));
    check(commentsWith('Outbox note E').length === 1 && committedE <= 1, tag(`E: still one note on the server (one id per note) [${committedE} before retry]`));
    check(S.log.some(l => l.key === 'gw:comment-replay'), tag('E: the retry carried the same id, and the server answered with the note it had'));
    await page.evaluate(() => closeCalComments());

    // L a caption note (saved on the card only) whose card save is refused
    // stays "Not sent" when Notes is opened again and after a refresh: the
    // note in the page's own thread is not a server receipt (Codex, PR 2096)
    S.behave['cal-upsert'] = { mode: 'http', status: 503, times: 40, commit: false };
    await page.evaluate(() => openCalComments('p_t1'));
    await page.waitForSelector('#calCommentsModal #calCommentComposer');
    await page.evaluate(() => _calSetComposeComp('caption'));
    await page.fill('#calCommentComposer', 'Outbox caption note L');
    await page.click('#calCommentsModal .cal-cm-send');
    check(await until(async () => (await rowState(page, 'Outbox caption note L')).some(r => r.failed && r.retry), 15000), tag('L: a refused caption note says "Not sent"'));
    await page.evaluate(() => closeCalComments());
    await page.evaluate(() => openCalComments('p_t1'));
    await sleep(400);
    check((await rowState(page, 'Outbox caption note L')).some(r => r.failed && r.retry), tag('L: opening Notes again keeps it "Not sent"'));
    await page.evaluate(() => closeCalComments());
    delete S.behave['cal-upsert'];
    await S.openCalendar(page);
    await page.evaluate(() => openCalComments('p_t1'));
    await page.waitForSelector('#calCommentsModal #calCommentComposer');
    check(await until(async () => (await rowState(page, 'Outbox caption note L')).some(r => r.failed && r.retry), 6000), tag('L: after a refresh it is still there, "Not sent", with its words'));
    await page.click('.cal-cm-row.is-outbox-failed .sv-note-outbox-retry');
    const captionSaved = () => { try { const c = S.card('p_t1'); const v = c.caption_tweaks || c.caption_comments; return (Array.isArray(v) ? v : JSON.parse(v || '[]')).filter(m => m && m.body === 'Outbox caption note L').length; } catch (e) { return 0; } };
    check(await until(() => captionSaved() === 1, 10000), tag('L: Retry saves it on the card, once'));
    check(await until(async () => { const r = await rowState(page, 'Outbox caption note L'); return r.length === 1 && !r[0].failed && !r[0].sending; }, 6000), tag('L: then it is a normal note'));
    await page.evaluate(() => closeCalComments());

    // K a refresh replaces the card while its work-item link is being looked
    // up (live, 2026-10-15: a background send overlapping a reopen left Send
    // locked on "Notes are still loading" for good)
    let crosswalkDelay = 900;
    await S.ctx.route('**/rest/v1/deliverables**', async route => { if (crosswalkDelay) await sleep(crosswalkDelay); return route.fallback(); });
    await page.evaluate(() => openCalComments('p_t1'));
    await sleep(250);
    await page.evaluate(() => { calState.posts = calState.posts.map(p => Object.assign({}, p)); });
    crosswalkDelay = 0;
    check(await until(() => page.evaluate(() => {
      const p = calState.posts.find(x => x.id === 'p_t1');
      return !_calCommentSendPending(p, _prodCanonicalCommentGate(p, 'video'));
    }), 6000), tag('K: a card refreshed during its link lookup does not keep Send locked'));
    await page.evaluate(() => closeCalComments());

    // F Messages page reply
    const conv = () => {
      const card = S.card('p_t1');
      const list = [];
      for (const c of S.comments) list.push({ id: c._nid || c.id, parent_id: null, root_id: c._nid || c.id, author: 'Browser Staff', author_member_id: 'm1', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: c.body, created_at: c.created_at });
      // replies the card holds (Messages replies land on the card's thread)
      const vids = Array.isArray(card.comments) ? card.comments : (() => { try { return JSON.parse(card.video_tweaks || '[]'); } catch (e) { return []; } })();
      for (const m of vids) if (m && m.parent_id && !list.some(x => x.id === m.id)) list.push({ id: m.id, parent_id: m.parent_id, root_id: m.parent_id, author: 'Browser Staff', author_member_id: 'm1', role: 'smm', audience: 'internal', is_tweak: false, component: 'video', body: m.body, created_at: m.created_at });
      const last = list[list.length - 1];
      return [{ post_id: 'p_t1', client_slug: 'fixtureclient', client_name: 'fixtureclient', title: card.name, thumbnail_url: '', asset_url: '', status: card.status, messages: list,
        last_at: last.created_at, last_author: last.author, last_author_member_id: 'm1', last_role: 'smm', last_body: last.body, unread: 0 }];
    };
    let inboxDelay = 0;
    await S.ctx.route('**/functions/v1/production-comments', async route => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (route.request().method() === 'OPTIONS' || (body.action !== 'inbox' && body.action !== 'inbox_mark')) return route.fallback();
      if (inboxDelay) await sleep(inboxDelay);
      const reply = obj => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
      if (body.action === 'inbox') return reply({ ok: true, scope: 'all', conversations: conv() });
      return reply({ ok: true, post_id: body.post_id, last_read_at: '2026-10-20T00:00:00.000Z' });
    });
    await page.evaluate(() => navTo('messages'));
    await page.waitForFunction(() => typeof _msgState === 'object' && _msgState.loaded && _msgState.conversations.length > 0, null, { timeout: 20000 });
    await page.evaluate(() => _msgOpen('p_t1'));
    await page.waitForSelector('#msgReplyBox');
    inboxDelay = 1200;
    S.behave['gw:comment'] = { delay: 1500 };
    await page.fill('#msgReplyBox', 'Outbox reply F');
    t0 = Date.now();
    await page.click('#msgPage .cal-cm-send');
    const fShown = await until(async () => (await rowState(page, 'Outbox reply F')).some(r => r.sending && r.visible), 1500);
    check(fShown && Date.now() - t0 < 600, tag(`F: the Messages reply is in the chat, Sending…, ${Date.now() - t0} ms after the click`));
    check(await page.evaluate(() => document.getElementById('msgReplyBox').value === ''), tag('F: the reply box is free at once'));
    await shot(page, `messages-sending-${view.name}`);
    check(await until(() => commentsWith('Outbox reply F').length === 1, 10000), tag('F: the reply is saved, once'));
    check(await until(async () => { const r = await rowState(page, 'Outbox reply F'); return r.length === 1 && !r[0].sending && !r[0].failed; }, 10000), tag('F: and stays in the chat, once, after the inbox refresh'));
    delete S.behave['gw:comment'];
    // The lost answer in E also leaves a source-repair journal entry, which the
    // existing repair drain reconciles after the reload by asking the gateway
    // for its receipt (`reconcile_only`). This mock keeps no receipts, so that
    // read fails here; it is the drain's own retry, not a note send.
    const pageErrors = page.errors.filter(e => e !== 'reconcile_receipt_unavailable');
    check(!pageErrors.length, tag('no page errors ' + JSON.stringify(pageErrors)));
  } catch (e) {
    failures.push(view.name + ' staff: ' + String(e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
}

// ---------------------------------------------------------------- client
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const full = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([.][\\/])+/, ''));
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const C_SLUG = 'notefixtureclient', C_NAME = 'Note Fixture Client', C_TOKEN = 'synthetic-note-token', C_CARD = 'p_note_fixture_1';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

async function clientLanes(browser, origin, view) {
  const tag = s => view.name + ' ' + s;
  const row = {
    id: C_CARD, client: C_SLUG, name: 'Note fixture post', status: 'Client Approval', scheduled_date: null, order_index: 1,
    updated_at: '2026-10-10T12:00:00.000Z', asset_url: 'https://example.invalid/video.mp4', thumbnail_url: '',
    video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', caption: 'A synthetic caption.',
    comments: [], graphic_comments: [], caption_comments: [], caption_tweaks: '[]',
  };
  const upsert = { delay: 0, fail: 0, calls: 0 };
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, view.context));
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (u.pathname === '/functions/v1/client-token-verify') {
      if (body.slug !== C_SLUG || body.token !== C_TOKEN) return json({ ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
      return json({ ok: true, valid: true, allowed: true, slug: C_SLUG, display_name: C_NAME, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (u.pathname === '/functions/v1/calendar-upsert') {
      upsert.calls++;
      if (upsert.delay) await sleep(upsert.delay);
      if (upsert.fail > 0) { upsert.fail--; return json({ ok: false, error: 'synthetic refusal' }, 503); }
      const post = body.post || {};
      for (const [k, v] of Object.entries(post)) if (!/^_/.test(k)) row[k] = v;
      // calendar_merge_comments keeps one comment per id.
      if (post.caption_tweaks) {
        const seen = new Set(); const merged = [];
        for (const c of JSON.parse(post.caption_tweaks)) if (c && !seen.has(c.id)) { seen.add(c.id); merged.push(c); }
        row.caption_tweaks = JSON.stringify(merged); row.caption_comments = merged;
      }
      row.updated_at = new Date().toISOString();
      return json({ ok: true, post: Object.assign({}, row) });
    }
    if (u.pathname === '/functions/v1/write-diagnostics') { upsert.diag = (upsert.diag || 0) + 1; return json({ ok: true }, 202); }
    if (u.pathname === '/rest/v1/calendar_posts') return json([Object.assign({}, row)]);
    if (u.pathname === '/rest/v1/clients') return json([{ slug: C_SLUG, kind: 'client', active: true }]);
    if (u.pathname === '/rest/v1/syncview_runtime_flags' && /prod_authority/.test(u.search)) return json([{ value: { video: 'linear', graphics: 'linear' } }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\//.test(u.pathname)) return json({ ok: true });
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  const q = new URLSearchParams({ c: C_NAME, t: C_TOKEN, v: 'calendar' });
  const load = async () => {
    await page.goto(`${origin}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`.kcard[data-cal-review-pid="${C_CARD}"]`, { timeout: 20000 });
    await page.evaluate(pid => { if (!_calReviewState.expanded.has(pid)) { _calReviewState.expanded.add(pid); _calReviewRepaintCard(pid); } }, C_CARD);
    await page.waitForSelector(`.kcard[data-cal-review-pid="${C_CARD}"] .cal-review-panel[data-comp="caption"] .cal-review-textarea`, { timeout: 8000 });
  };
  const type = async text => {
    const ta = `.kcard[data-cal-review-pid="${C_CARD}"] .cal-review-panel[data-comp="caption"] .cal-review-textarea`;
    await page.fill(ta, text);
  };
  const press = sel => page.click(`.kcard[data-cal-review-pid="${C_CARD}"] .cal-review-panel[data-comp="caption"] ${sel}`);
  const saved = text => { try { return JSON.parse(row.caption_tweaks || '[]').filter(c => c.body === text).length; } catch (e) { return 0; } };
  try {
    await load();
    // G plain comment
    upsert.delay = 1200;
    await type('Client outbox comment G');
    let t0 = Date.now();
    await press('.cal-review-comment-btn');
    check(await until(async () => (await rowState(page, 'Client outbox comment G')).some(r => r.sending && r.visible), 1500) && Date.now() - t0 < 600,
      tag(`G: the client's comment shows, Sending…, at once (${Date.now() - t0} ms)`));
    await shot(page, `client-comment-sending-${view.name}`);
    check(await until(async () => { const r = await rowState(page, 'Client outbox comment G'); return r.length === 1 && !r[0].sending && !r[0].failed; }, 6000), tag('G: the mark goes when it is saved'));
    check(saved('Client outbox comment G') === 1, tag('G: saved once'));

    // H refused, refresh, retry
    upsert.delay = 0; upsert.fail = 6;
    await type('Client outbox comment H');
    await press('.cal-review-comment-btn');
    check(await until(async () => (await rowState(page, 'Client outbox comment H')).some(r => r.failed && r.retry), 8000), tag('H: a refused comment says "Not sent" with Tap to retry'));
    await shot(page, `client-comment-failed-${view.name}`);
    check((upsert.diag || 0) > 0, tag('H: the refusal is in the write-refusal log'));
    upsert.fail = 0;
    await load();
    check(await until(async () => (await rowState(page, 'Client outbox comment H')).some(r => r.failed && r.retry), 6000), tag('H: after a refresh it is still there, with its words'));
    await page.click('.cal-review-comment.is-outbox-failed .sv-note-outbox-retry');
    check(await until(() => saved('Client outbox comment H') === 1, 8000), tag('H: Retry saves it, once'));
    check(await until(async () => { const r = await rowState(page, 'Client outbox comment H'); return r.length === 1 && !r[0].failed && !r[0].sending; }, 6000), tag('H: then it reads as a normal comment'));

    // I Request changes with a note
    upsert.delay = 1500;
    await type('Client outbox request I');
    t0 = Date.now();
    await press('.cal-review-tweak-btn');
    check(await until(async () => (await rowState(page, 'Client outbox request I')).some(r => r.sending && r.visible), 1500) && Date.now() - t0 < 600,
      tag(`I: Request changes: the note stays in sight, Sending…, at once (${Date.now() - t0} ms)`));
    await shot(page, `client-request-sending-${view.name}`);
    check(await until(() => saved('Client outbox request I') === 1 && row.caption_status === 'Tweaks Needed', 10000), tag('I: the request is saved once and the caption moves to Tweaks Needed'));
    check(await until(async () => !(await rowState(page, 'Client outbox request I')).some(r => r.sending), 8000), tag('I: no "Sending…" left once it is confirmed'));
    check(!errors.length, tag('client: no page errors ' + JSON.stringify(errors)));
  } catch (e) {
    failures.push(view.name + ' client: ' + String(e && e.stack || e));
    console.error(e);
  } finally {
    await ctx.close();
  }
}

(async () => {
  for (const view of VIEWS) await staffLanes(view);
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  try { for (const view of VIEWS) await clientLanes(browser, origin, view); }
  finally { await browser.close(); server.close(); }
  if (failures.length) { console.log(`\nnote-send-outbox-browser: ${failures.length} of ${checks} failed`); process.exit(1); }
  console.log(`\nnote-send-outbox-browser: all ${checks} checks passed`);
})();
