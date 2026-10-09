'use strict';
// The client-onboarding Edge Function's handler (supabase/functions/_shared/client-onboarding.mjs),
// run for real in Node against a fake database. Admin only for reads AND writes, checked before the
// body is read; the checklist write goes through the admin-only RPC with the actor's name; nothing
// secret is ever selected or returned.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0; let failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ok  ' + msg); } else { failed++; console.error('FAIL  ' + msg); } }

const CATALOG = [
  { step_key: 'first_card_created', position: 2, label: 'First real card created', kind: 'owner', required: true, detectable: true, proof: 'p', default_owner: 'owner' },
  { step_key: 'intro_call_booked', position: 1, label: 'Intro call booked', kind: 'auto', required: true, detectable: true, proof: 'p', default_owner: 'owner' },
  { step_key: 'syncview_link_sent', position: 3, label: 'Link sent', kind: 'owner', required: false, detectable: false, proof: 'p', default_owner: 'owner' },
];

function fakeDb(state) {
  const calls = { selects: [], rpcs: [] };
  function query(table) {
    const q = { table, filters: [], order: null, single: false };
    const api = {
      select(cols) { q.cols = cols; return api; },
      eq(col, val) { q.filters.push([col, val]); return api; },
      in(col, vals) { q.ins = (q.ins || []).concat([[col, vals]]); return api; },
      order(col, opts) { q.order = [col, opts]; return api; },
      limit() { return api; },
      maybeSingle() { q.single = true; return api; },
      then(resolve, reject) {
        calls.selects.push(q);
        let rows = (state.tables[table] || []).slice();
        for (const [c, v] of q.filters) rows = rows.filter((r) => r[c] === v);
        for (const [c, vs] of q.ins || []) rows = rows.filter((r) => vs.includes(r[c]));
        if (q.order) rows.sort((a, b) => (a[q.order[0]] > b[q.order[0]] ? 1 : -1));
        const res = state.failTable === table ? { data: null, error: { message: 'boom secret detail' } } : { data: q.single ? (rows[0] || null) : rows, error: null };
        return Promise.resolve(res).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    calls,
    from: query,
    rpc(name, args) {
      calls.rpcs.push({ name, args });
      const fn = state.rpc[name];
      return Promise.resolve(fn ? fn(args) : { data: null, error: null });
    },
  };
}

function makeReq(method, headers, body, spy) {
  const req = new Request('https://example.test/functions/v1/client-onboarding', { method, headers, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  if (spy) { const orig = req.text.bind(req); req.text = () => { spy.read = true; return orig(); }; }
  return req;
}

(async () => {
  const mod = await import(path.join(ROOT, 'supabase/functions/_shared/client-onboarding.mjs'));
  const ADMIN = { id: 'm-admin', name: 'Fixture Admin', role: 'admin', active: true };
  const SMM = { id: 'm-smm', name: 'Fixture SMM', role: 'smm', active: true };
  const baseState = () => ({
    tables: {
      team_members: [ADMIN, SMM, { id: 'm-off', name: 'Gone', role: 'admin', active: false }],
      onboarding_steps: CATALOG,
      client_onboarding_progress: [{ client_slug: 'alpha', step_key: 'intro_call_booked', status: 'done', responsible: 'owner', evidence: 'link', note: null, source: 'manual', done_by: 'Fixture Admin', done_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
      client_onboarding_summary_v1: [{ client_slug: 'alpha', required_steps: 2, required_done: 1, required_todo: 1, onboarded: false }, { client_slug: 'beta', required_steps: 2, required_done: 0, required_todo: 2, onboarded: false }],
      client_resource_status_v1: [{ client_slug: 'alpha', token_present: true, email_present: true }],
      client_resources: [{ client_slug: 'alpha', resource_key: 'drive_client_folder', value: 'folder-1', status: 'found', source: 'manual', confirmed_by: 'x', confirmed_at: null, updated_at: null }],
      client_sales_state: [{ client_slug: 'alpha', hubspot_deal_id: 'd1', hubspot_contact_id: 'c1', hubspot_stage: 'x', contract_state: 'unknown', payment_state: 'unknown', imported_unknown: true, synced_at: null }],
    },
    rpc: {},
  });
  function harness(state, role) {
    const db = fakeDb(state); const made = { n: 0 };
    const authorize = (key) => (key === 'admin-key' ? { ok: true, role: 'admin' } : key === 'smm-key' ? { ok: false, role: 'smm' } : { ok: false, role: null });
    const handler = mod.buildHandler({ authorize, makeClient: () => { made.n++; return db; }, newId: () => 'req-1' });
    return { db, made, handler };
  }
  const post = (h, key, body, spy) => h.handler(makeReq('POST', { 'content-type': 'application/json', ...(key ? { 'x-syncview-key': key } : {}) }, body, spy));
  const j = async (res) => res.json();

  // ---- access: admin only, reads and writes, before the body is read
  for (const action of ['get', 'set_step', 'summary']) {
    let h = harness(baseState()); let spy = {};
    let res = await post(h, '', { action, slug: 'alpha', member_id: 'm-admin' }, spy);
    ok(res.status === 401 && !spy.read && h.made.n === 0, action + ': no key is 401, the body is never read and no database client is made');
    h = harness(baseState()); spy = {};
    res = await post(h, 'smm-key', { action, slug: 'alpha', member_id: 'm-smm' }, spy);
    ok(res.status === 403 && !spy.read && h.made.n === 0 && h.db.calls.rpcs.length === 0, action + ': a valid non-admin (SMM) key is 403 before anything is read or written');
    h = harness(baseState());
    res = await post(h, 'admin-key', { action, slug: 'alpha', member_id: 'm-smm' });
    ok(res.status === 403 && (await j(res)).error === 'admin_member_required' && h.db.calls.rpcs.length === 0, action + ': the named member must be an admin, an SMM member is refused');
    h = harness(baseState());
    res = await post(h, 'admin-key', { action, slug: 'alpha', member_id: 'm-off' });
    ok(res.status === 403 && h.db.calls.rpcs.length === 0, action + ': an inactive admin member is refused');
    h = harness(baseState());
    res = await post(h, 'admin-key', { action, slug: 'alpha' });
    ok(res.status === 403 && h.db.calls.rpcs.length === 0, action + ': no member_id is refused');
  }
  let h = harness(baseState());
  ok((await h.handler(makeReq('GET', {}))).status === 405 && (await h.handler(makeReq('OPTIONS', {}))).status === 204, 'only POST (and the CORS preflight) is served');
  res = await post(h, 'admin-key', { action: 'nope', member_id: 'm-admin' });
  ok(res.status === 400 && (await j(res)).error === 'unknown_action', 'an unknown action is refused');
  res = await post(h, 'admin-key', { action: 'get', member_id: 'm-admin', slug: '' });
  ok(res.status === 400 && (await j(res)).error === 'missing_client', 'a missing client is refused');

  // ---- get
  var res;
  h = harness(baseState());
  res = await post(h, 'admin-key', { action: 'get', slug: 'Alpha', member_id: 'm-admin' });
  let out = await j(res);
  ok(res.status === 200 && out.ok && out.client_slug === 'alpha', 'get: the slug is normalised the way every other table does it');
  ok(h.db.calls.rpcs[0].name === 'client_onboarding_ensure' && h.db.calls.rpcs[0].args.p_slug === 'alpha', 'get: the checklist rows are ensured first');
  ok(out.steps.map((s) => s.step_key).join() === 'intro_call_booked,first_card_created,syncview_link_sent', 'get: steps come back in checklist order');
  ok(out.steps[0].status === 'done' && out.steps[1].status === 'todo' && out.steps[1].updated_at === null, 'get: a step with no progress row is todo');
  ok(out.steps[2].required === false, 'get: the optional step is marked optional');
  ok(out.summary.required_todo === 1 && out.resources.present.token_present === true && out.resources.stored[0].resource_key === 'drive_client_folder' && out.sales.imported_unknown === true, 'get: summary, resource presence, stored resources and sales state are returned');
  const selected = h.db.calls.selects.map((q) => q.table);
  ok(!selected.some((t) => /client_credentials|client_access/.test(t)), 'get: credentials and review tokens are never read');
  ok(!/review_token|password/.test(JSON.stringify(out)), 'get: nothing secret is in the response');
  ok(h.db.calls.selects.filter((q) => q.table === 'client_onboarding_progress')[0].filters.some(([c, v]) => c === 'client_slug' && v === 'alpha'), 'get: progress is read for that client only');
  const bad = baseState(); bad.rpc.client_onboarding_ensure = () => ({ data: null, error: { message: 'client_onboarding_client_missing' } });
  h = harness(bad); res = await post(h, 'admin-key', { action: 'get', slug: 'ghost', member_id: 'm-admin' });
  ok(res.status === 404 && (await j(res)).error === 'client_profile_missing', 'get: a client with no profile is 404');
  const boom = baseState(); boom.failTable = 'client_resources';
  h = harness(boom); res = await post(h, 'admin-key', { action: 'get', slug: 'alpha', member_id: 'm-admin' });
  out = await j(res);
  ok(res.status === 500 && out.error === 'request_failed' && !JSON.stringify(out).includes('secret detail'), 'get: a database error is a 500 that never leaks its text');

  // ---- summary
  h = harness(baseState()); res = await post(h, 'admin-key', { action: 'summary', member_id: 'm-admin' }); out = await j(res);
  ok(res.status === 200 && out.clients.length === 2, 'summary: every client\'s progress is listed');

  // ---- set_step
  const good = { action: 'set_step', slug: 'alpha', member_id: 'm-admin', step_key: 'first_card_created', status: 'done', evidence: 'https://example.test/card', expected_updated_at: '2026-10-01T00:00:00Z' };
  for (const [patch, code, label] of [
    [{ step_key: 'Bad Key' }, 'bad_step_key', 'a malformed step key'],
    [{ status: 'finished' }, 'bad_status', 'an unknown status'],
    [{ expected_updated_at: '' }, 'expected_updated_at_required', 'a missing version'],
    [{ expected_updated_at: 'yesterday-ish' }, 'expected_updated_at_required', 'an unparseable version'],
    [{ status: 'skipped', note: '  ' }, 'skip_needs_note', 'a skip without a note'],
    [{ note: 'x'.repeat(mod.MAX_TEXT + 1) }, 'value_too_long', 'an oversize note'],
  ]) {
    h = harness(baseState()); res = await post(h, 'admin-key', { ...good, ...patch }); out = await j(res);
    ok(res.status === 400 && out.error === code && h.db.calls.rpcs.length === 0, 'set_step: ' + label + ' is refused before the database is called');
  }
  const okState = baseState(); okState.rpc.client_onboarding_set_step = () => ({ data: { status: 'done', updated_at: '2026-10-01T01:00:00Z' }, error: null });
  h = harness(okState); res = await post(h, 'admin-key', good); out = await j(res);
  const call = h.db.calls.rpcs.find((c) => c.name === 'client_onboarding_set_step');
  ok(res.status === 200 && out.ok && out.request_id === 'req-1' && out.result.status === 'done', 'set_step: a good change succeeds');
  ok(call.args.p_role === 'admin' && call.args.p_actor === 'Fixture Admin' && call.args.p_slug === 'alpha' && call.args.p_expected_updated_at === '2026-10-01T00:00:00Z' && call.args.p_evidence === 'https://example.test/card' && call.args.p_note === null,
    'set_step: the RPC gets the admin role, the actor\'s real name (never a header), the version and the evidence');
  const conflict = baseState(); conflict.rpc.client_onboarding_set_step = () => ({ data: null, error: { message: 'client_onboarding_version_conflict' } });
  h = harness(conflict); res = await post(h, 'admin-key', good); out = await j(res);
  ok(res.status === 409 && out.error === 'version_conflict' && out.row === null, 'set_step: a stale version is a 409');
  conflict.tables.client_onboarding_progress.push({ client_slug: 'alpha', step_key: 'first_card_created', status: 'done', updated_at: '2026-10-01T02:00:00Z' });
  h = harness(conflict); res = await post(h, 'admin-key', good); out = await j(res);
  ok(res.status === 409 && out.row && out.row.updated_at === '2026-10-01T02:00:00Z', 'set_step: the conflict returns the current row so the page can show it');
  for (const [msg, status, code] of [['client_onboarding_admin_only', 403, 'admin_only'], ['client_onboarding_skip_needs_note', 400, 'skip_needs_note'], ['client_onboarding_unknown_step', 400, 'unknown_step'], ['client_onboarding_client_missing', 404, 'client_profile_missing'], ['some internal detail', 500, 'write_failed']]) {
    const st = baseState(); st.rpc.client_onboarding_set_step = () => ({ data: null, error: { message: msg } });
    h = harness(st); res = await post(h, 'admin-key', good); out = await j(res);
    ok(res.status === status && out.error === code && !JSON.stringify(out).includes('internal detail'), 'set_step: database error "' + msg + '" maps to ' + status + ' ' + code + ' and leaks nothing');
  }

  // ---- create client (step 2.5): preview writes nothing; create goes through one RPC
  const createState = () => {
    const st = baseState();
    Object.assign(st.tables, {
      social_media_managers: [
        { slug: 'managera', name: 'Manager A', active: true, source_clients: ['Alpha Client'] },
        { slug: 'managerb', name: 'Manager B', active: true, source_clients: ['Listed Only'] },
        { slug: 'managergone', name: 'Gone', active: false, source_clients: [] },
      ],
      syncview_runtime_flags: [
        { key: 'client_profiles_authority', value: { source: 'syncview' } },
        { key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } },
        ...['calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients'].map((key) => ({ key, value: { clients: ['alphaclient'] } })),
        { key: 'unrelated_flag', value: { secret: 'never-read' } },
      ],
      clients: [{ slug: 'alphaclient', display_name: 'Alpha Client' }],
      client_profiles: [{ slug: 'alphaclient', display_name: 'Alpha Client' }],
    });
    return st;
  };
  for (const action of ['create_preview', 'create']) {
    let hh = harness(createState()); let spy = {};
    let r = await post(hh, 'smm-key', { action, member_id: 'm-smm', display_name: 'New Person', manager_slug: 'managera', email: 'new@example.test' }, spy);
    ok(r.status === 403 && !spy.read && hh.made.n === 0, action + ': a non-admin key is refused before the body is read');
    hh = harness(createState());
    r = await post(hh, 'admin-key', { action, member_id: 'm-smm', display_name: 'New Person', manager_slug: 'managera', email: 'new@example.test', request_id: 'req-create-1' });
    ok(r.status === 403 && hh.db.calls.rpcs.length === 0, action + ': an SMM member under the admin key is refused');
  }
  h = harness(createState());
  res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin' }); out = await j(res);
  ok(res.status === 200 && out.ready === false && out.managers.map((m) => m.slug).join() === 'managera,managerb', 'create_preview with no name only lists the active managers');
  h = harness(createState());
  res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: '  New   Person ', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  ok(res.status === 200 && out.ready === true && out.slug === 'newperson' && out.display_name === 'New Person' && out.mode === 'client' && out.manager.name === 'Manager B' && out.slack.mode === 'finalizer' && out.will_create.length === 6, 'create_preview: a clean new client is ready, with its slug, manager and what will be made');
  ok(h.db.calls.rpcs.length === 0, 'create_preview writes nothing (no RPC at all)');
  ok(h.db.calls.selects.find((q) => q.table === 'syncview_runtime_flags').ins[0][1].every((k) => /authority|_clients$/.test(k)), 'create_preview reads only the switches it checks');
  for (const [body, code, label] of [
    [{ display_name: 'alpha client', manager_slug: 'managera', email: 'new@example.test' }, 'name_taken', 'a name already in use (any case)'],
    [{ display_name: 'Listed Only', manager_slug: 'managera', email: 'new@example.test' }, 'name_on_a_manager_list', 'a name already on a manager list'],
    [{ display_name: 'New Person', manager_slug: 'managergone', email: 'new@example.test' }, 'manager_unknown', 'an inactive manager'],
    [{ display_name: 'Alpha-Client!', manager_slug: 'managera', email: 'new@example.test' }, 'slug_taken', 'a different name with the same slug'],
  ]) {
    h = harness(createState()); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', ...body }); out = await j(res);
    ok(res.status === 200 && out.ready === false && out.blockers.includes(code), 'create_preview: ' + label + ' is a blocker (' + code + ')');
  }
  const sheetMode = createState(); sheetMode.tables.syncview_runtime_flags[0].value = { source: 'sheet' };
  h = harness(sheetMode); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New Person', manager_slug: 'managera', email: 'new@example.test' }); out = await j(res);
  ok(out.ready === false && out.blockers.includes('authority_not_syncview'), 'create_preview: the Sheet still being the main copy is a blocker');
  for (const [body, code] of [[{ display_name: '', manager_slug: 'managera' }, 'name_invalid'], [{ display_name: 'New Person', manager_slug: 'Bad Slug', email: 'new@example.test' }, 'manager_unknown'], [{ display_name: 'New Person', manager_slug: 'managera', email: 'nope' }, 'email_invalid'], [{ display_name: 'zz throwaway lower', manager_slug: 'managera', email: 'new@example.test' }, 'throwaway_name_needs_test_mode'], [{ display_name: '!!!', manager_slug: 'managera' }, 'slug_invalid']]) {
    h = harness(createState()); res = await post(h, 'admin-key', { action: 'create', member_id: 'm-admin', request_id: 'req-create-1', ...body }); out = await j(res);
    ok(res.status === 400 && out.error === code && h.db.calls.rpcs.length === 0, 'create: ' + code + ' is refused before the database is called');
  }
  h = harness(createState()); res = await post(h, 'admin-key', { action: 'create', member_id: 'm-admin', display_name: 'New Person', manager_slug: 'managera', email: 'new@example.test' }); out = await j(res);
  ok(res.status === 400 && out.error === 'request_id_required' && h.db.calls.rpcs.length === 0, 'create: a request id (for a safe retry) is required');
  const created = createState(); let copied = 0;
  created.rpc.client_create_native = (a) => ({ data: { ok: true, outcome: 'created', mode: a.p_mode, client_slug: a.p_client_slug, slack: 'not_queued' }, error: null });
  const mkCreate = (st) => { const db = fakeDb(st); return { db, made: { n: 0 }, handler: mod.buildHandler({ authorize: (k) => (k === 'admin-key' ? { ok: true, role: 'admin' } : { ok: false, role: null }), makeClient: () => db, newId: () => 'x', copyToSheet: async () => { copied++; return { ok: true }; } }) }; };
  h = mkCreate(created);
  res = await post(h, 'admin-key', { action: 'create', member_id: 'm-admin', request_id: 'req-create-1', display_name: 'New Person', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  const cc = h.db.calls.rpcs.find((c) => c.name === 'client_create_native');
  ok(res.status === 200 && out.ok && out.client_slug === 'newperson' && out.mode === 'client' && h.db.calls.rpcs.length === 1, 'create: one RPC makes the whole client');
  ok(cc.args.p_actor === 'Fixture Admin' && cc.args.p_mode === 'client' && cc.args.p_request_id === 'req-create-1' && cc.args.p_manager_slug === 'managerb' && cc.args.p_email === 'new@example.test' && cc.args.p_display_name === 'New Person', 'create: the RPC gets the admin\'s real name, the request id, the manager and the email');
  ok(copied === 1, 'create: a real client is pushed to the read-only Sheet copy (best effort)');
  copied = 0; h = mkCreate(created);
  res = await post(h, 'admin-key', { action: 'create', member_id: 'm-admin', request_id: 'req-create-2', display_name: 'ZZ THROWAWAY Proof', manager_slug: 'managera' }); out = await j(res);
  ok(res.status === 200 && out.mode === 'test' && h.db.calls.rpcs[0].args.p_mode === 'test' && h.db.calls.rpcs[0].args.p_client_slug === 'zzthrowawayproof' && copied === 0, 'create: a "ZZ THROWAWAY" name takes the test path and never reaches the Sheet copy');
  for (const [msg, errCode, status, code] of [
    ['Could not find the function public.client_create_native', 'PGRST202', 503, 'create_not_installed'],
    ['client_create_name_taken', '', 409, 'name_taken'],
    ['roster_authority_not_syncview', '', 409, 'authority_not_syncview'],
    ['native_client_provision_authority_unavailable', '', 409, 'production_authority_unavailable'],
    ['native_client_provision_idempotency_conflict', '', 409, 'request_reused'],
    ['some internal detail', '', 500, 'create_failed'],
  ]) {
    const st = createState(); st.rpc.client_create_native = () => ({ data: null, error: { message: msg, code: errCode } });
    copied = 0; h = mkCreate(st); res = await post(h, 'admin-key', { action: 'create', member_id: 'm-admin', request_id: 'req-create-3', display_name: 'New Person', manager_slug: 'managera', email: 'new@example.test' }); out = await j(res);
    ok(res.status === status && out.error === code && !JSON.stringify(out).includes('internal detail') && copied === 0, 'create: "' + msg + '" maps to ' + status + ' ' + code + ', leaks nothing and copies nothing');
  }

  // ---- Slack: what the finalizer will still wait for (real clients only)
  const slackState = () => {
    const st = createState();
    st.tables.social_media_managers[1].slack_profile_url = 'U0FIXTURE1';
    st.tables.social_media_managers[0].slack_profile_url = 'https://not-a-user-id.example';
    st.tables.client_onboarding = [{ first_name: 'New', last_name: 'Person', email: 'New@Example.test', created_at: '2026-10-08T00:00:00Z' }];
    return st;
  };
  h = harness(slackState()); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New Person', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  ok(out.ready === true && out.slack.mode === 'finalizer' && out.slack.form_received === true && out.slack.manager_slack_id === true && out.slack.filming_plan_linked === false, 'slack: a form under the same name and email, a manager with a Slack id, no filming plan yet: ready, and says what is still missing');
  ok(out.managers.find((m) => m.slug === 'managerb').slack_id === true && out.managers.find((m) => m.slug === 'managera').slack_id === false && !JSON.stringify(out).includes('U0FIXTURE1'), 'slack: the picker says whether a manager has a Slack id, never the id');
  h = harness(slackState()); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New person', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  ok(out.ready === false && out.blockers.includes('name_differs_from_form') && out.slack.form_name === 'New Person', 'slack: a name that differs from the form only in case is a blocker, with the form\'s exact name to use');
  h = harness(slackState()); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New Person', manager_slug: 'managerb', email: 'other@example.test' }); out = await j(res);
  ok(out.ready === false && out.blockers.includes('email_differs_from_form'), 'slack: a form under the same name with another email is a blocker');
  h = harness(slackState()); res = await post(h, 'admin-key', { action: 'create', member_id: 'm-admin', request_id: 'req-create-9', display_name: 'New Person', manager_slug: 'managerb' }); out = await j(res);
  ok(res.status === 400 && out.error === 'email_required' && h.db.calls.rpcs.length === 0, 'slack: a real client needs an email (the finalizer sends an empty one to manual)');
  h = harness(slackState()); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'ZZ THROWAWAY Slack', manager_slug: 'managerb' }); out = await j(res);
  ok(out.ready === true && out.slack.mode === 'never' && !h.db.calls.selects.some((q) => q.table === 'client_onboarding'), 'slack: a test client never reaches Slack and needs no email');
  // an AI-funnel form (ai_client_onboarding) counts as the form too
  const aiState = slackState(); aiState.tables.client_onboarding = [];
  aiState.tables.ai_client_onboarding = [{ first_name: 'New', last_name: 'Person', email: 'new@example.test', created_at: '2026-10-08T01:00:00Z' }];
  h = harness(aiState); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New Person', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  ok(out.ready === true && out.slack.form_received === true && h.db.calls.selects.some((q) => q.table === 'ai_client_onboarding'), 'slack: an AI-funnel client\'s form (ai_client_onboarding) is found, not shown as missing');
  aiState.tables.ai_client_onboarding[0].first_name = 'new';
  h = harness(aiState); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New Person', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  ok(out.ready === false && out.blockers.includes('name_differs_from_form') && out.slack.form_name === 'new Person', 'slack: an AI-funnel form under another spelling is a blocker too');
  // double spaces collapse on both sides, the same way validateCreate does
  const spaced = slackState(); spaced.tables.client_onboarding[0].first_name = 'New ';
  spaced.tables.client_onboarding[0].last_name = '  Person';
  h = harness(spaced); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New  Person', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  ok(out.ready === true && !out.blockers.includes('name_differs_from_form') && out.slack.form_name === 'New Person', 'slack: extra spaces in the form name or the typed name do not count as a difference');
  const inner = slackState(); inner.tables.client_onboarding[0].first_name = 'New  Middle';
  h = harness(inner); res = await post(h, 'admin-key', { action: 'create_preview', member_id: 'm-admin', display_name: 'New Middle Person', manager_slug: 'managerb', email: 'new@example.test' }); out = await j(res);
  ok(!out.blockers.includes('name_differs_from_form'), 'slack: a double space inside the form\'s first name collapses too');
  ok(mod.mapCreateError('client_create_email_required').code === 'email_required', 'slack: the database refusal for a missing email maps to email_required');

  // ---- source wiring
  const index = fs.readFileSync(path.join(ROOT, 'supabase/functions/client-onboarding/index.ts'), 'utf8');
  const shared = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/client-onboarding.mjs'), 'utf8');
  ok(/authorizeStaffKey\(key, roles/.test(index) && /buildHandler\(/.test(index) && /SUPABASE_SERVICE_ROLE_KEY/.test(index), 'index.ts wires the staff role-key gate and a service-role client to the handler');
  ok(!/x-syncview-role|x-syncview-actor|x-syncview-client-token|ANALYTICS_MIRROR_WRITE_KEY|n8n/i.test(index + shared.replace(/the n8n key are all refused/, '')), 'no spoofable actor or role header, client token or n8n key can reach it');
  ok(shared.indexOf("deps.authorize(staffKey, ['admin'])") > 0 && shared.indexOf("deps.authorize(") < shared.indexOf('req.text()') && shared.indexOf('deps.authorize(') < shared.indexOf('deps.makeClient()'), 'the admin gate runs before the body is read or a database client exists');
  ok(!/client_credentials|client_access|review_token|\bpassword\b/.test(shared.replace(/never a review token, a credential\s*\/\/ or a password/g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')), 'the handler never names the credential or token tables or columns');
  const cfg = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
  ok(/\[functions\.client-onboarding\]\s*\nverify_jwt = false/.test(cfg), 'config.toml: verify_jwt is off like the other staff-key functions');
  console.log('\nclient-onboarding-handler: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
