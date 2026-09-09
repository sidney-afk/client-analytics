'use strict';
/*
 * Actual PostgreSQL proof for the event-assignee migration. It uses the F63
 * disposable native-intake fixture only and invented IDs. This proves the
 * database behavior, not a deployed schema or a privileged-SQL boundary.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { bootCluster, MIGRATIONS } = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP editors event-assignee SQL proof: explicit disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('disposable loopback PostgreSQL required');
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

const A = '00000000-0000-4000-8000-000000000101';
const B = '00000000-0000-4000-8000-000000000102';
const EVENT = 'event-assignee-proof';
const checks = [];
function ok(label, condition) {
  assert.ok(condition, label);
  checks.push(label);
  console.log('  ok  ' + label);
}
function json(value) { return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`; }
function last(cluster) {
  return JSON.parse(cluster.run('', null, { tuplesOnly: true, sql: `
    select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
    from public.deliverable_events e where e.deliverable_id = '${EVENT}';` }).trim()).at(-1);
}
function refuses(cluster, sql, code) {
  try { cluster.exec(sql); } catch (error) { return String(error.message).includes(code); }
  return false;
}
function write(cluster, row, event) {
  cluster.exec(`select public.deliverable_write(${json(row)}, ${json(event)});`);
  return last(cluster);
}

let cluster;
try {
  cluster = bootCluster();
  cluster.runFile(path.join(MIGRATIONS, '2026-09-09-editors-event-assignee.sql'));
  ok('the exact event-assignee migration applies on the F63 disposable native schema', true);

  cluster.exec(`insert into public.deliverables(id,client_slug,team,kind,title,status,assignee_id)
    values ('${EVENT}','fixture-client','video','video','Synthetic event owner','todo','${A}'::uuid);`);
  let row = write(cluster, { id: EVENT, status: 'in_progress' }, { action: 'status_change', source: 'ui' });
  ok(row.event_assignee_id === A && row.event_assignee_attribution === 'native_transaction',
    'a native status change snapshots the transaction-current assignee');

  row = write(cluster, { id: EVENT, status: 'smm_approval', assignee_id: B }, { action: 'status_change', source: 'ui' });
  ok(row.event_assignee_id === B && row.event_assignee_attribution === 'native_transaction',
    'the next status event follows the new current owner rather than preserving the earlier owner');

  row = write(cluster, { id: EVENT, status: 'kasper_approval' }, {
    action: 'status_change', source: 'ui', source_event_at: '2001-02-03T04:05:06.000Z'
  });
  ok(row.event_assignee_id === null && row.event_assignee_attribution === 'unknown'
    && Date.parse(row.ts) > Date.parse('2020-01-01T00:00:00.000Z'),
  'source_event_at disqualifies owner proof while preserving the original arrival-time event.ts behavior');

  row = write(cluster, { id: EVENT, status: 'client_approval' }, {
    action: 'status_change', source: 'ui', ts: '2002-03-04T05:06:07.000Z'
  });
  ok(row.event_assignee_id === null && row.event_assignee_attribution === 'unknown'
    && row.ts === '2002-03-04T05:06:07+00:00',
  'an explicit source timestamp remains unknown and keeps the caller-provided ledger timestamp');

  row = write(cluster, { id: EVENT, status: 'tweak', assignee_id: '' }, { action: 'status_change', source: 'ui' });
  ok(row.event_assignee_id === null && row.event_assignee_attribution === 'unassigned',
    'a native status change with no current assignee is explicitly unassigned, not unknown or credited');

  ok(refuses(cluster, `update public.deliverable_events set event_assignee_attribution = 'unknown'
    where deliverable_id = '${EVENT}' and event_assignee_attribution = 'native_transaction';`, 'event_assignee_attribution_immutable'),
  'ordinary UPDATE cannot rewrite an event owner or attribution state');
  ok(refuses(cluster, `insert into public.deliverable_events(deliverable_id,client_slug,action,event_assignee_id,event_assignee_attribution)
    values ('ordinary-fake','fixture-client','status_change','${A}'::uuid,'native_transaction');`, 'event_assignee_server_stamp_required'),
  'an ordinary direct ledger insert cannot claim a native transaction owner without the protocol stamp');

  // This is a limitation proof, not a permission to do it: a role that can run
  // arbitrary SQL already controls the ledger and can set the custom GUCs.
  cluster.exec(`begin;
    select set_config('app.event_assignee_stamp','native-status-v1',true);
    select set_config('app.event_assignee_id','${A}',true);
    select set_config('app.event_assignee_attribution','native_transaction',true);
    insert into public.deliverable_events(deliverable_id,client_slug,action)
      values ('privileged-protocol-limit','fixture-client','status_change');
    commit;`);
  const privileged = JSON.parse(cluster.run('', null, { tuplesOnly: true, sql: `
    select to_jsonb(e) from public.deliverable_events e where e.deliverable_id = 'privileged-protocol-limit';` }).trim());
  ok(privileged.event_assignee_id === A && privileged.event_assignee_attribution === 'native_transaction',
    'the test records the deliberate limit: custom-GUC stamping is a normal-writer protocol, not a privileged SQL integrity boundary');

  console.log(JSON.stringify({ status: 'PASS', passed: checks.length,
    classification: 'EXECUTED_REAL_POSTGRES16_EVENT_ASSIGNEE_MIGRATION', provider_attempts: 0,
    limits: ['Synthetic fixture only', 'Privileged SQL limitation is demonstrated and documented; this test does not claim service_role isolation'] }));
} finally {
  if (cluster) cluster.stop();
}
