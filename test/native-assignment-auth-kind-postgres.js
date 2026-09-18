'use strict';

/*
 * Actual PostgreSQL 16 proof of
 * migrations/2026-09-18-native-assignment-auth-kind-binding.sql.
 * Synthetic identities, disposable database; nothing reaches a live backend.
 *
 * THE PROPERTY. #1413 made the assignment lane stop refusing test_only, but
 * left `auth_kind is distinct from 'staff'` standing. eventFor emits
 * `auth_kind: principal.kind` and the TEST principal's kind is "test", so a
 * real TEST assignment request was still refused -- the parity was unreachable
 * through the gateway. This binds the two fields in both directions.
 *
 * The BEFORE half sends the event the GATEWAY would actually send, not a
 * hand-built one. That is the distinction #1413's rehearsal missed, and it is
 * the whole reason this file exists.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootCluster, MIGRATIONS, jsonRows, scalar } = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native assignment auth_kind PostgreSQL: F63 disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw Error('native assignment auth_kind proof requires loopback disposable PostgreSQL');
}
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

const ROOT = path.resolve(__dirname, '..');
const GATEWAY = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');

let cluster;
let passed = 0;
const ok = (name, value) => { assert.ok(value, name); passed += 1; console.log(`  ok ${name}`); };
const literal = v => `'${String(v).replace(/'/g, "''")}'`;
const json = v => `${literal(JSON.stringify(v))}::jsonb`;

function rejection(sql, pattern) {
  try { cluster.exec(sql); } catch (error) {
    assert.match(String(error && error.message), pattern);
    return true;
  }
  return false;
}

const EPOCH = 'assignment.authkind.2026-09-18';
const EDITOR = '33333333-3333-4333-8333-333333333331';

/* auth_kind is NOT free to choose. eventFor emits `auth_kind: principal.kind`
   (index.ts:1557) and the TEST principal's kind is "test" (index.ts:1206), so a
   fixture that hard-codes 'staff' for a test_only write models a request the
   gateway never sends -- exactly how this defect stayed hidden. */
const authKindFor = testOnly => (testOnly ? 'test' : 'staff');

function assigneeEvent({ id, dedup, testOnly = false, authKind, testOnlyRaw }) {
  const out = {
    entity: 'deliverable', entity_id: id, operation: 'assignee', dedup_key: dedup,
    source_edited_at: '2026-09-18T00:00:00Z',
    test_only: testOnlyRaw === undefined ? testOnly : testOnlyRaw,
    legacy_parity: false,
    payload: {
      assignee_id: EDITOR,
      _intent_fingerprint: `fp-${dedup}`,
      _native_assignment_epoch: EPOCH,
      _f27_authority_generation: 0,
      _f27_legacy_parity: false,
    },
  };
  return {
    surface: 'production', auth_kind: authKind === undefined ? authKindFor(testOnly) : authKind,
    source: 'ui', action: 'assignee_change', actor: 'Fixture Admin', role: 'admin',
    expected_updated_at: scalar(cluster, `select updated_at from public.deliverables where id=${literal(id)}`),
    outbound: out,
  };
}

function assigneeWrite(args) {
  return cluster.exec(`select public.production_assignee_write(${json({
    id: args.id, client_slug: args.slug, team: 'video', assignee_id: EDITOR,
  })},${json(assigneeEvent(args))})`);
}

