'use strict';
/*
 * THE CLIENT REVIEW PAGE'S NOTES BADGES, behind review_client_polish (session Porch, round 3, 2026-10-25; the staff
 * side's round 8, session Beacon). Real browser, fully offline, the shared mocked backend of the review-stage tests
 * (fictional client, cards, people and conversation).
 *
 * What the client has read is this browser's own mark (syncview_notes_seen_v1: a last-seen time per post), never the
 * staff's marks. On each post in the strip, one picture per person from the team:
 *   - something new since the client last looked: the picture with a small count on its corner;
 *   - read but still waiting for the client's answer (a team comment that asks something, with the last word in its
 *     thread; owner, 2026-10-25): the plain number. A note that asks nothing never waits;
 *   - never both (new wins), and nothing on the post that is on screen.
 * Opening a post marks its notes read (its badge goes) and its new messages carry a quiet "New".
 * Switch off: no badges. SHOTS=<dir> writes the PR screenshots (light and dark, 1440 and 390 wide).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.SHOTS_ONLY === '1';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const N = (id, body, at, extra) => Object.assign({ id, parent_id: null, author: 'Team Member', role: 'smm', is_tweak: false, audience: 'client', body, created_at: at, updated_at: at, done: false, done_at: '', done_by: '' }, extra || {});
async function openClient(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'client', flags: 'on', polish: true }, o));
  // Post 2: an older team question (read) and a new note since. Post 3: a read team question, unanswered.
  // Post 4: a read team question the client already answered under it. Post 5: a read team note that asks nothing.
  t.state.cards[1].video_tweaks = JSON.stringify([N('b1', 'Could you send the logo file?', '2026-10-13T09:00:00.000Z'), N('b2', 'The new cut is up.', '2026-10-20T09:00:00.000Z')]);
  t.state.cards[2].video_tweaks = JSON.stringify([N('x1', 'Which colour do you prefer?', '2026-10-01T09:00:00.000Z')]);
  t.state.cards[3].video_tweaks = JSON.stringify([N('y1', 'Morning or evening post?', '2026-10-01T09:00:00.000Z'), N('y2', 'Evening, please.', '2026-10-02T09:00:00.000Z', { role: 'client', author: CLIENT, parent_id: 'y1' })]);
  t.state.cards[4].video_tweaks = JSON.stringify([N('z1', 'New cut uploaded. The intro is two seconds shorter.', '2026-10-01T09:00:00.000Z')]);
  await t.page.addInitScript(() => { try { if (!sessionStorage.getItem('fx-seeded')) { sessionStorage.setItem('fx-seeded', '1'); localStorage.setItem('syncview_notes_seen_v1', JSON.stringify({ rs2: '2026-10-15T00:00:00.000Z', rs3: '2026-10-05T00:00:00.000Z', rs4: '2026-10-05T00:00:00.000Z', rs5: '2026-10-05T00:00:00.000Z' })); } } catch (e) {} });
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1500);
  return t;
}
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
const chips = (page) => R(page, (r) => Array.from(r.querySelectorAll('.chipp[data-id]')).map(c => ({ id: c.dataset.id, cur: c.classList.contains('cur'), corner: Array.from(c.querySelectorAll('.cpb-c')).map(b => b.textContent), plain: Array.from(c.querySelectorAll('.cpb-n:not(.cpb-c)')).map(b => b.textContent), pics: c.querySelectorAll('.cpb .cpm-av').length, title: c.getAttribute('title') })));

async function shots(browser, origin) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const polish = process.env.POLISH !== '0';
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const dark of [false, true]) {
      const t = await openClient(browser, origin, { width: w, height: h, dark, polish, thread: true });
      await t.page.screenshot({ path: path.join(SHOTS, (polish ? 'after' : 'before') + '-badges-1-strip-' + w + '-' + (dark ? 'dark' : 'light') + '.png') });
      if (polish && w > 800) {
        await inS(t.page, '.chipp[data-id="rs2"]').click(); await sleep(900);
        await t.page.screenshot({ path: path.join(SHOTS, 'after-badges-2-opened-' + w + '-' + (dark ? 'dark' : 'light') + '.png') });
      }
      await t.ctx.close();
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

    console.log('--- 1. The strip: new is a corner count, waiting is the plain number, never both ---');
    {
      const t = await openClient(browser, origin, { thread: true });
      const c = await chips(t.page), by = id => c.find(x => x.id === id) || {};
      console.log('     ' + JSON.stringify(c.filter(x => x.pics)));
      expect(by('rs1').cur && !by('rs1').pics, 'the post on screen carries no badge');
      expect(by('rs2').corner.join() === '1' && !by('rs2').plain.length && by('rs2').pics === 1, 'post 2: one new note is the picture with a corner count, and nothing else (new wins over its waiting question)');
      expect(by('rs3').plain.join() === '1' && !by('rs3').corner.length, 'post 3: a read team question with no answer is the plain number');
      expect(!by('rs4').pics, 'post 4: a question the client answered under it needs nothing');
      expect(!by('rs5').pics, 'post 5: a read team note that asks nothing never waits (owner, 2026-10-25: only a question counts)');
      expect(/1 new/.test(by('rs2').title || '') && /waiting for your answer/.test(by('rs3').title || ''), 'the hover says what each counts (' + by('rs2').title + ' / ' + by('rs3').title + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');

      console.log('--- 2. Opening a post marks it read; its new note says New ---');
      await inS(t.page, '.chipp[data-id="rs2"]').click(); await sleep(900);
      const fresh = await R(t.page, (r) => Array.from(r.querySelectorAll('#chat .cpm-k.new')).map(e => e.closest('.cpm').innerText.replace(/\s+/g, ' ')));
      expect(fresh.length === 1 && /The new cut is up/.test(fresh[0]), 'only the note since the last look says New (' + fresh.join(' | ') + ')');
      const seen = await t.page.evaluate(() => JSON.parse(localStorage.getItem('syncview_notes_seen_v1') || '{}'));
      expect(Date.parse(seen.rs2) > Date.parse('2026-10-24T00:00:00Z'), 'this browser now marks post 2 read (' + seen.rs2 + ')');
      await inS(t.page, '.chipp[data-id="rs3"]').click(); await sleep(900);
      const back = (await chips(t.page)).find(x => x.id === 'rs2');
      expect(!back.corner.length && back.plain.join() === '1', 'back in the strip, post 2 has nothing new; only its question waits, as the plain number (the statement does not) (' + JSON.stringify(back) + ')');
      await t.ctx.close();
    }

    console.log('--- 3. Switch off: no badges ---');
    {
      const t = await openClient(browser, origin, { polish: false, thread: true });
      const c = await chips(t.page);
      expect(!c.some(x => x.pics) && !(await inS(t.page, '.cpm-k.new').count()), 'no pictures, no counts, no New');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-client-badges-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-client-badges-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
