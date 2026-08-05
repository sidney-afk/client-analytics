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
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  EXPECTED_MIGRATION_SHA256: ACCELERATOR_MIGRATION_SHA256,
  buildPsqlStream: buildAcceleratorPsqlStream,
} = require('../scripts/b3-accelerator-install');
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
const performanceDatabase = database + '_performance';
assert.match(database, /^b3_scoped_[a-z0-9_]+$/);
assert.match(performanceDatabase, /^b3_scoped_[a-z0-9_]+$/);
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
const maliciousPsqlrc = path.join(
  os.tmpdir(), `b3-accelerator-psqlrc-${process.pid}-${Date.now()}`,
);
assert.match(path.basename(maliciousPsqlrc), /^b3-accelerator-psqlrc-[0-9-]+$/);

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
  if (result.error) {
    // On Windows, ON_ERROR_STOP can close a large stdin stream before Node has
    // finished writing its tail; spawnSync then reports EOF/EPIPE even though
    // psql returned the database refusal on stderr. Accept that transport
    // shape only for an explicitly expected failure with a real server ERROR;
    // successful paths and silent transport failures still throw.
    const earlyExpectedRefusal = !shouldSucceed
      && ['EOF', 'EPIPE'].includes(String(result.error.code || ''))
      && /(?:^|\n)(?:psql:[^\n]* )?ERROR:/m.test(String(result.stderr || ''));
    if (!earlyExpectedRefusal) {
      const fixedClass = String(result.stderr || '').match(/ERROR:\s*([A-Z0-9_]+)/);
      throw new Error(String(result.error.message || result.error)
        + (fixedClass ? ` database_failure_class=${fixedClass[1]}` : ''));
    }
  }
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

function literalCohortIdsSql(columnPrefix, count) {
  return Array.from({ length: count }, function idForIndex(_, offset) {
    return sqlLiteral(`${columnPrefix}-${String(offset + 1).padStart(2, '0')}`);
  }).join(',');
}

function literalFifteenAgainstSixteenCleanupSql() {
  return 'delete from public.deliverables where id in ('
    + literalFifteenAgainstSixteenIdsSql('fictional-deliverable', 3) + ');\n'
    + 'delete from public.calendar_posts where id in ('
    + literalFifteenAgainstSixteenIdsSql('fictional-card', 3) + ');';
}

function adversarialParitySeedSql() {
  return `
insert into public.calendar_posts (
  client,id,status,graphic_status,updated_at,posted_at,graphic_tweaks,
  linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id
) values
  ('edge-client','edge-card-resolved-id','active','in_progress','2026-08-01T06:00:00.000Z',null,'',null,null,'edge-id-resolved',null),
  ('edge-client','edge-card-dangling','active','in_progress','2026-08-01T06:01:00.000Z',null,'',null,'https://linear.app/fictional-workspace/issue/GFX-7001/dangling',null,'edge-id-missing'),
  ('edge-client','edge-card-raw-archived','active','in_progress','2026-08-01T06:02:00.000Z',null,'',null,'https://linear.app/fictional-workspace/issue/GFX-7002/raw-archived',null,'edge-id-raw-archived'),
  ('edge-client','edge-card-status-archived','active','in_progress','2026-08-01T06:03:00.000Z',null,'',null,'https://linear.app/fictional-workspace/issue/GFX-7003/status-archived',null,'edge-id-status-archived'),
  ('edge-client','edge-card-ambiguous-id','active','in_progress','2026-08-01T06:04:00.000Z',null,'',null,'https://linear.app/fictional-workspace/issue/GFX-7004/ambiguous-id',null,'edge-id-ambiguous'),
  ('edge-client','edge-card-unresolved-url','active','in_progress','2026-08-01T06:05:00.000Z',null,'',null,'https://linear.app/fictional-workspace/issue/GFX-7005/unresolved',null,null),
  ('edge-client','edge-card-ambiguous-url','active','in_progress','2026-08-01T06:06:00.000Z',null,'',null,'https://linear.app/fictional-workspace/issue/GFX-7006/ambiguous',null,null),
  (' Edge-Client ','edge-card-resolved-url','active','in_progress','2026-08-01T06:07:00.000Z',null,'',null,'HTTPS://LINEAR.APP/fictional-workspace/issue/GFX-7007/PathCase/?query=1#fragment',null,null),
  ('edge-client','edge-card-malformed-url','active','in_progress','2026-08-01T06:08:00.000Z',null,'',null,'GFX-7008',null,null),
  ('edge-client','edge-card-excluded','archived','in_progress','2026-08-01T06:09:00.000Z',null,'',null,'https://linear.app/fictional-workspace/issue/GFX-7009/excluded',null,null);

insert into public.deliverables (
  id,client_slug,team,kind,origin,card_id,status,updated_at,
  linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw
) values
  ('edge-id-resolved','edge-client','video','video','calendar','edge-card-resolved-id','in_progress','2026-08-01T07:00:00.000Z',null,'GFX-7000',null,'{}'::jsonb),
  ('edge-id-raw-archived','edge-client','graphics','thumbnail','calendar','edge-card-raw-archived','in_progress','2026-08-01T07:01:00.000Z',null,'GFX-7002','https://linear.app/fictional-workspace/issue/GFX-7002/raw-archived','{"nested":{"archived":true}}'::jsonb),
  ('edge-id-status-archived','edge-client','graphics','thumbnail','calendar','edge-card-status-archived',' ARCHIVED ','2026-08-01T07:02:00.000Z',null,'GFX-7003','https://linear.app/fictional-workspace/issue/GFX-7003/status-archived','{}'::jsonb),
  ('edge-id-ambiguous','edge-client','graphics','thumbnail','calendar','edge-card-ambiguous-id','in_progress','2026-08-01T07:03:00.000Z',null,'GFX-7004','https://linear.app/fictional-workspace/issue/GFX-7004/ambiguous-id','{}'::jsonb),
  (' edge-id-ambiguous ','edge-client','graphics','thumbnail','calendar','edge-card-ambiguous-id','in_progress','2026-08-01T07:04:00.000Z',null,'GFX-7004','https://linear.app/fictional-workspace/issue/GFX-7004/ambiguous-id','{}'::jsonb),
  ('edge-url-ambiguous-1','edge-client','graphics','thumbnail','calendar','edge-card-ambiguous-url','in_progress','2026-08-01T07:05:00.000Z',null,'GFX-7006','https://linear.app/fictional-workspace/issue/GFX-7006/ambiguous','{}'::jsonb),
  ('edge-url-ambiguous-2','edge-client','graphics','thumbnail','calendar','edge-card-ambiguous-url','in_progress','2026-08-01T07:06:00.000Z',null,'GFX-7006','https://linear.app/fictional-workspace/issue/GFX-7006/ambiguous?duplicate=1','{}'::jsonb),
  ('edge-url-ambiguous-archived','edge-client','graphics','thumbnail','calendar','edge-card-ambiguous-url','in_progress','2026-08-01T07:07:00.000Z',null,'GFX-7006','https://linear.app/fictional-workspace/issue/GFX-7006/ambiguous','{"issue":{"archivedAt":"2026-08-01T00:00:00Z"}}'::jsonb),
  ('edge-url-resolved',' edge-client ','graphics',' THUMBNAIL ','calendar','edge-card-resolved-url',' In_Progress ','2026-08-01T07:08:00.000Z',null,'GFX-7007','https://linear.app/fictional-workspace/issue/GFX-7007/PathCase','{"deleted":false,"removed":0,"archived":""}'::jsonb);
`;
}

