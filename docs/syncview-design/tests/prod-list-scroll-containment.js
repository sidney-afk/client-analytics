'use strict';
/*
 * Production list scroll containment — measured proof.
 *
 * Slice 5 TEST drill run #16 failed f95_list_not_constrained with
 * client_height 1874 == scroll_height 1874: .prod-listwrap grew to fit its
 * content instead of scrolling inside a fixed frame. .prod-view carried
 * min-height: calc(100vh - 64px) — a floor, not a ceiling — so the root of the
 * flex chain could grow. (2026-08-06: the definite height is now calc(100vh -
 * 60px) to match the real 60px header, paired with body.prod-page zeroing the
 * document scroll — see test/prod-list-scroll-containment.js for the pins.)
 * flex chain was free to grow and .prod-main / .prod-content / .prod-listwrap
 * never received a constrained height.
 *
 * Read-only and offline: every REST and Edge call is fulfilled locally, and the
 * list is driven from synthetic rows through the real _prodAdapter and
 * _prodRender. Four viewport heights, a long list and a short one.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const VIEWPORTS = [
  { name: 'tall', width: 1280, height: 1000 },
  { name: 'drill', width: 1280, height: 800 },
  { name: 'short', width: 1280, height: 600 },
  { name: 'tiny', width: 1280, height: 480 },
];
const LONG_LIST = 40;
const SHORT_LIST = 2;
const ROW_HEIGHT = 44;
const GROUP_HEIGHT = 30;
// The drill sets exactly this, so the proof must clear it at every viewport.
const DRILL_SCROLL_TARGET = 137;

function serve() {
  const server = http.createServer((req, res) => {
    let pathname = '/index.html';
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch (_) {}
    if (pathname === '/') pathname = '/index.html';
    const full = path.join(ROOT, path.normalize(decodeURIComponent(pathname)));
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': ext === '.html' ? 'text/html; charset=utf-8'
        : ext === '.js' ? 'text/javascript'
          : ext === '.png' ? 'image/png' : 'application/octet-stream',
    });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function measure(page, rowCount) {
  return page.evaluate(({ count, scrollTarget }) => {
    const clients = [{
      slug: 'probe', display_name: 'Probe Co', active: true,
      board_status: 'in_progress', linear_project_ids: [{ id: 'p1' }],
    }];
    const members = [{ id: 'm1', name: 'Probe Member', role: 'creative', team: 'video', active: true }];
    const batches = [{ id: 'b1', client_slug: 'probe', team: 'video', name: 'Probe Batch' }];
    const deliverables = Array.from({ length: count }, (_, i) => ({
      id: 'row-' + i, linear_issue_uuid: 'li-' + i, identifier: 'VID-' + (100 + i),
      batch_id: 'b1', client_slug: 'probe', team: 'video',
      title: 'Scroll probe row ' + i, status: 'todo', assignee_id: 'm1',
    }));
    Object.assign(_prodState, {
      clients, members, batches, deliverables, loaded: true, loading: false,
      view: 'list', tab: 'all', filters: [], error: '',
      adapter: _prodAdapter({ clients, members, batches, deliverables }),
    });
    _prodRender();
    const list = document.querySelector('.prod-listwrap');
    if (!list) return { found: false, rows: document.querySelectorAll('.prod-row').length };
    list.scrollTop = Math.min(scrollTarget, Math.max(0, list.scrollHeight - list.clientHeight));
    const scrollBefore = Math.round(list.scrollTop);
    // Measure BEFORE the re-render check: _prodRender() replaces the list node,
    // and a detached element reports every box metric as 0.
    const box = list.getBoundingClientRect();
    const group = document.querySelector('.prod-group');
    const side = document.querySelector('.prod-side');
    const sideScroll = document.querySelector('.prod-side-scroll');
    const snapshot = {
      found: true,
      rows: document.querySelectorAll('.prod-row').length,
      clientHeight: Math.round(list.clientHeight),
      scrollHeight: Math.round(list.scrollHeight),
      scrollTop: scrollBefore,
      listTop: Math.round(box.top),
      listBottom: Math.round(box.bottom),
      viewHeight: Math.round(document.querySelector('.prod-view').getBoundingClientRect().height),
      sideHeight: side ? Math.round(side.getBoundingClientRect().height) : 0,
      sideScrollOverflows: sideScroll ? sideScroll.scrollHeight > sideScroll.clientHeight : false,
      groupTop: group ? Math.round(group.getBoundingClientRect().top) : null,
      rowHeight: (() => {
        const first = document.querySelector('.prod-row');
        return first ? Math.round(first.getBoundingClientRect().height) : 0;
      })(),
      viewportHeight: window.innerHeight,
    };
    // Now the re-render: the property F95 exists to prove.
    _prodRender();
    const after = document.querySelector('.prod-listwrap');
    snapshot.scrollAfterRender = after ? Math.round(after.scrollTop) : -1;
    return snapshot;
  }, { count: rowCount, scrollTarget: DRILL_SCROLL_TARGET });
}

(async () => {
  const failures = [];
  const check = (condition, message) => {
    if (condition) console.log('  ok  ' + message);
    else { failures.push(message); console.error('FAIL  ' + message); }
  };

  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await context.route('**/rest/v1/**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-range': '0-0/0' },
        body: '[]',
      }));
      await context.route('**/functions/v1/**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: '{"ok":true}',
      }));
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem('syncview_auth_v1', 'ok'); });
      await page.goto(`http://127.0.0.1:${port}/?prod=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.prod-view', { timeout: 45000 });
      await page.waitForFunction(
        () => typeof _prodState !== 'undefined' && typeof _prodRender === 'function',
        { timeout: 45000 },
      );

      const label = `${viewport.name} ${viewport.width}x${viewport.height}`;
      const long = await measure(page, LONG_LIST);
      check(long.found, `${label}: the list container renders with a long list`);
      if (long.found) {
        // The finding itself: a constrained frame with content taller than it.
        check(long.scrollHeight > long.clientHeight,
          `${label}: long list scrolls inside its frame (${long.clientHeight} < ${long.scrollHeight})`);
        check(long.clientHeight < viewport.height,
          `${label}: the frame is bounded by the viewport, not by its content`);
        // The exact property F95 exists to prove.
        check(long.scrollTop === DRILL_SCROLL_TARGET,
          `${label}: scrollTop reaches the drill's ${DRILL_SCROLL_TARGET}px target`);
        check(long.scrollAfterRender === long.scrollTop,
          `${label}: scroll position survives a re-render`);
        // The list must fit the viewport, so the frame is what scrolls.
        check(long.listBottom <= viewport.height + 8,
          `${label}: the list frame ends inside the viewport (bottom ${long.listBottom})`);
        // contain-intrinsic-size: 0 44px against a real 44px row means the
        // scroll height is exact rather than estimated, so no scrollbar jitter.
        check(long.rowHeight === ROW_HEIGHT,
          `${label}: rows are the ${ROW_HEIGHT}px contain-intrinsic-size assumes`);
        check(long.scrollHeight === LONG_LIST * ROW_HEIGHT + GROUP_HEIGHT,
          `${label}: scrollHeight is exact (${LONG_LIST}x${ROW_HEIGHT} + ${GROUP_HEIGHT} = ${long.scrollHeight})`);
        // Sticky group headers now resolve against .prod-listwrap. Pinned at
        // the frame's top, not the viewport's.
        check(long.groupTop === long.listTop,
          `${label}: the sticky group header pins to the list frame, not the document`);
        // The sidebar carries its own min-height floor; it must never exceed
        // the view now that the view cannot grow.
        check(long.sideHeight <= long.viewHeight,
          `${label}: the sidebar never outgrows the view (${long.sideHeight} <= ${long.viewHeight})`);
        check(!long.sideScrollOverflows,
          `${label}: the sidebar fits without needing its internal scroller`);
      }

      const short = await measure(page, SHORT_LIST);
      check(short.found, `${label}: the list container renders with a short list`);
      if (short.found) {
        // No scrollbar and no dead space: the frame fills, the content does not
        // overflow it, and nothing is clipped.
        check(short.scrollHeight <= short.clientHeight,
          `${label}: a ${SHORT_LIST}-row list introduces no scrollbar (${short.scrollHeight} <= ${short.clientHeight})`);
        check(short.scrollTop === 0,
          `${label}: a short list has nowhere to scroll`);
        check(short.clientHeight === long.clientHeight,
          `${label}: the frame is the same height whatever the row count`);
        check(short.listBottom <= viewport.height + 8,
          `${label}: the short list frame also ends inside the viewport`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  console.log(failures.length
    ? `\nProduction list scroll containment: ${failures.length} check(s) failed ❌`
    : '\nProduction list scroll containment proof passed');
  process.exit(failures.length ? 1 : 0);
})().catch(error => {
  console.error('Production list scroll containment proof crashed: ' + error.message);
  process.exit(1);
});
