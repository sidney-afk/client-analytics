'use strict';

/* Actual PostgreSQL 16 proof. All identities are synthetic and the database is disposable. */
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  bootCluster, connectionEnv, psqlAsync, MIGRATIONS, count, jsonRows, scalar,
} = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native ordinary receipts PostgreSQL: F63 disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw Error('native ordinary receipt proof requires loopback disposable PostgreSQL');
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

    // Add the exact comment/artifact prerequisites before compiling the subject RPCs.
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
    cluster.exec(`
      create or replace function public.nir_fixture_f27_generation_guard() returns trigger
      language plpgsql as $fn$ declare v_generation bigint; begin
        if new.dedup_key like 'f27-%' then
          select generation into v_generation from public.track_b_f27_team_fences where team=new.team;
          if coalesce((new.payload->>'_f27_authority_generation')::bigint,-1) is distinct from v_generation then
            raise exception 'f27_generation_changed';
          end if;
        end if;
        return new;
      end $fn$;
      create trigger aaa_nir_fixture_f27 before insert on public.mirror_outbox
      for each row execute function public.nir_fixture_f27_generation_guard();
    `);
    const f27Before = {
      title: scalar(cluster, "select title from public.deliverables where id='nor-d2'"),
      events: count(cluster, 'select * from public.deliverable_events'),
      outbox: count(cluster, 'select * from public.mirror_outbox'),
      admissions: count(cluster, 'select * from public.production_native_ordinary_receipt_admissions'),
    };
    ok('F27 generation rejection rolls back row, event, receipt, and admission', rejection(
      `select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'Wrong generation',
      })},${json(event({ dedup: 'f27-reject', id: 'nor-d2', operation: 'title', generation: 99 }))})`, /f27_generation_changed/,
    ) && scalar(cluster, "select title from public.deliverables where id='nor-d2'") === f27Before.title
      && count(cluster, 'select * from public.deliverable_events') === f27Before.events
      && count(cluster, 'select * from public.mirror_outbox') === f27Before.outbox
      && count(cluster, 'select * from public.production_native_ordinary_receipt_admissions') === f27Before.admissions);
    deliverableWrite('nor-d2', { title: 'Right generation' }, event({
      dedup: 'f27-accept', id: 'nor-d2', operation: 'title', generation: 0,
    }));
    assertReceipt('f27-accept', 'deliverable', 'title');
    cluster.exec('drop trigger aaa_nir_fixture_f27 on public.mirror_outbox; drop function public.nir_fixture_f27_generation_guard()');

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
      'truncate table public.mirror_outbox', /native_ordinary_receipt_retained/,
    ));
    ok('admission table remains inaccessible to service_role',
      scalar(cluster, "select not has_table_privilege('service_role','public.production_native_ordinary_receipt_admissions','select')") === 't');

    // Test the final retirement recognizer with actual and unstored malformed composites.
    cluster.exec(`create or replace function public.production_syncview_retirement_typed_native_receipt(
      p_row public.mirror_outbox) returns boolean language sql immutable as $fn$ select false $fn$`);
    cluster.runFile(path.join(MIGRATIONS, '2026-09-10-syncview-retirement-native-ordinary-recognizer.sql'));
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

    console.log(`NATIVE_ORDINARY_RECEIPTS_POSTGRES_OK ${passed} assertions`);
  } finally {
    if (cluster) cluster.stop();
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