function adversarialParityCleanupSql() {
  return "delete from public.deliverables where id like 'edge-%' or id like ' edge-%';\n"
    + "delete from public.calendar_posts where id like 'edge-%';";
}

function productionScaleSeedSql() {
  const statements = [];
  for (let index = 3; index <= 15; index++) {
    const pair = cohortFixturePair(index);
    statements.push(
      'insert into public.calendar_posts ('
        + 'client,id,status,graphic_status,updated_at,posted_at,graphic_tweaks,'
        + 'linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id'
        + ') values ('
        + [pair.card.client, pair.card.id, pair.card.status, pair.card.graphic_status,
          pair.card.updated_at].map(sqlLiteral).join(',')
        + ",null,'',null," + sqlLiteral(pair.card.graphic_linear_issue_id)
        + ',null,null);',
      'insert into public.deliverables ('
        + 'id,client_slug,team,kind,origin,card_id,status,updated_at,'
        + 'linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw'
        + ') values ('
        + [pair.deliverable.id, pair.deliverable.client_slug, pair.deliverable.team,
          pair.deliverable.kind, pair.deliverable.origin, pair.deliverable.card_id,
          pair.deliverable.status, pair.deliverable.updated_at].map(sqlLiteral).join(',')
        + ',null,' + sqlLiteral(pair.deliverable.linear_identifier)
        + ',' + sqlLiteral(pair.deliverable.linear_issue_url)
        + ",'{}'::jsonb);",
    );
  }
  statements.push(`
insert into public.calendar_posts (
  client,id,status,graphic_status,updated_at,posted_at,graphic_tweaks,
  linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id
)
select
  'fictional-scale-client-' || (g % 80),
  'fictional-scale-active-card-' || g,
  'active','in_progress','2026-08-01T02:00:00.000Z',null,'',null,
  'https://linear.app/fictional-workspace/issue/GFX-' || (20000 + g)
    || '/scale-' || g,
  null,
  case when g <= 548 then 'fictional-scale-active-deliverable-' || g else null end
from generate_series(1,564) g;

insert into public.calendar_posts (
  client,id,status,graphic_status,updated_at,posted_at,graphic_tweaks,
  linear_issue_id,graphic_linear_issue_id,video_deliverable_id,graphic_deliverable_id
)
select
  'fictional-scale-client-' || (g % 80),
  'fictional-scale-archived-card-' || g,
  'archived','archived','2026-08-01T04:00:00.000Z',null,'',null,null,null,null
from generate_series(1,5955) g;

insert into public.deliverables (
  id,client_slug,team,kind,origin,card_id,status,updated_at,
  linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw
)
select
  'fictional-scale-active-deliverable-' || g,
  'fictional-scale-client-' || (g % 80),
  'graphics','thumbnail','calendar','fictional-scale-active-card-' || g,
  'in_progress','2026-08-01T03:00:00.000Z',null,'GFX-' || (20000 + g),
  'https://linear.app/fictional-workspace/issue/GFX-' || (20000 + g)
    || '/scale-' || g,
  jsonb_build_object('issue',jsonb_build_object('id',g),'payload',repeat('x',900))
from generate_series(1,564) g;

insert into public.deliverables (
  id,client_slug,team,kind,origin,card_id,status,updated_at,
  linear_issue_uuid,linear_identifier,linear_issue_url,linear_raw
)
select
  'fictional-scale-unlinked-deliverable-' || g,
  'fictional-scale-client-' || (g % 80),
  case when g % 2 = 1 then 'video' else 'graphics' end,
  case when g % 2 = 1 then 'video' else 'thumbnail' end,
  'calendar','fictional-scale-unlinked-card-' || g,
  'in_progress','2026-08-01T05:00:00.000Z',null,'GFX-' || (30000 + g),
  'https://linear.app/fictional-workspace/issue/GFX-' || (30000 + g)
    || '/unlinked-' || g,
  jsonb_build_object('issue',jsonb_build_object('id',g),'payload',repeat('x',900))
from generate_series(1,4221) g;

analyze public.calendar_posts;
analyze public.deliverables;
`);
  return statements.join('\n');
}

