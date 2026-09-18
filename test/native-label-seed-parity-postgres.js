'use strict';

/*
 * Actual PostgreSQL 16 proof of the two label-lane migrations on this PR:
 *   migrations/2026-09-18-native-label-empty-state-seed.sql
 *   migrations/2026-09-18-native-label-test-client-parity.sql
 * All identities are synthetic and the database is disposable; nothing here
 * reaches a live backend.
 *
 * THE TWO PROPERTIES.
 *
 * (1) THE SEED. A natively created card carries no label relation, so the
 *     gateway's nativeLabelSnapshot returns null and the Production tab shows
 *     "Labels unavailable" even with the capability on `native`. The seed gives
 *     those cards the empty-but-COMPLETE relation. Proved here against the
 *     PAGE'S OWN predicate -- a port of nativeLabelSnapshot that this file also
 *     re-reads out of index.ts, so the port cannot drift from the gateway it
 *     claims to model.
 *
 * (2) TEST-CLIENT PARITY. Before the parity migration the label lane refused a
 *     `test_only` write outright in both layers, so the test client could never
 *     exercise native labels. After it, each layer records the value and
 *     compares it, and the authority check receives the real value.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { bootCluster, MIGRATIONS, jsonRows, scalar } = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native label seed/parity PostgreSQL: F63 disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw Error('native label seed/parity proof requires loopback disposable PostgreSQL');
}
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

const ROOT = path.resolve(__dirname, '..');
let cluster;
let passed = 0;
const ok = (name, value) => { assert.ok(value, name); passed += 1; console.log(`  ok ${name}`); };
/* jsonb does not preserve object key order, so every structural comparison
   here goes through deepEqual rather than through JSON.stringify. */
const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch (_) { return false; } };
const literal = v => `'${String(v).replace(/'/g, "''")}'`;
const json = v => `${literal(JSON.stringify(v))}::jsonb`;

