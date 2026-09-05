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
let source = fs.readFileSync(INDEX_TS, 'utf8');
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
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch (_e) { body = null; }
  net.requests.push({ url, op: body && body.query ? String(body.query).slice(0, 40) : null });
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
let seq = 0;
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
function appendBody(batch, rid, mode = 'both', clientSlug = 'fixture-client') {
  const videos = [{ number: 1, main_cam: '', side_cam: '', audio: '', notes: '', dueDate: '2026-09-19' }];
  return {
    operation: 'intake_create', surface: 'calendar', client_slug: clientSlug,
    request_id: rid, source_edited_at: stamp(rid),
    batch_id: batch.id, expected_batch_updated_at: batch.updated_at,
    items: browser._linearIntakeItems(mode, videos, rid, 'calendar'),
  };
}
function fillBody(cardId, team, siblingId, clientSlug = 'fixture-client') {
  return {
    operation: 'component_fill', surface: 'calendar', client_slug: clientSlug,
    card_id: cardId, team, sibling_id: siblingId,
    request_id: ('fill:' + team + ':' + cardId).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 190),
    source_edited_at: stamp('fill:' + team + ':' + cardId),
  };
}
function linearCalls() { return net.requests.filter(r => r.url.startsWith('https://api.linear.app/')).length; }
function drainerCalls() { return net.requests.filter(r => /linear-outbound$/.test(r.url)).length; }
function resetNet(mode = 'ok') { net.linear = mode; net.requests.length = 0; resetHooks(); }

const inventory = {};

/* ---------- 5. Scenarios ---------- */

/* G0 : baseline: staff root intake with the provider reachable. */
{
  resetNet('ok');
  const rid = requestId();
  const body = rootBody('both', rid);
  const r = await post(body);
  const dels = await rows(`select id, team, card_id, status, created_by from public.deliverables where client_slug='fixture-client' and title in ('Video 1','Thumbnail 1') and batch_id = '${r.json.batch && r.json.batch.id}'`);
  const outbox = await rows(`select entity, operation, status from public.mirror_outbox where client_slug='fixture-client' and (entity_id = '${r.json.batch && r.json.batch.id}' or entity_id = any(array['${dels.map(d => d.id).join("','")}']))`);
  check('G0-root-create', 'current', 'staff root intake commits natively (batch + video + thumbnail) when the provider validates',
    r.status === 201 && r.json.native_committed === true && dels.length === 2,
    { status: r.status, items: dels.length, linear_reads: linearCalls(), outbox_rows: outbox.length, outbox_status: outbox.map(o => o.status) });
  check('G0-provider-read-before-write', 'current', 'that intake performed a provider project read before its first native write',
    linearCalls() >= 1, { linear_reads: linearCalls(), requests: net.requests.map(r => r.url) });
  check('R2-zero-provider-intents', 'readiness', 'a native intake leaves ZERO pending provider intents (T5: no new provider intents in either outbox)',
    outbox.filter(o => o.status === 'pending').length === 0, { pending_intents: outbox.filter(o => o.status === 'pending').length });
  inventory.baseline = { request_id: rid, batch_id: r.json.batch && r.json.batch.id, card_id: dels[0] && dels[0].card_id, response: r.json };
}