function buildFixture(cohortCount = 2, options) {
  const fixtureOptions = options || {};
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
  if (fixtureOptions.productionScale) {
    for (let index = 1; index <= 564; index++) {
      const identifier = `GFX-${20000 + index}`;
      const cardId = `fictional-scale-active-card-${index}`;
      const link = `https://linear.app/fictional-workspace/issue/${identifier}/scale-${index}`;
      const client = `fictional-scale-client-${index % 80}`;
      cards.push({
        client,
        id: cardId,
        status: 'active',
        graphic_status: 'in_progress',
        updated_at: '2026-08-01T02:00:00.000Z',
        posted_at: null,
        graphic_tweaks: '',
        linear_issue_id: null,
        graphic_linear_issue_id: link,
        video_deliverable_id: null,
        graphic_deliverable_id: index <= 548
          ? `fictional-scale-active-deliverable-${index}`
          : null,
        graphic_comments: [],
      });
      deliverables.push({
        id: `fictional-scale-active-deliverable-${index}`,
        client_slug: client,
        team: 'graphics',
        kind: 'thumbnail',
        origin: 'calendar',
        card_id: cardId,
        status: 'in_progress',
        updated_at: '2026-08-01T03:00:00.000Z',
        linear_issue_uuid: null,
        linear_identifier: identifier,
        linear_issue_url: link,
        linear_raw: { issue: { id: index }, payload: 'x'.repeat(900) },
      });
    }
    for (let index = 1; index <= 5955; index++) {
      cards.push({
        client: `fictional-scale-client-${index % 80}`,
        id: `fictional-scale-archived-card-${index}`,
        status: 'archived',
        graphic_status: 'archived',
        updated_at: '2026-08-01T04:00:00.000Z',
        posted_at: null,
        graphic_tweaks: '',
        linear_issue_id: null,
        graphic_linear_issue_id: null,
        video_deliverable_id: null,
        graphic_deliverable_id: null,
        graphic_comments: [],
      });
    }
    for (let index = 1; index <= 4221; index++) {
      const identifier = `GFX-${30000 + index}`;
      deliverables.push({
        id: `fictional-scale-unlinked-deliverable-${index}`,
        client_slug: `fictional-scale-client-${index % 80}`,
        team: index % 2 ? 'video' : 'graphics',
        kind: index % 2 ? 'video' : 'thumbnail',
        origin: 'calendar',
        card_id: `fictional-scale-unlinked-card-${index}`,
        status: 'in_progress',
        updated_at: '2026-08-01T05:00:00.000Z',
        linear_issue_uuid: null,
        linear_identifier: identifier,
        linear_issue_url:
          `https://linear.app/fictional-workspace/issue/${identifier}/unlinked-${index}`,
        linear_raw: { issue: { id: index }, payload: 'x'.repeat(900) },
      });
    }
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
  if (fixtureOptions.productionScale) {
    assert.strictEqual(snapshot.calendarPosts.length, 6800);
    assert.strictEqual(snapshot.deliverables.length, 4800);
    assert.strictEqual(plan.global_before.checked, 845);
    assert.strictEqual(plan.global_before.resolved_by_id, 548);
    assert.strictEqual(plan.global_before.resolved_by_exact_url, 31);
    assert.strictEqual(plan.global_projected.resolved_by_id, 563);
    assert.strictEqual(plan.global_projected.resolved_by_exact_url, 16);
  }
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
const acceleratorMigration = fs.readFileSync(
  path.join(root, 'migrations', '2026-08-05-b3-scoped-global-failure-accelerators.sql'),
  'utf8',
);
const acceleratorCatalogCheck = fs.readFileSync(
  path.join(root, 'scripts', 'b3-accelerator-precheck.sql'),
  'utf8',
);
const acceleratorFailureInventory = fs.readFileSync(
  path.join(root, 'scripts', 'b3-accelerator-failure-inventory.sql'),
  'utf8',
);

function sqlFunctionBody(source, name) {
  const pattern = new RegExp(
    'create or replace function public\\.' + name
      + '\\(\\)[^]*?as \\$fn\\$\\r?\\n([^]*?)\\r?\\n\\$fn\\$;',
  );
  const match = source.match(pattern);
  assert.ok(match, name + '_source_body_missing');
  return match[1];
}

function sqlFunctionDefinition(source, name) {
  const pattern = new RegExp(
    'create or replace function public\\.' + name
      + '\\([^]*?\\$fn\\$;',
    'i',
  );
  const match = source.match(pattern);
  assert.ok(match, name + '_source_definition_missing');
  return match[0];
}

function acceleratorClosureSql() {
  const match = acceleratorMigration.match(/do \$closure\$[^]*?\$closure\$;/i);
  assert.ok(match, 'accelerator closure block must exist');
  return match[0];
}

function acceleratorRollbackSql() {
  const marker = '-- OWNER-ONLY ROLLBACK';
  const at = acceleratorMigration.indexOf(marker);
  assert.ok(at >= 0, 'accelerator rollback marker must exist');
  const statements = acceleratorMigration.slice(at).split(/\r?\n/)
    .map(function uncomment(line) {
      const match = line.match(
        /^-- (set (?:lock|statement)_timeout = '[^']+';|drop index concurrently[^;]+;|analyze public\.deliverables;)$/i,
      );
      return match ? match[1] : '';
    })
    .filter(Boolean);
  assert.deepStrictEqual(statements, [
    "set lock_timeout = '5s';",
    "set statement_timeout = '10min';",
    'drop index concurrently if exists public.deliverables_b3_exact_url_lookup_idx;',
    'drop index concurrently if exists public.deliverables_b3_trimmed_id_lookup_idx;',
    'analyze public.deliverables;',
  ]);
  return statements.join('\n');
}

function installedGlobalSourceDigestSql() {
  return "select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') "
    + 'from pg_proc p where p.oid='
    + "to_regprocedure('public.b3_scoped_global_failure_state()')";
}

function exactAcceleratorCountSql() {
  return "select count(*) from pg_index i join pg_class idx on idx.oid=i.indexrelid "
    + "where i.indrelid='public.deliverables'::regclass "
    + "and idx.relname in ('deliverables_b3_trimmed_id_lookup_idx',"
    + "'deliverables_b3_exact_url_lookup_idx') "
    + 'and i.indisvalid and i.indisready and i.indislive and not i.indisunique '
    + 'and i.indpred is null';
}

function namedAcceleratorCountSql() {
  return "select count(*) from pg_catalog.pg_class c "
    + "join pg_catalog.pg_namespace n on n.oid=c.relnamespace "
    + "where n.nspname='public' and c.relname in ("
    + "'deliverables_b3_trimmed_id_lookup_idx',"
    + "'deliverables_b3_exact_url_lookup_idx')";
}

function acceleratorAclDeviationCountSql() {
  return `with expected(signature, service_execute) as (
    values
      ('public.b3_scoped_linear_url_projection(text)', false),
      ('public.b3_scoped_comment_count(text)', false),
      ('public.b3_scoped_raw_is_archived(jsonb)', false),
      ('public.b3_scoped_global_failure_state()', false),
      ('public.b3_scoped_cohort_population_state(jsonb,jsonb)', false),
      ('public.b3_scoped_card_linkage_preflight()', true),
      ('public.b3_scoped_calendar_event_digest(jsonb)', false),
      ('public.b3_scoped_card_linkage_assert_plan(jsonb,integer,text,text,integer,text,text)', false),
      ('public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)', true),
      ('public.b3_scoped_card_linkage_rollback(jsonb,integer,text,text,integer,text,text)', true)
  )
  select count(*)
  from expected e
  left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.signature)
  where p.oid is null
     or has_function_privilege('anon', p.oid, 'execute')
     or has_function_privilege('authenticated', p.oid, 'execute')
     or has_function_privilege('service_role', p.oid, 'execute')
          is distinct from e.service_execute
     or (
       select count(*)
       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) direct_acl
       where direct_acl.privilege_type = 'EXECUTE'
         and direct_acl.grantee = to_regrole('service_role')
         and direct_acl.grantor = p.proowner
         and not direct_acl.is_grantable
     ) <> case when e.service_execute then 1 else 0 end
     or exists (
       select 1
       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where acl.privilege_type = 'EXECUTE'
         and (
           acl.grantee = 0
           or (
             acl.grantee <> p.proowner
             and not (
                e.service_execute
                and acl.grantee = to_regrole('service_role')
                and acl.grantor = p.proowner
                and not acl.is_grantable
              )
           )
         )
     )`;
}

function explainGlobalPredicate(targetDatabase) {
  const body = sqlFunctionBody(migration, 'b3_scoped_global_failure_state');
  const result = runPsql(
    targetDatabase,
    'explain (analyze,buffers,format json) ' + body,
  );
  const parsed = JSON.parse(String(result.stdout || '').trim());
  assert.ok(Array.isArray(parsed) && parsed.length === 1);
  return parsed[0];
}

function planRelationScans(plan, relationName) {
  const scans = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node['Relation Name'] === relationName) scans.push(node);
    for (const child of node.Plans || []) walk(child);
  }(plan && plan.Plan));
  return scans;
}

const plan = buildFixture();
const performancePlan = buildFixture(15, { productionScale: true });
const rollbackHash = rollbackDigest(plan);
const performanceRollbackHash = rollbackDigest(performancePlan);
const fixtureRoles = [
  'anon', 'authenticated', 'service_role', 'supabase_admin', 'authenticator',
];
const roleExisted = Object.fromEntries(fixtureRoles.map(function preexisting(role) {
  return [role, scalar('postgres',
    'select exists(select 1 from pg_roles where rolname=' + sqlLiteral(role) + ')') === 't'];
}));
assert.strictEqual(roleExisted.supabase_admin, false,
  'the attested disposable cluster must not contain a pre-existing supabase_admin role');
assert.strictEqual(roleExisted.authenticator, false,
  'the attested disposable cluster must not contain a pre-existing authenticator role');

const SYNTHETIC_EVENT_TRIGGER_SOURCES = [
  ['extensions.set_graphql_placeholder()',
    '19e858a99cf5698c4730343fb43cdad4ab2f0717a8ded8a691a0e2786b859708'],
  ['extensions.grant_pg_cron_access()',
    'da790d5f185c54fb41cfc6038beacc24ce7a7387aca4249ad77a47ea22a99e33'],
  ['extensions.grant_pg_graphql_access()',
    'fb5a80e6d30734718db960270a5f0eac0d655e238e8128ba56803b74a052bc1e'],
  ['extensions.grant_pg_net_access()',
    '55abda380efd46b37b26d3c6e4f3b514e28b7c7c1df44f5ae0315ece4052370d'],
  ['extensions.pgrst_ddl_watch()',
    'de987df746eb39647098459e7993bd8595e592969b0cd647828a3d13d37cffe0'],
  ['extensions.pgrst_drop_watch()',
    '791b41f0632fc86e0fc86a303ec0fd710c4e2ecf947a23422dae2b7a2c122f1d'],
];

