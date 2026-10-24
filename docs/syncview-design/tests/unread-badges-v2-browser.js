'use strict';
/* unread-badges-v2-browser.js -- the round-5 unread badges (327) behind the runtime switch unread_badges_v2
 * (session Beacon, 2026-10-24; docs/audits/2026-10-23-unread-badges.md). Offline: the built page through the
 * lost-work harness, every backend answer mocked, fictional notes and fictional picture links.
 *
 *   A. Switch missing or the wrong shape: the card's Notes button is today's, the page has no sv-unread2, no bubbles.
 *   B. Switch naming someone else: the same.
 *   C. Switch naming the signed-in member: the page carries sv-unread2; the card shows one bubble per person,
 *      the client's with the client's picture from the inbox answer, a teammate without a picture as initials, and
 *      numbers coloured by kind (change, comment, staff); the hover lists who and what.
 *   D. Opening Notes keeps what was new: "Needs you" lists it, the comment waiting for an answer carries Reply and
 *      No reply needed, and "No reply needed" takes it off and survives a reload (this browser).
 *   E. Messages: New, To answer and All; the row carries the client's picture; the change request is one line.
 *   F. No page error.
 */
const { createEnv, sleep, SLUG } = require('./lost-work-lib');

const CORS = { 'access-control-allow-origin': '*' };
const ago = min => new Date(Date.now() - min * 60000).toISOString();
const note = o => Object.assign({ parent_id: null, author: 'Fixture Client', role: 'client', audience: 'client', is_tweak: false, done: false, round: 1 }, o, { root_id: o.parent_id || o.id, created_at: ago(o.min), updated_at: ago(o.min) });
const NOTES = [
  note({ id: 'n_change', min: 10, is_tweak: true, body: 'Cut the first two seconds.' }),
  note({ id: 'n_question', min: 20, body: 'Can we post this on Friday?' }),
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
    messages: [Object.assign({}, NOTES[1], { component: 'video' }), Object.assign({}, NOTES[0], { component: 'video' })].sort((a, b) => a.created_at.localeCompare(b.created_at)) };
  await S.ctx.route('**/functions/v1/production-comments{,?*}', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fallback();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (b.action === 'inbox') {
      inboxCalls.push(1);
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
    ok(client && client.nums.join() === 'svu-n-change:2', 'C. both new client notes count on the client bubble, coloured as a change request');
    const team = st.bubbles.find(b => b.initials);
    ok(team && team.initials === 'FE' && team.nums.join() === 'svu-n-staff:1', 'C. a teammate with no picture shows initials and a grey number');
    await page.hover('.cal-foot-tweaks[data-comments-wrap="p_t1"] .svu-strips');
    await sleep(150);
    const hover = await page.evaluate(() => [...document.querySelectorAll('.svu-pv .svu-pv-row')].map(r => r.className.replace('svu-pv-row ', '') + '|' + r.querySelector('.svu-pv-who').textContent));
    ok(hover.length === 3 && hover.includes('svu-k-change|Client') && hover.includes('svu-k-comment|Client') && hover.includes('svu-k-staff|Fixture'), 'C. the hover lists who and what: ' + hover.join(', '));
    await page.mouse.move(5, 5);

    await page.evaluate(() => openCalComments('p_t1'));
    await page.waitForSelector('#calCommentsModal .svu-need', { timeout: 6000 }).catch(() => {});
    await sleep(300);
    const notes = await page.evaluate(() => ({
      need: [...document.querySelectorAll('#calCommentsModal .svu-need-row .svu-need-label')].map(e => e.textContent),
      acts: [...document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-row-acts button')].map(b => b.textContent),
      waitingTag: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-t-waiting'),
    }));
    ok(notes.need.includes('New change request') && notes.need.includes('Waiting for your answer') && notes.need.includes('New from the team'), 'D. "Needs you" keeps what was new: ' + notes.need.join(', '));
    ok(notes.waitingTag && notes.acts.join() === 'Reply,No reply needed', 'D. the waiting comment carries Reply and No reply needed');
    await page.click('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-row-acts .svu-text-btn');
    await sleep(300);
    const after = await page.evaluate(() => ({
      waiting: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-t-waiting'),
      plain: !!document.querySelector('#calCommentsModal .cal-cm-row[data-cm-row="n_question"] .svu-t-plain'),
      stored: (() => { try { return JSON.parse(localStorage.getItem('sv-unread-v2-local')).noReply; } catch (e) { return null; } })(),
    }));
    ok(!after.waiting && after.plain && Array.isArray(after.stored) && after.stored.includes('n_question'), 'D. "No reply needed" takes the comment off waiting and is kept in this browser');

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
    await page.evaluate(() => _msgOpen('p_t1'));
    await page.waitForSelector('#msgPage .svu-change-line', { timeout: 6000 }).catch(() => {});
    const line = await page.evaluate(() => (document.querySelector('#msgPage .svu-change-line') || {}).textContent || '');
    ok(/asked for a change on the video/.test(line), 'E. the change request is one line pointing to the card');
    ok(h.inboxCalls.length >= 1, 'C. the inbox (and its pictures) is read once the switch is on');
    ok(h.errors.length === 0, 'F. switch on: no page error' + (h.errors.length ? ' ' + h.errors.join(' | ') : ''));
  } finally { await h.S.close(); }

  if (failures) { console.error(`unread-badges-v2-browser: ${failures} failed`); process.exit(1); }
  console.log('unread-badges-v2-browser: all passed');
})().catch(e => { console.error(e); process.exit(1); });
