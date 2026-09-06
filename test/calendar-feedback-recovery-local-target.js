'use strict';
// Connection parsing only: no PostgreSQL process or connection is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Cluster } = require('../qa/calendar-feedback-recovery/pg');
let checks = 0;
for (const env of [
  { PGHOST: 'database.invalid' },
  { PGHOST: '192.0.2.10' },
  { PGHOST: '127.0.0.1', PGPORT: '65536' },
  { PGHOST: '127.0.0.1', PGPORT: 'NaN' },
  { CALENDAR_RECOVERY_PG: 'database.invalid:5432:postgres', PGHOST: '127.0.0.1' },
  { CALENDAR_RECOVERY_PG: '127.0.0.1:0:postgres' },
  { CALENDAR_RECOVERY_PG: 'invalid' },
]) { assert.throws(() => Cluster.fromEnv(env), /calendar_recovery_local_connection_required/); checks++; }
for (const host of ['127.0.0.1', 'localhost', '::1']) {
  const conn = Cluster.fromEnv({ PGHOST: host, PGPORT: '55527', PGUSER: 'synthetic_role' });
  assert.equal(conn.host, host); assert.equal(conn.port, 55527); assert.equal(conn.user, 'synthetic_role'); checks++;
}
assert.equal(Cluster.fromEnv({ CALENDAR_RECOVERY_PG: '[::1]:55527:synthetic_role' }).host, '::1'); checks++;
assert.equal(Cluster.fromEnv({ CALENDAR_RECOVERY_PG: '127.0.0.1:55527' }).user, 'postgres'); checks++;
assert.equal(Cluster.fromEnv({}), null); checks++;

// Execute the actual two libpq launch paths with a captured process seam.
// No connection or SQL process is started, even for the malicious fixtures.
const launches = [];
const file = path.resolve(__dirname, '../qa/calendar-feedback-recovery/pg.js');
const context = { module: { exports: {} }, __dirname: path.dirname(file),
  process: { platform: process.platform, env: { PGHOSTADDR: '192.0.2.10',
    pgservice: 'synthetic-redirect', PgServiceFile: 'synthetic-service-file',
    PGPASSWORD: 'synthetic-fixture-password', PGOPTIONS: 'untrusted-option' } },
  require: name => name === 'node:child_process' ? {
    spawnSync: (bin, args, options) => { launches.push({ bin, args, options }); return { status: 0, stdout: '', stderr: '' }; },
    execFileSync: () => { throw new Error('unexpected_process'); },
  } : require(name),
};
vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
const db = new context.module.exports.Db({ host: '127.0.0.1', port: 55528, user: 'synthetic_role' }, 'synthetic_fixture');
db.psql('select 1'); db.file('synthetic-fixture.sql');
assert.equal(launches.length, 2); checks++;
for (const launch of launches) {
  assert.equal(launch.args[launch.args.indexOf('-h') + 1], '127.0.0.1');
  assert.equal(launch.args[launch.args.indexOf('-p') + 1], '55528');
  assert.equal(launch.args[launch.args.indexOf('-U') + 1], 'synthetic_role');
  for (const key of Object.keys(launch.options.env)) {
    assert.ok(!['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE'].includes(key.toUpperCase()));
  }
  assert.equal(launch.options.env.PGPASSWORD, 'synthetic-fixture-password');
  assert.equal(launch.options.env.PGOPTIONS, '-c client_min_messages=warning');
  checks++;
}
console.log(JSON.stringify({ suite: 'calendar_feedback_local_target', passed: checks, database_calls: 0 }));