/* G1 : provider unavailable: root, append and fill all refuse BEFORE any native write. */
{
  const before = await count('select 1 from public.deliverables');
  const beforeBatches = await count('select 1 from public.batches');
  const beforeOutbox = await count('select 1 from public.mirror_outbox');
  resetNet('down');
  const rid = requestId();
  const r = await post(rootBody('both', rid));
  const after = await count('select 1 from public.deliverables');
  check('G1-root-provider-down', 'current', 'root intake with the provider unreachable refuses 503 project_mapping_validation_unavailable and writes nothing',
    r.status === 503 && r.json.error === 'project_mapping_validation_unavailable' && after === before
      && (await count('select 1 from public.batches')) === beforeBatches && (await count('select 1 from public.mirror_outbox')) === beforeOutbox,
    { status: r.status, error: r.json.error, rows_before: before, rows_after: after });
  check('R1-root-without-provider', 'readiness', 'root intake succeeds with the provider unreachable (G2: no provider read before native write)',
    r.status === 201, { status: r.status, error: r.json.error });

  resetNet('errors');
  const r2 = await post(rootBody('both', requestId()));
  check('G1-root-provider-error-body', 'current', 'a provider 200 carrying an errors array is also a 503 refusal (fail closed, nothing written)',
    r2.status === 503 && r2.json.error === 'project_mapping_validation_unavailable' && (await count('select 1 from public.deliverables')) === before,
    { status: r2.status, error: r2.json.error });

  const savedKey = process.env.LINEAR_READ_API_KEY;
  delete process.env.LINEAR_READ_API_KEY;
  resetNet('ok');
  const r3 = await post(rootBody('both', requestId()));
  check('G1-root-provider-key-absent', 'current', 'with no provider read key configured the refusal is immediate: 503 and zero provider requests',
    r3.status === 503 && r3.json.error === 'project_mapping_validation_unavailable' && linearCalls() === 0,
    { status: r3.status, error: r3.json.error, linear_reads: linearCalls() });
  process.env.LINEAR_READ_API_KEY = savedKey;

  /* append: the batch exists and its parent route resolves from the local
     outbox dependency (no provider read needed for the route), but the
     project validation in front of it still requires the provider. */
  resetNet('down');
  const batch = await rows(`select id, to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') as updated_at from public.batches where id='${inventory.baseline.batch_id}'`);
  if (!batch[0]) throw new Error('baseline batch missing: G0 did not commit : ' + JSON.stringify(inventory.baseline.response));
  const ra = await post(appendBody(batch[0], requestId('calendar')));
  check('G1-append-provider-down', 'current', 'append with the provider unreachable refuses 503 before any native write, although its parent route is local',
    ra.status === 503 && ra.json.error === 'project_mapping_validation_unavailable' && (await count('select 1 from public.deliverables')) === before,
    { status: ra.status, error: ra.json.error });
  check('R1-append-without-provider', 'readiness', 'append succeeds with the provider unreachable', ra.status === 201, { status: ra.status, error: ra.json.error });
  inventory.append_batch_cursor = batch[0];
}

/* G2 : response lost after commit: an identical resend replays, no duplicate. */
{
  resetNet('ok');
  const { request_id: rid, batch_id } = inventory.baseline;
  const before = await count(`select 1 from public.deliverables where batch_id='${batch_id}'`);
  const outboxBefore = await count(`select 1 from public.mirror_outbox where client_slug='fixture-client'`);
  const eventsBefore = await count(`select 1 from public.deliverable_events where client_slug='fixture-client'`);
  const r = await post(rootBody('both', rid));
  const after = await count(`select 1 from public.deliverables where batch_id='${batch_id}'`);
  const ids = (r.json.items || []).map(i => i.id).sort();
  const original = (inventory.baseline.response.items || []).map(i => i.id).sort();
  check('G2-root-replay', 'current', 'resending the exact root request after a lost response returns the same native ids and creates nothing new',
    r.status === 201 && r.json.native_committed === true && JSON.stringify(ids) === JSON.stringify(original)
      && after === before && (await count(`select 1 from public.mirror_outbox where client_slug='fixture-client'`)) === outboxBefore,
    { status: r.status, rows_before: before, rows_after: after, same_ids: JSON.stringify(ids) === JSON.stringify(original),
      events_delta: (await count(`select 1 from public.deliverable_events where client_slug='fixture-client'`)) - eventsBefore });
}

/* G2b : the gateway dies between the batch commit and the second child. */
{
  resetNet('ok');
  const rid = requestId();
  let writes = 0;
  hooks.afterRpc = (name, args, result) => {
    if (name === 'production_deliverable_write') {
      writes += 1;
      if (writes === 2) throw new Error('injected: gateway lost after second child committed');
    }
    return result;
  };
  const first = await post(rootBody('both', rid));
  const bat = await rows(`select id from public.batches where name like '%${rid.slice(-4)}'`);
  const partial = await count(`select 1 from public.deliverables where batch_id='${bat[0] && bat[0].id}'`);
  resetHooks();
  net.requests.length = 0;
  const retry = await post(rootBody('both', rid));
  const converged = await count(`select 1 from public.deliverables where batch_id='${bat[0] && bat[0].id}'`);
  check('G2b-partial-commit-converges', 'current', 'a gateway crash after the batch and first child committed leaves a partial native state, and the exact retry converges to one batch + two children',
    first.status >= 500 && partial === 2 && retry.status === 201 && converged === 2
      && (retry.json.items || []).length === 2,
    { first_status: first.status, first_error: first.json.error, rows_after_crash: partial, retry_status: retry.status, rows_after_retry: converged });
  check('G2b-partial-state-visible-to-caller', 'current', 'the crashed request reported failure although the batch and a child were already durable (caller cannot tell partial from nothing)',
    first.json.native_committed !== true && partial === 2, { first_response: first.json, durable_rows: partial });
}

