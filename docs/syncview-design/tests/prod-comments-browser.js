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
  const strictReadCounts = new Map();

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return;
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/functions/v1/production-comments') return;
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/functions/v1/production-write') {
      let body = null;
      try { body = JSON.parse(request.postData() || 'null'); } catch (e) {}
      if (body && Object.keys(body).sort().join(',') === 'action,id,surface'
        && body.action === 'labels_read' && body.surface === 'production' && typeof body.id === 'string') return;
      if (body && Object.keys(body).sort().join(',') === 'action,client_slug,id,surface'
        && body.action === 'asset_access_read'
        && body.surface === 'production'
        && typeof body.id === 'string'
        && typeof body.client_slug === 'string') return;
      if (body && Object.keys(body).sort().join(',') === 'action,client_slug,id,surface'
        && body.action === 'description_read'
        && body.surface === 'production'
        && typeof body.id === 'string'
        && typeof body.client_slug === 'string') return;
    }
    unexpectedWrites.push(`${request.method()} ${request.url()} ${request.postData() || ''}`.trim());
  });
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));
  await page.route('**/functions/v1/production-comments', async route => {
    const request = route.request();
    commentReads++;
    const body = JSON.parse(request.postData() || '{}');
    sawStaffKey = sawStaffKey || request.headers()['x-syncview-key'] === 'browser-test-role-key';
    sawAnonBearer = sawAnonBearer || /^Bearer sb_publishable_/.test(request.headers().authorization || '');
    if (String(body.deliverable_id || '').startsWith('canonical-')) {
      const id = body.deliverable_id;
      const attempts = Number(strictReadCounts.get(id) || 0) + 1;
      strictReadCounts.set(id, attempts);
      if (id === 'canonical-transport-once' && attempts === 1) {
        await route.abort('connectionfailed');
        return;
      }
      if (id === 'canonical-transport-twice') {
        await route.abort('connectionfailed');
        return;
      }
      if (id === 'canonical-overflow') {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'canonical_thread_overflow' }) });
        return;
      }
      const malformedTotals = {
        'canonical-total-null': null,
        'canonical-total-false': false,
        'canonical-total-empty': '',
      };
      if (Object.prototype.hasOwnProperty.call(malformedTotals, id)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            canonical_thread: true,
            complete_thread: true,
            total: malformedTotals[id],
            comments: [],
            next_cursor: null,
            has_more: false,
          }),
        });
        return;
      }
      if (id === 'canonical-hidden' || id.startsWith('canonical-bad-cursor')
        || id === 'canonical-missing-comments') {
        const badCursors = {
          'canonical-bad-cursor': 'malformed-cursor',
          'canonical-bad-cursor-false': false,
          'canonical-bad-cursor-empty': '',
        };
        const receipt = {
          ok: true,
          canonical_thread: true,
          complete_thread: true,
          total: id === 'canonical-hidden' ? 1 : 0,
          comments: id === 'canonical-hidden'
            ? [{ id: 'hidden-row', body: 'must not certify', audience: 'internal', hidden: true }]
            : [],
          next_cursor: Object.prototype.hasOwnProperty.call(badCursors, id) ? badCursors[id] : null,
          has_more: false,
        };
        if (id === 'canonical-missing-comments') delete receipt.comments;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(receipt) });
        return;
      }
      if (id === 'canonical-truncated') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            canonical_thread: true,
            complete_thread: true,
            total: 2,
            comments: [{ id: 'only-one', body: 'partial', audience: 'internal' }],
            next_cursor: null,
            has_more: false,
          }),
        });
        return;
      }
      if (id === 'canonical-legacy' || id === 'canonical-legacy-null-page'
          || id === 'canonical-legacy-shrinking-total') {
        const older = !!body.before;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            canonical_thread: true,
            total: older && id === 'canonical-legacy-null-page'
              ? null
              : older && id === 'canonical-legacy-shrinking-total' ? 1 : 2,
            comments: [{
              id: older ? 'legacy-old' : 'legacy-new',
              body: older ? 'older' : 'newer',
              audience: 'internal',
              source_created_at: older ? '2026-01-01T00:00:00Z' : '2026-01-02T00:00:00Z',
            }],
            next_cursor: older ? null : { created_at: '2026-01-02T00:00:00Z', id: 'legacy-new' },
            has_more: !older,
          }),
        });
        return;
      }
      const comments = id === 'canonical-busy'
        ? Array.from({ length: 1_000 }, (_, index) => ({
          id: `busy-${index}`,
          body: `Comment ${index}`,
          audience: 'internal',
          source_created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        }))
        : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          canonical_thread: true,
          complete_thread: true,
          total: comments.length,
          comments,
          next_cursor: null,
          has_more: false,
        }),
      });
      return;
    }
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
  await page.route('**/functions/v1/production-write', async route => {
    let body = null;
    try { body = JSON.parse(route.request().postData() || 'null'); } catch (e) {}
    const response = body && body.action === 'asset_access_read'
      ? {
          ok: true,
          complete: true,
          assets: [
            { slot: 'filming_plan', state: 'missing', url: null },
            { slot: 'raw_footage', state: 'missing', url: null },
            { slot: 'delivery_folder', state: 'missing', url: null },
            { slot: 'deliverable_file', state: 'missing', url: null },
          ],
        }
      : {
          ok: true,
          complete: true,
          authority: 'linear',
          catalog: [],
          selected_label_ids: [],
          selected_labels: [],
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
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
    const gateToast = await page.locator('#prodToast').textContent();
    expect(/read-only while Linear is authoritative|authority is being checked/.test(gateToast), 'composer escaped the authority gate');

    errorId = ids[1];
    await page.evaluate(id => _prodOpenDeliverable(id), errorId);
    await page.waitForSelector('[data-prod-comments-state="error"]', { timeout: 5000 });
    await page.locator('[data-prod-comments-state="error"] button', { hasText: 'Retry' }).click();
    await page.waitForSelector('[data-prod-comments-state="empty"]', { timeout: 5000 });

    const strictReceipts = await page.evaluate(async () => {
      const summarize = state => ({
        status: state && state.status,
        count: state && Array.isArray(state.items) ? state.items.length : -1,
        complete: !!(state && state.completeThread),
      });
      return {
        busy: summarize(await _prodComments.readCanonical('canonical-busy')),
        legacy: summarize(await _prodComments.readCanonical('canonical-legacy')),
        legacyNullPage: summarize(await _prodComments.readCanonical('canonical-legacy-null-page')),
        legacyShrinkingTotal: summarize(await _prodComments.readCanonical('canonical-legacy-shrinking-total')),
        recovered: summarize(await _prodComments.readCanonical('canonical-transport-once')),
        transportFailed: summarize(await _prodComments.readCanonical('canonical-transport-twice')),
        truncated: summarize(await _prodComments.readCanonical('canonical-truncated')),
        overflow: summarize(await _prodComments.readCanonical('canonical-overflow')),
        totalNull: summarize(await _prodComments.readCanonical('canonical-total-null')),
        totalFalse: summarize(await _prodComments.readCanonical('canonical-total-false')),
        totalEmpty: summarize(await _prodComments.readCanonical('canonical-total-empty')),
        hidden: summarize(await _prodComments.readCanonical('canonical-hidden')),
        badCursor: summarize(await _prodComments.readCanonical('canonical-bad-cursor')),
        badCursorFalse: summarize(await _prodComments.readCanonical('canonical-bad-cursor-false')),
        badCursorEmpty: summarize(await _prodComments.readCanonical('canonical-bad-cursor-empty')),
        missingComments: summarize(await _prodComments.readCanonical('canonical-missing-comments')),
      };
    });
    expect(strictReceipts.busy.status === 'ready'
      && strictReceipts.busy.complete && strictReceipts.busy.count === 1_000
      && strictReadCounts.get('canonical-busy') === 1,
    '1000-row canonical thread did not complete in one browser request');
    expect(strictReceipts.legacy.status === 'ready'
      && !strictReceipts.legacy.complete && strictReceipts.legacy.count === 2
      && strictReadCounts.get('canonical-legacy') === 2,
    'pre-deploy reader compatibility walk did not require exact exhaustion');
    expect(strictReceipts.legacyNullPage.status === 'ready'
      && !strictReceipts.legacyNullPage.complete && strictReceipts.legacyNullPage.count === 2
      && strictReadCounts.get('canonical-legacy-null-page') === 2,
    'an older page without a total overwrote the exact first-page total');
    expect(strictReceipts.legacyShrinkingTotal.status === 'error'
      && strictReceipts.legacyShrinkingTotal.count === 0
      && strictReadCounts.get('canonical-legacy-shrinking-total') === 2,
    'a cursor-scoped shrinking total was accepted as the lifetime thread total');
    expect(strictReceipts.recovered.status === 'ready'
      && strictReceipts.recovered.complete
      && strictReadCounts.get('canonical-transport-once') === 2,
    'one lost Edge response did not recover through exactly one network retry');
    expect(strictReceipts.transportFailed.status === 'error'
      && strictReceipts.transportFailed.count === 0
      && strictReadCounts.get('canonical-transport-twice') === 2,
    'two lost Edge responses did not fail closed after one retry');
    expect(strictReceipts.truncated.status === 'error' && strictReceipts.truncated.count === 0,
      'count/row mismatch did not fail closed');
    expect(strictReceipts.overflow.status === 'error' && strictReceipts.overflow.count === 0,
      'canonical overflow did not fail closed');
    for (const [name, receipt] of Object.entries({
      totalNull: strictReceipts.totalNull,
      totalFalse: strictReceipts.totalFalse,
      totalEmpty: strictReceipts.totalEmpty,
      hidden: strictReceipts.hidden,
      badCursor: strictReceipts.badCursor,
      badCursorFalse: strictReceipts.badCursorFalse,
      badCursorEmpty: strictReceipts.badCursorEmpty,
      missingComments: strictReceipts.missingComments,
    })) {
      expect(receipt.status === 'error' && receipt.count === 0,
        `${name} malformed completeness receipt did not fail closed`);
    }

    const clientPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const clientPageErrors = [];
    const clientCommentReads = [];
    const clientGatewayWrites = [];
    const clientFallbackWrites = [];
    const clientToken = 'synthetic-client-comment-token';
    let trackClientWrite = false;
    let clientCrosswalkCard = 'client-card';
    const clientCanonicalComments = [{
      id: 'client-safe',
      author_name: 'Fixture team',
      role: 'smm',
      body: 'Canonical client-visible note',
      audience: 'client',
      component: 'video',
      source_created_at: '2026-07-21T10:00:00Z',
      source_updated_at: '2026-07-21T10:00:00Z',
    }];
    let releaseBindingSwitch;
    let markBindingSwitchStarted;
    const bindingSwitchStarted = new Promise(resolve => { markBindingSwitchStarted = resolve; });
    const bindingSwitchRelease = new Promise(resolve => { releaseBindingSwitch = resolve; });
    clientPage.on('pageerror', error => clientPageErrors.push(error.message));
    clientPage.on('request', request => {
      if (!trackClientWrite || request.method() !== 'POST') return;
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/functions/v1/production-comments'
        || pathname === '/functions/v1/production-write') return;
      clientFallbackWrites.push(`${request.method()} ${request.url()}`);
    });
    await clientPage.route('**/rest/v1/**', async route => {
      const url = new URL(route.request().url());
      const table = url.pathname.split('/').pop();
      const flagKey = url.searchParams.get('key') || '';
      const rows = table === 'syncview_runtime_flags' && flagKey === 'eq.prod_authority'
        ? [{ value: { video: 'linear', graphics: 'linear' } }]
        : table === 'syncview_runtime_flags'
          ? [{ value: { clients: [] } }]
        : table === 'sample_reviews'
        ? [{
          id: 'client-card',
          client: 'browserclient',
          name: 'Canonical client comment fixture',
          status: 'Client Approval',
          video_status: 'Client Approval',
          graphic_status: 'In Progress',
          video_deliverable_id: 'client-deliverable-video',
          graphic_deliverable_id: 'client-deliverable-graphic',
          video_tweaks: JSON.stringify([
            {
              id: 'legacy-internal',
              author: 'Legacy staff',
              role: 'smm',
              audience: 'internal',
              body: 'LEGACY INTERNAL LEAK',
              created_at: '2026-07-20T10:00:00Z',
            },
            {
              id: 'legacy-client',
              author: 'Fixture team',
              role: 'smm',
              audience: 'client',
              body: 'Canonical client-visible note',
              created_at: '2026-07-21T10:00:00Z',
            },
          ]),
          graphic_tweaks: '[]',
          updated_at: '2026-07-20T12:00:00Z',
        }]
        : table === 'deliverables'
        ? [
          {
            id: 'client-deliverable-video',
            client_slug: 'browserclient',
            team: 'video',
            origin: 'samples',
            card_id: clientCrosswalkCard,
          },
          {
            id: 'client-deliverable-graphic',
            client_slug: 'browserclient',
            team: 'graphics',
            origin: 'samples',
            card_id: clientCrosswalkCard,
          },
        ]
        : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rows),
      });
    });
    await clientPage.route('**/functions/v1/client-token-verify', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      const valid = body.client === 'Browser Client'
        && body.slug === 'browserclient'
        && body.token === clientToken
        && body.view === 'sample-reviews'
        && body.strict === true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(valid
          ? {
            ok: true,
            valid: true,
            allowed: true,
            slug: 'browserclient',
            display_name: 'Browser Client',
            view: 'sample-reviews',
            strict: true,
            active: true,
            protocol: 'syncview-client-entry-v1',
          }
          : { ok: true, valid: false, allowed: false, error: 'invalid_client_link' }),
      });
    });
    await clientPage.route('**/functions/v1/production-comments', async route => {
      const request = route.request();
      const body = JSON.parse(request.postData() || '{}');
      clientCommentReads.push({ body, headers: request.headers() });
      if (body.card_id === 'client-card-switch') {
        markBindingSwitchStarted();
        await bindingSwitchRelease;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'held binding switch failure' }),
        });
        return;
      }
      if (body.card_id === 'client-card-wrong-audience') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            canonical_thread: true,
            complete_thread: true,
            audience_scope: 'client',
            total: 1,
            comments: [{
              id: 'client-internal-leak',
              author_name: 'Internal reviewer',
              role: 'smm',
              body: 'CLIENT INTERNAL LEAK',
              audience: 'internal',
              component: 'video',
              source_created_at: '2026-07-21T13:00:00Z',
            }],
            next_cursor: null,
            has_more: false,
          }),
        });
        return;
      }
      const comments = body.deliverable_id === 'client-deliverable-video'
        ? clientCanonicalComments
        : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          canonical_thread: true,
          complete_thread: body.read_mode === 'complete',
          audience_scope: 'client',
          total: comments.length,
          comments,
          next_cursor: null,
          has_more: false,
        }),
      });
    });
    await clientPage.route('**/functions/v1/production-write', async route => {
      const request = route.request();
      const body = JSON.parse(request.postData() || '{}');
      clientGatewayWrites.push({ body, headers: request.headers() });
      const now = '2026-07-21T12:00:00Z';
      const committedComment = {
        id: 'client-gateway-write',
        native_comment_id: body.comment && body.comment.native_comment_id,
        deliverable_id: body.id,
        parent_id: body.comment && body.comment.parent_id || null,
        author_name: 'Browser Client',
        role: 'client',
        body: body.comment && body.comment.body,
        audience: 'client',
        component: body.comment && body.comment.component,
        is_tweak: false,
        source_created_at: now,
        source_updated_at: now,
        created_at: now,
        updated_at: now,
        version: 1,
        can_edit: true,
        can_delete: true,
        can_resolve: false,
      };
      clientCanonicalComments.unshift(committedComment);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          native_committed: true,
          authority: 'linear',
          legacy_parity: true,
          mirror_pending: false,
          row: {
            id: body.id,
            client_slug: 'browserclient',
            team: 'video',
          },
          comment: committedComment,
        }),
      });
    });
    try {
      const query = new URLSearchParams({
        sxr: '1',
        c: 'Browser Client',
        t: clientToken,
        v: 'sample-reviews',
      });
      await clientPage.goto(
        `http://127.0.0.1:${server.address().port}/?${query}`,
        { waitUntil: 'domcontentloaded' },
      );
      await clientPage.waitForFunction(() => typeof sxrState === 'object'
        && sxrState.client === 'Browser Client'
        && Array.isArray(sxrState.posts)
        && sxrState.posts.some(row => row.id === 'client-card'), null, { timeout: 15000 });
      await clientPage.evaluate(() => openSxrComments('client-card'));
      try {
        await clientPage.waitForSelector('[data-cm-row="client-safe"]', { timeout: 5000 });
      } catch (error) {
        const diagnostic = await clientPage.evaluate(() => {
          const post = sxrState.posts.find(row => row.id === 'client-card');
          return {
            reads: post && post._canonicalCommentReads,
            videoGate: post && _prodCanonicalCommentGate(post, 'video'),
            graphicGate: post && _prodCanonicalCommentGate(post, 'graphic'),
          };
        });
        throw new Error(`client canonical fixture did not settle: ${JSON.stringify(diagnostic)}; ${error.message}`);
      }

      const exactReads = clientCommentReads.map(read => read.body);
      expect(exactReads.length === 2, 'client Notes did not read both exact canonical deliverable slots');
      expect(exactReads.every(body => body.read_mode === 'complete'),
        'client canonical projection did not use one complete-thread request per deliverable');
      expect(exactReads.every(body => body.source_surface === 'sxr'
        && body.card_id === 'client-card'
        && (body.component === 'video' || body.component === 'graphic')),
      'client comment read did not bind the exact SXR card/component');
      expect(exactReads.some(body => body.deliverable_id === 'client-deliverable-video'
        && body.component === 'video')
        && exactReads.some(body => body.deliverable_id === 'client-deliverable-graphic'
          && body.component === 'graphic'),
      'client comment read crossed a canonical component/deliverable slot');
      expect(clientCommentReads.every(read =>
        read.headers['x-syncview-client-token'] === clientToken
        && !read.headers['x-syncview-key']),
      'verified client Notes did not use the exact client token principal');
      const clientModalText = await clientPage.locator('#sxrCommentsModal').textContent();
      expect(clientModalText.includes('Canonical client-visible note'),
        'canonical client-visible comment did not render on the verified client surface');
       expect(!clientModalText.includes('CLIENT INTERNAL LEAK')
        && !clientModalText.includes('LEGACY INTERNAL LEAK'),
      'client surface rendered an internal or legacy card-array comment');
      await clientPage.evaluate(() => {
        const post = sxrState.posts.find(row => row.id === 'client-card');
        _sxrMergePostComments(post, {
          video_comments: [{
            id: 'legacy-internal-reply',
            parent_id: 'client-safe',
            author: 'Legacy staff',
            role: 'smm',
            audience: 'internal',
            body: 'LEGACY INTERNAL REPLY LEAK',
            created_at: '2026-07-21T11:00:00Z',
            updated_at: '2026-07-21T11:00:00Z',
          }],
        });
        _sxrRenderCommentsModal();
      });
      const afterLegacyMerge = await clientPage.locator('#sxrCommentsModal').textContent();
      expect(!afterLegacyMerge.includes('LEGACY INTERNAL REPLY LEAK'),
        'a later legacy merge exposed an internal reply beneath a client root');
      expect(await clientPage.evaluate(() => {
        const post = sxrState.posts.find(row => row.id === 'client-card');
        const visible = _sxrCommentsForView(post, 'video');
        return visible.length > 0
          && visible.every(row => row.canonical === true && row.audience === 'client');
      }), 'verified client rendering admitted a noncanonical or non-client row');
      expect(await clientPage.evaluate(() => {
        const post = sxrState.posts.find(row => row.id === 'client-card');
        const video = _prodCanonicalCommentGate(post, 'video');
        const graphic = _prodCanonicalCommentGate(post, 'graphic');
        return video.ready && video.client && graphic.ready && graphic.client;
      }), 'real verified client-surface reads did not establish exact canonical capability');

      trackClientWrite = true;
      const writeSaved = await clientPage.evaluate(() => {
        _sxrComposeComp = 'video';
        _sxrComposeIsTweak = false;
        return _sxrAppendComment('client-card', null, 'Gateway-only client note');
      });
      trackClientWrite = false;
      expect(writeSaved === true, 'verified client comment did not complete');
      expect(clientGatewayWrites.length === 1,
        'flag-off verified client comment did not use exactly one production-write request');
      expect(clientGatewayWrites[0].body.operation === 'comment'
        && clientGatewayWrites[0].body.surface === 'sxr'
        && clientGatewayWrites[0].body.id === 'client-deliverable-video'
        && clientGatewayWrites[0].body.legacy_parity === true
        && clientGatewayWrites[0].headers['x-syncview-client-token'] === clientToken,
      'verified client comment lost its exact gateway target, parity lane, or principal');
      expect(clientFallbackWrites.length === 0,
        'flag-off verified client comment reached a legacy/source fallback: ' + clientFallbackWrites.join(' | '));
      const gatewayProjection = await clientPage.evaluate(() => {
        const post = sxrState.posts.find(row => row.id === 'client-card');
        const legacy = _sxrCommentsFor(post, 'video');
        const visible = _sxrCommentsForView(post, 'video');
        const pass = !legacy.some(row =>
          row && (row.id === 'client-gateway-write' || row.body === 'Gateway-only client note'))
          && visible.some(row => row && row.id === 'client-gateway-write'
            && row.canonical === true && row.audience === 'client');
        return { pass, legacy, visible, gate: _prodCanonicalCommentGate(post, 'video') };
      });
      expect(gatewayProjection.pass,
        'gateway client comment was persisted into legacy card arrays or missed canonical projection: '
          + JSON.stringify(gatewayProjection));

      clientCrosswalkCard = 'client-card-wrong-audience';
      await clientPage.evaluate(() => {
        const original = sxrState.posts.find(row => row.id === 'client-card');
        const wrongAudience = {
          ...original,
          id: 'client-card-wrong-audience',
          name: 'Wrong audience receipt fixture',
          graphic_deliverable_id: '',
          _canonicalCommentReads: {},
          _canonicalCommentsByComponent: Object.create(null),
        };
        sxrState.posts.push(wrongAudience);
        window.__wrongAudienceRead = _prodProjectCanonicalCardComments('sxr', wrongAudience.id);
      });
      await clientPage.evaluate(() => window.__wrongAudienceRead);
      expect(await clientPage.evaluate(() => {
        const post = sxrState.posts.find(row => row.id === 'client-card-wrong-audience');
        const gate = _prodCanonicalCommentGate(post, 'video');
        return gate.status === 'error' && !gate.ready && !gate.client
          && _sxrCanonicalCommentsFor(post, 'video').length === 0;
      }), 'wrong-audience complete receipt did not leave the exact client gate closed');
      const gatewayWritesBeforeBlockedAttempt = clientGatewayWrites.length;
      trackClientWrite = true;
      const wrongAudienceWrite = await clientPage.evaluate(() => {
        _sxrComposeComp = 'video';
        return _sxrAppendComment('client-card-wrong-audience', null, 'Must stay blocked');
      });
      trackClientWrite = false;
      expect(wrongAudienceWrite === false
        && clientGatewayWrites.length === gatewayWritesBeforeBlockedAttempt,
      'wrong-audience read failure reached production-write');

      clientCrosswalkCard = 'client-card-switch';
      await clientPage.evaluate(() => {
        const original = sxrState.posts.find(row => row.id === 'client-card');
        const switched = {
          ...original,
          id: 'client-card-switch',
          name: 'Binding switch fixture',
          graphic_deliverable_id: '',
          _canonicalCommentReads: {},
          _canonicalCommentsByComponent: Object.create(null),
        };
        sxrState.posts.push(switched);
        window.__bindingSwitchRead = _prodProjectCanonicalCardComments('sxr', switched.id);
      });
      await Promise.race([
        bindingSwitchStarted,
        new Promise((_, reject) => setTimeout(() => reject(new Error('binding switch request did not start')), 5000)),
      ]);
      expect(await clientPage.evaluate(() => {
        const post = sxrState.posts.find(row => row.id === 'client-card-switch');
        const gate = _prodCanonicalCommentGate(post, 'video');
        return gate.status === 'loading'
          && !gate.ready
          && !gate.client
          && _sxrCanonicalCommentsFor(post, 'video').length === 0
          && _prodComments.find('client-deliverable-video', 'client-safe') === null;
      }), 'binding switch retained prior ready capability or canonical items while the new read was held');
      releaseBindingSwitch();
      await clientPage.evaluate(() => window.__bindingSwitchRead);
      expect(await clientPage.evaluate(() => {
        const post = sxrState.posts.find(row => row.id === 'client-card-switch');
        const gate = _prodCanonicalCommentGate(post, 'video');
        return gate.status === 'error'
          && !gate.ready
          && !gate.client
          && _sxrCanonicalCommentsFor(post, 'video').length === 0
          && _prodComments.find('client-deliverable-video', 'client-safe') === null;
      }), 'failed binding switch restored prior verified rows or capability');
      expect(!clientPageErrors.length, 'client page errors: ' + clientPageErrors.join(' | '));
    } finally {
      await clientPage.close();
    }

    expect(!unexpectedWrites.length, 'unexpected write-like requests: ' + unexpectedWrites.join(' | '));
    expect(!pageErrors.length, 'page errors: ' + pageErrors.join(' | '));
    console.log('prod-comments-browser: staff thread plus exact verified client-link SXR canonical projection passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
