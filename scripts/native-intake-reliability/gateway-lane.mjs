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
  check('R2-zero-provider-intents', 'readiness', 'a native intake leaves ZERO pending provider intents in the normal lane of mirror_outbox (the only lane this package exercises; parity lane, inbound and scheduled workers are unproven here)',
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

/* G2b : the gateway is interrupted BEFORE the second child commits. The
   root path writes the batch and each child in separate transactions (one
   RPC each), so this is a boundary the live gateway can genuinely die at. */
{
  resetNet('ok');
  const rid = requestId();
  let writes = 0;
  hooks.beforeRpc = async name => {
    if (name !== 'production_deliverable_write') return;
    writes += 1;
    if (writes === 2) throw new Error('injected: gateway lost before the second child committed');
  };
  const first = await post(rootBody('both', rid));
  resetHooks();
  const bat = await rows(`select id, status from public.batches where name like '%${rid.slice(-4)}'`);
  const batchId = bat[0] && bat[0].id;
  const partialRows = await rows(`select id, team, title, card_id from public.deliverables where batch_id='${batchId}' order by team`);
  const partialOutbox = await rows(`select entity, operation, status, (payload ? 'items') as payload_names_items, (payload ? '_intent_fingerprint') as has_fingerprint from public.mirror_outbox where entity_id='${batchId}' or batch_id='${batchId}' order by id`);
  const partialEvents = await rows(`select action, count(*)::int as n from public.deliverable_events where batch_id='${batchId}' group by action order by action`);
  const appendStyleEvents = await count(`select 1 from public.deliverable_events where batch_id='${batchId}' and action='intake_append'`);
  check('G2b-partial-commit-one-child', 'current', 'a gateway interruption before the second child RPC leaves the batch and EXACTLY ONE child durable (video), and the caller is told the request failed',
    first.status >= 500 && first.json.native_committed !== true && bat.length === 1 && partialRows.length === 1 && partialRows[0].team === 'video',
    { first_status: first.status, first_error: first.json.error, batch_status: bat[0] && bat[0].status, rows: partialRows });
  /* What survives if the browser that made the request is now gone: the
     durable inventory names the batch, one child and their two intents. No
     server-side row carries the requested item set (the batch intent stores
     a fingerprint of it, not the items), and no event records an item count
     on the root path, so the missing thumbnail is not recoverable from the
     server and the half-committed batch is indistinguishable from a
     complete one-item intake. */
  const namesItems = partialOutbox.some(o => o.payload_names_items === true);
  check('G2b-partial-boundary-durable-inventory', 'current', 'at that boundary the server durably holds the batch, one child and two outbox intents (batch + child); nothing server-side names the second item: the batch intent carries only a fingerprint and the root path writes no item-count event, so a browser that lost its job cannot be reconstructed from the server',
    partialOutbox.length === 2 && !namesItems && partialOutbox.every(o => o.has_fingerprint === true) && appendStyleEvents === 0,
    { outbox: partialOutbox, events: partialEvents, append_events: appendStyleEvents });
  check('R3-partial-root-intake-detectable', 'readiness', 'a half-committed root intake is distinguishable server-side from a complete one-item intake (an item inventory or count is recorded with the accepted request)',
    namesItems || appendStyleEvents > 0, { batch_payload_names_items: namesItems, item_count_events: appendStyleEvents });
  net.requests.length = 0;
  const retry = await post(rootBody('both', rid));
  const converged = await rows(`select id, team from public.deliverables where batch_id='${batchId}' order by team`);
  check('G2b-partial-commit-converges', 'current', 'the exact retry (same request id, same payload, from the same browser) converges the partial state to one batch + two children with no duplicate',
    retry.status === 201 && converged.length === 2 && (retry.json.items || []).length === 2 && (await count(`select 1 from public.batches where name like '%${rid.slice(-4)}'`)) === 1,
    { retry_status: retry.status, rows_after_retry: converged.map(r => r.team) });
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
  check('P8-public-outage-allowance', 'unproven', 'whether a provider-refused public attempt should consume the hourly allowance is an owner policy decision (the allowance also protects against repeated rejected attempts); not asserted as a readiness requirement. Observed: it consumes one slot',
    false, { log_before: logBefore, log_after: logAfter });
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
  /* A REAL missing-component fixture for the provider-denied fill: a fresh
     video-only intake (provider up), its card written, and only then the
     provider denied and the fill attempted. */
  resetNet('ok');
  const solo2 = await post(rootBody('video', requestId()));
  const sibling2 = (solo2.json.items || [])[0];
  if (!sibling2) throw new Error('missing-component fixture did not commit: ' + JSON.stringify(solo2.json));
  await sql(`insert into public.calendar_posts (client, id, status, video_deliverable_id) values ('fixture-client', '${sibling2.card_id}', 'In Progress', '${sibling2.id}') on conflict do nothing`);
  const componentsBefore = await count(`select 1 from public.deliverables where card_id='${sibling2.card_id}'`);
  const outboxBefore = await count(`select 1 from public.mirror_outbox where client_slug='fixture-client'`);
  const cardBefore = (await rows(`select video_deliverable_id, graphic_deliverable_id from public.calendar_posts where client='fixture-client' and id='${sibling2.card_id}'`))[0];
  resetNet('down');
  const deniedFill = await post(fillBody(sibling2.card_id, 'graphics', sibling2.id));
  const componentsAfter = await count(`select 1 from public.deliverables where card_id='${sibling2.card_id}'`);
  const cardAfter = (await rows(`select video_deliverable_id, graphic_deliverable_id from public.calendar_posts where client='fixture-client' and id='${sibling2.card_id}'`))[0];
  check('G8-fill-provider-down', 'current', 'a fill on a real half-complete card with the provider unreachable is refused 503 project_mapping_validation_unavailable after exactly one provider request, with no new component, no new outbox intent and the card link untouched',
    deniedFill.status === 503 && deniedFill.json.error === 'project_mapping_validation_unavailable'
      && linearCalls() === 1 && drainerCalls() === 0
      && componentsAfter === componentsBefore && componentsBefore === 1
      && (await count(`select 1 from public.mirror_outbox where client_slug='fixture-client'`)) === outboxBefore
      && JSON.stringify(cardAfter) === JSON.stringify(cardBefore),
    { status: deniedFill.status, error: deniedFill.json.error, linear_requests: linearCalls(), drainer_requests: drainerCalls(),
      components_before: componentsBefore, components_after: componentsAfter, card_before: cardBefore, card_after: cardAfter });
  check('R1-fill-without-provider', 'readiness', 'the same fill, provider unreachable, commits the missing component (200, native_committed) with zero provider requests',
    deniedFill.status === 200 && deniedFill.json.native_committed === true && linearCalls() === 0,
    { status: deniedFill.status, error: deniedFill.json.error, linear_requests: linearCalls() });
  /* R9, behaviourally: does ANY server-side row now reference the refused request? */
  const refusedId = fillBody(sibling2.card_id, 'graphics', sibling2.id).request_id;
  const refusalTraces = await count(`select 1 from (
      select payload::text as t from public.deliverable_events
      union all select dedup_key from public.mirror_outbox
      union all select request_id from public.public_intake_log
    ) x where x.t like '%${refusedId}%'`);
  check('R9-server-side-refusal-receipt', 'readiness', 'a refused fill leaves at least one server-side row referencing its request id (deliverable_events, mirror_outbox or public_intake_log)',
    refusalTraces > 0, { request_id_suffix: refusedId.slice(-16), rows_referencing_request: refusalTraces });
  inventory.fill = { card_id: cardId, sibling_id: sibling.id, denied_card_id: sibling2.card_id };

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
  check('G9-orphan-components-detectable', 'current', 'components whose card was never written are DISCOVERABLE server-side by joining deliverables.card_id against the card table (discoverability only: the join names the card id, title, sort key and deliverable ids, not the order, statuses or any later edits a card would carry)',
    orphans.length >= 1, { orphan_components: orphans.length, sample: orphans.slice(0, 4) });
  /* Behavioural: has anything server-side materialized one of those cards
     during this run? The orphan set was created many requests ago; if a
     server component owned card creation, at least one card row would exist
     by now. Refusal by the one server path that reads cards (G8-fill-requires-card)
     is the same fact from the other side. */
  const materializedByServer = await count(`select 1 from public.calendar_posts c where c.client='fixture-client' and c.id = any(array['${orphans.map(o => o.card_id).join("','")}'])`);
  check('R3-server-materializes-orphan-card', 'readiness', 'a card owed by an accepted intake is written by some server-side component without the submitting browser (observed within this run)',
    orphans.length >= 1 && materializedByServer === orphans.length, { orphan_cards: orphans.length, cards_written_server_side: materializedByServer });
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

/* Requirements this package cannot prove or refute, stated as such. */
check('U2-parity-lane-suppression', 'unproven', 'zero new provider intents in the parity lane (legacy_parity=true rows): no scenario here runs a Linear-authoritative team, so the parity enqueue path was not exercised', false, { exercised: false });
check('U2-inbound-cutoff', 'unproven', 'inbound provider events (linear-inbound) are cut off or harmless under a native epoch: the inbound lane is not run here', false, { exercised: false });
check('U2-scheduled-worker-safety', 'unproven', 'the scheduled drainer and older browser bundles select no terminal-at-insert row: linear-outbound and legacy browser queues are not run here', false, { exercised: false });
check('U6-assignee-override-path', 'unproven', 'an explicit assignee_id override with the provider pool (assertEligibleAssignee, production_assignee_eligibility flag) is not exercised; role/team eligibility checks on that path are unverified here', false, { exercised: false });
check('U7-public-rate-limit-429', 'unproven', 'the public-intake 429 branch (12 per client per hour, 60 total) is not exercised', false, { exercised: false });

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