/* G3 : same request id, different intent: refused, never a second row. */
{
  resetNet('ok');
  const { request_id: rid, batch_id } = inventory.baseline;
  const before = await count(`select 1 from public.deliverables where batch_id='${batch_id}'`);
  const changed = rootBody('both', rid);
  changed.items[0].title = 'Video 1 retitled';
  const r = await post(changed);
  check('G3-same-id-different-intent', 'current', 'the same request id carrying a different intent is refused (no silent overwrite, no duplicate)',
    r.status === 409 && (await count(`select 1 from public.deliverables where batch_id='${batch_id}'`)) === before,
    { status: r.status, error: r.json.error });
}

/* G4 : same request id, different actor: refused. */
{
  resetNet('ok');
  const { request_id: rid, batch_id } = inventory.baseline;
  const before = await count(`select 1 from public.deliverables where batch_id='${batch_id}'`);
  const r = await post(rootBody('both', rid), SMM);
  check('G4-same-id-different-actor', 'current', 'a retry of the same request id by a different staff actor is refused 409 idempotency_conflict, not duplicated and not adopted',
    r.status === 409 && r.json.error === 'idempotency_conflict' && (await count(`select 1 from public.deliverables where batch_id='${batch_id}'`)) === before,
    { status: r.status, error: r.json.error });
}

/* G5 : two identical submissions reach the database together. */
{
  resetNet('ok');
  const rid = requestId();
  let arrived = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  hooks.beforeRpc = async name => {
    if (name !== 'production_batch_write') return;
    arrived += 1;
    if (arrived === 2) release();
    await gate;
  };
  const [a, b] = await Promise.all([post(rootBody('both', rid)), post(rootBody('both', rid))]);
  resetHooks();
  const bat = await rows(`select id from public.batches where name like '%${rid.slice(-4)}'`);
  const dels = await count(`select 1 from public.deliverables where batch_id='${bat[0] && bat[0].id}'`);
  const outbox = await count(`select 1 from public.mirror_outbox where entity_id = '${bat[0] && bat[0].id}' or batch_id = '${bat[0] && bat[0].id}'`);
  check('G5-concurrent-identical', 'current', 'two simultaneous identical root submissions held to the same commit instant produce exactly one batch and one row per item',
    bat.length === 1 && dels === 2 && [a.status, b.status].every(s => s === 201),
    { statuses: [a.status, b.status], batches: bat.length, items: dels, outbox_rows: outbox, both_reached_rpc: arrived === 2 });
}

