'use strict';
// Actual production-write + frozen calendar-upsert handlers over a disposable
// PostgreSQL 16 built from the repository migrations. External fetch refused.
// Uses the CI postgres service through PG* variables, or starts a local
// cluster when the server binaries exist; otherwise it says so and skips.
const { spawnSync } = require('child_process');
const path = require('path');
const { Cluster } = require('../qa/calendar-feedback-recovery/pg');
if (!Cluster.available()) {
  console.log('  --  calendar feedback recovery handler matrix SKIPPED: no PostgreSQL 16 (PGHOST service, CALENDAR_RECOVERY_PG, or initdb) available here');
  process.exit(process.env.CALENDAR_RECOVERY_REQUIRE_POSTGRES === '1' ? 1 : 0);
}
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
  path.join(__dirname, '../qa/calendar-feedback-recovery/handler.mjs')], { stdio: 'inherit' });
process.exitCode = result.status == null ? 1 : result.status;
