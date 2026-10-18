'use strict';
/*
 * THE CLIENT LINK AS ONE PAGE under the new review page's header (owner feedback 2026-10-17, session Curtain Two).
 * Real browser, fully offline, the same mocked backend as review-stage-browser.js (fictional client, cards and token).
 *
 * With review_stage_client_pages on for the client, it proves, at 1440x900 and at 390 wide (phone):
 *   - ONE header on Review, Sheet, Month and Week: the new one. No old Analytics / Content Calendar toggle, no old
 *     calendar bar (title, view toggle), no phone "Calendar" heading;
 *   - the pill toggle and the sun/moon button sit at exactly the same place on all four tabs;
 *   - Sheet, Month and Week show only their own view (no review stage, no strip of waiting posts under them);
 *   - Organize and the card size sit in the header on Sheet (in the old bar's place, inside the new header);
 *   - no Analytics anywhere: no toggle, no header item, and an Analytics address lands on the Content Calendar;
 *   - Review fills the window: no frame around it (no page padding, one background), and at 1440x900 the page
 *     does not scroll; no sideways scroll at 390 on any tab;
 *   - no "Watch the video with its notes" hover text on the video (the client page, and the staff Sheet's play icon);
 *   - the video step plays in the Frame.io player when frame_viewer_clients allows the client, and shows the plain
 *     "opens in a new tab" stage when it does not.
 * With the switch off (and Analytics brought back by analytics_hidden { hidden: false }) the client link keeps
 * today's page (old header, Analytics toggle, no new page).
 *
 * The Sheet and the strip on a desktop (owner feedback 2026-10-17, session Curtain Three), with the switch on:
 *   - at 1440x900 and 1920x1080, small and medium cards: the row of cards sits in the middle of the space under
 *     the header (top gap = bottom gap) and has the same margin left and right;
 *   - zoomed in on a short window (taller than the space): the cards start at the top and the page scrolls; back on
 *     a tall window the same cards are centred again (re-checked on zoom and resize);
 *   - light mode: Organize and the card size wear the header's pill fill, not the page background;
 *   - the "waiting for you" strip ends where the header ends (its right margin) and fades out when more posts
 *     are to the right; scrolled to the end the last post ends inside that margin;
 *   - a bare link (no v=) with a slow switch read: a switched-on client never sees the Analytics skeleton once this
 *     browser has seen it switched on; switch off, Analytics starts without waiting for the switch, and it still opens
 *     on Analytics.
 * CLIENT_LAYOUT_SHOTS=<dir> also writes the screenshots used in the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, openClient, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.CLIENT_LAYOUT_SHOTS || '';
const TABS = ['review', 'organizer', 'month', 'week'];
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(700); await t.page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
async function tab(t, v) {
  await t.page.evaluate(x => onCalViewChange(x), v);
  await t.page.waitForFunction(x => typeof calState === 'object' && calState.view === x, v, { timeout: 15000 });
  await sleep(900);
}

// What the page shows right now: every header-like thing that is visible, where the toggle sits, and the frame.
function look(page) {
  return page.evaluate(() => {
    const vis = el => !!el && el.isConnected && !el.closest('[hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','); };
    const host = document.getElementById('svReviewStage');
    const r = host && host.shadowRoot;
    const q = id => r ? r.getElementById(id) : null;
    const textOf = root => { const out = []; const w = n => { for (const e of n.querySelectorAll('*')) { if (e.shadowRoot) w(e.shadowRoot); if (!e.children.length && vis(e) && e.textContent.trim()) out.push(e.textContent.trim()); } }; w(root); return out; };
    const se = document.scrollingElement;
    const main = document.getElementById('mainWrap');
    const rs = r && r.querySelector('.rs');
    return {
      newHeader: vis(host) && vis(q('rsTabs')),
      oldClientToggle: Array.from(document.querySelectorAll('.view-tab-toggle')).some(vis),
      oldBarTitle: Array.from(document.querySelectorAll('.cal-embed-title, .cal-toolbar-left')).some(vis),
      oldViewToggle: Array.from(document.querySelectorAll('.cal-view-toggle')).some(vis),
      phoneHeading: Array.from(document.querySelectorAll('.pocket-client-calendar')).some(vis),
      tabs: box(q('rsTabs')), theme: box(q('rsTheme')),
      active: (r && r.querySelector('#rsTabs .cal-view-btn.active') || {}).dataset ? r.querySelector('#rsTabs .cal-view-btn.active').dataset.tab : '',
      stage: vis(q('stage')), strip: vis(q('strip')),
      organize: vis(document.getElementById('calOrganizeBtn')) && !!document.getElementById('calOrganizeBtn').closest('#svReviewStage'),
      zoom: vis(document.getElementById('calZoomCtl')) && !!document.getElementById('calZoomCtl').closest('#svReviewStage'),
      analytics: textOf(document).filter(t => /analytics/i.test(t)),
      hostTop: host ? Math.round(host.getBoundingClientRect().top + scrollY) : -1,
      hostW: host ? Math.round(host.getBoundingClientRect().width) : 0,
      mainPad: main ? getComputedStyle(main).padding : '',
      rsBg: rs ? getComputedStyle(rs).backgroundColor : '',
      bodyBg: getComputedStyle(document.body).backgroundColor,
      scrollH: se.scrollHeight, clientH: se.clientHeight, scrollW: se.scrollWidth, clientW: se.clientWidth,
      url: location.search,
    };
  });
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      console.log('--- client link, switch on, ' + label + ' (' + w + 'x' + h + ') ---');
      const t = await openClient(browser, origin, { flags: 'on', width: w, height: h, tab: 'review', finished: true });
      await waitNew(t);
      await sleep(1200);
      const seen = {};
      for (const v of TABS) {
        await tab(t, v);
        const L = await look(t.page);
        seen[v] = L;
        const name = label + ' ' + v;
        expect(L.newHeader, name + ': the new header shows');
        expect(!L.oldClientToggle && !L.oldBarTitle && !L.oldViewToggle && !L.phoneHeading, name + ': no second header (old toggle ' + L.oldClientToggle + ', old bar ' + L.oldBarTitle + ', old view toggle ' + L.oldViewToggle + ', phone heading ' + L.phoneHeading + ')');
        expect(L.active === v, name + ': the pill toggle marks this tab (' + L.active + ')');
        expect(L.analytics.length === 0, name + ': no Analytics anywhere (' + L.analytics.join('|') + ')');
        expect(L.scrollW <= L.clientW, name + ': no sideways scroll (' + L.scrollW + ' > ' + L.clientW + ')');
        if (v === 'review') {
          expect(L.stage && L.strip, name + ': the stage and the strip show');
          expect(L.hostTop === 0 && L.hostW === w, name + ': the page has no frame around it (top ' + L.hostTop + ', width ' + L.hostW + ' of ' + w + ')');
          expect(/^0px/.test(L.mainPad) && L.mainPad.replace(/0px/g, '').trim() === '', name + ': no page padding around the stage (' + L.mainPad + ')');
          expect(L.rsBg === 'rgba(0, 0, 0, 0)', name + ': one background, the page\'s (stage background ' + L.rsBg + ' over ' + L.bodyBg + ')');
          if (label === 'desktop') expect(L.scrollH <= L.clientH, name + ': the page does not scroll at 1440x900 (' + L.scrollH + ' > ' + L.clientH + ')');
        } else {
          expect(!L.stage && !L.strip, name + ': only its own view, no review stage under it');
        }
        if (v === 'organizer' && label === 'desktop') expect(L.organize && L.zoom, name + ': Organize and the card size sit in the new header');
        await shot(t, 'after-client-' + v + '-' + w);
      }
      expect(TABS.every(v => seen[v].tabs === seen.review.tabs), label + ': the pill toggle never moves (' + TABS.map(v => v + ' ' + seen[v].tabs).join('; ') + ')');
      expect(TABS.every(v => seen[v].theme === seen.review.theme), label + ': the sun/moon button never moves (' + TABS.map(v => v + ' ' + seen[v].theme).join('; ') + ')');

      if (label === 'desktop') {
        // The client page's video: no "with its notes" hover text over it.
        await tab(t, 'review');
        const fv = t.page.locator('#svReviewStage').locator('#fvHost');
        await fv.hover();
        await sleep(600);
        const tip = await t.page.evaluate(() => { const g = document.getElementById('globalTooltip'); const all = []; const w = n => { for (const e of n.querySelectorAll('[title],[data-tip]')) all.push(e.getAttribute('title') || e.getAttribute('data-tip')); for (const e of n.querySelectorAll('*')) if (e.shadowRoot) w(e.shadowRoot); }; w(document); return { tip: g ? g.textContent : '', titles: all.filter(x => /with its notes/i.test(x)) }; });
        expect(!/with its notes/i.test(tip.tip) && !tip.titles.length, 'hover: no "Watch the video with its notes" over the video (' + tip.tip + ' | ' + tip.titles.join('|') + ')');
        // An Analytics route lands on the Content Calendar.
        await t.page.evaluate(n => setClientViewTab(encodeURIComponent(n), 'analytics'), CLIENT);
        await sleep(1500);
        const a = await look(t.page);
        expect(!!(await t.page.evaluate(() => document.getElementById('calView'))) && a.analytics.length === 0, 'route: asking for Analytics shows the Content Calendar, not Analytics (' + a.analytics.join('|') + ')');
      }
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // A bare client link (no v=): Analytics used to be its first page; now the Content Calendar, and the address says so.
    console.log('--- bare client link (no view in the address), switch on ---');
    {
      const t = await open(browser, origin, { stage: 'client', flags: 'on' });
      const { TOKEN } = require('./fixtures/review-stage-fixture.js');
      await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN }), { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => !!document.getElementById('svReviewStage') && !document.getElementById('svReviewStage').hidden, null, { timeout: 30000 }).catch(() => null);
      await sleep(1500);
      const L = await look(t.page);
      expect(L.newHeader && L.analytics.length === 0, 'bare link: the new page shows, no Analytics (' + L.analytics.join('|') + ')');
      expect(/[?&]v=calendar\b/.test(L.url), 'bare link: the address now says v=calendar (' + L.url + ')');
      expect(t.errors.length === 0, 'bare link: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // THE SHEET ON A DESKTOP (session Curtain Three): centred both ways when the cards fit, top and scrolling when not.
    const sheet = page => page.evaluate(() => {
      const host = document.getElementById('svReviewStage');
      const strip = document.getElementById('calStrip');
      const cards = Array.from(document.querySelectorAll('#calStrip > .cal-card')).filter(c => c.getClientRects().length);
      const r = cards.map(c => c.getBoundingClientRect());
      const bg = el => el ? getComputedStyle(el).backgroundColor : '';
      const sr = host && host.shadowRoot;
      return {
        head: Math.round(host.getBoundingClientRect().bottom), vh: innerHeight, vw: document.documentElement.clientWidth,
        top: Math.round(Math.min(...r.map(x => x.top))), bottom: Math.round(Math.max(...r.map(x => x.bottom))),
        left: Math.round(r[0].left), right: Math.round(r[r.length - 1].right), n: cards.length,
        sideScroll: strip.scrollWidth > strip.clientWidth + 1,
        pageScroll: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight,
        pageBg: bg(document.body), tabsBg: bg(sr && sr.getElementById('rsTabs')),
        orgBg: bg(document.getElementById('calOrganizeBtn')), zoomBg: bg(document.getElementById('calZoomCtl')),
        zoom: (document.getElementById('calView') || {}).dataset ? document.getElementById('calView').dataset.zoom : '',
      };
    });
    const sheetEnd = page => page.evaluate(() => { const s = document.getElementById('calStrip'); s.scrollLeft = s.scrollWidth; const c = Array.from(s.querySelectorAll(':scope > .cal-card')); const x = c[c.length - 1].getBoundingClientRect().right; s.scrollLeft = 0; return Math.round(x); });
    async function zoomTo(t, z) {
      for (let i = 0; i < 3; i++) {
        const cur = await t.page.evaluate(() => document.getElementById('calView').dataset.zoom || 'm');
        if (cur === z) break;
        await t.page.locator('#svReviewStage ' + ('sml'.indexOf(z) > 'sml'.indexOf(cur) ? '#calZoomIn' : '#calZoomOut')).click();
        await sleep(400);
      }
    }
    function centred(S, name) {
      const topGap = S.top - S.head, bottomGap = S.vh - S.bottom;
      expect(S.n > 0 && Math.abs(topGap - bottomGap) <= 6, name + ': the cards sit in the middle of the space under the header (top gap ' + topGap + ', bottom gap ' + bottomGap + ')');
    }
    async function evenSides(t, S, name) {
      const rightGap = (S.sideScroll ? S.vw - await sheetEnd(t.page) : S.vw - S.right);
      expect(Math.abs(S.left - rightGap) <= 2, name + ': the same margin left and right (left ' + S.left + ', right ' + rightGap + (S.sideScroll ? ', scrolled to the end' : '') + ')');
    }
    for (const [w, h, dark] of [[1440, 900, false], [1920, 1080, false], [1440, 900, true]]) {
      const theme = dark ? 'dark' : 'light';
      console.log('--- Sheet, switch on, ' + w + 'x' + h + ' ' + theme + ' ---');
      const t = await openClient(browser, origin, { flags: 'on', width: w, height: h, tab: 'review', finished: true, dark });
      await waitNew(t);
      await sleep(1000);
      await tab(t, 'organizer');
      for (const z of ['s', 'm']) {
        await zoomTo(t, z);
        const S = await sheet(t.page);
        const name = 'Sheet ' + w + 'x' + h + ' ' + theme + ' ' + S.zoom;
        expect(S.zoom === z, name + ': the card size is ' + z);
        centred(S, name);
        await evenSides(t, S, name);
        if (!dark) {
          expect(S.orgBg !== S.pageBg && S.orgBg === S.tabsBg, name + ': Organize has a visible pill, the header\'s (' + S.orgBg + ' on ' + S.pageBg + ', header pill ' + S.tabsBg + ')');
          expect(S.zoomBg !== S.pageBg && S.zoomBg === S.tabsBg, name + ': the card size has a visible pill, the header\'s (' + S.zoomBg + ' on ' + S.pageBg + ', header pill ' + S.tabsBg + ')');
        }
      }
      if (w === 1440 && !dark) {
        // Zoomed in on a short window: taller than the space, so the top of the cards stays under the header and the page scrolls.
        await t.page.setViewportSize({ width: 1440, height: 520 });
        await zoomTo(t, 'l');
        await sleep(500);
        let S = await sheet(t.page);
        expect(S.zoom === 'l' && S.bottom - S.top > S.vh - S.head, 'Sheet 1440x520 large: the cards are taller than the space under the header (' + (S.bottom - S.top) + ' > ' + (S.vh - S.head) + ')');
        expect(S.top - S.head <= 24 && S.pageScroll, 'Sheet 1440x520 large: the cards start at the top and the page scrolls (top gap ' + (S.top - S.head) + ', scrolls ' + S.pageScroll + ')');
        await evenSides(t, S, 'Sheet 1440x520 large');
        // A taller window: the same cards are centred again, with no reload.
        await t.page.setViewportSize({ width: 1440, height: 1000 });
        await sleep(500);
        S = await sheet(t.page);
        centred(S, 'Sheet resized to 1440x1000 large');
        // Back to small: centred again.
        await zoomTo(t, 's');
        S = await sheet(t.page);
        centred(S, 'Sheet 1440x1000 zoomed back to small');
        await t.page.setViewportSize({ width: 1440, height: 900 });
        await sleep(300);
      }
      if (w === 1440) {
        // The strip of waiting posts: the header's right margin, a fade when more are to the right.
        await tab(t, 'review');
        const edge = () => t.page.evaluate(() => {
          const r = document.getElementById('svReviewStage').shadowRoot;
          const sl = r.getElementById('skList'), th = r.getElementById('rsTheme');
          const chips = Array.from(sl.querySelectorAll('.chipp'));
          const cs = getComputedStyle(sl);
          return { list: Math.round(sl.getBoundingClientRect().right), theme: Math.round(th.getBoundingClientRect().right), more: sl.scrollWidth > sl.clientWidth + 1 && sl.scrollLeft < sl.scrollWidth - sl.clientWidth - 1,
            mask: cs.maskImage || cs.webkitMaskImage || 'none', last: Math.round(chips[chips.length - 1].getBoundingClientRect().right) };
        });
        let E = await edge();
        expect(E.list <= E.theme, 'strip ' + theme + ': it ends where the header ends (strip ' + E.list + ', header ' + E.theme + ' of ' + w + ')');
        expect(E.more && /gradient/.test(E.mask), 'strip ' + theme + ': more posts to the right, so it fades out before the edge (' + E.mask.slice(0, 40) + ')');
        await t.page.evaluate(() => { const sl = document.getElementById('svReviewStage').shadowRoot.getElementById('skList'); sl.scrollLeft = sl.scrollWidth; });
        await sleep(300);
        E = await edge();
        expect(!E.more && !/gradient/.test(E.mask) && E.last <= E.theme, 'strip ' + theme + ': scrolled to the end, no fade and the last post ends inside the margin (' + E.last + ' <= ' + E.theme + ', ' + E.mask.slice(0, 20) + ')');
      }
      if (SHOTS) { await tab(t, 'organizer'); await shot(t, 'after-client-sheet-' + theme + '-' + w); }
      expect(t.errors.length === 0, 'Sheet ' + w + ' ' + theme + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // A bare link while the switch is slow to read (1.5 s, as live): no Analytics skeleton, ever, for a switched-on
    // client. Switch off, with Analytics brought back (analytics_hidden { hidden: false }, session Curtain Seven): the
    // same link still opens on Analytics. (Analytics hidden, its default, is test/review-feedback-seven-browser.js.)
    for (const flags of ['on', 'off']) {
      console.log('--- bare client link, slow switch read, switch ' + flags + ' ---');
      const t = await open(browser, origin, Object.assign({ stage: 'client', flags, flagDelay: 1500, finished: true }, flags === 'off' ? { analytics: 'shown' } : {}));
      await t.page.addInitScript(() => {
        window.__svSawAnalytics = false;
        // What a person would see: an Analytics loader or skeleton on screen (the page carries hidden copies).
        const look = () => { for (const e of document.querySelectorAll('[data-client-entry-loading="analytics"], .analytics-skel-metric')) if (e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden') { window.__svSawAnalytics = true; return; } };
        setInterval(look, 25);
      });
      const { TOKEN } = require('./fixtures/review-stage-fixture.js');
      await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN }), { waitUntil: 'domcontentloaded' });
      if (flags === 'on') {
        // First visit in this browser: the switch is not known yet, so the page does not wait for it (other clients
        // must not); it lands on the Content Calendar once the switch is read.
        await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!h && !h.hidden; }, null, { timeout: 30000 }).catch(() => null);
        await sleep(800);
        let r = await t.page.evaluate(() => ({ url: location.search, page: !!document.getElementById('svReviewStage'), seen: localStorage.getItem('sv-rs-no-analytics:' + new URLSearchParams(location.search).get('c')) }));
        expect(r.page && /[?&]v=calendar\b/.test(r.url), 'bare link, slow switch, first visit: it ends on the Content Calendar (' + r.url + ')');
        expect(r.seen === '1', 'bare link, slow switch, first visit: the browser remembers this client is switched on (' + r.seen + ')');
        // Every later visit in this browser: the Analytics skeleton never shows.
        await t.page.evaluate(() => { window.__svSawAnalytics = false; });
        await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN }), { waitUntil: 'domcontentloaded' });
        await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!h && !h.hidden; }, null, { timeout: 30000 }).catch(() => null);
        await sleep(800);
        r = await t.page.evaluate(() => ({ saw: window.__svSawAnalytics, url: location.search, page: !!document.getElementById('svReviewStage') }));
        expect(r.page && !r.saw, 'bare link, slow switch, later visit: the Analytics skeleton never shows (saw it ' + r.saw + ')');
        expect(/[?&]v=calendar\b/.test(r.url), 'bare link, slow switch, later visit: it opens on the Content Calendar (' + r.url + ')');
      } else {
        // Switch off: Analytics starts without waiting for the slow switch read (1.5 s here), as on main.
        const t0 = Date.now();
        await t.page.waitForFunction(() => window.__svSawAnalytics === true, null, { timeout: 8000 }).catch(() => null);
        const firstPaint = Date.now() - t0;
        expect(firstPaint < 1200, 'bare link, switch off: Analytics shows without waiting for the switch read (' + firstPaint + ' ms, read takes 1500)');
        await sleep(4000);
        const r = await t.page.evaluate(() => ({ saw: window.__svSawAnalytics, url: location.search, cal: !!document.getElementById('calView'), rs: !!document.getElementById('svReviewStage') }));
        expect(r.saw && !r.cal && !r.rs && !/[?&]v=/.test(r.url), 'bare link, switch off: still opens on Analytics, as before (Analytics ' + r.saw + ', calendar ' + r.cal + ', ' + r.url + ')');
      }
      expect(t.errors.length === 0, 'bare link, switch ' + flags + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // The cards cannot be read: the new header stays (no old bar, no Analytics), the calendar's own error under it.
    console.log('--- client link, switch on, card read fails ---');
    {
      const t = await openClient(browser, origin, { flags: 'on', tab: 'review', postsFail: true });
      await t.page.waitForFunction(() => typeof calState === 'object' && !!calState.error, null, { timeout: 45000 }).catch(() => null);
      await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!h && !h.hidden; }, null, { timeout: 30000 }).catch(() => null);
      await sleep(1200);
      const L = await look(t.page);
      const err = await t.page.evaluate(() => !!(typeof calState === 'object' && calState.error));
      expect(err, 'read fails: the calendar is in its error state');
      expect(L.newHeader && !L.oldClientToggle && !L.oldBarTitle && L.analytics.length === 0, 'read fails: still one header, the new one, and no Analytics (old toggle ' + L.oldClientToggle + ', old bar ' + L.oldBarTitle + ', ' + L.analytics.join('|') + ')');
      await t.ctx.close();
    }

    // The video step: the Frame.io player with frame_viewer_clients on, the plain stage with it off.
    for (const frame of ['on', 'off']) {
      console.log('--- video step, frame_viewer_clients ' + frame + ' ---');
      const t = await openClient(browser, origin, { flags: 'on', frame, tab: 'review' });
      await waitNew(t);
      await sleep(1500);
      const v = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const view = r.getElementById('view'); return { step: (r.querySelector('.stp.on') || {}).dataset ? r.querySelector('.stp.on').dataset.step : '', player: !!r.querySelector('#fvHost .fv-player'), novid: view.classList.contains('novid'), msg: (r.getElementById('novidMsg') || {}).textContent || '' }; });
      expect(v.step === 'video', frame + ': the stage opens on the video step');
      if (frame === 'on') {
        expect(v.player && !v.novid, 'frame on: the video step uses the Frame.io player');
        await t.page.locator('#svReviewStage').locator('#fvHost .fv-play').click();
        let playing = false;
        for (let i = 0; i < 50 && !playing; i++) { await sleep(150); playing = await t.page.evaluate(() => { const vid = document.getElementById('svReviewStage').shadowRoot.querySelector('#fvHost video'); return !!vid && !vid.paused && vid.currentTime > 0; }); }
        expect(playing, 'frame on: pressing play plays the video in the Frame.io player');
        await shot(t, 'after-client-video-frameio-1440');
      } else {
        expect(!v.player && v.novid && /new tab/i.test(v.msg), 'frame off: the video step shows the plain stage, no Frame.io player (' + v.msg + ')');
      }
      expect(t.errors.length === 0, 'frame ' + frame + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // The staff Sheet's play icon: no hover tooltip either.
    console.log('--- staff Sheet, play icon hover ---');
    {
      const t = await open(browser, origin, { stage: 'client', flags: 'off', staff: STAFF, finished: true });
      await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('organizer'));
      const play = t.page.locator('.cal-thumb-play:not([hidden])').first();
      await play.waitFor({ state: 'attached', timeout: 15000 });
      await play.hover({ force: true });
      await sleep(500);
      const tip = await t.page.evaluate(() => { const g = document.getElementById('globalTooltip'); return { tip: g ? g.textContent : '', title: document.querySelector('.cal-thumb-play').getAttribute('title') || '' }; });
      expect(!/with its notes/i.test(tip.tip) && !tip.title, 'staff Sheet: the play icon has no "with its notes" hover text (' + tip.tip + ' | ' + tip.title + ')');
      await t.ctx.close();
    }

    // Switch off (and Analytics brought back): the client link is today's page.
    console.log('--- client link, switch off ---');
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const t = await openClient(browser, origin, { flags: 'off', analytics: 'shown', width: w, height: h, tab: 'review', finished: true });
      await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
      await sleep(1200);
      for (const v of TABS) {
        await tab(t, v);
        const L = await look(t.page);
        expect(!L.newHeader && !(await t.page.evaluate(() => document.documentElement.classList.contains('sv-rs-full'))), 'off ' + w + ' ' + v + ': no new header');
        if (w === 1440) expect(L.oldClientToggle && L.analytics.length > 0, 'off ' + w + ' ' + v + ': the old Analytics / Content Calendar toggle is still there');
        await shot(t, 'flagoff-client-' + v + '-' + w);
      }
      expect(t.errors.length === 0, 'off ' + w + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-client-layout-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-client-layout-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
