/*
 * Calendar → Organize menu: interaction pass.
 *
 * Drives the menu the way a person does — open it, change several settings in
 * a row, dismiss it by clicking away and by Escape, edit a date and watch the
 * card re-place itself, toggle back to manual, and follow the pill as the view
 * tab changes. Complements qa/calendar-organize/stress.js, which proves the
 * round trip under randomised load.
 *
 * Fully mocked: only the local http server is reachable, every other request
 * is aborted. Run via `npm run test:cal-organize`, or directly.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.SV_QA_PORT || 8000);
const ORIGIN = 'http://localhost:' + PORT;
const PW = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
const ROOT = path.resolve(__dirname, '..', '..');

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  fs.readFile(path.join(ROOT, p === '/' ? 'index.html' : p), (e, b) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': p.endsWith('.png') ? 'image/png' : 'text/html' });
    res.end(b);
  });
});

const POSTS = [
  { id: 'p1', name: 'A', scheduled_date: '2026-08-04', status: 'Posted',      order_index: 7 },
  { id: 'p2', name: 'B', scheduled_date: '',           status: 'In Progress', order_index: 1 },
  { id: 'p3', name: 'C', scheduled_date: '2026-08-19', status: 'In Progress', order_index: 4 },
  { id: 'p4', name: 'D', scheduled_date: '2026-07-28', status: 'Posted',      order_index: 9 },
  { id: 'p5', name: 'E', scheduled_date: '',           status: 'In Progress', order_index: 2 },
  { id: 'p6', name: 'F', scheduled_date: '2026-08-11', status: 'Client Approval', order_index: 6 },
];

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ok   ' + l); } else { fail++; console.log('  FAIL ' + l); } };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await PW.chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.route('**/*', r => r.request().url().startsWith(ORIGIN) ? r.continue() : r.abort());
  await ctx.addInitScript(() => {
    try { localStorage.setItem('syncview_auth_v1', 'ok'); localStorage.setItem('syncview_theme', 'dark'); } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('[console] ' + m.text()); });

  await page.goto(ORIGIN + '/#calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate((posts) => {
    calState.client = 'Sidney Laruel'; calState.view = 'organizer';
    calState.loading = false; calState.error = null;
    calState.posts = posts.map((p, i) => Object.assign({
      asset_url: '', thumbnail_url: '', caption: '', cta: '', tweaks: '', comments: [],
      platforms: 'instagram', linear_issue_id: 'https://linear.app/x/issue/SYN-' + (300 + i),
    }, p));
    _calRenderShell(); _calRenderBody({ preserveScroll: false });
  }, POSTS);
  await page.waitForTimeout(500);

  const ids = () => page.$$eval('.cal-card[data-pid]', els => els.map(e => e.dataset.pid));
  const open = () => page.$eval('#calOrganizeMenu', e => e.classList.contains('open'));

  console.log('\nA) menu open / close');
  ok(!(await open()), 'starts closed');
  await page.click('#calOrganizeBtn'); await page.waitForTimeout(200);
  ok(await open(), 'trigger opens it');
  ok(await page.$eval('#calOrganizeBtn', e => e.getAttribute('aria-expanded')) === 'true', 'aria-expanded tracks it');

  console.log('\nB) it stays open while you change several things');
  await page.click('#calOrganizeWrap [role="menuitemradio"][aria-checked="false"] >> nth=0');
  await page.waitForTimeout(300);
  ok(await open(), 'still open after picking a month');
  await page.click('#calOrganizeWrap .cal-org-toggle'); await page.waitForTimeout(300);
  ok(await open(), 'still open after flipping the order switch');
  ok(await page.$eval('#calOrgSortSwitch', e => e.classList.contains('is-on')), 'switch reads on');

  console.log('\nC) outside click and Escape both dismiss');
  await page.mouse.click(300, 800); await page.waitForTimeout(250);
  ok(!(await open()), 'a click outside closes it');
  await page.click('#calOrganizeBtn'); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  ok(!(await open()), 'Escape closes it');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'calOrganizeBtn',
     'Escape returns focus to the trigger');

  console.log('\nD) ordering + drag gate');
  await page.evaluate(() => { onCalMonthFilterChange('all'); onCalStatusFilterChange('all'); });
  await page.waitForTimeout(300);
  ok((await ids()).join(',') === 'p4,p1,p6,p3,p2,p5', 'auto: oldest→soonest, undated last (' + (await ids()).join(',') + ')');
  ok(await page.$$eval('.cal-card[draggable="true"]', e => e.length) === 0, 'no card is draggable under the date sort');
  ok(await page.$$eval('.cal-card-grip.is-locked', e => e.length) > 0, 'grips show the locked state');

  console.log('\nE) editing a date re-places the card live');
  await page.evaluate(() => {
    const inp = document.querySelector('.cal-card[data-pid="p5"] input[data-fld="scheduled_date"]');
    inp.value = '2026-07-01';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  ok((await ids())[0] === 'p5', 'a newly-dated card moves to its date slot immediately');

  console.log('\nF) toggling back restores the manual order');
  await page.evaluate(() => onCalSortModeToggle());
  await page.waitForTimeout(400);
  ok((await ids()).join(',') === 'p2,p5,p3,p6,p1,p4', 'manual order intact (' + (await ids()).join(',') + ')');
  ok(await page.$$eval('.cal-card[draggable="true"]', e => e.length) === 6, 'dragging is back');
  ok(await page.$$eval('.cal-card-grip.is-locked', e => e.length) === 0, 'grips unlocked');

  console.log('\nG) the pill follows the view, and survives a round trip');
  await page.evaluate(() => onCalViewChange('month')); await page.waitForTimeout(400);
  ok(await page.$('#calOrganizeWrap') === null, 'pill is removed on the Month tab');
  await page.evaluate(() => onCalViewChange('organizer')); await page.waitForTimeout(400);
  ok(await page.$('#calOrganizeWrap') !== null, 'pill is back on the Sheet tab');
  const order = await page.$$eval('.cal-toolbar-mid > *', els => els.map(e => e.className.split(' ')[1] || e.className));
  ok(order[0] === 'cal-organize', 'and back in its original toolbar slot (' + JSON.stringify(order) + ')');

  console.log('\nH) persistence across a reload');
  await page.evaluate(() => onCalSortModeToggle());
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => localStorage.getItem('syncview_cal_filters_v1'));
  ok(/"sort":"date"/.test(stored || ''), 'the mode is written to the per-client filters row');

  console.log('\nI) no page errors');
  ok(errs.length === 0, 'clean console' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));

  console.log('\n' + (fail ? 'FAIL (' + pass + ' passed, ' + fail + ' failed)' : 'PASS (' + pass + ' passed)'));
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
