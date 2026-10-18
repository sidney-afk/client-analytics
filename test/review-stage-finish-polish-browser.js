'use strict';
/*
 * CLIENT REVIEW PAGE, SIX FINISHING TOUCHES (session Rail, 2026-10-18; the notes of client gauntlet 2).
 *   1. Finish reviewing stays off, with a short "Saving...", while any part's answer is still being sent.
 *   2. The "Your approval was not saved" box speaks plain words: no "Linear issue", no raw code.
 *   3. The speed button stays on the review page's vertical player at desktop sizes (1440, 1280, 1024); a phone (390)
 *      keeps Full screen and drops the speed button.
 *   4. The client link opens on Review every time it is opened fresh, whatever tab was used last; Back and Forward
 *      between tabs inside a visit keep working.
 *   5. Client Month and Week: a post's thumbnail opens the in-app viewer (video left, notes right); a post with no
 *      video opens nothing and raises no error.
 *   6. Unsent change-request words (and the part) survive a reload, are cleared when sent, when the post leaves the
 *      list, after 7 days; the page works with storage blocked.
 * Fully offline (the review-stage fixture). Fails on the commit before this one for each item.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, openClient, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function section(name, fn) { try { await fn(); } catch (e) { failures.push(name + ' threw: ' + String(e.message).split('\n')[0]); console.error('FAIL  ' + name + ' threw: ' + String(e.message).split('\n')[0]); } }
const fin = t => t.page.evaluate(() => { const b = document.getElementById('svReviewStage').shadowRoot.getElementById('finishBtn'); return b ? { disabled: b.disabled, text: b.textContent.replace(/\s+/g, ' ').trim(), ready: b.classList.contains('ready') } : null; });
const shown = (t, sel) => t.page.evaluate(s => { const e = document.getElementById('svReviewStage').shadowRoot.querySelector(s); if (!e) return 0; const b = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && b.width > 0 ? Math.round(b.width) : 0; }, sel);
const storeKey = 'syncview_rs_drafts_v1:' + CLIENT.toLowerCase();
const stored = t => t.page.evaluate(k => { try { return localStorage.getItem(k); } catch (e) { return 'blocked'; } }, storeKey);
const reload = async t => { await t.page.reload({ waitUntil: 'domcontentloaded' }); await waitNew(t); await sleep(900); };

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await section('1', async () => {
      console.log('--- 1. Finish reviewing waits while an answer is sent ---');
      const t = await openClient(browser, origin, { flags: 'on' });
      t.state.cards[0].graphic_status = 'Approved'; t.state.cards[0].caption_status = 'Approved';
      await waitNew(t); await sleep(800);
      t.state.writeDelay = 2500;
      await inS(t.page, '[data-ok="video"]').click();
      await sleep(600);
      let f = await fin(t);
      expect(f && f.disabled && /Saving/.test(f.text) && !f.ready, '1: while the answer is sent Finish is off and says Saving (' + JSON.stringify(f) + ')');
      await inS(t.page, '#finishBtn').click({ force: true }).catch(() => {});
      await sleep(300);
      expect(/first second/.test(await inS(t.page, '#side').textContent()), '1: pressing it then does nothing');
      await sleep(3200);
      f = await fin(t);
      expect(f && !f.disabled && f.ready && !/Saving/.test(f.text), '1: when the save lands Finish lights up (' + JSON.stringify(f) + ')');
      expect(t.state.upserts.length > 0, '1: and the answer reached the server');
      expect(!t.errors.length, '1: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });

    await section('2', async () => {
      console.log('--- 2. The not-saved box in plain words ---');
      const t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      // A card with no work item behind it: the gateway refuses with native_link_required
      const row = t.state.cards[0]; row.video_deliverable_id = ''; row.linear_issue_id = 'LIN-1';
      await t.page.evaluate(() => { const c = calState.posts.find(p => p.id === 'rs1'); if (c) { c.video_deliverable_id = ''; c.linear_issue_id = 'LIN-1'; } });
      await inS(t.page, '[data-ok="video"]').click();
      await sleep(2500);
      const box = await t.page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active') ? document.getElementById('confirmTitle').textContent + ' | ' + document.getElementById('confirmMsg').textContent : '');
      expect(/Your approval was not saved/.test(box), '2: the box "Your approval was not saved" is up (' + box.slice(0, 80) + ')');
      const stage = await inS(t.page, '#dec, .err').allTextContents().catch(() => []);
      const all = (box + ' | ' + stage.join(' | ')).replace(/\s+/g, ' ');
      console.log('     (client sees: ' + all.slice(0, 260) + ')');
      expect(!/Linear|native_link_required|work item|code:/i.test(all), '2: no developer words and no raw code reach the client');
      if (/not saved|not ready/i.test(all)) expect(/not ready for approval yet/.test(all), '2: it says the post is not ready for approval yet');
      expect(!t.errors.length, '2: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });

    await section('3', async () => {
      console.log('--- 3. The speed button on the vertical player ---');
      for (const [w, h, wantRate] of [[1440, 900, true], [1280, 800, true], [1024, 768, true], [390, 844, false]]) {
        const t = await openClient(browser, origin, { flags: 'on', width: w, height: h });
        await waitNew(t);
        await t.page.waitForFunction(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('.fv-player .fv-full'), null, { timeout: 15000 });
        await sleep(1200);
        const pw = await shown(t, '.fv-player');
        const g = await t.page.evaluate(() => {
          const r = document.getElementById('svReviewStage').shadowRoot, pl = r.querySelector('.fv-player').getBoundingClientRect();
          const vis = ['.fv-rate', '.fv-back', '.fv-play', '.fv-fwd', '.fv-mute', '.fv-full'].map(s => { const e = r.querySelector(s); const b = e.getBoundingClientRect(); return { s, shown: getComputedStyle(e).display !== 'none' && b.width > 0, l: b.left, r: b.right }; }).filter(x => x.shown);
          const overlap = vis.some((a, i) => vis.some((b, j) => j > i && a.l < b.r - 1 && b.l < a.r - 1));
          return { fits: vis.every(x => x.l >= pl.left - 1 && x.r <= pl.right + 1), overlap };
        });
        console.log('     (' + w + ': player ' + pw + ' px)');
        expect((await shown(t, '.fv-rate') > 0) === wantRate, w + ': the speed button is ' + (wantRate ? 'shown' : 'hidden'));
        expect(await shown(t, '.fv-full') > 0, w + ': Full screen is there');
        expect(await shown(t, '.fv-play') === 44, w + ': the play button keeps its size');
        expect(g.fits && !g.overlap, w + ': the controls fit inside the player without overlapping (' + JSON.stringify(g) + ')');
        expect(!t.errors.length, w + ': no page errors (' + t.errors.join(' | ') + ')');
        await t.ctx.close();
      }
    });

    await section('4', async () => {
      console.log('--- 4. The link opens on Review ---');
      const t = await openClient(browser, origin, { flags: 'on', finished: true });
      await waitNew(t); await sleep(700);
      await inS(t.page, '#rsTabs [data-tab="month"]').click(); await sleep(900);
      expect(await t.page.evaluate(() => calState.view) === 'month', '4: Month is open and remembered');
      await t.page.goto(t.page.url(), { waitUntil: 'domcontentloaded' });   // opened fresh again
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await sleep(900);
      expect(await t.page.evaluate(() => calState.view) === 'review', '4: opened fresh it is on Review, not on Month (' + await t.page.evaluate(() => calState.view) + ')');
      await waitNew(t);
      const url = t.page.url();
      await inS(t.page, '#rsTabs [data-tab="organizer"]').click(); await sleep(700);
      await inS(t.page, '#rsTabs [data-tab="month"]').click(); await sleep(700);
      await t.page.goBack(); await sleep(700);
      expect(t.page.url() === url && await t.page.evaluate(() => calState.view) === 'organizer', '4: Back goes to Sheet inside the visit');
      await t.page.goBack(); await sleep(700);
      expect(await t.page.evaluate(() => calState.view) === 'review', '4: Back again goes to Review');
      await t.page.goForward(); await sleep(700);
      expect(await t.page.evaluate(() => calState.view) === 'organizer', '4: Forward comes back to Sheet');
      expect(!t.errors.length, '4: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });

    await section('5', async () => {
      console.log('--- 5. Month and Week thumbnails open the viewer ---');
      const t = await openClient(browser, origin, { flags: 'on', finished: true });
      await waitNew(t); await sleep(600);
      // one post with no video, dated on the same days Month and Week show
      const novid = t.state.cards.find(c => c.id === 'rf3'); novid.asset_url = ''; novid.updated_at = new Date().toISOString();
      await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true })); await sleep(1500);
      const viewerOpen = () => t.page.evaluate(() => !!document.querySelector('#calNotesStage .fv-player') && document.getElementById('calCommentsOverlay').classList.contains('open'));
      const previewOpen = () => t.page.evaluate(() => { const o = document.getElementById('calPreviewOverlay'); return !!o && /open|active|show/.test(o.className) ; });
      for (const tab of ['month', 'week']) {
        await t.page.evaluate(x => { onCalViewChange(x); }, tab);
        await t.page.evaluate(() => { calState.monthCursor = '2026-10-01'; calState.weekCursor = '2026-10-12'; _calRenderBody(); });
        await sleep(900);
        const sel = tab === 'month' ? '.cal-month-pill' : '.cal-week-card';
        const thumbOf = name => t.page.locator(sel, { hasText: name }).first().locator(tab === 'month' ? '.cal-month-pill-thumb' : '.cal-week-card-thumb');
        await thumbOf('Behind the scenes').click(); await sleep(1800);
        expect(await viewerOpen(), tab + ': the thumbnail opens the viewer with the player');
        expect(!await previewOpen(), tab + ': and not the small preview behind it');
        await t.page.keyboard.press('Escape'); await sleep(900);
        expect(!await viewerOpen(), tab + ': Escape closes it');
        await t.page.locator(sel, { hasText: 'Behind the scenes' }).first().focus();
        await t.page.keyboard.press('Enter'); await sleep(1800);
        expect(await viewerOpen() && !await previewOpen(), tab + ': Enter on the post (no pointer) opens the viewer too');
        await t.page.keyboard.press('Escape'); await sleep(900);
        const before = t.errors.length;
        await thumbOf('Monday reset').click(); await sleep(1200);
        expect(!await viewerOpen() && !await previewOpen(), tab + ': a post with no video opens nothing');
        expect(t.errors.length === before, tab + ': and raises no error');
      }
      expect(!t.errors.length, '5: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });

    await section('6', async () => {
      console.log('--- 6. Unsent words survive a reload ---');
      let t = await openClient(browser, origin, { flags: 'on' });
      await waitNew(t); await sleep(800);
      await inS(t.page, '[data-pc]').first().click();
      const part = await inS(t.page, '[data-pc][aria-pressed="true"]').getAttribute('data-pc');
      await inS(t.page, '#ta').fill('Words that must survive a reload');
      const raw = await stored(t);
      expect(raw && /survive a reload/.test(raw) && !/fixture-review-stage-token/.test(raw), '6: the words are kept in this browser, with no link token in them');
      await reload(t);
      expect(await inS(t.page, '#ta').inputValue().catch(() => '') === 'Words that must survive a reload', '6: after a reload the words are in the box');
      expect(await inS(t.page, '[data-pc][aria-pressed="true"]').getAttribute('data-pc').catch(() => '') === part, '6: and the part they are about (' + part + ')');
      // sending clears them for good
      await inS(t.page, '#sendBtn').click(); await sleep(1500);
      expect(!(await stored(t)), '6: once sent they are removed from storage');
      await reload(t);
      expect(await inS(t.page, '#ta').inputValue().catch(() => 'x') === '', '6: and do not come back');
      // words on another post come back on that post
      await inS(t.page, '#skList .chipp:not(.cur)').first().click(); await sleep(900);
      const otherId = await inS(t.page, '#skList .chipp.cur').getAttribute('data-id');
      await inS(t.page, '#ta').fill('Words on the second post');
      await reload(t);
      expect(await inS(t.page, '#skList .chipp.cur').getAttribute('data-id') === otherId && await inS(t.page, '#ta').inputValue() === 'Words on the second post', '6: after a reload the post with kept words is the one on stage');
      // the post leaves the list: its words are cleared
      const gone = t.state.cards.find(c => c.id === otherId); gone.client = 'not-this-client'; gone.updated_at = new Date().toISOString();
      await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true })); await sleep(1500);
      await t.page.mouse.click(5, 5); await sleep(1200);
      await reload(t);
      // (the words stay in the box and go on the post now on stage, as before; nothing stays kept for the post that left)
      const left = JSON.parse(await stored(t) || '{}');
      expect(!Object.prototype.hasOwnProperty.call(left, otherId), '6: words kept for a post that left the list are cleared (' + Object.keys(left).join(',') + ')');
      // seven days
      await t.page.evaluate(([k, id]) => { localStorage.setItem(k, JSON.stringify({ [id]: { text: 'Old words', part: null, vis: 'team', at: Date.now() - 8 * 86400000 } })); }, [storeKey, 'rs1']);
      await reload(t);
      expect(await inS(t.page, '#ta').inputValue().catch(() => 'x') === '', '6: words older than 7 days are not restored');
      expect(!(await stored(t)), '6: and they are removed from storage, not just hidden');
      await t.page.evaluate(([k, id]) => { localStorage.setItem(k, JSON.stringify({ [id]: { text: 'Fresh words', part: null, vis: 'team', at: Date.now() - 6 * 86400000 } })); }, [storeKey, 'rs1']);
      await reload(t);
      expect(await inS(t.page, '#ta').inputValue().catch(() => '') === 'Fresh words', '6: words under 7 days old are restored');
      // words about an approved part ("Change my mind") come back about that part
      t.state.cards[0].graphic_status = 'Approved'; t.state.cards[0].updated_at = new Date().toISOString();
      await t.page.evaluate(([k, id]) => { localStorage.setItem(k, JSON.stringify({ [id]: { text: 'Reopen the thumbnail', part: 'graphic', vis: 'team', at: Date.now() } })); }, [storeKey, 'rs1']);
      await reload(t);
      const chip = await inS(t.page, '#compose').evaluate(e => e.className + ' | ' + e.textContent).catch(() => '');
      expect(await inS(t.page, '#ta').inputValue().catch(() => '') === 'Reopen the thumbnail' && /\bchg\b/.test(chip) && /reopen it/.test(chip), '6: words about an approved part come back about that part (' + chip.replace(/\s+/g, ' ').slice(0, 60) + ')');
      expect(!t.errors.length, '6: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();

      console.log('--- 6b. With browser storage blocked ---');
      t = await openClient(browser, origin, { flags: 'on' });
      await t.page.addInitScript(() => {
        const boom = () => { throw new Error('storage blocked'); };
        const real = Storage.prototype;
        const get = real.getItem, set = real.setItem, rem = real.removeItem;
        real.getItem = function (k) { if (/syncview_rs_drafts_v1/.test(k)) boom(); return get.call(this, k); };
        real.setItem = function (k, v) { if (/syncview_rs_drafts_v1/.test(k)) boom(); return set.call(this, k, v); };
        real.removeItem = function (k) { if (/syncview_rs_drafts_v1/.test(k)) boom(); return rem.call(this, k); };
      });
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await waitNew(t); await sleep(800);
      await inS(t.page, '#ta').fill('Typed with storage blocked');
      await inS(t.page, '#skList .chipp:not(.cur)').first().click(); await sleep(900);
      await inS(t.page, '#skList .chipp').first().click(); await sleep(900);
      expect(await inS(t.page, '#ta').inputValue() === 'Typed with storage blocked', '6b: the page still works and keeps the words while it stays open');
      await inS(t.page, '#cmtBtn').click(); await sleep(1200);
      expect(t.state.upserts.some(u => JSON.stringify(u).includes('Typed with storage blocked')), '6b: and sending still works');
      expect(!t.errors.length, '6b: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    });
  } finally {
    await browser.close(); server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
