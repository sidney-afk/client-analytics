'use strict';
/* unread-badges-v2-browser.js -- the round-5 unread badges (327) behind the runtime switch unread_badges_v2
 * (session Beacon, 2026-10-24; docs/audits/2026-10-23-unread-badges.md). Offline: the built page through the
 * lost-work harness, every backend answer mocked, fictional notes and fictional picture links.
 *
 *   A. Switch missing or the wrong shape: the card's Notes button is today's, the page has no sv-unread2, no bubbles.
 *   B. Switch naming someone else: the same.
 *   C. Switch naming the signed-in member: the page carries sv-unread2; the card shows one bubble per person,
 *      the client's with the client's picture from the inbox answer, a teammate without a picture as initials, and
 *      numbers coloured by kind (change, comment, staff); the hover is picture, first name and one line of the note,
 *      with no date, no kind label and no footer (round 6).
 *   D. Notes (round 6): no "Needs you" box, first names, relative times, no action row under a note; the hover
 *      toolbar carries "No reply needed" on the comment waiting for an answer, and using it takes the comment off
 *      waiting and is kept in this browser; nothing redraws while nothing changes.
 *   E. Messages: New, To answer and All, each list badge says in a hover what it counts; the row carries the
 *      client's picture; the change request is one line; a message header is first name, a lock for "Team only",
 *      a relative time and the part at the right; Reply shows on hover only; your own picture sits beside your name.
 *   H. Round 6 E (the owner's rule swept over Messages and Notes): day lines say Today / Yesterday; no "New" tag on
 *      each message; the change-request line is one quiet line with the first name; the header actions read "Mark
 *      unread" / "Open card" and an empty thumbnail is not drawn; the reply caption uses the first name; a follow-up
 *      by the same person within five minutes drops its picture and name; in Notes "Team only" is a lock, a change
 *      request reads "Change request", and "Waiting for your answer" stands alone without "New".
 *   F. No page error.
 *   G. Only a page the switch is on for asks the inbox for pictures (the Slack lookups are opt-in).
 */
const { createEnv, sleep, SLUG } = require('./lost-work-lib');

const CORS = { 'access-control-allow-origin': '*' };
const ago = min => new Date(Date.now() - min * 60000).toISOString();
const note = o => Object.assign({ parent_id: null, author: 'Casey Client', role: 'client', audience: 'client', is_tweak: false, done: false, round: 1 }, o, { root_id: o.parent_id || o.id, created_at: ago(o.min), updated_at: ago(o.min) });
const NOTES = [
  note({ id: 'n_change', min: 10, is_tweak: true, body: 'Cut the first two seconds.' }),
  note({ id: 'n_question', min: 20, body: 'Can we post this on Friday?' }),
  // The longest header in this fixture: a long first name, "Waiting for your answer", the time; with its toolbar
  // (Reply, No reply needed, Delete) it would run under the toolbar if no room were kept for it.
  note({ id: 'n_long', min: 5, author: 'Bartholomew-Maximilian Rivera', body: 'One more: can the outro be a little longer?' }),
  note({ id: 'n_team', min: 15, author: 'Fixture Editor', author_member_id: 'ed1', role: 'editor', audience: 'internal', body: 'New export is up.' }),
];
const CLIENT_PIC = 'https://pictures.example.test/client-contact.png';

let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

