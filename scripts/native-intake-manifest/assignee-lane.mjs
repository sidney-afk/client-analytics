/*
 * ASSIGNEE LANE: native assignee eligibility and selection, executed by the
 * REAL supabase/functions/production-write/index.ts against disposable
 * PostgreSQL with the provider transport DENIED (every api.linear.app and
 * linear-outbound request is recorded and refused in-process).
 *
 * The loader section below is the PR1302 native-only lane's seam, byte for
 * byte, with one substitution: the SQL shim is reached through
 * fault-shim.mjs so that ONE flag read can be made to fail at the handler.
 * Everything after "5. Journeys" is this lane's own.
 *
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
import { faults, resetFaults } from './fault-shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FN_DIR = path.join(ROOT, 'supabase', 'functions', 'production-write');
const INDEX_TS = path.join(FN_DIR, 'index.ts');
const INDEX_HTML = path.join(ROOT, 'index.html');
/* The pure policy module, for readiness readback beside the handler's own answer. */
const policy = await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs')).href);

/* ---------- 1. Load the real handler through the seam ---------- */
function rewriteOnce(source, needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + 1) >= 0) {
    throw new Error('gateway seam does not match production-write/index.ts exactly once: ' + needle);
  }
  return source.replace(needle, replacement);
}
const shimUrl = pathToFileURL(path.join(HERE, 'fault-shim.mjs')).href;
/* NEGATIVE CONTROL: the exact PR1302 head, whose own readiness report records
   chosen-editor provider dependence. Run with ASSIGNEE_LANE_NEGATIVE_CONTROL=1
   the native journeys below must FAIL against it, which is what proves the
   lane observes the handler rather than the fixture. */
