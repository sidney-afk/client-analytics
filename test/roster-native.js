'use strict';
/*
 * roster-native.js -- the roster doors (roster-read, roster-write), the Sheet
 * copy and the pure rules behind them (docs/plans/2026-10-02-roster-native.md).
 * Runs the REAL handler modules in Node against a fake database and a fake
 * Google. Synthetic names only (the repository is public); no network.
 *
 * What it proves:
 *  - the key is checked before the body is read and before a database client
 *    exists; a missing or short key makes every call refuse;
 *  - roster-read returns the Sheet's own headers (json and csv), skips
 *    archived clients, and never returns linear_api_key or a review token;
 *  - roster-write splits fields into columns and extra, labels the editor,
 *    maps each database refusal to a stable error, refuses unknown fields;
 *  - the Sheet copy writes only the changed cells of the right row, as RAW
 *    text, appends a missing client, leaves other columns alone, and keeps a
 *    failed copy queued (and gives up after 10 tries);
 *  - sync_managers refuses once the database is the main copy;
 *  - no function source carries a spreadsheet id or a key.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'supabase/functions/_shared');
const load = f => import(pathToFileURL(path.join(SHARED, f)).href);

const KEY = 'k'.repeat(40);
const envOf = obj => ({ get: k => (k in obj ? obj[k] : undefined) });

// ---------- a fake database with the little query surface the handlers use ----------
function fakeDb(seed = {}) {
  const t = {
    syncview_runtime_flags: [{ key: 'client_profiles_authority', value: { source: 'syncview' } }],
    client_profiles: [], social_media_managers: [], roster_sheet_outbox: [], ...seed,
  };
  const calls = { rpc: [] };
  let nextId = 100;
  const rpcImpl = {};
  function from(name) {
    const rows = t[name];
    const state = { filters: [], order: null, limit: null, op: 'select', patch: null, upsert: null };
    const run = () => {
      let out = rows.filter(r => state.filters.every(f => f(r)));
      if (state.op === 'update') { out.forEach(r => Object.assign(r, state.patch)); return { data: out, error: null }; }
      if (state.op === 'upsert') {
        for (const u of state.upsert) {
          const i = rows.findIndex(r => r.slug === u.slug);
          if (i >= 0) Object.assign(rows[i], u); else rows.push({ ...u });
        }
        return { data: null, error: null };
      }
      if (state.order) out = [...out].sort((a, b) => String(a[state.order]).localeCompare(String(b[state.order])));
      if (state.limit != null) out = out.slice(0, state.limit);
      return { data: out.map(r => ({ ...r })), error: null };
    };
    const api = {
      select() { return api; },
      update(p) { state.op = 'update'; state.patch = p; return api; },
      insert(rowsIn) { for (const r of (Array.isArray(rowsIn) ? rowsIn : [rowsIn])) rows.push({ id: nextId++, status: 'pending', attempts: 0, ...r }); return Promise.resolve({ data: null, error: null }); },
      upsert(rowsIn) { state.op = 'upsert'; state.upsert = rowsIn; return Promise.resolve(run()); },
      eq(k, v) { state.filters.push(r => r[k] === v); return api; },
      is(k, v) { state.filters.push(r => (r[k] == null ? null : r[k]) === v); return api; },
      gt(k, v) { state.filters.push(r => Number(r[k] || 0) > v); return api; },
      lt(k, v) { state.filters.push(r => Number(r[k] || 0) < v); return api; },
      in(k, vs) { state.filters.push(r => vs.includes(r[k])); return api; },
      order(c) { state.order = c; return api; },
      limit(n) { state.limit = n; return api; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: r.data && r.data[0] ? r.data[0] : null, error: null }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  }
  return {
    t, calls, rpcImpl, next: () => nextId++,
    client: {
      from,
      rpc(name, args) {
        calls.rpc.push({ name, args });
        const f = rpcImpl[name];
        return Promise.resolve(f ? f(args, t, () => nextId++) : { data: null, error: { message: 'no such rpc ' + name } });
      },
    },
  };
}

const req = (body, headers = {}, method = 'POST') => new Request('https://example.test/fn', {
  method, headers: { 'content-type': 'application/json', ...headers },
  body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});
const call = async (handler, deps, body, headers = { 'x-roster-key': KEY }) => {
  const r = await handler(req(body, headers), deps);
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_e) { /* csv */ }
  return { status: r.status, text, json: parsed, headers: r.headers };
};