/* G6 : append: local parent route, provider validation still in front; the
   RPC's parent rules are keyed on what the Linear drain records. */
{
  resetNet('ok');
  const cursorFor = async id => (await rows(`select id, to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') as updated_at from public.batches where id='${id}'`))[0];
  const batchId = inventory.baseline.batch_id;
  let cursor = await cursorFor(batchId);
  const rid = requestId('calendar');
  const r = await post(appendBody(cursor, rid, 'video'));
  const rowsNow = await rows(`select id, title, card_id, team from public.deliverables where batch_id='${cursor.id}' order by title`);
  check('G6-append-video-commits', 'current', 'a video-only append to the undrained native batch commits Video 2 through production_intake_append, routed by the local batch-create dependency (no recorded parent map needed)',
    r.status === 201 && r.json.batch_mode === 'existing' && rowsNow.length === 3,
    { status: r.status, error: r.json.error, titles: rowsNow.map(x => x.title), linear_reads: linearCalls() });
  check('G6-append-provider-read', 'current', 'that append still performed a provider project read even though its parent route resolved locally',
    linearCalls() >= 1, { linear_reads: linearCalls() });
  const replay = await post(appendBody(cursor, rid, 'video'));
  check('G6-append-replay', 'current', 'resending the exact append after a lost response replays 200 with the same rows and no new row',
    replay.status === 200 && (await count(`select 1 from public.deliverables where batch_id='${cursor.id}'`)) === 3,
    { status: replay.status, error: replay.json.error, items: (replay.json.items || []).length });
  const stale = await post(appendBody(cursor, requestId('calendar'), 'video'));
  check('G6-append-stale-cursor', 'current', 'a NEW append carrying the pre-commit batch cursor is refused 409 write_conflict',
    stale.status === 409 && stale.json.error === 'write_conflict', { status: stale.status, error: stale.json.error });

  /* Mixed append to a batch Linear never drained: the RPC has no recorded
     parent map, so the graphics row cannot ride the video dependency. */
  cursor = await cursorFor(batchId);
  const mixed = await post(appendBody(cursor, requestId('calendar'), 'both'));
  check('G6-append-mixed-undrained', 'current', 'a Video+Thumbnail append to the native batch is refused 409 batch_parent_mapping_missing because linear_parent_ids is empty until the provider drain records the parent (the browser picker hides such batches for both-mode)',
    mixed.status === 409 && mixed.json.error === 'batch_parent_mapping_missing', { status: mixed.status, error: mixed.json.error });
  check('R6-mixed-append-without-drain', 'readiness', 'a mixed append to a native batch works without a provider-drained parent map',
    mixed.status === 201, { status: mixed.status, error: mixed.json.error });

  /* What the drain would have recorded: the shared parent issue and a written
     intent. After that, the mixed append passes : and needs a provider read
     of the parent issue to do so. */
  await sql(`update public.batches set linear_parent_ids = '{"video":{"linear_issue_id":"lin_issue_fixture_parent","owner_team":"video"},"graphics":{"linear_issue_id":"lin_issue_fixture_parent","owner_team":"video"}}'::jsonb where id='${batchId}'`);
  await sql(`update public.mirror_outbox set status='written', linear_result='{"issue_id":"lin_issue_fixture_parent"}'::jsonb where entity='batch' and entity_id='${batchId}' and operation='create'`);
  cursor = await cursorFor(batchId);
  net.requests.length = 0;
  const drained = await post(appendBody(cursor, requestId('calendar'), 'both'));
  const parentReads = net.requests.filter(q => q.op && /BatchParentScope/.test(q.op)).length;
  check('G6-append-mixed-after-drain', 'current', 'once the drain has recorded the shared parent issue, the same mixed append commits, and it performs a provider read of that parent issue first',
    drained.status === 201 && parentReads >= 1, { status: drained.status, error: drained.json.error, parent_issue_reads: parentReads, linear_reads: linearCalls() });

  /* Terminal parent intent: what a provider cutoff leaves behind. */
  await sql(`update public.mirror_outbox set status='skipped' where entity='batch' and entity_id='${batchId}' and operation='create'`);
  await sql(`update public.batches set linear_parent_ids = null where id='${batchId}'`);
  cursor = await cursorFor(batchId);
  const rt = await post(appendBody(cursor, requestId('calendar'), 'video'));
  check('G6-append-terminal-parent-intent', 'current', 'once the batch-create provider intent is terminal (skipped) and no parent is recorded, even a video-only append is refused 409 batch_parent_mapping_missing although the batch and its children are native',
    rt.status === 409 && rt.json.error === 'batch_parent_mapping_missing', { status: rt.status, error: rt.json.error });
  check('R6-append-after-provider-cutoff', 'readiness', 'append to a native batch whose provider intent is terminal succeeds (post-cutoff appends)',
    rt.status === 201, { status: rt.status, error: rt.json.error });
  await sql(`update public.mirror_outbox set status='pending', linear_result=null where entity='batch' and entity_id='${batchId}' and operation='create'`);
}

/* G7 : public intake: preserved today, and an outage consumes the allowance. */
{
  resetNet('ok');
  const rid = requestId();
  const r = await post(rootBody('video', rid), {});
  const created = await rows(`select created_by from public.deliverables where batch_id='${r.json.batch && r.json.batch.id}'`);
  check('G7-public-intake-preserved', 'current', 'a credential-less submission-surface intake is admitted under the public flag and stamped created_by=public-intake',
    r.status === 201 && created.length === 1 && created[0].created_by === 'public-intake',
    { status: r.status, created_by: created.map(c => c.created_by) });
  const logBefore = await count(`select 1 from public.public_intake_log where client_slug='fixture-client'`);
  resetNet('down');
  const r2 = await post(rootBody('video', requestId()), {});
  const logAfter = await count(`select 1 from public.public_intake_log where client_slug='fixture-client'`);
  check('G7-public-outage-burns-allowance', 'current', 'a public submission refused by the provider outage still consumed one hourly rate-limit slot (logged before validation)',
    r2.status === 503 && logAfter === logBefore + 1, { status: r2.status, log_before: logBefore, log_after: logAfter });
  check('R8-public-outage-allowance', 'readiness', 'a provider-refused public submission does not consume the client allowance',
    logAfter === logBefore, { log_before: logBefore, log_after: logAfter });
  inventory.public_batch_id = r.json.batch && r.json.batch.id;
}

