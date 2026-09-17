'use strict';
/* Manual, dry-run-first wrapper. The shared runner has bounded RPC calls and
 * refuses malformed summaries/cursors before a public zero-debt claim. */
const { run } = require('./runner-lib');
run({actor:'native-intake-reconcile',actorEnv:'NATIVE_INTAKE_RECONCILE_ACTOR',hashEnv:'NATIVE_INTAKE_RECONCILE_HASH_KEY',confirmEnv:'NATIVE_INTAKE_RECONCILE_CONFIRM'});
