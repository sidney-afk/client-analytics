'use strict';
/* Disposable PostgreSQL proof only. It never contacts a hosted backend. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { bootCluster, MIGRATIONS } = require('../scripts/native-intake-manifest/harness.js');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native notifications PostgreSQL proof: explicit disposable PostgreSQL required (local executor socket EPERM)');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('native notification proof requires disposable loopback PostgreSQL');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const EDITOR = '33333333-3333-4333-8333-333333333331';
let cluster;
function scalar(sql) { return cluster.run('', null, { sql, tuplesOnly: true }).trim(); }
function refuses(sql, expected) { assert.throws(() => cluster.exec(sql), new RegExp(expected)); }
try {
  cluster = bootCluster();
  cluster.runFile(path.join(MIGRATIONS, '2026-09-09-editors-event-assignee.sql'));
  cluster.exec(`alter table public.deliverables add column if not exists deleted_at timestamptz;
    alter table public.batches add column if not exists deleted_at timestamptz;
    alter table public.batches add column if not exists purpose text;
    alter table public.clients alter column slack_channel_id drop not null;
    update public.clients set slack_channel_id = 'C1234567890' where slug = 'fixture-client';
    update public.team_members set slack_user_id = 'U1234567890' where id = '${EDITOR}';
    insert into public.batches(id,client_slug,team,name,status,purpose) values ('notification-batch','fixture-client','video','Notification batch','active','calendar');
    insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,card_id,assignee_id)
      values ('legacy-native-id','notification-batch','fixture-client','video','video','<@Ubad> title','todo','calendar','notification-card','${EDITOR}');
  `);
  cluster.runFile(path.join(MIGRATIONS, '2026-09-09-native-notification-outbox.sql'));
  // Status event has current authority, stamped native transaction proof and canonical actor.
  cluster.exec(`select set_config('app.event_assignee_stamp','native-status-v1',true);
    select set_config('app.event_assignee_id','${EDITOR}',true);
    select set_config('app.event_assignee_attribution','native_transaction',true);
    insert into public.deliverable_events(deliverable_id,batch_id,client_slug,action,source,from_status,to_status,payload)
    values ('legacy-native-id','notification-batch','fixture-client','status_change','ui','in_progress','smm_approval',
      '{"auth_kind":"staff","actor_key":"member:${ACTOR}"}'::jsonb);`);
  assert.equal(scalar("select count(*) from public.production_notification_intents where kind='status_smm_approval'"), '1');
  assert.match(scalar("select message->>'text' from public.production_notification_intents where kind='status_smm_approval'"), /‹@Ubad›/, 'user-derived title is mention-escaped');
  // A provider-era/legacy-shaped ID is accepted when the committed evidence is native; no del_ prefix assumption.
  assert.equal(scalar("select count(*) from public.production_notification_intents where deliverable_id='legacy-native-id'"), '1');
  // Import/test/parity and missing authority leave no intent.
  cluster.exec(`insert into public.deliverable_events(deliverable_id,batch_id,client_slug,action,source,from_status,to_status,payload)
    values ('legacy-native-id','notification-batch','fixture-client','status_change','reconcile','todo','tweak','{}'::jsonb);`);
  assert.equal(scalar('select count(*) from public.production_notification_intents'), '1');
  cluster.exec(`update public.syncview_runtime_flags set value='{"video":"linear","graphics":"syncview"}'::jsonb where key='prod_authority';
    select set_config('app.event_assignee_stamp','native-status-v1',true);
    select set_config('app.event_assignee_id','${EDITOR}',true);
    select set_config('app.event_assignee_attribution','native_transaction',true);
    insert into public.deliverable_events(deliverable_id,batch_id,client_slug,action,source,from_status,to_status,payload)
      values ('legacy-native-id','notification-batch','fixture-client','status_change','ui','smm_approval','tweak','{"auth_kind":"staff","actor_key":"member:${ACTOR}"}'::jsonb);`);
  assert.equal(scalar('select count(*) from public.production_notification_intents'), '1');
  cluster.exec(`update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}'::jsonb where key='prod_authority';`);
  // Direct DML and non-service role execution are denied. PostgreSQL superuser is intentionally outside this proof boundary.
  refuses("begin; set local role anon; select public.production_notification_claim(1); rollback;", 'permission denied');
  refuses("insert into public.production_notification_intents(intent_key,kind,state,client_slug,deliverable_id,source_event_id,actor_member_id,destination_kind,message) values ('bad-direct','status_tweak','blocked','fixture-client','legacy-native-id',1,'11111111-1111-4111-8111-111111111111','client_creative_channel','{}');", 'production_notification_intent_insert_forbidden');
  // A service-role claim/receipt is the only state progression. Provider identity is durable.
  cluster.exec('begin; set local role service_role; select * from public.production_notification_claim(1); commit;');
  assert.equal(scalar("select state from public.production_notification_intents where kind='status_smm_approval'"), 'sending');
  cluster.exec(`begin; set local role service_role; select public.production_notification_record_delivery(
    (select id from public.production_notification_intents where kind='status_smm_approval'), 1, 'retryable', null, 'slack_provider_retryable'); commit;`);
  assert.equal(scalar("select state from public.production_notification_intents where kind='status_smm_approval'"), 'retryable');
  assert.equal(scalar('select count(*) from public.production_notification_delivery_receipts'), '1');
  console.log('ok native notifications PostgreSQL proof');
} finally { if (cluster) cluster.stop(); }
