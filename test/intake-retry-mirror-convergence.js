'use strict';
/*
 * An interrupted Submit-tab intake must CONVERGE on retry, not conflict.
 *
 * THE INCIDENT THIS GUARDS (2026-08-21). A 16-video "video + thumbnail"
 * submission died mid-write after 21 of 32 child rows. The queued outbox
 * drains still built every Linear issue, and the B1 mirror then materialized
 * the missing rows FROM Linear -- reusing the intake's deterministic ids (per
 * b1-native-row-id-reuse) but stamping its own batch and origin=manual.
 * ensureDeliverable treated batch_id and origin as identity, so every retry
 * answered 409 intake_id_conflict, and after two of those the browser
 * discarded the saved job. Nothing was lost, but nothing could resume either:
 * 33 correct rows sat split across two batches with zero calendar cards, and
 * an operator had to stitch them together by hand.
 *
 * The fix, pinned here by EXECUTING the deployed source:
 *   1. ensureDeliverable: a deterministic-id match whose only drift is
 *      batch_id/origin AND whose row was written by linear-backfill is the
 *      mirror having won the race -- adopt the row, repoint it into the
 *      planned batch, restore origin, and record the displaced batch. All
 *      other drift stays a hard 409.
 *   2. reclaimMirrorBatches: the mirror's leftover batch shell -- typically
 *      holding only the parent issue's mirror row plus a parent map that
 *      would recreate the 2026-08-20 duplicate-batch picker trap -- gets its
 *      parent row adopted and, once empty, is archived. Never deleted.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.INTAKE_RETRY_SRC
  || path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts');
const source = fs.readFileSync(SRC, 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Lift the REAL functions out of the deployed source and RUN them. Types are
   stripped only from signatures and casts; every body statement is verbatim. */
function grab(name, text) {
  let i = text.indexOf('async function ' + name);
  if (i < 0) i = text.indexOf('function ' + name);
  if (i < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') { depth++; seen = true; }
    else if (text[j] === '}') { depth--; if (seen && depth === 0) return text.slice(i, j + 1); }
  }
  throw new Error('unbalanced function: ' + name);
}
function stripTypes(code) {
  return code
    .replace(/: SupabaseClient/g, '')
    .replace(/\?: Set<string>/g, '')
    .replace(/: Set<string>/g, '')
    .replace(/: JsonMap/g, '')
    .replace(/: string/g, '')
    .replace(/: boolean/g, '')
    .replace(/: Promise<JsonMap>/g, '')
    .replace(/: Promise<void>/g, '')
    .replace(/ as JsonMap/g, '');
}

const clean = value => value == null ? '' : String(value).trim();
const normalizeTeam = value => clean(value).toLowerCase();
const parseJson = value => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; }
  catch (e) { return {}; }
};
class GatewayError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/* A tiny PostgREST-shaped fake: from().select().eq().maybeSingle(), the
   awaited count builder, and update().eq().in() -- enough to execute both
   functions against in-memory tables and record every write. */
function fakeSupabase(state) {
  const log = { updates: [] };
  function exec(q) {
    const table = state[q.table] || [];
    const match = row => q.eqs.every(pair => clean(row[pair[0]]) === clean(pair[1]))
      && (!q.inClause || q.inClause.values.map(String).includes(String(row[q.inClause.col])));
    if (q.op === 'select-single') return { data: table.find(match) || null, error: null };
    if (q.op === 'select-count') return { count: table.filter(match).length, error: null };
    if (q.op === 'update') {
      const hit = table.filter(match);
      hit.forEach(row => Object.assign(row, q.patch));
      log.updates.push({ table: q.table, patch: q.patch, matched: hit.length });
      return { data: null, error: null };
    }
    throw new Error('fake query never executed an operation');
  }
  const client = {
    from(table) {
      const q = { table, eqs: [], inClause: null, op: 'select', patch: null };
      const builder = {
        select(_cols, opts) { q.op = opts && opts.count ? 'select-count' : 'select'; return builder; },
        update(patch) { q.op = 'update'; q.patch = patch; return builder; },
        eq(col, val) { q.eqs.push([col, val]); return builder; },
        in(col, values) { q.inClause = { col, values }; return builder; },
        maybeSingle() { q.op = 'select-single'; return Promise.resolve(exec(q)); },
        then(resolve, reject) { return Promise.resolve(exec(q)).then(resolve, reject); },
      };
      return builder;
    },
  };
  return { client, log };
}

const rpcCalls = [];
async function rpc(_supabase, name, args) {
  rpcCalls.push({ name, args });
  return args.p_row;
}

const sandbox = { clean, normalizeTeam, parseJson, GatewayError, rpc, console, Promise, Object };
vm.createContext(sandbox);
const ensureDeliverable = vm.runInContext('(' + stripTypes(grab('ensureDeliverable', source)) + ')', sandbox);
const reclaimMirrorBatches = vm.runInContext('(' + stripTypes(grab('reclaimMirrorBatches', source)) + ')', sandbox);
const intakeExistingRowConflict = vm.runInContext(
  '(' + stripTypes(grab('intakeExistingRowConflict', source).replace(/: JsonMap \| undefined/g, '')) + ')', sandbox);

