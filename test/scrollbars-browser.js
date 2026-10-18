'use strict';
/*
 * ONE SCROLLBAR FOR THE WHOLE APP (owner feedback 2026-10-17 23:40, session Curtain Nine).
 *
 * Every scrollbar (text boxes, lists, panels, dialogs, the page) looks like the review conversation panel's: 6px,
 * rounded, no track, the theme's soft thumb, in light and dark. One shared style (the last block of
 * 020-styles-surfaces), not one per place.
 *
 * In a real browser (Chromium), fully offline (the review-stage fixture), this measures the drawn scrollbar of:
 * the page itself, the staff Sheet's card strip (sideways), a caption box, a plain scrolling box with no style of its
 * own, and the review page's conversation panel (inside its shadow root), in light and dark; checks the thumb takes the
 * theme's colour token; and checks a scrollbar a place hides (the top navigation) stays hidden. Fails on main (the
 * page, the plain box and the caption box draw Chromium's 15px default or their own size).
 * Firefox draws no ::-webkit-scrollbar; it gets scrollbar-width: thin and the same colour (not run here).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, openClient, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

// Thickness of the drawn scrollbar: the box minus its inside, minus its borders.
const MEASURE = `(() => {
  const bar = (el, axis) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (axis === 'y') return el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    return el.offsetHeight - el.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
  };
  window.__sb = bar;
})()`;

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  // Playwright starts Chromium with --hide-scrollbars; this test must see them.
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    for (const dark of [false, true]) {
      const theme = dark ? 'dark' : 'light';
      console.log('--- staff Calendar, Sheet, ' + theme + ' ---');
      let t = await open(browser, origin, { stage: 'smm', flags: 'on', staff: STAFF, dark });
      await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('organizer'));
      await t.page.waitForSelector('.cal-organizer-strip', { timeout: 15000 });
      await sleep(1200);
      await t.page.evaluate(MEASURE);
      const m = await t.page.evaluate(() => {
        // a plain scrolling box with no scrollbar style of its own, and a tall page
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:10px;top:10px;width:200px;height:80px;overflow:auto;z-index:99999;background:var(--white)';
        box.innerHTML = '<div style="height:400px;width:600px">x</div>';
        document.body.appendChild(box);
        const tall = document.createElement('div'); tall.style.height = '3000px'; document.body.appendChild(tall);
        const strip = document.querySelector('.cal-organizer-strip');
        if (strip) { const pad = document.createElement('div'); pad.style.cssText = 'flex:0 0 4000px;height:10px'; strip.appendChild(pad); }
        const cap = document.querySelector('textarea.cal-fld-cap');
        if (cap) { cap.value = Array(80).fill('A long caption line.').join('\n'); cap.style.height = '60px'; cap.style.maxHeight = '60px'; cap.style.overflowY = 'auto'; }
        const nav = document.querySelector('.header-nav');
        const root = document.documentElement;
        const thumb = getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb').trim();
        return {
          page: window.innerWidth - root.clientWidth,
          box: window.__sb(box, 'y'), boxX: window.__sb(box, 'x'),
          strip: strip ? window.__sb(strip, 'x') : null,
          cap: cap ? window.__sb(cap, 'y') : null,
          navHidden: nav ? window.__sb(nav, 'x') === 0 : true,
          std: getComputedStyle(box).scrollbarWidth,
          thumb,
        };
      });
      expect(m.page === 6, theme + ': the page scrollbar is 6px (' + m.page + ')');
      expect(m.box === 6 && m.boxX === 6, theme + ': a plain scrolling box is 6px both ways (' + m.box + ', ' + m.boxX + ')');
      expect(m.strip === 6, theme + ': the Sheet card strip is 6px (' + m.strip + ')');
      expect(m.cap === 6, theme + ': a caption box is 6px (' + m.cap + ')');
      expect(m.navHidden, theme + ': a hidden scrollbar (top navigation) stays hidden');
      expect(m.std === 'auto', theme + ': Chromium keeps the rounded ::-webkit-scrollbar (no standard scrollbar-width set: ' + m.std + ')');
      expect(m.thumb === (dark ? 'rgba(244,246,248,0.2)' : 'rgba(17,17,16,0.16)'), theme + ': the thumb is the theme\'s soft colour (' + m.thumb + ')');
      expect(t.errors.length === 0, theme + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();

      console.log('--- client review page, ' + theme + ' ---');
      t = await openClient(browser, origin, { flags: 'on', dark });
      await waitNew(t);
      await sleep(1000);
      const c = await t.page.evaluate(() => {
        const r = document.getElementById('svReviewStage').shadowRoot;
        const sc = r.getElementById('tscroll');
        const filler = document.createElement('div'); filler.style.cssText = 'flex:none;height:2000px'; sc.appendChild(filler);
        return { chat: sc.offsetWidth - sc.clientWidth, strip: (e => e.offsetHeight - e.clientHeight)(r.getElementById('skList')) };
      });
      expect(c.chat === 6, theme + ': the conversation panel is 6px (' + c.chat + ')');
      expect(c.strip === 0, theme + ': the post strip keeps its scrollbar hidden (' + c.strip + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nscrollbars: all passed');
})().catch(e => { console.error(e); process.exit(1); });
