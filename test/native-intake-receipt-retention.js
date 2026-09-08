'use strict';
/*
 * Execution proof for migrations/2026-09-08-native-intake-receipt-retention.sql
 * against the REAL public.mirror_outbox on a disposable PostgreSQL 16.
 *
 * It proves the guards AND the reason for them. public.production_intake_epoch_read
 * resolves a REPLAYED intake's lane from the receipt itself, so deleting one does
 * not merely lose history: the same replay then falls through to whatever
 * public.production_native_intake_epochs() says at that moment and silently
 * re-resolves an already accepted round onto the other lane. Group 4 removes the
 * trigger and demonstrates that flip, then restores it and shows the refusal
 * return, so the proof shows the trigger is what stands between the two.
 *
 * Synthetic throughout: the slug, request id, batch id and epochs below are
 * invented for this proof and name no real client, colleague or work.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { bootCluster, MIGRATIONS } = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native intake receipt retention: explicit disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('disposable loopback PostgreSQL required');
// Prevent ambient libpq routing from overriding the explicit local fixture.
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

const COLUMNS = 'op,entity,entity_id,operation,client_slug,team,dedup_key,status,payload,actor,role,test_only,legacy_parity,source_edited_at';
const MARKED_DEDUP = 'write-ui:create:batch:proof-batch:proof-request:video';
const EPOCH_READ = "select public.production_intake_epoch_read('proof-request','proof-batch','fixture-client','proof-key','smm','staff',"
  + `'["video"]'::jsonb,'["${MARKED_DEDUP}"]'::jsonb);`;
const checks = [];
function ok(label, condition) {
  assert.ok(condition, label);
  checks.push(label);
  console.log('  ok  ' + label);
}
function refuses(cluster, sql) {
  try { cluster.exec(sql); } catch (error) { return /native_intake_receipt_retained/.test(error.message); }
  return false;
}
function inventory(cluster) {
  return cluster.exec("select count(*) || '/' || count(*) filter (where coalesce(payload->>'_native_intake_epoch','') <> '')"
    + ' from public.mirror_outbox;', undefined);
}

let cluster;
try {
  cluster = bootCluster();
  for (const file of ['2026-09-05-native-intake-root-manifest.sql', '2026-09-05-native-only-intake.sql',
    '2026-09-08-native-intake-receipt-retention.sql']) cluster.runFile(path.join(MIGRATIONS, file));
  ok('the retention migration applies on top of the native intake chain', true);

  cluster.exec(`update public.syncview_runtime_flags set value =
    '{"video":{"enabled":true,"epoch":"proof-epoch-1"},"graphics":{"enabled":false,"epoch":null}}'::jsonb
    where key = 'native_intake_epochs';`);
  const marked = cluster.exec(`insert into public.mirror_outbox(${COLUMNS}) values('create','batch','proof-batch','create',
    'fixture-client','video','${MARKED_DEDUP}','pending',
    '{"_native_intake_epoch":"proof-epoch-1","_native_intake_request":"proof-request"}'::jsonb,
    'fixture','smm',false,false,now()) returning status || ' ' || (linear_result->>'native_only');`);
  ok('a marked native receipt still inserts terminal', marked.includes('skipped') && marked.includes('true'));
  cluster.exec(`insert into public.mirror_outbox(${COLUMNS}) values('create','batch','proof-provider','create',
    'fixture-client','graphics','write-ui:create:batch:proof-provider:proof-request-2:graphics','pending',
    '{}'::jsonb,'fixture','smm',false,false,now());`);
  const before = inventory(cluster);

  ok('deleting a marked receipt is refused',
    refuses(cluster, "delete from public.mirror_outbox where coalesce(payload->>'_native_intake_epoch','') <> '';"));
  ok('truncating the outbox is refused while a marked receipt exists',
    refuses(cluster, 'truncate public.mirror_outbox;'));
  ok('neither refusal changed the outbox', inventory(cluster) === before);
  cluster.exec("delete from public.mirror_outbox where entity_id = 'proof-provider';");
  ok('an unmarked provider receipt stays deletable', inventory(cluster) !== before);

  cluster.exec(`update public.syncview_runtime_flags set value =
    '{"video":{"enabled":true,"epoch":"proof-epoch-2"},"graphics":{"enabled":false,"epoch":null}}'::jsonb
    where key = 'native_intake_epochs';`);
  ok('the accepted round replays on its own epoch while its receipt survives',
    cluster.exec(EPOCH_READ).includes('proof-epoch-1'));
  cluster.exec('drop trigger zz_native_intake_delete_guard on public.mirror_outbox;');
  cluster.exec("delete from public.mirror_outbox where coalesce(payload->>'_native_intake_epoch','') <> '';");
  ok('WITHOUT the guard the same replay silently re-resolves onto the current flag',
    cluster.exec(EPOCH_READ).includes('proof-epoch-2'));
  cluster.exec('create trigger zz_native_intake_delete_guard before delete on public.mirror_outbox'
    + ' for each row execute function public.production_native_intake_delete_guard();');
  cluster.exec(`insert into public.mirror_outbox(${COLUMNS}) values('create','batch','proof-batch-2','create',
    'fixture-client','video','write-ui:create:batch:proof-batch-2:proof-request-3:video','pending',
    '{"_native_intake_epoch":"proof-epoch-2","_native_intake_request":"proof-request-3"}'::jsonb,
    'fixture','smm',false,false,now());`);
  ok('the restored trigger refuses again',
    refuses(cluster, "delete from public.mirror_outbox where coalesce(payload->>'_native_intake_epoch','') <> '';"));

  console.log(JSON.stringify({ status: 'PASS', passed: checks.length,
    classification: 'EXECUTED_REAL_POSTGRES16_REAL_MIRROR_OUTBOX', provider_attempts: 0,
    limits: ['Synthetic fixture rows inserted directly; the gateway and its authenticated path are not exercised here',
      'Proves marker-scoped retention only: an unmarked provider receipt remains deletable by design'] }));
} finally {
  if (cluster) cluster.stop();
}
