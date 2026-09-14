'use strict';
// Exact original native business assertions; caller provides an already reopened real composition.
const assert=require('node:assert/strict');
module.exports=function({cluster,scalar,count,jsonRows,ok}){
// BEGIN ORIGINAL SECTION 0
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

// END ORIGINAL SECTION 0
// BEGIN ORIGINAL SECTION 1
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

// END ORIGINAL SECTION 1
// BEGIN ORIGINAL SECTION 2
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

// END ORIGINAL SECTION 2
};
