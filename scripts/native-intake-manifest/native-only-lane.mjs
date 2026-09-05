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
const negativeControl = false;
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


const q = value => "'" + String(value).replace(/'/g, "''") + "'";
const j = value => q(JSON.stringify(value)) + '::jsonb';
function ok(label, pass, evidence) { check(label, 'native-intake', label, pass, evidence); }
function reset() { resetHooks(); net.linear = 'ok'; net.requests.length = 0; }
async function flags(video='',graphics='') {
  await sql("update public.syncview_runtime_flags set value=" + j({video:{enabled:!!video,epoch:video||null},graphics:{enabled:!!graphics,epoch:graphics||null}}) + " where key='native_intake_epochs'");
}
async function inventory() { return Promise.all(['production_intake_manifests','batches','deliverables','mirror_outbox'].map(t=>count('select 1 from public.'+t))); }
async function unchanged(before) { return JSON.stringify(before)===JSON.stringify(await inventory()); }
async function receipts(batch) { return rows('select * from public.mirror_outbox where batch_id='+q(batch)); }
function noProvider() { return !net.requests.some(r=>/api.linear.app|linear-outbound/.test(r.url)); }
function appendBody(batch,mode='both') {
  const body=rootBody(mode,requestId()); delete body.batch;
  return {...body,batch_id:batch.id,expected_batch_updated_at:batch.updated_at};
}
function fillBody(batch,item) {
  return {operation:'component_fill',surface:'calendar',client_slug:'fixture-client',
    request_id:requestId('calendar'),card_id:item.card_id,sibling_id:item.id,team:'graphics'};
}
async function card(item) {
 await sql("insert into public.calendar_posts(id,client,status,video_deliverable_id) values("+
  [item.card_id,'fixture-client','draft',item.id].map(q).join(',')+")");
}
try {
  // Disabled lane proves old handler semantics and exact existing fingerprints.
  reset(); const oldBody=rootBody('both',requestId()); const old=await post(oldBody);
  ok('default-disabled-provider-root',old.status===201 && old.json.mirror_pending===true && net.requests.some(r=>/api.linear.app/.test(r.url)),old);
  const oldReceipts=await receipts(old.json.batch?.id);
  ok('provider-receipts-stay-pending',oldReceipts.length===3 && oldReceipts.every(r=>r.status==='pending'));
  await flags('epoch-video-1','epoch-graphics-1');
  reset(); const oldRetry=await post(oldBody);
  ok('old-provider-replay-after-flag-flip',oldRetry.status===201 && oldRetry.json.mirror_pending===true && JSON.stringify(oldReceipts)===JSON.stringify(await receipts(old.json.batch?.id)));
  reset(); net.linear='down'; const oldDown=await post(oldBody);
  ok('old-provider-replay-keeps-provider-unavailable-failure',oldDown.status>=500);

  reset(); net.linear='down'; const nativeBody=rootBody('both',requestId());
  const native=await post(nativeBody);
  ok('native-root-provider-unreachable',native.status===201 && native.json.native_committed && native.json.mirror_pending===false && noProvider(),native);
  const nativeReceipts=await receipts(native.json.batch?.id);
  ok('native-receipts-terminal-at-insertion',nativeReceipts.length===3 && nativeReceipts.every(r=>r.status==='skipped' && r.attempts===0 && r.processed_at && r.linear_result.native_only===true));
  const savedManifest=(await rows('select * from public.production_intake_manifests where request_id='+q(nativeBody.request_id)))[0];
  ok('native-manifest-pins-both-epochs',savedManifest?.native_epochs.video==='epoch-video-1' && savedManifest?.native_epochs.graphics==='epoch-graphics-1');
  await flags(); reset(); net.linear='down'; const retry=await post(nativeBody);
  ok('native-root-replay-after-disable-no-provider',retry.status===201 && retry.json.mirror_pending===false && noProvider());
  ok('native-manifest-and-receipts-immutable',JSON.stringify(savedManifest)==JSON.stringify((await rows('select * from public.production_intake_manifests where request_id='+q(nativeBody.request_id)))[0]) && JSON.stringify(nativeReceipts)===JSON.stringify(await receipts(native.json.batch?.id)));
  const requeue=await runSql("update public.mirror_outbox set status='pending' where id="+nativeReceipts[0]?.id);
  ok('native-receipt-cannot-be-requeued',requeue.status!==0);
  const beforeConflict=await inventory(); const changed=structuredClone(nativeBody); changed.items[0].brief+=' changed';
  const conflict=await post(changed);
  ok('native-conflicting-retry-refused',conflict.status===409 && await unchanged(beforeConflict));

  // Native-only append/fill use the native batch, not a drained provider parent.
  await flags('epoch-video-2','epoch-graphics-2'); reset(); net.linear='down';
  const appendedBody=appendBody(native.json.batch); const appended=await post(appendedBody);
  ok('native-append-without-linear-parent-drain',appended.status===201 && appended.json.mirror_pending===false && noProvider(),appended);
  await flags(); reset(); net.linear='down'; const appendRetry=await post(appendedBody);
  ok('native-append-replay-after-disable',appendRetry.status===200 && appendRetry.json.mirror_pending===false && noProvider(),appendRetry);
  await flags('epoch-video-2','epoch-graphics-2'); reset(); net.linear='down';
  const single=await post(rootBody('video',requestId())); const sibling=single.json.items?.[0];
  await card(sibling); const fill=fillBody(single.json.batch,sibling); const filled=await post(fill);
  ok('native-fill-without-linear-parent-drain',filled.status===200 && filled.json.mirror_pending===false && noProvider(),filled);
  await flags(); reset(); net.linear='down'; const fillRetry=await post(fill);
  ok('native-fill-replay-after-disable',fillRetry.status===200 && fillRetry.json.replay===true && noProvider(),fillRetry);
  // A native parent is never converted into an undrainable provider dependency.
  reset(); const deniedAppend=await post(appendBody(appended.json.batch,'video'));
  ok('provider-append-to-native-only-parent-refused',deniedAppend.status===409,deniedAppend);

  // Lost root response and partial children retain the ORIGINAL complete plan.
  await flags('epoch-video-3','epoch-graphics-3'); reset();
  const lostBody=rootBody('both',requestId());
  hooks.afterRpc=(name,args,result)=>{ if(name==='production_intake_root_begin') throw new Error('synthetic lost committed root response'); return result; };
  const lost=await post(lostBody);
  const lostManifest=(await rows('select * from public.production_intake_manifests where request_id='+q(lostBody.request_id)))[0];
  ok('lost-root-response-is-accepted-evidence',lost.status>=500 && !!lostManifest && await count('select 1 from public.deliverables where batch_id='+q(lostManifest.batch_id))===0);
  await flags(); reset(); net.linear='down'; const recovered=await post(lostBody);
  ok('lost-response-retry-retains-native-epoch-and-completes-children',recovered.status===201 && recovered.json.items?.length===2 && noProvider(),recovered);
  await flags('epoch-video-4','epoch-graphics-4'); reset();
  const partialBody=rootBody('both',requestId()); let writes=0;
  hooks.beforeRpc=name=>{if(name==='production_deliverable_write' && ++writes===2) throw new Error('synthetic child two unavailable');};
  const partial=await post(partialBody);
  const partialManifest=(await rows('select * from public.production_intake_manifests where request_id='+q(partialBody.request_id)))[0];
  ok('missing-child-readiness-stays-red',partial.status>=500 && partialManifest.expected_items.length===2 && await count('select 1 from public.deliverables where batch_id='+q(partialManifest.batch_id))===1);
  await flags('epoch-video-5','epoch-graphics-5'); reset(); net.linear='down'; const partialRetry=await post(partialBody);
  ok('partial-retry-uses-accepted-old-native-epoch',partialRetry.status===201 && (await receipts(partialManifest.batch_id)).every(r=>/epoch-.*-4/.test(r.payload._native_intake_epoch)) && noProvider());
  ok('missing-card-readiness-stays-red',await count('select 1 from public.calendar_posts where video_deliverable_id in (select id from public.deliverables where batch_id='+q(partialManifest.batch_id)+')')===0);

  // All prerequisites are checked before any parent/manifest/child/receipt commit.
  reset(); let before=await inventory();
  hooks.beforeRpc=async name=>{ if(name==='production_intake_root_begin') await flags(); };
  const flipped=await post(rootBody('both',requestId()));
  ok('epoch-flip-between-read-and-admission-zero-native-commit',flipped.status>=400 && await unchanged(before),flipped);
  await flags('epoch-video-6','epoch-graphics-6'); reset(); before=await inventory();
  hooks.beforeRpc=async name=>{if(name==='production_intake_root_begin') await sql("update public.track_b_f27_team_fences set generation=generation+1 where team='graphics'");};
  const fenced=await post(rootBody('both',requestId()));
  ok('second-team-generation-failure-zero-partial-root',fenced.status>=400 && await unchanged(before));
  reset(); before=await inventory();
  await sql("update public.syncview_runtime_flags set value='{}' where key='native_intake_epochs'");
  const badFlag=await post(rootBody('both',requestId()));
  ok('malformed-flag-fails-closed-no-provider-no-commit',badFlag.status>=400 && noProvider() && await unchanged(before));
  await flags('epoch-video-6','epoch-graphics-6'); reset(); before=await inventory();
  hooks.beforeRpc=name=>{if(name==='production_intake_epoch_read') throw new Error('synthetic flag read unavailable');};
  const flagUnavailable=await post(rootBody('both',requestId()));
  ok('flag-read-failure-no-linear-fallback',flagUnavailable.status>=500 && noProvider() && await unchanged(before));
  reset(); before=await inventory(); const unmapped=await post(rootBody('both',requestId(),{client_slug:'fixture-unmapped'}));
  ok('unreviewed-native-project-mapping-zero-partial-commit',unmapped.status===409 && noProvider() && await unchanged(before));

  // Real PostgreSQL request lock, actual concurrent handler requests.
  reset(); net.linear='down'; const sameBody=rootBody('both',requestId());
  const same=await Promise.all([post(sameBody),post(sameBody)]);
  ok('concurrent-identical-native-root',same.every(x=>x.status===201) && new Set(same.map(x=>x.json.batch?.id)).size===1 && noProvider(),same.map(x=>x.status));
  reset(); const raceBody=rootBody('both',requestId()); const raceChanged=structuredClone(raceBody); raceChanged.items[0].brief+=' conflict';
  const race=await Promise.all([post(raceBody),post(raceChanged)]);
  ok('concurrent-conflicting-native-root',race.filter(x=>x.status===201).length===1 && race.filter(x=>x.status===409).length===1,race.map(x=>x.status));

  // Mixed epoch teams: provider-owned parent can support a native child;
  // native-owned parent + provider child is refused atomically and explicitly.
  await flags('','epoch-graphics-7'); reset(); const mixed=await post(rootBody('both',requestId()));
  const mixedRows=await receipts(mixed.json.batch?.id);
  ok('mixed-provider-parent-native-graphics',mixed.status===201 && mixedRows.filter(r=>r.status==='pending').length===2 && mixedRows.filter(r=>r.status==='skipped').length===1,mixed);
  await flags('epoch-video-7',''); reset(); before=await inventory(); const blockedMixed=await post(rootBody('both',requestId()));
  ok('mixed-native-parent-provider-child-zero-commit',blockedMixed.status===409 && await unchanged(before));
  await flags('','epoch-graphics-7');
  await sql("update public.syncview_runtime_flags set value='{\"video\":\"linear\",\"graphics\":\"syncview\"}' where key='prod_authority'");
  reset(); const mixedAuthority=await post(rootBody('both',requestId()));
  ok('mixed-authority-retains-provider-parity',mixedAuthority.status===202 && (await receipts(mixedAuthority.json.batch?.id)).some(r=>r.team==='video' && r.legacy_parity===true));
  await sql("update public.syncview_runtime_flags set value='{\"video\":\"syncview\",\"graphics\":\"syncview\"}' where key='prod_authority'");

  // SQL service-role grants and stale-marker protection, without gateway bypass.
  const anon=await runSql("set role anon; select public.production_native_intake_epochs()");
  ok('epoch-resolution-service-only',anon.status!==0);
  const grants=await runSql("set role service_role; update public.production_intake_manifests set native_epochs='{}'");
  ok('native-provenance-not-direct-service-writable',grants.status!==0);
  // New native fill still requires an existing card, even with no provider.
  await flags('epoch-video-8','epoch-graphics-8'); reset();
  const noCard=await post(rootBody('video',requestId())); before=await inventory();
  const missingCard=await post(fillBody(noCard.json.batch,noCard.json.items[0]));
  ok('native-fill-missing-card-stays-refused',missingCard.status===409 && await unchanged(before),missingCard);

  // Exact repository F27 hold and generation rules execute before receipt
  // terminalization. A terminal status cannot bypass a live write hold.
  reset(); before=await inventory();
  await sql("insert into public.track_b_team_rollbacks(team,expected_authority,prior_outbound,prior_parity,fence_generation,actor) values('graphics','{}','{}','{}',0,'fixture-operator')");
  const held=await post(rootBody('both',requestId()));
  ok('f27-second-team-hold-zero-root-commit',held.status>=400 && await unchanged(before));
  await sql("update public.track_b_team_rollbacks set state='cancelled' where state='open'");
  reset(); before=await inventory();
  const fillRoot=await post(rootBody('video',requestId())); await card(fillRoot.json.items[0]);
  const fillRaceBody=fillBody(fillRoot.json.batch,fillRoot.json.items[0]);
  hooks.beforeRpc=async name=>{if(name==='production_component_fill') await sql("update public.track_b_f27_team_fences set generation=generation+1 where team='graphics'");};
  before=await inventory(); const staleFill=await post(fillRaceBody);
  ok('f27-fill-stale-generation-not-hidden-by-terminal-status',staleFill.status>=400 && await unchanged(before));
  reset(); net.linear='down';
  const fillSqlResults=[];
  let fillArrivals=0, releaseFill;
  const fillBarrier=new Promise(resolve=>{releaseFill=resolve;});
  hooks.beforeRpc=async name=>{if(name==='production_component_fill') {if(++fillArrivals===2) releaseFill(); await fillBarrier;}};
  hooks.afterRpc=(name,args,result)=>{if(name==='production_component_fill') fillSqlResults.push(result.data); return result;};
  const fillRace=await Promise.all([post(fillRaceBody),post(fillRaceBody)]);
  ok('concurrent-identical-fill-real-lock',fillRace.every(x=>x.status===200)
    && fillSqlResults.filter(x=>x.replay===true).length===1 && noProvider()
    && new Set(fillRace.map(x=>x.json.item?.id)).size===1
    && await count('select 1 from public.mirror_outbox where entity_id='+q(fillRace[0].json.item?.id))===1,
    fillRace.map(x=>x.status));
  reset(); const appendRaceBody=appendBody(fillRace[0].json.batch,'video');
  const appendSqlResults=[];
  let appendArrivals=0, releaseAppend;
  const appendBarrier=new Promise(resolve=>{releaseAppend=resolve;});
  hooks.beforeRpc=async name=>{if(name==='production_intake_append') { if(++appendArrivals===2) releaseAppend(); await appendBarrier; }};
  hooks.afterRpc=(name,args,result)=>{if(name==='production_intake_append') appendSqlResults.push(result.data); return result;};
  const appendRace=await Promise.all([post(appendRaceBody),post(appendRaceBody)]);
  // Both gateways can return 201 after their preflight saw no receipt. The SQL
  // result, and exactly one durable item/receipt, prove serialized replay.
  ok('concurrent-identical-append-real-lock',appendRace.every(x=>[200,201].includes(x.status))
    && appendSqlResults.filter(x=>x.replay===true).length===1
    && new Set(appendRace.map(x=>x.json.items?.[0]?.id)).size===1
    && await count('select 1 from public.mirror_outbox where entity_id='+q(appendRace[0].json.items?.[0]?.id))===1,
    appendRace.map(x=>x.status));

  reset(); const lostAppendBody=appendBody(appendRace[0].json.batch,'video');
  hooks.afterRpc=(name,args,result)=>{if(name==='production_intake_append') throw new Error('synthetic lost append response'); return result;};
  const lostAppend=await post(lostAppendBody); await flags(); reset(); net.linear='down';
  const lostAppendRetry=await post(lostAppendBody);
  ok('lost-append-response-disable-replay',lostAppend.status>=500 && lostAppendRetry.status===200 && noProvider(),lostAppendRetry);
  await flags('epoch-video-9','epoch-graphics-9'); reset();
  const lostFillRoot=await post(rootBody('video',requestId())); await card(lostFillRoot.json.items[0]);
  const lostFillBody=fillBody(lostFillRoot.json.batch,lostFillRoot.json.items[0]);
  hooks.afterRpc=(name,args,result)=>{if(name==='production_component_fill') throw new Error('synthetic lost fill response'); return result;};
  const lostFill=await post(lostFillBody); await flags(); reset(); net.linear='down';
  const lostFillRetry=await post(lostFillBody);
  ok('lost-fill-response-disable-replay',lostFill.status>=500 && lostFillRetry.status===200 && lostFillRetry.json.replay===true && noProvider());

  // Old provider append/fill keep their exact stored route/fingerprint after a
  // flag change. The provider checkpoint here is invented local fixture data.
  reset();
  await sql("update public.mirror_outbox set status='written',linear_result='{\"issue_id\":\"fixture-parent\"}' where entity='batch' and entity_id="+q(old.json.batch.id));
  await sql("update public.batches set linear_parent_ids='{\"video\":\"fixture-parent\",\"graphics\":\"fixture-parent\"}' where id="+q(old.json.batch.id));
  const oldBatch=(await rows('select * from public.batches where id='+q(old.json.batch.id)))[0];
  const oldAppendBody=appendBody(oldBatch); const oldAppend=await post(oldAppendBody);
  ok('provider-append-baseline',oldAppend.status===201 && oldAppend.json.mirror_pending===true,oldAppend);
  await flags('epoch-video-10','epoch-graphics-10'); reset();
  const oldAppendRetry=await post(oldAppendBody);
  ok('provider-append-epoch-flip-retains-replay',oldAppendRetry.status===200 && oldAppendRetry.json.mirror_pending===true,oldAppendRetry);
  await flags(); reset();
  const oldFillRoot=await post(rootBody('video',requestId())); await card(oldFillRoot.json.items[0]);
  const oldFillBody=fillBody(oldFillRoot.json.batch,oldFillRoot.json.items[0]);
  const oldFill=await post(oldFillBody);
  ok('provider-fill-baseline',oldFill.status===200 && oldFill.json.mirror_pending===true,oldFill);
  await flags('epoch-video-11','epoch-graphics-11'); reset();
  const oldFillRetry=await post(oldFillBody);
  ok('provider-fill-epoch-flip-retains-replay',oldFillRetry.status===200 && oldFillRetry.json.replay===true && oldFillRetry.json.mirror_pending===true,oldFillRetry);

  // Pre-PR1293 accepted parent with no manifest must remain provider work,
  // even if the only receipt is the old parent and all children are missing.
  await flags(); reset(); const legacyBody=rootBody('both',requestId());
  hooks.beforeRpc=name=>{if(name==='production_deliverable_write') throw new Error('synthetic old child unavailable');};
  await post(legacyBody);
  await sql('delete from public.production_intake_manifests where request_id='+q(legacyBody.request_id));
  await flags('epoch-video-12','epoch-graphics-12'); reset(); const legacyRetry=await post(legacyBody);
  ok('old-unmanifested-partial-root-remains-provider',legacyRetry.status===201 && (await receipts(legacyRetry.json.batch?.id)).every(r=>r.status==='pending' && !r.payload._native_intake_epoch),legacyRetry);
  const promoteProvider=await runSql("update public.mirror_outbox set payload=payload || '{\"_native_intake_epoch\":\"forged-native\"}' where id="+oldReceipts[0].id);
  ok('existing-provider-receipt-cannot-be-converted-to-native',promoteProvider.status!==0);

  reset(); before=await inventory();
  hooks.beforeRpc=async name=>{if(name==='production_intake_root_begin') await sql("delete from public.track_b_f27_team_fences where team='graphics'");};
  const missingFence=await post(rootBody('both',requestId()));
  ok('missing-second-team-fence-zero-partial-root',missingFence.status>=400 && await unchanged(before));
  await sql("insert into public.track_b_f27_team_fences(team,generation,updated_by) values('graphics',0,'fixture')");

  // Simulate a pre-epoch serving closure attempting a missing accepted child.
  // Exact old payload shape must refuse, rather than mint provider work.
  reset(); const staleBody=rootBody('both',requestId()); let staleArgs;
  hooks.beforeRpc=(name,args)=>{if(name==='production_deliverable_write') {staleArgs=structuredClone(args); throw new Error('synthetic stale closure boundary');}};
  await post(staleBody); before=await inventory();
  delete staleArgs.p_event.outbound.payload._native_intake_epoch;
  delete staleArgs.p_event.outbound.payload._native_intake_request;
  const staleChild=await runSql('set role service_role; select to_json(public.production_deliverable_write('+j(staleArgs.p_row)+','+j(staleArgs.p_event)+'));');
  ok('stale-serving-child-cannot-reinterpret-native-acceptance',staleChild.status!==0 && await unchanged(before));
  await flags(); reset(); net.linear='down'; const staleRecovery=await post(staleBody);
  ok('epoch-aware-retry-recovers-stale-serving-refusal',staleRecovery.status===201 && noProvider());

  // Independent review found the deliberate assignment-policy scope limit:
  // an explicitly chosen editor still needs strict provider eligibility. This
  // records a held readiness case; it does not relax that policy to pass intake.
  await flags('epoch-video-13','epoch-graphics-13'); reset(); net.linear='down'; before=await inventory();
  const chosenEditor=rootBody('video',requestId()); chosenEditor.items[0].assignee_id='33333333-3333-4333-8333-333333333331';
  const chosenResult=await post(chosenEditor);
  const chosenHeld=chosenResult.status>=400 && net.requests.some(r=>/api.linear.app/.test(r.url)) && await unchanged(before);
  ok('chosen-editor-provider-dependency-readiness-held',chosenHeld,chosenResult);

  console.log(JSON.stringify({suite:'native-only-intake',passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,
    readiness:{missing_child_materialization:checks.find(c=>c.id==='missing-child-readiness-stays-red')?.pass?'FAIL':'UNPROVEN',
      missing_card_materialization:checks.find(c=>c.id==='missing-card-readiness-stays-red')?.pass?'FAIL':'UNPROVEN',
      chosen_editor_provider_independence:chosenHeld?'FAIL':'UNPROVEN',installed_full_serving:'UNPROVEN'}}));
  if(checks.some(c=>!c.pass)) process.exitCode=1;
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
