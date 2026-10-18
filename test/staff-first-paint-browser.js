'use strict';
/*
 * STAFF PAGES, FIRST PAINT (session Lantern, 2026-10-18). Refreshes staff pages in a real browser, fully offline (a
 * fictional staff member and client from the review page's fixture; every backend call answered locally), logs what
 * every animation frame shows from the first script on, and fails on:
 *   - desktop: the header changing after the first frame (the tab row sliding when the client picker, Samples,
 *     Kasper or the Messages button appear late; each tab drawn as a bordered chip until the sliding pill is ready;
 *     Today with no tab lit);
 *   - Kasper: a bare "Loading…" line in place of the page while its code downloads;
 *   - phone: the wide desktop header showing before the phone title bar (Today, Templates).
 * On main the header moved by 20 to 60 px on every refresh, Kasper flashed "Loading…" and phones drew the desktop
 * header first.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const fx = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const FRAME_LOG = () => {
  window.__fpLog = [];
  let n = 0;
  const tick = () => {
    try {
      const q = s => document.querySelector(s);
      const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width || r.height ? [Math.round(r.x), Math.round(r.width)] : null; };
      const hdr = q('header.header');
      const content = q('#content');
      const tabs = ['navToday', 'navCalendar', 'navSxr', 'navTemplates', 'navWorkload', 'navKasper'].map(id => box(document.getElementById(id)));
      const plain = q('#navTemplates');
      window.__fpLog.push({
        t: Math.round(performance.now()),
        // Frames before the header markup is parsed show only the page colour; the log starts at the header.
        body: !!document.getElementById('mainWrap'),
        tabs: JSON.stringify(tabs),
        actions: JSON.stringify(box(q('.header-actions'))),
        picker: !!q('#svClientBar') && !q('#svClientBar').hidden,
        chip: plain ? getComputedStyle(plain).borderTopColor + '|' + getComputedStyle(plain).backgroundColor : '',
        lit: Array.from(document.querySelectorAll('#headerNav > .header-nav-btn')).filter(b => { const c = getComputedStyle(b).backgroundColor; return c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'; }).map(b => b.id).join(','),
        pill: !!q('#headerNav.pill-ready'),
        loadingText: !!content && Array.from(content.querySelectorAll('.sv-area-loading')).some(el => /^\s*Loading…\s*$/.test(el.textContent || '')),
        desktopHeader: !!hdr && hdr.getBoundingClientRect().height > 8 && getComputedStyle(hdr).visibility !== 'hidden' && getComputedStyle(hdr).display !== 'none',
        phoneBar: !!q('.pocket-staff-bar'),
      });
    } catch (e) {}
    if (++n < 600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function refresh(browser, origin, hash, opt) {
  const t = await fx.open(browser, origin, Object.assign({ stage: 'smm', staff: fx.STAFF }, opt));
  await t.page.goto(origin + '/index.html#' + hash, { waitUntil: 'load' });
  await fx.sleep(2500);
  await t.page.addInitScript(FRAME_LOG);
  await t.page.reload({ waitUntil: 'load' });
  await fx.sleep(2500);
  const log = (await t.page.evaluate(() => window.__fpLog || [])).filter(f => f.body);
  return { t, log };
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [hash, dark] of [['today', true], ['kasper', false], ['calendar', true]]) {
      const name = hash + (dark ? ' dark' : ' light') + ' 1440';
      console.log('--- refresh ' + name + ' ---');
      const { t, log } = await refresh(browser, origin, hash, { dark, width: 1440, height: 900 });
      const first = log[0] || {};
      const last = log[log.length - 1] || {};
      expect(log.length > 5, name + ': frames were logged (' + log.length + ')');
      // Positions within 1 px (sub-pixel rounding as fonts settle).
      const near = (a, b) => { const x = JSON.parse(a), y = JSON.parse(b); const flat = v => JSON.stringify(v).match(/-?\d+/g) || []; const fx_ = flat(x), fy = flat(y); return fx_.length === fy.length && fx_.every((n, i) => Math.abs(n - fy[i]) <= 1); };
      const moved = log.filter(f => !near(f.tabs, last.tabs) || !near(f.actions, last.actions));
      expect(!moved.length, name + ': the tab row and the header buttons never move (' + moved.length + ' frame(s) differ; first ' + (moved[0] ? moved[0].tabs + ' ' + moved[0].actions : '') + ' vs final ' + last.tabs + ' ' + last.actions + ')');
      expect(log.every(f => f.picker), name + ': the client picker shows from the first frame');
      expect(log.every(f => f.chip === last.chip), name + ': a tab looks the same before and after the sliding pill (' + first.chip + ' then ' + last.chip + ')');
      const target = { today: 'navToday', kasper: 'navKasper', calendar: 'navCalendar' }[hash];
      const preLit = log.filter(f => !f.pill);
      expect(preLit.every(f => f.lit === target), name + ': before the pill, only the page\'s own tab is lit (' + Array.from(new Set(preLit.map(f => f.lit))).join(' / ') + ')');
      expect(!log.some(f => f.loadingText), name + ': no bare "Loading…" line');
      expect(t.errors.length === 0, name + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
    for (const [hash, title] of [['today', 'Today'], ['templates', 'Templates']]) {
      const name = hash + ' 390';
      console.log('--- refresh ' + name + ' ---');
      const { t, log } = await refresh(browser, origin, hash, { dark: true, width: 390, height: 844 });
      expect(log.length > 5, name + ': frames were logged (' + log.length + ')');
      const wide = log.filter(f => f.desktopHeader);
      expect(!wide.length, name + ': the desktop header never shows (' + wide.length + ' frame(s))');
      expect(log.every(f => f.phoneBar), name + ': the phone title bar shows from the first frame');
      expect(await t.page.locator('.pocket-staff-bar').count() === 1 && await t.page.locator('#svBootPhoneBar').count() === 0, name + ': one bar at the end, the real one');
      expect((await t.page.locator('.pocket-staff-title').textContent()) === title, name + ': titled ' + title);
      await t.page.locator('.pocket-staff-tabs-btn').click();
      expect(await t.page.locator('#pocketStaffTabs[open]').count() === 1, name + ': its Tabs button opens the tabs sheet');
      expect(t.errors.length === 0, name + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nstaff-first-paint-browser: all passed');
})();
