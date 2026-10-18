'use strict';
/*
 * Every upload leaves a raw copy on the server before anything is built from it
 * (owner goal 2026-10-18: an upload must never be lost).
 *
 * Source checks pin WHERE the copy is taken (after the caller is accepted and the
 * public rate slot is taken, before any epoch, project or row work) and that a
 * failure to store it can never refuse an upload. Behaviour checks run the real
 * helper functions against a fake database: first receipt, a retry of the same
 * request id, a missing table, secrets stripped, an oversize body, and the
 * outcome written after the answer.
 */
const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('node:module');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
const ROOT = path.join(__dirname, '..');
const edge = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'migrations/2026-10-18-intake-raw-submissions.sql'), 'utf8');

// ---- where the copy is taken ----
const intakeStart = edge.indexOf('async function handleIntakeCreate(');
const rawAt = edge.indexOf('await recordIntakeRaw(', intakeStart);
const rateAt = edge.indexOf('.from("public_intake_log").insert(', intakeStart);
const epochAt = edge.indexOf('const nativeEpochByTeam = await intakeEpochs(', intakeStart);
const projectAt = edge.indexOf('await projectForIntake(', intakeStart);
ok(rawAt > rateAt && rateAt > 0, 'the raw copy is taken after the public rate slot, so an unthrottled stranger cannot fill the table');
ok(rawAt < epochAt && rawAt < projectAt, 'and before the epoch lookup and any row is built from the request');
ok(/await recordIntakeRaw\(supabase, requestId, client\.slug, surface, publicIntake \? "public-intake" : "staff", body, items\.length\)/.test(edge),
  'the whole request body is what is stored');
ok(/intakeRequestId = requestId;\s*const response = await handleIntakeCreate\([^)]*\);\s*await intakeOutcomeFromResponse\(/.test(edge),
  'the answer given back is recorded as the outcome');
ok(/catch \(error\) \{\s*if \(intakeRequestId\) \{\s*await recordIntakeOutcome\(/.test(edge), 'so is a refusal');
ok(/lower\(body\.action\) === "intake_raw_list"/.test(edge), 'staff can list the copies through the gateway');
const listStart = edge.indexOf('async function handleIntakeRawList(');
const listBody = edge.slice(listStart, edge.indexOf('\n}\n', listStart));
ok(/principal\.kind !== "staff" \|\| !\["admin", "smm"\]\.includes\(principal\.keyRole\)/.test(listBody),
  'and only an admin or SMM key may');

// ---- migration ----
ok(/^-- ef-auto-deploy: functions-cope-without-this/m.test(migration), 'the migration says the gateway copes without it');
ok(/revoke all on table public\.intake_raw_submissions from public, anon, authenticated, service_role;/.test(migration),
  'the revoke names all four roles');
ok(/grant select, insert, update on table public\.intake_raw_submissions to service_role;/.test(migration), 'only service_role gets rights back');
ok(/enable row level security/.test(migration), 'row level security is on');
ok(/ROLLBACK[\s\S]*drop table if exists public\.intake_raw_submissions/.test(migration), 'it carries its rollback');

// ---- behaviour ----
function extract(name) {
  let start = edge.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  if (edge.slice(start - 6, start) === 'async ') start -= 6;
  const end = edge.indexOf('\n}\n', start) + 3;
  return edge.slice(start, end);
}
const code = ['intakeRawBody', 'recordIntakeRaw', 'recordIntakeOutcome', 'intakeOutcomeFromResponse']
  .map(extract).join('\n');
const constants = edge.slice(edge.indexOf('const INTAKE_RAW_MAX_CHARS'), edge.indexOf('\n', edge.indexOf('const INTAKE_RAW_MAX_CHARS')) + 1);
const make = new Function('clean', 'parseJson', 'Response', 'console',
  stripTypeScriptTypes(constants + code) + '\nreturn { intakeRawBody, recordIntakeRaw, recordIntakeOutcome, intakeOutcomeFromResponse };');
const quiet = { error() {} };
const lib = make(v => String(v == null ? '' : v).trim(), v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), Response, quiet);

function fakeDb({ missing = false } = {}) {
  const rows = new Map();
  const db = {
    rows,
    from(table) {
      if (table !== 'intake_raw_submissions') throw new Error('unexpected table ' + table);
      return {
        insert: async row => {
          if (missing) return { error: { code: '42P01' } };
          if (rows.has(row.request_id)) return { error: { code: '23505' } };
          rows.set(row.request_id, { attempts: 1, outcome: 'received', ...row }); return { error: null };
        },
        select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: rows.get(id) || null }) }) }),
        update: patch => ({ eq: async (_c, id) => { if (rows.has(id)) Object.assign(rows.get(id), patch); return { error: null }; } }),
      };
    },
  };
  return db;
}

(async () => {
  const body = { operation: 'intake_create', request_id: 'submission:abc', client_slug: 'demo', items: [{ a: 1 }],
    batch: { name: 'x', description: 'links and notes' }, access_token: 'SECRET', apiKey: 'SECRET2' };
  const db = fakeDb();
  await lib.recordIntakeRaw(db, 'submission:abc', 'demo', 'submission', 'public-intake', body, 1);
  const row = db.rows.get('submission:abc');
  ok(row && row.raw_body.batch.description === 'links and notes' && row.client_slug === 'demo' && row.received_as === 'public-intake',
    'first receipt stores the body, client and how it arrived');
  ok(!JSON.stringify(row.raw_body).includes('SECRET'), 'secret-shaped keys are not stored');
  await lib.recordIntakeRaw(db, 'submission:abc', 'demo', 'submission', 'public-intake', body, 1);
  ok(db.rows.size === 1 && db.rows.get('submission:abc').attempts === 2, 'a retry of the same request id is one row, attempts counted');
  await lib.intakeOutcomeFromResponse(db, 'submission:abc', new Response(JSON.stringify({ ok: true, native_committed: true }), { status: 201 }));
  ok(db.rows.get('submission:abc').outcome === 'created', 'a committed answer is recorded as created');
  await lib.intakeOutcomeFromResponse(db, 'submission:abc', new Response(JSON.stringify({ ok: false, error: 'invalid_intake_item' }), { status: 400 }));
  ok(db.rows.get('submission:abc').outcome === 'refused' && db.rows.get('submission:abc').outcome_detail === 'invalid_intake_item', 'a refusal is recorded with its code');
  const gone = fakeDb({ missing: true });
  let threw = false;
  try { await lib.recordIntakeRaw(gone, 'r', 'demo', 'submission', 'staff', body, 1); await lib.recordIntakeOutcome(gone, 'r', 'created', ''); } catch (e) { threw = true; }
  ok(!threw, 'a missing table never throws, so an upload is never refused for it');
  const huge = lib.intakeRawBody({ blob: 'x'.repeat(700000) });
  ok(huge.truncated === true && huge.original_chars > 600000, 'an oversize body is kept truncated and marked, not dropped');
  const exploding = { from() { throw new Error('db down'); } };
  threw = false;
  try { await lib.recordIntakeRaw(exploding, 'r', 'demo', 'submission', 'staff', body, 1); } catch (e) { threw = true; }
  ok(!threw, 'a database that throws never throws out of the copy step');
  if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
  console.log('intake raw copy checks passed');
})();
