'use strict';

// Today (SMM and admin): every list is sorted by upload date, soonest first,
// and every row wears a date pill whose colour follows the time left.
// Fully offline: the page's own render and sort code draw fictional fixtures;
// every non-local request is refused, and the one Calendar read is a stubbed
// fetch. Set TODAY_SHOTS=<dir> to also save light, dark and 390px screenshots.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');

const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true });
  const shots = process.env.TODAY_SHOTS || '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    for (const [width, theme] of [[1100, 'light'], [1100, 'dark'], [390, 'light'], [390, 'dark']]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => route.abort());
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof _tdySmmHtml === 'function' && typeof _tdyUploadDates === 'function');
      const r = await page.evaluate(async theme => {
        document.documentElement.setAttribute('data-theme', theme);
        const iso = n => _tdyIso(_tdyDays(n));
        const now = new Date().toISOString();
        const out = {};

        // 1) The date read: one request, ids of the cards on screen, earliest post wins, archived left out.
        const calls = [];
        const realFetch = window.fetch;
        window.fetch = (url) => {
          calls.push(String(url));
          return Promise.resolve({ ok: true, json: async () => [
            { id: 'q1', scheduled_date: iso(9), video_deliverable_id: 'w1', graphic_deliverable_id: null },
            { id: 'q2', scheduled_date: iso(4), video_deliverable_id: null, graphic_deliverable_id: 'w1' },
            { id: 'q3', scheduled_date: iso(2), video_deliverable_id: 'w2', graphic_deliverable_id: null },
            { id: 'q4', scheduled_date: null, video_deliverable_id: 'w3', graphic_deliverable_id: null },
            { id: 'q5', scheduled_date: iso(1), video_deliverable_id: 'zz', graphic_deliverable_id: null }
          ] });
        };
        out.map = await _tdyUploadDates(['w1', 'w2', 'w3', 'w4']);
        out.calls = calls;
        window.fetch = () => Promise.reject(new Error('down'));
        out.failedMap = await _tdyUploadDates(['w1']);
        window.fetch = realFetch;

        // 2) Sorting and pills. Rows are given in a scrambled order.
        const del = (id, status, extra) => Object.assign({ id, client_slug: 'fixture', title: 'Item ' + id, status, status_at: now, due_date: iso(3), origin: 'calendar' }, extra);
        const post = (id, n, extra) => Object.assign({ id, client: 'fixture', name: 'Post ' + id, scheduled_date: n == null ? null : iso(n), status: 'Draft', video_status: 'Kasper Approval', caption: '', video_deliverable_id: 'v' + id }, extra);
        const data = {
          names: { fixture: 'Fixture Client' }, notListed: false, done: [],
          open: [
            del('a1', 'smm_approval'), del('a2', 'smm_approval'), del('a3', 'smm_approval'), del('a4', 'smm_approval'),
            del('a5', 'smm_approval'), del('a6', 'smm_approval'), del('a7', 'smm_approval'), del('a8', 'smm_approval'),
            del('t1', 'todo', { due_date: iso(-2) }), del('t2', 'todo', { due_date: iso(-9) }), del('t3', 'todo', { due_date: iso(-5) })
          ],
          upload: { a1: iso(12), a2: iso(0), a3: iso(5), a4: iso(-1), a5: iso(1), a7: iso(2), a8: iso(8) },   // a6 has no post
          posts: [post('p1', 6), post('p2', 0), post('p3', null), post('p4', 3), post('p5', 1), post('p6', 5, { status: 'Approved', caption: 'x', video_status: 'Approved', asset_url: 'x', thumbnail_url: 'x' }), post('p7', 2, { status: 'Approved', caption: 'x', video_status: 'Approved', asset_url: 'x', thumbnail_url: 'x' })]
        };
        const me = { first: 'Casey', editor: false };
        const host = document.createElement('div');
        host.id = 'tdyRoot'; host.className = 'tdy';
        document.body.innerHTML = '<div id="content"></div>';
        if (innerWidth < 600) document.body.insertAdjacentHTML('afterbegin', '<div class="pocket-staff-bar"></div>');
        document.getElementById('content').appendChild(host);
        const order = job => { tdyState.job = job; host.innerHTML = _tdySmmHtml(me, data, 'Rings'); return [...host.querySelectorAll('.tdy-rw .tdy-tt')].map(n => n.textContent); };
        out.approve = order('approve');
        out.dates = order('dates');
        out.captions = order('captions');
        out.schedule = order('schedule');
        out.links = order('links');

        // 3) Colour bands, read from the real computed styles.
        tdyState.job = 'approve';
        host.innerHTML = _tdySmmHtml(me, data, 'Rings');
        out.pills = [...host.querySelectorAll('.tdy-rw')].map(row => {
          const p = row.querySelector('.tdy-dp'), cs = getComputedStyle(p);
          return { title: row.querySelector('.tdy-tt').textContent, text: p.textContent, cls: p.className.replace('tdy-dp ', ''), bg: cs.backgroundColor, fg: cs.color, aria: p.getAttribute('aria-label') };
        });
        out.bandOf = {};
        for (const [k, n] of [['m1', -1], ['0', 0], ['1', 1], ['2', 2], ['3', 3], ['7', 7], ['8', 8]]) out.bandOf[k] = _tdyBand(iso(n)).cls;
        out.noDate = _tdyBand('').text + '|' + _tdyBand(null).cls;
        out.rowOverflow = [...host.querySelectorAll('.tdy-rw')].some(n => n.scrollWidth > n.clientWidth + 1);
        out.pageOverflow = document.documentElement.scrollWidth > innerWidth + 1;
        out.rings = [...host.querySelectorAll('.tdy-rg')].map(n => n.getAttribute('aria-label'));
        return out;
      }, theme);

      const tag = `${width}px ${theme}`;
      if (width === 1100 && theme === 'light') {
        check(Object.keys(r.map).sort().join() === 'w1,w2' && r.map.w1.length === 10 && r.calls.length === 1, `one request reads the dates, only for ids asked about (${r.calls.length} request)`);
        check(r.calls[0].includes('calendar_posts') && r.calls[0].includes('video_deliverable_id.in.(w1,w2,w3,w4)') && r.calls[0].includes('graphic_deliverable_id.in.(w1,w2,w3,w4)') && !/scheduled_date=(gte|lte)/.test(r.calls[0]), 'the read goes through both deliverable columns and has no 14-day window');
        check(Object.keys(r.failedMap).length === 0, 'a failed date read gives an empty map instead of breaking Today');
        check(r.approve.join() === 'Item a4,Item a2,Item a5,Item a7,Item a3,Item a8,Item a1,Item a6', 'To approve: soonest upload date first, no date last (' + r.approve.join() + ')');
        check(r.dates.join() === 'Item t2,Item t3,Item t1', 'Dates to move: oldest due date first (' + r.dates.join() + ')');
        check(r.captions.join() === 'Post p2,Post p5,Post p4,Post p1,Post p3', 'Captions to write: soonest first, no date last (' + r.captions.join() + ')');
        check(r.links.join() === r.captions.join(), 'Missing links is date sorted too (' + r.links.join() + ')');
        check(r.schedule.join() === 'Post p7,Post p6', 'To schedule: soonest first (' + r.schedule.join() + ')');
        check(JSON.stringify(r.bandOf) === JSON.stringify({ m1: 'red', 0: 'red', 1: 'amber', 2: 'amber', 3: 'soon', 7: 'soon', 8: 'later' }), 'bands: overdue and today red, 1-2 days amber, 3-7 neutral, later grey (' + JSON.stringify(r.bandOf) + ')');
        check(r.noDate === 'No date|none', 'no date reads "No date"');
        check(r.rings.join('|') === 'To approve: 8|Missing links: 5|Captions to write: 5|To schedule: 2|Dates to move: 3', 'rings and counts unchanged (' + r.rings.join('|') + ')');
      }
      const byTitle = Object.fromEntries(r.pills.map(p => [p.title, p]));
      check(byTitle['Item a2'].text === 'Today' && byTitle['Item a5'].text === 'Tomorrow' && byTitle['Item a6'].text === 'No date', `${tag}: pills say Today, Tomorrow and No date`);
      check(/\d/.test(byTitle['Item a3'].text) && byTitle['Item a3'].aria.startsWith('Upload date: '), `${tag}: later dates are written out ("${byTitle['Item a3'].text}")`);
      const bands = ['red', 'amber', 'soon', 'later', 'none'];
      const sample = bands.map(b => r.pills.find(p => p.cls === b));
      check(sample.every(Boolean), `${tag}: each band is on screen`);
      check(new Set(sample.map(p => p.bg + p.fg)).size === 5, `${tag}: the five bands look different from each other`);
      check(!r.rowOverflow && !r.pageOverflow, `${tag}: no row or page overflows sideways`);
      if (shots) {
        await page.locator('#tdyRoot').screenshot({ path: path.join(shots, `today-upload-dates-${width === 390 ? '390' : 'desktop'}-${theme}.png`) });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`today-upload-dates: ${failures.length} failed`); process.exit(1); }
  console.log('today-upload-dates: PASS');
})().catch(e => { console.error(e); process.exit(1); });