function capability(mode, epoch = null) {
  cluster.exec(`update public.syncview_runtime_flags set value=${json({
    video: { mode, epoch }, graphics: { mode, epoch },
  })} where key='native_assignment_epochs'`);
}

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
      '2026-09-18-native-test-client-parity.sql',
    ]) cluster.runFile(path.join(MIGRATIONS, file));

    cluster.exec(`
      update public.clients set kind='test' where slug='fixture-client';
      insert into public.clients(slug,display_name,active,kind)
        values ('authkind-real','Auth kind real fixture',true,'client')
        on conflict (slug) do update set active=true, kind='client';
      update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}'::jsonb
        where key='prod_authority';
      insert into public.batches(id,client_slug,team,name,status) values
        ('ak-b','fixture-client','video','Auth kind TEST fixture','active'),
        ('ak-rb','authkind-real','video','Auth kind real fixture','active');
      insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,updated_at) values
        ('ak-test','ak-b','fixture-client','video','video','TEST assignee','in_progress','manual',now()),
        ('ak-test2','ak-b','fixture-client','video','video','TEST assignee two','in_progress','manual',now()),
        ('ak-real','ak-rb','authkind-real','video','video','Real assignee','in_progress','manual',now());
      update public.team_members set team='video', role='editor', active=true where id=${literal(EDITOR)}::uuid;
    `);
    capability('native', EPOCH);

    ok('the fixture derives auth_kind the way eventFor does, and that is still how eventFor builds it',
      GATEWAY.includes('auth_kind: principal.kind,'));
    ok('the TEST principal still has kind "test", which is what a staff-only gate refuses',
      /kind: "test",[\s\S]{0,400}?testOnly: true,/.test(GATEWAY));

    /* ---------- BEFORE: #1413's parity is unreachable through the gateway ---------- */
    ok('BEFORE: a TEST assignment sent the way the GATEWAY sends it is refused',
      rejection(`select public.production_assignee_write(${json({
        id: 'ak-test', client_slug: 'fixture-client', team: 'video', assignee_id: EDITOR,
      })},${json(assigneeEvent({ id: 'ak-test', dedup: 'write-ui:assignee:deliverable:ak-test:before', testOnly: true }))})`,
      /assignment_scope_forbidden/));

    /* The control that makes the line above mean something: the SAME request
       with the hand-built auth_kind #1413's rehearsal used DOES pass here. That
       is precisely the gap between what was proved and what ships. */
    assigneeWrite({ id: 'ak-test', slug: 'fixture-client', dedup: 'write-ui:assignee:deliverable:ak-test:handbuilt', testOnly: true, authKind: 'staff' });
    ok('CONTROL: the same write with a hand-built auth_kind "staff" succeeds -- the exact blind spot',
      scalar(cluster, `select assignee_id::text from public.deliverables where id='ak-test'`) === EDITOR);

    ok('BEFORE: a real-client assignment works, so the refusal is about auth_kind alone',
      !!assigneeWrite({ id: 'ak-real', slug: 'authkind-real', dedup: 'write-ui:assignee:deliverable:ak-real:before', testOnly: false }));

    /* ---------- AFTER ---------- */
    const aclBefore = scalar(cluster, `select coalesce(string_agg(r.rolname,',' order by r.rolname),'(none)')
      from pg_proc p cross join (values('service_role'),('anon'),('authenticated')) r(rolname)
      where p.pronamespace='public'::regnamespace and p.proname='production_assignee_write'
        and has_function_privilege(r.rolname,p.oid,'EXECUTE')`);

    cluster.runFile(path.join(MIGRATIONS, '2026-09-18-native-assignment-auth-kind-binding.sql'));

    const aclAfter = scalar(cluster, `select coalesce(string_agg(r.rolname,',' order by r.rolname),'(none)')
      from pg_proc p cross join (values('service_role'),('anon'),('authenticated')) r(rolname)
      where p.pronamespace='public'::regnamespace and p.proname='production_assignee_write'
        and has_function_privilege(r.rolname,p.oid,'EXECUTE')`);
    ok('ACL is unchanged across the replacement, and only service_role holds EXECUTE',
      aclAfter === aclBefore && aclAfter === 'service_role');

    assigneeWrite({ id: 'ak-test2', slug: 'fixture-client', dedup: 'write-ui:assignee:deliverable:ak-test2:after', testOnly: true });
    ok('AFTER: the TEST assignment sent the way the gateway sends it is ADMITTED',
      scalar(cluster, `select assignee_id::text from public.deliverables where id='ak-test2'`) === EDITOR);
    const row = jsonRows(cluster, `select status,test_only,legacy_parity,linear_result
      from public.mirror_outbox where dedup_key='write-ui:assignee:deliverable:ak-test2:after'`)[0];
    ok('its receipt is terminal, native, and RECORDS test_only = true',
      row.status === 'skipped' && row.test_only === true && row.legacy_parity === false
        && row.linear_result.native_assignment === true);

    /* The binding, both directions. */
    ok('THE BINDING: a TEST write claiming auth_kind "staff" is now REFUSED -- the control above would fail today',
      rejection(`select public.production_assignee_write(${json({
        id: 'ak-test', client_slug: 'fixture-client', team: 'video', assignee_id: EDITOR,
      })},${json(assigneeEvent({ id: 'ak-test', dedup: 'write-ui:assignee:deliverable:ak-test:mismatch1', testOnly: true, authKind: 'staff' }))})`,
      /assignment_scope_forbidden/));
    ok('THE BINDING: a real-client write claiming auth_kind "test" is refused',
      rejection(`select public.production_assignee_write(${json({
        id: 'ak-real', client_slug: 'authkind-real', team: 'video', assignee_id: EDITOR,
      })},${json(assigneeEvent({ id: 'ak-real', dedup: 'write-ui:assignee:deliverable:ak-real:mismatch2', testOnly: false, authKind: 'test' }))})`,
      /assignment_scope_forbidden/));
    ok('test_only must be a JSON boolean, not a string that casts like one',
      rejection(`select public.production_assignee_write(${json({
        id: 'ak-test', client_slug: 'fixture-client', team: 'video', assignee_id: EDITOR,
      })},${json(assigneeEvent({ id: 'ak-test', dedup: 'write-ui:assignee:deliverable:ak-test:strbool', testOnly: true, testOnlyRaw: 'true' }))})`,
      /assignment_scope_forbidden/));

    ok('AFTER: a real-client assignment still works unchanged',
      !!assigneeWrite({ id: 'ak-real', slug: 'authkind-real', dedup: 'write-ui:assignee:deliverable:ak-real:after', testOnly: false }));

    console.log(JSON.stringify({ marker: 'NATIVE_ASSIGNMENT_AUTH_KIND_OK', checks: passed }));
  } finally {
    if (cluster && cluster.stop) cluster.stop();
  }
}

main();
