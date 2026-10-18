'use strict';
/*
 * THE CLIENT LINK'S CALENDAR IS READ ONLY, AND ITS VIDEO DOOR OPENS THE IN-APP VIEWER. Session Pane, 2026-10-18.
 * A real browser against the real page and a mocked backend (fictional client, cards and tokens), fully offline.
 *
 * Owner decisions, 2026-10-18, for the CLIENT LINK only (?c=...&t=...):
 *   1. A client cannot edit a caption or a call to action on the Sheet (Collaborative mode or not), and cannot drag a
 *      post on Month or Week (nor from the "Unscheduled" list). Notes still work. The review page's own caption edit
 *      (for a post waiting on the client) is a different path and is covered by review-stage-browser.js.
 *   2. The Sheet's video button opens the in-app viewer (video on the left, notes on the right) like the SMM
 *      Calendar, behind the same frame_viewer_clients switch; switched off it is the old link.
 * The staff Calendar must not change at all: its caption and call to action stay editable, its Month and Week still
 * drag, and its thumbnail keeps the play icon.
 * CLIENT_READONLY_SHOTS=<dir> also writes the screenshots used in the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, openClient, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.CLIENT_READONLY_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(700); await t.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

async function ready(t, tab) {
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
  if (tab) {
    await t.page.evaluate(x => onCalViewChange(x), tab);
    await t.page.waitForFunction(x => calState.view === x, tab, { timeout: 15000 });
  }
  await sleep(1500);
}
async function openStaff(browser, origin, opt) {
  const t = await open(browser, origin, Object.assign({ stage: 'smm', staff: STAFF, finished: true }, opt));
  await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
  await ready(t);
  return t;
}
const textWrites = (t, from) => t.state.upserts.slice(from).filter(u => 'caption' in u || 'cta' in u || 'caption_alt' in u || 'scheduled_date' in u);

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- the client Sheet: caption and call to action are read only, Collaborative mode on or off ----------
    for (const collab of [true, false]) {
      console.log('--- client Sheet, Collaborative mode ' + (collab ? 'on' : 'off') + ' ---');
      const t = await openClient(browser, origin, { flags: 'off', collab, unscheduled: true, finished: true });
      await ready(t, 'organizer');
      const label = 'collab ' + (collab ? 'on' : 'off');
      const sheet = await t.page.evaluate(() => {
        const caps = Array.from(document.querySelectorAll('textarea[data-fld="caption"]'));
        const ctas = Array.from(document.querySelectorAll('input[data-fld="cta"]'));
        const dates = Array.from(document.querySelectorAll('.cal-fld-date-wrap'));
        return {
          caps: caps.length, capsRo: caps.every(e => e.readOnly), ctas: ctas.length, ctasRo: ctas.every(e => e.readOnly),
          dates: dates.length, datesRo: dates.every(e => e.classList.contains('is-readonly') && !e.querySelector('input[type="date"]')),
          capCursor: caps[0] && getComputedStyle(caps[0]).cursor, ctaCursor: ctas[0] && getComputedStyle(ctas[0]).cursor,
        };
      });
      expect(sheet.caps > 0 && sheet.capsRo, label + ': every caption box is read only (' + sheet.caps + ')');
      expect(sheet.ctas > 0 && sheet.ctasRo, label + ': every call-to-action box is read only (' + sheet.ctas + ')');
      expect(sheet.dates > 0 && sheet.datesRo, label + ': every date is a plain chip with no date picker (' + sheet.dates + ')');
      expect(sheet.capCursor !== 'text' && sheet.ctaCursor !== 'text', label + ': no text cursor over them (' + sheet.capCursor + ', ' + sheet.ctaCursor + ')');
      await shot(t, 'after-client-sheet-1440-light' + (collab ? '-collab' : ''));

      // Every way in: the keyboard, a paste, a drop, a blur, and the page's own handlers called directly.
      const n0 = t.state.upserts.length;
      const cap = t.page.locator('textarea[data-fld="caption"]').first();
      const cta = t.page.locator('input[data-fld="cta"]').first();
      await cap.click(); await t.page.keyboard.type('typed by a client'); await t.page.keyboard.press('Control+V'); await t.page.keyboard.press('Backspace');
      await cta.click(); await t.page.keyboard.type('typed by a client'); await t.page.keyboard.press('Tab');
      await t.page.evaluate(() => {
        const ta = document.querySelector('textarea[data-fld="caption"]'), ci = document.querySelector('input[data-fld="cta"]'), di = document.querySelector('input[type="date"]');
        const data = new DataTransfer(); data.setData('text/plain', 'dropped text');
        ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        ta.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
        // The page's own handlers, as a script or an extension would call them with a value forced in.
        ta.value = 'forced caption'; _calOnCaptionInput(ta); _calOnCaptionBlur(ta);
        ci.value = 'forced cta'; _calOnFieldInput(ci); _calOnFieldBlur(ci);
        if (di) { di.value = '2026-12-01'; _calOnDateChange(di); }
        const alt = document.createElement('textarea'); alt.dataset.pid = ta.dataset.pid; alt.dataset.fld = 'caption_alt'; alt.value = 'forced alt'; _calOnAltCapInput(alt); _calOnFieldBlur(alt);
      });
      await sleep(2500);
      expect(textWrites(t, n0).length === 0, label + ': nothing is saved by typing, pasting, dropping, blurring or calling the handlers (' + JSON.stringify(textWrites(t, n0)).slice(0, 160) + ')');
      expect(t.state.cards.find(c => c.id === 'rs1').caption.startsWith('Most people'), label + ': the card still has its caption');
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- with the new review page on, the Sheet and its video door behave the same ----------
    {
      console.log('--- client Sheet, new review page on ---');
      const t = await openClient(browser, origin, { flags: 'on', collab: true, finished: true });
      await ready(t, 'organizer');
      const ro = await t.page.evaluate(() => { const f = Array.from(document.querySelectorAll('textarea[data-fld="caption"], input[data-fld="cta"]')); return { n: f.length, ro: f.every(e => e.readOnly) }; });
      expect(ro.n > 0 && ro.ro, 'review page on: caption and call to action are read only (' + ro.n + ')');
      await t.page.locator('.cal-card[data-pid="rf1"] .cal-link-post a.cal-link-pill-open').first().click();
      await t.page.locator('.fv-player').first().waitFor({ timeout: 20000 });
      expect(await t.page.locator('#calNotesStage .fv-player').count() === 1, 'review page on: the Video button opens the in-app viewer');
      await t.ctx.close();
    }

    // ---------- Notes still work on the client Sheet ----------
    {
      console.log('--- client Sheet, notes ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: true });
      await ready(t, 'organizer');
      await t.page.locator('.cal-card[data-pid="rs1"] .cal-comments-btn, .cal-card[data-pid="rs1"] [onclick*="openCalComments"]').first().click();
      const box = t.page.locator('#calCommentsOverlay textarea, .cal-comments-overlay textarea, .cal-cm-input textarea, textarea[id*="omment"]').first();
      await box.waitFor({ timeout: 15000 });
      expect(await box.isEditable(), 'notes: the client can type in the Notes box');
      const req = [];
      t.page.on('request', r => { if (r.method() === 'POST' && /production-comments|calendar-upsert|calendar-card-write|production-write/.test(r.url())) req.push(r.postData() || ''); });
      await box.fill('A note from the client.');
      await t.page.keyboard.press('Enter');
      for (let i = 0; i < 50 && !req.some(b => /A note from the client/.test(b)); i++) await sleep(100);
      expect(req.some(b => /A note from the client/.test(b)), 'notes: sending a note reaches the backend');
      await t.ctx.close();
    }

    // ---------- the video door ----------
    for (const frame of ['on', 'off']) {
      console.log('--- client Sheet, video door, viewer switch ' + frame + ' ---');
      const t = await openClient(browser, origin, { flags: 'off', frame, collab: true });
      await ready(t, 'organizer');
      const door = t.page.locator('.cal-card[data-pid="rs1"] .cal-link-post a.cal-link-pill-open').first();
      expect(await door.count() === 1, 'door ' + frame + ': the Video button is on the card');
      expect(await door.evaluate(e => e.hasAttribute('data-fv-on')) === (frame === 'on'), 'door ' + frame + ': marked for the viewer only when the switch is on');
      if (frame === 'on') {
        let popup = false; t.page.context().on('page', () => { popup = true; });
        await door.click();
        await t.page.locator('.fv-player').first().waitFor({ timeout: 20000 });
        await sleep(800);
        const lay = await t.page.evaluate(() => {
          const p = document.getElementById('calNotesStage').getBoundingClientRect();
          const n = document.querySelector('#calNotesShell textarea').getBoundingClientRect();
          return { pl: Math.round(p.left), pr: Math.round(p.right), nl: Math.round(n.left), nr: Math.round(n.right) };
        });
        expect(lay.pr <= lay.nl + 2, 'door on: the video is on the left and the notes on the right (' + JSON.stringify(lay) + ')');
        expect(!popup, 'door on: no new tab opens');
        await shot(t, 'after-client-door-1440-light');
      } else {
        const [pop] = await Promise.all([t.page.waitForEvent('popup', { timeout: 10000 }).catch(() => null), door.click()]);
        expect(!!pop, 'door off: the old link still opens in a new tab');
        expect(!(await t.page.locator('.fv-player').count()), 'door off: no in-app player');
      }
      expect(t.errors.length === 0, 'door ' + frame + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- a click before the viewer switch has been read ----------
    // The click is held at most 0.7 s for the switch (a link opened later than that can be blocked as a popup):
    // a switch that answers within that opens the viewer; a slower one opens the link at once (Codex review of PR 2209).
    for (const [delay, wantViewer] of [[300, true], [2500, false]]) {
      console.log('--- client Sheet, video door clicked before the switch is read (switch answers in ' + delay + ' ms) ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: true, frameDelay: delay });
      await ready(t, 'organizer');
      let popup = false; t.page.context().on('page', () => { popup = true; });
      await t.page.locator('.cal-card[data-pid="rs1"] .cal-link-post a.cal-link-pill-open').first().click();
      if (wantViewer) {
        await t.page.locator('#calNotesStage .fv-player').first().waitFor({ timeout: 20000 });
        expect(!popup, 'early click, quick switch: the viewer opens and the old link does not');
      } else {
        for (let i = 0; i < 30 && !popup; i++) await sleep(100);
        expect(popup, 'early click, slow switch: the link opens within a second instead of waiting');
        expect(!(await t.page.locator('#calNotesStage .fv-player').count()), 'early click, slow switch: no viewer opens on top as well');
      }
      await t.ctx.close();
    }

    // ---------- a post the client is suggesting (Collaborative mode on) can still be finished ----------
    {
      console.log('--- client Sheet, suggesting a post ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: true, finished: true });
      await ready(t, 'organizer');
      await t.page.locator('.cal-card-add').click();
      await t.page.locator('.cal-card.is-blank .cal-fld-name').click();
      await t.page.keyboard.type('My suggested post');
      await sleep(2500);   // the name's first save turns the blank card into a real one, in place
      const mine = t.page.locator('.cal-card[data-pid^="p_"]:not(.is-blank) textarea[data-fld="caption"]').first();
      await mine.click(); await t.page.keyboard.type('Caption typed after the name saved');
      await t.page.locator('body').click({ position: { x: 5, y: 5 } });
      for (let i = 0; i < 40 && !t.state.upserts.some(u => u.caption === 'Caption typed after the name saved'); i++) await sleep(100);
      expect(t.state.upserts.some(u => u.caption === 'Caption typed after the name saved'), 'suggest: a caption typed after the name has saved still saves');
      await t.ctx.close();
    }

    // ---------- the Sheet's own reorder (a separate, earlier decision) still saves with Collaborative mode on ----------
    {
      console.log('--- client Sheet, reorder ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: true, finished: true });
      await ready(t, 'organizer');
      const reorders = []; t.page.on('request', r => { if (r.method() === 'POST' && /calendar-reorder/.test(r.url())) reorders.push(r.postData() || ''); });
      const cards = t.page.locator('.cal-card[draggable="true"]');
      await cards.nth(0).locator('.cal-card-grip').dragTo(cards.nth(2), { force: true });
      for (let i = 0; i < 30 && !reorders.length; i++) await sleep(100);
      expect(reorders.length > 0, 'reorder: dragging a card by its grip on the Sheet still sends the new order');
      await t.ctx.close();
    }

    // ---------- Month and Week: nothing drags ----------
    for (const collab of [true, false]) {
      console.log('--- client Month and Week, Collaborative mode ' + (collab ? 'on' : 'off') + ' ---');
      const t = await openClient(browser, origin, { flags: 'off', collab, unscheduled: collab ? true : 'approved', finished: true });
      for (const v of ['month', 'week']) {
        await ready(t, v);
        const label = v + ' collab ' + (collab ? 'on' : 'off');
        const m = await t.page.evaluate(() => ({
          pills: document.querySelectorAll('.cal-month-pill, .cal-week-card, .cal-week-pill').length,
          movable: document.querySelectorAll('[data-cal-move]').length, draggable: document.querySelectorAll('.cal-body [draggable="true"]').length,
          grips: document.querySelectorAll('.cal-move-grip').length, unsched: document.querySelectorAll('.cal-unscheduled').length,
        }));
        expect(m.pills > 0, label + ': the posts show (' + m.pills + ')');
        expect(m.movable === 0 && m.draggable === 0 && m.grips === 0, label + ': nothing is draggable and no drag grip shows');
        expect(m.unsched === 0, label + ': no "Unscheduled ... drag onto a day" list');
        // The undated post comes back as a read-only list (owner decision 2026-10-18): same pills, nothing to drag or date.
        const ny = await t.page.evaluate(() => {
          const box = document.querySelector('.cal-notyet');
          const pills = box ? Array.from(box.querySelectorAll('.cal-month-pill')) : [];
          return {
            has: !!box, heading: box ? box.querySelector('.cal-notyet-h').textContent.trim() : '', pills: pills.length,
            names: pills.map(b => b.textContent), buttons: pills.every(b => b.tagName === 'BUTTON' && b.tabIndex >= 0),
            drag: box ? box.querySelectorAll('[draggable="true"], [data-cal-move], .cal-move-grip, input, textarea, select, [data-iso]').length : -1,
            dated: document.querySelectorAll('.cal-notyet [data-iso]').length,
          };
        });
        expect(ny.has && /^Not scheduled yet \(1\)$/.test(ny.heading), label + ': the "Not scheduled yet" list shows with one post (' + ny.heading + ')');
        expect(ny.pills === 1 && /An undated idea/.test(ny.names[0]), label + ': the list holds the undated post');
        expect(ny.buttons, label + ': each post in the list is a button the keyboard can reach');
        expect(ny.drag === 0, label + ': the list has no drag handle, drop target, date control or input');
        const nyPill = t.page.locator('.cal-notyet .cal-month-pill').first();
        await nyPill.focus();
        expect(await nyPill.evaluate(e => document.activeElement === e), label + ': the post takes keyboard focus');
        const n1 = t.state.upserts.length;
        const pb = await nyPill.boundingBox();
        await t.page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await t.page.mouse.down();
        await t.page.mouse.move(720, 600, { steps: 8 }); await t.page.mouse.up();
        await sleep(1200);
        expect(textWrites(t, n1).length === 0 && !(await t.page.evaluate(() => (calState.posts.find(p => p.id === 'ru1') || {}).scheduled_date)), label + ': dragging the undated post does nothing and saves nothing');
        await nyPill.press('Enter');
        await t.page.locator('#calPreviewOverlay, .cal-preview-overlay, [id*="calPreview"]').first().waitFor({ timeout: 10000 }).catch(() => {});
        const opened = await t.page.evaluate(() => /An undated idea/.test(document.body.innerText) && !!document.querySelector('[id*="alPreview"], .cal-preview, .cal-preview-card, .cal-pv'));
        expect(opened, label + ': opening the undated post shows it the way a dated post opens');
        expect(textWrites(t, n1).length === 0, label + ': opening it saves nothing');
        await t.page.keyboard.press('Escape');
        await sleep(400);
        if (collab && v === 'month') await shot(t, 'after-client-notyet-month-1440-light');
        if (collab && v === 'week') await shot(t, 'after-client-notyet-week-1440-light');
        const n0 = t.state.upserts.length;
        await t.page.evaluate(() => {
          const day = document.querySelector('[data-cal-day], .cal-month-cell, .cal-week-col');
          const data = new DataTransfer(); data.setData('text/plain', 'rs1');
          if (day) { day.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true })); day.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); }
        });
        await sleep(1500);
        expect(textWrites(t, n0).length === 0, label + ': a forced drop saves nothing');
        if (collab) await shot(t, 'after-client-' + v + '-1440-light');
      }
      expect(t.errors.length === 0, 'month/week: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- an unfinished undated post follows the same rule as an unfinished dated one ----------
    {
      console.log('--- client Month and Week, Collaborative mode off, undated post not finished ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: false, unscheduled: true, finished: true });
      for (const v of ['month', 'week']) {
        await ready(t, v);
        expect(await t.page.locator('.cal-notyet').count() === 0, v + ': an unfinished undated post stays hidden while Collaborative mode is off, like a dated one');
      }
      await t.ctx.close();
    }

    // ---------- no undated posts: no list at all ----------
    {
      console.log('--- client Month and Week, no undated posts ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: true, finished: true });
      for (const v of ['month', 'week']) {
        await ready(t, v);
        expect(await t.page.locator('.cal-notyet').count() === 0, v + ': no "Not scheduled yet" list when every post has a date');
      }
      await t.ctx.close();
    }

    // ---------- phone widths: the list shows, scrolls sideways or wraps inside the page, and opens a post ----------
    for (const width of [390, 430]) {
      console.log('--- client Month and Week at ' + width + ' ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: true, unscheduled: true, finished: true, width, height: 844 });
      for (const v of ['month', 'week']) {
        await ready(t, v);
        const r = await t.page.evaluate(() => {
          const box = document.querySelector('.cal-notyet'); const b = box && box.getBoundingClientRect();
          return { has: !!box, left: b && Math.round(b.left), right: b && Math.round(b.right), vw: innerWidth, sw: document.documentElement.scrollWidth, drag: document.querySelectorAll('.cal-notyet [draggable="true"], .cal-notyet .cal-move-grip').length, h: b && Math.round(b.height) };
        });
        expect(r.has && r.left >= 0 && r.right <= r.vw && r.sw <= r.vw, v + ' ' + width + ': the list fits the screen (' + JSON.stringify(r) + ')');
        expect(r.drag === 0, v + ' ' + width + ': nothing in it drags');
        await t.page.locator('.cal-notyet .cal-month-pill').first().click();
        await sleep(800);
        expect(await t.page.evaluate(() => /An undated idea/.test(document.body.innerText)), v + ' ' + width + ': tapping the post opens it');
        await t.page.keyboard.press('Escape');
        await sleep(300);
        await t.page.evaluate(() => { if (document.querySelector('#calCommentsOverlay.open')) closeCalComments(); });
        await sleep(300);
        if (width === 390) await shot(t, 'after-client-notyet-' + v + '-390-light');
        if (width === 430 && v === 'month') await shot(t, 'after-client-notyet-month-430-light');
      }
      expect(t.errors.length === 0, width + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- the new review page is still the client's way to edit a caption ----------
    // (covered end to end by test/review-stage-browser.js: "a caption edit saves the new caption on the card")

    // ---------- phone width ----------
    {
      console.log('--- client Sheet at 390 ---');
      const t = await openClient(browser, origin, { flags: 'off', collab: true, width: 390, height: 844 });
      await ready(t, 'organizer');
      const ro = await t.page.evaluate(() => Array.from(document.querySelectorAll('textarea[data-fld="caption"], input[data-fld="cta"]')).every(e => e.readOnly));
      expect(ro, 'phone: caption and call to action are read only');
      await shot(t, 'after-client-sheet-390-light');
      await t.ctx.close();
    }

    // ---------- the staff Calendar is unchanged ----------
    for (const collab of [false, true]) {
      console.log('--- staff Calendar (unchanged), Collaborative mode ' + (collab ? 'on' : 'off') + ' ---');
      const t = await openStaff(browser, origin, { collab, unscheduled: true });
      await ready(t, 'organizer');
      const sheet = await t.page.evaluate(() => ({
        capRw: Array.from(document.querySelectorAll('textarea[data-fld="caption"]')).some(e => !e.readOnly),
        ctaRw: Array.from(document.querySelectorAll('input[data-fld="cta"]')).some(e => !e.readOnly),
        play: document.querySelectorAll('.cal-thumb-play').length,
        door: document.querySelectorAll('.cal-link-post a.cal-link-pill-open').length,
      }));
      expect(sheet.capRw && sheet.ctaRw, 'staff: caption and call to action stay editable');
      expect(sheet.play > 0, 'staff: the thumbnail keeps its play icon (' + sheet.play + ')');
      expect(sheet.door === 0, 'staff: the Video button is still the staff one, not the client link');
      const n0 = t.state.upserts.length;
      const cap = t.page.locator('textarea[data-fld="caption"]').first();
      await cap.click(); await cap.fill('Staff edit stays.'); await cap.blur();
      for (let i = 0; i < 40 && !textWrites(t, n0).some(u => u.caption === 'Staff edit stays.'); i++) await sleep(100);
      expect(textWrites(t, n0).some(u => u.caption === 'Staff edit stays.'), 'staff: typing a caption still saves it');
      for (const v of ['month', 'week']) {
        await ready(t, v);
        const m = await t.page.evaluate(() => ({ movable: document.querySelectorAll('[data-cal-move]').length, unsched: document.querySelectorAll('.cal-unscheduled').length }));
        expect(m.movable > 0, 'staff ' + v + ': posts still drag (' + m.movable + ')');
        expect(m.unsched > 0, 'staff ' + v + ': the Unscheduled list is still offered');
        expect(await t.page.locator('.cal-notyet').count() === 0, 'staff ' + v + ': the client-only "Not scheduled yet" list is not added');
      }
      expect(t.errors.length === 0, 'staff: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' check(s) failed:\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('\nAll checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
