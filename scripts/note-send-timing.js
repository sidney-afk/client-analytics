#!/usr/bin/env node
// note-send-timing.js — ON DEMAND. Times "click Send" to "note shown" and to
// "send finished" for every way a note is written in SyncView, in a real
// Chromium against the LIVE backend, on the TEST client only.
//
//   node scripts/note-send-timing.js [--runs=5] [--only=a,b] [--out=file.json]
//
// Needs SYNCVIEW_ROLE_KEY (or SYNCVIEW_STAFF_KEY) and SYNCVIEW_ACTOR: the staff
// scenarios sign in as that real member, the client scenarios open the test
// client's own review link (token issued by the staff key). The page is served
// from this working tree (routed in the browser, so every backend call still
// goes to the live functions through the environment's HTTPS proxy).
//
// What it writes (TEST client only): plain notes and replies on the test
// client's cards, and change requests on throwaway unlinked seed cards (the
// caption part, which has no work item) and on the test client's own linked
// card through the page's own status path. Seeds are archived at the end.
//
// For each send it prints, per run: ms to the note appearing in the thread
// (`shown`), ms until the composer is free again (`done`), and every network
// call between the click and `done` with its start and end offsets. Function
// names and actions only; no bodies, names or tokens are printed.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const E = require('../qa/test-client-entry.js');

const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const PUB = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const ORIGIN = 'http://127.0.0.1:8000';
const ROOT_ARG = (process.argv.find(a => a.startsWith('--root=')) || '').slice(7);
// --root=<checkout> serves another checkout's pages (a clean main for the "before" column).
const ROOT = ROOT_ARG ? path.resolve(ROOT_ARG) : path.resolve(__dirname, '..');
const TEST_SLUG = E.TEST_CLIENT.slug;
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const RUNS = Number(args.runs || 5);
const ONLY = args.only ? String(args.only).split(',') : null;
const TS = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

