'use strict';
/*
 * THREE CLIENT-LINK NOTES FIXES behind review_client_polish (session Notesfix, 2026-10-27; found in a live test after
 * #2372). Real browser, fully offline, the shared mocked backend of the review-stage tests (fictional client, cards,
 * people and conversation).
 *
 *   1. The client link opens on the Review page. A post's notes are read only once its conversation is on screen: at
 *      1440 that is at once (as before); at 390 the conversation is below the post, so a new team note stays new
 *      (the Sheet's corner count) until the conversation is scrolled into view.
 *   2. A team reply inside a done thread (Notes keeps done threads behind its history button) never counts as new:
 *      the Sheet's count matches the New rows Notes shows.
 *   3. The client Review page never names Kasper: every team note reads "Synchro team" with the team's "S" picture, in
 *      the conversation and in the strip's badges; never the violet Kasper picture. (The calendar's client view
 *      already drops notes by Kasper, 130 _calCommentsForView, so 195 _rsFirst naming him first could not be reached
 *      from this backend's data; this part is the guard for the page, and 1 and 2 fail on main before this fix.)
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, OTHER, open, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const N = (id, body, at, extra) => Object.assign({ id, parent_id: null, author: 'Team Member', author_member_id: OTHER.id, role: 'smm', is_tweak: false, audience: 'client', body, created_at: at, updated_at: at, done: false, done_at: '', done_by: '' }, extra || {});
const C = (id, body, at, extra) => N(id, body, at, Object.assign({ role: 'client', author: CLIENT, author_member_id: '' }, extra || {}));
const K = (id, body, at, extra) => N(id, body, at, Object.assign({ role: 'kasper', author: 'Kasper', author_member_id: '' }, extra || {}));
const SEEN0 = '2026-10-15T00:00:00.000Z';
const SEEN = { rs1: SEEN0, rs2: SEEN0, rs6: SEEN0 };
// rs1 (the post the Review page opens on): an old team note, and a new one since the client last looked.
// rs2: a new note by Kasper marked for the client (the calendar's client view drops Kasper's notes, 130; if one ever
// reaches the page it must read as the team).
// rs6: the client's change request, done, with a new team reply inside it (history in Notes), and a new team note.
function seed(state) {
  const card = id => state.cards.find(c => c.id === id);
  card('rs1').video_tweaks = JSON.stringify([N('a1', 'An older note.', '2026-10-12T09:00:00.000Z'), N('a2', 'The new cut is up.', '2026-10-20T09:00:00.000Z'),
    N('a3', 'The colours are fixed.', '2026-10-21T09:00:00.000Z', { author: 'Fixture Reviewer' })]);
  card('rs2').video_tweaks = JSON.stringify([K('k1', 'One last look at the intro, please.', '2026-10-20T09:00:00.000Z')]);
  card('rs6').video_tweaks = JSON.stringify([C('d1', 'Please make the logo bigger.', '2026-10-10T09:00:00.000Z', { is_tweak: true, done: true, done_at: '2026-10-19T09:00:00.000Z' }),
    N('d2', 'Done, the logo is bigger now.', '2026-10-19T09:00:00.000Z', { parent_id: 'd1' }), N('d3', 'The thumbnail is ready too.', '2026-10-20T09:00:00.000Z')]);
}

async function openReview(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'client', flags: 'on', polish: true, collab: true, finished: true, inbox: [] }, o));
  seed(t.state);
  await t.page.addInitScript(seen => { try { if (!sessionStorage.getItem('fx-seeded')) { sessionStorage.setItem('fx-seeded', '1'); localStorage.setItem('syncview_notes_seen_v1', JSON.stringify(seen)); } } catch (e) {} }, SEEN);
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1500);
  return t;
}
const seenOf = (page, pid) => page.evaluate(id => { try { return (JSON.parse(localStorage.getItem('syncview_notes_seen_v1') || '{}') || {})[id] || ''; } catch (e) { return ''; } }, pid);
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
async function toSheet(t) {
  await t.page.evaluate(() => onCalViewChange('organizer'));
  await t.page.waitForFunction(() => calState.view === 'organizer' && document.querySelector('.cal-card[data-pid="rs6"] .cal-foot-tweaks'), null, { timeout: 15000 });
  await sleep(1000);
}
const foot = (page, pid) => page.evaluate(id => {
  const w = document.querySelector('.cal-card[data-pid="' + id + '"] .cal-foot-tweaks');
  return w ? { corner: Array.from(w.querySelectorAll('.svu-corner')).map(b => b.textContent), plain: Array.from(w.querySelectorAll('.svu-num:not(.svu-corner)')).map(b => b.textContent), label: Array.from(w.querySelectorAll('.svu-bub')).map(b => b.getAttribute('aria-label')).join(' | ') } : null;
}, pid);

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    console.log('--- 1a. 1440: the conversation is on screen, so the post\'s notes are read at once (as before) ---');
    {
      const t = await openReview(browser, origin, { width: 1440, height: 900 });
      const s = await seenOf(t.page, 'rs1');
      expect(s > SEEN0, 'at 1440 the post under review is marked read when the page opens (' + s + ')');
      await toSheet(t);
      const f1 = await foot(t.page, 'rs1');
      expect(f1 && !f1.corner.length, 'on the Sheet the post has nothing new (' + JSON.stringify(f1) + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 1b. 390: the conversation is below the fold; nothing is read until it is on screen ---');
    {
      const t = await openReview(browser, origin, { width: 390, height: 844 });
      const below = await R(t.page, r => { const c = r.getElementById('tscroll') || r.getElementById('chat'); const b = c && c.getBoundingClientRect(); return b ? b.top >= innerHeight : null; });
      expect(below === true, 'at 390 the conversation starts below the fold');
      expect(await seenOf(t.page, 'rs1') === SEEN0, 'at 390 the post is not marked read while its conversation is off screen');
      await toSheet(t);
      const f1 = await foot(t.page, 'rs1');
      expect(f1 && f1.corner.join() === '2', 'on the Sheet the post still shows its two new team notes (' + JSON.stringify(f1) + ')');
      await t.ctx.close();
    }
    {
      const t = await openReview(browser, origin, { width: 390, height: 844 });
      await R(t.page, r => { const c = r.getElementById('tscroll') || r.getElementById('chat'); c.scrollIntoView({ block: 'center' }); });
      let s = '';
      for (let i = 0; i < 30 && !(s > SEEN0); i++) { await sleep(100); s = await seenOf(t.page, 'rs1'); }
      expect(s > SEEN0, 'scrolling the conversation into view marks the post read (' + s + ')');
      const news = await R(t.page, r => Array.from(r.querySelectorAll('.cpm .cpm-k.new')).length);
      expect(news === 2, 'its two new messages still carry "New" (' + news + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 2. A reply inside a done thread does not count as new ---');
    {
      const t = await openReview(browser, origin, { width: 1440, height: 900 });
      await toSheet(t);
      const f6 = await foot(t.page, 'rs6');
      console.log('     ' + JSON.stringify(f6));
      expect(f6 && f6.corner.join() === '1', 'the Sheet counts 1 new note, not the reply hidden in the done thread (' + JSON.stringify(f6) + ')');
      await t.page.locator('.cal-card[data-pid="rs6"] [data-comments-btn]').first().click();
      await t.page.locator('#calCommentsModal .cal-cm-row[data-cm-row]').first().waitFor({ timeout: 15000 });
      await sleep(900);
      const rows = await t.page.evaluate(() => Array.from(document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row]')).map(r => ({ id: r.getAttribute('data-cm-row'), news: Array.from(r.querySelectorAll('.svu-tag')).filter(x => x.textContent === 'New').length })));
      const newRows = rows.filter(r => r.news).length;
      expect(newRows === 1 && !rows.some(r => r.id === 'd2'), 'Notes shows one New row and keeps the done thread in history (' + JSON.stringify(rows) + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 3. The client Review page names the team, never Kasper ---');
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const t = await openReview(browser, origin, { width: w, height: h });
      const conv = await R(t.page, r => Array.from(r.querySelectorAll('.cpm')).map(m => ({ who: ((m.querySelector('.cpm-h b') || {}).textContent || '').trim(), av: (m.querySelector('.cpm-av') || {}).textContent || '', kp: !!m.querySelector('.cpm-av.kp'), text: (m.querySelector('.cpm-x') || {}).textContent || '' })));
      // what a person can read on the page: its words, its hovers and labels, and the pictures (never its style sheet)
      const all = await R(t.page, r => Array.from(r.children).filter(e => e.tagName !== 'STYLE').map(e => e.innerText).join(' ')
        + ' ' + Array.from(r.querySelectorAll('[title],[aria-label]')).map(e => (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '')).join(' ')
        + ' ' + Array.from(r.querySelectorAll('.cpm-av, .av')).map(a => a.outerHTML).join(''));
      const strip = await R(t.page, r => { const c = r.querySelector('.chipp[data-id="rs2"]'); return c ? { av: Array.from(c.querySelectorAll('.cpb .cpm-av')).map(a => a.textContent + (a.classList.contains('kp') ? ':kp' : '')), title: c.getAttribute('title') || '' } : null; });
      console.log('     ' + w + ' ' + JSON.stringify({ conv, strip }));
      expect(conv.length === 3 && conv.every(x => x.who === 'Synchro team' && x.av === 'S' && !x.kp), w + ': every team note in the conversation reads "Synchro team" with the "S" picture, another staff member\'s included');
      expect(!/Kasper|Fixture Reviewer|Team Member/.test(all), w + ': no staff name, Kasper\'s included, anywhere on the client Review page');
      expect(!/class="cpm-av kp"|class="av kp"/.test(all), w + ': no violet Kasper picture');
      if (strip) expect(strip.av.every(a => a === 'S'), w + ': any badge in the strip is the team\'s "S" (' + JSON.stringify(strip) + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nclient-notes-fixes-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nclient-notes-fixes-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
