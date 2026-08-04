'use strict';

/*
 * Opt-in disposable-PostgreSQL execution proof for the B3 exact-scope RPCs.
 *
 * This test refuses every non-loopback database and creates its own disposable
 * database. The default unit run skips it. CI/owner rehearsal opts in with
 * B3_SCOPED_REQUIRE_POSTGRES=1, an explicit ephemeral-cluster attestation,
 * and PGHOST/PGPORT/PGUSER credentials. Every fixture identity is fictional.
 * It also proves the scoped lock order against the known row-first and
 * authority-first writer patterns in separate concurrent sessions.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  MANIFEST_CONTRACT,
  SCOPE_POLICY,
  SNAPSHOT_CONTRACT,
  buildScopedPlan,
  canonicalizeLinearIssue,
  globalFailureDigest,
  rollbackDigest,
  rpcPlan,
  snapshotContentDigest,
  stableDigest,
} = require('../scripts/b3-linkage-scoped-repair');
const { strictActiveCalendarSweep } = require('../scripts/b3-linkage-backfill');
const GLOBAL_FAILURE_COUNT = 266;

if (process.env.B3_SCOPED_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP: B3 scoped-linkage PostgreSQL proof requires an attested ephemeral cluster');
  process.exit(0);
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
const pgHost = String(process.env.PGHOST || '').trim().toLowerCase();
assert.ok(allowedHosts.has(pgHost), 'B3 scoped proof refuses non-loopback PostgreSQL');
assert.strictEqual(process.env.B3_SCOPED_POSTGRES_EPHEMERAL_CLUSTER, '1',
  'B3 scoped proof requires an explicitly attested ephemeral PostgreSQL cluster');
assert.strictEqual(String(process.env.PGDATABASE || ''), 'postgres');
assert.ok(/^\d+$/.test(String(process.env.PGPORT || '')));
assert.ok(String(process.env.PGUSER || '').trim());

const root = path.resolve(__dirname, '..');
const database = 'b3_scoped_' + process.pid + '_' + Date.now();
assert.match(database, /^b3_scoped_[a-z0-9_]+$/);
const psqlEnv = {};
for (const name of [
  'PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL',
]) {
  if (process.env[name] !== undefined) psqlEnv[name] = process.env[name];
}
Object.assign(psqlEnv, {
  PGHOST: pgHost,
  PGPORT: String(process.env.PGPORT),
  PGUSER: String(process.env.PGUSER),
  PGPASSWORD: String(process.env.PGPASSWORD || ''),
  PGDATABASE: 'postgres',
  PGSSLMODE: 'disable',
});

function psqlArguments(targetDatabase) {
  return [
    '-X',
    '--quiet',
    '--no-align',
    '--tuples-only',
    '--set',
    'ON_ERROR_STOP=1',
    '--dbname',
    targetDatabase,
    '--file',
    '-',
  ];
}

function runPsql(targetDatabase, sql, expectSuccess) {
  const shouldSucceed = expectSuccess !== false;
  const result = spawnSync(
    'psql',
    psqlArguments(targetDatabase),
    {
      cwd: root,
      env: psqlEnv,
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60000,
    },
  );
  if (result.error) throw result.error;
  if (shouldSucceed && result.status !== 0) {
    throw new Error('psql proof failed: ' + String(result.stderr || result.stdout || '').trim());
  }
  if (!shouldSucceed && result.status === 0) throw new Error('psql proof unexpectedly succeeded');
  return result;
}

function startPsqlSession(targetDatabase, sql) {
  const child = spawn('psql', psqlArguments(targetDatabase), {
    cwd: root,
    env: psqlEnv,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let doneSettled = false;
  let doneResolve;
  let doneReject;
  const done = new Promise(function donePromise(resolve, reject) {
    doneResolve = resolve;
    doneReject = reject;
  });
  // A rejection is always awaited by runLockOrderScenario; attach a handler
  // immediately so an early child exit cannot become an unhandled rejection.
  done.catch(function observedLater() {});
  const timer = setTimeout(function completionTimeout() {
    if (!doneSettled) {
      doneSettled = true;
      doneReject(new Error('concurrent_writer_completion_timeout'));
      child.kill();
    }
  }, 20000);
  child.stdout.resume();
  child.stderr.resume();
  child.stdin.on('error', function ignoredPipeClose() {});
  child.on('error', function childError() {
    clearTimeout(timer);
    if (!doneSettled) {
      doneSettled = true;
      doneReject(new Error('concurrent_writer_spawn_failed'));
    }
  });
  child.on('close', function childClose(code) {
    clearTimeout(timer);
    if (!doneSettled) {
      doneSettled = true;
      if (code === 0) doneResolve();
      else doneReject(new Error('concurrent_writer_failed'));
    }
  });
  child.stdin.end(sql, 'utf8');
  return { done };
}

function delay(milliseconds) {
  return new Promise(function wait(resolve) { setTimeout(resolve, milliseconds); });
}

async function waitForWriterLock(targetDatabase, applicationName) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (scalar(targetDatabase,
      'select exists(select 1 from pg_stat_activity where datname=current_database()'
        + ' and application_name=' + sqlLiteral(applicationName)
        + " and state <> 'idle')") === 't') return;
    await delay(50);
  }
  throw new Error('concurrent_writer_ready_timeout');
}

async function runLockOrderScenario(targetDatabase, writerSql, validatorSql, applicationName) {
  const session = startPsqlSession(targetDatabase, writerSql);
  let readyError;
  try {
    await waitForWriterLock(targetDatabase, applicationName);
  } catch (error) {
    readyError = error;
  }
  let validatorError;
  if (!readyError) {
    try {
      runPsql(targetDatabase, validatorSql);
    } catch (error) {
      validatorError = error;
    }
  }
  let writerError;
  try {
    await session.done;
  } catch (error) {
    writerError = error;
  }
  if (readyError) throw readyError;
  if (validatorError) throw validatorError;
  if (writerError) throw writerError;
}

function scalar(targetDatabase, sql) {
  const result = runPsql(targetDatabase, String(sql).replace(/;\s*$/, '') + ';\n');
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  assert.strictEqual(lines.length, 1, 'expected one scalar proof row');
  return lines[0];
}

function sqlLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function buildFixture() {
  const runnerSha = 'a'.repeat(64);
  const releaseSha = 'b'.repeat(40);
  const cards = [
    {
      client: 'fictional-client-01',
      id: 'fictional-card-01',
      status: 'active',
      graphic_status: 'in_progress',
      updated_at: '2026-08-01T00:01:00.000Z',
      posted_at: null,
      graphic_tweaks: '',
      linear_issue_id: null,
      graphic_linear_issue_id:
        'https://linear.app/fictional-workspace/issue/GFX-1001/fictional-graphic-01',
      video_deliverable_id: null,
      graphic_deliverable_id: null,
      graphic_comments: [],
    },
    {
      client: 'fictional-client-02',
      id: 'fictional-card-02',
      status: 'active',
      graphic_status: 'in_progress',
      updated_at: '2026-08-01T00:02:00.000Z',
      posted_at: null,
      graphic_tweaks: '',
      linear_issue_id: null,
      graphic_linear_issue_id:
        'https://linear.app/fictional-workspace/issue/GFX-1002/fictional-graphic-02',
      video_deliverable_id: null,
      graphic_deliverable_id: '',
      graphic_comments: [],
    },
  ];
  for (let residueIndex = 1; residueIndex <= GLOBAL_FAILURE_COUNT; residueIndex++) {
    const residueOrdinal = String(residueIndex).padStart(3, '0');
    const residueIdentifier = `GFX-${9000 + residueIndex}`;
    cards.push({
      client: 'fictional-residue-client',
      id: `fictional-residue-card-${residueOrdinal}`,
      status: 'active',
      graphic_status: 'in_progress',
      updated_at: '2026-08-01T00:03:00.000Z',
      posted_at: null,
      graphic_tweaks: '',
      linear_issue_id: null,
      graphic_linear_issue_id:
        `https://linear.app/fictional-workspace/issue/${residueIdentifier}/unresolved-residue-${residueOrdinal}`,
      video_deliverable_id: null,
      graphic_deliverable_id: null,
      graphic_comments: [],
    });
  }
  const deliverables = [
    {
      id: 'fictional-deliverable-01',
      client_slug: 'fictional-client-01',
      team: 'graphics',
      kind: 'thumbnail',
      origin: 'calendar',
      card_id: 'fictional-card-01',
      status: 'in_progress',
      updated_at: '2026-08-01T01:01:00.000Z',
      linear_issue_uuid: null,
      linear_identifier: 'GFX-1001',
      linear_issue_url:
        'https://linear.app/fictional-workspace/issue/GFX-1001/fictional-graphic-01',
      linear_raw: {},
    },
    {
      id: 'fictional-deliverable-02',
      client_slug: 'fictional-client-02',
      team: 'graphics',
      kind: 'thumbnail',
      origin: 'calendar',
      card_id: 'fictional-card-02',
      status: 'in_progress',
      updated_at: '2026-08-01T01:02:00.000Z',
      linear_issue_uuid: null,
      linear_identifier: 'GFX-1002',
      linear_issue_url:
        'https://linear.app/fictional-workspace/issue/GFX-1002/fictional-graphic-02',
      linear_raw: {},
    },
  ];
  const snapshot = {
    contract: SNAPSHOT_CONTRACT,
    generated_at: '2026-08-04T12:00:00.000Z',
    project_ref: 'fictional-project-ref',
    release_sha: releaseSha,
    runner_sha256: runnerSha,
    clients: [
      { slug: 'fictional-client-01', active: true, kind: 'client' },
      { slug: 'fictional-client-02', active: true, kind: 'client' },
      { slug: 'fictional-residue-client', active: true, kind: 'client' },
    ],
    prodAuthority: { video: 'linear', graphics: 'linear' },
    calendarPosts: cards,
    sampleReviews: [],
    deliverables,
    linearArchive: [],
    productionComments: [{
      id: 'fictional-unrelated-comment',
      deliverable_id: null,
      linear_issue_uuid: null,
      linear_identifier: null,
    }],
  };
  const entries = cards.slice(0, 2).map(function entry(card, index) {
    const deliverable = deliverables[index];
    const canonical = canonicalizeLinearIssue(card.graphic_linear_issue_id);
    const state = card.graphic_deliverable_id === null ? 'null' : 'empty';
    return {
      surface: 'calendar',
      component: 'graphic',
      table: 'calendar_posts',
      link_column: 'graphic_linear_issue_id',
      deliverable_column: 'graphic_deliverable_id',
      operation: 'link_existing_deliverable',
      client_slug: card.client,
      card_id: card.id,
      link_url: card.graphic_linear_issue_id,
      link_identifier: canonical.identifier,
      target_deliverable_id: deliverable.id,
      card_before: {
        status: card.status,
        graphic_status: card.graphic_status,
        updated_at: card.updated_at,
        posted_at: card.posted_at,
        graphic_tweaks: card.graphic_tweaks,
        graphic_linear_issue_id: card.graphic_linear_issue_id,
        graphic_linear_issue_canonical: canonical.canonical_url,
        graphic_deliverable_id: {
          state,
          value: card.graphic_deliverable_id,
        },
        graphic_comments_sha256: stableDigest([]),
        graphic_comments_count: 0,
        native_comment_count: 0,
        native_comment_digest: stableDigest([]),
      },
      deliverable_before: Object.assign({}, deliverable, {
        linear_issue_canonical: canonical.canonical_url,
      }),
    };
  });
  const sweep = strictActiveCalendarSweep(snapshot);
  const manifest = {
    contract: MANIFEST_CONTRACT,
    generated_at: snapshot.generated_at,
    project_ref: snapshot.project_ref,
    release_sha: releaseSha,
    runner_sha256: runnerSha,
    scope_policy: SCOPE_POLICY,
    expected_count: 2,
    snapshot_digest: snapshotContentDigest(snapshot),
    global_failure_count: sweep.failures.length,
    global_failure_digest: globalFailureDigest(sweep),
    entries,
  };
  const plan = buildScopedPlan(snapshot, manifest, {
    expectedCount: 2,
    runnerSha256: runnerSha,
  });
  assert.strictEqual(plan.status, 'READY');
  assert.strictEqual(plan.global_gate, 'BLOCKED');
  assert.strictEqual(plan.global_failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(plan.global_projected.failures.length, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(plan.global_projected_failure_digest, plan.global_failure_digest);
  return plan;
}

function rpcSql(name, plan, rollbackHash) {
  const privatePlan = JSON.stringify(rpcPlan(plan));
  const args = [
    sqlLiteral(privatePlan) + '::jsonb',
    String(plan.expected_count),
    sqlLiteral(plan.scope_digest),
    sqlLiteral(plan.plan_digest),
    String(plan.global_failure_count),
    sqlLiteral(plan.global_failure_digest),
  ];
  if (rollbackHash) args.push(sqlLiteral(rollbackHash));
  return 'select public.' + name + '(' + args.join(',') + ');';
}

const schema = fs.readFileSync(
  path.join(root, 'test', 'fixtures', 'b3-scoped-postgres-schema.sql'),
  'utf8',
);
const migration = fs.readFileSync(
  path.join(root, 'migrations', '2026-08-04-b3-scoped-card-linkage.sql'),
  'utf8',
);
const plan = buildFixture();
const rollbackHash = rollbackDigest(plan);
const fixtureRoles = ['anon', 'authenticated', 'service_role'];
const roleExisted = Object.fromEntries(fixtureRoles.map(function preexisting(role) {
  return [role, scalar('postgres',
    'select exists(select 1 from pg_roles where rolname=' + sqlLiteral(role) + ')') === 't'];
}));

async function main() {
  let created = false;
  try {
  assert.match(scalar('postgres', 'show server_version_num'), /^(?:16|17)\d{4}$/);
  runPsql('postgres', 'create database "' + database + '" template template0;');
  created = true;
  runPsql(database, schema);
  runPsql(database, migration);

  const validatorSql = rpcSql('b3_scoped_card_linkage_assert_plan', plan, 'before');
  await runLockOrderScenario(database, [
    'begin;',
    "update public.deliverables set status=status where id='fictional-deliverable-01';",
    "set local application_name='b3_scoped_writer_deliverable_first';",
    'select pg_sleep(0.75);',
    "select value from public.syncview_runtime_flags where key='prod_authority' for share;",
    'commit;',
  ].join('\n'), validatorSql, 'b3_scoped_writer_deliverable_first');
  await runLockOrderScenario(database, [
    'begin;',
    "update public.production_comments set linear_identifier=linear_identifier where id='fictional-unrelated-comment';",
    "set local application_name='b3_scoped_writer_comment_first';",
    'select pg_sleep(0.75);',
    "select value from public.syncview_runtime_flags where key='prod_authority' for share;",
    'commit;',
  ].join('\n'), validatorSql, 'b3_scoped_writer_comment_first');
  await runLockOrderScenario(database, [
    'begin;',
    "select value from public.syncview_runtime_flags where key='prod_authority' for share;",
    "set local application_name='b3_scoped_writer_authority_first';",
    'select pg_sleep(0.75);',
    "update public.deliverables set status=status where id='fictional-deliverable-02';",
    'commit;',
  ].join('\n'), validatorSql, 'b3_scoped_writer_authority_first');

  const preflight = JSON.parse(scalar(
    database,
    'set role service_role;\nselect public.b3_scoped_card_linkage_preflight()::text',
  ));
  assert.deepStrictEqual(preflight, rpcPlan(plan).global_before);
  assert.strictEqual(preflight.failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(preflight.failure_digest, plan.global_failure_digest);

  runPsql(database, 'set role service_role;\n'
    + rpcSql('b3_scoped_card_linkage_apply', plan));
  assert.strictEqual(scalar(database,
    "select string_agg(graphic_deliverable_id, ',' order by id) "
      + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
  'fictional-deliverable-01,fictional-deliverable-02');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '1');
  const afterApply = JSON.parse(scalar(
    database,
    'set role service_role;\nselect public.b3_scoped_card_linkage_preflight()::text',
  ));
  assert.deepStrictEqual(afterApply, rpcPlan(plan).global_projected);
  assert.strictEqual(afterApply.failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(afterApply.failure_digest, preflight.failure_digest);

  runPsql(database, rpcSql('b3_scoped_card_linkage_apply', plan), false);
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '1');

  runPsql(database, 'set role service_role;\n'
    + rpcSql('b3_scoped_card_linkage_rollback', plan, rollbackHash));
  assert.strictEqual(scalar(database,
    "select string_agg(case when graphic_deliverable_id is null then 'null' "
      + "when graphic_deliverable_id='' then 'empty' else 'populated' end, ',' order by id) "
      + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
  'null,empty');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_rollback'"), '1');
  const afterRollback = JSON.parse(scalar(
    database,
    'set role service_role;\nselect public.b3_scoped_card_linkage_preflight()::text',
  ));
  assert.deepStrictEqual(afterRollback, rpcPlan(plan).global_before);
  assert.strictEqual(afterRollback.failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(afterRollback.failure_digest, preflight.failure_digest);

  // The old apply receipt now forces a unique-event failure after UPDATE. The
  // enclosing RPC transaction must roll both pointer writes back to null/empty.
  runPsql(database, rpcSql('b3_scoped_card_linkage_apply', plan), false);
  assert.strictEqual(scalar(database,
    "select string_agg(case when graphic_deliverable_id is null then 'null' "
      + "when graphic_deliverable_id='' then 'empty' else 'populated' end, ',' order by id) "
      + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
  'null,empty');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '1');

  runPsql(database, rpcSql('b3_scoped_card_linkage_rollback', plan, rollbackHash), false);
  assert.strictEqual(scalar(database,
    "select has_function_privilege('anon',"
      + "'public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)',"
      + "'execute')"), 'f');
  assert.strictEqual(scalar(database,
    "select has_function_privilege('service_role',"
      + "'public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)',"
      + "'execute')"), 't');
  assert.strictEqual(scalar(database,
    "select has_function_privilege('anon',"
      + "'public.b3_scoped_calendar_event_digest(jsonb)',"
      + "'execute')"), 'f');
  assert.strictEqual(scalar(database,
    "select has_function_privilege('authenticated',"
      + "'public.b3_scoped_calendar_event_digest(jsonb)',"
      + "'execute')"), 'f');
  assert.strictEqual(scalar(database,
    "select has_function_privilege('service_role',"
      + "'public.b3_scoped_calendar_event_digest(jsonb)',"
      + "'execute')"), 'f');

  console.log(
    'B3 scoped-linkage disposable PostgreSQL proof passed: '
      + 'global_gate=BLOCKED failure_count=266 failure_digest_unchanged=true '
      + 'rollback_exercised=true',
  );
  } finally {
    if (created) {
      runPsql('postgres', 'drop database if exists "' + database + '" with (force);');
    }
    for (const role of fixtureRoles.slice().reverse()) {
      if (!roleExisted[role]) runPsql('postgres', 'drop role if exists "' + role + '";');
    }
  }
}

main().catch(function fail(error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
