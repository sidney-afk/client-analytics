'use strict';
const { pathToFileURL } = require('node:url');
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
      order(col, opts) { q.order = [col, opts]; return api; },
      maybeSingle() { q.single = true; return api; },
      then(resolve, reject) {
        calls.selects.push(q);
        let rows = (state.tables[table] || []).slice();
        for (const [c, v] of q.filters) rows = rows.filter((r) => r[c] === v);
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
  const mod = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/client-onboarding.mjs')).href);
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
