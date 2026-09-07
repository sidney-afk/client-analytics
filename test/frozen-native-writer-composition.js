'use strict';
// Optional private captures; actual complete handlers over modeled SDK/RPC.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { compose, prepare, PINS, hash } = require('../scripts/frozen-native-writer-composition');
const captureRoot = process.env.FROZEN_WRITER_CAPTURE_ROOT;
if (!captureRoot) {
  assert.throws(() => compose('unreviewed source', 'calendar-upsert'), /hash_mismatch/);
  console.log('Frozen composition: input pin negative PASS; SKIP actual handlers (private dated captures required)');
  process.exit(0);
}
if (!process.execArgv.includes('--experimental-strip-types')) {
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', __filename], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || ''); process.exit(child.status ?? 1);
}
const root = path.resolve(__dirname, '..'), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-composition-test-'));
let handler, state, checks = 0, pending = [], external = 0;
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2030-01-01T00:00:00Z'])); } static now() { return RealDate.parse('2030-01-01T00:00:00Z'); } };
globalThis.fetch = async () => { external++; throw Error('external_refused'); };
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' }[key]) }, serve: fn => { handler = fn; } };
globalThis.EdgeRuntime = { waitUntil: p => { pending.push(p); } };
function reset(extra = {}) { state = { calls: [], existing: { client: 'Fixture', id: 'fixture-card', name: 'Existing', video_status: 'In Progress' }, nativeReply: null, ...extra }; pending = []; }
const db = {
  from(table) {
    let operation = 'select', value, one = false; const filters = {};
    const q = { select() { return q; }, eq(k, v) { filters[k] = v; return q; }, maybeSingle() { one = true; return q; },
      insert(v) { operation = 'insert'; value = v; return q; }, update(v) { operation = 'update'; value = v; return q; },
      then(resolve, reject) {
        state.calls.push({ table, operation, value, filters });
        assert.ok(['calendar_posts', 'sample_reviews', 'calendar_post_events', 'sample_review_events', 'syncview_runtime_flags'].includes(table), 'unrecognized table');
        return Promise.resolve({ data: operation === 'select' ? (one ? state.existing : []) : null,
          error: state.readFails && operation === 'select' ? { message: 'fixture read refusal' } : null }).then(resolve, reject);
      } };
    return q;
  },
  async rpc(name, args) {
    state.calls.push({ rpc: name, args });
    if (name === 'production_card_materialize') {
      if (state.nativeThrows) throw Error('synthetic transport loss');
      return state.nativeReply;
    }
    assert.ok(['calendar_merge_comments', 'sample_review_merge_comments'].includes(name), 'unrecognized RPC');
    return { data: null, error: null };
  },
};
globalThis.__frozenCompositionDb = db;
async function load(source, slug, label, base) {
  const sdk = 'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";';
  assert.equal(source.split(sdk).length, 2);
  source = source.replace(sdk, 'const createClient=()=>globalThis.__frozenCompositionDb; type SupabaseClient=any;');
  source = source.replace(/from "(\.\.?\/[^\"]+)";/g, (_all, relative) => {
    const file = relative.includes('native-card-materialization') ? path.join(root, 'supabase/functions/_shared/native-card-materialization.mjs') : path.resolve(base, relative);
    return 'from ' + JSON.stringify(pathToFileURL(file).href) + ';';
  });
  const file = path.join(scratch, slug + '-' + label + '.ts'); fs.writeFileSync(file, source); await import(pathToFileURL(file).href);
}
async function request(body, headers = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await handler(new Request('https://fixture.invalid/write', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw }));
  await Promise.all(pending);
  return { status: response.status, body: await response.json(), calls: structuredClone(state.calls) };
}
function check(value, label) { assert.ok(value, label); checks++; }
const schema = fs.readFileSync(path.join(root, 'migrations/live-schema-baseline-2026-07-03.sql'), 'utf8');
function fullRow(surface) {
  const table = surface === 'calendar' ? 'calendar_posts' : 'sample_reviews';
  const ddl = schema.match(new RegExp('create table if not exists public\\.' + table + ' \\(([\\s\\S]*?)\\n\\);'))[1];
  return Object.assign(Object.fromEntries([...ddl.matchAll(/^  ([a-z_]+) /gm)].map(m => [m[1], null])),
    { client: 'Fixture', id: 'fixture-card', name: 'Current edited title', order_index: '9', video_deliverable_id: null, graphic_deliverable_id: null });
}
(async () => {
  const log = console.log; console.log = () => {};
  try {
    const staged = path.join(scratch, 'staged'); const receipt = prepare(captureRoot, staged);
    check(Object.keys(receipt.files).length === 4, 'two entries and two shared files form private composition');
    assert.throws(() => prepare(captureRoot, staged), /existing_output_refused/); checks++;
    assert.throws(() => prepare(captureRoot, path.join(root, 'unsafe-output')), /inside_repository_refused/); checks++;
    for (const [slug, pin] of Object.entries(PINS)) {
      const key = pin.surface === 'calendar' ? 'post' : 'sample';
      const base = path.join(captureRoot, slug, 'functions', slug);
      const captured = fs.readFileSync(path.join(base, 'index.ts'), 'utf8');
      const composed = fs.readFileSync(path.join(staged, 'functions', slug, 'index.ts'), 'utf8');
      check(hash(compose(captured, slug)) === hash(composed), 'staged bytes are deterministic');
      assert.throws(() => compose(captured + '\n', slug), /hash_mismatch/); checks++;
      const patchCases = [
        { name: 'Renamed' },
        { client_video_approved_at: '2030-01-01T00:00:00Z', video_status: 'Approved' },
        { video_status: 'Tweaks Needed', video_tweaks: '[{"id":"note-one","text":"Please adjust","created_at":"2030-01-01T00:00:00Z"}]' },
        { kasper_approved_at: '2030-01-01T00:00:00Z' },
      ];
      const baselines = [];
      await load(captured, slug, 'captured', base);
      for (const patch of patchCases) { reset(); baselines.push(await request({ client: 'Fixture', [key]: { id: 'fixture-card', ...patch } })); }
      await load(composed, slug, 'composed', base);
      for (let i = 0; i < patchCases.length; i++) {
        reset(); const r = await request({ client: 'Fixture', [key]: { id: 'fixture-card', ...patchCases[i] } });
        assert.deepEqual(r, baselines[i]);
        check(r.status === 200 && r.body.ok && r.calls.some(c => c.operation === 'update'), 'anonymous ordinary response and all effects equal dated capture');
      }
      reset({ readFails: true }); let r = await request({ client: 'Fixture', [key]: { id: 'fixture-card', name: 'Held' } });
      check(r.body.ok === false && !r.calls.some(c => ['insert', 'update'].includes(c.operation)), 'read refusal still protects ordinary save');
      const raw = ' \n' + JSON.stringify({ client: 'Fixture', [key]: { id: 'fixture-card', name: 'Original', order_index: 1 } }) + '\n';
      for (const source of ['submission-native', 'calendar-native', 'samples-native']) {
        reset({ nativeReply: { error: null, data: { ok: false, outcome: 'held', reason: 'manifest_unresolved', conserved: true, ingress_id: '00000000-0000-4000-8000-000000000001' } } });
        r = await request(raw, { 'x-syncview-source': source, 'x-syncview-role': 'admin', 'x-syncview-actor': 'Untrusted' });
        check(r.status === 409 && !r.body.ok && r.calls.length === 1 && r.calls[0].rpc === 'production_card_materialize'
          && r.calls[0].args.p_raw_body === raw && Object.keys(r.calls[0].args).length === 3, 'forged marker/actor never grant native acceptance or reach legacy writer');
      }
      for (const fault of [{ nativeReply: null }, { nativeThrows: true }, { nativeReply: { error: null, data: { ok: true } } }]) {
        reset(fault); r = await request(raw, { 'x-syncview-source': 'submission-native' });
        check(r.status === 503 && r.body.outcome === 'unknown' && r.calls.length === 1, 'native unavailable/malformed/lost result stays terminal unknown');
      }
      for (const outcome of ['created', 'replayed']) {
        const current = fullRow(pin.surface);
        reset({ nativeReply: { error: null, data: { ok: true, conserved: true, outcome,
          ingress_id: '00000000-0000-4000-8000-000000000001', [key]: current } } });
        r = await request(raw, { 'x-syncview-source': 'submission-native' });
        assert.deepEqual(r.body[key], current);
        check(r.status === 200 && r.calls.length === 1 && !('ingress_id' in r.body), 'native acknowledgement forwards current row without old full-row write');
      }
      reset(); r = await request('{', { 'x-syncview-source': 'submission-native' });
      check(r.status === 400 && r.body.conserved === false && r.calls.length === 0, 'invalid native bytes are explicitly unretained');
      // Repository base is intentionally auth-gated and must never replace captured anonymous source as-is.
      await load(fs.readFileSync(path.join(root, 'supabase/functions', slug, 'index.ts'), 'utf8'), slug, 'repository', path.join(root, 'supabase/functions', slug));
      reset(); r = await request({ client: 'Fixture', [key]: { id: 'fixture-card', name: 'Renamed' } });
      check(r.status === 401 && r.calls.length === 0, 'exact repository counterexample denies existing tokenless caller');
    }
    check(external === 0, 'no external requests');
  } finally {
    console.log = log; globalThis.Date = RealDate;
    // Single owned temporary tree, resolved directly from mkdtemp.
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(scratch).startsWith('frozen-composition-test-'));
    fs.rmSync(scratch, { recursive: true });
  }
  console.log('Frozen composition: ' + checks + ' actual-handler/model-boundary checks PASS; SQL/serving unproven; external requests 0');
})().catch(error => { console.error(error); process.exitCode = 1; });
