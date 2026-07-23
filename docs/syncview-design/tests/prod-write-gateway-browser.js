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
    { slug: 'normal-fixture', display_name: 'Normal Fixture', active: true, kind: 'video', linear_project_ids: [{ id: 'linear-project-normal' }] },
    { slug: 'calendarfixture', display_name: 'Calendar Fixture', active: true, kind: 'video', linear_project_ids: [{ id: 'linear-project-calendar' }] },
    { slug: 'test-fixture', display_name: 'TEST Fixture', active: true, kind: 'test', linear_project_ids: [{ id: 'linear-project-test' }] },
  ];
  const members = [
    { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics', active: true },
    { id: 'designer', name: 'Browser Designer', role: 'designer', team: 'graphics', active: true },
    { id: 'editor', name: 'Browser Editor', role: 'editor', team: 'video', active: true },
  ];
  const deliverables = [
    { id: 'gra-fixture', identifier: 'GRA-TEST', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'graphics', title: 'Graphics fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    { id: 'vid-fixture', identifier: 'VID-TEST', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'video', title: 'Video fixture', status: 'in_progress', status_at: now, assignee_id: 'editor', due_date: null, created_at: now, updated_at: now },
    { id: 'test-fixture-row', identifier: 'GRA-TEST-OVERRIDE', raw_project_id: 'linear-project-test', client_slug: 'test-fixture', team: 'graphics', title: 'TEST override fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    { id: 'gra-description-parent', identifier: 'GRA-DESC-P', linear_issue_uuid: 'linear-description-parent', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'graphics', title: 'Description parent fixture', brief: '# Parent brief\n\n- First item\n\n**Owner:** Browser Admin', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    { id: 'gra-description-child', identifier: 'GRA-DESC-C', linear_issue_uuid: 'linear-description-child', raw_issue_parent_id: 'linear-description-parent', client_slug: 'normal-fixture', team: 'graphics', title: 'Description sub-issue fixture', brief: '## Child brief\n\n`source` text', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
  ];
  const batches = [
    { id: 'batch-latest', client_slug: 'calendarfixture', team: null, name: 'Current fixture batch', status: 'active', created_at: '2026-07-13T10:00:00.000Z', updated_at: '2026-07-13T11:00:00.000Z' },
  ];
  const serverAuthority = { video: 'linear', graphics: 'syncview' };
  const writeUiRerouteClients = { clients: ['normal-fixture', 'calendarfixture'] };
  const writes = [];
  const labelReads = [];
  const createOptionReads = [];
  const createdProductionIssues = [];
  const productionCreateReceipts = new Map();
  const labelCatalog = [
    { id: 'ordinary', name: 'Ordinary label', color: '#5E6AD2', description: 'An arbitrary label that must survive every write.' },
    { id: 'workload-2', name: '2× Workload', color: '#F59E0B', description: 'Counts as two video workload units.' },
    { id: 'workload-3', name: '3× Workload', color: '#EF4444', description: 'Counts as three video workload units.' },
  ];
  const selectedLabelIds = new Map(deliverables.map(row => [row.id, ['ordinary']]));
  let heldLabelRead = null;
  let heldLabelWrite = null;
  let heldCreateOptions = null;
  let failedProductionCreates = 0;
  let conflictingProductionCreates = 0;
  const descriptionReads = [];
  let heldDescriptionRead = null;
  let heldBriefsRead = null;
  let failedDescriptionReads = 0;
  const calendarWrites = [];
  const calendarWriteRequests = [];
  const submissionLogs = [];
  const legacyCreateHits = [];
  const legacyProjectReads = [];
  const restHits = [];
  const networkOrder = [];
  const implicitCardWrites = [];
  let calendarIntakeCount = 0;
  let revision = 0;
  const server = await serve();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('request', request => {
    if (/\/webhook\/(video-form|graphic-form)(?:\?|$)/.test(request.url())) legacyCreateHits.push(request.url());
    if (request.method() !== 'GET'
        && /(?:calendar-upsert|sample-review-upsert|samples-upsert)/i.test(request.url())) {
      implicitCardWrites.push({ method: request.method(), url: request.url() });
    }
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
  await page.route('**/webhook/linear-projects', async route => {
    legacyProjectReads.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: clients.map(client => client.display_name) }),
    });
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
      const select = String(url.searchParams.get('select') || '');
      if (!idFilter && select === 'id,brief') {
        rows = rows.map(row => ({ id: row.id, brief: row.brief == null ? null : row.brief }));
        const held = heldBriefsRead;
        if (held) {
          heldBriefsRead = null;
          held.started();
          await held.release;
        }
      } else if (idFilter && select === 'id,linear_raw') {
        rows = rows.map(row => ({
          id: row.id,
          linear_raw: row.linear_raw || {
            issue: {
              project: row.raw_project_id ? { id: row.raw_project_id } : null,
              parent: row.raw_issue_parent_id ? { id: row.raw_issue_parent_id } : null,
            },
          },
        }));
      } else if (idFilter && select === 'id,brief,updated_at') {
        rows = rows.map(row => ({ id: row.id, brief: row.brief == null ? null : row.brief, updated_at: row.updated_at }));
        descriptionReads.push({ id: idFilter, select });
        const held = heldDescriptionRead;
        if (held) {
          heldDescriptionRead = null;
          held.started();
          await held.release;
        }
        if (failedDescriptionReads > 0) {
          failedDescriptionReads--;
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic_description_read_failure' }) });
          return;
        }
      }
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
    if (body.action === 'labels_read') {
      labelReads.push({ body, headers: request.headers() });
      const ids = selectedLabelIds.get(body.id) || [];
      const held = heldLabelRead;
      if (held) {
        heldLabelRead = null;
        held.started();
        await held.release;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          complete: true,
          authority: serverAuthority[(deliverables.find(row => row.id === body.id) || {}).team] || 'linear',
          catalog: labelCatalog,
          selected_label_ids: ids,
          selected_labels: ids.map(id => labelCatalog.find(label => label.id === id)).filter(Boolean),
        }),
      });
      return;
    }
    if (body.action === 'create_options') {
      const read = { body, headers: request.headers(), response: null };
      createOptionReads.push(read);
      const held = heldCreateOptions;
      if (held) {
        heldCreateOptions = null;
        held.started();
        await held.release;
      }
      const client = clients.find(item => item.slug === body.client_slug && item.active === true);
      const authorized = read.headers['x-syncview-key'] === 'browser-role-key'
        && read.headers['x-syncview-actor'] === 'Browser Admin';
      if (!authorized) {
        read.response = { ok: false, error: 'credentials_required' };
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(read.response) });
        return;
      }
      if (!client) {
        read.response = { ok: false, error: 'client_not_found' };
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(read.response) });
        return;
      }
      if (serverAuthority[body.team] !== 'syncview') {
        read.response = { ok: false, error: 'team_is_linear_authoritative' };
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(read.response) });
        return;
      }
      read.response = {
        ok: true,
        complete: true,
        authority: 'syncview',
        catalog: labelCatalog,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(read.response) });
      return;
    }
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
    if (body.operation === 'create') {
      if (write.headers['x-syncview-key'] !== 'browser-role-key'
          || write.headers['x-syncview-actor'] !== 'Browser Admin') {
        write.response = { ok: false, error: 'credentials_required' };
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(write.response) });
        return;
      }
      if (body.test_override === true) {
        write.response = { ok: false, error: 'invalid_test_override' };
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(write.response) });
        return;
      }
      const existingCreate = productionCreateReceipts.get(String(body.request_id || ''));
      if (existingCreate) {
        if (existingCreate.terminalConflict) {
          write.response = {
            ok: false,
            error: 'idempotency_conflict',
            native_committed: true,
            mirror_pending: false,
            row: { ...existingCreate.row },
            batch: { ...existingCreate.batch },
            mirror: [{ target_status: 'skipped', terminal_conflict: true }],
          };
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(write.response) });
          return;
        }
        write.response = {
          ok: true,
          native_committed: true,
          authority: 'syncview',
          mirror_pending: false,
          mirror: [{ target_status: 'written', acknowledged: true }],
          batch: { ...existingCreate.batch },
          row: { ...existingCreate.row },
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(write.response) });
        return;
      }
      if (failedProductionCreates > 0) {
        failedProductionCreates--;
        write.response = { ok: false, error: 'synthetic_create_failure' };
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(write.response) });
        return;
      }
      const client = clients.find(item => item.slug === body.client_slug && item.active === true);
      const parent = body.parent_id
        ? deliverables.find(item => item.id === body.parent_id)
        : null;
      const parentIsValid = !body.parent_id || (parent
        && !parent.raw_issue_parent_id
        && parent.client_slug === body.client_slug
        && parent.team === body.team);
      const allowed = client && serverAuthority[body.team] === 'syncview' && parentIsValid;
      if (!allowed) {
        write.response = {
          ok: false,
          error: !parentIsValid ? 'parent_scope_mismatch' : 'team_is_linear_authoritative',
        };
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(write.response) });
        return;
      }
      const sequence = createdProductionIssues.length + 1;
      const projectId = ((client.linear_project_ids || [])[0] || {}).id || null;
      const row = {
        id: `production-created-${sequence}`,
        identifier: `${body.team === 'graphics' ? 'GRA' : 'VID'}-CREATE-${sequence}`,
        linear_issue_uuid: `linear-production-created-${sequence}`,
        raw_project_id: projectId,
        raw_issue_parent_id: parent ? parent.linear_issue_uuid : null,
        client_slug: body.client_slug,
        team: body.team,
        title: body.title,
        brief: body.description,
        status: body.status,
        status_at: now,
        assignee_id: body.assignee_id,
        due_date: body.due_date,
        created_at: now,
        updated_at: `2026-07-12T12:01:${String(sequence).padStart(2, '0')}.000Z`,
      };
      deliverables.push(row);
      selectedLabelIds.set(row.id, Array.isArray(body.label_ids) ? [...body.label_ids] : []);
      createdProductionIssues.push(row);
      const terminalConflict = conflictingProductionCreates > 0;
      if (terminalConflict) conflictingProductionCreates--;
      const batch = { id: `production-batch-${sequence}` };
      productionCreateReceipts.set(String(body.request_id || ''), {
        row: { ...row },
        batch,
        terminalConflict,
      });
      write.response = {
        ok: true,
        native_committed: true,
        authority: 'syncview',
        mirror_pending: true,
        mirror: [],
        batch,
        row: { ...row },
      };
      await route.fulfill({ status: terminalConflict ? 202 : 201, contentType: 'application/json', body: JSON.stringify(write.response) });
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
    if (body.operation === 'description' && body.expected_updated_at !== row.updated_at) {
      write.response = { ok: false, error: 'write_conflict', row: { ...row } };
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(write.response) });
      return;
    }
    if (body.operation === 'status') row.status = body.status;
    if (body.operation === 'due') row.due_date = body.due_date || null;
    if (body.operation === 'assignee') row.assignee_id = body.assignee_id || null;
    if (body.operation === 'description') row.brief = body.description;
    if (body.operation === 'labels') {
      const ids = Array.isArray(body.label_ids) ? [...body.label_ids] : [];
      selectedLabelIds.set(row.id, ids);
      row.linear_raw = {
        issue: {
          labels: {
            nodes: ids.map(id => labelCatalog.find(label => label.id === id)).filter(Boolean),
          },
        },
      };
    }
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
      ...(body.operation === 'labels' ? {
        selected_label_ids: selectedLabelIds.get(row.id),
        selected_labels: selectedLabelIds.get(row.id).map(id => labelCatalog.find(label => label.id === id)).filter(Boolean),
      } : {}),
    };
    if (body.operation === 'labels' && heldLabelWrite) {
      const held = heldLabelWrite;
      heldLabelWrite = null;
      held.started();
      await held.release;
    }
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

    const implicitWritesBeforeProductionCreate = implicitCardWrites.length;
    const calendarWritesBeforeProductionCreate = calendarWrites.length;
    const legacyCreatesBeforeProductionCreate = legacyCreateHits.length;
    failedProductionCreates = 1;
    await page.evaluate(() => {
      _prodState.openId = '';
      _prodState.openProjectId = 'normal-fixture';
      _prodState.team = 'graphics';
      _prodOpenCreate();
    });
    await page.waitForSelector('[data-prod-create-modal]');
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready');
    const brandedCreateControls = await page.evaluate(() => {
      const trigger = document.getElementById('prodCreateClientBtn');
      const light = trigger ? {
        color: getComputedStyle(trigger).color,
        background: getComputedStyle(trigger).backgroundImage,
      } : null;
      document.documentElement.setAttribute('data-theme', 'dark');
      const dark = trigger ? {
        color: getComputedStyle(trigger).color,
        background: getComputedStyle(trigger).backgroundImage,
      } : null;
      document.documentElement.removeAttribute('data-theme');
      return {
        selects: document.querySelectorAll('[data-prod-create-modal] [data-sv-select]').length,
        dates: document.querySelectorAll('[data-prod-create-modal] [data-sv-date-picker]').length,
        nativeSelects: document.querySelectorAll('[data-prod-create-modal] select').length,
        exposedNativeDates: document.querySelectorAll('[data-prod-create-modal] input[type="date"]:not(.sv-date-value)').length,
        light,
        dark,
      };
    });
    expect(brandedCreateControls.selects === 5
      && brandedCreateControls.dates === 1
      && brandedCreateControls.nativeSelects === 0
      && brandedCreateControls.exposedNativeDates === 0,
    'parent creation exposed a native select/date control instead of the SyncView primitives');
    expect(brandedCreateControls.light && brandedCreateControls.dark
      && brandedCreateControls.light.color !== brandedCreateControls.dark.color
      && brandedCreateControls.light.background !== brandedCreateControls.dark.background,
    'creation controls did not inherit the active SyncView theme');
    await page.setViewportSize({ width: 360, height: 760 });
    const mobileCreateLayout = await page.evaluate(() => {
      const modal = document.querySelector('[data-prod-create-modal]');
      const body = modal && modal.querySelector('.prod-create-body');
      const rect = modal && modal.getBoundingClientRect();
      return {
        oneColumn: !!body && getComputedStyle(body).gridTemplateColumns.split(/\s+/).length === 1,
        insideViewport: !!rect && rect.left >= 0 && rect.right <= innerWidth,
        noModalOverflow: !!modal && !!body
          && modal.scrollWidth <= modal.clientWidth + 1
          && body.scrollWidth <= body.clientWidth + 1,
      };
    });
    expect(mobileCreateLayout.oneColumn && mobileCreateLayout.insideViewport && mobileCreateLayout.noModalOverflow,
      'creation controls did not stay within the one-column mobile modal: ' + JSON.stringify(mobileCreateLayout));
    await page.locator('#prodCreateClientBtn').click();
    const mobileClientMenu = await page.locator('#prodCreateClientMenu').boundingBox();
    expect(mobileClientMenu && mobileClientMenu.x >= 0 && mobileClientMenu.x + mobileClientMenu.width <= 360,
      'creation select menu escaped the mobile viewport');
    await page.locator('#prodCreateClientBtn').focus();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.activeElement?.id === 'prodCreateClientBtn'
      && document.getElementById('prodCreateClientBtn')?.getAttribute('aria-expanded') === 'false'),
    'creation select Escape did not close and return focus to its trigger');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#prodCreateModeBtn').click();
    await page.locator('#prodCreateModeMenu [data-value="subissue"]').click();
    expect(await page.evaluate(() => document.getElementById('prodCreateMode')?.value === 'subissue'
      && !!document.getElementById('prodCreateParentBtn')
      && document.activeElement?.id === 'prodCreateModeBtn'),
    'issue-type selection did not rerender the branded parent control or return focus');
    await page.locator('#prodCreateParentBtn').click();
    await page.locator('#prodCreateParentMenu [data-value="gra-description-parent"]').click();
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready');
    expect(await page.evaluate(() => document.getElementById('prodCreateParent')?.value === 'gra-description-parent'
      && document.getElementById('prodCreateClient')?.value === 'normal-fixture'
      && document.getElementById('prodCreateTeam')?.value === 'graphics'
      && document.getElementById('prodCreateClientBtn')?.disabled
      && document.getElementById('prodCreateTeamBtn')?.disabled
      && document.activeElement?.id === 'prodCreateParentBtn'),
    'parent selection did not lock and preserve the branded scope controls');
    await page.locator('#prodCreateModeBtn').click();
    await page.locator('#prodCreateModeMenu [data-value="parent"]').click();
    await page.locator('#prodCreateClientBtn').click();
    await page.locator('#prodCreateClientMenu [data-value="calendarfixture"]').click();
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready'
      && _prodState.createDraft?.clientSlug === 'calendarfixture');
    await page.locator('#prodCreateClientBtn').click();
    await page.locator('#prodCreateClientMenu [data-value="normal-fixture"]').click();
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready'
      && _prodState.createDraft?.clientSlug === 'normal-fixture');
    await page.locator('#prodCreateTeamBtn').click();
    await page.locator('#prodCreateTeamMenu [data-value="video"]').click();
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'error'
      && _prodState.createDraft?.team === 'video');
    await page.locator('#prodCreateTeamBtn').click();
    await page.locator('#prodCreateTeamMenu [data-value="graphics"]').click();
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready'
      && _prodState.createDraft?.team === 'graphics');
    expect(await page.evaluate(() => document.activeElement?.id === 'prodCreateTeamBtn'
      && document.getElementById('prodCreateMode')?.value === 'parent'
      && !document.getElementById('prodCreateClientBtn')?.disabled
      && !document.getElementById('prodCreateTeamBtn')?.disabled),
    'client/team selections did not rerender the branded controls with their editable parent scope');
    const createOptionsRead = createOptionReads[createOptionReads.length - 1];
    expect(createOptionsRead
      && createOptionsRead.body.action === 'create_options'
      && createOptionsRead.body.surface === 'production'
      && createOptionsRead.body.client_slug === 'normal-fixture'
      && createOptionsRead.body.team === 'graphics'
      && createOptionsRead.headers['x-syncview-key'] === 'browser-role-key'
      && createOptionsRead.headers['x-syncview-actor'] === 'Browser Admin'
      && createOptionsRead.response.complete === true,
    'creation did not read a protected complete team label catalog');
    const createWorkloadOption = page.locator('[data-prod-create-label-option="workload-3"]');
    expect(await createWorkloadOption.locator('input[type="checkbox"]').isChecked() === false,
      'creation label catalog did not start with an explicit unchecked state');
    expect(await createWorkloadOption.locator('.prod-label-dot').evaluate(element =>
      getComputedStyle(element).getPropertyValue('--prod-label-color').trim().toUpperCase()) === '#EF4444',
    'creation label color did not reach the rendered option');
    expect((await createWorkloadOption.getAttribute('title')).includes('three video workload units')
      && (await createWorkloadOption.locator('small').textContent()).includes('three video workload units'),
    'creation label description was not exposed as visible help and a tooltip');
    await page.locator('.prod-create-label-search').fill('three video workload');
    expect(await page.locator('[data-prod-create-label-option]:visible').count() === 1,
      'creation label search did not narrow the complete catalog');
    await createWorkloadOption.locator('input[type="checkbox"]').check();
    expect(await createWorkloadOption.locator('input[type="checkbox"]').isChecked(),
      'creation label checkbox did not preserve selected state');
    await page.locator('.prod-create-label-search').fill('');
    await page.locator('[data-prod-create-label-option="ordinary"] input[type="checkbox"]').check();

    const parentTitle = 'TEST Production parent creation';
    const parentMarkdown = '# Parent creation\n\n- Preserve this Markdown  \n\n**Owner:** Browser Admin\n';
    await page.locator('#prodCreateTitle').fill(parentTitle);
    await page.locator('#prodCreateDescription').fill(parentMarkdown);
    await page.locator('#prodCreateStatusBtn').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.getElementById('prodCreateStatus')?.value === 'smm_approval'
      && document.activeElement?.id === 'prodCreateStatusBtn'),
    'creation status keyboard selection did not commit or return focus');
    await page.locator('#prodCreateDueBtn').click();
    await page.waitForSelector('#svDatePickerPopup');
    const ratifiedToday = await page.evaluate(() => wlWorkloadTodayISO());
    await page.locator('#svDatePickerPopup [data-dp-act="today"]').click();
    expect(await page.evaluate(today => document.getElementById('prodCreateDue')?.value === today
      && document.activeElement?.id === 'prodCreateDueBtn', ratifiedToday),
    'creation calendar Today did not use the ratified day contract or return focus');
    await page.evaluate(value => {
      const input = document.getElementById('prodCreateDue');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      _svSyncDateControl('prodCreateDue');
    }, '2031-02-17');
    await page.locator('#prodCreateDueBtn').click();
    await page.waitForSelector('#svDatePickerPopup');
    expect((await page.locator('#svDatePickerPopup .dp-head-label').textContent()).includes('2031'),
      'creation calendar dropped the selected due-date year');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.activeElement?.id === 'prodCreateDueBtn'),
      'creation calendar Escape did not return focus to its trigger');
    await page.locator('#prodCreateAssigneeBtn').click();
    await page.locator('#prodCreateAssigneeMenu [data-value="designer"]').click();
    expect(await page.evaluate(() => document.getElementById('prodCreateAssignee')?.value === 'designer'
      && document.activeElement?.id === 'prodCreateAssigneeBtn'),
    'creation assignee selection did not commit or return focus');
    const parentIntent = await page.evaluate(() => ({
      requestId: _prodState.createDraft.requestId,
      sourceEditedAt: _prodState.createDraft.sourceEditedAt,
      draft: JSON.parse(JSON.stringify(_prodState.createDraft)),
    }));
    const failedParentResponse = page.waitForResponse(response => {
      if (!response.url().includes('/functions/v1/production-write')) return false;
      try {
        const body = JSON.parse(response.request().postData() || '{}');
        return body.operation === 'create' && body.title === parentTitle;
      } catch (_error) { return false; }
    });
    await page.locator('.prod-create-submit').click();
    expect((await failedParentResponse).status() === 503, 'parent creation retry fixture did not fail ambiguously');
    await page.waitForFunction(() => document.querySelector('[data-prod-create-error]')?.textContent.includes('draft is still here'));
    const firstParentWrite = writes.filter(write => write.body.operation === 'create' && write.body.title === parentTitle)[0];
    expect(firstParentWrite
      && firstParentWrite.body.request_id === parentIntent.requestId
      && firstParentWrite.body.source_edited_at === parentIntent.sourceEditedAt,
    'first parent creation attempt did not use the saved intent identity');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _prodState !== 'undefined'
      && !_prodState.loading && !!_prodIssue('gra-fixture'), null, { timeout: 15000 });
    await page.evaluate(() => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewStaffIdentityVerified = true;
      _prodState.openId = '';
      _prodState.openProjectId = 'normal-fixture';
      _prodState.team = 'graphics';
      _prodRender();
      // Add Sub from another root must recover the ambiguous request exactly;
      // it cannot retarget a request that may already have committed.
      _prodOpenCreate('gra-description-parent');
    });
    await page.waitForSelector('[data-prod-create-modal]');
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready');
    const recoveredParentDraft = await page.evaluate(() => JSON.parse(JSON.stringify(_prodState.createDraft)));
    expect(recoveredParentDraft.requestId === parentIntent.requestId
      && recoveredParentDraft.sourceEditedAt === parentIntent.sourceEditedAt
      && recoveredParentDraft.clientSlug === 'normal-fixture'
      && recoveredParentDraft.team === 'graphics'
      && recoveredParentDraft.mode === 'parent'
      && recoveredParentDraft.parentId === ''
      && recoveredParentDraft.title === parentTitle
      && recoveredParentDraft.description === parentMarkdown
      && recoveredParentDraft.status === 'smm_approval'
      && recoveredParentDraft.dueDate === '2031-02-17'
      && recoveredParentDraft.assigneeId === 'designer'
      && JSON.stringify(recoveredParentDraft.labelIds) === JSON.stringify(['ordinary', 'workload-3']),
    'page refresh did not recover the exact parent fields, Markdown, labels, or intent identity');
    expect(await page.evaluate(() => [
      'prodCreateModeBtn', 'prodCreateClientBtn', 'prodCreateTeamBtn',
      'prodCreateStatusBtn', 'prodCreateDueBtn', 'prodCreateAssigneeBtn',
    ].every(id => document.getElementById(id)?.disabled)),
    'ambiguous recovery did not lock every branded create control');
    const successfulParentResponse = page.waitForResponse(response => {
      if (!response.url().includes('/functions/v1/production-write')) return false;
      try {
        const body = JSON.parse(response.request().postData() || '{}');
        return body.operation === 'create' && body.title === parentTitle;
      } catch (_error) { return false; }
    });
    await page.locator('.prod-create-submit').click();
    const parentHttpResponse = await successfulParentResponse;
    expect(parentHttpResponse.status() === 201, 'parent creation retry did not commit');
    const parentReceipt = await parentHttpResponse.json();
    const parentId = parentReceipt.row && parentReceipt.row.id;
    await page.waitForFunction(id => _prodState.openId === id && _prodIssue(id), parentId);
    const parentWrites = writes.filter(write => write.body.operation === 'create' && write.body.title === parentTitle);
    const parentPayload = parentWrites[1] && parentWrites[1].body;
    const expectedCreateKeys = [
      'assignee_id', 'client_slug', 'description', 'due_date', 'label_ids', 'operation',
      'parent_id', 'request_id', 'source_edited_at', 'status', 'surface', 'team', 'title',
    ].sort();
    expect(parentWrites.length === 3
      && parentPayload.request_id === firstParentWrite.body.request_id
      && parentPayload.source_edited_at === firstParentWrite.body.source_edited_at
      && parentPayload.client_slug === 'normal-fixture'
      && parentPayload.team === 'graphics'
      && parentPayload.parent_id === null
      && parentPayload.title === parentTitle
      && parentPayload.description === parentMarkdown
      && parentPayload.status === 'smm_approval'
      && parentPayload.due_date === '2031-02-17'
      && parentPayload.assignee_id === 'designer'
      && JSON.stringify(parentPayload.label_ids) === JSON.stringify(['ordinary', 'workload-3'])
      && JSON.stringify(Object.keys(parentPayload).sort()) === JSON.stringify(expectedCreateKeys)
      && parentWrites.every(write => write.body.request_id === parentIntent.requestId
        && write.body.source_edited_at === parentIntent.sourceEditedAt
        && !Object.prototype.hasOwnProperty.call(write.body, 'test_override')),
    'guarded parent recovery or mirror poll changed its identity or omitted/added creation payload fields');
    expect(await page.evaluate(id => _prodState.view === 'detail' && _prodIssue(id)?.title === 'TEST Production parent creation', parentId),
      'native parent receipt did not refresh Production and open the returned row');

    await page.locator(`[data-prod-add-subissue="${parentId}"]`).click();
    await page.waitForSelector('[data-prod-create-modal]');
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready');
    const lockedSubissueScope = await page.evaluate(() => ({
      mode: document.getElementById('prodCreateMode')?.value,
      modeLocked: document.getElementById('prodCreateModeBtn')?.disabled,
      client: document.getElementById('prodCreateClient')?.value,
      clientLocked: document.getElementById('prodCreateClientBtn')?.disabled,
      team: document.getElementById('prodCreateTeam')?.value,
      teamLocked: document.getElementById('prodCreateTeamBtn')?.disabled,
      parent: document.getElementById('prodCreateParent')?.value,
      parentLocked: document.getElementById('prodCreateParentBtn')?.disabled,
    }));
    expect(lockedSubissueScope.mode === 'subissue' && lockedSubissueScope.modeLocked
      && lockedSubissueScope.client === 'normal-fixture' && lockedSubissueScope.clientLocked
      && lockedSubissueScope.team === 'graphics' && lockedSubissueScope.teamLocked
      && lockedSubissueScope.parent === parentId && lockedSubissueScope.parentLocked,
    'Add Sub did not lock the selected root parent, roster client, team, and issue type');
    const childTitle = 'TEST Production sub-issue creation';
    const childMarkdown = '## Child creation\n\n`exact markdown`  \n';
    await page.locator('#prodCreateTitle').fill(childTitle);
    await page.locator('#prodCreateDescription').fill(childMarkdown);
    await page.locator('#prodCreateStatusBtn').click();
    await page.locator('#prodCreateStatusMenu [data-value="todo"]').click();
    await page.evaluate(value => {
      const input = document.getElementById('prodCreateDue');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      _svSyncDateControl('prodCreateDue');
    }, '2032-11-09');
    await page.locator('#prodCreateAssigneeBtn').click();
    await page.locator('#prodCreateAssigneeMenu [data-value="designer"]').click();
    await page.locator('[data-prod-create-label-option="workload-2"] input[type="checkbox"]').check();
    const childResponse = page.waitForResponse(response => {
      if (!response.url().includes('/functions/v1/production-write')) return false;
      try {
        const body = JSON.parse(response.request().postData() || '{}');
        return body.operation === 'create' && body.title === childTitle;
      } catch (_error) { return false; }
    });
    await page.locator('.prod-create-submit').click();
    const childHttpResponse = await childResponse;
    expect(childHttpResponse.status() === 201, 'sub-issue creation did not commit');
    const childReceipt = await childHttpResponse.json();
    const childId = childReceipt.row && childReceipt.row.id;
    await page.waitForFunction(id => _prodState.openId === id && _prodIssue(id), childId);
    const childWrite = writes.find(write => write.body.operation === 'create' && write.body.title === childTitle);
    expect(childWrite
      && childWrite.body.client_slug === 'normal-fixture'
      && childWrite.body.team === 'graphics'
      && childWrite.body.parent_id === parentId
      && childWrite.body.title === childTitle
      && childWrite.body.description === childMarkdown
      && childWrite.body.status === 'todo'
      && childWrite.body.due_date === '2032-11-09'
      && childWrite.body.assignee_id === 'designer'
      && JSON.stringify(childWrite.body.label_ids) === JSON.stringify(['workload-2'])
      && childWrite.body.request_id
      && Number.isFinite(Date.parse(childWrite.body.source_edited_at))
      && JSON.stringify(Object.keys(childWrite.body).sort()) === JSON.stringify(expectedCreateKeys)
      && !Object.prototype.hasOwnProperty.call(childWrite.body, 'test_override'),
    'guarded sub-issue creation omitted its locked hierarchy or complete payload');
    expect(await page.evaluate(({ id, rootId }) => {
      const issue = _prodIssue(id);
      return _prodState.view === 'detail'
        && issue?.parent === rootId
        && document.querySelectorAll('[data-prod-add-subissue]').length === 0;
    }, { id: childId, rootId: parentId }),
    'native child receipt did not open the nested row or nested creation remained available');
    const optionsBeforeNestedAttempt = createOptionReads.length;
    const nestedAttempt = await page.evaluate(id => {
      _prodOpenCreate(id);
      return {
        hasDraft: !!_prodState.createDraft,
        hasModal: !!document.querySelector('[data-prod-create-modal]'),
      };
    }, childId);
    expect(!nestedAttempt.hasDraft && !nestedAttempt.hasModal
      && createOptionReads.length === optionsBeforeNestedAttempt,
    'a sub-issue could start another nested creation or label-catalog request');
    expect(implicitCardWrites.length === implicitWritesBeforeProductionCreate
      && calendarWrites.length === calendarWritesBeforeProductionCreate
      && legacyCreateHits.length === legacyCreatesBeforeProductionCreate
      && [parentPayload, childWrite.body].every(payload =>
        !Object.keys(payload).some(key => /card_id|origin|link|calendar|sample/i.test(key))),
    'Production creation created, chose, linked, or wrote Calendar/Samples state');

    await page.evaluate(() => {
      _prodState.openId = '';
      _prodState.openProjectId = 'normal-fixture';
      _prodState.team = 'graphics';
      _prodOpenCreate();
    });
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready');
    await page.locator('#prodCreateTitle').fill('TEST conflicting create intent');
    const conflictingIntent = await page.evaluate(() => ({
      requestId: _prodState.createDraft.requestId,
      sourceEditedAt: _prodState.createDraft.sourceEditedAt,
    }));
    const createdBeforeConflict = createdProductionIssues.length;
    conflictingProductionCreates = 1;
    const conflictResponse = page.waitForResponse(response => {
      if (!response.url().includes('/functions/v1/production-write')) return false;
      try {
        const body = JSON.parse(response.request().postData() || '{}');
        return response.status() === 409
          && body.operation === 'create'
          && body.title === 'TEST conflicting create intent';
      } catch (_error) { return false; }
    });
    await page.locator('.prod-create-submit').click();
    expect((await conflictResponse).status() === 409, 'idempotency-conflict fixture did not return a terminal conflict');
    await page.waitForFunction(() => _prodState.createDraft === null
      && _prodState.view === 'detail'
      && _prodIssue(_prodState.openId)?.title === 'TEST conflicting create intent');
    const conflictWrites = writes.filter(write =>
      write.body.operation === 'create' && write.body.title === 'TEST conflicting create intent');
    expect(createdProductionIssues.length === createdBeforeConflict + 1
      && conflictWrites.length === 2
      && conflictWrites.every(write =>
        write.body.request_id === conflictingIntent.requestId
        && write.body.source_edited_at === conflictingIntent.sourceEditedAt)
      && conflictWrites[0].response.native_committed === true
      && conflictWrites[1].response.native_committed === true
      && conflictWrites[1].response.error === 'idempotency_conflict',
    'terminal create polling minted a fresh request or created a second native issue instead of opening the saved repair row');

    let startHeldCreateOptions;
    let releaseHeldCreateOptions;
    const heldCreateOptionsStarted = new Promise(resolve => { startHeldCreateOptions = resolve; });
    const heldCreateOptionsRelease = new Promise(resolve => { releaseHeldCreateOptions = resolve; });
    heldCreateOptions = { started: startHeldCreateOptions, release: heldCreateOptionsRelease };
    const delayedCreateOptionsResponse = page.waitForResponse(response => {
      if (!response.url().includes('/functions/v1/production-write')) return false;
      try { return JSON.parse(response.request().postData() || '{}').action === 'create_options'; }
      catch (_error) { return false; }
    });
    await page.evaluate(() => {
      _prodState.openId = '';
      _prodState.openProjectId = 'normal-fixture';
      _prodState.team = 'graphics';
      _prodOpenCreate();
    });
    await heldCreateOptionsStarted;
    await page.evaluate(() => _syncviewStaffIdentityClear());
    releaseHeldCreateOptions();
    await delayedCreateOptionsResponse;
    const purgedCreateState = await page.evaluate(() => ({
      draft: _prodState.createDraft,
      catalog: _prodState.createCatalog,
      status: _prodState.createCatalogStatus,
      modal: !!document.querySelector('[data-prod-create-modal]'),
      savedDraft: sessionStorage.getItem(PROD_CREATE_DRAFT_KEY),
      gate: _prodCreateGateText('normal-fixture', 'graphics'),
    }));
    expect(purgedCreateState.draft === null
      && Array.isArray(purgedCreateState.catalog) && purgedCreateState.catalog.length === 0
      && purgedCreateState.status === 'idle'
      && !purgedCreateState.modal
      && purgedCreateState.savedDraft === null
      && purgedCreateState.gate.includes('Sign in'),
    'a delayed create_options response restored protected creation state after sign-out');

    await page.evaluate(() => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewStaffIdentityVerified = true;
      _syncviewStaffRefreshChrome();
    });
    serverAuthority.graphics = 'syncview';
    await page.evaluate(() => _prodRefreshAuthority({ silent: true }));
    const writesBeforeTestCreate = writes.length;
    const optionsBeforeTestCreate = createOptionReads.length;
    const blockedTestCreate = await page.evaluate(() => {
      _prodState.openId = '';
      _prodState.openProjectId = 'test-fixture';
      _prodState.team = 'graphics';
      const gate = _prodCreateGateText('test-fixture', 'graphics');
      _prodOpenCreate();
      return {
        gate,
        hasDraft: !!_prodState.createDraft,
        hasModal: !!document.querySelector('[data-prod-create-modal]'),
      };
    });
    expect(blockedTestCreate.gate.includes('service-authenticated')
      && !blockedTestCreate.hasDraft
      && !blockedTestCreate.hasModal
      && writes.length === writesBeforeTestCreate
      && createOptionReads.length === optionsBeforeTestCreate,
    'browser creation self-entered service-only TEST scope after authority flipped');
    await page.evaluate(async () => {
      await _prodRefreshAuthority({ silent: true });
      _prodOpenDeliverable('gra-fixture');
    });
    await page.waitForSelector('[data-prod-comment-form="gra-fixture"]');

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

    await page.evaluate(() => _prodOpenDeliverable('gra-description-parent'));
    await page.waitForFunction(() => _prodDescriptionState('gra-description-parent')?.status === 'ready');
    expect(descriptionReads.some(read => read.id === 'gra-description-parent' && read.select === 'id,brief,updated_at'),
      'parent description did not use the focused authoritative brief read');
    expect((await page.locator('[data-prod-description="gra-description-parent"] .prod-desc').textContent()).includes('Parent brief')
      && await page.locator('[data-prod-description="gra-description-parent"] .prod-md-heading').count() === 1
      && await page.locator('[data-prod-description="gra-description-parent"] .prod-md-bullet').count() === 1,
    'parent Markdown was not rendered through the Production description surface');

    await page.locator('[data-prod-description-edit]').click();
    const parentDraft = '# Updated parent\n\n- Keep whitespace\n\n**Owner:** Browser SMM\n\n';
    const parentSource = page.locator('[data-prod-description-control="source"]');
    await parentSource.fill(parentDraft);
    await parentSource.evaluate(element => {
      element.focus();
      element.setSelectionRange(11, 11);
      element.dispatchEvent(new Event('select', { bubbles: true }));
    });
    let startOlderDescriptionRead;
    let releaseOlderDescriptionRead;
    const olderDescriptionReadStarted = new Promise(resolve => { startOlderDescriptionRead = resolve; });
    const olderDescriptionReadRelease = new Promise(resolve => { releaseOlderDescriptionRead = resolve; });
    heldDescriptionRead = { started: startOlderDescriptionRead, release: olderDescriptionReadRelease };
    await page.evaluate(() => {
      window.__prodOlderDescriptionRead = _prodEnsureDescription('gra-description-parent', true);
    });
    await olderDescriptionReadStarted;
    expect(await parentSource.inputValue() === parentDraft
      && await parentSource.evaluate(element => element.selectionStart) === 11,
    'background description refresh lost the Markdown draft or caret');

    const parentRow = deliverables.find(row => row.id === 'gra-description-parent');
    parentRow.brief = '## Newer server baseline\n\nRemote text';
    parentRow.updated_at = '2026-07-12T12:10:00.000Z';
    await page.evaluate(() => _prodEnsureDescription('gra-description-parent', true));
    await page.waitForFunction(() => _prodDescriptionState('gra-description-parent')?.remoteChanged === true);
    releaseOlderDescriptionRead();
    expect(await page.evaluate(() => window.__prodOlderDescriptionRead) === null,
      'an older description read was not invalidated by the newer same-issue read');
    expect(await parentSource.inputValue() === parentDraft
      && await parentSource.evaluate(element => element.selectionStart) === 11
      && (await page.locator('[data-prod-description-write-error]').textContent()).includes('draft is preserved'),
    'newer server description did not preserve the active parent draft/caret with visible conflict context');

    const parentDescriptionResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'description'
      && JSON.parse(response.request().postData() || '{}').id === 'gra-description-parent');
    await page.locator('[data-prod-description-control="save"]').click();
    await parentDescriptionResponse;
    await page.waitForFunction(() => _prodDescriptionState('gra-description-parent')?.editing === false);
    const parentDescriptionWrite = writes.find(write => write.body.operation === 'description' && write.body.id === 'gra-description-parent');
    expect(parentDescriptionWrite
      && parentDescriptionWrite.body.description === parentDraft
      && parentDescriptionWrite.body.expected_updated_at === '2026-07-12T12:10:00.000Z'
      && parentDescriptionWrite.body.request_id,
    'parent description did not preserve exact Markdown and refreshed CAS/idempotency through the gateway');
    expect((await page.locator('[data-prod-description="gra-description-parent"] .prod-desc').textContent()).includes('Updated parent')
      && await page.locator('[data-prod-description-edit]').evaluate(element => document.activeElement === element),
    'saved parent Markdown did not render or restore focus to Edit');

    await page.locator('[data-prod-description-edit]').click();
    const writesBeforeNul = writes.filter(write => write.body.operation === 'description').length;
    await page.locator('[data-prod-description-control="source"]').evaluate(element => {
      element.value = 'Invalid\u0000description';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('[data-prod-description-control="save"]').click();
    expect((await page.locator('[data-prod-description-write-error]').textContent()).includes('NUL')
      && writes.filter(write => write.body.operation === 'description').length === writesBeforeNul,
    'NUL description was not rejected visibly before the gateway');

    const saveWinsDraft = '# Save wins\n\nExact text after held reads.\n';
    await page.locator('[data-prod-description-control="source"]').fill(saveWinsDraft);
    let startPreSaveDescriptionRead;
    let releasePreSaveDescriptionRead;
    let startPreSaveBriefsRead;
    let releasePreSaveBriefsRead;
    const preSaveDescriptionReadStarted = new Promise(resolve => { startPreSaveDescriptionRead = resolve; });
    const preSaveDescriptionReadRelease = new Promise(resolve => { releasePreSaveDescriptionRead = resolve; });
    const preSaveBriefsReadStarted = new Promise(resolve => { startPreSaveBriefsRead = resolve; });
    const preSaveBriefsReadRelease = new Promise(resolve => { releasePreSaveBriefsRead = resolve; });
    heldDescriptionRead = { started: startPreSaveDescriptionRead, release: preSaveDescriptionReadRelease };
    heldBriefsRead = { started: startPreSaveBriefsRead, release: preSaveBriefsReadRelease };
    await page.evaluate(() => {
      _prodState.briefsLoaded = false;
      window.__prodPreSaveDescriptionRead = _prodEnsureDescription('gra-description-parent', true);
      window.__prodPreSaveBriefsRead = _prodLoadBriefs({ silent: true });
    });
    await Promise.all([preSaveDescriptionReadStarted, preSaveBriefsReadStarted]);
    const saveWinsResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'description'
      && JSON.parse(response.request().postData() || '{}').id === 'gra-description-parent');
    await page.locator('[data-prod-description-control="save"]').click();
    await saveWinsResponse;
    await page.waitForFunction(() => _prodDescriptionState('gra-description-parent')?.editing === false);
    releasePreSaveDescriptionRead();
    releasePreSaveBriefsRead();
    const staleAfterSave = await page.evaluate(async () => ({
      focused: await window.__prodPreSaveDescriptionRead,
      bulk: await window.__prodPreSaveBriefsRead,
      state: _prodDescriptionState('gra-description-parent').value,
      row: _prodState.deliverables.find(item => item.id === 'gra-description-parent').brief,
    }));
    expect(staleAfterSave.focused === null
      && staleAfterSave.state === saveWinsDraft
      && staleAfterSave.row === saveWinsDraft,
    'a held focused or bulk brief read overwrote the successful description save');

    await page.evaluate(() => _prodOpenDeliverable('gra-description-child'));
    await page.waitForFunction(() => _prodDescriptionState('gra-description-child')?.status === 'ready');
    expect(await page.locator('[data-prod-detail="gra-description-child"]').getAttribute('data-prod-hierarchy-parent') === '0'
      && await page.locator('[data-prod-subissue-of="gra-description-parent"]').count() === 1,
    'description sub-issue fixture did not retain its parent context');
    failedDescriptionReads = 3;
    await page.evaluate(() => _prodRefresh());
    await page.waitForSelector('[data-prod-description-refresh-error]', { timeout: 15000 });
    expect((await page.locator('[data-prod-description="gra-description-child"] .prod-desc').textContent()).includes('Child brief')
      && await page.locator('[data-prod-description="gra-description-child"]').getAttribute('data-prod-description-state') === 'stale',
    'failed post-refresh description read hid the retained text or falsely marked it current');

    const childRow = deliverables.find(row => row.id === 'gra-description-child');
    childRow.brief = '## Child from second device\n\nFresh server text';
    childRow.updated_at = '2026-07-12T12:20:00.000Z';
    await page.locator('[data-prod-description-refresh-error] button', { hasText: 'Retry' }).click();
    await page.waitForFunction(() => _prodDescriptionState('gra-description-child')?.status === 'ready'
      && _prodDescriptionState('gra-description-child')?.value.includes('second device'));
    expect((await page.locator('[data-prod-description="gra-description-child"] .prod-desc').textContent()).includes('Child from second device'),
      'description Retry did not adopt the fresh second-device value');

    await page.locator('[data-prod-description-edit]').click();
    const childDraft = '## Child local draft\n\nPreserve this on conflict.  \n';
    await page.locator('[data-prod-description-control="source"]').fill(childDraft);
    childRow.brief = '## Child server conflict\n\nCurrent server value';
    childRow.updated_at = '2026-07-12T12:30:00.000Z';
    const childConflictResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'description'
      && JSON.parse(response.request().postData() || '{}').id === 'gra-description-child');
    await page.locator('[data-prod-description-control="save"]').click();
    expect((await childConflictResponse).status() === 409, 'description conflict fixture did not reject stale CAS');
    await page.waitForSelector('[data-prod-description-write-error]');
    expect(await page.locator('[data-prod-description-control="source"]').inputValue() === childDraft
      && await page.evaluate(() => _prodDescriptionState('gra-description-child').baseline.includes('server conflict')
        && _prodIssue('gra-description-child').updatedRaw === '2026-07-12T12:30:00.000Z'),
    '409 did not retain the child draft while adopting the current server row and CAS cursor');
    await page.locator('[data-prod-description-control="source"]').fill(childDraft);
    expect((await page.locator('[data-prod-description-write-error]').textContent()).includes('changed elsewhere'),
      'editing the retained draft silently cleared the description conflict acknowledgement');

    const childRetryResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'description'
      && JSON.parse(response.request().postData() || '{}').id === 'gra-description-child');
    await page.locator('[data-prod-description-control="save"]').click();
    expect((await childRetryResponse).status() === 200, 'description conflict retry did not commit');
    await page.waitForFunction(() => _prodDescriptionState('gra-description-child')?.editing === false);
    const childDescriptionWrites = writes.filter(write => write.body.operation === 'description' && write.body.id === 'gra-description-child');
    expect(childDescriptionWrites.length === 2
      && childDescriptionWrites[0].body.expected_updated_at === '2026-07-12T12:20:00.000Z'
      && childDescriptionWrites[1].body.expected_updated_at === '2026-07-12T12:30:00.000Z'
      && childDescriptionWrites[0].body.request_id !== childDescriptionWrites[1].body.request_id
      && childDescriptionWrites[1].body.description === childDraft,
    'description conflict retry did not use the refreshed cursor, new idempotency key, and exact retained draft');

    await page.locator('[data-prod-description-edit]').click();
    await page.locator('[data-prod-description-control="source"]').press('Escape');
    await page.waitForFunction(() => document.activeElement?.matches('[data-prod-description-edit]'));

    await page.setViewportSize({ width: 360, height: 760 });
    await page.evaluate(() => {
      localStorage.setItem('syncview_theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      _prodBeginDescriptionEdit('gra-description-child');
    });
    const compactDescription = await page.locator('[data-prod-description="gra-description-child"]').evaluate(panel => {
      const editor = panel.querySelector('.prod-description-editor');
      const source = panel.querySelector('[data-prod-description-control="source"]');
      const action = panel.querySelector('.prod-description-action');
      const editorRect = editor.getBoundingClientRect();
      return {
        withinViewport: editorRect.left >= 0 && editorRect.right <= innerWidth + 1,
        sourceWidth: source.getBoundingClientRect().width,
        editorWidth: editorRect.width,
        actionHeight: action.getBoundingClientRect().height,
        editorBackground: getComputedStyle(editor).backgroundColor,
        sourceColor: getComputedStyle(source).color,
      };
    });
    expect(compactDescription.withinViewport
      && Math.abs(compactDescription.sourceWidth - compactDescription.editorWidth) <= 2
      && compactDescription.actionHeight >= 36
      && compactDescription.editorBackground !== 'rgba(0, 0, 0, 0)'
      && compactDescription.sourceColor !== 'rgba(0, 0, 0, 0)',
    'description editor was not mobile-width and dark-theme safe: ' + JSON.stringify(compactDescription));
    await page.locator('[data-prod-description-control="source"]').press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      localStorage.removeItem('syncview_theme');
      document.documentElement.removeAttribute('data-theme');
    });

    await page.evaluate(() => _prodOpenDeliverable('gra-fixture'));
    await page.waitForFunction(() => _prodLabelState('gra-fixture')?.status === 'ready');
    expect(labelReads.some(read => read.body.action === 'labels_read'
      && read.body.surface === 'production'
      && read.body.id === 'gra-fixture'
      && read.headers['x-syncview-key'] === 'browser-role-key'),
    'label catalog did not use the protected lazy Production read contract');
    const labelCas = await page.evaluate(() => _prodIssue('gra-fixture').updatedRaw);
    await page.locator('[data-prod-prop="labels"]').click();
    const ordinaryOption = page.locator('[data-prod-label-option]', { hasText: 'Ordinary label' });
    expect(await ordinaryOption.locator('[role="checkbox"]').getAttribute('aria-checked') === 'true',
      'current arbitrary label was not rendered as selected');
    expect(await ordinaryOption.locator('.prod-label-dot').evaluate(element =>
      getComputedStyle(element).getPropertyValue('--prod-label-color').trim().toUpperCase()) === '#5E6AD2',
    'Linear label color did not reach the rendered option dot');
    expect((await ordinaryOption.getAttribute('title')).includes('must survive every write'),
      'label description was not exposed as the option tooltip');
    await ordinaryOption.hover();
    await page.waitForFunction(() => document.getElementById('prodTip')?.classList.contains('show')
      && document.getElementById('prodTip')?.textContent.includes('must survive every write'));
    await page.locator('[data-prod-label-search-input]').fill('3× Workload');
    expect(await page.locator('[data-prod-label-option]:visible').count() === 1,
      'label search did not narrow the real catalog');
    const labelsResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'labels');
    await page.locator('[data-prod-label-option]', { hasText: '3× Workload' }).click();
    await labelsResponse;
    const labelsWrite = writes.find(write => write.body.operation === 'labels');
    expect(labelsWrite
      && labelsWrite.body.expected_updated_at === labelCas
      && labelsWrite.body.request_id
      && labelsWrite.body.label_ids.join(',') === 'ordinary,workload-3',
    'labels write omitted CAS/idempotency or failed to preserve the complete arbitrary selected set');
    await page.waitForFunction(() => _prodLabelState('gra-fixture')?.saving === false
      && _prodLabelState('gra-fixture')?.selectedIds.includes('workload-3'));
    expect(await page.locator('[data-prod-label-option]', { hasText: '3× Workload' }).locator('[role="checkbox"]').getAttribute('aria-checked') === 'true',
      'gateway acknowledgement did not replace the picker with the full selected state');
    await page.evaluate(() => _prodClearLayer());
    const refreshedLabels = page.waitForResponse(response => {
      if (!response.url().includes('/functions/v1/production-write')) return false;
      const body = JSON.parse(response.request().postData() || '{}');
      return body.action === 'labels_read' && body.id === 'gra-fixture';
    });
    await page.evaluate(() => _prodRefresh());
    await refreshedLabels;
    await page.waitForFunction(() => _prodLabelState('gra-fixture')?.status === 'ready'
      && _prodLabelState('gra-fixture')?.selectedIds.includes('workload-3'));
    expect((await page.locator('[data-prod-prop="labels"]').textContent()).includes('3× Workload'),
      'saved label selection did not survive a fresh protected read');

    let startOlderLabelRead;
    let releaseOlderLabelRead;
    const olderLabelReadStarted = new Promise(resolve => { startOlderLabelRead = resolve; });
    const olderLabelReadRelease = new Promise(resolve => { releaseOlderLabelRead = resolve; });
    selectedLabelIds.set('gra-fixture', ['ordinary']);
    heldLabelRead = { started: startOlderLabelRead, release: olderLabelReadRelease };
    await page.evaluate(() => {
      window.__prodOlderLabelRead = _prodEnsureLabels('gra-fixture', true);
    });
    await olderLabelReadStarted;
    selectedLabelIds.set('gra-fixture', ['ordinary', 'workload-3']);
    await page.evaluate(() => _prodEnsureLabels('gra-fixture', true));
    releaseOlderLabelRead();
    const olderReadResult = await page.evaluate(() => window.__prodOlderLabelRead);
    expect(olderReadResult === null, 'an older same-identity label read was not discarded');
    expect(await page.evaluate(() => _prodLabelState('gra-fixture')?.selectedIds.includes('workload-3')),
      'an older delayed label read overwrote the newer complete selection');

    let startSignedOutLabelRead;
    let releaseSignedOutLabelRead;
    const signedOutLabelReadStarted = new Promise(resolve => { startSignedOutLabelRead = resolve; });
    const signedOutLabelReadRelease = new Promise(resolve => { releaseSignedOutLabelRead = resolve; });
    heldLabelRead = { started: startSignedOutLabelRead, release: signedOutLabelReadRelease };
    await page.evaluate(() => {
      window.__prodSignedOutLabelRead = _prodEnsureLabels('gra-fixture', true);
    });
    await signedOutLabelReadStarted;
    await page.evaluate(() => _syncviewStaffIdentityClear());
    releaseSignedOutLabelRead();
    const signedOutReadResult = await page.evaluate(() => window.__prodSignedOutLabelRead);
    expect(signedOutReadResult === null, 'a label read completed into a signed-out verification epoch');
    expect(await page.evaluate(() => {
      const state = _prodLabelState('gra-fixture');
      return !state || (!state.selectedIds.length && !state.catalog.length);
    }), 'the delayed label read resurrected protected catalog or selection state after sign-out');

    await page.evaluate(async () => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewAcceptStaffVerification();
      _syncviewStaffRefreshChrome();
      _prodRender();
      await _prodEnsureLabels('gra-fixture', true);
    });
    await page.waitForFunction(() => _prodLabelState('gra-fixture')?.status === 'ready');

    let startOverlappingLabelWrite;
    let releaseOverlappingLabelWrite;
    const overlappingLabelWriteStarted = new Promise(resolve => { startOverlappingLabelWrite = resolve; });
    const overlappingLabelWriteRelease = new Promise(resolve => { releaseOverlappingLabelWrite = resolve; });
    heldLabelWrite = { started: startOverlappingLabelWrite, release: overlappingLabelWriteRelease };
    await page.evaluate(() => {
      window.__prodOverlappingLabelWrite = _prodRunLabelsWrite('gra-fixture', ['ordinary', 'workload-2']);
    });
    await overlappingLabelWriteStarted;
    const readsBeforeWriteRefresh = labelReads.length;
    await page.evaluate(() => _prodRefresh());
    await page.waitForFunction(() => _prodState.loaded
      && _prodLabelState('gra-fixture')?.saving === true);
    expect(labelReads.length === readsBeforeWriteRefresh,
      'Production refresh raced a pending label write with a stale protected read');
    releaseOverlappingLabelWrite();
    await page.evaluate(() => window.__prodOverlappingLabelWrite);
    await page.waitForFunction(() => _prodLabelState('gra-fixture')?.status === 'ready'
      && _prodLabelState('gra-fixture')?.selectedIds.includes('workload-2'));
    expect(await page.evaluate(() => !_prodLabelState('gra-fixture')?.selectedIds.includes('workload-3')),
      'the pending-write refresh left the UI on its pre-write label selection');

    let startSignedOutLabelWrite;
    let releaseSignedOutLabelWrite;
    const signedOutLabelWriteStarted = new Promise(resolve => { startSignedOutLabelWrite = resolve; });
    const signedOutLabelWriteRelease = new Promise(resolve => { releaseSignedOutLabelWrite = resolve; });
    heldLabelWrite = { started: startSignedOutLabelWrite, release: signedOutLabelWriteRelease };
    await page.evaluate(() => {
      window.__prodSignedOutLabelWrite = _prodRunLabelsWrite('gra-fixture', ['ordinary']);
    });
    await signedOutLabelWriteStarted;
    await page.evaluate(() => _syncviewStaffIdentityClear());
    releaseSignedOutLabelWrite();
    await page.evaluate(() => window.__prodSignedOutLabelWrite);
    expect(await page.evaluate(() => {
      const state = _prodLabelState('gra-fixture');
      return !state || !state.selectedIds.length;
    }), 'a delayed label-write acknowledgement resurrected selected labels after sign-out');

    await page.evaluate(async () => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewAcceptStaffVerification();
      _syncviewStaffRefreshChrome();
      _prodRender();
      await _prodEnsureLabels('gra-fixture', true);
    });
    await page.waitForFunction(() => _prodLabelState('gra-fixture')?.status === 'ready');

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
    await page.waitForFunction(() => _prodLabelState('vid-fixture')?.status === 'ready');
    await page.locator('[data-prod-prop="labels"]').click();
    const labelWritesBeforeLockedClick = writes.filter(write => write.body.operation === 'labels').length;
    await page.locator('[data-prod-label-search-input]').fill('2× Workload');
    await page.locator('[data-prod-label-option]', { hasText: '2× Workload' }).dispatchEvent('click');
    expect(writes.filter(write => write.body.operation === 'labels').length === labelWritesBeforeLockedClick,
      'Linear-authoritative label control reached the guarded write endpoint');
    await page.evaluate(() => _prodClearLayer());

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
    expect(legacyProjectReads.length >= 1 && legacyProjectReads.every(read => read.method === 'POST'),
      'Submit did not retain the mocked legacy project-name read for non-enrolled clients');
    expect(legacyCreateHits.length === 0, 'Submit touched a legacy Linear create webhook');
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