/* G8 : component fill: needs a card, replays exactly, provider in front. */
{
  resetNet('ok');
  const rid = requestId();
  const solo = await post(rootBody('video', rid));
  const sibling = (solo.json.items || [])[0];
  const cardId = sibling && sibling.card_id;
  const noCard = await post(fillBody(cardId, 'graphics', sibling.id));
  check('G8-fill-requires-card', 'current', 'a fill for a native video whose calendar card was never materialized is refused 409 component_fill_card_missing (materialization is a prerequisite, not a consequence)',
    noCard.status === 409 && noCard.json.error === 'component_fill_card_missing', { status: noCard.status, error: noCard.json.error });
  await sql(`insert into public.calendar_posts (client, id, status, video_deliverable_id) values ('fixture-client', '${cardId}', 'In Progress', '${sibling.id}') on conflict do nothing`);
  net.requests.length = 0;
  const fill = await post(fillBody(cardId, 'graphics', sibling.id));
  const comps = await count(`select 1 from public.deliverables where card_id='${cardId}'`);
  check('G8-fill-commits', 'current', 'with the card present the fill commits one graphics component attached to the card',
    fill.status === 200 && fill.json.native_committed === true && comps === 2, { status: fill.status, components: comps, linear_reads: linearCalls() });
  check('G8-fill-provider-read', 'current', 'the fill performed a provider project read before its native write', linearCalls() >= 1, { linear_reads: linearCalls() });
  const again = await post(fillBody(cardId, 'graphics', sibling.id));
  check('G8-fill-replay', 'current', 'the same fill resent after a lost response replays (replay=true) and leaves exactly one component',
    again.status === 200 && again.json.replay === true && (await count(`select 1 from public.deliverables where card_id='${cardId}'`)) === 2,
    { status: again.status, replay: again.json.replay });
  const other = await post(fillBody(cardId, 'graphics', sibling.id), SMM);
  check('G8-fill-other-actor', 'current', 'the same fill by another actor is refused 409 idempotency_conflict; the browser repair arm then links the existing component',
    other.status === 409 && other.json.error === 'idempotency_conflict', { status: other.status, error: other.json.error });
  resetNet('down');
  const solo2 = await post(rootBody('video', requestId()));
  check('G8-fill-provider-down', 'current', 'a fresh fill with the provider unreachable is refused 503 before any native write',
    solo2.status === 503, { status: solo2.status, error: solo2.json.error });
  check('R1-fill-without-provider', 'readiness', 'component fill succeeds with the provider unreachable', solo2.status === 200, { status: solo2.status });
  inventory.fill = { card_id: cardId, sibling_id: sibling.id };

  /* Per-team provider projects (4 of the 36 active clients measured 2026-08-18):
     the fill validates the sibling's dependency against the FILL team's project. */
  resetNet('ok');
  const split = await post(rootBody('video', requestId(), { client_slug: 'fixture-split' }));
  const splitSibling = (split.json.items || [])[0];
  if (!splitSibling) throw new Error('split-project root intake did not commit: ' + JSON.stringify(split.json));
  await sql(`insert into public.calendar_posts (client, id, status, video_deliverable_id) values ('fixture-split', '${splitSibling.card_id}', 'In Progress', '${splitSibling.id}') on conflict do nothing`);
  const splitFill = await post(fillBody(splitSibling.card_id, 'graphics', splitSibling.id, 'fixture-split'));
  check('G8-fill-split-projects', 'current', 'for a client whose teams map to different provider projects, filling the graphics half of a video-only batch is refused 409 batch_parent_mapping_missing by the gateway route lookup (dependency payload.project_id is compared against the fill team, not the sibling team)',
    splitFill.status === 409 && splitFill.json.error === 'batch_parent_mapping_missing', { status: splitFill.status, error: splitFill.json.error });
}