const negativeControl = process.env.ASSIGNEE_LANE_NEGATIVE_CONTROL === '1';
let source = negativeControl
  ? execFileSync('git', ['show', '8cb5cba91bc33fb17599b8f2a38625ae07f7743d:supabase/functions/production-write/index.ts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nir-assignee-'));
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
  net.requests.push({ url, op: body && body.query ? String(body.query).slice(0, 80) : null });
  if (url.startsWith('https://docs.google.com/document/d/fixture-')) {
    return new Response('Bright future and calm focus make clear creative plans. '.repeat(30), { status: 200 });
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify([{ videoNumber: 1, title: thumbnailText }]) }] }), { status: 200 });
  }
  if (url.startsWith('https://api.linear.app/')) {
    if (net.linear === 'down') throw new TypeError('fetch failed: provider unreachable');
    /* Provider up for project/parent reads, unreachable for the assignee pool
       only: isolates the eligibility dependency from the project prerequisite
       the provider lane also has. */
    if (net.linear === 'pooldown' && /ProductionWriteAssigneeProviderPool/.test(String(body && body.query || ''))) {
      throw new TypeError('fetch failed: provider pool unreachable');
    }
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
    if (/ProductionWriteAssigneeProviderPool/.test(query)) {
      return new Response(JSON.stringify({ data: { users: {
        nodes: [
          { id: 'lin_user_editor_one', active: true }, { id: 'lin_user_editor_two', active: true },
          { id: 'lin_user_designer', active: true }, { id: 'lin_user_retired', active: false },
        ],
        pageInfo: { hasNextPage: false },
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


const q = value => "'" + String(value).replace(/'/g, "''") + "'";
const j = value => q(JSON.stringify(value)) + '::jsonb';
function ok(label, pass, evidence) { check(label, 'native-assignee', label, pass, evidence); }
function reset() { resetHooks(); resetFaults(); net.linear = 'ok'; net.requests.length = 0; }
async function flags(video='',graphics='') {
  await sql("update public.syncview_runtime_flags set value=" + j({video:{enabled:!!video,epoch:video||null},graphics:{enabled:!!graphics,epoch:graphics||null}}) + " where key='native_intake_epochs'");
}
async function inventory() { return Promise.all(['production_intake_manifests','batches','deliverables','mirror_outbox'].map(t=>count('select 1 from public.'+t))); }
async function unchanged(before) { return JSON.stringify(before)===JSON.stringify(await inventory()); }
async function receipts(batch) { return rows('select * from public.mirror_outbox where batch_id='+q(batch)); }
function noProvider() { return !net.requests.some(r=>/api.linear.app|linear-outbound/.test(r.url)); }
function noLinearApi() { return !net.requests.some(r=>/api.linear.app/.test(r.url)); }
function poolAttempted() { return net.requests.some(r=>/api.linear.app/.test(r.url) && /AssigneeProviderPool/.test(String(r.op||''))); }

/* ---------- 5. Journeys ---------- */
/* Fixture identities are invented (see harness.js). Three more roster rows
   make the native verdicts distinguishable: an active UNMAPPED editor, a
   RETIRED (inactive) mapped editor, and an active SMM who sits on the video
   team but is not a creative. */
const EDITOR_ONE='33333333-3333-4333-8333-333333333331';
const EDITOR_TWO='33333333-3333-4333-8333-333333333332';
const DESIGNER='44444444-4444-4444-8444-444444444441';
const UNMAPPED='55555555-5555-4555-8555-555555555551';
const RETIRED='55555555-5555-4555-8555-555555555552';
const VIDEO_SMM='55555555-5555-4555-8555-555555555553';
const UNKNOWN='66666666-6666-4666-8666-666666666666';
const GRAPHICS_SMM='55555555-5555-4555-8555-555555555554';
await sql(`insert into public.team_members(id, name, role, team, linear_user_id, default_for_team, active) values
  ('${UNMAPPED}', 'Fixture Editor Unmapped', 'editor', 'video', null, false, true),
  ('${RETIRED}', 'Fixture Editor Retired', 'editor', 'video', 'lin_user_retired', false, false),
  ('${VIDEO_SMM}', 'Fixture Video Manager', 'smm', 'video', 'lin_user_video_smm', false, true),
  ('${GRAPHICS_SMM}', 'Fixture Graphics Manager', 'smm', 'graphics', null, false, true)
  on conflict (id) do nothing`);
const ELIGIBILITY_FLAG='production_assignee_eligibility';
async function eligibilityFlag(value) {
  await sql("delete from public.syncview_runtime_flags where key="+q(ELIGIBILITY_FLAG));
  if (value !== undefined) await sql("insert into public.syncview_runtime_flags(key,value) values("+q(ELIGIBILITY_FLAG)+","+j(value)+")");
}
function faultEligibilityFlagRead() {
  faults.selectFails = (table, filters) => table==='syncview_runtime_flags'
    && filters.some(f => f.col==='key' && f.op==='eq' && f.val===ELIGIBILITY_FLAG);
}
async function assignedRows(batchId) { return rows("select id, team, assignee_id, status from public.deliverables where batch_id="+q(batchId)+" order by team, id"); }
async function videoAssignee(result) { const r=await assignedRows(result.json.batch?.id); return (r.find(x=>x.team==='video')||{}).assignee_id||null; }
function chosen(mode, id, overrides={}) { const body=rootBody(mode, requestId(), overrides); body.items.filter(i=>i.team==='video').forEach(i=>{ i.assignee_id=id; }); return body; }
async function openLoad() {
  const load=new Map([EDITOR_ONE,EDITOR_TWO,UNMAPPED].map(id=>[id,0]));
  for (const r of await rows("select assignee_id, count(*)::int as n from public.deliverables where team='video' and status in ('todo','in_progress','tweak') group by 1")) {
    if (load.has(r.assignee_id)) load.set(r.assignee_id, r.n);
  }
  return load;
}
const NAMES={[EDITOR_ONE]:'Fixture Editor One',[EDITOR_TWO]:'Fixture Editor Two',[UNMAPPED]:'Fixture Editor Unmapped'};
function freest(ids, load) { return [...ids].sort((a,b)=>(load.get(a)-load.get(b))||NAMES[a].localeCompare(NAMES[b])||a.localeCompare(b))[0]; }
async function assigneeOp(id, assigneeId) {
  const rid=requestId('production');
  const current=(await rows("select updated_at from public.deliverables where id="+q(id)))[0] || {};
  /* Production writes carry CAS: the row version the browser last read. */
  return { operation:'assignee', entity:'deliverable', surface:'production', client_slug:'fixture-client', id,
    request_id: rid, source_edited_at: stamp(rid), assignee_id: assigneeId, expected_updated_at: current.updated_at };
}
async function graphicsDefaults(arrangement) {
  /* arrangement: { designer: {default, mapped}, smm: {default, mapped} } */
  await sql("update public.team_members set default_for_team="+(arrangement.designer.default?'true':'false')+", linear_user_id="+(arrangement.designer.mapped?"'lin_user_designer'":'null')+" where id="+q(DESIGNER));
  await sql("update public.team_members set default_for_team="+(arrangement.smm.default?'true':'false')+", linear_user_id="+(arrangement.smm.mapped?"'lin_user_graphics_smm'":'null')+" where id="+q(GRAPHICS_SMM));
}
async function readinessNow() {
  return policy.nativeAssigneeCatalogReadiness(await rows("select id, name, role, team, active, default_for_team, linear_user_id from public.team_members"));
}
const nativeJourneys=[];
function nativeOk(label, pass, evidence) { nativeJourneys.push({label, zeroProvider: noProvider()}); ok(label, pass && noProvider(), evidence); }

let before;
try {
  /* ---- Provider lane (both epochs disabled): the pre-existing contract, unchanged ---- */
  reset(); net.linear='down'; before=await inventory();
  const p0=await post(chosen('video', EDITOR_ONE));
  ok('provider-lane-linear-down-refuses-at-project-read-first', p0.status===503 && p0.json.error==='project_mapping_validation_unavailable' && await unchanged(before), p0);
  reset(); net.linear='pooldown'; before=await inventory();
  const p1=await post(chosen('video', EDITOR_ONE));
  ok('provider-chosen-editor-linear-down-refused-zero-commit', p1.status===503 && p1.json.error==='assignee_provider_unavailable' && poolAttempted() && await unchanged(before), p1);
  reset(); const p2=await post(chosen('video', EDITOR_ONE));
  ok('provider-chosen-editor-linear-up-accepted-with-pool-read', p2.status===201 && await videoAssignee(p2)===EDITOR_ONE && poolAttempted(), p2.status);
  reset(); const p2b=await post(chosen('video', EDITOR_TWO));
  ok('provider-chosen-second-editor-accepted', p2b.status===201 && await videoAssignee(p2b)===EDITOR_TWO, p2b.status);
  reset(); before=await inventory(); const p4=await post(chosen('video', UNMAPPED));
  ok('provider-chosen-unmapped-editor-refused-409', p4.status===409 && p4.json.error==='assignee_mapping_unavailable' && await unchanged(before), p4);
  reset(); const p3=await post(rootBody('video', requestId()));
  const p3Assignee=await videoAssignee(p3);
  ok('provider-automatic-excludes-unmapped-editor', p3.status===201 && p3Assignee!==UNMAPPED && [EDITOR_ONE,EDITOR_TWO].includes(p3Assignee) && !poolAttempted(), p3Assignee);
  reset(); net.linear='pooldown'; faultEligibilityFlagRead(); before=await inventory();
  const p5=await post(chosen('video', EDITOR_ONE));
  ok('provider-flag-unreadable-stays-strictest', p5.status===503 && faults.attempted.length===1 && poolAttempted() && await unchanged(before), {status:p5.status, attempted:faults.attempted.length});
  reset(); await eligibilityFlag({provider_mapping_required:false});
  const p6=await post(chosen('video', UNMAPPED));
  ok('provider-flag-retired-drops-provider-requirement-without-pool-read', p6.status===201 && await videoAssignee(p6)===UNMAPPED && !poolAttempted(), p6.status);
  await eligibilityFlag(undefined);
  // Existing provider-era graphics default rule: an unmapped default designer is unavailable.
  await sql("update public.team_members set linear_user_id=null where id="+q(DESIGNER));
  reset(); before=await inventory(); const p7=await post(rootBody('thumbnail', requestId()));
  ok('provider-graphics-unmapped-default-refused-409', p7.status===409 && p7.json.error==='graphics_default_assignee_unavailable' && await unchanged(before), p7);
  await sql("update public.team_members set linear_user_id='lin_user_designer' where id="+q(DESIGNER));

  const preserved=await rows("select id, assignee_id from public.deliverables order by id");

  /* ---- Native lane (server-admitted epochs), provider transport denied throughout ---- */
  await flags('epoch-video-1','epoch-graphics-1');
  reset(); net.linear='down'; const n1Body=chosen('video', EDITOR_ONE); const n1=await post(n1Body);
  const n1Receipts=await receipts(n1.json.batch?.id);
  nativeOk('native-chosen-mapped-editor-accepted-no-provider', n1.status===201 && n1.json.native_committed===true && await videoAssignee(n1)===EDITOR_ONE
    && n1Receipts.length===2 && n1Receipts.every(r=>r.status==='skipped' && r.linear_result?.native_only===true), {status:n1.status, error:n1.json.error});
  reset(); net.linear='down'; const n2=await post(chosen('video', UNMAPPED));
  nativeOk('native-chosen-unmapped-editor-accepted', n2.status===201 && await videoAssignee(n2)===UNMAPPED, {status:n2.status, error:n2.json.error});
  for (const [label, id, status, code] of [
    ['native-inactive-editor-refused', RETIRED, 403, 'assignee_out_of_scope'],
    ['native-role-incompatible-refused', VIDEO_SMM, 403, 'assignee_role_incompatible'],
    ['native-wrong-team-member-refused', DESIGNER, 403, 'assignee_out_of_scope'],
    ['native-unknown-member-refused', UNKNOWN, 403, 'assignee_out_of_scope'],
  ]) {
    reset(); net.linear='down'; before=await inventory(); const r=await post(chosen('video', id));
    nativeOk(label+'-zero-commit', r.status===status && r.json.error===code && await unchanged(before), {status:r.status, error:r.json.error});
  }
  reset(); net.linear='down'; before=await inventory();
  const gBody=rootBody('both', requestId()); gBody.items.filter(i=>i.team==='graphics').forEach(i=>{ i.assignee_id=DESIGNER; });
  const g=await post(gBody);
  nativeOk('native-graphics-override-still-refused-400', g.status===400 && g.json.error==='intake_assignee_override_not_allowed' && await unchanged(before), {status:g.status, error:g.json.error});
  reset(); net.linear='down'; before=await inventory();
  const cBody=rootBody('video', requestId()); cBody.items.push({...cBody.items[0], videoNumber:2, title:'Video 2', card_id:cBody.items[0].card_id.replace(/_1$/,'_2'), sort_key:1, assignee_id:EDITOR_TWO}); cBody.items[0].assignee_id=EDITOR_ONE;
  const c=await post(cBody);
  nativeOk('native-two-editors-one-request-refused-400', c.status===400 && c.json.error==='intake_assignee_override_conflict' && await unchanged(before), {status:c.status, error:c.json.error});

  // Automatic selection on the native lane balances over EVERY active editor.
  reset(); net.linear='down';
  for (let guard=0; guard<12 && freest([EDITOR_ONE,EDITOR_TWO,UNMAPPED], await openLoad())!==UNMAPPED; guard++) {
    const busy=freest([EDITOR_ONE,EDITOR_TWO], await openLoad()); const r=await post(chosen('video', busy));
    if (r.status!==201) break; // the negative control cannot create native rows; the check below records it
  }
  const load=await openLoad();
  const expectAll=freest([EDITOR_ONE,EDITOR_TWO,UNMAPPED], load); const expectMapped=freest([EDITOR_ONE,EDITOR_TWO], load);
  reset(); net.linear='down'; const n8=await post(rootBody('video', requestId()));
  nativeOk('native-automatic-video-balances-over-all-active-editors', n8.status===201 && await videoAssignee(n8)===expectAll && expectAll===UNMAPPED && expectMapped!==expectAll, {picked: await videoAssignee(n8), expectAll, expectMapped, load:[...load.values()]});
  await sql("update public.team_members set linear_user_id=null where id="+q(DESIGNER));
  reset(); net.linear='down'; const n9=await post(rootBody('thumbnail', requestId()));
  const n9Rows=await assignedRows(n9.json.batch?.id);
  nativeOk('native-graphics-unmapped-default-designer-assigned', n9.status===201 && n9Rows.length===1 && n9Rows[0].assignee_id===DESIGNER, {status:n9.status, error:n9.json.error});
  reset(); net.linear='down'; const n9b=await post(rootBody('both', requestId()));
  const n9bRows=await assignedRows(n9b.json.batch?.id);
  nativeOk('native-both-teams-automatic-no-provider', n9b.status===201 && n9bRows.length===2 && n9bRows.every(r=>r.assignee_id) && n9bRows.find(r=>r.team==='graphics').assignee_id===DESIGNER, {status:n9b.status, error:n9b.json.error});
  await sql("update public.team_members set linear_user_id='lin_user_designer' where id="+q(DESIGNER));

  /* ---- Independent review 2026-09-05: automatic graphics defaults, both lanes, same head/base controls ----
     Case A: the SOLE graphics default is an active, unmapped SMM. Native must refuse
     (exact creative role), exactly as PR1302 does; the provider lane refuses too
     (no mapping). Readiness must say not ready.
     Case B: a mapped default designer beside an active unmapped SMM default.
     Native and provider must both assign the designer; readiness must say ready
     with one eligible default. */
  await graphicsDefaults({ designer: { default: false, mapped: true }, smm: { default: true, mapped: false } });
  await flags('epoch-video-11','epoch-graphics-11'); reset(); net.linear='down'; before=await inventory();
  const soleSmmNative=await post(rootBody('thumbnail', requestId()));
  const soleSmmReady=await readinessNow();
  nativeOk('native-sole-unmapped-smm-graphics-default-refused-409-zero-commit', soleSmmNative.status===409 && soleSmmNative.json.error==='graphics_default_assignee_unavailable' && await unchanged(before)
    && soleSmmReady.teams.graphics.ready===false && soleSmmReady.teams.graphics.eligible_defaults===0, {status:soleSmmNative.status, error:soleSmmNative.json.error, readiness:soleSmmReady.teams.graphics});
  await flags(); reset(); before=await inventory(); const soleSmmProvider=await post(rootBody('thumbnail', requestId()));
  ok('provider-sole-unmapped-smm-graphics-default-refused-409-control', soleSmmProvider.status===409 && soleSmmProvider.json.error==='graphics_default_assignee_unavailable' && await unchanged(before), {status:soleSmmProvider.status, error:soleSmmProvider.json.error});
  await graphicsDefaults({ designer: { default: true, mapped: true }, smm: { default: true, mapped: false } });
  await flags('epoch-video-11','epoch-graphics-11'); reset(); net.linear='down';
  const twoDefaultsNative=await post(rootBody('thumbnail', requestId()));
  const twoDefaultsRows=await assignedRows(twoDefaultsNative.json.batch?.id); const twoDefaultsReady=await readinessNow();
  nativeOk('native-designer-default-beside-smm-default-assigns-designer', twoDefaultsNative.status===201 && twoDefaultsRows.length===1 && twoDefaultsRows[0].assignee_id===DESIGNER
    && twoDefaultsReady.teams.graphics.ready===true && twoDefaultsReady.teams.graphics.eligible_defaults===1 && twoDefaultsReady.teams.graphics.defaults===2, {status:twoDefaultsNative.status, error:twoDefaultsNative.json.error, readiness:twoDefaultsReady.teams.graphics});
  await flags(); reset(); const twoDefaultsProvider=await post(rootBody('thumbnail', requestId()));
  const twoDefaultsProviderRows=await assignedRows(twoDefaultsProvider.json.batch?.id);
  ok('provider-designer-default-beside-unmapped-smm-default-assigns-designer-control', twoDefaultsProvider.status===201 && twoDefaultsProviderRows.length===1 && twoDefaultsProviderRows[0].assignee_id===DESIGNER, {status:twoDefaultsProvider.status, error:twoDefaultsProvider.json.error});
  /* Provider automatic contract, ORIGINAL and unchanged by this draft: a mapped
     SMM default is admitted (role was never enforced on that path), the stored
     mapping is required whatever the eligibility flag says, and the flag is not
     read at all. The native lane enforces the creative role instead. */
  await graphicsDefaults({ designer: { default: false, mapped: true }, smm: { default: true, mapped: true } });
  reset(); const mappedSmmProvider=await post(rootBody('thumbnail', requestId()));
  const mappedSmmProviderRows=await assignedRows(mappedSmmProvider.json.batch?.id);
  ok('provider-mapped-smm-graphics-default-admitted-original-contract', mappedSmmProvider.status===201 && mappedSmmProviderRows.length===1 && mappedSmmProviderRows[0].assignee_id===GRAPHICS_SMM, {status:mappedSmmProvider.status, error:mappedSmmProvider.json.error});
  await flags('epoch-video-11','epoch-graphics-11'); reset(); net.linear='down'; before=await inventory();
  const mappedSmmNative=await post(rootBody('thumbnail', requestId()));
  nativeOk('native-mapped-smm-graphics-default-refused-exact-role', mappedSmmNative.status===409 && mappedSmmNative.json.error==='graphics_default_assignee_unavailable' && await unchanged(before), {status:mappedSmmNative.status, error:mappedSmmNative.json.error});
  await graphicsDefaults({ designer: { default: true, mapped: true }, smm: { default: false, mapped: false } });
  await flags(); await eligibilityFlag({provider_mapping_required:false}); reset();
  const retiredAuto=await post(rootBody('video', requestId())); const retiredAutoAssignee=await videoAssignee(retiredAuto);
  ok('provider-automatic-under-retired-flag-still-excludes-unmapped', retiredAuto.status===201 && retiredAutoAssignee!==UNMAPPED && [EDITOR_ONE,EDITOR_TWO].includes(retiredAutoAssignee), {status:retiredAuto.status, picked:retiredAutoAssignee});
  await eligibilityFlag(undefined); reset(); faultEligibilityFlagRead();
  const noFlagAuto=await post(rootBody('both', requestId())); const noFlagRows=await assignedRows(noFlagAuto.json.batch?.id);
  ok('provider-automatic-does-not-read-the-eligibility-flag', noFlagAuto.status===201 && noFlagRows.length===2 && noFlagRows.every(r=>r.assignee_id && r.assignee_id!==UNMAPPED) && faults.attempted.length===0, {status:noFlagAuto.status, flagReads:faults.attempted.length});
  reset();
  // Back to the native lane the following journeys assume.
  await flags('epoch-video-1','epoch-graphics-1'); reset(); net.linear='down';

  // Policy flag states never matter on the native lane, and the flag is not even read.
  for (const [label, value, unreadable] of [
    ['missing', undefined, false], ['malformed', 'garbage', false], ['strict', {provider_mapping_required:true}, false], ['unreadable', undefined, true],
  ]) {
    await eligibilityFlag(value); reset(); net.linear='down'; if (unreadable) faultEligibilityFlagRead();
    const r=await post(chosen('video', EDITOR_TWO)); const auto=await post(rootBody('video', requestId()));
    nativeOk('native-policy-flag-'+label+'-no-provider-no-flag-read', r.status===201 && await videoAssignee(r)===EDITOR_TWO && auto.status===201 && faults.attempted.length===0, {status:r.status, auto:auto.status, flagReads:faults.attempted.length});
  }
  await eligibilityFlag(undefined);

  // Public intake on the native lane: credentialless Submit, automatic assignment.
  reset(); net.linear='down'; const pub=await post(rootBody('video', requestId()), {});
  nativeOk('native-public-intake-automatic-no-provider', pub.status===201 && !!(await videoAssignee(pub)), {status:pub.status, error:pub.json.error});
  reset(); net.linear='down'; const pubChosen=await post(chosen('video', EDITOR_ONE), {});
  ok('public-intake-explicit-editor-observed', pubChosen.status===201 || pubChosen.status>=400, {status:pubChosen.status, error:pubChosen.json.error});
  const publicChoiceStatus=pubChosen.status;

  // Concurrency: two distinct native requests naming the same editor, and one identical pair.
  reset(); net.linear='down';
  const pair=await Promise.all([post(chosen('video', EDITOR_ONE)), post(chosen('video', EDITOR_ONE))]);
  nativeOk('concurrent-distinct-native-chosen-editor-both-accepted', pair.every(x=>x.status===201) && new Set(pair.map(x=>x.json.batch?.id)).size===2, pair.map(x=>x.status));
  reset(); net.linear='down'; const sameBody=chosen('video', EDITOR_TWO);
  const same=await Promise.all([post(sameBody), post(sameBody)]);
  const sameRows=await assignedRows(same[0].json.batch?.id||same[1].json.batch?.id||'none');
  nativeOk('concurrent-identical-native-chosen-editor-one-durable-row', same.every(x=>x.status===201) && new Set(same.map(x=>x.json.batch?.id)).size===1 && sameRows.length===1 && sameRows[0].assignee_id===EDITOR_TWO, same.map(x=>x.status));

  // Replay across later policy and epoch changes keeps the accepted decision.
  const n1Manifest=(await rows('select * from public.production_intake_manifests where request_id='+q(n1Body.request_id)))[0];
  await flags(); await eligibilityFlag({provider_mapping_required:true}); reset(); net.linear='down';
  const replay1=await post(n1Body);
  nativeOk('native-replay-after-epoch-disabled-and-strict-flag', replay1.status===201 && await videoAssignee(replay1)===EDITOR_ONE && replay1.json.batch?.id===n1.json.batch?.id, {status:replay1.status, error:replay1.json.error});
  await flags('epoch-video-9','epoch-graphics-9'); reset(); net.linear='down'; const replay2=await post(n1Body);
  nativeOk('native-replay-after-new-epoch-keeps-original', replay2.status===201 && await videoAssignee(replay2)===EDITOR_ONE, {status:replay2.status});
  const n1ManifestAfter=(await rows('select * from public.production_intake_manifests where request_id='+q(n1Body.request_id)))[0];
  ok('native-manifest-and-receipts-immutable-across-replays', JSON.stringify(n1Manifest)===JSON.stringify(n1ManifestAfter) && JSON.stringify(n1Receipts)===JSON.stringify(await receipts(n1.json.batch?.id))
    && n1Manifest?.expected_items?.[0]?.row?.assignee_id===EDITOR_ONE);
  await eligibilityFlag(undefined);
  // Lost response after the child commit; the retry lands under a disabled epoch.
  await flags('epoch-video-10','epoch-graphics-10'); reset(); net.linear='down'; const lostBody=chosen('video', UNMAPPED);
  hooks.afterRpc=(name, args, result)=>{ if(name==='production_deliverable_write'){ hooks.afterRpc=null; throw new Error('synthetic lost response'); } return result; };
  const lost=await post(lostBody); const lostManifest=(await rows('select * from public.production_intake_manifests where request_id='+q(lostBody.request_id)))[0];
  ok('native-lost-response-leaves-accepted-manifest', lost.status>=500 && !!lostManifest && lostManifest?.native_epochs?.video==='epoch-video-10', {status:lost.status});
  await flags(); reset(); net.linear='down'; const lostRetry=await post(lostBody);
  nativeOk('native-lost-response-retry-completes-with-original-assignee', lostRetry.status===201 && await videoAssignee(lostRetry)===UNMAPPED, {status:lostRetry.status, error:lostRetry.json.error});
  // A replay whose chosen member has since been deactivated: recorded, not relaxed.
  await sql("update public.team_members set active=false where id="+q(EDITOR_ONE));
  reset(); net.linear='down'; const rowsBefore=await assignedRows(n1.json.batch?.id); const deactivated=await post(n1Body);
  const rowsAfter=await assignedRows(n1.json.batch?.id);
  nativeOk('native-replay-after-member-deactivated-refused-rows-retained', deactivated.status===403 && JSON.stringify(rowsBefore)===JSON.stringify(rowsAfter), {status:deactivated.status, error:deactivated.json.error});
  await sql("update public.team_members set active=true where id="+q(EDITOR_ONE));
  const replayAfterDeactivation=deactivated.status;

  /* ---- SyncLinear assignee operation on an existing native row (provider lane by design) ---- */
  const targetRow=(await assignedRows(n1.json.batch?.id)).find(r=>r.team==='video'); const target=targetRow ? targetRow.id : 'missing-native-row';
  const rowOf=async ()=>(await assignedRows(n1.json.batch?.id)).find(r=>r.id===target) || {};
  reset(); net.linear='down'; const opDown=await post(await assigneeOp(target, EDITOR_TWO));
  ok('assignee-op-nonnull-linear-down-refused-provider-dependency-remains', opDown.status===503 && opDown.json.error==='assignee_provider_unavailable' && (await rowOf()).assignee_id===EDITOR_ONE, {status:opDown.status, error:opDown.json.error});
  reset(); net.linear='down'; const unassign=await post(await assigneeOp(target, ''));
  const unassignedRow=await rowOf();
  ok('assignee-op-null-unassign-no-linear-api-call', unassign.status===200 && unassignedRow.assignee_id===null && noLinearApi() && faults.attempted.length===0, {status:unassign.status, error:unassign.json.error, drainAttempts:net.requests.filter(r=>/linear-outbound/.test(r.url)).length});
  const unassignDrainAttempts=net.requests.filter(r=>/linear-outbound/.test(r.url)).length;
  reset(); net.linear='down'; const reassignDown=await post(await assigneeOp(target, EDITOR_ONE));
  ok('assignee-op-reassign-after-unassign-linear-down-still-refused', reassignDown.status===503, {status:reassignDown.status});
  reset(); await eligibilityFlag({provider_mapping_required:false}); net.linear='down'; const reassignRetired=await post(await assigneeOp(target, EDITOR_ONE));
  ok('assignee-op-retired-flag-reassigns-without-pool-read', reassignRetired.status===200 && !poolAttempted() && (await rowOf()).assignee_id===EDITOR_ONE, {status:reassignRetired.status, error:reassignRetired.json.error});
  await eligibilityFlag(undefined);

  /* ---- Existing assigned work is preserved by every journey above ---- */
  const preservedAfter=await rows("select id, assignee_id from public.deliverables where id in ("+preserved.map(r=>q(r.id)).join(',')+") order by id");
  ok('existing-provider-era-assignments-preserved', JSON.stringify(preserved)===JSON.stringify(preservedAfter), {rows:preserved.length});
  ok('every-native-journey-made-zero-provider-requests', nativeJourneys.length>0 && nativeJourneys.every(j=>j.zeroProvider), nativeJourneys.filter(j=>!j.zeroProvider).map(j=>j.label));

  console.log(JSON.stringify({suite:'native-assignee-eligibility', negative_control: negativeControl,
    passed:checks.filter(c=>c.pass).length, failed:checks.filter(c=>!c.pass).length,
    native_journeys: nativeJourneys.length,
    readiness:{
      chosen_editor_provider_independence: ['native-chosen-mapped-editor-accepted-no-provider','native-chosen-unmapped-editor-accepted','native-policy-flag-unreadable-no-provider-no-flag-read'].every(id=>checks.find(c=>c.id===id)?.pass)?'PASS':'FAIL',
      automatic_assignment_provider_independence: ['native-automatic-video-balances-over-all-active-editors','native-graphics-unmapped-default-designer-assigned','native-public-intake-automatic-no-provider'].every(id=>checks.find(c=>c.id===id)?.pass)?'PASS':'FAIL',
      native_automatic_exact_role_contract: ['native-sole-unmapped-smm-graphics-default-refused-409-zero-commit','native-designer-default-beside-smm-default-assigns-designer','native-mapped-smm-graphics-default-refused-exact-role'].every(id=>checks.find(c=>c.id===id)?.pass)?'PASS':'FAIL',
      provider_automatic_original_contract: ['provider-mapped-smm-graphics-default-admitted-original-contract','provider-automatic-under-retired-flag-still-excludes-unmapped','provider-automatic-does-not-read-the-eligibility-flag'].every(id=>checks.find(c=>c.id===id)?.pass)?'PASS':'FAIL',
      null_unassign_linear_api_independence: checks.find(c=>c.id==='assignee-op-null-unassign-no-linear-api-call')?.pass?'PASS':'FAIL',
      synclinear_nonnull_assignee_op: 'PROVIDER_LANE (not in this slice)',
      unassign_drain_attempts: unassignDrainAttempts,
      public_intake_explicit_editor_status: publicChoiceStatus,
      replay_after_member_deactivation_status: replayAfterDeactivation,
      installed_full_serving:'UNPROVEN'}}));
  if(checks.some(c=>!c.pass)) process.exitCode=1;
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
