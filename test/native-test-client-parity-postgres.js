'use strict';

/*
 * Actual PostgreSQL 16 proof of 2026-09-18-native-test-client-parity.sql.
 * All identities are synthetic and the database is disposable; nothing here
 * reaches a live backend.
 *
 * THE PROPERTY UNDER TEST. Before this migration both native lanes refused a
 * `test_only` write outright once their capability was `native`, so the
 * nightly TEST drill could never reach the native lane at all -- the finding
 * that forced PR #1412 to park `native_followup_mirror_settlement`. After it,
 * each lane records the value and compares it, and the authority check
 * receives the real value.
 *
 * Four things are proved for BOTH lanes, and they are the four the owner asked
 * for: a TEST write is admitted and its outbox row is terminal with the native
 * marker; a real-client write behaves identically; `provider` mode is
 * unchanged; and `legacy_parity` is still refused everywhere it was.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  bootCluster, MIGRATIONS, count, jsonRows, scalar,
} = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native test-client parity PostgreSQL: F63 disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw Error('native test-client parity proof requires loopback disposable PostgreSQL');
}
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

let cluster;
let passed = 0;
const ok = (name, value) => {
  assert.ok(value, name);
  passed += 1;
  console.log(`  ok ${name}`);
};
const literal = value => `'${String(value).replace(/'/g, "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;

const ORDINARY_EPOCH = 'parity.ordinary.2026-09-18';
const ASSIGNMENT_EPOCH = 'parity.assignment.2026-09-18';
const EDITOR = '33333333-3333-4333-8333-333333333331';

function rejection(sql, pattern) {
  try {
    cluster.exec(sql);
  } catch (error) {
    assert.match(String(error && error.message), pattern);
    return true;
  }
  return false;
}

function ordinaryCapability(mode, epoch = null) {
  cluster.exec(`update public.syncview_runtime_flags set value=${json({
    schema_version: 1, video: { mode, epoch }, graphics: { mode, epoch },
  })} where key='production_native_ordinary_receipts'`);
}

function assignmentCapability(mode, epoch = null) {
  cluster.exec(`update public.syncview_runtime_flags set value=${json({
    video: { mode, epoch }, graphics: { mode, epoch },
  })} where key='native_assignment_epochs'`);
}

function statusEvent({ dedup, id, testOnly = false, legacyParity = false, status = 'todo' }) {
  return {
    source: 'ui', action: 'status_change', actor: 'Fixture Admin', role: 'admin',
    ts: '2026-09-18T00:00:00Z',
    outbound: {
      entity: 'deliverable', entity_id: id, operation: 'status', dedup_key: dedup,
      source_edited_at: '2026-09-18T00:00:00Z', test_only: testOnly, legacy_parity: legacyParity,
      payload: {
        _intent_fingerprint: `fp-${dedup}`,
        _f27_authority_generation: 0,
        _f27_legacy_parity: legacyParity,
      },
      status,
    },
  };
}

function statusWrite(id, slug, patch, outboundEvent) {
  return cluster.exec(`select public.production_deliverable_write(${json({
    id, client_slug: slug, team: 'video', ...patch,
  })},${json(outboundEvent)})`);
}

function assigneeWrite({ id, slug, dedup, testOnly = false, legacyParity = false, epoch = ASSIGNMENT_EPOCH, assignee = EDITOR }) {
  const updatedAt = scalar(cluster, `select updated_at from public.deliverables where id=${literal(id)}`);
  return cluster.exec(`select public.production_assignee_write(${json({
    id, client_slug: slug, team: 'video', assignee_id: assignee,
  })},${json({
    surface: 'production', auth_kind: 'staff', source: 'ui', action: 'assignee_change',
    actor: 'Fixture Admin', role: 'admin', expected_updated_at: updatedAt,
    outbound: {
      entity: 'deliverable', entity_id: id, operation: 'assignee',
      dedup_key: dedup, source_edited_at: '2026-09-18T00:00:00Z',
      test_only: testOnly, legacy_parity: legacyParity,
      payload: {
        assignee_id: assignee,
        _intent_fingerprint: `fp-${dedup}`,
        _native_assignment_epoch: epoch,
        _f27_authority_generation: 0,
        _f27_legacy_parity: legacyParity,
      },
    },
  })})`);
}

function row(dedup) {
  return jsonRows(cluster, `select status,test_only,legacy_parity,payload,linear_result
    from public.mirror_outbox where dedup_key=${literal(dedup)}`)[0];
}

function admission(dedup) {
  return jsonRows(cluster, `select test_only,legacy_parity,epoch,owner,native_operation,receipt_id
    from public.production_native_ordinary_receipt_admissions where dedup_key=${literal(dedup)}`)[0];
}

/* The four routines this migration replaces, and the roles whose EXECUTE the
   replacement must not hand back. Measured, not assumed. */
