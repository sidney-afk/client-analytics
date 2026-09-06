'use strict';
// Full HTTP handler, synthetic RPC-shaped store, external fetch refused.
const { spawnSync } = require('child_process');
const path = require('path');
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings',
  path.join(__dirname, '../qa/comment-receipt-fingerprint/run.mjs')], { stdio: 'inherit' });
process.exitCode = result.status == null ? 1 : result.status;
