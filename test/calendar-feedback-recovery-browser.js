'use strict';
// Complete document + actual offered client controls + actual handlers +
// disposable PostgreSQL. Pass --baseline to prove the exact base still holds.
// Needs PostgreSQL 16 and the repository's Playwright Chromium; without either
// it says so and skips (CALENDAR_RECOVERY_REQUIRE_BROWSER=1 makes that a fail).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Cluster } = require('../qa/calendar-feedback-recovery/pg');
let chromium = '';
try { chromium = require('playwright').chromium.executablePath(); } catch (e) { chromium = ''; }
if (!Cluster.available() || !chromium || !fs.existsSync(chromium)) {
  console.log('  --  calendar feedback recovery browser matrix SKIPPED: needs PostgreSQL 16 and Playwright Chromium (' + (chromium || 'playwright missing') + ')');
  process.exit(process.env.CALENDAR_RECOVERY_REQUIRE_BROWSER === '1' ? 1 : 0);
}
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
  path.join(__dirname, '../qa/calendar-feedback-recovery/browser.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = result.status == null ? 1 : result.status;