const KEY = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
let IDENTITY = null;
async function staffIdentity() {
  if (IDENTITY) return IDENTITY;
  const rows = await (await fetch(`${SUPA}/rest/v1/team_members?name=eq.${encodeURIComponent(ACTOR)}&select=id`, { headers: { apikey: PUB, authorization: 'Bearer ' + PUB } })).json();
  const v = await (await fetch(`${SUPA}/functions/v1/key-verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-syncview-key': KEY }, body: JSON.stringify({ surface: 'staff-boot', member: { id: rows[0] && rows[0].id } }) })).json();
  if (!v || v.ok !== true) throw new Error('key-verify refused the runner key');
  IDENTITY = JSON.stringify({ key: KEY, role: v.role, member: v.member, verified_at: new Date().toISOString() });
  return IDENTITY;
}
async function upCal(post) {
  const r = await fetch(`${SUPA}/functions/v1/calendar-upsert`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: PUB, authorization: 'Bearer ' + PUB, 'x-syncview-key': KEY }, body: JSON.stringify({ client: TEST_SLUG, post, comments_base_at: '' }) });
  return r.json().catch(() => ({}));
}

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp' };
async function newContext(browser, { phone = false, staff = false, dark = false } = {}) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true, colorScheme: dark ? 'dark' : 'light' }
    : { viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true, colorScheme: dark ? 'dark' : 'light' });
  await ctx.route(u => u.toString().startsWith(ORIGIN + '/'), async route => {
    const u = new URL(route.request().url());
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || u.pathname === '/' || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html');
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  // Every POST must name the test client or none at all.
  await ctx.route(u => /supabase\.co\/functions\/v1\//.test(u.toString()), route => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      const bad = (body.match(/"(?:client|client_slug|slug)"\s*:\s*"([^"]*)"/g) || [])
        .map(s => s.split(':').pop().replace(/[\s"]/g, '').toLowerCase())
        .filter(v => v && v !== TEST_SLUG);
      if (bad.length) { console.log('  guard: aborted a POST naming another client'); return route.abort(); }
    }
    return route.fallback();
  });
  if (staff) {
    const id = await staffIdentity();
    await ctx.addInitScript(i => { try { localStorage.setItem('syncview_staff_identity_v1', i); sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1'); } catch (e) {} }, id);
  }
  return ctx;
}
function netLog(page) {
  const log = [];
  page.on('request', req => {
    const u = req.url();
    const m = /\/functions\/v1\/([a-z0-9-]+)|\/rest\/v1\/([a-z0-9_]+)/.exec(u);
    if (!m || req.method() === 'OPTIONS') return;
    let what = m[1] || ('rest:' + m[2]);
    try { const b = JSON.parse(req.postData() || 'null'); if (b && (b.action || b.operation)) what += ':' + (b.action || b.operation); } catch (e) {}
    const rec = { what, start: Date.now(), end: null, status: null };
    log.push(rec); req._rec = rec;
  });
  const fin = async req => { const rec = req._rec; if (!rec) return; rec.end = Date.now(); try { const r = await req.response(); rec.status = r ? r.status() : 'fail'; } catch (e) { rec.status = 'fail'; } };
  page.on('requestfinished', fin);
  page.on('requestfailed', req => { if (req._rec) { req._rec.end = Date.now(); req._rec.status = 'fail'; } });
  return log;
}

// In-page: start watching for `text` in the thread (not in a text box), run
// `click`, and resolve when the note is shown and when `idle()` holds.
async function timeSend(page, text, clickFn, idleSrc, capMs = 60000) {
  return page.evaluate(async ([text, clickSrc, idleSrc, capMs]) => {
    // Only a note IN a thread counts: Notes rows, review panel comments and
    // Messages bubbles (a phone composer can show the typed words elsewhere).
    const shownNow = () => [...document.querySelectorAll('.cal-cm-row-body, .cal-review-comment-body, .msg-b-text')]
      .some(el => (el.textContent || '').indexOf(text) >= 0 && el.getClientRects().length > 0 && !el.closest('[hidden]'));
    const idle = new Function('return (' + idleSrc + ')');
    const t0 = Date.now();
    let shown = null, done = null;
    const mo = new MutationObserver(() => { if (shown == null && shownNow()) shown = Date.now() - t0; });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    (new Function(clickSrc))();
    while (Date.now() - t0 < capMs) {
      if (shown == null && shownNow()) shown = Date.now() - t0;
      if (done == null && Date.now() - t0 > 30) { try { if (idle()) done = Date.now() - t0; } catch (e) {} }
      if (shown != null && done != null) break;
      await new Promise(r => setTimeout(r, 16));
    }
    mo.disconnect();
    return { t0, shown, done };
  }, [text, clickFn, idleSrc, capMs]);
}
function calls(log, t0, until) {
  return log.filter(r => r.start >= t0 - 5 && r.start <= t0 + until + 50)
    .map(r => ({ what: r.what, from: r.start - t0, to: r.end == null ? null : r.end - t0, status: r.status }));
}

// No note in the outbox still on its way (always true on a page without it).
const OUTBOX_IDLE = `!Object.values(JSON.parse(localStorage.getItem('sv-note-outbox-v1') || '{}')).some(e => e && e.state === 'sending')`;

// ---- scenarios ---------------------------------------------------------------
const results = {};
function record(name, run) {
  run.sent = run.shown == null || run.done == null ? null : Math.max(run.shown, run.done);
  (results[name] = results[name] || []).push(run);
  console.log(`  ${name} #${results[name].length}: shown ${run.shown} ms, done ${run.done} ms` + (run.note ? '  (' + run.note + ')' : ''));
  for (const c of run.calls || []) console.log(`     ${String(c.from).padStart(6)} → ${String(c.to).padStart(6)}  ${c.what} ${c.status}`);
}

async function openClient(browser, phone) {
  const ctx = await newContext(browser, { phone });
  const page = await ctx.newPage();
  const log = netLog(page);
  const tok = await E.currentTestClientToken();
  await E.gotoTestClientEntry(page, { origin: ORIGIN, view: 'calendar', token: tok, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 } });
  return { ctx, page, log };
}
async function openStaffCalendar(browser, phone) {
  const ctx = await newContext(browser, { phone, staff: true });
  const page = await ctx.newPage();
  const log = netLog(page);
  await page.goto(`${ORIGIN}/index.html#calendar/${TEST_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof calState === 'object' && !!calState.client && Array.isArray(calState.posts) && calState.posts.length > 0, null, { timeout: 45000 });
  await sleep(2500);
  return { ctx, page, log };
}
async function reviewCardReady(page, pid, comp, timeout = 30000) {
  await page.waitForFunction(([pid, comp]) => {
    const card = document.querySelector(`.cal-review-card[data-pid="${pid}"]`) || [...document.querySelectorAll('.cal-review-card')].find(c => (c.getAttribute('onclick') || c.innerHTML).includes(pid));
    return !!card;
  }, [pid, comp], { timeout });
}
const REVIEW_CLICK = (pid, comp, text, kind) => `
  const st = _calReviewState; const key = ${JSON.stringify(pid + '|' + comp)};
  if (!st.expanded.has(${JSON.stringify(pid)})) { st.expanded.add(${JSON.stringify(pid)}); _calReviewRepaintCard(${JSON.stringify(pid)}); }
  st.drafts[key] = ${JSON.stringify(text)};
  ${kind === 'request' ? `_calReviewRequestTweak(${JSON.stringify(pid)}, ${JSON.stringify(comp)});` : `_calReviewComment(${JSON.stringify(pid)}, ${JSON.stringify(comp)});`}`;
const REVIEW_IDLE = (pid, comp) => `!_calReviewState.saving[${JSON.stringify(pid + '|' + comp)}]`;

// Client: request a change with a note / a plain comment, on the review link.
async function clientReview(browser, { name, pid: fixedPid, pidFor, comp, kind, phone }) {
  for (let i = 0; i < RUNS; i++) {
    const pid = pidFor ? await pidFor() : fixedPid;
    const { ctx, page, log } = await openClient(browser, phone);
    try {
      await page.waitForFunction(pid => typeof calState === 'object' && calState.posts.some(p => p.id === pid), pid, { timeout: 45000 });
      await sleep(2500);
      const text = `Timing ${name} ${TS}-${i}`;
      const shotAt = process.env.NOTE_TIMING_SHOTS ? setTimeout(() => page.screenshot({ path: path.join(process.env.NOTE_TIMING_SHOTS, `${name}-${i}-mid.png`) }).catch(() => {}), 500) : null;
      const r = await timeSend(page, text, REVIEW_CLICK(pid, comp, text, kind), REVIEW_IDLE(pid, comp));
      void shotAt;
      await sleep(1500);
      const err = await page.evaluate(k => _calReviewState.errors[k] || '', pid + '|' + comp);
      record(name, { shown: r.shown, done: r.done, calls: calls(log, r.t0, (r.done || 60000) + 1500), note: err ? 'error: ' + err.slice(0, 80) : '' });
    } catch (e) { record(name, { shown: null, done: null, note: 'harness: ' + String(e.message).slice(0, 120) }); }
    await ctx.close();
  }
}
// Staff: a root note or a reply in a card's Notes dialog.
async function staffNotes(browser, { name, pid, reply, phone }) {
  const { ctx, page, log } = await openStaffCalendar(browser, phone);
  try {
    for (let i = 0; i < RUNS; i++) {
      await page.evaluate(pid => openCalComments(pid), pid);
      await page.waitForFunction(() => { const b = document.querySelector('.cal-cm-send'); return !!document.getElementById('calCommentComposer') && !(b && b.dataset.sendPending); }, null, { timeout: 30000 });
      await sleep(600);
      const text = `Timing ${name} ${TS}-${i}`;
      let parent = null;
      if (reply) {
        parent = await page.evaluate(pid => { const p = calState.posts.find(x => x.id === pid); const list = (Array.isArray(p.comments) ? p.comments : _calLoadComments(p)).filter(c => c && !c.parent_id); return list.length ? list[list.length - 1].id : null; }, pid);
      }
      const click = `${parent ? `_calReplyTarget = ${JSON.stringify(parent)}; _calReplyDrafts[${JSON.stringify(parent)}] = ${JSON.stringify(text)};` : `_calRootDraft = ${JSON.stringify(text)};`}
        const ta = document.getElementById('calCommentComposer'); if (ta) ta.value = ${JSON.stringify(text)};
        _calSubmitComposer();`;
      const shotAt = process.env.NOTE_TIMING_SHOTS ? setTimeout(() => page.screenshot({ path: path.join(process.env.NOTE_TIMING_SHOTS, `${name}-${i}-mid.png`) }).catch(() => {}), 300) : null;
      // "done" = the server confirmed it: the composer is free AND (with the
      // note outbox) no note of this page is still on its way.
      const r = await timeSend(page, text, click, `!_calComposerSending && ${OUTBOX_IDLE}`);
      void shotAt;
      if (process.env.NOTE_TIMING_SHOTS) r.where = await page.evaluate(t => [...document.querySelectorAll('.cal-cm-row-body, .cal-review-comment-body, .msg-b-text')].filter(e => e.textContent.includes(t)).map(e => e.className + '<' + (e.parentElement && e.parentElement.className)).join(' ; '), text);
      record(name, { shown: r.shown, done: r.done, calls: calls(log, r.t0, (r.done || 60000) + 300), note: (parent ? '' : (reply ? 'no parent, sent as root' : '')) + (r.where ? ' where=' + r.where : '') });
      await page.evaluate(() => { try { closeCalComments(); } catch (e) {} });
      await sleep(1200);
    }
  } catch (e) { record(name, { shown: null, done: null, note: 'harness: ' + String(e.message).slice(0, 160) }); }
  await ctx.close();
}
// Staff: a plain comment from the Review tab.
async function staffReviewComment(browser, { name, pid, comp, phone }) {
  const { ctx, page, log } = await openStaffCalendar(browser, phone);
  try {
    await page.evaluate(() => onCalViewChange('smmreview'));
    await sleep(1500);
    for (let i = 0; i < RUNS; i++) {
      const text = `Timing ${name} ${TS}-${i}`;
      const r = await timeSend(page, text, REVIEW_CLICK(pid, comp, text, 'comment'), REVIEW_IDLE(pid, comp));
      record(name, { shown: r.shown, done: r.done, calls: calls(log, r.t0, (r.done || 60000) + 300) });
      await sleep(1200);
    }
  } catch (e) { record(name, { shown: null, done: null, note: 'harness: ' + String(e.message).slice(0, 160) }); }
  await ctx.close();
}
// Staff: a reply from the Messages page.
async function messagesReply(browser, { name, pid, phone }) {
  const ctx = await newContext(browser, { phone, staff: true });
  const page = await ctx.newPage();
  const log = netLog(page);
  try {
    await page.goto(`${ORIGIN}/?sv_path=/messages`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof _msgState === 'object' && _msgState.loaded, null, { timeout: 45000 });
    for (let i = 0; i < RUNS; i++) {
      const has = await page.evaluate(pid => _msgState.conversations.some(c => c.post_id === pid), pid);
      if (!has) { record(name, { shown: null, done: null, note: 'conversation not in inbox' }); break; }
      await page.evaluate(pid => _msgOpen(pid), pid);
      await sleep(2500);
      const text = `Timing ${name} ${TS}-${i}`;
      const r = await timeSend(page, text, `_msgState.draft = ${JSON.stringify(text)}; const b=document.getElementById('msgReplyBox'); if (b) b.value=${JSON.stringify(text)}; _msgReply();`, `!_msgState.sending && ${OUTBOX_IDLE}`);
      record(name, { shown: r.shown, done: r.done, calls: calls(log, r.t0, (r.done || 60000) + 300) });
      await sleep(1200);
    }
  } catch (e) { record(name, { shown: null, done: null, note: 'harness: ' + String(e.message).slice(0, 160) }); }
  await ctx.close();
}

// --set-video=<status>: put the linked card's video part back where it was
// found, through the page's own save path (the work item first, then the
// card), never raw SQL. Runs alone.
async function setLinkedVideo(browser, pid, status) {
  const { ctx, page } = await openStaffCalendar(browser, false);
  const out = await page.evaluate(async ([pid, status]) => {
    const p = calState.posts.find(x => x.id === pid);
    if (!p) return 'missing';
    if (p.video_status === status) return 'already ' + status;
    p.video_status = status;
    p.status = computeOverallStatus(p);
    _calPendingEdits[pid] = Object.assign(_calPendingEdits[pid] || {}, { video_status: p.video_status, status: p.status });
    await _calFlushCardSave(pid);
    return p._saveError ? 'error ' + p._saveError : 'set';
  }, [pid, status]);
  await ctx.close();
  return out;
}

(async () => {
  if (!KEY || !ACTOR) throw new Error('SYNCVIEW_ROLE_KEY (or SYNCVIEW_STAFF_KEY) and SYNCVIEW_ACTOR are required');
  const LINKED = args.linked;            // the test client's linked card (data-only id)
  if (!LINKED) throw new Error('--linked=<calendar post id of a test-client card linked to work items> is required');
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY }, args: ['--ignore-certificate-errors'] });
  const want = n => !ONLY || ONLY.some(o => n.startsWith(o));
  const seeds = [];
  if (args['set-video']) {
    console.log('  linked video:', await setLinkedVideo(browser, LINKED, String(args['set-video']).replace(/_/g, ' ')));
    await browser.close();
    return;
  }
  try {
    if (want('staff-review-comment')) await staffReviewComment(browser, { name: 'staff-review-comment', pid: LINKED, comp: 'video' });
    if (want('staff-note')) await staffNotes(browser, { name: 'staff-note', pid: LINKED });
    if (want('staff-reply')) await staffNotes(browser, { name: 'staff-reply', pid: LINKED, reply: true });
    if (want('phone-staff-note')) await staffNotes(browser, { name: 'phone-staff-note', pid: LINKED, phone: true });
    if (want('messages-reply')) await messagesReply(browser, { name: 'messages-reply', pid: LINKED });
    if (want('phone-messages-reply')) await messagesReply(browser, { name: 'phone-messages-reply', pid: LINKED, phone: true });
    if (!ONLY || ONLY.some(o => /client-/.test(o))) {
      // Throwaway unlinked cards with the caption at Client Approval (never
      // raw SQL; nothing linked to a work item changes status): one for the
      // comments, one per change request so every request starts from a
      // visible review panel.
      const seed = async label => {
        const sid = `p_timing_${label}_${TS}_${seeds.length}`;
        seeds.push(sid);
        await upCal({ id: sid, name: `Timing ${label} ${TS} ${seeds.length}`, platforms: 'youtube', scheduled_date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10), video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval', caption: 'Timing caption under review', asset_url: 'https://frame.io/x/' + sid, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
        return sid;
      };
      if (want('client-comment')) await clientReview(browser, { name: 'client-comment', pid: await seed('c'), comp: 'caption', kind: 'comment' });
      if (want('phone-client-comment')) await clientReview(browser, { name: 'phone-client-comment', pid: await seed('pc'), comp: 'caption', kind: 'comment', phone: true });
      if (want('client-request-caption')) await clientReview(browser, { name: 'client-request-caption', pidFor: () => seed('r'), comp: 'caption', kind: 'request' });
      if (want('phone-client-request-caption')) await clientReview(browser, { name: 'phone-client-request-caption', pidFor: () => seed('pr'), comp: 'caption', kind: 'request', phone: true });
      // The test client's linked card: the note goes to the work item through
      // the write gateway, then the status, then the card (the owner's case).
      // Its video sits at Tweaks Needed, where the page still takes a request.
      if (want('client-request-video')) await clientReview(browser, { name: 'client-request-video', pid: LINKED, comp: 'video', kind: 'request' });
      if (want('phone-client-request-video')) await clientReview(browser, { name: 'phone-client-request-video', pid: LINKED, comp: 'video', kind: 'request', phone: true });
    }
  } finally {
    for (const id of seeds) await upCal({ id, status: 'Archived' }).catch(() => {});
    await browser.close();
  }
  const summary = Object.fromEntries(Object.entries(results).map(([k, runs]) => [k, { n: runs.length, shown_median: median(runs.map(r => r.shown)), done_median: median(runs.map(r => r.done)), shown_never: runs.filter(r => r.shown == null).length }]));
  console.log('\nSUMMARY (median ms)');
  for (const [k, s] of Object.entries(summary)) console.log(`  ${k.padEnd(28)} shown ${String(s.shown_median).padStart(6)}${s.shown_never ? ' (never shown in ' + s.shown_never + ')' : ''}   done ${String(s.done_median).padStart(6)}   (n=${s.n})`);
  if (args.out) fs.writeFileSync(args.out, JSON.stringify({ at: new Date().toISOString(), runs: RUNS, summary, results }, null, 2));
})().catch(e => { console.error('note-send-timing:', e.message); process.exit(1); });
