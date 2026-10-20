'use strict';

// Today (SMM and admin), Captions to write: a caption part sent back for
// tweaks shows there with a "Tweaks needed" label and the newest open change
// note's first line, before the empty captions; an approved caption does not
// show. Fully offline, fictional fixtures. Set TODAY_SHOT=<file.png> to save
// a screenshot of the section.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');

const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true });
  const shot = process.env.TODAY_SHOT || '';
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => route.abort());
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _tdySmmHtml === 'function' && typeof _tdyCaptionRows === 'function');
    const r = await page.evaluate(() => {
      const iso = n => _tdyIso(_tdyDays(n));
      const notes = JSON.stringify([
        { id: 'h1', body: 'HIDDEN newest note', is_tweak: true, done: false, hidden: true, created_at: '2026-02-01T10:00:00Z' },
        { id: 'h2', body: 'DELETED newer note', is_tweak: true, done: false, deleted: true, created_at: '2026-02-02T10:00:00Z' },
        { id: 'n1', body: 'Old note, already done', is_tweak: true, done: true, created_at: '2026-01-01T10:00:00Z' },
        { id: 'n2', body: 'Shorten the opening line\nand drop the hashtags', is_tweak: true, done: false, created_at: '2026-01-02T10:00:00Z' },
        { id: 'n3', body: 'Older open note', is_tweak: true, done: false, created_at: '2026-01-01T12:00:00Z' }
      ]);
      const post = (id, n, extra) => Object.assign({ id, client: 'fixture', name: 'Post ' + id, scheduled_date: iso(n), status: 'Draft', caption: 'written', asset_url: 'x', video_deliverable_id: 'v' + id }, extra);
      const data = {
        names: { fixture: 'Fixture Client' }, notListed: false, done: [], open: [], upload: {},
        posts: [
          post('empty1', 1, { caption: '' }),
          post('approved1', 2, { caption_status: 'Approved' }),
          post('tw-in-window', 3, { caption_status: 'Tweaks Needed' })
        ],
        // the separate read: tweaks-needed captions, any date (one is past the 14-day window)
        capTweaks: [
          { id: 'tw-in-window', client: 'fixture', name: 'Post tw-in-window', scheduled_date: iso(3), status: 'Tweaks Needed', caption_status: 'Tweaks Needed', caption_tweaks: notes },
          { id: 'tw-far', client: 'fixture', name: 'Post tw-far', scheduled_date: iso(30), status: 'Tweaks Needed', caption_status: 'Tweaks Needed', caption_tweaks: '' },
          { id: 'tw-posted', client: 'fixture', name: 'Post tw-posted', scheduled_date: iso(-3), status: 'Posted', caption_status: 'Tweaks Needed', caption_tweaks: '' }
        ]
      };
      document.body.innerHTML = '<div id="content"></div>';
      const host = document.createElement('div');
      host.id = 'tdyRoot'; host.className = 'tdy';
      document.getElementById('content').appendChild(host);
      tdyState.job = 'captions';
      host.innerHTML = _tdySmmHtml({ first: 'Casey', editor: false }, data, 'Rings');
      const rows = [...host.querySelectorAll('.tdy-rw')].map(n => ({
        title: n.querySelector('.tdy-tt').textContent,
        label: (n.querySelector('.tdy-tw') || {}).textContent || '',
        note: (n.querySelector('.tdy-tw-note') || {}).textContent || ''
      }));
      return { rows, rings: [...host.querySelectorAll('.tdy-rg')].map(n => n.getAttribute('aria-label')), overflow: document.documentElement.scrollWidth > innerWidth + 1, html: host.innerHTML };
    });
    check(!/HIDDEN|DELETED/.test(r.html), 'a hidden or deleted newest note is never shown');
    const titles = r.rows.map(x => x.title);
    check(titles.includes('Post tw-in-window') && titles.includes('Post tw-far'), 'tweaks-needed captions show in Captions to write, also past the 14-day window (' + titles.join() + ')');
    check(!titles.includes('Post approved1'), 'an approved caption does not show');
    check(!titles.includes('Post tw-posted'), 'a posted card does not show');
    check(titles.filter(t => t === 'Post tw-in-window').length === 1, 'a post in both reads shows once');
    check(titles.join() === 'Post tw-in-window,Post tw-far,Post empty1', 'tweaks first (by date), then empty captions (' + titles.join() + ')');
    const tw = r.rows.find(x => x.title === 'Post tw-in-window');
    check(tw.label === 'Tweaks needed', 'the row says "Tweaks needed"');
    check(tw.note === 'Shorten the opening line', 'the newest open change note shows, first line only (' + tw.note + ')');
    check(r.rows.find(x => x.title === 'Post tw-far').label === 'Tweaks needed' && r.rows.find(x => x.title === 'Post tw-far').note === '', 'no note text: label only');
    check(r.rows.find(x => x.title === 'Post empty1').label === '', 'an empty caption has no tweaks label');
    check(r.rings.includes('Captions to write: 3'), 'the ring counts tweaks and empty captions (' + r.rings.join('|') + ')');
    check(!r.overflow, 'no sideways overflow');
    if (shot) {
      await page.evaluate(() => window.scrollTo(0, 0));
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      await page.locator('#tdyRoot').screenshot({ path: shot });
    }
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`today-caption-tweaks: ${failures.length} failed`); process.exit(1); }
  console.log('today-caption-tweaks: PASS');
})().catch(e => { console.error(e); process.exit(1); });
