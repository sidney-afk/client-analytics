'use strict';
// Explicitly opted-in local SQL lane; never reuses an incidental PGHOST service.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
if (process.env.CALENDAR_RECOVERY_INTEGRATED !== 'LOCAL_DISPOSABLE_ONLY') {
  if (process.env.CI) throw new Error('CI requires CALENDAR_RECOVERY_INTEGRATED=LOCAL_DISPOSABLE_ONLY with its disposable PostgreSQL service');
  console.log('calendar feedback combined SQL SKIPPED: explicit owned disposable server opt-in required');
} else {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
    path.join(__dirname, '../qa/calendar-feedback-recovery/integrated.mjs')], { stdio: 'inherit' });
  process.exitCode = result.status == null ? 1 : result.status;
}
