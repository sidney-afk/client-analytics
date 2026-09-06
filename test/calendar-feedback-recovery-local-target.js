'use strict';
// Connection parsing only: no PostgreSQL process or connection is started.
const assert = require('node:assert/strict');
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
console.log(JSON.stringify({ suite: 'calendar_feedback_local_target', passed: checks, database_calls: 0 }));
