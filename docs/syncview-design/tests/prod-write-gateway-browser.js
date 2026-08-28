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
/* WHERE did it fail? -- a fixed, public-safe location marker.
 *
 * The Production polish gate keeps full suite output on the runner (F122: it
 * renders live customer text), so a red run reaches a reader as a suite name
 * plus one classification code. For this suite that code has been
 * `error_generic` on every failure whose message is one of the ~120 expect()
 * strings below -- which is every assertion failure it can have. The gate's own
 * header records what that costs: it sat red from 2026-07-23 to at least
 * 2026-08-10 because "which suite" without "why" is nobody's to act on.
 *
 * Same fix the gate applied twice already (the Slice 5 drill codes, the
 * suite-name allowlist): a CLOSED list of constants. `PHASES` is that list, the
 * marker is assembled from a member of it, and prod-polish-gate.js matches each
 * marker with a literal pattern that emits a literal code. No assertion text,
 * no fixture value, and no page content can reach the public summary through
 * this path -- only which of seven named sections was running.
 */
const PHASES = [
  'boot', 'create_closure', 'quarantined_identity', 'assignee_projection',
  'authoritative_locks', 'submit', 'calendar_native_intake',
  // Sub-phases of quarantined_identity, added 2026-08-25 after THREE consecutive
  // CI reds all reported `pwg_quarantined_identity` while the suite passed
  // thirteen times locally. Naming the section was enough to disprove one
  // hypothesis (the global write counters -- scoping them changed nothing) and
  // not enough to find the cause, because that section asserted ten separate
  // things in a single expect(). Same remedy, one level deeper.
  'quarantine_projection', 'quarantine_refusals', 'quarantine_gates',
  'quarantine_notice', 'quarantine_no_traffic',
  // The split above was aimed at the wrong fifty lines. `quarantined_identity`
  // was set TWICE -- once for the quarantine block, and again straight after it
  // for the authority restore and the status/due writes, which have nothing to
  // do with quarantine and carry seven more assertions. A red reporting
  // `pwg_quarantined_identity` could always have been any of those, which is
  // why splitting the quarantine block changed nothing. These name them.
  'authority_restore', 'status_write', 'due_write', 'due_receipt',
];
let currentPhase = PHASES[0];
function phase(name) {
  // A typo here must fail loudly at author time rather than silently emitting
  // an unmatched marker that classifies as error_generic all over again.
  if (!PHASES.includes(name)) throw new Error('prod-write-gateway-browser: undeclared phase');
  currentPhase = name;
  console.log(`--- phase: ${name} ---`);
}
function marker() { return `PWG_PHASE_${currentPhase.toUpperCase()} `; }
function expect(value, message) { if (!value) throw new Error(marker() + message); }

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
    { id: 'unmapped-designer', name: 'Browser Unmapped', role: 'designer', team: 'graphics', active: true },
    { id: 'editor', name: 'Browser Editor', role: 'editor', team: 'video', active: true },
  ];
  const mappedCreateAssigneeIds = new Set(['designer', 'editor']);
  const deliverables = [
    { id: 'gra-fixture', identifier: 'GRA-TEST', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'graphics', title: 'Graphics fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, origin: 'samples', card_id: 'samples-card-gra', created_at: now, updated_at: now },
    // vid-fixture carries a Linear UUID so the Video-only create dialog can
    // offer it as a pickable parent (parents require a resolved Linear identity).
    { id: 'vid-fixture', identifier: 'VID-TEST', linear_issue_uuid: 'linear-video-parent', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'video', title: 'Video fixture', status: 'in_progress', status_at: now, assignee_id: 'editor', due_date: null, created_at: now, updated_at: now },
    { id: 'test-fixture-row', identifier: 'GRA-TEST-OVERRIDE', raw_project_id: 'linear-project-test', client_slug: 'test-fixture', team: 'graphics', title: 'TEST override fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    { id: 'gra-description-parent', identifier: 'GRA-DESC-P', linear_issue_uuid: 'linear-description-parent', raw_project_id: 'linear-project-normal', client_slug: 'normal-fixture', team: 'graphics', title: 'Description parent fixture', brief: '# Parent brief\n\n- First item\n\n**Owner:** Browser Admin', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    { id: 'gra-description-child', identifier: 'GRA-DESC-C', linear_issue_uuid: 'linear-description-child', raw_issue_parent_id: 'linear-description-parent', client_slug: 'normal-fixture', team: 'graphics', title: 'Description sub-issue fixture', brief: '## Child brief\n\n`source` text', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    // The identity-repair QUARANTINE fixture. It used to be manufactured by
    // the create arc (create -> terminal idempotency_conflict -> quarantine).
    // Production creation is closed (owner ruling 2026-08-23), so the state is
    // declared here instead; the contract it proves -- a quarantined issue
    // refuses every field write -- is unchanged.
    { id: 'gra-quarantined-identity', identifier: 'GRA-QUARANTINE', linear_issue_uuid: 'linear-quarantined-identity', raw_project_id: 'linear-project-normal', sync_state: 'error', identity_repair_state: 'required', identity_repair_reason: 'linear_create_idempotency_conflict', client_slug: 'normal-fixture', team: 'graphics', title: 'Quarantined identity fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
    { id: 'gra-repaired-identity', identifier: 'GRA-REPAIRED', linear_issue_uuid: 'linear-repaired-identity', raw_project_id: 'linear-project-normal', identity_repair_state: 'resolved', identity_repair_reason: 'owner_repaired', identity_repair_resolved_linear_issue_id: 'linear-repaired-identity', client_slug: 'normal-fixture', team: 'graphics', title: 'Resolved identity repair fixture', status: 'in_progress', status_at: now, assignee_id: 'designer', due_date: null, created_at: now, updated_at: now },
  ];
  const batches = [
    // linear_parent_ids must be present: the Create Post picker excludes
    // parentless orphan batches (2026-08-14 redesign; OPEN_REPAIRS items 1-2).
    { id: 'batch-latest', client_slug: 'calendarfixture', team: null, name: 'Current fixture batch', status: 'active', created_at: '2026-07-13T10:00:00.000Z', updated_at: '2026-07-13T11:00:00.000Z', linear_parent_ids: { video: { uuid: 'linear-parent-video' }, graphics: { uuid: 'linear-parent-graphics' } } },
  ];
  // F1(video) 2026-08-28: both teams SyncView-authoritative. This mock mirrors
  // the live prod_authority truth, the way it mirrored the mixed world between
  // the graphics flip (2026-08-16) and the video flip.
  const serverAuthority = { video: 'syncview', graphics: 'syncview' };
  const writeUiRerouteClients = { clients: ['normal-fixture', 'calendarfixture'] };
  const writes = [];
  /*
   * WAITING FOR THE PAINT IS NO LONGER WAITING FOR THE WRITE.
   *
   * This branch made the Production pickers paint optimistically ("Paint first,
   * then persist" in _prodRunPickerWrite, owner report 2026-08-25: "it takes
   * quite a lot of time to change. It should be, like, immediate."). Before
   * that, a row only took its new value when the gateway answered, so
   * `waitForFunction(() => row.dueRaw)` implicitly waited for the whole
   * round-trip and everything downstream of it was there by the time the test
   * looked.
   *
   * Now the row changes BEFORE the fetch is even issued. Every wait of that
   * shape resolves early, and the assertions after it read request-time state
   * (`writes` is pushed from the route handler) or response-time state (the due
   * receipt is published from the response) that has not happened yet. On a
   * fast machine it has always landed anyway; on a loaded runner it has not.
   *
   * So: wait for the WRITE, not for the paint.
   */
  const waitForWrite = async (predicate, what) => {
    const deadline = Date.now() + 15000;
    for (;;) {
      const found = writes.findLast(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(marker() + 'no gateway write matching ' + what + ' arrived within 15s');
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  const labelReads = [];
  const createOptionReads = [];
  const assigneeOptionReads = [];
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
  // Set true only by a test that deliberately exercises the pre-closure
  // create path. Nothing in this file does; it exists so the removal of the
  // closure is a visible edit rather than a silent one.
  const allowClosedProductionCreate = false;
  let failedProductionCreates = 0;
  let conflictingProductionCreates = 0;
  const descriptionReads = [];
  let heldDescriptionRead = null;
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
      // `eq.<key>` for single-flag reads; `in.(<key>,<key>)` for the combined
      // reroute + client_comment_gateway_enabled priming read (2026-08-14).
      // Rows carry `key` because the combined read selects rows by it; the
      // client_comment_gateway_enabled row is deliberately absent — absent is
      // OFF (fail-legacy), the faithful pre-rollout state.
      const rawKey = String(url.searchParams.get('key') || '');
      const keys = /^in\.\(/.test(rawKey)
        ? rawKey.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map(part => part.trim())
        : [rawKey.replace(/^eq\./, '')];
      rows = keys
        .filter(key => key !== 'client_comment_gateway_enabled')
        .map(key => ({ key, value: key === 'write_ui_reroute_clients'
          ? { ...writeUiRerouteClients }
          : { ...serverAuthority } }));
    }
    // The Production list has read the bounded `production_deliverables_browser_v1`
    // view since the 2026-07-23 F34/F53 revoke; this mock still answered only the
    // old `deliverables` table, so the view read returned `[]` and every run of
    // this suite died waiting for a fixture row that could never appear. The
    // Production polish gate has therefore proved nothing since that migration —
    // including on this file's own TEST-override case, which asserted a `401` was
    // correct behavior while never actually executing.
    else if (table === 'deliverables' || table === 'production_deliverables_browser_v1') {
      const idFilter = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
      rows = idFilter ? deliverables.filter(row => row.id === idFilter) : deliverables;
      const select = String(url.searchParams.get('select') || '');
      // The bulk `id,brief` and focused `id,brief,updated_at` REST branches
      // are retired: descriptions hydrate only through the gateway
      // `description_read` action below, and `_prodLoadBriefs` is a marker
      // that fetches nothing (index.html:50527).
      if (idFilter && select === 'id,linear_raw') {
        rows = rows.map(row => ({
          id: row.id,
          linear_raw: row.linear_raw || {
            issue: {
              project: row.raw_project_id ? { id: row.raw_project_id } : null,
              parent: row.raw_issue_parent_id ? { id: row.raw_issue_parent_id } : null,
            },
          },
        }));
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.route('**/functions/v1/production-comments', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      comments: [],
      next_cursor: null,
      has_more: false,
      canonical_thread: true,
    }),
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
    /* Focused description hydration moved into the guarded gateway
     * (`description_read`, production-write/index.ts:3410): descriptions are
     * no longer REST-selected, in bulk or per row. Like F94's
     * assignee_options, the app grew this server-side read while this
     * harness was dead, so unhandled bodies fell through to the generic
     * write branch and every detail open bumped `updated_at` as a phantom
     * write. This branch answers the live contract and carries the
     * held/failed knobs the description scenarios drive; the row snapshot is
     * taken BEFORE an armed hold so a held read resolves with the
     * pre-release state, exactly as the retired REST mock did. */
    if (body.action === 'description_read') {
      const headers = request.headers();
      descriptionReads.push({ id: body.id, body, headers });
      const row = deliverables.find(item => item.id === body.id
        && item.client_slug === body.client_slug);
      const snapshot = row ? {
        id: row.id,
        client_slug: row.client_slug,
        team: row.team,
        brief: row.brief == null ? null : row.brief,
        updated_at: row.updated_at,
      } : null;
      const held = heldDescriptionRead;
      if (held) {
        heldDescriptionRead = null;
        held.started();
        await held.release;
      }
      if (failedDescriptionReads > 0) {
        failedDescriptionReads--;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'entity_lookup_unavailable' }) });
        return;
      }
      if (headers['x-syncview-key'] !== 'browser-role-key'
          || headers['x-syncview-actor'] !== 'Browser Admin') {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'credentials_required' }) });
        return;
      }
      if (!snapshot) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'description_scope_forbidden' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, complete: true, row: snapshot }) });
      return;
    }
    if (body.action === 'asset_access_read') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          complete: true,
          assets: [
            { slot: 'filming_plan', state: 'missing', url: null },
            { slot: 'raw_footage', state: 'missing', url: null },
            { slot: 'delivery_folder', state: 'missing', url: null },
            { slot: 'deliverable_file', state: 'missing', url: null },
          ],
        }),
      });
      return;
    }
    /* F94 eligible-assignee projection.
     *
     * The app has called this since 2026-07-25 (`index.html:43255`) and the
     * gateway has answered it since the same commit
     * (`production-write/index.ts:4929`), but NO browser suite was ever taught
     * the action — `git log -S"assignee_options" -- docs/syncview-design/tests/`
     * returns nothing. Unhandled actions fall through to the generic write
     * branch below, which answers with a write-shaped body carrying no
     * `assignees` array. The picker then renders no member
     * (`index.html:43263-43267` requires ok && complete && Array.isArray),
     * the `Browser Designer` option never appears, and the pre-armed
     * `waitForResponse(operation === 'assignee')` never resolves — the
     * `response_timeout` this suite reports.
     *
     * It went unnoticed because the whole gate was dead at boot from
     * 2026-07-23 (the F34/F53 migration revoked browser SELECT on the base
     * table), so the app grew a server-side read while its only browser
     * harness was already failing for an unrelated reason.
     *
     * Eligibility mirrors the real projection: a member is offered only when
     * the client→Linear mapping knows them (`mappedCreateAssigneeIds`, the
     * same set `create_options` uses) AND they are on the row's team. That
     * keeps `unmapped-designer` correctly unofferable, which is the property
     * the F94 assertions elsewhere in this file depend on.
     */
    if (body.action === 'assignee_options') {
      const read = { body, headers: request.headers(), response: null };
      assigneeOptionReads.push(read);
      const authorized = read.headers['x-syncview-key'] === 'browser-role-key'
        && read.headers['x-syncview-actor'] === 'Browser Admin';
      if (!authorized) {
        read.response = { ok: false, error: 'credentials_required' };
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(read.response) });
        return;
      }
      const row = deliverables.find(item => item.id === body.id);
      if (!row) {
        read.response = { ok: false, error: 'deliverable_not_found' };
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(read.response) });
        return;
      }
      read.response = {
        ok: true,
        complete: true,
        assignees: members
          .filter(member => member.active === true
            && member.team === row.team
            && mappedCreateAssigneeIds.has(member.id))
          .map(member => ({ id: member.id, name: member.name })),
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(read.response) });
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
        assignees: members
          .filter(member => member.active === true
            && member.team === body.team
            && mappedCreateAssigneeIds.has(member.id))
          .map(member => ({ id: member.id, name: member.name })),
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
          const marker = {
            schema: 'syncview_create_identity_repair_v1',
            state: 'required',
            reason: 'linear_create_idempotency_conflict',
          };
          const stored = deliverables.find(row => row.id === existingCreate.row.id);
          [existingCreate.row, stored].filter(Boolean).forEach(row => Object.assign(row, {
            sync_state: 'error',
            identity_repair_state: marker.state,
            identity_repair_reason: marker.reason,
            linear_raw: {
              ...(row.linear_raw || {}),
              identity_repair: { ...marker },
            },
          }));
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
      // Owner ruling 2026-08-23: production-write refuses every NEW create,
      // AFTER productionCreateReplay has had its chance to hand back a row
      // that already committed. Mirrors index.ts:3126.
      if (!allowClosedProductionCreate) {
        write.response = { ok: false, error: 'production_create_closed' };
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(write.response) });
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
    if (row.identity_repair_state === 'required') {
      write.response = {
        ok: false,
        error: 'identity_repair_required',
        read_only: true,
        row: { ...row },
      };
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
    /* Stamped with how much intake had reached the GATEWAY by the time this row
       arrived. That is what makes "the sheet is written first" checkable rather
       than assumed: the request row must arrive while that count is still 0. */
    const row = JSON.parse(route.request().postData() || '{}');
    row.intakeWritesAtArrival = writes.filter(write => write.body.operation === 'intake_create').length;
    submissionLogs.push(row);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?prod=1`, { waitUntil: 'domcontentloaded' });
    try { await page.waitForSelector('[data-prod-row="gra-fixture"]', { timeout: 15000 }); }
    catch (error) { throw new Error(marker() + 'Production fixture did not render; page errors: ' + pageErrors.join(' | ')); }
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
    const repairedProjection = await page.evaluate(() => {
      const issue = _prodIssue('gra-repaired-identity');
      return {
        required: issue?.identityRepair?.required,
        canWrite: _prodCanWrite(issue, 'status'),
        detailRawLoaded: _prodState.linearRaw.has('gra-repaired-identity'),
      };
    });
    expect(repairedProjection.required === false
      && repairedProjection.canWrite === true
      && repairedProjection.detailRawLoaded === false,
    'a resolved identity repair stayed read-only until the detail-only raw load');
    await page.waitForSelector('[data-prod-comment-form="gra-fixture"]');
    expect((await page.locator('.prod-preview-chip').textContent()).includes('Native writes'), 'both-team authority was not visible in the mirror chrome');
    expect(await page.locator('[data-prod-prop="status"]').getAttribute('aria-disabled') === 'false', 'SyncView-authoritative graphics controls were not enabled');

    phase('create_closure');
    /* -----------------------------------------------------------------
     * Owner ruling 2026-08-23 — the Production tab creates NOTHING.
     *
     * "A sub-issue is a card, not a parent issue ... we shouldn't be able to
     * do parent issues or sub-issues because we don't want to do posts in
     * sync linear that are not in the calendar."
     *
     * production-write hardcodes card_id: null for BOTH modes, so every row
     * this dialog could make is invisible to the calendar, to Kasper's queue
     * and to every client review link. What replaced the old create arc:
     *   1. both modes refuse, on every scope, with ONE sentence;
     *   2. the Video flip does not reopen either door;
     *   3. the gateway refuses a hand-crafted create, so a page reload
     *      cannot undo the closure;
     *   4. an `ambiguous` draft — a create that MAY already have committed —
     *      still recovers, because the replay is the only path that ever
     *      shows its author the row that landed.
     * ----------------------------------------------------------------- */
    const CREATE_CLOSED_TEXT = 'Posts are created on the content calendar, not in Production. Use Create Post on the client’s Calendar or Samples tab.';
    const implicitWritesBeforeProductionCreate = implicitCardWrites.length;
    const calendarWritesBeforeProductionCreate = calendarWrites.length;
    const legacyCreatesBeforeProductionCreate = legacyCreateHits.length;
    const writesBeforeClosureProbe = writes.length;
    const optionsBeforeClosureProbe = createOptionReads.length;

    // 1a. One gate, every scope. The unscoped board used to re-implement the
    // gate inline, which is how the New issue button rendered live while the
    // real gate refused.
    const closureGates = await page.evaluate(() => ({
      scoped: _prodCreateGateText('normal-fixture', 'graphics'),
      parented: _prodCreateGateText('normal-fixture', 'graphics', _prodIssue('gra-description-parent')),
      unscopedTopbar: _prodCreateTopbarButton('', ''),
      graphicsTopbar: _prodCreateTopbarButton('normal-fixture', 'graphics'),
      videoTopbar: _prodCreateTopbarButton('normal-fixture', 'video'),
    }));
    expect(closureGates.scoped === CREATE_CLOSED_TEXT
      && closureGates.parented === CREATE_CLOSED_TEXT
      && [closureGates.unscopedTopbar, closureGates.graphicsTopbar, closureGates.videoTopbar]
        .every(html => / disabled /.test(html)
          && html.includes('Posts are created on the content calendar')
          && !html.includes('onclick')),
    'a Production scope still offered a live New issue button: ' + JSON.stringify(closureGates));

    // 1b. Top-level creation refuses: no modal, no draft, no saved draft.
    const refusedTopLevel = await page.evaluate(() => {
      _prodState.openId = '';
      _prodState.openProjectId = 'normal-fixture';
      _prodState.team = 'graphics';
      const returned = _prodOpenCreate();
      return {
        returned,
        toast: (document.getElementById('prodToast') || {}).textContent || '',
        hasDraft: !!_prodState.createDraft,
        hasModal: !!document.querySelector('[data-prod-create-modal]'),
        savedDraft: sessionStorage.getItem(PROD_CREATE_DRAFT_KEY),
      };
    });
    expect(refusedTopLevel.returned === false
      && refusedTopLevel.toast === CREATE_CLOSED_TEXT
      && !refusedTopLevel.hasDraft
      && !refusedTopLevel.hasModal
      && refusedTopLevel.savedDraft === null,
    'top-level Production creation still opened: ' + JSON.stringify(refusedTopLevel));

    // 1c. The mode the owner named: Add sub-issue on a row. It was the one
    // door still open (graphics is SyncView-authoritative), and it made a
    // card-less deliverable under a parent that HAS a card.
    await page.evaluate(() => _prodOpenDeliverable('gra-description-parent'));
    await page.waitForSelector('[data-prod-add-subissue]');
    const addSubButton = page.locator('[data-prod-add-subissue]').first();
    expect(await addSubButton.isDisabled()
      && (await addSubButton.getAttribute('title')) === CREATE_CLOSED_TEXT
      && (await addSubButton.getAttribute('data-prod-tip')) === CREATE_CLOSED_TEXT
      && (await addSubButton.getAttribute('onclick')) === null
      && (await addSubButton.textContent()).trim() === 'Add sub-issue',
    'Add sub-issue stayed clickable or lost the sentence that says where posts are created');
    const refusedSubIssue = await page.evaluate(() => {
      const returned = _prodOpenCreate('gra-description-parent');
      return {
        returned,
        toast: (document.getElementById('prodToast') || {}).textContent || '',
        hasDraft: !!_prodState.createDraft,
        hasModal: !!document.querySelector('[data-prod-create-modal]'),
        savedDraft: sessionStorage.getItem(PROD_CREATE_DRAFT_KEY),
      };
    });
    expect(refusedSubIssue.returned === false
      && refusedSubIssue.toast === CREATE_CLOSED_TEXT
      && !refusedSubIssue.hasDraft
      && !refusedSubIssue.hasModal
      && refusedSubIssue.savedDraft === null,
    'sub-issue creation under a graphics parent still opened: ' + JSON.stringify(refusedSubIssue));

    // 1d. The Video flip does not reopen either door. This is the assertion
    // that keeps the closure true after the flag the previous ruling relied
    // on stops refusing.
    serverAuthority.video = 'syncview';
    await page.evaluate(() => _prodRefreshAuthority({ silent: true }));
    const afterVideoFlip = await page.evaluate(() => {
      _prodState.openId = '';
      _prodState.openProjectId = 'normal-fixture';
      _prodState.team = 'video';
      const topLevel = _prodOpenCreate();
      const topLevelModal = !!document.querySelector('[data-prod-create-modal]');
      const subIssue = _prodOpenCreate('gra-description-parent');
      return {
        authority: { ..._prodState.authority },
        topLevel,
        topLevelModal,
        subIssue,
        subIssueModal: !!document.querySelector('[data-prod-create-modal]'),
        gate: _prodCreateGateText('normal-fixture', 'video'),
        topbar: _prodCreateTopbarButton('normal-fixture', 'video'),
      };
    });
    expect(afterVideoFlip.authority.video === 'syncview'
      && afterVideoFlip.topLevel === false && !afterVideoFlip.topLevelModal
      && afterVideoFlip.subIssue === false && !afterVideoFlip.subIssueModal
      && afterVideoFlip.gate === CREATE_CLOSED_TEXT
      && / disabled /.test(afterVideoFlip.topbar),
    'the simulated Video flip reopened Production creation: ' + JSON.stringify(afterVideoFlip));

    // 1e. Nothing left the browser for any of it.
    expect(writes.length === writesBeforeClosureProbe
      && createOptionReads.length === optionsBeforeClosureProbe
      && implicitCardWrites.length === implicitWritesBeforeProductionCreate
      && calendarWrites.length === calendarWritesBeforeProductionCreate
      && legacyCreateHits.length === legacyCreatesBeforeProductionCreate,
    'a refused Production create still reached the gateway or touched Calendar/Samples state');

    // 2. The server refuses too, so a reload, a stale tab, or a hand-crafted
    // request cannot undo the closure.
    const createdBeforeHandcrafted = createdProductionIssues.length;
    const handcraftedRefusal = await page.evaluate(async () => {
      const response = await fetch(PROD_WRITE_EF_URL, {
        method: 'POST',
        headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, PROD_WRITE_EF_URL),
        body: JSON.stringify({
          operation: 'create',
          surface: 'production',
          client_slug: 'normal-fixture',
          team: 'video',
          parent_id: null,
          title: 'TEST hand-crafted production create',
          description: '',
          status: 'todo',
          due_date: null,
          assignee_id: null,
          label_ids: [],
          request_id: 'prod:create:handcrafted-closure-probe',
          source_edited_at: new Date().toISOString(),
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(handcraftedRefusal.status === 403
      && handcraftedRefusal.body.error === 'production_create_closed'
      && createdProductionIssues.length === createdBeforeHandcrafted,
    'the gateway still accepted a hand-crafted Production create: ' + JSON.stringify(handcraftedRefusal));

    // 3. An ambiguous draft still recovers. Seed the exact state the closure
    // must not strand: the gateway committed the row, the browser never saw
    // the response, and the saved draft is marked `ambiguous`.
    const recoveryRequestId = 'prod:create:recovery-probe';
    const recoverySourceEditedAt = '2026-08-23T09:00:00.000Z';
    const recoveredRow = {
      id: 'production-recovered-1',
      identifier: 'VID-RECOVER-1',
      linear_issue_uuid: 'linear-production-recovered-1',
      raw_project_id: 'linear-project-normal',
      client_slug: 'normal-fixture',
      team: 'video',
      title: 'TEST recovered production create',
      brief: '# recovered',
      status: 'todo',
      status_at: now,
      assignee_id: null,
      due_date: null,
      created_at: now,
      updated_at: '2026-07-12T12:05:00.000Z',
    };
    deliverables.push(recoveredRow);
    selectedLabelIds.set(recoveredRow.id, []);
    createdProductionIssues.push(recoveredRow);
    productionCreateReceipts.set(recoveryRequestId, {
      row: { ...recoveredRow },
      batch: { id: 'production-batch-recovered' },
      terminalConflict: false,
    });
    const seedRecoveryDraft = ({ requestId, sourceEditedAt }) => {
      sessionStorage.setItem(PROD_CREATE_DRAFT_KEY, JSON.stringify({
        mode: 'parent',
        parentId: '',
        parentLocked: false,
        ambiguous: true,
        clientSlug: 'normal-fixture',
        team: 'video',
        title: 'TEST recovered production create',
        description: '# recovered',
        status: 'todo',
        dueDate: '',
        assigneeId: '',
        labelIds: [],
        requestId,
        sourceEditedAt,
        savedAt: Date.now(),
      }));
    };
    await page.evaluate(seedRecoveryDraft, { requestId: recoveryRequestId, sourceEditedAt: recoverySourceEditedAt });
    const recoveryTopbar = await page.evaluate(() => _prodCreateTopbarButton('normal-fixture', 'video'));
    expect(!/ disabled /.test(recoveryTopbar)
      && recoveryTopbar.includes('Recover issue')
      && recoveryTopbar.includes('_prodOpenCreate()'),
    'a committed-but-unacknowledged create lost its only recovery affordance: ' + recoveryTopbar);

    // 3a. The delayed create_options purge proof moves onto the recovery
    // open, which is now the only way this modal renders.
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
    await page.evaluate(() => { _prodOpenCreate(); });
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
      // The sign-in refusal keeps a live host: the recovery gate is the one
      // gate the closure deliberately leaves open.
      recoveryGate: _prodCreateRecoveryGateText({ clientSlug: 'normal-fixture' }),
    }));
    expect(purgedCreateState.draft === null
      && Array.isArray(purgedCreateState.catalog) && purgedCreateState.catalog.length === 0
      && purgedCreateState.status === 'idle'
      && !purgedCreateState.modal
      && purgedCreateState.savedDraft === null
      && purgedCreateState.recoveryGate.includes('Sign in'),
    'a delayed create_options response restored protected creation state after sign-out');

    await page.evaluate(() => {
      _syncviewStaffIdentitySave({ key: 'browser-role-key', role: 'admin', member: { id: 'admin', name: 'Browser Admin', role: 'admin', team: 'graphics' } });
      _syncviewStaffIdentityVerified = true;
      _syncviewStaffRefreshChrome();
    });
    // 3b. TEST scope stays service-only on the one gate that can still open.
    const blockedTestRecovery = await page.evaluate(() => ({
      test: _prodCreateRecoveryGateText({ clientSlug: 'test-fixture' }),
      real: _prodCreateRecoveryGateText({ clientSlug: 'normal-fixture' }),
    }));
    expect(blockedTestRecovery.test.includes('service-authenticated')
      && blockedTestRecovery.real === '',
    'recovery self-entered service-only TEST scope: ' + JSON.stringify(blockedTestRecovery));

    // 3c. Reopen the recovery and prove the modal is the locked, exact-retry
    // form — every branded control disabled, the recovery note present.
    await page.evaluate(seedRecoveryDraft, { requestId: recoveryRequestId, sourceEditedAt: recoverySourceEditedAt });
    await page.evaluate(() => {
      _prodState.openId = '';
      _prodState.openProjectId = 'normal-fixture';
      _prodState.team = 'video';
      _prodOpenCreate();
    });
    await page.waitForSelector('[data-prod-create-modal]');
    await page.waitForFunction(() => _prodState.createCatalogStatus === 'ready');
    const recoveredDraft = await page.evaluate(() => JSON.parse(JSON.stringify(_prodState.createDraft)));
    expect(recoveredDraft.ambiguous === true
      && recoveredDraft.requestId === 'prod:create:recovery-probe'
      && recoveredDraft.sourceEditedAt === '2026-08-23T09:00:00.000Z'
      && recoveredDraft.mode === 'parent'
      && recoveredDraft.title === 'TEST recovered production create',
    'the recovery open did not restore the exact saved intent: ' + JSON.stringify(recoveredDraft));
    expect(await page.evaluate(() => [
      'prodCreateModeBtn', 'prodCreateClientBtn', 'prodCreateTeamBtn',
      'prodCreateStatusBtn', 'prodCreateDueBtn', 'prodCreateAssigneeBtn',
    ].every(id => document.getElementById(id)?.disabled)
      && document.querySelectorAll('[data-prod-create-recovery-note]').length === 1
      && document.querySelector('.prod-create-submit')?.textContent.trim() === 'Retry saved attempt'),
    'ambiguous recovery did not lock every branded create control behind an exact retry');
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
    'the recovery modal exposed a native select/date control instead of the SyncView primitives');
    expect(brandedCreateControls.light && brandedCreateControls.dark
      && brandedCreateControls.light.color !== brandedCreateControls.dark.color
      && brandedCreateControls.light.background !== brandedCreateControls.dark.background,
    'recovery controls did not inherit the active SyncView theme');
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
      'recovery controls did not stay within the one-column mobile modal: ' + JSON.stringify(mobileCreateLayout));
    await page.setViewportSize({ width: 1280, height: 900 });

    // 3d. The retry replays the SAME intent and lands on the row that already
    // committed. It must not mint a second create, and the closure must not
    // refuse it.
    const writesBeforeRecoverySubmit = writes.length;
    const createdBeforeRecoverySubmit = createdProductionIssues.length;
    const recoveryResponse = page.waitForResponse(response => {
      if (!response.url().includes('/functions/v1/production-write')) return false;
      try {
        const body = JSON.parse(response.request().postData() || '{}');
        return body.operation === 'create' && body.request_id === 'prod:create:recovery-probe';
      } catch (_error) { return false; }
    });
    await page.locator('.prod-create-submit').click();
    const recoveryHttpResponse = await recoveryResponse;
    expect(recoveryHttpResponse.status() === 200, 'the ambiguous retry was refused instead of replaying its committed row');
    await page.waitForFunction(() => _prodState.createDraft === null
      && _prodState.view === 'detail'
      && _prodIssue(_prodState.openId)?.title === 'TEST recovered production create');
    const recoveryWrites = writes.filter(write =>
      write.body.operation === 'create' && write.body.request_id === 'prod:create:recovery-probe');
    expect(recoveryWrites.length === 1
      && writes.length === writesBeforeRecoverySubmit + 1
      && createdProductionIssues.length === createdBeforeRecoverySubmit
      && recoveryWrites[0].body.source_edited_at === '2026-08-23T09:00:00.000Z'
      && recoveryWrites[0].response.native_committed === true
      && (await page.evaluate(() => sessionStorage.getItem(PROD_CREATE_DRAFT_KEY))) === null,
    'the ambiguous retry minted a fresh intent, created a second row, or left its draft behind');

    phase('quarantined_identity');
    // 4. A quarantined identity still refuses every field write. Its fixture
    // used to be manufactured by the create arc's conflict case; it is now a
    // declared fixture, because nothing can be created here any more.
    await page.evaluate(() => _prodOpenDeliverable('gra-quarantined-identity'));
    await page.waitForSelector('[data-prod-detail="gra-quarantined-identity"]');
    /* Scoped to the quarantined issue, not to the global arrays.
     *
     * These two conjuncts mean "the six refused attempts wrote nothing" -- but
     * comparing GLOBAL lengths also fails whenever anything else in the run
     * lands inside the window, which makes a real assertion sensitive to
     * unrelated timing on a loaded runner. The 2026-08-25 red run reported
     * `pwg_quarantined_identity` while the same suite passed twelve times
     * locally and twice on the same branch, which is that shape exactly.
     *
     * Counting only traffic that names THIS issue keeps what the assertion is
     * for -- a quarantined identity must not reach its Linear issue -- and drops
     * the part that was never about quarantine at all. */
    const QUARANTINED = 'gra-quarantined-identity';
    const forQuarantined = (rows) => rows.filter(row => {
      const body = row && (row.body || row);
      return String(body && (body.id || body.parent_id || '')) === QUARANTINED;
    }).length;
    const writesBeforeQuarantineAttempts = forQuarantined(writes);
    const optionsBeforeQuarantineChild = forQuarantined(createOptionReads);
    const quarantineProof = await page.evaluate(async () => {
      const issue = _prodIssue('gra-quarantined-identity');
      const attempts = [
        ['status', { status: 'done' }],
        ['description', { description: 'must not reach foreign issue' }],
        ['labels', { label_ids: ['workload-3'] }],
        ['due', { due_date: '2033-02-14' }],
        ['assignee', { assignee_id: 'designer' }],
        ['comment', { comment: { body: 'must not reach foreign issue' } }],
      ];
      const results = [];
      for (const [operation, fields] of attempts) {
        try {
          await _prodGatewayWrite(issue, operation, fields);
          results.push({ operation, code: 'unexpected_success' });
        } catch (error) {
          results.push({ operation, code: String(error && error.code || '') });
        }
      }
      _prodOpenCreate(issue.id);
      return {
        required: issue && issue.identityRepair && issue.identityRepair.required,
        results,
        canWrite: attempts.map(([operation]) => [operation, _prodCanWrite(issue, operation)]),
        gate: _prodWriteGateText(issue, 'status'),
        childGate: _prodCreateGateText(issue.project, issue.team, issue),
        notice: document.querySelector('[data-prod-identity-repair-notice="required"]')?.textContent || '',
        childModal: !!document.querySelector('[data-prod-create-modal]'),
      };
    });
    /* Ten separate claims used to share one expect(), so a failure named the
       section and nothing finer. Split, each under its own phase, so the public
       failure code identifies WHICH invariant broke -- the same fix that turned
       `error_generic` into `pwg_quarantined_identity`, applied again because
       that still was not specific enough to act on. */
    const why = ' :: ' + JSON.stringify(quarantineProof);
    phase('quarantine_projection');
    expect(quarantineProof.required === true,
      'the quarantined fixture did not project identityRepair.required' + why);

    phase('quarantine_refusals');
    expect(quarantineProof.results.length === 6,
      'not every field write was attempted' + why);
    expect(quarantineProof.results.every(result => result.code === 'write_gate_closed'),
      'a quarantined identity got past the write gate' + why);
    expect(quarantineProof.canWrite.every(([, allowed]) => allowed === false),
      '_prodCanWrite allowed an operation on a quarantined identity' + why);

    phase('quarantine_gates');
    expect(/identity repair/i.test(quarantineProof.gate),
      'the status gate text did not name the identity repair' + why);
    expect(quarantineProof.childGate === CREATE_CLOSED_TEXT,
      'the child-create gate text was not the closure sentence' + why);

    phase('quarantine_notice');
    expect(/read-only/i.test(quarantineProof.notice),
      'the identity-repair notice did not say the issue is read-only' + why);
    expect(!quarantineProof.childModal,
      'a quarantined identity opened a child create modal' + why);

    phase('quarantine_no_traffic');
    expect(forQuarantined(writes) === writesBeforeQuarantineAttempts,
      'a refused attempt still reached the gateway for this issue' + why);
    expect(forQuarantined(createOptionReads) === optionsBeforeQuarantineChild,
      'the refused child create still read create options for this issue' + why);
    phase('authority_restore');
    // End of the simulated-flip window: restore the LIVE authority. Since
    // F1(video) 2026-08-28 that is syncview for BOTH teams, so the "flip"
    // above became a same-state write — kept because its assertions prove
    // the creation closure holds in the flipped world, which is about the
    // world, not the transition.
    serverAuthority.video = 'syncview';
    await page.evaluate(async () => {
      await _prodRefreshAuthority({ silent: true });
      _prodOpenDeliverable('gra-fixture');
    });
    await page.waitForSelector('[data-prod-comment-form="gra-fixture"]');

    // Capture the row's live CAS token the same way the labels case below does.
    // Pinning this to the fixture's original `now` only held while earlier cases
    // in this file never ran; the write mock bumps `updated_at` by one second per
    // committed write, so by this point the row is several revisions along.
    const statusCas = await page.evaluate(() => _prodIssue('gra-fixture').updatedRaw);
    phase('status_write');
    await page.locator('[data-prod-prop="status"]').click();
    await page.locator('[data-prod-pick]', { hasText: 'Tweak Needed' }).click();
    await page.waitForFunction(() => window._prodIssue('gra-fixture').sourceStatus === 'tweak');
    /* findLast, not find. This wants THE write the click just made; `find`
       returns the FIRST status write this row ever received in the run, so the
       moment any earlier case touches gra-fixture's status the CAS assertion
       below starts comparing a stale revision against a fresh token and fails
       for a reason that has nothing to do with what it is testing. Same shape
       as the global write counters in the quarantine block.
       And awaited, because the paint above no longer implies the request. */
    const statusWrite = await waitForWrite(
      write => write.body.operation === 'status' && write.body.id === 'gra-fixture',
      'status on gra-fixture');
    expect(statusWrite && statusWrite.body.surface === 'production' && statusWrite.body.entity === 'deliverable', 'status did not use the Production gateway envelope');
    expect(statusWrite.body.expected_status === 'in_progress' && statusWrite.body.expected_updated_at === statusCas, 'status write omitted CAS');
    expect(statusWrite.headers['x-syncview-key'] === 'browser-role-key' && statusWrite.headers['x-syncview-actor'] === 'Browser Admin', 'verified staff attribution headers missing');

    await page.evaluate(() => {
      window.__prodNativeDueReceipts = [];
      const publish = window.wlPublishNativeDueReceipt;
      window.wlPublishNativeDueReceipt = row => {
        window.__prodNativeDueReceipts.push(JSON.parse(JSON.stringify(row)));
        return publish(row);
      };
    });
    phase('due_write');
    await page.locator('[data-prod-prop="due"]').click();
    await page.locator('[data-prod-day]').first().click();
    await page.waitForFunction(() => window._prodIssue('gra-fixture').dueRaw);
    /* AND wait for the thing the next assertion is actually about.
     *
     * `dueRaw` is the optimistic paint. The receipt is published from the
     * gateway RESPONSE (`wlPublishNativeDueReceipt(json.row)` in the write's
     * success path), so waiting on the paint and then reading the receipt array
     * asserts a post-response side effect having waited only for a pre-response
     * one. On a fast machine the response has always landed by then; on a loaded
     * runner it has not, and the assertion sees zero receipts.
     *
     * That is what CI reported on 73494b6b as `pwg_due_receipt` — the first red
     * of this family precise enough to name a single assertion. */
    await page.waitForFunction(() => (window.__prodNativeDueReceipts || []).length >= 1);
    /* Scoped to this row AND to the last one, for the same reason. Unscoped, it
       matched a due write against any issue anywhere in the run. */
    const dueWrite = await waitForWrite(
      write => write.body.operation === 'due' && write.body.id === 'gra-fixture',
      'due on gra-fixture');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(dueWrite.body.due_date), 'due picker did not send an ISO calendar date');
    const productionDueReceiptState = await page.evaluate(() => ({
      receipts: window.__prodNativeDueReceipts || [],
      persisted: localStorage.getItem(WL_NATIVE_DUE_RECEIPT_SIGNAL_KEY),
    }));
    const productionDueReceipts = productionDueReceiptState.receipts;
    phase('due_receipt');
    expect(productionDueReceipts.length === 1
      && productionDueReceipts[0].id === 'gra-fixture'
      && productionDueReceipts[0].client_slug === 'normal-fixture'
      && productionDueReceipts[0].team === 'graphics'
      && productionDueReceipts[0].due_date === dueWrite.body.due_date
      && Number.isFinite(Date.parse(productionDueReceipts[0].updated_at))
      && productionDueReceiptState.persisted === null,
    'Production due success did not emit the exact ephemeral native receipt for sibling Workload tabs');

    phase('assignee_projection');
    await page.locator('[data-prod-prop="assignee"]').click();
    const assigneeResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'assignee');
    await page.locator('[data-prod-pick]', { hasText: 'Browser Designer' }).click();
    await assigneeResponse;
    expect(writes.some(write => write.body.operation === 'assignee' && write.body.assignee_id === 'designer'), 'assignee did not route through the gateway');
    /* The picker must have ASKED the gateway who is eligible, not guessed
     * from a client-side roster. Without this the suite would pass again the
     * moment someone re-broke the mock into answering write-shaped bodies. */
    expect(assigneeOptionReads.some(read => read.body.action === 'assignee_options'
      && read.body.surface === 'production' && read.body.id === 'gra-fixture'),
    'the assignee picker did not consult the gateway eligible-assignee projection (F94)');
    expect(assigneeOptionReads.every(read => !read.response || read.response.ok !== true
      || read.response.assignees.every(row => row.id !== 'unmapped-designer')),
    'an unmapped member was offered as an assignee candidate');

    await page.evaluate(() => _prodOpenDeliverable('gra-description-parent'));
    await page.waitForFunction(() => _prodDescriptionState('gra-description-parent')?.status === 'ready');
    expect(descriptionReads.some(read => read.id === 'gra-description-parent'
      && read.body.action === 'description_read'
      && read.body.surface === 'production'
      && read.body.client_slug === 'normal-fixture'
      && read.headers['x-syncview-key'] === 'browser-role-key'),
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
    // Bulk brief preloads are retired (`_prodLoadBriefs` marks, never fetches),
    // so the only read that can race this save is the held focused one.
    let startPreSaveDescriptionRead;
    let releasePreSaveDescriptionRead;
    const preSaveDescriptionReadStarted = new Promise(resolve => { startPreSaveDescriptionRead = resolve; });
    const preSaveDescriptionReadRelease = new Promise(resolve => { releasePreSaveDescriptionRead = resolve; });
    heldDescriptionRead = { started: startPreSaveDescriptionRead, release: preSaveDescriptionReadRelease };
    await page.evaluate(() => {
      window.__prodPreSaveDescriptionRead = _prodEnsureDescription('gra-description-parent', true);
    });
    await preSaveDescriptionReadStarted;
    const saveWinsResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'description'
      && JSON.parse(response.request().postData() || '{}').id === 'gra-description-parent');
    await page.locator('[data-prod-description-control="save"]').click();
    await saveWinsResponse;
    await page.waitForFunction(() => _prodDescriptionState('gra-description-parent')?.editing === false);
    releasePreSaveDescriptionRead();
    const staleAfterSave = await page.evaluate(async () => ({
      focused: await window.__prodPreSaveDescriptionRead,
      state: _prodDescriptionState('gra-description-parent').value,
      row: _prodState.deliverables.find(item => item.id === 'gra-description-parent').brief,
    }));
    expect(staleAfterSave.focused === null
      && staleAfterSave.state === saveWinsDraft
      && staleAfterSave.row === saveWinsDraft,
    'a held focused brief read overwrote the successful description save');

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

    await page.evaluate(() => _prodComments.retry('gra-fixture'));
    await page.waitForFunction(() => document.querySelector('[data-prod-comment-form="gra-fixture"] .prod-comment-action'));
    await page.locator('[data-prod-comment-input]').fill('Browser gateway comment');
    await page.locator('.prod-comment-action', { hasText: 'Internal' }).click();
    await page.waitForFunction(() => document.querySelector('[data-prod-comment-form]')
      && document.querySelector('[data-prod-comment-form]').textContent.includes('Client-visible'));
    const commentResponse = page.waitForResponse(response => response.url().includes('/functions/v1/production-write')
      && JSON.parse(response.request().postData() || '{}').operation === 'comment');
    await page.locator('.prod-composer-submit').click();
    await commentResponse;
    const commentWrite = writes.find(write => write.body.operation === 'comment');
    expect(commentWrite && commentWrite.body.comment.body === 'Browser gateway comment' && commentWrite.body.comment.audience === 'client', 'comment body/audience did not reach the gateway');
    expect(!('expected_updated_at' in commentWrite.body), 'comment incorrectly carried scalar CAS');

    /* F1(video) 2026-08-28 — the ROW-WRITE half of this case flips with the
       authority (owner ruling: flipped in the same PR as the cutover flag).
       A video row now carries enabled controls and its writes reach the
       gateway exactly as graphics rows have since 2026-08-16. The CREATION
       closure cases above are deliberately untouched — that ruling is
       authority-independent. */
    await page.evaluate(() => _prodOpenDeliverable('vid-fixture'));
    expect(await page.locator('[data-prod-prop="status"]').getAttribute('aria-disabled') === 'false',
      'SyncView-authoritative video controls stayed locked after F1');
    const vidStatusCas = await page.evaluate(() => _prodIssue('vid-fixture').updatedRaw);
    await page.locator('[data-prod-prop="status"]').click();
    await page.locator('[data-prod-pick]', { hasText: 'Tweak Needed' }).click();
    await page.waitForFunction(() => window._prodIssue('vid-fixture').sourceStatus === 'tweak');
    const vidStatusWrite = await waitForWrite(
      write => write.body.operation === 'status' && write.body.id === 'vid-fixture',
      'status on vid-fixture');
    expect(vidStatusWrite.body.surface === 'production' && vidStatusWrite.body.entity === 'deliverable',
      'video status did not use the Production gateway envelope');
    expect(vidStatusWrite.body.expected_status === 'in_progress' && vidStatusWrite.body.expected_updated_at === vidStatusCas,
      'video status write omitted CAS');
    await page.waitForFunction(() => _prodLabelState('vid-fixture')?.status === 'ready');
    await page.locator('[data-prod-prop="labels"]').click();
    await page.locator('[data-prod-label-search-input]').fill('2× Workload');
    await page.locator('[data-prod-label-option]', { hasText: '2× Workload' }).dispatchEvent('click');
    const vidLabelWrite = await waitForWrite(
      write => write.body.operation === 'labels' && write.body.id === 'vid-fixture',
      'labels on vid-fixture');
    expect(Array.isArray(vidLabelWrite.body.label_ids) && vidLabelWrite.body.label_ids.includes('workload-2'),
      'video label write did not carry the selected label');
    await page.evaluate(() => _prodClearLayer());

    phase('authoritative_locks');
    /* CORRECTED 2026-08-06. This case used to drive the TEST row's status
       control, watch the browser stamp `test_override: true`, and assert the
       gateway answered 401 `invalid_test_override` — i.e. it reproduced the
       production defect and recorded it as the expected contract. The browser
       could never satisfy that flag (it is service-drill-only), and the UI
       renders that 401 as "Your staff sign-in expired", so the owner met an
       enabled-looking button that failed every time and blamed his session.

       The bypass is gone. A TEST row on a Linear-authoritative team is locked
       exactly like every other row, which is what the two cases above already
       assert for video — so this now proves the TEST row is no longer special. */
    const beforeTest = writes.length;
    serverAuthority.graphics = 'linear';
    // Tell this tab about the flip (as the syncview restore below does): the
    // case proves the CLIENT gate locks a known-Linear TEST row — the
    // stale-tab case just after covers the server gate for an untold tab.
    // (Written 2026-08-06 against a file already dead at boot, so the missing
    // refresh never had a chance to fail.)
    await page.evaluate(() => _prodRefreshAuthority({ silent: true }));
    await page.evaluate(() => _prodOpenDeliverable('test-fixture-row'));
    expect(await page.locator('[data-prod-prop="status"]').getAttribute('aria-disabled') === 'true',
      'an active TEST row kept an enabled status control while Linear held authority');
    await page.locator('[data-prod-prop="status"]').dispatchEvent('click');
    expect(writes.length === beforeTest
      && !writes.some(write => write.body.id === 'test-fixture-row')
      && deliverables.find(row => row.id === 'test-fixture-row').status === 'in_progress',
    'an active TEST row reached the gateway from the browser while Linear held authority');
    await page.evaluate(() => _prodClearLayer());
    // Pin the principal the later stale-authority/intake scenarios expect.
    await page.evaluate(() => {
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
    // The advanced panel is gone: the team-scope choice is the question the
    // form asks, so its buttons sit on the surface now (see the comment above
    // the `linear-submit-scope` markup in index.html).
    phase('submit');
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
      throw new Error(marker() + 'native intake request missing: ' + JSON.stringify(state));
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
    /*
     * TWO rows now, and the order is the point. The `Linear Submissions` sheet
     * is the fallback the owner reaches for when a submission does not land, and
     * it used to be appended only AFTER the gateway accepted — so the one case
     * that needs it (refused; the person who typed it has gone home) wrote
     * nothing. On 2026-08-26 that cost a videographer's whole shoot to a 413,
     * recoverable only out of his own browser. The request row is written before
     * the gateway is called at all; the post-commit row still follows it.
     */
    expect(submissionLogs.length === 2,
      'expected a pre-gateway request row and a post-commit telemetry row, saw ' + submissionLogs.length);
    const [requestLog, commitLog] = submissionLogs;
    expect(/"kind":"submission_request"/.test(requestLog.webhookJson || ''),
      'the first sheet row is not the raw submission request');
    expect(requestLog.intakeWritesAtArrival === 0,
      'the fallback row reached the sheet AFTER the gateway had already been called');
    expect(/"items"/.test(requestLog.webhookJson || ''),
      'the fallback row carries no items, so the work could not be rebuilt from it');
    expect(/native-batch/.test(commitLog.webhookJson || ''),
      'post-commit submission telemetry omitted the native batch');
    expect(commitLog.intakeWritesAtArrival === 1,
      'post-commit telemetry did not follow the gateway write');
    expect(legacyProjectReads.length >= 1 && legacyProjectReads.every(read => read.method === 'POST'),
      'Submit did not retain the mocked legacy project-name read for non-enrolled clients');
    expect(legacyCreateHits.length === 0, 'Submit touched a legacy Linear create webhook');
    // The calendar write is observed inside the durable job, before its final
    // checkpoint removes the pending record and releases the cross-surface lock.
    // Wait for the same completion boundary the real Submit UI awaits before
    // programmatically opening the next creation surface.
    await page.waitForFunction(() => _linearIntakeRead() === null, null, { timeout: 10000 });

    phase('calendar_native_intake');
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
    // Round 2 redesign (owner pick 2026-08-18, option E): Start a new batch is
    // first and the default; every compatible batch lives in ONE
    // previous-batch card whose always-visible dropdown preselects the LAST
    // batch, so appending to it is one click on the card.
    expect(await latestChoice.count() === 1
      && await latestChoice.isChecked() === false
      && await page.locator('#calNativePostOverlay input[value="new"]').isChecked()
      && await page.evaluate(() => document.querySelector('#calNativePostOverlay .cal-native-batch-select')?.value === 'batch-latest'),
    'Calendar Create Post did not offer the latest active batch behind the new-batch default: ' + JSON.stringify(await page.evaluate(() => ({
        client: calState.client,
        slug: calClientSlug(calState.client),
        state: _calNativePostState,
        text: document.getElementById('calNativePostOverlay')?.textContent,
      }))));
    /* The overlay has exactly two selects — the batch dropdown and (2026-08-24)
       the video-editor picker — and neither may choose the CLIENT, which still
       comes from the open calendar. Kept as an explicit allowlist rather than
       relaxed to "any select": the invariant being protected is that a client
       picker can never appear here, and "no unexpected select" is how that is
       detected.

       Second half rewritten 2026-08-26. It used to assert that the dialog
       contained the sentence "The client comes from this calendar." — the
       subtitle, which the owner had removed that morning as restating the
       obvious. That is what turned this gate red, and the failure was fair:
       something did change. But the sentence was never the invariant, it was a
       CLAIM about the invariant printed on screen, and a test that reads a
       claim passes just as happily when the claim is false. It now asserts the
       thing itself — that the dialog's client IS the open calendar's client,
       by name and by slug — which is strictly stronger and survives any wording
       the dialog is given next. */
    expect(await page.locator('#calNativePostOverlay select:not(.cal-native-batch-select):not(#calNativeEditorSelect)').count() === 0
      && await page.evaluate(() => _calNativePostState
        && _calNativePostState.clientName === String(calState.client || '').trim()
        && _calNativePostState.clientSlug === calClientSlug(calState.client)),
    'Calendar Create Post exposed a client picker instead of using the open calendar client');
    expect(await page.evaluate(() => [...document.querySelectorAll('#calNativePostOverlay select')]
        .every(select => !/client/i.test(select.id + ' ' + select.className + ' ' + (select.getAttribute('aria-label') || '')))),
    'a Create Post select is labelled as a client picker');
    expect(calendarWrites.length === beforeAppendCalendarWrites,
      'opening Calendar Create Post wrote a local card before native intake');
    await latestChoice.check();

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
      throw new Error(marker() + 'Calendar append never reached the gateway: ' + JSON.stringify({
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
      throw new Error(marker() + 'Calendar append did not complete: ' + JSON.stringify({
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
      && await page.locator('#calNativePostOverlay input[value="batch"]').count() === 0,
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
