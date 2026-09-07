'use strict';

// Actual request handler and shared auth; synthetic SDK/provider boundaries.
// No database, Deno serving, browser, or external network proof is claimed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { spawnSync, execFileSync } = require('node:child_process');
if (!process.execArgv.includes('--experimental-strip-types')) {
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', __filename],
    { encoding: 'utf8', windowsHide: true });
  process.stdout.write(child.stdout || '');
  process.stderr.write(child.stderr || '');
  process.exit(child.status ?? 1);
}
const root = path.resolve(__dirname, '..');
const relative = 'supabase/functions/workload-linear/index.ts';
const source = fs.readFileSync(path.join(root, relative), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'workload-cutoff-'));
const open = { lane: 'mirror_outbox', generation: 0, cutoff_enabled: false };
let state, handler, checks = 0;
function reset(extra = {}) {
  state = { control: { ...open }, authority: { video: 'linear', graphics: 'linear' },
    reads: 0, fetches: 0, writes: 0, team: 'VID', ...extra };
}
const db = {
  from(table) {
    let ids = [], one = false, update = false;
    const q = {
      select() { return q; },
      eq(key, value) {
        if (key === 'id') ids = [value];
        if (table === 'linear_outbound_cutoff_control') assert.deepEqual([key, value], ['lane', 'mirror_outbox']);
        return q;
      },
      in(key, value) { assert.equal(key, 'id'); ids = value; return q; },
      update() { update = true; return q; },
      abortSignal() { return q; },
      maybeSingle() { one = true; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (table === 'linear_outbound_cutoff_control') {
            state.reads++;
            if (state.controlThrows) throw Error('synthetic control transport failure');
            return { data: state.control, error: state.controlError || null };
          }
          if (table === 'syncview_runtime_flags') return { data: { value: state.authority }, error: null };
          assert.equal(table, 'workload_issues', 'unrecognized SDK access');
          if (update) { state.writes++; return { data: state.mirrorFails ? null : [{ id: ids[0] }], error: null }; }
          const rows = ids.map(id => ({ id, client_name: 'Fixture', team_key: state.team,
            team_name: state.team === 'GRA' ? 'Graphics' : 'Video', is_sub_issue: true, active: true }));
          return { data: one ? rows[0] : rows, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  },
};
globalThis.__workloadCutoffDb = db;
const secrets = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  ROLE_KEY_ADMIN: 'synthetic-admin', ROLE_KEY_SMM: 'synthetic-smm', ROLE_KEY_CREATIVE: 'synthetic-creative',
  LINEAR_MIRROR_API_KEY: 'synthetic-provider' };
globalThis.Deno = { env: { get: key => secrets[key] }, serve: fn => { handler = fn; } };
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.linear.app/graphql');
  state.fetches++;
  const { query, variables } = JSON.parse(options.body);
  let data;
  if (query.includes('WorkloadLinearIssueTeam')) {
    data = { issue: { id: variables.id, team: { key: state.providerTeam || state.team,
      name: (state.providerTeam || state.team) === 'GRA' ? 'Graphics' : 'Video' } } };
    if (state.closeAfterTeam) state.control = { ...open, generation: 1, cutoff_enabled: true };
    if (state.nativeAfterTeam) state.authority.video = 'syncview';
  } else if (query.includes('WorkloadLinearSetDueDate')) {
    data = { issueUpdate: { success: true, issue: { id: variables.id, dueDate: variables.input.dueDate,
      updatedAt: '2030-01-01T00:00:00Z' } } };
  } else {
    assert.ok(query.includes('WorkloadLinearMetadata'));
    data = Object.fromEntries(Object.entries(variables).map(([key, id]) => [key.replace('id', 'i'),
      { id, dueDate: null, updatedAt: '2030-01-01T00:00:00Z',
        labels: { nodes: [], pageInfo: { hasNextPage: false } } }]));
    if (state.closeAfterBatch) state.control = { ...open, generation: 1, cutoff_enabled: true };
    if (state.loseAfterBatch) state.control = null;
    if (state.providerFails) return new Response('{}', { status: 503 });
  }
  return new Response(JSON.stringify({ data }), { status: 200 });
};
async function load(text, name) {
  const pattern = /import \{\s*createClient,\s*type SupabaseClient,\s*\} from "npm:@supabase\/supabase-js@2\.49\.8";/;
  assert.ok(pattern.test(text));
  text = text.replace(pattern, 'const createClient=()=>globalThis.__workloadCutoffDb; type SupabaseClient=any;');
  for (const file of ['../_shared/browser-write-auth.ts', '../_shared/staff-role-auth.ts', './policy.mjs']) {
    text = text.replaceAll(JSON.stringify(file), JSON.stringify(pathToFileURL(path.resolve(root, 'supabase/functions/workload-linear', file)).href));
  }
  const file = path.join(scratch, name + '.ts');
  fs.writeFileSync(file, text);
  await import(pathToFileURL(file).href);
}
const metadata = (count = 1) => ({ action: 'metadata', issue_ids: Array.from({ length: count }, (_, i) => 'fixture-' + i) });
const write = { action: 'set_due_date', client: 'Fixture', issue_id: 'fixture-0', due_date: '2030-02-01' };
async function request(body, key = 'synthetic-admin') {
  const response = await handler(new Request('https://fixture.invalid/workload-linear', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-syncview-key': key }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}
function check(value, label) { assert.ok(value, label); checks++; }
(async () => {
  const log = console.log;
  console.log = () => {};
  try {
    check((source.match(/\bfetch\(/g) || []).length === 1, 'one provider transport covers all operations');
    const transport = source.slice(source.indexOf('async function linearRequest('), source.indexOf('async function requireProviderAdmission('));
    check(transport.indexOf('await requireProviderAdmission(db);') < transport.indexOf('await fetch(LINEAR_URL'),
      'admission immediately precedes the sole provider transport');
    const sql = fs.readFileSync(path.join(root, 'migrations/2026-09-06-linear-outbound-cutoff.sql'), 'utf8');
    check(sql.includes('grant select on table public.linear_outbound_cutoff_control to service_role;')
      && sql.includes("lane text primary key check (lane = 'mirror_outbox')"), 'existing SQL owns the exact lane and service-only read grant');
    await load(source, 'candidate');
    for (const team of ['VID', 'GRA', 'CON', 'STR']) {
      reset({ team }); const r = await request(metadata(21), 'synthetic-creative');
      check(r.status === 200 && r.body.complete && state.fetches === 2 && state.reads === 2, team + ' metadata retains open-control behavior');
    }
    for (const control of [null, [], {}, false, { ...open, lane: 'other' }, { ...open, cutoff_enabled: 'false' },
      { ...open, cutoff_enabled: null }, ...[null, '0', false, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
        .map(generation => ({ ...open, generation }))]) {
      for (const body of [metadata(21), write]) {
        reset({ control }); const r = await request(body);
        check(r.status === 503 && r.body.error === 'linear_cutoff_control_unavailable'
          && state.fetches === 0 && state.writes === 0, 'malformed/missing control denies before any provider fetch');
      }
    }
    for (const fault of [{ controlError: { message: 'unavailable' } }, { controlThrows: true }]) {
      reset(fault); const r = await request(metadata());
      check(r.status === 503 && state.fetches === 0, 'failed control read refuses');
    }
    for (const body of [metadata(21), write]) {
      reset({ control: { ...open, generation: 1, cutoff_enabled: true } }); const r = await request(body);
      check(r.status === 410 && r.body.ok === false && /Refresh SyncView/.test(r.body.message)
        && state.fetches === 0 && state.writes === 0, 'retired route refuses honestly');
    }
    for (const fault of [{ closeAfterBatch: true }, { loseAfterBatch: true }]) {
      reset(fault); const r = await request(metadata(41));
      check([410, 503].includes(r.status) && !r.body.ok && state.fetches === 1 && state.reads === 2,
        'later metadata batch cannot reuse admission or turn cutoff into partial success');
    }
    reset({ providerFails: true }); let r = await request(metadata());
    check(r.status === 200 && r.body.complete === false && state.fetches === 1, 'open-control provider failure retains honest partial receipt');
    for (const team of ['VID', 'GRA']) {
      reset({ team, authority: { video: 'syncview', graphics: 'syncview' } }); r = await request(write);
      check(r.status === 409 && state.fetches === 0, 'native authority refuses before team lookup');
    }
    reset({ authority: null }); r = await request(write);
    check(r.status === 503 && state.fetches === 0, 'unknown authority refuses before team lookup');
    reset(); r = await request(write);
    check(r.status === 200 && r.body.ok && state.fetches === 2 && state.reads === 2 && state.writes === 1,
      'open provider write retains two independently admitted transports and mirror update');
    reset({ mirrorFails: true }); r = await request(write);
    check(r.status === 200 && r.body.mirror_pending === true, 'confirmed provider commit stays success when mirror update fails');
    reset({ closeAfterTeam: true }); r = await request(write);
    check(r.status === 410 && state.fetches === 1 && state.reads === 2 && state.writes === 0, 'cutoff between team read and mutation refuses mutation');
    reset({ nativeAfterTeam: true }); r = await request(write);
    check(r.status === 409 && state.fetches === 1 && state.writes === 0, 'post-lookup authority recheck remains effective');
    reset({ providerTeam: 'GRA' }); r = await request(write);
    check(r.status === 409 && state.fetches === 1 && state.writes === 0, 'moved provider team still refuses');
    for (const [body, key] of [[metadata(), 'bad'], [write, 'synthetic-creative']]) {
      reset(); r = await request(body, key);
      check([401, 403].includes(r.status) && state.fetches === 0 && state.reads === 0, 'staff authentication remains before admission');
    }
    // An admission is an observation, not cancellation of an already admitted request.
    reset({ closeAfterBatch: true }); r = await request(metadata());
    check(r.status === 200 && r.body.complete && state.control.cutoff_enabled && state.fetches === 1,
      'pre-cutoff admitted read may finish after activation; no retroactive no-egress claim');
    const baseline = execFileSync('git', ['show', 'b60a9705492002830eed60ece874e0686fc4b538:' + relative], { cwd: root, encoding: 'utf8' });
    await load(baseline, 'exact-base');
    reset({ control: { ...open, generation: 1, cutoff_enabled: true } }); r = await request(metadata());
    check(r.status === 200 && state.fetches === 1, 'exact base counterexample reaches provider after closed cutoff');
    reset({ authority: { video: 'syncview', graphics: 'syncview' } }); r = await request(write);
    check(r.status === 409 && state.fetches === 1, 'exact base counterexample reads provider before native refusal');
    await load(source.replace('await requireProviderAdmission(db);', ''), 'admission-removed');
    reset({ control: null }); r = await request(metadata());
    check(r.status === 200 && state.fetches === 1, 'negative control detects removed admission boundary');
  } finally {
    console.log = log;
    for (const file of fs.readdirSync(scratch)) fs.unlinkSync(path.join(scratch, file));
    fs.rmdirSync(scratch);
  }
  console.log('Workload cutoff: ' + checks + ' actual-handler modeled-boundary checks passed; external requests 0. SQL/serving unproven.');
})().catch(error => { console.error(error); process.exitCode = 1; });
