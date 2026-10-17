'use strict';
/*
 * OWNER FEEDBACK OF 2026-10-17 23:20 UTC (session Curtain Seven). Real browser, fully offline, the shared mocked
 * backend of review-stage-browser.js (fictional client, cards and people).
 *
 * The new review page (switches on), Kasper's tab:
 *   1. no "Kasper" title and no "Updated 5:03 PM" line;
 *   2. his tabs are Review Session and Messages; Filming Plans is in More and still opens from there;
 *   3. the strip opens with a small list button (the count as a badge), no "9 to review" or section labels; it opens
 *      a list of his sections (Urgent, Waiting for your review, With the editors with Ping editor); a row opens that
 *      post on the stage; Escape closes the list;
 *   4. the post heading is one row, "Client · Title", with no initials badge, and the round sits beside the date;
 *   5. a double click on the video goes full screen, and a second one comes back.
 *   With the switch off for the signed-in person: today's title, line and three tabs.
 * The SMM's Review tab (switch on):
 *   6. Notify client sits on the right, beside the three-dot menu (Sheet keeps its card size control).
 * For everyone:
 *   7. a video opened from a play button (Sheet's play icon, the Review tab's preview, Kasper's Watch here) starts
 *      playing; one opened from the Notes button does not; a browser that refuses sound starts it muted with a clear
 *      "click for sound" button;
 *   8. Analytics is hidden: no Analytics tab in the staff bar and no Analytics / Content Calendar toggle on a client
 *      link (an Analytics address opens the Content Calendar) while analytics_hidden is missing, unreadable or
 *      { hidden: true }; { hidden: false } brings both back.
 * CURTAIN_SEVEN_SHOTS=<dir> also writes the screenshots used in the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, OTHER, TOKEN, open, openClient, waitNew, inS, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.CURTAIN_SEVEN_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function shot(t, name, clip) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(500); await t.page.screenshot(Object.assign({ path: path.join(SHOTS, name + '.png') }, clip ? { clip } : {})); }

async function openKasper(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'kasper' }, o));
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  if (o.expectNew) await waitNew(t); else await t.page.locator('#kasperReviewBody').waitFor({ timeout: 30000 });
  await sleep(1500);
  return t;
}
async function openStaffCal(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'smm', staff: STAFF, finished: true }, o));
  if (o.before) await o.before(t);
  await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
  return t;
}
function kHead(page) {
  return page.evaluate(() => {
    const vis = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    return {
      title: vis(document.querySelector('.kasper-title')),
      fresh: Array.from(document.querySelectorAll('[data-kasper-fresh]')).some(vis),
      primary: Array.from(document.querySelectorAll('.kasper-subtabs .kasper-primary-tab .kasper-tab-label-full')).filter(vis).map(e => e.textContent.trim()).join('|'),
      moreItems: Array.from(document.querySelectorAll('#kasperMoreMenu .kasper-more-item')).map(e => e.getAttribute('data-kasper-tab')).join(','),
      moreLabel: (document.querySelector('[data-kasper-more-label]') || {}).textContent || '',
      tab: typeof _kasperState === 'object' ? _kasperState.tab : '',
    };
  });
}
// What the stage shows (the new page's shadow root).
function stage(page) {
  return page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const vis = el => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none';
    const q = s => r.querySelector(s);
    const h2 = q('#side h2');
    return {
      skHead: (q('#skHead') || {}).textContent || '',
      labs: Array.from(r.querySelectorAll('.sk-lab')).filter(vis).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join('|'),
      qBtn: vis(q('#qBtn')), badge: (q('#qBtn .qb') || {}).textContent || '',
      panel: vis(q('#qPanel')),
      heads: Array.from(r.querySelectorAll('#qPanel .qp-h')).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join('|'),
      rows: Array.from(r.querySelectorAll('#qPanel [data-qid]')).map(e => e.dataset.qid).join(','),
      pings: r.querySelectorAll('#qPanel [data-qping]').length,
      h2: h2 ? h2.textContent.replace(/\s+/g, ' ').trim() : '',
      h2Lines: h2 ? Math.round(h2.getBoundingClientRect().height / parseFloat(getComputedStyle(h2).lineHeight)) : 0,
      avatar: vis(q('.sd-cl .avatar')),
      sideText: (q('#side') || {}).textContent || '',
      sdate: (q('#sdate') || {}).textContent || '',
      cur: (r.querySelector('.chipp.cur') || {}).dataset ? r.querySelector('.chipp.cur').dataset.id : '',
    };
  });
}
// A video in the given root is playing (not paused, time moving), and whether it is muted.
function videoState(page, inStage) {
  return page.evaluate((inStage) => {
    const root = inStage ? document.getElementById('svReviewStage').shadowRoot : document;
    const v = root.querySelector(inStage ? '#fvHost video' : '#calNotesStage video');
    const p = root.querySelector(inStage ? '#fvHost .fv-player' : '#calNotesStage .fv-player');
    const u = root.querySelector(inStage ? '#fvHost .fv-unmute' : '#calNotesStage .fv-unmute');
    return { has: !!v, playing: !!v && !v.paused && v.currentTime > 0, paused: !v || v.paused, muted: !!v && v.muted, unmute: !!u && u.getClientRects().length > 0 && getComputedStyle(u).display !== 'none', automuted: !!p && p.hasAttribute('data-automuted') };
  }, inStage);
}
async function waitPlaying(page, inStage, ms) {
  for (let i = 0; i < (ms || 10000) / 200; i++) { const s = await videoState(page, inStage); if (s.playing) return s; await sleep(200); }
  return videoState(page, inStage);
}
// Simulates a browser that refuses to start a video with sound without a fresh click.
async function refuseSound(t) {
  await t.page.addInitScript(() => {
    const real = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted && !window.__svAllowSound) return Promise.reject(new DOMException('play() can only be initiated by a user gesture.', 'NotAllowedError'));
      return real.call(this);
    };
  });
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- 1 to 5. Kasper's tab, switch on ----------
    {
      console.log('--- Kasper tab, switch on, 1440x900 dark ---');
      const t = await openKasper(browser, origin, { flags: 'on', staff: STAFF, dark: true, expectNew: true });
      let K = await kHead(t.page);
      expect(!K.title, '1: no "Kasper" title');
      expect(!K.fresh, '1: no "Updated" line');
      expect(K.primary === 'Review Session|Messages', '2: his tabs are Review Session and Messages (' + K.primary + ')');
      expect(/(^|,)filming(,|$)/.test(K.moreItems), '2: Filming Plans is in More (' + K.moreItems + ')');
      let S = await stage(t.page);
      expect(!/to review|Oldest first/i.test(S.skHead) && !/Waiting for your review/.test(S.labs), '3: no "to review" or section texts on the strip (' + S.skHead + ' | ' + S.labs + ')');
      expect(S.qBtn && S.badge === '7', '3: the list button shows, with the count as a badge (' + S.badge + ')');
      expect(!S.panel, '3: the list is closed at first');
      expect(S.h2 === CLIENT + ' · Why the first second matters' && S.h2Lines === 1, '4: the heading is one row, client then title (' + S.h2 + ', ' + S.h2Lines + ' line)');
      expect(!S.avatar, '4: no initials badge');
      expect(/Fri 23 Oct/.test(S.sdate) && /First review/.test(S.sdate) && !/First review/.test(S.sideText), '4: the round sits beside the date, not under the title (' + S.sdate + ' | ' + S.sideText + ')');
      await shot(t, 'after-kasper-1440-dark');

      // A post back after a round of tweaks: "Back after tweaks, round 2" beside the date.
      await t.page.evaluate(() => {
        const it = _kasperState.items.find(x => x.post.id === 'rs1');
        const key = Array.isArray(it.post.video_comments) ? 'video_comments' : 'comments';
        it.post[key] = (Array.isArray(it.post[key]) ? it.post[key] : []).concat([{ id: 'k1', parent_id: null, author: 'Fixture Reviewer', role: 'kasper', is_tweak: true, audience: 'internal', body: 'Tighten the start.', created_at: '2026-10-11T10:00:00.000Z', updated_at: '2026-10-11T10:00:00.000Z', done: true, done_at: '', done_by: '' }]);
        _kasperPaintReview();
      });
      await sleep(800);
      S = await stage(t.page);
      expect(/Fri 23 Oct\s*·?\s*Back after tweaks, round 2/.test(S.sdate.replace(/\s+/g, ' ')) || /Back after tweaks, round 2/.test(S.sdate), '4: "Back after tweaks, round 2" sits beside the date (' + S.sdate + ')');

      // A card with the editors, so the list has all three of his sections.
      await t.page.evaluate(() => {
        const it = _kasperState.items.find(x => x.post.id === 'rs7');
        it.post.video_status = 'Tweaks Needed'; it.post.graphic_status = 'Client Approval'; it.post.caption_status = 'Client Approval';
        it.post.kasper_finished_at = new Date().toISOString();
        it.post.linear_issue_id = ''; it.post.video_deliverable_id = 'del_rs7';
        _kasperPaintReview();
      });
      await sleep(600);
      try {
        await inS(t.page, '#qBtn').click();
        await sleep(400);
        S = await stage(t.page);
        expect(S.panel, '3: the list button opens the list');
        expect(/Waiting for your review/.test(S.heads) && /With the editors/.test(S.heads) && /tweaks pending/.test(S.heads), '3: the list shows his sections (' + S.heads + ')');
        expect(S.rows.split(',').filter(Boolean).length === 7, '3: every post is in the list (' + S.rows + ')');
        await shot(t, 'after-kasper-list-1440-dark');
        await inS(t.page, '#qPanel [data-qid="rs3"]').click();
        await sleep(900);
        S = await stage(t.page);
        expect(!S.panel && /The question nobody asks/.test(S.h2) && S.cur === 'rs3', '3: a row opens that post on the stage and closes the list (' + S.h2 + ', ' + S.cur + ')');
        await inS(t.page, '#qBtn').click();
        await sleep(300);
        await t.page.keyboard.press('Escape');
        await sleep(300);
        S = await stage(t.page);
        expect(!S.panel, '3: Escape closes the list');
        await inS(t.page, '#qBtn').click();
        await sleep(300);
        await t.page.mouse.click(800, 107);   // an empty spot of the tab row, outside the review page
        await sleep(300);
        S = await stage(t.page);
        expect(!S.panel, '3: a click elsewhere on the page closes the list');
      } catch (e) { expect(false, '3: the list: stopped (' + String(e && e.message || e).split('\n')[0] + ')'); }

      try {
        // 5. double click the video: full screen, and back
        await inS(t.page, '.chipp[data-id="rs1"]').click(); await sleep(1200);
        await t.page.waitForFunction(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('#fvHost video'), null, { timeout: 15000 }).catch(() => null);
        const vb = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot.querySelector('#fvHost .fv-player').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.35 }; });
        await t.page.mouse.dblclick(vb.x, vb.y);
        await sleep(900);
        const fs1 = await t.page.evaluate(() => !!document.fullscreenElement);
        expect(fs1, '5: a double click on the video goes full screen');
        await t.page.mouse.dblclick(vb.x, vb.y);
        await sleep(900);
        const fs2 = await t.page.evaluate(() => !!document.fullscreenElement);
        expect(!fs2, '5: a second double click comes back out of full screen');
      } catch (e) { expect(false, '5: full screen: stopped (' + String(e && e.message || e).split('\n')[0] + ')'); }

      try {
        // 2. Filming Plans from More
        await t.page.evaluate(() => _kasperGotoTab('filming'));
        await sleep(1200);
        K = await kHead(t.page);
        expect(K.tab === 'filming' && K.moreLabel.trim() === 'Filming Plans' && K.primary === 'Review Session|Messages', '2: Filming Plans opens from More, which names it (' + K.tab + ', ' + K.moreLabel + ')');
      } catch (e) { expect(false, '2: Filming Plans from More: stopped (' + String(e && e.message || e).split('\n')[0] + ')'); }

      expect(t.errors.length === 0, 'Kasper on: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
    {
      console.log('--- Kasper tab, switch on for someone else (today\'s page) ---');
      const t = await openKasper(browser, origin, { flags: 'on', staff: OTHER });
      const K = await kHead(t.page);
      expect(K.title && K.primary === 'Review Session|Messages|Filming Plans', 'switch off for this person: today\'s title and three tabs (' + K.title + ', ' + K.primary + ')');
      expect(t.errors.length === 0, 'Kasper off: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- 6. the SMM's Review tab: Notify client beside the menu ----------
    for (const flags of ['on', 'off']) {
      console.log('--- SMM Review tab, switch ' + flags + ' ---');
      const t = await openStaffCal(browser, origin, { flags });
      await t.page.evaluate(() => onCalViewChange('smmreview'));
      if (flags === 'on') await waitNew(t); else await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
      await sleep(1200);
      const bar = () => t.page.evaluate(() => {
        const b = document.querySelector('#calView > .cal-toolbar');
        const n = b.querySelector('.notify-client-btn'), k = b.querySelector('.cal-kebab'), z = b.querySelector('.cal-zoom');
        const r = e => e.getBoundingClientRect();
        return { gap: Math.round(r(k).left - r(n).right), zoom: !!z && getComputedStyle(z).display !== 'none' && getComputedStyle(z).visibility !== 'hidden', zoomBox: !!z && getComputedStyle(z).display !== 'none' };
      });
      const B = await bar();
      if (flags === 'on') {
        expect(B.gap >= 0 && B.gap <= 24, '6: Notify client sits beside the three-dot menu (' + B.gap + 'px apart)');
        await shot(t, 'after-smm-bar-1440', { x: 0, y: 60, width: 1440, height: 90 });
        await t.page.evaluate(() => onCalViewChange('organizer'));
        await sleep(1200);
        const S2 = await bar();
        expect(S2.zoom, '6: Sheet keeps its card size control');
      } else {
        expect(B.zoomBox, '6, switch off: today\'s bar (the card size control still holds its place)');
      }
      expect(t.errors.length === 0, 'SMM ' + flags + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- 7. autoplay from a play button, not from the notes ----------
    {
      console.log('--- 7. Sheet play icon, Notes button ---');
      const t = await openStaffCal(browser, origin, {});
      await t.page.evaluate(() => onCalViewChange('organizer'));
      await t.page.locator('.cal-thumb-play:not([hidden])').first().waitFor({ state: 'attached', timeout: 15000 });
      await sleep(800);
      await t.page.locator('.cal-card-thumb .cal-thumb-play:not([hidden])').first().click({ force: true });
      let V = await waitPlaying(t.page, false, 12000);
      expect(V.playing && !V.muted, '7: a Sheet play icon opens the video playing, with sound (' + JSON.stringify(V) + ')');
      await t.page.evaluate(() => closeCalComments());
      await sleep(800);
      await t.page.evaluate(() => openCalComments('rs2'));
      await sleep(4000);
      V = await videoState(t.page, false);
      expect(V.has && V.paused, '7: the Notes button opens the video paused, as before (' + JSON.stringify(V) + ')');
      await t.page.evaluate(() => closeCalComments());
      // The Review tab's video preview (switch off: today's Review tab).
      await t.page.evaluate(() => onCalViewChange('smmreview'));
      await t.page.locator('.kcard[data-cal-review-pid="rs1"] .kcard-expand-btn').first().waitFor({ timeout: 30000 });
      await t.page.locator('.kcard[data-cal-review-pid="rs1"] .kcard-expand-btn').first().click();
      await t.page.locator('.kcard[data-cal-review-pid="rs1"] [data-fv-tile][data-fv-on]').first().waitFor({ timeout: 30000 });
      await sleep(600);
      await t.page.locator('.kcard[data-cal-review-pid="rs1"] [data-fv-tile][data-fv-on]').first().click();
      V = await waitPlaying(t.page, false, 12000);
      expect(V.playing, '7: the Review tab\'s video preview opens the video playing (' + JSON.stringify(V) + ')');
      expect(t.errors.length === 0, '7: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
    {
      console.log('--- 7. Kasper Watch here ---');
      const t = await openKasper(browser, origin, { staff: STAFF });
      await t.page.locator('.kcard-watch-here:not([hidden])').first().waitFor({ timeout: 30000 });
      await t.page.locator('.kcard-watch-here:not([hidden])').first().click();
      const V = await waitPlaying(t.page, false, 12000);
      expect(V.playing, '7: Kasper\'s Watch here opens the video playing (' + JSON.stringify(V) + ')');
      expect(t.errors.length === 0, '7 Kasper: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
    {
      console.log('--- 7. a browser that refuses sound ---');
      const t = await openStaffCal(browser, origin, { before: refuseSound });
      await t.page.evaluate(() => onCalViewChange('organizer'));
      await t.page.locator('.cal-thumb-play:not([hidden])').first().waitFor({ state: 'attached', timeout: 15000 });
      await sleep(800);
      await t.page.locator('.cal-card-thumb .cal-thumb-play:not([hidden])').first().click({ force: true });
      let V = await waitPlaying(t.page, false, 12000);
      expect(V.playing && V.muted && V.unmute, '7: refused sound: it plays muted, with a clear button for sound (' + JSON.stringify(V) + ')');
      await shot(t, 'after-autoplay-muted-1440');
      try {
        await t.page.evaluate(() => { window.__svAllowSound = true; });
        await t.page.locator('#calNotesStage .fv-unmute').click();
        await sleep(500);
        V = await videoState(t.page, false);
        expect(!V.muted && !V.unmute && V.playing, '7: the button turns the sound on and goes (' + JSON.stringify(V) + ')');
      } catch (e) { expect(false, '7: click for sound: stopped (' + String(e && e.message || e).split('\n')[0] + ')'); }

      expect(t.errors.length === 0, '7 refused: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- 8. Analytics hidden for everyone, behind analytics_hidden ----------
    for (const [label, opt, shown] of [['missing', {}, false], ['unreadable', { flags: 'unreadable' }, false], ['{ hidden: true }', { analytics: { hidden: true } }, false], ['{ hidden: false }', { analytics: 'shown' }, true]]) {
      console.log('--- 8. analytics_hidden ' + label + ' ---');
      {
        const t = await openStaffCal(browser, origin, opt);
        await sleep(1500);
        const nav = await t.page.evaluate(() => { const n = document.getElementById('navHome'); return !!n && n.getClientRects().length > 0; });
        expect(nav === shown, '8 (' + label + '): the staff bar ' + (shown ? 'shows' : 'has no') + ' Analytics tab');
        if (label === 'missing') await shot(t, 'after-staff-bar-1440', { x: 0, y: 0, width: 1440, height: 60 });
        expect(t.errors.length === 0, '8 staff (' + label + '): no page errors (' + t.errors.join(' | ') + ')');
        await t.ctx.close();
      }
      for (const v of shown ? ['', 'calendar'] : ['', 'analytics']) {
        const t = await open(browser, origin, Object.assign({ stage: 'client', finished: true }, opt));
        const q = Object.assign({ c: CLIENT }, v ? { v } : {}, { t: TOKEN });
        await t.page.goto(origin + '/index.html?' + new URLSearchParams(q), { waitUntil: 'domcontentloaded' });
        await sleep(6000);
        const r = await t.page.evaluate(() => {
          const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
          return { cal: !!document.getElementById('calView'), toggle: Array.from(document.querySelectorAll('.view-tab-toggle')).some(e => vis(e) && /Analytics/.test(e.textContent)), url: location.search };
        });
        if (shown && v) expect(r.cal && r.toggle, '8 (' + label + ', ' + v + ' link): the client sees the Analytics / Content Calendar toggle again (calendar ' + r.cal + ', toggle ' + r.toggle + ')');
        else if (shown) expect(!r.cal && !/[?&]v=calendar/.test(r.url), '8 (' + label + ', bare link): it opens on Analytics, as before (calendar ' + r.cal + ', ' + r.url + ')');
        else {
          expect(r.cal && !r.toggle, '8 (' + label + ', ' + (v || 'bare') + ' link): the client lands on the Content Calendar, no Analytics toggle (calendar ' + r.cal + ', toggle ' + r.toggle + ', ' + r.url + ')');
          if (label === 'missing' && !v) await shot(t, 'after-client-old-1440');
        }
        expect(t.errors.length === 0, '8 client (' + label + ', ' + (v || 'bare') + '): no page errors (' + t.errors.join(' | ') + ')');
        await t.ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-curtain-seven-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-curtain-seven-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