function syntheticEventTriggerSql() {
  return `
create role supabase_admin superuser nologin;
create role authenticator nologin;
alter role authenticator set statement_timeout = '8s';

create function extensions.set_graphql_placeholder()
returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
create function extensions.grant_pg_cron_access()
returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
create function extensions.grant_pg_graphql_access()
returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
create function extensions.grant_pg_net_access()
returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
create function extensions.pgrst_ddl_watch()
returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
create function extensions.pgrst_drop_watch()
returns event_trigger language plpgsql as $fn$ begin null; end $fn$;

alter function extensions.set_graphql_placeholder() owner to supabase_admin;
alter function extensions.grant_pg_cron_access() owner to supabase_admin;
alter function extensions.grant_pg_graphql_access() owner to supabase_admin;
alter function extensions.grant_pg_net_access() owner to supabase_admin;
alter function extensions.pgrst_ddl_watch() owner to supabase_admin;
alter function extensions.pgrst_drop_watch() owner to supabase_admin;

create event trigger issue_graphql_placeholder on sql_drop
  when tag in ('DROP EXTENSION')
  execute function extensions.set_graphql_placeholder();
create event trigger issue_pg_cron_access on ddl_command_end
  when tag in ('CREATE EXTENSION')
  execute function extensions.grant_pg_cron_access();
create event trigger issue_pg_graphql_access on ddl_command_end
  when tag in ('CREATE EXTENSION')
  execute function extensions.grant_pg_graphql_access();
create event trigger issue_pg_net_access on ddl_command_end
  when tag in ('CREATE EXTENSION')
  execute function extensions.grant_pg_net_access();
create event trigger pgrst_ddl_watch on ddl_command_end
  execute function extensions.pgrst_ddl_watch();
create event trigger pgrst_drop_watch on sql_drop
  execute function extensions.pgrst_drop_watch();

alter event trigger issue_graphql_placeholder owner to supabase_admin;
alter event trigger issue_pg_cron_access owner to supabase_admin;
alter event trigger issue_pg_graphql_access owner to supabase_admin;
alter event trigger issue_pg_net_access owner to supabase_admin;
alter event trigger pgrst_ddl_watch owner to supabase_admin;
alter event trigger pgrst_drop_watch owner to supabase_admin;
`;
}

function syntheticCatalogCheck(targetDatabase) {
  let source = acceleratorCatalogCheck;
  for (const [signature, productionHash] of SYNTHETIC_EVENT_TRIGGER_SOURCES) {
    const matches = source.split(productionHash).length - 1;
    assert.strictEqual(matches, 1,
      'the production catalog proof must pin each provider trigger hash once');
    const syntheticHash = scalar(targetDatabase,
      "select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') "
        + 'from pg_catalog.pg_proc p where p.oid=to_regprocedure('
        + sqlLiteral(signature) + ')');
    assert.match(syntheticHash, /^[a-f0-9]{64}$/);
    source = source.replace(productionHash, syntheticHash);
  }
  return source;
}

function syntheticAcceleratorMigration(targetDatabase) {
  let source = acceleratorMigration;
  for (const [signature, productionHash] of SYNTHETIC_EVENT_TRIGGER_SOURCES) {
    const matches = source.split(productionHash).length - 1;
    assert.strictEqual(matches, 2,
      'the production migration must pin each provider trigger hash twice');
    const syntheticHash = scalar(targetDatabase,
      "select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') "
        + 'from pg_catalog.pg_proc p where p.oid=to_regprocedure('
        + sqlLiteral(signature) + ')');
    assert.match(syntheticHash, /^[a-f0-9]{64}$/);
    source = source.split(productionHash).join(syntheticHash);
  }
  return source;
}

