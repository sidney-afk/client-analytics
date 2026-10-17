'use strict';
/*
 * THE STAFF CALENDAR'S REVIEW TAB UNDER THE STAFF BAR (owner feedback 2026-10-17, session Curtain Four).
 * Real browser, fully offline, the same mocked backend as review-stage-browser.js (fictional client, cards and staff).
 *
 * An SMM viewing a client whose review_stage_client_pages switch is on, at 1440x900 and 1920x1080, light and dark:
 *   - the Review | Sheet | Month | Week toggle has the same bounding box, size and button order on all four tabs
 *     (it is the Calendar's own bar on every tab; Review no longer draws a second one on the right);
 *   - the Review tab has no second "<client> Content calendar" heading and no second toggle: the new page draws no
 *     header of its own on the staff side, and the client's name shows as often as it does on Sheet;
 *   - the new page sits straight under the bar, at the same gap as Sheet's cards, on the page's own background
 *     (no frame of its own around it);
 * and with the switch off, the staff Calendar is today's page on all four tabs (no new page, the old list under
 * the same bar, the toggle in the same place).
 * STAFF_LAYOUT_SHOTS=<dir> also writes the screenshots used in the PR (<dir>/<on|off>-<tab>-<width>-<theme>.png).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.STAFF_LAYOUT_SHOTS || '';
const TABS = ['smmreview', 'organizer', 'month', 'week'];
const SIZES = [[1440, 900], [1920, 1080]];
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function openStaff(browser, origin, opt) {
  const t = await open(browser, origin, Object.assign({ stage: 'smm', staff: STAFF, finished: true }, opt));
  await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
  return t;
}
async function tab(t, v, flags) {
  await t.page.evaluate(x => onCalViewChange(x), v);
  await t.page.waitForFunction(x => typeof calState === 'object' && calState.view === x, v, { timeout: 15000 });
  if (v === 'smmreview') {
    if (flags === 'on') await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && !h.hidden && h.shadowRoot && h.shadowRoot.getElementById('stepper') && h.shadowRoot.getElementById('stepper').children.length); }, null, { timeout: 30000 });
    else await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
  }
  await sleep(1200);
}

function look(page, client) {
  return page.evaluate((client) => {
    const vis = el => !!el && el.isConnected && !el.closest('[hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
    const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => Math.round(n)).join(','); };
    const all = (root, sel) => { const out = Array.from(root.querySelectorAll(sel)); for (const e of root.querySelectorAll('*')) if (e.shadowRoot) out.push(...all(e.shadowRoot, sel)); return out; };
    const cv = document.getElementById('calView');
    const bar = cv && cv.querySelector(':scope > .cal-toolbar');
    const toggle = bar && bar.querySelector('.cal-view-toggle');
    const host = document.getElementById('svReviewStage');
    const r = host && host.shadowRoot;
    const body = cv && cv.querySelector(':scope > .cal-body');
    const rs = r && r.querySelector('.rs');
    // Every visible view toggle (a group of Review / Sheet / Month / Week buttons), light DOM and shadow.
    const toggles = all(document, '.cal-view-toggle, nav.tabs').filter(vis);
    // Every visible heading that names the client.
    const headings = all(document, 'h1, h2, h3, .cal-embed-title, .hdr-who').filter(vis).filter(e => e.textContent.includes(client));
    const stageText = r ? Array.from(r.querySelectorAll('*')).filter(e => !e.children.length && vis(e)).map(e => e.textContent.trim()) : [];
    return {
      toggle: vis(toggle) ? box(toggle) : null,
      order: toggle ? Array.from(toggle.querySelectorAll('button')).filter(vis).map(b => b.textContent.replace(/\d+/g, '').trim()) : [],
      toggles: toggles.length,
      headings: headings.map(e => e.tagName.toLowerCase() + ':' + e.textContent.trim().slice(0, 40)),
      stageHeader: !!(r && (r.querySelector('.hdr') || r.getElementById('rsName') || r.getElementById('rsTabs'))),
      contentCalendarText: stageText.filter(x => /content calendar/i.test(x)).length,
      newPage: vis(host) && !!(r && vis(r.getElementById('stage'))),
      oldBody: vis(body),
      oldList: !!document.querySelector('.kcard[data-cal-review-pid="rs1"]') && vis(document.querySelector('.kcard[data-cal-review-pid="rs1"]')),
      barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : -1,
      bodyTop: vis(body) ? Math.round(body.getBoundingClientRect().top) : -1,
      hostTop: vis(host) ? Math.round(host.getBoundingClientRect().top) : -1,
      rsBg: rs ? getComputedStyle(rs).backgroundColor : '',
      rsCls: document.documentElement.className.split(/\s+/).filter(c => /^sv-rs/.test(c)).join(' '),
      scrollW: document.scrollingElement.scrollWidth, clientW: document.scrollingElement.clientWidth,
    };
  }, client);
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const onToggle = {};
  try {
    for (const flags of ['on', 'off']) {
      for (const [w, h] of SIZES) {
        for (const theme of ['light', 'dark']) {
          const label = 'switch ' + flags + ', ' + w + 'x' + h + ', ' + theme;
          console.log('--- staff Calendar, ' + label + ' ---');
          const t = await openStaff(browser, origin, { flags, width: w, height: h, dark: theme === 'dark' });
          const seen = {};
          for (const v of TABS) {
            await tab(t, v, flags);
            const L = await look(t.page, CLIENT);
            seen[v] = L;
            const name = label + ' ' + v;
            expect(!!L.toggle, name + ': the toggle shows in the Calendar\'s own bar');
            expect(L.toggles === 1, name + ': one view toggle on the page (' + L.toggles + ')');
            expect(L.order.join('|') === 'Review|Sheet|Month|Week', name + ': the toggle reads Review | Sheet | Month | Week (' + L.order.join('|') + ')');
            expect(L.scrollW <= L.clientW, name + ': no sideways scroll (' + L.scrollW + ' > ' + L.clientW + ')');
            if (flags === 'on' && v === 'smmreview') {
              expect(L.newPage && !L.oldList, name + ': the new review page shows, the old list does not');
              expect(!L.stageHeader && L.contentCalendarText === 0, name + ': the new page draws no header of its own (no second "Content calendar" heading)');
              expect(L.hostTop === L.barBottom + 8, name + ': the new page sits straight under the bar (bar ends ' + L.barBottom + ', page starts ' + L.hostTop + ')');
              expect(L.rsBg === 'rgba(0, 0, 0, 0)', name + ': the new page has no background of its own, no frame (' + L.rsBg + ')');
              // The Calendar's dialogs live inside #calView too: the menu's Caption prompt, Thumbnail title prompt,
              // Platform and Import open them, so they must still show on the Review tab.
              const hidden = await t.page.evaluate(() => ['calPromptOverlay', 'calImportOverlay', 'calPreviewOverlay', 'calLightbox', 'calCommentsOverlay'].filter((id) => {
                const el = document.getElementById(id);
                if (!el) return false;
                el.classList.add('open');
                const none = getComputedStyle(el).display === 'none';
                el.classList.remove('open');
                return none;
              }));
              expect(hidden.length === 0, name + ': the Calendar dialogs can still open on Review (hidden: ' + hidden.join(', ') + ')');
            } else if (flags === 'off') {
              expect(!L.newPage && !L.rsCls, name + ': no new page and no switch classes (' + L.rsCls + ')');
              if (v === 'smmreview') expect(L.oldList, name + ': the old review list shows');
            }
            if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await sleep(500); await t.page.screenshot({ path: path.join(SHOTS, flags + '-' + (v === 'smmreview' ? 'review' : v === 'organizer' ? 'sheet' : v) + '-' + w + '-' + theme + '.png') }); }
          }
          expect(TABS.every(v => seen[v].toggle === seen.organizer.toggle), label + ': the toggle never moves (' + TABS.map(v => v + ' ' + seen[v].toggle).join('; ') + ')');
          expect(TABS.every(v => seen[v].headings.length === seen.organizer.headings.length), label + ': the client\'s name heads Review no more often than Sheet (' + TABS.map(v => v + ' ' + seen[v].headings.length).join('; ') + ')');
          if (flags === 'on') {
            const gapSheet = seen.organizer.bodyTop - seen.organizer.barBottom, gapReview = seen.smmreview.hostTop - seen.smmreview.barBottom;
            expect(gapSheet === gapReview, label + ': Review starts the same gap under the bar as Sheet (' + gapReview + ' vs ' + gapSheet + ')');
            onToggle[w + theme] = seen.organizer.toggle;
          } else {
            expect(seen.organizer.toggle === onToggle[w + theme], label + ': the toggle sits where it does with the switch on (' + seen.organizer.toggle + ' vs ' + onToggle[w + theme] + ')');
          }
          expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
          await t.ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-staff-layout-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-staff-layout-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
