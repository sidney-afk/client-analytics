'use strict';

// Today at phone width: the Walk-through actions (Open card, SyncLinear,
// Skip) and the Deck actions stay on ONE line, and no label is clipped
// (owner, 2026-09-28; Codex on PR 1800). Fully offline: the page's own
// render functions draw fixture data; every non-local request is refused.
// Fixture names only; this repo is public.

const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');

const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), route => route.abort());
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof _tdySmmHtml === 'function' && typeof _tdyEditorHtml === 'function');
      const rows = await page.evaluate(() => {
        const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
        const now = new Date().toISOString();
        const post = { id: 'p1', client: 'fixture', name: 'Fixture post', scheduled_date: soon, status: 'Draft', caption: '', video_deliverable_id: 'd1' };
        const post2 = Object.assign({}, post, { id: 'p2' });
        const smm = { names: { fixture: 'Fixture Client' }, notListed: false, open: [], done: [], posts: [post, post2] };
        const row = id => ({ id, client_slug: 'fixture', title: 'Fixture ' + id, status: 'todo', status_at: now, due_date: soon });
        const ed = { names: { fixture: 'Fixture Client' }, open: [row('a'), row('b')], done: [], urgent: [] };
        const me = { first: 'Casey', editor: false };
        const host = document.createElement('div');
        host.className = 'tdy';
        document.body.innerHTML = '';
        document.body.appendChild(host);
        const measure = html => {
          host.innerHTML = html;
          const acts = host.querySelector('.tdy-acts');
          const btns = [...acts.querySelectorAll('.tdy-b')];
          return {
            labels: btns.map(b => b.textContent.trim()),
            tops: btns.map(b => Math.round(b.getBoundingClientRect().top)),
            clipped: btns.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent.trim()),
            overflow: acts.scrollWidth > acts.clientWidth + 1,
          };
        };
        return { walk: measure(_tdySmmHtml(me, smm, 'Walk-through')), deck: measure(_tdyEditorHtml(Object.assign({}, me, { editor: true }), ed, 'Deck')) };
      });
      for (const [name, r] of Object.entries(rows)) {
        check(new Set(r.tops).size === 1, `${width}px ${name}: ${r.labels.join(' / ')} sit on one line`);
        check(!r.clipped.length && !r.overflow, `${width}px ${name}: no label is cut off${r.clipped.length ? ' (' + r.clipped.join(', ') + ')' : ''}`);
      }
      check(rows.walk.labels.join('|') === 'Open card|SyncLinear|Skip', `${width}px walk-through shows Open card, SyncLinear and Skip`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`today-phone-actions: ${failures.length} failed`); process.exit(1); }
  console.log('today-phone-actions: PASS');
})().catch(e => { console.error(e); process.exit(1); });
