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
function expect(value, message) { if (!value) throw new Error(message); }

(async () => {
  const now = '2026-07-12T12:00:00.000Z';
  const clients = [
    { slug: 'normal-fixture', display_name: 'Normal Fixture', active: true, kind: 'video' },
    { slug: 'test-fixture', display_name: 'TEST Fixture', active: true, kind: 'test' },
  ];
  const members = [
    { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics', active: true },
    { id: 'designer', name: 'Browser Designer', role: 'designer', team: 'graphics', active: true },
    { id: 'editor', name: 'Browser Editor', role: 'editor', team: 'video', active: true },
  ];
  const deliverables = [
    { id: 'gra-fixture', identifier: 'GRA-TEST', client_slug: 'normal-fixture', team: 'graphics', title: 'Graphics fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    { id: 'vid-fixture', identifier: 'VID-TEST', client_slug: 'normal-fixture', team: 'video', title: 'Video fixture', status: 'in_progress', status_at: now, assignee_id: 'editor', due_date: null, created_at: now, updated_at: now },
    { id: 'test-fixture-row', identifier: 'GRA-TEST-OVERRIDE', client_slug: 'test-fixture', team: 'graphics', title: 'TEST override fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
  ];
  const serverAuthority = { video: 'linear', graphics: 'syncview' };
  const writes = [];
  const restHits = [];
  let revision = 0;
  const server = await serve();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    restHits.push(table);
    let rows = [];
    if (table === 'clients') rows = clients;
    else if (table === 'team_members') rows = members;
    else if (table === 'batches' || table === 'deliverable_events') rows = [];
    else if (table === 'syncview_runtime_flags') rows = [{ value: { ...serverAuthority } }];
    else if (table === 'deliverables') {
      const idFilter = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
      rows = idFilter ? deliverables.filter(row => row.id === idFilter) : deliverables;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route('**/functions/v1/production-comments', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ comments: [], next_cursor: null, has_more: false }),
  }));
  await page.route('**/functions/v1/production-write', async route => {
    const request = route.request();
    const body = JSON.parse(request.postData() || '{}');
    writes.push({ body, headers: request.headers() });
    const row = deliverables.find(item => item.id === body.id);
    const allowed = row && (serverAuthority[row.team] === 'syncview' || (row.client_slug === 'test-fixture' && body.test_override === true));
    if (!allowed) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'team_is_linear_authoritative' }) });
      return;
    }
    if (body.operation === 'status') row.status = body.status;
    if (body.operation === 'due') row.due_date = body.due_date || null;
    if (body.operation === 'assignee') row.assignee_id = body.assignee_id || null;
    row.updated_at = `2026-07-12T12:00:${String(++revision).padStart(2, '0')}.000Z`;
    const comment = body.operation === 'comment'
      ? { id: `comment-${revision}`, deliverable_id: row.id, body: body.comment.body, audience: body.comment.audience }
      : null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true,
      native_committed: true,
      mirror_pending: true,
      row: { ...row },
      ...(comment ? { comment } : {}),
    }) });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-prod-row="gra-fixture"]', { timeout: 15000 });
    await page.evaluate(() => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewStaffIdentityVerified = true;
      _prodRender();
    });

    await page.evaluate(() => _prodOpenDeliverable('gra-fixture'));
    const initialGate = await page.evaluate(() => ({
      authority: _prodState.authority,
      loaded: _prodState.authorityLoaded,
      canWrite: _prodCanWrite(_prodIssue('gra-fixture'), 'comment'),
      gate: _prodWriteGateText(_prodIssue('gra-fixture'), 'comment'),
    }));
    expect(initialGate.canWrite, 'graphics write gate did not open: ' + JSON.stringify({ initialGate, restHits }));
    await page.waitForSelector('[data-prod-comment-form="gra-fixture"]');
    expect((await page.locator('.prod-preview-chip').textContent()).includes('Graphics writable'), 'mixed-team authority was not visible in the mirror chrome');
    expect(await page.locator('[data-prod-prop="status"]').getAttribute('aria-disabled') === 'false', 'SyncView-authoritative graphics controls were not enabled');

    await page.locator('[data-prod-prop="status"]').click();
    await page.locator('[data-prod-pick]', { hasText: 'Tweak Needed' }).click();
    await page.waitForFunction(() => window._prodIssue('gra-fixture').sourceStatus === 'tweak');
    const statusWrite = writes.find(write => write.body.operation === 'status' && write.body.id === 'gra-fixture');
    expect(statusWrite && statusWrite.body.surface === 'production' && statusWrite.body.entity === 'deliverable', 'status did not use the Production gateway envelope');
    expect(statusWrite.body.expected_status === 'in_progress' && statusWrite.body.expected_updated_at === now, 'status write omitted CAS');
    expect(statusWrite.headers['x-syncview-key'] === 'browser-role-key' && statusWrite.headers['x-syncview-actor'] === 'Browser Admin', 'verified staff attribution headers missing');

    await page.locator('[data-prod-prop="due"]').click();
    await page.locator('[data-prod-day]').first().click();
    await page.waitForFunction(() => window._prodIssue('gra-fixture').dueRaw);
    const dueWrite = writes.find(write => write.body.operation === 'due');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(dueWrite.body.due_date), 'due picker did not send an ISO calendar date');

    await page.locator('[data-prod-prop="assignee"]').click();
    const assigneeResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'assignee');
    await page.locator('[data-prod-pick]', { hasText: 'Browser Designer' }).click();
    await assigneeResponse;
    expect(writes.some(write => write.body.operation === 'assignee' && write.body.assignee_id === 'designer'), 'assignee did not route through the gateway');

    await page.locator('[data-prod-comment-input]').fill('Browser gateway comment');
    await page.locator('.prod-composer-audience').selectOption('client');
    const commentResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'comment');
    await page.locator('.prod-composer-submit').click();
    await commentResponse;
    const commentWrite = writes.find(write => write.body.operation === 'comment');
    expect(commentWrite && commentWrite.body.comment.body === 'Browser gateway comment' && commentWrite.body.comment.audience === 'client', 'comment body/audience did not reach the gateway');
    expect(!('expected_updated_at' in commentWrite.body), 'comment incorrectly carried scalar CAS');

    const beforeVideo = writes.length;
    await page.evaluate(() => _prodOpenDeliverable('vid-fixture'));
    expect(await page.locator('[data-prod-prop="status"]').getAttribute('aria-disabled') === 'true', 'Linear-authoritative video controls were enabled');
    await page.locator('[data-prod-prop="status"]').dispatchEvent('click');
    expect(writes.length === beforeVideo, 'Linear-authoritative control reached the gateway');

    serverAuthority.graphics = 'linear';
    await page.evaluate(() => _prodOpenDeliverable('test-fixture-row'));
    await page.locator('[data-prod-prop="status"]').click();
    const testResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').id === 'test-fixture-row');
    await page.locator('[data-prod-pick]', { hasText: 'Tweak Needed' }).click();
    await testResponse;
    const testWrite = writes.find(write => write.body.id === 'test-fixture-row');
    expect(testWrite && testWrite.body.test_override === true, 'active TEST target did not derive the bounded browser override');

    serverAuthority.graphics = 'syncview';
    await page.evaluate(async () => { await _prodRefreshAuthority({ silent: true }); _prodOpenDeliverable('gra-fixture'); });
    await page.waitForSelector('[data-prod-comment-form="gra-fixture"]');
    serverAuthority.graphics = 'linear';
    await page.locator('[data-prod-prop="status"]').click();
    await page.locator('[data-prod-pick]', { hasText: 'Approved' }).click();
    await page.waitForFunction(() => document.querySelector('[data-prod-prop="status"]')?.getAttribute('aria-disabled') === 'true');
    expect(writes.some(write => write.body.id === 'gra-fixture' && write.body.status === 'approved'), 'stale-tab simulation never reached the server gate');
    expect(!pageErrors.length, 'page errors: ' + pageErrors.join(' | '));
    console.log('prod-write-gateway-browser: authority, TEST override, four operations, CAS, attribution, and stale-tab gate passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