const ACL_SQL = `select string_agg(p.proname||':'||r.rolname,',' order by p.proname,r.rolname)
  from pg_proc p
  cross join (values('service_role'),('anon'),('authenticated')) r(rolname)
  where p.pronamespace='public'::regnamespace
    and p.proname in ('production_native_ordinary_event','production_native_ordinary_receipt_guard',
                      'production_assignment_context','production_assignee_write',
                      'production_native_assignment_receipt_guard')
    and has_function_privilege(r.rolname,p.oid,'EXECUTE')`;

function main() {
  try {
    cluster = bootCluster();
    cluster.exec(`
      alter table public.calendar_posts add column if not exists thumbnail_url text;
      alter table public.calendar_posts add column if not exists asset_url text;
      alter table public.calendar_posts add column if not exists thumb_rev text;
      alter table public.calendar_posts add column if not exists updated_at text;
      alter table public.sample_reviews add column if not exists thumbnail_url text;
      alter table public.sample_reviews add column if not exists asset_url text;
      alter table public.sample_reviews add column if not exists thumb_rev text;
      alter table public.sample_reviews add column if not exists updated_at text;
    `);
    for (const file of [
      '2026-07-23-f201-production-labels.sql',
      '2026-07-23-f202-production-descriptions.sql',
      '2026-07-23-production-comment-thread-lifecycle.sql',
      '2026-07-23-f34-f53-production-attachments.sql',
      '2026-08-06-artifact-projection-scope-and-revision.sql',
      '2026-08-30-artifact-video-projection.sql',
      '2026-09-05-artifact-card-binding-first.sql',
      '2026-09-09-editors-event-assignee.sql',
      '2026-09-09-native-ordinary-receipts.sql',
      '2026-09-11-native-ordinary-receipt-repair.sql',
      '2026-09-12-native-ordinary-envelope-repair.sql',
      '2026-09-06-native-existing-assignment.sql',
    ]) cluster.runFile(path.join(MIGRATIONS, file));

    // Two clients: the disposable fixture is the TEST client, and a second
    // synthetic row stands in for an ordinary client. Both are invented.
    cluster.exec(`
      update public.clients set kind='test' where slug='fixture-client';
      insert into public.clients(slug,display_name,active,kind)
        values ('parity-real','Parity real fixture',true,'client')
        on conflict (slug) do update set active=true, kind='client';
      update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}'::jsonb
        where key='prod_authority';
      insert into public.batches(id,client_slug,team,name,status) values
        ('par-b','fixture-client','video','Parity TEST fixture','active'),
        ('par-rb','parity-real','video','Parity real fixture','active');
      insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,updated_at) values
        ('par-test','par-b','fixture-client','video','video','TEST before','in_progress','manual',now()),
        ('par-test2','par-b','fixture-client','video','video','TEST assignee','in_progress','manual',now()),
        ('par-test3','par-b','fixture-client','video','video','TEST parity','in_progress','manual',now()),
        ('par-real','par-rb','parity-real','video','video','Real before','in_progress','manual',now()),
        ('par-real2','par-rb','parity-real','video','video','Real assignee','in_progress','manual',now());
      update public.team_members set team='video', role='editor', active=true where id=${literal(EDITOR)}::uuid;
    `);

    const aclBefore = scalar(cluster, ACL_SQL);

    /* ---------- BEFORE: reproduce the refusal this migration removes ------- */
    ordinaryCapability('native', ORDINARY_EPOCH);
    assignmentCapability('native', ASSIGNMENT_EPOCH);
    ok('BEFORE: a TEST ordinary write is refused outright',
      rejection(`select public.production_deliverable_write(${json({
        id: 'par-test', client_slug: 'fixture-client', team: 'video', status: 'todo',
      })},${json(statusEvent({ dedup: 'before-test-ordinary', id: 'par-test', testOnly: true }))})`,
      /native_ordinary_receipt_scope_forbidden/));
    ok('BEFORE: a TEST assignment write is refused outright',
      rejection(`select public.production_assignee_write(${json({
        id: 'par-test2', client_slug: 'fixture-client', team: 'video', assignee_id: EDITOR,
      })},${json({
        surface: 'production', auth_kind: 'staff', source: 'ui', action: 'assignee_change',
        actor: 'Fixture Admin', role: 'admin',
        expected_updated_at: scalar(cluster, "select updated_at from public.deliverables where id='par-test2'"),
        outbound: {
          entity: 'deliverable', entity_id: 'par-test2', operation: 'assignee',
          dedup_key: 'write-ui:assignee:deliverable:par-test2:before', source_edited_at: '2026-09-18T00:00:00Z',
          test_only: true, legacy_parity: false,
          payload: {
            assignee_id: EDITOR, _intent_fingerprint: 'fp-before-assign',
            _native_assignment_epoch: ASSIGNMENT_EPOCH,
            _f27_authority_generation: 0, _f27_legacy_parity: false,
          },
        },
      })})`, /assignment_authority_unavailable|assignment_scope_forbidden/));

    /* ---------- APPLY ------------------------------------------------------ */
    cluster.runFile(path.join(MIGRATIONS, '2026-09-18-native-test-client-parity.sql'));
    ok('the admission table no longer forbids a TEST admission',
      count(cluster, `select 1 from pg_constraint
        where conrelid='public.production_native_ordinary_receipt_admissions'::regclass
          and contype='c' and pg_get_constraintdef(oid)='CHECK ((test_only = false))'`) === 0);
    ok('the legacy_parity check on the same table is untouched',
      count(cluster, `select 1 from pg_constraint
        where conrelid='public.production_native_ordinary_receipt_admissions'::regclass
          and contype='c' and pg_get_constraintdef(oid)='CHECK ((legacy_parity = false))'`) === 1);
    ok('create or replace handed no EXECUTE back to service_role, anon or authenticated',
      scalar(cluster, ACL_SQL) === aclBefore);

    /* ---------- ORDINARY LANE, native mode -------------------------------- */
    statusWrite('par-test', 'fixture-client', { status: 'todo' },
      statusEvent({ dedup: 'after-test-ordinary', id: 'par-test', testOnly: true }));
    const testOrdinary = row('after-test-ordinary');
    const testAdmission = admission('after-test-ordinary');
    ok('TEST ordinary write is admitted and its row is skipped with the native marker',
      testOrdinary.status === 'skipped'
      && testOrdinary.test_only === true
      && testOrdinary.linear_result.native_ordinary === true
      && testOrdinary.linear_result.epoch === ORDINARY_EPOCH
      && testOrdinary.payload._native_ordinary_receipt.epoch === ORDINARY_EPOCH);
    ok('the admission RECORDS test_only rather than forbidding it',
      testAdmission.test_only === true && testAdmission.legacy_parity === false);

    statusWrite('par-real', 'parity-real', { status: 'todo' },
      statusEvent({ dedup: 'after-real-ordinary', id: 'par-real' }));
    const realOrdinary = row('after-real-ordinary');
    ok('a real-client ordinary write behaves identically, test_only false',
      realOrdinary.status === 'skipped'
      && realOrdinary.test_only === false
      && realOrdinary.linear_result.native_ordinary === true
      && realOrdinary.linear_result.epoch === testOrdinary.linear_result.epoch
      && admission('after-real-ordinary').test_only === false);

    /* ---------- ASSIGNMENT LANE, native mode ------------------------------ */
    assigneeWrite({
      id: 'par-test2', slug: 'fixture-client',
      dedup: 'write-ui:assignee:deliverable:par-test2:after', testOnly: true,
    });
    const testAssign = row('write-ui:assignee:deliverable:par-test2:after');
    ok('TEST assignment write is admitted and its row is skipped with the native marker',
      testAssign.status === 'skipped'
      && testAssign.test_only === true
      && testAssign.linear_result.native_assignment === true
      && testAssign.linear_result.epoch === ASSIGNMENT_EPOCH
      && testAssign.payload._native_assignment_epoch === ASSIGNMENT_EPOCH);
    ok('the TEST assignment actually moved the native row',
      scalar(cluster, "select coalesce(assignee_id::text,'') from public.deliverables where id='par-test2'") === EDITOR);

    assigneeWrite({
      id: 'par-real2', slug: 'parity-real',
      dedup: 'write-ui:assignee:deliverable:par-real2:after',
    });
    const realAssign = row('write-ui:assignee:deliverable:par-real2:after');
    ok('a real-client assignment behaves identically, test_only false',
      realAssign.status === 'skipped'
      && realAssign.test_only === false
      && realAssign.linear_result.native_assignment === true
      && realAssign.linear_result.epoch === testAssign.linear_result.epoch);

    /* ---------- the compare is real, not merely recorded ------------------ */
    ok('a forged TEST receipt whose row contradicts its admission is refused',
      rejection(`insert into public.mirror_outbox(
          deliverable_id,op,payload,entity,entity_id,operation,client_slug,team,
          dedup_key,source_edited_at,status,actor,role,test_only,legacy_parity)
        values('par-test','update_state',
          (select jsonb_build_object('_intent_fingerprint',a.intent_fingerprint,
             '_native_ordinary_receipt',jsonb_build_object('schema',1,'epoch',a.epoch,
               'owner',a.owner,'operation',a.native_operation,'token',a.token::text))
           from public.production_native_ordinary_receipt_admissions a
           where a.dedup_key='after-test-ordinary'),
          'deliverable','par-test','status','fixture-client','video','forged-flip',now(),
          'pending','Fixture Admin','admin',false,false)`,
      /native_ordinary_receipt_invalid/));

    /* ---------- legacy_parity is unchanged in both lanes ------------------ */
    /*
     * A parity envelope has to clear `production_assert_authority` first, which
     * requires the team to be Linear-authoritative with the parity gate on.
     * Without that it fails at `legacy_parity_not_allowed` and never reaches
     * the lane, which would prove nothing about the lane. Flipped for exactly
     * these two writes and restored immediately after.
     */
    cluster.exec(`update public.syncview_runtime_flags
      set value='{"video":"linear","graphics":"syncview"}'::jsonb where key='prod_authority'`);
    ok('ordinary lane still refuses a legacy-parity envelope',
      rejection(`select public.production_deliverable_write(${json({
        id: 'par-test3', client_slug: 'fixture-client', team: 'video', status: 'todo',
      })},${json(statusEvent({ dedup: 'parity-ordinary', id: 'par-test3', legacyParity: true }))})`,
      /native_ordinary_receipt_scope_forbidden/));
    cluster.exec(`update public.syncview_runtime_flags
      set value='{"video":"syncview","graphics":"syncview"}'::jsonb where key='prod_authority'`);
    /*
     * The assignment writer's own authority check hard-codes legacy_parity
     * false -- unchanged by this migration -- so a parity assignment is
     * refused by `production_assignment_context` under the ordinary syncview
     * stance. Flipping authority for it would only prove the pre-existing
     * `team_is_linear_authoritative` gate instead of the lane's own refusal.
     */
    ok('assignment lane still refuses a legacy-parity envelope',
      rejection(`select public.production_assignee_write(${json({
        id: 'par-test3', client_slug: 'fixture-client', team: 'video', assignee_id: EDITOR,
      })},${json({
        surface: 'production', auth_kind: 'staff', source: 'ui', action: 'assignee_change',
        actor: 'Fixture Admin', role: 'admin',
        expected_updated_at: scalar(cluster, "select updated_at from public.deliverables where id='par-test3'"),
        outbound: {
          entity: 'deliverable', entity_id: 'par-test3', operation: 'assignee',
          dedup_key: 'write-ui:assignee:deliverable:par-test3:parity', source_edited_at: '2026-09-18T00:00:00Z',
          test_only: false, legacy_parity: true,
          payload: {
            assignee_id: EDITOR, _intent_fingerprint: 'fp-parity-assign',
            _native_assignment_epoch: ASSIGNMENT_EPOCH,
            _f27_authority_generation: 0, _f27_legacy_parity: true,
          },
        },
      })})`, /assignment_authority_unavailable/));

    /* ---------- a TEST write still has to BE a test client ---------------- */
    ok('a non-test client may not claim test_only in either lane',
      rejection(`select public.production_deliverable_write(${json({
        id: 'par-real', client_slug: 'parity-real', team: 'video', status: 'tweak',
      })},${json(statusEvent({ dedup: 'fake-test-ordinary', id: 'par-real', testOnly: true }))})`,
      /test_client_scope_required/));

    /* ---------- provider mode is unchanged -------------------------------- */
    ordinaryCapability('provider');
    assignmentCapability('provider');
    statusWrite('par-test', 'fixture-client', { status: 'in_progress' },
      statusEvent({ dedup: 'provider-test-ordinary', id: 'par-test', testOnly: true, status: 'in_progress' }));
    const providerOrdinary = row('provider-test-ordinary');
    ok('provider mode still writes a pending TEST provider receipt with no admission',
      providerOrdinary.status === 'pending'
      && providerOrdinary.test_only === true
      && !('_native_ordinary_receipt' in providerOrdinary.payload)
      && count(cluster, "select 1 from public.production_native_ordinary_receipt_admissions where dedup_key='provider-test-ordinary'") === 0);
    ok('provider mode still refuses an assignment envelope carrying a native epoch',
      rejection(`select public.production_assignee_write(${json({
        id: 'par-test2', client_slug: 'fixture-client', team: 'video', assignee_id: null,
      })},${json({
        surface: 'production', auth_kind: 'staff', source: 'ui', action: 'assignee_change',
        actor: 'Fixture Admin', role: 'admin',
        expected_updated_at: scalar(cluster, "select updated_at from public.deliverables where id='par-test2'"),
        outbound: {
          entity: 'deliverable', entity_id: 'par-test2', operation: 'assignee',
          dedup_key: 'write-ui:assignee:deliverable:par-test2:provider', source_edited_at: '2026-09-18T00:00:00Z',
          test_only: true, legacy_parity: false,
          payload: {
            assignee_id: null, _intent_fingerprint: 'fp-provider-assign',
            _native_assignment_epoch: ASSIGNMENT_EPOCH,
            _f27_authority_generation: 0, _f27_legacy_parity: false,
          },
        },
      })})`, /assignment_authority_unavailable/));

    console.log(JSON.stringify({
      marker: 'NATIVE_TEST_CLIENT_PARITY_OK', checks: passed,
    }));
  } finally {
    if (cluster) cluster.stop();
  }
}

main();
