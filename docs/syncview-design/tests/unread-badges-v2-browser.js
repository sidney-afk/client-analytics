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
 *   I. Round 7 (owner, 2026-10-24): a read change request still open is a coloured number with no ring; no "Not
 *      done" word; the hover toolbar sits at the bottom right of a note and of a message and never covers a word of
 *      the note (a note whose last line runs under it gets room below, the others none); a change request, and a reply
 *      under one, has no Reply in Notes or in Messages while the reply already written still shows; the whole Notes
 *      row on a card (button, gap, bubbles) opens Notes; a note on its way shows a spinner, never "Sending"; a
 *      message's attachments show in Messages as in Notes.
 *   J. Round 8 (owner, 2026-10-24): something new is the picture with a small count on its top right corner and
 *      nothing else, read-but-open stays the plain number, never both; the card hover is as wide as its lines need;
 *      no underline on any action, even on hover; no "Waiting for your answer" and no "Mark unread" anywhere; in
 *      Messages the actions sit at the bottom left under the words and cover nobody's words, replies sit indented
 *      under what they answer on a thread line (two levels, then "replying to <first name>"), and the header ends
 *      with Open card then a plain ×; Notes shows its thread line too.
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
  // Round 7: a reply already written under the change request (by you, so no count changes); it must still show.
  note({ id: 'n_change_r', parent_id: 'n_change', min: 8, author: 'Browser Staff', author_member_id: 'm1', role: 'admin', body: 'Trimmed in the next cut.' }),
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
      Object.assign(note({ id: 'm_team2', min: 29, author: 'Fixture Editor', author_member_id: 'ed1', role: 'editor', audience: 'internal', body: 'Same export, now with captions.' }), { component: 'video', is_tweak: false, attachments: [{ name: 'export-v2.mp4', url: 'https://example.invalid/export-v2.mp4' }] }),
      Object.assign(note({ id: 'm_kasper', min: 40, author: 'Kasper', role: 'kasper', audience: 'internal', is_tweak: true, body: 'Colour on the last shot is warm.' }), { component: 'video' }),
      // Round 8: a thread three deep under the question (all yours, so no count changes).
      Object.assign(note({ id: 'm_reply', parent_id: 'n_question', min: 19, author: 'Browser Staff', author_member_id: 'm1', role: 'admin', body: 'Yes, Friday works.' }), { component: 'video' }),
      Object.assign(note({ id: 'm_reply2', parent_id: 'm_reply', min: 18, author: 'Browser Staff', author_member_id: 'm1', role: 'admin', body: 'I will have it ready.' }), { component: 'video', root_id: 'n_question' }),
      Object.assign(note({ id: 'm_reply3', parent_id: 'm_reply2', min: 17, author: 'Browser Staff', author_member_id: 'm1', role: 'admin', body: 'Thanks.' }), { component: 'video', root_id: 'n_question' }),
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
    ok(client && client.nums.join() === 'svu-corner svu-n-change:3', 'C. all three new client notes count on the client bubble, coloured as a change request: ' + (client && client.nums.join()));
    const team = st.bubbles.find(b => b.initials);
    ok(team && team.initials === 'FE' && team.nums.join() === 'svu-corner svu-n-staff:1', 'C. a teammate with no picture shows initials and a grey number');
    await page.hover('.cal-foot-tweaks[data-comments-wrap="p_t1"] .svu-strips');
    await sleep(150);
    const hover = await page.evaluate(() => ({
      who: [...document.querySelectorAll('.svu-pv .svu-pv-row .svu-pv-who')].map(e => e.textContent),
      text: [...document.querySelectorAll('.svu-pv .svu-pv-row .svu-pv-text')].map(e => e.textContent),
      noise: document.querySelectorAll('.svu-pv .svu-pv-time, .svu-pv .svu-pv-what, .svu-pv .svu-pv-foot').length,
    }));
    ok(hover.who.join() === 'Bartholomew-Maximilian,Casey,Fixture,Casey' && hover.text[1] === 'Cut the first two seconds.', 'C. the hover is picture, first name and the note, newest first: ' + hover.who.join(', '));
    ok(hover.noise === 0, 'C. the hover has no date, no kind label and no footer');
    // Round 8: something new is a small count on the picture's top right corner, alone; the hover fits its lines.
    const corner = await page.evaluate(() => {
      const bub = [...document.querySelectorAll('.cal-foot-tweaks[data-comments-wrap="p_t1"] .svu-bub')].find(b => b.querySelector('img'));
      const nums = bub ? [...bub.querySelectorAll('.svu-num')] : [], av = bub && bub.querySelector('.svu-bub-av');
      const n = nums[0] && nums[0].getBoundingClientRect(), a = av && av.getBoundingClientRect();
      const pv = document.querySelector('.svu-pv');
      const texts = pv ? [...pv.querySelectorAll('.svu-pv-text')] : [];
      return { count: nums.length, onCorner: !!(n && a && n.left > a.left + a.width / 2 && n.top < a.top + 2 && n.bottom < a.top + a.height / 2 + 4),
        pvWidth: pv ? Math.round(pv.getBoundingClientRect().width) : 0, clipped: texts.filter(t => t.scrollWidth > t.clientWidth + 1).map(t => getComputedStyle(t).textOverflow) };
    });
    ok(corner.count === 1 && corner.onCorner, 'J. something new is one small count on the picture\'s top right corner, nothing beside it ' + JSON.stringify(corner));
    ok(corner.pvWidth > 0 && corner.pvWidth <= 360 && (corner.pvWidth < 360 || corner.clipped.length > 0) && corner.clipped.every(t => t === 'ellipsis'), 'J. the card hover is as wide as its lines need, at most 360 px, a longer line ends in an ellipsis ' + JSON.stringify(corner));
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
    ok(!notes.waitingTag && notes.tools.includes('Reply') && notes.tools.includes('No reply needed'), 'D. the comment waiting for an answer has Reply and No reply needed, and no status word (round 8): ' + notes.tools.join(', '));
    ok(!notes.unread, 'J. no "Mark unread" in the Notes head');
    // Round 7: make one note's last line run under where the toolbar sits, so the room case is exercised.
    await page.evaluate(() => {
      const row = document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_long"]');
      const body = row.querySelector('.cal-cm-row-body'), bar = row.querySelector('.cal-cm-actions');
      const last = () => { const r = document.createRange(); r.selectNodeContents(body.firstChild); const rs = [...r.getClientRects()]; return rs[rs.length - 1]; };
      for (let i = 0; i < 80 && last().right < bar.getBoundingClientRect().left + 20; i++) body.firstChild.nodeValue += ' more';
    });
    await sleep(300);
    // The hover toolbar sits at the bottom right of every note and never covers a word of it (header or body).
    const overlaps = [], placed = [];
    for (const id of await page.evaluate(() => [...document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row]')].map(r => r.getAttribute('data-cm-row')))) {
      const sel = `#calCommentsModal .cal-cm-row[data-cm-row="${id}"]`;
      await page.hover(sel + ' .cal-cm-row-body').catch(() => {});
      await sleep(180);
      const hit = await page.evaluate(sel => {
        const row = document.querySelector(sel), bar = row && row.querySelector(':scope > .cal-cm-actions');
        if (!bar) return { none: true };
        if (getComputedStyle(bar).opacity === '0') return { bad: 'toolbar not shown' };
        const b = bar.getBoundingClientRect(), r = row.getBoundingClientRect();
        const meet = x => x.width && x.height && x.left < b.right && x.right > b.left && x.top < b.bottom && x.bottom > b.top;
        const range = document.createRange(), bad = [];
        const walk = document.createTreeWalker(row.querySelector('.cal-cm-body-col'), NodeFilter.SHOW_TEXT);
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          if (!t.nodeValue.trim() || getComputedStyle(t.parentElement).visibility === 'hidden') continue;
          range.selectNodeContents(t);
          if ([...range.getClientRects()].some(meet)) bad.push(JSON.stringify(t.nodeValue.trim().slice(0, 20)));
        }
        return { bad: bad.join('+'), bottom: Math.round(r.bottom - b.bottom), right: Math.round(r.right - b.right), room: row.classList.contains('svu-bar-room') };
      }, sel);
      if (hit.none) continue;
      if (hit.bad) overlaps.push(id + ': ' + hit.bad);
      placed.push(Object.assign({ id }, hit));
    }
    ok(overlaps.length === 0 && placed.length >= 4, `I. the hover toolbar never covers a word of any note, the long one included (${placed.length} notes)` + (overlaps.length ? ': ' + overlaps.join('; ') : ''));
    ok(placed.every(p => p.bottom >= 0 && p.bottom <= 14 && p.right >= 0 && p.right <= 28), 'I. the toolbar sits at the bottom right of each note ' + JSON.stringify(placed.map(p => [p.id, p.bottom, p.right])));
    const room = placed.filter(p => p.room).map(p => p.id);
    ok(room.join() === 'n_long', 'I. only the note whose last line runs under the toolbar gets room below it: ' + room.join());
    const r7 = await page.evaluate(() => {
      const tools = id => [...document.querySelectorAll(`#calCommentsModal .cal-cm-row[data-cm-row="${id}"] .cal-cm-actions .cal-cm-action`)].map(b => b.textContent.trim());
      return {
        change: tools('n_change'), reply: tools('n_change_r'), question: tools('n_question'),
        replyShown: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_change_r"] .cal-cm-row-body'),
        notDone: /Not done/.test(document.querySelector('#calCommentsModal .cal-comments-feed').textContent),
        sending: _noteOutboxStatusHtml({ id: 'x', _outbox: 'sending' }),
      };
    });
    ok(!r7.change.includes('Reply') && !r7.reply.includes('Reply') && r7.question.includes('Reply'), 'I. Notes: no Reply on a change request or a reply under it; a comment keeps it ' + JSON.stringify([r7.change, r7.reply, r7.question]));
    ok(r7.replyShown, 'I. Notes: the reply already written under the change request still shows');
    ok(!r7.notDone, 'I. Notes: no "Not done" word');
    ok(/class="sv-spin"/.test(r7.sending) && !/>\s*Sending/.test(r7.sending), 'I. a note on its way shows the spinner, not the word "Sending": ' + r7.sending);
    await page.mouse.move(5, 5);
    const notesE = await page.evaluate(() => ({
      lock: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_team"] .svu-lock[title]'),
      teamWord: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_team"] .cal-cm-head-line .cal-cm-to-tag.is-team'),
      tweak: (document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_change"] .cal-cm-type-tag.is-tweak') || {}).textContent,
      qTags: [...document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-tags .svu-tag')].map(t => t.textContent),
    }));
    ok(notesE.lock && !notesE.teamWord, 'H. Notes: "Team only" is a lock with its meaning on hover');
    ok(notesE.tweak === 'Change request', 'H. Notes: a change request reads "Change request" (' + notesE.tweak + ')');
    ok(notesE.qTags.join() === 'New', 'J. Notes: a comment waiting for an answer carries no "Waiting for your answer", just New (' + notesE.qTags.join() + ')');
    await page.hover('#calCommentsModal .cal-cm-row[data-cm-row="n_change"] .cal-cm-row-body').catch(() => {});
    await sleep(150);
    await page.hover('#calCommentsModal .cal-cm-row[data-cm-row="n_change"] .cal-cm-action').catch(() => {});
    await sleep(150);
    const notesJ = await page.evaluate(() => ({
      underline: [...document.querySelectorAll('#calCommentsModal .cal-cm-action')].filter(a => a.matches(':hover') || true).map(a => getComputedStyle(a).textDecorationLine).filter(d => d !== 'none'),
      hovered: (() => { const a = document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_change"] .cal-cm-action:hover'); return a ? getComputedStyle(a).textDecorationLine : 'not hovered'; })(),
      waiting: /Waiting for your answer/i.test(document.getElementById('calCommentsModal').innerText),
      markUnread: /Mark unread/i.test(document.getElementById('calCommentsModal').innerText),
      rail: (() => { const r = document.querySelector('#calCommentsModal .cal-cm-rail'); return r ? getComputedStyle(r).display : 'missing'; })(),
    }));
    ok(notesJ.hovered === 'none' && notesJ.underline.length === 0, 'J. Notes: no action is underlined, not even the one under the pointer ' + JSON.stringify(notesJ));
    ok(!notesJ.waiting && !notesJ.markUnread, 'J. Notes: no "Waiting for your answer" and no "Mark unread" anywhere');
    ok(notesJ.rail === 'block', 'J. Notes: replies hang on a thin thread line, as in Messages (' + notesJ.rail + ')');
    await page.mouse.move(5, 5);
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

    // Round 7 on the card: the read change request still open is a coloured number with no ring; the gap between the
    // Notes button and the bubbles opens Notes too.
    await page.evaluate(() => { try { closeCalComments(); } catch (e) {} });
    await sleep(400);
    const card = await page.evaluate(() => {
      const wrap = document.querySelector('.cal-foot-tweaks[data-comments-wrap="p_t1"]');
      const o = wrap && wrap.querySelector('.svu-num.svu-o-open');
      const cs = o && getComputedStyle(o);
      const btn = wrap && wrap.querySelector('.cal-comments-btn'), strip = wrap && wrap.querySelector('.svu-strips');
      const a = btn && btn.getBoundingClientRect(), z = strip && strip.getBoundingClientRect();
      return { open: !!o, ring: cs && cs.boxShadow, fill: cs && cs.backgroundColor, gap: a && z ? { x: Math.round((a.right + z.left) / 2), y: Math.round(a.top + a.height / 2), w: Math.round(z.left - a.right) } : null };
    });
    ok(card.open && card.ring === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(card.fill), 'I. a read change request still open is a coloured number with no ring and no fill ' + JSON.stringify([card.ring, card.fill]));
    ok(card.gap && card.gap.w >= 4, 'I. there is a gap between the Notes button and the bubbles to test (' + (card.gap && card.gap.w) + ' px)');
    if (card.gap) await page.mouse.click(card.gap.x, card.gap.y);
    await sleep(500);
    const opened = await page.evaluate(() => { const m = document.getElementById('calCommentsModal'); return !!(m && m.offsetParent !== null && m.querySelector('.cal-cm-row')); });
    ok(opened, 'I. a click in the gap between the Notes button and the bubbles opens Notes');
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
    ok(e.acts.join() === 'Open card' && e.thumb === 'none', 'J. the header has no "Mark unread", Open card is a word, an empty thumbnail is not drawn ' + JSON.stringify([e.acts, e.thumb]));
    ok(e.cap === '' || e.cap.split(/\s+/).length === 1, 'H. the reply caption uses the first name: ' + e.cap);
    ok(e.cont && !e.contFirst, 'H. a follow-up by the same person within five minutes drops its picture and name');
    const m7 = await page.evaluate(() => {
      const acts = id => { const b = document.querySelector(`#msgPage .msg-b[data-msg-id="${id}"]`); return b ? [...b.querySelectorAll('.svu-msg-acts button')].map(x => x.textContent.trim()) : null; };
      const file = document.querySelector('#msgPage .msg-b[data-msg-id="m_team2"] .svu-msg-files a');
      return { kasper: acts('m_kasper'), team: acts('m_team'), question: acts('n_question'), file: file ? [file.textContent, file.getAttribute('href'), file.target] : null };
    });
    ok(m7.file && m7.file.join() === 'export-v2.mp4,https://example.invalid/export-v2.mp4,_blank', 'I. Messages: a message\'s attachment shows under its words, as in Notes ' + JSON.stringify(m7.file));
    ok(m7.kasper && !m7.kasper.includes('Reply') && m7.team && m7.team.includes('Reply'), 'I. Messages: no Reply on a change request, a comment keeps it ' + JSON.stringify(m7));
    const msgPlaced = [];
    for (const id of ['m_team', 'm_team2', 'n_question']) {
      const sel = `#msgPage .msg-b[data-msg-id="${id}"]`;
      await page.mouse.move(5, 5);
      await sleep(120);
      const before = await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)].join(); }, sel);
      await page.hover(sel + ' .msg-b-text').catch(() => {});
      await sleep(120);
      const after = await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)].join(); }, sel);
      if (before !== after) msgPlaced.push(id + ': the row moved on hover ' + before + ' -> ' + after);
      await sleep(180);
      msgPlaced.push(await page.evaluate(([sel, id]) => {
        const b = document.querySelector(sel), bar = b && b.querySelector('.svu-msg-acts');
        if (!bar || getComputedStyle(bar).opacity === '0') return id + ': not shown';
        const x = bar.getBoundingClientRect(), r = b.getBoundingClientRect();
        // Round 8: at the bottom left, under the words, aligned with them, and over nobody's words (this message's or the
        // next one's).
        const text = b.querySelector('.msg-b-text').getBoundingClientRect();
        const all = [...document.querySelectorAll('#msgPage .msg-b .msg-b-text, #msgPage .msg-b .msg-b-meta')];
        const range = document.createRange();
        const covers = all.some(el => { range.selectNodeContents(el); return [...range.getClientRects()].some(t => t.width && t.left < x.right && t.right > x.left && t.top < x.bottom && t.bottom > x.top); });
        // Inside the hovered row (its hover background), and at least 8 px above the next row.
        const rows = [...document.querySelectorAll('#msgPage .msg-b, #msgPage .svu-change-line')];
        const next = rows[rows.indexOf(b) + 1], nr = next && next.getBoundingClientRect();
        const inside = x.top >= r.top - 0.5 && x.bottom <= r.bottom + 0.5 && x.left >= r.left - 0.5 && x.right <= r.right + 0.5;
        if (covers) return id + ': covers words';
        if (Math.abs(x.left - text.left) > 2 || x.top < text.bottom - 2) return id + ': not at the bottom left under the words ' + [Math.round(x.left - text.left), Math.round(x.top - text.bottom)];
        if (!inside) return id + ': outside its row ' + [Math.round(x.bottom - r.bottom)];
        if (nr && nr.top - x.bottom < 8) return id + ': only ' + Math.round(nr.top - x.bottom) + ' px above the next row';
        return '';
      }, [sel, id]));
    }
    ok(msgPlaced.every(x => x === ''), 'J. Messages: the hover actions sit at the bottom left, under the words, inside their row, 8 px or more above the next row, covering nobody\'s words ' + msgPlaced.filter(Boolean).join('; '));
    const sendingText = await page.evaluate(() => /Sending…|Sending\.\.\./.test(document.body.innerText));
    ok(!sendingText, 'I. no "Sending…" text anywhere on the page');
    await page.hover('#msgPage .msg-b[data-msg-id="n_question"] .msg-b-text').catch(() => {});
    await page.hover('#msgPage .msg-b[data-msg-id="n_question"] .svu-msg-acts button').catch(() => {});
    await sleep(150);
    const j = await page.evaluate(() => {
      const el = id => document.querySelector(`#msgPage .msg-b[data-msg-id="${id}"]`);
      const root = el('n_question'), r1 = el('m_reply'), r2 = el('m_reply2'), r3 = el('m_reply3');
      const box1 = r1 && r1.parentElement, box2 = r2 && r2.parentElement;
      const head = document.querySelector('#msgPage .msg-chat-head'), x = head && head.querySelector('.svu-chat-close');
      const acts = head ? [...head.querySelectorAll('.msg-chat-actions > *')].map(b => b.classList.contains('svu-chat-close') ? '×' : b.textContent.trim()) : [];
      const pageClose = document.querySelector('#msgPage .msg-page-head .msg-close');
      const hb = document.querySelector('#msgPage .msg-b[data-msg-id="n_question"] .svu-msg-acts button:hover');
      return {
        thread1: !!(box1 && box1.matches('.svu-replies.svu-depth-1') && box1.previousElementSibling === root),
        line: box1 ? getComputedStyle(box1, '::before').width : '',
        thread2: !!(box2 && box2.matches('.svu-replies.svu-depth-2') && box2.parentElement === box1),
        flat3: !!(r3 && r3.parentElement === box2 && /replying to \S+/.test((r3.querySelector('.svu-replying') || {}).textContent || '')),
        indent: r1 && root ? Math.round(r1.querySelector('.msg-b-text').getBoundingClientRect().left - root.querySelector('.msg-b-text').getBoundingClientRect().left) : 0,
        acts, xRight: x && head ? Math.round(head.getBoundingClientRect().right - x.getBoundingClientRect().right) : -1,
        xBox: x ? [getComputedStyle(x).borderTopWidth, getComputedStyle(x).backgroundColor, x.textContent.trim()] : null,
        pageClose: pageClose ? getComputedStyle(pageClose).visibility : 'missing',
        underline: hb ? getComputedStyle(hb).textDecorationLine : 'not hovered',
        words: /Waiting for your answer|Mark unread/i.test(document.getElementById('msgPage').innerText),
      };
    });
    ok(j.thread1 && j.thread2 && j.flat3 && j.indent > 20 && j.line === '2px', 'J. Messages: replies sit indented under what they answer on a thread line, two levels, then "replying to" ' + JSON.stringify(j));
    ok(j.acts.join() === 'Open card,×' && j.xRight >= 0 && j.xRight <= 24 && j.xBox && j.xBox[0] === '0px' && j.xBox[2] === '' && j.pageClose === 'hidden', 'J. Messages header: Open card, then a plain × at the far right; the page Close steps aside ' + JSON.stringify(j));
    ok(j.underline === 'none' && !j.words, 'J. Messages: no underline on hover, no "Waiting for your answer", no "Mark unread" ' + JSON.stringify([j.underline, j.words]));
    ok(head.avLeft < 40 && Math.abs(head.avTop - head.nameTop) <= 8, 'E. your own picture sits at the left, beside your name (top ' + head.avTop + ' vs ' + head.nameTop + ', left ' + head.avLeft + ')');
    ok(h.inboxCalls.some(b => b.pictures === 1 && b.via === 'GET'), 'G. with the switch on, the inbox read (GET) asks for pictures');
    ok(h.errors.length === 0, 'F. switch on: no page error' + (h.errors.length ? ' ' + h.errors.join(' | ') : ''));
  } finally { await h.S.close(); }

  if (failures) { console.error(`unread-badges-v2-browser: ${failures} failed`); process.exit(1); }
  console.log('unread-badges-v2-browser: all passed');
})().catch(e => { console.error(e); process.exit(1); });