async function run(flagValue) {
  const S = await createEnv();
  S.cards[0].video_tweaks = JSON.stringify(NOTES);
  const errors = [];
  const inboxCalls = [];
  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', async route => {
    const sp = new URL(route.request().url()).searchParams;
    const raw = sp.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({
      key: k, value: k === 'unread_badges_v2' ? flagValue : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows.filter(r => r.value !== undefined)) });
  });
  const conv = { post_id: 'p_t1', client_slug: SLUG, client_name: 'Fixture Client Co', title: 'Test card one', thumbnail_url: '', asset_url: '', status: 'In Progress',
    last_at: NOTES[1].created_at, last_author: 'Fixture Client', last_author_member_id: '', last_role: 'client', last_body: NOTES[1].body,
    unread: 2, first_unread_id: 'n_question',
    messages: [Object.assign({}, NOTES[1], { component: 'video' }), Object.assign({}, NOTES[0], { component: 'video' }),
      Object.assign(note({ id: 'm_team', min: 30, author: 'Fixture Editor', author_member_id: 'ed1', role: 'editor', audience: 'internal', body: 'Export is up.' }), { component: 'video', is_tweak: false }),
      Object.assign(note({ id: 'm_team2', min: 29, author: 'Fixture Editor', author_member_id: 'ed1', role: 'editor', audience: 'internal', body: 'Same export, now with captions.' }), { component: 'video', is_tweak: false }),
      Object.assign(note({ id: 'm_mine', min: 25, author: 'Browser Staff', author_member_id: 'm1', role: 'admin', audience: 'internal', body: 'Thanks, checking now.' }), { component: 'caption', is_tweak: false })]
      .sort((a, b) => a.created_at.localeCompare(b.created_at)) };
  await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fallback();
    let b = {};
    try {
      if (r.method() === 'GET') {
        const q = new URL(r.url()).searchParams;
        b = { action: q.get('action'), via: 'GET' };
        if (q.has('pictures')) b.pictures = Number(q.get('pictures'));
      } else b = JSON.parse(r.postData() || '{}');
    } catch (e) {}
    if (b.action === 'inbox') {
      inboxCalls.push(b);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, scope: 'all', conversations: [conv], pictures: { members: {}, names: {}, clients: { [SLUG]: CLIENT_PIC } } }) });
    }
    if (b.action === 'inbox_mark') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, post_id: b.post_id, last_read_at: null }) });
    return route.fallback();
  });
  await S.ctx.route('https://pictures.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' }));
  const page = await S.newPage();
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await S.openCalendar(page);
  await sleep(900);
  return { S, page, errors, inboxCalls };
}
const cardState = page => page.evaluate(() => {
  const wrap = document.querySelector('.cal-foot-tweaks[data-comments-wrap="p_t1"]');
  return {
    on: document.documentElement.classList.contains('sv-unread2'),
    wrap: !!wrap,
    v2: !!(wrap && wrap.classList.contains('svu-foot')),
    bubbles: wrap ? [...wrap.querySelectorAll('.svu-bub')].map(b => ({ img: (b.querySelector('img') || {}).src || '', initials: (b.querySelector('.svu-initial') || {}).textContent || '', nums: [...b.querySelectorAll('.svu-num')].map(n => n.className.replace('svu-num ', '') + ':' + n.textContent) })) : [],
    oldDot: !!(wrap && wrap.querySelector('.cal-comments-dot, .cal-comments-count')),
  };
});

