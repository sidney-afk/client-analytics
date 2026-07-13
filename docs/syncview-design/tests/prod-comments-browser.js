'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  const unexpectedWrites = [];
  let primaryId = '';
  let errorId = '';
  let errorAttempts = 0;
  let commentReads = 0;
  let primaryTopReads = 0;
  let primaryOlderReads = 0;
  let sawStaffKey = false;
  let sawAnonBearer = false;

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return;
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/functions/v1/production-comments') return;
    unexpectedWrites.push(`${request.method()} ${request.url()}`);
  });
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));
  await page.route('**/functions/v1/production-comments', async route => {
    const request = route.request();
    commentReads++;
    const body = JSON.parse(request.postData() || '{}');
    sawStaffKey = sawStaffKey || request.headers()['x-syncview-key'] === 'browser-test-role-key';
    sawAnonBearer = sawAnonBearer || /^Bearer sb_publishable_/.test(request.headers().authorization || '');
    if (body.deliverable_id === errorId) {
      errorAttempts++;
      if (errorAttempts === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture error' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ comments: [], next_cursor: null, has_more: false }) });
      return;
    }
    if (!primaryId) primaryId = body.deliverable_id;
    if (body.before && body.before.created_at === '2026-07-01T12:00:00Z' && body.before.id === 'safe') {
      primaryOlderReads++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          comments: [
            { id: 'older', author_name: 'Earlier author', body: 'Earlier comment', audience: 'internal', source_created_at: '2026-06-30T12:00:00Z', source_updated_at: '2026-06-30T12:00:00Z' },
            { id: 'edit', author_name: 'Editor', body: 'Edited body from older page', audience: 'internal', source_created_at: '2026-07-02T12:00:00Z', source_updated_at: '2026-07-02T12:10:00Z', edited_at: '2026-07-02T12:10:00Z' },
            { id: 'becomes-deleted', author_name: 'Editor', body: 'NEW DELETED SECRET', source_created_at: '2026-07-04T12:00:00Z', source_updated_at: '2026-07-04T12:30:00Z', deleted_at: '2026-07-04T12:30:00Z' },
          ],
          next_cursor: null,
          has_more: false,
        }),
      });
      return;
    }
    if (body.deliverable_id === primaryId) primaryTopReads++;
    await new Promise(resolve => setTimeout(resolve, 120));
    if (body.deliverable_id === primaryId && primaryTopReads > 1) {
      const refreshId = primaryTopReads === 2 ? 'captured-reopen' : 'captured-normal-refresh';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          comments: [
            { id: refreshId, author_name: 'Fresh author', body: 'Freshly captured comment', audience: 'internal', source_created_at: '2026-07-05T12:00:00Z', source_updated_at: '2026-07-05T12:00:00Z' },
            { id: 'edit', author_name: 'Editor', body: primaryTopReads === 2 ? 'Edited after reopen' : 'Edited after normal refresh', audience: 'internal', source_created_at: '2026-07-02T12:00:00Z', source_updated_at: '2026-07-05T12:10:00Z', edited_at: '2026-07-05T12:10:00Z' },
          ],
          next_cursor: { created_at: '2026-07-01T12:00:00Z', id: 'safe' },
          has_more: true,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        comments: [
          { id: 'safe', author_name: '<svg onload=bad()>', body: 'See [safe](https://example.com/docs) and [bad](javascript:alert(1)) <img src=x onerror=bad()>', audience: 'client', source_created_at: '2026-07-01T12:00:00Z', source_updated_at: '2026-07-01T12:00:00Z' },
          { id: 'reply', parent_id: 'safe', author_name: 'Reply author', body: 'A reply', audience: 'client', source_created_at: '2026-07-01T12:05:00Z', source_updated_at: '2026-07-01T12:05:00Z' },
          { id: 'edit', author_name: 'Editor', body: 'Original body', audience: 'internal', source_created_at: '2026-07-02T12:00:00Z', source_updated_at: '2026-07-02T12:05:00Z', edited_at: '2026-07-02T12:05:00Z' },
          { id: 'deleted', author_name: 'Editor', body: 'DELETED SECRET', source_created_at: '2026-07-03T12:00:00Z', source_updated_at: '2026-07-03T12:05:00Z', deleted_at: '2026-07-03T12:05:00Z' },
          { id: 'hidden', author_name: 'Editor', body: 'HIDDEN SECRET', hidden: true, source_created_at: '2026-07-03T13:00:00Z', source_updated_at: '2026-07-03T13:00:00Z' },
          { id: 'resolved', author_name: 'Editor', body: 'Resolved note', audience: 'internal', source_created_at: '2026-07-03T14:00:00Z', source_updated_at: '2026-07-03T14:05:00Z', resolved_at: '2026-07-03T14:05:00Z' },
          { id: 'becomes-deleted', author_name: 'Editor', body: 'Visible before paging', audience: 'internal', source_created_at: '2026-07-04T12:00:00Z', source_updated_at: '2026-07-04T12:00:00Z' },
        ],
        next_cursor: { created_at: '2026-07-01T12:00:00Z', id: 'safe' },
        has_more: true,
      }),
    });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-row', { timeout: 30000 });
    const ids = await page.locator('.prod-row').evaluateAll(rows => rows.slice(0, 2).map(row => row.getAttribute('data-prod-row')).filter(Boolean));
    expect(ids.length >= 2, 'fixture requires two live Production rows');

    await page.evaluate(id => _prodOpenDeliverable(id), ids[0]);
    await page.waitForSelector('[data-prod-comments-state="signin"]', { timeout: 5000 });
    expect(commentReads === 0, 'signed-out detail must not request comment bodies');

    await page.evaluate(id => {
      _syncviewStaffIdentitySave({ key: 'browser-test-role-key', role: 'admin', member: { id: 'browser-test-member', name: 'Browser Test' } });
      _syncviewStaffIdentityVerified = true;
      _prodComments.retry(id);
    }, ids[0]);
    await page.waitForSelector('.prod-comment-loading', { timeout: 3000 });
    await page.waitForSelector('[data-prod-comments-state="ready"]', { timeout: 5000 });

    expect(sawStaffKey, 'comment request did not include verified staff role key');
    expect(sawAnonBearer, 'comment request did not include anon bearer for EF routing');
    expect(await page.locator('[data-prod-comment-id="safe"]').count() === 1, 'safe comment did not render');
    expect(await page.locator('[data-prod-comment-id="reply"].is-reply').count() === 1, 'reply indentation marker missing');
    expect(await page.locator('[data-prod-comment-id="safe"] a[href="https://example.com/docs"]').count() === 1, 'safe HTTPS link was not clickable');
    expect(await page.locator('[data-prod-comment-id="safe"] a[href^="javascript:"]').count() === 0, 'javascript URL became clickable');
    expect(await page.locator('[data-prod-comment-id="safe"] img, [data-prod-comment-id="safe"] svg').count() === 1, 'untrusted body/author created executable markup');
    const safeText = await page.locator('[data-prod-comment-id="safe"]').textContent();
    expect(safeText.includes('<svg onload=bad()>') && safeText.includes('<img src=x onerror=bad()>'), 'unsafe-looking text was not preserved as escaped text');
    expect((await page.locator('[data-prod-comment-id="safe"] a').first().getAttribute('rel')) === 'noopener noreferrer', 'safe link lacks isolated-tab rel');
    expect(await page.locator('.prod-comment-pill', { hasText: 'Client-visible' }).count() >= 1, 'client-audience comment hidden from staff');
    expect(await page.locator('.prod-comment-pill', { hasText: 'Internal' }).count() >= 1, 'internal comment hidden from staff');
    expect(await page.locator('.prod-comment-pill', { hasText: 'Resolved' }).count() === 1, 'resolved state missing');
    expect(await page.locator('[data-prod-comment-id="edit"] .prod-comment-edited').count() === 1, 'edited marker missing');
    expect((await page.locator('[data-prod-comment-id="deleted"] .prod-comment-body').textContent()).trim() === 'Comment deleted.', 'deleted row did not render a tombstone');
    const activityBeforePage = await page.locator('.prod-activity').textContent();
    expect(!activityBeforePage.includes('DELETED SECRET') && !activityBeforePage.includes('HIDDEN SECRET'), 'deleted or hidden body leaked into the DOM');

    await page.locator('[data-prod-comments-more]').click();
    await page.waitForFunction(() => !document.querySelector('[data-prod-comments-more]'));
    expect(await page.locator('[data-prod-comment-id="edit"]').count() === 1, 'edit duplicated across pages');
    expect((await page.locator('[data-prod-comment-id="edit"] .prod-comment-body').textContent()).trim() === 'Edited body from older page', 'edit did not replace prior body');
    expect(await page.locator('[data-prod-comment-id="becomes-deleted"]').count() === 1, 'delete update duplicated across pages');
    expect((await page.locator('[data-prod-comment-id="becomes-deleted"] .prod-comment-body').textContent()).trim() === 'Comment deleted.', 'delete update did not replace prior value');
    const activityAfterPage = await page.locator('.prod-activity').textContent();
    expect(!activityAfterPage.includes('Visible before paging') && !activityAfterPage.includes('NEW DELETED SECRET'), 'delete update retained a body');

    await page.evaluate(id => {
      _prodOpenDeliverable(id);
      _prodOpenDeliverable(id);
    }, primaryId);
    await page.waitForSelector('[data-prod-comment-id="captured-reopen"]', { timeout: 5000 });
    expect(primaryTopReads === 2, 'rapid reopen started duplicate newest-page requests');
    expect(primaryOlderReads === 1, 'reopen unexpectedly replayed or lost the older-page request');
    expect(await page.locator('[data-prod-comment-id="older"]').count() === 1, 'reopen discarded an already-loaded older page');
    expect(await page.locator('[data-prod-comments-more]').count() === 0, 'reopen replaced the exhausted deep cursor with the newest-page cursor');
    expect((await page.locator('[data-prod-comment-id="edit"] .prod-comment-body').textContent()).trim() === 'Edited after reopen', 'reopen did not apply a newly captured edit');

    await page.evaluate(() => _prodRefresh({ silent: true }));
    await page.waitForSelector('[data-prod-comment-id="captured-normal-refresh"]', { timeout: 5000 });
    expect(primaryTopReads === 3, 'normal Production refresh did not make exactly one newest-page request');
    expect(await page.locator('[data-prod-comment-id="older"]').count() === 1, 'normal refresh discarded an already-loaded older page');
    expect((await page.locator('[data-prod-comment-id="edit"] .prod-comment-body').textContent()).trim() === 'Edited after normal refresh', 'normal refresh did not apply the latest edit');

    expect(await page.locator('[data-prod-disabled="composer"]').count() === 1, 'disabled composer missing');
    await page.locator('[data-prod-disabled="composer"]').click();
    await page.waitForSelector('#prodToast.show', { timeout: 3000 });
    expect((await page.locator('#prodToast').textContent()).includes('Preview - read-only'), 'composer escaped the read-only guard');

    errorId = ids[1];
    await page.evaluate(id => _prodOpenDeliverable(id), errorId);
    await page.waitForSelector('[data-prod-comments-state="error"]', { timeout: 5000 });
    await page.locator('[data-prod-comments-state="error"] button', { hasText: 'Retry' }).click();
    await page.waitForSelector('[data-prod-comments-state="empty"]', { timeout: 5000 });

    expect(!unexpectedWrites.length, 'unexpected write-like requests: ' + unexpectedWrites.join(' | '));
    expect(!pageErrors.length, 'page errors: ' + pageErrors.join(' | '));
    console.log('prod-comments-browser: auth, refresh races, paging, merge, escaping, visibility, states, and disabled composer passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
