'use strict';

/* Actual PostgreSQL 16 proof. All identities are synthetic and the database is disposable. */
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  bootCluster, connectionEnv, psqlAsync, MIGRATIONS, count, jsonRows, scalar,
} = require('../scripts/linear-exit-composition/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP linear exit owner composition: F63 disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw Error('native ordinary receipt proof requires loopback disposable PostgreSQL');
}
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

let cluster;
let composedDirectory;
let composedArtifact;
let passed = 0;
const ok = (name, value) => {
  assert.ok(value, name);
  passed += 1;
  console.log(`  ok ${name}`);
};
const literal = value => `'${String(value).replace(/'/g, "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;

function event({
  dedup, entity = 'deliverable', id = 'nor-d', operation = 'status',
  source = '2026-09-09T00:00:00Z', actor = 'Fixture Admin', role = 'admin',
  fingerprint = `fp-${dedup}`, testOnly = false, legacyParity = false, generation = 0,
}) {
  // Match the real gateway envelope: scope is derived from the locked row.
  return {
    source: 'ui', action: `${operation}_change`, actor, role, ts: source,
    outbound: {
      entity, entity_id: id, operation, dedup_key: dedup,
      source_edited_at: source, test_only: testOnly, legacy_parity: legacyParity,
      payload: {
        _intent_fingerprint: fingerprint,
        _f27_authority_generation: generation,
        _f27_legacy_parity: legacyParity,
      },
    },
  };
}

function setCapability(mode, epoch = null) {
  cluster.exec(`update public.syncview_runtime_flags set value=${json({
    schema_version: 1,
    video: { mode, epoch }, graphics: { mode, epoch },
  })} where key='production_native_ordinary_receipts'`);
}

function receipt(dedup) {
  return jsonRows(cluster, `
    select o.entity,o.operation,o.status,o.test_only,o.legacy_parity,o.source_edited_at,
      o.payload->'_native_ordinary_receipt' marker,o.linear_result,
      a.owner,a.native_operation,a.receipt_operation,a.source_edited_at admission_source,
      a.receipt_id=o.id receipt_attached,
      a.token::text=o.payload->'_native_ordinary_receipt'->>'token' token_attached
    from public.mirror_outbox o
    join public.production_native_ordinary_receipt_admissions a on a.receipt_id=o.id
    where o.dedup_key=${literal(dedup)}
  `)[0];
}

function assertReceipt(dedup, owner, nativeOperation, entity = 'deliverable') {
  const row = receipt(dedup);
  assert.ok(row, `${dedup}: joined durable receipt missing`);
  assert.deepEqual({
    entity: row.entity, operation: row.operation, owner: row.owner,
    nativeOperation: row.native_operation, receiptOperation: row.receipt_operation,
    status: row.status, testOnly: row.test_only, legacyParity: row.legacy_parity,
    receiptAttached: row.receipt_attached, tokenAttached: row.token_attached,
    markerOwner: row.marker.owner, markerOperation: row.marker.operation,
    resultNative: row.linear_result.native_ordinary,
    resultOwner: row.linear_result.owner, resultOperation: row.linear_result.operation,
  }, {
    entity, operation: entity === 'comment' ? 'comment' : nativeOperation, owner,
    nativeOperation, receiptOperation: entity === 'comment' ? 'comment' : nativeOperation,
    status: 'skipped', testOnly: false, legacyParity: false,
    receiptAttached: true, tokenAttached: true,
    markerOwner: owner, markerOperation: nativeOperation,
    resultNative: true, resultOwner: owner, resultOperation: nativeOperation,
  }, `${dedup}: terminal receipt identity drifted`);
  assert.match(row.marker.epoch, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
  assert.equal(row.linear_result.epoch, row.marker.epoch);
  assert.equal(row.admission_source, row.source_edited_at);
}

function rejection(sql, pattern) {
  try {
    cluster.exec(sql);
  } catch (error) {
    assert.match(String(error && error.message), pattern);
    return true;
  }
  return false;
}

function deliverableWrite(id, patch, outboundEvent) {
  return cluster.exec(`select public.production_deliverable_write(${json({
    id, client_slug: 'fixture-client', team: id === 'nor-art' ? 'graphics' : 'video', ...patch,
  })},${json(outboundEvent)})`);
}

function commentSnapshot() {
  return jsonRows(cluster, `select id,body,version,updated_at,source_updated_at,
    deleted_at,resolved_at from public.production_comments where id='nor-comment'`)[0];
}

function lifecycle(action, dedup, prior, fields = {}, eventOverrides = {}) {
  const outboundEvent = event({
    dedup, entity: 'comment', id: 'nor-d', operation: 'comment',
    source: '2026-09-09T00:10:00Z', ...eventOverrides,
  });
  return cluster.exec(`select public.production_comment_lifecycle_write(${json({
    id: 'nor-comment', operation: action, source_updated_at: '2026-09-09T00:10:00Z', ...fields,
  })},${json(outboundEvent)},${Number(prior.version)},${literal(prior.updated_at)}::timestamptz)`);
}

async function main() {
  try {
    cluster = bootCluster();
    // Real production owners only. Fail at the first unfulfilled prerequisite.
    for (const file of [
      '2026-09-05-native-intake-root-manifest.sql',
      '2026-09-05-native-label-catalog-foundation.sql',
    ]) { console.log('COMPOSITION_APPLY ' + file); cluster.runFile(path.join(MIGRATIONS,file)); }
    const composed = require(path.join(MIGRATIONS,'../scripts/native-intake-named-append-compose')).fromRepository();
    composedDirectory = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'composition-'));
    const artifact = composedArtifact = path.join(composedDirectory,'atomic-intake.sql');
    require('node:fs').writeFileSync(artifact,composed.sql);
    console.log('COMPOSITION_APPLY atomic-intake ' + composed.manifest.composed_sha256);
    cluster.runFile(artifact);
    for (const file of [
      '2026-09-08-native-intake-receipt-retention.sql',
      '2026-09-06-native-existing-assignment.sql',
      '2026-09-06-native-label-writes.sql',
      '2026-07-04-a2-writer-edge-functions.sql',
      '2026-07-04-a4-settings-edge-functions.sql',
      '2026-07-13-write-ui-reroute-allowlist.sql',
      '2026-08-04-client-access-auto-provision.sql',
      '2026-09-09-native-client-provisioning.sql',
      'workload-issues-supabase-migration.sql',
      '2026-07-19-workload-plan.sql',
      '2026-09-02-workload-native-view.sql',
      '2026-09-05-workload-native-membership.sql',
      '2026-09-08-workload-native-label-state-shape.sql',
      '2026-09-09-workload-native-roster.sql',
      '2026-09-09-native-attribution-browser-projection.sql',
    ]) { console.log('COMPOSITION_APPLY ' + file); cluster.runFile(path.join(MIGRATIONS,file)); }


    for (const file of [
      '2026-09-09-editors-event-assignee.sql',
      '2026-09-09-native-ordinary-receipts.sql',
      '2026-09-11-native-ordinary-receipt-repair.sql',
      '2026-09-12-native-ordinary-envelope-repair.sql',
    ]) cluster.runFile(path.join(MIGRATIONS, file));

    cluster.exec(`
      update public.clients set kind='test' where slug='fixture-client';
      insert into public.batches(id,client_slug,team,name,status)
      values ('nor-b','fixture-client','video','Ordinary fixture','active'),
             ('nor-b2','fixture-client','video','Second fixture','active'),
             ('nor-gb','fixture-client','graphics','Artifact fixture','active');
      insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,updated_at)
      values ('nor-d','nor-b','fixture-client','video','video','Before','in_progress','manual',now()),
             ('nor-d2','nor-b','fixture-client','video','video','Race target','in_progress','manual',now()),
             ('nor-art','nor-gb','fixture-client','graphics','thumbnail','Artifact before','in_progress','manual',now());
    `);

    // Provider mode preserves TEST and legacy-parity provider receipts.
    setCapability('provider');
    deliverableWrite('nor-d', { status: 'todo' }, event({ dedup: 'provider-test', testOnly: true }));
    let provider = jsonRows(cluster, `select status,test_only,legacy_parity,payload
      from public.mirror_outbox where dedup_key='provider-test'`)[0];
    ok('provider TEST writes one pending provider receipt and no admission',
      provider.status === 'pending' && provider.test_only === true
      && !('_native_ordinary_receipt' in provider.payload)
      && count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='provider-test'") === 0);

    cluster.exec(`update public.syncview_runtime_flags set value='{"video":"linear","graphics":"syncview"}'::jsonb where key='prod_authority'`);
    deliverableWrite('nor-d', { status: 'in_progress' }, event({ dedup: 'provider-parity', legacyParity: true }));
    provider = jsonRows(cluster, `select status,test_only,legacy_parity,payload
      from public.mirror_outbox where dedup_key='provider-parity'`)[0];
    ok('provider legacy parity remains pending, parity-stamped, and unadmitted',
      provider.status === 'pending' && provider.test_only === false && provider.legacy_parity === true
      && !('_native_ordinary_receipt' in provider.payload)
      && count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='provider-parity'") === 0);
    cluster.exec(`update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}'::jsonb where key='prod_authority'`);

    const providerComment = {
      id: 'provider-comment', native_comment_id: 'provider-comment', idempotency_key: 'provider-comment-add',
      deliverable_id: 'nor-d', team: 'video', operation: 'add',
      author_key: 'fixture-admin', author_name: 'Fixture Admin', role: 'admin',
      body: 'Provider-era comment', audience: 'internal', origin: 'native', source: 'ui',
      source_created_at: '2026-09-09T00:01:00Z', source_updated_at: '2026-09-09T00:01:00Z',
    };
    const providerCommentEvent = event({
      dedup: 'provider-comment-add', entity: 'comment', id: 'nor-d', operation: 'comment',
      source: '2026-09-09T00:01:00Z',
    });
    cluster.exec(`select public.production_comment_write(${json(providerComment)},${json(providerCommentEvent)})`);
    const providerCommentBefore = jsonRows(cluster, `select version,updated_at from public.production_comments
      where id='provider-comment'`)[0];
    const providerResolveEvent = event({
      dedup: 'provider-comment-resolve', entity: 'comment', id: 'nor-d', operation: 'comment',
      source: '2026-09-09T00:02:00Z',
    });
    const providerResolve = {
      id: 'provider-comment', operation: 'resolve', resolved_by_key: 'fixture-admin',
      resolved_by_name: 'Fixture Admin', source_updated_at: '2026-09-09T00:02:00Z',
    };
    cluster.exec(`select public.production_comment_lifecycle_write(${json(providerResolve)},${json(providerResolveEvent)},
      ${Number(providerCommentBefore.version)},${literal(providerCommentBefore.updated_at)}::timestamptz)`);
    const providerResolveReceipts = count(cluster,
      "select * from public.production_comment_mutation_receipts where dedup_key='provider-comment-resolve'");
    cluster.exec(`select public.production_comment_lifecycle_write(${json(providerResolve)},${json(providerResolveEvent)},
      ${Number(providerCommentBefore.version)},${literal(providerCommentBefore.updated_at)}::timestamptz)`);
    ok('provider resolve keeps established no-outbox replay behavior',
      providerResolveReceipts === 1
      && count(cluster, "select * from public.production_comment_mutation_receipts where dedup_key='provider-comment-resolve'") === 1
      && count(cluster, "select * from public.mirror_outbox where dedup_key='provider-comment-resolve'") === 0
      && count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='provider-comment-resolve'") === 0);

    setCapability('native', 'proof-1');
    const deliverableCases = [
      ['status', { status: 'todo' }, "status='todo'"],
      ['due', { due_date: '2026-09-30' }, "due_date='2026-09-30'::date"],
      ['title', { title: 'After title' }, "title='After title'"],
      ['priority', { priority: 2 }, 'priority=2'],
      ['archive', { status: 'canceled' }, "status='canceled'"],
      ['restore', { status: 'in_progress' }, "status='in_progress'"],
      ['parent', { batch_id: 'nor-b2' }, "batch_id='nor-b2'"],
      ['description', { brief: 'Exact **native** description' }, "brief='Exact **native** description'"],
    ];
    for (const [operation, patch, rowPredicate] of deliverableCases) {
      const dedup = `native-${operation}`;
      deliverableWrite('nor-d', patch, event({ dedup, operation }));
      assertReceipt(dedup, 'deliverable', operation);
      assert.equal(scalar(cluster, `select (${rowPredicate}) from public.deliverables where id='nor-d'`), 't');
    }
    ok('every reachable scalar owner mutates its native row and joins one typed receipt',
      deliverableCases.every(([operation]) => count(cluster,
        `select * from public.mirror_outbox where dedup_key=${literal(`native-${operation}`)}`) === 1));

    const attachmentEvent = event({ dedup: 'native-attachment', id: 'nor-art', operation: 'attachment' });
    cluster.exec(`select public.production_artifact_write(${json({
      id: 'nor-art', client_slug: 'fixture-client', team: 'graphics',
      file_url: 'https://assets.example.invalid/native-proof.png',
    })},${json(attachmentEvent)})`);
    assertReceipt('native-attachment', 'deliverable', 'attachment');
    ok('actual artifact owner commits file, revision, and ordinary receipt atomically',
      scalar(cluster, `select file_url='https://assets.example.invalid/native-proof.png'
        and artifact_revision=1 from public.deliverables where id='nor-art'`) === 't');
    const artifactEvents = count(cluster, "select * from public.deliverable_events where payload->'outbound'->>'dedup_key'='native-attachment'");
    cluster.exec(`select public.production_artifact_write(${json({
      id: 'nor-art', client_slug: 'fixture-client', team: 'graphics',
      file_url: 'https://assets.example.invalid/native-proof.png',
    })},${json(attachmentEvent)})`);
    ok('artifact replay neither bumps revision nor emits a second event',
      scalar(cluster, "select artifact_revision=1 from public.deliverables where id='nor-art'") === 't'
      && count(cluster, "select * from public.deliverable_events where payload->'outbound'->>'dedup_key'='native-attachment'") === artifactEvents);

    // The gateway has no non-comment batch entity route; the old wrapper may
    // still make its historical provider intent but cannot relabel it native.
    cluster.exec(`select public.production_batch_write(${json({
      id: 'nor-b', client_slug: 'fixture-client', team: 'video', status: 'done',
    })},${json(event({ dedup: 'unsupported-batch', entity: 'batch', id: 'nor-b', operation: 'status' }))})`);
    ok('unsupported batch wrapper cannot mint a native ordinary receipt',
      scalar(cluster, "select status='pending' and not(payload?'_native_ordinary_receipt') from public.mirror_outbox where dedup_key='unsupported-batch'") === 't'
      && count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='unsupported-batch'") === 0);

    const commentAddEvent = event({
      dedup: 'comment-add', entity: 'comment', id: 'nor-d', operation: 'comment',
      source: '2030-01-01T00:00:00Z',
    });
    const commentAdd = {
      id: 'nor-comment', native_comment_id: 'nor-comment', idempotency_key: 'comment-add',
      deliverable_id: 'nor-d', team: 'video', operation: 'add',
      author_key: 'fixture-admin', author_name: 'Fixture Admin', role: 'admin',
      body: 'Original native comment', body_format: 'markdown', audience: 'internal',
      origin: 'native', source: 'ui', source_created_at: '2030-01-01T00:00:00Z',
      source_updated_at: '2030-01-01T00:00:00Z',
    };
    cluster.exec(`select public.production_comment_write(${json(commentAdd)},${json(commentAddEvent)})`);
    assertReceipt('comment-add', 'comment', 'comment', 'comment');
    const addCounts = {
      events: count(cluster, "select * from public.deliverable_events where payload->'comment'->>'id'='nor-comment'"),
      outbox: count(cluster, "select * from public.mirror_outbox where dedup_key='comment-add'"),
      admissions: count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='comment-add'"),
    };
    cluster.exec(`select public.production_comment_write(${json(commentAdd)},${json(commentAddEvent)})`);
    ok('comment add exact replay creates no second event, outbox row, or admission',
      count(cluster, "select * from public.deliverable_events where payload->'comment'->>'id'='nor-comment'") === addCounts.events
      && count(cluster, "select * from public.mirror_outbox where dedup_key='comment-add'") === addCounts.outbox
      && count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='comment-add'") === addCounts.admissions);
    ok('comment add changed actor conflicts against durable outbox identity', rejection(
      `select public.production_comment_write(${json(commentAdd)},${json({ ...commentAddEvent, actor: 'Different Fixture Actor' })})`,
      /idempotency_conflict/,
    ));
    ok('comment add changed outbound target conflicts with the stored receipt', rejection(
      `select public.production_comment_write(${json(commentAdd)},${json(event({
        dedup: 'comment-add', entity: 'comment', id: 'nor-d2', operation: 'comment',
        source: '2030-01-01T00:00:00Z',
      }))})`, /idempotency_conflict/,
    ));
    ok('comment add changed supplied comment target conflicts with the stored row', rejection(
      `select public.production_comment_write(${json({ ...commentAdd, deliverable_id: 'nor-d2' })},${json(commentAddEvent)})`,
      /idempotency_conflict/,
    ));

    let prior = commentSnapshot();
    const beforeEditEvents = count(cluster, "select * from public.deliverable_events where payload->'comment'->>'id'='nor-comment'");
    lifecycle('edit', 'comment-edit', prior, { body: 'Edited after future clock', edited_at: '2026-09-09T00:10:00Z' });
    let current = commentSnapshot();
    assertReceipt('comment-edit', 'comment', 'edit', 'comment');
    ok('future-clock edit persists body and admission binds the clamped source clock',
      current.body === 'Edited after future clock'
      && current.source_updated_at === prior.source_updated_at
      && count(cluster, "select * from public.deliverable_events where payload->'comment'->>'id'='nor-comment'") === beforeEditEvents + 1
      && scalar(cluster, `select a.source_edited_at=c.source_updated_at and o.source_edited_at=c.source_updated_at
        from public.production_native_ordinary_receipt_admissions a
        join public.mirror_outbox o on o.id=a.receipt_id
        join public.production_comments c on c.id=o.comment_id
        where a.dedup_key='comment-edit'`) === 't');
    const editCounts = {
      events: count(cluster, "select * from public.deliverable_events where payload->'comment'->>'id'='nor-comment'"),
      outbox: count(cluster, "select * from public.mirror_outbox where dedup_key='comment-edit'"),
    };
    lifecycle('edit', 'comment-edit', prior, { body: 'Edited after future clock', edited_at: '2026-09-09T00:10:00Z' });
    ok('comment edit replay runs before stale CAS and creates nothing',
      count(cluster, "select * from public.deliverable_events where payload->'comment'->>'id'='nor-comment'") === editCounts.events
      && count(cluster, "select * from public.mirror_outbox where dedup_key='comment-edit'") === editCounts.outbox);
    ok('comment lifecycle changed role conflicts against durable outbox identity', rejection(
      `select public.production_comment_lifecycle_write(${json({
        id: 'nor-comment', operation: 'edit', body: 'Edited after future clock', source_updated_at: '2026-09-09T00:10:00Z',
      })},${json(event({
        dedup: 'comment-edit', entity: 'comment', id: 'nor-d', operation: 'comment',
        source: '2026-09-09T00:10:00Z', role: 'smm',
      }))},${Number(prior.version)},${literal(prior.updated_at)}::timestamptz)`, /idempotency_conflict/,
    ));
    ok('comment lifecycle changed target conflicts before stale CAS adoption', rejection(
      `select public.production_comment_lifecycle_write(${json({
        id: 'nor-comment', operation: 'edit', body: 'Edited after future clock', source_updated_at: '2026-09-09T00:10:00Z',
      })},${json(event({
        dedup: 'comment-edit', entity: 'comment', id: 'nor-d2', operation: 'comment',
        source: '2026-09-09T00:10:00Z',
      }))},${Number(prior.version)},${literal(prior.updated_at)}::timestamptz)`, /idempotency_conflict/,
    ));

    prior = current;
    lifecycle('resolve', 'comment-resolve', prior, {
      resolved_by_key: 'fixture-admin', resolved_by_name: 'Fixture Admin',
    });
    current = commentSnapshot();
    assertReceipt('comment-resolve', 'comment', 'resolve', 'comment');
    ok('native resolve commits lifecycle state plus a terminal completion row',
      !!current.resolved_at && scalar(cluster, "select payload->>'action'='resolve' from public.mirror_outbox where dedup_key='comment-resolve'") === 't');

    prior = current;
    lifecycle('unresolve', 'comment-unresolve', prior);
    current = commentSnapshot();
    assertReceipt('comment-unresolve', 'comment', 'unresolve', 'comment');
    ok('native unresolve clears state and still has a terminal completion row',
      current.resolved_at == null && scalar(cluster, "select payload->>'action'='unresolve' from public.mirror_outbox where dedup_key='comment-unresolve'") === 't');

    prior = current;
    lifecycle('delete', 'comment-delete', prior, {
      deleted_by_key: 'fixture-admin', deleted_by_name: 'Fixture Admin',
    });
    current = commentSnapshot();
    assertReceipt('comment-delete', 'comment', 'delete', 'comment');
    ok('native delete commits deletion state and terminal receipt together',
      !!current.deleted_at && scalar(cluster, "select payload->>'action'='delete' from public.mirror_outbox where dedup_key='comment-delete'") === 't');

    // Accepted native replay precedes capability evaluation; fresh hold refuses atomically.
    const replayEvents = count(cluster, "select * from public.deliverable_events where payload->'outbound'->>'dedup_key'='native-status'");
    setCapability('hold');
    deliverableWrite('nor-d', { status: 'todo' }, event({ dedup: 'native-status', operation: 'status' }));
    const heldBefore = {
      title: scalar(cluster, "select title from public.deliverables where id='nor-d'"),
      events: count(cluster, 'select * from public.deliverable_events'),
      outbox: count(cluster, 'select * from public.mirror_outbox'),
      admissions: count(cluster, 'select * from public.production_native_ordinary_receipt_admissions'),
    };
    ok('hold adopts an exact accepted receipt without another mutation',
      count(cluster, "select * from public.deliverable_events where payload->'outbound'->>'dedup_key'='native-status'") === replayEvents);
    ok('fresh hold rolls back row, event, outbox, and admission', rejection(
      `select public.production_deliverable_write(${json({
        id: 'nor-d', client_slug: 'fixture-client', team: 'video', title: 'must roll back',
      })},${json(event({ dedup: 'held-fresh', operation: 'title' }))})`, /native_ordinary_receipt_held/,
    ) && scalar(cluster, "select title from public.deliverables where id='nor-d'") === heldBefore.title
      && count(cluster, 'select * from public.deliverable_events') === heldBefore.events
      && count(cluster, 'select * from public.mirror_outbox') === heldBefore.outbox
      && count(cluster, 'select * from public.production_native_ordinary_receipt_admissions') === heldBefore.admissions);

    // SHARE lock on capability serializes a flip behind an admitted transaction.
    setCapability('native', 'race-old');
    cluster.exec(`
      create or replace function public.nir_fixture_pause_receipt() returns trigger
      language plpgsql as $fn$ begin
        if new.dedup_key='race-capability' then perform pg_sleep(0.5); end if;
        return new;
      end $fn$;
      create trigger aaa_nir_fixture_pause before insert on public.mirror_outbox
      for each row execute function public.nir_fixture_pause_receipt();
    `);
    const raceEvent = event({ dedup: 'race-capability', id: 'nor-d2', operation: 'title' });
    const env = connectionEnv(cluster);
    const [writeRace, flipRace] = await Promise.all([
      psqlAsync(env, `select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'Race committed',
      })},${json(raceEvent)});`),
      psqlAsync(env, `select pg_sleep(0.1); update public.syncview_runtime_flags set value=${json({
        schema_version: 1,
        video: { mode: 'hold', epoch: null }, graphics: { mode: 'hold', epoch: null },
      })} where key='production_native_ordinary_receipts';`),
    ]);
    assert.equal(writeRace.status, 0, writeRace.stderr);
    assert.equal(flipRace.status, 0, flipRace.stderr);
    assertReceipt('race-capability', 'deliverable', 'title');
    ok('overlapping capability flip preserves the accepted transaction epoch',
      receipt('race-capability').marker.epoch === 'race-old'
      && scalar(cluster, "select value->'video'->>'mode'='hold' from public.syncview_runtime_flags where key='production_native_ordinary_receipts'") === 't');
    cluster.exec('drop trigger aaa_nir_fixture_pause on public.mirror_outbox; drop function public.nir_fixture_pause_receipt()');

    // Model the installed F27 BEFORE INSERT generation boundary. Its rejection
    // occurs after admission and owner work, so all evidence must roll back.
    setCapability('native', 'proof-f27');
    // The installed production F27 owner enforces generation checks.
    const f27Before = {
      title: scalar(cluster, "select title from public.deliverables where id='nor-d2'"),
      events: count(cluster, 'select * from public.deliverable_events'),
      outbox: count(cluster, 'select * from public.mirror_outbox'),
      admissions: count(cluster, 'select * from public.production_native_ordinary_receipt_admissions'),
    };
    ok('F27 generation rejection rolls back row, event, receipt, and admission', rejection(
      `select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'Wrong generation',
      })},${json(event({ dedup: 'f27-reject', id: 'nor-d2', operation: 'title', generation: 99 }))})`, /f27_authority_generation_stale:video/,
    ) && scalar(cluster, "select title from public.deliverables where id='nor-d2'") === f27Before.title
      && count(cluster, 'select * from public.deliverable_events') === f27Before.events
      && count(cluster, 'select * from public.mirror_outbox') === f27Before.outbox
      && count(cluster, 'select * from public.production_native_ordinary_receipt_admissions') === f27Before.admissions);
    deliverableWrite('nor-d2', { title: 'Right generation' }, event({
      dedup: 'f27-accept', id: 'nor-d2', operation: 'title', generation: 0,
    }));
    assertReceipt('f27-accept', 'deliverable', 'title');

    // Concurrent exact calls share the production dedup advisory lock.
    const exactEvent = event({ dedup: 'race-exact', id: 'nor-d2', operation: 'priority' });
    const exactCall = `select public.production_deliverable_write(${json({
      id: 'nor-d2', client_slug: 'fixture-client', team: 'video', priority: 3,
    })},${json(exactEvent)});`;
    const exactRace = await Promise.all([psqlAsync(env, exactCall), psqlAsync(env, exactCall)]);
    assert.deepEqual(exactRace.map(result => result.status), [0, 0], exactRace.map(result => result.stderr).join('\n'));
    ok('overlapping exact writes return twice but commit one event and admission',
      count(cluster, "select * from public.mirror_outbox where dedup_key='race-exact'") === 1
      && count(cluster, "select * from public.deliverable_events where payload->'outbound'->>'dedup_key'='race-exact'") === 1
      && count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='race-exact'") === 1);

    const changedA = event({ dedup: 'race-changed', id: 'nor-d2', operation: 'title', fingerprint: 'race-a' });
    const changedB = event({ dedup: 'race-changed', id: 'nor-d2', operation: 'title', fingerprint: 'race-b' });
    const changed = await Promise.all([
      psqlAsync(env, `select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'Race A',
      })},${json(changedA)});`),
      psqlAsync(env, `select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'Race B',
      })},${json(changedB)});`),
    ]);
    ok('changed-fingerprint race has one winner, one conflict, and one receipt',
      changed.filter(result => result.status === 0).length === 1
      && changed.filter(result => result.status !== 0 && /idempotency_conflict/.test(result.stderr)).length === 1
      && count(cluster, "select * from public.mirror_outbox where dedup_key='race-changed'") === 1
      && count(cluster, "select * from public.production_native_ordinary_receipt_admissions where dedup_key='race-changed'") === 1);

    const admissionCount = count(cluster, 'select * from public.production_native_ordinary_receipt_admissions');
    ok('caller-forged marker cannot become a receipt', rejection(`
      insert into public.mirror_outbox(
        deliverable_id,op,payload,entity,entity_id,operation,client_slug,team,
        dedup_key,source_edited_at,status,actor,role,test_only,legacy_parity
      ) values(
        'nor-d','update_state',${json({
          _intent_fingerprint: 'forged',
          _native_ordinary_receipt: {
            schema: 1, epoch: 'proof-f27', owner: 'deliverable', operation: 'status',
            token: '00000000-0000-4000-8000-000000000000',
          },
        })},'deliverable','nor-d','status','fixture-client','video','forged',now(),
        'pending','Fixture Admin','admin',false,false
      )`, /native_ordinary_receipt_invalid/)
      && count(cluster, 'select * from public.production_native_ordinary_receipt_admissions') === admissionCount);

    const rollbackBefore = {
      title: scalar(cluster, "select title from public.deliverables where id='nor-d2'"),
      events: count(cluster, 'select * from public.deliverable_events'),
      outbox: count(cluster, 'select * from public.mirror_outbox'),
      admissions: count(cluster, 'select * from public.production_native_ordinary_receipt_admissions'),
    };
    ok('failure after receipt insertion rolls back all native evidence', rejection(`
      begin;
      select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'Rollback candidate',
      })},${json(event({ dedup: 'forced-rollback', id: 'nor-d2', operation: 'title' }))});
      select 1/0;
      commit;
    `, /division by zero/)
      && scalar(cluster, "select title from public.deliverables where id='nor-d2'") === rollbackBefore.title
      && count(cluster, 'select * from public.deliverable_events') === rollbackBefore.events
      && count(cluster, 'select * from public.mirror_outbox') === rollbackBefore.outbox
      && count(cluster, 'select * from public.production_native_ordinary_receipt_admissions') === rollbackBefore.admissions);

    ok('terminal receipt rejects status mutation', rejection(
      "update public.mirror_outbox set status='pending' where dedup_key='native-title'",
      /native_ordinary_receipt_immutable/,
    ));
    ok('terminal receipt rejects deletion', rejection(
      "delete from public.mirror_outbox where dedup_key='native-title'", /native_ordinary_receipt_retained/,
    ));
    ok('terminal receipts reject table truncation', rejection(
      'truncate table public.mirror_outbox cascade', /native_ordinary_receipt_retained/,
    ));
    ok('admission table remains inaccessible to service_role',
      scalar(cluster, "select not has_table_privilege('service_role','public.production_native_ordinary_receipt_admissions','select')") === 't');

    // Deliberate interruption boundary: persisted ordinary receipt, real owners,
    // admission not installed. No migration replay on resumption.
    const interruptedReceipt = scalar(cluster,"select md5(row_to_json(o)::text) from public.mirror_outbox o where dedup_key='native-title'");
    ok('interrupted install preserves a real native receipt before admission exists',
      !!interruptedReceipt && scalar(cluster,"select to_regprocedure('public.production_syncview_retirement_activate(text)') is null") === 't');
    ok('all four prerequisite guards use real production owner functions', scalar(cluster, `
      select count(*)=4 and bool_and(p.proname not like '%fixture%')
      from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid='public.mirror_outbox'::regclass and t.tgenabled='O'
      and t.tgname in ('track_b_f27_hold_guard','zz_native_intake_receipt_guard','zzz_native_assignment_receipt_guard','zzz_native_label_receipt_guard')`) === 't');
    cluster.runFile(path.join(MIGRATIONS, '2026-09-09-syncview-retirement-admission.sql'));
    cluster.runFile(path.join(MIGRATIONS, '2026-09-10-syncview-retirement-native-ordinary-recognizer.sql'));
    ok('resume preserves exact pre-interruption receipt', interruptedReceipt === scalar(cluster,"select md5(row_to_json(o)::text) from public.mirror_outbox o where dedup_key='native-title'"));

    ok('real retirement activation remains an unconditional no-mutation refusal', rejection(
      "select public.production_syncview_retirement_activate('disposable fixture must stay blocked')",
      /syncview_retirement_native_receipt_contract_required/,
    ) && scalar(cluster, "select mode from public.syncview_retirement_admission where singleton") === 'active');

    ok('retirement recognizer accepts an actual typed ordinary receipt',
      scalar(cluster, `select public.production_syncview_retirement_typed_native_receipt(o)
        from public.mirror_outbox o where dedup_key='native-title'`) === 't');
    const malformed = {
      entity: 'deliverable', entity_id: 'nor-d', operation: 'status', status: 'skipped',
      payload: { _native_ordinary_receipt: { schema: 1, epoch: '', owner: '', operation: '', token: '' } },
      linear_result: { native_ordinary: true, epoch: '', owner: '', operation: '' },
    };
    ok('retirement recognizer rejects empty marker identity and token',
      scalar(cluster, `select public.production_syncview_retirement_typed_native_receipt(
        jsonb_populate_record(null::public.mirror_outbox,${json(malformed)}))`) === 'f');
    const wrongBinding = {
      ...malformed, entity: 'comment', operation: 'comment',
      payload: { _native_ordinary_receipt: {
        schema: 1, epoch: 'proof-1', owner: 'deliverable', operation: 'status',
        token: '00000000-0000-4000-8000-000000000001',
      } },
      linear_result: { native_ordinary: true, epoch: 'proof-1', owner: 'deliverable', operation: 'status' },
    };
    ok('retirement recognizer rejects owner/entity/operation mismatch',
      scalar(cluster, `select public.production_syncview_retirement_typed_native_receipt(
        jsonb_populate_record(null::public.mirror_outbox,${json(wrongBinding)}))`) === 'f');

    // Exercise the real guard's retired predicate without making activation
    // executable. This direct state change is confined to the disposable
    // superuser fixture and models the future activation transaction's table
    // lock, high-water capture, and singleton update.
    setCapability('native', 'retired-proof');
    cluster.exec(`
      begin;
      lock table public.mirror_outbox in share row exclusive mode;
      update public.syncview_retirement_admission
      set mode='retired', activated_at=clock_timestamp(),
          activated_reason='disposable protected fixture',
          high_water_outbox_id=(select coalesce(max(id),0) from public.mirror_outbox),
          high_water_created_at=clock_timestamp()
      where singleton;
      commit;
    `);
    const highWater = Number(scalar(cluster,
      'select high_water_outbox_id from public.syncview_retirement_admission where singleton'));
    deliverableWrite('nor-d2', { title: 'Retired native accepted' }, event({
      dedup: 'retired-native', id: 'nor-d2', operation: 'title',
    }));
    assertReceipt('retired-native', 'deliverable', 'title');
    ok('real retired admission admits a typed native receipt above its high-water',
      Number(scalar(cluster, "select id from public.mirror_outbox where dedup_key='retired-native'")) > highWater
      && scalar(cluster, "select (public.production_syncview_retirement_census()->>'ordinary_post_cutoff_total')::bigint") === '0');

    const retiredBefore = {
      title: scalar(cluster, "select title from public.deliverables where id='nor-d2'"),
      events: count(cluster, 'select * from public.deliverable_events'),
      outbox: count(cluster, 'select * from public.mirror_outbox'),
    };
    setCapability('provider');
    ok('real retired admission rolls back a fresh provider-shaped business write', rejection(
      `select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'must not commit',
      })},${json(event({ dedup: 'retired-provider', id: 'nor-d2', operation: 'title' }))})`,
      /syncview_retirement_admission_closed:title/,
    ) && scalar(cluster, "select title from public.deliverables where id='nor-d2'") === retiredBefore.title
      && count(cluster, 'select * from public.deliverable_events') === retiredBefore.events
      && count(cluster, 'select * from public.mirror_outbox') === retiredBefore.outbox);

    setCapability('native', 'retired-proof');
    const boundaryEvent = event({ dedup: 'retired-lock-race', id: 'nor-d2', operation: 'priority' });
    const cutoffLock = psqlAsync(env, `begin; lock table public.mirror_outbox in share row exclusive mode;
        select pg_sleep(1);
        update public.syncview_retirement_admission set activated_reason='disposable lock race' where singleton;
        commit;`);
    const waitingWriter = psqlAsync(env,
      `begin; set local application_name='nir-retired-lock-writer'; select pg_sleep(0.1);
       select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', priority: 4,
      })},${json(boundaryEvent)}); commit;`);
    let observedLockWait = false;
    for (let attempt = 0; attempt < 20 && !observedLockWait; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      observedLockWait = scalar(cluster, `select exists(
        select 1 from pg_stat_activity
        where pid <> pg_backend_pid() and application_name='nir-retired-lock-writer'
          and state='active' and wait_event_type='Lock')`) === 't';
    }
    const boundaryRace = await Promise.all([cutoffLock, waitingWriter]);
    ok('future cutoff table lock makes the competing typed writer wait', observedLockWait);
    assert.deepEqual(boundaryRace.map(result => result.status), [0, 0], boundaryRace.map(result => result.stderr).join('\n'));
    assertReceipt('retired-lock-race', 'deliverable', 'priority');
    ok('future cutoff table lock releases the waiting typed writer through the real guard',
      Number(scalar(cluster, "select id from public.mirror_outbox where dedup_key='retired-lock-race'")) > highWater);

    console.log(`LINEAR_EXIT_OWNER_COMPOSITION_BASE_OK ${passed} assertions`);
    // Provision through the actual owner. The projection fixture below is explicit
    // synthetic data, not a claim that this lane exercises native intake itself.
    cluster.exec(`update public.syncview_runtime_flags set value='{"video":{"enabled":true,"epoch":"composition-v1"},"graphics":{"enabled":true,"epoch":"composition-g1"}}'::jsonb where key='native_intake_epochs';`);
    const provision = jsonRows(cluster, "select public.production_native_client_provision('composition-provision','compositionclient','Composition Fixture') as result")[0].result;
    ok('real provisioning creates opaque native projects', provision.ok === true && provision.outcome === 'created' && /^svproj_video_[a-f0-9]{32}$/.test(provision.native_project_ids.video));
    cluster.exec(`insert into public.batches(id,client_slug,team,name,status) values ('composition-batch','compositionclient','video','Composition fixture','active');
      insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,assignee_id,linear_raw)
      values ('composition-deliverable','composition-batch','compositionclient','video','video','Projection fixture','todo','33333333-3333-4333-8333-333333333331',${json({attribution:{schema:'syncview_attribution_v1',state:'resolved',source:'native_intake_project',client_slug:'compositionclient',team:'video',project_id:provision.native_project_ids.video,native_epoch:'composition-v1'}})});`);
    const projected = jsonRows(cluster,"select raw_attribution_project_id,raw_attribution_native_epoch,raw_attribution_client_slug from public.production_deliverables_browser_v1 where id='composition-deliverable'")[0];
    ok('final browser projection resolves the actual provisioned client mapping', projected.raw_attribution_project_id === provision.native_project_ids.video && projected.raw_attribution_client_slug === 'compositionclient' && projected.raw_attribution_native_epoch === 'composition-v1');
    const workload = jsonRows(cluster,'select public.workload_native_snapshot_v1() as result')[0].result;
    ok('final Workload RPC includes the native provisioned client row', workload.ok === true && workload.complete === true && workload.rows.some(row => row.id === 'composition-deliverable' && row.source === 'native' && row.client_slug === 'compositionclient'));
    console.log(`LINEAR_EXIT_OWNER_COMPOSITION_READERS_OK ${passed} assertions`);
    // The repaired notification owner must work without invented soft-delete fields.
    const supplied = jsonRows(cluster, `select table_name from information_schema.columns
      where table_schema='public' and table_name in ('deliverables','batches','calendar_posts','sample_reviews') and column_name='deleted_at'`);
    ok('composition supplies no synthetic deletion columns', supplied.length === 0);
    cluster.runFile(path.join(MIGRATIONS,'2026-09-09-native-notification-outbox.sql'));
    ok('notification liveness accepts the real provisioned native deliverable', scalar(cluster,
      "select public.production_notification_target_live('composition-deliverable')") === 't');
    cluster.exec("update public.batches set status='archived' where id='composition-batch'");
    ok('notification liveness rejects the archived owning batch', scalar(cluster,
      "select public.production_notification_target_live('composition-deliverable')") === 'f');
    const notificationEvent = {
      ...event({ dedup: 'composition-notification', id: 'nor-d2' }),
      auth_kind: 'staff', actor_key: 'member:11111111-1111-4111-8111-111111111111',
    };
    // Earlier parity cases deliberately use kind=test and source-timed events.
    // This case models a current native staff write for a synthetic client.
    cluster.exec("update public.clients set kind='client' where slug='fixture-client'");
    delete notificationEvent.ts;
    deliverableWrite('nor-d2', { status: 'smm_approval' }, notificationEvent);
    ok('real ordinary writer produces a notification intent under composed owners', scalar(cluster,
      "select count(*) from public.production_notification_intents where deliverable_id='nor-d2' and kind='status_smm_approval'") === '1');
    for(const file of ['2026-09-05-card-change-journal.sql','2026-09-05-calendar-feedback-recovery.sql','2026-09-05-crosswalk-bind-and-import.sql']) {
      console.log('COMPOSITION_APPLY '+file);cluster.runFile(path.join(MIGRATIONS,file));
    }
    cluster.exec(`insert into public.calendar_posts(client,id,status,updated_at) values
      ('fixture-client','journal-shared','In Progress','2030-01-01T00:00:00Z'),
      ('fixture-split','journal-shared','In Progress','2030-01-01T00:00:00Z');`);
    ok('journal preserves same card id under two client primary keys',scalar(cluster,"select count(distinct entity_key_after->>'client')=2 from public.card_change_journal where relation_name='calendar_posts' and entity_key_after->>'id'='journal-shared'")==='t');
    const journalBefore=count(cluster,'select * from public.card_change_journal');
    cluster.exec("begin; update public.calendar_posts set name='Rolled back' where client='fixture-client' and id='journal-shared'; rollback;");
    ok('rolled-back source write leaves no journal entry',count(cluster,'select * from public.card_change_journal')===journalBefore);
    cluster.exec(`insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,linear_identifier)
      values ('crosswalk-deliverable','composition-batch','compositionclient','video','other','Crosswalk fixture','todo','VID-909090');
      insert into public.calendar_posts(client,id,status,updated_at,video_deliverable_id,linear_issue_id)
      values ('compositionclient','crosswalk-card','In Progress','2030-01-01T00:00:00Z','crosswalk-deliverable','VID-909090');`);
    const binding={source_surface:'calendar',client_slug:'compositionclient',card_id:'crosswalk-card',component:'video',deliverable_id:'crosswalk-deliverable'};
    const imported=[{native_comment_id:'crosswalk-legacy-comment',source_fingerprint:'crosswalk-fixture-fingerprint',client_slug:'compositionclient',author_key:'legacy-fixture',author_name:'Legacy fixture',role:'client',body:'Retained legacy feedback',audience:'client',component:'video',source_created_at:'2030-01-01T00:00:00Z'}];
    const bound=jsonRows(cluster,`select public.production_comment_card_bind_and_import(${json(binding)},${json(imported)},'{}') as result`)[0].result;
    ok('actual crosswalk owner binds and imports matching source identity',bound.bound===true && bound.imported===1 && scalar(cluster,"select origin='calendar' and card_id='crosswalk-card' and kind='video' from public.deliverables where id='crosswalk-deliverable'")==='t');
    const replayBinding=jsonRows(cluster,`select public.production_comment_card_bind_and_import(${json(binding)},${json(imported)},'{}') as result`)[0].result;
    ok('crosswalk replay retains one imported link',replayBinding.imported===0 && replayBinding.already_linked===1);
    cluster.exec("update public.calendar_posts set linear_issue_id='VID-909091' where client='compositionclient' and id='crosswalk-card'");
    ok('crosswalk refuses a source pointer with different work identity',rejection(`select public.production_comment_card_bind_and_import(${json(binding)},'[]','{}')`,/crosswalk_bind_linear_identity_disagrees/));
    cluster.exec("update public.calendar_posts set linear_issue_id='VID-909090' where client='compositionclient' and id='crosswalk-card'");
    const recoveryEvent=event({dedup:'recovery-client-add',entity:'comment',id:'crosswalk-deliverable',operation:'comment',actor:'Fixture Client',role:'client'});
    const recoveryComment={id:'recovery-client-comment',native_comment_id:'recovery-client-comment',idempotency_key:'recovery-client-add',deliverable_id:'crosswalk-deliverable',team:'video',operation:'add',author_key:'client:compositionclient',author_name:'Fixture Client',role:'client',body:'Owned original feedback',audience:'client',component:'video',is_tweak:false,origin:'native',source:'ui',source_created_at:recoveryEvent.ts,source_updated_at:recoveryEvent.ts};
    cluster.exec(`select public.production_comment_write(${json(recoveryComment)},${json(recoveryEvent)})`);
    const canonical=jsonRows(cluster,"select * from public.production_comments where id='recovery-client-comment'")[0];
    cluster.exec(`select public.production_comment_upsert(${json({...recoveryComment,operation:'delete',deleted_at:'2030-01-02T00:00:00Z'})})`);
    ok('actual native comment lifecycle is captured by journal',scalar(cluster,"select exists(select 1 from public.card_change_journal where relation_name='production_comments' and entity_key_after->>'id'='recovery-client-comment' and operation='UPDATE' and row_after->>'deleted_at' is not null)")==='t');
    const request={actor:{name:'Fixture Client',role:'client'},client:'compositionclient',card_id:'crosswalk-card',component:'video',deliverable_id:'crosswalk-deliverable',comment:{native_comment_id:canonical.native_comment_id,canonical_id:canonical.id,dedup_key:canonical.idempotency_key,intent_fingerprint:'fp-recovery-client-add',body:canonical.body,is_tweak:false,round:canonical.round,entry_created_at:canonical.source_created_at},source:{expected_updated_at:'2030-01-01T00:00:00Z',fields:{},previous:{}}};
    const recovered=jsonRows(cluster,`select public.calendar_feedback_recovery_apply_v1(${json(request)}) as result`)[0].result;
    ok('feedback recovery holds after actual canonical deletion without materialization',recovered.outcome==='held' && recovered.reason==='native_lifecycle_changed' && count(cluster,'select * from public.calendar_feedback_materializations')===0);
    const corpus=require('../scripts/track-b-backup').resolveCorpus('history-v11');
    const missing=corpus.tables.filter(table=>scalar(cluster,`select to_regclass(${literal('public.'+table.name)}) is null`)==='t').map(table=>table.name);
    console.log(JSON.stringify({classification:'RECOVERY_COVERAGE_INCOMPLETE',corpus:'history-v11',expected_tables:corpus.tables.length,missing_tables:missing}));
    console.log(`LINEAR_EXIT_OWNER_COMPOSITION_OK ${passed} assertions`);
  } finally {
    try {
      if (cluster) cluster.stop();
    } finally {
      if (composedArtifact && require('node:fs').existsSync(composedArtifact)) require('node:fs').unlinkSync(composedArtifact);
      if (composedDirectory) require('node:fs').rmdirSync(composedDirectory);
    }
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
