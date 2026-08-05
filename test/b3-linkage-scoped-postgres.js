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
  cohortPopulationDigest,
  cohortPopulationRows,
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

function psqlBaseArguments(targetDatabase) {
  return [
    '-X',
    '--quiet',
    '--no-align',
    '--tuples-only',
    '--set',
    'ON_ERROR_STOP=1',
    '--dbname',
    targetDatabase,
  ];
}

function psqlArguments(targetDatabase) {
  return [
    ...psqlBaseArguments(targetDatabase),
    '--file',
    '-',
  ];
}

function psqlCommandArguments(targetDatabase, sql) {
  return [
    ...psqlBaseArguments(targetDatabase),
    '--command',
    sql,
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

function assertPublicDatabaseFailure(result, code, failureClass) {
  const errorText = String(result && result.stderr || '');
  assert.notStrictEqual(result && result.status, 0, 'database refusal must fail the statement');
  assert.match(
    errorText,
    new RegExp('\\b' + code + ':\\s*' + failureClass + '\\b'),
    'database refusal must expose its fixed public-safe class',
  );
}

function managePsqlChild(child, label) {
  let stdout = '';
  let stderr = '';
  let doneSettled = false;
  let doneResolve;
  let doneReject;
  const done = new Promise(function donePromise(resolve, reject) {
    doneResolve = resolve;
    doneReject = reject;
  });
  done.catch(function observedLater() {});
  const timer = setTimeout(function completionTimeout() {
    if (!doneSettled) {
      doneSettled = true;
      doneReject(new Error(label + '_completion_timeout'));
      child.kill();
    }
  }, 30000);
  child.stdout.on('data', function collectStdout(chunk) { stdout += String(chunk); });
  child.stderr.on('data', function collectStderr(chunk) { stderr += String(chunk); });
  child.on('error', function childError() {
    clearTimeout(timer);
    if (!doneSettled) {
      doneSettled = true;
      doneReject(new Error(label + '_spawn_failed'));
    }
  });
  child.on('close', function childClose(code) {
    clearTimeout(timer);
    if (!doneSettled) {
      doneSettled = true;
      if (code === 0) doneResolve({ stdout, stderr });
      else doneReject(new Error(label + '_failed: ' + String(stderr || stdout).trim()));
    }
  });

  function send(sql, endInput) {
    const text = String(sql).endsWith('\n') ? String(sql) : String(sql) + '\n';
    return new Promise(function sendPromise(resolve, reject) {
      const callback = function inputWritten(error) {
        if (error) reject(new Error(label + '_input_failed'));
        else resolve();
      };
      if (endInput) child.stdin.end(text, 'utf8', callback);
      else child.stdin.write(text, 'utf8', callback);
    });
  }

  async function terminate() {
    if (!doneSettled) child.kill();
    try { await done; } catch (_error) {}
  }

  return {
    done,
    send,
    terminate,
    isSettled: function isSettled() { return doneSettled; },
  };
}

function startPsqlCommandSession(targetDatabase, sql, label) {
  const child = spawn('psql', psqlCommandArguments(targetDatabase, sql), {
    cwd: root,
    env: psqlEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return managePsqlChild(child, label);
}

function startPsqlController(targetDatabase, label) {
  const child = spawn('psql', psqlArguments(targetDatabase), {
    cwd: root,
    env: psqlEnv,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.on('error', function ignoredClosedController() {});
  return managePsqlChild(child, label);
}

function delay(milliseconds) {
  return new Promise(function wait(resolve) { setTimeout(resolve, milliseconds); });
}

async function waitForSqlCondition(targetDatabase, sql, refusalCode) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (scalar(targetDatabase, sql) === 't') return;
    await delay(50);
  }
  throw new Error(refusalCode);
}

function sessionActivitySql(applicationName) {
  return 'select exists(select 1 from pg_stat_activity a'
    + ' where a.datname=current_database()'
    + ' and a.application_name=' + sqlLiteral(applicationName) + ')';
}

function relationLockSql(applicationName, relationName, mode, granted) {
  return 'select exists(select 1 from pg_stat_activity a'
    + ' join pg_locks l on l.pid=a.pid'
    + ' join pg_class c on c.oid=l.relation'
    + ' join pg_namespace n on n.oid=c.relnamespace'
    + ' where a.datname=current_database()'
    + ' and a.application_name=' + sqlLiteral(applicationName)
    + " and l.locktype='relation' and n.nspname='public'"
    + ' and c.relname=' + sqlLiteral(relationName)
    + ' and l.mode=' + sqlLiteral(mode)
    + ' and l.granted is ' + (granted ? 'true' : 'false') + ')';
}

function advisoryWaitSql(applicationName) {
  return 'select exists(select 1 from pg_stat_activity a'
    + ' join pg_locks l on l.pid=a.pid'
    + ' where a.datname=current_database()'
    + ' and a.application_name=' + sqlLiteral(applicationName)
    + " and l.locktype='advisory' and l.granted is false)";
}

async function releaseBarrier(targetDatabase, controller, barrierKey, markerName) {
  await controller.send(
    'select pg_advisory_unlock(' + barrierKey + ');\n'
      + 'set application_name=' + sqlLiteral(markerName) + ';',
  );
  await waitForSqlCondition(
    targetDatabase,
    sessionActivitySql(markerName),
    'barrier_release_not_observed',
  );
}

async function runLockOrderScenario(targetDatabase, validatorCallSql, config) {
  const writerBarrier = config.barrierBase;
  const validatorBarrier = config.barrierBase + 1;
  const controllerName = 'b3_ctl_' + config.name;
  const writerName = 'b3_writer_' + config.name;
  const validatorName = 'b3_validator_' + config.name;
  const sessions = [];
  let controller;
  try {
    controller = startPsqlController(targetDatabase, 'barrier_controller_' + config.name);
    sessions.push(controller);
    await controller.send(
      'select pg_advisory_lock(' + writerBarrier + ');\n'
        + 'select pg_advisory_lock(' + validatorBarrier + ');\n'
        + 'set application_name=' + sqlLiteral(controllerName) + ';',
    );
    await waitForSqlCondition(
      targetDatabase,
      sessionActivitySql(controllerName),
      'barrier_controller_not_ready',
    );

    const writerSql = [
      'begin;',
      ...config.writerBeforeBarrier,
      'set local application_name=' + sqlLiteral(writerName) + ';',
      'select pg_advisory_xact_lock(' + writerBarrier + ');',
      ...config.writerAfterBarrier,
      'commit;',
    ].join('\n');
    const writer = startPsqlCommandSession(
      targetDatabase,
      writerSql,
      'concurrent_writer_' + config.name,
    );
    sessions.push(writer);
    await waitForSqlCondition(
      targetDatabase,
      relationLockSql(writerName, config.firstRelation, config.firstMode, true),
      'writer_first_lock_not_observed',
    );
    await waitForSqlCondition(
      targetDatabase,
      advisoryWaitSql(writerName),
      'writer_barrier_wait_not_observed',
    );

    const validatorSql = [
      'begin;',
      'set local application_name=' + sqlLiteral(validatorName) + ';',
      validatorCallSql,
      'select pg_advisory_xact_lock(' + validatorBarrier + ');',
      'commit;',
    ].join('\n');
    const validator = startPsqlCommandSession(
      targetDatabase,
      validatorSql,
      'concurrent_validator_' + config.name,
    );
    sessions.push(validator);

    if (config.rowFirst) {
      await waitForSqlCondition(
        targetDatabase,
        relationLockSql(validatorName, config.firstRelation, 'ShareRowExclusiveLock', false),
        'validator_relation_wait_not_observed',
      );
      await releaseBarrier(
        targetDatabase,
        controller,
        writerBarrier,
        controllerName + '_writer_released',
      );
      await writer.done;
      await waitForSqlCondition(
        targetDatabase,
        advisoryWaitSql(validatorName),
        'validator_barrier_wait_not_observed',
      );
    } else {
      await waitForSqlCondition(
        targetDatabase,
        advisoryWaitSql(validatorName),
        'validator_barrier_wait_not_observed',
      );
      await waitForSqlCondition(
        targetDatabase,
        relationLockSql(validatorName, 'deliverables', 'ShareRowExclusiveLock', true),
        'validator_scoped_lock_not_observed',
      );
      await releaseBarrier(
        targetDatabase,
        controller,
        writerBarrier,
        controllerName + '_writer_released',
      );
      await waitForSqlCondition(
        targetDatabase,
        relationLockSql(writerName, 'deliverables', 'RowExclusiveLock', false),
        'authority_first_writer_wait_not_observed',
      );
    }

    await releaseBarrier(
      targetDatabase,
      controller,
      validatorBarrier,
      controllerName + '_validator_released',
    );
    await Promise.all([writer.done, validator.done]);
    await controller.send('\\q', true);
    await controller.done;
  } finally {
    for (const session of sessions.reverse()) await session.terminate();
  }
}

async function runContentionClassificationProbe(targetDatabase, applyCallSql) {
  const barrierKey = 830040;
  const controllerName = 'b3_ctl_contention_probe';
  const writerName = 'b3_writer_contention_probe';
  const sessions = [];
  let controller;
  try {
    runPsql(
      targetDatabase,
      "alter function public.b3_scoped_card_linkage_assert_plan("
        + "jsonb,integer,text,text,integer,text,text) set lock_timeout='100ms';",
    );

    controller = startPsqlController(targetDatabase, 'contention_probe_controller');
    sessions.push(controller);
    await controller.send(
      'select pg_advisory_lock(' + barrierKey + ');\n'
        + 'set application_name=' + sqlLiteral(controllerName) + ';',
    );
    await waitForSqlCondition(
      targetDatabase,
      sessionActivitySql(controllerName),
      'contention_probe_controller_not_ready',
    );

    const writer = startPsqlCommandSession(
      targetDatabase,
      [
        'begin;',
        "update public.deliverables set status=status where id='fictional-deliverable-01';",
        'set local application_name=' + sqlLiteral(writerName) + ';',
        'select pg_advisory_xact_lock(' + barrierKey + ');',
        'commit;',
      ].join('\n'),
      'contention_probe_writer',
    );
    sessions.push(writer);
    await waitForSqlCondition(
      targetDatabase,
      relationLockSql(writerName, 'deliverables', 'RowExclusiveLock', true),
      'contention_probe_writer_lock_not_observed',
    );
    await waitForSqlCondition(
      targetDatabase,
      advisoryWaitSql(writerName),
      'contention_probe_writer_barrier_not_observed',
    );

    const refused = runPsql(
      targetDatabase,
      '\\set VERBOSITY verbose\nset role service_role;\n' + applyCallSql,
      false,
    );
    assertPublicDatabaseFailure(refused, 'B3C01', 'REFUSED_CONTENTION');
    assert.strictEqual(scalar(targetDatabase,
      "select string_agg(case when graphic_deliverable_id is null then 'null' "
        + "when graphic_deliverable_id='' then 'empty' else 'populated' end, ',' order by id) "
        + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
    'null,null');
    assert.strictEqual(scalar(targetDatabase,
      "select count(*) from public.deliverable_events "
        + "where action='b3_scoped_card_linkage_apply'"), '0');

    await releaseBarrier(
      targetDatabase,
      controller,
      barrierKey,
      controllerName + '_writer_released',
    );
    await writer.done;
    await controller.send('\\q', true);
    await controller.done;
  } finally {
    for (const session of sessions.reverse()) await session.terminate();
    runPsql(
      targetDatabase,
      "alter function public.b3_scoped_card_linkage_assert_plan("
        + "jsonb,integer,text,text,integer,text,text) set lock_timeout='5s';",
    );
  }
}

function populationRaceInsertSql(suffix, identifier) {
  const cardId = 'fictional-population-race-card-' + suffix;
  const deliverableId = 'fictional-population-race-deliverable-' + suffix;
  const link = 'https://linear.app/fictional-workspace/issue/'
    + identifier + '/fictional-population-race-' + suffix;
  return [
    "insert into public.deliverables (id,client_slug,team,kind,origin,card_id,status,updated_at,linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw) values ("
      + sqlLiteral(deliverableId) + ",'fictional-client-01','graphics','thumbnail','calendar',"
      + sqlLiteral(cardId) + ",'in_progress','2026-08-01T01:30:00.000Z',null,"
      + sqlLiteral(identifier) + ',' + sqlLiteral(link) + ",'{}'::jsonb);",
    "insert into public.calendar_posts (client,id,status,graphic_status,updated_at,posted_at,graphic_tweaks,linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id) values ('fictional-client-01',"
      + sqlLiteral(cardId) + ",'active','in_progress','2026-08-01T00:30:00.000Z',null,'',null,"
      + sqlLiteral(link) + ',null,null);',
  ];
}

function populationRaceCleanupSql(suffix) {
  return "delete from public.deliverables where id="
    + sqlLiteral('fictional-population-race-deliverable-' + suffix) + ';\n'
    + "delete from public.calendar_posts where client='fictional-client-01' and id="
    + sqlLiteral('fictional-population-race-card-' + suffix) + ';';
}

function populationSabotagePayload(plan) {
  const payload = JSON.parse(JSON.stringify(rpcPlan(plan)));
  for (const phase of ['global_before', 'global_projected']) {
    payload[phase].checked += 1;
    payload[phase].resolved += 1;
    payload[phase].resolved_by_exact_url += 1;
  }
  return payload;
}

async function runPopulationWriterFirstRace(targetDatabase, plan) {
  const suffix = 'writer-first';
  const barrierKey = 830050;
  const controllerName = 'b3_ctl_population_writer_first';
  const writerName = 'b3_writer_population_writer_first';
  const validatorName = 'b3_validator_population_writer_first';
  const sessions = [];
  let controller;
  try {
    controller = startPsqlController(targetDatabase, 'population_writer_first_controller');
    sessions.push(controller);
    await controller.send(
      'select pg_advisory_lock(' + barrierKey + ');\n'
        + 'set application_name=' + sqlLiteral(controllerName) + ';',
    );
    await waitForSqlCondition(
      targetDatabase,
      sessionActivitySql(controllerName),
      'population_writer_first_controller_not_ready',
    );

    const writer = startPsqlCommandSession(
      targetDatabase,
      [
        'begin;',
        'set local application_name=' + sqlLiteral(writerName) + ';',
        ...populationRaceInsertSql(suffix, 'GFX-1101'),
        'select pg_advisory_xact_lock(' + barrierKey + ');',
        'commit;',
      ].join('\n'),
      'population_writer_first_writer',
    );
    sessions.push(writer);
    await waitForSqlCondition(
      targetDatabase,
      relationLockSql(writerName, 'deliverables', 'RowExclusiveLock', true),
      'population_writer_first_lock_not_observed',
    );
    await waitForSqlCondition(
      targetDatabase,
      advisoryWaitSql(writerName),
      'population_writer_first_barrier_not_observed',
    );

    const sabotagedApply = rpcSql(
      'b3_scoped_card_linkage_apply',
      plan,
      null,
      populationSabotagePayload(plan),
    ).replace(/^select /, 'perform ');
    const validator = startPsqlCommandSession(
      targetDatabase,
      [
        'begin;',
        'set local application_name=' + sqlLiteral(validatorName) + ';',
        'set role service_role;',
        'do $population_probe$',
        'begin',
        '  ' + sabotagedApply,
        "  raise exception 'population_probe_unexpected_success';",
        'exception',
        "  when sqlstate 'B3P06' then null;",
        'end;',
        '$population_probe$;',
        "select 'B3P06_REFUSED_AFTER_WRITER_COMMIT';",
        'commit;',
      ].join('\n'),
      'population_writer_first_validator',
    );
    sessions.push(validator);
    await waitForSqlCondition(
      targetDatabase,
      relationLockSql(validatorName, 'deliverables', 'ShareRowExclusiveLock', false),
      'population_writer_first_validator_wait_not_observed',
    );

    await releaseBarrier(
      targetDatabase,
      controller,
      barrierKey,
      controllerName + '_writer_released',
    );
    await writer.done;
    const validatorResult = await validator.done;
    assert.match(validatorResult.stdout, /B3P06_REFUSED_AFTER_WRITER_COMMIT/);
    assert.strictEqual(scalar(targetDatabase,
      "select count(*) from public.deliverable_events where action='b3_scoped_card_linkage_apply'"),
    '0');
    assert.strictEqual(scalar(targetDatabase,
      "select count(*) from public.calendar_posts where id in ('fictional-card-01','fictional-card-02') and graphic_deliverable_id is not null"),
    '0');
    await controller.send('\\q', true);
    await controller.done;
  } finally {
    for (const session of sessions.reverse()) await session.terminate();
    runPsql(targetDatabase, populationRaceCleanupSql(suffix));
  }
}

async function runPopulationValidatorFirstRace(targetDatabase, plan) {
  const suffix = 'validator-first';
  const barrierKey = 830060;
  const controllerName = 'b3_ctl_population_validator_first';
  const validatorName = 'b3_validator_population_validator_first';
  const writerName = 'b3_writer_population_validator_first';
  const sessions = [];
  let controller;
  try {
    controller = startPsqlController(targetDatabase, 'population_validator_first_controller');
    sessions.push(controller);
    await controller.send(
      'select pg_advisory_lock(' + barrierKey + ');\n'
        + 'set application_name=' + sqlLiteral(controllerName) + ';',
    );
    await waitForSqlCondition(
      targetDatabase,
      sessionActivitySql(controllerName),
      'population_validator_first_controller_not_ready',
    );

    const validator = startPsqlCommandSession(
      targetDatabase,
      [
        'begin;',
        'set local application_name=' + sqlLiteral(validatorName) + ';',
        'set role service_role;',
        rpcSql('b3_scoped_card_linkage_apply', plan),
        'select pg_advisory_xact_lock(' + barrierKey + ');',
        'rollback;',
      ].join('\n'),
      'population_validator_first_validator',
    );
    sessions.push(validator);
    await waitForSqlCondition(
      targetDatabase,
      relationLockSql(validatorName, 'deliverables', 'ShareRowExclusiveLock', true),
      'population_validator_first_sre_not_observed',
    );
    await waitForSqlCondition(
      targetDatabase,
      advisoryWaitSql(validatorName),
      'population_validator_first_barrier_not_observed',
    );

    const writer = startPsqlCommandSession(
      targetDatabase,
      [
        'begin;',
        'set local application_name=' + sqlLiteral(writerName) + ';',
        ...populationRaceInsertSql(suffix, 'GFX-1102'),
        'commit;',
      ].join('\n'),
      'population_validator_first_writer',
    );
    sessions.push(writer);
    await waitForSqlCondition(
      targetDatabase,
      relationLockSql(writerName, 'deliverables', 'RowExclusiveLock', false),
      'population_validator_first_writer_wait_not_observed',
    );

    await releaseBarrier(
      targetDatabase,
      controller,
      barrierKey,
      controllerName + '_validator_released',
    );
    await Promise.all([validator.done, writer.done]);
    assert.strictEqual(scalar(targetDatabase,
      "select count(*) from public.calendar_posts where id="
        + sqlLiteral('fictional-population-race-card-' + suffix)),
    '1');
    assert.strictEqual(scalar(targetDatabase,
      "select count(*) from public.deliverable_events where action='b3_scoped_card_linkage_apply'"),
    '0');
    await controller.send('\\q', true);
    await controller.done;
  } finally {
    for (const session of sessions.reverse()) await session.terminate();
    runPsql(targetDatabase, populationRaceCleanupSql(suffix));
  }
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

function cohortFixturePair(index) {
  const ordinal = String(index).padStart(2, '0');
  const identifier = `GFX-${1000 + index}`;
  const cardId = `fictional-card-${ordinal}`;
  const deliverableId = `fictional-deliverable-${ordinal}`;
  const link = `https://linear.app/fictional-workspace/issue/${identifier}/fictional-graphic-${ordinal}`;
  return {
    card: {
      client: 'fictional-client-02',
      id: cardId,
      status: 'active',
      graphic_status: 'in_progress',
      updated_at: `2026-08-01T00:${ordinal}:00.000Z`,
      posted_at: null,
      graphic_tweaks: '',
      linear_issue_id: null,
      graphic_linear_issue_id: link,
      video_deliverable_id: null,
      graphic_deliverable_id: null,
      graphic_comments: [],
    },
    deliverable: {
      id: deliverableId,
      client_slug: 'fictional-client-02',
      team: 'graphics',
      kind: 'thumbnail',
      origin: 'calendar',
      card_id: cardId,
      status: 'in_progress',
      updated_at: `2026-08-01T01:${ordinal}:00.000Z`,
      linear_issue_uuid: null,
      linear_identifier: identifier,
      linear_issue_url: link,
      linear_raw: {},
    },
  };
}

function literalFifteenAgainstSixteenSeedSql() {
  const statements = [];
  for (let index = 3; index <= 16; index++) {
    const pair = cohortFixturePair(index);
    statements.push(
      'insert into public.calendar_posts ('
        + 'client,id,status,graphic_status,updated_at,posted_at,graphic_tweaks,'
        + 'linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'
        + ') values ('
        + [
          pair.card.client,
          pair.card.id,
          pair.card.status,
          pair.card.graphic_status,
          pair.card.updated_at,
        ].map(sqlLiteral).join(',')
        + ",null,'',null," + sqlLiteral(pair.card.graphic_linear_issue_id)
        + ',null,null);',
    );
    statements.push(
      'insert into public.deliverables ('
        + 'id,client_slug,team,kind,origin,card_id,status,updated_at,'
        + 'linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw'
        + ') values ('
        + [
          pair.deliverable.id,
          pair.deliverable.client_slug,
          pair.deliverable.team,
          pair.deliverable.kind,
          pair.deliverable.origin,
          pair.deliverable.card_id,
          pair.deliverable.status,
          pair.deliverable.updated_at,
        ].map(sqlLiteral).join(',')
        + ',null,' + sqlLiteral(pair.deliverable.linear_identifier)
        + ',' + sqlLiteral(pair.deliverable.linear_issue_url) + ",'{}'::jsonb);",
    );
  }
  return statements.join('\n');
}

function literalFifteenAgainstSixteenIdsSql(columnPrefix, startIndex = 1) {
  return Array.from({ length: 17 - startIndex }, function idForIndex(_, offset) {
    const ordinal = String(startIndex + offset).padStart(2, '0');
    return sqlLiteral(`${columnPrefix}-${ordinal}`);
  }).join(',');
}

function literalFifteenAgainstSixteenCleanupSql() {
  return 'delete from public.deliverables where id in ('
    + literalFifteenAgainstSixteenIdsSql('fictional-deliverable', 3) + ');\n'
    + 'delete from public.calendar_posts where id in ('
    + literalFifteenAgainstSixteenIdsSql('fictional-card', 3) + ');';
}

function buildFixture(cohortCount = 2) {
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
      graphic_deliverable_id: null,
      graphic_comments: [],
    },
  ];
  for (let cohortIndex = 3; cohortIndex <= cohortCount; cohortIndex++) {
    cards.push(cohortFixturePair(cohortIndex).card);
  }
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
  for (let cohortIndex = 3; cohortIndex <= cohortCount; cohortIndex++) {
    deliverables.push(cohortFixturePair(cohortIndex).deliverable);
  }
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
  const entries = cards.slice(0, cohortCount).map(function entry(card, index) {
    const deliverable = deliverables[index];
    const canonical = canonicalizeLinearIssue(card.graphic_linear_issue_id);
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
          state: 'null',
          value: null,
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
  const scopeClients = ['fictional-client-01', 'fictional-client-02'];
  const population = cohortPopulationRows(snapshot, scopeClients);
  const manifest = {
    contract: MANIFEST_CONTRACT,
    generated_at: snapshot.generated_at,
    project_ref: snapshot.project_ref,
    release_sha: releaseSha,
    runner_sha256: runnerSha,
    scope_policy: SCOPE_POLICY,
    expected_count: cohortCount,
    scope_clients: scopeClients,
    cohort_population_count: population.length,
    cohort_population_digest: cohortPopulationDigest(population),
    snapshot_digest: snapshotContentDigest(snapshot),
    global_failure_count: sweep.failures.length,
    global_failure_digest: globalFailureDigest(sweep),
    entries,
  };
  const plan = buildScopedPlan(snapshot, manifest, {
    expectedCount: cohortCount,
    runnerSha256: runnerSha,
  });
  assert.strictEqual(plan.status, 'READY');
  assert.strictEqual(plan.global_gate, 'BLOCKED');
  assert.strictEqual(plan.global_failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(plan.global_projected.failures.length, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(plan.global_projected_failure_digest, plan.global_failure_digest);
  assert.strictEqual(plan.cohort_population_count, cohortCount);
  assert.strictEqual(plan.counts.cohort_full_crosswalk_eligible, cohortCount);
  assert.strictEqual(plan.counts.cohort_missing_from_manifest, 0);
  assert.strictEqual(plan.counts.cohort_extra_in_manifest, 0);
  return plan;
}

function rpcSql(name, plan, rollbackHash, planPayloadInput) {
  const privatePlan = JSON.stringify(planPayloadInput || rpcPlan(plan));
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
  path.join(root, 'migrations', '2026-08-04-b3-scoped-card-linkage-v2.sql'),
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
  await runLockOrderScenario(database, validatorSql, {
    name: 'deliverable_first',
    barrierBase: 830010,
    writerBeforeBarrier: [
      "update public.deliverables set status=status where id='fictional-deliverable-01';",
    ],
    writerAfterBarrier: [
      "select value from public.syncview_runtime_flags where key='prod_authority' for share;",
    ],
    firstRelation: 'deliverables',
    firstMode: 'RowExclusiveLock',
    rowFirst: true,
  });
  await runLockOrderScenario(database, validatorSql, {
    name: 'comment_first',
    barrierBase: 830020,
    writerBeforeBarrier: [
      "update public.production_comments set linear_identifier=linear_identifier where id='fictional-unrelated-comment';",
    ],
    writerAfterBarrier: [
      "select value from public.syncview_runtime_flags where key='prod_authority' for share;",
    ],
    firstRelation: 'production_comments',
    firstMode: 'RowExclusiveLock',
    rowFirst: true,
  });
  await runLockOrderScenario(database, validatorSql, {
    name: 'authority_first',
    barrierBase: 830030,
    writerBeforeBarrier: [
      "select value from public.syncview_runtime_flags where key='prod_authority' for share;",
    ],
    writerAfterBarrier: [
      "update public.deliverables set status=status where id='fictional-deliverable-02';",
    ],
    firstRelation: 'syncview_runtime_flags',
    firstMode: 'RowShareLock',
    rowFirst: false,
  });
  await runContentionClassificationProbe(
    database,
    rpcSql('b3_scoped_card_linkage_apply', plan),
  );
  await runPopulationWriterFirstRace(database, plan);
  await runPopulationValidatorFirstRace(database, plan);

  const preflight = JSON.parse(scalar(
    database,
    'set role service_role;\nselect public.b3_scoped_card_linkage_preflight()::text',
  ));
  assert.deepStrictEqual(preflight, rpcPlan(plan).global_before);
  assert.strictEqual(preflight.failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(preflight.failure_digest, plan.global_failure_digest);
  const privateRpcPlan = rpcPlan(plan);
  const populationState = JSON.parse(scalar(
    database,
    'select public.b3_scoped_cohort_population_state('
      + sqlLiteral(JSON.stringify(privateRpcPlan.scope_clients)) + '::jsonb,'
      + sqlLiteral(JSON.stringify(privateRpcPlan.entries)) + '::jsonb)::text',
  ));
  assert.deepStrictEqual(populationState, {
    population_count: 2,
    population_digest: plan.cohort_population_digest,
    population_missing_from_entries: 0,
    entries_missing_from_population: 0,
  });
  assert.strictEqual(scalar(
    database,
    "set role service_role;\nselect case when "
      + "(public.b3_scoped_card_linkage_preflight()->>'failure_count')::integer > 0 "
      + "then 'BLOCKED' else 'READY' end",
  ), 'BLOCKED');

  // Literal database sabotage: seed 16 fully eligible rows inside the explicit
  // scope-client population, then submit a valid-looking plan for exactly 15.
  // The old RPC would have silently applied the listed 15. The new RPC must
  // name the population predicate and write zero rows.
  const fifteenRowPlan = buildFixture(15);
  runPsql(database, literalFifteenAgainstSixteenSeedSql());
  const sixteenAgainstFifteenPayload = populationSabotagePayload(fifteenRowPlan);
  const populationRefusal = runPsql(
    database,
    '\\set VERBOSITY verbose\nset role service_role;\n'
      + rpcSql(
        'b3_scoped_card_linkage_apply',
        fifteenRowPlan,
        null,
        sixteenAgainstFifteenPayload,
      ),
    false,
  );
  assertPublicDatabaseFailure(
    populationRefusal,
    'B3P06',
    'REFUSED_COHORT_POPULATION',
  );
  assert.strictEqual(scalar(database,
    'select count(*)::text || \',\' || count(graphic_deliverable_id)::text '
      + 'from public.calendar_posts where id in ('
      + literalFifteenAgainstSixteenIdsSql('fictional-card') + ')'),
  '16,0');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '0');
  runPsql(database, literalFifteenAgainstSixteenCleanupSql());

  runPsql(database,
    "update public.calendar_posts set updated_at='2026-08-01T00:01:01.000Z' "
      + "where client='fictional-client-01' and id='fictional-card-01';");
  const driftRefusal = runPsql(
    database,
    '\\set VERBOSITY verbose\nset role service_role;\n'
      + rpcSql('b3_scoped_card_linkage_apply', plan),
    false,
  );
  assertPublicDatabaseFailure(driftRefusal, 'B3P02', 'REFUSED_LIVE_DRIFT');
  assert.strictEqual(scalar(database,
    "select string_agg(case when graphic_deliverable_id is null then 'null' "
      + "when graphic_deliverable_id='' then 'empty' else 'populated' end, ',' order by id) "
      + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
  'null,null');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '0');
  runPsql(database,
    "update public.calendar_posts set updated_at='2026-08-01T00:01:00.000Z' "
      + "where client='fictional-client-01' and id='fictional-card-01';");

  runPsql(database,
    "update public.production_comments set deliverable_id='fictional-deliverable-01' "
      + "where id='fictional-unrelated-comment';");
  const crosswalkRefusal = runPsql(
    database,
    '\\set VERBOSITY verbose\nset role service_role;\n'
      + rpcSql('b3_scoped_card_linkage_apply', plan),
    false,
  );
  assertPublicDatabaseFailure(crosswalkRefusal, 'B3P03', 'REFUSED_CROSSWALK');
  assert.strictEqual(scalar(database,
    "select string_agg(case when graphic_deliverable_id is null then 'null' "
      + "when graphic_deliverable_id='' then 'empty' else 'populated' end, ',' order by id) "
      + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
  'null,null');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '0');
  runPsql(database,
    "update public.production_comments set deliverable_id=null "
      + "where id='fictional-unrelated-comment';");

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

  const appliedStateRefusal = runPsql(
    database,
    '\\set VERBOSITY verbose\n'
      + rpcSql('b3_scoped_card_linkage_apply', plan),
    false,
  );
  assertPublicDatabaseFailure(appliedStateRefusal, 'B3P02', 'REFUSED_LIVE_DRIFT');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '1');

  runPsql(database, 'set role service_role;\n'
    + rpcSql('b3_scoped_card_linkage_rollback', plan, rollbackHash));
  assert.strictEqual(scalar(database,
    "select string_agg(case when graphic_deliverable_id is null then 'null' "
      + "when graphic_deliverable_id='' then 'empty' else 'populated' end, ',' order by id) "
      + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
  'null,null');
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
  // enclosing RPC transaction must roll both pointer writes back to NULL.
  const replayRefusal = runPsql(
    database,
    '\\set VERBOSITY verbose\n'
      + rpcSql('b3_scoped_card_linkage_apply', plan),
    false,
  );
  assertPublicDatabaseFailure(replayRefusal, 'B3P04', 'REFUSED_REPLAY');
  assert.strictEqual(scalar(database,
    "select string_agg(case when graphic_deliverable_id is null then 'null' "
      + "when graphic_deliverable_id='' then 'empty' else 'populated' end, ',' order by id) "
      + "from public.calendar_posts where id in ('fictional-card-01','fictional-card-02')"),
  'null,null');
  assert.strictEqual(scalar(database,
    "select count(*) from public.deliverable_events "
      + "where action='b3_scoped_card_linkage_apply'"), '1');

  const rollbackStateRefusal = runPsql(
    database,
    '\\set VERBOSITY verbose\n'
      + rpcSql('b3_scoped_card_linkage_rollback', plan, rollbackHash),
    false,
  );
  assertPublicDatabaseFailure(
    rollbackStateRefusal,
    'B3R04',
    'ROLLBACK_STATE_REFUSED',
  );
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
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.strictEqual(scalar(database,
      'select has_function_privilege(' + sqlLiteral(role) + ','
        + "'public.b3_scoped_cohort_population_state(jsonb,jsonb)','execute')"), 'f');
  }

  console.log(
    'B3 scoped-linkage disposable PostgreSQL proof passed: '
      + 'global_gate=BLOCKED failure_count=266 failure_digest_unchanged=true '
      + 'population_sabotage_requested=15 population_sabotage_eligible=16 '
      + 'population_sabotage_refused=true population_races_exercised=true '
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