/* G9 : native work exists, card missing: what the server durably knows. */
{
  const orphans = await rows(`select d.id, d.card_id, d.team from public.deliverables d
    where d.client_slug='fixture-client' and d.card_id is not null and d.origin='calendar'
      and not exists (select 1 from public.calendar_posts c where c.client='fixture-client' and c.id = d.card_id)
    order by d.id`);
  const stateColumns = await rows(`select table_name, column_name from information_schema.columns
    where table_schema='public' and (column_name ilike '%materializ%' or column_name ilike '%card_state%' or column_name ilike '%card_pending%')`);
  const stateTables = await rows(`select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%intake%' or table_name ilike '%materializ%' or table_name ilike '%receipt%')`);
  check('G9-orphan-components-detectable', 'current', 'components whose card was never written are DETECTABLE server-side by joining deliverables.card_id against the card table (recovery is derivable)',
    orphans.length >= 1, { orphan_components: orphans.length, sample: orphans.slice(0, 4) });
  check('R3-server-card-pending-state', 'readiness', 'the server records a card-materialization pending state per accepted intake (G3 durable ledger)',
    stateColumns.length > 0, { matching_columns: stateColumns, tables: stateTables.map(t => t.table_name) });
}

/* G10 : outbound live: the gateway itself attempts provider egress after a native intake. */
{
  resetNet('ok');
  await sql(`update public.syncview_runtime_flags set value='{"mode":"live"}'::jsonb where key='linear_outbound_enabled'`);
  const r = await post(rootBody('video', requestId()));
  await Promise.all(background.splice(0));
  check('G10-live-drain-egress', 'current', 'with linear_outbound_enabled=live a native intake schedules a drainer call (provider-intent egress from the gateway request itself)',
    r.status === 201 && drainerCalls() >= 1, { status: r.status, drainer_calls: drainerCalls(), mirror_pending: r.json.mirror_pending });
  await sql(`update public.syncview_runtime_flags set value='{"mode":"off"}'::jsonb where key='linear_outbound_enabled'`);
}

/* G11 : roster members without a provider user id cannot be auto-assigned. */
{
  resetNet('ok');
  await sql(`update public.team_members set linear_user_id = null where team = 'video'`);
  const r = await post(rootBody('video', requestId()));
  check('G11-roster-needs-provider-id', 'current', 'with no provider user id on any video editor, a video intake is refused 409 video_assignee_pool_unavailable (auto-assignee filters on linear_user_id)',
    r.status === 409 && r.json.error === 'video_assignee_pool_unavailable', { status: r.status, error: r.json.error });
  check('R7-native-assignee-catalog', 'readiness', 'auto-assignment works for roster members with no provider user id', r.status === 201, { status: r.status, error: r.json.error });
  await sql(`update public.team_members set linear_user_id = 'lin_user_editor_one' where id='33333333-3333-4333-8333-333333333331'`);
  await sql(`update public.team_members set linear_user_id = 'lin_user_editor_two' where id='33333333-3333-4333-8333-333333333332'`);
}

/* G12 : unmapped client: no provider project on the roster row. */
{
  resetNet('ok');
  const r = await post(rootBody('video', requestId(), { client_slug: 'fixture-unmapped' }));
  check('G12-unmapped-client', 'current', 'a client with no per-team provider project mapping is refused 409 project_mapping_missing (native catalog absent)',
    r.status === 409 && r.json.error === 'project_mapping_missing', { status: r.status, error: r.json.error });
}

/* Durable inventory after all of the above, for the handoff. */
inventory.durable = {
  batches: await count(`select 1 from public.batches where client_slug='fixture-client'`),
  deliverables: await count(`select 1 from public.deliverables where client_slug='fixture-client'`),
  outbox_by_status: await rows(`select status, count(*)::int as n from public.mirror_outbox where client_slug='fixture-client' group by status order by status`),
  events_by_action: await rows(`select action, count(*)::int as n from public.deliverable_events where client_slug='fixture-client' group by action order by action`),
  public_intake_log: await count(`select 1 from public.public_intake_log`),
  cards: await count(`select 1 from public.calendar_posts where client='fixture-client'`),
};

fs.rmSync(scratch, { recursive: true, force: true });
process.stdout.write('\nNIR_RESULT_BEGIN\n' + JSON.stringify({ checks, events, inventory: { durable: inventory.durable } }) + '\nNIR_RESULT_END\n');