(async () => {
  for (const [name, value] of [['missing', undefined], ['wrong shape', ['m1']], ['someone else', { staff: ['someone-else'] }]]) {
    const h = await run(value);
    try {
      const st = await cardState(h.page);
      ok(st.wrap && !st.on && !st.v2 && st.bubbles.length === 0 && st.oldDot, `A/B. switch ${name}: today's Notes button, no round-5 look`);
      await h.page.evaluate(() => _msgLoad(true));
      await sleep(400);
      ok(h.inboxCalls.length >= 1 && h.inboxCalls.every(b => !('pictures' in b)), `G. switch ${name}: the inbox read never asks for pictures (${h.inboxCalls.length} reads)`);
      ok(h.errors.length === 0, `F. switch ${name}: no page error` + (h.errors.length ? ' ' + h.errors.join(' | ') : ''));
    } finally { await h.S.close(); }
  }

  const h = await run({ staff: ['m1'] });
  const { page } = h;
  try {
    await page.waitForFunction(() => document.documentElement.classList.contains('sv-unread2') && document.querySelector('.svu-bub img'), null, { timeout: 8000 }).catch(() => {});
    const st = await cardState(page);
    ok(st.on && st.v2, 'C. switch naming the member: the round-5 look is on');
    const client = st.bubbles.find(b => b.img);
    ok(client && client.img === CLIENT_PIC, 'C. the client bubble has the client picture from the inbox answer');
    ok(client && client.nums.join() === 'svu-n-change:3', 'C. all three new client notes count on the client bubble, coloured as a change request');
    const team = st.bubbles.find(b => b.initials);
    ok(team && team.initials === 'FE' && team.nums.join() === 'svu-n-staff:1', 'C. a teammate with no picture shows initials and a grey number');
    await page.hover('.cal-foot-tweaks[data-comments-wrap="p_t1"] .svu-strips');
    await sleep(150);
    const hover = await page.evaluate(() => ({
      who: [...document.querySelectorAll('.svu-pv .svu-pv-row .svu-pv-who')].map(e => e.textContent),
      text: [...document.querySelectorAll('.svu-pv .svu-pv-row .svu-pv-text')].map(e => e.textContent),
      noise: document.querySelectorAll('.svu-pv .svu-pv-time, .svu-pv .svu-pv-what, .svu-pv .svu-pv-foot').length,
    }));
    ok(hover.who.join() === 'Bartholomew-Maximilian,Casey,Fixture,Casey' && hover.text[1] === 'Cut the first two seconds.', 'C. the hover is picture, first name and the note, newest first: ' + hover.who.join(', '));
    ok(hover.noise === 0, 'C. the hover has no date, no kind label and no footer');
    await page.mouse.move(5, 5);

    await page.evaluate(() => openCalComments('p_t1'));
    await page.waitForSelector('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-noreply', { timeout: 6000 }).catch(() => {});
    await sleep(300);
    const row = '#calCommentsModal .cal-cm-row[data-cm-row="n_question"]';
    const notes = await page.evaluate(sel => ({
      box: document.querySelectorAll('#calCommentsModal .svu-need, #calCommentsModal .svu-row-acts').length,
      author: (document.querySelector(sel + ' .cal-cm-author') || {}).textContent,
      time: (document.querySelector(sel + ' .cal-cm-time') || {}).textContent,
      tools: [...document.querySelectorAll(sel + ' .cal-cm-actions .cal-cm-action')].map(b => b.textContent.trim()),
      waitingTag: !!document.querySelector(sel + ' .svu-t-waiting'),
      unread: !!document.querySelector('#calCommentsModal .cal-comments-head .svu-head-unread'),
    }), row);
    ok(notes.box === 0, 'D. no "Needs you" box and no action row under a note');
    ok(notes.author === 'Casey' && notes.time === '20m ago', 'D. first name and a relative time: ' + notes.author + ', ' + notes.time);
    ok(notes.waitingTag && notes.tools.includes('Reply') && notes.tools.includes('No reply needed'), 'D. the waiting comment\'s hover toolbar has Reply and No reply needed: ' + notes.tools.join(', '));
    ok(notes.unread, 'D. "Mark unread" is one quiet word in the Notes head');
    // The hover toolbar never covers the header: on every note (the longest header included), its box does not meet
    // the time or any other header item while the pointer is on it.
    const overlaps = [];
    for (const id of await page.evaluate(() => [...document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row]')].map(r => r.getAttribute('data-cm-row')))) {
      const sel = `#calCommentsModal .cal-cm-row[data-cm-row="${id}"]`;
      await page.hover(sel + ' .cal-cm-row-body').catch(() => {});
      await sleep(180);
      const hit = await page.evaluate(sel => {
        const bar = document.querySelector(sel + ' .cal-cm-actions');
        if (!bar || getComputedStyle(bar).opacity === '0') return 'toolbar not shown';
        const b = bar.getBoundingClientRect();
        const meet = r => r.width && r.height && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
        const items = [...document.querySelectorAll(sel + ' .cal-cm-head-line > *')].filter(el => getComputedStyle(el).visibility !== 'hidden' && !el.classList.contains('cal-cm-comp-label'));
        const bad = items.filter(el => meet(el.getBoundingClientRect())).map(el => el.className || el.tagName);
        return bad.length ? bad.join('+') : '';
      }, sel);
      if (hit) overlaps.push(id + ': ' + hit);
    }
    ok(overlaps.length === 0, 'D. the hover toolbar never covers the header (time, tags, name) on any note' + (overlaps.length ? ': ' + overlaps.join('; ') : ''));
    await page.mouse.move(5, 5);
    const notesE = await page.evaluate(() => ({
      lock: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_team"] .svu-lock[title]'),
      teamWord: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_team"] .cal-cm-head-line .cal-cm-to-tag.is-team'),
      tweak: (document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_change"] .cal-cm-type-tag.is-tweak') || {}).textContent,
      qTags: [...document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-tags .svu-tag')].map(t => t.textContent),
    }));
    ok(notesE.lock && !notesE.teamWord, 'H. Notes: "Team only" is a lock with its meaning on hover');
    ok(notesE.tweak === 'Change request', 'H. Notes: a change request reads "Change request" (' + notesE.tweak + ')');
    ok(notesE.qTags.join() === 'Waiting for your answer', 'H. Notes: "Waiting for your answer" stands alone, without "New" (' + notesE.qTags.join() + ')');
    const writes = await page.evaluate(() => new Promise(resolve => {
      const feed = document.querySelector('#calCommentsModal .cal-comments-feed');
      let n = 0;
      const mo = new MutationObserver(list => { n += list.length; });
      mo.observe(feed, { childList: true, subtree: true, characterData: true });
      setTimeout(() => { mo.disconnect(); resolve(n); }, 1200);
    }));
    ok(writes === 0, 'D. Notes settle: no redraw while nothing changes (' + writes + ' writes in 1.2 s)');
    await page.evaluate(sel => document.querySelector(sel + ' .svu-noreply').click(), row);
    await sleep(300);
    const after = await page.evaluate(sel => ({
      waiting: !!document.querySelector(sel + ' .svu-t-waiting'),
      plain: !!document.querySelector(sel + ' .svu-t-plain'),
      tool: !!document.querySelector(sel + ' .svu-noreply'),
      stored: (() => { try { return JSON.parse(localStorage.getItem('sv-unread-v2-local')).noReply; } catch (e) { return null; } })(),
    }), row);
    ok(!after.waiting && after.plain && !after.tool && Array.isArray(after.stored) && after.stored.includes('n_question'), 'D. "No reply needed" takes the comment off waiting, leaves the toolbar and is kept in this browser');

    await page.evaluate(() => { try { closeCalComments(); } catch (e) {} _msgOpenPage(); });
    await page.waitForSelector('#msgPage .svu-conv', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => _msgSetFilter('all'));
    await sleep(300);
    const msg = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll('#msgPage .msg-filters button')].map(b => b.textContent.replace(/\s*\d+$/, '').trim()),
      img: (document.querySelector('#msgPage .svu-conv .svu-conv-av') || {}).src || '',
      count: (document.querySelector('[data-msg-count]') || {}).className || '',
    }));
    ok(msg.tabs.join() === 'New,To answer,All', 'E. Messages has New, To answer and All: ' + msg.tabs.join());
    ok(msg.img === CLIENT_PIC, 'E. the conversation row carries the client picture');
    ok(/svu-count/.test(msg.count), 'E. the Messages count is the round one');
    const views = await page.evaluate(() => {
      const keep = _msgState.scope;
      const rows = scope => { _msgState.scope = scope; _msgState.openId = ''; _msgSetFilter('new'); return document.querySelectorAll('#msgPage .svu-conv').length; };
      const reviewer = rows('all'), smm = rows('own');
      const title = (document.querySelector('#msgPage .svu-conv .svu-bub') || {}).title || '';
      _msgState.scope = keep; _msgSetFilter('all');
      return { reviewer, smm, title };
    }).catch(e => ({ error: String(e) }));
    ok(views.reviewer === 0 && views.smm === 1, 'E. the reviewer view never counts a client message as new, the SMM view does ' + JSON.stringify(views));
    ok(/^Casey: \d+ new comments?/.test(views.title || ''), 'E. a list badge says in a hover what it counts: ' + views.title);
    await page.evaluate(() => svuMarkUnread('p_t1'));
    await page.evaluate(() => _msgOpen('p_t1'));
    await page.waitForSelector('#msgPage .svu-change-line', { timeout: 6000 }).catch(() => {});
    await sleep(300);
    const cleared = await page.evaluate(() => { try { return !JSON.parse(localStorage.getItem('sv-unread-v2-local')).unread.includes('p_t1'); } catch (e) { return false; } });
    ok(cleared, 'E. opening the conversation in Messages clears this browser\'s Mark unread for it');
    const line = await page.evaluate(() => (document.querySelector('#msgPage .svu-change-line') || {}).textContent || '');
    ok(/asked for a change on the video/.test(line), 'E. the change request is one line pointing to the card');
    const head = await page.evaluate(() => {
      const b = id => document.querySelector(`#msgPage .msg-b[data-msg-id="${id}"]`);
      const team = b('m_team'), mine = b('m_mine');
      const meta = team && team.querySelector('.msg-b-meta');
      const av = mine && mine.querySelector('.svu-slack-av'), name = mine && mine.querySelector('.msg-b-meta b');
      const acts = team && team.querySelector('.svu-msg-acts');
      return {
        name: meta && meta.querySelector('b').textContent,
        lock: !!(meta && meta.querySelector('.svu-lock[title]')), teamWord: !!(meta && meta.querySelector('.cal-cm-to-tag.is-team')),
        role: meta ? [...meta.children].filter(x => x.tagName === 'SPAN' && !x.className).length : -1,
        time: meta && (meta.querySelector('.svu-time') || {}).textContent,
        partLast: meta && meta.lastElementChild.classList.contains('cal-cm-comp-label'),
        actsHidden: acts ? getComputedStyle(acts).opacity === '0' : null, replyRow: !!(team && team.querySelector('.svu-row-acts')),
        avTop: av && Math.round(av.getBoundingClientRect().top - mine.getBoundingClientRect().top),
        nameTop: name && Math.round(name.getBoundingClientRect().top - mine.getBoundingClientRect().top),
        avLeft: av && Math.round(av.getBoundingClientRect().left - mine.getBoundingClientRect().left),
      };
    });
    ok(head.name === 'Fixture' && head.lock && !head.teamWord && head.role === 0 && head.time === '30m ago' && head.partLast, 'E. a message header is first name, a lock, a relative time and the part at the right ' + JSON.stringify(head));
    ok(head.actsHidden === true && !head.replyRow, 'E. Reply shows on hover only');
    const e = await page.evaluate(() => ({
      days: [...document.querySelectorAll('#msgPage .msg-day')].map(d => d.textContent.trim()),
      newTags: document.querySelectorAll('#msgPage .msg-b .svu-tag.svu-t-comment, #msgPage .msg-b .svu-tag.svu-t-staff').length,
      line: (document.querySelector('#msgPage .svu-change-line') || {}).textContent || '',
      acts: [...document.querySelectorAll('#msgPage .msg-chat-actions .msg-act')].map(a => a.textContent.trim()),
      thumb: (() => { const t = document.querySelector('#msgPage .msg-chat-head .msg-thumb.is-empty'); return t ? getComputedStyle(t).display : 'none'; })(),
      cap: (document.querySelector('#msgPage .msg-reply-cap b') || {}).textContent || '',
      cont: !!document.querySelector('#msgPage .msg-b[data-msg-id="m_team2"].svu-cont'),
      contFirst: !!document.querySelector('#msgPage .msg-b[data-msg-id="m_team"].svu-cont'),
    }));
    ok(e.days.length >= 1 && e.days.every(d => d === 'Today'), 'H. day lines say "Today": ' + e.days.join(', '));
    ok(e.newTags === 0, 'H. no "New" tag on each message');
    ok(/^Casey asked for a change on the video/.test(e.line.trim()) && !/handled on the card/.test(e.line), 'H. the change-request line is one quiet line: ' + e.line.trim());
    ok(e.acts.join() === 'Mark unread,Open card' && e.thumb === 'none', 'H. header actions are words and an empty thumbnail is not drawn ' + JSON.stringify([e.acts, e.thumb]));
    ok(e.cap === '' || e.cap.split(/\s+/).length === 1, 'H. the reply caption uses the first name: ' + e.cap);
    ok(e.cont && !e.contFirst, 'H. a follow-up by the same person within five minutes drops its picture and name');
    ok(head.avLeft < 40 && Math.abs(head.avTop - head.nameTop) <= 8, 'E. your own picture sits at the left, beside your name (top ' + head.avTop + ' vs ' + head.nameTop + ', left ' + head.avLeft + ')');
    ok(h.inboxCalls.some(b => b.pictures === 1 && b.via === 'GET'), 'G. with the switch on, the inbox read (GET) asks for pictures');
    ok(h.errors.length === 0, 'F. switch on: no page error' + (h.errors.length ? ' ' + h.errors.join(' | ') : ''));
  } finally { await h.S.close(); }

  if (failures) { console.error(`unread-badges-v2-browser: ${failures} failed`); process.exit(1); }
  console.log('unread-badges-v2-browser: all passed');
})().catch(e => { console.error(e); process.exit(1); });