(async () => {
  const native = await load('roster-native.mjs');
  const handlers = await load('roster-handlers.mjs');
  const copyMod = await load('roster-sheet-copy.mjs');

  // =============== pure rules ===============
  assert.deepEqual(native.CLIENT_HEADERS.slice(0, 3), ['client_name', 'email', 'competitors']);
  assert(native.CLIENT_HEADERS.includes('postforme_instagram_account_id'));
  assert(!native.CLIENT_HEADERS.includes('linear_api_key') && !native.SMM_HEADERS.includes('linear_api_key'), 'no Linear key column anywhere');

  let n = native.normalizeFields({ email: ' a@b.test ', postforme_instagram_account_id: 'pf', keywords: '' });
  assert.deepEqual(n.columns, { email: 'a@b.test', keywords: '' });
  assert.deepEqual(n.extra, { postforme_instagram_account_id: 'pf' });
  for (const bad of [{ client_review_token: 'x' }, { slug: 'x' }, { linear_api_key: 'x' }, { display_name: 'x' }]) {
    assert.equal(native.normalizeFields(bad).error, 'field_not_writable', Object.keys(bad)[0]);
  }
  assert.equal(native.normalizeFields({ email: { a: 1 } }).error, 'bad_value');
  assert.equal(native.normalizeFields({ email: 'x'.repeat(20001) }).error, 'value_too_long');
  assert.equal(native.normalizeFields({}).error, 'no_fields');
  assert.equal(native.normalizeFields(null).error, 'bad_fields');
  assert.equal(native.normalizeFields(null, { allowEmpty: true }).ok, true);

  assert.equal(native.resolveClient({ client_name: 'Dr. Alpha & Beta' }).slug, native.clientSlug('Dr. Alpha & Beta'));
  assert.equal(native.resolveClient({}).error, 'missing_client');
  assert.equal(native.csvText(['a', 'b'], [{ a: 'x"y', b: 'l1\r\nl2' }]), '"a","b"\n"x""y","l1\nl2"\n');

  const mrows = native.managerRows([
    { name: 'Mgr B', slack_profile_url: 'U2', email: 'b@x.test', active: true, source_clients: ['Zed Client', 'Alpha Client'] },
    { name: 'Gone', active: false, source_clients: ['Ghost'] },
    { name: 'Mgr A', slack_profile_url: 'U1', active: true, source_clients: ['Beta Client'] },
  ]);
  assert.deepEqual(mrows.map(r => r.client_name), ['Alpha Client', 'Beta Client', 'Zed Client']);
  assert.equal(mrows[0].social_media_manager, 'Mgr B');
  assert.equal(mrows[0].slack_profile_url, 'U2');
  console.log('  pure rules: ok');

  // planSheetCopy
  const L = native.columnLetter, R = native.sheetRange;
  const tab = [['client_name', 'email', 'linear_api_key', 'keywords'], ['Alpha Client', 'old@x.test', 'KEEP', 'k1'], ['Beta Client', '', '', '']];
  let plan = native.planSheetCopy(tab, 'Clients Info', native.clientSlug('Alpha Client'), { client_name: 'Alpha Client', email: 'new@x.test', keywords: 'k1', slack_channel_id: 'C1' }, L, R);
  assert.equal(plan.op, 'update');
  assert.deepEqual(plan.updates, [{ field: 'email', range: "'Clients Info'!B2", value: 'new@x.test' }], 'only the changed cell; unknown header skipped; other columns untouched');
  plan = native.planSheetCopy(tab, 'Clients Info', 'gammaclient', { client_name: 'Gamma Client', email: 'g@x.test' }, L, R);
  assert.equal(plan.op, 'append');
  assert.deepEqual(plan.row, ['Gamma Client', 'g@x.test', '', ''], 'a new row is aligned to the Sheet header; other columns blank');
  plan = native.planSheetCopy([...tab, ['alpha client', '', '', '']], 'Clients Info', native.clientSlug('Alpha Client'), { email: 'x' }, L, R);
  assert.equal(plan.error, 'sheet_row_ambiguous');
  assert.equal(native.planSheetCopy([['x']], 'T', 'a', {}, L, R).error, 'sheet_header_missing');
  assert.deepEqual(native.planSheetRemove(tab, native.clientSlug('Beta Client')), { ok: true, row: 3 });
  assert.deepEqual(native.planSheetRemove(tab, 'nobody'), { ok: true, row: null });
  assert.equal(native.planSheetRemove([...tab, ['alpha client']], native.clientSlug('Alpha Client')).error, 'sheet_row_ambiguous');
  assert.equal(L(0), 'A'); assert.equal(L(26), 'AA');
  assert.deepEqual(native.collapseOutbox([{ id: 1, tab: 'T', client_slug: 'a', client_name: 'A' }, { id: 2, tab: 'T', client_slug: 'a', client_name: 'A' }, { id: 3, tab: 'U', client_slug: 'a', client_name: 'A' }]).map(g => g.ids), [[1, 2], [3]]);
  console.log('  sheet copy planning: ok');

  // =============== auth: before body, before a database client ===============
  let made = 0;
  const depsAuth = { env: envOf({ ROSTER_SERVICE_KEY: KEY }), fetchFn: () => { throw Error('no network'); }, getSupabase: () => { made++; return fakeDb().client; } };
  for (const [name, h] of [['roster-read', handlers.handleRosterRead], ['roster-write', handlers.handleRosterWrite]]) {
    assert.equal((await call(h, depsAuth, { action: 'status' }, {})).status, 401, name + ' no key');
    assert.equal((await call(h, depsAuth, { action: 'status' }, { 'x-roster-key': 'wrong' })).status, 401, name + ' wrong key');
    assert.equal((await call(h, depsAuth, '{not json', { 'x-roster-key': 'wrong' })).status, 401, name + ' bad body with wrong key is still 401, not 400');
    assert.equal((await call(h, { ...depsAuth, env: envOf({ ROSTER_SERVICE_KEY: 'short' }) }, { action: 'status' })).status, 503, name + ' short server key');
    assert.equal((await call(h, { ...depsAuth, env: envOf({}) }, { action: 'status' })).status, 503, name + ' missing server key');
    assert.equal((await h(req({}, { 'x-roster-key': KEY }, 'GET'), depsAuth)).status, 405, name + ' GET');
    assert.equal((await call(h, depsAuth, '{not json')).status, 400, name + ' bad json with the right key');
    assert.equal((await call(h, depsAuth, { action: 'nope' })).status, 400, name + ' unknown action');
  }
  assert.equal(made, 2, 'a database client exists only after the key passed (twice: the two unknown-action calls)');
  console.log('  auth: key first, short/missing key refuses everything: ok');

  // =============== roster-read ===============
  const db = fakeDb({
    client_profiles: [
      { slug: 'alphaclient', display_name: 'Alpha Client', email: 'a@x.test', keywords: 'k', creative_channel_id: 'C1', extra: { postforme_instagram_account_id: 'pf9' }, archived_at: null, updated_at: 't1', client_review_token: 'MUST-NOT-LEAK' },
      { slug: 'betaco', display_name: 'Beta, "Co"', email: '', extra: {}, archived_at: null, updated_at: 't2' },
      { slug: 'oldclient', display_name: 'Old Client', extra: {}, archived_at: '2026-01-01', updated_at: 't3' },
    ],
    social_media_managers: [{ slug: 'mgr', name: 'Mgr One', email: 'm@x.test', active: true, slack_profile_url: 'U77', source_clients: ['Alpha Client'], linear_api_key: 'MUST-NOT-LEAK' }],
  });
  const deps = { env: envOf({ ROSTER_SERVICE_KEY: KEY }), fetchFn: async () => { throw Error('no network'); }, getSupabase: () => db.client };
  let r = await call(handlers.handleRosterRead, deps, { action: 'clients' });
  assert.equal(r.status, 200);
  assert.equal(r.json.authority, 'syncview');
  assert.deepEqual(r.json.headers, native.CLIENT_HEADERS);
  assert.deepEqual(r.json.rows.map(x => x.slug), ['alphaclient', 'betaco'], 'archived client skipped, ordered by name');
  assert.equal(r.json.rows[0].postforme_instagram_account_id, 'pf9');
  assert.equal(r.json.rows[0].creative_channel_id, 'C1');
  assert(!/MUST-NOT-LEAK|review_token|linear_api_key/.test(r.text), 'no token or Linear key in any answer');
  r = await call(handlers.handleRosterRead, deps, { action: 'clients', include_archived: true });
  assert.equal(r.json.count, 3);
  r = await call(handlers.handleRosterRead, deps, { action: 'clients', client_name: 'alpha client' });
  assert.deepEqual(r.json.rows.map(x => x.slug), ['alphaclient']);
  r = await call(handlers.handleRosterRead, deps, { action: 'clients', format: 'csv' });
  assert.equal(r.status, 200);
  assert(r.headers.get('content-type').startsWith('text/csv'));
  assert.equal(r.headers.get('x-roster-authority'), 'syncview');
  assert.equal(r.text.split('\n')[0], native.CLIENT_HEADERS.map(h => '"' + h + '"').join(','), 'csv header is the Sheet header, quoted');
  assert(r.text.includes('"Beta, ""Co"""'), 'csv quoting');
  r = await call(handlers.handleRosterRead, deps, { action: 'managers' });
  assert.deepEqual(r.json.rows, [{ client_name: 'Alpha Client', social_media_manager: 'Mgr One', slack_profile_url: 'U77', email: 'm@x.test' }]);
  r = await call(handlers.handleRosterRead, deps, { action: 'managers', format: 'csv' });
  assert.equal(r.text, '"client_name","social_media_manager","slack_profile_url"\n"Alpha Client","Mgr One","U77"\n');
  r = await call(handlers.handleRosterRead, deps, { action: 'status' });
  assert.deepEqual([r.json.clients, r.json.managers, r.json.authority], [2, 1, 'syncview']);
  console.log('  roster-read: json, csv, filters, no leaks: ok');

  // =============== roster-write ===============
  const wdb = fakeDb();
  const profileRow = { slug: 'alphaclient', display_name: 'Alpha Client', email: 'a@x.test', extra: {}, archived_at: null };
  wdb.rpcImpl.client_profile_service_write = (a, t, id) => {
    t.client_profiles.length = 0; t.client_profiles.push(profileRow);
    t.roster_sheet_outbox.push({ id: id(), tab: 'Clients Info', client_slug: a.p_slug, client_name: a.p_display_name || 'Alpha Client', status: 'pending', attempts: 0 });
    return { data: { created: true, changed: 2, row: profileRow }, error: null };
  };
  wdb.rpcImpl.smm_assign_client = (a, t, id) => {
    t.roster_sheet_outbox.push({ id: id(), tab: 'Social Media Managers', client_slug: a.p_client_slug, client_name: a.p_client_name, status: 'pending', attempts: 0 });
    return { data: { client_name: a.p_client_name, manager_slug: a.p_manager_slug || null, slack_profile_url: a.p_slack_profile_url }, error: null };
  };
  const wdeps = { env: envOf({ ROSTER_SERVICE_KEY: KEY }), fetchFn: async () => { throw Error('no network'); }, getSupabase: () => wdb.client };

  r = await call(handlers.handleRosterWrite, wdeps, {
    action: 'upsert_client', client_name: ' Alpha Client ', source: 'Onboarding: Append Client Row!',
    fields: { email: 'a@x.test', postforme_instagram_account_id: 'pf9', keywords: 'k' },
    social_media_manager: 'Mgr One', slack_profile_url: 'U77',
  });
  assert.equal(r.status, 200, r.text);
  const w = wdb.calls.rpc[0].args;
  assert.deepEqual([w.p_slug, w.p_display_name, w.p_role], [native.clientSlug('Alpha Client'), 'Alpha Client', 'n8n']);
  assert.deepEqual(w.p_columns, { email: 'a@x.test', keywords: 'k' });
  assert.deepEqual(w.p_extra, { postforme_instagram_account_id: 'pf9' });
  assert.equal(w.p_actor, 'n8n:Onboarding: Append Client Row', 'caller label is sanitised');
  const m = wdb.calls.rpc[1].args;
  assert.deepEqual([wdb.calls.rpc[1].name, m.p_manager_slug, m.p_manager_name, m.p_slack_profile_url], ['smm_assign_client', 'mgrone', 'Mgr One', 'U77']);
  assert.equal(r.json.client.created, true);
  assert.equal(r.json.sheet_copy.configured, false, 'no Google configured: the copy stays queued, the write stands');
  assert.equal(r.json.sheet_copy.pending, 2);
  assert.equal(wdb.t.roster_sheet_outbox.every(o => o.status === 'pending'), true);

  // set_client_fields with a compare-and-set
  wdb.calls.rpc.length = 0;
  r = await call(handlers.handleRosterWrite, wdeps, { action: 'set_client_fields', slug: 'alphaclient', fields: { creative_channel_id: 'C42' }, expect: { creative_channel_id: '' }, source: 'Finalizer' });
  assert.equal(r.status, 200);
  assert.equal(wdb.calls.rpc[0].args.p_display_name, null, 'a plain field change never creates a client');
  assert.deepEqual(wdb.calls.rpc[0].args.p_expect, { creative_channel_id: '' });

  // refusals
  for (const body of [
    { action: 'set_client_fields', slug: 'alphaclient', fields: { client_review_token: 'x' } },
    { action: 'set_client_fields', slug: 'alphaclient', fields: {} },
    { action: 'set_client_fields', fields: { email: 'x' } },
    { action: 'set_client_fields', slug: 'alphaclient', fields: { email: 'x' }, expect: { slug: 'x' } },
    { action: 'upsert_client', fields: { email: 'x' } },
  ]) {
    wdb.calls.rpc.length = 0;
    r = await call(handlers.handleRosterWrite, wdeps, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(wdb.calls.rpc.length, 0, 'a bad request never reaches the database');
  }
  const map = [
    ['roster_authority_not_syncview', 409, 'authority_not_syncview'],
    ['client_profile_expectation_failed: creative_channel_id', 409, 'expectation_failed'],
    ['client_profile_archived', 409, 'client_profile_archived'],
    ['client_profile_missing', 404, 'client_profile_missing'],
    ['client_profile_field_not_writable: x', 400, 'field_not_writable'],
  ];
  for (const [message, status, code] of map) {
    wdb.rpcImpl.client_profile_service_write = () => ({ data: null, error: { message } });
    r = await call(handlers.handleRosterWrite, wdeps, { action: 'set_client_fields', slug: 'alphaclient', fields: { email: 'x' } });
    assert.deepEqual([r.status, r.json.error], [status, code], message);
  }
  wdb.rpcImpl.client_profile_service_write = () => ({ data: null, error: { message: 'connection reset secret-detail' } });
  r = await call(handlers.handleRosterWrite, wdeps, { action: 'set_client_fields', slug: 'alphaclient', fields: { email: 'x' } });
  assert.deepEqual([r.status, r.json.error], [500, 'write_failed']);
  assert(!r.text.includes('secret-detail'), 'database errors are never echoed');
  // archive_client
  wdb.rpcImpl.client_profile_archive = (a, t, id) => {
    t.roster_sheet_outbox.push({ id: id(), tab: 'Clients Info', client_slug: a.p_slug, client_name: 'Alpha Client', status: 'pending', attempts: 0 });
    return { data: { archived: true, already: false, routing: { changed: ['settings_ef_clients'] } }, error: null };
  };
  wdb.calls.rpc.length = 0;
  r = await call(handlers.handleRosterWrite, wdeps, { action: 'archive_client', client_name: 'Alpha Client', source: 'Offboarding' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([wdb.calls.rpc[0].name, wdb.calls.rpc[0].args.p_slug, wdb.calls.rpc[0].args.p_role, wdb.calls.rpc[0].args.p_actor], ['client_profile_archive', native.clientSlug('Alpha Client'), 'n8n', 'n8n:Offboarding']);
  assert.equal(r.json.client.archived, true);
  assert.equal((await call(handlers.handleRosterWrite, wdeps, { action: 'archive_client' })).status, 400);
  for (const [message, status, code] of [['roster_test_client_untouchable', 409, 'test_client_untouchable'], ['roster_routing_flag_invalid: write_ui_reroute_clients', 409, 'routing_flag_invalid'], ['roster_authority_not_syncview', 409, 'authority_not_syncview'], ['client_profile_missing', 404, 'client_profile_missing']]) {
    wdb.rpcImpl.client_profile_archive = () => ({ data: null, error: { message } });
    r = await call(handlers.handleRosterWrite, wdeps, { action: 'archive_client', client_name: 'Alpha Client' });
    assert.deepEqual([r.status, r.json.error], [status, code], message);
  }
  // creating a client reports what it did to the lists
  wdb.rpcImpl.client_profile_service_write = () => ({ data: { created: true, changed: 1, row: profileRow, routing: { changed: ['calendar_upsert_ef_clients'] } }, error: null });
  r = await call(handlers.handleRosterWrite, wdeps, { action: 'upsert_client', client_name: 'Alpha Client', fields: { email: 'a@x.test' } });
  assert.deepEqual(r.json.client.routing, { changed: ['calendar_upsert_ef_clients'] });
  r = await call(handlers.handleRosterWrite, wdeps, { action: 'assign_manager', client_name: 'Alpha Client', social_media_manager: '' });
  assert.equal(r.status, 200);
  assert.equal(wdb.calls.rpc.at(-1).args.p_manager_slug, '', 'a blank manager removes the client');
  console.log('  roster-write: fields, labels, compare-and-set, refusals, no echoed errors: ok');

  // queue_full_copy: only once the database is main
  const qdb = fakeDb({ client_profiles: [{ slug: 'alphaclient', display_name: 'Alpha Client', extra: {}, archived_at: null }, { slug: 'oldclient', display_name: 'Old Client', extra: {}, archived_at: '2026-01-01' }],
    social_media_managers: [{ slug: 'mgrone', name: 'Mgr One', active: true, source_clients: ['Alpha Client'] }] });
  const qdeps = { env: envOf({ ROSTER_SERVICE_KEY: KEY }), fetchFn: async () => { throw Error('x'); }, getSupabase: () => qdb.client };
  qdb.t.syncview_runtime_flags[0].value = { source: 'sheet' };
  r = await call(handlers.handleRosterWrite, qdeps, { action: 'queue_full_copy' });
  assert.deepEqual([r.status, r.json.error, qdb.t.roster_sheet_outbox.length], [409, 'authority_not_syncview', 0], 'a resync while the Sheet is main would overwrite it: refused');
  qdb.t.syncview_runtime_flags[0].value = { source: 'syncview' };
  r = await call(handlers.handleRosterWrite, qdeps, { action: 'queue_full_copy' });
  assert.equal(r.json.queued, 2);
  assert.deepEqual(qdb.t.roster_sheet_outbox.map(o => o.tab + ':' + o.client_slug), ['Clients Info:alphaclient', 'Social Media Managers:alphaclient']);
  console.log('  queue_full_copy: refused while the Sheet is main; queues active clients and assignments: ok');

  // =============== sync_managers (Sheet is still main) ===============
  const sdb = fakeDb();
  sdb.t.syncview_runtime_flags[0].value = { source: 'sheet' };
  sdb.t.social_media_managers.push({ slug: 'stale', name: 'Stale', active: true, source_clients: [] });
  const sdeps = { env: envOf({ ROSTER_SERVICE_KEY: KEY }), fetchFn: async () => { throw Error('x'); }, getSupabase: () => sdb.client };
  r = await call(handlers.handleRosterWrite, sdeps, { action: 'sync_managers', replace: true, managers: [
    { name: 'Mgr One', email: 'm@x.test', slack_profile_url: 'U77', source_clients: ['B Client', 'A Client'], source_row_count: 2 },
    { name: 'Mgr One', source_clients: ['A Client', 'C Client'], source_row_count: 1 },
    { name: '' },
  ] });
  assert.equal(r.status, 200, r.text);
  const mgr = sdb.t.social_media_managers.find(x => x.slug === 'mgrone');
  assert.deepEqual([mgr.slack_profile_url, mgr.source_clients, mgr.source_row_count], ['U77', ['A Client', 'B Client', 'C Client'], 3]);
  assert.equal(sdb.t.social_media_managers.find(x => x.slug === 'stale').active, false, 'a manager missing from the sync is deactivated');
  sdb.t.syncview_runtime_flags[0].value = { source: 'syncview' };
  r = await call(handlers.handleRosterWrite, sdeps, { action: 'sync_managers', managers: [{ name: 'Late Run' }] });
  assert.deepEqual([r.status, r.json.error], [409, 'authority_not_sheet'], 'a late Manager Sync cannot overwrite native edits');
  assert(!sdb.t.social_media_managers.some(x => x.slug === 'laterun'));
  console.log('  sync_managers: carries the Slack id; refused once the database is main: ok');

  // =============== the Sheet copy, against a fake Google ===============
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n') + '\n-----END PRIVATE KEY-----\n';
  const SID = 'sheet-id-for-test';
  const gEnv2 = () => ({ get: k => (k === 'ROSTER_SERVICE_KEY' ? KEY : gEnv.get(k)) });
  const gEnv = envOf({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'svc@example.test', private_key: pem }), CLIENTS_INFO_SHEET_ID: SID });
  const tabs = {
    'Clients Info': [['client_name', 'email', 'keywords', 'creative_channel_id', 'postforme_instagram_account_id'], ['Alpha Client', 'old@x.test', 'k', '', '']],
    'Social Media Managers': [['client_name', 'social_media_manager', 'linear_api_key', 'slack_profile_url'], ['Alpha Client', 'Old Mgr', 'KEEP-ME', 'U00']],
  };
  const log = [];
  let failWrites = 0;
  const deleted = [];
  const fakeGoogle = async (url, init = {}) => {
    const u = String(url);
    log.push({ url: u, method: init.method || 'GET', body: init.body });
    const ok = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return ok({ access_token: 'tok' });
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const tabOf = piece => decodeURIComponent(piece).match(/^'(.*)'!/)[1];
    if ((init.method || 'GET') === 'GET' && u.includes('?fields=sheets.properties')) {
      return ok({ sheets: [{ properties: { sheetId: 11, title: 'Clients Info' } }, { properties: { sheetId: 22, title: 'Social Media Managers' } }] });
    }
    if (u.endsWith(':batchUpdate') && !u.endsWith('/values:batchUpdate')) {
      if (failWrites > 0) { failWrites--; return ok({}, 500); }
      const b = JSON.parse(init.body);
      const titleOf = { 11: 'Clients Info', 22: 'Social Media Managers' };
      for (const r of b.requests) {
        const d = r.deleteDimension.range;
        assert.equal(d.dimension, 'ROWS');
        tabs[titleOf[d.sheetId]].splice(d.startIndex, d.endIndex - d.startIndex);
        deleted.push(d.startIndex);
      }
      return ok({});
    }
    if (u.includes('/values/') && !u.includes(':append') && (init.method || 'GET') === 'GET') {
      return ok({ values: tabs[tabOf(u.split('/values/')[1].split('?')[0])] });
    }
    if (failWrites > 0) { failWrites--; return ok({}, 500); }
    if (u.endsWith('/values:batchUpdate')) {
      const b = JSON.parse(init.body);
      assert.equal(b.valueInputOption, 'RAW');
      for (const d of b.data) {
        const mm = d.range.match(/^'(.*)'!([A-Z]+)(\d+)$/);
        const col = mm[2].split('').reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1;
        tabs[mm[1]][Number(mm[3]) - 1][col] = d.values[0][0];
      }
      return ok({});
    }
    if (u.includes(':append')) {
      assert(u.includes('valueInputOption=RAW'));
      tabs[tabOf(u.split('/values/')[1].split(':append')[0])].push(JSON.parse(init.body).values[0]);
      return ok({});
    }
    throw Error('unexpected call ' + u);
  };
  const cdb = fakeDb();
  const cstore = handlers.makeStore(cdb.client);
  cdb.t.client_profiles.push({ slug: 'alphaclient', display_name: 'Alpha Client', email: 'new@x.test', keywords: 'k', creative_channel_id: 'C42', extra: { postforme_instagram_account_id: 'pf9' }, archived_at: null });
  cdb.t.client_profiles.push({ slug: 'gammaclient', display_name: 'Gamma Client', email: 'g@x.test', extra: {}, archived_at: null });
  cdb.t.social_media_managers.push({ slug: 'mgrone', name: 'Mgr One', active: true, slack_profile_url: 'U77', source_clients: ['Alpha Client'] });
  const enqueue = (tabName, slug, name) => cdb.t.roster_sheet_outbox.push({ id: cdb.next(), tab: tabName, client_slug: slug, client_name: name, status: 'pending', attempts: 0 });
  enqueue('Clients Info', 'alphaclient', 'Alpha Client'); enqueue('Clients Info', 'alphaclient', 'Alpha Client');
  enqueue('Clients Info', 'gammaclient', 'Gamma Client');
  enqueue('Social Media Managers', 'alphaclient', 'Alpha Client');

  let s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.deepEqual([s.configured, s.done, s.failed, s.pending], [true, 3, 0, 0], JSON.stringify(s));
  assert.deepEqual(tabs['Clients Info'][1], ['Alpha Client', 'new@x.test', 'k', 'C42', 'pf9'], 'changed cells written, the rest as it was');
  assert.deepEqual(tabs['Clients Info'][2], ['Gamma Client', 'g@x.test', '', '', ''], 'a client not on the Sheet is appended');
  assert.deepEqual(tabs['Social Media Managers'][1], ['Alpha Client', 'Mgr One', 'KEEP-ME', 'U77'], 'manager and Slack id written; the other column is never touched');
  assert.equal(cdb.t.roster_sheet_outbox.every(o => o.status === 'done' && o.done_at), true, 'every queued row, duplicates included, is marked done');
  const batchCalls = log.filter(l => l.url.endsWith('/values:batchUpdate'));
  assert.equal(batchCalls.length, 2, 'one batch write per tab; two duplicate queue rows for one client collapse into one');
  assert.equal(log.filter(l => l.url.endsWith(':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS')).length, 1, 'new clients are appended in one call');
  assert.equal(log.filter(l => l.method === 'GET' && l.url.includes('/values/')).length, 2, 'one read per tab, not one per client');

  // nothing left: no Google call at all
  log.length = 0;
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.deepEqual([s.done, s.failed, log.length], [0, 0, 0]);

  // a failing write stays queued, is retried, and is given up after 10 tries
  cdb.t.client_profiles[0].email = 'newer@x.test';
  enqueue('Clients Info', 'alphaclient', 'Alpha Client');
  failWrites = 1;
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.deepEqual([s.done, s.failed], [0, 1]);
  const row = cdb.t.roster_sheet_outbox.at(-1);
  assert.deepEqual([row.status, row.attempts, row.last_error], ['pending', 1, 'sheet_write_failed']);
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.equal(s.done, 1, 'retried and succeeded');
  assert.equal(tabs['Clients Info'][1][1], 'newer@x.test');
  enqueue('Clients Info', 'alphaclient', 'Alpha Client');
  cdb.t.roster_sheet_outbox.at(-1).attempts = copyMod.MAX_ATTEMPTS - 1;
  failWrites = 99;
  cdb.t.client_profiles[0].email = 'newest@x.test';
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.equal(cdb.t.roster_sheet_outbox.at(-1).status, 'failed', 'given up after the last try');
  failWrites = 0;
  log.length = 0;
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.deepEqual([s.done, log.length], [0, 0], 'a given-up row is not retried');

  // a change queued while another copy is in flight is never lost to the older values
  cdb.t.client_profiles[0].email = 'racea@x.test';
  enqueue('Clients Info', 'alphaclient', 'Alpha Client');
  const racedId = cdb.t.roster_sheet_outbox.at(-1).id;
  const sizeBefore = cdb.t.roster_sheet_outbox.length;
  const inner = fakeGoogle;
  const racing = async (url, init = {}) => {
    if (String(url).endsWith('/values:batchUpdate')) enqueue('Clients Info', 'alphaclient', 'Alpha Client'); // a newer change lands mid-copy
    return inner(url, init);
  };
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: racing });
  assert.equal(s.done, 1);
  const open = cdb.t.roster_sheet_outbox.filter(o => o.status === 'pending');
  assert(open.length >= 1 && open.every(o => o.id > racedId), 'a repair copy stays queued so the newest state is written last');
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.equal(cdb.t.roster_sheet_outbox.filter(o => o.status === 'pending').length, 0, 'and it drains');
  void sizeBefore;

  // after a rollback to "sheet" nothing queued may overwrite the Sheet
  enqueue('Clients Info', 'alphaclient', 'Alpha Client');
  cdb.t.syncview_runtime_flags[0].value = { source: 'sheet' };
  log.length = 0;
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.deepEqual([s.refused, s.done, log.length], ['authority_not_syncview', 0, 0], 'no Google call at all');
  assert.equal(cdb.t.roster_sheet_outbox.at(-1).status, 'pending', 'the row stays queued');
  const viaDoor = await call(handlers.handleRosterWrite, { env: gEnv2(), fetchFn: fakeGoogle, getSupabase: () => cdb.client }, { action: 'copy_to_sheet' });
  assert.equal(viaDoor.json.sheet_copy.refused, 'authority_not_syncview', 'the copy_to_sheet door is gated too');
  cdb.t.syncview_runtime_flags[0].value = { source: 'syncview' };
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.equal(s.done, 1, 'once the database is main again, the queued row drains');

  // an archived client's row leaves the Sheet (highest row first); one not on the Sheet is just marked done
  tabs['Clients Info'].push(['Delta Client', 'd@x.test', '', '', '']);
  cdb.t.client_profiles.push({ slug: 'deltaclient', display_name: 'Delta Client', extra: {}, archived_at: '2026-10-01' });
  cdb.t.client_profiles.push({ slug: 'notonsheet', display_name: 'Not On Sheet', extra: {}, archived_at: '2026-10-01' });
  cdb.t.client_profiles[1].archived_at = '2026-10-01';
  assert.deepEqual(tabs['Clients Info'].map(r => r[0]), ['client_name', 'Alpha Client', 'Gamma Client', 'Delta Client']);
  enqueue('Clients Info', 'gammaclient', 'Gamma Client');
  enqueue('Clients Info', 'deltaclient', 'Delta Client');
  enqueue('Clients Info', 'notonsheet', 'Not On Sheet');
  log.length = 0;
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.deepEqual([s.done, s.failed], [3, 0]);
  assert.deepEqual(tabs['Clients Info'].map(r => r[0]), ['client_name', 'Alpha Client'], 'archived clients are gone from the mirror, nobody else');
  assert.deepEqual(deleted, [3, 2], 'rows removed highest first, so earlier row numbers stay valid');
  assert.equal(log.filter(l => l.url.endsWith(':batchUpdate') && !l.url.endsWith('/values:batchUpdate')).length, 1, 'one request for all removals');
  assert.equal(log.filter(l => l.method === 'GET' && l.url.includes('/values/')).length, 1, 'one read');
  // archived and absent: nothing to remove, no write at all
  enqueue('Clients Info', 'notonsheet', 'Not On Sheet');
  log.length = 0;
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.equal(s.done, 1);
  assert.equal(log.filter(l => l.method === 'POST' && !l.url.includes('oauth2')).length, 0, 'no write when the row is not there');
  // a removal that Google refuses stays queued
  tabs['Clients Info'].push(['Delta Client', '', '', '', '']);
  enqueue('Clients Info', 'deltaclient', 'Delta Client');
  failWrites = 1;
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.deepEqual([s.done, s.failed], [0, 1]);
  assert.equal(cdb.t.roster_sheet_outbox.at(-1).status, 'pending', 'a refused removal stays queued');
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: fakeGoogle });
  assert.equal(s.done, 1, 'and is retried');
  assert.deepEqual(tabs['Clients Info'].map(r => r[0]), ['client_name', 'Alpha Client']);

  // not configured: nothing is attempted, everything stays queued
  enqueue('Clients Info', 'alphaclient', 'Alpha Client');
  log.length = 0;
  s = await copyMod.copyToSheet({ store: cstore, env: envOf({}), fetchFn: fakeGoogle });
  assert.deepEqual([s.configured, s.pending, log.length], [false, 1, 0]);
  // bad credentials: reported, not thrown
  s = await copyMod.copyToSheet({ store: cstore, env: gEnv, fetchFn: async () => new Response('{}', { status: 401 }) });
  assert.equal(s.error, 'sheet_auth_failed');
  console.log('  sheet copy: changed cells only, RAW, append, retries, give-up, archived, unconfigured: ok');

  // =============== source contract ===============
  const files = ['roster-read/index.ts', 'roster-write/index.ts', '_shared/roster-handlers.mjs', '_shared/roster-native.mjs', '_shared/roster-sheet-copy.mjs']
    .map(f => [f, fs.readFileSync(path.join(ROOT, 'supabase/functions', f), 'utf8')]);
  for (const [f, src] of files) {
    assert(!/[A-Za-z0-9_-]{44}/.test(src.replace(/https?:\/\/\S+/g, '')), f + ': no spreadsheet id or key-like string in source');
    assert(!/Access-Control-Allow-Origin/i.test(src), f + ': server-to-server only, no CORS');
    assert(!/lin_api_/.test(src), f + ': no Linear key');
  }
  for (const f of ['roster-read/index.ts', 'roster-write/index.ts']) {
    const src = files.find(x => x[0] === f)[1];
    assert(/createClient\(/.test(src) && /getSupabase/.test(src), f + ': the database client is created lazily, after the key check');
  }
  const cfg = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
  for (const fn of ['roster-read', 'roster-write']) assert(new RegExp('\\[functions\\.' + fn + '\\]\\s*\\nverify_jwt = false').test(cfg), fn + ' JWT off in config.toml');
  console.log('  source contract: no ids or keys, no CORS, lazy client, config entries: ok');

  console.log('roster-native checks passed');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