function parseCatalogReceipt(stdout, contract) {
  const rows = String(stdout || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map(line => JSON.parse(line))
    .filter(row => row.contract === contract);
  assert.strictEqual(rows.length, 1, contract + ' must appear exactly once');
  return rows[0];
}

function readFailureInventory(targetDatabase) {
  const result = runPsql(targetDatabase, acceleratorFailureInventory);
  const receipt = parseCatalogReceipt(
    result.stdout, 'syncview-b3-accelerator-failure-inventory-v1',
  );
  assert.strictEqual(receipt.status, 'PASS');
  assert.strictEqual(receipt.search_path_pinned, true);
  assert.strictEqual(receipt.transaction_read_only, true);
  assert.strictEqual(receipt.current_xact_id_assigned, false);
  assert.strictEqual(receipt.active_build_count, 0);
  return receipt;
}

function productionInstallStream(
  targetDatabase,
  expectSuccess,
  reviewedCatalogCheck,
  reviewedAcceleratorMigration,
) {
  const catalogCheck = reviewedCatalogCheck || syntheticCatalogCheck(targetDatabase);
  const migrationSource = reviewedAcceleratorMigration
    || syntheticAcceleratorMigration(targetDatabase);
  const stream = buildAcceleratorPsqlStream(
    Buffer.from(catalogCheck),
    Buffer.from(migrationSource),
    Buffer.from(catalogCheck),
    ACCELERATOR_MIGRATION_SHA256,
  );
  return runPsql(targetDatabase, stream, expectSuccess);
}

function runProductionInstallStreamProof(targetDatabase) {
  runPsql(targetDatabase, syntheticEventTriggerSql());
  const reviewedCatalogCheck = syntheticCatalogCheck(targetDatabase);
  const reviewedAcceleratorMigration = syntheticAcceleratorMigration(targetDatabase);
  const freshInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(freshInventory.inventory_state, 'FRESH');
  assert.strictEqual(freshInventory.trimmed_id_index_state, 'MISSING');
  assert.strictEqual(freshInventory.exact_url_index_state, 'MISSING');
  assert.strictEqual(freshInventory.named_index_count, 0);
  assert.strictEqual(freshInventory.exact_index_count, 0);
  assert.strictEqual(freshInventory.equivalent_other_count, 0);

  // Planner and named-argument metadata are part of the executable contract,
  // even when the function body bytes are unchanged. Both must refuse before
  // either index is created.
  runPsql(targetDatabase,
    'alter function public.b3_scoped_global_failure_state() cost 101;');
  const costRefusal = productionInstallStream(
    targetDatabase, false, reviewedCatalogCheck, reviewedAcceleratorMigration,
  );
  assert.match(String(costRefusal.stderr || ''), /B3ACC_SOURCE_PREREQUISITE/);
  assert.strictEqual(scalar(targetDatabase, namedAcceleratorCountSql()), '0');
  runPsql(targetDatabase,
    'alter function public.b3_scoped_global_failure_state() cost 100;');

  // This direct catalog mutation is disposable-test-only. It models a
  // drop/recreate performed with check_function_bodies=off and a renamed JSON
  // argument while preserving the same signature and body bytes.
  runPsql(targetDatabase,
    "update pg_catalog.pg_proc set proargnames=array['p_renamed'] "
      + "where oid=to_regprocedure('public.b3_scoped_calendar_event_digest(jsonb)');");
  const argumentNameRefusal = productionInstallStream(
    targetDatabase, false, reviewedCatalogCheck, reviewedAcceleratorMigration,
  );
  assert.match(String(argumentNameRefusal.stderr || ''), /B3ACC_SOURCE_PREREQUISITE/);
  assert.strictEqual(scalar(targetDatabase, namedAcceleratorCountSql()), '0');
  runPsql(targetDatabase,
    "update pg_catalog.pg_proc set proargnames=array['p_entries'] "
      + "where oid=to_regprocedure('public.b3_scoped_calendar_event_digest(jsonb)');");

  // The six-trigger closure is the only indirect application-row write
  // boundary for this DDL. Prove both an extra enabled trigger and source drift
  // refuse before the first accelerator index can be created.
  runPsql(targetDatabase, `
    create function extensions.b3_unexpected_ddl_watch()
    returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
    alter function extensions.b3_unexpected_ddl_watch() owner to supabase_admin;
    create event trigger b3_unexpected_ddl_watch on ddl_command_end
      execute function extensions.b3_unexpected_ddl_watch();
    alter event trigger b3_unexpected_ddl_watch owner to supabase_admin;
  `);
  const extraTriggerRefusal = productionInstallStream(
    targetDatabase, false, reviewedCatalogCheck, reviewedAcceleratorMigration,
  );
  assert.match(String(extraTriggerRefusal.stderr || ''),
    /B3ACC_EVENT_TRIGGER_PREREQUISITE/);
  assert.strictEqual(scalar(targetDatabase, namedAcceleratorCountSql()), '0');
  runPsql(targetDatabase, `
    drop event trigger b3_unexpected_ddl_watch;
    drop function extensions.b3_unexpected_ddl_watch();
  `);

  runPsql(targetDatabase, `
    create or replace function extensions.pgrst_ddl_watch()
    returns event_trigger language plpgsql as $fn$ begin perform 1; end $fn$;
  `);
  const changedTriggerRefusal = productionInstallStream(
    targetDatabase, false, reviewedCatalogCheck, reviewedAcceleratorMigration,
  );
  assert.match(String(changedTriggerRefusal.stderr || ''),
    /B3ACC_EVENT_TRIGGER_PREREQUISITE/);
  assert.strictEqual(scalar(targetDatabase, namedAcceleratorCountSql()), '0');
  runPsql(targetDatabase, `
    create or replace function extensions.pgrst_ddl_watch()
    returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
  `);
  assert.strictEqual(syntheticCatalogCheck(targetDatabase), reviewedCatalogCheck,
    'the synthetic trigger closure must be restored byte-exactly after sabotage');

  // Persist a hostile default path and same-signature public shadows. The
  // production stream must override it before its first catalog read, while
  // the artifact independently qualifies the index-key builtins.
  runPsql(targetDatabase, `
    create function public.lower(p_value text) returns text
    language sql immutable parallel safe as $$ select 'shadow-lower'::text $$;
    create function public.btrim(p_value text) returns text
    language sql immutable parallel safe as $$ select 'shadow-btrim'::text $$;
    alter database "${targetDatabase}" set search_path = public, pg_catalog;
  `);
  assert.strictEqual(scalar(targetDatabase, 'show search_path'), 'public, pg_catalog');
  const result = productionInstallStream(
    targetDatabase, true, reviewedCatalogCheck, reviewedAcceleratorMigration,
  );
  assert.strictEqual(scalar(targetDatabase, `
    select count(*) from pg_catalog.pg_depend d
    where d.classid='pg_catalog.pg_class'::regclass
      and d.objid in (
        'public.deliverables_b3_trimmed_id_lookup_idx'::regclass,
        'public.deliverables_b3_exact_url_lookup_idx'::regclass
      )
      and d.refclassid='pg_catalog.pg_proc'::regclass
      and d.refobjid in (
        pg_catalog.to_regprocedure('public.lower(text)'),
        pg_catalog.to_regprocedure('public.btrim(text)')
      )
  `), '0');
  runPsql(targetDatabase, `
    alter database "${targetDatabase}" reset search_path;
    drop function public.lower(text);
    drop function public.btrim(text);
  `);
  const pre = parseCatalogReceipt(
    result.stdout, 'syncview-b3-accelerator-precheck-v1',
  );
  const post = parseCatalogReceipt(
    result.stdout, 'syncview-b3-accelerator-postcheck-v1',
  );
  const session = parseCatalogReceipt(
    result.stdout, 'syncview-b3-accelerator-session-v1',
  );
  assert.strictEqual(pre.index_state, 'FRESH');
  assert.strictEqual(pre.named_index_count, 0);
  assert.strictEqual(pre.search_path_pinned, true);
  assert.strictEqual(pre.transaction_read_only, true);
  assert.strictEqual(pre.current_xact_id_assigned, false);
  assert.strictEqual(post.index_state, 'EXACT_COMPLETE');
  assert.strictEqual(post.named_index_count, 2);
  assert.strictEqual(post.exact_index_count, 2);
  assert.strictEqual(post.invalid_index_count, 0);
  assert.strictEqual(post.ready_index_count, 2);
  assert.strictEqual(post.live_index_count, 2);
  assert.strictEqual(post.url_projector_dependency_count, 1);
  assert.strictEqual(post.source_exact_count, 10);
  assert.strictEqual(post.event_trigger_exact_count, 6);
  assert.strictEqual(post.source_digest, pre.source_digest);
  assert.strictEqual(post.acl_digest, pre.acl_digest);
  assert.strictEqual(post.event_trigger_digest, pre.event_trigger_digest);
  assert.strictEqual(post.settings_digest, pre.settings_digest);
  assert.strictEqual(post.b3_receipt_digest, pre.b3_receipt_digest);
  assert.strictEqual(post.search_path_pinned, true);
  assert.strictEqual(post.transaction_read_only, true);
  assert.strictEqual(post.current_xact_id_assigned, false);
  assert.strictEqual(session.same_session, true);
  assert.strictEqual(session.search_path_pinned, true);
  assert.strictEqual(session.ddl_quiescence_confirmed, true);
  assert.strictEqual(session.current_xact_id_assigned, false);
  assert.strictEqual(session.migration_sha256, ACCELERATOR_MIGRATION_SHA256);
  const completeInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(completeInventory.inventory_state, 'EXACT_COMPLETE');
  assert.strictEqual(completeInventory.trimmed_id_index_state, 'EXACT_VALID');
  assert.strictEqual(completeInventory.exact_url_index_state, 'EXACT_VALID');
  assert.strictEqual(completeInventory.named_index_count, 2);
  assert.strictEqual(completeInventory.exact_index_count, 2);
  assert.strictEqual(completeInventory.invalid_index_count, 0);
  assert.strictEqual(completeInventory.ready_index_count, 2);
  assert.strictEqual(completeInventory.live_index_count, 2);
  assert.strictEqual(completeInventory.url_projector_dependency_count, 1);

  // PostgreSQL may legitimately retain indcheckxmin after a healthy
  // concurrent build encounters old broken HOT chains. Model that engine
  // state directly in this disposable catalog and prove valid/ready/live
  // remains authoritative rather than misclassifying the indexes.
  runPsql(targetDatabase, `
    update pg_catalog.pg_index set indcheckxmin=true
    where indexrelid in (
      'public.deliverables_b3_trimmed_id_lookup_idx'::regclass,
      'public.deliverables_b3_exact_url_lookup_idx'::regclass
    );
  `);
  const hotChainInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(hotChainInventory.inventory_state, 'EXACT_COMPLETE');
  runPsql(targetDatabase, '\\set b3_accelerator_phase post\n' + reviewedCatalogCheck);
  runPsql(targetDatabase, `
    update pg_catalog.pg_index set indcheckxmin=false
    where indexrelid in (
      'public.deliverables_b3_trimmed_id_lookup_idx'::regclass,
      'public.deliverables_b3_exact_url_lookup_idx'::regclass
    );
  `);
}

function runAcceleratorPerformanceProof(targetDatabase) {
  runPsql(targetDatabase, schema);
  runPsql(targetDatabase, migration);
  runPsql(targetDatabase, productionScaleSeedSql());
  runPsql(targetDatabase, adversarialParitySeedSql());

  const legacyState = JSON.parse(scalar(
    targetDatabase,
    'select public.b3_scoped_global_failure_state()::text',
  ));
  assert.deepStrictEqual({
    checked: legacyState.checked,
    resolved: legacyState.resolved,
    resolved_by_id: legacyState.resolved_by_id,
    resolved_by_exact_url: legacyState.resolved_by_exact_url,
    failure_count: legacyState.failure_count,
  }, {
    checked: 854,
    resolved: 581,
    resolved_by_id: 549,
    resolved_by_exact_url: 32,
    failure_count: 273,
  });
  const predicateDigestBefore = scalar(targetDatabase, installedGlobalSourceDigestSql());
  assert.strictEqual(
    predicateDigestBefore,
    '34b902aaf96f992a895973e758f5d5a5605c2f56455e0d1c1dd69b677c577406',
  );

  runProductionInstallStreamProof(targetDatabase);
  const reviewedAcceleratorMigration = syntheticAcceleratorMigration(targetDatabase);
  assert.strictEqual(scalar(targetDatabase, exactAcceleratorCountSql()), '2');
  const indexedState = JSON.parse(scalar(
    targetDatabase,
    "set statement_timeout='8s';\nselect public.b3_scoped_global_failure_state()::text",
  ));
  assert.deepStrictEqual(indexedState, legacyState,
    'accelerators must preserve every global predicate output byte-for-byte');
  assert.strictEqual(scalar(targetDatabase, installedGlobalSourceDigestSql()),
    predicateDigestBefore, 'accelerator install must not replace the predicate');

  runPsql(targetDatabase, adversarialParityCleanupSql());
  const before = JSON.parse(scalar(
    targetDatabase,
    "set statement_timeout='8s';\nset role service_role;\n"
      + 'select public.b3_scoped_card_linkage_preflight()::text',
  ));
  assert.deepStrictEqual(before, rpcPlan(performancePlan).global_before);
  assert.strictEqual(before.failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(before.failure_digest, performancePlan.global_failure_digest);
  assert.strictEqual(before.checked, 845);
  assert.strictEqual(before.resolved_by_id, 548);
  assert.strictEqual(before.resolved_by_exact_url, 31);

  const explain = explainGlobalPredicate(targetDatabase);
  const deliverableScans = planRelationScans(explain, 'deliverables');
  const deliverableIndexes = new Set(deliverableScans.map(function indexName(scan) {
    return scan['Index Name'];
  }).filter(Boolean));
  assert.ok(deliverableScans.length > 0, 'plan must expose deliverables probes');
  assert.ok(deliverableScans.every(function noSequentialProbe(scan) {
    return scan['Node Type'] !== 'Seq Scan';
  }), 'production-scale predicate must not sequentially rescan deliverables');
  assert.ok(deliverableIndexes.has('deliverables_b3_trimmed_id_lookup_idx'));
  assert.ok(deliverableIndexes.has('deliverables_b3_exact_url_lookup_idx'));

  runPsql(
    targetDatabase,
    "set statement_timeout='8s';\nset role service_role;\n"
      + rpcSql('b3_scoped_card_linkage_apply', performancePlan),
  );
  assert.strictEqual(scalar(targetDatabase,
    "select count(*) from public.calendar_posts where id in ("
      + literalCohortIdsSql('fictional-card', 15)
      + ') and graphic_deliverable_id is not null'), '15');
  const afterApply = JSON.parse(scalar(
    targetDatabase,
    "set statement_timeout='8s';\nset role service_role;\n"
      + 'select public.b3_scoped_card_linkage_preflight()::text',
  ));
  assert.deepStrictEqual(afterApply, rpcPlan(performancePlan).global_projected);
  assert.strictEqual(afterApply.failure_count, GLOBAL_FAILURE_COUNT);
  assert.strictEqual(afterApply.failure_digest, before.failure_digest);
  assert.strictEqual(afterApply.resolved_by_id, 563);
  assert.strictEqual(afterApply.resolved_by_exact_url, 16);

  runPsql(
    targetDatabase,
    "set statement_timeout='8s';\nset role service_role;\n"
      + rpcSql(
        'b3_scoped_card_linkage_rollback',
        performancePlan,
        performanceRollbackHash,
      ),
  );
  assert.strictEqual(scalar(targetDatabase,
    "select count(*) from public.calendar_posts where id in ("
      + literalCohortIdsSql('fictional-card', 15)
      + ') and graphic_deliverable_id is null'), '15');
  const afterRollback = JSON.parse(scalar(
    targetDatabase,
    "set statement_timeout='8s';\nset role service_role;\n"
      + 'select public.b3_scoped_card_linkage_preflight()::text',
  ));
  assert.deepStrictEqual(afterRollback, rpcPlan(performancePlan).global_before);
  assert.strictEqual(afterRollback.failure_digest, before.failure_digest);

  // The concurrent index builds are separate autocommit statements. Drift the
  // expression helper after both exist and prove the post-DDL closure catches
  // it, then restore the exact definition before exercising schema rollback.
  runPsql(targetDatabase, `
    create or replace function public.b3_scoped_linear_url_projection(p_value text)
    returns text language plpgsql immutable parallel safe
    set search_path = pg_catalog as $drift$
    begin return lower(btrim(coalesce(p_value, ''))); end;
    $drift$;
  `);
  const postClosureSourceRefusal = runPsql(
    targetDatabase,
    acceleratorClosureSql(),
    false,
  );
  assert.match(
    String(postClosureSourceRefusal.stderr || ''),
    /b3_scoped_accelerator_source_closure_failed/,
  );
  runPsql(targetDatabase,
    sqlFunctionDefinition(migration, 'b3_scoped_linear_url_projection'));
  assert.strictEqual(scalar(targetDatabase,
    "select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') "
      + "from pg_proc p where p.oid=to_regprocedure("
      + "'public.b3_scoped_linear_url_projection(text)')"),
  '78428edebe1cae761bdff3322a02c68e1a57cb7774240c08806f9e9aebfdc818');

  // Exercise the shipped bounded schema rollback. Then expose one owner-only
  // helper and prove ACL drift is refused before either index can be created.
  runPsql(targetDatabase, acceleratorRollbackSql());
  assert.strictEqual(scalar(targetDatabase, exactAcceleratorCountSql()), '0');
  assert.strictEqual(scalar(targetDatabase, installedGlobalSourceDigestSql()),
    predicateDigestBefore);
  assert.strictEqual(readFailureInventory(targetDatabase).inventory_state, 'FRESH');

  // Restore the disposable pre-install receipt baseline before replaying the
  // exact production stream. These rows came from the already-proved fictional
  // apply/rollback pair above, not from accelerator installation.
  runPsql(targetDatabase, `
    delete from public.deliverable_events
    where action in (
      'b3_scoped_card_linkage_apply',
      'b3_scoped_card_linkage_rollback'
    ) or event_key like 'b3-scoped-card-linkage:%'
      or event_key like 'b3-scoped-card-linkage-rollback:%';
  `);

  // A privileged writer can change and restore metadata between autocommit
  // statements. The owner-declared DDL-quiescent window prevents that in the
  // approved run; tuple-version parity independently makes a violation
  // observable even when the final definition and metadata are restored.
  const secondBuild =
    'create index concurrently deliverables_b3_exact_url_lookup_idx';
  assert.ok(reviewedAcceleratorMigration.includes(secondBuild));
  const mutationWitnessMigration = reviewedAcceleratorMigration.replace(
    secondBuild,
    'alter function public.b3_scoped_global_failure_state() cost 101;\n'
      + 'alter function public.b3_scoped_global_failure_state() cost 100;\n\n'
      + secondBuild,
  );
  const mutationWitnessResult = productionInstallStream(
    targetDatabase, true, syntheticCatalogCheck(targetDatabase),
    mutationWitnessMigration,
  );
  const mutationPre = parseCatalogReceipt(
    mutationWitnessResult.stdout, 'syncview-b3-accelerator-precheck-v1',
  );
  const mutationPost = parseCatalogReceipt(
    mutationWitnessResult.stdout, 'syncview-b3-accelerator-postcheck-v1',
  );
  assert.notStrictEqual(mutationPost.source_digest, mutationPre.source_digest,
    'change-and-restore catalog DDL must alter the tuple-version witness');
  runPsql(targetDatabase, acceleratorRollbackSql());
  assert.strictEqual(readFailureInventory(targetDatabase).inventory_state, 'FRESH');

  // A prior attempt that left the first exact index behind is not resumable.
  // The reviewed production stream must refuse before creating its peer and
  // must not clean up the remnant automatically.
  runPsql(targetDatabase,
    'create index concurrently deliverables_b3_trimmed_id_lookup_idx '
      + "on public.deliverables ((btrim(coalesce(id, ''))));");
  const partialInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(partialInventory.inventory_state, 'REVIEW_REQUIRED');
  assert.strictEqual(partialInventory.trimmed_id_index_state, 'EXACT_VALID');
  assert.strictEqual(partialInventory.exact_url_index_state, 'MISSING');
  assert.strictEqual(partialInventory.named_index_count, 1);
  assert.strictEqual(partialInventory.exact_index_count, 1);
  const exactPartialRefusal = productionInstallStream(targetDatabase, false);
  assert.match(String(exactPartialRefusal.stderr || ''),
    /B3ACC_NON_PRISTINE_INDEX_STATE/);
  assert.strictEqual(scalar(targetDatabase,
    "select to_regclass('public.deliverables_b3_trimmed_id_lookup_idx') is not null "
      + "and to_regclass('public.deliverables_b3_exact_url_lookup_idx') is null"), 't');
  runPsql(targetDatabase,
    'drop index concurrently public.deliverables_b3_trimmed_id_lookup_idx;');

  // An interrupted concurrent build can leave the exact definition invalid or
  // not ready. Build the exact disposable index, then model PostgreSQL's
  // interrupted catalog state directly inside this throwaway database.
  runPsql(targetDatabase,
    'create index concurrently deliverables_b3_trimmed_id_lookup_idx '
      + "on public.deliverables ((btrim(coalesce(id, ''))));");
  runPsql(targetDatabase,
    'update pg_catalog.pg_index set indisvalid=false, indisready=false '
      + "where indexrelid='public.deliverables_b3_trimmed_id_lookup_idx'::regclass;");
  assert.strictEqual(scalar(targetDatabase,
    "select count(*) from pg_catalog.pg_index i join pg_catalog.pg_class c "
      + "on c.oid=i.indexrelid where c.relname='deliverables_b3_trimmed_id_lookup_idx' "
      + 'and not i.indisvalid'), '1');
  const invalidInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(invalidInventory.inventory_state, 'REVIEW_REQUIRED');
  assert.strictEqual(invalidInventory.trimmed_id_index_state, 'INVALID_OR_NOT_READY');
  assert.strictEqual(invalidInventory.exact_url_index_state, 'MISSING');
  assert.strictEqual(invalidInventory.invalid_index_count, 1);
  assert.strictEqual(invalidInventory.ready_index_count, 0);
  const invalidRemnantRefusal = productionInstallStream(targetDatabase, false);
  assert.match(String(invalidRemnantRefusal.stderr || ''),
    /B3ACC_NON_PRISTINE_INDEX_STATE/);
  assert.strictEqual(scalar(targetDatabase,
    "select to_regclass('public.deliverables_b3_exact_url_lookup_idx') is null"), 't');
  runPsql(targetDatabase,
    'drop index concurrently public.deliverables_b3_trimmed_id_lookup_idx;');

  runPsql(targetDatabase,
    'grant execute on function public.b3_scoped_comment_count(text) to service_role;');
  const aclDriftRefusal = runPsql(
    targetDatabase,
    reviewedAcceleratorMigration,
    false,
  );
  assert.match(
    String(aclDriftRefusal.stderr || ''),
    /b3_scoped_accelerator_acl_prerequisite_failed/,
  );
  assert.strictEqual(scalar(targetDatabase, exactAcceleratorCountSql()), '0');
  runPsql(targetDatabase,
    'revoke execute on function public.b3_scoped_comment_count(text) from service_role;');
  assert.strictEqual(scalar(targetDatabase, acceleratorAclDeviationCountSql()), '0');

  // A service entry point may be executable but never delegable. Prove a
  // grant-option drift is named and refused before either index is created.
  runPsql(targetDatabase,
    'grant execute on function public.b3_scoped_card_linkage_preflight() '
      + 'to service_role with grant option;');
  assert.strictEqual(scalar(targetDatabase, acceleratorAclDeviationCountSql()), '1');
  const grantOptionRefusal = runPsql(
    targetDatabase,
    reviewedAcceleratorMigration,
    false,
  );
  assert.match(String(grantOptionRefusal.stderr || ''),
    /b3_scoped_accelerator_acl_prerequisite_failed/);
  assert.strictEqual(scalar(targetDatabase, exactAcceleratorCountSql()), '0');
  runPsql(targetDatabase,
    'revoke grant option for execute on function '
      + 'public.b3_scoped_card_linkage_preflight() from service_role;');
  assert.strictEqual(scalar(targetDatabase, acceleratorAclDeviationCountSql()), '0');

  // Model a remnant arriving after the outer read-only precheck. The migration
  // has its own zero-equivalent prerequisite and must refuse rather than adopt
  // or skip the differently named index.
  // The forward/rollback receipts have already been asserted above; remove
  // those fictional rows only to restore the disposable pre-install baseline.
  runPsql(targetDatabase, `
    delete from public.deliverable_events
    where action in (
      'b3_scoped_card_linkage_apply',
      'b3_scoped_card_linkage_rollback'
    ) or event_key like 'b3-scoped-card-linkage:%'
      or event_key like 'b3-scoped-card-linkage-rollback:%';
  `);
  assert.strictEqual(scalar(targetDatabase,
    "select count(*) from public.deliverable_events where action like 'b3_scoped_%'"), '0');
  const reviewedCatalogCheck = syntheticCatalogCheck(targetDatabase);
  runPsql(targetDatabase,
    '\\set b3_accelerator_phase pre\n' + reviewedCatalogCheck);
  runPsql(targetDatabase,
    'create index concurrently b3_equivalent_race_idx '
      + "on public.deliverables ((btrim(coalesce(id, ''))));");
  const equivalentInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(equivalentInventory.inventory_state, 'REVIEW_REQUIRED');
  assert.strictEqual(equivalentInventory.trimmed_id_index_state, 'MISSING');
  assert.strictEqual(equivalentInventory.exact_url_index_state, 'MISSING');
  assert.strictEqual(equivalentInventory.named_index_count, 0);
  assert.strictEqual(equivalentInventory.equivalent_other_count, 1);
  const equivalentRaceRefusal = runPsql(
    targetDatabase,
    reviewedAcceleratorMigration,
    false,
  );
  assert.match(String(equivalentRaceRefusal.stderr || ''),
    /b3_scoped_accelerator_index_prerequisite_failed/);
  assert.strictEqual(scalar(targetDatabase, namedAcceleratorCountSql()), '0');
  runPsql(targetDatabase, 'drop index concurrently public.b3_equivalent_race_idx;');

  // Likewise, an enabled DDL route arriving after the outer precheck must be
  // caught by the artifact's own prerequisite before CREATE INDEX can fire it.
  runPsql(targetDatabase,
    '\\set b3_accelerator_phase pre\n' + reviewedCatalogCheck);
  runPsql(targetDatabase, `
    create function extensions.b3_post_precheck_ddl_watch()
    returns event_trigger language plpgsql as $fn$ begin null; end $fn$;
    alter function extensions.b3_post_precheck_ddl_watch() owner to supabase_admin;
    create event trigger b3_post_precheck_ddl_watch on ddl_command_end
      execute function extensions.b3_post_precheck_ddl_watch();
    alter event trigger b3_post_precheck_ddl_watch owner to supabase_admin;
  `);
  const eventRaceRefusal = runPsql(
    targetDatabase,
    reviewedAcceleratorMigration,
    false,
  );
  assert.match(String(eventRaceRefusal.stderr || ''),
    /b3_scoped_accelerator_event_trigger_prerequisite_failed/);
  assert.strictEqual(scalar(targetDatabase, namedAcceleratorCountSql()), '0');
  runPsql(targetDatabase, `
    drop event trigger b3_post_precheck_ddl_watch;
    drop function extensions.b3_post_precheck_ddl_watch();
  `);

  // Sabotage a named index with a wrong definition. The prerequisite must
  // refuse before creating its peer.
  runPsql(targetDatabase,
    'create index concurrently deliverables_b3_trimmed_id_lookup_idx '
      + 'on public.deliverables (id);');
  const wrongInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(wrongInventory.inventory_state, 'REVIEW_REQUIRED');
  assert.strictEqual(wrongInventory.trimmed_id_index_state, 'WRONG_DEFINITION');
  assert.strictEqual(wrongInventory.exact_url_index_state, 'MISSING');
  assert.strictEqual(wrongInventory.named_index_count, 1);
  assert.strictEqual(wrongInventory.exact_index_count, 0);
  const driftedIndexRefusal = runPsql(
    targetDatabase,
    reviewedAcceleratorMigration,
    false,
  );
  assert.match(
    String(driftedIndexRefusal.stderr || ''),
    /b3_scoped_accelerator_index_prerequisite_failed/,
  );
  assert.strictEqual(scalar(targetDatabase,
    "select to_regclass('public.deliverables_b3_exact_url_lookup_idx') is null"), 't');
  runPsql(targetDatabase,
    'drop index concurrently public.deliverables_b3_trimmed_id_lookup_idx;');

  // An otherwise matching expression with unreviewed storage options is not
  // the exact artifact and must be classified as a wrong definition.
  runPsql(targetDatabase,
    'create index concurrently deliverables_b3_trimmed_id_lookup_idx '
      + "on public.deliverables ((pg_catalog.btrim(coalesce(id, '')))) "
      + 'with (fillfactor=80);');
  const reloptionsInventory = readFailureInventory(targetDatabase);
  assert.strictEqual(reloptionsInventory.inventory_state, 'REVIEW_REQUIRED');
  assert.strictEqual(reloptionsInventory.trimmed_id_index_state, 'WRONG_DEFINITION');
  const reloptionsRefusal = productionInstallStream(targetDatabase, false);
  assert.match(String(reloptionsRefusal.stderr || ''),
    /B3ACC_NON_PRISTINE_INDEX_STATE/);
  assert.strictEqual(scalar(targetDatabase,
    "select to_regclass('public.deliverables_b3_exact_url_lookup_idx') is null"), 't');
  runPsql(targetDatabase,
    'drop index concurrently public.deliverables_b3_trimmed_id_lookup_idx;');

  runPsql(targetDatabase, reviewedAcceleratorMigration);
  assert.strictEqual(scalar(targetDatabase, exactAcceleratorCountSql()), '2');
  assert.strictEqual(readFailureInventory(targetDatabase).inventory_state,
    'EXACT_COMPLETE');
  assert.strictEqual(scalar(targetDatabase, acceleratorAclDeviationCountSql()), '0');
  assert.deepStrictEqual(JSON.parse(scalar(
    targetDatabase,
    "set statement_timeout='8s';\nset role service_role;\n"
      + 'select public.b3_scoped_card_linkage_preflight()::text',
  )), rpcPlan(performancePlan).global_before);
}

async function main() {
  let created = false;
  let performanceCreated = false;
  let maliciousPsqlrcCreated = false;
  let primaryFailure = null;
  let successMessage = '';
  const cleanupFailures = [];
  try {
  fs.writeFileSync(maliciousPsqlrc, [
    '\\set AUTOCOMMIT off',
    '\\echo B3_PSQLRC_MUST_NOT_RUN',
    '\\quit 99',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  maliciousPsqlrcCreated = true;
  psqlEnv.PSQLRC = maliciousPsqlrc;
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

  runPsql('postgres', 'create database "' + performanceDatabase + '" template template0;');
  performanceCreated = true;
  runAcceleratorPerformanceProof(performanceDatabase);

  successMessage = 'B3 scoped-linkage disposable PostgreSQL proof passed: '
      + 'global_gate=BLOCKED failure_count=266 failure_digest_unchanged=true '
      + 'population_sabotage_requested=15 population_sabotage_eligible=16 '
      + 'population_sabotage_refused=true population_races_exercised=true '
      + 'rollback_exercised=true accelerator_predicate_unchanged=true '
      + 'accelerator_production_stream=true accelerator_psqlrc_ignored=true '
      + 'accelerator_event_trigger_sabotage_refused=true '
      + 'accelerator_failure_inventory_executed=true '
      + 'accelerator_search_path_sabotage_refused=true '
      + 'accelerator_proc_metadata_sabotage_refused=true '
      + 'accelerator_catalog_mutation_witness=true '
      + 'accelerator_index_metadata_sabotage_refused=true '
      + 'accelerator_hot_chain_state_accepted=true '
      + 'accelerator_invalid_remnant_refused=true '
      + 'accelerator_plan_indexed=true accelerator_8s_apply_rollback=true '
      + 'accelerator_schema_rollback_exercised=true '
      + 'accelerator_acl_sabotage_refused=true '
      + 'accelerator_postclosure_source_sabotage_refused=true';
  } catch (error) {
    primaryFailure = error;
  } finally {
    function cleanup(label, callback) {
      try { callback(); }
      catch (error) {
        const wrapped = new Error(label + ': ' + String(error && error.message || error));
        wrapped.cause = error;
        cleanupFailures.push(wrapped);
      }
    }
    if (performanceCreated) {
      cleanup('performance_database_cleanup_failed', function dropPerformanceDatabase() {
        runPsql('postgres',
          'drop database if exists "' + performanceDatabase + '" with (force);');
      });
    }
    if (created) {
      cleanup('proof_database_cleanup_failed', function dropProofDatabase() {
        runPsql('postgres', 'drop database if exists "' + database + '" with (force);');
      });
    }
    for (const role of fixtureRoles.slice().reverse()) {
      if (!roleExisted[role]) {
        cleanup('fixture_role_cleanup_failed_' + role, function dropFixtureRole() {
          runPsql('postgres', 'drop role if exists "' + role + '";');
        });
      }
    }
    if (maliciousPsqlrcCreated) {
      cleanup('malicious_psqlrc_cleanup_failed', function removeMaliciousPsqlrc() {
        fs.rmSync(maliciousPsqlrc, { force: true });
      });
    }
    delete psqlEnv.PSQLRC;
  }
  const failures = (primaryFailure ? [primaryFailure] : []).concat(cleanupFailures);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'B3 PostgreSQL proof and cleanup failures');
  }
  console.log(successMessage);
}

main().catch(function fail(error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
