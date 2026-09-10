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
const ROUND_UTC = '2030-01-02 03:04:05.123456+00';
const ROUND_EQUIVALENT_ZONE = '2030-01-01 21:04:05.123456-06';
let cluster;
function scalar(sql) { return cluster.run('', null, { sql, tuplesOnly: true }).trim(); }
function refuses(sql, expected) { assert.throws(() => cluster.exec(sql), new RegExp(expected)); }
function service(sql) { cluster.exec(`begin; set local role service_role; ${sql}; commit;`); }
function serviceScalar(sql) { return scalar(`begin; set local role service_role; ${sql}; commit;`); }
function intentId(where) { return scalar(`select id from public.production_notification_intents where ${where}`); }
function nativeStatus(from, to, suffix) {
  cluster.exec(`begin;
    update public.deliverables set status='${from}' where id='legacy-native-id';
    select public.deliverable_write(
      jsonb_build_object('id','legacy-native-id','status','${to}'),
      jsonb_build_object('action','status_change','source','ui',
        'auth_kind','staff','actor_key','member:${ACTOR}','proof','${suffix}'));
    commit;`);
}
function staffComment(id) {
  cluster.exec(`select public.production_comment_upsert(jsonb_build_object(
    'id','${id}','idempotency_key','${id}-key','native_comment_id','${id}-native',
    'deliverable_id','legacy-native-id','client_slug','fixture-client','team','video',
    'author_key','member:${ACTOR}','author_member_id','${ACTOR}',
    'author_name','Synthetic Staff','role','smm','body','A safe comment',
    'audience','client','origin','native','source','ui'));`);
}
function claimOne() { service('select * from public.production_notification_claim(1)'); }
try {
  cluster = bootCluster();
  cluster.runFile(path.join(MIGRATIONS, '2026-09-09-editors-event-assignee.sql'));
  // The reusable fixture stubs cards as id-only. Add the real claim predicate
  // columns before compiling the notification routines with function checks on.
  cluster.exec(`alter table public.batches add column if not exists purpose text;
    alter table public.calendar_posts add column if not exists video_status text;
    alter table public.calendar_posts add column if not exists video_status_at timestamptz;
    alter table public.sample_reviews add column if not exists video_status text;
    alter table public.sample_reviews add column if not exists video_status_at timestamptz;
    alter table public.clients add column if not exists slack_channel_id text;
    alter table public.team_members add column if not exists slack_user_id text;
    update public.clients set slack_channel_id = 'C1234567890' where slug = 'fixture-client';
    update public.team_members set slack_user_id = 'U1234567890' where id = '${EDITOR}';
    insert into public.batches(id,client_slug,team,name,status,purpose) values ('notification-batch','fixture-client','video','Notification batch','active','calendar');
    insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,card_id,assignee_id)
      values ('legacy-native-id','notification-batch','fixture-client','video','video','<@Ubad> title','todo','calendar','notification-card','${EDITOR}');
    insert into public.calendar_posts(id,client,video_deliverable_id,video_status,video_status_at)
      values ('notification-card','fixture-client','legacy-native-id','Tweaks Needed','${ROUND_UTC}'::timestamptz);`);
  cluster.runFile(path.join(MIGRATIONS, '2026-09-09-native-notification-outbox.sql'));
  cluster.exec(`insert into public.production_notification_config(key,value)
    values ('urgent_video_destination','{"channel_id":"C1234567890"}'::jsonb)
    on conflict(key) do update set value=excluded.value;`);

  // Status event has current authority, stamped native transaction proof and canonical actor.
  nativeStatus('in_progress', 'smm_approval', 'baseline-status');
  assert.equal(scalar("select count(*) from public.production_notification_intents where kind='status_smm_approval'"), '1');
  staffComment('notification-comment');
  assert.equal(scalar("select count(*) from public.production_notification_intents where kind='comment' and source_comment_id='notification-comment'"), '1', 'staff comment trigger writes exactly one intent through partial unique conflict inference');
  assert.match(scalar("select message->>'text' from public.production_notification_intents where kind='status_smm_approval'"), /‹@Ubad›/, 'user-derived title is mention-escaped');
  // A provider-era/legacy-shaped ID is accepted when committed evidence is native.
  assert.equal(scalar("select count(*) from public.production_notification_intents where deliverable_id='legacy-native-id' and kind='status_smm_approval'"), '1');

  // Import/test/parity and missing authority leave no intent.
  cluster.exec(`insert into public.deliverable_events(deliverable_id,batch_id,client_slug,action,source,from_status,to_status,payload)
    values ('legacy-native-id','notification-batch','fixture-client','status_change','reconcile','todo','tweak','{}'::jsonb);`);
  assert.equal(scalar('select count(*) from public.production_notification_intents'), '2');
  cluster.exec(`update public.syncview_runtime_flags set value='{"video":"linear","graphics":"syncview"}'::jsonb where key='prod_authority';`);
  nativeStatus('smm_approval', 'tweak', 'authority-excluded');
  assert.equal(scalar('select count(*) from public.production_notification_intents'), '2');
  cluster.exec(`update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}'::jsonb where key='prod_authority';`);

  // Direct DML and non-service execution are denied, while service inspection is read-only.
  refuses("begin; set local role anon; select public.production_notification_claim(1); rollback;", 'permission denied');
  refuses("insert into public.production_notification_intents(intent_key,kind,state,client_slug,deliverable_id,source_event_id,actor_member_id,destination_kind,message) values ('bad-direct','status_tweak','blocked','fixture-client','legacy-native-id',1,'11111111-1111-4111-8111-111111111111','client_creative_channel','{}');", 'production_notification_intent_insert_forbidden');
  assert.equal(serviceScalar('select count(*) from public.production_notification_intents'), '2');
  assert.equal(serviceScalar('select count(*) from public.production_notification_delivery_receipts'), '0');
  assert.equal(serviceScalar('select count(*) from public.production_notification_monitor_v1'), '2');

  // A claimed uncertain provider outcome cannot be retried without an explicit duplicate-risk decision.
  const statusIntent = intentId("kind='status_smm_approval'");
  claimOne();
  assert.equal(scalar(`select state from public.production_notification_intents where id='${statusIntent}'`), 'sending');
  service(`select public.production_notification_record_delivery('${statusIntent}', 1, 'retryable', null, 'slack_provider_retryable')`);
  assert.equal(scalar(`select state from public.production_notification_intents where id='${statusIntent}'`), 'retryable');
  const uncertainIntent = intentId("source_comment_id='notification-comment'");
  claimOne();
  service(`select public.production_notification_record_delivery('${uncertainIntent}', 1, 'unknown', null, 'slack_transport_unconfirmed')`);
  refuses(`begin; set local role service_role; select public.production_notification_reconcile('${uncertainIntent}','retry_duplicate_risk','no',null); rollback;`, 'production_notification_duplicate_risk_confirmation_required');
  assert.equal(scalar(`select state from public.production_notification_intents where id='${uncertainIntent}'`), 'unknown');

  // Manual receipt attestation is separately recorded and cannot manufacture sent from an arbitrary token.
  staffComment('notification-attest');
  const attestIntent = intentId("source_comment_id='notification-attest'");
  claimOne();
  service(`select public.production_notification_record_delivery('${attestIntent}', 1, 'unknown', null, 'slack_transport_unconfirmed')`);
  refuses(`begin; set local role service_role; select public.production_notification_reconcile('${attestIntent}','attest_manual_receipt','MANUAL_PROVIDER_RECEIPT_VERIFIED','bad'); rollback;`, 'production_notification_manual_receipt_confirmation_required');
  service(`select public.production_notification_reconcile('${attestIntent}','attest_manual_receipt','MANUAL_PROVIDER_RECEIPT_VERIFIED','1788800000.123456')`);
  assert.equal(scalar(`select state from public.production_notification_intents where id='${attestIntent}'`), 'sent');
  assert.equal(scalar(`select count(*) from public.production_notification_delivery_receipts where intent_id='${attestIntent}' and outcome='sent' and provider_message_id='1788800000.123456'`), '1');
  assert.equal(scalar(`select count(*) from public.production_notification_reconciliations where intent_id='${attestIntent}' and action='attest_manual_receipt'`), '1');

  // A provider-declared non-delivery is a different protected retry route from a missing destination.
  staffComment('notification-provider-blocked');
  const providerBlocked = intentId("source_comment_id='notification-provider-blocked'");
  claimOne();
  service(`select public.production_notification_record_delivery('${providerBlocked}', 1, 'blocked', null, 'slack_api_rejected')`);
  refuses(`begin; set local role service_role; select public.production_notification_reconcile('${providerBlocked}','retry_known_nondelivery','RETRY_MAY_DUPLICATE',null); rollback;`, 'production_notification_known_nondelivery_confirmation_required');
  service(`select public.production_notification_reconcile('${providerBlocked}','retry_known_nondelivery','PROVIDER_CONFIRMED_NOT_DELIVERED',null)`);
  assert.equal(scalar(`select state from public.production_notification_intents where id='${providerBlocked}'`), 'retryable');
  // The older unknown can now be deliberately released with its duplicate-risk acknowledgement.
  service(`select public.production_notification_reconcile('${uncertainIntent}','retry_duplicate_risk','RETRY_MAY_DUPLICATE',null)`);
  assert.equal(scalar(`select state from public.production_notification_intents where id='${uncertainIntent}'`), 'retryable');
  assert.equal(scalar(`select count(*) from public.production_notification_reconciliations where intent_id='${uncertainIntent}' and action='retry_duplicate_risk'`), '1');

  // A channel configured after an active blocked intent can only be released through the audit RPC.
  cluster.exec("update public.clients set slack_channel_id=null where slug='fixture-client'");
  nativeStatus('todo', 'tweak', 'blocked-destination');
  const blockedDestination = intentId("kind='status_tweak' and state='blocked'");
  assert.equal(scalar(`select destination_channel_id is null from public.production_notification_intents where id='${blockedDestination}'`), 't');
  cluster.exec("update public.clients set slack_channel_id='C1234567890' where slug='fixture-client'");
  service(`select public.production_notification_reconcile('${blockedDestination}','release_blocked_destination',null,null)`);
  assert.equal(scalar(`select state || ':' || destination_channel_id from public.production_notification_intents where id='${blockedDestination}'`), 'pending:C1234567890');
  assert.equal(scalar(`select count(*) from public.production_notification_reconciliations where intent_id='${blockedDestination}' and action='release_blocked_destination'`), '1');

  // Client comments require a matching canonical native comment and identity-correlated ledger event; replay remains one post.
  cluster.exec(`insert into public.production_comments(
    id,idempotency_key,native_comment_id,deliverable_id,client_slug,team,author_key,author_name,role,body,audience,origin,source
  ) values ('client-correlation','client-correlation-key','client-correlation-native','legacy-native-id','fixture-client','video',
    'client:fixture-client','Forged event name','client','Client body <@Ubad>','client','native','ui');
    insert into public.deliverable_events(deliverable_id,batch_id,client_slug,actor,role,action,source,payload)
    values ('legacy-native-id','notification-batch','fixture-client','Correlated client','client','comment_add','ui',
      '{"auth_kind":"client","actor_key":"client:fixture-client","comment":{"id":"client-correlation","author_name":"Correlated client"}}'::jsonb),
      ('legacy-native-id','notification-batch','fixture-client','Correlated client','client','comment_add','ui',
      '{"auth_kind":"client","actor_key":"client:fixture-client","comment":{"id":"client-correlation","author_name":"Correlated client"}}'::jsonb);`);
  assert.equal(scalar("select count(*) from public.production_notification_intents where source_comment_id='client-correlation'"), '1', 'correlated client event is replay-safe through the source-comment partial unique index');
  assert.equal(scalar("select actor_member_id is null from public.production_notification_intents where source_comment_id='client-correlation'"), 't');

  // Equivalent timezone inputs retain one urgent identity at microsecond precision.
  cluster.exec("update public.deliverables set status='tweak' where id='legacy-native-id'");
  service(`select public.production_notification_enqueue_urgent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fixture-client','legacy-native-id','notification-card','calendar','${ROUND_UTC}'::timestamptz,'${ACTOR}','${EDITOR}')`);
  service(`select public.production_notification_enqueue_urgent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','fixture-client','legacy-native-id','notification-card','calendar','${ROUND_EQUIVALENT_ZONE}'::timestamptz,'${ACTOR}','${EDITOR}')`);
  assert.equal(scalar("select count(*) from public.production_notification_intents where kind='urgent'"), '1');
  assert.equal(scalar("select to_char((message->>'round')::timestamptz at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') from public.production_notification_intents where kind='urgent'"), '2030-01-02 03:04:05.123456');
  assert.equal(scalar(`select (public.production_notification_urgent_status('fixture-client','legacy-native-id','${ROUND_EQUIVALENT_ZONE}'::timestamptz)->>'state')`), 'pending');

  // Claim rechecks the mutable target inside its selected/locked candidate statement, blocking a stale urgent before any provider request.
  cluster.exec("update public.deliverables set status='smm_approval' where id='legacy-native-id'");
  service('select * from public.production_notification_claim(10)');
  const urgentIntent = intentId("kind='urgent'");
  assert.equal(scalar(`select state || ':' || last_failure_code from public.production_notification_intents where id='${urgentIntent}'`), 'blocked:urgent_target_changed');

  // Aggregate health observes unresolved debt without a capped row scan.
  const health = JSON.parse(serviceScalar('select public.production_notification_health_summary()'));
  assert.ok(Number(health.blocked) >= 1, 'stale urgent is observable as blocked debt');
  assert.ok(Number(health.total_open) >= Number(health.blocked), 'aggregate counts unresolved queue debt');
  // This proof must run without invented soft-delete columns.
  assert.equal(scalar("select count(*) from information_schema.columns where table_schema='public' and table_name in ('deliverables','batches','calendar_posts','sample_reviews') and column_name='deleted_at'"),'0');
  for (const key of ['webhook_delete','deleted','delete','removed','archived']) {
    for (const value of [null,false,0,'','false','0','null',' FALSE ']) {
      const raw=JSON.stringify({[key]:value}).replace(/'/g,"''");
      assert.equal(serviceScalar(`select public.production_notification_deliverable_live('tweak','${raw}'::jsonb)`),'t',key+' false-like marker stays visible');
    }
    assert.equal(serviceScalar(`select public.production_notification_deliverable_live('tweak','{"${key}":true}'::jsonb)`),'f',key+' marker hides work');
  }
  for (const [raw,expected] of [
    [JSON.stringify({deleted:false}),'t'],[JSON.stringify({archived:true}),'f'],
    ['malformed-json','f'],[[], 'f'],[42,'f'],[false,'f'],
    [JSON.stringify([]),'f'],[JSON.stringify(null),'f'],[null,'t'],
    [{deleted:[]},'f'],[{archived:{}},'f'],
  ]) {
    const encoded=JSON.stringify(raw).replace(/'/g,"''");
    assert.equal(serviceScalar(`select public.production_notification_deliverable_live('tweak','${encoded}'::jsonb)`),expected,'raw normalization '+encoded);
  }
  assert.equal(serviceScalar(`select public.production_notification_deliverable_live('canceled','{}')`),'t');
  assert.equal(serviceScalar(`select public.production_notification_deliverable_live('todo','{"issue":{"archivedAt":"2030-01-01"}}')`),'f');
  refuses("begin; set local role anon; select public.production_notification_target_live('legacy-native-id'); rollback;",'permission denied');

  cluster.exec("update public.calendar_posts set status='Archived' where id='notification-card'");
  const beforeArchived=scalar('select count(*) from public.production_notification_intents');
  nativeStatus('todo','tweak','archived-source');staffComment('archived-source-comment');
  assert.equal(scalar('select count(*) from public.production_notification_intents'),beforeArchived,'archived source excludes actual status/comment writers');
  cluster.exec("update public.calendar_posts set status='In Progress' where id='notification-card'; update public.batches set status='done' where id='notification-batch'");
  assert.equal(serviceScalar("select public.production_notification_target_live('legacy-native-id')"),'t','done batch does not hide ordinary work');
  cluster.exec("update public.batches set status='active' where id='notification-batch'");
  cluster.exec(`insert into public.sample_reviews(id,client,status,video_deliverable_id,video_status,video_status_at)
    values ('archived-sample','fixture-client',' Archived ','legacy-native-id','Tweaks Needed','${ROUND_UTC}'::timestamptz);
    update public.deliverables set origin='samples',card_id='archived-sample',status='tweak' where id='legacy-native-id';
    update public.batches set purpose='samples' where id='notification-batch';`);
  refuses(`select public.production_notification_enqueue_urgent(gen_random_uuid(),'fixture-client','legacy-native-id','archived-sample','samples','${ROUND_UTC}'::timestamptz,'${ACTOR}','${EDITOR}')`,'notification_urgent_target_changed');
  cluster.exec("update public.deliverables set origin='calendar',card_id='notification-card' where id='legacy-native-id'; update public.batches set purpose='calendar' where id='notification-batch'");
  cluster.exec("insert into public.batches(id,client_slug,team,name,status,purpose) values ('notification-other','fixture-client','video','Other fixture','active','calendar')");
  const staleCases=[
    ["update public.batches set status='done' where id='notification-batch'","update public.batches set status='active' where id='notification-batch'"],
    ["update public.deliverables set batch_id='notification-other' where id='legacy-native-id'","update public.deliverables set batch_id='notification-batch' where id='legacy-native-id'"],
    ["update public.calendar_posts set status='Archived' where id='notification-card'","update public.calendar_posts set status='In Progress' where id='notification-card'"],
    ["update public.deliverables set linear_raw='{\"webhook_delete\":true}'::jsonb where id='legacy-native-id'","update public.deliverables set linear_raw='{}'::jsonb where id='legacy-native-id'"],
  ];
  for (let n=0;n<staleCases.length;n++) {
    const round=`2030-02-0${n+1} 00:00:00+00`;
    cluster.exec(`update public.calendar_posts set video_status_at='${round}'::timestamptz where id='notification-card'`);
    service(`select public.production_notification_enqueue_urgent(gen_random_uuid(),'fixture-client','legacy-native-id','notification-card','calendar','${round}'::timestamptz,'${ACTOR}','${EDITOR}')`);
    const queued=intentId(`kind='urgent' and (message->>'round')::timestamptz='${round}'::timestamptz`);
    cluster.exec(staleCases[n][0]);service('select * from public.production_notification_claim(10)');
    assert.equal(scalar(`select state || ':' || last_failure_code from public.production_notification_intents where id='${queued}'`),'blocked:urgent_target_changed','claim refuses changed target '+n);
    assert.equal(scalar(`select attempt_count from public.production_notification_intents where id='${queued}'`),'0');
    cluster.exec(staleCases[n][1]);
  }
  // Batch.team summarizes the batch, not its child membership. Mixed/native
  // batches may have NULL; imported summaries can name the other team.
  for (const [n,team] of [[0,null],[1,'graphics']]) {
    const round=`2030-03-0${n+1} 00:00:00+00`;
    cluster.exec(`update public.batches set team=${team ? "'"+team+"'" : 'null'} where id='notification-batch';
      update public.calendar_posts set video_status_at='${round}'::timestamptz where id='notification-card';`);
    service(`select public.production_notification_enqueue_urgent(gen_random_uuid(),'fixture-client','legacy-native-id','notification-card','calendar','${round}'::timestamptz,'${ACTOR}','${EDITOR}')`);
    const queued=intentId(`kind='urgent' and (message->>'round')::timestamptz='${round}'::timestamptz`);
    service('select * from public.production_notification_claim(10)');
    assert.equal(scalar(`select state from public.production_notification_intents where id='${queued}'`),'sending','valid video child survives batch summary '+team);
    assert.equal(scalar(`select attempt_count from public.production_notification_intents where id='${queued}'`),'1');
    service(`select public.production_notification_record_delivery('${queued}',1,'sent','2030000000.${String(n+1).padStart(6,'0')}','')`);
  }
  cluster.exec("update public.batches set team='video' where id='notification-batch'");

  // The comment table really owns deleted_at; a later deletion suppresses delivery.
  staffComment('deleted-before-delivery');
  const deletedCommentIntent=intentId("source_comment_id='deleted-before-delivery'");
  cluster.exec(`select public.production_comment_upsert(jsonb_build_object('id','deleted-before-delivery','native_comment_id','deleted-before-delivery-native','idempotency_key','deleted-before-delivery-key','deliverable_id','legacy-native-id','client_slug','fixture-client','team','video','operation','delete','deleted_at',now()::text,'author_key','member:${ACTOR}','author_member_id','${ACTOR}','author_name','Synthetic Staff','role','smm','origin','native','source','ui'))`);
  service('select * from public.production_notification_claim(10)');
  assert.equal(scalar(`select state || ':' || last_failure_code from public.production_notification_intents where id='${deletedCommentIntent}'`),'blocked:notification_target_changed');
  assert.equal(scalar(`select attempt_count from public.production_notification_intents where id='${deletedCommentIntent}'`),'0');
  console.log('ok native notifications PostgreSQL proof');
} finally { if (cluster) cluster.stop(); }
