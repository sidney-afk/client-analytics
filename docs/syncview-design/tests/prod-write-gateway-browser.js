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
    { slug: 'calendarfixture', display_name: 'Calendar Fixture', active: true, kind: 'video' },
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
  const batches = [
    { id: 'batch-latest', client_slug: 'calendarfixture', team: null, name: 'Current fixture batch', status: 'active', created_at: '2026-07-13T10:00:00.000Z', updated_at: '2026-07-13T11:00:00.000Z' },
  ];
  const serverAuthority = { video: 'linear', graphics: 'syncview' };
  const writeUiRerouteClients = { clients: ['normal-fixture', 'calendarfixture'] };
  const writes = [];
  const calendarWrites = [];
  const calendarWriteRequests = [];
  const submissionLogs = [];
  const legacyCreateHits = [];
  const restHits = [];
  const networkOrder = [];
  let calendarIntakeCount = 0;
  let revision = 0;
  const server = await serve();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('request', request => {
    if (/\/webhook\/(video-form|graphic-form|linear-projects)(?:\?|$)/.test(request.url())) legacyCreateHits.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem('syncview_auth_v1', 'ok'));

  await page.route('**/functions/v1/key-verify', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true,
      role: 'admin',
      member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' },
    }) });
  });
  await page.route('**/functions/v1/filming-plans**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, plans: [] }) });
  });

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    restHits.push(table);
    let rows = [];
    if (table === 'clients') rows = clients;
    else if (table === 'team_members') rows = members;
    else if (table === 'batches') {
      const clientFilter = String(url.searchParams.get('client_slug') || '').replace(/^eq\./, '');
      const statusFilter = String(url.searchParams.get('status') || '').replace(/^eq\./, '');
      rows = batches.filter(row => (!clientFilter || row.client_slug === clientFilter) && (!statusFilter || row.status === statusFilter));
    }
    else if (table === 'deliverable_events') rows = [];
    else if (table === 'syncview_runtime_flags') {
      const key = String(url.searchParams.get('key') || '').replace(/^eq\./, '');
      rows = [{ value: key === 'write_ui_reroute_clients'
        ? { ...writeUiRerouteClients }
        : { ...serverAuthority } }];
    }
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
    const write = { body, headers: request.headers(), response: null };
    writes.push(write);
    if (body.operation === 'intake_create') {
      const calendarSequence = body.surface === 'calendar' ? ++calendarIntakeCount : 0;
      if (calendarSequence) networkOrder.push(`gateway-request:${body.request_id}`);
      const items = (body.items || []).map((item, item_index) => ({
        item_index,
        id: calendarSequence ? `native-calendar-${calendarSequence}-${item.team}-${item.videoNumber}` : `native-${item.team}-${item.videoNumber}`,
        team: item.team,
        card_id: item.card_id,
        origin: 'calendar',
        linear_issue_url: `https://linear.invalid/${item.team}-${item.videoNumber}`,
      }));
      write.response = {
        ok: true, native_committed: true, mirror_pending: false,
        batch: { id: body.batch_id || (calendarSequence ? `native-calendar-batch-${calendarSequence}` : 'native-batch') }, items,
      };
      if (calendarSequence) networkOrder.push(`gateway-response:${body.request_id}`);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(write.response) });
      return;
    }
    const row = deliverables.find(item => item.id === body.id);
    if (body.test_override === true) {
      write.response = { ok: false, error: 'invalid_test_override' };
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(write.response) });
      return;
    }
    const allowed = row && serverAuthority[row.team] === 'syncview';
    if (!allowed) {
      write.response = { ok: false, error: 'team_is_linear_authoritative' };
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(write.response) });
      return;
    }
    if (body.operation === 'status') row.status = body.status;
    if (body.operation === 'due') row.due_date = body.due_date || null;
    if (body.operation === 'assignee') row.assignee_id = body.assignee_id || null;
    row.updated_at = `2026-07-12T12:00:${String(++revision).padStart(2, '0')}.000Z`;
    const comment = body.operation === 'comment'
      ? { id: `comment-${revision}`, deliverable_id: row.id, body: body.comment.body, audience: body.comment.audience }
      : null;
    write.response = {
      ok: true,
      native_committed: true,
      mirror_pending: true,
      row: { ...row },
      ...(comment ? { comment } : {}),
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(write.response) });
  });
  await page.route('**/webhook/calendar-upsert-post', async route => {
    const payload = JSON.parse(route.request().postData() || '{}');
    calendarWrites.push(payload);
    calendarWriteRequests.push({ payload, headers: route.request().headers() });
    networkOrder.push(`calendar-upsert:${payload.post && payload.post.id}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/functions/v1/calendar-upsert', async route => {
    const payload = JSON.parse(route.request().postData() || '{}');
    calendarWrites.push(payload);
    calendarWriteRequests.push({ payload, headers: route.request().headers() });
    networkOrder.push(`calendar-upsert:${payload.post && payload.post.id}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/webhook/log-linear-submission', async route => {
    submissionLogs.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    try { await page.waitForSelector('[data-prod-row="gra-fixture"]', { timeout: 15000 }); }
    catch (error) { throw new Error('Production fixture did not render; page errors: ' + pageErrors.join(' | ')); }
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
    const lockedTestResponse = await testResponse;
    const testWrite = writes.find(write => write.body.id === 'test-fixture-row');
    expect(testWrite && testWrite.body.test_override === true
      && lockedTestResponse.status() === 401
      && testWrite.response && testWrite.response.error === 'invalid_test_override'
      && deliverables.find(row => row.id === 'test-fixture-row').status === 'in_progress',
    'browser staff self-entered TEST scope or reached the authority-bypass branch');
    // The rejected TEST override is an independent negative case. Re-establish
    // its fixture principal before the later stale-authority/intake scenarios
    // instead of making those cases depend on error-UI scheduling.
    await page.evaluate(() => {
      _syncviewCloseStaffIdentity(null, { restoreFocus: false });
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewStaffIdentityVerified = true;
      _syncviewStaffRefreshChrome();
    });

    serverAuthority.graphics = 'syncview';
    await page.evaluate(async () => { await _prodRefreshAuthority({ silent: true }); _prodOpenDeliverable('gra-fixture'); });
    await page.waitForSelector('[data-prod-comment-form="gra-fixture"]');
    serverAuthority.graphics = 'linear';
    await page.locator('[data-prod-prop="status"]').click();
    await page.locator('[data-prod-pick]', { hasText: 'Approved' }).click();
    await page.waitForFunction(() => document.querySelector('[data-prod-prop="status"]')?.getAttribute('aria-disabled') === 'true');
    expect(writes.some(write => write.body.id === 'gra-fixture' && write.body.status === 'approved'), 'stale-tab simulation never reached the server gate');

    await page.evaluate(() => navTo('linear'));
    await page.waitForSelector('#linearClientSearch');
    await page.evaluate(() => {
      selectLinearProject('Normal Fixture', 'normal-fixture');
      const cards = Array.from(document.querySelectorAll('[id^="videoCard_"]'));
      cards.slice(1).forEach(card => card.remove());
      renumberVideoCards();
      linearVideoCount = 1;
      saveLinearForm();
    });
    await page.locator('#vid_main_1').fill('https://drive.invalid/main');
    await page.evaluate(() => toggleLinearAdvanced());
    await page.locator('#linearSubmitBtnVideo').click();
    for (let i = 0; i < 100 && !writes.some(write => write.body.operation === 'intake_create'); i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!writes.some(write => write.body.operation === 'intake_create')) {
      const state = await page.evaluate(() => ({
        status: document.getElementById('linearStatus')?.textContent,
        client: document.getElementById('linearClientSearch')?.value,
        clientSlug: document.getElementById('linearClientSearch')?.dataset.clientSlug,
        clientRows: linearClientRows.length,
        signedIn: _syncviewStaffIdentityValid(),
      }));
      throw new Error('native intake request missing: ' + JSON.stringify(state));
    }
    for (let i = 0; i < 50 && calendarWrites.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 20));
    const intakeWrite = writes.find(write => write.body.operation === 'intake_create');
    expect(intakeWrite && intakeWrite.body.client_slug === 'normal-fixture' && intakeWrite.body.items.length === 1,
      'Submit did not send one canonical native intake envelope');
    expect(!Object.prototype.hasOwnProperty.call(intakeWrite.body, 'test_override'),
      'Submit tried to self-enter browser TEST scope');
    expect(intakeWrite.headers['x-syncview-key'] === 'browser-role-key' && intakeWrite.headers['x-syncview-actor'] === 'Browser Admin',
      'Submit omitted the verified staff principal');
    expect(calendarWrites.length === 1
      && calendarWrites[0].post.video_deliverable_id === 'native-video-1'
      && calendarWrites[0].post.id === intakeWrite.body.items[0].card_id,
      'Submit did not materialize the Calendar card from the returned native item index/ID');
    expect(submissionLogs.length === 1 && /native-batch/.test(submissionLogs[0].webhookJson || ''),
      'post-commit submission telemetry omitted the native batch');
    expect(legacyCreateHits.length === 0, 'Submit touched a retired Linear project/create webhook');
    // The calendar write is observed inside the durable job, before its final
    // checkpoint removes the pending record and releases the cross-surface lock.
    // Wait for the same completion boundary the real Submit UI awaits before
    // programmatically opening the next creation surface.
    await page.waitForFunction(() => _linearIntakeRead() === null, null, { timeout: 10000 });

    const beforeAppendCalendarWrites = calendarWrites.length;
    await page.evaluate(async () => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewStaffIdentityVerified = true;
      calState.client = 'Calendar Fixture';
      calState.posts = [];
      await _calOpenNativePost();
    });
    await page.waitForSelector('#calNativePostOverlay input[name="calNativeBatchChoice"]');
    const latestChoice = page.locator('#calNativePostOverlay input[value="batch"][data-batch-id="batch-latest"]');
    expect(await latestChoice.count() === 1 && await latestChoice.isChecked(),
      'Calendar Create Post did not default to the latest active batch: ' + JSON.stringify(await page.evaluate(() => ({
        client: calState.client,
        slug: calClientSlug(calState.client),
        state: _calNativePostState,
        text: document.getElementById('calNativePostOverlay')?.textContent,
      }))));
    expect(await page.locator('#calNativePostOverlay select').count() === 0
      && (await page.locator('#calNativePostOverlay').textContent()).includes('The client comes from this calendar.'),
    'Calendar Create Post exposed a client picker instead of using the open calendar client');
    expect(calendarWrites.length === beforeAppendCalendarWrites,
      'opening Calendar Create Post wrote a local card before native intake');

    let appendHttpResponse;
    try {
      [appendHttpResponse] = await Promise.all([
        page.waitForResponse(response => {
          if (!response.url().includes('/functions/v1/production-write')) return false;
          try {
            const body = JSON.parse(response.request().postData() || '{}');
            return body.operation === 'intake_create' && body.surface === 'calendar' && body.batch_id === 'batch-latest';
          } catch (_error) { return false; }
        }, { timeout: 10000 }),
        page.locator('#calNativePostCreate').click(),
      ]);
    }
    catch (error) {
      throw new Error('Calendar append never reached the gateway: ' + JSON.stringify({
        page: await page.evaluate(() => ({
          error: document.getElementById('calNativePostError')?.textContent,
          busy: document.getElementById('calNativePostOverlay')?.dataset.busy,
          selected: document.querySelector('input[name="calNativeBatchChoice"]:checked')?.value,
          pending: _linearIntakeRead(),
          identity: _syncviewStaffIdentityForHeaders(),
          state: _calNativePostState,
        })),
        writes: writes.map(write => ({ body: write.body, response: write.response })),
        calendarWrites,
        networkOrder,
        pageErrors,
      }), { cause: error });
    }
    const appendPayload = JSON.parse(appendHttpResponse.request().postData() || '{}');
    for (let i = 0; i < 100 && calendarWrites.length === beforeAppendCalendarWrites; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    try { await page.waitForSelector('#calNativePostOverlay', { state: 'detached' }); }
    catch (error) {
      throw new Error('Calendar append did not complete: ' + JSON.stringify({
        page: await page.evaluate(() => ({
          error: document.getElementById('calNativePostError')?.textContent,
          busy: document.getElementById('calNativePostOverlay')?.dataset.busy,
          pending: _linearIntakeRead(),
        })),
        writes: writes.map(write => ({ body: write.body, response: write.response })),
        calendarWrites,
        networkOrder,
        pageErrors,
      }), { cause: error });
    }
    const appendWrite = writes.find(write => write.body.request_id === appendPayload.request_id);
    const appendCardId = appendPayload.items[0] && appendPayload.items[0].card_id;
    const appendCalendar = calendarWrites.find(write => write.post && write.post.id === appendCardId);
    const appendCalendarRequest = calendarWriteRequests.find(write => write.payload.post && write.payload.post.id === appendCardId);
    const appendByTeam = Object.fromEntries((appendWrite.response.items || []).map(item => [item.team, item]));
    expect(appendHttpResponse.status() === 201
      && appendPayload.client_slug === 'calendarfixture'
      && appendPayload.batch_id === 'batch-latest'
      && appendPayload.expected_batch_updated_at === '2026-07-13T11:00:00.000Z'
      && !Object.prototype.hasOwnProperty.call(appendPayload, 'batch'),
    'latest-batch Calendar intake omitted the implicit client, batch id, or CAS cursor');
    expect(appendPayload.items.length === 2
      && appendPayload.items[0].team === 'video' && appendPayload.items[1].team === 'graphics'
      && appendPayload.items[0].card_id === appendPayload.items[1].card_id,
    'Calendar append did not create a paired VID+GRA post with one shared card id');
    expect(appendCalendar
      && appendCalendar.post.video_deliverable_id === appendByTeam.video.id
      && appendCalendar.post.graphic_deliverable_id === appendByTeam.graphics.id
      && appendCalendarRequest.headers['x-syncview-source'] === 'calendar-native',
    'Calendar append did not materialize from the gateway-returned native IDs/source');
    expect(networkOrder.indexOf(`gateway-response:${appendPayload.request_id}`) >= 0
      && networkOrder.indexOf(`gateway-response:${appendPayload.request_id}`) < networkOrder.indexOf(`calendar-upsert:${appendCardId}`),
    'Calendar append upsert ran before the native gateway response');
    await page.evaluate(() => dismissConfirm());

    batches.length = 0;
    const beforeNewCalendarWrites = calendarWrites.length;
    const beforeNewGatewayWrites = writes.length;
    await page.evaluate(async () => { await _calOpenNativePost(); });
    await page.waitForSelector('#calNativePostOverlay input[name="calNativeBatchChoice"][value="new"]');
    expect(await page.locator('#calNativePostOverlay input[value="new"]').isChecked()
      && await page.locator('#calNativePostOverlay input[value="latest"]').count() === 0,
    'Calendar Create Post did not fall back to a new batch when no active batch exists');
    expect(calendarWrites.length === beforeNewCalendarWrites,
      'new-batch choice wrote a local card before native intake');
    await page.locator('#calNativePostCreate').click();
    for (let i = 0; i < 100 && writes.length === beforeNewGatewayWrites; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const newWrite = writes.slice(beforeNewGatewayWrites).find(write => write.body.operation === 'intake_create' && write.body.surface === 'calendar');
    expect(newWrite, 'new-batch Calendar intake did not reach the gateway: ' + JSON.stringify(await page.evaluate(() => ({
      error: document.getElementById('calNativePostError')?.textContent,
      pending: _linearIntakeRead(),
    }))));
    const newPayload = newWrite.body;
    for (let i = 0; i < 100 && calendarWrites.length === beforeNewCalendarWrites; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await page.waitForSelector('#calNativePostOverlay', { state: 'detached' });
    const newCardId = newPayload.items[0] && newPayload.items[0].card_id;
    const newCalendar = calendarWrites.find(write => write.post && write.post.id === newCardId);
    const newByTeam = Object.fromEntries((newWrite.response.items || []).map(item => [item.team, item]));
    expect(newWrite.response && newWrite.response.ok === true && newWrite.response.native_committed === true
      && newPayload.operation === 'intake_create' && newPayload.surface === 'calendar'
      && newPayload.client_slug === 'calendarfixture'
      && newPayload.batch && /Calendar Fixture/.test(newPayload.batch.name || '')
      && !Object.prototype.hasOwnProperty.call(newPayload, 'batch_id'),
    'Calendar new-batch path did not reuse the canonical intake_create envelope');
    expect(newPayload.items.length === 2
      && newPayload.items[0].team === 'video' && newPayload.items[1].team === 'graphics'
      && newPayload.items[0].card_id === newPayload.items[1].card_id,
    'Calendar new-batch path did not create the paired VID+GRA post');
    expect(newCalendar
      && newCalendar.post.video_deliverable_id === newByTeam.video.id
      && newCalendar.post.graphic_deliverable_id === newByTeam.graphics.id,
    'Calendar new-batch path did not materialize from returned native IDs');
    expect(networkOrder.indexOf(`gateway-response:${newPayload.request_id}`) >= 0
      && networkOrder.indexOf(`gateway-response:${newPayload.request_id}`) < networkOrder.indexOf(`calendar-upsert:${newCardId}`),
    'Calendar new-batch upsert ran before the native gateway response');

    expect(!pageErrors.length, 'page errors: ' + pageErrors.join(' | '));
    console.log('prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
