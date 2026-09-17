'use strict';
/* Compatibility name for the one canonical reconcile engine; no divergent
 * card-materialization or reason protocol is maintained here. */
const { run } = require('../native-intake-reconcile/runner-lib');
run({actor:'native-intake-completion',actorEnv:'NATIVE_INTAKE_COMPLETION_ACTOR',hashEnv:'NATIVE_INTAKE_COMPLETION_HASH_KEY',confirmEnv:'NATIVE_INTAKE_COMPLETION_CONFIRM'});