function rejection(sql, pattern) {
  try { cluster.exec(sql); } catch (error) {
    assert.match(String(error && error.message), pattern);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------------ *
 * The page's own check, ported -- and pinned to the source it models.
 * ------------------------------------------------------------------------ */

const GATEWAY = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');

/* A faithful port of nativeLabelSnapshot's ACCEPTANCE predicate: a nodes
   array, hasNextPage exactly false, and -- when labelIds is present -- the two
   id lists agreeing. This is what decides "Labels unavailable" versus an
   editable list. */
function nativeLabelSnapshot(linearRaw) {
  const raw = linearRaw && typeof linearRaw === 'object' && !Array.isArray(linearRaw) ? linearRaw : {};
  const issue = raw.issue && typeof raw.issue === 'object' && !Array.isArray(raw.issue) ? raw.issue : {};
  const conn = issue.labels && typeof issue.labels === 'object' && !Array.isArray(issue.labels) ? issue.labels : {};
  const nodes = Array.isArray(conn.nodes) ? conn.nodes : null;
  const pageInfo = conn.pageInfo && typeof conn.pageInfo === 'object' ? conn.pageInfo : {};
  if (!nodes || pageInfo.hasNextPage !== false) return null;
  const ids = nodes.map(n => String((n && n.id) || '').trim()).sort();
  if (Object.prototype.hasOwnProperty.call(issue, 'labelIds')) {
    const rawIds = issue.labelIds;
    if (!Array.isArray(rawIds)) return null;
    const sorted = rawIds.map(v => String(v || '').trim()).sort();
    if (JSON.stringify(sorted) !== JSON.stringify(ids)) return null;
  }
  return { ids };
}

/* The drift guard. If the gateway's own conditions change, this port is no
   longer a model of it and the proof below is worthless -- so fail here
   rather than keep asserting against a stale copy. */
function assertPortStillModelsGateway() {
  const start = GATEWAY.indexOf('function nativeLabelSnapshot(');
  assert.ok(start > 0, 'nativeLabelSnapshot is still defined in the gateway');
  const body = GATEWAY.slice(start, GATEWAY.indexOf('\n}', start));
  for (const fragment of [
    'const nodes = Array.isArray(connection.nodes) ? connection.nodes : null;',
    'if (!nodes || pageInfo.hasNextPage !== false) return null;',
    'if (Object.prototype.hasOwnProperty.call(issue, "labelIds"))',
  ]) assert.ok(body.includes(fragment), `the port still models: ${fragment}`);
  return body;
}

function labelRelation(id) {
  const row = jsonRows(cluster, `select linear_raw from public.deliverables where id=${literal(id)}`)[0];
  return row ? row.linear_raw : undefined;
}

/* auth_kind is NOT free to choose here. eventFor() emits `auth_kind:
   principal.kind` (index.ts:1557) and the TEST principal's kind is "test"
   (index.ts:1206), so a fixture that hard-codes 'staff' for a test_only write
   is not modelling the gateway -- it is modelling a request the gateway never
   sends. The first version of this file did exactly that and hid the fact that
   the lane was still unreachable; Codex caught it on PR #1414. */
function authKindFor(testOnly) { return testOnly ? 'test' : 'staff'; }

function labelsEvent({ dedup, id, testOnly = false, legacyParity = false, version, ids = [] }) {
  return {
    surface: 'production', auth_kind: authKindFor(testOnly), source: 'ui', action: 'labels_change',
    actor: 'Fixture Admin', role: 'admin',
    expected_updated_at: scalar(cluster, `select updated_at from public.deliverables where id=${literal(id)}`),
    outbound: {
      entity: 'deliverable', entity_id: id, operation: 'labels', dedup_key: dedup,
      source_edited_at: '2026-09-18T00:00:00Z', test_only: testOnly, legacy_parity: legacyParity,
      payload: {
        _intent_fingerprint: `fp-${dedup}`,
        _native_label_catalog_version: version,
        label_ids: ids,
      },
    },
  };
}

function labelsWrite({ id, slug, dedup, testOnly = false, legacyParity = false, version, ids = [] }) {
  return cluster.exec(`select public.production_labels_write(${json({
    id, client_slug: slug, team: 'video',
  })},${json(labelsEvent({ dedup, id, testOnly, legacyParity, version, ids }))})`);
}

function outboxRow(dedup) {
  return jsonRows(cluster, `select status,test_only,legacy_parity,payload,linear_result
    from public.mirror_outbox where dedup_key=${literal(dedup)}`)[0];
}

function capability(mode, versionId = null) {
  cluster.exec(`update public.syncview_runtime_flags set value=${json({
    schema_version: 1, mode, version_id: versionId,
  })} where key='production_native_label_catalog'`);
}

/* A minimal manifest the real checker accepts: one closed page, archived
   included, both teams distinct, count matching. Every id is invented. */
const VIDEO_TEAM = '11111111-1111-4111-8111-111111111111';
const GRAPHICS_TEAM = '22222222-2222-4222-8222-222222222222';
const LABEL_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const LABEL_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const VERSION = 'cccccccc-3333-4333-8333-cccccccccccc';
const CAPTURE = 'dddddddd-4444-4444-8444-dddddddddddd';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function manifest() {
  return {
    schema_version: 1,
    source_kind: 'linear_workspace_issue_labels',
    capture_id: CAPTURE,
    source_sha256: sha('synthetic-source'),
    workspace_fingerprint: sha('synthetic-workspace'),
    include_archived: true,
    captured_at: '2026-09-18T00:00:00Z',
    teams: { video: VIDEO_TEAM, graphics: GRAPHICS_TEAM },
    expected_count: 2,
    pages: [{
      after: null,
      nodes: [
        { id: LABEL_A, name: 'Fixture alpha', color: '#5e6ad2', description: null, isGroup: false, archivedAt: null, team: null },
        { id: LABEL_B, name: 'Fixture beta', color: '#26b5ce', description: null, isGroup: false, archivedAt: null, team: { id: VIDEO_TEAM } },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    }],
  };
}

function attestation(m) {
  return {
    contract: 'operator-reviewed-complete-export-v1',
    capture_id: m.capture_id,
    source_sha256: m.source_sha256,
    workspace_fingerprint: m.workspace_fingerprint,
    teams: m.teams,
    expected_count: m.expected_count,
    export_package_sha256: sha('synthetic-package'),
    review_evidence_sha256: sha('synthetic-evidence'),
    operator_subject: 'rehearsal',
    archived_pages_verified: true,
    independent_count_reconciled: true,
    reviewed_at: '2026-09-18T00:00:00Z',
  };
}

/* The routines the parity migration replaces, and the roles whose EXECUTE the
   replacement must not hand back. Measured, not assumed. */
const ACL_SQL = `select coalesce(string_agg(p.proname||':'||r.rolname,',' order by p.proname,r.rolname),'(none)')
  from pg_proc p
  cross join (values('service_role'),('anon'),('authenticated')) r(rolname)
  where p.pronamespace='public'::regnamespace
    and p.proname in ('production_labels_write','production_native_label_receipt_guard',
                      'production_native_label_empty_state','production_native_label_seed_guard')
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
      'workload-issues-supabase-migration.sql',
      '2026-07-19-workload-plan.sql',
      '2026-09-02-workload-native-view.sql',
      '2026-09-05-workload-native-membership.sql',
      '2026-09-08-workload-native-label-state-shape.sql',
      '2026-09-05-native-label-catalog-foundation.sql',
      '2026-09-06-native-label-writes.sql',
    ]) cluster.runFile(path.join(MIGRATIONS, file));

    cluster.exec(`
      update public.clients set kind='test' where slug='fixture-client';
      insert into public.clients(slug,display_name,active,kind)
        values ('label-real','Label real fixture',true,'client')
        on conflict (slug) do update set active=true, kind='client';
      update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}'::jsonb
        where key='prod_authority';
      insert into public.batches(id,client_slug,team,name,status) values
        ('lb-b','fixture-client','video','Label TEST fixture','active'),
        ('lb-rb','label-real','video','Label real fixture','active');
      insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,updated_at) values
        ('lbl-native','lb-b','fixture-client','video','video','TEST native card','in_progress','manual',now()),
        ('lbl-native2','lb-b','fixture-client','video','video','TEST native two','in_progress','manual',now()),
        ('lbl-real','lb-rb','label-real','video','video','Real native card','in_progress','manual',now());
      update public.deliverables set linear_issue_uuid='eeeeeeee-5555-4555-8555-eeeeeeeeeeee',
        linear_raw='{"issue":{"id":"eeeeeeee-5555-4555-8555-eeeeeeeeeeee"}}'::jsonb
        where id='lbl-native2';
    `);

    /* ================= (1) THE SEED ================= */

    ok('eventFor still emits auth_kind from principal.kind, which is what authKindFor models',
      GATEWAY.includes('auth_kind: principal.kind,'));
    ok('the TEST principal still has kind "test", so a staff-only gate would refuse it',
      /kind: "test",[\s\S]{0,400}?testOnly: true,/.test(GATEWAY));

    const gatewayBody = assertPortStillModelsGateway();
    ok('the ported snapshot check still models the gateway (3 conditions re-read from index.ts)', gatewayBody.length > 0);

    ok('BEFORE: a natively created card has NO label relation at all',
      labelRelation('lbl-native') === null);
    ok('BEFORE: the page check refuses it, which is what renders "Labels unavailable"',
      nativeLabelSnapshot(labelRelation('lbl-native')) === null);

    const beforeUpdatedAt = scalar(cluster, `select updated_at from public.deliverables where id='lbl-native'`);
    const outboxBefore = Number(scalar(cluster, 'select count(*) from public.mirror_outbox'));
    const eventsBefore = Number(scalar(cluster, 'select count(*) from public.deliverable_events'));

    cluster.runFile(path.join(MIGRATIONS, '2026-09-18-native-label-empty-state-seed.sql'));

    ok('AFTER: the existing native card carries the empty-but-complete relation',
      same(labelRelation('lbl-native').issue.labels,
        { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }));
    ok('AFTER: the PAGE\'S OWN check now accepts it, with an empty selection',
      same(nativeLabelSnapshot(labelRelation('lbl-native')), { ids: [] }));

    ok('the backfill did not move updated_at, so no open tab loses its CAS',
      scalar(cluster, `select updated_at from public.deliverables where id='lbl-native'`) === beforeUpdatedAt);
    ok('the backfill enqueued no outbox row',
      Number(scalar(cluster, 'select count(*) from public.mirror_outbox')) === outboxBefore);
    ok('the backfill wrote no deliverable event',
      Number(scalar(cluster, 'select count(*) from public.deliverable_events')) === eventsBefore);

    ok('a PROVIDER card (it has a linear_issue_uuid) is left exactly as it was',
      labelRelation('lbl-native2').issue.labels === undefined
        && labelRelation('lbl-native2').issue.id === 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee');

    cluster.exec(`insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,updated_at)
      values ('lbl-future','lb-b','fixture-client','video','video','Future native card','in_progress','manual',now())`);
    ok('a FUTURE native card is seeded on INSERT by the trigger',
      same(nativeLabelSnapshot(labelRelation('lbl-future')), { ids: [] }));

    /* The seed must be invisible to the weekly view. Both branches of the
       workload projection have to agree on an empty relation, or turning the
       label capability on silently re-weights every native card. */
    ok('workload: the seeded relation is no longer "absent"',
      scalar(cluster, `select public.workload_native_label_state_absent(linear_raw)::text
        from public.deliverables where id='lbl-native'`) === 'false');
    const projection = jsonRows(cluster, `select public.production_workload_label_projection(linear_raw) as p
      from public.deliverables where id='lbl-native'`)[0].p;
    ok('workload: the projection returns complete:true with an empty label list -- identical to the absent branch',
      projection.complete === true && JSON.stringify(projection.labels) === '[]');

    /* An already-present relation is never overwritten, complete or not. */
    cluster.exec(`update public.deliverables set linear_raw=${json({
      issue: { labels: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'cur' } } },
    })} where id='lbl-future'`);
    ok('a MALFORMED relation is left to keep failing loudly, not silently replaced',
      labelRelation('lbl-future').issue.labels.pageInfo.hasNextPage === true
        && nativeLabelSnapshot(labelRelation('lbl-future')) === null);

    /* ================= (2) TEST-CLIENT PARITY ================= */

    cluster.exec(`select public.production_label_catalog_stage_attested(
      ${literal(VERSION)}::uuid, ${json(manifest())}, ${json(attestation(manifest()))})`);
    ok('the synthetic catalog version staged and is operator-attested',
      scalar(cluster, `select (public.production_label_catalog_read_attested(${literal(VERSION)}::uuid,'video')->>'operator_attested')`) === 'true');

    const aclBefore = scalar(cluster, ACL_SQL);
    capability('native', VERSION);

    ok('BEFORE: a TEST label write is refused outright',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-native', client_slug: 'fixture-client', team: 'video',
      })},${json(labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:before', id: 'lbl-native', testOnly: true, version: VERSION, ids: [LABEL_A] }))})`,
      /native_label_scope_forbidden/));

    /* THE CONTROL that makes the line above mean what it says. If the lane
       refused every write at this point -- on dedup shape, role, catalog
       version, anything -- "a TEST write is refused" would prove nothing. A
       real-client write through the SAME path succeeds here, so the only thing
       the refusal above is about is test_only. */
    labelsWrite({ id: 'lbl-real', slug: 'label-real', dedup: 'write-ui:labels:deliverable:lbl-real:control', version: VERSION, ids: [LABEL_A] });
    ok('CONTROL: a real-client write succeeds BEFORE the parity migration, so the refusal above is about test_only alone',
      outboxRow('write-ui:labels:deliverable:lbl-real:control').status === 'skipped');

    cluster.runFile(path.join(MIGRATIONS, '2026-09-18-native-label-test-client-parity.sql'));

    ok('ACL is byte-identical across the replacement', scalar(cluster, ACL_SQL) === aclBefore);
    ok('only service_role holds EXECUTE, and only on the writer',
      aclBefore === 'production_labels_write:service_role');

    labelsWrite({ id: 'lbl-native', slug: 'fixture-client', dedup: 'write-ui:labels:deliverable:lbl-native:test', testOnly: true, version: VERSION, ids: [LABEL_A] });
    const testRow = outboxRow('write-ui:labels:deliverable:lbl-native:test');
    ok('AFTER: the TEST write is ADMITTED', !!testRow);
    ok('the TEST receipt is terminal with the native marker',
      testRow.status === 'skipped' && testRow.linear_result.native_labels === true
        && testRow.linear_result.catalog_version === VERSION);
    ok('the receipt RECORDS test_only = true', testRow.test_only === true);
    ok('the TEST card now carries the selected label, and the page check accepts it',
      same(nativeLabelSnapshot(labelRelation('lbl-native')), { ids: [LABEL_A] }));

    labelsWrite({ id: 'lbl-real', slug: 'label-real', dedup: 'write-ui:labels:deliverable:lbl-real:real', testOnly: false, version: VERSION, ids: [LABEL_A] });
    const realRow = outboxRow('write-ui:labels:deliverable:lbl-real:real');
    ok('a REAL-client write behaves identically', realRow.status === 'skipped'
      && realRow.linear_result.native_labels === true && realRow.test_only === false);

    /* The compare. production_outbox_replay now receives the real value, so a
       replay whose scope disagrees with the retained receipt is refused. */
    ok('an exact TEST replay is idempotent',
      !!labelsWrite({ id: 'lbl-native', slug: 'fixture-client', dedup: 'write-ui:labels:deliverable:lbl-native:test', testOnly: true, version: VERSION, ids: [LABEL_A] }));
    ok('THE COMPARE: replaying a TEST receipt as a real-client write is refused',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-native', client_slug: 'fixture-client', team: 'video',
      })},${json(labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:test', id: 'lbl-native', testOnly: false, version: VERSION, ids: [LABEL_A] }))})`,
      /idempotency_conflict/));

    /* The binding's own controls. auth_kind and test_only must agree in BOTH
       directions, so a forged event carrying one without the other is refused
       -- which is what stops "auth_kind: test" being a way to write as the
       test client without the authority check that goes with it. */
    ok('THE BINDING: a TEST write claiming auth_kind "staff" is refused',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-native', client_slug: 'fixture-client', team: 'video',
      })},${json({ ...labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:mismatch1', id: 'lbl-native', testOnly: true, version: VERSION, ids: [LABEL_B] }), auth_kind: 'staff' })})`,
      /native_label_scope_forbidden/));
    ok('THE BINDING: a real-client write claiming auth_kind "test" is refused',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-real', client_slug: 'label-real', team: 'video',
      })},${json({ ...labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-real:mismatch2', id: 'lbl-real', testOnly: false, version: VERSION, ids: [LABEL_B] }), auth_kind: 'test' })})`,
      /native_label_scope_forbidden/));
    ok('test_only must be a JSON boolean, not a string that casts like one',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-native', client_slug: 'fixture-client', team: 'video',
      })},${json({ ...labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:strbool', id: 'lbl-native', testOnly: true, version: VERSION, ids: [LABEL_B] }), outbound: { ...labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:strbool', id: 'lbl-native', testOnly: true, version: VERSION, ids: [LABEL_B] }).outbound, test_only: 'true' } })})`,
      /native_label_scope_forbidden/));

    ok('legacy_parity is STILL refused on the label lane',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-native', client_slug: 'fixture-client', team: 'video',
      })},${json(labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:parity', id: 'lbl-native', legacyParity: true, version: VERSION, ids: [LABEL_A] }))})`,
      /native_label_scope_forbidden/));

    ok('a NON-test client claiming test_only is refused by the authority check',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-real', client_slug: 'label-real', team: 'video',
      })},${json(labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-real:fake', id: 'lbl-real', testOnly: true, version: VERSION, ids: [LABEL_A] }))})`,
      /test_client_scope_required/));

    capability('hold');
    ok('mode hold still blocks a TEST write',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-native', client_slug: 'fixture-client', team: 'video',
      })},${json(labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:held', id: 'lbl-native', testOnly: true, version: VERSION, ids: [LABEL_B] }))})`,
      /native_label_catalog_held/));

    capability('provider');
    ok('mode provider still refuses a marker-carrying TEST row',
      rejection(`select public.production_labels_write(${json({
        id: 'lbl-native', client_slug: 'fixture-client', team: 'video',
      })},${json(labelsEvent({ dedup: 'write-ui:labels:deliverable:lbl-native:provider', id: 'lbl-native', testOnly: true, version: VERSION, ids: [LABEL_B] }))})`,
      /native_label_catalog_held|native_label_catalog_changed/));

    console.log(JSON.stringify({ marker: 'NATIVE_LABEL_SEED_PARITY_OK', checks: passed }));
  } finally {
    if (cluster && cluster.stop) cluster.stop();
  }
}

main();
