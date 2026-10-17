'use strict';
/*
 * THE REVIEW PAGE, OWNER FEEDBACK OF 2026-10-17 23:00 UTC (session Curtain Six). Real browser, fully offline, the
 * shared mocked backend of review-stage-browser.js (fictional client, cards, people and conversation).
 *
 * 1. The first switch from Sheet to Review never shows the old list ("when I switch from Sheet to Review, the first
 *    time, for a nanosecond we see the old review thing"). The page opens on Sheet and stays there a while (the
 *    switch read answers after 400ms, as a slow live read would), then Review is clicked. Every animation frame from
 *    the click records whether any part of the old Review list is visible. For a switched-on client it never is, on
 *    the SMM's Calendar (light and dark) and on the client link. With the switch off the same probe does see the old
 *    list, so a pass is not blind.
 * 2. The conversation is a phone-style chat, as in the approved mock-up, for the client, the SMM and Kasper, light
 *    and dark: bubbles (not full-width cards), the viewer's own on the right and everyone else's on the left, a
 *    bubble colour that stands apart from the panel, no coloured side bar, each tagged with its part, "Done" on a
 *    handled request, older notes folded, the message box at the bottom; a whole caption pasted as a change keeps its
 *    paragraphs and folds behind "Show all". Opening it saves nothing.
 * 3. The "new version of SyncView" bar never covers the stage's Approve or Finish reviewing buttons.
 * CHAT_SHOTS=<dir> also writes the screenshots used in the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, TOKEN, open, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.CHAT_SHOTS || '';

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

// Records, on every animation frame, whether the old Review list is on screen, and when the new page shows.
const RECORDER = () => {
    const OLD = '.cal-review-wrap, .cal-review-list, [data-cal-review-pid], .cal-review-stranded';
    const vis = el => {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || !el.getClientRects().length) return false;
        for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        }
        return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    window.__rsRec = { on: false, frames: 0, oldFrames: 0, firstOld: -1, newAt: -1 };
    const tick = () => {
        const R = window.__rsRec;
        if (R.on) {
            R.frames++;
            const cv = document.getElementById('calView');
            const old = cv ? Array.from(cv.querySelectorAll(OLD)).some(vis) : false;
            if (old) { R.oldFrames++; if (R.firstOld < 0) R.firstOld = R.frames; }
            const h = document.getElementById('svReviewStage');
            const st = h && !h.hidden && h.shadowRoot && h.shadowRoot.getElementById('stepper');
            if (R.newAt < 0 && st && st.children.length && vis(h)) R.newAt = R.frames;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

async function record(page, click, frames) {
  await page.evaluate(() => { Object.assign(window.__rsRec, { on: true, frames: 0, oldFrames: 0, firstOld: -1, newAt: -1 }); });
  await click();
  await page.waitForFunction(n => window.__rsRec.frames >= n, frames || 90, { timeout: 30000 });
  return page.evaluate(() => Object.assign({}, window.__rsRec, { on: false }));
}

async function staffOnSheet(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'smm', staff: STAFF, finished: true, flagDelay: 400 }, o));
  await t.page.addInitScript(RECORDER);
  await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; calState.view = 'organizer'; navTo('calendar'); }, CLIENT);
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0 && calState.view === 'organizer', null, { timeout: 30000 });
  await sleep(2500);   // the person looks at the Sheet for a moment before clicking Review
  return t;
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const dark of [false, true]) {
      const theme = dark ? 'dark' : 'light';
      console.log('--- SMM Calendar, switch on, Sheet then Review, ' + theme + ' ---');
      const t = await staffOnSheet(browser, origin, { flags: 'on', dark });
      const R = await record(t.page, () => t.page.locator('#calView .cal-view-btn[data-cal-view="smmreview"]').first().click());
      expect(R.newAt > 0, 'staff ' + theme + ': the new page shows after the first click on Review (frame ' + R.newAt + ' of ' + R.frames + ')');
      expect(R.oldFrames === 0, 'staff ' + theme + ': the old Review list never shows on the first switch (' + R.oldFrames + ' frames, first at ' + R.firstOld + ')');
      // Back to Sheet and to Review again: still never.
      await t.page.locator('#calView .cal-view-btn[data-cal-view="organizer"]').first().click();
      await sleep(800);
      const R2 = await record(t.page, () => t.page.locator('#calView .cal-view-btn[data-cal-view="smmreview"]').first().click(), 45);
      expect(R2.oldFrames === 0, 'staff ' + theme + ': nor on the second switch (' + R2.oldFrames + ' frames)');
      expect(!t.errors.length, 'staff ' + theme + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- client link, switch on, Sheet then Review ---');
    {
      const c = await clientOnSheet(browser, origin);
      await c.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return typeof calState === 'object' && calState.view === 'organizer' && !calState.loading && !!(h && !h.hidden && h.shadowRoot && h.shadowRoot.querySelector('#rsTabs [data-tab="review"]')); }, null, { timeout: 30000 });
      await sleep(2500);
      const R = await record(c.page, () => c.page.locator('#svReviewStage').locator('#rsTabs [data-tab="review"]').click());
      expect(R.newAt > 0, 'client link: the stage shows after the first click on Review (frame ' + R.newAt + ' of ' + R.frames + ')');
      expect(R.oldFrames === 0, 'client link: the old Review list never shows on the first switch (' + R.oldFrames + ' frames, first at ' + R.firstOld + ')');
      expect(!c.errors.length, 'client link: no page errors (' + c.errors.join(' | ') + ')');
      await c.ctx.close();
    }

    console.log('--- SMM Calendar, switch off: the probe sees the old list ---');
    {
      const t = await staffOnSheet(browser, origin, { flags: 'off' });
      const R = await record(t.page, () => t.page.locator('#calView .cal-view-btn[data-cal-view="smmreview"]').first().click());
      expect(R.oldFrames > 0 && R.newAt < 0, 'switch off: the old list shows and the new page does not (' + R.oldFrames + ' frames, new at ' + R.newAt + ')');
      await t.ctx.close();
    }

    // ---------- 2 and 3. the conversation, and the update bar ----------
    for (const who of ['client', 'smm', 'kasper']) {
      for (const dark of [false, true]) {
        const name = who + ' ' + (dark ? 'dark' : 'light');
        console.log('--- the conversation, ' + name + ' ---');
        const t = await openWho(browser, origin, who, dark);
        const C = await chatLook(t.page);
        expect(C.bubbles >= 3, name + ': the notes are bubbles (' + C.bubbles + ')');
        expect(C.widest <= 0.88, name + ': no bubble runs the full width of the panel (widest ' + Math.round(C.widest * 100) + '%)');
        expect(C.mineRight && C.othersLeft, name + ': the viewer\'s own notes sit on the right, everyone else\'s on the left (' + C.sides + ')');
        expect(C.bubbleBgDiffers, name + ': the bubbles stand apart from the panel (' + C.bg + ')');
        expect(!C.sideBar, name + ': no coloured side bar on any bubble (' + C.shadows + ')');
        expect(C.tagged, name + ': every bubble names its part');
        expect(C.boxLast, name + ': the message box sits at the bottom of the panel');
        expect(C.long && C.long.clamped && C.long.paras, name + ': the pasted caption keeps its paragraphs and folds after a few lines (' + JSON.stringify(C.long) + ')');
        // Show all opens it, in place.
        await t.page.locator('#svReviewStage').locator('[data-more]').first().click();
        const L = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const b = r.querySelector('[data-more]'); const bt = b.previousElementSibling; return { clamped: bt.classList.contains('clamp'), full: bt.scrollHeight <= bt.clientHeight + 2, label: b.textContent }; });
        expect(!L.clamped && L.full && L.label === 'Show less', name + ': Show all opens the whole note (' + JSON.stringify(L) + ')');
        // Older notes fold; opened, a handled request shows Done.
        const fold = t.page.locator('#svReviewStage').locator('#foldBtn');
        if (await fold.count()) await fold.click();
        const D = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return { done: r.querySelectorAll('.bub.handled .donec').length, you: r.querySelectorAll('.bub.you').length }; });
        expect(D.done >= 1, name + ': a handled change request shows Done (' + D.done + ')');
        if (who === 'smm') {
          const V = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return { foot: r.querySelectorAll('.bfoot .vis').length, head: r.querySelectorAll('.bh .vis').length }; });
          expect(V.foot >= 1 && V.head === 0, name + ': Team only / Client can see sits under the note, not in its header (' + JSON.stringify(V) + ')');
        }
        expect(!t.state.upserts.length && !t.state.gateway.length, name + ': looking at the conversation saves nothing (' + t.state.upserts.length + ' card saves, ' + t.state.gateway.length + ' gateway calls)');
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await t.page.screenshot({ path: path.join(SHOTS, 'after-' + who + '-' + (dark ? 'dark' : 'light') + '-1440.png') }); }
        if (!dark) {
          const B = await updateBar(t.page);
          expect(B.shown && !B.covers.length, name + ': the new-version bar covers none of the stage\'s buttons (' + (B.covers.join(', ') || 'none') + ', bar ' + B.bar + ')');
        }
        expect(!t.errors.length, name + ': no page errors (' + t.errors.join(' | ') + ')');
        await t.ctx.close();
      }
    }
    console.log('--- switch off: the update bar keeps its place ---');
    {
      const t = await staffOnSheet(browser, origin, { flags: 'off' });
      const B = await updateBar(t.page);
      expect(B.shown && B.bottom, 'switch off: the new-version bar stays at the bottom of the window (' + B.bar + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-chat-switch-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });

async function clientOnSheet(browser, origin) {
  // The client link opened on its Sheet tab (the recorder goes in before the page loads).
  const t = await open(browser, origin, { stage: 'client', flags: 'on', finished: true, flagDelay: 400 });
  await t.page.addInitScript(RECORDER);
  // The link last left on Sheet: the Calendar remembers the view.
  await t.page.addInitScript(() => { try { localStorage.setItem('syncview_calendar_prefs', JSON.stringify({ view: 'organizer' })); } catch (e) {} });
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  return t;
}

async function openWho(browser, origin, who, dark) {
  if (who === 'client') {
    const t = await open(browser, origin, { stage: 'client', flags: 'on', thread: true, dark });
    await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
    await waitNew(t); await sleep(1200);
    return t;
  }
  const t = await open(browser, origin, { stage: who, staff: STAFF, flags: 'on', thread: true, dark });
  if (who === 'smm') {
    await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
    await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
    await t.page.evaluate(() => onCalViewChange('smmreview'));
  } else {
    await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  }
  await waitNew(t); await sleep(1200);
  return t;
}

// The conversation panel as drawn: bubble sizes and sides, colours against the panel, the long note.
function chatLook(page) {
  return page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const chat = r.getElementById('chat'), sc = r.getElementById('tscroll');
    const sr = sc.getBoundingClientRect();
    const bubs = Array.from(sc.querySelectorAll('.bub')).filter(b => b.getClientRects().length);
    const sides = bubs.map(b => { const x = b.getBoundingClientRect(); return (b.classList.contains('you') ? 'Y' : 'O') + (Math.abs(x.right - sr.right) < 24 && x.left - sr.left > 24 ? 'r' : Math.abs(x.left - sr.left) < 24 && sr.right - x.right > 24 ? 'l' : '?'); });
    const chatBg = getComputedStyle(chat).backgroundColor;
    const bgs = bubs.map(b => getComputedStyle(b.querySelector('.bb')).backgroundColor);
    const shadows = bubs.map(b => getComputedStyle(b.querySelector('.bb')).boxShadow);
    const lb = Array.from(sc.querySelectorAll('.bt')).find(e => /Please use this caption/.test(e.textContent));
    const foot = r.querySelector('.ch-foot');
    return {
      bubbles: bubs.length,
      widest: Math.max(0, ...bubs.map(b => b.getBoundingClientRect().width / sr.width)),
      sides: sides.join(' '),
      mineRight: sides.filter(x => x[0] === 'Y').every(x => x[1] === 'r'),
      othersLeft: sides.filter(x => x[0] === 'O').every(x => x[1] === 'l'),
      bg: chatBg + ' vs ' + Array.from(new Set(bgs)).join(' | '),
      bubbleBgDiffers: bgs.every(c => c !== chatBg && c !== 'rgba(0, 0, 0, 0)'),
      shadows: Array.from(new Set(shadows)).join(' | '),
      sideBar: shadows.some(s => /inset\s*$/.test(s) ? false : /(-?3px) 0px 0px 0px/.test(s)),
      tagged: bubs.every(b => !!b.querySelector('.bh .tag .pdot')),
      boxLast: !!foot && !!foot.querySelector('textarea') && foot.getBoundingClientRect().top >= sr.bottom - 1,
      long: lb ? { clamped: lb.classList.contains('clamp') && lb.scrollHeight > lb.clientHeight + 4, paras: getComputedStyle(lb).whiteSpace === 'pre-wrap' && /\n\n/.test(lb.textContent), more: !!lb.nextElementSibling && lb.nextElementSibling.matches('[data-more]') } : null,
    };
  });
}

// The page's own update bar (350) with its own look, shown while the stage is up: does it cover a stage button?
function updateBar(page) {
  return page.evaluate(async () => {
    if (!document.getElementById('svUpBarProbeStyle')) {
      const st = document.createElement('style');
      st.id = 'svUpBarProbeStyle';
      st.textContent = '#svUpdateBar{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:12px;padding:10px 12px 10px 18px;width:560px;height:48px;box-sizing:border-box}';
      document.head.appendChild(st);
    }
    const bar = document.createElement('div');
    bar.id = 'svUpdateBar';
    bar.textContent = 'A new version of SyncView is available';
    document.body.appendChild(bar);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = bar.getBoundingClientRect();
    const h = document.getElementById('svReviewStage');
    const r = h && h.shadowRoot;
    const btns = r ? Array.from(r.querySelectorAll('#drow button, .finish, .b-ok, .b-ask, .b-frame, .b-soft, .send, #sendBtn')).filter(e => e.getClientRects().length) : [];
    const covers = btns.filter(e => { const x = e.getBoundingClientRect(); return x.right > b.left && x.left < b.right && x.bottom > b.top && x.top < b.bottom; }).map(e => (e.textContent || e.getAttribute('aria-label') || e.className).trim().slice(0, 30));
    const out = { shown: b.width > 0, bar: [b.x, b.y, b.width, b.height].map(Math.round).join(','), covers, bottom: Math.abs(innerHeight - 22 - b.bottom) < 2 };
    bar.remove();
    return out;
  });
}
