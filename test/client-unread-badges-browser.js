'use strict';
/*
 * THE CLIENT LINK GETS THE TEAM'S UNREAD BADGES AND NOTES, behind review_client_polish (session Clientbadges,
 * 2026-10-27; owner: "the way I experience notes on my account should be the same for the clients, at least on my test
 * client first"). Real browser, fully offline, the shared mocked backend of the review-stage tests (fictional client,
 * cards, people and conversation).
 *
 * Switch on, on the client link's Sheet (327 in its client mode):
 *   - a card's Notes button carries one picture for the team ("Synchro team", never a staff name or initials);
 *   - a team note since this browser last opened the card's Notes is the picture with a small corner count;
 *   - a read team comment that asks something, with the last word in its thread, is the plain number (the client
 *     review page's rule, 195 _rsCpBadge); a statement never waits; never both (new wins);
 *   - the client's own notes and change requests never count, and there is no "N open" any more;
 *   - team-only notes never show or count; the hover lists the team's lines;
 *   - Notes: rows as the team has them, "Synchro team" and "You", "New" on what is new, no "No reply needed";
 *   - no Messages inbox read.
 * Switch off: today's button ("N open", the dot), today's Notes, no html.sv-unread2.
 * SHOTS=<dir> writes the PR screenshots (1440 and 390, light and dark, switch on and off).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, STAFF, OTHER, open, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.SHOTS_ONLY === '1';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const N = (id, body, at, extra) => Object.assign({ id, parent_id: null, author: 'Team Member', author_member_id: OTHER.id, role: 'smm', is_tweak: false, audience: 'client', body, created_at: at, updated_at: at, done: false, done_at: '', done_by: '' }, extra || {});
const C = (id, body, at, extra) => N(id, body, at, Object.assign({ role: 'client', author: CLIENT, author_member_id: '' }, extra || {}));
// rs3: a read team question, a new team statement since, and a team-only aside by Kasper (never shown to a client).
// rs4: a read team question with no answer, and the client's own change request (not done).
// rs5: a read team question the client answered under it, and a read statement: nothing waits.
// rs6: only the client's own open change request: today's "1 open", nothing in the new look.
function seedNotes(state) {
  const card = id => state.cards.find(c => c.id === id);
  card('rs3').video_tweaks = JSON.stringify([N('b1', 'Could you send the logo file?', '2026-10-13T09:00:00.000Z'), N('b2', 'The new cut is up.', '2026-10-20T09:00:00.000Z'),
    N('b3', 'Team-only aside about the edit.', '2026-10-21T09:00:00.000Z', { audience: 'team', role: 'kasper', author: 'Kasper', author_member_id: '' })]);
  card('rs4').video_tweaks = JSON.stringify([N('x1', 'Which colour do you prefer?', '2026-10-01T09:00:00.000Z'), C('x2', 'Please make the logo bigger.', '2026-10-02T09:00:00.000Z', { is_tweak: true })]);
  card('rs5').video_tweaks = JSON.stringify([N('y1', 'Morning or evening post?', '2026-10-01T09:00:00.000Z'), C('y2', 'Evening, please.', '2026-10-02T09:00:00.000Z', { parent_id: 'y1' }),
    N('y3', 'New cut uploaded.', '2026-10-03T09:00:00.000Z')]);
  card('rs6').video_tweaks = JSON.stringify([C('z1', 'Can the music be quieter?', '2026-10-04T09:00:00.000Z', { is_tweak: true })]);
}
const SEEN = { rs3: '2026-10-15T00:00:00.000Z', rs4: '2026-10-05T00:00:00.000Z', rs5: '2026-10-05T00:00:00.000Z', rs6: '2026-10-05T00:00:00.000Z' };

async function openClientSheet(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'client', flags: 'on', polish: true, collab: true, finished: true, inbox: [] }, o));
  seedNotes(t.state);
  t.inboxReads = 0;
  t.page.on('request', r => { if (/\/functions\/v1\/production-comments/.test(r.url()) && /inbox/.test(r.url() + (r.postData() || ''))) t.inboxReads++; });
  await t.page.addInitScript(seen => { try { if (!sessionStorage.getItem('fx-seeded')) { sessionStorage.setItem('fx-seeded', '1'); localStorage.setItem('syncview_notes_seen_v1', JSON.stringify(seen)); } } catch (e) {} }, SEEN);
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
  await t.page.evaluate(() => onCalViewChange('organizer'));
  await t.page.waitForFunction(() => calState.view === 'organizer' && document.querySelector('.cal-card[data-pid="rs4"] .cal-foot-tweaks'), null, { timeout: 15000 });
  await sleep(1200);
  return t;
}
const foot = (page, pid) => page.evaluate(id => {
  const w = document.querySelector('.cal-card[data-pid="' + id + '"] .cal-foot-tweaks');
  if (!w) return null;
  return {
    v2: w.classList.contains('svu-foot'), html: w.outerHTML,
    corner: Array.from(w.querySelectorAll('.svu-corner')).map(b => b.textContent),
    plain: Array.from(w.querySelectorAll('.svu-num:not(.svu-corner)')).map(b => b.textContent),
    pics: w.querySelectorAll('.svu-bub').length, letters: Array.from(w.querySelectorAll('.svu-bub-av')).map(a => a.textContent),
    label: Array.from(w.querySelectorAll('.svu-bub')).map(b => b.getAttribute('aria-label')).join(' | '),
    oldOpen: (w.querySelector('.cal-comments-count') || {}).textContent || '', oldDot: !!w.querySelector('.cal-comments-dot'),
  };
}, pid);
const STAFF_WORDS = /Team Member|Fixture Owner|Fixture Reviewer|Kasper|TM\b|qa_other|qa_marquee/;

async function openNotes(t, pid) {
  await t.page.locator('.cal-card[data-pid="' + pid + '"] [data-comments-btn]').first().click();
  await t.page.locator('#calCommentsModal .cal-cm-row[data-cm-row]').first().waitFor({ timeout: 15000 });
  await sleep(900);
}
const notesRows = page => page.evaluate(() => Array.from(document.querySelectorAll('#calCommentsModal .cal-cm-row[data-cm-row]')).map(r => ({
  id: r.getAttribute('data-cm-row'), who: ((r.querySelector('.cal-cm-author') || {}).textContent || '').trim(),
  tags: Array.from(r.querySelectorAll('.svu-tag')).map(x => x.textContent), text: r.innerText.replace(/\s+/g, ' '),
  noReply: !!r.querySelector('.svu-noreply'), av: ((r.querySelector('.cal-cm-avatar') || {}).textContent || '').trim(),
})));
async function closeNotes(t) { await t.page.keyboard.press('Escape'); await sleep(700); }

async function shots(browser, origin) {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const polish of [true, false]) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const dark of [false, true]) {
        const tag = (polish ? 'on' : 'off') + '-' + w + '-' + (dark ? 'dark' : 'light');
        const t = await openClientSheet(browser, origin, { width: w, height: h, dark, polish });
        await t.page.locator('.cal-card[data-pid="rs4"]').first().scrollIntoViewIfNeeded();
        const f = t.page.locator('.cal-card[data-pid="rs3"] .cal-foot-tweaks').first();
        await f.scrollIntoViewIfNeeded();
        if (w > 800) await f.hover();
        await sleep(400);
        await t.page.screenshot({ path: path.join(SHOTS, tag + '-1-sheet.png') });
        await openNotes(t, 'rs3');
        await t.page.screenshot({ path: path.join(SHOTS, tag + '-2-notes.png') });
        await t.ctx.close();
      }
    }
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    if (SHOTS) await shots(browser, origin);
    if (ONLY) return;

    console.log('--- 1. Switch on: the Sheet carries the team\'s badges ---');
    {
      const t = await openClientSheet(browser, origin, {});
      const on = await t.page.evaluate(() => document.documentElement.classList.contains('sv-unread2'));
      expect(on, 'the client link is in the new look (html.sv-unread2)');
      const f3 = await foot(t.page, 'rs3'), f4 = await foot(t.page, 'rs4'), f5 = await foot(t.page, 'rs5'), f6 = await foot(t.page, 'rs6');
      console.log('     ' + JSON.stringify({ f3: [f3.corner, f3.plain, f3.letters, f3.label], f4: [f4.corner, f4.plain, f4.label], f5: f5.pics, f6: f6.pics }));
      expect(f3.v2 && f3.pics === 1 && f3.corner.join() === '1' && !f3.plain.length, 'post 3: one team picture with a corner count of 1 (the new statement; the team-only aside never counts; new wins over its waiting question)');
      expect(f3.letters.join() === 'S' && /^Synchro team: /.test(f3.label), 'the picture is the team\'s "S" and its label says "Synchro team" (' + f3.label + ')');
      expect(f4.v2 && f4.plain.join() === '1' && !f4.corner.length, 'post 4: a read team question with no answer is the plain number; the client\'s own change request does not count');
      expect(f5.v2 && !f5.pics, 'post 5: a question the client answered, and a statement, need nothing');
      expect(f6.v2 && !f6.pics && !f6.oldOpen && !/\d+ open/.test(f6.html), 'post 6: the client\'s own open change request shows no badge and no "N open"');
      const all = await t.page.evaluate(() => Array.from(document.querySelectorAll('.cal-foot-tweaks')).map(w => w.outerHTML).join(''));
      expect(!STAFF_WORDS.test(all), 'no staff name, initials or id on any Notes button');
      await t.page.locator('.cal-card[data-pid="rs3"] .cal-foot-tweaks').first().hover(); await sleep(300);
      const hover = await t.page.evaluate(() => (document.querySelector('.svu-pv') || {}).innerText || '');
      expect(/Synchro team/.test(hover) && /The new cut is up/.test(hover) && /Could you send the logo file/.test(hover) && !/Team-only aside/.test(hover) && !STAFF_WORDS.test(hover), 'the hover lists the team\'s new and waiting lines, as "Synchro team", without the team-only aside (' + hover.replace(/\s+/g, ' ') + ')');
      await t.page.mouse.move(5, 5);

      console.log('--- 2. Notes: the team\'s rows, "New" on what is new, read on open ---');
      await openNotes(t, 'rs3');
      const rows = await notesRows(t.page);
      console.log('     ' + JSON.stringify(rows.map(r => [r.id, r.who, r.tags, r.av])));
      expect(rows.length === 2 && !rows.some(r => r.id === 'b3'), 'the team-only aside is not in the client\'s Notes');
      expect(rows.every(r => r.who === 'Synchro team' && r.av === 'S'), 'every team note reads "Synchro team" with the "S" picture');
      expect((rows.find(r => r.id === 'b2') || {}).tags.join() === 'New' && !(rows.find(r => r.id === 'b1') || {}).tags.length, 'only the note since the last look says New');
      expect(!rows.some(r => r.noReply) && !(await t.page.locator('#calCommentsModal .svu-noreply').count()), 'no "No reply needed" for a client');
      expect(!STAFF_WORDS.test(await t.page.locator('#calCommentsModal').innerText()), 'no staff name anywhere in Notes');
      await closeNotes(t);
      const back = await foot(t.page, 'rs3');
      expect(!back.corner.length && back.plain.join() === '1', 'after reading, post 3 has nothing new; its question still waits, as the plain number (' + JSON.stringify([back.corner, back.plain]) + ')');
      await openNotes(t, 'rs4');
      const rows4 = await notesRows(t.page);
      const own = rows4.find(r => r.id === 'x2') || {};
      expect(own.who === 'You' && /Change request/.test(own.text), 'the client\'s own change request reads "You" and "Change request" (' + own.text + ')');
      await closeNotes(t);
      expect(t.inboxReads === 0, 'no Messages inbox read from the client link (' + t.inboxReads + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 3. Phone width, switch on: the same badges ---');
    {
      const t = await openClientSheet(browser, origin, { width: 390, height: 844 });
      const f3 = await foot(t.page, 'rs3'), f4 = await foot(t.page, 'rs4');
      expect(f3.v2 && f3.corner.join() === '1' && f4.plain.join() === '1', 'at 390 the corner count and the plain number show as on a wide screen');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 4. Switch off: today\'s look ---');
    {
      const t = await openClientSheet(browser, origin, { polish: false });
      const on = await t.page.evaluate(() => document.documentElement.classList.contains('sv-unread2'));
      const f4 = await foot(t.page, 'rs4'), f3 = await foot(t.page, 'rs3');
      expect(!on && !f4.v2 && !f3.v2 && !f3.pics, 'no new look and no pictures');
      expect(/1 open/.test(f4.oldOpen) && f3.oldDot, 'today\'s "1 open" and the new-replies dot are there (' + f4.oldOpen + ', dot ' + f3.oldDot + ')');
      await openNotes(t, 'rs4');
      const rows4 = await notesRows(t.page);
      expect(rows4.length === 2 && !rows4.some(r => r.tags.length) && (rows4.find(r => r.id === 'x2') || {}).who === CLIENT, 'today\'s Notes: no New tags, the client by its own name');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 5. The staff Calendar follows the staff badges, not the client switch ---');
    {
      const t = await open(browser, origin, { stage: 'client', staff: STAFF, flags: 'on', polish: true, collab: true, finished: true });
      seedNotes(t.state);
      await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && document.querySelector('.cal-card[data-pid="rs4"] .cal-foot-tweaks'), null, { timeout: 30000 });
      await sleep(1200);
      const on = await t.page.evaluate(() => document.documentElement.classList.contains('sv-unread2'));
      const f4 = await foot(t.page, 'rs4');
      // Since 2026-10-29 (session Permafive) every signed-in staff member has the staff badges, with no switch row read:
      // the staff Calendar shows them whatever review_client_polish says.
      expect(on && f4.v2, 'a staff member has the staff badges with no switch row, whatever review_client_polish says (' + (f4 && f4.html || '').slice(0, 200) + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nclient-unread-badges-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nclient-unread-badges-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
