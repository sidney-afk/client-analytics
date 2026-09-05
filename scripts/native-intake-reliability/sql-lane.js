'use strict';
/*
 * SQL lane: the persistence contracts themselves, driven directly.
 *
 * The gateway lane proves what the handler does with them; this lane proves
 * what the DATABASE guarantees on its own, because that is what survives a
 * gateway crash, a second gateway instance, or a retry from a different
 * browser. Two things only this lane can show:
 *   - a genuine two-session race on the same request identity, held open in
 *     the database (session A commits 1.5 s after its RPC returns, session B
 *     arrives in between), and
 *   - what the RPC contract requires of a caller regardless of any gateway --
 *     which provider identifiers it will not commit without.
 * Rows are planned by the repository's own planAppendIntakeItems so the
 * fixture is the product's plan, not a hand-rolled one.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('./harness.js');

const POLICY = path.join(H.ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs');

function actorEvent(overrides = {}) {
  return Object.assign({
    source: 'ui', action: 'create', ts: '2026-09-05T09:00:00Z', surface: 'calendar',
    actor: 'Fixture Admin', role: 'admin',
  }, overrides);
}
function childEvent(row, opts = {}) {
  return actorEvent({
    ...(opts.event || {}),
    outbound: {
      entity: 'deliverable', entity_id: row.id, team: row.team, operation: 'create',
      dedup_key: opts.dedup || ('write-ui:create:deliverable:' + row.id + ':' + opts.requestId),
      source_edited_at: '2026-09-05T09:00:00Z', test_only: false, legacy_parity: false,
      ...(opts.dependsOn ? { depends_on_id: opts.dependsOn } : {}),
      payload: {
        project_id: opts.projectId === undefined ? 'proj_fixture_shared' : opts.projectId,
        ...(opts.parentId ? { parent_linear_issue_id: opts.parentId } : {}),
        title: row.title, status: row.status,
        _intent_fingerprint: opts.fingerprint || ('fp:' + row.id + ':' + opts.requestId),
      },
    },
  });
}

async function run(cluster) {
  const checks = [];
  const events = [];
  const env = H.connectionEnv(cluster);
  const check = (id, kind, label, pass, evidence) => {
    checks.push({ id, lane: 'sql', kind, label, pass: !!pass, evidence: evidence === undefined ? null : evidence });
    const line = `${pass ? 'ok  ' : 'FAIL'} [${kind}] ${id} ${label}`;
    events.push(line);
    console.error(line + (pass ? '' : '\n      evidence: ' + JSON.stringify(evidence)));
  };
  const policy = await import(pathToFileURL(POLICY).href);
  const q = sql => cluster.exec(sql);
  const lit = v => "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  const errorOf = fn => { try { fn(); return ''; } catch (e) { const m = /ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([^\n]*)/.exec(String(e.message)); return m ? m[1].trim() : String(e.message); } };

  /* A native batch, made the way the gateway makes it: production_batch_write
     with a create intent, so the trigger enqueues the batch-create outbox row
     the append route depends on. */
  const batchId = 'bat_sql_fixture';
  const batchRow = { id: batchId, client_slug: 'fixture-client', team: null, name: 'SQL lane batch', status: 'active', purpose: 'calendar', created_by: 'member:fixture' };
  const batchEvent = actorEvent({ surface: 'submission', outbound: {
    entity: 'batch', entity_id: batchId, team: 'video', operation: 'create',
    dedup_key: 'write-ui:create:batch:' + batchId + ':sql-root:video', source_edited_at: '2026-09-05T09:00:00Z',
    test_only: false, legacy_parity: false,
    payload: { project_id: 'proj_fixture_shared', title: 'SQL lane batch', status: 'todo', _parent_teams: ['video'], _intent_fingerprint: 'fp:batch:sql-root' },
  } });
  q(`select public.production_batch_write(${lit(batchRow)}, ${lit(batchEvent)});`);
  const dependencyId = Number(H.scalar(cluster, `select id from public.mirror_outbox where dedup_key = 'write-ui:create:batch:${batchId}:sql-root:video'`));
  check('S0-batch-intent-row', 'current', 'creating a native batch through production_batch_write enqueues its batch-create provider intent in the same transaction (mirror_outbox is the idempotency ledger AND the provider queue)',
    dependencyId > 0, { outbox_id: dependencyId });

  const cursor = () => H.scalar(cluster, `select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') from public.batches where id='${batchId}'`);
  const planRows = (requestId, mode, opts = {}) => {
    const existing = H.jsonRows(cluster, `select id, title, team, card_id, sort_key from public.deliverables where batch_id='${batchId}'`);
    const items = [];
    const cardId = 'p_native_' + requestId.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(-28) + '_1';
    if (mode === 'video' || mode === 'both') items.push({ team: 'video', card_id: cardId });
    if (mode === 'graphics' || mode === 'both') items.push({ team: 'graphics', card_id: cardId });
    const ids = items.map((item, index) => 'del_' + requestId.replace(/[^a-z0-9]+/gi, '').slice(-20) + '_' + item.team + index);
    const planned = policy.planAppendIntakeItems(existing, items, ids, 'calendar');
    const rows = planned.map((item, index) => ({
      id: ids[index], identifier: null, batch_id: batchId, client_slug: 'fixture-client', team: item.team,
      kind: item.team === 'graphics' ? 'thumbnail' : 'video', title: item.title, brief: null, status: 'todo',
      status_at: '2026-09-05T09:00:00Z', assignee_id: null, due_date: null, priority: null, origin: 'calendar',
      card_id: item.card_id, sort_key: item.sort_key, _intake_ordinal: item._intake_ordinal,
      created_by: 'member:fixture', created_at: '2026-09-05T09:00:00Z',
    }));
    const evts = rows.map(row => childEvent(row, { requestId, dependsOn: dependencyId, ...opts }));
    return { rows, events: evts, cardId };
  };
  const appendCall = (plan, expected) =>
    `select public.production_intake_append('${batchId}', '${expected}'::timestamptz, ${lit(plan.rows)}, ${lit(plan.events)})`;

  /* S1 : a real two-session race on one request identity. */
  {
    const plan = planRows('sql:race:0001', 'video');
    const at = cursor();
    const a = H.psqlAsync(env, `begin; ${appendCall(plan, at)}; select pg_sleep(1.5); commit;`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const b = H.psqlAsync(env, `${appendCall(plan, at)};`);
    const [ra, rb] = await Promise.all([a, b]);
    const rowsNow = H.count(cluster, `select 1 from public.deliverables where batch_id='${batchId}'`);
    const bReplay = /"replay"\s*:\s*true/.test(rb.stdout);
    check('S1-db-race-same-identity', 'current', 'two database sessions appending the same request identity, the second arriving while the first still holds its transaction, commit ONE row: the second blocks on the batch lock and returns replay=true',
      ra.status === 0 && rb.status === 0 && bReplay && rowsNow === 1,
      { first_status: ra.status, second_status: rb.status, second_replay: bReplay, rows: rowsNow, second_error: rb.stderr.slice(0, 200) });
  }

  /* S2 : same identity, different intent or actor: refused in the database. */
  {
    const at = cursor();
    const plan = planRows('sql:race:0001', 'video', { fingerprint: 'fp:different-intent' });
    const err = errorOf(() => q(`begin; ${appendCall(plan, at)}; rollback;`));
    check('S2-same-dedup-different-intent', 'current', 'the same dedup key with a different intent fingerprint raises idempotency_conflict inside the RPC (no gateway needed to enforce it)',
      err.includes('idempotency_conflict'), { error: err });
    const planActor = planRows('sql:race:0001', 'video', { event: { actor: 'Fixture Manager', role: 'smm' } });
    const err2 = errorOf(() => q(`begin; ${appendCall(planActor, at)}; rollback;`));
    check('S2-same-dedup-different-actor', 'current', 'the same dedup key replayed by a different actor raises idempotency_conflict (actor and role are part of the durable identity)',
      err2.includes('idempotency_conflict'), { error: err2 });
    const rowsNow = H.count(cluster, `select 1 from public.deliverables where batch_id='${batchId}'`);
    check('S2-nothing-written', 'current', 'neither refusal left a row behind', rowsNow === 1, { rows: rowsNow });
  }

  /* S3 : stale CAS cursor. */
  {
    const plan = planRows('sql:cas:0002', 'video');
    const err = errorOf(() => q(`begin; ${appendCall(plan, '2020-01-01T00:00:00Z')}; rollback;`));
    check('S3-stale-cas', 'current', 'an append carrying a stale batch cursor raises write_conflict and writes nothing',
      err.includes('write_conflict') && H.count(cluster, `select 1 from public.deliverables where batch_id='${batchId}'`) === 1, { error: err });
  }

  /* S4 : the contract requires provider identifiers. */
  {
    const at = cursor();
    const noProject = planRows('sql:noproj:0003', 'video', { projectId: null });
    const e1 = errorOf(() => q(`begin; ${appendCall(noProject, at)}; rollback;`));
    check('S4-project-id-required', 'current', 'production_intake_append refuses a row whose outbound payload carries no provider project_id (invalid_intake_append_payload): the SQL contract itself embeds the provider catalog',
      e1.includes('invalid_intake_append_payload'), { error: e1 });
    const noRoute = planRows('sql:noroute:0004', 'video', { dependsOn: null });
    const e2 = errorOf(() => q(`begin; ${appendCall(noRoute, at)}; rollback;`));
    check('S4-parent-route-required', 'current', 'a row with neither a provider parent issue id nor a batch-create dependency is refused (invalid_intake_append_route): every append must name a provider parent or a provider intent',
      e2.includes('invalid_intake_append_route'), { error: e2 });
    check('R4-native-parent-identity', 'readiness', 'the append contract accepts a native parent identity (the batch itself) with no provider project or parent issue',
      !e1 && !e2, { without_project: e1, without_route: e2 });
  }

  /* S5 : terminal provider intent blocks native work. */
  {
    const at = cursor();
    for (const terminal of ['skipped', 'stale']) {
      q(`update public.mirror_outbox set status='${terminal}' where id=${dependencyId}`);
      const plan = planRows('sql:terminal:' + terminal, 'video');
      const err = errorOf(() => q(`begin; ${appendCall(plan, at)}; rollback;`));
      check('S5-terminal-dependency-' + terminal, 'current', `with the batch-create intent ${terminal}, an append is refused batch_parent_mapping_missing although batch and children are native`,
        err.includes('batch_parent_mapping_missing'), { error: err });
    }
    q(`update public.mirror_outbox set status='pending' where id=${dependencyId}`);
  }

  /* S6 : authority flag missing: fail closed, nothing written. */
  {
    const at = cursor();
    const plan = planRows('sql:noauth:0005', 'video');
    q(`update public.syncview_runtime_flags set key='prod_authority_parked' where key='prod_authority'`);
    const err = errorOf(() => q(`begin; ${appendCall(plan, at)}; rollback;`));
    q(`update public.syncview_runtime_flags set key='prod_authority' where key='prod_authority_parked'`);
    check('S6-authority-missing', 'current', 'with the prod_authority flag row absent the RPC raises authority_unavailable and writes nothing (fail closed)',
      err.includes('authority_unavailable') && H.count(cluster, `select 1 from public.deliverables where batch_id='${batchId}'`) === 1, { error: err });
  }

  /* S7 : component fill race, same shape as S1. */
  {
    const sibling = H.jsonRows(cluster, `select id, card_id, sort_key from public.deliverables where batch_id='${batchId}' limit 1`)[0];
    q(`insert into public.calendar_posts (client, id, status, video_deliverable_id) values ('fixture-client', '${sibling.card_id}', 'In Progress', '${sibling.id}') on conflict do nothing`);
    const fillRow = {
      id: 'del_sql_fill_1', batch_id: batchId, client_slug: 'fixture-client', team: 'graphics', kind: 'thumbnail',
      title: 'Thumbnail 1', status: 'todo', origin: 'calendar', card_id: sibling.card_id, sort_key: sibling.sort_key,
    };
    const fillEvent = childEvent(fillRow, { requestId: 'fill:graphics:' + sibling.card_id, dependsOn: dependencyId });
    const at = cursor();
    const call = `select public.production_component_fill('${batchId}', '${at}'::timestamptz, '${sibling.id}', ${lit(fillRow)}, ${lit(fillEvent)})`;
    const a = H.psqlAsync(env, `begin; ${call}; select pg_sleep(1.5); commit;`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const b = H.psqlAsync(env, `${call};`);
    const [ra, rb] = await Promise.all([a, b]);
    const comps = H.count(cluster, `select 1 from public.deliverables where card_id='${sibling.card_id}' and team='graphics'`);
    check('S7-fill-db-race', 'current', 'two sessions filling the same card component concurrently commit exactly one component; the second returns replay=true',
      ra.status === 0 && rb.status === 0 && /"replay"\s*:\s*true/.test(rb.stdout) && comps === 1,
      { first_status: ra.status, second_status: rb.status, components: comps, second_error: rb.stderr.slice(0, 200) });
  }

  /* S8 : where an accepted request actually lives. */
  {
    const deliverables = H.jsonRows(cluster, `select id, team, card_id, status, created_by from public.deliverables where batch_id='${batchId}' order by id`);
    const outbox = H.jsonRows(cluster, `select entity, operation, status, left(dedup_key, 30) as dedup_prefix, (payload->>'_intent_fingerprint') is not null as has_fingerprint, depends_on_id from public.mirror_outbox where batch_id='${batchId}' or entity_id='${batchId}' order by id`);
    const evts = H.jsonRows(cluster, `select action, source, count(*)::int as n from public.deliverable_events where batch_id='${batchId}' group by action, source order by action`);
    const cards = H.jsonRows(cluster, `select id, video_deliverable_id, graphic_deliverable_id from public.calendar_posts where client='fixture-client' and id = any(array['${deliverables.map(d => d.card_id).join("','")}'])`);
    const cardLinkedBack = cards.filter(c => c.graphic_deliverable_id).length;
    check('S8-durable-inventory', 'current', 'an accepted append leaves: deliverables rows, one pending mirror_outbox intent per row carrying dedup_key + intent fingerprint (the only idempotency receipt), and deliverable_events audit rows; the card table is written by a SEPARATE browser request and the fill did not link the card back',
      deliverables.length === 2 && outbox.length === 3 && evts.length >= 2 && cardLinkedBack === 0,
      { deliverables, outbox, events: evts, cards });
  }

  return { checks, events };
}

module.exports = { run };
