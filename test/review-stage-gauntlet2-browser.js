'use strict';
/*
 * CLIENT REVIEW GAUNTLET 2 (session Gauntlet Client 2, 2026-10-18): five things a client could hit on the live page.
 *
 *   1. The post on stage leaves the list (the team archives it) while the client has words typed. The title changed
 *      silently and "Send comment" put the words on a post nobody had chosen. Now the page says which post it was
 *      and which one it is now, and that the words are still in the box.
 *   2. Words typed and not sent were emptied from the box when the client opened another post. Now they wait for
 *      that post and come back with it (and with the part they were picked for).
 *   3. A long caption ran over the card's "N characters" line and out of the card. Now the caption scrolls inside
 *      the card and the line stays under it.
 *   4. Escape closed the Notes box only while its message box had focus, and never closed the "not saved" box.
 *      Now it closes whatever sits on top from a button, the player, or nowhere.
 *   5. The arrow keys changed the part only while focus was inside the page. Now they work from anywhere on it
 *      (not while a field, a dialog or the full screen player has the keys).
 * Fails on main for each. Fully offline (the review-stage fixture).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const title = t => inS(t.page, '#side').textContent().catch(() => '');
async function section(name, fn) { try { await fn(); } catch (e) { failures.push(name + ' threw: ' + String(e.message).split('\n')[0]); console.error('FAIL  ' + name + ' threw: ' + String(e.message).split('\n')[0]); } }
const refresh = async (t) => { await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true })); await sleep(1500); };

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await section('1', async () => {
      // 1. the post on stage leaves the list while words are typed
      console.log('--- the post on stage leaves the list; the client has typed words ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      expect(/first second/.test(await title(t)), '1: the first post is on stage');
      await inS(t.page, '#ta').fill('Words about the first post');
      const gone = t.state.cards.find(c => c.id === 'rs1'); gone.client = 'not-this-client'; gone.updated_at = new Date().toISOString();
      await refresh(t);
      await t.page.mouse.click(5, 5); await sleep(1200);   // leaving the box lets the page draw the post now on stage
      const now = await title(t);
      expect(!/first second/.test(now), '1: another post is on stage now (' + now.slice(0, 40) + ')');
      const note = await inS(t.page, '#elsew').textContent().catch(() => '');
      expect(/Why the first second matters/.test(note) && /no longer on your list/.test(note), '1: the page names the post that left (' + note.slice(0, 120) + ')');
      expect(/words are still in the box/.test(note), '1: and says the words are still in the box');
      expect(/Words about the first post/.test(await inS(t.page, '#ta').inputValue().catch(() => '')), '1: the words are in the box');
      const nextId = await inS(t.page, '#skList .chipp.cur').getAttribute('data-id').catch(() => '');
      await t.page.evaluate(() => {});
      await inS(t.page, '#cmtBtn').click(); await sleep(1500);
      const sentOn = t.state.upserts.filter(u => JSON.stringify(u).includes('Words about the first post')).map(u => u.id);
      expect(sentOn.length > 0 && sentOn.every(id => id === nextId), '1: if sent, the words go on the post shown (' + sentOn.join(',') + ' vs ' + nextId + ')');
      expect(!await inS(t.page, '#elsew').count(), '1: the notice is gone once the words are sent');
      expect(!t.errors.length, '1: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
    await section('1b', async () => {
      // 1b. the list is empty for a moment (or everything was finished) and a post comes back: no "left your list" notice
      console.log('--- an empty list and then a post: no false notice ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      const mine = t.state.cards.map(c => [c, c.client]);
      mine.forEach(([c]) => { c.client = 'not-this-client'; c.updated_at = new Date().toISOString(); });
      await refresh(t);
      mine.forEach(([c, cl]) => { c.client = cl; c.updated_at = new Date().toISOString(); });
      await refresh(t); await sleep(600);
      expect(!await inS(t.page, '#elsew').count(), '1b: a post coming back to an empty list is not announced as one that left');
      expect(!t.errors.length, '1b: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
    await section('2', async () => {
      // 2. words are kept for each post
      console.log('--- words typed on one post wait while another is open ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      await inS(t.page, '#ta').fill('Draft for the first post');
      await inS(t.page, '[data-pc]').first().click();
      const part = await inS(t.page, '[data-pc][aria-pressed="true"]').getAttribute('data-pc').catch(() => '');
      await inS(t.page, '#skList .chipp:not(.cur)').first().click(); await sleep(900);
      expect((await inS(t.page, '#ta').inputValue().catch(() => 'x')) === '', '2: the other post opens with an empty box');
      await inS(t.page, '#ta').fill('Draft for the second post');
      await inS(t.page, '#skList .chipp').first().click(); await sleep(900);
      expect((await inS(t.page, '#ta').inputValue().catch(() => '')) === 'Draft for the first post', '2: back on the first post the words are there');
      expect((await inS(t.page, '[data-pc][aria-pressed="true"]').getAttribute('data-pc').catch(() => '')) === part && !!part, '2: and the part they were picked for (' + part + ')');
      await inS(t.page, '#skList .chipp:not(.cur)').first().click(); await sleep(900);
      expect((await inS(t.page, '#ta').inputValue().catch(() => '')) === 'Draft for the second post', '2: the second post kept its own words');
      // sending clears the draft for good
      await inS(t.page, '#cmtBtn').click(); await sleep(1200);
      await inS(t.page, '#skList .chipp').first().click(); await sleep(700);
      await inS(t.page, '#skList .chipp:not(.cur)').first().click(); await sleep(900);
      expect((await inS(t.page, '#ta').inputValue().catch(() => 'x')) === '', '2: words that were sent do not come back');
      expect(!t.errors.length, '2: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
    await section('2b', async () => {
      // 2b. words for an approved part ("Change my mind") keep that part when the client comes back to the post, and
      //     words for a waiting part that gets approved elsewhere meanwhile go to the team as a note on that part
      console.log('--- kept words keep their part, approved or answered meanwhile ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      await inS(t.page, '#skList .chipp[data-id="rs2"]').click(); await sleep(900);
      const steps = await t.page.evaluate(() => [...document.getElementById('svReviewStage').shadowRoot.querySelectorAll('.stp[data-step]')].map(b => b.dataset.step));
      let okKey = '';
      for (const k of steps) { await inS(t.page, '.stp[data-step="' + k + '"]').click(); await sleep(400); if (await inS(t.page, '[data-again]').count()) { okKey = k; break; } }
      expect(!!okKey, '2b: the approved part shows Change my mind (' + okKey + ')');
      await inS(t.page, '[data-again]').first().click(); await sleep(400);
      await inS(t.page, '#ta').fill('Second thoughts on this part');
      await inS(t.page, '#skList .chipp[data-id="rs1"]').click(); await sleep(900);
      await inS(t.page, '#skList .chipp[data-id="rs2"]').click(); await sleep(900);
      expect((await inS(t.page, '#ta').inputValue().catch(() => '')) === 'Second thoughts on this part', '2b: the words came back');
      expect((await inS(t.page, '[data-pc][aria-pressed="true"]').getAttribute('data-pc').catch(() => '')) === okKey, '2b: still on the approved part they were about');
      // a waiting part picked, then approved elsewhere while the client is on another post
      await inS(t.page, '#ta').fill('');
      await inS(t.page, '#skList .chipp[data-id="rs3"]').click(); await sleep(900);
      const wKey = await inS(t.page, '[data-pc]').first().getAttribute('data-pc');
      await inS(t.page, '[data-pc]').first().click(); await sleep(300);
      await inS(t.page, '#ta').fill('Words for a part that gets approved meanwhile');
      await inS(t.page, '#skList .chipp[data-id="rs1"]').click(); await sleep(900);
      const c3 = t.state.cards.find(c => c.id === 'rs3'); const col = { video: 'video_status', graphic: 'graphic_status', thumbnail: 'graphic_status', thumb: 'graphic_status', caption: 'caption_status' }[wKey];
      expect(!!col, '2b: the waiting part is a known column (' + wKey + ')');
      if (col) { c3[col] = 'Approved'; c3.updated_at = new Date().toISOString(); }
      await refresh(t);
      await inS(t.page, '#skList .chipp[data-id="rs3"]').click(); await sleep(900);
      expect((await inS(t.page, '[data-pc][aria-pressed="true"]').getAttribute('data-pc').catch(() => '')) === wKey, '2b: the words still name their part after it was approved elsewhere');
      const n0 = t.state.upserts.length;
      await inS(t.page, (await inS(t.page, '#sendBtn').count()) ? '#sendBtn' : '#cmtBtn').click(); await sleep(1500);
      expect(!t.state.upserts.slice(n0).some(u => u[col] === 'Tweaks Needed'), '2b: no change request reopens the part approved meanwhile');
      expect(t.state.cards.find(c => c.id === 'rs3')[col] === 'Approved', '2b: it stays approved');
      const noteOn = await t.page.evaluate(k => { const p = calState.posts.find(x => x.id === 'rs3'); return JSON.stringify(p[k + '_tweaks'] || ''); }, wKey);
      expect(/approved meanwhile/.test(noteOn), '2b: the words are a note on that part (' + wKey + ')');
      expect(!t.errors.length, '2b: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
    await section('3', async () => {
      // 3. a long caption scrolls inside its card
      console.log('--- a long caption ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      const long = ('A long caption line with a few words in it. ').repeat(45) + '\n\nThe very last line.';
      const row = t.state.cards.find(c => c.id === 'rs1'); row.caption = long; row.video_status = 'Approved'; row.graphic_status = 'Approved'; row.updated_at = new Date().toISOString();
      await refresh(t);
      await inS(t.page, '.stp[data-step="caption"]').click(); await sleep(900);
      const g = await t.page.evaluate(() => {
        const r = document.getElementById('svReviewStage').shadowRoot, main = r.querySelector('.tc-main'), foot = r.querySelector('.tc-foot'), card = r.getElementById('tcard');
        const mb = main.getBoundingClientRect(), fb = foot.getBoundingClientRect(), cb = card.getBoundingClientRect();
        const oy = getComputedStyle(main).overflowY;
        main.scrollTop = main.scrollHeight;
        const txt = r.querySelector('.tc-text').getBoundingClientRect();
        return { scrolls: main.scrollHeight > main.clientHeight + 2 && (oy === 'auto' || oy === 'scroll'), footBelowText: fb.top >= mb.bottom - 1, footInCard: fb.bottom <= cb.bottom + 1, lastLineReachable: txt.bottom <= mb.bottom + 2 };
      });
      expect(g.scrolls, '3: the caption scrolls inside its card');
      expect(g.footBelowText, '3: the characters line stays under the caption (no overlap)');
      expect(g.footInCard, '3: and inside the card');
      expect(g.lastLineReachable, '3: the last line can be scrolled into view');
      expect(!t.errors.length, '3: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
    await section('4', async () => {
      // 4. Escape from anywhere
      console.log('--- Escape closes the box on top ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      await t.page.evaluate(() => openCalComments('rs1')); await sleep(900);
      const isOpen = () => t.page.evaluate(() => document.getElementById('calCommentsOverlay').classList.contains('open'));
      expect(await isOpen(), '4: the Notes box is open');
      await t.page.evaluate(() => { const b = document.querySelector('#calCommentsOverlay .cal-comments-close'); b.focus(); });
      await t.page.keyboard.press('Escape'); await sleep(500);
      expect(!(await isOpen()), '4: Escape closes it while a button has focus');
      await t.page.evaluate(() => openCalComments('rs1')); await sleep(700);
      await t.page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
      await t.page.keyboard.press('Escape'); await sleep(500);
      expect(!(await isOpen()), '4: Escape closes it with nothing focused');
      await t.page.evaluate(() => showNotify('Your approval was not saved', 'It was refused.')); await sleep(300);
      const noticeUp = () => t.page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active'));
      expect(await noticeUp(), '4: a notice is up');
      await t.page.keyboard.press('Escape'); await sleep(400);
      expect(!(await noticeUp()), '4: Escape closes the notice');
      await t.page.evaluate(() => openCalComments('rs1')); await sleep(700);
      await t.page.evaluate(() => { document.querySelector('#calCommentsOverlay .cal-comments-close').focus(); showNotify('Not saved', 'Refused.'); }); await sleep(300);
      await t.page.keyboard.press('Escape'); await sleep(400);
      expect(!(await noticeUp()) && await isOpen(), '4: with both open, Escape closes the notice first and the Notes box stays');
      await t.page.keyboard.press('Escape'); await sleep(400);
      expect(!(await isOpen()), '4: a second Escape closes the Notes box');
      expect(!t.errors.length, '4: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
    await section('4b', async () => {
      // 4b. with the review page's switch off the old client page keeps its old Escape rules (nothing changes there)
      console.log('--- switch off: the old page is left as it was ---');
      let t = await openClient(browser, origin, { flags: 'off' });
      await sleep(3500);
      await t.page.evaluate(() => openCalComments('rs1')); await sleep(900);
      await t.page.evaluate(() => document.querySelector('#calCommentsOverlay .cal-comments-close').focus());
      await t.page.keyboard.press('Escape'); await sleep(500);
      expect(await t.page.evaluate(() => document.getElementById('calCommentsOverlay').classList.contains('open')), '4b: Escape from a button does not close the Notes box on the old page');
      expect(!t.errors.length, '4b: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
    await section('5', async () => {
      // 5. arrow keys from anywhere on the page
      console.log('--- arrow keys with nothing focused ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      const step = () => inS(t.page, '.stp.on').getAttribute('data-step').catch(() => '');
      const s0 = await step();
      await t.page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
      await t.page.keyboard.press('ArrowRight'); await sleep(600);
      const s1 = await step();
      expect(s1 && s1 !== s0, '5: Right arrow with nothing focused moves to the next part (' + s0 + ' to ' + s1 + ')');
      await t.page.keyboard.press('ArrowLeft'); await sleep(600);
      expect((await step()) === s0, '5: Left arrow comes back');
      await inS(t.page, '#ta').click();
      const s2 = await step();
      await t.page.keyboard.press('ArrowRight'); await sleep(500);
      expect((await step()) === s2, '5: inside the message box the arrows only move the cursor');
      await t.page.evaluate(() => openCalComments('rs1')); await sleep(700);
      await t.page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
      await t.page.keyboard.press('ArrowRight'); await sleep(500);
      expect((await step()) === s2, '5: with a dialog open the arrows leave the page behind it alone');
      expect(!t.errors.length, '5: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
