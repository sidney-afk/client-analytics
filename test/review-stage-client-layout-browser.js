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
 * With the switch off the client link keeps today's page (old header, Analytics toggle, no new page).
 * CLIENT_LAYOUT_SHOTS=<dir> also writes the screenshots used in the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, openClient, waitNew, sleep } = require('./review-stage-fixture.js');

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
      const { TOKEN } = require('./review-stage-fixture.js');
      await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN }), { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => !!document.getElementById('svReviewStage') && !document.getElementById('svReviewStage').hidden, null, { timeout: 30000 }).catch(() => null);
      await sleep(1500);
      const L = await look(t.page);
      expect(L.newHeader && L.analytics.length === 0, 'bare link: the new page shows, no Analytics (' + L.analytics.join('|') + ')');
      expect(/[?&]v=calendar\b/.test(L.url), 'bare link: the address now says v=calendar (' + L.url + ')');
      expect(t.errors.length === 0, 'bare link: no page errors (' + t.errors.join(' | ') + ')');
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

    // Switch off: the client link is today's page.
    console.log('--- client link, switch off ---');
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const t = await openClient(browser, origin, { flags: 'off', width: w, height: h, tab: 'review', finished: true });
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