const PLAN = {
  id: 'del_11111111-2222-4333-8444-555555555555',
  client_slug: 'clientx', team: 'video', batch_id: 'bat_keep',
  title: 'Video 1', origin: 'calendar', card_id: '', sort_key: 3,
};
const EVENT = { source: 'ui' };

function mirrorRow(overrides) {
  return Object.assign({
    id: PLAN.id, client_slug: 'clientx', team: 'video',
    batch_id: 'b1_b_stale', title: 'Video 1', origin: 'manual',
    card_id: null, created_by: 'linear-backfill', status: 'todo',
  }, overrides || {});
}

(async () => {
  // 1. Absent row: the insert path is untouched.
  rpcCalls.length = 0;
  let db = fakeSupabase({ deliverables: [] });
  let written = await ensureDeliverable(db.client, PLAN, EVENT, 'dedup-1', false, new Set());
  ok(rpcCalls.length === 1 && rpcCalls[0].args.p_row === PLAN,
    'absent row still inserts the planned row through the RPC');
  ok(written && written.id === PLAN.id, 'insert path returns the written row');

  // 2. Identical existing row: idempotent rewrite of the stored row.
  rpcCalls.length = 0;
  const identical = mirrorRow({ batch_id: 'bat_keep', origin: 'calendar', created_by: 'member:abc' });
  db = fakeSupabase({ deliverables: [identical] });
  await ensureDeliverable(db.client, PLAN, EVENT, 'dedup-2', false, new Set());
  ok(rpcCalls.length === 1 && rpcCalls[0].args.p_row === identical,
    'identical existing row is re-written as stored, not re-planned');

  // 3. THE FIX: mirror-materialized row (batch+origin drift, linear-backfill)
  //    converges instead of conflicting, and records the displaced batch.
  rpcCalls.length = 0;
  const displaced = new Set();
  db = fakeSupabase({ deliverables: [mirrorRow()] });
  written = await ensureDeliverable(db.client, PLAN, EVENT, 'dedup-3', false, displaced);
  ok(rpcCalls.length === 1, 'mirror drift reaches the RPC instead of throwing');
  const adopted = rpcCalls[0] && rpcCalls[0].args.p_row || {};
  ok(adopted.id === PLAN.id && adopted.batch_id === 'bat_keep' && adopted.origin === 'calendar',
    'mirror row is adopted: repointed to the planned batch with intake origin');
  ok(adopted.sort_key === 3,
    'adoption restores the plan-owned sort_key the mirror never writes');
  ok(adopted.created_by === 'linear-backfill' && adopted.status === 'todo',
    'adoption keeps every other mirror field verbatim');
  ok(displaced.has('b1_b_stale') && displaced.size === 1,
    'the displaced mirror batch is recorded for reclaim');

  // 4. The same drift on a row the gateway itself wrote stays a hard conflict.
  rpcCalls.length = 0;
  db = fakeSupabase({ deliverables: [mirrorRow({ created_by: 'member:821e' })] });
  let threw = null;
  try { await ensureDeliverable(db.client, PLAN, EVENT, 'dedup-4', false, new Set()); }
  catch (error) { threw = error; }
  ok(threw && threw.code === 'intake_id_conflict' && threw.status === 409,
    'batch/origin drift without the mirror actor still answers 409 intake_id_conflict');
  ok(rpcCalls.length === 0, 'the hard conflict never reaches the RPC');

  // 5. Identity fields stay identity even for the mirror actor.
  for (const drift of [{ title: 'Video 2' }, { client_slug: 'other' }, { team: 'graphics' }, { card_id: 'p_x' }]) {
    threw = null;
    db = fakeSupabase({ deliverables: [mirrorRow(drift)] });
    try { await ensureDeliverable(db.client, PLAN, EVENT, 'dedup-5', false, new Set()); }
    catch (error) { threw = error; }
    ok(threw && threw.code === 'intake_id_conflict',
      'mirror row with ' + Object.keys(drift)[0] + ' drift still conflicts');
  }

  // 6. Replay short-circuits before any RPC, exactly as before.
  rpcCalls.length = 0;
  const replayRow = mirrorRow({ batch_id: 'bat_keep', origin: 'calendar', created_by: 'member:abc' });
  db = fakeSupabase({ deliverables: [replayRow] });
  written = await ensureDeliverable(db.client, PLAN, EVENT, 'dedup-6', true, new Set());
  ok(rpcCalls.length === 0 && written === replayRow, 'replay returns the stored row without an RPC');

  // 7. reclaimMirrorBatches: parent mirror row adopted, emptied shell archived.
  const parentRow = {
    id: 'b1_d_parent', batch_id: 'b1_b_stale', created_by: 'linear-backfill',
    linear_issue_uuid: 'uuid-parent',
  };
  let state = {
    batches: [
      { id: 'b1_b_stale', client_slug: 'clientx', created_by: 'linear-backfill', status: 'active' },
      { id: 'bat_keep', client_slug: 'clientx', linear_parent_ids: { video: { uuid: 'uuid-parent' } } },
    ],
    deliverables: [parentRow],
  };
  db = fakeSupabase(state);
  await reclaimMirrorBatches(db.client, new Set(['b1_b_stale']), 'bat_keep', 'clientx');
  ok(parentRow.batch_id === 'bat_keep', 'the parent issue mirror row is adopted into the intake batch');
  const archived = db.log.updates.find(u => u.table === 'batches' && u.patch.status === 'archived');
  ok(!!archived && state.batches[0].status === 'archived',
    'the emptied mirror shell is archived, not deleted');
  ok(archived && JSON.stringify(archived.patch.linear_parent_ids) === '{}',
    'the archived shell loses its parent map so the picker trap dies with it');

  // 8. A batch the mirror did not create is never touched.
  state = {
    batches: [
      { id: 'b1_b_stale', client_slug: 'clientx', created_by: 'member:821e', status: 'active' },
      { id: 'bat_keep', client_slug: 'clientx', linear_parent_ids: {} },
    ],
    deliverables: [],
  };
  db = fakeSupabase(state);
  await reclaimMirrorBatches(db.client, new Set(['b1_b_stale']), 'bat_keep', 'clientx');
  ok(db.log.updates.length === 0 && state.batches[0].status === 'active',
    'a human-created batch with the same shape is left alone');

  // 9. A shell that still holds unrelated rows is not archived.
  const strayRow = { id: 'del_other', batch_id: 'b1_b_stale', created_by: 'linear-backfill', linear_issue_uuid: 'uuid-other' };
  state = {
    batches: [
      { id: 'b1_b_stale', client_slug: 'clientx', created_by: 'linear-backfill', status: 'active' },
      { id: 'bat_keep', client_slug: 'clientx', linear_parent_ids: { video: { uuid: 'uuid-parent' } } },
    ],
    deliverables: [strayRow],
  };
  db = fakeSupabase(state);
  await reclaimMirrorBatches(db.client, new Set(['b1_b_stale']), 'bat_keep', 'clientx');
  ok(state.batches[0].status === 'active' && strayRow.batch_id === 'b1_b_stale',
    'a shell still holding a non-parent row keeps its rows and stays active');

  // 10. The PLANNING-LOOP pre-check. Review of the first cut proved the
  //     convergence unreachable: the loop's own strict comparison 409'd on the
  //     same drift before ensureDeliverable ever ran. Execute the hoisted
  //     check with incident-shaped rows.
  const planRow = {
    client_slug: 'clientx', team: 'video', title: 'Video 1', card_id: null,
    batch_id: 'bat_keep', status: 'todo', assignee_id: 'ed-1',
    due_date: '2026-08-28', origin: 'calendar', sort_key: 3, priority: null,
  };
  ok(intakeExistingRowConflict(undefined, planRow) === false, 'pre-check: absent row is no conflict');
  ok(intakeExistingRowConflict(Object.assign({}, planRow, { created_by: 'member:x' }), planRow) === false,
    'pre-check: an identical prior-attempt row resumes');
  ok(intakeExistingRowConflict(Object.assign({}, planRow, { created_by: 'member:x', batch_id: 'bat_other' }), planRow) === true,
    'pre-check: batch drift on a gateway-written row stays a hard conflict');
  const incidentMirror = Object.assign({}, planRow, {
    created_by: 'linear-backfill', batch_id: 'b1_b_stale', origin: 'manual',
    sort_key: null, status: 'in_progress', assignee_id: 'ed-2', due_date: '2026-08-29',
  });
  ok(intakeExistingRowConflict(incidentMirror, planRow) === false,
    'pre-check: the incident-shaped mirror row is resumable, not a 409');
  ok(intakeExistingRowConflict(Object.assign({}, incidentMirror, { title: 'Video 2' }), planRow) === true,
    'pre-check: title drift conflicts even for the mirror actor');
  ok(intakeExistingRowConflict(Object.assign({}, incidentMirror, { card_id: 'p_x' }), planRow) === true,
    'pre-check: card linkage drift conflicts even for the mirror actor');
  ok(/const existing = existingById\.get\(deliverableIds\[index\]\);\s*\n\s*if \(intakeExistingRowConflict\(existing, row\)\) \{/.test(source),
    'the planning loop actually calls the hoisted pre-check');

  // 11. The USE is wired: the intake loop feeds the displaced set into the
  //     helper and sweeps it after the targeted drains. A definition alone
  //     proved mutable twice before; pin the call sites.
  ok(/ensureDeliverable\(\s*supabase, row, childEvent, childDedup, planned\.child_replay === true, displacedBatchIds,\s*\)/.test(source),
    'the intake loop passes displacedBatchIds into ensureDeliverable');
  ok(/if \(displacedBatchIds\.size\) \{[\s\S]{0,300}?await reclaimMirrorBatches\(supabase, displacedBatchIds, batchId, clientSlug\);/.test(source),
    'the intake handler sweeps displaced batches through reclaimMirrorBatches');

  if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
  console.log('\nall green');
})().catch(error => { console.error('FAIL  harness: ' + (error && error.message)); process.exit(1); });
