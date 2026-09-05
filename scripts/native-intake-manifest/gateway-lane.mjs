/*
 * Gateway lane: the REAL supabase/functions/production-write/index.ts,
 * executed in Node under --experimental-strip-types, against the disposable
 * PostgreSQL through supabase-shim.mjs.
 *
 * THE TEST SEAM, stated exactly. Four things are substituted and nothing else:
 *   1. the `npm:@supabase/supabase-js` import  -> supabase-shim.mjs (SQL over psql)
 *   2. `Deno.env.get`                           -> process.env
 *   3. `Deno.serve(handler)`                    -> captures `handler` for direct calls
 *   4. `globalThis.fetch`                       -> a recording fake (Linear, the
 *      outbound drainer, the service-role probe); every outbound request is
 *      logged as evidence and none leaves this process.
 * Relative imports (policy.mjs, selected-label-pages.mjs, _shared/*) are the
 * repository files, rewritten only to absolute paths. If any substitution
 * fails to match the source exactly once, the lane aborts: the seam is bound to
 * the current file, not to a copy of it.
 *
 * Runs as a child process (the unit suite does not enable type stripping) and
 * prints one JSON document between NIR_RESULT_BEGIN/END markers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { hooks, resetHooks, runSql } from './supabase-shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FN_DIR = path.join(ROOT, 'supabase', 'functions', 'production-write');
const INDEX_TS = path.join(FN_DIR, 'index.ts');
const INDEX_HTML = path.join(ROOT, 'index.html');

/* ---------- 1. Load the real handler through the seam ---------- */
function rewriteOnce(source, needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + 1) >= 0) {
    throw new Error('gateway seam does not match production-write/index.ts exactly once: ' + needle);
  }
  return source.replace(needle, replacement);
}
const shimUrl = pathToFileURL(path.join(HERE, 'supabase-shim.mjs')).href;
const negativeControl = process.env.INTAKE_MANIFEST_NEGATIVE_CONTROL === '1';
let source = negativeControl
  ? execFileSync('git', ['show', 'a4925097aad2be1d8b4710e56da1220a19c850c5:supabase/functions/production-write/index.ts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  : fs.readFileSync(INDEX_TS, 'utf8');
source = rewriteOnce(source,
  'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',
  `import { createClient, SupabaseClient } from "${shimUrl}";`);
source = rewriteOnce(source, 'from "../_shared/staff-role-auth.ts";',
  `from "${pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'staff-role-auth.ts')).href}";`);
source = rewriteOnce(source, 'from "./policy.mjs";', `from "${pathToFileURL(path.join(FN_DIR, 'policy.mjs')).href}";`);
source = rewriteOnce(source, 'from "./selected-label-pages.mjs";',
  `from "${pathToFileURL(path.join(FN_DIR, 'selected-label-pages.mjs')).href}";`);
source = rewriteOnce(source, 'from "../_shared/linear-create-id.mjs";',
  `from "${pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'linear-create-id.mjs')).href}";`);
source = rewriteOnce(source, 'Deno.serve(', 'globalThis.__nirServe(');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nir-gateway-'));
const rewritten = path.join(scratch, 'production-write.rewritten.ts');
fs.writeFileSync(rewritten, source);

globalThis.Deno = { env: { get: name => process.env[name] } };
const background = [];
globalThis.EdgeRuntime = { waitUntil: promise => { background.push(Promise.resolve(promise).catch(() => null)); } };

/* ---------- 2. The recording fetch ---------- */
const net = { linear: 'ok', requests: [] };
let thumbnailText = 'Bright Future';
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch (_e) { body = null; }
  net.requests.push({ url, op: body && body.query ? String(body.query).slice(0, 40) : null });
  if (url.startsWith('https://docs.google.com/document/d/fixture-')) {
    return new Response('Bright future and calm focus make clear creative plans. '.repeat(30), { status: 200 });
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify([{ videoNumber: 1, title: thumbnailText }]) }] }), { status: 200 });
  }
  if (url.startsWith('https://api.linear.app/')) {
    if (net.linear === 'down') throw new TypeError('fetch failed: provider unreachable');
    if (net.linear === 'http500') return new Response('{"errors":[{"message":"internal"}]}', { status: 500 });
    if (net.linear === 'errors') return new Response(JSON.stringify({ errors: [{ message: 'denied' }] }), { status: 200 });
    const query = String(body && body.query || '');
    const variables = body && body.variables || {};
    if (/ProductionWriteProjectScope/.test(query)) {
      return new Response(JSON.stringify({ data: { project: {
        id: variables.id, name: 'Fixture Project',
        teams: { nodes: [{ id: 'team_fixture_video', key: 'VID' }, { id: 'team_fixture_graphics', key: 'GRA' }] },
      } } }), { status: 200 });
    }
    if (/ProductionWriteBatchParentScope/.test(query)) {
      return new Response(JSON.stringify({ data: { issue: {
        id: variables.id, team: { key: 'VID' }, project: { id: 'proj_fixture_shared' }, parent: null,
      } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }
  if (/\/functions\/v1\/linear-outbound$/.test(url)) {
    return new Response(JSON.stringify({ ok: false, error: 'drainer_unavailable_in_proof' }), { status: 503 });
  }
  if (/rest\/v1\/rpc\/b4_service_role_probe/.test(url)) return new Response('false', { status: 200 });
  return new Response('', { status: 500 });
};

process.env.SUPABASE_URL = 'http://supabase.fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';
process.env.ROLE_KEY_ADMIN = 'fixture-admin-key';
process.env.ROLE_KEY_SMM = 'fixture-smm-key';
process.env.ROLE_KEY_CREATIVE = 'fixture-creative-key';
process.env.LINEAR_READ_API_KEY = 'fixture-linear-read-key';
delete process.env.GRAPHIC_TITLE_API_KEY;

let handler = null;
globalThis.__nirServe = fn => { handler = fn; };
await import(pathToFileURL(rewritten).href);
if (typeof handler !== 'function') throw new Error('Deno.serve handler was not captured');

/* ---------- 3. The browser's own item builder, for realistic payloads ---------- */
const html = fs.readFileSync(INDEX_HTML, 'utf8');
const { extractFunction } = await import(pathToFileURL(path.join(ROOT, 'test', 'helpers', 'extract-function.js')).href)
  .then(m => m.default || m);
const createdStatus = /const PROD_CREATED_STATUS = '([a-z_]+)';/.exec(html);
if (!createdStatus) throw new Error('missing const PROD_CREATED_STATUS in index.html');
const browser = { console, PROD_CREATED_STATUS: createdStatus[1] };
vm.createContext(browser);
vm.runInContext([
  extractFunction(html, '_linearVideoBrief'),
  extractFunction(html, '_linearThumbnailBrief'),
  extractFunction(html, '_linearIntakeItems'),
].join('\n'), browser);

/* ---------- 4. Helpers ---------- */
const checks = [];
const events = [];
function check(id, kind, label, pass, evidence) {
  checks.push({ id, lane: 'gateway', kind, label, pass: !!pass, evidence: evidence === undefined ? null : evidence });
  const line = `${pass ? 'ok  ' : 'FAIL'} [${kind}] ${id} ${label}`;
  events.push(line);
  console.error(line + (pass ? '' : '\n      evidence: ' + JSON.stringify(evidence)));
}
async function sql(query) {
  const r = await runSql(query);
  if (r.status !== 0) throw new Error('fixture sql failed: ' + r.stderr);
  return r.stdout.trim();
}
async function count(query) { return Number(await sql(`select count(*) from (${query}) t;`)); }
async function rows(query) {
  const out = await sql(`select coalesce(json_agg(t), '[]'::json) from (${query}) t;`);
  return out ? JSON.parse(out) : [];
}

const STAFF = { 'x-syncview-key': 'fixture-admin-key', 'x-syncview-actor': 'Fixture Admin' };
const SMM = { 'x-syncview-key': 'fixture-smm-key', 'x-syncview-actor': 'Fixture Manager' };
async function post(body, headers = STAFF) {
  const req = new Request('http://gateway.fixture.invalid/functions/v1/production-write', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const response = await handler(req);
  const json = await response.json().catch(() => ({}));
  await Promise.all(background.splice(0));
  return { status: response.status, json };
}
/* source_edited_at is validated against the server clock (not more than five
   minutes in the future), and a retry must carry the SAME value the first
   attempt did, exactly as the browser job store does. */
const stamps = new Map();
function stamp(rid) {
  if (!stamps.has(rid)) stamps.set(rid, new Date(Date.now() - 1000).toISOString());
  return stamps.get(rid);
}
let seq = negativeControl ? 1000 : 0;
function requestId(lane = 'submission') { seq += 1; return `${lane}:00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`; }
function rootBody(mode, rid, overrides = {}) {
  const videos = [{ number: 1, main_cam: 'cam', side_cam: '', audio: '', notes: 'fixture note', dueDate: '2026-09-12' }];
  const items = browser._linearIntakeItems(mode, videos, rid);
  return {
    operation: 'intake_create', surface: 'submission', client_slug: 'fixture-client',
    request_id: rid, source_edited_at: stamp(rid),
    batch: { name: 'Fixture batch ' + rid.slice(-4), description: 'fixture notes', notes: 'fixture notes', filming_doc_url: null, footage_folder_url: null },
    items,
    ...overrides,
  };
}

// This lane is a NEW manifest proof. Loader and synthetic fixture originated in
// PR1274 at 7d2812ac; its historical reliability/readiness results are not rerun
// or promoted by this package. Reports contain only check labels and totals.
function ok(label, pass) { check(label, 'manifest', label, pass); }
const q = value => "'" + String(value).replace(/'/g, "''") + "'";
async function manifests(rid) { return rows('select * from public.production_intake_manifests where request_id=' + q(rid)); }
async function inventory() {
  return Promise.all(['production_intake_manifests', 'batches', 'deliverables', 'mirror_outbox']
    .map(table => count('select 1 from public.' + table)));
}
async function unchanged(before) { return JSON.stringify(before) === JSON.stringify(await inventory()); }
function reset() { resetHooks(); net.linear = 'ok'; net.requests.length = 0; }
async function rpcSql(args, role = 'service_role') {
  const j = value => q(JSON.stringify(value)) + '::jsonb';
  return runSql('set role ' + role + '; select to_json(public.production_intake_root_begin('
    + [args.p_row, args.p_event, args.p_manifest].map(j).join(',') + '));');
}

try {
  // Real generation gate and original retry path. After a parent exists the
  // existing code deliberately skips generation; changed template/plan metadata
  // must not turn the original caller's resend into a conflict or lose its brief.
  await sql(`insert into public.filming_plans(client_slug,client_name,doc_url,doc_id)
    values('fixture-client','Fixture Client','https://docs.google.com/document/d/fixture-plan/edit','fixture-plan')
    on conflict(client_slug) do update set doc_url=excluded.doc_url, doc_id=excluded.doc_id;`);
  process.env.GRAPHIC_TITLE_API_KEY = 'fixture-generator-key';
  reset();
  const enriched = rootBody('both', requestId()); enriched.items[1].brief = '';
  let enrichedWrites = 0;
  hooks.beforeRpc = name => { if (name === 'production_deliverable_write' && ++enrichedWrites === 2) throw new Error('synthetic enriched child two unavailable'); };
  const firstEnriched = await post(enriched);
  const generationRan = net.requests.some(r => r.url === 'https://api.anthropic.com/v1/messages');
  reset();
  thumbnailText = 'Calm Focus'; process.env.GRAPHIC_TITLE_MODEL = 'fixture-new-template';
  await sql("update public.filming_plans set doc_url='https://docs.google.com/document/d/fixture-new-plan/edit', doc_id='fixture-new-plan' where client_slug='fixture-client'");
  const enrichedRetry = await post(enriched);
  const enrichedRows = await rows('select brief from public.deliverables where team=\'graphics\' and batch_id=' + q(enrichedRetry.json.batch?.id));
  ok(negativeControl ? 'negative-control-retry-valid-but-loses-first-generated-brief' : 'same-original-request-changed-enrichment-retains-first-brief',
    firstEnriched.status >= 500 && generationRan && enrichedRetry.status === 201
    && (negativeControl ? !enrichedRows[0]?.brief : enrichedRows[0]?.brief === 'Bright Future'));
  delete process.env.GRAPHIC_TITLE_API_KEY;
  delete process.env.GRAPHIC_TITLE_MODEL;
  await sql("delete from public.filming_plans where client_slug='fixture-client'");
  reset();
  const unstamped = rootBody('both', requestId()); delete unstamped.source_edited_at;
  let unstampedWrites = 0;
  hooks.beforeRpc = name => { if (name === 'production_deliverable_write' && ++unstampedWrites === 2) throw new Error('synthetic unstamped child two unavailable'); };
  const unstampedFirst = await post(unstamped);
  reset();
  const unstampedRetry = await post(unstamped);
  ok('omitted-source-time-remains-a-valid-explicit-retry', unstampedFirst.status >= 500 && unstampedRetry.status === 201);
  if (!negativeControl) {
    const clocks = await rows(`select d.created_at=m.source_edited_at and d.status_at=m.source_edited_at as original_clock
      from public.production_intake_manifests m join public.deliverables d on d.batch_id=m.batch_id
      where m.request_id=${q(unstamped.request_id)}`);
    ok('omitted-source-time-retry-keeps-first-created-clock', clocks.length === 2 && clocks.every(r => r.original_clock));
  }
  reset();
  let body = rootBody('both', requestId());
  // Canary confidential data is invented. It must persist only in private DB
  // rows, never in this test's output or a manifest API response.
  body.items[1].brief = 'PRIVATE_SYNTHETIC_MISSING_CHILD_CONTENT';
  body.secret = 'IGNORED_SYNTHETIC_CREDENTIAL';
  const original = structuredClone(body);
  let rootArgs;
  let children = 0;
  hooks.beforeRpc = (name, args) => {
    if (name === 'production_intake_root_begin') rootArgs = structuredClone(args);
    if (name === 'production_deliverable_write' && ++children === 2) throw new Error('synthetic child two unavailable');
  };
  const interrupted = await post(body);
  body = null; // model complete browser payload loss before inventory
  const saved = (await manifests(original.request_id))[0];
  if (negativeControl) {
    const partials = await rows(`select b.id from public.batches b join public.deliverables d on d.batch_id=b.id
      where b.name=${q(original.batch.name)} group by b.id having count(*)=1`);
    ok('negative-control-old-root-partial-has-no-expected-manifest', interrupted.status >= 500 && children === 2 && !saved && partials.length === 1);
    console.log(JSON.stringify({ suite: 'native-root-manifest-negative-control', passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length }));
    if (checks.some(c => !c.pass)) process.exitCode = 1;
  } else {
  ok('partial-parent-plus-first-child-committed', interrupted.status >= 500 && !!saved
    && await count('select 1 from public.deliverables where batch_id=' + q(saved.batch_id)) === 1);
  const missing = await rows(`select item->'row' as expected from public.production_intake_manifests m
    cross join lateral jsonb_array_elements(m.expected_items) item
    left join public.deliverables d on d.id=item->'row'->>'id'
      and d.client_slug=m.client_slug and d.batch_id=m.batch_id
    where m.request_id=${q(original.request_id)} and d.id is null`);
  ok('lost-browser-payload-still-identifies-missing-child-content', body === null && missing.length === 1
    && missing[0].expected.brief === original.items[1].brief && saved.expected_items.length === 2);
  ok('server-retains-original-intent-and-receipt-identities', saved.request_intent.items[1].brief === original.items[1].brief
    && saved.parent_receipt.dedup_key === rootArgs.p_event.outbound.dedup_key
    && saved.expected_items.every(i => i.child_dedup && i.child_fingerprint && i.row.id && i.row.created_at));
  ok('unrelated-credential-field-never-persisted', !JSON.stringify(saved).includes(original.secret));
  const immutable = JSON.stringify(saved);

  reset();
  const one = await post(rootBody('video', requestId()));
  const oneManifest = await rows('select * from public.production_intake_manifests where batch_id=' + q(one.json.batch?.id));
  ok('complete-one-distinct-from-incomplete-two', one.status === 201 && oneManifest[0]?.expected_items.length === 1
    && saved.expected_items.length === 2
    && await count('select 1 from public.deliverables where batch_id=' + q(one.json.batch.id)) === 1);
  ok('browser-response-excludes-private-manifest', !JSON.stringify(one.json).includes('request_intent')
    && !JSON.stringify(one.json).includes('expected_items') && !JSON.stringify(interrupted.json).includes(original.items[1].brief));

  reset();
  // The test retains a fixture copy. This is explicit caller retry WITH the
  // original payload, not a reconstruction endpoint or automatic retry.
  const retried = await post(original);
  ok('identical-explicit-retry-completes-original-two', retried.status === 201
    && await count('select 1 from public.deliverables where batch_id=' + q(saved.batch_id)) === 2);
  const afterRetry = await inventory();
  const replay = await post(original);
  ok('identical-completed-retry-does-not-duplicate', replay.status === 201 && await unchanged(afterRetry));
  ok('manifest-first-plan-remains-byte-equivalent', JSON.stringify((await manifests(original.request_id))[0]) === immutable);

  reset();
  const concurrent = rootBody('both', requestId());
  let arrivals = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  hooks.beforeRpc = async name => {
    if (name === 'production_intake_root_begin') {
      if (++arrivals === 2) release();
      await barrier;
    }
  };
  const pair = await Promise.all([post(concurrent), post(concurrent)]);
  const concurrentSaved = (await manifests(concurrent.request_id))[0];
  ok('concurrent-real-transactions-converge', pair.every(r => r.status === 201) && arrivals === 2
    && await count('select 1 from public.deliverables where batch_id=' + q(concurrentSaved?.batch_id)) === 2
    && await count('select 1 from public.mirror_outbox where entity_id=' + q(concurrentSaved?.batch_id)) === 1);

  reset();
  const conflictA = rootBody('both', requestId());
  const conflictB = structuredClone(conflictA); conflictB.items[1].brief = 'DIFFERENT_SYNTHETIC_CALLER_CONTENT';
  let conflictArrivals = 0; let conflictRelease;
  const conflictBarrier = new Promise(resolve => { conflictRelease = resolve; });
  hooks.beforeRpc = async name => {
    if (name === 'production_intake_root_begin') {
      if (++conflictArrivals === 2) conflictRelease();
      await conflictBarrier;
    }
  };
  const conflicted = await Promise.all([post(conflictA), post(conflictB)]);
  const conflictManifest = (await manifests(conflictA.request_id))[0];
  ok('concurrent-conflicting-request-has-one-winner', conflicted.map(r => r.status).sort().join(',') === '201,409'
    && conflictArrivals === 2 && await count('select 1 from public.deliverables where batch_id=' + q(conflictManifest?.batch_id)) === 2);

  reset();
  for (const [label, mutate, headers] of [
    ['changed-expected-child-refused', b => { b.items[1].brief = 'CHANGED_SYNTHETIC_CONTENT'; }, STAFF],
    ['changed-expected-cardinality-refused', b => { b.items.pop(); }, STAFF],
    ['changed-created-time-refused', b => { b.source_edited_at = new Date(Date.parse(b.source_edited_at) - 1000).toISOString(); }, STAFF],
    ['wrong-actor-refused', () => {}, SMM],
    ['wrong-client-refused', b => { b.client_slug = 'fixture-split'; }, STAFF],
  ]) {
    const before = await inventory();
    const changed = structuredClone(original); mutate(changed);
    const response = await post(changed, headers);
    ok(label, [403, 409].includes(response.status) && await unchanged(before));
  }

  // Database defenses use the service role explicitly; gateway shim uses the
  // fixture owner for table translation, so these are separate role assertions.
  reset();
  let result = await rpcSql(rootArgs);
  ok('service-role-original-receipt-replay', result.status === 0);
  const enrichedArgs = structuredClone(rootArgs);
  enrichedArgs.p_manifest.expected_items[1].row.brief = 'DIFFERENT_SYNTHETIC_GENERATION';
  enrichedArgs.p_manifest.expected_items[1].row.linear_raw = { attribution: { version: 'different' } };
  result = await rpcSql(enrichedArgs);
  const returnedPlan = result.status === 0 ? JSON.parse(result.stdout.trim()) : null;
  ok('changed-derived-metadata-replay-returns-first-plan', result.status === 0
    && JSON.stringify(returnedPlan.expected_items) === JSON.stringify(saved.expected_items));
  for (const [label, change] of [
    ['database-actor-binding', a => { a.p_event.actor_key = 'member:fixture-other'; }],
    ['database-client-binding', a => { a.p_row.client_slug = 'fixture-split'; a.p_manifest.expected_items.forEach(i => { i.row.client_slug = 'fixture-split'; }); }],
    ['database-expected-child-receipt-binding', a => { a.p_manifest.expected_items[1].child_fingerprint = 'different'; }],
    ['database-expected-child-content-binding', a => { a.p_manifest.expected_items[1].row.title = 'DIFFERENT_SYNTHETIC_TITLE'; }],
  ]) {
    const changed = structuredClone(rootArgs); change(changed);
    result = await rpcSql(changed);
    ok(label, result.status !== 0 && /idempotency_conflict/.test(result.stderr));
  }
  for (const role of ['anon', 'authenticated']) {
    result = await runSql('set role ' + role + '; select * from public.production_intake_manifests;');
    ok(role + '-cannot-read-private-payload', result.status !== 0 && /permission denied/.test(result.stderr));
    result = await rpcSql(rootArgs, role);
    ok(role + '-cannot-call-private-writer', result.status !== 0 && /permission denied/.test(result.stderr));
  }
  const invalidTeam = structuredClone(rootArgs);
  delete invalidTeam.p_manifest.expected_items[1].row.team;
  result = await rpcSql(invalidTeam);
  ok('missing-expected-team-refused-before-manifest-replay', result.status !== 0 && /invalid_intake_manifest/.test(result.stderr));
  result = await runSql("set role service_role; update public.production_intake_manifests set request_intent='{}';");
  ok('service-role-cannot-overwrite-manifest', result.status !== 0 && /permission denied/.test(result.stderr));
  result = await runSql('set role service_role; delete from public.production_intake_manifests;');
  ok('service-role-cannot-delete-manifest', result.status !== 0 && /permission denied/.test(result.stderr));

  for (const [label, table] of [['manifest-insert-failure-is-atomic', 'production_intake_manifests'], ['parent-writer-failure-is-atomic', 'batches']]) {
    reset();
    await sql(`create function public.manifest_test_refuse() returns trigger language plpgsql as $$ begin raise exception 'synthetic refusal'; end $$;
      create trigger manifest_test_refuse ${table === 'batches' ? 'after' : 'before'} insert on public.${table} for each row execute function public.manifest_test_refuse();`);
    const before = await inventory();
    const refused = await post(rootBody('both', requestId()));
    ok(label, refused.status >= 500 && await unchanged(before));
    await sql(`drop trigger manifest_test_refuse on public.${table}; drop function public.manifest_test_refuse();`);
  }
  reset();
  const authorityBody = rootBody('both', requestId());
  hooks.beforeRpc = async name => {
    if (name === 'production_intake_root_begin') await sql(`update public.syncview_runtime_flags set value='{"video":"linear","graphics":"linear"}' where key='prod_authority'`);
  };
  const beforeAuthority = await inventory();
  const denied = await post(authorityBody);
  ok('authority-refusal-cannot-leave-manifest-or-parent', denied.status === 409 && await unchanged(beforeAuthority));
  await sql(`update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}' where key='prod_authority'`);

  reset();
  let dropped = false;
  for (const variant of ['missing-items', 'mismatched-identity']) {
    reset();
    const malformedBody = rootBody('both', requestId());
    hooks.afterRpc = (name, args, result) => {
      if (name === 'production_intake_root_begin') {
        const malformed = structuredClone(result);
        if (variant === 'missing-items') malformed.data.expected_items = [];
        else malformed.data.expected_items[1].row.id = 'del_synthetic_wrong_identity';
        return malformed;
      }
      return result;
    };
    const malformedResponse = await post(malformedBody);
    const malformedManifest = (await manifests(malformedBody.request_id))[0];
    ok('malformed-result-' + variant + '-uses-existing-readback-contract', malformedResponse.status === 500
      && malformedResponse.json.error === 'idempotent_result_missing' && malformedManifest?.expected_items.length === 2
      && await count('select 1 from public.deliverables where batch_id=' + q(malformedManifest?.batch_id)) === 0);
  }
  reset();
  const lost = rootBody('video', requestId());
  hooks.afterRpc = (name, args, result) => {
    if (!dropped && name === 'production_intake_root_begin') { dropped = true; throw new Error('synthetic response loss after parent commit'); }
    return result;
  };
  const lostResponse = await post(lost);
  const lostManifest = (await manifests(lost.request_id))[0];
  ok('lost-parent-response-preserves-manifest-and-original-receipt', lostResponse.status >= 500 && !!lostManifest
    && await count('select 1 from public.batches where id=' + q(lostManifest.batch_id)) === 1
    && await count('select 1 from public.deliverables where batch_id=' + q(lostManifest.batch_id)) === 0);
  const retained = JSON.stringify(await rows('select * from public.production_intake_manifests order by request_id'));
  // Retained-data rollback does not drop schema or disable stale caller RPCs.
  // The old EF is exercised separately by integration review; here existing
  // parent writer replay is used directly while all evidence remains intact.
  const j = v => q(JSON.stringify(v)) + '::jsonb';
  result = await runSql('set role service_role; select to_json(public.production_batch_write(' + j(rootArgs.p_row) + ',' + j(rootArgs.p_event) + '));');
  ok('old-parent-writer-replay-retains-manifests-and-receipts', result.status === 0
    && retained === JSON.stringify(await rows('select * from public.production_intake_manifests order by request_id')));
  reset();
  ok('inflight-new-caller-resumes-after-retained-data-rollback', (await post(lost)).status === 201
    && JSON.stringify((await manifests(lost.request_id))[0]) === JSON.stringify(lostManifest));
  ok('provider-prerequisite-remains', net.requests.some(r => r.url.startsWith('https://api.linear.app/')));

  console.log(JSON.stringify({ suite: 'native-root-manifest', passed: checks.filter(c => c.pass).length,
    failed: checks.filter(c => !c.pass).length, live_proof: false, reconstruction: 'NOT_IMPLEMENTED' }));
  if (checks.some(c => !c.pass)) process.exitCode = 1;
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
